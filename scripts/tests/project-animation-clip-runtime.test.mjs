import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { advanceProjectAnimationTransport } from '../../engine/project-animation-transport.mjs';
import { animationProject, animationReturnTrip, animationCommand } from './helpers/project-animation-command-fixture.mjs';
import { createProjectRuntimeEventReader } from '../../engine/project-runtime-events.mjs';
import { createProjectRuntimeObservation, queryProjectRuntimeObservation } from '../../engine/project-runtime-query.mjs';
import { createProjectAnimationCommands, validateProjectAnimationCommandsSnapshot } from '../../engine/project-animation-commands.mjs';
import { clipProject, clipReturnTrip, clipCommand, clipFrame } from './helpers/project-animation-clip-command-fixture.mjs';
import { animationReady } from './helpers/project-animation-command-fixture.mjs';
import { enterScene, readyScene, runtimeId } from './helpers/project-runtime-fixture.mjs';
const push = (reader, frames) => reader.push(frames.map(f => 'VIENTO_PROJECT:' + JSON.stringify(f) + '\n').join(''));
function running() {
  const plan=clipProject(), reader=createProjectRuntimeEventReader(plan,{protocolVersion:6});
  push(reader,clipReturnTrip(plan).slice(0,3)); return {plan,reader,scene:plan.scenes[0]};
}
function reject(reader,frame) {
  const before=reader.animationCommands, events=reader.events.length, diagnostics=reader.diagnostics.length;
  assert.deepEqual(push(reader,[frame]),[]); assert.deepEqual(reader.animationCommands,before);
  assert.equal(reader.events.length,events); assert.equal(reader.diagnostics.length,diagnostics+1);
}
test('protocol6 shares Rust clip selection, local seek, replay, whole selection and fresh scene visit rules',()=>{
  const plan=clipProject(), frames=clipReturnTrip(plan), reader=createProjectRuntimeEventReader(plan,{protocolVersion:6,expectedTotalSeconds:.8});
  assert.equal(push(reader,frames).length,frames.length); assert.deepEqual(reader.finish().diagnostics,[]);
  const entries=reader.animationCommands.entries;
  assert.equal(entries.length,14); assert.equal(entries[0].clip.id,plan.scenes[0].animation.document.clips[0].id);
  assert.equal(entries[0].clip.source.propertyPath,'/clips/0'); assert.equal(entries[0].animation.source.propertyPath,'');
  assert.equal(entries[5].clip.source.propertyPath,'/clips/1'); assert.equal(entries[9].clip,null);
  assert.equal(entries[11].state.clipId,null); assert.equal(entries[13].state.clipId,null);
  assert.ok(Math.abs(entries[2].state.positionSeconds-.25)<1e-12);
});
test('protocol6 rejects missing, foreign, extra and mismatched selection data without committing history',()=>{
  for(const mutate of [f=>delete f.state.clipId, f=>f.state.clipId=null, f=>f.command.clipId=runtimeId(999),
    f=>f.command.clipId='待机', f=>f.command.clipId=false, f=>f.command.positionSeconds=0,
    f=>f.state.positionSeconds=.2, f=>f.state.phase='playing', f=>f.state.timeSeconds=-1,
    f=>f.state.source={}, f=>f.protocol=5, f=>f.commandSequence=2, f=>f.command.action='playClip']) {
    const {reader,scene}=running(), id=scene.animation.document.clips[0].id;
    const frame=clipCommand(scene,1,1,{action:'select',clipId:id},.1,0,'paused',id);mutate(frame);reject(reader,frame);
    assert.equal(push(reader,[clipCommand(scene,1,1,{action:'select',clipId:id},.1,0,'paused',id)]).length,1);
  }
});
test('selected range bounds seek and cannot change by forging a later receipt',()=>{
  const {reader,scene}=running(), id=scene.animation.document.clips[0].id;
  push(reader,[clipCommand(scene,1,1,{action:'select',clipId:id},0,0,'paused',id)]);
  reject(reader,clipCommand(scene,1,2,{action:'seek',positionSeconds:.8},0,.8,'paused',id));
  reject(reader,clipCommand(scene,1,2,{action:'play'},0,0,'playing',scene.animation.document.clips[1].id));
  assert.equal(push(reader,[clipCommand(scene,1,2,{action:'select',clipId:null},0,0,'paused'),
    clipCommand(scene,1,3,{action:'seek',positionSeconds:.8},0,.8,'paused')]).length,2);
});
test('mixed projects admit only null selection for old animation and protocol5 cannot execute schema3 clips',()=>{
  const plan=clipProject(), scene=plan.scenes[1];plan.entrySceneId=scene.scene.objectId;
  const reader=createProjectRuntimeEventReader(plan,{protocolVersion:6});
  push(reader,[clipFrame(animationReady(plan)),clipFrame(enterScene(scene,1)),clipFrame(readyScene(scene,1))]);
  reject(reader,clipCommand(scene,1,1,{action:'select',clipId:runtimeId(210)},0,0,'paused',runtimeId(210)));
  assert.equal(push(reader,[clipCommand(scene,1,1,{action:'select',clipId:null},.2,0,'paused')]).length,1);
  const old=createProjectRuntimeEventReader(clipProject(),{protocolVersion:5});
  push(old,clipReturnTrip(clipProject()).slice(0,3).map(f=>({...f,protocol:5})));
  const frame=clipCommand(plan.scenes[0],1,1,{action:'pause'},0,0,'paused');delete frame.state.clipId;frame.protocol=5;
  reject(old,frame);
});
test('protocol6 query validates declaration identity, local bounds, continuity and exact versioned shape',()=>{
  const plan=clipProject(),observer=createProjectRuntimeObservation(plan,{protocolVersion:6});
  for(const frame of clipReturnTrip(plan)) assert.equal(observer.push(frame),true);
  const view=observer.snapshot();assert.deepEqual(queryProjectRuntimeObservation(view),view);
  for(const mutate of [v=>v.project.protocolVersion=5, v=>delete v.project.animationCommands.entries[0].clip,
    v=>v.project.animationCommands.entries[0].clip.source.objectId=runtimeId(999),
    v=>v.project.animationCommands.entries[0].clip.source.sourcePath='other.json',
    v=>v.project.animationCommands.entries[0].clip.source.propertyPath='/clips/32',
    v=>v.project.animationCommands.entries[1].clip.name='changed',
    v=>v.project.animationCommands.entries[1].state.clipId=null,
    v=>v.project.animationCommands.entries[0].command.clipId=null,
    v=>v.project.animationCommands.entries[2].state.positionSeconds=.5,
    v=>v.project.animationCommands.entries[13].state.timeSeconds=.2]) {
    const changed=structuredClone(view);mutate(changed);assert.throws(()=>queryProjectRuntimeObservation(changed),{errorCode:'runtime_project_invalid'});
  }
  view.project.animationCommands.entries[0].clip.name='mutation';assert.notDeepEqual(view,observer.snapshot());
});
test('clip ledger is detached, accessor-safe, atomic on invalid source identity and bounded to 256 commands',()=>{
  const plan=clipProject(),observer=createProjectRuntimeObservation(plan,{protocolVersion:6});
  for(const frame of clipReturnTrip(plan))observer.push(frame);
  const entry=observer.snapshot().project.animationCommands.entries[0],ledger=createProjectAnimationCommands({protocolVersion:6});
  let invoked=0;assert.throws(()=>ledger.append({...entry,get clip(){invoked++;return entry.clip;}}));assert.equal(invoked,0);
  ledger.append(entry);const changed=structuredClone(entry);changed.sequence=2;changed.clip.source.sourceRevision='sha256:'+'b'.repeat(64);
  assert.throws(()=>ledger.append(changed));assert.equal(ledger.sequence,1);
  for(let sequence=2;sequence<=256;sequence++)ledger.append({...entry,sequence});
  assert.throws(()=>ledger.append({...entry,sequence:257}));assert.equal(ledger.sequence,256);
  assert.deepEqual(validateProjectAnimationCommandsSnapshot(ledger.snapshot(),{protocolVersion:6}),ledger.snapshot());
  assert.throws(()=>validateProjectAnimationCommandsSnapshot(ledger.snapshot()));
});

test('both animation protocols reject coercible playheads before numeric tolerance without polluting receipts', () => {
  for (const protocolVersion of [5,6]) for (const position of ['0',null,false,true,[],[0],{},-.0000001]) {
    const plan = protocolVersion === 5 ? animationProject() : clipProject();
    const reader = createProjectRuntimeEventReader(plan,{protocolVersion});
    push(reader,(protocolVersion === 5 ? animationReturnTrip(plan) : clipReturnTrip(plan)).slice(0,3));
    const frame = protocolVersion === 5 ? animationCommand(plan.scenes[0],1,1,'pause',0,0,'paused')
      : clipCommand(plan.scenes[0],1,1,{action:'pause'},0,0,'paused');
    frame.state.positionSeconds=position; reject(reader,frame);
    frame.state.positionSeconds=0; assert.equal(push(reader,[frame]).length,1);
  }
});
test('transport bridge refuses extra document overrides and executable argument fields before reading them', () => {
  const animation=animationProject().scenes[0].animation, input={state:null,timeSeconds:2,command:{action:'pause'}};
  for(const protocolVersion of [5,6]) {
    assert.throws(()=>advanceProjectAnimationTransport(animation,protocolVersion,{...input,document:{...animation.document,durationSeconds:5}}),{errorCode:'runtime_project_invalid'});
    let reads=0;assert.throws(()=>advanceProjectAnimationTransport(animation,protocolVersion,{...input,get state(){reads++;return null;}}));assert.equal(reads,0);
    const valid=advanceProjectAnimationTransport(animation,protocolVersion,input);assert.equal(valid.positionSeconds,1);
  }
});
