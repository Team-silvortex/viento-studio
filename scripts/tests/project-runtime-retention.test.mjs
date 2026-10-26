import test from 'node:test';
import assert from 'node:assert/strict';
import '../adapters/node-studio-core.mjs';
import { createProjectRuntimeEventReader } from '../../engine/project-runtime-events.mjs';
import { PROJECT_RUNTIME_MAX_EVENTS } from '../../engine/project-runtime-contracts.mjs';
import { runtimeProject, projectReady, enterScene, readyScene, sceneFrame, exitScene, finishProject, projectLine, returnTrip } from './helpers/project-runtime-fixture.mjs';
import { sharedStateProject, stateReturnTrip } from './helpers/project-shared-state-fixture.mjs';
import { eventProject, eventReturnTrip } from './helpers/project-event-bus-fixture.mjs';
import { audioProject, audioReturnTrip } from './helpers/project-audio-command-fixture.mjs';
import { animationProject, animationReturnTrip } from './helpers/project-animation-command-fixture.mjs';
import { completionProject, completionRun } from './helpers/project-animation-completion-fixture.mjs';

const push = (reader, frames) => reader.push(frames.map(projectLine).join(''));
const retained = (limit, total) => ({ limit, total, retained: Math.min(limit, total), dropped: Math.max(0, total - limit),
  firstSequence: total ? Math.max(1, total - limit + 1) : null, lastSequence: total || null });

test('retention validates its bound before accessing the input plan and exposes immutable empty metadata', () => {
  let reads = 0;
  const hostile = { get scenes() { reads++; throw new Error('input getter must not run'); } };
  for (const retainedEvents of [0, -1, 4097, 1.5, NaN, Infinity, '2', null, true, {}, []]) {
    assert.throws(() => createProjectRuntimeEventReader(hostile, { retainedEvents }),
      { name: 'TypeError', errorCode: 'runtime_project_invalid', message: 'Retained project runtime events must be between 1 and 4096.' });
  }
  assert.equal(reads, 0);
  const reader = createProjectRuntimeEventReader(runtimeProject());
  assert.deepEqual(reader.retention, retained(PROJECT_RUNTIME_MAX_EVENTS, 0));
  assert.deepEqual(reader.lifecycle, { started: false, completed: false });
  assert.ok(Object.isFrozen(reader.retention)); assert.ok(Object.isFrozen(reader.lifecycle));
  assert.throws(() => { reader.retention.total = 9; }, TypeError);
  assert.throws(() => { reader.lifecycle.completed = true; }, TypeError);
});

test('one push returns and publishes every accepted frame while only its final raw window is retained', () => {
  const plan = runtimeProject(), frames = returnTrip(plan), seen = [];
  const reader = createProjectRuntimeEventReader(plan, { retainedEvents: 2, onEvent: frame => seen.push(frame) });
  const empty = reader.retention, waiting = reader.lifecycle;
  const admitted = push(reader, frames);
  assert.deepEqual(admitted, frames); assert.deepEqual(seen, frames);
  assert.deepEqual(reader.events, frames.slice(-2));
  assert.deepEqual(reader.retention, retained(2, frames.length));
  assert.deepEqual(reader.lifecycle, { started: true, completed: true });
  assert.deepEqual(empty, retained(2, 0)); assert.deepEqual(waiting, { started: false, completed: false });
  assert.throws(() => { admitted[0].entrySceneId = 'forged'; }, TypeError);
  admitted.length = 0; seen.length = 0; reader.events.length = 0;
  assert.deepEqual(reader.finish(), { events: frames.slice(-2), diagnostics: [] });
});

test('fragmented input and multiple pushes keep full admission results after ready leaves the retained window', () => {
  const plan = runtimeProject(), frames = returnTrip(plan), reader = createProjectRuntimeEventReader(plan, { retainedEvents: 1 });
  const admitted = [], wire = frames.slice(0, -1).map(projectLine).join('');
  for (let offset = 0; offset < wire.length; offset += 17) admitted.push(...reader.push(wire.slice(offset, offset + 17)));
  assert.deepEqual(admitted, frames.slice(0, -1));
  assert.equal(reader.events.some(frame => frame.event === 'ready'), false);
  assert.deepEqual(reader.lifecycle, { started: true, completed: false });
  assert.deepEqual(push(reader, frames.slice(-1)), frames.slice(-1));
  assert.deepEqual(reader.lifecycle, { started: true, completed: true });
  assert.deepEqual(reader.retention, retained(1, frames.length));
  assert.deepEqual(reader.finish().diagnostics, []);
});

test('malformed frames do not consume raw sequences or invent lifecycle completion', () => {
  const plan = runtimeProject(), scene = plan.scenes[0], reader = createProjectRuntimeEventReader(plan, { retainedEvents: 1 });
  assert.deepEqual(reader.push('startup\nVIENTO_PROJECT:not-json\n' + projectLine(finishProject(plan, 0, 0))), []);
  assert.deepEqual(reader.retention, retained(1, 0));
  assert.deepEqual(reader.lifecycle, { started: false, completed: false });
  assert.deepEqual(push(reader, [projectReady(plan), projectReady(plan), enterScene(scene, 1), readyScene(scene, 1)]),
    [projectReady(plan), enterScene(scene, 1), readyScene(scene, 1)]);
  assert.deepEqual(reader.retention, retained(1, 3));
  assert.deepEqual(reader.lifecycle, { started: true, completed: false });
  assert.equal(reader.finish().diagnostics.length, 3);
  assert.deepEqual(reader.lifecycle, { started: true, completed: false });
  assert.deepEqual(push(reader, [exitScene(scene, 1, 0), finishProject(plan, 1, 0)]), []);
  assert.deepEqual(reader.retention, retained(1, 3));
});

test('a small retention window does not reset the existing 4096 accepted-frame execution budget', () => {
  const plan = runtimeProject(), scene = plan.scenes[0], seen = [];
  const reader = createProjectRuntimeEventReader(plan, { retainedEvents: 2, onEvent: frame => seen.push(frame) });
  push(reader, [projectReady(plan), enterScene(scene, 1), readyScene(scene, 1)]);
  const state = sceneFrame(scene, 1, { protocol: 2, event: 'state', instanceId: scene.actors[0].instanceId,
    objectId: scene.actors[0].objectId, state: 'idle' });
  const admitted = reader.push(projectLine(state).repeat(PROJECT_RUNTIME_MAX_EVENTS));
  assert.equal(admitted.length, PROJECT_RUNTIME_MAX_EVENTS - 3);
  assert.equal(seen.length, PROJECT_RUNTIME_MAX_EVENTS);
  assert.deepEqual(reader.retention, retained(2, PROJECT_RUNTIME_MAX_EVENTS));
  assert.deepEqual(reader.events, [state, state]);
  assert.equal(reader.diagnostics.length, 1);
  assert.match(reader.diagnostics[0].message, /event budget exceeded/);
  assert.deepEqual(push(reader, [exitScene(scene, 1, 0), finishProject(plan, 1, 0)]), []);
  assert.equal(reader.diagnostics.length, 1);
  assert.deepEqual(reader.lifecycle, { started: true, completed: false });
});

test('finish admits an unterminated terminal line and preserves expected-duration rejection', () => {
  for (const expectedTotalSeconds of [0.5, 1]) {
    const plan = runtimeProject(), frames = returnTrip(plan), seen = [];
    const reader = createProjectRuntimeEventReader(plan, { retainedEvents: 1, expectedTotalSeconds, onEvent: frame => seen.push(frame) });
    push(reader, frames.slice(0, -1));
    assert.deepEqual(reader.push(projectLine(frames.at(-1)).trimEnd()), []);
    assert.deepEqual(reader.lifecycle, { started: true, completed: false });
    const result = reader.finish(), valid = expectedTotalSeconds === 0.5;
    assert.deepEqual(reader.lifecycle, { started: true, completed: valid });
    assert.deepEqual(reader.retention, retained(1, frames.length - (valid ? 0 : 1)));
    assert.deepEqual(seen, valid ? frames : frames.slice(0, -1));
    assert.equal(result.diagnostics.length, valid ? 0 : 1);
    if (!valid) assert.equal(result.diagnostics[0].code, 'runtime_protocol_incomplete');
    assert.deepEqual(reader.finish(), result);
  }
});

for (const [protocolVersion, makePlan, makeFrames, ledgers] of [
  [2, sharedStateProject, stateReturnTrip, ['sharedState']],
  [3, eventProject, eventReturnTrip, ['sharedState', 'projectEvents']],
  [4, audioProject, audioReturnTrip, ['sharedState', 'projectEvents', 'audioCommands']],
  [5, animationProject, animationReturnTrip, ['sharedState', 'projectEvents', 'audioCommands', 'animationCommands']],
  [7, completionProject, completionRun, ['sharedState', 'projectEvents', 'audioCommands', 'animationCommands', 'animationCompletions']],
]) test(`raw retention preserves protocol ${protocolVersion} semantic ledgers and their frozen source evidence`, () => {
  const plan = makePlan(), frames = makeFrames(plan), complete = createProjectRuntimeEventReader(plan, { protocolVersion });
  const window = createProjectRuntimeEventReader(plan, { protocolVersion, retainedEvents: 1 });
  assert.deepEqual(push(complete, frames), frames); assert.deepEqual(push(window, frames), frames);
  assert.deepEqual(complete.finish().diagnostics, []); assert.deepEqual(window.finish().diagnostics, []);
  assert.deepEqual(window.events, frames.slice(-1));
  assert.deepEqual(window.retention, retained(1, frames.length));
  assert.deepEqual(window.lifecycle, { started: true, completed: true });
  for (const ledger of ledgers) assert.deepEqual(window[ledger], complete[ledger]);
});
