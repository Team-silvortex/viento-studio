import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { scenePhysics2DAuthor } from './helpers/scene-physics2d-author-fixture.mjs';
import { captureBuildSnapshot } from '../adapters/node-build-snapshot.mjs';
import { validateProjectAssemblyPlan } from '../../engine/project-assembly-plan.mjs';
import { scenePhysics2DCapabilities, validateScenePhysics2DPlan, stripScenePhysics2DPlan,
  SCENE_PHYSICS2D_PLATFORM_VERTICAL_CAPABILITY as vertical, SCENE_PHYSICS2D_PLATFORM_MOTION_CAPABILITY as movement } from '../../engine/scene-physics2d.mjs';
import { checkExecutionBackendSupport } from '../../engine/backend-capabilities.mjs';
import { GODOT4_EXECUTION_ADAPTER as godot } from '../backends/godot4-adapter.mjs';
import { BEVY_EXECUTION_ADAPTER as bevy } from '../backends/bevy-adapter.mjs';
import { BEVY_RUST_EXECUTION_ADAPTER as bevyRust } from '../backends/bevy-rust-adapter.mjs';
async function fixture(t, { motion = { kind: 'vertical', offsetY: -160, speed: 80 } } = {}) {
  const f = await scenePhysics2DAuthor(t, { animation: false }), doc = await f.read(f.physicsPath);
  doc.schemaVersion = 6;
  if (motion) doc.bodies[2].platformMotion = motion;
  doc.bodies[2].oneWay = { margin: 1 };
  doc.bodies[0].collisionResponse = 'slide'; doc.bodies[0].characterMotion = { kind: 'platformer', gravity: 980, jumpSpeed: 360, maxFallSpeed: 1200 };
  const file = path.join(f.author, f.physicsPath), before = Buffer.from('\uFEFF' + JSON.stringify(doc, null, 2).replace(/\n/g, '\r\n') + '\r\n');
  await fs.writeFile(file, before);
  const result = await captureBuildSnapshot(f.author, f.assemblyId); assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  return { ...f, ...result, file, before };
}
const lackingVertical = () => ({ ...godot.descriptor, capabilities: godot.descriptor.capabilities.filter(capability => capability !== vertical) });

test('frozen vertical platforms preserve source bytes identities and exact ranges with independent inherited capabilities', async t => {
  const f = await fixture(t), plan = validateProjectAssemblyPlan(f.plan), scene = plan.scenes.find(scene => scene.physics), physics = scene.physics;
  assert.equal(physics.document.schemaVersion, 6); assert.deepEqual(physics.document.bodies[2].platformMotion, { kind: 'vertical', offsetY: -160, speed: 80 });
  for (const capability of [vertical, movement, 'physics.one-way-platform2d', 'physics.character-slide2d', 'physics.character-motion2d']) {
    assert.ok(scene.requiredCapabilities.includes(capability)); assert.ok(plan.requiredCapabilities.includes(capability));
  }
  const source = physics.locations.bodies[2].declaration;
  assert.equal(source.objectId, f.physicsId); assert.equal(source.sourcePath, f.physicsPath); assert.equal(source.propertyPath, '/bodies/2'); assert.equal(source.sourceRange.exact, true);
  assert.deepEqual(JSON.parse(f.before.toString().slice(source.sourceRange.start, source.sourceRange.end)), physics.document.bodies[2]);
  assert.ok(Object.isFrozen(physics.document.bodies[2].platformMotion)); assert.deepEqual(validateScenePhysics2DPlan(scene), physics); assert.deepEqual(await fs.readFile(f.file), f.before);
  const stripped = stripScenePhysics2DPlan(scene); assert.equal(Object.hasOwn(stripped, 'physics'), false); assert.ok(!stripped.requiredCapabilities.some(capability => capability.startsWith('physics.')));
  assert.deepEqual(stripped.actors, scene.actors); assert.notEqual(stripped.actors, scene.actors);
});

test('schema6 horizontal or stationary platforms require no vertical capability', async t => {
  for (const motion of [null, { kind: 'horizontal', offsetX: -160, speed: 80 }]) {
    const f = await fixture(t, { motion }), scene = f.plan.scenes.find(scene => scene.physics);
    assert.equal(scene.physics.document.schemaVersion, 6); assert.ok(!scene.requiredCapabilities.includes(vertical)); assert.ok(!f.plan.requiredCapabilities.includes(vertical));
    assert.equal(scene.requiredCapabilities.includes(movement), motion !== null);
    assert.deepEqual(checkExecutionBackendSupport(lackingVertical(), { operation: 'build', plan: f.plan }), []);
  }
  assert.deepEqual(scenePhysics2DCapabilities({ bodies: [] }), ['physics.bodies2d']);
});

test('raw vertical motion cannot bypass backend admission by preserving generic motion flags', async t => {
  const f = await fixture(t), missing = lackingVertical();
  assert.ok(checkExecutionBackendSupport(missing, { operation: 'build', plan: f.plan }).some(d => d.code === 'build_capability_missing' && d.capability === vertical));
  const forged = structuredClone(f.plan); forged.requiredCapabilities = forged.requiredCapabilities.filter(c => c !== vertical);
  for (const scene of forged.scenes) scene.requiredCapabilities = scene.requiredCapabilities.filter(c => c !== vertical);
  assert.throws(() => validateProjectAssemblyPlan(forged));
  const diagnostics = checkExecutionBackendSupport(missing, { operation: 'build', plan: forged });
  for (const code of ['build_physics_invalid', 'build_capability_missing']) assert.ok(diagnostics.some(d => d.code === code && d.capability === vertical));
  for (const adapter of [bevy, bevyRust]) assert.ok(checkExecutionBackendSupport(adapter.descriptor, { operation: 'build', plan: f.plan }).some(d => d.code === 'build_capability_missing' && d.capability === vertical));
});

test('vertical platform actor ownership and declaration source maps remain strict', async t => {
  const f = await fixture(t), scene = f.plan.scenes.find(scene => scene.physics), platform = scene.physics.document.bodies[2];
  for (const change of [p => p.actors.find(a => a.instanceId === platform.instanceId).speed = 80,
    p => p.actors.find(a => a.instanceId === platform.instanceId).controls = 'arrows',
    p => p.physics.locations.bodies[2].declaration.propertyPath = '/bodies/0',
    p => p.physics.document.bodies[2].instanceId = p.physics.document.bodies[0].instanceId]) {
    const forged = structuredClone(scene); change(forged); assert.throws(() => validateScenePhysics2DPlan(forged), { errorCode: 'build_physics_invalid' });
  }
});

test('invalid saved vertical declarations block at author source without rewriting including schema5 vertical', async t => {
  const f = await fixture(t), original = JSON.parse(f.before.toString().replace(/^\uFEFF/, ''));
  for (const alter of [d => d.schemaVersion = 5, d => d.bodies[2].platformMotion = null,
    ...[0, .5, 8193, -8193, '160'].map(value => d => d.bodies[2].platformMotion.offsetY = value),
    d => d.bodies[2].platformMotion.offsetX = 0, d => d.bodies[2].platformMotion.speed = 0,
    d => d.bodies[2].platformMotion.speed = 2001, d => d.bodies[2].platformMotion.speed = '80',
    d => d.bodies[2].kind = 'sensor', d => d.bodies[2].shape = { kind: 'circle', radius: 10 }]) {
    const document = structuredClone(original); alter(document);
    const before = Buffer.from('\uFEFF' + JSON.stringify(document, null, 2).replace(/\n/g, '\r\n') + '\r\n'); await fs.writeFile(f.file, before);
    const result = await captureBuildSnapshot(f.author, f.assemblyId);
    assert.equal(result.ok, false); assert.equal(result.plan, null);
    const diagnostic = result.diagnostics.find(d => d.code === 'build_physics_invalid' && d.objectId === f.physicsId && d.sourcePath === f.physicsPath);
    assert.ok(diagnostic); assert.equal(diagnostic.propertyPath, ''); assert.equal(diagnostic.sourceRange.exact, true);
    assert.deepEqual(await fs.readFile(f.file), before);
  }
});
