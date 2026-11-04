import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { scenePhysics2DPlatformMotionAuthor } from './helpers/scene-physics2d-platform-motion-author-fixture.mjs';
import { scenePhysics2DPlatformVerticalAuthor } from './helpers/scene-physics2d-platform-vertical-author-fixture.mjs';
import { captureBuildSnapshot } from '../adapters/node-build-snapshot.mjs';
import { generateGodotPhysicsPlatformVerticalProject } from '../backends/godot4-physics-platform-vertical.mjs';
import { generateGodotPhysicsPlatformControlProject, godotPhysicsPlatformControlAssemblyScripts } from '../backends/godot4-physics-platform-control.mjs';

const capability = 'physics.platform-control2d';
const invalid = { errorCode: 'build_physics_platform_control_invalid' };
const id = n => `74747474-7474-4474-8474-${String(n).padStart(12, '0')}`;
const isControl = name => name.includes('platform-control');
async function ready(t, { vertical = false, enabled = true } = {}) {
  const f = await (vertical ? scenePhysics2DPlatformVerticalAuthor : scenePhysics2DPlatformMotionAuthor)(t, { enabled, consumers: false });
  const captured = await captureBuildSnapshot(f.author, f.assemblyId);
  assert.equal(captured.ok, true, JSON.stringify(captured.diagnostics));
  const before = structuredClone(captured.plan), source = await fs.readFile(path.join(f.author, f.physicsPath));
  const generated = await generateGodotPhysicsPlatformControlProject(captured.plan);
  assert.deepEqual(captured.plan, before); assert.deepEqual(await fs.readFile(path.join(f.author, f.physicsPath)), source);
  return { ...f, plan: captured.plan, generated };
}
async function stage(f, generated = f.generated) {
  const directory = await fs.mkdtemp(path.join(f.temporary, 'control-inventory-'));
  for (const [name, bytes] of generated.files) {
    const file = path.join(directory, name); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, bytes);
  }
  return directory;
}
async function files(directory) {
  const result = new Map();
  for (const entry of await fs.readdir(directory, { recursive: true, withFileTypes: true })) {
    if (entry.isFile()) { const file = path.join(entry.parentPath, entry.name); result.set(path.relative(directory, file), await fs.readFile(file)); }
  }
  return result;
}

for (const vertical of [false, true]) test(`control ${vertical ? 'vertical' : 'horizontal'} generation authenticates its own wrapper while retaining historical files`, async t => {
  const f = await ready(t, { vertical }), historical = await generateGodotPhysicsPlatformVerticalProject(f.plan);
  const sceneId = f.plan.scenes.find(scene => scene.physics?.document.bodies.some(body => body.platformMotion)).scene.objectId;
  assert.equal(f.generated.backend.version, '0.40.0'); assert.ok(f.generated.backend.capabilities.includes(capability));
  assert.deepEqual(f.generated.sourceMap, historical.sourceMap);
  for (const [name, bytes] of historical.files) {
    const actual = name === `scenes/${sceneId}/main.tscn` ? `scenes/${sceneId}/platform-control-original.tscn.txt` : name;
    assert.deepEqual(f.generated.files.get(actual), bytes, name);
  }
  assert.deepEqual(JSON.parse(f.generated.files.get('platform-control-project.json')), { format: 'viento-godot-platform-control-project', schemaVersion: 1, sceneIds: [sceneId] });
  assert.equal(f.generated.files.has('platform-control-helper.gd'), !vertical);
  assert.equal(f.generated.files.has('platform-control-vertical-helper.gd'), vertical);
  const directory = await stage(f), before = await files(directory), scripts = await godotPhysicsPlatformControlAssemblyScripts(directory);
  for (const name of f.generated.files.keys()) if (name.endsWith('.gd')) assert.ok(scripts.includes(name), name);
  assert.equal(new Set(scripts).size, scripts.length); assert.deepEqual(await files(directory), before);
  for (const scene of f.plan.scenes) if (scene.scene.objectId !== sceneId) assert.equal(f.generated.files.has(`scenes/${scene.scene.objectId}/platform-control-scene.gd`), false);
});

test('no moving declarations retain exactly the historical generation and do not acquire control capability', async t => {
  for (const vertical of [false, true]) {
    const f = await ready(t, { vertical, enabled: false }), historical = await generateGodotPhysicsPlatformVerticalProject(f.plan);
    assert.deepEqual(f.generated, historical); assert.equal(f.generated.backend.capabilities.includes(capability), false);
    assert.equal([...f.generated.files.keys()].some(isControl), false);
    assert.ok(await godotPhysicsPlatformControlAssemblyScripts(await stage(f)));
  }
});

test('control inventory rejects missing substituted or linked extension files in either parent layer', async t => {
  for (const vertical of [false, true]) {
    const f = await ready(t, { vertical }), directory = await stage(f), names = [...f.generated.files.keys()].filter(isControl);
    assert.ok(names.length >= 5);
    for (const name of names) {
      const file = path.join(directory, name), bytes = await fs.readFile(file);
      await fs.rm(file); await assert.rejects(godotPhysicsPlatformControlAssemblyScripts(directory), invalid, name + ': missing');
      await fs.symlink(path.join(f.author, f.physicsPath), file); await assert.rejects(godotPhysicsPlatformControlAssemblyScripts(directory), invalid, name + ': linked');
      await fs.rm(file); await fs.writeFile(file, Buffer.concat([bytes, Buffer.from('\n# substituted\n')]));
      await assert.rejects(godotPhysicsPlatformControlAssemblyScripts(directory), invalid, name + ': substituted');
      await fs.writeFile(file, bytes);
    }
    assert.ok(await godotPhysicsPlatformControlAssemblyScripts(directory));
  }
});

test('unselected helper variants and orphaned control files cannot upgrade historical projects', async t => {
  const horizontal = await ready(t), vertical = await ready(t, { vertical: true });
  for (const f of [horizontal, vertical]) {
    const historical = await generateGodotPhysicsPlatformVerticalProject(f.plan), directory = await stage(f, historical);
    assert.ok(await godotPhysicsPlatformControlAssemblyScripts(directory));
    for (const [name, bytes] of f.generated.files) if (isControl(name)) {
      const file = path.join(directory, name); await fs.writeFile(file, bytes);
      await assert.rejects(godotPhysicsPlatformControlAssemblyScripts(directory), invalid, name); await fs.rm(file);
    }
  }
  for (const [f, other, unexpected] of [[horizontal, vertical, 'platform-control-vertical-helper.gd'], [vertical, horizontal, 'platform-control-helper.gd']]) {
    const directory = await stage(f); await fs.writeFile(path.join(directory, unexpected), other.generated.files.get(unexpected));
    await assert.rejects(godotPhysicsPlatformControlAssemblyScripts(directory), invalid, unexpected);
  }
});

test('control manifests main entries backups and scene instance lists bind the exact moving scene', async t => {
  for (const vertical of [false, true]) {
    const f = await ready(t, { vertical }), directory = await stage(f), manifestFile = path.join(directory, 'platform-control-project.json');
    const bytes = await fs.readFile(manifestFile), manifest = JSON.parse(bytes), sceneId = manifest.sceneIds[0], prefix = `scenes/${sceneId}`;
    for (const changed of [{ ...manifest, extra: true }, { ...manifest, schemaVersion: 2 }, { ...manifest, sceneIds: [] },
      { ...manifest, sceneIds: [...manifest.sceneIds, ...manifest.sceneIds] }, { ...manifest, sceneIds: [id(1)] }, { ...manifest, sceneIds: [f.platformInstanceId] },
      { ...manifest, instanceIds: [f.platformInstanceId] }]) {
      await fs.writeFile(manifestFile, JSON.stringify(changed)); await assert.rejects(godotPhysicsPlatformControlAssemblyScripts(directory), invalid);
    }
    await fs.writeFile(manifestFile, bytes);
    for (const name of [`${prefix}/main.tscn`, `${prefix}/platform-control-original.tscn.txt`, `${prefix}/platform-control-scene.gd`]) {
      const file = path.join(directory, name), original = await fs.readFile(file);
      await fs.writeFile(file, original.toString().replaceAll(sceneId, id(2))); await assert.rejects(godotPhysicsPlatformControlAssemblyScripts(directory), invalid, name);
      await fs.writeFile(file, original);
    }
    const otherScene = f.plan.scenes.find(scene => scene.scene.objectId !== sceneId).scene.objectId;
    const orphan = path.join(directory, `scenes/${otherScene}/platform-control-scene.gd`);
    await fs.writeFile(orphan, f.generated.files.get(`${prefix}/platform-control-scene.gd`));
    await assert.rejects(godotPhysicsPlatformControlAssemblyScripts(directory), invalid); await fs.rm(orphan);
    if (!vertical) {
      const fake = path.join(directory, prefix, 'platform-vertical.json'); await fs.writeFile(fake, '{}');
      await assert.rejects(godotPhysicsPlatformControlAssemblyScripts(directory), invalid); await fs.rm(fake);
    }
    assert.ok(await godotPhysicsPlatformControlAssemblyScripts(directory));
    const controller = new AbortController(); controller.abort();
    await assert.rejects(godotPhysicsPlatformControlAssemblyScripts(directory, controller.signal), { name: 'AbortError' });
  }
});

test('mixed horizontal and vertical scenes require both authenticated control helper variants in scene order', async t => {
  const f = await scenePhysics2DPlatformVerticalAuthor(t, { consumers: false }), secondId = f.sceneIds[1];
  const firstScene = await f.read('documents/scenes/demo.json'), platform = structuredClone(firstScene.actors.find(actor => actor.instanceId === f.platformInstanceId));
  platform.instanceId = id(3);
  const second = await f.read(`metadata/documents/${secondId}.json`); await f.edit(second.sourcePath, scene => scene.actors.push(platform));
  const document = await f.read(f.physicsPath), body = structuredClone(document.bodies.find(body => body.id === f.platformBodyId));
  body.id = id(4); body.instanceId = id(3); body.platformMotion = { kind: 'horizontal', offsetX: -64, speed: 70 };
  const physicsPath = 'documents/physics/horizontal-control.json';
  await f.write(physicsPath, { ...document, schemaVersion: 5, sceneObjectId: secondId, bodies: [body] });
  const record = await f.read(`metadata/documents/${f.physicsId}.json`);
  await f.write(`metadata/documents/${id(5)}.json`, { ...record, id: id(5), sourcePath: physicsPath, relations: [{ kind: 'references', targetId: secondId, slot: '' }] });
  await f.edit(`metadata/documents/${secondId}.json`, value => value.relations.push({ kind: 'references', targetId: id(5), slot: 'physics2d' }));
  const captured = await captureBuildSnapshot(f.author, f.assemblyId); assert.equal(captured.ok, true, JSON.stringify(captured.diagnostics));
  const before = structuredClone(captured.plan), generated = await generateGodotPhysicsPlatformControlProject(captured.plan);
  assert.deepEqual(captured.plan, before);
  for (const name of ['platform-control-helper.gd', 'platform-control-vertical-helper.gd', 'platform-control-port.gd']) assert.ok(generated.files.has(name));
  const manifest = JSON.parse(generated.files.get('platform-control-project.json'));
  assert.deepEqual(manifest.sceneIds, captured.plan.scenes.filter(scene => scene.physics?.document.bodies.some(body => body.platformMotion)).map(scene => scene.scene.objectId));
  const directory = await stage({ ...f, generated }), scripts = await godotPhysicsPlatformControlAssemblyScripts(directory);
  assert.equal(new Set(scripts).size, scripts.length);
  for (const sceneId of manifest.sceneIds) assert.ok(scripts.includes(`scenes/${sceneId}/platform-control-scene.gd`));
  const file = path.join(directory, 'platform-control-project.json'), bytes = await fs.readFile(file);
  await fs.writeFile(file, JSON.stringify({ ...manifest, sceneIds: [...manifest.sceneIds].reverse() }));
  await assert.rejects(godotPhysicsPlatformControlAssemblyScripts(directory), invalid); await fs.writeFile(file, bytes);
  for (const [name, opposite] of [['platform-control-helper.gd', 'platform-control-vertical-helper.gd'], ['platform-control-vertical-helper.gd', 'platform-control-helper.gd']]) {
    const target = path.join(directory, name), original = await fs.readFile(target);
    await fs.writeFile(target, await fs.readFile(path.join(directory, opposite))); await assert.rejects(godotPhysicsPlatformControlAssemblyScripts(directory), invalid, name);
    await fs.writeFile(target, original);
  }
  assert.ok(await godotPhysicsPlatformControlAssemblyScripts(directory));
});

test('control generation captures the neutral plan before asynchronous template reads', async t => {
  const f = await ready(t, { vertical: true }), caller = structuredClone(f.plan);
  const pending = generateGodotPhysicsPlatformControlProject(caller);
  const scene = caller.scenes.find(scene => scene.physics?.document.bodies.some(body => body.platformMotion));
  scene.physics.document.bodies.find(body => body.platformMotion).platformMotion.offsetY = 0;
  scene.physics.manifest.sourceRevision = `sha256:${'f'.repeat(64)}`;
  scene.actors = []; caller.entrySceneId = id(99); caller.requiredCapabilities = [];
  const generated = await pending;
  assert.deepEqual(generated, f.generated);
  assert.notEqual(caller.entrySceneId, f.plan.entrySceneId);
});
