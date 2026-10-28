import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createProjectEventPositionsReader } from '../../engine/project-event-positions.mjs';
import { createProjectExecutionFramesReader, PROJECT_EXECUTION_FRAME_PREFIX } from '../../engine/project-execution-frames.mjs';
import { createProjectExecutionClockReader, PROJECT_EXECUTION_CLOCK_PREFIX } from '../../engine/project-execution-clock.mjs';
import { createProjectRuntimeEventReader } from '../../engine/project-runtime-events.mjs';
import { createProjectAudioRequestsReader, PROJECT_AUDIO_REQUEST_PREFIX } from '../../engine/project-audio-requests.mjs';
import { createProjectAnimationRequestsReader, PROJECT_ANIMATION_REQUEST_PREFIX } from '../../engine/project-animation-requests.mjs';
import { eventProject, eventReady, eventFinished, publication, delivery, eventReturnTrip } from './helpers/project-event-bus-fixture.mjs';
import { audioProject, audioReady, audioCommand } from './helpers/project-audio-command-fixture.mjs';
import { completionProject, completionCommand } from './helpers/project-animation-completion-fixture.mjs';
import { stateFrame } from './helpers/project-shared-state-fixture.mjs';
import { runtimeId, enterScene, readyScene, exitScene, sceneFrame } from './helpers/project-runtime-fixture.mjs';

const clone = value => structuredClone(value), clock = (idleFrame = 0, physicsFrame = idleFrame) => ({ idleFrame, physicsFrame });
const wire = (frame, index, position = clock()) => PROJECT_EXECUTION_FRAME_PREFIX + JSON.stringify({ protocol: 1, index, clock: position, frame }) + '\n';
const mark = (frame, prefix) => prefix + JSON.stringify(frame) + '\n';
const counts = (published, settled, deliveries = 0, handled = 0, skipped = 0) =>
  ({ published, settled, pending: published - settled, deliveries, handled, skipped, pendingDeliveries: deliveries - handled - skipped });
function fixture({ plan = eventProject(), protocolVersion = 3, onEvent, onFrames, onClock, onAudio, onAnimation, mixed = false, transform, ...options } = {}) {
  const base = createProjectRuntimeEventReader(plan, { protocolVersion, retainedEvents: 1, onEvent });
  const scheduled = onClock ? createProjectExecutionClockReader({ runtimeReader: base, onSnapshot: onClock }) : base;
  const framed = createProjectExecutionFramesReader({ runtimeReader: scheduled, retainedFrames: 1, onSnapshot: onFrames });
  let reader = framed;
  if (mixed) reader = createProjectAudioRequestsReader(plan, { protocolVersion, onSnapshot: onAudio,
    runtimeReader: createProjectAnimationRequestsReader(plan, { runtimeReader: reader, protocolVersion, onSnapshot: onAnimation }) });
  const value = createProjectEventPositionsReader({ runtimeReader: transform ? transform(reader) : reader, ...options });
  const f = { value, base, framed, plan, scene: plan.scenes[0], index: 0 };
  f.up = frame => ({ ...frame, protocol: protocolVersion, ...(['ready', 'finished'].includes(frame.event) ? {
    ...(protocolVersion >= 4 ? { audioCommandSequence: 0 } : {}), ...(protocolVersion >= 5 ? { animationCommandSequence: 0 } : {}),
    ...(protocolVersion >= 7 ? { animationCompletionSequence: 0 } : {}), ...(protocolVersion >= 8 ? { animationStateSequence: 0 } : {}),
    ...(protocolVersion >= 9 ? { animationStateEntrySequence: 0 } : {}),
  } : {}) });
  f.push = (frame, position = clock()) => value.push(wire(f.up(frame), ++f.index, position));
  f.start = () => [eventReady(plan), enterScene(f.scene, 1), readyScene(f.scene, 1), ...(f.scene.audio ? [audioReady(f.scene, 1)] : [])].forEach(frame => f.push(frame));
  f.publish = (sequence, recipients = [1], position = clock(), scene = f.scene, visit = 1, payload = true, name = 'notice') =>
    f.push(publication(scene, visit, sequence, name, payload, recipients.map(subscriptionId => ({ subscriptionId, ...Object.fromEntries(['bindingId', 'instanceId', 'objectId'].map(key => [key, scene.behaviors.bindings[0][key]])) }))), position);
  f.deliver = (sequence, subscriptionId = 1, status = 'handled', position = clock(), scene = f.scene, visit = 1) => f.push(delivery(scene, visit, sequence, subscriptionId, status), position);
  f.error = () => f.push(sceneFrame(f.scene, 1, { protocol: 3, event: 'diagnostic', severity: 'error', code: 'runtime_behavior_event_callback', message: 'Callback failed.' }));
  f.end = (sequence, revision = 0) => { f.push(exitScene(f.scene, 1, 0)); f.push(eventFinished(plan, 1, 0, revision, sequence)); return value.finish(); };
  return f;
}

test('construction requires event and exact-position capabilities with bounded retention and detached initial DTO', () => {
  assert.throws(() => createProjectEventPositionsReader(), TypeError);
  const plan = eventProject();
  assert.throws(() => createProjectEventPositionsReader({ runtimeReader: createProjectRuntimeEventReader(plan, { protocolVersion: 3 }) }), TypeError);
  assert.throws(() => createProjectEventPositionsReader({ runtimeReader: createProjectExecutionFramesReader({ runtimeReader: createProjectRuntimeEventReader(plan) }) }), TypeError);
  for (const retainedEvents of [0, -1, .5, 129, Infinity, '1', null]) assert.throws(() => fixture({ retainedEvents }), TypeError);
  assert.throws(() => fixture({ onSnapshot: true }), TypeError);
  const seen = [], f = fixture({ onSnapshot: view => seen.push(view) }); assert.equal(seen.length, 1); assert.ok(Object.isFrozen(f.value));
  assert.equal(f.value.eventPositions.phase, 'waiting'); assert.deepEqual(f.value.eventPositions.counts, counts(0, 0));
  const snapshot = f.value.eventPositions; snapshot.items.push({}); snapshot.counts.published = 99;
  assert.deepEqual(f.value.eventPositions.counts, counts(0, 0)); assert.deepEqual(f.value.eventPositions.items, []);
});

test('fragmented multi-visit business traffic gains exact event positions without changing old DTOs', () => {
  const f = fixture(), frames = eventReturnTrip(f.plan), admitted = [];
  for (const [index, frame] of frames.entries()) {
    const encoded = wire(frame, index + 1, clock(index, Math.floor(index / 2))).replaceAll('\n', '\r\n');
    for (let offset = 0; offset < encoded.length; offset += 5) admitted.push(...f.value.push(encoded.slice(offset, offset + 5)));
  }
  assert.deepEqual(admitted, frames); assert.deepEqual(f.value.finish().diagnostics, []);
  const view = f.value.eventPositions;
  assert.equal(view.phase, 'finished'); assert.deepEqual(view.counts, counts(4, 4, 3, 2, 1));
  assert.deepEqual(view.items[0].published, { clock: clock(3, 1), executionFrameIndex: 4 });
  assert.deepEqual(view.items[0].deliveries[0].delivered, { clock: clock(6, 3), executionFrameIndex: 7 });
  for (const [index, item] of view.items.entries()) {
    const { published, deliveries, ...rest } = item;
    assert.deepEqual({ ...rest, deliveries: deliveries.map(({ delivered, ...row }) => row) }, f.value.projectEvents.entries[index]);
  }
  assert.equal(f.value.executionFrames.frames.length, 1); assert.equal(f.value.events.length, 1);
  view.items[0].origin.source.sourcePath = 'forged'; view.items[0].deliveries[0].origin.source.propertyPath = 'forged';
  view.items[0].published.clock.idleFrame = 999;
  assert.notEqual(f.value.eventPositions.items[0].origin.source.sourcePath, 'forged');
  assert.notEqual(f.value.eventPositions.items[0].deliveries[0].origin.source.propertyPath, 'forged');
  assert.equal(f.value.eventPositions.items[0].published.clock.idleFrame, 3);
});

test('zero recipients settle publication facts immediately without inventing delivery positions', () => {
  const f = fixture(); f.start(); f.publish(1, []);
  assert.deepEqual(f.value.eventPositions.counts, counts(1, 1)); assert.deepEqual(f.value.eventPositions.items[0].deliveries, []);
  assert.deepEqual(f.value.eventPositions.retention, { limit: 32, total: 1, retained: 1, dropped: 0, pending: 0, settled: 1, firstSequence: 1, lastSequence: 1 });
  assert.deepEqual(f.end(1).diagnostics, []); assert.equal(f.value.eventPositions.phase, 'finished');
});

test('nested publication facts precede their callbacks while recipient FIFO and each exact receipt remain distinct', () => {
  const f = fixture(); f.start(); f.publish(1, [1, 2]);
  f.push(stateFrame(f.scene, 1, 1, 'side_effect', true)); f.publish(2, [1]); // A callback publishes before its own receipt.
  f.deliver(1, 1, 'handled', clock(1));
  assert.deepEqual(f.value.eventPositions.counts, counts(2, 0, 3, 1));
  assert.deepEqual(f.value.eventPositions.items[0].deliveries.map(row => row.status), ['handled', 'pending']);
  f.deliver(1, 2, 'skipped', clock(2)); f.deliver(2, 1, 'handled', clock(3));
  const view = f.value.eventPositions;
  assert.deepEqual(view.counts, counts(2, 2, 3, 2, 1));
  assert.deepEqual(view.items[0].deliveries.map(row => row.delivered.clock), [clock(1), clock(2)]);
  assert.equal(view.items[1].published.executionFrameIndex, 6); assert.equal(view.items[1].deliveries[0].delivered.executionFrameIndex, 9);
});

test('partial success followed by callback failure preserves side effects and leaves remaining recipients pending', () => {
  const f = fixture(); f.start(); f.publish(1, [1, 2, 3]); f.publish(2, [1]); f.deliver(1, 1);
  f.push(stateFrame(f.scene, 1, 1, 'before_failure', true)); f.error(); f.value.finish();
  const view = f.value.eventPositions;
  assert.deepEqual(view.counts, counts(2, 0, 4, 1)); assert.equal(view.phase, 'incomplete');
  assert.deepEqual(view.items[0].deliveries.map(row => row.status), ['handled', 'pending', 'pending']);
  assert.equal(Object.hasOwn(view.items[0].deliveries[1], 'delivered'), false);
  assert.equal(f.value.sharedState.revision, 1); assert.equal(f.value.projectEvents.entries[1].deliveries[0].status, 'pending');
  assert.ok(f.value.diagnostics.some(d => d.code === 'runtime_behavior_event_callback'));
});

test('illegal publications, delivery order, identities and retired tokens preserve only admitted positions', () => {
  const f = fixture(); f.start(); f.publish(1, [1, 2]);
  const before = f.value.eventPositions;
  for (const frame of [publication(f.scene, 1, 2, 'notice', null), { ...publication(f.scene, 1, 2, 'notice', true), source: {} },
    delivery(f.scene, 1, 1, 2), delivery(f.scene, 2, 1, 1), { ...delivery(f.scene, 1, 1, 1), status: 'discarded' }]) {
    f.value.push(wire(frame, f.index + 1));
    assert.deepEqual(f.value.eventPositions.items, before.items); assert.deepEqual(f.value.eventPositions.counts, before.counts);
  }
  f.deliver(1, 1, 'skipped'); f.deliver(1, 2);
  f.value.push(wire(publication(f.scene, 1, 2, 'notice', true), f.index + 1)); // Token 1 is retired.
  assert.deepEqual(f.value.eventPositions.counts, counts(1, 1, 2, 1, 1)); assert.equal(f.value.projectEvents.sequence, 1);
  assert.equal(f.value.eventPositions.phase, 'incomplete'); assert.ok(f.value.diagnostics.some(d => d.code === 'runtime_project_protocol_invalid'));
  assert.equal(f.value.diagnostics.some(d => d.code === 'runtime_event_position_invalid'), false);
});

test('retained publications preserve their original positions after unrelated raw and execution tails rotate', () => {
  const f = fixture(); f.start(); f.publish(1, [1, 2], clock(1)); const original = clone(f.value.eventPositions.items[0].published);
  for (let revision = 1; revision <= 160; revision++) f.push(stateFrame(f.scene, 1, revision, 'tick', revision), clock(revision + 1));
  assert.equal(f.value.executionFrames.frames.length, 1); assert.equal(f.value.executionFrames.frames[0].index, 164);
  assert.deepEqual(f.value.eventPositions.items[0].published, original);
  f.deliver(1, 1, 'handled', clock(162)); f.value.finish();
  assert.deepEqual(f.value.eventPositions.items[0].published, original); assert.equal(f.value.eventPositions.items[0].deliveries[0].delivered.executionFrameIndex, 165);
  assert.deepEqual(f.value.eventPositions.counts, counts(1, 0, 2, 1));
});

test('32 newest settled identities coexist with all pending publications even when empty newer publications settle first', () => {
  const f = fixture(); f.start(); f.publish(1, [1]);
  for (let sequence = 2; sequence <= 41; sequence++) f.publish(sequence, []);
  assert.deepEqual(f.value.eventPositions.retention, { limit: 32, total: 41, retained: 33, dropped: 8, pending: 1, settled: 32, firstSequence: 1, lastSequence: 41 });
  assert.deepEqual(f.value.eventPositions.items.map(row => row.sequence), [1, ...Array.from({ length: 32 }, (_, i) => i + 10)]);
  f.deliver(1); // Its old identity must not evict a newer settled publication.
  assert.deepEqual(f.value.eventPositions.items.map(row => row.sequence), Array.from({ length: 32 }, (_, i) => i + 10));
  assert.deepEqual(f.value.eventPositions.counts, counts(41, 41, 1, 1));
  assert.deepEqual(f.end(41).diagnostics, []); assert.equal(f.value.eventPositions.phase, 'finished');
});

test('128 publications, 64 pending messages and 1024 recipients retain their independent legacy bounds', () => {
  const full = fixture(); full.start(); for (let sequence = 1; sequence <= 128; sequence++) full.publish(sequence, []);
  assert.deepEqual(full.value.eventPositions.counts, counts(128, 128)); assert.equal(full.value.eventPositions.items[0].sequence, 97);
  full.value.push(wire(publication(full.scene, 1, 129, 'notice', true, []), full.index + 1)); assert.equal(full.value.projectEvents.sequence, 128);
  const pending = fixture(); pending.start(); for (let sequence = 1; sequence <= 64; sequence++) pending.publish(sequence);
  pending.value.push(wire(publication(pending.scene, 1, 65, 'notice', true), pending.index + 1)); assert.equal(pending.value.eventPositions.counts.published, 64);
  pending.publish(65, []); assert.deepEqual(pending.value.eventPositions.counts, counts(65, 1, 64));
  pending.deliver(1); pending.publish(66); assert.equal(pending.value.eventPositions.retention.pending, 64);
  const recipients = Array.from({ length: 64 }, (_, i) => i + 1), deliveries = fixture({ retainedEvents: 1 }); deliveries.start();
  for (let sequence = 1; sequence <= 16; sequence++) { deliveries.publish(sequence, recipients); for (const id of recipients) deliveries.deliver(sequence, id); }
  assert.deepEqual(deliveries.value.eventPositions.counts, counts(16, 16, 1024, 1024));
  assert.equal(deliveries.value.projectEvents.entries.reduce((n, row) => n + row.deliveries.length, 0), 1024);
  deliveries.value.push(wire(publication(deliveries.scene, 1, 17, 'notice', true), deliveries.index + 1));
  assert.equal(deliveries.value.eventPositions.counts.published, 16); deliveries.publish(17, []);
  assert.deepEqual(deliveries.value.eventPositions.counts, counts(17, 17, 1024, 1024));
});

test('pending payload byte rejection does not add positions or consume the next legal publication identity', () => {
  const f = fixture(); f.start(); for (let sequence = 1; sequence <= 4; sequence++) f.publish(sequence, [1, 2], clock(), f.scene, 1, 'x'.repeat(4095), 'A');
  const rejected = publication(f.scene, 1, 5, 'A', true);
  f.value.push(wire(rejected, f.index + 1)); assert.equal(f.value.eventPositions.counts.published, 4);
  f.deliver(1, 1); f.value.push(wire(rejected, f.index + 1)); assert.equal(f.value.eventPositions.counts.published, 4);
  f.deliver(1, 2); f.publish(5, [1, 2], clock(), f.scene, 1, 'x'.repeat(4095), 'A');
  assert.deepEqual(f.value.eventPositions.counts, counts(5, 1, 10, 2));
});

test('scene re-entry retains old publication positions and uses new frozen visit sources and subscription IDs', () => {
  const f = fixture(); f.start(); f.publish(1); f.deliver(1); const first = clone(f.value.eventPositions.items[0]); const next = f.plan.scenes[1];
  f.push(exitScene(f.scene, 1, 0, next)); f.push(enterScene(next, 2)); f.push(readyScene(next, 2));
  f.publish(2, [2], clock(), next, 2); f.deliver(2, 2, 'handled', clock(), next, 2);
  assert.deepEqual(f.value.eventPositions.items[0], first); assert.equal(f.value.eventPositions.items[1].origin.visitIndex, 2);
  assert.deepEqual(f.value.eventPositions.items[1].origin.source, next.behaviors.bindings[0].declaration);
});

test('initial, publication and final snapshot observer failures never mutate or replay admitted facts', () => {
  let initial = 0; assert.throws(() => fixture({ onSnapshot() { initial++; throw new Error('initial'); } }), /initial/); assert.equal(initial, 1);
  let calls = 0;
  const f = fixture({ onSnapshot(view) { if (view.counts.published && calls++ === 0) throw new Error('published observer'); } }); f.start();
  assert.throws(() => f.publish(1), /published observer/); assert.equal(f.value.projectEvents.sequence, 1);
  assert.deepEqual(f.value.eventPositions.counts, counts(1, 0, 1)); assert.equal(f.value.eventPositions.phase, 'incomplete');
  f.deliver(1); f.end(1); assert.equal(f.value.projectEvents.sequence, 1); assert.equal(f.value.eventPositions.phase, 'incomplete');
  let terminalCalls = 0;
  const tail = fixture({ onSnapshot(view) { if (view.phase === 'finished') { terminalCalls++; throw new Error('final observer'); } } }); tail.start(); tail.publish(1, []);
  tail.push(exitScene(tail.scene, 1, 0));
  tail.value.push(wire(eventFinished(tail.plan, 1, 0, 0, 1), ++tail.index).trimEnd());
  assert.throws(() => tail.value.finish(), /final observer/); tail.value.finish();
  assert.equal(terminalCalls, 1); assert.equal(tail.value.eventPositions.phase, 'incomplete'); assert.equal(tail.value.retention.total, 6);
});

test('downstream onEvent failure recovers committed publication or delivery with exact position before closing', () => {
  for (const failing of ['event-publish', 'event-delivery']) {
    let calls = 0;
    const f = fixture({ onEvent(frame) { if (frame.event === failing) { calls++; throw new Error('business observer'); } } }); f.start();
    if (failing === 'event-delivery') f.publish(1);
    assert.throws(() => failing === 'event-publish' ? f.publish(1) : f.deliver(1), /business observer/);
    const terminal = failing === 'event-delivery';
    assert.deepEqual(f.value.eventPositions.counts, counts(1, Number(terminal), 1, Number(terminal)));
    const item = f.value.eventPositions.items[0]; assert.equal(item.published.executionFrameIndex, 4);
    if (terminal) assert.equal(item.deliveries[0].delivered.executionFrameIndex, 5);
    f.publish(2, []); f.value.finish(); f.value.finish(); assert.equal(calls, 1); assert.equal(f.value.projectEvents.sequence, 1);
    assert.equal(f.value.retention.total, terminal ? 5 : 4); assert.equal(f.value.eventPositions.phase, 'incomplete');
  }
});

test('downstream frame-snapshot failures still retain the event ledger commit and never replay buffered lines', () => {
  let calls = 0;
  const f = fixture({ onFrames(view) { if (view.frames.at(-1)?.reference.event === 'event-delivery') { calls++; throw new Error('position observer'); } } }); f.start(); f.publish(1);
  assert.throws(() => f.deliver(1), /position observer/); assert.deepEqual(f.value.eventPositions.counts, counts(1, 1, 1, 1));
  assert.throws(() => f.value.finish(), /position observer/); f.value.finish(); assert.equal(f.value.eventPositions.items[0].deliveries[0].delivered.executionFrameIndex, 5);
  assert.equal(calls, 2); assert.equal(f.value.retention.total, 5);
});

test('unterminated publication and delivery tails are admitted once even if downstream business observers throw', () => {
  for (const failing of [null, 'event-publish', 'event-delivery']) {
    const f = fixture({ onEvent(frame) { if (frame.event === failing) throw new Error('tail business observer'); } }); f.start();
    const deliver = failing !== 'event-publish'; if (deliver) f.publish(1);
    const frame = deliver ? delivery(f.scene, 1, 1, 1) : publication(f.scene, 1, 1, 'notice', true);
    f.value.push(wire(frame, ++f.index).trimEnd());
    if (failing) assert.throws(() => f.value.finish(), /tail business observer/); else f.value.finish();
    f.value.finish(); assert.deepEqual(f.value.eventPositions.counts, counts(1, Number(deliver), 1, Number(deliver)));
    assert.equal(f.value.retention.total, deliver ? 5 : 4); assert.equal(f.value.eventPositions.phase, 'incomplete');
  }
});

test('independent clock final observer retry remains possible without duplicating event positions', () => {
  let calls = 0;
  const f = fixture({ onClock(view) { if (view.totalWindows) { calls++; throw new Error('clock observer'); } } }); f.start(); f.publish(1);
  const zero = { eventRegistrations: 0, eventPublishes: 0, eventDeliveries: 0, eventBytes: 0, stateMutations: 0, audioRequests: 0, animationRequests: 0 };
  f.value.push(mark({ protocol: 1, event: 'sample', index: 1, clock: clock(), used: zero, total: zero, reason: 'sample' }, PROJECT_EXECUTION_CLOCK_PREFIX).trimEnd());
  assert.throws(() => f.value.finish(), /clock observer/); assert.throws(() => f.value.finish(), /clock observer/); f.value.finish();
  assert.equal(calls, 2); assert.equal(f.value.executionClock.totalWindows, 1); assert.deepEqual(f.value.eventPositions.counts, counts(1, 0, 1));
});

test('a failing final clock observer still publishes independent incomplete event positions without replaying either channel', () => {
  for (const started of [false, true]) {
    let closing = false;
    const notifications = [], admitted = [], failure = new Error('final clock observer');
    const f = fixture({
      onEvent: frame => admitted.push(frame),
      onClock(view) {
        if (closing) { notifications.push({ channel: 'clock', view }); throw failure; }
      },
      onSnapshot(view) { if (closing) notifications.push({ channel: 'positions', view }); },
    });
    if (started) { f.start(); f.publish(1); }
    const before = f.value.eventPositions, total = f.value.retention.total, admittedCount = admitted.length;
    closing = true;
    assert.throws(() => f.value.finish(), error => error === failure);
    assert.deepEqual(notifications.map(row => row.channel), ['clock', 'positions']);
    assert.equal(notifications[0].view.phase, 'incomplete');
    assert.equal(notifications[1].view.phase, 'incomplete');
    assert.deepEqual(notifications[1].view.items, before.items);
    assert.deepEqual(notifications[1].view.counts, before.counts);
    assert.deepEqual(f.value.eventPositions, notifications[1].view);
    assert.deepEqual(f.value.push(wire(publication(f.scene, 1, started ? 2 : 1, 'notice', true), f.index + 1)), []);
    f.value.finish(); // The existing clock's final notification has already been consumed.
    assert.deepEqual(notifications.map(row => row.channel), ['clock', 'positions', 'positions']);
    assert.deepEqual(notifications[2].view, notifications[1].view);
    f.value.finish();
    assert.equal(notifications.length, 3);
    assert.equal(f.value.retention.total, total);
    assert.equal(admitted.length, admittedCount);
    assert.deepEqual(f.value.eventPositions.items, before.items);
    assert.equal(f.value.executionClock.totalWindows, 0);
  }
});

test('enormous unrelated logs are passed through without an additional buffer or widening line limits', () => {
  const chunks = [], f = fixture({ transform: reader => ({ push(text) { chunks.push(text); return reader.push(text); }, finish: () => reader.finish(),
    get events() { return reader.events; }, get diagnostics() { return reader.diagnostics; }, get retention() { return reader.retention; },
    get executionFrames() { return reader.executionFrames; }, get projectEvents() { return reader.projectEvents; } }) });
  const huge = 'ordinary:' + 'x'.repeat(300000); f.value.push(huge); assert.deepEqual(chunks, [huge]); f.value.push('\n');
  f.value.push(PROJECT_EXECUTION_FRAME_PREFIX + 'x'.repeat(200000) + '\n');
  assert.ok(f.value.diagnostics.some(row => row.code === 'runtime_execution_frame_limit')); f.start(); f.publish(1, []);
  assert.deepEqual(f.value.eventPositions.counts, counts(1, 1));
});

test('missing or mismatching exact-position metadata never creates an inferred publication position', () => {
  for (const mutate of [view => view.frames.length = 0, view => view.frames.at(-1).reference.sequence++, view => view.frames.at(-1).index--]) {
    const f = fixture({ transform: reader => ({ push: text => reader.push(text), finish: () => reader.finish(),
      get events() { return reader.events; }, get diagnostics() { return reader.diagnostics; }, get retention() { return reader.retention; },
      get projectEvents() { return reader.projectEvents; }, get executionFrames() { const view = reader.executionFrames; if (view.frames.at(-1)?.reference.event === 'event-publish') mutate(view); return view; } }) });
    f.start(); f.publish(1, []); assert.deepEqual(f.value.eventPositions.counts, counts(0, 0)); assert.equal(f.value.projectEvents.sequence, 1);
    assert.equal(f.value.diagnostics.at(-1).code, 'runtime_event_position_invalid');
  }
});

function mixedPlan() {
  const plan = completionProject(), audio = audioProject({ empty: true });
  for (const [index, scene] of plan.scenes.entries()) { scene.audio = audio.scenes[index].audio; scene.resources = audio.scenes[index].resources;
    scene.requiredCapabilities = [...new Set([...scene.requiredCapabilities, ...audio.scenes[index].requiredCapabilities])]; }
  plan.resources = audio.resources; plan.requiredCapabilities = [...new Set(['project.scenes', ...plan.scenes.flatMap(scene => scene.requiredCapabilities)])].sort(); return plan;
}
function request(scene, domain) {
  const binding = scene.behaviors.bindings[0];
  const origin = { visitIndex: 1, sceneId: scene.scene.objectId, bindingId: binding.bindingId, instanceId: binding.instanceId, objectId: binding.objectId };
  return { protocol: 1, event: 'accepted', requestId: 1, clock: clock(), origin,
    ...(domain === 'audio' ? { trackId: scene.audio.document.tracks[0].id, action: 'stop' } : { target: { kind: 'scene' }, command: { action: 'stop' } }) };
}

test('event positions wrap both media request observers without merging identities or evidence', () => {
  const f = fixture({ plan: mixedPlan(), protocolVersion: 7, mixed: true }); f.start(); f.publish(1, [1, 2]);
  f.value.push(mark(request(f.scene, 'audio'), PROJECT_AUDIO_REQUEST_PREFIX) + mark(request(f.scene, 'animation'), PROJECT_ANIMATION_REQUEST_PREFIX));
  f.deliver(1, 1); f.deliver(1, 2, 'skipped');
  f.push(audioCommand(f.scene, 1, 1, 'stop'));
  f.value.push(mark({ protocol: 1, event: 'applied', requestId: 1, clock: clock(), commandSequence: 1, executionFrameIndex: f.index }, PROJECT_AUDIO_REQUEST_PREFIX));
  f.push(completionCommand(f.scene, 1, 1, { action: 'stop' }, 0, 0, 'stopped'));
  f.value.push(mark({ protocol: 1, event: 'applied', requestId: 1, clock: clock(), commandSequence: 1, executionFrameIndex: f.index }, PROJECT_ANIMATION_REQUEST_PREFIX));
  assert.deepEqual(f.value.eventPositions.counts, counts(1, 1, 2, 1, 1));
  assert.equal(f.value.audioRequests.counts.applied, 1); assert.equal(f.value.animationRequests.counts.applied, 1);
  assert.equal(f.value.eventPositions.items[0].published.executionFrameIndex, 5); assert.deepEqual(f.value.diagnostics, []);
});

test('nested media observer errors close event positions without dropping peer state or fabricating event terminals', () => {
  for (const domain of ['audio', 'animation']) {
    const observer = view => { if (view.counts.accepted) throw new Error('media observer'); };
    const f = fixture({ plan: mixedPlan(), protocolVersion: 7, mixed: true, ...(domain === 'audio' ? { onAudio: observer } : { onAnimation: observer }) }); f.start(); f.publish(1);
    assert.throws(() => f.value.push(mark(request(f.scene, domain), domain === 'audio' ? PROJECT_AUDIO_REQUEST_PREFIX : PROJECT_ANIMATION_REQUEST_PREFIX)), /media observer/);
    f.deliver(1); assert.throws(() => f.value.finish(), /media observer/); f.value.finish(); assert.equal(f.value.eventPositions.phase, 'incomplete');
    assert.deepEqual(f.value.eventPositions.counts, counts(1, 0, 1)); assert.equal(f.value[`${domain}Requests`].counts.accepted, 1);
    assert.equal(f.value.retention.total, 5);
  }
});

test('constructor rejects readers missing mandatory observation surfaces before snapshot or push', () => {
  for (const field of ['events', 'diagnostics', 'retention', 'projectEvents', 'executionFrames']) {
    const f = fixture(), proxy = Object.defineProperties({}, Object.getOwnPropertyDescriptors(f.framed));
    // Build a fresh interface instead of deleting frozen/nonconfigurable getters.
    const selected = { push: text => f.framed.push(text), finish: () => f.framed.finish() };
    for (const key of ['events', 'diagnostics', 'retention', 'projectEvents', 'executionFrames']) if (key !== field) Object.defineProperty(selected, key, { get: () => proxy[key] });
    assert.throws(() => createProjectEventPositionsReader({ runtimeReader: selected }), error => error instanceof TypeError && error.message === 'Invalid project event positions reader.');
  }
  for (const [field, value] of [['events', null], ['diagnostics', {}], ['retention', { total: -1 }], ['retention', { total: Number.MAX_SAFE_INTEGER + 1 }],
    ['projectEvents', { sequence: 0 }], ['executionFrames', { format: 'viento-project-execution-frames', totalFrames: 0 }]]) {
    const f = fixture(), selected = { push: text => f.framed.push(text), finish: () => f.framed.finish() };
    for (const key of ['events', 'diagnostics', 'retention', 'projectEvents', 'executionFrames']) Object.defineProperty(selected, key, { get: () => key === field ? value : f.framed[key] });
    assert.throws(() => createProjectEventPositionsReader({ runtimeReader: selected }), TypeError);
  }
});

test('an unrelated committed business callback failure never relocates the last event publication', () => {
  const f = fixture({ onEvent(frame) { if (frame.event === 'state') throw new Error('state observer'); } }); f.start(); f.publish(1);
  const before = f.value.eventPositions;
  assert.throws(() => f.push(stateFrame(f.scene, 1, 1, 'side_effect', true), clock(10)), /state observer/);
  assert.deepEqual(f.value.eventPositions.items, before.items); assert.deepEqual(f.value.eventPositions.counts, before.counts);
  assert.equal(f.value.sharedState.revision, 1); assert.equal(f.value.executionFrames.frames[0].reference.event, 'state');
  f.value.finish(); f.value.finish(); assert.equal(f.value.eventPositions.phase, 'incomplete'); assert.equal(f.value.retention.total, 5);
});
