import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { copySceneAnimationTrack, inspectSceneAnimation, retimeSceneAnimation, sampleSceneAnimation, sampleSceneAnimationClip } from '../../engine/scene-animation-core.mjs';
import { supportsStudioCoreSceneAnimationTrackCopy, dispatchStudioCoreSceneAnimation, getStudioCoreMetadata } from '../../engine/studio-core.mjs';

const id = n => `${n.toString(16).padStart(8,'0')}-1111-4111-8111-111111111111`;
const document = (version = 3) => ({ format:'viento-scene-animation',schemaVersion:version,sceneObjectId:id(1),durationSeconds:2,loop:true,
  tracks:[{id:id(2),instanceId:id(3),property:'offset2d',interpolation:'linear',keyframes:[{atSeconds:0,value:[0,10]},{atSeconds:.5,value:[1,2]},{atSeconds:2,value:[20,-10]}]},
    ...(version >= 2 ? [{id:id(6),instanceId:id(3),property:'spriteFrame2d',interpolation:'step',grid:{columns:4,rows:2},keyframes:[{atSeconds:0,value:0},{atSeconds:1,value:3},{atSeconds:2,value:7}]}] : [])],
  ...(version === 3 ? {clips:[{id:id(4),name:'攻撃 Attack',startSeconds:1,endSeconds:2,loop:false},{id:id(5),name:'待機 🎬',startSeconds:.25,endSeconds:.5,loop:true}]} : {}) });
const request = (doc = document(), sourceTrackId = id(2), targetInstanceId = id(99), newTrackId = id(98)) => ({protocolVersion:1,operation:'sceneAnimation.copyTrack',document:doc,sourceTrackId,targetInstanceId,newTrackId});
const copy = options => copySceneAnimationTrack(options.document, options.sourceTrackId, options.targetInstanceId, options.newTrackId);
const expectedDocument = options => ({...structuredClone(options.document),tracks:[...structuredClone(options.document.tracks),
  {...structuredClone(options.document.tracks.find(track=>track.id===options.sourceTrackId)),id:options.newTrackId,instanceId:options.targetInstanceId}]});
const {instance:{exports:core}} = await WebAssembly.instantiate(await fs.readFile(new URL('../../engine/studio-core.wasm',import.meta.url)),{});
const encode=new TextEncoder(),decode=new TextDecoder('utf-8',{fatal:true});
function wasm(input) {
  const bytes=encode.encode(typeof input==='string'?input:JSON.stringify(input)),at=core.viento_core_input(bytes.length)>>>0;
  new Uint8Array(core.memory.buffer,at,bytes.length).set(bytes);const out=core.viento_core_run()>>>0;
  return JSON.parse(decode.decode(new Uint8Array(core.memory.buffer,out,core.viento_core_output_len())));
}
let bridgeIndex=0;
async function bridge(transform,{copyMarker=1,sprites=1,clips=1}={}) {
  const module=await import(`../../engine/studio-core.mjs?track-copy-forgery=${++bridgeIndex}`),memory=new WebAssembly.Memory({initial:40}),original=WebAssembly.instantiate;
  let inputLength=0,outputLength=0,calls=0;
  try {
    WebAssembly.instantiate=async()=>({instance:{exports:{memory,viento_core_protocol_version:()=>1,
      viento_core_scene_animation_version:()=>1,viento_core_scene_animation_transport_version:()=>1,viento_core_scene_animation_retime_version:()=>1,
      ...(sprites===null?{}:{viento_core_scene_animation_sprite_version:()=>sprites}),
      ...(clips===null?{}:{viento_core_scene_animation_clips_version:()=>clips}),
      ...(copyMarker===null?{}:{viento_core_scene_animation_track_copy_version:()=>copyMarker}),
      viento_core_input:length=>{inputLength=length;return 8;},viento_core_output_len:()=>outputLength,
      viento_core_run:()=>{calls++;const incoming=JSON.parse(decode.decode(new Uint8Array(memory.buffer,8,inputLength))),result=wasm(incoming);
        const output=encode.encode(JSON.stringify(transform?transform(result,incoming):result));outputLength=output.length;
        new Uint8Array(memory.buffer,1048576,outputLength).set(output);return 1048576;},
    }}});
    await module.initializeStudioCore(()=>new Uint8Array([1]));
  } finally {WebAssembly.instantiate=original;}
  return {module,calls:()=>calls};
}
function repeatedTracks(count,keyCount) {
  const doc=document(1),base=doc.tracks[0];
  doc.tracks=Array.from({length:count},(_,index)=>({...structuredClone(base),id:id(10+index),instanceId:id(100+index),
    keyframes:Array.from({length:keyCount},(_,key)=>({atSeconds:key/32,value:[0,10]}))}));
  return doc;
}
function byteLimitDocument() {
  const doc=document(),base=doc.tracks[0];
  doc.tracks=Array.from({length:31},(_,index)=>({...structuredClone(base),id:id(10+index),instanceId:id(100+index),
    keyframes:Array.from({length:index===0?64:index<=24?13:12},(_,key)=>({atSeconds:key*.030123456789123,value:[9999.123456789123,-9999.123456789123]}))}));
  doc.clips=Array.from({length:32},(_,index)=>({id:id(200+index),name:'🎬'.repeat(128),startSeconds:.12345678901234567,endSeconds:1.9876543210987654,loop:false}));
  return doc;
}

test('optional copy appends an exact detached frozen channel in schema 1 2 and 3 without changing original tracks or clips',()=>{
  assert.equal(core.viento_core_protocol_version(),1);assert.equal(core.viento_core_scene_animation_track_copy_version(),1);
  assert.equal(supportsStudioCoreSceneAnimationTrackCopy(),true);
  for(const version of [1,2,3]) for(const sourceId of version===1?[id(2)]:[id(2),id(6)]) {
    const source=document(version),before=structuredClone(source),options=request(source,sourceId),result=copy(options);
    assert.deepEqual(Object.keys(result),['document']);assert.deepEqual(result.document,expectedDocument(options));assert.deepEqual(source,before);
    assert.equal(result.document.schemaVersion,version);assert.equal(Object.hasOwn(result.document,'clips'),version===3);
    assert.ok(Object.isFrozen(result)&&Object.isFrozen(result.document.tracks.at(-1).keyframes[0]));
    if(sourceId===id(2)) assert.ok(Object.isFrozen(result.document.tracks.at(-1).keyframes[0].value));
    if(sourceId===id(6)) assert.ok(Object.isFrozen(result.document.tracks.at(-1).grid));
    if(version===3) assert.ok(Object.isFrozen(result.document.clips[0]));
    assert.deepEqual(inspectSceneAnimation(result.document).document,result.document);
    source.tracks[0].keyframes[0].value[0]=999;assert.equal(result.document.tracks[0].keyframes[0].value[0],0);
  }
  const empty=document();empty.clips=[];assert.deepEqual(copy(request(empty)).document.clips,[]);
});

test('every copied visual property preserves interpolation and matching whole or clip samples with new identities',()=>{
  for(const [property,first,last] of [['offset2d',[0,10],[20,-10]],['rotation2d',-720,720],['scale2d',[.1,1],[2,3]],['opacity',0,1],['spriteFrame2d',0,7]]) {
    const source=document(),track=source.tracks[property==='spriteFrame2d'?1:0];
    track.property=property;track.keyframes=[{atSeconds:0,value:first},{atSeconds:2,value:last}];
    for(const loop of [true,false]) for(const interpolation of property==='spriteFrame2d'?['step']:['step','linear']) {
      source.loop=loop;track.interpolation=interpolation;
      const copied=copy(request(source,track.id)).document;
      for(const time of [0,.25,.5,1,2,3,4]) {
        const original=sampleSceneAnimation(source,time).values.find(value=>value.trackId===track.id);
        const result=sampleSceneAnimation(copied,time).values;
        assert.deepEqual(result.slice(0,-1),sampleSceneAnimation(source,time).values);
        assert.deepEqual(result.at(-1),{...original,trackId:id(98),instanceId:id(99)});
      }
      for(const clip of source.clips) for(const time of [0,.125,.5,2]) {
        const original=sampleSceneAnimationClip(source,clip.id,time).values.find(value=>value.trackId===track.id);
        assert.deepEqual(sampleSceneAnimationClip(copied,clip.id,time).values.at(-1),{...original,trackId:id(98),instanceId:id(99)});
      }
    }
  }
});

test('copy rejects missing sources track ID collisions and occupied target properties while retaining existing ID namespaces',()=>{
  const source=document();
  for(const options of [request(source,id(999)),request(source,id(2),id(99),id(2)),request(source,id(2),id(3)),request(source,id(6),id(3))]) {
    const before=structuredClone(options);assert.throws(()=>copy(options),{errorCode:'scene_animation_invalid'});assert.deepEqual(options,before);
  }
  // A clip identity is not a track identity; no World lookup is part of this pure operation.
  assert.equal(copy(request(source,id(2),id(999),id(4))).document.tracks.at(-1).id,id(4));
  const occupied=document();occupied.tracks[1].instanceId=id(99);
  assert.deepEqual(copy(request(occupied)).document,expectedDocument(request(occupied)));
  occupied.tracks[1]={...structuredClone(occupied.tracks[0]),id:id(6),instanceId:id(99)};
  assert.throws(()=>copy(request(occupied)),{errorCode:'scene_animation_invalid'});
});

test('copy accepts exact track and key budgets but rejects overflow without deleting merging or truncating',()=>{
  const trackBoundary=repeatedTracks(31,1),result=copy(request(trackBoundary,id(10),id(999),id(998))).document;
  assert.equal(result.tracks.length,32);assert.deepEqual(result.tracks.slice(0,-1),trackBoundary.tracks);
  const keyBoundary=repeatedTracks(7,64),keys=copy(request(keyBoundary,id(10),id(999),id(998))).document;
  assert.equal(keys.tracks.flatMap(track=>track.keyframes).length,512);assert.equal(keys.tracks.at(-1).keyframes.length,64);
  for(const source of [repeatedTracks(32,1),repeatedTracks(8,64),repeatedTracks(1,65)]) {
    const before=structuredClone(source);assert.throws(()=>copy(request(source,id(10),id(999),id(998))),{errorCode:'scene_animation_invalid'});assert.deepEqual(source,before);
  }
});

test('copy revalidates UTF-8 author bytes after cloning even when all count budgets fit',()=>{
  const source=byteLimitDocument(),options=request(source,id(10),id(999),id(998)),candidate=expectedDocument(options);
  assert.ok(encode.encode(JSON.stringify(source)).length<65536);assert.deepEqual(inspectSceneAnimation(source).document,source);
  assert.equal(candidate.tracks.length,32);assert.equal(candidate.tracks.flatMap(track=>track.keyframes).length,512);
  assert.ok(encode.encode(JSON.stringify(candidate)).length>65536);
  assert.throws(()=>copy(options),{errorCode:'scene_animation_invalid'});
  assert.equal(wasm(options).errorCode,'scene_animation_invalid');
});

test('copy validates all explicit IDs the complete source and exact request shapes',()=>{
  for(const field of ['sourceTrackId','targetInstanceId','newTrackId']) for(const value of [null,false,0,'','bad','ABCDEFAB-1111-4111-8111-111111111111']) {
    const options=request();options[field]=value;
    assert.throws(()=>copy(options),{errorCode:'scene_animation_invalid'});assert.equal(wasm(options).errorCode,'scene_animation_invalid');
  }
  for(const change of [d=>d.schemaVersion=4,d=>d.tracks=[],d=>d.loop=0,d=>d.tracks[0].keyframes[0].atSeconds=.1,
    d=>d.clips[0].endSeconds=3,d=>d.clips[0].name='',d=>d.extra=true]) {
    const source=document();change(source);assert.throws(()=>copy(request(source)),{errorCode:'scene_animation_invalid'});
  }
  for(const field of ['protocolVersion','operation','document','sourceTrackId','targetInstanceId','newTrackId']) {
    const options=request();delete options[field];assert.equal(wasm(options).errorCode,'studio_core_request_invalid');
    assert.throws(()=>dispatchStudioCoreSceneAnimation(options),{errorCode:'studio_core_request_invalid'});
  }
  for(const options of [{...request(),extra:true},{...request(),protocolVersion:2}]) assert.throws(()=>dispatchStudioCoreSceneAnimation(options),{errorCode:'studio_core_request_invalid'});
});

test('raw copy rejects duplicate decoded keys and wrapper refuses executable input before invoking it',()=>{
  const raw=JSON.stringify(request());
  for(const [from,to] of [['"sourceTrackId":','"sourceTrackId":null,"sourceTrackId":'],['"targetInstanceId":','"targetInstanceId":null,"targetInstanceId":'],
    ['"newTrackId":','"newTrackId":null,"newTrack\\u0049d":'],['"operation":','"operation":"sceneAnimation.inspect","operation":'],
    ['"atSeconds":0','"atSeconds":1,"atSeconds":0']]) assert.equal(wasm(raw.replace(from,to)).errorCode,'studio_core_request_invalid');
  for(const wire of ['\uFEFF'+raw,raw.replace(id(1),'\\uD800')]) assert.equal(wasm(wire).errorCode,'studio_core_request_invalid');
  let calls=0;
  for(const change of [d=>Object.defineProperty(d.tracks[0],'id',{enumerable:true,get(){calls++;return id(2);}}),
    d=>d.toJSON=()=>{calls++;return{};},d=>d.tracks[0].self=d,d=>delete d.tracks[0],d=>d.tracks[0].keyframes[0].value[0]=Infinity]) {
    const source=document();change(source);assert.throws(()=>copy(request(source)),{errorCode:'studio_core_request_invalid'});
  }
  const incoming=request();Object.defineProperty(incoming,'newTrackId',{enumerable:true,get(){calls++;return id(98);}});
  assert.throws(()=>dispatchStudioCoreSceneAnimation(incoming),{errorCode:'studio_core_request_invalid'});
  for(const invalid of [NaN,Infinity,undefined]) assert.throws(()=>copySceneAnimationTrack(document(),id(2),id(99),invalid),{errorCode:'studio_core_request_invalid'});
  assert.equal(calls,0);assert.equal(getStudioCoreMetadata().ready,true);
});

test('missing copy marker disables only this operation while old inspection retime and format markers retain authority',async()=>{
  for(const copyMarker of [null,0,2]) {
    const h=await bridge(null,{copyMarker});assert.equal(h.module.supportsStudioCoreSceneAnimationTrackCopy(),false);
    for(const version of [1,2,3]) assert.throws(()=>h.module.dispatchStudioCoreSceneAnimation(request(document(version))),{errorCode:'studio_core_unavailable'});
    assert.equal(h.calls(),0);assert.equal(h.module.getStudioCoreMetadata().ready,true);
    const source=document();assert.deepEqual(h.module.dispatchStudioCoreSceneAnimation({protocolVersion:1,operation:'sceneAnimation.inspect',document:source}),{document:source});
    assert.deepEqual(h.module.dispatchStudioCoreSceneAnimation({protocolVersion:1,operation:'sceneAnimation.retime',document:source,durationSeconds:4}),retimeSceneAnimation(source,4));
  }
  for(const capabilities of [{sprites:null},{clips:null}]) {
    const h=await bridge(null,capabilities);assert.equal(h.module.supportsStudioCoreSceneAnimationTrackCopy(),true);
    assert.throws(()=>h.module.dispatchStudioCoreSceneAnimation(request(document())),{errorCode:'studio_core_unavailable'});assert.equal(h.calls(),0);
    assert.deepEqual(h.module.dispatchStudioCoreSceneAnimation(request(document(1))),copy(request(document(1))));
  }
});

test('forged copy receipts cannot change original data or clone a different track channel identity or position',async()=>{
  for(const change of [r=>r.extra=true,r=>r.sceneAnimation.extra=true,r=>r.sceneAnimation.document.extra=true,
    r=>r.sceneAnimation.document.sceneObjectId=id(77),r=>r.sceneAnimation.document.durationSeconds=4,r=>r.sceneAnimation.document.loop=false,
    r=>r.sceneAnimation.document.tracks[0].keyframes[0].value=[5,6],r=>r.sceneAnimation.document.tracks[1].grid.columns=8,
    r=>r.sceneAnimation.document.clips.reverse(),r=>r.sceneAnimation.document.clips[0].name='renamed',r=>r.sceneAnimation.document.clips[0].startSeconds=.25,
    r=>r.sceneAnimation.document.tracks.pop(),r=>r.sceneAnimation.document.tracks.reverse(),r=>r.sceneAnimation.document.tracks.at(-1).id=id(88),
    r=>r.sceneAnimation.document.tracks.at(-1).instanceId=id(3),r=>r.sceneAnimation.document.tracks.at(-1).property='scale2d',
    r=>r.sceneAnimation.document.tracks.at(-1).interpolation='step',r=>r.sceneAnimation.document.tracks.at(-1).keyframes[1].atSeconds=.7,
    r=>r.sceneAnimation.document.tracks.at(-1).keyframes[1].value=[7,8],r=>{r.sceneAnimation.document.schemaVersion=2;delete r.sceneAnimation.document.clips;}]) {
    const h=await bridge(r=>{change(r);return r;});assert.throws(()=>h.module.dispatchStudioCoreSceneAnimation(request()),{errorCode:'studio_core_unavailable'});
    assert.equal(h.module.getStudioCoreMetadata().ready,false);
  }
  const sprite=await bridge(r=>{r.sceneAnimation.document.tracks.at(-1).grid.rows=1;return r;});
  assert.throws(()=>sprite.module.dispatchStudioCoreSceneAnimation(request(document(),id(6))),{errorCode:'studio_core_unavailable'});
});

test('forged success cannot bypass source admission channel conflicts IDs or post-copy budgets',async()=>{
  const malformed=document();malformed.clips[0].endSeconds=3;
  const cases=[request(document(),id(999)),request(document(),id(2),id(3)),request(document(),id(2),id(99),id(2)),request(document(),id(2),null),
    request(repeatedTracks(32,1),id(10),id(999),id(998)),request(repeatedTracks(8,64),id(10),id(999),id(998)),
    request(byteLimitDocument(),id(10),id(999),id(998)),request(malformed)];
  for(const options of cases) {
    const h=await bridge(()=>({protocolVersion:1,ok:true,sceneAnimation:{document:expectedDocument(options)}}));
    assert.throws(()=>h.module.dispatchStudioCoreSceneAnimation(options),{errorCode:'studio_core_unavailable'});
  }
  assert.equal(getStudioCoreMetadata().ready,true);
});

const nativePath=process.env.VIENTO_ANIMATION_CORE_NATIVE;
test('native CLI and real WASM agree on copies formats count and byte budgets duplicate keys and failure recovery',{skip:!nativePath},async()=>{
  const inputs=[];
  for(const version of [1,2,3]) for(const source of version===1?[id(2)]:[id(2),id(6)]) inputs.push(request(document(version),source));
  inputs.push(request(document(),id(999)),request(document(),id(2),id(3)),request(document(),id(2),id(99),id(2)),request(document(),id(2),id(99),id(4)));
  for(const source of [repeatedTracks(31,1),repeatedTracks(32,1),repeatedTracks(7,64),repeatedTracks(8,64),repeatedTracks(1,65),byteLimitDocument()]) inputs.push(request(source,id(10),id(999),id(998)));
  const copied=copy(request()).document;
  for(const timeSeconds of [0,.5,1,2,3]) inputs.push({protocolVersion:1,operation:'sceneAnimation.sample',document:copied,timeSeconds});
  const wires=inputs.map(value=>JSON.stringify(value));wires.push(wires[0].replace('"newTrackId":','"newTrackId":null,"newTrackId":'),'\uFEFF'+wires[0],wires[0]);
  const result=await new Promise((resolve,reject)=>{
    const child=spawn(nativePath,[],{stdio:['pipe','pipe','pipe']});let stdout='',stderr='';const timer=setTimeout(()=>child.kill('SIGKILL'),10000);
    child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');child.stdout.on('data',chunk=>stdout+=chunk);child.stderr.on('data',chunk=>stderr+=chunk);
    child.on('error',error=>{clearTimeout(timer);reject(error);});child.on('close',(status,signal)=>{clearTimeout(timer);resolve({status,signal,stdout,stderr});});child.stdin.end(wires.join('\n')+'\n');
  });
  assert.equal(result.status,0,result.stderr);assert.equal(result.signal,null);assert.deepEqual(result.stdout.trim().split('\n').map(JSON.parse),wires.map(wasm));
});
