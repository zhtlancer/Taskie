import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRenderer, ref } from 'vue';
import { useAsyncScope } from '../src/composables/useAsyncScope.js';

function fixture(t) {
  const storage = new Map([['taskie_parent_token', 'parent-session']]);
  const previousGlobals = new Map();
  for (const [key, value] of Object.entries({
    sessionStorage: { getItem: key => storage.get(key) ?? null },
    window: new EventTarget()
  })) {
    previousGlobals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { value, configurable: true });
  }
  const owner = ref('child-a');
  let scope;
  const renderer = createRenderer({ insert() {}, remove() {}, createComment: () => ({}) });
  const app = renderer.createApp({
    setup() { scope = useAsyncScope(() => [owner.value]); return () => null; }
  });
  app.mount({});
  let mounted = true;
  const unmount = () => { if (mounted) { app.unmount(); mounted = false; } };
  t.after(() => {
    unmount();
    for (const [key, previous] of previousGlobals) {
      if (previous) Object.defineProperty(globalThis, key, previous);
      else delete globalThis[key];
    }
  });
  return { storage, owner, capture: () => scope.capture(), unmount };
}

test('an unknown generation may calibrate once without discarding a current callback', t => {
  const { storage, capture } = fixture(t);
  const current = capture();
  assert.equal(current(), true, 'calibration is still pending');
  storage.set('taskie_data_generation', 'generation-a');
  assert.equal(current(), true, 'first calibration belongs to this request');
  storage.set('taskie_data_generation', 'generation-b');
  assert.equal(current(), false, 'a later change of the known generation is stale');

  const known = capture();
  storage.delete('taskie_data_generation');
  assert.equal(known(), false, 'clearing an already known generation is not calibration');
});

test('calibration never revives callbacks invalidated by scope, session, restore or unmount', t => {
  const { storage, owner, capture, unmount } = fixture(t);
  for (const event of ['taskie:data-restored', 'taskie:session-changed']) {
    storage.delete('taskie_data_generation');
    const obsolete = capture();
    window.dispatchEvent(new Event(event));
    storage.set('taskie_data_generation', 'calibrated');
    assert.equal(obsolete(), false, `${event} supersedes initial calibration`);
  }
  const oldOwner = capture();
  owner.value = 'child-b';
  assert.equal(oldOwner(), false);
  const oldSession = capture();
  storage.set('taskie_parent_token', 'new-session');
  assert.equal(oldSession(), false);
  const oldComponent = capture();
  unmount();
  assert.equal(oldComponent(), false);
});
