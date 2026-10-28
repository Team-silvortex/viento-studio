import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { validateProjectEventPositions } from '../../engine/project-event-positions-query.mjs';
import { createProjectEventPositionsReader } from '../../engine/project-event-positions.mjs';
import { createProjectExecutionFramesReader, PROJECT_EXECUTION_FRAME_PREFIX } from '../../engine/project-execution-frames.mjs';
import { createProjectRuntimeEventReader } from '../../engine/project-runtime-events.mjs';
import { eventProject, eventReady, eventReturnTrip, publication, delivery } from './helpers/project-event-bus-fixture.mjs';
import { enterScene, readyScene } from './helpers/project-runtime-fixture.mjs';

const clone = value => structuredClone(value);
function fixture(limit = 32) {
  const plan = eventProject(), scene = plan.scenes[0], snapshots = [];
  const base = createProjectRuntimeEventReader(plan, { protocolVersion: 3 });
  const frames = createProjectExecutionFramesReader({ runtimeReader: base });
  const reader = createProjectEventPositionsReader({ runtimeReader: frames, retainedEvents: limit, onSnapshot: value => snapshots.push(value) });
  let index = 0;
  const push = frame => reader.push(PROJECT_EXECUTION_FRAME_PREFIX + JSON.stringify({ protocol: 1, index: ++index,
    clock: { idleFrame: index, physicsFrame: Math.floor(index / 2) }, frame }) + '\n');
  const start = () => [eventReady(plan), enterScene(scene, 1), readyScene(scene, 1)].map(frame => ({ ...frame, protocol: 3 })).forEach(push);
  const publish = (sequence, ids = [1], name = 'notice') => push(publication(scene, 1, sequence, name, true,
    ids.map(subscriptionId => ({ subscriptionId, ...Object.fromEntries(['bindingId', 'instanceId', 'objectId'].map(key => [key, scene.behaviors.bindings[0][key]])) }))));
  return { plan, scene, snapshots, reader, push, start, publish, deliver: (seq, id = 1, status = 'handled') => push(delivery(scene, 1, seq, id, status)) };
}
const rejects = value => assert.throws(() => validateProjectEventPositions(value), { errorCode: 'runtime_project_invalid' });

test('every real admitted frame, lifecycle phase and returned view is independently copied', () => {
  const f = fixture(); eventReturnTrip(f.plan).forEach(f.push); f.reader.finish();
  assert.equal(f.reader.eventPositions.phase, 'finished');
  for (const view of f.snapshots) assert.deepEqual(validateProjectEventPositions(view), view);
  const input = f.reader.eventPositions, value = validateProjectEventPositions(input);
  value.items[0].origin.source.sourcePath = 'modified'; value.items[0].published.clock.idleFrame = 10000;
  assert.notEqual(input.items[0].origin.source.sourcePath, 'modified'); assert.notEqual(input.items[0].published.clock.idleFrame, 10000);
});

test('nested publishing, partial callbacks and retained tails with empty settlements are valid', () => {
  const f = fixture(1); f.start(); f.publish(1, [1, 2]); f.publish(2, [1]); f.deliver(1, 1);
  f.publish(3, []); f.publish(4, []); f.reader.finish();
  assert.equal(f.reader.eventPositions.phase, 'incomplete');
  assert.deepEqual(f.reader.eventPositions.items.map(item => item.sequence), [1, 2, 4]);
  for (const view of f.snapshots) assert.deepEqual(validateProjectEventPositions(view), view);
});

test('rejects executable accessors, nonportable object prototypes, cycles and sparse arrays without invoking getters', () => {
  const f = fixture(); f.start(); f.publish(1); const view = f.reader.eventPositions; let calls = 0;
  const bad = clone(view); Object.defineProperty(bad.items[0], 'name', { enumerable: true, get() { calls++; throw Error('getter'); } });
  rejects(bad); assert.equal(calls, 0);
  const sparse = clone(view); sparse.items.length = 2; rejects(sparse);
  const cyclic = clone(view); cyclic.extra = cyclic; rejects(cyclic);
  const custom = clone(view); Object.setPrototypeOf(custom.items[0], { foo: true }); rejects(custom);
});

test('rejects malformed or contradictory aggregates, phase, retention and out-of-range counts', () => {
  const f = fixture(1); f.start(); f.publish(1); f.deliver(1); f.publish(2); const view = f.reader.eventPositions;
  const mutations = [v => v.schemaVersion++, v => v.extra = true, v => v.counts.published++, v => v.counts.pending--,
    v => v.counts.deliveries++, v => v.counts.handled++, v => v.counts.pendingDeliveries--,
    v => v.retention.dropped++, v => v.retention.retained++, v => v.retention.settled++, v => v.retention.firstSequence++,
    v => v.retention.limit = 129, v => v.phase = 'finished', v => v.phase = 'waiting', v => v.items[1].sequence = 1,
    v => v.counts.published = 129];
  for (const mutate of mutations) { const next = clone(view); mutate(next); rejects(next); }
});

test('rejects mismatched sources, wrong statuses and malformed or temporally contradictory positions', () => {
  const f = fixture(); f.start(); f.publish(1, [1, 2]); f.deliver(1, 1); f.deliver(1, 2); const view = f.reader.eventPositions;
  const mutations = [v => v.items[0].origin.source.sourcePath = '../bad', v => v.items[0].deliveries[1].subscriptionId = 1,
    v => v.items[0].deliveries[0].status = 'successful', v => delete v.items[0].deliveries[0].delivered,
    v => v.items[0].published.executionFrameIndex = 0, v => v.items[0].published.clock.idleFrame = -1,
    v => v.items[0].deliveries[0].delivered.executionFrameIndex = v.items[0].published.executionFrameIndex,
    v => v.items[0].deliveries[0].delivered.clock.physicsFrame = 0,
    v => v.items[0].deliveries[1].delivered.executionFrameIndex = v.items[0].deliveries[0].delivered.executionFrameIndex];
  for (const mutate of mutations) { const next = clone(view); mutate(next); rejects(next); }
});


test('validates full 128-message history with 64 pending and 64 immediate settlements', () => {
  const f = fixture(32); f.start();
  for (let i = 1; i <= 64; i++) f.publish(i, [1]);
  for (let i = 65; i <= 128; i++) f.publish(i, []);
  const view = f.reader.eventPositions;
  assert.deepEqual({ published: view.counts.published, pending: view.counts.pending, retained: view.retention.retained, dropped: view.retention.dropped },
    { published: 128, pending: 64, retained: 96, dropped: 32 });
  assert.deepEqual(validateProjectEventPositions(view), view);
  for (let i = 1; i <= 64; i++) f.deliver(i);
  assert.deepEqual(validateProjectEventPositions(f.reader.eventPositions), f.reader.eventPositions);
});

test('rejects impossible retired-token outcomes and excess retained pending payload bytes', () => {
  const f = fixture(); f.start(); f.publish(1); f.publish(2); f.deliver(1, 1, 'skipped'); f.deliver(2, 1, 'skipped');
  const forged = clone(f.reader.eventPositions); forged.items[1].deliveries[0].status = 'handled';
  forged.counts.skipped--; forged.counts.handled++; rejects(forged);
  const g = fixture(); g.start(); for (let i = 1; i <= 4; i++) g.publish(i);
  const oversized = clone(g.reader.eventPositions); for (const item of oversized.items) item.value = 'a'.repeat(4096);
  rejects(oversized);
});
