import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createScene3DAlignmentProposal, prepareScene3DAlignmentApply, isScene3DAlignmentProposal } from '../../engine/scene3d-alignment.mjs';
import { createScene3DTransformProposal, prepareScene3DTransformApply, isScene3DTransformProposal } from '../../engine/scene3d-transform.mjs';
import { createScene3DObjectsProposal, isScene3DObjectsProposal } from '../../engine/scene3d-objects.mjs';
import { createScene3DEnvironmentProposal, isScene3DEnvironmentProposal } from '../../engine/scene3d-environment.mjs';
import { createScene3DPropertiesProposal, isScene3DPropertiesProposal } from '../../engine/scene3d-properties.mjs';
import { createScene3DTranslationProposal, prepareScene3DTranslationApply, isScene3DTranslationProposal } from '../../engine/scene3d-translation.mjs';

const original='\uFEFF'+(await fs.readFile(new URL('../../examples/scene3d/scene.json',import.meta.url),'utf8')).replaceAll('\n','\r\n');
const model=JSON.parse(original.slice(1)),hash=value=>createHash('sha256').update(value).digest('hex');
const snapshot=(overrides={})=>({sourcePath:'documents/scenes/scene.json',token:'3:7:1:1',content:original,baseSourceRevision:`sha256:${hash(original)}`,sourceRevision:`sha256:${hash(original)}`,...overrides});
const edit=(overrides={})=>({instanceIds:[model.objects[2].instanceId,model.objects[0].instanceId],anchorInstanceId:model.objects[0].instanceId,axis:'x',...overrides});
const proposal=()=>createScene3DAlignmentProposal(snapshot(),edit());
const conflict=error=>error?.errorCode==='scene3d_alignment_conflict';

test('the independently branded alignment proposal is deeply frozen with complete source-ordered target diagnostics',async()=>{
  const source=snapshot(),input=edit(),p=createScene3DAlignmentProposal(source,input),after=JSON.parse(p.afterContent.slice(1));
  assert.equal(p.kind,'scene3d-alignment');assert.equal(p.sourcePath,source.sourcePath);assert.equal(p.sourceToken,source.token);assert.equal(p.anchorInstanceId,input.anchorInstanceId);assert.equal(p.axis,'x');
  assert.deepEqual(p.instanceIds,[model.objects[0].instanceId,model.objects[2].instanceId]);assert.deepEqual(p.beforeObjects,[model.objects[0],model.objects[2]]);assert.deepEqual(p.afterObjects,[after.objects[0],after.objects[2]]);
  assert.deepEqual(after.objects[1],model.objects[1]);assert.deepEqual(after.camera,model.camera);assert.deepEqual(after.light,model.light);assert.deepEqual(p.beforeObjects[0],p.afterObjects[0]);
  assert.equal(p.beforeContent,original);assert.ok(p.afterContent.startsWith('\uFEFF')&&p.afterContent.includes('\r\n'));
  for(const value of [p,p.instanceIds,p.beforeObjects,p.afterObjects,p.beforeObjects[0],p.afterObjects[0].position,p.changedPaths])assert.equal(Object.isFrozen(value),true);
  const ready=await prepareScene3DAlignmentApply(source,p,{digest:hash});assert.deepEqual(ready,{afterContent:p.afterContent,sourcePath:source.sourcePath,changedPaths:p.changedPaths});assert.ok(Object.isFrozen(ready)&&Object.isFrozen(ready.changedPaths));
  assert.deepEqual(source,snapshot());assert.deepEqual(input,edit());
});
test('saved and independently dirty sources bind separate base and current revisions to the full candidate',async()=>{
  const dirty=original+' \r\n',source=snapshot({content:dirty,sourceRevision:`sha256:${hash(dirty)}`}),p=createScene3DAlignmentProposal(source,edit());
  assert.equal(p.baseSourceRevision,snapshot().baseSourceRevision);assert.equal(p.sourceRevision,source.sourceRevision);assert.equal(p.beforeContent,dirty);assert.ok(p.afterContent.endsWith(' \r\n'));
  assert.equal((await prepareScene3DAlignmentApply(source,p,{digest:hash})).afterContent,p.afterContent);
});
test('equal selected values cannot obtain a review brand and their native numeric lexemes remain untouched',()=>{
  const value=JSON.parse(original.slice(1));value.objects[2].position[0]=value.objects[0].position[0];const content=JSON.stringify(value);
  assert.throws(()=>createScene3DAlignmentProposal(snapshot({content,sourceRevision:`sha256:${hash(content)}`}),edit()),{errorCode:'scene3d_alignment_unchanged'});
});
test('all selected targets including the reference stay visible while only changed axis paths are reviewed',()=>{
  const value=JSON.parse(original.slice(1));value.objects[0].position=[100000,0,0];value.objects[2].position=[0,0,0];const content=JSON.stringify(value),source=snapshot({content,sourceRevision:`sha256:${hash(content)}`});
  const p=createScene3DAlignmentProposal(source,edit());assert.equal(p.beforeObjects.length,2);assert.equal(p.afterObjects.length,2);assert.deepEqual(p.beforeObjects[0],p.afterObjects[0]);assert.deepEqual(p.changedPaths,['/objects/2/position/0']);assert.equal(p.afterObjects[1].position[0],100000);
});
test('unknown target or nonselected reference atomically refuses approval without modifying source or caller intent',()=>{
  const source=snapshot(),input=edit({anchorInstanceId:model.objects[1].instanceId}),before=structuredClone({source,input});
  assert.throws(()=>createScene3DAlignmentProposal(source,input));assert.deepEqual({source,input},before);
  assert.throws(()=>createScene3DAlignmentProposal(source,edit({instanceIds:[model.objects[0].instanceId,'ffffffff-ffff-ffff-ffff-ffffffffffff']})),{errorCode:'scene3d_alignment_invalid'});
});
test('serialized forged cloned inherited and getter-bearing candidates possess no alignment apply authority',async()=>{
  const p=proposal();assert.equal(isScene3DAlignmentProposal(p),true);assert.equal(isScene3DAlignmentProposal(structuredClone(p)),false);
  for(const fake of [structuredClone(p),{...p},null,Object.create(p)])await assert.rejects(prepareScene3DAlignmentApply(snapshot(),fake,{digest:hash}),conflict);
  let reads=0;const evil=Object.defineProperty({},'afterContent',{get(){reads++;throw Error('getter');}});assert.equal(isScene3DAlignmentProposal(evil),false);await assert.rejects(prepareScene3DAlignmentApply(snapshot(),evil,{digest:hash}),conflict);assert.equal(reads,0);
});
test('all five previous authoring brands are mutually unrelated to world-axis alignment',async()=>{
  const source=snapshot(),id=model.objects[0].instanceId,p=proposal(),older=[createScene3DTransformProposal(source,{instanceId:id,values:{position:[2,3,4]}}),createScene3DObjectsProposal(source,{action:'remove',instanceId:id}),createScene3DEnvironmentProposal(source,{values:{background:'#123456'}}),createScene3DPropertiesProposal(source,{instanceId:id,values:{name:'Changed'}}),createScene3DTranslationProposal(source,{instanceIds:[id],offset:[1,0,0]})];
  for(const value of older){assert.equal(isScene3DAlignmentProposal(value),false);await assert.rejects(prepareScene3DAlignmentApply(source,value,{digest:hash}),conflict);}
  for(const predicate of [isScene3DTransformProposal,isScene3DObjectsProposal,isScene3DEnvironmentProposal,isScene3DPropertiesProposal,isScene3DTranslationProposal])assert.equal(predicate(p),false);
  await assert.rejects(prepareScene3DTransformApply(source,p,{digest:hash}),error=>error.errorCode==='scene3d_transform_conflict');await assert.rejects(prepareScene3DTranslationApply(source,p,{digest:hash}),error=>error.errorCode==='scene3d_translation_conflict');
});
test('current path session bytes and both revision guards are independently necessary',async()=>{
  const p=proposal();for(const overrides of [{sourcePath:'documents/other.json'},{token:'new-session'},{content:original+' '},{baseSourceRevision:`sha256:${'0'.repeat(64)}`},{sourceRevision:`sha256:${'1'.repeat(64)}`}])await assert.rejects(prepareScene3DAlignmentApply(snapshot(overrides),p,{digest:hash}),conflict);
});
test('digest checks captured current bytes and accepts only correct lowercase bare SHA256',async()=>{
  const p=proposal();for(const wrong of ['',hash(original).toUpperCase(),'0'.repeat(64),null])await assert.rejects(prepareScene3DAlignmentApply(snapshot(),p,{digest:async()=>wrong}),conflict);await assert.rejects(prepareScene3DAlignmentApply(snapshot(),p),conflict);
});
test('source and identity intent are detached before caller changes and the asynchronous digest',async()=>{
  const source=snapshot(),input=edit(),p=createScene3DAlignmentProposal(source,input);input.axis='z';input.anchorInstanceId=model.objects[2].instanceId;input.instanceIds.reverse();input.instanceIds.push(model.objects[1].instanceId);
  assert.equal(p.axis,'x');assert.equal(p.anchorInstanceId,model.objects[0].instanceId);assert.deepEqual(p.instanceIds,[model.objects[0].instanceId,model.objects[2].instanceId]);
  let release;const pending=prepareScene3DAlignmentApply(source,p,{digest:async content=>{await new Promise(resolve=>{release=resolve;});return hash(content);}});source.content='caller late mutation';source.token='late token';source.sourcePath='documents/late.json';release();assert.equal((await pending).afterContent,p.afterContent);
});
test('source and intent exact fields refuse hidden accessors and serializers without executing caller code',()=>{
  let reads=0;const source=snapshot();Object.defineProperty(source,'content',{enumerable:true,get(){reads++;return original;}});const nested=edit();Object.defineProperty(nested.instanceIds,'0',{enumerable:true,get(){reads++;return model.objects[0].instanceId;}});const hidden=edit();Object.defineProperty(hidden,'hidden',{value:true});
  for(const [s,e] of [[source,edit()],[snapshot(),nested],[snapshot(),hidden],[snapshot(),{...edit(),extra:true}],[snapshot(),{...edit(),toJSON(){reads++;return edit();}}]])assert.throws(()=>createScene3DAlignmentProposal(s,e));
  for(const sourcePath of ['/scene.json','../scene.json','documents//scene.json','documents\\scene.json','documents/scene.md','documents/./scene.json'])assert.throws(()=>createScene3DAlignmentProposal(snapshot({sourcePath}),edit()),{errorCode:'scene3d_alignment_invalid'});assert.equal(reads,0);
});
test('a selected explicit reference and closed world axis are mandatory and do not accept older edit shapes',()=>{
  for(const input of [edit({instanceIds:[]}),edit({instanceIds:[model.objects[0].instanceId]}),edit({instanceIds:[model.objects[0].instanceId,model.objects[0].instanceId]}),edit({axis:'X'}),edit({axis:'center'}),edit({anchorInstanceId:null}),{instanceIds:edit().instanceIds,offset:[1,0,0]},{instanceId:model.objects[0].instanceId,values:{position:[1,2,3]}}])assert.throws(()=>createScene3DAlignmentProposal(snapshot(),input));
});
