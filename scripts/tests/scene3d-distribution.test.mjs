import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createScene3DDistributionProposal, prepareScene3DDistributionApply, isScene3DDistributionProposal } from '../../engine/scene3d-distribution.mjs';
import { createScene3DAlignmentProposal, prepareScene3DAlignmentApply, isScene3DAlignmentProposal } from '../../engine/scene3d-alignment.mjs';
import { createScene3DTransformProposal, prepareScene3DTransformApply, isScene3DTransformProposal } from '../../engine/scene3d-transform.mjs';
import { createScene3DObjectsProposal, isScene3DObjectsProposal } from '../../engine/scene3d-objects.mjs';
import { createScene3DEnvironmentProposal, isScene3DEnvironmentProposal } from '../../engine/scene3d-environment.mjs';
import { createScene3DPropertiesProposal, isScene3DPropertiesProposal } from '../../engine/scene3d-properties.mjs';
import { createScene3DTranslationProposal, prepareScene3DTranslationApply, isScene3DTranslationProposal } from '../../engine/scene3d-translation.mjs';

const original='\uFEFF'+(await fs.readFile(new URL('../../examples/scene3d/scene.json',import.meta.url),'utf8')).replaceAll('\n','\r\n');
const model=JSON.parse(original.slice(1)), hash=value=>createHash('sha256').update(value).digest('hex');
const snapshot=(overrides={})=>({sourcePath:'documents/scenes/scene.json',token:'3:7:1:1',content:original,baseSourceRevision:`sha256:${hash(original)}`,sourceRevision:`sha256:${hash(original)}`,...overrides});
const edit=(overrides={})=>({instanceIds:[model.objects[2].instanceId,model.objects[0].instanceId,model.objects[1].instanceId],axis:'x',...overrides});
const proposal=()=>createScene3DDistributionProposal(snapshot(),edit());
const conflict=error=>error?.errorCode==='scene3d_distribution_conflict';
const withPositions=positions=>{const value=structuredClone(model);for(let i=0;i<positions.length;i++)value.objects[i].position[0]=positions[i];const content=JSON.stringify(value);return snapshot({content,sourceRevision:`sha256:${hash(content)}`});};

test('distribution has an independent deeply frozen review brand and complete source-ordered object diagnostics',async()=>{
  const source=snapshot(),input=edit(),p=createScene3DDistributionProposal(source,input),after=JSON.parse(p.afterContent.slice(1));
  assert.deepEqual(Object.keys(p).sort(),['kind','sourcePath','sourceToken','baseSourceRevision','sourceRevision','instanceIds','orderedInstanceIds','axis','beforeContent','afterContent','changedPaths','beforeObjects','afterObjects'].sort());
  assert.equal(p.kind,'scene3d-distribution');assert.equal(p.sourcePath,source.sourcePath);assert.equal(p.sourceToken,source.token);assert.equal(p.axis,'x');
  assert.deepEqual(p.instanceIds,model.objects.map(o=>o.instanceId));
  const sorted=[...model.objects].sort((a,b)=>a.position[0]-b.position[0]);assert.deepEqual(p.orderedInstanceIds,sorted.map(o=>o.instanceId));
  assert.deepEqual(p.beforeObjects,model.objects);assert.deepEqual(p.afterObjects,after.objects);assert.deepEqual(after.camera,model.camera);assert.deepEqual(after.light,model.light);
  for(const endpoint of [sorted[0],sorted.at(-1)])assert.deepEqual(after.objects.find(o=>o.instanceId===endpoint.instanceId),endpoint);
  assert.equal(p.beforeContent,original);assert.ok(p.afterContent.startsWith('\uFEFF')&&p.afterContent.includes('\r\n'));
  for(const value of [p,p.instanceIds,p.orderedInstanceIds,p.beforeObjects,p.afterObjects,p.beforeObjects[0],p.afterObjects[0].position,p.changedPaths])assert.equal(Object.isFrozen(value),true);
  const ready=await prepareScene3DDistributionApply(source,p,{digest:hash});assert.deepEqual(ready,{afterContent:p.afterContent,sourcePath:source.sourcePath,changedPaths:p.changedPaths});assert.ok(Object.isFrozen(ready)&&Object.isFrozen(ready.changedPaths));
  assert.deepEqual(source,snapshot());assert.deepEqual(input,edit());
});
test('saved and dirty source snapshots bind separate baseline and current revisions to the complete raw candidate',async()=>{
  const dirty=original+' \r\n',source=snapshot({content:dirty,sourceRevision:`sha256:${hash(dirty)}`}),p=createScene3DDistributionProposal(source,edit());
  assert.equal(p.baseSourceRevision,snapshot().baseSourceRevision);assert.equal(p.sourceRevision,source.sourceRevision);assert.equal(p.beforeContent,dirty);assert.ok(p.afterContent.endsWith(' \r\n'));
  assert.equal((await prepareScene3DDistributionApply(source,p,{digest:hash})).afterContent,p.afterContent);
});
test('zero spans and already equal gaps cannot obtain a review brand',()=>{
  for(const source of [withPositions([0,-0,0]),withPositions([-10,0,10])])assert.throws(()=>createScene3DDistributionProposal(source,edit()),{errorCode:'scene3d_distribution_unchanged'});
});
test('both extrema remain unchanged and only the original-order interior path is reviewed',()=>{
  const source=withPositions([100000,123,-100000]),p=createScene3DDistributionProposal(source,edit());
  assert.equal(p.beforeObjects.length,3);assert.equal(p.afterObjects.length,3);assert.deepEqual(p.beforeObjects[0],p.afterObjects[0]);assert.deepEqual(p.beforeObjects[2],p.afterObjects[2]);assert.equal(p.afterObjects[1].position[0],0);assert.deepEqual(p.changedPaths,['/objects/1/position/0']);
});
test('unknown targets and collapsed positive spans atomically refuse approval without caller mutation',()=>{
  const source=snapshot(),input=edit({instanceIds:[model.objects[0].instanceId,model.objects[1].instanceId,'ffffffff-ffff-ffff-ffff-ffffffffffff']}),before=structuredClone({source,input});
  assert.throws(()=>createScene3DDistributionProposal(source,input),{errorCode:'scene3d_distribution_invalid'});assert.deepEqual({source,input},before);
  assert.throws(()=>createScene3DDistributionProposal(withPositions([1,1,1+Number.EPSILON]),edit()),{errorCode:'scene3d_distribution_invalid'});
});
test('clones inherited objects getters and forged candidates cannot acquire distribution apply authority',async()=>{
  const p=proposal();assert.equal(isScene3DDistributionProposal(p),true);assert.equal(isScene3DDistributionProposal(structuredClone(p)),false);
  for(const fake of [structuredClone(p),{...p},null,Object.create(p)])await assert.rejects(prepareScene3DDistributionApply(snapshot(),fake,{digest:hash}),conflict);
  let reads=0;const evil=Object.defineProperty({},'afterContent',{get(){reads++;throw Error('getter');}});assert.equal(isScene3DDistributionProposal(evil),false);await assert.rejects(prepareScene3DDistributionApply(snapshot(),evil,{digest:hash}),conflict);assert.equal(reads,0);
});
test('all six previous authoring brands are mutually unrelated to the seventh distribution brand',async()=>{
  const source=snapshot(),id=model.objects[0].instanceId,p=proposal(),older=[createScene3DTransformProposal(source,{instanceId:id,values:{position:[2,3,4]}}),createScene3DObjectsProposal(source,{action:'remove',instanceId:id}),createScene3DEnvironmentProposal(source,{values:{background:'#123456'}}),createScene3DPropertiesProposal(source,{instanceId:id,values:{name:'Changed'}}),createScene3DTranslationProposal(source,{instanceIds:[id],offset:[1,0,0]}),createScene3DAlignmentProposal(source,{instanceIds:[id,model.objects[1].instanceId],anchorInstanceId:id,axis:'x'})];
  for(const value of older){assert.equal(isScene3DDistributionProposal(value),false);await assert.rejects(prepareScene3DDistributionApply(source,value,{digest:hash}),conflict);}
  for(const predicate of [isScene3DTransformProposal,isScene3DObjectsProposal,isScene3DEnvironmentProposal,isScene3DPropertiesProposal,isScene3DTranslationProposal,isScene3DAlignmentProposal])assert.equal(predicate(p),false);
  await assert.rejects(prepareScene3DTransformApply(source,p,{digest:hash}),error=>error.errorCode==='scene3d_transform_conflict');await assert.rejects(prepareScene3DTranslationApply(source,p,{digest:hash}),error=>error.errorCode==='scene3d_translation_conflict');await assert.rejects(prepareScene3DAlignmentApply(source,p,{digest:hash}),error=>error.errorCode==='scene3d_alignment_conflict');
});
test('path session bytes and both revisions each independently protect a current-source apply',async()=>{
  const p=proposal();for(const overrides of [{sourcePath:'documents/other.json'},{token:'new-session'},{content:original+' '},{baseSourceRevision:`sha256:${'0'.repeat(64)}`},{sourceRevision:`sha256:${'1'.repeat(64)}`}])await assert.rejects(prepareScene3DDistributionApply(snapshot(overrides),p,{digest:hash}),conflict);
});
test('digest accepts only the exact captured-byte lowercase bare SHA256',async()=>{
  const p=proposal();for(const wrong of ['',hash(original).toUpperCase(),'0'.repeat(64),null])await assert.rejects(prepareScene3DDistributionApply(snapshot(),p,{digest:async()=>wrong}),conflict);await assert.rejects(prepareScene3DDistributionApply(snapshot(),p),conflict);
});
test('source and selection intent are detached before late caller edits and asynchronous digest',async()=>{
  const source=snapshot(),input=edit(),p=createScene3DDistributionProposal(source,input);input.axis='z';input.instanceIds.reverse();input.instanceIds.pop();
  assert.equal(p.axis,'x');assert.deepEqual(p.instanceIds,model.objects.map(o=>o.instanceId));assert.equal(p.orderedInstanceIds.length,3);
  let release;const pending=prepareScene3DDistributionApply(source,p,{digest:async content=>{await new Promise(resolve=>{release=resolve;});return hash(content);}});source.content='late caller mutation';source.token='late token';source.sourcePath='documents/late.json';release();assert.equal((await pending).afterContent,p.afterContent);
});
test('source and intent strict fields reject hidden accessors and serializers without running caller code',()=>{
  let reads=0;const source=snapshot();Object.defineProperty(source,'content',{enumerable:true,get(){reads++;return original;}});const nested=edit();Object.defineProperty(nested.instanceIds,'0',{enumerable:true,get(){reads++;return model.objects[0].instanceId;}});const hidden=edit();Object.defineProperty(hidden,'hidden',{value:true});
  for(const [s,e] of [[source,edit()],[snapshot(),nested],[snapshot(),hidden],[snapshot(),{...edit(),extra:true}],[snapshot(),{...edit(),toJSON(){reads++;return edit();}}]])assert.throws(()=>createScene3DDistributionProposal(s,e));
  for(const sourcePath of ['/scene.json','../scene.json','documents//scene.json','documents\\scene.json','documents/scene.md','documents/./scene.json'])assert.throws(()=>createScene3DDistributionProposal(snapshot({sourcePath}),edit()),{errorCode:'scene3d_distribution_invalid'});assert.equal(reads,0);
});
test('at least three distinct objects and a closed world axis reject older authoring shapes',()=>{
  for(const input of [edit({instanceIds:[]}),edit({instanceIds:[model.objects[0].instanceId,model.objects[1].instanceId]}),edit({instanceIds:[model.objects[0].instanceId,model.objects[0].instanceId,model.objects[1].instanceId]}),edit({axis:'X'}),edit({axis:'center'}),{instanceIds:edit().instanceIds,offset:[1,0,0]},{instanceIds:edit().instanceIds,anchorInstanceId:model.objects[0].instanceId,axis:'x'},{instanceId:model.objects[0].instanceId,values:{position:[1,2,3]}}])assert.throws(()=>createScene3DDistributionProposal(snapshot(),input));
});
