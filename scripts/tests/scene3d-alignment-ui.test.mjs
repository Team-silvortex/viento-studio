import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dialogHarness, flushDialogs } from './dialog-harness.mjs';
import { deferred } from './editor-harness.mjs';
import { parseScene3DSource } from '../../engine/scene3d.mjs';
import { createScene3DAlignmentProposal, isScene3DAlignmentProposal, prepareScene3DAlignmentApply } from '../../engine/scene3d-alignment.mjs';
import { supportsStudioCoreScene3DAlignmentPatch } from '../../engine/studio-core.mjs';
import en from '../../web/i18n/en.js';
import ja from '../../web/i18n/ja.js';

const copy = value => JSON.parse(JSON.stringify(value));
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
function stubProposal(source, { instanceIds, anchorInstanceId, axis }) {
  const model = JSON.parse(source.content.replace(/^\ufeff/, '')), beforeObjects = parseScene3DSource(source.content).model.objects.filter(item => instanceIds.includes(item.instanceId)).map(copy), changedPaths = [];
  if (instanceIds.length < 2 || !instanceIds.includes(anchorInstanceId) || !['x', 'y', 'z'].includes(axis)) throw Object.assign(Error('Invalid selected reference or axis'), { errorCode: 'scene3d_alignment_invalid' });
  const component = ['x', 'y', 'z'].indexOf(axis), coordinate = model.objects.find(object => object.instanceId === anchorInstanceId).position[component];
  for (const [index, object] of model.objects.entries()) if (instanceIds.includes(object.instanceId) && object.position[component] !== coordinate) {
    object.position[component] = coordinate; changedPaths.push(`/objects/${index}/position/${component}`);
  }
  if (!changedPaths.length) throw Object.assign(Error('No coordinate changed'), { errorCode: 'scene3d_alignment_unchanged' });
  const afterModel = parseScene3DSource(serialize(model)).model;
  const proposal = freeze({ kind: 'scene3d-alignment', sourcePath: source.sourcePath, sourceToken: source.token, baseSourceRevision: source.baseSourceRevision,
    sourceRevision: source.sourceRevision, instanceIds: beforeObjects.map(item => item.instanceId), anchorInstanceId, axis, beforeContent: source.content,
    afterContent: serialize(model), changedPaths, beforeObjects, afterObjects: afterModel.objects.filter(item => instanceIds.includes(item.instanceId)).map(copy) });
  brands.add(proposal); return proposal;
}
async function fixture(t, options = {}) {
  let language = 'zh', listener = () => {}, supported = options.supported ?? true, loads = 0, unsubscribed = 0;
  const original = options.content || serialize(options.model || author()); let content = original;
  const context = { editable: true, creating: false, busy: false, sourceJSON: true, sourcePath: 'documents/boxes.scene3d.json', sourceToken: '1:0:0' };
  const proposals = [], calls = [], confirmations = [], alerts = [], snapshot = () => ({ sourcePath: context.sourcePath, token: context.sourceToken, content, baseSourceRevision: hash(original), sourceRevision: hash(content) });
  const translate = value => ({ en, ja }[language]?.[value] || value);
  const h = await dialogHarness('app-scene3d-alignment', { queueMicrotask, supportsStudioCoreScene3DAlignmentPatch: () => supported, parseScene3DSource,
    createScene3DAlignmentProposal(source, edit) { const proposal = (options.propose || stubProposal)(copy(source), copy(edit)); proposals.push(proposal); return proposal; },
    isScene3DAlignmentProposal: value => brands.has(value) || isScene3DAlignmentProposal(value),
    t: translate, translatePage(root) { for (const node of root.querySelectorAll('[data-i18n]')) node.textContent = translate(node.dataset.i18n); },
    onLanguageChange(fn) { listener = fn; return () => { unsubscribed++; listener = () => {}; }; },
  });
  h.runtime.window.alert = value => alerts.push(value); h.runtime.window.confirm = value => { confirmations.push(value); return options.confirm?.(value) ?? true; };
  let controller;
  controller = h.runtime.setupScene3DAlignment({ getContext: () => context, getSource: async () => { loads++; return options.source ? options.source(snapshot()) : snapshot(); },
    applyDraft: async (proposal, ports) => { calls.push({ proposal, ports }); const state = { context, snapshot, refresh: () => controller.refresh(), setContent(value) { content = value; } };
      if (options.apply) return options.apply(proposal, ports, state); assert.equal(ports.isCurrent(), true); content = proposal.afterContent; context.sourceToken += ':applied';
      if (options.refreshOnApply) controller.refresh(); return { applied: true, sourcePath: context.sourcePath, sourceToken: context.sourceToken, content, focus: options.focus };
    } });
  const el = suffix => h.element('scene3dAlignment' + suffix), settle = async () => { await flushDialogs(); await flushDialogs(); };
  const choices = () => el('Objects').querySelectorAll('input[type=checkbox]'), choice = id => choices().find(item => item.dataset.instanceId === id);
  const select = (id, checked = true, emit = true) => { const node = choice(id); assert.ok(node, id); node.checked = checked; if (emit) node.dispatch('change'); };
  const set = (suffix, value, emit = true) => { el(suffix).value = String(value); if (emit) el(suffix).dispatch(['Anchor', 'Axis'].includes(suffix) ? 'change' : 'input'); };
  const check = () => el('Check').click(), apply = async () => { el('Apply').click(); await settle(); };
  t.after(() => controller.dispose());
  return { ...h, controller, context, el, settle, choices, choice, select, set, check, apply, proposals, calls, confirmations, alerts, original, snapshot,
    open: () => controller.open(), content: () => content, loads: () => loads, unsubscribed: () => unsubscribed,
    setLanguage(value) { language = value; listener(); }, setSupported(value) { supported = value; } };
}
const align = (h, axis = 'x', anchor = one) => { h.select(one); h.select(two); h.set('Anchor', anchor); h.set('Axis', axis); h.check(); };

test('independent entry gates JSON author context and optional alignment capability without sibling permission', async t => {
  const h = await fixture(t); assert.equal(h.el('Btn').hidden, false);
  for (const [key,value] of [['editable',false],['creating',true],['sourceJSON',false],['sourcePath',''],['sourceToken','']]) { const old=h.context[key]; h.context[key]=value; h.controller.refresh(); assert.equal(await h.open(),false); assert.equal(h.el('Btn').hidden,true); h.context[key]=old; }
  h.context.busy=true; assert.equal(await h.open(),false); h.context.busy=false; h.setSupported(false); h.controller.refresh(); assert.equal(h.el('Btn').disabled,true); assert.match(h.el('Btn').title,/其他3D/); assert.equal(h.el('Unavailable').hidden,false); assert.equal(h.loads(),0);
});
test('opening has no selected objects or implicit reference and defaults only to authored X axis', async t => {
  const h=await fixture(t); await h.open(); assert.ok(h.choices().every(row=>!row.checked)); assert.equal(h.el('Anchor').value,''); assert.equal(h.el('Axis').value,'x'); assert.equal(h.el('Check').disabled,true); assert.equal(h.el('Apply').disabled,true);
  assert.equal(h.el('Objects').querySelector('span').textContent,'<b>Blue box</b>'); assert.equal(h.el('Objects').querySelectorAll('b').length,0); assert.deepEqual(Object.keys(h.controller).sort(),['close','destroy','dispose','open','refresh']); assert.equal(h.content(),h.original);
});
test('zero or one selected object and empty reference cannot call a proposal or application port', async t => {
  const h=await fixture(t); await h.open(); h.check(); h.select(one); h.set('Anchor',one); h.check(); assert.equal(h.proposals.length,0); assert.equal(h.el('Check').disabled,true); h.select(two); h.set('Anchor',''); h.check(); await h.apply(); assert.equal(h.proposals.length,0); assert.equal(h.calls.length,0);
});
test('reference choices are only selected objects and deselecting the reference requires explicit reselection', async t => {
  const h=await fixture(t); await h.open(); h.select(one); h.select(two); assert.deepEqual(h.el('Anchor').children.map(row=>row.value),['',one,two]); assert.equal(h.el('Anchor').value,''); h.set('Anchor',one); h.select(one,false); assert.equal(h.el('Anchor').value,''); assert.equal(h.el('Check').disabled,true); h.select(one); assert.equal(h.el('Anchor').value,''); h.set('Anchor',two); assert.equal(h.el('Check').disabled,false);
});
test('three authored axes align the chosen coordinate to the reference original value and retain all other fields', async t => {
  for (const axis of ['x','y','z']) { const model=author(); model.objects[1].position=[2,4,-3]; const h=await fixture(t,{model}); await h.open(); align(h,axis); assert.equal(h.el('Apply').disabled,false); const p=h.proposals[0], component=['x','y','z'].indexOf(axis), next=JSON.parse(p.afterContent.replace(/^\ufeff/,'')); assert.deepEqual(p.instanceIds,[one,two]); assert.equal(p.anchorInstanceId,one); assert.equal(p.axis,axis); assert.equal(p.beforeObjects.length,2); assert.equal(p.afterObjects.length,2); assert.deepEqual(next.objects[0],model.objects[0]); assert.equal(next.objects[1].position[component],model.objects[0].position[component]); for(const n of [0,1,2].filter(n=>n!==component)) assert.equal(next.objects[1].position[n],model.objects[1].position[n]); for(const key of ['instanceId','name','primitive','rotationDegrees','size','color']) assert.deepEqual(next.objects[1][key],model.objects[1][key]); assert.deepEqual(next.objects[2],model.objects[2]); }
});
test('source-ordered review includes the unchanged reference and all selected objects while paths contain only net changes', async t => {
  const h=await fixture(t); await h.open(); h.select(two); h.select(one); h.set('Anchor',two); h.check(); const p=h.proposals[0]; assert.deepEqual(p.instanceIds,[one,two]); assert.deepEqual(p.changedPaths,['/objects/0/position/0']); assert.deepEqual(p.afterObjects[1],p.beforeObjects[1]); assert.deepEqual(JSON.parse(h.el('Before').textContent),p.beforeObjects); assert.equal(h.el('Source').textContent,p.afterContent); assert.match(h.el('Coordinate').textContent,/X：2/);
});
test('search filters Unicode names or UUIDs but hidden selection and reference still participate', async t => {
  const h=await fixture(t); await h.open(); h.select(one); h.select(two); h.set('Anchor',two); h.set('Search',' BLUE '); h.check(); assert.deepEqual(h.proposals[0].instanceIds,[one,two]); assert.equal(h.el('Anchor').value,two); assert.match(h.el('Selection').textContent,/筛选结果外的已选对象：1/); h.set('Search','雪é'); assert.equal(h.choices().length,1); assert.equal(h.choice(two).checked,true); h.set('Search','unknown'); assert.equal(h.choices().length,0); assert.equal(h.el('NoResults').hidden,false); assert.equal(h.el('Anchor').value,two); assert.equal(h.el('Check').disabled,false);
});
test('select current results is explicit and clear selection also clears the reference and review', async t => {
  const h=await fixture(t); await h.open(); h.set('Search',''); h.el('SelectResults').click(); assert.equal(h.choices().filter(row=>row.checked).length,3); assert.equal(h.el('Anchor').value,''); h.set('Anchor',one); h.check(); h.set('Search','雪'); h.el('ClearSelection').click(); assert.equal(h.el('Anchor').value,''); assert.equal(h.el('Apply').disabled,true); assert.match(h.el('Selection').textContent,/已选对象：0/);
});
test('all 128 objects have stable identity selection without assigning a reference automatically', async t => {
  const model=author(); model.objects=Array.from({length:128},(_,i)=>({...model.objects[0],instanceId:`00000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`,name:`Box ${i}`,position:[i,0,0]})); const h=await fixture(t,{model}); await h.open(); h.el('SelectResults').click(); assert.equal(h.choices().filter(row=>row.checked).length,128); assert.equal(h.el('Anchor').value,''); h.set('Anchor',model.objects[127].instanceId); h.set('Search','Box 0'); h.check(); assert.equal(h.proposals[0].instanceIds.length,128); assert.equal(h.proposals[0].afterObjects[0].position[0],127);
});
test('already equal selected coordinates produce no approval and preserve source and raw selection', async t => {
  const h=await fixture(t); await h.open(); align(h,'z'); assert.equal(h.el('Apply').disabled,true); assert.match(h.el('Status').textContent,/未改变任何坐标/); assert.equal(h.choice(one).checked,true); assert.equal(h.el('Anchor').value,one); assert.equal(h.content(),h.original); assert.equal(h.calls.length,0);
});
test('ordinary anchor axis selection or filter edits revoke old approval while preserving author intent', async t => {
  for(const field of ['Anchor','Axis','Search','selection']) { const h=await fixture(t); await h.open(); align(h); assert.equal(h.el('Apply').disabled,false); if(field==='selection')h.select(three); else h.set(field,{Anchor:two,Axis:'y',Search:'雪'}[field]); assert.equal(h.el('Apply').disabled,true); assert.equal(h.content(),h.original); }
});
test('silent reference or axis changes before Check cannot approve a target different from the visible form', async t => {
  for(const [field,value]of [['Anchor',two],['Anchor',three],['Axis','y'],['Axis','bad']]) { const h=await fixture(t); await h.open(); h.select(one); h.select(two); h.set('Anchor',one); h.set(field,value,false); h.check(); assert.equal(h.proposals.length,0); assert.equal(h.el('Apply').disabled,true); assert.equal(h.content(),h.original); }
});
test('silent checkbox identity or query mutation before Check cannot mix displayed and bound selection', async t => {
  for(const mutation of ['checkbox','id','query']) { const h=await fixture(t); await h.open(); h.select(one); h.select(two); h.set('Anchor',one); if(mutation==='checkbox')h.select(two,false,false); if(mutation==='id')h.choice(one).dataset.instanceId=three; if(mutation==='query')h.set('Search','雪',false); h.check(); assert.equal(h.proposals.length,0); assert.equal(h.el('Apply').disabled,true); }
});
test('silent reference axis checkbox UUID or query changes cannot replay an approved proposal', async t => {
  for(const mutation of ['anchor','axis','checkbox','id','query']) { const h=await fixture(t); await h.open(); align(h); if(mutation==='anchor')h.set('Anchor',two,false); if(mutation==='axis')h.set('Axis','y',false); if(mutation==='checkbox')h.select(two,false,false); if(mutation==='id')h.choice(one).dataset.instanceId=three; if(mutation==='query')h.set('Search','雪',false); await h.apply(); assert.equal(h.calls.length,0); assert.equal(h.el('Apply').disabled,true); }
});
test('language switching preserves filter stable selection reference axis and complete approved source', async t => {
  const h=await fixture(t); await h.open(); align(h); h.set('Search','Blue'); h.check(); const p=h.el('Source').textContent; for(const language of ['en','ja','zh']) { h.setLanguage(language); assert.equal(h.el('Source').textContent,p); assert.equal(h.el('Apply').disabled,false); assert.equal(h.el('Anchor').value,one); assert.equal(h.el('Axis').value,'x'); assert.equal(h.el('Search').value,'Blue'); assert.equal(h.loads(),1); assert.equal(h.el('Anchor').children[0].textContent,({en,ja}[language]?.['请选择已选参照对象']||'请选择已选参照对象')); }
});
test('every new literal message and authored-axis explanation is translated without translating object names', async t => {
  const source=await fs.readFile(new URL('../../web/modules/app-scene3d-alignment.js',import.meta.url),'utf8'); const keys=[...source.matchAll(/data-i18n="([^"]+)"/g),...source.matchAll(/\bt\('([^']+)'\)/g)].map(m=>m[1]); for(const key of keys) { assert.ok(en[key],key); assert.ok(ja[key],key); } const h=await fixture(t); await h.open(); h.setLanguage('en'); assert.equal(h.el('Title').textContent,'Align 3D positions'); assert.equal(h.el('Objects').querySelector('span').textContent,'<b>Blue box</b>');
});
test('Cancel and Escape honor discard without apply and ignore repeated or composing keys', async t => {
  let discard=false; const h=await fixture(t,{confirm:()=>discard}); await h.open(); align(h); h.el('Cancel').click(); assert.equal(h.el('Dialog').open,true); assert.equal(h.el('Apply').disabled,false); const event=h.el('Dialog').dispatch('keydown',{key:'Escape'}); assert.equal(event.defaultPrevented,true); assert.equal(h.el('Dialog').open,true); discard=true; for(const state of [{repeat:true},{isComposing:true},{keyCode:229}]) { h.el('Dialog').dispatch('keydown',{key:'Escape',...state}); assert.equal(h.el('Dialog').open,true); } h.el('Dialog').dispatch('keydown',{key:'Escape'}); assert.equal(h.el('Dialog').open,false); assert.equal(h.calls.length,0); assert.equal(h.content(),h.original);
});
test('list checkbox keyboard focus survives rebuild and query does not steal focus from search', async t => {
  const h=await fixture(t); await h.open(); h.choice(two).focus(); h.select(two); assert.equal(h.document.activeElement.dataset.instanceId,two); h.setLanguage('ja'); assert.equal(h.document.activeElement.dataset.instanceId,two); h.el('Search').focus(); h.set('Search','Blue'); assert.equal(h.document.activeElement,h.el('Search')); h.select(one); h.el('Anchor').focus(); h.set('Anchor',two); assert.equal(h.document.activeElement,h.el('Anchor'));
});
test('same-path reload revokes approval but retains reference and selection while different source path closes', async t => {
  const h=await fixture(t); await h.open(); align(h); h.context.sourceToken+=':reload'; h.controller.refresh(); assert.equal(h.el('Anchor').value,one); assert.equal(h.choice(two).checked,true); assert.equal(h.el('Check').disabled,true); await h.apply(); assert.equal(h.calls.length,0); h.context.sourcePath='other.json'; h.controller.refresh(); assert.equal(h.el('Dialog').open,false);
});
test('late source success or failure after close cannot reopen or alert', async t => {
  for(const reject of [false,true]) { const gate=deferred(),h=await fixture(t,{source:()=>gate.promise}),opened=h.open(); h.controller.close(true); reject?gate.reject(Error('Late')):gate.resolve(h.snapshot()); assert.equal(await opened,false); assert.equal(h.el('Dialog').open,false); assert.deepEqual(h.alerts,[]); }
});
test('source token path and malformed snapshots fail closed before object authoring can approve', async t => {
  const gate=deferred(),h=await fixture(t,{source:()=>gate.promise}),snapshot=h.snapshot(),opened=h.open(); h.context.sourceToken='new'; gate.resolve(snapshot); assert.equal(await opened,false); assert.equal(h.el('Fields').hidden,true); for(const delta of [{sourcePath:'wrong'},{token:'wrong'},{content:'{}'}]) { const bad=await fixture(t,{source:source=>({...source,...delta})}); assert.equal(await bad.open(),false); assert.equal(bad.el('Check').disabled,true); }
});
test('old opening completion cannot replace a newly opened selection reference or axis', async t => {
  const gate=deferred(); let reads=0; const h=await fixture(t,{source:snapshot=>++reads===1?gate.promise:snapshot}),opened=h.open(); h.controller.close(true); await h.open(); h.select(two); h.set('Anchor',two); h.set('Axis','z'); gate.resolve(h.snapshot()); assert.equal(await opened,false); assert.equal(h.el('Anchor').value,two); assert.equal(h.el('Axis').value,'z');
});
test('foreign clone or malformed candidate identity reference axis source or paths cannot gain approval', async t => {
  for(const mutation of ['brand','kind','ids','anchor','axis','path','token','before','after','paths']) { const h=await fixture(t,{propose:(source,edit)=>{const p=copy(stubProposal(source,edit)); if(mutation!=='brand')brands.add(p); if(mutation==='kind')p.kind='scene3d-translation'; if(mutation==='ids')p.instanceIds=[one]; if(mutation==='anchor')p.anchorInstanceId=two; if(mutation==='axis')p.axis='y'; if(mutation==='path')p.sourcePath='other'; if(mutation==='token')p.sourceToken='other'; if(mutation==='before')p.beforeObjects=[]; if(mutation==='after')p.afterContent=p.beforeContent; if(mutation==='paths')p.changedPaths=[]; return p; }}); await h.open(); align(h); assert.equal(h.el('Apply').disabled,true,mutation); await h.apply(); assert.equal(h.calls.length,0,mutation); }
});
test('branded exact proposal applies only source memory and valid advanced receipt returns focus once', async t => {
  let focused=0;const h=await fixture(t,{focus:()=>focused++}); await h.open(); align(h); const p=h.proposals[0]; await h.apply(); assert.equal(h.calls[0].proposal,p); assert.equal(h.content(),p.afterContent); assert.notEqual(h.context.sourceToken,p.sourceToken); assert.equal(h.el('Dialog').open,false); assert.equal(focused,1);
});
test('host refresh during legitimate token advancement does not consume pending approval', async t => {
  const h=await fixture(t,{refreshOnApply:true}); await h.open(); align(h); await h.apply(); assert.equal(h.el('Dialog').open,false); assert.equal(h.content(),h.proposals[0].afterContent); assert.equal(h.calls.length,1);
});
test('false and forged path content or owner-token receipts leave the current form open', async t => {
  for(const mutation of ['path','content','old-token','empty-token','current-token','false','null']) { const h=await fixture(t,{apply:(p,ports,state)=>{assert.equal(ports.isCurrent(),true); state.context.sourceToken='next';const r={applied:true,sourcePath:p.sourcePath,sourceToken:'next',content:p.afterContent}; if(mutation==='path')r.sourcePath='other';if(mutation==='content')r.content=p.beforeContent;if(mutation==='old-token'){r.sourceToken=p.sourceToken;state.context.sourceToken=p.sourceToken;}if(mutation==='empty-token')r.sourceToken='';if(mutation==='current-token')state.context.sourceToken='other-current';if(mutation==='false')r.applied=false;return mutation==='null'?null:r;}}); await h.open();align(h);await h.apply();assert.equal(h.el('Dialog').open,true,mutation);assert.match(h.el('Diagnostic').textContent,/receipt/,mutation); }
});
test('pending application locks selection reference axis and query while Cancel revokes late completion', async t => {
  const gate=deferred();let focus=0;const h=await fixture(t,{apply:()=>gate.promise});await h.open();align(h);h.el('Apply').click();for(const field of ['Search','SelectResults','ClearSelection','Anchor','Axis','Check','Apply'])assert.equal(h.el(field).disabled,true,field);assert.ok(h.choices().every(row=>row.disabled));assert.equal(h.el('Cancel').disabled,false);h.el('Cancel').click();assert.equal(h.calls[0].ports.isCurrent(),false);gate.resolve({applied:true,sourcePath:h.context.sourcePath,sourceToken:'next',content:h.proposals[0].afterContent,focus:()=>focus++});await h.settle();assert.equal(h.el('Dialog').open,false);assert.equal(focus,0);
});
test('silent raw reference axis checkbox or query mutations across await revoke guard and receipt', async t => {
  for(const mutation of ['anchor','axis','checkbox','query']) {const gate=deferred(),h=await fixture(t,{apply:()=>gate.promise});await h.open();align(h);h.el('Apply').click();if(mutation==='anchor')h.set('Anchor',two,false);if(mutation==='axis')h.set('Axis','y',false);if(mutation==='checkbox')h.select(two,false,false);if(mutation==='query')h.set('Search','Blue',false);assert.equal(h.calls[0].ports.isCurrent(),false);h.context.sourceToken='next';gate.resolve({applied:true,sourcePath:h.context.sourcePath,sourceToken:'next',content:h.proposals[0].afterContent});await h.settle();assert.equal(h.el('Dialog').open,true);assert.match(h.el('Diagnostic').textContent,/receipt/);}
});
test('closing and reopening during application keeps the new local form independent from old completion', async t => {
  const gate=deferred(),h=await fixture(t,{apply:()=>gate.promise});await h.open();align(h);h.el('Apply').click();h.controller.close(true);await h.open();h.select(two);h.set('Anchor',two);h.set('Axis','z');gate.resolve({applied:true});await h.settle();assert.equal(h.el('Dialog').open,true);assert.equal(h.el('Anchor').value,two);assert.equal(h.el('Axis').value,'z');
});
test('duplicate Apply and late errors never add requests or discard retained input', async t => {
  const gate=deferred(),h=await fixture(t,{apply:()=>gate.promise});await h.open();align(h);h.el('Apply').click();h.el('Apply').click();assert.equal(h.calls.length,1);gate.reject(Error('Late error'));await h.settle();assert.equal(h.el('Anchor').value,one);assert.equal(h.el('Dialog').open,true);
});
test('loss of optional native alignment capability disables only this domain and invalidates Apply', async t => {
  const h=await fixture(t);await h.open();align(h);h.setSupported(false);h.controller.refresh();assert.equal(h.el('Btn').disabled,true);assert.equal(h.el('Check').disabled,true);await h.apply();assert.equal(h.calls.length,0);assert.ok(h.element('projectBuildBtn'));assert.equal(h.el('Anchor').value,one);
});
test('disposal is idempotent and removes only this UI while ignoring late read', async t => {
  const gate=deferred(),h=await fixture(t,{source:()=>gate.promise}),opened=h.open();h.controller.dispose();h.controller.dispose();gate.resolve(h.snapshot());assert.equal(await opened,false);assert.equal(await h.open(),false);assert.equal(h.el('Dialog'),null);assert.equal(h.unsubscribed(),1);assert.ok(h.element('projectBuildBtn'));
});
test('CSS hides review explicitly and authoring imports no renderer sibling World HTTP or Save capability', async()=>{
  const source=await fs.readFile(new URL('../../web/modules/app-scene3d-alignment.js',import.meta.url),'utf8'),css=await fs.readFile(new URL('../../web/scene3d-alignment.css',import.meta.url),'utf8');assert.match(css,/\.scene3d-alignment-dialog \[hidden\]\s*\{\s*display:none!important/);assert.equal(/style=|\.style\./.test(source),false);assert.equal(/import.*(renderer|app-scene3d-(transforms|objects|properties|environment|translation)|runtime|world|build)/.test(source),false);assert.equal(/fetch\(|saveDraft|WorldCommand|\.save\(/.test(source),false);
});
test('actual native privately branded alignment integrates with local review and strict memory apply',async t=>{
  assert.equal(supportsStudioCoreScene3DAlignmentPatch(),true);const h=await fixture(t,{propose:createScene3DAlignmentProposal,apply:async(p,ports,state)=>{assert.equal(isScene3DAlignmentProposal(p),true);assert.equal(ports.isCurrent(),true);const result=await prepareScene3DAlignmentApply(state.snapshot(),p,{digest:async raw=>hash(raw).slice(7)});assert.equal(result.afterContent,p.afterContent);state.setContent(result.afterContent);state.context.sourceToken='advanced-native';return{applied:true,sourcePath:p.sourcePath,sourceToken:state.context.sourceToken,content:result.afterContent};}});await h.open();align(h);assert.equal(h.el('Apply').disabled,false);assert.equal(isScene3DAlignmentProposal(h.proposals[0]),true);await h.apply();assert.equal(h.el('Dialog').open,false);assert.deepEqual(JSON.parse(h.content().replace(/^\ufeff/,'')).objects.slice(0,2).map(object=>object.position),[[0,1,0],[0,0,0]]);
});
test('detached old checkbox cannot select a new same-path session after close and reopen',async t=>{
  const h=await fixture(t);await h.open();const old=h.choice(one);h.controller.close(true);h.context.sourceToken='new-session';await h.open();old.checked=true;old.dispatch('change');assert.ok(h.choices().every(row=>!row.checked));assert.equal(h.el('Anchor').value,'');assert.equal(h.el('Check').disabled,true);assert.equal(h.proposals.length,0);h.select(two);assert.equal(h.choice(two).checked,true);
});
test('obsolete checkbox from query redraw cannot alter current selection reference or approved proposal',async t=>{
  const h=await fixture(t);await h.open();align(h);const old=h.choice(one);h.set('Search','Blue');h.check();const source=h.el('Source').textContent;old.checked=false;old.dispatch('change');assert.equal(h.choice(one).checked,true);assert.equal(h.el('Anchor').value,one);assert.equal(h.el('Apply').disabled,false);assert.equal(h.el('Source').textContent,source);h.el('Objects').append(old);old.dispatch('change');h.el('Objects').replaceChildren(...h.el('Objects').children.filter(node=>node!==old));assert.equal(h.el('Source').textContent,source);assert.equal(h.calls.length,0);
});
test('a current checkbox with silently replaced UUID cannot change its bound selection',async t=>{
  const h=await fixture(t);await h.open();const row=h.choice(one);row.dataset.instanceId=two;row.checked=true;row.dispatch('change');assert.equal(h.el('Check').disabled,true);h.controller.refresh();assert.ok(h.choices().every(row=>!row.checked));assert.equal(h.el('Anchor').value,'');
});
