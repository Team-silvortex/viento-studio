import test from 'node:test';
import assert from 'node:assert/strict';
import { planCompositionCreateLayout } from '../../engine/scene-composition-create-layout.mjs';
import { SCENE_COMPOSITION_CREATE_MAX_ACTORS } from '../../engine/scene-composition-create.mjs';

const id = n => `${String(n).padStart(8, '0')}-1111-4111-8111-111111111111`;
const actors = (count = 5) => Array.from({ length: count }, (_, index) => ({ instanceId: id(index + 1), position: [0, 0] }));
const settings = (mode = 'grid') => ({ mode, origin: [10, 20], spacing: [30, 40], columns: 2 });
const invalid = error => error?.errorCode === 'composition_layout_invalid';

test('row, column and grid use actor order and preserve every instance identity', () => {
  const expected = {
    row: [[10, 20], [40, 20], [70, 20], [100, 20], [130, 20]],
    column: [[10, 20], [10, 60], [10, 100], [10, 140], [10, 180]],
    grid: [[10, 20], [40, 20], [10, 60], [40, 60], [10, 100]],
  };
  for (const mode of Object.keys(expected)) {
    const input = actors(); [input[0], input[3]] = [input[3], input[0]];
    const result = planCompositionCreateLayout(input, settings(mode));
    assert.deepEqual(result.positions.map(actor => actor.instanceId), input.map(actor => actor.instanceId));
    assert.deepEqual(result.positions.map(actor => actor.position), expected[mode]); assert.equal(result.changedCount, 5);
    assert.deepEqual(planCompositionCreateLayout(input, settings(mode)), result);
  }
});
test('single actors and maximum creation budget work in every mode', () => {
  assert.equal(SCENE_COMPOSITION_CREATE_MAX_ACTORS, 64);
  for (const mode of ['row', 'column', 'grid']) for (const count of [1, 64]) {
    const result = planCompositionCreateLayout(actors(count), settings(mode));
    assert.equal(result.positions.length, count); assert.equal(result.changedCount, count);
    assert.deepEqual(result.positions[0].position, [10, 20]);
  }
  for (const count of [0, 65]) assert.throws(() => planCompositionCreateLayout(actors(count), settings()), invalid);
});
test('fractional positive spacing, negative origins and inclusive coordinate boundaries stay exact', () => {
  const result = planCompositionCreateLayout(actors(4), { mode: 'grid', origin: [-1.5, -2.25], spacing: [0.25, 0.5], columns: 2 });
  assert.deepEqual(result.positions.map(actor => actor.position), [[-1.5, -2.25], [-1.25, -2.25], [-1.5, -1.75], [-1.25, -1.75]]);
  const edges = planCompositionCreateLayout([{ instanceId: id(1), position: [-100000, 100000] }, { instanceId: id(2), position: [100000, -100000] }, { instanceId: id(3), position: [0, 0] }],
    { mode: 'row', origin: [-100000, 100000], spacing: [100000, 100000], columns: 64 });
  assert.deepEqual(edges.positions.map(actor => actor.position), [[-100000, 100000], [0, 100000], [100000, 100000]]); assert.equal(edges.changedCount, 2);
});
test('grid column extremes are deterministic and leave incomplete final rows untouched', () => {
  const input = actors(5);
  assert.deepEqual(planCompositionCreateLayout(input, { ...settings(), columns: 1 }).positions, planCompositionCreateLayout(input, settings('column')).positions);
  assert.deepEqual(planCompositionCreateLayout(input, { ...settings(), columns: 64 }).positions, planCompositionCreateLayout(input, settings('row')).positions);
  assert.deepEqual(planCompositionCreateLayout(input, { ...settings(), columns: 3 }).positions.map(actor => actor.position), [[10, 20], [40, 20], [70, 20], [10, 60], [40, 60]]);
});
test('changedCount counts actors rather than axes and a second application is unchanged', () => {
  const input = actors(3); input[0].position = [10, 20]; input[1].position = [40, 0];
  const result = planCompositionCreateLayout(input, settings('row'));
  assert.equal(result.changedCount, 2);
  assert.equal(planCompositionCreateLayout(result.positions, settings('row')).changedCount, 0);
  assert.equal(planCompositionCreateLayout([{ instanceId: id(1), position: [-0, 0] }], { ...settings(), origin: [0, -0] }).changedCount, 0);
});
test('any candidate outside bounds rejects the entire plan without clipping or modifying input', () => {
  for (const mode of ['row', 'column', 'grid']) {
    const input = actors(3), config = { mode, origin: [99999, 99999], spacing: [1, 1], columns: 1 }, before = structuredClone({ input, config });
    assert.throws(() => planCompositionCreateLayout(input, config), invalid);
    assert.deepEqual({ input, config }, before);
  }
  assert.throws(() => planCompositionCreateLayout(actors(2), { ...settings('row'), origin: [100000, 0], spacing: [0.0000001, 1] }), invalid);
});
test('positions, IDs and actor shapes reject duplicates, nonfinite values, missing or additional fields', () => {
  const duplicate = actors(2); duplicate[1].instanceId = duplicate[0].instanceId;
  assert.throws(() => planCompositionCreateLayout(duplicate, settings()), invalid);
  for (const change of [{ instanceId: '' }, { instanceId: 'actor' }, { position: [100001, 0] }, { position: [0, -100001] }, { position: [NaN, 0] },
    { position: [0, Infinity] }, { position: ['0', 0] }, { position: [0] }, { position: [0, 0, 0] }, { position: null }, { objectId: id(5) }]) {
    const input = actors(2); Object.assign(input[1], change); assert.throws(() => planCompositionCreateLayout(input, settings()), invalid);
  }
  for (const key of ['instanceId', 'position']) { const input = actors(1); delete input[0][key]; assert.throws(() => planCompositionCreateLayout(input, settings()), invalid); }
  for (const input of [null, {}, 'actors', true]) assert.throws(() => planCompositionCreateLayout(input, settings()), invalid);
});
test('settings require exact mode, bounds, positive spacings and integer columns even on unused axes', () => {
  for (const change of [{ mode: 'circle' }, { mode: 'ROW' }, { mode: null }, { origin: [-100001, 0] }, { origin: [0, 100001] }, { origin: [Infinity, 0] },
    { origin: ['0', 0] }, { origin: [0] }, { spacing: [0, 1] }, { spacing: [1, -1] }, { spacing: [1, 100001] }, { spacing: [NaN, 1] },
    { spacing: [1] }, { columns: 0 }, { columns: 65 }, { columns: 1.5 }, { columns: '2' }, { columns: Infinity }, { extra: 1 }]) {
    assert.throws(() => planCompositionCreateLayout(actors(), { ...settings('row'), ...change }), invalid);
  }
  for (const key of ['mode', 'origin', 'spacing', 'columns']) { const value = settings(); delete value[key]; assert.throws(() => planCompositionCreateLayout(actors(), value), invalid); }
  for (const value of [null, [], 1, 'grid']) assert.throws(() => planCompositionCreateLayout(actors(), value), invalid);
});
test('plans are deeply immutable detached snapshots and never mutate input', () => {
  const input = actors(), config = settings(), before = structuredClone({ input, config }), result = planCompositionCreateLayout(input, config);
  assert.deepEqual({ input, config }, before);
  const snapshot = structuredClone(result); input[0].position[0] = 400; input[0].instanceId = id(8); config.origin[0] = 500;
  assert.deepEqual(result, snapshot);
  for (const value of [result, result.positions, ...result.positions, ...result.positions.map(actor => actor.position)]) assert.ok(Object.isFrozen(value));
  assert.throws(() => { result.positions[0].position[0] = 1; }, TypeError);
  assert.throws(() => { result.positions.push({}); }, TypeError);
});
test('getters, inherited serializers, cycles, holes and pollution keys are rejected without invocation', () => {
  let calls = 0;
  const getter = actors(); Object.defineProperty(getter[2], 'position', { enumerable: true, get() { calls++; return [0, 0]; } });
  const settingsGetter = settings(); Object.defineProperty(settingsGetter, 'origin', { enumerable: true, get() { calls++; return [0, 0]; } });
  const inherited = actors(); inherited[0] = Object.assign(Object.create({ toJSON() { calls++; return {}; } }), inherited[0]);
  const hole = actors(); delete hole[1]; const positionHole = actors(); delete positionHole[0].position[0];
  const cycle = actors(); cycle[0].position = cycle;
  const polluted = actors(); Object.defineProperty(polluted[0], '__proto__', { enumerable: true, value: {} });
  const symbol = actors(); symbol[0][Symbol('hidden')] = 1;
  const hidden = actors(); Object.defineProperty(hidden[0], 'extra', { value: 1 });
  for (const input of [getter, inherited, hole, positionHole, cycle, polluted, symbol, hidden]) assert.throws(() => planCompositionCreateLayout(input, settings()), invalid);
  assert.throws(() => planCompositionCreateLayout(actors(), settingsGetter), invalid); assert.equal(calls, 0);
  const huge = []; huge.length = 100000000; assert.throws(() => planCompositionCreateLayout(huge, settings()), invalid);
  const revoked = Proxy.revocable(actors(), {}); revoked.revoke();
  assert.throws(() => planCompositionCreateLayout(revoked.proxy, settings()), invalid);
});
