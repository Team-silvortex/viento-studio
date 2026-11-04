import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { projectAssemblyAuthor } from './helpers/project-assembly-backend-fixture.mjs';
import { createProjectBuildService } from '../lib/project-build-service.mjs';
import { createExecutionBackendRegistry } from '../adapters/node-execution-backends.mjs';
import { createRuntimeCaseDocumentService } from '../lib/runtime-case-documents.mjs';
import { createRuntimeCaseSuiteDocumentService } from '../lib/runtime-case-suites.mjs';
import { BEVY_EXECUTION_ADAPTER as adapter } from '../backends/bevy-adapter.mjs';

const tool = { executable: process.execPath, version: 'test-host', sha256: 'a'.repeat(64), platform: process.platform, arch: process.arch };
const otherInstance = '12345678-1234-4234-8234-123456789def';
const release = () => ({ left: false, right: false, up: false, down: false });
const global = () => ({ format: 'viento-runtime-control', schemaVersion: 1, fixedDelta: 0.125, steps: [{ ...release(), right: true }, release()] });
const targeted = instanceId => ({ format: 'viento-runtime-control', schemaVersion: 2, fixedDelta: 0.125,
  steps: [{ inputs: [{ instanceId, ...release(), right: true }] }, { inputs: [] }] });
async function fixture(t, enabled = true, mode = 'succeeded', missing = '') {
  const f = await projectAssemblyAuthor(t, { entry: 'audio' });
  for (const [index, id] of f.sceneIds.entries()) {
    const meta = path.join(f.author, `metadata/documents/${id}.json`), metadata = JSON.parse(await fs.readFile(meta));
    metadata.relations = metadata.relations.filter(item => item.kind === 'reference'); await fs.writeFile(meta, JSON.stringify(metadata));
    const file = path.join(f.author, metadata.sourcePath), scene = JSON.parse(await fs.readFile(file));
    for (const actor of scene.actors) delete actor.imageResourceId;
    if (index === 0) scene.actors[0].instanceId = otherInstance;
    await fs.writeFile(file, JSON.stringify(scene));
  }
  await fs.rm(path.join(f.author, 'metadata/documents/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee.json'));
  await fs.rm(path.join(f.author, 'metadata/documents/88888888-8888-4888-8888-888888888888.json'));
  const descriptor = { ...adapter.descriptor, capabilities: adapter.descriptor.capabilities.filter(item => (enabled || item !== 'project.control-replay') && item !== missing) };
  const registry = createExecutionBackendRegistry([{ ...adapter, descriptor,
    availability: async () => ({ supported: true, available: true, reason: null }), identify: async () => ({ ...tool }),
    async executePhase(context) {
      if (context.phase !== 'run') return { phase: context.phase, status: 'succeeded', exitCode: 0, stdout: '', stderr: '' };
      const scene = JSON.parse(await fs.readFile(path.join(context.directory, 'scene-data.json')));
      const actors = scene.actors.map(actor => ({ ...(actor.instanceId ? { instanceId: actor.instanceId } : {}),
        objectId: actor.objectId, position: [...actor.position], state: 'idle' }));
      const send = (prefix, data) => context.onOutput({ stream: 'stdout', text: prefix + JSON.stringify(data) + '\n' });
      send('VIENTO_RUNTIME:', { protocol: scene.schemaVersion, event: 'ready', sceneObjectId: scene.scene.objectId, actors });
      if (context.controlProgram) context.controlProgram.steps.forEach((_, stepIndex) => send('VIENTO_TRACE:',
        { format: 'viento-runtime-trace', schemaVersion: 1, protocolVersion: scene.schemaVersion, event: 'sample', stepIndex, actors }));
      send('VIENTO_RUNTIME:', { protocol: scene.schemaVersion, event: 'finished', actors, fixedDelta: context.controlProgram?.fixedDelta ?? 0.25 });
      return { phase: 'run', status: mode, exitCode: mode === 'succeeded' ? 0 : 1, stdout: '', stderr: '' };
    } }]);
  const service = createProjectBuildService(f.author, { backendId: adapter.descriptor.id, backendRegistry: registry,
    tool: tool.executable, cacheRoot: path.join(f.temporary, 'cache') });
  t.after(() => service.close());
  await service.command({ action: 'build', targetId: f.assemblyId });
  const built = await settled(service); assert.equal(built.job.status, 'succeeded', JSON.stringify(built.job));
  return { ...f, service, built, registry };
}
async function settled(service) {
  for (let i = 0; i < 3000; i++) { const state = await service.status(); if (state.job?.status !== 'running') return state; await delay(5); }
  assert.fail('Project replay service job did not settle.');
}

test('project service exposes only frozen entry actors and executes bounded replay', async t => {
  const f = await fixture(t), build = f.built.latestBuild;
  assert.equal(build.controlReplayAvailable, true); assert.equal(build.controlSceneId, f.entrySceneId);
  assert.equal(build.controlPlanSchemaVersion, 2); assert.ok(build.controlActorCount > 0);
  assert.ok(build.actorCount > build.controlActorCount); assert.ok(build.controlTargets.every(row => row.instanceId !== otherInstance));
  const target = build.controlTargets[0].instanceId, file = path.join(f.author, build.controlSourcePath);
  const edited = JSON.parse(await fs.readFile(file)); edited.actors[0].instanceId = otherInstance;
  await fs.writeFile(file, JSON.stringify(edited));
  build.controlTargets[0].instanceId = otherInstance;
  const fresh = await f.service.status(); assert.equal(fresh.latestBuild.controlTargets[0].instanceId, target);
  const request = { action: 'run', buildId: build.id, mode: 'headless', controlProgram: targeted(target) };
  await f.service.command(request); const done = await settled(f.service);
  assert.equal(done.job.status, 'succeeded', JSON.stringify(done.job.diagnostics));
  assert.equal(done.job.runtime.project.entrySceneId, f.entrySceneId); assert.equal(done.job.runtime.control.completedSteps, 2);
  assert.equal(done.job.control.samples.length, 2);
});

test('foreign entry targets and stale suite revisions are forbidden', async t => {
  const f = await fixture(t), build = f.built.latestBuild, request = { action: 'run', buildId: build.id, mode: 'headless' };
  await assert.rejects(f.service.command({ ...request, controlProgram: targeted(otherInstance) }), { errorCode: 'runtime_control_target_missing' });
  await assert.rejects(f.service.command({ action: 'suite-run', buildId: build.id, suiteDocumentId: f.assemblyId,
    expectedVersion: 'sha256:' + 'a'.repeat(64), expectedSnapshotId: build.snapshotId, runtimeCaseSceneId: f.entrySceneId }), { errorCode: 'runtime_suite_document_conflict' });
  assert.equal((await f.service.status()).job.id, f.built.job.id);
});

test('a backend without explicit project capability cannot run project replay', async t => {
  const f = await fixture(t, false), build = f.built.latestBuild;
  assert.equal(build.controlReplayAvailable, false); assert.equal(build.controlTargets, undefined);
  await assert.rejects(f.service.command({ action: 'run', buildId: build.id, mode: 'headless', controlProgram: global() }), { errorCode: 'runtime_control_unsupported' });
  assert.equal((await f.service.status()).job.id, f.built.job.id);
});

test('a project entry with audio is ineligible even when the backend advertises project replay', async t => {
  const { GODOT4_EXECUTION_ADAPTER: godot } = await import('../backends/godot4-adapter.mjs');
  const f = await projectAssemblyAuthor(t, { entry: 'audio' });
  const advertised = ['project.control-replay', 'project.runtime-case', 'project.runtime-case-suite'];
  const descriptor = { ...godot.descriptor, capabilities: [...godot.descriptor.capabilities, ...advertised] };
  const registry = createExecutionBackendRegistry([{ ...godot, descriptor,
    async generate(plan) { const generated = await godot.generate(plan); return { ...generated, backend: { ...generated.backend,
      capabilities: [...generated.backend.capabilities, ...advertised] } }; },
    availability: async () => ({ supported: true, available: true, reason: null }), identify: async () => ({ ...tool }),
    executePhase: async ({ phase }) => ({ phase, status: 'succeeded', exitCode: 0, stdout: '', stderr: '' }) }]);
  const service = createProjectBuildService(f.author, { backendId: descriptor.id, backendRegistry: registry,
    tool: tool.executable, cacheRoot: path.join(f.temporary, 'cache') });
  t.after(() => service.close());
  await service.command({ action: 'build', targetId: f.assemblyId });
  const state = await settled(service);
  assert.equal(state.job.status, 'succeeded', JSON.stringify(state.job));
  assert.equal(state.latestBuild.entrySceneId, f.entrySceneId);
  assert.equal(state.latestBuild.controlReplayAvailable, false);
  assert.equal(state.latestBuild.controlTargets, undefined);
  await assert.rejects(service.command({ action: 'run', buildId: state.latestBuild.id, mode: 'headless', controlProgram: global() }),
    { errorCode: 'runtime_control_unsupported' });
  const suite = { action: 'suite-run', buildId: state.latestBuild.id, suiteDocumentId: f.assemblyId,
    expectedVersion: `sha256:${'a'.repeat(64)}`, expectedSnapshotId: state.latestBuild.snapshotId, runtimeCaseSceneId: f.entrySceneId };
  await assert.rejects(service.command(suite), { errorCode: 'runtime_case_unsupported' });
  assert.equal((await service.status()).job.id, state.job.id);
  const { runProjectBuildCommand } = await import('../project-build.mjs');
  const builds = await fs.readdir(path.join(f.temporary, 'cache'), { recursive: true, withFileTypes: true });
  const record = builds.find(entry => entry.name === 'build.json'); assert.ok(record);
  const buildDirectory = record.parentPath;
  const frozenRecord = JSON.parse(await fs.readFile(path.join(buildDirectory, 'build.json')));
  assert.ok(advertised.every(capability => frozenRecord.backend.capabilities.includes(capability)));
  await assert.rejects(runProjectBuildCommand(['--command', 'run', '--root', f.author, '--build', buildDirectory,
    '--backend', descriptor.id, '--tool', tool.executable, '--runtime-suite', f.assemblyId]), { errorCode: 'runtime_case_unsupported' });
  assert.equal((await service.status()).job.id, state.job.id);
  assert.equal(builds.some(entry => entry.name === 'suites' || entry.name === 'sessions'), false);
});

function projectCase(instanceId) {
  return { format: 'viento-runtime-case', schemaVersion: 1, program: targeted(instanceId),
    checks: [{ instanceId, stepIndex: 1, state: 'idle' }] };
}

test('temporary project verification binds the frozen entry and snapshot and preserves author edits', async t => {
  const f = await fixture(t), build = f.built.latestBuild, target = build.controlTargets[0].instanceId;
  const request = { action: 'run', buildId: build.id, mode: 'headless', runtimeCase: projectCase(target),
    runtimeCaseSceneId: build.entrySceneId, expectedSnapshotId: build.snapshotId };
  for (const [patch, errorCode] of [[{ runtimeCaseSceneId: f.assemblyId }, 'runtime_case_scene_mismatch'],
    [{ runtimeCaseSceneId: undefined }, 'runtime_case_scene_mismatch'],
    [{ expectedSnapshotId: `sha256:${'f'.repeat(64)}` }, 'runtime_case_snapshot_mismatch'],
    [{ expectedSnapshotId: undefined }, 'runtime_case_snapshot_mismatch'],
    [{ runtimeCase: projectCase(otherInstance) }, 'runtime_case_target_missing']]) {
    const invalid = { ...request, ...patch };
    for (const key of Object.keys(invalid)) if (invalid[key] === undefined) delete invalid[key];
    await assert.rejects(f.service.command(invalid), { errorCode });
    assert.equal((await f.service.status()).job.id, f.built.job.id);
  }
  const file = path.join(f.author, build.controlSourcePath), scene = JSON.parse(await fs.readFile(file));
  scene.actors[0].instanceId = otherInstance;
  await fs.writeFile(file, JSON.stringify(scene));
  const before = await fs.readFile(file);
  await f.service.command(request); const done = await settled(f.service);
  assert.equal(done.job.status, 'succeeded', JSON.stringify(done.job.diagnostics));
  assert.equal(done.job.verification.evaluation.status, 'passed');
  assert.equal(done.job.runtime.project.entrySceneId, build.entrySceneId);
  assert.deepEqual(await fs.readFile(file), before);
});

test('project verification requires explicit backend capability', async t => {
  const f = await fixture(t, false), build = f.built.latestBuild;
  await assert.rejects(f.service.command({ action: 'run', buildId: build.id, mode: 'headless',
    runtimeCase: projectCase(otherInstance), runtimeCaseSceneId: build.entrySceneId, expectedSnapshotId: build.snapshotId }),
    { errorCode: 'runtime_case_unsupported' });
});

for (const mode of ['failed', 'cancelled']) {
  test(`project verification marks ${mode} execution incomplete even after receiving samples`, async t => {
    const f = await fixture(t, true, mode), build = f.built.latestBuild;
    await f.service.command({ action: 'run', buildId: build.id, mode: 'headless',
      runtimeCase: projectCase(build.controlTargets[0].instanceId), runtimeCaseSceneId: build.entrySceneId, expectedSnapshotId: build.snapshotId });
    const done = await settled(f.service);
    assert.equal(done.job.status, mode, JSON.stringify(done.job.diagnostics));
    assert.equal(done.job.control.samples.length, 2);
    assert.equal(done.job.verification.evaluation.status, 'incomplete');
    assert.equal(done.job.verification.evaluation.complete, false);
    assert.notEqual(done.job.runtime.phase, 'finished');
  });
}

test('project plan schema 2 cannot start entry verification even if a backend advertises it', async t => {
  const { GODOT4_EXECUTION_ADAPTER: godot } = await import('../backends/godot4-adapter.mjs');
  const f = await projectAssemblyAuthor(t, { entry: 'audio', inputMap: { format: 'viento-input-map', schemaVersion: 1,
    actions: [{ name: 'move_left', keys: ['KeyA'] }] } });
  for (const id of f.sceneIds) {
    const meta = path.join(f.author, `metadata/documents/${id}.json`), metadata = JSON.parse(await fs.readFile(meta));
    metadata.relations = metadata.relations.filter(item => item.kind === 'reference'); await fs.writeFile(meta, JSON.stringify(metadata));
    const file = path.join(f.author, metadata.sourcePath), scene = JSON.parse(await fs.readFile(file));
    for (const actor of scene.actors) delete actor.imageResourceId;
    await fs.writeFile(file, JSON.stringify(scene));
  }
  await fs.rm(path.join(f.author, 'metadata/documents/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee.json'));
  await fs.rm(path.join(f.author, 'metadata/documents/88888888-8888-4888-8888-888888888888.json'));
  const descriptor = { ...godot.descriptor, capabilities: [...godot.descriptor.capabilities, 'project.control-replay', 'project.runtime-case'] };
  const registry = createExecutionBackendRegistry([{ ...godot, descriptor,
    availability: async () => ({ supported: true, available: true, reason: null }), identify: async () => ({ ...tool }),
    executePhase: async ({ phase }) => ({ phase, status: 'succeeded', exitCode: 0, stdout: '', stderr: '' }) }]);
  const service = createProjectBuildService(f.author, { backendId: descriptor.id, backendRegistry: registry,
    tool: tool.executable, cacheRoot: path.join(f.temporary, 'cache') });
  t.after(() => service.close());
  await service.command({ action: 'build', targetId: f.assemblyId });
  const state = await settled(service); assert.equal(state.job.status, 'succeeded', JSON.stringify(state.job));
  const build = state.latestBuild;
  assert.equal(build.planSchemaVersion, 2);
  assert.equal(build.controlReplayAvailable, true, 'exercise an otherwise eligible future project');
  await assert.rejects(service.command({ action: 'run', buildId: build.id, mode: 'headless',
    runtimeCase: projectCase(build.controlTargets[0].instanceId), runtimeCaseSceneId: build.entrySceneId,
    expectedSnapshotId: build.snapshotId }), { errorCode: 'runtime_case_unsupported' });
  assert.equal((await service.status()).job.id, state.job.id);
});


async function savedEntrySuite(f, sceneId = f.entrySceneId) {
  const author = createRuntimeCaseDocumentService(f.author), groups = createRuntimeCaseSuiteDocumentService(f.author);
  const catalog = await author.list(sceneId), sceneRecord = JSON.parse(await fs.readFile(path.join(f.author, `metadata/documents/${sceneId}.json`)));
  const scene = JSON.parse(await fs.readFile(path.join(f.author, sceneRecord.sourcePath)));
  const ids = [];
  for (let i = 0; i < 2; i++) {
    const definition = projectCase(scene.actors[0].instanceId);
    if (i === 0) definition.checks[0].state = 'moving';
    const doc = { format: 'viento-runtime-case-document', schemaVersion: 1, sceneObjectId: sceneId, case: definition };
    const saved = await author.save({ sceneId, sceneVersion: catalog.sceneVersion, sourcePath: `documents/runtime-cases/${sceneId}-${i}.json`,
      documentType: catalog.defaults.documentType, content: JSON.stringify(doc) });
    ids.push(saved.id);
  }
  const groupCatalog = await groups.list(sceneId);
  const group = await groups.save({ sceneId, sceneVersion: groupCatalog.sceneVersion, sourcePath: `documents/runtime-suites/${sceneId}.json`,
    documentType: groupCatalog.defaults.documentType, content: JSON.stringify({ format: 'viento-runtime-case-suite', schemaVersion: 1,
      sceneObjectId: sceneId, documentIds: ids }) });
  return { group, ids };
}
const suiteRequest = (f, suite) => ({ action: 'suite-run', buildId: f.built.latestBuild.id,
  suiteDocumentId: suite.group.id, expectedVersion: suite.group.version,
  expectedSnapshotId: f.built.latestBuild.snapshotId, runtimeCaseSceneId: f.entrySceneId });

test('project suite evaluates and exports each result against the frozen entry identity', async t => {
  const f = await fixture(t), suite = await savedEntrySuite(f), build = f.built.latestBuild;
  await f.service.command(suiteRequest(f, suite));
  const state = await settled(f.service), job = state.job;
  assert.equal(job.status, 'succeeded', JSON.stringify(job.diagnostics));
  assert.equal(job.sceneId, f.assemblyId);
  assert.equal(job.suite.sceneObjectId, f.entrySceneId);
  assert.deepEqual(job.suite.entries.map(row => row.state), ['failed', 'passed']);
  assert.deepEqual(job.suite.entries.map(row => row.reportAvailable), [true, true]);
  for (const [index, documentId] of suite.ids.entries()) {
    const report = await f.service.command({ action: 'suite-report', jobId: job.id, documentId });
    assert.equal(report.context.sceneObjectId, f.entrySceneId);
    assert.equal(report.context.buildId, build.id);
    assert.equal(report.context.snapshotId, build.snapshotId);
    assert.equal(report.evaluation.status, index ? 'passed' : 'failed');
    assert.equal(report.samples.length, 2);
  }
});

test('project suite rejects a different scene before replacing the build job', async t => {
  const f = await fixture(t), suite = await savedEntrySuite(f, f.sceneIds[0]);
  await assert.rejects(f.service.command(suiteRequest(f, suite)), { errorCode: 'runtime_suite_scene_mismatch' });
  assert.equal((await f.service.status()).job.id, f.built.job.id);
});

for (const missing of ['project.runtime-case-suite', 'project.runtime-case', 'project.control-replay']) {
  test(`project suite requires ${missing}`, async t => {
    const f = await fixture(t, true, 'succeeded', missing), suite = await savedEntrySuite(f);
    await assert.rejects(f.service.command(suiteRequest(f, suite)), { errorCode: 'runtime_case_unsupported' });
    assert.equal((await f.service.status()).job.id, f.built.job.id);
  });
}

test('cancelled project member retains its incomplete report and does not run the next member', async t => {
  const f = await fixture(t, true, 'cancelled'), suite = await savedEntrySuite(f);
  await f.service.command(suiteRequest(f, suite));
  const state = await settled(f.service), job = state.job;
  assert.equal(job.status, 'cancelled');
  assert.deepEqual(job.suite.entries.map(row => row.state), ['incomplete', 'not-run']);
  const report = await f.service.command({ action: 'suite-report', jobId: job.id, documentId: suite.ids[0] });
  assert.equal(report.executionStatus, 'cancelled'); assert.equal(report.evaluation.status, 'incomplete');
  await assert.rejects(f.service.command({ action: 'suite-report', jobId: job.id, documentId: suite.ids[1] }), { errorCode: 'runtime_report_not_ready' });
});

test('project suite rejects missing or stale explicit snapshot and entry before replacing the build job', async t => {
  const f = await fixture(t), suite = await savedEntrySuite(f), request = suiteRequest(f, suite);
  for (const [patch, code] of [
    [{ expectedSnapshotId: undefined }, 'runtime_case_snapshot_mismatch'],
    [{ expectedSnapshotId: `sha256:${'f'.repeat(64)}` }, 'runtime_case_snapshot_mismatch'],
    [{ runtimeCaseSceneId: undefined }, 'runtime_case_scene_mismatch'],
    [{ runtimeCaseSceneId: f.sceneIds[0] }, 'runtime_case_scene_mismatch'],
  ]) {
    const body = { ...request, ...patch };
    for (const key of Object.keys(body)) if (body[key] === undefined) delete body[key];
    await assert.rejects(f.service.command(body), { errorCode: code });
    assert.equal((await f.service.status()).job.id, f.built.job.id);
  }
});

test('project suite refuses a generated artifact without its suite capability before creating a receipt', async t => {
  const { captureRuntimeCaseSuite } = await import('../lib/runtime-case-suites.mjs');
  const { executeRuntimeCaseSuite } = await import('../adapters/node-runtime-case-suite.mjs');
  const { readFrozenProjectBuild } = await import('../adapters/node-project-build.mjs');
  const { entryScenePlan } = await import('../../engine/build-target.mjs');
  const f = await fixture(t), suite = await savedEntrySuite(f);
  const candidates = await fs.readdir(path.join(f.temporary, 'cache'));
  assert.ok(candidates.length);
  async function findBuild(dir) {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const location = path.join(dir, entry.name);
      if (entry.isDirectory()) { const found = await findBuild(location); if (found) return found; }
      else if (entry.name === 'build.json') return dir;
    }
  }
  const buildDirectory = await findBuild(path.join(f.temporary, 'cache'));
  const frozen = await readFrozenProjectBuild(buildDirectory, { backendId: adapter.descriptor.id, backendRegistry: f.registry });
  const capture = await captureRuntimeCaseSuite(f.author, { documentId: suite.group.id, plan: entryScenePlan(frozen.plan) });
  const altered = createExecutionBackendRegistry([{ ...adapter, async generate(plan) {
    const output = await adapter.generate(plan);
    return { ...output, backend: { ...output.backend, capabilities: output.backend.capabilities.filter(value => value !== 'project.runtime-case-suite') } };
  } }]);
  const result = await executeRuntimeCaseSuite({ capture, plan: frozen.plan, authorRoot: f.author, buildDirectory,
    buildId: frozen.build.buildId, snapshotId: frozen.build.snapshotId, tool: tool.executable, backendId: adapter.descriptor.id,
    backendRegistry: altered, cacheRoot: path.join(f.temporary, 'denied') });
  assert.equal(result.status, 'failed'); assert.equal(result.record.diagnostics[0].code, 'runtime_case_unsupported');
  assert.equal(result.receiptDirectory, undefined);
  assert.deepEqual(result.record.suite.entries.map(row => row.state), ['not-run', 'not-run']);
});

test('shared project entry eligibility rejects every unsupported content kind', async () => {
  const { isProjectControlEntryEligible } = await import('../../engine/build-target.mjs');
  const sceneId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  const plan = { kind: 'project', schemaVersion: 1, entrySceneId: sceneId, scenes: [{ scene: { objectId: sceneId }, schemaVersion: 2 }] };
  assert.equal(isProjectControlEntryEligible(plan), true);
  for (const field of ['behaviors', 'animation', 'physics', 'audio']) {
    const richer = structuredClone(plan); richer.scenes[0][field] = {};
    assert.equal(isProjectControlEntryEligible(richer), false, field);
  }
  assert.equal(isProjectControlEntryEligible({ ...plan, schemaVersion: 2 }), false);
  assert.equal(isProjectControlEntryEligible({ ...plan, entrySceneId: otherInstance }), false);
});
