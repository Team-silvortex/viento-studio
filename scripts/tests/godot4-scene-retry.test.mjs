import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { GODOT4_EXECUTION_ADAPTER as adapter } from '../backends/godot4-adapter.mjs';
import { generateGodotPhysicsPlanarIntentProject } from '../backends/godot4-physics-planar-intent.mjs';
import { godotAssemblyScripts } from '../backends/godot4-project.mjs';
import { validateGodotSceneRetryInventory } from '../backends/godot4-scene-retry-inventory.mjs';
import { validateGodotCamera2DInventory } from '../backends/godot4-camera2d-inventory.mjs';
import { validateGodotHUD2DInventory } from '../backends/godot4-hud2d-inventory.mjs';
import { cameraProject, cameraOn, cameraStage } from './helpers/godot-camera2d-fixture.mjs';
import { hudOn } from './helpers/godot-hud2d-fixture.mjs';
const invalid = { errorCode: 'build_scene_retry_inventory_invalid' };

test('every new project exposes a separate retry port while all historical scripts, scenes and business protocol remain exact', async t => {
  const plan = cameraProject(), original = structuredClone(plan), old = await generateGodotPhysicsPlanarIntentProject(plan), generated = await adapter.generate(plan);
  assert.deepEqual(plan, original); assert.equal(generated.backend.version, '0.47.0');
  assert.ok(generated.backend.capabilities.includes('project.scene-retry')); assert.equal(generated.backend.protocolVersion, old.backend.protocolVersion);
  assert.deepEqual(generated.sourceMap, old.sourceMap); assert.deepEqual(generated.resourceFiles, old.resourceFiles);
  for (const [name, bytes] of old.files) if (!['project.godot', 'execution-clock-original.godot'].includes(name)) assert.deepEqual(generated.files.get(name), bytes, name);
  assert.deepEqual(generated.files.get('retry-original.godot'), old.files.get('project.godot'));
  assert.deepEqual(generated.files.get('retry-original-clock.godot'), old.files.get('execution-clock-original.godot'));
  assert.match(generated.files.get('project.godot').toString(), /run\/main_scene="res:\/\/restart-project\.tscn"/);
  assert.match(generated.files.get('restart-original.godot').toString(), /run\/main_scene="res:\/\/retry-project\.tscn"/);
  assert.match(generated.files.get('retry-project-runtime.gd').toString(), /^extends "res:\/\/project-runtime\.gd"/);
  const directory = await cameraStage(t, generated), inventory = await validateGodotSceneRetryInventory(directory);
  assert.deepEqual(inventory.scripts, ['retry-project-runtime.gd', 'restart-project-runtime.gd']); assert.deepEqual(inventory.innerSettings, old.files.get('project.godot'));
  assert.ok(await godotAssemblyScripts(directory)); assert.deepEqual(await adapter.generate(plan), generated);
});

test('retry extends the selected camera and HUD host without replacing their original entry, factory or inventory', async t => {
  const plan = hudOn(cameraOn(cameraProject(), 0, { mode: 'fixed', center: [20, 30], zoom: 2 }), 0);
  const generated = await adapter.generate(plan), directory = await cameraStage(t, generated);
  assert.match(generated.files.get('retry-project-runtime.gd').toString(), /^extends "res:\/\/hud2d-project-runtime\.gd"/);
  assert.match(generated.files.get('retry-original.godot').toString(), /run\/main_scene="res:\/\/hud2d-project\.tscn"/);
  assert.deepEqual((await validateGodotHUD2DInventory(directory)).sceneIds, [plan.entrySceneId]);
  assert.deepEqual((await validateGodotCamera2DInventory(directory)).sceneIds, [plan.entrySceneId]);
  assert.ok(await godotAssemblyScripts(directory));
});

test('retry inventory rejects changed, missing, redirected, orphaned and malformed owned files before historical script admission', async t => {
  const generated = await adapter.generate(cameraProject()), directory = await cameraStage(t, generated);
  const names = [...generated.files.keys()].filter(name => name.startsWith('retry-') || ['project.godot', 'execution-clock-original.godot'].includes(name));
  for (const name of names) {
    const file = path.join(directory, name), bytes = await fs.readFile(file);
    await fs.appendFile(file, '\n'); await assert.rejects(validateGodotSceneRetryInventory(directory), invalid, name);
    await assert.rejects(godotAssemblyScripts(directory), invalid, `${name} old entry gate`);
    await fs.writeFile(file, bytes); await fs.rm(file); await assert.rejects(validateGodotSceneRetryInventory(directory), invalid, `${name} missing`); await fs.writeFile(file, bytes);
  }
  for (const name of ['retry-orphan.gd', 'retry-project-runtime.gd.uid']) {
    const file = path.join(directory, name); await fs.writeFile(file, 'unowned'); await assert.rejects(validateGodotSceneRetryInventory(directory), invalid); await fs.rm(file);
  }
  const uid = path.join(directory, 'retry-project-runtime.gd.uid'); await fs.writeFile(uid, 'uid://valid123\n'); assert.ok(await validateGodotSceneRetryInventory(directory)); await fs.rm(uid);
  const script = path.join(directory, 'retry-project-runtime.gd'); await fs.rm(script); await fs.symlink(path.join(directory, 'project-runtime.gd'), script);
  await assert.rejects(validateGodotSceneRetryInventory(directory), invalid); await fs.rm(script); await fs.writeFile(script, generated.files.get('retry-project-runtime.gd'));
  assert.ok(await validateGodotSceneRetryInventory(directory));
});

test('legacy projects admit no retry state until a complete layer exists, and scene-only generators keep their historical bytes', async t => {
  const old = await generateGodotPhysicsPlanarIntentProject(cameraProject()), directory = await cameraStage(t, old);
  assert.equal(await validateGodotSceneRetryInventory(directory), null); assert.ok(await godotAssemblyScripts(directory));
  await fs.writeFile(path.join(directory, 'retry-project-runtime.gd'), 'extends Node2D\n');
  await assert.rejects(validateGodotSceneRetryInventory(directory), invalid);
  const golden = JSON.parse(await fs.readFile(new URL('./fixtures/scene-model/legacy-plan-v2.json', import.meta.url)));
  const scene = await adapter.generate(golden.plan);
  assert.equal(scene.files.has('retry-project.json'), false); assert.equal(scene.backend.capabilities.includes('project.scene-retry'), false);
});
