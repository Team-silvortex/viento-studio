import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createProjectRuntimeEventReader } from '../../engine/project-runtime-events.mjs';
import { createProjectRuntimeObservation, queryProjectRuntimeObservation } from '../../engine/project-runtime-query.mjs';
import { createProjectAnimationCompletions, validateProjectAnimationCompletionsSnapshot } from '../../engine/project-animation-completions.mjs';
import { animationProject, animationReady, animationReturnTrip } from './helpers/project-animation-command-fixture.mjs';
import { clipProject, clipReturnTrip } from './helpers/project-animation-clip-command-fixture.mjs';
import { completionProject, completionStart, completionFrame, completionCommand, animationCompleted,
  completionDelivery, completionRun } from './helpers/project-animation-completion-fixture.mjs';
import { enterScene, readyScene, exitScene, runtimeId } from './helpers/project-runtime-fixture.mjs';
const push = (reader, frames) => reader.push(frames.map(frame => 'VIENTO_PROJECT:' + JSON.stringify(frame) + '\n').join(''));
function running(plan = completionProject()) {
  const reader = createProjectRuntimeEventReader(plan, { protocolVersion: 7 });
  assert.equal(push(reader, completionStart(plan)).length, 3);
  return { plan, reader, scene: plan.scenes[0] };
}
function reject(reader, frame) {
  const before = [reader.animationCommands, reader.animationCompletions, reader.events], count = reader.diagnostics.length;
  assert.deepEqual(push(reader, [frame]), []);
  assert.deepEqual([reader.animationCommands, reader.animationCompletions, reader.events], before);
  assert.equal(reader.diagnostics.length, count + 1);
}
function entry() {
  const plan = completionProject(), observer = createProjectRuntimeObservation(plan, { protocolVersion: 7 });
  for (const frame of completionRun(plan)) assert.equal(observer.push(frame), true);
  return observer.snapshot().project.animationCompletions.entries[0];
}
function appendInput(value) {
  const { deliveries, ...fields } = structuredClone(value);
  return { ...fields, recipients: deliveries.map(({ subscriptionId, origin }) => ({ subscriptionId, origin })) };
}
test('p7 admits natural clip completion, ordered callback delivery and subsequent looping clip with frozen sources', () => {
  const plan = completionProject(), reader = createProjectRuntimeEventReader(plan, { protocolVersion: 7, expectedTotalSeconds: .5 });
  const frames = completionRun(plan);
  assert.equal(push(reader, frames).length, frames.length);
  assert.deepEqual(reader.finish().diagnostics, []);
  assert.equal(reader.animationCommands.sequence, 4);
  const snapshot = reader.animationCompletions;
  assert.equal(snapshot.sequence, 1);
  assert.equal(snapshot.entries[0].clip.source.propertyPath, '/clips/0');
  assert.equal(snapshot.entries[0].animation.source.propertyPath, '');
  assert.equal(snapshot.entries[0].deliveries[0].origin.source.propertyPath, '/bindings/0');
  assert.equal(snapshot.entries[0].deliveries[0].status, 'handled');
  assert.equal(Object.hasOwn(snapshot.entries[0], 'origin'), false);
  snapshot.entries[0].clip.name = 'changed';
  assert.notDeepEqual(reader.animationCompletions, snapshot);
});
test('p7 admits automatic whole completion without a publisher or recipients on old schemas', () => {
  for (const schemaVersion of [1, 2]) {
    const plan = animationProject(); plan.scenes[0].animation.document.schemaVersion = schemaVersion;
    const { reader, scene } = running(plan);
    const frame = animationCompleted(scene, 1, 1, 0, 1.25, null, []);
    assert.equal(push(reader, [frame]).length, 1);
    assert.equal(reader.animationCompletions.entries[0].clip, null);
    assert.deepEqual(reader.animationCompletions.entries[0].deliveries, []);
  }
});
test('p7 rejects forged completion fields and recipient identities atomically, then accepts the original', () => {
  for (const mutate of [
    f => f.completionSequence = 2, f => f.commandSequence = 1, f => f.visitIndex = 2,
    f => f.sceneId = runtimeId(999), f => f.state.sceneObjectId = runtimeId(999),
    f => f.state.phase = 'paused', f => f.state.positionSeconds = '1', f => f.state.positionSeconds = .999999,
    f => f.state.timeSeconds = .99, f => f.state.timeSeconds = '1', f => f.state.clipId = runtimeId(999),
    f => delete f.state.clipId, f => f.state.source = {}, f => f.recipients[0].objectId = runtimeId(999),
    f => f.recipients[0].source = {}, f => f.recipients[0].subscriptionId = 0,
    f => f.recipients = [...f.recipients, ...f.recipients], f => f.recipients = [f.recipients[0], { ...f.recipients[0], subscriptionId: 0 }],
    f => f.publisher = {}, f => f.protocol = 6,
  ]) {
    const { reader, scene } = running(), original = animationCompleted(scene, 1, 1, 0, 1);
    const changed = structuredClone(original); mutate(changed); reject(reader, changed);
    assert.equal(push(reader, [original]).length, 1);
  }
});
test('natural completion is one edge: loops, pause, stop and seek-end do not complete', () => {
  for (const command of [{ action: 'pause' }, { action: 'stop' }, { action: 'seek', positionSeconds: 1 }]) {
    const { reader, scene } = running();
    const phase = command.action === 'stop' ? 'stopped' : 'paused', position = command.action === 'seek' ? 1 : 0;
    assert.equal(push(reader, [completionCommand(scene, 1, 1, command, 0, position, phase)]).length, 1);
    reject(reader, animationCompleted(scene, 1, 1, 1, 2));
  }
  const plan = completionProject(); plan.scenes[0].animation.document.loop = true;
  const { reader, scene } = running(plan);
  reject(reader, animationCompleted(scene, 1, 1, 0, 2));
});
test('command at natural boundary requires the completion first and cannot suppress it by pausing', () => {
  const { reader, scene } = running();
  const pause = completionCommand(scene, 1, 1, { action: 'pause' }, 1, 1, 'paused');
  reject(reader, pause);
  assert.equal(push(reader, [animationCompleted(scene, 1, 1, 0, 1), pause]).length, 2);
  reject(reader, completionDelivery(scene, 1, 1));
  assert.equal(push(reader, [completionDelivery(scene, 1, 1, 1, 'skipped')]).length, 1);
  reject(reader, animationCompleted(scene, 1, 2, 1, 2));
});
test('completion after pause and resume uses the actual host clock and terminal play starts a fresh round', () => {
  const { reader, scene } = running();
  const frames = [
    completionCommand(scene, 1, 1, { action: 'pause' }, .25, .25, 'paused'),
    completionCommand(scene, 1, 2, { action: 'play' }, 3, .25, 'playing'),
    animationCompleted(scene, 1, 1, 2, 4), completionDelivery(scene, 1, 1),
    completionCommand(scene, 1, 3, { action: 'play' }, 4, 0, 'playing'),
    animationCompleted(scene, 1, 2, 3, 5), completionDelivery(scene, 1, 2),
  ];
  assert.equal(push(reader, frames).length, frames.length);
  reject(reader, animationCompleted(scene, 1, 3, 3, 6));
  assert.equal(reader.animationCompletions.sequence, 2);
});
test('deliveries are FIFO, visit bound, single use and stale outcomes must skip without retiring tokens', () => {
  const { reader, scene } = running();
  assert.equal(push(reader, [animationCompleted(scene, 1, 1, 0, 1, null, [1, 2])]).length, 1);
  reject(reader, completionDelivery(scene, 1, 1, 2));
  reject(reader, completionDelivery(scene, 2, 1));
  reject(reader, { ...completionDelivery(scene, 1, 1), status: 'pending' });
  assert.equal(push(reader, [completionDelivery(scene, 1, 1), completionDelivery(scene, 1, 1, 2)]).length, 2);
  reject(reader, completionDelivery(scene, 1, 1));
  assert.equal(push(reader, [
    completionCommand(scene, 1, 1, { action: 'play' }, 1, 0, 'playing'),
    animationCompleted(scene, 1, 2, 1, 2),
    completionCommand(scene, 1, 2, { action: 'play' }, 2, 0, 'playing'),
    completionDelivery(scene, 1, 2, 1, 'skipped'),
    animationCompleted(scene, 1, 3, 2, 3), completionDelivery(scene, 1, 3),
  ]).length, 6);
});
test('scene exit waits for captured deliveries and old tokens cannot move to a new visit', () => {
  const { reader, plan, scene } = running(), second = plan.scenes[1];
  push(reader, [animationCompleted(scene, 1, 1, 0, 1)]);
  const exit = completionFrame(exitScene(scene, 1, 1, second));
  reject(reader, exit);
  assert.equal(push(reader, [completionDelivery(scene, 1, 1, 1, 'skipped'), exit,
    completionFrame(enterScene(second, 2)), completionFrame(readyScene(second, 2))]).length, 4);
  reject(reader, completionDelivery(scene, 1, 1));
  reject(reader, animationCompleted(second, 2, 2, 0, 1));
  assert.equal(push(reader, [animationCompleted(second, 2, 2, 0, 1, null, [2])]).length, 1);
});
test('terminal sequence, state time and pending deliveries cannot be forged around project finish', () => {
  const plan = completionProject(), frames = completionRun(plan);
  for (const mutate of [f => f.animationCompletionSequence = 0, f => delete f.animationCompletionSequence]) {
    const reader = createProjectRuntimeEventReader(plan, { protocolVersion: 7 });
    push(reader, frames.slice(0, -1)); const changed = structuredClone(frames.at(-1)); mutate(changed); reject(reader, changed);
    assert.equal(push(reader, [frames.at(-1)]).length, 1);
  }
});
test('p7 query detaches and rejects forged source, range, history, delivery and versioned shapes', () => {
  const plan = completionProject(), observer = createProjectRuntimeObservation(plan, { protocolVersion: 7 });
  for (const frame of completionRun(plan)) assert.equal(observer.push(frame), true);
  const view = observer.snapshot();
  assert.deepEqual(queryProjectRuntimeObservation(view), view);
  for (const mutate of [
    v => delete v.project.animationCompletions, v => v.project.protocolVersion = 6,
    v => v.project.animationCompletions.entries[0].animation.source.propertyPath = '/tracks/0',
    v => v.project.animationCompletions.entries[0].animation.source.sourcePath = 'other.json',
    v => v.project.animationCompletions.entries[0].clip.source.sourceRevision = 'sha256:' + 'b'.repeat(64),
    v => v.project.animationCompletions.entries[0].clip.source.propertyPath = '/clips/32',
    v => v.project.animationCompletions.entries[0].clip.name = 'forged',
    v => v.project.animationCompletions.entries[0].state.timeSeconds = .1,
    v => v.project.animationCompletions.entries[0].state.timeSeconds = .6,
    v => v.project.animationCompletions.entries[0].commandSequence = 0,
    v => v.project.animationCompletions.entries[0].state.positionSeconds = .3,
    v => v.project.animationCompletions.entries[0].deliveries[0].status = 'pending',
    v => v.project.animationCompletions.entries[0].deliveries[0].origin.sceneId = runtimeId(999),
  ]) { const changed = structuredClone(view); mutate(changed); assert.throws(() => queryProjectRuntimeObservation(changed), { errorCode: 'runtime_project_invalid' }); }
  let reads = 0;
  assert.throws(() => queryProjectRuntimeObservation({ ...view, get project() { reads++; return view.project; } }));
  assert.equal(reads, 0);
});
test('completion ledger snapshots reject getters, foreign token ownership and mismatched identities atomically', () => {
  const original = entry(), ledger = createProjectAnimationCompletions(), input = appendInput(original);
  let reads = 0;
  assert.throws(() => ledger.append({ ...input, get state() { reads++; return input.state; } }));
  assert.equal(reads, 0); assert.equal(ledger.sequence, 0);
  ledger.append(input);
  const changed = structuredClone(input); changed.sequence = 2; changed.commandSequence = 3;
  changed.animation.source.sourcePath = 'other.json';
  assert.throws(() => ledger.append(changed)); assert.equal(ledger.sequence, 1);
  ledger.deliver({ sequence: 1, subscriptionId: 1, visitIndex: 1, sceneId: input.sceneId, status: 'skipped' }, 3);
  const next = structuredClone(input); next.sequence = 2; next.commandSequence = 3;
  ledger.append(next);
  ledger.deliver({ sequence: 2, subscriptionId: 1, visitIndex: 1, sceneId: input.sceneId, status: 'handled' }, 3);
  assert.deepEqual(validateProjectAnimationCompletionsSnapshot(ledger.snapshot()), ledger.snapshot());
  assert.throws(() => validateProjectAnimationCompletionsSnapshot({ ...ledger.snapshot(), get sequence() { reads++; return 2; } }));
  assert.equal(reads, 0);
});
test('completion budgets count pending records, reserved deliveries and all 320 possible natural rounds', () => {
  const original = appendInput(entry()), pending = createProjectAnimationCompletions();
  for (let sequence = 1; sequence <= 64; sequence++) pending.append({ ...original, sequence, commandSequence: sequence });
  assert.throws(() => pending.append({ ...original, sequence: 65, commandSequence: 65 }));
  assert.equal(pending.pendingCount, 64);
  const deliveries = createProjectAnimationCompletions();
  const recipients = Array.from({ length: 64 }, (_, i) => ({ ...original.recipients[0], subscriptionId: i + 1 }));
  for (let sequence = 1; sequence <= 16; sequence++) {
    deliveries.append({ ...original, sequence, commandSequence: sequence, recipients });
    for (let subscriptionId = 1; subscriptionId <= 64; subscriptionId++) deliveries.deliver({ sequence, subscriptionId, visitIndex: 1, sceneId: original.sceneId, status: 'handled' }, sequence);
  }
  assert.throws(() => deliveries.append({ ...original, sequence: 17, commandSequence: 17 }));
  const complete = createProjectAnimationCompletions();
  for (let sequence = 1; sequence <= 320; sequence++) complete.append({ ...original, sequence,
    visitIndex: Math.min(sequence, 64), commandSequence: Math.max(0, sequence - 64), recipients: [] });
  assert.equal(complete.sequence, 320);
  assert.deepEqual(validateProjectAnimationCompletionsSnapshot(complete.snapshot()), complete.snapshot());
  assert.throws(() => complete.append({ ...original, sequence: 321, commandSequence: 256, visitIndex: 64, recipients: [] }));
});
test('old p5/p6 histories preserve their DTO shape and continue without completion frames', () => {
  for (const [protocolVersion, plan, frames] of [[5, animationProject(), animationReturnTrip], [6, clipProject(), clipReturnTrip]]) {
    const reader = createProjectRuntimeEventReader(plan, { protocolVersion });
    const values = frames(plan); assert.equal(push(reader, values).length, values.length);
    assert.equal(Object.hasOwn(reader, 'animationCompletions'), false); assert.deepEqual(reader.finish().diagnostics, []);
  }
});


test('same-clock replay is accepted but cannot invent a second natural completion without advancing time', () => {
  const { reader, scene } = running();
  assert.equal(push(reader, [animationCompleted(scene, 1, 1, 0, 1), completionDelivery(scene, 1, 1),
    completionCommand(scene, 1, 1, { action: 'play' }, 1, 0, 'playing')]).length, 3);
  reject(reader, animationCompleted(scene, 1, 2, 1, 1));
  assert.equal(push(reader, [animationCompleted(scene, 1, 2, 1, 2), completionDelivery(scene, 1, 2)]).length, 2);
});
test('p7 scene exit cannot conceal an unreported automatic natural completion', () => {
  const { reader, scene } = running(), exit = completionFrame(exitScene(scene, 1, 1));
  reject(reader, exit);
  assert.equal(push(reader, [animationCompleted(scene, 1, 1, 0, 1, null, []), exit]).length, 2);
});
test('completion source ranges retain old source vocabulary and must match the shared frozen declarations', () => {
  const plan = completionProject(), animation = plan.scenes[0].animation;
  animation.locations.clips[0].declaration.sourceRange = { start: 20, end: 40, encoding: 'utf-16', propertyPath: '/clips/0', exact: true };
  const observer = createProjectRuntimeObservation(plan, { protocolVersion: 7 });
  for (const frame of completionRun(plan)) assert.equal(observer.push(frame), true);
  const view = observer.snapshot(); assert.deepEqual(queryProjectRuntimeObservation(view), view);
  for (const change of [
    clip => clip.source.sourceRange.start = -1,
    clip => clip.source.sourceRange.end = clip.source.sourceRange.start,
    clip => clip.source.sourceRange.encoding = 'utf-8',
    clip => clip.source.sourceRange.propertyPath = '/clips/1',
    clip => clip.source.sourceRange.start++,
    clip => clip.source.sourceRange.exact = false,
    clip => clip.source.propertyPath = '/clips/1',
    clip => clip.source.sourceRange.extra = true,
  ]) {
    const changed = structuredClone(view); change(changed.project.animationCompletions.entries[0].clip);
    assert.throws(() => queryProjectRuntimeObservation(changed), { errorCode: 'runtime_project_invalid' });
  }
});
