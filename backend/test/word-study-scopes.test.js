const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { gzipSync, gunzipSync } = require('node:zlib');
const Database = require('better-sqlite3');
const { createTestApp, cleanupTestApp, familyInstant } = require('./helper');
const { getTodayDate, shiftDate } = require('../src/utils/date');
const { initDb, SCHEMA_VERSION } = require('../src/db');
const { validateWordStudyScopes } = require('../src/db/word-study-scope-constraints');
const parent = { role: 'parent' }, weekdays = [0,1,2,3,4,5,6];
async function fixture(t) {
  const c = createTestApp({ dictDir: null }); await c.app.ready();
  t.after(async () => { await c.app.close(); cleanupTestApp(c); c.db.close(); });
  const { childrenService, charactersService: chars, englishWordsService: words, wordBooksService: books, wordStudyService: study } = c.app.services;
  const child = childrenService.createChild({ name: '词本计划甲' }), other = childrenService.createChild({ name: '词本计划乙' });
  const book = (name, language = 'zh', childId = child.id) => books.create({ child_id: childId, language, name }, parent);
  const char = (text, pinyin) => chars.createCharacter({ child_id: child.id, char: text, pinyin });
  const plan = (ids, more = {}, language = 'zh') => study.savePlan(child.id, 'recognize', { scope_mode: 'books', book_ids: ids, days_of_week: weekdays, new_target: 50, review_target: 100, ...more }, language);
  const call = (method, path, payload, actor = parent, headers = {}) => c.app.inject({ method, url: `/api/children/${child.id}/word-study/${path}`, payload,
    headers: { authorization: `Bearer ${c.app.jwt.sign({ ...actor, epoch: c.app.sessionEpoch() })}`, ...headers } });
  return { ...c, child, other, chars, words, books, study, book, char, plan, call };
}
test('book order chooses effective pinyin, deduplicates daily words and changes only subsequent days', async t => {
  const c = await fixture(t), first = c.book('课本'), second = c.book('多音字'), long = c.char('长', 'cháng'), study = c.study;
  c.books.add(first.id, { character_id: long.id, pinyin_override: 'chang2' }, parent);
  c.books.add(second.id, { character_id: long.id, pinyin_override: 'zhang3' }, parent);
  const preview = study.previewScope(c.child.id, 'zh', [first.id, second.id]);
  assert.equal(preview.conflict_count, 1); assert.equal(preview.conflicts[0].chosen.pinyin, 'cháng');
  c.plan([first.id, second.id, first.id]);
  const day = study.today(c.child.id).days[0]; assert.equal(day.base_total, 1); assert.equal(day.batches[0].items[0].pinyin, 'cháng');
  c.plan([second.id, first.id]);
  assert.equal(study.describeDay(day.id).batches[0].items[0].pinyin, 'cháng');
  const item = day.batches[0].items[0]; study.grade(item.id, { result: 'good', request_id: 'scope-first-answer-0001' }, 'child');
  study.grade(item.id, { result: 'good', request_id: 'scope-first-answer-0001' }, 'child');
  assert.equal(c.db.prepare('SELECT COUNT(*) n FROM word_study_states').get().n, 1);
  const tomorrow = shiftDate(getTodayDate(), 1); t.mock.timers.enable({ apis: ['Date'], now: Date.parse(familyInstant(tomorrow)) });
  const next = study.today(c.child.id).days[0]; assert.equal(next.base_total, 1); assert.equal(next.batches[0].items[0].pinyin, 'zhǎng');
  assert.equal(c.chars.getCharacter(long.id).pinyin, 'cháng'); validateWordStudyScopes(c.db);
});
test('day extras retain full frozen membership and pinyin after edits, deletion and newly linked words', async t => {
  const c = await fixture(t), a = c.book('原范围'), b = c.book('第二范围');
  const rows = [['长','chang2'],['行','xing2'],['学','xue2'],['水','shui3']].map(([text,pinyin]) => c.char(text,pinyin));
  for (const row of rows) c.books.add(a.id, { character_id: row.id }, parent);
  c.books.add(b.id, { character_id: rows[0].id }, parent);
  c.plan([a.id,b.id], { new_target: 1 });
  const day = c.study.today(c.child.id).days[0], base = day.batches[0].items[0];
  const frozen = c.db.prepare('SELECT * FROM word_study_day_scope_items WHERE day_id = ?').all(day.id);
  assert.equal(frozen.length, 4);
  const pending = frozen.filter(row => row.source_id !== base.character_id), removed = pending[0], changed = pending[1];
  const membership = c.books.items(a.id, {}, parent).items.find(row => row.character_id === changed.source_id);
  const raw = rows.find(row => row.id === changed.source_id).pinyin;
  c.books.updateItem(a.id, membership.id, { expected_version: 1, pinyin_override: raw.slice(0,-1) + '4' }, parent);
  c.chars.deleteCharacter(removed.source_id, parent);
  const outside = c.char('河', 'he2'); c.books.add(a.id, { character_id: outside.id }, parent);
  assert.equal(c.books.get(a.id, parent).plan_count, 1);
  c.books.remove(a.id, { expected_version: 1 }, parent); c.books.remove(b.id, { expected_version: 1 }, parent);
  const paused = c.study.plans(c.child.id)[0]; assert.equal(paused.scope_mode, 'books'); assert.deepEqual(paused.book_ids, []); assert.equal(paused.scope_invalid, true);
  c.study.grade(base.id, { result: 'good', request_id: 'frozen-base-answer-0001' }, 'child');
  const extra = c.study.extra(day.id, 'frozen-extra-0001').batches.find(batch => batch.is_extra);
  assert.equal(extra.items.length, 2); assert.ok(extra.items.every(item => item.character_id !== outside.id && item.character_id !== removed.source_id));
  assert.equal(extra.items.find(item => item.character_id === changed.source_id).pinyin, changed.pinyin);
  assert.deepEqual(c.study.describeDay(day.id).scope_books.map(book => book.name), ['原范围','第二范围']);
  validateWordStudyScopes(c.db);
  const tomorrow = shiftDate(getTodayDate(),1); t.mock.timers.enable({ apis:['Date'], now:Date.parse(familyInstant(tomorrow)) });
  assert.equal(c.study.today(c.child.id).days.length, 0, 'deleted last book never broadens the next day to all words');
});
test('English book scope excludes missing definitions and additions cannot widen the frozen extra pool', async t => {
  const c = await fixture(t), b = c.book('英语范围','en');
  const make = (word, meaning) => c.words.createWord({ child_id:c.child.id, word, definition_zh:meaning },parent);
  const one = make('apple','苹果'), two = make('book','书'), empty = make('water','');
  for (const row of [one,two,empty]) c.books.add(b.id,{english_word_id:row.id},parent);
  c.plan([b.id], {new_target:1},'en');
  const day = c.study.today(c.child.id,'en').days[0]; assert.equal(day.excluded_no_definition,1);
  c.words.updateWord(empty.id,{definition_zh:'水',expected_version:1},parent);
  const item = day.batches[0].items[0]; c.study.grade(item.id,{result:'good',request_id:'english-scope-base-0001'},'child');
  const extra = c.study.extra(day.id,'english-scope-extra-0001').batches.find(batch=>batch.is_extra);
  assert.equal(extra.items.length,1); assert.notEqual(extra.items[0].english_word_id,empty.id);
  validateWordStudyScopes(c.db);
});
test('all, books and legacy are exclusive; invalid readings, scope IDs, roles and restore queues are guarded', async t => {
  const c = await fixture(t), b=c.book('语文'), en=c.book('英语','en'), alien=c.book('别人','zh',c.other.id), word=c.char('学','invalid');
  c.books.add(b.id,{character_id:word.id},parent);
  const preview = c.study.previewScope(c.child.id,'zh',[b.id]); assert.equal(preview.invalid_count,1);
  c.plan([b.id]); assert.equal(c.study.today(c.child.id).days.length,0);
  assert.equal(c.study.today(c.child.id).plans[0].excluded_invalid_pinyin,1);
  for (const data of [{scope_mode:'books',book_ids:[]},{scope_mode:'books',book_ids:[en.id]},{scope_mode:'books',book_ids:[alien.id]},{scope_mode:'books',book_ids:[b.id],textbook:'混合'},{scope_mode:'all',book_ids:[b.id]},{scope_mode:null},{scope_mode:'legacy'}]) assert.throws(()=>c.study.savePlan(c.child.id,'recognize',data));
  assert.equal((await c.call('PUT','plans/recognize',{scope_mode:'all'}, {role:'child',child_id:c.child.id})).statusCode,403);
  assert.equal((await c.call('POST','zh/book-scope',{book_ids:[alien.id]}, {role:'child',child_id:c.child.id})).statusCode,403);
  assert.equal((await c.call('PUT','plans/recognize',{scope_mode:'all'},parent,{'x-taskie-data-generation':'old'})).statusCode,409);
  const legacy=c.study.savePlan(c.child.id,'recognize',{textbook:'旧教材',units:['U1'],days_of_week:weekdays},'en'); assert.equal(legacy.scope_mode,'legacy');
  const all=c.study.savePlan(c.child.id,'recognize',{scope_mode:'all'},'en'); assert.equal(all.textbook,null); assert.deepEqual(all.units,[]);
});
test('v44 upgrade classifies old filters without invented snapshots, and current/corrupt scopes restore safely', async t => {
  const c=await fixture(t), b=c.book('备份范围'), word=c.char('长','chang2'); c.books.add(b.id,{character_id:word.id,pinyin_override:'zhang3'},parent); c.plan([b.id]);
  const archive=fs.readFileSync(c.app.backupService.getPath((await c.app.backupService.create()).name));
  const parsed=JSON.parse(gunzipSync(archive));
  const candidate=mutate=>{const db=new Database(Buffer.from(parsed.database,'base64'));try{mutate(db);return gzipSync(JSON.stringify({...parsed,database:db.serialize().toString('base64')}));}finally{db.close();}};
  c.books.remove(b.id,{expected_version:1},parent); c.chars.deleteCharacter(word.id,parent); await c.app.backupService.restore(archive); validateWordStudyScopes(c.db);
  for(const change of [db=>db.exec('DROP TABLE word_study_day_scope_items'),db=>db.exec('DROP TRIGGER word_study_day_scope_update'),db=>db.exec("UPDATE word_study_plans SET book_ids='[\"missing\"]'"),db=>db.exec("UPDATE word_study_day_scope_items SET pinyin='invalid3'"),db=>db.exec("UPDATE word_study_days SET scope_books='[]'")]) {
    await assert.rejects(c.app.backupService.restore(candidate(change)),/范围/); validateWordStudyScopes(c.db);
  }
  const before=c.db.prepare('SELECT * FROM word_study_items').all();
  await c.app.backupService.restore(candidate(db=>{require('./legacy-word-study-scope-fixture')(db);db.pragma('user_version=44');}));
  assert.equal(c.db.pragma('user_version',{simple:true}),SCHEMA_VERSION); assert.deepEqual(c.db.prepare('SELECT * FROM word_study_items').all(),before);
  assert.equal(c.db.prepare('SELECT COUNT(*) n FROM word_study_day_scope_items').get().n,0);
  assert.equal(c.study.plans(c.child.id)[0].scope_mode,'all'); validateWordStudyScopes(c.db);
  initDb(c.db); validateWordStudyScopes(c.db);
});
