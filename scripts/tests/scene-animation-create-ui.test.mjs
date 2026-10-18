import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { webcrypto } from 'node:crypto';
import { dialogHarness, flushDialogs } from './dialog-harness.mjs';
import { deferred } from './editor-harness.mjs';
import { animationPureFixture, id, revision } from './helpers/world-animation-create-pure-fixture.mjs';
import { createSceneAnimationCreationDraft } from '../../engine/scene-animation-create-plan.mjs';
import { captureSceneAnimationCreationContext, createSceneAnimationCreationRequest, validateSceneAnimationCreationResult, confirmSceneAnimationCreation } from '../../engine/scene-animation-creation-contract.mjs';
import en from '../../web/i18n/en.js';
import ja from '../../web/i18n/ja.js';
const copy = value => JSON.parse(JSON.stringify(value));
const bridge = fn => (...args) => fn(...args.map(value => value === undefined ? undefined : copy(value)));
async function settle() { for (let i = 0; i < 4; i++) { await flushDialogs(); await new Promise(resolve => setTimeout(resolve, 2)); } }
async function harness(options = {}) {
  const fixture = await animationPureFixture(); let catalog = copy(options.catalog || fixture.context), locale = 'zh-CN', uuidCount = 0;
  const context = { editable:true, dirty:false, creating:false, busy:false, visible:true, sceneId:fixture.context.scene.objectId, session:'one', sourceToken:'source-one', ...options.context };
  const requests = [], reads = [], applied = [], opened = [], busy = [], languages = [];
  const h = await dialogHarness('app-scene-animation-create', { crypto: { subtle:webcrypto.subtle, randomUUID:() => { uuidCount++; return id(100 + uuidCount); } },
    createSceneAnimationCreationDraft:bridge(createSceneAnimationCreationDraft), captureSceneAnimationCreationContext:bridge(captureSceneAnimationCreationContext),
    createSceneAnimationCreationRequest:bridge(createSceneAnimationCreationRequest), validateSceneAnimationCreationResult:bridge(validateSceneAnimationCreationResult), confirmSceneAnimationCreation:bridge(confirmSceneAnimationCreation),
    t:(key,...args) => (locale === 'en' ? en[key] || key : locale === 'ja' ? ja[key] || key : key).replace(/\{(\d+)\}/g, (_,i) => String(args[i])), onLanguageChange:fn => languages.push(fn) });
  const controller = h.runtime.setupSceneAnimationCreate({ getContext:() => context, setBusy:value => busy.push(value),
    inspect:payload => { reads.push(copy(payload)); return options.inspect ? options.inspect(payload) : Promise.resolve(copy(catalog)); },
    command:request => { const pending = deferred(); requests.push({request:copy(request), ...pending}); return pending.promise; },
    applied:async (...args) => { applied.push(args); await options.applied?.(...args); },
    openSource:async (...args) => { opened.push(args); return options.openSource ? options.openSource(...args) : true; } });
  controller.setAvailable(options.enabled !== false, options.commands || ['animation.create']);
  const el = suffix => h.element('sceneAnimationCreate' + suffix), click = suffix => el(suffix).click();
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
      documentType:request.documentType,parserProfile:record.parserProfile,content:request.content,relations:record.relations,assetBindings:record.assetBindings,trackCount:JSON.parse(request.content.replace(/^\uFEFF/,'')).tracks.length}};
    return result;
  };
  const review = async () => { click('Check'); await settle(); const pending = requests.at(-1); assert.ok(pending,'review command issued'); pending.resolve(await receipt(pending.request)); await settle(); };
  return {...h,el,click,set,controller,context,fixture,requests,reads,applied,opened,busy,receipt,markCreated,review,
    open:async()=>{const opened=controller.open(context.sceneId);await settle();return opened;},getCatalog:()=>copy(catalog),setCatalog:value=>{catalog=copy(value);},uuidCount:()=>uuidCount,
    language:value=>{locale=value;languages.forEach(fn=>fn());}};
}


test('animation creation requires its capability and a clean, visible saved-scene owner', async () => {
  for (const context of [{editable:false},{dirty:true},{creating:true},{busy:true},{visible:false},{session:undefined}]) {
    const h=await harness({context});assert.equal(await h.open(),false);assert.equal(h.reads.length,0);
  }
  const h=await harness({commands:['behavior.create']});assert.equal(await h.open(),false);h.controller.setAvailable(true,['animation.create']);assert.equal(h.controller.open(id(400)),false);assert.equal(await h.open(),true);
  assert.equal(h.el('Dialog').dataset.vientoCloseGuard,'true');assert.equal(h.uuidCount(),2);
});

test('bad catalogs fail closed, including malformed existing animation, without falling back to creation', async () => {
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
  const h=await harness();await h.open();await h.review();h.el('EndX').value='0.2';h.click('Save');await settle();assert.equal(h.requests.length,1);assert.equal(h.el('Save').disabled,true);
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

test('existing animation only opens after a fresh identity/revision check and never allocates new IDs', async () => {
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
  const wait=deferred(),h=await harness({inspect:()=>wait.promise});h.controller.open(h.context.sceneId);h.controller.dispose();wait.resolve(h.fixture.context);await settle();assert.deepEqual(h.busy,[true,false]);assert.equal(h.uuidCount(),0);assert.equal(h.element('sceneAnimationCreateDialog'),null);
});

test('four channels create one stable Rust-validated track and identity/end frames without saving', async () => {
  for (const [property, first, last] of [['offset2d',[0,0],[100,0]],['rotation2d',0,90],['scale2d',[1,1],[2,2]],['opacity',1,0]]) {
    const h=await harness();await h.open();h.set('Property',property,'change');h.set('Duration','3');h.set('Loop','true','change');await h.review();
    const request=h.requests[0].request, source=JSON.parse(request.content);assert.equal(request.command,'animation.create');assert.equal(source.tracks.length,1);assert.equal(source.durationSeconds,3);assert.equal(source.loop,true);
    assert.deepEqual(source.tracks[0].keyframes,[{atSeconds:0,value:first},{atSeconds:3,value:last}]);assert.equal(source.tracks[0].interpolation,'linear');
    assert.equal(h.el('SourceText').textContent,request.content);assert.equal(h.el('Relations').children.length,2);assert.equal(h.el('Save').disabled,false);assert.equal(h.applied.length,0);assert.equal(h.uuidCount(),2);
  }
});
test('instance labels keep duplicate names and full identities as inert text; selection changes only the form', async () => {
  const h=await harness(),catalog=h.getCatalog();catalog.targets.forEach(target=>target.name='<img src=x> Same');h.setCatalog(catalog);await h.open();
  const list=h.el('Instance');assert.equal(list.querySelector('img'),null);for(const option of list.querySelectorAll('option')){assert.ok(option.textContent.includes('<img src=x> Same'));assert.ok(option.textContent.includes(option.value));}
  h.set('Instance',catalog.targets[1].instanceId,'change');assert.equal(h.requests.length,0);await h.review();assert.equal(JSON.parse(h.requests[0].request.content).tracks[0].instanceId,catalog.targets[1].instanceId);
});
test('three languages preserve incomplete input, focused nodes and stable allocated identity', async () => {
  const h=await harness();await h.open();const input=h.el('Duration'),select=h.el('Instance');input.focus();h.set('Duration','1e');h.set('EndX','-');
  for(const language of ['en','ja','zh-CN']){h.language(language);assert.equal(h.el('Duration'),input);assert.equal(h.el('Instance'),select);assert.equal(h.document.activeElement,input);assert.equal(input.value,'1e');assert.equal(h.el('EndX').value,'-');}
  h.click('Check');await settle();assert.equal(h.requests.length,0);assert.equal(h.uuidCount(),2);h.set('Duration','2');h.set('EndX','40');await h.review();const reviewed=h.el('SourceText').textContent;
  h.language('ja');assert.equal(h.el('Save').disabled,false);assert.equal(h.el('SourceText').textContent,reviewed);assert.equal(h.uuidCount(),2);
});
test('invalid numbers, target, property, loop and paths never issue commands', async () => {
  for(const [field,value]of [['Duration',''],['Duration','1e'],['Duration','0'],['Duration','60.1'],['EndX','10001'],['EndX','NaN'],['Property','mesh'],['Instance',id(900)],['Loop','yes'],['Type','missing'],['Path','documents/../bad.json'],['Path','outside/new.json'],['Path','documents/new.md']]){
    const h=await harness();await h.open();h.set(field,value);h.click('Check');await settle();assert.equal(h.requests.length,0,field+value);
  }
});
test('invalid empty directory and a disappeared target never silently select another target', async () => {
  const empty=await harness(),catalog=empty.getCatalog();catalog.targets=[];empty.setCatalog(catalog);await empty.open();assert.match(empty.el('Status').textContent,/无法读取/);assert.equal(empty.el('Check').disabled,true);assert.equal(empty.requests.length,0);assert.equal(empty.uuidCount(),0);
  const h=await harness();await h.open();const selected=h.el('Instance').value,next=h.getCatalog();next.targets=next.targets.filter(target=>target.instanceId!==selected);h.setCatalog(next);h.click('Refresh');await settle();assert.equal(h.el('Instance').value,selected);h.click('Check');await settle();assert.equal(h.requests.length,0);
});
test('document type preference is animation then document then the first existing type', async () => {
  for(const [types,expected] of [[['other','document','animation'],'animation'],[['other','document'],'document'],[['other'],'other']]) {
    const h=await harness(),catalog=h.getCatalog();catalog.documentTypes=types.map(id=>({id,label:id}));h.setCatalog(catalog);await h.open();assert.equal(h.el('Type').value,expected);
  }
});
test('cancelled read and preview responses cannot reopen or replace a newer creation session', async () => {
  const gate=deferred(),h=await harness({inspect:()=>gate.promise});h.controller.open(h.context.sceneId);h.click('Cancel');gate.resolve(h.fixture.context);await settle();assert.equal(h.el('Dialog').open,false);assert.equal(h.uuidCount(),0);assert.deepEqual(h.busy,[true,false]);
  const n=await harness();await n.open();n.click('Check');await settle();const old=n.requests[0];n.click('Cancel');await n.open();old.resolve(await n.receipt(old.request));await settle();assert.equal(n.el('Dialog').open,true);assert.equal(n.el('Save').disabled,true);assert.equal(n.uuidCount(),4);
});
test('creation labels cover English and Japanese and keep a dedicated narrow-screen layout', async () => {
  const source=await fs.readFile(new URL('../../web/modules/app-scene-animation-create.js',import.meta.url),'utf8');
  const labels=[...source.matchAll(/data-i18n="([^"]+)"/g)].map(match=>match[1]);for(const key of labels){assert.equal(typeof en[key],'string',key+' en');assert.equal(typeof ja[key],'string',key+' ja');}
  const css=await fs.readFile(new URL('../../web/scene-animation-create.css',import.meta.url),'utf8');assert.match(css,/@media\(max-width:700px\)/);assert.match(css,/overflow:auto/);assert.doesNotMatch(css,/scene-audio/);
});

test('forged preview identity, exact source or relation closure never enables Save',async()=>{
 for(const change of [r=>r.changes[0].afterText+=' ',r=>r.object.id=id(999),r=>r.changes[0].record.relations=[],r=>r.changes[1].relation.kind='references']){
  const h=await harness();await h.open();h.click('Check');await settle();const pending=h.requests[0],result=await h.receipt(pending.request);change(result);pending.resolve(result);await settle();
  assert.equal(h.el('Save').disabled,true);assert.equal(h.applied.length,0);assert.equal(h.el('Duration').value,'2');
 }
});

test('closing an uncertain save then reopening a confirmed commit offers navigation without new IDs or commands',async()=>{
 const h=await harness();await h.open();await h.review();h.click('Save');await settle();const pending=h.requests[1];pending.reject(Error('lost reply'));await settle();
 assert.match(h.el('Status').textContent,/尚未确认/);h.click('Cancel');assert.equal(h.el('Dialog').open,false);const allocated=h.uuidCount();await h.markCreated(pending.request);
 await h.open();assert.equal(h.uuidCount(),allocated);assert.equal(h.requests.length,2);assert.equal(h.el('Fields').hidden,true);assert.equal(h.el('Open').disabled,false);
 h.click('Open');await settle();assert.equal(h.opened[0][0],pending.request.sourcePath);assert.equal(h.requests.length,2);assert.equal(h.el('Dialog').open,false);
});
