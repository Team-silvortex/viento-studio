import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { scenePhysics2DAuthor } from './helpers/scene-physics2d-author-fixture.mjs';
import { captureBuildSnapshot } from '../adapters/node-build-snapshot.mjs';
import { validateProjectAssemblyPlan } from '../../engine/project-assembly-plan.mjs';
import { scenePhysics2DCapabilities, validateScenePhysics2DPlan, stripScenePhysics2DPlan,
  SCENE_PHYSICS2D_CAPABILITIES, SCENE_PHYSICS2D_PLATFORM_MOTION_CAPABILITY as platformMotion } from '../../engine/scene-physics2d.mjs';
import { checkExecutionBackendSupport } from '../../engine/backend-capabilities.mjs';
import { GODOT4_EXECUTION_ADAPTER as godot } from '../backends/godot4-adapter.mjs';
import { BEVY_EXECUTION_ADAPTER as bevy } from '../backends/bevy-adapter.mjs';
import { BEVY_RUST_EXECUTION_ADAPTER as bevyRust } from '../backends/bevy-rust-adapter.mjs';

async function fixture(t, { enabled = true, oneWay = false, motion = false } = {}) {
  const f = await scenePhysics2DAuthor(t, { animation: false });
  await f.edit(f.physicsPath, document => {
    document.schemaVersion = 5;
    if (enabled) document.bodies[2].platformMotion = { kind: 'horizontal', offsetX: -160, speed: 80 };
    if (oneWay) document.bodies[2].oneWay = { margin: 1 };
    if (motion) { document.bodies[0].collisionResponse = 'slide'; document.bodies[0].characterMotion = { kind: 'platformer', gravity: 980, jumpSpeed: 360, maxFallSpeed: 1200 }; }
  });
  const result = await captureBuildSnapshot(f.author, f.assemblyId); assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  return { ...f, ...result };
}
const withoutPlatform = () => ({ ...godot.descriptor, capabilities: godot.descriptor.capabilities.filter(capability => capability !== platformMotion) });

test('saved moving platforms retain exact author identity source range and independent capability', async t => {
  const f = await fixture(t), file = path.join(f.author, f.physicsPath), before = await fs.readFile(file);
  const frozen = validateProjectAssemblyPlan(f.plan), scene = frozen.scenes.find(scene => scene.physics), physics = scene.physics;
  assert.equal(physics.document.schemaVersion, 5); assert.deepEqual(physics.document.bodies[2].platformMotion, { kind: 'horizontal', offsetX: -160, speed: 80 });
  assert.ok(scene.requiredCapabilities.includes(platformMotion)); assert.ok(frozen.requiredCapabilities.includes(platformMotion));
  assert.ok(!scene.requiredCapabilities.includes('physics.one-way-platform2d')); assert.ok(!scene.requiredCapabilities.includes('physics.character-motion2d'));
  const source = physics.locations.bodies[2].declaration;
  assert.equal(source.objectId, f.physicsId); assert.equal(source.sourcePath, f.physicsPath); assert.equal(source.propertyPath, '/bodies/2'); assert.equal(source.sourceRange.exact, true);
  assert.deepEqual(JSON.parse(before.toString().slice(source.sourceRange.start, source.sourceRange.end)), physics.document.bodies[2]);
  assert.ok(Object.isFrozen(physics.document.bodies[2].platformMotion)); assert.deepEqual(validateScenePhysics2DPlan(scene), physics); assert.deepEqual(await fs.readFile(file), before);
});

test('moving one-way surfaces compose with character slide and gravity as separate capabilities', async t => {
  const f = await fixture(t, { oneWay: true, motion: true }), scene = f.plan.scenes.find(scene => scene.physics);
  for (const capability of [platformMotion, 'physics.one-way-platform2d', 'physics.character-slide2d', 'physics.character-motion2d']) {
    assert.ok(scene.requiredCapabilities.includes(capability)); assert.ok(f.plan.requiredCapabilities.includes(capability));
  }
  assert.equal(scene.physics.document.bodies[0].characterMotion.jumpSpeed, 360); assert.deepEqual(scene.physics.document.bodies[2].oneWay, { margin: 1 });
});

test('disabling the last moving platform preserves schema5 without requiring motion capability', async t => {
  const f = await fixture(t, { enabled: false }), scene = f.plan.scenes.find(scene => scene.physics);
  assert.equal(scene.physics.document.schemaVersion, 5); assert.ok(!scene.requiredCapabilities.includes(platformMotion)); assert.ok(!f.plan.requiredCapabilities.includes(platformMotion));
  assert.deepEqual(checkExecutionBackendSupport(withoutPlatform(), { operation: 'build', plan: f.plan }), []);
  assert.deepEqual(SCENE_PHYSICS2D_CAPABILITIES, ['physics.bodies2d', 'physics.character2d', 'physics.sensors2d']); assert.deepEqual(scenePhysics2DCapabilities({ bodies: [] }), ['physics.bodies2d']);
});

test('physics stripping removes moving-platform capabilities while preserving detached unrelated scene data', async t => {
  const f = await fixture(t, { oneWay: true, motion: true }), scene = f.plan.scenes.find(scene => scene.physics), before = structuredClone(scene), stripped = stripScenePhysics2DPlan(scene);
  assert.equal(Object.hasOwn(stripped, 'physics'), false); assert.ok(!stripped.requiredCapabilities.some(capability => capability.startsWith('physics.')));
  assert.deepEqual(stripped.actors, scene.actors); assert.notEqual(stripped.actors, scene.actors); assert.deepEqual(scene, before);
});

test('raw platform motion rederives requirements after forged flags are removed and both Bevy providers reject it', async t => {
  const f = await fixture(t), missing = withoutPlatform();
  assert.ok(checkExecutionBackendSupport(missing, { operation: 'build', plan: f.plan }).some(d => d.code === 'build_capability_missing' && d.capability === platformMotion));
  const forged = structuredClone(f.plan); forged.requiredCapabilities = forged.requiredCapabilities.filter(c => c !== platformMotion);
  for (const scene of forged.scenes) scene.requiredCapabilities = scene.requiredCapabilities.filter(c => c !== platformMotion);
  assert.throws(() => validateProjectAssemblyPlan(forged));
  const diagnostics = checkExecutionBackendSupport(missing, { operation: 'build', plan: forged });
  for (const code of ['build_physics_invalid', 'build_capability_missing']) assert.ok(diagnostics.some(d => d.code === code && d.capability === platformMotion));
  for (const adapter of [bevy, bevyRust]) assert.ok(checkExecutionBackendSupport(adapter.descriptor, { operation: 'build', plan: f.plan }).some(d => d.code === 'build_capability_missing' && d.capability === platformMotion));
});

test('moving platforms still require zero-speed nonplayer scene actors and exact source maps', async t => {
  const f = await fixture(t), scene = f.plan.scenes.find(scene => scene.physics), platform = scene.physics.document.bodies[2];
  for (const change of [p => p.actors.find(a => a.instanceId === platform.instanceId).speed = 80,
    p => p.actors.find(a => a.instanceId === platform.instanceId).controls = 'arrows',
    p => p.physics.locations.bodies[2].declaration.propertyPath = '/bodies/0']) {
    const forged = structuredClone(scene); change(forged); assert.throws(() => validateScenePhysics2DPlan(forged), { errorCode: 'build_physics_invalid' });
  }
});

test('invalid saved platform motion blocks build at author source without repairing or rewriting it', async t => {
  const f = await fixture(t), original = await f.read(f.physicsPath);
  for (const alter of [b => b.platformMotion = true, b => b.platformMotion = null, b => b.platformMotion.offsetX = 0, b => b.platformMotion.offsetX = .5,
    b => b.platformMotion.offsetX = 8193, b => b.platformMotion.offsetX = -8193, b => b.platformMotion.speed = 0,
    b => b.platformMotion.speed = 2001, b => b.platformMotion.speed = '80', b => b.platformMotion.offsetY = 0,
    b => b.kind = 'sensor', b => b.shape = { kind: 'circle', radius: 10 }]) {
    const document = structuredClone(original); alter(document.bodies[2]); await f.write(f.physicsPath, document);
    const file = path.join(f.author, f.physicsPath), before = await fs.readFile(file), result = await captureBuildSnapshot(f.author, f.assemblyId);
    assert.equal(result.ok, false); assert.equal(result.plan, null); assert.ok(result.diagnostics.some(d => d.code === 'build_physics_invalid' && d.objectId === f.physicsId && d.sourcePath === f.physicsPath)); assert.deepEqual(await fs.readFile(file), before);
  }
});
