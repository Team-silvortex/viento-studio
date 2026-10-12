// Bounded normal-authoring quality proof: exact string edits, complete source
// admission, atomic final budget and native/WASM agreement. No builds or Save.
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import '../../../scripts/adapters/node-studio-core.mjs';
import { parseScene3DSource } from '../../../engine/scene3d.mjs';
import { dispatchStudioCoreScene3DPropertiesPatch } from '../../../engine/studio-core.mjs';
import { createScene3DPropertiesProposal, prepareScene3DPropertiesApply } from '../../../engine/scene3d-properties.mjs';

const root = new URL('../../../', import.meta.url), hash = value => createHash('sha256').update(value).digest('hex');
const content = await fs.readFile(new URL('examples/scene3d/scene.json', root), 'utf8');
const original = JSON.parse(content), selected = original.objects[1], instanceId = selected.instanceId, checks = [], wireRequests = [];
const source = raw => ({ sourcePath: 'documents/scene.json', token: 'load:4:draft:7', content: raw,
  baseSourceRevision: `sha256:${hash(content)}`, sourceRevision: `sha256:${hash(raw)}` });
const request = (raw, values, id = instanceId) => ({ protocolVersion: 1, operation: 'scene3d.patchProperties', content: raw, instanceId: id, values });
const native = new URL('desktop/.cache/scene3d-property-core-target/debug/viento-core', root);
const bytes = await fs.readFile(new URL('engine/studio-core.wasm', root));
const spans = raw => parseScene3DSource(raw).sourceLocations.objects.map(item => raw.slice(item.sourceRange.start, item.sourceRange.end));
const unchangedExcept = (before, after, index, values) => {
  const expected = structuredClone(parseScene3DSource(before).model); Object.assign(expected.objects[index], values);
  assert.deepEqual(parseScene3DSource(after).model, expected);
  assert.deepEqual(spans(after).filter((_, i) => i !== index), spans(before).filter((_, i) => i !== index));
};
async function check(id, run) {
  try { await run(); checks.push({ id, ok: true }); }
  catch (error) { checks.push({ id, ok: false, message: error.message, errorCode: error.errorCode }); }
}
const oldNameToken = '"To\\u0077er · 方柱"', oldColorToken = '"#87d8\\u00629"';
const raw = '\ufeff' + content.replaceAll('\n', '\r\n')
  .replaceAll('"name"', '"na\\u006de"').replaceAll('"color"', '"co\\u006cor"')
  .replace(JSON.stringify(selected.name), oldNameToken).replace(JSON.stringify(selected.color), oldColorToken)
  .replace(JSON.stringify(instanceId), '"\\u0034' + instanceId.slice(1) + '"')
  .replace('"fovDegrees": 50', '"fovDegrees": 5.0e1').replace('"energy": 1.2', '"energy": 1.200e0') + ' \t';

await check('name-and-color-change-only-the-selected-value-tokens-in-complete-original-text', async () => {
  const values = { color: '#AbCdEf', name: '  新名 / 名前 / 🦊 "quote" \\ \n\t\0\u2028  ' };
  const p = createScene3DPropertiesProposal(source(raw), { instanceId, values });
  const expected = raw.replace(oldNameToken, JSON.stringify(values.name)).replace(oldColorToken, JSON.stringify(values.color));
  assert.equal(p.afterContent, expected); assert.equal(p.beforeContent, raw);
  assert.deepEqual(p.changedPaths, ['/objects/1/name', '/objects/1/color']);
  unchangedExcept(raw, p.afterContent, 1, values);
  assert.equal((await prepareScene3DPropertiesApply(source(raw), p, { digest: async value => hash(value) })).afterContent, expected);
  wireRequests.push(request(raw, values));
});

await check('decoded-noop-retains-escaped-keys-values-identity-and-numeric-lexemes-without-an-approval', () => {
  const values = { name: selected.name, color: selected.color }, patched = dispatchStudioCoreScene3DPropertiesPatch(request(raw, values));
  assert.equal(patched.afterContent, raw); assert.deepEqual(patched.changedPaths, []);
  assert.throws(() => createScene3DPropertiesProposal(source(raw), { instanceId, values }), { errorCode: 'scene3d_properties_unchanged' });
  const mixed = { color: '#123456', name: selected.name }, next = dispatchStudioCoreScene3DPropertiesPatch(request(raw, mixed));
  assert.deepEqual(next.changedPaths, ['/objects/1/color']); assert.equal(next.afterContent, raw.replace(oldColorToken, '"#123456"'));
  wireRequests.push(request(raw, values), request(raw, mixed));
});

await check('case-only-color-is-explicit-author-intent-and-name-whitespace-is-never-normalized', () => {
  for (const values of [{ color: selected.color.toUpperCase() }, { name: ' \t ' }]) {
    const next = dispatchStudioCoreScene3DPropertiesPatch(request(raw, values));
    assert.equal(next.changedPaths.length, 1); unchangedExcept(raw, next.afterContent, 1, values);
    for (const [key, value] of Object.entries(values)) assert.equal(parseScene3DSource(next.afterContent).model.objects[1][key], value);
    wireRequests.push(request(raw, values));
  }
});

await check('stable-uuid-targets-first-middle-and-last-objects-without-reordering-or-changing-environment', () => {
  for (let index = 0; index < original.objects.length; index++) {
    const id = original.objects[index].instanceId, values = { color: '#010203', name: `Object ${index} 🦊` };
    const next = dispatchStudioCoreScene3DPropertiesPatch(request(raw, values, id));
    assert.deepEqual(next.changedPaths, [`/objects/${index}/name`, `/objects/${index}/color`]);
    unchangedExcept(raw, next.afterContent, index, values); wireRequests.push(request(raw, values, id));
  }
});

await check('existing-schema-admits-256-unicode-codepoints-and-rejects-invalid-names-colors-or-targets', () => {
  const valid = { name: '🦊'.repeat(256) }, next = dispatchStudioCoreScene3DPropertiesPatch(request(raw, valid));
  unchangedExcept(raw, next.afterContent, 1, valid); wireRequests.push(request(raw, valid));
  for (const values of [{ name: '🦊'.repeat(257) }, { name: '' }, { color: '#12345' }]) {
    assert.throws(() => dispatchStudioCoreScene3DPropertiesPatch(request(raw, values)), { errorCode: 'scene3d_properties_invalid' });
    wireRequests.push(request(raw, values));
  }
  const missingId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
  assert.throws(() => dispatchStudioCoreScene3DPropertiesPatch(request(raw, { name: 'Other' }, missingId)), { errorCode: 'scene3d_properties_invalid' });
  wireRequests.push(request(raw, { name: 'Other' }, missingId));
});

await check('one-final-name-and-color-candidate-uses-the-final-utf8-budget-without-intermediate-growth-refusal', () => {
  const compactColor = '"#\\u0038\\u0037\\u0064\\u0038\\u0062\\u0039"';
  const paddedBase = raw.replace(oldColorToken, compactColor);
  const exact = paddedBase + ' '.repeat(128 * 1024 - Buffer.byteLength(paddedBase));
  assert.equal(Buffer.byteLength(exact), 128 * 1024);
  const values = { name: 'Tower expanded slightly', color: '#abcdef' };
  const next = dispatchStudioCoreScene3DPropertiesPatch(request(exact, values));
  assert(Buffer.byteLength(next.afterContent) <= 128 * 1024); unchangedExcept(exact, next.afterContent, 1, values);
  assert.throws(() => dispatchStudioCoreScene3DPropertiesPatch(request(exact, { name: values.name })), { errorCode: 'scene3d_limit' });
  wireRequests.push(request(exact, values), request(exact, { name: values.name }));
});

await check('proposals-detach-all-author-values-and-source-before-await-and-freeze-full-before-after-objects', async () => {
  const captured = source(raw), edit = { instanceId, values: { name: 'Detached 🦊', color: '#Ff00aA' } };
  const p = createScene3DPropertiesProposal(captured, edit), expected = p.afterContent;
  edit.instanceId = original.objects[0].instanceId; edit.values.name = 'Later'; edit.values.color = '#000000';
  assert.equal(p.instanceId, instanceId); assert.deepEqual(p.values, { name: 'Detached 🦊', color: '#Ff00aA' });
  assert(Object.isFrozen(p) && Object.isFrozen(p.values) && Object.isFrozen(p.beforeObject.position) && Object.isFrozen(p.afterObject));
  let release; const pending = prepareScene3DPropertiesApply(captured, p, { digest: () => new Promise(resolve => { release = resolve; }) });
  captured.content = 'later'; captured.sourcePath = 'documents/later.json'; captured.token = 'reload';
  release(hash(raw)); const result = await pending;
  assert.equal(result.afterContent, expected); assert.equal(result.sourcePath, 'documents/scene.json');
  wireRequests.push(request(raw, p.values));
});

await check('each-original-source-must-pass-complete-scene-admission-before-any-property-candidate', () => {
  const invalid = structuredClone(original); invalid.camera.near = invalid.camera.far;
  const before = JSON.stringify(invalid);
  assert.throws(() => dispatchStudioCoreScene3DPropertiesPatch(request(before, { name: 'Other' })), { errorCode: 'scene3d_invalid' });
  wireRequests.push(request(before, { name: 'Other' }));
});

let nativeRequests = 0;
await check('all-quality-cases-have-identical-native-and-raw-wasm-wire-results', async () => {
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
for (const path of ['engine/scene3d-authoring.mjs', 'engine/scene3d-properties.mjs', 'engine/studio-core.mjs',
  'crates/viento-studio-core/src/scene3d_properties_patch.rs', 'web/modules/app-runtime.js', 'web/modules/app-studio-system.js']) {
  reviewedSources[path] = hash(await fs.readFile(new URL(path, root)));
}
const report = { format: 'viento-scene3d-property-independent-source-quality', schemaVersion: 1, runtime: process.version,
  ok: checks.every(item => item.ok), checks, passed: checks.filter(item => item.ok).length, failed: checks.filter(item => !item.ok).length,
  nativeRequests, native: { path: native.pathname, sha256: hash(await fs.readFile(native)) },
  wasm: { bytes: bytes.length, sha256: hash(bytes) }, reviewedSources,
  scope: 'Actual Rust-backed property edits and prepare, literal source retention, unchanged other objects/environment, source snapshot detachment, complete original/final schema and UTF-8 budgets, actual native/WASM results. No hostile-response injection, browser, rendering, Save, engine execution, installation, device or security-sandbox claim.' };
assert(process.argv[2], 'a NEW output path is required');
await fs.writeFile(process.argv[2], JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify(report, null, 2)); if (!report.ok) process.exitCode = 1;
