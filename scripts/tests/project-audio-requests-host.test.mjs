import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { projectAudioControlAuthor } from './helpers/project-audio-control-author-fixture.mjs';
import { audioProjectReady, audioFrame, audioReady, audioCommand, audioFinished, audioProjectFinished } from './helpers/project-audio-command-fixture.mjs';
import { enterScene, readyScene, exitScene } from './helpers/project-runtime-fixture.mjs';
import { createProjectFrameEncoder } from './helpers/project-execution-frames-fixture.mjs';
import { buildProject, runProjectBuild } from '../adapters/node-project-build.mjs';
import { captureBuildSnapshot, buildHash } from '../adapters/node-build-snapshot.mjs';
import { createExecutionBackendRegistry } from '../adapters/node-execution-backends.mjs';
import { createProjectBuildService } from '../lib/project-build-service.mjs';

const phase = status => ({ status: status || 'succeeded', exitCode: status ? 1 : 0, stdout: '', stderr: '', durationMs: 0 });
const observationLine = value => 'VIENTO_AUDIO_REQUEST:' + JSON.stringify(value) + '\n';
async function fixture(t, mode = 'complete', gate) {
  const f = await projectAudioControlAuthor(t);
  const captured = await captureBuildSnapshot(f.author, f.assemblyId); assert.equal(captured.ok, true);
  const plan = captured.plan, scene = plan.scenes[0], binding = scene.behaviors.bindings[0];
  const origin = { visitIndex: 1, sceneId: scene.scene.objectId, bindingId: binding.bindingId, instanceId: binding.instanceId, objectId: binding.objectId };
  const track = scene.audio.document.tracks[0];
  const accept = { protocol: 1, event: 'accepted', requestId: 1, clock: { idleFrame: 10, physicsFrame: 10 }, origin, trackId: track.id, action: 'play' };
  const applied = { protocol: 1, event: 'applied', requestId: 1, clock: { idleFrame: 12, physicsFrame: 11 }, commandSequence: 1, executionFrameIndex: 5 };
  const tool = path.join(f.temporary, 'mock-engine'); await fs.writeFile(tool, 'isolated request observer fixture', { mode: 0o700 });
  const base = createExecutionBackendRegistry().resolve('org.viento.godot4'); let executed = false;
  const adapter = { ...base,
    identify: async () => ({ executable: tool, version: '4.7.2.stable.fixture', sha256: buildHash(await fs.readFile(tool)), platform: 'linux', arch: 'x64' }),
    executePhase: async context => {
      if (context.phase !== 'run') return phase();
      executed = true;
      const encode = createProjectFrameEncoder(), output = text => context.onOutput({ stream: 'stdout', text });
      output([audioProjectReady(plan), audioFrame(enterScene(scene, 1)), audioFrame(readyScene(scene, 1)), audioReady(scene, 1)].map(frame => encode(frame, { idleFrame: 9, physicsFrame: 9 })).join(''));
      output(observationLine(accept));
      if (gate) { gate.enter(); await gate.wait; }
      if (mode === 'cancel') return phase('cancelled');
      output(encode(audioCommand(scene, 1, 1), applied.clock));
      output(mode === 'tail' ? observationLine(applied).trimEnd() : observationLine(applied));
      if (mode === 'tail') return phase('failed');
      output(encode(audioFinished(scene, 1, .5), { idleFrame: 13, physicsFrame: 12 }));
      output(encode(audioFrame(exitScene(scene, 1, .5)), { idleFrame: 13, physicsFrame: 12 }));
      output(encode(audioProjectFinished(plan, 1, .5, 1), { idleFrame: 13, physicsFrame: 12 }));
      return phase();
    },
  };
  const backendRegistry = createExecutionBackendRegistry([adapter]), directory = path.join(f.temporary, 'request-build');
  const build = await buildProject({ root: f.author, targetId: f.assemblyId, tool, output: directory, backendRegistry });
  assert.equal(build.ok, true, JSON.stringify(build.record?.diagnostics || build));
  return { ...f, tool, plan, binding, accept, applied, adapter, backendRegistry, directory, executed: () => executed };
}
async function run(f, onProgress) {
  const result = await runProjectBuild({ buildDirectory: f.directory, tool: f.tool, backendRegistry: f.backendRegistry, smoke: false, onProgress });
  assert.ok(result.record, JSON.stringify(result));
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(result.sessionDirectory, 'session.json'))), result.record);
  await assert.rejects(fs.stat(path.join(result.sessionDirectory, 'project')), { code: 'ENOENT' });
  return result;
}

test('accepted and applied request positions persist with frozen origin and detached consumer views', async t => {
  const f = await fixture(t), result = await run(f, event => {
    if (event.audioRequests?.requests.length) {
      event.audioRequests.requests[0].origin.source.sourcePath = 'forged';
      event.audioRequests.requests[0].track.source.sourcePath = 'forged-track';
      event.audioRequests.requests.length = 0;
    }
  });
  assert.equal(result.ok, true, JSON.stringify(result.record.diagnostics));
  const value = result.record.audioRequests;
  assert.equal(value.phase, 'finished'); assert.deepEqual(value.counts, { accepted: 1, applied: 1, discarded: 0, pending: 0 });
  assert.deepEqual(value.requests[0].origin.source, f.binding.declaration);
  assert.deepEqual(value.requests[0].track.source, f.plan.scenes[0].audio.locations.tracks[0].declaration);
  assert.deepEqual(value.requests[0].acceptedClock, f.accept.clock);
  assert.deepEqual(value.requests[0].applied, { clock: f.applied.clock, commandSequence: 1, executionFrameIndex: 5 });
  assert.equal(result.record.executionFrames.totalFrames, 8);
});

for (const boundary of ['accepted', 'command', 'applied']) test(`a consumer failure at ${boundary} preserves only confirmed request evidence`, async t => {
  const f = await fixture(t); let thrown = false;
  const result = await run(f, event => {
    if (!thrown && (boundary === 'accepted' ? event.audioRequests?.counts.pending === 1
      : boundary === 'applied' ? event.audioRequests?.counts.applied === 1 : event.event?.event === 'audio-command')) {
      thrown = true; throw new Error('private request observer detail');
    }
  });
  assert.equal(thrown, true); assert.equal(result.status, 'failed');
  assert.equal(result.record.audioRequests.phase, 'incomplete');
  assert.equal(result.record.audioRequests.counts.accepted, 1);
  assert.equal(result.record.audioRequests.counts.applied, boundary === 'applied' ? 1 : 0);
  assert.equal(result.record.audioRequests.counts.pending, boundary === 'applied' ? 0 : 1);
  assert.equal(result.record.events.filter(row => row.event === 'audio-command').length, boundary === 'accepted' ? 0 : 1);
  assert.equal(JSON.stringify(result.record.diagnostics).includes('private request'), false);
});

test('initial request observer failure saves an empty incomplete view before process execution', async t => {
  const f = await fixture(t), result = await run(f, event => { if (event.audioRequests) throw new Error('initial request observer'); });
  assert.equal(result.status, 'failed'); assert.equal(f.executed(), false);
  assert.equal(result.record.audioRequests.phase, 'incomplete');
  assert.deepEqual(result.record.audioRequests.requests, []);
});

test('an unterminated applied observation is finalized before saving failed session evidence', async t => {
  const f = await fixture(t, 'tail'), result = await run(f);
  assert.equal(result.status, 'failed'); assert.equal(result.record.audioRequests.phase, 'incomplete');
  assert.deepEqual(result.record.audioRequests.counts, { accepted: 1, applied: 1, discarded: 0, pending: 0 });
});

test('process cancellation preserves a pending request without inventing discard or execution', async t => {
  const f = await fixture(t, 'cancel'), result = await run(f);
  assert.equal(result.status, 'cancelled'); assert.equal(result.record.audioRequests.phase, 'incomplete');
  assert.deepEqual(result.record.audioRequests.counts, { accepted: 1, applied: 0, discarded: 0, pending: 1 });
});

test('removing the request capability from a stored build rejects execution before selecting a reader', async t => {
  const f = await fixture(t), file = path.join(f.directory, 'build.json'), build = JSON.parse(await fs.readFile(file));
  build.backend.capabilities = build.backend.capabilities.filter(value => value !== 'runtime.audio-requests');
  await fs.writeFile(file, JSON.stringify(build));
  const result = await runProjectBuild({ buildDirectory: f.directory, tool: f.tool, backendRegistry: f.backendRegistry, smoke: false });
  assert.equal(result.ok, false); assert.equal(f.executed(), false);
  assert.ok(result.diagnostics.some(row => row.code === 'runtime_adapter_changed'));
});
async function settle(service) {
  for (let n = 0; n < 1000; n++) { const state = await service.status(); if (state.job?.status !== 'running') return state; await delay(10); }
  assert.fail('Service did not settle.');
}
test('task service keeps separate live pending and final applied request snapshots', async t => {
  let release, enter; const wait = new Promise(resolve => { release = resolve; }), entered = new Promise(resolve => { enter = resolve; });
  t.after(() => release());
  const f = await fixture(t, 'complete', { wait, enter });
  const service = createProjectBuildService(f.author, { tool: f.tool, backendRegistry: f.backendRegistry, cacheRoot: path.join(f.temporary, 'service-builds') });
  t.after(() => service.close());
  await service.command({ action: 'build', targetId: f.assemblyId });
  const built = await settle(service); assert.equal(built.job.status, 'succeeded');
  await service.command({ action: 'run', buildId: built.latestBuild.id, mode: 'headless' }); await entered;
  const live = await service.status(); assert.equal(live.job.audioRequests.counts.pending, 1);
  live.job.audioRequests.requests[0].acceptedClock.idleFrame = -1; live.job.audioRequests.requests.length = 0;
  assert.equal((await service.status()).job.audioRequests.requests[0].acceptedClock.idleFrame, 10);
  release(); const final = await settle(service); assert.equal(final.job.status, 'succeeded', JSON.stringify(final.job.diagnostics));
  assert.equal(final.job.audioRequests.phase, 'finished'); assert.equal(final.job.audioRequests.counts.applied, 1);
});
