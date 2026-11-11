import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveProjectPhysics2DObservationSelection as resolve } from '../../engine/project-physics2d-observation-selection.mjs';
import { observationId as id, physicsObservationSample as sample, physicsObservationSnapshot as snapshot } from './helpers/project-physics2d-observation-fixture.mjs';

const owner = () => ({ sessionOwner: 'physics-job:build:snapshot:assembly', navigationOwner: 'dialog:1', backendId: 'org.viento.godot4',
  jobId: 'physics-job', buildId: 'physics-build', snapshotId: 'sha256:' + 'c'.repeat(64), assemblyId: id(1) });
const request = (row = sample(1), run = owner()) => ({ ...run, visitIndex: row.visitIndex, sceneId: row.sceneId,
  instanceId: row.instanceId, stepIndex: row.stepIndex, sequence: row.sequence });
const samples = () => [sample(1), sample(2, { instance: 1 }), sample(3, { step: 2 }), sample(4, { visit: 2 })];

test('selection resolves the actual admitted sample by full run, visit, scene, instance, step and sequence identities', () => {
  const value = snapshot({ samples: samples() }), before = structuredClone(value);
  for (const row of value.samples) {
    const selected = resolve(value, request(row), owner());
    assert.deepEqual(selected, { instanceId: row.instanceId, stepKey: `${row.visitIndex}:${row.sceneId}:${row.stepIndex}`, sequence: row.sequence });
    assert.ok(Object.isFrozen(selected));
  }
  assert.deepEqual(value, before);
  const selected = resolve(value, request(value.samples[2]), owner());
  value.samples[2].instanceId = id(99);
  assert.equal(selected.instanceId, id(20));
});

test('each run or sample identity mismatch rejects rather than selecting the first or a similar repeated step', () => {
  const value = snapshot({ samples: samples() }), selected = request(value.samples[3]);
  for (const [key, replacement] of Object.entries({ sessionOwner: 'other-session', navigationOwner: 'dialog:2', backendId: 'org.viento.bevy', jobId: 'other-job',
    buildId: 'other-build', snapshotId: 'sha256:' + 'd'.repeat(64), assemblyId: id(9), visitIndex: 1, sceneId: id(2), instanceId: id(21), stepIndex: 2, sequence: 1 })) {
    assert.equal(resolve(value, { ...selected, [key]: replacement }, owner()), null, key);
  }
  assert.equal(resolve(snapshot({ assemblyId: id(9) }), request(), owner()), null);
  assert.equal(resolve(snapshot({ samples: [] }), request(), owner()), null);
});

test('only bounded integer identities, canonical UUIDs and complete scalar run records can select a sample', () => {
  for (const key of ['sequence', 'visitIndex', 'stepIndex']) for (const value of [0, -1, 1.2, '1', true, null, NaN, Infinity, 100000]) {
    assert.equal(resolve(snapshot(), { ...request(), [key]: value }, owner()), null, `${key}:${value}`);
  }
  for (const key of ['sceneId', 'instanceId']) for (const value of ['', 'bad', id(2).toUpperCase() + '\n', null, 2]) {
    assert.equal(resolve(snapshot(), { ...request(), [key]: value }, owner()), null, key);
  }
  for (const key of Object.keys(owner())) for (const value of ['', null, {}, 7]) {
    const run = { ...owner(), [key]: value };
    assert.equal(resolve(snapshot(), request(sample(1), run), run), null, key);
  }
});

test('getters, serializers, hidden or symbolic fields and custom prototypes never acquire selection authority', () => {
  let invoked = 0;
  const mutations = [
    value => Object.defineProperty(value, 'sequence', { enumerable: true, get() { invoked++; return 1; } }),
    value => { value.toJSON = () => { invoked++; return request(); }; },
    value => Object.defineProperty(value, 'extra', { value: 1 }),
    value => { value[Symbol('extra')] = 1; },
    value => Object.setPrototypeOf(value, { injected: true }),
    value => { delete value.stepIndex; },
    value => { value.sourcePath = 'redirect.json'; },
  ];
  for (const mutate of mutations) {
    const value = request(); mutate(value); assert.equal(resolve(snapshot(), value, owner()), null);
  }
  for (const key of Object.keys(owner())) {
    const run = owner(); Object.defineProperty(run, key, { enumerable: true, get() { invoked++; return owner()[key]; } });
    assert.equal(resolve(snapshot(), request(), run), null, key);
  }
  assert.equal(resolve(snapshot(), Object.create(request()), owner()), null);
  assert.equal(invoked, 0);
  const plain = Object.assign(Object.create(null), request()), run = Object.assign(Object.create(null), owner());
  assert.equal(resolve(snapshot(), plain, run).sequence, 1);
});

test('selection reuses complete observation admission and never copies a caller supplied source or simulated position', () => {
  let invoked = 0;
  for (const mutate of [value => { value.samples[0].displacement[0] = 100; }, value => { value.samples[0].sequence = 2; },
    value => { value.samples[0].source.propertyPath = '/actors/0'; }, value => { delete value.samples[0]; },
    value => Object.defineProperty(value.samples[0], 'instanceId', { enumerable: true, get() { invoked++; return id(20); } }),
    value => { value.toJSON = () => { invoked++; return snapshot(); }; }]) {
    const value = snapshot(); mutate(value); assert.equal(resolve(value, request(), owner()), null);
  }
  assert.equal(invoked, 0);
  assert.equal(resolve(snapshot({ phase: 'incomplete' }), request(), owner()).sequence, 1);
  assert.equal(resolve(snapshot({ phase: 'recording' }), request(), owner()).sequence, 1);
});
