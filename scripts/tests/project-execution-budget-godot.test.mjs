import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { projectEventsAuthor } from './helpers/project-events-author-fixture.mjs';
import { projectAnimationClipsAuthor } from './helpers/project-animation-clips-author-fixture.mjs';
import { buildProject, runProjectBuild } from '../adapters/node-project-build.mjs';
import { buildHash } from '../adapters/node-build-snapshot.mjs';

const tool = process.env.VIENTO_GODOT_BIN;
const native = { skip: !tool && 'Set VIENTO_GODOT_BIN for native shared execution budget verification', timeout: 120000 };
const json = value => JSON.stringify(value, null, 2) + '\n';
const manifestPath = 'documents/behaviors/demo.json';
const prefix = 'VIENTO_BUDGET_SNAPSHOT:';
const zero = { eventRegistrations: 0, eventPublishes: 0, eventDeliveries: 0, eventBytes: 0,
  stateMutations: 0, audioRequests: 0, animationRequests: 0 };
const expected = value => ({ ...zero, ...value });
const read = async (f, file) => JSON.parse(await fs.readFile(path.join(f.author, file)));
const write = async (f, file, value) => fs.writeFile(path.join(f.author, file), typeof value === 'string' ? value : json(value));
const script = (f, name, value) => write(f, `documents/scripts/${name}.txt`, value);

async function authorHashes(root) {
  const result = {};
  for (const entry of await fs.readdir(root, { recursive: true, withFileTypes: true })) if (entry.isFile()) {
    const file = path.join(entry.parentPath, entry.name), relative = path.relative(root, file);
    if (!relative.startsWith('.viento/')) result[relative] = buildHash(await fs.readFile(file));
  }
  return result;
}

// Test-only access reads the generated coordinator after ordinary author-port
// calls. These snapshots are not new protocol frames or a public author API.
const probe = (body, { ready = false, methods = '' } = {}) => `extends Node
var p
func _ready() -> void:
\tp = get_meta("viento_project")
${ready ? '\t_probe()' : '\tcall_deferred("_probe")'}
func _snapshot(label: String, details: Dictionary = {}) -> void:
\tvar host = p.host.get_ref()
\tprint("${prefix}" + JSON.stringify({"label": label, "used": host.execution_budget.snapshot(), "details": details}))
func _probe() -> void:
\tvar host = p.host.get_ref()
${body}
${methods}`;

async function fixture(t, { animation = false, instance = false } = {}) {
  const f = animation ? await projectAnimationClipsAuthor(t, { sprites: false }) : await projectEventsAuthor(t);
  const manifest = await read(f, manifestPath);
  manifest.bindings = [{ ...manifest.bindings[0], parameters: {}, events: [] }];
  await write(f, manifestPath, manifest);
  await script(f, 'second', 'extends Node\n');
  if (!animation) await script(f, 'publisher', 'extends Node\n');
  if (animation) {
    // Reuse the fixture's existing WAV and audio document, adding a declaration
    // to the first scene without modifying any checked-in author materials.
    const audioId = '12345678-1234-4234-8234-123456789ae1';
    const audio = await read(f, 'documents/audio/demo.json'); audio.cues = [];
    f.trackId = audio.tracks[0].id;
    await write(f, 'documents/audio/first.json', { ...audio, sceneObjectId: f.sceneIds[0] });
    const metadata = await read(f, 'metadata/documents/88888888-8888-4888-8888-888888888888.json');
    await write(f, `metadata/documents/${audioId}.json`, { ...metadata, id: audioId, sourcePath: 'documents/audio/first.json',
      relations: metadata.relations.map(row => row.targetId === f.sceneIds[1] ? { ...row, targetId: f.sceneIds[0] } : row) });
    const scene = await read(f, `metadata/documents/${f.sceneIds[0]}.json`);
    scene.relations.push({ kind: 'audio', targetId: audioId, slot: 'scene audio' });
    await write(f, `metadata/documents/${f.sceneIds[0]}.json`, scene);
    if (instance) {
      const document = await read(f, 'documents/animations/scene-0.json');
      document.schemaVersion = 4; document.playbackScope = 'instance';
      await write(f, 'documents/animations/scene-0.json', document);
    }
  }
  return { ...f, binding: manifest.bindings[0] };
}

async function run(name, f, { smoke = true } = {}) {
  const before = await authorHashes(f.author), output = { stdout: '', stderr: '' }, observed = [];
  const built = await buildProject({ root: f.author, targetId: f.assemblyId, tool,
    output: path.join(f.temporary, 'execution-budget-build'), timeoutMs: 60000 });
  assert.equal(built.ok, true, json(built.record?.diagnostics || built));
  assert.deepEqual(await authorHashes(f.author), before);
  const result = await runProjectBuild({ buildDirectory: built.buildDirectory, tool, headless: true, smoke,
    timeoutMs: 60000, onProgress: event => {
      if (event.output) output[event.output.stream] += event.output.text;
      if (event.event) observed.push(event.event);
    } });
  assert.deepEqual(await authorHashes(f.author), before);
  assert.ok(result.record, json(result));
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(result.sessionDirectory, 'session.json'))), result.record);
  await assert.rejects(fs.stat(path.join(result.sessionDirectory, 'project')), { code: 'ENOENT' });
  const snapshots = output.stdout.split('\n').filter(line => line.startsWith(prefix)).map(line => JSON.parse(line.slice(prefix.length)));
  const evidence = process.env.VIENTO_EXECUTION_BUDGET_EVIDENCE;
  if (evidence) {
    const directory = path.join(evidence, name); await fs.mkdir(directory, { recursive: true });
    const sourceHashes = {};
    const sourceFiles = ['../../engine/project-runtime-events.mjs', '../../engine/project-event-bus.mjs',
      '../../engine/project-execution-budget.mjs', '../backends/godot4-execution-budget.mjs',
      '../adapters/node-project-build.mjs', '../backends/godot4-project.mjs', '../backends/godot4-adapter.mjs'];
    for (const entry of await fs.readdir(new URL('../backends/godot4/', import.meta.url)))
      if (entry.startsWith('project-') && entry.endsWith('.gd')) sourceFiles.push(`../backends/godot4/${entry}`);
    for (const file of sourceFiles) sourceHashes[path.relative(path.resolve(new URL('../..', import.meta.url).pathname), new URL(file, import.meta.url).pathname)] = buildHash(await fs.readFile(new URL(file, import.meta.url)));
    sourceHashes['scripts/tests/project-execution-budget-godot.test.mjs'] = buildHash(await fs.readFile(new URL(import.meta.url)));
    const authorSources = {};
    for (const file of Object.keys(before)) if (file.startsWith('documents/scripts/')) authorSources[file] = await fs.readFile(path.join(f.author, file), 'utf8');
    const snapshot = JSON.parse(await fs.readFile(path.join(built.buildDirectory, 'snapshot.json')));
    await Promise.all([
      fs.writeFile(path.join(directory, 'summary.json'), json({ schemaVersion: 1, name, recordedAt: new Date().toISOString(),
        node: process.version, platform: process.platform, arch: process.arch, mode: 'headless', smoke,
        tool: { executable: tool, ...built.record.tool }, ok: result.ok, status: result.status, snapshots,
        lifecycle: result.record.lifecycle, diagnostics: result.record.diagnostics,
        authorFiles: Object.keys(before).length, authorUnchangedAfterBuildAndRun: true, diskRecordMatches: true,
        stdoutBytes: Buffer.byteLength(output.stdout), stderrBytes: Buffer.byteLength(output.stderr), sourceHashes })),
      fs.writeFile(path.join(directory, 'author-hashes.json'), json(before)),
      fs.writeFile(path.join(directory, 'author-scripts.json'), json(authorSources)),
      fs.writeFile(path.join(directory, 'build-snapshot.json'), json(snapshot)),
      fs.writeFile(path.join(directory, 'session.json'), json(result.record)),
      fs.writeFile(path.join(directory, 'observed-events.json'), json(observed)),
      fs.writeFile(path.join(directory, 'stdout.log'), output.stdout),
      fs.writeFile(path.join(directory, 'stderr.log'), output.stderr),
    ]);
  }
  assert.equal(observed.length, result.record.eventRetention.total);
  return { result, snapshots, output, frames: observed };
}

function succeeds(observed) {
  assert.equal(observed.result.ok, true, json(observed.result.record.diagnostics));
  assert.equal(observed.result.status, 'succeeded');
  assert.deepEqual(observed.result.record.diagnostics, []);
}
function rejects(observed, f, code, sourcePath = manifestPath) {
  assert.equal(observed.result.ok, false); assert.equal(observed.result.status, 'failed');
  assert.ok(observed.result.record.diagnostics.some(row => row.code === code && row.bindingId === f.binding.bindingId
    && row.sourcePath === sourcePath), json(observed.result.record.diagnostics));
  assert.equal(observed.result.record.diagnostics.some(row => row.code.includes('protocol_invalid')), false);
  assert.equal(observed.frames.some(row => row.event === 'finished'), false);
}
const used = (observed, label) => {
  const row = observed.snapshots.find(item => item.label === label);
  assert.ok(row, json({ label, snapshots: observed.snapshots, diagnostics: observed.result.record.diagnostics, stdout: observed.output.stdout.slice(-10000) }));
  return row.used;
};
const frames = (observed, kind) => observed.frames.filter(row => row.event === kind);

test('native shared budget leaves duplicate subscriptions and unchanged state uncharged', native, async t => {
  const f = await fixture(t);
  await script(f, 'checkpoint', probe(`\tvar first = p.subscribe_event("same", _receive)
\tvar duplicate = p.subscribe_event("same", _receive)
\tvar changed = p.write_state("score", 7)
\tvar unchanged = p.write_state("score", 7.0)
\tvar missing = p.erase_state("missing")
\t_snapshot("no-ops", {"first": first, "duplicate": duplicate, "changed": changed, "unchanged": unchanged, "missing": missing})`,
  { ready: true, methods: 'func _receive(_value) -> bool:\n\treturn true\n' }));
  const observed = await run('no-ops', f); succeeds(observed);
  assert.deepEqual(used(observed, 'no-ops'), expected({ eventRegistrations: 1, stateMutations: 1 }));
  assert.deepEqual(observed.snapshots[0].details, { first: 1, duplicate: 1, changed: true, unchanged: true, missing: false });
  assert.equal(observed.result.record.runtime.project.sharedState.revision, 1);
  assert.equal(frames(observed, 'event-publish').length, 0);
});

for (const [name, count, payload, admitted, bytes] of [
  ['pending-count', 65, 'true', 64, 64 * 6],
  ['pending-bytes', 4, '"x".repeat(4096)', 3, 3 * 4101],
]) test(`native ${name} rejection reserves no extra shared admission dimensions`, native, async t => {
  const f = await fixture(t), eventName = name === 'pending-count' ? 'queue' : 'bytes';
  await script(f, 'checkpoint', probe(`\tp.subscribe_event("${eventName}", _receive)
\tvar accepted := 0
\tfor index in range(${count}):
\t\tif p.publish_event("${eventName}", ${payload}):
\t\t\taccepted += 1
\t_snapshot("rejected", {"accepted": accepted, "pending": host.event_bus.pending_count(), "sequence": host.event_bus.sequence})`,
  { ready: true, methods: 'func _receive(_value) -> bool:\n\treturn true\n' }));
  const observed = await run(name, f); rejects(observed, f, 'runtime_behavior_event_limit');
  assert.deepEqual(used(observed, 'rejected'), expected({ eventRegistrations: 1, eventPublishes: admitted, eventDeliveries: admitted, eventBytes: bytes }));
  assert.deepEqual(observed.snapshots[0].details, { accepted: admitted, pending: admitted, sequence: admitted });
  assert.equal(frames(observed, 'event-publish').length, admitted);
  assert.equal(frames(observed, 'event-delivery').length, 0);
});

test('native recursive 129th publication fails with exactly 128 admissions and stable business sequences', native, async t => {
  const f = await fixture(t);
  await script(f, 'checkpoint', probe(`\tp.subscribe_event("chain", _receive)
\tp.publish_event("chain", true)`, { ready: true, methods: `func _receive(_value) -> bool:
\tif not p.publish_event("chain", true):
\t\t_snapshot("recursive-limit")
\treturn true
` }));
  const observed = await run('recursive-limit', f); rejects(observed, f, 'runtime_behavior_event_limit');
  assert.deepEqual(used(observed, 'recursive-limit'), expected({ eventRegistrations: 1, eventPublishes: 128, eventDeliveries: 128, eventBytes: 768 }));
  assert.deepEqual(frames(observed, 'event-publish').map(row => row.sequence), Array.from({ length: 128 }, (_, index) => index + 1));
  assert.equal(frames(observed, 'event-delivery').length, 127);
  assert.equal(observed.result.record.runtime.project.events.sequence, 128);
});

test('native deferred calls, explicit flushes and scene switches cannot reset a session budget', native, async t => {
  const f = await fixture(t);
  await script(f, 'checkpoint', probe(`\tfor index in range(64):
\t\tp.publish_event("tick", true)
\t\thost.flush_requests()
\tp.write_state("switched", true)
\t_snapshot("before-switch")
\tp.request_scene("${f.sceneIds[1]}")`));
  await script(f, 'second', probe(`\tfor index in range(64):
\t\tp.publish_event("tick", true)
\t\thost.flush_requests()
\t_snapshot("after-switch")
\tcall_deferred("_reject")`, { methods: `func _reject() -> void:
\tvar accepted = p.publish_event("tick", true)
\t_snapshot("deferred-rejected", {"accepted": accepted})
` }));
  const observed = await run('session-boundaries', f, { smoke: false });
  // The failure belongs to the second scene's registered author binding.
  rejects(observed, { binding: { bindingId: f.secondBindingId } }, 'runtime_behavior_event_limit', 'documents/behaviors/second.json');
  assert.deepEqual(used(observed, 'before-switch'), expected({ eventPublishes: 64, eventBytes: 320, stateMutations: 1 }));
  assert.deepEqual(used(observed, 'after-switch'), expected({ eventPublishes: 128, eventBytes: 640, stateMutations: 1 }));
  assert.deepEqual(used(observed, 'deferred-rejected'), used(observed, 'after-switch'));
  assert.deepEqual(observed.snapshots.at(-1).details, { accepted: false });
  assert.deepEqual(frames(observed, 'scene-enter').map(row => row.sceneId), f.sceneIds);
  assert.deepEqual(frames(observed, 'event-publish').map(row => row.sequence), Array.from({ length: 128 }, (_, index) => index + 1));
});

test('native event, state, audio and animation admissions share a coordinator with independent dimensions', native, async t => {
  const f = await fixture(t, { animation: true });
  await script(f, 'checkpoint', probe(`\tp.subscribe_event("mix", _receive)
\tp.write_state("initialized", true)
\tp.publish_event("mix", true)
\thost.flush_requests()
\t_snapshot("mixed", {"eventSequence": host.event_bus.sequence, "stateRevision": host.state_revision, "audioSequence": host.audio_control.sequence, "animationSequence": host.animation_control.sequence})`,
  { methods: `func _receive(_value) -> bool:
\treturn p.write_state("handled", true) and p.play_audio("${f.trackId}") and p.stop_audio("${f.trackId}") and p.select_animation_clip("${f.clipIds[0][0]}") and p.play_animation()
` }));
  const observed = await run('mixed', f); succeeds(observed);
  assert.deepEqual(used(observed, 'mixed'), expected({ eventRegistrations: 1, eventPublishes: 1, eventDeliveries: 1, eventBytes: 4,
    stateMutations: 2, audioRequests: 2, animationRequests: 2 }));
  assert.deepEqual(observed.snapshots[0].details, { eventSequence: 1, stateRevision: 2, audioSequence: 2, animationSequence: 2 });
  assert.deepEqual(frames(observed, 'audio-command').map(row => row.action), ['play', 'stop']);
  assert.deepEqual(frames(observed, 'animation-command').map(row => row.command.action), ['select', 'play']);
  assert.equal(observed.result.record.runtime.project.sharedState.revision, 2);
  assert.equal(observed.result.record.runtime.project.events.sequence, 1);
  assert.equal(observed.result.record.runtime.project.audioCommands.sequence, 2);
  assert.equal(observed.result.record.runtime.project.animationCommands.sequence, 2);
});

test('native instance animation keeps monotonic reserved stamps separate from applied command sequences', native, async t => {
  const f = await fixture(t, { animation: true, instance: true });
  await script(f, 'checkpoint', probe(`\tp.select_animation_clip("${f.clipIds[0][0]}")
\tp.play_animation()
\t_sample("reserved")
\thost.flush_requests()
\t_sample("applied")
\tp.pause_animation()
\t_sample("pause-reserved")
\thost.flush_requests()
\t_sample("paused")`, { methods: `func _sample(label: String) -> void:
\tvar host = p.host.get_ref()
\t_snapshot(label, {"reserved": host.animation_control.reserved_count, "sequence": host.animation_control.sequence, "pending": host.animation_control.pending_count()})
` }));
  const observed = await run('instance-stamps', f); succeeds(observed);
  assert.deepEqual(observed.snapshots.map(row => [row.label, row.details.reserved, row.details.sequence, row.details.pending]),
    [['reserved', 2, 0, 2], ['applied', 2, 2, 0], ['pause-reserved', 3, 2, 1], ['paused', 3, 3, 0]]);
  for (const label of ['reserved', 'applied']) assert.deepEqual(used(observed, label), expected({ animationRequests: 2 }));
  for (const label of ['pause-reserved', 'paused']) assert.deepEqual(used(observed, label), expected({ animationRequests: 3 }));
  const commands = frames(observed, 'animation-command');
  assert.deepEqual(commands.map(row => row.commandSequence), [1, 2, 3]);
  assert.ok(commands.every(row => row.target.kind === 'instance' && row.target.instanceId === f.instanceId));
  assert.equal(observed.result.record.runtime.project.animationCommands.sequence, 3);
});
