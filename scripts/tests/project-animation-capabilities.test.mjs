import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { checkExecutionBackendSupport } from '../../engine/backend-capabilities.mjs';
import { validateGeneratedExecutionProject } from '../adapters/node-execution-backends.mjs';
import { GODOT4_EXECUTION_ADAPTER as adapter } from '../backends/godot4-adapter.mjs';
import { clipProject } from './helpers/project-animation-clip-command-fixture.mjs';
import { animationProject } from './helpers/project-animation-command-fixture.mjs';
import { buildHash } from '../adapters/node-build-snapshot.mjs';
import { runtimeProject } from './helpers/project-runtime-fixture.mjs';

test('animation assemblies require project control capability independently of child visual support', () => {
  const plan = animationProject(), descriptor = structuredClone(adapter.descriptor);
  descriptor.capabilities = descriptor.capabilities.filter(value => value !== 'project.animation-control');
  assert.ok(checkExecutionBackendSupport(descriptor, { operation: 'build', plan }).some(d => d.code === 'build_capability_missing' && d.capability === 'project.animation-control'));
  assert.deepEqual(checkExecutionBackendSupport(adapter.descriptor, { operation: 'build', plan }), []);
  assert.deepEqual(checkExecutionBackendSupport(descriptor, { operation: 'build', plan: plan.scenes[0] }), []);
});
test('generated protocol compatibility admits only animation-free project4 under project7 descriptor', async () => {
  const old = runtimeProject(), current = animationProject();
  for (const scene of current.scenes) for (const source of scene.behaviors.sources) source.sourceRevision = 'sha256:' + buildHash(source.content);
  for (const plan of [old, current]) {
    const generated = await adapter.generate(plan);
    assert.equal(generated.backend.protocolVersion, plan === old ? 4 : 7);
    assert.doesNotThrow(() => validateGeneratedExecutionProject(adapter, plan, generated));
    for (const protocolVersion of [1, 2, 3, 5, 6, ...(plan === current ? [4] : [7])]) {
      assert.throws(() => validateGeneratedExecutionProject(adapter, plan, { ...generated, backend: { ...generated.backend, protocolVersion } }));
    }
  }
});

test('clip capability cannot be omitted or delegated to a backend that only supports whole animations', async () => {
  const plan = clipProject(), descriptor = structuredClone(adapter.descriptor);
  descriptor.capabilities = descriptor.capabilities.filter(value => value !== 'animation.clips2d');
  assert.deepEqual(checkExecutionBackendSupport(adapter.descriptor, { operation: 'build', plan }), []);
  assert.ok(checkExecutionBackendSupport(descriptor, { operation: 'build', plan }).some(d => d.code === 'build_capability_missing' && d.capability === 'animation.clips2d'));
  plan.scenes[0].requiredCapabilities = plan.scenes[0].requiredCapabilities.filter(c => c !== 'animation.clips2d');
  plan.requiredCapabilities = plan.requiredCapabilities.filter(c => c !== 'animation.clips2d');
  assert.ok(checkExecutionBackendSupport(descriptor, { operation: 'build', plan }).some(d => d.code === 'build_animation_invalid' && d.capability === 'animation.clips2d'));
});
test('schema3 projects require protocol7 and cannot be silently downgraded to old transport contracts', async () => {
  const plan = clipProject();
  for (const scene of plan.scenes) for (const source of scene.behaviors.sources) source.sourceRevision = 'sha256:' + buildHash(source.content);
  const generated = await adapter.generate(plan); assert.equal(generated.backend.protocolVersion, 7);
  assert.doesNotThrow(() => validateGeneratedExecutionProject(adapter, plan, generated));
  for (const protocolVersion of [1,2,3,4,5,6,8]) assert.throws(() => validateGeneratedExecutionProject(adapter, plan, { ...generated, backend: { ...generated.backend, protocolVersion } }));
});


test('protocol7 completion capability is explicit while legacy animation backends retain their old admission', () => {
  const plan = animationProject(), descriptor = structuredClone(adapter.descriptor);
  descriptor.capabilities = descriptor.capabilities.filter(value => value !== 'project.animation-completion');
  assert.ok(checkExecutionBackendSupport(descriptor, { operation: 'build', plan }).some(d => d.capability === 'project.animation-completion'));
  assert.deepEqual(checkExecutionBackendSupport(descriptor, { operation: 'build', plan: plan.scenes[0] }), []);
  descriptor.plans.find(item => item.kind === 'project').runtimeProtocolVersion = 6;
  assert.deepEqual(checkExecutionBackendSupport(descriptor, { operation: 'build', plan }), []);
});
