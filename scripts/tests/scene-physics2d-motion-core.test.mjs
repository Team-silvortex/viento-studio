import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { inspectScenePhysics2D } from '../../engine/scene-physics2d-core.mjs';
import { supportsStudioCoreScenePhysics2DMotion, getStudioCoreMetadata,
  dispatchStudioCoreScenePhysics2D, dispatchStudioCoreScenePhysics2DResponse,
  dispatchStudioCoreScenePhysics2DMotion } from '../../engine/studio-core.mjs';

const id = n => `${String(n).padStart(8, '0')}-1111-4111-8111-111111111111`;
const motion = () => ({ kind: 'platformer', gravity: 980, jumpSpeed: 360, maxFallSpeed: 1200 });
const body = (n = 1, kind = 'character') => ({ id: id(n), instanceId: id(1000 + n), kind,
  shape: { kind: 'box', size: [32, 48] }, offset: [0, 0], layer: 1, mask: 2 });
const document = () => ({ format: 'viento-scene-physics2d', schemaVersion: 3, sceneObjectId: id(900),
  bodies: [{ ...body(), collisionResponse: 'slide', characterMotion: motion() }] });
const request = doc => ({ protocolVersion: 1, operation: 'scenePhysics2D.inspectMotion', document: doc });
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
  const module = await import(`../../engine/studio-core.mjs?motion-test=${++index}`);
  const memory = new WebAssembly.Memory({ initial: 40 }), original = WebAssembly.instantiate;
  let inputLength = 0, outputLength = 0, calls = 0;
  try {
    WebAssembly.instantiate = async () => ({ instance: { exports: {
      memory, viento_core_protocol_version: () => 1,
      ...(legacy ? { viento_core_scene_physics2d_version: () => 1, viento_core_scene_physics2d_response_version: () => 1 } : {}),
      ...(marker === null ? {} : { viento_core_scene_physics2d_motion_version: () => marker }),
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

test('motion has an independent marker and a detached exact native receipt, including disabled schema3 documents', () => {
  assert.equal(native.viento_core_protocol_version(), 1);
  assert.equal(native.viento_core_scene_physics2d_version(), 1);
  assert.equal(native.viento_core_scene_physics2d_response_version(), 1);
  assert.equal(native.viento_core_scene_physics2d_motion_version(), 1);
  assert.equal(supportsStudioCoreScenePhysics2DMotion(), true);
  for (const enabled of [true, false]) for (const kind of ['box', 'circle']) {
    const value = document();
    if (kind === 'circle') value.bodies[0].shape = { kind, radius: 16 };
    if (!enabled) delete value.bodies[0].characterMotion;
    const original = structuredClone(value), result = inspectScenePhysics2D(value);
    assert.deepEqual(result.document, original); assert.deepEqual(wasm(request(value)).scenePhysics2D.document, original);
    assert.ok(Object.isFrozen(result.document.bodies[0]));
    if (enabled) {
      assert.ok(Object.isFrozen(result.document.bodies[0].characterMotion));
      value.bodies[0].characterMotion.gravity = 1; assert.equal(result.document.bodies[0].characterMotion.gravity, 980);
    }
  }
});

test('schema1 schema2 and schema3 stay in separate native operation domains', () => {
  const dispatches = [dispatchStudioCoreScenePhysics2D, dispatchStudioCoreScenePhysics2DResponse, dispatchStudioCoreScenePhysics2DMotion];
  const operations = ['scenePhysics2D.inspect', 'scenePhysics2D.inspectResponse', 'scenePhysics2D.inspectMotion'];
  for (const schemaVersion of [1, 2, 3]) for (let domain = 1; domain <= 3; domain++) {
    const value = document(); value.schemaVersion = schemaVersion;
    if (schemaVersion < 3) delete value.bodies[0].characterMotion;
    if (schemaVersion === 1) delete value.bodies[0].collisionResponse;
    const run = () => dispatches[domain - 1]({ ...request(value), operation: operations[domain - 1] });
    if (schemaVersion === domain) assert.deepEqual(run().document, value); else assert.throws(run, invalid);
  }
  for (const schemaVersion of [1, 2]) {
    const value = document(); value.schemaVersion = schemaVersion;
    assert.throws(() => inspectScenePhysics2D(value), invalid);
  }
  assert.throws(() => dispatchStudioCoreScenePhysics2D(request(document())), { errorCode: 'studio_core_request_invalid' });
  assert.equal(getStudioCoreMetadata().ready, true);
});

test('motion requires a complete exact object, a character body and explicit slide', () => {
  for (const replacement of [null, true, 1, '', 'platformer', [], {}]) {
    const value = document(); value.bodies[0].characterMotion = replacement;
    assert.throws(() => inspectScenePhysics2D(value), invalid);
  }
  for (const key of Object.keys(motion())) {
    const value = document(); delete value.bodies[0].characterMotion[key];
    assert.throws(() => inspectScenePhysics2D(value), invalid);
  }
  const changes = [d => d.bodies[0].characterMotion.kind = 'gravity', d => d.bodies[0].characterMotion.grounded = false,
    d => d.bodies[0].collisionResponse = 'stop', d => delete d.bodies[0].collisionResponse,
    ...['static', 'sensor'].map(kind => d => { d.bodies[0].kind = kind; delete d.bodies[0].collisionResponse; })];
  for (const change of changes) { const value = document(); change(value); assert.throws(() => inspectScenePhysics2D(value), invalid); }
  for (const kind of ['static', 'sensor']) {
    const value = document(); value.bodies[0] = body(1, kind); assert.deepEqual(inspectScenePhysics2D(value).document, value);
  }
});

test('motion bounds admit fractional units and zero jump only, while preserving old geometry and identity limits', () => {
  for (const [key, low, high] of [['gravity', 1, 20000], ['jumpSpeed', 0, 4000], ['maxFallSpeed', 1, 4000]]) {
    for (const number of [low, low + .5, high]) {
      const value = document(); value.bodies[0].characterMotion[key] = number;
      assert.deepEqual(inspectScenePhysics2D(value).document, value);
    }
    for (const number of [low - .01, high + .01, '1', null, false, [], {}]) {
      const value = document(); value.bodies[0].characterMotion[key] = number;
      assert.throws(() => inspectScenePhysics2D(value), invalid);
    }
  }
  for (const change of [d => d.bodies[0].offset[0] = 8193, d => d.bodies[0].shape.size[0] = 0,
    d => d.bodies[0].mask = 65536, d => d.bodies.push(structuredClone(d.bodies[0])), d => d.bodies = []]) {
    const value = document(); change(value); assert.throws(() => inspectScenePhysics2D(value), invalid);
  }
  const value = document(); value.bodies = Array.from({ length: 128 }, (_, n) => ({ ...body(n), collisionResponse: 'slide', characterMotion: motion() }));
  assert.equal(inspectScenePhysics2D(value).document.bodies.length, 128);
  value.bodies.push(body(128)); assert.throws(() => inspectScenePhysics2D(value), invalid);
});

test('raw requests reject decoded duplicate motion keys and nested numeric keys', () => {
  const raw = JSON.stringify(request(document()));
  for (const [from, to] of [['"gravity":980', '"gravity":1,"grav\\u0069ty":980'],
    ['"characterMotion":', '"characterMotio\\u006e":null,"characterMotion":']]) {
    assert.equal(wasm(raw.replace(from, to)).errorCode, 'studio_core_request_invalid');
  }
});

test('facade capture refuses motion getters serializers hidden keys nonfinite values and sparse arrays without invocation', () => {
  let calls = 0;
  for (const field of ['schemaVersion', 'characterMotion', 'gravity']) {
    const value = document(), target = field === 'schemaVersion' ? value : field === 'characterMotion' ? value.bodies[0] : value.bodies[0].characterMotion;
    Object.defineProperty(target, field, { enumerable: true, get() { calls++; return 1; } });
    assert.throws(() => inspectScenePhysics2D(value), { errorCode: 'studio_core_request_invalid' });
  }
  for (const mutate of [m => m.gravity = Infinity, m => m.jumpSpeed = NaN,
    m => m.toJSON = () => { calls++; return motion(); }, m => Object.defineProperty(m, 'hidden', { value: 1 })]) {
    const value = document(); mutate(value.bodies[0].characterMotion);
    assert.throws(() => inspectScenePhysics2D(value), { errorCode: 'studio_core_request_invalid' });
  }
  assert.equal(calls, 0);
});

test('absent or unsupported motion marker keeps both older domains and layout usable without dispatching motion', async () => {
  for (const marker of [null, 0, 2]) {
    const { module, calls } = await bridge({ marker });
    assert.equal(module.supportsStudioCoreScenePhysics2DMotion(), false);
    assert.throws(() => module.dispatchStudioCoreScenePhysics2DMotion(request(document())), { errorCode: 'studio_core_unavailable' });
    assert.equal(calls(), 0); assert.equal(module.getStudioCoreMetadata().ready, true);
    const value = document(); value.schemaVersion = 2; delete value.bodies[0].characterMotion;
    assert.deepEqual(module.dispatchStudioCoreScenePhysics2DResponse({ ...request(value), operation: 'scenePhysics2D.inspectResponse' }).document, value);
    value.schemaVersion = 1; delete value.bodies[0].collisionResponse;
    assert.deepEqual(module.dispatchStudioCoreScenePhysics2D({ ...request(value), operation: 'scenePhysics2D.inspect' }).document, value);
    assert.deepEqual(module.dispatchStudioCore({ protocolVersion: 1, operation: 'validateBatch', actors: [{ objectId: 'one', position: [0, 0] }], changes: [] }), []);
  }
});

test('motion marker is independent of both older optional markers', async () => {
  const { module } = await bridge({ legacy: false });
  assert.equal(module.supportsStudioCoreScenePhysics2D(), false);
  assert.equal(module.supportsStudioCoreScenePhysics2DResponse(), false);
  assert.equal(module.supportsStudioCoreScenePhysics2DMotion(), true);
  assert.deepEqual(module.dispatchStudioCoreScenePhysics2DMotion(request(document())).document, document());
});

test('a native receipt cannot drop add or change motion or approve an invalid submitted motion', async () => {
  for (const mutate of [r => delete r.scenePhysics2D.document.bodies[0].characterMotion,
    r => r.scenePhysics2D.document.bodies[0].characterMotion.jumpSpeed = 0,
    r => r.scenePhysics2D.document.bodies[0].characterMotion.grounded = true,
    r => r.scenePhysics2D.document.bodies[0].collisionResponse = 'stop', r => r.scenePhysics2D.document.schemaVersion = 2]) {
    const { module } = await bridge({ mutate });
    assert.throws(() => module.dispatchStudioCoreScenePhysics2DMotion(request(document())), { errorCode: 'studio_core_unavailable' });
    assert.equal(module.getStudioCoreMetadata().ready, false);
  }
  const value = document(); value.bodies[0].characterMotion.gravity = 20001;
  const { module } = await bridge({ mutate: (r, input) => {
    for (const key of Object.keys(r)) delete r[key];
    Object.assign(r, { protocolVersion: 1, ok: true, scenePhysics2D: { document: input.document } });
  } });
  assert.throws(() => module.dispatchStudioCoreScenePhysics2DMotion(request(value)), { errorCode: 'studio_core_unavailable' });
  assert.equal(module.getStudioCoreMetadata().ready, false);
});
