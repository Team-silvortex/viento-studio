import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { GODOT4_EXECUTION_ADAPTER as adapter } from '../backends/godot4-adapter.mjs';
import { generateGodotPhysicsPlanarIntentProject, godotPhysicsPlanarIntentAssemblyScripts } from '../backends/godot4-physics-planar-intent.mjs';
import { applyGodotSceneRetryProject } from '../backends/godot4-scene-retry.mjs';
import { applyGodotSceneRestartProject } from '../backends/godot4-scene-restart.mjs';
import { validateGodotSceneRestartInventory } from '../backends/godot4-scene-restart-inventory.mjs';
import { validateGodotSceneRetryInventory } from '../backends/godot4-scene-retry-inventory.mjs';
import { validateGodotCamera2DInventory } from '../backends/godot4-camera2d-inventory.mjs';
import { validateGodotHUD2DInventory } from '../backends/godot4-hud2d-inventory.mjs';
import { godotAssemblyScripts } from '../backends/godot4-project.mjs';
import { cameraProject, cameraOn, cameraStage } from './helpers/godot-camera2d-fixture.mjs';
import { hudOn } from './helpers/godot-hud2d-fixture.mjs';
const invalid = { errorCode: 'build_scene_restart_inventory_invalid' };
const retryInvalid = { errorCode: 'build_scene_retry_inventory_invalid' };
const mutableSettings = ['project.godot', 'execution-clock-original.godot'];
const retryProject = async plan => applyGodotSceneRetryProject(await generateGodotPhysicsPlanarIntentProject(plan));

test('new projects add an independent restart port outside byte-identical retry and scene layers without changing business protocols', async t => {
  const plan = cameraProject(), original = structuredClone(plan), old = await retryProject(plan), generated = await adapter.generate(plan);
  assert.deepEqual(plan, original); assert.equal(old.backend.version, '0.46.0'); assert.equal(generated.backend.version, '0.47.0');
  assert.ok(generated.backend.capabilities.includes('project.scene-restart')); assert.ok(generated.backend.capabilities.includes('project.scene-retry'));
  assert.equal(generated.backend.protocolVersion, old.backend.protocolVersion);
  assert.deepEqual(generated.sourceMap, old.sourceMap); assert.deepEqual(generated.resourceFiles, old.resourceFiles);
  for (const [name, bytes] of old.files) if (!mutableSettings.includes(name)) assert.deepEqual(generated.files.get(name), bytes, name);
  assert.deepEqual(generated.files.get('restart-original.godot'), old.files.get('project.godot'));
  assert.deepEqual(generated.files.get('restart-original-clock.godot'), old.files.get('execution-clock-original.godot'));
  assert.match(generated.files.get('project.godot').toString(), /run\/main_scene="res:\/\/restart-project\.tscn"/);
  const directory = await cameraStage(t, generated), inventory = await validateGodotSceneRestartInventory(directory);
  assert.deepEqual(inventory.scripts, ['restart-project-runtime.gd']); assert.deepEqual(inventory.innerSettings, old.files.get('project.godot'));
  const retry = await validateGodotSceneRetryInventory(directory);
  assert.deepEqual(retry.scripts, ['retry-project-runtime.gd', 'restart-project-runtime.gd']);
  const scripts = await godotPhysicsPlanarIntentAssemblyScripts(directory);
  assert.ok(scripts.includes('restart-project-runtime.gd')); assert.ok(scripts.includes('retry-project-runtime.gd'));
  assert.deepEqual(await adapter.generate(plan), generated);
});

test('restart composes with camera and HUD while complete nested inventories retain the original factories and settings', async t => {
  const plan = hudOn(cameraOn(cameraProject(), 0, { mode: 'fixed', center: [20, 30], zoom: 2 }), 0);
  const generated = await adapter.generate(plan), directory = await cameraStage(t, generated);
  assert.match(generated.files.get('retry-project-runtime.gd').toString(), /^extends "res:\/\/hud2d-project-runtime\.gd"/);
  assert.match(generated.files.get('restart-project-runtime.gd').toString(), /^extends "res:\/\/retry-project-runtime\.gd"/);
  assert.deepEqual((await validateGodotHUD2DInventory(directory)).sceneIds, [plan.entrySceneId]);
  assert.deepEqual((await validateGodotCamera2DInventory(directory)).sceneIds, [plan.entrySceneId]);
  assert.ok((await godotPhysicsPlanarIntentAssemblyScripts(directory)).includes('restart-project-runtime.gd'));
  const oldRetry = await validateGodotSceneRetryInventory(directory);
  assert.match(oldRetry.innerSettings.toString(), /run\/main_scene="res:\/\/hud2d-project\.tscn"/);
});

test('restart inventory rejects every changed or missing owned byte and both active settings before admitting historical scripts', async t => {
  const generated = await adapter.generate(cameraProject()), directory = await cameraStage(t, generated);
  const names = [...generated.files.keys()].filter(name => name.startsWith('restart-') || mutableSettings.includes(name));
  for (const name of names) {
    const file = path.join(directory, name), bytes = await fs.readFile(file);
    await fs.appendFile(file, '\n');
    await assert.rejects(validateGodotSceneRestartInventory(directory), invalid, name);
    await assert.rejects(godotAssemblyScripts(directory), retryInvalid, `${name} historical admission`);
    await fs.writeFile(file, bytes); await fs.rm(file);
    await assert.rejects(validateGodotSceneRestartInventory(directory), invalid, `${name} missing`);
    await fs.writeFile(file, bytes);
  }
  assert.ok(await validateGodotSceneRestartInventory(directory));
});

test('restart inventory rejects redirected inner entries, malformed sidecars, links and directories and preserves abort identity', async t => {
  const generated = await adapter.generate(cameraProject()), directory = await cameraStage(t, generated);
  for (const name of ['restart-orphan.gd', 'restart-project-runtime.gd.uid']) {
    const file = path.join(directory, name); await fs.writeFile(file, 'unowned');
    await assert.rejects(validateGodotSceneRestartInventory(directory), invalid); await fs.rm(file);
  }
  const uid = path.join(directory, 'restart-project-runtime.gd.uid'); await fs.writeFile(uid, 'uid://valid123\n');
  assert.ok(await validateGodotSceneRestartInventory(directory)); await fs.rm(uid);
  const extra = path.join(directory, 'restart-directory'); await fs.mkdir(extra);
  await assert.rejects(validateGodotSceneRestartInventory(directory), invalid); await fs.rm(extra, { recursive: true });
  for (const name of ['restart-project-runtime.gd', 'restart-original.godot', 'retry-project.tscn']) {
    const file = path.join(directory, name), bytes = await fs.readFile(file); await fs.rm(file);
    await fs.symlink(path.join(directory, 'project-runtime.gd'), file);
    await assert.rejects(validateGodotSceneRestartInventory(directory), invalid, `${name} symbolic link`);
    await fs.rm(file); await fs.writeFile(file, bytes);
  }
  const original = path.join(directory, 'restart-original.godot'), bytes = await fs.readFile(original);
  await fs.writeFile(original, bytes.toString().replace('res://retry-project.tscn', 'res://project.tscn'));
  await assert.rejects(validateGodotSceneRestartInventory(directory), invalid); await fs.writeFile(original, bytes);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(validateGodotSceneRestartInventory(directory, controller.signal), { name: 'AbortError' });
  assert.ok(await validateGodotSceneRestartInventory(directory));
});

test('legacy projects and retry-only projects admit no restart state; a complete restart cannot outlive its retry layer', async t => {
  for (const generate of [generateGodotPhysicsPlanarIntentProject, retryProject]) {
    const old = await generate(cameraProject()), directory = await cameraStage(t, old);
    assert.equal(await validateGodotSceneRestartInventory(directory), null); assert.ok(await godotAssemblyScripts(directory));
    const orphan = path.join(directory, 'restart-project-runtime.gd'); await fs.writeFile(orphan, 'extends Node2D\n');
    await assert.rejects(validateGodotSceneRestartInventory(directory), invalid);
    await assert.rejects(validateGodotSceneRetryInventory(directory), retryInvalid); await fs.rm(orphan);
  }
  const generated = await adapter.generate(cameraProject()), directory = await cameraStage(t, generated);
  await fs.rm(path.join(directory, 'retry-project.json'));
  await assert.rejects(validateGodotSceneRestartInventory(directory), invalid);
  await assert.rejects(validateGodotSceneRetryInventory(directory), retryInvalid);
  const golden = JSON.parse(await fs.readFile(new URL('./fixtures/scene-model/legacy-plan-v2.json', import.meta.url))), scene = await adapter.generate(golden.plan);
  assert.equal(scene.files.has('restart-project.json'), false); assert.equal(scene.backend.capabilities.includes('project.scene-restart'), false);
});

test('restart admission supports absent scheduling settings and rejects duplicate application before changing any files', async t => {
  const generated = await generateGodotPhysicsPlanarIntentProject(cameraProject());
  generated.files.delete('execution-clock-original.godot');
  generated.files.set('project.godot', Buffer.from(generated.files.get('project.godot').toString().replace('\n[autoload]\n\nVientoExecutionClock="*res://execution-clock-host.gd"\n', '')));
  await applyGodotSceneRetryProject(generated); await applyGodotSceneRestartProject(generated);
  assert.equal(generated.files.has('restart-original-clock.godot'), false);
  const directory = await cameraStage(t, generated), inventory = await validateGodotSceneRestartInventory(directory);
  assert.equal(inventory.innerClockSettings, null); assert.ok(await validateGodotSceneRetryInventory(directory));
  const before = new Map([...generated.files].map(([name, bytes]) => [name, Buffer.from(bytes)]));
  await assert.rejects(applyGodotSceneRestartProject(generated)); assert.deepEqual(generated.files, before);
  const incomplete = await generateGodotPhysicsPlanarIntentProject(cameraProject());
  const beforeIncomplete = new Map([...incomplete.files].map(([name, bytes]) => [name, Buffer.from(bytes)]));
  await assert.rejects(applyGodotSceneRestartProject(incomplete), invalid); assert.deepEqual(incomplete.files, beforeIncomplete);
});
