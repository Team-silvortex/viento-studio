import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { inspectSceneAudio, sampleSceneAudio } from '../../engine/scene-audio-core.mjs';
import { supportsStudioCoreSceneAudio, getStudioCoreMetadata, dispatchStudioCoreSceneAudio } from '../../engine/studio-core.mjs';
const bytes = await fs.readFile(new URL('../../engine/studio-core.wasm', import.meta.url));
const { instance: { exports: core } } = await WebAssembly.instantiate(bytes, {});
const id = n => `${n.toString(16).padStart(8, '0')}-1111-4111-8111-111111111111`;
const document = () => ({ format:'viento-scene-audio', schemaVersion:1, sceneObjectId:id(1), tracks:[{id:id(2),resourceId:id(3),role:'music',volume:.5,loop:true}], cues:[{id:id(4),trackId:id(2),atSeconds:0,action:'play'}] });
const request = (doc = document(), time) => ({protocolVersion:1,operation:time === undefined ? 'sceneAudio.inspect':'sceneAudio.sample',document:doc,...(time === undefined ? {}:{timeSeconds:time})});
function wasm(input) { const wire = new TextEncoder().encode(typeof input === 'string' ? input : JSON.stringify(input)), at=core.viento_core_input(wire.length)>>>0; new Uint8Array(core.memory.buffer,at,wire.length).set(wire); const out=core.viento_core_run()>>>0; return JSON.parse(new TextDecoder().decode(new Uint8Array(core.memory.buffer,out,core.viento_core_output_len()))); }

test('native audio capability returns a detached deeply frozen declaration without applying defaults', () => {
  assert.equal(core.viento_core_scene_audio_version(), 1); assert.equal(supportsStudioCoreSceneAudio(), true);
  const doc=document(), result=inspectSceneAudio(doc);assert.deepEqual(result,{document:doc,diagnostics:[]});
  assert.ok(Object.isFrozen(result)&&Object.isFrozen(result.document.tracks[0])&&Object.isFrozen(result.document.cues));
  doc.tracks[0].volume=0;assert.equal(result.document.tracks[0].volume,.5);
});
test('cue ordering is stable including equal zero and negative zero and does not mutate source', () => {
  const doc=document();doc.cues=[{id:id(4),trackId:id(2),atSeconds:2,action:'stop'},{id:id(5),trackId:id(2),atSeconds:0,action:'play'},{id:id(6),trackId:id(2),atSeconds:-0,action:'stop'},{id:id(7),trackId:id(2),atSeconds:2,action:'play'}];
  const before=JSON.stringify(doc), checked=inspectSceneAudio(doc); assert.equal(JSON.stringify(doc),before);assert.deepEqual(checked.document.cues.map(cue=>cue.id),[id(5),id(6),id(4),id(7)]);
  assert.equal(sampleSceneAudio(doc,0).states[0].status,'stopped'); const atTwo=sampleSceneAudio(doc,2);assert.equal(atTwo.states[0].status,'playing');assert.equal(atTwo.states[0].startedAtSeconds,2);assert.equal(atTwo.commands.at(-1).cueId,id(7));
});
test('play restarts and stop is idempotent while nonlooping sound never gains an invented duration', () => {
  const doc=document();doc.tracks[0].loop=false;doc.cues.push({id:id(5),trackId:id(2),atSeconds:1,action:'play'});
  assert.equal(sampleSceneAudio(doc,60).states[0].status,'playing');assert.equal(sampleSceneAudio(doc,60).states[0].startedAtSeconds,1);
  doc.cues.push(...[6,7].map(n=>({id:id(n),trackId:id(2),atSeconds:2,action:'stop'})));
  const result=sampleSceneAudio(doc,2);assert.equal(result.states[0].status,'stopped');assert.equal(result.states[0].startedAtSeconds,null);assert.equal(result.states[0].lastCueId,id(7));
  assert.equal(sampleSceneAudio(doc,.5).states[0].lastCueId,id(4));assert.ok(Object.isFrozen(result.commands[0])&&Object.isFrozen(result.states[0]));
});
test('track states preserve declaration order and same resources remain distinct playback voices', () => {
  const doc=document();doc.tracks.push({id:id(5),resourceId:id(3),role:'effect',volume:0,loop:false});doc.cues[0].atSeconds=1;
  const sample=sampleSceneAudio(doc,0);assert.deepEqual(sample.commands,[]);assert.deepEqual(sample.states.map(s=>[s.trackId,s.status,s.lastCueId]),[[id(2),'stopped',null],[id(5),'stopped',null]]);
  doc.cues.push({id:id(6),trackId:id(5),atSeconds:0,action:'play'});assert.equal(sampleSceneAudio(doc,0).commands[0].volume,0);assert.equal(sampleSceneAudio(doc,0).states[1].status,'playing');
});
test('all manifest fields are mandatory exact typed and bounded without reference repair', () => {
  for (const container of ['', 'tracks', 'cues']) {
    const base=document(), object=container ? base[container][0] : base;
    for(const key of Object.keys(object)){const doc=structuredClone(base);delete (container?doc[container][0]:doc)[key];assert.throws(()=>inspectSceneAudio(doc),{errorCode:'scene_audio_invalid'});}
    object.extra=true;assert.throws(()=>inspectSceneAudio(base),{errorCode:'scene_audio_invalid'});
  }
  const invalid=[d=>d.format='audio',d=>d.schemaVersion=2,d=>d.sceneObjectId='bad',d=>d.tracks[0].id=id(2).toUpperCase().replace('00000002','AAAAAAAA'),d=>d.tracks[0].role='voice',d=>d.tracks[0].loop='false',d=>d.tracks[0].volume=1.001,d=>d.tracks[0].volume=-.001,d=>d.cues[0].action='pause',d=>d.cues[0].atSeconds=60.001,d=>d.cues[0].atSeconds=-.1,d=>d.cues[0].trackId=id(99),d=>d.tracks.push(d.tracks[0]),d=>d.cues.push(d.cues[0]),d=>d.tracks=[]];
  for(const mutate of invalid){const doc=document();mutate(doc);assert.throws(()=>inspectSceneAudio(doc),{errorCode:'scene_audio_invalid'});}
  for(const time of [-1,60.1,'0',null])assert.throws(()=>sampleSceneAudio(document(),time),{errorCode:'scene_audio_invalid'});
  assert.equal(getStudioCoreMetadata().ready,true);
});
test('maximum bounded manifest preserves all 64 cue identities across 16 voices', () => {
  const doc=document();doc.tracks=Array.from({length:16},(_,n)=>({id:id(2+n),resourceId:id(40),role:'effect',volume:n===0?0:1,loop:false}));doc.cues=Array.from({length:64},(_,n)=>({id:id(100+n),trackId:id(2+n%16),atSeconds:60,action:'play'}));
  assert.equal(sampleSceneAudio(doc,59.9).commands.length,0);const result=sampleSceneAudio(doc,60);assert.equal(result.commands.length,64);assert.deepEqual(result.commands.map(c=>c.cueId),doc.cues.map(c=>c.id));assert.equal(result.states.length,16);
  const excess=structuredClone(doc);excess.tracks.push({...doc.tracks[0],id:id(99)});assert.throws(()=>inspectSceneAudio(excess),{errorCode:'scene_audio_invalid'});doc.cues.push({...doc.cues[0],id:id(999)});assert.throws(()=>inspectSceneAudio(doc),{errorCode:'scene_audio_invalid'});
});
test('raw WASM rejects escaped duplicate keys and JS boundary rejects hidden serialization', () => {
  const raw=JSON.stringify(request());for(const [from,to] of [['"protocolVersion":1','"protocolVersion":0,"protocolVersion":1'],['"document":','"document":null,"document":'],['"volume":0.5','"volume":0,"vol\\u0075me":0.5'],['"action":"play"','"action":"stop","action":"play"']]) assert.equal(wasm(raw.replace(from,to)).errorCode,'studio_core_request_invalid');
  let invoked=0;const getter=document();Object.defineProperty(getter.tracks[0],'volume',{enumerable:true,get(){invoked++;return 1;}});assert.throws(()=>inspectSceneAudio(getter),{errorCode:'studio_core_request_invalid'});assert.equal(invoked,0);
  for(const mutate of [d=>d.tracks[0].volume=NaN,d=>d.tracks[0].volume=Infinity,d=>d.tracks[0].volume=undefined,d=>delete d.cues[0],d=>d.toJSON=()=>({})]){const doc=document();mutate(doc);assert.throws(()=>inspectSceneAudio(doc),{errorCode:'studio_core_request_invalid'});}
  assert.throws(()=>dispatchStudioCoreSceneAudio({...request(),timeSeconds:0}),{errorCode:'studio_core_request_invalid'});
  assert.equal(getStudioCoreMetadata().ready,true);
});
test('native CLI and actual WASM agree on valid invalid and duplicate-key audio requests', {skip:!process.env.VIENTO_AUDIO_CORE_NATIVE}, () => {
  const doc=document();doc.cues.push({id:id(5),trackId:id(2),atSeconds:1,action:'stop'});
  const wires=[request(doc),request(doc,0),request(doc,1),request(doc,60),request({...doc,cues:[]}),request({...doc,cues:[]},60),request({...doc,extra:1}),request(doc,-1),{...request(doc),timeSeconds:0}].map(JSON.stringify);
  wires.push(wires[0].replace('"volume":0.5','"volume":0,"volume":0.5'));
  const native=spawnSync(process.env.VIENTO_AUDIO_CORE_NATIVE,[],{input:wires.join('\n')+'\n',encoding:'utf8'});assert.equal(native.status,0,native.stderr);assert.deepEqual(native.stdout.trim().split('\n').map(JSON.parse),wires.map(wasm));
});

test('empty timelines preserve declared tracks and never fabricate playback commands', () => {
  const doc=document();doc.cues=[];
  assert.deepEqual(inspectSceneAudio(doc).document,doc);
  for(const time of [0,.25,60]){
    const result=sampleSceneAudio(doc,time);assert.deepEqual(result.commands,[]);
    assert.equal(result.states[0].status,'stopped');assert.equal(result.states[0].startedAtSeconds,null);assert.equal(result.states[0].lastCueId,null);
    assert.equal(wasm(request(doc,time)).ok,true);
  }
});
