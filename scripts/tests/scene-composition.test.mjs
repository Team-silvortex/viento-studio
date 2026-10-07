// Composition is an explicit, stateless authoring step. These tests register only
// its baked scene in disposable copies; recipes and provenance remain separate.
import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import yauzl from 'yauzl';
import * as core from '../../engine/studio-core.mjs';
import { expandSceneComposition } from '../../engine/scene-composition.mjs';
import { runSceneComposeCommand } from '../scene-compose.mjs';
import { resolveScene2DModel } from '../../engine/scene-model.mjs';
import { createScene2DPlan } from '../../engine/build-plan.mjs';
import { createWorldCommandService } from '../adapters/node-world-commands.mjs';
import { readWorldProjection, readWorldSnapshot } from '../adapters/node-world-projection.mjs';
import { registerWorkspace } from '../lib/workspace.mjs';
import { readPackageCatalog } from '../lib/resource-package-catalog.mjs';
import { planExport, writeExportZip } from '../lib/export-package.mjs';
import { unpackResourcePackage } from '../lib/resource-package-reader.mjs';
import { planPackageImport } from '../lib/resource-package-import.mjs';
import { applyPackageImport } from '../lib/resource-package-transaction.mjs';
import { buildProject, runProjectBuild } from '../adapters/node-project-build.mjs';
import { captureBuildSnapshot } from '../adapters/node-build-snapshot.mjs';

const exampleUrl = new URL('../../examples/scene-composition/recipe.json', import.meta.url);
const exampleContent = await fs.readFile(exampleUrl, 'utf8'), example = JSON.parse(exampleContent);
const wasmBytes = await fs.readFile(new URL('../../engine/studio-core.wasm', import.meta.url));
const nativePath = process.env.VIENTO_STUDIO_CORE_BIN || fileURLToPath(new URL(`../../crates/viento-studio-core/target/debug/viento-core${process.platform === 'win32' ? '.exe' : ''}`, import.meta.url));
let nativeAvailable = true;
try { await fs.access(nativePath, fsConstants.X_OK); } catch { nativeAvailable = false; }
const nativeSkip = nativeAvailable ? false : 'Set VIENTO_STUDIO_CORE_BIN for native/WASM composition parity.';
const godot = process.env.VIENTO_GODOT_BIN, run = promisify(execFile);
const json = value => JSON.stringify(value, null, 2) + '\n';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const uuid = n => `${n.toString(16).padStart(8, '0')}-1111-4111-8111-111111111111`;
const actorId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', imageId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const request = content => ({ protocolVersion: 1, operation: 'sceneComposition.expand', content: typeof content === 'string' ? content : JSON.stringify(content) });
const expand = value => expandSceneComposition(typeof value === 'string' ? value : JSON.stringify(value));
function minimal() {
  return { format: 'viento-scene-composition', schemaVersion: 1, scene: { title: 'Test', viewport: [640, 480], background: '#101827' },
    fragments: [{ fragmentId: 'pair', actors: [{ key: 'actor', objectId: actorId, position: [0, 0], size: [64, 64], color: '#ffffff', speed: 0, controls: 'none' }], groups: [] }],
    placements: [{ placementId: uuid(100), fragmentId: 'pair', actorIds: { actor: uuid(200) }, groupIds: {} }] };
}
async function rawWasm() {
  const { instance } = await WebAssembly.instantiate(wasmBytes, {}), api = instance.exports;
  return input => {
    const bytes = new TextEncoder().encode(typeof input === 'string' ? input : JSON.stringify(input));
    const pointer = api.viento_core_input(bytes.length) >>> 0;
    assert.ok(pointer && pointer + bytes.length <= api.memory.buffer.byteLength);
    new Uint8Array(api.memory.buffer, pointer, bytes.length).set(bytes);
    const output = api.viento_core_run() >>> 0, length = api.viento_core_output_len();
    assert.ok(output && length > 0 && length <= 1024 * 1024 && output + length <= api.memory.buffer.byteLength);
    return JSON.parse(new TextDecoder('utf8', { fatal: true }).decode(new Uint8Array(api.memory.buffer, output, length)));
  };
}
async function nativeSequence(inputs) {
  return new Promise((resolve, reject) => {
    const child = spawn(nativePath, [], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', failure;
    const timer = setTimeout(() => { failure = new Error('Native composition parity timed out.'); child.kill('SIGKILL'); }, 30000);
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { stdout += chunk; if (Buffer.byteLength(stdout) > 16 * 1024 * 1024) { failure = new Error('Bounded native output exceeded.'); child.kill('SIGKILL'); } });
    child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-4096); }); child.stdin.on('error', error => { failure ||= error; });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', (code, signal) => {
      clearTimeout(timer); if (failure) return reject(failure);
      try { assert.equal(signal, null); assert.equal(code, 0, stderr); const result = stdout.trim().split('\n').map(line => JSON.parse(line)); assert.equal(result.length, inputs.length); resolve(result); } catch (error) { reject(error); }
    });
    child.stdin.end(inputs.map(input => typeof input === 'string' ? input : JSON.stringify(input)).join('\n') + '\n');
  });
}
function assertRejected(result, label, expected) {
  assert.equal(result.ok, false, label); assert.equal(result.protocolVersion, 1);
  assert.ok(['scene_composition_invalid', 'scene_composition_limit'].includes(result.errorCode), `${label}: ${JSON.stringify(result)}`);
  if (expected) assert.equal(result.errorCode, expected, label);
  for (const key of ['composition', 'scene', 'sourceMap', 'draft', 'changes']) assert.equal(Object.hasOwn(result, key), false, `${label}: no partial output`);
}
function invalidCases() {
  const values = [], add = (name, mutation) => { const value = structuredClone(example); mutation(value); values.push({ name, content: JSON.stringify(value) }); };
  add('unknown root field', value => { value.hostPath = '/private/workspace'; });
  add('wrong schema', value => { value.schemaVersion = 3; });
  add('blank title', value => { value.scene.title = '\ufeff\u3000 '; });
  add('long UTF16 title', value => { value.scene.title = '😀'.repeat(81); });
  add('viewport integer', value => { value.scene.viewport[0] = 100.5; });
  add('viewport range', value => { value.scene.viewport[1] = 4097; });
  add('invalid background', value => { value.scene.background = 'transparent'; });
  add('empty fragments', value => { value.fragments = []; });
  add('duplicate fragment key', value => { value.fragments.push(structuredClone(value.fragments[0])); });
  add('unresolved fragment', value => { value.placements[1].fragmentId = 'missing'; });
  add('empty placements', value => { value.placements = []; });
  add('duplicate placement ID', value => { value.placements[1].placementId = value.placements[0].placementId; });
  add('invalid local key', value => { value.fragments[0].actors[0].key = '../actor'; });
  add('duplicate local actor key', value => { value.fragments[0].actors[1].key = 'leader'; });
  add('missing actor mapping', value => { delete value.placements[1].actorIds.companion; });
  add('extra actor mapping', value => { value.placements[1].actorIds.unknown = uuid(500); });
  add('missing group mapping', value => { delete value.placements[1].groupIds.companions; });
  add('extra group mapping', value => { value.placements[1].groupIds.unknown = uuid(500); });
  add('duplicate generated actor', value => { value.placements[1].actorIds.leader = value.placements[0].actorIds.leader; });
  add('duplicate generated group', value => { value.placements[1].groupIds.party = value.placements[0].groupIds.party; });
  add('actor group identity collision', value => { value.placements[1].groupIds.party = value.placements[0].actorIds.leader; });
  add('uppercase UUID', value => { value.placements[0].actorIds.leader = 'ABCDEFAB-1111-4111-8111-111111111111'; });
  add('null offset', value => { value.placements[1].offset = null; });
  add('overflow after offset', value => { value.placements[1].offset = [100000, 0]; });
  add('local position bounds', value => { value.fragments[0].actors[0].position = [100001, 0]; });
  add('size bounds', value => { value.fragments[0].actors[0].size = [0, 1]; });
  add('speed bounds', value => { value.fragments[0].actors[0].speed = 2001; });
  add('missing explicit fields', value => { delete value.fragments[0].actors[0].color; });
  add('unknown actor field', value => { value.fragments[0].actors[0].script = 'res://unsafe.gd'; });
  add('invalid unused fragment', value => { const unused = structuredClone(value.fragments[0]); unused.fragmentId = 'unused'; unused.actors[0].speed = -1; value.fragments.push(unused); });
  add('missing group member target', value => { value.fragments[0].actors[0].groupKey = 'missing'; });
  add('duplicate group key', value => { value.fragments[0].groups[1].key = 'party'; });
  add('group unknown field', value => { value.fragments[0].groups[0].position = [1, 2]; });
  add('group cycle', value => { value.fragments[0].groups[0].parentKey = 'companions'; });
  add('missing group parent', value => { value.fragments[0].groups[0].parentKey = 'missing'; });
  add('null group parent', value => { value.fragments[0].groups[0].parentKey = null; });
  add('group name DEL', value => { value.fragments[0].groups[0].name = '\u007f'; });
  add('empty override', value => { value.placements[1].overrides[0].values = {}; });
  add('override unknown actor', value => { value.placements[1].overrides[0].actorKey = 'unknown'; });
  add('duplicate override', value => { value.placements[1].overrides.push(value.placements[1].overrides[0]); });
  for (const key of ['objectId', 'key', 'instanceId', 'groupKey', 'groupId', 'useProjectionDefaults']) add(`override identity ${key}`, value => { value.placements[1].overrides[0].values[key] = true; });
  add('null image without inheritance', value => { value.placements[1].overrides[0].values.imageResourceId = null; });
  add('null inherited size', value => { value.fragments[0].actors[0].useProjectionDefaults = true; value.fragments[0].actors[0].size = null; });
  const valid = JSON.stringify(example);
  for (const [name, content] of [
    ['malformed JSON', '{'], ['decoded duplicate key', valid.replace('"scene":', '"sc\\u0065ne":{},"scene":')],
    ['duplicate nested actor key', valid.replace('"key":"leader"', '"key":"leader","k\\u0065y":"leader"')],
    ['unpaired escaped surrogate', valid.replace('Two parties', '\\ud800')],
    ['nonfinite source number', valid.replace('[120,180]', '[1e400,180]')], ['trailing data', valid + '{}'],
    ['BOM twice', '\ufeff\ufeff' + valid], ['depth limit', '['.repeat(66) + '0' + ']'.repeat(66)],
  ]) values.push({ name, content });
  const boundary = minimal(), raw = JSON.stringify(boundary);
  values.push({ name: 'UTF8 input limit', content: raw + ' '.repeat(131073 - Buffer.byteLength(raw)), expected: 'scene_composition_limit' });
  return values;
}
const rejected = invalidCases();

function expectedExample() {
  const scene = { format: 'viento-scene2d', schemaVersion: 3, ...structuredClone(example.scene), actors: [], groups: [] };
  // Explicit independent values; do not reconstruct the implementation's merge
  // algorithm to decide whether local override or placement offset wins.
  const positions = [[120, 180], [200, 180], [460, 220], [560, 260]];
  for (let p = 0; p < 2; p++) {
    for (let a = 0; a < 2; a++) {
      const original = example.fragments[0].actors[a], { key, groupKey, ...actor } = structuredClone(original);
      scene.actors.push({ ...actor, instanceId: example.placements[p].actorIds[key], groupId: example.placements[p].groupIds[groupKey], position: positions[p * 2 + a],
        ...(p === 1 && a === 0 ? { color: '#f1c46e', speed: 0, controls: 'none' } : {}) });
    }
    scene.groups.push({ groupId: example.placements[p].groupIds.party, name: 'Party / 队伍 / 隊' },
      { groupId: example.placements[p].groupIds.companions, name: 'Companions / 同行者', parentGroupId: example.placements[p].groupIds.party });
  }
  return scene;
}

test('composition uses standalone WASM and a separate optional feature capability', async () => {
  const module = await WebAssembly.compile(wasmBytes); assert.deepEqual(WebAssembly.Module.imports(module), []);
  const instance = await WebAssembly.instantiate(module, {}); assert.equal(instance.exports.viento_core_protocol_version(), 1);
  assert.equal(instance.exports.viento_core_scene_composition_version(), 1); await core.ensureStudioCoreReady();
});
test('two placements reuse one template, preserve explicit identities and apply local overrides before translation', () => {
  const before = hash(exampleContent), result = expand(exampleContent);
  assert.deepEqual(result.scene, expectedExample()); assert.equal(hash(exampleContent), before);
  assert.equal(result.scene.actors.length, 4); assert.equal(result.scene.groups.length, 4);
  assert.equal(Object.hasOwn(result.scene, 'sourceMap'), false); assert.equal(Object.hasOwn(result.scene, 'fragments'), false);
  result.scene.actors[0].position[0] = -100; result.sourceMap.actors[0].fields.position.push('/caller');
  assert.deepEqual(expand(exampleContent).scene, expectedExample(), 'caller mutations cannot leak into another expansion');
});
test('provenance names exact template, identity, membership and override contributors without claiming writable spans', () => {
  const { sourceMap } = expand(exampleContent);
  assert.deepEqual(Object.keys(sourceMap).sort(), ['actors', 'format', 'groups', 'schemaVersion']);
  assert.equal(sourceMap.format, 'viento-scene-composition-map'); assert.equal(sourceMap.schemaVersion, 1);
  assert.equal(sourceMap.actors.length, 4); assert.equal(sourceMap.groups.length, 4);
  assert.deepEqual(sourceMap.actors[2], { instanceId: example.placements[1].actorIds.leader, placementId: example.placements[1].placementId,
    fragmentId: 'party', localKey: 'leader', templatePath: '/fragments/0/actors/0', placementPath: '/placements/1', identityPath: '/placements/1/actorIds/leader',
    fields: { objectId: ['/fragments/0/actors/0/objectId'], groupId: ['/fragments/0/actors/0/groupKey', '/placements/1/groupIds/party'],
      position: ['/placements/1/overrides/0/values/position', '/placements/1/offset'], size: ['/fragments/0/actors/0/size'],
      color: ['/placements/1/overrides/0/values/color'], speed: ['/placements/1/overrides/0/values/speed'], controls: ['/placements/1/overrides/0/values/controls'],
      imageResourceId: ['/fragments/0/actors/0/imageResourceId'] } });
  assert.deepEqual(sourceMap.actors[0].fields.position, ['/fragments/0/actors/0/position']);
  assert.deepEqual(sourceMap.actors[3].fields.position, ['/fragments/0/actors/1/position', '/placements/1/offset']);
  assert.deepEqual(sourceMap.groups[3], { groupId: example.placements[1].groupIds.companions, placementId: example.placements[1].placementId,
    fragmentId: 'party', localKey: 'companions', templatePath: '/fragments/0/groups/1', placementPath: '/placements/1', identityPath: '/placements/1/groupIds/companions',
    fields: { name: ['/fragments/0/groups/1/name'], parentGroupId: ['/fragments/0/groups/1/parentKey', '/placements/1/groupIds/party'] } });
});
test('reordering, template renaming and unrelated definitions do not change mapped identities or effective actors', () => {
  const original = expand(example), changed = structuredClone(example);
  changed.placements.reverse(); changed.fragments[0].actors.reverse(); changed.fragments[0].groups.reverse();
  changed.fragments[0].fragmentId = 'renamed'; for (const item of changed.placements) item.fragmentId = 'renamed';
  changed.fragments.unshift({ fragmentId: 'unused', actors: [{ ...minimal().fragments[0].actors[0], key: 'unused' }], groups: [] });
  const next = expand(changed), keyed = actors => Object.fromEntries(actors.map(item => [item.instanceId || item.groupId, item]));
  assert.deepEqual(keyed(next.scene.actors), keyed(original.scene.actors)); assert.deepEqual(keyed(next.scene.groups), keyed(original.scene.groups));
  assert.deepEqual(next.scene.actors.map(item => item.instanceId), original.scene.actors.map(item => item.instanceId).reverse());
  assert.equal(next.sourceMap.actors[0].templatePath, '/fragments/1/actors/0'); assert.equal(next.sourceMap.actors[0].fragmentId, 'renamed');
});
test('inherited image absence and explicit null remain distinct; per-placement overrides do not leak', () => {
  const value = minimal(), actor = value.fragments[0].actors[0]; actor.useProjectionDefaults = true;
  for (const key of ['size', 'color', 'speed', 'controls']) delete actor[key];
  value.placements.push({ ...structuredClone(value.placements[0]), placementId: uuid(101), actorIds: { actor: uuid(201) }, overrides: [{ actorKey: 'actor', values: { imageResourceId: null } }] });
  const result = expand(value);
  assert.equal(Object.hasOwn(result.scene.actors[0], 'imageResourceId'), false); assert.equal(result.scene.actors[1].imageResourceId, null);
  assert.equal(Object.hasOwn(result.sourceMap.actors[0].fields, 'imageResourceId'), false);
  assert.deepEqual(result.sourceMap.actors[1].fields.imageResourceId, ['/placements/1/overrides/0/values/imageResourceId']);
  assert.equal(result.scene.actors[0].useProjectionDefaults, true);
  assert.equal(Object.hasOwn(result.scene.actors[0], 'size'), false);
});
test('ordinary ASCII map keys such as constructor are data and group/actor key namespaces are separate', () => {
  const value = minimal(); value.fragments[0].actors[0].key = 'constructor'; value.fragments[0].actors[0].groupKey = 'constructor';
  value.fragments[0].groups = [{ key: 'constructor', name: 'Own key' }];
  value.placements[0].actorIds = { constructor: uuid(201) }; value.placements[0].groupIds = { constructor: uuid(301) };
  assert.equal(expand(value).scene.actors[0].groupId, uuid(301));
});
test('strict recipes reject malformed keys, topology, mappings, overrides and JSON without partial results', async t => {
  const wasm = await rawWasm(); for (const item of rejected) assertRejected(wasm(request(item.content)), item.name, item.expected);
  t.diagnostic(`${rejected.length} invalid recipe cases`);
});
test('bounded declaration and expansion counts, UTF8 bytes and group depth accept the limit and reject the next', async () => {
  const wasm = await rawWasm(), value = minimal();
  value.placements = Array.from({ length: 128 }, (_, i) => ({ ...structuredClone(value.placements[0]), placementId: uuid(1000 + i), actorIds: { actor: uuid(2000 + i) } }));
  const accepted = wasm(request(value)); assert.equal(accepted.ok, true); assert.equal(accepted.composition.scene.actors.length, 128);
  value.placements.push({ ...value.placements[0], placementId: uuid(9000), actorIds: { actor: uuid(9001) } }); assertRejected(wasm(request(value)), '129 expanded actors');
  const groups = minimal(); groups.fragments[0].groups = Array.from({ length: 16 }, (_, i) => ({ key: `g${i}`, name: `Group ${i}`, ...(i ? { parentKey: `g${i - 1}` } : {}) }));
  groups.placements[0].groupIds = Object.fromEntries(groups.fragments[0].groups.map((group, i) => [group.key, uuid(3000 + i)]));
  assert.equal(wasm(request(groups)).ok, true);
  groups.fragments[0].groups.push({ key: 'g16', name: 'Too deep', parentKey: 'g15' }); groups.placements[0].groupIds.g16 = uuid(3016); assertRejected(wasm(request(groups)), '17 group depth');
  const groupBudget = minimal();
  groupBudget.fragments[0].groups = Array.from({ length: 128 }, (_, i) => ({ key: `g${i}`, name: `Group ${i}` }));
  groupBudget.placements[0].groupIds = Object.fromEntries(groupBudget.fragments[0].groups.map((group, i) => [group.key, uuid(4000 + i)]));
  assert.equal(wasm(request(groupBudget)).ok, true);
  groupBudget.fragments[0].groups.push({ key: 'g128', name: 'Overflow' }); groupBudget.placements[0].groupIds.g128 = uuid(4128);
  assertRejected(wasm(request(groupBudget)), '129 declared groups');
  const fragmentBudget = minimal();
  fragmentBudget.fragments = Array.from({ length: 32 }, (_, i) => ({ ...structuredClone(fragmentBudget.fragments[0]), fragmentId: `f${i}` }));
  fragmentBudget.placements[0].fragmentId = 'f0'; assert.equal(wasm(request(fragmentBudget)).ok, true);
  fragmentBudget.fragments.push({ ...structuredClone(fragmentBudget.fragments[0]), fragmentId: 'f32' }); assertRejected(wasm(request(fragmentBudget)), '33 fragments including unused');
  const declaredBudget = minimal();
  const template = declaredBudget.fragments[0].actors[0];
  declaredBudget.fragments[0].actors = Array.from({ length: 128 }, (_, i) => ({ ...template, key: `actor${i}` }));
  declaredBudget.placements[0].actorIds = Object.fromEntries(declaredBudget.fragments[0].actors.map((actor, i) => [actor.key, uuid(5000 + i)]));
  assert.equal(wasm(request(declaredBudget)).ok, true);
  declaredBudget.fragments.push({ fragmentId: 'unused', actors: [template], groups: [] }); assertRejected(wasm(request(declaredBudget)), '129 total declared actors including unused');
  const raw = JSON.stringify(minimal()); assert.equal(wasm(request(raw + ' '.repeat(131072 - Buffer.byteLength(raw)))).ok, true);
  const unicode = structuredClone(example); unicode.scene.title = '中'.repeat(160); const text = JSON.stringify(unicode);
  assert.equal(wasm(request(text)).ok, true);
  assertRejected(wasm(request(text + ' '.repeat(131073 - Buffer.byteLength(text)))), 'UTF8 budget', 'scene_composition_limit');
});
test('native and WASM return identical complete success and error envelopes', { skip: nativeSkip }, async t => {
  const variants = [exampleContent, JSON.stringify(minimal()), '\ufeff' + exampleContent.replaceAll('\n', '\r\n'), ...rejected.map(item => item.content)];
  const inputs = variants.map(request), wasm = await rawWasm(), native = await nativeSequence(inputs), outputs = inputs.map(wasm);
  assert.deepEqual(native, outputs); assert.equal(outputs[0].ok, true); assert.deepEqual(outputs[0].composition.scene, expectedExample());
  t.diagnostic(`${inputs.length} native/WASM samples; SHA256 ${hash(JSON.stringify({ inputs, outputs }))}`);
});
test('composition is stateless and consumes no layout draft handles', async () => {
  const wasm = await rawWasm(); for (let i = 0; i < 64; i++) assert.equal(wasm(request(exampleContent)).ok, true);
  for (let i = 0; i < 32; i++) assert.equal(wasm({ protocolVersion: 1, operation: 'layoutDraft.create', actors: [{ objectId: uuid(i + 1), position: [0, 0] }] }).ok, true);
  assert.equal(wasm({ protocolVersion: 1, operation: 'layoutDraft.create', actors: [] }).ok, false);
  assert.equal(wasm(request(exampleContent)).ok, true, 'composition also works while all draft slots are occupied');
});

let bridgeId = 0;
async function responseBridge(response, feature = 1) {
  const module = await import(new URL(`../../engine/studio-core.mjs?composition-response=${++bridgeId}`, import.meta.url));
  const memory = new WebAssembly.Memory({ initial: 32 }), encoded = new TextEncoder().encode(JSON.stringify(response)), instantiate = WebAssembly.instantiate;
  try {
    WebAssembly.instantiate = async () => ({ instance: { exports: { memory, viento_core_protocol_version: () => 1,
      ...(feature === null ? {} : { viento_core_scene_composition_version: () => feature }), viento_core_input: () => 16,
      viento_core_run: () => { new Uint8Array(memory.buffer, 1048576, encoded.length).set(encoded); return 1048576; }, viento_core_output_len: () => encoded.length,
    } } });
    await module.initializeStudioCore(() => new Uint8Array([1]));
  } finally { WebAssembly.instantiate = instantiate; }
  return module;
}
test('older or unsupported composition capabilities leave preexisting geometry operations usable', async () => {
  for (const feature of [null, 0, 2]) {
    const module = await responseBridge({ protocolVersion: 1, ok: true, changes: [] }, feature);
    assert.throws(() => module.dispatchStudioCoreComposition(request(exampleContent)), { errorCode: 'studio_core_unavailable' });
    assert.equal(module.getStudioCoreMetadata().ready, true);
    assert.deepEqual(module.dispatchStudioCore({ protocolVersion: 1, operation: 'validateBatch', actors: [], changes: [] }), []);
  }
});
test('composition rejects foreign and accessor requests without executing getters or poisoning the loaded core', async () => {
  let calls = 0; const getter = request(exampleContent);
  Object.defineProperty(getter, 'content', { enumerable: true, get() { calls++; return exampleContent; } });
  const operation = request(exampleContent); Object.defineProperty(operation, 'operation', { enumerable: true, get() { calls++; return 'sceneComposition.expand'; } });
  for (const value of [getter, operation, { ...request(exampleContent), extra: undefined }, { protocolVersion: 1, operation: 'layoutDraft.create', actors: [] }]) {
    assert.throws(() => core.dispatchStudioCoreComposition(value), { errorCode: 'studio_core_request_invalid' });
  }
  assert.equal(calls, 0); assert.equal(core.getStudioCoreMetadata().ready, true);
  assert.throws(() => expand('{'), { errorCode: 'scene_composition_invalid' });
  assert.equal(core.getStudioCoreMetadata().ready, true); assert.deepEqual(expand(exampleContent).scene, expectedExample());
});
test('bridge rejects malformed or mixed-domain scenes and provenance and disables only the bad instance', async () => {
  const good = { protocolVersion: 1, ok: true, composition: expand(exampleContent) };
  const cases = [value => { value.changes = []; }, value => { value.composition.scene.schemaVersion = 2; },
    value => { value.composition.scene.actors[1].instanceId = value.composition.scene.actors[0].instanceId; },
    value => { value.composition.scene.actors[0].position = [100001, 0]; },
    value => { delete value.composition.scene.actors[0].size; delete value.composition.sourceMap.actors[0].fields.size; },
    value => { value.composition.scene.actors[0].imageResourceId = null; },
    value => { value.composition.scene.groups[0].parentGroupId = value.composition.scene.groups[1].groupId; value.composition.sourceMap.groups[0].fields.parentGroupId = ['/fragments/0/groups/1/parentKey', '/placements/0/groupIds/companions']; },
    value => { value.composition.scene.title = 'bad\u0000title'; },
    value => { value.composition.scene.groups[0].unknown = 'field'; },
    value => { value.composition.sourceMap.actors.pop(); }, value => { value.composition.sourceMap.actors[0].instanceId = uuid(990); },
    value => { value.composition.sourceMap.actors[0].templatePath = '/private/project'; },
    value => { value.composition.sourceMap.actors[0].identityPath = '/placements/0/groupIds/party'; },
    value => { value.composition.sourceMap.actors[0].fields.position = ['/not/source']; },
    // Existing recipe pointers can still lie about field, actor, placement,
    // membership or offset ownership. These must fail just like missing paths.
    value => { value.composition.sourceMap.actors[0].fields.color = ['/placements/1/overrides/0/values/position']; },
    value => { value.composition.sourceMap.actors[0].fields.color = ['/fragments/0/actors/1/color']; },
    value => { value.composition.sourceMap.actors[0].fields.color = ['/placements/1/overrides/0/values/color']; },
    value => { value.composition.sourceMap.actors[3].fields.speed = ['/placements/1/overrides/0/values/speed']; },
    value => { value.composition.sourceMap.actors[2].fields.color = ['/fragments/0/actors/0/color']; },
    value => { value.composition.sourceMap.actors[0].fields.position.push('/placements/1/offset'); },
    value => { value.composition.sourceMap.actors[2].fields.position.pop(); },
    value => { value.composition.sourceMap.actors[0].fields.groupId[1] = '/placements/1/groupIds/party'; },
    value => { value.composition.sourceMap.actors[0].fields.groupId = ['/placements/0/groupIds/party']; },
    value => { value.composition.sourceMap.groups[0].fields.name = ['/fragments/0/groups/1/name']; },
    value => { value.composition.sourceMap.groups[1].fields.parentGroupId[1] = '/placements/1/groupIds/party'; },

    value => { value.composition.sourceMap.actors[0].fields.hostPath = ['/fragments/0/actors/0/objectId']; },
    value => { delete value.composition.sourceMap.actors[0].fields.groupId; },
    value => { value.composition.sourceMap.groups[1].fields.groupId = ['/placements/0/groupIds/companions']; }];
  for (const mutate of cases) {
    const value = structuredClone(good); mutate(value); const module = await responseBridge(value);
    assert.throws(() => module.dispatchStudioCoreComposition(request(exampleContent)), { errorCode: 'studio_core_unavailable' });
    assert.equal(module.getStudioCoreMetadata().ready, false);
  }
});

async function temporary(t, prefix = 'viento-composition-') {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix)); t.after(() => fs.rm(root, { recursive: true, force: true })); return root;
}
async function inventory(root) {
  const result = {};
  for (const item of await fs.readdir(root, { recursive: true, withFileTypes: true })) if (item.isFile()) {
    const file = path.join(item.parentPath, item.name); result[path.relative(root, file)] = hash(await fs.readFile(file));
  }
  return result;
}
const cli = fileURLToPath(new URL('../scene-compose.mjs', import.meta.url));
test('CLI emits scene or revision-bound bundle on stdout and never changes the input or creates files', async t => {
  const root = await temporary(t), file = path.join(root, 'recipe.json'), content = '\ufeff' + exampleContent.replaceAll('\n', '\r\n');
  await fs.writeFile(file, content); const before = await inventory(root);
  const direct = await runSceneComposeCommand(['--input', file]); assert.deepEqual(direct, expectedExample());
  const plain = await run(process.execPath, [cli, '--input', file], { cwd: root, timeout: 15000, maxBuffer: 1024 * 1024 });
  assert.equal(plain.stderr, ''); assert.deepEqual(JSON.parse(plain.stdout), direct);
  const emitted = await run(process.execPath, [cli, '--input', file, '--emit', 'bundle'], { cwd: root, timeout: 15000, maxBuffer: 1024 * 1024 });
  const bundle = JSON.parse(emitted.stdout); assert.equal(emitted.stderr, '');
  assert.deepEqual(Object.keys(bundle).sort(), ['format', 'scene', 'schemaVersion', 'sourceMap', 'sourceRevision']);
  assert.equal(bundle.format, 'viento-scene-composition-result'); assert.equal(bundle.schemaVersion, 1);
  assert.equal(bundle.sourceRevision, `sha256:${hash(Buffer.from(content))}`); assert.notEqual(bundle.sourceRevision, `sha256:${hash(exampleContent)}`);
  assert.deepEqual(bundle.scene, direct); assert.deepEqual(bundle.sourceMap, expand(content).sourceMap); assert.deepEqual(await inventory(root), before);
});
test('CLI refuses malformed options, nonregular files, invalid UTF8 and oversized recipes without writing output', async t => {
  const root = await temporary(t), file = path.join(root, 'recipe.json');
  for (const args of [[], ['--input', file, '--emit', 'unknown'], ['--input', file, '--output', 'scene.json']]) {
    await assert.rejects(runSceneComposeCommand(args), { errorCode: 'scene_composition_arguments' });
  }
  for (const [bytes, errorCode] of [[Buffer.from('{'), 'scene_composition_invalid'], [Buffer.from([0xff]), 'scene_composition_invalid'], [Buffer.alloc(131073, 32), 'scene_composition_limit']]) {
    await fs.writeFile(file, bytes); const before = await inventory(root);
    await assert.rejects(run(process.execPath, [cli, '--input', file], { cwd: root, timeout: 15000 }), error => {
      assert.equal(error.code, 1); assert.equal(error.stdout, ''); assert.equal(JSON.parse(error.stderr).errorCode, errorCode); return true;
    });
    assert.deepEqual(await inventory(root), before);
  }
  await assert.rejects(runSceneComposeCommand(['--input', root]), { errorCode: 'scene_composition_input' });
  await assert.rejects(runSceneComposeCommand(['--input', path.join(root, 'missing.json')]), { errorCode: 'scene_composition_input' });
  if (process.platform !== 'win32') {
    const fifo = path.join(root, 'recipe.pipe'); await run('mkfifo', [fifo]);
    await assert.rejects(run(process.execPath, [cli, '--input', fifo], { cwd: root, timeout: 5000 }), error => {
      assert.equal(error.killed, false); assert.equal(JSON.parse(error.stderr).errorCode, 'scene_composition_input'); return true;
    });
  }
});

async function registeredScene(t) {
  const directory = await temporary(t), root = path.join(directory, 'workspace'), recipeFile = path.join(directory, 'recipe.json');
  await fs.cp(new URL('../../examples/scene2d/', import.meta.url), root, { recursive: true });
  await fs.writeFile(recipeFile, exampleContent); await registerWorkspace(root);
  const before = await inventory(root), { scene, sourceMap } = expand(exampleContent), view = await readWorldProjection(root);
  const input = { command: 'scene.create', mode: 'apply', worldId: view.world.id, baseRevision: view.world.revision,
    actorRef: { kind: 'tool', id: 'composition-integration' }, objectId: uuid(6000), documentType: 'scene', sourcePath: 'documents/scenes/composed.json', content: json(scene) };
  const execute = createWorldCommandService(root), preview = await execute({ ...input, mode: 'preview' });
  assert.deepEqual(await inventory(root), before, 'preview is read-only');
  assert.deepEqual(preview.changes[0].record.relations, [{ kind: 'references', targetId: actorId, slot: '' }]);
  assert.equal(preview.changes[0].record.assetBindings.length, 1); assert.equal(preview.changes[0].record.assetBindings[0].assetId, imageId);
  await execute(input);
  for (const [name, digest] of Object.entries(before)) assert.equal((await inventory(root))[name], digest, name);
  assert.equal(await fs.readFile(recipeFile, 'utf8'), exampleContent);
  return { directory, root, recipeFile, scene, sourceMap, input };
}
test('baked composition uses the existing scene transaction, v3 model, runtime2 plan and deduplicated definition/resource registration', async t => {
  const f = await registeredScene(t), snapshot = await readWorldSnapshot(f.root), resolved = resolveScene2DModel(snapshot, f.input.objectId);
  assert.equal(resolved.ok, true, json(resolved.diagnostics)); assert.equal(resolved.model.schemaVersion, 3);
  assert.deepEqual(resolved.model.groups, f.scene.groups); assert.deepEqual(resolved.model.actors.map(actor => actor.instanceId), f.scene.actors.map(actor => actor.instanceId));
  const planned = createScene2DPlan(snapshot, f.input.objectId); assert.equal(planned.ok, true, json(planned.diagnostics)); assert.equal(planned.plan.schemaVersion, 2);
  assert.equal(Object.hasOwn(planned.plan, 'groups'), false); assert.ok(planned.plan.actors.every(actor => !Object.hasOwn(actor, 'groupId')));
  assert.deepEqual(planned.plan.resources.map(resource => resource.id), [imageId]);
  const record = JSON.parse(await fs.readFile(path.join(f.root, `metadata/documents/${f.input.objectId}.json`)));
  assert.equal(record.relations.length, 1); assert.equal(record.assetBindings.length, 1);
  assert.equal(JSON.stringify(record).includes('viento-scene-composition'), false);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(f.root, f.input.sourcePath))), f.scene);
  assert.equal(await fs.readFile(f.recipeFile, 'utf8'), exampleContent);
});
async function zipEntries(file) {
  const zip = await new Promise((resolve, reject) => yauzl.open(file, { lazyEntries: true }, (error, value) => error ? reject(error) : resolve(value)));
  return new Promise((resolve, reject) => {
    const result = {}; zip.on('error', reject); zip.on('end', () => resolve(result));
    zip.on('entry', entry => zip.openReadStream(entry, (error, stream) => {
      if (error) return reject(error); const chunks = []; stream.on('error', reject); stream.on('data', chunk => chunks.push(chunk));
      stream.on('end', () => { result[entry.fileName] = Buffer.concat(chunks); zip.readEntry(); });
    })); zip.readEntry();
  });
}
test('resource package roundtrip and complete archive preserve baked groups, stable IDs and one shared sprite without inventing recipe registration', async t => {
  const f = await registeredScene(t), before = await inventory(f.root), catalog = await readPackageCatalog(f.root);
  const exported = await planExport(f.root, { kind: 'resources', ids: [f.input.objectId], revision: catalog.revision });
  assert.equal(exported.documentCount, 2); assert.equal(exported.assetCount, 1);
  const zip = path.join(f.directory, 'composed.zip'); await writeExportZip(exported, zip);
  const unpacked = path.join(f.directory, 'unpacked'); await fs.mkdir(unpacked); const pack = await unpackResourcePackage(zip, unpacked);
  assert.deepEqual(new Set(pack.manifest.documents.map(item => item.id)), new Set([f.input.objectId, actorId]));
  assert.deepEqual(pack.manifest.assets.map(item => item.id), [imageId]);
  const target = path.join(f.directory, 'imported'); await fs.mkdir(target);
  const manifest = JSON.parse(await fs.readFile(path.join(f.root, 'workspace.json'))); manifest.id = randomUUID(); manifest.name = 'Imported composition';
  await fs.writeFile(path.join(target, 'workspace.json'), json(manifest)); await fs.cp(path.join(f.root, 'templates'), path.join(target, 'templates'), { recursive: true });
  await registerWorkspace(target); const planned = await planPackageImport(target, pack); assert.deepEqual(planned.summary.conflicts, []);
  assert.equal((await applyPackageImport(target, pack, planned.revision)).status, 'imported');
  for (const name of [f.input.sourcePath, `metadata/documents/${f.input.objectId}.json`, 'documents/characters/traveler.md', 'assets/traveler.svg']) {
    assert.deepEqual(await fs.readFile(path.join(target, name)), await fs.readFile(path.join(f.root, name)), name);
  }
  const original = await captureBuildSnapshot(f.root, f.input.objectId), restored = await captureBuildSnapshot(target, f.input.objectId);
  assert.equal(original.ok, true, json(original.diagnostics)); assert.equal(restored.ok, true, json(restored.diagnostics));
  assert.deepEqual(restored.plan.actors, original.plan.actors); assert.deepEqual(restored.plan.resources, original.plan.resources);
  assert.deepEqual(restored.sceneStructure, original.sceneStructure);
  const complete = await planExport(f.root, { kind: 'workspace' }), completeZip = path.join(f.directory, 'complete.zip'); await writeExportZip(complete, completeZip);
  const entries = await zipEntries(completeZip); assert.deepEqual(JSON.parse(entries[f.input.sourcePath]), f.scene);
  assert.deepEqual(entries['assets/traveler.svg'], await fs.readFile(path.join(f.root, 'assets/traveler.svg')));
  assert.ok(Object.keys(entries).every(name => !name.endsWith('recipe.json') && !name.endsWith('source-map.json')));
  assert.deepEqual(await inventory(f.root), before); assert.equal(await fs.readFile(f.recipeFile, 'utf8'), exampleContent);
});
test('real Godot builds the composed v3 scene through runtime2 and runs its frozen four instances after source goes offline', {
  skip: !godot && 'Set VIENTO_GODOT_BIN for real composition-to-Godot integration.', timeout: 120000,
}, async t => {
  const f = await registeredScene(t), before = await inventory(f.root), output = path.join(f.directory, 'build');
  const built = await buildProject({ root: f.root, scene: f.input.objectId, godot, output }); assert.equal(built.ok, true, json(built));
  assert.deepEqual(await inventory(f.root), before);
  const frozen = JSON.parse(await fs.readFile(path.join(output, 'snapshot.json'))); assert.equal(frozen.plan.schemaVersion, 2); assert.equal(frozen.plan.actors.length, 4);
  assert.equal(frozen.sceneStructure, undefined); assert.equal(Object.hasOwn(frozen.plan, 'sourceMap'), false);
  assert.deepEqual(JSON.parse(frozen.source.documents.find(item => item.record.id === f.input.objectId).content), f.scene);
  await fs.rename(f.root, f.root + '-offline'); const result = await runProjectBuild({ buildDirectory: output, godot }); assert.equal(result.ok, true, json(result));
  assert.deepEqual(result.record.events.find(event => event.event === 'finished').actors, f.scene.actors.map((actor, index) => ({
    instanceId: actor.instanceId, objectId: actor.objectId, position: index === 0 ? [160, 180] : actor.position, state: 'idle',
  })));
  assert.deepEqual(await inventory(f.root + '-offline'), before); assert.equal(await fs.readFile(f.recipeFile, 'utf8'), exampleContent);
});
