import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import yauzl from 'yauzl';
import { scenePhysics2DCharacterEventsAuthor } from './helpers/scene-physics2d-character-events-author-fixture.mjs';
import { scenePhysics2DCharacterMotionAuthor } from './helpers/scene-physics2d-character-motion-author-fixture.mjs';
import { scenePhysics2DAuthor } from './helpers/scene-physics2d-author-fixture.mjs';
import { projectAnimationClipsAuthor } from './helpers/project-animation-clips-author-fixture.mjs';
import { captureBuildSnapshot } from '../adapters/node-build-snapshot.mjs';
import { createExecutionBackendRegistry } from '../adapters/node-execution-backends.mjs';
import { buildProject } from '../adapters/node-project-build.mjs';
import { GODOT4_EXECUTION_ADAPTER as adapter } from '../backends/godot4-adapter.mjs';
import { generateGodotPhysicsObservationProject } from '../backends/godot4-physics-observation.mjs';
import { generateGodotPhysicsCharacterEventsProject, godotPhysicsCharacterEventsAssemblyScripts } from '../backends/godot4-physics-character-events.mjs';
import { generateGodotPhysicsCharacterMotionProject } from '../backends/godot4-physics-character-motion.mjs';
import { inspectBackendProject } from '../adapters/node-backend-project.mjs';
import { planBackendProjectDelivery, verifyBackendProjectDelivery } from '../adapters/node-backend-project-delivery.mjs';
import { runBuildProcess } from '../lib/build-process.mjs';
import { writeExportZip } from '../lib/export-package.mjs';

const tool = process.env.VIENTO_GODOT_BIN;
const real = { skip: !tool ? 'Set VIENTO_GODOT_BIN for native observation verification' : false, timeout: 180000 };
const capturePath = process.env.VIENTO_PHYSICS_EVENTS_CAPTURE;
const reportPath = process.env.VIENTO_PHYSICS_EVENTS_REPORT;
const evidence = [];
const hash = value => createHash('sha256').update(value).digest('hex');
const id = n => `71717171-7171-4171-8171-${String(n).padStart(12, '0')}`;
test.after(async () => { if (reportPath) await fs.writeFile(reportPath, JSON.stringify({ format: 'viento-physics-character-events-proof', schemaVersion: 1, tool, cases: evidence }, null, 2) + '\n', { flag: 'wx' }); });
async function hashes(directory, prefix = '') {
  const result = {};
  for (const item of await fs.readdir(path.join(directory, prefix), { withFileTypes: true })) {
    const name = prefix ? `${prefix}/${item.name}` : item.name;
    if (item.isDirectory()) Object.assign(result, await hashes(directory, name));
    else { assert.ok(item.isFile()); result[name] = hash(await fs.readFile(path.join(directory, name))); }
  }
  return result;
}
// Preserve this historical generator's output and delivery through one registry.
const frozenEventsAdapter = { ...adapter, async generate(plan) {
  const generated = await generateGodotPhysicsCharacterEventsProject(plan);
  return { ...generated, resourceFiles: new Map(generated.resourceFiles || generated.imageFiles), artifact: { kind: 'godot-project', entry: 'project.godot', requiresTool: true } };
} };
const frozenRegistry = () => createExecutionBackendRegistry([frozenEventsAdapter]);
async function captured(f) {
  const captured = await captureBuildSnapshot(f.author, f.assemblyId);
  assert.equal(captured.ok, true, JSON.stringify(captured.diagnostics));
  return { ...f, captured, generated: await frozenEventsAdapter.generate(captured.plan) };
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


async function abnormalExitProbe(f, directory, identified) {
  const script = `extends SceneTree
func _initialize() -> void:
\tcall_deferred("_probe")
func _probe() -> void:
\tvar project = load("res://project.tscn").instantiate()
\troot.add_child(project)
\tproject.set_physics_process(false)
\tvar scene = project.current
\tvar behavior = scene.find_child("behavior_${f.publisherBindingId.replaceAll('-', '_')}", true, false)
\tvar port = behavior.get_meta("viento_character_motion")
\tport.jumped.connect(_probe_listener)
\tport.landed.connect(_probe_listener)
\tvar player = scene.audio_players["${f.trackId}"]
\tplayer.play()
\tproject.remove_child(scene)
\tprint("EVENT_ABNORMAL_EXIT:" + JSON.stringify({"audioStopped": not player.playing, "audioFinished": scene.audio_finished, "jumpedConnections": port.get_signal_connection_list("jumped").size(), "landedConnections": port.get_signal_connection_list("landed").size()}))
\tscene.free()
\tproject.free()
\tquit()
func _probe_listener() -> void:
\tpass
`;
  await fs.writeFile(path.join(directory, 'character-events-exit-probe.gd'), script, { flag: 'wx' });
  const result = await runBuildProcess(identified.executable, ['--headless', '--path', directory, '--script', 'res://character-events-exit-probe.gd'], {
    cwd: directory, timeoutMs: 60000, env: { ...process.env, GODOT_SILENCE_ROOT_WARNING: '1', XDG_DATA_HOME: path.join(directory, '.host/data'), XDG_CONFIG_HOME: path.join(directory, '.host/config'), XDG_CACHE_HOME: path.join(directory, '.host/cache') } });
  assert.equal(result.status, 'succeeded', result.stdout + result.stderr); assert.deepEqual(adapter.diagnostics(result, f.captured.plan), [], result.stdout + result.stderr);
  const line = result.stdout.split('\n').find(line => line.startsWith('EVENT_ABNORMAL_EXIT:')); assert.ok(line, result.stdout);
  const outcome = JSON.parse(line.slice(20)); assert.deepEqual(outcome, { audioStopped: true, audioFinished: true, jumpedConnections: 0, landedConnections: 0 });
  return outcome;
}

const fixture = scenePhysics2DCharacterEventsAuthor;
function exitActors(reader, visitIndex) { return reader.events.find(frame => frame.event === 'scene-exit' && (!visitIndex || frame.visitIndex === visitIndex)).actors; }
function publications(output, bindingId) { return output.reader.events.filter(frame => frame.event === 'event-publish' && (!bindingId || frame.bindingId === bindingId)); }
function record(name, f, output, before) {
  evidence.push({ name, backend: f.generated.backend, tool: output.tool, samples: output.snapshot?.samples || [],
    publications: publications(output), audio: output.reader.events.filter(frame => frame.event === 'audio-command'),
    animation: output.reader.events.filter(frame => frame.event === 'animation-command'), finalActors: exitActors(output.reader),
    authorFiles: Object.keys(before).length, authorSha256: hash(JSON.stringify(before)) });
}

test('event generator preserves frozen motion bytes and protocol without changing declarations or publishing project events', async t => {
  const f = await captured(await fixture(t)), previous = await generateGodotPhysicsCharacterMotionProject(f.captured.plan), prefix = `scenes/${f.sceneIds[0]}/`;
  assert.equal(previous.backend.version, '0.24.0'); assert.equal(f.generated.backend.version, '0.25.0');
  assert.equal(f.generated.backend.protocolVersion, previous.backend.protocolVersion); assert.deepEqual(f.generated.sourceMap, previous.sourceMap);
  assert.ok(f.generated.backend.capabilities.includes('physics.character-events2d')); assert.ok(!f.captured.plan.requiredCapabilities.includes('physics.character-events2d'));
  for (const [name, bytes] of previous.files) assert.deepEqual(f.generated.files.get(name === prefix + 'runtime.gd' ? prefix + 'character-events-original.gd'
    : name === prefix + 'project-scene.gd' ? prefix + 'character-events-scene-base.gd' : name), bytes, name);
  const wrapper = f.generated.files.get(prefix + 'project-scene.gd').toString(); assert.equal(wrapper.split('super.project_step(delta)').length, 2);
  assert.equal(wrapper.includes('publish_event'), false); assert.equal(wrapper.includes('move_and_collide'), false);
  const legacy = await captured(await scenePhysics2DAuthor(t, { animation: false }));
  assert.ok(!legacy.generated.backend.capabilities.includes('physics.character-events2d'));
  const { artifact, ...output } = legacy.generated; assert.deepEqual(await generateGodotPhysicsCharacterEventsProject(legacy.captured.plan), output);
});

test('event inventory rejects missing, extra, mismatched, orphaned and linked files while accepting 0.24 projects', async t => {
  const f = await captured(await fixture(t)), directory = await stage(f), scripts = await godotPhysicsCharacterEventsAssemblyScripts(directory);
  for (const name of f.generated.files.keys()) if (name.endsWith('.gd')) assert.ok(scripts.includes(name), name);
  const file = path.join(directory, 'character-events-project.json'), manifest = await fs.readFile(file);
  await fs.rm(file); await assert.rejects(godotPhysicsCharacterEventsAssemblyScripts(directory), { errorCode: 'build_physics_character_events_invalid' });
  await fs.writeFile(file, manifest);
  for (const value of [{ ...JSON.parse(manifest), sceneIds: [] }, { ...JSON.parse(manifest), extra: true }, { ...JSON.parse(manifest), sceneIds: [f.sceneIds[1]] }]) {
    await fs.writeFile(file, JSON.stringify(value)); await assert.rejects(godotPhysicsCharacterEventsAssemblyScripts(directory), { errorCode: 'build_physics_character_events_invalid' });
  }
  await fs.writeFile(file, manifest);
  const port = path.join(directory, 'character-events-port.gd'); await fs.rm(port); await fs.symlink(path.join(f.author, 'documents/scripts/motion-events.txt'), port);
  await assert.rejects(godotPhysicsCharacterEventsAssemblyScripts(directory), { errorCode: 'build_physics_character_events_invalid' });
  const original = await generateGodotPhysicsCharacterMotionProject(f.captured.plan), old = await stage(f, original);
  assert.ok(await godotPhysicsCharacterEventsAssemblyScripts(old)); await fs.writeFile(path.join(old, 'character-events-project.json'), manifest);
  await assert.rejects(godotPhysicsCharacterEventsAssemblyScripts(old), { errorCode: 'build_physics_character_events_invalid' });
});

for (const mode of ['hold', 'air-retry', 'ceiling', 'grounded', 'none', 'zero']) test(`real native character events ${mode} preserve physical results and registered publisher identity`, real, async t => {
  const f = await fixture(t, { hold: mode === 'hold', airRetry: mode === 'air-retry', jump: mode !== 'grounded', obstacle: mode === 'ceiling' ? 'ceiling' : undefined, controls: mode === 'none' ? 'none' : 'arrows' });
  if (mode === 'zero') await f.edit(f.physicsPath, document => { document.bodies[0].characterMotion.jumpSpeed = 0; });
  const ready = await captured(f), before = await hashes(f.author), output = await execute(ready, await stage(ready), { scriptCheck: mode === 'hold' });
  const published = publications(output, f.publisherBindingId), jumping = !['grounded', 'none', 'zero'].includes(mode);
  assert.deepEqual(published.map(frame => frame.name), jumping ? ['physics.landed', 'physics.jumped', 'physics.landed'] : ['physics.landed']);
  assert.ok(published.every(frame => frame.instanceId === f.instanceId && frame.value === f.instanceId));
  const entries = output.reader.projectEvents.entries.filter(entry => entry.origin.bindingId === f.publisherBindingId);
  const binding = ready.captured.plan.scenes[0].behaviors.bindings.find(binding => binding.bindingId === f.publisherBindingId);
  assert.equal(binding.implementation.sourceObjectId, f.publisherScriptId);
  assert.ok(entries.every(entry => entry.origin.source.sourcePath === f.manifestPath && entry.origin.source.propertyPath === binding.declaration.propertyPath));
  assert.equal(output.snapshot.samples.length, 30); assert.ok(Math.abs(exitActors(output.reader)[0].position[1] - 180) < .2);
  if (mode === 'ceiling') assert.ok(output.snapshot.samples.some(sample => sample.contacts.some(contact => contact.normal[1] > .7)));
  assert.deepEqual(await hashes(f.author), before); record(mode, ready, output, before);
});


test('real generated event hooks move once and emit no project event without an author publisher', real, async t => {
  const f = await fixture(t); await f.edit(f.manifestPath, document => { document.bindings = document.bindings.filter(binding => binding.bindingId !== f.publisherBindingId); });
  const ready = await captured(f), before = await hashes(f.author), output = await execute(ready, await stage(ready));
  const old = await generateGodotPhysicsCharacterMotionProject(ready.captured.plan), legacy = await execute(ready, await stage(ready, old), { generated: old });
  assert.deepEqual(exitActors(output.reader), exitActors(legacy.reader)); assert.deepEqual(output.snapshot.samples, legacy.snapshot.samples);
  assert.equal(publications(output).filter(frame => ['physics.jumped', 'physics.landed'].includes(frame.name)).length, 0);
  assert.deepEqual(await hashes(f.author), before); record('native-facts-no-publisher-one-move', ready, output, before);
});

test('real author publications drive existing animation and audio consumers with ordinary delivery and command provenance', real, async t => {
  const f = await captured(await fixture(t, { consumers: true })), before = await hashes(f.author), output = await execute(f, await stage(f), { scriptCheck: true });
  assert.equal(f.generated.backend.protocolVersion, 10);
  const entries = output.reader.projectEvents.entries.filter(entry => entry.origin.bindingId === f.publisherBindingId);
  assert.deepEqual(entries.map(entry => entry.name), ['physics.landed', 'physics.jumped', 'physics.landed']);
  const jumped = entries.find(entry => entry.name === 'physics.jumped');
  assert.ok(jumped.deliveries.some(delivery => delivery.origin.bindingId === f.animationBindingId && delivery.status === 'handled'));
  const commands = output.reader.events.filter(frame => frame.event === 'animation-command' && frame.bindingId === f.animationBindingId);
  assert.ok(commands.some(frame => frame.command.action === 'select' && frame.command.clipId === f.actionClipId));
  assert.ok(commands.some(frame => frame.command.action === 'play')); assert.equal(output.reader.animationCompletions.sequence, 1);
  const audio = output.reader.events.filter(frame => frame.event === 'audio-command' && frame.bindingId === f.audioBindingId);
  assert.equal(audio.length, 2); assert.ok(audio.every(frame => frame.action === 'play' && frame.trackId === f.trackId && frame.timeSeconds > 0));
  const end = output.reader.events.find(frame => frame.event === 'scene-event' && frame.stream === 'audio' && frame.frame.event === 'finished');
  assert.ok(end, 'inherited audio shutdown remains visible');
  assert.deepEqual(await hashes(f.author), before); record('animation-audio-consumers', f, output, before);
});

test('real repeated object instances receive isolated native ports and own author publication payloads', real, async t => {
  const f = await fixture(t), other = id(201), bodyId = id(202), bindingId = id(203);
  await f.edit('documents/scenes/demo.json', scene => { scene.actors.push({ ...structuredClone(scene.actors[0]), instanceId: other, position: [300, 178], controls: 'none' }); });
  await f.edit(f.physicsPath, document => { document.bodies.push({ ...structuredClone(document.bodies[0]), id: bodyId, instanceId: other }); });
  await f.edit(f.manifestPath, document => { document.bindings.push({ ...structuredClone(document.bindings.find(binding => binding.bindingId === f.publisherBindingId)), bindingId, instanceId: other }); });
  const ready = await captured(f), before = await hashes(f.author), output = await execute(ready, await stage(ready));
  assert.deepEqual(publications(output, f.publisherBindingId).map(frame => frame.name), ['physics.landed', 'physics.jumped', 'physics.landed']);
  const second = publications(output, bindingId); assert.deepEqual(second.map(frame => frame.name), ['physics.landed']);
  assert.equal(second[0].value, other); assert.equal(second[0].instanceId, other); assert.equal(output.snapshot.samples.length, 60);
  assert.deepEqual(await hashes(f.author), before); record('isolated-instances', ready, output, before);
});

test('real reentry revokes old ports before behavior exit and gives new visits independent landing facts', real, async t => {
  const f = await fixture(t);
  await f.script('motion-input', `extends Node
static var prior_port
static var switched := false
func _ready() -> void:
\tvar port = get_meta("viento_character_motion")
\tif prior_port != null:
\t\tprint("EVENT_PORT_STALE:" + JSON.stringify({"different": prior_port != port, "jumped": prior_port.get_signal_connection_list("jumped").size(), "landed": prior_port.get_signal_connection_list("landed").size()}))
\tprior_port = port
\tport.jumped.connect(_on_jump)
func _physics_process(_delta: float) -> void:
\tif not switched and get_parent().get_parent().get("physics_observation_step") >= 6:
\t\tInput.action_press("ui_accept")
func _on_jump() -> void:
\tif not switched:
\t\tswitched = true
\t\tget_meta("viento_project").request_scene("${f.sceneIds[1]}")
func _exit_tree() -> void:
\tvar port = get_meta("viento_character_motion")
\tprint("EVENT_PORT_EXIT:" + JSON.stringify({"jumped": port.get_signal_connection_list("jumped").size(), "landed": port.get_signal_connection_list("landed").size()}))
\tInput.action_release("ui_accept")
`);
  await f.script('second', `extends Node\nfunc _ready() -> void:\n\tget_meta("viento_project").request_scene("${f.sceneIds[0]}")\n`);
  const ready = await captured(f), before = await hashes(f.author), output = await execute(ready, await stage(ready));
  const stale = output.result.stdout.split('\n').filter(line => line.startsWith('EVENT_PORT_STALE:')).map(line => JSON.parse(line.slice(17)));
  const exits = output.result.stdout.split('\n').filter(line => line.startsWith('EVENT_PORT_EXIT:')).map(line => JSON.parse(line.slice(16)));
  assert.deepEqual(stale, [{ different: true, jumped: 0, landed: 0 }]); assert.equal(exits.length, 2); assert.ok(exits.every(value => value.jumped === 0 && value.landed === 0));
  assert.deepEqual(publications(output, f.publisherBindingId).map(frame => [frame.visitIndex, frame.name]), [[1, 'physics.landed'], [1, 'physics.jumped'], [3, 'physics.landed']]);
  assert.deepEqual(await hashes(f.author), before); record('reentry-revocation', ready, output, before);
});

test('real live native events work with no smoke physics trace and preserve audio teardown', real, async t => {
  const f = await captured(await fixture(t, { consumers: true, live: true })), before = await hashes(f.author), directory = await stage(f), output = await execute(f, directory, { smoke: false });
  assert.equal(output.snapshot, undefined); assert.equal(output.result.stdout.includes('VIENTO_PHYSICS2D:'), false);
  assert.deepEqual(publications(output, f.publisherBindingId).map(frame => frame.name), ['physics.landed', 'physics.jumped', 'physics.landed']);
  assert.equal(output.reader.events.filter(frame => frame.event === 'audio-command' && frame.bindingId === f.audioBindingId).length, 2);
  assert.ok(output.reader.events.some(frame => frame.event === 'scene-event' && frame.stream === 'audio' && frame.frame.event === 'finished'));
  assert.deepEqual(await hashes(f.author), before); record('live-events-no-trace', f, output, before); evidence.at(-1).abnormalExit = await abnormalExitProbe(f, directory, output.tool);
});

test('real native facts remain active after the smoke observation reaches its 256-sample limit', real, async t => {
  const f = await fixture(t);
  await f.edit('documents/scenes/demo.json', scene => { for (let index = 1; index <= 8; index++) scene.actors.push({ ...structuredClone(scene.actors[0]), instanceId: id(300 + index), position: [500 + index * 25, 178], controls: 'none' }); });
  await f.edit(f.physicsPath, document => { for (let index = 1; index <= 8; index++) document.bodies.push({ ...structuredClone(document.bodies[0]), id: id(400 + index), instanceId: id(300 + index) }); });
  await f.script('motion-input', 'extends Node\nfunc _physics_process(_delta: float) -> void:\n\tif get_parent().get_parent().get("physics_observation_step") == 29:\n\t\tInput.action_press("ui_accept")\nfunc _exit_tree() -> void:\n\tInput.action_release("ui_accept")\n');
  const ready = await captured(f), before = await hashes(f.author), output = await execute(ready, await stage(ready));
  assert.equal(output.snapshot.samples.length, 256); assert.equal(output.snapshot.limited, true);
  const names = publications(output, f.publisherBindingId).map(frame => frame.name); assert.deepEqual(names, ['physics.landed', 'physics.jumped']);
  assert.ok(output.result.stdout.indexOf('"event":"limited"') < output.result.stdout.lastIndexOf('"name":"physics.jumped"'));
  assert.deepEqual(await hashes(f.author), before); record('events-after-trace-limit', ready, output, before);
});
test('real portable ZIP retains character events, animation and audio without original author or build paths', real, async t => {
  const f = await captured(await fixture(t, { consumers: true })), before = await hashes(f.author), output = path.join(f.temporary, 'build');
  const built = await buildProject({ root: f.author, targetId: f.assemblyId, tool, output, backendRegistry: frozenRegistry() });
  assert.equal(built.ok, true, JSON.stringify(built.record?.diagnostics || built));
  const inspection = () => inspectBackendProject({ buildDirectory: output, backendRegistry: frozenRegistry() });
  const delivery = await planBackendProjectDelivery({ inspection: await inspection(), assertCurrent: inspection });
  const zip = path.join(f.temporary, 'character-events.zip'); await writeExportZip(delivery, zip); await verifyBackendProjectDelivery(zip);
  const moved = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-physics-character-events-relocated-')); t.after(() => fs.rm(moved, { recursive: true, force: true }));
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
  assert.deepEqual(publications(observed, f.publisherBindingId).map(frame => frame.name), ['physics.landed', 'physics.jumped', 'physics.landed']);
  assert.equal(observed.reader.events.filter(frame => frame.event === 'audio-command' && frame.bindingId === f.audioBindingId).length, 2);
  assert.equal(observed.reader.animationCompletions.sequence, 1);
  assert.ok(observed.snapshot.samples.some(sample => sample.requestedMotion[1] < -1));
  assert.ok(Math.abs(observed.snapshot.samples.at(-1).positionAfter[1] - 180) < .2);
  record('portable-relocation', f, observed, before);
  if (reportPath) { const destination = path.join(path.dirname(reportPath), 'character-events.zip'); await fs.copyFile(zip, destination, fs.constants.COPYFILE_EXCL); evidence.at(-1).zip = { path: destination, sha256: hash(await fs.readFile(zip)) }; }
});

test('real window capture uses the same smoke observation clock and retains final trace', { ...real, skip: !tool || !capturePath ? 'Set VIENTO_GODOT_BIN and VIENTO_PHYSICS_EVENTS_CAPTURE for native capture verification' : false }, async t => {
  const f = await captured(await fixture(t, { consumers: true })), before = await hashes(f.author);
  const output = await execute(f, await stage(f), { mode: 'windowCapture', capture: capturePath });
  assert.equal(output.snapshot.samples.length, 30); assert.ok((await fs.stat(capturePath)).size > 100);
  assert.deepEqual(await hashes(f.author), before); record('window-capture', f, output, before);
});


