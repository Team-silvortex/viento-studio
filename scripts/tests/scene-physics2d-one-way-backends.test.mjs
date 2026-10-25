import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import yauzl from 'yauzl';
import { scenePhysics2DOneWayAuthor } from './helpers/scene-physics2d-one-way-author-fixture.mjs';
import { captureBuildSnapshot } from '../adapters/node-build-snapshot.mjs';
import { createExecutionBackendRegistry } from '../adapters/node-execution-backends.mjs';
import { buildProject } from '../adapters/node-project-build.mjs';
import { GODOT4_EXECUTION_ADAPTER as adapter } from '../backends/godot4-adapter.mjs';
import { generateGodotPhysicsCharacterEventsProject } from '../backends/godot4-physics-character-events.mjs';
import { generateGodotPhysicsOneWayProject, godotPhysicsOneWayAssemblyScripts } from '../backends/godot4-physics-one-way.mjs';
import { inspectBackendProject } from '../adapters/node-backend-project.mjs';
import { planBackendProjectDelivery, verifyBackendProjectDelivery } from '../adapters/node-backend-project-delivery.mjs';
import { writeExportZip } from '../lib/export-package.mjs';

const tool = process.env.VIENTO_GODOT_BIN;
const real = { skip: !tool ? 'Set VIENTO_GODOT_BIN for native observation verification' : false, timeout: 180000 };
const capturePath = process.env.VIENTO_PHYSICS_ONE_WAY_CAPTURE;
const reportPath = process.env.VIENTO_PHYSICS_ONE_WAY_REPORT;
const evidence = [];
const hash = value => createHash('sha256').update(value).digest('hex');
const id = n => `75757575-7575-4575-8575-${String(n).padStart(12, '0')}`;
test.after(async () => { if (reportPath) await fs.writeFile(reportPath, JSON.stringify({ format: 'viento-physics-one-way-proof', schemaVersion: 1, tool, cases: evidence }, null, 2) + '\n', { flag: 'wx' }); });
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
const frozenOneWayAdapter = { ...adapter, async generate(plan) {
  const generated = await generateGodotPhysicsOneWayProject(plan);
  return { ...generated, resourceFiles: new Map(generated.resourceFiles || generated.imageFiles), artifact: { kind: 'godot-project', entry: 'project.godot', requiresTool: true } };
} };
const frozenRegistry = () => createExecutionBackendRegistry([frozenOneWayAdapter]);
async function captured(f) {
  const captured = await captureBuildSnapshot(f.author, f.assemblyId);
  assert.equal(captured.ok, true, JSON.stringify(captured.diagnostics));
  return { ...f, captured, generated: await frozenOneWayAdapter.generate(captured.plan) };
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

const fixture = scenePhysics2DOneWayAuthor;
const capability = 'physics.one-way-platform2d';
const inventoryError = { errorCode: 'build_physics_one_way_invalid' };
function lowered(input) {
  const plan = structuredClone(input);
  plan.requiredCapabilities = plan.requiredCapabilities.filter(value => value !== capability);
  for (const scene of plan.scenes) {
    scene.requiredCapabilities = scene.requiredCapabilities.filter(value => value !== capability);
    if (scene.physics?.document.schemaVersion === 4) scene.physics.document.schemaVersion = 3;
    for (const body of scene.physics?.document.bodies || []) delete body.oneWay;
  }
  return plan;
}
function finalActor(output, f, visitIndex) {
  return output.reader.events.find(frame => frame.event === 'scene-exit' && (!visitIndex || frame.visitIndex === visitIndex)).actors.find(actor => actor.instanceId === f.instanceId);
}
function publications(output, f) { return output.reader.events.filter(frame => frame.event === 'event-publish' && frame.bindingId === f.publisherBindingId); }
function platformContacts(output, f) {
  return output.snapshot.samples.flatMap(sample => sample.contacts.filter(contact => contact.collider?.bodyId === f.platformBodyId).map(contact => ({ sample, contact })));
}
function landedOnPlatform(output, f) {
  const samples = output.snapshot.samples;
  assert.equal(samples.length, 30);
  assert.ok(samples.some(sample => sample.requestedMotion[1] < 0 && sample.positionBefore[1] > f.platformTop && sample.positionAfter[1] < f.platformTop));
  const contacts = platformContacts(output, f); assert.ok(contacts.length);
  assert.ok(contacts.every(({ sample, contact }) => sample.requestedMotion[1] >= 0 && contact.normal[1] < -.99));
  assert.ok(Math.abs(finalActor(output, f).position[1] - f.expectedLandingY) < .2);
  assert.deepEqual(publications(output, f).map(frame => frame.name), ['physics.landed', 'physics.jumped', 'physics.landed']);
}
function record(name, f, output, before) {
  evidence.push({ name, backend: f.generated.backend, tool: output.tool, samples: output.snapshot?.samples || [],
    publications: publications(output, f), audio: output.reader.events.filter(frame => frame.event === 'audio-command'),
    animation: output.reader.events.filter(frame => frame.event === 'animation-command'), finalActors: output.reader.events.filter(frame => frame.event === 'scene-exit').map(frame => ({ visitIndex: frame.visitIndex, actors: frame.actors })),
    authorFiles: Object.keys(before).length, authorSha256: hash(JSON.stringify(before)) });
}
const readyProbe = f => `extends Node
func _ready() -> void:
\tvar scene = get_parent().get_parent()
\tfor actor in scene.actors:
\t\tif actor["instanceId"] != "${f.platformInstanceId}":
\t\t\tcontinue
\t\tvar collision = actor["node"].get_node("VientoCollision")
\t\tprint("ONE_WAY_READY:" + JSON.stringify({"oneWay": collision.one_way_collision, "margin": collision.one_way_collision_margin, "offset": [collision.position.x, collision.position.y], "size": [collision.shape.size.x, collision.shape.size.y]}))
`;
const readyFacts = output => output.result.stdout.split('\n').filter(line => line.startsWith('ONE_WAY_READY:')).map(line => JSON.parse(line.slice(14)));

test('one-way generation preserves every prior output byte except the saved ready hook, source maps and project protocols', async t => {
  const f = await captured(await fixture(t)), before = structuredClone(f.captured.plan);
  const old = await generateGodotPhysicsCharacterEventsProject(lowered(f.captured.plan)), prefix = `scenes/${f.sceneIds[0]}/`;
  assert.equal(old.backend.version, '0.25.0'); assert.equal(f.generated.backend.version, '0.26.0');
  assert.equal(f.generated.backend.protocolVersion, old.backend.protocolVersion); assert.deepEqual(f.generated.sourceMap, old.sourceMap);
  assert.ok(f.generated.backend.capabilities.includes(capability)); assert.deepEqual(f.captured.plan, before);
  for (const [name, bytes] of old.files) assert.deepEqual(f.generated.files.get(name === prefix + 'runtime.gd' ? prefix + 'one-way-original.gd' : name), bytes, name);
  const runtime = f.generated.files.get(prefix + 'runtime.gd').toString();
  assert.equal(runtime.split('super._ready()').length, 2); assert.equal(runtime.split('physics-one-way-helper.gd').length, 2);
  assert.equal(runtime.split('\n')[0], old.files.get(prefix + 'runtime.gd').toString().split('\n')[0]);
  const helper = f.generated.files.get('physics-one-way-helper.gd').toString();
  assert.ok(!helper.includes('move_and_collide')); assert.ok(!helper.includes('publish_event')); assert.ok(!helper.includes('_process'));
  assert.equal(JSON.parse(f.generated.files.get(prefix + 'physics.json')).schemaVersion, 2);
  await assert.rejects(generateGodotPhysicsOneWayProject(f.captured.plan.scenes[0]), { errorCode: 'build_physics_requires_project' });
});

test('schema 4 with no one-way property delegates to exact legacy output without granting the new capability', async t => {
  const f = await fixture(t); await f.edit(f.physicsPath, document => { for (const body of document.bodies) delete body.oneWay; });
  const ready = await captured(f), { artifact, ...actual } = ready.generated;
  assert.deepEqual(actual, await generateGodotPhysicsCharacterEventsProject(lowered(ready.captured.plan)));
  assert.equal(actual.backend.version, '0.25.0'); assert.ok(!actual.backend.capabilities.includes(capability));
});

test('one-way inventory rejects missing, orphaned, mismatched and linked declarations while accepting old projects', async t => {
  const f = await captured(await fixture(t)), directory = await stage(f), scripts = await godotPhysicsOneWayAssemblyScripts(directory);
  for (const name of f.generated.files.keys()) if (name.endsWith('.gd')) assert.ok(scripts.includes(name), name);
  const prefix = `scenes/${f.sceneIds[0]}/`;
  for (const name of ['one-way-project.json', 'physics-one-way-helper.gd', prefix + 'one-way.json', prefix + 'one-way-original.gd']) {
    const file = path.join(directory, name), original = await fs.readFile(file);
    await fs.rm(file); await assert.rejects(godotPhysicsOneWayAssemblyScripts(directory), inventoryError);
    await fs.symlink(path.join(f.author, f.physicsPath), file); await assert.rejects(godotPhysicsOneWayAssemblyScripts(directory), inventoryError);
    await fs.rm(file); await fs.writeFile(file, original);
  }
  const manifestFile = path.join(directory, 'one-way-project.json'), manifest = await fs.readFile(manifestFile);
  for (const value of [{ ...JSON.parse(manifest), sceneIds: [] }, { ...JSON.parse(manifest), extra: true }, { ...JSON.parse(manifest), sceneIds: [f.sceneIds[1]] }]) {
    await fs.writeFile(manifestFile, JSON.stringify(value)); await assert.rejects(godotPhysicsOneWayAssemblyScripts(directory), inventoryError);
  }
  await fs.writeFile(manifestFile, manifest);
  const declarationFile = path.join(directory, prefix + 'one-way.json'), declaration = await fs.readFile(declarationFile);
  for (const mutation of [value => { value.bodies[0].oneWay.margin = 0; }, value => { value.bodies[0].oneWay.margin = 64.1; },
    value => { value.bodies[0].oneWay.extra = true; }, value => { value.bodies.push(value.bodies[0]); },
    value => { value.bodies[0].instanceId = f.instanceId; }, value => { value.sceneObjectId = f.sceneIds[1]; }]) {
    const value = JSON.parse(declaration); mutation(value); await fs.writeFile(declarationFile, JSON.stringify(value));
    await assert.rejects(godotPhysicsOneWayAssemblyScripts(directory), inventoryError);
  }
  await fs.writeFile(declarationFile, declaration);
  const runtime = path.join(directory, prefix + 'runtime.gd'), runtimeBytes = await fs.readFile(runtime);
  await fs.writeFile(runtime, runtimeBytes.toString().replace('one-way.json', 'missing.json'));
  await assert.rejects(godotPhysicsOneWayAssemblyScripts(directory), inventoryError); await fs.writeFile(runtime, runtimeBytes);
  const orphan = path.join(directory, `scenes/${f.sceneIds[1]}/one-way.json`); await fs.writeFile(orphan, declaration);
  await assert.rejects(godotPhysicsOneWayAssemblyScripts(directory), inventoryError); await fs.rm(orphan);
  const legacy = await stage(f, await generateGodotPhysicsCharacterEventsProject(lowered(f.captured.plan)));
  assert.ok(await godotPhysicsOneWayAssemblyScripts(legacy)); await fs.writeFile(path.join(legacy, 'one-way-project.json'), manifest);
  await assert.rejects(godotPhysicsOneWayAssemblyScripts(legacy), inventoryError);
});

for (const mode of ['default', 'offset', 'circle']) test(`real native one-way ${mode} passes upward then supports downward motion with unchanged jump/land facts`, real, async t => {
  const f = await fixture(t, { offset: mode === 'offset' ? [7, -3] : [0, 0], circle: mode === 'circle' });
  await f.script('checkpoint', readyProbe(f));
  const ready = await captured(f), before = await hashes(f.author), output = await execute(ready, await stage(ready), { scriptCheck: mode === 'default' });
  landedOnPlatform(output, f);
  assert.deepEqual(readyFacts(output), [{ oneWay: true, margin: 1, offset: mode === 'offset' ? [7, -3] : [0, 0], size: [180, 10] }]);
  assert.deepEqual(await hashes(f.author), before); record(mode, ready, output, before);
});

test('real solid control blocks the same upward motion and lands back on the lower floor', real, async t => {
  const f = await captured(await fixture(t, { enabled: false })), before = await hashes(f.author), output = await execute(f, await stage(f));
  assert.ok(platformContacts(output, f).some(({ sample, contact }) => sample.requestedMotion[1] < 0 && contact.normal[1] > .99));
  assert.ok(Math.abs(finalActor(output, f).position[1] - 180) < .2);
  assert.deepEqual(publications(output, f).map(frame => frame.name), ['physics.landed', 'physics.jumped', 'physics.landed']);
  assert.equal(f.generated.backend.version, '0.25.0'); assert.deepEqual(await hashes(f.author), before); record('solid-control', f, output, before);
});

test('real native margin upper bound is installed before author ready and supports a character descending from above', real, async t => {
  const f = await fixture(t, { margin: 64, jump: false });
  await f.edit('documents/scenes/demo.json', scene => { scene.actors[0].position[1] = 110; });
  await f.script('checkpoint', readyProbe(f));
  const ready = await captured(f), before = await hashes(f.author), output = await execute(ready, await stage(ready));
  assert.equal(readyFacts(output)[0].margin, 64); assert.ok(platformContacts(output, f).length);
  assert.ok(Math.abs(finalActor(output, f).position[1] - f.expectedLandingY) < .2);
  assert.deepEqual(publications(output, f).map(frame => frame.name), ['physics.landed']);
  assert.deepEqual(await hashes(f.author), before); record('margin-64-drop', ready, output, before);
});

test('real native one-way leaves collision masks intact and permits an excluded character to fall through', real, async t => {
  const f = await fixture(t);
  await f.edit(f.physicsPath, document => { const body = document.bodies.find(body => body.id === f.platformBodyId); body.layer = 4; body.mask = 0; });
  const ready = await captured(f), before = await hashes(f.author), output = await execute(ready, await stage(ready));
  assert.equal(platformContacts(output, f).length, 0);
  // At .5 seconds the excluded character center is below the platform,
  // but its longer flight has not yet reached the lower floor.
  assert.ok(finalActor(output, f).position[1] > f.platformTop + 10);
  assert.ok(output.snapshot.samples.at(-1).requestedMotion[1] > 0);
  assert.deepEqual(publications(output, f).map(frame => frame.name), ['physics.landed', 'physics.jumped']);
  assert.deepEqual(await hashes(f.author), before); record('mask-excluded', ready, output, before);
});

test('real native one-way supports the declared maximum fall speed at the fixed smoke step', real, async t => {
  const f = await fixture(t, { jump: false });
  await f.edit('documents/scenes/demo.json', scene => { scene.actors[0].position[1] = -500; scene.actors[0].controls = 'none'; });
  await f.edit(f.physicsPath, document => { document.bodies[0].characterMotion.gravity = 20000; document.bodies[0].characterMotion.maxFallSpeed = 4000; });
  const ready = await captured(f), before = await hashes(f.author), output = await execute(ready, await stage(ready));
  assert.ok(platformContacts(output, f).some(({ sample }) => sample.requestedMotion[1] > 60));
  assert.ok(Math.abs(finalActor(output, f).position[1] - f.expectedLandingY) < .2);
  assert.deepEqual(await hashes(f.author), before); record('maximum-fall-speed', ready, output, before);
});

for (const response of ['stop', 'slide']) test(`real native one-way supports an existing ${response} character without a gravity motor`, real, async t => {
  const f = await fixture(t, { jump: false });
  await f.edit('documents/scenes/demo.json', scene => { scene.actors[0].position[1] = 120; });
  await f.edit(f.physicsPath, document => { delete document.bodies[0].characterMotion; document.bodies[0].collisionResponse = response; });
  await f.edit(f.manifestPath, document => { document.bindings = document.bindings.filter(binding => binding.bindingId !== f.publisherBindingId); });
  await f.script('checkpoint', 'extends Node\nfunc _ready() -> void:\n\tInput.action_press("ui_down")\nfunc _exit_tree() -> void:\n\tInput.action_release("ui_down")\n');
  const ready = await captured(f), before = await hashes(f.author), output = await execute(ready, await stage(ready), { scriptCheck: response === 'stop' });
  assert.ok(!ready.generated.backend.capabilities.includes('physics.character-motion2d'));
  assert.ok(platformContacts(output, f).length); assert.ok(Math.abs(finalActor(output, f).position[1] - f.expectedLandingY) < .2);
  assert.deepEqual(await hashes(f.author), before); record('legacy-' + response, ready, output, before);
});

test('real one-way landing facts still drive ordinary project event animation and audio consumers', real, async t => {
  const f = await captured(await fixture(t, { consumers: true })), before = await hashes(f.author), output = await execute(f, await stage(f), { scriptCheck: true });
  landedOnPlatform(output, f); assert.equal(f.generated.backend.protocolVersion, 10);
  const entries = output.reader.projectEvents.entries.filter(entry => entry.origin.bindingId === f.publisherBindingId);
  assert.ok(entries.every(entry => entry.origin.source.sourcePath === f.manifestPath));
  assert.ok(entries.find(entry => entry.name === 'physics.jumped').deliveries.some(delivery => delivery.origin.bindingId === f.animationBindingId && delivery.status === 'handled'));
  assert.equal(output.reader.animationCompletions.sequence, 1);
  assert.equal(output.reader.events.filter(frame => frame.event === 'audio-command' && frame.bindingId === f.audioBindingId && frame.action === 'play').length, 2);
  assert.deepEqual(await hashes(f.author), before); record('project-event-media', f, output, before);
});

test('real scene reentry installs native one-way shapes for the new visit and keeps landing facts local', real, async t => {
  const f = await fixture(t);
  await f.script('checkpoint', readyProbe(f).replace('func _ready() -> void:', 'static var switched := false\nvar contacts := 0\nfunc _ready() -> void:') + `\tget_meta("viento_character_motion").landed.connect(_landed)
func _landed() -> void:
\tcontacts += 1
\tif contacts == 2 and not switched:
\t\tswitched = true
\t\tget_meta("viento_project").request_scene("${f.sceneIds[1]}")
`);
  await f.script('second', `extends Node\nfunc _ready() -> void:\n\tget_meta("viento_project").request_scene("${f.sceneIds[0]}")\n`);
  const ready = await captured(f), before = await hashes(f.author), output = await execute(ready, await stage(ready));
  assert.equal(readyFacts(output).length, 2); assert.ok(readyFacts(output).every(value => value.oneWay && value.margin === 1));
  assert.deepEqual(publications(output, f).map(frame => [frame.visitIndex, frame.name]), [[1, 'physics.landed'], [1, 'physics.jumped'], [1, 'physics.landed'], [3, 'physics.landed']]);
  assert.ok(Math.abs(finalActor(output, f, 1).position[1] - f.expectedLandingY) < .2);
  assert.deepEqual(await hashes(f.author), before); record('reentry', ready, output, before);
});

test('real live one-way gameplay and author events use native contacts without smoke tracing', real, async t => {
  const f = await captured(await fixture(t, { consumers: true, live: true })), before = await hashes(f.author), output = await execute(f, await stage(f), { smoke: false });
  assert.equal(output.snapshot, undefined); assert.equal(output.result.stdout.includes('VIENTO_PHYSICS2D:'), false);
  assert.ok(Math.abs(finalActor(output, f).position[1] - f.expectedLandingY) < .2);
  assert.deepEqual(publications(output, f).map(frame => frame.name), ['physics.landed', 'physics.jumped', 'physics.landed']);
  assert.equal(output.reader.events.filter(frame => frame.event === 'audio-command' && frame.bindingId === f.audioBindingId).length, 2);
  assert.deepEqual(await hashes(f.author), before); record('live-no-trace', f, output, before);
});

test('real portable ZIP retains native one-way contacts and media after original paths go offline', real, async t => {
  const f = await captured(await fixture(t, { consumers: true })), before = await hashes(f.author), output = path.join(f.temporary, 'build');
  const built = await buildProject({ root: f.author, targetId: f.assemblyId, tool, output, backendRegistry: frozenRegistry() });
  assert.equal(built.ok, true, JSON.stringify(built.record?.diagnostics || built));
  const inspection = () => inspectBackendProject({ buildDirectory: output, backendRegistry: frozenRegistry() });
  const delivery = await planBackendProjectDelivery({ inspection: await inspection(), assertCurrent: inspection });
  const zip = path.join(f.temporary, 'one-way.zip'); await writeExportZip(delivery, zip); await verifyBackendProjectDelivery(zip);
  const moved = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-physics-one-way-relocated-')); t.after(() => fs.rm(moved, { recursive: true, force: true }));
  const archive = await yauzl.openPromise(zip, { lazyEntries: true, autoClose: false });
  try { for await (const entry of archive.eachEntry()) {
    assert.ok(!entry.fileName.startsWith('/') && !entry.fileName.split('/').includes('..'));
    const chunks = []; for await (const chunk of await archive.openReadStreamPromise(entry)) chunks.push(chunk);
    const file = path.join(moved, entry.fileName); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, Buffer.concat(chunks));
  } } finally { await new Promise(resolve => { archive.reader.once('close', resolve); archive.close(); }); }
  assert.deepEqual(await hashes(f.author), before);
  await fs.rename(f.author, f.author + '.offline'); await fs.rename(output, output + '.offline');
  const observed = await execute(f, path.join(moved, 'project'), { scriptCheck: true });
  landedOnPlatform(observed, f); assert.equal(observed.reader.animationCompletions.sequence, 1);
  assert.equal(observed.reader.events.filter(frame => frame.event === 'audio-command' && frame.bindingId === f.audioBindingId).length, 2);
  record('portable-relocation', f, observed, before);
  if (reportPath) { const destination = path.join(path.dirname(reportPath), 'one-way.zip'); await fs.copyFile(zip, destination, fs.constants.COPYFILE_EXCL); evidence.at(-1).zip = { path: destination, sha256: hash(await fs.readFile(zip)) }; }
});

test('real native window capture retains the same one-way observation and event result', { ...real, skip: !tool || !capturePath ? 'Set VIENTO_GODOT_BIN and VIENTO_PHYSICS_ONE_WAY_CAPTURE for native capture verification' : false }, async t => {
  const f = await captured(await fixture(t, { consumers: true })), before = await hashes(f.author), output = await execute(f, await stage(f), { mode: 'windowCapture', capture: capturePath });
  landedOnPlatform(output, f); assert.ok((await fs.stat(capturePath)).size > 100);
  assert.deepEqual(await hashes(f.author), before); record('window-capture', f, output, before);
});
