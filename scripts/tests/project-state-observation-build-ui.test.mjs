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
const shared = () => ({ revision: 1, entries: [{ key: 'note', value: '雨の鍵', revision: 1, origin: origin() }],
  lastChange: { operation: 'set', key: 'note', revision: 1, origin: origin() } });
function state({ legacy = false, task = 'run-1', active = second } = {}) {
  const visits = [{ index: 1, sceneId: first, phase: 'left', elapsedSeconds: 0.5 }, { index: 2, sceneId: second, phase: active === second ? 'ready' : 'left', elapsedSeconds: active === second ? 0 : 0.5 }];
  if (active === first) visits.push({ index: 3, sceneId: first, phase: 'ready', elapsedSeconds: 0 });
  return { supported: true, available: true, platform: 'linux',
    backend: { format: 'viento-execution-backend', schemaVersion: 1, id: backendId, version: '0.9.0', label: 'Godot', platforms: ['linux'],
      plans: [{ kind: 'project', schemaVersion: 1, runtimeProtocolVersion: 1 }, { kind: 'scene2d', schemaVersion: 1, runtimeProtocolVersion: 1 }],
      capabilities: ['scene2d'], execution: { build: true, headlessLogic: true, windowPreview: true, windowCapture: true, offscreenRender: false, embeddedViewport: false, gpuCompute: false }, extensions: [] },
    scenes: [{ id: assemblyId, kind: 'project', title: 'Project', sourcePath: 'documents/game.json', entrySceneId: first, sceneCount: 2 }],
    latestBuild: { id: 'build-1', backendId, sceneId: assemblyId, targetKind: 'project', targetId: assemblyId, snapshotId, entrySceneId: first, sceneCount: 2,
      scenes: [first, second].map((sceneId, index) => ({ sceneId, title: `Scene ${index}`, sourcePath: `documents/scenes/${index}.json`, sourceRevision: revision, planSchemaVersion: 1, runtimeProtocolVersion: 1 })) },
    job: { id: task, kind: 'run', status: 'running', phase: 'running', backendId, sceneId: assemblyId, targetKind: 'project', targetId: assemblyId,
      buildId: 'build-1', snapshotId, diagnostics: [], events: [], logs: '', runtime: {
        format: 'viento-runtime-observation', schemaVersion: 1, sceneObjectId: active, protocolVersion: 1, phase: 'ready', sequence: 1, actors: [],
        project: { assemblyId, entrySceneId: first, activeSceneId: active, visits, ...(legacy ? {} : { protocolVersion: 2, sharedState: shared() }) },
      } },
  };
}
async function fixture(initial = state(), options = {}) {
  let payload = initial;
  const calls = [], opened = [], context = { editable: true, dirty: false, creating: false, busy: false, path: 'documents/game.json' };
  const h = await dialogHarness('app-project-build', { PROJECT_BUILD_API_PATH: '/api/project-build', queryProjectRuntimeObservation, querySceneRuntimeObservation,
    fetchJsonApiRequest: async (url, request) => { calls.push(request.body ? JSON.parse(request.body) : null); return { payload }; } });
  const module = (await fs.readFile(new URL('../../web/modules/app-project-state-observation.js', import.meta.url), 'utf8'))
    .replace(/^import[^\n]+\n/gm, '').replaceAll('export ', '');
  vm.runInContext(module, h.runtime);
  const controller = h.runtime.setupProjectBuild({ getContext: () => context,
    openSource: (...args) => { opened.push(args); return options.openSource ? options.openSource(...args) : true; } });
  controller.setAvailable(true); h.element('projectBuildBtn').click(); await flushDialogs();
  return { ...h, context, controller, calls, opened, async refresh(next) { payload = next; h.element('projectBuildRefresh').click(); await flushDialogs(); },
    el: suffix => h.element('projectSharedState' + suffix) };
}

test('the build host passes only admitted project-v2 state; child protocol 1 remains supported and legacy project state stays hidden', async () => {
  const h = await fixture(); assert.equal(h.el('Panel').hidden, false); assert.equal(h.el('Revision').dataset.revision, '1');
  await h.refresh(state({ legacy: true })); assert.equal(h.el('Panel').hidden, true);
  const invalid = state(); invalid.job.runtime.project.sharedState.entries[0].value = null;
  await h.refresh(invalid); assert.equal(h.el('Panel').hidden, true); assert.equal(h.el('Entries').children.length, 0);
});

test('scene switching preserves shared filtering and old provenance; a new task resets the filter', async () => {
  const h = await fixture(), search = h.el('Search'); search.value = 'note'; search.dispatch('input');
  await h.refresh(state({ active: first })); assert.equal(search.value, 'note');
  assert.match(h.el('Entries').children[0].textContent, /第 1 次访问/);
  await h.refresh(state({ task: 'run-2' })); assert.equal(search.value, ''); assert.equal(h.el('Revision').dataset.revision, '1');
  assert.ok(h.calls.every(call => call === null));
});

test('last-source navigation uses the past binding document and survives the host own-loading busy lifecycle', async () => {
  const read = deferred(), writes = []; let h;
  h = await fixture(state(), { openSource: async (path, location, context) => {
    h.context.busy = true; h.controller.setAvailable(true);
    try { await read.promise; if (!context.isCurrent()) return false; writes.push(path); return true; }
    finally { h.context.busy = false; }
  } });
  h.el('LastChangeBody').querySelector('button').click(); await flushDialogs();
  assert.equal(h.opened.length, 1); assert.equal(h.opened[0][0], source.sourcePath);
  assert.deepEqual(JSON.parse(JSON.stringify(h.opened[0][1])), source);
  assert.equal(h.opened[0][2].isCurrent(), true);
  read.resolve(); await flushDialogs(); await flushDialogs();
  assert.deepEqual(writes, [source.sourcePath]); assert.equal(h.element('projectBuildDialog').open, false);
});

test('busy admission and late dirty, creation, visit and task changes protect the actual host source port', async () => {
  for (const change of ['dirty', 'creating', 'visit', 'task']) {
    const read = deferred(), writes = []; let h;
    h = await fixture(state(), { openSource: async (path, location, context) => {
      h.context.busy = true;
      try { await read.promise; if (!context.isCurrent()) return false; writes.push(path); return true; }
      finally { h.context.busy = false; }
    } });
    const button = () => h.el('Entries').querySelector('button');
    h.context.busy = true; button().dispatch('click'); await flushDialogs(); assert.equal(h.opened.length, 0);
    h.context.busy = false; h.controller.setAvailable(true); button().click(); await flushDialogs();
    if (change === 'dirty' || change === 'creating') h.context[change] = true;
    else await h.refresh(state(change === 'visit' ? { active: first } : { task: 'run-2' }));
    assert.equal(h.opened[0][2].isCurrent(), false, change);
    read.resolve(); await flushDialogs(); assert.deepEqual(writes, [], change); assert.equal(h.element('projectBuildDialog').open, true);
  }
});
