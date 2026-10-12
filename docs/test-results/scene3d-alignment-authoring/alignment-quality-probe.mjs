// Independent bounded source/native quality. Stage only; no build or product writes.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import * as core from '../../../engine/studio-core.mjs';
import { createScene3DAlignmentProposal, isScene3DAlignmentProposal, prepareScene3DAlignmentApply } from '../../../engine/scene3d-alignment.mjs';
import { createScene3DTransformProposal, prepareScene3DTransformApply } from '../../../engine/scene3d-transform.mjs';
import { createScene3DObjectsProposal, prepareScene3DObjectsApply } from '../../../engine/scene3d-objects.mjs';
import { createScene3DEnvironmentProposal, prepareScene3DEnvironmentApply } from '../../../engine/scene3d-environment.mjs';
import { createScene3DPropertiesProposal, prepareScene3DPropertiesApply } from '../../../engine/scene3d-properties.mjs';
import { createScene3DTranslationProposal, prepareScene3DTranslationApply } from '../../../engine/scene3d-translation.mjs';

const root = new URL('../../../', import.meta.url), out = new URL('./', import.meta.url);
const sha = value => createHash('sha256').update(value).digest('hex');
const sourcePaths = ['engine/studio-core.mjs', 'engine/scene3d-alignment.mjs', 'engine/scene3d-authoring.mjs',
  'web/modules/app-runtime.js', 'web/modules/app-studio-system.js', 'crates/viento-studio-core/src/scene3d_alignment_patch.rs'];
const hashes = async () => Object.fromEntries(await Promise.all(sourcePaths.map(async path => [path, sha(await fs.readFile(new URL(path, root)))])));
const beforeSources = await hashes(), wasmBytes = await fs.readFile(new URL('engine/studio-core.wasm', root));
const nativePath = process.env.VIENTO_STUDIO_CORE_BIN;
assert.ok(nativePath, 'Parent must supply the frozen fresh native CLI; no build performed.');
const nativeBytes = await fs.readFile(nativePath), nativeBeforeSha256 = sha(nativeBytes);
await core.initializeStudioCore(() => wasmBytes);
const { instance } = await WebAssembly.instantiate(wasmBytes, {}), raw = instance.exports;
const cases = [], counts = { canonicalTargets: 0, nativeParityRequests: 0, forgedReceipts: 0, oldOperations: 0, pairwiseBrandDirections: 0 };
async function run(name, fn) { try { await fn(); cases.push({ name, ok: true }); } catch (error) { cases.push({ name, ok: false, error: error.stack || String(error) }); } }
const id = n => `${n.toString(16).padStart(8, '0')}-1111-4111-8111-111111111111`;
const box = (n, position = [n, -n, n / 4]) => ({ instanceId: id(n), name: `Box ${n} 🦊`, primitive: 'box', position,
  rotationDegrees: [n * 7.25, 25 - n * 3, -n * 1.25], size: [n / 8 + .001, 3, n / 3 + .001], color: '#aB89CD' });
const scene = (objects = [box(1), box(2), box(3)]) => ({ format: 'viento-scene3d', schemaVersion: 1, name: '中心 / center / 中心 🦊',
  viewport: [800, 600], background: '#142538', camera: { position: [8, 6, 8], target: [0, 0, 0], fovDegrees: 60, near: .05, far: 1000 },
  light: { direction: [-1, -2, -1], color: '#FFFFFF', energy: 1 }, objects });
const text = value => '\uFEFF' + JSON.stringify(value, null, '\t').replaceAll('\n', '\r\n') + '\r\n \t';
const parsed = content => JSON.parse(content.replace(/^\uFEFF/, ''));
const request = (content, instanceIds = [id(3), id(1)], anchorInstanceId = id(3), axis = 'x') => ({
  protocolVersion: 1, operation: 'scene3d.alignObjects', content, instanceIds, anchorInstanceId, axis });
const patch = value => core.dispatchStudioCoreScene3DAlignmentPatch(value);
function wasm(input) {
  const bytes = new TextEncoder().encode(typeof input === 'string' ? input : JSON.stringify(input));
  const pointer = raw.viento_core_input(bytes.length) >>> 0;
  new Uint8Array(raw.memory.buffer, pointer, bytes.length).set(bytes);
  const output = raw.viento_core_run() >>> 0, length = raw.viento_core_output_len();
  return JSON.parse(new TextDecoder('utf8', { fatal: true }).decode(new Uint8Array(raw.memory.buffer, output, length)));
}
const snapshot = (content, baseline = content) => ({ sourcePath: 'documents/scenes/alignment.json', token: 'session:1', content,
  baseSourceRevision: 'sha256:' + sha(baseline), sourceRevision: 'sha256:' + sha(content) });
const digest = async value => sha(value), axisIndex = axis => ({ x: 0, y: 1, z: 2 })[axis];
function expectedModel(input) {
  const value = parsed(input.content), selected = new Set(input.instanceIds), axis = axisIndex(input.axis);
  const coordinate = value.objects.find(object => object.instanceId === input.anchorInstanceId).position[axis];
  for (const object of value.objects) if (selected.has(object.instanceId)) object.position[axis] = coordinate;
  return value;
}
const parityInputs = [];
await run('center alignment uses one original anchor and one author axis while nonuniform rotated geometry and full lexical source stay unchanged', () => {
  let content = text(scene([box(1, [-20.125, 11.25, 0]), box(2), box(3, [9.125, -2.25, 1])]));
  content = content.replace('"objects"', '"objec\\u0074s"').replaceAll('"position"', '"posi\\u0074ion"').replace('1000', '1.000e3');
  content = content.replace('-20.125,', '-20.125e0,').replace('9.125,', '9.125e0,');
  const input = request(content), before = JSON.stringify(input), result = patch(input);
  assert.deepEqual(parsed(result.afterContent), expectedModel(input));
  assert.equal(result.beforeContent, content); assert.deepEqual(result.instanceIds, [id(1), id(3)]);
  assert.equal(result.anchorInstanceId, id(3)); assert.equal(result.axis, 'x');
  assert.equal(result.afterContent, content.replace('-20.125e0,', '9.125,'));
  assert.ok(result.afterContent.includes('9.125e0,'), 'anchor spelling is unchanged');
  assert.ok(result.afterContent.includes('1.000e3')); assert.ok(result.afterContent.includes('posi\\u0074ion'));
  assert.deepEqual(result.changedPaths, ['/objects/0/position/0']); assert.equal(JSON.stringify(input), before);
  counts.canonicalTargets += 2; parityInputs.push(input);
});
await run('x y and z are author-world center coordinates regardless of rotated box sizes and request order', () => {
  const content = JSON.stringify(scene());
  for (const axis of ['x', 'y', 'z']) {
    const input = request(content, [id(3), id(1), id(2)], id(2), axis), result = patch(input), index = axisIndex(axis);
    assert.deepEqual(parsed(result.afterContent), expectedModel(input));
    assert.deepEqual(result.instanceIds, [id(1), id(2), id(3)]);
    assert.deepEqual(result.changedPaths, [0, 2].map(objectIndex => `/objects/${objectIndex}/position/${index}`));
    assert.equal(result.afterContent, JSON.stringify(expectedModel(input))); parityInputs.push(input);
  }
});
await run('semantic equality preserves exponent negative-zero and anchor lexemes with no approvable change', () => {
  for (const [coordinate, axis] of [[3.5, 'x'], [0, 'y']]) {
    const index = axisIndex(axis), value = scene([box(1), box(2), box(3)]);
    for (const object of value.objects) object.position[index] = coordinate;
    let content = text(value).replace('1000', '1e3');
    if (coordinate === 3.5) content = content.replace('3.5,', '3.5e0,');
    else content = content.replace('"position": [\r\n\t\t\t\t1,\r\n\t\t\t\t0,', '"position": [\r\n\t\t\t\t1,\r\n\t\t\t\t-0,');
    assert.ok(content.includes(coordinate === 3.5 ? '3.5e0,' : '\t\t\t\t-0,'), 'Independent source contains the intended noncanonical unchanged coordinate');
    const input = request(content, [id(3), id(1)], id(3), axis), result = patch(input);
    assert.equal(result.afterContent, content); assert.deepEqual(result.changedPaths, []);
    assert.deepEqual(result.instanceIds, [id(1), id(3)]);
    assert.throws(() => createScene3DAlignmentProposal(snapshot(content), { instanceIds: input.instanceIds, anchorInstanceId: input.anchorInstanceId, axis }),
      { errorCode: 'scene3d_alignment_unchanged' }); parityInputs.push(input);
  }
});
await run('tiny and exact boundary anchor coordinates are copied directly with no subtract-add cancellation', () => {
  for (const coordinate of [5e-324, -100000, 100000]) {
    const content = JSON.stringify(scene([box(1, [100000, 0, 0]), box(2, [coordinate, 0, 0]), box(3, [-100000, 0, 0])]));
    const input = request(content, [id(3), id(2), id(1)], id(2)), result = patch(input);
    assert.deepEqual(parsed(result.afterContent), expectedModel(input));
    assert.equal(parsed(result.afterContent).objects[0].position[0], coordinate);
    assert.equal(parsed(result.afterContent).objects[2].position[0], coordinate); parityInputs.push(input);
  }
});
await run('unknown duplicate malformed targets unselected reference and unsupported axis never return a partial patch', () => {
  const content = JSON.stringify(scene());
  const invalid = [request(content, []), request(content, [id(1)]), request(content, [id(1), id(1)], id(1)),
    request(content, [id(1), id(99)], id(1)), request(content, Array(129).fill(id(1)), id(1)), request(content, null),
    request(content, [id(1), id(2)], id(3)), request(content, [id(1), id(2)], id(99)), request(content, [id(1), id(2)], null)];
  for (const axis of ['X', 'world-x', 'constructor', '__proto__', '', 0, null]) invalid.push(request(content, [id(1), id(2)], id(1), axis));
  for (const input of invalid) {
    const before = JSON.stringify(input); assert.throws(() => patch(input)); assert.equal(JSON.stringify(input), before);
    const response = wasm(input); assert.equal(response.ok, false); assert.equal(Object.hasOwn(response, 'scene3dAlignmentPatch'), false);
  }
  parityInputs.push(...invalid.slice(0, 4), invalid[6], invalid[9]);
});
await run('128 selected UUIDs remain source ordered with a still included unchanged middle reference and one-axis net paths', () => {
  const value = scene(Array.from({ length: 128 }, (_, i) => box(i + 1, [i * 13, -i * 7, i / 4])));
  const input = request(JSON.stringify(value), value.objects.map(object => object.instanceId).reverse(), value.objects[65].instanceId, 'z');
  const result = patch(input); assert.deepEqual(result.instanceIds, value.objects.map(object => object.instanceId));
  assert.deepEqual(parsed(result.afterContent), expectedModel(input)); assert.equal(result.changedPaths.length, 127);
  assert.deepEqual(result.changedPaths, value.objects.flatMap((object, i) => i === 65 ? [] : [`/objects/${i}/position/2`]));
  assert.equal(result.afterContent, JSON.stringify(expectedModel(input))); counts.canonicalTargets += 128; parityInputs.push(input);
});
await run('one final budget permits early growth and later shrinking position tokens but rejects final overflow atomically', () => {
  const base = JSON.stringify(scene([box(1, [0, 0, 0]), box(2, [100000, 0, 0]), box(3, [-99999.99999999999, 0, 0])]));
  const content = base + ' '.repeat(128 * 1024 - Buffer.byteLength(base)); assert.equal(Buffer.byteLength(content), 128 * 1024);
  const input = request(content, [id(3), id(1), id(2)], id(2)), result = patch(input);
  assert.ok(Buffer.byteLength(result.afterContent) < Buffer.byteLength(content));
  assert.deepEqual(parsed(result.afterContent), expectedModel(input)); parityInputs.push(input);
  const overflow = request(content, [id(1), id(2)], id(2)); assert.throws(() => patch(overflow)); parityInputs.push(overflow);
});
await run('sixth private proposal captures detached source target reference and axis and rejects cloned or stale source applications', async () => {
  const content = text(scene()), source = snapshot(content), edit = { instanceIds: [id(3), id(1)], anchorInstanceId: id(3), axis: 'x' };
  const proposal = createScene3DAlignmentProposal(source, edit);
  assert.equal(isScene3DAlignmentProposal(proposal), true); assert.equal(isScene3DAlignmentProposal(structuredClone(proposal)), false);
  assert.ok(Object.isFrozen(proposal)); assert.ok(Object.isFrozen(proposal.instanceIds)); assert.ok(Object.isFrozen(proposal.beforeObjects));
  edit.instanceIds.reverse(); edit.anchorInstanceId = id(1); edit.axis = 'y'; source.content = 'mutated';
  assert.deepEqual(proposal.instanceIds, [id(1), id(3)]); assert.equal(proposal.anchorInstanceId, id(3)); assert.equal(proposal.axis, 'x');
  assert.equal((await prepareScene3DAlignmentApply(snapshot(content), proposal, { digest })).afterContent, proposal.afterContent);
  for (const change of [{ token: 'other' }, { sourcePath: 'documents/other.json' }, { content: content + ' ' },
    { sourceRevision: 'sha256:' + '0'.repeat(64) }, { baseSourceRevision: 'sha256:' + '0'.repeat(64) }])
    await assert.rejects(prepareScene3DAlignmentApply({ ...snapshot(content), ...change }, proposal, { digest }), { errorCode: 'scene3d_alignment_conflict' });
  await assert.rejects(prepareScene3DAlignmentApply(snapshot(content), structuredClone(proposal), { digest }), { errorCode: 'scene3d_alignment_conflict' });
});
await run('all five predecessor author brands and the new alignment brand remain isolated in both directions', async () => {
  const content = text(scene()), source = snapshot(content);
  const proposals = [createScene3DTransformProposal(source, { instanceId: id(1), values: { position: [8, 0, 0] } }),
    createScene3DObjectsProposal(source, { action: 'copy', instanceId: id(1), newInstanceId: id(99), name: 'Copy' }),
    createScene3DEnvironmentProposal(source, { values: { background: '#203040' } }),
    createScene3DPropertiesProposal(source, { instanceId: id(1), values: { color: '#abcdef' } }),
    createScene3DTranslationProposal(source, { instanceIds: [id(1)], offset: [1, 0, 0] })];
  for (const value of proposals) { assert.equal(isScene3DAlignmentProposal(value), false);
    await assert.rejects(prepareScene3DAlignmentApply(source, value, { digest }), { errorCode: 'scene3d_alignment_conflict' }); counts.pairwiseBrandDirections++; }
  const alignment = createScene3DAlignmentProposal(source, { instanceIds: [id(1), id(3)], anchorInstanceId: id(3), axis: 'x' });
  for (const prepare of [prepareScene3DTransformApply, prepareScene3DObjectsApply, prepareScene3DEnvironmentApply, prepareScene3DPropertiesApply, prepareScene3DTranslationApply]) {
    await assert.rejects(prepare(source, alignment, { digest })); counts.pairwiseBrandDirections++;
  }
});
await run('prepare captures caller DTO before digest await and does not reread later aliases', async () => {
  const content = text(scene()), source = snapshot(content);
  const proposal = createScene3DAlignmentProposal(source, { instanceIds: [id(1), id(3)], anchorInstanceId: id(3), axis: 'x' });
  let release; const gate = new Promise(resolve => { release = resolve; });
  const applied = prepareScene3DAlignmentApply(source, proposal, { digest: () => gate });
  source.content = 'mutated'; source.token = 'other'; release(sha(content));
  assert.equal((await applied).afterContent, proposal.afterContent);
});
await run('actual predecessor WASM disables only alignment while all five predecessor author operations remain usable', async () => {
  const old = await import(new URL('../../../engine/studio-core.mjs?alignment-old-quality=1', import.meta.url));
  await old.initializeStudioCore(() => fs.readFile(new URL('previous-studio-core.wasm', out)));
  assert.equal(old.supportsStudioCoreScene3D(), true); assert.equal(old.supportsStudioCoreScene3DAlignmentPatch(), false);
  const content = JSON.stringify(scene()); assert.throws(() => old.dispatchStudioCoreScene3DAlignmentPatch(request(content)), { errorCode: 'studio_core_unavailable' });
  for (const [dispatch, input] of [
    [old.dispatchStudioCoreScene3DPatch, { protocolVersion: 1, operation: 'scene3d.patchObjectTransform', content, instanceId: id(1), values: { position: [10, 0, 0] } }],
    [old.dispatchStudioCoreScene3DObjectsPatch, { protocolVersion: 1, operation: 'scene3d.patchObjects', content, action: 'copy', instanceId: id(1), newInstanceId: id(99), name: 'Copy' }],
    [old.dispatchStudioCoreScene3DEnvironmentPatch, { protocolVersion: 1, operation: 'scene3d.patchEnvironment', content, values: { background: '#203040' } }],
    [old.dispatchStudioCoreScene3DPropertiesPatch, { protocolVersion: 1, operation: 'scene3d.patchProperties', content, instanceId: id(1), values: { color: '#abcdef' } }],
    [old.dispatchStudioCoreScene3DTranslationPatch, { protocolVersion: 1, operation: 'scene3d.translateObjects', content, instanceIds: [id(1)], offset: [1, 0, 0] }],
  ]) { assert.equal(typeof dispatch, 'function'); assert.notEqual(dispatch(input).afterContent, content); counts.oldOperations++; }
});
let responseId = 0;
async function responseBridge(response, version = 1) {
  const module = await import(new URL(`../../../engine/studio-core.mjs?alignment-receipt-quality=${++responseId}`, import.meta.url));
  const memory = new WebAssembly.Memory({ initial: 40 }), instantiate = WebAssembly.instantiate;
  let inputLength = 0, outputLength = 0;
  try {
    WebAssembly.instantiate = async () => ({ instance: { exports: { memory, viento_core_protocol_version: () => 1,
      viento_core_scene3d_version: () => 1, ...(version === null ? {} : { viento_core_scene3d_alignment_version: () => version }),
      viento_core_input: length => { inputLength = length; return 16; }, viento_core_run: () => {
        const input = JSON.parse(new TextDecoder().decode(new Uint8Array(memory.buffer, 16, inputLength)));
        const value = input.operation === 'scene3d.alignObjects' ? structuredClone(response) : wasm(input);
        const bytes = new TextEncoder().encode(JSON.stringify(value)); outputLength = bytes.length;
        new Uint8Array(memory.buffer, 1048576, bytes.length).set(bytes); return 1048576;
      }, viento_core_output_len: () => outputLength,
    } } });
    await module.initializeStudioCore(() => new Uint8Array([1]));
  } finally { WebAssembly.instantiate = instantiate; }
  return module;
}
await run('complete receipts reject changed reference axis identity order paths and semantic-equivalent unauthorized raw normalization', async () => {
  const content = JSON.stringify(scene([box(1, [1, -1, 0]), box(2, [2, -2, 0]), box(3, [7, -3, 0])]));
  const input = request(content), response = wasm(input); assert.equal(response.ok, true);
  const mutations = [
    result => result.scene3dAlignmentPatch.instanceIds.reverse(), result => result.scene3dAlignmentPatch.instanceIds.pop(),
    result => result.scene3dAlignmentPatch.instanceIds.push(id(1)), result => result.scene3dAlignmentPatch.anchorInstanceId = id(1),
    result => result.scene3dAlignmentPatch.axis = 'y', result => result.scene3dAlignmentPatch.changedPaths.pop(),
    result => result.scene3dAlignmentPatch.changedPaths.push('/objects/2/position/0'), result => result.scene3dAlignmentPatch.beforeContent += ' ',
    result => result.scene3dAlignmentPatch.afterContent = result.scene3dAlignmentPatch.afterContent.replace('"far":1000', '"far":1e3'),
    result => result.scene3dAlignmentPatch.afterContent = result.scene3dAlignmentPatch.afterContent.replace('"position":[7,-1,0]', '"position":[7,-1.0,0]'),
    result => result.scene3dAlignmentPatch.afterContent = result.scene3dAlignmentPatch.afterContent.replace('"position":[2,-2,0]', '"position":[2.0,-2,0]'),
    result => result.scene3dAlignmentPatch.afterContent = result.scene3dAlignmentPatch.afterContent.replace('"position":[7,-1,0]', '"position":[7.0,-1,0]'),
    result => result.scene3dAlignmentPatch.afterContent = result.scene3dAlignmentPatch.afterContent.replace('"position":[7,-1,0]', '"position":[6,-1,0]'),
    result => result.scene3dAlignmentPatch.afterContent = result.scene3dAlignmentPatch.afterContent.replace('"near":0.05,"far":1000', '"far":1000,"near":0.05'),
    result => result.scene3dAlignmentPatch.extra = true,
  ];
  for (const mutate of mutations) { const bad = structuredClone(response); mutate(bad); assert.notDeepEqual(bad, response);
    const bridge = await responseBridge(bad); assert.throws(() => bridge.dispatchStudioCoreScene3DAlignmentPatch(input)); counts.forgedReceipts++; }
});
await run('absent or unsupported optional alignment probe leaves native parse available without author alignment authority', async () => {
  const content = JSON.stringify(scene()), input = request(content), response = wasm(input);
  for (const version of [null, 0, 2]) {
    const bridge = await responseBridge(response, version); assert.equal(bridge.supportsStudioCoreScene3D(), true);
    assert.equal(bridge.supportsStudioCoreScene3DAlignmentPatch(), false);
    assert.throws(() => bridge.dispatchStudioCoreScene3DAlignmentPatch(input), { errorCode: 'studio_core_unavailable' });
    assert.equal(bridge.dispatchStudioCoreScene3D({ protocolVersion: 1, operation: 'scene3d.parse', content }).model.objects.length, 3);
  }
});
async function nativeSequence(inputs) {
  const executable = process.env.VIENTO_STUDIO_CORE_BIN; assert.ok(executable, 'Parent must supply the fresh native CLI; reviewer does not build.');
  return new Promise((resolve, reject) => {
    const child = spawn(executable, [], { stdio: ['pipe', 'pipe', 'pipe'] }); let stdout = '', stderr = '', failure;
    const timer = setTimeout(() => { failure = Error('Native bounded parity timeout'); child.kill('SIGKILL'); }, 30000);
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', data => { stdout += data; if (Buffer.byteLength(stdout) > 16 * 1024 * 1024) { failure = Error('Native output budget'); child.kill('SIGKILL'); } });
    child.stderr.on('data', data => { stderr = (stderr + data).slice(-4096); }); child.stdin.on('error', error => { failure ||= error; });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', (code, signal) => { clearTimeout(timer); if (failure) return reject(failure);
      try { assert.equal(code, 0, stderr); assert.equal(signal, null); resolve(stdout.trim().split('\n').map(JSON.parse)); } catch (error) { reject(error); } });
    child.stdin.end(inputs.map(value => JSON.stringify(value)).join('\n') + '\n');
  });
}
await run('fresh native CLI and raw WASM have equal full receipts and failures for independently constructed bounded cases', async () => {
  const native = await nativeSequence(parityInputs); assert.equal(native.length, parityInputs.length);
  for (let i = 0; i < native.length; i++) assert.deepEqual(native[i], wasm(parityInputs[i])); counts.nativeParityRequests += parityInputs.length;
});
const endSources = await hashes(), output = process.argv[2]; assert.ok(output && /^[a-z0-9-]+\.json$/.test(output));
const nativeEndSha256 = sha(await fs.readFile(nativePath));
const report = { format: 'viento-scene3d-alignment-independent-quality', schemaVersion: 1, observedAt: new Date().toISOString(), node: process.version,
  ok: cases.every(item => item.ok) && JSON.stringify(beforeSources) === JSON.stringify(endSources) && nativeBeforeSha256 === nativeEndSha256, passed: cases.filter(item => item.ok).length,
  failed: cases.filter(item => !item.ok).length, cases, counts, sources: beforeSources, endSources,
  sourceStable: JSON.stringify(beforeSources) === JSON.stringify(endSources), wasm: { bytes: wasmBytes.length, sha256: sha(wasmBytes) },
  previousWasm: { sha256: sha(await fs.readFile(new URL('previous-studio-core.wasm', out))) },
  native: { path: nativePath, bytes: nativeBytes.length, beforeSha256: nativeBeforeSha256, endSha256: nativeEndSha256,
            stable: nativeBeforeSha256 === nativeEndSha256 },
  scope: 'Actual source/native/WASM/proposal quality in the authorized isolated stage; strict center/reference/world-axis, complete positions-only token scope, original/final budget and six private brands. No build, actual project modification, Save, renderer/GPU/backend/device/install or final repository application claimed.' };
await fs.writeFile(new URL(output, out), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
process.stdout.write(JSON.stringify({ ok: report.ok, passed: report.passed, failed: report.failed, counts, sourceStable: report.sourceStable, node: process.version }) + '\n');
if (!report.ok) process.exitCode = 1;
