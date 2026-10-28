import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { projectEventsAuthor } from './helpers/project-events-author-fixture.mjs';
import { projectAnimationClipsAuthor } from './helpers/project-animation-clips-author-fixture.mjs';
import { buildProject, runProjectBuild } from '../adapters/node-project-build.mjs';
import { buildHash } from '../adapters/node-build-snapshot.mjs';
import { PROJECT_EXECUTION_BUDGET_POLICY } from '../../engine/project-execution-budget.mjs';

const tool = process.env.VIENTO_GODOT_BIN;
const native = { skip: !tool && 'Set VIENTO_GODOT_BIN for native host execution clock verification', timeout: 120000 };
const json = value => JSON.stringify(value, null, 2) + '\n';
const manifestPath = 'documents/behaviors/demo.json';
const probePrefix = 'VIENTO_CLOCK_PROBE:';
const zero = Object.fromEntries(Object.keys(PROJECT_EXECUTION_BUDGET_POLICY).map(key => [key, 0]));
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

// The ordinary TXT scripts use public author ports for all business actions.
// Test probes read the generated budget and real engine clock, and the private
// finish hook closes live fixtures without introducing a new author API.
const source = (body, methods = '') => `extends Node
var p
func _ready() -> void:
\tp = get_meta("viento_project")
${body}
func _probe(label: String) -> void:
\tprint("${probePrefix}" + JSON.stringify({"label": label, "clock": {"idleFrame": Engine.get_process_frames(), "physicsFrame": Engine.get_physics_frames()}, "used": p.host.get_ref().execution_budget.snapshot()}))
func _finish() -> void:
\tp.host.get_ref().finish_project()
${methods}`;

async function fixture(t, { animation = false } = {}) {
  const f = animation ? await projectAnimationClipsAuthor(t, { sprites: false }) : await projectEventsAuthor(t);
  const manifest = await read(f, manifestPath);
  manifest.bindings = [{ ...manifest.bindings[0], parameters: {}, events: [] }];
  await write(f, manifestPath, manifest);
  await script(f, 'second', 'extends Node\n');
  if (!animation) await script(f, 'publisher', 'extends Node\n');
  if (animation) {
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
  }
  return { ...f, binding: manifest.bindings[0] };
}

async function run(name, f, options = {}) {
  const before = await authorHashes(f.author), output = { stdout: '', stderr: '' }, frames = [], views = [];
  const built = await buildProject({ root: f.author, targetId: f.assemblyId, tool,
    output: path.join(f.temporary, 'execution-clock-build'), timeoutMs: 60000 });
  assert.equal(built.ok, true, json(built.record?.diagnostics || built));
  assert.equal(built.record.backend.version, built.record.backend.capabilities.includes('runtime.audio-requests') ? '0.36.0' : built.record.backend.protocolVersion === 4 ? '0.34.0' : '0.35.0');
  assert.deepEqual(await authorHashes(f.author), before);
  const result = await runProjectBuild({ buildDirectory: built.buildDirectory, tool, headless: true, smoke: false,
    timeoutMs: 60000, ...options, onProgress: event => {
      if (event.output) output[event.output.stream] += event.output.text;
      if (event.event) frames.push(event.event);
      if (event.executionClock) views.push(event.executionClock);
      options.onProgress?.(event);
    } });
  assert.deepEqual(await authorHashes(f.author), before);
  assert.ok(result.record, json(result));
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(result.sessionDirectory, 'session.json'))), result.record);
  await assert.rejects(fs.stat(path.join(result.sessionDirectory, 'project')), { code: 'ENOENT' });
  assert.equal(frames.length, result.record.eventRetention.total);
  const probes = output.stdout.split('\n').filter(line => line.startsWith(probePrefix)).map(line => JSON.parse(line.slice(probePrefix.length)));
  const snapshot = JSON.parse(await fs.readFile(path.join(built.buildDirectory, 'snapshot.json')));
  const evidence = process.env.VIENTO_EXECUTION_CLOCK_EVIDENCE;
  if (evidence) {
    const directory = path.join(evidence, name); await fs.mkdir(directory, { recursive: true });
    const sourceHashes = {};
    const sources = ['../../engine/project-runtime-events.mjs', '../../engine/project-execution-budget.mjs',
      '../../engine/project-execution-clock.mjs', '../backends/godot4-execution-clock.mjs',
      '../backends/godot4-execution-budget.mjs', '../adapters/node-project-build.mjs', '../backends/godot4-adapter.mjs'];
    for (const entry of await fs.readdir(new URL('../backends/godot4/', import.meta.url)))
      if ((entry.startsWith('project-') || entry.startsWith('execution-clock-')) && entry.endsWith('.gd')) sources.push(`../backends/godot4/${entry}`);
    for (const file of sources) sourceHashes[path.relative(path.resolve(new URL('../..', import.meta.url).pathname), new URL(file, import.meta.url).pathname)] = buildHash(await fs.readFile(new URL(file, import.meta.url)));
    sourceHashes['scripts/tests/project-execution-clock-godot.test.mjs'] = buildHash(await fs.readFile(new URL(import.meta.url)));
    const authorSources = {};
    for (const file of Object.keys(before)) if (file.startsWith('documents/scripts/')) authorSources[file] = await fs.readFile(path.join(f.author, file), 'utf8');
    await Promise.all([
      fs.writeFile(path.join(directory, 'summary.json'), json({ schemaVersion: 1, name, recordedAt: new Date().toISOString(),
        node: process.version, platform: process.platform, arch: process.arch, mode: 'headless', smoke: options.smoke ?? false,
        tool: { executable: tool, ...built.record.tool }, backend: built.record.backend, ok: result.ok, status: result.status,
        lifecycle: result.record.lifecycle, executionClock: result.record.executionClock, probes,
        authorFiles: Object.keys(before).length, authorUnchangedAfterBuildAndRun: true, diskRecordMatches: true,
        diagnostics: result.record.diagnostics, stdoutBytes: Buffer.byteLength(output.stdout), stderrBytes: Buffer.byteLength(output.stderr), sourceHashes })),
      fs.writeFile(path.join(directory, 'author-hashes.json'), json(before)),
      fs.writeFile(path.join(directory, 'author-scripts.json'), json(authorSources)),
      fs.writeFile(path.join(directory, 'build-snapshot.json'), json(snapshot)),
      fs.writeFile(path.join(directory, 'session.json'), json(result.record)),
      fs.writeFile(path.join(directory, 'observed-events.json'), json(frames)),
      fs.writeFile(path.join(directory, 'clock-updates.json'), json(views)),
      fs.writeFile(path.join(directory, 'stdout.log'), output.stdout),
      fs.writeFile(path.join(directory, 'stderr.log'), output.stderr),
    ]);
  }
  return { result, probes, output, frames, views, snapshot };
}

function succeeds(observed) {
  assert.equal(observed.result.ok, true, json(observed.result.record.diagnostics));
  assert.equal(observed.result.status, 'succeeded');
  assert.deepEqual(observed.result.record.diagnostics, []);
  assert.deepEqual(observed.result.record.lifecycle, { started: true, completed: true });
  assert.equal(observed.result.record.executionClock.phase, 'finished');
}
function rejects(observed, f, sourcePath = manifestPath) {
  assert.equal(observed.result.ok, false); assert.equal(observed.result.status, 'failed');
  assert.ok(observed.result.record.diagnostics.some(row => row.code === 'runtime_behavior_event_limit' && row.bindingId === f.binding.bindingId
    && row.sourcePath === sourcePath), json(observed.result.record.diagnostics));
  assert.equal(observed.result.record.diagnostics.some(row => row.code.includes('protocol_invalid')), false);
  assert.equal(observed.result.record.executionClock.phase, 'incomplete');
  assert.equal(observed.frames.some(row => row.event === 'finished'), false);
}
function clock(observed, total) {
  const value = observed.result.record.executionClock;
  assert.equal(value.format, 'viento-execution-clock-observation');
  assert.equal(value.schemaVersion, 1); assert.equal(value.policyVersion, 1);
  assert.deepEqual(value.limits, PROJECT_EXECUTION_BUDGET_POLICY);
  assert.deepEqual(value.total, expected(total));
  assert.equal(value.retention.limit, 32); assert.equal(value.retention.total, value.totalWindows);
  assert.equal(value.retention.retained, value.windows.length);
  assert.equal(value.retention.dropped, value.totalWindows - value.windows.length);
  assert.equal(value.retention.firstIndex, value.windows[0]?.index ?? null);
  assert.equal(value.retention.lastIndex, value.windows.at(-1)?.index ?? null);
  assert.deepEqual(value.windows.at(-1)?.total, value.total);
  assert.deepEqual(value.windows.map(row => row.index), Array.from({ length: value.windows.length }, (_, index) => value.retention.dropped + index + 1));
  for (let index = 1; index < value.windows.length; index++) {
    const prior = value.windows[index - 1], next = value.windows[index];
    assert.ok(next.clock.idleFrame >= prior.clock.idleFrame && next.clock.physicsFrame >= prior.clock.physicsFrame);
    assert.notDeepEqual(next.clock, prior.clock);
  }
  return value;
}
const pairKey = value => `${value.idleFrame}:${value.physicsFrame}`;

function verifyCounter(observed, f, count, key = 'counter') {
  const state = observed.result.record.runtime.project.sharedState;
  assert.equal(state.revision, count);
  const entry = state.entries.find(row => row.key === key);
  assert.equal(entry.value, count); assert.equal(entry.revision, count);
  assert.equal(entry.origin.bindingId, f.binding.bindingId); assert.equal(entry.origin.instanceId, f.binding.instanceId);
  assert.equal(entry.origin.visitIndex, 1); assert.equal(entry.origin.sceneId, f.entrySceneId);
  const scene = observed.snapshot.plan.scenes.find(scene => scene.scene.objectId === f.entrySceneId);
  assert.deepEqual(entry.origin.source, scene.behaviors.bindings[0].declaration);
}

test('native ready, deferred and process admissions follow actual host frame pairs', native, async t => {
  const f = await fixture(t);
  await script(f, 'checkpoint', source(`\tp.write_state("ready", true)
\t_probe("ready")
\tp.host.get_ref().flush_requests()
\t_probe("flushed")
\tcall_deferred("_deferred")`, `var steps := 0
func _deferred() -> void:
\tp.write_state("deferred", true)
\t_probe("deferred")
func _process(_delta: float) -> void:
\tsteps += 1
\tp.write_state("process", steps)
\t_probe("process-" + str(steps))
\tif steps == 2:
\t\tset_process(false)
\t\tcall_deferred("_finish")
`));
  const observed = await run('host-pairs', f); succeeds(observed);
  const value = clock(observed, { stateMutations: 4 });
  const ready = observed.probes.find(row => row.label === 'ready'), flushed = observed.probes.find(row => row.label === 'flushed');
  assert.deepEqual(flushed.clock, ready.clock); assert.deepEqual(flushed.used, ready.used);
  const admissionProbes = observed.probes.filter(row => row.label !== 'flushed');
  assert.deepEqual(value.windows.map(row => pairKey(row.clock)), [...new Set(admissionProbes.map(row => pairKey(row.clock)))]);
  assert.ok(value.totalWindows >= 2);
  for (const window of value.windows) assert.equal(window.used.stateMutations, admissionProbes.filter(row => pairKey(row.clock) === pairKey(window.clock)).length);
});

test('native physics callbacks advance windows using real physics frame stamps', native, async t => {
  const f = await fixture(t);
  await script(f, 'checkpoint', source('\tset_process(false)', `var steps := 0
func _physics_process(_delta: float) -> void:
\tsteps += 1
\tp.write_state("physics", steps)
\t_probe("physics-" + str(steps))
\tif steps == 4:
\t\tset_physics_process(false)
\t\tcall_deferred("_finish")
`));
  const observed = await run('physics-pairs', f); succeeds(observed);
  const value = clock(observed, { stateMutations: 4 });
  assert.equal(value.totalWindows, 4);
  assert.deepEqual(value.windows.map(row => row.clock), observed.probes.map(row => row.clock));
  for (let index = 1; index < observed.probes.length; index++) assert.equal(observed.probes[index].clock.physicsFrame, observed.probes[index - 1].clock.physicsFrame + 1);
  assert.ok(value.windows.every(row => row.used.stateMutations === 1));
  verifyCounter(observed, f, 4, 'physics');
});

test('native forty windows retain the latest thirty-two without losing cumulative state or author origins', native, async t => {
  const f = await fixture(t);
  await script(f, 'checkpoint', source('\tpass', `var steps := 0
func _process(_delta: float) -> void:
\tsteps += 1
\tp.write_state("counter", steps)
\tif steps == 40:
\t\t_probe("forty")
\t\tset_process(false)
\t\tcall_deferred("_finish")
`));
  const observed = await run('window-retention', f); succeeds(observed);
  const value = clock(observed, { stateMutations: 40 });
  assert.equal(value.totalWindows, 40); assert.equal(value.windows.length, 32); assert.equal(value.retention.dropped, 8);
  assert.ok(value.windows.every(row => row.used.stateMutations === 1 && row.total.stateMutations === row.index));
  assert.equal(observed.frames.filter(row => row.event === 'state').length, 40);
  verifyCounter(observed, f, 40);
});

test('native same-clock recursive publications cannot evade the shared session limit', native, async t => {
  const f = await fixture(t);
  await script(f, 'checkpoint', source('\tcall_deferred("_start")', `func _start() -> void:
\tp.subscribe_event("chain", _receive)
\tp.publish_event("chain", true)
func _receive(_value) -> bool:
\tif not p.publish_event("chain", true):
\t\t_probe("rejected")
\treturn true
`));
  const observed = await run('recursive-limit', f); rejects(observed, f);
  const value = clock(observed, { eventRegistrations: 1, eventPublishes: 128, eventDeliveries: 128, eventBytes: 768 });
  assert.equal(value.totalWindows, 1);
  assert.deepEqual(value.windows[0].used, value.total);
  assert.deepEqual(observed.probes[0].used, value.total);
  assert.deepEqual(observed.frames.filter(row => row.event === 'event-publish').map(row => row.sequence), Array.from({ length: 128 }, (_, index) => index + 1));
  assert.equal(observed.result.record.runtime.project.events.sequence, 128);
});

test('native flushes, scene switches and deferred calls preserve the budget and same-frame clock identity', native, async t => {
  const f = await fixture(t);
  await script(f, 'checkpoint', source('\tcall_deferred("_run")', `func _run() -> void:
\tvar host = p.host.get_ref()
\tfor index in range(64):
\t\tp.publish_event("tick", true)
\t\thost.flush_requests()
\tp.write_state("switched", true)
\t_probe("before-switch")
\tp.request_scene("${f.sceneIds[1]}")
`));
  await script(f, 'second', source('\tcall_deferred("_run")', `func _run() -> void:
\tvar host = p.host.get_ref()
\tfor index in range(64):
\t\tp.publish_event("tick", true)
\t\thost.flush_requests()
\t_probe("after-switch")
\tcall_deferred("_reject")
func _reject() -> void:
\tp.publish_event("tick", true)
\t_probe("rejected")
`));
  const observed = await run('session-boundaries', f);
  rejects(observed, { binding: { bindingId: f.secondBindingId } }, 'documents/behaviors/second.json');
  const value = clock(observed, { eventPublishes: 128, eventBytes: 640, stateMutations: 1 });
  assert.deepEqual(observed.probes.map(row => row.clock), [observed.probes[0].clock, observed.probes[0].clock, observed.probes[0].clock]);
  assert.equal(value.totalWindows, 1); assert.deepEqual(value.windows[0].used, value.total);
  assert.deepEqual(observed.frames.filter(row => row.event === 'scene-enter').map(row => row.sceneId), f.sceneIds);
  assert.equal(observed.result.record.runtime.project.sharedState.revision, 1);
});

test('native mixed event callbacks report the same seven dimensions as the shared budget', native, async t => {
  const f = await fixture(t, { animation: true });
  await script(f, 'checkpoint', source('\tcall_deferred("_run")', `func _run() -> void:
\tp.subscribe_event("mix", _receive)
\tp.write_state("initialized", true)
\tp.publish_event("mix", true)
\tp.host.get_ref().flush_requests()
\t_probe("mixed")
\tcall_deferred("_finish")
func _receive(_value) -> bool:
\treturn p.write_state("handled", true) and p.play_audio("${f.trackId}") and p.stop_audio("${f.trackId}") and p.select_animation_clip("${f.clipIds[0][0]}") and p.play_animation()
`));
  const observed = await run('mixed', f); succeeds(observed);
  const value = clock(observed, { eventRegistrations: 1, eventPublishes: 1, eventDeliveries: 1, eventBytes: 4,
    stateMutations: 2, audioRequests: 2, animationRequests: 2 });
  assert.equal(value.totalWindows, 1); assert.deepEqual(value.windows[0].used, value.total);
  assert.deepEqual(observed.probes[0].used, value.total);
  const project = observed.result.record.runtime.project;
  assert.equal(project.sharedState.revision, 2); assert.equal(project.events.sequence, 1);
  assert.equal(project.audioCommands.sequence, 2); assert.equal(project.animationCommands.sequence, 2);
});

test('native cancellation saves the last accepted clock summary as incomplete', native, async t => {
  const f = await fixture(t), controller = new AbortController();
  await script(f, 'checkpoint', source('\tpass', `var steps := 0
func _process(_delta: float) -> void:
\tif steps >= 40:
\t\treturn
\tsteps += 1
\tp.write_state("counter", steps)
`));
  let cancelledAt = null;
  const observed = await run('cancelled', f, { signal: controller.signal, onProgress: event => {
    if (event.executionClock?.total.stateMutations === 40 && !controller.signal.aborted) {
      cancelledAt = event.executionClock.totalWindows; controller.abort();
    }
  } });
  assert.equal(cancelledAt, 40);
  assert.equal(observed.result.status, 'cancelled', json(observed.result.record.diagnostics)); assert.equal(observed.result.ok, false);
  const value = clock(observed, { stateMutations: 40 });
  assert.equal(value.phase, 'incomplete'); assert.equal(value.totalWindows, 40); assert.equal(value.retention.dropped, 8);
  assert.equal(observed.result.record.lifecycle.completed, false);
  verifyCounter(observed, f, 40);
});
