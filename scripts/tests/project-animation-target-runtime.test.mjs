import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createProjectRuntimeEventReader } from '../../engine/project-runtime-events.mjs';
import { createProjectRuntimeObservation, queryProjectRuntimeObservation } from '../../engine/project-runtime-query.mjs';
import { captureProjectAnimationTarget, projectAnimationTargetKey, projectAnimationTargetForBinding } from '../../engine/project-animation-targets.mjs';
import { validateProjectAnimationCommandsSnapshot } from '../../engine/project-animation-commands.mjs';
import { createProjectAnimationCompletions, validateProjectAnimationCompletionsSnapshot } from '../../engine/project-animation-completions.mjs';
import { createProjectAnimationStateCatalog } from '../../engine/project-animation-states.mjs';
import { createProjectAnimationStateReview, queryProjectAnimationStateReview } from '../../engine/project-animation-state-review.mjs';
import { createProjectEventReview, queryProjectEventReview } from '../../engine/project-event-review.mjs';
import { generateEditableGodotAnimationStateScript } from '../../engine/animation-state-script-source.mjs';
import { DEFAULT_ANIMATION_STATE_TABLE } from '../../engine/godot-animation-state-script.mjs';
import { completionProject, completionStart, completionCommand, animationCompleted, completionDelivery, completionRun } from './helpers/project-animation-completion-fixture.mjs';
import { runtimeId, enterScene, readyScene, exitScene } from './helpers/project-runtime-fixture.mjs';
const clone = value => structuredClone(value), options = { protocolVersion: 11 };
const p11 = frame => ({ ...frame, protocol: 11, ...(['ready', 'finished'].includes(frame.event) ? { animationStateSequence: 0, animationStateEntrySequence: 0 } : {}) });
function fixture({ strict = false } = {}) {
  const plan = completionProject(), scene = plan.scenes[0], animation = scene.animation;
  animation.schemaVersion = 3; animation.document.schemaVersion = 4; animation.document.playbackScope = 'instance';
  const track = { ...clone(animation.document.tracks[0]), id: runtimeId(901), instanceId: scene.actors[1].instanceId };
  animation.document.tracks.push(track); animation.locations.tracks.push({ id: track.id, declaration: { ...animation.manifest, propertyPath: '/tracks/1' } });
  for (const [index, actor] of [[1, scene.actors[1]], [2, scene.actors[0]]]) {
    const binding = clone(scene.behaviors.bindings[0]);
    binding.bindingId = runtimeId(910 + index); binding.instanceId = actor.instanceId; binding.objectId = actor.objectId;
    binding.declaration.propertyPath = `/bindings/${index}`; scene.behaviors.bindings.push(binding);
  }
  if (strict) scene.behaviors.sources[0].content = generateEditableGodotAnimationStateScript(DEFAULT_ANIMATION_STATE_TABLE).content;
  scene.requiredCapabilities.push('animation.instances2d');
  plan.requiredCapabilities = [...new Set(['project.scenes', ...plan.scenes.flatMap(scene => scene.requiredCapabilities)])].sort();
  return plan;
}
const target = (scene, binding = 0) => ({ kind: 'instance', instanceId: scene.behaviors.bindings[binding].instanceId });
function command(scene, sequence, binding, action, time = 0, position = 0, phase = 'paused', clipId = null, visit = 1) {
  const f = p11(completionCommand(scene, visit, sequence, action, time, position, phase, clipId));
  const { bindingId, instanceId, objectId } = scene.behaviors.bindings[binding];
  return { ...f, bindingId, instanceId, objectId, target: target(scene, binding) };
}
function completed(scene, sequence, cutoff, anchor, binding = 0, time = 1, clipId = null, tokens = [binding + 1], visit = 1) {
  const f = p11(animationCompleted(scene, visit, sequence, cutoff, time, clipId, []));
  const { bindingId, instanceId, objectId } = scene.behaviors.bindings[binding];
  return { ...f, target: target(scene, binding), targetCommandSequence: anchor,
    recipients: tokens.map(subscriptionId => ({ subscriptionId, bindingId, instanceId, objectId })) };
}
const delivery = (scene, sequence, token = 1, status = 'handled', visit = 1) => p11(completionDelivery(scene, visit, sequence, token, status));
const start = plan => completionStart(plan).map(p11);
const push = (reader, frames) => reader.push(frames.map(frame => 'VIENTO_PROJECT:' + JSON.stringify(frame) + '\n').join(''));
function running(plan = fixture()) {
  const reader = createProjectRuntimeEventReader(plan, options); assert.equal(push(reader, start(plan)).length, 3);
  return { plan, scene: plan.scenes[0], reader };
}
function rejected(reader, frame) {
  const before = [reader.events, reader.animationCommands, reader.animationCompletions, reader.animationStateEntries];
  assert.equal(push(reader, [frame]).length, 0, JSON.stringify(frame));
  assert.deepEqual([reader.events, reader.animationCommands, reader.animationCompletions, reader.animationStateEntries], before);
}
function observed(plan, frames) {
  const observer = createProjectRuntimeObservation(plan, options);
  for (const f of [...start(plan), ...frames]) assert.equal(observer.push(f), true, JSON.stringify(f));
  return observer.snapshot();
}
function twoFinished(scene) {
  const clip = scene.animation.document.clips[0].id;
  return [command(scene, 1, 0, { action: 'select', clipId: clip }, 0, 0, 'paused', clip),
    command(scene, 2, 0, { action: 'play' }, 0, 0, 'playing', clip),
    command(scene, 3, 1, { action: 'select', clipId: clip }, 0, 0, 'paused', clip),
    command(scene, 4, 1, { action: 'play' }, 0, 0, 'playing', clip),
    completed(scene, 1, 4, 2, 0, .4, clip), completed(scene, 2, 4, 4, 1, .4, clip)];
}
function stateEntry(plan, sequence, binding, timeSeconds, commandSequence, trigger = { kind: 'direct' }) {
  const controller = createProjectAnimationStateCatalog(plan).scenes[0].controllers[binding];
  return { protocol: 11, event: 'animation-state-entered', sequence, visitIndex: 1, sceneId: plan.scenes[0].scene.objectId,
    timeSeconds, commandSequence, bindingId: controller.bindingId, instanceId: controller.instanceId, objectId: controller.objectId,
    stateIndex: 0, clipId: controller.clips[0], trigger };
}

test('explicit target capture is exact, detached, frozen and does not execute accessors', () => {
  const input = { kind: 'instance', instanceId: runtimeId(9) }, result = captureProjectAnimationTarget(input);
  assert.equal(Object.isFrozen(result), true); input.instanceId = runtimeId(8); assert.equal(result.instanceId, runtimeId(9));
  assert.equal(projectAnimationTargetKey({ kind: 'scene' }), 'scene');
  for (const bad of [null, {}, { kind: 'actor', instanceId: runtimeId(9) }, { kind: 'scene', instanceId: runtimeId(9) }, { kind: 'instance' }]) assert.throws(() => captureProjectAnimationTarget(bad));
  let calls = 0; assert.throws(() => captureProjectAnimationTarget({ get kind() { calls++; return 'scene'; } })); assert.equal(calls, 0);
});
test('instance plan requires p11 and p11 requires an instance-scoped frozen scene', () => {
  assert.throws(() => createProjectRuntimeEventReader(fixture(), { protocolVersion: 10 }));
  assert.throws(() => createProjectRuntimeEventReader(completionProject(), options));
  assert.throws(() => createProjectRuntimeEventReader(fixture(), { protocolVersion: 12 }));
});
test('instance transport starts stopped and never auto-plays, including at long scene exit', () => {
  const { reader, scene } = running();
  rejected(reader, completed(scene, 1, 0, 0, 0, 1));
  assert.equal(push(reader, [command(scene, 1, 0, { action: 'pause' }, 5, 0, 'paused'), p11(exitScene(scene, 1, 10))]).length, 2);
});
test('same-definition actors keep independent clips, clocks, seek and pause across interleaved commands', () => {
  const plan = fixture(), scene = plan.scenes[0], [a, b] = scene.animation.document.clips.map(x => x.id);
  const frames = [command(scene, 1, 0, { action: 'select', clipId: a }, 0, 0, 'paused', a),
    command(scene, 2, 1, { action: 'select', clipId: b }, 0, 0, 'paused', b),
    command(scene, 3, 0, { action: 'play' }, 0, 0, 'playing', a), command(scene, 4, 1, { action: 'play' }, 0, 0, 'playing', b),
    command(scene, 5, 0, { action: 'pause' }, .1, .1, 'paused', a),
    command(scene, 6, 1, { action: 'seek', positionSeconds: .3 }, .1, .3, 'paused', b),
    command(scene, 7, 0, { action: 'play' }, .2, .1, 'playing', a)];
  const view = observed(plan, frames); assert.deepEqual(queryProjectRuntimeObservation(view), view);
  assert.deepEqual(view.project.animationCommands.entries.map(x => x.target.instanceId), frames.map(x => x.target.instanceId));
});
test('multiple bindings on one instance share the last executed target state without owner restrictions', () => {
  const { reader, scene } = running(), clip = scene.animation.document.clips[0].id;
  assert.equal(push(reader, [command(scene, 1, 0, { action: 'select', clipId: clip }, 0, 0, 'paused', clip),
    command(scene, 2, 2, { action: 'play' }, 0, 0, 'playing', clip),
    command(scene, 3, 0, { action: 'pause' }, .1, .1, 'paused', clip)]).length, 3);
  assert.equal(reader.animationCommands.entries[1].origin.bindingId, scene.behaviors.bindings[2].bindingId);
});
test('wire target is mandatory and cannot borrow another actor, scene lane, unknown track or extra field', () => {
  for (const change of [f => delete f.target, f => f.target = { kind: 'scene' }, f => f.target.instanceId = runtimeId(999),
    (f, s) => f.target = target(s, 1), f => f.target.extra = 1, f => f.origin = {}]) {
    const { reader, scene } = running(), original = command(scene, 1, 0, { action: 'play' }, 0, 0, 'playing'), changed = clone(original);
    change(changed, scene); rejected(reader, changed); assert.equal(push(reader, [original]).length, 1);
  }
  const plan = fixture(); plan.scenes[0].animation.document.tracks.pop(); plan.scenes[0].animation.locations.tracks.pop();
  const { reader, scene } = running(plan); rejected(reader, command(scene, 1, 1, { action: 'play' }, 0, 0, 'playing'));
});
test('two targets may complete on the same clock and global cutoff and query preserves both', () => {
  const plan = fixture(), scene = plan.scenes[0], view = observed(plan, twoFinished(scene));
  assert.deepEqual(queryProjectRuntimeObservation(view), view);
  assert.deepEqual(view.project.animationCompletions.entries.map(x => x.targetCommandSequence), [2, 4]);
  assert.deepEqual(view.project.animationCompletions.entries.map(x => x.commandSequence), [4, 4]);
});
test('a command on A never cancels pending completion B, including shared completion tokens', () => {
  const plan = fixture(), scene = plan.scenes[0], clip = scene.animation.document.clips[0].id;
  const view = observed(plan, [...twoFinished(scene), delivery(scene, 1),
    command(scene, 5, 0, { action: 'play' }, .4, 0, 'playing', clip), delivery(scene, 2, 2)]);
  assert.deepEqual(queryProjectRuntimeObservation(view), view);
  assert.equal(view.project.animationCompletions.entries[1].deliveries[0].status, 'handled');
});
test('a new same-target command cancels its completion without retiring the live subscription', () => {
  const { reader, scene } = running(), clip = scene.animation.document.clips[0].id;
  push(reader, twoFinished(scene)); push(reader, [command(scene, 5, 2, { action: 'play' }, .4, 0, 'playing', clip)]);
  rejected(reader, delivery(scene, 1));
  assert.equal(push(reader, [delivery(scene, 1, 1, 'skipped'), delivery(scene, 2, 2),
    completed(scene, 3, 5, 5, 0, .8, clip), delivery(scene, 3)]).length, 4);
});
test('completion rejects wrong target anchor, reused anchor, unknown/foreign recipient and false initial completion atomically', () => {
  for (const change of [f => f.targetCommandSequence = 4, f => f.targetCommandSequence = 0, f => delete f.targetCommandSequence,
    f => f.target = { kind: 'scene' }, (f, s) => f.target = target(s, 1),
    (f, s) => Object.assign(f.recipients[0], { bindingId: s.behaviors.bindings[1].bindingId, instanceId: s.behaviors.bindings[1].instanceId }),
    f => f.commandSequence = 3]) {
    const { reader, scene } = running(), frames = twoFinished(scene); push(reader, frames.slice(0, 4));
    const changed = clone(frames[4]); change(changed, scene); rejected(reader, changed); assert.equal(push(reader, [frames[4]]).length, 1);
    rejected(reader, { ...frames[4], completionSequence: 2 });
  }
});
test('query rejects target substitution, cross-lane clip continuity, false anchors and duplicate same-target completions', () => {
  const plan = fixture(), scene = plan.scenes[0], original = observed(plan, twoFinished(scene));
  for (const mutate of [v => delete v.project.animationCommands.entries[0].target,
    v => v.project.animationCommands.entries[1].target = target(scene, 1),
    v => v.project.animationCommands.entries[1].state.clipId = scene.animation.document.clips[1].id,
    v => v.project.animationCompletions.entries[0].targetCommandSequence = 4,
    v => v.project.animationCompletions.entries[1].target = target(scene, 0),
    v => v.project.animationCompletions.entries[0].deliveries[0].origin.instanceId = scene.actors[1].instanceId,
    v => v.project.animationCompletions.entries[0].animation.source.sourcePath = 'different.json',
    v => v.project.animationCompletions.entries[0].commandSequence = 2,
    v => v.project.protocolVersion = 10]) {
    const changed = clone(original); mutate(changed); assert.throws(() => queryProjectRuntimeObservation(changed));
  }
  assert.deepEqual(queryProjectRuntimeObservation(original), original);
});
test('target snapshots reject accessors without invocation and retain p7-p10 exact legacy shape', () => {
  const plan = fixture(), view = observed(plan, twoFinished(plan.scenes[0])); let calls = 0;
  Object.defineProperty(view.project.animationCommands.entries[0], 'target', { enumerable: true, get() { calls++; return { kind: 'scene' }; } });
  assert.throws(() => validateProjectAnimationCommandsSnapshot(view.project.animationCommands, options)); assert.throws(() => queryProjectRuntimeObservation(view)); assert.equal(calls, 0);
  const oldPlan = completionProject(), old = createProjectRuntimeObservation(oldPlan, { protocolVersion: 7 });
  for (const frame of completionRun(oldPlan)) assert.equal(old.push(frame), true);
  const legacy = old.snapshot().project.animationCompletions;
  assert.deepEqual(validateProjectAnimationCompletionsSnapshot(legacy), legacy);
  legacy.entries[0].target = { kind: 'scene' }; assert.throws(() => validateProjectAnimationCompletionsSnapshot(legacy));
  assert.throws(() => validateProjectAnimationCompletionsSnapshot(legacy, options));
});
test('old scene-scoped animations within a p11 project preserve global autoplay and scene target anchor zero', () => {
  const { reader, scene, plan } = running(); const second = plan.scenes[1];
  assert.equal(push(reader, [p11(exitScene(scene, 1, 0, second)), p11(enterScene(second, 2)), p11(readyScene(second, 2))]).length, 3);
  const frame = { ...p11(animationCompleted(second, 2, 1, 0, 1, null, [1])), target: { kind: 'scene' }, targetCommandSequence: 0 };
  assert.equal(push(reader, [frame, delivery(second, 1, 1, 'handled', 2)]).length, 2);
  assert.equal(reader.animationCompletions.entries[0].target.kind, 'scene');
});
test('visit re-entry resets instance targets to stopped and never reuses old target anchor', () => {
  const { reader, scene, plan } = running(), second = plan.scenes[1];
  const frames = [command(scene, 1, 0, { action: 'play' }, 0, 0, 'playing'), command(scene, 2, 0, { action: 'pause' }, .1, .1, 'paused'),
    p11(exitScene(scene, 1, .1, second)), p11(enterScene(second, 2)), p11(readyScene(second, 2)),
    p11(exitScene(second, 2, 0, scene)), p11(enterScene(scene, 3)), p11(readyScene(scene, 3)),
    command(scene, 3, 0, { action: 'pause' }, .5, 0, 'paused', null, 3)];
  assert.equal(push(reader, frames).length, frames.length);
  rejected(reader, completed(scene, 1, 3, 1, 0, 1, null, [1], 3));
});
test('scene exit requires natural completion separately for every playing target', () => {
  const { reader, scene } = running(), frames = twoFinished(scene); push(reader, frames.slice(0, 5));
  push(reader, [delivery(scene, 1)]); rejected(reader, p11(exitScene(scene, 1, .4)));
  assert.equal(push(reader, [frames[5], delivery(scene, 2, 2), p11(exitScene(scene, 1, .4))]).length, 3);
});
test('strict generated controller without an own animation track fails with a source diagnostic', () => {
  const plan = fixture({ strict: true }); plan.scenes[0].animation.document.tracks.pop(); plan.scenes[0].animation.locations.tracks.pop();
  assert.throws(() => createProjectAnimationStateCatalog(plan), e => e.errorCode === 'build_animation_state_target_missing' && e.diagnostics[0].instanceId === plan.scenes[0].actors[1].instanceId);
});
test('p11 completion entries use current callback clock/global cutoff while retaining the original target anchor', () => {
  const plan = fixture({ strict: true }), scene = plan.scenes[0];
  const frames = [command(scene, 1, 1, { action: 'play' }, 0, 0, 'playing'),
    completed(scene, 1, 1, 1, 1, 1), command(scene, 2, 0, { action: 'pause' }, 1.2, 0, 'paused'),
    stateEntry(plan, 1, 1, 1.2, 2, { kind: 'completed', completionSequence: 1, subscriptionId: 2 })];
  const view = observed(plan, frames); assert.deepEqual(queryProjectRuntimeObservation(view), view);
  const selected = queryProjectAnimationStateReview(createProjectAnimationStateReview(view), 1);
  assert.equal(selected.triggerEvidence.completion.targetCommandSequence, 1); assert.equal(selected.entry.commandSequence, 2);
  assert.equal(selected.triggerEvidence.delivery.status, 'pending');
  const changed = clone(view); changed.project.animationCommands.entries[1].target = target(scene, 1);
  changed.project.animationCommands.entries[1].origin = clone(changed.project.animationCommands.entries[0].origin);
  changed.project.animationCommands.entries[1].state.positionSeconds = 1;
  assert.throws(() => queryProjectRuntimeObservation(changed));
});
test('same-target mutation revokes a pending completed entry; accepted entries cannot subsequently skip delivery', () => {
  const plan = fixture({ strict: true }), { reader, scene } = running(plan);
  push(reader, [command(scene, 1, 1, { action: 'play' }, 0, 0, 'playing'), completed(scene, 1, 1, 1, 1, 1),
    command(scene, 2, 1, { action: 'play' }, 1, 0, 'playing')]);
  rejected(reader, stateEntry(plan, 1, 1, 1, 2, { kind: 'completed', completionSequence: 1, subscriptionId: 2 }));
  assert.equal(push(reader, [delivery(scene, 1, 2, 'skipped'), stateEntry(plan, 1, 1, 1, 2)]).length, 2);
});
test('p11 event review associates explicit callbacks while unrelated direct entries remain unassociated', () => {
  const plan = fixture({ strict: true }), scene = plan.scenes[0], { bindingId, instanceId, objectId } = scene.behaviors.bindings[0];
  const publish = { protocol: 11, event: 'event-publish', visitIndex: 1, sceneId: scene.scene.objectId, bindingId, instanceId, objectId,
    sequence: 1, name: 'action', value: false, recipients: [{ subscriptionId: 1, bindingId, instanceId, objectId }] };
  const view = observed(plan, [stateEntry(plan, 1, 0, 0, 0), publish, stateEntry(plan, 2, 0, 0, 0, { kind: 'event', eventSequence: 1, subscriptionId: 1 })]);
  const selected = queryProjectEventReview(createProjectEventReview(view), 1);
  assert.equal(selected.deliveries[0].animation.status, 'recorded'); assert.equal(selected.deliveries[0].animation.entry.sequence, 2);
});

test('an instance loop remains independent and never emits a fabricated natural completion', () => {
  const { reader, scene } = running(), clip = scene.animation.document.clips[1].id;
  const frames = [command(scene, 1, 0, { action: 'select', clipId: clip }, 0, 0, 'paused', clip),
    command(scene, 2, 0, { action: 'play' }, 0, 0, 'playing', clip), command(scene, 3, 1, { action: 'pause' }, 2, 0, 'paused'),
    command(scene, 4, 0, { action: 'pause' }, 2, .2, 'paused', clip)];
  assert.equal(push(reader, frames).length, frames.length); rejected(reader, completed(scene, 1, 4, 4, 0, 2, clip));
});
test('target stop and replay reset only that target while failed receipts retain both lane heads', () => {
  const { reader, scene } = running();
  push(reader, [command(scene, 1, 0, { action: 'play' }, 0, 0, 'playing'), command(scene, 2, 1, { action: 'play' }, 0, 0, 'playing')]);
  rejected(reader, command(scene, 3, 0, { action: 'pause' }, .25, 0, 'paused'));
  assert.equal(push(reader, [command(scene, 3, 0, { action: 'stop' }, .25, 0, 'stopped'),
    command(scene, 4, 1, { action: 'pause' }, .25, .25, 'paused'), command(scene, 5, 0, { action: 'play' }, .5, 0, 'playing')]).length, 3);
});
test('p11 command budget stays globally bounded at 256, not 256 per target', () => {
  const { reader, scene } = running();
  const frames = Array.from({ length: 256 }, (_, index) => command(scene, index + 1, index % 2, { action: 'stop' }, 0, 0, 'stopped'));
  assert.equal(push(reader, frames).length, 256); rejected(reader, command(scene, 257, 0, { action: 'play' }, 0, 0, 'playing'));
  assert.equal(validateProjectAnimationCommandsSnapshot(reader.animationCommands, options).sequence, 256);
});
test('completion state cannot run backward behind a newer other-target command', () => {
  const { reader, scene } = running(); push(reader, [command(scene, 1, 0, { action: 'play' }, 0, 0, 'playing'), command(scene, 2, 1, { action: 'pause' }, 2, 0, 'paused')]);
  rejected(reader, completed(scene, 1, 2, 1, 0, 1));
  assert.equal(push(reader, [completed(scene, 1, 2, 1, 0, 2)]).length, 1);
});
test('query validates a whole finished p11 visit with strict per-binding entries and terminal controllers', () => {
  const plan = fixture({ strict: true }), scene = plan.scenes[0], controllers = createProjectAnimationStateCatalog(plan).scenes[0].controllers;
  const frames = [stateEntry(plan, 1, 0, 0, 0, { kind: 'initial' }), stateEntry(plan, 2, 1, 0, 0, { kind: 'initial' }), stateEntry(plan, 3, 2, 0, 0, { kind: 'initial' }),
    command(scene, 1, 0, { action: 'play' }, 0, 0, 'playing'), command(scene, 2, 1, { action: 'play' }, 0, 0, 'playing'),
    completed(scene, 1, 2, 1, 0, 1), stateEntry(plan, 4, 0, 1, 2, { kind: 'completed', completionSequence: 1, subscriptionId: 1 }), delivery(scene, 1),
    completed(scene, 2, 2, 2, 1, 1), stateEntry(plan, 5, 1, 1, 2, { kind: 'completed', completionSequence: 2, subscriptionId: 2 }), delivery(scene, 2, 2),
    { protocol: 11, event: 'animation-state-snapshot', sequence: 1, visitIndex: 1, sceneId: scene.scene.objectId, timeSeconds: 1, commandSequence: 2, reason: 'finished',
      controllers: controllers.map(c => ({ bindingId: c.bindingId, instanceId: c.instanceId, objectId: c.objectId, status: 'active', stateIndex: 0, clipId: null })) },
    p11(exitScene(scene, 1, 1)), { protocol: 11, event: 'finished', assemblyId: plan.assembly.objectId, visitCount: 1, totalSeconds: 1,
      stateRevision: 0, eventSequence: 0, audioCommandSequence: 0, animationCommandSequence: 2, animationCompletionSequence: 2, animationStateSequence: 1, animationStateEntrySequence: 5 }];
  const view = observed(plan, frames); assert.deepEqual(queryProjectRuntimeObservation(view), view);
  const selected = queryProjectAnimationStateReview(createProjectAnimationStateReview(view), 5);
  assert.equal(selected.terminal.controller.origin.instanceId, scene.actors[1].instanceId); assert.equal(selected.terminal.reason, 'finished');
  assert.equal(selected.entries.length, 2);
});
