import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { GODOT4_EXECUTION_ADAPTER as adapter } from '../backends/godot4-adapter.mjs';
import { validateGodotHUD2DInventory } from '../backends/godot4-hud2d-inventory.mjs';
import { validateGodotCamera2DInventory } from '../backends/godot4-camera2d-inventory.mjs';
import { cameraProject, cameraOn, cameraStage } from './helpers/godot-camera2d-fixture.mjs';
import { hudOn, hudLabel, hudBar } from './helpers/godot-hud2d-fixture.mjs';
const invalid = { errorCode: 'build_hud2d_inventory_invalid' };
function camera(plan) {
  cameraOn(plan, 0, { mode: 'follow', targetInstanceId: plan.scenes[0].actors[1].instanceId, offset: [160, -90], zoom: 2, limits: { left: -1000, top: -800, right: 1000, bottom: 800 } });
  plan.scenes[0].camera2d.document.schemaVersion = 2;
  for (const owner of [plan, plan.scenes[0]]) owner.requiredCapabilities = [...owner.requiredCapabilities, 'scene.camera2d.limits2d'].sort(); return plan;
}
test('HUD is a final optional project view that preserves original scenes, camera wrappers, source map and protocol', async t => {
  for (const base of [cameraProject(), camera(cameraProject())]) {
    const old = await adapter.generate(base), plan = hudOn(structuredClone(base), 0), before = structuredClone(plan), generated = await adapter.generate(plan);
    assert.deepEqual(plan, before); assert.equal(generated.backend.version, '0.47.0'); assert.ok(generated.backend.capabilities.includes('scene.hud2d'));
    assert.equal(generated.backend.protocolVersion, old.backend.protocolVersion); assert.deepEqual(generated.sourceMap, old.sourceMap);
    for (const [name, bytes] of old.files) if (!name.startsWith('retry-') && !['project.godot', 'execution-clock-original.godot', 'restart-project.json', 'restart-original.godot', 'restart-original-clock.godot'].includes(name)) assert.deepEqual(generated.files.get(name), bytes, name);
    assert.deepEqual(generated.files.get('hud2d-original.godot'), old.files.get('retry-original.godot'));
    assert.deepEqual(JSON.parse(generated.files.get(`scenes/${base.entrySceneId}/hud2d.json`)), plan.scenes[0].hud2d.document);
    const directory = await cameraStage(t, generated), inventory = await validateGodotHUD2DInventory(directory);
    assert.deepEqual(inventory.sceneIds, [base.entrySceneId]); assert.deepEqual(inventory.innerSettings, old.files.get('retry-original.godot'));
    assert.equal(Boolean(await validateGodotCamera2DInventory(directory)), Boolean(base.scenes[0].camera2d));
    assert.deepEqual(await adapter.generate(plan), generated); await assert.rejects(adapter.generate(plan.scenes[0]), { errorCode: 'build_hud2d_requires_project' });
  }
  assert.equal(adapter.descriptor.version, '0.49.0'); assert.ok(adapter.descriptor.capabilities.includes('scene.hud2d'));
});
test('HUD authenticates every owned file and retained settings before camera inventory reads its inner layer', async t => {
  const plan = hudOn(camera(cameraProject()), 0, [hudLabel(), hudBar()]), generated = await adapter.generate(plan), directory = await cameraStage(t, generated);
  for (const name of [...generated.files.keys()].filter(name => name.startsWith('hud2d') || name.includes('/hud2d') || ['project.godot', 'execution-clock-original.godot'].includes(name))) {
    const file = path.join(directory, name), bytes = await fs.readFile(file); await fs.appendFile(file, '\n');
    await assert.rejects(validateGodotHUD2DInventory(directory), invalid, name);
    await assert.rejects(validateGodotCamera2DInventory(directory), { errorCode: 'build_camera2d_inventory_invalid' }, name + ' inner camera gate');
    await fs.writeFile(file, bytes); await fs.rm(file); await assert.rejects(validateGodotHUD2DInventory(directory), invalid, name + ' missing'); await fs.writeFile(file, bytes);
  }
  for (const name of ['hud2d-orphan.gd', `scenes/${plan.entrySceneId}/hud2d-extra.json`, 'hud2d-scene.gd.uid']) {
    const file = path.join(directory, name); await fs.writeFile(file, 'unowned'); await assert.rejects(validateGodotHUD2DInventory(directory), invalid); await fs.rm(file);
  }
  const uid = path.join(directory, 'hud2d-scene.gd.uid'); await fs.writeFile(uid, 'uid://valid123\n'); assert.ok(await validateGodotHUD2DInventory(directory)); await fs.rm(uid);
  const helper = path.join(directory, 'hud2d-scene.gd'); await fs.rm(helper); await fs.symlink(path.join(directory, 'camera2d-scene.gd'), helper);
  await assert.rejects(validateGodotHUD2DInventory(directory), invalid); await fs.rm(helper); await fs.writeFile(helper, generated.files.get('hud2d-scene.gd'));
  const cameraSource = path.join(directory, 'camera2d-scene.gd'), original = await fs.readFile(cameraSource); await fs.appendFile(cameraSource, '\n');
  assert.ok(await validateGodotHUD2DInventory(directory), 'outer HUD admission does not pretend to authenticate inner camera scripts');
  await assert.rejects(validateGodotCamera2DInventory(directory), { errorCode: 'build_camera2d_inventory_invalid' }); await fs.writeFile(cameraSource, original);
  assert.ok(await validateGodotCamera2DInventory(directory));
});
test('projects without HUD retain retry generation without adding HUD and reject HUD-owned orphans', async t => {
  for (const plan of [cameraProject(), camera(cameraProject())]) {
    const generated = await adapter.generate(plan), directory = await cameraStage(t, generated); assert.equal(generated.backend.capabilities.includes('scene.hud2d'), false);
    assert.equal(generated.backend.version, '0.47.0'); assert.equal(await validateGodotHUD2DInventory(directory), null);
    await fs.writeFile(path.join(directory, 'hud2d-project-runtime.gd'), 'extends Node\n'); await assert.rejects(validateGodotHUD2DInventory(directory), invalid);
  }
});
