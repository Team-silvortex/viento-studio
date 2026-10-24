import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { inspectScenePhysics2D } from '../../engine/scene-physics2d-core.mjs';
import { supportsStudioCoreScenePhysics2D, getStudioCoreMetadata, dispatchStudioCoreScenePhysics2D } from '../../engine/studio-core.mjs';

const id = n => `${n.toString(16).padStart(8, '0')}-1111-4111-8111-111111111111`;
const body = (n, kind = 'static') => ({ id: id(n), instanceId: id(1000 + n), kind,
  shape: { kind: 'box', size: [32, 48] }, offset: [0, 0], layer: 1, mask: 2 });
const document = () => ({ format: 'viento-scene-physics2d', schemaVersion: 1, sceneObjectId: id(900),
  bodies: [body(1), { ...body(2, 'character'), shape: { kind: 'circle', radius: 16 } }, body(3, 'sensor')] });
const request = (doc = document()) => ({ protocolVersion: 1, operation: 'scenePhysics2D.inspect', document: doc });
const bytes = await fs.readFile(new URL('../../engine/studio-core.wasm', import.meta.url));
const { instance: { exports: native } } = await WebAssembly.instantiate(bytes, {});
const encoder = new TextEncoder(), decoder = new TextDecoder('utf-8', { fatal: true });
function wasm(input) {
  const data = encoder.encode(typeof input === 'string' ? input : JSON.stringify(input));
  const at = native.viento_core_input(data.length) >>> 0;
  new Uint8Array(native.memory.buffer, at, data.length).set(data);
  const out = native.viento_core_run() >>> 0;
  return JSON.parse(decoder.decode(new Uint8Array(native.memory.buffer, out, native.viento_core_output_len())));
}
let bridgeIndex = 0;
async function bridge(mutate, version = 1) {
  const module = await import(`../../engine/studio-core.mjs?physics2d-receipt=${++bridgeIndex}`);
  const memory = new WebAssembly.Memory({ initial: 40 }), original = WebAssembly.instantiate;
  let inputLength = 0, outputLength = 0, calls = 0;
  try {
    WebAssembly.instantiate = async () => ({ instance: { exports: {
      memory, viento_core_protocol_version: () => 1,
      ...(version === null ? {} : { viento_core_scene_physics2d_version: () => version }),
      viento_core_input: length => { inputLength = length; return 8; }, viento_core_output_len: () => outputLength,
      viento_core_run: () => {
        calls++; const input = JSON.parse(decoder.decode(new Uint8Array(memory.buffer, 8, inputLength)));
        const actual = wasm(input); if (mutate) mutate(actual, input);
        const output = encoder.encode(JSON.stringify(actual)); outputLength = output.length;
        new Uint8Array(memory.buffer, 1048576, outputLength).set(output); return 1048576;
      },
    } } });
    await module.initializeStudioCore(() => new Uint8Array([1]));
  } finally { WebAssembly.instantiate = original; }
  return { module, calls: () => calls };
}

test('physics inspection uses its optional native export and preserves independent actor declarations', () => {
  assert.equal(native.viento_core_protocol_version(), 1); assert.equal(native.viento_core_scene_physics2d_version(), 1);
  assert.equal(supportsStudioCoreScenePhysics2D(), true);
  const value = document(), before = structuredClone(value), result = inspectScenePhysics2D(value);
  assert.deepEqual(result, { document: before }); assert.deepEqual(value, before);
  assert.ok(Object.isFrozen(result) && Object.isFrozen(result.document.bodies[0].shape.size));
  value.bodies[0].offset[0] = 42; assert.equal(result.document.bodies[0].offset[0], 0);
  assert.deepEqual(wasm(request(before)), { protocolVersion: 1, ok: true, scenePhysics2D: { document: before } });
});

test('all body kinds admit inclusive dimensions offsets and sixteen-bit layer masks', () => {
  for (const kind of ['static', 'character', 'sensor']) for (const shape of [
    { kind: 'box', size: [1, 8192] }, { kind: 'circle', radius: .5 }, { kind: 'circle', radius: 4096 },
  ]) {
    const value = document(); value.bodies = [{ ...body(1, kind), shape, offset: [-8192, 8192], layer: 0, mask: 65535 }];
    assert.deepEqual(inspectScenePhysics2D(value).document, value);
  }
});

test('shape dimensions masks and kinds reject unsupported physical declarations without disabling the core', () => {
  const changes = [d => d.bodies[0].shape.kind = 'rect', d => d.bodies[0].kind = 'rigid',
    d => d.bodies[0].shape.size = [0, 1], d => d.bodies[0].shape.size = [1, 8192.01],
    d => d.bodies[1].shape.radius = .49, d => d.bodies[1].shape.radius = 4096.01,
    d => d.bodies[0].offset = [0, 0, 0], d => d.bodies[0].offset = [0, 8192.01],
    d => d.bodies[0].layer = -1, d => d.bodies[0].mask = 65536, d => d.bodies[0].mask = .5,
    d => d.bodies[0].mask = '1', d => d.bodies[0].id += '\n', d => d.bodies[0].instanceId = 'ABCDEFAB-1111-4111-8111-111111111111'];
  for (const change of changes) { const value = document(); change(value); assert.throws(() => inspectScenePhysics2D(value), { errorCode: 'scene_physics2d_invalid' }); }
  assert.equal(getStudioCoreMetadata().ready, true);
});

test('exact documents bodies and shapes reject missing or extra keys', () => {
  for (const route of [[], ['bodies', 0], ['bodies', 0, 'shape'], ['bodies', 1, 'shape']]) {
    const source = document(), target = route.reduce((value, key) => value[key], source);
    for (const key of Object.keys(target)) {
      const value = structuredClone(source); delete route.reduce((value, key) => value[key], value)[key];
      assert.throws(() => inspectScenePhysics2D(value), { errorCode: 'scene_physics2d_invalid' });
    }
    target.extra = true; assert.throws(() => inspectScenePhysics2D(source), { errorCode: 'scene_physics2d_invalid' });
  }
});

test('one to 128 bodies retain order while duplicate body and instance identities fail', () => {
  const value = document(); value.bodies = Array.from({ length: 128 }, (_, n) => body(n));
  assert.deepEqual(inspectScenePhysics2D(value).document.bodies.map(row => row.id), value.bodies.map(row => row.id));
  value.bodies.push(body(128)); assert.throws(() => inspectScenePhysics2D(value), { errorCode: 'scene_physics2d_invalid' });
  value.bodies = []; assert.throws(() => inspectScenePhysics2D(value), { errorCode: 'scene_physics2d_invalid' });
  for (const key of ['id', 'instanceId']) {
    const value = document(); value.bodies[1][key] = value.bodies[0][key];
    assert.throws(() => inspectScenePhysics2D(value), { errorCode: 'scene_physics2d_invalid' });
  }
});

test('raw WASM rejects duplicate escaped keys invalid Unicode and foreign request fields', () => {
  const raw = JSON.stringify(request());
  for (const [from, to] of [['"mask":2', '"mask":1,"ma\\u0073k":2'],
    ['"schemaVersion":1', '"schemaVersion":0,"schemaVersion":1'], ['"document":', '"document":null,"document":']]) {
    assert.equal(wasm(raw.replace(from, to)).errorCode, 'studio_core_request_invalid');
  }
  for (const input of ['\ufeff' + raw, raw.replace(id(900), '\\uD800'), { ...request(), timeSeconds: 1 }]) {
    assert.equal(wasm(input).errorCode, 'studio_core_request_invalid');
  }
});

test('JS admission never invokes getters or serializers and rejects nonfinite or sparse data', () => {
  let reads = 0;
  const accessor = document(); Object.defineProperty(accessor.bodies[0], 'mask', { enumerable: true, get() { reads++; return 1; } });
  const serializer = document(); serializer.toJSON = () => { reads++; return document(); };
  const sparse = document(); delete sparse.bodies[0];
  const infinite = document(); infinite.bodies[0].offset[0] = Infinity;
  for (const value of [accessor, serializer, sparse, infinite]) assert.throws(() => inspectScenePhysics2D(value), { errorCode: 'studio_core_request_invalid' });
  assert.equal(reads, 0);
  assert.throws(() => dispatchStudioCoreScenePhysics2D({ ...request(), operation: 'sceneAudio.inspect' }), { errorCode: 'studio_core_request_invalid' });
});

test('missing or unsupported physics exports leave existing layout operations usable', async () => {
  for (const version of [null, 0, 2]) {
    const { module, calls } = await bridge(null, version);
    assert.equal(module.supportsStudioCoreScenePhysics2D(), false);
    assert.throws(() => module.dispatchStudioCoreScenePhysics2D(request()), { errorCode: 'studio_core_unavailable' });
    assert.equal(calls(), 0); assert.equal(module.getStudioCoreMetadata().ready, true);
    assert.deepEqual(module.dispatchStudioCore({ protocolVersion: 1, operation: 'validateBatch',
      actors: [{ objectId: 'one', position: [0, 0] }], changes: [{ objectId: 'one', position: [1, 2] }] }), [{ objectId: 'one', position: [1, 2] }]);
  }
});

test('native receipts cannot change order geometry identities masks or add runtime results', async () => {
  const mutations = [r => r.extra = true, r => r.scenePhysics2D.extra = true,
    r => r.scenePhysics2D.document.sceneObjectId = id(1), r => r.scenePhysics2D.document.bodies.reverse(),
    r => r.scenePhysics2D.document.bodies.pop(), r => r.scenePhysics2D.document.bodies[0].id = id(8),
    r => r.scenePhysics2D.document.bodies[0].instanceId = id(8), r => r.scenePhysics2D.document.bodies[0].shape.size[0] = 99,
    r => r.scenePhysics2D.document.bodies[1].shape.radius = 99, r => r.scenePhysics2D.document.bodies[0].mask = 0,
    r => r.scenePhysics2D.document.bodies[0].offset[0] = 1, r => r.scenePhysics2D.document.bodies[0].kind = 'sensor',
    r => r.scenePhysics2D.document.bodies[0].contacts = []];
  for (const mutate of mutations) {
    const { module } = await bridge(mutate);
    assert.throws(() => module.dispatchStudioCoreScenePhysics2D(request()), { errorCode: 'studio_core_unavailable' });
    assert.equal(module.getStudioCoreMetadata().ready, false);
  }
  const { module } = await bridge(); assert.deepEqual(module.dispatchStudioCoreScenePhysics2D(request()), { document: document() });
});
