import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { parseJsonSource, locateJsonSource } from '../../engine/json-source.mjs';
import { createScene3DEnvironmentProposal, prepareScene3DEnvironmentApply, isScene3DEnvironmentProposal } from '../../engine/scene3d-environment.mjs';
import { createScene3DObjectsProposal, prepareScene3DObjectsApply, isScene3DObjectsProposal } from '../../engine/scene3d-objects.mjs';
import { createScene3DTransformProposal, prepareScene3DTransformApply, isScene3DTransformProposal } from '../../engine/scene3d-transform.mjs';

const model = JSON.parse(await fs.readFile(new URL('../../examples/scene3d/scene.json', import.meta.url), 'utf8'));
const serialize = value => '\ufeff' + JSON.stringify(value, null, '\t').replaceAll('\n', '\r\n') + '\r\n';
const original = serialize(model), hash = value => createHash('sha256').update(value).digest('hex');
const parsed = content => JSON.parse(content.replace(/^\ufeff/, ''));
const source = (content = original) => ({ sourcePath: 'documents/scene.json', token: '3:7:1:1', content,
  baseSourceRevision: `sha256:${hash(original)}`, sourceRevision: `sha256:${hash(content)}` });
const conflict = error => error?.errorCode === 'scene3d_environment_conflict';
const propose = (values, content = original) => createScene3DEnvironmentProposal(source(content), { values });
const raw = (content, path) => { const range = locateJsonSource(parseJsonSource(content), path); assert.equal(range.exact, true); return content.slice(range.start, range.end); };

test('mixed environment review changes only explicit leaves in canonical order and retains every object byte', async () => {
  const values = { light: { energy: 0, color: '#012ABC', direction: [1, -2, 3] },
    camera: { far: 3000, near: 2000, fovDegrees: 65, target: [20, 1, 0], position: [20, 5, 4] }, background: '#abcdef' };
  const p = propose(values), after = parsed(p.afterContent);
  assert.equal(p.kind, 'scene3d-environment'); assert.deepEqual(p.beforeEnvironment, { background: model.background, camera: model.camera, light: model.light });
  assert.deepEqual(p.afterEnvironment, { background: values.background, camera: values.camera, light: values.light });
  assert.deepEqual(p.changedPaths, ['/background', '/camera/position/0', '/camera/position/1', '/camera/position/2', '/camera/target/0', '/camera/fovDegrees', '/camera/near', '/camera/far', '/light/direction/0', '/light/direction/1', '/light/direction/2', '/light/color', '/light/energy']);
  for (const key of ['format', 'schemaVersion', 'name', 'viewport', 'objects']) assert.equal(raw(p.afterContent, `/${key}`), raw(original, `/${key}`));
  assert.deepEqual(after.objects, model.objects); assert.ok(p.afterContent.startsWith('\ufeff')); assert.ok(p.afterContent.endsWith('\r\n'));
  assert.equal((await prepareScene3DEnvironmentApply(source(), p, { digest: hash })).afterContent, p.afterContent);
});
test('near and far and translated author camera are admitted atomically against the complete final scene', () => {
  assert.throws(() => propose({ camera: { near: 2000 } }));
  assert.deepEqual(propose({ camera: { near: 2000, far: 3000 } }).afterEnvironment.camera, { ...model.camera, near: 2000, far: 3000 });
  assert.throws(() => propose({ camera: { position: model.camera.target } }));
  const p = propose({ camera: { position: model.camera.target, target: [3, 1, 5] } });
  assert.deepEqual(p.afterEnvironment.camera.position, model.camera.target); assert.deepEqual(p.afterEnvironment.camera.target, [3, 1, 5]);
});
test('semantic no-op is refused without normalizing authored exponents signed zero escaped keys or colors', () => {
  const text = original.replace('"background"', '"back\\u0067round"').replace('"#0d1829"', '"#0d\\u0031829"')
    .replace('"near": 0.1', '"near": 1e-1').replace('"energy": 1.2', '"energy": 12e-1');
  assert.ok(text.includes('1e-1')); assert.ok(text.includes('12e-1'));
  assert.throws(() => propose({ background: model.background, camera: { near: .1 }, light: { energy: 1.2 } }, text), error => error.errorCode === 'scene3d_environment_unchanged');
  const p = propose({ camera: { fovDegrees: 70, near: .1 }, background: model.background }, text);
  assert.equal(p.afterContent, text.replace('"fovDegrees": 50', '"fovDegrees": 70')); assert.deepEqual(p.changedPaths, ['/camera/fovDegrees']);
});
test('explicit color case change replaces only its string value and unrelated escaped text is preserved', () => {
  const text = original.replace('"color": "#ffffff"', '"co\\u006cor": "#ff\\u0066fff"');
  const p = propose({ light: { color: '#FFFFFF' } }, text);
  assert.equal(p.afterContent, text.replace('"#ff\\u0066fff"', '"#FFFFFF"')); assert.deepEqual(p.changedPaths, ['/light/color']);
  assert.equal(raw(p.afterContent, '/objects'), raw(text, '/objects'));
});
test('values reject unknown implicit structural null empty or unusable vectors and clipping without producing a candidate', () => {
  for (const values of [{}, { camera: {} }, { light: {} }, { objects: [] }, { viewport: [5, 5] }, { camera: { position: null } },
    { camera: { far: .1 } }, { camera: { fovDegrees: 180 } }, { camera: { target: model.camera.position } },
    { light: { direction: [0, 0, 0] } }, { light: { direction: [0, 1, 0] } }, { light: { energy: 17 } }, { background: '#abcd' },
    { camera: { position: [NaN, 0, 1] } }, { light: { energy: Infinity } }, { light: { color: '#xyzxyz' } }]) assert.throws(() => propose(values));
  assert.deepEqual(parsed(original), model);
});
test('environment objects and transform brands cannot cross domains or be acquired by cloning', async () => {
  const s = source(), p = propose({ light: { energy: .25 } });
  const object = createScene3DObjectsProposal(s, { action: 'copy', instanceId: model.objects[0].instanceId, newInstanceId: '60000000-1111-4111-8111-111111111111', name: 'copy' });
  const transform = createScene3DTransformProposal(s, { instanceId: model.objects[0].instanceId, values: { position: [7, 8, 9] } });
  assert.equal(isScene3DEnvironmentProposal(p), true); assert.equal(isScene3DObjectsProposal(p), false); assert.equal(isScene3DTransformProposal(p), false);
  for (const value of [object, transform, structuredClone(p), null]) { assert.equal(isScene3DEnvironmentProposal(value), false); await assert.rejects(prepareScene3DEnvironmentApply(s, value, { digest: hash }), conflict); }
  await assert.rejects(prepareScene3DObjectsApply(s, p, { digest: hash }), error => error.errorCode === 'scene3d_objects_conflict');
  await assert.rejects(prepareScene3DTransformApply(s, p, { digest: hash }), error => error.errorCode === 'scene3d_transform_conflict');
});
test('review detaches and deep freezes values without changing the caller or accepting accessor authority', () => {
  const values = { camera: { position: [12, 8, 11] } }, p = propose(values); values.camera.position[0] = 999;
  assert.equal(p.values.camera.position[0], 12); assert.equal(Object.isFrozen(p.values.camera.position), true); assert.equal(Object.isFrozen(p.beforeEnvironment.camera), true);
  let reads = 0; const bad = Object.defineProperty({}, 'values', { enumerable: true, get() { reads++; return values; } });
  assert.throws(() => createScene3DEnvironmentProposal(source(), bad)); assert.equal(reads, 0);
});
test('apply binds path owner current bytes current revision and saved base plus a verified digest', async () => {
  const s = source(), p = propose({ background: '#123456' });
  for (const field of ['sourcePath', 'token', 'content', 'baseSourceRevision', 'sourceRevision']) {
    const changed = { ...s, [field]: field.includes('Revision') ? `sha256:${'0'.repeat(64)}` : field === 'sourcePath' ? 'documents/other.json' : s[field] + ' ' };
    await assert.rejects(prepareScene3DEnvironmentApply(changed, p, { digest: hash }), conflict);
  }
  for (const digest of [() => '0'.repeat(64), () => 'ABC', null]) await assert.rejects(prepareScene3DEnvironmentApply(s, p, { digest }), conflict);
});
test('apply captures source before awaiting a digest so later caller mutation cannot change the admitted bytes', async () => {
  const s = source(), p = propose({ light: { energy: .5 } }); let release;
  const pending = prepareScene3DEnvironmentApply(s, p, { digest: async text => { await new Promise(resolve => { release = resolve; }); return hash(text); } });
  s.content = 'malicious late bytes'; s.token = 'replacement'; release();
  assert.equal((await pending).afterContent, p.afterContent);
});
