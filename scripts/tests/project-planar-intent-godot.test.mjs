import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { scenePhysics2DPlanarContactsAuthor } from './helpers/scene-physics2d-planar-contacts-author-fixture.mjs';
import { captureBuildSnapshot } from '../adapters/node-build-snapshot.mjs';
import { GODOT4_EXECUTION_ADAPTER as adapter } from '../backends/godot4-adapter.mjs';
import { generateGodotPhysicsPlatformControlProject, godotPhysicsPlatformControlAssemblyScripts } from '../backends/godot4-physics-platform-control.mjs';
import { generateGodotPhysicsPlanarIntentProject, godotPhysicsPlanarIntentAssemblyScripts } from '../backends/godot4-physics-planar-intent.mjs';
import { validateGodotPlanarIntentInventory } from '../backends/godot4-physics-planar-intent-inventory.mjs';
import { validateGodotPlatformControlInventory } from '../backends/godot4-physics-platform-control-inventory.mjs';
import { validateGodotPlatformVerticalInventory } from '../backends/godot4-physics-platform-vertical-inventory.mjs';
import { godotPhysicsPlatformEventsAssemblyScripts } from '../backends/godot4-physics-platform-events.mjs';
import { godotAssemblyScripts } from '../backends/godot4-project.mjs';
const tool = process.env.VIENTO_GODOT_BIN;
const native = { skip: tool ? false : 'Set VIENTO_GODOT_BIN for native planar intent verification', timeout: 180000 };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const evidence = [], report = process.env.VIENTO_PLANAR_INTENT_BACKEND_REPORT;
test.after(async () => { if (report) await fs.writeFile(report, JSON.stringify({ format: 'viento-planar-intent-backend-proof', schemaVersion: 1, cases: evidence }, null, 2) + '\n'); });
async function fixture(t, { eligible = true, response = 'slide', script } = {}) {
  const f = await scenePhysics2DPlanarContactsAuthor(t, { response });
  if (eligible) await f.edit('documents/scenes/demo.json', scene => { scene.actors[0].controls = 'none'; });
  if (script) await f.script('motion-input', script);
  const captured = await captureBuildSnapshot(f.author, f.assemblyId); assert.equal(captured.ok, true, JSON.stringify(captured.diagnostics));
  const generated = await generateGodotPhysicsPlanarIntentProject(captured.plan);
  return { ...f, captured, generated };
}
async function stage(f) {
  const directory = await fs.mkdtemp(path.join(f.temporary, 'planar-build-'));
  for (const [name, bytes] of [...f.generated.files, ...[...f.generated.resourceFiles].map(([id, name]) => [name, f.captured.resources.get(id)])]) {
    await fs.mkdir(path.dirname(path.join(directory, name)), { recursive: true }); await fs.writeFile(path.join(directory, name), bytes);
  }
  return directory;
}
async function execute(f, directory, options = {}) {
  const identified = await adapter.identify(tool);
  const imported = await adapter.executePhase({ phase: 'import', directory, tool: identified, timeoutMs: 60000 });
  assert.equal(imported.status, 'succeeded', imported.stdout + imported.stderr);
  assert.deepEqual(adapter.diagnostics(imported, f.captured.plan), [], imported.stdout + imported.stderr);
  await godotPhysicsPlanarIntentAssemblyScripts(directory);
  const output = await adapter.executePhase({ phase: 'run', directory, tool: identified, timeoutMs: 60000, ...options });
  assert.equal(output.status, 'succeeded', output.stdout + output.stderr);
  assert.deepEqual(adapter.diagnostics(output, f.captured.plan), [], output.stdout + output.stderr);
  const reader = adapter.createEventReader(f.captured.plan, { smoke: options.smoke !== false, capabilities: f.generated.backend.capabilities });
  reader.push(output.stdout); assert.deepEqual(reader.finish().diagnostics, [], output.stdout + output.stderr);
  return { output, reader, snapshot: reader.snapshot?.() };
}
const driver = (x = 1, y = .5) => `extends Node
var port
var tick := -1
func _ready() -> void:
\tassert(has_meta("viento_planar_intent"))
\tport = get_meta("viento_planar_intent")
\tassert(port.protocol_version() == 1)
\tassert(port.submit(${x}, ${y}))
func _physics_process(_delta: float) -> void:
\tvar step: int = get_parent().get_parent().physics_observation_step
\tif step == tick:
\t\treturn
\ttick = step
\tport.submit(${x}, ${y})
`;

test('no eligible characters preserve exact historical generated files, metadata and fingerprints', async t => {
  const f = await fixture(t, { eligible: false }), previous = await generateGodotPhysicsPlatformControlProject(f.captured.plan);
  assert.deepEqual([...f.generated.files], [...previous.files]); assert.deepEqual(f.generated.backend, previous.backend);
  assert.deepEqual(f.generated.sourceMap, previous.sourceMap); assert.equal(f.generated.files.has('planar-intent-project.json'), false);
});

test('eligible controls-none planar bodies add only bounded derived chains while all original scripts stay byte exact', async t => {
  const f = await fixture(t), old = await generateGodotPhysicsPlatformControlProject(f.captured.plan), id = f.sceneIds[0];
  assert.equal(f.generated.backend.version, '0.41.0'); assert.ok(f.generated.backend.capabilities.includes('physics.planar-intent2d'));
  for (const [name, bytes] of old.files) if (name !== `scenes/${id}/main.tscn`) assert.deepEqual(f.generated.files.get(name), bytes, name);
  assert.deepEqual(f.generated.files.get(`scenes/${id}/planar-intent-original.tscn.txt`), old.files.get(`scenes/${id}/main.tscn`));
  const directory = await stage(f), scripts = await godotPhysicsPlanarIntentAssemblyScripts(directory);
  assert.ok(scripts.some(name => name.includes('/planar-intent/')));
  assert.deepEqual((await validateGodotPlanarIntentInventory(directory)).sceneIds, [id]);
  assert.ok(await godotAssemblyScripts(directory)); assert.ok(await godotPhysicsPlatformControlAssemblyScripts(directory));
});

test('inventory rejects orphaned, extra, redirected or forged derived chains before every historical main view', async t => {
  const f = await fixture(t), id = f.sceneIds[0], prefix = `scenes/${id}`;
  const chain = [...f.generated.files.keys()].find(name => name.includes('/planar-intent/') && f.generated.files.get(name).includes('planar_intent'));
  const mutations = [
    async dir => fs.rm(path.join(dir, 'planar-intent-project.json')),
    async dir => fs.writeFile(path.join(dir, 'planar-intent-port.gd'), 'extends RefCounted\n'),
    async dir => fs.writeFile(path.join(dir, prefix, 'planar-intent', 'extra.gd'), 'extends Node2D\n'),
    async dir => fs.writeFile(path.join(dir, prefix, 'planar-intent-orphan.gd'), 'extends Node2D\n'),
    async dir => fs.writeFile(path.join(dir, prefix, 'planar-intent-original.tscn.txt'), f.generated.files.get(`${prefix}/planar-intent-original.tscn.txt`).toString().replace('project-scene.gd', 'runtime.gd')),
    async dir => fs.writeFile(path.join(dir, chain), f.generated.files.get(chain).toString().replace('get("planar_intent").take', 'Vector2.ZERO #')),
    async dir => fs.writeFile(path.join(dir, prefix, 'planar-intent-scene.gd'), f.generated.files.get(`${prefix}/planar-intent-scene.gd`).toString().replace(`/scenes/${id}/`, '/scenes/ffffffff-ffff-4fff-8fff-ffffffffffff/')),
    async dir => { await fs.mkdir(path.join(dir, 'scenes', 'ffffffff-ffff-4fff-8fff-ffffffffffff')); await fs.writeFile(path.join(dir, 'scenes', 'ffffffff-ffff-4fff-8fff-ffffffffffff', 'planar-intent-orphan.gd'), 'extends Node2D\n'); },
  ];
  for (const mutate of mutations) {
    const directory = await stage(f); await mutate(directory);
    for (const [inspect, errorCode] of [[validateGodotPlanarIntentInventory, 'build_physics_planar_intent_invalid'],
      [validateGodotPlatformControlInventory, 'build_physics_platform_control_invalid'], [validateGodotPlatformVerticalInventory, 'build_physics_platform_vertical_invalid'],
      [godotPhysicsPlatformEventsAssemblyScripts, 'build_physics_platform_events_invalid'], [godotPhysicsPlatformControlAssemblyScripts, 'build_physics_platform_control_invalid'],
      [godotPhysicsPlanarIntentAssemblyScripts, 'build_physics_planar_intent_invalid'], [godotAssemblyScripts, 'build_physics_planar_intent_invalid']]) {
      await assert.rejects(inspect(directory), { errorCode }, inspect.name);
    }
  }
});

test('an absent new layer preserves historical malformed-assembly error ownership', async t => {
  const f = await fixture(t, { eligible: false }), directory = await stage(f);
  await fs.writeFile(path.join(directory, 'assembly.json'), '{invalid-json');
  assert.equal(await validateGodotPlanarIntentInventory(directory), null);
  await assert.rejects(godotAssemblyScripts(directory), { errorCode: 'build_assembly_invalid' });
});

for (const response of ['stop', 'slide']) test(`real planar ${response} requests use the sole solver and record actual requested motion and contacts`, native, async t => {
  const f = await fixture(t, { response, script: driver(1, .5) }), directory = await stage(f), output = await execute(f, directory);
  const samples = output.snapshot.samples.filter(row => row.instanceId === f.instanceId);
  assert.equal(samples.length, 30); assert.ok(samples.some(row => row.contacts.length));
  const speed = f.captured.plan.scenes[0].actors.find(row => row.instanceId === f.instanceId).speed;
  assert.ok(samples.every(row => Math.abs(row.requestedMotion[0] - speed / 60 / Math.sqrt(1.25)) < 1e-5
    && Math.abs(row.requestedMotion[1] - speed / 120 / Math.sqrt(1.25)) < 1e-5), JSON.stringify({ speed, requests: samples.map(row => row.requestedMotion) }));
  assert.ok(samples.some(row => row.displacement[0] < row.requestedMotion[0] - .01));
  if (response === 'slide') assert.ok(samples.filter(row => row.contacts.length).some(row => row.displacement[1] > .5));
  for (const [name, bytes] of f.generated.files) assert.deepEqual(await fs.readFile(path.join(directory, name)), bytes, name);
  evidence.push({ name: `planar-${response}`, backend: f.generated.backend, samples, outputSha256: hash(output.output.stdout) });
});

async function recaptured(f) {
  const captured = await captureBuildSnapshot(f.author, f.assemblyId); assert.equal(captured.ok, true, JSON.stringify(captured.diagnostics));
  return { ...f, captured, generated: await adapter.generate(captured.plan) };
}
const identity = n => `92929292-9292-4292-8292-${String(n).padStart(12, '0')}`;

test('real mixed gravity and moving-platform project authenticates the complete derived chain before and after editor import', native, async t => {
  let f = await fixture(t, { script: driver(.25, 0) });
  const gravityId = identity(1), gravityBody = identity(2), platformId = identity(3), platformBody = identity(4);
  await f.edit('documents/scenes/demo.json', scene => {
    scene.actors.push({ ...structuredClone(scene.actors[0]), instanceId: gravityId, controls: 'none', position: [400, 100] });
    scene.actors.push({ ...structuredClone(scene.actors[2]), instanceId: platformId, position: [400, 180] });
  });
  await f.edit(f.physicsPath, document => {
    document.schemaVersion = 5;
    document.bodies.push({ ...structuredClone(document.bodies[0]), id: gravityBody, instanceId: gravityId,
      characterMotion: { kind: 'platformer', gravity: 980, jumpSpeed: 120, maxFallSpeed: 1200 } });
    document.bodies.push({ ...structuredClone(document.bodies[2]), id: platformBody, instanceId: platformId,
      platformMotion: { kind: 'horizontal', offsetX: 48, speed: 120 } });
  });
  await f.addBehavior(identity(5), identity(6), 'gravity-port-check', `extends Node
func _ready() -> void:
\tassert(not has_meta("viento_planar_intent"))
\tassert(has_meta("viento_character_intent"))
\tassert(get_meta("viento_character_intent").submit(0.0, false))
`, {}, gravityId);
  f = await recaptured(f);
  const directory = await stage(f), before = await godotPhysicsPlanarIntentAssemblyScripts(directory), output = await execute(f, directory);
  const after = await godotPhysicsPlanarIntentAssemblyScripts(directory); assert.deepEqual(after, before);
  const checked = await adapter.executePhase({ phase: 'script-check', directory, tool: await adapter.identify(tool), timeoutMs: 60000 });
  assert.equal(checked.status, 'succeeded', checked.stdout + checked.stderr);
  assert.deepEqual(adapter.diagnostics(checked, f.captured.plan), [], checked.stdout + checked.stderr);
  const samples = output.snapshot.samples; assert.equal(samples.length, 60);
  assert.ok(samples.filter(row => row.instanceId === f.instanceId).every(row => Math.abs(row.requestedMotion[0] - 1) < 1e-5 && row.requestedMotion[1] === 0));
  assert.ok(samples.filter(row => row.instanceId === gravityId).some(row => row.requestedMotion[1] > 0));
  const chain = [...f.generated.files.keys()].filter(name => name.includes('/planar-intent/'));
  assert.ok(chain.length > 5 && chain.length <= 32);
  const uid = (await fs.readdir(path.join(directory, `scenes/${f.sceneIds[0]}/planar-intent`))).filter(name => name.endsWith('.gd.uid'));
  assert.equal(uid.length, chain.length);
  // A UID is inert companion data only for an authenticated GD, never a new
  // script slot or a reason to accept an unregistered derived dependency.
  const orphan = path.join(directory, `scenes/${f.sceneIds[0]}/planar-intent/orphan.gd.uid`);
  await fs.writeFile(orphan, 'uid://abc123\n'); await assert.rejects(validateGodotPlanarIntentInventory(directory), { errorCode: 'build_physics_planar_intent_invalid' }); await fs.rm(orphan);
  const firstUid = path.join(directory, `scenes/${f.sceneIds[0]}/planar-intent`, uid[0]), originalUid = await fs.readFile(firstUid);
  await fs.writeFile(firstUid, 'res://other.gd\n'); await assert.rejects(validateGodotPlanarIntentInventory(directory), { errorCode: 'build_physics_planar_intent_invalid' });
  await fs.rm(firstUid); await fs.symlink(path.join(directory, 'project.godot'), firstUid); await assert.rejects(validateGodotPlanarIntentInventory(directory), { errorCode: 'build_physics_planar_intent_invalid' });
  await fs.rm(firstUid); await fs.writeFile(firstUid, originalUid);
  await godotPhysicsPlanarIntentAssemblyScripts(directory);
  evidence.push({ name: 'mixed-gravity-platform-import', backend: f.generated.backend, chainScripts: chain.length, importedUidCount: uid.length, samples });
});

test('real contact callback reentry cannot consume the next accepted planar request', native, async t => {
  let f = await fixture(t, { script: driver(1, 0) });
  await f.script('checkpoint', `extends Node
var once := false
var port
func _ready() -> void:
\tport = get_meta("viento_planar_intent")
\tget_meta("viento_character_contacts").started.connect(_contact)
func _contact(_body_id: String, _instance_id: String) -> void:
\tif once:
\t\treturn
\tonce = true
\tvar scene = get_parent().get_parent()
\tassert(port.submit(-0.5, 0.0))
\tvar before: int = scene.physics_observation_step
\tscene.project_step(0.1)
\tassert(scene.physics_observation_step == before)
\tprint("PLANAR_REENTRANT:" + str(before))
`);
  f = await recaptured(f); const output = await execute(f, await stage(f));
  const marker = output.output.stdout.split('\n').find(line => line.startsWith('PLANAR_REENTRANT:')); assert.ok(marker, output.output.stdout);
  const step = Number(marker.slice('PLANAR_REENTRANT:'.length)), rows = output.snapshot.samples.filter(row => row.instanceId === f.instanceId);
  assert.equal(rows.length, 30); assert.ok(step > 0 && step < 30);
  assert.deepEqual(rows[step].requestedMotion, [-2, 0]);
  evidence.push({ name: 'contact-reentrant-next-intent', reentrantStep: step, samples: rows });
});

test('real zero and invalid project steps preserve a ready request for the first actually accepted step', native, async t => {
  const script = driver(.25, -.5).replace('\tassert(port.submit(0.25, -0.5))', `\tassert(port.submit(0.25, -0.5))
\tvar scene = get_parent().get_parent()
\tscene.project_step(0.0)
\tscene.project_step(-0.1)
\tscene.project_step(NAN)
\tassert(scene.physics_observation_step == 0)`);
  const f = await fixture(t, { script }), output = await execute(f, await stage(f)), row = output.snapshot.samples[0];
  assert.equal(output.snapshot.samples.length, 30); assert.deepEqual(row.requestedMotion, [1, -2]);
  evidence.push({ name: 'zero-invalid-delta-retains-ready', sample: row });
});

test('real ready-triggered scene switching still injects later eligible ports and revokes old ports on reentry', native, async t => {
  let f = await fixture(t);
  await f.script('checkpoint', `extends Node
static var prior
static var switched := false
func _ready() -> void:
\tvar port = get_meta("viento_planar_intent")
\tif switched:
\t\tassert(prior != port and not prior.submit(1.0, 0.0))
\t\tprint("PLANAR_REENTER_OK")
\telse:
\t\tswitched = true
\t\tprior = port
\t\tassert(get_meta("viento_project").request_scene("${f.sceneIds[1]}"))
`);
  await f.script('motion-input', `extends Node
var port
func _ready() -> void:
\tassert(has_meta("viento_planar_intent"))
\tport = get_meta("viento_planar_intent")
\tif get_parent().get_parent().project_visit == 1:
\t\tassert(not port.submit(0.25, 0.0))
\t\tprint("PLANAR_QUEUED_READY_OK")
\telse:
\t\tassert(port.submit(0.25, 0.0))
func _physics_process(_delta: float) -> void:
\tport.submit(0.25, 0.0)
`);
  await f.script('second', `extends Node\nfunc _ready() -> void:\n\tassert(get_meta("viento_project").request_scene("${f.sceneIds[0]}"))\n`);
  f = await recaptured(f); const output = await execute(f, await stage(f));
  assert.match(output.output.stdout, /PLANAR_QUEUED_READY_OK/); assert.match(output.output.stdout, /PLANAR_REENTER_OK/);
  const rows = output.snapshot.samples.filter(row => row.instanceId === f.instanceId);
  assert.equal(rows.length, 30); assert.ok(rows.every(row => row.visitIndex === 3));
  evidence.push({ name: 'ready-switch-reentry', visits: [...new Set(rows.map(row => row.visitIndex))], samples: rows });
});

test('real live planar movement uses the same intent consumer without enabling smoke observations', native, async t => {
  const script = `extends Node
var port
var ticks := 0
func _ready() -> void:
\tport = get_meta("viento_planar_intent")
\tassert(port.submit(0.25, 0.0))
func _physics_process(_delta: float) -> void:
\tticks += 1
\tport.submit(0.25, 0.0)
\tif ticks >= 30:
\t\tget_parent().get_parent().project_host.call_deferred("finish_project")
`;
  const f = await fixture(t, { script }), output = await execute(f, await stage(f), { smoke: false });
  const exit = output.reader.events.find(row => row.event === 'scene-exit' && row.sceneId === f.sceneIds[0]);
  const actor = exit.actors.find(row => row.instanceId === f.instanceId);
  assert.ok(actor.position[0] > 105 && actor.position[0] <= 130.2, JSON.stringify(actor));
  assert.equal(output.output.stdout.includes('VIENTO_PHYSICS2D:'), false);
  evidence.push({ name: 'planar-live', actor });
});
