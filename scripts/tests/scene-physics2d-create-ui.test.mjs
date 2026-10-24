import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { webcrypto } from 'node:crypto';
import { dialogHarness, flushDialogs } from './dialog-harness.mjs';
import { deferred } from './editor-harness.mjs';
import { physics2dPureFixture, id, revision } from './helpers/world-physics2d-create-pure-fixture.mjs';
import { createScenePhysics2DCreationDraft } from '../../engine/scene-physics2d-create-plan.mjs';
import { captureScenePhysics2DCreationContext, createScenePhysics2DCreationRequest, validateScenePhysics2DCreationResult, confirmScenePhysics2DCreation } from '../../engine/scene-physics2d-creation-contract.mjs';
import en from '../../web/i18n/en.js';
import ja from '../../web/i18n/ja.js';
const copy = value => JSON.parse(JSON.stringify(value));
const bridge = fn => (...args) => fn(...args.map(value => value === undefined ? undefined : copy(value)));
async function settle() { for (let i = 0; i < 4; i++) { await flushDialogs(); await new Promise(resolve => setTimeout(resolve, 2)); } }
async function harness(options = {}) {
  const fixture = await physics2dPureFixture(); let catalog = copy(options.catalog || fixture.context), locale = 'zh-CN', uuidCount = 0;
  const context = { editable:true, dirty:false, creating:false, busy:false, visible:true, sceneId:fixture.context.scene.objectId, session:'one', sourceToken:'source-one', ...options.context };
  const requests = [], reads = [], applied = [], opened = [], busy = [], languages = [];
  const h = await dialogHarness('app-scene-physics2d-create', { crypto: { subtle:webcrypto.subtle, randomUUID:() => { uuidCount++; return id(100 + uuidCount); } },
    createScenePhysics2DCreationDraft:bridge(createScenePhysics2DCreationDraft), captureScenePhysics2DCreationContext:bridge(captureScenePhysics2DCreationContext),
    createScenePhysics2DCreationRequest:bridge(createScenePhysics2DCreationRequest), validateScenePhysics2DCreationResult:bridge(validateScenePhysics2DCreationResult), confirmScenePhysics2DCreation:bridge(confirmScenePhysics2DCreation),
    t:(key,...args) => (locale === 'en' ? en[key] || key : locale === 'ja' ? ja[key] || key : key).replace(/\{(\d+)\}/g, (_,i) => String(args[i])), onLanguageChange:fn => languages.push(fn) });
  const controller = h.runtime.setupScenePhysics2DCreate({ getContext:() => context, setBusy:value => busy.push(value),
    inspect:payload => { reads.push(copy(payload)); return options.inspect ? options.inspect(payload) : Promise.resolve(copy(catalog)); },
    command:request => { const pending = deferred(); requests.push({request:copy(request), ...pending}); return pending.promise; },
    applied:async (...args) => { applied.push(args); await options.applied?.(...args); },
    openSource:async (...args) => { opened.push(args); return options.openSource ? options.openSource(...args) : true; } });
  controller.setAvailable(options.enabled !== false, options.commands || ['physics2d.create']);
  const el = suffix => h.element('scenePhysics2DCreate' + suffix), click = suffix => el(suffix).click();
  const set = (suffix,value,event='input') => { el(suffix).value = value; el(suffix).dispatch(event); };
  const receipt = async request => {
    const result = copy((await fixture.run({...request,mode:'preview'})).result);
    if (request.mode === 'apply') { result.status = 'applied'; result.receipt = {format:'viento-transaction-receipt',schemaVersion:1,transactionId:id(999),worldId:request.worldId,
      proposalId:result.proposal.id,baseRevision:request.baseRevision,revision:result.revision,state:'committed'}; }
    return result;
  };
  const markCreated = async request => {
    const result = await receipt(request), record = result.changes[0].record;
    catalog = {...copy(fixture.context),status:'ready',baseRevision:result.revision,
      scene:{...fixture.context.scene,objectRevision:result.scene.revision},manifest:{objectId:request.objectId,objectRevision:result.object.revision,sourcePath:request.sourcePath,sourceRevision:revision(request.content),
      documentType:request.documentType,parserProfile:record.parserProfile,content:request.content,relations:record.relations,assetBindings:record.assetBindings,bodyCount:JSON.parse(request.content.replace(/^\uFEFF/,'')).bodies.length}};
    return result;
  };
  const review = async () => { click('Check'); await settle(); const pending = requests.at(-1); assert.ok(pending,'review command issued'); pending.resolve(await receipt(pending.request)); await settle(); };
  return {...h,el,click,set,controller,context,fixture,requests,reads,applied,opened,busy,receipt,markCreated,review,
    open:async()=>{const opened=controller.open(context.sceneId);await settle();return opened;},getCatalog:()=>copy(catalog),setCatalog:value=>{catalog=copy(value);},uuidCount:()=>uuidCount,
    language:value=>{locale=value;languages.forEach(fn=>fn());}};
}


test('physics2d creation requires its capability and a clean, visible saved-scene owner', async () => {
  for (const context of [{editable:false},{dirty:true},{creating:true},{busy:true},{visible:false},{session:undefined}]) {
    const h=await harness({context});assert.equal(await h.open(),false);assert.equal(h.reads.length,0);
  }
  const h=await harness({commands:['behavior.create']});assert.equal(await h.open(),false);h.controller.setAvailable(true,['physics2d.create']);assert.equal(h.controller.open(id(400)),false);assert.equal(await h.open(),true);
  assert.equal(h.el('Dialog').dataset.vientoCloseGuard,'true');assert.equal(h.uuidCount(),2);
});

test('bad catalogs fail closed, including malformed existing physics2d, without falling back to creation', async () => {
  for(const mutate of [c=>c.schemaVersion++,c=>c.scene.objectId=id(900),c=>c.targets.push(c.targets[0]),c=>c.targets[0].instanceId='bad',c=>{c.status='ready';c.manifest={};}]){
    const h=await harness();const data=h.getCatalog();mutate(data);h.setCatalog(data);await h.open();assert.equal(h.uuidCount(),0);assert.equal(h.el('Check').disabled,true);assert.equal(h.el('Save').disabled,true);
  }
});

test('late catalogs and previews cannot be accepted by another scene, session or source', async () => {
  for(const change of [h=>h.context.sceneId=id(900),h=>h.context.session='new',h=>h.context.sourceToken='changed',h=>h.context.dirty=true,h=>h.controller.setAvailable(false,[])]){
    const wait=deferred(),h=await harness({inspect:()=>wait.promise});h.controller.open(h.context.sceneId);change(h);wait.resolve(h.fixture.context);await settle();assert.equal(h.uuidCount(),0);
  }
  const h=await harness();await h.open();h.click('Check');await settle();h.context.sourceToken='changed';h.requests[0].resolve(await h.receipt(h.requests[0].request));await settle();assert.equal(h.el('Save').disabled,true);assert.equal(h.applied.length,0);
});

test('silent input changes invalidate a reviewed request before save', async () => {
  const h=await harness();await h.open();await h.review();h.el('Width').value='0.2';h.click('Save');await settle();assert.equal(h.requests.length,1);assert.equal(h.el('Save').disabled,true);
});

test('apply uses reviewed bytes, confirms real closure after refresh and requires explicit source navigation', async () => {
  let h;h=await harness({applied:async()=>{h.context.sourceToken='own-refresh';}});await h.open();await h.review();const before=h.requests[0].request;h.click('Save');await settle();h.click('Save');h.click('Close');assert.equal(h.el('Dialog').open,true);assert.equal(h.requests.length,2);
  const pending=h.requests[1];assert.deepEqual(pending.request,{...before,mode:'apply'});pending.resolve(await h.markCreated(pending.request));await settle();assert.equal(h.applied.length,1);assert.equal(h.el('Dialog').dataset.dirty,'false');assert.equal(h.opened.length,0);assert.equal(h.el('Open').disabled,false);assert.equal(h.el('Fields').hidden,true);
  h.click('Open');await settle();assert.equal(h.opened[0][0],before.sourcePath);assert.equal(h.opened[0][1].sourceRevision,revision(before.content));assert.equal(h.el('Dialog').open,false);assert.equal(h.requests.length,2);
});

test('unknown writes never retry, and matching source identity plus complete closure may reconcile read-only', async () => {
  const h=await harness();await h.open();await h.review();h.click('Save');await settle();const request=h.requests[1].request;h.requests[1].reject(Error('connection lost'));await settle();assert.equal(h.el('Dialog').dataset.dirty,'true');h.click('Refresh');await settle();h.click('Save');assert.equal(h.requests.length,2);assert.equal(h.applied.length,0);
  await h.markCreated(request);h.click('Refresh');await settle();assert.equal(h.applied.length,1);assert.equal(h.applied[0][0],null);assert.equal(h.applied[0][1].reconciled,true);assert.equal(h.el('Dialog').dataset.dirty,'false');assert.equal(h.el('Open').disabled,false);assert.equal(h.requests.length,2);
});

test('wrong persisted identity or incomplete closure cannot confirm an uncertain write', async () => {
  for(const change of [c=>c.manifest.objectId=id(990),c=>c.manifest.sourceRevision=revision('different'),c=>c.manifest.assetBindings=[{resourceId:id(999)}],c=>c.manifest.relations=[]]){
    const h=await harness();await h.open();await h.review();h.click('Save');await settle();const request=h.requests[1].request;h.requests[1].resolve({status:'applied'});await settle();await h.markCreated(request);const next=h.getCatalog();change(next);h.setCatalog(next);h.click('Refresh');await settle();assert.equal(h.applied.length,0);assert.equal(h.el('Open').disabled,true);assert.equal(h.el('Save').disabled,true);assert.equal(h.el('Dialog').dataset.dirty,'true');
  }
});

test('known rejected save preserves stable draft for a new review; host refresh failure cannot repeat a committed save', async () => {
  const h=await harness();await h.open();await h.review();h.click('Save');await settle();h.requests[1].reject(Object.assign(Error('conflict'),{errorCode:'world_revision_conflict'}));await settle();h.click('Refresh');await settle();await h.review();assert.equal(h.requests[2].request.objectId,h.requests[0].request.objectId);
  let reject=true;const other=await harness({applied:async()=>{if(reject)throw Error('refresh failed');}});await other.open();await other.review();other.click('Save');await settle();other.requests[1].resolve(await other.markCreated(other.requests[1].request));await settle();assert.equal(other.el('Open').disabled,true);assert.equal(other.requests.length,2);reject=false;other.click('Refresh');await settle();assert.equal(other.applied.length,2);assert.equal(other.el('Open').disabled,false);assert.equal(other.requests.length,2);
});

test('existing physics2d only opens after a fresh identity/revision check and never allocates new IDs', async () => {
  const h=await harness();await h.markCreated(h.fixture.request);await h.open();assert.equal(h.uuidCount(),0);assert.equal(h.el('Fields').hidden,true);assert.equal(h.el('Check').hidden,true);assert.equal(h.el('Open').disabled,false);
  const next=h.getCatalog();next.manifest.sourceRevision=revision('changed');h.setCatalog(next);h.click('Open');await settle();assert.equal(h.opened.length,0);assert.match(h.el('Status').textContent,/已变化/);h.click('Open');await settle();assert.equal(h.opened.length,1);assert.equal(h.opened[0][1].sourceRevision,revision('changed'));assert.equal(h.requests.length,0);
});

test('a late apply or source navigation cannot refresh or close a new parent session', async () => {
  const h=await harness();await h.open();await h.review();h.click('Save');await settle();h.context.session='new';h.requests[1].resolve(await h.markCreated(h.requests[1].request));await settle();assert.equal(h.applied.length,0);assert.equal(h.el('Open').disabled,true);
  const wait=deferred();let guard;const n=await harness({openSource:(_p,o)=>{guard=o.isCurrent;return wait.promise;}});await n.markCreated(n.fixture.request);await n.open();n.click('Open');await settle();assert.equal(guard(),true);n.context.session='new';assert.equal(guard(),false);wait.resolve(true);await settle();assert.equal(n.el('Dialog').open,true);
});

test('dirty review and pending operations are exposed to close guards, Escape and cancel preserve user choice', async () => {
  const h=await harness();await h.open();await h.review();assert.equal(h.el('Dialog').dataset.dirty,'true');h.runtime.window.confirm=()=>false;h.click('Cancel');h.el('Dialog').dispatch('cancel');assert.equal(h.el('Dialog').open,true);
  h.click('Save');await settle();h.runtime.window.confirm=()=>true;h.click('Close');assert.equal(h.el('Dialog').open,true);assert.equal(h.el('Dialog').getAttribute('aria-busy'),'true');assert.equal(h.el('Dialog').dispatch('keydown',{key:'s',ctrlKey:true}).defaultPrevented,true);
  h.requests[1].reject(Error('unknown'));await settle();h.click('Cancel');assert.equal(h.el('Dialog').open,false);assert.equal(h.el('Dialog').dataset.dirty,'false');
});

test('dispose releases its busy ownership and prevents late reads from creating state', async () => {
  const wait=deferred(),h=await harness({inspect:()=>wait.promise});h.controller.open(h.context.sceneId);h.controller.dispose();wait.resolve(h.fixture.context);await settle();assert.deepEqual(h.busy,[true,false]);assert.equal(h.uuidCount(),0);assert.equal(h.element('scenePhysics2DCreateDialog'),null);
});

test('body kinds and both shapes create one explicit stable Rust-validated body without saving', async () => {
  for (const kind of ['character','static','sensor']) for(const shape of ['box','circle']) {
    const h=await harness();await h.open();h.set('Kind',kind,'change');h.set('Shape',shape,'change');h.set('Width','48');h.set('Height','64');h.set('Radius','24');h.set('OffsetX','-10');h.set('OffsetY','12');h.set('Layer','5');h.set('Mask','10');await h.review();
    const request=h.requests[0].request, source=JSON.parse(request.content);assert.equal(request.command,'physics2d.create');assert.equal(source.bodies.length,1);assert.equal(source.schemaVersion,1);assert.equal(source.sceneObjectId,h.context.sceneId);
    assert.deepEqual(source.bodies[0],{id:id(102),instanceId:h.fixture.context.targets[0].instanceId,kind,shape:shape==='box'?{kind:'box',size:[48,64]}:{kind:'circle',radius:24},offset:[-10,12],layer:5,mask:10});
    assert.equal(h.el('SourceText').textContent,request.content);assert.equal(h.el('Relations').children.length,2);assert.match(h.el('Relations').children[0].textContent,/references \[physics2d\]/);assert.equal(h.el('Save').disabled,false);assert.equal(h.applied.length,0);assert.equal(h.uuidCount(),2);
  }
});
test('defaults are explicit and shape toggles preserve inactive dimensions and invalidate review', async () => {
  const h=await harness();await h.open();assert.equal(h.el('Path').value,'documents/physics/new-physics2d.json');assert.equal(h.el('Kind').value,'character');assert.equal(h.el('Width').value,'32');assert.equal(h.el('Height').value,'32');assert.equal(h.el('Radius').value,'16');assert.equal(h.el('Layer').value,'1');assert.equal(h.el('Mask').value,'1');assert.equal(h.el('OffsetX').value,'0');assert.equal(h.el('OffsetY').value,'0');
  assert.equal(h.el('RadiusField').hidden,true);assert.equal(h.el('Radius').disabled,true);await h.review();h.set('Width','49');h.set('Shape','circle','change');assert.equal(h.el('Save').disabled,true);assert.equal(h.el('WidthField').hidden,true);assert.equal(h.el('Width').disabled,true);assert.equal(h.el('RadiusField').hidden,false);assert.equal(h.el('Radius').disabled,false);h.set('Radius','23');await h.review();assert.deepEqual(JSON.parse(h.requests[1].request.content).bodies[0].shape,{kind:'circle',radius:23});h.set('Shape','box','change');assert.equal(h.el('Width').value,'49');assert.equal(h.el('Radius').value,'23');assert.equal(h.uuidCount(),2);
});
test('instance labels keep duplicate names and full identities as inert text; selection changes only the form', async () => {
  const h=await harness(),catalog=h.getCatalog();catalog.targets.forEach(target=>target.name='<img src=x> Same');h.setCatalog(catalog);await h.open();
  const list=h.el('Instance');assert.equal(list.querySelector('img'),null);for(const option of list.querySelectorAll('option')){assert.ok(option.textContent.includes('<img src=x> Same'));assert.ok(option.textContent.includes(option.value));}
  h.set('Instance',catalog.targets[1].instanceId,'change');assert.equal(h.requests.length,0);await h.review();assert.equal(JSON.parse(h.requests[0].request.content).bodies[0].instanceId,catalog.targets[1].instanceId);
});
test('three languages preserve incomplete input, focused nodes and stable allocated identity', async () => {
  const h=await harness();await h.open();const input=h.el('Width'),select=h.el('Instance');input.focus();h.set('Width','1e');h.set('OffsetX','-');
  for(const language of ['en','ja','zh-CN']){h.language(language);assert.equal(h.el('Width'),input);assert.equal(h.el('Instance'),select);assert.equal(h.document.activeElement,input);assert.equal(input.value,'1e');assert.equal(h.el('OffsetX').value,'-');}
  h.click('Check');await settle();assert.equal(h.requests.length,0);assert.equal(h.uuidCount(),2);h.set('Width','32');h.set('OffsetX','40');await h.review();const reviewed=h.el('SourceText').textContent;
  h.language('ja');assert.equal(h.el('Save').disabled,false);assert.equal(h.el('SourceText').textContent,reviewed);assert.equal(h.uuidCount(),2);
});
test('invalid numeric bounds, target, body kind, shape and portable paths never issue commands', async () => {
  for(const [field,value]of [['Width',''],['Width','1e'],['Width','0'],['Width','8193'],['Height','-1'],['OffsetX','8193'],['OffsetY','NaN'],['Kind','dynamic'],['Instance',id(900)],['Shape','mesh'],['Layer','0.5'],['Layer','65536'],['Mask','-1'],['Mask','65536'],['Type','missing'],['Path','documents/../bad.json'],['Path','outside/new.json'],['Path','documents/new.md'],['Path','documents/new.JSON']]){
    const h=await harness();await h.open();h.set(field,value);h.click('Check');await settle();assert.equal(h.requests.length,0,field+value);
  }
  for(const radius of ['0.49','4097','Infinity','-']){const h=await harness();await h.open();h.set('Shape','circle','change');h.set('Radius',radius);h.click('Check');await settle();assert.equal(h.requests.length,0,radius);}
});
test('invalid empty directory and a disappeared target never silently select another target', async () => {
  const empty=await harness(),catalog=empty.getCatalog();catalog.targets=[];empty.setCatalog(catalog);await empty.open();assert.match(empty.el('Status').textContent,/无法读取/);assert.equal(empty.el('Check').disabled,true);assert.equal(empty.requests.length,0);assert.equal(empty.uuidCount(),0);
  const h=await harness();await h.open();const selected=h.el('Instance').value,next=h.getCatalog();next.targets=next.targets.filter(target=>target.instanceId!==selected);h.setCatalog(next);h.click('Refresh');await settle();assert.equal(h.el('Instance').value,selected);h.click('Check');await settle();assert.equal(h.requests.length,0);
});
test('document type preference is physics2d then physics then document then the first existing type', async () => {
  for(const [types,expected] of [[['other','document','physics','physics2d'],'physics2d'],[['other','document','physics'],'physics'],[['other','document'],'document'],[['other'],'other']]) {
    const h=await harness(),catalog=h.getCatalog();catalog.documentTypes=types.map(id=>({id,label:id}));h.setCatalog(catalog);await h.open();assert.equal(h.el('Type').value,expected);
  }
});
test('cancelled read and preview responses cannot reopen or replace a newer creation session', async () => {
  const gate=deferred(),h=await harness({inspect:()=>gate.promise});h.controller.open(h.context.sceneId);h.click('Cancel');gate.resolve(h.fixture.context);await settle();assert.equal(h.el('Dialog').open,false);assert.equal(h.uuidCount(),0);assert.deepEqual(h.busy,[true,false]);
  const n=await harness();await n.open();n.click('Check');await settle();const old=n.requests[0];n.click('Cancel');await n.open();old.resolve(await n.receipt(old.request));await settle();assert.equal(n.el('Dialog').open,true);assert.equal(n.el('Save').disabled,true);assert.equal(n.uuidCount(),4);
});
test('creation labels cover English and Japanese and keep a dedicated narrow-screen layout', async () => {
  const source=await fs.readFile(new URL('../../web/modules/app-scene-physics2d-create.js',import.meta.url),'utf8');
  const labels=[...new Set([...source.matchAll(/data-i18n="([^"]+)"/g)].map(match=>match[1]).concat([...source.matchAll(/'([^'\n]*)'/g)].map(match=>match[1]).filter(key=>/[\u4e00-\u9fff]/.test(key))))];for(const key of labels){assert.equal(typeof en[key],'string',key+' en');assert.equal(typeof ja[key],'string',key+' ja');}
  const css=await fs.readFile(new URL('../../web/scene-physics2d-create.css',import.meta.url),'utf8');assert.match(css,/@media\(max-width:700px\)/);assert.match(css,/overflow:auto/);assert.doesNotMatch(css,/scene-audio/);
});

test('forged preview identity, exact source or relation closure never enables Save',async()=>{
 for(const change of [r=>r.changes[0].afterText+=' ',r=>r.object.id=id(999),r=>r.changes[0].record.relations=[],r=>r.changes[1].relation.slot='wrong']){
  const h=await harness();await h.open();h.click('Check');await settle();const pending=h.requests[0],result=await h.receipt(pending.request);change(result);pending.resolve(result);await settle();
  assert.equal(h.el('Save').disabled,true);assert.equal(h.applied.length,0);assert.equal(h.el('Width').value,'32');
 }
});

test('closing an uncertain save then reopening a confirmed commit offers navigation without new IDs or commands',async()=>{
 const h=await harness();await h.open();await h.review();h.click('Save');await settle();const pending=h.requests[1];pending.reject(Error('lost reply'));await settle();
 assert.match(h.el('Status').textContent,/尚未确认/);h.click('Cancel');assert.equal(h.el('Dialog').open,false);const allocated=h.uuidCount();await h.markCreated(pending.request);
 await h.open();assert.equal(h.uuidCount(),allocated);assert.equal(h.requests.length,2);assert.equal(h.el('Fields').hidden,true);assert.equal(h.el('Open').disabled,false);
 h.click('Open');await settle();assert.equal(h.opened[0][0],pending.request.sourcePath);assert.equal(h.requests.length,2);assert.equal(h.el('Dialog').open,false);
});
