import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { inspectScenePhysics2D } from '../../engine/scene-physics2d-core.mjs';
import { supportsStudioCoreScenePhysics2DResponse, getStudioCoreMetadata,
  dispatchStudioCoreScenePhysics2D, dispatchStudioCoreScenePhysics2DResponse } from '../../engine/studio-core.mjs';

const id = n => `${String(n).padStart(8, '0')}-1111-4111-8111-111111111111`;
const body = (n = 1, kind = 'character') => ({ id: id(n), instanceId: id(1000 + n), kind,
  shape: { kind: 'box', size: [32, 48] }, offset: [0, 0], layer: 1, mask: 2 });
const document = (response = 'slide') => ({ format: 'viento-scene-physics2d', schemaVersion: 2, sceneObjectId: id(900),
  bodies: [{ ...body(), ...(response === undefined ? {} : { collisionResponse: response }) }] });
const request = doc => ({ protocolVersion: 1, operation: 'scenePhysics2D.inspectResponse', document: doc });
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
  const module = await import(`../../engine/studio-core.mjs?response-test=${++index}`);
  const memory = new WebAssembly.Memory({ initial: 40 }), original = WebAssembly.instantiate;
  let inputLength = 0, outputLength = 0, calls = 0;
  try {
    WebAssembly.instantiate = async () => ({ instance: { exports: {
      memory, viento_core_protocol_version: () => 1,
      ...(legacy ? { viento_core_scene_physics2d_version: () => 1 } : {}),
      ...(marker === null ? {} : { viento_core_scene_physics2d_response_version: () => marker }),
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

test('response inspection has an independent marker and preserves omitted stop explicit stop and slide declarations', () => {
  assert.equal(native.viento_core_protocol_version(), 1); assert.equal(native.viento_core_scene_physics2d_version(), 1);
  assert.equal(native.viento_core_scene_physics2d_response_version(), 1); assert.equal(supportsStudioCoreScenePhysics2DResponse(), true);
  for (const response of ['stop', 'slide', null]) {
    const value = document(); if (response === null) delete value.bodies[0].collisionResponse; else value.bodies[0].collisionResponse = response;
    const original = structuredClone(value), result = inspectScenePhysics2D(value);
    assert.deepEqual(result.document, original); assert.deepEqual(wasm(request(value)).scenePhysics2D.document, original);
    assert.ok(Object.isFrozen(result.document.bodies[0].shape.size)); value.bodies[0].offset[0] = 99;
    assert.equal(result.document.bodies[0].offset[0], 0);
  }
});
test('schema and operation domains stay separate and legacy documents reject even an explicit stop property', () => {
  const old = document('stop'); old.schemaVersion = 1;
  assert.throws(() => inspectScenePhysics2D(old), { errorCode: 'scene_physics2d_invalid' });
  delete old.bodies[0].collisionResponse;
  assert.deepEqual(inspectScenePhysics2D(old).document, old);
  assert.throws(() => dispatchStudioCoreScenePhysics2DResponse(request(old)), { errorCode: 'scene_physics2d_invalid' });
  assert.throws(() => dispatchStudioCoreScenePhysics2D({ ...request(document()), operation: 'scenePhysics2D.inspect' }), { errorCode: 'scene_physics2d_invalid' });
  assert.throws(() => dispatchStudioCoreScenePhysics2D(request(document())), { errorCode: 'studio_core_request_invalid' });
  assert.equal(getStudioCoreMetadata().ready, true);
});
test('response is optional only for characters and rejects all non-enum values without losing the core', () => {
  for (const response of [null, true, 1, '', 'Slide', 'stop ', [], {}]) assert.throws(() => inspectScenePhysics2D(document(response)), { errorCode: 'scene_physics2d_invalid' });
  for (const kind of ['static', 'sensor']) {
    const value = document(); value.bodies[0].kind = kind;
    assert.throws(() => inspectScenePhysics2D(value), { errorCode: 'scene_physics2d_invalid' });
    delete value.bodies[0].collisionResponse; assert.deepEqual(inspectScenePhysics2D(value).document, value);
  }
  const value = document(); value.bodies[0].extra = 1;
  assert.throws(() => inspectScenePhysics2D(value), { errorCode: 'scene_physics2d_invalid' }); assert.equal(getStudioCoreMetadata().ready, true);
});
test('new raw request rejects decoded duplicate response keys and retains bounded identities geometry and masks', () => {
  const raw = JSON.stringify(request(document()));
  assert.equal(wasm(raw.replace('"collisionResponse":"slide"', '"collisionResponse":"stop","collisionRespon\\u0073e":"slide"')).errorCode, 'studio_core_request_invalid');
  for (const mutation of [d => d.bodies[0].offset[0] = 8193, d => d.bodies[0].shape.size[0] = 0,
    d => d.bodies[0].mask = 65536, d => d.bodies.push(structuredClone(d.bodies[0])), d => d.bodies = []]) {
    const value = document(); mutation(value); assert.throws(() => inspectScenePhysics2D(value), { errorCode: 'scene_physics2d_invalid' });
  }
  const value = document(); value.bodies = Array.from({ length: 128 }, (_, n) => ({ ...body(n), collisionResponse: 'slide' }));
  assert.equal(inspectScenePhysics2D(value).document.bodies.length, 128);
  value.bodies.push(body(128)); assert.throws(() => inspectScenePhysics2D(value), { errorCode: 'scene_physics2d_invalid' });
});
test('facade and bridge never invoke schema or response getters or hidden serializers', () => {
  let calls = 0;
  for (const field of ['schemaVersion', 'collisionResponse']) {
    const value = document(), target = field === 'schemaVersion' ? value : value.bodies[0];
    Object.defineProperty(target, field, { enumerable: true, get() { calls++; return field === 'schemaVersion' ? 2 : 'slide'; } });
    assert.throws(() => inspectScenePhysics2D(value), { errorCode: 'studio_core_request_invalid' });
  }
  assert.equal(calls, 0);
});
test('older core markers keep schema1 and layout usable while schema2 refuses before native execution', async () => {
  for (const marker of [null, 0, 2]) {
    const { module, calls } = await bridge({ marker });
    assert.equal(module.supportsStudioCoreScenePhysics2DResponse(), false);
    assert.throws(() => module.dispatchStudioCoreScenePhysics2DResponse(request(document())), { errorCode: 'studio_core_unavailable' });
    assert.equal(calls(), 0); assert.equal(module.getStudioCoreMetadata().ready, true);
    const old = document(); old.schemaVersion = 1; delete old.bodies[0].collisionResponse;
    assert.deepEqual(module.dispatchStudioCoreScenePhysics2D({ ...request(old), operation: 'scenePhysics2D.inspect' }).document, old);
    assert.deepEqual(module.dispatchStudioCore({ protocolVersion: 1, operation: 'validateBatch', actors: [{ objectId: 'one', position: [0, 0] }], changes: [] }), []);
  }
});
test('response marker is independent of the old optional marker', async () => {
  const { module } = await bridge({ legacy: false });
  assert.equal(module.supportsStudioCoreScenePhysics2D(), false); assert.equal(module.supportsStudioCoreScenePhysics2DResponse(), true);
  assert.deepEqual(module.dispatchStudioCoreScenePhysics2DResponse(request(document())).document, document());
});
test('a native receipt cannot drop add or change the response declaration', async () => {
  for (const mutate of [r => delete r.scenePhysics2D.document.bodies[0].collisionResponse,
    r => r.scenePhysics2D.document.bodies[0].collisionResponse = 'stop', r => r.scenePhysics2D.document.schemaVersion = 1]) {
    const { module } = await bridge({ mutate });
    assert.throws(() => module.dispatchStudioCoreScenePhysics2DResponse(request(document())), { errorCode: 'studio_core_unavailable' });
    assert.equal(module.getStudioCoreMetadata().ready, false);
  }
});
