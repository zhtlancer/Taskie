const { useLocalLearningFont } = require('./word-book-fonts.cjs');
// New word-book flows against the production image and an isolated tmpfs database.
// Device authorization is covered separately by smoke-browser.cjs.
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { launchBrowser } = require('./browser-env.cjs');
const { reportBrowserFailure } = require('./browser-diagnostics.cjs');
const name = `taskie-word-books-${randomUUID()}`;
const docker = (args) =>
  execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
let started = false,
  browser,
  token,
  generation;
async function main() {
  docker([
    'run',
    '-d',
    '--name',
    name,
    '--tmpfs',
    '/app/data',
    '-e',
    'DEVICE_AUTH=off',
    '-e',
    'DICT_DIR=off',
    '-e',
    'BACKUP_INTERVAL_HOURS=0',
    '-p',
    '127.0.0.1::3000',
    process.env.TASKIE_TEST_IMAGE || 'taskie:reliability',
  ]);
  started = true;
  const base = `http://${docker(['port', name, '3000/tcp']).split('\n')[0]}`;
  let ready = false;
  for (let i = 0; i < 150; i++) {
    try {
      ready = (await fetch(`${base}/api/health`)).ok;
    } catch {}
    if (ready) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(ready, 'production image starts');
  assert.equal(docker(['exec', name, 'stat', '-c', '%u', '/proc/1']), '1000');
  async function call(method, path, body) {
    const response = await fetch(`${base}/api${path}`, {
      method,
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(generation ? { 'X-Taskie-Data-Generation': generation } : {}),
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    assert.ok(response.ok, `${method} ${path}: ${await response.clone().text()}`);
    return response.json();
  }
  let login = await call('POST', '/auth/parent-login', { pin: '1234' });
  token = login.token;
  generation = login.data_generation;
  await call('PUT', '/auth/parent-pin', { old_pin: '1234', new_pin: '2580' });
  login = await call('POST', '/auth/parent-login', { pin: '2580' });
  token = login.token;
  generation = login.data_generation;
  const child = await call('POST', '/children', { name: '容器词本验收' });
  const book = async (name, language = 'zh') =>
    call('POST', '/word-books', { child_id: child.id, language, name, request_id: randomUUID() });
  const zh = await book('语文教材'),
    poly = await book('另一读音'),
    en = await book('英语教材', 'en');
  const preview = await call('POST', '/characters/batch-preview', {
    child_id: child.id,
    book_id: zh.id,
    text: '长\tchang2\n银行',
  });
  assert.equal(
    preview.items.find((item) => item.char === '银行').pinyin,
    'yín háng',
    'production pinyin dependency loads',
  );
  const body = {
    child_id: child.id,
    book_id: zh.id,
    request_id: randomUUID(),
    items: [
      { char: '长', pinyin: 'chang2' },
      { char: '银行', pinyin: '' },
    ],
  };
  const imported = await call('POST', '/characters/batch', body);
  assert.equal(imported.added_count, 2);
  assert.deepEqual(await call('POST', '/characters/batch', body), imported);
  const long = (await call('GET', `/word-books/${zh.id}/items`)).items.find((item) => item.text === '长');
  await call('POST', `/word-books/${poly.id}/items`, {
    character_id: long.character_id,
    pinyin_override: 'zhang3',
    request_id: randomUUID(),
  });
  const english = await call('POST', '/english-words/batch', {
    child_id: child.id,
    book_id: en.id,
    request_id: randomUUID(),
    items: [{ word: 'May', definition_zh: '五月', strict_case: true }],
  });
  assert.equal(english.added_count, 1);
  await call('PUT', `/children/${child.id}/word-study/plans/recognize`, {
    enabled: true,
    days_of_week: [0, 1, 2, 3, 4, 5, 6],
    new_target: 10,
    review_target: 10,
    scope_mode: 'books',
    book_ids: [poly.id, zh.id],
  });
  const day = (await call('GET', `/children/${child.id}/word-study`)).days[0];
  assert.equal(day.base_total, 2);
  assert.equal(day.batches[0].items.find((item) => item.text === '长').pinyin, 'zhǎng');
  const snapshot = () =>
    JSON.parse(
      docker([
        'exec',
        '-u',
        '1000:1000',
        '-w',
        '/app/backend',
        name,
        'node',
        '-e',
        `const db=require('better-sqlite3')('/app/data/data.sqlite',{readonly:true});console.log(JSON.stringify(Object.fromEntries(['word_study_states','word_study_days','word_study_items','daily_tasks','point_logs'].map(t=>[t,db.prepare('SELECT * FROM '+t+' ORDER BY rowid').all()]))));db.close();`,
      ]),
    );
  const before = snapshot(),
    test = await call('POST', '/word-tests', {
      child_id: child.id,
      language: 'zh',
      skill: 'recognize',
      book_ids: [zh.id, poly.id],
      request_id: randomUUID(),
    });
  assert.equal(test.total_count, 3);
  for (const item of test.items) {
    const answer = { result: item.position ? 'correct' : 'wrong', request_id: randomUUID() };
    await call('POST', `/word-tests/${test.id}/items/${item.id}/answer`, answer);
    await call('POST', `/word-tests/${test.id}/items/${item.id}/answer`, answer);
  }
  assert.deepEqual(snapshot(), before, 'self-tests do not write daily study, tasks or points');
  const completed = await call('GET', `/word-tests/${test.id}`);
  assert.equal(completed.correct_count, 2);
  assert.equal(completed.status, 'completed');
  const retryBody = { request_id: randomUUID() },
    retry = await call('POST', `/word-tests/${test.id}/retry-wrong`, retryBody);
  assert.equal((await call('POST', `/word-tests/${test.id}/retry-wrong`, retryBody)).id, retry.id);
  browser = await launchBrowser();
  const context = await browser.newContext({ viewport: { width: 820, height: 1180 }, colorScheme: 'dark' });
  await useLocalLearningFont(context);
  await context.addInitScript(
    ({ token, generation }) => {
      sessionStorage.setItem('taskie_parent_token', token);
      sessionStorage.setItem('taskie_data_generation', generation);
    },
    { token, generation },
  );
  const page = await context.newPage();
  await page.goto(`${base}/child/${child.id}/word-test?test=${test.id}`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: '自测已完成 · 67%', exact: true }).waitFor();
  const shared = await call('POST', '/word-tests', {
    child_id: child.id,
    language: 'zh',
    skill: 'recognize',
    book_ids: [zh.id],
    request_id: randomUUID(),
  });
  await page.goto(`${base}/child/${child.id}/word-test?test=${shared.id}`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: '揭晓拼音', exact: true }).click();
  await call('POST', `/word-tests/${shared.id}/items/${shared.items[1].id}/answer`, {
    result: 'wrong',
    request_id: randomUUID(),
  });
  await page.getByRole('button', { name: '记住了', exact: true }).click();
  await page
    .getByRole('region', { name: '自测结果', exact: true })
    .getByText(/需复习\s+1\s+题/)
    .waitFor();
  assert.deepEqual(
    snapshot(),
    before,
    'the tablet self-test flow also leaves daily learning and rewards untouched',
  );
  const archive = await call('POST', '/backups');
  const download = await fetch(`${base}/api/backups/${archive.name}/download`, {
    headers: { authorization: `Bearer ${token}` },
  });
  assert.ok(download.ok);
  const data = await download.arrayBuffer();
  await call('DELETE', `/word-books/${zh.id}`, { expected_version: zh.version });
  assert.equal((await call('GET', `/word-tests/${test.id}`)).total_count, 3);
  const form = new FormData();
  form.append('pin', '2580');
  form.append('file', new Blob([data]), 'word-books.taskie.gz');
  const restore = await fetch(`${base}/api/backups/restore`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: form,
  });
  assert.ok(restore.ok, await restore.clone().text());
  const old = await fetch(`${base}/api/word-tests/${test.id}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(old.status, 401);
  token = null;
  generation = null;
  login = await call('POST', '/auth/parent-login', { pin: '2580' });
  token = login.token;
  generation = login.data_generation;
  assert.deepEqual(await call('GET', `/word-tests/${test.id}`), completed);
  assert.equal((await call('GET', `/word-books/${zh.id}/items`)).total, 2);
  assert.deepEqual(await call('POST', '/characters/batch', body), imported);
  await context.close();
  console.log(
    'PASS production image: ordinary user, bilingual imports, pinyin, scoped day, independent tests, idempotency, tablet concurrent results and current backup restore',
  );
}
main()
  .catch(async (error) => {
    console.error(error);
    await reportBrowserFailure('docker-word-books', error, browser);
    if (started) {
      try {
        console.error(docker(['logs', '--tail', '25', name]));
      } catch (logError) {
        console.error(logError.message);
      }
    }
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      if (browser) await browser.close();
    } finally {
      if (started) docker(['rm', '-f', name]);
    }
  });
