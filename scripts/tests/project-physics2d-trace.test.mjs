import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createProjectPhysics2DTraceReader, validateProjectPhysics2DObservation } from '../../engine/project-physics2d-trace.mjs';
import { createProjectRuntimeEventReader } from '../../engine/project-runtime-events.mjs';
import { runtimeProject, runtimeId as id, projectReady, enterScene, readyScene, exitScene, finishProject, projectLine } from './helpers/project-runtime-fixture.mjs';

function fixture({ characters = 1, response = 'stop', reversed = false } = {}) {
  const plan = runtimeProject(), scene = plan.scenes[0], original = scene.actors[0];
  scene.actors = Array.from({ length: characters + 1 }, (_, index) => ({ ...structuredClone(original), instanceId: id(100 + index),
    controls: index < characters ? 'arrows' : 'none', speed: index < characters ? 120 : 0 }));
  const manifest = { objectId: id(50), sourcePath: 'documents/physics.json', sourceRevision: scene.scene.sourceRevision };
  const bodies = scene.actors.map((actor, index) => ({ id: id(200 + index), instanceId: actor.instanceId,
    kind: index < characters ? 'character' : 'static', shape: { kind: 'box', size: [20, 20] }, offset: [0, 0], layer: 1, mask: 1,
    ...(index < characters && response === 'slide' ? { collisionResponse: 'slide' } : {}) }));
  if (reversed) bodies.reverse();
  scene.physics = { format: 'viento-physics2d-plan', schemaVersion: 1, manifest,
    document: { format: 'viento-scene-physics2d', schemaVersion: response === 'slide' ? 2 : 1, sceneObjectId: scene.scene.objectId, bodies },
    locations: { bodies: bodies.map((body, index) => ({ id: body.id, declaration: { ...manifest, propertyPath: `/bodies/${index}` } })) } };
  const capabilities = ['physics.bodies2d', ...(characters ? ['physics.character2d'] : []), ...(response === 'slide' ? ['physics.character-slide2d'] : [])];
  scene.requiredCapabilities = [...new Set([...scene.requiredCapabilities, ...capabilities])].sort();
  plan.requiredCapabilities = [...new Set([...plan.requiredCapabilities, ...capabilities])].sort();
  return { plan, scene, bodies };
}
const physicsLine = frame => 'VIENTO_PHYSICS2D:' + JSON.stringify(frame) + '\n';
const ready = plan => ({ protocol: 1, event: 'ready', assemblyId: plan.assembly.objectId, limit: 256 });
const finish = (sampleCount, limited = false) => ({ protocol: 1, event: 'finished', sampleCount, limited });
function sample(scene, { sequence = 1, visitIndex = 1, stepIndex = 1, actor = 0, delta = .1, contacts = [] } = {}) {
  return { protocol: 1, event: 'sample', sequence, visitIndex, sceneId: scene.scene.objectId, stepIndex, timeSeconds: stepIndex * delta,
    deltaSeconds: delta, bodyId: id(200 + actor), instanceId: scene.actors[actor].instanceId,
    positionBefore: [0, 10], positionAfter: [5, 10], requestedMotion: [10, 0], contacts };
}
const contact = (collider = null) => ({ collider, position: [5, 10], normal: [-1, 0], travel: [5, 0], remainder: [5, 0] });
function reader(plan, onSnapshot) {
  const runtimeReader = createProjectRuntimeEventReader(plan);
  return createProjectPhysics2DTraceReader(plan, { runtimeReader, onSnapshot });
}
function start(value, f, visit = 1) {
  if (visit === 1) value.push(projectLine(projectReady(f.plan)) + physicsLine(ready(f.plan)));
  value.push(projectLine(enterScene(f.scene, visit)) + projectLine(readyScene(f.scene, visit)));
}
function complete(value, f, count, elapsed = .1, { visit = 1, limited = false } = {}) {
  value.push(projectLine(exitScene(f.scene, visit, elapsed)) + physicsLine(finish(count, limited)) + projectLine(finishProject(f.plan, visit, elapsed)));
  return value.finish();
}

test('native sweep samples enrich frozen identities and provenance without changing project runtime frames', () => {
  const f = fixture({ response: 'slide' }), snapshots = [], value = reader(f.plan, view => { snapshots.push(structuredClone(view)); view.samples.length = 0; });
  start(value, f);
  const known = { bodyId: id(201), instanceId: f.scene.actors[1].instanceId };
  value.push(physicsLine(sample(f.scene, { contacts: [contact(known), contact()] })));
  const result = complete(value, f, 1), view = value.snapshot();
  assert.deepEqual(result.diagnostics, []); assert.equal(view.phase, 'finished'); assert.equal(view.samples.length, 1);
  const row = view.samples[0]; assert.deepEqual(row.displacement, [5, 0]); assert.equal(row.response, 'slide');
  assert.equal(row.objectId, f.scene.actors[0].objectId); assert.deepEqual(row.source, f.scene.physics.locations.bodies[0].declaration);
  assert.equal(row.contacts[0].collider.objectId, f.scene.actors[1].objectId); assert.deepEqual(row.contacts[0].collider.source, f.scene.physics.locations.bodies[1].declaration);
  assert.equal(row.contacts[1].collider, null); assert.deepEqual(validateProjectPhysics2DObservation(view), view);
  assert.deepEqual(result.events.map(row => row.event), ['ready', 'scene-enter', 'scene-event', 'scene-exit', 'finished']);
  assert.ok(snapshots.some(row => row.phase === 'recording' && row.samples.length === 1));
  view.samples[0].source.sourcePath = 'changed.json'; assert.notEqual(value.snapshot().samples[0].source.sourcePath, 'changed.json');
});

test('wire chunking preserves project lifecycle order and final unterminated lines', () => {
  const f = fixture(), value = reader(f.plan);
  const wire = projectLine(projectReady(f.plan)) + physicsLine(ready(f.plan)) + projectLine(enterScene(f.scene, 1)) + projectLine(readyScene(f.scene, 1))
    + physicsLine(sample(f.scene)) + projectLine(exitScene(f.scene, 1, .1)) + physicsLine(finish(1)) + projectLine(finishProject(f.plan, 1, .1)).trimEnd();
  for (let index = 0; index < wire.length; index += 7) value.push(wire.slice(index, index + 7));
  assert.deepEqual(value.finish().diagnostics, []); assert.equal(value.snapshot().phase, 'finished');
});

test('character samples follow actor order rather than declaration order, and each step has complete membership', () => {
  const f = fixture({ characters: 2, reversed: true }), value = reader(f.plan); start(value, f);
  for (let step = 1; step <= 2; step++) for (let actor = 0; actor < 2; actor++) value.push(physicsLine(sample(f.scene, { stepIndex: step, actor, sequence: (step - 1) * 2 + actor + 1 })));
  assert.deepEqual(complete(value, f, 4, .2).diagnostics, []);
  assert.equal(value.snapshot().samples[0].source.propertyPath, '/bodies/2');
  for (const bad of [sample(f.scene, { actor: 1 }), sample(f.scene, { stepIndex: 2 }), sample(f.scene, { sequence: 2 })]) {
    const rejected = reader(f.plan); start(rejected, f); rejected.push(physicsLine(bad));
    assert.equal(rejected.snapshot().samples.length, 0); assert.equal(rejected.diagnostics.length, 1);
  }
  const missing = reader(f.plan); start(missing, f); missing.push(physicsLine(sample(f.scene)));
  assert.ok(complete(missing, f, 1).diagnostics.length); assert.equal(missing.snapshot().phase, 'incomplete');
});

test('step deltas, bounds and pairings reject invalid frames atomically', () => {
  for (const mutate of [row => row.stepIndex = 0, row => row.stepIndex = 31, row => row.deltaSeconds = 0,
    row => row.timeSeconds = .2, row => row.bodyId = id(999), row => row.instanceId = id(999), row => row.sceneId = id(999),
    row => row.visitIndex = 2, row => row.nodePath = '/root/Actor', row => row.contacts = [contact(), contact()],
    row => row.contacts = [contact({ bodyId: id(201), instanceId: id(999) })], row => row.contacts = [{ ...contact(), normal: [0, 0] }],
    row => row.contacts = [{ ...contact(), collider: { bodyId: id(201), instanceId: id(101), sourcePath: 'forged.json' } }]]) {
    const f = fixture(), value = reader(f.plan); start(value, f); const row = sample(f.scene); mutate(row); value.push(physicsLine(row));
    assert.equal(value.snapshot().samples.length, 0); assert.equal(value.diagnostics.length, 1);
  }
  const f = fixture(), value = reader(f.plan); start(value, f); value.push(physicsLine(sample(f.scene)));
  value.push(physicsLine(sample(f.scene, { sequence: 2, stepIndex: 2, delta: .2 })));
  assert.equal(value.snapshot().samples.length, 1); assert.equal(value.diagnostics.length, 1);
});

test('scene exit and re-entry bind samples to each visit and reset step clocks', () => {
  const f = fixture(), other = f.plan.scenes[1], value = reader(f.plan); start(value, f);
  value.push(physicsLine(sample(f.scene)) + projectLine(exitScene(f.scene, 1, .1, other)) + projectLine(enterScene(other, 2))
    + projectLine(readyScene(other, 2)) + projectLine(exitScene(other, 2, 0, f.scene)));
  start(value, f, 3); value.push(physicsLine(sample(f.scene, { sequence: 2, visitIndex: 3 })));
  value.push(projectLine(exitScene(f.scene, 3, .1)) + physicsLine(finish(2)) + projectLine(finishProject(f.plan, 3, .2)));
  assert.deepEqual(value.finish().diagnostics, []); assert.deepEqual(value.snapshot().samples.map(row => row.visitIndex), [1, 3]);
});

test('cancelled and malformed traces retain admitted samples as incomplete, while missing successful trace fails', () => {
  const f = fixture(), cancelled = reader(f.plan); start(cancelled, f); cancelled.push(physicsLine(sample(f.scene))); cancelled.finish();
  assert.equal(cancelled.snapshot().phase, 'incomplete'); assert.equal(cancelled.snapshot().samples.length, 1); assert.deepEqual(cancelled.diagnostics, []);
  const absent = reader(f.plan); absent.push(projectLine(projectReady(f.plan)) + projectLine(enterScene(f.scene, 1)) + projectLine(readyScene(f.scene, 1))
    + projectLine(exitScene(f.scene, 1, .1)) + projectLine(finishProject(f.plan, 1, .1))); absent.finish();
  assert.equal(absent.snapshot().phase, 'incomplete'); assert.ok(absent.diagnostics.length);
  const mismatch = reader(f.plan); start(mismatch, f); mismatch.push(physicsLine(sample(f.scene)));
  complete(mismatch, f, 2); assert.equal(mismatch.snapshot().samples.length, 1); assert.equal(mismatch.snapshot().phase, 'incomplete');
});

test('the explicit global cap retains a partial step and allows gameplay to finish', () => {
  const f = fixture({ characters: 10 }), value = reader(f.plan); start(value, f);
  for (let sequence = 1; sequence <= 256; sequence++) value.push(physicsLine(sample(f.scene, {
    sequence, actor: (sequence - 1) % 10, stepIndex: Math.floor((sequence - 1) / 10) + 1, delta: 1 / 60 })));
  value.push(physicsLine({ protocol: 1, event: 'limited', sampleCount: 256 }));
  assert.deepEqual(complete(value, f, 256, .5, { limited: true }).diagnostics, []);
  assert.equal(value.snapshot().limited, true); assert.equal(value.snapshot().phase, 'finished');
  assert.equal(validateProjectPhysics2DObservation(value.snapshot()).samples.length, 256);
});

test('static-only scenes have an empty complete trace; sensor colliders cannot forge solid contact provenance', () => {
  const f = fixture({ characters: 0 }), value = reader(f.plan); start(value, f); assert.deepEqual(complete(value, f, 0, .5).diagnostics, []);
  assert.deepEqual(value.snapshot().samples, []);
  const sensors = fixture(); sensors.bodies[1].kind = 'sensor';
  sensors.scene.requiredCapabilities.push('physics.sensors2d'); sensors.scene.requiredCapabilities.sort();
  sensors.plan.requiredCapabilities.push('physics.sensors2d'); sensors.plan.requiredCapabilities.sort();
  const rejected = reader(sensors.plan); start(rejected, sensors);
  rejected.push(physicsLine(sample(sensors.scene, { contacts: [contact({ bodyId: id(201), instanceId: id(101) })] })));
  assert.equal(rejected.snapshot().samples.length, 0); assert.equal(rejected.diagnostics.length, 1);
});

test('source and public snapshots reject hidden execution, unknown keys, sparse rows and forged derived data', () => {
  const f = fixture(), value = reader(f.plan); start(value, f); value.push(physicsLine(sample(f.scene))); complete(value, f, 1);
  const valid = value.snapshot(); let calls = 0;
  for (const mutate of [view => view.samples[0].source.sourcePath = '/tmp/forged.json', view => view.samples[0].source.propertyPath = '/actors/0',
    view => view.samples[0].displacement[0] = 999, view => view.samples[0].positionAfter[0] = Infinity, view => delete view.samples[0],
    view => view.samples[0].contacts = Array(1), view => view.limited = true, view => view.phase = 'waiting', view => view.extra = true,
    view => Object.defineProperty(view, 'samples', { enumerable: true, get() { calls++; return []; } }),
    view => Object.setPrototypeOf(view, { toJSON() { calls++; return {}; } })]) {
    const candidate = structuredClone(valid); mutate(candidate); assert.throws(() => validateProjectPhysics2DObservation(candidate));
  }
  assert.equal(calls, 0);
});

test('trace line and diagnostics budgets are bounded without suppressing later runtime completion', () => {
  const f = fixture({ characters: 0 }), value = reader(f.plan); start(value, f);
  value.push('VIENTO_PHYSICS2D:' + 'x'.repeat(17000) + '\n');
  for (let index = 0; index < 200; index++) value.push('VIENTO_PHYSICS2D:{}\n');
  complete(value, f, 0, .5); assert.equal(value.diagnostics.length, 128); assert.equal(value.events.at(-1).event, 'finished');
  assert.equal(value.snapshot().phase, 'incomplete'); assert.equal(value.push(physicsLine(ready(f.plan))).length, 0);
});

test('wrong lifecycle, duplicate terminal markers, self contacts and overflow never become accepted evidence', () => {
  const f = fixture();
  for (const mutate of [row => row.contacts = [contact({ bodyId: row.bodyId, instanceId: row.instanceId })],
    row => { row.positionBefore = [-Number.MAX_VALUE, 0]; row.positionAfter = [Number.MAX_VALUE, 0]; }]) {
    const value = reader(f.plan); start(value, f); const row = sample(f.scene); mutate(row); value.push(physicsLine(row));
    assert.equal(value.snapshot().samples.length, 0); assert.equal(value.diagnostics.length, 1);
  }
  const premature = reader(f.plan); premature.push(physicsLine(ready(f.plan)) + physicsLine(sample(f.scene)));
  assert.equal(premature.snapshot().phase, 'waiting'); assert.equal(premature.diagnostics.length, 2);
  start(premature, f); premature.push(physicsLine(sample(f.scene)) + projectLine(exitScene(f.scene, 1, .1)));
  premature.push(physicsLine(sample(f.scene, { sequence: 2, stepIndex: 2 })) + physicsLine(finish(1)) + physicsLine(finish(1)));
  premature.push(projectLine(finishProject(f.plan, 1, .1))); premature.finish();
  assert.equal(premature.snapshot().samples.length, 1); assert.equal(premature.snapshot().phase, 'incomplete');
  const omitted = reader(f.plan); start(omitted, f); omitted.push(physicsLine(sample(f.scene)));
  complete(omitted, f, 1, .2); assert.equal(omitted.snapshot().phase, 'incomplete'); assert.ok(omitted.diagnostics.length);
});

test('mutating the original plan cannot forge later observation identity or sources', () => {
  const f = fixture(), original = structuredClone(f), value = reader(f.plan);
  f.scene.physics.locations.bodies[0].declaration.sourcePath = 'forged.json'; f.scene.actors[0].objectId = id(999);
  start(value, original); value.push(physicsLine(sample(original.scene))); complete(value, original, 1);
  assert.deepEqual(value.diagnostics, []); const row = value.snapshot().samples[0];
  assert.equal(row.source.sourcePath, 'documents/physics.json'); assert.equal(row.objectId, original.scene.actors[0].objectId);
});
