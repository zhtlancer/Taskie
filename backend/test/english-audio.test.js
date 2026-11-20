const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { gzipSync, gunzipSync } = require('node:zlib');
const Database = require('better-sqlite3');
const { createTestApp, cleanupTestApp, familyInstant } = require('./helper');
const { wav, zip, writeAudioFixture } = require('./dictionary-audio-fixture');
const { extractDslSections, extractDslSummary } = require('../src/services/dictionary/dsl-parser');
const { normalizeAudioRefs, audioUrl } = require('../src/utils/english-audio');
const { initDb, SCHEMA_VERSION } = require('../src/db');

async function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'taskie-audio-snapshot-'));
  const dictDir = path.join(root, 'dicts'), data = writeAudioFixture(dictDir);
  const ctx = createTestApp({ dictDir, dictCacheDir: path.join(root, 'cache') });
  t.after(async () => { await ctx.app.close(); cleanupTestApp(ctx); fs.rmSync(root, { recursive: true, force: true }); });
  await ctx.app.ready();
  const { dictionaryService: dictionary, englishWordsService: book, wordStudyService: study, childrenService } = ctx.app.services;
  const child = childrenService.createChild({ name: '发音快照' });
  const match = (await dictionary.lookup('record')).exact_matches[0];
  const word = book.createWord({ child_id: child.id, word: 'record', senses: match.senses, primary_sense_id: match.senses[0].id });
  return { ...ctx, ...data, dictDir, dictionary, book, study, child, match, word };
}

test('POS-specific senses carry separate audio content references and never pick conjugations or example audio', async t => {
  const ctx = await fixture(t);
  assert.equal(ctx.match.pronunciations.length, 2);
  const [noun, verb] = ctx.match.senses;
  assert.equal(noun.pos, 'noun'); assert.equal(verb.pos, 'verb');
  assert.equal(noun.audio_refs[0].file, 'record_n_gb.wav');
  assert.equal(verb.audio_refs[0].file, 'record_v_gb.wav');
  assert.notEqual(noun.audio_refs[0].sha256, verb.audio_refs[0].sha256);
  assert.deepEqual(normalizeAudioRefs(noun.audio_refs), noun.audio_refs);
  const mw = '[s]read0001.wav[/s] [com]\\\\ri:d\\\\ [i][c][com]verb[/com][/c][/i]\n[com]([b]read[/b] [s]read0002.wav[/s])[/com]\n[m1][trn]understand written words[/trn] [s]sentence.wav[/s][/m]';
  assert.deepEqual(extractDslSections(mw, 'mw11')[0].summary.audio.map(ref => ref.file), ['read0001.wav']);
  const oald = '[m0][c orange] verb[/c] [p]BrE[/p] [s]read_gb.wav[/s] [c darkgray]([/c][s]past.wav[/s])\n[m1]{{d}}read text{{/d}}[/m]';
  assert.deepEqual(extractDslSections(oald, 'oald8')[0].summary.audio.map(ref => ref.file), ['read_gb.wav']);
  assert.equal(extractDslSummary('[m0][s]unknown.wav[/s]', 'oald8').audio[0].accent, 'other');
});

test('content identity survives repacking and relocation but changed bytes cannot replace a saved pronunciation', async t => {
  const ctx = await fixture(t), ref = ctx.match.senses[0].audio_refs[0];
  const url = audioUrl(ref);
  assert.equal((await ctx.app.inject({ method: 'GET', url })).statusCode, 200);
  assert.equal((await ctx.rawInject({ method: 'GET', url })).statusCode, 401);
  const future = new Date(Date.now() + 5000);
  fs.writeFileSync(ctx.zipPath, zip({ 'new.wav': wav(110), ...ctx.media })); fs.utimesSync(ctx.zipPath, future, future);
  assert.equal((await ctx.app.inject({ method: 'GET', url })).statusCode, 200, 'old offsets must be rebuilt without invalidating identical audio');
  fs.writeFileSync(ctx.zipPath, zip({ ...ctx.media, [ref.file]: wav(170) })); fs.utimesSync(ctx.zipPath, new Date(+future + 5000), new Date(+future + 5000));
  const changed = await ctx.app.inject({ method: 'GET', url });
  assert.equal(changed.statusCode, 409); assert.match(changed.json().error, /原学习发音已不可用/);
  assert.equal((await ctx.app.inject({ method: 'GET', url: url.replace(ref.sha256, '../bad') })).statusCode, 400);
  const latest = (await ctx.dictionary.lookup('record')).exact_matches[0].senses[0].audio_refs[0];
  assert.notEqual(latest.sha256, ref.sha256);
  assert.equal((await ctx.app.inject({ method: 'GET', url: audioUrl(latest) })).statusCode, 200);
});

test('both skills freeze the selected sense audio; changing the meaning, renaming or removing the word cannot rewrite history', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date(familyInstant('2026-11-16')) });
  const ctx = await fixture(t);
  for (const skill of ['recognize', 'write']) ctx.study.savePlan(ctx.child.id, skill, { days_of_week: [0,1,2,3,4,5,6], new_target: 1, review_target: 1 }, 'en');
  const days = ctx.study.today(ctx.child.id, 'en').days;
  ctx.book.updateWord(ctx.word.id, { expected_version: ctx.book.getWord(ctx.word.id).version, primary_sense_id: ctx.match.senses[1].id });
  for (const day of days) {
    const item = ctx.study.describeDay(day.id).batches[0].items[0];
    assert.equal(item.audio_refs[0].file, 'record_n_gb.wav'); assert.equal(item.phonetic, 'ˈrekɔːd');
    ctx.study.grade(item.id, { result: 'good', request_id: `audio-${item.id}` }, 'child');
  }
  t.mock.timers.tick(86400000);
  const next = ctx.study.today(ctx.child.id, 'en').days;
  for (const day of next) assert.equal(day.batches[0].items[0].audio_refs[0].file, 'record_v_gb.wav');
  ctx.book.updateWord(ctx.word.id, { expected_version: ctx.book.getWord(ctx.word.id).version, word: 'recording' });
  assert.deepEqual(ctx.book.getWord(ctx.word.id).senses[0].audio_refs, [], 'a renamed word must not inherit another spelling audio');
  ctx.book.deleteWord(ctx.word.id, { role: 'parent' });
  for (const day of days) {
    const item = ctx.study.describeDay(day.id).batches[0].items[0];
    assert.equal(item.english_word_id, null); assert.equal(item.audio_refs[0].file, 'record_n_gb.wav');
  }
  const other = ctx.app.services.childrenService.createChild({ name: '另一个孩子' });
  const response = await ctx.app.inject({ method: 'PUT', url: `/api/english-words/${ctx.book.createWord({child_id:ctx.child.id,word:'test'}).id}`, headers: {
    authorization: `Bearer ${ctx.app.jwt.sign({ role: 'child', child_id: other.id, epoch: ctx.app.sessionEpoch() })}`
  }, payload: { senses: ctx.match.senses } });
  assert.equal(response.statusCode, 403);
});

test('audio metadata is bounded and accepts only internal resource references, never caller URLs or file paths', async t => {
  const ctx = await fixture(t), ref = ctx.match.senses[0].audio_refs[0];
  for (const invalid of [null, {}, [ref,ref], Array(5).fill(ref), [{...ref,file:'../private.wav'}], [{...ref,sha256:'bad'}], [{...ref,dict_id:'http://evil'}], [{...ref,accent:'mw'}]]) {
    assert.throws(() => normalizeAudioRefs(invalid), err => err.status === 400);
  }
  const safe = normalizeAudioRefs([{...ref,url:'https://evil/private',absolute_path:'/etc/passwd'}])[0];
  assert.equal(safe.url, undefined); assert.equal(safe.absolute_path, undefined);
  const preview = await ctx.book.batchPreview(ctx.child.id, 'record\t用户自己的中文释义', { dictionaryService: ctx.dictionary });
  assert.equal(preview.items[0].status, 'duplicate');
  ctx.book.deleteWord(ctx.word.id, { role: 'parent' });
  const matched = await ctx.book.batchPreview(ctx.child.id, 'record\t用户自己的中文释义', { dictionaryService: ctx.dictionary });
  assert.equal(matched.items[0].senses[0].audio_refs, undefined, 'ambiguous supplied meanings do not guess a pronunciation');
  assert.equal(matched.items[0].pronunciations.length, 2);
});

test('v41 audio snapshots round-trip without dictionary files; v40 keeps unknown history, corrupt backups are rejected atomically', async t => {
  const ctx = await fixture(t);
  ctx.study.savePlan(ctx.child.id, 'recognize', { days_of_week: [0,1,2,3,4,5,6], new_target: 1 }, 'en');
  const day = ctx.study.today(ctx.child.id, 'en').days[0], item = day.batches[0].items[0];
  const backup = ctx.app.backupService, archive = fs.readFileSync(backup.getPath((await backup.create()).name));
  const parsed = JSON.parse(gunzipSync(archive));
  const candidate = mutate => { const db = new Database(Buffer.from(parsed.database, 'base64')); try { mutate(db); return gzipSync(JSON.stringify({...parsed,database:db.serialize().toString('base64')})); } finally { db.close(); } };
  ctx.dictionary.dictDir = null;
  ctx.book.updateWord(ctx.word.id, { expected_version: ctx.book.getWord(ctx.word.id).version, primary_sense_id: ctx.match.senses[1].id });
  await backup.restore(archive);
  assert.deepEqual(ctx.study.describeDay(day.id).batches[0].items[0].audio_refs, item.audio_refs);
  for (const mutate of [
    db => db.exec('ALTER TABLE word_study_items DROP COLUMN audio_refs'),
    db => db.prepare('UPDATE word_study_items SET audio_refs = ?').run('{}'),
    db => db.prepare('UPDATE word_study_items SET audio_refs = ?').run(JSON.stringify([{...item.audio_refs[0],headword:'different'}])),
    db => db.prepare('UPDATE word_study_items SET audio_refs = ?').run(JSON.stringify([{...item.audio_refs[0],file:'../../secret'}]))
  ]) {
    await assert.rejects(backup.restore(candidate(mutate)), /学习发音/);
    assert.deepEqual(ctx.study.describeDay(day.id).batches[0].items[0].audio_refs, item.audio_refs);
  }
  await backup.restore(candidate(db => { db.exec('ALTER TABLE word_study_items DROP COLUMN audio_refs'); db.pragma('user_version = 40'); }));
  assert.equal(ctx.db.pragma('user_version', {simple:true}), SCHEMA_VERSION);
  assert.equal(ctx.study.describeDay(day.id).batches[0].items[0].audio_refs, null, 'do not invent old pronunciation snapshots');
});

test('v41 migration failure rolls back version and remains retryable', async t => {
  const ctx = await fixture(t);
  ctx.db.exec('ALTER TABLE word_study_items DROP COLUMN audio_refs'); ctx.db.pragma('user_version = 40');
  const broken = new Proxy(ctx.db, { get(target,key) {
    if (key === 'exec') return sql => { if (sql.includes('ADD COLUMN audio_refs')) throw new Error('injected audio migration'); return target.exec(sql); };
    const value = Reflect.get(target,key); return typeof value === 'function' ? value.bind(target) : value;
  } });
  assert.throws(() => initDb(broken), /injected audio migration/);
  assert.equal(ctx.db.pragma('user_version',{simple:true}),40); assert.equal(ctx.db.pragma('foreign_keys',{simple:true}),1);
  initDb(ctx.db); assert.equal(ctx.db.pragma('user_version',{simple:true}),SCHEMA_VERSION);
});
