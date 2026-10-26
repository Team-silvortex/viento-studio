import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { inspectScenePhysics2D } from '../../engine/scene-physics2d-core.mjs';
import { supportsStudioCoreScenePhysics2DPlatformMotion, getStudioCoreMetadata,
  dispatchStudioCoreScenePhysics2D, dispatchStudioCoreScenePhysics2DResponse,
  dispatchStudioCoreScenePhysics2DMotion, dispatchStudioCoreScenePhysics2DOneWay, dispatchStudioCoreScenePhysics2DPlatformMotion } from '../../engine/studio-core.mjs';

const id = n => `${String(n).padStart(8, '0')}-1111-4111-8111-111111111111`;
const motion = () => ({ kind: 'platformer', gravity: 980, jumpSpeed: 360, maxFallSpeed: 1200 });
const body = (n = 1, kind = 'static') => ({ id: id(n), instanceId: id(1000 + n), kind,
  shape: { kind: 'box', size: [32, 48] }, offset: [0, 0], layer: 1, mask: 2 });
const document = () => ({ format: 'viento-scene-physics2d', schemaVersion: 5, sceneObjectId: id(900),
  bodies: [{ ...body(), oneWay: { margin: 1 }, platformMotion: { kind: 'horizontal', offsetX: 160, speed: 80 } }, { ...body(2, 'character'), collisionResponse: 'slide', characterMotion: motion() }, body(3, 'sensor')] });
const legacyDocument = schemaVersion => {
  const value = document(); value.schemaVersion = schemaVersion;
  if (schemaVersion < 5) delete value.bodies[0].platformMotion;
  if (schemaVersion < 4) delete value.bodies[0].oneWay;
  if (schemaVersion < 3) delete value.bodies[1].characterMotion;
  if (schemaVersion < 2) delete value.bodies[1].collisionResponse;
  return value;
};
const request = doc => ({ protocolVersion: 1, operation: 'scenePhysics2D.inspectPlatformMotion', document: doc });
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
async function bridge({ marker = 1, legacy = true, mutate } = {}) {
  const module = await import(`../../engine/studio-core.mjs?platform-motion-test=${++index}`);
  const memory = new WebAssembly.Memory({ initial: 40 }), original = WebAssembly.instantiate;
  let inputLength = 0, outputLength = 0, calls = 0;
  try {
    WebAssembly.instantiate = async () => ({ instance: { exports: {
      memory, viento_core_protocol_version: () => 1,
      ...(legacy ? { viento_core_scene_physics2d_version: () => 1, viento_core_scene_physics2d_response_version: () => 1, viento_core_scene_physics2d_motion_version: () => 1, viento_core_scene_physics2d_one_way_version: () => 1 } : {}),
      ...(marker === null ? {} : { viento_core_scene_physics2d_platform_motion_version: () => marker }),
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


test('schema5 real WASM marker and exact detached receipts retain all inherited declarations', () => {
  assert.equal(native.viento_core_scene_physics2d_platform_motion_version(), 1);
  assert.equal(supportsStudioCoreScenePhysics2DPlatformMotion(), true);
  for (const enabled of [true, false]) {
    const value = document(); if (!enabled) delete value.bodies[0].platformMotion;
    const before = structuredClone(value), result = inspectScenePhysics2D(value);
    assert.deepEqual(result.document, before); assert.deepEqual(wasm(request(value)).scenePhysics2D.document, before);
    for (const row of result.document.bodies) assert.ok(Object.isFrozen(row));
    assert.ok(Object.isFrozen(result.document.bodies[0].oneWay)); assert.ok(Object.isFrozen(result.document.bodies[1].characterMotion));
    if (enabled) { assert.ok(Object.isFrozen(result.document.bodies[0].platformMotion)); value.bodies[0].platformMotion.speed = 100; assert.equal(result.document.bodies[0].platformMotion.speed, 80); }
  }
});

test('all five schema operations remain separate and older schemas reject platform motion', () => {
  const dispatches = [dispatchStudioCoreScenePhysics2D, dispatchStudioCoreScenePhysics2DResponse, dispatchStudioCoreScenePhysics2DMotion, dispatchStudioCoreScenePhysics2DOneWay, dispatchStudioCoreScenePhysics2DPlatformMotion];
  const operations = ['inspect', 'inspectResponse', 'inspectMotion', 'inspectOneWay', 'inspectPlatformMotion'];
  for (const version of [1, 2, 3, 4, 5]) for (let domain = 1; domain <= 5; domain++) {
    const value = legacyDocument(version), run = () => dispatches[domain - 1]({ ...request(value), operation: 'scenePhysics2D.' + operations[domain - 1] });
    if (version === domain) assert.deepEqual(run().document, value); else assert.throws(run, invalid);
  }
  for (const version of [1, 2, 3, 4]) { const value = legacyDocument(version); value.bodies[0].platformMotion = document().bodies[0].platformMotion; assert.throws(() => inspectScenePhysics2D(value), invalid); }
  for (const dispatch of dispatches.slice(0, 4)) assert.throws(() => dispatch(request(document())), { errorCode: 'studio_core_request_invalid' });
  const value = document(); value.schemaVersion = 6; assert.throws(() => inspectScenePhysics2D(value), invalid);
  assert.equal(getStudioCoreMetadata().ready, true);
});

const badMotions = [null, false, true, 1, 'horizontal', [], {},
  ...[-8192.001, -.999, -0, 0, .999, 8192.001, '160', null, true, [], {}].map(offsetX => ({ kind: 'horizontal', offsetX, speed: 80 })),
  ...[-1, 0, .999, 2000.001, '80', null, true, [], {}].map(speed => ({ kind: 'horizontal', offsetX: 160, speed })),
  { kind: 'linear', offsetX: 160, speed: 80 }, { kind: 'horizontal', offsetX: 160, speed: 80, offsetY: 0 },
  { kind: 'horizontal', speed: 80 }, { offsetX: 160, speed: 80 }, { kind: 'horizontal', offsetX: 160 }];
test('platform motion is exact horizontal static box with finite inclusive travel and speed bounds', () => {
  for (const offsetX of [-8192, -1, 1, 1.125, 8192]) for (const speed of [1, 1.25, 2000]) {
    const value = document(); value.bodies[0].platformMotion = { kind: 'horizontal', offsetX, speed }; assert.deepEqual(inspectScenePhysics2D(value).document, value);
  }
  for (const motion of badMotions) { const value = document(); value.bodies[0].platformMotion = motion; assert.throws(() => inspectScenePhysics2D(value), invalid); }
  for (const mutate of [d => d.bodies[0].kind = 'character', d => d.bodies[0].kind = 'sensor', d => d.bodies[0].shape = { kind: 'circle', radius: 16 },
    d => d.bodies[0].oneWay.margin = 0, d => d.bodies[1].characterMotion.gravity = 20001, d => d.bodies[0].collisionResponse = 'slide']) {
    const value = document(); mutate(value); assert.throws(() => inspectScenePhysics2D(value), invalid);
  }
  const normal = document(); delete normal.bodies[0].oneWay; assert.deepEqual(inspectScenePhysics2D(normal).document, normal);
});

test('schema5 keeps geometry identities and collection limits and rejects duplicate raw keys', () => {
  for (const mutate of [d => d.bodies[0].offset[0] = 8193, d => d.bodies[0].shape.size[0] = 0, d => d.bodies[0].mask = 65536, d => d.bodies.push(structuredClone(d.bodies[0])), d => d.bodies = []]) {
    const value = document(); mutate(value); assert.throws(() => inspectScenePhysics2D(value), invalid);
  }
  const value = document(); value.bodies = Array.from({ length: 128 }, (_, n) => ({ ...body(n), platformMotion: { kind: 'horizontal', offsetX: -1, speed: 2000 } }));
  assert.equal(inspectScenePhysics2D(value).document.bodies.length, 128); value.bodies.push(body(128)); assert.throws(() => inspectScenePhysics2D(value), invalid);
  const raw = JSON.stringify(request(document()));
  for (const [from, to] of [['"offsetX":160', '"offsetX":1,"offset\\u0058":160'], ['"platformMotion":', '"platformMotio\\u006e":null,"platformMotion":'], ['"speed":80', '"speed":1e999']]) assert.equal(wasm(raw.replace(from, to)).errorCode, 'studio_core_request_invalid');
});

test('facade capture rejects accessors serializers hidden keys and nonfinite numbers without execution', () => {
  let calls = 0;
  for (const field of ['schemaVersion', 'platformMotion', 'offsetX', 'speed']) {
    const value = document(), target = field === 'schemaVersion' ? value : field === 'platformMotion' ? value.bodies[0] : value.bodies[0].platformMotion;
    Object.defineProperty(target, field, { enumerable: true, get() { calls++; return 1; } });
    assert.throws(() => inspectScenePhysics2D(value), { errorCode: 'studio_core_request_invalid' });
  }
  for (const mutate of [d => d.bodies[0].platformMotion.offsetX = Infinity, d => d.bodies[0].platformMotion.speed = NaN,
    d => d.bodies[0].platformMotion.toJSON = () => { calls++; return {}; }, d => Object.defineProperty(d.bodies[0].platformMotion, 'hidden', { value: 1 }), d => delete d.bodies[0]]) {
    const value = document(); mutate(value); assert.throws(() => inspectScenePhysics2D(value), { errorCode: 'studio_core_request_invalid' });
  }
  assert.equal(calls, 0);
});

test('missing or unsupported platform marker blocks only the new domain without dispatch', async () => {
  for (const marker of [null, 0, 2]) {
    const { module, calls } = await bridge({ marker });
    assert.equal(module.supportsStudioCoreScenePhysics2DPlatformMotion(), false);
    assert.throws(() => module.dispatchStudioCoreScenePhysics2DPlatformMotion(request(document())), { errorCode: 'studio_core_unavailable' }); assert.equal(calls(), 0);
    for (const [version, name, operation] of [[1, 'dispatchStudioCoreScenePhysics2D', 'inspect'], [2, 'dispatchStudioCoreScenePhysics2DResponse', 'inspectResponse'], [3, 'dispatchStudioCoreScenePhysics2DMotion', 'inspectMotion'], [4, 'dispatchStudioCoreScenePhysics2DOneWay', 'inspectOneWay']]) {
      const value = legacyDocument(version); assert.deepEqual(module[name]({ ...request(value), operation: 'scenePhysics2D.' + operation }).document, value);
    }
    assert.deepEqual(module.dispatchStudioCore({ protocolVersion: 1, operation: 'validateBatch', actors: [{ objectId: 'one', position: [0, 0] }], changes: [] }), []);
    assert.equal(module.getStudioCoreMetadata().ready, true);
  }
});

test('schema5 marker validates inherited fields independently of all older optional markers', async () => {
  const { module } = await bridge({ legacy: false });
  for (const name of ['supportsStudioCoreScenePhysics2D', 'supportsStudioCoreScenePhysics2DResponse', 'supportsStudioCoreScenePhysics2DMotion', 'supportsStudioCoreScenePhysics2DOneWay']) assert.equal(module[name](), false);
  assert.equal(module.supportsStudioCoreScenePhysics2DPlatformMotion(), true);
  assert.deepEqual(module.dispatchStudioCoreScenePhysics2DPlatformMotion(request(document())).document, document());
  const disabled = document(); delete disabled.bodies[0].platformMotion;
  assert.deepEqual(module.dispatchStudioCoreScenePhysics2DPlatformMotion(request(disabled)).document, disabled);
});

test('native receipts cannot mutate platform or inherited fields nor approve invalid platform declarations', async () => {
  for (const mutate of [r => delete r.scenePhysics2D.document.bodies[0].platformMotion, r => r.scenePhysics2D.document.bodies[0].platformMotion.speed = 100,
    r => r.scenePhysics2D.document.bodies[0].platformMotion.offsetX = -160, r => r.scenePhysics2D.document.bodies[0].platformMotion.offsetY = 0,
    r => r.scenePhysics2D.document.bodies[0].oneWay.margin = 2, r => r.scenePhysics2D.document.bodies[1].characterMotion.jumpSpeed = 0, r => r.scenePhysics2D.document.schemaVersion = 4]) {
    const { module } = await bridge({ mutate }); assert.throws(() => module.dispatchStudioCoreScenePhysics2DPlatformMotion(request(document())), { errorCode: 'studio_core_unavailable' }); assert.equal(module.getStudioCoreMetadata().ready, false);
  }
  for (const replacement of badMotions) {
    const value = document(); value.bodies[0].platformMotion = replacement;
    const { module } = await bridge({ mutate: (r, input) => { for (const key of Object.keys(r)) delete r[key]; Object.assign(r, { protocolVersion: 1, ok: true, scenePhysics2D: { document: input.document } }); } });
    assert.throws(() => module.dispatchStudioCoreScenePhysics2DPlatformMotion(request(value)), { errorCode: 'studio_core_unavailable' }); assert.equal(module.getStudioCoreMetadata().ready, false);
  }
});
