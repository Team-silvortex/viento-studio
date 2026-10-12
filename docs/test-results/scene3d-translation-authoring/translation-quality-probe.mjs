import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as core from '../../../engine/studio-core.mjs';
import { createScene3DTranslationProposal, isScene3DTranslationProposal, prepareScene3DTranslationApply } from '../../../engine/scene3d-translation.mjs';
import { createScene3DTransformProposal } from '../../../engine/scene3d-transform.mjs';
import { createScene3DObjectsProposal } from '../../../engine/scene3d-objects.mjs';
import { createScene3DEnvironmentProposal } from '../../../engine/scene3d-environment.mjs';
import { createScene3DPropertiesProposal } from '../../../engine/scene3d-properties.mjs';

const root = new URL('../../../', import.meta.url), out = new URL('./', import.meta.url);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const sourcePaths = ['engine/studio-core.mjs', 'engine/scene3d-translation.mjs', 'engine/scene3d-authoring.mjs',
  'web/modules/app-runtime.js', 'web/modules/app-studio-system.js', 'crates/viento-studio-core/src/scene3d_translation_patch.rs'];
const hashes = async () => Object.fromEntries(await Promise.all(sourcePaths.map(async p => [p, sha(await fs.readFile(new URL(p, root)))])));
const beforeSources = await hashes(), wasmBytes = await fs.readFile(new URL('engine/studio-core.wasm', root));
await core.initializeStudioCore(() => wasmBytes);
const { instance } = await WebAssembly.instantiate(wasmBytes, {}), raw = instance.exports;
const cases = [], counts = { canonicalTargets: 0, nativeParityRequests: 0, forgedReceipts: 0, oldOperations: 0 };
async function run(name, fn) { try { await fn(); cases.push({ name, ok: true }); } catch (e) { cases.push({ name, ok: false, error: e.stack || String(e) }); } }
const id = n => `${n.toString(16).padStart(8, '0')}-1111-4111-8111-111111111111`;
const box = (n, position = [n, -n, 0]) => ({ instanceId: id(n), name: `Box ${n} 🦊`, primitive: 'box', position,
  rotationDegrees: [0, 25, -0], size: [1.5, 3, .001], color: '#aB89CD' });
const scene = (objects = [box(1), box(2), box(3)]) => ({ format: 'viento-scene3d', schemaVersion: 1, name: 'Raw / 原文 / 変換 🦊',
  viewport: [800, 600], background: '#142538', camera: { position: [8, 6, 8], target: [0, 0, 0], fovDegrees: 60, near: .05, far: 1000 },
  light: { direction: [-1, -2, -1], color: '#FFFFFF', energy: 1 }, objects });
const text = data => '\uFEFF' + JSON.stringify(data, null, '\t').replaceAll('\n', '\r\n') + '\r\n \t';
const parsed = content => JSON.parse(content.replace(/^\uFEFF/, ''));
const request = (content, instanceIds = [id(1), id(3)], offset = [2.5, -1, 4]) => ({ protocolVersion: 1, operation: 'scene3d.translateObjects', content, instanceIds, offset });
const patch = input => core.dispatchStudioCoreScene3DTranslationPatch(input);
function wasm(input) {
  const encoded = new TextEncoder().encode(typeof input === 'string' ? input : JSON.stringify(input));
  const ptr = raw.viento_core_input(encoded.length) >>> 0; new Uint8Array(raw.memory.buffer, ptr, encoded.length).set(encoded);
  const output = raw.viento_core_run() >>> 0, length = raw.viento_core_output_len();
  return JSON.parse(new TextDecoder('utf8', { fatal: true }).decode(new Uint8Array(raw.memory.buffer, output, length)));
}
const snapshot = (content, baseline = content) => ({ sourcePath: 'documents/scenes/translation.json', token: 'session:1', content,
  baseSourceRevision: 'sha256:' + sha(baseline), sourceRevision: 'sha256:' + sha(content) });
const digest = async value => sha(value);
function expectedModel(input) {
  const data = parsed(input.content), selected = new Set(input.instanceIds);
  for (const object of data.objects) if (selected.has(object.instanceId)) object.position = object.position.map((v, i) => v + input.offset[i]);
  return data;
}
const parityInputs = [];
await run('full mixed lexical source keeps all non-position tokens and canonical source order independently of request order', () => {
  let content = text(scene([box(1, [-20.125, 11.25, 0]), box(2), box(3, [9.125, -2.25, 1])]));
  content = content.replace('"objects"', '"objec\\u0074s"').replaceAll('"position"', '"posi\\u0074ion"').replace('1000', '1.000e3');
  content = content.replace('-20.125,', '-20.125e0,').replace('9.125,', '9.125e0,');
  const input = request(content, [id(3), id(1)]), original = JSON.stringify(input), result = patch(input);
  assert.deepEqual(parsed(result.afterContent), expectedModel(input)); assert.equal(result.beforeContent, content);
  assert.deepEqual(result.instanceIds, [id(1), id(3)]); assert.deepEqual(result.offset, input.offset);
  const vector = values => '[\r\n\t\t\t\t' + values.join(',\r\n\t\t\t\t') + '\r\n\t\t\t]';
  const expected = content.replace(vector(['-20.125e0', '11.25', '0']), vector(['-17.625', '10.25', '4']))
    .replace(vector(['9.125e0', '-2.25', '1']), vector(['11.625', '-3.25', '5']));
  assert.equal(result.afterContent, expected, 'Two independently identified position triplets are the complete raw byte change');
  assert.ok(result.afterContent.includes('1.000e3')); assert.ok(result.afterContent.includes('posi\\u0074ion'));
  assert.equal(JSON.stringify(input), original); assert.equal(result.changedPaths.length, 6);
  assert.deepEqual(result.changedPaths, ['/objects/0/position/0', '/objects/0/position/1', '/objects/0/position/2',
    '/objects/2/position/0', '/objects/2/position/1', '/objects/2/position/2']);
  counts.canonicalTargets += 2; parityInputs.push(input);
});
await run('zero and representationally unchanged offsets retain every original byte and are not approvable', () => {
  const content = text(scene()).replace('1000', '1e3').replace('"energy": 1', '"energy": 1.00e0');
  const result = patch(request(content, [id(3), id(1)], [0, -0, 0]));
  assert.equal(result.afterContent, content); assert.deepEqual(result.changedPaths, []); assert.deepEqual(result.instanceIds, [id(1), id(3)]);
  assert.throws(() => createScene3DTranslationProposal(snapshot(content), { instanceIds: [id(3), id(1)], offset: [0, 0, 0] }), { errorCode: 'scene3d_translation_unchanged' });
  parityInputs.push(request(content, [id(3), id(1)], [0, -0, 0]));
});
await run('subnormal offset allows partial no-net positions while retaining every requested source-ordered UUID', () => {
  const content = JSON.stringify(scene([box(1, [100000, 0, 0]), box(2, [0, 0, 0])]));
  const result = patch(request(content, [id(2), id(1)], [5e-324, 0, 0]));
  assert.deepEqual(result.instanceIds, [id(1), id(2)]); assert.deepEqual(result.changedPaths, ['/objects/1/position/0']);
  assert.equal(parsed(result.afterContent).objects[0].position[0], 100000); assert.equal(parsed(result.afterContent).objects[1].position[0], 5e-324);
  assert.equal(result.afterContent, content.replace('"position":[0,0,0]', '"position":[5e-324,0,0]'));
  parityInputs.push(request(content, [id(2), id(1)], [5e-324, 0, 0]));
});
await run('entire old plus offset bounds are checked atomically for all target axes', () => {
  for (const sign of [-1, 1]) {
    const content = JSON.stringify(scene([box(1, [-sign * 100000, 0, 0])]));
    const input = request(content, [id(1)], [sign * 200000, 0, 0]);
    assert.equal(parsed(patch(input).afterContent).objects[0].position[0], sign * 100000); parityInputs.push(input);
  }
  const bad = request(JSON.stringify(scene([box(1, [-100000, 0, 0]), box(2, [0, 0, 0])])), [id(1), id(2)], [200000, 0, 0]);
  const before = JSON.stringify(bad); assert.throws(() => patch(bad)); assert.equal(JSON.stringify(bad), before);
  const response = wasm(bad); assert.equal(response.ok, false); assert.equal(Object.hasOwn(response, 'scene3dTranslationPatch'), false); parityInputs.push(bad);
});
await run('empty duplicated unknown oversized target lists and malformed offset triplets cannot produce a partial patch', () => {
  const content = JSON.stringify(scene());
  for (const instanceIds of [[], [id(1), id(1)], [id(1), id(99)], Array(129).fill(id(1)), null, id(1)]) assert.throws(() => patch(request(content, instanceIds)));
  for (const offset of [[], [1, 2], [1, 2, 3, 4], [200001, 0, 0], [-200001, 0, 0], [NaN, 0, 0], [Infinity, 0, 0], [null, 0, 0], ['1', 0, 0], null]) assert.throws(() => patch(request(content, [id(1)], offset)));
  parityInputs.push(request(content, [id(1), id(1)]), request(content, [id(99)]), request(content, [id(1)], [200001, 0, 0]));
});
await run('128 targets and 384 net axes are applied once in author declaration order without touching rotation size or environment', () => {
  const data = scene(Array.from({ length: 128 }, (_, i) => box(i + 1, [i * 13, -i * 7, i / 4]))), content = JSON.stringify(data);
  const input = request(content, data.objects.map(o => o.instanceId).reverse(), [1, -2, 3]), result = patch(input);
  assert.deepEqual(result.instanceIds, data.objects.map(o => o.instanceId)); assert.deepEqual(parsed(result.afterContent), expectedModel(input));
  assert.equal(result.changedPaths.length, 384);
  assert.deepEqual(result.changedPaths, data.objects.flatMap((o, i) => [0, 1, 2].map(axis => `/objects/${i}/position/${axis}`)));
  assert.equal(result.afterContent, JSON.stringify(expectedModel(input))); counts.canonicalTargets += 128; parityInputs.push(input);
});
await run('final byte budget permits a first growing target with a later shrinking target and rejects final overflow', () => {
  const base = JSON.stringify(scene([box(1, [0, 0, 0]), box(2, [-100000, 0, 0])]));
  const content = base + ' '.repeat(128 * 1024 - Buffer.byteLength(base));
  assert.equal(Buffer.byteLength(content), 128 * 1024);
  const input = request(content, [id(1), id(2)], [100000, 0, 0]), result = patch(input);
  assert.equal(Buffer.byteLength(result.afterContent), Buffer.byteLength(content) - 1);
  assert.deepEqual(parsed(result.afterContent), expectedModel(input)); parityInputs.push(input);
  const overflow = request(content, [id(1)], [100000, 0, 0]); assert.throws(() => patch(overflow)); parityInputs.push(overflow);
});
await run('translation proposals are detached deeply frozen private-brand candidates and source guards are exact', async () => {
  const content = text(scene()), source = snapshot(content), edit = { instanceIds: [id(3), id(1)], offset: [2.5, -1, 4] };
  const proposal = createScene3DTranslationProposal(source, edit); assert.equal(isScene3DTranslationProposal(proposal), true);
  assert.equal(isScene3DTranslationProposal(JSON.parse(JSON.stringify(proposal))), false); assert.equal(Object.isFrozen(proposal), true);
  assert.equal(Object.isFrozen(proposal.instanceIds), true); assert.equal(Object.isFrozen(proposal.offset), true);
  edit.instanceIds.reverse(); edit.offset[0] = 9; source.content = 'changed'; assert.deepEqual(proposal.instanceIds, [id(1), id(3)]); assert.equal(proposal.offset[0], 2.5);
  const applied = await prepareScene3DTranslationApply(snapshot(content), proposal, { digest }); assert.equal(applied.afterContent, proposal.afterContent);
  for (const change of [{ token: 'other' }, { sourcePath: 'documents/other.json' }, { content: content + ' ' }, { sourceRevision: 'sha256:' + '0'.repeat(64) }, { baseSourceRevision: 'sha256:' + '0'.repeat(64) }])
    await assert.rejects(prepareScene3DTranslationApply({ ...snapshot(content), ...change }, proposal, { digest }), { errorCode: 'scene3d_translation_conflict' });
  await assert.rejects(prepareScene3DTranslationApply(snapshot(content), JSON.parse(JSON.stringify(proposal)), { digest }), { errorCode: 'scene3d_translation_conflict' });
});
await run('four older authoring brands do not authorize translation application', async () => {
  const content = text(scene()), source = snapshot(content);
  const older = [createScene3DTransformProposal(source, { instanceId: id(1), values: { position: [8, 0, 0] } }),
    createScene3DObjectsProposal(source, { action: 'copy', instanceId: id(1), newInstanceId: id(9), name: 'Copy' }),
    createScene3DEnvironmentProposal(source, { values: { background: '#203040' } }),
    createScene3DPropertiesProposal(source, { instanceId: id(1), values: { color: '#abcdef' } })];
  for (const value of older) { assert.equal(isScene3DTranslationProposal(value), false); await assert.rejects(prepareScene3DTranslationApply(source, value, { digest }), { errorCode: 'scene3d_translation_conflict' }); }
});
await run('prepare captures caller snapshot before digest await and never rereads a later alias', async () => {
  const content = text(scene()), source = snapshot(content), proposal = createScene3DTranslationProposal(source, { instanceIds: [id(1)], offset: [1, 0, 0] });
  let release; const gate = new Promise(resolve => { release = resolve; });
  const promise = prepareScene3DTranslationApply(source, proposal, { digest: () => gate });
  source.content = 'mutated'; source.token = 'new'; release(sha(content));
  const result = await promise; assert.equal(result.afterContent, proposal.afterContent); assert.equal(result.sourcePath, 'documents/scenes/translation.json');
});
await run('previous real WASM disables only the new translation ABI while all four older edit operations remain usable', async () => {
  const old = await import(new URL('../../../engine/studio-core.mjs?translation-old-core-quality=1', import.meta.url));
  await old.initializeStudioCore(() => fs.readFile(new URL('previous-studio-core.wasm', out)));
  assert.equal(old.supportsStudioCoreScene3D(), true); assert.equal(old.supportsStudioCoreScene3DTranslationPatch(), false);
  const content = JSON.stringify(scene()); assert.throws(() => old.dispatchStudioCoreScene3DTranslationPatch(request(content)), { errorCode: 'studio_core_unavailable' });
  const requests = [
    [old.dispatchStudioCoreScene3DPatch, { protocolVersion: 1, operation: 'scene3d.patchObjectTransform', content, instanceId: id(1), values: { position: [10, 0, 0] } }],
    [old.dispatchStudioCoreScene3DObjectsPatch, { protocolVersion: 1, operation: 'scene3d.patchObjects', content, action: 'copy', instanceId: id(1), newInstanceId: id(9), name: 'Copy' }],
    [old.dispatchStudioCoreScene3DEnvironmentPatch, { protocolVersion: 1, operation: 'scene3d.patchEnvironment', content, values: { background: '#203040' } }],
    [old.dispatchStudioCoreScene3DPropertiesPatch, { protocolVersion: 1, operation: 'scene3d.patchProperties', content, instanceId: id(1), values: { color: '#abcdef' } }],
  ];
  for (const [dispatch, input] of requests) { assert.equal(typeof dispatch, 'function'); const result = dispatch(input); assert.notEqual(result.afterContent, content); counts.oldOperations++; }
});
let responseId = 0;
async function responseBridge(response, version = 1) {
  const module = await import(new URL(`../../../engine/studio-core.mjs?translation-quality-response=${++responseId}`, import.meta.url));
  const memory = new WebAssembly.Memory({ initial: 40 }), instantiate = WebAssembly.instantiate;
  let inputLength = 0, outputLength = 0;
  try {
    WebAssembly.instantiate = async () => ({ instance: { exports: { memory, viento_core_protocol_version: () => 1,
      viento_core_scene3d_version: () => 1, ...(version === null ? {} : { viento_core_scene3d_translation_version: () => version }),
      viento_core_input: length => { inputLength = length; return 16; }, viento_core_run: () => {
        const input = JSON.parse(new TextDecoder().decode(new Uint8Array(memory.buffer, 16, inputLength)));
        const value = input.operation === 'scene3d.translateObjects' ? structuredClone(response) : wasm(input);
        const bytes = new TextEncoder().encode(JSON.stringify(value)); outputLength = bytes.length;
        new Uint8Array(memory.buffer, 1048576, bytes.length).set(bytes); return 1048576;
      }, viento_core_output_len: () => outputLength,
    } } });
    await module.initializeStudioCore(() => new Uint8Array([1]));
  } finally { WebAssembly.instantiate = instantiate; }
  return module;
}
await run('whole candidate receipts reject incorrect identity order paths offsets and unauthorized numerically-equal raw normalization', async () => {
  const content = JSON.stringify(scene()), input = request(content, [id(3), id(1)], [1, 0, 0]), response = wasm(input);
  assert.equal(response.ok, true);
  const mutations = [
    r => r.scene3dTranslationPatch.instanceIds.reverse(),
    r => r.scene3dTranslationPatch.instanceIds.pop(),
    r => r.scene3dTranslationPatch.instanceIds.push(id(1)),
    r => r.scene3dTranslationPatch.offset[0] = 2,
    r => r.scene3dTranslationPatch.changedPaths.reverse(),
    r => r.scene3dTranslationPatch.changedPaths.pop(),
    r => r.scene3dTranslationPatch.changedPaths.push('/objects/1/position/0'),
    r => r.scene3dTranslationPatch.beforeContent += ' ',
    r => r.scene3dTranslationPatch.afterContent = r.scene3dTranslationPatch.afterContent.replace('"far":1000', '"far":1e3'),
    r => r.scene3dTranslationPatch.afterContent = r.scene3dTranslationPatch.afterContent.replace('"size":[1.5,3,0.001]', '"size":[1.50,3,0.001]'),
    r => r.scene3dTranslationPatch.afterContent = r.scene3dTranslationPatch.afterContent.replace('"position":[2,-1,0]', '"position":[2,-1.0,0]'),
    r => r.scene3dTranslationPatch.afterContent = r.scene3dTranslationPatch.afterContent.replace('"position":[2,-1,0]', '"position":[3,-1,0]'),
    r => r.scene3dTranslationPatch.extra = true,
  ];
  for (const mutate of mutations) {
    const bad = structuredClone(response); mutate(bad); assert.notDeepEqual(bad, response);
    const bridge = await responseBridge(bad); assert.throws(() => bridge.dispatchStudioCoreScene3DTranslationPatch(input)); counts.forgedReceipts++;
  }
});
await run('missing unsupported optional translation versions reject only the new operation while keeping native parse available', async () => {
  const content = JSON.stringify(scene()), input = request(content), response = wasm(input);
  for (const version of [null, 0, 2]) {
    const bridge = await responseBridge(response, version); assert.equal(bridge.supportsStudioCoreScene3D(), true);
    assert.equal(bridge.supportsStudioCoreScene3DTranslationPatch(), false);
    assert.throws(() => bridge.dispatchStudioCoreScene3DTranslationPatch(input), { errorCode: 'studio_core_unavailable' });
    const parsed = bridge.dispatchStudioCoreScene3D({ protocolVersion: 1, operation: 'scene3d.parse', content });
    assert.equal(parsed.model.objects.length, 3);
  }
});

async function nativeSequence(inputs) {
  const executable = process.env.VIENTO_STUDIO_CORE_BIN; assert.ok(executable, 'Parent must provide the fresh CLI path; no build performed by this reviewer.');
  return await new Promise((resolve, reject) => {
    const child = spawn(executable, [], { stdio: ['pipe', 'pipe', 'pipe'] }); let stdout = '', stderr = '', failure;
    const timer = setTimeout(() => { failure = Error('Native bounded parity timeout'); child.kill('SIGKILL'); }, 30000);
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', s => { stdout += s; if (Buffer.byteLength(stdout) > 16 * 1024 * 1024) { failure = Error('Native output budget'); child.kill('SIGKILL'); } });
    child.stderr.on('data', s => { stderr = (stderr + s).slice(-4096); }); child.stdin.on('error', e => { failure ||= e; });
    child.once('error', e => { clearTimeout(timer); reject(e); }); child.once('close', (code, signal) => { clearTimeout(timer); if (failure) return reject(failure);
      try { assert.equal(code, 0, stderr); assert.equal(signal, null); resolve(stdout.trim().split('\n').map(JSON.parse)); } catch (e) { reject(e); } });
    child.stdin.end(inputs.map(x => JSON.stringify(x)).join('\n') + '\n');
  });
}
await run('fresh native CLI and direct raw WASM return equal complete receipts and failures for all independently constructed cases', async () => {
  const native = await nativeSequence(parityInputs); assert.equal(native.length, parityInputs.length);
  for (let i = 0; i < native.length; i++) assert.deepEqual(native[i], wasm(parityInputs[i])); counts.nativeParityRequests += parityInputs.length;
});
const afterSources = await hashes(), output = process.argv[2]; assert.ok(output && /^[a-z0-9-]+\.json$/.test(output));
const report = { format: 'viento-scene3d-translation-independent-quality', schemaVersion: 1, observedAt: new Date().toISOString(), node: process.version,
  ok: cases.every(c => c.ok) && JSON.stringify(beforeSources) === JSON.stringify(afterSources), passed: cases.filter(c => c.ok).length,
  failed: cases.filter(c => !c.ok).length, cases, counts, sources: beforeSources, endSources: afterSources,
  sourceStable: JSON.stringify(beforeSources) === JSON.stringify(afterSources), wasm: { bytes: wasmBytes.length, sha256: sha(wasmBytes) },
  previousWasm: { sha256: sha(await fs.readFile(new URL('previous-studio-core.wasm', out))) },
  scope: 'Actual native-authoritative WASM bridge and pure proposals, fresh native CLI parity, exact byte budget/lexical/identity/private-brand and snapshot quality checks. No product modification, build, deletion, actual editor/Save, GPU, backend execution or device/install claim; host/session integration is independently checked separately.' };
await fs.writeFile(new URL(output, out), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ ok: report.ok, passed: report.passed, failed: report.failed, counts, sourceStable: report.sourceStable, node: process.version }));
for (const c of cases.filter(c => !c.ok)) console.error(c.name + '\n' + c.error); process.exitCode = report.ok ? 0 : 1;
