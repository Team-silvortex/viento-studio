import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { projectEventsAuthor } from './helpers/project-events-author-fixture.mjs';
import { projectAnimationClipsAuthor } from './helpers/project-animation-clips-author-fixture.mjs';
import { buildProject, runProjectBuild } from '../adapters/node-project-build.mjs';
import { buildHash } from '../adapters/node-build-snapshot.mjs';

const tool = process.env.VIENTO_GODOT_BIN;
const native = { skip: !tool && 'Set VIENTO_GODOT_BIN for native execution frame verification', timeout: 120000 };
const json = value => JSON.stringify(value, null, 2) + '\n';
const manifestPath = 'documents/behaviors/demo.json';
const framePrefix = 'VIENTO_EXECUTION_FRAME:', probePrefix = 'VIENTO_EXECUTION_FRAME_PROBE:';
const instanceB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';
const driverBinding = '62626262-6262-4262-8262-000000000019';
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
  const files = new Set(['engine/project-execution-frames.mjs', 'engine/project-execution-clock.mjs',
    'engine/project-runtime-events.mjs', 'engine/project-runtime-contracts.mjs', 'engine/project-runtime-query.mjs',
    'engine/project-causal-anchors.mjs', 'scripts/adapters/node-project-build.mjs',
    'scripts/backends/godot4-adapter.mjs', 'scripts/backends/godot4-execution-frames.mjs',
    'scripts/backends/godot4-execution-clock.mjs', 'scripts/backends/godot4-execution-budget.mjs',
    'scripts/tests/project-execution-frames-godot.test.mjs',
    'scripts/tests/helpers/project-events-author-fixture.mjs', 'scripts/tests/helpers/project-animation-clips-author-fixture.mjs',
    'scripts/tests/helpers/project-animation-control-author-fixture.mjs', 'scripts/tests/helpers/project-scene-switching-fixture.mjs']);
  for (const entry of await fs.readdir(path.join(repository, 'scripts/backends/godot4')))
    if ((entry.startsWith('project-') || entry.startsWith('execution-')) && entry.endsWith('.gd')) files.add(`scripts/backends/godot4/${entry}`);
  return Object.fromEntries(await Promise.all([...files].sort().map(async file => [file, buildHash(await fs.readFile(path.join(repository, file)))])));
}

// Business actions use public author ports. Independent probes read the real
// engine counters and committed revision after each synchronous mutation.
// The private finish hook only gives a live fixture a deterministic terminus.
const source = (ready, methods = '') => `extends Node
var p
var last_probe_idle := -1
func _ready() -> void:
\tp = get_meta("viento_project")
${ready}
func _probe(label: String) -> void:
\tvar host = p.host.get_ref()
\tlast_probe_idle = Engine.get_process_frames()
\tprint("${probePrefix}" + JSON.stringify({"label": label, "clock": {"idleFrame": Engine.get_process_frames(), "physicsFrame": Engine.get_physics_frames()}, "revision": host.state_revision}))
func _finish() -> void:
\tp.host.get_ref().finish_project()
${methods}`;

async function fixture(t, { instances = false } = {}) {
  const f = instances ? await projectAnimationClipsAuthor(t, { sprites: false }) : await projectEventsAuthor(t);
  const manifest = await read(f, manifestPath);
  manifest.bindings = [{ ...manifest.bindings[0], parameters: {}, events: [] }];
  await script(f, 'second', 'extends Node\n');
  if (!instances) await script(f, 'publisher', 'extends Node\n');
  if (instances) {
    manifest.bindings.push({ ...structuredClone(manifest.bindings[0]), bindingId: driverBinding,
      instanceId: instanceB, implementation: { ...manifest.bindings[0].implementation, sourceObjectId: f.secondScriptId } });
    await f.edit('metadata/documents/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee.json', document => {
      document.relations.push({ kind: 'reference', targetId: f.secondScriptId, slot: 'implementation' });
    });
    await f.edit('documents/animations/scene-0.json', document => {
      document.schemaVersion = 4; document.playbackScope = 'instance';
      document.tracks.push(...document.tracks.map((track, index) => ({ ...structuredClone(track),
        id: `62626262-6262-4262-8262-${String(index + 120).padStart(12, '0')}`, instanceId: instanceB })));
    });
  }
  await write(f, manifestPath, manifest);
  return { ...f, binding: manifest.bindings[0] };
}

async function run(name, f, options = {}) {
  const before = await authorHashes(f.author), sourcesBefore = await implementationHashes();
  const output = { stdout: '', stderr: '' }, events = [], views = [];
  const built = await buildProject({ root: f.author, targetId: f.assemblyId, tool,
    output: path.join(f.temporary, 'execution-frames-build'), timeoutMs: 60000 });
  assert.equal(built.ok, true, json(built.record?.diagnostics || built));
  assert.equal(built.record.backend.version, built.record.backend.capabilities.includes('runtime.audio-requests') ? '0.36.0' : built.record.backend.protocolVersion === 4 ? '0.34.0' : '0.35.0');
  const afterBuild = await authorHashes(f.author); assert.deepEqual(afterBuild, before);
  const result = await runProjectBuild({ buildDirectory: built.buildDirectory, tool, headless: true, smoke: false,
    timeoutMs: 60000, ...options, onProgress: event => {
      if (event.output) output[event.output.stream] += event.output.text;
      if (event.event) events.push(event.event);
      if (event.executionFrames) views.push(event.executionFrames);
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
  const evidence = process.env.VIENTO_EXECUTION_FRAMES_EVIDENCE;
  if (evidence) {
    const directory = path.join(evidence, name); await fs.mkdir(directory, { recursive: true });
    const authorScripts = {};
    for (const file of Object.keys(before)) if (file.startsWith('documents/scripts/')) authorScripts[file] = await fs.readFile(path.join(f.author, file), 'utf8');
    await Promise.all([
      fs.writeFile(path.join(directory, 'summary.json'), json({ schemaVersion: 1, name, recordedAt: new Date().toISOString(),
        node: process.version, platform: process.platform, arch: process.arch, mode: 'headless', smoke: false,
        tool: { executable: tool, ...built.record.tool }, backend: built.record.backend, ok: result.ok, status: result.status,
        executionFrames: result.record.executionFrames, executionClock: result.record.executionClock,
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
      fs.writeFile(path.join(directory, 'execution-frame-updates.json'), json(views)),
      fs.writeFile(path.join(directory, 'stdout.log'), output.stdout), fs.writeFile(path.join(directory, 'stderr.log'), output.stderr),
    ]);
  }
  return { result, output, events, views, envelopes, probes, snapshot };
}

function succeeds(observed) {
  assert.equal(observed.result.ok, true, json(observed.result.record.diagnostics));
  assert.equal(observed.result.status, 'succeeded'); assert.deepEqual(observed.result.record.diagnostics, []);
  assert.deepEqual(observed.result.record.lifecycle, { started: true, completed: true });
  assert.equal(observed.result.record.executionFrames.phase, 'finished');
}
function frames(observed) {
  const value = observed.result.record.executionFrames;
  assert.equal(value.format, 'viento-project-execution-frames'); assert.equal(value.schemaVersion, 1);
  assert.equal(value.totalFrames, observed.events.length); assert.equal(value.totalFrames, observed.envelopes.length);
  assert.equal(value.totalFrames, observed.result.record.eventRetention.total);
  assert.deepEqual(observed.envelopes.map(row => row.index), Array.from({ length: value.totalFrames }, (_, index) => index + 1));
  assert.deepEqual(observed.envelopes.map(row => row.frame), observed.events);
  assert.equal(observed.output.stdout.split('\n').some(line => line.startsWith('VIENTO_PROJECT:')), false, 'Each project DTO is emitted once.');
  assert.deepEqual(value.retention, { limit: 128, total: value.totalFrames,
    retained: Math.min(value.totalFrames, 128), dropped: Math.max(value.totalFrames - 128, 0),
    firstIndex: value.frames[0]?.index ?? null, lastIndex: value.frames.at(-1)?.index ?? null });
  assert.deepEqual(value.frames.map(row => row.index), observed.envelopes.slice(-128).map(row => row.index));
  for (const row of value.frames) {
    const envelope = observed.envelopes[row.index - 1];
    assert.deepEqual(Object.keys(row).sort(), ['clock', 'index', 'reference']); assert.deepEqual(row.clock, envelope.clock);
    assert.equal(row.reference.event, envelope.frame.event); assert.equal(row.reference.protocol, envelope.frame.protocol);
    assert.equal(Object.hasOwn(row, 'frame'), false, 'Position metadata does not duplicate payloads.');
    for (const key of ['revision', 'sequence', 'commandSequence', 'targetCommandSequence', 'subscriptionId'])
      if (Object.hasOwn(envelope.frame, key)) assert.equal(row.reference[key], envelope.frame[key]);
  }
  for (let index = 1; index < observed.envelopes.length; index++) {
    const previous = observed.envelopes[index - 1].clock, current = observed.envelopes[index].clock;
    assert.ok(current.idleFrame >= previous.idleFrame && current.physicsFrame >= previous.physicsFrame);
  }
  assert.ok(observed.views.some(view => view.totalFrames === value.totalFrames));
  return value;
}
function probesMatchState(observed, complete = true) {
  const states = observed.envelopes.filter(row => row.frame.event === 'state');
  if (complete) {
    assert.equal(states.length, observed.probes.length);
    assert.deepEqual(observed.probes.map(row => row.revision), states.map(row => row.frame.revision));
  }
  for (const probe of observed.probes) {
    const envelope = states.find(row => row.frame.revision === probe.revision); assert.ok(envelope, json(probe));
    assert.deepEqual(envelope.clock, probe.clock, `Revision ${probe.revision} uses the real engine frame pair.`);
  }
}
function stateOrigin(observed, f, revision) {
  const state = observed.result.record.runtime.project.sharedState; assert.equal(state.revision, revision);
  const entry = state.entries.find(row => row.key === 'counter');
  assert.equal(entry.value, revision); assert.equal(entry.revision, revision);
  assert.equal(entry.origin.bindingId, f.binding.bindingId); assert.equal(entry.origin.instanceId, f.binding.instanceId);
  assert.equal(entry.origin.visitIndex, 1); assert.equal(entry.origin.sceneId, f.sceneIds[0]);
  const declaration = observed.snapshot.plan.scenes.find(row => row.scene.objectId === f.sceneIds[0]).behaviors.bindings.find(row => row.bindingId === f.binding.bindingId);
  assert.deepEqual(entry.origin.source, declaration.declaration);
}
const tail = ({ finish = true } = {}) => source('\tset_physics_process(false)', `var steps := 0
var counter := 0
func _process(_delta: float) -> void:
\tsteps += 1
\tfor index in range(4):
\t\tcounter += 1
\t\tp.write_state("counter", counter)
\t\t_probe("counter-" + str(counter))
\tif steps == 40:
\t\tset_process(false)
${finish ? '\t\tcall_deferred("_finish")' : ''}
`);

test('native business frames match independent ready, deferred, process and physics stamps, including zero-cost completion', native, async t => {
  const f = await fixture(t);
  await script(f, 'checkpoint', source(`\tp.write_state("ready", true)
\t_probe("ready")
\tcall_deferred("_deferred")`, `var process_steps := 0
var physics_steps := 0
var deferred_done := false
func _deferred() -> void:
\tp.write_state("deferred", true)
\t_probe("deferred")
\tdeferred_done = true
func _process(_delta: float) -> void:
\tprocess_steps += 1
\tif process_steps <= 3:
\t\tp.write_state("process", process_steps)
\t\t_probe("process-" + str(process_steps))
\tif process_steps >= 8 and physics_steps >= 3 and deferred_done and Engine.get_process_frames() > last_probe_idle + 3:
\t\tset_process(false)
\t\tcall_deferred("_finish")
func _physics_process(_delta: float) -> void:
\tphysics_steps += 1
\tp.write_state("physics", physics_steps)
\t_probe("physics-" + str(physics_steps))
\tif physics_steps == 3:
\t\tset_physics_process(false)
`));
  const observed = await run('callback-clock-pairs', f); succeeds(observed); frames(observed); probesMatchState(observed);
  assert.equal(observed.probes.length, 8);
  for (const label of ['ready', 'deferred', 'process-1', 'process-2', 'process-3', 'physics-1', 'physics-2', 'physics-3'])
    assert.ok(observed.probes.some(row => row.label === label), label);
  const budget = observed.result.record.executionClock; assert.equal(budget.total.stateMutations, 8);
  const finished = observed.envelopes.find(row => row.frame.event === 'finished'); assert.ok(finished);
  assert.equal(budget.windows.some(window => pair(window.clock) === pair(finished.clock)), false,
    'A zero-cost finished frame has a precise position without inventing a budget window.');
  assert.equal(observed.result.record.runtime.project.sharedState.revision, 8);
});

test('native 160 business commits retain the last 128 positions across forty budget windows and preserve state origins', native, async t => {
  const f = await fixture(t); await script(f, 'checkpoint', tail());
  const observed = await run('retained-business-tail', f); succeeds(observed);
  const value = frames(observed); probesMatchState(observed); stateOrigin(observed, f, 160);
  assert.ok(value.totalFrames > 160); assert.equal(value.frames.length, 128); assert.ok(value.retention.dropped > 0);
  assert.equal(value.frames.some(row => row.reference.event === 'state' && row.reference.revision === 1), false);
  assert.ok(value.frames.some(row => row.reference.event === 'state' && row.reference.revision === 160));
  assert.equal(observed.result.record.executionClock.totalWindows, 40);
  assert.equal(observed.result.record.executionClock.windows.length, 32);
  assert.equal(observed.result.record.executionClock.retention.dropped, 8);
  assert.equal(observed.result.record.executionClock.total.stateMutations, 160);
  assert.equal(observed.result.record.events.length, 128);
});

test('native cancellation preserves the last admitted business position after raw and budget tails rotate', native, async t => {
  const f = await fixture(t), controller = new AbortController(); await script(f, 'checkpoint', tail({ finish: false }));
  let cancelledAt = null;
  const observed = await run('cancelled-business-tail', f, { signal: controller.signal, onProgress: event => {
    const last = event.executionFrames?.frames.at(-1);
    if (last?.reference.event === 'state' && last.reference.revision === 160 && !controller.signal.aborted) {
      cancelledAt = structuredClone(last); controller.abort();
    }
  } });
  assert.ok(cancelledAt); assert.equal(observed.result.ok, false);
  assert.equal(observed.result.status, 'cancelled', json(observed.result.record.diagnostics));
  const value = frames(observed); probesMatchState(observed, false); stateOrigin(observed, f, 160);
  assert.equal(value.phase, 'incomplete'); assert.equal(value.frames.length, 128); assert.deepEqual(value.frames.at(-1), cancelledAt);
  assert.ok(observed.probes.length >= 156, 'Cancellation may interrupt the final post-commit probes only.');
  assert.ok(observed.result.record.executionClock.totalWindows > 32); assert.equal(observed.result.record.executionClock.windows.length, 32);
  assert.equal(observed.result.record.lifecycle.completed, false); assert.equal(observed.events.some(row => row.event === 'finished'), false);
  assert.equal(observed.result.record.diagnostics.some(row => row.code.includes('protocol_invalid') || row.code.startsWith('runtime_execution_frame_')), false);
});

test('native scoped animation commands and completions retain original protocol identities inside precise envelopes', native, async t => {
  const f = await fixture(t, { instances: true });
  await script(f, 'checkpoint', source('\tset_process(false)\n\tset_physics_process(false)\n\tcall_deferred("_run")', `func _run() -> void:
\tvar host = p.host.get_ref()
\thost.set_process(false)
\tvar q
\tfor actor in host.current.actors:
\t\tif actor["instanceId"] == "${instanceB}":
\t\t\tq = actor["node"].get_node("behavior_${driverBinding.replaceAll('-', '_')}").get_meta("viento_project")
\tp.select_animation_clip("${f.clipIds[0][1]}")
\tp.play_animation()
\tq.select_animation_clip("${f.clipIds[0][0]}")
\tq.play_animation()
\thost.flush_requests()
\thost.elapsed_seconds += 0.5
\thost.total_seconds += 0.5
\thost.current.project_step(0.5)
\thost.flush_requests()
\tp.write_state("counter", 1)
\t_probe("mixed-complete")
\tcall_deferred("_finish")
`));
  const observed = await run('scoped-animation', f); succeeds(observed); frames(observed); probesMatchState(observed); stateOrigin(observed, f, 1);
  const project = observed.result.record.runtime.project; assert.equal(project.protocolVersion, 11);
  assert.equal(project.animationCommands.sequence, 4); assert.equal(project.animationCompletions.sequence, 1);
  const commands = observed.envelopes.filter(row => row.frame.event === 'animation-command');
  assert.deepEqual(commands.map(row => row.frame.commandSequence), [1, 2, 3, 4]);
  assert.deepEqual(commands.map(row => row.frame.target), [
    { kind: 'instance', instanceId: f.instanceId }, { kind: 'instance', instanceId: f.instanceId },
    { kind: 'instance', instanceId: instanceB }, { kind: 'instance', instanceId: instanceB },
  ]);
  const completion = observed.envelopes.find(row => row.frame.event === 'animation-completed'); assert.ok(completion);
  assert.equal(completion.frame.commandSequence, 4); assert.equal(completion.frame.targetCommandSequence, 2);
  assert.deepEqual(completion.frame.target, { kind: 'instance', instanceId: f.instanceId });
  assert.deepEqual(completion.clock, observed.probes[0].clock);
  assert.ok(commands.every(row => pair(row.clock) === pair(observed.probes[0].clock)));
  for (const command of project.animationCommands.entries) {
    const expectedBinding = command.sequence <= 2 ? f.binding.bindingId : driverBinding;
    assert.equal(command.origin.bindingId, expectedBinding);
    const declaration = observed.snapshot.plan.scenes[0].behaviors.bindings.find(row => row.bindingId === expectedBinding);
    assert.deepEqual(command.origin.source, declaration.declaration);
  }
});
