import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { scenePhysics2DAuthor } from './helpers/scene-physics2d-author-fixture.mjs';
import { captureBuildSnapshot } from '../adapters/node-build-snapshot.mjs';
import { validateProjectAssemblyPlan } from '../../engine/project-assembly-plan.mjs';
import { scenePhysics2DCapabilities, validateScenePhysics2DPlan, stripScenePhysics2DPlan,
  SCENE_PHYSICS2D_CAPABILITIES, SCENE_PHYSICS2D_ONE_WAY_CAPABILITY as oneWay } from '../../engine/scene-physics2d.mjs';
import { checkExecutionBackendSupport } from '../../engine/backend-capabilities.mjs';
import { validateGeneratedExecutionProject } from '../adapters/node-execution-backends.mjs';
import { GODOT4_EXECUTION_ADAPTER as godot } from '../backends/godot4-adapter.mjs';
import { BEVY_EXECUTION_ADAPTER as bevy } from '../backends/bevy-adapter.mjs';
import { BEVY_RUST_EXECUTION_ADAPTER as bevyRust } from '../backends/bevy-rust-adapter.mjs';

async function fixture(t, { enabled = true, motion = false, margin = 1 } = {}) {
  const f = await scenePhysics2DAuthor(t, { animation: false });
  await f.edit(f.physicsPath, document => {
    document.schemaVersion = 4;
    if (enabled) document.bodies[2].oneWay = { margin };
    if (motion) {
      document.bodies[0].collisionResponse = 'slide';
      document.bodies[0].characterMotion = { kind: 'platformer', gravity: 980, jumpSpeed: 360, maxFallSpeed: 1200 };
    }
  });
  const result = await captureBuildSnapshot(f.author, f.assemblyId);
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  return { ...f, ...result };
}

test('saved one-way surfaces keep exact author identity and source range independently of character motion', async t => {
  const f = await fixture(t), file = path.join(f.author, f.physicsPath), before = await fs.readFile(file);
  const frozen = validateProjectAssemblyPlan(f.plan), scene = frozen.scenes.find(scene => scene.physics), physical = scene.physics;
  assert.equal(physical.document.schemaVersion, 4); assert.deepEqual(physical.document.bodies[2].oneWay, { margin: 1 });
  assert.ok(scene.requiredCapabilities.includes(oneWay)); assert.ok(frozen.requiredCapabilities.includes(oneWay));
  assert.ok(!scene.requiredCapabilities.includes('physics.character-motion2d'));
  const source = physical.locations.bodies[2].declaration;
  assert.equal(source.objectId, f.physicsId); assert.equal(source.sourcePath, f.physicsPath);
  assert.equal(source.propertyPath, '/bodies/2'); assert.equal(source.sourceRange.exact, true);
  assert.deepEqual(JSON.parse(before.toString().slice(source.sourceRange.start, source.sourceRange.end)), physical.document.bodies[2]);
  assert.ok(Object.isFrozen(physical.document.bodies[2].oneWay)); assert.deepEqual(validateScenePhysics2DPlan(scene), physical);
  assert.deepEqual(await fs.readFile(file), before);
});

test('one-way surfaces compose with slide and character motion as separate required capabilities', async t => {
  const f = await fixture(t, { motion: true }), scene = f.plan.scenes.find(scene => scene.physics);
  for (const capability of [oneWay, 'physics.character-slide2d', 'physics.character-motion2d']) {
    assert.ok(scene.requiredCapabilities.includes(capability)); assert.ok(f.plan.requiredCapabilities.includes(capability));
  }
  assert.equal(scene.physics.document.bodies[0].characterMotion.jumpSpeed, 360);
  assert.deepEqual(scene.physics.document.bodies[2].oneWay, { margin: 1 });
});

test('disabling the last one-way surface keeps schema4 without requiring the backend capability', async t => {
  const f = await fixture(t, { enabled: false }), scene = f.plan.scenes.find(scene => scene.physics);
  assert.equal(scene.physics.document.schemaVersion, 4);
  assert.ok(!scene.requiredCapabilities.includes(oneWay)); assert.ok(!f.plan.requiredCapabilities.includes(oneWay));
  const unsupported = { ...godot.descriptor, capabilities: godot.descriptor.capabilities.filter(capability => capability !== oneWay) };
  assert.deepEqual(checkExecutionBackendSupport(unsupported, { operation: 'build', plan: f.plan }), []);
  assert.deepEqual(SCENE_PHYSICS2D_CAPABILITIES, ['physics.bodies2d', 'physics.character2d', 'physics.sensors2d']);
  assert.deepEqual(scenePhysics2DCapabilities({ bodies: [] }), ['physics.bodies2d']);
});

test('physics stripping removes one-way requirements and keeps unrelated scene data detached', async t => {
  const f = await fixture(t, { motion: true }), scene = f.plan.scenes.find(scene => scene.physics), before = structuredClone(scene);
  const stripped = stripScenePhysics2DPlan(scene);
  assert.equal(Object.hasOwn(stripped, 'physics'), false);
  assert.ok(!stripped.requiredCapabilities.some(capability => capability.startsWith('physics.')));
  assert.deepEqual(stripped.actors, scene.actors); assert.notEqual(stripped.actors, scene.actors); assert.deepEqual(scene, before);
});

test('one-way requirement is rederived when a forged plan removes child and project flags; both Bevy channels reject it', async t => {
  const f = await fixture(t), missing = { ...godot.descriptor, capabilities: godot.descriptor.capabilities.filter(capability => capability !== oneWay) };
  assert.ok(checkExecutionBackendSupport(missing, { operation: 'build', plan: f.plan }).some(d => d.code === 'build_capability_missing' && d.capability === oneWay));
  const forged = structuredClone(f.plan); forged.requiredCapabilities = forged.requiredCapabilities.filter(capability => capability !== oneWay);
  for (const scene of forged.scenes) scene.requiredCapabilities = scene.requiredCapabilities.filter(capability => capability !== oneWay);
  assert.throws(() => validateProjectAssemblyPlan(forged));
  const diagnostics = checkExecutionBackendSupport(missing, { operation: 'build', plan: forged });
  for (const code of ['build_physics_invalid', 'build_capability_missing']) assert.ok(diagnostics.some(d => d.code === code && d.capability === oneWay));
  for (const adapter of [bevy, bevyRust]) assert.ok(checkExecutionBackendSupport(adapter.descriptor, { operation: 'build', plan: f.plan })
    .some(d => d.code === 'build_capability_missing' && d.capability === oneWay));
});

test('host rejects generated projects or providers that omit the declared one-way capability', async t => {
  const f = await fixture(t, { motion: true }), generated = await godot.generate(f.plan);
  assert.ok(generated.backend.capabilities.includes(oneWay)); assert.doesNotThrow(() => validateGeneratedExecutionProject(godot, f.plan, generated));
  assert.throws(() => validateGeneratedExecutionProject(godot, f.plan, { ...generated,
    backend: { ...generated.backend, capabilities: generated.backend.capabilities.filter(capability => capability !== oneWay) } }), { errorCode: 'build_backend_invalid' });
  assert.throws(() => validateGeneratedExecutionProject({ ...godot, descriptor: { ...godot.descriptor,
    capabilities: godot.descriptor.capabilities.filter(capability => capability !== oneWay) } }, f.plan, generated), { errorCode: 'build_backend_invalid' });
});

test('invalid saved surfaces block build at the author source and do not repair or rewrite files', async t => {
  const f = await fixture(t), original = await f.read(f.physicsPath);
  for (const alter of [body => { body.oneWay = true; }, body => { body.oneWay = null; }, body => { body.oneWay.margin = -1; },
    body => { body.oneWay.margin = 0; }, body => { body.oneWay.margin = 0.5; }, body => { body.oneWay.margin = 65; }, body => { body.oneWay.margin = '1'; }, body => { body.oneWay.extra = true; },
    body => { body.kind = 'sensor'; }, body => { body.shape = { kind: 'circle', radius: 10 }; }]) {
    const document = structuredClone(original); alter(document.bodies[2]); await f.write(f.physicsPath, document);
    const file = path.join(f.author, f.physicsPath), before = await fs.readFile(file), result = await captureBuildSnapshot(f.author, f.assemblyId);
    assert.equal(result.ok, false); assert.equal(result.plan, null);
    assert.ok(result.diagnostics.some(d => d.code === 'build_physics_invalid' && d.objectId === f.physicsId && d.sourcePath === f.physicsPath));
    assert.deepEqual(await fs.readFile(file), before);
  }
});
