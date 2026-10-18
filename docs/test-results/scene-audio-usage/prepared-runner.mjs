import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root=path.resolve(fileURLToPath(new URL('../../../',import.meta.url))),out=path.dirname(fileURLToPath(import.meta.url));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex'),revision=bytes=>'sha256:'+hash(bytes),load=p=>import(pathToFileURL(path.join(root,p)).href);
const report={ok:false,comparisons:[],calls:[],scope:'Real source/desktop/mobile modules and WASM with injected usage port. Desktop Node usage service is also invoked. Prepared modules do not prove installation or Android HTTP capability.'};
const common=['engine/scene-audio-usage.mjs','engine/scene-audio-core.mjs','engine/scene-behaviors.mjs','engine/studio-core.mjs','engine/studio-core.wasm',
 'web/modules/app-scene-audio-source.js','web/modules/app-runtime.js','web/modules/app-doc-service.js','web/modules/app-scene-audio.js','web/scene-audio.css','web/i18n/en.js','web/i18n/ja.js'];
for(const base of ['desktop/resources','mobile/dist'])for(const file of common){const a=await fs.readFile(path.join(root,file)),b=await fs.readFile(path.join(root,base,file));assert.deepEqual(a,b);report.comparisons.push({base,file,sha256:hash(a)});}
for(const file of ['scripts/lib/scene-audio-usage-service.mjs','scripts/lib/doc-api-service.mjs','scripts/lib/doc-server-routes.mjs']){const a=await fs.readFile(path.join(root,file)),b=await fs.readFile(path.join(root,'desktop/resources',file));assert.deepEqual(a,b);report.comparisons.push({base:'desktop/resources',file,sha256:hash(a)});}
const {createSceneAudioUsageService}=await load('scripts/lib/scene-audio-usage-service.mjs'),sceneObjectId='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const raw=await createSceneAudioUsageService(path.join(root,'examples/scene-audio')).inspect({sceneObjectId});assert.equal(raw.behavior,null);
const content=raw.audio.content,behavior=JSON.parse(await fs.readFile(path.join(root,'examples/scene-behaviors/documents/behaviors/demo.json'),'utf8'));
behavior.bindings[0].parameters.custom_sound=JSON.parse(content).tracks[0].id;
const behaviorContent=JSON.stringify(behavior),withBehavior={...raw,behavior:{objectId:'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',sourcePath:'documents/behaviors/demo.json',sourceRevision:revision(behaviorContent),content:behaviorContent}};
for(const base of ['','desktop/resources','mobile/dist']){
 const core=await load(path.join(base,'engine/studio-core.mjs'));await core.initializeStudioCore(()=>fs.readFile(path.join(root,base,'engine/studio-core.wasm')));
 const api=await load(path.join(base,'engine/scene-audio-usage.mjs')),hostModule=await load(path.join(base,'web/modules/app-scene-audio-source.js'));
 const state={document:{},token:'prepared',sourcePath:raw.audio.sourcePath,content,baseline:content,version:revision(content),editable:true,creating:false,busy:false,available:true,sourceJSON:true,usageAvailable:true};
 let reads=0,writes=0;const host=hostModule.createSceneAudioSourceHost({getState:()=>state,digest:hash,inspectUsage:async input=>{assert.equal(input.sceneObjectId,sceneObjectId);reads++;return withBehavior;},writeDraft:()=>writes++});
 const source=await host.getSource(),catalog=await host.getUsage(source);assert.equal(api.isSceneAudioUsage(catalog),true);assert.equal(api.sceneAudioUsageMatchSource(catalog,source),true);assert.equal(api.isSceneAudioUsage({...catalog}),false);
 assert.equal(catalog.matches.length,1);assert.equal(catalog.matches[0].parameterName,'custom_sound');assert.equal(catalog.matches[0].trackId,JSON.parse(content).tracks[0].id);assert.equal(api.sceneAudioUsageMatchSource(catalog,{...source,token:'other'}),false);
 const before=host.getContext().sourceToken;state.usageAvailable=false;assert.equal(host.getContext().usageAvailable,false);assert.equal(host.getContext().sourceToken,before);await assert.rejects(host.getUsage(source));assert.equal(reads,1);assert.equal(writes,0);
 report.calls.push({base:base||'source',matches:catalog.matches.length,reads,writes,forgedRejected:true,changedSourceRejected:true,optionalCapabilityPreservesOrdinarySource:true});
}
const desktop=await load('desktop/resources/scripts/lib/scene-audio-usage-service.mjs');assert.deepEqual(await desktop.createSceneAudioUsageService(path.join(root,'examples/scene-audio')).inspect({sceneObjectId}),raw);report.desktopUsageService=true;
report.ok=true;await fs.writeFile(path.join(out,'prepared.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({ok:true,comparisons:report.comparisons.length,calls:report.calls.length,desktopUsageService:true}));
