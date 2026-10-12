import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createScene3DTranslationProposal, prepareScene3DTranslationApply, isScene3DTranslationProposal } from '../../engine/scene3d-translation.mjs';
import { createScene3DTransformProposal, prepareScene3DTransformApply, isScene3DTransformProposal } from '../../engine/scene3d-transform.mjs';
import { createScene3DObjectsProposal, isScene3DObjectsProposal } from '../../engine/scene3d-objects.mjs';
import { createScene3DEnvironmentProposal, isScene3DEnvironmentProposal } from '../../engine/scene3d-environment.mjs';
import { createScene3DPropertiesProposal, isScene3DPropertiesProposal } from '../../engine/scene3d-properties.mjs';

const original='\uFEFF'+(await fs.readFile(new URL('../../examples/scene3d/scene.json',import.meta.url),'utf8')).replaceAll('\n','\r\n');
const model=JSON.parse(original.slice(1)),hash=value=>createHash('sha256').update(value).digest('hex');
const snapshot=(overrides={})=>({sourcePath:'documents/scenes/scene.json',token:'3:7:1:1',content:original,baseSourceRevision:`sha256:${hash(original)}`,sourceRevision:`sha256:${hash(original)}`,...overrides});
const edit=(overrides={})=>({instanceIds:[model.objects[2].instanceId,model.objects[0].instanceId],offset:[1.25,2,-.5],...overrides});
const proposal=()=>createScene3DTranslationProposal(snapshot(),edit());
const conflict=error=>error?.errorCode==='scene3d_translation_conflict';

test('source-ordered translation proposal is deeply frozen and shows all target objects while other declarations remain untouched',async()=>{
  const source=snapshot(),input=edit(),p=createScene3DTranslationProposal(source,input),after=JSON.parse(p.afterContent.slice(1));
  assert.equal(p.kind,'scene3d-translation');assert.equal(p.sourcePath,source.sourcePath);assert.equal(p.sourceToken,source.token);
  assert.deepEqual(p.instanceIds,[model.objects[0].instanceId,model.objects[2].instanceId]);assert.deepEqual(p.beforeObjects,[model.objects[0],model.objects[2]]);
  assert.deepEqual(p.afterObjects,[after.objects[0],after.objects[2]]);assert.deepEqual(after.objects[1],model.objects[1]);assert.deepEqual(after.camera,model.camera);assert.deepEqual(after.light,model.light);
  assert.equal(p.beforeContent,original);assert.ok(p.afterContent.startsWith('\uFEFF')&&p.afterContent.includes('\r\n'));
  for(const value of [p,p.instanceIds,p.offset,p.beforeObjects,p.afterObjects,p.beforeObjects[0],p.afterObjects[0].position,p.changedPaths])assert.equal(Object.isFrozen(value),true);
  const ready=await prepareScene3DTranslationApply(source,p,{digest:hash});assert.deepEqual(ready,{afterContent:p.afterContent,sourcePath:source.sourcePath,changedPaths:p.changedPaths});assert.ok(Object.isFrozen(ready)&&Object.isFrozen(ready.changedPaths));
  assert.deepEqual(source,snapshot());assert.deepEqual(input,edit());
});
test('saved and independently dirty sources retain separate base/current revisions with the full exact candidate',async()=>{
  const dirty=original+' \r\n',source=snapshot({content:dirty,sourceRevision:`sha256:${hash(dirty)}`}),p=createScene3DTranslationProposal(source,edit());
  assert.equal(p.baseSourceRevision,snapshot().baseSourceRevision);assert.equal(p.sourceRevision,source.sourceRevision);assert.equal(p.beforeContent,dirty);assert.ok(p.afterContent.endsWith(' \r\n'));
  assert.equal((await prepareScene3DTranslationApply(source,p,{digest:hash})).afterContent,p.afterContent);
});
test('zero and completely rounded deltas cannot obtain a review brand',()=>{
  assert.throws(()=>createScene3DTranslationProposal(snapshot(),edit({offset:[0,-0,0]})),{errorCode:'scene3d_translation_unchanged'});
  const value=JSON.parse(original.slice(1));value.objects[0].position=[100000,100000,100000];const content=JSON.stringify(value);
  assert.throws(()=>createScene3DTranslationProposal(snapshot({content,sourceRevision:`sha256:${hash(content)}`}),edit({instanceIds:[value.objects[0].instanceId],offset:[5e-324,0,0]})),{errorCode:'scene3d_translation_unchanged'});
});
test('partly unchanged targets remain in complete before-after diagnostics while paths contain only net values',()=>{
  const value=JSON.parse(original.slice(1));value.objects[0].position=[100000,0,0];value.objects[2].position=[0,0,0];const content=JSON.stringify(value),source=snapshot({content,sourceRevision:`sha256:${hash(content)}`});
  const p=createScene3DTranslationProposal(source,edit({offset:[5e-324,0,0]}));assert.equal(p.beforeObjects.length,2);assert.equal(p.afterObjects.length,2);assert.deepEqual(p.beforeObjects[0],p.afterObjects[0]);assert.deepEqual(p.changedPaths,['/objects/2/position/0']);
});
test('one target overflow atomically refuses a proposal without changing the source or caller intent',()=>{
  const value=JSON.parse(original.slice(1));value.objects[2].position=[100000,0,0];const content=JSON.stringify(value),source=snapshot({content,sourceRevision:`sha256:${hash(content)}`}),input=edit({offset:[1,0,0]}),before=structuredClone({source,input});
  assert.throws(()=>createScene3DTranslationProposal(source,input),{errorCode:'scene3d_translation_invalid'});assert.deepEqual({source,input},before);
});
test('serialized forged cloned and getter-bearing receipts have no apply authority',async()=>{
  const p=proposal();assert.equal(isScene3DTranslationProposal(p),true);assert.equal(isScene3DTranslationProposal(structuredClone(p)),false);
  for(const fake of [structuredClone(p),{...p},null,Object.create(p)])await assert.rejects(prepareScene3DTranslationApply(snapshot(),fake,{digest:hash}),conflict);
  let reads=0;const evil=Object.defineProperty({},'afterContent',{get(){reads++;throw Error('getter');}});assert.equal(isScene3DTranslationProposal(evil),false);await assert.rejects(prepareScene3DTranslationApply(snapshot(),evil,{digest:hash}),conflict);assert.equal(reads,0);
});
test('all four old author proposal brands and new translation are mutually unrelated',async()=>{
  const source=snapshot(),id=model.objects[0].instanceId,p=proposal();
  const older=[createScene3DTransformProposal(source,{instanceId:id,values:{position:[2,3,4]}}),createScene3DObjectsProposal(source,{action:'remove',instanceId:id}),
    createScene3DEnvironmentProposal(source,{values:{background:'#123456'}}),createScene3DPropertiesProposal(source,{instanceId:id,values:{name:'Changed'}})];
  for(const value of older){assert.equal(isScene3DTranslationProposal(value),false);await assert.rejects(prepareScene3DTranslationApply(source,value,{digest:hash}),conflict);}
  for(const predicate of [isScene3DTransformProposal,isScene3DObjectsProposal,isScene3DEnvironmentProposal,isScene3DPropertiesProposal])assert.equal(predicate(p),false);
  await assert.rejects(prepareScene3DTransformApply(source,p,{digest:hash}),error=>error.errorCode==='scene3d_transform_conflict');
});
test('full path token bytes and both revision guards are independently required',async()=>{
  const p=proposal();
  for(const overrides of [{sourcePath:'documents/other.json'},{token:'new-session'},{content:original+' '},{baseSourceRevision:`sha256:${'0'.repeat(64)}`},{sourceRevision:`sha256:${'1'.repeat(64)}`}])await assert.rejects(prepareScene3DTranslationApply(snapshot(overrides),p,{digest:hash}),conflict);
});
test('digest verifies current raw bytes and must return lowercase bare SHA256',async()=>{
  const p=proposal();for(const wrong of ['',hash(original).toUpperCase(),'0'.repeat(64),null])await assert.rejects(prepareScene3DTranslationApply(snapshot(),p,{digest:async()=>wrong}),conflict);
  await assert.rejects(prepareScene3DTranslationApply(snapshot(),p),conflict);
});
test('source and intent arrays are captured before caller mutation or digest await',async()=>{
  const source=snapshot(),input=edit(),p=createScene3DTranslationProposal(source,input);input.offset[0]=999;input.instanceIds.reverse();input.instanceIds.push(model.objects[1].instanceId);
  assert.deepEqual(p.offset,[1.25,2,-.5]);assert.deepEqual(p.instanceIds,[model.objects[0].instanceId,model.objects[2].instanceId]);
  let release;const pending=prepareScene3DTranslationApply(source,p,{digest:async content=>{await new Promise(resolve=>{release=resolve;});return hash(content);}});
  source.content='caller late mutation';source.token='late token';source.sourcePath='documents/late.json';release();assert.equal((await pending).afterContent,p.afterContent);
});
test('exact source and intent reject extra hidden accessor serializer fields without invoking them',()=>{
  let reads=0;const source=snapshot();Object.defineProperty(source,'content',{enumerable:true,get(){reads++;return original;}});
  const nested=edit();Object.defineProperty(nested.offset,'0',{enumerable:true,get(){reads++;return 1;}});
  const hidden=edit();Object.defineProperty(hidden,'hidden',{value:true});
  for(const [s,e] of [[source,edit()],[snapshot(),nested],[snapshot(),hidden],[snapshot(),{...edit(),extra:true}],[snapshot(),{...edit(),toJSON(){reads++;return edit();}}]])assert.throws(()=>createScene3DTranslationProposal(s,e));
  for(const sourcePath of ['/scene.json','../scene.json','documents//scene.json','documents\\scene.json','documents/scene.md','documents/./scene.json'])assert.throws(()=>createScene3DTranslationProposal(snapshot({sourcePath}),edit()),{errorCode:'scene3d_translation_invalid'});
  assert.equal(reads,0);
});
test('invalid identity sets and offsets cannot borrow the old single-object transform shape',()=>{
  for(const input of [edit({instanceIds:[]}),edit({instanceIds:[model.objects[0].instanceId,model.objects[0].instanceId]}),edit({offset:[1,2]}),edit({offset:[Infinity,0,0]}),
    {instanceId:model.objects[0].instanceId,values:{position:[1,2,3]}},edit({offset:[200001,0,0]})])assert.throws(()=>createScene3DTranslationProposal(snapshot(),input));
});
