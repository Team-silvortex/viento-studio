import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { inspectScenePhysics2D } from '../../engine/scene-physics2d-core.mjs';
import { supportsStudioCoreScenePhysics2DOneWay, getStudioCoreMetadata,
  dispatchStudioCoreScenePhysics2D, dispatchStudioCoreScenePhysics2DResponse,
  dispatchStudioCoreScenePhysics2DMotion, dispatchStudioCoreScenePhysics2DOneWay } from '../../engine/studio-core.mjs';

const id = n => `${String(n).padStart(8, '0')}-1111-4111-8111-111111111111`;
const motion = () => ({ kind: 'platformer', gravity: 980, jumpSpeed: 360, maxFallSpeed: 1200 });
const body = (n = 1, kind = 'static') => ({ id: id(n), instanceId: id(1000 + n), kind,
  shape: { kind: 'box', size: [32, 48] }, offset: [0, 0], layer: 1, mask: 2 });
const document = () => ({ format: 'viento-scene-physics2d', schemaVersion: 4, sceneObjectId: id(900),
  bodies: [{ ...body(), oneWay: { margin: 1 } }, { ...body(2, 'character'), collisionResponse: 'slide', characterMotion: motion() }, body(3, 'sensor')] });
const legacyDocument = schemaVersion => {
  const value = document(); value.schemaVersion = schemaVersion;
  if (schemaVersion < 4) delete value.bodies[0].oneWay;
  if (schemaVersion < 3) delete value.bodies[1].characterMotion;
  if (schemaVersion < 2) delete value.bodies[1].collisionResponse;
  return value;
};
const request = doc => ({ protocolVersion: 1, operation: 'scenePhysics2D.inspectOneWay', document: doc });
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
  const module = await import(`../../engine/studio-core.mjs?one-way-test=${++index}`);
  const memory = new WebAssembly.Memory({ initial: 40 }), original = WebAssembly.instantiate;
  let inputLength = 0, outputLength = 0, calls = 0;
  try {
    WebAssembly.instantiate = async () => ({ instance: { exports: {
      memory, viento_core_protocol_version: () => 1,
      ...(legacy ? { viento_core_scene_physics2d_version: () => 1, viento_core_scene_physics2d_response_version: () => 1, viento_core_scene_physics2d_motion_version: () => 1 } : {}),
      ...(marker === null ? {} : { viento_core_scene_physics2d_one_way_version: () => marker }),
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

test('schema4 marker and exact detached receipts include one-way platforms and inherited motion', () => {
  assert.equal(native.viento_core_scene_physics2d_one_way_version(), 1);
  assert.equal(supportsStudioCoreScenePhysics2DOneWay(), true);
  for (const enabled of [true, false]) {
    const value = document(); if (!enabled) delete value.bodies[0].oneWay;
    const before = structuredClone(value), result = inspectScenePhysics2D(value);
    assert.deepEqual(result.document, before); assert.deepEqual(wasm(request(value)).scenePhysics2D.document, before);
    assert.ok(Object.isFrozen(result.document.bodies[0]));
    assert.ok(Object.isFrozen(result.document.bodies[1].characterMotion));
    if (enabled) { assert.ok(Object.isFrozen(result.document.bodies[0].oneWay)); value.bodies[0].oneWay.margin = 64; assert.equal(result.document.bodies[0].oneWay.margin, 1); }
  }
});

test('all four physics schemas remain separate operation domains and only schema4 accepts oneWay', () => {
  const dispatches = [dispatchStudioCoreScenePhysics2D, dispatchStudioCoreScenePhysics2DResponse, dispatchStudioCoreScenePhysics2DMotion, dispatchStudioCoreScenePhysics2DOneWay];
  const operations = ['scenePhysics2D.inspect', 'scenePhysics2D.inspectResponse', 'scenePhysics2D.inspectMotion', 'scenePhysics2D.inspectOneWay'];
  for (const schemaVersion of [1, 2, 3, 4]) for (let domain = 1; domain <= 4; domain++) {
    const value = legacyDocument(schemaVersion), run = () => dispatches[domain - 1]({ ...request(value), operation: operations[domain - 1] });
    if (schemaVersion === domain) assert.deepEqual(run().document, value); else assert.throws(run, invalid);
  }
  for (const schemaVersion of [1, 2, 3]) {
    const value = legacyDocument(schemaVersion); value.bodies[0].oneWay = { margin: 1 };
    assert.throws(() => inspectScenePhysics2D(value), invalid);
  }
  for (const dispatch of dispatches.slice(0, 3)) assert.throws(() => dispatch(request(document())), { errorCode: 'studio_core_request_invalid' });
  const value = document(); value.schemaVersion = 6; assert.throws(() => inspectScenePhysics2D(value), invalid);
  assert.equal(getStudioCoreMetadata().ready, true);
});

test('oneWay requires exactly a bounded margin on a static rectangle and retains motion validation', () => {
  for (const margin of [1, 1.125, 64]) { const value = document(); value.bodies[0].oneWay.margin = margin; assert.deepEqual(inspectScenePhysics2D(value).document, value); }
  for (const replacement of [null, true, false, 1, '', 'up', [], {}, { margin: -0.01 }, { margin: 0 }, { margin: .999 }, { margin: 64.01 }, { margin: '1' }, { margin: false }, { margin: null }, { margin: [] }, { margin: {} }, { margin: 1, direction: 'up' }]) {
    const value = document(); value.bodies[0].oneWay = replacement; assert.throws(() => inspectScenePhysics2D(value), invalid);
  }
  for (const mutate of [d => d.bodies[0].kind = 'character', d => d.bodies[0].kind = 'sensor', d => d.bodies[0].shape = { kind: 'circle', radius: 16 },
    d => d.bodies[0].collisionResponse = 'slide', d => d.bodies[0].extra = true, d => d.bodies[1].collisionResponse = 'stop',
    d => delete d.bodies[1].collisionResponse, d => d.bodies[1].characterMotion.gravity = 20001, d => d.bodies[1].characterMotion.extra = true]) {
    const value = document(); mutate(value); assert.throws(() => inspectScenePhysics2D(value), invalid);
  }
});

test('schema4 preserves geometry identity and collection limits', () => {
  for (const mutate of [d => d.bodies[0].offset[0] = 8193, d => d.bodies[0].shape.size[0] = 0, d => d.bodies[0].mask = 65536,
    d => d.bodies.push(structuredClone(d.bodies[0])), d => d.bodies = []]) {
    const value = document(); mutate(value); assert.throws(() => inspectScenePhysics2D(value), invalid);
  }
  const value = document(); value.bodies = Array.from({ length: 128 }, (_, n) => ({ ...body(n), oneWay: { margin: 1 + n / 4 } }));
  assert.equal(inspectScenePhysics2D(value).document.bodies.length, 128);
  value.bodies.push(body(128)); assert.throws(() => inspectScenePhysics2D(value), invalid);
});

test('raw schema4 requests reject decoded duplicate optional and nested keys and nonfinite numeric spelling', () => {
  const raw = JSON.stringify(request(document()));
  for (const [from, to] of [['"margin":1', '"margin":0,"marg\\u0069n":1'], ['"oneWay":', '"oneWa\\u0079":null,"oneWay":'],
    ['"gravity":980', '"gravity":1,"grav\\u0069ty":980'], ['"margin":1', '"margin":1e999']]) {
    assert.equal(wasm(raw.replace(from, to)).errorCode, 'studio_core_request_invalid');
  }
});

test('facade capture rejects accessors serializers hidden keys nonfinite numbers and sparse arrays before invocation', () => {
  let calls = 0;
  for (const field of ['schemaVersion', 'oneWay', 'margin']) {
    const value = document(), target = field === 'schemaVersion' ? value : field === 'oneWay' ? value.bodies[0] : value.bodies[0].oneWay;
    Object.defineProperty(target, field, { enumerable: true, get() { calls++; return 1; } });
    assert.throws(() => inspectScenePhysics2D(value), { errorCode: 'studio_core_request_invalid' });
  }
  for (const mutate of [d => d.bodies[0].oneWay.margin = Infinity, d => d.bodies[0].oneWay.margin = NaN,
    d => d.bodies[0].oneWay.toJSON = () => { calls++; return { margin: 1 }; }, d => Object.defineProperty(d.bodies[0].oneWay, 'hidden', { value: 1 }), d => delete d.bodies[0]]) {
    const value = document(); mutate(value); assert.throws(() => inspectScenePhysics2D(value), { errorCode: 'studio_core_request_invalid' });
  }
  assert.equal(calls, 0);
});

test('missing or unsupported one-way marker preserves every older domain and layout without new dispatch', async () => {
  for (const marker of [null, 0, 2]) {
    const { module, calls } = await bridge({ marker });
    assert.equal(module.supportsStudioCoreScenePhysics2DOneWay(), false);
    assert.throws(() => module.dispatchStudioCoreScenePhysics2DOneWay(request(document())), { errorCode: 'studio_core_unavailable' });
    assert.equal(calls(), 0); assert.equal(module.getStudioCoreMetadata().ready, true);
    for (const [version, name, operation] of [[1, 'dispatchStudioCoreScenePhysics2D', 'inspect'], [2, 'dispatchStudioCoreScenePhysics2DResponse', 'inspectResponse'], [3, 'dispatchStudioCoreScenePhysics2DMotion', 'inspectMotion']]) {
      const value = legacyDocument(version); assert.deepEqual(module[name]({ ...request(value), operation: 'scenePhysics2D.' + operation }).document, value);
    }
    assert.deepEqual(module.dispatchStudioCore({ protocolVersion: 1, operation: 'validateBatch', actors: [{ objectId: 'one', position: [0, 0] }], changes: [] }), []);
  }
});

test('schema4 marker independently validates inherited fields without any older optional marker', async () => {
  const { module } = await bridge({ legacy: false });
  assert.equal(module.supportsStudioCoreScenePhysics2D(), false); assert.equal(module.supportsStudioCoreScenePhysics2DResponse(), false);
  assert.equal(module.supportsStudioCoreScenePhysics2DMotion(), false); assert.equal(module.supportsStudioCoreScenePhysics2DOneWay(), true);
  assert.deepEqual(module.dispatchStudioCoreScenePhysics2DOneWay(request(document())).document, document());
  const disabled = document(); delete disabled.bodies[0].oneWay;
  assert.deepEqual(module.dispatchStudioCoreScenePhysics2DOneWay(request(disabled)).document, disabled);
});

test('native receipts cannot change fields or approve invalid one-way declarations', async () => {
  for (const mutate of [r => delete r.scenePhysics2D.document.bodies[0].oneWay, r => r.scenePhysics2D.document.bodies[0].oneWay.margin = 64,
    r => r.scenePhysics2D.document.bodies[0].oneWay.normal = [0, -1], r => r.scenePhysics2D.document.bodies[1].characterMotion.jumpSpeed = 0,
    r => r.scenePhysics2D.document.schemaVersion = 3]) {
    const { module } = await bridge({ mutate });
    assert.throws(() => module.dispatchStudioCoreScenePhysics2DOneWay(request(document())), { errorCode: 'studio_core_unavailable' });
    assert.equal(module.getStudioCoreMetadata().ready, false);
  }
  for (const change of [d => d.bodies[0].oneWay.margin = 65, d => d.bodies[0].oneWay.margin = 0, d => d.bodies[0].oneWay = true, d => d.bodies[0].kind = 'sensor',
    d => d.bodies[0].shape = { kind: 'circle', radius: 16 }, d => d.bodies[0].oneWay.extra = 1, d => d.bodies[1].characterMotion.jumpSpeed = -1]) {
    const value = document(); change(value);
    const { module } = await bridge({ mutate: (r, input) => {
      for (const key of Object.keys(r)) delete r[key]; Object.assign(r, { protocolVersion: 1, ok: true, scenePhysics2D: { document: input.document } });
    } });
    assert.throws(() => module.dispatchStudioCoreScenePhysics2DOneWay(request(value)), { errorCode: 'studio_core_unavailable' });
    assert.equal(module.getStudioCoreMetadata().ready, false);
  }
});
