import test from 'node:test';
import assert from 'node:assert/strict';
import { dialogHarness, flushDialogs } from './dialog-harness.mjs';
import { deferred } from './editor-harness.mjs';
import { querySceneRuntimeObservation } from '../../engine/scene-runtime-query.mjs';
import { queryProjectRuntimeObservation } from '../../engine/project-runtime-query.mjs';
import en from '../../web/i18n/en.js';
import ja from '../../web/i18n/ja.js';

const id = n => `${String(n).padStart(8, '0')}-1111-4111-8111-111111111111`;
const assembly = id(1), first = id(2), second = id(3), third = id(4), actor = id(5), instance = id(6);
const backendId = 'org.viento.godot4', revision = `sha256:${'a'.repeat(64)}`, snapshotId = `sha256:${'b'.repeat(64)}`;
const members = () => [
  { sceneId: first, title: 'A / 起点', sourcePath: 'documents/scenes/a.json', sourceRevision: revision, planSchemaVersion: 2, runtimeProtocolVersion: 2 },
  { sceneId: second, title: 'B / 中途', sourcePath: 'documents/scenes/b.json', sourceRevision: revision, planSchemaVersion: 1, runtimeProtocolVersion: 1 },
  { sceneId: third, title: 'C / 终点', sourcePath: 'documents/scenes/c.json', sourceRevision: revision, planSchemaVersion: 3, runtimeProtocolVersion: 3 },
];
const source = sceneId => ({ objectId: sceneId, sourcePath: members().find(member => member.sceneId === sceneId).sourcePath,
  sourceRevision: revision, propertyPath: '/actors/0', sourceRange: { start: 10, end: 20, encoding: 'utf-16', exact: true } });
function observation(history = [first], phase = 'ready', nextSceneId = null) {
  const activeSceneId = nextSceneId || history.at(-1) || first;
  const member = members().find(item => item.sceneId === activeSceneId);
  const visits = history.map((sceneId, index) => ({ index: index + 1, sceneId,
    phase: index < history.length - 1 || nextSceneId ? 'left' : phase,
    elapsedSeconds: index < history.length - 1 || nextSceneId || phase === 'finished' ? 0.5 : 0 }));
  const waiting = phase === 'waiting';
  return { format: 'viento-runtime-observation', schemaVersion: 1, sceneObjectId: activeSceneId,
    protocolVersion: member.runtimeProtocolVersion, phase, sequence: waiting ? 0 : phase === 'finished' ? 4 : 1,
    actors: [{ objectId: actor, ...(member.runtimeProtocolVersion === 1 ? {} : { instanceId: instance }), name: member.title,
      state: waiting ? null : 'idle', position: waiting ? null : [activeSceneId === first ? 10 : 30, 20],
      positionSample: waiting ? null : phase, positionCurrent: !waiting, source: source(activeSceneId) }],
    project: { assemblyId: assembly, entrySceneId: first, activeSceneId, visits } };
}
function state(view = observation()) {
  return { supported: true, available: true, platform: 'linux',
    backend: { format: 'viento-execution-backend', schemaVersion: 1, id: backendId, version: '0.8.0', label: 'Godot', platforms: ['linux'],
      plans: [{ kind: 'project', schemaVersion: 1, runtimeProtocolVersion: 1 }, ...[1, 2, 3].map(version => ({ kind: 'scene2d', schemaVersion: version, runtimeProtocolVersion: version }))],
      capabilities: ['scene2d', 'runtime.control-replay', 'runtime.control-replay.instances'],
      execution: { build: true, headlessLogic: true, windowPreview: true, windowCapture: true, offscreenRender: false, embeddedViewport: false, gpuCompute: false }, extensions: [] },
    scenes: [{ id: assembly, title: 'Assembly', sourcePath: 'documents/project.json', kind: 'project', sceneCount: 3, entrySceneId: first },
      ...members().map(item => ({ id: item.sceneId, title: item.title, sourcePath: item.sourcePath }))],
    latestBuild: { id: 'build-one', backendId, sceneId: assembly, targetId: assembly, targetKind: 'project', snapshotId, entrySceneId: first, sceneCount: 3, scenes: members() },
    job: { id: 'run-one', kind: 'run', status: 'running', phase: 'running', backendId, sceneId: assembly, targetId: assembly, targetKind: 'project',
      buildId: 'build-one', snapshotId, diagnostics: [], events: [], logs: '', runtime: view } };
}
async function harness(initial = state(), options = {}) {
  let payload = initial, dictionary = options.dictionary || {};
  const calls = [], opened = [], languages = [], context = { editable: true, dirty: false, creating: false, busy: false, path: 'documents/project.json' };
  const translate = (key, ...values) => (dictionary[key] || key).replace(/\{(\d+)\}/g, (_, index) => values[index] ?? '');
  const h = await dialogHarness('app-project-build', { PROJECT_BUILD_API_PATH: '/api/project-build', querySceneRuntimeObservation, queryProjectRuntimeObservation,
    t: translate, translatePage: root => { for (const item of root.querySelectorAll('[data-i18n]')) item.textContent = translate(item.dataset.i18n); },
    onLanguageChange: callback => languages.push(callback), fetchJsonApiRequest: async (url, request) => { calls.push({ url, body: request.body ? JSON.parse(request.body) : null }); return { payload }; } });
  const controller = h.runtime.setupProjectBuild({ getContext: () => context, openSource: (...args) => { opened.push(args); return options.openSource ? options.openSource(...args) : true; } });
  controller.setAvailable(true); h.element('projectBuildBtn').click(); await flushDialogs();
  return { ...h, calls, opened, context, controller,
    rows: () => h.element('projectBuildRuntimeObjectList').children,
    visits: () => h.element('projectBuildRuntimeVisits').children,
    async refresh(next = payload) { payload = next; h.element('projectBuildRefresh').click(); await flushDialogs(); },
    filter(value) { h.element('projectBuildRuntimeSearch').value = value; h.element('projectBuildRuntimeSearch').dispatch('input'); },
    language(value) { dictionary = value; languages.forEach(callback => callback()); } };
}

test('project observation waits for entry, resets samples between visits and accepts each frozen child protocol', async () => {
  const h = await harness(state(observation([], 'waiting')));
  assert.equal(h.element('projectBuildRuntimeProject').hidden, false);
  assert.equal(h.element('projectBuildRuntimeScenePending').hidden, false);
  assert.match(h.visits()[0].textContent, /尚未进入/); assert.match(h.rows()[0].textContent, /尚未收到位置样本/);
  await h.refresh(state()); assert.equal(h.visits().length, 1); assert.equal(h.visits()[0].dataset.visitIndex, '1');
  h.filter('no match'); assert.equal(h.rows().length, 0);
  await h.refresh(state(observation([first], 'waiting', second)));
  assert.equal(h.element('projectBuildRuntimeSearch').value, ''); assert.equal(h.rows().length, 1);
  assert.match(h.element('projectBuildRuntimeCurrentScene').textContent, /B \/ 中途.*2/);
  assert.match(h.rows()[0].textContent, /尚未收到位置样本/); assert.equal(h.visits()[0].dataset.sceneId, first);
  await h.refresh(state(observation([first, second])));
  assert.equal(h.element('projectBuildRuntimeScenePending').hidden, true); assert.equal(h.rows()[0].dataset.instanceId, undefined);
  await h.refresh(state(observation([first, second, third], 'finished')));
  assert.equal(h.rows()[0].dataset.instanceId, instance); assert.equal(h.visits().length, 3);
  assert.match(h.rows()[0].textContent, /结束样本/); assert.match(h.visits()[2].textContent, /0.5/);
  for (const suffix of ['Control', 'CaseEditor', 'Suites']) assert.equal(h.element('projectBuild' + suffix).hidden, true);
});

test('malformed visits, forged project identities and nonmembers never authorize cards or source links', async () => {
  const changes = [
    value => { value.job.runtime.project.assemblyId = third; }, value => { value.job.runtime.project.entrySceneId = second; },
    value => { value.job.runtime.project.activeSceneId = id(99); }, value => { value.job.runtime.project.visits[0].sceneId = second; },
    value => { value.job.runtime.project.visits[0].index = 0; }, value => { value.job.runtime.project.visits[0].phase = 'left'; },
    value => { value.job.runtime.project.visits[0].elapsedSeconds = Infinity; }, value => { delete value.job.runtime.project; },
    value => { delete value.latestBuild.scenes; }, value => { value.latestBuild.sceneCount = 4; },
    value => { value.latestBuild.scenes[1].sceneId = first; }, value => { value.latestBuild.scenes[0].sourcePath = '../outside.json'; },
    value => { value.latestBuild.scenes[0].sourcePath = '.'; }, value => { value.latestBuild.scenes[0].sourceRevision = 'bad'; },
    value => { value.latestBuild.scenes[0].runtimeProtocolVersion = 1; }, value => { value.latestBuild.scenes[0].planSchemaVersion = 1; },
    value => { value.latestBuild.entrySceneId = id(99); }, value => { value.job.sceneId = first; },
    value => { value.job.buildId = 'foreign'; }, value => { value.latestBuild.snapshotId = `sha256:${'c'.repeat(64)}`; },
  ];
  for (const change of changes) {
    const value = state(); change(value); const h = await harness(value);
    assert.equal(h.element('projectBuildRuntimeObjects').hidden, true, change.toString());
    assert.equal(h.rows().length, 0); assert.equal(h.visits().length, 0);
  }
});

test('a return visit to the same scene cannot revive stale object or history navigation', async () => {
  const pending = deferred(), writes = [], focused = [];
  const h = await harness(state(), { openSource: async (path, location, context) => {
    const result = await pending.promise; if (!context.isCurrent()) return false; writes.push(path); return result;
  } });
  const objectLink = h.rows()[0].querySelector('button'), historyLink = h.visits()[0].querySelector('button');
  objectLink.click(); await flushDialogs(); assert.equal(h.opened[0][2].isCurrent(), true);
  await h.refresh(state(observation([first, second])));
  await h.refresh(state(observation([first, second, first])));
  assert.equal(h.rows()[0].dataset.instanceId, instance); assert.match(h.element('projectBuildRuntimeCurrentScene').textContent, /第 3 次/);
  assert.equal(h.opened[0][2].isCurrent(), false);
  pending.resolve({ focus: () => focused.push(true) }); await flushDialogs();
  assert.deepEqual(writes, []); assert.deepEqual(focused, []); assert.equal(h.element('projectBuildDialog').open, true);
  objectLink.dispatch('click'); historyLink.dispatch('click'); await flushDialogs(); assert.equal(h.opened.length, 1);
});

test('the exit-to-enter gap revokes old navigation before the next ready frame', async () => {
  const pending = deferred(), h = await harness(state(), { openSource: () => pending.promise });
  h.rows()[0].querySelector('button').click(); await flushDialogs();
  await h.refresh(state(observation([first], 'waiting', second)));
  assert.equal(h.opened[0][2].isCurrent(), false);
  pending.resolve(false); await flushDialogs(); assert.equal(h.element('projectBuildDialog').open, true);
});

test('current actor and historical scene links use frozen provenance and protect dirty drafts', async () => {
  for (const history of [false, true]) {
    const h = await harness(state(observation([first, second])));
    const button = () => history ? h.visits()[0].querySelector('button') : h.rows()[0].querySelector('button');
    for (const key of ['dirty', 'creating', 'busy']) {
      h.context[key] = true; button().dispatch('click'); await flushDialogs(); assert.equal(h.opened.length, 0, key);
      h.context[key] = false; h.controller.setAvailable(true);
    }
    button().click(); await flushDialogs(); assert.equal(h.opened.length, 1);
    assert.equal(h.opened[0][0], history ? members()[0].sourcePath : members()[1].sourcePath);
    assert.equal(h.opened[0][1].objectId, history ? first : second);
    assert.equal(h.opened[0][1].sourceRevision, revision);
    assert.equal(h.opened[0][1].propertyPath, history ? '' : '/actors/0');
    assert.equal(typeof h.opened[0][2].isCurrent, 'function'); assert.equal(h.element('projectBuildDialog').open, false);
    assert.ok(h.calls.every(call => call.body === null));
  }
});

test('frozen member names remain literal and live author membership cannot rename or redirect visits', async () => {
  const value = state(observation([first, second]));
  value.latestBuild.scenes[0].title = '<img src=x onerror=bad()> / 起点';
  value.scenes = value.scenes.filter(item => item.id === assembly);
  value.scenes[0].entrySceneId = third;
  const h = await harness(value);
  assert.equal(h.element('projectBuildRuntimeProject').hidden, false);
  assert.match(h.visits()[0].textContent, /<img src=x onerror=bad\(\)>/); assert.equal(h.visits()[0].querySelector('img'), null);
  assert.match(h.element('projectBuildRuntimeCurrentScene').textContent, /B \/ 中途/);
  h.visits()[0].querySelector('button').click(); await flushDialogs(); assert.equal(h.opened[0][0], 'documents/scenes/a.json');
});

test('polling and three-language changes preserve visit link focus and filtering without execution requests', async () => {
  const h = await harness(state(observation([first, second, first]))), before = h.calls.length;
  h.filter(instance); const firstLink = h.visits()[0].querySelector('button'); firstLink.focus();
  for (const dictionary of [en, ja, {}]) {
    h.language(dictionary);
    assert.equal(h.runtime.document.activeElement, h.visits()[0].querySelector('button'));
    assert.equal(h.element('projectBuildRuntimeSearch').value, instance);
    assert.equal(h.visits()[0].querySelector('button').textContent, dictionary['打开场景原文'] || '打开场景原文');
  }
  assert.equal(h.calls.length, before);
  const changed = state(observation([first, second, first])); changed.job.runtime.sequence = 2;
  changed.job.runtime.actors[0].state = 'moving'; changed.job.runtime.actors[0].positionCurrent = false;
  await h.refresh(changed); assert.equal(h.runtime.document.activeElement, h.visits()[0].querySelector('button'));
  assert.equal(h.element('projectBuildRuntimeSearch').value, instance); assert.ok(h.calls.every(call => !call.body));
});

test('new frozen member metadata invalidates an in-flight source owner even if task and visit IDs match', async () => {
  const pending = deferred(), h = await harness(state(), { openSource: () => pending.promise });
  h.visits()[0].querySelector('button').click(); await flushDialogs();
  const next = state(); next.latestBuild.scenes[0].sourceRevision = `sha256:${'d'.repeat(64)}`;
  await h.refresh(next); assert.equal(h.opened[0][2].isCurrent(), false);
  pending.resolve(false); await flushDialogs(); assert.equal(h.element('projectBuildDialog').open, true);
});

test('an admitted actor or history source read survives its own loading busy state and closes after host completion', async () => {
  for (const history of [false, true]) {
    const read = deferred(), writes = [], focused = []; let h;
    h = await harness(state(), { openSource: async (path, location, context) => {
      assert.equal(context.isCurrent(), true);
      h.context.busy = true; h.controller.setAvailable(true);
      try {
        await read.promise;
        assert.equal(context.isCurrent(), true, 'the host source read must not revoke its own owner');
        await Promise.resolve(); // The real host also awaits the source hash.
        if (!context.isCurrent()) return false;
        writes.push(path);
        return { focus: () => focused.push(h.element('projectBuildDialog').open) };
      } finally { h.context.busy = false; }
    } });
    const button = () => (history ? h.visits()[0] : h.rows()[0]).querySelector('button');
    h.context.busy = true; button().dispatch('click'); await flushDialogs(); assert.equal(h.opened.length, 0, 'external busy still blocks admission');
    h.context.busy = false; h.controller.setAvailable(true); button().click(); await flushDialogs();
    assert.equal(h.opened.length, 1); assert.equal(h.context.busy, true); assert.equal(button().disabled, true);
    assert.equal(h.opened[0][2].isCurrent(), true); button().dispatch('click'); await flushDialogs(); assert.equal(h.opened.length, 1);
    read.resolve(); await flushDialogs(); await flushDialogs();
    assert.deepEqual(writes, ['documents/scenes/a.json']); assert.equal(h.element('projectBuildDialog').open, false);
    assert.deepEqual(focused, [false]); assert.equal(h.context.busy, false);
  }
});

test('own source loading never relaxes visit, dialog, draft or host editor-token ownership', async () => {
  for (const interruption of ['dirty', 'creating', 'visit', 'dialog', 'host-editor-token']) {
    const read = deferred(), writes = []; let h, editorToken = 1;
    h = await harness(state(), { openSource: async (path, location, context) => {
      const token = editorToken; h.context.busy = true;
      try {
        await read.promise;
        // Model the existing openSavedSource host owner: its editor token and
        // source request remain independent of the build/visit guard.
        if (token !== editorToken || !context.isCurrent()) return false;
        writes.push(path); return true;
      } finally { h.context.busy = false; }
    } });
    h.rows()[0].querySelector('button').click(); await flushDialogs();
    assert.equal(h.opened[0][2].isCurrent(), true);
    if (interruption === 'dirty' || interruption === 'creating') h.context[interruption] = true;
    else if (interruption === 'visit') await h.refresh(state(observation([first, second, first])));
    else if (interruption === 'dialog') {
      h.element('projectBuildClose').click(); await flushDialogs(); h.element('projectBuildBtn').click(); await flushDialogs();
    } else editorToken++;
    if (interruption !== 'host-editor-token') assert.equal(h.opened[0][2].isCurrent(), false, interruption);
    read.resolve(); await flushDialogs();
    assert.deepEqual(writes, [], interruption); assert.equal(h.element('projectBuildDialog').open, true, interruption);
  }
});
