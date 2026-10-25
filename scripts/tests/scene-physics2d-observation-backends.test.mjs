import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import yauzl from 'yauzl';
import { scenePhysics2DAuthor } from './helpers/scene-physics2d-author-fixture.mjs';
import { projectAnimationClipsAuthor } from './helpers/project-animation-clips-author-fixture.mjs';
import { captureBuildSnapshot } from '../adapters/node-build-snapshot.mjs';
import { buildProject } from '../adapters/node-project-build.mjs';
import { GODOT4_EXECUTION_ADAPTER as adapter } from '../backends/godot4-adapter.mjs';
import { generateGodotPhysicsProject } from '../backends/godot4-physics.mjs';
import { generateGodotPhysicsResponseProject } from '../backends/godot4-physics-response.mjs';
import { generateGodotPhysicsObservationProject, godotPhysicsObservationAssemblyScripts } from '../backends/godot4-physics-observation.mjs';
import { inspectBackendProject } from '../adapters/node-backend-project.mjs';
import { planBackendProjectDelivery, verifyBackendProjectDelivery } from '../adapters/node-backend-project-delivery.mjs';
import { writeExportZip } from '../lib/export-package.mjs';

const tool = process.env.VIENTO_GODOT_BIN;
const real = { skip: !tool ? 'Set VIENTO_GODOT_BIN for native observation verification' : false, timeout: 180000 };
const capturePath = process.env.VIENTO_PHYSICS_OBSERVATION_CAPTURE;
const reportPath = process.env.VIENTO_PHYSICS_OBSERVATION_REPORT;
const evidence = [];
const hash = value => createHash('sha256').update(value).digest('hex');
const id = n => `71717171-7171-4171-8171-${String(n).padStart(12, '0')}`;
test.after(async () => { if (reportPath) await fs.writeFile(reportPath, JSON.stringify({ format: 'viento-physics-observation-proof', schemaVersion: 1, tool, cases: evidence }, null, 2) + '\n', { flag: 'wx' }); });
async function hashes(directory, prefix = '') {
  const result = {};
  for (const item of await fs.readdir(path.join(directory, prefix), { withFileTypes: true })) {
    const name = prefix ? `${prefix}/${item.name}` : item.name;
    if (item.isDirectory()) Object.assign(result, await hashes(directory, name));
    else { assert.ok(item.isFile()); result[name] = hash(await fs.readFile(path.join(directory, name))); }
  }
  return result;
}
async function captured(f) {
  const captured = await captureBuildSnapshot(f.author, f.assemblyId);
  assert.equal(captured.ok, true, JSON.stringify(captured.diagnostics));
  return { ...f, captured, generated: await adapter.generate(captured.plan) };
}
async function stage(f, generated = f.generated) {
  const directory = await fs.mkdtemp(path.join(f.temporary, 'staged-'));
  for (const [name, bytes] of [...generated.files, ...[...generated.resourceFiles].map(([id, name]) => [name, f.captured.resources.get(id)])]) {
    await fs.mkdir(path.dirname(path.join(directory, name)), { recursive: true }); await fs.writeFile(path.join(directory, name), bytes);
  }
  return directory;
}
async function execute(f, directory, { generated = f.generated, scriptCheck = false, mode = 'headlessLogic', capture, smoke = true } = {}) {
  const identified = await adapter.identify(tool);
  for (const phase of scriptCheck ? adapter.buildPhases : adapter.runtimePhases) {
    const result = await adapter.executePhase({ phase, directory, tool: identified, timeoutMs: 60000 });
    assert.equal(result.status, 'succeeded', result.stdout + result.stderr);
    assert.deepEqual(adapter.diagnostics(result, f.captured.plan), [], result.stdout + result.stderr);
  }
  const result = await adapter.executePhase({ phase: 'run', directory, tool: identified, smoke, mode, ...(capture ? { capturePath: capture } : {}), timeoutMs: 60000 });
  assert.equal(result.status, 'succeeded', result.stdout + result.stderr);
  assert.deepEqual(adapter.diagnostics(result, f.captured.plan), [], result.stdout + result.stderr);
  const reader = adapter.createEventReader(f.captured.plan, { smoke, capabilities: generated.backend.capabilities });
  reader.push(result.stdout); const ended = reader.finish(); assert.deepEqual(ended.diagnostics, [], result.stdout);
  const snapshot = reader.snapshot?.();
  if (snapshot) assert.equal(snapshot.phase, 'finished');
  return { result, reader, snapshot, tool: identified };
}
async function fixture(t, { slide = false, animation = false, diagonal = false } = {}) {
  const f = await scenePhysics2DAuthor(t, { animation });
  if (slide) await f.edit(f.physicsPath, document => { document.schemaVersion = 2; document.bodies[0].collisionResponse = 'slide'; });
  if (diagonal) await f.script('checkpoint', 'extends Node\nfunc _ready() -> void:\n\tInput.action_press("ui_down")\nfunc _exit_tree() -> void:\n\tInput.action_release("ui_down")\n');
  return f;
}
function exitActors(reader, visitIndex) { return reader.events.find(frame => frame.event === 'scene-exit' && (!visitIndex || frame.visitIndex === visitIndex)).actors; }
function record(name, f, output, before) {
  const samples = output.snapshot.samples;
  evidence.push({ name, backend: f.generated.backend, tool: output.tool, samples: samples.length,
    limited: output.snapshot.limited, contacts: samples.flatMap(sample => sample.contacts).length,
    lastSample: samples.at(-1), contactSample: samples.find(sample => sample.contacts.length),
    finalActors: exitActors(output.reader), authorFiles: Object.keys(before).length, authorSha256: hash(JSON.stringify(before)) });
}

test('observation wrapper keeps old generators and nonphysical output intact with complete independent script inventory', async t => {
  const plain = await captured(await projectAnimationClipsAuthor(t));
  const { artifact, ...plainOutput } = plain.generated;
  assert.deepEqual(await generateGodotPhysicsObservationProject(plain.captured.plan), plainOutput);
  assert.ok(!plainOutput.backend.capabilities.includes('physics.observe2d'));
  const nonphysical = await stage(plain);
  assert.equal(await godotPhysicsObservationAssemblyScripts(nonphysical), null);
  await fs.writeFile(path.join(nonphysical, 'physics-observation-project.json'), JSON.stringify({ format: 'viento-godot-physics-observation-project', schemaVersion: 1, sceneIds: plain.sceneIds }));
  await assert.rejects(godotPhysicsObservationAssemblyScripts(nonphysical), { errorCode: 'build_physics_observation_invalid' });
  for (const slide of [false, true]) {
    const f = await captured(await fixture(t, { slide }));
    const old = await (slide ? generateGodotPhysicsResponseProject : generateGodotPhysicsProject)(f.captured.plan);
    assert.equal(old.backend.version, slide ? '0.22.0' : '0.21.0');
    const legacyScripts = await godotPhysicsObservationAssemblyScripts(await stage(f, old));
    assert.ok(legacyScripts.includes('project-physics-runtime.gd'));
    assert.ok(!legacyScripts.includes('project-physics-observation-runtime.gd'));
    assert.equal(f.generated.backend.version, '0.23.0'); assert.equal(f.generated.backend.protocolVersion, old.backend.protocolVersion);
    assert.ok(f.generated.backend.capabilities.includes('physics.observe2d'));
    for (const [name, bytes] of old.files) {
      if (name === 'project.tscn') continue;
      const preserved = name === `scenes/${f.sceneIds[0]}/runtime.gd` ? name.replace('/runtime.gd', '/physics-observation-base.gd') : name;
      assert.deepEqual(f.generated.files.get(preserved), bytes, name);
    }
    const directory = await stage(f), scripts = await godotPhysicsObservationAssemblyScripts(directory);
    for (const name of f.generated.files.keys()) if (name.endsWith('.gd')) assert.ok(scripts.includes(name), name);
    const manifest = path.join(directory, 'physics-observation-project.json'), original = await fs.readFile(manifest);
    for (const bad of [{ format: 'viento-godot-physics-observation-project', schemaVersion: 1, sceneIds: ['../escape'] },
      { ...JSON.parse(original), sceneIds: [] }, { ...JSON.parse(original), extra: true }]) {
      await fs.writeFile(manifest, JSON.stringify(bad)); await assert.rejects(godotPhysicsObservationAssemblyScripts(directory), { errorCode: 'build_physics_observation_invalid' });
    }
    await fs.rm(manifest); await assert.rejects(godotPhysicsObservationAssemblyScripts(directory), { errorCode: 'build_physics_observation_invalid' });
    const entryPath = path.join(directory, 'project.tscn'), entry = await fs.readFile(entryPath, 'utf8');
    await fs.writeFile(entryPath, entry.replace('project-physics-observation-runtime.gd', 'project-physics-runtime.gd'));
    await assert.rejects(godotPhysicsObservationAssemblyScripts(directory), { errorCode: 'build_physics_observation_invalid' });
    await fs.writeFile(manifest, original);
    await assert.rejects(godotPhysicsObservationAssemblyScripts(directory), { errorCode: 'build_physics_observation_invalid' });
    await fs.writeFile(entryPath, entry);
    const base = path.join(directory, `scenes/${f.sceneIds[0]}/physics-observation-base.gd`);
    await fs.rm(base); await fs.symlink(path.join(f.author, 'documents/scripts/checkpoint.txt'), base);
    await assert.rejects(godotPhysicsObservationAssemblyScripts(directory), { errorCode: 'build_physics_observation_invalid' });
  }
});

test('adapter requires smoke and current generated capability while legacy and interactive readers remain unchanged', async t => {
  const f = await captured(await fixture(t));
  for (const options of [{ smoke: false }, { smoke: true, capabilities: [] }]) assert.equal(adapter.createEventReader(f.captured.plan, options).snapshot, undefined);
  assert.equal(typeof adapter.createEventReader(f.captured.plan, { smoke: true, capabilities: ['physics.observe2d'] }).snapshot, 'function');
});

for (const slide of [false, true]) test(`real ${slide ? 'slide' : 'stop'} traces native contacts without changing old physical results`, real, async t => {
  const f = await captured(await fixture(t, { slide, diagonal: true })), before = await hashes(f.author);
  const output = await execute(f, await stage(f), { scriptCheck: !slide });
  const old = await (slide ? generateGodotPhysicsResponseProject : generateGodotPhysicsProject)(f.captured.plan);
  const legacy = await execute(f, await stage(f, old), { generated: old });
  assert.deepEqual(exitActors(output.reader), exitActors(legacy.reader));
  assert.equal(output.snapshot.samples.length, 30); assert.equal(output.snapshot.limited, false);
  const contact = output.snapshot.samples.find(sample => sample.contacts.length);
  assert.ok(contact); assert.equal(contact.response, slide ? 'slide' : 'stop');
  assert.equal(contact.contacts[0].collider.instanceId, f.wallInstanceId);
  assert.equal(contact.contacts[0].collider.bodyId, f.physics.bodies[2].id);
  assert.ok(Math.abs(contact.contacts[0].normal[0] + 1) < 1e-6);
  assert.ok(Math.abs(contact.contacts[0].position[0] - 145) < .2);
  assert.ok(contact.displacement[0] < contact.requestedMotion[0]);
  assert.ok(output.snapshot.samples.every(sample => sample.contacts.length <= (slide ? 4 : 1)));
  assert.deepEqual(await hashes(f.author), before); record(slide ? 'slide' : 'stop', f, output, before);
});

test('real undeclared collider with copied identity metadata remains unmapped', real, async t => {
  const f = await fixture(t);
  await f.script('checkpoint', `extends Node
func _ready() -> void:
\tvar body := StaticBody2D.new()
\tbody.position = Vector2(125, 180)
\tbody.set_meta("viento_instance_id", "${f.wallInstanceId}")
\tbody.set_meta("viento_object_id", get_parent().get_meta("viento_object_id"))
\tvar collision := CollisionShape2D.new()
\tvar shape := RectangleShape2D.new()
\tshape.size = Vector2(10, 100)
\tcollision.shape = shape
\tbody.add_child(collision)
\tget_parent().get_parent().call_deferred("add_child", body)
`);
  const ready = await captured(f), before = await hashes(f.author), output = await execute(ready, await stage(ready));
  const contacts = output.snapshot.samples.flatMap(sample => sample.contacts); assert.ok(contacts.length);
  assert.ok(contacts.every(contact => contact.collider === null));
  assert.ok(Math.abs(exitActors(output.reader)[0].position[0] - 110) < .2);
  assert.deepEqual(await hashes(f.author), before); record('unmapped-collider', ready, output, before);
});

test('real 256-sample limit reports partial observation while all 30 physical steps still finish', real, async t => {
  const f = await fixture(t);
  await f.edit('documents/scenes/demo.json', scene => {
    for (let index = 1; index <= 8; index++) scene.actors.push({ ...scene.actors[0], instanceId: id(index), position: [20, 500 + index * 30], controls: 'none', speed: 0 });
  });
  await f.edit(f.physicsPath, document => { for (let index = 1; index <= 8; index++) document.bodies.push({ ...document.bodies[0], id: id(index + 20), instanceId: id(index) }); });
  const ready = await captured(f), before = await hashes(f.author), output = await execute(ready, await stage(ready));
  assert.equal(output.snapshot.samples.length, 256); assert.equal(output.snapshot.limited, true);
  assert.equal(output.result.stdout.split('\n').filter(line => line.startsWith('VIENTO_PHYSICS2D:') && JSON.parse(line.slice(17)).event === 'limited').length, 1);
  assert.ok(Math.abs(exitActors(output.reader)[0].position[0] - 135) < .2);
  assert.ok(Math.abs(output.reader.events.at(-1).totalSeconds - .5) < 1e-6);
  assert.deepEqual(await hashes(f.author), before); record('bounded-partial', ready, output, before);
});

test('real sensor-driven scene reentry resets physical step and source ownership', real, async t => {
  const f = await fixture(t, { animation: true });
  const sensor = await fs.readFile(path.join(f.author, 'documents/scripts/sensor.txt'), 'utf8');
  await f.script('sensor', sensor.replace('var _project', 'static var switched := false\nvar _project')
    .replace('\t_publish(entered_event, body)', `\t_publish(entered_event, body)\n\tif not switched:\n\t\tswitched = true\n\t\t_project.request_scene("${f.sceneIds[1]}")`));
  await f.script('second', `extends Node\nfunc _ready() -> void:\n\tget_meta("viento_project").request_scene("${f.sceneIds[0]}")\n`);
  const ready = await captured(f), before = await hashes(f.author), output = await execute(ready, await stage(ready));
  assert.deepEqual([...new Set(output.snapshot.samples.map(sample => sample.visitIndex))], [1, 3]);
  assert.equal(output.snapshot.samples.find(sample => sample.visitIndex === 3).stepIndex, 1);
  assert.ok(output.snapshot.samples.every(sample => sample.sceneId === f.sceneIds[0]));
  assert.deepEqual(await hashes(f.author), before); record('scene-reentry', ready, output, before);
});

test('real static and sensor-only visits finish with an explicit empty observation', real, async t => {
  const f = await fixture(t); await f.edit(f.physicsPath, document => { document.bodies[0].kind = 'static'; });
  await f.edit('documents/scenes/demo.json', scene => { scene.actors[0].controls = 'none'; scene.actors[0].speed = 0; });
  const ready = await captured(f), before = await hashes(f.author), output = await execute(ready, await stage(ready));
  assert.deepEqual(output.snapshot.samples, []); assert.equal(output.snapshot.limited, false);
  assert.deepEqual(await hashes(f.author), before); record('static-sensor-only', ready, output, before);
});

test('real portable ZIP retains observation, sensors and animation without original author or build paths', real, async t => {
  const f = await captured(await fixture(t, { animation: true })), before = await hashes(f.author), output = path.join(f.temporary, 'build');
  const built = await buildProject({ root: f.author, targetId: f.assemblyId, tool, output });
  assert.equal(built.ok, true, JSON.stringify(built.record?.diagnostics || built));
  const inspection = () => inspectBackendProject({ buildDirectory: output });
  const delivery = await planBackendProjectDelivery({ inspection: await inspection(), assertCurrent: inspection });
  const zip = path.join(f.temporary, 'observed-physics.zip'); await writeExportZip(delivery, zip); await verifyBackendProjectDelivery(zip);
  const moved = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-physics-observation-relocated-')); t.after(() => fs.rm(moved, { recursive: true, force: true }));
  const archive = await yauzl.openPromise(zip, { lazyEntries: true, autoClose: false });
  try { for await (const entry of archive.eachEntry()) {
    assert.ok(!entry.fileName.startsWith('/') && !entry.fileName.split('/').includes('..'));
    const chunks = []; for await (const chunk of await archive.openReadStreamPromise(entry)) chunks.push(chunk);
    const file = path.join(moved, entry.fileName); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, Buffer.concat(chunks));
  } } finally { await new Promise(resolve => { archive.reader.once('close', resolve); archive.close(); }); }
  assert.deepEqual(await hashes(f.author), before);
  await fs.rename(f.author, f.author + '.offline'); await fs.rename(output, output + '.offline');
  const observed = await execute(f, path.join(moved, 'project'), { scriptCheck: true });
  assert.equal(observed.snapshot.samples.length, 30);
  assert.deepEqual(observed.reader.projectEvents.entries.map(entry => entry.name), ['physics.entered', 'physics.exited']);
  assert.equal(observed.reader.animationCompletions.sequence, 1);
  record('portable-relocation', f, observed, before);
  if (reportPath) { const destination = path.join(path.dirname(reportPath), 'observed-physics.zip'); await fs.copyFile(zip, destination, fs.constants.COPYFILE_EXCL); evidence.at(-1).zip = { path: destination, sha256: hash(await fs.readFile(zip)) }; }
});

test('real window capture uses the same smoke observation clock and retains final trace', { ...real, skip: !tool || !capturePath ? 'Set VIENTO_GODOT_BIN and VIENTO_PHYSICS_OBSERVATION_CAPTURE for native capture verification' : false }, async t => {
  const f = await captured(await fixture(t, { animation: true })), before = await hashes(f.author);
  const output = await execute(f, await stage(f), { mode: 'windowCapture', capture: capturePath });
  assert.equal(output.snapshot.samples.length, 30); assert.ok((await fs.stat(capturePath)).size > 100);
  assert.deepEqual(await hashes(f.author), before); record('window-capture', f, output, before);
});


test('real interactive run preserves gameplay and emits no physics observation stream', real, async t => {
  const f = await fixture(t);
  await f.script('checkpoint', `extends Node
var ticks := 0
func _ready() -> void:
\tInput.action_press("ui_right")
func _physics_process(_delta: float) -> void:
\tticks += 1
\tif ticks == 15:
\t\tInput.action_release("ui_right")
\tif ticks == 30:
\t\tget_tree().root.get_node("VientoProject").call_deferred("finish_project")
func _exit_tree() -> void:
\tInput.action_release("ui_right")
`);
  const ready = await captured(f), before = await hashes(f.author), output = await execute(ready, await stage(ready), { smoke: false });
  assert.equal(output.snapshot, undefined); assert.equal(output.result.stdout.includes('VIENTO_PHYSICS2D:'), false);
  assert.ok(Math.abs(exitActors(output.reader)[0].position[0] - 135) < .2);
  assert.deepEqual(await hashes(f.author), before);
  evidence.push({ name: 'interactive-no-observation', backend: ready.generated.backend, tool: output.tool, finalActors: exitActors(output.reader),
    observationStream: false, authorFiles: Object.keys(before).length, authorSha256: hash(JSON.stringify(before)) });
});
