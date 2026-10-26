import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { scenePhysics2DPlanarContactsAuthor } from './helpers/scene-physics2d-planar-contacts-author-fixture.mjs';
import { scenePhysics2DContactEventsAuthor } from './helpers/scene-physics2d-contact-events-author-fixture.mjs';
import { captureBuildSnapshot } from '../adapters/node-build-snapshot.mjs';
import { generateGodotPhysicsMovementContactsProject, godotPhysicsMovementContactsAssemblyScripts } from '../backends/godot4-physics-movement-contacts.mjs';

const invalid = { errorCode: 'build_physics_movement_contacts_invalid' };
async function stage(f) {
  const captured = await captureBuildSnapshot(f.author, f.assemblyId);
  assert.equal(captured.ok, true, JSON.stringify(captured.diagnostics));
  const generated = await generateGodotPhysicsMovementContactsProject(captured.plan);
  const directory = await fs.mkdtemp(path.join(f.temporary, 'inventory-'));
  for (const [name, bytes] of generated.files) {
    await fs.mkdir(path.dirname(path.join(directory, name)), { recursive: true });
    await fs.writeFile(path.join(directory, name), bytes);
  }
  assert.ok(await godotPhysicsMovementContactsAssemblyScripts(directory));
  return { directory, generated };
}

for (const schemaVersion of [1, 2]) test(`planar inventory validates the complete frozen schema ${schemaVersion} live base before script-check`, async t => {
  const f = await scenePhysics2DPlanarContactsAuthor(t);
  if (schemaVersion === 1) await f.edit(f.physicsPath, document => {
    document.schemaVersion = 1;
    for (const body of document.bodies) delete body.collisionResponse;
  });
  const { directory } = await stage(f);
  const original = path.join(directory, `scenes/${f.sceneIds[0]}/movement-contacts-planar-original.gd`), bytes = await fs.readFile(original);
  await fs.writeFile(original, Buffer.concat([bytes, Buffer.from('\n# substituted saved original\n')]));
  await assert.rejects(godotPhysicsMovementContactsAssemblyScripts(directory), invalid);
  await fs.writeFile(original, bytes); await fs.rm(original);
  await assert.rejects(godotPhysicsMovementContactsAssemblyScripts(directory), invalid);
  await fs.symlink(path.join(f.author, f.physicsPath), original);
  await assert.rejects(godotPhysicsMovementContactsAssemblyScripts(directory), invalid);
  await fs.rm(original); await fs.writeFile(original, bytes);
  assert.ok(await godotPhysicsMovementContactsAssemblyScripts(directory));
});

test('planar inventory rejects unselected-scene bases and incomplete or mixed manifests', async t => {
  const f = await scenePhysics2DPlanarContactsAuthor(t), { directory } = await stage(f);
  const prefix = `scenes/${f.sceneIds[1]}/`, original = await fs.readFile(path.join(directory, `scenes/${f.sceneIds[0]}/movement-contacts-planar-original.gd`));
  for (const name of ['movement-contacts-planar-original.gd', 'character-contacts-original.gd']) {
    const orphan = path.join(directory, prefix + name); await fs.writeFile(orphan, original);
    await assert.rejects(godotPhysicsMovementContactsAssemblyScripts(directory), invalid); await fs.rm(orphan);
  }
  for (const name of ['movement-contacts-project.json', 'movement-contacts-helper.gd', 'movement-contacts-port.gd']) {
    const file = path.join(directory, name), bytes = await fs.readFile(file); await fs.rm(file);
    await assert.rejects(godotPhysicsMovementContactsAssemblyScripts(directory), invalid); await fs.writeFile(file, bytes);
  }
  const file = path.join(directory, 'movement-contacts-project.json'), bytes = await fs.readFile(file), manifest = JSON.parse(bytes);
  await fs.writeFile(file, JSON.stringify({ ...manifest, planarSceneIds: [] }));
  await assert.rejects(godotPhysicsMovementContactsAssemblyScripts(directory), invalid);
  await fs.writeFile(file, bytes); assert.ok(await godotPhysicsMovementContactsAssemblyScripts(directory));
});

test('mixed motor and planar scene has one collector and cannot acquire a second planar movement layer', async t => {
  const f = await scenePhysics2DContactEventsAuthor(t), actor = '81818181-8181-4181-8181-000000000001', body = '81818181-8181-4181-8181-000000000002';
  await f.edit('documents/scenes/demo.json', document => document.actors.push({ ...structuredClone(document.actors[0]), instanceId: actor, position: [400, 100] }));
  await f.edit(f.physicsPath, document => {
    const value = { ...structuredClone(document.bodies[0]), id: body, instanceId: actor }; delete value.characterMotion;
    document.bodies.push(value);
  });
  const { directory, generated } = await stage(f), prefix = `scenes/${f.sceneIds[0]}/`;
  const manifest = JSON.parse(generated.files.get('movement-contacts-project.json'));
  assert.deepEqual(manifest.sceneIds, [f.sceneIds[0]]); assert.deepEqual(manifest.planarSceneIds, []);
  assert.ok(!generated.files.has('character-contacts-helper.gd'));
  assert.ok(!generated.files.has('character-contacts-project.json'));
  assert.ok(!generated.files.has(prefix + 'movement-contacts-planar-original.gd'));
  const source = generated.files.get(prefix + 'project-scene.gd').toString();
  assert.equal(source.split('movement_contacts.begin(self)').length, 2);
  assert.equal(source.split('movement_contacts.finish(self)').length, 2);
  assert.equal(source.split('super.physics_observation_move(character, motion, response)').length, 2);
  const orphan = path.join(directory, prefix + 'movement-contacts-planar-original.gd');
  await fs.writeFile(orphan, generated.files.get(prefix + 'physics-observation-base.gd'));
  await assert.rejects(godotPhysicsMovementContactsAssemblyScripts(directory), invalid); await fs.rm(orphan);
  assert.ok(await godotPhysicsMovementContactsAssemblyScripts(directory));
});
