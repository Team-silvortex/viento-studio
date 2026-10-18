import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { inspectSceneAnimation, sampleSceneAnimation } from '../../engine/scene-animation-core.mjs';
import { supportsStudioCoreSceneAnimation, getStudioCoreMetadata, dispatchStudioCoreSceneAnimation } from '../../engine/studio-core.mjs';
const bytes = await fs.readFile(new URL('../../engine/studio-core.wasm', import.meta.url));
const { instance: { exports: core } } = await WebAssembly.instantiate(bytes, {});
const id = n => `${n.toString(16).padStart(8, '0')}-1111-4111-8111-111111111111`;
const document = () => ({ format:'viento-scene-animation', schemaVersion:1, sceneObjectId:id(1), durationSeconds:2, loop:false,
  tracks:[{id:id(2),instanceId:id(3),property:'offset2d',interpolation:'linear',keyframes:[{atSeconds:0,value:[0,10]},{atSeconds:1,value:[20,-10]}]}] });
const request = (doc = document(), time) => ({protocolVersion:1,operation:time === undefined ? 'sceneAnimation.inspect':'sceneAnimation.sample',document:doc,...(time === undefined ? {}:{timeSeconds:time})});
const encode = new TextEncoder(), decode = new TextDecoder('utf-8', {fatal:true});
function wasm(input) {
  const wire=encode.encode(typeof input==='string'?input:JSON.stringify(input)), at=core.viento_core_input(wire.length)>>>0;
  new Uint8Array(core.memory.buffer,at,wire.length).set(wire); const out=core.viento_core_run()>>>0;
  return JSON.parse(decode.decode(new Uint8Array(core.memory.buffer,out,core.viento_core_output_len())));
}
const sampleValue = (doc, time) => sampleSceneAnimation(doc,time).values[0].value;
let bridgeIndex=0;
async function bridge(transform, version=1) {
  const module=await import(`../../engine/studio-core.mjs?animation-forgery=${++bridgeIndex}`);
  const memory=new WebAssembly.Memory({initial:40}), original=WebAssembly.instantiate;let inputLength=0,outputLength=0,calls=0;
  try {
    WebAssembly.instantiate=async()=>({instance:{exports:{memory,viento_core_protocol_version:()=>1,
      ...(version === null ? {} : {viento_core_scene_animation_version:()=>version}),viento_core_scene_audio_version:()=>1,
      viento_core_input:length=>{inputLength=length;return 8;},viento_core_output_len:()=>outputLength,
      viento_core_run:()=>{calls++;const input=JSON.parse(decode.decode(new Uint8Array(memory.buffer,8,inputLength)));
        const actual=wasm(input), output=encode.encode(JSON.stringify(transform?transform(actual,input):actual));
        outputLength=output.length;new Uint8Array(memory.buffer,1048576,outputLength).set(output);return 1048576;},
    }}});
    await module.initializeStudioCore(()=>new Uint8Array([1]));
  } finally {WebAssembly.instantiate=original;}
  return {module,calls:()=>calls};
}

test('optional native animation domain returns detached frozen values without changing the main ABI',()=>{
  assert.equal(core.viento_core_protocol_version(),1);assert.equal(core.viento_core_scene_animation_version(),1);assert.equal(supportsStudioCoreSceneAnimation(),true);
  const source=document(), before=JSON.stringify(source), inspected=inspectSceneAnimation(source);
  assert.deepEqual(inspected,{document:source});assert.equal(JSON.stringify(source),before);
  assert.ok(Object.isFrozen(inspected)&&Object.isFrozen(inspected.document.tracks[0].keyframes[0].value));
  source.tracks[0].keyframes[0].value[0]=99;assert.equal(inspected.document.tracks[0].keyframes[0].value[0],0);
  const sampled=sampleSceneAnimation(inspected.document,.5);assert.deepEqual(sampled,{timeSeconds:.5,localTimeSeconds:.5,finished:false,
    values:[{trackId:id(2),instanceId:id(3),property:'offset2d',value:[10,0]}]});assert.ok(Object.isFrozen(sampled.values[0].value));
});

test('all four properties use scalar or vector linear interpolation and rotation keeps declared winding',()=>{
  const doc=document();doc.tracks=[
    {id:id(2),instanceId:id(3),property:'offset2d',interpolation:'linear',keyframes:[{atSeconds:0,value:[-10000,10000]},{atSeconds:2,value:[10000,-10000]}]},
    {id:id(4),instanceId:id(3),property:'rotation2d',interpolation:'linear',keyframes:[{atSeconds:0,value:-36000},{atSeconds:2,value:36000}]},
    {id:id(5),instanceId:id(3),property:'scale2d',interpolation:'linear',keyframes:[{atSeconds:0,value:[.01,100]},{atSeconds:2,value:[100,.01]}]},
    {id:id(6),instanceId:id(3),property:'opacity',interpolation:'linear',keyframes:[{atSeconds:0,value:0},{atSeconds:2,value:1}]},
  ];
  const sampled=sampleSceneAnimation(doc,1);assert.deepEqual(sampled.values.map(value=>value.property),['offset2d','rotation2d','scale2d','opacity']);
  assert.deepEqual(sampled.values[0].value,[0,0]);assert.equal(sampled.values[1].value,0);assert.equal(sampled.values[3].value,.5);
  sampled.values[2].value.forEach(n=>assert.ok(Math.abs(n-50.005)<1e-12));
  assert.deepEqual(sampleSceneAnimation(doc,0).values.map(row=>row.value),doc.tracks.map(track=>track.keyframes[0].value));
  assert.deepEqual(sampleSceneAnimation(doc,2).values.map(row=>row.value),doc.tracks.map(track=>track.keyframes[1].value));
});

test('step keys switch at the exact boundary while nonlooping tracks hold their last key',()=>{
  const doc=document();doc.tracks[0].interpolation='step';
  assert.deepEqual(sampleValue(doc,.999999),[0,10]);assert.deepEqual(sampleValue(doc,1),[20,-10]);
  for(const time of [1.5,2,86400]){const value=sampleSceneAnimation(doc,time);assert.deepEqual(value.values[0].value,[20,-10]);assert.equal(value.localTimeSeconds,Math.min(time,2));assert.equal(value.finished,time>=2);}
  doc.tracks[0].keyframes.splice(1);assert.deepEqual(sampleValue(doc,86400),[0,10]);
});

test('loop cycles return to zero exactly and reverse seeks have no retained playback state',()=>{
  const doc=document();doc.loop=true;
  for(const time of [0,2,4,86400]){const value=sampleSceneAnimation(doc,time);assert.equal(value.localTimeSeconds,0);assert.equal(value.finished,false);assert.deepEqual(value.values[0].value,[0,10]);}
  assert.deepEqual(sampleValue(doc,2.5),[10,0]);const expected=sampleSceneAnimation(doc,.125);sampleSceneAnimation(doc,86399);assert.deepEqual(sampleSceneAnimation(doc,.125),expected);
  doc.durationSeconds=.25;doc.tracks[0].keyframes[1].atSeconds=.25;assert.deepEqual(sampleValue(doc,.125),[10,0]);assert.deepEqual(sampleValue(doc,.25),[0,10]);
  // Tiny valid durations must not introduce Infinity, NaN or an unbounded step count.
  doc.durationSeconds=Number.MIN_VALUE;doc.tracks[0].keyframes.splice(1);assert.deepEqual(sampleValue(doc,86400),[0,10]);
});

test('the author schema is exact and rejects invalid IDs bounds dimensions and interpolation choices',()=>{
  for(const path of [[],['tracks',0],['tracks',0,'keyframes',0]]){
    const source=document(),target=path.reduce((value,key)=>value[key],source);
    for(const key of Object.keys(target)){const doc=structuredClone(source);delete path.reduce((value,key)=>value[key],doc)[key];assert.throws(()=>inspectSceneAnimation(doc),{errorCode:'scene_animation_invalid'});}
    target.extra=true;assert.throws(()=>inspectSceneAnimation(source),{errorCode:'scene_animation_invalid'});
  }
  const invalid=[d=>d.format='animation',d=>d.schemaVersion=2,d=>d.sceneObjectId='bad',d=>d.loop=1,d=>d.durationSeconds=0,d=>d.durationSeconds=-0,d=>d.durationSeconds=60.01,
    d=>d.tracks[0].id='ABCDEFAB-1111-4111-8111-111111111111',d=>d.tracks[0].instanceId='',d=>d.tracks[0].property='position',d=>d.tracks[0].interpolation='ease',
    d=>d.tracks[0].keyframes[0].value=0,d=>d.tracks[0].keyframes[0].value=[0],d=>d.tracks[0].keyframes[0].value=[0,0,0],d=>d.tracks[0].keyframes[0].value=[0,10000.01],
    d=>d.tracks[0].keyframes[0].value=[-10000.01,0],d=>d.tracks[0].keyframes[0].atSeconds=.01,d=>d.tracks[0].keyframes[1].atSeconds=0,d=>d.tracks[0].keyframes[1].atSeconds=2.01,
    d=>d.tracks=[],d=>d.tracks[0].keyframes=[]];
  for(const mutate of invalid){const doc=document();mutate(doc);assert.throws(()=>inspectSceneAnimation(doc),{errorCode:'scene_animation_invalid'});}
  for(const[property,value]of [['rotation2d',36000.01],['rotation2d',-36000.01],['rotation2d',[0,0]],['scale2d',[0,1]],['scale2d',[1,100.01]],['opacity',-.001],['opacity',1.001],['opacity',[0]]]){
    const doc=document();doc.tracks[0].property=property;doc.tracks[0].keyframes=[{atSeconds:0,value}];assert.throws(()=>inspectSceneAnimation(doc),{errorCode:'scene_animation_invalid'});
  }
  for(const time of [-1,86400.01,'0',null])assert.throws(()=>sampleSceneAnimation(document(),time),{errorCode:'scene_animation_invalid'});
  assert.equal(getStudioCoreMetadata().ready,true);
});

test('duplicate identities and conflicting visual channels fail while one instance can animate separate properties',()=>{
  const doc=document();doc.tracks.push(structuredClone(doc.tracks[0]));assert.throws(()=>inspectSceneAnimation(doc),{errorCode:'scene_animation_invalid'});
  doc.tracks[1].id=id(4);assert.throws(()=>inspectSceneAnimation(doc),{errorCode:'scene_animation_invalid'});
  doc.tracks[1].instanceId=id(5);assert.equal(inspectSceneAnimation(doc).document.tracks.length,2);
  doc.tracks[1].instanceId=id(3);doc.tracks[1].property='opacity';doc.tracks[1].keyframes=[{atSeconds:0,value:.5}];assert.equal(inspectSceneAnimation(doc).document.tracks.length,2);
  doc.tracks[1].keyframes.push({atSeconds:.5,value:1},{atSeconds:.25,value:0});assert.throws(()=>inspectSceneAnimation(doc),{errorCode:'scene_animation_invalid'});
});

test('track and key budgets are enforced separately and the 512-key maximum is sampled without identity loss',()=>{
  const doc=document(),base=doc.tracks[0];doc.tracks=Array.from({length:8},(_,index)=>({...structuredClone(base),id:id(index+10),instanceId:id(index+100),
    keyframes:Array.from({length:64},(_,index)=>({atSeconds:index/32,value:[index,-index]}))}));
  assert.equal(inspectSceneAnimation(doc).document.tracks.flatMap(t=>t.keyframes).length,512);
  assert.deepEqual(sampleSceneAnimation(doc,2).values.map(t=>t.value),Array.from({length:8},()=>[63,-63]));
  const excess=structuredClone(doc);excess.tracks.push({...structuredClone(base),id:id(999),instanceId:id(998)});assert.throws(()=>inspectSceneAnimation(excess),{errorCode:'scene_animation_invalid'});
  const perTrack=document();perTrack.tracks[0].keyframes=Array.from({length:65},(_,index)=>({atSeconds:index/32,value:[0,0]}));assert.throws(()=>inspectSceneAnimation(perTrack),{errorCode:'scene_animation_invalid'});
  const many=document();many.tracks=Array.from({length:32},(_,index)=>({...structuredClone(base),id:id(index+10),instanceId:id(index+100)}));assert.equal(inspectSceneAnimation(many).document.tracks.length,32);
  many.tracks.push({...structuredClone(base),id:id(999),instanceId:id(998)});assert.throws(()=>inspectSceneAnimation(many),{errorCode:'scene_animation_invalid'});
});

test('raw WASM rejects duplicate decoded keys bad Unicode and BOM envelopes without repairing authorship',()=>{
  const raw=JSON.stringify(request());
  for(const[from,to]of [['"protocolVersion":1','"protocolVersion":0,"protocolVersion":1'],['"document":','"document":null,"document":'],['"loop":false','"loop":true,"lo\\u006fp":false'],['"atSeconds":0','"atSeconds":1,"atSeconds":0'],['"value":[0,10]','"value":null,"val\\u0075e":[0,10]']]){
    assert.equal(wasm(raw.replace(from,to)).errorCode,'studio_core_request_invalid');
  }
  for(const wire of ['\uFEFF'+raw,raw.replace(id(1),'\\uD800')])assert.equal(wasm(wire).errorCode,'studio_core_request_invalid');
  assert.equal(wasm(raw).ok,true);
});

test('JS boundary rejects accessors serializers missing array elements and nonfinite values before native invocation',()=>{
  let invoked=0;const source=document();Object.defineProperty(source.tracks[0],'property',{enumerable:true,get(){invoked++;return'opacity';}});
  assert.throws(()=>inspectSceneAnimation(source),{errorCode:'studio_core_request_invalid'});assert.equal(invoked,0);
  for(const mutate of [d=>d.durationSeconds=NaN,d=>d.durationSeconds=Infinity,d=>d.tracks[0].keyframes[0].value[0]=undefined,d=>delete d.tracks[0],d=>d.toJSON=()=>({})]){
    const doc=document();mutate(doc);assert.throws(()=>inspectSceneAnimation(doc),{errorCode:'studio_core_request_invalid'});
  }
  for(const time of [NaN,Infinity,undefined])assert.throws(()=>sampleSceneAnimation(document(),time),{errorCode:'studio_core_request_invalid'});
  assert.throws(()=>dispatchStudioCoreSceneAnimation({...request(),timeSeconds:0}),{errorCode:'studio_core_request_invalid'});
  assert.throws(()=>dispatchStudioCoreSceneAnimation({...request(),operation:'sceneAudio.inspect'}),{errorCode:'studio_core_request_invalid'});
  assert.equal(getStudioCoreMetadata().ready,true);
});

test('missing optional animation exports disable only animation and never trigger a JavaScript fallback',async()=>{
  for(const version of [null,0,2]){
    const h=await bridge(null,version);assert.equal(h.module.supportsStudioCoreSceneAnimation(),false);
    assert.throws(()=>h.module.dispatchStudioCoreSceneAnimation(request()),{errorCode:'studio_core_unavailable'});assert.equal(h.calls(),0);
    assert.equal(h.module.supportsStudioCoreSceneAudio(),true);assert.equal(h.module.getStudioCoreMetadata().ready,true);
    assert.deepEqual(h.module.dispatchStudioCore({protocolVersion:1,operation:'move',actors:[],ids:[],delta:[0,0]}),[]);
  }
});

test('native response receipts bind declarations time track ordering identity and actual interpolated values',async()=>{
  const corruptions=[
    r=>({...r,extra:true}),r=>({...r,sceneAnimation:{...r.sceneAnimation,extra:true}}),
    r=>{r.sceneAnimation.document.loop=true;return r;},r=>{r.sceneAnimation.document.tracks[0].instanceId=id(999);return r;},
    r=>{r.sceneAnimation.document.tracks[0].keyframes[1].value=[99,99];return r;},
  ];
  for(const corruption of corruptions){const h=await bridge(corruption);assert.throws(()=>h.module.dispatchStudioCoreSceneAnimation(request()),{errorCode:'studio_core_unavailable'});assert.equal(h.module.getStudioCoreMetadata().ready,false);}
  const sampled=[r=>{r.sceneAnimation.timeSeconds=.4;return r;},r=>{r.sceneAnimation.localTimeSeconds=.4;return r;},r=>{r.sceneAnimation.finished=true;return r;},
    r=>{r.sceneAnimation.values=[];return r;},r=>{r.sceneAnimation.values[0].trackId=id(999);return r;},r=>{r.sceneAnimation.values[0].instanceId=id(999);return r;},
    r=>{r.sceneAnimation.values[0].property='scale2d';return r;},r=>{r.sceneAnimation.values[0].value=[9,0];return r;},r=>{r.sceneAnimation.values[0].value=[10,0,0];return r;},r=>{r.sceneAnimation.values[0].extra=true;return r;}];
  for(const corruption of sampled){const h=await bridge(corruption);assert.throws(()=>h.module.dispatchStudioCoreSceneAnimation(request(document(),.5)),{errorCode:'studio_core_unavailable'});assert.equal(h.module.getStudioCoreMetadata().ready,false);}
  const good=await bridge();assert.deepEqual(good.module.dispatchStudioCoreSceneAnimation(request(document(),.5)),sampleSceneAnimation(document(),.5));
  assert.equal(getStudioCoreMetadata().ready,true);
});

const nativePath=process.env.VIENTO_ANIMATION_CORE_NATIVE;
test('native CLI and actual WASM agree on sample boundaries failures and duplicate-key requests',{skip:!nativePath},async()=>{
  const source=document(),looping={...source,loop:true};
  const wires=[request(source),...[-1,0,.125,.5,1,2,86400,86401].map(time=>request(source,time)),...[-1,0,.125,.5,1,2,86400,86401].map(time=>request(looping,time)),request({...source,extra:true})].map(JSON.stringify);
  wires.push(wires[0].replace('"loop":false','"loop":true,"lo\\u006fp":false'));
  const result=await new Promise((resolve,reject)=>{const child=spawn(nativePath,[],{stdio:['pipe','pipe','pipe']});let stdout='',stderr='';const timeout=setTimeout(()=>child.kill('SIGKILL'),10000);
    child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');child.stdout.on('data',text=>stdout+=text);child.stderr.on('data',text=>stderr+=text);
    child.on('error',error=>{clearTimeout(timeout);reject(error);});child.on('close',(status,signal)=>{clearTimeout(timeout);resolve({status,signal,stdout,stderr});});child.stdin.end(wires.join('\n')+'\n');});
  assert.equal(result.status,0,result.stderr);assert.equal(result.signal,null);assert.deepEqual(result.stdout.trim().split('\n').map(JSON.parse),wires.map(wasm));
});
