import test from 'node:test';
import assert from 'node:assert/strict';
import { dialogHarness, flushDialogs } from './dialog-harness.mjs';
import { deferred } from './editor-harness.mjs';
import { querySceneRuntimeObservation } from '../../engine/scene-runtime-query.mjs';
import en from '../../web/i18n/en.js';
import ja from '../../web/i18n/ja.js';

const sceneId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const otherSceneId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const objectId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const instanceIds = ['bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2'];
const snapshotId = `sha256:${'c'.repeat(64)}`, backendId = 'org.viento.bevy';
const source = index => ({ objectId: sceneId, sourcePath: 'documents/scenes/demo.json', propertyPath: `/actors/${index}`,
  sourceRevision: `sha256:${'d'.repeat(64)}`, sourceRange: { start: 20 + index * 40, end: 39 + index * 40, encoding: 'utf-16', exact: true } });
function observation(phase = 'ready', protocolVersion = 2) {
  return { format: 'viento-runtime-observation', schemaVersion: 1, sceneObjectId: sceneId, protocolVersion,
    phase, sequence: phase === 'waiting' ? 0 : phase === 'ready' ? 1 : 4,
    actors: instanceIds.map((instanceId, index) => ({ objectId, ...(protocolVersion === 1 ? {} : { instanceId }), name: index ? 'Hero west' : 'Hero east',
      position: phase === 'waiting' ? null : index ? [500, 220] : phase === 'finished' ? [240, 220] : [200, 220],
      state: phase === 'waiting' ? null : 'idle', positionSample: phase === 'waiting' ? null : phase,
      positionCurrent: phase !== 'waiting', source: source(index) })) };
}
function initial(view = observation()) {
  return { supported: true, available: true, platform: 'linux',
    backend: { format: 'viento-execution-backend', schemaVersion: 1, id: backendId, label: 'Bevy', version: '0.1.0', platforms: ['linux'],
      plans: [1, 2, 3].map(version => ({ kind: 'scene2d', schemaVersion: version, runtimeProtocolVersion: version })),
      capabilities: ['scene2d', 'input.arrows', 'state.movement'], execution: { build: true, headlessLogic: true, windowPreview: false,
        windowCapture: false, offscreenRender: false, embeddedViewport: false, gpuCompute: false }, extensions: [] },
    scenes: [{ id: sceneId, title: 'Runtime inspection', sourcePath: 'documents/scenes/demo.json' },
      { id: otherSceneId, title: 'Other scene', sourcePath: 'documents/scenes/other.json' }],
    latestBuild: { id: 'built-one', backendId, sceneId, snapshotId },
    job: { id: 'run-one', kind: 'run', status: 'running', sceneId, backendId, buildId: 'built-one', snapshotId,
      phase: 'running', diagnostics: [], events: [], logs: '', runtime: view } };
}
async function harness(state = initial(), options = {}) {
  let payload = state, dictionary = options.dictionary || {};
  const calls = [], opened = [], languages = [];
  const context = { editable: true, dirty: false, busy: false, creating: false, path: 'documents/scenes/demo.json' };
  const translated = (key, ...values) => (dictionary[key] || key).replace(/\{(\d+)\}/g, (_, index) => values[index] ?? '');
  const h = await dialogHarness('app-project-build', { PROJECT_BUILD_API_PATH: '/api/project-build', querySceneRuntimeObservation,
    t: translated, onLanguageChange: callback => languages.push(callback),
    translatePage: root => { for (const item of root.querySelectorAll('[data-i18n]')) item.textContent = translated(item.dataset.i18n); },
    fetchJsonApiRequest: async (url, request) => { calls.push({ url, body: request.body ? JSON.parse(request.body) : null }); return { payload }; },
  });
  const controller = h.runtime.setupProjectBuild({ getContext: () => context, openSource: (...args) => {
    opened.push(args); return options.openSource ? options.openSource(...args) : true;
  } });
  controller.setAvailable(true); h.element('projectBuildBtn').click(); await flushDialogs();
  return { ...h, context, controller, calls, opened,
    rows: () => h.element('projectBuildRuntimeObjectList').children,
    async refresh(value = payload) { payload = value; h.element('projectBuildRefresh').click(); await flushDialogs(); },
    async tick(value = payload) { payload = value; const [id, callback] = [...h.timers][0] || []; assert.ok(callback); h.timers.delete(id); callback(); await flushDialogs(); },
    filter(value) { h.element('projectBuildRuntimeSearch').value = value; h.element('projectBuildRuntimeSearch').dispatch('input'); },
    language(next) { dictionary = next; languages.forEach(callback => callback()); },
  };
}

test('runtime cards distinguish waiting, startup, stale state changes and final samples without estimating positions', async () => {
  const h = await harness(initial(observation('waiting')));
  assert.equal(h.element('projectBuildRuntimeObjects').hidden, false);
  assert.equal(h.rows().length, 2); assert.match(h.rows()[0].textContent, /等待状态样本/);
  assert.match(h.rows()[0].textContent, /尚未收到位置样本/); assert.ok(!h.rows()[0].textContent.includes('(200, 220)'));
  await h.tick(initial());
  assert.equal(h.rows()[0].querySelector('.build-runtime-position').textContent, '位置样本：(200, 220)');
  assert.equal(h.rows()[0].querySelector('.build-runtime-sample').textContent, '启动样本');
  const moving = initial(); moving.job.runtime.sequence = 2;
  Object.assign(moving.job.runtime.actors[0], { state: 'moving', positionCurrent: false });
  await h.tick(moving);
  assert.equal(h.rows()[0].querySelector('.build-runtime-state').textContent, '状态：移动中');
  assert.equal(h.rows()[0].querySelector('.build-runtime-position').textContent, '位置样本：(200, 220)');
  assert.match(h.rows()[0].querySelector('.build-runtime-sample').textContent, /状态已变化，位置未更新/);
  assert.equal(h.rows()[1].querySelector('.build-runtime-sample').textContent, '启动样本');
  const finished = initial(observation('finished')); finished.job.status = 'succeeded';
  await h.tick(finished);
  assert.equal(h.rows()[0].querySelector('.build-runtime-position').textContent, '位置样本：(240, 220)');
  assert.equal(h.rows()[0].querySelector('.build-runtime-sample').textContent, '结束样本');
  assert.equal(h.rows()[1].querySelector('.build-runtime-position').textContent, '位置样本：(500, 220)');
  assert.match(h.element('projectBuildRuntimePhase').textContent, /结束位置样本/);
  assert.equal(h.timers.size, 0);
});

test('shared object definitions retain separate instance rows and local filtering survives polling and language changes', async () => {
  const h = await harness(), input = h.element('projectBuildRuntimeSearch');
  assert.deepEqual(h.rows().map(row => row.dataset.instanceId), instanceIds);
  assert.deepEqual(h.rows().map(row => row.dataset.objectId), [objectId, objectId]);
  const before = h.calls.length;
  h.filter('hErO eAsT'); assert.equal(h.rows().length, 1); assert.equal(h.rows()[0].dataset.instanceId, instanceIds[0]);
  h.filter(objectId); assert.equal(h.rows().length, 2);
  h.filter(instanceIds[1]); assert.equal(h.rows().length, 1); assert.equal(h.calls.length, before);
  input.focus(); input.selectionStart = input.selectionEnd = 12;
  await h.tick(initial());
  assert.equal(h.runtime.document.activeElement, input); assert.equal(input.selectionStart, 12); assert.equal(input.selectionEnd, 12);
  assert.equal(input.value, instanceIds[1]); assert.equal(h.rows().length, 1);
  h.language(ja);
  assert.equal(h.runtime.document.activeElement, input); assert.equal(input.value, instanceIds[1]); assert.equal(input.selectionStart, 12);
  assert.match(h.element('projectBuildRuntimeCount').textContent, /2 件中 1 件/);
  h.filter('no matching instance'); assert.equal(h.rows().length, 0);
  assert.equal(h.element('projectBuildRuntimeEmpty').hidden, false); assert.match(h.element('projectBuildRuntimeEmpty').textContent, /一致する/);
});

test('polling preserves keyboard focus on a declaration link, including when the observed state changes', async () => {
  const h = await harness(), sourceButton = h.rows()[1].querySelector('button');
  sourceButton.focus(); await h.tick(initial());
  assert.equal(h.rows()[1].querySelector('button'), sourceButton);
  assert.equal(h.runtime.document.activeElement, sourceButton);
  const moving = initial(); moving.job.runtime.sequence = 2;
  Object.assign(moving.job.runtime.actors[1], { state: 'moving', positionCurrent: false });
  await h.tick(moving);
  assert.equal(h.runtime.document.activeElement, h.rows()[1].querySelector('button'));
  assert.equal(h.rows()[1].dataset.instanceId, instanceIds[1]);
  assert.match(h.rows()[1].textContent, /状态已变化，位置未更新/);
});

test('wrong scene, backend, artifact, snapshot, protocol and malformed observations never produce runtime object cards', async () => {
  const changes = [value => { value.job.kind = 'build'; }, value => { value.job.runtime = null; },
    value => { value.supported = false; }, value => { value.backend.execution.headlessLogic = false; },
    value => { value.backend.execution.headlessLogic = 'true'; },
    value => { value.job.sceneId = otherSceneId; }, value => { value.job.backendId = 'org.viento.foreign'; },
    value => { value.job.buildId = 'foreign-build'; }, value => { value.latestBuild.backendId = 'org.viento.foreign'; },
    value => { value.latestBuild.sceneId = otherSceneId; }, value => { value.job.snapshotId = `sha256:${'f'.repeat(64)}`; },
    value => { value.job.snapshotId = value.latestBuild.snapshotId = 'sha256:broken'; }, value => { value.latestBuild = null; },
    value => { value.job.runtime.sceneObjectId = otherSceneId; }, value => { value.backend.plans = value.backend.plans.slice(0, 1); },
    value => { value.job.runtime.actors[1].instanceId = instanceIds[0]; }, value => { value.job.runtime.actors[0].position = [1, null]; },
    value => { value.job.runtime.actors[0].source.sourcePath = '../untrusted.json'; },
    value => { value.job.runtime.actors[0].engineEntity = 12; }, value => { value.job.runtime.sequence = -1; }];
  for (const change of changes) {
    const state = initial(); change(state); const h = await harness(state);
    assert.equal(h.element('projectBuildRuntimeObjects').hidden, true, change.toString()); assert.equal(h.rows().length, 0);
    assert.equal(h.element('projectBuildRuntimePhase').textContent, '');
  }
});

test('backend changes invalidate prior observations permanently, and fresh run ownership resets search and stale rows', async () => {
  const h = await harness(); h.filter(instanceIds[0]); const oldButton = h.rows()[0].querySelector('button');
  const changed = initial(); changed.backend.version = '0.2.0'; await h.refresh(changed);
  assert.equal(h.element('projectBuildRuntimeObjects').hidden, true); assert.equal(h.rows().length, 0);
  assert.equal(h.element('projectBuildRuntimeSearch').value, '');
  await h.refresh(initial()); assert.equal(h.element('projectBuildRuntimeObjects').hidden, true);
  const fresh = initial(); fresh.latestBuild.id = fresh.job.buildId = 'built-two'; fresh.job.id = 'run-two';
  await h.refresh(fresh); assert.equal(h.rows().length, 2);
  oldButton.dispatch('click'); await flushDialogs(); assert.equal(h.opened.length, 0);
  h.filter(instanceIds[1]);
  await h.refresh({ ...fresh, job: { ...fresh.job, id: 'run-three', runtime: null } });
  assert.equal(h.rows().length, 0); assert.equal(h.element('projectBuildRuntimeSearch').value, '');
});

test('cancelled runs retain their last observed samples, while an empty valid view has an explicit empty message', async () => {
  const state = initial(); state.job.status = 'cancelled'; state.job.runtime.sequence = 2;
  Object.assign(state.job.runtime.actors[0], { state: 'moving', positionCurrent: false });
  const h = await harness(state);
  assert.equal(h.rows().length, 2); assert.match(h.rows()[0].textContent, /状态已变化，位置未更新/);
  assert.equal(h.element('projectBuildRuntimePhase').textContent, '已收到启动样本；状态变化不会更新位置。');
  assert.equal(h.timers.size, 0);
  const empty = initial(); empty.job.runtime.actors = []; await h.refresh(empty);
  assert.equal(h.element('projectBuildRuntimeObjects').hidden, false); assert.equal(h.rows().length, 0);
  assert.equal(h.element('projectBuildRuntimeEmpty').textContent, '本次运行没有对象。');
  assert.equal(h.element('projectBuildRuntimeCount').textContent, '显示 0 / 0 个运行对象');
  const unavailable = initial(); unavailable.available = false; unavailable.reason = 'tool_missing'; await h.refresh(unavailable);
  assert.equal(h.rows().length, 2, 'reading already observed samples does not require an available execution tool');
});

test('frozen declaration links navigate exact source and focus only after close; draft and busy contexts preserve content and caret', async () => {
  let h; const focused = [];
  h = await harness(initial(), { openSource: () => ({ focus: () => {
    focused.push(h.element('projectBuildDialog').open); h.element('docSourceEditor').focus();
  } }) });
  const editor = h.element('docSourceEditor'); editor.value = 'unsaved draft'; editor.selectionStart = editor.selectionEnd = 8;
  const link = h.rows()[0].querySelector('button');
  for (const key of ['dirty', 'creating', 'busy']) {
    h.context[key] = true; link.dispatch('click'); await flushDialogs();
    assert.equal(h.opened.length, 0); assert.equal(h.element('projectBuildDialog').open, true);
    assert.equal(editor.value, 'unsaved draft'); assert.equal(editor.selectionStart, 8);
    assert.equal(h.rows()[0].querySelector('button').disabled, true);
    h.context[key] = false; h.controller.setAvailable(true);
  }
  h.rows()[1].querySelector('button').click(); await flushDialogs(); await flushDialogs();
  assert.deepEqual(h.opened[0], ['documents/scenes/demo.json', source(1)]);
  assert.deepEqual(focused, [false]); assert.equal(h.runtime.document.activeElement, editor);
  assert.equal(editor.value, 'unsaved draft'); assert.equal(editor.selectionStart, 8);
});

test('late source navigation cannot close a changed run, reopened panel or newly dirty editor', async () => {
  for (const interruption of ['job', 'scene', 'reopen', 'dirty']) {
    const pending = deferred(), focused = [];
    const h = await harness(initial(), { openSource: () => pending.promise });
    h.rows()[0].querySelector('button').click(); await flushDialogs();
    if (interruption === 'job') { const next = initial(); next.job.id = 'run-next'; await h.refresh(next); }
    else if (interruption === 'scene') { h.element('projectBuildScene').value = otherSceneId; h.element('projectBuildScene').dispatch('change'); }
    else if (interruption === 'reopen') { h.element('projectBuildClose').click(); await flushDialogs(); h.element('projectBuildBtn').click(); await flushDialogs(); }
    else h.context.dirty = true;
    pending.resolve({ focus: () => focused.push(true) }); await flushDialogs();
    assert.equal(h.element('projectBuildDialog').open, true, interruption); assert.deepEqual(focused, [], interruption);
  }
});

test('all three languages translate observation labels, states and samples without translating authored names or interpreting markup', async () => {
  for (const dictionary of [{}, en, ja]) {
    const state = initial(observation('finished')); state.job.status = 'succeeded';
    state.job.runtime.actors[0].name = '<img src=x onerror=globalThis.runtimeInjected=true>';
    state.job.runtime.actors[1].name = '静止';
    const h = await harness(state, { dictionary }), row = h.rows()[0];
    assert.equal(h.element('projectBuildRuntimeObjectsTitle').textContent, dictionary['运行对象'] || '运行对象');
    assert.equal(row.querySelector('h4').textContent, state.job.runtime.actors[0].name); assert.equal(row.querySelector('img'), null);
    assert.equal(h.rows()[1].querySelector('h4').textContent, '静止');
    assert.equal(row.querySelector('.build-runtime-state').textContent,
      (dictionary['状态：{0}'] || '状态：{0}').replace('{0}', dictionary['静止'] || '静止'));
    assert.equal(row.querySelector('.build-runtime-sample').textContent, dictionary['结束样本'] || '结束样本');
    assert.equal(h.runtime.runtimeInjected, undefined);
  }
});

test('legacy protocol 1 keeps definition identity, and protocol 3 uses stable instances without engine handles', async () => {
  for (const protocol of [1, 3]) {
    const view = observation('ready', protocol);
    if (protocol === 1) view.actors = view.actors.slice(0, 1);
    const h = await harness(initial(view)); assert.equal(h.rows().length, protocol === 1 ? 1 : 2);
    assert.equal(h.rows()[0].dataset.objectId, objectId);
    assert.equal(h.rows()[0].dataset.instanceId, protocol === 1 ? undefined : instanceIds[0]);
    assert.equal(h.rows()[0].querySelector('button').textContent, protocol === 1 ? '打开对象声明' : '打开实例声明');
    assert.ok(!h.rows()[0].textContent.includes('Entity'));
  }
});

test('runtime browsing sends no requests and existing run/cancel payloads retain the same whitelist', async () => {
  const state = initial(observation('finished')); state.job.status = 'succeeded';
  const h = await harness(state), before = h.calls.length;
  h.filter(instanceIds[0]); h.language(en); h.filter('Hero');
  assert.equal(h.calls.length, before);
  h.element('projectBuildHeadless').click(); await flushDialogs();
  assert.deepEqual(h.calls.at(-1).body, { action: 'run', buildId: 'built-one', mode: 'headless' });
  await h.refresh(initial()); h.element('projectBuildCancel').click(); await flushDialogs();
  assert.deepEqual(h.calls.at(-1).body, { action: 'cancel', jobId: 'run-one' });
  assert.ok(h.calls.every(call => !call.body || !['runtime', 'instanceId', 'objectId', 'tool', 'backend', 'engineEntity'].some(key => key in call.body)));
});
