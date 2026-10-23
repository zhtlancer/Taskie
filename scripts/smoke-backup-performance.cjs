// Isolated local performance acceptance: 600 MiB photo export and a 200 MiB legacy restore.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { createGzip } = require('node:zlib');
const { performance, monitorEventLoopDelay } = require('node:perf_hooks');
const { getDb } = require('../backend/src/db');
const buildApp = require('../backend/src/app');

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'taskie-backup-performance-'));
  const db = getDb(':memory:');
  const app = buildApp({ db, logger: false, deviceAuth: false, backupIntervalHours: 0,
    uploadDir: path.join(dir, 'uploads'), backupDir: path.join(dir, 'backups'), authorizedTokensFile: path.join(dir, 'tokens') });
  try {
    await app.ready();
    const base = await app.listen({ host: '127.0.0.1', port: 0 });
    const child = app.services.childrenService.createChild({ name: '性能验收' });
    const service = app.backupService;
    const photo = Buffer.alloc(2 * 1024 * 1024, 97);
    for (let i = 0; i < 300; i++) {
      const name = `export-${i}.jpg`;
      fs.writeFileSync(path.join(dir, 'uploads', name), photo);
      app.services.mistakesService.createMistake({ child_id: child.id, subject: '数学', description: '阶段 B 验收', photo_path: `/uploads/${name}` });
    }
    await service.create();
    let reads = 0, bytes = 0, firstByteMs;
    const original = fs.createReadStream;
    fs.createReadStream = function (file, ...args) {
      if (/export-\d+\.jpg$/.test(String(file))) reads++;
      return original.call(this, file, ...args);
    };
    let ticketMs, exportMs;
    try {
      const ticketStart = performance.now();
      assert.equal((await service.exportEntries()).length, 300);
      ticketMs = performance.now() - ticketStart;
      assert.equal(reads, 0, 'warm ticket inspection must not read photo bytes');
      const start = performance.now();
      for await (const chunk of service.exportPhotos()) {
        if (firstByteMs === undefined) firstByteMs = performance.now() - start;
        bytes += chunk.length;
      }
      exportMs = performance.now() - start;
      assert.equal(reads, 300, 'each unchanged photo is read once across ticket and export');
      assert.ok(bytes >= 600 * 1024 * 1024);
    } finally { fs.createReadStream = original; }
    console.log('PASS export', JSON.stringify({ photos: 300, photoMiB: 600, reads, ticketMs, firstByteMs, exportMs }));

    // Remove the benchmark's data before measuring restore, so before-restore snapshotting
    // does not include the preceding export fixture. All files belong to this temporary dir.
    db.prepare('DELETE FROM mistake_records').run();
    db.prepare('DELETE FROM photo_expectations').run();
    for (const item of service.list()) {
      fs.rmSync(service.getPath(item.name));
      fs.rmSync(path.join(service.backupDir, `${item.name}.manifest.json`), { force: true });
    }
    await service.prunePhotos();
    for (const name of fs.readdirSync(path.join(dir, 'uploads'))) fs.rmSync(path.join(dir, 'uploads', name));

    for (let i = 0; i < 19; i++) app.services.mistakesService.createMistake({ child_id: child.id, subject: '数学', description: '阶段 B 验收', photo_path: `/uploads/legacy-${i}.jpg` });
    const database = db.serialize().toString('base64');
    db.prepare('DELETE FROM mistake_records').run();
    const content = Buffer.alloc(8 * 1024 * 1024, 98).toString('base64');
    let uncompressed = 0;
    const archive = path.join(dir, 'legacy.taskie.gz');
    const parts = async function* () {
      const prefix = `{"format":"taskie-backup","version":1,"database":${JSON.stringify(database)},"photos":{`;
      uncompressed += Buffer.byteLength(prefix); yield prefix;
      for (let i = 0; i < 19; i++) {
        const entry = `${i ? ',' : ''}"legacy-${i}.jpg":"${content}"`;
        uncompressed += entry.length; yield entry;
      }
      uncompressed += 2; yield '}}';
    };
    await pipeline(Readable.from(parts()), createGzip(), fs.createWriteStream(archive));
    assert.ok(uncompressed > 200 * 1024 * 1024);
    const buffer = await fs.promises.readFile(archive);
    const delay = monitorEventLoopDelay({ resolution: 10 });
    delay.enable();
    let finished = false, checks = 0, maxHealthMs = 0;
    const started = performance.now();
    const restore = service.restore(buffer).finally(() => { finished = true; });
    const health = (async () => {
      while (!finished) {
        const start = performance.now();
        const response = await fetch(`${base}/health`);
        await response.arrayBuffer();
        assert.equal(response.status, 200);
        maxHealthMs = Math.max(maxHealthMs, performance.now() - start); checks++;
        await new Promise(resolve => setTimeout(resolve, 10));
      }
    })();
    let result;
    try { [result] = await Promise.all([restore, health]); }
    finally { delay.disable(); }
    const maxDelayMs = delay.max / 1e6;
    assert.equal(result.success, true);
    assert.deepEqual(result.missing_photos, []);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM mistake_records').get().n, 19);
    assert.equal(fs.statSync(path.join(dir, 'uploads', 'legacy-18.jpg')).size, 8 * 1024 * 1024);
    assert.ok(checks > 5, 'health must respond during restore');
    console.log('PASS restore', JSON.stringify({ archiveMiB: uncompressed / 1024 / 1024, elapsedMs: performance.now() - started, healthChecks: checks, maxHealthMs, maxDelayMs }));
    assert.ok(maxDelayMs < 100, `restore event loop delay ${maxDelayMs.toFixed(1)} ms exceeds 100 ms`);
  } finally { await app.close(); db.close(); fs.rmSync(dir, { recursive: true, force: true }); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
