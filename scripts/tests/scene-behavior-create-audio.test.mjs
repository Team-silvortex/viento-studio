import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import '../adapters/node-studio-core.mjs';
import { captureSceneAudioDirectory, captureSceneBehaviorAudioTracks, isSceneBehaviorAudioTracks, sceneBehaviorAudioTrackValue } from '../../engine/scene-audio-directory.mjs';
import { captureSceneBehaviorCreateAudio, isSceneBehaviorCreateAudio, sceneBehaviorCreateAudioMatchOrigin, proposeSceneBehaviorCreateAudio } from '../../engine/scene-behavior-create-audio.mjs';
import { captureSceneBehaviorCreateOrigin, listSceneBehaviorCreateStringParameters, isSceneBehaviorCreateReferences } from '../../engine/scene-behavior-create-references.mjs';
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const rev = n => 'sha256:' + n.repeat(64);
const scene = () => ({ objectId:id(1), sourcePath:'documents/scenes/main.json', sourceRevision:rev('1') });
const origin = () => ({ worldId:'world:'+'a'.repeat(64), baseRevision:rev('a'), scene:{...scene(),objectRevision:rev('b')} });
const audio = () => ({format:'viento-scene-audio',schemaVersion:1,sceneObjectId:id(1),tracks:[{id:id(5),resourceId:id(7),role:'effect',volume:.25,loop:false},{id:id(4),resourceId:id(7),role:'music',volume:.15,loop:true}],cues:[]});
const raw = () => ({format:'viento-scene-audio-directory',schemaVersion:1,status:'ready',worldId:origin().worldId,revision:origin().baseRevision,scene:scene(),manifest:{objectId:id(2),sourcePath:'documents/audio/main.json',sourceRevision:rev('2'),content:JSON.stringify(audio())}});
const catalog = () => captureSceneBehaviorCreateAudio(origin(),raw());
const propose = (content='{"chosen":""}',extra={}) => proposeSceneBehaviorCreateAudio({content,catalog:catalog(),origin:origin(),parameter:'chosen',trackId:id(4),...extra});
const bad = fn => assert.throws(fn, e=> e instanceof TypeError);

test('first audio capture detaches ordered tracks sharing a resource and strips author declaration text',()=>{
 const input=raw(),base=origin(),c=captureSceneBehaviorCreateAudio(base,input);assert.ok(isSceneBehaviorCreateAudio(c));assert.ok(sceneBehaviorCreateAudioMatchOrigin(c,origin()));
 assert.deepEqual(c.tracks,[{trackId:id(5),resourceId:id(7),role:'effect'},{trackId:id(4),resourceId:id(7),role:'music'}]);
 assert.deepEqual(Object.keys(c.manifest),['objectId','sourcePath','sourceRevision']);assert.ok(Object.isFrozen(c.tracks[0]));
 input.manifest.content='{}';base.scene.sourceRevision=rev('f');assert.equal(c.tracks.length,2);assert.equal(sceneBehaviorCreateAudioMatchOrigin(c,base),false);
});
test('the shared strict origin utility captures data only and grants no catalog brand',()=>{
 const base=origin(),o=captureSceneBehaviorCreateOrigin(base);base.scene.sourcePath='changed';assert.equal(o.scene.sourcePath,scene().sourcePath);assert.ok(Object.isFrozen(o.scene));
 assert.equal(isSceneBehaviorCreateAudio(o),false);assert.equal(isSceneBehaviorCreateReferences(o),false);
 for(const mutate of [o=>o.worldId+='\n',o=>o.baseRevision+='\n',o=>o.scene.objectId+='\n',o=>o.scene.sourceRevision+='\n',o=>o.extra=true,o=>Object.setPrototypeOf(o,{inherited:true})]){const o=origin();mutate(o);bad(()=>captureSceneBehaviorCreateOrigin(o));}
});
test('world, saved scene and creation object revisions independently pin the audio directory',()=>{
 const c=catalog();
 for(const key of ['worldId','baseRevision']){const o=origin();o[key]=key==='worldId'?'world:'+'c'.repeat(64):rev('c');assert.equal(sceneBehaviorCreateAudioMatchOrigin(c,o),false);bad(()=>propose(undefined,{catalog:c,origin:o}));}
 for(const key of ['objectId','objectRevision','sourcePath','sourceRevision']){const o=origin();o.scene[key]=key==='objectId'?id(50):key==='sourcePath'?'documents/other.json':rev('c');assert.equal(sceneBehaviorCreateAudioMatchOrigin(c,o),false);}
 for(const mutate of [r=>r.worldId='world:'+'c'.repeat(64),r=>r.revision=rev('c'),r=>r.scene.sourcePath='documents/other.json',r=>r.scene.sourceRevision=rev('c')]){const r=raw();mutate(r);assert.throws(()=>captureSceneBehaviorCreateAudio(origin(),r),{errorCode:'scene_behavior_create_audio_origin_changed'});}
});
test('an empty saved directory is valid and supplies no invented tracks',()=>{
 const r={...raw(),status:'empty',manifest:null},c=captureSceneBehaviorCreateAudio(origin(),r);assert.equal(c.status,'empty');assert.equal(c.manifest,null);assert.deepEqual(c.tracks,[]);bad(()=>propose(undefined,{catalog:c}));
});
test('existing native audio declaration validation is not weakened for first creation',()=>{
 for(const mutate of [r=>r.status='empty',r=>r.manifest=null,r=>r.scene.objectId=id(88),r=>r.manifest.objectId=id(1),r=>r.manifest.sourcePath='../audio.json',
 r=>r.manifest.content='{}',r=>r.manifest.content='x'.repeat(32769),r=>r.manifest.content=JSON.stringify({...audio(),tracks:[]}),
 r=>r.manifest.content=JSON.stringify({...audio(),tracks:[audio().tracks[0],audio().tracks[0]]}),r=>r.manifest.content=JSON.stringify({...audio(),sceneObjectId:id(9)}),
 r=>r.manifest.content=JSON.stringify({...audio(),cues:[{id:id(10),trackId:id(99),action:'play',atSeconds:0}]})]){const r=raw();mutate(r);bad(()=>captureSceneBehaviorCreateAudio(origin(),r));}
});
test('String insertion changes one exact token while BOM, CRLF, Unicode and numeric spellings remain',()=>{
 const before='\uFEFF{\r\n\t"probe":1e2,"zero":-0,"note":"😀\\r\\n\\u0061",\r\n\t"chosen" : "old\\u0020value"\r\n}\r\n';
 const result=propose(before);assert.deepEqual(result,{content:before.replace('"old\\u0020value"',JSON.stringify(id(4))),changed:true});assert.ok(Object.isFrozen(result));
});
test('a semantically equal UUID keeps the exact escaped String and all review input bytes',()=>{
 const content='{ "chosen" : '+JSON.stringify(id(4)).replace('"0','"\\u0030')+', "x":1e2 }\n';assert.deepEqual(propose(content),{content,changed:false});
});
test('only listed track identities are insertable, never a resource or inferred default',()=>{
 assert.equal(JSON.parse(propose().content).chosen,id(4));assert.equal(JSON.parse(propose(undefined,{trackId:id(5)}).content).chosen,id(5));
 for(const trackId of [id(7),id(9),id(4)+'\n',null,{toString:()=>id(4)}])bad(()=>propose(undefined,{trackId}));
});
test('unregistered creation and saved behavior audio brands are disjoint in both directions',()=>{
 const content=JSON.stringify({format:'viento-scene-behaviors',schemaVersion:1,sceneObjectId:id(1),bindings:[{bindingId:id(3),instanceId:id(8),implementation:{backendId:'org.example.backend',language:'custom',sourceObjectId:id(9)},parameters:{chosen:''},events:[]}]});
 const old=captureSceneBehaviorAudioTracks({sourcePath:'documents/behaviors/main.json',token:'old',baseSourceRevision:rev('3'),sourceRevision:rev('3'),content},raw(),scene()),c=catalog();
 assert.equal(isSceneBehaviorAudioTracks(c),false);assert.throws(()=>sceneBehaviorAudioTrackValue(c,id(4)));
 for(const forged of [null,{},raw(),captureSceneAudioDirectory(raw(),id(1)),old,{...c},structuredClone(c),Object.create(c)]){assert.equal(isSceneBehaviorCreateAudio(forged),false);assert.equal(sceneBehaviorCreateAudioMatchOrigin(forged,origin()),false);bad(()=>propose(undefined,{catalog:forged}));}
});
test('malformed JSON, duplicate keys, scalar types and missing parameters do not create or coerce fields',()=>{
 for(const content of ['', '{"chosen":1e-}', '{"chosen":"a","chosen":"b"}', '{"chosen":false}', '{"chosen":0}', '{"chosen":[]}', '{"chosen":{}}', '[]','null','{"other":""}','{"__proto__":""}','{"chosen":"\\ud800"}'])bad(()=>propose(content));
 bad(()=>propose(undefined,{parameter:'new_key'}));assert.deepEqual(listSceneBehaviorCreateStringParameters('{"track_id":"","gain":-0,"loop":false}'),[{name:'track_id',value:''}]);
});
test('origin, raw directory and proposal accessors never execute during strict data capture',()=>{
 let calls=0;const o=origin();Object.defineProperty(o.scene,'sourceRevision',{enumerable:true,get(){calls++;return rev('1');}});bad(()=>captureSceneBehaviorCreateAudio(o,raw()));
 for(const mutate of [r=>Object.defineProperty(r,'manifest',{enumerable:true,get(){calls++;return raw().manifest;}}),r=>Object.defineProperty(r.manifest,'content',{enumerable:true,get(){calls++;return '{}';}}),r=>r.manifest.toJSON=()=>{calls++;return{};},r=>Object.setPrototypeOf(r.scene,{bad:true})]){const r=raw();mutate(r);bad(()=>captureSceneBehaviorCreateAudio(origin(),r));}
 const p={content:'{"chosen":""}',catalog:catalog(),origin:origin(),parameter:'chosen',trackId:id(4)};Object.defineProperty(p,'trackId',{enumerable:true,get(){calls++;return id(4);}});bad(()=>proposeSceneBehaviorCreateAudio(p));assert.equal(calls,0);
});
test('oversized input is refused before parsing the parameter fragment',()=>{
 const content='{"chosen":""}'+' '.repeat(32769),parse=JSON.parse;let large=0;JSON.parse=function(value,...args){if(typeof value==='string'&&value.length>32768)large++;return parse(value,...args);};
 try{bad(()=>propose(content));}finally{JSON.parse=parse;}assert.equal(large,0);
});
test('a valid fragment near the full source budget refuses a growing UUID replacement',()=>{
 const fragment=n=>JSON.stringify({chosen:'',...Object.fromEntries(Array.from({length:7},(_,i)=>['manual_'+i,'x'.repeat(4096)])),padding:'p'.repeat(n)});
 let lo=0,hi=4096;while(lo<hi){const mid=Math.ceil((lo+hi)/2);try{listSceneBehaviorCreateStringParameters(fragment(mid));lo=mid;}catch{hi=mid-1;}}
 const content=fragment(lo);assert.ok(listSceneBehaviorCreateStringParameters(content));assert.throws(()=>propose(content),{errorCode:'scene_behavior_create_parameters_invalid'});assert.equal(JSON.parse(content).chosen,'');
});
test('missing native core rejects ready audio while empty directory, manual JSON and existing references stay usable',()=>{
 const module=new URL('../../engine/scene-behavior-create-audio.mjs',import.meta.url).href,refs=new URL('../../engine/scene-behavior-create-references.mjs',import.meta.url).href;
 const code=`import assert from 'node:assert/strict';import {captureSceneBehaviorCreateAudio} from ${JSON.stringify(module)};import {listSceneBehaviorCreateStringParameters} from ${JSON.stringify(refs)};const o=${JSON.stringify(origin())},r=${JSON.stringify(raw())};assert.throws(()=>captureSceneBehaviorCreateAudio(o,r));const empty=captureSceneBehaviorCreateAudio(o,{...r,status:'empty',manifest:null});assert.equal(empty.tracks.length,0);assert.deepEqual(listSceneBehaviorCreateStringParameters('{"manual":"keep"}'),[{name:'manual',value:'keep'}]);console.log('CORE_UNAVAILABLE_MANUAL_OK');`;
 assert.match(execFileSync(process.execPath,['--input-type=module','-e',code],{encoding:'utf8'}),/CORE_UNAVAILABLE_MANUAL_OK/);
});

test('newline-terminated manifest revisions never become a first-creation catalog',()=>{
 const r=raw();r.manifest.sourceRevision+='\n';bad(()=>captureSceneBehaviorCreateAudio(origin(),r));
});
