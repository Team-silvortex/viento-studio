import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { validateProjectPhysics2DReplayCase as validate, evaluateProjectPhysics2DReplayCase as evaluate } from '../../engine/project-physics2d-replay-case.mjs';
import { runtimeProject, runtimeId as id } from './helpers/project-runtime-fixture.mjs';

function fixture() {
  const plan = runtimeProject(), scene = plan.scenes[0], original = scene.actors[0];
  plan.scenes = [scene];
  scene.actors = Array.from({ length: 2 }, (_, index) => ({ ...structuredClone(original), instanceId: id(100 + index), controls: 'arrows', speed: 120 }));
  const manifest = { objectId: id(50), sourcePath: 'documents/physics.json', sourceRevision: scene.scene.sourceRevision };
  const bodies = scene.actors.map((actor, index) => ({ id: id(200 + index), instanceId: actor.instanceId,
    kind: 'character', shape: { kind: 'box', size: [20, 20] }, offset: [0, 0], layer: 1, mask: 1 }));
  scene.physics = { format: 'viento-physics2d-plan', schemaVersion: 1, manifest,
    document: { format: 'viento-scene-physics2d', schemaVersion: 1, sceneObjectId: scene.scene.objectId, bodies },
    locations: { bodies: bodies.map((body, index) => ({ id: body.id, declaration: { ...manifest, propertyPath: `/bodies/${index}` } })) } };
  scene.requiredCapabilities = [...new Set([...scene.requiredCapabilities, 'physics.bodies2d', 'physics.character2d'])].sort();
  plan.requiredCapabilities = [...new Set(['project.scenes', ...scene.requiredCapabilities])].sort();
  const observation = { format: 'viento-physics2d-observation', schemaVersion: 1, assemblyId: plan.assembly.objectId,
    phase: 'finished', limit: 256, limited: false, samples: [] };
  for (let step = 1; step <= 30; step++) for (const [index, actor] of scene.actors.entries()) {
    observation.samples.push({ protocol: 1, event: 'sample', sequence: observation.samples.length + 1, visitIndex: 1,
      sceneId: scene.scene.objectId, stepIndex: step, timeSeconds: step / 60, deltaSeconds: 1 / 60,
      bodyId: bodies[index].id, instanceId: actor.instanceId, objectId: actor.objectId, positionBefore: [0, 0], positionAfter: [1, 0],
      requestedMotion: [1, 0], contacts: [], response: 'stop', source: structuredClone(scene.physics.locations.bodies[index].declaration), displacement: [1, 0] });
  }
  const action = { left: false, right: false, up: false, down: false, jump: false };
  const testCase = { format: 'viento-physics2d-replay-case', schemaVersion: 1,
    program: { format: 'viento-physics2d-input-replay', schemaVersion: 1, fixedDelta: 1 / 60, steps: Array.from({ length: 30 }, () => ({ ...action })) },
    checks: [{ instanceId: id(100), stepIndex: 1, positionAfter: { value: [1, 0], tolerance: [0, 0] }, contact: { exists: false } }] };
  return { plan, scene, observation, testCase };
}
const bad = fn => assert.throws(fn, e => e.errorCode === 'runtime_physics2d_case_invalid');

test('case admission returns independent deeply frozen data and validates plan identities', () => {
  const f = fixture(), result = validate(f.testCase, f.plan);
  assert.deepEqual(result, f.testCase); assert.notEqual(result, f.testCase);
  assert.ok(Object.isFrozen(result.checks[0].positionAfter.value));
  f.testCase.checks[0].positionAfter.value[0] = 42;
  assert.equal(result.checks[0].positionAfter.value[0], 1);
  validate(f.testCase); // snapshot before the host awaits the build plan
  f.testCase.checks[0].instanceId = id(999); bad(() => validate(f.testCase, f.plan));
  f.testCase.checks[0].instanceId = id(100); f.testCase.checks[0].contact.bodyId = id(200); bad(() => validate(f.testCase, f.plan));
  f.testCase.checks[0].contact.bodyId = id(999); bad(() => validate(f.testCase, f.plan));
});

test('rejects accessors, unknown keys, oversized or malformed checks and numeric bounds', () => {
  const changes = [c => { c.extra = 1; }, c => { Object.defineProperty(c, 'evil', { get() { throw new Error('executed'); }, enumerable: true }); },
    c => { Object.defineProperty(c.checks[0], 'instanceId', { get() { throw new Error('executed'); }, enumerable: true }); },
    c => { c.checks.push(structuredClone(c.checks[0])); }, c => { c.checks = []; },
    c => { c.checks = Array.from({ length: 129 }, () => c.checks[0]); }, c => { delete c.checks[0].contact; delete c.checks[0].positionAfter; },
    c => { c.checks[0].stepIndex = 31; }, c => { c.checks[0].positionAfter.tolerance[0] = -1; },
    c => { c.checks[0].positionAfter.value[0] = Infinity; }, c => { c.checks[0].positionAfter.value[0] = 1e10; },
    c => { c.checks[0].contact.exists = 1; }, c => { c.program.steps[29].jump = true; }, c => { delete c.checks[0]; },
    c => { c.checks[0].positionAfter.value.extra = true; }];
  for (const change of changes) { const { testCase } = fixture(); change(testCase); bad(() => validate(testCase)); }
});

test('evaluates each axis independently and reports failed checks distinctly', () => {
  const f = fixture();
  let result = evaluate(f.plan, f.testCase, f.observation, { complete: true });
  assert.equal(result.status, 'passed'); assert.deepEqual(result.checks[0].positionAfter.actual, [1, 0]);
  f.testCase.checks[0].positionAfter = { value: [1.1, 0.2], tolerance: [0.11, 0.1] };
  result = evaluate(f.plan, f.testCase, f.observation, { complete: true });
  assert.equal(result.status, 'failed'); assert.equal(result.checks[0].positionAfter.passed, false);
  assert.equal(result.checks[0].contact.passed, true);
});

test('contacts count movement sweeps, including unknown colliders, and may target one planned body', () => {
  const f = fixture(), sample = f.observation.samples[0], other = f.scene.actors[1];
  const contact = { collider: { bodyId: id(201), instanceId: other.instanceId, objectId: other.objectId,
    source: structuredClone(f.scene.physics.locations.bodies[1].declaration) }, position: [0, 0], normal: [0, -1], travel: [0, 0], remainder: [0, 0] };
  sample.contacts = [contact]; f.testCase.checks[0].contact = { exists: true, bodyId: id(201) };
  assert.equal(evaluate(f.plan, f.testCase, f.observation, { complete: true }).status, 'passed');
  f.testCase.checks[0].contact.exists = false;
  assert.equal(evaluate(f.plan, f.testCase, f.observation, { complete: true }).status, 'failed');
  sample.contacts[0].collider = null; f.testCase.checks[0].contact = { exists: true };
  assert.equal(evaluate(f.plan, f.testCase, f.observation, { complete: true }).status, 'passed');
  f.testCase.checks[0].contact = { exists: false, bodyId: id(201) };
  assert.equal(evaluate(f.plan, f.testCase, f.observation, { complete: true }).status, 'passed');
});

test('never evaluates incomplete or structurally forged observations and requires completed host status', () => {
  const f = fixture();
  assert.deepEqual(evaluate(f.plan, f.testCase, f.observation), { status: 'incomplete', checks: [] });
  assert.deepEqual(evaluate(f.plan, f.testCase, f.observation, { complete: false }), { status: 'incomplete', checks: [] });
  for (const change of [o => { o.samples.pop(); }, o => { o.phase = 'incomplete'; }, o => { o.assemblyId = id(999); },
    o => { o.samples[0].source.sourceRevision = 'sha256:' + 'a'.repeat(64); }, o => { o.samples[0].instanceId = id(999); },
    o => { o.samples[0].deltaSeconds = .1; }, o => { o.samples[0].positionAfter = [NaN, 0]; }]) {
    const o = structuredClone(f.observation); change(o);
    assert.deepEqual(evaluate(f.plan, f.testCase, o, { complete: true }), { status: 'incomplete', checks: [] });
  }
});
