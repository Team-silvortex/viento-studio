import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { dialogHarness, flushDialogs } from './dialog-harness.mjs';
import { querySceneRuntimeObservation } from '../../engine/scene-runtime-query.mjs';
import { validateSceneControlProgram } from '../../engine/scene-control-program.mjs';
import en from '../../web/i18n/en.js';
import ja from '../../web/i18n/ja.js';

const sceneId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', otherSceneId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const objectId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', instanceIds = ['bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2'];
const snapshotId = `sha256:${'c'.repeat(64)}`, backendId = 'org.viento.bevy';
const released = () => ({ left: false, right: false, up: false, down: false });
const program = () => ({ format: 'viento-runtime-control', schemaVersion: 1, fixedDelta: 0.25, steps: [{ ...released(), right: true }, released()] });
function initial() {
  return { supported: true, available: true, platform: 'linux', backend: {
    format: 'viento-execution-backend', schemaVersion: 1, id: backendId, label: 'Bevy', version: '0.2.0', platforms: ['linux'],
    plans: [1, 2].map(version => ({ kind: 'scene2d', schemaVersion: version, runtimeProtocolVersion: version })),
    capabilities: ['scene2d', 'input.arrows', 'state.movement', 'runtime.control-replay'], execution: { build: true, headlessLogic: true,
      windowPreview: false, windowCapture: false, offscreenRender: false, embeddedViewport: false, gpuCompute: false }, extensions: [],
  }, scenes: [{ id: sceneId, title: 'Control sample', sourcePath: 'documents/scenes/demo.json' },
    { id: otherSceneId, title: 'Other scene', sourcePath: 'documents/scenes/other.json' }],
  latestBuild: { id: 'build-one', backendId, sceneId, snapshotId }, job: null };
}
function observed({ finished = false, stale = false } = {}) {
  const state = initial();
  state.job = { id: 'run-one', kind: 'run', status: finished ? 'succeeded' : 'running', sceneId, backendId, buildId: 'build-one', snapshotId,
    phase: 'running', diagnostics: [], events: [], logs: '', runtime: {
      format: 'viento-runtime-observation', schemaVersion: 1, sceneObjectId: sceneId, protocolVersion: 2,
      phase: finished ? 'finished' : 'ready', sequence: finished ? 4 : stale ? 3 : 2,
      control: { stepCount: 2, completedSteps: finished ? 2 : 1, fixedDelta: 0.25 },
      actors: instanceIds.map((instanceId, index) => ({ objectId, instanceId, name: index ? 'Author west' : '<Author east>',
        position: index ? [500, 220] : [240, 220], state: index === 0 && stale ? 'moving' : 'idle',
        positionSample: finished ? 'finished' : 'control', positionCurrent: !(index === 0 && stale), ...(finished ? {} : { positionStep: 0 }),
        source: { objectId: sceneId, sourcePath: 'documents/scenes/demo.json', propertyPath: `/actors/${index}`, sourceRevision: snapshotId },
      })),
    } };
  return state;
}
async function harness(state = initial()) {
  let payload = state, dictionary = {}; const calls = [], languages = [], opened = [];
  const context = { editable: true, dirty: false, busy: false, creating: false, path: 'documents/scenes/demo.json' };
  const translated = (key, ...values) => (dictionary[key] || key).replace(/\{(\d+)\}/g, (_, index) => values[index] ?? '');
  const h = await dialogHarness('app-project-build', {
    PROJECT_BUILD_API_PATH: '/api/project-build', querySceneRuntimeObservation,
    // Controller JSON comes from its VM realm. Match the browser's single
    // module realm before applying the actual portable validator in this fixture.
    validateSceneControlProgram: value => validateSceneControlProgram(JSON.parse(JSON.stringify(value))),
    t: translated, onLanguageChange: callback => languages.push(callback),
    translatePage: root => { for (const item of root.querySelectorAll('[data-i18n]')) item.textContent = translated(item.dataset.i18n); },
    fetchJsonApiRequest: async (url, request) => { calls.push({ url, body: request.body ? JSON.parse(request.body) : null }); return { payload }; },
  });
  const controller = h.runtime.setupProjectBuild({ getContext: () => context, openSource: (...args) => { opened.push(args); return false; } });
  controller.setAvailable(true); h.element('projectBuildBtn').click(); await flushDialogs();
  return { ...h, controller, context, calls, opened,
    async refresh(value = payload) { payload = value; h.element('projectBuildRefresh').click(); await flushDialogs(); },
    async tick(value = payload) { payload = value; const [id, callback] = [...h.timers][0] || []; assert.ok(callback); h.timers.delete(id); callback(); await flushDialogs(); },
    language(value) { dictionary = value; languages.forEach(callback => callback()); },
    input(value) { const input = h.element('projectBuildControlProgram'); input.value = value; input.dispatch('input'); return input; },
  };
}

test('control action submits validated values separately while the original headless action omits replay input', async () => {
  const h = await harness();
  assert.equal(h.element('projectBuildControl').hidden, false); assert.equal(h.element('projectBuildControl').disabled, false);
  assert.equal(h.element('projectBuildWindow').disabled, true);
  h.input(JSON.stringify(program())); h.element('projectBuildControl').click(); await flushDialogs();
  assert.deepEqual(h.calls.at(-1).body, { action: 'run', buildId: 'build-one', mode: 'headless', controlProgram: program() });
  h.element('projectBuildHeadless').click(); await flushDialogs();
  assert.deepEqual(h.calls.at(-1).body, { action: 'run', buildId: 'build-one', mode: 'headless' });
  assert.equal(h.context.dirty, false);
});

test('invalid control JSON, program and joint budget remain local with friendly errors and preserved text and selection', async () => {
  const h = await harness(), before = h.calls.length;
  for (const [value, message] of [['{bad-json', /有效的 JSON/], [JSON.stringify({ ...program(), fixedDelta: 0 }), /步长、步骤和方向键/]]) {
    const input = h.input(value); input.focus(); input.selectionStart = input.selectionEnd = 3;
    h.element('projectBuildControl').click(); await flushDialogs();
    assert.equal(h.calls.length, before); assert.equal(input.value, value); assert.equal(input.selectionStart, 3); assert.equal(input.selectionEnd, 3);
    assert.equal(h.document.activeElement, input); assert.equal(h.element('projectBuildControlEditor').open, true);
    assert.equal(h.element('projectBuildControlError').hidden, false); assert.match(h.element('projectBuildControlError').textContent, message);
  }
  const state = initial(); state.job = { id: 'plan-many', kind: 'plan', sceneId, backendId, status: 'succeeded', diagnostics: [], events: [], logs: '',
    plan: { snapshotId, title: 'Many actors', actorCount: 128, resourceCount: 0 } };
  await h.refresh(state); const calls = h.calls.length;
  h.input(JSON.stringify({ ...program(), fixedDelta: 0.125, steps: Array.from({ length: 64 }, released) }));
  h.element('projectBuildControl').click(); await flushDialogs(); assert.equal(h.calls.length, calls);
  assert.match(h.element('projectBuildControlError').textContent, /对象样本预算/);
  h.input(JSON.stringify(program())); assert.equal(h.element('projectBuildControlError').hidden, true);
  assert.match(h.element('projectBuildControlBudget').textContent, /2 步.*0.25.*0.5/);
});

test('control capability, owned builds, scene plans and live draft guards prevent submission', async () => {
  const h = await harness(); const before = h.calls.length;
  for (const flag of ['dirty', 'creating', 'busy']) {
    h.context[flag] = true; h.element('projectBuildControl').click(); await flushDialogs(); assert.equal(h.calls.length, before, flag);
    assert.equal(h.element('projectBuildControl').disabled, true); h.context[flag] = false; h.controller.setAvailable(true);
  }
  h.context.editable = false; h.element('projectBuildControl').click(); await flushDialogs(); assert.equal(h.calls.length, before);
  h.context.editable = true; h.controller.setAvailable(true);
  const denied = initial(); denied.backend.capabilities = denied.backend.capabilities.filter(value => value !== 'runtime.control-replay');
  await h.refresh(denied); assert.equal(h.element('projectBuildControl').hidden, true); assert.equal(h.element('projectBuildControlEditor').hidden, true);
  const foreign = initial(); foreign.latestBuild.sceneId = otherSceneId;
  const h2 = await harness(foreign); assert.equal(h2.element('projectBuildControl').disabled, true);
  const v3 = initial(); v3.job = { id: 'plan-v3', kind: 'plan', sceneId, backendId, status: 'succeeded', diagnostics: [], events: [], logs: '',
    plan: { snapshotId, title: 'Authored behaviors', actorCount: 2, resourceCount: 0, behaviorBindingCount: 1, behaviorSourceCount: 1 } };
  const h3 = await harness(v3); assert.equal(h3.element('projectBuildControl').disabled, true);
  const count = h3.calls.length; h3.element('projectBuildControl').click(); await flushDialogs(); assert.equal(h3.calls.length, count);
  const freshV3 = initial(); freshV3.latestBuild.planSchemaVersion = 3; freshV3.latestBuild.actorCount = 2;
  const h4 = await harness(freshV3); assert.equal(h4.element('projectBuildControl').disabled, true, 'frozen build facts guard a freshly reopened panel');
});

test('polling, reopening and switching all three interface languages preserve control input, caret and local errors', async () => {
  const h = await harness(observed()); const text = '{ this local program is unfinished';
  const input = h.input(text); input.focus(); input.selectionStart = 4; input.selectionEnd = 11;
  await h.tick(observed());
  assert.equal(h.document.activeElement, input); assert.equal(input.value, text); assert.equal(input.selectionStart, 4); assert.equal(input.selectionEnd, 11);
  h.element('projectBuildClose').click(); await flushDialogs(); h.element('projectBuildBtn').click(); await flushDialogs();
  assert.equal(input.value, text); assert.equal(input.selectionStart, 4); assert.equal(input.selectionEnd, 11);
  input.focus();
  for (const dictionary of [{}, en, ja]) {
    h.language(dictionary); assert.equal(h.document.activeElement, input); assert.equal(input.value, text);
    assert.equal(input.selectionStart, 4); assert.equal(input.selectionEnd, 11);
    assert.equal(h.element('projectBuildControl').textContent, dictionary['控制回放'] || '控制回放');
    assert.equal(h.element('projectBuildControlProgram').getAttribute('aria-describedby'), 'projectBuildControlBudget projectBuildControlError');
  }
});

test('control object views distinguish numbered, stale and finished samples and preserve declaration navigation guards', async () => {
  const h = await harness(observed()); const rows = () => h.element('projectBuildRuntimeObjectList').children;
  assert.equal(rows().length, 2); assert.match(h.element('projectBuildRuntimePhase').textContent, /已收到 1 \/ 2 步/);
  assert.match(rows()[0].querySelector('.build-runtime-sample').textContent, /控制步骤 1 的位置样本/);
  assert.equal(rows()[0].querySelector('h4').textContent, '<Author east>');
  await h.tick(observed({ stale: true })); assert.match(rows()[0].querySelector('.build-runtime-sample').textContent, /控制步骤 1.*状态已变化，位置未更新/);
  h.context.dirty = true; h.controller.setAvailable(true); assert.equal(rows()[0].querySelector('button').disabled, true);
  h.context.dirty = false; h.controller.setAvailable(true); rows()[1].querySelector('button').click(); await flushDialogs();
  assert.equal(h.opened.length, 1); assert.equal(h.opened[0][1].propertyPath, '/actors/1'); assert.equal(h.element('projectBuildDialog').open, true);
  await h.tick(observed({ finished: true })); assert.match(h.element('projectBuildRuntimePhase').textContent, /已收到 2 \/ 2 步.*结束位置样本/);
  assert.equal(rows()[0].querySelector('.build-runtime-sample').textContent, '结束样本');
  const foreign = observed({ finished: true }); foreign.job.buildId = 'foreign-build'; await h.refresh(foreign);
  assert.equal(h.element('projectBuildRuntimeObjects').hidden, true); assert.equal(rows().length, 0);
});

test('all control replay labels and bounded editor layout are available in English and Japanese', async () => {
  const source = await fs.readFile(new URL('../../web/modules/app-project-build.js', import.meta.url), 'utf8');
  const keys = [...source.matchAll(/(?:t\(|data-i18n=")["']?([^\n"']*[\u3400-\u9fff][^\n"']*)["']/g)].map(match => match[1]);
  for (const key of keys) for (const [locale, dictionary] of [['en', en], ['ja', ja]]) assert.ok(dictionary[key], `${locale}: ${key}`);
  const css = await fs.readFile(new URL('../../web/project-build.css', import.meta.url), 'utf8');
  assert.match(css, /\.build-control-editor > textarea\s*\{[^}]*width: 100%;[^}]*min-width: 0;/);
  assert.match(css, /:is\(button, input, textarea, select, summary, pre\):focus-visible/);
});
