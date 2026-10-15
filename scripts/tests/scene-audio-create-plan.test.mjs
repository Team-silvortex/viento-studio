import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSceneAudioCreationDraft } from '../../engine/scene-audio-create-plan.mjs';
import { id } from './helpers/world-audio-create-pure-fixture.mjs';
const input=(count=2)=>({sceneObjectId:id(1),tracks:Array.from({length:count},(_,index)=>({trackId:id(10+index),cueId:id(30+index),resourceId:id(2+index%2),role:index?'effect':'music',volume:index?1:0,loop:index===0,atSeconds:index*.25}))});
const rejected=value=>{const r=createSceneAudioCreationDraft(value);assert.equal(r.ok,false);assert.equal(r.content,null);assert.deepEqual(r.resourceIds,[]);assert.equal(r.diagnostics[0].code,'build_audio_invalid');return r;};
test('allocated tracks create native-validated initial play cues and sorted deduplicated dependencies',()=>{const value=input(3),before=structuredClone(value),r=createSceneAudioCreationDraft(value),d=JSON.parse(r.content);assert.equal(r.ok,true);assert.deepEqual(value,before);assert.deepEqual(r.resourceIds,[id(2),id(3)]);assert.deepEqual(d.tracks.map(t=>t.id),value.tracks.map(t=>t.trackId));assert.deepEqual(d.cues.map(c=>[c.id,c.action,c.atSeconds]),value.tracks.map(t=>[t.cueId,'play',t.atSeconds]));assert.equal(d.tracks[0].volume,0);assert.equal(d.tracks[1].loop,false);assert.deepEqual(createSceneAudioCreationDraft(value),r);assert.ok(Object.isFrozen(r)&&Object.isFrozen(r.resourceIds));});
test('native cue ordering stays stable while track order and identities remain author supplied',()=>{const v=input(3);v.tracks[0].atSeconds=2;v.tracks[1].atSeconds=0;v.tracks[2].atSeconds=2;const d=JSON.parse(createSceneAudioCreationDraft(v).content);assert.deepEqual(d.tracks.map(t=>t.id),v.tracks.map(t=>t.trackId));assert.deepEqual(d.cues.map(c=>c.id),[id(31),id(30),id(32)]);});
test('one through sixteen complete tracks reuse Rust format limits and values without coercion',()=>{assert.equal(createSceneAudioCreationDraft(input(1)).ok,true);assert.equal(createSceneAudioCreationDraft(input(16)).ok,true);rejected(input(0));rejected(input(17));for(const[k,v]of [['role','voice'],['volume',1.1],['volume',NaN],['loop','false'],['atSeconds',-1],['atSeconds',60.1],['trackId','bad'],['cueId',id(30)],['resourceId',null]]){const x=input();x.tracks[1][k]=v;rejected(x);}});
test('exact transport data rejects hidden fields getters sparse collections and serializer execution',()=>{let calls=0;for(const field of ['sceneObjectId','tracks']){const v=input();delete v[field];rejected(v);}for(const field of Object.keys(input().tracks[0])){const v=input();delete v.tracks[0][field];rejected(v);}const a=input();a.extra=1;const b=input();b.tracks[0].extra=1;const c=input();delete c.tracks[0];const d=input();Object.defineProperty(d.tracks[0],'volume',{enumerable:true,get(){calls++;return 1;}});const e=input();Object.defineProperty(e.tracks,'0',{enumerable:true,get(){calls++;return input().tracks[0];}});const f=Object.assign(Object.create({toJSON(){calls++;return input();}}),input());for(const v of [a,b,c,d,e,f,null])rejected(v);assert.equal(calls,0);});

test('explicit timeline intent preserves the exact legacy author bytes and dependency list', () => {
  const legacy = input(3), explicit = structuredClone(legacy);
  for (const row of explicit.tracks) row.startMode = 'timeline';
  assert.deepEqual(createSceneAudioCreationDraft(explicit), createSceneAudioCreationDraft(legacy));
});

test('behavior-only intent creates zero cues while retaining every bounded track and resource', () => {
  for (const count of [1, 16]) {
    const value = input(count);
    for (const row of value.tracks) { row.startMode = 'behavior'; delete row.atSeconds; }
    const before = structuredClone(value), result = createSceneAudioCreationDraft(value);
    assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
    const document = JSON.parse(result.content);
    assert.deepEqual(value, before); assert.equal(document.tracks.length, count); assert.deepEqual(document.cues, []);
    assert.deepEqual(result.resourceIds, count === 1 ? [id(2)] : [id(2), id(3)]);
    assert.deepEqual(document.tracks.map(track => track.id), value.tracks.map(row => row.trackId));
    assert.ok(document.tracks.every(track => !Object.hasOwn(track, 'startMode') && !Object.hasOwn(track, 'cueId')));
    assert.equal(document.schemaVersion, 1); assert.ok(Object.isFrozen(result));
  }
  const overflow = input(17); for (const row of overflow.tracks) { row.startMode = 'behavior'; delete row.atSeconds; } rejected(overflow);
});

test('mixed startup modes preserve track order and native stable ordering of retained timeline cues', () => {
  const value = input(5);
  value.tracks[0].atSeconds = 2; value.tracks[2].atSeconds = 0; value.tracks[4].atSeconds = 2;
  for (const index of [1, 3]) { value.tracks[index].startMode = 'behavior'; delete value.tracks[index].atSeconds; }
  const result = createSceneAudioCreationDraft(value), document = JSON.parse(result.content);
  assert.equal(result.ok, true); assert.deepEqual(document.tracks.map(track => track.id), value.tracks.map(row => row.trackId));
  assert.deepEqual(document.cues.map(cue => cue.id), [id(32), id(30), id(34)]);
  assert.deepEqual(document.cues.map(cue => cue.atSeconds), [0, 2, 2]);
  assert.deepEqual(result.resourceIds, [id(2), id(3)]);
});

test('startup mode is exact descriptor-safe intent and behavior does not accept a hidden time field', () => {
  for (const startMode of ['', 'auto', 'Timeline', null, undefined, false, 0, {}, []]) {
    const value = input(); value.tracks[0].startMode = startMode; rejected(value);
  }
  const behavior = input(); behavior.tracks[0].startMode = 'behavior'; rejected(behavior);
  delete behavior.tracks[0].atSeconds; assert.equal(createSceneAudioCreationDraft(behavior).ok, true);
  let calls = 0;
  for (const descriptor of [
    { enumerable: true, get() { calls++; return 'behavior'; } },
    { enumerable: false, value: 'behavior' },
  ]) { const value = input(); Object.defineProperty(value.tracks[0], 'startMode', descriptor); rejected(value); }
  const hiddenTime = structuredClone(behavior);
  Object.defineProperty(hiddenTime.tracks[0], 'atSeconds', { enumerable: true, get() { calls++; return 0; } }); rejected(hiddenTime);
  assert.equal(calls, 0);
});

test('behavior startup preserves native identity uniqueness and value validation without coercion', () => {
  for (const [key, bad] of [['cueId', id(31)], ['cueId', 'bad'], ['trackId', id(11)], ['resourceId', null], ['volume', NaN], ['role', 'voice'], ['loop', 'false']]) {
    const value = input(); value.tracks[0].startMode = 'behavior'; delete value.tracks[0].atSeconds;
    value.tracks[0][key] = bad; rejected(value);
  }
  const both = input(); for (const row of both.tracks) { row.startMode = 'behavior'; delete row.atSeconds; }
  both.tracks[1].cueId = both.tracks[0].cueId; rejected(both);
  const value = input(); value.tracks[0].startMode = 'timeline'; delete value.tracks[0].atSeconds; rejected(value);
});
