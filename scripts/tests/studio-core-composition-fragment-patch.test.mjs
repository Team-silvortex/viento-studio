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
    scene: { title: '共有 / Shared / 配方🦊', viewport: [640, 480], background: '#112233' },
    fragments: [{ fragmentId: 'pair', groups: [], actors: [
      { key: 'leader', objectId: id(1), position: [10, 20], size: [32, 48], color: '#ffffff', speed: 150, controls: 'arrows' },
      { key: 'companion', objectId: id(1), position: [30, 40], useProjectionDefaults: true },
    ] }], placements: [
      { placementId: id(10), fragmentId: 'pair', actorIds: { leader: id(11), companion: id(12) }, groupIds: {} },
      { placementId: id(20), fragmentId: 'pair', actorIds: { leader: id(21), companion: id(22) }, groupIds: {}, offset: [300, 80],
        overrides: [{ actorKey: 'leader', values: { position: [111, 222], speed: 18.25 } }] },
    ] };
}
const request = (content = recipe(), values = { position: [12, 22], speed: 160 }, actorKey = 'leader', fragmentId = 'pair') => ({
  protocolVersion: 1, operation: 'sceneComposition.patchFragmentActor', content: typeof content === 'string' ? content : serialize(content), fragmentId, actorKey, values });
const patch = input => core.dispatchStudioCoreCompositionFragment(input);
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
    const timer = setTimeout(() => { failure = new Error('Native fragment parity timed out'); child.kill('SIGKILL'); }, 30000);
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
  const module = await import(new URL(`../../engine/studio-core.mjs?composition-fragment-response=${++bridgeId}`, import.meta.url));
  const memory = new WebAssembly.Memory({ initial: 40 }), instantiate = WebAssembly.instantiate; let inputLength = 0, outputLength = 0;
  try {
    WebAssembly.instantiate = async () => ({ instance: { exports: { memory, viento_core_protocol_version: () => 1,
      viento_core_scene_composition_version: () => 1, viento_core_scene_composition_patch_version: () => 1,
      viento_core_scene_composition_edit_version: () => 1, viento_core_scene_composition_positions_version: () => 1,
      ...(feature === null ? {} : { viento_core_scene_composition_fragment_version: () => feature }),
      viento_core_input: length => { inputLength = length; return 16; },
      viento_core_run: () => {
        const input = JSON.parse(new TextDecoder().decode(new Uint8Array(memory.buffer, 16, inputLength)));
        const value = input.operation === 'sceneComposition.patchFragmentActor' ? response : wasm(input);
        const encoded = new TextEncoder().encode(JSON.stringify(value)); outputLength = encoded.length;
        new Uint8Array(memory.buffer, 1048576, encoded.length).set(encoded); return 1048576;
      }, viento_core_output_len: () => outputLength,
    } } }); await module.initializeStudioCore(() => new Uint8Array([1]));
  } finally { WebAssembly.instantiate = instantiate; } return module;
}

test('shared fragment patches use an independent capability and remain rejected by old operation domains', async () => {
  assert.equal(api.viento_core_scene_composition_fragment_version(), 1); assert.equal(core.supportsStudioCoreCompositionFragment(), true);
  for (const feature of [null, 0, 2]) {
    const module = await responseBridge(wasm(request()), feature);
    assert.equal(module.supportsStudioCoreCompositionFragment(), false);
    assert.equal(module.supportsStudioCoreCompositionPatch(), true); assert.equal(module.supportsStudioCoreCompositionEdit(), true); assert.equal(module.supportsStudioCoreCompositionPositions(), true);
    assert.throws(() => module.dispatchStudioCoreCompositionFragment(request()), { errorCode: 'studio_core_unavailable' });
    const input = { protocolVersion: 1, operation: 'sceneComposition.patchOverrides', content: serialize(recipe()), placementId: id(20), actorKey: 'leader', values: { speed: 9 } };
    assert.deepEqual(module.dispatchStudioCoreCompositionPatch(input), core.dispatchStudioCoreCompositionPatch(input));
  }
  for (const dispatcher of [core.dispatchStudioCoreComposition, core.dispatchStudioCoreCompositionPatch, core.dispatchStudioCoreCompositionPositions]) {
    assert.throws(() => dispatcher(request()), { errorCode: 'studio_core_request_invalid' });
  }
  for (const operation of ['sceneComposition.expand', 'sceneComposition.patchOverrides', 'sceneComposition.editOverrides', 'sceneComposition.patchPositions']) {
    assert.throws(() => patch({ ...request(), operation }), { errorCode: 'studio_core_request_invalid' });
  }
});

test('shared patch changes only the exact raw actor and returns canonical six-field paths', () => {
  const input = request(recipe(), { controls: 'none', position: [12, 22], imageResourceId: id(8), speed: 160, size: [64, 96], color: '#aabbcc' });
  const result = patch(input), after = parse(result.afterContent), expected = parse(input.content);
  Object.assign(expected.fragments[0].actors[0], input.values);
  assert.deepEqual(after, expected); assert.deepEqual(result.changedPaths, ['position', 'size', 'color', 'speed', 'controls', 'imageResourceId'].map(field => `/fragments/0/actors/0/${field}`));
  assert.deepEqual(after.placements, recipe().placements); assert.deepEqual(result, wasm(input).compositionPatch);
  assert.equal(result.afterContent.startsWith('\uFEFF'), true); assert.equal(result.afterContent.endsWith('\r\n \t'), true);
});

test('missing optional declarations append once even when equal effective overrides conceal the runtime change', () => {
  const value = recipe(); value.placements[0].overrides = [{ actorKey: 'companion', values: { speed: 180, color: '#aabbcc' } }];
  value.placements[1].overrides.push({ actorKey: 'companion', values: { speed: 180, color: '#aabbcc' } });
  const input = request(value, { speed: 180, controls: 'none', color: '#aabbcc', size: [48, 64], imageResourceId: null }, 'companion');
  const result = patch(input); assert.equal(result.changedPaths.length, 5); assert.deepEqual(parse(result.afterContent).placements, value.placements);
  assert.equal(parse(result.afterContent).fragments[0].actors[1].imageResourceId, null);
  assert.equal(result.afterContent.replace(',\r\n\t\t\t\t\t"size": [48,64],\r\n\t\t\t\t\t"color": "#aabbcc",\r\n\t\t\t\t\t"speed": 180,\r\n\t\t\t\t\t"controls": "none",\r\n\t\t\t\t\t"imageResourceId": null', ''), input.content);
});

test('existing semantic noops leave every author token intact and avoid false changed receipts', () => {
  const raw = serialize(recipe()).replace('"position"', '"posit\\u0069on"').replace('10,', '1.0e1,').replace('20\r\n', '2.000e1\r\n');
  const input = request(raw, { position: [10, 20], speed: 150 });
  assert.deepEqual(patch(input), { afterContent: raw, changedPaths: [] });
  assert.equal(patch(request(raw, { position: [11, 20] })).afterContent, raw.replace('1.0e1', '11'));
});

test('unused actor templates can be patched but cannot evade strict declaration validation', () => {
  const value = recipe(), unused = structuredClone(value.fragments[0]); unused.fragmentId = 'unused'; value.fragments.push(unused);
  const input = request(value, { speed: 20 }, 'leader', 'unused'), result = patch(input);
  assert.deepEqual(result.changedPaths, ['/fragments/1/actors/0/speed']);
  const expand = content => core.dispatchStudioCoreComposition({ protocolVersion: 1, operation: 'sceneComposition.expand', content }).scene;
  assert.deepEqual(expand(input.content), expand(result.afterContent));
  assert.throws(() => patch(request(value, { size: [0, 1] }, 'leader', 'unused')), { errorCode: 'scene_composition_invalid' });
});

test('post-offset bounds reject uncovered placements and retain covered local values atomically', () => {
  const value = recipe(); value.placements[1].offset = [99900, 0]; value.placements[1].overrides[0].values.position = [0, 0];
  assert.throws(() => patch(request(value, { position: [101, 40] }, 'companion')), { errorCode: 'scene_composition_invalid' });
  const input = request(value, { position: [101, 22] }), result = patch(input);
  assert.deepEqual(parse(result.afterContent).placements, value.placements); assert.equal(core.getStudioCoreMetadata().ready, true);
});

test('final 128KiB source budget allows compensating changes but rejects final overflow', () => {
  const value = recipe(); value.fragments[0].actors[0].position = [9999, 9999]; value.fragments[0].actors[0].speed = 1;
  const prefix = serialize(value), raw = prefix + ' '.repeat(128 * 1024 - Buffer.byteLength(prefix));
  const result = patch(request(raw, { position: [1, 1], speed: 1999 })); assert.ok(Buffer.byteLength(result.afterContent) <= 128 * 1024);
  assert.throws(() => patch(request(raw, { speed: 1999 })), { errorCode: 'scene_composition_limit' });
});

test('strict set-only shape invalid scalars reset identity malformed targets and non-JSON input leave the actual core usable', () => {
  for (const values of [{}, [], { position: new Array(2) }, { size: [0, 1] }, { speed: NaN }, { speed: Infinity }, { speed: 2001 }, { controls: 'wasd' },
    { color: 'red' }, { imageResourceId: null }, { useProjectionDefaults: true }, { groupKey: 'x' }, { objectId: id(9) }, { key: 'other' }]) {
    assert.throws(() => patch(request(recipe(), values))); assert.equal(core.getStudioCoreMetadata().ready, true);
  }
  for (const alter of [r => { r.fragmentId = 'missing'; }, r => { r.actorKey = 'missing'; }, r => { r.resetFields = []; }, r => { r.extra = true; }]) {
    const input = request(); alter(input); assert.throws(() => patch(input)); assert.equal(core.getStudioCoreMetadata().ready, true);
  }
  assert.equal(patch(request()).changedPaths.length, 2);
});

test('forged receipts cannot alter siblings placement overrides identity field sets path ordering or no-op bytes', async () => {
  const input = request();
  for (const alter of [r => r.compositionPatch.changedPaths.reverse(), r => { r.compositionPatch.changedPaths = []; },
    r => { r.compositionPatch.afterContent = input.content; }, r => { r.compositionPatch.extra = true; },
    r => { const value = parse(r.compositionPatch.afterContent); value.placements[1].overrides[0].values.speed = 999; r.compositionPatch.afterContent = serialize(value); },
    r => { const value = parse(r.compositionPatch.afterContent); value.fragments[0].actors[1].position[0]++; r.compositionPatch.afterContent = serialize(value); },
    r => { const value = parse(r.compositionPatch.afterContent); value.fragments[0].actors[0].objectId = id(9); r.compositionPatch.afterContent = serialize(value); },
    r => { const value = parse(r.compositionPatch.afterContent); value.fragments[0].actors[0].color = '#112233'; r.compositionPatch.afterContent = serialize(value); }]) {
    const response = wasm(input); alter(response); const module = await responseBridge(response);
    assert.throws(() => module.dispatchStudioCoreCompositionFragment(input), { errorCode: 'studio_core_unavailable' }); assert.equal(module.getStudioCoreMetadata().ready, false);
  }
  const noop = request(recipe(), { speed: 150 }), response = wasm(noop); response.compositionPatch.afterContent += ' ';
  const module = await responseBridge(response); assert.throws(() => module.dispatchStudioCoreCompositionFragment(noop), { errorCode: 'studio_core_unavailable' });
});

test('duplicate decoded original and candidate keys fail even when a forged receipt looks semantically identical', async () => {
  const input = request(), badOriginal = { ...input, content: input.content.replace('"schemaVersion": 1', '"schemaVersion": 1, "schemaVersion": 1') };
  let response = wasm(input), module = await responseBridge(response);
  assert.throws(() => module.dispatchStudioCoreCompositionFragment(badOriginal), { errorCode: 'studio_core_unavailable' });
  response = wasm(input); response.compositionPatch.afterContent = response.compositionPatch.afterContent.replace('"schemaVersion": 1', '"schemaVersion": 1, "schemaVersion": 1');
  module = await responseBridge(response); assert.throws(() => module.dispatchStudioCoreCompositionFragment(input), { errorCode: 'studio_core_unavailable' });
});

test('fresh native and raw WASM agree for shared edits unused templates final budgets and rejection responses', { skip: !nativeAvailable && 'Fresh native core binary was not supplied.' }, async () => {
  const unused = recipe(), extra = structuredClone(unused.fragments[0]); extra.fragmentId = 'unused'; unused.fragments.push(extra);
  const bounds = recipe(); bounds.placements[1].offset = [99900, 0]; bounds.placements[1].overrides[0].values.position = [0, 0];
  const inputs = [request(), request(recipe(), { speed: 150 }), request(recipe(), { speed: 0, imageResourceId: null }, 'companion'),
    request(unused, { speed: 9 }, 'leader', 'unused'), request(bounds, { position: [101, 40] }, 'companion'),
    request(recipe(), {}), request(recipe(), { imageResourceId: null }), { ...request(), resetFields: [] }];
  assert.deepEqual(await nativeSequence(inputs), inputs.map(wasm));
});
