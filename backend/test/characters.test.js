const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { createTestApp, cleanupTestApp } = require('./helper');

describe('Characters API (/api/characters)', () => {
  let ctx;

  afterEach(() => {
    if (ctx) cleanupTestApp(ctx);
  });

  test('Create character, query, toggle mastered, and delete', async () => {
    ctx = createTestApp();

    // 1. Create a child
    const childRes = await ctx.app.inject({
      method: 'POST',
      url: '/api/children',
      payload: { name: '小明' }
    });
    assert.equal(childRes.statusCode, 201);
    const child = JSON.parse(childRes.body);

    // 2. Add character to child's character book
    const createRes = await ctx.app.inject({
      method: 'POST',
      url: '/api/characters',
      payload: {
        child_id: child.id,
        char: '学',
        pinyin: 'xué',
        strokes: 8,
        radical: '子'
      }
    });
    assert.equal(createRes.statusCode, 201);
    const charRecord = JSON.parse(createRes.body);
    assert.ok(charRecord.id);
    assert.equal(charRecord.child_id, child.id);
    assert.equal(charRecord.char, '学');
    assert.equal(charRecord.pinyin, 'xué');
    assert.equal(charRecord.strokes, 8);
    assert.equal(charRecord.radical, '子');
    assert.equal(charRecord.is_mastered, false);
    assert.equal(charRecord.mastered_at, null);
    assert.ok(charRecord.created_at);

    // 3. Get single character
    const getRes = await ctx.app.inject({
      method: 'GET',
      url: `/api/characters/${charRecord.id}`
    });
    assert.equal(getRes.statusCode, 200);
    const got = JSON.parse(getRes.body);
    assert.equal(got.id, charRecord.id);
    assert.equal(got.char, '学');

    // 4. List characters by child_id
    const listRes = await ctx.app.inject({
      method: 'GET',
      url: `/api/characters?child_id=${child.id}`
    });
    assert.equal(listRes.statusCode, 200);
    const list = JSON.parse(listRes.body);
    assert.equal(list.length, 1);
    assert.equal(list[0].id, charRecord.id);

    // 5. Toggle mastered state (without payload -> toggle to true)
    const toggleRes = await ctx.app.inject({
      method: 'PUT',
      url: `/api/characters/${charRecord.id}/master`
    });
    assert.equal(toggleRes.statusCode, 200);
    const toggled = JSON.parse(toggleRes.body);
    assert.equal(toggled.is_mastered, true);
    assert.ok(toggled.mastered_at);

    // 6. Explicitly set mastered state to false
    const unmasterRes = await ctx.app.inject({
      method: 'PUT',
      url: `/api/characters/${charRecord.id}/master`,
      payload: { is_mastered: false }
    });
    assert.equal(unmasterRes.statusCode, 200);
    const unmastered = JSON.parse(unmasterRes.body);
    assert.equal(unmastered.is_mastered, false);
    assert.equal(unmastered.mastered_at, null);

    // 7. Delete character
    const delRes = await ctx.app.inject({
      method: 'DELETE',
      url: `/api/characters/${charRecord.id}`
    });
    assert.equal(delRes.statusCode, 200);
    assert.deepEqual(JSON.parse(delRes.body), { success: true, id: charRecord.id });

    // 8. Verify character deleted
    const getDeletedRes = await ctx.app.inject({
      method: 'GET',
      url: `/api/characters/${charRecord.id}`
    });
    assert.equal(getDeletedRes.statusCode, 404);
  });

  test('Validates input requirements (single char, child_id, duplicate constraint)', async () => {
    ctx = createTestApp();

    const childRes = await ctx.app.inject({
      method: 'POST',
      url: '/api/children',
      payload: { name: '小红' }
    });
    const child = JSON.parse(childRes.body);

    // Missing child_id
    const missingChildRes = await ctx.app.inject({
      method: 'POST',
      url: '/api/characters',
      payload: { char: '好' }
    });
    assert.equal(missingChildRes.statusCode, 400);

    // Non-existent child_id
    const nonexistentChildRes = await ctx.app.inject({
      method: 'POST',
      url: '/api/characters',
      payload: { child_id: 'nonexistent-id', char: '好' }
    });
    assert.equal(nonexistentChildRes.statusCode, 404);

    // Missing char
    const missingCharRes = await ctx.app.inject({
      method: 'POST',
      url: '/api/characters',
      payload: { child_id: child.id }
    });
    assert.equal(missingCharRes.statusCode, 400);

    // Entries are 1 to 8 Chinese characters: words are allowed, other text and longer phrases are not.
    for (const invalid of ['ab', '学a', '一二三四五六七八九']) {
      const invalidRes = await ctx.app.inject({
        method: 'POST',
        url: '/api/characters',
        payload: { child_id: child.id, char: invalid }
      });
      assert.equal(invalidRes.statusCode, 400, invalid);
    }

    // Empty/whitespace char validation
    const emptyCharRes = await ctx.app.inject({
      method: 'POST',
      url: '/api/characters',
      payload: { child_id: child.id, char: '   ' }
    });
    assert.equal(emptyCharRes.statusCode, 400);

    // First creation succeeds
    const okRes = await ctx.app.inject({
      method: 'POST',
      url: '/api/characters',
      payload: { child_id: child.id, char: '好', pinyin: 'hǎo', strokes: 6, radical: '女' }
    });
    assert.equal(okRes.statusCode, 201);

    // Duplicate creation for the same child returns 409
    const dupRes = await ctx.app.inject({
      method: 'POST',
      url: '/api/characters',
      payload: { child_id: child.id, char: '好' }
    });
    assert.equal(dupRes.statusCode, 409);
  });

  test('Multi-child data isolation and filtering by is_mastered and sorting by created_at DESC', async () => {
    ctx = createTestApp();

    const child1Res = await ctx.app.inject({
      method: 'POST',
      url: '/api/children',
      payload: { name: '孩子一' }
    });
    const child1 = JSON.parse(child1Res.body);

    const child2Res = await ctx.app.inject({
      method: 'POST',
      url: '/api/children',
      payload: { name: '孩子二' }
    });
    const child2 = JSON.parse(child2Res.body);

    // Both children can add the same character '春' independently
    const c1Res = await ctx.app.inject({
      method: 'POST',
      url: '/api/characters',
      payload: { child_id: child1.id, char: '春', pinyin: 'chūn', strokes: 9, radical: '日' }
    });
    assert.equal(c1Res.statusCode, 201);
    const c1 = JSON.parse(c1Res.body);

    const c2Res = await ctx.app.inject({
      method: 'POST',
      url: '/api/characters',
      payload: { child_id: child2.id, char: '春', pinyin: 'chūn', strokes: 9, radical: '日' }
    });
    assert.equal(c2Res.statusCode, 201);

    // Add another character for child 1
    const c1BRes = await ctx.app.inject({
      method: 'POST',
      url: '/api/characters',
      payload: { child_id: child1.id, char: '雨', pinyin: 'yǔ', strokes: 8, radical: '雨' }
    });
    assert.equal(c1BRes.statusCode, 201);
    const c1B = JSON.parse(c1BRes.body);

    // Mark c1 ('春') as mastered
    await ctx.app.inject({
      method: 'PUT',
      url: `/api/characters/${c1.id}/master`,
      payload: { is_mastered: true }
    });

    // List child 1 characters (should have 2, sorted created_at DESC)
    const listChild1 = await ctx.app.inject({
      method: 'GET',
      url: `/api/characters?child_id=${child1.id}`
    });
    assert.equal(listChild1.statusCode, 200);
    const items1 = JSON.parse(listChild1.body);
    assert.equal(items1.length, 2);
    // '雨' was created after '春', so it should be first
    assert.equal(items1[0].char, '雨');
    assert.equal(items1[1].char, '春');

    // Filter child 1 by is_mastered=1
    const listMastered = await ctx.app.inject({
      method: 'GET',
      url: `/api/characters?child_id=${child1.id}&is_mastered=1`
    });
    assert.equal(listMastered.statusCode, 200);
    const masteredItems = JSON.parse(listMastered.body);
    assert.equal(masteredItems.length, 1);
    assert.equal(masteredItems[0].char, '春');
    assert.equal(masteredItems[0].is_mastered, true);

    // Filter child 1 by is_mastered=0
    const listUnmastered = await ctx.app.inject({
      method: 'GET',
      url: `/api/characters?child_id=${child1.id}&is_mastered=0`
    });
    assert.equal(listUnmastered.statusCode, 200);
    const unmasteredItems = JSON.parse(listUnmastered.body);
    assert.equal(unmasteredItems.length, 1);
    assert.equal(unmasteredItems[0].char, '雨');
    assert.equal(unmasteredItems[0].is_mastered, false);

    // Child 2 character list should only have 1 character
    const listChild2 = await ctx.app.inject({
      method: 'GET',
      url: `/api/characters?child_id=${child2.id}`
    });
    assert.equal(listChild2.statusCode, 200);
    const items2 = JSON.parse(listChild2.body);
    assert.equal(items2.length, 1);
    assert.equal(items2[0].char, '春');
    assert.equal(items2[0].is_mastered, false); // Child 2's '春' is still unmastered!

    // Missing child_id query returns 400
    const noChildQuery = await ctx.app.inject({
      method: 'GET',
      url: '/api/characters'
    });
    assert.equal(noChildQuery.statusCode, 400);
  });

  test('Cascade deletion when child is deleted', async () => {
    ctx = createTestApp();

    const childRes = await ctx.app.inject({
      method: 'POST',
      url: '/api/children',
      payload: { name: '小芳' }
    });
    const child = JSON.parse(childRes.body);

    const charRes = await ctx.app.inject({
      method: 'POST',
      url: '/api/characters',
      payload: { child_id: child.id, char: '花' }
    });
    assert.equal(charRes.statusCode, 201);
    const charItem = JSON.parse(charRes.body);

    // Delete child
    const delChildRes = await ctx.app.inject({
      method: 'DELETE',
      url: `/api/children/${child.id}`
    });
    assert.equal(delChildRes.statusCode, 200);

    // Character should be cascaded and deleted
    const getCharRes = await ctx.app.inject({
      method: 'GET',
      url: `/api/characters/${charItem.id}`
    });
    assert.equal(getCharRes.statusCode, 404);
  });

  test('Words are stored without stroke count or radical and keep their own pinyin', async () => {
    ctx = createTestApp();
    const child = (await ctx.app.inject({ method: 'POST', url: '/api/children', payload: { name: '伊伊' } })).json();
    const word = await ctx.app.inject({
      method: 'POST',
      url: '/api/characters',
      payload: { child_id: child.id, char: ' 银行 ', pinyin: 'yín háng', strokes: 11, radical: '钅', categories: ['write'] }
    });
    assert.equal(word.statusCode, 201, word.body);
    assert.deepEqual(
      [word.json().char, word.json().pinyin, word.json().strokes, word.json().radical, word.json().categories],
      ['银行', 'yín háng', null, null, ['write']]
    );
    // A word and its characters are separate entries.
    assert.equal((await ctx.app.inject({ method: 'POST', url: '/api/characters', payload: { child_id: child.id, char: '银' } })).statusCode, 201);
    assert.equal((await ctx.app.inject({ method: 'POST', url: '/api/characters', payload: { child_id: child.id, char: '银行' } })).statusCode, 409);
    assert.equal((await ctx.app.inject({ method: 'POST', url: '/api/characters', payload: { child_id: child.id, char: '一心一意' } })).statusCode, 201);
  });

  test('Categories: listed in a fixed order, filterable, added by children and removed only by parents', async () => {
    ctx = createTestApp();
    const child = (await ctx.app.inject({ method: 'POST', url: '/api/children', payload: { name: '伊伊' } })).json();
    const other = (await ctx.app.inject({ method: 'POST', url: '/api/children', payload: { name: '成成' } })).json();
    const create = (char, categories) => ctx.app.inject({ method: 'POST', url: '/api/characters', payload: { child_id: child.id, char, categories } });
    const swallow = (await create('燕', ['error_prone', 'recognize'])).json();
    await create('春天', ['write']);
    await create('雨');
    assert.deepEqual(swallow.categories, ['recognize', 'error_prone']);
    assert.equal((await create('风', ['bogus'])).statusCode, 400);

    const list = category => ctx.app.inject({ method: 'GET', url: `/api/characters?child_id=${child.id}${category ? `&category=${category}` : ''}` });
    assert.deepEqual((await list()).json().map(entry => [entry.char, entry.categories]), [['雨', []], ['春天', ['write']], ['燕', ['recognize', 'error_prone']]]);
    assert.deepEqual((await list('error_prone')).json().map(entry => entry.char), ['燕']);
    assert.equal((await list('bogus')).statusCode, 400);

    // The child signs in on their own: adding a category works, removing one does not.
    const childToken = (await ctx.rawInject({ method: 'POST', url: '/api/auth/child-login', payload: { child_id: child.id } })).json().token;
    const asChild = (id, categories) => ctx.rawInject({ method: 'PUT', url: `/api/characters/${id}/categories`, headers: { authorization: `Bearer ${childToken}` }, payload: { categories } });
    const added = await asChild(swallow.id, ['recognize', 'error_prone', 'fix_strokes']);
    assert.equal(added.statusCode, 200, added.body);
    assert.deepEqual(added.json().categories, ['recognize', 'fix_strokes', 'error_prone']);
    const removed = await asChild(swallow.id, ['recognize', 'error_prone']);
    assert.equal(removed.statusCode, 403);
    assert.match(removed.json().error, /只有家长/);
    assert.equal((await asChild(swallow.id, [])).statusCode, 403);
    // Another child's entries are off limits.
    const otherEntry = (await ctx.app.inject({ method: 'POST', url: '/api/characters', payload: { child_id: other.id, char: '月' } })).json();
    assert.equal((await asChild(otherEntry.id, ['write'])).statusCode, 403);

    // Removing the whole entry would drop its categories as well.
    const asChildDelete = id => ctx.rawInject({ method: 'DELETE', url: `/api/characters/${id}`, headers: { authorization: `Bearer ${childToken}` } });
    assert.equal((await asChildDelete(swallow.id)).statusCode, 403);
    const plain = (await list()).json().find(entry => entry.char === '雨');
    assert.equal((await asChildDelete(plain.id)).statusCode, 200);

    // Parents may remove.
    const cleared = await ctx.app.inject({ method: 'PUT', url: `/api/characters/${swallow.id}/categories`, payload: { categories: ['recognize'] } });
    assert.deepEqual(cleared.json().categories, ['recognize']);
    assert.equal((await ctx.app.inject({ method: 'PUT', url: '/api/characters/missing/categories', payload: { categories: [] } })).statusCode, 404);
  });
});
