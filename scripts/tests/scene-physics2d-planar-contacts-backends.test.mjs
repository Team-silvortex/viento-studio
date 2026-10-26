import { generateGodotPhysicsPlatformEventsProject } from '../backends/godot4-physics-platform-events.mjs';
import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import yauzl from 'yauzl';
import { scenePhysics2DContactEventsAuthor } from './helpers/scene-physics2d-contact-events-author-fixture.mjs';
import { scenePhysics2DPlanarContactsAuthor } from './helpers/scene-physics2d-planar-contacts-author-fixture.mjs';
import { GODOT_CHARACTER_CONTACT_EVENTS_SCRIPT } from '../../engine/godot-character-contact-events-script.mjs';
import { captureBuildSnapshot } from '../adapters/node-build-snapshot.mjs';
import { buildProject } from '../adapters/node-project-build.mjs';
import { GODOT4_EXECUTION_ADAPTER as adapter } from '../backends/godot4-adapter.mjs';
import { generateGodotPhysicsOneWayProject } from '../backends/godot4-physics-one-way.mjs';
import { generateGodotPhysicsMovementContactsProject, godotPhysicsMovementContactsAssemblyScripts } from '../backends/godot4-physics-movement-contacts.mjs';
import { generateGodotPhysicsCharacterContactsProject } from '../backends/godot4-physics-character-contacts.mjs';
import { inspectBackendProject } from '../adapters/node-backend-project.mjs';
import { planBackendProjectDelivery, verifyBackendProjectDelivery } from '../adapters/node-backend-project-delivery.mjs';
import { runBuildProcess } from '../lib/build-process.mjs';
import { writeExportZip } from '../lib/export-package.mjs';

const tool = process.env.VIENTO_GODOT_BIN;
const real = { skip: !tool ? 'Set VIENTO_GODOT_BIN for native observation verification' : false, timeout: 180000 };
const capturePath = process.env.VIENTO_PHYSICS_PLANAR_CONTACTS_CAPTURE;
const reportPath = process.env.VIENTO_PHYSICS_PLANAR_CONTACTS_REPORT;
const evidence = [];
const hash = value => createHash('sha256').update(value).digest('hex');
const id = n => `78787878-7878-4878-8878-${String(n).padStart(12, '0')}`;
test.after(async () => { if (reportPath) await fs.writeFile(reportPath, JSON.stringify({ format: 'viento-physics-planar-contacts-proof', schemaVersion: 1, tool, cases: evidence }, null, 2) + '\n', { flag: 'wx' }); });
async function hashes(directory, prefix = '') {
  const result = {};
  for (const item of await fs.readdir(path.join(directory, prefix), { withFileTypes: true })) {
    const name = prefix ? `${prefix}/${item.name}` : item.name;
    if (item.isDirectory()) Object.assign(result, await hashes(directory, name));
    else { assert.ok(item.isFile()); result[name] = hash(await fs.readFile(path.join(directory, name))); }
  }
  return result;
}
// Keep historical layer byte assertions on the frozen .31 generation chain.
// Current adapter execution and delivered builds are covered independently.
async function captured(f) {
  const captured = await captureBuildSnapshot(f.author, f.assemblyId);
  assert.equal(captured.ok, true, JSON.stringify(captured.diagnostics));
  return { ...f, captured, generated: await generateGodotPhysicsPlatformEventsProject(captured.plan) };
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

const fixture = scenePhysics2DPlanarContactsAuthor;
const capability = 'physics.character-contacts2d';
const inventoryError = { errorCode: 'build_physics_movement_contacts_invalid' };
function exitActors(output, visitIndex) { return output.reader.events.find(frame => frame.event === 'scene-exit' && (!visitIndex || frame.visitIndex === visitIndex)).actors; }
function publications(output, bindingId) { return output.reader.events.filter(frame => frame.event === 'event-publish' && (!bindingId || frame.bindingId === bindingId)); }
function record(name, f, output, before) {
  evidence.push({ name, backend: f.generated.backend, tool: output.tool, samples: output.snapshot?.samples || [],
    publications: publications(output), audio: output.reader.events.filter(frame => frame.event === 'audio-command'),
    animation: output.reader.events.filter(frame => frame.event === 'animation-command'), finalActors: exitActors(output),
    authorFiles: Object.keys(before).length, authorSha256: hash(JSON.stringify(before)) });
}
const names = output => output.map(frame => frame.name);
const movementEdges = ['physics.contact_started', 'physics.contact_ended', 'physics.contact_started'];


// The previous author TXT still reads exactly the same protocol-1 port.
for (const response of ['stop', 'slide']) test(`real planar ${response} edges stop beside the wall and drive ordinary animation and audio`, real, async t => {
  const raw = await fixture(t, { consumers: true, response });
  if (response === 'stop') await raw.script('contact-events', GODOT_CHARACTER_CONTACT_EVENTS_SCRIPT.replace('supported 2D collision movement', 'gravity and jumping'));
  const f = await captured(raw), before = await hashes(f.author), output = await execute(f, await stage(f), { scriptCheck: true });
  const published = publications(output, f.publisherBindingId);
  assert.deepEqual(names(published), movementEdges);
  assert.ok(published.every(frame => frame.instanceId === f.instanceId && frame.value === f.otherInstanceId));
  assert.equal(output.snapshot.samples.length, 30);
  assert.ok(output.snapshot.samples.every(sample => sample.requestedMotion[1] === 0));
  const samples = output.snapshot.samples, touching = sample => sample.contacts.some(contact => contact.collider?.bodyId === f.otherBodyId);
  const stopped = samples.filter(sample => sample.requestedMotion.every(value => value === 0));
  assert.ok(stopped.length > 0); assert.ok(stopped.every(sample => !touching(sample)));
  const edgeSample = samples.findIndex((sample, index) => index > 0 && touching(samples[index - 1]) && !touching(sample));
  assert.ok(edgeSample > 0); assert.deepEqual(samples[edgeSample].positionAfter, samples[edgeSample - 1].positionAfter);
  assert.ok(samples.some(sample => sample.requestedMotion[0] < 0));
  assert.ok(Math.abs(exitActors(output)[0].position[0] - 130) < .2);
  const entries = output.reader.projectEvents.entries.filter(entry => entry.origin.bindingId === f.publisherBindingId);
  assert.ok(entries.every(entry => entry.origin.source.sourcePath === f.manifestPath));
  assert.ok(entries.find(entry => entry.name === 'physics.contact_ended').deliveries.some(delivery => delivery.origin.bindingId === f.animationBindingId && delivery.status === 'handled'));
  assert.equal(output.reader.animationCompletions.sequence, 1);
  assert.equal(output.reader.events.filter(frame => frame.event === 'audio-command' && frame.bindingId === f.audioBindingId && frame.action === 'play').length, 2);
  assert.deepEqual(publications(output, f.motionPublisherBindingId), []);
  assert.deepEqual(await hashes(f.author), before); record(`planar-${response}-edges-media`, f, output, before);
});

test('real planar collector moves once and publishes nothing without an author publisher', real, async t => {
  const f = await fixture(t); await f.edit(f.manifestPath, document => { document.bindings = document.bindings.filter(binding => binding.bindingId !== f.publisherBindingId); });
  const ready = await captured(f), before = await hashes(f.author), output = await execute(ready, await stage(ready));
  const previous = await generateGodotPhysicsOneWayProject(ready.captured.plan), legacy = await execute(ready, await stage(ready, previous), { generated: previous });
  assert.deepEqual(output.snapshot.samples, legacy.snapshot.samples); assert.deepEqual(exitActors(output), exitActors(legacy));
  assert.deepEqual(publications(output).filter(frame => frame.name.startsWith('physics.contact_')), []);
  assert.deepEqual(await hashes(f.author), before); record('one-move-no-publisher', ready, output, before);
});

test('real planar collision masks suppress contact facts and allow movement through the wall', real, async t => {
  const f = await fixture(t); await f.edit(f.physicsPath, document => { document.bodies[0].mask = 2; });
  const ready = await captured(f), before = await hashes(f.author), output = await execute(ready, await stage(ready));
  assert.deepEqual(publications(output, f.publisherBindingId), []);
  assert.ok(output.snapshot.samples.every(sample => sample.contacts.length === 0)); assert.ok(exitActors(output)[0].position[0] > 165);
  assert.deepEqual(await hashes(f.author), before); record('collision-mask', ready, output, before);
});

test('real repeated-definition planar instances isolate contact ports and static or sensor behaviors receive none', real, async t => {
  const f = await fixture(t), other = id(20), body = id(21), binding = id(22);
  await f.edit('documents/scenes/demo.json', scene => { scene.actors[0].position[1] = 160; scene.actors.push({ ...structuredClone(scene.actors[0]), instanceId: other, position: [100, 200] }); });
  await f.edit(f.physicsPath, document => { document.bodies.push({ ...structuredClone(document.bodies[0]), id: body, instanceId: other }); });
  await f.edit(f.manifestPath, document => { document.bindings.push({ ...structuredClone(document.bindings.find(value => value.bindingId === f.publisherBindingId)), bindingId: binding, instanceId: other }); });
  for (const [index, instance] of [f.otherInstanceId, f.sensorInstanceId].entries()) await f.addBehavior(id(23 + index * 2), id(24 + index * 2), `non-character-${index}`, `extends Node
func _ready() -> void:
\tprint("NON_CHARACTER_${index}:" + str(has_meta("viento_character_contacts")))
`, {}, instance);
  const ready = await captured(f), before = await hashes(f.author), output = await execute(ready, await stage(ready));
  for (const owner of [f.publisherBindingId, binding]) assert.deepEqual(names(publications(output, owner)), movementEdges);
  assert.ok(publications(output, binding).every(frame => frame.instanceId === other && frame.value === f.otherInstanceId));
  assert.ok(output.result.stdout.includes('NON_CHARACTER_0:false')); assert.ok(output.result.stdout.includes('NON_CHARACTER_1:false')); assert.equal(output.snapshot.samples.length, 60);
  assert.deepEqual(await hashes(f.author), before); record('instance-isolation-and-non-characters', ready, output, before);
});

test('real undeclared planar blocker with copied identity metadata creates no author contact edge', real, async t => {
  const f = await fixture(t); await f.edit(f.physicsPath, document => { document.bodies = document.bodies.filter(body => body.id !== f.otherBodyId); });
  await f.script('checkpoint', `extends Node
func _ready() -> void:
\tvar body := StaticBody2D.new()
\tbody.position = Vector2(145, 180)
\tbody.set_meta("viento_instance_id", "${f.otherInstanceId}")
\tvar collision := CollisionShape2D.new()
\tvar shape := RectangleShape2D.new()
\tshape.size = Vector2(10, 100)
\tcollision.shape = shape
\tbody.add_child(collision)
\tget_parent().get_parent().add_child(body)
`);
  const ready = await captured(f), before = await hashes(f.author), output = await execute(ready, await stage(ready));
  assert.ok(output.snapshot.samples.some(sample => sample.contacts.some(contact => contact.collider === null)));
  assert.deepEqual(publications(output, f.publisherBindingId), []); assert.ok(Math.abs(exitActors(output)[0].position[0] - 130) < .2);
  assert.deepEqual(await hashes(f.author), before); record('unknown-collider', ready, output, before);
});

test('real mixed motor and planar movement preserves jumping landed events and the original single solve', real, async t => {
  const f = await scenePhysics2DContactEventsAuthor(t), other = id(30), body = id(31), wall = id(32), wallBody = id(33), binding = id(34);
  await f.edit('documents/scenes/demo.json', scene => {
    scene.actors.push({ ...structuredClone(scene.actors[0]), instanceId: other, position: [300, 80] });
    scene.actors.push({ ...structuredClone(scene.actors[2]), instanceId: wall, position: [345, 80], size: [10, 100] });
  });
  await f.edit(f.physicsPath, document => {
    const planar = { ...structuredClone(document.bodies[0]), id: body, instanceId: other }; delete planar.characterMotion;
    document.bodies.push(planar, { ...structuredClone(document.bodies[2]), id: wallBody, instanceId: wall, shape: { kind: 'box', size: [10, 100] } });
  });
  await f.edit(f.manifestPath, document => { document.bindings.push({ ...structuredClone(document.bindings.find(value => value.bindingId === f.publisherBindingId)), bindingId: binding, instanceId: other, parameters: { started_event: 'planar.started', ended_event: 'planar.ended', other_instance_id: wall } }); });
  const ready = await captured(f), before = await hashes(f.author), output = await execute(ready, await stage(ready));
  assert.deepEqual(names(publications(output, f.motionPublisherBindingId)), ['physics.landed', 'physics.jumped', 'physics.landed']);
  assert.deepEqual(names(publications(output, f.publisherBindingId)), movementEdges);
  assert.deepEqual(names(publications(output, binding)), ['planar.started', 'planar.ended']); assert.equal(output.snapshot.samples.length, 60);
  // The historic collector cannot give planar behaviors a port: omit that one
  // binding solely in its generated scene when comparing native movement.
  const legacyAuthor = await scenePhysics2DContactEventsAuthor(t);
  await legacyAuthor.write('documents/scenes/demo.json', await f.read('documents/scenes/demo.json'));
  await legacyAuthor.write(f.physicsPath, await f.read(f.physicsPath));
  const legacyReady = await captured(legacyAuthor), previous = await generateGodotPhysicsCharacterContactsProject(legacyReady.captured.plan);
  const legacy = await execute(legacyReady, await stage(legacyReady, previous), { generated: previous });
  assert.deepEqual(output.snapshot.samples, legacy.snapshot.samples); assert.deepEqual(exitActors(output), exitActors(legacy));
  assert.deepEqual(await hashes(f.author), before); record('mixed-motor-and-planar', ready, output, before);
});
test('real reentry revokes old contact ports and new visits start with an empty collision history', real, async t => {
  const f = await fixture(t);
  await f.script('checkpoint', `extends Node
static var prior_port
static var switched := false
func _ready() -> void:
\tvar port = get_meta("viento_character_contacts")
\tif prior_port != null:
\t\tprint("CONTACT_STALE:" + JSON.stringify({"different": prior_port != port, "started": prior_port.get_signal_connection_list("started").size(), "ended": prior_port.get_signal_connection_list("ended").size()}))
\tprior_port = port
\tport.ended.connect(_ended)
func _ended(_body_id: String, _instance_id: String) -> void:
\tif not switched:
\t\tswitched = true
\t\tget_meta("viento_project").request_scene("${f.sceneIds[1]}")
func _exit_tree() -> void:
\tvar port = get_meta("viento_character_contacts")
\tprint("CONTACT_EXIT:" + JSON.stringify({"started": port.get_signal_connection_list("started").size(), "ended": port.get_signal_connection_list("ended").size()}))
`);
  await f.script('second', `extends Node\nfunc _ready() -> void:\n\tget_meta("viento_project").request_scene("${f.sceneIds[0]}")\n`);
  const ready = await captured(f), before = await hashes(f.author), output = await execute(ready, await stage(ready));
  const stale = output.result.stdout.split('\n').filter(line => line.startsWith('CONTACT_STALE:')).map(line => JSON.parse(line.slice(14)));
  const exits = output.result.stdout.split('\n').filter(line => line.startsWith('CONTACT_EXIT:')).map(line => JSON.parse(line.slice(13)));
  assert.deepEqual(stale, [{ different: true, started: 0, ended: 0 }]); assert.equal(exits.length, 2); assert.ok(exits.every(value => value.started === 0 && value.ended === 0));
  const visits = [...new Set(publications(output, f.publisherBindingId).map(frame => frame.visitIndex))]; assert.deepEqual(visits, [1, 3]);
  for (const visit of visits) { const edges = publications(output, f.publisherBindingId).filter(frame => frame.visitIndex === visit); assert.equal(edges[0].name, 'physics.contact_started'); assert.ok(edges.some(frame => frame.name === 'physics.contact_ended')); }
  assert.deepEqual(await hashes(f.author), before); record('reentry', ready, output, before);
});

test('real planar contact callbacks cannot reenter project_step or duplicate native movement', real, async t => {
  const f = await fixture(t);
  await f.script('checkpoint', `extends Node
func _ready() -> void:
\tget_meta("viento_character_contacts").started.connect(_contact)
func _contact(_body_id: String, _instance_id: String) -> void:
\tget_parent().get_parent().project_step(0.1)
`);
  const ready = await captured(f), before = await hashes(f.author), output = await execute(ready, await stage(ready));
  assert.equal(output.snapshot.samples.length, 30); assert.deepEqual(names(publications(output, f.publisherBindingId)), movementEdges);
  assert.ok(Math.abs(exitActors(output)[0].position[0] - 130) < .2);
  assert.deepEqual(await hashes(f.author), before); record('callback-reentrancy', ready, output, before);
});

test('real close during the first contact callback revokes later ports without synthesizing ended', real, async t => {
  const f = await captured(await fixture(t, { jump: false })), directory = await stage(f), identified = await adapter.identify(tool);
  const imported = await adapter.executePhase({ phase: 'import', directory, tool: identified, timeoutMs: 60000 }); assert.equal(imported.status, 'succeeded');
  await fs.writeFile(path.join(directory, 'planar-contact-close-probe.gd'), `extends SceneTree
var scene
var first_count := 0
var later_count := 0
var ended_count := 0
func _initialize() -> void:
\tcall_deferred("probe")
func probe() -> void:
\tvar project = load("res://project.tscn").instantiate()
\troot.add_child(project)
\tproject.set_physics_process(false)
\tscene = project.current
\tvar first = scene.find_child("behavior_${f.bindingId.replaceAll('-', '_')}", true, false).get_meta("viento_character_contacts")
\tvar later = scene.find_child("behavior_${f.publisherBindingId.replaceAll('-', '_')}", true, false).get_meta("viento_character_contacts")
\tfirst.started.connect(close_first)
\tlater.started.connect(later_started)
\tfirst.ended.connect(ended)
\tlater.ended.connect(ended)
\tfor _step in range(16):
\t\tawait physics_frame
\t\tawait process_frame
\t\tif not scene.project_open:
\t\t\tbreak
\t\tscene.project_step(1.0 / 60.0)
\tprint("CONTACT_CLOSE:" + JSON.stringify({"first": first_count, "later": later_count, "ended": ended_count, "open": scene.project_open, "connections": later.get_signal_connection_list("started").size()}))
\tproject.free()
\tquit()
func close_first(_body: String, _instance: String) -> void:
\tfirst_count += 1
\tscene.project_close()
func later_started(_body: String, _instance: String) -> void:
\tlater_count += 1
func ended(_body: String, _instance: String) -> void:
\tended_count += 1
`);
  const result = await runBuildProcess(identified.executable, ['--headless', '--path', directory, '--script', 'res://planar-contact-close-probe.gd'], { cwd: directory, timeoutMs: 60000, env: { ...process.env, GODOT_SILENCE_ROOT_WARNING: '1' } });
  assert.equal(result.status, 'succeeded', result.stdout + result.stderr); assert.deepEqual(adapter.diagnostics(result, f.captured.plan), [], result.stdout + result.stderr);
  const line = result.stdout.split('\n').find(line => line.startsWith('CONTACT_CLOSE:')); assert.ok(line, result.stdout);
  const outcome = JSON.parse(line.slice(14)); assert.deepEqual(outcome, { first: 1, later: 0, ended: 0, open: false, connections: 0 });
  evidence.push({ name: 'close-during-callback', backend: f.generated.backend, tool: identified, outcome });
});

test('real live contact lifecycle publishes events and media without smoke trace', real, async t => {
  const f = await captured(await fixture(t, { consumers: true, live: true })), before = await hashes(f.author), output = await execute(f, await stage(f), { smoke: false });
  assert.equal(output.snapshot, undefined); assert.equal(output.result.stdout.includes('VIENTO_PHYSICS2D:'), false);
  assert.deepEqual(names(publications(output, f.publisherBindingId)), movementEdges);
  assert.equal(output.reader.events.filter(frame => frame.event === 'audio-command' && frame.bindingId === f.audioBindingId).length, 2);
  assert.deepEqual(await hashes(f.author), before); record('live', f, output, before);
});

test('real portable ZIP retains contact lifecycle and media without original author or build paths', real, async t => {
  const f = await captured(await fixture(t, { consumers: true })), before = await hashes(f.author), output = path.join(f.temporary, 'build');
  const built = await buildProject({ root: f.author, targetId: f.assemblyId, tool, output }); assert.equal(built.ok, true, JSON.stringify(built.record?.diagnostics || built));
  const inspection = () => inspectBackendProject({ buildDirectory: output });
  const delivery = await planBackendProjectDelivery({ inspection: await inspection(), assertCurrent: inspection });
  const zip = path.join(f.temporary, 'planar-contacts.zip'); await writeExportZip(delivery, zip); await verifyBackendProjectDelivery(zip);
  const moved = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-physics-planar-contacts-relocated-')); t.after(() => fs.rm(moved, { recursive: true, force: true }));
  const archive = await yauzl.openPromise(zip, { lazyEntries: true, autoClose: false });
  try { for await (const entry of archive.eachEntry()) {
    assert.ok(!entry.fileName.startsWith('/') && !entry.fileName.split('/').includes('..'));
    const chunks = []; for await (const chunk of await archive.openReadStreamPromise(entry)) chunks.push(chunk);
    const file = path.join(moved, entry.fileName); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, Buffer.concat(chunks));
  } } finally { await new Promise(resolve => { archive.reader.once('close', resolve); archive.close(); }); }
  assert.deepEqual(await hashes(f.author), before); await fs.rename(f.author, f.author + '.offline'); await fs.rename(output, output + '.offline');
  const observed = await execute(f, path.join(moved, 'project'), { scriptCheck: true });
  assert.deepEqual(names(publications(observed, f.publisherBindingId)), movementEdges); assert.equal(observed.reader.animationCompletions.sequence, 1);
  assert.equal(observed.reader.events.filter(frame => frame.event === 'audio-command' && frame.bindingId === f.audioBindingId).length, 2);
  record('portable-relocation', f, observed, before);
  if (reportPath) { const destination = path.join(path.dirname(reportPath), 'planar-contacts.zip'); await fs.copyFile(zip, destination, fs.constants.COPYFILE_EXCL); evidence.at(-1).zip = { path: destination, sha256: hash(await fs.readFile(zip)) }; }
});

test('real native window capture retains completed contact events and author media', { ...real, skip: !tool || !capturePath ? 'Set VIENTO_GODOT_BIN and VIENTO_PHYSICS_PLANAR_CONTACTS_CAPTURE for native capture verification' : false }, async t => {
  const f = await captured(await fixture(t, { consumers: true })), before = await hashes(f.author), output = await execute(f, await stage(f), { mode: 'windowCapture', capture: capturePath });
  assert.deepEqual(names(publications(output, f.publisherBindingId)), movementEdges); assert.ok((await fs.stat(capturePath)).size > 100);
  assert.deepEqual(await hashes(f.author), before); record('window-capture', f, output, before);
});


test('movement contact generator preserves old movement bytes and author wire formats for planar and motor scenes', async t => {
  for (const f of [await fixture(t), await scenePhysics2DContactEventsAuthor(t)]) {
    const ready = await captured(f), before = structuredClone(ready.captured.plan), previous = await generateGodotPhysicsOneWayProject(ready.captured.plan);
    const prefix = `scenes/${f.sceneIds[0]}/`, motor = previous.files.has('character-motion-project.json');
    assert.equal(ready.generated.backend.version, '0.28.0'); assert.deepEqual(ready.captured.plan, before);
    assert.deepEqual(ready.generated.sourceMap, previous.sourceMap); assert.equal(ready.generated.backend.protocolVersion, previous.backend.protocolVersion);
    assert.ok(ready.generated.backend.capabilities.includes(capability)); assert.ok(!before.requiredCapabilities.includes(capability));
    for (const [name, bytes] of previous.files) {
      const saved = name === prefix + 'project-scene.gd' ? prefix + 'movement-contacts-original.gd' : !motor && name === prefix + 'physics-observation-base.gd' ? prefix + 'movement-contacts-planar-original.gd' : name;
      assert.deepEqual(ready.generated.files.get(saved), bytes, name);
    }
    const scene = ready.generated.files.get(prefix + 'project-scene.gd').toString();
    assert.equal(scene.split('super.physics_observation_move(character, motion, response)').length, 2);
    assert.equal(scene.split('movement_contacts.begin(self)').length, 2); assert.equal(scene.split('movement_contacts.finish(self)').length, 2);
    const helper = ready.generated.files.get('movement-contacts-helper.gd').toString();
    assert.ok(!helper.includes('move_and_collide')); assert.ok(!helper.includes('publish_event'));
    assert.deepEqual(ready.generated.files.get('movement-contacts-port.gd'), await fs.readFile(new URL('../backends/godot4/physics-character-contacts-port.gd', import.meta.url)));
    const manifest = JSON.parse(ready.generated.files.get('movement-contacts-project.json'));
    assert.deepEqual(manifest.sceneIds, [f.sceneIds[0]]); assert.deepEqual(manifest.planarSceneIds, motor ? [] : [f.sceneIds[0]]);
  }
});

test('projects with no characters preserve previous output without the optional contact capability', async t => {
  const f = await fixture(t); await f.edit(f.physicsPath, document => { document.bodies = document.bodies.filter(body => body.kind !== 'character'); });
  const ready = await captured(f), { artifact, ...actual } = ready.generated;
  assert.deepEqual(actual, await generateGodotPhysicsOneWayProject(ready.captured.plan)); assert.ok(!actual.backend.capabilities.includes(capability));
  await assert.rejects(generateGodotPhysicsMovementContactsProject(ready.captured.plan.scenes[0]), { errorCode: 'build_physics_requires_project' });
});

test('movement contact inventory rejects missing linked stale and mixed hooks while accepting historical projects', async t => {
  const f = await captured(await fixture(t)), directory = await stage(f), scripts = await godotPhysicsMovementContactsAssemblyScripts(directory);
  for (const name of f.generated.files.keys()) if (name.endsWith('.gd')) assert.ok(scripts.includes(name), name);
  const prefix = `scenes/${f.sceneIds[0]}/`;
  for (const name of ['movement-contacts-project.json', 'movement-contacts-helper.gd', 'movement-contacts-port.gd', prefix + 'movement-contacts-original.gd', prefix + 'movement-contacts-planar-original.gd']) {
    const file = path.join(directory, name), original = await fs.readFile(file);
    await fs.rm(file); await assert.rejects(godotPhysicsMovementContactsAssemblyScripts(directory), inventoryError);
    await fs.symlink(path.join(f.author, f.physicsPath), file); await assert.rejects(godotPhysicsMovementContactsAssemblyScripts(directory), inventoryError);
    await fs.rm(file); await fs.writeFile(file, original);
  }
  const manifestPath = path.join(directory, 'movement-contacts-project.json'), manifest = await fs.readFile(manifestPath);
  for (const value of [{ ...JSON.parse(manifest), extra: true }, { ...JSON.parse(manifest), sceneIds: [] }, { ...JSON.parse(manifest), planarSceneIds: [] }, { ...JSON.parse(manifest), sceneIds: [f.sceneIds[1]] }]) {
    await fs.writeFile(manifestPath, JSON.stringify(value)); await assert.rejects(godotPhysicsMovementContactsAssemblyScripts(directory), inventoryError);
  }
  await fs.writeFile(manifestPath, manifest);
  const scenePath = path.join(directory, prefix + 'project-scene.gd'), scene = await fs.readFile(scenePath);
  await fs.writeFile(scenePath, scene.toString().replace('movement_contacts.finish(self)', 'movement_contacts.begin(self)'));
  await assert.rejects(godotPhysicsMovementContactsAssemblyScripts(directory), inventoryError); await fs.writeFile(scenePath, scene);
  const orphan = path.join(directory, `scenes/${f.sceneIds[1]}/movement-contacts-original.gd`); await fs.writeFile(orphan, scene);
  await assert.rejects(godotPhysicsMovementContactsAssemblyScripts(directory), inventoryError); await fs.rm(orphan);
  const mixed = path.join(directory, 'character-contacts-project.json'); await fs.writeFile(mixed, '{}');
  await assert.rejects(godotPhysicsMovementContactsAssemblyScripts(directory), inventoryError); await fs.rm(mixed);
  const previous = await stage(f, await generateGodotPhysicsOneWayProject(f.captured.plan)); assert.ok(await godotPhysicsMovementContactsAssemblyScripts(previous));
  await fs.writeFile(path.join(previous, 'movement-contacts-port.gd'), f.generated.files.get('movement-contacts-port.gd'));
  await assert.rejects(godotPhysicsMovementContactsAssemblyScripts(previous), inventoryError);
  const motor = await captured(await scenePhysics2DContactEventsAuthor(t)), historical = await stage(motor, await generateGodotPhysicsCharacterContactsProject(motor.captured.plan));
  assert.ok(await godotPhysicsMovementContactsAssemblyScripts(historical));
});
