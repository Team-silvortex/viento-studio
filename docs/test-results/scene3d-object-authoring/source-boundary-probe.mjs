// Independent read-only source/receipt checks against the actual current Rust
// core. No document save, engine/tool execution, build or author file writes.
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import '../../../scripts/adapters/node-studio-core.mjs';
import * as core from '../../../engine/studio-core.mjs';
import { parseScene3DSource } from '../../../engine/scene3d.mjs';
import { createScene3DObjectsProposal, isScene3DObjectsProposal, prepareScene3DObjectsApply } from '../../../engine/scene3d-objects.mjs';
import { createScene3DTransformProposal, isScene3DTransformProposal, prepareScene3DTransformApply } from '../../../engine/scene3d-transform.mjs';
const root = new URL('../../../', import.meta.url), clone = x => JSON.parse(JSON.stringify(x));
const hash = x => crypto.createHash('sha256').update(x).digest('hex');
const content = await fs.readFile(new URL('examples/scene3d/scene.json', root), 'utf8'), original = JSON.parse(content);
const bytes = await fs.readFile(new URL('engine/studio-core.wasm', root));
assert.equal(hash(bytes), 'ab5a10726a68967ed9782aa902ac1de44fc65e2dab96600fc83ecd8b8617ae53');
const fresh = 'aaaaaaaa-1111-4111-8111-111111111111', id = original.objects[1].instanceId;
const source = (raw = content) => ({ sourcePath: 'documents/scenes/boxes.json', token: 'load:4:draft:7', content: raw,
  baseSourceRevision: `sha256:${hash(content)}`, sourceRevision: `sha256:${hash(raw)}` });
const edit = (action = 'copy') => action === 'add' ? { action, object: { ...clone(original.objects[1]), instanceId: fresh, name: 'New 🦊' } }
  : action === 'copy' ? { action, instanceId: id, newInstanceId: fresh, name: original.objects[1].name } : { action, instanceId: id };
const request = (intent, raw = content) => ({ protocolVersion: 1, operation: 'scene3d.patchObjects', content: raw, ...intent });
const digest = async value => hash(value), checks = [];
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
async function check(id, run) { try { await run(); checks.push({ id, ok: true }); } catch (error) { checks.push({ id, ok: false, message: error.message }); } }
const rawObjects = raw => parseScene3DSource(raw).sourceLocations.objects.map(x => raw.slice(x.sourceRange.start, x.sourceRange.end));
const parseRaw = raw => JSON.parse(raw.replace(/^\uFEFF/, ''));
const serialize = value => '\uFEFF' + JSON.stringify(value, null, '\t').replaceAll('\n', '\r\n') + '\r\n \t';
await check('all-three-private-intents-are-deepfrozen-detached-and-net-count-bound', async () => {
  for (const action of ['add', 'copy', 'remove']) {
    const input = edit(action), proposal = createScene3DObjectsProposal(source(), input), saved = clone(proposal);
    if (action === 'add') input.object.position[0] = 999; else input.instanceId = fresh;
    assert.deepEqual(proposal, saved); assert(isScene3DObjectsProposal(proposal));
    assert(Object.isFrozen(proposal) && Object.isFrozen(proposal.edit) && Object.isFrozen(proposal.changedPaths));
    if (proposal.afterObject) assert(Object.isFrozen(proposal.afterObject.position));
    const result = await prepareScene3DObjectsApply(source(), proposal, { digest });
    assert.equal(result.afterContent, proposal.afterContent); assert.equal(parseScene3DSource(result.afterContent).model.objects.length, original.objects.length + (action === 'remove' ? -1 : 1));
    assert.deepEqual(proposal.changedPaths, [`/objects/${action === 'remove' ? 1 : 3}`]);
  }
});
await check('separate-transform-and-objects-brands-and-serialized-copies-cannot-cross-apply', async () => {
  const objects = createScene3DObjectsProposal(source(), edit()), transform = createScene3DTransformProposal(source(), { instanceId: id, values: { position: [5, 1.5, 0] } });
  assert(!isScene3DTransformProposal(objects) && !isScene3DObjectsProposal(transform));
  for (const value of [transform, clone(objects), { ...objects }, null]) await assert.rejects(prepareScene3DObjectsApply(source(), value, { digest }), { errorCode: 'scene3d_objects_conflict' });
  await assert.rejects(prepareScene3DTransformApply(source(), objects, { digest }), { errorCode: 'scene3d_transform_conflict' });
});
await check('copy-preserves-escaped-keys-names-exponents-signed-zero-subnormal-and-root-trivia', () => {
  const authored = clone(original); authored.objects[1].name = 'Name🦊'; authored.objects[1].rotationDegrees = [5e-324, -0, 25];
  const raw = serialize(authored).replace('"objects"', '"objec\\u0074s"').replaceAll('"instanceId"', '"ins\\u0074anceId"').replace('Name🦊', 'N\\u0061me🦊').replaceAll('-2,', '-2.000e0,').replaceAll('25', '2.5e1');
  const proposal = createScene3DObjectsProposal(source(raw), { ...edit(), name: 'Name🦊' }), old = rawObjects(raw), after = rawObjects(proposal.afterContent);
  assert.deepEqual(after.slice(0, 3), old);
  assert.equal(after[3], old[1].replace(JSON.stringify(id), JSON.stringify(fresh)));
  assert(proposal.afterContent.startsWith('\uFEFF') && proposal.afterContent.endsWith('\r\n \t'));
});
await check('copy-identity-like-name-does-not-confuse-property-value-occurrences', () => {
  const authored = clone(original); authored.objects[1].name = id; authored.objects[1].color = '#abcdef';
  const raw = serialize(authored), before = rawObjects(raw)[1];
  for (const name of [id, fresh, 'instanceId', 'name', 'color']) {
    const p = createScene3DObjectsProposal(source(raw), { ...edit(), name });
    const after = parseRaw(p.afterContent).objects[3]; assert.deepEqual(after, { ...authored.objects[1], instanceId: fresh, name });
    assert.deepEqual(rawObjects(p.afterContent).slice(0, 3), rawObjects(raw));
    if (name === id) assert.equal(rawObjects(p.afterContent)[3], before.replace(JSON.stringify(id), JSON.stringify(fresh)));
  }
});
await check('first-middle-last-removals-with-nonadjacent-separators-preserve-all-survivor-spans', () => {
  const spans = original.objects.map(x => JSON.stringify(x, null, '\t'));
  const raw = serialize(original).replace(/"objects":\s*\[[\s\S]*\]\s*}\r\n \t$/, '"objects": [\r\n  ' + spans.join('\r\n \t , \r\n  ') + '\r\n   ]\r\n}\r\n \t');
  assert(raw.includes('\r\n \t , \r\n'));
  for (let i = 0; i < 3; i++) {
    const p = createScene3DObjectsProposal(source(raw), { action: 'remove', instanceId: original.objects[i].instanceId });
    assert.deepEqual(rawObjects(p.afterContent), rawObjects(raw).filter((_, j) => i !== j));
    assert.deepEqual(parseRaw(p.afterContent).objects, original.objects.filter((_, j) => i !== j));
    assert.deepEqual(p.changedPaths, [`/objects/${i}`]); assert(p.afterContent.startsWith('\uFEFF') && p.afterContent.endsWith('\r\n \t'));
  }
});
await check('whole-original-and-final-count-and-byte-budgets-are-atomic', () => {
  const large = clone(original); large.objects = Array.from({ length: 128 }, (_, i) => ({ ...clone(original.objects[0]), instanceId: `${i.toString(16).padStart(8, '0')}-1111-4111-8111-111111111111` }));
  const raw128 = JSON.stringify(large);
  for (const e of [edit('add'), { ...edit(), instanceId: large.objects[0].instanceId }]) assert.throws(() => createScene3DObjectsProposal(source(raw128), e), { errorCode: 'scene3d_limit' });
  assert.equal(parseRaw(createScene3DObjectsProposal(source(raw128), { action: 'remove', instanceId: large.objects[0].instanceId }).afterContent).objects.length, 127);
  const exact = content + ' '.repeat(131072 - Buffer.byteLength(content));
  assert.throws(() => createScene3DObjectsProposal(source(exact), edit()), { errorCode: 'scene3d_limit' });
  assert(Buffer.byteLength(createScene3DObjectsProposal(source(exact), edit('remove')).afterContent) < 131072);
  assert.throws(() => createScene3DObjectsProposal(source(exact + ' '), edit('remove')), { errorCode: 'scene3d_limit' });
});
await check('last-object-invalid-unrelated-object-and-fresh-id-collision-reject-without-poisoning-core', () => {
  const one = clone(original); one.objects.splice(1); assert.throws(() => createScene3DObjectsProposal(source(JSON.stringify(one)), { action: 'remove', instanceId: one.objects[0].instanceId }), { errorCode: 'scene3d_objects_invalid' });
  const bad = clone(original); bad.objects[2].size[0] = 0;
  assert.throws(() => createScene3DObjectsProposal(source(JSON.stringify(bad)), edit('remove')), { errorCode: 'scene3d_invalid' });
  assert.throws(() => createScene3DObjectsProposal(source(), { ...edit(), newInstanceId: id }), { errorCode: 'scene3d_objects_invalid' });
  assert.equal(core.getStudioCoreMetadata().ready, true); assert.equal(parseScene3DSource(content).model.objects.length, 3);
});
await check('five-source-fields-must-match-before-digest-and-actual-sha-after-digest', async () => {
  const p = createScene3DObjectsProposal(source(), edit()); let calls = 0;
  for (const [key, value] of [['sourcePath', 'elsewhere.json'], ['token', 'reload'], ['baseSourceRevision', 'sha256:' + 'a'.repeat(64)], ['sourceRevision', 'sha256:' + 'b'.repeat(64)], ['content', content + ' ']])
    await assert.rejects(prepareScene3DObjectsApply({ ...source(), [key]: value }, p, { digest: async x => { calls++; return hash(x); } }), { errorCode: 'scene3d_objects_conflict' });
  assert.equal(calls, 0);
  for (const result of [hash(content).toUpperCase(), null, 'b'.repeat(64)]) await assert.rejects(prepareScene3DObjectsApply(source(), p, { digest: async () => result }), { errorCode: 'scene3d_objects_conflict' });
  const lying = { ...source(), sourceRevision: 'sha256:' + 'a'.repeat(64) }, claimed = createScene3DObjectsProposal(lying, edit());
  await assert.rejects(prepareScene3DObjectsApply(lying, claimed, { digest }), { errorCode: 'scene3d_objects_conflict' });
});
await check('preawait-detached-source-does-not-borrow-caller-mutation-or-authorize-host-write', async () => {
  const s = source(), p = createScene3DObjectsProposal(s, edit()), wait = deferred(), pending = prepareScene3DObjectsApply(s, p, { digest: () => wait.promise });
  s.content = 'mutated'; s.sourcePath = 'other.json'; s.token = 'reload'; wait.resolve(hash(content));
  const ready = await pending; assert.equal(ready.afterContent, p.afterContent); assert.equal(ready.sourcePath, p.sourcePath);
});
await check('source-and-edit-accessors-are-rejected-without-calling-them', () => {
  let invoked = 0; const s = source(); Object.defineProperty(s, 'token', { enumerable: true, get() { invoked++; return 'fake'; } });
  assert.throws(() => createScene3DObjectsProposal(s, edit()), { errorCode: 'scene3d_objects_invalid' });
  const e = edit(); Object.defineProperty(e, 'name', { enumerable: true, get() { invoked++; return 'fake'; } });
  assert.throws(() => createScene3DObjectsProposal(source(), e), { errorCode: 'scene3d_objects_invalid' }); assert.equal(invoked, 0);
});
const coreText = await fs.readFile(new URL('engine/studio-core.mjs', root), 'utf8');
async function isolated(mutator, overrideResponse) {
  const actual = await WebAssembly.instantiate(bytes, {}), exports = { ...actual.instance.exports }; mutator?.(exports);
  if (overrideResponse) {
    const run = exports.viento_core_run, length = exports.viento_core_output_len; let overriddenLength = null;
    exports.viento_core_output_len = () => overriddenLength ?? length();
    exports.viento_core_run = () => {
      overriddenLength = null; const start = run(), len = length();
      const reply = JSON.parse(new TextDecoder().decode(new Uint8Array(exports.memory.buffer, start, len)));
      if (!reply.scene3dObjectsPatch) return start;
      overrideResponse(reply); const encoded = new TextEncoder().encode(JSON.stringify(reply));
      const pointer = exports.viento_core_input(encoded.length); new Uint8Array(exports.memory.buffer, pointer, encoded.length).set(encoded);
      overriddenLength = encoded.length; return pointer;
    };
  }
  const context = vm.createContext({ TextEncoder, TextDecoder, WebAssembly: { Memory: WebAssembly.Memory, instantiate: async () => ({ instance: { exports } }) } });
  vm.runInContext(coreText.replace(/^export /gm, '') + '\nglobalThis.api={initializeStudioCore,supportsStudioCoreScene3D,supportsStudioCoreScene3DPatch,supportsStudioCoreScene3DObjectsPatch,dispatchStudioCoreScene3D,dispatchStudioCoreScene3DPatch,dispatchStudioCoreScene3DObjectsPatch,getStudioCoreMetadata};', context);
  await context.api.initializeStudioCore(async () => bytes); return context.api;
}
for (const variant of ['absent', 'unsupported']) await check(`objects-cap-${variant}-keeps-actual-old-parse-and-transform-ready`, async () => {
  const api = await isolated(ex => { if (variant === 'absent') delete ex.viento_core_scene3d_objects_version; else ex.viento_core_scene3d_objects_version = () => 2; });
  assert.equal(api.supportsStudioCoreScene3DObjectsPatch(), false); assert.equal(api.supportsStudioCoreScene3DPatch(), true);
  assert.equal(api.dispatchStudioCoreScene3D({ protocolVersion: 1, operation: 'scene3d.parse', content }).model.objects.length, 3);
  const transform = api.dispatchStudioCoreScene3DPatch({ protocolVersion: 1, operation: 'scene3d.patchObjectTransform', content, instanceId: id, values: { position: [5, 1.5, 0] } });
  assert.notEqual(transform.afterContent, content); assert.throws(() => api.dispatchStudioCoreScene3DObjectsPatch(request(edit())), { errorCode: 'studio_core_unavailable' }); assert.equal(api.getStudioCoreMetadata().ready, true);
});
for (const [variant, mutate] of [
  ['wrong-copy-source', r => { r.scene3dObjectsPatch.sourceInstanceId = original.objects[0].instanceId; }],
  ['wrong-net-path', r => { r.scene3dObjectsPatch.changedPaths = ['/objects/1']; }],
  ['semantic-old-object-change', r => { const p = parseRaw(r.scene3dObjectsPatch.afterContent); p.objects[0].position[0]++; r.scene3dObjectsPatch.afterContent = JSON.stringify(p); }],
  ['lexical-root-normalization', r => { r.scene3dObjectsPatch.afterContent += ' '; }],
]) await check(`tampered-native-receipt-${variant}-cannot-become-proposal`, async () => {
  const api = await isolated(null, mutate); assert.throws(() => api.dispatchStudioCoreScene3DObjectsPatch(request(edit())), { errorCode: 'studio_core_unavailable' }); assert.equal(api.getStudioCoreMetadata().ready, false);
});
let nativeParityRequests = 0, nativeSha256 = null;
await check('independent-native-wasm-ten-wire-cases-exact-parity', async () => {
  const file = new URL('desktop/.cache/scene3d-objects-core-target/debug/viento-core', root); nativeSha256 = hash(await fs.readFile(file));
  const inputs = [request(edit('add')), request(edit()), ...original.objects.map(o => request({ action: 'remove', instanceId: o.instanceId })),
    request({ ...edit(), newInstanceId: id }), { ...request(edit()), offset: [0, 0, 0] }, request({ ...edit(), instanceId: fresh }),
    JSON.stringify(request(edit('add'))).replace('"action":"add"', '"action":"add","act\\u0069on":"copy"'),
    { protocolVersion: 1, operation: 'scene3d.patchObjectTransform', content, instanceId: id, values: { position: [5, 1.5, 0] } }];
  const raw = inputs.map(x => typeof x === 'string' ? x : JSON.stringify(x));
  const child = spawnSync(file.pathname, [], { input: raw.join('\n') + '\n', encoding: 'utf8', timeout: 5000, maxBuffer: 4 * 1024 * 1024 });
  assert.equal(child.status, 0); assert.equal(child.stderr, ''); const native = child.stdout.trim().split('\n').map(JSON.parse);
  const actual = await WebAssembly.instantiate(bytes, {}), ex = actual.instance.exports;
  const wasm = raw.map(x => { const encoded = new TextEncoder().encode(x), p = ex.viento_core_input(encoded.length); new Uint8Array(ex.memory.buffer, p, encoded.length).set(encoded); const out = ex.viento_core_run(), len = ex.viento_core_output_len(); return JSON.parse(new TextDecoder().decode(new Uint8Array(ex.memory.buffer, out, len))); });
  assert.deepEqual(native, wasm); nativeParityRequests = inputs.length; assert.equal(nativeParityRequests, 10);
});
const reviewedSources = {}; for (const name of ['engine/scene3d-objects.mjs', 'engine/scene3d-authoring.mjs', 'engine/scene3d-transform.mjs', 'engine/studio-core.mjs', 'crates/viento-studio-core/src/scene3d_objects_patch.rs', 'web/modules/app-runtime.js', 'web/modules/app-studio-system.js']) reviewedSources[name] = hash(await fs.readFile(new URL(name, root)));
const report = { format: 'viento-scene3d-objects-independent-source-boundary', schemaVersion: 1, runtime: process.version, reviewedSources,
  wasm: { bytes: bytes.length, sha256: hash(bytes) }, native: { path: 'desktop/.cache/scene3d-objects-core-target/debug/viento-core', sha256: nativeSha256 }, checks,
  passed: checks.filter(x => x.ok).length, failed: checks.filter(x => !x.ok).length, nativeParityRequests,
  scope: 'Actual Rust-backed pure proposal checks, actual WASM isolated capabilities and tampered receipt delivery, native CLI exact parity. No browser, renderer, external engine, ordinary Save, installation or device claim. Detached prepare deliberately requires the application host to recheck current ownership.' };
assert(process.argv[2], 'NEW report path required'); await fs.writeFile(process.argv[2], JSON.stringify(report, null, 2) + '\n', { flag: 'wx' }); console.log(JSON.stringify(report, null, 2)); if (report.failed) process.exitCode = 1;
