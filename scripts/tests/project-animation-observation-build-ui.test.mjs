import { createProjectAnimationTargetReview, queryProjectAnimationTargetReview, findProjectAnimationTargetReview } from '../../engine/project-animation-target-review.mjs';
import { createProjectEventReview, queryProjectEventReview } from '../../engine/project-event-review.mjs';
import { describeProjectAnimationStateEntryTrigger } from '../../web/modules/app-project-animation-state-trigger.js';
import { validateProjectAnimationStateTriggeredEntriesSnapshot } from '../../engine/project-animation-state-entry-triggers.mjs';
import { createProjectAnimationStateReview, queryProjectAnimationStateReview } from '../../engine/project-animation-state-review.mjs';
import { validateProjectAnimationStateEntriesSnapshot } from '../../engine/project-animation-state-entries.mjs';
import { validateProjectAnimationStatesSnapshot } from '../../engine/project-animation-states.mjs';
import { validateProjectAnimationCompletionsSnapshot } from '../../engine/project-animation-completions.mjs';
import { validateProjectAnimationCommandsSnapshot } from '../../engine/project-animation-commands.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { dialogHarness, flushDialogs } from './dialog-harness.mjs';
import { deferred } from './editor-harness.mjs';
import { queryProjectRuntimeObservation } from '../../engine/project-runtime-query.mjs';
import { querySceneRuntimeObservation } from '../../engine/scene-runtime-query.mjs';

const id = n => `${String(n).padStart(8, '0')}-1111-4111-8111-111111111111`;
const assemblyId = id(1), first = id(2), second = id(3), backendId = 'org.viento.godot4';
const revision = `sha256:${'a'.repeat(64)}`, snapshotId = `sha256:${'b'.repeat(64)}`;
const source = { objectId: id(9), sourcePath: 'documents/behaviors/state.json', sourceRevision: revision, propertyPath: '/bindings/0' };
const origin = () => ({ visitIndex: 1, sceneId: first, bindingId: id(4), instanceId: id(5), objectId: id(6), source });
const trackSource = { objectId: id(20), sourcePath: 'documents/audio.json', sourceRevision: revision, propertyPath: '/tracks/0', sourceRange: { start: 15, end: 97, encoding: 'utf-16', propertyPath: '/tracks/0', exact: true } };
const audio = () => ({ sequence: 1, entries: [{ sequence: 1, action: 'play', timeSeconds: 0.25, origin: origin(), track: { trackId: id(30), resourceId: id(22), source: trackSource } }] });
const animationSource = { objectId: id(30), sourcePath: 'documents/animation.json', sourceRevision: revision, propertyPath: '' };
const animation = () => ({ sequence: 1, entries: [{ sequence: 1, command: { action: 'pause' },
  state: { sceneObjectId: first, phase: 'paused', positionSeconds: .25, timeSeconds: .25 }, origin: origin(),
  animation: { objectId: id(30), source: animationSource, durationSeconds: 1, loop: false } }] });
const completion = (version = 7) => ({ sequence: 1, entries: [{ sequence: 1, commandSequence: 1, visitIndex: 1, sceneId: first,
  ...(version === 11 ? { target: { kind: 'instance', instanceId: id(5) }, targetCommandSequence: 1 } : {}),
  state: { sceneObjectId: first, phase: 'finished', positionSeconds: 1, timeSeconds: 1, clipId: null },
  animation: animation().entries[0].animation, clip: null,
  deliveries: [{ subscriptionId: 1, origin: origin(), status: 'handled' }] }] });
const scriptSource = { objectId: id(40), sourcePath: 'documents/scripts/state.txt', sourceRevision: revision, propertyPath: '' };
const states = () => ({ sequence: 1, entries: [{ sequence: 1, visitIndex: 1, sceneId: first, timeSeconds: 2, commandSequence: 1, reason: 'switch',
  controllers: [{ origin: origin(), scriptSource, status: 'active', stateKey: 'idle', clipId: null }] }] });
const stateEntries = () => ({ sequence: 1, entries: [{ sequence: 1, origin: origin(), scriptSource, timeSeconds: .25, commandSequence: 1, stateKey: 'idle', clipId: null }] });
const protocolAnimation = version => {
  const value = animation();
  if (version >= 6) { value.entries[0].state.clipId = null; value.entries[0].clip = null; }
  if (version >= 7) { value.entries[0].command.action = 'play'; value.entries[0].state.phase = 'playing'; value.entries[0].state.positionSeconds = 0; value.entries[0].state.timeSeconds = 0; }
  if (version === 11) value.entries[0].target = { kind: 'instance', instanceId: id(5) };
  return value;
};
const trace = () => ({ sequence: 1, entries: [{ sequence: 1, name: 'checkpoint', value: '雨の鍵', origin: origin(),
  deliveries: [{ subscriptionId: 1, origin: { ...origin(), bindingId: id(10), source: { ...source, objectId: id(11), sourcePath: 'documents/behaviors/receiver.json' } }, status: 'handled' }] }] });
const shared = () => ({ revision: 1, entries: [{ key: 'note', value: '雨の鍵', revision: 1, origin: origin() }],
  lastChange: { operation: 'set', key: 'note', revision: 1, origin: origin() } });
function state({ protocolVersion = 5, task = 'run-1', active = second } = {}) {
  const visits = [{ index: 1, sceneId: first, phase: 'left', elapsedSeconds: 0.5 }, { index: 2, sceneId: second, phase: active === second ? 'ready' : 'left', elapsedSeconds: active === second ? 0 : 0.5 }];
  if (protocolVersion >= 7) visits[0].elapsedSeconds = 2;
  if (active === first) visits.push({ index: 3, sceneId: first, phase: 'ready', elapsedSeconds: 0 });
  return { supported: true, available: true, platform: 'linux',
    backend: { format: 'viento-execution-backend', schemaVersion: 1, id: backendId, version: '0.9.0', label: 'Godot', platforms: ['linux'],
      plans: [{ kind: 'project', schemaVersion: 1, runtimeProtocolVersion: 5 }, { kind: 'scene2d', schemaVersion: 1, runtimeProtocolVersion: 1 }],
      capabilities: ['scene2d'], execution: { build: true, headlessLogic: true, windowPreview: true, windowCapture: true, offscreenRender: false, embeddedViewport: false, gpuCompute: false }, extensions: [] },
    scenes: [{ id: assemblyId, kind: 'project', title: 'Project', sourcePath: 'documents/game.json', entrySceneId: first, sceneCount: 2 }],
    latestBuild: { id: 'build-1', backendId, sceneId: assemblyId, targetKind: 'project', targetId: assemblyId, snapshotId, entrySceneId: first, sceneCount: 2,
      scenes: [first, second].map((sceneId, index) => ({ sceneId, title: `Scene ${index}`, sourcePath: `documents/scenes/${index}.json`, sourceRevision: revision, planSchemaVersion: 1, runtimeProtocolVersion: 1 })) },
    job: { id: task, kind: 'run', status: 'running', phase: 'running', backendId, sceneId: assemblyId, targetKind: 'project', targetId: assemblyId,
      buildId: 'build-1', snapshotId, diagnostics: [], events: [], logs: '', runtime: {
        format: 'viento-runtime-observation', schemaVersion: 1, sceneObjectId: active, protocolVersion: 1, phase: 'ready', sequence: 1, actors: [],
        project: { assemblyId, entrySceneId: first, activeSceneId: active, visits, ...(protocolVersion === 1 ? {} : { protocolVersion, sharedState: shared(), ...(protocolVersion >= 3 ? { events: trace() } : {}), ...(protocolVersion >= 4 ? { audioCommands: audio() } : {}), ...(protocolVersion >= 5 ? { animationCommands: protocolAnimation(protocolVersion) } : {}), ...(protocolVersion >= 7 ? { animationCompletions: completion(protocolVersion) } : {}), ...(protocolVersion >= 8 ? { animationStates: states() } : {}), ...([9, 10, 11].includes(protocolVersion) ? { animationStateEntries: protocolVersion >= 10 ? { sequence: 1, entries: stateEntries().entries.map(entry => ({ ...entry, trigger: { kind: 'direct' } })) } : stateEntries() } : {}) }) },
      } },
  };
}
async function fixture(initial = state(), options = {}) {
  let payload = initial;
  const calls = [], opened = [], context = { editable: true, dirty: false, creating: false, busy: false, path: 'documents/game.json' };
  const h = await dialogHarness('app-project-build', { PROJECT_BUILD_API_PATH: '/api/project-build', createProjectAnimationTargetReview: value => createProjectAnimationTargetReview(JSON.parse(JSON.stringify(value))), queryProjectAnimationTargetReview, findProjectAnimationTargetReview, createProjectEventReview: value => createProjectEventReview(JSON.parse(JSON.stringify(value))), queryProjectEventReview, describeProjectAnimationStateEntryTrigger, validateProjectAnimationStateTriggeredEntriesSnapshot: value => JSON.parse(JSON.stringify(validateProjectAnimationStateTriggeredEntriesSnapshot(JSON.parse(JSON.stringify(value))))), createProjectAnimationStateReview: value => createProjectAnimationStateReview(JSON.parse(JSON.stringify(value))), queryProjectAnimationStateReview, validateProjectAnimationStateEntriesSnapshot: value => JSON.parse(JSON.stringify(validateProjectAnimationStateEntriesSnapshot(JSON.parse(JSON.stringify(value))))), validateProjectAnimationStatesSnapshot: value => JSON.parse(JSON.stringify(validateProjectAnimationStatesSnapshot(JSON.parse(JSON.stringify(value))))), validateProjectAnimationCompletionsSnapshot: (value, options) => JSON.parse(JSON.stringify(validateProjectAnimationCompletionsSnapshot(JSON.parse(JSON.stringify(value)), options))), validateProjectAnimationCommandsSnapshot: (value, options) => JSON.parse(JSON.stringify(validateProjectAnimationCommandsSnapshot(JSON.parse(JSON.stringify(value)), options))), queryProjectRuntimeObservation, querySceneRuntimeObservation,
    fetchJsonApiRequest: async (url, request) => { calls.push(request.body ? JSON.parse(request.body) : null); return { payload }; } });
  for (const name of ['app-project-state-observation', 'app-project-event-observation', 'app-project-event-review', 'app-project-audio-observation', 'app-project-animation-observation', 'app-project-animation-completion-observation', 'app-project-animation-target-review', 'app-project-animation-state-observation', 'app-project-animation-state-review', 'app-project-animation-state-entry-observation']) {
    const module = (await fs.readFile(new URL(`../../web/modules/${name}.js`, import.meta.url), 'utf8'))
      .replace(/^import[^\n]+\n/gm, '').replaceAll('export ', '');
    vm.runInContext(module, h.runtime);
  }
  const controller = h.runtime.setupProjectBuild({ getContext: () => context,
    openSource: (...args) => { opened.push(args); return options.openSource ? options.openSource(...args) : true; } });
  controller.setAvailable(true); h.element('projectBuildBtn').click(); await flushDialogs();
  return { ...h, context, controller, calls, opened, async refresh(next) { payload = next; h.element('projectBuildRefresh').click(); await flushDialogs(); },
    targetEl: suffix => h.element('projectAnimationTargetReview' + suffix), el: suffix => h.element('projectAnimationCommands' + suffix), eventReviewEl: suffix => h.element('projectEventReview' + suffix), reviewEl: suffix => h.element('projectAnimationStateReview' + suffix), animationEntryEl: suffix => h.element('projectAnimationStateEntries' + suffix), animationStateEl: suffix => h.element('projectAnimationStates' + suffix), completionEl: suffix => h.element('projectAnimationCompletions' + suffix), audioEl: suffix => h.element('projectAudioCommands' + suffix), eventEl: suffix => h.element('projectEventTrace' + suffix), stateEl: suffix => h.element('projectSharedState' + suffix) };
}

test('protocol5 adds animation records while retaining audio, event and state panels; older protocols keep their presentations', async () => {
  const h = await fixture(); assert.equal(h.el('Panel').hidden, false); assert.equal(h.el('Sequence').dataset.sequence, '1');
  assert.equal(h.eventEl('Panel').hidden, false); assert.equal(h.stateEl('Panel').hidden, false);
  assert.equal(h.audioEl('Panel').hidden, false);
  await h.refresh(state({ protocolVersion: 4 })); assert.equal(h.el('Panel').hidden, true); assert.equal(h.audioEl('Panel').hidden, false);
  await h.refresh(state({ protocolVersion: 3 })); assert.equal(h.el('Panel').hidden, true); assert.equal(h.eventEl('Panel').hidden, false); assert.equal(h.stateEl('Panel').hidden, false);
  await h.refresh(state({ protocolVersion: 2 })); assert.equal(h.el('Panel').hidden, true); assert.equal(h.eventEl('Panel').hidden, true); assert.equal(h.stateEl('Panel').hidden, false);
  await h.refresh(state({ protocolVersion: 1 })); assert.equal(h.el('Panel').hidden, true); assert.equal(h.eventEl('Panel').hidden, true); assert.equal(h.stateEl('Panel').hidden, true);
  const invalid = state(); invalid.job.runtime.project.animationCommands.entries[0].command.action = 'invalid';
  await h.refresh(invalid); assert.equal(h.el('Panel').hidden, true); assert.equal(h.el('Entries').children.length, 0);
});

test('animation history retains past visit provenance and filters but a new task clears the filter', async () => {
  const h = await fixture(), search = h.el('Search'); search.value = id(30); search.dispatch('input');
  await h.refresh(state({ active: first })); assert.equal(search.value, id(30)); assert.match(h.el('Entries').children[0].textContent, /第 1 次访问/);
  await h.refresh(state({ task: 'run-2' })); assert.equal(search.value, ''); assert.equal(h.el('Sequence').dataset.sequence, '1');
  assert.ok(h.calls.every(call => call === null));
});

test('behavior and animation source reads preserve their distinct provenance and optional exact range through own-loading and receipt appends', async () => {
  for (const kind of ['behavior', 'animation']) {
    const read = deferred(), writes = []; let h;
    h = await fixture(state(), { openSource: async (path, location, context) => {
      h.context.busy = true; h.controller.setAvailable(true);
      try { await read.promise; if (!context.isCurrent()) return false; writes.push(path); return true; }
      finally { h.context.busy = false; }
    } });
    h.el('Entries').querySelector('.project-animation-' + kind + '-source').click(); await flushDialogs();
    const expected = kind === 'behavior' ? source : animationSource;
    assert.equal(h.opened.length, 1); assert.equal(h.opened[0][0], expected.sourcePath);
    assert.deepEqual(JSON.parse(JSON.stringify(h.opened[0][1])), expected); assert.equal(h.opened[0][2].isCurrent(), true);
    const next = state(); next.job.runtime.project.animationCommands.sequence = 2;
    next.job.runtime.project.animationCommands.entries.push({ ...animation().entries[0], sequence: 2, command: { action: 'stop' }, state: { sceneObjectId: first, phase: 'stopped', positionSeconds: 0, timeSeconds: .5 } });
    await h.refresh(next); assert.equal(h.opened[0][2].isCurrent(), true);
    read.resolve(); await flushDialogs(); await flushDialogs(); assert.deepEqual(writes, [expected.sourcePath]); assert.equal(h.element('projectBuildDialog').open, false);
  }
});

test('initial busy and late draft, creation, task and visit changes guard the actual animation-source host port', async () => {
  for (const change of ['dirty', 'creating', 'visit', 'task']) {
    const read = deferred(), writes = []; let h;
    h = await fixture(state(), { openSource: async (path, location, context) => {
      h.context.busy = true;
      try { await read.promise; if (!context.isCurrent()) return false; writes.push(path); return true; }
      finally { h.context.busy = false; }
    } });
    const button = () => h.el('Entries').querySelector('.project-animation-animation-source');
    h.context.busy = true; button().dispatch('click'); await flushDialogs(); assert.equal(h.opened.length, 0);
    h.context.busy = false; h.controller.setAvailable(true); button().click(); await flushDialogs();
    if (change === 'dirty' || change === 'creating') h.context[change] = true;
    else await h.refresh(state(change === 'visit' ? { active: first } : { task: 'run-2' }));
    assert.equal(h.opened[0][2].isCurrent(), false, change);
    read.resolve(); await flushDialogs(); assert.deepEqual(writes, [], change); assert.equal(h.element('projectBuildDialog').open, true);
  }
});


test('protocol7 completion panel coexists with commands audio events and state while protocols1–6 hide completions', async () => {
  const h = await fixture(state({ protocolVersion: 7 }));
  for (const el of [h.completionEl, h.el, h.audioEl, h.eventEl, h.stateEl]) assert.equal(el('Panel').hidden, false);
  assert.match(h.completionEl('Entries').textContent, /自然完成/); assert.equal(h.completionEl('Sequence').dataset.sequence, '1');
  assert.match(h.el('Entries').textContent, /完整动画/); assert.match(h.el('Entries').textContent, /已执行播放命令/);
  for (const protocolVersion of [6, 5, 4, 3, 2, 1]) {
    await h.refresh(state({ protocolVersion })); assert.equal(h.completionEl('Panel').hidden, true);
    assert.equal(h.el('Panel').hidden, protocolVersion < 5); assert.equal(h.audioEl('Panel').hidden, protocolVersion < 4);
    assert.equal(h.eventEl('Panel').hidden, protocolVersion < 3); assert.equal(h.stateEl('Panel').hidden, protocolVersion < 2);
  }
  assert.ok(h.calls.every(call => call === null));
});

test('actual completion source host preserves frozen identities through its own loading state', async () => {
  for (const kind of ['animation', 'subscriber']) {
    const read = deferred(), writes = []; let h;
    h = await fixture(state({ protocolVersion: 7 }), { openSource: async (path, location, context) => {
      h.context.busy = true; h.controller.setAvailable(true);
      try { await read.promise; if (!context.isCurrent()) return false; writes.push(path); return true; }
      finally { h.context.busy = false; }
    } });
    h.completionEl('Entries').querySelector('.project-animation-completion-' + kind + '-source').click(); await flushDialogs();
    const expected = kind === 'animation' ? animationSource : source;
    assert.equal(h.opened.length, 1); assert.equal(h.opened[0][0], expected.sourcePath);
    assert.deepEqual(JSON.parse(JSON.stringify(h.opened[0][1])), expected); assert.equal(h.opened[0][2].isCurrent(), true);
    await h.refresh(state({ protocolVersion: 7 })); assert.equal(h.opened[0][2].isCurrent(), true);
    read.resolve(); await flushDialogs(); await flushDialogs(); assert.deepEqual(writes, [expected.sourcePath]); assert.equal(h.element('projectBuildDialog').open, false);
  }
});

test('completion source host revokes delayed reads after draft creation visit task or close changes', async () => {
  for (const change of ['dirty', 'creating', 'visit', 'task', 'close']) {
    const read = deferred(), writes = []; let h;
    h = await fixture(state({ protocolVersion: 7 }), { openSource: async (path, location, context) => {
      h.context.busy = true;
      try { await read.promise; if (!context.isCurrent()) return false; writes.push(path); return true; }
      finally { h.context.busy = false; }
    } });
    h.completionEl('Entries').querySelector('.project-animation-completion-animation-source').click(); await flushDialogs();
    if (change === 'dirty' || change === 'creating') h.context[change] = true;
    else if (change === 'close') h.element('projectBuildDialog').close();
    else await h.refresh(state({ protocolVersion: 7, ...(change === 'visit' ? { active: first } : { task: 'run-2' }) }));
    assert.equal(h.opened[0][2].isCurrent(), false, change); read.resolve(); await flushDialogs(); assert.deepEqual(writes, [], change);
  }
});


test('protocol8 adds accepted-state snapshots beside all prior panels and protocols1–7 never fabricate a snapshot panel', async () => {
  const h = await fixture(state({ protocolVersion: 8 }));
  for (const el of [h.animationStateEl, h.completionEl, h.el, h.audioEl, h.eventEl, h.stateEl]) assert.equal(el('Panel').hidden, false);
  assert.match(h.animationStateEl('Entries').textContent, /脚本已接受状态：idle/);
  assert.match(h.animationStateEl('Entries').textContent, /截至已执行动画命令序号：1/);
  assert.equal(h.animationStateEl('Sequence').dataset.sequence, '1');
  const empty = state({ protocolVersion: 8 }); empty.job.runtime.project.animationStates = { sequence: 0, entries: [] };
  await h.refresh(empty); assert.equal(h.animationStateEl('Panel').hidden, false); assert.match(h.animationStateEl('Empty').textContent, /尚未采集/);
  for (const protocolVersion of [7, 6, 5, 4, 3, 2, 1]) {
    await h.refresh(state({ protocolVersion })); assert.equal(h.animationStateEl('Panel').hidden, true);
    assert.equal(h.completionEl('Panel').hidden, protocolVersion < 7); assert.equal(h.el('Panel').hidden, protocolVersion < 5);
    assert.equal(h.audioEl('Panel').hidden, protocolVersion < 4); assert.equal(h.eventEl('Panel').hidden, protocolVersion < 3);
    assert.equal(h.stateEl('Panel').hidden, protocolVersion < 2);
  }
  assert.ok(h.calls.every(call => call === null));
});

test('snapshot binding and script sources use the actual build host port with exact identities through own-loading', async () => {
  for (const kind of ['binding', 'script']) {
    const read = deferred(), writes = []; let h;
    h = await fixture(state({ protocolVersion: 8 }), { openSource: async (path, location, context) => {
      h.context.busy = true; h.controller.setAvailable(true);
      try { await read.promise; if (!context.isCurrent()) return false; writes.push(path); return true; }
      finally { h.context.busy = false; }
    } });
    h.animationStateEl('Entries').querySelector('.project-animation-state-' + kind + '-source').click(); await flushDialogs();
    const expected = kind === 'binding' ? source : scriptSource;
    assert.equal(h.opened.length, 1); assert.equal(h.opened[0][0], expected.sourcePath);
    assert.deepEqual(JSON.parse(JSON.stringify(h.opened[0][1])), expected); assert.equal(h.opened[0][2].isCurrent(), true);
    await h.refresh(state({ protocolVersion: 8 })); assert.equal(h.opened[0][2].isCurrent(), true);
    read.resolve(); await flushDialogs(); await flushDialogs(); assert.deepEqual(writes, [expected.sourcePath]); assert.equal(h.element('projectBuildDialog').open, false);
  }
});

test('snapshot host navigation revokes delayed reads after dirty creation visit task close or snapshot replacement', async () => {
  for (const change of ['dirty', 'creating', 'visit', 'task', 'close', 'snapshot']) {
    const read = deferred(), writes = []; let h;
    h = await fixture(state({ protocolVersion: 8 }), { openSource: async (path, location, context) => {
      h.context.busy = true;
      try { await read.promise; if (!context.isCurrent()) return false; writes.push(path); return true; }
      finally { h.context.busy = false; }
    } });
    h.animationStateEl('Entries').querySelector('.project-animation-state-script-source').click(); await flushDialogs();
    if (change === 'dirty' || change === 'creating') h.context[change] = true;
    else if (change === 'close') h.element('projectBuildDialog').close();
    else if (change === 'snapshot') {
      const next = state({ protocolVersion: 8 }); next.job.runtime.project.animationStates.entries[0].controllers[0].scriptSource = { ...scriptSource, sourceRevision: snapshotId }; await h.refresh(next);
    } else await h.refresh(state({ protocolVersion: 8, ...(change === 'visit' ? { active: first } : { task: 'run-2' }) }));
    assert.equal(h.opened[0][2].isCurrent(), false, change); read.resolve(); await flushDialogs(); assert.deepEqual(writes, [], change);
  }
});

test('invalid state-snapshot timeline clears the admitted runtime display rather than showing stale states', async () => {
  const h = await fixture(state({ protocolVersion: 8 })), invalid = state({ protocolVersion: 8 });
  invalid.job.runtime.project.animationStates.entries[0].commandSequence = 2;
  await h.refresh(invalid);
  for (const el of [h.animationStateEl, h.completionEl, h.el, h.audioEl, h.eventEl, h.stateEl]) assert.equal(el('Panel').hidden, true);
  assert.equal(h.animationStateEl('Entries').children.length, 0);
});


test('invalid generated-state clip parameters expose a specific build diagnostic and exact binding parameter source', async () => {
  const initial = state({ protocolVersion: 8 });
  const diagnostic = { code: 'build_animation_state_parameters_invalid', sourcePath: source.sourcePath, sourceRevision: revision,
    propertyPath: '/bindings/0/parameters/clip_idle', objectId: source.objectId, message: 'Invalid clip_idle <img src=x>' };
  initial.job = { ...initial.job, kind: 'build', status: 'failed', diagnostics: [diagnostic] }; delete initial.job.runtime;
  const h = await fixture(initial);
  assert.match(h.element('projectBuildProblems').textContent, /动画状态脚本的片段参数必须是空字符串或小写 UUID/);
  const button = h.element('projectBuildDiagnostics').querySelector('button'); assert.ok(button); button.click(); await flushDialogs();
  assert.equal(h.opened.length, 1); assert.equal(h.opened[0][0], source.sourcePath);
  assert.equal(h.opened[0][1].propertyPath, diagnostic.propertyPath);
  assert.equal(h.opened[0][2].diagnostic.code, diagnostic.code);
  assert.equal(h.element('projectBuildProblems').querySelector('img'), null);
});


test('plan preflight problems name the author fix and preserve exact binding source ranges', async () => {
  const messages = {
    build_animation_state_clip_missing: '动画状态引用的片段不在当前场景中',
    build_animation_state_animation_missing: '动画状态控制器所在的场景没有动画',
    build_animation_state_target_missing: '动画状态控制器绑定的实例没有动画轨道',
    build_animation_state_preflight_limit: '动画绑定错误过多',
  };
  for (const [code, text] of Object.entries(messages)) {
    const initial = state({ protocolVersion: 8 });
    const diagnostic = { severity: 'error', code, ...source, propertyPath: '/bindings/0/parameters/clip_action',
      sourceRange: { start: 123, end: 161, encoding: 'utf-16', propertyPath: '/bindings/0/parameters/clip_action', exact: true },
      message: '<img src=x onerror=alert(1)>' };
    initial.job = { ...initial.job, kind: 'plan', status: 'failed', diagnostics: [diagnostic] }; delete initial.job.runtime;
    const h = await fixture(initial);
    assert.ok(h.element('projectBuildProblems').textContent.includes(text));
    const button = h.element('projectBuildDiagnostics').querySelector('button'); assert.ok(button); button.click(); await flushDialogs();
    assert.equal(h.opened.length, 1); assert.equal(h.opened[0][0], source.sourcePath);
    assert.equal(h.opened[0][1].propertyPath, diagnostic.propertyPath);
    assert.deepEqual(JSON.parse(JSON.stringify(h.opened[0][1].sourceRange)), diagnostic.sourceRange);
    assert.equal(h.element('projectBuildProblems').querySelector('img'), null);
  }
});

test('protocol9 adds script entry history beside all previous panels and protocols1–8 hide only unavailable records', async () => {
  const h = await fixture(state({ protocolVersion: 9 }));
  for (const el of [h.animationEntryEl, h.animationStateEl, h.completionEl, h.el, h.audioEl, h.eventEl, h.stateEl]) assert.equal(el('Panel').hidden, false);
  assert.match(h.animationEntryEl('Entries').textContent, /脚本接受进入状态：idle/);
  assert.match(h.animationEntryEl('Entries').textContent, /进入时已执行动画命令序号：1/);
  assert.equal(h.animationEntryEl('Sequence').dataset.sequence, '1');
  const empty = state({ protocolVersion: 9 }); empty.job.runtime.project.animationStateEntries = { sequence: 0, entries: [] };
  empty.job.runtime.project.animationStates = { sequence: 0, entries: [] };
  await h.refresh(empty); assert.equal(h.animationEntryEl('Panel').hidden, false); assert.match(h.animationEntryEl('Empty').textContent, /尚未采集/);
  for (const protocolVersion of [8, 7, 6, 5, 4, 3, 2, 1]) {
    await h.refresh(state({ protocolVersion })); assert.equal(h.animationEntryEl('Panel').hidden, true);
    assert.equal(h.animationStateEl('Panel').hidden, protocolVersion < 8); assert.equal(h.completionEl('Panel').hidden, protocolVersion < 7);
    assert.equal(h.el('Panel').hidden, protocolVersion < 5); assert.equal(h.audioEl('Panel').hidden, protocolVersion < 4);
    assert.equal(h.eventEl('Panel').hidden, protocolVersion < 3); assert.equal(h.stateEl('Panel').hidden, protocolVersion < 2);
  }
  assert.ok(h.calls.every(call => call === null));
});

test('entry source host preserves exact binding and script identities through own-loading and record appends', async () => {
  for (const kind of ['binding', 'script']) {
    const read = deferred(), writes = []; let h;
    h = await fixture(state({ protocolVersion: 9 }), { openSource: async (path, location, context) => {
      h.context.busy = true; h.controller.setAvailable(true);
      try { await read.promise; if (!context.isCurrent()) return false; writes.push(path); return true; }
      finally { h.context.busy = false; }
    } });
    const button = h.animationEntryEl('Entries').querySelector('.project-animation-state-entry-' + kind + '-source'); button.focus(); button.click(); await flushDialogs();
    const expected = kind === 'binding' ? source : scriptSource;
    assert.equal(h.opened.length, 1); assert.equal(h.opened[0][0], expected.sourcePath);
    assert.deepEqual(JSON.parse(JSON.stringify(h.opened[0][1])), expected); assert.equal(h.opened[0][2].isCurrent(), true);
    const next = state({ protocolVersion: 9 }); next.job.runtime.project.animationStateEntries.sequence = 2;
    next.job.runtime.project.animationStateEntries.entries.push({ ...stateEntries().entries[0], sequence: 2 });
    await h.refresh(next); assert.equal(h.opened[0][2].isCurrent(), true);
    assert.equal(h.animationEntryEl('Entries').querySelector('.project-animation-state-entry-' + kind + '-source'), button);
    assert.equal(h.document.activeElement, button);
    read.resolve(); await flushDialogs(); await flushDialogs(); assert.deepEqual(writes, [expected.sourcePath]); assert.equal(h.element('projectBuildDialog').open, false);
  }
});

test('entry source host revokes delayed reads after dirty creation visit task close or record changes', async () => {
  for (const change of ['dirty', 'creating', 'visit', 'task', 'close', 'entry']) {
    const read = deferred(), writes = []; let h;
    h = await fixture(state({ protocolVersion: 9 }), { openSource: async (path, location, context) => {
      h.context.busy = true;
      try { await read.promise; if (!context.isCurrent()) return false; writes.push(path); return true; }
      finally { h.context.busy = false; }
    } });
    h.animationEntryEl('Entries').querySelector('.project-animation-state-entry-script-source').click(); await flushDialogs();
    if (change === 'dirty' || change === 'creating') h.context[change] = true;
    else if (change === 'close') h.element('projectBuildDialog').close();
    else if (change === 'entry') {
      const next = state({ protocolVersion: 9 }); next.job.runtime.project.animationStateEntries.entries[0].timeSeconds = .5; await h.refresh(next);
    } else await h.refresh(state({ protocolVersion: 9, ...(change === 'visit' ? { active: first } : { task: 'run-2' }) }));
    assert.equal(h.opened[0][2].isCurrent(), false, change); read.resolve(); await flushDialogs(); assert.deepEqual(writes, [], change);
  }
});

test('invalid entry timeline clears runtime panels rather than showing stale accepted states', async () => {
  const h = await fixture(state({ protocolVersion: 9 })), invalid = state({ protocolVersion: 9 });
  invalid.job.runtime.project.animationStateEntries.entries[0].commandSequence = 2;
  await h.refresh(invalid);
  for (const el of [h.animationEntryEl, h.animationStateEl, h.completionEl, h.el, h.audioEl, h.eventEl, h.stateEl]) assert.equal(el('Panel').hidden, true);
  assert.equal(h.animationEntryEl('Entries').children.length, 0);
});


test('state entry identity and budget failures show specific diagnostics while preserving exact binding navigation', async () => {
  for (const [code, label] of [['runtime_behavior_animation_state_entry_invalid', /控制器身份或状态不一致/], ['runtime_behavior_animation_state_entry_limit', /128 条限制/]]) {
    const initial = state({ protocolVersion: 9 });
    const diagnostic = { code, sourcePath: source.sourcePath, sourceRevision: revision, propertyPath: '/bindings/0', objectId: source.objectId,
      message: 'Raw diagnostic <img src=x>' };
    initial.job = { ...initial.job, status: 'failed', diagnostics: [diagnostic] };
    const h = await fixture(initial); assert.match(h.element('projectBuildProblems').textContent, label);
    const button = h.element('projectBuildDiagnostics').querySelector('button'); assert.ok(button); button.click(); await flushDialogs();
    assert.equal(h.opened.length, 1); assert.equal(h.opened[0][0], source.sourcePath);
    assert.equal(h.opened[0][1].propertyPath, diagnostic.propertyPath); assert.equal(h.opened[0][2].diagnostic.code, code);
    assert.equal(h.element('projectBuildProblems').querySelector('img'), null);
  }
});


test('controller review receives the full runtime view and stays independent of the flat search', async () => {
  const initial = state({ protocolVersion: 9 });
  const h = await fixture(initial); assert.equal(h.reviewEl('Panel').hidden, true);
  const opener = h.animationEntryEl('Entries').querySelector('.project-animation-state-entry-review'); opener.click();
  assert.equal(h.reviewEl('Panel').hidden, false); assert.equal(h.reviewEl('Panel').dataset.sequence, '1');
  assert.equal(h.reviewEl('Terminal').hidden, false); assert.match(h.reviewEl('Terminal').textContent, /脚本已接受状态：idle/);
  const search = h.animationEntryEl('Search'); search.value = 'no-match'; search.dispatch('input');
  assert.equal(h.animationEntryEl('Entries').children[0].hidden, true); assert.equal(h.reviewEl('Panel').hidden, false);
  assert.equal(h.reviewEl('Panel').dataset.sequence, '1'); assert.match(h.reviewEl('Note').textContent, /不受记录列表筛选影响/);
  h.reviewEl('Close').focus(); h.reviewEl('Close').click(); assert.equal(h.reviewEl('Panel').hidden, true); assert.equal(h.document.activeElement, search);
  search.value = ''; search.dispatch('input'); opener.click(); h.reviewEl('Close').focus(); h.reviewEl('Close').click(); assert.equal(h.document.activeElement, opener);
});

test('controller review source host preserves both identities while its own loading and later records keep the selected entry current', async () => {
  for (const kind of ['binding', 'script']) {
    const read = deferred(), writes = []; let h;
    h = await fixture(state({ protocolVersion: 9 }), { openSource: async (path, location, context) => {
      h.context.busy = true; h.controller.setAvailable(true);
      try { await read.promise; if (!context.isCurrent()) return false; writes.push(path); return true; }
      finally { h.context.busy = false; }
    } });
    h.animationEntryEl('Entries').querySelector('.project-animation-state-entry-review').click();
    h.reviewEl(kind === 'binding' ? 'BindingSource' : 'ScriptSource').click(); await flushDialogs();
    const expected = kind === 'binding' ? source : scriptSource;
    assert.equal(h.opened.length, 1); assert.deepEqual(JSON.parse(JSON.stringify(h.opened[0][1])), expected); assert.equal(h.opened[0][2].isCurrent(), true);
    const next = state({ protocolVersion: 9 }); next.job.runtime.project.animationStateEntries.sequence = 2;
    next.job.runtime.project.animationStateEntries.entries.push({ ...stateEntries().entries[0], sequence: 2 });
    await h.refresh(next); assert.equal(h.opened[0][2].isCurrent(), true); assert.equal(h.reviewEl('Panel').dataset.sequence, '1');
    read.resolve(); await flushDialogs(); await flushDialogs(); assert.deepEqual(writes, [expected.sourcePath]);
  }
});

test('controller review host revokes delayed navigation on dirty creation visit task close or selecting a repeated entry', async () => {
  for (const change of ['dirty', 'creating', 'visit', 'task', 'close', 'selection']) {
    const read = deferred(), writes = []; let h;
    const initial = state({ protocolVersion: 9 }); initial.job.runtime.project.animationStateEntries.sequence = 2;
    initial.job.runtime.project.animationStateEntries.entries.push({ ...stateEntries().entries[0], sequence: 2 });
    h = await fixture(initial, { openSource: async (path, location, context) => {
      h.context.busy = true;
      try { await read.promise; if (!context.isCurrent()) return false; writes.push(path); return true; }
      finally { h.context.busy = false; }
    } });
    h.animationEntryEl('Entries').querySelector('.project-animation-state-entry-review').click(); h.reviewEl('ScriptSource').click(); await flushDialogs();
    if (change === 'dirty' || change === 'creating') h.context[change] = true;
    else if (change === 'close') h.element('projectBuildDialog').close();
    else if (change === 'selection') h.reviewEl('Next').click();
    else await h.refresh(state({ protocolVersion: 9, ...(change === 'visit' ? { active: first } : { task: 'run-2' }) }));
    assert.equal(h.opened[0][2].isCurrent(), false, change); read.resolve(); await flushDialogs(); assert.deepEqual(writes, [], change);
  }
});


test('protocol10 keeps all project observation panels and routes recorded entry sources into controller review', async () => {
  const h = await fixture(state({ protocolVersion: 10 }));
  for (const el of [h.animationEntryEl, h.animationStateEl, h.completionEl, h.el, h.audioEl, h.eventEl, h.stateEl]) assert.equal(el('Panel').hidden, false);
  assert.match(h.animationEntryEl('Entries').textContent, /进入来源：直接进入/);
  h.animationEntryEl('Entries').querySelector('.project-animation-state-entry-review').click();
  assert.equal(h.reviewEl('Panel').hidden, false); assert.equal(h.reviewEl('Trigger').dataset.kind, 'direct');
  assert.equal(h.reviewEl('TriggerDetail').hidden, true); assert.equal(h.reviewEl('TriggerPayload').hidden, true);
  await h.refresh(state({ protocolVersion: 9 }));
  assert.match(h.animationEntryEl('Entries').textContent, /进入来源：未记录（协议 9）/);
  h.animationEntryEl('Entries').querySelector('.project-animation-state-entry-review').click();
  assert.equal(h.reviewEl('Trigger').dataset.kind, 'unrecorded');
  assert.ok(h.calls.every(call => call === null));
});

// The event and controller views communicate through explicit host ports.
function eventReviewState(options = {}) {
  const result = state({ protocolVersion: 10, ...options }), project = result.job.runtime.project;
  project.events.entries[0].deliveries[0].origin = origin();
  project.animationStateEntries.entries[0].trigger = { kind: 'event', eventSequence: 1, subscriptionId: 1 };
  project.events.entries.push({ ...structuredClone(project.events.entries[0]), sequence: 2, value: false });
  project.events.sequence = 2;
  return result;
}

for (const protocolVersion of [10, 11]) test(`protocol${protocolVersion} event review crosses into the exact controller history through the build host and stays independent of either filter`, async () => {
  const h = await fixture(eventReviewState({ protocolVersion }));
  const opener = h.eventEl('Entries').querySelector('.project-event-review-open'); opener.click();
  assert.equal(h.eventReviewEl('Panel').hidden, false); assert.equal(h.eventReviewEl('Panel').dataset.sequence, '1');
  const entry = h.eventReviewEl('Recipients').querySelector('.project-event-review-animation-entry');
  assert.equal(entry.dataset.entrySequence, '1'); entry.click(); await flushDialogs();
  assert.equal(h.reviewEl('Panel').hidden, false); assert.equal(h.reviewEl('Panel').dataset.sequence, '1');
  assert.equal(h.reviewEl('Trigger').dataset.kind, 'event'); assert.equal(h.document.activeElement, h.reviewEl('Selection'));
  for (const search of [h.eventEl('Search'), h.animationEntryEl('Search')]) { search.value = 'no-match'; search.dispatch('input'); }
  assert.equal(h.eventReviewEl('Panel').hidden, false); assert.equal(h.reviewEl('Panel').hidden, false);
  h.eventReviewEl('Close').click(); assert.equal(h.document.activeElement, h.eventEl('Search'));
  h.eventEl('Search').value = ''; h.eventEl('Search').dispatch('input'); opener.click();
  await h.refresh(eventReviewState({ protocolVersion, task: 'run-2' }));
  assert.equal(h.eventReviewEl('Panel').hidden, true); assert.equal(h.reviewEl('Panel').hidden, true);
  assert.ok(h.calls.every(call => call === null), 'review issues no build or run mutations');
});

test('event review distinguishes an absent association and old protocol evidence without guessing from nearby entries', async () => {
  const h = await fixture(eventReviewState());
  h.eventEl('Entries').querySelector('.project-event-review-open').click();
  const selection = h.eventReviewEl('Selection'); selection.value = '2'; selection.dispatch('change');
  assert.equal(h.eventReviewEl('Panel').dataset.sequence, '2');
  assert.equal(h.eventReviewEl('Recipients').querySelector('.project-event-review-animation-entry').hidden, true);
  assert.match(h.eventReviewEl('Recipients').textContent, /未采集/);
  const old = state({ protocolVersion: 9 }); old.job.runtime.project.events.entries[0].deliveries[0].origin = origin();
  await h.refresh(old); h.eventEl('Entries').querySelector('.project-event-review-open').click();
  assert.equal(h.eventReviewEl('Panel').hidden, false);
  assert.equal(h.eventReviewEl('Recipients').querySelector('.project-event-review-animation-entry').hidden, true);
  assert.match(h.eventReviewEl('Panel').textContent, /未记录.*来源/);
  const invalid = eventReviewState(); invalid.job.runtime.project.animationStateEntries.entries[0].trigger.subscriptionId = 2;
  await h.refresh(invalid); assert.equal(h.eventReviewEl('Panel').hidden, true); assert.equal(h.eventEl('Panel').hidden, true);
});

test('event review publisher and subscriber navigation survives own loading and a later event', async () => {
  for (const role of ['publisher', 'subscriber']) {
    const read = deferred(), writes = []; let h;
    h = await fixture(eventReviewState(), { openSource: async (path, location, ticket) => {
      h.context.busy = true; h.controller.setAvailable(true);
      try { await read.promise; if (!ticket.isCurrent()) return false; writes.push(path); return true; }
      finally { h.context.busy = false; }
    } });
    h.eventEl('Entries').querySelector('.project-event-review-open').click();
    const button = role === 'publisher' ? h.eventReviewEl('PublisherSource') : h.eventReviewEl('Recipients').querySelector('.project-event-review-recipient-source');
    button.click(); await flushDialogs();
    assert.equal(h.opened.length, 1); assert.deepEqual(JSON.parse(JSON.stringify(h.opened[0][1])), source);
    const next = eventReviewState(); const events = next.job.runtime.project.events;
    events.entries.push({ ...structuredClone(events.entries[1]), sequence: 3, value: 'later' }); events.sequence = 3;
    await h.refresh(next); assert.equal(h.opened[0][2].isCurrent(), true);
    read.resolve(); await flushDialogs(); await flushDialogs(); assert.deepEqual(writes, [source.sourcePath]);
    assert.equal(h.element('projectBuildDialog').open, false);
  }
});

test('event review source navigation is revoked by editor, session, selection and source identity changes', async () => {
  for (const change of ['dirty', 'creating', 'visit', 'task', 'close', 'selection', 'source']) {
    const read = deferred(), writes = []; let h;
    h = await fixture(eventReviewState(), { openSource: async (path, location, ticket) => {
      h.context.busy = true;
      try { await read.promise; if (!ticket.isCurrent()) return false; writes.push(path); return true; }
      finally { h.context.busy = false; }
    } });
    h.eventEl('Entries').querySelector('.project-event-review-open').click(); h.eventReviewEl('PublisherSource').click(); await flushDialogs();
    if (change === 'dirty' || change === 'creating') h.context[change] = true;
    else if (change === 'close') h.element('projectBuildDialog').close();
    else if (change === 'selection') { const selected = h.eventReviewEl('Selection'); selected.value = '2'; selected.dispatch('change'); }
    else if (change === 'source') {
      const next = eventReviewState(); next.job.runtime.project.events.entries[0].origin.source = { ...source, sourceRevision: snapshotId }; await h.refresh(next);
    } else await h.refresh(eventReviewState(change === 'visit' ? { active: first } : { task: 'run-2' }));
    assert.equal(h.opened[0][2].isCurrent(), false, change); read.resolve(); await flushDialogs(); assert.deepEqual(writes, [], change);
  }
});


test('protocol11 actual build host carries per-instance command and completion targets beside state and entry panels', async () => {
  const h = await fixture(state({ protocolVersion: 11 }));
  for (const el of [h.el, h.completionEl, h.animationStateEl, h.animationEntryEl, h.audioEl, h.eventEl, h.stateEl]) assert.equal(el('Panel').hidden, false);
  assert.match(h.el('Entries').textContent, new RegExp('动画目标：实例 ' + id(5)));
  assert.match(h.completionEl('Entries').textContent, /目标最后命令序号 1 · 全部命令截止 1/);
  assert.match(h.animationStateEl('Entries').textContent, /idle/);
  assert.match(h.animationEntryEl('Entries').textContent, /idle/);
  h.completionEl('Search').value = id(5); h.completionEl('Search').dispatch('input');
  await h.refresh(state({ protocolVersion: 11, active: first }));
  assert.equal(h.completionEl('Search').value, id(5));
  h.completionEl('Entries').querySelector('.project-animation-completion-subscriber-source').click(); await flushDialogs();
  assert.equal(h.opened[0][0], source.sourcePath); assert.deepEqual(JSON.parse(JSON.stringify(h.opened[0][1])), source);
  assert.ok(h.calls.every(call => call === null));
});


test('protocol11 command and completion host ports open the same target review and restore their own opener', async () => {
  const h = await fixture(state({ protocolVersion: 11 }));
  assert.equal(h.targetEl('Panel').hidden, true);
  const command = h.el('Entries').querySelector('.project-animation-target-review-open'); command.click();
  assert.equal(h.targetEl('Panel').hidden, false); assert.equal(h.targetEl('Panel').dataset.targetInstanceId, id(5));
  assert.equal(h.targetEl('Panel').dataset.selectedKind, 'command'); assert.equal(h.targetEl('Commands').dataset.count, '1');
  assert.equal(h.targetEl('Completions').dataset.count, '1'); assert.equal(h.document.activeElement, h.targetEl('Selection'));
  h.targetEl('Close').click(); assert.equal(h.document.activeElement, command);
  const completion = h.completionEl('Entries').querySelector('.project-animation-completion-target-review-open'); completion.click();
  assert.equal(h.targetEl('Panel').dataset.selectedKind, 'completion');
  h.targetEl('Completions').querySelector('.project-animation-target-review-anchor-jump').click();
  assert.equal(h.targetEl('Panel').dataset.selectedKind, 'command'); assert.equal(h.targetEl('Panel').dataset.selectedSequence, '1');
  h.el('Search').value = 'no-match'; h.el('Search').dispatch('input');
  h.completionEl('Search').value = 'no-match'; h.completionEl('Search').dispatch('input');
  assert.equal(h.targetEl('Panel').hidden, false); assert.equal(h.targetEl('Commands').dataset.count, '1');
  h.targetEl('Close').click();
  assert.ok([h.el('Search'), h.completionEl('Search')].includes(h.document.activeElement));
  await h.refresh(state({ protocolVersion: 10 }));
  assert.equal(h.targetEl('Panel').hidden, true);
  assert.equal(h.el('Entries').querySelector('.project-animation-target-review-open'), null);
  assert.equal(h.completionEl('Entries').querySelector('.project-animation-completion-target-review-open'), null);
  assert.ok(h.calls.every(call => call === null));
});

test('target review source navigation retains exact ownership through own loading and unchanged refresh', async () => {
  const read = deferred(); let h;
  h = await fixture(state({ protocolVersion: 11 }), { openSource: async (path, location, ticket) => {
    h.context.busy = true;
    try { await read.promise; return ticket.isCurrent(); } finally { h.context.busy = false; }
  } });
  h.el('Entries').querySelector('.project-animation-target-review-open').click();
  h.targetEl('Commands').querySelector('.project-animation-target-review-command-source').click(); await flushDialogs();
  assert.equal(h.opened[0][0], source.sourcePath); assert.deepEqual(JSON.parse(JSON.stringify(h.opened[0][1])), source);
  await h.refresh(state({ protocolVersion: 11 })); assert.equal(h.opened[0][2].isCurrent(), true);
  read.resolve(); await flushDialogs(); assert.equal(h.element('projectBuildDialog').open, false);
  assert.ok(h.calls.every(call => call === null));
});

test('target review host revokes delayed source writes after dirty creation visit task close or record changes', async () => {
  for (const change of ['dirty', 'creating', 'visit', 'task', 'close', 'source', 'protocol']) {
    const read = deferred(), writes = []; let h;
    h = await fixture(state({ protocolVersion: 11 }), { openSource: async (path, location, ticket) => {
      h.context.busy = true;
      try { await read.promise; if (!ticket.isCurrent()) return false; writes.push(path); return true; }
      finally { h.context.busy = false; }
    } });
    h.completionEl('Entries').querySelector('.project-animation-completion-target-review-open').click();
    h.targetEl('Completions').querySelector('.project-animation-target-review-subscriber-source').click(); await flushDialogs();
    if (change === 'dirty' || change === 'creating') h.context[change] = true;
    else if (change === 'close') h.element('projectBuildDialog').close();
    else if (change === 'source') {
      const next = state({ protocolVersion: 11 }); next.job.runtime.project.animationCompletions.entries[0].deliveries[0].origin.source = { ...source, sourceRevision: snapshotId }; await h.refresh(next);
    } else await h.refresh(state({ protocolVersion: change === 'protocol' ? 10 : 11, ...(change === 'visit' ? { active: first } : change === 'task' ? { task: 'run-2' } : {}) }));
    assert.equal(h.opened[0][2].isCurrent(), false, change);
    read.resolve(); await flushDialogs(); assert.deepEqual(writes, [], change);
  }
});

test('invalid completion target anchor clears target review together with the admitted runtime panels', async () => {
  const h = await fixture(state({ protocolVersion: 11 }));
  h.el('Entries').querySelector('.project-animation-target-review-open').click();
  const next = state({ protocolVersion: 11 }); next.job.runtime.project.animationCompletions.entries[0].targetCommandSequence = 2;
  await h.refresh(next); assert.equal(h.targetEl('Panel').hidden, true); assert.equal(h.el('Panel').hidden, true); assert.equal(h.completionEl('Panel').hidden, true);
  assert.ok(h.calls.every(call => call === null));
});
