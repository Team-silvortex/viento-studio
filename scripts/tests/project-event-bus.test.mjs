import test from 'node:test';
import assert from 'node:assert/strict';
import { createProjectEventBus, validateProjectEventSnapshot, PROJECT_EVENT_LIMITS } from '../../engine/project-event-bus.mjs';
import { copyProjectRuntimeData } from '../../engine/project-runtime-contracts.mjs';
import { eventProject, eventOrigin } from './helpers/project-event-bus-fixture.mjs';
const origin = eventOrigin(eventProject().scenes[0]);
const publish = (sequence, value = true, recipients = [1], name = 'notice', sender = origin) => ({ sequence, name, value, origin: structuredClone(sender), recipients: recipients.map(subscriptionId => ({ subscriptionId, origin: structuredClone(sender) })) });
const ack = (sequence, subscriptionId, status = 'handled', sender = origin) => ({ sequence, subscriptionId, status, visitIndex: sender.visitIndex, sceneId: sender.sceneId });
const refuse = (bus, operation, data) => { const before = bus.snapshot(), count = bus.pendingCount; assert.throws(() => bus[operation](data), { errorCode: 'runtime_project_invalid' }); assert.deepEqual(bus.snapshot(), before); assert.equal(bus.pendingCount, count); };

test('messages retain publication order, frozen sender and receiver origins, and explicit handled/skipped outcomes', () => {
  const bus = createProjectEventBus(); assert.deepEqual(bus.snapshot(), { sequence: 0, entries: [] });
  bus.publish(publish(1, '风と雨', [1, 2])); bus.publish(publish(2, false, [1]));
  refuse(bus, 'deliver', ack(2, 1)); refuse(bus, 'deliver', ack(1, 2));
  bus.deliver(ack(1, 1)); assert.equal(bus.pendingCount, 2); bus.deliver(ack(1, 2, 'skipped')); assert.equal(bus.pendingCount, 1);
  bus.deliver(ack(2, 1)); assert.equal(bus.pendingCount, 0);
  assert.deepEqual(bus.snapshot().entries[0].deliveries.map(row => row.status), ['handled', 'skipped']);
  assert.deepEqual(validateProjectEventSnapshot(bus.snapshot()), bus.snapshot());
});

test('zero-recipient publication is immediately complete but still consumes a sequence and total byte budget', () => {
  const bus = createProjectEventBus(); bus.publish(publish(1, 0, [])); assert.equal(bus.sequence, 1); assert.equal(bus.pendingCount, 0);
  refuse(bus, 'deliver', ack(1, 1)); bus.publish(publish(2, true, [1])); bus.publish(publish(3, false, []));
  assert.equal(bus.pendingCount, 1); bus.deliver(ack(2, 1)); assert.equal(bus.pendingCount, 0);
});

test('subscription IDs have stable name and visit/binding ownership but unseen IDs may be observed out of numeric order', () => {
  const bus = createProjectEventBus(); bus.publish(publish(1, true, [2])); bus.deliver(ack(1, 2));
  bus.publish(publish(2, true, [1], 'other')); bus.deliver(ack(2, 1));
  refuse(bus, 'publish', publish(3, true, [2], 'other'));
  const next = { ...origin, visitIndex: 3 }; refuse(bus, 'publish', publish(3, true, [2], 'notice', next));
  bus.publish(publish(3, true, [3], 'notice', next)); bus.deliver(ack(3, 3, 'handled', next));
  refuse(bus, 'publish', publish(4, true, [4]));
});

test('invalid recipients, scalar values and source injection reject the whole publication without claiming token ownership', () => {
  const bus = createProjectEventBus();
  for (const input of [publish(1, null), publish(1, {}), publish(1, '\ud800'), publish(1, true, [0]), publish(1, true, [1025]),
    publish(1, true, [1, 1]), publish(1, true, [2, 1]), publish(1, true, [], 'constructor'), publish(2),
    { ...publish(1), sourcePath: 'injected.json' }, { ...publish(1), recipients: [{ subscriptionId: 1, origin, callback: 'run' }] }]) refuse(bus, 'publish', input);
  const invalid = publish(1); invalid.recipients[0].origin.sceneId = eventProject().scenes[1].scene.objectId; refuse(bus, 'publish', invalid);
  bus.publish(publish(1, true, [1], 'different')); assert.equal(bus.sequence, 1);
});

test('64 pending messages and 16384 pending bytes remain reserved until every recipient of the head is acknowledged', () => {
  const bus = createProjectEventBus(); for (let i = 1; i <= 64; i++) bus.publish(publish(i));
  refuse(bus, 'publish', publish(65)); bus.publish(publish(65, true, [])); bus.deliver(ack(1, 1)); bus.publish(publish(66));
  const bytes = createProjectEventBus(); for (let i = 1; i <= 4; i++) bytes.publish(publish(i, 'x'.repeat(4095), [1, 2], 'A'));
  refuse(bytes, 'publish', publish(5, true)); bytes.deliver(ack(1, 1)); refuse(bytes, 'publish', publish(5, true));
  bytes.deliver(ack(1, 2)); bytes.publish(publish(5, 'x'.repeat(4095), [1, 2], 'A')); assert.equal(bytes.pendingCount, 4);
});

test('all recipients are reserved atomically against the 1024 delivery budget before publishing', () => {
  const bus = createProjectEventBus(), ids = Array.from({ length: 64 }, (_, i) => i + 1);
  for (let sequence = 1; sequence <= 16; sequence++) { bus.publish(publish(sequence, true, ids)); for (const id of ids) bus.deliver(ack(sequence, id)); }
  refuse(bus, 'publish', publish(17)); assert.equal(bus.sequence, 16); bus.publish(publish(17, true, []));
  assert.equal(bus.snapshot().entries.reduce((count, row) => count + row.deliveries.length, 0), 1024);
});

test('128 publications and the independent 524288 total payload bytes bound retained trace history', () => {
  const bus = createProjectEventBus(); for (let sequence = 1; sequence <= 128; sequence++) bus.publish(publish(sequence, true, [])); refuse(bus, 'publish', publish(129, true, []));
  const bytes = createProjectEventBus(); for (let sequence = 1; sequence <= 127; sequence++) bytes.publish(publish(sequence, 'x'.repeat(4096), [], 'a'));
  refuse(bytes, 'publish', publish(128, 'x'.repeat(4096), [], 'a')); bytes.publish(publish(128, 'x'.repeat(3968), [], 'a'));
  assert.equal(bytes.sequence, 128); assert.deepEqual(validateProjectEventSnapshot(bytes.snapshot()), bytes.snapshot());
  assert.equal(PROJECT_EVENT_LIMITS.totalBytes, 524288);
});

test('delivery identity, repeated acknowledgement and unknown outcome cannot mutate the queue', () => {
  const bus = createProjectEventBus(); bus.publish(publish(1));
  for (const input of [ack(1, 2), { ...ack(1, 1), visitIndex: 3 }, { ...ack(1, 1), sceneId: eventProject().scenes[1].scene.objectId },
    ack(1, 1, 'pending'), { ...ack(1, 1), source: origin.source }, { ...ack(1, 1), name: 'notice' }]) refuse(bus, 'deliver', input);
  bus.deliver(ack(1, 1)); refuse(bus, 'deliver', ack(1, 1));
});

test('a new visit cannot receive or publish through an unfinished old visit queue', () => {
  const bus = createProjectEventBus(); bus.publish(publish(1));
  const next = { ...origin, visitIndex: 3 }; refuse(bus, 'publish', publish(2, true, [2], 'notice', next));
  bus.deliver(ack(1, 1)); bus.publish(publish(2, true, [2], 'notice', next)); assert.equal(bus.snapshot().entries[0].origin.visitIndex, 1);
});

test('snapshot validation checks complete sequence history, FIFO outcome prefix and token source ownership', () => {
  const bus = createProjectEventBus(); bus.publish(publish(1, true, [1, 2])); bus.deliver(ack(1, 1)); bus.publish(publish(2));
  for (const mutate of [v => v.entries.shift(), v => v.sequence = 3, v => v.entries[1].sequence = 1,
    v => v.entries[1].deliveries[0].status = 'handled', v => v.entries[0].deliveries.reverse(), v => v.entries[1].name = 'changed',
    v => v.entries[0].origin.source.sourcePath = '../outside', v => v.entries[1].deliveries[0].origin.source.sourcePath = 'changed.json',
    v => v.entries[0].deliveries[0].status = 'error', v => v.entries[1].value = []]) {
    const snapshot = bus.snapshot(); mutate(snapshot); assert.throws(() => validateProjectEventSnapshot(snapshot), { errorCode: 'runtime_project_invalid' });
  }
});

test('input, snapshots and callback-shaped properties cannot alias state or invoke getters', () => {
  const bus = createProjectEventBus(), input = publish(1); bus.publish(input); input.origin.source.sourcePath = 'changed.json';
  const snapshot = bus.snapshot(); snapshot.entries[0].deliveries[0].origin.source.sourcePath = 'changed-again.json'; assert.deepEqual(bus.snapshot().entries[0].origin, origin);
  let calls = 0; const hostile = publish(2); Object.defineProperty(hostile, 'value', { enumerable: true, get() { calls++; return true; } });
  refuse(bus, 'publish', hostile); assert.equal(calls, 0);
  const view = bus.snapshot(); Object.defineProperty(view.entries[0], 'origin', { enumerable: true, get() { calls++; return origin; } });
  assert.throws(() => validateProjectEventSnapshot(view)); assert.equal(calls, 0);
});

test('maximum trace carries every legal 4096-character source field without widening old frame copies', () => {
  const bus = createProjectEventBus(), long = structuredClone(origin);
  long.source.sourcePath = 'd/' + 'x'.repeat(4094); long.source.propertyPath = '/' + 'p'.repeat(4095);
  long.source.sourceRange = { start: 0, end: 1, encoding: 'utf-16', exact: true, propertyPath: '/' + 'r'.repeat(4095) };
  const ids = Array.from({ length: 64 }, (_, i) => i + 1);
  for (let sequence = 1; sequence <= 128; sequence++) {
    const recipients = sequence <= 16 ? ids : [];
    bus.publish(publish(sequence, 'x'.repeat(4095), recipients, 'A', long));
    for (const id of recipients) bus.deliver(ack(sequence, id, 'handled', long));
  }
  const snapshot = bus.snapshot(); assert.equal(snapshot.entries.length, 128);
  assert.throws(() => copyProjectRuntimeData(snapshot), { errorCode: 'runtime_project_invalid' });
  assert.deepEqual(validateProjectEventSnapshot(snapshot), snapshot);
  assert.deepEqual(createProjectEventBus().snapshot(), { sequence: 0, entries: [] });
});

test('skipped tokens cannot be captured again while already queued recipients can still be skipped', () => {
  const bus = createProjectEventBus(); bus.publish(publish(1)); bus.publish(publish(2)); bus.deliver(ack(1, 1, 'skipped'));
  refuse(bus, 'publish', publish(3)); refuse(bus, 'deliver', ack(2, 1, 'handled'));
  bus.deliver(ack(2, 1, 'skipped')); bus.publish(publish(3, true, [2])); bus.deliver(ack(3, 2));
  assert.deepEqual(bus.snapshot().entries.map(entry => entry.deliveries[0].status), ['skipped', 'skipped', 'handled']);
  assert.deepEqual(validateProjectEventSnapshot(bus.snapshot()), bus.snapshot());
  const forged = bus.snapshot(); forged.entries[1].deliveries[0].status = 'handled';
  assert.throws(() => validateProjectEventSnapshot(forged), { errorCode: 'runtime_project_invalid' });
});


test('queue and token ownership rejection do not spend later event, byte or delivery allowance', () => {
  const bus = createProjectEventBus();
  for (let sequence = 1; sequence <= 64; sequence++) bus.publish(publish(sequence, true, [1]));
  // All candidate recipients would reserve 64 deliveries. None may be charged
  // or assigned ownership when the live queue has no space.
  const candidateIds = Array.from({ length: 64 }, (_, index) => index + 2);
  for (let attempt = 0; attempt < 17; attempt++) refuse(bus, 'publish', publish(65, true, candidateIds, 'rejected'));
  for (let sequence = 1; sequence <= 64; sequence++) bus.deliver(ack(sequence, 1));
  const admittedIds = Array.from({ length: 64 }, (_, index) => index + 1);
  for (let sequence = 65; sequence <= 79; sequence++) {
    bus.publish(publish(sequence, true, admittedIds));
    for (const subscriptionId of admittedIds) bus.deliver(ack(sequence, subscriptionId));
  }
  assert.equal(bus.snapshot().entries.reduce((sum, entry) => sum + entry.deliveries.length, 0), 1024);
  refuse(bus, 'publish', publish(80, true, [1]));
  for (let sequence = 80; sequence <= 128; sequence++) bus.publish(publish(sequence, true, []));
  assert.equal(bus.sequence, 128);
  assert.equal(bus.pendingCount, 0);
  assert.deepEqual(validateProjectEventSnapshot(bus.snapshot()), bus.snapshot());
});

test('failed ownership checks do not charge the exact remaining event payload budget', () => {
  const bus = createProjectEventBus();
  bus.publish(publish(1, 'x'.repeat(4095), [1], 'A')); bus.deliver(ack(1, 1));
  for (let attempt = 0; attempt < 128; attempt++) refuse(bus, 'publish', publish(2, 'x'.repeat(4096), [1], 'B'));
  for (let sequence = 2; sequence <= 127; sequence++) bus.publish(publish(sequence, 'x'.repeat(4096), [], 'A'));
  // 4096 + 126 * 4097 + 3970 exactly reaches the finite payload allowance.
  bus.publish(publish(128, 'x'.repeat(3969), [], 'A'));
  assert.equal(bus.snapshot().entries.reduce((sum, entry) => sum + entry.name.length + entry.value.length, 0), 524288);
  assert.equal(bus.sequence, 128);
  assert.deepEqual(validateProjectEventSnapshot(bus.snapshot()), bus.snapshot());
});
