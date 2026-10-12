import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createScene3DCopyProposal, prepareScene3DCopyApply, isScene3DCopyProposal } from '../../engine/scene3d-copy.mjs';
import { createScene3DDistributionProposal, prepareScene3DDistributionApply, isScene3DDistributionProposal } from '../../engine/scene3d-distribution.mjs';
import { createScene3DAlignmentProposal, prepareScene3DAlignmentApply, isScene3DAlignmentProposal } from '../../engine/scene3d-alignment.mjs';
import { createScene3DTransformProposal, prepareScene3DTransformApply, isScene3DTransformProposal } from '../../engine/scene3d-transform.mjs';
import { createScene3DObjectsProposal, isScene3DObjectsProposal } from '../../engine/scene3d-objects.mjs';
import { createScene3DEnvironmentProposal, isScene3DEnvironmentProposal } from '../../engine/scene3d-environment.mjs';
import { createScene3DPropertiesProposal, isScene3DPropertiesProposal } from '../../engine/scene3d-properties.mjs';
import { createScene3DTranslationProposal, prepareScene3DTranslationApply, isScene3DTranslationProposal } from '../../engine/scene3d-translation.mjs';
const original='\uFEFF'+(await fs.readFile(new URL('../../examples/scene3d/scene.json',import.meta.url),'utf8')).replaceAll('\n','\r\n');
const model=JSON.parse(original.slice(1)),hash=value=>createHash('sha256').update(value).digest('hex');
const fresh=i=>`abcdef0${i}-1111-4111-8111-111111111111`;
const snapshot=(overrides={})=>({sourcePath:'documents/scenes/scene.json',token:'3:7:1:1',content:original,baseSourceRevision:`sha256:${hash(original)}`,sourceRevision:`sha256:${hash(original)}`,...overrides});
const edit=(overrides={})=>({copies:[{sourceInstanceId:model.objects[2].instanceId,newInstanceId:fresh(2)},{sourceInstanceId:model.objects[0].instanceId,newInstanceId:fresh(0)}],offset:[1,0,-2],...overrides});
const proposal=()=>createScene3DCopyProposal(snapshot(),edit());
const conflict=error=>error?.errorCode==='scene3d_copy_conflict';

test('independent copy brand deeply freezes complete source-order mapping and old-source/new-clone diagnostics',async()=>{
 const source=snapshot(),input=edit(),p=createScene3DCopyProposal(source,input),after=JSON.parse(p.afterContent.slice(1));assert.deepEqual(Object.keys(p).sort(),['kind','sourcePath','sourceToken','baseSourceRevision','sourceRevision','copies','offset','beforeContent','afterContent','changedPaths','beforeObjects','afterObjects'].sort());assert.equal(p.kind,'scene3d-copy');assert.equal(p.sourcePath,source.sourcePath);assert.equal(p.sourceToken,source.token);assert.deepEqual(p.copies,[input.copies[1],input.copies[0]]);assert.deepEqual(p.offset,input.offset);assert.deepEqual(p.beforeObjects,[model.objects[0],model.objects[2]]);assert.deepEqual(p.afterObjects,after.objects.slice(3));assert.deepEqual(after.objects.slice(0,3),model.objects);assert.deepEqual(after.camera,model.camera);assert.deepEqual(after.light,model.light);assert.equal(p.beforeContent,original);assert.ok(p.afterContent.startsWith('\uFEFF')&&p.afterContent.includes('\r\n'));assert.deepEqual(p.changedPaths,['/objects/3','/objects/4']);
 for(const value of [p,p.copies,p.copies[0],p.offset,p.beforeObjects,p.afterObjects,p.beforeObjects[0],p.afterObjects[0].position,p.changedPaths])assert.equal(Object.isFrozen(value),true);
 const ready=await prepareScene3DCopyApply(source,p,{digest:hash});assert.deepEqual(ready,{afterContent:p.afterContent,sourcePath:source.sourcePath,changedPaths:p.changedPaths});assert.ok(Object.isFrozen(ready)&&Object.isFrozen(ready.changedPaths));assert.deepEqual(source,snapshot());assert.deepEqual(input,edit());
});
test('saved and independently dirty sources bind both revisions to their complete raw copy candidate',async()=>{
 const dirty=original+' \r\n',source=snapshot({content:dirty,sourceRevision:`sha256:${hash(dirty)}`}),p=createScene3DCopyProposal(source,edit());assert.equal(p.baseSourceRevision,snapshot().baseSourceRevision);assert.equal(p.sourceRevision,source.sourceRevision);assert.equal(p.beforeContent,dirty);assert.ok(p.afterContent.endsWith(' \r\n'));assert.equal((await prepareScene3DCopyApply(source,p,{digest:hash})).afterContent,p.afterContent);
});
test('zero offset and wholly rounded offsets remain legal structural copy reviews',async()=>{
 const p=createScene3DCopyProposal(snapshot(),edit({offset:[0,0,0]}));assert.equal(isScene3DCopyProposal(p),true);assert.equal(p.changedPaths.length,2);for(let i=0;i<2;i++)assert.deepEqual(p.afterObjects[i],{...p.beforeObjects[i],instanceId:p.copies[i].newInstanceId});assert.ok((await prepareScene3DCopyApply(snapshot(),p,{digest:hash})).afterContent);
 const q=createScene3DCopyProposal(snapshot(),edit({offset:[5e-324,0,0],copies:[{sourceInstanceId:model.objects[2].instanceId,newInstanceId:fresh(2)}]}));assert.equal(q.afterObjects[0].position[0],q.beforeObjects[0].position[0]);assert.equal(q.changedPaths.length,1);
});
test('clone names remain exactly authored and before/after arrays refer to source/new identities rather than all objects',()=>{
 const value=JSON.parse(original.slice(1));value.objects[0].name=model.objects[0].instanceId;const content=JSON.stringify(value),source=snapshot({content,sourceRevision:`sha256:${hash(content)}`});const p=createScene3DCopyProposal(source,edit());assert.equal(p.beforeObjects.length,2);assert.equal(p.afterObjects.length,2);assert.equal(p.beforeObjects[0].name,p.afterObjects[0].name);assert.equal(p.afterObjects[0].name,model.objects[0].instanceId);assert.equal(p.afterObjects[0].instanceId,fresh(0));assert.notEqual(p.afterObjects[0].instanceId,p.afterObjects[0].name);assert.ok(p.beforeObjects.every(o=>!p.afterObjects.some(a=>a.instanceId===o.instanceId)));
});
test('unknown source collided identity and one overflowing final clone atomically refuse review without source or intent mutation',()=>{
 const source=snapshot(),input=edit({copies:[{sourceInstanceId:'ffffffff-ffff-ffff-ffff-ffffffffffff',newInstanceId:fresh(0)}]}),before=structuredClone({source,input});assert.throws(()=>createScene3DCopyProposal(source,input),{errorCode:'scene3d_copy_invalid'});assert.deepEqual({source,input},before);assert.throws(()=>createScene3DCopyProposal(source,edit({copies:[{sourceInstanceId:model.objects[0].instanceId,newInstanceId:model.objects[1].instanceId}]})),{errorCode:'scene3d_copy_invalid'});assert.throws(()=>createScene3DCopyProposal(source,edit({offset:[200000,0,0]})),{errorCode:'scene3d_copy_invalid'});
});
test('serialized forged cloned inherited and accessor-bearing proposals never gain copy apply authority',async()=>{
 const p=proposal();assert.equal(isScene3DCopyProposal(p),true);assert.equal(isScene3DCopyProposal(structuredClone(p)),false);for(const fake of [structuredClone(p),{...p},null,Object.create(p)])await assert.rejects(prepareScene3DCopyApply(snapshot(),fake,{digest:hash}),conflict);let reads=0;const evil=Object.defineProperty({},'afterContent',{get(){reads++;throw Error('getter');}});assert.equal(isScene3DCopyProposal(evil),false);await assert.rejects(prepareScene3DCopyApply(snapshot(),evil,{digest:hash}),conflict);assert.equal(reads,0);
});
test('all seven prior authoring brands are unrelated to the eighth copy review brand in both directions',async()=>{
 const source=snapshot(),id=model.objects[0].instanceId,p=proposal(),older=[createScene3DTransformProposal(source,{instanceId:id,values:{position:[2,3,4]}}),createScene3DObjectsProposal(source,{action:'remove',instanceId:id}),createScene3DEnvironmentProposal(source,{values:{background:'#123456'}}),createScene3DPropertiesProposal(source,{instanceId:id,values:{name:'Changed'}}),createScene3DTranslationProposal(source,{instanceIds:[id],offset:[1,0,0]}),createScene3DAlignmentProposal(source,{instanceIds:[id,model.objects[1].instanceId],anchorInstanceId:id,axis:'x'}),createScene3DDistributionProposal(source,{instanceIds:model.objects.map(o=>o.instanceId),axis:'x'})];for(const value of older){assert.equal(isScene3DCopyProposal(value),false);await assert.rejects(prepareScene3DCopyApply(source,value,{digest:hash}),conflict);}for(const predicate of [isScene3DTransformProposal,isScene3DObjectsProposal,isScene3DEnvironmentProposal,isScene3DPropertiesProposal,isScene3DTranslationProposal,isScene3DAlignmentProposal,isScene3DDistributionProposal])assert.equal(predicate(p),false);
 for(const[prepare,code]of [[prepareScene3DTransformApply,'scene3d_transform_conflict'],[prepareScene3DTranslationApply,'scene3d_translation_conflict'],[prepareScene3DAlignmentApply,'scene3d_alignment_conflict'],[prepareScene3DDistributionApply,'scene3d_distribution_conflict']])await assert.rejects(prepare(source,p,{digest:hash}),error=>error.errorCode===code);
});
test('current path token exact bytes baseline and source revision each independently protect apply',async()=>{
 const p=proposal();for(const overrides of [{sourcePath:'documents/other.json'},{token:'new-session'},{content:original+' '},{baseSourceRevision:`sha256:${'0'.repeat(64)}`},{sourceRevision:`sha256:${'1'.repeat(64)}`}])await assert.rejects(prepareScene3DCopyApply(snapshot(overrides),p,{digest:hash}),conflict);
});
test('asynchronous digest accepts only correct lowercase bare SHA256 of captured current source',async()=>{
 const p=proposal();for(const wrong of ['',hash(original).toUpperCase(),'0'.repeat(64),null])await assert.rejects(prepareScene3DCopyApply(snapshot(),p,{digest:async()=>wrong}),conflict);await assert.rejects(prepareScene3DCopyApply(snapshot(),p),conflict);
});
test('both mapping identities offset and source fields detach before late mutation and asynchronous digest',async()=>{
 const source=snapshot(),input=edit(),p=createScene3DCopyProposal(source,input);input.offset[0]=200000;input.copies[0].newInstanceId=fresh(4);input.copies[0].sourceInstanceId=model.objects[1].instanceId;input.copies.reverse();assert.deepEqual(p.offset,[1,0,-2]);assert.deepEqual(p.copies,[edit().copies[1],edit().copies[0]]);let release;const pending=prepareScene3DCopyApply(source,p,{digest:async content=>{await new Promise(resolve=>{release=resolve;});return hash(content);}});source.content='late mutation';source.token='late token';source.sourcePath='documents/late.json';release();assert.equal((await pending).afterContent,p.afterContent);
});
test('source and nested mapping fields reject hidden accessors serializers and extras without reading caller code',()=>{
 let reads=0;const source=snapshot();Object.defineProperty(source,'content',{enumerable:true,get(){reads++;return original;}});const nested=edit();Object.defineProperty(nested.copies[0],'newInstanceId',{enumerable:true,get(){reads++;return fresh(2);}});const hidden=edit();Object.defineProperty(hidden.copies[0],'hidden',{value:true});const serializer=edit();serializer.copies[0].toJSON=()=>{reads++;return {};};for(const[s,e]of [[source,edit()],[snapshot(),nested],[snapshot(),hidden],[snapshot(),serializer],[snapshot(),{...edit(),extra:true}]])assert.throws(()=>createScene3DCopyProposal(s,e));for(const sourcePath of ['/scene.json','../scene.json','documents//scene.json','documents\\scene.json','documents/scene.md','documents/./scene.json'])assert.throws(()=>createScene3DCopyProposal(snapshot({sourcePath}),edit()),{errorCode:'scene3d_copy_invalid'});assert.equal(reads,0);
});
test('copy uses explicit fresh mapping and shared offset and refuses all seven older intent shapes',()=>{
 for(const input of [edit({copies:[]}),edit({copies:[{}]}),edit({copies:[{sourceInstanceId:model.objects[0].instanceId,newInstanceId:fresh(0)},{sourceInstanceId:model.objects[0].instanceId,newInstanceId:fresh(2)}]}),edit({offset:null}),edit({offset:[0,0]}),{action:'copy',instanceId:model.objects[0].instanceId,newInstanceId:fresh(0),name:'Explicit old name'},{instanceIds:model.objects.map(o=>o.instanceId),offset:[1,0,0]},{instanceIds:model.objects.map(o=>o.instanceId),axis:'x'}])assert.throws(()=>createScene3DCopyProposal(snapshot(),input));
});
