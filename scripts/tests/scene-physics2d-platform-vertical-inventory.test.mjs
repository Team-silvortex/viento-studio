import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { scenePhysics2DPlatformVerticalAuthor } from './helpers/scene-physics2d-platform-vertical-author-fixture.mjs';
import { captureBuildSnapshot } from '../adapters/node-build-snapshot.mjs';
import { generateGodotPhysicsCharacterIntentProject } from '../backends/godot4-physics-character-intent.mjs';
import { generateGodotPhysicsPlatformVerticalProject, godotPhysicsPlatformVerticalAssemblyScripts } from '../backends/godot4-physics-platform-vertical.mjs';
const invalid = { errorCode: 'build_physics_platform_vertical_invalid' };
async function ready(t, options) {
  const f = await scenePhysics2DPlatformVerticalAuthor(t, options), captured = await captureBuildSnapshot(f.author, f.assemblyId);
  assert.equal(captured.ok, true, JSON.stringify(captured.diagnostics));
  return { ...f, plan: captured.plan, generated: await generateGodotPhysicsPlatformVerticalProject(captured.plan) };
}
async function stage(f, generated = f.generated) {
  const directory = await fs.mkdtemp(path.join(f.temporary, 'vertical-inventory-'));
  for (const [name, bytes] of generated.files) {
    await fs.mkdir(path.dirname(path.join(directory, name)), { recursive: true });
    await fs.writeFile(path.join(directory, name), bytes);
  }
  return directory;
}
function proxy(plan) {
  const result = structuredClone(plan);
  result.requiredCapabilities = result.requiredCapabilities.filter(c => c !== 'physics.platform-vertical2d');
  for (const scene of result.scenes) {
    scene.requiredCapabilities = scene.requiredCapabilities.filter(c => c !== 'physics.platform-vertical2d');
    if (scene.physics?.document.schemaVersion !== 6) continue;
    scene.physics.document.schemaVersion = 5;
    for (const body of scene.physics.document.bodies) if (body.platformMotion?.kind === 'vertical') {
      body.platformMotion = { kind:'horizontal', offsetX:body.platformMotion.offsetY, speed:body.platformMotion.speed };
    }
  }
  return result;
}
test('vertical generation preserves the input and leaves historical files intact behind the explicit scene wrapper', async t => {
  const f = await ready(t), before = structuredClone(f.plan), historical = await generateGodotPhysicsCharacterIntentProject(proxy(f.plan));
  assert.deepEqual(f.plan, before); assert.deepEqual(f.generated.sourceMap, historical.sourceMap);
  const id = f.plan.scenes.find(s => s.physics?.document.bodies.some(b => b.platformMotion?.kind === 'vertical')).scene.objectId;
  for (const [name, bytes] of historical.files) {
    const mapped = name === `scenes/${id}/main.tscn` ? `scenes/${id}/platform-vertical-original.tscn.txt` : name;
    assert.deepEqual(f.generated.files.get(mapped), bytes, name);
  }
  const inventory = await godotPhysicsPlatformVerticalAssemblyScripts(await stage(f));
  for (const name of f.generated.files.keys()) if (name.endsWith('.gd')) assert.ok(inventory.includes(name), name);
  assert.equal(new Set(inventory).size, inventory.length);
  await assert.rejects(generateGodotPhysicsPlatformVerticalProject(f.plan.scenes[0]), { errorCode:'build_physics_requires_project' });
});

test('schema6 without vertical declarations generates exactly the same historical output as schema5', async t => {
  const f = await ready(t, { enabled:false }), before = structuredClone(f.plan), historical = await generateGodotPhysicsCharacterIntentProject(proxy(f.plan));
  assert.deepEqual(f.plan, before); assert.deepEqual(f.generated, historical);
  assert.ok(await godotPhysicsPlatformVerticalAssemblyScripts(await stage(f)));
});

test('vertical inventory rejects missing, substituted and symlinked helpers, scene, backup, declaration and manifest', async t => {
  const f = await ready(t), directory = await stage(f);
  const names = [...f.generated.files.keys()].filter(name => name.includes('platform-vertical'));
  assert.ok(names.length >= 6, JSON.stringify(names));
  for (const name of names) {
    const file = path.join(directory, name), bytes = await fs.readFile(file);
    await fs.rm(file); await assert.rejects(godotPhysicsPlatformVerticalAssemblyScripts(directory), invalid, name + ' missing');
    await fs.symlink(path.join(f.author, f.physicsPath), file); await assert.rejects(godotPhysicsPlatformVerticalAssemblyScripts(directory), invalid, name + ' linked');
    await fs.rm(file); await fs.writeFile(file, Buffer.concat([bytes, Buffer.from('\n# substituted\n')]));
    await assert.rejects(godotPhysicsPlatformVerticalAssemblyScripts(directory), invalid, name + ' substituted');
    await fs.writeFile(file, bytes);
  }
  assert.ok(await godotPhysicsPlatformVerticalAssemblyScripts(directory));
});

test('vertical inventory rejects substituted main scene and motion, proxy or manifest mismatch', async t => {
  const f = await ready(t), directory = await stage(f);
  const name = [...f.generated.files.keys()].find(name => name.endsWith('/platform-vertical.json'));
  const prefix = name.slice(0, -'/platform-vertical.json'.length), file = path.join(directory, name), bytes = await fs.readFile(file), original = JSON.parse(bytes);
  for (const edit of [v => { v.extra = true; }, v => { v.schemaVersion = 2; }, v => { v.sceneObjectId = f.platformInstanceId; }, v => { v.bodies = []; },
    v => { v.bodies.push(v.bodies[0]); }, v => { v.bodies[0].bodyId = f.otherBodyId; }, v => { v.bodies[0].instanceId = f.instanceId; },
    v => { v.bodies[0].platformMotion.kind = 'horizontal'; }, v => { v.bodies[0].platformMotion.offsetY = 0; }, v => { v.bodies[0].platformMotion.offsetY = 8193; },
    v => { v.bodies[0].platformMotion.speed = 0; }, v => { v.bodies[0].platformMotion.speed = 2001; }, v => { v.bodies[0].platformMotion.extra = true; }]) {
    const changed = structuredClone(original); edit(changed); await fs.writeFile(file, JSON.stringify(changed));
    await assert.rejects(godotPhysicsPlatformVerticalAssemblyScripts(directory), invalid);
  }
  await fs.writeFile(file, bytes);
  const proxyFile = path.join(directory, prefix, 'platform-motion.json'), proxyBytes = await fs.readFile(proxyFile), motion = JSON.parse(proxyBytes);
  for (const edit of [v => { v.bodies[0].platformMotion.offsetX *= -1; }, v => { v.bodies[0].platformMotion.speed += 1; }, v => { v.bodies[0].instanceId = f.instanceId; }]) {
    const changed = structuredClone(motion); edit(changed); await fs.writeFile(proxyFile, JSON.stringify(changed));
    await assert.rejects(godotPhysicsPlatformVerticalAssemblyScripts(directory), invalid);
  }
  await fs.writeFile(proxyFile, proxyBytes);
  const manifestFile = path.join(directory, 'platform-vertical-project.json'), manifestBytes = await fs.readFile(manifestFile), manifest = JSON.parse(manifestBytes);
  for (const changed of [{ ...manifest, extra: 1 }, { ...manifest, schemaVersion: 2 }, { ...manifest, sceneIds: [] },
    { ...manifest, sceneIds: [...manifest.sceneIds, ...manifest.sceneIds] }, { ...manifest, sceneIds: [f.platformInstanceId] }]) {
    await fs.writeFile(manifestFile, JSON.stringify(changed)); await assert.rejects(godotPhysicsPlatformVerticalAssemblyScripts(directory), invalid);
  }
  await fs.writeFile(manifestFile, manifestBytes);
  const mainFile = path.join(directory, prefix, 'main.tscn'), mainBytes = await fs.readFile(mainFile);
  await fs.writeFile(mainFile, Buffer.concat([mainBytes, Buffer.from('\n# tampered\n')]));
  await assert.rejects(godotPhysicsPlatformVerticalAssemblyScripts(directory), invalid); await fs.writeFile(mainFile, mainBytes);
  assert.ok(await godotPhysicsPlatformVerticalAssemblyScripts(directory));
});

test('vertical inventory rejects orphaned extension files when the project uses historical output', async t => {
  const f = await ready(t), historical = await generateGodotPhysicsCharacterIntentProject(proxy(f.plan)), directory = await stage(f, historical);
  assert.ok(await godotPhysicsPlatformVerticalAssemblyScripts(directory));
  for (const [name, bytes] of f.generated.files) if (name.includes('platform-vertical')) {
    const file = path.join(directory, name); await fs.writeFile(file, bytes);
    await assert.rejects(godotPhysicsPlatformVerticalAssemblyScripts(directory), invalid, name);
    await fs.rm(file);
  }
  assert.ok(await godotPhysicsPlatformVerticalAssemblyScripts(directory));
});

test('vertical and historical horizontal scenes coexist without overwriting either projection', async t => {
  const f = await scenePhysics2DPlatformVerticalAuthor(t), secondId = f.sceneIds[1];
  const bodyId = '77777777-7777-4777-8777-777777777771', instanceId = '77777777-7777-4777-8777-777777777772';
  const physicsId = '77777777-7777-4777-8777-777777777773', physicsPath = 'documents/physics/scene-horizontal.json';
  const firstScene = await f.read('documents/scenes/demo.json');
  const platform = structuredClone(firstScene.actors.find(actor => actor.instanceId === f.platformInstanceId));
  platform.instanceId = instanceId;
  const secondRecord = await f.read(`metadata/documents/${secondId}.json`);
  await f.edit(secondRecord.sourcePath, scene => scene.actors.push(platform));
  const doc = await f.read(f.physicsPath), body = structuredClone(doc.bodies.find(item => item.id === f.platformBodyId));
  body.id = bodyId; body.instanceId = instanceId; body.platformMotion = { kind:'horizontal', offsetX:-64, speed:70 };
  await f.write(physicsPath, { ...doc, schemaVersion:5, sceneObjectId:secondId, bodies:[body] });
  const record = await f.read(`metadata/documents/${f.physicsId}.json`);
  await f.write(`metadata/documents/${physicsId}.json`, { ...record, id:physicsId, sourcePath:physicsPath,
    relations:[{ kind:'references', targetId:secondId, slot:'' }] });
  await f.edit(`metadata/documents/${secondId}.json`, value => value.relations.push({ kind:'references', targetId:physicsId, slot:'physics2d' }));
  const captured = await captureBuildSnapshot(f.author, f.assemblyId);
  assert.equal(captured.ok, true, JSON.stringify(captured.diagnostics));
  const before = structuredClone(captured.plan), historical = await generateGodotPhysicsCharacterIntentProject(proxy(captured.plan));
  const generated = await generateGodotPhysicsPlatformVerticalProject(captured.plan);
  assert.deepEqual(captured.plan, before);
  const firstId = f.sceneIds[0], first = JSON.parse(generated.files.get(`scenes/${firstId}/platform-vertical.json`));
  assert.deepEqual(first.bodies[0].platformMotion, { kind:'vertical', offsetY:f.offsetY, speed:f.speed });
  const horizontalName = `scenes/${secondId}/platform-motion.json`;
  assert.deepEqual(generated.files.get(horizontalName), historical.files.get(horizontalName));
  assert.deepEqual(JSON.parse(generated.files.get(horizontalName)).bodies[0].platformMotion, { kind:'horizontal', offsetX:-64, speed:70 });
  for (const [name, bytes] of historical.files) if (name.startsWith(`scenes/${secondId}/`)) assert.deepEqual(generated.files.get(name), bytes, name);
  const inventory = await godotPhysicsPlatformVerticalAssemblyScripts(await stage({ ...f, generated }));
  assert.ok(inventory.includes(`scenes/${firstId}/platform-vertical-scene.gd`));
  assert.equal(generated.files.has(`scenes/${secondId}/platform-vertical.json`), false);
});

test('vertical generation composes with input mapping and captures callers before asynchronous source reads', async t => {
  const { GODOT4_EXECUTION_ADAPTER: adapter } = await import('../backends/godot4-adapter.mjs');
  const { validateGeneratedExecutionProject } = await import('../adapters/node-execution-backends.mjs');
  const f = await ready(t), plan = structuredClone(f.plan);
  plan.schemaVersion = 2;
  plan.inputMap = { objectId: '94949494-9494-4494-8494-949494949494', sourcePath: 'documents/input/map.json',
    sourceRevision: `sha256:${'1'.repeat(64)}`, document: { format: 'viento-input-map', schemaVersion: 1,
      actions: [{ name: 'player_jump', keys: ['KeyW'] }] } };
  plan.requiredCapabilities = [...plan.requiredCapabilities, 'project.input-map'].sort();
  const admitted = structuredClone(plan), pending = adapter.generate(plan);
  plan.inputMap.document.actions[0].keys[0] = 'KeyS';
  plan.scenes.find(scene => scene.physics).physics.document.bodies.find(body => body.platformMotion?.kind === 'vertical').platformMotion.offsetY = -8192;
  const generated = await pending;
  assert.equal(generated.backend.version, '0.47.0');
  for (const capability of ['physics.platform-vertical2d', 'project.input-map']) assert.ok(generated.backend.capabilities.includes(capability));
  assert.match(generated.files.get('project.godot').toString(), /player_jump=\{[\s\S]*?"physical_keycode":87/);
  assert.doesNotMatch(generated.files.get('project.godot').toString(), /"physical_keycode":83/);
  const file = [...generated.files.keys()].find(name => name.endsWith('/platform-vertical.json'));
  const declared = JSON.parse(generated.files.get(file));
  assert.equal(declared.bodies[0].platformMotion.offsetY, f.offsetY);
  assert.doesNotThrow(() => validateGeneratedExecutionProject(adapter, admitted, generated));
  for (const capability of ['physics.platform-vertical2d', 'project.input-map']) {
    assert.throws(() => validateGeneratedExecutionProject(adapter, admitted, { ...generated, backend: { ...generated.backend,
      capabilities: generated.backend.capabilities.filter(value => value !== capability) } }));
  }
  assert.ok(await godotPhysicsPlatformVerticalAssemblyScripts(await stage(f, generated)));
});

test('solid-only and no-character vertical projects omit the optional drop layer', async t => {
  for (const options of [{ oneWay: false }, { noCharacters: true }]) {
    const f = await ready(t, { ...options, consumers: false });
    assert.equal(f.generated.files.has('drop-through-helper.gd'), false);
    assert.equal(f.generated.files.has('platform-vertical-drop-helper.gd'), false);
    const scene = [...f.generated.files.keys()].find(name => name.endsWith('/platform-vertical-scene.gd'));
    assert.doesNotMatch(f.generated.files.get(scene).toString(), /__DROP_SETUP__|platform-vertical-drop-helper/);
    const directory = await stage(f);
    assert.ok(await godotPhysicsPlatformVerticalAssemblyScripts(directory));
    await fs.writeFile(path.join(directory, 'platform-vertical-drop-helper.gd'), Buffer.from('extends RefCounted\n'));
    await assert.rejects(godotPhysicsPlatformVerticalAssemblyScripts(directory), invalid);
  }
});
