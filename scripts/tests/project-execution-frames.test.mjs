import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createProjectExecutionFramesReader, PROJECT_EXECUTION_FRAME_PREFIX as prefix } from '../../engine/project-execution-frames.mjs';
import { createProjectExecutionClockReader, PROJECT_EXECUTION_CLOCK_PREFIX } from '../../engine/project-execution-clock.mjs';
import { createProjectPhysics2DTraceReader } from '../../engine/project-physics2d-trace.mjs';
import { createProjectRuntimeEventReader } from '../../engine/project-runtime-events.mjs';
import { PROJECT_RUNTIME_MAX_LINE, PROJECT_RUNTIME_MAX_EVENTS } from '../../engine/project-runtime-contracts.mjs';
import { runtimeProject, projectReady, enterScene, readyScene, sceneFrame, exitScene, finishProject, projectLine, returnTrip } from './helpers/project-runtime-fixture.mjs';
import { eventProject, eventReturnTrip } from './helpers/project-event-bus-fixture.mjs';
import { completionProject, completionRun } from './helpers/project-animation-completion-fixture.mjs';

const envelope = (frame, index = 1, clock = { idleFrame: index, physicsFrame: index }) => ({ protocol: 1, index, clock, frame });
const line = value => prefix + JSON.stringify(value) + '\n';
const wrap = frames => frames.map((frame, index) => line(envelope(frame, index + 1))).join('');
const initial = limit => ({ format: 'viento-project-execution-frames', schemaVersion: 1, phase: 'waiting', totalFrames: 0, frames: [],
  retention: { limit, total: 0, retained: 0, dropped: 0, firstIndex: null, lastIndex: null } });
function reader({ plan = runtimeProject(), protocolVersion = 1, onEvent, ...options } = {}) {
  const base = createProjectRuntimeEventReader(plan, { protocolVersion, retainedEvents: 1, onEvent });
  return { plan, base, value: createProjectExecutionFramesReader({ runtimeReader: base, ...options }) };
}
const zero = () => ({ eventRegistrations: 0, eventPublishes: 0, eventDeliveries: 0, eventBytes: 0, stateMutations: 0, audioRequests: 0, animationRequests: 0 });
const clockLine = reason => PROJECT_EXECUTION_CLOCK_PREFIX + JSON.stringify({ protocol: 1, event: 'sample', index: 1,
  clock: { idleFrame: 0, physicsFrame: 0 }, used: zero(), total: zero(), reason }) + '\n';

test('construction validates collaborators and bounded retention and exposes an isolated empty view', () => {
  assert.throws(() => createProjectExecutionFramesReader(), TypeError);
  for (const retainedFrames of [0, -1, 0.5, 4097, Infinity, '128', null]) assert.throws(() => reader({ retainedFrames }), TypeError);
  assert.throws(() => reader({ onSnapshot: true }), TypeError);
  const observed = [], { value } = reader({ onSnapshot: view => observed.push(view) });
  assert.deepEqual(value.executionFrames, initial(128)); assert.equal(observed.length, 1); assert.ok(Object.isFrozen(value));
  const view = value.executionFrames; view.frames.push({}); view.retention.total = 4;
  assert.deepEqual(value.executionFrames, initial(128)); assert.equal(value.reserve, undefined); assert.equal(value.reset, undefined);
});

test('each admitted project frame retains its exact position through fragmented input and raw retention eviction', () => {
  const snapshots = [], { value, plan } = reader({ retainedFrames: 3, onSnapshot: view => snapshots.push(view) });
  const frames = returnTrip(plan), admitted = [], wire = '日本語日志\r\n' + wrap(frames).replaceAll('\n', '\r\n');
  for (let offset = 0; offset < wire.length; offset += 7) admitted.push(...value.push(wire.slice(offset, offset + 7)));
  assert.deepEqual(admitted, frames); assert.deepEqual(value.finish().diagnostics, []);
  const view = value.executionFrames;
  assert.equal(view.phase, 'finished'); assert.equal(view.totalFrames, frames.length);
  assert.deepEqual(view.frames.map(row => row.index), [9, 10, 11]);
  assert.deepEqual(view.frames.map(row => row.clock), [9, 10, 11].map(index => ({ idleFrame: index, physicsFrame: index })));
  assert.deepEqual(view.retention, { limit: 3, total: 11, retained: 3, dropped: 8, firstIndex: 9, lastIndex: 11 });
  assert.equal(value.events.length, 1); assert.equal(value.retention.total, 11); assert.deepEqual(value.lifecycle, { started: true, completed: true });
  assert.deepEqual(view.frames[0].reference, { protocol: 1, event: 'scene-event', visitIndex: 3, sceneId: plan.scenes[0].scene.objectId, stream: 'runtime', childEvent: 'ready' });
  assert.deepEqual(view.frames[2].reference, { protocol: 1, event: 'finished', assemblyId: plan.assembly.objectId });
  view.frames[0].clock.idleFrame = 900; view.frames[0].reference.childEvent = 'injected'; view.frames.length = 0;
  assert.equal(value.executionFrames.frames.length, 3); assert.equal(value.executionFrames.frames[0].clock.idleFrame, 9);
  assert.equal(snapshots[1].totalFrames, 1); assert.equal(snapshots[1].frames[0].reference.event, 'ready');
});

test('same-clock frames stay distinct and event/completion identities never retain payload, state or source paths', () => {
  for (const [makePlan, makeFrames, protocolVersion] of [[eventProject, eventReturnTrip, 3], [completionProject, completionRun, 7]]) {
    const plan = makePlan(), { value } = reader({ plan, protocolVersion }), frames = makeFrames(plan);
    for (const [index, frame] of frames.entries()) assert.deepEqual(value.push(line(envelope(frame, index + 1, { idleFrame: 4, physicsFrame: 7 }))), [frame]);
    assert.deepEqual(value.finish().diagnostics, []); assert.equal(value.executionFrames.totalFrames, frames.length);
    for (const [index, row] of value.executionFrames.frames.entries()) {
      const frame = frames[index]; assert.equal(row.reference.event, frame.event); assert.equal(row.reference.protocol, protocolVersion);
      for (const key of ['sequence', 'commandSequence', 'completionSequence', 'subscriptionId', 'revision', 'bindingId', 'instanceId'])
        if (Object.hasOwn(frame, key)) assert.equal(row.reference[key], frame[key]);
      for (const key of ['frame', 'actors', 'payload', 'value', 'state', 'sourcePath', 'source', 'recipients']) assert.equal(Object.hasOwn(row.reference, key), false);
    }
  }
});

test('clock, physics and log streams remain independently delegated around enveloped business frames', () => {
  const plan = runtimeProject(), scene = plan.scenes[0], base = createProjectRuntimeEventReader(plan);
  const physics = createProjectPhysics2DTraceReader(plan, { runtimeReader: base });
  const clock = createProjectExecutionClockReader({ runtimeReader: physics });
  const value = createProjectExecutionFramesReader({ runtimeReader: clock });
  const frames = [projectReady(plan), enterScene(scene, 1), readyScene(scene, 1), exitScene(scene, 1, 0), finishProject(plan, 1, 0)];
  const trace = frame => 'VIENTO_PHYSICS2D:' + JSON.stringify(frame) + '\n';
  const wire = clockLine('sample') + line(envelope(frames[0], 1))
    + trace({ protocol: 1, event: 'ready', assemblyId: plan.assembly.objectId, limit: 256 })
    + frames.slice(1, 4).map((frame, index) => line(envelope(frame, index + 2))).join('')
    + trace({ protocol: 1, event: 'finished', sampleCount: 0, limited: false })
    + line(envelope(frames[4], 5)) + 'ordinary log\n' + clockLine('finished');
  const accepted = [];
  for (const character of wire) accepted.push(...value.push(character));
  assert.deepEqual(accepted, frames); assert.deepEqual(value.finish().diagnostics, []);
  assert.equal(value.executionFrames.phase, 'finished'); assert.equal(value.executionClock.phase, 'finished');
  assert.equal(value.snapshot().phase, 'finished'); assert.equal(value.retention.total, 5);
});

test('duplicate, skipped, reversed and malformed envelopes never reach or advance business state', () => {
  const changes = [row => row.protocol = 2, row => row.index = 1, row => row.index = 3, row => row.index = 0,
    row => row.index = 1.5, row => row.index = Number.MAX_SAFE_INTEGER + 1, row => row.extra = true,
    row => row.clock.idleFrame = 3, row => row.clock.physicsFrame = 3, row => row.clock.idleFrame = -1,
    row => row.clock.idleFrame = 1.5, row => row.clock.physicsFrame = Number.MAX_SAFE_INTEGER + 1,
    row => row.clock.extra = 1, row => delete row.clock.idleFrame, row => row.clock = [], row => delete row.frame];
  for (const change of changes) {
    const { value, plan } = reader(); value.push(line(envelope(projectReady(plan), 1, { idleFrame: 4, physicsFrame: 4 })));
    const before = value.executionFrames, bad = envelope(enterScene(plan.scenes[0], 1), 2, { idleFrame: 4, physicsFrame: 4 }); change(bad);
    assert.deepEqual(value.push(line(bad)), []); assert.deepEqual(value.executionFrames, before);
    assert.equal(value.retention.total, 1); assert.equal(value.diagnostics.length, 1); assert.equal(value.diagnostics[0].code, 'runtime_execution_frame_invalid');
    assert.equal(value.push(line(envelope(enterScene(plan.scenes[0], 1), 2, { idleFrame: 4, physicsFrame: 4 }))).length, 1);
  }
});

test('malformed JSON and prototype fields never enter the project reader', () => {
  const { value } = reader();
  for (const raw of ['{', 'null', '[]', 'false', '{"__proto__":{}}', '{"constructor":0}']) value.push(prefix + raw + '\n');
  assert.equal(value.executionFrames.totalFrames, 0); assert.equal(value.retention.total, 0); assert.equal(value.diagnostics.length, 6);
  assert.ok(value.diagnostics.every(row => row.code === 'runtime_execution_frame_invalid'));
});

test('invalid business frames retain original diagnostics and do not consume an index or clock advance', () => {
  const { value, plan } = reader();
  value.push(line(envelope(enterScene(plan.scenes[0], 1), 1, { idleFrame: 100, physicsFrame: 100 })));
  assert.equal(value.executionFrames.totalFrames, 0); assert.equal(value.retention.total, 0);
  assert.equal(value.diagnostics.length, 1); assert.equal(value.diagnostics[0].code, 'runtime_project_protocol_invalid');
  assert.deepEqual(value.push(line(envelope(projectReady(plan), 1, { idleFrame: 0, physicsFrame: 0 }))), [projectReady(plan)]);
  value.finish(); assert.equal(value.executionFrames.phase, 'incomplete');
});

test('bare project lines are rejected before the old reader, including a fragmented final line', () => {
  const { value, plan } = reader(); const bare = projectLine(projectReady(plan)).trimEnd();
  for (const character of bare) value.push(character);
  assert.equal(value.retention.total, 0); assert.equal(value.diagnostics[0].code, 'runtime_execution_frame_invalid');
  value.push('\n' + line(envelope(projectReady(plan))));
  assert.equal(value.retention.total, 1); assert.equal(value.executionFrames.totalFrames, 1);
  value.finish(); assert.equal(value.executionFrames.phase, 'incomplete');
});

test('oversized envelopes and wrapped business lines are rejected without widening the original frame limit', () => {
  const { value, plan } = reader();
  value.push(prefix + ' '.repeat(PROJECT_RUNTIME_MAX_LINE + 600));
  for (let index = 0; index < 8; index++) value.push('x'.repeat(PROJECT_RUNTIME_MAX_LINE));
  value.push('\n' + line(envelope(projectReady(plan))));
  assert.equal(value.retention.total, 1); assert.equal(value.diagnostics.length, 1); assert.equal(value.diagnostics[0].code, 'runtime_execution_frame_limit');
  const next = reader();
  const over = { protocol: 1, event: 'ready', text: 'x'.repeat(PROJECT_RUNTIME_MAX_LINE - 32) };
  next.value.push(line(envelope(over)));
  assert.equal(next.value.retention.total, 0); assert.equal(next.value.diagnostics[0].code, 'runtime_execution_frame_limit');
  const unicode = reader();
  unicode.value.push(line(envelope(projectReady(unicode.plan))).trimEnd() + ' '.repeat(200) + '\r\n');
  assert.equal(unicode.value.retention.total, 1); assert.deepEqual(unicode.value.diagnostics, []);
});

test('the exact project line ceiling includes its newline before envelope delegation', () => {
  const plan = runtimeProject(), ready = projectReady(plan), plain = projectLine(ready);
  for (const ending of ['\n', '\r\n']) {
    const wire = plain.slice(0, -1).padEnd(PROJECT_RUNTIME_MAX_LINE - ending.length, ' ') + ending;
    assert.equal(wire.length, PROJECT_RUNTIME_MAX_LINE);
    const exact = createProjectRuntimeEventReader(plan), over = createProjectRuntimeEventReader(plan);
    assert.deepEqual(exact.push(wire), [ready]); assert.deepEqual(exact.diagnostics, []);
    assert.deepEqual(over.push('VIENTO_PROJECT: ' + wire.slice('VIENTO_PROJECT:'.length)), []);
    assert.equal(over.diagnostics[0].message, 'Project runtime frame budget exceeded.');
  }
  for (const extra of [0, 1]) {
    // An unknown field deliberately reaches the original strict DTO validator
    // at the exact line ceiling. One extra character must be rejected earlier.
    const frame = { ...ready, padding: '' };
    frame.padding = 'x'.repeat(PROJECT_RUNTIME_MAX_LINE - projectLine(frame).length + extra);
    assert.equal(projectLine(frame).length, PROJECT_RUNTIME_MAX_LINE + extra);
    const base = createProjectRuntimeEventReader(plan), delegated = [];
    const value = createProjectExecutionFramesReader({ runtimeReader: {
      push(text) { delegated.push(text); return base.push(text); }, finish: () => base.finish(),
      get events() { return base.events; }, get diagnostics() { return base.diagnostics; },
      get retention() { return base.retention; },
    } });
    value.push(line(envelope(frame)));
    assert.deepEqual(delegated, extra ? [] : [projectLine(frame)]);
    assert.equal(value.retention.total, 0); assert.equal(value.executionFrames.totalFrames, 0);
    assert.equal(value.diagnostics[0].code, extra ? 'runtime_execution_frame_limit' : 'runtime_project_protocol_invalid');
    if (!extra) assert.equal(value.diagnostics[0].message, 'Invalid project runtime protocol frame.');
  }
});

test('huge non-envelope lines and partial unrelated prefixes pass through without being buffered here', () => {
  const chunks = [], base = createProjectRuntimeEventReader(runtimeProject());
  const delegate = { push(text) { chunks.push(text); return base.push(text); }, finish: () => base.finish(),
    get events() { return base.events; }, get diagnostics() { return base.diagnostics; } };
  const value = createProjectExecutionFramesReader({ runtimeReader: delegate });
  const chunk = 'x'.repeat(100000);
  value.push('log:' + chunk); assert.equal(chunks.join('').length, 100004);
  value.push(chunk); assert.equal(chunks.join('').length, 200004);
  value.push('\nVIENTO_EXE\nVIENTO_EXECUTION_'); value.finish();
  assert.equal(chunks.join(''), 'log:' + chunk + chunk + '\nVIENTO_EXE\nVIENTO_EXECUTION_');
  assert.deepEqual(value.diagnostics, []); assert.equal(value.executionFrames.phase, 'incomplete');
});

test('envelope parsing and admitted business frames remain bounded by the existing 4096-frame ceiling', () => {
  const { value, plan } = reader({ retainedFrames: 2 }), scene = plan.scenes[0];
  const first = [projectReady(plan), enterScene(scene, 1), readyScene(scene, 1)]; value.push(wrap(first));
  const state = sceneFrame(scene, 1, { protocol: 2, event: 'state', instanceId: scene.actors[0].instanceId, objectId: scene.actors[0].objectId, state: 'idle' });
  for (let index = 4; index <= PROJECT_RUNTIME_MAX_EVENTS; index++) value.push(line(envelope(state, index)));
  assert.equal(value.retention.total, 4096); assert.equal(value.executionFrames.totalFrames, 4096);
  for (let index = 0; index < 3; index++) value.push(line(envelope(state, 4097)));
  assert.equal(value.diagnostics.length, 1); assert.equal(value.diagnostics[0].code, 'runtime_execution_frame_limit');
  assert.deepEqual(value.executionFrames.retention, { limit: 2, total: 4096, retained: 2, dropped: 4094, firstIndex: 4095, lastIndex: 4096 });
  value.finish(); assert.equal(value.executionFrames.phase, 'incomplete');
  const malformed = reader(); malformed.value.push((prefix + '{}\n').repeat(4097));
  malformed.value.push(line(envelope(projectReady(malformed.plan))));
  assert.equal(malformed.value.executionFrames.totalFrames, 0); assert.equal(malformed.value.diagnostics.length, 128);
});

test('outer observer exceptions preserve admitted snapshots without replay and allow subsequent business frames', () => {
  let calls = 0;
  const { value, plan } = reader({ onSnapshot: view => { calls++; view.frames.length = 0; if (calls === 2) throw new Error('observer failed'); } });
  const frames = returnTrip(plan);
  assert.throws(() => value.push(line(envelope(frames[0], 1))), /observer failed/);
  assert.equal(value.executionFrames.totalFrames, 1); assert.equal(value.retention.total, 1);
  value.push(frames.slice(1).map((frame, index) => line(envelope(frame, index + 2))).join(''));
  assert.deepEqual(value.finish().diagnostics, []); assert.equal(value.executionFrames.phase, 'finished');
  assert.equal(value.executionFrames.totalFrames, frames.length);
});

test('a failing observer on an unterminated finished envelope cannot cause replay during a second finish', () => {
  let failed = false;
  const { value, plan } = reader({ onSnapshot: view => { if (view.phase === 'finished' && !failed) { failed = true; throw new Error('terminal observer'); } } });
  const frames = returnTrip(plan); value.push(wrap(frames.slice(0, -1)));
  value.push(line(envelope(frames.at(-1), frames.length)).trimEnd());
  assert.throws(() => value.finish(), /terminal observer/);
  assert.equal(value.retention.total, frames.length); assert.equal(value.executionFrames.totalFrames, frames.length);
  assert.deepEqual(value.finish().diagnostics, []); assert.equal(value.executionFrames.phase, 'finished');
  assert.deepEqual(value.push(line(envelope(frames.at(-1), frames.length + 1))), []);
});

test('a final clock observer failure preserves its retry notification without replaying business frames', () => {
  const plan = runtimeProject(); let calls = 0;
  const base = createProjectRuntimeEventReader(plan);
  const clock = createProjectExecutionClockReader({ runtimeReader: base, onSnapshot(view) {
    if (view.totalWindows) { calls++; throw new Error('final clock observer'); }
  } });
  const value = createProjectExecutionFramesReader({ runtimeReader: clock });
  value.push(line(envelope(projectReady(plan))));
  value.push(clockLine('sample').trimEnd());
  assert.throws(() => value.finish(), /final clock observer/);
  assert.equal(calls, 1); assert.equal(value.executionClock.totalWindows, 1);
  assert.equal(value.executionFrames.totalFrames, 1); assert.equal(value.executionFrames.phase, 'incomplete');
  assert.deepEqual(value.push(line(envelope(enterScene(plan.scenes[0], 1), 2))), []);
  assert.throws(() => value.finish(), /final clock observer/);
  assert.equal(calls, 2); assert.equal(value.executionClock.totalWindows, 1);
  assert.deepEqual(value.finish().diagnostics, []);
  assert.equal(calls, 2); assert.equal(value.retention.total, 1);
  assert.equal(value.executionFrames.totalFrames, 1); assert.equal(value.executionFrames.phase, 'incomplete');
  assert.equal(value.executionClock.phase, 'incomplete');
});

test('a complete independent clock notification failure retains its final observer notification', () => {
  const plan = runtimeProject(); let calls = 0;
  const base = createProjectRuntimeEventReader(plan);
  const clock = createProjectExecutionClockReader({ runtimeReader: base, onSnapshot(view) {
    if (view.totalWindows) { calls++; throw new Error('clock stream observer'); }
  } });
  const value = createProjectExecutionFramesReader({ runtimeReader: clock });
  value.push(line(envelope(projectReady(plan))));
  assert.throws(() => value.push(clockLine('sample')), /clock stream observer/);
  assert.equal(calls, 1); assert.equal(value.executionClock.totalWindows, 1);
  assert.equal(value.executionFrames.phase, 'incomplete');
  assert.deepEqual(value.push(line(envelope(enterScene(plan.scenes[0], 1), 2))), []);
  assert.throws(() => value.finish(), /clock stream observer/);
  assert.equal(calls, 2); assert.equal(value.executionClock.totalWindows, 1);
  assert.deepEqual(value.finish().diagnostics, []);
  assert.equal(value.retention.total, 1); assert.equal(value.executionFrames.totalFrames, 1);
  assert.equal(value.executionClock.phase, 'incomplete'); assert.equal(value.executionFrames.phase, 'incomplete');
});

test('underlying onEvent exceptions recover the admitted identity and quarantine pending delegate buffers', () => {
  const plan = runtimeProject(); let calls = 0;
  const base = createProjectRuntimeEventReader(plan, { onEvent() { calls++; throw new Error('business observer'); } });
  const clock = createProjectExecutionClockReader({ runtimeReader: base });
  clock.push(clockLine('sample'));
  const value = createProjectExecutionFramesReader({ runtimeReader: clock });
  assert.throws(() => value.push(line(envelope(projectReady(plan)))), /business observer/);
  assert.equal(value.executionFrames.totalFrames, 1); assert.equal(value.executionFrames.phase, 'incomplete');
  assert.equal(value.executionFrames.frames[0].reference.event, 'ready'); assert.equal(value.executionClock.totalWindows, 1);
  assert.equal(value.retention.total, 1); assert.equal(calls, 1);
  assert.deepEqual(value.finish().diagnostics, []); assert.equal(calls, 1);
  assert.equal(value.retention.total, 1); assert.deepEqual(value.push(line(envelope(enterScene(plan.scenes[0], 1), 2))), []);
});

test('incomplete runs, malformed terminal frames and post-terminal envelopes never invent completion', () => {
  const { value, plan } = reader(); value.push(line(envelope(projectReady(plan))));
  value.finish(); assert.equal(value.executionFrames.phase, 'incomplete');
  const snapshot = value.executionFrames; value.finish(); assert.deepEqual(value.executionFrames, snapshot);
  const done = reader(); done.value.push(wrap(returnTrip(done.plan)));
  done.value.push(line(envelope(projectReady(done.plan), returnTrip(done.plan).length + 1)));
  assert.equal(done.value.executionFrames.totalFrames, returnTrip(done.plan).length);
  done.value.finish(); assert.equal(done.value.executionFrames.phase, 'incomplete');
  const tail = reader(); tail.value.push(prefix + '{'); tail.value.finish();
  assert.equal(tail.value.executionFrames.phase, 'incomplete'); assert.equal(tail.value.retention.total, 0);
});
