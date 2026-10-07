import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { createProjectBuildService } from '../lib/project-build-service.mjs';
import { buildProject, runProjectBuild } from '../adapters/node-project-build.mjs';
import { buildHash } from '../adapters/node-build-snapshot.mjs';
import { createExecutionBackendRegistry } from '../adapters/node-execution-backends.mjs';
import { BEVY_EXECUTION_ADAPTER } from '../backends/bevy-adapter.mjs';
import { runProjectBuildCommand } from '../project-build.mjs';

const app = fileURLToPath(new URL('../../', import.meta.url));
const sceneId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const bevyId = 'org.viento.bevy', godotId = 'org.viento.godot4';
const actorId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const bevy = process.env.VIENTO_BEVY_BIN, godot = process.env.VIENTO_GODOT_BIN;
const absent = file => assert.rejects(fs.stat(file), { code: 'ENOENT' });
const gate = () => { let release; return { promise: new Promise(resolve => { release = resolve; }), resolve: value => release(value) }; };
const fakeTool = { executable: '/trusted/host/tool', version: 'test-host', sha256: 'a'.repeat(64), platform: process.platform, arch: process.arch };
const phaseResult = (phase, status = 'succeeded') => ({ phase, status, exitCode: status === 'succeeded' ? 0 : 1, stdout: '', stderr: '' });

async function fixture(t, { version = 2, example = 'bevy-headless', options = {} } = {}) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-runtime-query-'));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const root = path.join(base, 'workspace'), output = path.join(base, 'build'), cacheRoot = path.join(base, 'cache');
  await fs.cp(path.join(app, 'examples', example), root, { recursive: true });
  if (version === 1) {
    const file = path.join(root, 'documents/scenes/demo.json'), scene = JSON.parse(await fs.readFile(file));
    scene.schemaVersion = 1; scene.actors = [scene.actors[0]]; delete scene.actors[0].instanceId;
    await fs.writeFile(file, JSON.stringify(scene, null, 2) + '\n');
  }
  return { base, root, output, cacheRoot, options };
}
async function inventory(root) {
  const values = {};
  for (const entry of await fs.readdir(root, { recursive: true, withFileTypes: true })) if (entry.isFile()) {
    const file = path.join(entry.parentPath, entry.name); values[path.relative(root, file)] = buildHash(await fs.readFile(file));
  }
  return values;
}
async function settled(service) {
  for (let i = 0; i < 3000; i++) { const status = await service.status(); if (status.job?.status !== 'running') return status; await delay(10); }
  assert.fail('Runtime query test job did not settle.');
}
async function waitView(service) {
  for (let i = 0; i < 1000; i++) { const status = await service.status(); if (status.job?.runtime?.phase === 'ready') return status; await delay(5); }
  assert.fail('Runtime query test did not receive ready.');
}
function fakeRegistry({ execute, availability, identify } = {}) {
  const implementation = { ...BEVY_EXECUTION_ADAPTER,
    availability: availability || (async () => ({ supported: true, available: true, reason: null })),
    identify: identify || (async () => ({ ...fakeTool })),
    async executePhase(context) {
      if (context.phase !== 'run') return phaseResult(context.phase);
      const scene = JSON.parse(await fs.readFile(path.join(context.directory, 'scene-data.json')));
      const states = scene.actors.map(actor => ({ ...(actor.instanceId ? { instanceId: actor.instanceId } : {}),
        objectId: actor.objectId, position: [...actor.position], state: 'idle' }));
      const emit = value => context.onOutput({ stream: 'stdout', text: `VIENTO_RUNTIME:${JSON.stringify(value)}\n` });
      const ready = () => emit({ protocol: scene.schemaVersion, event: 'ready', sceneObjectId: scene.scene.objectId, actors: states });
      const state = (index, value) => emit({ protocol: scene.schemaVersion, event: 'state',
        ...(states[index].instanceId ? { instanceId: states[index].instanceId } : {}), objectId: states[index].objectId, state: value });
      const finished = () => emit({ protocol: scene.schemaVersion, event: 'finished', actors: states.map((actor, index) => ({ ...actor,
        position: index === 0 ? [240, 220] : [...actor.position] })), fixedDelta: 0.25 });
      if (execute) return execute({ ...context, scene, states, emit, ready, state, finished });
      ready(); state(0, 'moving'); state(0, 'idle'); finished(); return phaseResult('run');
    },
  };
  return createExecutionBackendRegistry([implementation]);
}
function serviceFor(t, h, options = {}) {
  const service = createProjectBuildService(h.root, { backendId: bevyId, backendRegistry: fakeRegistry(), tool: fakeTool.executable,
    cacheRoot: h.cacheRoot, ...options });
  t.after(() => service.close()); return service;
}
async function buildService(service) {
  await service.command({ action: 'build', sceneId }); const built = await settled(service);
  assert.equal(built.job.status, 'succeeded', JSON.stringify(built)); return built;
}
async function sessionRecord(cacheRoot) {
  const files = await fs.readdir(cacheRoot, { recursive: true });
  const file = files.find(file => file.endsWith('/session.json')); assert.ok(file, 'Persisted runtime session exists.');
  return { file: path.join(cacheRoot, file), record: JSON.parse(await fs.readFile(path.join(cacheRoot, file))) };
}

test('runtime inspect validates exact identities and rejects unowned, non-runtime and not-yet-observed jobs', async t => {
  const h = await fixture(t), identifying = gate(); let identifyCount = 0;
  const backendRegistry = fakeRegistry({ async identify() { if (++identifyCount > 1) await identifying.promise; return { ...fakeTool }; } });
  const service = serviceFor(t, h, { backendRegistry });
  const request = { action: 'inspect', jobId: sceneId };
  await assert.rejects(service.command(request), { errorCode: 'runtime_query_job_missing' });
  for (const patch of [{ jobId: '../escape' }, { objectId: 'entity:123' }, { instanceId: 7 }, { objectId: null },
    { instanceId: undefined }, { entityId: 123 }, { tool: '/tmp/host' }, { backendId: godotId }, { sourcePath: '/etc/passwd' }]) {
    await assert.rejects(service.command({ ...request, ...patch }), { errorCode: 'build_request_invalid' });
  }
  await service.command({ action: 'plan', sceneId }); const plan = await settled(service);
  await assert.rejects(service.command({ action: 'inspect', jobId: plan.job.id }), { errorCode: 'runtime_query_job_missing' });
  const built = await buildService(service);
  await assert.rejects(service.command({ action: 'inspect', jobId: built.job.id }), { errorCode: 'runtime_query_job_missing' });
  const started = await service.command({ action: 'run', buildId: built.latestBuild.id, mode: 'headless' });
  assert.equal(started.job.buildId, built.latestBuild.id); assert.equal(started.job.snapshotId, built.latestBuild.snapshotId);
  assert.equal(started.job.runtime, null);
  await assert.rejects(service.command({ action: 'inspect', jobId: started.job.id }), { errorCode: 'runtime_query_unavailable' });
  await assert.rejects(service.command({ action: 'plan', sceneId }), { errorCode: 'build_busy' });
  identifying.resolve(); const ended = await settled(service);
  const view = await service.command({ action: 'inspect', jobId: ended.job.id }); assert.equal(view.phase, 'finished');
  const foreign = serviceFor(t, h);
  await assert.rejects(foreign.command({ action: 'inspect', jobId: ended.job.id }), { errorCode: 'runtime_query_job_missing' });
  await service.command({ action: 'plan', sceneId }); const replacement = await settled(service);
  assert.equal(replacement.job.runtime, null);
  await assert.rejects(service.command({ action: 'inspect', jobId: ended.job.id }), { errorCode: 'runtime_query_job_missing' });
});

test('runtime object observation survives a 128-event ring and returns detached instance and definition queries', async t => {
  const h = await fixture(t), authors = await inventory(h.root);
  const backendRegistry = fakeRegistry({ execute({ ready, state, finished }) {
    ready(); for (let i = 0; i < 260; i++) state(0, i % 2 ? 'idle' : 'moving'); finished(); return phaseResult('run');
  } });
  const service = serviceFor(t, h, { backendRegistry }), built = await buildService(service);
  const before = await inventory(h.cacheRoot);
  await service.command({ action: 'run', buildId: built.latestBuild.id, mode: 'headless' });
  const ended = await settled(service), view = await service.command({ action: 'inspect', jobId: ended.job.id });
  assert.equal(ended.job.events.length, 128); assert.ok(!ended.job.events.some(frame => frame.event === 'ready'));
  assert.equal(view.phase, 'finished'); assert.equal(view.sequence, 262); assert.equal(view.actors.length, 2);
  assert.deepEqual(view.actors.map(actor => actor.position), [[240, 220], [500, 220]]);
  assert.ok(view.actors.every(actor => actor.positionCurrent && actor.positionSample === 'finished'));
  assert.equal(view.buildId, built.latestBuild.id); assert.equal(view.snapshotId, built.latestBuild.snapshotId); assert.equal(view.backendId, bevyId);
  const definition = await service.command({ action: 'inspect', jobId: ended.job.id, objectId: actorId }); assert.equal(definition.actors.length, 2);
  const selected = await service.command({ action: 'inspect', jobId: ended.job.id, instanceId: view.actors[0].instanceId }); assert.equal(selected.actors.length, 1);
  assert.deepEqual((await service.command({ action: 'inspect', jobId: ended.job.id, instanceId: view.actors[0].instanceId, objectId: sceneId })).actors, []);
  assert.deepEqual((await service.command({ action: 'inspect', jobId: ended.job.id, objectId: sceneId })).actors, []);
  view.actors[0].position[0] = -1; view.actors[0].source.sourcePath = '/etc/passwd'; view.actors.length = 0;
  ended.job.runtime.actors[0].name = 'mutated';
  const unmodified = await service.command({ action: 'inspect', jobId: ended.job.id }); assert.equal(unmodified.actors[0].position[0], 240);
  assert.equal(unmodified.actors[0].source.sourcePath, 'documents/scenes/demo.json'); assert.notEqual(unmodified.actors[0].name, 'mutated');
  const persisted = await sessionRecord(h.cacheRoot); assert.deepEqual(persisted.record.runtime, (await service.status()).job.runtime);
  assert.equal(persisted.record.events.length, 262); await absent(path.join(path.dirname(persisted.file), 'project'));
  const after = await inventory(h.cacheRoot); for (const [file, hash] of Object.entries(before)) assert.equal(after[file], hash, file);
  assert.deepEqual(await inventory(h.root), authors);
});

test('active runtime queries bypass availability and keep last reported positions truthful through cancellation', async t => {
  const h = await fixture(t), running = gate(); let available = true, availabilityCalls = 0;
  const backendRegistry = fakeRegistry({ availability: async () => { availabilityCalls++; return { supported: true, available, reason: available ? null : 'tool_missing' }; },
    async execute({ ready, state, signal }) {
      ready(); state(0, 'moving'); running.resolve();
      await new Promise(resolve => { if (signal.aborted) resolve(); else signal.addEventListener('abort', resolve, { once: true }); });
      return phaseResult('run', 'cancelled');
    } });
  const service = serviceFor(t, h, { backendRegistry }), built = await buildService(service);
  await service.command({ action: 'run', buildId: built.latestBuild.id, mode: 'headless' }); await running.promise;
  const status = await waitView(service); available = false; const before = availabilityCalls;
  const view = await service.command({ action: 'inspect', jobId: status.job.id }); assert.equal(availabilityCalls, before);
  assert.equal(view.status, 'running'); assert.equal(view.actors[0].state, 'moving'); assert.deepEqual(view.actors[0].position, [200, 220]);
  assert.equal(view.actors[0].positionSample, 'ready'); assert.equal(view.actors[0].positionCurrent, false);
  assert.equal(view.actors[1].positionCurrent, true);
  await assert.rejects(service.command({ action: 'plan', sceneId }), { errorCode: 'build_busy' });
  await service.command({ action: 'cancel', jobId: status.job.id }); const ended = await settled(service);
  const cancelled = await service.command({ action: 'inspect', jobId: status.job.id });
  assert.equal(cancelled.status, 'cancelled'); assert.equal(cancelled.phase, 'ready'); assert.equal(cancelled.actors[0].positionCurrent, false);
  const persisted = await sessionRecord(h.cacheRoot); assert.deepEqual(persisted.record.runtime, ended.job.runtime);
  await absent(path.join(path.dirname(persisted.file), 'project'));
});

test('failed, timed-out and thrown runtime sessions retain admitted observations without inventing a final sample', async t => {
  for (const failure of ['failed', 'timeout', 'throw']) {
    const h = await fixture(t);
    const backendRegistry = fakeRegistry({ execute({ ready, state }) {
      ready(); state(0, 'moving');
      if (failure === 'throw') throw new Error('Trusted runtime failure.'); return phaseResult('run', failure);
    } });
    const service = serviceFor(t, h, { backendRegistry }), built = await buildService(service);
    await service.command({ action: 'run', buildId: built.latestBuild.id, mode: 'headless' }); const ended = await settled(service);
    assert.equal(ended.job.status, failure === 'throw' ? 'failed' : failure);
    const view = await service.command({ action: 'inspect', jobId: ended.job.id }); assert.equal(view.phase, 'ready');
    assert.equal(view.actors[0].state, 'moving'); assert.equal(view.actors[0].positionCurrent, false); assert.equal(view.actors[0].positionSample, 'ready');
    const persisted = await sessionRecord(h.cacheRoot); assert.deepEqual(persisted.record.runtime, ended.job.runtime);
    await absent(path.join(path.dirname(persisted.file), 'project'));
  }
});

test('observer progress is detached, emitted before cancelling event callbacks and absent for tampered builds', async t => {
  const h = await fixture(t), backendRegistry = fakeRegistry({ execute({ ready }) { ready(); return phaseResult('run', 'cancelled'); } });
  const built = await buildProject({ root: h.root, scene: sceneId, backendId: bevyId, backendRegistry, tool: fakeTool.executable, output: h.output });
  assert.equal(built.ok, true);
  const controller = new AbortController(), notifications = [];
  const run = await runProjectBuild({ buildDirectory: h.output, backendRegistry, tool: fakeTool.executable, signal: controller.signal,
    onProgress(event) {
      if (event.runtime) {
        notifications.push(event.runtime.phase); event.runtime.actors[0].position = [-1, -1]; event.runtime.actors[0].source.sourcePath = '/tmp/untrusted';
      }
      if (event.event?.event === 'ready') { assert.deepEqual(notifications.slice(0, 2), ['waiting', 'ready']); controller.abort(); }
    } });
  assert.equal(run.status, 'cancelled'); assert.equal(run.record.runtime.phase, 'ready');
  assert.deepEqual(run.record.runtime.actors[0].position, [200, 220]); assert.equal(run.record.runtime.actors[0].source.sourcePath, 'documents/scenes/demo.json');
  await fs.appendFile(path.join(h.output, 'project/scene-data.json'), ' ');
  const unexpected = [], invalid = await runProjectBuild({ buildDirectory: h.output, backendRegistry, tool: fakeTool.executable,
    onProgress: event => { if (event.runtime) unexpected.push(event.runtime); } });
  assert.equal(invalid.diagnostics[0].code, 'runtime_artifact_changed'); assert.deepEqual(unexpected, []); assert.equal(invalid.record, undefined);
});

test('real Godot and Bevy services expose the same v1/v2 object view and preserve author and frozen build bytes',
  { skip: !bevy || !godot || process.platform !== 'linux', timeout: 60000 }, async t => {
    for (const version of [1, 2]) {
      const h = await fixture(t, { version }), authors = await inventory(h.root), views = [];
      for (const [backendId, tool] of [[godotId, godot], [bevyId, bevy]]) {
        const service = serviceFor(t, h, { backendId, backendRegistry: createExecutionBackendRegistry(), tool, cacheRoot: path.join(h.base, backendId) });
        const built = await buildService(service), before = await inventory(path.join(h.base, backendId));
        await service.command({ action: 'run', buildId: built.latestBuild.id, mode: 'headless' }); const ended = await settled(service);
        assert.equal(ended.job.status, 'succeeded', JSON.stringify(ended));
        const query = await service.command({ action: 'inspect', jobId: ended.job.id, objectId: actorId });
        assert.equal(query.status, 'succeeded'); assert.equal(query.protocolVersion, version); assert.equal(query.phase, 'finished');
        assert.equal(query.actors.length, version === 1 ? 1 : 2); assert.deepEqual(query.actors[0].position, [240, 220]);
        if (version === 1) assert.equal(query.actors[0].instanceId, undefined);
        const { jobId: _job, buildId: _build, backendId: _backend, ...view } = query; views.push(view);
        const after = await inventory(path.join(h.base, backendId)); for (const [file, hash] of Object.entries(before)) assert.equal(after[file], hash, file);
      }
      assert.deepEqual(views[0], views[1]); assert.deepEqual(await inventory(h.root), authors);
    }
  });

test('real CLI offline replay records neutral object inspection and cancellation retains the ready sample',
  { skip: !bevy || process.platform !== 'linux', timeout: 60000 }, async t => {
    const h = await fixture(t), authors = await inventory(h.root);
    const built = await runProjectBuildCommand(['--command', 'build', '--root', h.root, '--scene', sceneId, '--backend', bevyId, '--tool', bevy, '--output', h.output]);
    assert.equal(built.ok, true, JSON.stringify(built)); const frozen = await inventory(h.output);
    await fs.rename(h.root, h.root + '-offline');
    const replay = await runProjectBuildCommand(['--command', 'run', '--build', h.output, '--backend', bevyId, '--tool', bevy]);
    assert.equal(replay.ok, true, JSON.stringify(replay)); assert.equal(replay.record.runtime.phase, 'finished');
    assert.deepEqual(replay.record.runtime.actors.map(actor => actor.position), [[240, 220], [500, 220]]);
    const controller = new AbortController(), samples = [];
    const cancelled = await runProjectBuild({ buildDirectory: h.output, backendId: bevyId, tool: bevy, smoke: false, signal: controller.signal,
      onProgress(event) { if (event.runtime) samples.push(event.runtime.phase); if (event.event?.event === 'ready') controller.abort(); } });
    assert.equal(cancelled.status, 'cancelled'); assert.equal(cancelled.record.runtime.phase, 'ready'); assert.deepEqual(samples.slice(0, 2), ['waiting', 'ready']);
    assert.equal(cancelled.record.runtime.actors[0].positionCurrent, true); assert.deepEqual(cancelled.record.runtime.actors[0].position, [200, 220]);
    const saved = JSON.parse(await fs.readFile(path.join(cancelled.sessionDirectory, 'session.json'))); assert.deepEqual(saved.runtime, cancelled.record.runtime);
    await absent(path.join(cancelled.sessionDirectory, 'project')); assert.deepEqual(await inventory(h.root + '-offline'), authors);
    const after = await inventory(h.output); for (const [file, hash] of Object.entries(frozen)) assert.equal(after[file], hash, file);
  });

test('real Godot behavior protocol keeps neutral actor observations separate from custom behavior frames',
  { skip: !godot || process.platform !== 'linux', timeout: 60000 }, async t => {
    const h = await fixture(t, { example: 'scene-behaviors' }), authors = await inventory(h.root);
    const built = await buildProject({ root: h.root, scene: sceneId, tool: godot, output: h.output }); assert.equal(built.ok, true, JSON.stringify(built));
    const run = await runProjectBuild({ buildDirectory: h.output, tool: godot }); assert.equal(run.ok, true, JSON.stringify(run));
    assert.equal(run.record.runtime.protocolVersion, 3); assert.equal(run.record.runtime.phase, 'finished');
    assert.equal(run.record.runtime.sequence, 2); assert.ok(run.record.events.some(frame => frame.event === 'behavior'));
    assert.equal(run.record.runtime.actors.length, 2); assert.ok(run.record.runtime.actors.every(actor => actor.state === 'idle'));
    assert.deepEqual(await inventory(h.root), authors);
  });
