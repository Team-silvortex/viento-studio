import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dialogHarness, flushDialogs } from './dialog-harness.mjs';
import { deferred } from './editor-harness.mjs';
import { parseScene3DSource } from '../../engine/scene3d.mjs';
import { createScene3DRemovalProposal, isScene3DRemovalProposal, prepareScene3DRemovalApply } from '../../engine/scene3d-removal.mjs';
import { supportsStudioCoreScene3DRemovalPatch } from '../../engine/studio-core.mjs';
import en from '../../web/i18n/en.js';
import ja from '../../web/i18n/ja.js';

const removal = value => JSON.parse(JSON.stringify(value));
const hash = value => 'sha256:' + createHash('sha256').update(value).digest('hex');
const one = '00000000-0000-4000-8000-000000000001', two = '00000000-0000-4000-8000-000000000002', three = '00000000-0000-4000-8000-000000000003';
const author = () => ({ format: 'viento-scene3d', schemaVersion: 1, name: 'Boxes', viewport: [640, 480], background: '#112233',
  camera: { position: [4, 3, 6], target: [0, 0, 0], fovDegrees: 50, near: .1, far: 100 }, light: { direction: [1, -2, -1], color: '#ffffff', energy: 1 },
  objects: [{ instanceId: one, name: '<b>Blue box</b>', primitive: 'box', position: [0, 1, 0], rotationDegrees: [23, -41, 67], size: [1, 2, 3], color: '#556677' },
    { instanceId: two, name: ' 雪É😀 ', primitive: 'box', position: [2, 0, 0], rotationDegrees: [0, 0, 0], size: [1, 1, 1], color: '#aBCdEF' },
    { instanceId: three, name: 'Boundary box', primitive: 'box', position: [100000, 0, 0], rotationDegrees: [0, 0, 0], size: [1, 1, 1], color: '#ffffff' }] });
const serialize = value => '\ufeff' + JSON.stringify(value, null, 2).replaceAll('\n', '\r\n') + '\r\n';
function freeze(value) { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
const brands = new WeakSet();
function stubProposal(source,{instanceIds}) {
 const before=parseScene3DSource(source.content).model, selected=new Set(instanceIds);
 if (!instanceIds.length || selected.size!==instanceIds.length || selected.size>=before.objects.length || instanceIds.some(id=>!before.objects.some(o=>o.instanceId===id))) throw Object.assign(Error('Invalid removal selection'),{errorCode:'scene3d_removal_invalid'});
 const removedObjects=before.objects.filter(o=>selected.has(o.instanceId)), remainingObjects=before.objects.filter(o=>!selected.has(o.instanceId));
 const model=JSON.parse(source.content.replace(/^\ufeff/,''));model.objects=model.objects.filter(o=>!selected.has(o.instanceId));
 const p=freeze({kind:'scene3d-removal',sourcePath:source.sourcePath,sourceToken:source.token,baseSourceRevision:source.baseSourceRevision,sourceRevision:source.sourceRevision,instanceIds:removedObjects.map(o=>o.instanceId),beforeContent:source.content,afterContent:serialize(model),changedPaths:before.objects.flatMap((o,i)=>selected.has(o.instanceId)?['/objects/'+i]:[]),removedObjects,remainingObjects});brands.add(p);return p;
}
async function fixture(t, options = {}) {
  let uuidCount=0; const nextUuid=()=>{uuidCount++;return options.uuid?options.uuid(uuidCount):'00000000-0000-4000-8000-'+String(100000+uuidCount).padStart(12,'0');};
  let language = 'zh', listener = () => {}, supported = options.supported ?? true, loads = 0, unsubscribed = 0;
  const original = options.content || serialize(options.model || author()); let content = original;
  const context = { editable: true, creating: false, busy: false, sourceJSON: true, sourcePath: 'documents/boxes.scene3d.json', sourceToken: '1:0:0' };
  const proposals = [], calls = [], confirmations = [], alerts = [], snapshot = () => ({ sourcePath: context.sourcePath, token: context.sourceToken, content, baseSourceRevision: hash(original), sourceRevision: hash(content) });
  const translate = value => ({ en, ja }[language]?.[value] || value);
  const h = await dialogHarness('app-scene3d-removal', { queueMicrotask, crypto:{randomUUID:nextUuid}, supportsStudioCoreScene3DRemovalPatch: () => supported, parseScene3DSource,
    createScene3DRemovalProposal(source, edit) { const proposal = (options.propose || stubProposal)(removal(source), removal(edit)); proposals.push(proposal); return proposal; },
    isScene3DRemovalProposal: value => brands.has(value) || isScene3DRemovalProposal(value),
    t: translate, translatePage(root) { for (const node of root.querySelectorAll('[data-i18n]')) node.textContent = translate(node.dataset.i18n); },
    onLanguageChange(fn) { listener = fn; return () => { unsubscribed++; listener = () => {}; }; },
  });
  h.runtime.window.alert = value => alerts.push(value); h.runtime.window.confirm = value => { confirmations.push(value); return options.confirm?.(value) ?? true; };
  let controller;
  controller = h.runtime.setupScene3DRemoval({ getContext: () => context, getSource: async () => { loads++; return options.source ? options.source(snapshot()) : snapshot(); },
    applyDraft: async (proposal, ports) => { calls.push({ proposal, ports }); const state = { context, snapshot, refresh: () => controller.refresh(), setContent(value) { content = value; } };
      if (options.apply) return options.apply(proposal, ports, state); assert.equal(ports.isCurrent(), true); content = proposal.afterContent; context.sourceToken += ':applied';
      if (options.refreshOnApply) controller.refresh(); return { applied: true, sourcePath: context.sourcePath, sourceToken: context.sourceToken, content, focus: options.focus };
    } });
  const el = suffix => h.element('scene3dRemoval' + suffix), settle = async () => { await flushDialogs(); await flushDialogs(); };
  const choices = () => el('Objects').querySelectorAll('input[type=checkbox]'), choice = id => choices().find(item => item.dataset.instanceId === id);
  const select = (id, checked = true, emit = true) => { const node = choice(id); assert.ok(node, id); node.checked = checked; if (emit) node.dispatch('change'); };
  const set = (suffix, value, emit = true) => { el(suffix).value = String(value); if (emit) el(suffix).dispatch('input'); };
  const check = () => el('Check').click(), apply = async () => { el('Apply').click(); await settle(); };
  t.after(() => controller.dispose());
  return { ...h, controller, context, el, settle, choices, choice, select, set, check, apply, proposals, calls, confirmations, alerts, original, snapshot,
    open: () => controller.open(), content: () => content, loads: () => loads, unsubscribed: () => unsubscribed,
    setLanguage(value) { language = value; listener(); }, setSupported(value) { supported = value; }, uuidCount:()=>uuidCount,
  };
}
const selectPair=h=>{h.select(two);h.select(one);h.check();};
const selected=h=>h.choices().filter(o=>o.checked).map(o=>o.dataset.instanceId);

test('optional removal is independently gated by editable JSON source identity and capability',async t=>{
 const h=await fixture(t);for(const[k,v]of[['editable',false],['creating',true],['sourceJSON',false],['sourcePath',''],['sourceToken','']]){const old=h.context[k];h.context[k]=v;h.controller.refresh();assert.equal(await h.open(),false);h.context[k]=old;}h.context.busy=true;assert.equal(await h.open(),false);h.context.busy=false;h.setSupported(false);h.controller.refresh();assert.equal(h.el('Btn').disabled,true);assert.equal(h.loads(),0);
});
test('open has no selection and shows current removable count without allocating identities',async t=>{
 const h=await fixture(t);await h.open();assert.deepEqual(selected(h),[]);assert.equal(h.el('Check').disabled,true);assert.equal(h.el('Apply').disabled,true);assert.match(h.el('Capacity').textContent,/3 → 3/);assert.match(h.el('Capacity').textContent,/本次最多移除数量：2/);assert.equal(h.uuidCount(),0);assert.equal(h.el('Objects').querySelector('span').textContent,'<b>Blue box</b>');assert.equal(h.el('Objects').querySelector('b'),null);
});
test('source order governs removed declarations original-index paths and complete survivor review',async t=>{
 const h=await fixture(t);await h.open();selectPair(h);const p=h.proposals[0];assert.deepEqual(p.instanceIds,[one,two]);assert.deepEqual(p.changedPaths,['/objects/0','/objects/1']);assert.deepEqual(p.remainingObjects.map(o=>o.instanceId),[three]);assert.equal(h.el('Apply').disabled,false);assert.deepEqual(JSON.parse(h.el('Before').textContent),p.removedObjects);assert.deepEqual(JSON.parse(h.el('After').textContent),p.remainingObjects);assert.equal(h.el('Source').textContent,p.afterContent);assert.equal(h.content(),h.original);
});
test('hidden selected rows still participate even with no matching search result',async t=>{
 const h=await fixture(t);await h.open();h.select(one);h.select(two);h.set('Search','Blue');h.check();assert.equal(h.choices().length,1);assert.match(h.el('Selection').textContent,/筛选结果外的已选对象：1/);assert.deepEqual(h.proposals.at(-1).instanceIds,[one,two]);h.set('Search','missing');assert.equal(h.el('NoResults').hidden,false);assert.equal(h.el('Check').disabled,false);h.check();assert.deepEqual(h.proposals.at(-1).instanceIds,[one,two]);
});
test('select all refuses an empty scene without truncating choices then an explicit deselection enables review',async t=>{
 const h=await fixture(t);await h.open();h.el('SelectResults').click();assert.deepEqual(selected(h),[one,two,three]);assert.match(h.el('Blocked').textContent,/至少保留一个/);h.check();assert.equal(h.proposals.length,0);h.select(three,false);h.check();assert.equal(h.el('Apply').disabled,false);assert.deepEqual(h.proposals[0].remainingObjects.map(o=>o.instanceId),[three]);
});
test('a sole object can be selected but can never authorize removal',async t=>{
 const model=author();model.objects=model.objects.slice(0,1);const h=await fixture(t,{model});await h.open();h.select(one);h.check();assert.deepEqual(selected(h),[one]);assert.equal(h.proposals.length,0);assert.match(h.el('Blocked').textContent,/只有一个/);assert.equal(h.content(),h.original);
});
test('127 of 128 selected declarations leave the explicit last survivor',async t=>{
 const model=author();model.objects=Array.from({length:128},(_,i)=>({...model.objects[0],instanceId:'00000000-0000-4000-8000-'+String(i+1).padStart(12,'0')}));const h=await fixture(t,{model});await h.open();h.el('SelectResults').click();h.select(model.objects[127].instanceId,false);h.check();assert.equal(h.el('Apply').disabled,false);assert.equal(h.proposals[0].removedObjects.length,127);assert.deepEqual(h.proposals[0].remainingObjects.map(o=>o.instanceId),[model.objects[127].instanceId]);assert.match(h.el('Capacity').textContent,/128 → 1/);
});
test('selection and query input changes revoke approval without modifying the source',async t=>{
 for(const kind of ['selection','query']){const h=await fixture(t);await h.open();selectPair(h);if(kind==='selection')h.select(two,false);else h.set('Search','Blue');assert.equal(h.el('Apply').disabled,true);assert.equal(h.content(),h.original);assert.equal(h.calls.length,0);}
});
test('silent checkbox UUID or query mutation before Check cannot authorize a mismatched selection',async t=>{
 for(const kind of ['checkbox','id','query']){const h=await fixture(t);await h.open();h.select(one);h.select(two);if(kind==='checkbox')h.select(two,false,false);if(kind==='id')h.choice(one).dataset.instanceId=three;if(kind==='query')h.set('Search','Blue',false);h.check();assert.equal(h.proposals.length,0,kind);assert.equal(h.el('Apply').disabled,true);}
});
test('silent raw checkbox UUID or query mutation after Check cannot replay Apply',async t=>{
 for(const kind of ['checkbox','id','query']){const h=await fixture(t);await h.open();selectPair(h);if(kind==='checkbox')h.select(two,false,false);if(kind==='id')h.choice(one).dataset.instanceId=three;if(kind==='query')h.set('Search','Blue',false);await h.apply();assert.equal(h.calls.length,0,kind);assert.equal(h.content(),h.original);}
});
test('language switching preserves global selection query complete candidate and approval',async t=>{
 const h=await fixture(t);await h.open();selectPair(h);h.set('Search','Blue');h.check();const p=h.proposals.at(-1);for(const lang of ['en','ja','zh']){h.setLanguage(lang);assert.equal(h.el('Apply').disabled,false);assert.equal(h.el('Source').textContent,p.afterContent);assert.equal(h.el('Search').value,'Blue');assert.deepEqual(h.proposals.at(-1).instanceIds,[one,two]);}assert.equal(h.uuidCount(),0);
});
test('cancel and Escape require discard confirmation and do not write source',async t=>{
 let discard=false;const h=await fixture(t,{confirm:()=>discard});await h.open();selectPair(h);h.el('Cancel').click();assert.equal(h.el('Dialog').open,true);const e=h.el('Dialog').dispatch('keydown',{key:'Escape',repeat:true});assert.equal(e.defaultPrevented,true);assert.equal(h.el('Dialog').open,true);discard=true;h.el('Dialog').dispatch('keydown',{key:'Escape'});assert.equal(h.el('Dialog').open,false);assert.equal(h.calls.length,0);assert.equal(h.content(),h.original);
});
test('same-path source owner changes revoke approval and path navigation closes the form',async t=>{
 const h=await fixture(t);await h.open();selectPair(h);h.context.sourceToken+=':reload';h.controller.refresh();assert.equal(h.el('Check').disabled,true);await h.apply();assert.equal(h.calls.length,0);h.context.sourcePath='other.json';h.controller.refresh();assert.equal(h.el('Dialog').open,false);
});
test('late source completion after close or same-path reopen cannot replace the current selection',async t=>{
 const gate=deferred();let reads=0;const h=await fixture(t,{source:s=>++reads===1?gate.promise:s}),old=h.open();h.controller.close(true);await h.open();h.select(two);gate.resolve(h.snapshot());assert.equal(await old,false);assert.deepEqual(selected(h),[two]);assert.equal(h.el('Dialog').open,true);
});
test('malformed foreign or semantically altered proposal cannot receive approval',async t=>{
 for(const kind of ['brand','kind','ids','removed','survivors','paths','revision','inventory']){const h=await fixture(t,{propose:(src,edit)=>{const p=removal(stubProposal(src,edit));if(kind!=='brand')brands.add(p);if(kind==='kind')p.kind='scene3d-copy';if(kind==='ids')p.instanceIds.reverse();if(kind==='removed')p.removedObjects=[];if(kind==='survivors')p.remainingObjects=[];if(kind==='paths')p.changedPaths=['/objects/2'];if(kind==='revision')p.baseSourceRevision='changed';if(kind==='inventory'){const m=JSON.parse(p.afterContent.slice(1));m.objects[0].name='altered';p.afterContent=serialize(m);}return p;}});await h.open();selectPair(h);assert.equal(h.el('Apply').disabled,true,kind);await h.apply();assert.equal(h.calls.length,0,kind);}
});
test('private proposal applies only to source memory and the exact advanced owner receipt closes once',async t=>{
 let focused=0;const h=await fixture(t,{focus:()=>focused++,refreshOnApply:true});await h.open();selectPair(h);const p=h.proposals[0];await h.apply();assert.equal(h.calls.length,1);assert.equal(h.content(),p.afterContent);assert.equal(h.el('Dialog').open,false);assert.equal(focused,1);assert.equal(h.uuidCount(),0);
});
test('forged path content and stale owner receipts never close an applied form',async t=>{
 for(const kind of ['path','content','token','null']){const h=await fixture(t,{apply:(p,ports,state)=>{state.context.sourceToken='next';const r={applied:true,sourcePath:p.sourcePath,sourceToken:'next',content:p.afterContent};if(kind==='path')r.sourcePath='other';if(kind==='content')r.content=p.beforeContent;if(kind==='token')r.sourceToken=p.sourceToken;return kind==='null'?null:r;}});await h.open();selectPair(h);await h.apply();assert.equal(h.el('Dialog').open,true,kind);assert.match(h.el('Diagnostic').textContent,/receipt/);}
});
test('pending Apply locks fields but cancel immediately revokes ownership and late completion focus',async t=>{
 const gate=deferred();let focused=0;const h=await fixture(t,{apply:()=>gate.promise});await h.open();selectPair(h);h.el('Apply').click();for(const name of ['Search','SelectResults','ClearSelection','Check','Apply'])assert.equal(h.el(name).disabled,true);h.el('Cancel').click();assert.equal(h.calls[0].ports.isCurrent(),false);gate.resolve({applied:true,focus:()=>focused++});await h.settle();assert.equal(h.el('Dialog').open,false);assert.equal(focused,0);
});
test('silent query and choices while awaiting Apply invalidate both guard and late receipt',async t=>{
 for(const kind of ['query','checkbox']){const gate=deferred(),h=await fixture(t,{apply:()=>gate.promise});await h.open();selectPair(h);h.el('Apply').click();if(kind==='query')h.set('Search','Blue',false);else h.select(two,false,false);assert.equal(h.calls[0].ports.isCurrent(),false);h.context.sourceToken='next';gate.resolve({applied:true,sourcePath:h.context.sourcePath,sourceToken:'next',content:h.proposals[0].afterContent});await h.settle();assert.equal(h.el('Dialog').open,true);}
});
test('old closed-owner checkbox reattached into a new session cannot select anything',async t=>{
 const h=await fixture(t);await h.open();const old=h.choice(one);h.controller.close(true);await h.open();h.el('Objects').append(old);old.checked=true;old.dispatch('change');h.controller.refresh();assert.deepEqual(selected(h),[]);assert.equal(h.proposals.length,0);
});
test('old filtered-generation checkbox cannot alter selection even when reattached',async t=>{
 const h=await fixture(t);await h.open();const old=h.choice(one);h.set('Search','Boundary');h.el('Objects').append(old);old.checked=true;old.dispatch('change');h.controller.refresh();assert.deepEqual(selected(h),[]);assert.equal(h.calls.length,0);
});
test('dispose is idempotent and ignores late source completion',async t=>{
 const gate=deferred(),h=await fixture(t,{source:()=>gate.promise}),opened=h.open();h.controller.dispose();h.controller.dispose();gate.resolve(h.snapshot());assert.equal(await opened,false);assert.equal(h.el('Dialog'),null);assert.equal(h.unsubscribed(),1);assert.ok(h.element('projectBuildBtn'));
});
test('all removal labels have English and Japanese values and the controller has no sibling or I/O imports',async()=>{
 const code=await fs.readFile(new URL('../../web/modules/app-scene3d-removal.js',import.meta.url),'utf8'),css=await fs.readFile(new URL('../../web/scene3d-removal.css',import.meta.url),'utf8');for(const label of ['批量移除3D对象','3D批量移除审阅','待移除对象声明','保留对象声明','检查3D移除','本次最多移除数量','保留对象数量'])for(const lang of [en,ja])assert.equal(typeof lang[label],'string',label);assert.doesNotMatch(code,/app-scene3d-(?:copy|objects|preview)|import[^\n]*renderer|fetch\s*\(|request\s*\(|saveEdit|allocate\s*\(/);assert.match(css,/\[hidden\]\s*\{\s*display:none!important/);assert.match(css,/max-width:700px/);
});
test('actual native private removal review and preparation preserve survivor bytes without implicit saving',async t=>{
 const h=await fixture(t,{propose:createScene3DRemovalProposal,apply:async(p,ports,state)=>{assert.equal(ports.isCurrent(),true);const current=state.snapshot(),ready=await prepareScene3DRemovalApply(current,p,{digest:s=>createHash('sha256').update(s).digest('hex')});assert.equal(ports.isCurrent(),true);state.setContent(ready.afterContent);state.context.sourceToken='next';return{applied:true,sourcePath:current.sourcePath,sourceToken:'next',content:ready.afterContent};}});await h.open();selectPair(h);assert.equal(h.el('Apply').disabled,false);assert.equal(isScene3DRemovalProposal(h.proposals[0]),true);await h.apply();assert.equal(h.calls.length,1);assert.equal(h.content(),h.proposals[0].afterContent);assert.equal(h.el('Dialog').open,false);
});
