import test from 'node:test';
import assert from 'node:assert/strict';
import { validateSceneCamera2DDocument, inspectSceneCamera2DDocument, sceneCamera2DDocumentIds, validateSceneCamera2DDependencies,
  resolveSceneCamera2D, validateSceneCamera2DPlan, stripSceneCamera2DPlan, SCENE_CAMERA2D_CAPABILITY, SCENE_CAMERA2D_FILE_MAX_BYTES } from '../../engine/scene-camera2d.mjs';
import { createScene2DPlan, scene2DModelToPlan, validateScene2DRegistration } from '../../engine/build-plan.mjs';
import { resolveScene2DModel } from '../../engine/scene-model.mjs';
import { createProjectAssemblyPlan } from '../../engine/project-assembly-plan.mjs';
import { validateProjectAssemblyPlan } from '../../engine/project-assembly-plan-contract.mjs';
import { sceneCamera2DFixture, cameraId, cameraJson } from './helpers/scene-camera2d-fixture.mjs';
const invalid = { errorCode: 'build_camera2d_invalid' };
const fixed = () => ({ format: 'viento-scene-camera2d', schemaVersion: 1, sceneObjectId: cameraId(1), camera: { mode: 'fixed', center: [-100000, 100000], zoom: 0.125 } });
const follow = () => ({ ...fixed(), camera: { mode: 'follow', targetInstanceId: cameraId(10), offset: [100000, -100000], zoom: 8 } });

test('fixed and follow documents detach and freeze their finite neutral settings', () => {
  for (const input of [fixed(), follow()]) {
    const before = structuredClone(input), checked = validateSceneCamera2DDocument(input);
    assert.deepEqual(checked, input); assert.notEqual(checked, input); assert.ok(Object.isFrozen(checked.camera));
    assert.ok(Object.isFrozen(checked.camera.center || checked.camera.offset)); assert.deepEqual(sceneCamera2DDocumentIds(input), [cameraId(1)]);
    input.camera.zoom = 2; assert.deepEqual(checked, before);
  }
});
test('camera admission rejects unknown fields, union ambiguity, identities and numeric limits', () => {
  const inputs = [
    { ...fixed(), schemaVersion: 2 }, { ...fixed(), view: {} }, { ...fixed(), sceneObjectId: 'not-an-id' },
    { ...fixed(), camera: { ...fixed().camera, offset: [0, 0] } }, { ...follow(), camera: { ...follow().camera, center: [0, 0] } },
    ...['none', 'Fixed'].map(mode => ({ ...fixed(), camera: { ...fixed().camera, mode } })),
    ...[0, 0.124999, 8.00001, Infinity, NaN, '1'].map(zoom => ({ ...fixed(), camera: { ...fixed().camera, zoom } })),
    ...[[100001, 0], [0, -100001], [0], [0, 1, 2], [0, Infinity], ['0', 0]].map(center => ({ ...fixed(), camera: { ...fixed().camera, center } })),
    { ...follow(), camera: { ...follow().camera, targetInstanceId: cameraId(10).toUpperCase().replace('9191', 'ABCD') } },
  ];
  for (const input of inputs) assert.throws(() => validateSceneCamera2DDocument(input), invalid);
});
test('strict descriptors never execute accessors or serializers and reject hidden/symbol/sparse data', () => {
  let invoked = 0;
  const getter = fixed(); Object.defineProperty(getter.camera, 'zoom', { enumerable: true, get() { invoked++; return 1; } });
  const hidden = fixed(); Object.defineProperty(hidden.camera, 'zoom', { value: 1, enumerable: false });
  const symbol = fixed(); symbol[Symbol('extra')] = 1;
  const named = fixed(); named.camera.center.extra = 1;
  const sparse = fixed(); sparse.camera.center = [0, ,];
  const serializer = fixed(); serializer.toJSON = () => { invoked++; return fixed(); };
  const inherited = Object.assign(Object.create({ extra: 1 }), fixed());
  for (const input of [getter, hidden, symbol, named, sparse, serializer, inherited]) assert.throws(() => validateSceneCamera2DDocument(input), invalid);
  assert.equal(invoked, 0);
});
test('source inspector recognizes only its top-level marker and rejects duplicate, incomplete and oversized source', () => {
  const raw = '\ufeff' + cameraJson(follow()).replaceAll('\n', '\r\n');
  assert.equal(inspectSceneCamera2DDocument(raw).ok, true);
  assert.equal(inspectSceneCamera2DDocument(raw.replace('"format"', '"for\\u006dat"')).recognized, true);
  for (const content of ['# viento-scene-camera2d', JSON.stringify({ example: fixed() }), '{"format":"other"}']) assert.equal(inspectSceneCamera2DDocument(content).recognized, false);
  for (const content of [cameraJson(fixed()).replace('"schemaVersion": 1,', '"schemaVersion": 1,"schemaVersion": 1,'),
    '{"format":"viento-scene-camera2d",', cameraJson(fixed()) + ' '.repeat(SCENE_CAMERA2D_FILE_MAX_BYTES),
    cameraJson(fixed()).replace('"mode": "fixed"', '"mode": "fixed","note":"\\ud800"')]) {
    const checked = inspectSceneCamera2DDocument(content); assert.equal(checked.recognized, true); assert.equal(checked.ok, false);
  }
});
test('unreferenced camera data leaves executable and registration scene plans byte-compatible', async () => {
  const f = await sceneCamera2DFixture({ enabled: false }); f.update(f.camera, '{ damaged unrelated camera');
  const observed = await f.observe(), planned = createScene2DPlan(observed, f.sceneId);
  const original = scene2DModelToPlan(resolveScene2DModel(observed, f.sceneId).model);
  assert.equal(planned.ok, true); assert.deepEqual(planned.plan, original); assert.deepEqual(validateScene2DRegistration(observed, f.sceneId).plan, original);
  assert.equal(Object.hasOwn(planned.plan, 'camera2d'), false); assert.equal(planned.plan.requiredCapabilities.includes(SCENE_CAMERA2D_CAPABILITY), false);
});
test('both scene versions attach saved cameras after existing scene planning and keep repeated-OC identity', async () => {
  for (const schemaVersion of [2, 3]) for (const follow of [false, true]) {
    const f = await sceneCamera2DFixture({ schemaVersion, follow }), before = structuredClone(f.source), planned = createScene2DPlan(f, f.sceneId);
    assert.equal(planned.ok, true, JSON.stringify(planned.diagnostics)); assert.deepEqual(planned.plan.camera2d.document, f.value);
    assert.deepEqual(Object.keys(planned.plan.camera2d), ['format', 'schemaVersion', 'manifest', 'document']);
    assert.equal(planned.plan.requiredCapabilities.at(-1), SCENE_CAMERA2D_CAPABILITY); assert.deepEqual(f.source, before);
    assert.deepEqual(planned.plan.actors.map(actor => actor.instanceId), f.instances);
    assert.equal(planned.plan.actors[0].objectId, planned.plan.actors[1].objectId);
    assert.equal(Object.hasOwn(validateScene2DRegistration(f, f.sceneId).plan, 'camera2d'), false);
  }
});
test('saved dependencies require exact bidirectional opt-in and an unambiguous stable scene membership', async () => {
  const f = await sceneCamera2DFixture();
  assert.deepEqual(validateSceneCamera2DDependencies(f.value, f.camera.record, f.source), []);
  for (const mutate of [
    g => g.camera.record.relations.push({ kind: 'references', targetId: g.sceneId, slot: 'duplicate' }),
    g => { g.camera.record.relations = []; },
    g => { g.scene.record.relations = g.scene.record.relations.filter(row => row.slot !== 'camera2d'); },
    g => { g.scene.record.relations.find(row => row.slot === 'camera2d').targetId = cameraId(777); },
    g => g.scene.record.relations.push({ kind: 'references', targetId: g.cameraDocumentId, slot: 'camera2d' }),
    g => { g.declaration.schemaVersion = 1; g.update(g.scene, g.declaration); },
    g => { g.declaration.actors[1].instanceId = g.instances[0]; g.update(g.scene, g.declaration); },
    g => { g.value.camera.targetInstanceId = cameraId(777); },
  ]) {
    const g = await sceneCamera2DFixture(); mutate(g);
    assert.ok(validateSceneCamera2DDependencies(g.value, g.camera.record, g.source).length);
  }
  const absent = structuredClone(f.source); absent.documents.find(item => item.record.id === f.sceneId).content = null;
  assert.equal(validateSceneCamera2DDependencies(f.value, f.camera.record, absent)[0].code, 'build_camera2d_dependency_unavailable');
});
test('invalid saved target diagnoses the camera source pointer while static preview remains available', async () => {
  const f = await sceneCamera2DFixture(); f.value.camera.targetInstanceId = cameraId(777); f.update(f.camera, f.value);
  const observed = await f.observe(), planned = createScene2DPlan(observed, f.sceneId);
  assert.equal(planned.ok, false); assert.equal(planned.plan, null);
  const diagnostic = planned.diagnostics[0]; assert.equal(diagnostic.objectId, f.cameraDocumentId); assert.equal(diagnostic.sourceRevision, f.camera.sourceRevision);
  assert.equal(diagnostic.propertyPath, '/camera/targetInstanceId'); assert.equal(diagnostic.sourceRange.exact, true);
  assert.equal(validateScene2DRegistration(observed, f.sceneId).ok, true);
});
test('unavailable, unregistered, duplicate or foreign camera declarations block executable planning', async () => {
  for (const mutate of [
    g => { g.camera.content = null; },
    g => { g.camera.record.sourcePath = 'documents/cameras/different.json'; },
    g => { g.camera.sourceRevision = 'bad'; },
    g => { g.value.sceneObjectId = cameraId(777); g.update(g.camera, g.value); },
    g => g.source.documents.push(structuredClone(g.camera)),
  ]) {
    const f = await sceneCamera2DFixture(); mutate(f);
    const plain = scene2DModelToPlan(resolveScene2DModel(f, f.sceneId).model), result = resolveSceneCamera2D(f, plain);
    assert.equal(result.ok, false); assert.equal(result.camera2d, null);
  }
});
test('frozen camera admission detaches data and stripping restores the original scene shape', async () => {
  const f = await sceneCamera2DFixture(), plan = createScene2DPlan(f, f.sceneId).plan;
  const frozen = validateSceneCamera2DPlan(plan); assert.ok(Object.isFrozen(frozen.document.camera.offset));
  plan.camera2d = structuredClone(plan.camera2d); plan.camera2d.document.camera.offset[0] = 100;
  assert.equal(frozen.document.camera.offset[0], -24);
  const stripped = stripSceneCamera2DPlan(plan), original = scene2DModelToPlan(resolveScene2DModel(f, f.sceneId).model);
  assert.deepEqual(stripped, original); stripped.actors[0].position[0] = 0; assert.equal(plan.actors[0].position[0], -100);
});
test('frozen camera admission independently rejects targets, capabilities, source metadata and accessor plans', async () => {
  const f = await sceneCamera2DFixture(), original = createScene2DPlan(f, f.sceneId).plan;
  for (const mutate of [
    p => { p.camera2d.document.camera.targetInstanceId = cameraId(777); },
    p => { p.camera2d.document.sceneObjectId = cameraId(777); },
    p => { p.camera2d.manifest.sourcePath = '../camera.json'; },
    p => { p.camera2d.manifest.sourceRevision = 'bad'; },
    p => { p.camera2d.manifest.objectId = f.sceneId; },
    p => { p.camera2d.locations = {}; },
    p => { p.requiredCapabilities = p.requiredCapabilities.filter(cap => cap !== SCENE_CAMERA2D_CAPABILITY); },
    p => { p.actors[1].instanceId = p.actors[0].instanceId; },
    p => { p.actors[0].position = [NaN, 0]; },
  ]) { const plan = structuredClone(original); mutate(plan); assert.throws(() => validateSceneCamera2DPlan(plan), invalid); }
  let called = false; const getter = structuredClone(original); Object.defineProperty(getter.camera2d, 'document', { enumerable: true, get() { called = true; return original.camera2d.document; } });
  assert.throws(() => validateSceneCamera2DPlan(getter), invalid); assert.equal(called, false);
});
test('project envelopes retain the optional camera and independently enforce frozen targets and capability unions', async () => {
  const f = await sceneCamera2DFixture(), planned = createProjectAssemblyPlan(f, f.assemblyId);
  assert.equal(planned.ok, true, JSON.stringify(planned.diagnostics)); const frozen = validateProjectAssemblyPlan(planned.plan);
  assert.equal(frozen.scenes[0].camera2d.document.camera.targetInstanceId, f.instances[1]); assert.ok(Object.isFrozen(frozen.scenes[0].camera2d));
  const forged = structuredClone(frozen); forged.scenes[0].camera2d.document.camera.targetInstanceId = cameraId(777);
  assert.throws(() => validateProjectAssemblyPlan(forged), invalid);
  const missing = structuredClone(frozen); missing.requiredCapabilities = missing.requiredCapabilities.filter(cap => cap !== SCENE_CAMERA2D_CAPABILITY);
  assert.throws(() => validateProjectAssemblyPlan(missing), { errorCode: 'build_assembly_invalid' });
});

test('no-camera discovery preserves foreign-realm and minimal legacy observations without reading unrelated accessors', async () => {
  const { default: vm } = await import('node:vm');
  const plan = { scene: { objectId: cameraId(1) } };
  for (const source of [
    vm.runInNewContext(`({documents:[{record:{id:${JSON.stringify(cameraId(1))}}},{record:{id:${JSON.stringify(cameraId(3))}}}]})`),
    vm.runInNewContext(`({documents:[{record:{id:${JSON.stringify(cameraId(1))},relations:[{kind:'references',targetId:${JSON.stringify(cameraId(3))},slot:'definition'}]}}]})`),
  ]) assert.deepEqual(resolveSceneCamera2D({ source }, plan), { ok: true, camera2d: null, diagnostics: [] });
  let invoked = 0;
  const unrelated = {}; Object.defineProperty(unrelated, 'record', { enumerable: true, get() { invoked++; throw Error('unrelated'); } });
  assert.equal(resolveSceneCamera2D({ source: { documents: [{ record: { id: cameraId(1) } }, unrelated] } }, plan).ok, true);
  assert.equal(invoked, 0);
});
test('explicit camera opt-in retains strict realm and accessor admission after legacy discovery', async () => {
  const { default: vm } = await import('node:vm'), f = await sceneCamera2DFixture();
  const plan = scene2DModelToPlan(resolveScene2DModel(f, f.sceneId).model);
  const foreign = vm.runInNewContext('(' + JSON.stringify(f.source) + ')');
  assert.throws(() => resolveSceneCamera2D({ source: foreign }, plan), invalid);
  let invoked = 0; const observed = { source: structuredClone(f.source) }, scene = observed.source.documents.find(item => item.record.id === f.sceneId);
  Object.defineProperty(scene.record.relations.find(row => row.slot === 'camera2d'), 'targetId', { enumerable: true, get() { invoked++; return f.cameraDocumentId; } });
  assert.throws(() => resolveSceneCamera2D(observed, plan), invalid); assert.equal(invoked, 0);
});
