import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createProjectRuntimeEventReader } from '../../engine/project-runtime-events.mjs';
import { createProjectRuntimeObservation, queryProjectRuntimeObservation } from '../../engine/project-runtime-query.mjs';
import { createProjectAnimationCommands, validateProjectAnimationCommandsSnapshot } from '../../engine/project-animation-commands.mjs';
import { animationProject, animationReady, animationCommand, animationReturnTrip, animationFrame } from './helpers/project-animation-command-fixture.mjs';
import { audioProject, audioReady, audioFinished } from './helpers/project-audio-command-fixture.mjs';
import { enterScene, readyScene, exitScene, runtimeId } from './helpers/project-runtime-fixture.mjs';
const push = (reader, frames) => reader.push(frames.map(frame => 'VIENTO_PROJECT:' + JSON.stringify(frame) + '\n').join(''));
function running() {
  const plan = animationProject(), reader = createProjectRuntimeEventReader(plan, { protocolVersion: 5 });
  push(reader, animationReturnTrip(plan).slice(0, 3)); return { plan, reader, a: plan.scenes[0] };
}
function reject(reader, frame) {
  const before = reader.animationCommands, count = reader.events.length, diagnostics = reader.diagnostics.length;
  assert.deepEqual(push(reader, [frame]), []); assert.deepEqual(reader.animationCommands, before);
  assert.equal(reader.events.length, count); assert.equal(reader.diagnostics.length, diagnostics + 1);
}
test('protocol5 verifies Rust transport across seek, completion replay, scene switch and fresh revisit', () => {
  const plan = animationProject(), frames = animationReturnTrip(plan), reader = createProjectRuntimeEventReader(plan, { protocolVersion: 5, expectedTotalSeconds: .5 });
  assert.equal(push(reader, frames).length, frames.length); assert.deepEqual(reader.finish().diagnostics, []);
  assert.equal(reader.animationCommands.sequence, 8); assert.deepEqual(reader.animationCommands.entries.map(e => e.origin.visitIndex), [1,1,1,1,1,2,3,3]);
  assert.equal(reader.animationCommands.entries[0].animation.source.objectId, plan.scenes[0].animation.manifest.objectId);
  assert.deepEqual(reader.audioCommands, { sequence: 0, entries: [] });
});
test('protocol5 rejects forged transitions, identities, sequence, range, phase, extra keys and omitted command without mutation', () => {
  for (const mutate of [f => f.state.positionSeconds = .3, f => f.state.phase = 'playing', f => f.state.sceneObjectId = runtimeId(999),
    f => f.state.timeSeconds = -.25, f => f.command.action = 'resume', f => f.command.positionSeconds = 0,
    f => f.bindingId = runtimeId(999), f => f.instanceId = runtimeId(999), f => f.visitIndex = 2,
    f => f.commandSequence = 2, f => f.state.extra = 0, f => f.extra = 0, f => delete f.command, f => f.command = null]) {
    const { reader, a } = running(), frame = animationCommand(a, 1, 1, 'pause', .25, .25, 'paused'); mutate(frame); reject(reader, frame);
    assert.equal(push(reader, [animationCommand(a, 1, 1, 'pause', .25, .25, 'paused')]).length, 1);
  }
});
test('protocol5 rejects commands before ready, after diagnostics, without animation, and from revoked visits', () => {
  const plan = animationProject(), a = plan.scenes[0], reader = createProjectRuntimeEventReader(plan, { protocolVersion: 5 });
  push(reader, [animationReady(plan), animationFrame(enterScene(a, 1))]); reject(reader, animationCommand(a, 1, 1, 'stop', 0, 0, 'stopped'));
  push(reader, [animationFrame(readyScene(a, 1)), animationFrame(exitScene(a, 1, 0, plan.scenes[1])), animationFrame(enterScene(plan.scenes[1], 2)), animationFrame(readyScene(plan.scenes[1], 2))]);
  reject(reader, animationCommand(a, 1, 1, 'stop', 0, 0, 'stopped'));
  const bad = running(); const binding = bad.a.behaviors.bindings[0];
  push(bad.reader, [{ protocol: 5, event: 'scene-event', visitIndex: 1, sceneId: bad.a.scene.objectId, stream: 'runtime', frame: {
    protocol: 3, event: 'diagnostic', severity: 'error', code: 'runtime_behavior_animation_invalid', message: 'invalid',
    bindingId: binding.bindingId, instanceId: binding.instanceId, objectId: binding.objectId } }]);
  reject(bad.reader, animationCommand(bad.a, 1, 1, 'stop', 0, 0, 'stopped'));
  delete plan.scenes[0].animation; plan.scenes[0].requiredCapabilities = plan.scenes[0].requiredCapabilities.filter(c => c !== 'animation.visual2d');
  const none = createProjectRuntimeEventReader(plan, { protocolVersion: 5 }); push(none, [animationReady(plan), animationFrame(enterScene(a, 1)), animationFrame(readyScene(a, 1))]);
  reject(none, animationCommand(a, 1, 1, 'stop', 0, 0, 'stopped'));
});
test('receipt clock is monotonic per visit and may not exceed its accepted exit', () => {
  const { reader, a } = running(); push(reader, [animationCommand(a, 1, 1, 'pause', .25, .25, 'paused')]);
  reject(reader, animationCommand(a, 1, 2, 'stop', .2, 0, 'stopped'));
  reject(reader, animationFrame(exitScene(a, 1, .2)));
  assert.equal(push(reader, [animationFrame(exitScene(a, 1, .25))]).length, 1);
});
test('legacy protocols retain their exact DTO shapes and protocol5 counts are required', () => {
  const plan = animationProject();
  for (const protocolVersion of [1,2,3,4]) {
    const reader = createProjectRuntimeEventReader(plan, { protocolVersion }); assert.equal(Object.hasOwn(reader, 'animationCommands'), false);
    assert.equal(Object.hasOwn(createProjectRuntimeObservation(plan, { protocolVersion }).snapshot().project, 'animationCommands'), false);
  }
  const { reader, a } = running(); reject(reader, { ...animationCommand(a, 1, 1, 'stop', 0, 0, 'stopped'), protocol: 4 });
  const unopened = createProjectRuntimeEventReader(plan, { protocolVersion: 5 }), ready = animationReady(plan); delete ready.animationCommandSequence;
  reject(unopened, ready);
  const finish = running(), frames = animationReturnTrip(finish.plan); push(finish.reader, frames.slice(3, -1));
  reject(finish.reader, { ...frames.at(-1), animationCommandSequence: 7 }); assert.equal(push(finish.reader, [frames.at(-1)]).length, 1);
});
test('observation exposes detached bounded receipts, validates provenance and clears on a new run', () => {
  const plan = animationProject(), observer = createProjectRuntimeObservation(plan, { protocolVersion: 5 });
  for (const frame of animationReturnTrip(plan)) assert.equal(observer.push(frame), true);
  const view = observer.snapshot(); assert.deepEqual(queryProjectRuntimeObservation(view), view);
  for (const mutate of [v => delete v.project.animationCommands, v => v.project.protocolVersion = 4,
    v => v.project.animationCommands.entries[0].origin.visitIndex = 4, v => v.project.animationCommands.entries[0].state.timeSeconds = 1,
    v => v.project.animationCommands.entries[1].state.positionSeconds = .5, v => v.project.animationCommands.entries[0].animation.source.objectId = runtimeId(999),
    v => v.project.animationCommands.entries[4].animation.loop = true]) {
    const changed = structuredClone(view); mutate(changed); assert.throws(() => queryProjectRuntimeObservation(changed), { errorCode: 'runtime_project_invalid' });
  }
  view.project.animationCommands.entries[0].origin.source.sourcePath = 'changed.json'; assert.notDeepEqual(observer.snapshot(), view);
  assert.deepEqual(createProjectRuntimeObservation(plan, { protocolVersion: 5 }).snapshot().project.animationCommands, { sequence: 0, entries: [] });
});
test('receipt ledger rejects accessors, sparse arrays, mutable source identity and overflow atomically', () => {
  const plan = animationProject(), observer = createProjectRuntimeObservation(plan, { protocolVersion: 5 });
  for (const frame of animationReturnTrip(plan)) observer.push(frame);
  const entry = observer.snapshot().project.animationCommands.entries[0], ledger = createProjectAnimationCommands();
  let calls = 0; assert.throws(() => ledger.append({ ...entry, get state() { calls++; return entry.state; } })); assert.equal(calls, 0);
  for (let sequence = 1; sequence <= 256; sequence++) ledger.append({ ...entry, sequence });
  const before = ledger.snapshot(); assert.throws(() => ledger.append({ ...entry, sequence: 257 })); assert.deepEqual(ledger.snapshot(), before);
  assert.deepEqual(validateProjectAnimationCommandsSnapshot(before), before);
  const sparse = structuredClone(before); delete sparse.entries[2]; assert.throws(() => validateProjectAnimationCommandsSnapshot(sparse));
});

test('audio shutdown revokes animation receipts before the scene exit envelope arrives', () => {
  const plan = animationProject(), withAudio = audioProject({ empty: true });
  for (const [index, scene] of plan.scenes.entries()) {
    scene.audio = withAudio.scenes[index].audio; scene.resources = withAudio.scenes[index].resources;
    scene.requiredCapabilities = [...new Set([...scene.requiredCapabilities, ...withAudio.scenes[index].requiredCapabilities])].sort();
  }
  plan.resources = withAudio.resources; plan.requiredCapabilities = [...new Set(['project.scenes', ...plan.scenes.flatMap(s => s.requiredCapabilities)])].sort();
  const a = plan.scenes[0], reader = createProjectRuntimeEventReader(plan, { protocolVersion: 5 });
  push(reader, [animationReady(plan), animationFrame(enterScene(a, 1)), animationFrame(readyScene(a, 1)), animationFrame(audioReady(a, 1)), animationFrame(audioFinished(a, 1, 0))]);
  assert.equal(reader.diagnostics.length, 0);
  reject(reader, animationCommand(a, 1, 1, 'stop', 0, 0, 'stopped'));
  assert.equal(push(reader, [animationFrame(exitScene(a, 1, 0))]).length, 1);
});
