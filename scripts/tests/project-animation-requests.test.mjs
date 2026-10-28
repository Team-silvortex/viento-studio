import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createProjectAnimationRequestsReader, PROJECT_ANIMATION_REQUEST_PREFIX as prefix } from '../../engine/project-animation-requests.mjs';
import { createProjectExecutionFramesReader, PROJECT_EXECUTION_FRAME_PREFIX } from '../../engine/project-execution-frames.mjs';
import { createProjectExecutionClockReader, PROJECT_EXECUTION_CLOCK_PREFIX } from '../../engine/project-execution-clock.mjs';
import { createProjectRuntimeEventReader } from '../../engine/project-runtime-events.mjs';
import { completionProject, completionStart, completionCommand, completionRun } from './helpers/project-animation-completion-fixture.mjs';
import { runtimeId, enterScene, readyScene, sceneFrame, exitScene } from './helpers/project-runtime-fixture.mjs';

const clone = value => structuredClone(value), clock = (idleFrame = 0, physicsFrame = idleFrame) => ({ idleFrame, physicsFrame });
const wire = frame => prefix + JSON.stringify(frame) + '\n';
const business = (frame, index, position = clock()) => PROJECT_EXECUTION_FRAME_PREFIX + JSON.stringify({ protocol: 1, index, clock: position, frame }) + '\n';
const origin = (scene, visitIndex = 1, bindingIndex = 0) => {
  const { bindingId, instanceId, objectId } = scene.behaviors.bindings[bindingIndex];
  return { visitIndex, sceneId: scene.scene.objectId, bindingId, instanceId, objectId };
};
const accepted = (scene, requestId = 1, command = { action: 'stop' }, position = clock(), visitIndex = 1) =>
  ({ protocol: 1, event: 'accepted', requestId, clock: position, origin: origin(scene, visitIndex), target: { kind: 'scene' }, command });
const applied = (requestId, commandSequence, executionFrameIndex, position = clock()) =>
  ({ protocol: 1, event: 'applied', requestId, clock: position, commandSequence, executionFrameIndex });
const discarded = (requestId, position = clock()) => ({ protocol: 1, event: 'discarded', requestId, clock: position, reason: 'abort' });
const p11 = frame => ({ ...frame, protocol: 11, ...(['ready', 'finished'].includes(frame.event) ? { animationStateSequence: 0, animationStateEntrySequence: 0 } : {}) });
function fixture({ plan = completionProject(), protocolVersion = 7, onEvent, onClock, onFrames, transform, ...options } = {}) {
  const base = createProjectRuntimeEventReader(plan, { protocolVersion, retainedEvents: 1, onEvent });
  const scheduled = onClock ? createProjectExecutionClockReader({ runtimeReader: base, onSnapshot: onClock }) : base;
  const framed = createProjectExecutionFramesReader({ runtimeReader: scheduled, retainedFrames: 1, onSnapshot: onFrames });
  const value = createProjectAnimationRequestsReader(plan, { runtimeReader: transform ? transform(framed) : framed, protocolVersion, ...options });
  const f = { value, plan, scene: plan.scenes[0], base, framed, index: 0 };
  f.push = (frame, position = clock()) => value.push(business(frame, ++f.index, position));
  f.start = () => completionStart(plan).map(frame => protocolVersion === 11 ? p11(frame) : frame).forEach(frame => f.push(frame));
  f.command = (sequence, action = { action: 'stop' }, position = clock(), state = 'stopped', clipId = null, time = 0, playhead = 0) =>
    f.push(completionCommand(f.scene, 1, sequence, action, time, playhead, state, clipId), position);
  f.apply = (requestId, sequence = requestId, position = clock()) => value.push(wire(applied(requestId, sequence, f.index, position)));
  f.error = () => f.push({ ...sceneFrame(f.scene, 1, { protocol: 3, event: 'diagnostic', severity: 'error', code: 'runtime_behavior_animation_unavailable', message: 'Unavailable animation.' }), protocol: protocolVersion });
  f.end = commands => {
    f.push({ ...exitScene(f.scene, 1, 0), protocol: protocolVersion });
    f.push({ protocol: protocolVersion, event: 'finished', assemblyId: plan.assembly.objectId, visitCount: 1, totalSeconds: 0,
      stateRevision: 0, eventSequence: 0, audioCommandSequence: 0, animationCommandSequence: commands, animationCompletionSequence: 0,
      ...(protocolVersion === 11 ? { animationStateSequence: 0, animationStateEntrySequence: 0 } : {}) });
    return value.finish();
  };
  return f;
}
const counts = (accepted, applied = 0, discarded = 0) => ({ accepted, applied, discarded, pending: accepted - applied - discarded });

test('construction requires a framed reader and bounded detached observation options', () => {
  assert.throws(() => createProjectAnimationRequestsReader(completionProject()), TypeError);
  assert.throws(() => createProjectAnimationRequestsReader(completionProject(), { runtimeReader: createProjectRuntimeEventReader(completionProject(), { protocolVersion: 7 }) }), TypeError);
  for (const retainedRequests of [0, -1, .5, 257, Infinity, '1', null]) assert.throws(() => fixture({ retainedRequests }), TypeError);
  for (const protocolVersion of [1, 4, 12]) assert.throws(() => fixture({ protocolVersion }), TypeError);
  assert.throws(() => fixture({ onSnapshot: true }), TypeError);
  const seen = [], f = fixture({ onSnapshot: snapshot => seen.push(snapshot) });
  assert.ok(Object.isFrozen(f.value)); assert.equal(seen.length, 1);
  assert.deepEqual(f.value.animationRequests.counts, counts(0)); assert.equal(f.value.animationRequests.phase, 'waiting');
  const view = f.value.animationRequests; view.requests.push({}); view.counts.accepted = 900;
  assert.deepEqual(f.value.animationRequests.counts, counts(0)); assert.deepEqual(f.value.animationRequests.requests, []);
});

test('fragmented request observations bind actual receipts and exact clocks without changing old DTOs', () => {
  const f = fixture(), run = completionRun(f.plan), seen = []; let id = 0;
  for (const [index, frame] of run.entries()) {
    const position = clock(index, Math.floor(index / 2));
    const parts = [];
    if (frame.event === 'animation-command') parts.push(wire(accepted(f.scene, ++id, frame.command, position)));
    parts.push(business(frame, index + 1, position));
    if (frame.event === 'animation-command') parts.push(wire(applied(id, frame.commandSequence, index + 1, position)));
    const text = parts.join('').replaceAll('\n', '\r\n');
    for (let offset = 0; offset < text.length; offset += 3) seen.push(...f.value.push(text.slice(offset, offset + 3)));
  }
  assert.deepEqual(seen, run); assert.deepEqual(f.value.finish().diagnostics, []);
  const view = f.value.animationRequests;
  assert.equal(view.phase, 'finished'); assert.deepEqual(view.counts, counts(4, 4));
  assert.equal(view.requests[0].applied.executionFrameIndex, 4);
  assert.deepEqual(view.requests[0].acceptedClock, clock(3, 1));
  assert.deepEqual(view.requests[0].origin.source, f.scene.behaviors.bindings[0].declaration);
  assert.equal(f.value.events.length, 1); assert.equal(f.value.executionFrames.frames.length, 1);
  view.requests[0].origin.source.sourcePath = 'forged'; view.requests[0].applied.clock.idleFrame = 900;
  assert.notEqual(f.value.animationRequests.requests[0].origin.source.sourcePath, 'forged');
  assert.equal(f.value.animationRequests.requests[0].applied.clock.idleFrame, 3);
});

test('accepted identity, source, target, command and clock failures never change the queue', () => {
  const changes = [row => row.protocol = 2, row => row.requestId = 2, row => row.requestId = .5,
    row => row.requestId = Number.MAX_SAFE_INTEGER + 1, row => row.extra = true,
    row => row.origin.source = {}, row => row.origin.visitIndex = 2, row => row.origin.sceneId = runtimeId(900),
    row => row.origin.bindingId = runtimeId(900), row => row.origin.instanceId = runtimeId(900), row => row.origin.objectId = runtimeId(900),
    row => row.target = { kind: 'instance', instanceId: row.origin.instanceId }, row => row.target.extra = true,
    row => row.command = { action: 'seek', positionSeconds: 2 }, row => row.command = { action: 'seek', positionSeconds: -1 },
    row => row.command = { action: 'select', clipId: runtimeId(999) }, row => row.command.extra = 0,
    row => row.clock = clock(-1), row => row.clock = clock(.5), row => row.clock = clock(Number.MAX_SAFE_INTEGER + 1),
    row => row.clock.extra = true];
  for (const change of changes) {
    const f = fixture(); f.start(); const row = accepted(f.scene); change(row);
    f.value.push(wire(row)); assert.deepEqual(f.value.animationRequests.counts, counts(0));
    assert.equal(f.value.retention.total, 3); assert.equal(f.value.diagnostics[0].code, 'runtime_animation_request_invalid');
    f.value.push(wire(accepted(f.scene))); assert.deepEqual(f.value.animationRequests.counts, counts(1));
  }
  const f = fixture(); f.value.push(wire(accepted(f.scene))); assert.equal(f.value.animationRequests.counts.accepted, 0);
  f.start(); f.value.push(wire(accepted(f.scene, 1, { action: 'stop' }, clock(2, 3))));
  f.value.push(wire(accepted(f.scene, 2, { action: 'stop' }, clock(3, 2))));
  assert.equal(f.value.animationRequests.counts.accepted, 1);
});

test('a queued seek uses whole-animation acceptance bounds and may later be discarded after clip execution failure', () => {
  const f = fixture(); f.start(); const clip = f.scene.animation.document.clips[0].id;
  const select = { action: 'select', clipId: clip }, seek = { action: 'seek', positionSeconds: .9 };
  f.value.push(wire(accepted(f.scene, 1, select)) + wire(accepted(f.scene, 2, seek)));
  f.command(1, select, clock(), 'paused', clip); f.apply(1);
  f.error(); f.value.push(wire(discarded(2))); f.value.finish();
  assert.deepEqual(f.value.animationRequests.counts, counts(2, 1, 1));
  assert.equal(f.value.animationRequests.phase, 'incomplete'); assert.equal(f.value.animationCommands.sequence, 1);
  assert.ok(f.value.diagnostics.some(row => row.code === 'runtime_behavior_animation_unavailable'));
  assert.equal(f.value.diagnostics.some(row => row.code === 'runtime_animation_request_invalid'), false);
});

test('applied observations require the FIFO head and the already admitted exact business position', () => {
  const mutations = [row => row.requestId = 2, row => row.commandSequence = 2, row => row.executionFrameIndex--,
    row => row.clock.idleFrame++, row => row.extra = true];
  for (const change of mutations) {
    const f = fixture(); f.start(); f.value.push(wire(accepted(f.scene)) + wire(accepted(f.scene, 2)));
    f.command(1); const row = applied(1, 1, f.index); change(row); f.value.push(wire(row));
    assert.deepEqual(f.value.animationRequests.counts, counts(2)); f.apply(1);
    assert.deepEqual(f.value.animationRequests.counts, counts(2, 1));
    f.value.push(wire(applied(1, 1, f.index))); assert.deepEqual(f.value.animationRequests.counts, counts(2, 1));
  }
  const early = fixture(); early.start(); early.value.push(wire(accepted(early.scene))); early.apply(1);
  assert.deepEqual(early.value.animationRequests.counts, counts(1)); assert.equal(early.value.animationCommands.sequence, 0);
  const late = fixture(); late.start(); late.value.push(wire(accepted(late.scene))); late.command(1);
  const oldIndex = late.index;
  late.push({ ...sceneFrame(late.scene, 1, { protocol: 3, event: 'state', instanceId: late.scene.actors[0].instanceId, objectId: late.scene.actors[0].objectId, state: 'idle' }), protocol: 7 });
  late.value.push(wire(applied(1, 1, oldIndex))); assert.deepEqual(late.value.animationRequests.counts, counts(1));
});

test('applied evidence rechecks the current downstream frame position rather than a stale cached receipt', () => {
  const f = fixture(); f.start(); f.value.push(wire(accepted(f.scene))); f.command(1);
  const state = { ...sceneFrame(f.scene, 1, { protocol: 3, event: 'state', instanceId: f.scene.actors[0].instanceId,
    objectId: f.scene.actors[0].objectId, state: 'idle' }), protocol: 7 };
  assert.equal(f.framed.push(business(state, 5)).length, 1);
  f.apply(1); assert.deepEqual(f.value.animationRequests.counts, counts(1));
  assert.equal(f.value.diagnostics.at(-1).code, 'runtime_animation_request_invalid');
});

test('a valid but mismatching command receipt remains old business evidence and cannot settle the request', () => {
  const f = fixture(); f.start(); f.value.push(wire(accepted(f.scene)));
  f.command(1, { action: 'pause' }, clock(), 'paused'); f.apply(1);
  assert.equal(f.value.animationCommands.sequence, 1); assert.deepEqual(f.value.animationRequests.counts, counts(1));
  assert.equal(f.value.animationRequests.phase, 'incomplete');
});

test('an invalid business receipt cannot create applied evidence and preserves original diagnostics', () => {
  const f = fixture(); f.start(); f.value.push(wire(accepted(f.scene)));
  const wrong = completionCommand(f.scene, 1, 1, { action: 'stop' }, 0, 0, 'playing');
  f.value.push(business(wrong, 4)); f.value.push(wire(applied(1, 1, 4)));
  assert.equal(f.value.animationCommands.sequence, 0); assert.equal(f.value.executionFrames.totalFrames, 3);
  assert.deepEqual(f.value.animationRequests.counts, counts(1));
  assert.ok(f.value.diagnostics.some(row => row.code === 'runtime_project_protocol_invalid'));
  f.command(1); f.apply(1); assert.deepEqual(f.value.animationRequests.counts, counts(1, 1));
});

test('discard requires a real admitted error, FIFO and absence of an already committed receipt', () => {
  const f = fixture(); f.start(); f.value.push(wire(accepted(f.scene)) + wire(accepted(f.scene, 2)));
  f.value.push(wire(discarded(1))); assert.deepEqual(f.value.animationRequests.counts, counts(2));
  f.error(); f.value.push(wire(discarded(2))); assert.deepEqual(f.value.animationRequests.counts, counts(2));
  f.value.push(wire(discarded(1)) + wire(discarded(2))); assert.deepEqual(f.value.animationRequests.counts, counts(2, 0, 2));
  f.value.push(wire(accepted(f.scene, 3))); assert.equal(f.value.animationRequests.counts.accepted, 2);
  const committed = fixture(); committed.start(); committed.value.push(wire(accepted(committed.scene))); committed.command(1);
  committed.error(); committed.value.push(wire(discarded(1)));
  assert.deepEqual(committed.value.animationRequests.counts, counts(1));
});

test('duplicate IDs and a 65th pending request do not consume the next legal request identity', () => {
  const f = fixture(); f.start();
  for (let id = 1; id <= 64; id++) f.value.push(wire(accepted(f.scene, id)));
  f.value.push(wire(accepted(f.scene, 64)) + wire(accepted(f.scene, 65)));
  assert.deepEqual(f.value.animationRequests.counts, counts(64)); f.command(1); f.apply(1);
  f.value.push(wire(accepted(f.scene, 65))); assert.deepEqual(f.value.animationRequests.counts, counts(65, 1));
});

test('terminal tail eviction never evicts unresolved requests or changes old command identities', () => {
  const f = fixture(); f.start();
  for (let id = 1; id <= 130; id++) { f.value.push(wire(accepted(f.scene, id))); f.command(id); f.apply(id); }
  for (let id = 131; id <= 194; id++) f.value.push(wire(accepted(f.scene, id)));
  const view = f.value.animationRequests;
  assert.deepEqual(view.counts, counts(194, 130));
  assert.deepEqual(view.retention, { limit: 128, total: 194, retained: 192, dropped: 2, pending: 64, terminal: 128, firstRequestId: 3, lastRequestId: 194 });
  assert.equal(view.requests.at(-1).status, 'pending'); assert.equal(f.value.animationCommands.sequence, 130);
  f.value.finish(); assert.equal(f.value.animationRequests.phase, 'incomplete'); assert.equal(f.value.animationRequests.counts.pending, 64);
});

test('256 accepted and applied pairs exhaust only the independent bounded observation attempts', () => {
  const f = fixture({ retainedRequests: 1 }); f.start();
  for (let id = 1; id <= 256; id++) { f.value.push(wire(accepted(f.scene, id))); f.command(id); f.apply(id); }
  assert.deepEqual(f.value.animationRequests.counts, counts(256, 256)); assert.equal(f.value.animationRequests.requests.length, 1);
  assert.deepEqual(f.end(256).diagnostics, []); assert.equal(f.value.animationRequests.phase, 'finished');
  const bounded = fixture(); bounded.start();
  bounded.value.push((prefix + '{}\n').repeat(600)); bounded.value.push(wire(accepted(bounded.scene)));
  assert.deepEqual(bounded.value.animationRequests.counts, counts(0)); assert.equal(bounded.value.diagnostics.length, 128);
});

test('malformed and oversized lines are bounded and unrelated huge logs are delegated immediately', () => {
  const chunks = [], f = fixture({ transform: framed => ({
    push(text) { chunks.push(text); return framed.push(text); }, finish: () => framed.finish(),
    get events() { return framed.events; }, get diagnostics() { return framed.diagnostics; },
    get retention() { return framed.retention; }, get executionFrames() { return framed.executionFrames; },
  }) });
  const huge = 'log:' + 'x'.repeat(200000); f.value.push(huge); assert.equal(chunks.join(''), huge); f.value.push('\n');
  for (const raw of ['{', 'null', '[]', '{"__proto__":{}}']) f.value.push(prefix + raw + '\n');
  f.value.push(prefix + '雪'.repeat(6000) + '\n');
  f.value.push(prefix + 'x'.repeat(20000)); f.value.push('x'.repeat(100000)); f.value.push('\n');
  assert.deepEqual(f.value.animationRequests.counts, counts(0));
  assert.equal(f.value.diagnostics.filter(row => row.code === 'runtime_animation_request_limit').length, 2);
  f.start(); f.value.push(wire(accepted(f.scene))); assert.equal(f.value.animationRequests.counts.accepted, 1);
});

test('observer exceptions preserve accepted facts and unterminated outcomes without replay', () => {
  let thrown = false;
  const f = fixture({ onSnapshot(view) { if (view.counts.accepted && !thrown) { thrown = true; throw new Error('request observer'); } } }); f.start();
  assert.throws(() => f.value.push(wire(accepted(f.scene))), /request observer/);
  assert.deepEqual(f.value.animationRequests.counts, counts(1)); f.command(1); f.apply(1);
  assert.deepEqual(f.end(1).diagnostics, []);
  let terminalThrows = 0;
  const tail = fixture({ onSnapshot(view) { if (view.counts.applied && terminalThrows++ === 0) throw new Error('tail observer'); } });
  tail.start(); tail.value.push(wire(accepted(tail.scene))); tail.command(1);
  tail.value.push(wire(applied(1, 1, tail.index)).trimEnd());
  assert.throws(() => tail.value.finish(), /tail observer/); tail.value.finish();
  assert.deepEqual(tail.value.animationRequests.counts, counts(1, 1)); assert.equal(tail.value.retention.total, 4);
});

test('onEvent failure after a committed command retains downstream evidence but leaves its outcome pending', () => {
  let calls = 0;
  const f = fixture({ onEvent(frame) { if (frame.event === 'animation-command') { calls++; throw new Error('committed observer'); } } });
  f.start(); f.value.push(wire(accepted(f.scene)));
  assert.throws(() => f.command(1), /committed observer/);
  assert.equal(f.value.animationCommands.sequence, 1); assert.equal(f.value.executionFrames.totalFrames, 4);
  assert.deepEqual(f.value.animationRequests.counts, counts(1)); assert.equal(f.value.animationRequests.phase, 'incomplete');
  f.value.push(wire(applied(1, 1, 4))); f.value.finish(); f.value.finish();
  assert.deepEqual(f.value.animationRequests.counts, counts(1)); assert.equal(calls, 1); assert.equal(f.value.retention.total, 4);
});

test('a missing applied marker or process end never implies discarded or unapplied execution', () => {
  for (const execute of [false, true]) {
    const f = fixture(); f.start(); f.value.push(wire(accepted(f.scene))); if (execute) f.command(1);
    f.value.finish(); assert.deepEqual(f.value.animationRequests.counts, counts(1));
    assert.equal(f.value.animationRequests.requests[0].status, 'pending'); assert.equal(f.value.animationRequests.phase, 'incomplete');
    assert.equal(f.value.animationCommands.sequence, execute ? 1 : 0);
  }
});

test('instance targets bind each origin while command and request FIFO remain global', () => {
  const plan = completionProject(), scene = plan.scenes[0], animation = scene.animation;
  animation.schemaVersion = 3; animation.document.schemaVersion = 4; animation.document.playbackScope = 'instance';
  const actor = scene.actors[1], track = { ...clone(animation.document.tracks[0]), id: runtimeId(901), instanceId: actor.instanceId };
  animation.document.tracks.push(track); animation.locations.tracks.push({ id: track.id, declaration: { ...animation.manifest, propertyPath: '/tracks/1' } });
  const binding = { ...clone(scene.behaviors.bindings[0]), bindingId: runtimeId(902), instanceId: actor.instanceId, objectId: actor.objectId };
  binding.declaration.propertyPath = '/bindings/1'; scene.behaviors.bindings.push(binding); scene.requiredCapabilities.push('animation.instances2d');
  plan.requiredCapabilities = [...new Set(['project.scenes', ...plan.scenes.flatMap(row => row.requiredCapabilities)])].sort();
  const f = fixture({ plan, protocolVersion: 11 }); f.start();
  const requests = [0, 1].map(index => ({ ...accepted(scene, index + 1), origin: origin(scene, 1, index), target: { kind: 'instance', instanceId: scene.behaviors.bindings[index].instanceId } }));
  const forged = clone(requests[0]); forged.target = requests[1].target; f.value.push(wire(forged)); assert.equal(f.value.animationRequests.counts.accepted, 0);
  requests.forEach(row => f.value.push(wire(row)));
  for (const [index, request] of requests.entries()) {
    const frame = p11(completionCommand(scene, 1, index + 1, request.command, 0, 0, 'stopped'));
    Object.assign(frame, request.origin, { target: request.target }); f.push(frame); f.apply(index + 1);
  }
  assert.deepEqual(f.value.animationRequests.counts, counts(2, 2));
  assert.deepEqual(f.value.animationRequests.requests.map(row => row.target), requests.map(row => row.target));
});

test('visit changes require new origins and preserve a session-wide request sequence', () => {
  const f = fixture(); f.start(); f.value.push(wire(accepted(f.scene))); f.command(1); f.apply(1);
  const second = f.plan.scenes[1];
  f.push({ ...exitScene(f.scene, 1, 0, second), protocol: 7 }); f.push({ ...enterScene(second, 2), protocol: 7 }); f.push({ ...readyScene(second, 2), protocol: 7 });
  f.value.push(wire(accepted(f.scene, 2))); assert.equal(f.value.animationRequests.counts.accepted, 1);
  f.value.push(wire(accepted(second, 2, { action: 'stop' }, clock(), 2)));
  f.push(completionCommand(second, 2, 2, { action: 'stop' }, 0, 0, 'stopped')); f.apply(2);
  assert.deepEqual(f.value.animationRequests.counts, counts(2, 2)); assert.equal(f.value.animationRequests.requests[1].origin.visitIndex, 2);
});

test('clock callback finalization remains retryable through the request wrapper', () => {
  let calls = 0;
  const f = fixture({ onClock(view) { if (view.totalWindows) { calls++; throw new Error('clock observer'); } } }); f.start();
  const zero = { eventRegistrations: 0, eventPublishes: 0, eventDeliveries: 0, eventBytes: 0, stateMutations: 0, audioRequests: 0, animationRequests: 0 };
  f.value.push(PROJECT_EXECUTION_CLOCK_PREFIX + JSON.stringify({ protocol: 1, event: 'sample', index: 1, clock: clock(), used: zero, total: zero, reason: 'sample' }));
  assert.throws(() => f.value.finish(), /clock observer/); assert.throws(() => f.value.finish(), /clock observer/); f.value.finish();
  assert.equal(calls, 2); assert.equal(f.value.executionClock.totalWindows, 1); assert.equal(f.value.retention.total, 3);
  assert.equal(f.value.animationRequests.phase, 'incomplete');
});

test('an unterminated business finished frame is admitted during finish without replay', () => {
  const f = fixture(); f.start(); f.value.push(wire(accepted(f.scene))); f.command(1); f.apply(1);
  f.push({ ...exitScene(f.scene, 1, 0), protocol: 7 });
  const terminal = { protocol: 7, event: 'finished', assemblyId: f.plan.assembly.objectId, visitCount: 1, totalSeconds: 0,
    stateRevision: 0, eventSequence: 0, audioCommandSequence: 0, animationCommandSequence: 1, animationCompletionSequence: 0 };
  f.value.push(business(terminal, 6).trimEnd());
  assert.equal(f.value.animationRequests.phase, 'recording');
  assert.deepEqual(f.value.finish().diagnostics, []); assert.equal(f.value.animationRequests.phase, 'finished');
  f.value.finish(); assert.equal(f.value.retention.total, 6); assert.deepEqual(f.value.animationRequests.counts, counts(1, 1));
});
