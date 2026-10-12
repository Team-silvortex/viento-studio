import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createScene3DTransformProposal, prepareScene3DTransformApply, isScene3DTransformProposal } from '../../engine/scene3d-transform.mjs';

const original = '\ufeff' + (await fs.readFile(new URL('../../examples/scene3d/scene.json', import.meta.url), 'utf8')).replaceAll('\n', '\r\n');
const model = JSON.parse(original.slice(1));
const hash = value => createHash('sha256').update(value).digest('hex');
const snapshot = (overrides = {}) => ({ sourcePath: 'documents/scenes/scene.json', token: '3:7:1:1', content: original,
  baseSourceRevision: `sha256:${hash(original)}`, sourceRevision: `sha256:${hash(original)}`, ...overrides });
const edit = (values = { position: [3, 4, 5] }) => ({ instanceId: model.objects[0].instanceId, values });
const proposal = () => createScene3DTransformProposal(snapshot(), edit());
const conflict = failure => failure?.errorCode === 'scene3d_transform_conflict';

test('review changes only selected primitive transforms and preserves original source bytes and other objects', async () => {
  const before = snapshot(), p = createScene3DTransformProposal(before, edit({ position: [3, 4, 5], rotationDegrees: [1, 2, 3] }));
  const after = JSON.parse(p.afterContent.slice(1));
  assert.equal(p.beforeContent, original); assert.ok(p.afterContent.startsWith('\ufeff')); assert.ok(p.afterContent.includes('\r\n'));
  assert.deepEqual(after.objects.slice(1), model.objects.slice(1)); assert.equal(after.objects[0].instanceId, model.objects[0].instanceId);
  assert.deepEqual(after.objects[0].size, model.objects[0].size); assert.deepEqual(after.camera, model.camera); assert.deepEqual(after.light, model.light);
  assert.equal(Object.isFrozen(p), true); assert.equal(Object.isFrozen(p.values.position), true); assert.equal(Object.isFrozen(p.afterObject), true);
  const ready = await prepareScene3DTransformApply(before, p, { digest: hash });
  assert.equal(ready.afterContent, p.afterContent); assert.equal(Object.isFrozen(ready.changedPaths), true); assert.equal(before.content, original);
});
test('empty and unchanged edits cannot acquire apply authority', () => {
  assert.throws(() => createScene3DTransformProposal(snapshot(), edit({})), failure => failure.errorCode === 'studio_core_request_invalid');
  assert.throws(() => createScene3DTransformProposal(snapshot(), edit({ size: model.objects[0].size })), failure => failure.errorCode === 'scene3d_transform_unchanged');
});
test('serialized or forged proposals cannot apply and malicious getters are never read', async () => {
  const p = proposal(); assert.equal(isScene3DTransformProposal(p), true); assert.equal(isScene3DTransformProposal(structuredClone(p)), false);
  for (const fake of [structuredClone(p), { ...p }, null, Object.create(p)]) await assert.rejects(prepareScene3DTransformApply(snapshot(), fake, { digest: hash }), conflict);
  let reads = 0; const evil = Object.defineProperty({}, 'afterContent', { get() { reads++; throw Error('getter'); } });
  assert.equal(isScene3DTransformProposal(evil), false); await assert.rejects(prepareScene3DTransformApply(snapshot(), evil, { digest: hash }), conflict); assert.equal(reads, 0);
});
test('ownership binds path, current token, current source and saved source revision independently', async () => {
  const p = proposal();
  for (const overrides of [{ sourcePath: 'documents/other.json' }, { token: 'new-session' }, { content: original + ' ' },
    { baseSourceRevision: `sha256:${'0'.repeat(64)}` }, { sourceRevision: `sha256:${'1'.repeat(64)}` }]) {
    await assert.rejects(prepareScene3DTransformApply(snapshot(overrides), p, { digest: hash }), conflict);
  }
});
test('digest must confirm raw source bytes and may not return an invalid or different hash', async () => {
  const p = proposal();
  for (const wrong of ['', hash(original).toUpperCase(), '0'.repeat(64), null]) await assert.rejects(prepareScene3DTransformApply(snapshot(), p, { digest: async () => wrong }), conflict);
});
test('caller source DTO is captured before the digest await', async () => {
  const current = snapshot(), p = proposal(); let release;
  const pending = prepareScene3DTransformApply(current, p, { digest: async value => { await new Promise(resolve => { release = resolve; }); return hash(value); } });
  current.content = 'changed caller object'; current.token = 'changed'; release();
  assert.equal((await pending).afterContent, p.afterContent);
});
test('source DTO rejects noncanonical paths, unknown members, accessors and invalid revision claims', () => {
  for (const sourcePath of ['/scene.json', '../scene.json', 'documents//scene.json', 'documents\\scene.json', 'documents/scene.md', 'documents/./scene.json']) {
    assert.throws(() => createScene3DTransformProposal(snapshot({ sourcePath }), edit()), failure => failure.errorCode === 'scene3d_transform_invalid');
  }
  for (const value of [snapshot({ extra: true }), snapshot({ sourceRevision: '' }), snapshot({ token: '' })]) assert.throws(() => createScene3DTransformProposal(value, edit()));
  let read = false; const value = snapshot(); Object.defineProperty(value, 'content', { enumerable: true, get() { read = true; return original; } });
  assert.throws(() => createScene3DTransformProposal(value, edit())); assert.equal(read, false);
});
test('caller changes to selected values after review cannot change the candidate', async () => {
  const values = { position: [3, 4, 5] }, p = createScene3DTransformProposal(snapshot(), edit(values));
  values.position[0] = 999; values.size = [999, 999, 999]; assert.equal(p.values.position[0], 3); assert.equal(p.values.size, undefined);
  assert.equal((await prepareScene3DTransformApply(snapshot(), p, { digest: hash })).afterContent, p.afterContent);
});
