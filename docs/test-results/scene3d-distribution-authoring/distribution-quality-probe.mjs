// Independent stage-only evidence; no build, server, file save or product writes.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import * as core from '../../../engine/studio-core.mjs';
import { createScene3DDistributionProposal, isScene3DDistributionProposal, prepareScene3DDistributionApply } from '../../../engine/scene3d-distribution.mjs';
import { createScene3DTransformProposal, prepareScene3DTransformApply } from '../../../engine/scene3d-transform.mjs';
import { createScene3DObjectsProposal, prepareScene3DObjectsApply } from '../../../engine/scene3d-objects.mjs';
import { createScene3DEnvironmentProposal, prepareScene3DEnvironmentApply } from '../../../engine/scene3d-environment.mjs';
import { createScene3DPropertiesProposal, prepareScene3DPropertiesApply } from '../../../engine/scene3d-properties.mjs';
import { createScene3DTranslationProposal, prepareScene3DTranslationApply } from '../../../engine/scene3d-translation.mjs';
import { createScene3DAlignmentProposal, prepareScene3DAlignmentApply } from '../../../engine/scene3d-alignment.mjs';

const root = new URL('../../../', import.meta.url), out = new URL('./', import.meta.url);
const sha = value => createHash('sha256').update(value).digest('hex');
const sourcePaths = ['engine/studio-core.mjs', 'engine/scene3d-distribution.mjs', 'engine/scene3d-authoring.mjs',
  'web/modules/app-runtime.js', 'web/modules/app-studio-system.js', 'crates/viento-studio-core/src/scene3d_distribution_patch.rs'];
const hashes = async () => Object.fromEntries(await Promise.all(sourcePaths.map(async path => [path, sha(await fs.readFile(new URL(path, root)))])));
const beforeSources = await hashes(), wasmBytes = await fs.readFile(new URL('engine/studio-core.wasm', root));
const nativePath = process.env.VIENTO_STUDIO_CORE_BIN;
assert.ok(nativePath, 'Root must supply the frozen native CLI; reviewer never builds.');
const nativeBytes = await fs.readFile(nativePath), nativeBeforeSha256 = sha(nativeBytes);
await core.initializeStudioCore(() => wasmBytes);
const { instance } = await WebAssembly.instantiate(wasmBytes, {}), raw = instance.exports;
const cases = [], parityInputs = [], counts = { canonicalTargets: 0, nativeParityRequests: 0, forgedReceipts: 0, oldOperations: 0, pairwiseBrandDirections: 0 };
async function run(name, fn) { try { await fn(); cases.push({ name, ok: true }); } catch (error) { cases.push({ name, ok: false, error: error.stack || String(error) }); } }
const id = n => `${n.toString(16).padStart(8, '0')}-1111-4111-8111-111111111111`;
const box = (n, position = [n, -n, n / 4]) => ({ instanceId: id(n), name: `Box ${n} 🦊`, primitive: 'box', position,
  rotationDegrees: [n * 7.25, 25 - n * 3, -n * 1.25], size: [n / 8 + .001, 3, n / 3 + .001], color: '#aB89CD' });
const scene = (objects = [box(1, [1, 0, 0]), box(2, [2, 0, 0]), box(3, [7, 0, 0])]) => ({ format: 'viento-scene3d', schemaVersion: 1, name: '排序 / order / 順序 🦊',
  viewport: [800, 600], background: '#142538', camera: { position: [8, 6, 8], target: [0, 0, 0], fovDegrees: 60, near: .05, far: 1000 },
  light: { direction: [-1, -2, -1], color: '#FFFFFF', energy: 1 }, objects });
const text = value => '\uFEFF' + JSON.stringify(value, null, '\t').replaceAll('\n', '\r\n') + '\r\n \t';
const parsed = content => JSON.parse(content.replace(/^\uFEFF/, ''));
const request = (content, instanceIds = [id(3), id(1), id(2)], axis = 'x') => ({ protocolVersion: 1, operation: 'scene3d.distributeObjects', content, instanceIds, axis });
const patch = value => core.dispatchStudioCoreScene3DDistributionPatch(value);
const snapshot = (content, baseline = content) => ({ sourcePath: 'documents/scenes/distribution.json', token: 'session:1', content,
  baseSourceRevision: 'sha256:' + sha(baseline), sourceRevision: 'sha256:' + sha(content) });
const digest = async value => sha(value), axisIndex = axis => ({ x: 0, y: 1, z: 2 })[axis];
function wasm(input) {
  const bytes = new TextEncoder().encode(typeof input === 'string' ? input : JSON.stringify(input)), pointer = raw.viento_core_input(bytes.length) >>> 0;
  new Uint8Array(raw.memory.buffer, pointer, bytes.length).set(bytes);
  const output = raw.viento_core_run() >>> 0, length = raw.viento_core_output_len();
  return JSON.parse(new TextDecoder('utf8', { fatal: true }).decode(new Uint8Array(raw.memory.buffer, output, length)));
}
function expectedModel(input) {
  const value = parsed(input.content), axis = axisIndex(input.axis), selected = new Set(input.instanceIds);
  const ordered = value.objects.map((object, index) => ({ object, index })).filter(row => selected.has(row.object.instanceId))
    .sort((a, b) => a.object.position[axis] - b.object.position[axis] || a.index - b.index);
  const start = ordered[0].object.position[axis], end = ordered.at(-1).object.position[axis];
  for (let i = 1; i < ordered.length - 1; i++) ordered[i].object.position[axis] = start + (end - start) * (i / (ordered.length - 1));
  return { value, ordered: ordered.map(row => row.object.instanceId) };
}
await run('BOM CRLF escaped keys and endpoint numeric spellings survive one net interior edit', () => {
  let content = text(scene([box(1, [0, 11.25, 0]), box(2, [-20.125, -2.25, 1]), box(3, [9.125, 7.25, 2])]));
  content = content.replace('"objects"', '"objec\\u0074s"').replaceAll('"position"', '"posi\\u0074ion"')
    .replace('1000', '1.000e3').replace('-20.125,', '-20.125e0,').replace('9.125,', '9.125e0,');
  const input = request(content), result = patch(input), expected = expectedModel(input);
  assert.deepEqual(parsed(result.afterContent), expected.value); assert.deepEqual(result.orderedInstanceIds, [id(2), id(1), id(3)]);
  assert.deepEqual(result.instanceIds, [id(1), id(2), id(3)]); assert.deepEqual(result.changedPaths, ['/objects/0/position/0']);
  assert.equal(result.afterContent, content.replace('"posi\\u0074ion": [\r\n\t\t\t\t0,', '"posi\\u0074ion": [\r\n\t\t\t\t-5.5,'));
  assert.ok(result.afterContent.includes('-20.125e0,') && result.afterContent.includes('9.125e0,'));
  counts.canonicalTargets += 3; parityInputs.push(input);
});
await run('all three author axes preserve rotated nonuniform boxes and all unselected declarations', () => {
  for (const axis of ['x', 'y', 'z']) {
    const index = axisIndex(axis), objects = [box(1), box(2), box(3), box(4)];
    [9, -7, 0, 21].forEach((coordinate, i) => { objects[i].position[index] = coordinate; });
    const input = request(JSON.stringify(scene(objects)), [id(4), id(1), id(3)], axis), result = patch(input), expected = expectedModel(input);
    assert.deepEqual(parsed(result.afterContent), expected.value); assert.deepEqual(result.orderedInstanceIds, [id(3), id(1), id(4)]);
    assert.deepEqual(result.instanceIds, [id(1), id(3), id(4)]); assert.deepEqual(result.changedPaths, [`/objects/0/position/${index}`]);
    assert.deepEqual(parsed(result.afterContent).objects[1], objects[1]); parityInputs.push(input);
  }
});
await run('numeric ties including plus and minus zero use original declaration order, never click order', () => {
  const value = scene([box(1, [0, 0, 0]), box(2, [0, 1, 0]), box(3, [10, 2, 0]), box(4, [10, 3, 0])]);
  const content = JSON.stringify(value).replace('"position":[0,1,0]', '"position":[-0,1,0]');
  const input = request(content, [id(4), id(2), id(1), id(3)]), result = patch(input);
  assert.deepEqual(result.orderedInstanceIds, [id(1), id(2), id(3), id(4)]);
  assert.deepEqual(result.instanceIds, [id(1), id(2), id(3), id(4)]); assert.deepEqual(parsed(result.afterContent), expectedModel(input).value);
  assert.deepEqual(result.changedPaths, ['/objects/1/position/0', '/objects/2/position/0']); parityInputs.push(input);
});
await run('already uniform and zero-span selections return byte-exact noops and no approval', () => {
  for (const coords of [[-4, 0, 4], [0, 0, 0]]) {
    const value = scene(coords.map((coordinate, i) => box(i + 1, [coordinate, i, 0])));
    let content = text(value).replace('1000', '1e3');
    content = content.replace('"position": [\r\n\t\t\t\t0,', '"position": [\r\n\t\t\t\t-0,');
    const input = request(content), result = patch(input);
    assert.equal(result.beforeContent, content); assert.equal(result.afterContent, content); assert.deepEqual(result.changedPaths, []);
    assert.throws(() => createScene3DDistributionProposal(snapshot(content), { instanceIds: input.instanceIds, axis: 'x' }), { errorCode: 'scene3d_distribution_unchanged' });
    parityInputs.push(input);
  }
});
await run('nonzero spans whose rounded interior cannot be strictly ordered fail atomically', () => {
  for (const coords of [[0, 0, 5e-324], [-5e-324, 0, 0], [99999.99999999999, 100000, 100000]]) {
    const input = request(JSON.stringify(scene(coords.map((coordinate, i) => box(i + 1, [coordinate, i, 0]))))), original = JSON.stringify(input);
    const result = wasm(input); assert.equal(result.ok, false); assert.equal(result.errorCode, 'scene3d_distribution_invalid');
    assert.equal(Object.hasOwn(result, 'scene3dDistributionPatch'), false); assert.throws(() => patch(input)); assert.equal(JSON.stringify(input), original);
    parityInputs.push(input);
  }
});
await run('representable subnormal interior is retained as native author data and endpoints stay fixed', () => {
  const input = request(JSON.stringify(scene([box(1, [0, 0, 0]), box(2, [0, 1, 0]), box(3, [1e-323, 2, 0])]))), result = patch(input);
  assert.equal(parsed(result.afterContent).objects[1].position[0], 5e-324); assert.deepEqual(result.changedPaths, ['/objects/1/position/0']);
  assert.deepEqual(result.orderedInstanceIds, [id(1), id(2), id(3)]); parityInputs.push(input);
});
await run('malformed targets axis and source never return partial receipts', () => {
  const content = JSON.stringify(scene());
  const invalid = [request(content, []), request(content, [id(1), id(2)]), request(content, [id(1), id(1), id(3)]),
    request(content, [id(1), id(2), id(99)]), request(content, Array(129).fill(id(1))), request(content, null), request(content + '\ninvalid')];
  for (const axis of ['X', 'world-x', 'constructor', '__proto__', '', 0, null]) invalid.push(request(content, undefined, axis));
  for (const input of invalid) { assert.throws(() => patch(input)); const result = wasm(input); assert.equal(result.ok, false); assert.equal(Object.hasOwn(result, 'scene3dDistributionPatch'), false); }
  parityInputs.push(...invalid.slice(0, 5), invalid[7]);
  const wire = JSON.stringify(request(content));
  for (const input of [wire.replace('"axis":"x"', '"axis":"x","axis":"x"'), wire.replace('"protocolVersion":1', '"protocolVersion":1,"protocolVersion":1')]) {
    const result = wasm(input); assert.equal(result.ok, false); assert.equal(Object.hasOwn(result, 'scene3dDistributionPatch'), false); parityInputs.push(input);
  }
});
await run('128 reverse-requested stable IDs expose both source and original-coordinate distribution orders', () => {
  const objects = Array.from({ length: 128 }, (_, i) => box(i + 1, [i * i, -i * 7, i / 4])), value = scene(objects);
  const input = request(JSON.stringify(value), objects.map(object => object.instanceId).reverse()), result = patch(input);
  assert.deepEqual(result.instanceIds, objects.map(object => object.instanceId)); assert.deepEqual(result.orderedInstanceIds, result.instanceIds);
  assert.deepEqual(parsed(result.afterContent), expectedModel(input).value); assert.equal(result.changedPaths.length, 126);
  assert.deepEqual(result.changedPaths, Array.from({ length: 126 }, (_, i) => `/objects/${i + 1}/position/0`)); counts.canonicalTargets += 128; parityInputs.push(input);
});
await run('full final byte budget permits early growth plus later shrinking but rejects net overflow', () => {
  const value = scene([box(1, [0, 0, 0]), box(2, [-100000, 1, 0]), box(3, [0.000000000000001, 2, 0]), box(4, [100000, 3, 0])]);
  const base = JSON.stringify(value).replace('"position":[1e-15,2,0]', '"position":[1e-000000000000000000000000000000015,2,0]');
  assert.ok(base.includes('1e-000000000000000000000000000000015'));
  const content = base + ' '.repeat(128 * 1024 - Buffer.byteLength(base));
  const input = request(content, [id(4), id(3), id(2), id(1)]), result = patch(input);
  assert.deepEqual(parsed(result.afterContent), expectedModel(input).value); assert.ok(Buffer.byteLength(result.afterContent) <= 128 * 1024); parityInputs.push(input);
  const tooLargeBase = JSON.stringify(scene([box(1, [-100000, 0, 0]), box(2, [0, 1, 0]), box(3, [0, 2, 0]), box(4, [100000, 3, 0])]));
  const overflow = request(tooLargeBase + ' '.repeat(128 * 1024 - Buffer.byteLength(tooLargeBase)), [id(4), id(3), id(2), id(1)]);
  assert.throws(() => patch(overflow)); assert.equal(wasm(overflow).ok, false); parityInputs.push(overflow);
});
await run('private seventh brand detaches intent and all five source fields before async application', async () => {
  const content = text(scene()), source = snapshot(content), edit = { instanceIds: [id(3), id(2), id(1)], axis: 'x' };
  const proposal = createScene3DDistributionProposal(source, edit); assert.ok(isScene3DDistributionProposal(proposal));
  assert.ok(Object.isFrozen(proposal) && Object.isFrozen(proposal.orderedInstanceIds) && Object.isFrozen(proposal.beforeObjects));
  edit.instanceIds.pop(); edit.axis = 'y'; source.content = 'mutated'; assert.deepEqual(proposal.instanceIds, [id(1), id(2), id(3)]);
  assert.equal((await prepareScene3DDistributionApply(snapshot(content), proposal, { digest })).afterContent, proposal.afterContent);
  for (const change of [{ token: 'other' }, { sourcePath: 'documents/other.json' }, { content: content + ' ' }, { sourceRevision: 'sha256:' + '0'.repeat(64) }, { baseSourceRevision: 'sha256:' + '0'.repeat(64) }])
    await assert.rejects(prepareScene3DDistributionApply({ ...snapshot(content), ...change }, proposal, { digest }), { errorCode: 'scene3d_distribution_conflict' });
  const copy = structuredClone(proposal); assert.equal(isScene3DDistributionProposal(copy), false);
  await assert.rejects(prepareScene3DDistributionApply(snapshot(content), copy, { digest }), { errorCode: 'scene3d_distribution_conflict' });
  let release; const gate = new Promise(resolve => { release = resolve; }), waiting = snapshot(content);
  const result = prepareScene3DDistributionApply(waiting, proposal, { digest: () => gate }); waiting.content = 'late'; waiting.token = 'late'; release(sha(content));
  assert.equal((await result).afterContent, proposal.afterContent);
});
await run('six predecessor brands and distribution remain isolated in all twelve directed comparisons', async () => {
  const content = text(scene()), source = snapshot(content);
  const old = [createScene3DTransformProposal(source, { instanceId: id(1), values: { position: [8, 0, 0] } }),
    createScene3DObjectsProposal(source, { action: 'copy', instanceId: id(1), newInstanceId: id(99), name: 'Copy' }),
    createScene3DEnvironmentProposal(source, { values: { background: '#203040' } }),
    createScene3DPropertiesProposal(source, { instanceId: id(1), values: { color: '#abcdef' } }),
    createScene3DTranslationProposal(source, { instanceIds: [id(1)], offset: [1, 0, 0] }),
    createScene3DAlignmentProposal(source, { instanceIds: [id(1), id(3)], anchorInstanceId: id(3), axis: 'x' })];
  for (const proposal of old) { assert.equal(isScene3DDistributionProposal(proposal), false); await assert.rejects(prepareScene3DDistributionApply(source, proposal, { digest })); counts.pairwiseBrandDirections++; }
  const proposal = createScene3DDistributionProposal(source, { instanceIds: [id(1), id(2), id(3)], axis: 'x' });
  for (const prepare of [prepareScene3DTransformApply, prepareScene3DObjectsApply, prepareScene3DEnvironmentApply, prepareScene3DPropertiesApply, prepareScene3DTranslationApply, prepareScene3DAlignmentApply]) {
    await assert.rejects(prepare(source, proposal, { digest })); counts.pairwiseBrandDirections++;
  }
});
await run('actual predecessor WASM keeps all six old author domains working without distribution', async () => {
  const old = await import(new URL('../../../engine/studio-core.mjs?distribution-old-quality=1', import.meta.url));
  await old.initializeStudioCore(() => fs.readFile(new URL('previous-studio-core.wasm', out)));
  assert.equal(old.supportsStudioCoreScene3D(), true); assert.equal(old.supportsStudioCoreScene3DDistributionPatch(), false);
  const content = JSON.stringify(scene()); assert.throws(() => old.dispatchStudioCoreScene3DDistributionPatch(request(content)), { errorCode: 'studio_core_unavailable' });
  for (const [dispatch, input] of [
    [old.dispatchStudioCoreScene3DPatch, { protocolVersion: 1, operation: 'scene3d.patchObjectTransform', content, instanceId: id(1), values: { position: [10, 0, 0] } }],
    [old.dispatchStudioCoreScene3DObjectsPatch, { protocolVersion: 1, operation: 'scene3d.patchObjects', content, action: 'copy', instanceId: id(1), newInstanceId: id(99), name: 'Copy' }],
    [old.dispatchStudioCoreScene3DEnvironmentPatch, { protocolVersion: 1, operation: 'scene3d.patchEnvironment', content, values: { background: '#203040' } }],
    [old.dispatchStudioCoreScene3DPropertiesPatch, { protocolVersion: 1, operation: 'scene3d.patchProperties', content, instanceId: id(1), values: { color: '#abcdef' } }],
    [old.dispatchStudioCoreScene3DTranslationPatch, { protocolVersion: 1, operation: 'scene3d.translateObjects', content, instanceIds: [id(1)], offset: [1, 0, 0] }],
    [old.dispatchStudioCoreScene3DAlignmentPatch, { protocolVersion: 1, operation: 'scene3d.alignObjects', content, instanceIds: [id(1), id(3)], anchorInstanceId: id(3), axis: 'x' }],
  ]) { assert.notEqual(dispatch(input).afterContent, content); counts.oldOperations++; }
});
let responseId = 0;
async function responseBridge(response, version = 1) {
  const module = await import(new URL(`../../../engine/studio-core.mjs?distribution-receipt-quality=${++responseId}`, import.meta.url));
  const memory = new WebAssembly.Memory({ initial: 40 }), instantiate = WebAssembly.instantiate; let inputLength = 0, outputLength = 0;
  try {
    WebAssembly.instantiate = async () => ({ instance: { exports: { memory, viento_core_protocol_version: () => 1, viento_core_scene3d_version: () => 1,
      ...(version === null ? {} : { viento_core_scene3d_distribution_version: () => version }),
      viento_core_input: length => { inputLength = length; return 16; }, viento_core_run: () => {
        const input = JSON.parse(new TextDecoder().decode(new Uint8Array(memory.buffer, 16, inputLength)));
        const value = input.operation === 'scene3d.distributeObjects' ? structuredClone(response) : wasm(input);
        const bytes = new TextEncoder().encode(JSON.stringify(value)); outputLength = bytes.length; new Uint8Array(memory.buffer, 1048576, bytes.length).set(bytes); return 1048576;
      }, viento_core_output_len: () => outputLength,
    } } });
    await module.initializeStudioCore(() => new Uint8Array([1]));
  } finally { WebAssembly.instantiate = instantiate; }
  return module;
}
await run('complete receipts reject both identity orders, axis, net paths, wrong math and all unauthorized token changes', async () => {
  const content = JSON.stringify(scene()), input = request(content), response = wasm(input); assert.equal(response.ok, true);
  const changes = [
    result => result.scene3dDistributionPatch.instanceIds.reverse(), result => result.scene3dDistributionPatch.instanceIds.pop(),
    result => result.scene3dDistributionPatch.instanceIds.push(id(1)), result => result.scene3dDistributionPatch.orderedInstanceIds.reverse(),
    result => result.scene3dDistributionPatch.orderedInstanceIds[1] = id(99), result => result.scene3dDistributionPatch.axis = 'y',
    result => result.scene3dDistributionPatch.changedPaths.pop(), result => result.scene3dDistributionPatch.changedPaths.push('/objects/0/position/0'),
    result => result.scene3dDistributionPatch.beforeContent += ' ', result => result.scene3dDistributionPatch.extra = true,
    result => result.scene3dDistributionPatch.afterContent = result.scene3dDistributionPatch.afterContent.replace('"far":1000', '"far":1e3'),
    result => result.scene3dDistributionPatch.afterContent = result.scene3dDistributionPatch.afterContent.replace('"position":[4,0,0]', '"position":[5,0,0]'),
    result => result.scene3dDistributionPatch.afterContent = result.scene3dDistributionPatch.afterContent.replace('"position":[4,0,0]', '"position":[4.0,0,0]'),
    result => result.scene3dDistributionPatch.afterContent = result.scene3dDistributionPatch.afterContent.replace('"position":[1,0,0]', '"position":[1.0,0,0]'),
    result => result.scene3dDistributionPatch.afterContent = result.scene3dDistributionPatch.afterContent.replace('"position":[4,0,0]', '"position":[4,0.0,0]'),
    result => result.scene3dDistributionPatch.afterContent = result.scene3dDistributionPatch.afterContent.replace('"near":0.05,"far":1000', '"far":1000,"near":0.05'),
  ];
  for (const change of changes) { const bad = structuredClone(response); change(bad); assert.notDeepEqual(bad, response);
    const bridge = await responseBridge(bad); assert.throws(() => bridge.dispatchStudioCoreScene3DDistributionPatch(input)); counts.forgedReceipts++; }
});
await run('absent zero or unsupported distribution probes grant no new authority while original parse works', async () => {
  const content = JSON.stringify(scene()), input = request(content), response = wasm(input);
  for (const version of [null, 0, 2]) {
    const bridge = await responseBridge(response, version); assert.equal(bridge.supportsStudioCoreScene3D(), true);
    assert.equal(bridge.supportsStudioCoreScene3DDistributionPatch(), false);
    assert.throws(() => bridge.dispatchStudioCoreScene3DDistributionPatch(input), { errorCode: 'studio_core_unavailable' });
    assert.equal(bridge.dispatchStudioCoreScene3D({ protocolVersion: 1, operation: 'scene3d.parse', content }).model.objects.length, 3);
  }
});
async function nativeSequence(inputs) {
  return new Promise((resolve, reject) => {
    const child = spawn(nativePath, [], { stdio: ['pipe', 'pipe', 'pipe'] }); let stdout = '', stderr = '', failure;
    const timer = setTimeout(() => { failure = Error('Native bounded parity timeout'); child.kill('SIGKILL'); }, 30000);
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', data => { stdout += data; if (Buffer.byteLength(stdout) > 16 * 1024 * 1024) { failure = Error('Native output budget'); child.kill('SIGKILL'); } });
    child.stderr.on('data', data => { stderr = (stderr + data).slice(-4096); }); child.stdin.on('error', error => { failure ||= error; });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', (code, signal) => { clearTimeout(timer); if (failure) return reject(failure);
      try { assert.equal(code, 0, stderr); assert.equal(signal, null); resolve(stdout.trim().split('\n').map(JSON.parse)); } catch (error) { reject(error); } });
    child.stdin.end(inputs.map(value => typeof value === 'string' ? value : JSON.stringify(value)).join('\n') + '\n');
  });
}
await run('fresh native CLI and raw WASM return equal full success and failure receipts', async () => {
  const native = await nativeSequence(parityInputs); assert.equal(native.length, parityInputs.length);
  for (let i = 0; i < native.length; i++) assert.deepEqual(native[i], wasm(parityInputs[i])); counts.nativeParityRequests += parityInputs.length;
});
const endSources = await hashes(), output = process.argv[2]; assert.ok(output && /^[a-z0-9-]+\.json$/.test(output));
const nativeEndSha256 = sha(await fs.readFile(nativePath));
const report = { format: 'viento-scene3d-distribution-independent-quality', schemaVersion: 1, observedAt: new Date().toISOString(), node: process.version,
  ok: cases.every(item => item.ok) && JSON.stringify(beforeSources) === JSON.stringify(endSources) && nativeBeforeSha256 === nativeEndSha256,
  passed: cases.filter(item => item.ok).length, failed: cases.filter(item => !item.ok).length, cases, counts, sources: beforeSources, endSources,
  sourceStable: JSON.stringify(beforeSources) === JSON.stringify(endSources), wasm: { bytes: wasmBytes.length, sha256: sha(wasmBytes) },
  previousWasm: { sha256: sha(await fs.readFile(new URL('previous-studio-core.wasm', out))) },
  native: { path: nativePath, bytes: nativeBytes.length, beforeSha256: nativeBeforeSha256, endSha256: nativeEndSha256, stable: nativeBeforeSha256 === nativeEndSha256 },
  scope: 'Independent controlled stage-only source/native/WASM/complete receipt and seven-brand checks. No build, service, actual checkout writes, Save, GPU/backend/device/install or final apply claimed.' };
await fs.writeFile(new URL(output, out), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
process.stdout.write(JSON.stringify({ ok: report.ok, passed: report.passed, failed: report.failed, counts, sourceStable: report.sourceStable, node: process.version }) + '\n');
if (!report.ok) process.exitCode = 1;
