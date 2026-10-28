import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formDraftStore, formDraftScope, DRAFT_PREFIX, DRAFT_TTL, restoreFormFields } from '../src/utils/formDrafts.js';
const memory = () => { const data = new Map(); return { get length() { return data.size; }, key: i => [...data.keys()][i], getItem: k => data.get(k) ?? null, setItem: (k,v) => data.set(k,String(v)), removeItem: k => data.delete(k) }; };
const token = (role, child_id, epoch = 'family') => `a.${Buffer.from(JSON.stringify({ role, child_id, epoch, exp: Date.now()/1000+3600 })).toString('base64url')}.signature`;
const scope = (role = 'parent', child_id = 'a', generation = 'initial', kind = 'homework', record_id = null) => formDraftScope(token(role, child_id), generation, {kind, child_id, record_id});
test('drafts isolate roles, children, forms, records, installations and restored data', () => {
  const storage = memory(), store = formDraftStore(storage);
  const original = scope(); const entry = store.save(original, { form: { content: '家长私有草稿' } }, null);
  assert.equal(store.read(original).payload.form.content, '家长私有草稿');
  for (const other of [scope('child'), scope('parent','b'), scope('parent','a','restored'), scope('parent','a','initial','mistake'), scope('parent','a','initial','homework','record')]) assert.equal(store.read(other), null);
  assert.equal(formDraftScope(token('child','a'), 'initial', {kind:'homework', child_id:'b'}), null);
  assert.equal(formDraftScope(token('parent','a', 'other-family'), 'initial', {kind:'homework',child_id:'a'}).epoch, 'other-family');
  assert.equal(store.read({...original,epoch:'other-family'}), null);
  assert.equal(store.remove(original,entry.revision), true);
});
test('expiry and pruning touch only draft keys; malformed entries do not become submissions', () => {
  let now = 10000; const storage=memory(), store=formDraftStore(storage,()=>now);
  storage.setItem('unrelated-setting','keep'); store.save(scope(),{form:{content:'old'}},null);
  now += DRAFT_TTL; assert.equal(store.read(scope()),null); assert.equal(storage.getItem('unrelated-setting'),'keep');
  const entry = store.save(scope(),{form:{content:'new'}},null);
  const key=Array.from({length:storage.length},(_,i)=>storage.key(i)).find(k=>k.startsWith(DRAFT_PREFIX));
  storage.setItem(key,'broken'); assert.equal(store.read(scope()),null);
  assert.equal(store.remove(scope(),entry.revision),false);
  store.save(scope(),{form:{content:'clear me'}},null);store.clearAll();
  assert.equal(storage.length,1);assert.equal(storage.getItem('unrelated-setting'),'keep');
});
test('a second tab cannot silently overwrite or delete a newer draft or pending submission', () => {
  const storage=memory(), store=formDraftStore(storage), target=scope();
  const first=store.save(target,{form:{content:'first'}},null);
  const second=store.save(target,{form:{content:'second'}},first.revision,{request_id:'fixed_request_id',body:{content:'second'}});
  assert.throws(()=>store.save(target,{form:{content:'stale'}},first.revision),e=>e.draftConflict);
  assert.equal(store.remove(target,first.revision),false); assert.equal(store.read(target).attempt.request_id,'fixed_request_id');
  assert.equal(store.read(target).payload.form.content,'second');
});
test('restore accepts only existing fields of compatible types', () => {
  const form={content:'',priority:1,expected_minutes:null};
  restoreFormFields(form,JSON.parse('{"content":"draft","priority":2,"expected_minutes":15,"__proto__":{"polluted":true},"unknown":1}'));
  assert.deepEqual(form,{content:'draft',priority:2,expected_minutes:15}); assert.equal({}.polluted,undefined);
  restoreFormFields(form,{content:{bad:true},priority:'wrong'}); assert.equal(form.content,'draft'); assert.equal(form.priority,2);
});
test('storage errors are explicit and do not delete unrelated settings', () => {
  const storage=memory(), store=formDraftStore(storage); storage.setItem('keep','yes');
  storage.setItem=()=>{throw new Error('quota exceeded');};
  assert.throws(()=>store.save(scope(),{form:{content:'copy this'}},null),/quota/); assert.equal(storage.getItem('keep'),'yes');
});
test('capacity never evicts a live draft or its uncertain submission receipt',()=>{
  const storage=memory(),store=formDraftStore(storage);
  for(let i=0;i<100;i++)store.save(scope('parent',`child-${i}`),{form:{content:`draft-${i}`}},null);
  assert.throws(()=>store.save(scope('parent','overflow'),{form:{content:'new'}},null),/已满/);
  assert.equal(store.read(scope('parent','child-0')).payload.form.content,'draft-0');
  assert.equal(storage.length,100);
});

const { createRenderer, reactive } = await import('vue');
const { useFormDraft } = await import('../src/composables/useFormDraft.js');
const session = await import('../src/utils/session.js');
const editors = new WeakMap();
function environment(t) {
  const cleanups=[]; editors.set(t,[]);
  t.after(()=>{ for(const close of editors.get(t))close(); for(const restore of cleanups)restore(); });
  for (const [key,value] of [['localStorage',memory()],['sessionStorage',memory()],['window',new EventTarget()]]) {
    const previous=Object.getOwnPropertyDescriptor(globalThis,key);
    Object.defineProperty(globalThis,key,{value,configurable:true});
    cleanups.push(()=>{if(previous)Object.defineProperty(globalThis,key,previous);else delete globalThis[key];});
  }
  session.saveToken('parent',token('parent'),'initial');
}
const renderer=createRenderer({createComment:()=>({}),createText:()=>({}),createElement:()=>({}),insert:()=>{},remove:()=>{},parentNode:()=>null,nextSibling:()=>null,setText:()=>{},setElementText:()=>{},patchProp:()=>{}});
function editor(t, invalidated=()=>{}) {
  const form=reactive({content:''});let draft;
  const app=renderer.createApp({setup(){draft=useFormDraft({kind:'homework',child_id:'a'}, {
    read:()=>({form:{...form}}),apply:data=>restoreFormFields(form,data.form),hasContent:data=>Boolean(data.form.content.trim()),invalidated
  });return()=>null;}});
  app.mount({});let mounted=true;const unmount=()=>{if(mounted){app.unmount();mounted=false;}};editors.get(t).push(unmount);return{form,draft,unmount};
}
test('reload recovery retains exact uncertain request and never submits automatically',t=>{
  environment(t); const first=editor(t);first.form.content='没有丢掉的输入';
  const attempt=first.draft.prepare({content:'没有丢掉的输入',due_date:'2026-10-28'});
  first.draft.failed(new Error('network'));first.unmount();
  const second=editor(t);assert.equal(second.draft.available,true);assert.equal(second.form.content,'');
  second.draft.restore();assert.equal(second.form.content,'没有丢掉的输入');assert.equal(second.draft.pending,true);
  const retry=second.draft.prepare({content:'今天的默认值不同',due_date:'2026-10-29'});
  assert.deepEqual(retry,attempt,'retry uses original body even when business date defaults change');
  second.draft.complete();assert.equal(localStorage.length,0);
});
test('failed local persistence does not send or later reuse an obsolete submission body',t=>{
  environment(t);const current=editor(t);current.form.content='初稿';
  const original=localStorage.setItem;
  localStorage.setItem=()=>{throw new Error('quota');};
  assert.throws(()=>current.draft.prepare({content:'初稿'}),/尚未提交/);assert.equal(current.draft.pending,false);
  localStorage.setItem=original;current.form.content='修改后的草稿';
  assert.equal(current.draft.prepare({content:'修改后的草稿'}).body.content,'修改后的草稿');
});
test('validation rejections allow editing; uncertain and deleted-submission rejections retain the attempt',t=>{
  environment(t);const current=editor(t);current.form.content='输入';
  const first=current.draft.prepare({content:'输入'});
  current.draft.failed({status:400});assert.equal(current.draft.pending,false);
  current.form.content='已修正';const next=current.draft.prepare({content:'已修正'});assert.notEqual(next.request_id,first.request_id);
  current.draft.failed({status:409,code:'FORM_SUBMISSION_GONE'});assert.equal(current.draft.pending,true);
  assert.equal(current.draft.prepare({content:'其他'}).request_id,next.request_id);
});
test('account replacement closes the editor and cannot overwrite the former owner draft',t=>{
  environment(t);let closed=0;const current=editor(t,()=>closed++);current.form.content='家长草稿';
  const parentScope=scope();const store=formDraftStore(localStorage);const saved=store.read(parentScope);
  session.saveToken('child',token('child','a'),'initial');current.form.content='孩子的其他输入';
  assert.ok(closed>0);assert.equal(store.read(parentScope).payload.form.content,'家长草稿');
  assert.equal(store.read(scope('child')),null);assert.equal(store.read(parentScope).revision,saved.revision);
});
test('a draft cleared by another tab can be saved again without discarding current input',t=>{
  environment(t);const first=editor(t),second=editor(t);
  first.form.content='第一标签草稿';second.form.content='第二标签输入';assert.equal(second.draft.available,true);
  second.draft.discard();first.form.content='第一标签继续编辑';
  const retry=first.draft.prepare({content:'第一标签继续编辑'});
  assert.equal(retry.body.content,'第一标签继续编辑');
});
