import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { GODOT4_EXECUTION_ADAPTER as adapter } from '../backends/godot4-adapter.mjs';
import { generateGodotPhysicsPlanarIntentProject, godotPhysicsPlanarIntentAssemblyScripts } from '../backends/godot4-physics-planar-intent.mjs';
import { godotAssemblyScripts } from '../backends/godot4-project.mjs';
import { applyGodotSceneRetryProject } from '../backends/godot4-scene-retry.mjs';
import { applyGodotSceneRestartProject } from '../backends/godot4-scene-restart.mjs';
import { applyGodotProjectPause } from '../backends/godot4-project-pause.mjs';
import { validateGodotProjectPauseInventory } from '../backends/godot4-project-pause-inventory.mjs';
import { validateGodotSceneRestartInventory } from '../backends/godot4-scene-restart-inventory.mjs';
import { validateGodotSceneRetryInventory } from '../backends/godot4-scene-retry-inventory.mjs';
import { validateGodotCamera2DInventory } from '../backends/godot4-camera2d-inventory.mjs';
import { validateGodotHUD2DInventory } from '../backends/godot4-hud2d-inventory.mjs';
import { GODOT_ACTION_PROJECT_PAUSE_SCRIPT } from '../../engine/godot-project-pause-script.mjs';
import { validateProjectAssemblyPlan } from '../../engine/project-assembly-plan-contract.mjs';
import { runtimeProject } from './helpers/project-runtime-fixture.mjs';
import { cameraProject, cameraOn, cameraStage } from './helpers/godot-camera2d-fixture.mjs';
import { hudOn } from './helpers/godot-hud2d-fixture.mjs';
const invalid = { errorCode: 'build_project_pause_inventory_invalid' };
const retryInvalid = { errorCode: 'build_scene_retry_inventory_invalid' };
const mutableSettings = ['project.godot', 'execution-clock-original.godot'];
const autoload = '\n[autoload]\n\nVientoExecutionClock="*res://execution-clock-host.gd"\n';
const restartProject = async plan => applyGodotSceneRestartProject(await applyGodotSceneRetryProject(await generateGodotPhysicsPlanarIntentProject(plan)));
function pauseProject() {
  const plan = cameraProject(), scene = plan.scenes[0];
  scene.schemaVersion = 3; scene.behaviors = runtimeProject({ behavior: true }).scenes[0].behaviors;
  const source = scene.behaviors.sources[0];
  source.content = GODOT_ACTION_PROJECT_PAUSE_SCRIPT;
  source.sourceRevision = 'sha256:' + createHash('sha256').update(source.content).digest('hex');
  scene.behaviors.bindings[0].events = [];
  scene.behaviors.bindings[0].parameters = { action_name: 'ui_accept', paused_text: 'Paused', resume_text: 'Release controls to resume' };
  scene.requiredCapabilities = [...new Set([...scene.requiredCapabilities, 'behavior.bindings', 'behavior.gdscript', 'project.pause'])].sort();
  plan.requiredCapabilities = [...new Set(['project.scenes', ...plan.scenes.flatMap(row => row.requiredCapabilities)])].sort();
  return validateProjectAssemblyPlan(plan);
}

test('unselected pause support leaves complete 0.47 projects and standalone legacy scenes unchanged', async t => {
  const plan = cameraProject(), before = structuredClone(plan), old = await restartProject(plan), generated = await adapter.generate(plan);
  assert.deepEqual(plan, before); assert.deepEqual(generated.files, old.files); assert.deepEqual(generated.backend, old.backend);
  assert.deepEqual(generated.sourceMap, old.sourceMap); assert.deepEqual(generated.resourceFiles, old.resourceFiles);
  assert.equal(generated.backend.version, '0.47.0'); assert.equal(generated.backend.capabilities.includes('project.pause'), false);
  assert.equal([...generated.files.keys()].some(name => name.startsWith('project-pause')), false);
  const directory = await cameraStage(t, generated);
  assert.equal(await validateGodotProjectPauseInventory(directory), null); assert.ok(await validateGodotSceneRetryInventory(directory));
  const golden = JSON.parse(await fs.readFile(new URL('./fixtures/scene-model/legacy-plan-v2.json', import.meta.url))), scene = await adapter.generate(golden.plan);
  assert.equal(scene.files.has('project-pause.json'), false); assert.equal(scene.backend.capabilities.includes('project.pause'), false);
});

test('an exact official source binding adds only the pause outer layer and preserves every inner runtime byte and business protocol', async t => {
  const plan = pauseProject(), original = structuredClone(plan), old = await restartProject(plan), generated = await adapter.generate(plan);
  assert.deepEqual(plan, original); assert.equal(old.backend.version, '0.47.0'); assert.equal(generated.backend.version, '0.48.0');
  assert.ok(generated.backend.capabilities.includes('project.pause')); assert.ok(generated.backend.capabilities.includes('project.scene-restart'));
  assert.equal(generated.backend.protocolVersion, old.backend.protocolVersion); assert.deepEqual(generated.sourceMap, old.sourceMap);
  assert.deepEqual(generated.resourceFiles, old.resourceFiles);
  for (const [name, bytes] of old.files) if (!mutableSettings.includes(name)) assert.deepEqual(generated.files.get(name), bytes, name);
  assert.equal(generated.files.size - old.files.size, 6);
  assert.deepEqual(generated.files.get('project-pause-original.godot'), old.files.get('project.godot'));
  assert.deepEqual(generated.files.get('project-pause-original-clock.godot'), old.files.get('execution-clock-original.godot'));
  assert.match(generated.files.get('project.godot').toString(), /run\/main_scene="res:\/\/project-pause\.tscn"/);
  const directory = await cameraStage(t, generated), inventory = await validateGodotProjectPauseInventory(directory);
  assert.deepEqual(inventory.scripts, ['project-pause-runtime.gd', 'project-pause-input.gd']); assert.deepEqual(inventory.innerSettings, old.files.get('project.godot'));
  assert.deepEqual((await validateGodotSceneRestartInventory(directory)).scripts, ['restart-project-runtime.gd', ...inventory.scripts]);
  assert.deepEqual((await validateGodotSceneRetryInventory(directory)).scripts, ['retry-project-runtime.gd', 'restart-project-runtime.gd', ...inventory.scripts]);
  assert.deepEqual(await adapter.generate(plan), generated);
});

test('pause authenticates and unwraps the complete HUD, camera, restart and retry stack before historical script admission', async t => {
  const plan = hudOn(cameraOn(structuredClone(pauseProject()), 0, { mode: 'fixed', center: [20, 30], zoom: 2 }), 0);
  const generated = await adapter.generate(plan), directory = await cameraStage(t, generated);
  assert.match(generated.files.get('project-pause-runtime.gd').toString(), /^extends "res:\/\/restart-project-runtime\.gd"/);
  assert.match(generated.files.get('restart-project-runtime.gd').toString(), /^extends "res:\/\/retry-project-runtime\.gd"/);
  assert.match(generated.files.get('retry-project-runtime.gd').toString(), /^extends "res:\/\/hud2d-project-runtime\.gd"/);
  assert.deepEqual((await validateGodotHUD2DInventory(directory)).sceneIds, [plan.entrySceneId]);
  assert.deepEqual((await validateGodotCamera2DInventory(directory)).sceneIds, [plan.entrySceneId]);
  const scripts = await godotPhysicsPlanarIntentAssemblyScripts(directory);
  for (const name of ['project-pause-runtime.gd', 'project-pause-input.gd', 'restart-project-runtime.gd', 'retry-project-runtime.gd']) assert.equal(scripts.filter(value => value === name).length, 1);
  assert.match((await validateGodotSceneRetryInventory(directory)).innerSettings.toString(), /run\/main_scene="res:\/\/hud2d-project\.tscn"/);
});

test('pause inventory rejects every changed or missing owned byte and either active settings file before historical admission', async t => {
  const generated = await adapter.generate(pauseProject()), directory = await cameraStage(t, generated);
  const names = [...generated.files.keys()].filter(name => name.startsWith('project-pause') || mutableSettings.includes(name));
  assert.equal(names.length, 8);
  for (const name of names) {
    const file = path.join(directory, name), bytes = await fs.readFile(file);
    await fs.appendFile(file, '\n');
    await assert.rejects(validateGodotProjectPauseInventory(directory), invalid, name);
    await assert.rejects(godotAssemblyScripts(directory), retryInvalid, name + ' historical admission');
    await fs.writeFile(file, bytes); await fs.rm(file);
    await assert.rejects(validateGodotProjectPauseInventory(directory), invalid, name + ' missing');
    await fs.writeFile(file, bytes);
  }
  assert.ok(await validateGodotProjectPauseInventory(directory));
});

test('pause inventory rejects redirected entries, malformed UID sidecars, orphans and links while preserving abort identity', async t => {
  const generated = await adapter.generate(pauseProject()), directory = await cameraStage(t, generated);
  for (const name of ['project-pause-orphan.gd', 'project-pause-runtime.gd.uid', 'project-pause-input.gd.uid']) {
    const file = path.join(directory, name); await fs.writeFile(file, 'unowned');
    await assert.rejects(validateGodotProjectPauseInventory(directory), invalid); await fs.rm(file);
  }
  for (const name of ['project-pause-runtime.gd.uid', 'project-pause-input.gd.uid']) {
    const file = path.join(directory, name); await fs.writeFile(file, 'uid://valid123\n');
    assert.ok(await validateGodotProjectPauseInventory(directory)); await fs.rm(file);
  }
  const extra = path.join(directory, 'project-pause-directory'); await fs.mkdir(extra);
  await assert.rejects(validateGodotProjectPauseInventory(directory), invalid); await fs.rm(extra, { recursive: true });
  for (const name of ['project-pause-runtime.gd', 'project-pause-input.gd', 'project-pause-original.godot', 'restart-project.tscn']) {
    const file = path.join(directory, name), bytes = await fs.readFile(file), same = path.join(directory, 'identical-source.txt');
    await fs.writeFile(same, bytes); await fs.rm(file); await fs.symlink(same, file);
    await assert.rejects(validateGodotProjectPauseInventory(directory), invalid, name + ' same-byte symbolic link');
    await fs.rm(file); await fs.writeFile(file, bytes); await fs.rm(same);
  }
  const retained = path.join(directory, 'project-pause-original.godot'), bytes = await fs.readFile(retained);
  await fs.writeFile(retained, bytes.toString().replace('res://restart-project.tscn', 'res://project.tscn'));
  await assert.rejects(validateGodotProjectPauseInventory(directory), invalid); await fs.writeFile(retained, bytes);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(validateGodotProjectPauseInventory(directory, controller.signal), { name: 'AbortError' });
  assert.ok(await validateGodotProjectPauseInventory(directory));
});

test('pause supports absent scheduling settings as a symmetric pair and refuses duplicate or incomplete application atomically', async t => {
  const generated = await generateGodotPhysicsPlanarIntentProject(pauseProject());
  generated.files.delete('execution-clock-original.godot');
  generated.files.set('project.godot', Buffer.from(generated.files.get('project.godot').toString().replace(autoload, '')));
  await applyGodotSceneRetryProject(generated); await applyGodotSceneRestartProject(generated);
  const count = generated.files.size; await applyGodotProjectPause(generated);
  assert.equal(generated.files.size - count, 5); assert.equal(generated.files.has('project-pause-original-clock.godot'), false);
  const directory = await cameraStage(t, generated), inventory = await validateGodotProjectPauseInventory(directory);
  assert.equal(inventory.innerClockSettings, null); assert.ok(await validateGodotSceneRetryInventory(directory));
  const before = new Map([...generated.files].map(([name, bytes]) => [name, Buffer.from(bytes)])), backendBefore = structuredClone(generated.backend);
  await assert.rejects(applyGodotProjectPause(generated)); assert.deepEqual(generated.files, before); assert.deepEqual(generated.backend, backendBefore);
  const incomplete = await generateGodotPhysicsPlanarIntentProject(pauseProject()), incompleteBefore = new Map(incomplete.files);
  await assert.rejects(applyGodotProjectPause(incomplete), invalid); assert.deepEqual(incomplete.files, incompleteBefore);
  const unexpectedClock = path.join(directory, 'execution-clock-original.godot'); await fs.writeFile(unexpectedClock, generated.files.get('project-pause-original.godot'));
  await assert.rejects(validateGodotProjectPauseInventory(directory), invalid); await fs.rm(unexpectedClock);
  assert.ok(await validateGodotProjectPauseInventory(directory));
});

test('historical projects admit no pause-owned state and a pause layer cannot outlive its retained restart or retry runtime', async t => {
  for (const generate of [generateGodotPhysicsPlanarIntentProject, restartProject]) {
    const old = await generate(cameraProject()), directory = await cameraStage(t, old);
    assert.equal(await validateGodotProjectPauseInventory(directory), null); assert.ok(await godotPhysicsPlanarIntentAssemblyScripts(directory));
    const orphan = path.join(directory, 'project-pause-runtime.gd'); await fs.writeFile(orphan, 'extends Node2D\n');
    await assert.rejects(validateGodotProjectPauseInventory(directory), invalid); await assert.rejects(validateGodotSceneRetryInventory(directory), retryInvalid); await fs.rm(orphan);
  }
  const generated = await adapter.generate(pauseProject()), directory = await cameraStage(t, generated);
  for (const name of ['restart-project.json', 'restart-project-runtime.gd', 'retry-project-runtime.gd']) {
    const file = path.join(directory, name), bytes = await fs.readFile(file); await fs.rm(file);
    await assert.rejects(validateGodotSceneRetryInventory(directory), retryInvalid, name + ' missing inner layer'); await fs.writeFile(file, bytes);
  }
  assert.ok(await validateGodotSceneRetryInventory(directory));
});
