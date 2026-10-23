import test from 'node:test';
import assert from 'node:assert/strict';
import '../adapters/node-studio-core.mjs';
import { createProjectRuntimeEventReader } from '../../engine/project-runtime-events.mjs';
import { createProjectRuntimeObservation, queryProjectRuntimeObservation } from '../../engine/project-runtime-query.mjs';
import { createProjectAudioCommands } from '../../engine/project-audio-commands.mjs';
import { createProjectEventBus } from '../../engine/project-event-bus.mjs';
import { createProjectSharedState } from '../../engine/project-shared-state.mjs';
import { copyProjectEventObservationData } from '../../engine/project-runtime-contracts.mjs';
import { querySceneRuntimeObservation } from '../../engine/scene-runtime-query.mjs';
import { runtimeId, enterScene, readyScene, exitScene, sceneFrame, projectLine } from './helpers/project-runtime-fixture.mjs';
import { eventProject, eventReturnTrip, publication, delivery } from './helpers/project-event-bus-fixture.mjs';
import { stateFrame } from './helpers/project-shared-state-fixture.mjs';
import { audioProject, audioFrame, audioProjectReady, audioProjectFinished, audioReady, audioCues, audioFinished, audioCommand, audioReceipt, audioReturnTrip } from './helpers/project-audio-command-fixture.mjs';
const push = (reader, frames) => reader.push(frames.map(projectLine).join(''));
const apply = (observer, frames) => frames.forEach(frame => assert.equal(observer.push(frame), true, JSON.stringify(frame)));
function running(plan = audioProject()) {
  const a = plan.scenes[0], reader = createProjectRuntimeEventReader(plan, { protocolVersion: 4 });
  push(reader, [audioProjectReady(plan), audioFrame(enterScene(a, 1)), audioFrame(readyScene(a, 1)), audioReady(a, 1), ...audioCues(a, 1, 0)]); return { plan, a, reader };
}
function reject(reader, frame) {
  const before = reader.audioCommands, count = reader.events.length, diagnostics = reader.diagnostics.length;
  assert.deepEqual(push(reader, [frame]), []); assert.deepEqual(reader.audioCommands, before); assert.equal(reader.events.length, count); assert.equal(reader.diagnostics.length, diagnostics + 1);
}
test('project protocol 4 retains legacy child audio while recording A→B→A command receipts and both sources', () => {
  const plan = audioProject(), reader = createProjectRuntimeEventReader(plan, { protocolVersion: 4, expectedTotalSeconds: 0.5 }), frames = audioReturnTrip(plan);
  assert.equal(push(reader, frames).length, frames.length); assert.deepEqual(reader.finish().diagnostics, []);
  assert.equal(reader.audioCommands.sequence, 6); assert.deepEqual(reader.audioCommands.entries.map(entry => entry.origin.visitIndex), [1, 1, 2, 2, 3, 3]);
  assert.ok(reader.events.filter(frame => frame.stream === 'audio').every(frame => frame.frame.protocol === 1));
  assert.equal(reader.audioCommands.entries[0].track.source.propertyPath, '/tracks/0'); assert.equal(reader.audioCommands.entries[0].origin.source.propertyPath, '/bindings/0');
});
test('an empty-cue declaration supports command-only tracks using the actual Rust audio core', () => {
  const plan = audioProject({ empty: true }), reader = createProjectRuntimeEventReader(plan, { protocolVersion: 4 });
  const frames = audioReturnTrip(plan); assert.equal(push(reader, frames).length, frames.length); assert.deepEqual(reader.finish().diagnostics, []);
  assert.equal(reader.events.filter(frame => frame.stream === 'audio' && frame.frame.event === 'command').length, 0); assert.equal(reader.audioCommands.sequence, 6);
});
test('protocol 4 is explicit and older project protocols do not silently accept audio command fields', () => {
  const plan = audioProject();
  for (const protocolVersion of [1, 2, 3]) {
    const reader = createProjectRuntimeEventReader(plan, { protocolVersion }); assert.equal(Object.hasOwn(reader, 'audioCommands'), false);
    assert.deepEqual(push(reader, [{ ...audioProjectReady(plan), protocol: protocolVersion }]), []);
    assert.equal(Object.hasOwn(createProjectRuntimeObservation(plan, { protocolVersion }).snapshot().project, 'audioCommands'), false);
  }
  const reader = createProjectRuntimeEventReader(plan, { protocolVersion: 4 }), missing = audioProjectReady(plan); delete missing.audioCommandSequence;
  reject(reader, missing); reject(reader, { ...audioProjectReady(plan), audioCommandSequence: 1 });
  const next = createProjectRuntimeEventReader(plan, { protocolVersion: 5 });
  assert.deepEqual(next.audioCommands, { sequence: 0, entries: [] });
  assert.throws(() => createProjectRuntimeEventReader(plan, { protocolVersion: 8 }));
});
test('commands require actor ready, audio ready and completion of due legacy cues', () => {
  const plan = audioProject(), a = plan.scenes[0], reader = createProjectRuntimeEventReader(plan, { protocolVersion: 4 }), command = audioCommand(a, 1, 1);
  reject(reader, command); push(reader, [audioProjectReady(plan), audioFrame(enterScene(a, 1))]); reject(reader, command);
  push(reader, [audioFrame(readyScene(a, 1))]); reject(reader, command); push(reader, [audioReady(a, 1)]); reject(reader, command);
  push(reader, audioCues(a, 1, 0)); assert.equal(push(reader, [command]).length, 1);
});
test('command readiness cannot be borrowed from a previous visit', () => {
  const plan = audioProject(), [a, b] = plan.scenes, { reader } = running(plan);
  push(reader, [audioCommand(a, 1, 1), audioFinished(a, 1, 0), audioFrame(exitScene(a, 1, 0, b)), audioFrame(enterScene(b, 2)), audioFrame(readyScene(b, 2))]);
  reject(reader, audioCommand(a, 1, 2)); reject(reader, audioCommand(b, 2, 2));
  push(reader, [audioReady(b, 2), ...audioCues(b, 2, 0), audioCommand(b, 2, 2)]); assert.equal(reader.audioCommands.sequence, 2);
});
test('frozen behavior, track and resource ownership cannot be forged or redirected through wire paths', () => {
  const { a, reader } = running();
  for (const mutate of [v => v.bindingId = runtimeId(100), v => v.instanceId = runtimeId(100), v => v.objectId = runtimeId(100),
    v => v.trackId = runtimeId(100), v => v.resourceId = runtimeId(100), v => v.visitIndex = 2,
    v => v.source = {}, v => v.track = {}, v => v.sourcePath = 'injected.json', v => v.sequence = 1]) {
    const command = audioCommand(a, 1, 1); mutate(command); reject(reader, command);
  }
  push(reader, [audioCommand(a, 1, 1)]); assert.equal(reader.audioCommands.sequence, 1);
});
test('command time is monotonic within a visit and cannot extend past the admitted audio finish or exit', () => {
  const { plan, a, reader } = running(); push(reader, [audioCommand(a, 1, 1, 'play', 0.25)]); reject(reader, audioCommand(a, 1, 2, 'stop', 0.2));
  push(reader, [audioFinished(a, 1, 0.125)]); reject(reader, audioCommand(a, 1, 2, 'stop', 0.25)); reject(reader, audioFrame(exitScene(a, 1, 0.125)));
  reject(reader, audioProjectFinished(plan, 1, 0.125, 1));
});
test('future cue admission cannot be followed by a dynamic command claiming an earlier local clock', () => {
  const plan = audioProject(), a = plan.scenes[0]; a.audio.document.cues[0].atSeconds = 0.25;
  const { reader } = running(plan); reject(reader, audioCommand(a, 1, 1, 'play', 0.25));
  push(reader, audioCues(a, 1, 0.25)); reject(reader, audioCommand(a, 1, 1, 'play', 0.125));
  assert.equal(push(reader, [audioCommand(a, 1, 1, 'play', 0.25)]).length, 1);
});
test('normal finish requires the final command count while cancellation invents no pending receipts', () => {
  const { plan, a, reader } = running(); push(reader, [audioCommand(a, 1, 1), audioFinished(a, 1, 0.5), audioFrame(exitScene(a, 1, 0.5))]);
  reject(reader, audioProjectFinished(plan, 1, 0.5, 0)); const missing = audioProjectFinished(plan, 1, 0.5, 1); delete missing.audioCommandSequence; reject(reader, missing);
  push(reader, [audioProjectFinished(plan, 1, 0.5, 1)]); reject(reader, audioCommand(a, 1, 2));
  const open = running(); assert.deepEqual(open.reader.finish().diagnostics, []); assert.deepEqual(open.reader.audioCommands, { sequence: 0, entries: [] });
});
test('protocol 4 keeps shared state and event FIFO features alongside audio receipts', () => {
  const { plan, a, reader } = running();
  push(reader, [audioFrame(stateFrame(a, 1, 1, 'heard', true)), audioFrame(publication(a, 1, 1, 'sound', true)), audioFrame(delivery(a, 1, 1, 1)), audioCommand(a, 1, 1),
    audioFinished(a, 1, 0.5), audioFrame(exitScene(a, 1, 0.5)), audioProjectFinished(plan, 1, 0.5, 1, 1, 1)]);
  assert.deepEqual(reader.finish().diagnostics, []); assert.equal(reader.sharedState.revision, 1); assert.equal(reader.projectEvents.sequence, 1); assert.equal(reader.audioCommands.sequence, 1);
});
test('observation filters only current actors and preserves historical command ownership and exact track range', () => {
  const plan = audioProject(), observer = createProjectRuntimeObservation(plan, { protocolVersion: 4 }); assert.deepEqual(queryProjectRuntimeObservation(observer.snapshot()), observer.snapshot());
  apply(observer, audioReturnTrip(plan)); const view = observer.snapshot(), selected = queryProjectRuntimeObservation(view, { instanceId: plan.scenes[0].actors[0].instanceId });
  assert.equal(selected.actors.length, 1); assert.deepEqual(selected.project, view.project); assert.equal(selected.project.audioCommands.entries[2].origin.sceneId, plan.scenes[1].scene.objectId);
  selected.project.audioCommands.entries[0].track.source.sourceRange.start = 99; assert.equal(observer.snapshot().project.audioCommands.entries[0].track.source.sourceRange.start, 20);
});
test('query rejects unknown visits, wrong scenes, future finished command time and unsafe protocol selectors', () => {
  const plan = audioProject(), observer = createProjectRuntimeObservation(plan, { protocolVersion: 4 }); apply(observer, audioReturnTrip(plan));
  for (const mutate of [v => delete v.project.audioCommands, v => v.project.protocolVersion = 3, v => v.project.audioCommands.sequence = 0,
    v => v.project.audioCommands.entries[5].origin.visitIndex = 4, v => v.project.audioCommands.entries[0].origin.sceneId = plan.scenes[1].scene.objectId,
    v => v.project.audioCommands.entries[5].timeSeconds = 0.01]) {
    const view = observer.snapshot(); mutate(view); assert.throws(() => queryProjectRuntimeObservation(view), { errorCode: 'runtime_project_invalid' });
  }
  let calls = 0; for (const key of ['project', 'protocolVersion']) { const view = observer.snapshot(), target = key === 'project' ? view : view.project;
    Object.defineProperty(target, key, { enumerable: true, get() { calls++; return 4; } }); assert.throws(() => queryProjectRuntimeObservation(view)); }
  assert.equal(calls, 0);
});
test('protocol 4 admits maximum event, state, child and 256 dual-source command DTOs together under its own bound', () => {
  const plan = audioProject({ empty: true }), a = plan.scenes[0], observer = createProjectRuntimeObservation(plan, { protocolVersion: 4 });
  apply(observer, [audioProjectReady(plan), audioFrame(enterScene(a, 1)), audioFrame(readyScene(a, 1)), audioReady(a, 1)]);
  const receipt = audioReceipt(a), sources = [receipt.origin.source, receipt.track.source];
  for (const source of sources) { source.sourcePath = 'd/' + 'x'.repeat(4094); source.propertyPath = '/' + 'p'.repeat(4095);
    source.sourceRange = { start: 0, end: 1, encoding: 'utf-16', propertyPath: '/' + 'r'.repeat(4095), exact: true }; }
  const audio = createProjectAudioCommands(); for (let sequence = 1; sequence <= 256; sequence++) audio.append({ ...receipt, sequence });
  const events = createProjectEventBus(); for (let sequence = 1; sequence <= 128; sequence++) {
    const recipients = sequence <= 16 ? Array.from({ length: 64 }, (_, index) => ({ subscriptionId: index + 1, origin: receipt.origin })) : [];
    events.publish({ sequence, name: 'A', value: 'x'.repeat(4095), origin: receipt.origin, recipients });
    for (const { subscriptionId } of recipients) events.deliver({ sequence, subscriptionId, status: 'handled', visitIndex: 1, sceneId: a.scene.objectId });
  }
  const state = createProjectSharedState(); for (let revision = 1; revision <= 64; revision++) state.apply({ revision, operation: 'set', key: 'K' + revision.toString().padStart(2, '0'), value: true, origin: receipt.origin });
  const view = observer.snapshot(); view.project.audioCommands = audio.snapshot(); view.project.events = events.snapshot(); view.project.sharedState = state.snapshot();
  const contributor = { ...receipt.track.source, role: 'definition' };
  for (const actor of view.actors) actor.source.contributors = Array.from({ length: 128 }, () => structuredClone(contributor));
  const { project, ...child } = view; assert.deepEqual(querySceneRuntimeObservation(child), child);
  assert.throws(() => copyProjectEventObservationData(view), { errorCode: 'runtime_project_invalid' });
  const result = queryProjectRuntimeObservation(view); assert.deepEqual(result, view); result.project.audioCommands.entries[0].track.source.propertyPath = '/changed';
  assert.equal(view.project.audioCommands.entries[0].track.source.propertyPath.length, 4096);
});

test('protocol 4 projects without audio keep event/state features and reject commands without an audio stream', () => {
  const plan = eventProject(), frames = eventReturnTrip(plan).map(audioFrame);
  frames[0].audioCommandSequence = 0; frames.at(-1).audioCommandSequence = 0;
  const observer = createProjectRuntimeObservation(plan, { protocolVersion: 4 }); apply(observer, frames);
  const view = queryProjectRuntimeObservation(observer.snapshot()); assert.equal(view.project.events.sequence, 4);
  assert.deepEqual(view.project.audioCommands, { sequence: 0, entries: [] });
  const reader = createProjectRuntimeEventReader(plan, { protocolVersion: 4 }); push(reader, frames.slice(0, 3));
  const foreign = audioCommand(audioProject().scenes[0], 1, 1); reject(reader, foreign);
});

test('an admitted audio or behavior failure forbids later dynamic audio receipts', () => {
  for (const stream of ['audio', 'runtime']) {
    const { a, reader } = running(), track = a.audio.document.tracks[0], binding = a.behaviors.bindings[0];
    const diagnostic = stream === 'audio' ? { protocol: 1, event: 'diagnostic', severity: 'error', code: 'runtime_audio_failed', message: 'Device failed.', trackId: track.id, resourceId: track.resourceId }
      : { protocol: 3, event: 'diagnostic', severity: 'error', code: 'runtime_behavior_event_callback', message: 'Callback failed.', bindingId: binding.bindingId, instanceId: binding.instanceId, objectId: binding.objectId };
    assert.equal(push(reader, [audioFrame(sceneFrame(a, 1, diagnostic, stream))]).length, 1);
    assert.ok(reader.diagnostics.length); reject(reader, audioCommand(a, 1, 1));
  }
});
