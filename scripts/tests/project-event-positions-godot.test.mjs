import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { projectEventsAuthor } from './helpers/project-events-author-fixture.mjs';
import { buildProject, runProjectBuild } from '../adapters/node-project-build.mjs';
import { buildHash } from '../adapters/node-build-snapshot.mjs';

const tool = process.env.VIENTO_GODOT_BIN;
const native = { skip: !tool && 'Set VIENTO_GODOT_BIN for native event position verification', timeout: 120000 };
const json = value => JSON.stringify(value, null, 2) + '\n';
const manifestPath = 'documents/behaviors/demo.json';
const framePrefix = 'VIENTO_EXECUTION_FRAME:', probePrefix = 'VIENTO_EVENT_POSITION_PROBE:';
const notBefore = (a, b) => a.idleFrame >= b.idleFrame && a.physicsFrame >= b.physicsFrame;
const repository = fileURLToPath(new URL('../..', import.meta.url));
const read = async (f, file) => JSON.parse(await fs.readFile(path.join(f.author, file)));
const write = async (f, file, value) => fs.writeFile(path.join(f.author, file), typeof value === 'string' ? value : json(value));
const script = (f, name, value) => write(f, `documents/scripts/${name}.txt`, value);
const pair = clock => `${clock.idleFrame}:${clock.physicsFrame}`;

async function authorHashes(root) {
  const result = {};
  for (const entry of await fs.readdir(root, { recursive: true, withFileTypes: true })) if (entry.isFile()) {
    const file = path.join(entry.parentPath, entry.name), relative = path.relative(root, file);
    if (!relative.startsWith('.viento/')) result[relative] = buildHash(await fs.readFile(file));
  }
  return result;
}
async function implementationHashes() {
  const files = new Set(['engine/project-event-positions.mjs', 'engine/project-event-bus.mjs',
    'engine/project-queued-requests.mjs', 'engine/project-audio-requests.mjs', 'engine/project-audio-commands.mjs',
    'engine/project-animation-requests.mjs', 'engine/project-animation-commands.mjs', 'engine/project-animation-targets.mjs',
    'engine/project-execution-budget.mjs', 'engine/project-execution-frames.mjs', 'engine/project-execution-clock.mjs',
    'engine/project-runtime-events.mjs', 'engine/project-runtime-contracts.mjs', 'engine/project-runtime-query.mjs',
    'engine/project-causal-anchors.mjs', 'scripts/lib/project-build-service.mjs', 'scripts/adapters/node-project-build.mjs',
    'scripts/backends/godot4-adapter.mjs', 'scripts/backends/godot4-audio-requests.mjs', 'scripts/backends/godot4-animation-requests.mjs',
    'scripts/backends/godot4-execution-frames.mjs', 'scripts/backends/godot4-execution-clock.mjs', 'scripts/backends/godot4-execution-budget.mjs',
    'scripts/tests/project-event-positions-godot.test.mjs', 'scripts/tests/helpers/project-events-author-fixture.mjs',
    'scripts/tests/helpers/project-scene-switching-fixture.mjs', 'scripts/tests/helpers/project-assembly-backend-fixture.mjs']);
  for (const entry of await fs.readdir(path.join(repository, 'scripts/backends/godot4')))
    if ((entry.startsWith('project-') || entry.startsWith('execution-') || entry.startsWith('animation-request-') || entry.startsWith('audio-request-') || entry.startsWith('audio-')) && entry.endsWith('.gd')) files.add(`scripts/backends/godot4/${entry}`);
  return Object.fromEntries(await Promise.all([...files].sort().map(async file => [file, buildHash(await fs.readFile(path.join(repository, file)))])));
}

async function fixture(t, { media = false } = {}) {
  const f = await projectEventsAuthor(t), manifest = await read(f, manifestPath);
  manifest.bindings.forEach(binding => { binding.parameters = {}; binding.events = []; });
  await write(f, manifestPath, manifest);
  await script(f, 'publisher', 'extends Node\n');
  await script(f, 'second', 'extends Node\n');
  const audio = await read(f, 'documents/audio/demo.json'); audio.cues = [];
  await write(f, 'documents/audio/demo.json', audio);
  if (media) {
    const audioId = '12345678-1234-4234-8234-123456789ae1';
    const originalAudio = await read(f, 'metadata/documents/88888888-8888-4888-8888-888888888888.json');
    await write(f, 'documents/audio/first.json', { ...audio, sceneObjectId: f.sceneIds[0] });
    await write(f, `metadata/documents/${audioId}.json`, { ...originalAudio, id: audioId, sourcePath: 'documents/audio/first.json',
      relations: originalAudio.relations.map(row => row.targetId === f.sceneIds[1] ? { ...row, targetId: f.sceneIds[0] } : row) });
    const animationId = '58585858-5858-4585-8585-000000000100';
    const workspace = await read(f, 'workspace.json');
    workspace.documentTypes.push({ id: 'animation', label: 'Animation', directory: 'animations', parserProfile: 'structured', template: 'animation.json' });
    await write(f, 'workspace.json', workspace);
    const document = { format: 'viento-scene-animation', schemaVersion: 1, sceneObjectId: f.sceneIds[0], durationSeconds: 1, loop: true,
      tracks: [{ id: '58585858-5858-4585-8585-000000000001', instanceId: manifest.bindings[0].instanceId,
        property: 'offset2d', interpolation: 'linear', keyframes: [{ atSeconds: 0, value: [0, 0] }, { atSeconds: 1, value: [100, 0] }] }] };
    await fs.mkdir(path.join(f.author, 'documents/animations'), { recursive: true });
    await write(f, 'documents/animations/first.json', document);
    await write(f, 'templates/animation.json', document);
    const metadata = await read(f, 'metadata/documents/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee.json');
    await write(f, `metadata/documents/${animationId}.json`, { ...metadata, id: animationId, sourcePath: 'documents/animations/first.json',
      documentType: 'animation', relations: [{ kind: 'reference', targetId: f.sceneIds[0], slot: 'scene' }] });
    const scene = await read(f, `metadata/documents/${f.sceneIds[0]}.json`);
    scene.relations.push({ kind: 'audio', targetId: audioId, slot: 'scene audio' }, { kind: 'animation', targetId: animationId, slot: 'scene animation' });
    await write(f, `metadata/documents/${f.sceneIds[0]}.json`, scene);
  }
  return { ...f, binding: manifest.bindings[0], bindingId: manifest.bindings[0].bindingId, trackId: audio.tracks[0].id,
    script: (name, source) => script(f, name, source) };
}

async function run(name, f, options = {}) {
  const before = await authorHashes(f.author), sourcesBefore = await implementationHashes();
  const output = { stdout: '', stderr: '' }, events = [], views = [];
  const built = await buildProject({ root: f.author, targetId: f.assemblyId, tool,
    output: path.join(f.temporary, 'event-positions-build'), timeoutMs: 60000 });
  assert.equal(built.ok, true, json(built.record?.diagnostics || built));
  assert.equal(built.record.backend.version, '0.36.0');
  assert.ok(built.record.backend.capabilities.includes('runtime.execution-frames'));
  const afterBuild = await authorHashes(f.author); assert.deepEqual(afterBuild, before);
  const result = await runProjectBuild({ buildDirectory: built.buildDirectory, tool, headless: true, smoke: false,
    timeoutMs: 60000, ...options, onProgress: event => {
      if (event.output) output[event.output.stream] += event.output.text;
      if (event.event) events.push(event.event);
      if (event.eventPositions) views.push(event.eventPositions);
      options.onProgress?.(event);
    } });
  assert.ok(result.record, json(result));
  const afterRun = await authorHashes(f.author), sourcesAfter = await implementationHashes();
  assert.deepEqual(afterRun, before);
  assert.deepEqual(sourcesAfter, sourcesBefore, 'Production and test bytes stay frozen throughout each native case.');
  const disk = JSON.parse(await fs.readFile(path.join(result.sessionDirectory, 'session.json')));
  assert.deepEqual(disk, result.record);
  await assert.rejects(fs.stat(path.join(result.sessionDirectory, 'project')), { code: 'ENOENT' });
  const parse = prefix => output.stdout.split('\n').filter(line => line.startsWith(prefix)).map(line => JSON.parse(line.slice(prefix.length)));
  const envelopes = parse(framePrefix), probes = parse(probePrefix);
  const snapshot = JSON.parse(await fs.readFile(path.join(built.buildDirectory, 'snapshot.json')));
  const evidence = process.env.VIENTO_EVENT_POSITIONS_EVIDENCE;
  if (evidence) {
    const directory = path.join(evidence, name); await fs.mkdir(directory, { recursive: true });
    const authorScripts = {};
    for (const file of Object.keys(before)) if (file.startsWith('documents/scripts/')) authorScripts[file] = await fs.readFile(path.join(f.author, file), 'utf8');
    await Promise.all([
      fs.writeFile(path.join(directory, 'summary.json'), json({ schemaVersion: 1, name, recordedAt: new Date().toISOString(),
        node: { version: process.version, executable: process.execPath, sha256: buildHash(await fs.readFile(process.execPath)) }, platform: process.platform, arch: process.arch, mode: 'headless', smoke: false,
        tool: { executable: tool, ...built.record.tool, sha256: buildHash(await fs.readFile(tool)) },
        observationScope: 'existing event-publish and event-delivery receipts at actual Godot frame pairs; pending does not assert that a callback never ran', backend: built.record.backend, ok: result.ok, status: result.status,
        eventPositions: result.record.eventPositions, executionFrames: result.record.executionFrames, executionClock: result.record.executionClock,
        lifecycle: result.record.lifecycle, eventRetention: result.record.eventRetention, probes,
        authorFiles: Object.keys(before).length, authorUnchangedAfterBuildAndRun: true, diskRecordMatches: true,
        temporaryProjectRemoved: true, sourceHashesUnchanged: true, sourceHashes: sourcesBefore,
        diagnostics: result.record.diagnostics, stdoutBytes: Buffer.byteLength(output.stdout), stderrBytes: Buffer.byteLength(output.stderr) })),
      fs.writeFile(path.join(directory, 'author-hashes.json'), json({ before, afterBuild, afterRun })),
      fs.writeFile(path.join(directory, 'author-scripts.json'), json(authorScripts)),
      fs.writeFile(path.join(directory, 'source-hashes.json'), json({ before: sourcesBefore, after: sourcesAfter })),
      fs.writeFile(path.join(directory, 'build-record.json'), json(built.record)),
      fs.writeFile(path.join(directory, 'build-snapshot.json'), json(snapshot)),
      fs.writeFile(path.join(directory, 'session.json'), json(disk)),
      fs.writeFile(path.join(directory, 'observed-events.json'), json(events)),
      fs.writeFile(path.join(directory, 'position-updates.json'), json(views)),
      fs.writeFile(path.join(directory, 'stdout.log'), output.stdout), fs.writeFile(path.join(directory, 'stderr.log'), output.stderr),
    ]);
  }
  return { result, output, events, views, envelopes, probes, snapshot };
}

// Actions use ordinary public author ports. Independent probes read real frame
// pairs after calls and synchronous drain. Delayed fixtures hold only the
// existing flush gate while actual engine callbacks advance, never the clock.
const driver = (start, methods = '') => `extends Node
var p
func _ready() -> void:
\tp = get_meta("viento_project")
\tset_process(false)
\tset_physics_process(false)
\tcall_deferred("_start")
func _start() -> void:
\tvar host = p.host.get_ref()
\thost.set_process(false)
${start}
func _probe(kind: String, label: String, extra: Dictionary = {}) -> void:
\tvar data := {"kind": kind, "label": label, "clock": {"idleFrame": Engine.get_process_frames(), "physicsFrame": Engine.get_physics_frames()}}
\tdata.merge(extra)
\tprint("${probePrefix}" + JSON.stringify(data))
func _published(label: String, accepted: bool) -> void:
\t_probe("published", label, {"accepted": accepted, "sequence": p.host.get_ref().event_bus.sequence})
func _delivered(label: String, sequence: int, subscription_id: int) -> void:
\t_probe("delivered", label, {"sequence": sequence, "subscriptionId": subscription_id})
func _finish() -> void:
\tp.host.get_ref().finish_project()
${methods}`;

function succeeded(observed) {
  assert.equal(observed.result.ok, true, json(observed.result.record.diagnostics));
  assert.equal(observed.result.status, 'succeeded'); assert.deepEqual(observed.result.record.diagnostics, []);
  assert.deepEqual(observed.result.record.lifecycle, { started: true, completed: true });
  assert.equal(observed.result.record.eventPositions.phase, 'finished');
}
function verify(observed) {
  const view = observed.result.record.eventPositions, ledger = observed.result.record.runtime.project.events;
  assert.equal(view.format, 'viento-project-event-positions'); assert.equal(view.schemaVersion, 1);
  assert.deepEqual(observed.envelopes.map(row => row.frame), observed.events, 'Only unchanged project DTOs reach the business reader.');
  const published = observed.envelopes.filter(row => row.frame.event === 'event-publish');
  const delivered = observed.envelopes.filter(row => row.frame.event === 'event-delivery');
  assert.deepEqual(published.map(row => row.frame.sequence), Array.from({ length: ledger.sequence }, (_, index) => index + 1));
  const deliveries = ledger.entries.flatMap(row => row.deliveries);
  const pending = ledger.entries.filter(row => row.deliveries.some(item => item.status === 'pending'));
  const settled = ledger.entries.filter(row => row.deliveries.every(item => item.status !== 'pending'));
  const retained = [...settled.slice(-32), ...pending].sort((a, b) => a.sequence - b.sequence);
  assert.deepEqual(view.counts, { published: ledger.sequence, settled: settled.length, pending: pending.length,
    deliveries: deliveries.length, handled: deliveries.filter(row => row.status === 'handled').length,
    skipped: deliveries.filter(row => row.status === 'skipped').length, pendingDeliveries: deliveries.filter(row => row.status === 'pending').length });
  assert.deepEqual(view.retention, { limit: 32, total: ledger.sequence, retained: retained.length, dropped: ledger.sequence - retained.length,
    pending: pending.length, settled: Math.min(32, settled.length), firstSequence: retained[0]?.sequence ?? null, lastSequence: retained.at(-1)?.sequence ?? null });
  assert.deepEqual(view.items.map(row => row.sequence), retained.map(row => row.sequence));
  const frozenOrigin = origin => {
    const scene = observed.snapshot.plan.scenes.find(row => row.scene.objectId === origin.sceneId);
    const binding = scene.behaviors.bindings.find(row => row.bindingId === origin.bindingId);
    assert.deepEqual(origin.source, binding.declaration);
    assert.equal(origin.instanceId, binding.instanceId); assert.equal(origin.objectId, binding.objectId);
  };
  for (const item of view.items) {
    const original = ledger.entries[item.sequence - 1], publication = published[item.sequence - 1];
    assert.deepEqual(Object.keys(item).sort(), ['sequence', 'name', 'value', 'origin', 'deliveries', 'published'].sort());
    const { published: location, deliveries: locatedDeliveries, ...plain } = item;
    assert.deepEqual(plain, { sequence: original.sequence, name: original.name, value: original.value, origin: original.origin });
    assert.deepEqual(location, { clock: publication.clock, executionFrameIndex: publication.index });
    frozenOrigin(item.origin); assert.equal(locatedDeliveries.length, original.deliveries.length);
    for (const [index, delivery] of locatedDeliveries.entries()) {
      const { delivered: location, ...plain } = delivery;
      assert.deepEqual(plain, original.deliveries[index]); frozenOrigin(delivery.origin);
      const frames = delivered.filter(row => row.frame.sequence === item.sequence && row.frame.subscriptionId === delivery.subscriptionId);
      if (delivery.status === 'pending') {
        assert.equal(Object.hasOwn(delivery, 'delivered'), false); assert.equal(frames.length, 0);
      } else {
        assert.equal(frames.length, 1); assert.equal(frames[0].frame.status, delivery.status);
        assert.deepEqual(location, { clock: frames[0].clock, executionFrameIndex: frames[0].index });
        assert.ok(location.executionFrameIndex > item.published.executionFrameIndex);
        assert.ok(notBefore(location.clock, item.published.clock));
      }
    }
  }
  for (const probe of observed.probes.filter(row => row.kind === 'published')) {
    assert.equal(probe.accepted, true);
    assert.deepEqual(published[probe.sequence - 1]?.clock, probe.clock);
  }
  for (const probe of observed.probes.filter(row => row.kind === 'delivered')) {
    const receipt = delivered.find(row => row.frame.sequence === probe.sequence && row.frame.subscriptionId === probe.subscriptionId);
    assert.ok(receipt); assert.equal(receipt.frame.status, 'handled'); assert.deepEqual(receipt.clock, probe.clock);
  }
  assert.ok(observed.views.some(row => row.counts.published === view.counts.published));
  return { view, ledger, published, delivered };
}

// The fixture only holds the existing flush gate while actual callbacks advance.
// It never changes Engine clocks, callback synchrony, or the generated queue.
test('native ready publications settle empty recipients immediately and locate handled and skipped recipients', native, async t => {
  const f = await fixture(t);
  const methods = `var first_token := 0
var removed_token := 0
var last_token := 0
func _first(value) -> bool:
\tif not p.unsubscribe_event(removed_token):
\t\treturn false
\t_delivered("first", int(value), first_token)
\treturn true
func _removed(_value) -> bool:
\t_probe("unexpected", "removed-called")
\treturn false
func _last(value) -> bool:
\t_delivered("last", int(value), last_token)
\treturn true
`;
  const source = driver(`\thost.flushing = false
\thost.flush_requests()
\t_probe("drain", "ready-batch")
\tcall_deferred("_finish")`, methods).replace('\tcall_deferred("_start")', `\tp.host.get_ref().flushing = true
\t_published("empty", p.publish_event("empty", 1))
\tfirst_token = p.subscribe_event("fanout", _first)
\tremoved_token = p.subscribe_event("fanout", _removed)
\tlast_token = p.subscribe_event("fanout", _last)
\t_published("fanout", p.publish_event("fanout", 2))
\tcall_deferred("_start")`);
  await f.script('checkpoint', source);
  const observed = await run('ready-empty-fanout', f); succeeded(observed);
  const { view, delivered } = verify(observed);
  assert.deepEqual(view.counts, { published: 2, settled: 2, pending: 0, deliveries: 3, handled: 2, skipped: 1, pendingDeliveries: 0 });
  assert.deepEqual(view.items[0].deliveries, []);
  assert.ok(observed.views.some(row => row.counts.published === 1 && row.counts.settled === 1 && row.counts.pending === 0));
  assert.deepEqual(view.items[1].deliveries.map(row => row.status), ['handled', 'skipped', 'handled']);
  const after = observed.probes.find(row => row.kind === 'drain');
  assert.ok(delivered.every(row => pair(row.clock) === pair(after.clock)));
  assert.equal(observed.probes.some(row => row.kind === 'unexpected'), false);
  const ready = observed.envelopes.find(row => row.frame.event === 'scene-event' && row.frame.stream === 'runtime' && row.frame.frame.event === 'ready');
  assert.ok(ready.index < view.items[0].published.executionFrameIndex);
  assert.equal(observed.result.record.runtime.project.protocolVersion, 4);
});

test('native publications precede their synchronous recipient batch on real later idle and physics frames', native, async t => {
  const f = await fixture(t);
  await f.script('checkpoint', driver(`\thost.flushing = true
\tfirst_token = p.subscribe_event("batch", _first)
\tlast_token = p.subscribe_event("batch", _last)
\t_published("first-batch", p.publish_event("batch", 1))
\theld_idle = Engine.get_process_frames()
\theld_physics = Engine.get_physics_frames()
\tset_process(true)`, `var first_token := 0
var last_token := 0
var held_idle := 0
var held_physics := 0
var stage := 0
func _first(value) -> bool:
\t_delivered("first", int(value), first_token)
\treturn true
func _last(value) -> bool:
\t_delivered("last", int(value), last_token)
\treturn true
func _process(_delta: float) -> void:
\tif Engine.get_process_frames() <= held_idle + 3 or Engine.get_physics_frames() <= held_physics:
\t\treturn
\tvar host = p.host.get_ref()
\tif stage == 0:
\t\thost.flushing = false
\t\thost.flush_requests()
\t\t_probe("drain", "first-batch")
\t\theld_idle = Engine.get_process_frames()
\t\theld_physics = Engine.get_physics_frames()
\t\tstage = 1
\t\treturn
\tset_process(false)
\t_published("second-batch", p.publish_event("batch", 2))
\thost.flush_requests()
\t_probe("drain", "second-batch")
\tcall_deferred("_finish")
`));
  const observed = await run('cross-frame-batches', f); succeeded(observed);
  const { view } = verify(observed), [first, second] = view.items;
  assert.equal(view.counts.handled, 4);
  for (const recipient of first.deliveries) {
    assert.ok(recipient.delivered.clock.idleFrame > first.published.clock.idleFrame);
    assert.ok(recipient.delivered.clock.physicsFrame > first.published.clock.physicsFrame);
  }
  assert.deepEqual(first.deliveries[0].delivered.clock, first.deliveries[1].delivered.clock);
  assert.ok(first.deliveries[0].delivered.executionFrameIndex < first.deliveries[1].delivered.executionFrameIndex);
  assert.ok(second.published.clock.idleFrame > first.deliveries[1].delivered.clock.idleFrame);
  assert.ok(second.published.clock.physicsFrame > first.deliveries[1].delivered.clock.physicsFrame);
  assert.ok(second.published.executionFrameIndex > first.deliveries[1].delivered.executionFrameIndex);
});

test('native nested publication and a later recipient failure preserve handled evidence without guessing whether pending callbacks ran', native, async t => {
  const f = await fixture(t);
  await f.script('checkpoint', driver(`\tfirst_token = p.subscribe_event("root", _first)
\tfailed_token = p.subscribe_event("root", _fails)
\tp.subscribe_event("root", _never)
\tp.subscribe_event("nested", _nested)
\t_published("root", p.publish_event("root", 1))
\thost.flush_requests()`, `var first_token := 0
var failed_token := 0
func _first(_value) -> bool:
\tp.write_state("first_ran", true)
\t_published("nested", p.publish_event("nested", 2))
\t_delivered("first", 1, first_token)
\treturn true
func _fails(_value) -> bool:
\tp.write_state("failed_ran", true)
\t_probe("attempted", "failed-recipient", {"sequence": 1, "subscriptionId": failed_token})
\treturn false
func _never(_value) -> bool:
\t_probe("unexpected", "last-recipient")
\treturn false
func _nested(_value) -> bool:
\t_probe("unexpected", "nested-recipient")
\treturn false
`));
  const observed = await run('nested-partial-failure', f), { view } = verify(observed);
  assert.equal(observed.result.status, 'failed'); assert.equal(view.phase, 'incomplete');
  assert.deepEqual(view.counts, { published: 2, settled: 0, pending: 2, deliveries: 4, handled: 1, skipped: 0, pendingDeliveries: 3 });
  assert.deepEqual(view.items[0].deliveries.map(row => row.status), ['handled', 'pending', 'pending']);
  assert.equal(view.items[1].deliveries[0].status, 'pending');
  assert.ok(view.items[1].published.executionFrameIndex < view.items[0].deliveries[0].delivered.executionFrameIndex);
  const attempt = observed.probes.find(row => row.kind === 'attempted'); assert.ok(attempt);
  assert.equal(attempt.subscriptionId, view.items[0].deliveries[1].subscriptionId);
  assert.equal(observed.probes.some(row => row.kind === 'unexpected'), false);
  const state = observed.result.record.runtime.project.sharedState;
  assert.equal(state.revision, 2); assert.ok(state.entries.some(row => row.key === 'failed_ran' && row.value === true));
  assert.ok(observed.result.record.diagnostics.some(row => row.code === 'runtime_behavior_event_callback' && row.bindingId === f.bindingId));
  assert.equal(observed.events.some(row => row.event === 'finished'), false);
});

test('native cancellation retains early publication positions after 160 state frames and clock-window eviction', native, async t => {
  const f = await fixture(t), controller = new AbortController();
  await f.script('checkpoint', driver(`\thost.flushing = true
\tp.subscribe_event("hold", _first)
\tp.subscribe_event("hold", _last)
\t_published("held", p.publish_event("hold", 1))
\tset_process(true)`, `var steps := 0
var counter := 0
func _first(_value) -> bool:
\t_probe("unexpected", "first-called")
\treturn true
func _last(_value) -> bool:
\t_probe("unexpected", "last-called")
\treturn true
func _process(_delta: float) -> void:
\tsteps += 1
\tfor index in range(4):
\t\tcounter += 1
\t\tp.write_state("counter", counter)
\t\t_probe("state", "tail", {"revision": p.host.get_ref().state_revision})
\tif steps == 40:
\t\tset_process(false)
`));
  let cancelledAt = null;
  const observed = await run('cancelled-pending-tail', f, { signal: controller.signal, onProgress: event => {
    const last = event.executionFrames?.frames.at(-1);
    if (last?.reference.event === 'state' && last.reference.revision === 160 && !controller.signal.aborted) {
      cancelledAt = structuredClone(last); controller.abort();
    }
  } });
  assert.ok(cancelledAt); const { view } = verify(observed);
  assert.equal(observed.result.status, 'cancelled'); assert.equal(view.phase, 'incomplete');
  assert.deepEqual(view.counts, { published: 1, settled: 0, pending: 1, deliveries: 2, handled: 0, skipped: 0, pendingDeliveries: 2 });
  const publication = view.items[0].published, frames = observed.result.record.executionFrames;
  assert.ok(frames.totalFrames - publication.executionFrameIndex > 128);
  assert.equal(frames.frames.some(row => row.index === publication.executionFrameIndex), false);
  assert.equal(observed.result.record.events.some(row => row.event === 'event-publish'), false);
  assert.deepEqual(frames.frames.at(-1), cancelledAt);
  const clock = observed.result.record.executionClock; assert.ok(clock.totalWindows > 32); assert.equal(clock.windows.length, 32);
  assert.equal(clock.windows.some(row => pair(row.clock) === pair(publication.clock)), false);
  const state = observed.result.record.runtime.project.sharedState; assert.equal(state.revision, 160);
  assert.equal(state.entries.find(row => row.key === 'counter').origin.bindingId, f.bindingId);
  assert.equal(observed.probes.some(row => row.kind === 'unexpected'), false);
  for (const probe of observed.probes.filter(row => row.kind === 'state')) {
    const frame = observed.envelopes.find(row => row.frame.event === 'state' && row.frame.revision === probe.revision);
    assert.deepEqual(frame?.clock, probe.clock);
  }
});

test('native event positions retain 32 settled publications plus pending recipients without trimming the complete business ledger', native, async t => {
  const f = await fixture(t);
  await f.script('checkpoint', driver(`\tfirst_token = p.subscribe_event("tick", _first)
\tlast_token = p.subscribe_event("tick", _last)
\tset_process(true)`, `var first_token := 0
var last_token := 0
var steps := 0
func _first(value) -> bool:
\tp.write_state("counter", value)
\t_delivered("first", int(value), first_token)
\treturn true
func _last(value) -> bool:
\t_delivered("last", int(value), last_token)
\treturn true
func _process(_delta: float) -> void:
\tsteps += 1
\t_published("tick", p.publish_event("tick", steps))
\tp.host.get_ref().flush_requests()
\tif steps == 40:
\t\tp.host.get_ref().flushing = true
\t\t_published("pending-tail", p.publish_event("tick", 41))
\t\tset_process(false)
\t\tcall_deferred("_release")
func _release() -> void:
\tp.host.get_ref().flushing = false
\tp.host.get_ref().flush_requests()
\t_finish()
`));
  const observed = await run('settled-retention', f); succeeded(observed);
  const { view, ledger } = verify(observed);
  assert.deepEqual(view.counts, { published: 41, settled: 41, pending: 0, deliveries: 82, handled: 82, skipped: 0, pendingDeliveries: 0 });
  assert.deepEqual(view.items.map(row => row.sequence), Array.from({ length: 32 }, (_, index) => index + 10));
  const live = observed.views.find(row => row.counts.published === 41 && row.counts.settled === 40 && row.counts.pending === 1);
  assert.ok(live); assert.equal(live.items.length, 33); assert.equal(live.retention.settled, 32); assert.equal(live.retention.pending, 1);
  assert.deepEqual(live.items.map(row => row.sequence), Array.from({ length: 33 }, (_, index) => index + 9));
  assert.ok(live.items.at(-1).deliveries.every(row => row.status === 'pending' && !Object.hasOwn(row, 'delivered')));
  assert.equal(ledger.sequence, 41); assert.equal(ledger.entries.length, 41); assert.equal(ledger.entries[0].sequence, 1);
  assert.equal(ledger.entries[0].origin.bindingId, f.bindingId);
  assert.ok(observed.result.record.executionFrames.retention.dropped > 0);
  assert.ok(observed.result.record.executionClock.totalWindows > 32);
  assert.equal(observed.result.record.executionClock.total.eventPublishes, 41);
  assert.equal(observed.result.record.executionClock.total.eventDeliveries, 82);
});

test('native event positions coexist with audio and animation requests while preserving event-first business ordering', native, async t => {
  const f = await fixture(t, { media: true });
  await f.script('checkpoint', driver(`\ttoken = p.subscribe_event("mix", _receive)
\tp.play_animation()
\tp.play_audio("${f.trackId}")
\t_published("mix", p.publish_event("mix", 1))
\thost.flush_requests()
\tcall_deferred("_finish")`, `var token := 0
func _receive(_value) -> bool:
\t_published("nested-empty", p.publish_event("empty", 2))
\tp.pause_animation()
\tp.stop_audio("${f.trackId}")
\tp.write_state("mixed", true)
\t_delivered("mixed-recipient", 1, token)
\treturn true
`));
  const observed = await run('mixed-event-audio-animation', f); succeeded(observed);
  const { view, ledger } = verify(observed);
  assert.deepEqual(view.counts, { published: 2, settled: 2, pending: 0, deliveries: 1, handled: 1, skipped: 0, pendingDeliveries: 0 });
  assert.deepEqual(ledger.entries.map(row => row.name), ['mix', 'empty']);
  assert.ok(view.items[1].published.executionFrameIndex < view.items[0].deliveries[0].delivered.executionFrameIndex);
  const interesting = observed.events.filter(row => ['event-publish', 'event-delivery', 'audio-command', 'animation-command'].includes(row.event));
  assert.deepEqual(interesting.map(row => row.event), ['event-publish', 'event-publish', 'event-delivery', 'audio-command', 'audio-command', 'animation-command', 'animation-command']);
  const record = observed.result.record;
  assert.equal(record.runtime.project.protocolVersion, 7); assert.equal(record.runtime.project.audioCommands.sequence, 2);
  assert.equal(record.runtime.project.animationCommands.sequence, 2);
  assert.deepEqual(record.audioRequests.counts, { accepted: 2, applied: 2, discarded: 0, pending: 0 });
  assert.deepEqual(record.animationRequests.counts, { accepted: 2, applied: 2, discarded: 0, pending: 0 });
  assert.equal(record.executionClock.total.eventPublishes, 2); assert.equal(record.executionClock.total.eventDeliveries, 1);
});
