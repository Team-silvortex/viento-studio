import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { validateSceneCamera2DDocument as validate, inspectSceneCamera2DDocument as inspect,
  sceneCamera2DCapabilities as capabilities, validateSceneCamera2DDependencies as dependencies,
  resolveSceneCamera2D as resolvePlan, validateSceneCamera2DPlan as validatePlan, stripSceneCamera2DPlan as strip,
  SCENE_CAMERA2D_CAPABILITY as BASE, SCENE_CAMERA2D_LIMITS_CAPABILITY as LIMITS,
  SCENE_CAMERA2D_FILE_MAX_BYTES } from '../../engine/scene-camera2d.mjs';
import { resolveSceneCamera2DFrame as resolve, fitSceneCamera2DFrame as fit, moveSceneCamera2DFrame as move } from '../../engine/scene-camera2d-frame.mjs';
import { editSceneCamera2DSource as edit } from '../../engine/scene-camera2d-edit.mjs';
import { SCENE_WORKSPACE_MIN_SCALE, SCENE_WORKSPACE_MAX_SCALE } from '../../engine/scene-workspace-view.mjs';
import { scene2DModelToPlan } from '../../engine/build-plan.mjs';
import { resolveScene2DModel } from '../../engine/scene-model.mjs';
import { sceneCamera2DFixture, cameraId as id } from './helpers/scene-camera2d-fixture.mjs';
const box = () => ({ left: -1000, top: -500, right: 3000, bottom: 1500 });
const fixed = (center = [400, 240], zoom = 2) => ({ mode: 'fixed', center, zoom, limits: box() });
const follow = (offset = [0, 0], zoom = 2) => ({ mode: 'follow', targetInstanceId: id(11), offset, zoom, limits: box() });
const document = (camera = fixed()) => ({ format: 'viento-scene-camera2d', schemaVersion: 2, sceneObjectId: id(1), camera });
const actor = (n = 11, position = [1500, 900]) => ({ instanceId: id(n), position, size: [40, 40] });
const input = (camera = fixed(), actors = [], viewport = [800, 480]) => ({ camera, actors, viewport });
const badDocument = callback => assert.throws(callback, { errorCode: 'build_camera2d_invalid' });
const badFrame = callback => assert.throws(callback, { errorCode: 'scene_camera2d_frame_invalid' });
const clone = value => structuredClone(value);
const cameraWithoutLimits = camera => { const { limits, ...value } = camera; return value; };
function contains(view, rectangle, width, height) {
  const pixels = [view.offsetX + rectangle.left * view.scale, view.offsetY + rectangle.top * view.scale,
    view.offsetX + rectangle.right * view.scale, view.offsetY + rectangle.bottom * view.scale];
  assert.ok(pixels[0] >= 24 - 1e-8 && pixels[1] >= 24 - 1e-8 && pixels[2] <= width - 24 + 1e-8 && pixels[3] <= height - 24 + 1e-8);
}

test('only explicit author v2 admits limits, with the base and bounded-camera capabilities', () => {
  assert.equal(LIMITS, 'scene.camera2d.limits2d');
  for (const camera of [fixed(), follow()]) {
    const raw = document(camera), checked = validate(raw); assert.deepEqual(checked, raw); assert.notEqual(checked.camera.limits, raw.camera.limits);
    assert.ok(Object.isFrozen(checked.camera.limits)); assert.deepEqual(capabilities(raw), [BASE, LIMITS]);
    const legacy = { ...raw, schemaVersion: 1, camera: cameraWithoutLimits(camera) };
    assert.deepEqual(validate(legacy), legacy); assert.deepEqual(capabilities(legacy), [BASE]);
    badDocument(() => validate({ ...raw, schemaVersion: 1 }));
    badDocument(() => validate({ ...raw, camera: cameraWithoutLimits(camera) }));
    badDocument(() => validate({ ...raw, schemaVersion: 3 }));
  }
});
test('world bounds accept finite fractional negatives and reject inverted, empty or oversized axes', () => {
  const raw = document(); raw.camera.limits = { left: -100000, top: -0.25, right: 100000, bottom: 0.125 };
  assert.deepEqual(validate(raw).camera.limits, raw.camera.limits);
  for (const limits of [null, [], { ...box(), extra: 1 }, { left: 0, top: 0, right: 0, bottom: 1 },
    { left: 1, top: 0, right: 0, bottom: 1 }, { left: 0, top: 2, right: 1, bottom: 1 },
    { left: 0, top: 0, right: 1, bottom: 0 }, { ...box(), left: -100001 }, { ...box(), bottom: 100001 },
    { ...box(), right: Infinity }, { ...box(), top: NaN }, { ...box(), left: '-1' }, { left: 0, top: 0, right: 1 }]) {
    badDocument(() => validate(document({ ...fixed(), limits })));
    badFrame(() => resolve(input({ ...fixed(), limits })));
  }
});
test('new limits capture refuses getters, hidden/symbol keys and serializers without running author code', () => {
  let invoked = 0;
  const getLimits = document(); Object.defineProperty(getLimits.camera, 'limits', { enumerable: true, get() { invoked++; return box(); } });
  const getEdge = document(); Object.defineProperty(getEdge.camera.limits, 'left', { enumerable: true, get() { invoked++; return -1000; } });
  const hidden = document(); Object.defineProperty(hidden.camera.limits, 'top', { enumerable: false, value: -500 });
  const symbol = document(); symbol.camera.limits[Symbol('edge')] = 0;
  const inherited = document(); inherited.camera.limits = Object.assign(Object.create({ authorCode: true }), box());
  const serializer = document(); serializer.camera.limits.toJSON = () => { invoked++; return box(); };
  const source = JSON.stringify({ ...document(), schemaVersion: 1, camera: cameraWithoutLimits(fixed()) });
  for (const raw of [getLimits, getEdge, hidden, symbol, inherited, serializer]) {
    badDocument(() => validate(raw)); badFrame(() => resolve(input(raw.camera)));
    badFrame(() => move(raw.camera, [0, 0])); assert.throws(() => edit(source, raw.camera));
  }
  assert.equal(invoked, 0);
});
test('v2 source recognition retains duplicate-key, finite UTF-8 and 16KiB admission', () => {
  const text = JSON.stringify(document()); assert.equal(inspect('\ufeff' + text + '\r\n').ok, true);
  for (const source of [text.replace('"left":-1000', '"left":-1000,"left":-1000'), text.replace('"right":3000', '"right":1e999'),
    text + ' '.repeat(SCENE_CAMERA2D_FILE_MAX_BYTES), text.replace('"mode":"fixed"', '"mode":"fixed","note":"\\ud800"')]) {
    const checked = inspect(source); assert.equal(checked.recognized, true); assert.equal(checked.ok, false);
  }
});
test('fixed framing clamps the complete visible rectangle on every world edge', () => {
  for (const [desired, center] of [[[-2000, -1000], [-800, -380]], [[5000, 2000], [2800, 1380]], [[400, 240], [400, 240]]]) {
    const frame = resolve(input(fixed(desired)));
    assert.deepEqual(frame.center, center); assert.deepEqual(frame.desiredCenter, desired); assert.deepEqual(frame.limits, box());
    assert.deepEqual(frame.size, [400, 240]);
    assert.ok(frame.bounds.left >= -1000 && frame.bounds.right <= 3000 && frame.bounds.top >= -500 && frame.bounds.bottom <= 1500);
  }
});
test('a world smaller than the visible frame centers that axis rather than pretending to crop actors', () => {
  const camera = { ...fixed([100000, -100000], 1), limits: { left: 10, top: 20, right: 110, bottom: 60 } }, actors = [actor(11, [90000, 90000])];
  const before = clone(actors), frame = resolve(input(camera, actors));
  assert.deepEqual(frame.center, [60, 40]); assert.deepEqual(frame.bounds, { left: -340, top: -200, right: 460, bottom: 280 });
  assert.deepEqual(frame.desiredCenter, [100000, -100000]); assert.deepEqual(actors, before);
  const one = resolve(input({ ...camera, limits: { left: 10, top: -10000, right: 110, bottom: 10000 } }, actors));
  assert.deepEqual(one.center, [60, -9760]);
});
test('follow applies offset before bounds and preserves stable same-OC instance targeting', () => {
  const actors = [actor(10, [-90000, -90000]), actor()], before = clone(actors);
  const frame = resolve(input(follow([5000, -5000]), actors));
  assert.deepEqual(frame.targetPosition, [1500, 900]); assert.equal(frame.targetInstanceId, id(11));
  assert.deepEqual(frame.desiredCenter, [6500, -4100]); assert.deepEqual(frame.center, [2800, -380]); assert.deepEqual(actors, before);
  actors[0].position = [99999, 99999]; assert.deepEqual(resolve(input(follow([5000, -5000]), actors)), frame);
});
test('viewport and zoom independently determine bounded-camera half extents', () => {
  const frameA = resolve(input(fixed([5000, 2000], 1), [], [800, 480]));
  const frameB = resolve(input(fixed([5000, 2000], 2), [], [800, 480]));
  const frameC = resolve(input(fixed([5000, 2000], 2), [], [1600, 960]));
  assert.deepEqual(frameA.center, [2600, 1260]); assert.deepEqual(frameB.center, [2800, 1380]); assert.deepEqual(frameC.center, frameA.center);
  const equal = resolve(input({ ...fixed([999, 999], 1), limits: { left: -400, top: -240, right: 400, bottom: 240 } }));
  assert.deepEqual(equal.center, [0, 0]); assert.deepEqual(equal.bounds, equal.limits);
});
test('extreme coordinates and zoom produce detached finite output, including unclamped desired centers', () => {
  const raw = input({ ...follow([100000, -100000], 0.125), limits: { left: -100000, top: -100000, right: 100000, bottom: 100000 } },
    [actor(11, [100000, -100000])], [4096, 4096]);
  const frame = resolve(raw); assert.deepEqual(frame.desiredCenter, [200000, -200000]); assert.deepEqual(frame.center, [83616, -83616]);
  for (const value of [frame, frame.desiredCenter, frame.center, frame.bounds, frame.limits, frame.targetPosition]) assert.ok(Object.isFrozen(value));
  raw.camera.limits.right = 50000; raw.camera.offset[0] = 0; raw.actors[0].position[0] = 0;
  assert.equal(frame.limits.right, 100000); assert.deepEqual(frame.desiredCenter, [200000, -200000]);
});
test('all fitting includes world bounds and distant author intent while camera fit stays on actual visible framing', () => {
  const actors = [actor()], frame = resolve(input(fixed([99999, 99999]), actors));
  const camera = fit(frame, actors, 800, 600, { scope: 'camera' }), all = fit(frame, actors, 800, 600, { scope: 'all' });
  contains(camera, frame.bounds, 800, 600); contains(all, frame.bounds, 800, 600); contains(all, frame.limits, 800, 600);
  assert.ok(all.scale < camera.scale);
  contains(all, { left: frame.desiredCenter[0], right: frame.desiredCenter[0], top: frame.desiredCenter[1], bottom: frame.desiredCenter[1] }, 800, 600);
  assert.equal(all.offsetX + (box().left + frame.desiredCenter[0]) / 2 * all.scale, 400);
  assert.ok(camera.offsetX + frame.desiredCenter[0] * camera.scale > 800);
  const ordinary = resolve(input(fixed([400, 240]), actors));
  const ordinaryAll = fit(ordinary, actors, 800, 600, { scope: 'all' });
  assert.equal(ordinaryAll.offsetX + (box().left + box().right) / 2 * ordinaryAll.scale, 400);
});
test('fit rejects forged desired centers, limits, stale logical targets and malformed bounded-frame shapes', () => {
  const actors = [actor()], frame = resolve(input(follow([5000, 5000]), actors));
  for (const change of [value => { value.center[0]++; value.bounds.left++; value.bounds.right++; },
    value => { value.desiredCenter[0] = 0; }, value => { value.desiredCenter[0] = 200001; },
    value => { value.limits.left = value.limits.right; }, value => { value.limits.extra = true; },
    value => { delete value.desiredCenter; }, value => { delete value.limits; }, value => { value.targetPosition[1]++; }]) {
    const forged = clone(frame); change(forged); badFrame(() => fit(forged, actors, 800, 600, { scope: 'all' }));
  }
  let invoked = 0; const getter = clone(frame); Object.defineProperty(getter, 'limits', { enumerable: true, get() { invoked++; return box(); } });
  badFrame(() => fit(getter, actors, 800, 600, { scope: 'all' })); assert.equal(invoked, 0);
});
test('moving a bounded camera edits declared intent, never feeds the clamped center back into it', () => {
  for (const camera of [fixed([90000, -90000]), follow([90000, -90000])]) {
    const before = clone(camera), moved = move(camera, [20000, -20000]), key = camera.mode === 'fixed' ? 'center' : 'offset';
    assert.deepEqual(moved[key], [100000, -100000]); assert.deepEqual(moved.limits, camera.limits); assert.notEqual(moved.limits, camera.limits);
    assert.equal(moved.zoom, camera.zoom); assert.equal(moved.targetInstanceId, camera.targetInstanceId); assert.deepEqual(camera, before);
    const frame = resolve(input(moved, camera.mode === 'follow' ? [actor()] : []));
    assert.notDeepEqual(frame.center, moved[key]); assert.ok(Object.isFrozen(moved.limits));
  }
});
test('moving by zero preserves author numeric values and returns fully detached limits', () => {
  const camera = fixed([-0, 1.25]); camera.limits.top = -0;
  const moved = move(camera, [0, -0]); assert.ok(Object.is(moved.center[0], -0)); assert.ok(Object.is(moved.limits.top, -0));
  assert.notEqual(moved.center, camera.center); assert.notEqual(moved.limits, camera.limits); assert.ok(Object.isFrozen(moved));
});
test('legacy framing remains exact without limits, desiredCenter or any added output fields', () => {
  const camera = cameraWithoutLimits(follow([-24, 16])), frame = resolve(input(camera, [actor()]));
  assert.deepEqual(frame, { mode: 'follow', targetInstanceId: id(11), center: [1476, 916], size: [400, 240],
    bounds: { left: 1276, top: 796, right: 1676, bottom: 1036 }, targetPosition: [1500, 900] });
  assert.equal(Object.hasOwn(frame, 'limits'), false); assert.equal(Object.hasOwn(frame, 'desiredCenter'), false);
});
test('source edit explicitly upgrades and downgrades only schemaVersion and camera tokens', () => {
  const source = '\ufeff{\r\n "camera" : {"mode":"fixed","center":[4e2,2.4e2],"zoom":2.00},\r\n "format":"viento-scene-camera2d","schemaVersion":1e0, "sceneObjectId":"' + id(1) + '"\r\n}\r\n';
  const camera = fixed(), upgraded = edit(source, camera);
  assert.equal(upgraded, source.replace('{"mode":"fixed","center":[4e2,2.4e2],"zoom":2.00}', JSON.stringify(camera)).replace('"schemaVersion":1e0', '"schemaVersion":2'));
  assert.equal(inspect(upgraded).value.schemaVersion, 2);
  const disabled = edit(upgraded, cameraWithoutLimits(camera));
  assert.equal(disabled, upgraded.replace(JSON.stringify(camera), JSON.stringify(cameraWithoutLimits(camera))).replace('"schemaVersion":2', '"schemaVersion":1'));
  assert.equal(inspect(disabled).value.schemaVersion, 1);
});
test('source edit preserves complete bytes on a semantically unchanged v2 declaration', () => {
  const raw = document(), text = '\ufeff' + JSON.stringify(raw, null, '\t').replace('"schemaVersion": 2', '"schemaVersion": 2e0').replace('"left": -1000', '"left": -1e3').replaceAll('\n', '\r\n') + '\r\n';
  const camera = { limits: { bottom: 1500, right: 3000, top: -500, left: -1000 }, zoom: 2, center: [400, 240], mode: 'fixed' };
  assert.equal(edit(text, camera), text);
  assert.equal(edit(text, clone(raw.camera)), text);
});
test('updating an enabled declaration keeps v2 and rejects an invalid replacement before serialization', () => {
  const text = JSON.stringify(document()), next = edit(text, follow([90000, -90000]));
  assert.equal(inspect(next).value.schemaVersion, 2); assert.deepEqual(inspect(next).value.camera, follow([90000, -90000]));
  for (const camera of [{ ...fixed(), limits: undefined }, { ...fixed(), limits: { ...box(), top: 1500 } },
    { ...fixed(), note: 'unknown' }, { ...fixed(), zoom: 99 }]) assert.throws(() => edit(text, camera));
  for (const source of [text.replace('"schemaVersion":2', '"schemaVersion":1'), text.replace('"camera":', '"camera":null,"camera":'), '{}', '']) assert.throws(() => edit(source, fixed()));
});
test('bounded camera resolution keeps dependency identity and requires both capabilities in frozen admission', async () => {
  const f = await sceneCamera2DFixture(); f.value.schemaVersion = 2; f.value.camera.limits = box(); f.update(f.camera, f.value);
  const observed = await f.observe(), plain = scene2DModelToPlan(resolveScene2DModel(observed, f.sceneId).model);
  assert.deepEqual(dependencies(f.value, f.camera.record, observed.source), []);
  const resolved = resolvePlan(observed, plain); assert.equal(resolved.ok, true, JSON.stringify(resolved.diagnostics));
  assert.deepEqual(resolved.camera2d.document, f.value); assert.equal(resolved.camera2d.schemaVersion, 1);
  const plan = { ...plain, camera2d: resolved.camera2d, requiredCapabilities: [...plain.requiredCapabilities, BASE, LIMITS] };
  assert.deepEqual(validatePlan(plan), resolved.camera2d); assert.deepEqual(strip(plan), plain);
  for (const missing of [BASE, LIMITS]) {
    const forged = clone(plan); forged.requiredCapabilities = forged.requiredCapabilities.filter(capability => capability !== missing);
    badDocument(() => validatePlan(forged));
  }
  const detached = validatePlan(plan); assert.ok(Object.isFrozen(detached.document.camera.limits));
  f.value.camera.targetInstanceId = id(777); assert.ok(dependencies(f.value, f.camera.record, observed.source).length > 0);
});
test('bounded plan independently rejects forged versions, hidden limits and getter documents without reading them', async () => {
  const f = await sceneCamera2DFixture(), plain = scene2DModelToPlan(resolveScene2DModel(f, f.sceneId).model);
  const base = { ...plain, camera2d: { format: 'viento-camera2d-plan', schemaVersion: 1,
    manifest: { objectId: f.cameraDocumentId, sourcePath: f.camera.sourcePath, sourceRevision: f.camera.sourceRevision }, document: document(follow()) },
  requiredCapabilities: [...plain.requiredCapabilities, BASE, LIMITS] };
  for (const change of [value => { value.camera2d.document.schemaVersion = 1; }, value => { delete value.camera2d.document.camera.limits; },
    value => { value.camera2d.schemaVersion = 2; }, value => { value.camera2d.document.camera.limits.right = 100001; }]) {
    const plan = clone(base); change(plan); badDocument(() => validatePlan(plan));
  }
  let invoked = 0; const getter = clone(base); Object.defineProperty(getter.camera2d.document.camera.limits, 'left', { enumerable: true, get() { invoked++; return -1000; } });
  badDocument(() => validatePlan(getter)); badDocument(() => strip(getter)); assert.equal(invoked, 0);
});
test('the bounded geometry module remains identical in a browser realm without DOM or a native host', async () => {
  const source = await fs.readFile(new URL('../../engine/scene-camera2d-frame.mjs', import.meta.url), 'utf8');
  const context = vm.createContext({ SCENE_WORKSPACE_MIN_SCALE, SCENE_WORKSPACE_MAX_SCALE });
  vm.runInContext(source.replace(/^import .*\n/gmu, '').replaceAll('export ', '') + '\nglobalThis.api={resolveSceneCamera2DFrame,fitSceneCamera2DFrame,moveSceneCamera2DFrame};', context);
  const raw = input(follow([5000, -5000]), [actor()]);
  const result = JSON.parse(vm.runInContext(`const raw=${JSON.stringify(raw)};const frame=api.resolveSceneCamera2DFrame(raw);JSON.stringify({frame,view:api.fitSceneCamera2DFrame(frame,raw.actors,390.5,844.25,{scope:'all'}),moved:api.moveSceneCamera2DFrame(raw.camera,[10,-20]),frozen:Object.isFrozen(frame.limits),globals:[typeof process,typeof document,typeof window,typeof Buffer]})`, context));
  const frame = resolve(raw); assert.deepEqual(result.frame, frame); assert.deepEqual(result.view, fit(frame, raw.actors, 390.5, 844.25, { scope: 'all' }));
  assert.deepEqual(result.moved, move(raw.camera, [10, -20])); assert.equal(result.frozen, true); assert.deepEqual(result.globals, ['undefined', 'undefined', 'undefined', 'undefined']);
});
