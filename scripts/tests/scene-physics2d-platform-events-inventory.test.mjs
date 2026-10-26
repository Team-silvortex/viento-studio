import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { scenePhysics2DPlatformEventsAuthor } from './helpers/scene-physics2d-platform-events-author-fixture.mjs';
import { captureBuildSnapshot } from '../adapters/node-build-snapshot.mjs';
import { generateGodotPhysicsPlatformMotionProject } from '../backends/godot4-physics-platform-motion.mjs';
import { generateGodotPhysicsPlatformEventsProject, godotPhysicsPlatformEventsAssemblyScripts } from '../backends/godot4-physics-platform-events.mjs';
const invalid = { errorCode: 'build_physics_platform_events_invalid' };
async function ready(t, options) {
  const f = await scenePhysics2DPlatformEventsAuthor(t, options), captured = await captureBuildSnapshot(f.author, f.assemblyId);
  assert.equal(captured.ok, true, JSON.stringify(captured.diagnostics));
  return { ...f, plan: captured.plan, generated: await generateGodotPhysicsPlatformEventsProject(captured.plan) };
}
async function stage(f, generated = f.generated) {
  const directory = await fs.mkdtemp(path.join(f.temporary, 'endpoint-inventory-'));
  for (const [name, bytes] of generated.files) {
    await fs.mkdir(path.dirname(path.join(directory, name)), { recursive: true }); await fs.writeFile(path.join(directory, name), bytes);
  }
  return directory;
}
test('endpoint inventory verifies every generated and original scene byte and the complete historical chain', async t => {
  const f = await ready(t), directory = await stage(f);
  const names = [...f.generated.files.keys()].filter(name => name.includes('platform-events') || name.endsWith('/main.tscn') && name.includes(f.sceneIds[0]) || name.endsWith('/platform-motion-original.gd') || name === 'platform-motion-helper.gd');
  for (const name of names) {
    const file = path.join(directory, name), bytes = await fs.readFile(file);
    await fs.rm(file); await assert.rejects(godotPhysicsPlatformEventsAssemblyScripts(directory), invalid, name + ' missing');
    await fs.symlink(path.join(f.author, f.physicsPath), file); await assert.rejects(godotPhysicsPlatformEventsAssemblyScripts(directory), invalid, name + ' linked');
    await fs.rm(file); await fs.writeFile(file, Buffer.concat([bytes, Buffer.from(name.endsWith('.json') ? '\n{}' : '\n# changed\n')]));
    await assert.rejects(godotPhysicsPlatformEventsAssemblyScripts(directory), invalid, name + ' changed'); await fs.writeFile(file, bytes);
  }
  assert.ok(await godotPhysicsPlatformEventsAssemblyScripts(directory));
});
test('endpoint inventory rejects fabricated scenes, duplicate membership and redirected wrapper identity', async t => {
  const f = await ready(t), directory = await stage(f), file = path.join(directory,'platform-events-project.json'), bytes = await fs.readFile(file), manifest = JSON.parse(bytes);
  for (const value of [{...manifest,extra:true},{...manifest,schemaVersion:2},{...manifest,sceneIds:[]},{...manifest,sceneIds:[f.platformInstanceId]},{...manifest,sceneIds:[...manifest.sceneIds,...manifest.sceneIds]}]) {
    await fs.writeFile(file, JSON.stringify(value)); await assert.rejects(godotPhysicsPlatformEventsAssemblyScripts(directory), invalid);
  }
  await fs.writeFile(file, bytes);
  const wrapper = path.join(directory,`scenes/${f.sceneIds[0]}/platform-events-scene.gd`), source = await fs.readFile(wrapper, 'utf8');
  await fs.writeFile(wrapper, source.replace(f.platformInstanceId, f.instanceId));
  await assert.rejects(godotPhysicsPlatformEventsAssemblyScripts(directory), invalid);
});
test('endpoint layers cannot be orphaned in a frozen motion build and old builds remain readable', async t => {
  const f = await ready(t), old = await generateGodotPhysicsPlatformMotionProject(f.plan), directory = await stage(f, old);
  assert.ok(await godotPhysicsPlatformEventsAssemblyScripts(directory));
  for (const [name, bytes] of f.generated.files) if (name.includes('platform-events')) {
    const file = path.join(directory, name); await fs.writeFile(file, bytes);
    await assert.rejects(godotPhysicsPlatformEventsAssemblyScripts(directory), invalid, name); await fs.rm(file);
  }
  assert.ok(await godotPhysicsPlatformEventsAssemblyScripts(directory));
});
test('no moving platform produces byte-identical historical output without mutating schema 5 input', async t => {
  const f = await ready(t, { enabled:false,consumers:false }); f.plan = structuredClone(f.plan);
  for (const scene of f.plan.scenes) {
    scene.requiredCapabilities = scene.requiredCapabilities.filter(value => value !== 'physics.platform-motion2d');
    for (const body of scene.physics?.document.bodies || []) delete body.platformMotion;
  }
  f.plan.requiredCapabilities = f.plan.requiredCapabilities.filter(value => value !== 'physics.platform-motion2d');
  const before = structuredClone(f.plan), generated = await generateGodotPhysicsPlatformEventsProject(f.plan), old = await generateGodotPhysicsPlatformMotionProject(f.plan);
  assert.deepEqual(f.plan, before); assert.deepEqual([...generated.files], [...old.files]); assert.deepEqual(generated.backend, old.backend); assert.deepEqual(generated.sourceMap, old.sourceMap);
  await assert.rejects(generateGodotPhysicsPlatformEventsProject(f.plan.scenes[0]), { errorCode:'build_physics_requires_project' });
});
