import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { scenePhysics2DPlatformMotionAuthor } from './helpers/scene-physics2d-platform-motion-author-fixture.mjs';
import { captureBuildSnapshot } from '../adapters/node-build-snapshot.mjs';
import { generateGodotPhysicsDropThroughProject } from '../backends/godot4-physics-drop-through.mjs';
import { generateGodotPhysicsPlatformMotionProject, godotPhysicsPlatformMotionAssemblyScripts } from '../backends/godot4-physics-platform-motion.mjs';
const invalid = { errorCode: 'build_physics_platform_motion_invalid' };
async function ready(t, options) {
  const f = await scenePhysics2DPlatformMotionAuthor(t, options), captured = await captureBuildSnapshot(f.author, f.assemblyId);
  assert.equal(captured.ok, true, JSON.stringify(captured.diagnostics));
  return { ...f, plan: captured.plan, generated: await generateGodotPhysicsPlatformMotionProject(captured.plan) };
}
async function stage(f, generated = f.generated) {
  const directory = await fs.mkdtemp(path.join(f.temporary, 'platform-inventory-'));
  for (const [name, bytes] of generated.files) {
    await fs.mkdir(path.dirname(path.join(directory, name)), { recursive: true }); await fs.writeFile(path.join(directory, name), bytes);
  }
  return directory;
}
function legacyPlan(plan) {
  const copy = structuredClone(plan); copy.requiredCapabilities = copy.requiredCapabilities.filter(c => c !== 'physics.platform-motion2d');
  for (const scene of copy.scenes) {
    scene.requiredCapabilities = scene.requiredCapabilities.filter(c => c !== 'physics.platform-motion2d');
    if (scene.physics?.document.schemaVersion === 5) { scene.physics.document.schemaVersion = 4; for (const body of scene.physics.document.bodies) delete body.platformMotion; }
  }
  return copy;
}
test('platform extension preserves every historical generated file outside its declared runtime projection', async t => {
  const f = await ready(t), before = structuredClone(f.plan), old = await generateGodotPhysicsDropThroughProject(legacyPlan(f.plan));
  assert.deepEqual(f.plan, before); assert.deepEqual(f.generated.sourceMap, old.sourceMap); assert.equal(f.generated.backend.protocolVersion, old.backend.protocolVersion);
  const id = f.plan.scenes.find(scene => scene.physics?.document.bodies.some(body => body.platformMotion)).scene.objectId;
  for (const [name, bytes] of old.files) {
    const mapped = name === `scenes/${id}/runtime.gd` ? `scenes/${id}/platform-motion-original.gd`
      : name === `scenes/${id}/one-way-original.gd` ? `scenes/${id}/platform-motion-one-way-original.gd` : name;
    assert.deepEqual(f.generated.files.get(mapped), bytes, name);
  }
  const inventory = await godotPhysicsPlatformMotionAssemblyScripts(await stage(f));
  for (const name of f.generated.files.keys()) if (name.endsWith('.gd')) assert.ok(inventory.includes(name), name);
  assert.equal(new Set(inventory).size, inventory.length);
  await assert.rejects(generateGodotPhysicsPlatformMotionProject(f.plan.scenes[0]), { errorCode: 'build_physics_requires_project' });
});

test('platform inventory rejects missing, redirected and substituted generated helpers and historical originals', async t => {
  const f = await ready(t), directory = await stage(f);
  const names = [...f.generated.files.keys()].filter(name => name.includes('platform-motion') && (name.endsWith('.gd') || name.endsWith('project.json')));
  for (const name of names) {
    const file = path.join(directory, name), bytes = await fs.readFile(file);
    await fs.rm(file); await assert.rejects(godotPhysicsPlatformMotionAssemblyScripts(directory), invalid, name + ' missing');
    await fs.symlink(path.join(f.author, f.physicsPath), file); await assert.rejects(godotPhysicsPlatformMotionAssemblyScripts(directory), invalid, name + ' linked');
    await fs.rm(file); await fs.writeFile(file, Buffer.concat([bytes, Buffer.from(name.endsWith('.gd') ? '\n# substituted\n' : '\n{}')]));
    await assert.rejects(godotPhysicsPlatformMotionAssemblyScripts(directory), invalid, name + ' substituted'); await fs.writeFile(file, bytes);
  }
  assert.ok(await godotPhysicsPlatformMotionAssemblyScripts(directory));
});

test('platform inventory validates exact scene membership, body identities, motion bounds and gravity carrier scope', async t => {
  const f = await ready(t), directory = await stage(f), name = [...f.generated.files.keys()].find(name => name.endsWith('/platform-motion.json'));
  const file = path.join(directory, name), bytes = await fs.readFile(file), original = JSON.parse(bytes);
  for (const edit of [v => { v.extra = true; }, v => { v.schemaVersion = 2; }, v => { v.sceneObjectId = f.platformInstanceId; }, v => { v.bodies = []; },
    v => { v.bodies.push(v.bodies[0]); }, v => { v.bodies[0].instanceId = f.instanceId; }, v => { v.bodies[0].bodyId = f.otherBodyId; },
    v => { v.bodies[0].platformMotion.kind = 'vertical'; }, v => { v.bodies[0].platformMotion.offsetX = 0; }, v => { v.bodies[0].platformMotion.offsetX = 8193; },
    v => { v.bodies[0].platformMotion.speed = 2001; }, v => { v.bodies[0].platformMotion.speed = 0; }, v => { v.bodies[0].platformMotion.extra = true; },
    v => { v.characters = []; }, v => { v.characters.reverse(); }, v => { v.characters.push(v.characters[0]); }]) {
    const changed = structuredClone(original); edit(changed); await fs.writeFile(file, JSON.stringify(changed));
    await assert.rejects(godotPhysicsPlatformMotionAssemblyScripts(directory), invalid);
  }
  await fs.writeFile(file, bytes);
  const manifestFile = path.join(directory, 'platform-motion-project.json'), manifestBytes = await fs.readFile(manifestFile), manifest = JSON.parse(manifestBytes);
  for (const changed of [{ ...manifest, extra: 1 }, { ...manifest, schemaVersion: 2 }, { ...manifest, sceneIds: [] }, { ...manifest, sceneIds: [...manifest.sceneIds, ...manifest.sceneIds] }, { ...manifest, sceneIds: [f.platformInstanceId] }]) {
    await fs.writeFile(manifestFile, JSON.stringify(changed)); await assert.rejects(godotPhysicsPlatformMotionAssemblyScripts(directory), invalid);
  }
  await fs.writeFile(manifestFile, manifestBytes); assert.ok(await godotPhysicsPlatformMotionAssemblyScripts(directory));
});

test('platform inventory rejects orphaned motion layers in unchanged historical projects', async t => {
  const f = await ready(t), old = await generateGodotPhysicsDropThroughProject(legacyPlan(f.plan)), directory = await stage(f, old);
  assert.ok(await godotPhysicsPlatformMotionAssemblyScripts(directory));
  for (const [name, bytes] of f.generated.files) if (name.includes('platform-motion')) {
    const file = path.join(directory, name); await fs.writeFile(file, bytes);
    await assert.rejects(godotPhysicsPlatformMotionAssemblyScripts(directory), invalid, name);
    await fs.rm(file);
  }
  assert.ok(await godotPhysicsPlatformMotionAssemblyScripts(directory));
});

test('platform runtime tampering cannot hide behind unchanged historical inventory and no-motor scenes retain coverage', async t => {
  for (const noCharacters of [false, true]) {
    const f = await ready(t, { noCharacters, consumers: false }), directory = await stage(f);
    const runtimeName = [...f.generated.files.keys()].find(name => name.endsWith('/platform-motion-original.gd')).replace('platform-motion-original.gd', 'runtime.gd');
    const runtime = path.join(directory, runtimeName), bytes = await fs.readFile(runtime);
    await fs.writeFile(runtime, Buffer.concat([bytes, Buffer.from('\n# edited movement\n')]));
    await assert.rejects(godotPhysicsPlatformMotionAssemblyScripts(directory), invalid);
    await fs.writeFile(runtime, bytes); assert.ok(await godotPhysicsPlatformMotionAssemblyScripts(directory));
  }
});
