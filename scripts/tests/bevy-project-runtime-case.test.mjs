import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { projectAssemblyAuthor } from './helpers/project-assembly-backend-fixture.mjs';
import { captureBuildSnapshot } from '../adapters/node-build-snapshot.mjs';
import { buildProject, runProjectBuild } from '../adapters/node-project-build.mjs';
import { createExecutionBackendRegistry } from '../adapters/node-execution-backends.mjs';
import { BEVY_EXECUTION_ADAPTER as adapter } from '../backends/bevy-adapter.mjs';

const tool = process.env.VIENTO_BEVY_BIN;
const foreignInstance = '12345678-1234-4234-8234-123456789def';
const released = () => ({ left: false, right: false, up: false, down: false });
async function author(t) {
  const f = await projectAssemblyAuthor(t, { entry: 'audio' });
  for (const [index, id] of f.sceneIds.entries()) {
    const meta = path.join(f.author, `metadata/documents/${id}.json`), metadata = JSON.parse(await fs.readFile(meta));
    metadata.relations = metadata.relations.filter(item => item.kind === 'reference'); await fs.writeFile(meta, JSON.stringify(metadata));
    const file = path.join(f.author, metadata.sourcePath), scene = JSON.parse(await fs.readFile(file));
    for (const actor of scene.actors) { delete actor.imageResourceId; actor.controls = 'arrows'; actor.speed = 80; }
    if (index === 0) scene.actors[0].instanceId = foreignInstance;
    await fs.writeFile(file, JSON.stringify(scene));
  }
  await fs.rm(path.join(f.author, 'metadata/documents/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee.json'));
  await fs.rm(path.join(f.author, 'metadata/documents/88888888-8888-4888-8888-888888888888.json'));
  const captured = await captureBuildSnapshot(f.author, f.assemblyId);
  assert.equal(captured.ok, true, JSON.stringify(captured.diagnostics));
  f.entry = captured.plan.scenes.find(scene => scene.scene.objectId === f.entrySceneId);
  return f;
}
function runtimeCase(entry) {
  const [first, second] = entry.actors;
  return { format: 'viento-runtime-case', schemaVersion: 1,
    program: { format: 'viento-runtime-control', schemaVersion: 2, fixedDelta: 0.125,
      steps: [{ inputs: [{ instanceId: first.instanceId, ...released(), right: true }] }, { inputs: [] }] },
    checks: [{ instanceId: first.instanceId, stepIndex: 0,
      position: { value: [first.position[0] + 10, first.position[1]], tolerance: 0.0001 }, state: 'moving' },
    { instanceId: second.instanceId, stepIndex: 1, position: { value: second.position, tolerance: 0.0001 }, state: 'idle' }] };
}

// These runs use the real independently built Bevy process; no window or hardware input is implied.
test('real Bevy project verifies only its frozen entry and retains failed, cancelled and invalid verdicts', { skip: !tool }, async t => {
  const f = await author(t);
  const built = await buildProject({ root: f.author, scene: f.assemblyId, backendId: adapter.descriptor.id, tool,
    output: path.join(f.temporary, 'build'), timeoutMs: 60000 });
  assert.equal(built.ok, true, JSON.stringify(built.diagnostics || built.record?.diagnostics));
  const args = { buildDirectory: built.buildDirectory, tool, timeoutMs: 60000, runtimeCaseSceneId: f.entrySceneId,
    expectedBuildId: built.record.buildId, expectedSnapshotId: built.record.snapshotId };
  const definition = runtimeCase(f.entry);
  // Mutable author changes after the build must never redirect the frozen case.
  const entryPath = path.join(f.author, f.entry.scene.sourcePath);
  const authorScene = JSON.parse(await fs.readFile(entryPath)); authorScene.actors[0].position = [999, 999];
  const authorBytes = JSON.stringify(authorScene); await fs.writeFile(entryPath, authorBytes);
  const passing = await runProjectBuild({ ...args, runtimeCase: definition });
  assert.equal(await fs.readFile(entryPath, 'utf8'), authorBytes);

  assert.equal(passing.ok, true, JSON.stringify(passing.diagnostics || passing.record?.diagnostics));
  assert.equal(passing.record.target.objectId, f.assemblyId); assert.equal(passing.record.target.entrySceneId, f.entrySceneId);
  assert.equal(passing.record.runtime.project.visits[0].sceneId, f.entrySceneId);
  assert.equal(passing.record.verification.evaluation.status, 'passed'); assert.equal(passing.record.verification.evaluation.complete, true);
  assert.equal(passing.record.control.samples.length, 2);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(passing.sessionDirectory, 'session.json'))).verification, passing.record.verification);
  const bad = structuredClone(definition); bad.checks[0].position.value[0] += 100;
  const failed = await runProjectBuild({ ...args, runtimeCase: bad });
  assert.equal(failed.ok, false); assert.equal(failed.status, 'succeeded');
  assert.equal(failed.record.verification.evaluation.status, 'failed');
  for (const invalid of [
    { runtimeCase: definition, runtimeCaseSceneId: f.sceneIds[0] },
    { runtimeCase: definition, runtimeCaseSceneId: undefined },
  ]) {
    const rejected = await runProjectBuild({ ...args, ...invalid });
    assert.equal(rejected.ok, false); assert.equal(rejected.diagnostics[0].code, 'runtime_case_scene_mismatch');
    assert.equal(rejected.record, undefined);
  }
  const foreign = structuredClone(definition); foreign.checks[0].instanceId = foreignInstance;
  const rejected = await runProjectBuild({ ...args, runtimeCase: foreign });
  assert.equal(rejected.ok, false); assert.equal(rejected.diagnostics[0].code, 'runtime_case_target_missing');
  assert.equal(rejected.record, undefined);
  const foreignInput = structuredClone(definition); foreignInput.program.steps[0].inputs[0].instanceId = foreignInstance;
  const rejectedInput = await runProjectBuild({ ...args, runtimeCase: foreignInput });
  assert.equal(rejectedInput.ok, false); assert.equal(rejectedInput.diagnostics[0].code, 'runtime_case_target_missing');
  assert.equal(rejectedInput.record, undefined);
  const controller = new AbortController(); let ready = false;
  const cancelled = await runProjectBuild({ ...args, runtimeCase: definition, signal: controller.signal,
    onProgress(event) { if (event.event?.event === 'ready') { ready = true; controller.abort(); } } });
  assert.equal(ready, true); assert.equal(cancelled.ok, false); assert.equal(cancelled.status, 'cancelled');
  assert.equal(cancelled.record.verification.evaluation.status, 'incomplete');
  assert.equal(cancelled.record.verification.evaluation.complete, false);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(cancelled.sessionDirectory, 'session.json'))).verification, cancelled.record.verification);
  for (const removed of ['project.runtime-case', 'project.control-replay', 'runtime.control-replay', 'runtime.control-replay.instances']) {
    const descriptor = { ...adapter.descriptor, capabilities: adapter.descriptor.capabilities.filter(value => value !== removed) };
    const registry = createExecutionBackendRegistry([{ ...adapter, descriptor }]);
    const denied = await runProjectBuild({ ...args, backendRegistry: registry, runtimeCase: definition });
    assert.equal(denied.ok, false, removed); assert.equal(denied.diagnostics[0].code, 'runtime_case_unsupported', removed);
    assert.equal(denied.record, undefined);
  }
  // A descriptor alone cannot grant capabilities to a generated project.
  for (const removed of ['project.runtime-case', 'project.control-replay', 'runtime.control-replay', 'runtime.control-replay.instances']) {
    const registry = createExecutionBackendRegistry([{ ...adapter, async generate(plan) {
      const generated = await adapter.generate(plan);
      return { ...generated, backend: { ...generated.backend,
        capabilities: generated.backend.capabilities.filter(value => value !== removed) } };
    } }]);
    const denied = await runProjectBuild({ ...args, backendRegistry: registry, runtimeCase: definition });
    assert.equal(denied.ok, false, removed); assert.equal(denied.diagnostics[0].code, 'runtime_case_unsupported', removed);
    assert.equal(denied.record, undefined);
  }
  for (const invalid of [undefined, null, 'project.runtime-case,project.control-replay,runtime.control-replay,runtime.control-replay.instances']) {
    const registry = createExecutionBackendRegistry([{ ...adapter, async generate(plan) {
      const generated = await adapter.generate(plan);
      return { ...generated, backend: { ...generated.backend, capabilities: invalid } };
    } }]);
    const denied = await runProjectBuild({ ...args, backendRegistry: registry, runtimeCase: definition });
    assert.equal(denied.ok, false); assert.equal(denied.diagnostics[0].code, 'runtime_case_unsupported');
    assert.equal(denied.record, undefined);
  }
  const changedSnapshot = await runProjectBuild({ ...args, runtimeCase: definition, expectedSnapshotId: 'sha256:' + '0'.repeat(64) });
  assert.equal(changedSnapshot.ok, false); assert.equal(changedSnapshot.diagnostics[0].code, 'runtime_build_invalid');
});

test('real Bevy project suite executes its frozen entry and CLI reports actual failed and passed members', { skip: !tool }, async t => {
  const { createRuntimeCaseDocumentService } = await import('../lib/runtime-case-documents.mjs');
  const { createRuntimeCaseSuiteDocumentService, captureRuntimeCaseSuite } = await import('../lib/runtime-case-suites.mjs');
  const { readFrozenProjectBuild } = await import('../adapters/node-project-build.mjs');
  const { executeRuntimeCaseSuite } = await import('../adapters/node-runtime-case-suite.mjs');
  const { runProjectBuildCommand } = await import('../project-build.mjs');
  const f = await author(t), cases = createRuntimeCaseDocumentService(f.author), groups = createRuntimeCaseSuiteDocumentService(f.author);
  const list = await cases.list(f.entrySceneId), ids = [];
  for (let index = 0; index < 2; index++) {
    const definition = runtimeCase(f.entry);
    if (!index) definition.checks[0].position.value[0] += 50;
    const saved = await cases.save({ sceneId: f.entrySceneId, sceneVersion: list.sceneVersion,
      sourcePath: `documents/runtime-cases/entry-${index}.json`, documentType: list.defaults.documentType,
      content: JSON.stringify({ format: 'viento-runtime-case-document', schemaVersion: 1, sceneObjectId: f.entrySceneId, case: definition }) });
    ids.push(saved.id);
  }
  const catalog = await groups.list(f.entrySceneId);
  const group = await groups.save({ sceneId: f.entrySceneId, sceneVersion: catalog.sceneVersion,
    sourcePath: 'documents/runtime-suites/entry.json', documentType: catalog.defaults.documentType,
    content: JSON.stringify({ format: 'viento-runtime-case-suite', schemaVersion: 1, sceneObjectId: f.entrySceneId, documentIds: ids }) });
  const built = await buildProject({ root: f.author, scene: f.assemblyId, backendId: adapter.descriptor.id, tool,
    output: path.join(f.temporary, 'suite-build'), timeoutMs: 60000 });
  assert.equal(built.ok, true, JSON.stringify(built.diagnostics || built.record?.diagnostics));
  const frozen = await readFrozenProjectBuild(built.buildDirectory, { backendId: adapter.descriptor.id });
  const capture = await captureRuntimeCaseSuite(f.author, { documentId: group.id, plan: f.entry });
  const run = await executeRuntimeCaseSuite({ capture, plan: frozen.plan, authorRoot: f.author, buildDirectory: built.buildDirectory,
    buildId: frozen.build.buildId, snapshotId: frozen.build.snapshotId, tool, backendId: adapter.descriptor.id,
    cacheRoot: path.join(f.temporary, 'suite-cache') });
  assert.equal(run.status, 'succeeded', JSON.stringify(run.record.diagnostics));
  assert.deepEqual(run.record.suite.entries.map(row => row.state), ['failed', 'passed']);
  const report = JSON.parse(await fs.readFile(path.join(run.receiptDirectory, `member-${ids[0]}.json`)));
  assert.equal(report.context.sceneObjectId, f.entrySceneId);
  assert.equal(report.context.buildId, frozen.build.buildId);
  assert.equal(report.evaluation.status, 'failed');
  assert.equal(report.samples.length, 2);
  const oldCache = process.env.XDG_CACHE_HOME;
  process.env.XDG_CACHE_HOME = path.join(f.temporary, 'cli-cache');
  try {
    const cli = await runProjectBuildCommand(['--command', 'run', '--root', f.author, '--build', built.buildDirectory,
      '--backend', adapter.descriptor.id, '--tool', tool, '--runtime-suite', group.id]);
    assert.equal(cli.status, 'succeeded', JSON.stringify(cli.record.diagnostics));
    assert.deepEqual(cli.record.suite.entries.map(row => row.state), ['failed', 'passed']);
    assert.equal(cli.record.buildId, frozen.build.buildId);
  } finally {
    if (oldCache === undefined) delete process.env.XDG_CACHE_HOME; else process.env.XDG_CACHE_HOME = oldCache;
  }
});
