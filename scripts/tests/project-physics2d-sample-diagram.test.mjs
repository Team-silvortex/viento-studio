import test from 'node:test';
import assert from 'node:assert/strict';
import { createProjectPhysics2DSampleDiagram as diagram } from '../../engine/project-physics2d-sample-diagram.mjs';
import { validateProjectPhysics2DObservation } from '../../engine/project-physics2d-trace.mjs';
import { observationId as id, physicsObservationSample as sample, physicsObservationSnapshot as snapshot } from './helpers/project-physics2d-observation-fixture.mjs';

const rows = () => [sample(1), sample(2, { instance: 1 }), sample(3, { step: 2 }), sample(4, { visit: 2 })];
function frozen(value) {
  if (value && typeof value === 'object') { assert.ok(Object.isFrozen(value)); Object.values(value).forEach(frozen); }
}
function bounded(model) {
  assert.ok(model); assert.ok(Number.isSafeInteger(model.projection.scaleExponent));
  const points = [model.points.before, model.points.requested, model.points.actual, ...model.points.contacts.map(row => row.position)];
  for (const pair of points) for (const value of pair) assert.ok(Number.isFinite(value) && Math.abs(value) <= 1, String(value));
  for (const { normal } of model.points.contacts) assert.ok(Math.abs(Math.hypot(...normal) - 1) < 1e-15);
  frozen(model);
}
function withGeometry({ before = [0, 0], after = before, requested = [0, 0], positions = [], normals } = {}) {
  const row = sample(); row.positionBefore = [...before]; row.positionAfter = [...after]; row.requestedMotion = [...requested];
  row.displacement = after.map((value, axis) => value - before[axis]);
  row.contacts = positions.map((position, index) => ({ ...sample().contacts[0], position: [...position], normal: [...(normals?.[index] || [-1, 0])] }));
  return snapshot({ samples: [row] });
}

test('the exact selected admitted sample owns a deeply frozen independent model and raw precision', () => {
  const input = snapshot({ samples: rows() }), before = structuredClone(input);
  for (const row of input.samples) {
    const model = diagram(input, row.sequence); bounded(model);
    assert.equal(model.format, 'viento-physics2d-sample-diagram'); assert.equal(model.schemaVersion, 1);
    assert.equal(model.assemblyId, id(1)); assert.deepEqual(model.sample, row); assert.notEqual(model.sample, row);
    assert.deepEqual(model.bounds, { minX: -1.25, minY: -1.25, maxX: 1.25, maxY: 1.25 });
    assert.deepEqual(model.points, { before: [0, 0], requested: [.75, .5], actual: [.25, .5],
      contacts: [{ index: 0, position: [.625, 0], normal: [-1, 0] }] });
    assert.deepEqual(model.projection, { kind: 'relative-uniform', scaleExponent: 3, degraded: false });
  }
  assert.deepEqual(input, before);
  const model = diagram(input, 4); input.samples[3].positionAfter[0] = 999;
  assert.equal(model.sample.positionAfter[0], 12); assert.throws(() => { model.sample.positionAfter[0] = 13; }, TypeError);
});

test('requested and actual endpoints share the before origin and retain actual positionAfter separately', () => {
  const input = withGeometry({ before: [1024, -2048], after: [1026, -2044], requested: [6, 4] });
  const model = diagram(input, 1); bounded(model);
  assert.deepEqual(model.points.before, [0, 0]); assert.deepEqual(model.points.requested, [.75, .5]);
  assert.deepEqual(model.points.actual, [.25, .5]); assert.deepEqual(model.sample.positionAfter, [1026, -2044]);
  assert.equal(model.points.contacts.length, 0);
  assert.equal(Object.hasOwn(model, 'path'), false); assert.equal(Object.hasOwn(model.points, 'path'), false);
});

test('contact points remain independent and normals are unit directions while travel/remainder stay original numbers', () => {
  const input = withGeometry({ before: [10, 20], after: [12, 24], requested: [6, 4],
    positions: [[15, 20], [6, 24], [10, 18], [10, 20]], normals: [[.6, .8001], [0, 1], [1, 0], [-1, 0]] });
  input.samples[0].contacts[1].collider = null;
  const model = diagram(input, 1); bounded(model);
  assert.equal(model.points.contacts.length, 4);
  assert.deepEqual(model.points.contacts.map(row => row.position), [[.625, 0], [-.5, .5], [0, -.25], [0, 0]]);
  assert.deepEqual(model.points.contacts.map(row => row.index), [0, 1, 2, 3]);
  assert.notDeepEqual(model.points.contacts[0].normal, [.6, .8001]);
  assert.deepEqual(model.sample.contacts, input.samples[0].contacts);
  assert.equal(model.sample.contacts[1].collider, null);
  for (const row of model.points.contacts) assert.deepEqual(Object.keys(row), ['index', 'position', 'normal']);
});

test('ordinary world translation leaves all projected geometry and its uniform scale unchanged', () => {
  const first = withGeometry({ before: [10, 20], after: [12, 24], requested: [6, 4], positions: [[15, 20], [7, 22]] });
  const moved = structuredClone(first);
  for (const vector of [moved.samples[0].positionBefore, moved.samples[0].positionAfter, ...moved.samples[0].contacts.map(row => row.position)]) {
    vector[0] += 1048576; vector[1] -= 1048576;
  }
  const a = diagram(first, 1), b = diagram(moved, 1); bounded(a); bounded(b);
  assert.deepEqual(a.points, b.points); assert.deepEqual(a.projection, b.projection);
  assert.notDeepEqual(a.sample.positionBefore, b.sample.positionBefore);
});

test('zero and subnormal-only motion remain finite and visible without an arbitrary world-unit floor', () => {
  const zero = diagram(withGeometry(), 1); bounded(zero);
  assert.deepEqual(zero.points, { before: [0, 0], requested: [0, 0], actual: [0, 0], contacts: [] });
  assert.deepEqual(zero.projection, { kind: 'relative-uniform', scaleExponent: 0, degraded: false });
  for (const tiny of [Number.MIN_VALUE, 2 * Number.MIN_VALUE, 1e-320, 1e-308, 1e-200]) {
    const model = diagram(withGeometry({ after: [tiny, -tiny], requested: [tiny, -tiny] }), 1); bounded(model);
    assert.ok(model.points.actual[0] >= .5 && model.points.actual[0] <= 1);
    assert.equal(model.points.actual[1], -model.points.actual[0]);
    assert.deepEqual(model.points.actual, model.points.requested);
    assert.equal(model.sample.displacement[0], tiny); assert.equal(model.projection.degraded, false);
  }
});

test('huge absolute positions never drown a small request or fabricate its absolute endpoint', () => {
  for (const requested of [[1, -2], [Number.MIN_VALUE, 0], [1e-320, -1e-320]]) {
    const input = withGeometry({ before: [1e308, -1e308], requested }), model = diagram(input, 1); bounded(model);
    assert.ok(Math.max(...model.points.requested.map(Math.abs)) >= .5);
    assert.deepEqual(model.points.actual, [0, 0]); assert.deepEqual(model.sample.requestedMotion, requested);
    assert.deepEqual(model.sample.positionBefore, model.sample.positionAfter); assert.equal(model.projection.degraded, false);
  }
});

test('overflowing relative contacts use the same finite scale and announce genuinely lost tiny coordinates', () => {
  const input = withGeometry({ before: [Number.MAX_VALUE, -Number.MAX_VALUE], requested: [Number.MIN_VALUE, 1],
    positions: [[-Number.MAX_VALUE, Number.MAX_VALUE], [Number.MAX_VALUE, -Number.MAX_VALUE]] });
  const model = diagram(input, 1); bounded(model);
  assert.equal(model.projection.scaleExponent, 1025); assert.equal(model.projection.degraded, true);
  assert.ok(model.points.contacts[0].position[0] < -.99); assert.ok(model.points.contacts[0].position[1] > .99);
  assert.deepEqual(model.points.contacts[1].position, [0, 0]);
  assert.equal(model.points.requested[0], 0); assert.ok(model.points.requested[1] > 0);
  assert.deepEqual(model.sample, input.samples[0]);
});

test('finite extreme requested vectors and power-of-two rounding boundaries never clip or overflow', () => {
  for (const requested of [[Number.MAX_VALUE, -Number.MAX_VALUE], [1 + Number.EPSILON, 0], [2 ** 100 + 2 ** 48, 0], [Number.MIN_VALUE, Number.MIN_VALUE]]) {
    const model = diagram(withGeometry({ requested }), 1); bounded(model);
    const maximum = Math.max(...model.points.requested.map(Math.abs));
    assert.ok(maximum > .49 && maximum <= 1); assert.deepEqual(model.sample.requestedMotion, requested);
    assert.equal(model.projection.degraded, false);
  }
});

test('a deterministic extreme-range grid remains bounded and preserves every admitted raw sample', () => {
  const values = [0, Number.MIN_VALUE, -Number.MIN_VALUE, 1e-308, -1e-200, .125, -2, 1e200, -1e308, Number.MAX_VALUE];
  for (let i = 0; i < values.length; i++) for (let j = 0; j < values.length; j++) {
    const input = withGeometry({ before: [values[i], values[j]], requested: [values[(i + 3) % values.length], values[(j + 5) % values.length]],
      positions: [[values[(i + 7) % values.length], values[(j + 2) % values.length]]] });
    const admitted = validateProjectPhysics2DObservation(input), model = diagram(input, 1);
    bounded(model); assert.deepEqual(model.sample, admitted.samples[0]);
  }
});

test('missing or malformed sequences never fall back to the first, latest or neighboring sample', () => {
  for (const sequence of [undefined, null, false, true, '1', 0, -1, 1.5, NaN, Infinity, 257, {}, new Number(1)]) {
    assert.equal(diagram(snapshot(), sequence), null);
  }
  assert.equal(diagram(snapshot(), 2), null); assert.equal(diagram(snapshot({ samples: [] }), 1), null);
  const input = snapshot({ samples: rows() }); assert.equal(diagram(input, 3).sample.sequence, 3);
});

test('full observation admission rejects corrupt unselected rows and source identities instead of weakening the validator', () => {
  for (const mutate of [value => { value.samples[1].displacement[0] = 100; }, value => { value.samples[1].sequence = 1; },
    value => { value.samples[1].contacts[0].normal = [0, 0]; }, value => { value.samples[1].source.propertyPath = '/actors/0'; },
    value => { value.samples[1].contacts.push(...Array.from({ length: 4 }, () => sample().contacts[0])); },
    value => { value.samples[1].positionAfter[0] = Infinity; }, value => { value.samples[1].response = 'teleport'; },
    value => { value.samples[1].contacts[0].collider.instanceId = 'invalid'; }]) {
    const input = snapshot({ samples: rows() }); mutate(input);
    assert.throws(() => validateProjectPhysics2DObservation(input)); assert.equal(diagram(input, 1), null);
  }
  for (const phase of ['recording', 'incomplete', 'finished']) assert.ok(diagram(snapshot({ phase }), 1));
  assert.equal(diagram(snapshot({ phase: 'waiting' }), 1), null);
});

test('executable accessors, serializers, custom prototypes, sparse rows and cycles are never evaluated', () => {
  let invoked = 0;
  for (const mutate of [value => Object.defineProperty(value.samples[0], 'positionBefore', { enumerable: true, get() { invoked++; return [10, 20]; } }),
    value => { value.toJSON = () => { invoked++; return snapshot(); }; },
    value => Object.setPrototypeOf(value.samples[0], { injected: true }),
    value => { delete value.samples[0].contacts[0].normal[1]; }, value => { value.samples.push(value); },
    value => { value[Symbol('untrusted')] = 1; }, value => Object.defineProperty(value, 'hidden', { value: true })]) {
    const input = snapshot(); mutate(input); assert.equal(diagram(input, 1), null);
  }
  assert.equal(invoked, 0);
});
