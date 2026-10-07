import test from 'node:test';
import assert from 'node:assert/strict';
import { dialogHarness, flushDialogs } from './dialog-harness.mjs';
import en from '../../web/i18n/en.js';
import ja from '../../web/i18n/ja.js';

const backendId = 'org.viento.godot4', sceneId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const instanceIds = ['bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2'];
const bindingIds = ['99999999-9999-4999-8999-999999999991', '99999999-9999-4999-8999-999999999992'];
const behavior = (index, args) => ({ protocol: 3, event: 'behavior', objectId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  instanceId: instanceIds[index], bindingId: bindingIds[index], name: 'checkpoint', arguments: args });
const initial = () => ({ supported: true, available: true, platform: 'linux',
  backend: { format: 'viento-execution-backend', schemaVersion: 1, id: backendId, label: 'Godot 4', version: '0.2.0',
    platforms: ['linux'], plans: [{ kind: 'scene2d', schemaVersion: 2, runtimeProtocolVersion: 2 }],
    capabilities: ['scene2d', 'image'], execution: { build: true, headlessLogic: true, windowPreview: true, windowCapture: true,
      offscreenRender: false, embeddedViewport: false, gpuCompute: false }, extensions: [] },
  scenes: [{ id: sceneId, title: 'Bound scene', sourcePath: 'documents/scenes/demo.json' }],
  latestBuild: { id: 'built', backendId, sceneId },
  job: { id: 'plan', backendId, sceneId, kind: 'plan', status: 'succeeded',
    plan: { snapshotId: 'sha256:planned', title: 'Bound scene', actorCount: 2, resourceCount: 1, behaviorBindingCount: 2, behaviorSourceCount: 1 }, events: [] } });
async function harness(state = initial(), dictionary = {}) {
  let payload = state;
  const calls = [], opened = [], languages = [], context = { editable: true, dirty: false, busy: false, creating: false, path: 'documents/scenes/demo.json' };
  const h = await dialogHarness('app-project-build', { PROJECT_BUILD_API_PATH: '/api/project-build',
    t: (key, ...values) => (dictionary[key] || key).replace(/\{(\d+)\}/g, (_, index) => values[index] ?? ''),
    onLanguageChange: callback => languages.push(callback),
    fetchJsonApiRequest: async (url, request) => { calls.push({ url, body: request.body ? JSON.parse(request.body) : null }); return { payload }; },
  });
  const controller = h.runtime.setupProjectBuild({ getContext: () => context, openSource: (...args) => { opened.push(args); return true; } });
  controller.setAvailable(true); h.element('projectBuildBtn').click(); await flushDialogs();
  return { ...h, context, calls, opened, controller, languages,
    async refresh(value) { payload = value; h.element('projectBuildRefresh').click(); await flushDialogs(); } };
}

test('behavior plan counts appear only with valid explicit counts and retain legacy actor/resource summaries', async () => {
  const h = await harness();
  assert.equal(h.element('projectBuildBehaviorCounts').hidden, false);
  assert.equal(h.element('projectBuildBehaviorCounts').textContent, '2 个行为绑定 · 1 份行为源码');
  assert.equal(h.element('projectBuildPlanCounts').textContent, 'Bound scene · 2 个角色 · 1 个资源');
  for (const fields of [{}, { behaviorBindingCount: 2 }, { behaviorBindingCount: -1, behaviorSourceCount: 1 },
    { behaviorBindingCount: '2', behaviorSourceCount: 1 }, { behaviorBindingCount: 1.5, behaviorSourceCount: 1 }]) {
    const state = initial(); delete state.job.plan.behaviorBindingCount; delete state.job.plan.behaviorSourceCount; Object.assign(state.job.plan, fields);
    await h.refresh(state);
    assert.equal(h.element('projectBuildBehaviorCounts').hidden, true); assert.equal(h.element('projectBuildBehaviorCounts').textContent, '');
    assert.equal(h.element('projectBuildPlanCounts').textContent, 'Bound scene · 2 个角色 · 1 个资源');
  }
});

test('shared behavior script instances keep their own event identities and scalar arguments in all three languages', async () => {
  for (const dictionary of [{}, en, ja]) {
    const state = initial(); state.job = { ...state.job, kind: 'run', events: [{ event: 'ready' }, behavior(0, ['east', 40]), behavior(1, ['west', 20]), { event: 'finished' }] };
    const h = await harness(state, dictionary), list = h.element('projectBuildBehaviorEventList');
    assert.equal(h.element('projectBuildBehaviorEvents').hidden, false); assert.equal(list.children.length, 2);
    for (const index of [0, 1]) {
      const text = list.children[index].textContent;
      assert.ok(text.includes(instanceIds[index])); assert.ok(!text.includes(instanceIds[1 - index]));
      assert.ok(text.includes(bindingIds[index])); assert.ok(text.includes(JSON.stringify(index ? ['west', 20] : ['east', 40])));
      assert.ok(text.includes(dictionary === en ? 'Arguments' : dictionary === ja ? '引数' : '参数'));
    }
    assert.ok(h.element('projectBuildLogs').textContent.includes(JSON.stringify(state.job.events[1])));
    assert.ok(h.element('projectBuildEvents').textContent.includes('4'));
    await h.refresh({ ...state, job: { ...state.job, events: [{ event: 'ready' }] } });
    assert.equal(h.element('projectBuildBehaviorEvents').hidden, true); assert.equal(list.children.length, 0);
  }
});

test('behavior event text never interprets markup and structured/non-scalar payloads remain raw diagnostics only', async () => {
  const text = '<img src=x onerror=globalThis.behaviorInjected=true>', state = initial();
  state.job.events = [behavior(0, [text, false, null, 12.5]), behavior(1, [{ code: 'danger()' }]), { ...behavior(1, []), bindingId: undefined },
    { event: 'ready', arguments: ['not a behavior'] }];
  const h = await harness(state), list = h.element('projectBuildBehaviorEventList');
  assert.equal(list.children.length, 1); assert.ok(list.textContent.includes(text));
  assert.equal(list.querySelector('img'), null); assert.equal(list.querySelector('script'), null);
  assert.equal(list.children[0].children.length, 0);
  assert.equal(h.runtime.behaviorInjected, undefined);
  assert.ok(h.element('projectBuildLogs').textContent.includes('danger()'));
});

test('behavior diagnostics use localized guidance and preserve exact manifest or script source locations', async () => {
  for (const dictionary of [{}, en, ja]) for (const diagnostic of [
    { code: 'runtime_behavior_parameter_type', objectId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', sourcePath: 'documents/behaviors/demo.json',
      propertyPath: '/bindings/0/parameters/amount', sourceRevision: 'sha256:source', bindingId: bindingIds[0],
      sourceRange: { start: 11, end: 15, encoding: 'utf-16', exact: true }, message: 'Expected float' },
    { code: 'build_behavior_source_invalid', objectId: 'ffffffff-ffff-4fff-8fff-ffffffffffff', sourcePath: 'documents/scripts/checkpoint.txt',
      propertyPath: '', line: 8, message: 'Parser error <script>bad()</script>' },
  ]) {
    const state = initial(); state.job = { ...state.job, status: 'failed', diagnostics: [diagnostic] };
    const h = await harness(state, dictionary), message = '行为绑定或脚本有误，请检查标出的位置和原始日志。';
    assert.ok(h.element('projectBuildDiagnostics').textContent.includes(dictionary[message] || message));
    h.element('projectBuildDiagnostics').querySelector('button').click(); await flushDialogs();
    assert.deepEqual(h.opened[0], [diagnostic.sourcePath, diagnostic]);
    assert.equal(h.element('projectBuildDialog').open, false);
    assert.equal(h.element('projectBuildLogs').querySelector('script'), null);
  }
});

test('dirty script or manifest drafts prevent all execution at click time and stay untouched when returning', async () => {
  for (const document of ['documents/scripts/checkpoint.txt', 'documents/behaviors/demo.json']) {
    const h = await harness(), before = h.calls.length;
    h.context.path = document; h.context.dirty = true;
    h.element('docSourceEditor').value = 'unsaved behavior source';
    h.element('docSourceEditor').selectionStart = 8;
    for (const name of ['projectBuildPlan', 'projectBuildGenerate', 'projectBuildHeadless', 'projectBuildWindow']) h.element(name).dispatch('click');
    await flushDialogs(); assert.equal(h.calls.length, before);
    assert.equal(h.element('projectBuildDraft').hidden, false);
    h.element('projectBuildClose').click(); await flushDialogs();
    assert.equal(h.context.dirty, true); assert.equal(h.element('docSourceEditor').value, 'unsaved behavior source');
    assert.equal(h.element('docSourceEditor').selectionStart, 8);
  }
});

test('behavior-specific UI messages have English and Japanese entries', () => {
  for (const key of ['{0} 个行为绑定 · {1} 份行为源码', '行为事件', '实例 {0} · 行为 {1} · 事件 {2} · 参数 {3}', '行为绑定或脚本有误，请检查标出的位置和原始日志。']) {
    assert.ok(en[key] && ja[key], key); assert.notEqual(en[key], key); assert.notEqual(ja[key], key);
  }
});
