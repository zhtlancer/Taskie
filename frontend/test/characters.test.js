import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// Mock localStorage for mockStore
class MockLocalStorage {
  constructor() {
    this.store = new Map();
  }
  getItem(key) {
    return this.store.has(key) ? this.store.get(key) : null;
  }
  setItem(key, value) {
    this.store.set(key, String(value));
  }
  removeItem(key) {
    this.store.delete(key);
  }
  clear() {
    this.store.clear();
  }
}

globalThis.localStorage = new MockLocalStorage();

// Import modules
const { getCharPinyin, getCharRadical, getCharStrokes, charDataLoader } = await import('../src/utils/hanzi.js');
const { mockStore } = await import('../src/api/mockStore.js');

describe('Chinese Characters Utilities & Literacy Engine', () => {
  test('getCharPinyin extracts tone-marked pinyin correctly', () => {
    assert.strictEqual(getCharPinyin('学'), 'xué');
    assert.strictEqual(getCharPinyin('生'), 'shēng');
    assert.strictEqual(getCharPinyin('春'), 'chūn');
    assert.strictEqual(getCharPinyin('笔'), 'bǐ');
    assert.strictEqual(getCharPinyin('画'), 'huà');
    assert.strictEqual(getCharPinyin(''), '');
  });

  test('getCharRadical identifies radical and structure', () => {
    const xue = getCharRadical('学');
    assert.strictEqual(xue.radical, '子');
    assert.strictEqual(xue.struct, '上下结构');

    const han = getCharRadical('汉');
    assert.strictEqual(han.radical, '氵');
    assert.strictEqual(han.struct, '左右结构');

    const mao = getCharRadical('猫');
    assert.strictEqual(mao.radical, '犭');
    assert.strictEqual(mao.struct, '左右结构');

    const ri = getCharRadical('日');
    assert.strictEqual(ri.radical, '日');
    assert.strictEqual(ri.struct, '独体结构');
  });

  test('getCharStrokes counts total strokes accurately', () => {
    assert.strictEqual(getCharStrokes('学'), 8);
    assert.strictEqual(getCharStrokes('生'), 5);
    assert.strictEqual(getCharStrokes('日'), 4);
    assert.strictEqual(getCharStrokes('春'), 9);
    assert.strictEqual(getCharStrokes(''), 0);
  });

  test('charDataLoader loads pre-bundled characters synchronously/offline', (t, done) => {
    charDataLoader('学', (data) => {
      assert.ok(data);
      assert.strictEqual(data.strokes.length, 8);
      assert.ok(Array.isArray(data.medians));
      done();
    }, (err) => {
      done(err);
    });
  });
});

describe('MockStore Character Book CRUD & Offline Resilience', () => {
  const testChildId = 'child-test-101';

  beforeEach(() => {
    globalThis.localStorage.clear();
    mockStore.load();
  });

  test('Initial state contains default characters for demo student', () => {
    const list = mockStore.getCharacters('child-demo-1');
    assert.ok(list.length >= 5, 'Should have preset characters');
    const xue = list.find(c => c.char === '学');
    assert.ok(xue, 'Contains 学');
    assert.strictEqual(xue.is_mastered, true);
  });

  test('Create new character and prevent duplicate addition', () => {
    const added = mockStore.createCharacter({
      child_id: testChildId,
      char: '花',
      pinyin: 'huā',
      strokes: 7,
      radical: '艹',
    });

    assert.ok(added.id);
    assert.strictEqual(added.char, '花');
    assert.strictEqual(added.is_mastered, false);

    // Duplicate check
    assert.throws(() => {
      mockStore.createCharacter({
        child_id: testChildId,
        char: '花',
        pinyin: 'huā',
      });
    }, (err) => {
      return err.status === 409 || err.message.includes('已在生字本');
    });
  });

  test('Filter characters by mastery status', () => {
    mockStore.createCharacter({ child_id: testChildId, char: '山', pinyin: 'shān', strokes: 3 });
    mockStore.createCharacter({ child_id: testChildId, char: '水', pinyin: 'shuǐ', strokes: 4 });

    const all = mockStore.getCharacters(testChildId);
    assert.strictEqual(all.length, 2);

    const learning = mockStore.getCharacters(testChildId, 0);
    assert.strictEqual(learning.length, 2);

    // Mark one mastered
    mockStore.markCharacterMastered(all[0].id, true);

    const mastered = mockStore.getCharacters(testChildId, 1);
    assert.strictEqual(mastered.length, 1);
    assert.strictEqual(mastered[0].id, all[0].id);
    assert.ok(mastered[0].mastered_at);
  });

  test('Toggle mastery status dynamically', () => {
    const item = mockStore.createCharacter({ child_id: testChildId, char: '木', pinyin: 'mù', strokes: 4 });
    assert.strictEqual(item.is_mastered, false);

    const switched1 = mockStore.markCharacterMastered(item.id);
    assert.strictEqual(switched1.is_mastered, true);
    assert.ok(switched1.mastered_at);

    const switched2 = mockStore.markCharacterMastered(item.id);
    assert.strictEqual(switched2.is_mastered, false);
    assert.strictEqual(switched2.mastered_at, null);
  });

  test('Delete character from book', () => {
    const item = mockStore.createCharacter({ child_id: testChildId, char: '鸟', pinyin: 'niǎo', strokes: 5 });
    const beforeList = mockStore.getCharacters(testChildId);
    assert.ok(beforeList.some(c => c.id === item.id));

    mockStore.deleteCharacter(item.id);
    const afterList = mockStore.getCharacters(testChildId);
    assert.strictEqual(afterList.some(c => c.id === item.id), false);
  });
});
