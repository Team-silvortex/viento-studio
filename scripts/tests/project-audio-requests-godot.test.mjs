import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { projectAudioControlAuthor } from './helpers/project-audio-control-author-fixture.mjs';
import { buildProject, runProjectBuild } from '../adapters/node-project-build.mjs';
import { buildHash } from '../adapters/node-build-snapshot.mjs';

const tool = process.env.VIENTO_GODOT_BIN;
const native = { skip: !tool && 'Set VIENTO_GODOT_BIN for native audio request verification', timeout: 120000 };
const json = value => JSON.stringify(value, null, 2) + '\n';
const manifestPath = 'documents/behaviors/demo.json';
const framePrefix = 'VIENTO_EXECUTION_FRAME:', probePrefix = 'VIENTO_AUDIO_REQUEST_PROBE:';
const requestPrefix = 'VIENTO_AUDIO_REQUEST:';
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
  const files = new Set(['engine/project-queued-requests.mjs', 'engine/project-audio-requests.mjs', 'engine/project-audio-commands.mjs',
    'engine/project-animation-requests.mjs', 'engine/project-animation-commands.mjs', 'engine/project-animation-targets.mjs',
    'engine/project-execution-budget.mjs', 'engine/project-execution-frames.mjs', 'engine/project-execution-clock.mjs',
    'engine/project-runtime-events.mjs', 'engine/project-runtime-contracts.mjs', 'engine/project-runtime-query.mjs',
    'engine/project-causal-anchors.mjs', 'scripts/lib/project-build-service.mjs', 'scripts/adapters/node-project-build.mjs',
    'scripts/backends/godot4-adapter.mjs', 'scripts/backends/godot4-audio-requests.mjs', 'scripts/backends/godot4-animation-requests.mjs',
    'scripts/backends/godot4-execution-frames.mjs', 'scripts/backends/godot4-execution-clock.mjs', 'scripts/backends/godot4-execution-budget.mjs',
    'scripts/tests/project-audio-requests-godot.test.mjs', 'scripts/tests/helpers/project-audio-control-author-fixture.mjs',
    'scripts/tests/helpers/project-events-author-fixture.mjs', 'scripts/tests/helpers/project-scene-switching-fixture.mjs']);
  for (const entry of await fs.readdir(path.join(repository, 'scripts/backends/godot4')))
    if ((entry.startsWith('project-') || entry.startsWith('execution-') || entry.startsWith('animation-request-') || entry.startsWith('audio-request-') || entry.startsWith('audio-')) && entry.endsWith('.gd')) files.add(`scripts/backends/godot4/${entry}`);
  return Object.fromEntries(await Promise.all([...files].sort().map(async file => [file, buildHash(await fs.readFile(path.join(repository, file)))])));
}

async function fixture(t, { animation = false } = {}) {
  const f = await projectAudioControlAuthor(t);
  const manifest = await read(f, manifestPath);
  manifest.bindings = [{ ...manifest.bindings[0], parameters: {}, events: [] }];
  await write(f, manifestPath, manifest);
  await script(f, 'publisher', 'extends Node\n');
  await script(f, 'second', 'extends Node\n');
  if (animation) {
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
    scene.relations.push({ kind: 'animation', targetId: animationId, slot: 'scene animation' });
    await write(f, `metadata/documents/${f.sceneIds[0]}.json`, scene);
  }
  return { ...f, binding: manifest.bindings[0], bindingId: manifest.bindings[0].bindingId,
    script: (name, source) => script(f, name, source) };
}

async function run(name, f, options = {}) {
  const before = await authorHashes(f.author), sourcesBefore = await implementationHashes();
  const output = { stdout: '', stderr: '' }, events = [], views = [], animationViews = [];
  const built = await buildProject({ root: f.author, targetId: f.assemblyId, tool,
    output: path.join(f.temporary, 'audio-requests-build'), timeoutMs: 60000 });
  assert.equal(built.ok, true, json(built.record?.diagnostics || built));
  assert.equal(built.record.backend.version, '0.36.0');
  assert.ok(built.record.backend.capabilities.includes('runtime.audio-requests'));
  const afterBuild = await authorHashes(f.author); assert.deepEqual(afterBuild, before);
  const result = await runProjectBuild({ buildDirectory: built.buildDirectory, tool, headless: true, smoke: false,
    timeoutMs: 60000, ...options, onProgress: event => {
      if (event.output) output[event.output.stream] += event.output.text;
      if (event.event) events.push(event.event);
      if (event.audioRequests) views.push(event.audioRequests);
      if (event.animationRequests) animationViews.push(event.animationRequests);
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
  const envelopes = parse(framePrefix), probes = parse(probePrefix), wire = parse(requestPrefix);
  const animationWire = parse('VIENTO_ANIMATION_REQUEST:');
  const snapshot = JSON.parse(await fs.readFile(path.join(built.buildDirectory, 'snapshot.json')));
  const evidence = process.env.VIENTO_AUDIO_REQUESTS_EVIDENCE;
  if (evidence) {
    const directory = path.join(evidence, name); await fs.mkdir(directory, { recursive: true });
    const authorScripts = {};
    for (const file of Object.keys(before)) if (file.startsWith('documents/scripts/')) authorScripts[file] = await fs.readFile(path.join(f.author, file), 'utf8');
    await Promise.all([
      fs.writeFile(path.join(directory, 'summary.json'), json({ schemaVersion: 1, name, recordedAt: new Date().toISOString(),
        node: { version: process.version, executable: process.execPath, sha256: buildHash(await fs.readFile(process.execPath)) }, platform: process.platform, arch: process.arch, mode: 'headless', smoke: false,
        tool: { executable: tool, ...built.record.tool, sha256: buildHash(await fs.readFile(tool)) },
        observationScope: 'accepted queue requests and completed backend calls; no assertion about device or speaker playback', backend: built.record.backend, ok: result.ok, status: result.status,
        audioRequests: result.record.audioRequests, animationRequests: result.record.animationRequests ?? null, executionFrames: result.record.executionFrames, executionClock: result.record.executionClock,
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
      fs.writeFile(path.join(directory, 'request-updates.json'), json(views)),
      fs.writeFile(path.join(directory, 'animation-request-updates.json'), json(animationViews)),
      fs.writeFile(path.join(directory, 'stdout.log'), output.stdout), fs.writeFile(path.join(directory, 'stderr.log'), output.stderr),
    ]);
  }
  return { result, output, events, views, animationViews, envelopes, probes, snapshot, wire, animationWire };
}

// Actions use ordinary public author ports. Independent probes read real frame
// pairs after calls and synchronous drain. Delayed fixtures hold only the
// existing flush gate while actual engine callbacks advance, never the clock.
const driver = (start, methods = '') => `extends Node
var p
var accepted_count := 0
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
func _accepted(label: String, accepted: bool) -> void:
\tif accepted:
\t\taccepted_count += 1
\t_probe("accepted", label, {"accepted": accepted, "requestId": accepted_count if accepted else null, "reserved": p.host.get_ref().audio_control.reserved_count})
func _applied(label: String) -> void:
\t_probe("applied", label, {"commandSequence": p.host.get_ref().audio_control.sequence})
func _finish() -> void:
\tp.host.get_ref().finish_project()
${methods}`;

function succeeded(observed) {
  assert.equal(observed.result.ok, true, json(observed.result.record.diagnostics));
  assert.equal(observed.result.status, 'succeeded'); assert.deepEqual(observed.result.record.diagnostics, []);
  assert.deepEqual(observed.result.record.lifecycle, { started: true, completed: true });
  assert.equal(observed.result.record.audioRequests.phase, 'finished');
}
function verify(observed) {
  const view = observed.result.record.audioRequests;
  assert.equal(view.format, 'viento-project-audio-requests'); assert.equal(view.schemaVersion, 1);
  const accepted = observed.wire.filter(row => row.event === 'accepted');
  const applied = observed.wire.filter(row => row.event === 'applied');
  const discarded = observed.wire.filter(row => row.event === 'discarded');
  assert.deepEqual(view.counts, { accepted: accepted.length, applied: applied.length, discarded: discarded.length,
    pending: accepted.length - applied.length - discarded.length });
  assert.deepEqual(accepted.map(row => row.requestId), Array.from({ length: accepted.length }, (_, index) => index + 1));
  assert.deepEqual(observed.envelopes.map(row => row.frame), observed.events);
  const pending = [];
  for (const row of observed.wire) {
    assert.equal(row.protocol, 1); assert.equal(Object.hasOwn(row, 'index'), false);
    const expectedKeys = row.event === 'accepted' ? ['origin', 'trackId', 'action']
      : row.event === 'applied' ? ['commandSequence', 'executionFrameIndex'] : ['reason'];
    assert.deepEqual(Object.keys(row).sort(), ['protocol', 'event', 'requestId', 'clock', ...expectedKeys].sort());
    if (row.event === 'accepted') pending.push(row.requestId);
    else {
      assert.equal(pending.shift(), row.requestId, 'Only the global FIFO head can settle.');
      assert.ok(notBefore(row.clock, accepted[row.requestId - 1].clock));
      if (row.event === 'discarded') assert.equal(row.reason, 'abort');
    }
  }
  for (let index = 1; index < observed.wire.length; index++) assert.ok(notBefore(observed.wire[index].clock, observed.wire[index - 1].clock));
  assert.deepEqual(applied.map(row => row.commandSequence), Array.from({ length: applied.length }, (_, index) => index + 1));
  for (const row of applied) {
    const envelope = observed.envelopes.find(frame => frame.index === row.executionFrameIndex);
    const request = accepted[row.requestId - 1]; assert.ok(envelope);
    assert.equal(envelope.frame.event, 'audio-command'); assert.equal(envelope.frame.commandSequence, row.commandSequence);
    assert.deepEqual(envelope.clock, row.clock); assert.equal(envelope.frame.action, request.action);
    assert.equal(envelope.frame.trackId, request.trackId);
    for (const key of ['visitIndex', 'sceneId', 'bindingId', 'instanceId', 'objectId']) assert.equal(envelope.frame[key], request.origin[key]);
    const scene = observed.snapshot.plan.scenes.find(item => item.scene.objectId === request.origin.sceneId);
    assert.equal(envelope.frame.resourceId, scene.audio.document.tracks.find(track => track.id === request.trackId).resourceId);
    const lines = observed.output.stdout.split('\n');
    const frameAt = lines.findIndex(line => line.startsWith(framePrefix) && JSON.parse(line.slice(framePrefix.length)).index === row.executionFrameIndex);
    const appliedAt = lines.findIndex(line => line.startsWith(requestPrefix) && (() => { const item = JSON.parse(line.slice(requestPrefix.length)); return item.event === 'applied' && item.requestId === row.requestId; })());
    assert.ok(frameAt >= 0 && frameAt < appliedAt, 'The business call receipt precedes its observation marker.');
  }
  const terminal = Math.min(applied.length + discarded.length, 128);
  assert.deepEqual(view.retention, { limit: 128, total: accepted.length, retained: terminal + pending.length,
    dropped: accepted.length - terminal - pending.length, pending: pending.length, terminal,
    firstRequestId: view.requests[0]?.requestId ?? null, lastRequestId: view.requests.at(-1)?.requestId ?? null });
  assert.equal(view.requests.length, view.retention.retained);
  assert.deepEqual(view.requests.map(row => row.requestId), [...view.requests.map(row => row.requestId)].sort((a, b) => a - b));
  for (const row of view.requests) {
    const request = accepted[row.requestId - 1]; assert.ok(request);
    assert.deepEqual(row.acceptedClock, request.clock); assert.equal(row.action, request.action);
    for (const key of ['visitIndex', 'sceneId', 'bindingId', 'instanceId', 'objectId']) assert.equal(row.origin[key], request.origin[key]);
    const scene = observed.snapshot.plan.scenes.find(item => item.scene.objectId === request.origin.sceneId);
    const binding = scene.behaviors.bindings.find(item => item.bindingId === request.origin.bindingId);
    assert.deepEqual(row.origin.source, binding.declaration);
    const track = scene.audio.document.tracks.find(item => item.id === request.trackId);
    const location = scene.audio.locations.tracks.find(item => item.id === request.trackId);
    assert.deepEqual(row.track, { trackId: request.trackId, resourceId: track.resourceId, source: location.declaration });
    const outcome = observed.wire.find(item => item.requestId === row.requestId && item.event !== 'accepted');
    assert.equal(row.status, outcome?.event ?? 'pending');
    if (outcome?.event === 'applied') assert.deepEqual(row.applied, { clock: outcome.clock, commandSequence: outcome.commandSequence, executionFrameIndex: outcome.executionFrameIndex });
    else if (outcome?.event === 'discarded') assert.deepEqual(row.discarded, { clock: outcome.clock, reason: 'abort' });
    else { assert.equal(Object.hasOwn(row, 'applied'), false); assert.equal(Object.hasOwn(row, 'discarded'), false); }
  }
  // A forced cancellation can interrupt a post-acceptance probe; every probe
  // actually received still must match an independently observed request.
  for (const probe of observed.probes.filter(row => row.kind === 'accepted' && row.accepted)) {
    assert.deepEqual(accepted[probe.requestId - 1]?.clock, probe.clock); assert.equal(probe.reserved, probe.requestId);
  }
  assert.ok(observed.views.some(row => row.counts.accepted === view.counts.accepted));
  return { view, accepted, applied, discarded };
}
// These observations stop at the completed backend call. They do not measure
// an audio device, audible samples, or speaker playback.
const batch = trackId => `func _batch() -> void:
\t_accepted("play", p.play_audio("${trackId}"))
\t_accepted("stop", p.stop_audio("${trackId}"))
\t_accepted("play-again", p.play_audio("${trackId}"))
\t_accepted("stop-again", p.stop_audio("${trackId}"))
`;

test('native author ready audio requests preserve FIFO before their deferred backend calls', native, async t => {
  const f = await fixture(t);
  const source = driver(`\thost.flushing = false
\thost.flush_requests()
\t_applied("ready-backend-calls")
\tcall_deferred("_finish")`, batch(f.trackId)).replace('\tcall_deferred("_start")', '\tp.host.get_ref().flushing = true\n\t_batch()\n\tcall_deferred("_start")');
  await f.script('checkpoint', source);
  const observed = await run('author-ready-fifo', f); succeeded(observed);
  const { view, accepted, applied } = verify(observed);
  assert.deepEqual(view.counts, { accepted: 4, applied: 4, discarded: 0, pending: 0 });
  assert.deepEqual(accepted.map(row => row.action), ['play', 'stop', 'play', 'stop']);
  assert.ok(accepted.every(row => row.trackId === f.trackId && pair(row.clock) === pair(accepted[0].clock)));
  const probe = observed.probes.find(row => row.kind === 'applied'); assert.equal(probe.commandSequence, 4);
  assert.ok(applied.every(row => pair(row.clock) === pair(probe.clock)));
  assert.equal(observed.probes.filter(row => row.kind === 'accepted').length, 4);
  const lines = observed.output.stdout.split('\n');
  const readyAt = lines.findIndex(line => {
    if (!line.startsWith(framePrefix)) return false;
    const frame = JSON.parse(line.slice(framePrefix.length)).frame;
    return frame.event === 'scene-event' && frame.sceneId === f.sceneIds[0] && frame.stream === 'runtime' && frame.frame.event === 'ready';
  });
  const acceptedAt = lines.findIndex(line => line.startsWith(requestPrefix) && JSON.parse(line.slice(requestPrefix.length)).event === 'accepted');
  const appliedAt = lines.findIndex(line => line.startsWith(requestPrefix) && JSON.parse(line.slice(requestPrefix.length)).event === 'applied');
  assert.ok(readyAt >= 0 && readyAt < acceptedAt && acceptedAt < appliedAt);
  assert.ok(observed.views.some(row => row.counts.accepted === 4 && row.counts.applied === 0 && row.counts.pending === 4));
  assert.equal(observed.result.record.runtime.project.protocolVersion, 4);
  assert.equal(observed.result.record.executionClock.total.audioRequests, 4);
});

test('native audio request clocks follow actual idle and physics frames between acceptance and backend application', native, async t => {
  const f = await fixture(t);
  await f.script('checkpoint', driver(`\thost.flushing = true
\t_batch()
\theld_idle = Engine.get_process_frames()
\theld_physics = Engine.get_physics_frames()
\tset_process(true)`, `${batch(f.trackId)}
var held_idle := 0
var held_physics := 0
func _process(_delta: float) -> void:
\tif Engine.get_process_frames() <= held_idle + 3 or Engine.get_physics_frames() <= held_physics:
\t\treturn
\tset_process(false)
\tvar host = p.host.get_ref()
\thost.flushing = false
\thost.flush_requests()
\t_applied("later-frame")
\tcall_deferred("_finish")
`));
  const observed = await run('cross-frame', f); succeeded(observed);
  const { view, accepted, applied } = verify(observed);
  assert.deepEqual(view.counts, { accepted: 4, applied: 4, discarded: 0, pending: 0 });
  const probe = observed.probes.find(row => row.kind === 'applied'); assert.equal(probe.commandSequence, 4);
  for (const row of applied) {
    assert.deepEqual(row.clock, probe.clock);
    assert.ok(row.clock.idleFrame > accepted[row.requestId - 1].clock.idleFrame);
    assert.ok(row.clock.physicsFrame > accepted[row.requestId - 1].clock.physicsFrame);
  }
  assert.equal(observed.result.record.executionClock.total.audioRequests, 4);
  assert.equal(observed.result.record.runtime.project.audioCommands.sequence, 4);
});

test('native unavailable audio preserves the preceding completed call and explicitly discards the remaining FIFO on abort', native, async t => {
  const f = await fixture(t);
  await f.script('checkpoint', driver(`\t_accepted("first-stop", p.stop_audio("${f.trackId}"))
\thost.flush_requests()
\t_applied("first-stop")
\t_accepted("unavailable-play", p.play_audio("${f.trackId}"))
\t_accepted("later-stop", p.stop_audio("${f.trackId}"))
\t_accepted("later-play", p.play_audio("${f.trackId}"))
\t# Fault injection matches the existing audio control native fixture.
\thost.current.audio_started = false
\thost.flush_requests()
\t_applied("failed-backend-call")`));
  const observed = await run('unavailable-abort-discard', f), { view, applied, discarded } = verify(observed);
  assert.equal(observed.result.ok, false); assert.equal(observed.result.status, 'failed'); assert.equal(view.phase, 'incomplete');
  assert.deepEqual(view.counts, { accepted: 4, applied: 1, discarded: 3, pending: 0 });
  assert.deepEqual(applied.map(row => row.requestId), [1]); assert.deepEqual(discarded.map(row => row.requestId), [2, 3, 4]);
  assert.ok(observed.probes.filter(row => row.kind === 'accepted').every(row => row.accepted));
  assert.equal(observed.probes.find(row => row.label === 'failed-backend-call').commandSequence, 1);
  assert.equal(observed.result.record.executionClock.total.audioRequests, 4);
  assert.equal(observed.result.record.runtime.project.audioCommands.sequence, 1);
  assert.ok(observed.result.record.diagnostics.some(row => row.code === 'runtime_behavior_audio_unavailable'
    && row.bindingId === f.bindingId && row.sourcePath === 'documents/behaviors/demo.json'));
  assert.equal(observed.events.some(row => row.event === 'finished'), false);
});

test('native cancellation retains pending audio requests after 160 state revisions and both observation tails rotate', native, async t => {
  const f = await fixture(t), controller = new AbortController();
  await f.script('checkpoint', driver('\thost.flushing = true\n\t_batch()\n\tset_process(true)', `${batch(f.trackId)}
var steps := 0
var counter := 0
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
  assert.equal(observed.result.ok, false); assert.equal(observed.result.status, 'cancelled'); assert.equal(view.phase, 'incomplete');
  assert.deepEqual(view.counts, { accepted: 4, applied: 0, discarded: 0, pending: 4 });
  assert.ok(view.requests.every(row => row.status === 'pending'));
  assert.ok(observed.result.record.executionFrames.retention.dropped > 0);
  assert.ok(observed.result.record.executionClock.totalWindows > 32);
  assert.equal(observed.result.record.executionClock.windows.length, 32);
  assert.ok(view.requests.every(row => !observed.result.record.executionClock.windows.some(window => pair(window.clock) === pair(row.acceptedClock))));
  assert.deepEqual(observed.result.record.executionFrames.frames.at(-1), cancelledAt);
  const state = observed.result.record.runtime.project.sharedState; assert.equal(state.revision, 160);
  const entry = state.entries.find(row => row.key === 'counter'); assert.equal(entry.value, 160); assert.equal(entry.origin.bindingId, f.bindingId);
  assert.equal(observed.result.record.runtime.project.audioCommands.sequence, 0);
  assert.equal(observed.events.some(row => row.event === 'finished'), false);
  for (const probe of observed.probes.filter(row => row.kind === 'state')) {
    const frame = observed.envelopes.find(row => row.frame.event === 'state' && row.frame.revision === probe.revision);
    assert.deepEqual(frame?.clock, probe.clock);
  }
});

test('native audio retention keeps 128 terminal outcomes plus pending identities and all 148 old business receipts', native, async t => {
  const f = await fixture(t);
  await f.script('checkpoint', driver('\tset_process(true)', `${batch(f.trackId)}
var steps := 0
func _process(_delta: float) -> void:
\tsteps += 1
\t_batch()
\tp.host.get_ref().flush_requests()
\t_applied("batch-" + str(steps))
\tif steps == 36:
\t\t_batch()
\t\tset_process(false)
\t\tcall_deferred("_finish")
`));
  const observed = await run('terminal-retention', f); succeeded(observed);
  const { view } = verify(observed);
  assert.deepEqual(view.counts, { accepted: 148, applied: 148, discarded: 0, pending: 0 });
  assert.deepEqual(view.requests.map(row => row.requestId), Array.from({ length: 128 }, (_, index) => index + 21));
  const live = observed.views.find(row => row.counts.accepted === 148 && row.counts.applied === 144 && row.counts.pending === 4);
  assert.ok(live, 'All pending identities survive beside the full terminal tail.');
  assert.equal(live.requests.length, 132); assert.equal(live.retention.terminal, 128); assert.equal(live.retention.pending, 4);
  assert.deepEqual(live.requests.filter(row => row.status === 'pending').map(row => row.requestId), [145, 146, 147, 148]);
  const commands = observed.result.record.runtime.project.audioCommands;
  assert.equal(commands.sequence, 148); assert.equal(commands.entries.length, 148);
  assert.equal(commands.entries[0].sequence, 1); assert.equal(commands.entries[0].origin.bindingId, f.bindingId);
  assert.equal(commands.entries[0].track.source.objectId, f.firstAudioId);
  assert.ok(observed.result.record.executionFrames.retention.dropped > 0);
  assert.equal(observed.result.record.executionClock.total.audioRequests, 148);
  assert.ok(observed.result.record.executionClock.totalWindows > 32);
  assert.equal(observed.probes.filter(row => row.kind === 'accepted' && row.accepted).length, 148);
});

test('native mixed requests keep independent identities while audio backend calls retain priority over animation', native, async t => {
  const f = await fixture(t, { animation: true });
  await f.script('checkpoint', driver(`\thost.flushing = true
\t_probe("animation-accepted", "play", {"accepted": p.play_animation(), "requestId": 1})
\t_accepted("play", p.play_audio("${f.trackId}"))
\t_probe("animation-accepted", "pause", {"accepted": p.pause_animation(), "requestId": 2})
\t_accepted("stop", p.stop_audio("${f.trackId}"))
\thost.flushing = false
\thost.flush_requests()
\t_applied("mixed-audio")
\t_probe("animation-applied", "mixed-animation", {"commandSequence": host.animation_control.sequence})
\tcall_deferred("_finish")`));
  const observed = await run('mixed-audio-animation', f); succeeded(observed);
  const { view } = verify(observed), animation = observed.result.record.animationRequests;
  assert.deepEqual(view.counts, { accepted: 2, applied: 2, discarded: 0, pending: 0 });
  assert.equal(animation.format, 'viento-project-animation-requests'); assert.equal(animation.phase, 'finished');
  assert.deepEqual(animation.counts, view.counts);
  assert.deepEqual(animation.requests.map(row => [row.requestId, row.status]), [[1, 'applied'], [2, 'applied']]);
  const accepted = observed.animationWire.filter(row => row.event === 'accepted'), applied = observed.animationWire.filter(row => row.event === 'applied');
  assert.deepEqual(accepted.map(row => row.requestId), [1, 2]); assert.deepEqual(applied.map(row => row.requestId), [1, 2]);
  assert.deepEqual(accepted.map(row => row.command.action), ['play', 'pause']);
  for (const probe of observed.probes.filter(row => row.kind === 'animation-accepted')) {
    assert.equal(probe.accepted, true); assert.deepEqual(accepted[probe.requestId - 1].clock, probe.clock);
  }
  for (const row of animation.requests) {
    assert.deepEqual(row.acceptedClock, accepted[row.requestId - 1].clock);
    assert.equal(row.origin.bindingId, f.bindingId);
    assert.equal(row.origin.source.sourcePath, 'documents/behaviors/demo.json');
    const marker = applied[row.requestId - 1], frame = observed.envelopes.find(item => item.index === marker.executionFrameIndex);
    assert.deepEqual(row.applied, { clock: marker.clock, commandSequence: marker.commandSequence, executionFrameIndex: marker.executionFrameIndex });
    assert.equal(frame.frame.event, 'animation-command'); assert.equal(frame.frame.commandSequence, marker.commandSequence);
    assert.deepEqual(frame.clock, marker.clock); assert.deepEqual(frame.frame.command, row.command);
  }
  const commands = observed.events.filter(row => ['audio-command', 'animation-command'].includes(row.event));
  assert.deepEqual(commands.map(row => [row.event, row.commandSequence]), [['audio-command', 1], ['audio-command', 2], ['animation-command', 1], ['animation-command', 2]]);
  const rawOrder = observed.output.stdout.split('\n').filter(line => line.startsWith(requestPrefix) || line.startsWith('VIENTO_ANIMATION_REQUEST:')).map(line => {
    const kind = line.startsWith(requestPrefix) ? 'audio' : 'animation', prefix = kind === 'audio' ? requestPrefix : 'VIENTO_ANIMATION_REQUEST:';
    const row = JSON.parse(line.slice(prefix.length)); return [kind, row.event, row.requestId];
  });
  assert.deepEqual(rawOrder, [['animation', 'accepted', 1], ['audio', 'accepted', 1], ['animation', 'accepted', 2], ['audio', 'accepted', 2],
    ['audio', 'applied', 1], ['audio', 'applied', 2], ['animation', 'applied', 1], ['animation', 'applied', 2]]);
  assert.equal(observed.result.record.runtime.project.protocolVersion, 7);
  assert.equal(observed.result.record.runtime.project.audioCommands.sequence, 2);
  assert.equal(observed.result.record.runtime.project.animationCommands.sequence, 2);
  assert.equal(observed.result.record.executionClock.total.audioRequests, 2);
  assert.equal(observed.result.record.executionClock.total.animationRequests, 2);
});

test('native audio queue capacity rejects request 65 before identity allocation and discards only the 64 accepted requests', native, async t => {
  const f = await fixture(t);
  await f.script('checkpoint', driver(`\thost.flushing = true
\tfor index in range(65):
\t\t_accepted("capacity-" + str(index + 1), p.play_audio("${f.trackId}"))`));
  const observed = await run('queue-capacity-rejection', f), { view, accepted, discarded } = verify(observed);
  assert.equal(observed.result.ok, false); assert.equal(observed.result.status, 'failed'); assert.equal(view.phase, 'incomplete');
  assert.deepEqual(view.counts, { accepted: 64, applied: 0, discarded: 64, pending: 0 });
  assert.equal(accepted.at(-1).requestId, 64); assert.equal(discarded.at(-1).requestId, 64);
  assert.equal(observed.wire.some(row => row.requestId === 65), false);
  const probes = observed.probes.filter(row => row.kind === 'accepted'); assert.equal(probes.length, 65);
  assert.ok(probes.slice(0, 64).every(row => row.accepted)); assert.equal(probes[64].accepted, false);
  assert.equal(probes[64].requestId, null); assert.equal(probes[64].reserved, 64);
  assert.equal(observed.result.record.executionClock.total.audioRequests, 64);
  assert.equal(observed.result.record.runtime.project.audioCommands.sequence, 0);
  assert.ok(observed.result.record.diagnostics.some(row => row.code === 'runtime_behavior_audio_limit'
    && row.bindingId === f.bindingId && row.sourcePath === 'documents/behaviors/demo.json'));
});
