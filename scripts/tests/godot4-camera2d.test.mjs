import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { GODOT4_EXECUTION_ADAPTER as adapter } from '../backends/godot4-adapter.mjs';
import { validateGodotCamera2DInventory } from '../backends/godot4-camera2d-inventory.mjs';
import { runtimeId } from './helpers/project-runtime-fixture.mjs';
import { cameraProject, cameraOn, cameraStage } from './helpers/godot-camera2d-fixture.mjs';
const invalid = { errorCode: 'build_camera2d_inventory_invalid' };

test('optional camera generation changes only selected outer entries and preserves historical content', async t => {
  const plain = cameraProject(), old = await adapter.generate(plain), selected = cameraOn(structuredClone(plain), 0, { mode: 'follow', targetInstanceId: plain.scenes[0].actors[1].instanceId, offset: [-24, 16], zoom: 2 });
  const before = structuredClone(selected), generated = await adapter.generate(selected), repeated = await adapter.generate(selected);
  assert.deepEqual(selected, before); assert.deepEqual(generated.files, repeated.files); assert.deepEqual(generated.sourceMap, old.sourceMap);
  assert.equal(generated.backend.version, '0.47.0'); assert.ok(generated.backend.capabilities.includes('scene.camera2d'));
  for (const [name, bytes] of old.files) {
    if (name.startsWith('retry-') || ['restart-project.json', 'restart-original.godot', 'restart-original-clock.godot'].includes(name)) continue;
    if (['project.godot', 'execution-clock-original.godot'].includes(name)) assert.notDeepEqual(generated.files.get('retry-' + (name === 'project.godot' ? 'original.godot' : 'original-clock.godot')), old.files.get('retry-' + (name === 'project.godot' ? 'original.godot' : 'original-clock.godot')), name);
    else assert.deepEqual(generated.files.get(name), bytes, name);
  }
  assert.deepEqual(await adapter.generate(plain), old, 'absence of camera remains byte-exact including old metadata');
  const directory = await cameraStage(t, generated), inventory = await validateGodotCamera2DInventory(directory);
  assert.deepEqual(inventory.sceneIds, [plain.entrySceneId]); assert.deepEqual(inventory.scripts, ['camera2d-scene.gd', 'camera2d-project-runtime.gd']);
  await assert.rejects(adapter.generate(selected.scenes[0]), { errorCode: 'build_camera2d_requires_project' });
});

test('camera inventory strictly rejects modified entries, scripts, documents and orphan files', async t => {
  const plan = cameraProject(); cameraOn(plan, 0, { mode: 'fixed', center: [-100, 800], zoom: .125 });
  const generated = await adapter.generate(plan), directory = await cameraStage(t, generated), id = plan.entrySceneId;
  for (const name of [...generated.files.keys()].filter(name => name.startsWith('camera2d') || name.includes('/camera2d') || name === 'project.godot')) {
    const file = path.join(directory, name), bytes = await fs.readFile(file); await fs.appendFile(file, '\n');
    await assert.rejects(validateGodotCamera2DInventory(directory), invalid, name); await fs.writeFile(file, bytes);
  }
  for (const name of ['camera2d-orphan.gd', `scenes/${id}/camera2d-orphan.json`, 'camera2d-scene.gd.uid']) {
    await fs.writeFile(path.join(directory, name), 'unknown'); await assert.rejects(validateGodotCamera2DInventory(directory), invalid, name); await fs.rm(path.join(directory, name));
  }
  await fs.writeFile(path.join(directory, 'camera2d-scene.gd.uid'), 'uid://valid123\n'); assert.ok(await validateGodotCamera2DInventory(directory)); await fs.rm(path.join(directory, 'camera2d-scene.gd.uid'));
  const file = path.join(directory, `scenes/${id}/camera2d.json`), original = await fs.readFile(file), document = JSON.parse(original);
  document.camera = { mode: 'follow', targetInstanceId: runtimeId(999), offset: [0, 0], zoom: 1 };
  await fs.writeFile(file, JSON.stringify(document, null, 2) + '\n'); await assert.rejects(validateGodotCamera2DInventory(directory), invalid); await fs.writeFile(file, original);
  const script = path.join(directory, 'camera2d-scene.gd'); await fs.rm(script); await fs.symlink(path.join(directory, 'runtime.gd'), script);
  await assert.rejects(validateGodotCamera2DInventory(directory), invalid); await fs.rm(script); await fs.writeFile(script, generated.files.get('camera2d-scene.gd'));
  const linked = path.join(directory, 'scenes', 'linked-unadmitted-scene'); await fs.symlink(path.join(directory, 'scenes', id), linked);
  await assert.rejects(validateGodotCamera2DInventory(directory), invalid); await fs.rm(linked);
  assert.ok(await validateGodotCamera2DInventory(directory));
});

test('camera inventory admits legacy projects only when no camera-owned orphan exists', async t => {
  const generated = await adapter.generate(cameraProject()), directory = await cameraStage(t, generated);
  assert.equal(await validateGodotCamera2DInventory(directory), null);
  await fs.writeFile(path.join(directory, 'camera2d-scene.gd'), 'extends Node\n'); await assert.rejects(validateGodotCamera2DInventory(directory), invalid);
});
