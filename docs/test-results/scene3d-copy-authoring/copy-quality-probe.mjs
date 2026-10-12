// Independent stage-only evidence. No build, server, Save or product writes.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import * as core from '../../../engine/studio-core.mjs';
import * as copy from '../../../engine/scene3d-copy.mjs';
import * as transform from '../../../engine/scene3d-transform.mjs';
import * as objects from '../../../engine/scene3d-objects.mjs';
import * as environment from '../../../engine/scene3d-environment.mjs';
import * as properties from '../../../engine/scene3d-properties.mjs';
import * as translation from '../../../engine/scene3d-translation.mjs';
import * as alignment from '../../../engine/scene3d-alignment.mjs';
import * as distribution from '../../../engine/scene3d-distribution.mjs';
import { parseJsonSource, locateJsonSource } from '../../../engine/json-source.mjs';
import { runCopyCases } from './boundary-cases.mjs';

const root = new URL('../../../', import.meta.url), out = new URL('./', import.meta.url);
const sha = value => createHash('sha256').update(value).digest('hex');
const sourcePaths = ['engine/studio-core.mjs', 'engine/scene3d-copy.mjs', 'engine/scene3d-authoring.mjs',
  'web/modules/app-runtime.js', 'web/modules/app-studio-system.js', 'crates/viento-studio-core/src/scene3d_copy_patch.rs'];
const hashes = async () => Object.fromEntries(await Promise.all(sourcePaths.map(async path => [path, sha(await fs.readFile(new URL(path, root)))])));
const beforeSources = await hashes(), wasmBytes = await fs.readFile(new URL('engine/studio-core.wasm', root));
const nativePath = process.env.VIENTO_STUDIO_CORE_BIN;
assert.ok(nativePath, 'Root must supply the frozen native CLI; reviewer never builds.');
const nativeBytes = await fs.readFile(nativePath), nativeBeforeSha256 = sha(nativeBytes);
await core.initializeStudioCore(() => wasmBytes);
const { instance } = await WebAssembly.instantiate(wasmBytes, {}), raw = instance.exports;
const cases = [], parityInputs = [], counts = { nativeParityRequests: 0, forgedReceipts: 0, oldOperations: 0,
  pairwiseBrandDirections: 0, sharedPortableGroups: 0, independentGroups: 0 };
async function run(name, fn) { try { await fn(); cases.push({ name, ok: true, scope: 'independent' }); }
  catch (error) { cases.push({ name, ok: false, scope: 'independent', error: error.stack || String(error) }); } counts.independentGroups++; }
try {
  const portable = await runCopyCases({ realmJson: JSON.parse, digest: sha, parseJsonSource, locateJsonSource,
    ...core, ...copy, ...transform, ...objects, ...environment, ...properties, ...translation, ...alignment, ...distribution });
  assert.equal(portable.length, 8); cases.push(...portable.map(value => ({ ...value, name: value.id, scope: 'shared-portable-source-execution' })));
  counts.sharedPortableGroups = portable.length; counts.pairwiseBrandDirections = 14;
} catch (error) { cases.push({ name: 'shared-portable-eight-groups-incomplete', ok: false, scope: 'shared-portable-source-execution', error: error.stack || String(error) }); }
const id = n => `${n.toString(16).padStart(8, '0')}-1111-4111-8111-111111111111`;
const box = (n, position = [n, -n, n / 4]) => ({ instanceId: id(n), name: `Box ${n} 🦊`, primitive: 'box', position,
  rotationDegrees: [n * 7.25, 25 - n * 3, -n * 1.25], size: [n / 8 + .001, 3, n / 3 + .001], color: '#aB89CD' });
const scene = (values = [box(1, [1, 2, 3]), box(2, [2, -7, 5]), box(3, [7, 0, 0])]) => ({ format: 'viento-scene3d', schemaVersion: 1,
  name: '原文复制 / raw copy / 複製 🦊', viewport: [800, 600], background: '#142538',
  camera: { position: [8, 6, 8], target: [0, 0, 0], fovDegrees: 60, near: .05, far: 1000 },
  light: { direction: [-1, -2, -1], color: '#FFFFFF', energy: 1 }, objects: values });
const text = value => '\uFEFF' + JSON.stringify(value, null, '\t').replaceAll('\n', '\r\n') + '\r\n \t';
const parsed = content => JSON.parse(content.replace(/^\uFEFF/, ''));
const pair = (n, next = n + 100) => ({ sourceInstanceId: id(n), newInstanceId: id(next) });
const request = (content, copies = [pair(3, 102), pair(1, 103)], offset = [1, 0, -2]) => ({ protocolVersion: 1, operation: 'scene3d.copyObjects', content, copies, offset });
const patch = input => core.dispatchStudioCoreScene3DCopyPatch(input);
const location = (content, pointer) => { const result = locateJsonSource(parseJsonSource(content), pointer); assert.equal(result?.exact, true); return result; };
const replace = (content, pointer, token) => { const range = location(content, pointer); return content.slice(0, range.start) + token + content.slice(range.end); };
function wasm(input) {
  const bytes = new TextEncoder().encode(typeof input === 'string' ? input : JSON.stringify(input)), pointer = raw.viento_core_input(bytes.length) >>> 0;
  new Uint8Array(raw.memory.buffer, pointer, bytes.length).set(bytes);
  const output = raw.viento_core_run() >>> 0, length = raw.viento_core_output_len();
  return JSON.parse(new TextDecoder('utf8', { fatal: true }).decode(new Uint8Array(raw.memory.buffer, output, length)));
}
function expected(input) {
  const original = parsed(input.content), array = location(input.content, '/objects'), first = location(input.content, '/objects/0'),
    last = location(input.content, `/objects/${original.objects.length - 1}`), padding = input.content.slice(array.start + 1, first.start);
  const map = new Map(input.copies.map(item => [item.sourceInstanceId, item.newInstanceId])), canonical = [], clones = [];
  for (let index = 0; index < original.objects.length; index++) {
    const object = original.objects[index]; if (!map.has(object.instanceId)) continue;
    const range = location(input.content, `/objects/${index}`), identity = location(input.content, `/objects/${index}/instanceId`);
    const changes = [{ start: identity.start - range.start, end: identity.end - range.start, token: JSON.stringify(map.get(object.instanceId)) }];
    for (let axis = 0; axis < 3; axis++) {
      const value = object.position[axis] + input.offset[axis];
      if (value !== object.position[axis]) { const coordinate = location(input.content, `/objects/${index}/position/${axis}`);
        changes.push({ start: coordinate.start - range.start, end: coordinate.end - range.start, token: JSON.stringify(value) }); }
    }
    let clone = input.content.slice(range.start, range.end);
    for (const change of changes.sort((a, b) => b.start - a.start)) clone = clone.slice(0, change.start) + change.token + clone.slice(change.end);
    clones.push(clone); canonical.push({ sourceInstanceId: object.instanceId, newInstanceId: map.get(object.instanceId) });
  }
  return { afterContent: input.content.slice(0, last.end) + clones.map(clone => ',' + padding + clone).join('') + input.content.slice(last.end),
    canonical, paths: clones.map((_, index) => `/objects/${original.objects.length + index}`), point: last.end, clones };
}
await run('independent whole raw spans and one insertion preserve every original byte across all three offsets', () => {
  let content = text(scene()).replace('"objects"', '"objec\\u0074s"').replaceAll('"position"', '"posi\\u0074ion"')
    .replaceAll('"instanceId"', '"instanc\\u0065Id"').replace('1000', '1.000e3');
  content = replace(content, '/objects/0/name', '"Box \\u0031 🦊"'); content = replace(content, '/objects/0/position/1', '2.000e0');
  for (const offset of [[-3.25, 0, 0], [0, .125, 0], [0, 0, 17.5], [0, 0, 0], [5e-324, 0, 0]]) {
    const input = request(content, undefined, offset), result = patch(input), want = expected(input);
    assert.equal(result.afterContent, want.afterContent); assert.deepEqual(result.copies, want.canonical); assert.deepEqual(result.changedPaths, want.paths);
    const original = parsed(content), after = parsed(result.afterContent); assert.deepEqual(after.objects.slice(0, original.objects.length), original.objects);
    for (let index = 0; index < original.objects.length; index++) {
      const beforeRange = location(content, `/objects/${index}`), afterRange = location(result.afterContent, `/objects/${index}`);
      assert.equal(result.afterContent.slice(afterRange.start, afterRange.end), content.slice(beforeRange.start, beforeRange.end));
    }
    parityInputs.push(input);
  }
  for (const sign of [-1, 1]) { const input = request(JSON.stringify(scene([box(1, [-sign * 100000, 0, 0])])), [pair(1)], [sign * 200000, 0, 0]);
    assert.equal(parsed(patch(input).afterContent).objects[1].position[0], sign * 100000); parityInputs.push(input); }
});
await run('strict raw request failures never expose a partial structural receipt', () => {
  const content = JSON.stringify(scene()), valid = request(content), invalid = [request(content, []), request(content, [pair(1), pair(1, 104)]),
    request(content, [pair(1), pair(2, 101)]), request(content, [pair(1, 2)]), request(content, [pair(99)]), request(content, null),
    request(content, [{ ...pair(1), extra: true }]), request(content, [pair(1)], [200001, 0, 0]), request(content, [pair(1)], [0, 0]),
    request(content, [pair(1)], [0, '0', 0]), { ...valid, unknown: true }, { ...valid, content: content + 'invalid' }];
  const full = scene(Array.from({ length: 128 }, (_, index) => box(index + 1, [index, 0, 0])));
  invalid.push(request(JSON.stringify(full), [pair(1, 500)]));
  const wire = JSON.stringify(valid);
  invalid.push(wire.replace('"protocolVersion":1', '"protocolVersion":1,"protocolVersion":1'),
    wire.replace('"offset":[1,0,-2]', '"offset":[1,0,-2],"offset":[1,0,-2]'),
    wire.replace('"sourceInstanceId":', '"sourceInstanceId":"' + id(3) + '","sourceInstanceId":'));
  for (const input of invalid) {
    const receipt = wasm(input); assert.equal(receipt.ok, false); assert.equal(Object.hasOwn(receipt, 'scene3dCopyPatch'), false);
    if (typeof input !== 'string') assert.throws(() => patch(input)); parityInputs.push(input);
  }
});
await run('actual predecessor WASM admits all seven prior author domains and grants no batch copy authority', async () => {
  const old = await import(new URL('../../../engine/studio-core.mjs?copy-previous-quality=1', import.meta.url));
  await old.initializeStudioCore(() => fs.readFile(new URL('previous-studio-core.wasm', out)));
  assert.equal(old.supportsStudioCoreScene3D(), true); assert.equal(old.supportsStudioCoreScene3DCopyPatch(), false);
  const content = JSON.stringify(scene()); assert.throws(() => old.dispatchStudioCoreScene3DCopyPatch(request(content)), { errorCode: 'studio_core_unavailable' });
  for (const [dispatch, input] of [
    [old.dispatchStudioCoreScene3DPatch, { protocolVersion: 1, operation: 'scene3d.patchObjectTransform', content, instanceId: id(1), values: { position: [10, 0, 0] } }],
    [old.dispatchStudioCoreScene3DObjectsPatch, { protocolVersion: 1, operation: 'scene3d.patchObjects', content, action: 'copy', instanceId: id(1), newInstanceId: id(99), name: 'Copy' }],
    [old.dispatchStudioCoreScene3DEnvironmentPatch, { protocolVersion: 1, operation: 'scene3d.patchEnvironment', content, values: { background: '#203040' } }],
    [old.dispatchStudioCoreScene3DPropertiesPatch, { protocolVersion: 1, operation: 'scene3d.patchProperties', content, instanceId: id(1), values: { color: '#abcdef' } }],
    [old.dispatchStudioCoreScene3DTranslationPatch, { protocolVersion: 1, operation: 'scene3d.translateObjects', content, instanceIds: [id(1)], offset: [1, 0, 0] }],
    [old.dispatchStudioCoreScene3DAlignmentPatch, { protocolVersion: 1, operation: 'scene3d.alignObjects', content, instanceIds: [id(1), id(3)], anchorInstanceId: id(3), axis: 'x' }],
    [old.dispatchStudioCoreScene3DDistributionPatch, { protocolVersion: 1, operation: 'scene3d.distributeObjects', content, instanceIds: [id(3), id(1), id(2)], axis: 'x' }],
  ]) { assert.notEqual(dispatch(input).afterContent, content); counts.oldOperations++; }
});
let responseId = 0;
async function responseBridge(response, version = 1, onRun) {
  const module = await import(new URL(`../../../engine/studio-core.mjs?copy-receipt-quality=${++responseId}`, import.meta.url));
  const memory = new WebAssembly.Memory({ initial: 40 }), instantiate = WebAssembly.instantiate; let inputLength = 0, outputLength = 0;
  try {
    WebAssembly.instantiate = async () => ({ instance: { exports: { memory, viento_core_protocol_version: () => 1, viento_core_scene3d_version: () => 1,
      ...(version === null ? {} : { viento_core_scene3d_copy_version: () => version }),
      viento_core_input: length => { inputLength = length; return 16; }, viento_core_run: () => {
        const input = JSON.parse(new TextDecoder().decode(new Uint8Array(memory.buffer, 16, inputLength)));
        const value = input.operation === 'scene3d.copyObjects' ? structuredClone(response) : wasm(input);
        if (input.operation === 'scene3d.copyObjects') onRun?.(input);
        const bytes = new TextEncoder().encode(JSON.stringify(value)); outputLength = bytes.length;
        new Uint8Array(memory.buffer, 1048576, bytes.length).set(bytes); return 1048576;
      }, viento_core_output_len: () => outputLength,
    } } });
    await module.initializeStudioCore(() => new Uint8Array([1]));
  } finally { WebAssembly.instantiate = instantiate; }
  return module;
}
await run('complete receipts bind mapping positions original spans clone string and numeric slots with immutable keys and gaps', async () => {
  const named = scene(); named.objects[0].name = named.objects[0].instanceId; named.objects[0].position = [1, 2, 3];
  named.objects[0].rotationDegrees = [1, 2, 3]; named.objects[0].size = [1, 2, 3];
  const input = request(JSON.stringify(named)), response = wasm(input); assert.equal(response.ok, true);
  const after = response.scene3dCopyPatch.afterContent, count = named.objects.length;
  const mutateAfter = fn => result => { result.scene3dCopyPatch.afterContent = fn(result.scene3dCopyPatch.afterContent); };
  const reorderClone = fn => content => { const range = location(content, '/objects/3'), raw = content.slice(range.start, range.end), changed = fn(raw);
    assert.notEqual(changed, raw); return content.slice(0, range.start) + changed + content.slice(range.end); };
  const swapBlocks = (raw, keyA, keyB) => { const expression = new RegExp('"' + keyA + '":(\\[[^\\]]+\\]|"[^"\\n]+"),' + '"' + keyB + '":(\\[[^\\]]+\\]|"[^"\\n]+")');
    return raw.replace(expression, (_, a, b) => '"' + keyB + '":' + b + ',"' + keyA + '":' + a); };
  const mutations = [
    result => result.scene3dCopyPatch.copies.reverse(), result => result.scene3dCopyPatch.copies.pop(),
    result => result.scene3dCopyPatch.copies[0].newInstanceId = id(999), result => result.scene3dCopyPatch.copies[0].sourceInstanceId = id(2),
    result => result.scene3dCopyPatch.offset[0]++, result => result.scene3dCopyPatch.beforeContent += ' ',
    result => result.scene3dCopyPatch.changedPaths.pop(), result => result.scene3dCopyPatch.changedPaths[0] = '/objects/0',
    result => result.scene3dCopyPatch.changedPaths[0] = '/objects/3/position/0', result => result.scene3dCopyPatch.extra = true,
    result => result.extra = true, result => result.protocolVersion = 2,
    mutateAfter(content => replace(content, '/camera/far', '1e3')),
    mutateAfter(content => replace(content, '/objects/0/position/0', '1.0')),
    mutateAfter(content => replace(content, '/objects/3/position/0', '2.0')),
    mutateAfter(content => replace(content, '/objects/3/position/1', '2.0')),
    mutateAfter(content => replace(content, '/objects/3/position/0', '3')),
    mutateAfter(content => replace(content, '/objects/3/rotationDegrees/0', '1.0')),
    mutateAfter(content => replace(content, '/objects/3/name', JSON.stringify('Renamed'))),
    mutateAfter(content => replace(content, '/objects/3/name', '"\\u0030' + id(1).slice(1) + '"')),
    mutateAfter(content => replace(content, '/objects/3/instanceId', '"\\u0030' + id(103).slice(1) + '"')),
    mutateAfter(reorderClone(raw => swapBlocks(raw, 'instanceId', 'name'))),
    mutateAfter(reorderClone(raw => swapBlocks(raw, 'position', 'rotationDegrees'))),
    mutateAfter(reorderClone(raw => raw.replace('"position":', '"posi\\u0074ion":'))),
    mutateAfter(reorderClone(raw => raw.replace('"primitive":"box",', '"primitive" : "box",'))),
    mutateAfter(content => content + ' '),
    mutateAfter(content => { const original = location(content, '/objects/0'), other = location(content, '/objects/1');
      return content.slice(0, original.start) + content.slice(other.start, other.end) + content.slice(original.end, other.start)
        + content.slice(original.start, original.end) + content.slice(other.end); }),
    mutateAfter(content => { const a = location(content, '/objects/3'), b = location(content, '/objects/4');
      return content.slice(0, a.start) + content.slice(b.start, b.end) + content.slice(a.end, b.start) + content.slice(a.start, a.end) + content.slice(b.end); }),
  ];
  assert.equal(parsed(after).objects.length, count + 2);
  for (const mutate of mutations) { const bad = structuredClone(response); mutate(bad); assert.notDeepEqual(bad, response);
    const bridge = await responseBridge(bad); assert.throws(() => bridge.dispatchStudioCoreScene3DCopyPatch(input)); counts.forgedReceipts++; }
});
await run('optional copy probe is independent from old object edit ABI and unsupported versions never acquire authority', async () => {
  const input = request(JSON.stringify(scene())), response = wasm(input);
  for (const version of [null, 0, 2]) { const bridge = await responseBridge(response, version);
    assert.equal(bridge.supportsStudioCoreScene3D(), true); assert.equal(bridge.supportsStudioCoreScene3DCopyPatch(), false);
    assert.throws(() => bridge.dispatchStudioCoreScene3DCopyPatch(input), { errorCode: 'studio_core_unavailable' });
    assert.equal(bridge.dispatchStudioCoreScene3D({ protocolVersion: 1, operation: 'scene3d.parse', content: input.content }).model.objects.length, 3); }
  const bridge = await responseBridge(response, 1); assert.equal(bridge.supportsStudioCoreScene3DObjectsPatch(), false);
  assert.equal(bridge.supportsStudioCoreScene3DCopyPatch(), true); assert.deepEqual(bridge.dispatchStudioCoreScene3DCopyPatch(input), response.scene3dCopyPatch);
});
await run('bridge captures caller mapping and offsets before native invocation without granting alias writes', async () => {
  const input = request(JSON.stringify(scene())), original = structuredClone(input), response = wasm(input);
  const bridge = await responseBridge(response, 1, nativeInput => { assert.deepEqual(nativeInput, original);
    input.copies.reverse(); input.copies[0].newInstanceId = id(999); input.offset[0] = 99; input.content = 'late caller content'; });
  assert.deepEqual(bridge.dispatchStudioCoreScene3DCopyPatch(input), response.scene3dCopyPatch);
  assert.notDeepEqual(input, original);
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
await run('fresh raw native CLI and WASM agree on every bounded full success and failure response', async () => {
  const native = await nativeSequence(parityInputs); assert.equal(native.length, parityInputs.length);
  for (let index = 0; index < native.length; index++) assert.deepEqual(native[index], wasm(parityInputs[index])); counts.nativeParityRequests = parityInputs.length;
});
const endSources = await hashes(), output = process.argv[2]; assert.ok(output && /^[a-z0-9-]+\.json$/.test(output));
const nativeEndSha256 = sha(await fs.readFile(nativePath));
const report = { format: 'viento-scene3d-copy-independent-quality', schemaVersion: 1, observedAt: new Date().toISOString(), node: process.version,
  ok: cases.every(item => item.ok) && JSON.stringify(beforeSources) === JSON.stringify(endSources) && nativeBeforeSha256 === nativeEndSha256,
  passed: cases.filter(item => item.ok).length, failed: cases.filter(item => !item.ok).length, cases, counts, sources: beforeSources, endSources,
  sourceStable: JSON.stringify(beforeSources) === JSON.stringify(endSources), wasm: { bytes: wasmBytes.length, sha256: sha(wasmBytes) },
  previousWasm: { sha256: sha(await fs.readFile(new URL('previous-studio-core.wasm', out))) },
  native: { path: nativePath, bytes: nativeBytes.length, beforeSha256: nativeBeforeSha256, endSha256: nativeEndSha256, stable: nativeBeforeSha256 === nativeEndSha256 },
  overlap: 'Eight of fifteen groups repeat this round portable boundary cases against actual source modules; these executions are not disjoint coverage.',
  scope: 'Independent controlled stage-only raw source/native/WASM/complete receipt and eight-brand checks. No build, service, actual checkout writes, Save, GPU/backend/device/install or final apply claimed.' };
await fs.writeFile(new URL(output, out), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
process.stdout.write(JSON.stringify({ ok: report.ok, passed: report.passed, failed: report.failed, counts, sourceStable: report.sourceStable, node: process.version }) + '\n');
if (!report.ok) process.exitCode = 1;
