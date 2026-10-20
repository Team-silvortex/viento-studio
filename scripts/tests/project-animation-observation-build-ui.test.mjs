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
const trace = () => ({ sequence: 1, entries: [{ sequence: 1, name: 'checkpoint', value: '雨の鍵', origin: origin(),
  deliveries: [{ subscriptionId: 1, origin: { ...origin(), bindingId: id(10), source: { ...source, objectId: id(11), sourcePath: 'documents/behaviors/receiver.json' } }, status: 'handled' }] }] });
const shared = () => ({ revision: 1, entries: [{ key: 'note', value: '雨の鍵', revision: 1, origin: origin() }],
  lastChange: { operation: 'set', key: 'note', revision: 1, origin: origin() } });
function state({ protocolVersion = 5, task = 'run-1', active = second } = {}) {
  const visits = [{ index: 1, sceneId: first, phase: 'left', elapsedSeconds: 0.5 }, { index: 2, sceneId: second, phase: active === second ? 'ready' : 'left', elapsedSeconds: active === second ? 0 : 0.5 }];
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
        project: { assemblyId, entrySceneId: first, activeSceneId: active, visits, ...(protocolVersion === 1 ? {} : { protocolVersion, sharedState: shared(), ...(protocolVersion >= 3 ? { events: trace() } : {}), ...(protocolVersion >= 4 ? { audioCommands: audio() } : {}), ...(protocolVersion === 5 ? { animationCommands: animation() } : {}) }) },
      } },
  };
}
async function fixture(initial = state(), options = {}) {
  let payload = initial;
  const calls = [], opened = [], context = { editable: true, dirty: false, creating: false, busy: false, path: 'documents/game.json' };
  const h = await dialogHarness('app-project-build', { PROJECT_BUILD_API_PATH: '/api/project-build', validateProjectAnimationCommandsSnapshot: value => JSON.parse(JSON.stringify(validateProjectAnimationCommandsSnapshot(JSON.parse(JSON.stringify(value))))), queryProjectRuntimeObservation, querySceneRuntimeObservation,
    fetchJsonApiRequest: async (url, request) => { calls.push(request.body ? JSON.parse(request.body) : null); return { payload }; } });
  for (const name of ['app-project-state-observation', 'app-project-event-observation', 'app-project-audio-observation', 'app-project-animation-observation']) {
    const module = (await fs.readFile(new URL(`../../web/modules/${name}.js`, import.meta.url), 'utf8'))
      .replace(/^import[^\n]+\n/gm, '').replaceAll('export ', '');
    vm.runInContext(module, h.runtime);
  }
  const controller = h.runtime.setupProjectBuild({ getContext: () => context,
    openSource: (...args) => { opened.push(args); return options.openSource ? options.openSource(...args) : true; } });
  controller.setAvailable(true); h.element('projectBuildBtn').click(); await flushDialogs();
  return { ...h, context, controller, calls, opened, async refresh(next) { payload = next; h.element('projectBuildRefresh').click(); await flushDialogs(); },
    el: suffix => h.element('projectAnimationCommands' + suffix), audioEl: suffix => h.element('projectAudioCommands' + suffix), eventEl: suffix => h.element('projectEventTrace' + suffix), stateEl: suffix => h.element('projectSharedState' + suffix) };
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
