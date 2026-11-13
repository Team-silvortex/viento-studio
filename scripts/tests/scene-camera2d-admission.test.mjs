import test from 'node:test';
import assert from 'node:assert/strict';
import { createScene2DPlan } from '../../engine/build-plan.mjs';
import { createProjectAssemblyPlan } from '../../engine/project-assembly-plan.mjs';
import { checkExecutionBackendSupport } from '../../engine/backend-capabilities.mjs';
import { assertBackendOperation, validateGeneratedExecutionProject } from '../adapters/node-execution-backends.mjs';
import { sceneCamera2DFixture, cameraDigest, cameraId } from './helpers/scene-camera2d-fixture.mjs';
const capability = 'scene.camera2d', invalid = { errorCode: 'build_backend_invalid' };
const descriptor = (camera = true) => ({ format: 'viento-execution-backend', schemaVersion: 1,
  id: 'org.viento.camera-test', label: 'Camera neutral fixture', version: '1.0.0', platforms: ['linux'],
  plans: [{ kind: 'scene2d', schemaVersion: 2, runtimeProtocolVersion: 2 }, { kind: 'project', schemaVersion: 1, runtimeProtocolVersion: 4 }],
  capabilities: ['scene2d', 'input.arrows', 'state.movement', 'project.scenes', ...(camera ? [capability] : [])],
  execution: { build: true, headlessLogic: true, windowPreview: true, windowCapture: true, offscreenRender: false, embeddedViewport: false, gpuCompute: false }, extensions: [] });
function generated(plan, camera = true) {
  return { files: new Map([['project.godot', Buffer.from('config_version=5\n')]]), resourceFiles: new Map(), sourceMap: {},
    backend: { id: descriptor().id, version: '1.0.0', protocolVersion: plan.kind === 'project' ? 4 : 2,
      sha256: cameraDigest('neutral-camera-fixture'), capabilities: camera ? [capability] : [] },
    artifact: { kind: 'godot-project', entry: 'project.godot', requiresTool: true } };
}
async function plans(options) { const f = await sceneCamera2DFixture(options); return [createScene2DPlan(f, f.sceneId).plan, createProjectAssemblyPlan(f, f.assemblyId).plan]; }

test('neutral camera support admits fixed and stable-follow standalone and assembly plans', async () => {
  for (const follow of [false, true]) for (const plan of await plans({ follow })) {
    assert.deepEqual(checkExecutionBackendSupport(descriptor(), { operation: 'build', platform: 'linux', plan }), []);
    assert.doesNotThrow(() => assertBackendOperation({ descriptor: descriptor() }, 'headlessLogic', plan));
    assert.doesNotThrow(() => validateGeneratedExecutionProject({ descriptor: descriptor() }, plan, generated(plan)));
  }
});
test('backends without camera capability refuse before an operation is dispatched', async () => {
  for (const plan of await plans()) {
    const errors = checkExecutionBackendSupport(descriptor(false), { operation: 'build', plan });
    assert.ok(errors.some(error => error.code === 'build_capability_missing' && error.capability === capability));
    assert.throws(() => assertBackendOperation({ descriptor: descriptor(false) }, 'headlessLogic', plan), { errorCode: 'build_capability_missing' });
  }
});
test('omitting camera flags from standalone, assembly or both member and assembly never hides the declaration', async () => {
  const [scene, assembly] = await plans();
  const standalone = structuredClone(scene); standalone.requiredCapabilities = standalone.requiredCapabilities.filter(value => value !== capability);
  const outer = structuredClone(assembly); outer.requiredCapabilities = outer.requiredCapabilities.filter(value => value !== capability);
  const both = structuredClone(assembly); both.requiredCapabilities = both.requiredCapabilities.filter(value => value !== capability); both.scenes[0].requiredCapabilities = both.scenes[0].requiredCapabilities.filter(value => value !== capability);
  for (const plan of [standalone, both]) for (const supported of [false, true]) {
    const errors = checkExecutionBackendSupport(descriptor(supported), { operation: 'build', plan });
    assert.ok(errors.some(error => error.code === 'build_camera2d_invalid' && error.capability === capability));
    if (!supported) assert.ok(errors.some(error => error.code === 'build_capability_missing' && error.capability === capability));
    assert.throws(() => validateGeneratedExecutionProject({ descriptor: descriptor(supported) }, plan, generated(plan)), invalid);
  }
  assert.ok(checkExecutionBackendSupport(descriptor(), { operation: 'build', plan: outer }).some(error => error.code === 'build_assembly_invalid' && error.capability === capability));
  assert.throws(() => validateGeneratedExecutionProject({ descriptor: descriptor() }, outer, generated(outer)), invalid);
});
test('camera support validates frozen target membership instead of trusting a capability flag', async () => {
  for (const original of await plans()) {
    const plan = structuredClone(original), camera = plan.kind === 'project' ? plan.scenes[0].camera2d : plan.camera2d;
    camera.document.camera.targetInstanceId = cameraId(777);
    assert.ok(checkExecutionBackendSupport(descriptor(), { operation: 'build', plan }).some(error => error.code === 'build_camera2d_invalid'));
    assert.throws(() => validateGeneratedExecutionProject({ descriptor: descriptor() }, plan, generated(plan)), invalid);
  }
});
test('misplaced/malformed camera envelopes and accessors fail without invoking getters', async () => {
  const [scene, project] = await plans(); let invoked = 0;
  for (const mutate of [value => { value.camera2d = null; }, value => { value.camera2d.format = 'other'; },
    value => { value.camera2d.schemaVersion = 2; }, value => { value.schemaVersion = 1; },
    value => Object.defineProperty(value, 'camera2d', { enumerable: true, get() { invoked++; return scene.camera2d; } })]) {
    const plan = structuredClone(scene); mutate(plan);
    assert.throws(() => checkExecutionBackendSupport(descriptor(), { operation: 'build', plan }), invalid);
  }
  const wrong = { ...project, camera2d: scene.camera2d };
  assert.throws(() => checkExecutionBackendSupport(descriptor(), { operation: 'build', plan: wrong }), invalid);
  assert.throws(() => validateGeneratedExecutionProject({ descriptor: descriptor() }, wrong, generated(wrong)), invalid);
  assert.equal(invoked, 0);
});
test('generated camera receipts require both registered provider and actual producer capabilities', async () => {
  for (const plan of await plans()) {
    assert.throws(() => validateGeneratedExecutionProject({ descriptor: descriptor(false) }, plan, generated(plan)), invalid);
    assert.throws(() => validateGeneratedExecutionProject({ descriptor: descriptor() }, plan, generated(plan, false)), invalid);
    const missing = generated(plan); delete missing.backend.capabilities;
    assert.throws(() => validateGeneratedExecutionProject({ descriptor: descriptor() }, plan, missing), invalid);
  }
});
test('no-camera plans retain old producer receipts without a camera capability list', async () => {
  for (const plan of await plans({ enabled: false })) {
    const output = generated(plan, false); delete output.backend.capabilities;
    assert.deepEqual(checkExecutionBackendSupport(descriptor(false), { operation: 'build', plan }), []);
    assert.doesNotThrow(() => validateGeneratedExecutionProject({ descriptor: descriptor(false) }, plan, output));
  }
});
