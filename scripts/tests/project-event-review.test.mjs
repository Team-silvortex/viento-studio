import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createProjectEventReview, queryProjectEventReview } from '../../engine/project-event-review.mjs';
import { createProjectRuntimeObservation, queryProjectRuntimeObservation } from '../../engine/project-runtime-query.mjs';
import { createProjectAnimationStateCatalog } from '../../engine/project-animation-states.mjs';
import { generateEditableGodotAnimationStateScript } from '../../engine/animation-state-script-source.mjs';
import { DEFAULT_ANIMATION_STATE_TABLE } from '../../engine/godot-animation-state-script.mjs';
import { completionProject, completionStart, animationCompleted, completionDelivery } from './helpers/project-animation-completion-fixture.mjs';
import { runtimeId, enterScene, readyScene, exitScene } from './helpers/project-runtime-fixture.mjs';

const clone = value => structuredClone(value), invalid = { errorCode: 'project_event_review_invalid' };
function fixture(protocolVersion = 10) {
  const plan = completionProject(), scene = plan.scenes[0];
  scene.behaviors.sources[0].content = generateEditableGodotAnimationStateScript(DEFAULT_ANIMATION_STATE_TABLE).content;
  scene.behaviors.bindings[0].parameters = {};
  const second = clone(scene.behaviors.bindings[0]);
  second.bindingId = runtimeId(888); second.declaration.propertyPath = '/bindings/1'; scene.behaviors.bindings.push(second);
  const controllers = createProjectAnimationStateCatalog(plan).scenes[0].controllers;
  const observer = createProjectRuntimeObservation(plan, { protocolVersion });
  const frame = input => {
    const result = { ...input, protocol: protocolVersion };
    if (['ready', 'finished'].includes(result.event)) for (const [field, version] of [
      ['stateRevision', 2], ['eventSequence', 3], ['audioCommandSequence', 4], ['animationCommandSequence', 5],
      ['animationCompletionSequence', 7], ['animationStateSequence', 8], ['animationStateEntrySequence', 9],
    ]) {
      if (protocolVersion >= version) result[field] ??= 0;
      else delete result[field];
    }
    return result;
  };
  const push = (...frames) => { for (const value of frames) assert.equal(observer.push(frame(value)), true, JSON.stringify(value)); };
  const binding = index => {
    const { bindingId, instanceId, objectId } = controllers[index]; return { bindingId, instanceId, objectId };
  };
  const publication = (sequence, { visitIndex = 1, name = 'action', value = false, recipients = [[1, 0]], publisher = 0 } = {}) => ({
    event: 'event-publish', visitIndex, sceneId: scene.scene.objectId, ...binding(publisher), sequence, name, value,
    recipients: recipients.map(([subscriptionId, index]) => ({ subscriptionId, ...binding(index) })),
  });
  const delivery = (sequence, subscriptionId = 1, status = 'handled', visitIndex = 1) => ({
    event: 'event-delivery', visitIndex, sceneId: scene.scene.objectId, sequence, subscriptionId, status,
  });
  const entry = (sequence, trigger = { kind: 'direct' }, { bindingIndex = 0, stateIndex = 0, visitIndex = 1, timeSeconds = 0 } = {}) => ({
    event: 'animation-state-entered', sequence, visitIndex, sceneId: scene.scene.objectId, timeSeconds, commandSequence: 0,
    ...binding(bindingIndex), stateIndex, clipId: controllers[bindingIndex].clips[stateIndex], ...(protocolVersion === 10 ? { trigger } : {}),
  });
  const terminal = () => ({ event: 'animation-state-snapshot', sequence: 1, visitIndex: 1, sceneId: scene.scene.objectId,
    timeSeconds: 0, commandSequence: 0, reason: 'switch', controllers: controllers.map((_, index) => ({
      ...binding(index), status: 'inactive', stateIndex: -1, clipId: null,
    })) });
  push(...completionStart(plan));
  return { plan, scene, controllers, observer, push, publication, delivery, entry, terminal, view: () => observer.snapshot() };
}
const eventTrigger = (eventSequence = 1, subscriptionId = 1) => ({ kind: 'event', eventSequence, subscriptionId });
function recorded() {
  const f = fixture(); f.push(f.publication(1), f.entry(1, eventTrigger())); return f;
}
function deepFrozen(value) {
  if (value && typeof value === 'object') {
    assert.equal(Object.isFrozen(value), true); for (const child of Object.values(value)) deepFrozen(child);
  }
}

test('event review admits complete observations into a detached branded frozen model', () => {
  const f = recorded(), input = f.view(), before = clone(input), model = createProjectEventReview(input);
  assert.deepEqual(Object.keys(model), ['protocolVersion', 'entries']); assert.equal(model.protocolVersion, 10);
  assert.deepEqual(model.entries, input.project.events.entries); assert.deepEqual(input, before); deepFrozen(model);
  assert.deepEqual(createProjectEventReview(queryProjectRuntimeObservation(input)), model);
  const review = queryProjectEventReview(model, 1);
  assert.deepEqual(Object.keys(review), ['event', 'deliveries']); assert.deepEqual(Object.keys(review.deliveries[0]), ['delivery', 'animation']);
  assert.deepEqual(review.event, input.project.events.entries[0]);
  assert.deepEqual(review.deliveries[0].delivery, review.event.deliveries[0]);
  assert.deepEqual(review.deliveries[0].animation, { status: 'recorded', entry: input.project.animationStateEntries.entries[0] });
  deepFrozen(review);
  assert.throws(() => createProjectEventReview({ project: input.project }), invalid);
});

test('pending delivery can already have an accepted entry and later handled receipts leave older models unchanged', () => {
  const f = fixture(); f.push(f.publication(1));
  const beforeEntry = createProjectEventReview(f.view());
  assert.deepEqual(queryProjectEventReview(beforeEntry, 1).deliveries[0].animation, { status: 'not-recorded' });
  f.push(f.entry(1, eventTrigger())); const pending = createProjectEventReview(f.view());
  f.push(f.delivery(1)); const handled = createProjectEventReview(f.view());
  assert.equal(queryProjectEventReview(pending, 1).deliveries[0].delivery.status, 'pending');
  assert.equal(queryProjectEventReview(handled, 1).deliveries[0].delivery.status, 'handled');
  assert.deepEqual(queryProjectEventReview(handled, 1).deliveries[0].animation, queryProjectEventReview(pending, 1).deliveries[0].animation);
  assert.deepEqual(queryProjectEventReview(beforeEntry, 1).deliveries[0].animation, { status: 'not-recorded' });
});

test('same named events and recipients sharing a script are joined by exact publication and subscription identities', () => {
  const f = fixture(); f.push(f.publication(1, { recipients: [[1, 0], [2, 1]], publisher: 1 }),
    f.entry(1, eventTrigger()), f.delivery(1), f.entry(2, eventTrigger(1, 2), { bindingIndex: 1 }), f.delivery(1, 2),
    f.publication(2), f.entry(3, eventTrigger(2)), f.delivery(2));
  const model = createProjectEventReview(f.view()), first = queryProjectEventReview(model, 1), second = queryProjectEventReview(model, 2);
  assert.equal(first.event.name, second.event.name);
  assert.deepEqual(first.deliveries.map(row => row.animation.entry.sequence), [1, 2]);
  assert.deepEqual(second.deliveries.map(row => row.animation.entry.sequence), [3]);
  assert.equal(first.deliveries[0].animation.entry.scriptSource.objectId, first.deliveries[1].animation.entry.scriptSource.objectId);
  assert.notEqual(first.deliveries[0].delivery.origin.bindingId, first.deliveries[1].delivery.origin.bindingId);
  assert.notEqual(first.event.origin.bindingId, first.deliveries[0].delivery.origin.bindingId);
  assert.equal(first.deliveries[0].animation.entry.origin.source.propertyPath, '/bindings/0');
  assert.equal(first.deliveries[1].animation.entry.origin.source.propertyPath, '/bindings/1');
});

test('no-entry results keep handled skipped and pending statuses without inventing an explanation', () => {
  const f = fixture(); f.push(f.publication(1, { recipients: [[1, 0], [2, 1]] }), f.delivery(1), f.delivery(1, 2, 'skipped'),
    f.publication(2, { recipients: [[3, 0]] }), f.publication(3, { recipients: [] }));
  const model = createProjectEventReview(f.view()), first = queryProjectEventReview(model, 1), next = queryProjectEventReview(model, 2);
  assert.deepEqual(first.deliveries.map(row => row.delivery.status), ['handled', 'skipped']);
  assert.equal(next.deliveries[0].delivery.status, 'pending');
  for (const row of [...first.deliveries, ...next.deliveries]) assert.deepEqual(row.animation, { status: 'not-recorded' });
  assert.deepEqual(queryProjectEventReview(model, 3).deliveries, []);
});

test('initial direct and completion entries do not become event associations even at matching times and bindings', () => {
  const f = fixture(), seconds = f.scene.animation.document.durationSeconds;
  f.push(f.entry(1, { kind: 'initial' }), f.entry(2), f.publication(1), f.delivery(1),
    animationCompleted(f.scene, 1, 1, 0, seconds),
    f.entry(3, { kind: 'completed', completionSequence: 1, subscriptionId: 1 }, { timeSeconds: seconds }),
    completionDelivery(f.scene, 1, 1));
  const review = queryProjectEventReview(createProjectEventReview(f.view()), 1);
  assert.deepEqual(review.deliveries[0].animation, { status: 'not-recorded' });
  assert.equal(review.deliveries[0].delivery.status, 'handled');
});

test('returning to a scene keeps repeated bindings and event names in their original visits', () => {
  const f = recorded(), other = f.plan.scenes[1];
  f.push(f.delivery(1), f.terminal(), exitScene(f.scene, 1, 0, other), enterScene(other, 2), readyScene(other, 2),
    exitScene(other, 2, 0, f.scene), enterScene(f.scene, 3), readyScene(f.scene, 3),
    f.publication(2, { visitIndex: 3, recipients: [[3, 0]] }), f.entry(2, eventTrigger(2, 3), { visitIndex: 3 }), f.delivery(2, 3, 'handled', 3));
  const model = createProjectEventReview(f.view()), first = queryProjectEventReview(model, 1), second = queryProjectEventReview(model, 2);
  assert.equal(first.event.name, second.event.name); assert.equal(first.event.origin.bindingId, second.event.origin.bindingId);
  assert.equal(first.deliveries[0].animation.entry.origin.visitIndex, 1);
  assert.equal(second.deliveries[0].animation.entry.origin.visitIndex, 3);
  assert.equal(first.deliveries[0].animation.entry.sequence, 1); assert.equal(second.deliveries[0].animation.entry.sequence, 2);
});

for (const protocolVersion of [3, 4, 5, 6, 7, 8, 9]) test(`protocol ${protocolVersion} retains delivery evidence while explicitly lacking callback associations`, () => {
  const f = fixture(protocolVersion); f.push(f.publication(1), f.delivery(1));
  if (protocolVersion === 9) f.push(f.entry(1));
  const model = createProjectEventReview(f.view()), review = queryProjectEventReview(model, 1);
  assert.equal(model.protocolVersion, protocolVersion); assert.equal(review.deliveries[0].delivery.status, 'handled');
  assert.deepEqual(review.deliveries[0].animation, { status: 'unavailable-protocol' });
});

test('unsupported protocols and partial snapshots cannot masquerade as unavailable event association evidence', () => {
  for (const protocolVersion of [1, 2]) assert.throws(() => createProjectEventReview(fixture(protocolVersion).view()), invalid);
  const view = recorded().view(); view.project.protocolVersion = 12;
  assert.throws(() => createProjectEventReview(view), invalid);
  for (const input of [undefined, null, [], {}, recorded().view().project.events]) assert.throws(() => createProjectEventReview(input), invalid);
});

test('empty histories and absent positive selections return null while invalid selectors and forged models fail', () => {
  const empty = createProjectEventReview(fixture().view()), model = createProjectEventReview(recorded().view());
  assert.equal(queryProjectEventReview(empty, 1), null);
  assert.equal(queryProjectEventReview(model, 129), null); assert.equal(queryProjectEventReview(model, Number.MAX_SAFE_INTEGER), null);
  for (const sequence of [0, -1, .5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '1', null, undefined, true, {}, [], { sequence: 1 }]) {
    assert.throws(() => queryProjectEventReview(model, sequence), invalid);
  }
  for (const fake of [null, undefined, {}, { entries: model.entries, protocolVersion: 10 }, clone(model), Object.freeze(clone(model)), 1, 'model']) {
    assert.throws(() => queryProjectEventReview(fake, 1), invalid);
  }
});

test('caller changes cannot redirect publisher recipient or recorded author provenance', () => {
  const f = recorded(), input = f.view(), before = clone(input), model = createProjectEventReview(input);
  input.project.events.entries[0].value = 'edited'; input.project.events.entries[0].origin.source.sourcePath = 'edited.json';
  input.project.events.entries[0].deliveries[0].origin.source.sourcePath = 'edited-recipient.json';
  input.project.animationStateEntries.entries[0].scriptSource.sourcePath = 'edited.gd';
  const review = queryProjectEventReview(model, 1);
  assert.deepEqual(review.event, before.project.events.entries[0]);
  assert.deepEqual(review.deliveries[0].animation.entry, before.project.animationStateEntries.entries[0]);
  assert.throws(() => { model.entries.pop(); }, TypeError);
  assert.throws(() => { review.deliveries[0].animation.status = 'not-recorded'; }, TypeError);
});

test('admission and selectors reject executable properties without evaluating getters or conversion hooks', () => {
  let called = 0; const original = recorded().view();
  for (const install of [
    value => Object.defineProperty(value, 'project', { enumerable: true, get() { called++; return original.project; } }),
    value => Object.defineProperty(value.project, 'protocolVersion', { enumerable: true, get() { called++; return 10; } }),
    value => Object.defineProperty(value.project.events.entries[0], 'value', { enumerable: true, get() { called++; return true; } }),
    value => Object.defineProperty(value.project.events.entries[0].deliveries[0], 'status', { enumerable: true, get() { called++; return 'pending'; } }),
    value => Object.defineProperty(value.project.animationStateEntries.entries[0].trigger, 'eventSequence', { enumerable: true, get() { called++; return 1; } }),
    value => { value.project.events.toJSON = () => { called++; return {}; }; },
  ]) {
    const bad = clone(original); install(bad); assert.throws(() => createProjectEventReview(bad), invalid);
  }
  const fake = {}; Object.defineProperty(fake, 'entries', { get() { called++; return []; } });
  assert.throws(() => queryProjectEventReview(fake, 1), invalid);
  const model = createProjectEventReview(original), selector = { valueOf() { called++; return 1; }, toString() { called++; return '1'; } };
  assert.throws(() => queryProjectEventReview(model, selector), invalid); assert.equal(called, 0);
});

for (const [label, mutate] of [
  ['unknown trigger kind', view => view.project.animationStateEntries.entries[0].trigger.kind = 'guessed'],
  ['unknown trigger property', view => view.project.animationStateEntries.entries[0].trigger.branch = 0],
  ['missing p10 trigger', view => { delete view.project.animationStateEntries.entries[0].trigger; }],
  ['different recipient binding', view => view.project.animationStateEntries.entries[0].origin.bindingId = runtimeId(999)],
  ['different recipient source', view => view.project.events.entries[0].deliveries[0].origin.source.sourceRevision = 'sha256:' + '9'.repeat(64)],
  ['different visit', view => view.project.animationStateEntries.entries[0].origin.visitIndex = 3],
  ['entry paired with skipped recipient', view => view.project.events.entries[0].deliveries[0].status = 'skipped'],
  ['duplicate callback entry', view => { const entries = view.project.animationStateEntries; entries.entries.push({ ...clone(entries.entries[0]), sequence: 2 }); entries.sequence = 2; }],
  ['malformed unrelated shared state', view => view.project.sharedState.revision = 1],
]) test(`full admission rejects ${label} rather than filtering to an apparently valid association`, () => {
  const view = recorded().view(); mutate(view); assert.throws(() => createProjectEventReview(view), invalid);
});

test('later pending callbacks and retired subscriptions cannot be selected as recorded event sources', () => {
  const f = fixture(); f.push(f.publication(1, { recipients: [[1, 0], [2, 0]] }), f.publication(2), f.entry(1, eventTrigger()));
  for (const field of ['eventSequence', 'subscriptionId']) {
    const view = f.view(); view.project.animationStateEntries.entries[0].trigger[field] = 2;
    assert.throws(() => createProjectEventReview(view), invalid);
  }
  const g = fixture(); g.push(g.publication(1), g.publication(2), g.delivery(1), g.entry(1, eventTrigger(2)));
  const retired = g.view(); retired.project.events.entries[0].deliveries[0].status = 'skipped';
  assert.throws(() => createProjectEventReview(retired), invalid);
});

test('bounded maximum event history preserves each explicit association without aggregating repeated names', () => {
  const f = fixture();
  for (let sequence = 1; sequence <= 128; sequence++) {
    f.push(f.publication(sequence, { recipients: Array.from({ length: 8 }, (_, index) => [index + 1, 0]) }), f.entry(sequence, eventTrigger(sequence)));
    for (let subscriptionId = 1; subscriptionId <= 8; subscriptionId++) f.push(f.delivery(sequence, subscriptionId));
  }
  const model = createProjectEventReview(f.view()); assert.equal(model.entries.length, 128);
  for (const sequence of [1, 64, 128]) {
    const review = queryProjectEventReview(model, sequence); assert.equal(review.deliveries.length, 8);
    assert.equal(review.deliveries[0].animation.entry.sequence, sequence);
    assert.deepEqual(review.deliveries.slice(1).map(row => row.animation.status), Array(7).fill('not-recorded'));
  }
});
