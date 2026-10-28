import test from 'node:test';
import assert from 'node:assert/strict';
import { createProjectRuntimeObservation, queryProjectRuntimeObservation } from '../../engine/project-runtime-query.mjs';
import { actorStates, enterScene, exitScene, finishProject, projectReady, readyScene, runtimeId, runtimeProject } from './helpers/project-runtime-fixture.mjs';

const program = () => ({ format: 'viento-runtime-control', schemaVersion: 1, fixedDelta: 0.125, steps: [
  { left: false, right: true, up: false, down: false },
  { left: false, right: false, up: false, down: false },
] });
const sample = (scene, stepIndex) => ({ format: 'viento-runtime-trace', schemaVersion: 1,
  protocolVersion: scene.schemaVersion, event: 'sample', stepIndex, actors: actorStates(scene) });
const apply = (observer, frames) => frames.forEach(frame => assert.equal(observer.push(frame), true));

test('project observation admits ordered entry samples and the resulting terminal snapshot', () => {
  const plan = runtimeProject(), scene = plan.scenes[0], input = program();
  const observer = createProjectRuntimeObservation(plan, { controlProgram: input });
  input.steps.length = 0; input.fixedDelta = 0.25;
  assert.equal(observer.pushSample(sample(scene, 0)), false);
  apply(observer, [projectReady(plan), enterScene(scene, 1)]);
  assert.equal(observer.pushSample(sample(scene, 0)), false);
  apply(observer, [readyScene(scene, 1)]);
  const earlyExit = exitScene(scene, 1, 0.25);
  assert.equal(observer.push(earlyExit), false);
  const first = sample(scene, 0); first.actors[0].position[0] += 20;
  assert.equal(observer.pushSample(first), true);
  const snapshot = observer.snapshot();
  assert.equal(snapshot.control.completedSteps, 1); assert.equal(snapshot.control.fixedDelta, 0.125);
  assert.equal(snapshot.actors[0].positionStep, 0); assert.equal(snapshot.actors[0].positionSample, 'control');
  assert.deepEqual(queryProjectRuntimeObservation(snapshot), snapshot);
  assert.equal(observer.push(earlyExit), false);
  assert.equal(observer.pushSample(first), false);
  const final = sample(scene, 1); final.actors[0].position[0] += 30;
  assert.equal(observer.pushSample(final), true);
  earlyExit.actors = final.actors;
  apply(observer, [earlyExit, finishProject(plan, 1, 0.25)]);
  const finished = observer.snapshot();
  assert.equal(finished.phase, 'finished'); assert.equal(finished.control.completedSteps, 2);
  assert.equal(finished.actors[0].positionSample, 'finished');
  assert.deepEqual(finished.actors[0].position, final.actors[0].position);
  assert.equal(observer.pushSample(final), false);
  assert.deepEqual(queryProjectRuntimeObservation(finished), finished);
});

test('samples cannot cross a switch or a later visit even when scenes reuse instance identities', () => {
  const plan = runtimeProject(), [entry, other] = plan.scenes;
  const observer = createProjectRuntimeObservation(plan, { controlProgram: program() });
  apply(observer, [projectReady(plan), enterScene(entry, 1), readyScene(entry, 1)]);
  assert.equal(observer.pushSample(sample(entry, 0)), true);
  apply(observer, [exitScene(entry, 1, 0.125, other), enterScene(other, 2), readyScene(other, 2)]);
  const before = observer.snapshot();
  assert.equal(observer.pushSample(sample(entry, 1)), false);
  assert.equal(observer.pushSample(sample(other, 1)), false);
  assert.deepEqual(observer.snapshot(), before);
  apply(observer, [exitScene(other, 2, 0.125, entry), enterScene(entry, 3), readyScene(entry, 3)]);
  assert.equal(observer.pushSample(sample(entry, 1)), false);
  assert.equal(observer.snapshot().control, undefined);
  assert.deepEqual(queryProjectRuntimeObservation(observer.snapshot()), observer.snapshot());
});

test('invalid sample, mismatched identity, hostile accessors and absent program fail without mutating observation', () => {
  const plan = runtimeProject(), scene = plan.scenes[0], observer = createProjectRuntimeObservation(plan, { controlProgram: program() });
  apply(observer, [projectReady(plan), enterScene(scene, 1), readyScene(scene, 1)]);
  const before = observer.snapshot();
  const wrong = sample(scene, 0); wrong.actors[0].instanceId = runtimeId(99);
  const duplicate = sample(scene, 0); duplicate.actors[1] = structuredClone(duplicate.actors[0]);
  for (const value of [sample(scene, 1), wrong, duplicate, { ...sample(scene, 0), protocolVersion: 1 }]) {
    assert.equal(observer.pushSample(value), false); assert.deepEqual(observer.snapshot(), before);
  }
  let invoked = 0;
  const evil = sample(scene, 0); Object.defineProperty(evil, 'actors', { enumerable: true, get() { invoked++; return []; } });
  assert.equal(observer.pushSample(evil), false); assert.equal(invoked, 0);
  assert.deepEqual(observer.snapshot(), before);
  const plain = createProjectRuntimeObservation(plan);
  apply(plain, [projectReady(plan), enterScene(scene, 1), readyScene(scene, 1)]);
  assert.equal(plain.pushSample(sample(scene, 0)), false);
});

test('control program is validated against the frozen entry, including legacy and instance target constraints', () => {
  const plan = runtimeProject({ legacy: true });
  const perInstance = { format: 'viento-runtime-control', schemaVersion: 2, fixedDelta: 0.125, steps: [{ inputs: [] }] };
  assert.throws(() => createProjectRuntimeObservation(plan, { controlProgram: perInstance }), { errorCode: 'runtime_control_unsupported' });
  const modern = runtimeProject();
  perInstance.steps.unshift({ inputs: [{ instanceId: runtimeId(99), left: false, right: true, up: false, down: false }] });
  assert.throws(() => createProjectRuntimeObservation(modern, { controlProgram: perInstance }), { errorCode: 'runtime_control_target_missing' });
  const valid = createProjectRuntimeObservation(plan, { controlProgram: program() });
  const scene = plan.scenes[0]; apply(valid, [projectReady(plan), enterScene(scene, 1), readyScene(scene, 1)]);
  assert.equal(valid.pushSample(sample(scene, 0)), true);
});
