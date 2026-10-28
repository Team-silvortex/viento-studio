import { createProjectFrameEncoder } from './helpers/project-execution-frames-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { projectAssemblyBuildFixture } from './helpers/project-assembly-backend-fixture.mjs';
import { enterScene, readyScene, exitScene } from './helpers/project-runtime-fixture.mjs';
import { publication, delivery } from './helpers/project-event-bus-fixture.mjs';
import { createExecutionBackendRegistry } from '../adapters/node-execution-backends.mjs';
import { runProjectBuild } from '../adapters/node-project-build.mjs';
import { createProjectBuildService } from '../lib/project-build-service.mjs';
import { createProjectCausalAnchors } from '../../engine/project-causal-anchors.mjs';
import { buildHash } from '../adapters/node-build-snapshot.mjs';

const result = () => ({ status: 'succeeded', exitCode: 0, stdout: '', stderr: '', durationMs: 0 });
function frames(f) {
  const plan = f.captured.plan, scene = plan.scenes.find(s => s.scene.objectId === plan.entrySceneId);
  const protocol = f.build.backend.protocolVersion, wrap = frame => ({ ...frame, protocol });
  return {
    start: [{ protocol, event: 'ready', assemblyId: plan.assembly.objectId, entrySceneId: plan.entrySceneId,
      stateRevision: 0, eventSequence: 0, audioCommandSequence: 0 }, wrap(enterScene(scene, 1)), wrap(readyScene(scene, 1))],
    publication: wrap(publication(scene, 1, 1, 'causal.test', 'source survives', undefined)),
    delivery: wrap(delivery(scene, 1, 1, 1)),
    finish: [wrap(exitScene(scene, 1, .5)), { protocol, event: 'finished', assemblyId: plan.assembly.objectId,
      visitCount: 1, totalSeconds: .5, stateRevision: 0, eventSequence: 1, audioCommandSequence: 0 }],
  };
}
async function fixture(t, execute) {
  const f = await projectAssemblyBuildFixture(t), emitted = frames(f);
  const tool = path.join(f.temporary, 'mock-engine'); await fs.writeFile(tool, 'mock engine', { mode: 0o700 });
  const adapter = { ...f.adapter, identify: async () => ({ ...f.build.tool, executable: tool }),
    executePhase: async context => { if (context.phase === 'run') { context.encodeProjectFrame = createProjectFrameEncoder(); await execute(context, emitted); } return result(); } };
  return { ...f, emitted, tool, adapter, backendRegistry: createExecutionBackendRegistry([adapter]) };
}
const send = (context, values) => context.onOutput({ stream: 'stdout', text: values.map(frame => context.encodeProjectFrame(frame)).join('') });
async function verifyDisk(f, run) {
  assert.ok(run.record, JSON.stringify(run));
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(run.sessionDirectory, 'session.json'))), run.record);
  await assert.rejects(fs.stat(path.join(run.sessionDirectory, 'project')), { code: 'ENOENT' });
  assert.deepEqual(run.record.causalAnchors, createProjectCausalAnchors(run.record.runtime));
  return run.record.causalAnchors;
}

test('project sessions publish detached causal anchors and save the admitted source after completion', async t => {
  const f = await fixture(t, (context, data) => send(context, [...data.start, data.publication, data.delivery, ...data.finish]));
  let detached, calls = 0;
  const run = await runProjectBuild({ buildDirectory: f.directory, tool: f.tool, backendRegistry: f.backendRegistry,
    smoke: false, onProgress: event => {
      if (event.causalAnchors?.nodes.length) {
        calls++; detached ??= structuredClone(event.causalAnchors);
        event.causalAnchors.nodes[0].record.origin.source.sourcePath = 'forged';
        event.causalAnchors.nodes.length = 0;
      }
    } });
  assert.equal(run.status, 'succeeded', JSON.stringify(run.record.diagnostics));
  const view = await verifyDisk(f, run); assert.ok(calls > 1);
  assert.equal(detached.nodes[0].record.deliveries[0].status, 'pending');
  assert.equal(view.nodes[0].record.deliveries[0].status, 'handled');
  const declared = f.captured.plan.scenes[0].behaviors.bindings[0].declaration;
  assert.deepEqual(view.nodes[0].record.origin.source, declared);
});

test('a consumer throwing after an admitted pending event cannot hide its causal source on disk', async t => {
  const f = await fixture(t, (context, data) => send(context, [...data.start, data.publication]));
  let calls = 0;
  const run = await runProjectBuild({ buildDirectory: f.directory, tool: f.tool, backendRegistry: f.backendRegistry,
    smoke: false, onProgress: event => {
      if (event.causalAnchors?.nodes.length) { calls++; throw new Error('causal observer fixture'); }
    } });
  assert.equal(run.status, 'failed'); assert.equal(calls, 1);
  const view = await verifyDisk(f, run);
  assert.ok(view.roots.find(root => root.id === 'events:1').reasons.includes('pending-delivery'));
  assert.equal(view.nodes[0].record.deliveries[0].status, 'pending');
  assert.equal(run.record.diagnostics.some(row => row.code === 'build_failed'), true);
});

test('an initial causal observer failure saves an empty view before the engine starts', async t => {
  let executed = false;
  const f = await fixture(t, () => { executed = true; });
  const run = await runProjectBuild({ buildDirectory: f.directory, tool: f.tool, backendRegistry: f.backendRegistry,
    smoke: false, onProgress: event => { if (event.causalAnchors) throw new Error('initial causal observer fixture'); } });
  assert.equal(run.status, 'failed'); assert.equal(executed, false);
  const view = await verifyDisk(f, run); assert.deepEqual(view.nodes, []);
  assert.equal(view.retention.aggregate.total, 0);
});

async function settled(service) {
  for (let count = 0; count < 2000; count++) {
    const view = await service.status(); if (view.job?.status !== 'running') return view;
    await delay(10);
  }
  assert.fail('Service did not settle');
}

test('task status retains detached live and final causal views through the service boundary', async t => {
  let release, entered;
  const gate = new Promise(resolve => { release = resolve; }), running = new Promise(resolve => { entered = resolve; });
  t.after(() => release());
  const f = await fixture(t, async (context, data) => {
    send(context, [...data.start, data.publication]); entered(); await gate;
    send(context, [data.delivery, ...data.finish]);
  });
  // The service really builds and verifies a generated frozen project. Only
  // process execution is substituted; this is not native-engine evidence.
  const adapter = { ...f.adapter, identify: async () => ({ ...f.build.tool, executable: f.tool,
    sha256: buildHash(await fs.readFile(f.tool)) }) };
  const service = createProjectBuildService(f.author, { tool: f.tool,
    backendRegistry: createExecutionBackendRegistry([adapter]), cacheRoot: path.join(f.temporary, 'service-cache') });
  t.after(() => service.close());
  await service.command({ action: 'build', targetId: f.assemblyId });
  const built = await settled(service); assert.equal(built.job.status, 'succeeded', JSON.stringify(built.job.diagnostics));
  await service.command({ action: 'run', buildId: built.latestBuild.id, mode: 'headless' });
  await running;
  const live = await service.status();
  assert.equal(live.job.causalAnchors.nodes[0].record.deliveries[0].status, 'pending');
  assert.equal(live.job.executionFrames.totalFrames, 4);
  assert.equal(live.job.executionFrames.phase, 'recording');
  live.job.executionFrames.frames.length = 0;
  assert.equal((await service.status()).job.executionFrames.frames.length, 4);
  live.job.causalAnchors.nodes[0].record.origin.source.sourcePath = 'forged';
  live.job.causalAnchors.nodes.length = 0;
  assert.equal((await service.status()).job.causalAnchors.nodes.length, 1);
  release(); const finished = await settled(service);
  assert.equal(finished.job.status, 'succeeded', JSON.stringify(finished.job.diagnostics));
  assert.equal(finished.job.causalAnchors.nodes[0].record.deliveries[0].status, 'handled');
  assert.equal(finished.job.executionFrames.totalFrames, 7);
  assert.equal(finished.job.executionFrames.phase, 'finished');
  assert.deepEqual(finished.job.causalAnchors, createProjectCausalAnchors(finished.job.runtime));
});
