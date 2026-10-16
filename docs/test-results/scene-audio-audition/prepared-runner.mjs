import fs from 'node:fs/promises';import path from 'node:path';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';import {fileURLToPath,pathToFileURL} from 'node:url';
const root=path.resolve(fileURLToPath(new URL('../../../',import.meta.url))),out=path.dirname(fileURLToPath(import.meta.url));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex'),load=p=>import(pathToFileURL(path.join(root,p)).href);
const report={ok:false,comparisons:[],calls:[],scope:'Resource-byte preparation through actual source/desktop/mobile WASM imports, not native-device or WebAudio playback acceptance.'};
const files=['engine/scene-audio-audition.mjs','engine/audio-wav.mjs','engine/scene-audio-resources.mjs','engine/studio-core.mjs','engine/studio-core.wasm','web/modules/scene-audio-audition.js','web/modules/app-scene-audio-media.js','web/modules/app-scene-audio-source.js','web/modules/app-runtime.js','web/modules/app-scene-audio.js','web/scene-audio.css','web/i18n/en.js','web/i18n/ja.js'];
for(const base of ['desktop/resources','mobile/dist'])for(const file of [...files,...(base==='desktop/resources'?['scripts/lib/audio-wav.mjs','scripts/backends/godot4-adapter.mjs']:[])]){const a=await fs.readFile(path.join(root,file)),b=await fs.readFile(path.join(root,base,file));assert.deepEqual(a,b);report.comparisons.push({base,file,sha256:hash(a)});}
const {createSceneAudioCreationService}=await load('scripts/lib/scene-audio-creation-service.mjs'),fixture=path.join(root,'examples/scene-audio'),sceneObjectId='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const raw=await createSceneAudioCreationService(fixture).inspect({sceneObjectId}),content=raw.manifest.content;
const source={sourcePath:raw.manifest.sourcePath,token:'prepared:audition',sourceRevision:'sha256:'+hash(content),baseSourceRevision:'sha256:'+hash(content),content};
const bytes=await fs.readFile(path.join(fixture,'assets/tone.wav')),resourceId=raw.resources[0].resourceId;let expected;
for(const base of ['','desktop/resources','mobile/dist']){
 const core=await load(path.join(base,'engine/studio-core.mjs'));await core.initializeStudioCore(()=>fs.readFile(path.join(root,base,'engine/studio-core.wasm')));
 const resources=await load(path.join(base,'engine/scene-audio-resources.mjs')),audition=await load(path.join(base,'engine/scene-audio-audition.mjs'));
 const catalog=resources.captureSceneAudioResources(source,raw),sound=await audition.prepareSceneAudioAudition(source,catalog,resourceId,{getResources:()=>resources.captureSceneAudioResources(source,raw),readBytes:()=>bytes,digestBytes:hash});
 assert.equal(audition.isSceneAudioAudition(sound),true);assert.deepEqual(new Uint8Array(audition.sceneAudioAuditionBytes(sound)),new Uint8Array(bytes));const copied=new Uint8Array(audition.sceneAudioAuditionBytes(sound));copied[50]^=1;assert.equal(hash(new Uint8Array(audition.sceneAudioAuditionBytes(sound))),hash(bytes));assert.equal(audition.isSceneAudioAudition({...sound}),false);
 if(expected)assert.deepEqual(sound,expected);else expected=sound;report.calls.push({base:base||'source',descriptor:sound,sha256:hash(bytes),privateBytesPreserved:true,forgedDescriptorRejected:true});
}
report.ok=true;await fs.writeFile(path.join(out,'prepared.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({ok:true,comparisons:report.comparisons.length,calls:report.calls.length}));
