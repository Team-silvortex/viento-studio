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
let nativeAvailable = true;
try { await fs.access(nativePath, constants.X_OK); } catch { nativeAvailable = false; }
const id = number => `${number.toString(16).padStart(8, '0')}-1111-4111-8111-111111111111`;
const fields = ['position', 'size', 'color', 'speed', 'controls', 'imageResourceId'];
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
const request = (content, values = { speed: 9 }, extra = {}) => ({ protocolVersion: 1, operation: 'sceneComposition.patchOverrides',
  content: typeof content === 'string' ? content : serialize(content), placementId: id(20), actorKey: 'leader', values, ...extra });
const patch = input => core.dispatchStudioCoreCompositionPatch(input);
function expected(input) {
  const value = parse(input.content), placement = value.placements.find(item => item.placementId === input.placementId);
  placement.overrides ||= [];
  let local = placement.overrides.find(item => item.actorKey === input.actorKey);
  if (!local) { local = { actorKey: input.actorKey, values: {} }; placement.overrides.push(local); }
  Object.assign(local.values, input.values);
  for (const field of input.resetFields || []) delete local.values[field];
  if (!Object.keys(local.values).length) placement.overrides.splice(placement.overrides.indexOf(local), 1);
  return value;
}
async function rawWasm() {
  const { instance } = await WebAssembly.instantiate(bytes, {}), api = instance.exports;
  return input => {
    const bytes = new TextEncoder().encode(typeof input === 'string' ? input : JSON.stringify(input));
    const pointer = api.viento_core_input(bytes.length) >>> 0;
    new Uint8Array(api.memory.buffer, pointer, bytes.length).set(bytes);
    const output = api.viento_core_run() >>> 0, length = api.viento_core_output_len();
    return JSON.parse(new TextDecoder('utf8', { fatal: true }).decode(new Uint8Array(api.memory.buffer, output, length)));
  };
}
const wasm = await rawWasm();
async function nativeSequence(inputs) {
  return new Promise((resolve, reject) => {
    const child = spawn(nativePath, [], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', failure;
    const timer = setTimeout(() => { failure = new Error('Native composition patch parity timed out'); child.kill('SIGKILL'); }, 30000);
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', text => { stdout += text; if (Buffer.byteLength(stdout) > 16 * 1024 * 1024) { failure = new Error('Native output budget exceeded'); child.kill('SIGKILL'); } });
    child.stderr.on('data', text => { stderr = (stderr + text).slice(-4096); });
    child.stdin.on('error', error => { failure ||= error; });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      if (failure) return reject(failure);
      try { assert.equal(signal, null); assert.equal(code, 0, stderr); const outputs = stdout.trim().split('\n').map(JSON.parse); assert.equal(outputs.length, inputs.length); resolve(outputs); } catch (error) { reject(error); }
    });
    child.stdin.end(inputs.map(input => JSON.stringify(input)).join('\n') + '\n');
  });
}
let bridgeId = 0;
async function responseBridge(response, feature = 1, editFeature = null) {
  const module = await import(new URL(`../../engine/studio-core.mjs?composition-patch-response=${++bridgeId}`, import.meta.url));
  const memory = new WebAssembly.Memory({ initial: 40 }), instantiate = WebAssembly.instantiate;
  let inputLength = 0, outputLength = 0;
  try {
    WebAssembly.instantiate = async () => ({ instance: { exports: { memory, viento_core_protocol_version: () => 1,
      viento_core_scene_composition_version: () => 1, viento_core_scene_source_version: () => 1,
      ...(feature === null ? {} : { viento_core_scene_composition_patch_version: () => feature }),
      ...(editFeature === null ? {} : { viento_core_scene_composition_edit_version: () => editFeature }),
      viento_core_input: length => { inputLength = length; return 16; },
      viento_core_run: () => {
        const input = JSON.parse(new TextDecoder().decode(new Uint8Array(memory.buffer, 16, inputLength)));
        const value = ['sceneComposition.patchOverrides', 'sceneComposition.editOverrides'].includes(input.operation) ? response : wasm(input);
        const bytes = new TextEncoder().encode(JSON.stringify(value)); outputLength = bytes.length;
        new Uint8Array(memory.buffer, 1048576, bytes.length).set(bytes); return 1048576;
      }, viento_core_output_len: () => outputLength,
    } } });
    await module.initializeStudioCore(() => new Uint8Array([1]));
  } finally { WebAssembly.instantiate = instantiate; }
  return module;
}

test('override patch has an independent optional capability and preserves the existing protocol metadata', async () => {
  const { instance } = await WebAssembly.instantiate(bytes, {});
  assert.equal(instance.exports.viento_core_scene_composition_patch_version(), 1);
  assert.equal(instance.exports.viento_core_scene_composition_version(), 1);
  assert.equal(core.supportsStudioCoreCompositionPatch(), true);
  assert.deepEqual(core.getStudioCoreMetadata(), { protocolVersion: 1, backend: 'rust-wasm', ready: true });
  assert.equal(core.dispatchStudioCoreComposition({ protocolVersion: 1, operation: 'sceneComposition.expand', content: serialize(recipe()) }).scene.schemaVersion, 3);
});

const editRequest = (content, resetFields, values = {}, extra = {}) => request(content, values,
  { operation: 'sceneComposition.editOverrides', resetFields, ...extra });

test('optional set/reset capability is independent; older cores retain all existing patch behavior', async () => {
  const { instance } = await WebAssembly.instantiate(bytes, {});
  assert.equal(instance.exports.viento_core_scene_composition_edit_version(), 1);
  assert.equal(core.supportsStudioCoreCompositionEdit(), true);
  const input = request(recipe());
  for (const feature of [null, 0, 2]) {
    const module = await responseBridge(wasm(input), 1, feature);
    assert.equal(module.supportsStudioCoreCompositionEdit(), false);
    assert.equal(module.supportsStudioCoreCompositionPatch(), true);
    assert.throws(() => module.dispatchStudioCoreCompositionPatch(editRequest(recipe(), ['speed'])), { errorCode: 'studio_core_unavailable' });
    assert.deepEqual(module.dispatchStudioCoreCompositionPatch(input), patch(input));
    assert.equal(module.getStudioCoreMetadata().ready, true);
  }
});

test('set/reset is one exact local edit, cleans empty actor overrides and keeps null distinct from inheritance', () => {
  const value = recipe();
  value.placements[1].overrides.push({ actorKey: 'companion', values: { imageResourceId: null, speed: 10 } });
  const input = editRequest(value, ['speed', 'position']), result = patch(input);
  assert.deepEqual(result.changedPaths, ['/placements/1/overrides/0/values/position', '/placements/1/overrides/0/values/speed']);
  assert.deepEqual(parse(result.afterContent), expected(input));
  assert.deepEqual(parse(result.afterContent).placements[1].overrides, [value.placements[1].overrides[1]]);
  const resetImage = editRequest(result.afterContent, ['imageResourceId'], {}, { actorKey: 'companion' });
  const imageResult = patch(resetImage);
  assert.equal(Object.hasOwn(parse(imageResult.afterContent).placements[1].overrides[0].values, 'imageResourceId'), false);
  const mixed = editRequest(value, ['position'], { speed: 150 });
  assert.deepEqual(parse(patch(mixed).afterContent), expected(mixed));
  const missing = editRequest(value, ['color']);
  assert.deepEqual(patch(missing), { afterContent: missing.content, changedPaths: [] });
});

test('reset refuses duplicates, unknown fields and overlapping set fields without poisoning valid later edits', () => {
  for (const input of [editRequest(recipe(), []), editRequest(recipe(), ['speed', 'speed']),
    editRequest(recipe(), ['instanceId']), editRequest(recipe(), ['speed'], { speed: 9 }),
    editRequest(recipe(), ['speed'], {}, { placementId: id(99) }), editRequest(recipe(), ['speed'], {}, { extra: true })]) {
    assert.throws(() => patch(input));
    assert.equal(core.getStudioCoreMetadata().ready, true);
  }
  const input = editRequest(recipe(), ['position'], { speed: 9 });
  assert.deepEqual(parse(patch(input).afterContent), expected(input));
});

test('forged reset result cannot change another actor, reorder paths, retain removed fields or invent no-op', async () => {
  const input = editRequest(recipe(), ['speed', 'position']);
  for (const alter of [response => response.compositionPatch.changedPaths.reverse(),
    response => { response.compositionPatch.changedPaths = []; },
    response => { response.compositionPatch.afterContent = input.content; },
    response => { const value = parse(response.compositionPatch.afterContent); value.placements[0].actorIds.leader = id(99); response.compositionPatch.afterContent = serialize(value); },
    response => { const value = parse(response.compositionPatch.afterContent); value.placements[1].overrides = [{ actorKey: 'leader', values: { speed: 18.25 } }]; response.compositionPatch.afterContent = serialize(value); }]) {
    const response = wasm(input); assert.equal(response.ok, true); alter(response);
    const module = await responseBridge(response, 1, 1);
    assert.throws(() => module.dispatchStudioCoreCompositionPatch(input), { errorCode: 'studio_core_unavailable' });
    assert.equal(module.getStudioCoreMetadata().ready, false);
  }
});

test('a forged deletion cannot hide duplicate decoded keys in the original author source', async () => {
  const value = recipe(); value.placements[1].overrides[0].values = { speed: 18.25 };
  const input = editRequest(serialize(value).replace('"speed": 18.25', '"speed":9,"spe\\u0065d":18.25'), ['speed']);
  assert.equal(wasm(input).ok, false);
  value.placements[1].overrides = [];
  const response = { protocolVersion: 1, ok: true, compositionPatch: {
    afterContent: serialize(value), changedPaths: ['/placements/1/overrides/0/values/speed'],
  } };
  const module = await responseBridge(response, 1, 1);
  assert.throws(() => module.dispatchStudioCoreCompositionPatch(input), { errorCode: 'studio_core_unavailable' });
  assert.equal(module.getStudioCoreMetadata().ready, false);
});

test('native and actual WASM agree on combined set/reset, container removal and rejected inputs',
  { skip: !nativeAvailable && 'Set VIENTO_STUDIO_CORE_BIN for real native reset parity.' }, async () => {
    const inputs = [];
    for (const resetFields of [['speed'], ['position'], ['position', 'speed'], ['imageResourceId']]) {
      inputs.push(editRequest(recipe(), resetFields));
      inputs.push(editRequest(recipe(), resetFields, { color: '#334455' }));
    }
    inputs.push(editRequest(recipe(), ['speed', 'speed']), editRequest(recipe(), ['speed'], { speed: 1 }),
      editRequest(recipe(), ['speed'], {}, { placementId: id(99) }), editRequest(recipe(), []));
    assert.deepEqual(await nativeSequence(inputs), inputs.map(wasm));
  });

test('existing overrides replace only changed scalar or axis tokens and preserve all other author bytes', () => {
  const input = request(serialize(recipe()).replace('"speed": 18.25', '"spe\\u0065d": 1.825e1'));
  const before = structuredClone(input), result = patch(input);
  assert.equal(result.afterContent, input.content.replace('1.825e1', '9'));
  assert.deepEqual(result.changedPaths, ['/placements/1/overrides/0/values/speed']);
  assert.deepEqual(parse(result.afterContent), expected(input));
  assert.deepEqual(input, before);
  const position = request(JSON.stringify(recipe()).replace('[111,222]', '[1.11e2,\r\n\t 2.22e2]'), { position: [111, 250] });
  assert.equal(patch(position).afterContent, position.content.replace('2.22e2', '250'));
});

test('missing values, actor override and override array are inserted at the stable target only', () => {
  const cases = [request(recipe(), { size: [64, 80], color: '#abcdef', controls: 'none' }),
    request(recipe(), { speed: 2 }, { actorKey: 'companion' }),
    request(recipe(), { speed: 150 }, { placementId: id(10) })];
  const empty = recipe(); empty.placements[0].overrides = []; cases.push(request(empty, { speed: 2 }, { placementId: id(10) }));
  for (const input of cases) {
    const result = patch(input); assert.deepEqual(parse(result.afterContent), expected(input));
    assert.ok(result.afterContent.startsWith('\uFEFF')); assert.ok(result.afterContent.endsWith('\r\n \t'));
    assert.deepEqual(parse(result.afterContent).fragments, parse(input.content).fragments);
    assert.equal(patch({ ...input, content: result.afterContent }).afterContent, result.afterContent);
  }
  assert.equal(cases[2].values.speed, recipe().fragments[0].actors[0].speed, 'setting an inherited equivalent still adds an explicit local override');
  assert.ok(patch(cases[2]).changedPaths.length);
});

test('no-op, six-field ordering, local coordinates and explicit null retain distinct semantics', () => {
  const same = request(recipe(), { speed: 18.25, position: [111, 222] });
  assert.deepEqual(patch(same), { afterContent: same.content, changedPaths: [] });
  const input = request(recipe(), { imageResourceId: null, controls: 'none', speed: 4, color: '#aabbcc80', size: [16, 24], position: [1, 2] }, { actorKey: 'companion' });
  const result = patch(input);
  assert.deepEqual(result.changedPaths, fields.map(field => `/placements/1/overrides/1/values/${field}`));
  const expanded = core.dispatchStudioCoreComposition({ protocolVersion: 1, operation: 'sceneComposition.expand', content: result.afterContent });
  assert.deepEqual(expanded.scene.actors[3].position, [301, 82]);
  assert.equal(expanded.scene.actors[3].imageResourceId, null);
  assert.throws(() => patch(request(recipe(), { imageResourceId: null })), { errorCode: 'scene_composition_invalid' });
});

test('stable placement and local key survive source array reordering', () => {
  const value = recipe(); value.placements.reverse();
  value.placements[0].overrides.unshift({ actorKey: 'companion', values: { speed: 2 } });
  const input = request(value), result = patch(input);
  assert.deepEqual(result.changedPaths, ['/placements/0/overrides/1/values/speed']);
  assert.deepEqual(parse(result.afterContent), expected(input));
});

test('invalid source, values and targets fail atomically without poisoning the core', () => {
  const malformed = serialize(recipe()).replace('"speed": 18.25', '"speed":1,"spe\\u0065d":18.25');
  const unused = recipe(); unused.fragments.push({ fragmentId: 'unused', groups: [], actors: [{ ...unused.fragments[0].actors[0], speed: -1 }] });
  const invalid = [request('{'), request(malformed), request(unused), request(recipe(), {}), request(recipe(), []),
    request(recipe(), { objectId: id(2) }), request(recipe(), { groupKey: 'bad' }), request(recipe(), { useProjectionDefaults: true }),
    request(recipe(), { speed: -1 }), request(recipe(), { color: 'red' }), request(recipe(), { size: [0, 2] }), request(recipe(), { controls: 'wasd' }),
    request(recipe(), { position: [100000, 0] }), request(recipe(), { imageResourceId: 'missing' }),
    request(recipe(), { speed: 9 }, { placementId: id(99) }), request(recipe(), { speed: 9 }, { actorKey: 'missing' })];
  for (const input of invalid) {
    const result = wasm(input); assert.equal(result.ok, false); assert.equal(result.errorCode, 'scene_composition_invalid');
    assert.deepEqual(Object.keys(result).sort(), ['protocolVersion', 'ok', 'errorCode', 'message'].sort());
    assert.throws(() => patch(input), { errorCode: 'scene_composition_invalid' });
    assert.equal(core.getStudioCoreMetadata().ready, true);
  }
  assert.throws(() => patch(request(recipe(), { speed: 9 }, { extra: true })), { errorCode: 'studio_core_request_invalid' });
  assert.equal(patch(request(recipe())).changedPaths.length, 1);
});

test('raw source and after-content budgets use UTF-8 bytes and preserve exact-limit no-ops', () => {
  const content = serialize(recipe()), full = content + ' '.repeat(128 * 1024 - Buffer.byteLength(content));
  assert.deepEqual(patch(request(full, { speed: 18.25 })), { afterContent: full, changedPaths: [] });
  assert.throws(() => patch(request(full + ' ')), { errorCode: 'scene_composition_limit' });
  assert.throws(() => patch(request(full, { color: '#aabbcc' })), { errorCode: 'scene_composition_limit' });
  const multibyte = content + '界'.repeat(Math.floor((128 * 1024 - Buffer.byteLength(content)) / 3) + 1);
  assert.ok(multibyte.length < 128 * 1024);
  assert.throws(() => patch(request(multibyte)), { errorCode: 'scene_composition_limit' });
});

test('patching is stateless even when all layout draft slots are occupied', () => {
  const handles = [];
  try {
    for (let index = 0; index < 32; index++) handles.push(core.dispatchStudioCoreDraft({ protocolVersion: 1, operation: 'layoutDraft.create', actors: [{ objectId: `actor-${index}`, position: [index, 0] }] }));
    assert.deepEqual(patch(request(recipe())).changedPaths, ['/placements/1/overrides/0/values/speed']);
    for (const before of handles) {
      const after = core.dispatchStudioCoreDraft({ protocolVersion: 1, operation: 'layoutDraft.read', draftId: before.draftId });
      assert.deepEqual(after.positions, before.positions); assert.deepEqual(after.state, before.state);
    }
  } finally { for (const { draftId } of handles) core.dispatchStudioCoreDraft({ protocolVersion: 1, operation: 'layoutDraft.close', draftId }); }
});

test('native and actual WASM agree on lossless patches, no-ops and all refusal paths', { skip: !nativeAvailable && 'Set VIENTO_STUDIO_CORE_BIN for real native patch parity.' }, async () => {
  const inputs = [];
  for (let index = 0; index < 48; index++) {
    const value = recipe(); if (index % 2) value.placements.reverse();
    inputs.push(request(index % 3 ? serialize(value) : JSON.stringify(value), {
      position: [index / 7, -index * 3], speed: index * 17.75, color: `#${(index * 997).toString(16).padStart(6, '0')}`,
    }, { placementId: id(index % 4 ? 20 : 10), actorKey: index % 3 ? 'leader' : 'companion' }));
  }
  inputs.push(request(recipe(), { speed: 18.25 }), request(recipe(), {}), request(recipe(), { speed: -1 }), request('{'),
    request(recipe(), { position: [100000, 0] }), request(recipe(), { imageResourceId: null }), request(recipe(), { speed: 9 }, { placementId: id(99) }));
  assert.deepEqual(await nativeSequence(inputs), inputs.map(wasm));
});

test('missing patch capability leaves expansion, source inspection and geometry available', async () => {
  for (const feature of [null, 0, 2]) {
    const module = await responseBridge(null, feature);
    assert.equal(module.supportsStudioCoreCompositionPatch(), false);
    assert.throws(() => module.dispatchStudioCoreCompositionPatch(request(recipe())), { errorCode: 'studio_core_unavailable' });
    assert.equal(module.getStudioCoreMetadata().ready, true);
    const expanded = module.dispatchStudioCoreComposition({ protocolVersion: 1, operation: 'sceneComposition.expand', content: serialize(recipe()) });
    assert.equal(expanded.scene.actors.length, 4);
    assert.deepEqual(module.dispatchStudioCoreSource({ protocolVersion: 1, operation: 'sceneSource.inspect', content: JSON.stringify(expanded.scene) }), { schemaVersion: 3, actorCount: 4 });
    assert.deepEqual(module.dispatchStudioCore({ protocolVersion: 1, operation: 'validateBatch', actors: [], changes: [] }), []);
  }
});

test('cross-domain or accessor requests are rejected before getters run or the runtime changes', () => {
  let calls = 0;
  const getter = request(recipe()); Object.defineProperty(getter.values, 'speed', { enumerable: true, get() { calls++; return 9; } });
  const operation = request(recipe()); Object.defineProperty(operation, 'operation', { enumerable: true, get() { calls++; return 'sceneComposition.patchOverrides'; } });
  for (const input of [getter, operation, request(recipe(), { speed: NaN }), request(recipe(), { speed: undefined }),
    { protocolVersion: 1, operation: 'sceneComposition.expand', content: serialize(recipe()) }]) {
    assert.throws(() => patch(input), { errorCode: 'studio_core_request_invalid' });
  }
  assert.equal(calls, 0); assert.equal(core.getStudioCoreMetadata().ready, true);
});

test('malformed or misdirected receipts disable the runtime instead of accepting unrelated edits', async () => {
  const input = request(recipe(), { position: [4, 5], speed: 9 }), good = { protocolVersion: 1, ok: true, compositionPatch: patch(input) };
  const changes = [
    value => { value.source = {}; }, value => { value.compositionPatch.extra = true; },
    value => { value.compositionPatch.afterContent = null; }, value => { value.compositionPatch.afterContent = '{'; },
    value => { value.compositionPatch.afterContent = '界'.repeat(43691); },
    value => { value.compositionPatch.changedPaths.reverse(); }, value => { value.compositionPatch.changedPaths.push(value.compositionPatch.changedPaths[0]); },
    value => { value.compositionPatch.changedPaths[0] = '/placements/0/overrides/0/values/position'; },
    value => { value.compositionPatch.changedPaths[0] = '/placements/1/overrides/1/values/position'; },
    value => { value.compositionPatch.changedPaths[0] = '/placements/1/overrides/0/values/position/0'; },
    value => { value.compositionPatch.changedPaths = []; }, value => { value.compositionPatch.afterContent = input.content; },
    value => { const after = parse(value.compositionPatch.afterContent); after.scene.title = 'Unexpected'; value.compositionPatch.afterContent = serialize(after); },
    value => { const after = parse(value.compositionPatch.afterContent); after.fragments[0].actors[0].speed = 9; value.compositionPatch.afterContent = serialize(after); },
    value => { const after = parse(value.compositionPatch.afterContent); after.placements[1].actorIds.leader = id(99); value.compositionPatch.afterContent = serialize(after); },
    value => { const after = parse(value.compositionPatch.afterContent); after.placements[1].overrides[0].values.speed = 8; value.compositionPatch.afterContent = serialize(after); },
    value => { value.compositionPatch.afterContent = value.compositionPatch.afterContent.replace('"speed": 9', '"speed":0,"spe\\u0065d":9'); },
  ];
  for (const change of changes) {
    const response = structuredClone(good); change(response); const module = await responseBridge(response);
    assert.throws(() => module.dispatchStudioCoreCompositionPatch(input), { errorCode: 'studio_core_unavailable' });
    assert.equal(module.getStudioCoreMetadata().ready, false);
  }
  const module = await responseBridge(good);
  assert.deepEqual(module.dispatchStudioCoreCompositionPatch(input), good.compositionPatch);
});
