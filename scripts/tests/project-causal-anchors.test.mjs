import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createProjectCausalAnchors } from '../../engine/project-causal-anchors.mjs';
import { createProjectRuntimeObservation } from '../../engine/project-runtime-query.mjs';
import { createProjectAnimationStateCatalog } from '../../engine/project-animation-states.mjs';
import { generateEditableGodotAnimationStateScript } from '../../engine/animation-state-script-source.mjs';
import { DEFAULT_ANIMATION_STATE_TABLE } from '../../engine/godot-animation-state-script.mjs';
import { completionProject, completionStart, completionCommand, animationCompleted, completionDelivery } from './helpers/project-animation-completion-fixture.mjs';
import { publication, delivery } from './helpers/project-event-bus-fixture.mjs';
import { runtimeProject, runtimeId, enterScene, readyScene, exitScene } from './helpers/project-runtime-fixture.mjs';

const clone = value => structuredClone(value);
const invalid = { errorCode: 'project_causal_anchors_invalid' };
const ids = view => view.nodes.map(node => node.id);
const root = (view, id) => view.roots.find(item => item.id === id);
function fixture({ controllers = false, targeted = false, protocolVersion = controllers ? 10 : targeted ? 11 : 7 } = {}) {
  const plan = completionProject(), scene = plan.scenes[0];
  if (controllers) {
    scene.behaviors.sources[0].content = generateEditableGodotAnimationStateScript(DEFAULT_ANIMATION_STATE_TABLE).content;
    scene.behaviors.bindings[0].parameters = {};
  }
  if (targeted) {
    const animation = scene.animation;
    animation.schemaVersion = 3; animation.document.schemaVersion = 4; animation.document.playbackScope = 'instance';
    const track = { ...clone(animation.document.tracks[0]), id: runtimeId(901), instanceId: scene.actors[1].instanceId };
    animation.document.tracks.push(track); animation.locations.tracks.push({ id: track.id, declaration: { ...animation.manifest, propertyPath: '/tracks/1' } });
    const binding = clone(scene.behaviors.bindings[0]), actor = scene.actors[1];
    binding.bindingId = runtimeId(911); binding.instanceId = actor.instanceId; binding.objectId = actor.objectId;
    binding.declaration.propertyPath = '/bindings/1'; scene.behaviors.bindings.push(binding);
    scene.requiredCapabilities.push('animation.instances2d');
    plan.requiredCapabilities = [...new Set(['project.scenes', ...plan.scenes.flatMap(item => item.requiredCapabilities)])].sort();
  }
  const catalog = createProjectAnimationStateCatalog(plan).scenes[0]?.controllers ?? [];
  const observer = createProjectRuntimeObservation(plan, { protocolVersion });
  const convert = frame => ({ ...frame, protocol: protocolVersion, ...(['ready', 'finished'].includes(frame.event) ? {
    ...(protocolVersion >= 8 ? { animationStateSequence: 0 } : {}), ...(protocolVersion >= 9 ? { animationStateEntrySequence: 0 } : {}),
  } : {}) });
  const push = (...frames) => { for (const frame of frames) assert.equal(observer.push(convert(frame)), true, JSON.stringify(frame)); };
  const target = binding => ({ kind: 'instance', instanceId: scene.behaviors.bindings[binding].instanceId });
  const command = (sequence, action, { binding = 0, time = 0, position = 0, phase = 'paused', clipId = null, visit = 1 } = {}) => {
    const frame = completionCommand(scene, visit, sequence, action, time, position, phase, clipId);
    const { bindingId, instanceId, objectId } = scene.behaviors.bindings[binding];
    return { ...frame, bindingId, instanceId, objectId, ...(targeted ? { target: target(binding) } : {}) };
  };
  const completed = (sequence, cutoff, { anchor = cutoff, binding = 0, time = scene.animation.document.durationSeconds, clipId = null, tokens = [], visit = 1 } = {}) => {
    const frame = animationCompleted(scene, visit, sequence, cutoff, time, clipId, []);
    const { bindingId, instanceId, objectId } = scene.behaviors.bindings[binding];
    return { ...frame, recipients: tokens.map(subscriptionId => ({ subscriptionId, bindingId, instanceId, objectId })),
      ...(targeted ? { target: target(binding), targetCommandSequence: anchor } : {}) };
  };
  const entry = (sequence, trigger = { kind: 'direct' }, { commandSequence = 0, binding = 0, time = 0, visit = 1 } = {}) => {
    const { bindingId, instanceId, objectId } = catalog[binding];
    return { event: 'animation-state-entered', sequence, visitIndex: visit, sceneId: scene.scene.objectId,
      timeSeconds: time, commandSequence, bindingId, instanceId, objectId, stateIndex: 0, clipId: catalog[binding].clips[0],
      ...(protocolVersion >= 10 ? { trigger } : {}) };
  };
  push(...completionStart(plan));
  return { plan, scene, observer, push, command, completed, entry, convert,
    view: () => observer.snapshot(), anchors: (recentPerKind = 0) => createProjectCausalAnchors(observer.snapshot(), { recentPerKind }) };
}
function deepFrozen(value) {
  if (value && typeof value === 'object') { assert.equal(Object.isFrozen(value), true); for (const child of Object.values(value)) deepFrozen(child); }
}

test('legacy empty observations produce a detached deterministic empty anchor DTO', () => {
  const plan = runtimeProject(), observation = createProjectRuntimeObservation(plan).snapshot();
  const value = createProjectCausalAnchors(observation);
  assert.equal(value.format, 'viento-project-causal-anchors'); assert.equal(value.schemaVersion, 1);
  assert.equal(value.assemblyId, plan.assembly.objectId); assert.equal(value.protocolVersion, 1); assert.equal(value.recentPerKind, 16);
  assert.deepEqual(value.nodes, []); assert.deepEqual(value.edges, []); assert.deepEqual(value.roots, []);
  for (const count of Object.values(value.retention)) assert.deepEqual(count, { total: 0, retained: 0, dropped: 0 });
  deepFrozen(value); assert.deepEqual(createProjectCausalAnchors(observation), value);
});

test('pending event roots survive a short recent tail and settle without renumbering old identities', () => {
  const f = fixture(); f.push(publication(f.scene, 1, 1, 'pending', true));
  for (let sequence = 2; sequence <= 20; sequence++) f.push(publication(f.scene, 1, sequence, 'tail', sequence, []));
  const pending = f.anchors(2);
  assert.deepEqual(ids(pending), ['events:1', 'events:19', 'events:20']);
  assert.deepEqual(root(pending, 'events:1').reasons, ['pending-delivery']);
  assert.deepEqual(pending.retention.events, { total: 20, retained: 3, dropped: 17 });
  assert.deepEqual(pending.retention.aggregate, pending.retention.events);
  f.push(delivery(f.scene, 1, 1, 1));
  assert.deepEqual(ids(f.anchors(2)), ['events:19', 'events:20']);
  assert.equal(pending.nodes[0].record.deliveries[0].status, 'pending');
  assert.deepEqual(f.anchors().nodes, []);
});

test('skipped event receipts release pending roots while retained records preserve the actual outcome', () => {
  const f = fixture(); f.push(publication(f.scene, 1, 1, 'event', false));
  assert.deepEqual(root(f.anchors(1), 'events:1').reasons, ['recent', 'pending-delivery']);
  f.push(delivery(f.scene, 1, 1, 1, 'skipped'));
  assert.deepEqual(f.anchors().nodes, []);
  assert.equal(f.anchors(1).nodes[0].record.deliveries[0].status, 'skipped');
});

test('a latest state entry pins its handled trigger and global command watermark until replaced', () => {
  const f = fixture({ controllers: true });
  f.push(f.command(1, { action: 'pause' }), publication(f.scene, 1, 1, 'action', false),
    f.entry(1, { kind: 'event', eventSequence: 1, subscriptionId: 1 }, { commandSequence: 1 }), delivery(f.scene, 1, 1, 1));
  const value = f.anchors();
  assert.deepEqual(ids(value), ['events:1', 'animationCommands:1', 'animationStateEntries:1']);
  assert.equal(root(value, 'events:1'), undefined);
  assert.deepEqual(root(value, 'animationStateEntries:1').reasons, ['latest-controller-entry']);
  assert.deepEqual(value.edges, [
    { from: 'animationStateEntries:1', to: 'events:1', relation: 'trigger' },
    { from: 'animationStateEntries:1', to: 'animationCommands:1', relation: 'global-watermark' },
  ]);
  f.push(f.entry(2, { kind: 'direct' }, { commandSequence: 1 }));
  assert.deepEqual(ids(f.anchors()), ['animationCommands:1', 'animationStateEntries:2']);
});

test('a pending callback may already have an entry and subsequent handled status retains the trigger closure', () => {
  const f = fixture({ controllers: true });
  f.push(publication(f.scene, 1, 1, 'action', false), f.entry(1, { kind: 'event', eventSequence: 1, subscriptionId: 1 }));
  const before = f.anchors(); assert.deepEqual(root(before, 'events:1').reasons, ['pending-delivery']);
  f.push(delivery(f.scene, 1, 1, 1));
  const after = f.anchors(); assert.deepEqual(ids(after), ids(before)); assert.equal(root(after, 'events:1'), undefined);
  assert.equal(after.nodes[0].record.deliveries[0].status, 'handled');
  assert.equal(before.nodes[0].record.deliveries[0].status, 'pending');
});

test('state completion triggers retain a superseded completion and its precise command evidence', () => {
  const f = fixture({ controllers: true }), clipId = f.scene.animation.document.clips[0].id;
  f.push(f.command(1, { action: 'select', clipId }, { clipId }), f.command(2, { action: 'play' }, { clipId, phase: 'playing' }),
    f.completed(1, 2, { clipId, time: .4, tokens: [1] }),
    f.entry(1, { kind: 'completed', completionSequence: 1, subscriptionId: 1 }, { commandSequence: 2, time: .4 }),
    completionDelivery(f.scene, 1, 1), f.command(3, { action: 'select', clipId }, { clipId, time: .4 }));
  const value = f.anchors();
  assert.deepEqual(ids(value), ['animationCommands:2', 'animationCommands:3', 'animationCompletions:1', 'animationStateEntries:1']);
  assert.equal(root(value, 'animationCompletions:1'), undefined);
  assert.deepEqual(value.edges, [
    { from: 'animationCompletions:1', to: 'animationCommands:2', relation: 'global-watermark' },
    { from: 'animationCompletions:1', to: 'animationCommands:2', relation: 'playback-command' },
    { from: 'animationStateEntries:1', to: 'animationCompletions:1', relation: 'trigger' },
    { from: 'animationStateEntries:1', to: 'animationCommands:2', relation: 'global-watermark' },
  ]);
});

test('instance target baselines keep the global cutoff separate from the actual target playback command', () => {
  const f = fixture({ targeted: true }), clipId = f.scene.animation.document.clips[0].id;
  f.push(f.command(1, { action: 'select', clipId }, { binding: 1, clipId }),
    f.command(2, { action: 'play' }, { binding: 1, clipId, phase: 'playing' }),
    f.command(3, { action: 'select', clipId }, { clipId }),
    f.command(4, { action: 'play' }, { clipId, phase: 'playing' }),
    f.completed(1, 4, { binding: 1, anchor: 2, clipId, time: .4 }));
  const value = f.anchors();
  assert.deepEqual(ids(value), ['animationCommands:2', 'animationCommands:4', 'animationCompletions:1']);
  assert.deepEqual(value.edges, [
    { from: 'animationCompletions:1', to: 'animationCommands:4', relation: 'global-watermark' },
    { from: 'animationCompletions:1', to: 'animationCommands:2', relation: 'playback-command' },
  ]);
  assert.deepEqual(root(value, 'animationCommands:4').reasons, ['target-baseline']);
  assert.deepEqual(root(value, 'animationCompletions:1').reasons, ['target-baseline']);
  f.push(f.command(5, { action: 'select', clipId }, { binding: 1, clipId, time: .4 }));
  assert.deepEqual(ids(f.anchors()), ['animationCommands:4', 'animationCommands:5']);
});

test('superseded pending completions retain their commands until skipped without retiring the subscription', () => {
  const f = fixture(), clipId = f.scene.animation.document.clips[0].id;
  f.push(f.command(1, { action: 'select', clipId }, { clipId }), f.command(2, { action: 'play' }, { clipId, phase: 'playing' }),
    f.completed(1, 2, { time: .4, clipId, tokens: [1] }), f.command(3, { action: 'select', clipId }, { time: .4, clipId }));
  const pending = f.anchors();
  assert.deepEqual(root(pending, 'animationCompletions:1').reasons, ['pending-delivery']);
  assert.deepEqual(ids(pending), ['animationCommands:2', 'animationCommands:3', 'animationCompletions:1']);
  assert.equal(f.observer.push(f.convert(completionDelivery(f.scene, 1, 1))), false);
  assert.deepEqual(f.anchors(), pending);
  f.push(completionDelivery(f.scene, 1, 1, 1, 'skipped'));
  assert.deepEqual(ids(f.anchors()), ['animationCommands:3']);
  f.push(f.command(4, { action: 'play' }, { time: .4, clipId, phase: 'playing' }),
    f.completed(2, 4, { time: .8, clipId, tokens: [1] }), completionDelivery(f.scene, 1, 2));
  assert.equal(f.anchors().nodes.find(node => node.kind === 'animationCompletions').record.deliveries[0].status, 'handled');
});

test('whole-scene autoplay on reentry preserves an old global cutoff without inventing a playback command', () => {
  const f = fixture(), second = f.plan.scenes[1];
  f.push(f.command(1, { action: 'pause' }), exitScene(f.scene, 1, 0, second), enterScene(second, 2), readyScene(second, 2),
    exitScene(second, 2, 0, f.scene), enterScene(f.scene, 3), readyScene(f.scene, 3), f.completed(1, 1, { visit: 3 }));
  const value = f.anchors();
  assert.deepEqual(ids(value), ['animationCommands:1', 'animationCompletions:1']);
  assert.deepEqual(value.edges, [{ from: 'animationCompletions:1', to: 'animationCommands:1', relation: 'global-watermark' }]);
  f.push(exitScene(f.scene, 3, f.scene.animation.document.durationSeconds, second));
  assert.deepEqual(f.anchors().nodes, []);
  const retained = f.anchors(1); assert.deepEqual(ids(retained), ids(value));
  assert.deepEqual(retained.roots.map(item => item.reasons), [['recent'], ['recent']]);
});

test('legacy state entries retain watermarks while unavailable triggers remain absent', () => {
  const f = fixture({ controllers: true, protocolVersion: 9 });
  f.push(f.command(1, { action: 'pause' }), f.entry(1, undefined, { commandSequence: 1 }));
  const value = f.anchors(1);
  assert.equal(value.protocolVersion, 9);
  assert.deepEqual(root(value, 'animationStateEntries:1').reasons, ['recent', 'latest-controller-entry']);
  assert.deepEqual(value.edges, [{ from: 'animationStateEntries:1', to: 'animationCommands:1', relation: 'global-watermark' }]);
});

test('projection detaches complete frozen source records without mutating the observation', () => {
  const f = fixture(); f.push(publication(f.scene, 1, 1, 'event', 'frozen source'));
  const input = f.view(), before = clone(input), value = createProjectCausalAnchors(input, { recentPerKind: 64 });
  assert.deepEqual(input, before); assert.notEqual(value.nodes[0].record, input.project.events.entries[0]);
  assert.deepEqual(value.nodes[0].record, input.project.events.entries[0]); deepFrozen(value);
  input.project.events.entries[0].origin.source.sourcePath = 'changed.txt';
  assert.equal(value.nodes[0].record.origin.source.sourcePath, before.project.events.entries[0].origin.source.sourcePath);
  assert.deepEqual(root(value, 'events:1').reasons, ['recent', 'pending-delivery']);
});

test('malformed observations and invalid option shapes are rejected before caller-owned getters run', () => {
  const f = fixture(); f.push(publication(f.scene, 1, 1, 'event', true));
  for (const options of [null, [], 3, { extra: 1 }, { recentPerKind: -1 }, { recentPerKind: 65 }, { recentPerKind: 1.5 }, { recentPerKind: Infinity }, { recentPerKind: '2' }, { recentPerKind: undefined }]) {
    assert.throws(() => createProjectCausalAnchors(f.view(), options), invalid);
  }
  let called = 0;
  assert.throws(() => createProjectCausalAnchors(f.view(), { get recentPerKind() { called++; return 1; } }), invalid);
  assert.throws(() => createProjectCausalAnchors({ get project() { called++; return f.view().project; } }), invalid);
  const getter = f.view(); Object.defineProperty(getter.project.events.entries[0], 'value', { enumerable: true, get() { called++; return true; } });
  assert.throws(() => createProjectCausalAnchors(getter), invalid); assert.equal(called, 0);
  const forged = f.view(); forged.project.events.entries[0].origin.source.sourceRevision = 'forged';
  assert.throws(() => createProjectCausalAnchors(forged), invalid);
  const sparse = f.view(); sparse.project.events.entries = [];
  assert.throws(() => createProjectCausalAnchors(sparse), invalid);
  assert.throws(() => createProjectCausalAnchors({ project: f.view().project }), invalid);
});
