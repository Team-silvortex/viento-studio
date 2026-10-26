import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import yauzl from 'yauzl';
import { scenePhysics2DDropThroughAuthor } from './helpers/scene-physics2d-drop-through-author-fixture.mjs';
import { captureBuildSnapshot } from '../adapters/node-build-snapshot.mjs';
import { buildProject } from '../adapters/node-project-build.mjs';
import { GODOT4_EXECUTION_ADAPTER as adapter } from '../backends/godot4-adapter.mjs';
import { generateGodotPhysicsMovementContactsProject } from '../backends/godot4-physics-movement-contacts.mjs';
import { inspectBackendProject } from '../adapters/node-backend-project.mjs';
import { planBackendProjectDelivery, verifyBackendProjectDelivery } from '../adapters/node-backend-project-delivery.mjs';
import { writeExportZip } from '../lib/export-package.mjs';

const tool = process.env.VIENTO_GODOT_BIN;
const real = { skip: !tool ? 'Set VIENTO_GODOT_BIN for native observation verification' : false, timeout: 180000 };
const capturePath = process.env.VIENTO_PHYSICS_DROP_THROUGH_CAPTURE;
const reportPath = process.env.VIENTO_PHYSICS_DROP_THROUGH_REPORT;
const evidence = [];
const hash = value => createHash('sha256').update(value).digest('hex');
const id = n => `80808080-8080-4080-8080-${String(n).padStart(12, '0')}`;
test.after(async () => { if (reportPath) await fs.writeFile(reportPath, JSON.stringify({ format: 'viento-physics-drop-through-proof', schemaVersion: 1, tool, cases: evidence }, null, 2) + '\n', { flag: 'wx' }); });
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
  if (reportPath) await fs.appendFile(reportPath.replace(/\.json$/, '-stdout.log'), result.stdout + result.stderr + '\n');
  assert.equal(result.status, 'succeeded', result.stdout + result.stderr);
  assert.deepEqual(adapter.diagnostics(result, f.captured.plan), [], result.stdout + result.stderr);
  const reader = adapter.createEventReader(f.captured.plan, { smoke, capabilities: generated.backend.capabilities });
  reader.push(result.stdout); const ended = reader.finish(); assert.deepEqual(ended.diagnostics, [], result.stdout);
  const snapshot = reader.snapshot?.();
  if (snapshot) assert.equal(snapshot.phase, 'finished');
  return { result, reader, snapshot, tool: identified };
}

const fixture = scenePhysics2DDropThroughAuthor;
const capability = 'physics.character-drop-through2d';
function exitActors(output, visitIndex) { return output.reader.events.find(frame => frame.event === 'scene-exit' && (!visitIndex || frame.visitIndex === visitIndex)).actors; }
function publications(output, bindingId) { return output.reader.events.filter(frame => frame.event === 'event-publish' && (!bindingId || frame.bindingId === bindingId)); }
function facts(output, tag = 'DROP_PROBE:') { return output.result.stdout.split('\n').filter(line => line.startsWith(tag)).map(line => JSON.parse(line.slice(tag.length))); }
function samples(output, f) { return output.snapshot.samples.filter(sample => sample.instanceId === f.instanceId); }
function record(name, f, output, before) {
  evidence.push({ name, backend: f.generated.backend, tool: output.tool, samples: output.snapshot?.samples || [], probes: facts(output), requests: facts(output, 'DROP_REQUEST:'),
    publications: publications(output), audio: output.reader.events.filter(frame => frame.event === 'audio-command'), animation: output.reader.events.filter(frame => frame.event === 'animation-command'),
    finalActors: output.reader.events.filter(frame => frame.event === 'scene-exit').map(frame => ({ visitIndex: frame.visitIndex, actors: frame.actors })),
    authorFiles: Object.keys(before).length, authorSha256: hash(JSON.stringify(before)) });
}
async function probe(f, { ready = '', step = '', exit = '', removeStarter = false, instanceId = f.instanceId } = {}) {
  if (removeStarter) await f.edit(f.manifestPath, document => { document.bindings = document.bindings.filter(binding => binding.bindingId !== f.dropBindingId); });
  await f.addBehavior(id(1), id(2), 'drop-probe', `extends Node
var ticks := -1
var owner_body: CharacterBody2D
var platform_body: StaticBody2D
var floor_body: StaticBody2D
var port
func _ready() -> void:
\tvar scene = get_parent().get_parent()
\tfor actor in scene.actors:
\t\tif actor["instanceId"] == "${instanceId}":
\t\t\towner_body = actor["node"]
\t\tif actor["instanceId"] == "${f.platformInstanceId}":
\t\t\tplatform_body = actor["node"]
\t\tif actor["instanceId"] == "${f.wallInstanceId}":
\t\t\tfloor_body = actor["node"]
\tport = get_meta("viento_character_drop") if has_meta("viento_character_drop") else null
\tprint("DROP_READY:" + JSON.stringify({"present": port != null, "version": port.protocol_version() if port != null else 0}))
${ready || '\tpass'}
func _physics_process(_delta: float) -> void:
\tvar scene = get_parent().get_parent()
\tvar tick: int = scene.get("physics_observation_step")
\tif tick == ticks:
\t\treturn
\tticks = tick
${step || '\tpass'}
\tvar exceptions: Array = []
\tfor body in owner_body.get_collision_exceptions():
\t\texceptions.append("platform" if body == platform_body else "floor" if body == floor_body else "other")
\tprint("DROP_PROBE:" + JSON.stringify({"step": ticks, "position": [owner_body.position.x, owner_body.position.y], "exceptions": exceptions, "grounded": scene.character_motion_grounded.get("${instanceId}", false)}))
func _exit_tree() -> void:
\tprint("DROP_EXIT:" + JSON.stringify({"request": port.request_drop() if port != null else false, "exceptions": owner_body.get_collision_exceptions().size() if is_instance_valid(owner_body) else -1}))
${exit || '\tpass'}
`, {}, instanceId);
}
function dropped(output, f, { stationary = true } = {}) {
  assert.equal(f.generated.backend.version, '0.29.0'); assert.ok(f.generated.backend.capabilities.includes(capability));
  assert.equal(output.snapshot.samples.length, 60);
  const mine = samples(output, f), other = output.snapshot.samples.filter(sample => sample.instanceId === f.otherInstanceId);
  assert.equal(mine.length, 30); assert.equal(other.length, 30);
  assert.ok(mine.some(sample => sample.contacts.some(contact => contact.collider?.bodyId === f.platformBodyId)));
  assert.ok(mine.some(sample => sample.positionBefore[1] < f.platformTop && sample.positionAfter[1] > f.platformTop));
  assert.ok(mine.some(sample => sample.contacts.some(contact => contact.collider?.instanceId === f.wallInstanceId)));
  assert.ok(Math.abs(exitActors(output)[0].position[1] - f.expectedLandingY) < .2);
  assert.ok(Math.abs(exitActors(output).find(actor => actor.instanceId === f.otherInstanceId).position[1] - f.expectedSupportY) < .2);
  if (stationary) assert.ok(mine.every(sample => Math.abs(sample.positionBefore[0] - sample.positionAfter[0]) < .0001));
  assert.deepEqual(publications(output, f.publisherBindingId).map(frame => frame.name), ['physics.landed', 'physics.landed']);
  assert.deepEqual(publications(output, f.contactBindingId).map(frame => frame.name), ['physics.contact_started', 'physics.contact_ended']);
}

for (const shape of ['box', 'circle-offset']) test(`real ${shape} one-way drop isolates repeated-definition instances and preserves native landing media`, real, async t => {
  const raw = await fixture(t, { circle: shape === 'circle-offset', offset: shape === 'circle-offset' ? [7, -3] : [0, 0] });
  await probe(raw); const f = await captured(raw), before = await hashes(f.author), output = await execute(f, await stage(f), { scriptCheck: true });
  dropped(output, f); assert.deepEqual(facts(output, 'DROP_READY:'), [{ present: true, version: 1 }]);
  const observed = facts(output); assert.ok(observed.some(row => row.exceptions.includes('platform')));
  assert.deepEqual(observed.at(-1).exceptions, []); assert.deepEqual(facts(output, 'DROP_EXIT:'), [{ request: false, exceptions: 0 }]);
  assert.ok(output.reader.animationCompletions.sequence >= 1);
  assert.equal(output.reader.events.filter(frame => frame.event === 'audio-command' && frame.bindingId === f.audioBindingId && frame.action === 'play').length, 2);
  assert.deepEqual(await hashes(f.author), before); record(shape + '-drop-media', f, output, before);
});

test('real queued requests reject duplicates and held input cannot drop the stationary second instance', real, async t => {
  const raw = await fixture(t, { drop: false });
  await probe(raw, { removeStarter: true, step: '\tif ticks == 6:\n\t\tprint("DROP_REQUEST:" + JSON.stringify({"step": ticks, "first": port.request_drop(), "duplicate": port.request_drop()}))\n\tif ticks == 7 or ticks == 8:\n\t\tprint("DROP_REQUEST:" + JSON.stringify({"step": ticks, "during": port.request_drop()}))' });
  const f = await captured(raw), before = await hashes(f.author), output = await execute(f, await stage(f));
  dropped(output, f); assert.deepEqual(facts(output, 'DROP_REQUEST:'), [{ step: 6, first: true, duplicate: false }, { step: 7, during: false }, { step: 8, during: false }]);
  assert.deepEqual(await hashes(f.author), before); record('queued-duplicate-request', f, output, before);
});

for (const target of ['air', 'solid']) test(`real drop request rejects ${target} without changing movement or native exceptions`, real, async t => {
  const raw = await fixture(t, { drop: false, consumers: false });
  if (target === 'air') await raw.edit('documents/scenes/demo.json', scene => { scene.actors[0].position[1] = 80; });
  else await raw.edit(raw.physicsPath, document => { delete document.bodies.find(body => body.id === raw.platformBodyId).oneWay; document.bodies[2].oneWay = { margin: 1 }; });
  await probe(raw, { removeStarter: true, step: `\tif ticks == ${target === 'air' ? 1 : 6}:\n\t\tprint("DROP_REQUEST:" + JSON.stringify({"accepted": port.request_drop()}))` });
  const f = await captured(raw), before = await hashes(f.author), output = await execute(f, await stage(f));
  assert.deepEqual(facts(output, 'DROP_REQUEST:'), [{ accepted: false }]); assert.ok(facts(output).every(row => row.exceptions.length === 0));
  assert.ok(Math.abs(exitActors(output)[0].position[1] - f.expectedSupportY) < .2);
  assert.deepEqual(await hashes(f.author), before); record(target + '-reject', f, output, before);
});

test('real queued drop precedes a jump edge without adding velocity or a second integration', real, async t => {
  const raw = await fixture(t, { drop: false });
  await probe(raw, { removeStarter: true, step: '\tif ticks == 6:\n\t\tprint("DROP_REQUEST:" + JSON.stringify({"accepted": port.request_drop()}))\n\t\tInput.action_press("ui_accept")\n\tif ticks == 7:\n\t\tInput.action_release("ui_accept")', exit: '\tInput.action_release("ui_accept")' });
  const f = await captured(raw), before = await hashes(f.author), output = await execute(f, await stage(f));
  dropped(output, f); assert.deepEqual(facts(output, 'DROP_REQUEST:'), [{ accepted: true }]);
  assert.ok(samples(output, f).every(sample => sample.requestedMotion[1] >= 0));
  const falling = samples(output, f).filter(sample => sample.contacts.length === 0);
  assert.ok(falling.length > 4);
  for (const sample of falling) assert.ok(Math.abs(sample.positionAfter[1] - sample.positionBefore[1] - sample.requestedMotion[1]) < .0001);
  assert.deepEqual(await hashes(f.author), before); record('drop-before-jump-single-solve', f, output, before);
});

test('real low gravity keeps its owned exception while the complete offset shape still overlaps the platform', real, async t => {
  const raw = await fixture(t, { gravity: 20, consumers: false, offset: [3, -2], drop: false });
  await raw.edit('documents/scenes/demo.json', scene => { scene.actors[0].position[1] = raw.expectedSupportY; scene.actors.find(actor => actor.instanceId === raw.otherInstanceId).position[1] = raw.expectedSupportY; });
  await probe(raw, { removeStarter: true, step: `\tif scene.character_motion_grounded.get("${raw.instanceId}", false) and not owner_body.has_meta("drop_test_requested"):\n\t\towner_body.set_meta("drop_test_requested", true)\n\t\tprint("DROP_REQUEST:" + JSON.stringify({"accepted": port.request_drop()}))` });
  const f = await captured(raw), before = await hashes(f.author), output = await execute(f, await stage(f));
  assert.deepEqual(facts(output, 'DROP_REQUEST:'), [{ accepted: true }]);
  assert.ok(facts(output).at(-1).exceptions.includes('platform')); assert.ok(exitActors(output)[0].position[1] < raw.platformTop + 10);
  assert.deepEqual(facts(output, 'DROP_EXIT:'), [{ request: false, exceptions: 0 }]);
  assert.deepEqual(await hashes(f.author), before); record('low-gravity-no-timeout', f, output, before);
});

test('real owned drop cleanup preserves a pre-existing author collision exception', real, async t => {
  const raw = await fixture(t, { consumers: false });
  await probe(raw, { ready: '\towner_body.add_collision_exception_with(floor_body)' });
  const f = await captured(raw), before = await hashes(f.author), output = await execute(f, await stage(f));
  const observed = facts(output); assert.ok(observed.some(row => row.exceptions.includes('platform') && row.exceptions.includes('floor')));
  assert.deepEqual(observed.at(-1).exceptions, ['floor']); assert.deepEqual(facts(output, 'DROP_EXIT:'), [{ request: false, exceptions: 1 }]);
  assert.ok(exitActors(output)[0].position[1] > f.expectedLandingY + 5);
  assert.deepEqual(await hashes(f.author), before); record('pre-existing-exception-preserved', f, output, before);
});

for (const situation of ['wide-margin', 'near-solid']) test(`real ${situation} keeps the exception until complete shapes separate and always revokes it on close`, real, async t => {
  const raw = await fixture(t, { margin: situation === 'wide-margin' ? 64 : 1, consumers: false });
  if (situation === 'near-solid') await raw.edit('documents/scenes/demo.json', scene => { scene.actors[2].position[1] = 185; });
  await probe(raw); const f = await captured(raw), before = await hashes(f.author), output = await execute(f, await stage(f));
  assert.ok(facts(output).at(-1).exceptions.includes('platform'));
  const expected = situation === 'near-solid' ? 165 : f.expectedLandingY;
  assert.ok(Math.abs(exitActors(output)[0].position[1] - expected) < .2);
  assert.deepEqual(facts(output, 'DROP_EXIT:'), [{ request: false, exceptions: 0 }]);
  assert.deepEqual(await hashes(f.author), before); record(situation + '-shape-separation', f, output, before);
});

test('real adjacent solid support remains active when a request ignores only the native reported one-way support', real, async t => {
  const raw = await fixture(t, { drop: false, consumers: false }), instanceId = id(10), bodyId = id(11);
  await raw.edit('documents/scenes/demo.json', scene => {
    const platform = scene.actors.find(actor => actor.instanceId === raw.platformInstanceId); platform.position[0] = 50; platform.size[0] = 100;
    scene.actors.push({ ...structuredClone(platform), instanceId, position: [150, 160], size: [100, 10] });
  });
  await raw.edit(raw.physicsPath, document => {
    const platform = document.bodies.find(body => body.id === raw.platformBodyId); platform.shape.size[0] = 100;
    const solid = { ...structuredClone(platform), id: bodyId, instanceId }; delete solid.oneWay; document.bodies.push(solid);
  });
  await probe(raw, { removeStarter: true, step: '\tif ticks == 6:\n\t\tprint("DROP_REQUEST:" + JSON.stringify({"accepted": port.request_drop()}))' });
  const f = await captured(raw), before = await hashes(f.author), output = await execute(f, await stage(f));
  assert.ok(Math.abs(exitActors(output)[0].position[1] - raw.expectedSupportY) < .2);
  assert.ok(samples(output, f).some(sample => sample.contacts.some(contact => contact.collider?.bodyId === bodyId)));
  assert.ok(facts(output).every(row => row.exceptions.every(value => value === 'platform')));
  // Native slide may report a single floor because the vertical remainder is
  // exhausted at its first hit. In that case the untouched solid still blocks.
  const beforeRequest = samples(output, f).filter(sample => sample.stepIndex <= 6).at(-1);
  const hasSolid = beforeRequest.contacts.some(contact => contact.normal[1] <= -.7 && contact.collider?.bodyId === bodyId);
  if (hasSolid) assert.deepEqual(facts(output, 'DROP_REQUEST:'), [{ accepted: false }]);
  assert.deepEqual(await hashes(f.author), before); record('native-adjacent-solid-support', f, output, before);
});

test('real no-request project preserves the exact previous native movement samples and events', real, async t => {
  const raw = await fixture(t, { drop: false });
  await raw.edit(raw.manifestPath, document => { document.bindings = document.bindings.filter(binding => binding.bindingId !== raw.dropBindingId); });
  const f = await captured(raw), before = await hashes(f.author), output = await execute(f, await stage(f));
  const legacy = await generateGodotPhysicsMovementContactsProject(f.captured.plan);
  const previous = await execute(f, await stage(f, legacy), { generated: legacy });
  assert.deepEqual(output.snapshot.samples, previous.snapshot.samples); assert.deepEqual(exitActors(output), exitActors(previous));
  assert.deepEqual(publications(output), publications(previous)); assert.deepEqual(await hashes(f.author), before); record('no-request-exact-legacy-solve', f, output, before);
});

test('real sensor static and planar bindings receive no drop capability while the motor port remains scoped', real, async t => {
  const raw = await fixture(t, { drop: false, consumers: false });
  await raw.edit(raw.physicsPath, document => { delete document.bodies.find(body => body.id === raw.otherBodyId).characterMotion; });
  await raw.addBehavior(id(30), id(31), 'non-motor', `extends Node
func _ready() -> void:
\tprint("DROP_NON_MOTOR:" + JSON.stringify({"present": has_meta("viento_character_drop")}))
`, {}, raw.sensorInstanceId);
  await raw.edit(raw.manifestPath, document => {
    const prototype = document.bindings.find(binding => binding.bindingId === id(31));
    for (const [index, instanceId] of [raw.platformInstanceId, raw.otherInstanceId].entries()) document.bindings.push({ ...structuredClone(prototype), bindingId: id(32 + index), instanceId });
  });
  await probe(raw); const f = await captured(raw), before = await hashes(f.author), output = await execute(f, await stage(f));
  assert.deepEqual(facts(output, 'DROP_NON_MOTOR:').map(row => row.present), [false, false, false]); assert.deepEqual(facts(output, 'DROP_READY:'), [{ present: true, version: 1 }]);
  assert.deepEqual(await hashes(f.author), before); record('non-motor-no-port', f, output, before);
});

test('real scene reentry revokes owned pairs and stale ports before new visit author ready', real, async t => {
  const raw = await fixture(t, { drop: false, consumers: false });
  await probe(raw, { removeStarter: true, ready: '\tif prior_port != null:\n\t\tprint("DROP_STALE:" + JSON.stringify({"different": prior_port != port, "request": prior_port.request_drop()}))\n\tprior_port = port',
    step: `\tif ticks == 6 and not switched:\n\t\tprint("DROP_REQUEST:" + JSON.stringify({"accepted": port.request_drop()}))\n\tif not switched and owner_body.get_collision_exceptions().has(platform_body):\n\t\tswitched = true\n\t\tget_meta("viento_project").request_scene("${raw.sceneIds[1]}")` });
  const content = await fs.readFile(path.join(raw.author, 'documents/scripts/drop-probe.txt'), 'utf8');
  await raw.script('drop-probe', content.replace('var ticks := -1', 'static var prior_port\nstatic var switched := false\nvar ticks := -1'));
  await raw.script('second', `extends Node\nfunc _ready() -> void:\n\tget_meta("viento_project").request_scene("${raw.sceneIds[0]}")\n`);
  const f = await captured(raw), before = await hashes(f.author), output = await execute(f, await stage(f));
  assert.deepEqual(facts(output, 'DROP_STALE:'), [{ different: true, request: false }]);
  assert.equal(facts(output, 'DROP_EXIT:').length, 2); assert.ok(facts(output, 'DROP_EXIT:').every(row => !row.request && row.exceptions === 0));
  assert.deepEqual(publications(output, f.publisherBindingId).map(frame => [frame.visitIndex, frame.name]), [[1, 'physics.landed'], [3, 'physics.landed']]);
  assert.deepEqual(await hashes(f.author), before); record('reentry-old-port-revoked', f, output, before);
});

test('real live drop and landing media use native physics without smoke tracing', real, async t => {
  const f = await captured(await fixture(t, { live: true })), before = await hashes(f.author), output = await execute(f, await stage(f), { smoke: false });
  assert.equal(output.snapshot, undefined); assert.equal(output.result.stdout.includes('VIENTO_PHYSICS2D:'), false);
  assert.ok(Math.abs(exitActors(output)[0].position[1] - f.expectedLandingY) < .2);
  assert.ok(Math.abs(exitActors(output).find(actor => actor.instanceId === f.otherInstanceId).position[1] - f.expectedSupportY) < .2);
  assert.deepEqual(publications(output, f.publisherBindingId).map(frame => frame.name), ['physics.landed', 'physics.landed']);
  assert.equal(output.reader.events.filter(frame => frame.event === 'audio-command' && frame.bindingId === f.audioBindingId && frame.action === 'play').length, 2);
  assert.deepEqual(await hashes(f.author), before); record('live-no-trace', f, output, before);
});

test('real portable ZIP retains scoped drop and landing media after original paths go offline', real, async t => {
  const f = await captured(await fixture(t)), before = await hashes(f.author), output = path.join(f.temporary, 'build');
  const built = await buildProject({ root: f.author, targetId: f.assemblyId, tool, output });
  assert.equal(built.ok, true, JSON.stringify(built.record?.diagnostics || built));
  const inspection = () => inspectBackendProject({ buildDirectory: output });
  const delivery = await planBackendProjectDelivery({ inspection: await inspection(), assertCurrent: inspection });
  const zip = path.join(f.temporary, 'drop-through.zip'); await writeExportZip(delivery, zip); await verifyBackendProjectDelivery(zip);
  const moved = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-physics-drop-through-relocated-')); t.after(() => fs.rm(moved, { recursive: true, force: true }));
  const archive = await yauzl.openPromise(zip, { lazyEntries: true, autoClose: false });
  try { for await (const entry of archive.eachEntry()) {
    assert.ok(!entry.fileName.startsWith('/') && !entry.fileName.split('/').includes('..'));
    const chunks = []; for await (const chunk of await archive.openReadStreamPromise(entry)) chunks.push(chunk);
    const file = path.join(moved, entry.fileName); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, Buffer.concat(chunks));
  } } finally { await new Promise(resolve => { archive.reader.once('close', resolve); archive.close(); }); }
  assert.deepEqual(await hashes(f.author), before);
  await fs.rename(f.author, f.author + '.offline'); await fs.rename(output, output + '.offline');
  const observed = await execute(f, path.join(moved, 'project'), { scriptCheck: true }); dropped(observed, f);
  assert.ok(observed.reader.animationCompletions.sequence >= 1); assert.equal(observed.reader.events.filter(frame => frame.event === 'audio-command' && frame.bindingId === f.audioBindingId).length, 2);
  record('portable-relocation', f, observed, before);
  if (reportPath) { const destination = path.join(path.dirname(reportPath), path.basename(reportPath, '.json') + '-drop-through.zip'); await fs.copyFile(zip, destination, fs.constants.COPYFILE_EXCL); evidence.at(-1).zip = { path: destination, sha256: hash(await fs.readFile(zip)) }; }
});

test('real native window capture retains the same drop landing and isolated second character', { ...real, skip: !tool || !capturePath ? 'Set VIENTO_GODOT_BIN and VIENTO_PHYSICS_DROP_THROUGH_CAPTURE for native capture verification' : false }, async t => {
  const f = await captured(await fixture(t)), before = await hashes(f.author), output = await execute(f, await stage(f), { mode: 'windowCapture', capture: capturePath });
  dropped(output, f); assert.ok((await fs.stat(capturePath)).size > 100);
  assert.deepEqual(await hashes(f.author), before); record('window-capture', f, output, before);
});

test('real pre-existing exception for the supporting platform is never claimed or removed by a drop request', real, async t => {
  const raw = await fixture(t, { consumers: false, drop: false });
  await probe(raw, { removeStarter: true, step: '\tif ticks == 6:\n\t\towner_body.add_collision_exception_with(platform_body)\n\t\tprint("DROP_REQUEST:" + JSON.stringify({"accepted": port.request_drop()}))' });
  const f = await captured(raw), before = await hashes(f.author), output = await execute(f, await stage(f));
  assert.deepEqual(facts(output, 'DROP_REQUEST:'), [{ accepted: false }]); assert.deepEqual(facts(output).at(-1).exceptions, ['platform']);
  assert.deepEqual(facts(output, 'DROP_EXIT:'), [{ request: false, exceptions: 1 }]);
  assert.ok(Math.abs(exitActors(output)[0].position[1] - f.expectedLandingY) < .2);
  assert.deepEqual(await hashes(f.author), before); record('pre-existing-platform-exception-reject', f, output, before);
});

test('real held input drops one platform and remains on the next one-way support without a second edge', real, async t => {
  const raw = await fixture(t);
  await raw.edit(raw.physicsPath, document => { document.bodies[2].oneWay = { margin: 1 }; });
  const driver = await fs.readFile(path.join(raw.author, 'documents/scripts/motion-input.txt'), 'utf8');
  await raw.script('motion-input', driver.replace('ticks == 14', 'ticks == 40'));
  await probe(raw); const f = await captured(raw), before = await hashes(f.author), output = await execute(f, await stage(f));
  dropped(output, f); assert.deepEqual(facts(output).at(-1).exceptions, []);
  assert.ok(samples(output, f).slice(-5).every(sample => sample.contacts.some(contact => contact.collider?.instanceId === f.wallInstanceId)));
  assert.deepEqual(await hashes(f.author), before); record('held-input-no-second-platform-drop', f, output, before);
});
