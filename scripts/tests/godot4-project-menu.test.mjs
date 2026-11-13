import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { runBuildProcess } from '../lib/build-process.mjs';
import { GODOT4_EXECUTION_ADAPTER as adapter } from '../backends/godot4-adapter.mjs';
import { generateGodotPhysicsPlanarIntentProject, godotPhysicsPlanarIntentAssemblyScripts } from '../backends/godot4-physics-planar-intent.mjs';
import { godotAssemblyScripts } from '../backends/godot4-project.mjs';
import { applyGodotSceneRetryProject } from '../backends/godot4-scene-retry.mjs';
import { applyGodotSceneRestartProject } from '../backends/godot4-scene-restart.mjs';
import { applyGodotProjectPause } from '../backends/godot4-project-pause.mjs';
import { applyGodotProjectMenu } from '../backends/godot4-project-menu.mjs';
import { validateGodotProjectMenuInventory } from '../backends/godot4-project-menu-inventory.mjs';
import { validateGodotProjectPauseInventory } from '../backends/godot4-project-pause-inventory.mjs';
import { validateGodotSceneRestartInventory } from '../backends/godot4-scene-restart-inventory.mjs';
import { validateGodotSceneRetryInventory } from '../backends/godot4-scene-retry-inventory.mjs';
import { validateGodotCamera2DInventory } from '../backends/godot4-camera2d-inventory.mjs';
import { validateGodotHUD2DInventory } from '../backends/godot4-hud2d-inventory.mjs';
import { GODOT_PROJECT_MENU_SCRIPT } from '../../engine/godot-project-menu-script.mjs';
import { validateProjectAssemblyPlan } from '../../engine/project-assembly-plan-contract.mjs';
import { runtimeProject } from './helpers/project-runtime-fixture.mjs';
import { cameraProject, cameraOn, cameraStage } from './helpers/godot-camera2d-fixture.mjs';
import { hudOn } from './helpers/godot-hud2d-fixture.mjs';
const invalid = { errorCode: 'build_project_menu_inventory_invalid' };
const retryInvalid = { errorCode: 'build_scene_retry_inventory_invalid' };
const mutableSettings = ['project.godot', 'execution-clock-original.godot'];
const autoload = '\n[autoload]\n\nVientoExecutionClock="*res://execution-clock-host.gd"\n';
const restartProject = async plan => applyGodotSceneRestartProject(await applyGodotSceneRetryProject(await generateGodotPhysicsPlanarIntentProject(plan)));
const pausedProject = async plan => applyGodotProjectPause(await restartProject(plan));
function menuProject() {
  const plan = cameraProject(), scene = plan.scenes[0];
  scene.schemaVersion = 3; scene.behaviors = runtimeProject({ behavior: true }).scenes[0].behaviors;
  const source = scene.behaviors.sources[0];
  source.content = GODOT_PROJECT_MENU_SCRIPT;
  source.sourceRevision = 'sha256:' + createHash('sha256').update(source.content).digest('hex');
  scene.behaviors.bindings[0].events = [];
  scene.behaviors.bindings[0].parameters = { title: 'Menu', items_json: '[{"id":"finish","label":"Exit","command":"finish"}]', display_mode: 'scene' };
  scene.requiredCapabilities = [...new Set([...scene.requiredCapabilities, 'behavior.bindings', 'behavior.gdscript', 'project.menu', 'project.pause'])].sort();
  plan.requiredCapabilities = [...new Set(['project.scenes', ...plan.scenes.flatMap(row => row.requiredCapabilities)])].sort();
  return validateProjectAssemblyPlan(plan);
}

test('unselected menu support leaves complete 0.47 projects and standalone legacy scenes unchanged', async t => {
  const plan = cameraProject(), before = structuredClone(plan), old = await restartProject(plan), generated = await adapter.generate(plan);
  assert.deepEqual(plan, before); assert.deepEqual(generated.files, old.files); assert.deepEqual(generated.backend, old.backend);
  assert.deepEqual(generated.sourceMap, old.sourceMap); assert.deepEqual(generated.resourceFiles, old.resourceFiles);
  assert.equal(generated.backend.version, '0.47.0'); assert.equal(generated.backend.capabilities.includes('project.menu'), false);
  assert.equal([...generated.files.keys()].some(name => name.startsWith('project-menu')), false);
  const directory = await cameraStage(t, generated);
  assert.equal(await validateGodotProjectMenuInventory(directory), null); assert.ok(await validateGodotSceneRetryInventory(directory));
  const golden = JSON.parse(await fs.readFile(new URL('./fixtures/scene-model/legacy-plan-v2.json', import.meta.url))), scene = await adapter.generate(golden.plan);
  assert.equal(scene.files.has('project-menu.json'), false); assert.equal(scene.backend.capabilities.includes('project.menu'), false);
});

test('an exact official source binding adds only the menu outer layer and preserves every inner runtime byte and business protocol', async t => {
  const plan = menuProject(), original = structuredClone(plan), old = await pausedProject(plan), generated = await adapter.generate(plan);
  assert.deepEqual(plan, original); assert.equal(old.backend.version, '0.48.0'); assert.equal(generated.backend.version, '0.49.0');
  assert.ok(generated.backend.capabilities.includes('project.menu')); assert.ok(generated.backend.capabilities.includes('project.scene-restart'));
  assert.equal(generated.backend.protocolVersion, old.backend.protocolVersion); assert.deepEqual(generated.sourceMap, old.sourceMap);
  assert.deepEqual(generated.resourceFiles, old.resourceFiles);
  for (const [name, bytes] of old.files) if (!mutableSettings.includes(name)) assert.deepEqual(generated.files.get(name), bytes, name);
  assert.equal(generated.files.size - old.files.size, 6);
  assert.deepEqual(generated.files.get('project-menu-original.godot'), old.files.get('project.godot'));
  assert.deepEqual(generated.files.get('project-menu-original-clock.godot'), old.files.get('execution-clock-original.godot'));
  assert.match(generated.files.get('project.godot').toString(), /run\/main_scene="res:\/\/project-menu\.tscn"/);
  const directory = await cameraStage(t, generated), inventory = await validateGodotProjectMenuInventory(directory);
  assert.deepEqual(inventory.scripts, ['project-menu-runtime.gd', 'project-menu-input.gd']); assert.deepEqual(inventory.innerSettings, old.files.get('project.godot'));
  assert.deepEqual((await validateGodotProjectPauseInventory(directory)).scripts, ['project-pause-runtime.gd', 'project-pause-input.gd', ...inventory.scripts]);
  assert.deepEqual((await validateGodotSceneRestartInventory(directory)).scripts, ['restart-project-runtime.gd', 'project-pause-runtime.gd', 'project-pause-input.gd', ...inventory.scripts]);
  assert.deepEqual((await validateGodotSceneRetryInventory(directory)).scripts, ['retry-project-runtime.gd', 'restart-project-runtime.gd', 'project-pause-runtime.gd', 'project-pause-input.gd', ...inventory.scripts]);
  assert.deepEqual(await adapter.generate(plan), generated);
});

test('menu authenticates and unwraps the complete HUD, camera, restart and retry stack before historical script admission', async t => {
  const plan = hudOn(cameraOn(structuredClone(menuProject()), 0, { mode: 'fixed', center: [20, 30], zoom: 2 }), 0);
  const generated = await adapter.generate(plan), directory = await cameraStage(t, generated);
  assert.match(generated.files.get('project-menu-runtime.gd').toString(), /^extends "res:\/\/project-pause-runtime\.gd"/);
  assert.match(generated.files.get('restart-project-runtime.gd').toString(), /^extends "res:\/\/retry-project-runtime\.gd"/);
  assert.match(generated.files.get('retry-project-runtime.gd').toString(), /^extends "res:\/\/hud2d-project-runtime\.gd"/);
  assert.deepEqual((await validateGodotHUD2DInventory(directory)).sceneIds, [plan.entrySceneId]);
  assert.deepEqual((await validateGodotCamera2DInventory(directory)).sceneIds, [plan.entrySceneId]);
  const scripts = await godotPhysicsPlanarIntentAssemblyScripts(directory);
  for (const name of ['project-menu-runtime.gd', 'project-menu-input.gd', 'project-pause-runtime.gd', 'project-pause-input.gd', 'restart-project-runtime.gd', 'retry-project-runtime.gd']) assert.equal(scripts.filter(value => value === name).length, 1);
  assert.match((await validateGodotSceneRetryInventory(directory)).innerSettings.toString(), /run\/main_scene="res:\/\/hud2d-project\.tscn"/);
});

test('menu inventory rejects every changed or missing owned byte and either active settings file before historical admission', async t => {
  const generated = await adapter.generate(menuProject()), directory = await cameraStage(t, generated);
  const names = [...generated.files.keys()].filter(name => name.startsWith('project-menu') || mutableSettings.includes(name));
  assert.equal(names.length, 8);
  for (const name of names) {
    const file = path.join(directory, name), bytes = await fs.readFile(file);
    await fs.appendFile(file, '\n');
    await assert.rejects(validateGodotProjectMenuInventory(directory), invalid, name);
    await assert.rejects(godotAssemblyScripts(directory), retryInvalid, name + ' historical admission');
    await fs.writeFile(file, bytes); await fs.rm(file);
    await assert.rejects(validateGodotProjectMenuInventory(directory), invalid, name + ' missing');
    await fs.writeFile(file, bytes);
  }
  assert.ok(await validateGodotProjectMenuInventory(directory));
});

test('menu inventory rejects redirected entries, malformed UID sidecars, orphans and links while preserving abort identity', async t => {
  const generated = await adapter.generate(menuProject()), directory = await cameraStage(t, generated);
  for (const name of ['project-menu-orphan.gd', 'project-menu-runtime.gd.uid', 'project-menu-input.gd.uid']) {
    const file = path.join(directory, name); await fs.writeFile(file, 'unowned');
    await assert.rejects(validateGodotProjectMenuInventory(directory), invalid); await fs.rm(file);
  }
  for (const name of ['project-menu-runtime.gd.uid', 'project-menu-input.gd.uid']) {
    const file = path.join(directory, name); await fs.writeFile(file, 'uid://valid123\n');
    assert.ok(await validateGodotProjectMenuInventory(directory)); await fs.rm(file);
  }
  const extra = path.join(directory, 'project-menu-directory'); await fs.mkdir(extra);
  await assert.rejects(validateGodotProjectMenuInventory(directory), invalid); await fs.rm(extra, { recursive: true });
  for (const name of ['project-menu-runtime.gd', 'project-menu-input.gd', 'project-menu-original.godot', 'project-pause.tscn']) {
    const file = path.join(directory, name), bytes = await fs.readFile(file), same = path.join(directory, 'identical-source.txt');
    await fs.writeFile(same, bytes); await fs.rm(file); await fs.symlink(same, file);
    await assert.rejects(validateGodotProjectMenuInventory(directory), invalid, name + ' same-byte symbolic link');
    await fs.rm(file); await fs.writeFile(file, bytes); await fs.rm(same);
  }
  const retained = path.join(directory, 'project-menu-original.godot'), bytes = await fs.readFile(retained);
  await fs.writeFile(retained, bytes.toString().replace('res://project-pause.tscn', 'res://project.tscn'));
  await assert.rejects(validateGodotProjectMenuInventory(directory), invalid); await fs.writeFile(retained, bytes);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(validateGodotProjectMenuInventory(directory, controller.signal), { name: 'AbortError' });
  assert.ok(await validateGodotProjectMenuInventory(directory));
});

test('menu supports absent scheduling settings as a symmetric pair and refuses duplicate or incomplete application atomically', async t => {
  const generated = await generateGodotPhysicsPlanarIntentProject(menuProject());
  generated.files.delete('execution-clock-original.godot');
  generated.files.set('project.godot', Buffer.from(generated.files.get('project.godot').toString().replace(autoload, '')));
  await applyGodotSceneRetryProject(generated); await applyGodotSceneRestartProject(generated); await applyGodotProjectPause(generated);
  const count = generated.files.size; await applyGodotProjectMenu(generated);
  assert.equal(generated.files.size - count, 5); assert.equal(generated.files.has('project-menu-original-clock.godot'), false);
  const directory = await cameraStage(t, generated), inventory = await validateGodotProjectMenuInventory(directory);
  assert.equal(inventory.innerClockSettings, null); assert.ok(await validateGodotSceneRetryInventory(directory));
  const before = new Map([...generated.files].map(([name, bytes]) => [name, Buffer.from(bytes)])), backendBefore = structuredClone(generated.backend);
  await assert.rejects(applyGodotProjectMenu(generated)); assert.deepEqual(generated.files, before); assert.deepEqual(generated.backend, backendBefore);
  const incomplete = await generateGodotPhysicsPlanarIntentProject(menuProject()), incompleteBefore = new Map(incomplete.files);
  await assert.rejects(applyGodotProjectMenu(incomplete), invalid); assert.deepEqual(incomplete.files, incompleteBefore);
  const unexpectedClock = path.join(directory, 'execution-clock-original.godot'); await fs.writeFile(unexpectedClock, generated.files.get('project-menu-original.godot'));
  await assert.rejects(validateGodotProjectMenuInventory(directory), invalid); await fs.rm(unexpectedClock);
  assert.ok(await validateGodotProjectMenuInventory(directory));
});

test('historical projects admit no menu-owned state and a menu layer cannot outlive its retained restart or retry runtime', async t => {
  for (const generate of [generateGodotPhysicsPlanarIntentProject, restartProject, pausedProject]) {
    const old = await generate(cameraProject()), directory = await cameraStage(t, old);
    assert.equal(await validateGodotProjectMenuInventory(directory), null); assert.ok(await godotPhysicsPlanarIntentAssemblyScripts(directory));
    const orphan = path.join(directory, 'project-menu-runtime.gd'); await fs.writeFile(orphan, 'extends Node2D\n');
    await assert.rejects(validateGodotProjectMenuInventory(directory), invalid); await assert.rejects(validateGodotSceneRetryInventory(directory), retryInvalid); await fs.rm(orphan);
  }
  const generated = await adapter.generate(menuProject()), directory = await cameraStage(t, generated);
  for (const name of ['project-pause.json', 'project-pause-runtime.gd', 'restart-project.json', 'restart-project-runtime.gd', 'retry-project-runtime.gd']) {
    const file = path.join(directory, name), bytes = await fs.readFile(file); await fs.rm(file);
    await assert.rejects(validateGodotSceneRetryInventory(directory), retryInvalid, name + ' missing inner layer'); await fs.writeFile(file, bytes);
  }
  assert.ok(await validateGodotSceneRetryInventory(directory));
});

test('native menu refuses backend numeric underflow without reserving state and normalizes only zero mantissas in a parser copy', { skip: !process.env.VIENTO_GODOT_BIN ? 'Set VIENTO_GODOT_BIN for actual Godot numeric capability verification' : false, timeout: 45000 }, async t => {
  const generated = await applyGodotProjectMenu(await pausedProject(cameraProject())), directory = await cameraStage(t, generated);
  const source = `extends "res://project-menu-runtime.gd"
func _ready() -> void:
\tsuper._ready()
\tvar behavior := Node.new()
\tcurrent.add_child(behavior)
\tmake_port(visit_index, {"bindingId":"00000000-0000-0000-0000-000000000001","instanceId":"00000000-0000-0000-0000-000000000002","objectId":"00000000-0000-0000-0000-000000000003"}, behavior)
\tvar port = behavior.get_meta("viento_project_menu")
\tvar before_budget = execution_budget.snapshot()
\tvar before_state := shared_state.duplicate(true)
\tvar before_revision := state_revision
\tvar refused: Array = []
\tfor literal in ["5e-324", "2.2250738585072014e-308", "1.2345678901234567e-300"]:
\t\tvar text: String = '[{"id":"r","label":"R","command":"restart","values":{"value":' + literal + '}}]'
\t\tassert(not port.configure("Menu", text, "scene"))
\t\tassert(menu_controllers.is_empty() and not menu_ports[port.get_instance_id()].has("configuration"))
\t\tassert(execution_budget.snapshot() == before_budget and shared_state == before_state and state_revision == before_revision)
\t\trefused.push_back(literal)
\tvar accepted: Array = []
\tfor literal in ["1", "1.0", "1e0", "1e-300", "0.30000000000000004", "0", "-0", "0e9999", "-0.000e9999", "0e-9999"]:
\t\tvar text: String = '[{"id":"r","label":"R","command":"restart","values":{"value":' + literal + '}}]'
\t\tvar parsed = menu_parse(text, "scene")
\t\tassert(parsed != null)
\t\tif literal.begins_with("0e") or literal.begins_with("-0.000"):
\t\t\tassert(parsed[0]["values"]["value"] == 0)
\t\taccepted.push_back(literal)
\tvar retained := '[{"id":"r","label":"R","command":"restart","values":{"value":0e9999}}]'
\tassert(port.configure("Menu", retained, "scene"))
\tassert(menu_controllers["scene"]["items_json"] == retained)
\tassert(menu_controllers["scene"]["items"][0]["values"]["value"] == 0)
\tassert(execution_budget.snapshot() == before_budget and shared_state == before_state and state_revision == before_revision)
\tprint("MENU_NUMERIC_CAPABILITY:" + JSON.stringify({"ok":true,"reason":"godot-number-underflow","refused":refused,"accepted":accepted,"originalTextPreserved":true,"budgetUnchanged":true},"",true,true))
\tfinish_project()
`;
  await fs.writeFile(path.join(directory, 'menu-numeric-probe.gd'), source);
  await fs.writeFile(path.join(directory, 'menu-numeric-probe.tscn'), '[gd_scene load_steps=2 format=3]\n\n[ext_resource type="Script" path="res://menu-numeric-probe.gd" id="1"]\n\n[node name="VientoProject" type="Node2D"]\nscript = ExtResource("1")\n');
  const result = await runBuildProcess(process.env.VIENTO_GODOT_BIN, ['--path', directory, '--headless', 'res://menu-numeric-probe.tscn'], { cwd: directory, timeoutMs: 30000, env: { ...process.env, XDG_CONFIG_HOME: path.join(directory, 'xdg/config'), XDG_DATA_HOME: path.join(directory, 'xdg/data'), XDG_CACHE_HOME: path.join(directory, 'xdg/cache') } });
  assert.equal(result.status, 'succeeded', result.stdout + result.stderr); assert.doesNotMatch(result.stdout + result.stderr, /SCRIPT ERROR:|ERROR:|WARNING:/);
  const rows = result.stdout.split('\n').filter(line => line.startsWith('MENU_NUMERIC_CAPABILITY:')).map(line => JSON.parse(line.slice('MENU_NUMERIC_CAPABILITY:'.length)));
  assert.equal(rows.length, 1); assert.equal(rows[0].ok, true); assert.equal(rows[0].originalTextPreserved, true); assert.equal(rows[0].budgetUnchanged, true);
  assert.deepEqual(rows[0].refused, ['5e-324', '2.2250738585072014e-308', '1.2345678901234567e-300']); assert.equal(rows[0].accepted.length, 10);
});
