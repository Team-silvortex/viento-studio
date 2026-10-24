import test from 'node:test';
import assert from 'node:assert/strict';
import { physics2dPureFixture, id, revision, digest, sceneId, actorId } from './helpers/world-physics2d-create-pure-fixture.mjs';
import { SCENE_PHYSICS2D_CREATION_API_PATH, captureScenePhysics2DCreationContext, createScenePhysics2DCreationRequest, validateScenePhysics2DCreationResult, confirmScenePhysics2DCreation } from '../../engine/scene-physics2d-creation-contract.mjs';
import { createWorldProjection } from '../../engine/world-projection.mjs';
import { preparePhysics2DCreate } from '../../engine/world-physics2d-create.mjs';
const invalid={errorCode:'scene_physics2d_creation_invalid'};
const draft=f=>Object.fromEntries(['objectId','documentType','sourcePath','content'].map(key=>[key,f.request[key]]));
const ready=(f,p)=>({...f.context,status:'ready',baseRevision:p.result.revision,scene:{...f.context.scene,objectRevision:p.result.scene.revision},manifest:{objectId:f.request.objectId,objectRevision:p.result.object.revision,sourcePath:f.request.sourcePath,sourceRevision:revision(f.request.content),documentType:f.request.documentType,parserProfile:'structured',content:f.request.content,relations:structuredClone(p.result.changes[0].record.relations),assetBindings:[],bodyCount:2}});
test('context captures repeated instances of one definition as detached immutable choices',async()=>{
  const f=await physics2dPureFixture();assert.equal(SCENE_PHYSICS2D_CREATION_API_PATH,'/api/scene-physics2d-creation');
  const c=captureScenePhysics2DCreationContext(f.context,sceneId);assert.deepEqual(c,f.context);assert.ok(Object.isFrozen(c.targets[0]));
  f.context.targets[0].name='changed';assert.notEqual(c.targets[0].name,f.context.targets[0].name);
});
test('context rejects mismatched identities paths definitions duplicate instances and unknown fields',async()=>{
  const f=await physics2dPureFixture();for(const mutate of [c=>c.targets=[],c=>c.targets[0].sourcePath='/etc/secret.md',c=>c.targets[0].sourcePath='documents/../other.md',c=>c.targets[0].sourcePath='documents/a\\b.md',c=>c.targets[0].sourcePath='documents/CON.md',c=>c.targets[0].sourcePath=c.scene.sourcePath,c=>c.targets[0].sourcePath='else/a.md',c=>c.targets[0].objectId=sceneId,c=>c.targets[0].name=' ',c=>c.targets[0].name='bad\nname',c=>c.targets[0].name='\ud800',c=>c.targets[1].name='alias',c=>c.targets[1].sourcePath='documents/another.md',c=>c.targets[1].objectId=id(99),c=>c.targets.push(c.targets[0]),c=>c.targets[0].extra=true,c=>c.extra=true,c=>c.scene.objectId=id(99),c=>c.documentRoot='../documents',c=>c.documentTypes.push(c.documentTypes[0]),c=>c.status='creating',c=>c.worldId='bad',c=>c.baseRevision='bad',c=>c.manifest={}]){
    const c=structuredClone(f.context);mutate(c);assert.throws(()=>captureScenePhysics2DCreationContext(c,sceneId),invalid);
  }
  assert.throws(()=>captureScenePhysics2DCreationContext(f.context),invalid);
});
test('context capture rejects accessors serializers inherited properties sparse arrays symbols and decorated lists',async()=>{
  const f=await physics2dPureFixture();let calls=0;
  for(const mutate of [c=>Object.defineProperty(c,'targets',{enumerable:true,get(){calls++;return f.context.targets;}}),c=>Object.defineProperty(c.targets[0],'name',{enumerable:true,get(){calls++;return 'bad';}}),c=>c.targets[0].toJSON=()=>{calls++;return {};},c=>c.targets=Object.assign([...c.targets],{extra:true}),c=>delete c.targets[0],c=>Object.defineProperty(c,'hidden',{value:true}),c=>c[Symbol('extra')]=true,c=>Object.setPrototypeOf(c,{})]){
    const c=structuredClone(f.context);mutate(c);assert.throws(()=>captureScenePhysics2DCreationContext(c,sceneId),invalid);
  }
  Object.defineProperty(Array.prototype,'toJSON',{configurable:true,value(){calls++;return [];}});
  try{assert.throws(()=>captureScenePhysics2DCreationContext(f.context,sceneId),invalid);}finally{delete Array.prototype.toJSON;}
  assert.equal(calls,0);
});
test('request binds saved scene world catalog target membership and known selected document type',async()=>{
  const f=await physics2dPureFixture();assert.deepEqual(createScenePhysics2DCreationRequest(f.context,draft(f)),f.request);assert.equal(createScenePhysics2DCreationRequest(f.context,draft(f),'apply').mode,'apply');
  for(const mutate of [d=>d.extra=true,d=>d.objectId=sceneId,d=>d.objectId=actorId,d=>d.sourcePath='../outside.json',d=>d.sourcePath='other/outside.json',d=>d.sourcePath='documents/foo.md',d=>d.sourcePath='documents/foo.JSON',d=>d.documentType='missing',d=>{const v=JSON.parse(d.content.slice(1));v.bodies[0].instanceId=id(99);d.content=JSON.stringify(v);},d=>{const v=JSON.parse(d.content.slice(1));v.sceneObjectId=id(99);d.content=JSON.stringify(v);}]){const d=draft(f);mutate(d);assert.throws(()=>createScenePhysics2DCreationRequest(f.context,d),invalid);}
  assert.throws(()=>createScenePhysics2DCreationRequest(f.context,draft(f),'save'),invalid);
  const c=structuredClone(f.context);c.documentTypes.push({id:'motion',label:'Custom physics2d'});assert.equal(createScenePhysics2DCreationRequest(c,{...draft(f),documentType:'motion'}).documentType,'motion');
});
test('source accepts BOM CRLF and exactly 64KiB author bytes but rejects duplicate keys malformed UTF8 and overflow',async()=>{
  const f=await physics2dPureFixture(),d=draft(f);assert.ok(d.content.startsWith('\uFEFF'));assert.match(d.content,/\r\n/);
  const bytes=new TextEncoder().encode(d.content).length;d.content+=' '.repeat(65536-bytes);assert.equal(createScenePhysics2DCreationRequest(f.context,d).content,d.content);
  for(const content of [d.content+' ',f.request.content+'中'.repeat(44000),f.request.content+'\ud800',f.request.content.replace('"layer": 1','"layer": 2, "layer": 1'),'{broken'])assert.throws(()=>createScenePhysics2DCreationRequest(f.context,{...draft(f),content}),invalid);
});
test('actual preview and applied receipt confirm the complete three-file mutation and returned identities',async()=>{
  const f=await physics2dPureFixture(),p=await f.run(),hash=revision(f.request.content);assert.deepEqual(validateScenePhysics2DCreationResult(p.result,f.request,f.context,hash),p.result);
  const request={...f.request,mode:'apply'},result={...structuredClone(p.result),status:'applied',receipt:{format:'viento-transaction-receipt',schemaVersion:1,transactionId:id(90),worldId:f.request.worldId,proposalId:p.result.proposal.id,baseRevision:f.request.baseRevision,revision:p.result.revision,state:'committed'}};
  const captured=validateScenePhysics2DCreationResult(result,request,f.context,hash);assert.deepEqual(captured,result);assert.ok(Object.isFrozen(captured.object.provenance.descriptor.relations[0]));
  for(const mutate of [r=>r.changes[0].afterText+=' ',r=>r.changes[0].record.assetBindings.push({assetId:id(99),role:'bad'}),r=>r.changes[0].record.relations.push({kind:'references',targetId:id(99),slot:''}),r=>r.changes[0].record.relations[0].note='extra',r=>r.object.documentRefs[0].sourceRevision=revision('other'),r=>r.scene.documentRefs[0].sourceRevision=revision('other'),r=>r.relation.properties.slot='other',r=>r.changes[1].targetObjectId=id(99),r=>r.changes[1].beforeRecordRevision=r.changes[1].afterRecordRevision,r=>r.proposal.commands[0].input.sourcePath='documents/other.json',r=>r.proposal.affectedObjects.reverse(),r=>r.proposal.preconditions=r.proposal.preconditions.filter(item=>item.objectId===sceneId),r=>r.proposal.preconditions[0].objectId=id(99),r=>r.receipt.state='rolled-back',r=>r.receipt.proposalId='proposal:'+'f'.repeat(64),r=>r.extra=true]){
    const changed=structuredClone(result);mutate(changed);assert.throws(()=>validateScenePhysics2DCreationResult(changed,request,f.context,hash),invalid);
  }
});
test('lost response confirmation requires exact saved content source revision and generated bidirectional registration',async()=>{
  const f=await physics2dPureFixture(),p=await f.run(),c=ready(f,p),hash=revision(f.request.content);
  assert.equal(confirmScenePhysics2DCreation(c,f.request,hash),true);assert.equal(confirmScenePhysics2DCreation(f.context,f.request,hash),false);
  for(const mutate of [c=>c.manifest.objectId=id(99),c=>c.manifest.content+=' ',c=>c.manifest.sourceRevision=revision('other'),c=>c.scene.sourceRevision=revision('other'),c=>c.manifest.sourcePath='documents/else.json',c=>c.manifest.relations.push({kind:'references',targetId:id(99),slot:''}),c=>c.manifest.assetBindings.push({assetId:id(99),role:'extra'}),c=>c.targets.pop()]){
    const changed=structuredClone(c);mutate(changed);assert.equal(confirmScenePhysics2DCreation(changed,f.request,hash),false);
  }
});
test('ready navigation keeps author metadata and permits removed instance repair without confirming a new creation',async()=>{
  const f=await physics2dPureFixture(),p=await f.run(),c=ready(f,p);
  c.targets.pop();c.manifest.relations=[{kind:'references',targetId:sceneId,slot:'scene',note:{label:'original'}}];c.manifest.assetBindings=[{assetId:id(99),role:'',author:{tags:['unrelated']}}];
  assert.deepEqual(captureScenePhysics2DCreationContext(c,sceneId),c);assert.equal(confirmScenePhysics2DCreation(c,f.request,revision(f.request.content)),false);
  assert.throws(()=>createScenePhysics2DCreationRequest(c,draft(f)),invalid);
});
test('ready metadata is bounded descriptor data and retains no invisible executable objects',async()=>{
  const f=await physics2dPureFixture(),p=await f.run();let calls=0;
  for(const mutate of [c=>Object.defineProperty(c.manifest.relations[0],'note',{enumerable:true,get(){calls++;return 'bad';}}),c=>c.manifest.relations[0].note='x'.repeat(65537),c=>c.manifest.relations[0].note=Array(257).fill('x'),c=>{c.manifest.relations[0].note={};let nested=c.manifest.relations[0].note;for(let i=0;i<17;i++)nested=nested.child={};},c=>delete c.manifest.relations[0].targetId,c=>c.manifest.relations[0].kind=' ',c=>c.manifest.relations[0].slot=0,c=>c.manifest.relations[0]=null,c=>c.manifest.assetBindings=[{}],c=>c.manifest.bodyCount=1,c=>c.manifest.objectId=actorId]){
    const c=ready(f,p);mutate(c);assert.throws(()=>captureScenePhysics2DCreationContext(c,sceneId),invalid);
  }
  assert.equal(calls,0);
});

test('preview retains scene metadata beyond the physics source budget while source stays at 64KiB',async()=>{
  const f=await physics2dPureFixture();f.scene.record.extension.note='x'.repeat(65537);
  const projection=await createWorldProjection(f.source,{digest}),scene=projection.objects.find(object=>object.id===sceneId);
  const request={...f.request,baseRevision:projection.world.revision,sceneObjectRevision:scene.revision};
  const context={...f.context,baseRevision:projection.world.revision,scene:{...f.context.scene,objectRevision:scene.revision}};
  const plan=await preparePhysics2DCreate(f.source,projection,JSON.stringify(f.scene.record),request,{digest});
  const result=validateScenePhysics2DCreationResult(plan.result,request,context,revision(request.content));
  assert.equal(result.scene.provenance.descriptor.extension.note,f.scene.record.extension.note);
  const tooLongSource=request.content+' '.repeat(65537-new TextEncoder().encode(request.content).length);
  assert.equal(new TextEncoder().encode(tooLongSource).length,65537);
  assert.throws(()=>createScenePhysics2DCreationRequest(context,{objectId:request.objectId,documentType:request.documentType,sourcePath:request.sourcePath,content:tooLongSource}),invalid);
  assert.throws(()=>validateScenePhysics2DCreationResult(result,{...request,content:tooLongSource},context,revision(tooLongSource)),invalid);
  const oversized=structuredClone(plan.result);oversized.scene.provenance.descriptor.extension.note='x'.repeat(1048577);
  assert.throws(()=>validateScenePhysics2DCreationResult(oversized,request,context,revision(request.content)),invalid);
  const aggregate=structuredClone(plan.result);aggregate.scene.provenance.descriptor.extension.notes=Array(5).fill('x'.repeat(1048576));
  assert.throws(()=>validateScenePhysics2DCreationResult(aggregate,request,context,revision(request.content)),invalid);
});
