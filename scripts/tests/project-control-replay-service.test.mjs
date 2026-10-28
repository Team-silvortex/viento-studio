import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { projectAssemblyAuthor } from './helpers/project-assembly-backend-fixture.mjs';
import { runtimeCase } from './runtime-case-fixture.mjs';
import { createProjectBuildService } from '../lib/project-build-service.mjs';
import { createExecutionBackendRegistry } from '../adapters/node-execution-backends.mjs';
import { BEVY_EXECUTION_ADAPTER as adapter } from '../backends/bevy-adapter.mjs';

const tool = { executable: process.execPath, version: 'test-host', sha256: 'a'.repeat(64), platform: process.platform, arch: process.arch };
const otherInstance = '12345678-1234-4234-8234-123456789def';
const release = () => ({ left: false, right: false, up: false, down: false });
const global = () => ({ format: 'viento-runtime-control', schemaVersion: 1, fixedDelta: 0.125, steps: [{ ...release(), right: true }, release()] });
const targeted = instanceId => ({ format: 'viento-runtime-control', schemaVersion: 2, fixedDelta: 0.125,
  steps: [{ inputs: [{ instanceId, ...release(), right: true }] }, { inputs: [] }] });
async function fixture(t, enabled = true) {
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
  const descriptor = { ...adapter.descriptor, capabilities: adapter.descriptor.capabilities.filter(item => enabled || item !== 'project.control-replay') };
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
      return { phase: 'run', status: 'succeeded', exitCode: 0, stdout: '', stderr: '' };
    } }]);
  const service = createProjectBuildService(f.author, { backendId: adapter.descriptor.id, backendRegistry: registry,
    tool: tool.executable, cacheRoot: path.join(f.temporary, 'cache') });
  t.after(() => service.close());
  await service.command({ action: 'build', targetId: f.assemblyId });
  const built = await settled(service); assert.equal(built.job.status, 'succeeded', JSON.stringify(built.job));
  return { ...f, service, built };
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

test('foreign entry targets, runtime cases and project case suites remain forbidden', async t => {
  const f = await fixture(t), build = f.built.latestBuild, request = { action: 'run', buildId: build.id, mode: 'headless' };
  await assert.rejects(f.service.command({ ...request, controlProgram: targeted(otherInstance) }), { errorCode: 'runtime_control_target_missing' });
  await assert.rejects(f.service.command({ ...request, runtimeCase: runtimeCase() }), { errorCode: 'runtime_case_unsupported' });
  await assert.rejects(f.service.command({ action: 'suite-run', buildId: build.id, suiteDocumentId: f.assemblyId,
    expectedVersion: 'sha256:' + 'a'.repeat(64) }), { errorCode: 'runtime_case_unsupported' });
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
  const descriptor = { ...godot.descriptor, capabilities: [...godot.descriptor.capabilities, 'project.control-replay'] };
  const registry = createExecutionBackendRegistry([{ ...godot, descriptor,
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
  assert.equal((await service.status()).job.id, state.job.id);
});
