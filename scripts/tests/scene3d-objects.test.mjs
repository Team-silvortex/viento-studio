import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { parseJsonSource, locateJsonSource } from '../../engine/json-source.mjs';
import { createScene3DObjectsProposal, prepareScene3DObjectsApply, isScene3DObjectsProposal } from '../../engine/scene3d-objects.mjs';
import { createScene3DTransformProposal, isScene3DTransformProposal, prepareScene3DTransformApply } from '../../engine/scene3d-transform.mjs';

const model = JSON.parse(await fs.readFile(new URL('../../examples/scene3d/scene.json', import.meta.url), 'utf8'));
const serialize = value => '\ufeff' + JSON.stringify(value, null, '\t').replaceAll('\n', '\r\n') + '\r\n';
const original = serialize(model), hash = value => createHash('sha256').update(value).digest('hex');
const uuid = n => `${n.toString(16).padStart(8, '0')}-1111-4111-8111-111111111111`;
const source = (content = original) => ({ sourcePath: 'documents/scene.json', token: '3:7:1:1', content,
  baseSourceRevision: `sha256:${hash(original)}`, sourceRevision: `sha256:${hash(content)}` });
const parsed = text => JSON.parse(text.replace(/^\ufeff/, ''));
const add = () => ({ action: 'add', object: { instanceId: uuid(200), name: '<b>Box / 箱 / 方块 🦊</b>', primitive: 'box',
  position: [1, 2, 3], rotationDegrees: [5, 35, -12], size: [2, 3, 4], color: '#87d8b9' } });
const copy = () => ({ action: 'copy', instanceId: model.objects[0].instanceId, newInstanceId: uuid(201), name: 'Copied box' });
const remove = index => ({ action: 'remove', instanceId: model.objects[index].instanceId });
const conflict = error => error?.errorCode === 'scene3d_objects_conflict';
function rawObjects(content) {
  const objects = parsed(content).objects, indexed = parseJsonSource(content);
  return Object.fromEntries(objects.map((object, index) => { const range = locateJsonSource(indexed, `/objects/${index}`);
    assert.equal(range.exact, true); return [object.instanceId, content.slice(range.start, range.end)]; }));
}

test('add appends one explicit author object and keeps every existing object and root property unchanged', async () => {
  const edit = add(), p = createScene3DObjectsProposal(source(), edit), after = parsed(p.afterContent);
  assert.equal(p.action, 'add'); assert.equal(p.sourceInstanceId, null); assert.equal(p.instanceId, edit.object.instanceId);
  assert.equal(p.beforeObject, null); assert.deepEqual(p.afterObject, edit.object); assert.deepEqual(after.objects.slice(0, -1), model.objects);
  assert.deepEqual({ ...after, objects: [] }, { ...model, objects: [] }); assert.ok(p.afterContent.startsWith('\ufeff')); assert.ok(p.afterContent.includes('\r\n'));
  const raw = rawObjects(p.afterContent); for (const [id, value] of Object.entries(rawObjects(original))) assert.equal(raw[id], value);
  assert.deepEqual(p.changedPaths, [`/objects/${model.objects.length}`]); assert.equal((await prepareScene3DObjectsApply(source(), p, { digest: hash })).afterContent, p.afterContent);
});
test('copy appends a fresh identity without changing source object or other primitives', async () => {
  const edit = copy(), p = createScene3DObjectsProposal(source(), edit), after = parsed(p.afterContent);
  assert.equal(p.sourceInstanceId, edit.instanceId); assert.equal(p.instanceId, edit.newInstanceId);
  assert.deepEqual(p.beforeObject, model.objects[0]); assert.deepEqual(p.afterObject, { ...model.objects[0], instanceId: edit.newInstanceId, name: edit.name });
  assert.deepEqual(after.objects.slice(0, -1), model.objects); assert.equal(rawObjects(p.afterContent)[edit.instanceId], rawObjects(original)[edit.instanceId]);
  assert.equal((await prepareScene3DObjectsApply(source(), p, { digest: hash })).afterContent, p.afterContent);
});
test('copy preserves exponent/negative-zero and escaped-key lexemes, including an unchanged name', () => {
  const escapedName = '"' + Array.from({ length: model.objects[0].name.length }, (_, index) => `\\u${model.objects[0].name.charCodeAt(index).toString(16).padStart(4, '0')}`).join('') + '"';
  const raw = original.replace(JSON.stringify(model.objects[0].name), escapedName)
    .replace(/"position":\s*\[[^\]]+\]/, '"pos\\u0069tion": [-15e-1, -0, 0]');
  assert.ok(raw.includes('"pos\\u0069tion": [-15e-1, -0, 0]')); assert.ok(raw.includes(escapedName));
  const before = parsed(raw), edit = { action: 'copy', instanceId: before.objects[0].instanceId, newInstanceId: uuid(202), name: before.objects[0].name };
  const p = createScene3DObjectsProposal(source(raw), edit), oldRaw = rawObjects(raw)[edit.instanceId], copiedRaw = rawObjects(p.afterContent)[edit.newInstanceId];
  assert.equal(copiedRaw, oldRaw.replace(edit.instanceId, edit.newInstanceId));
});
test('remove first, middle and last objects preserves the exact survivors and their order', async () => {
  for (let index = 0; index < model.objects.length; index++) {
    const p = createScene3DObjectsProposal(source(), remove(index)), survivors = model.objects.filter((_, i) => i !== index);
    assert.deepEqual(parsed(p.afterContent).objects, survivors); assert.equal(p.afterObject, null); assert.deepEqual(p.beforeObject, model.objects[index]);
    assert.deepEqual(p.changedPaths, [`/objects/${index}`]);
    const raw = rawObjects(p.afterContent); for (const object of survivors) assert.equal(raw[object.instanceId], rawObjects(original)[object.instanceId]);
    assert.equal((await prepareScene3DObjectsApply(source(), p, { digest: hash })).afterContent, p.afterContent);
  }
});
test('copy/add collisions, an unknown removal and deleting the final primitive fail without a candidate', () => {
  const collision = add(); collision.object.instanceId = model.objects[0].instanceId;
  for (const edit of [collision, { ...copy(), newInstanceId: model.objects[1].instanceId }, { action: 'remove', instanceId: uuid(999) }]) assert.throws(() => createScene3DObjectsProposal(source(), edit));
  const single = serialize({ ...model, objects: [model.objects[0]] }); assert.throws(() => createScene3DObjectsProposal(source(single), remove(0)));
  assert.deepEqual(parsed(original), model);
});
test('object and transform proposal authority stay separate; cloned objects convey no authority', async () => {
  const s = source(), p = createScene3DObjectsProposal(s, copy()), transform = createScene3DTransformProposal(s, { instanceId: model.objects[0].instanceId, values: { position: [7, 8, 9] } });
  assert.equal(isScene3DObjectsProposal(p), true); assert.equal(isScene3DTransformProposal(p), false); assert.equal(isScene3DObjectsProposal(transform), false);
  for (const value of [structuredClone(p), transform, null]) await assert.rejects(prepareScene3DObjectsApply(s, value, { digest: hash }), conflict);
  await assert.rejects(prepareScene3DTransformApply(s, p, { digest: hash }), error => error.errorCode === 'scene3d_transform_conflict');
});
test('review detaches caller edit data, deep freezes the candidate and guards all source identities', async () => {
  const s = source(), edit = add(), p = createScene3DObjectsProposal(s, edit); edit.object.position[0] = 999; edit.object.name = 'changed';
  assert.equal(p.edit.object.position[0], 1); assert.equal(Object.isFrozen(p.edit.object), true); assert.equal(Object.isFrozen(p.changedPaths), true);
  for (const field of ['sourcePath', 'token', 'content', 'baseSourceRevision', 'sourceRevision']) {
    const changed = { ...s, [field]: field.includes('Revision') ? `sha256:${'0'.repeat(64)}` : field === 'sourcePath' ? 'documents/other.json' : s[field] + ' ' };
    await assert.rejects(prepareScene3DObjectsApply(changed, p, { digest: hash }), conflict);
  }
  await assert.rejects(prepareScene3DObjectsApply(s, p, { digest: () => '0'.repeat(64) }), conflict);
});
test('source capture precedes the digest await and accessors are refused without executing them', async () => {
  const s = source(), p = createScene3DObjectsProposal(s, copy()); let release, reads = 0;
  const pending = prepareScene3DObjectsApply(s, p, { digest: async value => { await new Promise(resolve => { release = resolve; }); return hash(value); } });
  s.content = 'changed caller'; s.token = 'other'; release(); assert.equal((await pending).afterContent, p.afterContent);
  const edit = Object.defineProperty({ action: 'remove' }, 'instanceId', { enumerable: true, get() { reads++; return model.objects[0].instanceId; } });
  assert.throws(() => createScene3DObjectsProposal(source(), edit)); assert.equal(reads, 0);
});
