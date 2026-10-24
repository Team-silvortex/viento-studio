import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { projectAnimationClipsAuthor } from './helpers/project-animation-clips-author-fixture.mjs';
import { captureBuildSnapshot } from '../adapters/node-build-snapshot.mjs';
import { validateGeneratedExecutionProject } from '../adapters/node-execution-backends.mjs';
import { GODOT4_EXECUTION_ADAPTER as adapter } from '../backends/godot4-adapter.mjs';
import { checkExecutionBackendSupport } from '../../engine/backend-capabilities.mjs';
import { DEFAULT_EDITABLE_GODOT_ANIMATION_STATE_SCRIPT } from '../../engine/animation-state-script-source.mjs';

async function author(t, scope, states = false) {
  const f = await projectAnimationClipsAuthor(t);
  for (const index of [0, 1]) await f.edit(`documents/animations/scene-${index}.json`, document => {
    document.schemaVersion = 4; document.playbackScope = scope;
  });
  if (states) await f.script('checkpoint', DEFAULT_EDITABLE_GODOT_ANIMATION_STATE_SCRIPT);
  const captured = await captureBuildSnapshot(f.author, f.assemblyId);
  assert.equal(captured.ok, true, JSON.stringify(captured.diagnostics));
  return captured.plan;
}
const invalid = error => error.errorCode === 'build_backend_invalid';

test('schema4 scene scope preserves project protocols7 and10 and standalone clip generation', async t => {
  for (const states of [false, true]) {
    const plan = await author(t, 'scene', states), generated = await adapter.generate(plan);
    assert.equal(generated.backend.protocolVersion, states ? 10 : 7);
    validateGeneratedExecutionProject(adapter, plan, generated);
    assert.deepEqual(checkExecutionBackendSupport(adapter.descriptor, { operation: 'build', plan }), []);
    const child = plan.scenes[0]; assert.equal(child.animation.schemaVersion, 3);
    assert.equal(child.requiredCapabilities.includes('animation.instances2d'), false);
    const single = await adapter.generate(child); assert.ok(single.files.has('animation.json'));
  }
});

test('instance plans require protocol11 and explicit capability before generated artifacts are admitted', async t => {
  const plan = await author(t, 'instance'), generated = await adapter.generate(plan);
  assert.equal(generated.backend.protocolVersion, 11); validateGeneratedExecutionProject(adapter, plan, generated);
  assert.deepEqual(checkExecutionBackendSupport(adapter.descriptor, { operation: 'build', plan }), []);
  for (const protocolVersion of [4, 7, 10]) assert.throws(() => validateGeneratedExecutionProject(adapter, plan,
    { ...generated, backend: { ...generated.backend, protocolVersion } }), invalid);
  const capabilities = adapter.descriptor.capabilities.filter(capability => capability !== 'animation.instances2d');
  const missing = { ...adapter, descriptor: { ...adapter.descriptor, capabilities } };
  assert.throws(() => validateGeneratedExecutionProject(missing, plan, generated), invalid);
  assert.ok(checkExecutionBackendSupport(missing.descriptor, { operation: 'build', plan }).length > 0);
  const oldProtocol = { ...adapter.descriptor, plans: adapter.descriptor.plans.map(item => item.kind === 'project' ? { ...item, runtimeProtocolVersion: 10 } : item) };
  assert.ok(checkExecutionBackendSupport(oldProtocol, { operation: 'build', plan }).length > 0);
  await assert.rejects(adapter.generate(plan.scenes[0]), { errorCode: 'build_animation_instances_require_project' });
});

test('protocol11 cannot be advertised for scene-only plans and scoped generated files retain the declared budget', async t => {
  const scenePlan = await author(t, 'scene'), sceneGenerated = await adapter.generate(scenePlan);
  assert.throws(() => validateGeneratedExecutionProject(adapter, scenePlan,
    { ...sceneGenerated, backend: { ...sceneGenerated.backend, protocolVersion: 11 } }), invalid);
  const plan = await author(t, 'instance'), generated = await adapter.generate(plan);
  const files = new Map(generated.files);
  for (let index = files.size; index < 1024; index++) files.set(`test-budget/${index}.txt`, Buffer.from('bounded'));
  validateGeneratedExecutionProject(adapter, plan, { ...generated, files });
  files.set('test-budget/overflow.txt', Buffer.from('bounded'));
  assert.throws(() => validateGeneratedExecutionProject(adapter, plan, { ...generated, files }), invalid);
});
