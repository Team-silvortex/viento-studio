import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { scenePhysics2DCharacterEventsAuthor } from './helpers/scene-physics2d-character-events-author-fixture.mjs';
import { scenePhysics2DDropThroughAuthor } from './helpers/scene-physics2d-drop-through-author-fixture.mjs';
import { scenePhysics2DPlatformMotionAuthor } from './helpers/scene-physics2d-platform-motion-author-fixture.mjs';
import { generateGodotAudioRequestsProject } from '../backends/godot4-audio-requests.mjs';
import { captureBuildSnapshot } from '../adapters/node-build-snapshot.mjs';
import { listScriptStarters } from '../../engine/script-authoring.mjs';
import { GODOT4_EXECUTION_ADAPTER as adapter } from '../backends/godot4-adapter.mjs';
import { runBuildProcess } from '../lib/build-process.mjs';

const executable = process.env.VIENTO_GODOT_BIN;
const real = { skip: !executable ? 'Set VIENTO_GODOT_BIN for native Godot intent tests' : false, timeout: 180000 };
const id = n => `92929292-9292-4292-8292-${String(n).padStart(12, '0')}`;
async function setup(t, { arrows = false, extra = false, drop = false, platform = false, driverSource, probeSource = 'extends Node\n', parameters = {}, otherSource = 'extends Node\n', otherParameters = {} } = {}) {
  const f = platform ? await scenePhysics2DPlatformMotionAuthor(t, { consumers: false })
    : drop ? await scenePhysics2DDropThroughAuthor(t, { consumers: false, drop: false })
    : await scenePhysics2DCharacterEventsAuthor(t, { jump: false, controls: 'none' });
  if (drop || platform) await f.edit('documents/scenes/demo.json', scene => { scene.actors[0].controls = 'none'; scene.actors[0].speed = 240; });
  await f.script('checkpoint', 'extends Node\n');
  if (driverSource) await f.script('motion-input', driverSource);
  const a = id(1), b = id(2), c = id(3), d = id(4), other = id(5), otherBody = id(6);
  await f.addBehavior(a, b, 'intent-first', probeSource, parameters);
  await f.addBehavior(c, d, 'intent-second', 'extends Node\n');
  if (extra || arrows) {
    await f.edit('documents/scenes/demo.json', scene => {
      scene.actors.push({ ...structuredClone(scene.actors[0]), instanceId: other, position: [300, 178], controls: arrows ? 'arrows' : 'none' });
    });
    await f.edit(f.physicsPath, document => { document.bodies.push({ ...structuredClone(document.bodies[0]), id: otherBody, instanceId: other }); });
    await f.addBehavior(id(7), id(8), 'intent-other', otherSource, otherParameters, other);
  }
  const captured = await captureBuildSnapshot(f.author, f.assemblyId);
  assert.equal(captured.ok, true, JSON.stringify(captured.diagnostics));
  const generated = await adapter.generate(captured.plan);
  const directory = await fs.mkdtemp(path.join(f.temporary, 'intent-stage-'));
  for (const [name, bytes] of [...generated.files, ...[...generated.resourceFiles].map(([resource, name]) => [name, captured.resources.get(resource)])]) {
    await fs.mkdir(path.dirname(path.join(directory, name)), { recursive: true });
    await fs.writeFile(path.join(directory, name), bytes);
  }
  const identified = await adapter.identify(executable);
  for (const phase of adapter.runtimePhases) {
    const result = await adapter.executePhase({ phase, directory, tool: identified, timeoutMs: 60000 });
    assert.equal(result.status, 'succeeded', result.stdout + result.stderr);
    assert.deepEqual(adapter.diagnostics(result, captured.plan), [], result.stdout + result.stderr);
  }
  return { ...f, captured, generated, directory, identified, first: b, second: d, otherBinding: id(8), other };
}
const probeScript = (f, body, prelude = '') => `extends SceneTree
func _initialize() -> void:
\tcall_deferred("probe")
func probe() -> void:
${prelude}
\tvar project = load("res://project.tscn").instantiate()
\troot.add_child(project)
\tproject.set_physics_process(false)
\tvar scene = project.current
\tvar a = scene.find_child("behavior_${f.first.replaceAll('-', '_')}", true, false)
\tvar b = scene.find_child("behavior_${f.second.replaceAll('-', '_')}", true, false)
\tvar pa = a.get_meta("viento_character_intent") if a.has_meta("viento_character_intent") else null
\tvar pb = b.get_meta("viento_character_intent") if b.has_meta("viento_character_intent") else null
\tawait physics_frame
\tawait process_frame
${body}
\tproject.free()
\tquit()
`;
async function probe(f, body, { prelude = '', expectErrors = [] } = {}) {
  await fs.writeFile(path.join(f.directory, 'intent-probe.gd'), probeScript(f, body, prelude), { flag: 'wx' });
  const result = await runBuildProcess(executable, ['--headless', '--path', f.directory, '--script', 'res://intent-probe.gd'], {
    cwd: f.directory, timeoutMs: 60000, env: { ...process.env, GODOT_SILENCE_ROOT_WARNING: '1', XDG_DATA_HOME: path.join(f.directory, '.host/data'), XDG_CONFIG_HOME: path.join(f.directory, '.host/config'), XDG_CACHE_HOME: path.join(f.directory, '.host/cache') }
  });
  assert.equal(result.status, 'succeeded', result.stdout + result.stderr);
  const output = result.stdout + result.stderr;
  assert.equal(/SCRIPT ERROR/.test(output), false, output);
  if (expectErrors.length) {
    const errors = output.split('\n').filter(line => line.includes('ERROR:'));
    assert.equal(errors.length, expectErrors.length, output);
    for (const expected of expectErrors) assert.ok(errors.some(line => line.includes(expected)), output);
  } else assert.equal(/ERROR:/.test(output), false, output);
  const line = result.stdout.split('\n').find(row => row.startsWith('INTENT_PROBE:'));
  assert.ok(line, result.stdout + result.stderr);
  return JSON.parse(line.slice('INTENT_PROBE:'.length));
}

test('real Godot: intent is bounded, first valid submit wins, one step only and is instance-local', real, async t => {
  const f = await setup(t, { arrows: true });
  const out = await probe(f, `\tvar other = scene.find_child("behavior_${f.otherBinding.replaceAll('-', '_')}", true, false)
\tvar actor = scene.actors[0]["node"]
\tvar invalid = [pa.submit("1", false), pa.submit(true, false), pa.submit(2.0, false), pa.submit(NAN, false), pa.submit(INF, false), pa.submit(0.5, 1)]
\tvar accepted = pa.submit(1.0, false)
\tvar conflict = pb.submit(-1.0, false)
\tvar x0: float = actor.position.x
\tscene.project_step(1.0 / 60.0)
\tvar x1: float = actor.position.x
\tvar next_accepted = pb.submit(-1.0, false)
\tscene.project_step(1.0 / 60.0)
\tvar x2: float = actor.position.x
\tscene.project_step(1.0 / 60.0)
\tvar x3: float = actor.position.x
\tprint("INTENT_PROBE:" + JSON.stringify({"version": pa.protocol_version(), "arrowsHasPort": other.has_meta("viento_character_intent"), "invalid": invalid, "accepted": accepted, "conflict": conflict, "nextAccepted": next_accepted, "deltas": [x1-x0,x2-x1,x3-x2]}))`);
  assert.equal(out.version, 1); assert.equal(out.arrowsHasPort, false);
  assert.deepEqual(out.invalid, [false, false, false, false, false, false]);
  assert.equal(out.accepted, true); assert.equal(out.conflict, false); assert.equal(out.nextAccepted, true);
  assert.ok(out.deltas[0] > 3.9 && out.deltas[0] < 4.1, JSON.stringify(out));
  assert.ok(out.deltas[1] < -3.9 && out.deltas[1] > -4.1, JSON.stringify(out));
  assert.ok(Math.abs(out.deltas[2]) < 0.001, JSON.stringify(out));
});

test('real Godot: paused submissions fail, pending is consumed after resume, and destroyed owner cannot move', real, async t => {
  const f = await setup(t);
  const out = await probe(f, `\tvar actor = scene.actors[0]["node"]
\tvar accepted = pa.submit(1.0, false)
\tpaused = true
\tvar pausedAttempt = pb.submit(-1.0, false)
\tvar x0: float = actor.position.x
\tpaused = false
\tscene.project_step(1.0 / 60.0)
\tvar x1: float = actor.position.x
\tpaused = true
\tvar pausedEmpty = pb.submit(-1.0, false)
\tpaused = false
\tvar beforeFree = pa.submit(1.0, false)
\ta.free()
\tvar afterFree = pa.submit(-1.0, false)
\tscene.project_step(1.0 / 60.0)
\tvar x2: float = actor.position.x
\tvar recovered = pb.submit(-1.0, false)
\tscene.project_step(1.0 / 60.0)
\tvar x3: float = actor.position.x
\tprint("INTENT_PROBE:" + JSON.stringify({"accepted":accepted,"pausedAttempt":pausedAttempt,"pausedEmpty":pausedEmpty,"beforeFree":beforeFree,"afterFree":afterFree,"recovered":recovered,"deltas":[x1-x0,x2-x1,x3-x2]}))`);
  assert.equal(out.accepted, true); assert.equal(out.pausedAttempt, false); assert.equal(out.pausedEmpty, false); assert.equal(out.beforeFree, true);
  assert.equal(out.afterFree, false); assert.equal(out.recovered, true);
  assert.ok(out.deltas[0] > 3.9 && out.deltas[0] < 4.1, JSON.stringify(out));
  assert.ok(Math.abs(out.deltas[1]) < 0.001, JSON.stringify(out));
  assert.ok(out.deltas[2] < -3.9 && out.deltas[2] > -4.1, JSON.stringify(out));
});

test('real Godot: grounded jumping is one-shot and air requests cannot be buffered', real, async t => {
  const f = await setup(t);
  const out = await probe(f, `\tfor i in range(15):
\t\tscene.project_step(1.0 / 60.0)
\t\tawait physics_frame
\tvar groundedBefore: bool = scene.character_motion_grounded["${f.instanceId}"]
\tvar jump = pa.submit(0.0, true)
\tscene.project_step(1.0 / 60.0)
\tvar launch: float = scene.character_motion_velocities["${f.instanceId}"].y
\tvar air = pa.submit(0.0, true)
\tscene.project_step(1.0 / 60.0)
\tvar afterAir: float = scene.character_motion_velocities["${f.instanceId}"].y
\tfor i in range(45):
\t\tscene.project_step(1.0 / 60.0)
\t\tawait physics_frame
\tvar groundedAfter: bool = scene.character_motion_grounded["${f.instanceId}"]
\tvar settled: float = scene.character_motion_velocities["${f.instanceId}"].y
\tprint("INTENT_PROBE:" + JSON.stringify({"groundedBefore":groundedBefore,"jump":jump,"launch":launch,"air":air,"afterAir":afterAir,"groundedAfter":groundedAfter,"settled":settled}))`);
  assert.equal(out.groundedBefore, true); assert.equal(out.jump, true); assert.ok(out.launch < -100, JSON.stringify(out));
  assert.equal(out.air, true); assert.ok(out.afterAir > out.launch, JSON.stringify(out));
  assert.equal(out.groundedAfter, true); assert.ok(Math.abs(out.settled) < 0.1, JSON.stringify(out));
});

test('real Godot: stale intent capability is revoked across a new visit', real, async t => {
  const f = await setup(t);
  const out = await probe(f, `\tvar accepted = pa.submit(1.0, false)
\tproject.leave_scene("switch", "${f.sceneIds[0]}")
\tvar stale = pa.submit(1.0, false)
\tproject.enter_scene("${f.sceneIds[0]}")
\tproject.set_physics_process(false)
\tvar next = project.current
\tvar freshBehavior = next.find_child("behavior_${f.first.replaceAll('-', '_')}", true, false)
\tvar fresh = freshBehavior.get_meta("viento_character_intent")
\tvar x0: float = next.actors[0]["node"].position.x
\tnext.project_step(1.0 / 60.0)
\tvar x1: float = next.actors[0]["node"].position.x
\tvar canSubmit = fresh.submit(-1.0, false)
\tnext.project_step(1.0 / 60.0)
\tvar x2: float = next.actors[0]["node"].position.x
\tprint("INTENT_PROBE:" + JSON.stringify({"accepted":accepted,"stale":stale,"different":pa != fresh,"fresh":canSubmit,"deltas":[x1-x0,x2-x1]}))`);
  assert.equal(out.accepted, true); assert.equal(out.stale, false); assert.equal(out.different, true); assert.equal(out.fresh, true);
  assert.ok(Math.abs(out.deltas[0]) < 0.001, JSON.stringify(out));
  assert.ok(out.deltas[1] < -3.9 && out.deltas[1] > -4.1, JSON.stringify(out));
});

test('real Godot: author behavior drives the normal finite project smoke workflow', real, async t => {
  const source = `extends Node
var last_step := -1
var port
func _ready() -> void:
\tport = get_meta("viento_character_intent")
func _physics_process(_delta: float) -> void:
\tvar step: int = get_parent().get_parent().get("physics_observation_step")
\tif step == last_step:
\t\treturn
\tlast_step = step
\tif step >= 5 and step < 10:
\t\tprint("INTENT_AUTHOR:" + JSON.stringify({"step":step,"accepted":port.submit(1.0, step == 6)}))
`;
  const f = await setup(t, { probeSource: source });
  const identified = f.identified;
  const result = await adapter.executePhase({ phase: 'run', directory: f.directory, tool: identified, smoke: true, mode: 'headlessLogic', timeoutMs: 60000 });
  assert.equal(result.status, 'succeeded', result.stdout + result.stderr);
  assert.deepEqual(adapter.diagnostics(result, f.captured.plan), [], result.stdout + result.stderr);
  const reader = adapter.createEventReader(f.captured.plan, { smoke: true, capabilities: f.generated.backend.capabilities });
  reader.push(result.stdout); const ended = reader.finish();
  assert.deepEqual(ended.diagnostics, [], result.stdout);
  const samples = reader.snapshot().samples.filter(sample => sample.instanceId === f.instanceId);
  const writes = result.stdout.split('\n').filter(row => row.startsWith('INTENT_AUTHOR:')).map(row => JSON.parse(row.slice('INTENT_AUTHOR:'.length)));
  assert.equal(samples.length, 30); assert.ok(writes.length >= 3, result.stdout);
  assert.ok(writes.every(row => row.accepted), JSON.stringify(writes));
  assert.ok(samples.some(row => row.requestedMotion[0] > 1), JSON.stringify(samples));
  assert.ok(samples.some(row => row.requestedMotion[1] < 0), JSON.stringify(samples));
});

test('real Godot: intent also moves a character in the normal live physics loop', real, async t => {
  const source = `extends Node
var tick := 0
var port
func _ready() -> void:
\tport = get_meta("viento_character_intent")
func _physics_process(_delta: float) -> void:
\ttick += 1
\tif tick <= 6:
\t\tprint("INTENT_LIVE:" + JSON.stringify({"tick":tick,"accepted":port.submit(1.0, false)}))
\tif tick == 20:
\t\tget_tree().root.get_node("VientoProject").call_deferred("finish_project")
`;
  const f = await setup(t, { probeSource: source });
  const identified = f.identified;
  const result = await adapter.executePhase({ phase: 'run', directory: f.directory, tool: identified, smoke: false, mode: 'headlessLogic', timeoutMs: 60000 });
  assert.equal(result.status, 'succeeded', result.stdout + result.stderr);
  assert.deepEqual(adapter.diagnostics(result, f.captured.plan), [], result.stdout + result.stderr);
  const reader = adapter.createEventReader(f.captured.plan, { smoke: false, capabilities: f.generated.backend.capabilities });
  reader.push(result.stdout); assert.deepEqual(reader.finish().diagnostics, [], result.stdout);
  const writes = result.stdout.split('\n').filter(row => row.startsWith('INTENT_LIVE:')).map(row => JSON.parse(row.slice('INTENT_LIVE:'.length)));
  const exit = reader.events.find(row => row.event === 'scene-exit');
  assert.equal(writes.length, 6, result.stdout); assert.ok(writes.every(row => row.accepted), JSON.stringify(writes));
  assert.ok(exit, result.stdout);
  const actor = exit.actors.find(row => row.instanceId === f.instanceId);
  assert.ok(actor && actor.position[0] > 110, JSON.stringify(exit));
});

test('real Godot: intent submitted by landed callback cannot alter the current movement step', real, async t => {
  const source = `extends Node
var intent
func _ready() -> void:
\tintent = get_meta("viento_character_intent")
\tget_meta("viento_character_motion").landed.connect(_landed)
func _landed() -> void:
\tprint("INTENT_CALLBACK:" + JSON.stringify({"accepted":intent.submit(1.0, false)}))
`;
  const f = await setup(t, { probeSource: source });
  const out = await probe(f, `\tvar actor = scene.actors[0]["node"]
\tvar start: float = actor.position.x
\tfor i in range(15):
\t\tscene.project_step(1.0 / 60.0)
\t\tif scene.character_motion_grounded["${f.instanceId}"]:
\t\t\tbreak
\t\tawait physics_frame
\tvar landingX: float = actor.position.x
\tscene.project_step(1.0 / 60.0)
\tvar nextX: float = actor.position.x
\tprint("INTENT_PROBE:" + JSON.stringify({"during":landingX-start,"next":nextX-landingX}))`);
  assert.ok(Math.abs(out.during) < 0.001, JSON.stringify(out));
  assert.ok(out.next > 3.9 && out.next < 4.1, JSON.stringify(out));
});

test('real Godot: drop-through removes support before an intent jump is considered', real, async t => {
  const f = await setup(t, { drop: true });
  const out = await probe(f, `\tvar dropBehavior = scene.find_child("behavior_${f.dropBindingId.replaceAll('-', '_')}", true, false)
\tvar drop = dropBehavior.get_meta("viento_character_drop")
\tfor i in range(15):
\t\tscene.project_step(1.0 / 60.0)
\t\tawait physics_frame
\tvar grounded: bool = scene.character_motion_grounded["${f.instanceId}"]
\tvar dropAccepted = drop.request_drop()
\tvar jumpAccepted = pa.submit(0.0, true)
\tscene.project_step(1.0 / 60.0)
\tvar velocity: float = scene.character_motion_velocities["${f.instanceId}"].y
\tvar afterGrounded: bool = scene.character_motion_grounded["${f.instanceId}"]
\tprint("INTENT_PROBE:" + JSON.stringify({"grounded":grounded,"drop":dropAccepted,"jump":jumpAccepted,"velocity":velocity,"afterGrounded":afterGrounded}))`);
  assert.equal(out.grounded, true); assert.equal(out.drop, true); assert.equal(out.jump, true);
  assert.ok(out.velocity > 0, JSON.stringify(out)); assert.equal(out.afterGrounded, false);
});

test('ineligible arrows-only projects retain the previous generated backend and every file byte', async t => {
  const f = await scenePhysics2DCharacterEventsAuthor(t, { jump: false, controls: 'arrows' });
  const captured = await captureBuildSnapshot(f.author, f.assemblyId);
  assert.equal(captured.ok, true, JSON.stringify(captured.diagnostics));
  const previous = await generateGodotAudioRequestsProject(captured.plan);
  const generated = await adapter.generate(captured.plan);
  assert.deepEqual(generated.backend, previous.backend);
  assert.deepEqual([...generated.files.keys()], [...previous.files.keys()]);
  for (const [name, bytes] of previous.files) assert.deepEqual(generated.files.get(name), bytes, name);
});

test('real Godot: the built-in author starter drives movement and a jump using normal inputs', real, async t => {
  const starter = listScriptStarters().find(item => item.id === 'godot-character-intent');
  assert.ok(starter);
  const driverSource = `extends Node
var last_step := -1
func _physics_process(_delta: float) -> void:
\tvar step: int = get_parent().get_parent().get("physics_observation_step")
\tif step == last_step:
\t\treturn
\tlast_step = step
\tif step == 6:
\t\tInput.action_press("ui_accept")
\tif step == 7:
\t\tInput.action_release("ui_accept")
func _exit_tree() -> void:
\tInput.action_release("ui_accept")
`;
  const f = await setup(t, { probeSource: starter.content, driverSource });
  const result = await adapter.executePhase({ phase: 'run', directory: f.directory, tool: f.identified, smoke: true, mode: 'headlessLogic', timeoutMs: 60000 });
  assert.equal(result.status, 'succeeded', result.stdout + result.stderr);
  assert.deepEqual(adapter.diagnostics(result, f.captured.plan), [], result.stdout + result.stderr);
  const reader = adapter.createEventReader(f.captured.plan, { smoke: true, capabilities: f.generated.backend.capabilities });
  reader.push(result.stdout); assert.deepEqual(reader.finish().diagnostics, [], result.stdout);
  const samples = reader.snapshot().samples.filter(sample => sample.instanceId === f.instanceId);
  assert.equal(samples.length, 30);
  assert.ok(samples.some(row => row.requestedMotion[0] > 1), JSON.stringify(samples));
  assert.ok(samples.some(row => row.requestedMotion[1] < 0), JSON.stringify(samples));
  const publications = reader.projectEvents.entries.filter(row => row.origin.bindingId === f.publisherBindingId);
  assert.ok(publications.some(row => row.name === 'physics.jumped'), JSON.stringify(publications));
});

test('real Godot: a queued-for-deletion owner releases its pending slot before the next step', real, async t => {
  const f = await setup(t);
  const out = await probe(f, `\tvar actor = scene.actors[0]["node"]
\tvar first = pa.submit(1.0, false)
\ta.queue_free()
\tvar deadOwner = pa.submit(1.0, false)
\tvar replacement = pb.submit(-1.0, false)
\tvar x0: float = actor.position.x
\tscene.project_step(1.0 / 60.0)
\tvar x1: float = actor.position.x
\tprint("INTENT_PROBE:" + JSON.stringify({"first":first,"deadOwner":deadOwner,"replacement":replacement,"delta":x1-x0}))`);
  assert.equal(out.first, true); assert.equal(out.deadOwner, false); assert.equal(out.replacement, true);
  assert.ok(out.delta < -3.9 && out.delta > -4.1, JSON.stringify(out));
});

test('real Godot: two controlled instances accept and consume distinct intents in the same step', real, async t => {
  const f = await setup(t, { extra: true });
  const out = await probe(f, `\tvar other = scene.find_child("behavior_${f.otherBinding.replaceAll('-', '_')}", true, false)
\tvar otherPort = other.get_meta("viento_character_intent")
\tvar firstActor = scene.actors[0]["node"]
\tvar secondActor = scene.actors.back()["node"]
\tvar first = pa.submit(1.0, false)
\tvar second = otherPort.submit(-0.5, false)
\tvar x0: float = firstActor.position.x
\tvar x1: float = secondActor.position.x
\tscene.project_step(1.0 / 60.0)
\tprint("INTENT_PROBE:" + JSON.stringify({"first":first,"second":second,"deltas":[firstActor.position.x-x0,secondActor.position.x-x1]}))`);
  assert.equal(out.first, true); assert.equal(out.second, true);
  assert.ok(out.deltas[0] > 3.9 && out.deltas[0] < 4.1, JSON.stringify(out));
  assert.ok(out.deltas[1] < -1.9 && out.deltas[1] > -2.1, JSON.stringify(out));
});

test('real Godot: input intent composes with one-way moving platform carry', real, async t => {
  const source = `extends Node
var last_step := -1
var port
func _ready() -> void:
\tport = get_meta("viento_character_intent")
func _physics_process(_delta: float) -> void:
\tvar step: int = get_parent().get_parent().get("physics_observation_step")
\tif step == last_step:
\t\treturn
\tlast_step = step
\tif step >= 5 and step < 10:
\t\tprint("INTENT_PLATFORM:" + JSON.stringify({"step":step,"accepted":port.submit(1.0, false)}))
`;
  const f = await setup(t, { platform: true, probeSource: source });
  const result = await adapter.executePhase({ phase: 'run', directory: f.directory, tool: f.identified, smoke: true, mode: 'headlessLogic', timeoutMs: 60000 });
  assert.equal(result.status, 'succeeded', result.stdout + result.stderr);
  assert.deepEqual(adapter.diagnostics(result, f.captured.plan), [], result.stdout + result.stderr);
  const reader = adapter.createEventReader(f.captured.plan, { smoke: true, capabilities: f.generated.backend.capabilities });
  reader.push(result.stdout); assert.deepEqual(reader.finish().diagnostics, [], result.stdout);
  const samples = reader.snapshot().samples.filter(sample => sample.instanceId === f.instanceId);
  const writes = result.stdout.split('\n').filter(row => row.startsWith('INTENT_PLATFORM:')).map(row => JSON.parse(row.slice('INTENT_PLATFORM:'.length)));
  assert.equal(samples.length, 30); assert.ok(writes.length >= 3 && writes.every(row => row.accepted), JSON.stringify(writes));
  assert.ok(samples.some(row => row.requestedMotion[0] > 7.9 && row.contacts.some(contact => contact.collider?.bodyId === f.platformBodyId)), JSON.stringify(samples));
  assert.ok(samples.some(row => row.requestedMotion[0] < -3.9), JSON.stringify(samples));
});

test('real Godot: behavior parameters isolate two characters using default and custom registered actions', real, async t => {
  const starter = listScriptStarters().find(item => item.id === 'godot-character-intent');
  const custom = { left_action: 'p2_left', right_action: 'p2_right', jump_action: 'p2_jump' };
  const f = await setup(t, { extra: true, probeSource: starter.content, otherSource: starter.content, otherParameters: custom });
  const out = await probe(f, `\tvar other = scene.find_child("behavior_${f.otherBinding.replaceAll('-', '_')}", true, false)
\tvar first_body = scene.actors.filter(func(actor): return actor["instanceId"] == "${f.instanceId}")[0]["node"]
\tvar other_body = scene.actors.filter(func(actor): return actor["instanceId"] == "${f.other}")[0]["node"]
\ta.set_physics_process(false)
\tother.set_physics_process(false)
\tscene.project_step(1.0 / 60.0)
\tvar first0: float = first_body.position.x
\tvar other0: float = other_body.position.x
\tInput.action_press("ui_right")
\tInput.action_press("p2_left")
\ta._physics_process(0.016)
\tother._physics_process(0.016)
\tscene.project_step(1.0 / 60.0)
\tvar first1: float = first_body.position.x
\tvar other1: float = other_body.position.x
\tInput.action_release("ui_right")
\tInput.action_release("p2_left")
\tInput.action_press("ui_left")
\tInput.action_press("p2_right")
\ta._physics_process(0.016)
\tother._physics_process(0.016)
\tscene.project_step(1.0 / 60.0)
\tvar first2: float = first_body.position.x
\tvar other2: float = other_body.position.x
\tInput.action_release("ui_left")
\tInput.action_release("p2_right")
\tfor i in range(15):
\t\tscene.project_step(1.0 / 60.0)
\t\tawait physics_frame
\tvar grounded = [scene.character_motion_grounded["${f.instanceId}"], scene.character_motion_grounded["${f.other}"]]
\tInput.action_press("p2_jump")
\ta._physics_process(0.016)
\tother._physics_process(0.016)
\tscene.project_step(1.0 / 60.0)
\tvar velocities = [scene.character_motion_velocities["${f.instanceId}"].y, scene.character_motion_velocities["${f.other}"].y]
\tInput.action_release("p2_jump")
\tprint("INTENT_PROBE:" + JSON.stringify({"firstActions":[a.left_action,a.right_action,a.jump_action],"otherActions":[other.left_action,other.right_action,other.jump_action],"moves":[first1-first0,other1-other0,first2-first1,other2-other1],"grounded":grounded,"velocities":velocities}))`, {
    prelude: '\tfor action in ["p2_left", "p2_right", "p2_jump"]:\n\t\tInputMap.add_action(action)',
  });
  assert.deepEqual(out.firstActions, ['ui_left', 'ui_right', 'ui_accept']);
  assert.deepEqual(out.otherActions, Object.values(custom));
  assert.ok(out.moves[0] > 3.9 && out.moves[0] < 4.1, JSON.stringify(out));
  assert.ok(out.moves[1] < -3.9 && out.moves[1] > -4.1, JSON.stringify(out));
  assert.ok(out.moves[2] < -3.9 && out.moves[2] > -4.1, JSON.stringify(out));
  assert.ok(out.moves[3] > 3.9 && out.moves[3] < 4.1, JSON.stringify(out));
  assert.deepEqual(out.grounded, [true, true]);
  assert.ok(Math.abs(out.velocities[0]) < 0.1 && out.velocities[1] < -100, JSON.stringify(out));
});

for (const [label, parameters] of [
  ['empty', { left_action: '' }],
  ['unregistered', { jump_action: 'no_such_viento_action' }],
]) test(`real Godot: ${label} behavior action disables only that character`, real, async t => {
  const starter = listScriptStarters().find(item => item.id === 'godot-character-intent');
  const f = await setup(t, { extra: true, probeSource: starter.content, parameters, otherSource: starter.content });
  const out = await probe(f, `\tvar other = scene.find_child("behavior_${f.otherBinding.replaceAll('-', '_')}", true, false)
\tvar first_body = scene.actors.filter(func(actor): return actor["instanceId"] == "${f.instanceId}")[0]["node"]
\tvar other_body = scene.actors.filter(func(actor): return actor["instanceId"] == "${f.other}")[0]["node"]
\tvar enabled = [a.is_physics_processing(), other.is_physics_processing()]
\tother.set_physics_process(false)
\tscene.project_step(1.0 / 60.0)
\tvar first0: float = first_body.position.x
\tvar other0: float = other_body.position.x
\tInput.action_press("ui_right")
\tother._physics_process(0.016)
\tscene.project_step(1.0 / 60.0)
\tInput.action_release("ui_right")
\tprint("INTENT_PROBE:" + JSON.stringify({"enabled":enabled,"deltas":[first_body.position.x-first0,other_body.position.x-other0]}))`, {
    expectErrors: ['Character intent:'],
  });
  assert.deepEqual(out.enabled, [false, true]);
  assert.ok(Math.abs(out.deltas[0]) < 0.001, JSON.stringify(out));
  assert.ok(out.deltas[1] > 3.9 && out.deltas[1] < 4.1, JSON.stringify(out));
});

test('real Godot: removing a registered action while running disables only its owner', real, async t => {
  const starter = listScriptStarters().find(item => item.id === 'godot-character-intent');
  const custom = { left_action: 'p2_left', right_action: 'p2_right', jump_action: 'p2_jump' };
  const f = await setup(t, { extra: true, probeSource: starter.content, otherSource: starter.content, otherParameters: custom });
  const out = await probe(f, `\tvar other = scene.find_child("behavior_${f.otherBinding.replaceAll('-', '_')}", true, false)
\tvar first_body = scene.actors.filter(func(actor): return actor["instanceId"] == "${f.instanceId}")[0]["node"]
\tvar before = [a.is_physics_processing(), other.is_physics_processing()]
\ta.set_physics_process(false)
\tInputMap.erase_action("p2_right")
\tother._physics_process(0.016)
\tvar other_enabled = other.is_physics_processing()
\tscene.project_step(1.0 / 60.0)
\tvar first0: float = first_body.position.x
\tInput.action_press("ui_right")
\ta._physics_process(0.016)
\tscene.project_step(1.0 / 60.0)
\tInput.action_release("ui_right")
\tprint("INTENT_PROBE:" + JSON.stringify({"before":before,"otherEnabled":other_enabled,"delta":first_body.position.x-first0}))`, {
    prelude: '\tfor action in ["p2_left", "p2_right", "p2_jump"]:\n\t\tInputMap.add_action(action)',
    expectErrors: ['Character intent:'],
  });
  assert.deepEqual(out.before, [true, true]);
  assert.equal(out.otherEnabled, false);
  assert.ok(out.delta > 3.9 && out.delta < 4.1, JSON.stringify(out));
});
