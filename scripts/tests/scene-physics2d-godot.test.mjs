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
import { buildProject, runProjectBuild } from '../adapters/node-project-build.mjs';
import { GODOT4_EXECUTION_ADAPTER as currentAdapter } from '../backends/godot4-adapter.mjs';
import { generateGodotAssemblyProject } from '../backends/godot4-project.mjs';
import { generateGodotPhysicsProject } from '../backends/godot4-physics.mjs';
import { generateGodotPhysicsObservationProject, godotPhysicsObservationAssemblyScripts as godotPhysicsAssemblyScripts } from '../backends/godot4-physics-observation.mjs';
import { createExecutionBackendRegistry, validateGeneratedExecutionProject } from '../adapters/node-execution-backends.mjs';
import { inspectBackendProject } from '../adapters/node-backend-project.mjs';
import { planBackendProjectDelivery, verifyBackendProjectDelivery } from '../adapters/node-backend-project-delivery.mjs';
import { writeExportZip } from '../lib/export-package.mjs';
// These historical physics/response/observation contracts retain the 0.23
// generated files. The current host still validates and executes them; current
// 0.28 movement contacts are covered by the separate planar contacts suite.
const adapter = { ...currentAdapter, async generate(plan) {
  const generated = await generateGodotPhysicsObservationProject(plan);
  return { ...generated, resourceFiles: new Map(generated.resourceFiles || generated.imageFiles),
    artifact: { kind: 'godot-project', entry: 'project.godot', requiresTool: true } };
} };
const frozenRegistry = () => createExecutionBackendRegistry([adapter]);
const tool = process.env.VIENTO_GODOT_BIN;
const real = { skip: !tool ? 'Set VIENTO_GODOT_BIN for native physics verification' : false, timeout: 180000 };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
async function hashes(directory, prefix = '') {
  const result = {};
  for (const item of await fs.readdir(path.join(directory, prefix), { withFileTypes: true })) {
    const name = prefix ? `${prefix}/${item.name}` : item.name;
    if (item.isDirectory()) Object.assign(result, await hashes(directory, name));
    else { assert.ok(item.isFile()); result[name] = hash(await fs.readFile(path.join(directory, name))); }
  }
  return result;
}
async function capture(f) {
  const captured = await captureBuildSnapshot(f.author, f.assemblyId);
  assert.equal(captured.ok, true, JSON.stringify(captured.diagnostics));
  const generated = validateGeneratedExecutionProject(adapter, captured.plan, await adapter.generate(captured.plan));
  return { ...f, captured, generated };
}
async function stage(f) {
  const directory = path.join(f.temporary, 'staged');
  for (const [name, bytes] of [...f.generated.files, ...[...f.generated.resourceFiles].map(([id, name]) => [name, f.captured.resources.get(id)])]) {
    await fs.mkdir(path.dirname(path.join(directory, name)), { recursive: true }); await fs.writeFile(path.join(directory, name), bytes);
  }
  return directory;
}
async function build(f) {
  const before = await hashes(f.author), output = path.join(f.temporary, 'build');
  const built = await buildProject({ backendRegistry: frozenRegistry(), root: f.author, targetId: f.assemblyId, tool, output });
  assert.equal(built.ok, true, JSON.stringify(built.record?.diagnostics || built));
  assert.deepEqual(await hashes(f.author), before);
  return { ...f, output, built };
}
async function run(f) {
  const result = await runProjectBuild({ backendRegistry: frozenRegistry(), buildDirectory: f.output, tool, headless: true, smoke: true });
  assert.equal(result.ok, true, JSON.stringify(result.record?.diagnostics || result)); return result;
}
const exitActor = (result, f, instanceId = f.instanceId) => result.record.events.find(row => row.event === 'scene-exit' && row.sceneId === f.sceneIds[0]).actors.find(row => row.instanceId === instanceId);
function assertLoop(result, f, expectedX = 135) {
  const observed = result.record.runtime.project;
  assert.deepEqual(observed.events.entries.map(row => row.name), ['physics.entered', 'physics.exited']);
  for (const event of observed.events.entries) {
    assert.equal(event.value, f.instanceId); assert.equal(event.origin.bindingId, f.sensorBindingId);
    assert.equal(event.origin.instanceId, f.sensorInstanceId); assert.equal(event.origin.source.propertyPath, '/bindings/1');
  }
  assert.equal(observed.events.entries[0].deliveries[0].status, 'handled');
  assert.deepEqual(observed.animationStateEntries.entries.map(row => row.stateKey), ['idle', 'action', 'idle']);
  assert.deepEqual(observed.animationStateEntries.entries.map(row => row.trigger.kind), ['initial', 'event', 'completed']);
  assert.equal(observed.animationCompletions.sequence, 1); assert.equal(observed.protocolVersion, 10);
  assert.ok(Math.abs(exitActor(result, f).position[0] - expectedX) < .1);
  assert.equal(exitActor(result, f).state, 'idle');
  assert.deepEqual(exitActor(result, f, f.wallInstanceId).position, [150, 180]);
  assert.deepEqual(exitActor(result, f, f.sensorInstanceId).position, [115, 180]);
}
async function attachProbe(f) {
  await f.script('second', `extends Node
func _ready() -> void:
\tassert(get_parent() is CharacterBody2D)
func _exit_tree() -> void:
\tvar actor = get_parent()
\tvar collision = actor.get_node("VientoCollision")
\tvar visual = actor.get_node("VientoVisual")
\tprint("PHYSICS_VISUAL:" + JSON.stringify({"native":actor is CharacterBody2D,"collisionParent":collision.get_parent()==actor,"visualParent":visual.get_parent()==actor,"collisionOffset":[collision.position.x,collision.position.y],"visualOffset":[visual.position.x,visual.position.y],"position":[actor.position.x,actor.position.y]}))
`);
  await f.edit('documents/behaviors/demo.json', document => document.bindings.push({ ...structuredClone(document.bindings[0]),
    bindingId: f.secondBindingId, parameters: {}, implementation: { ...document.bindings[0].implementation, sourceObjectId: f.secondScriptId } }));
  await f.edit('metadata/documents/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee.json', record => record.relations.push({ kind: 'references', targetId: f.secondScriptId, slot: 'implementation' }));
}

test('no-physics assembly generation keeps every prior byte, receipt and protocol unchanged', async t => {
  const f = await capture(await projectAnimationClipsAuthor(t));
  const direct = await generateGodotAssemblyProject(f.captured.plan), wrapped = await generateGodotPhysicsProject(f.captured.plan);
  const { artifact, ...generated } = f.generated;
  assert.deepEqual(generated, direct); assert.deepEqual(wrapped, direct);
  assert.deepEqual(artifact, { kind: 'godot-project', entry: 'project.godot', requiresTool: true });
  assert.ok(!f.generated.files.has('physics-project.json')); assert.ok(!f.generated.backend.capabilities.some(value => value.startsWith('physics.')));
});

test('physics is an additive project wrapper with complete bounded script inventory and author mapping', async t => {
  const f = await capture(await scenePhysics2DAuthor(t)), directory = await stage(f);
  assert.equal(f.generated.backend.version, '0.23.0'); assert.equal(f.generated.backend.protocolVersion, 10);
  for (const capability of ['physics.bodies2d', 'physics.character2d', 'physics.sensors2d']) assert.ok(f.generated.backend.capabilities.includes(capability));
  const scripts = await godotPhysicsAssemblyScripts(directory);
  assert.ok(scripts.includes('project-physics-runtime.gd'));
  assert.ok(scripts.includes(`scenes/${f.sceneIds[0]}/physics-base.gd`));
  for (const name of [...f.generated.files.keys()].filter(name => name.endsWith('.gd'))) assert.ok(scripts.includes(name), name);
  const map = f.generated.sourceMap.scenes.find(scene => scene.sceneId === f.sceneIds[0]).sourceMap.physics;
  assert.equal(map.manifest.sourcePath, f.physicsPath); assert.equal(map.bodies.length, 3);
  await fs.writeFile(path.join(directory, 'physics-project.json'), JSON.stringify({ format: 'viento-godot-physics-project', schemaVersion: 1, sceneIds: ['../escape'] }));
  await assert.rejects(godotPhysicsAssemblyScripts(directory), { errorCode: 'build_physics_invalid' });
  await fs.writeFile(path.join(directory, 'physics-project.json'), f.generated.files.get('physics-project.json'));
  const base = path.join(directory, `scenes/${f.sceneIds[0]}/physics-base.gd`); await fs.rm(base);
  await fs.symlink(path.join(f.author, 'documents/scripts/checkpoint.txt'), base);
  await assert.rejects(godotPhysicsAssemblyScripts(directory));
});

test('standalone physics and old finite control replay reject explicitly before running an engine', async t => {
  const f = await capture(await scenePhysics2DAuthor(t));
  await assert.rejects(adapter.generate(f.captured.plan.scenes[0]), { errorCode: 'build_physics_requires_project' });
  const directory = await stage(f);
  await assert.rejects(adapter.executePhase({ phase: 'run', directory, tool: { executable: '/nonexistent-godot' }, smoke: true,
    mode: 'headlessLogic', controlProgram: { format: 'viento-runtime-control', schemaVersion: 1, fixedDelta: .125,
      steps: [{ left: false, right: true, up: false, down: false }, { left: false, right: false, up: false, down: false }] } }),
  { errorCode: 'build_physics_control_replay_unsupported' });
});

for (const circle of [false, true]) test(`real ${circle ? 'circle' : 'box'} character blocks at wall while sensor drives existing animation state loop`, real, async t => {
  const f = await build(await scenePhysics2DAuthor(t, { circle })), result = await run(f); assertLoop(result, f);
});

test('real native masks suppress sensor events and wall collisions; declaration offsets affect body shape independently of visuals', real, async t => {
  const f = await scenePhysics2DAuthor(t);
  await f.edit(f.physicsPath, document => { document.bodies[0].mask = 8; document.bodies[1].mask = 8; document.bodies[2].mask = 8; });
  const built = await build(f), result = await run(built);
  assert.ok(Math.abs(exitActor(result, f).position[0] - 160) < .001);
  assert.deepEqual(result.record.runtime.project.events.entries, []);
  assert.deepEqual(result.record.runtime.project.animationStateEntries.entries.map(row => row.stateKey), ['idle']);
  const shifted = await scenePhysics2DAuthor(t, { animation: false });
  await shifted.edit(shifted.physicsPath, document => { document.bodies[0].offset = [10, 0]; document.bodies[1].mask = 8; });
  const shiftedResult = await run(await build(shifted));
  assert.ok(Math.abs(exitActor(shiftedResult, shifted).position[0] - 125) < .1);
  assert.deepEqual(shiftedResult.record.runtime.project.events.entries, []);
  assert.equal(shiftedResult.record.runtime.project.protocolVersion, 4);
});

test('real sensor scene switch revokes old publishers and settles native registration before revisiting', real, async t => {
  const f = await scenePhysics2DAuthor(t);
  const sensor = await fs.readFile(path.join(f.author, 'documents/scripts/sensor.txt'), 'utf8');
  await f.script('sensor', sensor.replace('var _project', 'static var switched := false\nvar _project')
    .replace('\t_publish(entered_event, body)', `\t_publish(entered_event, body)\n\tif not switched:\n\t\tswitched = true\n\t\t_project.request_scene("${f.sceneIds[1]}")`));
  await f.script('second', `extends Node\nfunc _ready() -> void:\n\tget_meta("viento_project").request_scene("${f.sceneIds[0]}")\n`);
  const result = await run(await build(f)), frames = result.record.events;
  assert.deepEqual(result.record.runtime.project.visits.map(row => row.sceneId), [f.sceneIds[0], f.sceneIds[1], f.sceneIds[0]]);
  const firstExit = frames.findIndex(row => row.event === 'scene-exit' && row.visitIndex === 1);
  assert.ok(firstExit > 0); assert.ok(!frames.slice(firstExit + 1).some(row => row.event === 'event-publish' && row.visitIndex === 1));
  assert.deepEqual(result.record.runtime.project.events.entries.map(row => [row.name, row.origin.visitIndex]),
    [['physics.entered', 1], ['physics.entered', 3], ['physics.exited', 3]]);
  const final = frames.find(row => row.event === 'scene-exit' && row.visitIndex === 3).actors.find(row => row.instanceId === f.instanceId);
  assert.ok(Math.abs(final.position[0] - 135) < .1);
});

test('real portable backend ZIP contains physics and runs after author/build paths disappear with visual-only animation', real, async t => {
  const f = await scenePhysics2DAuthor(t); await attachProbe(f); const built = await build(f);
  const inspection = () => inspectBackendProject({ backendRegistry: frozenRegistry(), buildDirectory: built.output });
  const delivery = await planBackendProjectDelivery({ inspection: await inspection(), assertCurrent: inspection });
  const zip = path.join(f.temporary, 'physics.zip'); await writeExportZip(delivery, zip); await verifyBackendProjectDelivery(zip);
  const moved = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-physics-relocated-')); t.after(() => fs.rm(moved, { recursive: true, force: true }));
  const archive = await yauzl.openPromise(zip, { lazyEntries: true, autoClose: false });
  try { for await (const entry of archive.eachEntry()) {
    assert.ok(!entry.fileName.startsWith('/') && !entry.fileName.split('/').includes('..'));
    const chunks = []; for await (const chunk of await archive.openReadStreamPromise(entry)) chunks.push(chunk);
    const file = path.join(moved, entry.fileName); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, Buffer.concat(chunks));
  } } finally { await new Promise(resolve => { archive.reader.once('close', resolve); archive.close(); }); }
  const snapshot = JSON.parse(await fs.readFile(path.join(built.output, 'snapshot.json'))), directory = path.join(moved, 'project');
  assert.ok((await godotPhysicsAssemblyScripts(directory)).includes('project-physics-runtime.gd'));
  await fs.rename(f.author, f.author + '.offline'); await fs.rename(built.output, built.output + '.offline');
  const identified = await adapter.identify(tool);
  for (const phase of [...adapter.buildPhases, 'run']) {
    const result = await adapter.executePhase({ phase, directory, tool: identified, smoke: true, timeoutMs: 60000 });
    assert.equal(result.status, 'succeeded', result.stdout + result.stderr); assert.deepEqual(adapter.diagnostics(result, snapshot.plan), []);
    if (phase !== 'run') continue;
    const reader = adapter.createEventReader(snapshot.plan, { smoke: true }); reader.push(result.stdout); assert.deepEqual(reader.finish().diagnostics, []);
    assertLoop({ record: { events: reader.events, runtime: { project: { protocolVersion: 10, events: reader.projectEvents,
      animationStateEntries: reader.animationStateEntries, animationCompletions: reader.animationCompletions } } } }, f);
    const line = result.stdout.split('\n').find(row => row.startsWith('PHYSICS_VISUAL:')); assert.ok(line, result.stdout);
    const visual = JSON.parse(line.slice('PHYSICS_VISUAL:'.length));
    assert.equal(visual.native, true); assert.equal(visual.collisionParent, true); assert.equal(visual.visualParent, true);
    assert.deepEqual(visual.collisionOffset, [0, 0]); assert.ok(visual.visualOffset[0] > 25); assert.ok(Math.abs(visual.position[0] - 135) < .1);
  }
});

test('real interactive physics clock advances movement once per native tick and retains animation and sensor routing', real, async t => {
  const f = await scenePhysics2DAuthor(t); await attachProbe(f);
  await f.edit(f.physicsPath, document => { document.bodies[0].mask = 8; document.bodies[2].mask = 8; });
  let source = await fs.readFile(path.join(f.author, 'documents/scripts/second.txt'), 'utf8');
  source = source.replace('extends Node\n', 'extends Node\nvar ticks := 0\n')
    .replace('\tassert(get_parent() is CharacterBody2D)', '\tassert(get_parent() is CharacterBody2D)\n\tInput.action_press("ui_right")');
  source += `\nfunc _physics_process(_delta: float) -> void:\n\tticks += 1\n\tif ticks == 15:\n\t\tInput.action_release("ui_right")\n\tif ticks == 30:\n\t\tcall_deferred("_finish")\nfunc _finish() -> void:\n\tget_tree().root.get_node("VientoProject").finish_project()\n`;
  await f.script('second', source);
  const built = await build(f), result = await runProjectBuild({ backendRegistry: frozenRegistry(), buildDirectory: built.output, tool, headless: true, smoke: false });
  assert.equal(result.ok, true, JSON.stringify(result.record?.diagnostics || result)); assertLoop(result, f, 160);
  const elapsed = result.record.events.at(-1).totalSeconds; assert.ok(elapsed > .45 && elapsed < .6, String(elapsed));
  assert.ok(Math.abs(exitActor(result, f).position[0] - (100 + 240 * elapsed / 2)) < .1);
});
