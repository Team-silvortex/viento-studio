import test from 'node:test';
import assert from 'node:assert/strict';
import { createProjectEventBus } from '../../engine/project-event-bus.mjs';
import { copyProjectRuntimeData, copyProjectEventSnapshotData } from '../../engine/project-runtime-contracts.mjs';
import { querySceneRuntimeObservation } from '../../engine/scene-runtime-query.mjs';
import { createProjectRuntimeEventReader } from '../../engine/project-runtime-events.mjs';
import { createProjectRuntimeObservation, queryProjectRuntimeObservation } from '../../engine/project-runtime-query.mjs';
import { runtimeProject, runtimeId, enterScene, readyScene, exitScene, projectLine, returnTrip } from './helpers/project-runtime-fixture.mjs';
import { sharedReady, stateFrame } from './helpers/project-shared-state-fixture.mjs';
import { eventProject, eventOrigin, eventFrame, eventReady, eventFinished, eventRecipient, publication, delivery, eventReturnTrip } from './helpers/project-event-bus-fixture.mjs';
const push = (reader, frames) => reader.push(frames.map(projectLine).join(''));
const apply = (observer, frames) => frames.forEach(frame => assert.equal(observer.push(frame), true, JSON.stringify(frame)));
function running(plan = eventProject()) {
  const [a, b] = plan.scenes, reader = createProjectRuntimeEventReader(plan, { protocolVersion: 3 });
  push(reader, [eventReady(plan), eventFrame(enterScene(a, 1)), eventFrame(readyScene(a, 1))]); return { plan, a, b, reader };
}
function reject(reader, frame) {
  const before = reader.projectEvents, state = reader.sharedState, count = reader.events.length, diagnostics = reader.diagnostics.length;
  assert.deepEqual(push(reader, [frame]), []); assert.deepEqual(reader.projectEvents, before); assert.deepEqual(reader.sharedState, state);
  assert.equal(reader.events.length, count); assert.equal(reader.diagnostics.length, diagnostics + 1);
}

test('protocol 3 A→B→A preserves messages, shared state and original binding sources with complete FIFO receipts', () => {
  const plan = eventProject(), frames = eventReturnTrip(plan), reader = createProjectRuntimeEventReader(plan, { protocolVersion: 3, expectedTotalSeconds: 0.5 });
  assert.equal(push(reader, frames).length, frames.length); assert.deepEqual(reader.finish().diagnostics, []);
  assert.equal(reader.projectEvents.sequence, 4); assert.equal(reader.sharedState.revision, 1);
  assert.deepEqual(reader.projectEvents.entries.map(entry => entry.deliveries.map(row => row.status)), [['handled'], ['skipped'], ['handled'], []]);
  assert.deepEqual(reader.projectEvents.entries[2].origin, eventOrigin(plan.scenes[1], 2));
});

test('protocol 3 is selected explicitly while protocol 1 and 2 reject message frames and new lifecycle keys', () => {
  const plan = eventProject(), a = plan.scenes[0];
  for (const protocolVersion of [1, 2]) {
    const reader = createProjectRuntimeEventReader(plan, { protocolVersion });
    assert.equal(Object.hasOwn(reader, 'projectEvents'), false); assert.deepEqual(push(reader, [{ ...eventReady(plan), protocol: protocolVersion }]), []);
    assert.deepEqual(push(reader, [{ ...publication(a, 1, 1, 'name', true), protocol: protocolVersion }]), []);
    assert.equal(Object.hasOwn(createProjectRuntimeObservation(plan, { protocolVersion }).snapshot().project, 'events'), false);
  }
  const reader = createProjectRuntimeEventReader(plan, { protocolVersion: 3 });
  reject(reader, sharedReady(plan)); reject(reader, { ...eventReady(plan), eventSequence: 1 });
  const missing = eventReady(plan); delete missing.eventSequence; reject(reader, missing);
  assert.equal(push(reader, [eventReady(plan)]).length, 1);
});

test('publish and receipt require the current ready visit and exact source-free wire fields', () => {
  const plan = eventProject(), a = plan.scenes[0], reader = createProjectRuntimeEventReader(plan, { protocolVersion: 3 });
  const frame = publication(a, 1, 1, 'name', true); reject(reader, frame); push(reader, [eventReady(plan), eventFrame(enterScene(a, 1))]); reject(reader, frame);
  push(reader, [eventFrame(readyScene(a, 1))]);
  for (const invalid of [{ ...frame, origin: eventOrigin(a) }, { ...frame, sourcePath: 'fake.json' }, { ...frame, bindingId: runtimeId(99) },
    { ...frame, objectId: runtimeId(99) }, { ...frame, visitIndex: 2 }, { ...frame, recipients: [{ ...frame.recipients[0], source: eventOrigin(a).source }] },
    { ...frame, recipients: [{ ...frame.recipients[0], bindingId: runtimeId(99) }] }]) reject(reader, invalid);
  push(reader, [frame]); reject(reader, { ...delivery(a, 1, 1, 1), bindingId: frame.bindingId });
  reject(reader, { ...delivery(a, 1, 1, 1), status: 'failed' }); push(reader, [delivery(a, 1, 1, 1)]);
});

test('recipient origin resolves its own binding declaration rather than copying the publisher source', () => {
  const plan = eventProject(), a = plan.scenes[0], binding = structuredClone(a.behaviors.bindings[0]);
  binding.bindingId = runtimeId(99); binding.instanceId = a.actors[1].instanceId; binding.declaration.propertyPath = '/bindings/1'; a.behaviors.bindings.push(binding);
  const { reader } = running(plan), recipient = { subscriptionId: 1, bindingId: binding.bindingId, instanceId: binding.instanceId, objectId: binding.objectId };
  push(reader, [publication(a, 1, 1, 'message', 'value', [recipient]), delivery(a, 1, 1, 1)]);
  const row = reader.projectEvents.entries[0]; assert.equal(row.origin.source.propertyPath, '/bindings/0');
  assert.equal(row.deliveries[0].origin.source.propertyPath, '/bindings/1'); assert.equal(row.deliveries[0].origin.bindingId, binding.bindingId);
  assert.equal(Object.hasOwn(reader.events.find(frame => frame.event === 'event-publish').recipients[0], 'source'), false);
});

test('new publications during a callback append behind the current message and earlier queued messages', () => {
  const { a, reader } = running();
  push(reader, [publication(a, 1, 1, 'signal', 1), publication(a, 1, 2, 'signal', 2), eventFrame(stateFrame(a, 1, 1, 'seen', true)), publication(a, 1, 3, 'signal', 3)]);
  reject(reader, delivery(a, 1, 3, 1)); push(reader, [delivery(a, 1, 1, 1)]); reject(reader, delivery(a, 1, 3, 1));
  push(reader, [delivery(a, 1, 2, 1), delivery(a, 1, 3, 1)]);
  assert.deepEqual(reader.projectEvents.entries.map(row => row.deliveries[0].status), ['handled', 'handled', 'handled']);
});

test('pending receipts prevent scene exit and finish, and final sequence must match every admitted publish', () => {
  const { plan, a, b, reader } = running(); push(reader, [publication(a, 1, 1, 'signal', true)]);
  reject(reader, eventFrame(exitScene(a, 1, 0.5, b))); reject(reader, eventFrame(exitScene(a, 1, 0.5))); reject(reader, eventFinished(plan, 1, 0.5, 0, 1));
  push(reader, [delivery(a, 1, 1, 1), eventFrame(exitScene(a, 1, 0.5))]); reject(reader, eventFinished(plan, 1, 0.5, 0, 0));
  const missing = eventFinished(plan, 1, 0.5, 0, 1); delete missing.eventSequence; reject(reader, missing);
  push(reader, [eventFinished(plan, 1, 0.5, 0, 1)]); assert.equal(reader.events.at(-1).event, 'finished'); reject(reader, publication(a, 1, 2, 'signal', false));
});

test('old tokens cannot be replayed in a later visit even when the actor and binding UUIDs repeat', () => {
  const plan = eventProject(), [a, b] = plan.scenes, reader = createProjectRuntimeEventReader(plan, { protocolVersion: 3 });
  push(reader, eventReturnTrip(plan).slice(0, 16));
  reject(reader, publication(a, 1, 4, 'door.open', true));
  reject(reader, publication(a, 3, 4, 'door.open', true, [eventRecipient(a, 1)]));
  push(reader, [publication(a, 3, 4, 'door.open', true, [eventRecipient(a, 3)]), delivery(a, 3, 4, 3)]);
  assert.equal(reader.projectEvents.entries.at(-1).origin.visitIndex, 3); assert.notEqual(a.scene.objectId, b.scene.objectId);
});

test('normal cancellation leaves an honest pending trace and does not manufacture receipts or completion', () => {
  const { a, reader } = running(); push(reader, [publication(a, 1, 1, 'signal', true)]);
  const result = reader.finish(); assert.deepEqual(result.diagnostics, []); assert.equal(result.events.at(-1).event, 'event-publish');
  assert.equal(reader.projectEvents.entries[0].deliveries[0].status, 'pending'); assert.deepEqual(push(reader, [delivery(a, 1, 1, 1)]), []);
});

test('observation query preserves complete trace and shared state while filtering only current actors', () => {
  const plan = eventProject(), observer = createProjectRuntimeObservation(plan, { protocolVersion: 3 });
  const initial = observer.snapshot(); assert.deepEqual(initial.project.events, { sequence: 0, entries: [] }); assert.deepEqual(queryProjectRuntimeObservation(initial), initial);
  apply(observer, eventReturnTrip(plan)); const view = observer.snapshot(), selected = queryProjectRuntimeObservation(view, { instanceId: plan.scenes[0].actors[0].instanceId });
  assert.equal(selected.actors.length, 1); assert.deepEqual(selected.project, view.project);
  assert.equal(selected.project.events.entries[2].origin.sceneId, plan.scenes[1].scene.objectId); assert.equal(selected.project.events.entries[2].origin.visitIndex, 2);
  selected.project.events.entries[0].origin.source.sourcePath = 'changed.json'; assert.deepEqual(observer.snapshot(), view);
});

test('query rejects pending old visits, forged origin histories, missing trace fields and unsafe data', () => {
  const plan = eventProject(), observer = createProjectRuntimeObservation(plan, { protocolVersion: 3 }); apply(observer, eventReturnTrip(plan));
  for (const mutate of [v => delete v.project.events, v => v.project.protocolVersion = 2, v => v.project.events.sequence = 5,
    v => v.project.events.entries[2].origin.sceneId = plan.entrySceneId,
    v => v.project.events.entries[0].deliveries[0].status = 'pending', v => v.project.events.entries[2].deliveries[0].origin.visitIndex = 3,
    v => v.project.events.entries[3].origin.visitIndex = 4, v => v.project.events.entries[0].value = [], v => v.project.events.extra = true]) {
    const view = observer.snapshot(); mutate(view); assert.throws(() => queryProjectRuntimeObservation(view), { errorCode: 'runtime_project_invalid' });
  }
  const view = observer.snapshot(); let called = 0; Object.defineProperty(view.project.events.entries[0], 'value', { enumerable: true, get() { called++; return true; } });
  assert.throws(() => queryProjectRuntimeObservation(view)); assert.equal(called, 0);
});

test('query accepts pending current-visit trace but observation refuses premature scene exit atomically', () => {
  const plan = eventProject(), a = plan.scenes[0], observer = createProjectRuntimeObservation(plan, { protocolVersion: 3 });
  apply(observer, [eventReady(plan), eventFrame(enterScene(a, 1)), eventFrame(readyScene(a, 1)), publication(a, 1, 1, 'signal', false)]);
  const before = observer.snapshot(); assert.deepEqual(queryProjectRuntimeObservation(before), before); assert.equal(observer.push(eventFrame(exitScene(a, 1, 0))), false);
  assert.deepEqual(observer.snapshot(), before);
  let called = 0; const forged = publication(a, 1, 2, 'signal', true); Object.defineProperty(forged, 'recipients', { enumerable: true, get() { called++; return []; } });
  assert.equal(observer.push(forged), false); assert.equal(called, 0); assert.deepEqual(observer.snapshot(), before);
});

test('project protocol 3 can retain a legacy child observation with empty event and state features', () => {
  const plan = runtimeProject({ legacy: true }), frames = returnTrip(plan).map(eventFrame); frames[0].stateRevision = 0; frames[0].eventSequence = 0;
  frames.at(-1).stateRevision = 0; frames.at(-1).eventSequence = 0;
  const observer = createProjectRuntimeObservation(plan, { protocolVersion: 3 }); apply(observer, frames);
  const result = queryProjectRuntimeObservation(observer.snapshot()); assert.equal(result.protocolVersion, 1); assert.equal(result.project.protocolVersion, 3);
  assert.deepEqual(result.project.events, { sequence: 0, entries: [] }); assert.deepEqual(result.project.sharedState, { revision: 0, entries: [], lastChange: null });
});

test('full 128-message and 1024-recipient trace with long frozen declarations remains queryable and detached', () => {
  const plan = eventProject(), a = plan.scenes[0], longPath = 'documents/' + 'b'.repeat(4070) + '.json';
  a.behaviors.manifest.sourcePath = longPath; a.behaviors.bindings[0].declaration.sourcePath = longPath;
  const observer = createProjectRuntimeObservation(plan, { protocolVersion: 3 });
  apply(observer, [eventReady(plan), eventFrame(enterScene(a, 1)), eventFrame(readyScene(a, 1))]);
  for (let sequence = 1; sequence <= 128; sequence++) {
    const recipients = sequence <= 16 ? Array.from({ length: 64 }, (_, index) => eventRecipient(a, index + 1)) : [];
    apply(observer, [publication(a, 1, sequence, 'A', 'x'.repeat(4095), recipients)]);
    for (const { subscriptionId } of recipients) apply(observer, [delivery(a, 1, sequence, subscriptionId)]);
  }
  apply(observer, [eventFrame(exitScene(a, 1, 0.5)), eventFinished(plan, 1, 0.5, 0, 128)]);
  const view = queryProjectRuntimeObservation(observer.snapshot()); assert.equal(view.project.events.sequence, 128);
  assert.equal(view.project.events.entries.reduce((count, entry) => count + entry.deliveries.length, 0), 1024);
  assert.equal(view.project.events.entries[15].deliveries[63].origin.source.sourcePath, longPath);
  view.project.events.entries[0].deliveries[0].origin.source.sourcePath = 'modified.json';
  assert.equal(observer.snapshot().project.events.entries[0].deliveries[0].origin.source.sourcePath, longPath);
});

test('protocol 3 queries admit the maximum independent origin contract alongside a large valid child observation', () => {
  const plan = eventProject(), a = plan.scenes[0], observer = createProjectRuntimeObservation(plan, { protocolVersion: 3 });
  apply(observer, [eventReady(plan), eventFrame(enterScene(a, 1)), eventFrame(readyScene(a, 1))]);
  const origin = eventOrigin(a), source = origin.source;
  source.sourcePath = 'd/' + 'x'.repeat(4094); source.propertyPath = '/' + 'p'.repeat(4095);
  source.sourceRange = { start: 0, end: 1, encoding: 'utf-16', exact: true, propertyPath: '/' + 'r'.repeat(4095) };
  const bus = createProjectEventBus();
  for (let sequence = 1; sequence <= 128; sequence++) {
    const recipients = sequence <= 16 ? Array.from({ length: 64 }, (_, index) => ({ subscriptionId: index + 1, origin })) : [];
    bus.publish({ sequence, name: 'A', value: 'x'.repeat(4095), origin, recipients });
    for (const { subscriptionId } of recipients) bus.deliver({ sequence, subscriptionId, status: 'handled', visitIndex: 1, sceneId: a.scene.objectId });
  }
  const view = observer.snapshot(); view.project.events = bus.snapshot();
  // Child provenance has its own established 4 MiB contract; the complete
  // project DTO must admit it together with all independently legal origins.
  const contributor = { ...source, role: 'definition' };
  for (const actor of view.actors) actor.source.contributors = Array.from({ length: 128 }, () => structuredClone(contributor));
  const { project, ...child } = view;
  assert.deepEqual(querySceneRuntimeObservation(child), child);
  assert.throws(() => copyProjectRuntimeData(view), { errorCode: 'runtime_project_invalid' });
  assert.throws(() => copyProjectEventSnapshotData(view), { errorCode: 'runtime_project_invalid' });
  const result = queryProjectRuntimeObservation(view); assert.deepEqual(result, view);
  result.project.events.entries[0].origin.source.sourceRange.propertyPath = '/changed';
  assert.equal(view.project.events.entries[0].origin.source.sourceRange.propertyPath.length, 4096);
});

test('a fully finished visit cannot retain even its only pending delivery', () => {
  const plan = eventProject(), a = plan.scenes[0], observer = createProjectRuntimeObservation(plan, { protocolVersion: 3 });
  apply(observer, [eventReady(plan), eventFrame(enterScene(a, 1)), eventFrame(readyScene(a, 1)),
    publication(a, 1, 1, 'signal', true), delivery(a, 1, 1, 1), eventFrame(exitScene(a, 1, 0.5)), eventFinished(plan, 1, 0.5, 0, 1)]);
  const view = observer.snapshot(); assert.equal(view.phase, 'finished'); assert.deepEqual(queryProjectRuntimeObservation(view), view);
  view.project.events.entries[0].deliveries[0].status = 'pending';
  assert.throws(() => queryProjectRuntimeObservation(view), { errorCode: 'runtime_project_invalid' });
});

test('observation budget selection never reads project or protocolVersion accessors', () => {
  const observer = createProjectRuntimeObservation(eventProject(), { protocolVersion: 3 }); let calls = 0;
  for (const place of ['project', 'protocolVersion']) {
    const view = observer.snapshot(), target = place === 'project' ? view : view.project;
    Object.defineProperty(target, place, { enumerable: true, get() { calls++; return place === 'project' ? observer.snapshot().project : 3; } });
    assert.throws(() => queryProjectRuntimeObservation(view), { errorCode: 'runtime_project_invalid' });
  }
  assert.equal(calls, 0);
});

test('a skipped wire receipt retires its token without invalidating previously captured queued messages', () => {
  const { a, reader } = running();
  push(reader, [publication(a, 1, 1, 'signal', true), publication(a, 1, 2, 'signal', true), delivery(a, 1, 1, 1, 'skipped')]);
  reject(reader, publication(a, 1, 3, 'signal', true)); reject(reader, delivery(a, 1, 2, 1));
  push(reader, [delivery(a, 1, 2, 1, 'skipped'), publication(a, 1, 3, 'signal', true, [eventRecipient(a, 2)]), delivery(a, 1, 3, 2)]);
  assert.deepEqual(reader.projectEvents.entries.map(entry => entry.deliveries[0].status), ['skipped', 'skipped', 'handled']);
});
