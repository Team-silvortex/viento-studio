import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createProjectAnimationStateCatalog, createProjectAnimationStates, validateProjectAnimationStatesSnapshot } from '../../engine/project-animation-states.mjs';
import { validateExecutionBackendDescriptor, checkExecutionBackendSupport } from '../../engine/backend-capabilities.mjs';
import { createProjectRuntimeEventReader } from '../../engine/project-runtime-events.mjs';
import { createProjectRuntimeObservation, queryProjectRuntimeObservation } from '../../engine/project-runtime-query.mjs';
import { generateEditableGodotAnimationStateScript } from '../../engine/animation-state-script-source.mjs';
import { DEFAULT_ANIMATION_STATE_TABLE } from '../../engine/godot-animation-state-script.mjs';
import { completionProject, completionStart, completionRun, completionCommand } from './helpers/project-animation-completion-fixture.mjs';
import { enterScene, readyScene, exitScene, runtimeId, sceneFrame } from './helpers/project-runtime-fixture.mjs';
import { publication } from './helpers/project-event-bus-fixture.mjs';
const clone = value => structuredClone(value), execFileAsync = promisify(execFile);
const p8 = frame => ({ ...frame, protocol: 8, ...(['ready', 'finished'].includes(frame.event) ? { animationStateSequence: 0 } : {}) });
function fixture(table = DEFAULT_ANIMATION_STATE_TABLE) {
  const plan = completionProject(), scene = plan.scenes[0];
  scene.behaviors.sources[0].content = generateEditableGodotAnimationStateScript(table).content;
  scene.behaviors.bindings[0].parameters = {};
  return plan;
}
function frame(plan, { sequence = 1, visitIndex = 1, sceneIndex = 0, timeSeconds = .5, reason = 'finished', commandSequence = 0, stateIndex = 0, status = 'active' } = {}) {
  const scene = plan.scenes[sceneIndex], catalog = createProjectAnimationStateCatalog(plan).scenes.find(row => row.sceneId === scene.scene.objectId);
  return { protocol: 8, event: 'animation-state-snapshot', sequence, visitIndex, sceneId: scene.scene.objectId, timeSeconds, commandSequence, reason,
    controllers: catalog.controllers.map(controller => ({ bindingId: controller.bindingId, instanceId: controller.instanceId, objectId: controller.objectId,
      status, stateIndex: status === 'inactive' ? -1 : status === 'unavailable' ? null : stateIndex, clipId: status === 'active' ? controller.clips[stateIndex] : null })) };
}
const push = (reader, frames) => reader.push(frames.map(frame => 'VIENTO_PROJECT:' + JSON.stringify(frame) + '\n').join(''));
function running(plan = fixture()) {
  const reader = createProjectRuntimeEventReader(plan, { protocolVersion: 8 });
  assert.equal(push(reader, completionStart(plan).map(p8)).length, 3);
  return { plan, reader, scene: plan.scenes[0] };
}
function finished(plan = fixture()) {
  const observer = createProjectRuntimeObservation(plan, { protocolVersion: 8 });
  const frames = [...completionStart(plan).map(p8), frame(plan), p8(exitScene(plan.scenes[0], 1, .5)),
    { protocol: 8, event: 'finished', assemblyId: plan.assembly.objectId, visitCount: 1, totalSeconds: .5,
      stateRevision: 0, eventSequence: 0, audioCommandSequence: 0, animationCommandSequence: 0, animationCompletionSequence: 0, animationStateSequence: 1 }];
  for (const event of frames) assert.equal(observer.push(event), true, JSON.stringify(event));
  return observer.snapshot();
}
function reject(reader, event) {
  const before = [reader.animationStates, reader.animationCommands, reader.events], count = reader.diagnostics.length;
  assert.deepEqual(push(reader, [event]), []); assert.deepEqual([reader.animationStates, reader.animationCommands, reader.events], before);
  assert.equal(reader.diagnostics.length, count + 1);
}

test('catalog recognizes exact v1/v2/v3 bytes, default clips and BOM/CRLF while retaining frozen navigation', () => {
  for (const table of [DEFAULT_ANIMATION_STATE_TABLE,
    { ...clone(DEFAULT_ANIMATION_STATE_TABLE), transitions: [{ from: 'idle', to: 'action', trigger: { kind: 'event', name: 'go', condition: { type: 'boolean', operator: 'eq', value: true } } }] },
    { ...clone(DEFAULT_ANIMATION_STATE_TABLE), eventSelection: 'firstMatch' }]) {
    const plan = fixture(table), source = plan.scenes[0].behaviors.sources[0]; source.content = '\uFEFF' + source.content.replaceAll('\n', '\r\n');
    const result = createProjectAnimationStateCatalog(plan), controller = result.scenes[0].controllers[0];
    assert.equal(result.scenes.length, 1); assert.deepEqual(controller.states, ['idle', 'action']); assert.deepEqual(controller.clips, [null, null]);
    assert.deepEqual(controller.scriptSource, { objectId: source.objectId, sourcePath: source.sourcePath, sourceRevision: source.sourceRevision, propertyPath: '' });
    assert.equal(controller.source.propertyPath, '/bindings/0'); assert.ok(Object.isFrozen(controller.clips));
    source.content = 'changed'; assert.deepEqual(controller.states, ['idle', 'action']);
  }
});
test('ordinary, modified, malformed and unknown-generator scripts remain unobserved without editing author text', () => {
  for (const transform of [() => 'extends Node\n', text => text + '\n# author change\n', text => text.replace('godot-gdscript-v1', 'godot-gdscript-v99'), text => text.replace('"schemaVersion":1', '"schemaVersion":99')]) {
    const plan = fixture(), source = plan.scenes[0].behaviors.sources[0]; source.content = transform(source.content); const original = clone(plan);
    assert.deepEqual(createProjectAnimationStateCatalog(plan), { scenes: [] }); assert.deepEqual(plan, original);
  }
});
test('recognized catalog never swallows optional core absence', async () => {
  const plan = fixture();
  const code = `import assert from 'node:assert/strict';import fs from 'node:fs/promises';import {initializeStudioCore} from ${JSON.stringify(new URL('../../engine/studio-core.mjs', import.meta.url).href)};const original=await WebAssembly.instantiate(await fs.readFile(new URL(${JSON.stringify(new URL('../../engine/studio-core.wasm', import.meta.url).href)})),{});const exports={...original.instance.exports};delete exports.viento_core_animation_state_table_version;WebAssembly.instantiate=async()=>({instance:{exports}});await initializeStudioCore(()=>new Uint8Array([1]));import {createProjectAnimationStateCatalog} from ${JSON.stringify(new URL('../../engine/project-animation-states.mjs', import.meta.url).href)};assert.throws(()=>createProjectAnimationStateCatalog(${JSON.stringify(plan)}),e=>e.errorCode==='studio_core_unavailable');`;
  await execFileAsync(process.execPath, ['--input-type=module', '-e', code]);
});
test('recognized invalid clip parameters fail with frozen field diagnostics; valid unknown UUID remains runtime-owned', () => {
  for (const value of [true, 4, 'WRONG', 'A0000000-0000-0000-0000-000000000000']) {
    const plan = fixture(), binding = plan.scenes[0].behaviors.bindings[0]; binding.parameters.clip_idle = value;
    assert.throws(() => createProjectAnimationStateCatalog(plan), error => error.errorCode === 'build_animation_state_parameters_invalid'
      && error.bindingId === binding.bindingId && error.sourcePath === binding.declaration.sourcePath && error.propertyPath === '/bindings/0/parameters/clip_idle');
  }
  const plan = fixture(); plan.scenes[0].behaviors.bindings[0].parameters.clip_action = runtimeId(999);
  assert.deepEqual(createProjectAnimationStateCatalog(plan).scenes[0].controllers[0].clips, [null, runtimeId(999)]);
});
test('catalog keeps each same-script binding and excludes scenes without animation', () => {
  const plan = fixture(), scene = plan.scenes[0], second = clone(scene.behaviors.bindings[0]);
  second.bindingId = runtimeId(777); second.declaration.propertyPath = '/bindings/1';
  second.instanceId = scene.actors[1].instanceId; second.objectId = scene.actors[1].objectId; scene.behaviors.bindings.push(second);
  const catalog = createProjectAnimationStateCatalog(plan); assert.equal(catalog.scenes[0].controllers.length, 2);
  assert.equal(catalog.scenes[0].controllers[1].scriptObjectId, catalog.scenes[0].controllers[0].scriptObjectId);
  delete scene.animation; scene.requiredCapabilities = scene.requiredCapabilities.filter(value => !value.startsWith('animation.'));
  plan.requiredCapabilities = [...new Set(['project.scenes', ...plan.scenes.flatMap(row => row.requiredCapabilities)])].sort();
  assert.deepEqual(createProjectAnimationStateCatalog(plan), { scenes: [] });
});
test('actual state indexes distinguish states mapped to the same clip and keep all receipts independent', () => {
  const plan = fixture(), records = [];
  for (const stateIndex of [0, 1]) {
    const { reader } = running(plan); assert.equal(push(reader, [frame(plan, { stateIndex })]).length, 1);
    records.push(reader.animationStates.entries[0].controllers[0]); assert.equal(reader.animationCommands.sequence, 0);
  }
  assert.equal(records[0].stateKey, 'idle'); assert.equal(records[1].stateKey, 'action'); assert.equal(records[0].clipId, records[1].clipId);
});
test('inactive and unavailable are distinct states with no invented current state or clip', () => {
  for (const status of ['inactive', 'unavailable']) {
    const { plan, reader } = running(); assert.equal(push(reader, [frame(plan, { status })]).length, 1);
    const actual = reader.animationStates.entries[0].controllers[0]; assert.equal(actual.status, status); assert.equal(actual.stateKey, null); assert.equal(actual.clipId, null);
  }
});
test('p8 frozen wire snapshots reject forged identities, indices, clips, missing and duplicate controllers atomically', () => {
  for (const mutate of [f => f.sequence = 2, f => f.visitIndex = 2, f => f.sceneId = runtimeId(999), f => f.timeSeconds = -1,
    f => f.commandSequence = 1, f => f.reason = 'aborted', f => f.controllers = [], f => f.controllers.push(clone(f.controllers[0])),
    f => f.controllers[0].bindingId = runtimeId(999), f => f.controllers[0].instanceId = runtimeId(999), f => f.controllers[0].objectId = runtimeId(999),
    f => f.controllers[0].stateIndex = 2, f => f.controllers[0].stateIndex = '0', f => f.controllers[0].clipId = runtimeId(999),
    f => f.controllers[0].status = 'inactive', f => f.controllers[0].status = 'unavailable', f => f.controllers[0].status = 'live',
    f => f.controllers[0].sourcePath = 'invented.txt', f => f.sourcePath = 'invented.txt']) {
    const { plan, reader } = running(), original = frame(plan), changed = clone(original); mutate(changed); reject(reader, changed);
    assert.equal(push(reader, [original]).length, 1);
  }
});
test('snapshot closes its visit to further commands, publications and duplicate snapshots', () => {
  const { plan, scene, reader } = running(); const snapshot = frame(plan); assert.equal(push(reader, [snapshot]).length, 1);
  reject(reader, snapshot); reject(reader, p8(completionCommand(scene, 1, 1, { action: 'pause' }, .5, .5, 'paused')));
  reject(reader, p8(publication(scene, 1, 1, 'go', true, [])));
  assert.equal(push(reader, [p8(exitScene(scene, 1, .5))]).length, 1);
});
test('successful exit requires matching snapshot reason and exact time; finished count must match', () => {
  for (const reason of ['switch', 'finished']) {
    const { plan, reader, scene } = running(), exit = p8(exitScene(scene, 1, .5, reason === 'switch' ? plan.scenes[1] : undefined));
    reject(reader, exit); assert.equal(push(reader, [frame(plan, { reason })]).length, 1);
    reject(reader, { ...exit, elapsedSeconds: .6 }); assert.equal(push(reader, [exit]).length, 1);
  }
  const view = finished(); assert.equal(view.project.animationStates.sequence, 1); assert.deepEqual(queryProjectRuntimeObservation(view), view);
  const { plan, reader, scene } = running(); push(reader, [frame(plan), p8(exitScene(scene, 1, .5))]);
  const finish = { protocol: 8, event: 'finished', assemblyId: plan.assembly.objectId, visitCount: 1, totalSeconds: .5,
    stateRevision: 0, eventSequence: 0, audioCommandSequence: 0, animationCommandSequence: 0, animationCompletionSequence: 0, animationStateSequence: 0 };
  reject(reader, finish); finish.animationStateSequence = 1; assert.equal(push(reader, [finish]).length, 1);
});
test('scene reentry owns a fresh snapshot while unobserved scenes need no empty snapshot', () => {
  const { plan, reader, scene } = running(), other = plan.scenes[1];
  const frames = [frame(plan, { reason: 'switch' }), p8(exitScene(scene, 1, .5, other)), p8(enterScene(other, 2)), p8(readyScene(other, 2)),
    p8(exitScene(other, 2, 0, scene)), p8(enterScene(scene, 3)), p8(readyScene(scene, 3)), frame(plan, { sequence: 2, visitIndex: 3, timeSeconds: 0, stateIndex: 1 }), p8(exitScene(scene, 3, 0))];
  assert.equal(push(reader, frames).length, frames.length); assert.deepEqual(reader.animationStates.entries.map(entry => entry.visitIndex), [1, 3]);
});
test('aborted observations require a diagnostic and preserve the real inactive snapshot; unfinished runs do not synthesize one', () => {
  const { plan, reader, scene } = running(); reader.finish(); assert.deepEqual(reader.animationStates, { sequence: 0, entries: [] });
  const failed = running(plan).reader, binding = scene.behaviors.bindings[0];
  const diagnostic = p8(sceneFrame(scene, 1, { protocol: 3, event: 'diagnostic', severity: 'error', code: 'runtime_behavior_script', message: 'failed',
    bindingId: binding.bindingId, instanceId: binding.instanceId, objectId: binding.objectId }));
  assert.equal(push(failed, [diagnostic]).length, 1); assert.equal(push(failed, [frame(plan, { reason: 'aborted', status: 'inactive' })]).length, 1);
  reject(failed, p8(exitScene(scene, 1, .5))); assert.equal(failed.animationStates.entries[0].reason, 'aborted');
});
test('snapshot DTOs reject unsafe descriptors, unknown keys, invalid origins, stale sources and typed-state contradictions', () => {
  const original = finished().project.animationStates;
  for (const mutate of [v => v.extra = true, v => v.sequence = 0, v => v.entries[0].controllers[0].stateKey = 'No',
    v => v.entries[0].controllers[0].status = 'inactive', v => v.entries[0].controllers[0].scriptSource.propertyPath = '/x',
    v => v.entries[0].controllers[0].origin.visitIndex = 2, v => v.entries[0].controllers[0].scriptSource.sourcePath = '../escape',
    v => v.entries[0].controllers[0].clipId = true, v => v.entries[0].controllers[0].engineNode = '/root']) {
    const value = clone(original); mutate(value); assert.throws(() => validateProjectAnimationStatesSnapshot(value));
  }
  let calls = 0; const value = clone(original); Object.defineProperty(value, 'entries', { enumerable: true, get() { calls++; return []; } });
  assert.throws(() => validateProjectAnimationStatesSnapshot(value)); assert.equal(calls, 0);
  const detached = validateProjectAnimationStatesSnapshot(original); detached.entries[0].controllers[0].stateKey = 'changed'; assert.equal(original.entries[0].controllers[0].stateKey, 'idle');
});
test('p8 query links snapshots to visit boundary and command cutoff, and p7 keeps its exact old shape', () => {
  const original = finished();
  for (const mutate of [v => v.project.animationStates.entries[0].timeSeconds = .4, v => v.project.animationStates.entries[0].sceneId = runtimeId(999),
    v => v.project.animationStates.entries[0].commandSequence = 1, v => v.project.animationStates.entries[0].reason = 'aborted',
    v => delete v.project.animationStates, v => v.project.protocolVersion = 7]) {
    const value = clone(original); mutate(value); assert.throws(() => queryProjectRuntimeObservation(value));
  }
  const plan = completionProject(), old = createProjectRuntimeObservation(plan, { protocolVersion: 7 });
  for (const event of completionRun(plan)) assert.equal(old.push(event), true);
  assert.equal(Object.hasOwn(old.snapshot().project, 'animationStates'), false); assert.deepEqual(queryProjectRuntimeObservation(old.snapshot()), old.snapshot());
  assert.equal(old.push({ ...frame(fixture()), protocol: 7 }), false);
});

test('project protocol 8 descriptor preserves mandatory animation completion capability', () => {
  const plan = fixture(), descriptor = {
    format: 'viento-execution-backend', schemaVersion: 1, id: 'org.viento.godot4', label: 'Godot 4', version: '0.17.0', platforms: ['linux'],
    plans: [{ kind: 'scene2d', schemaVersion: 3, runtimeProtocolVersion: 3 }, { kind: 'project', schemaVersion: 1, runtimeProtocolVersion: 8 }],
    capabilities: [...plan.requiredCapabilities, 'behavior.bindings', 'behavior.gdscript', 'project.animation-control'],
    execution: { build: true, headlessLogic: true, windowPreview: true, windowCapture: true, offscreenRender: false, embeddedViewport: false, gpuCompute: false }, extensions: [],
  };
  assert.equal(validateExecutionBackendDescriptor(descriptor).plans[1].runtimeProtocolVersion, 8);
  assert.ok(checkExecutionBackendSupport(descriptor, { operation: 'build', plan }).some(item => item.capability === 'project.animation-completion'));
  descriptor.capabilities.push('project.animation-completion');
  assert.equal(checkExecutionBackendSupport(descriptor, { operation: 'build', plan }).some(item => item.capability === 'project.animation-completion'), false);
});

test('p8 completion and command histories retain ordered receipts while state samples carry the exact cutoff', () => {
  const plan = fixture(), scene = plan.scenes[0], next = scene.animation.document.clips[1].id;
  scene.behaviors.bindings[0].parameters.clip_action = next;
  const frames = completionRun(plan).map(p8); frames.splice(-2, 0, frame(plan, { commandSequence: 4, stateIndex: 1 })); frames.at(-1).animationStateSequence = 1;
  const observation = createProjectRuntimeObservation(plan, { protocolVersion: 8 });
  for (const event of frames) assert.equal(observation.push(event), true, JSON.stringify(event));
  const snapshot = observation.snapshot(); assert.deepEqual(queryProjectRuntimeObservation(snapshot), snapshot);
  assert.equal(snapshot.project.animationStates.entries[0].controllers[0].stateKey, 'action');
  for (const commandSequence of [0, 2, 3, 5]) {
    const forged = clone(snapshot); forged.project.animationStates.entries[0].commandSequence = commandSequence;
    assert.throws(() => queryProjectRuntimeObservation(forged));
  }
});
test('snapshot budget admits exactly 64 batches and 2048 scoped controllers without merging identities', () => {
  const plan = fixture(), scene = plan.scenes[0], first = scene.behaviors.bindings[0];
  scene.behaviors.bindings = Array.from({ length: 32 }, (_, index) => ({ ...clone(first), bindingId: runtimeId(1000 + index),
    declaration: { ...first.declaration, propertyPath: `/bindings/${index}` } }));
  const ledger = createProjectAnimationStates(plan);
  for (let sequence = 1; sequence <= 64; sequence++) {
    const { protocol, event, ...value } = frame(plan, { sequence, visitIndex: sequence, reason: sequence === 64 ? 'finished' : 'switch' }); ledger.append(value);
  }
  assert.equal(ledger.snapshot().entries.reduce((sum, entry) => sum + entry.controllers.length, 0), 2048);
  assert.deepEqual(validateProjectAnimationStatesSnapshot(ledger.snapshot()), ledger.snapshot());
  const before = ledger.snapshot(), { protocol, event, ...overflow } = frame(plan, { sequence: 65, visitIndex: 65 });
  assert.throws(() => ledger.append(overflow)); assert.deepEqual(ledger.snapshot(), before);
});
