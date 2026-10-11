import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as core from '../../engine/studio-core.mjs';

const bytes = await fs.readFile(new URL('../../engine/studio-core.wasm', import.meta.url));
const nativePath = process.env.VIENTO_STUDIO_CORE_BIN || fileURLToPath(new URL('../../crates/viento-studio-core/target/debug/viento-core', import.meta.url));
let nativeAvailable = true; try { await fs.access(nativePath, constants.X_OK); } catch { nativeAvailable = false; }
const id = n => `${n.toString(16).padStart(8, '0')}-1111-4111-8111-111111111111`;
const serialize = value => '\uFEFF' + JSON.stringify(value, null, '\t').replaceAll('\n', '\r\n') + '\r\n \t';
const parse = content => JSON.parse(content.replace(/^\uFEFF/, ''));
function recipe() {
  return { format: 'viento-scene-composition', schemaVersion: 1,
    scene: { title: '配方🦊 / レシピ', viewport: [640, 480], background: '#112233' },
    fragments: [{ fragmentId: 'pair', groups: [], actors: [
      { key: 'leader', objectId: id(1), position: [10, 20], size: [32, 48], color: '#ffffff', speed: 150, controls: 'arrows' },
      { key: 'companion', objectId: id(1), position: [30, 40], useProjectionDefaults: true },
    ] }], placements: [
      { placementId: id(10), fragmentId: 'pair', actorIds: { leader: id(11), companion: id(12) }, groupIds: {} },
      { placementId: id(20), fragmentId: 'pair', actorIds: { leader: id(21), companion: id(22) }, groupIds: {}, offset: [300, 80],
        overrides: [{ actorKey: 'leader', values: { position: [111, 222], speed: 18.25 } }] },
    ] };
}
const change = (placement, actorKey, position) => ({ placementId: id(placement), actorKey, position });
const request = (content = recipe(), changes = [change(10, 'leader', [12, 22]), change(10, 'companion', [32, 42])]) => ({
  protocolVersion: 1, operation: 'sceneComposition.patchPositions', content: typeof content === 'string' ? content : serialize(content), changes });
const patch = input => core.dispatchStudioCoreCompositionPositions(input);
const { instance } = await WebAssembly.instantiate(bytes, {}), api = instance.exports;
function wasm(input) {
  const encoded = new TextEncoder().encode(typeof input === 'string' ? input : JSON.stringify(input)), pointer = api.viento_core_input(encoded.length) >>> 0;
  new Uint8Array(api.memory.buffer, pointer, encoded.length).set(encoded);
  const output = api.viento_core_run() >>> 0, length = api.viento_core_output_len();
  return JSON.parse(new TextDecoder('utf8', { fatal: true }).decode(new Uint8Array(api.memory.buffer, output, length)));
}
async function nativeSequence(inputs) {
  return new Promise((resolve, reject) => {
    const child = spawn(nativePath, [], { stdio: ['pipe', 'pipe', 'pipe'] }); let stdout = '', stderr = '', failure;
    const timer = setTimeout(() => { failure = new Error('Native batch parity timed out'); child.kill('SIGKILL'); }, 30000);
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', text => { stdout += text; if (Buffer.byteLength(stdout) > 16 * 1024 * 1024) { failure = new Error('Native output budget exceeded'); child.kill('SIGKILL'); } });
    child.stderr.on('data', text => { stderr = (stderr + text).slice(-4096); });
    child.stdin.on('error', error => { failure ||= error; });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', (code, signal) => {
      clearTimeout(timer); if (failure) return reject(failure);
      try { assert.equal(signal, null); assert.equal(code, 0, stderr); const outputs = stdout.trim().split('\n').map(JSON.parse); assert.equal(outputs.length, inputs.length); resolve(outputs); } catch (error) { reject(error); }
    });
    child.stdin.end(inputs.map(input => JSON.stringify(input)).join('\n') + '\n');
  });
}
let bridgeId = 0;
async function responseBridge(response, feature = 1) {
  const module = await import(new URL(`../../engine/studio-core.mjs?composition-positions-response=${++bridgeId}`, import.meta.url));
  const memory = new WebAssembly.Memory({ initial: 40 }), instantiate = WebAssembly.instantiate; let inputLength = 0, outputLength = 0;
  try {
    WebAssembly.instantiate = async () => ({ instance: { exports: { memory, viento_core_protocol_version: () => 1,
      viento_core_scene_composition_version: () => 1, viento_core_scene_composition_patch_version: () => 1,
      viento_core_scene_composition_edit_version: () => 1,
      ...(feature === null ? {} : { viento_core_scene_composition_positions_version: () => feature }),
      viento_core_input: length => { inputLength = length; return 16; },
      viento_core_run: () => {
        const input = JSON.parse(new TextDecoder().decode(new Uint8Array(memory.buffer, 16, inputLength)));
        const value = input.operation === 'sceneComposition.patchPositions' ? response : wasm(input);
        const encoded = new TextEncoder().encode(JSON.stringify(value)); outputLength = encoded.length;
        new Uint8Array(memory.buffer, 1048576, encoded.length).set(encoded); return 1048576;
      }, viento_core_output_len: () => outputLength,
    } } }); await module.initializeStudioCore(() => new Uint8Array([1]));
  } finally { WebAssembly.instantiate = instantiate; } return module;
}

test('position-only batches have an independent optional capability and preserve old set/reset interfaces', async () => {
  assert.equal(api.viento_core_scene_composition_positions_version(), 1); assert.equal(core.supportsStudioCoreCompositionPositions(), true);
  assert.deepEqual(core.getStudioCoreMetadata(), { protocolVersion: 1, backend: 'rust-wasm', ready: true });
  for (const feature of [null, 0, 2]) {
    const module = await responseBridge(wasm(request()), feature);
    assert.equal(module.supportsStudioCoreCompositionPositions(), false);
    assert.equal(module.supportsStudioCoreCompositionPatch(), true); assert.equal(module.supportsStudioCoreCompositionEdit(), true);
    assert.throws(() => module.dispatchStudioCoreCompositionPositions(request()), { errorCode: 'studio_core_unavailable' });
    for (const operation of ['sceneComposition.patchOverrides', 'sceneComposition.editOverrides']) {
      const input = { protocolVersion: 1, operation, content: serialize(recipe()), placementId: id(20), actorKey: 'leader', values: { speed: 9 },
        ...(operation.endsWith('editOverrides') ? { resetFields: ['position'] } : {}) };
      assert.deepEqual(module.dispatchStudioCoreCompositionPatch(input), core.dispatchStudioCoreCompositionPatch(input));
    }
  }
  assert.throws(() => core.dispatchStudioCoreCompositionPatch(request()), { errorCode: 'studio_core_request_invalid' });
});

test('merged batch patches append two targets once and keep every unrelated author value', () => {
  for (const empty of [false, true]) {
    const value = recipe(); if (empty) value.placements[0].overrides = [];
    const input = request(value, [change(20, 'companion', [50, 60]), change(10, 'companion', [32, 42]), change(20, 'leader', [112, 222]), change(10, 'leader', [12, 22])]);
    const result = patch(input), after = parse(result.afterContent);
    assert.deepEqual(result.changedPaths, ['/placements/0/overrides/0/values/position', '/placements/0/overrides/1/values/position', '/placements/1/overrides/0/values/position', '/placements/1/overrides/1/values/position']);
    assert.deepEqual(after.placements[0].overrides.map(o => o.actorKey), ['leader', 'companion']);
    assert.equal(after.placements[1].overrides[0].values.speed, 18.25); assert.deepEqual(after.fragments, value.fragments);
    assert.deepEqual(after.placements.map(p => p.actorIds), value.placements.map(p => p.actorIds));
    assert.equal(result.afterContent.startsWith('\uFEFF'), true); assert.equal(result.afterContent.endsWith('\r\n \t'), true);
    assert.deepEqual(result, wasm(input).compositionPatch);
  }
});

test('no-op position batches preserve inherited bytes and do not append empty overrides', () => {
  const input = request(recipe(), [change(10, 'leader', [10, 20]), change(10, 'companion', [30, 40]), change(20, 'leader', [111, 222])]);
  assert.deepEqual(patch(input), { afterContent: input.content, changedPaths: [] });
});

test('numeric token replacement preserves escaped field names and untouched fractional axes', () => {
  const raw = serialize(recipe()).replace('111,', '1.11e2,').replace('222', '2.220e2').replace('"position"', '"posit\\u0069on"');
  const input = request(raw, [change(20, 'leader', [112, 222])]);
  assert.equal(patch(input).afterContent, raw.replace('1.11e2', '112'));
});

test('final budget validation accepts simultaneous growth and shrinkage but refuses final overflow', () => {
  const value = recipe(); value.placements[1].overrides = [
    { actorKey: 'leader', values: { position: [1, 1], speed: 18.25 } }, { actorKey: 'companion', values: { position: [9999, 9999] } }];
  const text = serialize(value), raw = text + ' '.repeat(128 * 1024 - Buffer.byteLength(text));
  assert.equal(Buffer.byteLength(patch(request(raw, [change(20, 'leader', [9999, 9999]), change(20, 'companion', [1, 1])])).afterContent), 128 * 1024);
  assert.throws(() => patch(request(raw, [change(20, 'leader', [9999, 9999])])), { errorCode: 'scene_composition_limit' });
});

test('strict target shape duplicate targets and invalid local/world input leave the real core usable', () => {
  const good = change(10, 'leader', [12, 22]);
  for (const changes of [[], new Array(1), [good, good], [{ ...good, actorKey: 'missing' }], [{ ...good, placementId: id(99) }],
    [{ ...good, extra: true }], [{ ...good, position: [1] }], [{ ...good, position: [100001, 0] }],
    [good, change(20, 'companion', [100000, 0])], Array.from({ length: 129 }, () => good)]) {
    assert.throws(() => patch(request(recipe(), changes))); assert.equal(core.getStudioCoreMetadata().ready, true);
  }
  assert.ok(patch(request()).changedPaths.length);
});

test('128 stable instances fit one batch and the expanded actor budget remains unchanged', () => {
  const value = recipe(); value.placements = Array.from({ length: 64 }, (_, index) => ({ placementId: id(index + 100), fragmentId: 'pair',
    actorIds: { leader: id(index * 2 + 1000), companion: id(index * 2 + 1001) }, groupIds: {} }));
  const changes = value.placements.flatMap(p => [{ placementId: p.placementId, actorKey: 'leader', position: [12, 22] },
    { placementId: p.placementId, actorKey: 'companion', position: [32, 42] }]);
  const result = patch(request(value, changes)); assert.equal(result.changedPaths.length, 128);
  assert.equal(core.dispatchStudioCoreComposition({ protocolVersion: 1, operation: 'sceneComposition.expand', content: result.afterContent }).scene.actors.length, 128);
});

test('forged receipts cannot change siblings metadata paths target ordering or invent a no-op', async () => {
  const input = request();
  for (const alter of [r => r.compositionPatch.changedPaths.reverse(), r => { r.compositionPatch.changedPaths = []; },
    r => { r.compositionPatch.afterContent = input.content; }, r => { r.compositionPatch.extra = true; },
    r => { const value = parse(r.compositionPatch.afterContent); value.placements[1].overrides[0].values.speed = 999; r.compositionPatch.afterContent = serialize(value); },
    r => { const value = parse(r.compositionPatch.afterContent); value.placements[0].overrides.reverse(); r.compositionPatch.afterContent = serialize(value); }]) {
    const response = wasm(input); alter(response); const module = await responseBridge(response);
    assert.throws(() => module.dispatchStudioCoreCompositionPositions(input), { errorCode: 'studio_core_unavailable' });
    assert.equal(module.getStudioCoreMetadata().ready, false);
  }
});

test('duplicate decoded keys in original or candidate cannot pass a forged semantically-equal receipt', async () => {
  const input = request();
  const badOriginal = { ...input, content: input.content.replace('"schemaVersion": 1', '"schemaVersion": 1, "schemaVersion": 1') };
  let response = wasm(input), module = await responseBridge(response);
  assert.throws(() => module.dispatchStudioCoreCompositionPositions(badOriginal), { errorCode: 'studio_core_unavailable' });
  response = wasm(input); response.compositionPatch.afterContent = response.compositionPatch.afterContent.replace('"schemaVersion": 1', '"schemaVersion": 1, "schemaVersion": 1');
  module = await responseBridge(response); assert.throws(() => module.dispatchStudioCoreCompositionPositions(input), { errorCode: 'studio_core_unavailable' });
});

test('fresh native CLI and raw WASM return identical successful and rejected batches', { skip: !nativeAvailable && 'Fresh native core binary was not supplied.' }, async () => {
  const inputs = [request(), request(recipe(), [change(20, 'companion', [40, 50]), change(20, 'leader', [112, 222])]),
    request(recipe(), [change(10, 'leader', [10, 20])]), request(recipe(), []),
    request(recipe(), [change(10, 'leader', [12, 22]), change(20, 'companion', [100000, 0])]),
    request(recipe(), [change(10, 'leader', [12, 22]), change(10, 'leader', [13, 23])])];
  assert.deepEqual(await nativeSequence(inputs), inputs.map(wasm));
});
