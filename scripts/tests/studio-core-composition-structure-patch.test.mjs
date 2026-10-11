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
    scene: { title: 'Structure / 共有 / 配方🦊', viewport: [640, 480], background: '#112233' },
    fragments: [{ fragmentId: 'pair', groups: [{ key: 'root', name: 'Root' }, { key: 'sub', name: 'Sub', parentKey: 'root' }], actors: [
      { key: 'leader', objectId: id(1), groupKey: 'root', position: [10.125, 20.25], size: [32, 48], color: '#ffffff', speed: 150, controls: 'arrows' },
      { key: 'companion', objectId: id(1), groupKey: 'sub', position: [30.5, 40.75], useProjectionDefaults: true },
    ] }, { fragmentId: 'unused', actors: [{ key: 'dormant', objectId: id(1), position: [0, 0], useProjectionDefaults: true }], groups: [] }], placements: [
      { placementId: id(10), fragmentId: 'pair', actorIds: { leader: id(11), companion: id(12) }, groupIds: { root: id(13), sub: id(14) },
        overrides: [{ actorKey: 'companion', values: { speed: 6 } }, { actorKey: 'leader', values: { color: '#654321' } }] },
      { placementId: id(20), fragmentId: 'pair', actorIds: { leader: id(21), companion: id(22) }, groupIds: { root: id(23), sub: id(24) }, offset: [300, 80],
        overrides: [{ actorKey: 'leader', values: { position: [111, 222], speed: 18.25 } }] },
    ] };
}
const newActor = () => ({ key: 'third', objectId: id(1), groupKey: 'sub', position: [12.5, 23.75], size: [20, 30], color: '#abcdef', speed: 0, controls: 'none' });
const add = (content = recipe(), actor = newActor(), fragmentId = 'pair', instances = [{ placementId: id(10), instanceId: id(101) }, { placementId: id(20), instanceId: id(102) }]) => ({
  protocolVersion: 1, operation: 'sceneComposition.addFragmentActor', content: typeof content === 'string' ? content : serialize(content), fragmentId, actor, instances });
const remove = (content = recipe(), actorKey = 'leader', fragmentId = 'pair') => ({ protocolVersion: 1, operation: 'sceneComposition.removeFragmentActor',
  content: typeof content === 'string' ? content : serialize(content), fragmentId, actorKey });
const set = () => ({ protocolVersion: 1, operation: 'sceneComposition.patchFragmentActor', content: serialize(recipe()), fragmentId: 'pair', actorKey: 'leader', values: { speed: 10 } });
const patch = input => core.dispatchStudioCoreCompositionStructure(input);
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
    const timer = setTimeout(() => { failure = new Error('Native structure parity timed out'); child.kill('SIGKILL'); }, 30000);
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', text => { stdout += text; if (Buffer.byteLength(stdout) > 16 * 1024 * 1024) { failure = new Error('Native output budget exceeded'); child.kill('SIGKILL'); } });
    child.stderr.on('data', text => { stderr = (stderr + text).slice(-4096); }); child.stdin.on('error', error => { failure ||= error; });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', (code, signal) => { clearTimeout(timer); if (failure) return reject(failure);
      try { assert.equal(signal, null); assert.equal(code, 0, stderr); const outputs = stdout.trim().split('\n').map(JSON.parse); assert.equal(outputs.length, inputs.length); resolve(outputs); } catch (error) { reject(error); }
    }); child.stdin.end(inputs.map(input => JSON.stringify(input)).join('\n') + '\n');
  });
}
let bridgeId = 0;
async function responseBridge(response, feature = 1) {
  const module = await import(new URL(`../../engine/studio-core.mjs?composition-structure-response=${++bridgeId}`, import.meta.url));
  const memory = new WebAssembly.Memory({ initial: 40 }), instantiate = WebAssembly.instantiate; let inputLength = 0, outputLength = 0;
  try {
    WebAssembly.instantiate = async () => ({ instance: { exports: { memory, viento_core_protocol_version: () => 1,
      viento_core_scene_composition_version: () => 1, viento_core_scene_composition_patch_version: () => 1,
      viento_core_scene_composition_edit_version: () => 1, viento_core_scene_composition_positions_version: () => 1,
      viento_core_scene_composition_fragment_version: () => 1, viento_core_scene_composition_fragment_edit_version: () => 1,
      viento_core_scene_composition_placement_version: () => 1,
      ...(feature === null ? {} : { viento_core_scene_composition_structure_version: () => feature }),
      viento_core_input: length => { inputLength = length; return 16; }, viento_core_run: () => {
        const input = JSON.parse(new TextDecoder().decode(new Uint8Array(memory.buffer, 16, inputLength)));
        const value = ['sceneComposition.addFragmentActor', 'sceneComposition.removeFragmentActor'].includes(input.operation) ? response : wasm(input);
        const encoded = new TextEncoder().encode(JSON.stringify(value)); outputLength = encoded.length;
        new Uint8Array(memory.buffer, 1048576, encoded.length).set(encoded); return 1048576;
      }, viento_core_output_len: () => outputLength,
    } } }); await module.initializeStudioCore(() => new Uint8Array([1]));
  } finally { WebAssembly.instantiate = instantiate; } return module;
}

function actorLimits(expanded = false) {
  const value = recipe();
  if (expanded) {
    value.fragments.pop(); value.placements = [];
    for (let i = 0; i < 64; i++) value.placements.push({ placementId: id(1000 + i * 5), fragmentId: 'pair',
      actorIds: { leader: id(1001 + i * 5), companion: id(1002 + i * 5) }, groupIds: { root: id(1003 + i * 5), sub: id(1004 + i * 5) } });
    return add(value, newActor(), 'pair', value.placements.map((p, i) => ({ placementId: p.placementId, instanceId: id(2000 + i) })));
  }
  value.fragments[1].actors = Array.from({ length: 126 }, (_, i) => ({ key: `actor${i}`, objectId: id(1), position: [0, 0], useProjectionDefaults: true }));
  return add(value, { key: 'extra', objectId: id(1), position: [0, 0], useProjectionDefaults: true }, 'unused', []);
}

test('structure capability is optional independently of all existing actor fragment and placement interfaces', async () => {
  assert.equal(api.viento_core_scene_composition_structure_version(), 1); assert.equal(core.supportsStudioCoreCompositionStructure(), true);
  for (const feature of [null, 0, 2]) {
    const module = await responseBridge(wasm(add()), feature);
    assert.equal(module.supportsStudioCoreCompositionStructure(), false); assert.equal(module.supportsStudioCoreCompositionFragmentEdit(), true);
    assert.equal(module.supportsStudioCoreCompositionPlacement(), true); assert.equal(module.supportsStudioCoreCompositionPatch(), true);
    assert.throws(() => module.dispatchStudioCoreCompositionStructure(add()), { errorCode: 'studio_core_unavailable' });
    assert.deepEqual(module.dispatchStudioCoreCompositionFragment(set()), core.dispatchStudioCoreCompositionFragment(set())); assert.equal(module.getStudioCoreMetadata().ready, true);
  }
});

test('new and existing composition operations cannot cross independent capability domains', () => {
  for (const dispatcher of [core.dispatchStudioCoreCompositionFragment, core.dispatchStudioCoreCompositionFragmentEdit, core.dispatchStudioCoreCompositionPlacement, core.dispatchStudioCoreCompositionPatch]) {
    assert.throws(() => dispatcher(add()), { errorCode: 'studio_core_request_invalid' }); assert.throws(() => dispatcher(remove()), { errorCode: 'studio_core_request_invalid' });
  }
  assert.throws(() => patch(set()), { errorCode: 'studio_core_request_invalid' }); assert.equal(core.getStudioCoreMetadata().ready, true);
});

test('ADD changes one fragment and the exact source-ordered placement maps and reuses definition references', () => {
  const input = add(), result = patch(input), expected = recipe(); expected.fragments[0].actors.push(input.actor);
  expected.placements.forEach((p, i) => { p.actorIds.third = input.instances[i].instanceId; });
  assert.deepEqual(parse(result.afterContent), expected); assert.deepEqual(result.changedPaths, ['/fragments/0/actors/2', '/placements/0/actorIds/third', '/placements/1/actorIds/third']);
  assert.deepEqual(wasm(input).compositionPatch, result);
  const expanded = wasm({ protocolVersion: 1, operation: 'sceneComposition.expand', content: result.afterContent }).composition.scene;
  assert.deepEqual(expanded.actors[5].position, [312.5, 103.75]); assert.equal(expanded.actors[2].objectId, expanded.actors[0].objectId);
});

test('REMOVE deletes the declaration all mapped IDs and exactly each matching override while preserving groups and empty arrays', () => {
  const result = patch(remove()), expected = recipe(); expected.fragments[0].actors.shift();
  for (const p of expected.placements) { delete p.actorIds.leader; p.overrides = p.overrides.filter(o => o.actorKey !== 'leader'); }
  assert.deepEqual(parse(result.afterContent), expected); assert.deepEqual(result.changedPaths, ['/fragments/0/actors/0', '/placements/0/actorIds/leader', '/placements/0/overrides/1', '/placements/1/actorIds/leader', '/placements/1/overrides/0']);
  assert.deepEqual(parse(result.afterContent).placements[1].overrides, []); assert.deepEqual(wasm(remove()).compositionPatch, result);
});

test('unused declarations have empty identity mappings and last-actor deletion is forbidden even when unreferenced', () => {
  const actor = { key: 'second', objectId: id(1), position: [0, 0], useProjectionDefaults: true }, added = patch(add(recipe(), actor, 'unused', []));
  assert.deepEqual(added.changedPaths, ['/fragments/1/actors/1']); assert.deepEqual(parse(added.afterContent).placements, recipe().placements);
  assert.deepEqual(patch(remove(added.afterContent, 'dormant', 'unused')).changedPaths, ['/fragments/1/actors/0']);
  assert.throws(() => patch(remove(recipe(), 'dormant', 'unused')), { errorCode: 'scene_composition_invalid' });
});

test('mapping admits exactly the target placement set and rejects generated actor group placement and new-ID collisions', () => {
  const good = add();
  for (const mutate of [i => i.instances.pop(), i => i.instances.reverse(), i => i.instances.push({ placementId: id(99), instanceId: id(999) }),
    i => { i.instances[1].instanceId = i.instances[0].instanceId; }, i => { i.instances[0].extra = true; }, i => { i.instances[0].placementId = id(999); },
    ...[id(10), id(11), id(24), 'UPPER'].map(collision => i => { i.instances[0].instanceId = collision; })]) {
    const input = structuredClone(good); mutate(input); assert.throws(() => patch(input), { errorCode: 'scene_composition_invalid' }); assert.equal(core.getStudioCoreMetadata().ready, true);
  }
});

test('exact native input and complete actor schema reject malformed requests without poisoning subsequent valid calls', () => {
  const good = add();
  for (const extra of [{ values: {} }, { unknown: true }]) assert.throws(() => patch({ ...good, ...extra }), { errorCode: 'studio_core_request_invalid' });
  assert.throws(() => patch({ ...remove(), instances: [] }), { errorCode: 'studio_core_request_invalid' });
  for (const mutate of [i => { i.actor.key = 'leader'; }, i => { i.actor.groupKey = 'foreign'; }, i => { i.actor.useProjectionDefaults = true; i.actor.imageResourceId = 'bad'; },
    i => { i.actor.position = [100001, 0]; }, i => { i.actor.size = [0, 1]; }, i => { i.actor.extra = true; }, i => { delete i.actor.position; }, i => { i.fragmentId = 'missing'; }]) {
    const input = structuredClone(good); mutate(input); assert.throws(() => patch(input), { errorCode: 'scene_composition_invalid' });
  }
  let reads = 0; const input = add(); Object.defineProperty(input.actor, 'position', { enumerable: true, get() { reads++; return [1, 2]; } });
  assert.throws(() => patch(input), { errorCode: 'studio_core_request_invalid' }); assert.equal(reads, 0); assert.ok(patch(good).changedPaths.length);
});

test('CST edits retain BOM CRLF escaped local keys exponent spelling null overrides offsets and unused declarations', () => {
  const raw = serialize(recipe()).replaceAll('"leader"', '"lead\\u0065r"').replace('10.125', '1.0125e1').replace('20.25', '2.02500e1');
  for (const input of [add(raw), remove(raw, 'companion')]) {
    const result = patch(input); assert.ok(result.afterContent.startsWith('\uFEFF')); assert.ok(result.afterContent.endsWith('\r\n \t'));
    assert.ok(result.afterContent.includes('"lead\\u0065r"')); assert.ok(result.afterContent.includes('1.0125e1')); assert.ok(result.afterContent.includes('2.02500e1'));
    assert.deepEqual(parse(result.afterContent).fragments[1], recipe().fragments[1]); assert.deepEqual(parse(result.afterContent).placements[1].offset, [300, 80]);
  }
  const inherit = { ...newActor(), useProjectionDefaults: true, imageResourceId: null }, inherited = patch(add(recipe(), inherit)); assert.equal(parse(inherited.afterContent).fragments[0].actors[2].imageResourceId, null);
});

test('full source and final expansion enforce original duplicate keys offsets and declared versus expanded actor budgets', () => {
  const unsafe = { ...newActor(), position: [99701, 0] }; assert.throws(() => patch(add(recipe(), unsafe)), { errorCode: 'scene_composition_invalid' });
  assert.ok(patch(add(recipe(), { ...newActor(), position: [99700, 0] })).changedPaths.length);
  const raw = serialize(recipe()), duplicate = raw.replace('"schemaVersion": 1', '"schemaVersion": 1, "schema\\u0056ersion": 1');
  assert.throws(() => patch(remove(duplicate)), { errorCode: 'scene_composition_invalid' });
  const invalidUnused = recipe(); invalidUnused.fragments[1].actors[0].controls = 'bad'; assert.throws(() => patch(remove(invalidUnused)), { errorCode: 'scene_composition_invalid' });
  for (const input of [actorLimits(false), actorLimits(true)]) {
    assert.equal(wasm({ protocolVersion: 1, operation: 'sceneComposition.expand', content: input.content }).ok, true);
    assert.throws(() => patch(input), { errorCode: 'scene_composition_limit' });
  }
});

test('the complete UTF-8 budget rejects growing ADD but permits atomic shrinking REMOVE from exact-limit source', () => {
  const prefix = serialize(recipe()), raw = prefix + ' '.repeat(128 * 1024 - Buffer.byteLength(prefix));
  assert.throws(() => patch(add(raw)), { errorCode: 'scene_composition_limit' }); assert.ok(Buffer.byteLength(patch(remove(raw)).afterContent) < 128 * 1024);
  assert.throws(() => patch(remove(raw + ' ')), { errorCode: 'scene_composition_limit' });
});

test('forged ADD and REMOVE receipts cannot alter unrelated declarations maps overrides groups or receipt ordering', async () => {
  for (const input of [add(), remove()]) for (const corrupt of [r => { r.compositionPatch.changedPaths = []; }, r => { r.compositionPatch.changedPaths.reverse(); },
    r => { r.compositionPatch.changedPaths.push(r.compositionPatch.changedPaths[0]); }, r => { r.compositionPatch.afterContent = input.content; },
    r => { r.compositionPatch.extra = true; }, r => { r.extra = true; },
    ...[v => { v.fragments[1].actors[0].position = [1, 2]; }, v => { v.placements[0].groupIds.root = id(999); }, v => { v.placements[1].offset = [0, 0]; },
      v => { v.placements[0].overrides = []; }, v => { v.fragments[0].groups = []; }, v => { v.placements[1].actorIds.companion = id(999); }]
      .map(change => r => { const value = parse(r.compositionPatch.afterContent); change(value); r.compositionPatch.afterContent = serialize(value); }),
    r => { r.compositionPatch.afterContent = r.compositionPatch.afterContent.replace('"schemaVersion": 1', '"schemaVersion": 1, "schema\\u0056ersion": 1'); },
  ]) {
    const response = wasm(input); corrupt(response); const module = await responseBridge(response);
    assert.throws(() => module.dispatchStudioCoreCompositionStructure(input), { errorCode: 'studio_core_unavailable' }); assert.equal(module.getStudioCoreMetadata().ready, false);
  }
});

test('strict whole-recipe validation rejects semantically matching forged patches of unsafe or duplicate-key sources', async () => {
  const input = add(recipe(), { ...newActor(), position: [99701, 0] }), final = recipe(); final.fragments[0].actors.push(input.actor); final.placements.forEach((p, i) => { p.actorIds.third = input.instances[i].instanceId; });
  const module = await responseBridge({ protocolVersion: 1, ok: true, compositionPatch: { afterContent: serialize(final), changedPaths: ['/fragments/0/actors/2', '/placements/0/actorIds/third', '/placements/1/actorIds/third'] } });
  assert.throws(() => module.dispatchStudioCoreCompositionStructure(input), { errorCode: 'studio_core_unavailable' });
  const duplicate = remove(serialize(recipe()).replace('"schemaVersion": 1', '"schemaVersion": 1, "schema\\u0056ersion": 1'));
  const other = await responseBridge(wasm(remove())); assert.throws(() => other.dispatchStudioCoreCompositionStructure(duplicate), { errorCode: 'studio_core_unavailable' });
});

test('native CLI and actual WASM return identical exact byte patches paths and failures for all structural intents', { skip: !nativeAvailable }, async () => {
  const raw = serialize(recipe()).replaceAll('"leader"', '"lead\\u0065r"').replace('10.125', '1.0125e1'), added = patch(add(raw)).afterContent;
  const prefix = serialize(recipe()), budget = prefix + ' '.repeat(128 * 1024 - Buffer.byteLength(prefix));
  const unused = { key: 'second', objectId: id(1), position: [0, 0], useProjectionDefaults: true };
  const inputs = [add(), remove(), remove(recipe(), 'companion'), add(raw), remove(raw, 'companion'), remove(added, 'third'),
    add(recipe(), unused, 'unused', []), remove(recipe(), 'dormant', 'unused'), add(recipe(), { ...newActor(), position: [99701, 0] }),
    { ...add(), unknown: true }, { ...remove(), instances: [] }, add(recipe(), newActor(), 'pair', []), add(budget), remove(budget), remove(budget + ' '), actorLimits(false), actorLimits(true)];
  assert.deepEqual(await nativeSequence(inputs), inputs.map(wasm));
});
