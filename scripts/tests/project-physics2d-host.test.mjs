import { createProjectFrameEncoder } from './helpers/project-execution-frames-fixture.mjs';
import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { scenePhysics2DAuthor } from './helpers/scene-physics2d-author-fixture.mjs';
import { GODOT4_EXECUTION_ADAPTER as godot } from '../backends/godot4-adapter.mjs';
import { createExecutionBackendRegistry } from '../adapters/node-execution-backends.mjs';
import { buildProject, runProjectBuild } from '../adapters/node-project-build.mjs';
import { createProjectBuildService } from '../lib/project-build-service.mjs';
import { buildHash } from '../adapters/node-build-snapshot.mjs';

const tool = { executable: process.execPath, version: 'physics-host-test', sha256: 'a'.repeat(64), platform: process.platform, arch: process.arch };
const phaseResult = (phase, status = 'succeeded') => ({ phase, status, exitCode: status === 'succeeded' ? 0 : 1, stdout: '', stderr: '' });
function registry({ execute, snapshots } = {}) {
  let plan;
  return createExecutionBackendRegistry([{ ...godot,
    identify: async () => ({ ...tool }), availability: async () => ({ supported: true, available: true, reason: null }),
    async generate(input) { plan = structuredClone(input); return godot.generate(input); },
    createEventReader(input, options) {
      snapshots?.(options);
      return godot.createEventReader(input, options);
    },
    async executePhase(context) {
      if (context.phase !== 'run') return phaseResult(context.phase);
      const scene = plan.scenes.find(row => row.scene.objectId === plan.entrySceneId), body = scene.physics.document.bodies.find(row => row.kind === 'character');
      const actor = scene.actors.find(row => row.instanceId === body.instanceId);
      const actors = scene.actors.map(row => ({ objectId: row.objectId, instanceId: row.instanceId, position: row.position, state: 'idle' }));
      const encodeProject = createProjectFrameEncoder();
      const emit = (frame, physics = false) => context.onOutput({ stream: 'stdout', text: physics ? 'VIENTO_PHYSICS2D:' + JSON.stringify(frame) + '\n' : encodeProject(frame) });
      const begin = () => {
        emit({ protocol: 4, event: 'ready', assemblyId: plan.assembly.objectId, entrySceneId: plan.entrySceneId, stateRevision: 0, eventSequence: 0, audioCommandSequence: 0 });
        if (context.smoke) emit({ protocol: 1, event: 'ready', assemblyId: plan.assembly.objectId, limit: 256 }, true);
        emit({ protocol: 4, event: 'scene-enter', visitIndex: 1, sceneId: scene.scene.objectId });
        emit({ protocol: 4, event: 'scene-event', visitIndex: 1, sceneId: scene.scene.objectId, stream: 'runtime',
          frame: { protocol: scene.schemaVersion, event: 'ready', sceneObjectId: scene.scene.objectId, actors } });
      };
      const sample = () => emit({ protocol: 1, event: 'sample', sequence: 1, visitIndex: 1, sceneId: scene.scene.objectId, stepIndex: 1,
        timeSeconds: .5, deltaSeconds: .5, bodyId: body.id, instanceId: body.instanceId, positionBefore: actor.position,
        positionAfter: [actor.position[0] + 4, actor.position[1]], requestedMotion: [4, 0], contacts: [] }, true);
      const end = ({ trace = true } = {}) => {
        emit({ protocol: 4, event: 'scene-exit', visitIndex: 1, sceneId: scene.scene.objectId, reason: 'finished', elapsedSeconds: .5, actors });
        if (context.smoke && trace) emit({ protocol: 1, event: 'finished', sampleCount: 1, limited: false }, true);
        emit({ protocol: 4, event: 'finished', assemblyId: plan.assembly.objectId, visitCount: 1, totalSeconds: .5,
          stateRevision: 0, eventSequence: 0, audioCommandSequence: 0 });
      };
      if (execute) return execute({ ...context, emit, begin, sample, end });
      begin(); if (context.smoke) sample(); end(); return phaseResult('run');
    },
  }]);
}
async function build(t, backendRegistry = registry()) {
  const f = await scenePhysics2DAuthor(t, { animation: false }), output = path.join(f.temporary, 'physics-host-build');
  const result = await buildProject({ root: f.author, targetId: f.assemblyId, output, tool: tool.executable, backendRegistry });
  assert.equal(result.ok, true, JSON.stringify(result)); return { ...f, output, backendRegistry };
}
const run = (f, options = {}) => runProjectBuild({ buildDirectory: f.output, backendRegistry: f.backendRegistry, tool: tool.executable, ...options });
async function hashes(directory) {
  const values = {};
  for (const entry of await fs.readdir(directory, { recursive: true, withFileTypes: true })) if (entry.isFile()) {
    const file = path.join(entry.parentPath || entry.path, entry.name); values[path.relative(directory, file)] = buildHash(await fs.readFile(file));
  }
  return values;
}
async function settled(service) {
  for (let index = 0; index < 1000; index++) { const value = await service.status(); if (value.job?.status !== 'running') return value; await delay(5); }
  assert.fail('Physics observation job did not finish.');
}

test('host publishes detached physics separately, persists the final snapshot, and keeps authors and artifacts unchanged', async t => {
  let passedCapabilities;
  const f = await build(t, registry({ snapshots: options => { passedCapabilities = options.capabilities; } }));
  const authors = await hashes(f.author), artifact = await hashes(path.join(f.output, 'project')), observations = [];
  const result = await run(f, { onProgress(event) {
    if (event.physics) { observations.push(structuredClone(event.physics)); event.physics.samples.length = 0; }
    if (event.runtime) event.runtime.actors.length = 0;
  } });
  assert.equal(result.ok, true, JSON.stringify(result.record.diagnostics)); assert.ok(passedCapabilities.includes('physics.observe2d'));
  assert.equal(result.record.physics.phase, 'finished'); assert.equal(result.record.physics.samples.length, 1);
  assert.ok(observations.some(row => row.phase === 'recording' && row.samples.length === 1));
  assert.equal(result.record.runtime.physics, undefined); assert.ok(result.record.runtime.actors.length);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(result.sessionDirectory, 'session.json'))).physics, result.record.physics);
  assert.deepEqual(await hashes(f.author), authors); assert.deepEqual(await hashes(path.join(f.output, 'project')), artifact);
  await assert.rejects(fs.stat(path.join(result.sessionDirectory, 'project')), { code: 'ENOENT' });
  const window = await run(f, { headless: false, smoke: false }); assert.equal(window.ok, true, JSON.stringify(window.record.diagnostics));
  assert.equal(window.record.physics, undefined);
});

test('malformed completion, process cancellation, timeout and thrown execution preserve the last native sample', async t => {
  for (const mode of ['missing', 'cancelled', 'timeout', 'throw']) {
    const f = await build(t, registry({ execute({ begin, sample, end }) {
      begin(); sample();
      if (mode === 'throw') throw new Error('Injected executor failure.');
      if (mode === 'missing') end({ trace: false });
      return phaseResult('run', mode === 'missing' ? 'succeeded' : mode);
    } }));
    const result = await run(f); assert.equal(result.ok, false, mode); assert.equal(result.record.physics.phase, 'incomplete', mode);
    assert.equal(result.record.physics.samples.length, 1, mode);
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(result.sessionDirectory, 'session.json'))).physics, result.record.physics);
    await assert.rejects(fs.stat(path.join(result.sessionDirectory, 'project')), { code: 'ENOENT' });
    if (mode === 'missing') assert.ok(result.record.diagnostics.some(row => row.code === 'runtime_physics2d_trace_invalid'));
  }
});

test('a failed final snapshot callback cannot prevent session cleanup or retained incomplete evidence', async t => {
  const f = await build(t, registry({ execute({ begin, sample }) { begin(); sample(); throw new Error('Interrupted run'); } }));
  const result = await run(f, { onProgress(event) { if (event.physics?.phase === 'incomplete') throw new Error('Consumer failed'); } });
  assert.equal(result.ok, false); assert.equal(result.record.physics.phase, 'incomplete'); assert.equal(result.record.physics.samples.length, 1);
  await assert.rejects(fs.stat(path.join(result.sessionDirectory, 'project')), { code: 'ENOENT' });
});

test('service retains physics for the owned run, detaches status, leaves inspect unchanged and rejects stale callbacks', async t => {
  const f = await scenePhysics2DAuthor(t, { animation: false }); let oldOutput, runs = 0, unblock;
  const waiting = new Promise(resolve => { unblock = resolve; });
  const backendRegistry = registry({ async execute(context) {
    runs++; context.begin(); context.sample();
    if (runs === 1) oldOutput = context.onOutput;
    if (runs === 2) await waiting;
    context.end(); return phaseResult('run');
  } });
  const service = createProjectBuildService(f.author, { tool: tool.executable, backendRegistry, cacheRoot: path.join(f.temporary, 'service-cache') });
  t.after(() => service.close());
  await service.command({ action: 'build', targetId: f.assemblyId }); const built = await settled(service);
  assert.equal(built.job.status, 'succeeded', JSON.stringify(built));
  await service.command({ action: 'run', buildId: built.job.buildId, mode: 'headless' });
  const first = await settled(service); assert.equal(first.job.status, 'succeeded', JSON.stringify(first.job.diagnostics));
  assert.equal(first.job.physics.samples.length, 1); const firstId = first.job.id;
  const inspected = await service.command({ action: 'inspect', jobId: firstId }); assert.equal(inspected.physics, undefined);
  first.job.physics.samples.length = 0; assert.equal((await service.status()).job.physics.samples.length, 1);
  await service.command({ action: 'run', buildId: built.job.buildId, mode: 'headless' });
  for (let index = 0; index < 1000 && runs < 2; index++) await delay(5);
  assert.equal(runs, 2); const active = (await service.status()).job;
  oldOutput({ stream: 'stdout', text: 'late old process text\n' });
  const after = (await service.status()).job; assert.equal(after.id, active.id); assert.equal(after.logs, active.logs); assert.deepEqual(after.physics, active.physics);
  await assert.rejects(service.command({ action: 'inspect', jobId: firstId }), { errorCode: 'runtime_query_job_missing' });
  unblock(); assert.equal((await settled(service)).job.status, 'succeeded');
  await service.command({ action: 'plan', targetId: f.assemblyId }); const planned = await settled(service); assert.equal(planned.job.physics, undefined);
});
