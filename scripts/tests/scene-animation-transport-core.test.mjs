import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { advanceSceneAnimationTransport, sampleSceneAnimation } from '../../engine/scene-animation-core.mjs';
import { supportsStudioCoreSceneAnimationTransport, getStudioCoreMetadata, dispatchStudioCoreSceneAnimation } from '../../engine/studio-core.mjs';

const bytes = await fs.readFile(new URL('../../engine/studio-core.wasm', import.meta.url));
const { instance: { exports: core } } = await WebAssembly.instantiate(bytes, {});
const id = n => `${n.toString(16).padStart(8, '0')}-1111-4111-8111-111111111111`;
const document = (loop = false) => ({ format: 'viento-scene-animation', schemaVersion: 1, sceneObjectId: id(1), durationSeconds: 2, loop,
  tracks: [{ id: id(2), instanceId: id(3), property: 'opacity', interpolation: 'linear', keyframes: [{ atSeconds: 0, value: 0 }, { atSeconds: 2, value: 1 }] }] });
const sprite = (loop = false) => ({ ...document(loop), schemaVersion: 2, tracks: [{ id: id(2), instanceId: id(3), property: 'spriteFrame2d', interpolation: 'step',
  grid: { columns: 4, rows: 2 }, keyframes: [{ atSeconds: 0, value: 0 }, { atSeconds: .5, value: 3 }, { atSeconds: 2, value: 7 }] }] });
const input = (doc = document(), state = null, timeSeconds = 0, command = null) => ({ document: doc, state, timeSeconds, command });
const request = options => ({ protocolVersion: 1, operation: 'sceneAnimation.transport', ...options });
const state = (phase = 'playing', positionSeconds = .25, timeSeconds = 0) => ({ sceneObjectId: id(1), phase, positionSeconds, timeSeconds });
const encode = new TextEncoder(), decode = new TextDecoder('utf-8', { fatal: true });
function wasm(input) {
  const wire = encode.encode(typeof input === 'string' ? input : JSON.stringify(input)), at = core.viento_core_input(wire.length) >>> 0;
  new Uint8Array(core.memory.buffer, at, wire.length).set(wire); const out = core.viento_core_run() >>> 0;
  return JSON.parse(decode.decode(new Uint8Array(core.memory.buffer, out, core.viento_core_output_len())));
}
let bridgeIndex = 0;
async function bridge(transform, transportVersion = 1, spriteVersion = 1) {
  const module = await import(`../../engine/studio-core.mjs?transport-forgery=${++bridgeIndex}`);
  const memory = new WebAssembly.Memory({ initial: 40 }), original = WebAssembly.instantiate;
  let inputLength = 0, outputLength = 0, calls = 0;
  try {
    WebAssembly.instantiate = async () => ({ instance: { exports: { memory, viento_core_protocol_version: () => 1,
      viento_core_scene_animation_version: () => 1,
      ...(spriteVersion === null ? {} : { viento_core_scene_animation_sprite_version: () => spriteVersion }),
      ...(transportVersion === null ? {} : { viento_core_scene_animation_transport_version: () => transportVersion }),
      viento_core_input: length => { inputLength = length; return 8; }, viento_core_output_len: () => outputLength,
      viento_core_run: () => { calls++; const incoming = JSON.parse(decode.decode(new Uint8Array(memory.buffer, 8, inputLength)));
        const result = wasm(incoming), output = encode.encode(JSON.stringify(transform ? transform(result, incoming) : result));
        outputLength = output.length; new Uint8Array(memory.buffer, 1048576, outputLength).set(output); return 1048576; },
    } } });
    await module.initializeStudioCore(() => new Uint8Array([1]));
  } finally { WebAssembly.instantiate = original; }
  return { module, calls: () => calls };
}

test('animation transport is an additive native capability with detached frozen scene-scoped receipts', () => {
  assert.equal(core.viento_core_protocol_version(), 1); assert.equal(core.viento_core_scene_animation_version(), 1);
  assert.equal(core.viento_core_scene_animation_sprite_version(), 1); assert.equal(core.viento_core_scene_animation_transport_version(), 1);
  assert.equal(supportsStudioCoreSceneAnimationTransport(), true);
  const source = document(), options = input(source, null, .5), before = structuredClone(options);
  const value = advanceSceneAnimationTransport(options);
  assert.deepEqual(value, state('playing', .5, .5)); assert.ok(Object.isFrozen(value)); assert.deepEqual(options, before);
  options.document.sceneObjectId = id(9); assert.equal(value.sceneObjectId, id(1));
  assert.equal(advanceSceneAnimationTransport(input()).positionSeconds, 0);
});

test('commands first advance the explicit clock then apply in same-time FIFO order', () => {
  const doc = document();
  let value = advanceSceneAnimationTransport(input(doc, null, .5));
  value = advanceSceneAnimationTransport(input(doc, value, 1, { action: 'pause' })); assert.deepEqual(value, state('paused', 1, 1));
  value = advanceSceneAnimationTransport(input(doc, value, 1, { action: 'stop' })); assert.deepEqual(value, state('stopped', 0, 1));
  value = advanceSceneAnimationTransport(input(doc, value, 1, { action: 'seek', positionSeconds: .25 })); assert.deepEqual(value, state('paused', .25, 1));
  value = advanceSceneAnimationTransport(input(doc, value, 100, { action: 'play' })); assert.deepEqual(value, state('playing', .25, 100));
  value = advanceSceneAnimationTransport(input(doc, value, 100.5, { action: 'play' })); assert.deepEqual(value, state('playing', .75, 100.5));
  value = advanceSceneAnimationTransport(input(doc, value, 100.5, null)); assert.deepEqual(value, state('playing', .75, 100.5));
});

test('pause holds, stop returns to first key, seek pauses and natural completion is distinct from disposal', () => {
  const doc = document();
  for (const phase of ['paused', 'stopped', 'finished']) {
    const position = phase === 'stopped' ? 0 : phase === 'finished' ? 2 : .25;
    assert.deepEqual(advanceSceneAnimationTransport(input(doc, state(phase, position), 86401)), state(phase, position, 86401));
  }
  assert.deepEqual(advanceSceneAnimationTransport(input(doc, null, 2)), state('finished', 2, 2));
  assert.deepEqual(advanceSceneAnimationTransport(input(doc, state('playing', 1.5), .5)), state('finished', 2, .5));
  const roundedEnd = advanceSceneAnimationTransport(input(doc, state('playing', 2 - Number.EPSILON), 2e-16));
  assert.deepEqual(roundedEnd, state('finished', 2, 2e-16));
  assert.deepEqual(advanceSceneAnimationTransport(input(doc, roundedEnd, 2e-16)), roundedEnd);
  const finished = advanceSceneAnimationTransport(input(doc, null, 5));
  const paused = advanceSceneAnimationTransport(input(doc, finished, 5, { action: 'pause' })); assert.equal(paused.phase, 'paused');
  const sought = advanceSceneAnimationTransport(input(doc, null, 0, { action: 'seek', positionSeconds: 2 }));
  for (const previous of [finished, paused, sought]) assert.deepEqual(advanceSceneAnimationTransport(input(doc, previous, 5, { action: 'play' })), state('playing', 0, 5));
  assert.deepEqual(advanceSceneAnimationTransport(input(doc, null, 5, { action: 'stop' })), state('stopped', 0, 5));
});

test('loop transport wraps exact endpoints and preserves fractional positions beyond a day and at the maximum clock', () => {
  const doc = document(true);
  for (const time of [0, 2, 86400, 86402]) assert.deepEqual(advanceSceneAnimationTransport(input(doc, null, time)), state('playing', 0, time));
  assert.deepEqual(advanceSceneAnimationTransport(input(doc, null, 2, { action: 'seek', positionSeconds: 2 })), state('paused', 0, 2));
  const maximum = advanceSceneAnimationTransport(input(doc, state('playing', .25), Number.MAX_SAFE_INTEGER));
  assert.deepEqual(maximum, state('playing', 1.25, Number.MAX_SAFE_INTEGER));
  assert.deepEqual(advanceSceneAnimationTransport(input(doc, maximum, Number.MAX_SAFE_INTEGER)), maximum);
  assert.deepEqual(advanceSceneAnimationTransport(input(doc, state('playing', .25, 86400), 86402)), state('playing', .25, 86402));
  for (const negativeZero of [-0, 0]) {
    const value = advanceSceneAnimationTransport(input(doc, null, negativeZero, { action: 'seek', positionSeconds: negativeZero }));
    assert.equal(Object.is(value.positionSeconds, -0), false); assert.equal(Object.is(value.timeSeconds, -0), false);
  }
});

test('transport sampling shares the same playback head for visual and frame channels and accepts tiny durations', () => {
  const doc = sprite(); doc.tracks.push({ ...document().tracks[0], id: id(4) });
  const value = advanceSceneAnimationTransport(input(doc, null, .75, { action: 'pause' }));
  assert.deepEqual(sampleSceneAnimation(doc, value.positionSeconds).values.map(row => row.value), [3, .375]);
  const before = JSON.stringify(doc);
  const seek = advanceSceneAnimationTransport(input(doc, value, 10, { action: 'seek', positionSeconds: 2 }));
  assert.deepEqual(sampleSceneAnimation(doc, seek.positionSeconds).values.map(row => row.value), [7, 1]);
  assert.equal(JSON.stringify(doc), before);
  const tiny = { ...document(true), durationSeconds: Number.MIN_VALUE }; tiny.tracks[0].keyframes = [{ atSeconds: 0, value: 1 }];
  assert.deepEqual(advanceSceneAnimationTransport(input(tiny, null, Number.MAX_SAFE_INTEGER)), state('playing', 0, Number.MAX_SAFE_INTEGER));
});

const badStates = [false, [], {}, ...['sceneObjectId', 'phase', 'positionSeconds', 'timeSeconds'].map(key => { const value = state(); delete value[key]; return value; }),
  { ...state(), extra: true }, { ...state(), sceneObjectId: id(9) }, { ...state(), sceneObjectId: 1 }, { ...state(), phase: 'error' },
  { ...state(), positionSeconds: -.1 }, { ...state(), positionSeconds: 2.01 }, { ...state(), positionSeconds: '0' },
  { ...state(), timeSeconds: -1 }, { ...state(), timeSeconds: Number.MAX_SAFE_INTEGER + 1 }, { ...state(), timeSeconds: '0' },
  state('playing', 2), state('stopped', .25), state('finished', .25)];
const badCommands = [false, [], {}, { action: 'restart' }, { action: 'seek' }, { action: 'seek', positionSeconds: -.1 },
  { action: 'seek', positionSeconds: 2.01 }, { action: 'seek', positionSeconds: '0' }, { action: 'play', positionSeconds: 0 }, { action: 'pause', extra: true }];
test('Rust rejects incomplete noncanonical cross-scene states commands and clocks without mutating prior data', () => {
  const options = [...badStates.map(value => input(document(), value, 1)), ...badCommands.map(command => input(document(), state(), 1, command)),
    ...[-1, Number.MAX_SAFE_INTEGER + 1, '0', null].map(time => input(document(), null, time)),
    input(document(), state('playing', .25, 2), 1), input(document(true), state('finished', 2), 1), input(document(true), state('paused', 2), 1)];
  for (const option of options) {
    const before = structuredClone(option);
    assert.equal(wasm(request(option)).errorCode, 'scene_animation_invalid');
    assert.throws(() => advanceSceneAnimationTransport(option), { errorCode: 'scene_animation_invalid' }); assert.deepEqual(option, before);
  }
  assert.equal(getStudioCoreMetadata().ready, true);
});

test('transport revalidates the complete author document and does not accept wrong envelopes', () => {
  for (const mutate of [d => d.schemaVersion = 3, d => d.sceneObjectId = 'bad', d => d.durationSeconds = 0, d => d.tracks = [],
    d => d.tracks[0].keyframes[0].atSeconds = .1, d => d.extra = true, d => d.tracks[0].property = 'velocity']) {
    const doc = document(); mutate(doc); assert.throws(() => advanceSceneAnimationTransport(input(doc)), { errorCode: 'scene_animation_invalid' });
  }
  for (const field of ['protocolVersion', 'operation', 'document', 'state', 'timeSeconds', 'command']) {
    const wire = request(input()); delete wire[field]; assert.equal(wasm(wire).ok, false);
  }
  const wire = request(input()); wire.extra = true;
  assert.equal(wasm(wire).errorCode, 'studio_core_request_invalid');
  assert.throws(() => dispatchStudioCoreSceneAnimation(wire), { errorCode: 'studio_core_request_invalid' });
});

test('raw transport rejects duplicate decoded envelope state and command keys before normalization', () => {
  const wire = JSON.stringify(request(input(document(), state(), 1, { action: 'seek', positionSeconds: .5 })));
  for (const [from, to] of [
    ['"operation":', '"operation":"sceneAnimation.inspect","operation":'], ['"timeSeconds":0', '"timeSeconds":0,"timeSeconds":0'],
    ['"state":', '"state":null,"st\\u0061te":'], ['"phase":"playing"', '"phase":"paused","ph\\u0061se":"playing"'],
    ['"positionSeconds":0.5', '"positionSeconds":0,"positionSeconds":0.5'], ['"action":"seek"', '"action":"play","ac\\u0074ion":"seek"'],
  ]) assert.equal(wasm(wire.replace(from, to)).errorCode, 'studio_core_request_invalid');
  assert.equal(wasm('\uFEFF' + wire).errorCode, 'studio_core_request_invalid');
  assert.equal(wasm(wire).ok, true);
});

test('wrapper and bridge reject executable properties serializers cycles and nonfinite clocks without invoking them', () => {
  let calls = 0;
  for (const mutate of [
    value => Object.defineProperty(value, 'state', { enumerable: true, get() { calls++; return null; } }),
    value => Object.defineProperty(value.state, 'phase', { enumerable: true, get() { calls++; return 'playing'; } }),
    value => Object.defineProperty(value.command, 'action', { enumerable: true, get() { calls++; return 'pause'; } }),
    value => value.command.toJSON = () => { calls++; return { action: 'pause' }; },
    value => value.timeSeconds = NaN, value => value.timeSeconds = Infinity, value => value.timeSeconds = undefined,
    value => value.state.self = value.state, value => value.extra = true, value => delete value.command,
  ]) {
    const value = input(document(), state(), 0, { action: 'pause' }); mutate(value);
    assert.throws(() => advanceSceneAnimationTransport(value), { errorCode: 'studio_core_request_invalid' });
  }
  for (const value of [null, false, [], undefined, new Date()]) assert.throws(() => advanceSceneAnimationTransport(value), { errorCode: 'studio_core_request_invalid' });
  assert.equal(calls, 0); assert.equal(getStudioCoreMetadata().ready, true);
});

test('missing optional transport export preserves existing animation calls without invoking a JS fallback', async () => {
  for (const version of [null, 0, 2]) {
    const h = await bridge(null, version); assert.equal(h.module.supportsStudioCoreSceneAnimationTransport(), false);
    assert.equal(h.module.supportsStudioCoreSceneAnimation(), true);
    assert.throws(() => h.module.dispatchStudioCoreSceneAnimation(request(input())), { errorCode: 'studio_core_unavailable' }); assert.equal(h.calls(), 0);
    const old = { protocolVersion: 1, operation: 'sceneAnimation.sample', document: document(), timeSeconds: .5 };
    assert.deepEqual(h.module.dispatchStudioCoreSceneAnimation(old), sampleSceneAnimation(document(), .5)); assert.equal(h.module.getStudioCoreMetadata().ready, true);
  }
  const h = await bridge(null, 1, null);
  assert.equal(h.module.supportsStudioCoreSceneAnimationTransport(), true);
  assert.throws(() => h.module.dispatchStudioCoreSceneAnimation(request(input(sprite()))), { errorCode: 'studio_core_unavailable' }); assert.equal(h.calls(), 0);
  assert.deepEqual(h.module.dispatchStudioCoreSceneAnimation(request(input())), advanceSceneAnimationTransport(input()));
});

test('forged transport receipts cannot change scope phase position clock shape or bypass invalid state admission', async () => {
  for (const mutate of [r => r.extra = true, r => r.sceneAnimation.extra = true, r => delete r.sceneAnimation.phase,
    r => r.sceneAnimation.sceneObjectId = id(9), r => r.sceneAnimation.phase = 'playing', r => r.sceneAnimation.positionSeconds = .25,
    r => r.sceneAnimation.positionSeconds = '0.5', r => r.sceneAnimation.timeSeconds = 2]) {
    const h = await bridge(r => { mutate(r); return r; });
    assert.throws(() => h.module.dispatchStudioCoreSceneAnimation(request(input(document(), null, 1, { action: 'seek', positionSeconds: .5 }))), { errorCode: 'studio_core_unavailable' });
    assert.equal(h.module.getStudioCoreMetadata().ready, false);
  }
  for (const option of [...badStates.map(value => input(document(), value, 1)), ...badCommands.map(value => input(document(), null, 1, value)),
    input(document(), state('playing', .25, 2), 1), input(document(), null, -1), input({ ...document(), tracks: [] })]) {
    const h = await bridge(() => ({ protocolVersion: 1, ok: true, sceneAnimation: state('playing', 1, 1) }));
    assert.throws(() => h.module.dispatchStudioCoreSceneAnimation(request(option)), { errorCode: 'studio_core_unavailable' });
  }
});

const nativePath = process.env.VIENTO_ANIMATION_CORE_NATIVE;
test('native CLI and actual WASM agree on transport timelines legacy/sprite documents large clocks and rejected requests', { skip: !nativePath }, async () => {
  const wires = [];
  for (const doc of [document(), document(true), sprite(), sprite(true)]) {
    let previous = null;
    for (const [time, command] of [[0, null], [.5, { action: 'pause' }], [100, { action: 'play' }], [100.5, null],
      [101, { action: 'stop' }], [101, { action: 'seek', positionSeconds: 2 }], [101, { action: 'play' }], [86401, null], [Number.MAX_SAFE_INTEGER, null]]) {
      const wire = request(input(doc, previous, time, command)); wires.push(JSON.stringify(wire)); previous = wasm(wire).sceneAnimation;
    }
  }
  wires.push(...badStates.map(value => JSON.stringify(request(input(document(), value, 1)))),
    ...badCommands.map(command => JSON.stringify(request(input(document(), null, 1, command)))),
    JSON.stringify(request(input(document(), state('playing', .25, 2), 1))),
    JSON.stringify(request(input())).replace('"command":null', '"command":null,"comm\\u0061nd":null'));
  const result = await new Promise((resolve, reject) => {
    const child = spawn(nativePath, [], { stdio: ['pipe', 'pipe', 'pipe'] }); let stdout = '', stderr = '';
    const timeout = setTimeout(() => child.kill('SIGKILL'), 10000);
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8'); child.stdout.on('data', text => stdout += text); child.stderr.on('data', text => stderr += text);
    child.on('error', error => { clearTimeout(timeout); reject(error); }); child.on('close', (status, signal) => { clearTimeout(timeout); resolve({ status, signal, stdout, stderr }); });
    child.stdin.end(wires.join('\n') + '\n');
  });
  assert.equal(result.status, 0, result.stderr); assert.equal(result.signal, null);
  assert.deepEqual(result.stdout.trim().split('\n').map(JSON.parse), wires.map(wasm));
});
