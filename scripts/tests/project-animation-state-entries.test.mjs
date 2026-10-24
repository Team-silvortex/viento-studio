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
import { completionProject, completionStart, completionRun, completionCommand } from './helpers/project-animation-completion-fixture.mjs';
import { enterScene, readyScene, exitScene, runtimeId, sceneFrame } from './helpers/project-runtime-fixture.mjs';
const clone = value => structuredClone(value);
const p9 = frame => ({ ...frame, protocol: 9, ...(['ready', 'finished'].includes(frame.event) ? { animationStateSequence: 0, animationStateEntrySequence: 0 } : {}) });
function fixture() {
  const plan = completionProject(), scene = plan.scenes[0];
  scene.behaviors.sources[0].content = generateEditableGodotAnimationStateScript(DEFAULT_ANIMATION_STATE_TABLE).content;
  scene.behaviors.bindings[0].parameters = {};
  return plan;
}
function entry(plan, options = {}) {
  const { sequence = 1, visitIndex = 1, stateIndex = 0, timeSeconds = 0, commandSequence = 0, bindingIndex = 0 } = options;
  const scene = plan.scenes[0], controller = createProjectAnimationStateCatalog(plan).scenes[0].controllers[bindingIndex];
  return { protocol: 9, event: 'animation-state-entered', sequence, visitIndex, sceneId: scene.scene.objectId,
    timeSeconds, commandSequence, bindingId: controller.bindingId, instanceId: controller.instanceId,
    objectId: controller.objectId, stateIndex, clipId: controller.clips[stateIndex] };
}
function boundary(plan, options = {}) {
  const { sequence = 1, visitIndex = 1, timeSeconds = .5, commandSequence = 0, reason = 'finished', stateIndex = 0, status = 'active' } = options;
  return { protocol: 9, event: 'animation-state-snapshot', sequence, visitIndex, sceneId: plan.scenes[0].scene.objectId,
    timeSeconds, commandSequence, reason, controllers: createProjectAnimationStateCatalog(plan).scenes[0].controllers.map(controller => ({
      bindingId: controller.bindingId, instanceId: controller.instanceId, objectId: controller.objectId, status,
      stateIndex: status === 'inactive' ? -1 : status === 'unavailable' ? null : stateIndex, clipId: status === 'active' ? controller.clips[stateIndex] : null })) };
}
const push = (reader, frames) => reader.push(frames.map(frame => 'VIENTO_PROJECT:' + JSON.stringify(frame) + '\n').join(''));
function running(plan = fixture()) {
  const reader = createProjectRuntimeEventReader(plan, { protocolVersion: 9 });
  assert.equal(push(reader, completionStart(plan).map(p9)).length, 3);
  return { plan, reader, scene: plan.scenes[0] };
}
function reject(reader, event) {
  const before = [reader.animationStateEntries, reader.animationStates, reader.animationCommands, reader.events], count = reader.diagnostics.length;
  assert.deepEqual(push(reader, [event]), []); assert.deepEqual([reader.animationStateEntries, reader.animationStates, reader.animationCommands, reader.events], before);
  assert.equal(reader.diagnostics.length, count + 1);
}
function finished(plan = fixture()) {
  const observer = createProjectRuntimeObservation(plan, { protocolVersion: 9 });
  const frames = [...completionStart(plan).map(p9), entry(plan), entry(plan, { sequence: 2, stateIndex: 1 }), boundary(plan, { stateIndex: 1 }), p9(exitScene(plan.scenes[0], 1, .5)),
    { protocol: 9, event: 'finished', assemblyId: plan.assembly.objectId, visitCount: 1, totalSeconds: .5,
      stateRevision: 0, eventSequence: 0, audioCommandSequence: 0, animationCommandSequence: 0, animationCompletionSequence: 0, animationStateSequence: 1, animationStateEntrySequence: 2 }];
  for (const frame of frames) assert.equal(observer.push(frame), true, JSON.stringify(frame));
  return observer.snapshot();
}

test('initial entry, same-state restart and same-clip transition remain independent before command execution', () => {
  const { plan, reader } = running();
  const frames = [entry(plan), entry(plan, { sequence: 2 }), entry(plan, { sequence: 3, stateIndex: 1 })];
  assert.equal(push(reader, frames).length, 3);
  assert.deepEqual(reader.animationStateEntries.entries.map(row => [row.sequence, row.stateKey, row.clipId, row.commandSequence]), [[1, 'idle', null, 0], [2, 'idle', null, 0], [3, 'action', null, 0]]);
  assert.equal(reader.animationCommands.sequence, 0);
  const observed = reader.animationStateEntries.entries[0], controller = createProjectAnimationStateCatalog(plan).scenes[0].controllers[0];
  assert.deepEqual(observed.scriptSource, controller.scriptSource); assert.deepEqual(observed.origin.source, controller.source);
  assert.equal(Object.hasOwn(observed, 'stateIndex'), false); assert.equal(Object.hasOwn(observed, 'cause'), false);
});
test('wire entries reject forged identities, indices, clips, counters and source paths atomically', () => {
  for (const mutate of [row => row.sequence = 2, row => row.sequence = 129, row => row.visitIndex = 2, row => row.sceneId = runtimeId(999),
    row => row.bindingId = runtimeId(999), row => row.instanceId = runtimeId(999), row => row.objectId = runtimeId(999),
    row => row.stateIndex = 2, row => row.stateIndex = '0', row => row.clipId = runtimeId(999), row => row.clipId = false,
    row => row.commandSequence = 1, row => row.timeSeconds = -1, row => row.sourcePath = 'injected.txt']) {
    const { plan, reader } = running(), row = entry(plan); mutate(row); reject(reader, row); assert.equal(push(reader, [entry(plan)]).length, 1);
  }
});
test('unrecognized scripts never admit private state entries', () => {
  const plan = fixture(), row = entry(plan); plan.scenes[0].behaviors.sources[0].content += '\n# edited\n';
  const { reader } = running(plan); reject(reader, row);
});
test('ready and finished counters are exact and protocol8 keeps its old event shape', () => {
  const plan = fixture(), reader = createProjectRuntimeEventReader(plan, { protocolVersion: 9 }), start = completionStart(plan).map(p9);
  const missing = clone(start[0]); delete missing.animationStateEntrySequence; reject(reader, missing);
  reject(reader, { ...start[0], animationStateEntrySequence: 1 }); assert.equal(push(reader, start).length, 3);
  push(reader, [entry(plan), boundary(plan), p9(exitScene(plan.scenes[0], 1, .5))]);
  const done = { protocol: 9, event: 'finished', assemblyId: plan.assembly.objectId, visitCount: 1, totalSeconds: .5,
    stateRevision: 0, eventSequence: 0, audioCommandSequence: 0, animationCommandSequence: 0, animationCompletionSequence: 0, animationStateSequence: 1, animationStateEntrySequence: 1 };
  reject(reader, { ...done, animationStateEntrySequence: 0 }); assert.equal(push(reader, [done]).length, 1);
  const old = createProjectRuntimeEventReader(plan, { protocolVersion: 8 });
  const frames = completionStart(plan).map(frame => ({ ...frame, protocol: 8, ...(frame.event === 'ready' ? { animationStateSequence: 0 } : {}) }));
  assert.equal(push(old, frames).length, 3); assert.equal(push(old, [{ ...entry(plan), protocol: 8 }]).length, 0);
  assert.equal(Object.hasOwn(old, 'animationStateEntries'), false);
});
test('active terminal state must match latest entered state while inactive or unavailable keeps earlier history', () => {
  const { plan, reader } = running(); reject(reader, boundary(plan)); push(reader, [entry(plan)]);
  reject(reader, boundary(plan, { stateIndex: 1 })); push(reader, [entry(plan, { sequence: 2, stateIndex: 1 })]);
  assert.equal(push(reader, [boundary(plan, { stateIndex: 1 })]).length, 1); reject(reader, entry(plan, { sequence: 3 }));
  for (const status of ['inactive', 'unavailable']) {
    const active = running(); push(active.reader, [entry(active.plan)]);
    assert.equal(push(active.reader, [boundary(active.plan, { status })]).length, 1); assert.equal(active.reader.animationStateEntries.sequence, 1);
  }
});
test('diagnostic abort rejects later entries and cancellation retains only records actually collected', () => {
  const { plan, reader, scene } = running(), binding = scene.behaviors.bindings[0]; push(reader, [entry(plan)]);
  const diagnostic = p9(sceneFrame(scene, 1, { protocol: 3, event: 'diagnostic', severity: 'error', code: 'runtime_behavior_script', message: 'failed', bindingId: binding.bindingId, instanceId: binding.instanceId, objectId: binding.objectId }));
  assert.equal(push(reader, [diagnostic]).length, 1); reject(reader, entry(plan, { sequence: 2 }));
  assert.equal(push(reader, [boundary(plan, { reason: 'aborted', status: 'inactive' })]).length, 1);
  const cancelled = running(); push(cancelled.reader, [entry(cancelled.plan)]); cancelled.reader.finish();
  assert.equal(cancelled.reader.animationStateEntries.sequence, 1); assert.equal(cancelled.reader.animationStates.sequence, 0);
});
test('entry clock and command cutoff never rewind; later executed receipts cannot precede an entry', () => {
  const { plan, reader, scene } = running(); push(reader, [entry(plan, { timeSeconds: .2 })]);
  reject(reader, entry(plan, { sequence: 2, timeSeconds: .1 }));
  reject(reader, p9(completionCommand(scene, 1, 1, { action: 'pause' }, .1, .1, 'paused')));
  assert.equal(push(reader, [p9(completionCommand(scene, 1, 1, { action: 'pause' }, .2, .2, 'paused'))]).length, 1);
  reject(reader, entry(plan, { sequence: 2, timeSeconds: .3 }));
  assert.equal(push(reader, [entry(plan, { sequence: 2, timeSeconds: .2, commandSequence: 1 })]).length, 1);
});
test('scene reentry records a fresh initial state and preserves global entry sequence and source identity', () => {
  const { plan, reader, scene } = running(), other = plan.scenes[1];
  const frames = [entry(plan, { stateIndex: 1 }), boundary(plan, { stateIndex: 1, reason: 'switch' }), p9(exitScene(scene, 1, .5, other)),
    p9(enterScene(other, 2)), p9(readyScene(other, 2)), p9(exitScene(other, 2, 0, scene)), p9(enterScene(scene, 3)), p9(readyScene(scene, 3)),
    entry(plan, { sequence: 2, visitIndex: 3 }), boundary(plan, { sequence: 2, visitIndex: 3, timeSeconds: 0 }), p9(exitScene(scene, 3, 0))];
  assert.equal(push(reader, frames).length, frames.length);
  assert.deepEqual(reader.animationStateEntries.entries.map(row => [row.origin.visitIndex, row.stateKey]), [[1, 'action'], [3, 'idle']]);
});
test('two bindings of one script retain distinct accepted-state histories', () => {
  const plan = fixture(), scene = plan.scenes[0], second = clone(scene.behaviors.bindings[0]); second.bindingId = runtimeId(888); second.declaration.propertyPath = '/bindings/1'; scene.behaviors.bindings.push(second);
  const { reader } = running(plan); const frames = [entry(plan), entry(plan, { sequence: 2, bindingIndex: 1, stateIndex: 1 }), entry(plan, { sequence: 3 })];
  assert.equal(push(reader, frames).length, 3); const records = reader.animationStateEntries.entries;
  assert.equal(records[0].scriptSource.objectId, records[1].scriptSource.objectId); assert.notEqual(records[0].origin.bindingId, records[1].origin.bindingId);
  assert.deepEqual(records.map(row => row.origin.source.propertyPath), ['/bindings/0', '/bindings/1', '/bindings/0']);
});
test('DTO validation rejects unsafe accessors, stale identities, unknown fields and reversed entry histories', () => {
  const original = finished().project.animationStateEntries;
  for (const mutate of [value => value.extra = true, value => value.sequence = 1, value => value.entries[0].stateKey = 'Idle',
    value => value.entries[0].scriptSource.propertyPath = '/x', value => value.entries[0].scriptSource.sourceRange = { start: 0, end: 1, encoding: 'utf-16' },
    value => value.entries[0].scriptSource.sourcePath = '../escape', value => value.entries[0].origin.visitIndex = 65,
    value => value.entries[0].timeSeconds = 1, value => value.entries[0].commandSequence = 1, value => value.entries[0].clipId = false,
    value => value.entries[1].scriptSource.sourceRevision = 'sha256:' + '9'.repeat(64), value => value.entries[1].origin.instanceId = runtimeId(999)]) {
    const changed = clone(original); mutate(changed); assert.throws(() => validateProjectAnimationStateEntriesSnapshot(changed));
  }
  let calls = 0; const unsafe = clone(original); Object.defineProperty(unsafe.entries[0], 'stateKey', { enumerable: true, get() { calls++; return 'idle'; } });
  assert.throws(() => validateProjectAnimationStateEntriesSnapshot(unsafe)); assert.equal(calls, 0);
  const detached = validateProjectAnimationStateEntriesSnapshot(original); detached.entries[0].stateKey = 'changed'; assert.equal(original.entries[0].stateKey, 'idle');
});
test('p9 query cross-checks accepted history with visits and terminal snapshots and p8 rejects added entries', () => {
  const original = finished(); assert.deepEqual(queryProjectRuntimeObservation(original), original);
  for (const mutate of [value => delete value.project.animationStateEntries, value => value.project.protocolVersion = 8,
    value => value.project.animationStateEntries.entries.forEach(row => row.origin.sceneId = runtimeId(999)),
    value => value.project.animationStateEntries.entries.forEach(row => row.commandSequence = 1),
    value => value.project.animationStateEntries.entries.forEach(row => row.timeSeconds = .6),
    value => value.project.animationStateEntries.entries[1].stateKey = 'idle',
    value => value.project.animationStates.entries[0].controllers[0].scriptSource.sourcePath = 'changed.txt']) {
    const changed = clone(original); mutate(changed); assert.throws(() => queryProjectRuntimeObservation(changed));
  }
});
test('accepted entries before completion delivery keep their earlier execution cutoff', () => {
  const plan = fixture(), scene = plan.scenes[0]; scene.behaviors.bindings[0].parameters = { clip_idle: scene.animation.document.clips[0].id, clip_action: scene.animation.document.clips[1].id };
  const frames = completionRun(plan).map(p9); frames.splice(3, 0, entry(plan));
  frames.splice(7, 0, entry(plan, { sequence: 2, stateIndex: 1, timeSeconds: .4, commandSequence: 2 }));
  frames.splice(-2, 0, boundary(plan, { stateIndex: 1, commandSequence: 4 })); frames.at(-1).animationStateSequence = 1; frames.at(-1).animationStateEntrySequence = 2;
  const observer = createProjectRuntimeObservation(plan, { protocolVersion: 9 });
  for (const frame of frames) assert.equal(observer.push(frame), true, JSON.stringify(frame));
  const view = observer.snapshot(); assert.deepEqual(queryProjectRuntimeObservation(view), view);
  assert.deepEqual(view.project.animationStateEntries.entries.map(row => row.commandSequence), [0, 2]);
  for (const commandSequence of [0, 1, 3, 4, 5]) {
    const changed = clone(view); changed.project.animationStateEntries.entries[1].commandSequence = commandSequence;
    // Equal timestamps allow cutoffs 3/4 without claiming an inferred request/receipt pairing.
    if ([3, 4].includes(commandSequence)) assert.deepEqual(queryProjectRuntimeObservation(changed), changed);
    else assert.throws(() => queryProjectRuntimeObservation(changed));
  }
});
test('ledger admits exactly128 entries and rejects overflow without altering prior accepted history', () => {
  const plan = fixture(), ledger = createProjectAnimationStateEntries(plan);
  for (let sequence = 1; sequence <= 128; sequence++) { const { protocol, event, ...row } = entry(plan, { sequence, stateIndex: sequence % 2 }); ledger.append(row); }
  const before = ledger.snapshot(); assert.equal(before.entries.length, 128); assert.deepEqual(validateProjectAnimationStateEntriesSnapshot(before), before);
  const { protocol, event, ...overflow } = entry(plan, { sequence: 129 }); assert.throws(() => ledger.append(overflow)); assert.deepEqual(ledger.snapshot(), before);
});
test('protocol9 descriptors require completion, snapshots and accepted-state entry capabilities', () => {
  const plan = fixture(), descriptor = { format: 'viento-execution-backend', schemaVersion: 1, id: 'org.viento.godot4', label: 'Godot 4', version: '0.18.0', platforms: ['linux'],
    plans: [{ kind: 'scene2d', schemaVersion: 3, runtimeProtocolVersion: 3 }, { kind: 'project', schemaVersion: 1, runtimeProtocolVersion: 9 }],
    capabilities: [...plan.requiredCapabilities, 'behavior.bindings', 'behavior.gdscript', 'project.animation-control'],
    execution: { build: true, headlessLogic: true, windowPreview: true, windowCapture: true, offscreenRender: false, embeddedViewport: false, gpuCompute: false }, extensions: [] };
  assert.equal(validateExecutionBackendDescriptor(descriptor).plans[1].runtimeProtocolVersion, 9);
  for (const capability of ['project.animation-completion', 'project.animation-state-snapshots', 'project.animation-state-entries']) {
    assert.ok(checkExecutionBackendSupport(descriptor, { operation: 'build', plan }).some(row => row.capability === capability)); descriptor.capabilities.push(capability);
  }
  assert.deepEqual(checkExecutionBackendSupport(descriptor, { operation: 'build', plan }), []);
  descriptor.plans[1].runtimeProtocolVersion = 11; assert.throws(() => validateExecutionBackendDescriptor(descriptor));
});

test('query compares binding identity across accepted entries, executed receipts and earlier inactive snapshots', () => {
  const plan = fixture(), scene = plan.scenes[0], other = plan.scenes[1];
  const observer = createProjectRuntimeObservation(plan, { protocolVersion: 9 });
  const frames = [...completionStart(plan).map(p9), boundary(plan, { status: 'inactive', reason: 'switch' }), p9(exitScene(scene, 1, .5, other)),
    p9(enterScene(other, 2)), p9(readyScene(other, 2)), p9(exitScene(other, 2, 0, scene)), p9(enterScene(scene, 3)), p9(readyScene(scene, 3)),
    entry(plan, { visitIndex: 3 }), p9(completionCommand(scene, 3, 1, { action: 'pause' }, 0, 0, 'paused'))];
  for (const frame of frames) assert.equal(observer.push(frame), true);
  const view = observer.snapshot(); assert.deepEqual(queryProjectRuntimeObservation(view), view);
  for (const mutate of [value => value.project.animationStateEntries.entries[0].scriptSource.sourceRevision = 'sha256:' + '9'.repeat(64),
    value => value.project.animationCommands.entries[0].origin.source.sourcePath = 'different.txt']) {
    const changed = clone(view); mutate(changed); assert.throws(() => queryProjectRuntimeObservation(changed));
  }
});

test('query rejects an earlier command with changed binding source even when later commands restore it', () => {
  const plan = fixture(), scene = plan.scenes[0], observer = createProjectRuntimeObservation(plan, { protocolVersion: 9 });
  const frames = [...completionStart(plan).map(p9), entry(plan),
    p9(completionCommand(scene, 1, 1, { action: 'select', clipId: null }, 0, 0, 'paused')),
    p9(completionCommand(scene, 1, 2, { action: 'play' }, 0, 0, 'playing'))];
  for (const frame of frames) assert.equal(observer.push(frame), true);
  const view = observer.snapshot(); assert.deepEqual(queryProjectRuntimeObservation(view), view);
  for (const change of [origin => origin.source.sourcePath = 'different.txt', origin => origin.instanceId = runtimeId(999),
    origin => origin.source.sourceRevision = 'sha256:' + '9'.repeat(64)]) {
    const altered = clone(view); change(altered.project.animationCommands.entries[0].origin);
    assert.throws(() => queryProjectRuntimeObservation(altered));
  }
});
