import test from 'node:test';
import assert from 'node:assert/strict';
import { dialogHarness, flushDialogs } from './dialog-harness.mjs';
import en from '../../web/i18n/en.js';
import ja from '../../web/i18n/ja.js';

const id = 'org.viento.fixture', sceneId = 'scene-one';
const backend = (execution = {}) => ({ format: 'viento-execution-backend', schemaVersion: 1, id, label: 'Fixture engine', version: '1.0.0',
  platforms: ['linux'], plans: [{ kind: 'scene2d', schemaVersion: 1, runtimeProtocolVersion: 1 }],
  capabilities: ['scene2d', 'image'], execution: { build: true, headlessLogic: true, windowPreview: true, windowCapture: false,
    offscreenRender: false, embeddedViewport: false, gpuCompute: false, ...execution }, extensions: [] });
const state = (descriptor = backend()) => ({ supported: true, available: true, platform: 'linux', backend: descriptor,
  scenes: [{ id: sceneId, title: 'Test scene', sourcePath: 'documents/scene.json' }],
  job: { id: 'plan-before', kind: 'plan', status: 'succeeded', backendId: id, sceneId,
    plan: { snapshotId: 'sha256:before', title: 'Test scene', actorCount: 1, resourceCount: 0 } },
  latestBuild: { id: 'build-before', backendId: id, sceneId, snapshotId: 'sha256:before' } });
async function harness(initial = state(), dictionary = {}) {
  let payload = initial;
  const calls = [], current = { editable: true, dirty: false, creating: false, busy: false };
  const h = await dialogHarness('app-project-build', { PROJECT_BUILD_API_PATH: '/api/project-build',
    t: (key, ...values) => (dictionary[key] || key).replace(/\{(\d+)\}/g, (_, index) => values[index] ?? ''),
    fetchJsonApiRequest: async (url, request) => {
      calls.push({ url, body: request.body ? JSON.parse(request.body) : null }); return { payload };
    },
  });
  const controller = h.runtime.setupProjectBuild({ getContext: () => current });
  controller.setAvailable(true); h.element('projectBuildBtn').click(); await flushDialogs();
  return { ...h, calls, current, controller,
    setState: value => { payload = value; },
    async refresh(value = payload) { payload = value; h.element('projectBuildRefresh').click(); await flushDialogs(); },
    async click(name) { h.element(name).dispatch('click'); await flushDialogs(); },
    writes: () => calls.filter(item => item.body),
  };
}
function buttons(h) {
  return ['projectBuildGenerate', 'projectBuildHeadless', 'projectBuildWindow'].map(name => !h.element(name).disabled);
}

test('build, headless logic and separate-window capabilities admit their own buttons independently', async () => {
  for (const [execution, expected] of [
    [{ build: true, headlessLogic: false, windowPreview: false }, [true, false, false]],
    [{ build: false, headlessLogic: true, windowPreview: false }, [false, true, false]],
    [{ build: false, headlessLogic: false, windowPreview: true }, [false, false, true]],
    [{ build: false, headlessLogic: false, windowPreview: false }, [false, false, false]],
  ]) {
    const h = await harness(state(backend(execution)));
    assert.deepEqual(buttons(h), expected);
    assert.equal(h.element('projectBuildPlan').disabled, false, 'reading a plan remains independent of a configured executable');
    for (const [index, name] of ['projectBuildGenerate', 'projectBuildHeadless', 'projectBuildWindow'].entries()) {
      const count = h.writes().length; await h.click(name);
      assert.equal(h.writes().length, count + Number(expected[index]));
    }
  }
});

test('missing, incomplete, unknown and incompatible backend declarations fail closed for execution', async () => {
  const malformed = [undefined, null, { id: 'godot4', label: 'Godot', version: '1' }];
  for (const change of [value => { delete value.execution; }, value => { delete value.execution.windowPreview; },
    value => { value.execution.build = 'true'; }, value => { value.execution.extra = true; },
    value => { value.capabilities = 'scene2d'; }, value => { value.untrusted = true; }]) {
    const value = backend(); change(value); malformed.push(value);
  }
  for (const descriptor of malformed) {
    const h = await harness(state(descriptor));
    // state() has a default argument; exercise omitted backend explicitly.
    if (descriptor === undefined) { const missing = state(); delete missing.backend; await h.refresh(missing); }
    assert.deepEqual(buttons(h), [false, false, false]);
    for (const name of ['projectBuildGenerate', 'projectBuildHeadless', 'projectBuildWindow']) await h.click(name);
    assert.equal(h.writes().length, 0);
    assert.match(h.element('projectBuildCapabilities').textContent, /尚未声明/);
  }
  const unsupported = state(); unsupported.platform = 'android';
  assert.deepEqual(buttons(await harness(unsupported)), [false, false, false]);
});

test('plan and artifact backend identities are checked separately without a legacy fallback', async () => {
  for (const value of [undefined, 'org.viento.other']) {
    const input = state(); input.job.backendId = value; input.latestBuild.backendId = value;
    const h = await harness(input);
    assert.deepEqual(buttons(h), [false, false, false]);
    await h.click('projectBuildGenerate'); await h.click('projectBuildHeadless'); await h.click('projectBuildWindow');
    assert.equal(h.writes().length, 0);
  }
});

test('late capability or descriptor changes are rechecked at click time even before another render', async () => {
  for (const [operation, button] of [['build', 'projectBuildGenerate'], ['headlessLogic', 'projectBuildHeadless'], ['windowPreview', 'projectBuildWindow']]) {
    const input = state(), h = await harness(input);
    assert.equal(h.element(button).disabled, false);
    input.backend.execution[operation] = false;
    await h.click(button); assert.equal(h.writes().length, 0); assert.equal(h.element(button).disabled, true);
  }
  const input = state(), h = await harness(input);
  input.backend.version = '1.0.1'; await h.click('projectBuildHeadless'); await h.click('projectBuildGenerate');
  assert.equal(h.writes().length, 0, 'a still-capable replacement backend does not inherit an old approval');
});

test('descriptor changes invalidate approvals permanently for the old completed job and build', async () => {
  const changes = [value => { value.version = '1.0.1'; }, value => { value.id = 'org.viento.other'; },
    value => { value.capabilities.push('input.arrows'); }, value => { value.execution.windowCapture = true; },
    value => { value.plans.push({ kind: 'scene2d', schemaVersion: 2, runtimeProtocolVersion: 2 }); },
    value => { value.platforms.push('win32'); }, value => { value.extensions.push({ id: id + '.extension', version: '1.0.0' }); },
    value => { value.label = 'Renamed engine'; }];
  for (const change of changes) {
    const input = state(), h = await harness(input); assert.deepEqual(buttons(h), [true, true, true]);
    const next = structuredClone(input); change(next.backend);
    await h.refresh(next); assert.deepEqual(buttons(h), [false, false, false]);
    assert.equal(h.element('projectBuildPlanSummary').hidden, true);
    await h.refresh(); assert.deepEqual(buttons(h), [false, false, false], 'polling the completed job cannot restore approval');
    await h.refresh(structuredClone(input)); assert.deepEqual(buttons(h), [false, false, false], 'restoring the original descriptor cannot revive invalidated IDs');
    assert.equal(h.writes().length, 0);
  }
});

test('a new explicit plan and new matching build restore execution after a backend update', async () => {
  const input = state(), h = await harness(input), next = structuredClone(input);
  next.backend.version = '1.1.0'; await h.refresh(next);
  next.job = { ...next.job, id: 'plan-after', plan: { ...next.job.plan, snapshotId: 'sha256:after' } };
  h.setState(next); await h.click('projectBuildPlan');
  assert.equal(h.writes().at(-1).body.action, 'plan'); assert.deepEqual(buttons(h), [true, false, false]);
  next.latestBuild = { ...next.latestBuild, id: 'build-after', snapshotId: 'sha256:after' };
  next.job = { ...next.job, id: 'job-build-after', kind: 'build' };
  h.setState(next); await h.click('projectBuildGenerate');
  assert.deepEqual(h.writes().at(-1).body, { action: 'build', sceneId, expectedSnapshotId: 'sha256:after' });
  assert.deepEqual(buttons(h), [true, true, true]);
  await h.click('projectBuildWindow'); assert.deepEqual(h.writes().at(-1).body, { action: 'run', buildId: 'build-after', mode: 'window' });
});

test('canonical descriptor identity tolerates property order while still binding current approvals', async () => {
  const input = state(), h = await harness(input);
  const reorder = value => Array.isArray(value) ? value.map(reorder) : value && typeof value === 'object'
    ? Object.fromEntries(Object.entries(value).reverse().map(([key, nested]) => [key, reorder(nested)])) : value;
  await h.refresh(reorder(input)); assert.deepEqual(buttons(h), [true, true, true]);
});

test('capability summaries and missing-tool guidance are localized and do not advertise unavailable GPU or viewport features', async () => {
  for (const dictionary of [{}, en, ja]) {
    const input = state(backend({ windowCapture: true })); input.available = false; input.reason = 'tool_missing';
    const h = await harness(input, dictionary), text = h.element('projectBuildCapabilities').textContent;
    for (const label of ['构建场景', '无头逻辑测试', '独立窗口预览', '窗口截图']) assert.ok(text.includes(dictionary[label] || label));
    for (const label of ['离屏渲染', '嵌入式视口', 'GPU 计算']) assert.ok(!text.includes(dictionary[label] || label));
    const message = h.element('projectBuildAvailability').textContent;
    assert.equal(message, dictionary['宿主尚未配置构建工具，可先检查计划。'] || '宿主尚未配置构建工具，可先检查计划。');
    assert.ok(!message.includes('Godot')); assert.deepEqual(buttons(h), [false, false, false]);
    assert.equal(h.element('projectBuildPlan').disabled, false);
  }
});

test('composition preview and source editing remain independent of execution backend capabilities', async () => {
  const input = state(backend({ build: false, headlessLogic: false, windowPreview: false }));
  input.previewDocuments = [...input.scenes.map(item => ({ ...item, kind: 'scene' })), { id: 'recipe', title: 'Recipe', sourcePath: 'documents/recipe.json', kind: 'composition' }];
  const h = await harness(input);
  h.controller.setAvailable(true, ['scene.create', 'scene.update'], { scenePreview: true });
  await h.click('projectBuildTabPreview'); h.element('projectBuildScene').value = 'recipe'; h.element('projectBuildScene').dispatch('change');
  assert.equal(h.element('projectBuildPreviewPanel').hidden, false);
  assert.equal(h.element('projectBuildCapabilities').hidden, true);
  assert.equal(h.element('projectBuildScene').value, 'recipe');
  assert.equal(h.element('projectBuildPlan').disabled, true); assert.deepEqual(buttons(h), [false, false, false]);
  assert.equal(h.writes().length, 0);
});
