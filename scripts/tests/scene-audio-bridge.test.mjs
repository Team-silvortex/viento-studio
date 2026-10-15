import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const bytes=await fs.readFile(new URL('../../engine/studio-core.wasm',import.meta.url));const {instance:{exports:native}}=await WebAssembly.instantiate(bytes,{});
const id=n=>`${n.toString(16).padStart(8,'0')}-1111-4111-8111-111111111111`;
const doc=()=>({format:'viento-scene-audio',schemaVersion:1,sceneObjectId:id(1),tracks:[{id:id(2),resourceId:id(3),role:'music',volume:.5,loop:true},{id:id(5),resourceId:id(3),role:'effect',volume:1,loop:false}],cues:[{id:id(4),trackId:id(2),atSeconds:1,action:'stop'},{id:id(6),trackId:id(2),atSeconds:0,action:'play'},{id:id(7),trackId:id(2),atSeconds:1,action:'play'}]});
const request=(sample=false)=>({protocolVersion:1,operation:sample?'sceneAudio.sample':'sceneAudio.inspect',document:doc(),...(sample?{timeSeconds:1}:{})});
function wasm(input){const data=new TextEncoder().encode(JSON.stringify(input)),at=native.viento_core_input(data.length)>>>0;new Uint8Array(native.memory.buffer,at,data.length).set(data);const out=native.viento_core_run()>>>0;return JSON.parse(new TextDecoder().decode(new Uint8Array(native.memory.buffer,out,native.viento_core_output_len())));}
let seq=0;
async function bridge(mutate,version=1){const module=await import(new URL('../../engine/studio-core.mjs?audio-receipt='+ ++seq,import.meta.url)),memory=new WebAssembly.Memory({initial:40}),old=WebAssembly.instantiate;let length=0,outputLength=0;
 try{WebAssembly.instantiate=async()=>({instance:{exports:{memory,viento_core_protocol_version:()=>1,...(version===null?{}:{viento_core_scene_audio_version:()=>version}),viento_core_input:size=>{length=size;return 16;},viento_core_run:()=>{const input=JSON.parse(new TextDecoder().decode(new Uint8Array(memory.buffer,16,length)));const result=wasm(input);if(mutate)mutate(result,input);const data=new TextEncoder().encode(JSON.stringify(result));outputLength=data.length;new Uint8Array(memory.buffer,1048576,data.length).set(data);return 1048576;},viento_core_output_len:()=>outputLength}}});await module.initializeStudioCore(()=>new Uint8Array([1]));}finally{WebAssembly.instantiate=old;}return module;
}
test('audio requires its own supported probe and missing audio never disables old layout core',async()=>{
 for(const version of [null,0,2]){const m=await bridge(null,version);assert.equal(m.supportsStudioCoreSceneAudio(),false);for(const sample of [false,true])assert.throws(()=>m.dispatchStudioCoreSceneAudio(request(sample)),{errorCode:'studio_core_unavailable'});assert.equal(m.getStudioCoreMetadata().ready,true);assert.deepEqual(m.dispatchStudioCore({protocolVersion:1,operation:'validateBatch',actors:[{objectId:'one',position:[0,0]}],changes:[{objectId:'one',position:[1,2]}]}),[{objectId:'one',position:[1,2]}]);}
});
test('audio capability does not require either 2D source or 3D parsing exports',async()=>{const m=await bridge();assert.equal(m.supportsStudioCoreSceneAudio(),true);for(const sample of [false,true])assert.deepEqual(m.dispatchStudioCoreSceneAudio(request(sample)),wasm(request(sample)).sceneAudio);});
test('inspect cannot replace identities author values declaration order or same-time cue order',async()=>{
 const mutations=[r=>r.extra=true,r=>r.sceneAudio.extra=true,r=>r.sceneAudio.diagnostics.push({code:'invented'}),r=>r.sceneAudio.document.sceneObjectId=id(99),r=>r.sceneAudio.document.tracks.reverse(),r=>r.sceneAudio.document.tracks[0].resourceId=id(99),r=>r.sceneAudio.document.tracks[0].volume=1,r=>r.sceneAudio.document.tracks[0].loop=false,r=>r.sceneAudio.document.tracks[0].extra=true,r=>r.sceneAudio.document.cues.reverse(),r=>r.sceneAudio.document.cues.push(r.sceneAudio.document.cues[0]),r=>r.sceneAudio.document.cues[1].action='play'];
 for(const mutate of mutations){const m=await bridge(mutate);assert.throws(()=>m.dispatchStudioCoreSceneAudio(request()),{errorCode:'studio_core_unavailable'});assert.equal(m.getStudioCoreMetadata().ready,false);}
});
test('sample commands bind all identities trigger times playback settings and complete order',async()=>{
 const mutations=[r=>r.sceneAudio.timeSeconds=2,r=>r.sceneAudio.commands.reverse(),r=>r.sceneAudio.commands.pop(),r=>r.sceneAudio.commands[0].cueId=id(99),r=>r.sceneAudio.commands[0].trackId=id(5),r=>r.sceneAudio.commands[0].resourceId=id(99),r=>r.sceneAudio.commands[0].volume=.6,r=>r.sceneAudio.commands[0].loop=false,r=>r.sceneAudio.commands[0].role='effect',r=>r.sceneAudio.commands[0].atSeconds=.1,r=>r.sceneAudio.commands[0].action='stop',r=>r.sceneAudio.commands[0].extra=true];
 for(const mutate of mutations){const m=await bridge(mutate);assert.throws(()=>m.dispatchStudioCoreSceneAudio(request(true)),{errorCode:'studio_core_unavailable'});}
});
test('sample state cannot claim natural completion omit silent tracks or alter latest trigger',async()=>{
 const mutations=[r=>r.sceneAudio.states.pop(),r=>r.sceneAudio.states.reverse(),r=>r.sceneAudio.states[0].status='stopped',r=>r.sceneAudio.states[0].startedAtSeconds=0,r=>r.sceneAudio.states[0].lastCueId=id(4),r=>r.sceneAudio.states[1].status='playing',r=>r.sceneAudio.states[1].startedAtSeconds=0,r=>r.sceneAudio.states[1].lastCueId=id(4),r=>r.sceneAudio.states[0].resourceId=id(99),r=>r.sceneAudio.states[0].volume=1,r=>r.sceneAudio.states[0].loop=false,r=>r.sceneAudio.states[0].extra=true];
 for(const mutate of mutations){const m=await bridge(mutate);assert.throws(()=>m.dispatchStudioCoreSceneAudio(request(true)),{errorCode:'studio_core_unavailable'});}
});
