import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createProjectAnimationTargetReview, queryProjectAnimationTargetReview, findProjectAnimationTargetReview } from '../../engine/project-animation-target-review.mjs';
import { createProjectRuntimeObservation, queryProjectRuntimeObservation } from '../../engine/project-runtime-query.mjs';
import { completionProject, completionStart, completionCommand, animationCompleted, completionDelivery } from './helpers/project-animation-completion-fixture.mjs';
import { runtimeId, enterScene, readyScene, exitScene } from './helpers/project-runtime-fixture.mjs';

const clone = value => structuredClone(value), invalid = { errorCode: 'project_animation_target_review_invalid' };
const p11 = frame => ({ ...frame, protocol: 11, ...(['ready', 'finished'].includes(frame.event) ? { animationStateSequence: 0, animationStateEntrySequence: 0 } : {}) });
function fixture() {
  const plan = completionProject(), scene = plan.scenes[0], animation = scene.animation;
  animation.schemaVersion = 3; animation.document.schemaVersion = 4; animation.document.playbackScope = 'instance';
  const track = { ...clone(animation.document.tracks[0]), id: runtimeId(901), instanceId: scene.actors[1].instanceId };
  animation.document.tracks.push(track); animation.locations.tracks.push({ id: track.id, declaration: { ...animation.manifest, propertyPath: '/tracks/1' } });
  for (const [index, actor] of [[1, scene.actors[1]], [2, scene.actors[0]]]) {
    const binding = clone(scene.behaviors.bindings[0]);
    binding.bindingId = runtimeId(910 + index); binding.instanceId = actor.instanceId; binding.objectId = actor.objectId;
    binding.declaration.propertyPath = `/bindings/${index}`; scene.behaviors.bindings.push(binding);
  }
  scene.requiredCapabilities.push('animation.instances2d');
  plan.requiredCapabilities = [...new Set(['project.scenes', ...plan.scenes.flatMap(item => item.requiredCapabilities)])].sort();
  const observer = createProjectRuntimeObservation(plan, { protocolVersion: 11 });
  const push = (...frames) => { for (const frame of frames) assert.equal(observer.push(frame), true, JSON.stringify(frame)); };
  push(...completionStart(plan).map(p11));
  return { plan, scene, observer, push, view: () => observer.snapshot() };
}
const targetFor = (scene, binding) => scene.animation.document.playbackScope === 'instance'
  ? { kind: 'instance', instanceId: scene.behaviors.bindings[binding].instanceId } : { kind: 'scene' };
function command(scene, sequence, binding, action, { time = 0, position = 0, phase = 'paused', clipId = null, visit = 1 } = {}) {
  const frame = p11(completionCommand(scene, visit, sequence, action, time, position, phase, clipId));
  const { bindingId, instanceId, objectId } = scene.behaviors.bindings[binding];
  return { ...frame, bindingId, instanceId, objectId, target: targetFor(scene, binding) };
}
function completed(scene, sequence, cutoff, anchor, { binding = 0, time = 1, clipId = null, tokens = [], visit = 1 } = {}) {
  const frame = p11(animationCompleted(scene, visit, sequence, cutoff, time, clipId, []));
  const { bindingId, instanceId, objectId } = scene.behaviors.bindings[binding];
  return { ...frame, target: targetFor(scene, binding), targetCommandSequence: anchor,
    recipients: tokens.map(subscriptionId => ({ subscriptionId, bindingId, instanceId, objectId })) };
}
function populated() {
  const f = fixture(), clipId = f.scene.animation.document.clips[0].id;
  f.push(command(f.scene, 1, 1, { action: 'select', clipId }, { clipId }),
    command(f.scene, 2, 1, { action: 'play' }, { clipId, phase: 'playing' }),
    command(f.scene, 3, 0, { action: 'select', clipId }, { clipId }),
    command(f.scene, 4, 2, { action: 'play' }, { clipId, phase: 'playing' }),
    completed(f.scene, 1, 4, 4, { clipId, time: .4 }),
    completed(f.scene, 2, 4, 2, { binding: 1, clipId, time: .4 }));
  return f;
}
const targetGroup = (model, scene, binding = 0, visitIndex = 1) => model.groups.find(group =>
  group.visitIndex === visitIndex && group.sceneId === scene.scene.objectId && group.target.instanceId === targetFor(scene, binding).instanceId);
function deepFrozen(value) {
  if (value && typeof value === 'object') { assert.equal(Object.isFrozen(value), true); for (const child of Object.values(value)) deepFrozen(child); }
}

test('target review admits only complete protocol11 observations and exposes branded frozen observed groups', () => {
  const f = populated(), input = f.view(), model = createProjectAnimationTargetReview(input);
  assert.deepEqual(Object.keys(model), ['groups']); assert.equal(model.groups.length, 2); deepFrozen(model);
  assert.deepEqual(createProjectAnimationTargetReview(queryProjectRuntimeObservation(input)), model);
  for (const group of model.groups) {
    assert.deepEqual(Object.keys(group), ['key', 'visitIndex', 'sceneId', 'target', 'animation', 'commandCount', 'completionCount']);
    assert.equal(group.key, `1/${f.scene.scene.objectId}/instance/${group.target.instanceId}`);
    assert.equal(group.commandCount, 2); assert.equal(group.completionCount, 1);
    const review = queryProjectAnimationTargetReview(model, group.key);
    assert.equal(review.group, group); assert.deepEqual(Object.keys(review), ['group', 'commands', 'completions']); deepFrozen(review);
  }
  assert.throws(() => createProjectAnimationTargetReview({ project: input.project }), invalid);
  for (const protocolVersion of [9, 10]) {
    const legacy = fixture().view(); legacy.project.protocolVersion = protocolVersion;
    assert.deepEqual(queryProjectRuntimeObservation(legacy), legacy);
    assert.throws(() => createProjectAnimationTargetReview(legacy), invalid);
  }
  assert.deepEqual(createProjectAnimationTargetReview(fixture().view()), { groups: [] });
});

test('explicit target groups join multiple bindings and separate instances sharing the same animation and object', () => {
  const f = populated(), model = createProjectAnimationTargetReview(f.view()), group = targetGroup(model, f.scene), other = targetGroup(model, f.scene, 1);
  const review = queryProjectAnimationTargetReview(model, group.key), second = queryProjectAnimationTargetReview(model, other.key);
  assert.deepEqual(review.commands.map(row => row.sequence), [3, 4]);
  assert.notEqual(review.commands[0].origin.bindingId, review.commands[1].origin.bindingId);
  assert.deepEqual(second.commands.map(row => row.sequence), [1, 2]);
  assert.equal(review.commands[0].origin.objectId, second.commands[0].origin.objectId);
  assert.equal(group.animation.objectId, other.animation.objectId); assert.notEqual(group.key, other.key);
  assert.deepEqual(review.commands, f.view().project.animationCommands.entries.slice(2));
});

test('command and completion sequence domains stay independent and same-clock completions keep exact target anchors', () => {
  const f = populated(), model = createProjectAnimationTargetReview(f.view()), a = targetGroup(model, f.scene), b = targetGroup(model, f.scene, 1);
  assert.equal(findProjectAnimationTargetReview(model, 'command', 1), b.key);
  assert.equal(findProjectAnimationTargetReview(model, 'completion', 1), a.key);
  for (const [group, anchor] of [[a, 4], [b, 2]]) {
    const review = queryProjectAnimationTargetReview(model, group.key), completion = review.completions[0];
    assert.deepEqual(Object.keys(completion), ['entry', 'anchorCommand']);
    assert.equal(completion.entry.commandSequence, 4); assert.equal(completion.entry.state.timeSeconds, .4);
    assert.equal(completion.entry.targetCommandSequence, anchor); assert.equal(completion.anchorCommand.sequence, anchor);
    assert.equal(completion.anchorCommand, review.commands.at(-1));
    assert.deepEqual(completion.entry, f.view().project.animationCompletions.entries[completion.entry.sequence - 1]);
  }
});

test('same-scene reentry separates target groups and never borrows an earlier visit anchor', () => {
  const f = populated(), other = f.plan.scenes[1];
  f.push(p11(exitScene(f.scene, 1, .4, other)), p11(enterScene(other, 2)), p11(readyScene(other, 2)),
    p11(exitScene(other, 2, 0, f.scene)), p11(enterScene(f.scene, 3)), p11(readyScene(f.scene, 3)),
    command(f.scene, 5, 0, { action: 'play' }, { visit: 3, phase: 'playing' }),
    completed(f.scene, 3, 5, 5, { visit: 3 }));
  const model = createProjectAnimationTargetReview(f.view()), first = targetGroup(model, f.scene), again = targetGroup(model, f.scene, 0, 3);
  assert.deepEqual(model.groups.map(group => group.visitIndex), [1, 1, 3]); assert.notEqual(first.key, again.key);
  assert.deepEqual(queryProjectAnimationTargetReview(model, first.key).commands.map(row => row.sequence), [3, 4]);
  const review = queryProjectAnimationTargetReview(model, again.key);
  assert.deepEqual(review.commands.map(row => row.sequence), [5]); assert.equal(review.completions[0].anchorCommand.sequence, 5);
});

test('scene-target autoplay completion has a zero anchor and creates only its observed group without commands', () => {
  const f = fixture(), second = f.plan.scenes[1];
  f.push(p11(exitScene(f.scene, 1, 0, second)), p11(enterScene(second, 2)), p11(readyScene(second, 2)), completed(second, 1, 0, 0, { visit: 2 }));
  const model = createProjectAnimationTargetReview(f.view()); assert.equal(model.groups.length, 1);
  const group = model.groups[0], review = queryProjectAnimationTargetReview(model, group.key);
  assert.deepEqual(group.target, { kind: 'scene' }); assert.equal(group.key, `2/${second.scene.objectId}/scene`);
  assert.equal(group.commandCount, 0); assert.equal(group.completionCount, 1); assert.deepEqual(review.commands, []);
  assert.equal(review.completions[0].anchorCommand, null); assert.equal(review.completions[0].entry.targetCommandSequence, 0);
  assert.equal(findProjectAnimationTargetReview(model, 'command', 1), null); assert.equal(findProjectAnimationTargetReview(model, 'completion', 1), group.key);
});

test('scene targets never become instance targets merely because commands originate from an instance', () => {
  const f = fixture(), scene = f.plan.scenes[1];
  f.push(p11(exitScene(f.scene, 1, 0, scene)), p11(enterScene(scene, 2)), p11(readyScene(scene, 2)),
    command(scene, 1, 0, { action: 'pause' }, { visit: 2 }));
  const model = createProjectAnimationTargetReview(f.view()), group = model.groups[0];
  assert.deepEqual(group.target, { kind: 'scene' }); assert.equal(model.groups.length, 1);
  assert.ok(queryProjectAnimationTargetReview(model, group.key).commands[0].origin.instanceId);
  assert.equal(group.key, `2/${scene.scene.objectId}/scene`);
});

test('later commands and delivery updates produce new evidence without mutating older reviews', () => {
  const f = fixture(); f.push(command(f.scene, 1, 0, { action: 'play' }, { phase: 'playing' }), completed(f.scene, 1, 1, 1, { tokens: [1] }));
  const input = f.view(), source = clone(input.project.animationCompletions.entries[0].deliveries[0].origin.source);
  const before = createProjectAnimationTargetReview(input), key = before.groups[0].key;
  input.project.animationCompletions.entries[0].deliveries[0].origin.source.sourcePath = 'changed.json';
  f.push(p11(completionDelivery(f.scene, 1, 1)), command(f.scene, 2, 2, { action: 'play' }, { time: 1, phase: 'playing' }), completed(f.scene, 2, 2, 2, { time: 2 }));
  const after = createProjectAnimationTargetReview(f.view()), first = queryProjectAnimationTargetReview(before, key), latest = queryProjectAnimationTargetReview(after, key);
  assert.equal(first.commands.length, 1); assert.equal(first.completions.length, 1); assert.equal(first.completions[0].entry.deliveries[0].status, 'pending');
  assert.deepEqual(first.completions[0].entry.deliveries[0].origin.source, source); deepFrozen(first);
  assert.equal(latest.commands.length, 2); assert.equal(latest.completions.length, 2); assert.equal(latest.completions[0].entry.deliveries[0].status, 'handled');
  assert.equal(latest.completions[1].anchorCommand.sequence, 2); assert.deepEqual(latest.group.target, first.group.target);
});

test('exact source metadata is detached and frozen for group declarations, commands and clips', () => {
  const f = populated(), input = f.view(), range = source => ({ start: 8, end: 70, encoding: 'utf-16', propertyPath: source.propertyPath, exact: true });
  for (const entry of [...input.project.animationCommands.entries, ...input.project.animationCompletions.entries]) {
    entry.animation.source.sourceRange = range(entry.animation.source);
    if (entry.clip) entry.clip.source.sourceRange = range(entry.clip.source);
    if (entry.origin) entry.origin.source.sourceRange = range(entry.origin.source);
  }
  const saved = clone(input), model = createProjectAnimationTargetReview(input), group = targetGroup(model, f.scene), review = queryProjectAnimationTargetReview(model, group.key);
  assert.deepEqual(input, saved);
  input.project.animationCommands.entries[2].origin.source.sourcePath = 'changed.json';
  input.project.animationCommands.entries[3].animation.source.sourceRange.start = 999;
  input.project.animationCompletions.entries[0].clip.source.sourceRevision = 'sha256:' + '9'.repeat(64);
  assert.deepEqual(review.commands, saved.project.animationCommands.entries.slice(2));
  assert.deepEqual(review.completions[0].entry, saved.project.animationCompletions.entries[0]);
  assert.deepEqual(group.animation, saved.project.animationCommands.entries[2].animation); deepFrozen(review);
  assert.throws(() => { review.commands.push(review.commands[0]); }, TypeError);
  assert.throws(() => { review.completions[0].anchorCommand.origin.source.sourcePath = 'changed.json'; }, TypeError);
});

test('full observation validation rejects false targets, anchors, visits and substituted shared source identities', () => {
  const original = populated().view();
  for (const mutate of [value => delete value.project.animationCommands.entries[0].target,
    value => value.project.animationCommands.entries[0].target = { kind: 'scene' },
    value => value.project.animationCompletions.entries[0].targetCommandSequence = 2,
    value => value.project.animationCompletions.entries[0].targetCommandSequence = 0,
    value => value.project.animationCompletions.entries[0].visitIndex = 2,
    value => value.project.animationCompletions.entries[0].animation.source.sourcePath = 'other.json',
    value => value.project.animationCommands.entries[1].origin.source.sourceRevision = 'sha256:' + '9'.repeat(64)]) {
    const input = clone(original); mutate(input); assert.throws(() => createProjectAnimationTargetReview(input), invalid);
  }
});

test('unknown lookups return null while fake brands and malformed selectors fail without coercion', () => {
  const model = createProjectAnimationTargetReview(populated().view()), empty = createProjectAnimationTargetReview(fixture().view());
  assert.equal(queryProjectAnimationTargetReview(model, 'unknown'), null); assert.equal(queryProjectAnimationTargetReview(empty, model.groups[0].key), null);
  for (const kind of ['command', 'completion']) for (const sequence of [999, Number.MAX_SAFE_INTEGER]) assert.equal(findProjectAnimationTargetReview(model, kind, sequence), null);
  for (const fake of [null, undefined, {}, clone(model), Object.freeze(clone(model)), 1, 'model']) {
    assert.throws(() => queryProjectAnimationTargetReview(fake, model.groups[0].key), invalid);
    assert.throws(() => findProjectAnimationTargetReview(fake, 'command', 1), invalid);
  }
  for (const key of ['', null, undefined, 1, true, {}, []]) assert.throws(() => queryProjectAnimationTargetReview(model, key), invalid);
  for (const kind of ['', 'commands', 'completed', null, undefined, 1, {}, []]) assert.throws(() => findProjectAnimationTargetReview(model, kind, 1), invalid);
  for (const sequence of [0, -1, .5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '1', null, undefined, true, {}, []]) assert.throws(() => findProjectAnimationTargetReview(model, 'command', sequence), invalid);
});

test('review admission and selectors never invoke caller getters or serialization hooks', () => {
  const original = populated().view(); let calls = 0;
  for (const install of [value => Object.defineProperty(value, 'project', { enumerable: true, get() { calls++; return original.project; } }),
    value => Object.defineProperty(value.project.animationCommands.entries[0], 'target', { enumerable: true, get() { calls++; return { kind: 'scene' }; } }),
    value => Object.defineProperty(value.project.animationCompletions.entries[0], 'targetCommandSequence', { enumerable: true, get() { calls++; return 4; } }),
    value => value.project.animationCompletions.toJSON = () => { calls++; return {}; }]) {
    const input = clone(original); install(input); assert.throws(() => createProjectAnimationTargetReview(input), invalid);
  }
  const model = createProjectAnimationTargetReview(original), fake = { get groups() { calls++; return model.groups; } }, selection = { toString() { calls++; return model.groups[0].key; }, valueOf() { calls++; return 1; } };
  assert.throws(() => queryProjectAnimationTargetReview(fake, model.groups[0].key), invalid);
  assert.throws(() => queryProjectAnimationTargetReview(model, selection), invalid);
  assert.throws(() => findProjectAnimationTargetReview(model, selection, 1), invalid);
  assert.throws(() => findProjectAnimationTargetReview(model, 'command', selection), invalid);
  assert.equal(calls, 0);
});
