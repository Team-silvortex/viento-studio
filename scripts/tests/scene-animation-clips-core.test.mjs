import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { inspectSceneAnimation, sampleSceneAnimation, sampleSceneAnimationClip, advanceSceneAnimationTransport, advanceSceneAnimationClipTransport } from '../../engine/scene-animation-core.mjs';
import { supportsStudioCoreSceneAnimationClips, getStudioCoreMetadata } from '../../engine/studio-core.mjs';
const id = n => `${n.toString(16).padStart(8, '0')}-1111-4111-8111-111111111111`;
const document = () => ({ format: 'viento-scene-animation', schemaVersion: 3, sceneObjectId: id(1), durationSeconds: 2, loop: true,
  tracks: [{ id: id(2), instanceId: id(3), property: 'opacity', interpolation: 'linear', keyframes: [{ atSeconds: 0, value: 0 }, { atSeconds: 2, value: 1 }] },
    { id: id(6), instanceId: id(3), property: 'spriteFrame2d', interpolation: 'step', grid: { columns: 4, rows: 2 }, keyframes: [{ atSeconds: 0, value: 0 }, { atSeconds: .75, value: 3 }, { atSeconds: 2, value: 7 }] }],
  clips: [{ id: id(4), name: '攻撃 Attack', startSeconds: .5, endSeconds: 2, loop: false }, { id: id(5), name: '待機', startSeconds: .25, endSeconds: .75, loop: true }] });
const input = (doc = document(), state = null, timeSeconds = 0, command = null) => ({ document: doc, state, timeSeconds, command });
const wire = options => ({ protocolVersion: 1, operation: 'sceneAnimation.clipTransport', ...options });
const sampleWire = (doc, clipId, timeSeconds) => ({ protocolVersion: 1, operation: 'sceneAnimation.sampleClip', document: doc, clipId, timeSeconds });
const state = (phase = 'paused', positionSeconds = 0, timeSeconds = 0, clipId = id(4)) => ({ sceneObjectId: id(1), phase, positionSeconds, timeSeconds, clipId });
const { instance: { exports: core } } = await WebAssembly.instantiate(await fs.readFile(new URL('../../engine/studio-core.wasm', import.meta.url)), {});
const encode = new TextEncoder(), decode = new TextDecoder('utf-8', { fatal: true });
function wasm(input) {
  const bytes = encode.encode(typeof input === 'string' ? input : JSON.stringify(input)), at = core.viento_core_input(bytes.length) >>> 0;
  new Uint8Array(core.memory.buffer, at, bytes.length).set(bytes); const out = core.viento_core_run() >>> 0;
  return JSON.parse(decode.decode(new Uint8Array(core.memory.buffer, out, core.viento_core_output_len())));
}
let bridgeIndex = 0;
async function bridge(transform, clipsVersion = 1) {
  const module = await import(`../../engine/studio-core.mjs?clips-forgery=${++bridgeIndex}`), memory = new WebAssembly.Memory({ initial: 40 }), original = WebAssembly.instantiate;
  let inputLength = 0, outputLength = 0, calls = 0;
  try {
    WebAssembly.instantiate = async () => ({ instance: { exports: { memory, viento_core_protocol_version: () => 1,
      viento_core_scene_animation_version: () => 1, viento_core_scene_animation_sprite_version: () => 1, viento_core_scene_animation_transport_version: () => 1,
      ...(clipsVersion === null ? {} : { viento_core_scene_animation_clips_version: () => clipsVersion }),
      viento_core_input: length => { inputLength = length; return 8; }, viento_core_output_len: () => outputLength,
      viento_core_run: () => { calls++; const incoming = JSON.parse(decode.decode(new Uint8Array(memory.buffer, 8, inputLength))), result = wasm(incoming);
        const output = encode.encode(JSON.stringify(transform ? transform(result, incoming) : result)); outputLength = output.length;
        new Uint8Array(memory.buffer, 1048576, outputLength).set(output); return 1048576; },
    } } });
    await module.initializeStudioCore(() => new Uint8Array([1]));
  } finally { WebAssembly.instantiate = original; }
  return { module, calls: () => calls };
}

test('named clips are an optional capability with exact v3 author shape and legacy whole-timeline DTOs', () => {
  assert.equal(core.viento_core_scene_animation_clips_version(), 1); assert.equal(supportsStudioCoreSceneAnimationClips(), true);
  const doc = document(), before = structuredClone(doc), receipt = inspectSceneAnimation(doc); assert.deepEqual(receipt.document, before); assert.ok(Object.isFrozen(receipt.document.clips[0]));
  assert.deepEqual(sampleSceneAnimationClip(doc, null, .75), sampleSceneAnimation(doc, .75));
  assert.deepEqual(advanceSceneAnimationTransport(input(doc, null, .5)), { sceneObjectId: id(1), phase: 'playing', positionSeconds: .5, timeSeconds: .5 });
  assert.deepEqual(advanceSceneAnimationClipTransport(input(doc, null, .5)), state('playing', .5, .5, null)); assert.deepEqual(doc, before);
  const empty = { ...doc, clips: [] }; assert.deepEqual(inspectSceneAnimation(empty).document.clips, []);
});

test('clip sampling retains curve interpolation sprite steps and terminal keys without global loop wrap', () => {
  const doc = document();
  assert.deepEqual(sampleSceneAnimationClip(doc, id(4), 0).values.map(v => v.value), [.25, 0]);
  assert.deepEqual(sampleSceneAnimationClip(doc, id(4), .25).values.map(v => v.value), [.375, 3]);
  for (const time of [1.5, 2, 86400]) { const r = sampleSceneAnimationClip(doc, id(4), time); assert.equal(r.localTimeSeconds, 1.5); assert.equal(r.finished, true); assert.deepEqual(r.values.map(v => v.value), [1, 7]); }
  for (const time of [.5, 1, 86400]) { const r = sampleSceneAnimationClip(doc, id(5), time); assert.equal(r.localTimeSeconds, 0); assert.equal(r.finished, false); assert.deepEqual(r.values.map(v => v.value), [.125, 0]); }
  const rounded = structuredClone(doc); rounded.clips[0] = { ...rounded.clips[0], startSeconds: 1, endSeconds: 1.0000000000000002, loop: true };
  const r = sampleSceneAnimationClip(rounded, id(4), 1.2e-16); assert.equal(r.localTimeSeconds, 1.2e-16); assert.equal(r.values[0].value, .5000000000000001);
});

test('clip transport applies ordered select play pause seek stop in local range with preserved host clocks', () => {
  const doc = document(); let current = advanceSceneAnimationClipTransport(input(doc, null, .5, { action: 'select', clipId: id(4) }));
  assert.deepEqual(current, state('paused', 0, .5));
  current = advanceSceneAnimationClipTransport(input(doc, current, .5, { action: 'play' }));
  current = advanceSceneAnimationClipTransport(input(doc, current, 2)); assert.deepEqual(current, state('finished', 1.5, 2));
  current = advanceSceneAnimationClipTransport(input(doc, current, 2, { action: 'play' })); assert.deepEqual(current, state('playing', 0, 2));
  current = advanceSceneAnimationClipTransport(input(doc, current, 2.25, { action: 'pause' })); assert.deepEqual(current, state('paused', .25, 2.25));
  current = advanceSceneAnimationClipTransport(input(doc, current, 100, { action: 'select', clipId: id(5) })); assert.deepEqual(current, state('paused', 0, 100, id(5)));
  current = advanceSceneAnimationClipTransport(input(doc, current, 100, { action: 'seek', positionSeconds: .5 })); assert.equal(current.positionSeconds, 0);
  current = advanceSceneAnimationClipTransport(input(doc, current, 100, { action: 'seek', positionSeconds: .125 }));
  current = advanceSceneAnimationClipTransport(input(doc, current, 100, { action: 'play' }));
  current = advanceSceneAnimationClipTransport(input(doc, current, Number.MAX_SAFE_INTEGER)); assert.equal(current.positionSeconds, .125);
  current = advanceSceneAnimationClipTransport(input(doc, current, Number.MAX_SAFE_INTEGER, { action: 'stop' })); assert.deepEqual(current, state('stopped', 0, Number.MAX_SAFE_INTEGER, id(5)));
  current = advanceSceneAnimationClipTransport(input(doc, current, Number.MAX_SAFE_INTEGER, { action: 'select', clipId: null })); assert.deepEqual(current, state('paused', 0, Number.MAX_SAFE_INTEGER, null));
});

const invalidDocuments = [d => delete d.clips, d => d.clips = null, d => d.clips[0].id = id(5), d => d.clips[0].extra = true,
  d => d.clips[0].name = '', d => d.clips[0].name = ' attack', d => d.clips[0].name = '\ufeffattack', d => d.clips[0].name = 'a\nb', d => d.clips[0].name = '🎬'.repeat(129),
  d => d.clips[0].startSeconds = -.1, d => d.clips[0].startSeconds = 2, d => d.clips[0].endSeconds = 3, d => d.clips[0].loop = 1,
  d => d.clips = Array.from({ length: 33 }, (_, i) => ({ ...d.clips[0], id: id(i + 20) })), d => d.schemaVersion = 2];
const invalidStates = [false, {}, [], { ...state(), extra: 0 }, { ...state(), sceneObjectId: id(9) }, { ...state(), clipId: id(9) }, { ...state(), clipId: '' },
  state('playing', 1.5), state('stopped', .1), state('finished', 1.25), state('paused', 1.51), state('finished', .5, 0, id(5)), state('paused', .5, 0, id(5))];
const invalidCommands = [{ action: 'select' }, { action: 'select', clipId: id(9) }, { action: 'select', clipId: false }, { action: 'select', clipId: null, extra: 0 },
  { action: 'seek', positionSeconds: 1.6 }, { action: 'play', clipId: null }, { action: 'rename', clipId: id(4) }];
test('Rust rejects malformed clips unknown selection noncanonical local state and range overflow', () => {
  for (const change of invalidDocuments) { const d = document(); change(d); assert.throws(() => inspectSceneAnimation(d), { errorCode: 'scene_animation_invalid' }); }
  const unicode = document(); unicode.clips[0].name = '🎬'.repeat(128); assert.equal(inspectSceneAnimation(unicode).document.clips[0].name, unicode.clips[0].name);
  for (const options of [...invalidStates.map(s => input(document(), s, 1)), ...invalidCommands.map(c => input(document(), state(), 1, c)), input(document(), state('paused', 0, 2), 1)]) {
    const before = structuredClone(options); assert.equal(wasm(wire(options)).errorCode, 'scene_animation_invalid'); assert.throws(() => advanceSceneAnimationClipTransport(options), { errorCode: 'scene_animation_invalid' }); assert.deepEqual(options, before);
  }
  for (const selection of [id(9), '', 0, undefined]) assert.throws(() => sampleSceneAnimationClip(document(), selection, 0));
  for (const version of [1, 2]) { const d = document(); d.schemaVersion = version; delete d.clips; if (version === 1) d.tracks.pop(); assert.throws(() => sampleSceneAnimationClip(d, null, 0), { errorCode: 'scene_animation_invalid' }); assert.throws(() => advanceSceneAnimationClipTransport(input(d)), { errorCode: 'scene_animation_invalid' }); }
});

test('clip raw requests reject duplicate decoded keys and incomplete envelope or state shapes', () => {
  const raw = JSON.stringify(wire(input(document(), state(), 1, { action: 'select', clipId: null })));
  for (const [a, b] of [['"clips":', '"clips":[],"cl\\u0069ps":'], ['"clipId":null', '"clipId":null,"cl\\u0069pId":null'], ['"name":"攻撃 Attack"', '"name":"x","n\\u0061me":"攻撃 Attack"']]) assert.equal(wasm(raw.replace(a, b)).errorCode, 'studio_core_request_invalid');
  const missing = state(); delete missing.clipId; assert.equal(wasm(wire(input(document(), missing))).errorCode, 'scene_animation_invalid');
  for (const key of ['clipId', 'timeSeconds', 'document']) { const req = sampleWire(document(), null, 0); delete req[key]; assert.equal(wasm(req).errorCode, 'studio_core_request_invalid'); }
  let calls = 0; const options = input(); Object.defineProperty(options, 'state', { enumerable: true, get() { calls++; return null; } });
  assert.throws(() => advanceSceneAnimationClipTransport(options), { errorCode: 'studio_core_request_invalid' }); assert.equal(calls, 0);
});

test('missing clips marker disables only new author formats and clip operations without native or JS fallback', async () => {
  for (const version of [null, 0, 2]) {
    const h = await bridge(null, version); assert.equal(h.module.supportsStudioCoreSceneAnimationClips(), false);
    for (const request of [wire(input()), sampleWire(document(), null, 0), { protocolVersion: 1, operation: 'sceneAnimation.inspect', document: document() }]) assert.throws(() => h.module.dispatchStudioCoreSceneAnimation(request), { errorCode: 'studio_core_unavailable' });
    assert.equal(h.calls(), 0);
    const old = document(); old.schemaVersion = 2; delete old.clips;
    assert.deepEqual(h.module.dispatchStudioCoreSceneAnimation({ protocolVersion: 1, operation: 'sceneAnimation.sample', document: old, timeSeconds: .5 }), sampleSceneAnimation(old, .5));
  }
});

test('strict bridge rejects forged clip selection position source and curve values', async () => {
  for (const mutate of [r => r.sceneAnimation.clipId = id(5), r => r.sceneAnimation.positionSeconds = .1, r => r.sceneAnimation.phase = 'playing', r => delete r.sceneAnimation.clipId, r => r.sceneAnimation.extra = true]) {
    const h = await bridge(r => { mutate(r); return r; }); assert.throws(() => h.module.dispatchStudioCoreSceneAnimation(wire(input(document(), null, 0, { action: 'select', clipId: id(4) }))), { errorCode: 'studio_core_unavailable' });
  }
  for (const mutate of [r => r.sceneAnimation.localTimeSeconds = .5, r => r.sceneAnimation.values[0].value = 0, r => r.sceneAnimation.finished = true, r => r.sceneAnimation.values[1].grid.rows = 1]) {
    const h = await bridge(r => { mutate(r); return r; }); assert.throws(() => h.module.dispatchStudioCoreSceneAnimation(sampleWire(document(), id(4), 0)), { errorCode: 'studio_core_unavailable' });
  }
  for (const mutate of invalidDocuments) { const d = document(); mutate(d); const h = await bridge(() => ({ protocolVersion: 1, ok: true, sceneAnimation: { document: d } })); assert.throws(() => h.module.dispatchStudioCoreSceneAnimation({ protocolVersion: 1, operation: 'sceneAnimation.inspect', document: d }), { errorCode: 'studio_core_unavailable' }); }
  assert.equal(getStudioCoreMetadata().ready, true);
});

test('native CLI and WASM agree on named ranges both curve types transport rejection and raw duplicate keys', { skip: !process.env.VIENTO_ANIMATION_CORE_NATIVE }, async () => {
  const wires = [], doc = document(); let previous = null;
  for (const [time, command] of [[0, null], [.5, { action: 'select', clipId: id(4) }], [.5, { action: 'play' }], [2, null], [2, { action: 'select', clipId: id(5) }], [2, { action: 'seek', positionSeconds: .125 }], [2, { action: 'play' }], [Number.MAX_SAFE_INTEGER, null]]) {
    const request = wire(input(doc, previous, time, command)); wires.push(JSON.stringify(request)); previous = wasm(request).sceneAnimation;
  }
  for (const selection of [null, id(4), id(5)]) for (const time of [0, .25, .5, 1.5, 2, 86400]) wires.push(JSON.stringify(sampleWire(doc, selection, time)));
  wires.push(...invalidStates.map(s => JSON.stringify(wire(input(doc, s)))), ...invalidCommands.map(c => JSON.stringify(wire(input(doc, state(), 1, c)))));
  wires.push(JSON.stringify(sampleWire(doc, null, 0)).replace('"clipId":null', '"clipId":null,"clipId":null'));
  const result = await new Promise((resolve, reject) => {
    const child = spawn(process.env.VIENTO_ANIMATION_CORE_NATIVE, [], { stdio: ['pipe', 'pipe', 'pipe'] }); let stdout = '', stderr = ''; const timer = setTimeout(() => child.kill('SIGKILL'), 10000);
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8'); child.stdout.on('data', s => stdout += s); child.stderr.on('data', s => stderr += s);
    child.on('error', reject); child.on('close', status => { clearTimeout(timer); resolve({ status, stdout, stderr }); }); child.stdin.end(wires.join('\n') + '\n');
  });
  assert.equal(result.status, 0, result.stderr); assert.deepEqual(result.stdout.trim().split('\n').map(JSON.parse), wires.map(wasm));
});
