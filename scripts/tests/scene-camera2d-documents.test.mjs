import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { scenePhysics2DInputInstancesAuthor } from './helpers/scene-physics2d-input-instances-author-fixture.mjs';
import { createProjectBuildService } from '../lib/project-build-service.mjs';
import { createWorldCommandService } from '../adapters/node-world-commands.mjs';
import { inventory } from './runtime-case-fixture.mjs';
import { readPackageCatalog } from '../lib/resource-package-catalog.mjs';
import { planExport, writeExportZip } from '../lib/export-package.mjs';
import { unpackResourcePackage } from '../lib/resource-package-reader.mjs';
const cameraId='98989898-9898-4898-8898-989898989898';
async function fixture(t) {
 const f=await scenePhysics2DInputInstancesAuthor(t),cacheRoot=path.join(f.temporary,'camera-document-cache');
 const service=createProjectBuildService(f.author,{enabled:true,tool:undefined,cacheRoot});t.after(()=>service.close());
 const initial=await service.command({action:'camera2d-inspect',sceneId:f.sceneIds[0]});
 const value={format:'viento-scene-camera2d',schemaVersion:1,sceneObjectId:f.sceneIds[0],camera:{mode:'fixed',center:[400,240],zoom:1}};
 const request={command:'camera2d.create',mode:'apply',worldId:initial.worldId,baseRevision:initial.baseRevision,actorRef:{kind:'tool',id:'camera-test'},objectId:cameraId,
 documentType:initial.documentTypes[0].id,sourcePath:'documents/cameras/main.json',content:'\ufeff'+JSON.stringify(value,null,'\t').replaceAll('\n','\r\n')+'\r\n',
 sceneObjectId:initial.scene.objectId,sceneObjectRevision:initial.scene.objectRevision,sceneSourceRevision:initial.scene.sourceRevision};
 await createWorldCommandService(f.author)(request);
 return{...f,service,cacheRoot,value,request};
}
test('camera documents inspect and save through the host without a tool or runtime job',async t=>{
 const f=await fixture(t),sceneId=f.sceneIds[0],before=await inventory(f.author);
 const context=await f.service.command({action:'camera2d-inspect',sceneId});assert.equal(context.manifest.objectId,cameraId);assert.equal(context.targets.length,6);assert.equal(context.manifest.content,f.request.content);
 const content=JSON.stringify({...f.value,camera:{mode:'follow',targetInstanceId:f.secondInstanceId,offset:[-10,20],zoom:2}},null,2)+'\n';
 const saved=await f.service.command({action:'camera2d-save',sceneId,sceneVersion:context.scene.sourceRevision,documentId:cameraId,expectedVersion:context.manifest.sourceRevision,content});
 assert.equal(saved.content,content);assert.equal(saved.valid,true);const after=await inventory(f.author);
 for(const [name,hash]of Object.entries(before))if(name!==f.request.sourcePath)assert.equal(after[name],hash,name);
 assert.equal((await f.service.status()).job,null);await assert.rejects(fs.stat(f.cacheRoot),{code:'ENOENT'});
 await assert.rejects(f.service.command({action:'camera2d-save',sceneId,sceneVersion:context.scene.sourceRevision,documentId:cameraId,expectedVersion:context.manifest.sourceRevision,content:f.request.content}),{errorCode:'scene_camera2d_document_conflict'});
 const bad=JSON.stringify({...f.value,camera:{mode:'follow',targetInstanceId:cameraId,offset:[0,0],zoom:1}}),snapshot=await inventory(f.author);
 await assert.rejects(f.service.command({action:'camera2d-save',sceneId,sceneVersion:saved.sceneVersion,documentId:cameraId,expectedVersion:saved.version,content:bad}));assert.deepEqual(await inventory(f.author),snapshot);
 await assert.rejects(f.service.command({action:'camera2d-save',sceneId,sceneVersion:saved.sceneVersion,content}));
 await assert.rejects(f.service.command({action:'camera2d-inspect',sceneId,tool:'/tmp/none'}),{errorCode:'build_request_invalid'});
});
test('camera opt-in and same-OC target dependency survive selective resource export',async t=>{
 const f=await fixture(t),catalog=await readPackageCatalog(f.author),entry=catalog.entries.find(item=>item.id===cameraId);assert.deepEqual(entry.problems,[]);assert.ok(entry.dependencies.includes(f.sceneIds[0]));
 const plan=await planExport(f.author,{kind:'resources',revision:catalog.revision,ids:[cameraId],includeDependencies:true});
 const archive=path.join(f.temporary,'camera.zip');await writeExportZip(plan,archive);const stage=path.join(f.temporary,'camera-unpack');await fs.mkdir(stage);const pack=await unpackResourcePackage(archive,stage);
 assert.ok(pack.manifest.documents.some(item=>item.id===cameraId));assert.ok(pack.manifest.documents.some(item=>item.id===f.sceneIds[0]));assert.equal(await fs.readFile(path.join(pack.content,f.request.sourcePath),'utf8'),f.request.content);
});
