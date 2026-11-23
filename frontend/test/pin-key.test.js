import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pinKeyAction } from '../src/utils/pinKey.js';

test('pinKeyAction accepts digits, Backspace and Delete while ignoring modifiers, repeats and editable targets', () => {
  for (const digit of ['0', '1', '5', '9']) {
    assert.deepEqual(pinKeyAction({ key: digit, target: { tagName: 'BODY' } }), { type: 'digit', value: digit });
  }
  assert.deepEqual(pinKeyAction({ key: 'Backspace', repeat: true, target: { tagName: 'BUTTON' } }), { type: 'backspace' });
  assert.deepEqual(pinKeyAction({ key: 'Delete', target: { tagName: 'DIV' } }), { type: 'clear' });

  for (const ignored of [
    { key: '1', repeat: true },
    { key: '1', ctrlKey: true },
    { key: '1', metaKey: true },
    { key: '1', altKey: true },
    { key: '1', isComposing: true },
    { key: '1', keyCode: 229 },
    { key: '1', defaultPrevented: true },
    { key: '1', target: { tagName: 'INPUT' } },
    { key: 'Backspace', target: { tagName: 'TEXTAREA' } },
    { key: 'Delete', target: { tagName: 'SELECT' } },
    { key: '2', target: { tagName: 'DIV', isContentEditable: true } },
    { key: 'Enter', target: { tagName: 'BUTTON' } },
    { key: ' ', target: { tagName: 'BUTTON' } },
    { key: 'Escape', target: { tagName: 'BODY' } },
    { key: 'a', target: { tagName: 'BODY' } }
  ]) {
    assert.equal(pinKeyAction(ignored), null);
  }
});
