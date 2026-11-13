import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { sceneRestartCapabilities, SCENE_RESTART_CAPABILITY as capability } from '../../engine/scene-restart-capability.mjs';
import { GODOT_ACTION_SCENE_RESTART_SCRIPT as script } from '../../engine/godot-scene-restart-script.mjs';
import { validateProjectAssemblyPlan } from '../../engine/project-assembly-plan-contract.mjs';
import { checkExecutionBackendSupport } from '../../engine/backend-capabilities.mjs';
import { GODOT4_EXECUTION_ADAPTER as adapter } from '../backends/godot4-adapter.mjs';
import { validateGeneratedExecutionProject } from '../adapters/node-execution-backends.mjs';
import { runtimeProject } from './helpers/project-runtime-fixture.mjs';
function fixture() {
  const plan = runtimeProject({ behavior: true }), scene = plan.scenes[0];
  scene.behaviors.sources[0].content = script;
  scene.behaviors.sources[0].sourceRevision = 'sha256:' + createHash('sha256').update(script).digest('hex');
  scene.behaviors.bindings[0].events = [];
  scene.requiredCapabilities = [...new Set([...scene.requiredCapabilities, 'behavior.bindings', 'behavior.gdscript', capability])].sort();
  plan.requiredCapabilities = [...new Set(['project.scenes', ...plan.scenes.flatMap(s => s.requiredCapabilities)])].sort();
  return { plan, scene, behaviors: scene.behaviors };
}
test('only a bound official restart source with explicit unique UUID identity declares the requirement', () => {
  const { behaviors } = fixture(), before = structuredClone(behaviors);
  assert.deepEqual(sceneRestartCapabilities(behaviors), [capability]); assert.deepEqual(behaviors, before);
  for (const mutate of [b => { b.bindings = []; }, b => { b.sources[0].content += '\n'; }, b => { b.sources.push(structuredClone(b.sources[0])); }, b => { b.language = 'rust'; }, b => { b.backendId = 'org.viento.custom'; }, b => { delete b.sources[0].objectId; delete b.bindings[0].implementation.sourceObjectId; }, b => { b.sources[0].objectId = 'invalid'; b.bindings[0].implementation.sourceObjectId = 'invalid'; }]) {
    const copy = structuredClone(before); mutate(copy); assert.deepEqual(sceneRestartCapabilities(copy), []);
  }
});
test('capability discovery never evaluates malformed caller accessors and observes bounded lists', () => {
  let calls = 0;
  for (const key of ['sources', 'bindings', 'backendId', 'language']) {
    const { behaviors } = fixture(); Object.defineProperty(behaviors, key, { get() { calls++; return []; } });
    assert.deepEqual(sceneRestartCapabilities(behaviors), []);
  }
  const { behaviors } = fixture(); Object.defineProperty(behaviors.sources[0], 'objectId', { get() { calls++; return 'invalid'; } });
  assert.deepEqual(sceneRestartCapabilities(behaviors), []); assert.equal(calls, 0);
  for (const key of ['sources', 'bindings']) {
    const { behaviors: b } = fixture(); b[key] = Array(key === 'sources' ? 9 : 33).fill(b[key][0]);
    assert.deepEqual(sceneRestartCapabilities(b), []);
  }
});
test('frozen project admission and backend support independently reject missing member and aggregate restart requirements', () => {
  const { plan } = fixture(); assert.deepEqual(validateProjectAssemblyPlan(plan), plan);
  assert.deepEqual(checkExecutionBackendSupport(adapter.descriptor, { operation: 'build', plan }), []);
  for (const level of ['member', 'aggregate', 'both']) {
    const bad = structuredClone(plan);
    if (level !== 'aggregate') bad.scenes[0].requiredCapabilities = bad.scenes[0].requiredCapabilities.filter(c => c !== capability);
    if (level !== 'member') bad.requiredCapabilities = bad.requiredCapabilities.filter(c => c !== capability);
    assert.throws(() => validateProjectAssemblyPlan(bad), { errorCode: 'build_assembly_invalid' });
    assert.ok(checkExecutionBackendSupport(adapter.descriptor, { operation: 'build', plan: bad }).length > 0);
  }
  const unsupported = structuredClone(adapter.descriptor); unsupported.capabilities = unsupported.capabilities.filter(c => c !== capability);
  assert.ok(checkExecutionBackendSupport(unsupported, { operation: 'build', plan }).some(d => d.code === 'build_capability_missing' && d.capability === capability));
  const bad = structuredClone(plan); bad.requiredCapabilities = bad.requiredCapabilities.filter(c => c !== capability); bad.scenes[0].requiredCapabilities = bad.scenes[0].requiredCapabilities.filter(c => c !== capability);
  assert.ok(checkExecutionBackendSupport(unsupported, { operation: 'build', plan: bad }).some(d => d.code === 'build_capability_missing' && d.capability === capability));
});
test('an official restart binding cannot silently generate a standalone scene without its project host', async () => {
  const { scene } = fixture(); await assert.rejects(adapter.generate(scene), { errorCode: 'build_scene_restart_requires_project' });
});

test('generated restart admission rejects stripped descriptor, output, member and aggregate flags before staging or runtime selection', async () => {
  const { plan } = fixture(), generated = await adapter.generate(plan);
  const before = structuredClone(plan), filesBefore = new Map([...generated.files].map(([name, bytes]) => [name, Buffer.from(bytes)]));
  assert.doesNotThrow(() => validateGeneratedExecutionProject(adapter, plan, generated));
  const unsupported = { ...adapter, descriptor: { ...adapter.descriptor, capabilities: adapter.descriptor.capabilities.filter(c => c !== capability) } };
  assert.throws(() => validateGeneratedExecutionProject(unsupported, plan, generated), { errorCode: 'build_backend_invalid' });
  const missing = { ...generated, backend: { ...generated.backend, capabilities: generated.backend.capabilities.filter(c => c !== capability) } };
  assert.throws(() => validateGeneratedExecutionProject(adapter, plan, missing), { errorCode: 'build_backend_invalid' });
  for (const level of ['member', 'aggregate', 'both']) {
    const bad = structuredClone(plan);
    if (level !== 'aggregate') bad.scenes[0].requiredCapabilities = bad.scenes[0].requiredCapabilities.filter(c => c !== capability);
    if (level !== 'member') bad.requiredCapabilities = bad.requiredCapabilities.filter(c => c !== capability);
    assert.throws(() => validateGeneratedExecutionProject(adapter, bad, generated), { errorCode: 'build_backend_invalid' }, level);
    assert.throws(() => validateGeneratedExecutionProject(unsupported, bad, missing), { errorCode: 'build_backend_invalid' }, level + ' all output flags stripped');
  }
  for (const marked of [true, false]) {
    const scene = structuredClone(plan.scenes[0]);
    if (!marked) scene.requiredCapabilities = scene.requiredCapabilities.filter(c => c !== capability);
    assert.throws(() => validateGeneratedExecutionProject(adapter, scene, generated), { errorCode: 'build_backend_invalid' }, 'standalone ' + marked);
  }
  assert.deepEqual(plan, before); assert.deepEqual(generated.files, filesBefore);
  // Unused exact source and unrelated/custom source retain ordinary contracts.
  const plain = runtimeProject(), ordinary = await adapter.generate(plain);
  const ordinaryMissing = { ...ordinary, backend: { ...ordinary.backend, capabilities: ordinary.backend.capabilities.filter(c => c !== capability) } };
  assert.doesNotThrow(() => validateGeneratedExecutionProject(unsupported, plain, ordinaryMissing));
  for (const variant of ['unbound', 'custom']) {
    const unused = structuredClone(plan);
    const source = unused.scenes[0].behaviors.sources[0];
    if (variant === 'unbound') {
      unused.scenes[0].behaviors.sources.push({ ...source, objectId: 'abababab-abab-4bab-8bab-abababababab', sourcePath: 'documents/unbound-restart.txt' });
      source.content = 'extends Node\n';
    } else source.content += '\n# ordinary editable custom source\n';
    source.sourceRevision = 'sha256:' + createHash('sha256').update(source.content).digest('hex');
    unused.scenes[0].requiredCapabilities = unused.scenes[0].requiredCapabilities.filter(c => c !== capability);
    unused.requiredCapabilities = unused.requiredCapabilities.filter(c => c !== capability);
    const output = await adapter.generate(unused);
    const withoutRestart = { ...output, backend: { ...output.backend, capabilities: output.backend.capabilities.filter(c => c !== capability) } };
    assert.doesNotThrow(() => validateGeneratedExecutionProject(unsupported, unused, withoutRestart), variant);
  }
});
