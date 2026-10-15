import test from 'node:test';
import assert from 'node:assert/strict';
import { createProjectRuntimeObservation, queryProjectRuntimeObservation } from '../../engine/project-runtime-query.mjs';
import { querySceneRuntimeObservation } from '../../engine/scene-runtime-query.mjs';
import { runtimeProject, runtimeId, projectReady, enterScene, readyScene, exitScene, sceneFrame, finishProject, returnTrip } from './helpers/project-runtime-fixture.mjs';
const clone = value => structuredClone(value);
const apply = (observer, frames) => frames.forEach(frame => assert.equal(observer.push(frame), true, JSON.stringify(frame)));

test('initial project observation uses frozen entry rows without claiming a visit or live coordinates', () => {
  const plan = runtimeProject(), view = createProjectRuntimeObservation(plan).snapshot();
  assert.deepEqual(view.project, { assemblyId: plan.assembly.objectId, entrySceneId: plan.entrySceneId, activeSceneId: plan.entrySceneId, visits: [] });
  assert.equal(view.sceneObjectId, plan.entrySceneId); assert.equal(view.phase, 'waiting');
  assert.ok(view.actors.every(actor => actor.position === null && actor.state === null && actor.positionCurrent === false));
  assert.deepEqual(queryProjectRuntimeObservation(view), view);
  assert.throws(() => querySceneRuntimeObservation(view));
});

test('exit immediately revokes old actor samples, then each visit resets shared instance identities and sources', () => {
  const plan = runtimeProject(), [a, b] = plan.scenes, observer = createProjectRuntimeObservation(plan);
  apply(observer, [projectReady(plan), enterScene(a, 1), readyScene(a, 1)]);
  const first = observer.snapshot(); assert.equal(first.project.visits[0].phase, 'ready'); assert.deepEqual(first.actors[0].position, a.actors[0].position);
  apply(observer, [exitScene(a, 1, 0.25, b)]);
  const between = observer.snapshot(); assert.equal(between.phase, 'waiting'); assert.equal(between.sceneObjectId, b.scene.objectId);
  assert.equal(between.project.activeSceneId, b.scene.objectId); assert.equal(between.project.visits.length, 1);
  assert.deepEqual(between.project.visits[0], { index: 1, sceneId: a.scene.objectId, phase: 'left', elapsedSeconds: 0.25 });
  assert.ok(between.actors.every(actor => actor.position === null)); assert.deepEqual(queryProjectRuntimeObservation(between), between);
  assert.equal(between.actors[0].source.sourcePath, b.scene.sourcePath);
  apply(observer, [enterScene(b, 2), readyScene(b, 2)]);
  assert.deepEqual(observer.snapshot().actors[0].position, b.actors[0].position);
  apply(observer, [exitScene(b, 2, 0.25, a), enterScene(a, 3)]);
  const waitingAgain = observer.snapshot(); assert.equal(waitingAgain.project.visits[2].index, 3); assert.equal(waitingAgain.phase, 'waiting');
  assert.equal(waitingAgain.actors[0].instanceId, first.actors[0].instanceId); assert.equal(waitingAgain.actors[0].position, null);
  apply(observer, [readyScene(a, 3)]); assert.deepEqual(observer.snapshot().actors[0].position, a.actors[0].position);
});

test('project exit supplies final observed actor samples without admitting a legacy child finished wire frame', () => {
  for (const options of [{}, { legacy: true }, { behavior: true }]) {
    const plan = runtimeProject(options), a = plan.scenes[0], observer = createProjectRuntimeObservation(plan);
    apply(observer, [projectReady(plan), enterScene(a, 1), readyScene(a, 1)]);
    const exit = exitScene(a, 1, 0.5); exit.actors[0].position[0] += 40;
    apply(observer, [exit, finishProject(plan, 1, 0.5)]);
    const view = observer.snapshot(); assert.equal(view.phase, 'finished'); assert.equal(view.actors[0].position[0], a.actors[0].position[0] + 40);
    assert.equal(view.actors[0].positionCurrent, true); assert.equal(view.actors[0].positionSample, 'finished');
    assert.deepEqual(view.project.visits, [{ index: 1, sceneId: a.scene.objectId, phase: 'finished', elapsedSeconds: 0.5 }]);
    assert.deepEqual(queryProjectRuntimeObservation(view), view);
  }
});

test('queries filter current actors while preserving detached bounded visit records', () => {
  const plan = runtimeProject(), observer = createProjectRuntimeObservation(plan); apply(observer, returnTrip(plan));
  const before = observer.snapshot(), selected = queryProjectRuntimeObservation(before, { instanceId: plan.scenes[0].actors[1].instanceId });
  assert.equal(selected.actors.length, 1); assert.deepEqual(selected.project, before.project);
  selected.project.visits[0].sceneId = runtimeId(99); selected.actors[0].position[0] = 999;
  assert.deepEqual(observer.snapshot(), before); assert.deepEqual(queryProjectRuntimeObservation(before, { objectId: plan.assembly.objectId }).actors, []);
  assert.throws(() => queryProjectRuntimeObservation(before, { sceneId: plan.entrySceneId }));
});

test('observation rejects stale, forged and malformed visit events atomically', () => {
  const plan = runtimeProject(), [a, b] = plan.scenes, observer = createProjectRuntimeObservation(plan);
  apply(observer, returnTrip(plan).slice(0, 6)); const before = observer.snapshot();
  for (const frame of [readyScene(a, 1), enterScene(a, 3), { ...exitScene(b, 2, 0, a), actors: [] },
    sceneFrame(b, 2, { protocol: 2, event: 'state', instanceId: runtimeId(99), objectId: b.actors[0].objectId, state: 'moving' }),
    { ...readyScene(b, 2), project: { activeSceneId: a.scene.objectId } }]) {
    assert.equal(observer.push(frame), false); assert.deepEqual(observer.snapshot(), before);
  }
  let calls = 0; const getter = readyScene(b, 2); Object.defineProperty(getter, 'frame', { enumerable: true, get() { calls++; return {}; } });
  assert.equal(observer.push(getter), false); assert.equal(calls, 0);
  const serializer = Object.assign(Object.create({ toJSON() { calls++; return {}; } }), readyScene(b, 2));
  assert.equal(observer.push(serializer), false); assert.equal(calls, 0);
});

test('queries reject inconsistent history, invented project keys, unsafe data and stale current-scene identity', () => {
  const plan = runtimeProject(), observer = createProjectRuntimeObservation(plan); apply(observer, returnTrip(plan));
  const snapshot = observer.snapshot();
  for (const mutate of [
    view => { view.project.assemblyId = view.project.entrySceneId; }, view => { view.project.activeSceneId = runtimeId(99); },
    view => { view.project.visits[0].index = 0; }, view => { view.project.visits[0].sceneId = runtimeId(99); },
    view => { view.project.visits[0].phase = 'ready'; }, view => { view.project.visits[1].sceneId = view.project.visits[0].sceneId; },
    view => { view.project.visits[2].elapsedSeconds = -1; }, view => { view.project.visits[2].phase = 'left'; },
    view => { view.project.visits[2].engineNode = '/root/scene'; }, view => { view.project.visits = Array(65).fill(view.project.visits[0]); },
    view => { delete view.project.visits[1]; }, view => { view.project.currentNode = '/unsafe'; },
  ]) { const view = clone(snapshot); mutate(view); assert.throws(() => queryProjectRuntimeObservation(view)); }
  let getters = 0; const view = clone(snapshot); Object.defineProperty(view.project, 'visits', { enumerable: true, get() { getters++; return []; } });
  assert.throws(() => queryProjectRuntimeObservation(view)); assert.equal(getters, 0);
});

test('plan, event and output mutation cannot alter frozen member navigation or future visits', () => {
  const plan = runtimeProject(), original = clone(plan), observer = createProjectRuntimeObservation(plan);
  plan.scenes[1].actors[0].name = 'changed'; plan.scenes[1].actors[0].declaration.sourcePath = '/unsafe';
  const frames = returnTrip(original).slice(0, 6); apply(observer, frames); frames.at(-1).frame.actors[0].position[0] = 999;
  const expected = observer.snapshot(); assert.equal(expected.actors[0].name, original.scenes[1].actors[0].name);
  assert.equal(expected.actors[0].source.sourcePath, original.scenes[1].scene.sourcePath);
  const external = observer.snapshot(); external.project.visits.length = 0; external.actors[0].source.sourcePath = '/changed';
  assert.deepEqual(observer.snapshot(), expected);
});
