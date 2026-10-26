import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { projectAssemblyAuthor } from './helpers/project-assembly-backend-fixture.mjs';
import { buildProject, runProjectBuild } from '../adapters/node-project-build.mjs';
import { buildHash } from '../adapters/node-build-snapshot.mjs';

const tool = process.env.VIENTO_GODOT_BIN;
const native = { skip: !tool && 'Set VIENTO_GODOT_BIN for native runtime retention verification', timeout: 120000 };
const json = value => JSON.stringify(value, null, 2) + '\n';
const scriptPath = 'documents/scripts/checkpoint.txt';
const manifestPath = 'documents/behaviors/demo.json';
const longLog = 'retention-log:' + 'x'.repeat(40000);

async function authorHashes(root) {
  const result = {};
  for (const entry of await fs.readdir(root, { recursive: true, withFileTypes: true })) if (entry.isFile()) {
    const file = path.join(entry.parentPath, entry.name), relative = path.relative(root, file);
    if (!relative.startsWith('.viento/')) result[relative] = buildHash(await fs.readFile(file));
  }
  return result;
}

async function fixture(t, ending) {
  const f = await projectAssemblyAuthor(t, { title: 'Runtime observation retention' });
  const manifestFile = path.join(f.author, manifestPath), manifest = JSON.parse(await fs.readFile(manifestFile));
  manifest.bindings = [{ ...manifest.bindings[0], parameters: {}, events: [] }];
  await fs.writeFile(manifestFile, json(manifest));
  // This ordinary TXT fixture reaches the generated coordinator only to close
  // a live test deterministically. Public author ports remain unchanged.
  const source = `extends Node
var project
func _ready() -> void:
\tproject = get_meta("viento_project")
\tcall_deferred("_retention_burst")
func _retention_burst() -> void:
\tprint("retention-log:" + "x".repeat(40000))
\tfor value in range(1, 301):
\t\tif not project.write_state("retention_counter", value):
\t\t\tpush_error("RETENTION_BURST_REJECTED")
\t\t\treturn
${ending === 'finish' ? '\tvar host = project.host.get_ref()\n\tif not host.smoke:\n\t\thost.finish_project()\n' : ending === 'error' ? '\tproject.write_state("invalid key", true)\n' : ''}`;
  await fs.writeFile(path.join(f.author, scriptPath), source);
  const before = await authorHashes(f.author), built = await buildProject({ root: f.author, targetId: f.assemblyId,
    tool, output: path.join(f.temporary, 'build'), timeoutMs: 60000 });
  assert.equal(built.status, 'succeeded', json(built.record?.diagnostics || built.diagnostics));
  assert.equal(built.ok, true);
  assert.deepEqual(await authorHashes(f.author), before);
  const snapshot = JSON.parse(await fs.readFile(path.join(built.buildDirectory, 'snapshot.json')));
  return { ...f, before, built, snapshot, source, binding: manifest.bindings[0] };
}

async function verifyRecord(f, result, { retainedLimit, completed }) {
  const record = result.record;
  assert.ok(record, json(result));
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(result.sessionDirectory, 'session.json'))), record);
  assert.deepEqual(await authorHashes(f.author), f.before);
  await assert.rejects(fs.stat(path.join(result.sessionDirectory, 'project')), { code: 'ENOENT' });
  assert.equal(record.runtime.project.sharedState.revision, 300);
  const entry = record.runtime.project.sharedState.entries.find(entry => entry.key === 'retention_counter');
  assert.equal(entry.value, 300); assert.equal(entry.revision, 300);
  assert.equal(entry.origin.bindingId, f.binding.bindingId);
  assert.equal(entry.origin.instanceId, f.binding.instanceId);
  assert.equal(entry.origin.visitIndex, 1); assert.equal(entry.origin.sceneId, f.entrySceneId);
  const scene = f.snapshot.plan.scenes.find(scene => scene.scene.objectId === f.entrySceneId);
  assert.deepEqual(entry.origin.source, scene.behaviors.bindings[0].declaration);
  assert.deepEqual(record.lifecycle, { started: true, completed });
  const retention = record.eventRetention;
  assert.equal(retention.limit, retainedLimit);
  assert.equal(retention.retained, record.events.length);
  assert.equal(retention.dropped, retention.total - retention.retained);
  assert.equal(retention.firstSequence, retention.dropped + 1);
  assert.equal(retention.lastSequence, retention.total);
  assert.ok(retention.total >= 303);
  if (retainedLimit === 128) {
    assert.equal(record.events.length, 128);
    assert.ok(retention.dropped > 0);
    assert.equal(record.events.some(frame => frame.event === 'ready'), false);
  } else {
    assert.equal(retention.dropped, 0);
    assert.equal(record.events[0].event, 'ready');
    assert.equal(record.events.filter(frame => frame.event === 'state').length, 300);
  }
  return record;
}

async function saveEvidence(name, f, result, { observed, output, smoke }) {
  const root = process.env.VIENTO_RUNTIME_RETENTION_EVIDENCE;
  if (!root) return;
  await fs.mkdir(root, { recursive: true });
  const record = result.record;
  const summary = { schemaVersion: 1, test: name, recordedAt: new Date().toISOString(),
    node: process.version, platform: process.platform, arch: process.arch,
    tool: { executable: tool, ...f.built.record.tool },
    source: { assemblyId: f.assemblyId, buildId: record.buildId, sessionId: record.sessionId, snapshotId: record.snapshotId,
      scriptPath, scriptSha256: buildHash(f.source), manifestPath, manifestSha256: f.before[manifestPath],
      authorFiles: Object.keys(f.before).length, unchangedAfterBuildAndRun: true,
      testSha256: buildHash(await fs.readFile(new URL(import.meta.url))),
      readerSha256: buildHash(await fs.readFile(new URL('../../engine/project-runtime-events.mjs', import.meta.url))),
      querySha256: buildHash(await fs.readFile(new URL('../../engine/project-runtime-query.mjs', import.meta.url))),
      hostSha256: buildHash(await fs.readFile(new URL('../adapters/node-project-build.mjs', import.meta.url))) },
    mode: 'headless', smoke, ok: result.ok, status: result.status, lifecycle: record.lifecycle,
    eventRetention: record.eventRetention, observedEventCount: observed.length,
    sharedState: record.runtime.project.sharedState,
    diagnostics: record.diagnostics, stdoutBytes: Buffer.byteLength(output.stdout), stderrBytes: Buffer.byteLength(output.stderr),
    runPhases: record.phases.map(({ phase, status, exitCode, exitSignal }) => ({ phase, status, exitCode, exitSignal })),
    diskRecordMatches: true };
  await Promise.all([
    fs.writeFile(path.join(root, `${name}.json`), json(summary)),
    fs.writeFile(path.join(root, `${name}.stdout.log`), output.stdout),
    fs.writeFile(path.join(root, `${name}.stderr.log`), output.stderr),
    fs.writeFile(path.join(root, `${name}.author.txt`), f.source),
  ]);
}

async function run(f, options = {}) {
  const observed = [], output = { stdout: '', stderr: '' };
  const result = await runProjectBuild({ buildDirectory: f.built.buildDirectory, tool, headless: true, timeoutMs: 60000,
    smoke: false, ...options, onProgress: event => {
      if (event.output) output[event.output.stream] += event.output.text;
      if (event.event) observed.push(event.event);
      options.onProgress?.(event);
    } });
  return { result, observed, output };
}

test('native live project finishes after ready rotates out and retains complete shared-state provenance', native, async t => {
  const f = await fixture(t, 'finish'), runResult = await run(f);
  const { result, observed, output } = runResult;
  assert.equal(result.status, 'succeeded', json(result.record?.diagnostics || result));
  assert.equal(result.ok, true);
  const record = await verifyRecord(f, result, { retainedLimit: 128, completed: true });
  assert.deepEqual(record.diagnostics, []);
  assert.equal(observed[0].event, 'ready'); assert.equal(observed.at(-1).event, 'finished');
  assert.equal(observed.length, record.eventRetention.total);
  assert.equal(observed.filter(frame => frame.event === 'state').length, 300);
  assert.ok(output.stdout.includes(longLog));
  assert.ok(output.stdout.length > 32768);
  await saveEvidence('live', f, result, { ...runResult, smoke: false });
});

test('native finite smoke keeps its full event record and completes the original half-second schedule', native, async t => {
  const f = await fixture(t, 'finish'), runResult = await run(f, { smoke: true });
  const { result, observed } = runResult;
  assert.equal(result.status, 'succeeded', json(result.record?.diagnostics || result));
  assert.equal(result.ok, true);
  const record = await verifyRecord(f, result, { retainedLimit: 4096, completed: true });
  assert.deepEqual(record.events, observed); assert.deepEqual(record.diagnostics, []);
  assert.equal(record.events.at(-1).event, 'finished');
  assert.equal(record.events.at(-1).totalSeconds, 0.5);
  await saveEvidence('smoke', f, result, { ...runResult, smoke: true });
});

test('native sourced runtime failure after rotation keeps admitted state and an incomplete lifecycle', native, async t => {
  const f = await fixture(t, 'error'), runResult = await run(f), { result } = runResult;
  assert.equal(result.status, 'failed', json(result)); assert.equal(result.ok, false);
  const record = await verifyRecord(f, result, { retainedLimit: 128, completed: false });
  const diagnostic = record.diagnostics.find(item => item.code === 'runtime_behavior_state_key');
  assert.ok(diagnostic, json(record.diagnostics));
  assert.equal(diagnostic.bindingId, f.binding.bindingId);
  assert.equal(diagnostic.sourcePath, manifestPath);
  assert.equal(diagnostic.propertyPath, '/bindings/0');
  assert.ok(record.events.some(frame => frame.frame?.event === 'diagnostic'));
  await saveEvidence('failure', f, result, { ...runResult, smoke: false });
});

test('native cancellation after 300 admitted mutations keeps the raw tail and never reports success', native, async t => {
  const f = await fixture(t, 'hold'), controller = new AbortController();
  let cancelledAt = null;
  const runResult = await run(f, { signal: controller.signal, onProgress: event => {
    if (event.event?.event === 'state' && event.event.revision === 300) { cancelledAt = event.event.revision; controller.abort(); }
  } });
  const { result } = runResult;
  assert.equal(cancelledAt, 300); assert.equal(result.status, 'cancelled', json(result)); assert.equal(result.ok, false);
  const record = await verifyRecord(f, result, { retainedLimit: 128, completed: false });
  assert.ok(record.diagnostics.length > 0);
  assert.ok(record.phases.some(phase => phase.status === 'cancelled'));
  await saveEvidence('cancelled', f, result, { ...runResult, smoke: false });
});

test('native observer failure after rotation preserves accepted evidence and failure diagnostics', native, async t => {
  const f = await fixture(t, 'hold');
  let failedAt = null;
  const runResult = await run(f, { onProgress: event => {
    if (event.event?.event === 'state' && event.event.revision === 300) {
      failedAt = event.event.revision; throw new Error('retention observer failure fixture');
    }
  } });
  const { result } = runResult;
  assert.equal(failedAt, 300); assert.equal(result.status, 'failed', json(result)); assert.equal(result.ok, false);
  const record = await verifyRecord(f, result, { retainedLimit: 128, completed: false });
  assert.ok(record.diagnostics.length > 0);
  assert.ok(record.phases.some(phase => phase.status === 'observer-failed'));
  await saveEvidence('observer-failure', f, result, { ...runResult, smoke: false });
});
