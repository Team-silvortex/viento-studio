import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createProjectAnimationStateReview, queryProjectAnimationStateReview } from '../../engine/project-animation-state-review.mjs';
import { createProjectRuntimeObservation, queryProjectRuntimeObservation } from '../../engine/project-runtime-query.mjs';
import { createProjectAnimationStateCatalog } from '../../engine/project-animation-states.mjs';
import { generateEditableGodotAnimationStateScript } from '../../engine/animation-state-script-source.mjs';
import { DEFAULT_ANIMATION_STATE_TABLE } from '../../engine/godot-animation-state-script.mjs';
import { completionProject, completionStart, completionCommand } from './helpers/project-animation-completion-fixture.mjs';
import { runtimeId, enterScene, readyScene, exitScene, sceneFrame } from './helpers/project-runtime-fixture.mjs';
const clone = value => structuredClone(value), invalid = { errorCode: 'project_animation_state_review_invalid' };
const p9 = frame => ({ ...frame, protocol: 9, ...(['ready', 'finished'].includes(frame.event) ? { animationStateSequence: 0, animationStateEntrySequence: 0 } : {}) });
function fixture() {
  const plan = completionProject(), scene = plan.scenes[0];
  scene.behaviors.sources[0].content = generateEditableGodotAnimationStateScript(DEFAULT_ANIMATION_STATE_TABLE).content;
  scene.behaviors.bindings[0].parameters = {};
  const second = clone(scene.behaviors.bindings[0]); second.bindingId = runtimeId(888); second.declaration.propertyPath = '/bindings/1'; scene.behaviors.bindings.push(second);
  const controllers = createProjectAnimationStateCatalog(plan).scenes[0].controllers;
  const observer = createProjectRuntimeObservation(plan, { protocolVersion: 9 });
  const push = (...frames) => { for (const frame of frames) assert.equal(observer.push(frame), true, JSON.stringify(frame)); };
  const entry = (sequence, bindingIndex = 0, stateIndex = 0, visitIndex = 1, timeSeconds = 0, commandSequence = 0) => {
    const controller = controllers[bindingIndex];
    return { protocol: 9, event: 'animation-state-entered', sequence, visitIndex, sceneId: scene.scene.objectId, timeSeconds, commandSequence,
      bindingId: controller.bindingId, instanceId: controller.instanceId, objectId: controller.objectId, stateIndex, clipId: null };
  };
  const command = (sequence, action, time = 0, position = 0, bindingIndex = 0, visit = 1) => {
    const frame = p9(completionCommand(scene, visit, sequence, action === 'select' ? { action, clipId: null } : { action }, time, position, action === 'play' ? 'playing' : 'paused'));
    const { bindingId, instanceId, objectId } = controllers[bindingIndex]; return { ...frame, bindingId, instanceId, objectId };
  };
  const terminal = (options = {}) => {
    const { sequence = 1, visitIndex = 1, status = 'active', reason = 'finished', stateIndex = 0, timeSeconds = .5, commandSequence = 0 } = options;
    return { protocol: 9, event: 'animation-state-snapshot', sequence, visitIndex, sceneId: scene.scene.objectId, timeSeconds, commandSequence, reason,
      controllers: controllers.map((controller, i) => ({ bindingId: controller.bindingId, instanceId: controller.instanceId, objectId: controller.objectId, status,
        stateIndex: status === 'inactive' ? -1 : status === 'unavailable' ? null : i === 0 ? stateIndex : 0, clipId: null })) };
  };
  push(...completionStart(plan).map(p9));
  return { plan, scene, controllers, observer, push, entry, command, terminal, view: () => observer.snapshot() };
}
function populated() {
  const f = fixture(); f.push(f.entry(1), f.entry(2, 1), f.entry(3, 0, 1), f.entry(4, 0, 1));
  return f;
}
function isDeepFrozen(value) {
  if (value && typeof value === 'object') { assert.equal(Object.isFrozen(value), true); for (const child of Object.values(value)) isDeepFrozen(child); }
}

test('review uses a branded immutable model and validates complete protocol9 observations', () => {
  const f = populated(), input = f.view(), model = createProjectAnimationStateReview(input);
  assert.deepEqual(Object.keys(model), ['entries']); assert.deepEqual(model.entries, input.project.animationStateEntries.entries); isDeepFrozen(model);
  const again = createProjectAnimationStateReview(queryProjectRuntimeObservation(input)); assert.deepEqual(again.entries, model.entries);
  assert.throws(() => createProjectAnimationStateReview({ project: input.project }), invalid);
  const legacy = clone(input); legacy.project.protocolVersion = 8; delete legacy.project.animationStateEntries;
  assert.throws(() => createProjectAnimationStateReview(legacy), invalid);
});
test('same-frame repeated entries stay distinct and navigation skips other bindings sharing the same script', () => {
  const f = populated(), model = createProjectAnimationStateReview(f.view()), first = queryProjectAnimationStateReview(model, 1), middle = queryProjectAnimationStateReview(model, 3), last = queryProjectAnimationStateReview(model, 4);
  assert.deepEqual(first.entries.map(row => row.sequence), [1, 3, 4]); assert.deepEqual(first.entries.map(row => row.stateKey), ['idle', 'action', 'action']);
  assert.deepEqual([first.position, first.previousSequence, first.nextSequence], [1, null, 3]);
  assert.deepEqual([middle.position, middle.previousSequence, middle.nextSequence], [2, 1, 4]);
  assert.deepEqual([last.position, last.previousSequence, last.nextSequence], [3, 3, null]);
  const other = queryProjectAnimationStateReview(model, 2); assert.deepEqual(other.entries.map(row => row.sequence), [2]); assert.equal(other.position, 1);
  assert.equal(first.entry.scriptSource.objectId, other.entry.scriptSource.objectId); assert.notEqual(first.entry.origin.bindingId, other.entry.origin.bindingId);
  assert.deepEqual(Object.keys(first), ['entry', 'entries', 'position', 'previousSequence', 'nextSequence', 'followingCommands', 'terminal']);
  isDeepFrozen(first);
});
test('commands arriving after acceptance do not mutate an older review and shared cutoffs never infer pairings', () => {
  const f = populated(), before = createProjectAnimationStateReview(f.view());
  assert.deepEqual(queryProjectAnimationStateReview(before, 1).followingCommands, []);
  f.push(f.command(1, 'select'), f.command(2, 'play'), f.command(3, 'pause', .1, .1, 1), f.command(4, 'play', .2, .1));
  const model = createProjectAnimationStateReview(f.view());
  for (const sequence of [1, 3, 4]) assert.deepEqual(queryProjectAnimationStateReview(model, sequence).followingCommands.map(row => row.sequence), [1, 2, 4]);
  assert.deepEqual(queryProjectAnimationStateReview(model, 2).followingCommands.map(row => row.sequence), [3]);
  assert.deepEqual(queryProjectAnimationStateReview(before, 1).followingCommands, []);
  assert.deepEqual(queryProjectAnimationStateReview(model, 1).followingCommands[0], f.view().project.animationCommands.entries[0]);
});
test('later entry cutoff excludes already executed commands without cutting earlier reviews at the next entry', () => {
  const f = populated(); f.push(f.command(1, 'select'), f.command(2, 'play'), f.command(3, 'pause', .1, .1, 1), f.command(4, 'play', .2, .1),
    f.entry(5, 0, 0, 1, .25, 4), f.command(5, 'select', .25), f.command(6, 'play', .25));
  const model = createProjectAnimationStateReview(f.view());
  assert.deepEqual(queryProjectAnimationStateReview(model, 1).followingCommands.map(row => row.sequence), [1, 2, 4, 5, 6]);
  assert.deepEqual(queryProjectAnimationStateReview(model, 5).followingCommands.map(row => row.sequence), [5, 6]);
  assert.deepEqual(queryProjectAnimationStateReview(model, 5).entries.map(row => row.sequence), [1, 3, 4, 5]);
});
test('scene reentry owns a separate navigation group command history and terminal snapshot', () => {
  const f = populated(), other = f.plan.scenes[1];
  f.push(f.command(1, 'select'), f.command(2, 'play'), f.terminal({ reason: 'switch', stateIndex: 1, commandSequence: 2 }), p9(exitScene(f.scene, 1, .5, other)),
    p9(enterScene(other, 2)), p9(readyScene(other, 2)), p9(exitScene(other, 2, 0, f.scene)), p9(enterScene(f.scene, 3)), p9(readyScene(f.scene, 3)),
    f.entry(5, 0, 0, 3, 0, 2), f.entry(6, 1, 0, 3, 0, 2), f.command(3, 'select', 0, 0, 0, 3), f.command(4, 'play', 0, 0, 0, 3));
  const model = createProjectAnimationStateReview(f.view()), earlier = queryProjectAnimationStateReview(model, 1), fresh = queryProjectAnimationStateReview(model, 5);
  assert.deepEqual(earlier.entries.map(row => row.sequence), [1, 3, 4]); assert.deepEqual(fresh.entries.map(row => row.sequence), [5]);
  assert.deepEqual(earlier.followingCommands.map(row => row.sequence), [1, 2]); assert.deepEqual(fresh.followingCommands.map(row => row.sequence), [3, 4]);
  assert.equal(earlier.terminal.reason, 'switch'); assert.equal(fresh.terminal, null); assert.equal(fresh.previousSequence, null);
});
for (const status of ['active', 'inactive', 'unavailable']) test(`review preserves explicit ${status} terminal controller without replacing selected entry`, () => {
  const f = populated(); f.push(f.terminal({ status, stateIndex: 1 }));
  const model = createProjectAnimationStateReview(f.view()), review = queryProjectAnimationStateReview(model, 1), snapshot = f.view().project.animationStates.entries[0];
  assert.equal(review.entry.stateKey, 'idle'); assert.deepEqual(review.terminal, { reason: snapshot.reason, timeSeconds: snapshot.timeSeconds, commandSequence: snapshot.commandSequence, controller: snapshot.controllers[0] });
  assert.equal(review.terminal.controller.status, status); assert.equal(review.terminal.controller.stateKey, status === 'active' ? 'action' : null); isDeepFrozen(review.terminal);
});
test('aborted and incomplete runs retain only collected entries commands and terminal evidence', () => {
  const f = populated(), binding = f.scene.behaviors.bindings[0], before = createProjectAnimationStateReview(f.view());
  f.push(p9(sceneFrame(f.scene, 1, { protocol: 3, event: 'diagnostic', severity: 'error', code: 'runtime_behavior_script', message: 'failed', bindingId: binding.bindingId, instanceId: binding.instanceId, objectId: binding.objectId })),
    f.terminal({ reason: 'aborted', status: 'inactive' }));
  const after = createProjectAnimationStateReview(f.view()); assert.equal(queryProjectAnimationStateReview(before, 1).terminal, null);
  assert.equal(queryProjectAnimationStateReview(after, 1).terminal.reason, 'aborted');
  assert.deepEqual(queryProjectAnimationStateReview(after, 1).followingCommands, []);
});
test('empty histories and absent positive sequences return null but malformed selection or fake models fail', () => {
  const empty = createProjectAnimationStateReview(fixture().view()), model = createProjectAnimationStateReview(populated().view());
  assert.equal(queryProjectAnimationStateReview(empty, 1), null); assert.equal(queryProjectAnimationStateReview(model, 129), null); assert.equal(queryProjectAnimationStateReview(model, Number.MAX_SAFE_INTEGER), null);
  for (const sequence of [0, -1, .5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '1', null, undefined, true, {}, []]) assert.throws(() => queryProjectAnimationStateReview(model, sequence), invalid);
  for (const fake of [null, undefined, {}, { entries: model.entries }, clone(model), Object.freeze(clone(model)), 1, 'model']) assert.throws(() => queryProjectAnimationStateReview(fake, 1), invalid);
});
test('caller mutation cannot redirect selected entry command or terminal provenance', () => {
  const f = populated(); f.push(f.command(1, 'select'), f.command(2, 'play'), f.terminal({ stateIndex: 1, commandSequence: 2 }));
  const input = f.view(), before = clone(input), model = createProjectAnimationStateReview(input);
  assert.deepEqual(input, before);
  input.project.animationStateEntries.entries[0].scriptSource.sourcePath = 'changed.txt'; input.project.animationCommands.entries[0].origin.source.sourcePath = 'changed.json'; input.project.animationStates.entries[0].controllers[0].origin.source.sourcePath = 'changed.json';
  const selected = queryProjectAnimationStateReview(model, 1);
  assert.deepEqual(selected.entry, before.project.animationStateEntries.entries[0]); assert.deepEqual(selected.followingCommands[0], before.project.animationCommands.entries[0]); assert.deepEqual(selected.terminal.controller, before.project.animationStates.entries[0].controllers[0]);
  assert.throws(() => { selected.entry.stateKey = 'edited'; }, TypeError); assert.throws(() => { selected.entries.push(selected.entry); }, TypeError);
});
test('review admission rejects executable accessors and serialization hooks without calling them', () => {
  let calls = 0; const original = populated().view();
  for (const install of [value => Object.defineProperty(value, 'project', { enumerable: true, get() { calls++; return original.project; } }),
    value => Object.defineProperty(value.project.animationStateEntries.entries[0], 'stateKey', { enumerable: true, get() { calls++; return 'idle'; } }),
    value => value.project.animationStateEntries.toJSON = () => { calls++; return {}; }]) {
    const bad = clone(original); install(bad); assert.throws(() => createProjectAnimationStateReview(bad), invalid);
  }
  const fake = {}; Object.defineProperty(fake, 'entries', { get() { calls++; return []; } }); assert.throws(() => queryProjectAnimationStateReview(fake, 1), invalid);
  const selection = { valueOf() { calls++; return 1; } }; assert.throws(() => queryProjectAnimationStateReview(createProjectAnimationStateReview(original), selection), invalid);
  assert.equal(calls, 0);
});
test('full runtime admission rejects earlier command source substitution and contradictory terminal state', () => {
  const f = populated(); f.push(f.command(1, 'select'), f.command(2, 'play'), f.terminal({ stateIndex: 1, commandSequence: 2 }));
  const original = f.view();
  for (const mutate of [value => value.project.animationCommands.entries[0].origin.source.sourcePath = 'other.json',
    value => value.project.animationStateEntries.entries[0].origin.instanceId = runtimeId(900),
    value => value.project.animationStateEntries.entries[0].scriptSource.sourceRevision = 'sha256:' + '9'.repeat(64),
    value => value.project.animationStates.entries[0].controllers[0].stateKey = 'idle',
    value => value.project.animationStateEntries.entries[0].commandSequence = 99]) {
    const bad = clone(original); mutate(bad); assert.throws(() => createProjectAnimationStateReview(bad), invalid);
  }
});
test('a maximum 128-entry group retains every repeated entry and first/last navigation bounds', () => {
  const f = fixture(); for (let sequence = 1; sequence <= 128; sequence++) f.push(f.entry(sequence));
  const model = createProjectAnimationStateReview(f.view()), first = queryProjectAnimationStateReview(model, 1), last = queryProjectAnimationStateReview(model, 128);
  assert.equal(first.entries.length, 128); assert.equal(last.position, 128); assert.equal(first.previousSequence, null); assert.equal(last.nextSequence, null); assert.equal(last.previousSequence, 127);
});
