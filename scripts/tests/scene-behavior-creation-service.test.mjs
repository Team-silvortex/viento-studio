import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {createSceneBehaviorCreationService} from '../lib/scene-behavior-creation-service.mjs';
const sceneId='dddddddd-dddd-4ddd-8ddd-dddddddddddd', oldId='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',scriptId='ffffffff-ffff-4fff-8fff-ffffffffffff';
const id=n=>`${String(n).padStart(8,'0')}-3333-4333-8333-333333333333`;
async function fixture(t){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'viento-behavior-creation-service-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 await fs.cp(new URL('../../examples/scene-behaviors/',import.meta.url),root,{recursive:true});
 const read=p=>fs.readFile(path.join(root,p),'utf8'),write=(p,v)=>fs.writeFile(path.join(root,p),typeof v==='string'?v:JSON.stringify(v,null,2)+'\n');
 const metadata=`metadata/documents/${sceneId}.json`,record=JSON.parse(await read(metadata));record.relations=record.relations.filter(r=>r.kind!=='behavior');await write(metadata,record);
 await fs.unlink(path.join(root,`metadata/documents/${oldId}.json`));await fs.unlink(path.join(root,'documents/behaviors/demo.json'));
 const service=createSceneBehaviorCreationService(root);
 const add=async(n,file,content)=>{await write('documents/scripts/'+file,content);await write(`metadata/documents/${id(n)}.json`,{format:'viento-document',version:1,id:id(n),sourcePath:'documents/scripts/'+file,documentType:'script',parserProfile:'structured',relations:[],assetBindings:[]});};
 return{root,read,write,record,metadata,service,add,inspect:()=>service.inspect({sceneObjectId:sceneId})};
}
async function tree(root){const out={};for(const f of await fs.readdir(root,{recursive:true,withFileTypes:true})){if(f.isFile()){const file=path.join(f.parentPath,f.name);out[path.relative(root,file)]=createHash('sha256').update(await fs.readFile(file)).digest('hex');}}return out;}
test('creation catalog is immutable, saved-world pinned and read-only without exposing or executing script bytes',async t=>{
 const f=await fixture(t);await f.write('documents/scripts/checkpoint.txt','# PRIVATE_SOURCE\nthrow new Error("never execute")');const before=await tree(f.root),value=await f.inspect();
 assert.equal(value.format,'viento-behavior-creation-context');assert.equal(value.schemaVersion,1);assert.equal(value.documentRoot,'documents');assert.ok(value.documentTypes.some(x=>x.id==='script'));
 assert.equal(value.scene.objectId,sceneId);assert.equal(value.scene.instances.length,2);assert.notEqual(value.scene.instances[0].instanceId,value.scene.instances[1].instanceId);
 for(const rev of [value.baseRevision,value.scene.sourceRevision,value.scene.objectRevision,value.sources[0].sourceRevision])assert.match(rev,/^sha256:[a-f0-9]{64}$/);
 assert.equal(value.sources[0].objectId,scriptId);assert.ok(Object.isFrozen(value.scene.instances[0]));assert.ok(Object.isFrozen(value.documentTypes[0]));
 for(const secret of [f.root,'PRIVATE_SOURCE','throw new Error','extends Node'])assert.equal(JSON.stringify(value).includes(secret),false);
 assert.deepEqual(await tree(f.root),before);
 await f.write('documents/scripts/checkpoint.txt','# changed source');assert.notEqual((await f.inspect()).baseRevision,value.baseRevision);
});
test('catalog offers all readable registered TXT candidates while excluding unregistered, missing, non-text and oversized sources',async t=>{
 const f=await fixture(t);await f.add(1,'unused.TXT','# inert');await f.add(2,'large.txt','中'.repeat(22000));await f.add(3,'notes.md','# inert');await f.add(4,'missing.txt','x');await fs.unlink(path.join(f.root,'documents/scripts/missing.txt'));await f.write('documents/scripts/unregistered.txt','x');
 assert.deepEqual(new Set((await f.inspect()).sources.map(x=>x.objectId)),new Set([scriptId,id(1)]));
 await fs.unlink(path.join(f.root,`metadata/documents/${scriptId}.json`));await fs.unlink(path.join(f.root,`metadata/documents/${id(1)}.json`));assert.deepEqual((await f.inspect()).sources,[]);
});
test('existing or dangling behavior relations reject first creation without modifying the world',async t=>{
 const f=await fixture(t);for(const targetId of [oldId,scriptId]){await f.write(f.metadata,{...f.record,relations:[...f.record.relations,{kind:'behavior',targetId}]});const before=await tree(f.root);await assert.rejects(f.inspect());assert.deepEqual(await tree(f.root),before);}
});
test('catalog captures requests before await and rejects accessors, aliases, extras and malformed IDs without invoking them',async t=>{
 const f=await fixture(t),payload={sceneObjectId:sceneId},pending=f.service.inspect(payload);payload.sceneObjectId=scriptId;assert.equal((await pending).scene.objectId,sceneId);
 let calls=0;const getter={get sceneObjectId(){calls++;return sceneId;}};
 for(const input of [null,[],{},getter,{sceneObjectId:sceneId,execute:true},{sceneObjectId:sceneId,[Symbol('x')]:1},Object.create({sceneObjectId:sceneId}),{sceneObjectId:'../bad'}])await assert.rejects(f.service.inspect(input),{errorCode:'world_command_invalid'});
 assert.equal(calls,0);assert.equal((await f.service.inspect(Object.assign(Object.create(null),{sceneObjectId:sceneId}))).scene.objectId,sceneId);
});
test('catalog keeps 256 candidate budget separate from eight binding sources and does not truncate silently',async t=>{
 const f=await fixture(t);for(let n=1;n<=255;n++)await f.add(n,`candidate-${n}.txt`,'# inert');assert.equal((await f.inspect()).sources.length,256);await f.add(256,'candidate-256.txt','# inert');await assert.rejects(f.inspect(),{statusCode:413,errorCode:'world_behavior_create_limit'});
});
