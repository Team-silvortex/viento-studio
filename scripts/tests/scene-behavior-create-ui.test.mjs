import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash, webcrypto } from 'node:crypto';
import { dialogHarness, flushDialogs } from './dialog-harness.mjs';
import { deferred } from './editor-harness.mjs';
import { createSceneBehaviorCreationDraft } from '../../engine/scene-behavior-create-plan.mjs';
import { SCENE_BEHAVIOR_LIMITS } from '../../engine/scene-behaviors.mjs';
import en from '../../web/i18n/en.js';
import ja from '../../web/i18n/ja.js';
const ids = ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'];
const revision = digit => 'sha256:' + digit.repeat(64);
const hash = value => 'sha256:' + createHash('sha256').update(value).digest('hex');
const copy = value => JSON.parse(JSON.stringify(value));
const catalog = () => ({ format: 'viento-behavior-creation-context', schemaVersion: 1, worldId: 'test-world', baseRevision: revision('a'), documentRoot: 'documents',
 documentTypes: [{id:'notes',label:'General notes'},{id:'behavior',label:'Behavior'}],
 scene: {objectId:ids[0],objectRevision:revision('b'),sourcePath:'documents/scenes/demo.json',sourceRevision:revision('c'),instances:[{instanceId:ids[1],objectId:ids[2],name:'First'},{instanceId:ids[3],objectId:ids[2],name:'Same definition'}]},
 sources:[{objectId:ids[4],sourcePath:'documents/scripts/first.txt',sourceRevision:revision('d'),name:'Script'}] });
function receipt(request, source = catalog()) {
 const input=copy(request); delete input.mode;
 const sourceIds=[...new Set(JSON.parse(request.content).bindings.map(binding=>binding.implementation.sourceObjectId))];
 return {status:request.mode==='apply'?'applied':'preview',worldId:request.worldId,baseRevision:request.baseRevision,revision:revision('e'),proposal:{commands:[{id:'behavior.create',input}]},
 object:{id:request.objectId,documentRefs:[{sourcePath:request.sourcePath,sourceRevision:hash(request.content)}]},
 changes:[{kind:'behavior.create',objectId:request.objectId,sourcePath:request.sourcePath,beforeSourceRevision:null,afterSourceRevision:hash(request.content),beforeText:null,afterText:request.content,recordPath:`metadata/documents/${request.objectId}.json`,record:{id:request.objectId,sourcePath:request.sourcePath,documentType:request.documentType,relations:[...new Set([request.sceneObjectId,...sourceIds])].sort().map(targetId=>({kind:'references',targetId,slot:''}))}},
 {kind:'relation.add',objectId:request.sceneObjectId,sourcePath:source.scene.sourcePath,targetObjectId:request.objectId,targetSourcePath:request.sourcePath,relation:{kind:'behavior',targetId:request.objectId,slot:''}}]};
}
async function settle() { for(let i=0;i<3;i++) { await flushDialogs(); await new Promise(resolve=>setTimeout(resolve,2)); } }
async function harness(options={}) {
 let locale='zh-CN', currentCatalog=options.catalog||catalog(), uuidCount=0; const language=[],requests=[],reads=[],applied=[],opened=[],busy=[];
 const context={editable:true,dirty:false,creating:false,busy:false,visible:true,session:'1',sceneId:ids[0],sourceToken:'draft-1',...options.context};
 const h=await dialogHarness('app-scene-behavior-create',{SCENE_BEHAVIOR_LIMITS,createSceneBehaviorCreationDraft:input=>createSceneBehaviorCreationDraft(copy(input)),crypto:{subtle:webcrypto.subtle,randomUUID:()=>{uuidCount++;return uuidCount===1?'11111111-1111-4111-8111-111111111111':`22222222-2222-4222-8222-${String(uuidCount).padStart(12,'0')}`;}},
 t:(key,...args)=>(locale==='en'?en[key]||key:locale==='ja'?ja[key]||key:key).replace(/\{(\d+)\}/g,(_,i)=>String(args[i])),onLanguageChange:fn=>language.push(fn)});
 const controller=h.runtime.setupSceneBehaviorCreate({getContext:()=>context,setBusy:value=>busy.push(value),inspect:payload=>{reads.push(copy(payload));return options.inspect?options.inspect(payload):Promise.resolve(copy(currentCatalog));},
 command:request=>{const pending=deferred();requests.push({request:copy(request),...pending});return pending.promise;},
 applied:async result=>{applied.push(copy(result));await options.applied?.(result);},openSource:async(...args)=>{opened.push(copy(args));return options.openSource?options.openSource(...args):true;}});
 controller.setAvailable(options.enabled!==false,options.commands||['behavior.create']);
 const set=(suffix,value,event='input')=>{h.element('sceneBehaviorCreate'+suffix).value=value;h.element('sceneBehaviorCreate'+suffix).dispatch(event);};
 const click=suffix=>h.element('sceneBehaviorCreate'+suffix).click();
 const open=async()=>{const result=controller.open(context.sceneId);await settle();return result;};
 const review=async()=>{click('Check');await settle();const pending=requests.at(-1);assert.ok(pending);pending.resolve(receipt(pending.request,currentCatalog));await settle();};
 return {...h,controller,context,requests,reads,applied,opened,busy,set,click,open,review,uuidCount:()=>uuidCount,setCatalog:value=>{currentCatalog=value;},setLanguage:value=>{locale=value;language.forEach(fn=>fn());}};
}

test('creation is capability-gated and refuses dirty, busy, creating, hidden or different-scene owners without reading',async()=>{
 for(const context of [{editable:false},{dirty:true},{busy:true},{creating:true},{visible:false},{session:undefined}]){const h=await harness({context});assert.equal(await h.open(),false);assert.equal(h.reads.length,0);}
 const h=await harness({commands:['scene.create']});assert.equal(await h.open(),false);h.controller.setAvailable(true,['behavior.create']);assert.equal(h.controller.open(ids[1]),false);assert.equal(await h.open(),true);
 assert.deepEqual(h.reads,[{sceneObjectId:ids[0]}]);assert.equal(h.uuidCount(),2);
});
test('one empty binding uses the selected stable instance and existing script; all three relationships and full exact source are reviewed',async()=>{
 const h=await harness();await h.open();h.set('Type','behavior','change');h.set('Instance',ids[3],'change');h.set('Path','documents/behaviors/traveler.json');await h.review();
 const request=h.requests[0].request,doc=JSON.parse(request.content);assert.deepEqual(Object.keys(request).sort(),['command','mode','worldId','baseRevision','actorRef','objectId','documentType','sourcePath','content','sceneObjectId','sceneObjectRevision','sceneSourceRevision'].sort());
 assert.equal(request.command,'behavior.create');assert.deepEqual(request.actorRef,{kind:'user',id:'studio-behavior-create'});assert.equal(doc.bindings[0].instanceId,ids[3]);assert.deepEqual(doc.bindings[0].parameters,{});assert.deepEqual(doc.bindings[0].events,[]);
 assert.deepEqual(doc.bindings[0].implementation,{backendId:'org.viento.godot4',language:'gdscript',sourceObjectId:ids[4]});
 assert.equal(h.element('sceneBehaviorCreateSourceText').textContent,request.content);assert.equal(h.element('sceneBehaviorCreateRelations').children.length,3);assert.match(h.element('sceneBehaviorCreateRelations').textContent,/behavior/);
 assert.equal(h.applied.length,0);assert.equal(h.element('sceneBehaviorCreateSave').disabled,false);assert.equal(h.uuidCount(),2);
});
test('apply preserves exactly reviewed bytes and IDs, refreshes once, then explicitly opens the saved source revision',async()=>{
 const h=await harness();await h.open();await h.review();const before=h.requests[0].request;
 h.click('Save');await settle();h.click('Save');h.click('Close');assert.equal(h.requests.length,2);assert.equal(h.element('sceneBehaviorCreateDialog').open,true);
 assert.deepEqual(h.requests[1].request,{...before,mode:'apply'});h.requests[1].resolve(receipt(h.requests[1].request));await settle();
 assert.equal(h.applied.length,1);assert.equal(h.opened.length,0);assert.equal(h.element('sceneBehaviorCreateDialog').dataset.dirty,'false');assert.equal(h.element('sceneBehaviorCreateCheck').hidden,true);
 assert.equal(h.element('sceneBehaviorCreateOpen').disabled,false);h.click('Open');await settle();assert.deepEqual(h.opened,[[before.sourcePath,{sourceRevision:hash(before.content)}]]);assert.equal(h.element('sceneBehaviorCreateDialog').open,false);assert.equal(h.busy.at(-1),false);
});
test('editing and silent DOM changes invalidate approval and cannot submit hidden changed values',async()=>{
 const h=await harness();await h.open();await h.review();h.set('Path','documents/behaviors/second.json');assert.equal(h.element('sceneBehaviorCreateSave').disabled,true);await h.review();
 h.element('sceneBehaviorCreatePath').value='documents/behaviors/silent.json';h.click('Save');await settle();assert.equal(h.requests.length,2);assert.equal(h.element('sceneBehaviorCreateSave').disabled,true);
});
test('raw unfinished values and stable IDs survive language changes, failed validation and refreshed catalogs',async()=>{
 const h=await harness();await h.open();h.set('Path','documents/../unfinished');h.setLanguage('en');h.click('Check');await settle();assert.equal(h.requests.length,0);
 h.setLanguage('ja');assert.equal(h.element('sceneBehaviorCreatePath').value,'documents/../unfinished');h.click('Refresh');await settle();assert.equal(h.element('sceneBehaviorCreatePath').value,'documents/../unfinished');assert.equal(h.uuidCount(),2);
});
test('safe JSON path and catalog membership are enforced before issuing a command',async()=>{
 for(const path of ['other/a.json','documents/../a.json','documents/.hidden/a.json','documents/a.txt','documents/node_modules/a.json','documents/CON.json']){
 const h=await harness();await h.open();h.set('Path',path);h.click('Check');await settle();assert.equal(h.requests.length,0,path);}
 for(const [key,value] of [['Type','missing'],['Instance',ids[4]],['Source',ids[1]]]){const h=await harness();await h.open();h.set(key,value,'change');h.click('Check');await settle();assert.equal(h.requests.length,0,key);}
});
test('empty script catalog explains the required saved TXT document and never creates one implicitly',async()=>{
 const data=catalog();data.sources=[];const h=await harness({catalog:data});await h.open();assert.equal(h.element('sceneBehaviorCreateEmpty').hidden,false);assert.equal(h.element('sceneBehaviorCreateCheck').disabled,true);h.click('Check');await settle();assert.equal(h.requests.length,0);
});
test('unknown or malformed catalog versions, duplicates and unsafe source paths fail closed',async()=>{
 const cases=[d=>d.schemaVersion=2,d=>d.unexpected=true,d=>d.scene.objectId=ids[1],d=>d.sources.push(d.sources[0]),d=>d.scene.instances.push(d.scene.instances[0]),d=>d.sources[0].sourcePath='documents/scripts/source.gd',d=>d.documentRoot='../documents',d=>d.sources[0].sourceRevision='stale'];
 for(const modify of cases){const data=catalog();modify(data);const h=await harness({catalog:data});await h.open();assert.equal(h.element('sceneBehaviorCreateCheck').disabled,true);assert.equal(h.uuidCount(),0);}
});
test('stale scene, session, source, capability or dirty state cannot accept a late catalog',async()=>{
 for(const change of [h=>h.context.sceneId=ids[1],h=>h.context.session='2',h=>h.context.sourceToken='draft-2',h=>h.context.dirty=true,h=>h.context.visible=false,h=>h.controller.setAvailable(false,[])]){
 const pending=deferred(),h=await harness({inspect:()=>pending.promise});h.controller.open(ids[0]);change(h);pending.resolve(catalog());await settle();assert.equal(h.uuidCount(),0);assert.equal(h.element('sceneBehaviorCreateCheck').disabled,true);}
});
test('late previews and silently edited pending forms never enable save',async()=>{
 for(const change of [h=>h.context.sceneId=ids[1],h=>h.context.session='2',h=>h.context.sourceToken='draft-2',h=>h.context.dirty=true,h=>h.context.busy=true,h=>h.element('sceneBehaviorCreatePath').value='documents/changed.json']){
 const h=await harness();await h.open();h.click('Check');await settle();change(h);h.requests[0].resolve(receipt(h.requests[0].request));await settle();assert.equal(h.element('sceneBehaviorCreateSave').disabled,true);assert.equal(h.applied.length,0);}
});
test('forged preview source, source revision, identity, proposal, or relationship cannot be approved',async()=>{
 const changes=[r=>r.changes[0].afterText+=' ',r=>r.changes[0].afterSourceRevision=revision('f'),r=>r.object.id=ids[4],r=>r.proposal.commands[0].input.documentType='evil',r=>r.changes[1].targetObjectId=ids[4],r=>r.changes[0].record.relations.pop(),r=>r.status='applied'];
 for(const change of changes){const h=await harness();await h.open();h.click('Check');await settle();const result=receipt(h.requests[0].request);change(result);h.requests[0].resolve(result);await settle();assert.equal(h.element('sceneBehaviorCreateSave').disabled,true);assert.equal(h.applied.length,0);}
});
test('known revision conflict keeps IDs and draft, requires rereading and fresh approval',async()=>{
 const h=await harness();await h.open();h.set('Path','documents/behaviors/keep.json');await h.review();h.click('Save');await settle();h.requests[1].reject(Object.assign(new Error('conflict'),{errorCode:'world_revision_conflict'}));await settle();
 assert.equal(h.element('sceneBehaviorCreateCheck').disabled,true);const next=catalog();next.baseRevision=revision('f');h.setCatalog(next);h.click('Refresh');await settle();await h.review();assert.equal(h.requests[2].request.baseRevision,revision('f'));assert.equal(h.requests[2].request.objectId,h.requests[0].request.objectId);assert.equal(h.requests[2].request.sourcePath,'documents/behaviors/keep.json');
});
test('an uncertain apply, including malformed success, remains locked after rereading and cannot repeat the write',async()=>{
 for(const malformed of [false,true]){const h=await harness();await h.open();await h.review();h.click('Save');await settle();if(malformed)h.requests[1].resolve({status:'applied'});else h.requests[1].reject(new Error('connection lost'));await settle();
 assert.equal(h.element('sceneBehaviorCreateSave').disabled,true);assert.equal(h.element('sceneBehaviorCreateCheck').disabled,true);h.click('Refresh');await settle();assert.equal(h.element('sceneBehaviorCreateCheck').disabled,true);h.click('Save');assert.equal(h.requests.length,2);assert.equal(h.applied.length,0);}
});
test('successful save followed by catalog-refresh failure is never resubmitted and refresh can retry separately',async()=>{
 let reject=true;const h=await harness({applied:async()=>{if(reject)throw Error('rebuild failed');}});await h.open();await h.review();h.click('Save');await settle();h.requests[1].resolve(receipt(h.requests[1].request));await settle();
 assert.equal(h.element('sceneBehaviorCreateOpen').disabled,true);assert.match(h.element('sceneBehaviorCreateStatus').textContent,/已保存.*刷新失败/);h.click('Save');assert.equal(h.requests.length,2);reject=false;h.click('Refresh');await settle();assert.equal(h.applied.length,2);assert.equal(h.element('sceneBehaviorCreateOpen').disabled,false);
});
test('owner changes during apply never refresh or navigate a different parent session',async()=>{
 const h=await harness();await h.open();await h.review();h.click('Save');await settle();h.context.session='other';h.requests[1].resolve(receipt(h.requests[1].request));await settle();assert.equal(h.applied.length,0);assert.equal(h.opened.length,0);assert.equal(h.element('sceneBehaviorCreateSave').disabled,true);
});
test('save refresh may change source token itself; saved navigation still protects new dirty drafts',async()=>{
 let h;h=await harness({applied:async()=>{h.context.sourceToken='refreshed';}});await h.open();await h.review();h.click('Save');await settle();h.requests[1].resolve(receipt(h.requests[1].request));await settle();assert.equal(h.element('sceneBehaviorCreateOpen').disabled,false);
 h.context.dirty=true;h.click('Open');await settle();assert.equal(h.opened.length,0);h.context.dirty=false;h.click('Open');await settle();assert.equal(h.opened.length,1);
});
test('close and Escape confirm local unsaved settings; pending operations block closing and shortcuts do not save the editor',async()=>{
 const h=await harness();await h.open();h.set('Path','documents/behaviors/draft.json');h.runtime.window.confirm=()=>false;h.click('Cancel');h.element('sceneBehaviorCreateDialog').dispatch('cancel');assert.equal(h.element('sceneBehaviorCreateDialog').open,true);
 h.click('Check');await settle();h.runtime.window.confirm=()=>true;h.click('Close');assert.equal(h.element('sceneBehaviorCreateDialog').open,true);const key=h.element('sceneBehaviorCreateDialog').dispatch('keydown',{key:'s',ctrlKey:true});assert.equal(key.defaultPrevented,true);
 h.requests[0].resolve(receipt(h.requests[0].request));await settle();h.click('Cancel');assert.equal(h.element('sceneBehaviorCreateDialog').open,false);assert.equal(h.element('sceneBehaviorCreateDialog').dataset.dirty,'false');assert.equal(h.applied.length,0);
});
test('dispose invalidates pending operations, releases its busy guard once and removes the dialog',async()=>{
 const h=await harness();await h.open();h.click('Check');await settle();h.controller.dispose();h.requests[0].resolve(receipt(h.requests[0].request));await settle();assert.equal(h.element('sceneBehaviorCreateDialog'),null);assert.equal(h.applied.length,0);assert.equal(h.busy.at(-1),false);const count=h.busy.length;h.controller.dispose();assert.equal(h.busy.length,count);assert.equal(h.controller.open(ids[0]),false);
});
test('failed navigation retains the saved state for a safe retry and never repeats creation',async()=>{
 let success=false;const h=await harness({openSource:async()=>success});await h.open();await h.review();h.click('Save');await settle();h.requests[1].resolve(receipt(h.requests[1].request));await settle();h.click('Open');await settle();assert.equal(h.element('sceneBehaviorCreateDialog').open,true);assert.equal(h.requests.length,2);success=true;h.click('Open');await settle();assert.equal(h.element('sceneBehaviorCreateDialog').open,false);
});
test('all fixed creation copy is translated and dynamic catalog labels remain text',async()=>{
 const source=await fs.readFile(new URL('../../web/modules/app-scene-behavior-create.js',import.meta.url),'utf8');
 const keys=new Set([...source.matchAll(/data-i18n="([^"]+)"|(?:message\s*=\s*|fail\(|t\()'([^']+)'/g)].map(m=>m[1]||m[2]).filter(key=>/[\u4e00-\u9fff]/.test(key)));
 for(const key of keys){assert.ok(en[key],`en: ${key}`);assert.ok(ja[key],`ja: ${key}`);}
 const data=catalog();data.sources[0].name='<img src=x onerror=evil()>';const h=await harness({catalog:data});await h.open();assert.match(h.element('sceneBehaviorCreateSource').textContent,/<img/);assert.equal(h.element('sceneBehaviorCreateSource').querySelector('img'),null);
});


test('capability withdrawal remains invalidating even if the host restores it before the pending response',async()=>{
 const h=await harness();await h.open();h.click('Check');await settle();h.controller.setAvailable(false,[]);h.controller.setAvailable(true,['behavior.create']);h.requests[0].resolve(receipt(h.requests[0].request));await settle();assert.equal(h.element('sceneBehaviorCreateSave').disabled,true);assert.equal(h.busy.at(-1),false);h.click('Close');assert.equal(await h.open(),true);
});

const secondSourceId = 'f0000000-0000-4000-8000-000000000001';
function multiCatalog(sourceCount = 2) {
  const data = catalog();
  for (let index = 1; index < sourceCount; index++) data.sources.push({ objectId: `f0000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    sourcePath: `documents/scripts/source-${index}.txt`, sourceRevision: revision('d'), name: `Script ${index + 1}` });
  return data;
}
const bindingElement = (h, suffix) => h.element('sceneBehaviorCreate' + suffix);
const bindingIds = h => bindingElement(h, 'BindingList').children.map(item => item.value);
async function multiHarness() {
  const h = await harness({ catalog: multiCatalog() }); await h.open(); h.click('AddBinding'); h.set('Source', secondSourceId, 'change'); h.click('AddBinding'); return h;
}

test('new bindings prefer unused instances, then permit independent behaviors on the same instance', async () => {
  const h = await harness({ catalog: multiCatalog() }); await h.open(); const firstId = bindingElement(h, 'BindingList').value;
  assert.equal(bindingElement(h, 'RemoveBinding').disabled, true); h.click('AddBinding'); const secondId = bindingElement(h, 'BindingList').value;
  assert.equal(bindingElement(h, 'Instance').value, ids[3]); assert.equal(bindingElement(h, 'Source').value, ids[4]);
  h.set('Source', secondSourceId, 'change'); h.click('AddBinding'); const thirdId = bindingElement(h, 'BindingList').value;
  assert.equal(bindingElement(h, 'Instance').value, ids[3]); assert.equal(bindingElement(h, 'Source').value, secondSourceId);
  assert.equal(new Set([firstId, secondId, thirdId]).size, 3); assert.equal(h.uuidCount(), 4);
  await h.review(); const document = JSON.parse(h.requests[0].request.content);
  assert.deepEqual(document.bindings.map(binding => binding.bindingId), [firstId, secondId, thirdId]);
  assert.deepEqual(document.bindings.map(binding => binding.instanceId), [ids[1], ids[3], ids[3]]);
  assert.deepEqual(document.bindings.map(binding => binding.implementation.sourceObjectId), [ids[4], secondSourceId, secondSourceId]);
  for (const binding of document.bindings) { assert.deepEqual(binding.parameters, {}); assert.deepEqual(binding.events, []); }
});

test('multiple scripts produce the complete deduplicated relationship review and exactly reviewed save request', async () => {
  const h = await multiHarness(); await h.review(); const preview = h.requests[0].request;
  assert.equal(bindingElement(h, 'Relations').children.length, 4);
  const references = bindingElement(h, 'Relations').children.filter(item => item.textContent.includes('references'));
  assert.deepEqual(references.map(item => item.textContent.split(' → ').at(-1)), [ids[0], ids[4], secondSourceId].sort());
  assert.equal(bindingElement(h, 'SourceText').textContent, preview.content); assert.equal(h.applied.length, 0);
  h.click('Save'); await settle(); assert.deepEqual(h.requests[1].request, { ...preview, mode: 'apply' });
  h.requests[1].resolve(receipt(h.requests[1].request, multiCatalog())); await settle(); assert.equal(h.applied.length, 1);
  assert.equal(bindingElement(h, 'Open').disabled, false); assert.equal(bindingElement(h, 'BindingList').disabled, true);
  assert.equal(bindingElement(h, 'AddBinding').disabled, true); assert.equal(bindingElement(h, 'RemoveBinding').disabled, true);
});

test('a receipt missing, duplicating or replacing any additional script reference cannot be approved', async () => {
  for (const change of [result => result.changes[0].record.relations.pop(), result => result.changes[0].record.relations.push({ ...result.changes[0].record.relations[1] }),
    result => result.changes[0].record.relations.at(-1).targetId = ids[2]]) {
    const h = await multiHarness(); h.click('Check'); await settle(); const result = receipt(h.requests[0].request, multiCatalog()); change(result);
    h.requests[0].resolve(result); await settle(); assert.equal(bindingElement(h, 'Save').disabled, true); assert.equal(h.applied.length, 0);
  }
  const h = await multiHarness(); await h.review(); h.click('Save'); await settle(); const result = receipt(h.requests[1].request, multiCatalog());
  result.changes[0].record.relations.pop(); h.requests[1].resolve(result); await settle();
  assert.equal(bindingElement(h, 'Check').disabled, true); assert.equal(bindingElement(h, 'Save').disabled, true); assert.equal(h.applied.length, 0);
  assert.match(bindingElement(h, 'Status').textContent, /尚未确认/);
});

test('switching and translating bindings preserves reviewed bytes, identities and the chosen script of each row', async () => {
  const h = await multiHarness(); await h.review(); const before = h.requests[0].request.content, identities = bindingIds(h);
  for (const language of ['en', 'ja', 'zh-CN']) {
    h.setLanguage(language);
    for (const [index, id] of identities.entries()) {
      h.set('BindingList', id, 'change'); assert.equal(bindingElement(h, 'Source').value, index === 0 ? ids[4] : secondSourceId);
      assert.equal(bindingElement(h, 'SourceText').textContent, before); assert.equal(bindingElement(h, 'Save').disabled, false);
    }
    assert.deepEqual(bindingIds(h), identities);
  }
  assert.equal(h.uuidCount(), 4); assert.equal(h.requests.length, 1);
});

test('binding removal chooses a neighbor and preserves surviving identities; new entries never reuse removed IDs', async () => {
  const h = await multiHarness(), [firstId, secondId, thirdId] = bindingIds(h); await h.review();
  h.set('BindingList', secondId, 'change'); h.click('RemoveBinding'); assert.equal(bindingElement(h, 'BindingList').value, thirdId);
  assert.deepEqual(bindingIds(h), [firstId, thirdId]); assert.equal(bindingElement(h, 'Source').value, secondSourceId); assert.equal(bindingElement(h, 'Save').disabled, true);
  h.click('AddBinding'); const replacement = bindingElement(h, 'BindingList').value; assert.notEqual(replacement, secondId);
  h.click('RemoveBinding'); assert.equal(bindingElement(h, 'BindingList').value, thirdId); h.click('RemoveBinding');
  assert.equal(bindingElement(h, 'BindingList').value, firstId); assert.equal(bindingElement(h, 'RemoveBinding').disabled, true);
  assert.equal(bindingElement(h, 'Dialog').dataset.dirty, 'false'); h.click('RemoveBinding'); assert.deepEqual(bindingIds(h), [firstId]);
});

test('the binding list enforces the existing 32-item limit and still permits repeated instance and script references', async () => {
  const h = await harness(); await h.open();
  for (let count = 1; count < SCENE_BEHAVIOR_LIMITS.bindings; count++) h.click('AddBinding');
  assert.equal(bindingIds(h).length, 32); assert.equal(h.uuidCount(), 33); assert.equal(bindingElement(h, 'AddBinding').disabled, true);
  h.click('AddBinding'); assert.equal(h.uuidCount(), 33); await h.review();
  const document = JSON.parse(h.requests[0].request.content); assert.equal(document.bindings.length, 32);
  assert.equal(new Set(document.bindings.map(binding => binding.bindingId)).size, 32); assert.equal(bindingElement(h, 'Relations').children.length, 3);
  h.click('RemoveBinding'); assert.equal(bindingElement(h, 'AddBinding').disabled, false); assert.equal(bindingElement(h, 'Save').disabled, true);
});

test('nine distinct scripts are rejected before a command, then correction retains all bindings and IDs', async () => {
  const data = multiCatalog(9), h = await harness({ catalog: data }); await h.open();
  for (let index = 1; index < data.sources.length; index++) { h.click('AddBinding'); h.set('Source', data.sources[index].objectId, 'change'); }
  const identities = bindingIds(h); h.click('Check'); await settle(); assert.equal(h.requests.length, 0); assert.equal(bindingElement(h, 'Save').disabled, true);
  assert.match(bindingElement(h, 'Status').textContent, /8 份脚本/); assert.match(bindingElement(h, 'BindingCount').textContent, /9\/8/);
  h.set('Source', data.sources[0].objectId, 'change'); await h.review(); assert.equal(bindingElement(h, 'Save').disabled, false);
  assert.deepEqual(JSON.parse(h.requests[0].request.content).bindings.map(binding => binding.bindingId), identities);
  assert.equal(bindingElement(h, 'Relations').children.length, 10); assert.match(bindingElement(h, 'BindingCount').textContent, /8\/8/);
});

test('unfinished choices on an unselected binding survive language refresh and block whole-document review', async () => {
  const h = await multiHarness(), identities = bindingIds(h);
  h.set('BindingList', identities[1], 'change'); h.set('Source', '', 'change'); h.set('Instance', '', 'change'); h.set('Path', 'documents/../unfinished');
  h.set('BindingList', identities[0], 'change'); h.setLanguage('ja'); h.click('Refresh'); await settle();
  assert.deepEqual(bindingIds(h), identities); assert.equal(bindingElement(h, 'Path').value, 'documents/../unfinished');
  h.set('Path', 'documents/behaviors/complete.json'); h.click('Check'); await settle(); assert.equal(h.requests.length, 0);
  h.set('BindingList', identities[1], 'change'); assert.equal(bindingElement(h, 'Source').value, ''); assert.equal(bindingElement(h, 'Instance').value, '');
  h.set('Source', secondSourceId, 'change'); h.set('Instance', ids[1], 'change'); await h.review();
  assert.equal(bindingElement(h, 'Save').disabled, false); assert.equal(h.uuidCount(), 4);
});

test('refreshed catalogs keep missing scripts and instances visible on every affected binding until corrected', async () => {
  const h = await multiHarness(), identities = bindingIds(h); h.set('BindingList', identities[0], 'change');
  const next = catalog(); next.scene.instances.pop(); h.setCatalog(next); h.click('Refresh'); await settle();
  assert.deepEqual(bindingIds(h), identities); assert.match(bindingElement(h, 'BindingList').children[1].textContent, /已不可用/);
  h.click('Check'); await settle(); assert.equal(h.requests.length, 0);
  for (const id of identities.slice(1)) {
    h.set('BindingList', id, 'change'); assert.equal(bindingElement(h, 'Source').value, secondSourceId); assert.equal(bindingElement(h, 'Instance').value, ids[3]);
    assert.match(bindingElement(h, 'Source').children[0].textContent, /已不可用/); assert.match(bindingElement(h, 'Instance').children[0].textContent, /已不可用/);
    h.set('Source', ids[4], 'change'); h.set('Instance', ids[1], 'change');
  }
  await h.review(); assert.equal(bindingElement(h, 'Save').disabled, false); assert.equal(h.uuidCount(), 4);
});

test('pending reviews lock list selection and topology, and silent selected-binding edits invalidate late responses', async () => {
  const h = await multiHarness(), identities = bindingIds(h); h.click('Check'); await settle();
  for (const suffix of ['BindingList', 'AddBinding', 'RemoveBinding', 'Instance', 'Source']) assert.equal(bindingElement(h, suffix).disabled, true);
  h.set('BindingList', identities[0], 'change'); assert.equal(bindingElement(h, 'BindingList').value, identities[2]);
  h.click('AddBinding'); h.click('RemoveBinding'); assert.deepEqual(bindingIds(h), identities); assert.equal(h.uuidCount(), 4);
  bindingElement(h, 'Source').value = ids[4]; h.requests[0].resolve(receipt(h.requests[0].request, multiCatalog())); await settle();
  assert.equal(bindingElement(h, 'Save').disabled, true); assert.equal(h.applied.length, 0);
});

test('cancellation protects the complete binding list and discards it without commands when confirmed', async () => {
  const h = await multiHarness(), identities = bindingIds(h); let confirmations = 0;
  h.set('Source', '', 'change'); h.set('BindingList', identities[0], 'change'); h.runtime.window.confirm = () => { confirmations++; return false; };
  h.click('Cancel'); assert.equal(confirmations, 1); assert.equal(bindingElement(h, 'Dialog').open, true);
  h.set('BindingList', identities[2], 'change'); assert.equal(bindingElement(h, 'Source').value, ''); assert.deepEqual(bindingIds(h), identities);
  h.runtime.window.confirm = () => true; h.click('Close'); assert.equal(bindingElement(h, 'Dialog').open, false); assert.equal(h.requests.length, 0);
});


test('backend selection invalidates approval and preserves every binding identity and selected script', async () => {
  const h = await multiHarness(), identities = bindingIds(h); await h.review();
  const godot = h.requests[0].request, before = JSON.parse(godot.content);
  assert.equal(bindingElement(h, 'Profile').value, 'godot-gdscript');
  assert.deepEqual(bindingElement(h, 'Profile').children.map(option => option.value), ['godot-gdscript', 'bevy-rust']);
  h.set('Profile', 'bevy-rust', 'change'); assert.equal(bindingElement(h, 'Save').disabled, true); assert.equal(bindingElement(h, 'Review').hidden, true);
  h.click('Save'); await settle(); assert.equal(h.requests.length, 1); assert.deepEqual(bindingIds(h), identities);
  await h.review(); const rust = h.requests[1].request, document = JSON.parse(rust.content);
  assert.equal(rust.objectId, godot.objectId); assert.equal(rust.sourcePath, godot.sourcePath);
  assert.deepEqual(document.bindings.map(binding => ({ ...binding, implementation: { ...binding.implementation, backendId: 'org.viento.godot4', language: 'gdscript' } })), before.bindings);
  for (const binding of document.bindings) { assert.equal(binding.implementation.backendId, 'org.viento.bevy-rust'); assert.equal(binding.implementation.language, 'rust'); }
  assert.equal(bindingElement(h, 'SourceText').textContent, rust.content); assert.equal(h.uuidCount(), 4);
  h.click('Save'); await settle(); assert.deepEqual(h.requests[2].request, { ...rust, mode: 'apply' });
  h.requests[2].resolve(receipt(h.requests[2].request, multiCatalog())); await settle(); assert.equal(h.applied.length, 1);
  assert.equal(bindingElement(h, 'Profile').disabled, true); assert.equal(bindingElement(h, 'Open').disabled, false);
});

test('a silent backend switch cannot submit a reviewed profile or approve a late pending response', async () => {
  const reviewed = await harness(); await reviewed.open(); await reviewed.review();
  bindingElement(reviewed, 'Profile').value = 'bevy-rust'; reviewed.click('Save'); await settle();
  assert.equal(reviewed.requests.length, 1); assert.equal(bindingElement(reviewed, 'Save').disabled, true);
  const pending = await harness(); await pending.open(); pending.click('Check'); await settle();
  assert.equal(bindingElement(pending, 'Profile').disabled, true); bindingElement(pending, 'Profile').value = 'bevy-rust';
  pending.requests[0].resolve(receipt(pending.requests[0].request)); await settle();
  assert.equal(bindingElement(pending, 'Save').disabled, true); assert.equal(bindingElement(pending, 'Review').hidden, true); assert.equal(pending.applied.length, 0);
  await pending.review(); assert.equal(JSON.parse(pending.requests[1].request.content).bindings[0].implementation.backendId, 'org.viento.bevy-rust');
});

test('unknown behavior profiles fail before command execution rather than falling back to Godot', async () => {
  const h = await harness(); await h.open(); const identities = bindingIds(h);
  for (const value of ['', 'org.viento.bevy', 'rust', 'godot-rust', 'bevy-gdscript']) {
    h.set('Profile', value, 'change'); h.click('Check'); await settle();
    assert.equal(h.requests.length, 0); assert.equal(bindingElement(h, 'Save').disabled, true); assert.deepEqual(bindingIds(h), identities);
    assert.match(bindingElement(h, 'Status').textContent, /请选择已支持/);
  }
  h.set('Profile', 'bevy-rust', 'change'); await h.review(); assert.equal(bindingElement(h, 'Save').disabled, false);
});

test('profile and exact reviewed source survive language changes, binding selection and catalog refresh', async () => {
  const h = await multiHarness(), identities = bindingIds(h); h.set('Profile', 'bevy-rust', 'change'); await h.review();
  const before = h.requests[0].request.content;
  for (const locale of ['en', 'ja', 'zh-CN']) {
    h.setLanguage(locale); h.set('BindingList', identities[0], 'change');
    assert.equal(bindingElement(h, 'Profile').value, 'bevy-rust'); assert.equal(bindingElement(h, 'SourceText').textContent, before);
    assert.equal(bindingElement(h, 'Save').disabled, false); assert.deepEqual(bindingIds(h), identities);
  }
  h.click('Refresh'); await settle(); assert.equal(bindingElement(h, 'Profile').value, 'bevy-rust'); assert.equal(bindingElement(h, 'Save').disabled, true);
  await h.review(); assert.equal(h.requests[1].request.content, before); assert.equal(h.uuidCount(), 4);
  h.set('Profile', 'godot-gdscript', 'change'); await h.review();
  assert.deepEqual(JSON.parse(h.requests[2].request.content).bindings.map(binding => binding.implementation.language), ['gdscript', 'gdscript', 'gdscript']);
  assert.deepEqual(bindingIds(h), identities);
});
