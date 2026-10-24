import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { physics2dPureFixture, id, digest, revision, manifest, actorId, sceneId, manifestId, instanceA, instanceB } from './helpers/world-physics2d-create-pure-fixture.mjs';
import { preparePhysics2DCreate, inspectPhysics2DCreateScene, physics2DCreateRegistration, appendScenePhysics2DRelation, physics2DCreationRegistryGuard, validatePhysics2DCreateRecovery, PHYSICS2D_CREATE_RECOVERY_LIMITS } from '../../engine/world-physics2d-create.mjs';
import { createWorldProjection, canonicalJson } from '../../engine/world-projection.mjs';
import { worldMutationDescriptors, validateWorldCommand, RELATION_KINDS } from '../../engine/world-command-contract.mjs';
const copy=structuredClone;
for(const [version,schema] of [[2,2],[3,2],[3,3]]) test(`physics2d.create workspace${version}/scene${schema} plans exactly three files and preserves unrelated bytes`,async()=>{
  const f=await physics2dPureFixture(version,schema),before=canonicalJson(f.source),p=await f.run();
  assert.equal(canonicalJson(f.source),before);assert.equal(p.kind,'physics2d.create');assert.equal(p.plans.length,3);
  assert.deepEqual(p.plans.map(x=>x.beforeContent),[null,null,f.sceneRecordContent]);assert.deepEqual(p.plans.map(x=>x.change.objectId),[manifestId,manifestId,sceneId]);
  assert.equal(p.plans[0].afterContent,f.request.content);assert.equal(p.plans[2].afterContent.replace(', {"kind":"references","targetId":"'+manifestId+'","slot":"physics2d"}',''),f.sceneRecordContent);
  assert.match(p.plans[2].afterContent,/9007199254740993/);assert.match(p.plans[2].afterContent,/\\u4e2d/);assert.match(p.plans[2].afterContent,/1e2/);
  assert.deepEqual(p.result.changes[0].record.relations,[{kind:'references',targetId:sceneId,slot:''}]);assert.deepEqual(p.result.changes[0].record.assetBindings,[]);
  assert.deepEqual(Object.keys(p.physics2DRecovery),['scene','definitions']);assert.equal(p.physics2DRecovery.definitions.length,1);assert.ok(Object.isFrozen(p.physics2DRecovery.definitions[0]));
  assert.equal(p.result.object.documentRefs[0].sourceRevision,revision(f.request.content));assert.deepEqual(p.result.proposal.preconditions.map(x=>x.objectId),[actorId,sceneId]);
  assert.equal((await f.run({mode:'apply'})).result.proposal.id,p.result.proposal.id);
  for(const d of f.source.documents)assert.equal(p.nextSource.documents.find(n=>n.record.id===d.record.id).content,d.content);
  const next=await createWorldProjection(p.nextSource,{digest}),ready=inspectPhysics2DCreateScene(p.nextSource,next,sceneId);
  assert.deepEqual(ready.manifest.record,p.result.changes[0].record);assert.deepEqual(ready.targets,f.context.targets);assert.deepEqual(ready.instances,[{instanceId:instanceA,objectId:actorId},{instanceId:instanceB,objectId:actorId}]);
});
test('command advertises separate 64KiB schema without widening audio behavior or generic relationships',async()=>{
  const f=await physics2dPureFixture(),descriptors=worldMutationDescriptors();
  assert.equal(descriptors.find(d=>d.id==='physics2d.create').inputSchema.properties.content.maxLength,65536);
  for(const command of ['audio.create','behavior.create'])assert.equal(descriptors.find(d=>d.id===command).inputSchema.properties.content.maxLength,32768);
  assert.deepEqual(RELATION_KINDS,['part-of','references']);assert.deepEqual(validateWorldCommand(f.request),f.request);
  for(const patch of [{extra:true},{content:'x'.repeat(65537)},{sceneSourceRevision:'bad'},{sceneObjectRevision:undefined},{content:'\ud800'},{actorRef:{kind:'user',id:'user',extra:true}}])assert.throws(()=>validateWorldCommand({...f.request,...patch}),{errorCode:'world_command_invalid'});
  let calls=0;const bad={...f.request};Object.defineProperty(bad,'actorRef',{enumerable:true,get(){calls++;return f.request.actorRef;}});assert.throws(()=>validateWorldCommand(bad),{errorCode:'world_command_invalid'});assert.equal(calls,0);
});
test('planning pins world scene source and exact existing metadata before editing',async()=>{
  const f=await physics2dPureFixture();for(const key of ['baseRevision','sceneObjectRevision','sceneSourceRevision'])await assert.rejects(f.run({[key]:revision('stale')}),{errorCode:'world_revision_conflict'});
  await assert.rejects(preparePhysics2DCreate(f.source,f.projection,f.sceneRecordContent.replace('9007199254740993','1'),f.request,{digest}),{errorCode:'world_revision_conflict'});
  f.scene.content+=' ';await assert.rejects(f.run(),{errorCode:'world_revision_conflict'});
});
test('duplicate dangling and existing physics2d selections cannot acquire another first physics2d',async()=>{
  for(const relations of [[{kind:'references',slot:'physics2d',targetId:id(98)}],[{kind:'references',slot:'physics2d',targetId:id(98)},{kind:'references',slot:'physics2d',targetId:id(99)}]]){const f=await physics2dPureFixture();f.scene.record.relations.push(...relations);await assert.rejects(f.run(),{errorCode:'world_physics2d_invalid'});}
  const f=await physics2dPureFixture(),p=await f.run(),projection=await createWorldProjection(p.nextSource,{digest}),scene=projection.objects.find(o=>o.id===sceneId);
  await assert.rejects(preparePhysics2DCreate(p.nextSource,projection,p.plans[2].afterContent,{...f.request,objectId:id(99),baseRevision:projection.world.revision,sceneObjectRevision:scene.revision},{digest}),{errorCode:'world_physics2d_invalid'});
});
test('malformed author text target membership and physics2d bounds fail without a partial plan',async()=>{
  const f=await physics2dPureFixture();for(const change of [d=>d.sceneObjectId=id(99),d=>d.bodies=[],d=>d.bodies[0].shape.size[0]=0,d=>d.bodies[1].id=d.bodies[0].id,d=>d.bodies[0].instanceId=id(99),d=>d.bodies[1].instanceId=d.bodies[0].instanceId]){const d=manifest();change(d);await assert.rejects(f.run({content:JSON.stringify(d)}),{errorCode:'world_physics2d_invalid'});}
  for(const content of ['{}','{broken',JSON.stringify(manifest()).replace('"layer":1','"layer":2,"layer":1'),f.request.content+' '.repeat(65536),f.request.content+'中'.repeat(44000)])await assert.rejects(f.run({content}),error=>['world_physics2d_invalid','world_command_invalid'].includes(error.errorCode));
});
test('source type portability and global identity conflicts remain delegated to generic creation',async()=>{
  const f=await physics2dPureFixture();for(const [patch,errorCode] of [[{objectId:actorId},'world_identity_conflict'],[{sourcePath:f.scene.sourcePath},'world_create_path_conflict'],[{sourcePath:'../outside.json'},'world_create_path_invalid'],[{documentType:'missing'},'world_type_unknown'],[{sourcePath:'documents/no.md'},'world_physics2d_invalid'],[{sourcePath:'documents/no.JSON'},'world_physics2d_invalid']])await assert.rejects(f.run(patch),{errorCode});
});
test('stable actor identities require unique instances available definitions and nonownership links',async()=>{
  for(const mutate of [f=>{const v=JSON.parse(f.scene.content.slice(1));v.schemaVersion=1;f.scene.content=JSON.stringify(v);},f=>{const v=JSON.parse(f.scene.content.slice(1));v.actors[1].instanceId=v.actors[0].instanceId;f.scene.content=JSON.stringify(v);},f=>{delete f.source.documents[0].content;},f=>{f.scene.record.relations[0].kind='part-of';},f=>{f.source.documents.splice(0,1);}]){
    const f=await physics2dPureFixture();mutate(f);assert.throws(()=>inspectPhysics2DCreateScene(f.source,f.projection,sceneId),{errorCode:'world_physics2d_invalid'});
  }
});
test('frozen recovery validates complete scene definition evidence and never depends on live content',async()=>{
  const f=await physics2dPureFixture(),p=await f.run(),record=p.result.changes[0].record,scene=p.nextSource.documents.find(d=>d.record.id===sceneId).record;
  const check=body=>validatePhysics2DCreateRecovery(record,f.request.content,scene,body,f.registry(),{digest});
  assert.deepEqual(await check(p.physics2DRecovery),{ok:true,diagnostics:[]});
  for(const mutate of [r=>r.scene.content+=' ',r=>r.definitions=[],r=>r.definitions.push(r.definitions[0]),r=>r.definitions[0].objectId=id(99),r=>r.definitions[0].sourcePath='else.md',r=>r.definitions[0].content+=' ',r=>r.resources=[],r=>r.extra=true]){const r=copy(p.physics2DRecovery);mutate(r);assert.equal((await check(r)).ok,false);}
  let calls=0;const input=copy(p.physics2DRecovery);Object.defineProperty(input.definitions[0],'content',{enumerable:true,get(){calls++;return '';}});assert.equal((await check(input)).ok,false);assert.equal(calls,0);
  f.scene.content='live scene changed';f.source.documents[0].content='live actor changed';assert.equal((await check(p.physics2DRecovery)).ok,true);
  assert.deepEqual(PHYSICS2D_CREATE_RECOVERY_LIMITS,{bytes:33554432,sceneBytes:8388608,definitionBytes:8388608,definitions:128});
});
test('recovery requires exact generated registration and scene opt-in while registry guard excludes only edited records',async()=>{
  const f=await physics2dPureFixture(),p=await f.run(),record=p.result.changes[0].record,scene=p.nextSource.documents.find(d=>d.record.id===sceneId).record;
  for(const mutate of [r=>r.relations.push({kind:'references',targetId:actorId,slot:''}),r=>r.assetBindings.push({assetId:id(99),role:'unrelated'}),r=>r.extra=true]){const r=copy(record);mutate(r);assert.equal((await validatePhysics2DCreateRecovery(r,f.request.content,scene,p.physics2DRecovery,f.registry(),{digest})).ok,false);}
  const wrongScene=copy(scene);wrongScene.relations=wrongScene.relations.filter(r=>!(r.kind==='references'&&r.slot==='physics2d'));assert.equal((await validatePhysics2DCreateRecovery(record,f.request.content,wrongScene,p.physics2DRecovery,f.registry(),{digest})).ok,false);
  const reg=f.registry(),first=physics2DCreationRegistryGuard(reg,manifestId,sceneId);reg.documents.find(r=>r.id===sceneId).extension='changed';assert.equal(physics2DCreationRegistryGuard(reg,manifestId,sceneId),first);reg.documents[0].parserProfile='field';assert.notEqual(physics2DCreationRegistryGuard(reg,manifestId,sceneId),first);
  assert.deepEqual(physics2DCreateRegistration(record,manifest()),record);assert.throws(()=>appendScenePhysics2DRelation(p.plans[2].afterContent,manifestId),{errorCode:'world_physics2d_invalid'});
});
test('unrelated malformed audio and behavior declarations do not couple physics2d creation to engine execution',async()=>{
  const f=await physics2dPureFixture();for(const [i,kind]of [[80,'audio'],[81,'behavior']]){const old=f.source.documents[2],record={...old.record,id:id(i),sourcePath:`documents/${kind}.json`};f.source.documents.push({...old,record,descriptor:record,sourcePath:record.sourcePath,content:'{invalid author draft',sourceRevision:revision('{invalid author draft')});f.scene.record.relations.push({kind,targetId:record.id,slot:''});}
  const metadata=JSON.stringify(f.scene.record),projection=await createWorldProjection(f.source,{digest}),sceneObject=projection.objects.find(o=>o.id===sceneId);
  const p=await preparePhysics2DCreate(f.source,projection,metadata,{...f.request,baseRevision:projection.world.revision,sceneObjectRevision:sceneObject.revision},{digest});
  assert.equal(p.plans.length,3);assert.deepEqual(p.result.scene.provenance.descriptor.relations.filter(r=>['audio','behavior'].includes(r.kind)),f.scene.record.relations.slice(-2));
  const code=await fs.readFile(new URL('../../engine/world-physics2d-create.mjs',import.meta.url),'utf8');assert.doesNotMatch(code,/from ['"].*(?:build-plan|world-scene-create|scene-audio|scene-behavior|godot|bevy)/i);
});
test('existing physics2d with a removed target remains navigable for repair',async()=>{
  const f=await physics2dPureFixture(),p=await f.run(),scene=p.nextSource.documents.find(d=>d.record.id===sceneId),value=JSON.parse(scene.content.slice(1));value.actors.pop();scene.content=JSON.stringify(value);scene.sourceRevision=revision(scene.content);
  const projection=await createWorldProjection(p.nextSource,{digest}),ready=inspectPhysics2DCreateScene(p.nextSource,projection,sceneId);
  assert.equal(ready.manifest.record.id,manifestId);assert.equal(ready.targets.length,1);
});
test('request data is captured before asynchronous hashing and cannot change mid-plan',async()=>{
  const f=await physics2dPureFixture(),request=copy(f.request);let first=true;const delayed=async value=>{if(first){first=false;request.content='{}';request.actorRef.id='changed';}return digest(value);};
  const p=await preparePhysics2DCreate(f.source,f.projection,f.sceneRecordContent,request,{digest:delayed});assert.equal(p.plans[0].afterContent,f.request.content);assert.deepEqual(p.result.proposal.actorRef,f.request.actorRef);
});

test('physics membership is independent of effective movement and backend planning',async()=>{
  const f=await physics2dPureFixture(),value=JSON.parse(f.scene.content.slice(1));
  value.actors.forEach(actor=>{actor.controls='arrows';actor.speed=120;});
  f.scene.content=JSON.stringify(value);f.scene.sourceRevision=revision(f.scene.content);
  const projection=await createWorldProjection(f.source,{digest}),scene=projection.objects.find(object=>object.id===sceneId);
  const p=await preparePhysics2DCreate(f.source,projection,f.sceneRecordContent,{...f.request,baseRevision:projection.world.revision,sceneObjectRevision:scene.revision,sceneSourceRevision:f.scene.sourceRevision},{digest});
  assert.equal(p.plans.length,3);assert.equal(JSON.parse(p.plans[0].afterContent.slice(1)).bodies[1].kind,'sensor');
  const code=await fs.readFile(new URL('../../engine/world-physics2d-create.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(code,/from ['"].*(?:build-plan|scene-physics2d\.mjs|godot|bevy)/i);
});
test('physics scene opt-in uses only references/physics2d and retains other slots',async()=>{
  const f=await physics2dPureFixture();f.scene.record.relations.push({kind:'references',targetId:id(3),slot:'preview'});
  const metadata=JSON.stringify(f.scene.record),projection=await createWorldProjection(f.source,{digest}),scene=projection.objects.find(o=>o.id===sceneId);
  const p=await preparePhysics2DCreate(f.source,projection,metadata,{...f.request,baseRevision:projection.world.revision,sceneObjectRevision:scene.revision},{digest});
  assert.deepEqual(p.result.scene.provenance.descriptor.relations.slice(-2),[{kind:'references',targetId:id(3),slot:'preview'},{kind:'references',targetId:manifestId,slot:'physics2d'}]);
  const next=await createWorldProjection(p.nextSource,{digest}),m=p.nextSource.documents.find(d=>d.record.id===manifestId);
  m.record.relations[0].kind='reference';assert.throws(()=>inspectPhysics2DCreateScene(p.nextSource,next,sceneId),{errorCode:'world_physics2d_invalid'});
});
