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

    // Multi-character string validation (单字校验)
    const multiCharRes = await ctx.app.inject({
      method: 'POST',
      url: '/api/characters',
      payload: { child_id: child.id, char: '学习' }
    });
    assert.equal(multiCharRes.statusCode, 400);

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
});
