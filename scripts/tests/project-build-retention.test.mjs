import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createProjectBuildService } from '../lib/project-build-service.mjs';
import { createExecutionBackendRegistry } from '../adapters/node-execution-backends.mjs';
import { buildHash } from '../adapters/node-build-snapshot.mjs';
import { GODOT4_EXECUTION_ADAPTER } from '../backends/godot4-adapter.mjs';
import * as suiteFixture from './runtime-case-suite-fixture.mjs';

const sceneId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const logLimit = 32768, eventLimit = 128;
const emptyRetention = () => ({
  logs: { unit: 'utf16-code-units', limit: logLimit, total: 0, retained: 0, dropped: 0 },
  events: { unit: 'records', limit: eventLimit, total: 0, retained: 0, dropped: 0 },
});
function deferred() {
  let resolve;
  return { promise: new Promise(done => { resolve = done; }), resolve };
}
async function settled(service) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const state = await service.status();
    if (state.job?.status !== 'running') return state;
    await delay(5);
  }
  assert.fail('Build job did not settle');
}
async function fixture(t, run) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-build-retention-'));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const root = path.join(base, 'source'), tool = path.join(base, 'host-owned-tool');
  await fs.cp(new URL('../../examples/scene2d/', import.meta.url), root, { recursive: true });
  await fs.writeFile(tool, 'host-owned retention fixture\n', { mode: 0o700 });
  const output = [], frames = [], accepted = [];
  const backendRegistry = createExecutionBackendRegistry([{ ...GODOT4_EXECUTION_ADAPTER,
    async identify(executable) {
      return { executable, version: '4.7.2.stable', sha256: buildHash(await fs.readFile(executable)), platform: process.platform, arch: process.arch };
    },
    createEventReader(plan, options) {
      return GODOT4_EXECUTION_ADAPTER.createEventReader(plan, { ...options, onEvent: frame => {
        accepted.push(frame); options.onEvent?.(frame);
      } });
    },
    async executePhase({ phase, directory, onOutput, signal }) {
      const result = { status: 'succeeded', exitCode: 0, stdout: '', stderr: '' };
      if (phase !== 'run') return result;
      const scene = JSON.parse(await fs.readFile(path.join(directory, 'scene.json'), 'utf8'));
      const actors = scene.actors.map(actor => ({ objectId: actor.objectId, position: actor.position, state: 'idle' }));
      const send = (stream, text) => { output.push({ stream, text }); onOutput({ stream, text }); };
      const emit = frame => { frames.push(frame); send('stdout', `VIENTO_RUNTIME:${JSON.stringify(frame)}\n`); };
      const status = await run({ signal, actors, scene, emit, output: send });
      return { ...result, status: status || 'succeeded', exitCode: status === 'failed' ? 1 : status === 'cancelled' ? null : 0,
        stdout: output.filter(chunk => chunk.stream === 'stdout').map(chunk => chunk.text).join(''),
        stderr: output.filter(chunk => chunk.stream === 'stderr').map(chunk => chunk.text).join('') };
    },
  }]);
  const service = createProjectBuildService(root, { tool, backendRegistry, cacheRoot: path.join(base, 'cache') });
  t.after(() => service.close());
  assert.equal((await service.status()).job, null);
  await service.command({ action: 'build', sceneId });
  const built = await settled(service);
  assert.equal(built.job.status, 'succeeded', JSON.stringify(built.job.diagnostics));
  return { service, built, output, frames, accepted };
}
function assertRetention(job, output, frames) {
  const total = output.reduce((count, chunk) => count + chunk.text.length, 0);
  assert.deepEqual(job.retention, {
    logs: { unit: 'utf16-code-units', limit: logLimit, total, retained: job.logs.length, dropped: total - job.logs.length },
    events: { unit: 'records', limit: eventLimit, total: frames.length, retained: Math.min(eventLimit, frames.length),
      dropped: Math.max(0, frames.length - eventLimit) },
  });
  assert.ok(job.logs.length <= logLimit);
  assert.deepEqual(job.events, frames.slice(-eventLimit));
}
function ready(scene, actors) { return { protocol: 1, event: 'ready', sceneObjectId: scene.objectId, actors }; }
function state(actor, index) { return { protocol: 1, event: 'state', objectId: actor.objectId, state: index % 2 ? 'idle' : 'moving' }; }
function finished(actors) { return { protocol: 1, event: 'finished', actors, fixedDelta: 0.25 }; }

test('host retention starts empty for each task and a tool check preserves the current task', { skip: process.platform !== 'linux' }, async t => {
  const { service, built } = await fixture(t, async () => {});
  assert.deepEqual(built.job.retention, emptyRetention());
  const checked = await service.command({ action: 'tool-check' });
  assert.deepEqual(checked.job, built.job);
  await service.command({ action: 'plan', sceneId });
  const planned = await settled(service);
  assert.equal(planned.job.status, 'succeeded');
  assert.notEqual(planned.job.id, built.job.id);
  assert.deepEqual(planned.job.retention, emptyRetention());
});

test('host log and event retention stays bounded while every admitted frame reaches observation', { skip: process.platform !== 'linux' }, async t => {
  const entered = deferred(), release = deferred();
  t.after(() => release.resolve());
  const h = await fixture(t, async ({ scene, actors, emit, output }) => {
    emit(ready(scene, actors));
    output('stdout', 'x'.repeat(logLimit * 3) + '\n');
    output('stderr', '中'.repeat(300) + '\n');
    for (let index = 1; index <= 140; index++) emit(state(actors[0], index));
    // The last 32768 code units would start in the middle of this pair.
    output('stdout', '😀' + 'z'.repeat(logLimit - 2) + '\n');
    entered.resolve(); await release.promise;
    emit(finished(actors));
  });
  const started = await h.service.command({ action: 'run', buildId: h.built.latestBuild.id, mode: 'headless' });
  await entered.promise;
  const active = await h.service.status();
  assert.equal(active.job.status, 'running');
  assert.equal(active.job.logs, 'z'.repeat(logLimit - 2) + '\n');
  assert.equal(active.job.retention.logs.retained, logLimit - 1);
  assertRetention(active.job, h.output, h.frames);
  assert.equal(active.job.retention.events.total, 141);
  assert.equal(active.job.retention.events.dropped, 13);
  assert.equal(active.job.runtime.sequence, 141);
  assert.equal(active.job.runtime.actors[0].state, 'moving');
  assert.equal(h.accepted.length, 141);
  active.job.retention.logs.total = -1;
  active.job.retention.events.dropped = -1;
  active.job.events[0].state = 'forged'; active.job.logs = 'forged';
  const detached = await h.service.status();
  assertRetention(detached.job, h.output, h.frames);
  assert.equal(detached.job.logs, 'z'.repeat(logLimit - 2) + '\n');
  const view = await h.service.command({ action: 'inspect', jobId: started.job.id });
  assert.equal(view.sequence, 141); assert.equal(view.actors[0].state, 'moving');
  release.resolve();
  const complete = await settled(h.service);
  assert.equal(complete.job.status, 'succeeded', JSON.stringify(complete.job.diagnostics));
  assert.equal(complete.job.runtime.phase, 'finished');
  assert.equal(complete.job.runtime.sequence, 142);
  assert.equal(h.accepted.length, 142);
  assertRetention(complete.job, h.output, h.frames);
  assert.deepEqual(complete.job.diagnostics, []);
});

test('host retention survives failed execution without stopping later observation at the history limit', { skip: process.platform !== 'linux' }, async t => {
  const h = await fixture(t, async ({ scene, actors, emit, output }) => {
    emit(ready(scene, actors));
    for (let index = 1; index <= 140; index++) emit(state(actors[0], index));
    output('stderr', 'last failure context\n'.repeat(3000));
    emit({ protocol: 1, event: 'diagnostic', severity: 'error', code: 'runtime_fixture_failed', message: 'The fixture failed.' });
    return 'failed';
  });
  await h.service.command({ action: 'run', buildId: h.built.latestBuild.id, mode: 'headless' });
  const complete = await settled(h.service);
  assert.equal(complete.job.status, 'failed');
  assert.equal(complete.job.runtime.sequence, 141);
  assert.equal(complete.job.runtime.actors[0].state, 'moving');
  assert.equal(h.accepted.length, 142);
  assert.ok(complete.job.diagnostics.some(item => item.code === 'runtime_fixture_failed'));
  assertRetention(complete.job, h.output, h.frames);
});

test('host retention includes output drained after cancel and keeps the complete admitted observation', { skip: process.platform !== 'linux' }, async t => {
  const entered = deferred();
  const h = await fixture(t, async ({ signal, scene, actors, emit, output }) => {
    emit(ready(scene, actors));
    for (let index = 1; index <= 140; index++) emit(state(actors[0], index));
    await new Promise(resolve => {
      if (signal.aborted) resolve();
      else signal.addEventListener('abort', resolve, { once: true });
      entered.resolve();
    });
    output('stderr', 'drained after cancel\n'.repeat(3000));
    for (let index = 141; index <= 160; index++) emit(state(actors[0], index));
    emit(finished(actors));
    return 'cancelled';
  });
  const started = await h.service.command({ action: 'run', buildId: h.built.latestBuild.id, mode: 'headless' });
  await entered.promise;
  const active = await h.service.status();
  assert.equal(active.job.retention.events.total, 141);
  await h.service.command({ action: 'cancel', jobId: started.job.id });
  const complete = await settled(h.service);
  assert.equal(complete.job.status, 'cancelled');
  assert.equal(complete.job.runtime.phase, 'finished');
  assert.equal(complete.job.runtime.sequence, 162);
  assert.equal(h.accepted.length, 162);
  assertRetention(complete.job, h.output, h.frames);
  assert.match(complete.job.logs, /drained after cancel/);
  const view = await h.service.command({ action: 'inspect', jobId: started.job.id });
  assert.equal(view.status, 'cancelled'); assert.equal(view.sequence, 162);
});

test('suite retention counts cleared member history while the next member owns an empty event window', { skip: process.platform !== 'linux' }, async t => {
  const entered = deferred(), release = deferred();
  t.after(() => release.resolve());
  const h = await suiteFixture.fixture(t), saved = await suiteFixture.savedSuite(h);
  let runs = 0;
  const backendRegistry = suiteFixture.registry({ async execute(context) {
    runs++;
    if (runs === 2) { entered.resolve(); await release.promise; }
    context.ready();
    const actor = context.actors[0];
    for (let index = 1; index <= 130; index++) context.emit({ protocol: 2, event: 'state',
      instanceId: actor.instanceId, objectId: actor.objectId, state: index % 2 ? 'idle' : 'moving' });
    context.controlProgram.steps.forEach((_, index) => context.sample(index));
    context.finished(); context.flush();
    return suiteFixture.phaseResult('run');
  } });
  const service = suiteFixture.service(t, h, { backendRegistry }), built = await suiteFixture.builtService(service);
  await service.command({ action: 'suite-run', buildId: built.latestBuild.id,
    suiteDocumentId: saved.group.id, expectedVersion: saved.group.version });
  await entered.promise;
  const switching = await service.status();
  assert.equal(switching.job.kind, 'suite');
  assert.equal(switching.job.status, 'running');
  assert.deepEqual(switching.job.events, []);
  assert.deepEqual(switching.job.retention.events, { unit: 'records', limit: eventLimit, total: 132, retained: 0, dropped: 132 });
  assert.ok(switching.job.retention.logs.total > 0);
  assert.equal(switching.job.retention.logs.retained, switching.job.logs.length);
  release.resolve();
  const complete = await settled(service);
  assert.equal(complete.job.status, 'succeeded', JSON.stringify(complete.job.diagnostics));
  assert.equal(complete.job.suite.summary.status, 'passed');
  assert.equal(runs, 2);
  assert.equal(complete.job.events.length, eventLimit);
  assert.equal(complete.job.events.at(-1).event, 'finished');
  assert.deepEqual(complete.job.retention.events, { unit: 'records', limit: eventLimit, total: 264, retained: 128, dropped: 136 });
  assert.equal(complete.job.retention.logs.retained, complete.job.logs.length);
  assert.equal(complete.job.retention.logs.dropped, complete.job.retention.logs.total - complete.job.logs.length);
});
