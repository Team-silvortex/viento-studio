import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import yauzl from 'yauzl';
import { scenePhysics2DCharacterMotionAuthor } from './helpers/scene-physics2d-character-motion-author-fixture.mjs';
import { scenePhysics2DAuthor } from './helpers/scene-physics2d-author-fixture.mjs';
import { projectAnimationClipsAuthor } from './helpers/project-animation-clips-author-fixture.mjs';
import { captureBuildSnapshot } from '../adapters/node-build-snapshot.mjs';
import { createExecutionBackendRegistry } from '../adapters/node-execution-backends.mjs';
import { buildProject } from '../adapters/node-project-build.mjs';
import { GODOT4_EXECUTION_ADAPTER as adapter } from '../backends/godot4-adapter.mjs';
import { generateGodotPhysicsObservationProject } from '../backends/godot4-physics-observation.mjs';
import { generateGodotPhysicsCharacterMotionProject, godotPhysicsCharacterMotionAssemblyScripts } from '../backends/godot4-physics-character-motion.mjs';
import { inspectBackendProject } from '../adapters/node-backend-project.mjs';
import { planBackendProjectDelivery, verifyBackendProjectDelivery } from '../adapters/node-backend-project-delivery.mjs';
import { writeExportZip } from '../lib/export-package.mjs';

const tool = process.env.VIENTO_GODOT_BIN;
const real = { skip: !tool ? 'Set VIENTO_GODOT_BIN for native observation verification' : false, timeout: 180000 };
const capturePath = process.env.VIENTO_PHYSICS_MOTION_CAPTURE;
const reportPath = process.env.VIENTO_PHYSICS_MOTION_REPORT;
const evidence = [];
const hash = value => createHash('sha256').update(value).digest('hex');
const id = n => `71717171-7171-4171-8171-${String(n).padStart(12, '0')}`;
test.after(async () => { if (reportPath) await fs.writeFile(reportPath, JSON.stringify({ format: 'viento-physics-character-motion-proof', schemaVersion: 1, tool, cases: evidence }, null, 2) + '\n', { flag: 'wx' }); });
async function hashes(directory, prefix = '') {
  const result = {};
  for (const item of await fs.readdir(path.join(directory, prefix), { withFileTypes: true })) {
    const name = prefix ? `${prefix}/${item.name}` : item.name;
    if (item.isDirectory()) Object.assign(result, await hashes(directory, name));
    else { assert.ok(item.isFile()); result[name] = hash(await fs.readFile(path.join(directory, name))); }
  }
  return result;
}
// This historical suite owns the frozen 0.24 generator, including delivery.
const frozenMotionAdapter = { ...adapter, async generate(plan) {
  const generated = await generateGodotPhysicsCharacterMotionProject(plan);
  return { ...generated, resourceFiles: new Map(generated.resourceFiles || generated.imageFiles), artifact: { kind: 'godot-project', entry: 'project.godot', requiresTool: true } };
} };
async function captured(f) {
  const captured = await captureBuildSnapshot(f.author, f.assemblyId);
  assert.equal(captured.ok, true, JSON.stringify(captured.diagnostics));
  return { ...f, captured, generated: await frozenMotionAdapter.generate(captured.plan) };
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

function exitActors(reader, visitIndex) { return reader.events.find(frame => frame.event === 'scene-exit' && (!visitIndex || frame.visitIndex === visitIndex)).actors; }
function record(name, f, output, before) {
  evidence.push({ name, backend: f.generated.backend, tool: output.tool, samples: output.snapshot?.samples || [],
    finalActors: exitActors(output.reader), authorFiles: Object.keys(before).length, authorSha256: hash(JSON.stringify(before)) });
}
const fixture = scenePhysics2DCharacterMotionAuthor;

test('motion wrapper preserves every old output byte, source map and protocol and format 3 can disable its last motor', async t => {
  for (const physical of [false, true]) {
    const f = await captured(await (physical ? scenePhysics2DAuthor(t, { animation: false }) : projectAnimationClipsAuthor(t)));
    const { artifact, ...output } = f.generated;
    assert.deepEqual(await generateGodotPhysicsCharacterMotionProject(f.captured.plan), output);
    assert.ok(!output.backend.capabilities.includes('physics.character-motion2d'));
  }
  const f = await captured(await fixture(t)), original = structuredClone(f.captured.plan);
  const lower = structuredClone(original);
  lower.requiredCapabilities = lower.requiredCapabilities.filter(value => value !== 'physics.character-motion2d');
  for (const scene of lower.scenes) {
    scene.requiredCapabilities = scene.requiredCapabilities.filter(value => value !== 'physics.character-motion2d');
    if (scene.physics?.document.schemaVersion === 3) { scene.physics.document.schemaVersion = 2; for (const body of scene.physics.document.bodies) delete body.characterMotion; }
  }
  const previous = await generateGodotPhysicsObservationProject(lower), prefix = `scenes/${f.sceneIds[0]}/`;
  for (const [name, bytes] of previous.files) assert.deepEqual(f.generated.files.get(name === prefix + 'runtime.gd' ? prefix + 'character-motion-base.gd' : name), bytes, name);
  assert.deepEqual(f.generated.sourceMap, previous.sourceMap); assert.deepEqual(f.captured.plan, original);
  assert.equal(f.generated.backend.version, '0.24.0'); assert.equal(f.generated.backend.protocolVersion, previous.backend.protocolVersion);
  assert.ok(f.generated.backend.capabilities.includes('physics.character-motion2d'));
  await f.edit(f.physicsPath, document => { delete document.bodies[0].characterMotion; });
  const disabled = await captured(f); assert.equal(disabled.generated.backend.version, '0.23.0');
  assert.ok(!disabled.generated.backend.capabilities.includes('physics.character-motion2d'));
  assert.ok(!disabled.generated.files.has('character-motion-project.json'));
  await assert.rejects(generateGodotPhysicsCharacterMotionProject(f.captured.plan.scenes[0]), { errorCode: 'build_physics_requires_project' });
});

test('motion inventories reject missing, extra, mismatched, malformed and linked generated files', async t => {
  const f = await captured(await fixture(t)), directory = await stage(f);
  const inventory = path.join(directory, 'character-motion-project.json'), document = path.join(directory, `scenes/${f.sceneIds[0]}/character-motion.json`);
  const manifest = await fs.readFile(inventory), content = await fs.readFile(document);
  const scripts = await godotPhysicsCharacterMotionAssemblyScripts(directory);
  for (const name of f.generated.files.keys()) if (name.endsWith('.gd')) assert.ok(scripts.includes(name), name);
  await fs.rm(inventory); await assert.rejects(godotPhysicsCharacterMotionAssemblyScripts(directory), { errorCode: 'build_physics_character_motion_invalid' });
  await fs.writeFile(inventory, manifest);
  for (const change of [value => { value.sceneObjectId = f.sceneIds[1]; }, value => { value.bodies[0].characterMotion.gravity = 0; }, value => { value.bodies[0].instanceId = f.wallInstanceId; }, value => { value.bodies = []; }]) {
    const value = JSON.parse(content); change(value); await fs.writeFile(document, JSON.stringify(value));
    await assert.rejects(godotPhysicsCharacterMotionAssemblyScripts(directory), { errorCode: 'build_physics_character_motion_invalid' });
  }
  await fs.rm(document); await fs.symlink(path.join(f.author, f.physicsPath), document);
  await assert.rejects(godotPhysicsCharacterMotionAssemblyScripts(directory), { errorCode: 'build_physics_character_motion_invalid' });
  const old = await captured(await scenePhysics2DAuthor(t, { animation: false })), legacy = await stage(old);
  assert.ok(await godotPhysicsCharacterMotionAssemblyScripts(legacy));
  await fs.writeFile(path.join(legacy, 'character-motion-project.json'), manifest);
  await assert.rejects(godotPhysicsCharacterMotionAssemblyScripts(legacy), { errorCode: 'build_physics_character_motion_invalid' });
});

test('real character lands, keeps horizontal motion along the floor and shares the existing smoke observation', real, async t => {
  const f = await captured(await fixture(t)), before = await hashes(f.author), output = await execute(f, await stage(f), { scriptCheck: true });
  const samples = output.snapshot.samples;
  assert.equal(samples.length, 30); assert.ok(samples.some(sample => sample.contacts.some(contact => contact.normal[1] <= -.7)));
  assert.ok(samples[0].requestedMotion[1] > 0); assert.ok(Math.abs(samples.at(-1).positionAfter[1] - 180) < .2);
  assert.ok(Math.abs(samples[14].positionAfter[0] - 160) < .2); assert.ok(samples.every(sample => sample.contacts.length <= 4));
  assert.deepEqual(await hashes(f.author), before); record('landing-horizontal-floor', f, output, before);
});

for (const mode of ['hold', 'air-repeat', 'ceiling', 'wall', 'none', 'terminal']) test(`real platformer ${mode}`, real, async t => {
  const f = await fixture(t, { jump: mode !== 'terminal', hold: mode === 'hold', airRepeat: mode === 'air-repeat', obstacle: ['ceiling', 'wall'].includes(mode) ? mode : undefined,
    controls: mode === 'none' ? 'none' : 'arrows', terminal: mode === 'terminal' });
  const ready = await captured(f), before = await hashes(f.author), output = await execute(ready, await stage(ready)), samples = output.snapshot.samples;
  if (['hold', 'air-repeat', 'ceiling'].includes(mode)) {
    assert.ok(samples.some(sample => sample.requestedMotion[1] < -1));
    assert.ok(Math.abs(samples.at(-1).positionAfter[1] - 180) < .2);
    const launches = samples.filter((sample, index) => sample.requestedMotion[1] < -1 && (!index || samples[index - 1].requestedMotion[1] >= 0));
    assert.equal(launches.length, 1);
  }
  if (mode === 'ceiling') assert.ok(samples.some(sample => sample.contacts.some(contact => contact.normal[1] >= .7)));
  if (mode === 'wall') assert.ok(samples.some(sample => sample.contacts.some(contact => contact.normal[0] <= -.7)));
  if (mode === 'none') { assert.ok(samples.every(sample => sample.requestedMotion[0] === 0 && sample.requestedMotion[1] >= 0)); assert.ok(Math.abs(samples.at(-1).positionAfter[1] - 180) < .2); }
  if (mode === 'terminal') { assert.ok(samples.every(sample => sample.requestedMotion[1] <= 2 + 1e-6)); assert.equal(samples.at(-1).requestedMotion[1], 2); assert.ok(samples.at(-1).positionAfter[1] > 200); }
  assert.deepEqual(await hashes(f.author), before); record(mode, ready, output, before);
});


test('real mixed scene preserves top-down character and nonphysical movement while platformer ignores vertical arrow input', real, async t => {
  const f = await fixture(t);
  await f.edit('documents/scenes/demo.json', scene => {
    scene.actors.push({ ...structuredClone(scene.actors[0]), instanceId: id(101), position: [300, 100] });
    scene.actors.push({ ...structuredClone(scene.actors[0]), instanceId: id(102), position: [400, 100] });
  });
  await f.edit(f.physicsPath, document => { const body = { ...structuredClone(document.bodies[0]), id: id(103), instanceId: id(101) }; delete body.characterMotion; document.bodies.push(body); });
  await f.script('checkpoint', 'extends Node\nfunc _ready() -> void:\n\tInput.action_press("ui_down")\nfunc _exit_tree() -> void:\n\tInput.action_release("ui_down")\n');
  const ready = await captured(f), before = await hashes(f.author), output = await execute(ready, await stage(ready));
  const motor = output.snapshot.samples.filter(sample => sample.instanceId === f.instanceId), ordinary = output.snapshot.samples.filter(sample => sample.instanceId === id(101));
  assert.equal(output.snapshot.samples.length, 60); assert.ok(Math.abs(motor[14].positionAfter[0] - 160) < .2);
  assert.ok(Math.abs(ordinary[14].positionAfter[0] - 300 - 60 / Math.sqrt(2)) < .001);
  assert.ok(Math.abs(ordinary[14].positionAfter[1] - 100 - 60 / Math.sqrt(2)) < .001);
  const actors = exitActors(output.reader), free = actors.find(actor => actor.instanceId === id(102)), physical = actors.find(actor => actor.instanceId === id(101));
  assert.equal(free.position[0] - 100, physical.position[0]); assert.ok(Math.abs(physical.position[1] - 180) < .2);
  assert.ok(free.position[1] > 200, 'nonphysical instances keep moving through the floor');
  assert.deepEqual(await hashes(f.author), before); record('mixed-movement', ready, output, before);
});

test('real zero jump speed leaves gravity unchanged even on a grounded rising edge', real, async t => {
  const f = await fixture(t, { jump: true }); await f.edit(f.physicsPath, document => { document.bodies[0].characterMotion.jumpSpeed = 0; });
  const ready = await captured(f), before = await hashes(f.author), output = await execute(ready, await stage(ready));
  assert.ok(output.snapshot.samples.every(sample => sample.requestedMotion[1] > 0));
  assert.deepEqual(await hashes(f.author), before); record('zero-jump-speed', ready, output, before);
});

test('real scene reentry resets velocity and grounded state without inventing a new jump edge', real, async t => {
  const f = await fixture(t);
  await f.edit('documents/scenes/demo.json', scene => { scene.actors[0].position[1] = 150; });
  await f.script('checkpoint', `extends Node
static var switched := false
func _physics_process(_delta: float) -> void:
\tvar step: int = get_parent().get_parent().get("physics_observation_step")
\tif not switched and step >= 10:
\t\tswitched = true
\t\tInput.action_press("ui_accept")
\t\tget_meta("viento_project").request_scene("${f.sceneIds[1]}")
`);
  await f.script('second', `extends Node\nfunc _ready() -> void:\n\tget_meta("viento_project").request_scene("${f.sceneIds[0]}")\n`);
  const ready = await captured(f), before = await hashes(f.author), output = await execute(ready, await stage(ready)), samples = output.snapshot.samples;
  assert.deepEqual([...new Set(samples.map(sample => sample.visitIndex))], [1, 3]);
  const initial = samples[0], reentry = samples.find(sample => sample.visitIndex === 3);
  assert.equal(reentry.stepIndex, 1); assert.deepEqual(reentry.requestedMotion, initial.requestedMotion);
  assert.equal(reentry.positionBefore[1], 150); assert.ok(samples.filter(sample => sample.visitIndex === 3).every(sample => sample.requestedMotion[1] > 0));
  assert.deepEqual(await hashes(f.author), before); record('scene-reentry', ready, output, before);
});

test('real live motion jumps and lands on the same physics clock without emitting smoke observations', real, async t => {
  const f = await fixture(t);
  await f.script('checkpoint', `extends Node
var ticks := 0
func _ready() -> void:
\tInput.action_press("ui_right")
func _physics_process(_delta: float) -> void:
\tticks += 1
\tprint("MOTION_TEST:" + JSON.stringify({"tick": ticks, "position": [get_parent().position.x, get_parent().position.y]}))
\tif ticks == 7:
\t\tInput.action_press("ui_accept")
\tif ticks == 8:
\t\tInput.action_release("ui_accept")
\tif ticks == 15:
\t\tInput.action_release("ui_right")
\tif ticks == 30:
\t\tget_tree().root.get_node("VientoProject").call_deferred("finish_project")
func _exit_tree() -> void:
\tInput.action_release("ui_right")
\tInput.action_release("ui_accept")
`);
  const ready = await captured(f), before = await hashes(f.author), output = await execute(ready, await stage(ready), { smoke: false });
  assert.equal(output.snapshot, undefined); assert.equal(output.result.stdout.includes('VIENTO_PHYSICS2D:'), false);
  const observed = output.result.stdout.split('\n').filter(line => line.startsWith('MOTION_TEST:')).map(line => JSON.parse(line.slice(12)));
  assert.ok(observed.some(sample => sample.position[1] < 176));
  const actor = exitActors(output.reader)[0]; assert.ok(Math.abs(actor.position[1] - 180) < .2); assert.ok(actor.position[0] >= 152 && actor.position[0] <= 164);
  assert.deepEqual(await hashes(f.author), before); record('live-no-smoke-observation', ready, output, before); evidence.at(-1).livePositions = observed;
});
test('real portable ZIP retains character motion and observation without original author or build paths', real, async t => {
  const f = await captured(await fixture(t, { jump: true })), before = await hashes(f.author), output = path.join(f.temporary, 'build');
  const built = await buildProject({ root: f.author, targetId: f.assemblyId, tool, output, backendRegistry: createExecutionBackendRegistry([frozenMotionAdapter]) });
  assert.equal(built.ok, true, JSON.stringify(built.record?.diagnostics || built));
  const inspection = () => inspectBackendProject({ buildDirectory: output, backendRegistry: createExecutionBackendRegistry([frozenMotionAdapter]) });
  const delivery = await planBackendProjectDelivery({ inspection: await inspection(), assertCurrent: inspection });
  const zip = path.join(f.temporary, 'character-motion.zip'); await writeExportZip(delivery, zip); await verifyBackendProjectDelivery(zip);
  const moved = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-physics-character-motion-relocated-')); t.after(() => fs.rm(moved, { recursive: true, force: true }));
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
  assert.ok(observed.snapshot.samples.some(sample => sample.requestedMotion[1] < -1));
  assert.ok(Math.abs(observed.snapshot.samples.at(-1).positionAfter[1] - 180) < .2);
  record('portable-relocation', f, observed, before);
  if (reportPath) { const destination = path.join(path.dirname(reportPath), 'character-motion.zip'); await fs.copyFile(zip, destination, fs.constants.COPYFILE_EXCL); evidence.at(-1).zip = { path: destination, sha256: hash(await fs.readFile(zip)) }; }
});

test('real window capture uses the same smoke observation clock and retains final trace', { ...real, skip: !tool || !capturePath ? 'Set VIENTO_GODOT_BIN and VIENTO_PHYSICS_MOTION_CAPTURE for native capture verification' : false }, async t => {
  const f = await captured(await fixture(t, { jump: true })), before = await hashes(f.author);
  const output = await execute(f, await stage(f), { mode: 'windowCapture', capture: capturePath });
  assert.equal(output.snapshot.samples.length, 30); assert.ok((await fs.stat(capturePath)).size > 100);
  assert.deepEqual(await hashes(f.author), before); record('window-capture', f, output, before);
});


