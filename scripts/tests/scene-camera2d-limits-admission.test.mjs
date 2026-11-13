import test from 'node:test';
import assert from 'node:assert/strict';
import { createScene2DPlan } from '../../engine/build-plan.mjs';
import { createProjectAssemblyPlan } from '../../engine/project-assembly-plan.mjs';
import { checkExecutionBackendSupport } from '../../engine/backend-capabilities.mjs';
import { assertBackendOperation, validateGeneratedExecutionProject } from '../adapters/node-execution-backends.mjs';
import { sceneCamera2DFixture, cameraDigest } from './helpers/scene-camera2d-fixture.mjs';
const base = 'scene.camera2d', limits = 'scene.camera2d.limits2d';
const descriptor = (bounded = true) => ({ format: 'viento-execution-backend', schemaVersion: 1,
  id: 'org.viento.camera-limit-test', label: 'Neutral limited camera fixture', version: '1.0.0', platforms: ['linux'],
  plans: [{ kind: 'scene2d', schemaVersion: 2, runtimeProtocolVersion: 2 }, { kind: 'project', schemaVersion: 1, runtimeProtocolVersion: 4 }],
  capabilities: ['scene2d', 'input.arrows', 'state.movement', 'project.scenes', base, ...(bounded ? [limits] : [])],
  execution: { build: true, headlessLogic: true, windowPreview: true, windowCapture: true, offscreenRender: false, embeddedViewport: false, gpuCompute: false }, extensions: [] });
async function plans(bounded = true, follow = true) {
  const f = await sceneCamera2DFixture({ follow });
  if (bounded) { f.value.schemaVersion = 2; f.value.camera.limits = { left: -1000, top: -500, right: 2000, bottom: 1500 }; f.update(f.camera, f.value); }
  const observed = await f.observe(), scene = createScene2DPlan(observed, f.sceneId), project = createProjectAssemblyPlan(observed, f.assemblyId);
  assert.equal(scene.ok, true, JSON.stringify(scene.diagnostics)); assert.equal(project.ok, true, JSON.stringify(project.diagnostics));
  return [scene.plan, project.plan];
}
function generated(plan, bounded = true) {
  return { files: new Map([['project.godot', Buffer.from('config_version=5\n')]]), resourceFiles: new Map(), sourceMap: {},
    backend: { id: descriptor().id, version: '1.0.0', protocolVersion: plan.kind === 'project' ? 4 : 2,
      sha256: cameraDigest('neutral-limit-camera-fixture'), capabilities: [base, ...(bounded ? [limits] : [])] },
    artifact: { kind: 'godot-project', entry: 'project.godot', requiresTool: true } };
}

test('bounded fixed and follow planning derive both capabilities and preserve independent author revisions', async () => {
  for (const follow of [false, true]) for (const plan of await plans(true, follow)) {
    assert.ok(plan.requiredCapabilities.includes(base)); assert.ok(plan.requiredCapabilities.includes(limits));
    const child = plan.kind === 'project' ? plan.scenes[0] : plan; assert.equal(child.camera2d.document.schemaVersion, 2);
    assert.deepEqual(checkExecutionBackendSupport(descriptor(), { operation: 'build', platform: 'linux', plan }), []);
    assert.doesNotThrow(() => validateGeneratedExecutionProject({ descriptor: descriptor() }, plan, generated(plan)));
  }
});
test('a provider with the base camera but no world-bound capability rejects bounded plans', async () => {
  for (const plan of await plans()) {
    assert.ok(checkExecutionBackendSupport(descriptor(false), { operation: 'build', plan }).some(item => item.code === 'build_capability_missing' && item.capability === limits));
    assert.throws(() => assertBackendOperation({ descriptor: descriptor(false) }, 'headlessLogic', plan), { errorCode: 'build_capability_missing' });
    assert.throws(() => validateGeneratedExecutionProject({ descriptor: descriptor(false) }, plan, generated(plan)), { errorCode: 'build_backend_invalid' });
  }
});
test('removing bounded capability from member and assembly cannot silently downgrade the explicit declaration', async () => {
  const [scene, project] = await plans(); const outer = structuredClone(project); outer.requiredCapabilities = outer.requiredCapabilities.filter(value => value !== limits);
  assert.ok(checkExecutionBackendSupport(descriptor(), { operation: 'build', plan: outer }).some(item => item.code === 'build_assembly_invalid' && item.capability === limits));
  for (const original of [scene, project]) {
    const plan = structuredClone(original); plan.requiredCapabilities = plan.requiredCapabilities.filter(value => value !== limits);
    if (plan.scenes) plan.scenes[0].requiredCapabilities = plan.scenes[0].requiredCapabilities.filter(value => value !== limits);
    for (const bounded of [false, true]) {
      const errors = checkExecutionBackendSupport(descriptor(bounded), { operation: 'build', plan });
      assert.ok(errors.some(item => item.code === 'build_camera2d_invalid' && item.capability === limits));
      if (!bounded) assert.ok(errors.some(item => item.code === 'build_capability_missing' && item.capability === limits));
      assert.throws(() => validateGeneratedExecutionProject({ descriptor: descriptor(bounded) }, plan, generated(plan)), { errorCode: 'build_backend_invalid' });
    }
  }
});
test('bounded producer receipts require the actual producer capability independently of the registered adapter', async () => {
  for (const plan of await plans()) assert.throws(() => validateGeneratedExecutionProject({ descriptor: descriptor() }, plan, generated(plan, false)), { errorCode: 'build_backend_invalid' });
});
test('malformed bounded declarations cannot hide behind both capability flags', async () => {
  for (const original of await plans()) for (const mutate of [camera => { camera.limits.left = camera.limits.right; }, camera => { camera.limits.top = -100001; }, camera => { delete camera.limits; }]) {
    const plan = structuredClone(original); mutate((plan.kind === 'project' ? plan.scenes[0] : plan).camera2d.document.camera);
    assert.ok(checkExecutionBackendSupport(descriptor(), { operation: 'build', plan }).some(item => item.code === 'build_camera2d_invalid'));
    assert.throws(() => validateGeneratedExecutionProject({ descriptor: descriptor() }, plan, generated(plan)), { errorCode: 'build_backend_invalid' });
  }
});
test('legacy camera plans still need only the base capability and retain v1 author documents', async () => {
  for (const plan of await plans(false)) {
    assert.equal(plan.requiredCapabilities.includes(limits), false);
    assert.equal((plan.kind === 'project' ? plan.scenes[0] : plan).camera2d.document.schemaVersion, 1);
    assert.deepEqual(checkExecutionBackendSupport(descriptor(false), { operation: 'build', plan }), []);
    assert.doesNotThrow(() => validateGeneratedExecutionProject({ descriptor: descriptor(false) }, plan, generated(plan, false)));
  }
});

test('non-finite bounded values are refused at the neutral request boundary', async () => {
  for (const original of await plans()) {
    const plan = structuredClone(original);
    (plan.kind === 'project' ? plan.scenes[0] : plan).camera2d.document.camera.limits.top = Infinity;
    assert.throws(() => checkExecutionBackendSupport(descriptor(), { operation: 'build', plan }), { errorCode: 'build_backend_invalid' });
  }
});
