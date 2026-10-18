import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { captureSceneAnimationVisualFrame } from '../../engine/scene-animation-visual-frame.mjs';
import { sampleSceneAnimation } from '../../engine/scene-animation-core.mjs';
const id = n => `45454545-4545-4545-8545-${String(n).padStart(12, '0')}`;
const actors = [{ instanceId: id(1) }, { instanceId: id(2) }];
const sample = () => ({ timeSeconds: 1, localTimeSeconds: 1, finished: false, values: [
  { trackId: id(10), instanceId: id(1), property: 'offset2d', value: [20, -10] },
  { trackId: id(11), instanceId: id(1), property: 'rotation2d', value: 90 },
  { trackId: id(12), instanceId: id(1), property: 'scale2d', value: [2, .5] },
  { trackId: id(13), instanceId: id(1), property: 'opacity', value: .25 },
] });
test('visual frame combines all sampled channels, detaches vectors and leaves untargeted actors implicit', () => {
  const input = sample(), frame = captureSceneAnimationVisualFrame(actors, input);
  assert.deepEqual(frame, [{ instanceId: id(1), offset2d: [20,-10], rotation2d:90, scale2d:[2,.5], opacity:.25 }]);
  input.values[0].value[0] = 500; assert.equal(frame[0].offset2d[0],20);
  assert.ok(Object.isFrozen(frame) && Object.isFrozen(frame[0]) && Object.isFrozen(frame[0].offset2d));
  assert.deepEqual(actors,[{instanceId:id(1)},{instanceId:id(2)}]);
});
test('partial channels inherit visual identity values instead of last-frame state', () => {
  const input = sample(); input.values = [input.values[3]];
  assert.deepEqual(captureSceneAnimationVisualFrame(actors,input),[{instanceId:id(1),offset2d:[0,0],rotation2d:0,scale2d:[1,1],opacity:.25}]);
});
test('visual frame consumes actual Rust boundary samples including zero opacity and loop time zero', () => {
  const document = {format:'viento-scene-animation',schemaVersion:1,sceneObjectId:id(99),durationSeconds:2,loop:true,
    tracks:[{id:id(10),instanceId:id(2),property:'opacity',interpolation:'linear',keyframes:[{atSeconds:0,value:0},{atSeconds:2,value:1}]}]};
  for(const [time,opacity] of [[0,0],[1,.5],[2,0],[86400,0]]) assert.equal(captureSceneAnimationVisualFrame(actors,sampleSceneAnimation(document,time))[0].opacity,opacity);
});
test('visual boundary rejects missing or duplicate identities/channels and nonfinite or unbounded drawing values', () => {
  const mutations=[s=>s.values[0].instanceId=id(999),s=>s.values[1].trackId=s.values[0].trackId,s=>s.values.push({...s.values[0],trackId:id(50)}),
    s=>s.values[0].value=[NaN,0],s=>s.values[0].value=[10001,0],s=>s.values[0].value=[0],s=>s.values[0].value=[0,0,0],
    s=>s.values[1].value=Infinity,s=>s.values[1].value=36001,s=>s.values[2].value=[0,1],s=>s.values[3].value=1.01,
    s=>s.values[0].property='position',s=>s.values=[],s=>s.values=Array(33).fill(s.values[0]),s=>s.localTimeSeconds=61,s=>s.timeSeconds=-1,
    s=>s.finished='false',s=>s.extra=true,s=>s.values[0].extra=true];
  for(const mutate of mutations){const s=sample();mutate(s);assert.throws(()=>captureSceneAnimationVisualFrame(actors,s),TypeError);}
  for(const members of [[],[{instanceId:'bad'}],[actors[0],actors[0]],[{objectId:id(1)}]])assert.throws(()=>captureSceneAnimationVisualFrame(members,sample()),TypeError);
});
test('sample capture refuses accessors, holes and inherited records without executing accessors', () => {
  let calls=0;
  for(const mutate of [s=>Object.defineProperty(s,'values',{get(){calls++;return []},enumerable:true}),
    s=>Object.defineProperty(s.values[0],'value',{get(){calls++;return [1,2]},enumerable:true}),
    s=>Object.defineProperty(s.values[0].value,'0',{get(){calls++;return 1},enumerable:true}),
    s=>delete s.values[0].value[0],s=>Object.setPrototypeOf(s,{extra:true}),s=>s.values.extra=true]) {
    const input=sample();mutate(input);assert.throws(()=>captureSceneAnimationVisualFrame(actors,input),TypeError);
  }
  assert.equal(calls,0);
});

test('actor identity capture uses only dense own data without calling getters or overridden map', () => {
  let calls = 0;
  for (const mutate of [
    members => Object.defineProperty(members[0], 'instanceId', { enumerable: true, get() { calls++; return id(1); } }),
    members => members[0] = Object.create({ instanceId: id(1) }),
    members => Object.defineProperty(members, '0', { enumerable: true, get() { calls++; return actors[0]; } }),
    members => members.map = () => { calls++; return actors; },
    members => delete members[0],
  ]) {
    const members = structuredClone(actors); mutate(members);
    assert.throws(() => captureSceneAnimationVisualFrame(members, sample()), TypeError);
  }
  const members = structuredClone(actors);
  Object.defineProperty(members[0], 'image', { enumerable: true, get() { calls++; throw Error('unrelated renderer field'); } });
  assert.equal(captureSceneAnimationVisualFrame(members, sample())[0].instanceId, id(1));
  assert.equal(calls, 0);
});
