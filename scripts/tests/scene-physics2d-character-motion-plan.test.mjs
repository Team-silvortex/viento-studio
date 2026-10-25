import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { scenePhysics2DAuthor } from './helpers/scene-physics2d-author-fixture.mjs';
import { captureBuildSnapshot } from '../adapters/node-build-snapshot.mjs';
import { validateProjectAssemblyPlan } from '../../engine/project-assembly-plan.mjs';
import { scenePhysics2DCapabilities, validateScenePhysics2DPlan, stripScenePhysics2DPlan,
  SCENE_PHYSICS2D_CAPABILITIES, SCENE_PHYSICS2D_MOTION_CAPABILITY as motion } from '../../engine/scene-physics2d.mjs';
import { checkExecutionBackendSupport } from '../../engine/backend-capabilities.mjs';
import { validateGeneratedExecutionProject } from '../adapters/node-execution-backends.mjs';
import { GODOT4_EXECUTION_ADAPTER as godot } from '../backends/godot4-adapter.mjs';
import { BEVY_EXECUTION_ADAPTER as bevy } from '../backends/bevy-adapter.mjs';
import { BEVY_RUST_EXECUTION_ADAPTER as bevyRust } from '../backends/bevy-rust-adapter.mjs';

const values = { kind: 'platformer', gravity: 980, jumpSpeed: 360, maxFallSpeed: 1200 };
async function fixture(t, { enabled = true, controls = 'arrows' } = {}) {
  const f = await scenePhysics2DAuthor(t, { animation: false });
  await f.edit(f.physicsPath, document => {
    document.schemaVersion = 3;
    document.bodies[0].collisionResponse = 'slide';
    if (enabled) document.bodies[0].characterMotion = { ...values };
  });
  if (controls === 'none') await f.edit('documents/scenes/demo.json', scene => { scene.actors[0].controls = controls; scene.actors[0].speed = 0; });
  const result = await captureBuildSnapshot(f.author, f.assemblyId);
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  return { ...f, ...result };
}

test('saved character movement binds exact physics author sources and independent capabilities without rewriting input', async t => {
  const f = await fixture(t), sourcePath = path.join(f.author, f.physicsPath), before = await fs.readFile(sourcePath);
  const frozen = validateProjectAssemblyPlan(f.plan), scene = frozen.scenes.find(s => s.physics), physical = scene.physics;
  assert.equal(physical.document.schemaVersion, 3);
  assert.deepEqual(physical.document.bodies[0].characterMotion, values);
  assert.ok(scene.requiredCapabilities.includes(motion)); assert.ok(frozen.requiredCapabilities.includes(motion));
  assert.ok(scene.requiredCapabilities.includes('physics.character-slide2d'));
  const source = physical.locations.bodies[0].declaration;
  assert.equal(source.sourcePath, f.physicsPath); assert.equal(source.objectId, f.physicsId);
  assert.equal(source.propertyPath, '/bodies/0'); assert.equal(source.sourceRange.exact, true);
  assert.deepEqual(JSON.parse(before.toString().slice(source.sourceRange.start, source.sourceRange.end)), physical.document.bodies[0]);
  assert.ok(Object.isFrozen(physical.document.bodies[0].characterMotion));
  assert.deepEqual(validateScenePhysics2DPlan(scene), physical);
  assert.deepEqual(await fs.readFile(sourcePath), before);
});

test('gravity remains enabled with controls none and zero built-in horizontal speed', async t => {
  const f = await fixture(t, { controls: 'none' }), scene = f.plan.scenes.find(s => s.physics);
  assert.equal(scene.actors.find(a => a.instanceId === f.instanceId).controls, 'none');
  assert.equal(validateScenePhysics2DPlan(scene).document.bodies[0].characterMotion.gravity, 980);
});

test('disabling movement retains schema3 and slide without granting movement capability', async t => {
  const f = await fixture(t, { enabled: false }), scene = f.plan.scenes.find(s => s.physics);
  assert.equal(scene.physics.document.schemaVersion, 3);
  assert.ok(!scene.requiredCapabilities.includes(motion)); assert.ok(!f.plan.requiredCapabilities.includes(motion));
  assert.ok(scene.requiredCapabilities.includes('physics.character-slide2d'));
  assert.deepEqual(scenePhysics2DCapabilities({ bodies: [] }), ['physics.bodies2d']);
  assert.deepEqual(SCENE_PHYSICS2D_CAPABILITIES, ['physics.bodies2d', 'physics.character2d', 'physics.sensors2d']);
});

test('stripping physics removes movement capability and keeps unrelated scene data detached', async t => {
  const f = await fixture(t), scene = f.plan.scenes.find(s => s.physics), before = structuredClone(scene);
  const stripped = stripScenePhysics2DPlan(scene);
  assert.equal(Object.hasOwn(stripped, 'physics'), false);
  assert.ok(!stripped.requiredCapabilities.some(cap => cap.startsWith('physics.')));
  assert.deepEqual(stripped.actors, scene.actors); assert.deepEqual(scene, before);
  assert.notEqual(stripped.actors, scene.actors);
});

test('movement is rederived from declaration when a forged plan or backend removes its capability', async t => {
  const f = await fixture(t), missingProvider = { ...godot.descriptor, capabilities: godot.descriptor.capabilities.filter(cap => cap !== motion) };
  assert.ok(checkExecutionBackendSupport(missingProvider, { operation: 'build', plan: f.plan }).some(d => d.code === 'build_capability_missing' && d.capability === motion));
  const forged = structuredClone(f.plan);
  forged.requiredCapabilities = forged.requiredCapabilities.filter(cap => cap !== motion);
  for (const scene of forged.scenes) scene.requiredCapabilities = scene.requiredCapabilities.filter(cap => cap !== motion);
  assert.throws(() => validateProjectAssemblyPlan(forged));
  const diagnostics = checkExecutionBackendSupport(missingProvider, { operation: 'build', plan: forged });
  assert.ok(diagnostics.some(d => d.code === 'build_physics_invalid' && d.capability === motion));
  assert.ok(diagnostics.some(d => d.code === 'build_capability_missing' && d.capability === motion));
  for (const adapter of [bevy, bevyRust]) assert.ok(checkExecutionBackendSupport(adapter.descriptor, { operation: 'build', plan: f.plan })
    .some(d => d.code === 'build_capability_missing' && d.capability === motion));
});

test('host refuses a generator receipt or provider that drops character movement support', async t => {
  const f = await fixture(t), generated = await godot.generate(f.plan);
  assert.ok(generated.backend.capabilities.includes(motion));
  assert.doesNotThrow(() => validateGeneratedExecutionProject(godot, f.plan, generated));
  const noReceipt = { ...generated, backend: { ...generated.backend, capabilities: generated.backend.capabilities.filter(cap => cap !== motion) } };
  assert.throws(() => validateGeneratedExecutionProject(godot, f.plan, noReceipt), { errorCode: 'build_backend_invalid' });
  const noProvider = { ...godot, descriptor: { ...godot.descriptor, capabilities: godot.descriptor.capabilities.filter(cap => cap !== motion) } };
  assert.throws(() => validateGeneratedExecutionProject(noProvider, f.plan, generated), { errorCode: 'build_backend_invalid' });
});

test('invalid saved movement blocks build with source identity while previous saved files stay intact', async t => {
  const f = await fixture(t);
  for (const alter of [body => { body.collisionResponse = 'stop'; }, body => { body.characterMotion.gravity = 0; },
    body => { body.characterMotion.jumpSpeed = 4001; }, body => { body.characterMotion.maxFallSpeed = 0; }]) {
    await f.edit(f.physicsPath, doc => { doc.bodies[0].collisionResponse = 'slide'; doc.bodies[0].characterMotion = { ...values }; alter(doc.bodies[0]); });
    const file = path.join(f.author, f.physicsPath), before = await fs.readFile(file), result = await captureBuildSnapshot(f.author, f.assemblyId);
    assert.equal(result.ok, false); assert.equal(result.plan, null);
    assert.ok(result.diagnostics.some(d => d.code === 'build_physics_invalid' && d.objectId === f.physicsId && d.sourcePath === f.physicsPath));
    assert.deepEqual(await fs.readFile(file), before);
  }
});
