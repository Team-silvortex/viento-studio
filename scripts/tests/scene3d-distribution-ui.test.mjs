import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dialogHarness, flushDialogs } from './dialog-harness.mjs';
import { deferred } from './editor-harness.mjs';
import { parseScene3DSource } from '../../engine/scene3d.mjs';
import { createScene3DDistributionProposal, isScene3DDistributionProposal, prepareScene3DDistributionApply } from '../../engine/scene3d-distribution.mjs';
import { supportsStudioCoreScene3DDistributionPatch } from '../../engine/studio-core.mjs';
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
function stubProposal(source, { instanceIds, axis }) {
  const model = JSON.parse(source.content.replace(/^\ufeff/, '')), beforeObjects = parseScene3DSource(source.content).model.objects.filter(item => instanceIds.includes(item.instanceId)).map(copy), changedPaths = [];
  if (instanceIds.length < 3 || !['x', 'y', 'z'].includes(axis)) throw Object.assign(Error('Invalid selected objects or axis'), { errorCode: 'scene3d_distribution_invalid' });
  const component = ['x', 'y', 'z'].indexOf(axis), order = model.objects.map((object,index)=>({object,index})).filter(row=>instanceIds.includes(row.object.instanceId)).sort((a,b)=>a.object.position[component]-b.object.position[component]||a.index-b.index);
  const start=order[0].object.position[component], end=order.at(-1).object.position[component], coordinates=order.map((row,i)=>i===0?start:i===order.length-1?end:start+(end-start)*(i/(order.length-1)));
  if (start!==end && coordinates.some((v,i)=>i>0&&v<=coordinates[i-1])) throw Object.assign(Error('Binary64 cannot produce increasing coordinates'),{errorCode:'scene3d_distribution_invalid'});
  order.forEach((row,i)=>{if(row.object.position[component]!==coordinates[i]){row.object.position[component]=coordinates[i];changedPaths.push('/objects/'+row.index+'/position/'+component);}});
  changedPaths.sort((a,b)=>Number(a.split('/')[2])-Number(b.split('/')[2]));
  if (!changedPaths.length) throw Object.assign(Error('No coordinate changed'), { errorCode: 'scene3d_distribution_unchanged' });
  const afterModel = parseScene3DSource(serialize(model)).model;
  const proposal = freeze({ kind: 'scene3d-distribution', sourcePath: source.sourcePath, sourceToken: source.token, baseSourceRevision: source.baseSourceRevision,
    sourceRevision: source.sourceRevision, instanceIds: beforeObjects.map(item => item.instanceId), orderedInstanceIds: order.map(row=>row.object.instanceId), axis, beforeContent: source.content,
    afterContent: serialize(model), changedPaths, beforeObjects, afterObjects: afterModel.objects.filter(item => instanceIds.includes(item.instanceId)).map(copy) });
  brands.add(proposal); return proposal;
}
async function fixture(t, options = {}) {
  let language = 'zh', listener = () => {}, supported = options.supported ?? true, loads = 0, unsubscribed = 0;
  const original = options.content || serialize(options.model || author()); let content = original;
  const context = { editable: true, creating: false, busy: false, sourceJSON: true, sourcePath: 'documents/boxes.scene3d.json', sourceToken: '1:0:0' };
  const proposals = [], calls = [], confirmations = [], alerts = [], snapshot = () => ({ sourcePath: context.sourcePath, token: context.sourceToken, content, baseSourceRevision: hash(original), sourceRevision: hash(content) });
  const translate = value => ({ en, ja }[language]?.[value] || value);
  const h = await dialogHarness('app-scene3d-distribution', { queueMicrotask, supportsStudioCoreScene3DDistributionPatch: () => supported, parseScene3DSource,
    createScene3DDistributionProposal(source, edit) { const proposal = (options.propose || stubProposal)(copy(source), copy(edit)); proposals.push(proposal); return proposal; },
    isScene3DDistributionProposal: value => brands.has(value) || isScene3DDistributionProposal(value),
    t: translate, translatePage(root) { for (const node of root.querySelectorAll('[data-i18n]')) node.textContent = translate(node.dataset.i18n); },
    onLanguageChange(fn) { listener = fn; return () => { unsubscribed++; listener = () => {}; }; },
  });
  h.runtime.window.alert = value => alerts.push(value); h.runtime.window.confirm = value => { confirmations.push(value); return options.confirm?.(value) ?? true; };
  let controller;
  controller = h.runtime.setupScene3DDistribution({ getContext: () => context, getSource: async () => { loads++; return options.source ? options.source(snapshot()) : snapshot(); },
    applyDraft: async (proposal, ports) => { calls.push({ proposal, ports }); const state = { context, snapshot, refresh: () => controller.refresh(), setContent(value) { content = value; } };
      if (options.apply) return options.apply(proposal, ports, state); assert.equal(ports.isCurrent(), true); content = proposal.afterContent; context.sourceToken += ':applied';
      if (options.refreshOnApply) controller.refresh(); return { applied: true, sourcePath: context.sourcePath, sourceToken: context.sourceToken, content, focus: options.focus };
    } });
  const el = suffix => h.element('scene3dDistribution' + suffix), settle = async () => { await flushDialogs(); await flushDialogs(); };
  const choices = () => el('Objects').querySelectorAll('input[type=checkbox]'), choice = id => choices().find(item => item.dataset.instanceId === id);
  const select = (id, checked = true, emit = true) => { const node = choice(id); assert.ok(node, id); node.checked = checked; if (emit) node.dispatch('change'); };
  const set = (suffix, value, emit = true) => { el(suffix).value = String(value); if (emit) el(suffix).dispatch(suffix === 'Axis' ? 'change' : 'input'); };
  const check = () => el('Check').click(), apply = async () => { el('Apply').click(); await settle(); };
  t.after(() => controller.dispose());
  return { ...h, controller, context, el, settle, choices, choice, select, set, check, apply, proposals, calls, confirmations, alerts, original, snapshot,
    open: () => controller.open(), content: () => content, loads: () => loads, unsubscribed: () => unsubscribed,
    setLanguage(value) { language = value; listener(); }, setSupported(value) { supported = value; } };
}
const distribute = (h, axis = 'x') => { h.select(one); h.select(two); h.select(three); h.set('Axis', axis); h.check(); };

test('independent entry gates JSON author context and optional distribution capability without sibling permission', async t => {
  const h=await fixture(t);assert.equal(h.el('Btn').hidden,false);
  for(const[key,value]of[['editable',false],['creating',true],['sourceJSON',false],['sourcePath',''],['sourceToken','']]){const old=h.context[key];h.context[key]=value;h.controller.refresh();assert.equal(await h.open(),false);assert.equal(h.el('Btn').hidden,true);h.context[key]=old;}
  h.context.busy=true;assert.equal(await h.open(),false);h.context.busy=false;h.setSupported(false);h.controller.refresh();assert.equal(h.el('Btn').disabled,true);assert.match(h.el('Btn').title,/其他3D/);assert.equal(h.el('Unavailable').hidden,false);assert.equal(h.loads(),0);
});
test('opening has no selected objects defaults only to authored X axis and renders author names as literal text',async t=>{
  const h=await fixture(t);await h.open();assert.ok(h.choices().every(row=>!row.checked));assert.equal(h.el('Axis').value,'x');assert.equal(h.el('Check').disabled,true);assert.equal(h.el('Apply').disabled,true);assert.equal(h.el('Objects').querySelector('span').textContent,'<b>Blue box</b>');assert.equal(h.el('Objects').querySelectorAll('b').length,0);assert.equal(h.el('Anchor'),null);assert.deepEqual(Object.keys(h.controller).sort(),['close','destroy','dispose','open','refresh']);assert.equal(h.content(),h.original);
});
test('zero one or two selected objects cannot call the proposal or application port',async t=>{
  const h=await fixture(t);await h.open();for(const id of [null,one,two]){if(id)h.select(id);assert.equal(h.el('Check').disabled,true);h.check();await h.apply();assert.equal(h.proposals.length,0);assert.equal(h.calls.length,0);}h.select(three);assert.equal(h.el('Check').disabled,false);
});
test('each authored axis reviews source-ordered objects and native-order distribution without touching other fields',async t=>{
  for(const axis of ['x','y','z']){const component=['x','y','z'].indexOf(axis),model=author();model.objects[0].position=[9,9,9];model.objects[1].position=[0,0,0];model.objects[2].position=[1,1,1];model.objects.push({...model.objects[0],instanceId:'00000000-0000-4000-8000-000000000004',name:'Unselected',position:[17,18,19]});const h=await fixture(t,{model});await h.open();distribute(h,axis);assert.equal(h.el('Apply').disabled,false);const p=h.proposals[0],next=JSON.parse(p.afterContent.replace(/^\ufeff/,''));assert.deepEqual(p.instanceIds,[one,two,three]);assert.deepEqual(p.orderedInstanceIds,[two,three,one]);assert.equal(p.axis,axis);assert.deepEqual(next.objects[0],model.objects[0]);assert.deepEqual(next.objects[1],model.objects[1]);assert.equal(next.objects[2].position[component],4.5);for(const n of [0,1,2].filter(n=>n!==component))assert.equal(next.objects[2].position[n],model.objects[2].position[n]);for(const key of ['instanceId','name','primitive','rotationDegrees','size','color'])assert.deepEqual(next.objects[2][key],model.objects[2][key]);assert.deepEqual(next.objects[3],model.objects[3]);assert.deepEqual(h.el('Ordered').children.map(node=>node.dataset.instanceId),[two,three,one]);assert.match(h.el('Impact').textContent,/两端原坐标：0, 9/);}
});
test('unchanged endpoints remain included in source-order before after while only net axis paths are reviewed',async t=>{
  const h=await fixture(t);await h.open();h.select(three);h.select(one);h.select(two);h.check();const p=h.proposals[0];assert.deepEqual(p.instanceIds,[one,two,three]);assert.deepEqual(p.orderedInstanceIds,[one,two,three]);assert.deepEqual(p.changedPaths,['/objects/1/position/0']);assert.deepEqual(p.beforeObjects[0],p.afterObjects[0]);assert.deepEqual(p.beforeObjects[2],p.afterObjects[2]);assert.deepEqual(JSON.parse(h.el('Before').textContent),p.beforeObjects);assert.equal(h.el('Source').textContent,p.afterContent);
});
test('equal original coordinates use declared order including signed-zero ties and show distinct distributed positions',async t=>{
  const model=author();model.objects[0].position[0]=-0;model.objects[1].position[0]=0;model.objects[2].position[0]=6;const h=await fixture(t,{model});await h.open();distribute(h);assert.deepEqual(h.proposals[0].orderedInstanceIds,[one,two,three]);assert.deepEqual(h.proposals[0].afterObjects.map(object=>object.position[0]),[0,3,6]);
});
test('all equal or already evenly spaced coordinates are native no-ops with no approval or draft write',async t=>{
  for(const positions of [[2,2,2],[0,3,6]]){const model=author();model.objects.forEach((object,i)=>object.position[0]=positions[i]);const h=await fixture(t,{model});await h.open();distribute(h);assert.equal(h.el('Apply').disabled,true);assert.match(h.el('Status').textContent,/未改变任何坐标/);assert.ok(h.choices().every(row=>row.checked));assert.equal(h.content(),h.original);assert.equal(h.calls.length,0);}
});
test('insufficient binary64 span is atomically rejected while raw selection and axis remain available',async t=>{
  const model=author();model.objects[0].position[0]=1;model.objects[1].position[0]=1;model.objects[2].position[0]=1+Number.EPSILON;const h=await fixture(t,{model});await h.open();distribute(h);assert.equal(h.el('Apply').disabled,true);assert.match(h.el('Diagnostic').textContent,/Binary64/);assert.ok(h.choices().every(row=>row.checked));assert.equal(h.el('Axis').value,'x');assert.equal(h.content(),h.original);assert.equal(h.calls.length,0);
});
test('query filters Unicode names or UUIDs while hidden selection remains in full distribution and order',async t=>{
  const h=await fixture(t);await h.open();h.select(one);h.select(two);h.select(three);h.set('Search',' BLUE ');h.check();assert.deepEqual(h.proposals[0].instanceIds,[one,two,three]);assert.match(h.el('Selection').textContent,/筛选结果外的已选对象：2/);h.set('Search','雪é');assert.equal(h.choices().length,1);h.set('Search','unknown');assert.equal(h.choices().length,0);assert.equal(h.el('NoResults').hidden,false);assert.equal(h.el('Check').disabled,false);
});
test('select current results is explicit and clear selection also clears the complete review',async t=>{
  const h=await fixture(t);await h.open();h.el('SelectResults').click();assert.equal(h.choices().filter(row=>row.checked).length,3);h.check();h.set('Search','雪');h.el('ClearSelection').click();assert.equal(h.el('Apply').disabled,true);assert.match(h.el('Selection').textContent,/已选对象：0/);
});
test('all 128 objects can be explicitly selected including hidden rows without a UI sorting algorithm',async t=>{
  const model=author();model.objects=Array.from({length:128},(_,i)=>({...model.objects[0],instanceId:'00000000-0000-4000-8000-'+String(i+1).padStart(12,'0'),name:'Box '+i,position:[i===127?500:i,0,0]}));const h=await fixture(t,{model});await h.open();h.el('SelectResults').click();h.set('Search','Box 0');h.check();assert.equal(h.proposals[0].instanceIds.length,128);assert.equal(h.proposals[0].orderedInstanceIds.length,128);assert.equal(h.el('Ordered').children.length,128);assert.equal(h.proposals[0].afterObjects[127].position[0],500);
});
test('ordinary axis selection or query edits revoke previous approval while retaining author intent',async t=>{
  for(const field of ['Axis','Search','selection']){const h=await fixture(t);await h.open();distribute(h);assert.equal(h.el('Apply').disabled,false);field==='selection'?h.select(two,false):h.set(field,field==='Axis'?'y':'雪');assert.equal(h.el('Apply').disabled,true);assert.equal(h.content(),h.original);}
});
test('silently changing a valid or invalid axis before Check cannot approve closed intent from a different visible form',async t=>{
  for(const value of ['y','bad']){const h=await fixture(t);await h.open();h.el('SelectResults').click();h.set('Axis',value,false);h.check();assert.equal(h.proposals.length,0);assert.equal(h.el('Apply').disabled,true);}
});
test('silent checkbox UUID or query before Check cannot mix displayed and bound selected targets',async t=>{
  for(const mutation of ['checkbox','id','query']){const h=await fixture(t);await h.open();h.el('SelectResults').click();if(mutation==='checkbox')h.select(two,false,false);if(mutation==='id')h.choice(one).dataset.instanceId=three;if(mutation==='query')h.set('Search','雪',false);h.check();assert.equal(h.proposals.length,0);assert.equal(h.el('Apply').disabled,true);}
});
test('silent axis checkbox UUID or query mutations cannot replay an approved distribution',async t=>{
  for(const mutation of ['axis','checkbox','id','query']){const h=await fixture(t);await h.open();distribute(h);if(mutation==='axis')h.set('Axis','y',false);if(mutation==='checkbox')h.select(two,false,false);if(mutation==='id')h.choice(one).dataset.instanceId=three;if(mutation==='query')h.set('Search','雪',false);await h.apply();assert.equal(h.calls.length,0);assert.equal(h.el('Apply').disabled,true);}
});
test('language changes preserve selection query axis complete candidate and native order without parsing again',async t=>{
  const h=await fixture(t);await h.open();distribute(h);h.set('Search','Blue');h.check();const p=h.el('Source').textContent,order=h.el('Ordered').children.map(node=>node.dataset.instanceId);for(const language of ['en','ja','zh']){h.setLanguage(language);assert.equal(h.el('Source').textContent,p);assert.equal(h.el('Apply').disabled,false);assert.equal(h.el('Axis').value,'x');assert.equal(h.el('Search').value,'Blue');assert.deepEqual(h.el('Ordered').children.map(node=>node.dataset.instanceId),order);assert.equal(h.loads(),1);}
});
test('new labels explain authored coordinates sorting and rounding in all three languages without translating names',async t=>{
  const source=await fs.readFile(new URL('../../web/modules/app-scene3d-distribution.js',import.meta.url),'utf8'),keys=[...source.matchAll(/data-i18n="([^"]+)"/g),...source.matchAll(/\bt\('([^']+)'\)/g)].map(m=>m[1]);for(const key of keys){assert.ok(en[key],key);assert.ok(ja[key],key);}const h=await fixture(t);await h.open();h.setLanguage('en');assert.equal(h.el('Title').textContent,'Distribute 3D positions evenly');assert.equal(h.el('Objects').querySelector('span').textContent,'<b>Blue box</b>');
});
test('Cancel and Escape honor discard without applying and ignore composing or repeated keys',async t=>{
  let discard=false;const h=await fixture(t,{confirm:()=>discard});await h.open();distribute(h);h.el('Cancel').click();assert.equal(h.el('Dialog').open,true);assert.equal(h.el('Apply').disabled,false);const event=h.el('Dialog').dispatch('keydown',{key:'Escape'});assert.equal(event.defaultPrevented,true);discard=true;for(const state of [{repeat:true},{isComposing:true},{keyCode:229}]){h.el('Dialog').dispatch('keydown',{key:'Escape',...state});assert.equal(h.el('Dialog').open,true);}h.el('Dialog').dispatch('keydown',{key:'Escape'});assert.equal(h.el('Dialog').open,false);assert.equal(h.calls.length,0);assert.equal(h.content(),h.original);
});
test('checkbox focus survives list rebuild and query does not steal search focus',async t=>{
  const h=await fixture(t);await h.open();h.choice(two).focus();h.select(two);assert.equal(h.document.activeElement.dataset.instanceId,two);h.setLanguage('ja');assert.equal(h.document.activeElement.dataset.instanceId,two);h.el('Search').focus();h.set('Search','Blue');assert.equal(h.document.activeElement,h.el('Search'));
});
test('same-path reload revokes approval but retains selection and axis while path navigation closes',async t=>{
  const h=await fixture(t);await h.open();distribute(h,'y');h.context.sourceToken+=':reload';h.controller.refresh();assert.equal(h.el('Axis').value,'y');assert.equal(h.choice(two).checked,true);assert.equal(h.el('Check').disabled,true);await h.apply();assert.equal(h.calls.length,0);h.context.sourcePath='other.json';h.controller.refresh();assert.equal(h.el('Dialog').open,false);
});
test('late source success or failure after close cannot reopen or alert',async t=>{
  for(const reject of [false,true]){const gate=deferred(),h=await fixture(t,{source:()=>gate.promise}),opened=h.open();h.controller.close(true);reject?gate.reject(Error('Late')):gate.resolve(h.snapshot());assert.equal(await opened,false);assert.equal(h.el('Dialog').open,false);assert.deepEqual(h.alerts,[]);}
});
test('source token path and malformed snapshots reject stale reads before local approval',async t=>{
  const gate=deferred(),h=await fixture(t,{source:()=>gate.promise}),snapshot=h.snapshot(),opened=h.open();h.context.sourceToken='new';gate.resolve(snapshot);assert.equal(await opened,false);assert.equal(h.el('Fields').hidden,true);for(const delta of [{sourcePath:'wrong'},{token:'wrong'},{content:'{}'}]){const bad=await fixture(t,{source:source=>({...source,...delta})});assert.equal(await bad.open(),false);assert.equal(bad.el('Check').disabled,true);}
});
test('old opening completion cannot replace a new form selection or axis',async t=>{
  const gate=deferred();let reads=0;const h=await fixture(t,{source:snapshot=>++reads===1?gate.promise:snapshot}),opened=h.open();h.controller.close(true);await h.open();h.select(two);h.set('Axis','z');gate.resolve(h.snapshot());assert.equal(await opened,false);assert.equal(h.el('Axis').value,'z');assert.equal(h.choice(two).checked,true);
});
test('foreign clone or malformed native candidate identity order axis fields and paths cannot gain approval',async t=>{
  for(const mutation of ['brand','kind','ids','missing-order','duplicate-order','foreign-order','axis','path','token','before','after','after-position','paths']){const h=await fixture(t,{propose:(source,edit)=>{const p=copy(stubProposal(source,edit));if(mutation!=='brand')brands.add(p);if(mutation==='kind')p.kind='scene3d-alignment';if(mutation==='ids')p.instanceIds=[one,two];if(mutation==='missing-order')delete p.orderedInstanceIds;if(mutation==='duplicate-order')p.orderedInstanceIds=[one,two,two];if(mutation==='foreign-order')p.orderedInstanceIds=[one,two,'00000000-0000-4000-8000-000000000009'];if(mutation==='axis')p.axis='y';if(mutation==='path')p.sourcePath='other';if(mutation==='token')p.sourceToken='other';if(mutation==='before')p.beforeObjects=[];if(mutation==='after')p.afterContent=p.beforeContent;if(mutation==='after-position')p.afterObjects[0].position=null;if(mutation==='paths')p.changedPaths=[];return p;}});await h.open();distribute(h);assert.equal(h.el('Apply').disabled,true,mutation);await h.apply();assert.equal(h.calls.length,0,mutation);}
});
test('privately branded exact candidate applies only memory and an advanced owner receipt returns focus once',async t=>{
  let focused=0;const h=await fixture(t,{focus:()=>focused++});await h.open();distribute(h);const p=h.proposals[0];await h.apply();assert.equal(h.calls[0].proposal,p);assert.equal(h.content(),p.afterContent);assert.notEqual(h.context.sourceToken,p.sourceToken);assert.equal(h.el('Dialog').open,false);assert.equal(focused,1);
});
test('host refresh during legitimate token advancement preserves private pending approval',async t=>{
  const h=await fixture(t,{refreshOnApply:true});await h.open();distribute(h);await h.apply();assert.equal(h.el('Dialog').open,false);assert.equal(h.content(),h.proposals[0].afterContent);assert.equal(h.calls.length,1);
});
test('false or forged path content and advanced current-token receipts cannot close the source form',async t=>{
  for(const mutation of ['path','content','old-token','empty-token','current-token','false','null']){const h=await fixture(t,{apply:(p,ports,state)=>{assert.equal(ports.isCurrent(),true);state.context.sourceToken='next';const r={applied:true,sourcePath:p.sourcePath,sourceToken:'next',content:p.afterContent};if(mutation==='path')r.sourcePath='other';if(mutation==='content')r.content=p.beforeContent;if(mutation==='old-token'){r.sourceToken=p.sourceToken;state.context.sourceToken=p.sourceToken;}if(mutation==='empty-token')r.sourceToken='';if(mutation==='current-token')state.context.sourceToken='other-current';if(mutation==='false')r.applied=false;return mutation==='null'?null:r;}});await h.open();distribute(h);await h.apply();assert.equal(h.el('Dialog').open,true,mutation);assert.match(h.el('Diagnostic').textContent,/receipt/,mutation);}
});
test('pending Apply locks global selection axis and query while Cancel revokes late completion',async t=>{
  const gate=deferred();let focused=0;const h=await fixture(t,{apply:()=>gate.promise});await h.open();distribute(h);h.el('Apply').click();for(const field of ['Search','SelectResults','ClearSelection','Axis','Check','Apply'])assert.equal(h.el(field).disabled,true,field);assert.ok(h.choices().every(row=>row.disabled));assert.equal(h.el('Cancel').disabled,false);h.el('Cancel').click();assert.equal(h.calls[0].ports.isCurrent(),false);gate.resolve({applied:true,sourcePath:h.context.sourcePath,sourceToken:'next',content:h.proposals[0].afterContent,focus:()=>focused++});await h.settle();assert.equal(h.el('Dialog').open,false);assert.equal(focused,0);
});
test('silent axis checkbox or query mutations across apply await revoke guard and receipt',async t=>{
  for(const mutation of ['axis','checkbox','query']){const gate=deferred(),h=await fixture(t,{apply:()=>gate.promise});await h.open();distribute(h);h.el('Apply').click();if(mutation==='axis')h.set('Axis','y',false);if(mutation==='checkbox')h.select(two,false,false);if(mutation==='query')h.set('Search','Blue',false);assert.equal(h.calls[0].ports.isCurrent(),false);h.context.sourceToken='next';gate.resolve({applied:true,sourcePath:h.context.sourcePath,sourceToken:'next',content:h.proposals[0].afterContent});await h.settle();assert.equal(h.el('Dialog').open,true);assert.match(h.el('Diagnostic').textContent,/receipt/);}
});
test('close and reopen during application preserve a new form from an old completion',async t=>{
  const gate=deferred(),h=await fixture(t,{apply:()=>gate.promise});await h.open();distribute(h);h.el('Apply').click();h.controller.close(true);await h.open();h.select(two);h.set('Axis','z');gate.resolve({applied:true});await h.settle();assert.equal(h.el('Dialog').open,true);assert.equal(h.el('Axis').value,'z');assert.equal(h.choice(two).checked,true);
});
test('duplicate Apply and late errors neither add requests nor discard selection and axis',async t=>{
  const gate=deferred(),h=await fixture(t,{apply:()=>gate.promise});await h.open();distribute(h);h.el('Apply').click();h.el('Apply').click();assert.equal(h.calls.length,1);gate.reject(Error('Late error'));await h.settle();assert.equal(h.el('Axis').value,'x');assert.equal(h.el('Dialog').open,true);
});
test('optional native capability loss invalidates approved Apply only for this domain',async t=>{
  const h=await fixture(t);await h.open();distribute(h);h.setSupported(false);h.controller.refresh();assert.equal(h.el('Btn').disabled,true);assert.equal(h.el('Check').disabled,true);await h.apply();assert.equal(h.calls.length,0);assert.ok(h.element('projectBuildBtn'));assert.equal(h.choice(one).checked,true);
});
test('dispose is idempotent and removes only local UI while late reads remain ignored',async t=>{
  const gate=deferred(),h=await fixture(t,{source:()=>gate.promise}),opened=h.open();h.controller.dispose();h.controller.dispose();gate.resolve(h.snapshot());assert.equal(await opened,false);assert.equal(await h.open(),false);assert.equal(h.el('Dialog'),null);assert.equal(h.unsubscribed(),1);assert.ok(h.element('projectBuildBtn'));
});
test('CSS uses scoped hidden priority and UI imports no distribution math renderer sibling World HTTP or Save port',async()=>{
  const source=await fs.readFile(new URL('../../web/modules/app-scene3d-distribution.js',import.meta.url),'utf8'),css=await fs.readFile(new URL('../../web/scene3d-distribution.css',import.meta.url),'utf8');assert.match(css,/\.scene3d-distribution-dialog \[hidden\]\s*\{\s*display:none!important/);assert.equal(/style=|\.style\./.test(source),false);assert.equal(/import.*(renderer|app-scene3d-(transforms|objects|properties|environment|translation|alignment)|runtime|world|build)/.test(source),false);assert.equal(/fetch\(|saveDraft|WorldCommand|\.save\(|\.sort\(/.test(source),false);
});
test('actual native private distribution proposal integrates with local review and strict memory apply',async t=>{
  assert.equal(supportsStudioCoreScene3DDistributionPatch(),true);const h=await fixture(t,{propose:createScene3DDistributionProposal,apply:async(p,ports,state)=>{assert.equal(isScene3DDistributionProposal(p),true);assert.equal(ports.isCurrent(),true);const result=await prepareScene3DDistributionApply(state.snapshot(),p,{digest:async raw=>hash(raw).slice(7)});assert.equal(result.afterContent,p.afterContent);state.setContent(result.afterContent);state.context.sourceToken='advanced-native';return{applied:true,sourcePath:p.sourcePath,sourceToken:state.context.sourceToken,content:result.afterContent};}});await h.open();distribute(h);assert.equal(h.el('Apply').disabled,false);assert.equal(isScene3DDistributionProposal(h.proposals[0]),true);await h.apply();assert.equal(h.el('Dialog').open,false);assert.deepEqual(JSON.parse(h.content().replace(/^\ufeff/,'')).objects.map(object=>object.position),[[0,1,0],[50000,0,0],[100000,0,0]]);
});
test('closed-owner checkbox cannot select a new same-path session after reopen',async t=>{
  const h=await fixture(t);await h.open();const old=h.choice(one);h.controller.close(true);h.context.sourceToken='new-session';await h.open();old.checked=true;old.dispatch('change');assert.ok(h.choices().every(row=>!row.checked));assert.equal(h.el('Check').disabled,true);assert.equal(h.proposals.length,0);h.select(two);assert.equal(h.choice(two).checked,true);
});
test('obsolete query generation checkbox cannot alter current selection or its approved source',async t=>{
  const h=await fixture(t);await h.open();distribute(h);const old=h.choice(one);h.set('Search','Blue');h.check();const source=h.el('Source').textContent;old.checked=false;old.dispatch('change');assert.equal(h.choice(one).checked,true);assert.equal(h.el('Apply').disabled,false);assert.equal(h.el('Source').textContent,source);h.el('Objects').append(old);old.dispatch('change');h.el('Objects').replaceChildren(...h.el('Objects').children.filter(node=>node!==old));assert.equal(h.el('Source').textContent,source);assert.equal(h.calls.length,0);
});
test('current row with a silently replaced UUID cannot change its bound selected identity',async t=>{
  const h=await fixture(t);await h.open();const row=h.choice(one);row.dataset.instanceId=two;row.checked=true;row.dispatch('change');assert.equal(h.el('Check').disabled,true);h.controller.refresh();assert.ok(h.choices().every(row=>!row.checked));
});
