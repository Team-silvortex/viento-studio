import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { inspectScenePhysics2D } from '../../engine/scene-physics2d-core.mjs';
import { supportsStudioCoreScenePhysics2DPlatformVertical, getStudioCoreMetadata } from '../../engine/studio-core.mjs';

const id = n => `${String(n).padStart(8, '0')}-1111-4111-8111-111111111111`;
const body = (n = 1, kind = 'static') => ({ id: id(n), instanceId: id(1000 + n), kind,
  shape: { kind: 'box', size: [32, 48] }, offset: [0, 0], layer: 1, mask: 2 });
const document = () => ({ format: 'viento-scene-physics2d', schemaVersion: 6, sceneObjectId: id(900),
  bodies: [{ ...body(), oneWay: { margin: 1 }, platformMotion: { kind: 'vertical', offsetY: -160, speed: 80 } },
    { ...body(2, 'character'), collisionResponse: 'slide', characterMotion: { kind: 'platformer', gravity: 980, jumpSpeed: 360, maxFallSpeed: 1200 } }, body(3, 'sensor')] });
const legacy = version => {
  const value = document(); value.schemaVersion = version;
  if (version === 5) value.bodies[0].platformMotion = { kind: 'horizontal', offsetX: 160, speed: 80 };
  if (version < 5) delete value.bodies[0].platformMotion;
  if (version < 4) delete value.bodies[0].oneWay;
  if (version < 3) delete value.bodies[1].characterMotion;
  if (version < 2) delete value.bodies[1].collisionResponse;
  return value;
};
const operations = ['inspect', 'inspectResponse', 'inspectMotion', 'inspectOneWay', 'inspectPlatformMotion', 'inspectPlatformVertical'];
const dispatches = ['dispatchStudioCoreScenePhysics2D', 'dispatchStudioCoreScenePhysics2DResponse', 'dispatchStudioCoreScenePhysics2DMotion', 'dispatchStudioCoreScenePhysics2DOneWay', 'dispatchStudioCoreScenePhysics2DPlatformMotion', 'dispatchStudioCoreScenePhysics2DPlatformVertical'];
const request = (doc, version = 6) => ({ protocolVersion: 1, operation: `scenePhysics2D.${operations[version - 1]}`, document: doc });
const bytes = await fs.readFile(new URL('../../engine/studio-core.wasm', import.meta.url));
const { instance: { exports: native } } = await WebAssembly.instantiate(bytes, {});
const encoder = new TextEncoder(), decoder = new TextDecoder('utf-8', { fatal: true });
function wasm(input) {
  const data = encoder.encode(typeof input === 'string' ? input : JSON.stringify(input));
  const at = native.viento_core_input(data.length) >>> 0; new Uint8Array(native.memory.buffer, at, data.length).set(data);
  const out = native.viento_core_run() >>> 0;
  return JSON.parse(decoder.decode(new Uint8Array(native.memory.buffer, out, native.viento_core_output_len())));
}
let index = 0;
async function bridge({ marker = 1, older = true, mutate } = {}) {
  const module = await import(`../../engine/studio-core.mjs?platform-vertical-test=${++index}`);
  const memory = new WebAssembly.Memory({ initial: 40 }), original = WebAssembly.instantiate;
  let inputLength = 0, outputLength = 0, calls = 0;
  try {
    WebAssembly.instantiate = async () => ({ instance: { exports: {
      memory, viento_core_protocol_version: () => 1,
      ...(older ? Object.fromEntries(['', '_response', '_motion', '_one_way', '_platform_motion'].map(suffix => [`viento_core_scene_physics2d${suffix}_version`, () => 1])) : {}),
      ...(marker === null ? {} : { viento_core_scene_physics2d_platform_vertical_version: () => marker }),
      viento_core_input: length => { inputLength = length; return 8; }, viento_core_output_len: () => outputLength,
      viento_core_run: () => {
        calls++; const input = JSON.parse(decoder.decode(new Uint8Array(memory.buffer, 8, inputLength)));
        const result = wasm(input); mutate?.(result, input);
        const output = encoder.encode(JSON.stringify(result)); outputLength = output.length;
        new Uint8Array(memory.buffer, 1048576, outputLength).set(output); return 1048576;
      },
    } } });
    await module.initializeStudioCore(() => new Uint8Array([1]));
  } finally { WebAssembly.instantiate = original; }
  return { module, calls: () => calls };
}
const invalid = { errorCode: 'scene_physics2d_invalid' };
const badMotions = [null, false, true, 1, 'vertical', [], {},
  ...[-8192.001, -.999, -0, 0, .999, 8192.001, '160', null, true, [], {}].map(offsetY => ({ kind: 'vertical', offsetY, speed: 80 })),
  ...[-1, 0, .999, 2000.001, '80', null, true, [], {}].map(speed => ({ kind: 'vertical', offsetY: -160, speed })),
  { kind: 'linear', offsetY: -160, speed: 80 }, { kind: 'vertical', offsetX: -160, speed: 80 },
  { kind: 'vertical', offsetY: -160, offsetX: 0, speed: 80 }, { kind: 'horizontal', offsetY: -160, speed: 80 },
  { kind: 'vertical', speed: 80 }, { offsetY: -160, speed: 80 }, { kind: 'vertical', offsetY: -160 }];

test('schema6 real WASM retains detached inherited declarations and admits either single motion axis or none', () => {
  assert.equal(native.viento_core_scene_physics2d_platform_vertical_version(), 1);
  assert.equal(supportsStudioCoreScenePhysics2DPlatformVertical(), true);
  for (const motion of [null, { kind: 'horizontal', offsetX: 160, speed: 80 }, { kind: 'vertical', offsetY: -160, speed: 80 }]) {
    const value = document(); if (motion) value.bodies[0].platformMotion = motion; else delete value.bodies[0].platformMotion;
    const before = structuredClone(value), result = inspectScenePhysics2D(value);
    assert.deepEqual(result.document, before); assert.deepEqual(wasm(request(value)).scenePhysics2D.document, before);
    assert.ok(Object.isFrozen(result.document.bodies[0].oneWay)); assert.ok(Object.isFrozen(result.document.bodies[1].characterMotion));
    if (motion) { assert.ok(Object.isFrozen(result.document.bodies[0].platformMotion)); value.bodies[0].platformMotion.speed = 100; assert.equal(result.document.bodies[0].platformMotion.speed, 80); }
  }
});

test('six operation domains remain separate and schema5 explicitly rejects vertical motion', async () => {
  const { module } = await bridge();
  for (let version = 1; version <= 6; version++) for (let domain = 1; domain <= 6; domain++) {
    const value = legacy(version), run = () => module[dispatches[domain - 1]](request(value, domain));
    if (version === domain) assert.deepEqual(run().document, value); else assert.throws(run, invalid);
  }
  for (let version = 1; version < 6; version++) {
    const value = legacy(version); value.bodies[0].platformMotion = document().bodies[0].platformMotion;
    assert.throws(() => inspectScenePhysics2D(value), invalid);
  }
  assert.throws(() => module.dispatchStudioCoreScenePhysics2DPlatformVertical(request(document(), 5)), { errorCode: 'studio_core_request_invalid' });
  assert.equal(getStudioCoreMetadata().ready, true);
});

test('vertical platform values are bounded finite signed travel on static boxes with no second axis', () => {
  for (const offsetY of [-8192, -1.125, -1, 1, 1.125, 8192]) for (const speed of [1, 1.25, 2000]) {
    const value = document(); value.bodies[0].platformMotion = { kind: 'vertical', offsetY, speed }; assert.deepEqual(inspectScenePhysics2D(value).document, value);
  }
  for (const motion of badMotions) { const value = document(); value.bodies[0].platformMotion = motion; assert.throws(() => inspectScenePhysics2D(value), invalid); }
  for (const alter of [d => d.bodies[0].kind = 'character', d => d.bodies[0].kind = 'sensor', d => d.bodies[0].shape = { kind: 'circle', radius: 16 },
    d => d.bodies[0].oneWay.margin = 0, d => d.bodies[1].characterMotion.gravity = 20001, d => d.bodies[0].collisionResponse = 'slide',
    d => d.bodies[0].mask = 65536, d => d.bodies[0].offset = [8193, 0], d => d.bodies.push(structuredClone(d.bodies[0])), d => d.bodies = []]) {
    const value = document(); alter(value); assert.throws(() => inspectScenePhysics2D(value), invalid);
  }
  const value = document(); value.bodies = Array.from({ length: 128 }, (_, n) => ({ ...body(n), platformMotion: { kind: 'vertical', offsetY: -1, speed: 2000 } }));
  assert.equal(inspectScenePhysics2D(value).document.bodies.length, 128); value.bodies.push(body(128)); assert.throws(() => inspectScenePhysics2D(value), invalid);
  const raw = JSON.stringify(request(document()));
  for (const [from, to] of [['"offsetY":-160', '"offsetY":1,"offset\\u0059":-160'], ['"platformMotion":', '"platformMotio\\u006e":null,"platformMotion":'], ['"speed":80', '"speed":1e999']]) assert.equal(wasm(raw.replace(from, to)).errorCode, 'studio_core_request_invalid');
});

test('schema6 facade rejects getters serializers hidden keys and nonfinite numbers before execution', () => {
  let calls = 0;
  for (const field of ['schemaVersion', 'platformMotion', 'offsetY', 'speed']) {
    const value = document(), target = field === 'schemaVersion' ? value : field === 'platformMotion' ? value.bodies[0] : value.bodies[0].platformMotion;
    Object.defineProperty(target, field, { enumerable: true, get() { calls++; return 1; } });
    assert.throws(() => inspectScenePhysics2D(value), { errorCode: 'studio_core_request_invalid' });
  }
  for (const alter of [d => d.bodies[0].platformMotion.offsetY = Infinity, d => d.bodies[0].platformMotion.speed = NaN,
    d => d.bodies[0].platformMotion.toJSON = () => { calls++; return {}; }, d => Object.defineProperty(d.bodies[0].platformMotion, 'hidden', { value: 1 })]) {
    const value = document(); alter(value); assert.throws(() => inspectScenePhysics2D(value), { errorCode: 'studio_core_request_invalid' });
  }
  assert.equal(calls, 0);
});

test('missing vertical marker blocks schema6 without invoking native code while all older domains remain available', async () => {
  for (const marker of [null, 0, 2]) {
    const { module, calls } = await bridge({ marker });
    assert.equal(module.supportsStudioCoreScenePhysics2DPlatformVertical(), false);
    assert.throws(() => module.dispatchStudioCoreScenePhysics2DPlatformVertical(request(document())), { errorCode: 'studio_core_unavailable' }); assert.equal(calls(), 0);
    for (let version = 1; version < 6; version++) assert.deepEqual(module[dispatches[version - 1]](request(legacy(version), version)).document, legacy(version));
    assert.equal(module.getStudioCoreMetadata().ready, true);
  }
  const { module } = await bridge({ older: false });
  assert.equal(module.supportsStudioCoreScenePhysics2DPlatformMotion(), false);
  assert.equal(module.supportsStudioCoreScenePhysics2DPlatformVertical(), true);
  assert.deepEqual(module.dispatchStudioCoreScenePhysics2DPlatformVertical(request(document())).document, document());
});

test('native schema6 receipts cannot approve invalid input or mutate source semantic values', async () => {
  for (const mutate of [r => delete r.scenePhysics2D.document.bodies[0].platformMotion, r => r.scenePhysics2D.document.bodies[0].platformMotion.speed = 100,
    r => r.scenePhysics2D.document.bodies[0].platformMotion.offsetY = 160, r => r.scenePhysics2D.document.bodies[0].platformMotion.offsetX = 0,
    r => r.scenePhysics2D.document.bodies[0].oneWay.margin = 2, r => r.scenePhysics2D.document.bodies[1].characterMotion.jumpSpeed = 0, r => r.scenePhysics2D.document.schemaVersion = 5]) {
    const { module } = await bridge({ mutate }); assert.throws(() => module.dispatchStudioCoreScenePhysics2DPlatformVertical(request(document())), { errorCode: 'studio_core_unavailable' }); assert.equal(module.getStudioCoreMetadata().ready, false);
  }
  for (const replacement of badMotions) {
    const value = document(); value.bodies[0].platformMotion = replacement;
    const { module } = await bridge({ mutate: (r, input) => { for (const key of Object.keys(r)) delete r[key]; Object.assign(r, { protocolVersion: 1, ok: true, scenePhysics2D: { document: input.document } }); } });
    assert.throws(() => module.dispatchStudioCoreScenePhysics2DPlatformVertical(request(value)), { errorCode: 'studio_core_unavailable' }); assert.equal(module.getStudioCoreMetadata().ready, false);
  }
});
