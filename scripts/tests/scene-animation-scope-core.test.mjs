import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {inspectSceneAnimation,sampleSceneAnimation,sampleSceneAnimationClip,advanceSceneAnimationTransport,advanceSceneAnimationClipTransport,retimeSceneAnimation,copySceneAnimationTrack} from '../../engine/scene-animation-core.mjs';
import {supportsStudioCoreSceneAnimationInstances,getStudioCoreMetadata} from '../../engine/studio-core.mjs';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const doc=(scope='instance')=>({format:'viento-scene-animation',schemaVersion:4,playbackScope:scope,sceneObjectId:id(1),durationSeconds:2,loop:false,tracks:[{id:id(2),instanceId:id(3),property:'opacity',interpolation:'linear',keyframes:[{atSeconds:0,value:0},{atSeconds:2,value:1}]}],clips:[{id:id(4),name:'Attack',startSeconds:.5,endSeconds:2,loop:false}]});
const wire=(operation,document=doc(),fields={})=>({protocolVersion:1,operation:'sceneAnimation.'+operation,document,...fields});
const {instance:{exports:core}}=await WebAssembly.instantiate(await fs.readFile(new URL('../../engine/studio-core.wasm',import.meta.url)),{});
const encoder=new TextEncoder(),decoder=new TextDecoder();
function wasm(request){const bytes=encoder.encode(typeof request==='string'?request:JSON.stringify(request)),at=core.viento_core_input(bytes.length)>>>0;new Uint8Array(core.memory.buffer,at,bytes.length).set(bytes);const out=core.viento_core_run()>>>0;return JSON.parse(decoder.decode(new Uint8Array(core.memory.buffer,out,core.viento_core_output_len())));}
let serial=0;
async function bridge(marker=1,transform){
 const module=await import(`../../engine/studio-core.mjs?scope-forgery=${++serial}`),memory=new WebAssembly.Memory({initial:40}),original=WebAssembly.instantiate;let size=0,outputLength=0,calls=0;
 try{WebAssembly.instantiate=async()=>({instance:{exports:{memory,viento_core_protocol_version:()=>1,viento_core_scene_animation_version:()=>1,viento_core_scene_animation_sprite_version:()=>1,viento_core_scene_animation_clips_version:()=>1,viento_core_scene_animation_transport_version:()=>1,viento_core_scene_animation_retime_version:()=>1,viento_core_scene_animation_track_copy_version:()=>1,...(marker===null?{}:{viento_core_scene_animation_instances_version:()=>marker}),viento_core_input:length=>{size=length;return 8;},viento_core_output_len:()=>outputLength,viento_core_run:()=>{calls++;const request=JSON.parse(decoder.decode(new Uint8Array(memory.buffer,8,size)));let result=wasm(request);if(transform)result=transform(result,request);const bytes=encoder.encode(JSON.stringify(result));outputLength=bytes.length;new Uint8Array(memory.buffer,1048576,bytes.length).set(bytes);return 1048576;}}}});await module.initializeStudioCore(()=>new Uint8Array([1]));}finally{WebAssembly.instantiate=original;}
 return {module,calls:()=>calls};
}
test('scope is an optional marker and old formats remain byte-shaped without implied instance behavior',()=>{
 assert.equal(core.viento_core_scene_animation_instances_version(),1);assert.equal(core.viento_core_scene_animation_version(),1);assert.equal(core.viento_core_scene_animation_clips_version(),1);assert.equal(supportsStudioCoreSceneAnimationInstances(),true);
 for(const scope of ['scene','instance']){const d=doc(scope);assert.deepEqual(inspectSceneAnimation(d).document,d);assert.ok(Object.isFrozen(inspectSceneAnimation(d).document));assert.deepEqual(inspectSceneAnimation({...d,clips:[]}).document.clips,[]);}
 for(const version of [1,2,3]){const d=doc();d.schemaVersion=version;if(version<3)delete d.clips;assert.throws(()=>inspectSceneAnimation(d),{errorCode:'scene_animation_invalid'});delete d.playbackScope;assert.deepEqual(inspectSceneAnimation(d).document,d);}
});
test('v4 has the exact scope and clip fields, strict enums and duplicate decoded keys',()=>{
 for(const change of [d=>delete d.playbackScope,d=>delete d.clips,d=>d.playbackScope='',d=>d.playbackScope='Instance',d=>d.playbackScope=' instance',d=>d.playbackScope=null,d=>d.playbackScope=true,d=>d.extra=0,d=>d.clips[0].endSeconds=3,d=>d.schemaVersion=5]){const d=doc();change(d);assert.throws(()=>inspectSceneAnimation(d),{errorCode:'scene_animation_invalid'});}
 const text=JSON.stringify(wire('inspect'));assert.equal(wasm(text.replace('"playbackScope":"instance"','"playbackScope":"scene","playbackScop\\u0065":"instance"')).errorCode,'studio_core_request_invalid');
 let calls=0;const d=doc();Object.defineProperty(d,'playbackScope',{enumerable:true,get(){calls++;return 'instance';}});assert.throws(()=>inspectSceneAnimation(d),{errorCode:'studio_core_request_invalid'});assert.equal(calls,0);
});
test('scope does not change existing Rust samples or transport DTO semantics',()=>{
 for(const scope of ['scene','instance']){const d=doc(scope),old={...d,schemaVersion:3};delete old.playbackScope;
  for(const at of [0,.25,.5,1.5,2,86400]){assert.deepEqual(sampleSceneAnimation(d,at),sampleSceneAnimation(old,at));for(const clip of [null,id(4)])assert.deepEqual(sampleSceneAnimationClip(d,clip,at),sampleSceneAnimationClip(old,clip,at));}
  for(const advance of [advanceSceneAnimationTransport,advanceSceneAnimationClipTransport]){let state=null;for(const [timeSeconds,command] of [[0,null],[.25,{action:'pause'}],[2,{action:'seek',positionSeconds:.5}],[2,{action:'play'}],[4,null],[4,{action:'stop'}]]){const input={state,timeSeconds,command};const actual=advance({document:d,...input});assert.deepEqual(actual,advance({document:old,...input}));state=actual;}}
 }
});
test('retime and copy preserve explicit scope clips and schema while source is unchanged',()=>{
 for(const scope of ['scene','instance']){const d=doc(scope),before=structuredClone(d),retimed=retimeSceneAnimation(d,4).document,copied=copySceneAnimationTrack(d,id(2),id(6),id(7)).document;assert.equal(retimed.playbackScope,scope);assert.equal(retimed.schemaVersion,4);assert.equal(retimed.clips[0].startSeconds,1);assert.equal(copied.playbackScope,scope);assert.equal(copied.schemaVersion,4);assert.deepEqual(copied.clips,d.clips);assert.deepEqual(d,before);}
});
test('missing or unknown scope marker blocks only schema4 before native dispatch without fallback',async()=>{
 for(const marker of [null,0,2]){const h=await bridge(marker);assert.equal(h.module.supportsStudioCoreSceneAnimationInstances(),false);for(const scope of ['scene','instance'])for(const request of [wire('inspect',doc(scope)),wire('sampleClip',doc(scope),{clipId:null,timeSeconds:0}),wire('clipTransport',doc(scope),{state:null,timeSeconds:0,command:null}),wire('retime',doc(scope),{durationSeconds:4}),wire('copyTrack',doc(scope),{sourceTrackId:id(2),targetInstanceId:id(6),newTrackId:id(7)})])assert.throws(()=>h.module.dispatchStudioCoreSceneAnimation(request),{errorCode:'studio_core_unavailable'});assert.equal(h.calls(),0);const old=doc();old.schemaVersion=3;delete old.playbackScope;assert.deepEqual(h.module.dispatchStudioCoreSceneAnimation(wire('inspect',old)).document,old);}
});
test('JS receipt gate rejects scope changes removals and forged invalid source while normal core remains ready',async()=>{
 for(const operation of ['inspect','retime','copyTrack'])for(const mutate of [d=>d.playbackScope='scene',d=>delete d.playbackScope,d=>d.schemaVersion=3]){const h=await bridge(1,result=>{mutate(result.sceneAnimation.document);return result;});const fields=operation==='retime'?{durationSeconds:4}:operation==='copyTrack'?{sourceTrackId:id(2),targetInstanceId:id(6),newTrackId:id(7)}:{};assert.throws(()=>h.module.dispatchStudioCoreSceneAnimation(wire(operation,doc(),fields)),{errorCode:'studio_core_unavailable'});}
 for(const scope of [true,'',null]){const d=doc();d.playbackScope=scope;const h=await bridge(1,()=>({protocolVersion:1,ok:true,sceneAnimation:{document:d}}));assert.throws(()=>h.module.dispatchStudioCoreSceneAnimation(wire('inspect',d)),{errorCode:'studio_core_unavailable'});}
 assert.equal(getStudioCoreMetadata().ready,true);
});
