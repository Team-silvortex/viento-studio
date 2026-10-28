import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { projectAssemblyBuildFixture } from './helpers/project-assembly-backend-fixture.mjs';
import { enterScene, readyScene, exitScene, projectLine } from './helpers/project-runtime-fixture.mjs';
import { stateFrame } from './helpers/project-shared-state-fixture.mjs';
import { delivery } from './helpers/project-event-bus-fixture.mjs';
import { createProjectFrameEncoder } from './helpers/project-execution-frames-fixture.mjs';
import { createExecutionBackendRegistry } from '../adapters/node-execution-backends.mjs';
import { runProjectBuild } from '../adapters/node-project-build.mjs';
import { createProjectBuildService } from '../lib/project-build-service.mjs';

const phase = (status = 'succeeded') => ({ status, exitCode: status === 'succeeded' ? 0 : 1, stdout: '', stderr: '', durationMs: 0 });
const clock = index => ({ idleFrame: 10 + index * 2, physicsFrame: 20 + index });
const position = index => ({ clock: clock(index), executionFrameIndex: index });
const counts = (handled = 1, skipped = 1) => ({ published: 1, settled: handled + skipped === 2 ? 1 : 0,
  pending: handled + skipped === 2 ? 0 : 1, deliveries: 2, handled, skipped, pendingDeliveries: 2 - handled - skipped });
async function fixture(t, mode = 'complete', gate) {
  const f = await projectAssemblyBuildFixture(t), protocol = f.build.backend.protocolVersion, plan = f.captured.plan;
  const scene = plan.scenes.find(row => row.scene.objectId === plan.entrySceneId), [receiver, publisher] = scene.behaviors.bindings;
  assert.ok(receiver && publisher);
  const wrap = frame => ({ ...frame, protocol });
  const recipients = [receiver, publisher].map((binding, index) => ({ subscriptionId: index + 1,
    bindingId: binding.bindingId, instanceId: binding.instanceId, objectId: binding.objectId }));
  const frames = [{ protocol, event: 'ready', assemblyId: plan.assembly.objectId, entrySceneId: plan.entrySceneId,
    stateRevision: 0, eventSequence: 0, audioCommandSequence: 0 }, wrap(enterScene(scene, 1)), wrap(readyScene(scene, 1)),
  { protocol, event: 'event-publish', visitIndex: 1, sceneId: scene.scene.objectId, bindingId: publisher.bindingId,
    instanceId: publisher.instanceId, objectId: publisher.objectId, sequence: 1, name: 'checkpoint', value: '风 / 風', recipients },
  wrap(delivery(scene, 1, 1, 1)), wrap(delivery(scene, 1, 1, 2, 'skipped')), wrap(exitScene(scene, 1, .5)),
  { protocol, event: 'finished', assemblyId: plan.assembly.objectId, visitCount: 1, totalSeconds: .5,
    stateRevision: 0, eventSequence: 1, audioCommandSequence: 0 }];
  const outputFrames = mode === 'cancel' ? frames.slice(0, 4) : mode === 'tail-delivery' ? frames.slice(0, 5)
    : mode === 'retention-cancel' ? [...frames.slice(0, 4), ...Array.from({ length: 130 }, (_, i) => wrap(stateFrame(scene, 1, i + 1, 'progress', i + 1)))] : frames;
  let executed = false;
  const adapter = { ...f.adapter,
    identify: async () => ({ ...f.build.tool, executable: process.execPath }),
    ...(mode === 'legacy-reader' ? { createEventReader: (input, options) => f.adapter.createEventReader(input, { ...options, capabilities: [] }) } : {}),
    async executePhase(context) {
      if (context.phase !== 'run') return phase();
      executed = true; const encode = createProjectFrameEncoder();
      for (const [offset, frame] of outputFrames.entries()) {
        let text = mode === 'legacy-reader' ? projectLine(frame) : encode(frame, clock(offset + 1));
        if ((mode === 'tail-delivery' || mode === 'tail-finished') && offset === outputFrames.length - 1) text = text.trimEnd();
        context.onOutput({ stream: 'stdout', text });
        if (offset === 3 && gate) { gate.enter(); await gate.wait; }
      }
      return phase(mode.endsWith('cancel') ? 'cancelled' : mode === 'tail-delivery' ? 'failed' : 'succeeded');
    },
  };
  return { ...f, plan, scene, receiver, publisher, frames, outputFrames, adapter,
    backendRegistry: createExecutionBackendRegistry([adapter]), executed: () => executed };
}
async function run(f, onProgress) {
  const result = await runProjectBuild({ buildDirectory: f.directory, tool: process.execPath,
    backendRegistry: f.backendRegistry, headless: true, smoke: false, onProgress });
  assert.ok(result.record, JSON.stringify(result));
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(result.sessionDirectory, 'session.json'))), result.record);
  await assert.rejects(fs.stat(path.join(result.sessionDirectory, 'project')), { code: 'ENOENT' });
  return result;
}
const unpositioned = item => {
  const { published, deliveries, ...entry } = item;
  return { ...entry, deliveries: deliveries.map(({ delivered, ...recipient }) => recipient) };
};

test('event positions persist with the original ledger, separate recipient sources and detached progress views', async t => {
  const f = await fixture(t, 'tail-finished'), views = [];
  const result = await run(f, event => {
    if (!event.eventPositions) return;
    views.push(structuredClone(event.eventPositions));
    const item = event.eventPositions.items[0];
    if (item) {
      item.origin.source.sourcePath = 'forged-publisher'; item.published.clock.idleFrame = -1;
      item.deliveries[0].origin.source.sourcePath = 'forged-recipient';
      if (item.deliveries[0].delivered) item.deliveries[0].delivered.clock.physicsFrame = -1;
      item.deliveries.length = 0;
    }
    event.eventPositions.items.length = 0;
  });
  assert.equal(result.ok, true, JSON.stringify(result.record.diagnostics));
  const value = result.record.eventPositions, item = value.items[0];
  assert.equal(value.format, 'viento-project-event-positions'); assert.equal(value.schemaVersion, 1); assert.equal(value.phase, 'finished');
  assert.deepEqual(value.counts, counts()); assert.deepEqual(item.published, position(4));
  assert.deepEqual(item.deliveries.map(row => row.delivered), [position(5), position(6)]);
  assert.deepEqual(item.origin.source, f.publisher.declaration);
  assert.deepEqual(item.deliveries[0].origin.source, f.receiver.declaration);
  assert.deepEqual(item.deliveries[1].origin.source, f.publisher.declaration);
  assert.deepEqual(value.items.map(unpositioned), result.record.runtime.project.events.entries);
  assert.deepEqual(result.record.events, f.frames); assert.equal(result.record.executionFrames.totalFrames, 8);
  assert.deepEqual(value.retention, { limit: 32, total: 1, retained: 1, dropped: 0, pending: 0, settled: 1, firstSequence: 1, lastSequence: 1 });
  assert.ok(views.some(view => view.phase === 'finished'));
});

for (const boundary of ['publication-business', 'publication-position', 'delivery-business', 'delivery-position']) {
  test(`a ${boundary} consumer failure preserves the uniquely admitted event position`, async t => {
    const f = await fixture(t), atDelivery = boundary.startsWith('delivery'); let thrown = false;
    const result = await run(f, event => {
      const trigger = boundary.endsWith('business') ? event.event?.event === (atDelivery ? 'event-delivery' : 'event-publish')
        : atDelivery ? event.eventPositions?.counts.handled === 1 : event.eventPositions?.counts.published === 1;
      if (!thrown && trigger) { thrown = true; throw new Error('private event position observer detail'); }
    });
    assert.equal(thrown, true); assert.equal(result.status, 'failed');
    const value = result.record.eventPositions, frameCount = atDelivery ? 5 : 4;
    assert.equal(value.phase, 'incomplete'); assert.deepEqual(value.counts, counts(atDelivery ? 1 : 0, 0));
    assert.deepEqual(value.items[0].published, position(4));
    if (atDelivery) assert.deepEqual(value.items[0].deliveries[0].delivered, position(5));
    else assert.equal(Object.hasOwn(value.items[0].deliveries[0], 'delivered'), false);
    assert.equal(Object.hasOwn(value.items[0].deliveries[1], 'delivered'), false);
    assert.deepEqual(result.record.events, f.frames.slice(0, frameCount));
    assert.equal(result.record.eventRetention.total, frameCount); assert.equal(result.record.executionFrames.totalFrames, frameCount);
    assert.deepEqual(value.items.map(unpositioned), result.record.runtime.project.events.entries);
    assert.equal(JSON.stringify(result.record.diagnostics).includes('private event position'), false);
  });
}

test('initial event position observer failure saves an empty incomplete view without executing the process', async t => {
  const f = await fixture(t), result = await run(f, event => { if (event.eventPositions) throw new Error('initial event positions observer'); });
  assert.equal(result.status, 'failed'); assert.equal(f.executed(), false);
  assert.equal(result.record.eventPositions.phase, 'incomplete'); assert.deepEqual(result.record.eventPositions.items, []);
  assert.deepEqual(result.record.eventPositions.counts, { published: 0, settled: 0, pending: 0, deliveries: 0, handled: 0, skipped: 0, pendingDeliveries: 0 });
});

test('an unterminated downstream delivery is finalized before failed session evidence is saved', async t => {
  const f = await fixture(t, 'tail-delivery'), result = await run(f);
  assert.equal(result.status, 'failed'); assert.equal(result.record.eventPositions.phase, 'incomplete');
  assert.deepEqual(result.record.eventPositions.counts, counts(1, 0));
  assert.deepEqual(result.record.eventPositions.items[0].delivered, undefined);
  assert.deepEqual(result.record.eventPositions.items[0].deliveries[0].delivered, position(5));
  assert.equal(Object.hasOwn(result.record.eventPositions.items[0].deliveries[1], 'delivered'), false);
  assert.deepEqual(result.record.events, f.outputFrames); assert.equal(result.record.executionFrames.totalFrames, 5);
});

test('cancellation after publication keeps pending recipients without manufactured delivery evidence', async t => {
  const f = await fixture(t, 'cancel'), result = await run(f);
  assert.equal(result.status, 'cancelled'); assert.equal(result.record.eventPositions.phase, 'incomplete');
  assert.deepEqual(result.record.eventPositions.counts, counts(0, 0));
  assert.deepEqual(result.record.eventPositions.items[0].published, position(4));
  for (const row of result.record.eventPositions.items[0].deliveries) { assert.equal(row.status, 'pending'); assert.equal(Object.hasOwn(row, 'delivered'), false); }
  assert.deepEqual(result.record.events, f.outputFrames);
});

test('pending publication positions survive both host raw-event and execution-frame tail eviction', async t => {
  const f = await fixture(t, 'retention-cancel'), result = await run(f);
  assert.equal(result.status, 'cancelled'); assert.equal(result.record.eventPositions.phase, 'incomplete');
  assert.deepEqual(result.record.eventPositions.counts, counts(0, 0));
  assert.equal(result.record.events.length, 128); assert.equal(result.record.eventRetention.total, 134);
  assert.equal(result.record.events.some(frame => frame.event === 'event-publish'), false);
  assert.equal(result.record.executionFrames.frames.some(frame => frame.index === 4), false);
  assert.deepEqual(result.record.eventPositions.items[0].published, position(4));
  assert.deepEqual(result.record.eventPositions.items.map(unpositioned), result.record.runtime.project.events.entries);
});

async function settle(service) {
  for (let n = 0; n < 1000; n++) { const state = await service.status(); if (state.job?.status !== 'running') return state; await delay(10); }
  assert.fail('Service did not settle.');
}
test('task service publishes detached live pending and final settled event positions', async t => {
  let release, enter; const wait = new Promise(resolve => { release = resolve; }), entered = new Promise(resolve => { enter = resolve; });
  t.after(() => release());
  const f = await fixture(t, 'complete', { wait, enter });
  const service = createProjectBuildService(f.author, { tool: process.execPath, backendRegistry: f.backendRegistry, cacheRoot: path.join(f.temporary, 'service-builds') });
  t.after(() => service.close());
  await service.command({ action: 'build', targetId: f.assemblyId });
  const built = await settle(service); assert.equal(built.job.status, 'succeeded', JSON.stringify(built.job.diagnostics));
  await service.command({ action: 'run', buildId: built.latestBuild.id, mode: 'headless' }); await entered;
  const live = await service.status(); assert.deepEqual(live.job.eventPositions.counts, counts(0, 0));
  live.job.eventPositions.items[0].published.clock.idleFrame = -1; live.job.eventPositions.items[0].origin.source.sourcePath = 'forged'; live.job.eventPositions.items.length = 0;
  assert.deepEqual((await service.status()).job.eventPositions.items[0].published, position(4));
  release(); const final = await settle(service);
  assert.equal(final.job.status, 'succeeded', JSON.stringify(final.job.diagnostics));
  assert.equal(final.job.eventPositions.phase, 'finished'); assert.deepEqual(final.job.eventPositions.counts, counts());
  final.job.eventPositions.items[0].deliveries[0].delivered.clock.idleFrame = -1;
  assert.deepEqual((await service.status()).job.eventPositions.items[0].deliveries[0].delivered, position(5));
});

test('a host adapter returning an older reader keeps its original session event DTO without new fields', async t => {
  const f = await fixture(t, 'legacy-reader'), result = await run(f);
  assert.equal(result.ok, true, JSON.stringify(result.record.diagnostics));
  assert.equal(Object.hasOwn(result.record, 'eventPositions'), false); assert.equal(Object.hasOwn(result.record, 'executionFrames'), false);
  assert.deepEqual(result.record.events, f.frames);
  assert.deepEqual(result.record.runtime.project.events.entries[0].deliveries.map(row => row.status), ['handled', 'skipped']);
});

test('Godot event position selection leaves capability-free readers and old protocol DTOs unchanged', async t => {
  const f = await fixture(t);
  for (const capabilities of [undefined, []]) {
    let snapshots = 0;
    const reader = f.adapter.createEventReader(f.plan, { protocolVersion: 4, capabilities, onEventPositionsSnapshot: () => { snapshots++; } });
    reader.push(f.frames.map(projectLine).join('')); reader.finish();
    assert.equal(Object.hasOwn(reader, 'eventPositions'), false); assert.equal(snapshots, 0);
    assert.deepEqual(reader.events, f.frames); assert.deepEqual(reader.diagnostics, []);
  }
  for (const protocolVersion of [1, 2]) {
    const reader = f.adapter.createEventReader(f.plan, { protocolVersion, capabilities: ['runtime.execution-frames'] });
    const frames = [f.frames[0], ...f.frames.slice(1, 3), ...f.frames.slice(6)].map(frame => {
      const value = { ...frame, protocol: protocolVersion }; delete value.eventSequence; delete value.audioCommandSequence;
      if (protocolVersion === 1) delete value.stateRevision; return value;
    });
    const encode = createProjectFrameEncoder(); reader.push(frames.map(frame => encode(frame)).join('')); reader.finish();
    assert.equal(Object.hasOwn(reader, 'eventPositions'), false); assert.deepEqual(reader.events, frames); assert.deepEqual(reader.diagnostics, []);
  }
});
