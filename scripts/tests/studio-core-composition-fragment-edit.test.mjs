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
const setRequest = (content = recipe(), values = { position: [12, 22], speed: 160 }, actorKey = 'leader', fragmentId = 'pair') => ({
  protocolVersion: 1, operation: 'sceneComposition.patchFragmentActor', content: typeof content === 'string' ? content : serialize(content), fragmentId, actorKey, values });
const patch = input => core.dispatchStudioCoreCompositionFragmentEdit(input);
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
  const module = await import(new URL(`../../engine/studio-core.mjs?composition-fragment-edit-response=${++bridgeId}`, import.meta.url));
  const memory = new WebAssembly.Memory({ initial: 40 }), instantiate = WebAssembly.instantiate; let inputLength = 0, outputLength = 0;
  try {
    WebAssembly.instantiate = async () => ({ instance: { exports: { memory, viento_core_protocol_version: () => 1,
      viento_core_scene_composition_version: () => 1, viento_core_scene_composition_patch_version: () => 1,
      viento_core_scene_composition_edit_version: () => 1, viento_core_scene_composition_positions_version: () => 1,
      viento_core_scene_composition_fragment_version: () => 1,
      ...(feature === null ? {} : { viento_core_scene_composition_fragment_edit_version: () => feature }),
      viento_core_input: length => { inputLength = length; return 16; },
      viento_core_run: () => {
        const input = JSON.parse(new TextDecoder().decode(new Uint8Array(memory.buffer, 16, inputLength)));
        const value = input.operation === 'sceneComposition.editFragmentActor' ? response : wasm(input);
        const encoded = new TextEncoder().encode(JSON.stringify(value)); outputLength = encoded.length;
        new Uint8Array(memory.buffer, 1048576, encoded.length).set(encoded); return 1048576;
      }, viento_core_output_len: () => outputLength,
    } } }); await module.initializeStudioCore(() => new Uint8Array([1]));
  } finally { WebAssembly.instantiate = instantiate; } return module;
}

const RESET = ['size', 'color', 'speed', 'controls', 'imageResourceId'];
function editRecipe() {
  const value = recipe(); value.fragments[0].actors[0].useProjectionDefaults = true; value.fragments[0].actors[0].imageResourceId = id(9); return value;
}
const request = (content = editRecipe(), values = {}, reset = ['speed'], actorKey = 'leader') => ({
  ...setRequest(content, values, actorKey), operation: 'sceneComposition.editFragmentActor', reset });

test('shared declaration edits have an independent optional capability and preserve every existing operation', async () => {
  assert.equal(api.viento_core_scene_composition_fragment_edit_version(), 1); assert.equal(core.supportsStudioCoreCompositionFragmentEdit(), true);
  for (const feature of [null, 0, 2]) {
    const module = await responseBridge(wasm(request()), feature);
    assert.equal(module.supportsStudioCoreCompositionFragmentEdit(), false); assert.equal(module.supportsStudioCoreCompositionFragment(), true);
    assert.equal(module.supportsStudioCoreCompositionPatch(), true); assert.equal(module.supportsStudioCoreCompositionPositions(), true);
    assert.throws(() => module.dispatchStudioCoreCompositionFragmentEdit(request()), { errorCode: 'studio_core_unavailable' });
    const old = setRequest(); assert.deepEqual(module.dispatchStudioCoreCompositionFragment(old), core.dispatchStudioCoreCompositionFragment(old));
    assert.equal(module.getStudioCoreMetadata().ready, true);
  }
  assert.throws(() => core.dispatchStudioCoreCompositionFragment(request()), { errorCode: 'studio_core_request_invalid' });
  assert.throws(() => core.dispatchStudioCoreCompositionFragmentEdit(setRequest()), { errorCode: 'studio_core_request_invalid' });
});

test('all 31 reset subsets keep mandatory fields flags placements and fixed field-order receipts', () => {
  const value = editRecipe();
  for (let bits = 1; bits < 32; bits++) {
    const reset = RESET.filter((_, index) => bits & (1 << index)), input = request(value, {}, [...reset].reverse()), result = patch(input);
    const expected = structuredClone(value); for (const field of reset) delete expected.fragments[0].actors[0][field];
    assert.deepEqual(parse(result.afterContent), expected); assert.deepEqual(result.changedPaths, reset.map(field => `/fragments/0/actors/0/${field}`));
    assert.equal(result.afterContent.startsWith('\uFEFF'), true); assert.equal(result.afterContent.endsWith('\r\n \t'), true);
  }
});

test('image deletion without projection defaults leaves no image and cannot implicitly toggle inheritance', () => {
  for (const flag of [undefined, false]) {
    const value = editRecipe(), actor = value.fragments[0].actors[0];
    if (flag === undefined) delete actor.useProjectionDefaults; else actor.useProjectionDefaults = flag;
    const result = patch(request(value, {}, ['imageResourceId'])), after = parse(result.afterContent);
    assert.equal(Object.hasOwn(after.fragments[0].actors[0], 'imageResourceId'), false); assert.equal(after.fragments[0].actors[0].useProjectionDefaults, flag);
    for (const field of RESET.slice(0, 4)) assert.throws(() => patch(request(value, {}, [field])), { errorCode: 'scene_composition_invalid' });
  }
});

test('explicit null remains distinct from restoring projection image inheritance', () => {
  const before = request(editRecipe(), { imageResourceId: null }, []), suppressed = patch(before);
  const restored = patch(request(suppressed.afterContent, {}, ['imageResourceId']));
  assert.equal(parse(suppressed.afterContent).fragments[0].actors[0].imageResourceId, null);
  assert.equal(Object.hasOwn(parse(restored.afterContent).fragments[0].actors[0], 'imageResourceId'), false);
  assert.deepEqual(parse(restored.afterContent).placements, editRecipe().placements);
});

test('mixed SET/RESET changes one declaration atomically and retains semantically unchanged numeric tokens', () => {
  const raw = serialize(editRecipe()).replace('150', '1.500e2').replace('"position"', '"posit\\u0069on"');
  const input = request(raw, { speed: 150, position: [11, 20] }, ['color', 'controls']), result = patch(input), after = parse(result.afterContent);
  assert.ok(result.afterContent.includes('1.500e2')); assert.ok(result.afterContent.includes('"posit\\u0069on"'));
  assert.deepEqual(result.changedPaths, ['/fragments/0/actors/0/position', '/fragments/0/actors/0/color', '/fragments/0/actors/0/controls']);
  assert.deepEqual(after.placements, editRecipe().placements); assert.equal(after.fragments[0].actors[0].speed, 150);
  assert.deepEqual(result, wasm(input).compositionPatch);
});

test('missing fields reset as byte-identical noops and never remove the actor container', () => {
  const value = editRecipe(); delete value.fragments[0].actors[0].speed; delete value.fragments[0].actors[0].color;
  const input = request(value, {}, ['speed', 'color']); assert.deepEqual(patch(input), { afterContent: input.content, changedPaths: [] });
  const mixed = patch(request(value, { controls: 'none' }, ['speed']));
  assert.deepEqual(mixed.changedPaths, ['/fragments/0/actors/0/controls']); assert.equal(parse(mixed.afterContent).fragments[0].actors.length, 2);
});

test('final output budget accepts growth paid by a deletion and refuses oversized input or final output', () => {
  const prefix = serialize(editRecipe()), content = prefix + ' '.repeat(128 * 1024 - Buffer.byteLength(prefix));
  const result = patch(request(content, { position: [9999, 9999] }, ['imageResourceId'])); assert.ok(Buffer.byteLength(result.afterContent) <= 128 * 1024);
  assert.throws(() => patch(request(content, { position: [9999, 9999] }, [])), { errorCode: 'scene_composition_limit' });
  assert.throws(() => patch(request(content + ' ', {}, ['imageResourceId'])), { errorCode: 'scene_composition_limit' });
});

test('duplicate forbidden overlapping malformed and sparse reset intent rejects without poisoning valid later edits', () => {
  for (const reset of [null, ['speed', 'speed'], ['position'], ['key'], ['groupKey'], ['useProjectionDefaults'], [1], new Array(1), ['speed']]) {
    assert.throws(() => patch(request(editRecipe(), { speed: 160 }, reset))); assert.equal(core.getStudioCoreMetadata().ready, true);
  }
  for (const extra of [{ resetFields: [] }, { unknown: true }]) assert.throws(() => patch({ ...request(), ...extra }));
  assert.throws(() => patch(request(editRecipe(), {}, []))); assert.ok(patch(request()).changedPaths.length);
  let reads = 0; const input = request(); Object.defineProperty(input.reset, '0', { enumerable: true, get() { reads++; return 'speed'; } });
  assert.throws(() => patch(input), { errorCode: 'studio_core_request_invalid' }); assert.equal(reads, 0);
});

test('forged edit receipts cannot retain a reset field remove identities alter local overrides or reorder changed paths', async () => {
  const input = request(editRecipe(), { position: [12, 22] }, ['speed', 'color']);
  for (const alter of [r => r.compositionPatch.changedPaths.reverse(), r => { r.compositionPatch.changedPaths = []; },
    r => { r.compositionPatch.afterContent = input.content; }, r => { r.compositionPatch.extra = true; },
    r => { const value = parse(r.compositionPatch.afterContent); value.fragments[0].actors[0].speed = 150; r.compositionPatch.afterContent = serialize(value); },
    r => { const value = parse(r.compositionPatch.afterContent); delete value.fragments[0].actors[0].objectId; r.compositionPatch.afterContent = serialize(value); },
    r => { const value = parse(r.compositionPatch.afterContent); value.fragments[0].actors[0].useProjectionDefaults = false; r.compositionPatch.afterContent = serialize(value); },
    r => { const value = parse(r.compositionPatch.afterContent); value.placements[1].overrides[0].values.speed = 999; r.compositionPatch.afterContent = serialize(value); }]) {
    const response = wasm(input); assert.equal(response.ok, true); alter(response); const module = await responseBridge(response);
    assert.throws(() => module.dispatchStudioCoreCompositionFragmentEdit(input), { errorCode: 'studio_core_unavailable' }); assert.equal(module.getStudioCoreMetadata().ready, false);
  }
});

test('a forged deletion cannot conceal duplicate decoded source keys in the original or final recipe', async () => {
  const input = request(), response = wasm(input);
  const duplicate = { ...input, content: input.content.replace('"speed": 150', '"speed":150,"spe\\u0065d":150') };
  assert.notEqual(duplicate.content, input.content);
  let module = await responseBridge(response); assert.throws(() => module.dispatchStudioCoreCompositionFragmentEdit(duplicate), { errorCode: 'studio_core_unavailable' });
  const badCandidate = structuredClone(response); badCandidate.compositionPatch.afterContent = badCandidate.compositionPatch.afterContent.replace('"schemaVersion": 1', '"schemaVersion":1,"schemaVersion":1');
  module = await responseBridge(badCandidate); assert.throws(() => module.dispatchStudioCoreCompositionFragmentEdit(input), { errorCode: 'studio_core_unavailable' });
});

test('fresh native CLI and raw WASM agree on mixed edits resets noops and all refusal paths', { skip: !nativeAvailable && 'Fresh native core binary was not supplied.' }, async () => {
  const missing = editRecipe(); delete missing.fragments[0].actors[0].speed;
  const inputs = [request(), request(editRecipe(), { position: [12, 22] }, ['color', 'speed']), request(missing),
    request(editRecipe(), {}, RESET), request(editRecipe(), {}, ['position']), request(editRecipe(), { speed: 150 }, ['speed']),
    request(recipe(), {}, ['speed']), { ...request(), actorKey: 'missing' }, request(editRecipe(), { size: [0, 1] }, ['color'])];
  assert.deepEqual(await nativeSequence(inputs), inputs.map(wasm));
});
