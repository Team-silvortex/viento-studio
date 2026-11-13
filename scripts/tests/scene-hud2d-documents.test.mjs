import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { scenePhysics2DInputInstancesAuthor } from './helpers/scene-physics2d-input-instances-author-fixture.mjs';
import { createSceneHUD2DDocumentService } from '../lib/scene-hud2d-documents.mjs';
import { createWorldCommandService } from '../adapters/node-world-commands.mjs';
import { inventory } from './runtime-case-fixture.mjs';
const hudId='98989898-9898-4898-8898-989898989899';
async function fixture(t,version) {
 const f=await scenePhysics2DInputInstancesAuthor(t);
 if(version===1)await f.edit('documents/scenes/demo.json',scene=>{scene.schemaVersion=1;scene.actors=scene.actors.slice(0,1);delete scene.actors[0].instanceId;});
 const service=createSceneHUD2DDocumentService(f.author),sceneId=f.sceneIds[0],initial=await service.inspect(sceneId);
 const value={format:'viento-scene-hud2d',schemaVersion:1,sceneObjectId:sceneId,elements:[{id:'98989898-9898-4898-8898-989898989900',kind:'label',anchor:'top-left',offset:[8,8],size:[200,30],fontSize:20,color:'#ffffff',content:{kind:'literal',text:'Ready'}}]};
 const content='\ufeff'+JSON.stringify(value,null,'\t').replaceAll('\n','\r\n')+'\r\n';
 const request={command:'hud2d.create',mode:'apply',worldId:initial.worldId,baseRevision:initial.baseRevision,actorRef:{kind:'tool',id:'hud-test'},objectId:hudId,
 documentType:initial.documentTypes[0].id,sourcePath:'documents/hud/main.json',content,sceneObjectId:sceneId,sceneObjectRevision:initial.scene.objectRevision,sceneSourceRevision:initial.scene.sourceRevision};
 await fs.mkdir(path.join(f.author,'documents/hud'),{recursive:true});await createWorldCommandService(f.author)(request);return{...f,service,value,request,sceneId};
}
for(const version of [1,2])test(`HUD author inspect and guarded save support Scene2D ${version}`,async t=>{
 const f=await fixture(t,version),context=await f.service.inspect(f.sceneId),before=await inventory(f.author);
 assert.equal(context.format,'viento-hud2d-author-context');assert.equal(context.manifest.objectId,hudId);assert.equal(context.manifest.content,f.request.content);
 const content=JSON.stringify({...f.value,elements:[{...f.value.elements[0],content:{kind:'state',key:'score',prefix:'Score: ',suffix:'',missing:'—'}}]},null,2)+'\n';
 const saved=await f.service.save({sceneId:f.sceneId,sceneVersion:context.scene.sourceRevision,documentId:hudId,expectedVersion:context.manifest.sourceRevision,content});
 assert.equal(saved.content,content);assert.equal(saved.valid,true);const after=await inventory(f.author);
 for(const [name,hash] of Object.entries(before))if(name!==f.request.sourcePath)assert.equal(after[name],hash,name);
 await assert.rejects(f.service.save({sceneId:f.sceneId,sceneVersion:context.scene.sourceRevision,documentId:hudId,expectedVersion:context.manifest.sourceRevision,content:f.request.content}),{errorCode:'scene_hud2d_document_conflict'});
 const snapshot=await inventory(f.author);await assert.rejects(f.service.save({sceneId:f.sceneId,sceneVersion:saved.sceneVersion,documentId:hudId,expectedVersion:saved.version,content:JSON.stringify({...f.value,elements:[{...f.value.elements[0],size:[0,10]}]})}));assert.deepEqual(await inventory(f.author),snapshot);
 await assert.rejects(f.service.save({sceneId:f.sceneId,sceneVersion:saved.sceneVersion,content}));
});
