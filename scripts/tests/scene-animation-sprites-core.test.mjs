import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { inspectSceneAnimation, sampleSceneAnimation } from '../../engine/scene-animation-core.mjs';
import { supportsStudioCoreSceneAnimationSprites } from '../../engine/studio-core.mjs';
const bytes = await fs.readFile(new URL('../../engine/studio-core.wasm', import.meta.url));
const { instance: { exports: core } } = await WebAssembly.instantiate(bytes, {});
const id = n => `${n.toString(16).padStart(8, '0')}-1111-4111-8111-111111111111`;
const sprite = () => ({ format: 'viento-scene-animation', schemaVersion: 2, sceneObjectId: id(1), durationSeconds: 2, loop: false,
  tracks: [{ id: id(2), instanceId: id(3), property: 'spriteFrame2d', interpolation: 'step', grid: { columns: 4, rows: 2 },
    keyframes: [{ atSeconds: 0, value: 0 }, { atSeconds: .5, value: 3 }, { atSeconds: 2, value: 7 }] }] });
const legacy = () => ({ ...sprite(), schemaVersion: 1, tracks: [{ id: id(2), instanceId: id(3), property: 'opacity', interpolation: 'linear', keyframes: [{ atSeconds: 0, value: 1 }] }] });
const request = (document = sprite(), timeSeconds) => ({ protocolVersion: 1, operation: timeSeconds === undefined ? 'sceneAnimation.inspect' : 'sceneAnimation.sample', document,
  ...(timeSeconds === undefined ? {} : { timeSeconds }) });
const encode = new TextEncoder(), decode = new TextDecoder('utf-8', { fatal: true });
function wasm(input) {
  const wire = encode.encode(typeof input === 'string' ? input : JSON.stringify(input)), at = core.viento_core_input(wire.length) >>> 0;
  new Uint8Array(core.memory.buffer, at, wire.length).set(wire); const out = core.viento_core_run() >>> 0;
  return JSON.parse(decode.decode(new Uint8Array(core.memory.buffer, out, core.viento_core_output_len())));
}
let index = 0;
async function bridge(transform, spriteVersion = 1) {
  const module = await import(`../../engine/studio-core.mjs?sprite-forgery=${++index}`);
  const memory = new WebAssembly.Memory({ initial: 40 }), original = WebAssembly.instantiate;
  let inputLength = 0, outputLength = 0, calls = 0;
  try {
    WebAssembly.instantiate = async () => ({ instance: { exports: { memory, viento_core_protocol_version: () => 1,
      viento_core_scene_animation_version: () => 1, ...(spriteVersion === null ? {} : { viento_core_scene_animation_sprite_version: () => spriteVersion }),
      viento_core_input: length => { inputLength = length; return 8; }, viento_core_output_len: () => outputLength,
      viento_core_run: () => { calls++; const input = JSON.parse(decode.decode(new Uint8Array(memory.buffer, 8, inputLength)));
        const result = wasm(input), output = encode.encode(JSON.stringify(transform ? transform(result, input) : result));
        outputLength = output.length; new Uint8Array(memory.buffer, 1048576, outputLength).set(output); return 1048576; },
    } } });
    await module.initializeStudioCore(() => new Uint8Array([1]));
  } finally { WebAssembly.instantiate = original; }
  return { module, calls: () => calls };
}

test('sprite capability is additive and inspected grids and sampled values are detached and frozen', () => {
  assert.equal(core.viento_core_protocol_version(), 1); assert.equal(core.viento_core_scene_animation_version(), 1);
  assert.equal(core.viento_core_scene_animation_sprite_version(), 1); assert.equal(supportsStudioCoreSceneAnimationSprites(), true);
  const input = sprite(), checked = inspectSceneAnimation(input), sample = sampleSceneAnimation(input, .5);
  assert.deepEqual(checked.document, input); assert.ok(Object.isFrozen(checked.document.tracks[0].grid));
  assert.deepEqual(sample.values, [{ trackId: id(2), instanceId: id(3), property: 'spriteFrame2d', grid: { columns: 4, rows: 2 }, value: 3 }]);
  assert.ok(Object.isFrozen(sample.values[0].grid)); input.tracks[0].grid.columns = 8;
  assert.equal(checked.document.tracks[0].grid.columns, 4); assert.equal(sample.values[0].grid.columns, 4);
});

test('sprite keys are right continuous with exact endpoints, terminal holds, reverse seeks and loop resets', () => {
  const input = sprite();
  for (const [time, frame] of [[0, 0], [.499999999, 0], [.5, 3], [1.999999999, 3], [2, 7], [86400, 7], [.125, 0]]) {
    const sample = sampleSceneAnimation(input, time); assert.equal(sample.values[0].value, frame); assert.equal(sample.finished, time >= 2);
  }
  input.loop = true;
  for (const time of [0, 2, 4, 86400]) { const sample = sampleSceneAnimation(input, time); assert.equal(sample.values[0].value, 0); assert.equal(sample.finished, false); }
  assert.equal(sampleSceneAnimation(input, 2.5).values[0].value, 3);
  input.tracks.push({ ...legacy().tracks[0], id: id(4) });
  const sample = sampleSceneAnimation(input, .5); assert.equal(sample.values[1].value, 1); assert.equal(Object.hasOwn(sample.values[1], 'grid'), false);
  assert.deepEqual(sampleSceneAnimation({ ...legacy(), schemaVersion: 2 }, .5), sampleSceneAnimation(legacy(), .5));
});

const invalidChanges = [
  d => d.schemaVersion = 1, d => d.schemaVersion = 3, d => d.tracks[0].interpolation = 'linear',
  d => delete d.tracks[0].grid, d => d.tracks[0].grid = [4, 2], d => d.tracks[0].grid.extra = 0,
  d => delete d.tracks[0].grid.rows, d => d.tracks[0].grid.columns = 0, d => d.tracks[0].grid.columns = 65,
  d => d.tracks[0].grid.rows = 1.5, d => d.tracks[0].grid.rows = '2',
  d => d.tracks[0].keyframes[0].value = -1, d => d.tracks[0].keyframes[0].value = 8,
  d => d.tracks[0].keyframes[0].value = .5, d => d.tracks[0].keyframes[0].value = [0, 0],
  d => d.tracks.push({ ...structuredClone(d.tracks[0]), id: id(4) }),
];
test('both raw Rust and JS reject incomplete grids, noninteger frames, v1 sprite channels and duplicate channels', () => {
  for (const mutate of invalidChanges) {
    const input = sprite(); mutate(input); assert.equal(wasm(request(input)).errorCode, 'scene_animation_invalid');
    assert.throws(() => inspectSceneAnimation(input), { errorCode: 'scene_animation_invalid' });
  }
  for (const version of [1, 2]) {
    const input = { ...legacy(), schemaVersion: version }; input.tracks[0].grid = { columns: 1, rows: 1 };
    assert.throws(() => inspectSceneAnimation(input), { errorCode: 'scene_animation_invalid' });
  }
  const maximum = sprite(); maximum.tracks[0].grid = { columns: 64, rows: 64 }; maximum.tracks[0].keyframes = [{ atSeconds: 0, value: 4095 }];
  assert.equal(sampleSceneAnimation(maximum, 86400).values[0].value, 4095);
  maximum.tracks[0].keyframes[0].value = 4096; assert.throws(() => inspectSceneAnimation(maximum), { errorCode: 'scene_animation_invalid' });
  maximum.tracks[0].grid = { columns: 1, rows: 1 }; maximum.tracks[0].keyframes[0].value = 0;
  assert.equal(sampleSceneAnimation(maximum, 0).values[0].value, 0);
  const raw = JSON.stringify(request()).replace('"columns":4', '"columns":3,"col\\u0075mns":4');
  assert.equal(wasm(raw).errorCode, 'studio_core_request_invalid');
});

test('missing or unsupported sprite marker preserves v1 animation and rejects v2 before native invocation', async () => {
  for (const version of [null, 0, 2]) {
    const h = await bridge(null, version); assert.equal(h.module.supportsStudioCoreSceneAnimationSprites(), false); assert.equal(h.module.supportsStudioCoreSceneAnimation(), true);
    assert.throws(() => h.module.dispatchStudioCoreSceneAnimation(request()), { errorCode: 'studio_core_unavailable' }); assert.equal(h.calls(), 0);
    assert.deepEqual(h.module.dispatchStudioCoreSceneAnimation(request(legacy(), 0)), sampleSceneAnimation(legacy(), 0));
    assert.equal(h.module.getStudioCoreMetadata().ready, true);
  }
});

test('sprite receipt validation rejects forged grids, frame indices, identities and unexpected fields', async () => {
  const mutations = [
    r => delete r.sceneAnimation.values[0].grid,
    r => r.sceneAnimation.values[0].grid.columns = 2,
    r => r.sceneAnimation.values[0].grid.extra = true,
    r => r.sceneAnimation.values[0].value = 2,
    r => r.sceneAnimation.values[0].value = 3.5,
    r => r.sceneAnimation.values[0].instanceId = id(99),
    r => r.sceneAnimation.values[0].property = 'opacity',
    r => r.sceneAnimation.values[0].extra = true,
  ];
  for (const mutate of mutations) {
    const h = await bridge(r => { mutate(r); return r; });
    assert.throws(() => h.module.dispatchStudioCoreSceneAnimation(request(sprite(), .5)), { errorCode: 'studio_core_unavailable' });
    assert.equal(h.module.getStudioCoreMetadata().ready, false);
  }
  const forged = await bridge(r => { r.sceneAnimation.document.tracks[0].grid.rows = 3; return r; });
  assert.throws(() => forged.module.dispatchStudioCoreSceneAnimation(request()), { errorCode: 'studio_core_unavailable' });
  for (const mutate of invalidChanges) {
    const input = sprite(); mutate(input);
    const h = await bridge((_, request) => ({ protocolVersion: 1, ok: true, sceneAnimation: { document: request.document } }));
    assert.throws(() => h.module.dispatchStudioCoreSceneAnimation(request(input)), { errorCode: 'studio_core_unavailable' });
  }
});

test('grid accessors and serializers never execute at the request boundary', () => {
  let calls = 0;
  for (const mutate of [d => Object.defineProperty(d.tracks[0].grid, 'rows', { enumerable: true, get() { calls++; return 2; } }),
    d => d.tracks[0].grid.toJSON = () => { calls++; return { columns: 4, rows: 2 }; }]) {
    const input = sprite(); mutate(input); assert.throws(() => inspectSceneAnimation(input), { errorCode: 'studio_core_request_invalid' });
  }
  assert.equal(calls, 0);
});

const nativePath = process.env.VIENTO_ANIMATION_CORE_NATIVE;
test('native CLI and actual WASM agree on sprite grids, numeric spellings, mixed channels and failures', { skip: !nativePath }, async () => {
  const input = sprite(), looping = { ...input, loop: true }, mixed = sprite(); mixed.tracks.push({ ...legacy().tracks[0], id: id(4) });
  const cases = [input, looping, mixed, legacy(), ...invalidChanges.map(mutate => { const bad = sprite(); mutate(bad); return bad; })];
  const wires = cases.flatMap(doc => [request(doc), ...[0, .499999999, .5, 2, 86400].map(t => request(doc, t))]).map(JSON.stringify);
  wires.push(JSON.stringify(request()).replace('"columns":4', '"columns":4.0').replace('"value":3', '"value":3.0'));
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
