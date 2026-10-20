import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prefersTyping } from '../src/utils/pointer.js';

test('only fine pointers start dialogs in their text field', t => {
  t.after(() => { delete globalThis.matchMedia; });
  globalThis.matchMedia = query => ({ matches: query === '(pointer: fine)' });
  assert.equal(prefersTyping(), true);
  globalThis.matchMedia = () => ({ matches: false });
  assert.equal(prefersTyping(), false, 'touch screens would open their keyboard over quick choices');
  delete globalThis.matchMedia;
  assert.equal(prefersTyping(), true, 'without media queries the field is focused as before');
});
