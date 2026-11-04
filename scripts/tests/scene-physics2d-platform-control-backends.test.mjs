import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import yauzl from 'yauzl';
import { captureBuildSnapshot } from '../adapters/node-build-snapshot.mjs';
import { buildProject } from '../adapters/node-project-build.mjs';
import { inspectBackendProject } from '../adapters/node-backend-project.mjs';
import { planBackendProjectDelivery, verifyBackendProjectDelivery } from '../adapters/node-backend-project-delivery.mjs';
import { writeExportZip } from '../lib/export-package.mjs';
import { GODOT4_EXECUTION_ADAPTER as adapter } from '../backends/godot4-adapter.mjs';
import { GODOT_PLATFORM_CONTROL_SCRIPT } from '../../engine/godot-platform-control-script.mjs';
import { scenePhysics2DPlatformControlAuthor } from './helpers/scene-physics2d-platform-control-author-fixture.mjs';
const tool = process.env.VIENTO_GODOT_BIN;
const native = { skip: !tool ? 'Set VIENTO_GODOT_BIN for native platform control verification' : false, timeout: 180000 };
const id = n => `94949494-9494-4494-8494-${String(n).padStart(12, '0')}`;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const report = process.env.VIENTO_PHYSICS_PLATFORM_CONTROL_REPORT, evidence = [];
test.after(async () => { if (report) await fs.writeFile(report, JSON.stringify({ format: 'viento-platform-control-proof', schemaVersion: 1, tool, cases: evidence }, null, 2) + '\n'); });
async function authorHashes(directory, prefix = '') {
  const output = {};
  for (const row of await fs.readdir(path.join(directory, prefix), { withFileTypes: true })) {
    const name = prefix ? `${prefix}/${row.name}` : row.name;
    if (row.isDirectory()) Object.assign(output, await authorHashes(directory, name));
    else { assert.ok(row.isFile()); output[name] = hash(await fs.readFile(path.join(directory, name))); }
  }
  return output;
}
async function probe(f, { ready = '', step = '', target = f.platformInstanceId, number = 1 } = {}) {
  await f.addBehavior(id(number * 2 - 1), id(number * 2), `control-probe-${number}`, `extends Node
var ticks := -1
var control
var scene
func _ready() -> void:
\tscene = get_parent().get_parent()
\tcontrol = get_meta("viento_platform_control")
\tassert(control.protocol_version() == 1)
\tassert(control.read_running() == true)
\tvar endpoints = get_meta("viento_platform_events")
\tendpoints.origin_reached.connect(endpoint.bind("origin"))
\tendpoints.destination_reached.connect(endpoint.bind("destination"))
${ready || '\tpass'}
func endpoint(name: String) -> void:
\tprint("CONTROL_ENDPOINT:" + JSON.stringify({"name":name,"step":scene.physics_observation_step,"platform":"${target}"}))
func _physics_process(_delta: float) -> void:
\tvar tick: int = scene.physics_observation_step
\tif ticks == tick:
\t\treturn
\tticks = tick
${step || '\tpass'}
\tvar rows := []
\tfor actor in scene.actors:
\t\tif actor["instanceId"] in ["${f.instanceId}","${f.otherInstanceId}","${f.platformInstanceId}","${f.stationaryInstanceId}"]:
\t\t\trows.append({"id":actor["instanceId"],"position":[actor["node"].position.x,actor["node"].position.y],"grounded":scene.character_motion_grounded.get(actor["instanceId"],false) if scene.get("character_motion_grounded") is Dictionary else false})
\tprint("CONTROL_PROBE:" + JSON.stringify({"step":ticks,"visit":scene.project_visit,"actors":rows,"phase":scene.platform_motion.platforms["${target}"]["phase"],"running":control.read_running(),"platform":"${target}"}))
`, {}, target);
}
async function captured(f) {
  const captured = await captureBuildSnapshot(f.author, f.assemblyId);
  assert.equal(captured.ok, true, JSON.stringify(captured.diagnostics));
  const before = structuredClone(captured.plan), generated = await adapter.generate(captured.plan);
  assert.deepEqual(captured.plan, before);
  assert.ok(generated.backend.capabilities.includes('physics.platform-control2d'));
  assert.equal(generated.backend.version, '0.40.0');
  return { ...f, captured, generated };
}
async function stage(f) {
  const directory = await fs.mkdtemp(path.join(f.temporary, 'control-staged-'));
  const files = [...f.generated.files, ...[...(f.generated.resourceFiles || [])].map(([id, name]) => [name, f.captured.resources.get(id)])];
  for (const [name, bytes] of files) { const file = path.join(directory, name); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, bytes); }
  return directory;
}
async function execute(f, directory, { scriptCheck = false, backend = f.generated.backend, mode = 'headlessLogic', capturePath } = {}) {
  const identified = await adapter.identify(tool);
  for (const phase of scriptCheck ? adapter.buildPhases : adapter.runtimePhases) {
    const result = await adapter.executePhase({ phase, directory, tool: identified, timeoutMs: 60000 });
    assert.equal(result.status, 'succeeded', result.stdout + result.stderr);
    assert.deepEqual(adapter.diagnostics(result, f.captured.plan), [], result.stdout + result.stderr);
  }
  const result = await adapter.executePhase({ phase: 'run', directory, tool: identified, timeoutMs: 60000, mode, ...(capturePath ? { capturePath } : {}) });
  if (report) await fs.appendFile(report.replace(/\.json$/, '-stdout.log'), result.stdout + result.stderr + '\n');
  assert.equal(result.status, 'succeeded', result.stdout + result.stderr);
  assert.deepEqual(adapter.diagnostics(result, f.captured.plan), [], result.stdout + result.stderr);
  assert.ok(!result.stdout.includes('Assertion failed'), result.stdout);
  const reader = adapter.createEventReader(f.captured.plan, { smoke: true, capabilities: backend.capabilities });
  reader.push(result.stdout); assert.deepEqual(reader.finish().diagnostics, [], result.stdout);
  const trace = reader.snapshot(); assert.equal(trace.phase, 'finished');
  const parse = prefix => result.stdout.split('\n').filter(line => line.startsWith(prefix)).map(line => JSON.parse(line.slice(prefix.length)));
  return { result, reader, trace, probes: parse('CONTROL_PROBE:'), endpoints: parse('CONTROL_ENDPOINT:'), tool: identified };
}
function actor(row, instanceId) { return row.actors.find(actor => actor.id === instanceId); }
function remember(name, f, output, hashes) {
  evidence.push({ name, backend: f.generated.backend, tool: output.tool, probes: output.probes, endpoints: output.endpoints,
    samples: output.trace.samples, events: output.reader.events, authorFiles: Object.keys(hashes).length, authorSha256: hash(JSON.stringify(hashes)) });
}
function own(f, output) { return output.probes.filter(row => row.platform === f.platformInstanceId); }
for (const axis of ['horizontal', 'vertical']) test(`real ${axis} platform pause preserves phase, support and independent platform motion`, native, async t => {
  const raw = await scenePhysics2DPlatformControlAuthor(t, { axis });
  await probe(raw, { step: `\tif ticks == 6:
\t\tassert(control.request_running(false))
\t\tassert(not control.request_running(true))
\t\tassert(control.read_running() == true)
\tif ticks == 18:
\t\tassert(control.request_running(true))
\t\tassert(control.read_running() == false)` });
  const f = await captured(raw), hashes = await authorHashes(f.author), directory = await stage(f), output = await execute(f, directory, { scriptCheck: true });
  const rows = own(f, output), paused = rows.filter(row => row.step >= 7 && row.step <= 18);
  assert.ok(paused.length >= 10); assert.equal(new Set(paused.map(row => row.phase)).size, 1);
  assert.ok(paused.every(row => row.running === false));
  assert.ok(rows.some(row => row.step > 18 && row.running === true && row.phase !== paused[0].phase));
  const axisIndex = axis === 'vertical' ? 1 : 0;
  assert.equal(new Set(paused.map(row => actor(row, f.platformInstanceId).position[axisIndex])).size, 1);
  assert.ok(new Set(paused.map(row => actor(row, f.stationaryInstanceId).position[0])).size > 4);
  for (const row of rows.filter(row => row.step >= 3)) {
    assert.ok(Math.abs(actor(row, f.instanceId).position[1] - actor(row, f.platformInstanceId).position[1] + 15) < .2, JSON.stringify(row));
    assert.equal(actor(row, f.instanceId).grounded, true);
  }
  assert.ok(!output.endpoints.some(row => row.platform === f.platformInstanceId && row.step >= 7 && row.step <= 18));
  const before = rows.find(row => row.step === 18), after = rows.find(row => row.step === 19);
  assert.ok(Math.abs((after.phase - before.phase + 96) % 96 - 4) < .001, JSON.stringify({ before, after }));
  for (const [name, bytes] of f.generated.files) assert.deepEqual(await fs.readFile(path.join(directory, name)), bytes, name);
  assert.deepEqual(await authorHashes(f.author), hashes); remember(`${axis}-pause-resume`, f, output, hashes);
});
for (const axis of ['horizontal', 'vertical']) test(`real ${axis} initial pause applies on the first project step and resumes without catch-up`, native, async t => {
  const raw = await scenePhysics2DPlatformControlAuthor(t, { axis });
  await probe(raw, { ready: '\tassert(control.request_running(false))\n\tassert(control.read_running() == true)',
    step: '\tif ticks == 8:\n\t\tassert(control.request_running(true))' });
  const f = await captured(raw), hashes = await authorHashes(f.author), output = await execute(f, await stage(f));
  const rows = own(f, output), paused = rows.filter(row => row.step > 0 && row.step <= 8);
  assert.ok(paused.length >= 7); assert.ok(paused.every(row => row.phase === 0 && row.running === false));
  const first = rows.find(row => row.step === 9); assert.ok(Math.abs(first.phase - 4) < .001);
  assert.ok(!output.endpoints.some(row => row.platform === f.platformInstanceId && row.step <= 8));
  assert.deepEqual(await authorHashes(f.author), hashes); remember(`${axis}-ready-pause`, f, output, hashes);
});
test('real platform control rejects non-booleans and forged port objects without redirecting metadata', native, async t => {
  const raw = await scenePhysics2DPlatformControlAuthor(t);
  await probe(raw, { ready: `\tfor value in [null, 0, 1, 0.0, 1.0, "false", [], {}, Vector2.ZERO]:
\t\tassert(not control.request_running(value))
\tvar forged = control.get_script().new(control.owner.get_ref())
\tassert(not forged.request_running(false))
\tassert(forged.read_running() == null)
\tvar original_owner = control.owner
\tcontrol.owner = null
\tassert(not control.request_running(false))
\tassert(control.read_running() == null)
\tcontrol.owner = original_owner
\tset_meta("viento_instance_id", "${raw.stationaryInstanceId}")
\tset_meta("viento_binding_id", "${id(99)}")
\tassert(control.request_running(false))`, step: '\tif ticks == 8:\n\t\tassert(control.request_running(true))' });
  const f = await captured(raw), hashes = await authorHashes(f.author), output = await execute(f, await stage(f));
  const rows = own(f, output).filter(row => row.step > 0 && row.step <= 8);
  assert.ok(rows.every(row => row.phase === 0 && row.running === false));
  assert.ok(new Set(rows.map(row => actor(row, f.stationaryInstanceId).position[0])).size > 4);
  assert.deepEqual(await authorHashes(f.author), hashes); remember('strict-values-and-port-identity', f, output, hashes);
});
test('real queued request from a removed behavior is discarded and the old port becomes invalid', native, async t => {
  const raw = await scenePhysics2DPlatformControlAuthor(t);
  await probe(raw, { ready: '\tscene.set_meta("control_original", control)', step: `\tif ticks == 6:
\t\tassert(control.request_running(false))
\t\tget_parent().remove_child(self)
\t\tscene.add_child(self)
\t\tassert(control.read_running() == null)
\t\tassert(not control.request_running(false))` });
  const f = await captured(raw), hashes = await authorHashes(f.author), output = await execute(f, await stage(f));
  const rows = own(f, output).filter(row => row.step >= 6 && row.step <= 18);
  assert.ok(rows.length > 8); assert.ok(rows.every(row => row.running === null));
  assert.ok(new Set(rows.map(row => row.phase)).size > 6);
  assert.deepEqual(await authorHashes(f.author), hashes); remember('reparent-invalidates-pending', f, output, hashes);
});
test('real competing platform bindings share one request slot and an invalid pending owner yields it', native, async t => {
  const raw = await scenePhysics2DPlatformControlAuthor(t);
  await probe(raw, { ready: '\tscene.set_meta("control_first", control)\n\tassert(control.request_running(false))' });
  await probe(raw, { number: 2, ready: `\tassert(not control.request_running(true))
\tvar first = scene.get_meta("control_first")
\tvar first_behavior
\tfor child in get_parent().get_children():
\t\tif child != self and child.has_meta("viento_platform_control") and child.get_meta("viento_platform_control") == first:
\t\t\tfirst_behavior = child
\tassert(is_instance_valid(first_behavior))
\tfirst_behavior.queue_free()
\tassert(first.read_running() == null)
\tassert(not first.request_running(true))
\tassert(control.request_running(true))` });
  const f = await captured(raw), hashes = await authorHashes(f.author), output = await execute(f, await stage(f));
  const rows = own(f, output).filter(row => row.step > 0);
  assert.ok(rows.length >= 20); assert.ok(rows.every(row => row.running === true));
  assert.ok(new Set(rows.map(row => row.phase)).size > 12);
  assert.deepEqual(await authorHashes(f.author), hashes); remember('competing-binding-first-live-request', f, output, hashes);
});
test('real portable ZIP runs controlled platforms with author and original build offline', native, async t => {
  const raw = await scenePhysics2DPlatformControlAuthor(t);
  await probe(raw, { ready: '\tassert(control.request_running(false))', step: '\tif ticks == 8:\n\t\tassert(control.request_running(true))' });
  const f = await captured(raw), hashes = await authorHashes(f.author), outputPath = path.join(f.temporary, 'build');
  const built = await buildProject({ root: f.author, targetId: f.assemblyId, tool, output: outputPath });
  assert.equal(built.ok, true, JSON.stringify(built.record?.diagnostics || built));
  const inspection = () => inspectBackendProject({ buildDirectory: outputPath });
  const delivery = await planBackendProjectDelivery({ inspection: await inspection(), assertCurrent: inspection });
  const zip = path.join(f.temporary, 'control.zip'); await writeExportZip(delivery, zip); await verifyBackendProjectDelivery(zip);
  if (report) await fs.copyFile(zip, report.replace(/\.json$/, '-platform-control.zip'));
  const moved = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-platform-control-relocated-')); t.after(() => fs.rm(moved, { recursive: true, force: true }));
  const archive = await yauzl.openPromise(zip, { lazyEntries: true, autoClose: false });
  try { for await (const entry of archive.eachEntry()) {
    assert.ok(!entry.fileName.startsWith('/') && !entry.fileName.split('/').includes('..'));
    const parts = []; for await (const bytes of await archive.openReadStreamPromise(entry)) parts.push(bytes);
    const file = path.join(moved, entry.fileName); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, Buffer.concat(parts));
  } } finally { await new Promise(resolve => { archive.reader.once('close', resolve); archive.close(); }); }
  assert.ok((await fs.stat(path.join(moved, 'project/platform-control-port.gd'))).isFile());
  assert.deepEqual(await authorHashes(f.author), hashes); await fs.rename(f.author, f.author + '.offline'); await fs.rename(outputPath, outputPath + '.offline');
  const output = await execute(f, path.join(moved, 'project'), { scriptCheck: true, backend: built.record.backend });
  const paused = own(f, output).filter(row => row.step > 0 && row.step <= 8);
  assert.ok(paused.length >= 7); assert.ok(paused.every(row => row.phase === 0 && row.running === false));
  assert.ok(own(f, output).some(row => row.step > 8 && row.running === true && row.phase > 0));
  remember('portable-zip-offline', f, output, hashes);
});


test('real trigger-area events drive a filtered ordinary platform starter through resume and pause', native, async t => {
  const raw = await scenePhysics2DPlatformControlAuthor(t);
  await raw.edit('documents/scenes/demo.json', scene => {
    scene.actors[0].speed = 120;
    const sensor = scene.actors.find(actor => actor.instanceId === raw.sensorInstanceId);
    sensor.position = [100, 145]; sensor.size = [20, 200];
  });
  await raw.edit(raw.physicsPath, document => { document.bodies.find(body => body.instanceId === raw.sensorInstanceId).shape.size = [20, 200]; });
  await raw.script('motion-input', `extends Node
var ticks := -1
func _physics_process(_delta: float) -> void:
\tvar tick: int = get_parent().get_parent().physics_observation_step
\tif ticks == tick:
\t\treturn
\tticks = tick
\tif ticks == 6:
\t\tInput.action_press("ui_right")
\tif ticks == 24:
\t\tInput.action_release("ui_right")
func _exit_tree() -> void:
\tInput.action_release("ui_right")
`);
  await raw.addBehavior(id(31), id(32), 'control-starter', GODOT_PLATFORM_CONTROL_SCRIPT,
    { initial_running: false, resume_event: 'physics.entered', pause_event: 'physics.exited', instance_id: raw.instanceId }, raw.platformInstanceId);
  await probe(raw);
  const f = await captured(raw), hashes = await authorHashes(f.author), output = await execute(f, await stage(f));
  const rows = own(f, output), publications = output.reader.events.filter(row => row.event === 'event-publish' && row.bindingId === f.sensorBindingId && row.value === f.instanceId);
  assert.ok(publications.some(row => row.name === 'physics.entered'));
  assert.ok(publications.some(row => row.name === 'physics.exited'));
  assert.ok(rows.some(row => row.step > 1 && row.running === true && row.phase > 0), JSON.stringify(rows));
  const tail = rows.filter(row => row.step >= 25);
  assert.ok(tail.length >= 3); assert.ok(tail.every(row => row.running === false));
  assert.equal(new Set(tail.map(row => row.phase)).size, 1);
  assert.deepEqual(await authorHashes(f.author), hashes); remember('native-pressure-plate-starter', f, output, hashes);
});

test('real obstacle suspension and author pause remain independent and report the applied switch', native, async t => {
  const raw = await scenePhysics2DPlatformControlAuthor(t, { offsetY: -48, bothRiders: true });
  await raw.edit('documents/scenes/demo.json', scene => { scene.actors[2].position = [100, 100]; scene.actors[2].size = [25, 10]; });
  await raw.edit(raw.physicsPath, document => { document.bodies[2].shape.size = [25, 10]; });
  await probe(raw, { step: `\tif ticks == 14:
\t\tassert(control.read_running() == true)
\t\tassert(control.request_running(false))
\tif ticks == 20:
\t\tfor candidate in scene.actors:
\t\t\tif candidate["instanceId"] == "${raw.wallInstanceId}":
\t\t\t\tcandidate["node"].collision_layer = 0
\tif ticks == 22:
\t\tassert(control.request_running(true))` });
  const f = await captured(raw), hashes = await authorHashes(f.author), output = await execute(f, await stage(f));
  const rows = own(f, output), blocked = rows.filter(row => row.step >= 10 && row.step <= 14), paused = rows.filter(row => row.step >= 15 && row.step <= 22);
  assert.ok(blocked.length >= 4); assert.ok(blocked.every(row => row.running === true));
  assert.equal(new Set(blocked.map(row => row.phase)).size, 1);
  assert.ok(paused.length >= 7); assert.ok(paused.every(row => row.running === false));
  assert.equal(new Set(paused.map(row => row.phase)).size, 1);
  assert.equal(paused[0].phase, blocked[0].phase);
  assert.ok(rows.some(row => row.step > 22 && row.running === true && row.phase !== paused[0].phase));
  assert.ok(!output.endpoints.some(row => row.platform === f.platformInstanceId && row.step >= 10 && row.step <= 22));
  assert.deepEqual(await authorHashes(f.author), hashes); remember('obstacle-and-author-switch-independent', f, output, hashes);
});

test('real endpoint callback queues a pause for the following step without a repeated endpoint', native, async t => {
  const raw = await scenePhysics2DPlatformControlAuthor(t);
  await probe(raw, { ready: `\tget_meta("viento_platform_events").destination_reached.connect(func():
\t\tassert(control.read_running() == true)
\t\tassert(control.request_running(false))
\t\tassert(control.read_running() == true)
\t)` });
  const f = await captured(raw), hashes = await authorHashes(f.author), output = await execute(f, await stage(f));
  const endpoints = output.endpoints.filter(row => row.platform === f.platformInstanceId);
  assert.deepEqual(endpoints.map(row => row.name), ['destination']);
  const endpointStep = endpoints[0].step, rows = own(f, output), paused = rows.filter(row => row.step > endpointStep);
  assert.ok(paused.length >= 10); assert.ok(paused.every(row => row.phase === 48 && row.running === false));
  assert.deepEqual(await authorHashes(f.author), hashes); remember('endpoint-callback-next-step', f, output, hashes);
});


test('real scene round-trip revokes old ports and gives the new visit its default running state', native, async t => {
  const raw = await scenePhysics2DPlatformControlAuthor(t);
  await probe(raw, { ready: `\tvar host = scene.project_host
\tif host.has_meta("old_control_port"):
\t\tvar old = host.get_meta("old_control_port")
\t\tassert(old.read_running() == null)
\t\tassert(not old.request_running(false))
\t\tprint("CONTROL_NEW_VISIT:",scene.project_visit,":",control.read_running())
\telse:
\t\thost.set_meta("old_control_port", control)
\t\tassert(control.request_running(false))`, step: `\tif scene.project_visit == 1 and ticks == 6:
\t\tassert(control.read_running() == false)
\t\tassert(get_meta("viento_project").request_scene("${raw.sceneIds[1]}"))` });
  await raw.script('second', `extends Node
func _ready() -> void:
\tvar scene = get_parent().get_parent()
\tvar old = scene.project_host.get_meta("old_control_port")
\tassert(old.read_running() == null)
\tassert(not old.request_running(true))
\tprint("CONTROL_OLD_VISIT_REJECTED")
\tassert(get_meta("viento_project").request_scene("${raw.sceneIds[0]}"))
`);
  const f = await captured(raw), hashes = await authorHashes(f.author), output = await execute(f, await stage(f));
  assert.ok(output.result.stdout.includes('CONTROL_OLD_VISIT_REJECTED'));
  assert.ok(output.result.stdout.includes('CONTROL_NEW_VISIT:3:true'));
  const rows = own(f, output), first = rows.filter(row => row.visit === 1 && row.step > 0), returned = rows.filter(row => row.visit === 3);
  assert.ok(first.length >= 4); assert.ok(first.every(row => row.phase === 0 && row.running === false));
  assert.ok(returned.length >= 8); assert.ok(returned.every(row => row.running === true));
  assert.ok(returned.some(row => row.phase > 0));
  assert.deepEqual(await authorHashes(f.author), hashes); remember('scene-roundtrip-revokes-and-resets', f, output, hashes);
});


test('real isolated window capture renders the applied platform pause with valid native observations', {
  ...native, skip: !tool || !process.env.VIENTO_PHYSICS_PLATFORM_CONTROL_CAPTURE ? 'Set Godot and an isolated display with VIENTO_PHYSICS_PLATFORM_CONTROL_CAPTURE' : false,
}, async t => {
  const raw = await scenePhysics2DPlatformControlAuthor(t);
  await probe(raw, { ready: '\tassert(control.request_running(false))', step: `\tif ticks == 8:
\t\tassert(control.request_running(true))
\tif ticks == 16:
\t\tassert(control.request_running(false))` });
  const f = await captured(raw), hashes = await authorHashes(f.author), capturePath = process.env.VIENTO_PHYSICS_PLATFORM_CONTROL_CAPTURE;
  const output = await execute(f, await stage(f), { mode: 'windowCapture', capturePath });
  const paused = own(f, output).filter(row => row.step > 16);
  assert.ok(paused.length >= 10); assert.ok(paused.every(row => row.phase === 32 && row.running === false));
  assert.ok((await fs.stat(capturePath)).size > 100);
  assert.deepEqual(await authorHashes(f.author), hashes); remember('isolated-window-capture', f, output, hashes);
  evidence.at(-1).capture = { sha256: hash(await fs.readFile(capturePath)), bytes: (await fs.stat(capturePath)).size };
});
