import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createProjectAudioRequestsReader, PROJECT_AUDIO_REQUEST_PREFIX as prefix } from '../../engine/project-audio-requests.mjs';
import { createProjectAnimationRequestsReader, PROJECT_ANIMATION_REQUEST_PREFIX } from '../../engine/project-animation-requests.mjs';
import { createProjectExecutionFramesReader, PROJECT_EXECUTION_FRAME_PREFIX } from '../../engine/project-execution-frames.mjs';
import { createProjectExecutionClockReader, PROJECT_EXECUTION_CLOCK_PREFIX } from '../../engine/project-execution-clock.mjs';
import { createProjectRuntimeEventReader } from '../../engine/project-runtime-events.mjs';
import { audioProject, audioProjectReady, audioProjectFinished, audioReady, audioFinished, audioCommand, audioReturnTrip } from './helpers/project-audio-command-fixture.mjs';
import { completionProject, completionCommand } from './helpers/project-animation-completion-fixture.mjs';
import { runtimeId, enterScene, readyScene, sceneFrame, exitScene } from './helpers/project-runtime-fixture.mjs';

const clone = value => structuredClone(value), clock = (idleFrame = 0, physicsFrame = idleFrame) => ({ idleFrame, physicsFrame });
const wire = (frame, tag = prefix) => tag + JSON.stringify(frame) + '\n';
const business = (frame, index, position = clock()) => wire({ protocol: 1, index, clock: position, frame }, PROJECT_EXECUTION_FRAME_PREFIX);
const origin = (scene, visitIndex = 1, bindingIndex = 0) => {
  const { bindingId, instanceId, objectId } = scene.behaviors.bindings[bindingIndex];
  return { visitIndex, sceneId: scene.scene.objectId, bindingId, instanceId, objectId };
};
const accepted = (scene, requestId = 1, action = 'play', position = clock(), visitIndex = 1) =>
  ({ protocol: 1, event: 'accepted', requestId, clock: position, origin: origin(scene, visitIndex), trackId: scene.audio.document.tracks[0].id, action });
const applied = (requestId, commandSequence, executionFrameIndex, position = clock()) =>
  ({ protocol: 1, event: 'applied', requestId, clock: position, commandSequence, executionFrameIndex });
const discarded = (requestId, position = clock()) => ({ protocol: 1, event: 'discarded', requestId, clock: position, reason: 'abort' });
const counts = (accepted, applied = 0, discarded = 0) => ({ accepted, applied, discarded, pending: accepted - applied - discarded });
function mixedPlan() {
  const plan = completionProject(), audio = audioProject({ empty: true });
  for (const [index, scene] of plan.scenes.entries()) {
    scene.audio = audio.scenes[index].audio;
    scene.resources = audio.scenes[index].resources;
    scene.requiredCapabilities = [...new Set([...scene.requiredCapabilities, ...audio.scenes[index].requiredCapabilities])];
  }
  plan.resources = audio.resources;
  plan.requiredCapabilities = [...new Set(['project.scenes', ...plan.scenes.flatMap(scene => scene.requiredCapabilities)])].sort();
  return plan;
}
function fixture({ plan = audioProject({ empty: true }), protocolVersion = 4, mixed = false, audioOuter = true,
  onEvent, onClock, onAnimation, transform, ...options } = {}) {
  const base = createProjectRuntimeEventReader(plan, { protocolVersion, retainedEvents: 1, onEvent });
  const scheduled = onClock ? createProjectExecutionClockReader({ runtimeReader: base, onSnapshot: onClock }) : base;
  const framed = createProjectExecutionFramesReader({ runtimeReader: scheduled, retainedFrames: 1 });
  let reader = transform ? transform(framed) : framed;
  if (mixed && audioOuter) reader = createProjectAnimationRequestsReader(plan, { runtimeReader: reader, protocolVersion, onSnapshot: onAnimation });
  reader = createProjectAudioRequestsReader(plan, { runtimeReader: reader, protocolVersion, ...options });
  if (mixed && !audioOuter) reader = createProjectAnimationRequestsReader(plan, { runtimeReader: reader, protocolVersion, onSnapshot: onAnimation });
  const f = { value: reader, plan, scene: plan.scenes[0], base, framed, index: 0 };
  f.up = frame => ({ ...frame, protocol: protocolVersion,
    ...(['ready', 'finished'].includes(frame.event) ? {
      ...(protocolVersion >= 5 ? { animationCommandSequence: 0 } : {}),
      ...(protocolVersion >= 7 ? { animationCompletionSequence: 0 } : {}),
      ...(protocolVersion >= 8 ? { animationStateSequence: 0 } : {}),
      ...(protocolVersion >= 9 ? { animationStateEntrySequence: 0 } : {}),
    } : {}) });
  f.push = (frame, position = clock()) => reader.push(business(f.up(frame), ++f.index, position));
  f.start = () => [audioProjectReady(plan), enterScene(f.scene, 1), readyScene(f.scene, 1), audioReady(f.scene, 1)].forEach(frame => f.push(frame));
  f.command = (sequence = 1, action = 'play', position = clock(), scene = f.scene, visitIndex = 1) => f.push(audioCommand(scene, visitIndex, sequence, action), position);
  f.apply = (requestId, sequence = requestId, position = clock()) => reader.push(wire(applied(requestId, sequence, f.index, position)));
  f.error = () => f.push(sceneFrame(f.scene, 1, { protocol: 3, event: 'diagnostic', severity: 'error', code: 'runtime_behavior_audio_unavailable', message: 'Unavailable audio.' }));
  f.end = sequence => {
    f.push(audioFinished(f.scene, 1, 0)); f.push(exitScene(f.scene, 1, 0));
    f.push(audioProjectFinished(plan, 1, 0, sequence)); return reader.finish();
  };
  return f;
}

test('audio construction validates supported protocols, framing and detached options', () => {
  assert.throws(() => createProjectAudioRequestsReader(audioProject()), TypeError);
  assert.throws(() => createProjectAudioRequestsReader(audioProject(), { runtimeReader: createProjectRuntimeEventReader(audioProject(), { protocolVersion: 4 }) }), TypeError);
  for (const protocolVersion of [1, 3, 12, '4', null]) assert.throws(() => fixture({ protocolVersion }), TypeError);
  for (const retainedRequests of [0, -1, .5, 257, Infinity, '1', null]) assert.throws(() => fixture({ retainedRequests }), TypeError);
  assert.throws(() => fixture({ onSnapshot: true }), TypeError);
  for (const protocolVersion of [4, 5, 6, 7, 8, 9, 10]) {
    const f = fixture({ protocolVersion }); f.start(); f.value.push(wire(accepted(f.scene))); f.command(); f.apply(1);
    assert.deepEqual(f.value.audioRequests.counts, counts(1, 1)); assert.deepEqual(f.value.diagnostics, []);
  }
  const seen = [], f = fixture({ onSnapshot: view => seen.push(view) });
  assert.equal(seen.length, 1); assert.equal(f.value.audioRequests.phase, 'waiting'); assert.ok(Object.isFrozen(f.value));
  const view = f.value.audioRequests; view.counts.accepted = 9; view.requests.push({});
  assert.deepEqual(f.value.audioRequests.counts, counts(0)); assert.deepEqual(f.value.audioRequests.requests, []);
});

test('fragmented accepted/applied observations preserve old return-trip DTOs and separate track sources', () => {
  const plan = audioProject(), f = fixture({ plan }), run = audioReturnTrip(plan), seen = []; let requestId = 0;
  for (const [index, frame] of run.entries()) {
    const position = clock(index, Math.floor(index / 2)), chunks = [];
    if (frame.event === 'audio-command') {
      const scene = plan.scenes.find(scene => scene.scene.objectId === frame.sceneId);
      chunks.push(wire(accepted(scene, ++requestId, frame.action, position, frame.visitIndex)));
    }
    chunks.push(business(frame, index + 1, position));
    if (frame.event === 'audio-command') chunks.push(wire(applied(requestId, frame.commandSequence, index + 1, position)));
    const text = chunks.join('').replaceAll('\n', '\r\n');
    for (let offset = 0; offset < text.length; offset += 3) seen.push(...f.value.push(text.slice(offset, offset + 3)));
  }
  assert.deepEqual(seen, run); assert.deepEqual(f.value.finish().diagnostics, []);
  const view = f.value.audioRequests;
  assert.equal(view.phase, 'finished'); assert.deepEqual(view.counts, counts(6, 6));
  assert.deepEqual(view.requests[0].origin.source, plan.scenes[0].behaviors.bindings[0].declaration);
  assert.deepEqual(view.requests[0].track.source, plan.scenes[0].audio.locations.tracks[0].declaration);
  assert.notEqual(view.requests[0].origin.source.objectId, view.requests[0].track.source.objectId);
  assert.equal(f.value.audioCommands.sequence, 6); assert.equal(f.value.events.length, 1); assert.equal(f.value.executionFrames.frames.length, 1);
  view.requests[0].track.source.sourcePath = 'forged'; view.requests[0].origin.source.propertyPath = 'forged'; view.requests[0].applied.clock.idleFrame = 999;
  assert.notEqual(f.value.audioRequests.requests[0].track.source.sourcePath, 'forged');
  assert.notEqual(f.value.audioRequests.requests[0].origin.source.propertyPath, 'forged');
  assert.notEqual(f.value.audioRequests.requests[0].applied.clock.idleFrame, 999);
});

test('audio accepted payload rejects forged identities, paths, track targets, actions and clocks without consuming IDs', () => {
  const mutations = [row => row.protocol = 2, row => row.requestId = 2, row => row.requestId = .5,
    row => row.requestId = Number.MAX_SAFE_INTEGER + 1, row => row.extra = true, row => row.origin.source = {},
    row => row.origin.visitIndex = 2, row => row.origin.sceneId = runtimeId(900), row => row.origin.bindingId = runtimeId(900),
    row => row.origin.instanceId = runtimeId(900), row => row.origin.objectId = runtimeId(900), row => row.trackId = runtimeId(900),
    row => row.resourceId = runtimeId(900), row => row.track = { source: {} }, row => row.source = {}, row => row.target = { kind: 'scene' },
    row => row.action = 'pause', row => row.action = { action: 'play' }, row => row.clock = clock(-1), row => row.clock = clock(.5),
    row => row.clock = clock(Number.MAX_SAFE_INTEGER + 1), row => row.clock.extra = true];
  for (const mutate of mutations) {
    const f = fixture(); f.start(); const row = accepted(f.scene); mutate(row); f.value.push(wire(row));
    assert.deepEqual(f.value.audioRequests.counts, counts(0)); assert.equal(f.value.retention.total, 4);
    assert.equal(f.value.diagnostics[0].code, 'runtime_audio_request_invalid');
    f.value.push(wire(accepted(f.scene))); assert.deepEqual(f.value.audioRequests.counts, counts(1));
  }
  const f = fixture(); f.value.push(wire(accepted(f.scene))); assert.equal(f.value.audioRequests.counts.accepted, 0); f.start();
  f.value.push(wire(accepted(f.scene, 1, 'play', clock(2, 3))));
  f.value.push(wire(accepted(f.scene, 2, 'play', clock(3, 2)))); assert.deepEqual(f.value.audioRequests.counts, counts(1));
  const original = clone(f.scene.audio.locations.tracks[0].declaration);
  f.scene.audio.locations.tracks[0].declaration.sourcePath = 'edited-after-construction';
  assert.deepEqual(f.value.audioRequests.requests[0].track.source, original);
});

test('audio outcomes require FIFO and the matching admitted receipt at the exact current position', () => {
  for (const mutate of [row => row.requestId = 2, row => row.commandSequence = 2, row => row.executionFrameIndex--,
    row => row.clock.idleFrame++, row => row.extra = true]) {
    const f = fixture(); f.start(); f.value.push(wire(accepted(f.scene)) + wire(accepted(f.scene, 2)));
    f.command(); const row = applied(1, 1, f.index); mutate(row); f.value.push(wire(row));
    assert.deepEqual(f.value.audioRequests.counts, counts(2)); f.apply(1); assert.deepEqual(f.value.audioRequests.counts, counts(2, 1));
    f.apply(1); assert.deepEqual(f.value.audioRequests.counts, counts(2, 1));
  }
  const early = fixture(); early.start(); early.value.push(wire(accepted(early.scene))); early.apply(1);
  assert.deepEqual(early.value.audioRequests.counts, counts(1)); assert.equal(early.value.audioCommands.sequence, 0);
  const late = fixture(); late.start(); late.value.push(wire(accepted(late.scene))); late.command(); const oldIndex = late.index;
  late.push(sceneFrame(late.scene, 1, { protocol: 3, event: 'state', instanceId: late.scene.actors[0].instanceId, objectId: late.scene.actors[0].objectId, state: 'idle' }));
  late.value.push(wire(applied(1, 1, oldIndex))); assert.deepEqual(late.value.audioRequests.counts, counts(1));
});

test('audio receipt matching rejects another action, valid track or binding without erasing old business evidence', () => {
  for (const alternative of ['action', 'track', 'binding']) {
    const plan = audioProject({ empty: true }), scene = plan.scenes[0];
    const extraTrack = { ...scene.audio.document.tracks[0], id: runtimeId(700) };
    scene.audio.document.tracks.push(extraTrack); scene.audio.locations.tracks.push({ id: extraTrack.id, declaration: { ...scene.audio.manifest, propertyPath: '/tracks/1' } });
    const actor = scene.actors[1], binding = { ...clone(scene.behaviors.bindings[0]), bindingId: runtimeId(701), instanceId: actor.instanceId, objectId: actor.objectId };
    binding.declaration.propertyPath = '/bindings/1'; scene.behaviors.bindings.push(binding);
    const f = fixture({ plan }); f.start(); f.value.push(wire(accepted(scene)));
    const frame = audioCommand(scene, 1, 1);
    if (alternative === 'action') frame.action = 'stop';
    if (alternative === 'track') frame.trackId = extraTrack.id;
    if (alternative === 'binding') Object.assign(frame, origin(scene, 1, 1));
    f.push(frame); f.apply(1);
    assert.equal(f.value.audioCommands.sequence, 1, alternative); assert.deepEqual(f.value.audioRequests.counts, counts(1));
    assert.equal(f.value.audioRequests.phase, 'incomplete');
  }
});

test('invalid audio business remains original diagnostic evidence and cannot settle a request', () => {
  const f = fixture(); f.start(); f.value.push(wire(accepted(f.scene)));
  f.value.push(business({ ...audioCommand(f.scene, 1, 1), resourceId: runtimeId(999) }, 5));
  f.value.push(wire(applied(1, 1, 5)));
  assert.equal(f.value.audioCommands.sequence, 0); assert.equal(f.value.executionFrames.totalFrames, 4);
  assert.deepEqual(f.value.audioRequests.counts, counts(1)); assert.ok(f.value.diagnostics.some(d => d.code === 'runtime_project_protocol_invalid'));
  f.command(); f.apply(1); assert.deepEqual(f.value.audioRequests.counts, counts(1, 1));
});

test('audio abort requires actual runtime error and cannot rewrite a committed pending receipt', () => {
  const f = fixture(); f.start(); f.value.push(wire(accepted(f.scene)) + wire(accepted(f.scene, 2)));
  f.value.push(wire(discarded(1))); assert.deepEqual(f.value.audioRequests.counts, counts(2));
  f.error(); f.value.push(wire(discarded(2))); assert.deepEqual(f.value.audioRequests.counts, counts(2));
  f.value.push(wire(discarded(1)) + wire(discarded(2))); assert.deepEqual(f.value.audioRequests.counts, counts(2, 0, 2));
  f.value.push(wire(accepted(f.scene, 3))); assert.equal(f.value.audioRequests.counts.accepted, 2);
  const committed = fixture(); committed.start(); committed.value.push(wire(accepted(committed.scene))); committed.command(); committed.error();
  committed.value.push(wire(discarded(1))); assert.deepEqual(committed.value.audioRequests.counts, counts(1));
});

test('audio pending capacity and lifetime attempt limit do not consume rejected identities or old command budgets', () => {
  const f = fixture(); f.start();
  for (let id = 1; id <= 64; id++) f.value.push(wire(accepted(f.scene, id)));
  f.value.push(wire(accepted(f.scene, 64)) + wire(accepted(f.scene, 65))); assert.deepEqual(f.value.audioRequests.counts, counts(64));
  f.command(); f.apply(1); f.value.push(wire(accepted(f.scene, 65))); assert.deepEqual(f.value.audioRequests.counts, counts(65, 1));
  const full = fixture({ retainedRequests: 1 }); full.start();
  for (let id = 1; id <= 256; id++) { full.value.push(wire(accepted(full.scene, id))); full.command(id); full.apply(id); }
  assert.deepEqual(full.value.audioRequests.counts, counts(256, 256)); assert.equal(full.value.audioRequests.requests.length, 1);
  full.value.push(wire(accepted(full.scene, 257))); assert.deepEqual(full.value.audioRequests.counts, counts(256, 256));
  assert.equal(full.value.diagnostics.at(-1).code, 'runtime_audio_request_limit'); assert.equal(full.value.audioCommands.sequence, 256);
  const bounded = fixture(); bounded.start(); bounded.value.push((prefix + '{}\n').repeat(600)); bounded.value.push(wire(accepted(bounded.scene)));
  assert.deepEqual(bounded.value.audioRequests.counts, counts(0)); assert.equal(bounded.value.diagnostics.length, 128);
});

test('audio terminal tail retains every pending request independently of old raw and receipt ledgers', () => {
  const f = fixture(); f.start();
  for (let id = 1; id <= 130; id++) { f.value.push(wire(accepted(f.scene, id))); f.command(id); f.apply(id); }
  for (let id = 131; id <= 194; id++) f.value.push(wire(accepted(f.scene, id)));
  assert.deepEqual(f.value.audioRequests.counts, counts(194, 130));
  assert.deepEqual(f.value.audioRequests.retention, { limit: 128, total: 194, retained: 192, dropped: 2, pending: 64, terminal: 128, firstRequestId: 3, lastRequestId: 194 });
  assert.equal(f.value.audioCommands.sequence, 130); assert.equal(f.value.events.length, 1); f.value.finish();
  assert.equal(f.value.audioRequests.phase, 'incomplete'); assert.equal(f.value.audioRequests.counts.pending, 64);
});

test('audio line framing has strict UTF-8 boundaries and streams enormous unrelated logs', () => {
  const chunks = [], f = fixture({ transform: framed => ({
    push(text) { chunks.push(text); return framed.push(text); }, finish: () => framed.finish(),
    get events() { return framed.events; }, get diagnostics() { return framed.diagnostics; },
    get retention() { return framed.retention; }, get executionFrames() { return framed.executionFrames; },
  }) });
  const huge = 'log:' + 'x'.repeat(200000); f.value.push(huge); assert.equal(chunks.join(''), huge); f.value.push('\n'); f.start();
  const line = wire(accepted(f.scene)).trimEnd(), padded = line + ' '.repeat(16384 - new TextEncoder().encode(line).length);
  f.value.push(padded + '\r\n'); assert.deepEqual(f.value.audioRequests.counts, counts(1));
  f.value.push(prefix + '雪'.repeat(6000) + '\n');
  f.value.push(prefix + 'x'.repeat(20000)); f.value.push('x'.repeat(100000)); f.value.push('\n');
  assert.equal(f.value.diagnostics.filter(d => d.code === 'runtime_audio_request_limit').length, 2);
  for (const raw of ['{', 'null', '[]', '{"__proto__":{}}']) f.value.push(prefix + raw + '\n');
  assert.deepEqual(f.value.audioRequests.counts, counts(1));
});

test('audio own snapshot exceptions retain accepted and unterminated applied facts without replay', () => {
  let failed = false;
  const f = fixture({ onSnapshot(view) { if (view.counts.accepted && !failed) { failed = true; throw new Error('accepted observer'); } } }); f.start();
  assert.throws(() => f.value.push(wire(accepted(f.scene))), /accepted observer/);
  f.command(); f.apply(1); assert.deepEqual(f.end(1).diagnostics, []); assert.equal(f.value.audioRequests.phase, 'finished');
  let calls = 0;
  const tail = fixture({ onSnapshot(view) { if (view.counts.applied && calls++ === 0) throw new Error('tail observer'); } }); tail.start();
  tail.value.push(wire(accepted(tail.scene))); tail.command(); tail.value.push(wire(applied(1, 1, tail.index)).trimEnd());
  assert.throws(() => tail.value.finish(), /tail observer/); tail.value.finish();
  assert.deepEqual(tail.value.audioRequests.counts, counts(1, 1)); assert.equal(tail.value.retention.total, 5);
});

test('audio committed business observer errors keep actual receipt and pending outcome without replay', () => {
  let calls = 0;
  const f = fixture({ onEvent(frame) { if (frame.event === 'audio-command') { calls++; throw new Error('committed observer'); } } }); f.start();
  f.value.push(wire(accepted(f.scene))); assert.throws(() => f.command(), /committed observer/);
  assert.equal(f.value.audioCommands.sequence, 1); assert.equal(f.value.executionFrames.totalFrames, 5);
  assert.deepEqual(f.value.audioRequests.counts, counts(1)); assert.equal(f.value.audioRequests.phase, 'incomplete');
  f.apply(1); f.value.finish(); f.value.finish(); assert.equal(calls, 1); assert.equal(f.value.retention.total, 5);
});

test('audio missing accepted or applied markers never manufacture an outcome', () => {
  for (const execute of [false, true]) {
    const f = fixture(); f.start(); f.value.push(wire(accepted(f.scene))); if (execute) f.command(); f.value.finish();
    assert.deepEqual(f.value.audioRequests.counts, counts(1)); assert.equal(f.value.audioCommands.sequence, Number(execute));
    assert.equal(f.value.audioRequests.phase, 'incomplete'); assert.equal(f.value.audioRequests.requests[0].status, 'pending');
  }
  const absent = fixture(); absent.start(); absent.command(); absent.apply(1);
  assert.equal(absent.value.audioCommands.sequence, 1); assert.deepEqual(absent.value.audioRequests.counts, counts(0));
  assert.equal(absent.value.audioRequests.phase, 'incomplete');
});

test('audio scene switches keep session IDs but require the current frozen source and visit', () => {
  const f = fixture(); f.start(); f.value.push(wire(accepted(f.scene))); f.command(); f.apply(1); const second = f.plan.scenes[1];
  f.push(audioFinished(f.scene, 1, 0)); f.push(exitScene(f.scene, 1, 0, second)); f.push(enterScene(second, 2));
  f.push(readyScene(second, 2)); f.push(audioReady(second, 2));
  f.value.push(wire(accepted(f.scene, 2))); assert.deepEqual(f.value.audioRequests.counts, counts(1, 1));
  f.value.push(wire(accepted(second, 2, 'stop', clock(), 2))); f.command(2, 'stop', clock(), second, 2); f.apply(2);
  assert.deepEqual(f.value.audioRequests.counts, counts(2, 2));
  assert.deepEqual(f.value.audioRequests.requests[1].track.source, second.audio.locations.tracks[0].declaration);
});

const animationAccepted = (scene, requestId = 1, position = clock()) => ({ protocol: 1, event: 'accepted', requestId, clock: position,
  origin: origin(scene), target: { kind: 'scene' }, command: { action: 'stop' } });
function animationCommand(f, sequence = 1, position = clock()) {
  return f.push(completionCommand(f.scene, 1, sequence, { action: 'stop' }, 0, 0, 'stopped'), position);
}

test('audio and animation readers compose in either order with independent IDs, FIFO and fragmented streams', () => {
  for (const audioOuter of [false, true]) {
    const f = fixture({ plan: mixedPlan(), protocolVersion: 7, mixed: true, audioOuter }); f.start();
    const text = wire(accepted(f.scene)) + wire(animationAccepted(f.scene), PROJECT_ANIMATION_REQUEST_PREFIX)
      + wire(accepted(f.scene, 2, 'stop')) + wire(animationAccepted(f.scene, 2), PROJECT_ANIMATION_REQUEST_PREFIX);
    for (const character of text) f.value.push(character);
    animationCommand(f); f.value.push(wire(applied(1, 1, f.index), PROJECT_ANIMATION_REQUEST_PREFIX));
    f.command(); f.apply(1); f.command(2, 'stop'); f.apply(2);
    animationCommand(f, 2); f.value.push(wire(applied(2, 2, f.index), PROJECT_ANIMATION_REQUEST_PREFIX));
    assert.deepEqual(f.value.audioRequests.counts, counts(2, 2)); assert.deepEqual(f.value.animationRequests.counts, counts(2, 2));
    assert.equal(f.value.audioCommands.sequence, 2); assert.equal(f.value.animationCommands.sequence, 2); assert.deepEqual(f.value.diagnostics, []);
  }
});

test('stacked observer errors preserve both independent queues and exact committed business evidence', () => {
  for (const audioOuter of [false, true]) for (const failing of ['audio', 'animation']) {
    let calls = 0;
    const fail = view => { if (view.counts.accepted && calls++ === 0) throw new Error(`${failing} snapshot`); };
    const f = fixture({ plan: mixedPlan(), protocolVersion: 7, mixed: true, audioOuter,
      ...(failing === 'audio' ? { onSnapshot: fail } : { onAnimation: fail }) }); f.start();
    const rows = { audio: wire(accepted(f.scene)), animation: wire(animationAccepted(f.scene), PROJECT_ANIMATION_REQUEST_PREFIX) };
    const other = failing === 'audio' ? 'animation' : 'audio'; f.value.push(rows[other]);
    assert.throws(() => f.value.push(rows[failing]), new RegExp(`${failing} snapshot`));
    assert.deepEqual(f.value.audioRequests.counts, counts(1)); assert.deepEqual(f.value.animationRequests.counts, counts(1));
    f.value.finish(); f.value.finish();
    assert.deepEqual(f.value.audioRequests.counts, counts(1)); assert.deepEqual(f.value.animationRequests.counts, counts(1)); assert.equal(f.value.retention.total, 4);
  }
  for (const failing of ['audio-command', 'animation-command']) {
    const f = fixture({ plan: mixedPlan(), protocolVersion: 7, mixed: true, onEvent(frame) { if (frame.event === failing) throw new Error('business observer'); } }); f.start();
    f.value.push(wire(accepted(f.scene)) + wire(animationAccepted(f.scene), PROJECT_ANIMATION_REQUEST_PREFIX));
    assert.throws(() => failing === 'audio-command' ? f.command() : animationCommand(f), /business observer/);
    f.value.finish(); assert.equal(f.value.executionFrames.totalFrames, 5);
    assert.equal(f.value.audioCommands.sequence + f.value.animationCommands.sequence, 1);
    assert.deepEqual(f.value.audioRequests.counts, counts(1)); assert.deepEqual(f.value.animationRequests.counts, counts(1));
    assert.equal(f.value.audioRequests.phase, 'incomplete'); assert.equal(f.value.animationRequests.phase, 'incomplete');
  }
});

test('stacked missing outcome markers cannot borrow the other domain receipt and preserve distinct terminal tails', () => {
  const f = fixture({ plan: mixedPlan(), protocolVersion: 7, mixed: true, retainedRequests: 1 }); f.start();
  f.value.push(wire(accepted(f.scene)) + wire(animationAccepted(f.scene), PROJECT_ANIMATION_REQUEST_PREFIX));
  f.command(); f.value.push(wire(applied(1, 1, f.index), PROJECT_ANIMATION_REQUEST_PREFIX));
  assert.deepEqual(f.value.animationRequests.counts, counts(1)); f.apply(1);
  animationCommand(f); // Its applied observation is absent, but the old receipt exists.
  f.value.push(wire(accepted(f.scene, 2, 'stop'))); f.command(2, 'stop'); f.apply(2); f.value.finish();
  assert.deepEqual(f.value.audioRequests.counts, counts(2, 2)); assert.deepEqual(f.value.animationRequests.counts, counts(1));
  assert.equal(f.value.audioRequests.requests[0].requestId, 2); assert.equal(f.value.animationRequests.requests[0].requestId, 1);
  assert.equal(f.value.animationCommands.sequence, 1);
});

test('audio protocol 11 observations coexist with per-instance animation targets', () => {
  const plan = mixedPlan(), scene = plan.scenes[0];
  scene.animation.schemaVersion = 3; scene.animation.document.schemaVersion = 4; scene.animation.document.playbackScope = 'instance';
  scene.requiredCapabilities.push('animation.instances2d'); plan.requiredCapabilities = [...new Set(['project.scenes', ...plan.scenes.flatMap(row => row.requiredCapabilities)])].sort();
  const f = fixture({ plan, protocolVersion: 11, mixed: true }); f.start();
  f.value.push(wire(accepted(scene))); f.command(); f.apply(1);
  const row = animationAccepted(scene); row.target = { kind: 'instance', instanceId: scene.behaviors.bindings[0].instanceId };
  f.value.push(wire(row, PROJECT_ANIMATION_REQUEST_PREFIX));
  f.push({ ...completionCommand(scene, 1, 1, row.command, 0, 0, 'stopped'), target: row.target });
  f.value.push(wire(applied(1, 1, f.index), PROJECT_ANIMATION_REQUEST_PREFIX));
  assert.deepEqual(f.value.audioRequests.counts, counts(1, 1)); assert.deepEqual(f.value.animationRequests.counts, counts(1, 1)); assert.deepEqual(f.value.diagnostics, []);
});

test('stacked clock observer finalization retries without replay and retains both final views', () => {
  let calls = 0;
  const f = fixture({ plan: mixedPlan(), protocolVersion: 7, mixed: true, onClock(view) { if (view.totalWindows) { calls++; throw new Error('clock observer'); } } }); f.start();
  const zero = { eventRegistrations: 0, eventPublishes: 0, eventDeliveries: 0, eventBytes: 0, stateMutations: 0, audioRequests: 0, animationRequests: 0 };
  f.value.push(wire({ protocol: 1, event: 'sample', index: 1, clock: clock(), used: zero, total: zero, reason: 'sample' }, PROJECT_EXECUTION_CLOCK_PREFIX).trimEnd());
  assert.throws(() => f.value.finish(), /clock observer/); assert.throws(() => f.value.finish(), /clock observer/); f.value.finish();
  assert.equal(calls, 2); assert.equal(f.value.executionClock.totalWindows, 1); assert.equal(f.value.retention.total, 4);
  assert.equal(f.value.audioRequests.phase, 'incomplete'); assert.equal(f.value.animationRequests.phase, 'incomplete');
});

test('audio final unterminated business frame is admitted once and resolves only an already empty pending queue', () => {
  const f = fixture(); f.start(); f.value.push(wire(accepted(f.scene))); f.command(); f.apply(1);
  f.push(audioFinished(f.scene, 1, 0)); f.push(exitScene(f.scene, 1, 0));
  f.value.push(business(audioProjectFinished(f.plan, 1, 0, 1), ++f.index).trimEnd());
  assert.equal(f.value.audioRequests.phase, 'recording'); assert.deepEqual(f.value.finish().diagnostics, []);
  assert.equal(f.value.audioRequests.phase, 'finished'); f.value.finish(); assert.equal(f.value.retention.total, 8);
});

test('audio accepts author-ready requests before audio initialization while execution still requires audio-ready', () => {
  const f = fixture();
  [audioProjectReady(f.plan), enterScene(f.scene, 1), readyScene(f.scene, 1)].forEach(frame => f.push(frame));
  f.value.push(wire(accepted(f.scene))); assert.deepEqual(f.value.audioRequests.counts, counts(1));
  f.push(audioReady(f.scene, 1)); f.command(); f.apply(1);
  assert.deepEqual(f.value.audioRequests.counts, counts(1, 1)); assert.deepEqual(f.value.diagnostics, []);
});

test('either nested initialization observer may fail without changing the previously created reader', () => {
  for (const outer of ['audio', 'animation']) {
    const plan = mixedPlan(), base = createProjectRuntimeEventReader(plan, { protocolVersion: 7 });
    const framed = createProjectExecutionFramesReader({ runtimeReader: base });
    const factories = { audio: createProjectAudioRequestsReader, animation: createProjectAnimationRequestsReader };
    const innerName = outer === 'audio' ? 'animation' : 'audio';
    const inner = factories[innerName](plan, { runtimeReader: framed, protocolVersion: 7 });
    let calls = 0;
    assert.throws(() => factories[outer](plan, { runtimeReader: inner, protocolVersion: 7,
      onSnapshot(view) { calls++; assert.deepEqual(view.counts, counts(0)); throw new Error('initial observer'); } }), /initial observer/);
    assert.equal(calls, 1); assert.deepEqual(inner[`${innerName}Requests`].counts, counts(0)); assert.equal(inner.retention.total, 0);
    assert.equal(inner.push(business({ ...audioProjectReady(plan), protocol: 7, animationCommandSequence: 0, animationCompletionSequence: 0 }, 1)).length, 1);
  }
});

test('nested terminal observer failures keep applied facts and unfinished peer requests through finish', () => {
  for (const audioOuter of [false, true]) for (const failing of ['audio', 'animation']) {
    let calls = 0;
    const fail = view => { if (view.counts.applied && calls++ === 0) throw new Error('terminal observer'); };
    const f = fixture({ plan: mixedPlan(), protocolVersion: 7, mixed: true, audioOuter,
      ...(failing === 'audio' ? { onSnapshot: fail } : { onAnimation: fail }) }); f.start();
    f.value.push(wire(accepted(f.scene)) + wire(animationAccepted(f.scene), PROJECT_ANIMATION_REQUEST_PREFIX));
    if (failing === 'audio') f.command(); else animationCommand(f);
    assert.throws(() => f.value.push(wire(applied(1, 1, f.index), failing === 'audio' ? prefix : PROJECT_ANIMATION_REQUEST_PREFIX)), /terminal observer/);
    const other = failing === 'audio' ? 'animation' : 'audio';
    assert.deepEqual(f.value[`${failing}Requests`].counts, counts(1, 1)); assert.deepEqual(f.value[`${other}Requests`].counts, counts(1));
    f.value.finish(); f.value.finish();
    assert.deepEqual(f.value[`${failing}Requests`].counts, counts(1, 1)); assert.deepEqual(f.value[`${other}Requests`].counts, counts(1));
    assert.equal(f.value.retention.total, 5);
  }
});

test('stacked audio and animation each retain their independent 256-request allowance', () => {
  const f = fixture({ plan: mixedPlan(), protocolVersion: 7, mixed: true, retainedRequests: 1 }); f.start();
  for (let id = 1; id <= 256; id++) {
    f.value.push(wire(accepted(f.scene, id)) + wire(animationAccepted(f.scene, id), PROJECT_ANIMATION_REQUEST_PREFIX));
    f.command(id); f.apply(id); animationCommand(f, id); f.value.push(wire(applied(id, id, f.index), PROJECT_ANIMATION_REQUEST_PREFIX));
  }
  assert.deepEqual(f.value.audioRequests.counts, counts(256, 256)); assert.deepEqual(f.value.animationRequests.counts, counts(256, 256));
  assert.equal(f.value.audioCommands.sequence, 256); assert.equal(f.value.animationCommands.sequence, 256);
  assert.deepEqual(f.value.diagnostics, []); assert.equal(f.value.retention.total, 516);
});

test('extracting the shared reader preserves animation option-error precedence over invalid plans', () => {
  for (const [input, options] of [[undefined, undefined], [{}, { retainedRequests: 0 }], [{}, { onSnapshot: true }]]) {
    assert.throws(() => createProjectAnimationRequestsReader(input, options), error => error instanceof TypeError
      && error.message === 'Invalid project animation request reader.' && !error.errorCode);
    assert.throws(() => createProjectAudioRequestsReader(input, options), error => error instanceof TypeError
      && error.message === 'Invalid project audio request reader.' && !error.errorCode);
  }
});
