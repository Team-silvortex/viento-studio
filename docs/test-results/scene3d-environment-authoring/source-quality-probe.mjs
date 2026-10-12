// Bounded authoring quality proof: normal atomic edits, exact source retention
// and native/WASM agreement. No build, engine execution, Save or author writes.
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import '../../../scripts/adapters/node-studio-core.mjs';
import { parseScene3DSource } from '../../../engine/scene3d.mjs';
import { dispatchStudioCoreScene3DEnvironmentPatch } from '../../../engine/studio-core.mjs';
import { createScene3DEnvironmentProposal, prepareScene3DEnvironmentApply } from '../../../engine/scene3d-environment.mjs';

const root = new URL('../../../', import.meta.url), hash = value => createHash('sha256').update(value).digest('hex');
const content = await fs.readFile(new URL('examples/scene3d/scene.json', root), 'utf8');
const original = JSON.parse(content), checks = [], wireRequests = [];
const source = raw => ({ sourcePath: 'documents/scene.json', token: 'load:4:draft:7', content: raw,
  baseSourceRevision: `sha256:${hash(content)}`, sourceRevision: `sha256:${hash(raw)}` });
const request = (raw, values) => ({ protocolVersion: 1, operation: 'scene3d.patchEnvironment', content: raw, values });
const native = new URL('desktop/.cache/scene3d-environment-core-target/debug/viento-core', root);
const bytes = await fs.readFile(new URL('engine/studio-core.wasm', root));
const spans = raw => parseScene3DSource(raw).sourceLocations.objects.map(item => raw.slice(item.sourceRange.start, item.sourceRange.end));
async function check(id, run) {
  try { await run(); checks.push({ id, ok: true }); }
  catch (error) { checks.push({ id, ok: false, message: error.message }); }
}
const raw = '\uFEFF' + content.replaceAll('\n', '\r\n')
  .replace('"background": "#0d1829"', '"backgr\\u006fund": "#\\u0030d1829"')
  .replace('"camera"', '"ca\\u006dera"')
  .replace('"fovDegrees": 50', '"fov\\u0044egrees": 5.0e1')
  .replace('"color": "#ffffff"', '"col\\u006fr": "#\\u0066fffff"')
  .replace('"energy": 1.2', '"energy": 1.200e0') + ' \t';

await check('scalar-and-color-leaves-preserve-all-unselected-original-text', async () => {
  const values = { background: '#AbCdEf', camera: { fovDegrees: 75 }, light: { color: '#ffCC00', energy: 0 } };
  const p = createScene3DEnvironmentProposal(source(raw), { values });
  const expected = raw.replace('"#\\u0030d1829"', '"#AbCdEf"').replace('5.0e1', '75')
    .replace('"#\\u0066fffff"', '"#ffCC00"').replace('1.200e0', '0');
  assert.equal(p.afterContent, expected);
  assert.deepEqual(p.changedPaths, ['/background', '/camera/fovDegrees', '/light/color', '/light/energy']);
  assert.deepEqual(spans(p.afterContent), spans(raw));
  assert.equal((await prepareScene3DEnvironmentApply(source(raw), p, { digest: async value => hash(value) })).afterContent, expected);
  wireRequests.push(request(raw, values));
});
await check('semantic-noop-retains-escaped-strings-exponents-bom-and-crlf-without-approval', () => {
  const values = { background: original.background, camera: { fovDegrees: 50 }, light: { color: '#ffffff', energy: 1.2 } };
  const patched = dispatchStudioCoreScene3DEnvironmentPatch(request(raw, values));
  assert.equal(patched.afterContent, raw); assert.deepEqual(patched.changedPaths, []);
  assert.throws(() => createScene3DEnvironmentProposal(source(raw), { values }), { errorCode: 'scene3d_environment_unchanged' });
  wireRequests.push(request(raw, values));
});
await check('dependent-camera-position-and-target-change-once-without-an-invalid-intermediate', () => {
  const value = structuredClone(original); value.camera.position = [1, 0, 0]; value.camera.target = [0, 0, 0];
  const before = JSON.stringify(value), values = { camera: { position: [0, 0, 0], target: [1, 0, 0] } };
  for (const partial of [{ camera: { position: [0, 0, 0] } }, { camera: { target: [1, 0, 0] } }]) {
    assert.throws(() => dispatchStudioCoreScene3DEnvironmentPatch(request(before, partial)), { errorCode: 'scene3d_environment_invalid' });
    wireRequests.push(request(before, partial));
  }
  const result = dispatchStudioCoreScene3DEnvironmentPatch(request(before, values));
  assert.deepEqual(result.changedPaths, ['/camera/position/0', '/camera/target/0']);
  const after = parseScene3DSource(result.afterContent).model;
  assert.deepEqual(after.camera.position, [0, 0, 0]); assert.deepEqual(after.camera.target, [1, 0, 0]);
  assert.deepEqual(spans(result.afterContent), spans(before)); wireRequests.push(request(before, values));
});
await check('dependent-near-and-far-fields-admit-the-complete-valid-range-in-both-directions', () => {
  for (const camera of [{ near: 1500, far: 2000 }, { near: 0.01, far: 0.05 }]) {
    const result = dispatchStudioCoreScene3DEnvironmentPatch(request(content, { camera }));
    const after = parseScene3DSource(result.afterContent).model;
    assert.equal(after.camera.near, camera.near); assert.equal(after.camera.far, camera.far);
    assert.deepEqual(spans(result.afterContent), spans(content)); wireRequests.push(request(content, { camera }));
  }
});
await check('all-environment-fields-have-fixed-net-path-order-and-leave-all-object-identities-intact', () => {
  const values = { light: { energy: 0, color: '#abcdef', direction: [1, -3, 2] }, background: '#112233',
    camera: { far: 2000, near: 0.05, fovDegrees: 70, target: [1, 2, 3], position: [8, 6, 9] } };
  const result = dispatchStudioCoreScene3DEnvironmentPatch(request(raw, values));
  assert.deepEqual(result.changedPaths, ['/background', '/camera/position/0', '/camera/position/1', '/camera/position/2',
    '/camera/target/0', '/camera/target/1', '/camera/target/2', '/camera/fovDegrees', '/camera/near', '/camera/far',
    '/light/direction/0', '/light/direction/1', '/light/direction/2', '/light/color', '/light/energy']);
  const after = parseScene3DSource(result.afterContent).model;
  assert.deepEqual(after.objects, original.objects); assert.deepEqual(after.viewport, original.viewport); assert.equal(after.name, original.name);
  assert.deepEqual(spans(result.afterContent), spans(raw)); wireRequests.push(request(raw, values));
});
await check('zero-light-energy-and-small-valid-direction-remain-authored-values-without-normalization', () => {
  const values = { light: { direction: [5e-324, 0, 0], energy: 0 } };
  const result = dispatchStudioCoreScene3DEnvironmentPatch(request(content, values));
  const after = parseScene3DSource(result.afterContent).model;
  assert.deepEqual(after.light.direction, [5e-324, 0, 0]); assert.equal(after.light.energy, 0);
  assert.deepEqual(spans(result.afterContent), spans(content)); wireRequests.push(request(content, values));
});
await check('proposal-detaches-raw-values-and-source-before-any-await', async () => {
  const captured = source(raw), edit = { values: { camera: { position: [8, 6, 9] }, light: { energy: 0 } } };
  const p = createScene3DEnvironmentProposal(captured, edit), expected = p.afterContent;
  edit.values.camera.position[0] = 99; edit.values.light.energy = 16;
  assert.deepEqual(p.values, { camera: { position: [8, 6, 9] }, light: { energy: 0 } });
  assert(Object.isFrozen(p.values.camera.position) && Object.isFrozen(p.afterEnvironment.camera));
  let release; const pending = prepareScene3DEnvironmentApply(captured, p, { digest: () => new Promise(resolve => { release = resolve; }) });
  captured.content = 'later'; captured.sourcePath = 'documents/later.json'; captured.token = 'reload';
  release(hash(raw)); const result = await pending;
  assert.equal(result.afterContent, expected); assert.equal(result.sourcePath, 'documents/scene.json');
  wireRequests.push(request(raw, p.values));
});
await check('final-byte-budget-applies-to-one-combined-candidate-not-intermediate-leaf-growth', () => {
  const paddedBase = content.replace('"fovDegrees": 50', '"fovDegrees": 5.0000000000000000000e1')
    .replace('"energy": 1.2', '"energy": 1.200000000000000e0');
  const exact = paddedBase + ' '.repeat(128 * 1024 - Buffer.byteLength(paddedBase));
  assert.equal(Buffer.byteLength(exact), 128 * 1024);
  const values = { camera: { position: [12.123456789, 7, 10], fovDegrees: 75 }, light: { energy: 0 } };
  const result = dispatchStudioCoreScene3DEnvironmentPatch(request(exact, values));
  assert(Buffer.byteLength(result.afterContent) <= 128 * 1024);
  assert.deepEqual(spans(result.afterContent), spans(exact)); wireRequests.push(request(exact, values));
  assert.throws(() => dispatchStudioCoreScene3DEnvironmentPatch(request(exact, { camera: { position: [12.123456789, 7, 10] } })), { errorCode: 'scene3d_limit' });
  wireRequests.push(request(exact, { camera: { position: [12.123456789, 7, 10] } }));
});
let nativeRequests = 0;
await check('all-normal-and-dependent-rule-cases-have-exact-native-wasm-wire-results', async () => {
  const lines = wireRequests.map(value => JSON.stringify(value));
  const child = spawnSync(native.pathname, [], { input: lines.join('\n') + '\n', encoding: 'utf8', timeout: 10000, maxBuffer: 8 * 1024 * 1024 });
  assert.equal(child.status, 0); assert.equal(child.stderr, '');
  const replies = child.stdout.trim().split('\n').map(JSON.parse);
  const actual = await WebAssembly.instantiate(bytes, {}), ex = actual.instance.exports;
  const wasm = lines.map(line => {
    const input = new TextEncoder().encode(line), at = ex.viento_core_input(input.length);
    new Uint8Array(ex.memory.buffer, at, input.length).set(input);
    const pointer = ex.viento_core_run(), length = ex.viento_core_output_len();
    return JSON.parse(new TextDecoder().decode(new Uint8Array(ex.memory.buffer, pointer, length)));
  });
  assert.deepEqual(replies, wasm); nativeRequests = lines.length;
});
const reviewedSources = {};
for (const path of ['engine/scene3d-authoring.mjs', 'engine/scene3d-environment.mjs', 'engine/studio-core.mjs',
  'crates/viento-studio-core/src/scene3d_environment_patch.rs', 'web/modules/app-runtime.js', 'web/modules/app-studio-system.js']) {
  reviewedSources[path] = hash(await fs.readFile(new URL(path, root)));
}
const report = { format: 'viento-scene3d-environment-independent-source-quality', schemaVersion: 1, runtime: process.version,
  ok: checks.every(item => item.ok), checks, passed: checks.filter(item => item.ok).length, failed: checks.filter(item => !item.ok).length,
  nativeRequests, native: { path: native.pathname, sha256: hash(await fs.readFile(native)) },
  wasm: { bytes: bytes.length, sha256: hash(bytes) }, reviewedSources,
  scope: 'Actual Rust-backed source edits and proposal prepare, literal byte-retention checks, source snapshot detachment and actual native/WASM results. No browser, render, Save, engine execution, installation, device or security-sandbox claim.' };
assert(process.argv[2], 'a NEW output path is required');
await fs.writeFile(process.argv[2], JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify(report, null, 2)); if (!report.ok) process.exitCode = 1;
