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
import { generateGodotPhysicsCharacterIntentProject } from '../backends/godot4-physics-character-intent.mjs';
import { scenePhysics2DPlatformVerticalAuthor } from './helpers/scene-physics2d-platform-vertical-author-fixture.mjs';
const tool = process.env.VIENTO_GODOT_BIN;
const native = { skip: !tool ? 'Set VIENTO_GODOT_BIN for native vertical platform verification' : false, timeout: 180000 };
const id = n => `92929292-9292-4292-8292-${String(n).padStart(12, '0')}`;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const evidence = [];
const report = process.env.VIENTO_PHYSICS_PLATFORM_VERTICAL_REPORT;
test.after(async () => { if (report) await fs.writeFile(report, JSON.stringify({ format: 'viento-vertical-platform-proof', schemaVersion: 1, tool, cases: evidence }, null, 2) + '\n'); });
async function authorHashes(directory, prefix = '') {
  const output = {};
  for (const row of await fs.readdir(path.join(directory, prefix), { withFileTypes: true })) {
    const name = prefix ? `${prefix}/${row.name}` : row.name;
    if (row.isDirectory()) Object.assign(output, await authorHashes(directory, name));
    else { assert.ok(row.isFile()); output[name] = hash(await fs.readFile(path.join(directory, name))); }
  }
  return output;
}
async function probe(f, code = '') {
  await f.addBehavior(id(1), id(2), 'vertical-probe', `extends Node
var ticks := -1
func _ready() -> void:
\tvar port = get_meta("viento_platform_events")
\tport.origin_reached.connect(endpoint.bind("origin"))
\tport.destination_reached.connect(endpoint.bind("destination"))
func endpoint(name: String) -> void:
\tprint("VERTICAL_ENDPOINT:" + JSON.stringify({"name":name,"step":get_parent().get_parent().physics_observation_step}))
func _physics_process(_delta: float) -> void:
\tvar scene = get_parent().get_parent()
\tvar tick: int = scene.physics_observation_step
\tif ticks == tick:
\t\treturn
\tticks = tick
${code || '\tpass'}
\tvar rows := []
\tfor actor in scene.actors:
\t\tif actor["instanceId"] in ["${f.instanceId}","${f.otherInstanceId}","${f.platformInstanceId}","${f.stationaryInstanceId}"]:
\t\t\trows.append({"id":actor["instanceId"],"position":[actor["node"].position.x,actor["node"].position.y],"grounded":scene.character_motion_grounded.get(actor["instanceId"],false) if scene.get("character_motion_grounded") is Dictionary else false})
\tprint("VERTICAL_PROBE:" + JSON.stringify({"step":ticks,"actors":rows,"phase":scene.platform_motion.platforms["${f.platformInstanceId}"]["phase"]}))
`, {}, f.platformInstanceId);
}
async function captured(f) {
  const captured = await captureBuildSnapshot(f.author, f.assemblyId);
  assert.equal(captured.ok, true, JSON.stringify(captured.diagnostics));
  const before = structuredClone(captured.plan), generated = await adapter.generate(captured.plan);
  assert.deepEqual(captured.plan, before);
  return { ...f, captured, generated };
}
async function stage(f) {
  const directory = await fs.mkdtemp(path.join(f.temporary, 'vertical-staged-'));
  const files = [...f.generated.files, ...[...(f.generated.resourceFiles || [])].map(([id, name]) => [name, f.captured.resources.get(id)])];
  for (const [name, bytes] of files) { const file = path.join(directory, name); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, bytes); }
  return directory;
}
async function execute(f, directory, { scriptCheck = false, backend = f.generated.backend, mode = 'headlessLogic', capturePath } = {}) {
  const identified = await adapter.identify(tool);
  for (const phase of scriptCheck ? adapter.buildPhases : adapter.runtimePhases) {
    const phaseResult = await adapter.executePhase({ phase, directory, tool: identified, timeoutMs: 60000 });
    assert.equal(phaseResult.status, 'succeeded', phaseResult.stdout + phaseResult.stderr);
    assert.deepEqual(adapter.diagnostics(phaseResult, f.captured.plan), [], phaseResult.stdout + phaseResult.stderr);
  }
  const result = await adapter.executePhase({ phase: 'run', directory, tool: identified, timeoutMs: 60000, mode, ...(capturePath ? { capturePath } : {}) });
  if (report) await fs.appendFile(report.replace(/\.json$/, '-stdout.log'), result.stdout + result.stderr + '\n');
  assert.equal(result.status, 'succeeded', result.stdout + result.stderr);
  assert.deepEqual(adapter.diagnostics(result, f.captured.plan), [], result.stdout + result.stderr);
  const reader = adapter.createEventReader(f.captured.plan, { smoke: true, capabilities: backend.capabilities });
  reader.push(result.stdout); assert.deepEqual(reader.finish().diagnostics, [], result.stdout);
  const trace = reader.snapshot(); assert.equal(trace.phase, 'finished');
  const parse = prefix => result.stdout.split('\n').filter(line => line.startsWith(prefix)).map(line => JSON.parse(line.slice(prefix.length)));
  return { result, reader, trace, probes: parse('VERTICAL_PROBE:'), endpoints: parse('VERTICAL_ENDPOINT:'), tool: identified };
}
function mine(f, output, instanceId = f.instanceId) { return output.trace.samples.filter(row => row.instanceId === instanceId); }
function actor(row, instanceId) { return row.actors.find(actor => actor.id === instanceId); }
function expectedCarry(f, output, { other = false } = {}) {
  assert.equal(f.generated.backend.version, '0.40.0');
  assert.ok(f.generated.backend.capabilities.includes('physics.platform-vertical2d'));
  const rows = output.probes.filter(row => row.step > 0), expectedGap = 160 - f.expectedSupportY;
  assert.equal(mine(f, output).length, 30);
  assert.ok(rows.some((row, i) => i > 0 && actor(row, f.platformInstanceId).position[1] < actor(rows[i - 1], f.platformInstanceId).position[1]));
  assert.ok(rows.some((row, i) => i > 0 && actor(row, f.platformInstanceId).position[1] > actor(rows[i - 1], f.platformInstanceId).position[1]));
  for (const row of rows) {
    const platform = actor(row, f.platformInstanceId), character = actor(row, f.instanceId), independent = actor(row, f.otherInstanceId);
    assert.ok(Math.abs(platform.position[1] - character.position[1] - expectedGap) < .2, JSON.stringify(row));
    assert.equal(platform.position[0], 150); assert.equal(character.position[0], 100); assert.equal(character.grounded, true);
    if (other) assert.ok(Math.abs(platform.position[1] - independent.position[1] - 15) < .2, JSON.stringify(row));
    else assert.ok(Math.abs(independent.position[1] - f.expectedSupportY) < .2, JSON.stringify(row));
  }
  const publications = output.reader.events.filter(row => row.event === 'event-publish');
  assert.equal(publications.filter(row => row.bindingId === f.publisherBindingId && row.name === 'physics.landed').length, 1);
  assert.deepEqual(publications.filter(row => row.bindingId === f.contactBindingId).map(row => row.name), ['physics.contact_started'], JSON.stringify(publications.filter(row => row.bindingId === f.contactBindingId)));
}
function remember(name, f, output, hashes) {
  evidence.push({ name, backend: f.generated.backend, tool: output.tool, probes: output.probes, endpoints: output.endpoints,
    samples: output.trace.samples, events: output.reader.events, authorFiles: Object.keys(hashes).length, authorSha256: hash(JSON.stringify(hashes)) });
}

test('schema 6 with no vertical motion preserves historical generated bytes and fingerprints', async t => {
  const f = await captured(await scenePhysics2DPlatformVerticalAuthor(t, { enabled: false, consumers: false }));
  const legacy = structuredClone(f.captured.plan);
  for (const scene of legacy.scenes) if (scene.physics?.document.schemaVersion === 6) scene.physics.document.schemaVersion = 5;
  const original = await generateGodotPhysicsCharacterIntentProject(legacy);
  for (const [name, bytes] of original.files) {
    const retained = name === 'project.godot' ? 'retry-original.godot' : name === 'execution-clock-original.godot' ? 'retry-original-clock.godot' : name;
    assert.deepEqual(f.generated.files.get(retained), bytes, name);
  }
  assert.equal(f.generated.files.size, original.files.size + 5); assert.equal(f.generated.backend.version, '0.46.0');
  assert.equal(f.generated.backend.protocolVersion, original.backend.protocolVersion); assert.deepEqual(f.generated.sourceMap, original.sourceMap);
});

for (const [name, options] of [['down-first-one-way', {}], ['up-first-one-way', { offsetY: -48 }], ['solid', { oneWay: false }], ['circle-offset', { circle: true, offset: [7, -3] }], ['two-riders', { bothRiders: true }]]) {
  test(`real vertical ${name} platform carries accepted support through both reversals`, native, async t => {
    const raw = await scenePhysics2DPlatformVerticalAuthor(t, { ...options, consumers: false }); await probe(raw);
    const f = await captured(raw), hashes = await authorHashes(f.author), output = await execute(f, await stage(f), { scriptCheck: name === 'down-first-one-way' });
    expectedCarry(f, output, { other: options.bothRiders });
    assert.ok(output.endpoints.some(row => row.name === 'destination')); assert.ok(output.endpoints.some(row => row.name === 'origin'));
    assert.deepEqual(await authorHashes(f.author), hashes); remember(name, f, output, hashes);
  });
}

for (const action of ['jump', 'drop']) test(`real vertical ${action} detaches one rider while another remains supported`, native, async t => {
  const raw = await scenePhysics2DPlatformVerticalAuthor(t, { consumers: false, bothRiders: true, [action]: true });
  if (action === 'drop') {
    const source = await fs.readFile(path.join(raw.author, 'documents/scripts/drop-through.txt'), 'utf8');
    await raw.script('drop-through', source.replace('var accepted = _drop.request_drop()', 'var accepted = _drop.request_drop()\n\t\tprint("VERTICAL_DROP:" + str(accepted))'));
  }
  await probe(raw, action === 'drop' ? `\tvar character = scene.actors[0]["node"]\n\tprint("VERTICAL_DROP_STATE:" + JSON.stringify({"step":ticks,"exceptions":character.get_collision_exceptions().size(),"owned":scene.movement_contacts.drop_through.owned.keys()}))` : '');
  const f = await captured(raw), hashes = await authorHashes(f.author), output = await execute(f, await stage(f));
  const rows = output.probes.filter(row => row.step > 12);
  assert.ok(rows.some(row => Math.abs(actor(row, f.platformInstanceId).position[1] - actor(row, f.instanceId).position[1] - 15) > 5));
  assert.ok(rows.every(row => Math.abs(actor(row, f.platformInstanceId).position[1] - actor(row, f.otherInstanceId).position[1] - 15) < .2));
  if (action === 'jump') assert.ok(mine(f, output).some(row => row.requestedMotion[1] < -5));
  else assert.ok(mine(f, output).at(-1).positionAfter[1] > 200);
  assert.deepEqual(await authorHashes(f.author), hashes); remember(action, f, output, hashes);
});

test('real ceiling blocks the whole multi-rider platform without false endpoints and removal resumes its phase', native, async t => {
  const raw = await scenePhysics2DPlatformVerticalAuthor(t, { consumers: false, offsetY: -48, bothRiders: true });
  await raw.edit('documents/scenes/demo.json', scene => { scene.actors[2].position = [100, 100]; scene.actors[2].size = [25, 10]; });
  await raw.edit(raw.physicsPath, document => { document.bodies[2].shape.size = [25, 10]; });
  await probe(raw, `\tif ticks == 20:\n\t\tfor candidate in scene.actors:\n\t\t\tif candidate["instanceId"] == "${raw.wallInstanceId}":\n\t\t\t\tcandidate["node"].collision_layer = 0`);
  const f = await captured(raw), hashes = await authorHashes(f.author), output = await execute(f, await stage(f));
  const blocked = output.probes.filter(row => row.step >= 10 && row.step < 20);
  assert.ok(blocked.length > 3); assert.equal(new Set(blocked.map(row => actor(row, f.platformInstanceId).position[1])).size, 1);
  assert.ok(blocked.every(row => actor(row, f.instanceId).position[1] >= 114.9));
  assert.ok(output.endpoints.filter(row => row.name === 'destination').every(row => row.step > 20));
  assert.ok(output.endpoints.some(row => row.name === 'destination'));
  assert.ok(output.probes.filter(row => row.step > 0).every(row => Math.abs(actor(row, f.platformInstanceId).position[1] - actor(row, f.otherInstanceId).position[1] - 15) < .2));
  assert.deepEqual(await authorHashes(f.author), hashes); remember('ceiling-pause-resume', f, output, hashes);
});

for (const noCharacters of [false, true]) test(`real descending platform stops at static ground with ${noCharacters ? 'no' : 'one'} passenger`, native, async t => {
  const raw = await scenePhysics2DPlatformVerticalAuthor(t, { consumers: false, noCharacters, oneWay: false });
  await raw.edit('documents/scenes/demo.json', scene => { scene.actors[2].position = [150, 200]; scene.actors[2].size = [250, 10]; });
  await raw.edit(raw.physicsPath, document => { document.bodies.find(row => row.instanceId === raw.wallInstanceId).shape.size = [250, 10]; });
  await probe(raw); const f = await captured(raw), hashes = await authorHashes(f.author), output = await execute(f, await stage(f));
  const rows = output.probes.filter(row => row.step >= 10);
  assert.ok(rows.every(row => actor(row, f.platformInstanceId).position[1] <= 190.1));
  assert.equal(new Set(rows.map(row => actor(row, f.platformInstanceId).position[1])).size, 1);
  assert.deepEqual(output.endpoints, []);
  assert.deepEqual(await authorHashes(f.author), hashes); remember(noCharacters ? 'empty-platform-floor' : 'passenger-floor', f, output, hashes);
});

test('real mixed vertical and legacy horizontal platforms retain separate native axes and support', native, async t => {
  const raw = await scenePhysics2DPlatformVerticalAuthor(t, { consumers: false });
  await raw.edit(raw.physicsPath, document => { document.bodies.find(body => body.id === raw.stationaryBodyId).platformMotion = { kind: 'horizontal', offsetX: 24, speed: 120 }; });
  await probe(raw); const f = await captured(raw), hashes = await authorHashes(f.author), output = await execute(f, await stage(f));
  const rows = output.probes.filter(row => row.step > 3);
  const horizontalGap = actor(rows[0], f.otherInstanceId).position[0] - actor(rows[0], f.stationaryInstanceId).position[0];
  assert.ok(Math.abs(horizontalGap) < 6);
  for (const row of rows) {
    const vertical = actor(row, f.platformInstanceId), horizontal = actor(row, f.stationaryInstanceId), other = actor(row, f.otherInstanceId);
    assert.equal(vertical.position[0], 150); assert.equal(horizontal.position[1], 160);
    assert.ok(Math.abs(other.position[0] - horizontal.position[0] - horizontalGap) < .2);
    assert.ok(Math.abs(other.position[1] - 145) < .2);
  }
  assert.ok(rows.some(row => actor(row, f.stationaryInstanceId).position[0] > 450));
  assert.deepEqual(await authorHashes(f.author), hashes); remember('mixed-axes', f, output, hashes);
});

test('real collision masks do not invent vertical support or carry', native, async t => {
  const raw = await scenePhysics2DPlatformVerticalAuthor(t, { consumers: false });
  await raw.edit(raw.physicsPath, document => { document.bodies.find(row => row.id === raw.platformBodyId).layer = 2; });
  await probe(raw); const f = await captured(raw), hashes = await authorHashes(f.author), output = await execute(f, await stage(f));
  assert.ok(mine(f, output).at(-1).positionAfter[1] > 250);
  assert.ok(output.probes.filter(row => row.step > 4).every(row => !actor(row, f.instanceId).grounded || actor(row, f.instanceId).position[1] > 250));
  assert.deepEqual(await authorHashes(f.author), hashes); remember('masked-no-support', f, output, hashes);
});

test('real author collision exception breaks carry and remains owned by its author', native, async t => {
  const raw = await scenePhysics2DPlatformVerticalAuthor(t, { consumers: false });
  await probe(raw, `\tvar character: CharacterBody2D = scene.actors[0]["node"]\n\tvar platform = get_parent()\n\tif ticks == 6:\n\t\tcharacter.add_collision_exception_with(platform)\n\tif ticks >= 6:\n\t\tprint("VERTICAL_EXCEPTION:" + str(character.get_collision_exceptions().has(platform)))`);
  const f = await captured(raw), hashes = await authorHashes(f.author), output = await execute(f, await stage(f));
  assert.ok(output.result.stdout.includes('VERTICAL_EXCEPTION:true'));
  assert.ok(!output.result.stdout.includes('VERTICAL_EXCEPTION:false'));
  assert.ok(mine(f, output).at(-1).positionAfter[1] > 250);
  assert.deepEqual(await authorHashes(f.author), hashes); remember('author-exception', f, output, hashes);
});

test('real short maximum-speed path tests all reached extrema before accepting multiple reversals', native, async t => {
  const raw = await scenePhysics2DPlatformVerticalAuthor(t, { consumers: false, noCharacters: true, oneWay: false, offsetY: 1, speed: 2000 });
  await raw.edit('documents/scenes/demo.json', scene => { scene.actors[2].position = [150, 170.7]; scene.actors[2].size = [250, 10]; });
  await raw.edit(raw.physicsPath, document => { document.bodies.find(row => row.instanceId === raw.wallInstanceId).shape.size = [250, 10]; });
  await probe(raw); const f = await captured(raw), hashes = await authorHashes(f.author), output = await execute(f, await stage(f));
  assert.ok(output.probes.every(row => actor(row, f.platformInstanceId).position[1] === 160));
  assert.ok(output.probes.every(row => row.phase === 0)); assert.deepEqual(output.endpoints, []);
  assert.deepEqual(await authorHashes(f.author), hashes); remember('short-maxspeed-blocked-extrema', f, output, hashes);
});

test('real portable ZIP keeps vertical helpers and runtime after source and original build go offline', native, async t => {
  const raw = await scenePhysics2DPlatformVerticalAuthor(t, { consumers: false }); await probe(raw);
  const f = await captured(raw), hashes = await authorHashes(f.author), outputPath = path.join(f.temporary, 'build');
  const built = await buildProject({ root: f.author, targetId: f.assemblyId, tool, output: outputPath });
  assert.equal(built.ok, true, JSON.stringify(built.record?.diagnostics || built));
  const inspection = () => inspectBackendProject({ buildDirectory: outputPath });
  const delivery = await planBackendProjectDelivery({ inspection: await inspection(), assertCurrent: inspection });
  const zip = path.join(f.temporary, 'vertical.zip'); await writeExportZip(delivery, zip); await verifyBackendProjectDelivery(zip);
  if (report) await fs.copyFile(zip, report.replace(/\.json$/, '-platform-vertical.zip'));
  const moved = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-platform-vertical-relocated-')); t.after(() => fs.rm(moved, { recursive: true, force: true }));
  const archive = await yauzl.openPromise(zip, { lazyEntries: true, autoClose: false });
  try { for await (const entry of archive.eachEntry()) {
    assert.ok(!entry.fileName.startsWith('/') && !entry.fileName.split('/').includes('..'));
    const parts = []; for await (const bytes of await archive.openReadStreamPromise(entry)) parts.push(bytes);
    const file = path.join(moved, entry.fileName); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, Buffer.concat(parts));
  } } finally { await new Promise(resolve => { archive.reader.once('close', resolve); archive.close(); }); }
  assert.ok((await fs.stat(path.join(moved, 'project/platform-vertical-motion-helper.gd'))).isFile());
  assert.deepEqual(await authorHashes(f.author), hashes); await fs.rename(f.author, f.author + '.offline'); await fs.rename(outputPath, outputPath + '.offline');
  const output = await execute(f, path.join(moved, 'project'), { scriptCheck: true, backend: built.record.backend });
  expectedCarry(f, output); remember('portable-zip-offline', f, output, hashes);
});


test('real isolated window capture renders vertical platform motion with valid physics observations', {
  ...native, skip: !tool || !process.env.VIENTO_PHYSICS_PLATFORM_VERTICAL_CAPTURE ? 'Set Godot and an isolated display with VIENTO_PHYSICS_PLATFORM_VERTICAL_CAPTURE' : false,
}, async t => {
  const raw = await scenePhysics2DPlatformVerticalAuthor(t, { consumers: false }); await probe(raw);
  const f = await captured(raw), hashes = await authorHashes(f.author);
  const capturePath = process.env.VIENTO_PHYSICS_PLATFORM_VERTICAL_CAPTURE;
  const output = await execute(f, await stage(f), { mode: 'windowCapture', capturePath });
  expectedCarry(f, output); assert.ok((await fs.stat(capturePath)).size > 100);
  assert.deepEqual(await authorHashes(f.author), hashes); remember('isolated-window-capture', f, output, hashes);
  evidence.at(-1).capture = { sha256: hash(await fs.readFile(capturePath)), bytes: (await fs.stat(capturePath)).size };
});


test('real vertical landing keeps ordinary animation and audio event consumers composed', native, async t => {
  const raw = await scenePhysics2DPlatformVerticalAuthor(t, { consumers: true }); await probe(raw);
  const f = await captured(raw), hashes = await authorHashes(f.author), output = await execute(f, await stage(f));
  expectedCarry(f, output);
  assert.equal(output.reader.events.filter(row => row.event === 'audio-command' && row.bindingId === f.audioBindingId && row.action === 'play').length, 1);
  assert.ok(output.reader.events.some(row => row.event === 'animation-command'));
  assert.deepEqual(await authorHashes(f.author), hashes); remember('animation-audio-composition', f, output, hashes);
});

test('real finite physics control replay admits a pure vertical project and preserves strict inventories', native, async t => {
  const raw = await scenePhysics2DPlatformVerticalAuthor(t, { consumers: false });
  await raw.edit('documents/projects/demo.json', value => { value.sceneIds = [raw.sceneIds[0]]; });
  await raw.edit(`metadata/documents/${raw.assemblyId}.json`, value => { value.relations = value.relations.filter(row => row.targetId === raw.sceneIds[0]); });
  await raw.edit(`metadata/documents/${raw.sceneIds[0]}.json`, value => { value.relations = value.relations.filter(row => !['behavior', 'audio', 'animation'].includes(row.kind)); });
  await raw.edit('documents/scenes/demo.json', value => { value.actors[0].speed = 60; });
  const f = await captured(raw), directory = await stage(f), hashes = await authorHashes(f.author);
  assert.equal(f.captured.plan.scenes.length, 1); assert.equal(f.captured.plan.scenes[0].behaviors, undefined);
  assert.equal(f.captured.plan.scenes[0].audio, undefined); assert.equal(f.captured.plan.scenes[0].animation, undefined);
  const identified = await adapter.identify(tool);
  for (const phase of adapter.buildPhases) {
    const result = await adapter.executePhase({ phase, directory, tool: identified, timeoutMs: 60000 });
    assert.equal(result.status, 'succeeded', result.stdout + result.stderr);
    assert.deepEqual(adapter.diagnostics(result, f.captured.plan), [], result.stdout + result.stderr);
  }
  const released = () => ({ left: false, right: false, up: false, down: false, jump: false });
  const program = { format: 'viento-physics2d-input-replay', schemaVersion: 1, fixedDelta: 1 / 60,
    steps: Array.from({ length: 30 }, released) };
  async function runReplay(physicsControlProgram) {
    const result = await adapter.executePhase({ phase: 'run', directory, tool: identified, timeoutMs: 60000, physicsControlProgram });
    assert.equal(result.status, 'succeeded', result.stdout + result.stderr);
    assert.deepEqual(adapter.diagnostics(result, f.captured.plan), [], result.stdout + result.stderr);
    const reader = adapter.createEventReader(f.captured.plan, { smoke: true, capabilities: f.generated.backend.capabilities });
    reader.push(result.stdout); assert.deepEqual(reader.finish().diagnostics, [], result.stdout);
    const trace = reader.snapshot(); assert.equal(trace.phase, 'finished');
    assert.ok(!(await fs.readdir(directory)).some(name => name.startsWith('viento-physics-replay-')));
    return { result, reader, trace, probes: [], endpoints: [], tool: identified };
  }
  const held = await runReplay(program), rows = mine(f, held);
  assert.equal(rows.length, 30);
  for (const row of rows) {
    const phase = row.stepIndex * 4 % 96, travelled = phase <= 48 ? phase : 96 - phase;
    assert.ok(Math.abs(row.positionAfter[0] - 100) < .01);
    assert.ok(Math.abs(row.positionAfter[1] - (160 + travelled - 15)) < .2, JSON.stringify(row));
  }
  const moving = structuredClone(program);
  for (let index = 0; index < 18; index++) moving.steps[index].right = true;
  moving.steps[6].jump = true;
  const jumped = await runReplay(moving), jumpingRows = mine(f, jumped);
  assert.equal(jumpingRows.length, 30);
  assert.ok(jumpingRows.some(row => row.requestedMotion[1] < -5), 'A supported character must accept the replayed jump.');
  assert.ok(jumpingRows.some(row => row.positionAfter[0] > 110));
  assert.ok(mine(f, jumped, f.otherInstanceId).every(row => Math.abs(row.positionAfter[0] - 440) < .01));
  const wrapper = `scenes/${f.sceneIds[0]}/platform-vertical-scene.gd`, original = f.generated.files.get(wrapper);
  await fs.appendFile(path.join(directory, wrapper), '\n# unexpected wrapper edit\n');
  await assert.rejects(adapter.executePhase({ phase: 'run', directory, tool: identified, timeoutMs: 60000, physicsControlProgram: program }), { errorCode: 'build_physics_platform_vertical_invalid' });
  await fs.writeFile(path.join(directory, wrapper), original);
  for (const [name, bytes] of f.generated.files) assert.deepEqual(await fs.readFile(path.join(directory, name)), bytes, name);
  assert.deepEqual(await authorHashes(f.author), hashes);
  remember('pure-vertical-physics-control-replay', f, held, hashes);
  evidence.at(-1).jumpSamples = jumpingRows;
  evidence.at(-1).strictInventoryTamperRejected = true;
});
