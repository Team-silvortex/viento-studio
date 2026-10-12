import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createScene3DRemovalProposal, prepareScene3DRemovalApply, isScene3DRemovalProposal } from '../../engine/scene3d-removal.mjs';
import * as transform from '../../engine/scene3d-transform.mjs';
import * as objects from '../../engine/scene3d-objects.mjs';
import * as environment from '../../engine/scene3d-environment.mjs';
import * as properties from '../../engine/scene3d-properties.mjs';
import * as translation from '../../engine/scene3d-translation.mjs';
import * as alignment from '../../engine/scene3d-alignment.mjs';
import * as distribution from '../../engine/scene3d-distribution.mjs';
import * as copy from '../../engine/scene3d-copy.mjs';
const original='\uFEFF'+(await fs.readFile(new URL('../../examples/scene3d/scene.json',import.meta.url),'utf8')).replaceAll('\n','\r\n');
const model=JSON.parse(original.slice(1)), hash=value=>createHash('sha256').update(value).digest('hex');
const snapshot=(overrides={})=>({sourcePath:'documents/scenes/scene.json',token:'3:7:1:1',content:original,baseSourceRevision:`sha256:${hash(original)}`,sourceRevision:`sha256:${hash(original)}`,...overrides});
const edit=(overrides={})=>({instanceIds:[model.objects[2].instanceId,model.objects[0].instanceId],...overrides});
const proposal=()=>createScene3DRemovalProposal(snapshot(),edit());
const conflict=error=>error?.errorCode==='scene3d_removal_conflict';

test('ninth private removal brand freezes exact eleven fields and source-order selected and survivor diagnostics',async()=>{
 const source=snapshot(),input=edit(),p=createScene3DRemovalProposal(source,input);
 assert.deepEqual(Object.keys(p).sort(),['kind','sourcePath','sourceToken','baseSourceRevision','sourceRevision','instanceIds','beforeContent','afterContent','changedPaths','removedObjects','remainingObjects'].sort());
 assert.equal(p.kind,'scene3d-removal');assert.equal(p.sourcePath,source.sourcePath);assert.equal(p.sourceToken,source.token);assert.deepEqual(p.instanceIds,[model.objects[0].instanceId,model.objects[2].instanceId]);assert.deepEqual(p.changedPaths,['/objects/0','/objects/2']);assert.deepEqual(p.removedObjects,[model.objects[0],model.objects[2]]);assert.deepEqual(p.remainingObjects,[model.objects[1]]);
 const after=JSON.parse(p.afterContent.slice(1));assert.deepEqual(after.objects,p.remainingObjects);for(const key of ['camera','light','name','viewport','background'])assert.deepEqual(after[key],model[key]);assert.equal(p.beforeContent,original);assert.ok(p.afterContent.startsWith('\uFEFF')&&p.afterContent.includes('\r\n'));assert.equal(Object.hasOwn(p,'unchanged'),false);
 for(const value of [p,p.instanceIds,p.removedObjects,p.removedObjects[0],p.removedObjects[0].position,p.remainingObjects,p.remainingObjects[0],p.remainingObjects[0].size,p.changedPaths])assert.equal(Object.isFrozen(value),true);
 const ready=await prepareScene3DRemovalApply(source,p,{digest:hash});assert.deepEqual(ready,{afterContent:p.afterContent,sourcePath:source.sourcePath,changedPaths:p.changedPaths});assert.ok(Object.isFrozen(ready)&&Object.isFrozen(ready.changedPaths));assert.deepEqual(source,snapshot());assert.deepEqual(input,edit());
});
test('independently dirty source preserves baseline and binds its complete candidate revision',async()=>{
 const content=original+' \r\n',source=snapshot({content,sourceRevision:`sha256:${hash(content)}`}),p=createScene3DRemovalProposal(source,edit());assert.equal(p.baseSourceRevision,snapshot().baseSourceRevision);assert.equal(p.sourceRevision,source.sourceRevision);assert.equal(p.beforeContent,content);assert.ok(p.afterContent.endsWith(' \r\n'));assert.equal((await prepareScene3DRemovalApply(source,p,{digest:hash})).afterContent,p.afterContent);
});
test('all-selected empty duplicate unknown and malformed removal intents refuse review atomically',()=>{
 const source=snapshot();for(const input of [edit({instanceIds:model.objects.map(o=>o.instanceId)}),edit({instanceIds:[]}),edit({instanceIds:[model.objects[0].instanceId,model.objects[0].instanceId]}),edit({instanceIds:['ffffffff-ffff-ffff-ffff-ffffffffffff']}),edit({instanceIds:[null]}),edit({instanceIds:null}),{action:'remove',instanceId:model.objects[0].instanceId},{instanceIds:edit().instanceIds,offset:[0,0,0]}]){const before=structuredClone({source,input});assert.throws(()=>createScene3DRemovalProposal(source,input));assert.deepEqual({source,input},before);}for(const instanceIds of [[],model.objects.map(o=>o.instanceId),[model.objects[0].instanceId,model.objects[0].instanceId],['ffffffff-ffff-ffff-ffff-ffffffffffff']])assert.throws(()=>createScene3DRemovalProposal(source,{instanceIds}),{errorCode:'scene3d_removal_invalid'});
});
test('serialization clone forgery inherited and accessor-bearing objects never confer removal apply authority',async()=>{
 const p=proposal();assert.equal(isScene3DRemovalProposal(p),true);for(const value of [JSON.parse(JSON.stringify(p)),structuredClone(p),{...p},null,Object.create(p)]){assert.equal(isScene3DRemovalProposal(value),false);await assert.rejects(prepareScene3DRemovalApply(snapshot(),value,{digest:hash}),conflict);}let reads=0;const evil=Object.defineProperty({},'afterContent',{get(){reads++;throw Error('getter');}});assert.equal(isScene3DRemovalProposal(evil),false);await assert.rejects(prepareScene3DRemovalApply(snapshot(),evil,{digest:hash}),conflict);assert.equal(reads,0);
});
test('all eight existing brands reject removal and removal rejects every old brand in sixteen directions',async()=>{
 const source=snapshot(),id=model.objects[0].instanceId,p=proposal();
 const domains=[
 [transform,'Transform',{instanceId:id,values:{position:[2,3,4]}},'transform'],
 [objects,'Objects',{action:'remove',instanceId:id},'objects'],
 [environment,'Environment',{values:{background:'#123456'}},'environment'],
 [properties,'Properties',{instanceId:id,values:{name:'Changed'}},'properties'],
 [translation,'Translation',{instanceIds:[id],offset:[1,0,0]},'translation'],
 [alignment,'Alignment',{instanceIds:[id,model.objects[1].instanceId],anchorInstanceId:id,axis:'x'},'alignment'],
 [distribution,'Distribution',{instanceIds:model.objects.map(o=>o.instanceId),axis:'x'},'distribution'],
 [copy,'Copy',{copies:[{sourceInstanceId:id,newInstanceId:'abcdef00-1111-4111-8111-111111111111'}],offset:[0,0,0]},'copy']];
 let directions=0;for(const[module,name,intent,code]of domains){const older=module[`createScene3D${name}Proposal`](source,intent);assert.equal(isScene3DRemovalProposal(older),false);await assert.rejects(prepareScene3DRemovalApply(source,older,{digest:hash}),conflict);directions++;assert.equal(module[`isScene3D${name}Proposal`](p),false);await assert.rejects(module[`prepareScene3D${name}Apply`](source,p,{digest:hash}),error=>error.errorCode===`scene3d_${code}_conflict`);directions++;}assert.equal(directions,16);
});
test('path token baseline source revision and exact current bytes independently guard removal apply',async()=>{
 const p=proposal();for(const change of [{sourcePath:'documents/other.json'},{token:'new-session'},{content:original+' '},{baseSourceRevision:`sha256:${'0'.repeat(64)}`},{sourceRevision:`sha256:${'1'.repeat(64)}`}])await assert.rejects(prepareScene3DRemovalApply(snapshot(change),p,{digest:hash}),conflict);
});
test('digest admits only the correct lowercase bare sha256 of captured source',async()=>{
 const p=proposal();for(const wrong of ['',hash(original).toUpperCase(),'0'.repeat(64),`sha256:${hash(original)}`,null])await assert.rejects(prepareScene3DRemovalApply(snapshot(),p,{digest:async()=>wrong}),conflict);await assert.rejects(prepareScene3DRemovalApply(snapshot(),p),conflict);
});
test('IDs detach at proposal creation and five source fields capture before asynchronous digest',async()=>{
 const source=snapshot(),input=edit(),p=createScene3DRemovalProposal(source,input);input.instanceIds.reverse();input.instanceIds[0]='ffffffff-ffff-ffff-ffff-ffffffffffff';assert.deepEqual(p.instanceIds,[model.objects[0].instanceId,model.objects[2].instanceId]);let release;const pending=prepareScene3DRemovalApply(source,p,{digest:async content=>{await new Promise(resolve=>{release=resolve;});return hash(content);}});source.content='late mutation';source.token='late token';source.sourcePath='documents/late.json';source.baseSourceRevision=`sha256:${'1'.repeat(64)}`;source.sourceRevision=`sha256:${'2'.repeat(64)}`;release();assert.equal((await pending).afterContent,p.afterContent);
});
test('source and array accessors hidden properties serializers holes and extras reject without invoking caller code',()=>{
 let reads=0;const source=snapshot();Object.defineProperty(source,'content',{enumerable:true,get(){reads++;return original;}});
 const top=edit();Object.defineProperty(top,'instanceIds',{enumerable:true,get(){reads++;return edit().instanceIds;}});
 const nested=edit();Object.defineProperty(nested.instanceIds,0,{enumerable:true,get(){reads++;return model.objects[2].instanceId;}});
 const hidden=edit();Object.defineProperty(hidden.instanceIds,'hidden',{value:true});const serializer=edit();serializer.instanceIds.toJSON=()=>{reads++;return [];};
 for(const[s,e]of [[source,edit()],[snapshot(),top],[snapshot(),nested],[snapshot(),hidden],[snapshot(),serializer],[snapshot(),{instanceIds:Array(1)}],[snapshot(),{...edit(),extra:true}]])assert.throws(()=>createScene3DRemovalProposal(s,e));for(const sourcePath of ['/scene.json','../scene.json','documents//scene.json','documents\\scene.json','documents/scene.md','documents/./scene.json'])assert.throws(()=>createScene3DRemovalProposal(snapshot({sourcePath}),edit()),{errorCode:'scene3d_removal_invalid'});assert.equal(reads,0);
});
test('the only valid singleton source cannot be emptied and source budget takes precedence',()=>{
 const value=structuredClone(model);value.objects=[value.objects[0]];const content=JSON.stringify(value),source=snapshot({content,sourceRevision:`sha256:${hash(content)}`});assert.throws(()=>createScene3DRemovalProposal(source,{instanceIds:[value.objects[0].instanceId]}),{errorCode:'scene3d_removal_invalid'});const tooLarge=original+' '.repeat(128*1024);assert.throws(()=>createScene3DRemovalProposal(snapshot({content:tooLarge,sourceRevision:`sha256:${hash(tooLarge)}`}),{instanceIds:[]}),{errorCode:'scene3d_limit'});
});
