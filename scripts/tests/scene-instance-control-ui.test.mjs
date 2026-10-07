import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { dialogHarness, flushDialogs } from './dialog-harness.mjs';
import { querySceneRuntimeObservation } from '../../engine/scene-runtime-query.mjs';
import { validateSceneControlProgram, validateSceneControlPlan } from '../../engine/scene-control-program.mjs';
import en from '../../web/i18n/en.js';
import ja from '../../web/i18n/ja.js';

const sceneId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', otherSceneId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const objectId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const instances = ['bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2'];
const snapshotId = `sha256:${'c'.repeat(64)}`, backendId = 'org.viento.bevy';
const released = () => ({ left: false, right: false, up: false, down: false });
const row = (instanceId, direction) => ({ instanceId, ...released(), ...(direction ? { [direction]: true } : {}) });
const program = () => ({ format: 'viento-runtime-control', schemaVersion: 2, fixedDelta: 0.125,
  steps: [{ inputs: [row(instances[0], 'right'), row(instances[1], 'left')] }, { inputs: [row(instances[1], 'up')] },
    { inputs: [row(instances[0], 'left')] }, { inputs: [] }] });
function initial() {
  return { supported: true, available: true, platform: 'linux', backend: {
    format: 'viento-execution-backend', schemaVersion: 1, id: backendId, label: 'Bevy', version: '0.3.0', platforms: ['linux'],
    plans: [1, 2].map(version => ({ kind: 'scene2d', schemaVersion: version, runtimeProtocolVersion: version })),
    capabilities: ['scene2d', 'input.arrows', 'state.movement', 'runtime.control-replay', 'runtime.control-replay.instances'],
    execution: { build: true, headlessLogic: true, windowPreview: false, windowCapture: false, offscreenRender: false, embeddedViewport: false, gpuCompute: false }, extensions: [],
  }, scenes: [{ id: sceneId, title: 'Instance control sample', sourcePath: 'documents/scenes/demo.json' },
    { id: otherSceneId, title: 'Other scene', sourcePath: 'documents/scenes/other.json' }],
  latestBuild: { id: 'build-one', backendId, sceneId, snapshotId, planSchemaVersion: 2, actorCount: 2,
    controlTargets: instances.map(instanceId => ({ instanceId, objectId, name: '<Same definition>' })) }, job: null };
}
async function harness(state = initial()) {
  let payload = state, dictionary = {}; const calls = [], languages = [];
  const context = { editable: true, dirty: false, busy: false, creating: false, path: 'documents/scenes/demo.json' };
  const translated = (key, ...values) => (dictionary[key] || key).replace(/\{(\d+)\}/g, (_, index) => values[index] ?? '');
  const detach = value => JSON.parse(JSON.stringify(value));
  const h = await dialogHarness('app-project-build', {
    PROJECT_BUILD_API_PATH: '/api/project-build', querySceneRuntimeObservation,
    // Browser imports share one realm; make this VM fixture match that boundary.
    validateSceneControlProgram: value => validateSceneControlProgram(detach(value)),
    validateSceneControlPlan: (plan, value) => validateSceneControlPlan(detach(plan), detach(value)),
    t: translated, onLanguageChange: callback => languages.push(callback),
    translatePage: root => { for (const item of root.querySelectorAll('[data-i18n]')) item.textContent = translated(item.dataset.i18n); },
    fetchJsonApiRequest: async (url, request) => { calls.push({ url, body: request.body ? JSON.parse(request.body) : null }); return { payload }; },
  });
  const controller = h.runtime.setupProjectBuild({ getContext: () => context });
  controller.setAvailable(true); h.element('projectBuildBtn').click(); await flushDialogs();
  return { ...h, controller, context, calls,
    async refresh(value = payload) { payload = value; h.element('projectBuildRefresh').click(); await flushDialogs(); },
    async tick(value = payload) { payload = value; const [id, callback] = [...h.timers][0] || []; assert.ok(callback); h.timers.delete(id); callback(); await flushDialogs(); },
    language(value) { dictionary = value; languages.forEach(callback => callback()); },
    input(value) { const input = h.element('projectBuildControlProgram'); input.value = value; input.dispatch('input'); return input; },
    target(value) { const target = h.element('projectBuildControlTarget'); target.value = value; target.dispatch('change'); return target; },
  };
}

test('instance selection distinguishes repeated definitions and changes JSON only after explicit example generation', async () => {
  const h = await harness(), input = h.element('projectBuildControlProgram'), original = input.value;
  assert.equal(JSON.parse(original).schemaVersion, 1); assert.equal(h.element('projectBuildControlTarget').children.length, 3);
  const options = h.element('projectBuildControlTarget').children;
  assert.equal(options[0].value, ''); assert.equal(options[1].value, instances[0]); assert.equal(options[2].value, instances[1]);
  for (let i = 0; i < 2; i++) {
    assert.match(options[i + 1].textContent, new RegExp(`^${instances[i].slice(-8)} ·`), 'closed selector distinguishes the shared-name instances first');
    assert.ok(options[i + 1].textContent.includes('<Same definition>'));
    assert.ok(options[i + 1].title.includes(instances[i]), 'complete identity remains available on the option');
  }
  const edited = '{ local incomplete input'; h.input(edited); input.focus(); input.selectionStart = 2; input.selectionEnd = 9;
  h.target(instances[1]); assert.equal(input.value, edited); assert.equal(input.selectionStart, 2); assert.equal(input.selectionEnd, 9);
  assert.equal(h.element('projectBuildControlTargetHint').hidden, false);
  h.element('projectBuildControlExample').click();
  const generated = JSON.parse(input.value); assert.equal(generated.schemaVersion, 2); assert.equal(generated.fixedDelta, 0.25);
  assert.equal(generated.steps.length, 4); assert.ok(generated.steps.every(step => step.inputs.length === 1 && step.inputs[0].instanceId === instances[1]));
  assert.equal(generated.steps[0].inputs[0].right, true); assert.equal(generated.steps[2].inputs[0].left, true);
  assert.deepEqual(generated.steps.at(-1).inputs[0], row(instances[1])); assert.equal(h.document.activeElement, input);
  const instanceJson = input.value; h.target(''); assert.equal(input.value, instanceJson);
  h.element('projectBuildControlExample').click(); assert.equal(input.value, original); assert.equal(h.context.dirty, false);
  assert.ok(h.calls.every(call => !call.body), 'example generation never writes authors or starts a job');
});

test('instance choices require both capabilities and owned plan2 facts while global and ordinary headless actions remain compatible', async () => {
  for (const kind of ['missing-capability', 'plan1', 'foreign-build', 'missing-build', 'mismatched-count', 'duplicate-targets']) {
    const state = initial();
    if (kind === 'missing-capability') state.backend.capabilities = state.backend.capabilities.filter(value => value !== 'runtime.control-replay.instances');
    if (kind === 'plan1') state.latestBuild.planSchemaVersion = 1;
    if (kind === 'foreign-build') state.latestBuild.sceneId = otherSceneId;
    if (kind === 'missing-build') state.latestBuild = null;
    if (kind === 'mismatched-count') state.latestBuild.actorCount = 3;
    if (kind === 'duplicate-targets') state.latestBuild.controlTargets[1].instanceId = instances[0];
    const h = await harness(state); assert.equal(h.element('projectBuildControlTarget').children.length, 1, kind);
    const before = h.calls.length; h.input(JSON.stringify(program())); h.element('projectBuildControl').click(); await flushDialogs();
    assert.equal(h.calls.length, before, kind);
    if (!['foreign-build', 'missing-build'].includes(kind)) {
      assert.match(h.element('projectBuildControlError').textContent, /不支持控制回放/);
      h.element('projectBuildControlExample').click(); assert.equal(JSON.parse(h.element('projectBuildControlProgram').value).schemaVersion, 1);
      h.element('projectBuildHeadless').click(); await flushDialogs();
      assert.deepEqual(h.calls.at(-1).body, { action: 'run', buildId: 'build-one', mode: 'headless' });
    } else assert.equal(h.element('projectBuildControlExample').disabled, true);
  }
});

test('polling, reopening and three interface languages preserve instance choice, edited JSON, focus and selection', async () => {
  const state = initial(); state.job = { id: 'running-one', kind: 'run', status: 'running', sceneId, backendId, buildId: 'build-one', snapshotId, diagnostics: [], events: [], logs: '' };
  const h = await harness(state); h.target(instances[1]);
  const text = '{ user-owned unfinished JSON'; const input = h.input(text); input.focus(); input.selectionStart = 4; input.selectionEnd = 17;
  await h.tick(state);
  h.element('projectBuildClose').click(); await flushDialogs(); h.element('projectBuildBtn').click(); await flushDialogs(); input.focus();
  for (const dictionary of [{}, en, ja]) {
    h.language(dictionary); assert.equal(h.element('projectBuildControlTarget').value, instances[1]);
    assert.equal(input.value, text); assert.equal(input.selectionStart, 4); assert.equal(input.selectionEnd, 17); assert.equal(h.document.activeElement, input);
    assert.equal(h.element('projectBuildControlExample').textContent, dictionary['生成输入示例'] || '生成输入示例');
    assert.equal(h.element('projectBuildControlTarget').children[0].textContent, dictionary['全部方向键实例（全局）'] || '全部方向键实例（全局）');
  }
});

test('live draft and active-job guards disable target examples and replay while retaining local input', async () => {
  const h = await harness(); h.target(instances[1]); const text = JSON.stringify(program()), input = h.input(text);
  input.focus(); input.selectionStart = input.selectionEnd = 23;
  for (const flag of ['dirty', 'creating', 'busy']) {
    h.context[flag] = true;
    // Dispatch directly to exercise live handler admission, even before render.
    h.element('projectBuildControlExample').dispatch('click'); h.element('projectBuildControl').dispatch('click'); await flushDialogs();
    assert.equal(input.value, text, flag); assert.equal(input.selectionStart, 23, flag);
    assert.equal(h.element('projectBuildControlTarget').disabled, true, flag); assert.equal(h.element('projectBuildControlExample').disabled, true, flag);
    assert.equal(h.element('projectBuildControl').disabled, true, flag);
    h.context[flag] = false; h.controller.setAvailable(true);
  }
  assert.ok(h.calls.every(call => !call.body));
  const active = initial(); active.job = { id: 'running-one', kind: 'run', status: 'running', sceneId, backendId, buildId: 'build-one', snapshotId, diagnostics: [], events: [], logs: '' };
  await h.refresh(active); assert.equal(h.element('projectBuildControlTarget').disabled, true); assert.equal(h.element('projectBuildControlExample').disabled, true);
  h.element('projectBuildControlExample').click(); assert.equal(input.value, text); assert.equal(input.selectionStart, 23);
});

test('manual sparse JSON submits exact values; unknown, definition and duplicate rows fail locally without a new request', async () => {
  const h = await harness(); h.input(JSON.stringify(program())); h.element('projectBuildControl').click(); await flushDialogs();
  assert.deepEqual(h.calls.at(-1).body, { action: 'run', buildId: 'build-one', mode: 'headless', controlProgram: program() });
  const before = h.calls.length;
  for (const [value, message] of [
    [{ ...program(), steps: [{ inputs: [row(otherSceneId)] }] }, /实例不属于这份构建/],
    [{ ...program(), steps: [{ inputs: [row(objectId)] }] }, /实例不属于这份构建/],
    [{ ...program(), steps: [{ inputs: [row(instances[0]), row(instances[0])] }] }, /步长、步骤和方向键/],
    [{ ...program(), steps: [{ inputs: [{ ...row(instances[0]), sourcePath: '/tmp/author' }] }] }, /步长、步骤和方向键/],
  ]) {
    const text = JSON.stringify(value), input = h.input(text); input.focus(); input.selectionStart = input.selectionEnd = 5;
    h.element('projectBuildControl').click(); await flushDialogs(); assert.equal(h.calls.length, before);
    assert.match(h.element('projectBuildControlError').textContent, message); assert.equal(input.value, text); assert.equal(input.selectionStart, 5);
  }
});

test('a new frozen build drops stale selection without rewriting JSON; target controls provide translated, narrow accessible labels', async () => {
  const h = await harness(); h.target(instances[1]); const input = h.input(JSON.stringify(program())); input.focus(); input.selectionStart = input.selectionEnd = 23;
  const text = input.value, replacement = initial(); replacement.latestBuild.id = 'build-two'; replacement.latestBuild.snapshotId = `sha256:${'d'.repeat(64)}`;
  replacement.latestBuild.controlTargets = [{ instanceId: otherSceneId, objectId, name: 'Replacement' }]; replacement.latestBuild.actorCount = 1;
  await h.refresh(replacement); assert.equal(h.element('projectBuildControlTarget').value, ''); assert.equal(input.value, text); assert.equal(input.selectionStart, 23);
  const before = h.calls.length; h.element('projectBuildControl').click(); await flushDialogs(); assert.equal(h.calls.length, before);
  assert.match(h.element('projectBuildControlError').textContent, /实例不属于这份构建/);
  assert.equal(input.getAttribute('maxlength'), '262144');
  assert.equal(h.element('projectBuildControlTarget').tagName, 'SELECT');
  const source = await fs.readFile(new URL('../../web/modules/app-project-build.js', import.meta.url), 'utf8');
  assert.match(source, /for="projectBuildControlTarget" data-i18n="输入示例的目标"/);
  const keys = ['输入示例的目标', '生成输入示例', '全部方向键实例（全局）',
    '实例输入按步骤独立生效；某一步未列出的实例会释放方向键，不延续上一步输入。',
    '控制程序引用的实例不属于这份构建，请核对实例标识。'];
  for (const key of keys) for (const [locale, dictionary] of [['en', en], ['ja', ja]]) assert.ok(dictionary[key], `${locale}: ${key}`);
  const css = await fs.readFile(new URL('../../web/project-build.css', import.meta.url), 'utf8');
  assert.match(css, /\.build-control-target > select\s*\{[^}]*width: 100%;[^}]*min-width: 0;/);
  assert.match(css, /@media \(max-width: 600px\)\s*\{\s*\.build-control-target\s*\{\s*grid-template-columns: minmax\(0, 1fr\);/);
});
