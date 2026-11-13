import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { validateProjectPhysics2DReplayPlan as admit, validateProjectPhysics2DReplayObservation as complete,
  getProjectPhysics2DReplayTargets as targets, validateProjectPhysics2DReplayTargets as validateTargets } from '../../engine/project-physics2d-replay-contract.mjs';
import { runtimeProject, runtimeId as id } from './helpers/project-runtime-fixture.mjs';

const backend = { backendId: 'org.viento.godot4', capabilities: ['physics.observe2d'] };
function fixture(count = 2) {
  const plan = runtimeProject(), scene = plan.scenes[0], original = scene.actors[0];
  plan.scenes = [scene];
  scene.actors = Array.from({ length: count }, (_, index) => ({ ...structuredClone(original), instanceId: id(100 + index), controls: 'arrows', speed: 120 }));
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
  return { plan, scene, observation };
}
const unsupported = fn => assert.throws(fn, e => e.errorCode === 'runtime_physics2d_input_unsupported');
const incomplete = fn => assert.throws(fn, e => e.errorCode === 'runtime_physics2d_input_incomplete');

test('only single observable Godot physics projects with bounded character count are admitted', () => {
  const f = fixture(); assert.deepEqual(admit(f.plan, backend), f.plan);
  unsupported(() => admit(f.plan, { ...backend, backendId: 'org.viento.bevy' }));
  unsupported(() => admit(f.plan, { ...backend, capabilities: [] }));
  unsupported(() => admit(runtimeProject(), backend));
  for (const key of ['behaviors', 'animation', 'audio']) {
    const bad = fixture(); bad.scene[key] = {};
    // Assembly-level validators may reject malformed behavior data before replay admission.
    assert.throws(() => admit(bad.plan, backend));
  }
  unsupported(() => admit(fixture(9).plan, backend));
});

test('completed observations contain every character on each of thirty fixed steps', () => {
  const f = fixture(), view = complete(f.plan, f.observation);
  assert.deepEqual(view, f.observation); assert.notEqual(view, f.observation); assert.ok(Object.isFrozen(view.samples[0]));
});

test('partial, mismatched or non-fixed-step observations are not successful replays', () => {
  const changes = [v => { v.samples.pop(); }, v => { v.phase = 'incomplete'; }, v => { v.assemblyId = id(999); },
    v => { v.samples[0].bodyId = id(999); }, v => { v.samples[0].instanceId = id(999); },
    v => { v.samples[0].objectId = id(999); }, v => { v.samples[0].source.sourceRevision = 'sha256:' + 'a'.repeat(64); },
    v => { v.samples[0].visitIndex = 2; }, v => { v.samples[0].sceneId = id(999); },
    v => { v.samples[0].deltaSeconds = .1; }, v => { v.samples[0].timeSeconds = .1; },
    v => { v.samples[0].response = 'slide'; }, v => { v.samples[0].stepIndex = 2; },
    v => { v.samples[0].contacts = [{ collider: { bodyId: id(999), instanceId: id(998), objectId: id(997), source: v.samples[0].source },
      position: [0, 0], normal: [0, -1], travel: [0, 0], remainder: [0, 0] }]; }];
  for (const change of changes) { const f = fixture(); change(f.observation); incomplete(() => complete(f.plan, f.observation)); }
});

const released = () => ({ left: false, right: false, up: false, down: false, jump: false });
const replay = (version = 2) => ({ format: 'viento-physics2d-input-replay', schemaVersion: version, fixedDelta: 1 / 60,
  steps: Array.from({ length: 30 }, () => version === 1 ? released() : { inputs: [] }) });
const instancesBackend = { ...backend, capabilities: [...backend.capabilities, 'physics.input-replay-instances2d'] };

test('frozen replay target catalog uses physical controlled character identity and actor order', () => {
  const f = fixture(3); f.scene.actors[1].controls = 'none';
  f.scene.physics.document.bodies.reverse(); f.scene.physics.locations.bodies.reverse();
  f.scene.physics.locations.bodies.forEach((row, index) => { row.declaration.propertyPath = `/bodies/${index}`; });
  const before = structuredClone(f.plan), output = targets(f.plan);
  assert.deepEqual(output, [0, 2].map(index => ({ instanceId: id(100 + index), objectId: f.scene.actors[index].objectId, bodyId: id(200 + index) })));
  assert.ok(Object.isFrozen(output) && output.every(Object.isFrozen));
  assert.deepEqual(f.plan, before);
  assert.equal(output[0].objectId, output[1].objectId);
  f.scene.actors[0].controls = 'none';
  assert.equal(output[0].instanceId, id(100));
  assert.equal(targets(f.plan).length, 1);
});

test('v2 frozen targets reject unknown, noncontrolled, nonphysical and foreign scene instances', () => {
  const f = fixture(3); f.scene.actors[1].controls = 'none';
  f.scene.physics.document.bodies.pop(); f.scene.physics.locations.bodies.pop();
  const valid = replay(); valid.steps[0].inputs = [{ instanceId: id(100), ...released(), right: true }];
  const before = structuredClone(valid), output = validateTargets(f.plan, valid);
  assert.deepEqual(output, before); assert.notEqual(output, valid); assert.ok(Object.isFrozen(output.steps[0].inputs[0]));
  assert.deepEqual(admit(f.plan, { ...instancesBackend, program: valid }), f.plan);
  for (const instanceId of [id(101), id(102), id(999)]) {
    const bad = replay(); bad.steps[0].inputs = [{ instanceId, ...released() }];
    assert.throws(() => validateTargets(f.plan, bad), { errorCode: 'runtime_physics2d_input_target_invalid' });
    assert.throws(() => admit(f.plan, { ...instancesBackend, program: bad }), { errorCode: 'runtime_physics2d_input_target_invalid' });
  }
  assert.deepEqual(valid, before);
});

test('v1 target validation retains global semantics while v2 requires the declared backend capability', () => {
  const f = fixture(); f.scene.actors.forEach(actor => { actor.controls = 'none'; });
  assert.deepEqual(targets(f.plan), []);
  const global = replay(1); global.steps[0].right = true;
  assert.deepEqual(validateTargets(f.plan, global), global);
  assert.deepEqual(admit(f.plan, { ...backend, program: global }), f.plan);
  assert.deepEqual(validateTargets(f.plan, replay()), replay());
  unsupported(() => admit(f.plan, { ...backend, program: replay() }));
  assert.deepEqual(admit(f.plan, { ...instancesBackend, program: replay() }), f.plan);
  const malformed = replay(); malformed.steps[29].inputs = [{ instanceId: id(100), ...released(), jump: true }];
  assert.throws(() => validateTargets(f.plan, malformed), { errorCode: 'runtime_physics2d_input_invalid' });
});


test('static bodies and sensors never enter the controlled-character target catalog', () => {
  const f = fixture(4);
  for (const [index, kind] of [[1, 'static'], [2, 'sensor']]) {
    f.scene.physics.document.bodies[index].kind = kind;
    f.scene.actors[index].controls = 'none'; f.scene.actors[index].speed = 0;
  }
  f.scene.actors[3].controls = 'none';
  f.scene.requiredCapabilities.push('physics.sensors2d'); f.scene.requiredCapabilities.sort();
  f.plan.requiredCapabilities.push('physics.sensors2d'); f.plan.requiredCapabilities.sort();
  assert.deepEqual(targets(f.plan), [{ instanceId: id(100), objectId: f.scene.actors[0].objectId, bodyId: id(200) }]);
  for (const instanceId of [id(101), id(102), id(103)]) {
    const bad = replay(); bad.steps[0].inputs = [{ instanceId, ...released(), jump: true }];
    assert.throws(() => validateTargets(f.plan, bad), { errorCode: 'runtime_physics2d_input_target_invalid' });
  }
});
