import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createProjectExecutionClockReader, PROJECT_EXECUTION_CLOCK_PREFIX as prefix } from '../../engine/project-execution-clock.mjs';
import { PROJECT_EXECUTION_BUDGET_POLICY as limits } from '../../engine/project-execution-budget.mjs';
import { createProjectRuntimeEventReader } from '../../engine/project-runtime-events.mjs';
import { runtimeProject, projectReady, enterScene, readyScene, exitScene, finishProject, projectLine } from './helpers/project-runtime-fixture.mjs';

const vector = values => ({ eventRegistrations: 0, eventPublishes: 0, eventDeliveries: 0, eventBytes: 0, stateMutations: 0, audioRequests: 0, animationRequests: 0, ...values });
const sample = ({ index = 1, clock = { idleFrame: 0, physicsFrame: 0 }, used = vector(), total = used, reason = 'sample' } = {}) =>
  ({ protocol: 1, event: 'sample', index, clock, used: { ...used }, total: { ...total }, reason });
const line = value => prefix + JSON.stringify(value) + '\n';
function stub() {
  const chunks = [], events = [], diagnostics = [];
  let finishes = 0;
  return { chunks, get finishes() { return finishes; }, reader: {
    push(text) { chunks.push(text); return []; }, finish() { finishes++; return { events, diagnostics }; },
    get events() { return events; }, get diagnostics() { return diagnostics; },
    get retention() { return { limit: 128, total: 0, retained: 0 }; }, get lifecycle() { return { started: false, completed: false }; },
    get sharedState() { return { revision: 0 }; }, snapshot() { return { format: 'physics-fixture' }; },
  } };
}
function reader(options = {}) {
  const base = stub();
  return { ...base, value: createProjectExecutionClockReader({ runtimeReader: base.reader, ...options }) };
}

test('clock observer starts detached, owns no admission reset and preserves underlying observation ports', () => {
  const snapshots = [], { value } = reader({ onSnapshot: view => snapshots.push(view) });
  assert.equal(snapshots.length, 1);
  const view = value.executionClock;
  assert.equal(view.format, 'viento-execution-clock-observation');
  assert.equal(view.schemaVersion, 1); assert.equal(view.policyVersion, 1); assert.equal(view.phase, 'waiting');
  assert.deepEqual(view.total, vector()); assert.deepEqual(view.limits, limits); assert.equal(view.totalWindows, 0);
  assert.deepEqual(view.retention, { limit: 32, total: 0, retained: 0, dropped: 0, firstIndex: null, lastIndex: null });
  view.limits.eventPublishes = 999; view.total.eventPublishes = 99; view.windows.push({});
  assert.deepEqual(value.executionClock, snapshots[0]); assert.deepEqual(value.sharedState, { revision: 0 });
  assert.deepEqual(value.lifecycle, { started: false, completed: false });
  assert.deepEqual(value.retention, { limit: 128, total: 0, retained: 0 });
  assert.deepEqual(value.snapshot(), { format: 'physics-fixture' }); assert.ok(Object.isFrozen(value));
  assert.equal(value.reset, undefined); assert.equal(value.reserve, undefined);
});

test('same-window samples coalesce, real clock advancement starts a new window and cumulative totals remain exact', () => {
  const snapshots = [], { value } = reader({ onSnapshot: view => snapshots.push(view) });
  const first = sample({ used: vector({ eventPublishes: 1, eventBytes: 5 }) });
  value.push(line(first));
  value.push(line(sample({ used: vector({ eventPublishes: 2, eventBytes: 10 }) })));
  value.push(line(sample({ index: 2, clock: { idleFrame: 0, physicsFrame: 1 }, used: vector({ stateMutations: 1 }),
    total: vector({ eventPublishes: 2, eventBytes: 10, stateMutations: 1 }) })));
  const last = sample({ index: 3, clock: { idleFrame: 1, physicsFrame: 1 }, used: vector({ audioRequests: 2, animationRequests: 2 }),
    total: vector({ eventPublishes: 2, eventBytes: 10, stateMutations: 1, audioRequests: 2, animationRequests: 2 }), reason: 'finished' });
  value.push(line(last));
  assert.deepEqual(value.finish().diagnostics, []);
  assert.equal(value.executionClock.phase, 'finished'); assert.equal(value.executionClock.totalWindows, 3);
  assert.deepEqual(value.executionClock.total, last.total); assert.equal(value.executionClock.windows[0].used.eventPublishes, 2);
  assert.equal(snapshots.length, 6); assert.equal(snapshots[1].windows[0].used.eventPublishes, 1);
});

test('duplicates, changed clocks, skipped indexes, counter rollbacks and inconsistent totals reject without changing admitted state', () => {
  const first = sample({ clock: { idleFrame: 3, physicsFrame: 4 }, used: vector({ eventPublishes: 2, eventBytes: 10 }) });
  const mutate = [
    row => { row.protocol = 2; }, row => { row.event = 'ready'; }, row => { row.extra = true; },
    row => { row.index = 0; }, row => { row.index = 3; }, row => { row.index = 1.5; }, row => { row.index = Number.MAX_SAFE_INTEGER + 1; },
    row => { row.clock.extra = 1; }, row => { delete row.clock.idleFrame; }, row => { row.clock.idleFrame = 4; },
    row => { row.clock.physicsFrame = -1; }, row => { row.clock.physicsFrame = 4.5; },
    row => { row.used.eventPublishes = 1; row.total.eventPublishes = 1; },
    row => { row.used.eventPublishes = 3; }, row => { row.total.eventPublishes = 3; },
    row => { row.used.eventPublishes = 129; row.total.eventPublishes = 129; },
    row => { delete row.used.audioRequests; }, row => { row.total.extra = 1; }, row => { row.total = []; },
    row => { row.used.stateMutations = '0'; }, row => { row.reason = 'reset'; },
    row => { row.index = 2; },
    row => { row.index = 2; row.clock = { idleFrame: 2, physicsFrame: 5 }; },
    row => { row.index = 2; row.clock = { idleFrame: 4, physicsFrame: 3 }; },
    row => { row.index = 2; row.clock.idleFrame++; },
    () => {},
  ];
  for (const change of mutate) {
    const { value } = reader(); value.push(line(first)); const before = value.executionClock;
    const invalid = structuredClone(first); change(invalid); value.push(line(invalid));
    assert.deepEqual(value.executionClock, before, JSON.stringify(invalid));
    assert.equal(value.diagnostics.length, 1, JSON.stringify(invalid));
  }
});

test('first frame must start at one with used equal to total and complete bounded vectors', () => {
  for (const frame of [sample({ index: 2 }), sample({ used: vector({ eventPublishes: 1 }), total: vector() }),
    sample({ clock: { idleFrame: Infinity, physicsFrame: 0 } }), sample({ used: vector({ animationRequests: 257 }) }),
    sample({ used: vector({ stateMutations: -1 }) }), null, [], {}]) {
    const { value } = reader(), before = value.executionClock; value.push(line(frame));
    assert.deepEqual(value.executionClock, before); assert.equal(value.diagnostics.length, 1);
  }
  const { value } = reader(); value.push(line(sample({ used: limits, reason: 'finished' })));
  assert.deepEqual(value.executionClock.total, limits); assert.deepEqual(value.finish().diagnostics, []);
});

test('rejection and terminal samples may repeat unchanged totals, while all post-terminal frames reject', () => {
  for (const reason of ['finished', 'aborted']) {
    const { value } = reader(), frame = sample({ used: vector({ eventPublishes: 1 }) });
    value.push(line(frame)); value.push(line({ ...frame, reason: 'rejected' }));
    assert.equal(value.executionClock.windows[0].reason, 'rejected');
    value.push(line({ ...frame, reason }));
    const before = value.executionClock; value.push(line({ ...frame, reason }));
    assert.deepEqual(value.executionClock, before); assert.equal(value.diagnostics.length, 1);
    assert.equal(before.phase, reason === 'finished' ? 'finished' : 'incomplete');
  }
});

test('bounded windows retain their global indexes and exact accumulated totals after eviction', () => {
  const { value } = reader({ retainedWindows: 3 });
  for (let index = 1; index <= 40; index++) value.push(line(sample({ index, clock: { idleFrame: index, physicsFrame: index * 2 },
    used: vector({ eventPublishes: 1 }), total: vector({ eventPublishes: index }), reason: index === 40 ? 'finished' : 'sample' })));
  assert.deepEqual(value.executionClock.windows.map(row => row.index), [38, 39, 40]);
  assert.deepEqual(value.executionClock.retention, { limit: 3, total: 40, retained: 3, dropped: 37, firstIndex: 38, lastIndex: 40 });
  assert.deepEqual(value.executionClock.total, vector({ eventPublishes: 40 }));
  assert.deepEqual(value.finish().diagnostics, []);
});

test('partial prefix, CRLF, Unicode legacy logs and a final unterminated clock frame parse across single-character chunks', () => {
  const { value, chunks } = reader();
  const wire = '中文日志\r\n' + line(sample()).replace('\n', '\r\n') + 'VIENTO_PROJECT:{}\n'
    + line(sample({ used: vector({ stateMutations: 1 }), reason: 'finished' })).trimEnd();
  for (const character of wire) value.push(character);
  assert.deepEqual(value.finish().diagnostics, []); assert.equal(value.executionClock.phase, 'finished');
  assert.equal(chunks.join(''), '中文日志\r\nVIENTO_PROJECT:{}\n');
});

test('large clock lines are discarded with bounded buffering and subsequent valid/legacy lines survive', () => {
  const { value, chunks } = reader();
  value.push(prefix.slice(0, 3)); value.push(prefix.slice(3) + ' '.repeat(20000));
  for (let index = 0; index < 10; index++) value.push('x'.repeat(20000));
  value.push('\nlegacy\n' + line(sample({ reason: 'finished' })));
  assert.equal(value.diagnostics.length, 1); assert.equal(value.executionClock.totalWindows, 1);
  assert.equal(chunks.join(''), 'legacy\n');
  const edge = reader();
  const valid = line(sample()).trimEnd();
  edge.value.push(valid + ' '.repeat(16384 - Buffer.byteLength(valid)) + '\r\n');
  assert.equal(edge.value.diagnostics.length, 0); assert.equal(edge.value.executionClock.totalWindows, 1);
  edge.value.push(prefix + ' '.repeat(16384) + '\n'); assert.equal(edge.value.diagnostics.length, 1);
});

test('non-clock traffic retains original bytes and its own reader line limits', () => {
  const { value, chunks } = reader(), wire = 'legacy:' + 'x'.repeat(180000) + '\r\nVIENTO_EXE\nVIENTO_EXECUTION_';
  for (let index = 0; index < wire.length; index += 79) value.push(wire.slice(index, index + 79));
  value.finish(); assert.equal(chunks.join(''), wire); assert.deepEqual(value.diagnostics, []);
});

test('clock frame attempts have an independent finite ceiling and do not consume or block legacy events', () => {
  const { value, chunks } = reader({ retainedWindows: 2 });
  for (let index = 1; index <= 8192; index++) value.push(line(sample({ index, clock: { idleFrame: index, physicsFrame: 0 },
    used: vector({ eventBytes: 1 }), total: vector({ eventBytes: index }) })));
  const before = value.executionClock;
  for (let index = 0; index < 5; index++) value.push(line(sample()) + 'legacy\n');
  assert.deepEqual(value.executionClock, before); assert.equal(value.diagnostics.length, 1);
  assert.equal(value.diagnostics[0].code, 'runtime_execution_clock_limit'); assert.equal(chunks.join(''), 'legacy\n'.repeat(5));
  assert.equal(value.finish().diagnostics.length, 1); assert.equal(value.executionClock.phase, 'incomplete');
});

test('invalid observations count toward the finite parsing ceiling and diagnostics remain bounded', () => {
  const { value } = reader();
  value.push((prefix + '{}\n').repeat(8192));
  value.push(line(sample({ reason: 'finished' })));
  assert.equal(value.executionClock.totalWindows, 0); assert.equal(value.diagnostics.length, 128);
  assert.equal(value.finish().diagnostics.length, 128); assert.equal(value.executionClock.phase, 'incomplete');
});

test('malformed JSON and prototype keys cannot change counters or leak into legacy frames', () => {
  const { value, chunks } = reader();
  for (const raw of ['{', 'null', '"text"', '{"__proto__":{}}', JSON.stringify(sample()).replace('"used":{', '"used":{"constructor":0,')]) value.push(prefix + raw + '\n');
  assert.equal(value.executionClock.totalWindows, 0); assert.equal(value.diagnostics.length, 5); assert.deepEqual(chunks, []);
  let invoked = false; value.push({ toString() { invoked = true; return line(sample()); } }); assert.equal(invoked, false);
  value.push(line(sample({ reason: 'finished' }))); assert.equal(value.executionClock.totalWindows, 1);
});

test('finish without a terminal sample preserves valid windows as incomplete and is idempotent', () => {
  const { value, reader: underlying } = reader(), frame = sample({ used: vector({ eventPublishes: 1 }) });
  value.push(line(frame)); value.finish(); const before = value.executionClock;
  assert.equal(before.phase, 'incomplete'); assert.deepEqual(value.push(line({ ...frame, reason: 'finished' })), []);
  assert.deepEqual(value.executionClock, before); assert.deepEqual(value.finish().diagnostics, []);
  underlying.diagnostics.push({ severity: 'error', code: 'legacy_failure' });
  assert.equal(value.diagnostics[0].code, 'legacy_failure');
});

test('observer callbacks receive isolated views and thrown callback errors propagate after a valid admission', () => {
  let calls = 0;
  const { value } = reader({ onSnapshot: view => { calls++; view.total.eventPublishes = 100; view.windows.length = 0; if (calls === 2) throw new Error('observer failed'); } });
  assert.throws(() => value.push(line(sample({ used: vector({ eventPublishes: 1 }) }))), /observer failed/);
  assert.equal(value.executionClock.total.eventPublishes, 1); assert.equal(value.executionClock.totalWindows, 1);
  assert.deepEqual(value.diagnostics, []);
  value.push(line(sample({ used: vector({ eventPublishes: 1 }), reason: 'finished' })));
  assert.deepEqual(value.finish().diagnostics, []); assert.equal(value.executionClock.phase, 'finished');
});

test('real project reader remains byte-compatible and retains independent events, lifecycle and budget', () => {
  const plan = runtimeProject(), scene = plan.scenes[0], direct = createProjectRuntimeEventReader(plan, { retainedEvents: 2 });
  const nested = createProjectRuntimeEventReader(plan, { retainedEvents: 2 });
  const value = createProjectExecutionClockReader({ runtimeReader: nested });
  const frames = [projectReady(plan), enterScene(scene, 1), readyScene(scene, 1), exitScene(scene, 1, 0.5), finishProject(plan, 1, 0.5)];
  const oldWire = frames.map(projectLine).join(''), wire = line(sample()) + oldWire + line(sample({ reason: 'finished' }));
  for (let index = 0; index < wire.length; index += 7) value.push(wire.slice(index, index + 7));
  direct.push(oldWire); assert.deepEqual(value.finish(), direct.finish());
  assert.deepEqual(value.retention, direct.retention); assert.deepEqual(value.lifecycle, direct.lifecycle);
  assert.equal(value.retention.total, 5); assert.equal(value.executionClock.totalWindows, 1);
});

test('reader construction rejects invalid bounds and missing collaborators', () => {
  assert.throws(() => createProjectExecutionClockReader(), TypeError);
  for (const retainedWindows of [0, -1, 0.5, 8193, Infinity, '32', null]) assert.throws(() => reader({ retainedWindows }), TypeError);
  assert.throws(() => reader({ onSnapshot: true }), TypeError);
});
