import { validateProjectAnimationStateTriggeredEntriesSnapshot } from '../../engine/project-animation-state-entry-triggers.mjs';
import { createProjectAnimationStateReview, queryProjectAnimationStateReview } from '../../engine/project-animation-state-review.mjs';
import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createProjectAnimationStateEntries, validateProjectAnimationStateEntriesSnapshot } from '../../engine/project-animation-state-entries.mjs';
import { createProjectAnimationStateCatalog } from '../../engine/project-animation-states.mjs';
import { createProjectRuntimeEventReader } from '../../engine/project-runtime-events.mjs';
import { createProjectRuntimeObservation, queryProjectRuntimeObservation } from '../../engine/project-runtime-query.mjs';
import { validateExecutionBackendDescriptor, checkExecutionBackendSupport } from '../../engine/backend-capabilities.mjs';
import { generateEditableGodotAnimationStateScript } from '../../engine/animation-state-script-source.mjs';
import { DEFAULT_ANIMATION_STATE_TABLE } from '../../engine/godot-animation-state-script.mjs';
import { completionProject, completionStart, completionRun, completionCommand, animationCompleted, completionDelivery } from './helpers/project-animation-completion-fixture.mjs';
import { enterScene, readyScene, exitScene, runtimeId, sceneFrame } from './helpers/project-runtime-fixture.mjs';
const clone = value => structuredClone(value);
const p10 = frame => ({ ...frame, protocol: 10, ...(['ready', 'finished'].includes(frame.event) ? { animationStateSequence: 0, animationStateEntrySequence: 0 } : {}) });
function fixture() {
  const plan = completionProject(), scene = plan.scenes[0];
  scene.behaviors.sources[0].content = generateEditableGodotAnimationStateScript(DEFAULT_ANIMATION_STATE_TABLE).content;
  scene.behaviors.bindings[0].parameters = {};
  return plan;
}
function entry(plan, options = {}) {
  const { sequence = 1, visitIndex = 1, stateIndex = 0, timeSeconds = 0, commandSequence = 0, bindingIndex = 0 } = options;
  const scene = plan.scenes[0], controller = createProjectAnimationStateCatalog(plan).scenes[0].controllers[bindingIndex];
  return { protocol: 10, event: 'animation-state-entered', sequence, visitIndex, sceneId: scene.scene.objectId,
    timeSeconds, commandSequence, bindingId: controller.bindingId, instanceId: controller.instanceId,
    objectId: controller.objectId, stateIndex, clipId: controller.clips[stateIndex], trigger: options.trigger ?? { kind: 'direct' } };
}
function boundary(plan, options = {}) {
  const { sequence = 1, visitIndex = 1, timeSeconds = .5, commandSequence = 0, reason = 'finished', stateIndex = 0, status = 'active' } = options;
  return { protocol: 10, event: 'animation-state-snapshot', sequence, visitIndex, sceneId: plan.scenes[0].scene.objectId,
    timeSeconds, commandSequence, reason, controllers: createProjectAnimationStateCatalog(plan).scenes[0].controllers.map(controller => ({
      bindingId: controller.bindingId, instanceId: controller.instanceId, objectId: controller.objectId, status,
      stateIndex: status === 'inactive' ? -1 : status === 'unavailable' ? null : stateIndex, clipId: status === 'active' ? controller.clips[stateIndex] : null })) };
}
const push = (reader, frames) => reader.push(frames.map(frame => 'VIENTO_PROJECT:' + JSON.stringify(frame) + '\n').join(''));
function running(plan = fixture()) {
  const reader = createProjectRuntimeEventReader(plan, { protocolVersion: 10 });
  assert.equal(push(reader, completionStart(plan).map(p10)).length, 3);
  return { plan, reader, scene: plan.scenes[0] };
}
function reject(reader, event) {
  const before = [reader.animationStateEntries, reader.animationStates, reader.animationCommands, reader.events], count = reader.diagnostics.length;
  assert.deepEqual(push(reader, [event]), []); assert.deepEqual([reader.animationStateEntries, reader.animationStates, reader.animationCommands, reader.events], before);
  assert.equal(reader.diagnostics.length, count + 1);
}
function publication(plan, sequence = 1, tokens = [1]) {
  const scene = plan.scenes[0], { bindingId, instanceId, objectId } = scene.behaviors.bindings[0];
  return { protocol: 10, event: 'event-publish', visitIndex: 1, sceneId: scene.scene.objectId,
    bindingId, instanceId, objectId, sequence, name: 'action', value: false,
    recipients: tokens.map(subscriptionId => ({ subscriptionId, bindingId, instanceId, objectId })) };
}
function delivery(plan, sequence = 1, subscriptionId = 1, status = 'handled') {
  return { protocol: 10, event: 'event-delivery', visitIndex: 1, sceneId: plan.scenes[0].scene.objectId, sequence, subscriptionId, status };
}
const eventTrigger = (eventSequence = 1, subscriptionId = 1) => ({ kind: 'event', eventSequence, subscriptionId });
const completedTrigger = (completionSequence = 1, subscriptionId = 1) => ({ kind: 'completed', completionSequence, subscriptionId });
function eventObserved(status) {
  const plan = fixture(), observer = createProjectRuntimeObservation(plan, { protocolVersion: 10 });
  const frames = [...completionStart(plan).map(p10), entry(plan, { trigger: { kind: 'initial' } }),
    publication(plan), entry(plan, { sequence: 2, stateIndex: 1, trigger: eventTrigger() })];
  if (status) frames.push(delivery(plan, 1, 1, status));
  for (const frame of frames) assert.equal(observer.push(frame), true, JSON.stringify(frame));
  return observer.snapshot();
}

test('protocol10 retains explicit initialization and direct entries without inventing delivery evidence', () => {
  const { plan, reader } = running();
  assert.equal(push(reader, [entry(plan, { trigger: { kind: 'initial' } }), entry(plan, { sequence: 2 })]).length, 2);
  assert.deepEqual(reader.animationStateEntries.entries.map(row => row.trigger), [{ kind: 'initial' }, { kind: 'direct' }]);
  assert.equal(reader.animationCommands.sequence, 0);
  const snapshot = validateProjectAnimationStateTriggeredEntriesSnapshot(reader.animationStateEntries);
  snapshot.entries[0].trigger.kind = 'direct'; assert.equal(reader.animationStateEntries.entries[0].trigger.kind, 'initial');
});
for (const trigger of [null, {}, { kind: 'unknown' }, { kind: 'initial', sequence: 1 }, { kind: 'direct', subscriptionId: 1 },
  { kind: 'event', eventSequence: 1 }, { kind: 'event', eventSequence: 0, subscriptionId: 1 },
  { kind: 'event', eventSequence: 129, subscriptionId: 1 }, { kind: 'event', eventSequence: 1, subscriptionId: 1025 },
  { kind: 'event', eventSequence: 1, subscriptionId: 1, completionSequence: 1 },
  { kind: 'completed', completionSequence: 321, subscriptionId: 1 }]) test(`reject malformed trigger atomically ${JSON.stringify(trigger)}`, () => {
  const { plan, reader } = running(), frame = entry(plan); frame.trigger = trigger;
  reject(reader, frame); assert.equal(push(reader, [entry(plan)]).length, 1);
});
test('protocol10 requires source while protocol9 keeps exact legacy entry fields', () => {
  const { plan, reader } = running(), missing = entry(plan); delete missing.trigger; reject(reader, missing);
  const old = createProjectRuntimeEventReader(plan, { protocolVersion: 9 });
  assert.equal(push(old, completionStart(plan).map(p10).map(frame => ({ ...frame, protocol: 9 }))).length, 3);
  assert.equal(push(old, [{ ...entry(plan), protocol: 9 }]).length, 0);
  assert.equal(push(old, [{ ...missing, protocol: 9 }]).length, 1);
  assert.throws(() => validateProjectAnimationStateTriggeredEntriesSnapshot(old.animationStateEntries));
  assert.throws(() => validateProjectAnimationStateEntriesSnapshot(eventObserved().project.animationStateEntries));
});
test('event source requires the actual first pending recipient and is single-use', () => {
  const { plan, reader } = running();
  reject(reader, entry(plan, { trigger: eventTrigger() }));
  assert.equal(push(reader, [publication(plan, 1, [1, 2]), publication(plan, 2, [1])]).length, 2);
  reject(reader, entry(plan, { trigger: eventTrigger(2) }));
  reject(reader, entry(plan, { trigger: eventTrigger(1, 2) }));
  assert.equal(push(reader, [entry(plan, { trigger: eventTrigger() })]).length, 1);
  reject(reader, entry(plan, { sequence: 2, trigger: eventTrigger() }));
  reject(reader, delivery(plan, 1, 1, 'skipped'));
  assert.equal(push(reader, [delivery(plan), entry(plan, { sequence: 2, trigger: eventTrigger(1, 2) }), delivery(plan, 1, 2),
    entry(plan, { sequence: 3, trigger: eventTrigger(2) }), delivery(plan, 2)]).length, 5);
  assert.equal(reader.animationStateEntries.sequence, 3);
});
test('handled or skipped recipients cannot retrospectively explain an entry', () => {
  for (const status of ['handled', 'skipped']) {
    const { plan, reader } = running();
    push(reader, [publication(plan), delivery(plan, 1, 1, status)]);
    reject(reader, entry(plan, { trigger: eventTrigger() }));
    assert.equal(push(reader, [entry(plan)]).length, 1);
  }
});
test('callback source cannot be borrowed from another binding sharing the same author script', () => {
  const plan = fixture(), scene = plan.scenes[0], second = clone(scene.behaviors.bindings[0]);
  second.bindingId = runtimeId(888); second.declaration.propertyPath = '/bindings/1'; scene.behaviors.bindings.push(second);
  const { reader } = running(plan); push(reader, [publication(plan)]);
  reject(reader, entry(plan, { bindingIndex: 1, trigger: eventTrigger() }));
  assert.equal(push(reader, [entry(plan, { trigger: eventTrigger() })]).length, 1);
});
test('completion source checks queue identity and the exact completed clock and command boundary', () => {
  const { plan, scene, reader } = running(), duration = scene.animation.document.durationSeconds;
  push(reader, [p10(animationCompleted(scene, 1, 1, 0, duration, null, [1, 2]))]);
  reject(reader, entry(plan, { timeSeconds: duration, trigger: completedTrigger(1, 2) }));
  reject(reader, entry(plan, { timeSeconds: duration + .1, trigger: completedTrigger() }));
  reject(reader, entry(plan, { timeSeconds: duration, commandSequence: 1, trigger: completedTrigger() }));
  assert.equal(push(reader, [entry(plan, { timeSeconds: duration, trigger: completedTrigger() })]).length, 1);
  reject(reader, p10(completionDelivery(scene, 1, 1, 1, 'skipped')));
  assert.equal(push(reader, [p10(completionDelivery(scene, 1, 1))]).length, 1);
});
test('p10 query and review retain pending evidence then handled evidence without changing older models', () => {
  const pending = eventObserved(), model = createProjectAnimationStateReview(pending), selected = queryProjectAnimationStateReview(model, 2);
  assert.equal(queryProjectRuntimeObservation(pending).project.protocolVersion, 10);
  assert.equal(selected.triggerEvidence.kind, 'event'); assert.equal(selected.triggerEvidence.event.value, false);
  assert.equal(selected.triggerEvidence.delivery.status, 'pending');
  assert.equal(queryProjectAnimationStateReview(model, 1).triggerEvidence, null);
  const later = queryProjectAnimationStateReview(createProjectAnimationStateReview(eventObserved('handled')), 2);
  assert.equal(later.triggerEvidence.delivery.status, 'handled'); assert.equal(selected.triggerEvidence.delivery.status, 'pending');
  pending.project.events.entries[0].name = 'changed'; assert.equal(selected.triggerEvidence.event.name, 'action');
  assert.equal(Object.isFrozen(selected.triggerEvidence.delivery.origin.source), true);
});
for (const change of [view => view.project.animationStateEntries.entries[1].trigger.eventSequence = 2,
  view => view.project.animationStateEntries.entries[1].trigger.subscriptionId = 2,
  view => view.project.events.entries[0].deliveries[0].status = 'skipped',
  view => view.project.animationStateEntries.entries[1].origin.bindingId = runtimeId(999),
  view => view.project.events.entries[0].deliveries[0].origin.source.sourceRevision = 'sha256:' + '9'.repeat(64),
  view => view.project.animationStateEntries.entries[1].origin.visitIndex = 2]) test('p10 full observation rejects contradictory trigger provenance', () => {
  const view = eventObserved(); change(view); assert.throws(() => queryProjectRuntimeObservation(view));
});
test('trigger DTO validation rejects executable descriptors without invoking them', () => {
  let called = 0; const view = eventObserved(), value = view.project.animationStateEntries;
  Object.defineProperty(value.entries[1].trigger, 'eventSequence', { enumerable: true, get() { called++; return 1; } });
  assert.throws(() => validateProjectAnimationStateTriggeredEntriesSnapshot(value)); assert.equal(called, 0);
});

test('protocol10 descriptor requires trigger capability without changing protocol9 requirements', () => {
  const plan = fixture(), descriptor = { format: 'viento-execution-backend', schemaVersion: 1,
    id: 'org.viento.godot4', label: 'Godot 4', version: '0.19.0', platforms: ['linux'],
    plans: [{ kind: 'scene2d', schemaVersion: 3, runtimeProtocolVersion: 3 }, { kind: 'project', schemaVersion: 1, runtimeProtocolVersion: 10 }],
    capabilities: [...plan.requiredCapabilities, 'behavior.bindings', 'behavior.gdscript', 'project.animation-control',
      'project.animation-completion', 'project.animation-state-snapshots', 'project.animation-state-entries'],
    execution: { build: true, headlessLogic: true, windowPreview: true, windowCapture: true, offscreenRender: false, embeddedViewport: false, gpuCompute: false }, extensions: [] };
  assert.equal(validateExecutionBackendDescriptor(descriptor).plans[1].runtimeProtocolVersion, 10);
  assert.deepEqual(checkExecutionBackendSupport(descriptor, { operation: 'build', plan }).map(item => item.capability), ['project.animation-state-entry-triggers']);
  descriptor.capabilities.push('project.animation-state-entry-triggers');
  assert.deepEqual(checkExecutionBackendSupport(descriptor, { operation: 'build', plan }), []);
  descriptor.plans[1].runtimeProtocolVersion = 12; assert.throws(() => validateExecutionBackendDescriptor(descriptor));
});
test('trigger snapshot enforces duplicate callback keys and entry limit while direct re-entry stays legal', () => {
  const view = eventObserved(), snapshot = clone(view.project.animationStateEntries);
  snapshot.entries.push({ ...clone(snapshot.entries[1]), sequence: 3 }); snapshot.sequence = 3;
  assert.throws(() => validateProjectAnimationStateTriggeredEntriesSnapshot(snapshot));
  const { plan, reader } = running();
  for (let sequence = 1; sequence <= 128; sequence++) assert.equal(push(reader, [entry(plan, { sequence })]).length, 1);
  const admitted = reader.animationStateEntries;
  assert.equal(validateProjectAnimationStateTriggeredEntriesSnapshot(admitted).sequence, 128);
  reject(reader, entry(plan, { sequence: 129 })); assert.deepEqual(reader.animationStateEntries, admitted);
});
test('completed trigger evidence stays visible in read-only review and rejects a later source clock', () => {
  const plan = fixture(), scene = plan.scenes[0], duration = scene.animation.document.durationSeconds;
  const observer = createProjectRuntimeObservation(plan, { protocolVersion: 10 });
  for (const frame of [...completionStart(plan).map(p10), p10(animationCompleted(scene, 1, 1, 0, duration)),
    entry(plan, { timeSeconds: duration, trigger: completedTrigger() }), p10(completionDelivery(scene, 1, 1))]) assert.equal(observer.push(frame), true);
  const view = observer.snapshot(), selected = queryProjectAnimationStateReview(createProjectAnimationStateReview(view), 1);
  assert.equal(selected.triggerEvidence.kind, 'completed'); assert.equal(selected.triggerEvidence.completion.sequence, 1);
  assert.equal(selected.triggerEvidence.delivery.status, 'handled');
  view.project.animationStateEntries.entries[0].timeSeconds += .1;
  assert.throws(() => queryProjectRuntimeObservation(view));
});

for (const target of ['message', 'recipient']) test(`query rejects source moved beyond current pending ${target}`, () => {
  const plan = fixture(), observer = createProjectRuntimeObservation(plan, { protocolVersion: 10 });
  const frames = [...completionStart(plan).map(p10), publication(plan, 1, target === 'recipient' ? [1, 2] : [1])];
  if (target === 'message') frames.push(publication(plan, 2));
  frames.push(entry(plan, { trigger: eventTrigger() }));
  for (const frame of frames) assert.equal(observer.push(frame), true);
  const view = observer.snapshot(); assert.doesNotThrow(() => queryProjectRuntimeObservation(view));
  if (target === 'message') view.project.animationStateEntries.entries[0].trigger.eventSequence = 2;
  else view.project.animationStateEntries.entries[0].trigger.subscriptionId = 2;
  assert.throws(() => queryProjectRuntimeObservation(view));
});
test('query rejects completion source moved beyond the pending recipient', () => {
  const plan = fixture(), scene = plan.scenes[0], duration = scene.animation.document.durationSeconds;
  const observer = createProjectRuntimeObservation(plan, { protocolVersion: 10 });
  for (const frame of [...completionStart(plan).map(p10), p10(animationCompleted(scene, 1, 1, 0, duration, null, [1, 2])),
    entry(plan, { timeSeconds: duration, trigger: completedTrigger() })]) assert.equal(observer.push(frame), true);
  const view = observer.snapshot(); assert.doesNotThrow(() => queryProjectRuntimeObservation(view));
  view.project.animationStateEntries.entries[0].trigger.subscriptionId = 2;
  assert.throws(() => queryProjectRuntimeObservation(view));
});

test('queued event recipient cannot explain an entry after its subscription was retired', () => {
  const { plan, reader } = running();
  assert.equal(push(reader, [publication(plan), publication(plan, 2), delivery(plan, 1, 1, 'skipped')]).length, 3);
  reject(reader, entry(plan, { trigger: eventTrigger(2) }));
  assert.equal(push(reader, [entry(plan), delivery(plan, 2, 1, 'skipped')]).length, 2);
});
test('query rejects a pending event source if an earlier message retired the same subscription', () => {
  const plan = fixture(), observer = createProjectRuntimeObservation(plan, { protocolVersion: 10 });
  for (const frame of [...completionStart(plan).map(p10), publication(plan), publication(plan, 2), delivery(plan),
    entry(plan, { trigger: eventTrigger(2) })]) assert.equal(observer.push(frame), true);
  const view = observer.snapshot(); assert.doesNotThrow(() => queryProjectRuntimeObservation(view));
  view.project.events.entries[0].deliveries[0].status = 'skipped';
  assert.throws(() => queryProjectRuntimeObservation(view));
});
