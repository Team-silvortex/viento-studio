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
import { BEVY_EXECUTION_ADAPTER as bevy } from '../backends/bevy-adapter.mjs';
import { BEVY_RUST_EXECUTION_ADAPTER as bevyRust } from '../backends/bevy-rust-adapter.mjs';
import { generateGodotPhysicsProject } from '../backends/godot4-physics.mjs';
import { generateGodotPhysicsResponseProject } from '../backends/godot4-physics-response.mjs';
import { godotPhysicsObservationAssemblyScripts as godotPhysicsResponseAssemblyScripts } from '../backends/godot4-physics-observation.mjs';
import { generateGodotAssemblyProject } from '../backends/godot4-project.mjs';
import { checkExecutionBackendSupport } from '../../engine/backend-capabilities.mjs';
import { validateProjectAssemblyPlan } from '../../engine/project-assembly-plan.mjs';
import { validateScenePhysics2DPlan, stripScenePhysics2DPlan, scenePhysics2DCapabilities, SCENE_PHYSICS2D_SLIDE_CAPABILITY as slide } from '../../engine/scene-physics2d.mjs';
import { validateGeneratedExecutionProject } from '../adapters/node-execution-backends.mjs';
import { inspectBackendProject } from '../adapters/node-backend-project.mjs';
import { planBackendProjectDelivery, verifyBackendProjectDelivery } from '../adapters/node-backend-project-delivery.mjs';
import { writeExportZip } from '../lib/export-package.mjs';

const tool = process.env.VIENTO_GODOT_BIN;
const real = { skip: !tool ? 'Set VIENTO_GODOT_BIN for native response verification' : false, timeout: 180000 };
const hash = value => createHash('sha256').update(value).digest('hex');
const evidence = [];
test.after(async () => {
  if (process.env.VIENTO_PHYSICS_RESPONSE_REPORT) await fs.writeFile(process.env.VIENTO_PHYSICS_RESPONSE_REPORT,
    JSON.stringify({ format: 'viento-physics-response-verification', schemaVersion: 1, tool, cases: evidence }, null, 2) + '\n');
});
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
async function fixture(t, { response = 'slide', circle = false, geometry = 'wall', animation = false, reverse = false, diagonal = true } = {}) {
  const f = await scenePhysics2DAuthor(t, { circle, animation });
  await f.edit(f.physicsPath, document => {
    if (response !== 'legacy') document.schemaVersion = 2;
    if (['slide', 'stop'].includes(response)) document.bodies[0].collisionResponse = response;
    document.bodies[2].shape.size = [10, 1000];
    if (geometry === 'free') document.bodies.splice(2, 1);
    if (geometry === 'mask') document.bodies[0].mask = 8;
    if (geometry === 'offset') document.bodies[0].offset = [10, 0];
    if (geometry === 'corner') document.bodies.push({ ...structuredClone(document.bodies[2]),
      id: '70707070-7070-4070-8070-000000000090', instanceId: '70707070-7070-4070-8070-000000000091', shape: { kind: 'box', size: [1000, 10] } });
  });
  if (geometry === 'corner') await f.edit('documents/scenes/demo.json', scene => scene.actors.push({ ...structuredClone(scene.actors[2]),
    instanceId: '70707070-7070-4070-8070-000000000091', position: [100, 235], size: [1000, 10] }));
  await f.script('second', `extends Node
var ticks := 0
func _ready() -> void:
\tassert(get_parent() is CharacterBody2D)
\tInput.action_press("ui_right")
${diagonal ? '\tInput.action_press("ui_down")\n' : ''}func _physics_process(_delta: float) -> void:
\tticks += 1
\tif ticks == 15:
\t\t_report("contact")
\t\tInput.action_release("ui_right")
\t\tInput.action_release("ui_down")
${reverse ? '\t\tInput.action_press("ui_left")\n\t\tInput.action_press("ui_up")\n' : ''}\tif ticks == 29:
\t\t_report("settled")
\tif ticks == 30:
\t\tInput.action_release("ui_left")
\t\tInput.action_release("ui_up")
\t\t_report("final")
\t\tcall_deferred("_finish")
func _report(label: String) -> void:
\tvar actor = get_parent()
\tvar collision = actor.get_node("VientoCollision")
\tvar visual = actor.get_node_or_null("VientoVisual")\n\tif visual == null:\n\t\tvisual = actor.get_child(0)
\tprint("PHYSICS_RESPONSE:" + JSON.stringify({"label":label,"ticks":ticks,"native":actor is CharacterBody2D,"collisionParent":collision.get_parent()==actor,"visualParent":visual.get_parent()==actor,"collisionOffset":[collision.position.x,collision.position.y],"visualOffset":[visual.position.x,visual.position.y],"position":[actor.position.x,actor.position.y]}))
func _finish() -> void:
\tget_tree().root.get_node("VientoProject").finish_project()
func _exit_tree() -> void:
\tfor action in ["ui_left", "ui_right", "ui_up", "ui_down"]:
\t\tInput.action_release(action)
`);
  await f.edit('documents/behaviors/demo.json', document => document.bindings.push({ ...structuredClone(document.bindings[0]),
    bindingId: f.secondBindingId, parameters: {}, implementation: { ...document.bindings[0].implementation, sourceObjectId: f.secondScriptId } }));
  await f.edit('metadata/documents/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee.json', record => record.relations.push({ kind: 'references', targetId: f.secondScriptId, slot: 'implementation' }));
  return { ...f, reverse, label: `${circle ? 'circle' : 'box'}-${response}-${geometry}${reverse ? '-reverse' : ''}${diagonal ? '' : '-normal'}` };
}
function observed(result, f) {
  assert.equal(result.status, 'succeeded', result.stdout + result.stderr);
  assert.deepEqual(adapter.diagnostics(result, f.captured.plan), [], result.stdout + result.stderr);
  const reader = adapter.createEventReader(f.captured.plan, { smoke: false }); reader.push(result.stdout); assert.deepEqual(reader.finish().diagnostics, []);
  const samples = result.stdout.split('\n').filter(row => row.startsWith('PHYSICS_RESPONSE:')).map(row => JSON.parse(row.slice('PHYSICS_RESPONSE:'.length)));
  assert.deepEqual(samples.map(row => row.label), ['contact', 'settled', 'final']);
  const probes = [samples[0], samples[2]];
  if (!f.reverse) assert.deepEqual(samples[1].position, samples[2].position);
  for (const probe of probes) { assert.equal(probe.native, true); assert.equal(probe.collisionParent, true); assert.equal(probe.visualParent, true); }
  const exit = reader.events.find(row => row.event === 'scene-exit' && row.sceneId === f.sceneIds[0]);
  const actor = exit.actors.find(row => row.instanceId === f.instanceId);
  actor.position.forEach((value, index) => assert.ok(Math.abs(value - probes[1].position[index]) < 1e-6));
  assert.deepEqual(exit.actors.find(row => row.instanceId === f.wallInstanceId).position, [150, 180]);
  assert.deepEqual(exit.actors.find(row => row.instanceId === f.sensorInstanceId).position, [115, 180]);
  const elapsed = reader.events.at(-1).totalSeconds; assert.ok(elapsed > .45 && elapsed < .6, String(elapsed));
  evidence.push({ name: f.label, backend: f.generated.backend, probes, settled: samples[1], elapsed, events: reader.events });
  return { probes, reader, actor, elapsed };
}
async function execute(f, directory, { scriptCheck = false } = {}) {
  const identified = await adapter.identify(tool);
  for (const phase of scriptCheck ? adapter.buildPhases : adapter.runtimePhases) {
    const phaseResult = await adapter.executePhase({ phase, directory, tool: identified, timeoutMs: 60000 });
    assert.equal(phaseResult.status, 'succeeded', phaseResult.stdout + phaseResult.stderr);
    assert.deepEqual(adapter.diagnostics(phaseResult, f.captured.plan), []);
  }
  return observed(await adapter.executePhase({ phase: 'run', directory, tool: identified, smoke: false, timeoutMs: 30000 }), f);
}
async function native(t, options) {
  const f = await fixture(t, options), before = await hashes(f.author), ready = await capture(f);
  const result = await execute(ready, await stage(ready)); assert.deepEqual(await hashes(f.author), before);
  evidence.at(-1).authorFiles = Object.keys(before).length; evidence.at(-1).authorSha256BeforeAfter = hash(JSON.stringify(before));
  return { ...result, f: ready };
}
const near = (actual, expected, tolerance = .15) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`);
const diagonalDistance = 60 / Math.sqrt(2);

test('response layer retains byte-identical legacy physical and non-physical generator outputs', async t => {
  for (const f of [await scenePhysics2DAuthor(t), await projectAnimationClipsAuthor(t)]) {
    const ready = await capture(f), plan = ready.captured.plan;
    const legacy = await (plan.scenes.some(scene => scene.physics) ? generateGodotPhysicsProject : generateGodotAssemblyProject)(plan);
    assert.deepEqual(await generateGodotPhysicsResponseProject(plan), legacy);
    const { artifact, ...output } = ready.generated;
    if (!plan.scenes.some(scene => scene.physics)) assert.deepEqual(output, legacy);
    else for (const [name, bytes] of legacy.files) {
      if (name === 'project.tscn') continue;
      const observed = name.endsWith('/runtime.gd') && plan.scenes.some(scene => scene.physics && name === `scenes/${scene.scene.objectId}/runtime.gd`)
        ? name.replace('/runtime.gd', '/physics-observation-base.gd') : name;
      assert.deepEqual(output.files.get(observed), bytes, name);
    }
    assert.ok(!output.files.has('physics-response-project.json')); assert.ok(!output.backend.capabilities.includes(slide));
    if (plan.scenes.some(scene => scene.physics)) assert.equal(output.backend.version, '0.23.0');
  }
});

test('slide capability is derived only from slide and cannot be hidden from plan, provider or receipt', async t => {
  const f = await capture(await fixture(t)); const plan = f.captured.plan, scene = plan.scenes[0];
  assert.ok(scenePhysics2DCapabilities(scene.physics.document).includes(slide));
  assert.ok(!stripScenePhysics2DPlan(scene).requiredCapabilities.includes(slide));
  assert.equal(f.generated.backend.version, '0.23.0'); assert.equal(f.generated.backend.protocolVersion, 4);
  assert.ok(f.generated.backend.capabilities.includes(slide));
  assert.deepEqual(checkExecutionBackendSupport(adapter.descriptor, { operation: 'build', plan }), []);
  const legacyProvider = { ...adapter.descriptor, capabilities: adapter.descriptor.capabilities.filter(capability => capability !== slide) };
  assert.ok(checkExecutionBackendSupport(legacyProvider, { operation: 'build', plan }).some(row => row.code === 'build_capability_missing' && row.capability === slide));
  for (const backend of [bevy, bevyRust]) {
    assert.ok(checkExecutionBackendSupport(backend.descriptor, { operation: 'build', plan }).some(row => row.code === 'build_capability_missing' && row.capability === slide));
    await assert.rejects(backend.generate(plan));
  }
  const missing = structuredClone(plan); missing.requiredCapabilities = missing.requiredCapabilities.filter(value => value !== slide);
  missing.scenes[0].requiredCapabilities = missing.scenes[0].requiredCapabilities.filter(value => value !== slide);
  assert.throws(() => validateScenePhysics2DPlan(missing.scenes[0]), { errorCode: 'build_physics_invalid' });
  assert.throws(() => validateProjectAssemblyPlan(missing), { errorCode: 'build_physics_invalid' });
  assert.ok(checkExecutionBackendSupport(legacyProvider, { operation: 'build', plan: missing }).some(row => row.code === 'build_physics_invalid' && row.capability === slide));
  assert.ok(checkExecutionBackendSupport(legacyProvider, { operation: 'build', plan: missing }).some(row => row.code === 'build_capability_missing' && row.capability === slide));
  for (const [backend, input, output] of [[{ ...adapter, descriptor: legacyProvider }, plan, f.generated], [adapter, missing, f.generated],
    [adapter, plan, { ...f.generated, backend: { ...f.generated.backend, capabilities: f.generated.backend.capabilities.filter(value => value !== slide) } }]]) {
    assert.throws(() => validateGeneratedExecutionProject(backend, input, output), { errorCode: 'build_backend_invalid' });
  }
  // Explicit stop and absent response do not acquire a slide requirement.
  for (const response of ['stop', 'implicit']) {
    const stop = await capture(await fixture(t, { response }));
    assert.ok(!stop.captured.plan.requiredCapabilities.includes(slide)); assert.ok(!stop.generated.backend.capabilities.includes(slide));
    assert.deepEqual(checkExecutionBackendSupport(legacyProvider, { operation: 'build', plan: stop.captured.plan }), []);
  }
});

test('response inventory covers every generated script and rejects omissions, extra scenes, traversal and links', async t => {
  const f = await capture(await fixture(t)), directory = await stage(f), file = path.join(directory, 'physics-response-project.json');
  const scripts = await godotPhysicsResponseAssemblyScripts(directory);
  for (const name of [...f.generated.files.keys()].filter(name => name.endsWith('.gd'))) assert.ok(scripts.includes(name), name);
  const original = JSON.parse(await fs.readFile(file));
  for (const bad of [{ ...original, sceneIds: [] }, { ...original, sceneIds: ['../escape'] }, { ...original, extra: true },
    { ...original, sceneIds: [...original.sceneIds, f.sceneIds[1]] }]) {
    await fs.writeFile(file, JSON.stringify(bad)); await assert.rejects(godotPhysicsResponseAssemblyScripts(directory), { errorCode: 'build_physics_invalid' });
  }
  await fs.rm(file); await assert.rejects(godotPhysicsResponseAssemblyScripts(directory), { errorCode: 'build_physics_invalid' });
  await fs.writeFile(file, JSON.stringify(original));
  const base = path.join(directory, `scenes/${f.sceneIds[0]}/physics-stop.gd`); await fs.rm(base); await fs.symlink(path.join(f.author, 'documents/scripts/second.txt'), base);
  await assert.rejects(godotPhysicsResponseAssemblyScripts(directory), { errorCode: 'build_physics_invalid' });
});

for (const circle of [false, true]) test(`real ${circle ? 'circle' : 'box'} diagonal wall response preserves old stop and continues only the slide tangent`, real, async t => {
  const results = {};
  for (const response of ['legacy', 'implicit', 'stop', 'slide']) {
    const result = await native(t, { response, circle }); results[response] = result;
    near(result.actor.position[0], 135); result.probes[0].position.forEach((value, index) => near(value, result.probes[1].position[index], .16));
    assert.deepEqual(result.probes[1].collisionOffset, [0, 0]);
  }
  assert.deepEqual(results.stop.actor.position, results.legacy.actor.position);
  assert.deepEqual(results.implicit.actor.position, results.legacy.actor.position);
  near(results.stop.actor.position[1], 215); near(results.slide.actor.position[1], 180 + diagonalDistance);
  assert.ok(results.slide.actor.position[1] - results.stop.actor.position[1] > 6);
});

test('real response has bounded corner sweeps, normal blocking, free motion, mask filtering, independent offsets and reverse escape', real, async t => {
  for (const geometry of ['free', 'mask']) for (const response of ['stop', 'slide']) {
    const result = await native(t, { geometry, response }); near(result.actor.position[0], 100 + diagonalDistance); near(result.actor.position[1], 180 + diagonalDistance);
  }
  for (const circle of [false, true]) {
    const corner = await native(t, { geometry: 'corner', circle }); near(corner.actor.position[0], 135); near(corner.actor.position[1], 220);
    corner.probes[0].position.forEach((value, index) => near(value, corner.probes[1].position[index], .16));
  }
  for (const response of ['stop', 'slide']) {
    const normal = await native(t, { response, diagonal: false }); near(normal.actor.position[0], 135); near(normal.actor.position[1], 180);
  }
  const shifted = await native(t, { geometry: 'offset' }); near(shifted.actor.position[0], 125); near(shifted.actor.position[1], 180 + diagonalDistance);
  assert.deepEqual(shifted.probes[1].collisionOffset, [10, 0]); assert.deepEqual(shifted.probes[1].visualOffset, [0, 0]);
  const reversed = await native(t, { reverse: true }); near(reversed.probes[0].position[0], 135); near(reversed.probes[0].position[1], 180 + diagonalDistance);
  near(reversed.actor.position[0], 135 - diagonalDistance); near(reversed.actor.position[1], 180);
});

test('real slide delivery retains native collision, sensors and animation after author/build paths disappear', real, async t => {
  const f = await capture(await fixture(t, { animation: true })), before = await hashes(f.author), output = path.join(f.temporary, 'build');
  const built = await buildProject({ root: f.author, targetId: f.assemblyId, tool, output, timeoutMs: 60000 });
  assert.equal(built.ok, true, JSON.stringify(built.record?.diagnostics || built)); assert.deepEqual(await hashes(f.author), before);
  assert.equal(f.generated.backend.protocolVersion, 10);
  const inspection = () => inspectBackendProject({ buildDirectory: output });
  const delivery = await planBackendProjectDelivery({ inspection: await inspection(), assertCurrent: inspection });
  const zip = path.join(f.temporary, 'response.zip'); await writeExportZip(delivery, zip); await verifyBackendProjectDelivery(zip);
  const moved = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-response-relocated-')); t.after(() => fs.rm(moved, { recursive: true, force: true }));
  const archive = await yauzl.openPromise(zip, { lazyEntries: true, autoClose: false });
  try { for await (const entry of archive.eachEntry()) {
    assert.ok(!entry.fileName.startsWith('/') && !entry.fileName.split('/').includes('..'));
    assert.ok(!entry.fileName.split('/').some(part => ['.godot', '.host', 'target'].includes(part)));
    const chunks = []; for await (const chunk of await archive.openReadStreamPromise(entry)) chunks.push(chunk);
    const file = path.join(moved, entry.fileName); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, Buffer.concat(chunks));
  } } finally { await new Promise(resolve => { archive.reader.once('close', resolve); archive.close(); }); }
  const directory = path.join(moved, 'project'); assert.ok((await godotPhysicsResponseAssemblyScripts(directory)).includes(`scenes/${f.sceneIds[0]}/physics-stop.gd`));
  await fs.rename(f.author, f.author + '.offline'); await fs.rename(output, output + '.offline');
  const result = await execute(f, directory, { scriptCheck: true }); near(result.actor.position[0], 135); near(result.actor.position[1], 180 + diagonalDistance);
  assert.deepEqual(result.reader.projectEvents.entries.map(row => row.name), ['physics.entered', 'physics.exited']);
  for (const event of result.reader.projectEvents.entries) { assert.equal(event.value, f.instanceId); assert.equal(event.origin.bindingId, f.sensorBindingId); }
  assert.deepEqual(result.reader.animationStateEntries.entries.map(row => row.stateKey), ['idle', 'action', 'idle']);
  assert.deepEqual(result.reader.animationStateEntries.entries.map(row => row.trigger.kind), ['initial', 'event', 'completed']);
  assert.equal(result.reader.animationCompletions.sequence, 1);
  assert.deepEqual(result.probes[1].collisionOffset, [0, 0]); assert.ok(result.probes[1].visualOffset[0] > 25);
  evidence.at(-1).delivery = { zipSha256: hash(await fs.readFile(zip)), originalAuthorOffline: true, originalBuildOffline: true, generatedScriptsChecked: true };
});
