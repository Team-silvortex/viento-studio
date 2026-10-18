import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import '/home/chiharukiryu/cdev/viento-studio/scripts/adapters/node-studio-core.mjs';
import { captureSceneAudioUsage, sceneAudioUsageSource } from '/home/chiharukiryu/cdev/viento-studio/engine/scene-audio-usage.mjs';
import { sourceLocationSelection } from '/home/chiharukiryu/cdev/viento-studio/web/modules/app-source-location.js';
const id = n => `aaaaaaaa-0000-4000-8000-${String(n).padStart(12, '0')}`;
const revision = text => 'sha256:' + createHash('sha256').update(text).digest('hex');
const audio = JSON.stringify({format:'viento-scene-audio',schemaVersion:1,sceneObjectId:id(1),tracks:[{id:id(2),resourceId:id(3),role:'music',volume:0.5,loop:false}],cues:[]});
const behavior = {format:'viento-scene-behaviors',schemaVersion:1,sceneObjectId:id(1),bindings:[0,1,2].map(n=>({bindingId:id(10+n),instanceId:id(20+n),implementation:{backendId:'org.example.independent',language:'custom',sourceObjectId:id(30)},parameters:{name:'旅人😀',ordinary:id(2)},events:[]}))};
let cases=0;
for (const newline of ['\n','\r\n','\r']) for (const bom of ['', '\ufeff']) {
  const content=bom+JSON.stringify(behavior,null,2).replaceAll('"ordinary"','"ord\\u0069nary"').replaceAll('"'+id(2)+'"','"\\u0061'+id(2).slice(1)+'"').replaceAll('\n',newline)+newline;
  const raw={format:'viento-scene-audio-usage',schemaVersion:1,worldId:'world:'+'a'.repeat(64),revision:revision('world'),scene:{objectId:id(1),sourcePath:'documents/scenes/main.json',sourceRevision:revision('scene')},audio:{objectId:id(4),sourcePath:'documents/audio/main.json',sourceRevision:revision(audio),content:audio},behavior:{objectId:id(5),sourcePath:'documents/behaviors/main.json',sourceRevision:revision(content),content}};
  const source={sourcePath:raw.audio.sourcePath,token:'1',baseSourceRevision:revision(audio),sourceRevision:revision(audio),content:audio};
  const catalog=captureSceneAudioUsage(source,raw); assert.equal(catalog.matches.length,3);
  let previous=-1;
  for(const [index,match] of catalog.matches.entries()) {
    const result=sceneAudioUsageSource(catalog,match);
    assert.equal(result.content,content); assert.equal(result.sourceRevision,revision(content)); assert.equal(result.propertyPath,`/bindings/${index}/parameters/ordinary`);
    assert.ok(Object.isFrozen(result)); assert.ok(Object.isFrozen(result.sourceRange)); assert.ok(result.sourceRange.start>previous); previous=result.sourceRange.start;
    const selection=sourceLocationSelection(content,result,result.sourceRevision); assert.equal(selection.status,'exact');
    assert.equal(JSON.parse(content.slice(result.sourceRange.start,result.sourceRange.end)),id(2));
    assert.equal(content.replace(/\r\n|\r/g,'\n').slice(selection.start,selection.end),content.slice(result.sourceRange.start,result.sourceRange.end));
    cases++;
  }
  let reads=0; const fake=new Proxy({}, {get(){reads++; throw Error('must not read')}});
  assert.throws(()=>sceneAudioUsageSource(catalog,fake),{errorCode:'scene_audio_usage_invalid'}); assert.equal(reads,0);
  assert.throws(()=>sceneAudioUsageSource(catalog,structuredClone(catalog.matches[0])),{errorCode:'scene_audio_usage_invalid'});
  const second=captureSceneAudioUsage(source,raw); assert.throws(()=>sceneAudioUsageSource(catalog,second.matches[0]),{errorCode:'scene_audio_usage_invalid'});
  raw.behavior.content='changed'; raw.behavior.sourceRevision=revision('changed'); assert.equal(sceneAudioUsageSource(catalog,catalog.matches[0]).content,content);
}
console.log(JSON.stringify({ok:true,sourceSelections:cases,newlineForms:3,bomForms:2,repeatedTrackBindings:3,escapedKeysAndValues:true,forgedProxyAndCrossCatalogRejected:true,callerMutationDetached:true}));
