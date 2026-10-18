import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { pathToFileURL, fileURLToPath } from 'node:url';
const root=path.resolve(fileURLToPath(new URL('../../../',import.meta.url))),out=path.dirname(fileURLToPath(import.meta.url));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex'), revision=bytes=>'sha256:'+hash(bytes),load=file=>import(pathToFileURL(path.join(root,file)).href);
const report={format:'viento-animation-prepared-verification',schemaVersion:1,ok:false,productVersion:'0.1.5',comparisons:[],calls:[],scope:'Real source, desktop prepared and mobile prepared WASM/core/edit/source-host modules. Prepared copies only; no installation, native window, Android device or mobile backend execution claim.'};
const common=['engine/scene-animation-core.mjs','engine/scene-animation-edit.mjs','engine/scene-animation.mjs','engine/studio-core.mjs','engine/studio-core.wasm','engine/studio-core.build.json','engine/build-plan.mjs','engine/project-assembly-plan-contract.mjs','engine/backend-capabilities.mjs','engine/scene-control-program.mjs','engine/json-source.mjs','engine/canonical-json.mjs','engine/source-path.mjs','web/modules/app-scene-animation.js','web/modules/app-scene-animation-source.js','web/modules/app-runtime.js','web/scene-animation.css','web/i18n/en.js','web/i18n/ja.js'];
const compare=async(base,file,target=file)=>{const original=await fs.readFile(path.join(root,file)),copy=await fs.readFile(path.join(root,base,target));assert.deepEqual(copy,original,base+'/'+target);report.comparisons.push({base,source:file,target,sha256:hash(original),bytes:original.length});};
for(const base of ['desktop/resources','mobile/dist'])for(const file of common)await compare(base,file);
for(const file of ['scripts/backends/godot4-animation.mjs','scripts/backends/godot4/animation-runtime.gd','scripts/backends/godot4-adapter.mjs','scripts/backends/godot4-project.mjs','scripts/backends/godot4/project-scene.gd','scripts/adapters/node-project-build.mjs','scripts/adapters/node-build-snapshot.mjs'])await compare('desktop/resources',file);
for(const lang of ['en','ja'])await compare('desktop/ui/i18n',`web/i18n/${lang}.js`,`${lang}.js`);
const raw=await fs.readFile(path.join(root,'examples/scene-animation/documents/animations/demo.json'),'utf8');
const content='\ufeff'+JSON.stringify(JSON.parse(raw),null,2).replaceAll('\n','\r\n')+'\r\n';
let expectedSamples;
for(const base of ['','desktop/resources','mobile/dist']){
 const core=await load(path.join(base,'engine/studio-core.mjs'));await core.initializeStudioCore(()=>fs.readFile(path.join(root,base,'engine/studio-core.wasm')));
 const api=await load(path.join(base,'engine/scene-animation-core.mjs')),edit=await load(path.join(base,'engine/scene-animation-edit.mjs')),hostApi=await load(path.join(base,'web/modules/app-scene-animation-source.js'));
 const document=await edit.readSceneAnimationDocument(content),inspected=api.inspectSceneAnimation(document);assert.equal(inspected.document.format,'viento-scene-animation');
 const sampled=[0,.25,1,2,2.25,60].map(time=>api.sampleSceneAnimation(document,time));
 if(!expectedSamples)expectedSamples=sampled;else assert.deepEqual(sampled,expectedSamples);
 assert.equal(sampled[0].values.length,4);assert.deepEqual(sampled[0].values.map(row=>row.value),sampled[3].values.map(row=>row.value));
 let writes=0,focuses=0;const state={document:{},token:'prepared-animation',sourcePath:'documents/animations/demo.json',content,baseline:content,version:revision(content),editable:true,creating:false,busy:false,available:true,sourceJSON:true};
 const host=hostApi.createSceneAnimationSourceHost({getState:()=>state,digest:hash,writeDraft:next=>{writes++;state.content=next;},focus:()=>focuses++});
 const source=await host.getSource();assert.ok(source);const candidate=structuredClone(document);candidate.loop=!candidate.loop;candidate.tracks[0].keyframes[1].value=[44,22];
 const proposal=await edit.createSceneAnimationProposal(source,{durationSeconds:candidate.durationSeconds,loop:candidate.loop,tracks:candidate.tracks});
 assert.deepEqual(proposal.changedPaths,['/loop','/tracks/0/keyframes/1/value']);assert.equal(edit.isSceneAnimationProposal(proposal),true);assert.equal(edit.isSceneAnimationProposal({...proposal}),false);
 const prepared=await edit.prepareSceneAnimationApply(source,proposal,{digest:hash});assert.equal(prepared.afterContent.startsWith('\ufeff'),true);assert.equal(prepared.afterContent.replaceAll('\r\n','').includes('\n'),false);assert.equal(prepared.afterContent.endsWith('\r\n'),true);
 const receipt=await host.applyDraft(proposal);assert.equal(receipt.applied,true);assert.equal(writes,1);assert.equal(state.content,prepared.afterContent);assert.equal(state.baseline,content);assert.equal(state.version,revision(content));receipt.focus();assert.equal(focuses,1);
 await assert.rejects(host.applyDraft(proposal),{errorCode:'scene_animation_authoring_conflict'});await assert.rejects(host.applyDraft({...proposal}),{errorCode:'scene_animation_authoring_conflict'});assert.equal(writes,1);
 assert.deepEqual(await edit.readSceneAnimationDocument(state.content),candidate);state.busy=true;assert.equal(await host.getSource(),null);
 report.calls.push({base:base||'source',wasmInitialized:true,sampleTimes:sampled.map(row=>row.timeSeconds),tracks:sampled[0].values.length,changedPaths:proposal.changedPaths,writes,focuses,BOMandCRLFPreserved:true,savedBaselineUnchanged:true,staleAndForgedRejected:true,busySourceUnavailable:true});
}
const author='/tmp/viento-animation-check/prepared-author';await fs.cp(path.join(root,'examples/scene-animation'),author,{recursive:true,errorOnExist:true,force:false});
try{
 await load('desktop/resources/scripts/adapters/node-studio-core.mjs');
 const snapshots=await load('desktop/resources/scripts/adapters/node-build-snapshot.mjs'),desktopBackend=await load('desktop/resources/scripts/backends/godot4-adapter.mjs'),sourceBackend=await load('scripts/backends/godot4-adapter.mjs');
 const captured=await snapshots.captureBuildSnapshot(author,'documents/scenes/demo.json');assert.equal(captured.ok,true,JSON.stringify(captured.diagnostics));assert.equal(captured.plan.animation.document.tracks.length,4);
 const packed=await desktopBackend.GODOT4_EXECUTION_ADAPTER.generate(captured.plan),source=await sourceBackend.GODOT4_EXECUTION_ADAPTER.generate(captured.plan);
 assert.deepEqual(packed.files,source.files);assert.deepEqual(packed.backend,source.backend);assert.ok(packed.files.has('animation-runtime.gd'));assert.ok(packed.files.has('animation.json'));
 report.desktopNodeHost={captured:true,animationTracks:4,generatedFiles:packed.files.size,sourceAndPreparedGeneratorBytesEqual:true,backendVersion:packed.backend.version,executed:false};
}finally{await fs.rm(author,{recursive:true,force:true});}
report.ok=true;await fs.writeFile(path.join(out,'prepared-summary.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({ok:true,comparisons:report.comparisons.length,calls:report.calls.length,desktopNodeHost:report.desktopNodeHost}));
