import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dialogHarness, flushDialogs } from './dialog-harness.mjs';
import { deferred } from './editor-harness.mjs';
import { parseScene3DSource } from '../../engine/scene3d.mjs';
import { createScene3DCopyProposal, isScene3DCopyProposal, prepareScene3DCopyApply } from '../../engine/scene3d-copy.mjs';
import { supportsStudioCoreScene3DCopyPatch } from '../../engine/studio-core.mjs';
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
function stubProposal(source, { copies, offset }) {
  const model = JSON.parse(source.content.replace(/^\ufeff/, '')), byId = new Map(copies.map(pair=>[pair.sourceInstanceId,pair.newInstanceId])), ordered = model.objects.filter(object=>byId.has(object.instanceId));
  if (!copies.length || model.objects.length+copies.length>128 || new Set(copies.map(pair=>pair.newInstanceId)).size!==copies.length || copies.some(pair=>model.objects.some(object=>object.instanceId===pair.newInstanceId))) throw Object.assign(Error('Invalid copy identity or capacity'),{errorCode:'scene3d_copy_invalid'});
  const beforeObjects = parseScene3DSource(source.content).model.objects.filter(item=>byId.has(item.instanceId)).map(copy), count=model.objects.length;
  const clones = ordered.map(object=>({...copy(object),instanceId:byId.get(object.instanceId),position:object.position.map((value,n)=>value+offset[n])}));
  if (clones.some(object=>object.position.some(value=>value<-100000||value>100000))) throw Object.assign(Error('Atomic copy position out of bounds'),{errorCode:'scene3d_copy_invalid'});
  model.objects.push(...clones);const afterContent=serialize(model), afterObjects=parseScene3DSource(afterContent).model.objects.slice(count).map(copy);
  const proposal=freeze({kind:'scene3d-copy',sourcePath:source.sourcePath,sourceToken:source.token,baseSourceRevision:source.baseSourceRevision,sourceRevision:source.sourceRevision,
    copies:ordered.map(object=>({sourceInstanceId:object.instanceId,newInstanceId:byId.get(object.instanceId)})),offset:copy(offset),beforeContent:source.content,afterContent,
    changedPaths:clones.map((_object,i)=>'/objects/'+(count+i)),beforeObjects,afterObjects});brands.add(proposal);return proposal;
}
async function fixture(t, options = {}) {
  let uuidCount=0; const nextUuid=()=>{uuidCount++;return options.uuid?options.uuid(uuidCount):'00000000-0000-4000-8000-'+String(100000+uuidCount).padStart(12,'0');};
  let language = 'zh', listener = () => {}, supported = options.supported ?? true, loads = 0, unsubscribed = 0;
  const original = options.content || serialize(options.model || author()); let content = original;
  const context = { editable: true, creating: false, busy: false, sourceJSON: true, sourcePath: 'documents/boxes.scene3d.json', sourceToken: '1:0:0' };
  const proposals = [], calls = [], confirmations = [], alerts = [], snapshot = () => ({ sourcePath: context.sourcePath, token: context.sourceToken, content, baseSourceRevision: hash(original), sourceRevision: hash(content) });
  const translate = value => ({ en, ja }[language]?.[value] || value);
  const h = await dialogHarness('app-scene3d-copy', { queueMicrotask, crypto:{randomUUID:nextUuid}, supportsStudioCoreScene3DCopyPatch: () => supported, parseScene3DSource,
    createScene3DCopyProposal(source, edit) { const proposal = (options.propose || stubProposal)(copy(source), copy(edit)); proposals.push(proposal); return proposal; },
    isScene3DCopyProposal: value => brands.has(value) || isScene3DCopyProposal(value),
    t: translate, translatePage(root) { for (const node of root.querySelectorAll('[data-i18n]')) node.textContent = translate(node.dataset.i18n); },
    onLanguageChange(fn) { listener = fn; return () => { unsubscribed++; listener = () => {}; }; },
  });
  h.runtime.window.alert = value => alerts.push(value); h.runtime.window.confirm = value => { confirmations.push(value); return options.confirm?.(value) ?? true; };
  let controller;
  controller = h.runtime.setupScene3DCopy({ getContext: () => context, getSource: async () => { loads++; return options.source ? options.source(snapshot()) : snapshot(); },
    applyDraft: async (proposal, ports) => { calls.push({ proposal, ports }); const state = { context, snapshot, refresh: () => controller.refresh(), setContent(value) { content = value; } };
      if (options.apply) return options.apply(proposal, ports, state); assert.equal(ports.isCurrent(), true); content = proposal.afterContent; context.sourceToken += ':applied';
      if (options.refreshOnApply) controller.refresh(); return { applied: true, sourcePath: context.sourcePath, sourceToken: context.sourceToken, content, focus: options.focus };
    } });
  const el = suffix => h.element('scene3dCopy' + suffix), settle = async () => { await flushDialogs(); await flushDialogs(); };
  const choices = () => el('Objects').querySelectorAll('input[type=checkbox]'), choice = id => choices().find(item => item.dataset.instanceId === id);
  const select = (id, checked = true, emit = true) => { const node = choice(id); assert.ok(node, id); node.checked = checked; if (emit) node.dispatch('change'); };
  const set = (suffix, value, emit = true) => { el(suffix).value = String(value); if (emit) el(suffix).dispatch('input'); };
  const check = () => el('Check').click(), apply = async () => { el('Apply').click(); await settle(); };
  t.after(() => controller.dispose());
  return { ...h, controller, context, el, settle, choices, choice, select, set, check, apply, proposals, calls, confirmations, alerts, original, snapshot,
    open: () => controller.open(), content: () => content, loads: () => loads, unsubscribed: () => unsubscribed,
    setLanguage(value) { language = value; listener(); }, setSupported(value) { supported = value; }, uuidCount:()=>uuidCount,
    mapping:()=>el('Mapping').children.map(item=>({sourceInstanceId:item.dataset.sourceInstanceId,newInstanceId:item.dataset.newInstanceId})) };
}
const copyPair = (h, offset=[0,0,0]) => { h.select(one); h.select(two); ['X','Y','Z'].forEach((axis,n)=>h.set(axis,offset[n])); h.check(); };

test('independent entry gates JSON author source and optional copy capability without acquiring siblings',async t=>{
 const h=await fixture(t);assert.equal(h.el('Btn').hidden,false);for(const[key,value]of[['editable',false],['creating',true],['sourceJSON',false],['sourcePath',''],['sourceToken','']]){const old=h.context[key];h.context[key]=value;h.controller.refresh();assert.equal(await h.open(),false);h.context[key]=old;}h.context.busy=true;assert.equal(await h.open(),false);h.context.busy=false;h.setSupported(false);h.controller.refresh();assert.equal(h.el('Btn').disabled,true);assert.match(h.el('Btn').title,/其他3D/);assert.equal(h.loads(),0);assert.equal(h.uuidCount(),0);
});
test('opening defaults to no sources zero offsets explicit capacity and no allocated identities',async t=>{
 const h=await fixture(t);await h.open();assert.ok(h.choices().every(row=>!row.checked));assert.equal(h.uuidCount(),0);assert.deepEqual(h.mapping(),[]);for(const axis of ['X','Y','Z'])assert.equal(h.el(axis).value,'0');assert.match(h.el('Capacity').textContent,/剩余对象名额：125/);assert.match(h.el('Capacity').textContent,/本次最多复制数量：3/);assert.equal(h.el('Check').disabled,true);assert.equal(h.el('Apply').disabled,true);assert.equal(h.el('Objects').querySelector('span').textContent,'<b>Blue box</b>');assert.equal(h.el('Objects').querySelectorAll('b').length,0);assert.deepEqual(Object.keys(h.controller).sort(),['close','destroy','dispose','open','refresh']);
});
test('one selected source and zero offset is a structural copy with an unchanged source and fresh UUID',async t=>{
 const h=await fixture(t);await h.open();h.select(one);h.check();const p=h.proposals[0],next=JSON.parse(p.afterContent.replace(/^\ufeff/,''));assert.equal(h.el('Apply').disabled,false);assert.equal(h.uuidCount(),1);assert.deepEqual(p.copies,h.mapping());assert.deepEqual(next.objects.slice(0,3),author().objects);assert.equal(next.objects.length,4);assert.equal(next.objects[3].name,author().objects[0].name);assert.equal(next.objects[3].instanceId,p.copies[0].newInstanceId);assert.deepEqual(next.objects[3].position,author().objects[0].position);assert.deepEqual(p.changedPaths,['/objects/3']);assert.equal(h.content(),h.original);
});
test('recheck offset query and language changes never regenerate allocated identities',async t=>{
 const h=await fixture(t);await h.open();copyPair(h);const mapping=h.mapping();h.check();h.set('X',3);h.set('Search','Blue');h.check();for(const language of ['en','ja','zh'])h.setLanguage(language);assert.equal(h.uuidCount(),2);assert.deepEqual(h.mapping(),mapping);assert.deepEqual(h.proposals.at(-1).copies,mapping);assert.equal(h.el('Apply').disabled,false);
});
test('deselect reselect and clear selection reuse the same per-source identities within one dialog',async t=>{
 const h=await fixture(t);await h.open();h.select(one);const first=h.mapping()[0];h.select(one,false);assert.deepEqual(h.mapping(),[]);h.select(one);assert.deepEqual(h.mapping(),[first]);h.select(two);const all=h.mapping();h.el('ClearSelection').click();assert.deepEqual(h.mapping(),[]);h.select(two);h.select(one);assert.deepEqual(h.mapping(),all);assert.equal(h.uuidCount(),2);
});
test('close and reopen clear the allocation map and allocate fresh IDs on a new explicit selection',async t=>{
 const h=await fixture(t);await h.open();h.select(one);const first=h.mapping()[0].newInstanceId;h.controller.close(true);await h.open();assert.deepEqual(h.mapping(),[]);assert.equal(h.uuidCount(),1);h.select(one);assert.notEqual(h.mapping()[0].newInstanceId,first);assert.equal(h.uuidCount(),2);
});
test('global selections and cloned append order use source declaration order rather than click order',async t=>{
 const h=await fixture(t);await h.open();h.select(two);h.select(one);h.set('X',4);h.set('Y',-2);h.set('Z',.5);h.check();const p=h.proposals[0],next=JSON.parse(p.afterContent.replace(/^\ufeff/,''));assert.deepEqual(p.copies.map(pair=>pair.sourceInstanceId),[one,two]);assert.deepEqual(p.beforeObjects.map(object=>object.instanceId),[one,two]);assert.deepEqual(next.objects.slice(0,3),author().objects);assert.deepEqual(p.afterObjects.map(object=>object.instanceId),p.copies.map(pair=>pair.newInstanceId));assert.deepEqual(p.afterObjects.map(object=>object.position),[[4,-1,.5],[6,-2,.5]]);for(const[i,object]of p.afterObjects.entries())for(const key of ['name','primitive','rotationDegrees','size','color'])assert.deepEqual(object[key],author().objects[i][key]);assert.deepEqual(p.changedPaths,['/objects/3','/objects/4']);
});
test('query filters list only while hidden sources remain in the mapping and complete copy candidate',async t=>{
 const h=await fixture(t);await h.open();copyPair(h);h.set('Search',' BLUE ');h.check();assert.equal(h.choices().length,1);assert.equal(h.mapping().length,2);assert.deepEqual(h.proposals.at(-1).copies.map(pair=>pair.sourceInstanceId),[one,two]);assert.match(h.el('Selection').textContent,/筛选结果外的已选对象：1/);h.set('Search','unknown');assert.equal(h.el('NoResults').hidden,false);assert.equal(h.el('Check').disabled,false);assert.equal(h.mapping().length,2);
});
test('select current results is explicit and allocates only newly encountered sources',async t=>{
 const h=await fixture(t);await h.open();h.set('Search','Blue');h.el('SelectResults').click();assert.equal(h.mapping().length,1);assert.equal(h.uuidCount(),1);h.el('SelectResults').click();assert.equal(h.uuidCount(),1);h.set('Search','');h.el('SelectResults').click();assert.equal(h.mapping().length,3);assert.equal(h.uuidCount(),3);h.el('ClearSelection').click();assert.equal(h.el('Apply').disabled,true);assert.equal(h.mapping().length,0);
});
test('64 explicitly selected sources exactly fill 128 total objects while source declarations remain unchanged',async t=>{
 const model=author();model.objects=Array.from({length:64},(_,i)=>({...model.objects[0],instanceId:'00000000-0000-4000-8000-'+String(i+1).padStart(12,'0'),name:'Source '+i,position:[i,0,0]}));const h=await fixture(t,{model});await h.open();h.el('SelectResults').click();h.check();assert.equal(h.el('Apply').disabled,false);assert.equal(h.proposals[0].copies.length,64);assert.equal(JSON.parse(h.proposals[0].afterContent.replace(/^\ufeff/,'')).objects.length,128);assert.equal(h.proposals[0].beforeObjects.length,64);assert.match(h.el('Capacity').textContent,/64 → 128/);assert.equal(h.uuidCount(),64);
});
test('selection exceeding remaining capacity is blocked without calling proposal and retains explicit choices',async t=>{
 const model=author();model.objects=Array.from({length:65},(_,i)=>({...model.objects[0],instanceId:'00000000-0000-4000-8000-'+String(i+1).padStart(12,'0')}));const h=await fixture(t,{model});await h.open();h.el('SelectResults').click();assert.equal(h.el('Check').disabled,true);assert.match(h.el('Blocked').textContent,/超过剩余容量/);h.check();assert.equal(h.proposals.length,0);assert.equal(h.mapping().length,65);h.select(model.objects[0].instanceId,false);h.select(model.objects[1].instanceId,false);h.check();assert.equal(h.el('Apply').disabled,false);assert.equal(h.proposals[0].copies.length,63);
});
test('a 128-object scene explains zero capacity and cannot approve a copy',async t=>{
 const model=author();model.objects=Array.from({length:128},(_,i)=>({...model.objects[0],instanceId:'00000000-0000-4000-8000-'+String(i+1).padStart(12,'0')}));const h=await fixture(t,{model});await h.open();assert.match(h.el('Capacity').textContent,/剩余对象名额：0/);assert.match(h.el('Blocked').textContent,/128/);h.select(one);h.check();assert.equal(h.proposals.length,0);assert.equal(h.el('Apply').disabled,true);assert.equal(h.content(),h.original);
});
test('one out-of-bounds copy rejects the entire batch while offset and mappings remain unchanged',async t=>{
 const h=await fixture(t);await h.open();h.select(one);h.select(three);h.set('X',1);const mapping=h.mapping();h.check();assert.equal(h.el('Apply').disabled,true);assert.match(h.el('Diagnostic').textContent,/out of bounds/);assert.deepEqual(h.mapping(),mapping);assert.equal(h.el('X').value,'1');assert.equal(h.content(),h.original);assert.equal(h.calls.length,0);
});
test('unfinished nonfinite and outside-range offset values cannot authorize copy',async t=>{
 for(const value of ['', '-', 'Infinity', 'NaN','200001','-200001']){const h=await fixture(t);await h.open();h.select(one);h.set('X',value);h.check();assert.equal(h.el('Apply').disabled,true,value);assert.equal(h.el('X').value,value);assert.equal(h.calls.length,0);}
});
test('ordinary source selection offset or query changes revoke approval and retain allocated UUIDs',async t=>{
 for(const mutation of ['selection','offset','query']){const h=await fixture(t);await h.open();copyPair(h);const mapping=h.mapping();if(mutation==='selection')h.select(two,false);if(mutation==='offset')h.set('X',3);if(mutation==='query')h.set('Search','雪');assert.equal(h.el('Apply').disabled,true);assert.equal(h.uuidCount(),2);if(mutation!=='selection')assert.deepEqual(h.mapping(),mapping);assert.equal(h.content(),h.original);}
});
test('silent checkbox UUID query or displayed new identity before Check cannot authorize closed intent',async t=>{
 for(const mutation of ['checkbox','id','query','mapping-id','mapping-text']){const h=await fixture(t);await h.open();h.select(one);h.select(two);if(mutation==='checkbox')h.select(two,false,false);if(mutation==='id')h.choice(one).dataset.instanceId=three;if(mutation==='query')h.set('Search','雪',false);if(mutation==='mapping-id')h.el('Mapping').children[0].dataset.newInstanceId=three;if(mutation==='mapping-text')h.el('Mapping').querySelector('.scene3d-copy-new-id').textContent=three;h.check();assert.equal(h.proposals.length,0,mutation);assert.equal(h.el('Apply').disabled,true);}
});
test('silent offset checkbox UUID query or copy mapping after review cannot replay application',async t=>{
 for(const mutation of ['offset','checkbox','id','query','mapping-id','mapping-text']){const h=await fixture(t);await h.open();copyPair(h);if(mutation==='offset')h.set('X',9,false);if(mutation==='checkbox')h.select(two,false,false);if(mutation==='id')h.choice(one).dataset.instanceId=three;if(mutation==='query')h.set('Search','雪',false);if(mutation==='mapping-id')h.el('Mapping').children[0].dataset.sourceInstanceId=three;if(mutation==='mapping-text')h.el('Mapping').querySelector('.scene3d-copy-source-id').textContent=three;await h.apply();assert.equal(h.calls.length,0,mutation);assert.equal(h.el('Apply').disabled,true);}
});
test('invalid or duplicate UUID allocation fails without partially selecting a source or authorizing copy',async t=>{
 for(const uuid of ['invalid',one,'00000000-0000-4000-8000-000000100001']){const h=await fixture(t,{uuid:()=>uuid});await h.open();h.select(one);if(uuid.endsWith('100001')){assert.equal(h.mapping().length,1);h.select(two);assert.equal(h.mapping().length,1);}else assert.equal(h.mapping().length,0);assert.equal(h.el('Apply').disabled,true);assert.equal(h.content(),h.original);}
});
test('language switching preserves raw offsets hidden selection mapping and full approved source',async t=>{
 const h=await fixture(t);await h.open();copyPair(h,[4,-2,.5]);h.set('Search','Blue');h.check();const source=h.el('Source').textContent,mapping=h.mapping();for(const language of ['en','ja','zh']){h.setLanguage(language);assert.equal(h.el('Source').textContent,source);assert.deepEqual(h.mapping(),mapping);assert.equal(h.el('Apply').disabled,false);assert.equal(h.el('Search').value,'Blue');assert.equal(h.el('X').value,'4');assert.equal(h.uuidCount(),2);assert.equal(h.loads(),1);}
});
test('all new literal labels are translated while names and identity maps remain plain author data',async t=>{
 const source=await fs.readFile(new URL('../../web/modules/app-scene3d-copy.js',import.meta.url),'utf8');for(const m of [...source.matchAll(/data-i18n="([^"]+)"/g),...source.matchAll(/\bt\('([^']+)'\)/g)]){assert.ok(en[m[1]],m[1]);assert.ok(ja[m[1]],m[1]);}const h=await fixture(t);await h.open();h.select(one);h.setLanguage('en');assert.equal(h.el('Title').textContent,'Copy 3D objects in bulk');assert.equal(h.el('Mapping').querySelector('span').textContent,'<b>Blue box</b>');assert.equal(h.el('Mapping').querySelector('b'),null);
});
test('Cancel and Escape honor discard and never implicitly apply or Save',async t=>{
 let discard=false;const h=await fixture(t,{confirm:()=>discard});await h.open();copyPair(h);const mapping=h.mapping();h.el('Cancel').click();assert.equal(h.el('Dialog').open,true);assert.deepEqual(h.mapping(),mapping);assert.equal(h.el('Apply').disabled,false);const event=h.el('Dialog').dispatch('keydown',{key:'Escape'});assert.equal(event.defaultPrevented,true);discard=true;for(const state of [{repeat:true},{isComposing:true},{keyCode:229}]){h.el('Dialog').dispatch('keydown',{key:'Escape',...state});assert.equal(h.el('Dialog').open,true);}h.el('Dialog').dispatch('keydown',{key:'Escape'});assert.equal(h.el('Dialog').open,false);assert.equal(h.calls.length,0);assert.equal(h.content(),h.original);
});
test('list checkbox focus survives rebuild and query does not steal search focus',async t=>{
 const h=await fixture(t);await h.open();h.choice(two).focus();h.select(two);assert.equal(h.document.activeElement.dataset.instanceId,two);h.setLanguage('ja');assert.equal(h.document.activeElement.dataset.instanceId,two);h.el('Search').focus();h.set('Search','Blue');assert.equal(h.document.activeElement,h.el('Search'));
});
test('same-path source replacement revokes approval but retains selection identities and offsets until path navigation closes',async t=>{
 const h=await fixture(t);await h.open();copyPair(h,[2,3,4]);const mapping=h.mapping();h.context.sourceToken+=':reload';h.controller.refresh();assert.deepEqual(h.mapping(),mapping);assert.equal(h.el('X').value,'2');assert.equal(h.el('Check').disabled,true);await h.apply();assert.equal(h.calls.length,0);h.context.sourcePath='other.json';h.controller.refresh();assert.equal(h.el('Dialog').open,false);
});
test('late source success and failure after cancel cannot reopen or report into a released dialog',async t=>{
 for(const reject of [false,true]){const gate=deferred(),h=await fixture(t,{source:()=>gate.promise}),opened=h.open();h.controller.close(true);reject?gate.reject(Error('Late')):gate.resolve(h.snapshot());assert.equal(await opened,false);assert.equal(h.el('Dialog').open,false);assert.equal(h.uuidCount(),0);assert.deepEqual(h.alerts,[]);}
});
test('source token path or malformed snapshot changes reject stale opening before identity allocation',async t=>{
 const gate=deferred(),h=await fixture(t,{source:()=>gate.promise}),snapshot=h.snapshot(),opened=h.open();h.context.sourceToken='new';gate.resolve(snapshot);assert.equal(await opened,false);assert.equal(h.el('Fields').hidden,true);for(const delta of [{sourcePath:'wrong'},{token:'wrong'},{content:'{}'}]){const bad=await fixture(t,{source:s=>({...s,...delta})});assert.equal(await bad.open(),false);assert.equal(bad.uuidCount(),0);assert.equal(bad.el('Check').disabled,true);}
});
test('old opening completion cannot replace a newly opened identity map or raw offset',async t=>{
 const gate=deferred();let reads=0;const h=await fixture(t,{source:s=>++reads===1?gate.promise:s}),opened=h.open();h.controller.close(true);await h.open();h.select(two);h.set('X',7);const mapping=h.mapping();gate.resolve(h.snapshot());assert.equal(await opened,false);assert.deepEqual(h.mapping(),mapping);assert.equal(h.el('X').value,'7');
});
test('foreign clone or malformed candidate pairs offset source cloned IDs paths and inventory cannot gain approval',async t=>{
 for(const mutation of ['brand','kind','pairs','offset','path','token','before','after','clone-id','paths','original-change']){const h=await fixture(t,{propose:(source,edit)=>{const p=copy(stubProposal(source,edit));if(mutation!=='brand')brands.add(p);if(mutation==='kind')p.kind='scene3d-translation';if(mutation==='pairs')p.copies.reverse();if(mutation==='offset')p.offset[0]++;if(mutation==='path')p.sourcePath='other';if(mutation==='token')p.sourceToken='other';if(mutation==='before')p.beforeObjects=[];if(mutation==='after')p.afterContent=p.beforeContent;if(mutation==='clone-id')p.afterObjects[0].instanceId=one;if(mutation==='paths')p.changedPaths=[];if(mutation==='original-change'){const next=JSON.parse(p.afterContent.replace(/^\ufeff/,''));next.objects[0].name='changed original';p.afterContent=serialize(next);}return p;}});await h.open();copyPair(h);assert.equal(h.el('Apply').disabled,true,mutation);await h.apply();assert.equal(h.calls.length,0,mutation);}
});
test('exact privately branded copy applies only memory and a valid advanced owner receipt focuses once',async t=>{
 let focused=0;const h=await fixture(t,{focus:()=>focused++});await h.open();copyPair(h);const p=h.proposals[0];await h.apply();assert.equal(h.calls[0].proposal,p);assert.equal(h.content(),p.afterContent);assert.notEqual(h.context.sourceToken,p.sourceToken);assert.equal(h.el('Dialog').open,false);assert.equal(focused,1);
});
test('host refresh during legitimate token advancement preserves pending copy approval',async t=>{
 const h=await fixture(t,{refreshOnApply:true});await h.open();copyPair(h);await h.apply();assert.equal(h.el('Dialog').open,false);assert.equal(h.content(),h.proposals[0].afterContent);assert.equal(h.calls.length,1);
});
test('false or forged path content and current new-token receipts cannot close the form',async t=>{
 for(const mutation of ['path','content','old-token','empty-token','current-token','false','null']){const h=await fixture(t,{apply:(p,ports,state)=>{assert.equal(ports.isCurrent(),true);state.context.sourceToken='next';const r={applied:true,sourcePath:p.sourcePath,sourceToken:'next',content:p.afterContent};if(mutation==='path')r.sourcePath='other';if(mutation==='content')r.content=p.beforeContent;if(mutation==='old-token'){r.sourceToken=p.sourceToken;state.context.sourceToken=p.sourceToken;}if(mutation==='empty-token')r.sourceToken='';if(mutation==='current-token')state.context.sourceToken='other-current';if(mutation==='false')r.applied=false;return mutation==='null'?null:r;}});await h.open();copyPair(h);await h.apply();assert.equal(h.el('Dialog').open,true,mutation);assert.match(h.el('Diagnostic').textContent,/receipt/,mutation);}
});
test('pending copy locks all inputs but Cancel immediately revokes late source application ownership',async t=>{
 const gate=deferred();let focused=0;const h=await fixture(t,{apply:()=>gate.promise});await h.open();copyPair(h);h.el('Apply').click();for(const field of ['Search','SelectResults','ClearSelection','X','Y','Z','Check','Apply'])assert.equal(h.el(field).disabled,true,field);assert.ok(h.choices().every(row=>row.disabled));assert.equal(h.el('Cancel').disabled,false);h.el('Cancel').click();assert.equal(h.calls[0].ports.isCurrent(),false);gate.resolve({applied:true,sourcePath:h.context.sourcePath,sourceToken:'next',content:h.proposals[0].afterContent,focus:()=>focused++});await h.settle();assert.equal(h.el('Dialog').open,false);assert.equal(focused,0);
});
test('silent offsets selected checkboxes query or mapped UUIDs across apply await revoke both guard and receipt',async t=>{
 for(const mutation of ['offset','checkbox','query','mapping']){const gate=deferred(),h=await fixture(t,{apply:()=>gate.promise});await h.open();copyPair(h);h.el('Apply').click();if(mutation==='offset')h.set('X',8,false);if(mutation==='checkbox')h.select(two,false,false);if(mutation==='query')h.set('Search','Blue',false);if(mutation==='mapping')h.el('Mapping').querySelector('.scene3d-copy-new-id').textContent=three;assert.equal(h.calls[0].ports.isCurrent(),false);h.context.sourceToken='next';gate.resolve({applied:true,sourcePath:h.context.sourcePath,sourceToken:'next',content:h.proposals[0].afterContent});await h.settle();assert.equal(h.el('Dialog').open,true);assert.match(h.el('Diagnostic').textContent,/receipt/);}
});
test('close and reopen during pending Apply isolate the fresh allocation map from an old completion',async t=>{
 const gate=deferred(),h=await fixture(t,{apply:()=>gate.promise});await h.open();copyPair(h);const old=h.mapping();h.el('Apply').click();h.controller.close(true);await h.open();h.select(two);h.set('X',17);const fresh=h.mapping();assert.notEqual(fresh[0].newInstanceId,old[1].newInstanceId);gate.resolve({applied:true});await h.settle();assert.deepEqual(h.mapping(),fresh);assert.equal(h.el('X').value,'17');assert.equal(h.el('Dialog').open,true);
});
test('duplicate Apply and late rejection do not add requests regenerate IDs or discard local input',async t=>{
 const gate=deferred(),h=await fixture(t,{apply:()=>gate.promise});await h.open();copyPair(h);const mapping=h.mapping();h.el('Apply').click();h.el('Apply').click();assert.equal(h.calls.length,1);gate.reject(Error('Late'));await h.settle();assert.deepEqual(h.mapping(),mapping);assert.equal(h.uuidCount(),2);assert.equal(h.el('Dialog').open,true);
});
test('capability loss disables only bulk copy and preserves local mapping without invoking draft port',async t=>{
 const h=await fixture(t);await h.open();copyPair(h);const mapping=h.mapping();h.setSupported(false);h.controller.refresh();assert.equal(h.el('Btn').disabled,true);assert.equal(h.el('Check').disabled,true);await h.apply();assert.equal(h.calls.length,0);assert.deepEqual(h.mapping(),mapping);assert.ok(h.element('projectBuildBtn'));
});
test('dispose is idempotent removes only local form and ignores late source completion',async t=>{
 const gate=deferred(),h=await fixture(t,{source:()=>gate.promise}),opened=h.open();h.controller.dispose();h.controller.dispose();gate.resolve(h.snapshot());assert.equal(await opened,false);assert.equal(await h.open(),false);assert.equal(h.el('Dialog'),null);assert.equal(h.unsubscribed(),1);assert.ok(h.element('projectBuildBtn'));
});
test('CSS scoped hidden priority and local controller have no author geometry calculation renderer sibling World HTTP or Save import',async()=>{
 const source=await fs.readFile(new URL('../../web/modules/app-scene3d-copy.js',import.meta.url),'utf8'),css=await fs.readFile(new URL('../../web/scene3d-copy.css',import.meta.url),'utf8');assert.match(css,/\.scene3d-copy-dialog \[hidden\]\s*\{\s*display:none!important/);assert.equal(/style=|\.style\./.test(source),false);assert.equal(/import.*(renderer|app-scene3d-(transforms|objects|properties|environment|translation|alignment|distribution)|runtime|world|build)/.test(source),false);assert.equal(/fetch\(|saveDraft|WorldCommand|\.save\(/.test(source),false);
});
test('actual native privately branded copy integrates local zero-offset review and strict source-memory application',async t=>{
 assert.equal(supportsStudioCoreScene3DCopyPatch(),true);const h=await fixture(t,{propose:createScene3DCopyProposal,apply:async(p,ports,state)=>{assert.equal(isScene3DCopyProposal(p),true);assert.equal(ports.isCurrent(),true);const result=await prepareScene3DCopyApply(state.snapshot(),p,{digest:async raw=>hash(raw).slice(7)});assert.equal(result.afterContent,p.afterContent);state.setContent(result.afterContent);state.context.sourceToken='advanced-native';return{applied:true,sourcePath:p.sourcePath,sourceToken:state.context.sourceToken,content:result.afterContent};}});await h.open();copyPair(h);assert.equal(h.el('Apply').disabled,false);assert.equal(isScene3DCopyProposal(h.proposals[0]),true);await h.apply();assert.equal(h.el('Dialog').open,false);const next=JSON.parse(h.content().replace(/^\ufeff/,''));assert.equal(next.objects.length,5);assert.deepEqual(next.objects.slice(0,3),author().objects);assert.equal(next.objects[3].name,author().objects[0].name);assert.equal(next.objects[4].name,author().objects[1].name);
});
test('old closed-owner checkbox cannot allocate or select a new same-path session',async t=>{
 const h=await fixture(t);await h.open();const old=h.choice(one);h.controller.close(true);h.context.sourceToken='fresh';await h.open();old.checked=true;old.dispatch('change');assert.equal(h.uuidCount(),0);assert.deepEqual(h.mapping(),[]);assert.equal(h.el('Check').disabled,true);h.select(two);assert.equal(h.uuidCount(),1);
});
test('old query generation checkbox cannot alter the new selected mapping even if reattached',async t=>{
 const h=await fixture(t);await h.open();copyPair(h);const old=h.choice(one);h.set('Search','Blue');h.check();const mapping=h.mapping(),source=h.el('Source').textContent;old.checked=false;old.dispatch('change');assert.deepEqual(h.mapping(),mapping);assert.equal(h.el('Apply').disabled,false);h.el('Objects').append(old);old.dispatch('change');h.el('Objects').replaceChildren(...h.el('Objects').children.filter(node=>node!==old));assert.deepEqual(h.mapping(),mapping);assert.equal(h.el('Source').textContent,source);assert.equal(h.uuidCount(),2);
});
test('a rendered source UUID silently replaced before change cannot allocate or select another source',async t=>{
 const h=await fixture(t);await h.open();const row=h.choice(one);row.dataset.instanceId=two;row.checked=true;row.dispatch('change');assert.equal(h.uuidCount(),0);assert.equal(h.el('Check').disabled,true);h.controller.refresh();assert.deepEqual(h.mapping(),[]);
});
