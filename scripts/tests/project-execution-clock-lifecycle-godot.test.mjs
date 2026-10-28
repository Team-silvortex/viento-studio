import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { projectAssemblyAuthor } from './helpers/project-assembly-backend-fixture.mjs';
import { buildProject, runProjectBuild } from '../adapters/node-project-build.mjs';
import { buildHash } from '../adapters/node-build-snapshot.mjs';
import { PROJECT_EXECUTION_BUDGET_POLICY } from '../../engine/project-execution-budget.mjs';

const tool = process.env.VIENTO_GODOT_BIN;
const native = { skip: !tool && 'Set VIENTO_GODOT_BIN for native execution clock lifecycle verification', timeout: 120000 };
const json = value => JSON.stringify(value, null, 2) + '\n';
const zero = Object.fromEntries(Object.keys(PROJECT_EXECUTION_BUDGET_POLICY).map(key => [key, 0]));
const scriptPath = 'documents/scripts/checkpoint.txt';
const manifestPath = 'documents/behaviors/demo.json';
const observerMessage = 'execution clock observer failure fixture';

async function authorHashes(root) {
  const result = {};
  for (const entry of await fs.readdir(root, { recursive: true, withFileTypes: true })) if (entry.isFile()) {
    const file = path.join(entry.parentPath, entry.name), relative = path.relative(root, file);
    if (!relative.startsWith('.viento/')) result[relative] = buildHash(await fs.readFile(file));
  }
  return result;
}

async function fixture(t, source) {
  const f = await projectAssemblyAuthor(t, { title: 'Execution clock lifecycle' });
  const manifestFile = path.join(f.author, manifestPath), manifest = JSON.parse(await fs.readFile(manifestFile));
  manifest.bindings = [{ ...manifest.bindings[0], parameters: {}, events: [] }];
  await fs.writeFile(manifestFile, json(manifest));
  await fs.writeFile(path.join(f.author, scriptPath), source);
  return { ...f, source, binding: manifest.bindings[0] };
}

async function run(name, f, options = {}) {
  const before = await authorHashes(f.author), output = { stdout: '', stderr: '' }, frames = [], views = [];
  const built = await buildProject({ root: f.author, targetId: f.assemblyId, tool,
    output: path.join(f.temporary, 'execution-clock-lifecycle-build'), timeoutMs: 60000 });
  assert.equal(built.ok, true, json(built.record?.diagnostics || built));
  assert.equal(built.record.backend.version, built.record.backend.capabilities.includes('runtime.audio-requests') ? '0.36.0' : '0.34.0');
  assert.deepEqual(await authorHashes(f.author), before);
  let result, escaped;
  try {
    result = await runProjectBuild({ buildDirectory: built.buildDirectory, tool, headless: true, smoke: true,
      timeoutMs: 60000, ...options, onProgress: event => {
        if (event.output) output[event.output.stream] += event.output.text;
        if (event.event) frames.push(event.event);
        if (event.executionClock) views.push(event.executionClock);
        options.onProgress?.(event);
      } });
  } catch (error) { escaped = { name: error.name, message: error.message, stack: error.stack }; }
  assert.deepEqual(await authorHashes(f.author), before);
  const sessions = await fs.readdir(path.join(built.buildDirectory, 'sessions'));
  assert.equal(sessions.length, 1);
  const sessionDirectory = path.join(built.buildDirectory, 'sessions', sessions[0]);
  const disk = JSON.parse(await fs.readFile(path.join(sessionDirectory, 'session.json')));
  await assert.rejects(fs.stat(path.join(sessionDirectory, 'project')), { code: 'ENOENT' });
  const snapshot = JSON.parse(await fs.readFile(path.join(built.buildDirectory, 'snapshot.json')));
  const evidence = process.env.VIENTO_EXECUTION_CLOCK_LIFECYCLE_EVIDENCE;
  if (evidence) {
    const directory = path.join(evidence, name); await fs.mkdir(directory, { recursive: true });
    const sources = ['../../engine/project-execution-clock.mjs', '../../engine/project-runtime-events.mjs',
      '../../engine/project-execution-budget.mjs', '../adapters/node-project-build.mjs', '../backends/godot4-adapter.mjs',
      '../backends/godot4-execution-clock.mjs', '../backends/godot4-execution-budget.mjs',
      '../backends/godot4/execution-clock-host.gd', '../backends/godot4/execution-clock-budget.gd',
      '../backends/godot4/project-execution-budget.gd', './project-execution-clock-lifecycle-godot.test.mjs'];
    const sourceHashes = {};
    for (const file of sources) sourceHashes[path.relative(path.resolve(new URL('../..', import.meta.url).pathname), new URL(file, import.meta.url).pathname)] = buildHash(await fs.readFile(new URL(file, import.meta.url)));
    await Promise.all([
      fs.writeFile(path.join(directory, 'summary.json'), json({ schemaVersion: 1, name, recordedAt: new Date().toISOString(),
        node: process.version, platform: process.platform, arch: process.arch, tool: { executable: tool, ...built.record.tool },
        backend: built.record.backend, mode: 'headless', smoke: options.smoke ?? true, ok: result?.ok ?? false,
        status: result?.status ?? 'escaped', escaped: escaped ?? null, observerFailure: f.observerFailure ?? null, executionClock: result?.record?.executionClock ?? disk.executionClock,
        lifecycle: result?.record?.lifecycle ?? disk.lifecycle, diagnostics: result?.record?.diagnostics ?? disk.diagnostics,
        sourceHashes, authorFiles: Object.keys(before).length, authorUnchangedAfterBuildAndRun: true,
        diskRecordMatches: result ? JSON.stringify(disk) === JSON.stringify(result.record) : false,
        stdoutBytes: Buffer.byteLength(output.stdout), stderrBytes: Buffer.byteLength(output.stderr) })),
      fs.writeFile(path.join(directory, 'author-hashes.json'), json(before)),
      fs.writeFile(path.join(directory, 'author-script.txt'), f.source),
      fs.writeFile(path.join(directory, 'build-snapshot.json'), json(snapshot)),
      fs.writeFile(path.join(directory, 'session.json'), json(disk)),
      fs.writeFile(path.join(directory, 'observed-events.json'), json(frames)),
      fs.writeFile(path.join(directory, 'clock-updates.json'), json(views)),
      fs.writeFile(path.join(directory, 'stdout.log'), output.stdout),
      fs.writeFile(path.join(directory, 'stderr.log'), output.stderr),
    ]);
  }
  assert.equal(escaped, undefined, json(escaped));
  assert.ok(result.record, json(result));
  assert.deepEqual(disk, result.record);
  assert.equal(frames.length, result.record.eventRetention.total);
  return { result, views, frames, snapshot };
}

test('native empty smoke session emits one zero-cost terminal clock window', native, async t => {
  const f = await fixture(t, 'extends Node\n');
  const observed = await run('empty-terminal', f), { record } = observed.result;
  assert.equal(observed.result.ok, true, json(record.diagnostics)); assert.equal(observed.result.status, 'succeeded');
  assert.deepEqual(record.diagnostics, []); assert.deepEqual(record.lifecycle, { started: true, completed: true });
  const clock = record.executionClock;
  assert.equal(clock.phase, 'finished'); assert.deepEqual(clock.total, zero); assert.equal(clock.totalWindows, 1);
  assert.equal(clock.windows.length, 1);
  const window = clock.windows[0];
  assert.equal(window.index, 1); assert.equal(window.reason, 'finished');
  assert.deepEqual(window.used, zero); assert.deepEqual(window.total, zero);
  assert.deepEqual(clock.retention, { limit: 32, total: 1, retained: 1, dropped: 0, firstIndex: 1, lastIndex: 1 });
  // This sole zero-cost terminal represents an empty session. No successful
  // reservation, synthetic tick replenishment, or gameplay mutation occurred.
  assert.ok(observed.views.filter(view => view.totalWindows > 0).every(view => view.phase === 'finished'));
  assert.equal(record.runtime.project.sharedState.revision, 0);
  assert.equal(record.runtime.project.events.sequence, 0);
});

test('native clock observer failure preserves the last admitted window and an incomplete disk session', native, async t => {
  const f = await fixture(t, `extends Node
func _ready() -> void:
\tvar project = get_meta("viento_project")
\tfor count in range(1, 6):
\t\tproject.write_state("counter", count)
`);
  const failure = f.observerFailure = { failedAt: null, firstWindowIndex: null, throwCount: 0 };
  const observed = await run('observer-failure', f, { smoke: false, onProgress: event => {
    if (event.executionClock?.totalWindows > 0) {
      failure.failedAt ??= event.executionClock.total.stateMutations;
      failure.firstWindowIndex ??= event.executionClock.windows.at(-1).index;
      failure.throwCount++;
      throw new Error(observerMessage);
    }
  } });
  assert.equal(failure.failedAt, 5); assert.equal(failure.firstWindowIndex, 1); assert.ok(failure.throwCount >= 1);
  const { record } = observed.result;
  assert.equal(observed.result.ok, false); assert.equal(observed.result.status, 'failed');
  assert.ok(record.diagnostics.some(row => row.code === 'build_failed' && row.severity === 'error'), json(record.diagnostics));
  assert.equal(record.diagnostics.some(row => row.code.includes('protocol_invalid')), false);
  const clock = record.executionClock;
  assert.equal(clock.phase, 'incomplete'); assert.deepEqual(clock.total, { ...zero, stateMutations: 5 });
  assert.equal(clock.totalWindows, 1); assert.deepEqual(clock.windows.at(-1).total, clock.total);
  assert.equal(record.lifecycle.completed, false);
  const state = record.runtime.project.sharedState, entry = state.entries.find(row => row.key === 'counter');
  assert.equal(state.revision, 5); assert.equal(entry.value, 5); assert.equal(entry.revision, 5);
  assert.equal(entry.origin.bindingId, f.binding.bindingId); assert.equal(entry.origin.instanceId, f.binding.instanceId);
  assert.equal(entry.origin.sceneId, f.entrySceneId); assert.equal(entry.origin.visitIndex, 1);
  const scene = observed.snapshot.plan.scenes.find(scene => scene.scene.objectId === f.entrySceneId);
  assert.deepEqual(entry.origin.source, scene.behaviors.bindings[0].declaration);
});
