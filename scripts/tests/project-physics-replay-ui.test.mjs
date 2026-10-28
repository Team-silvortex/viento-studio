import test from 'node:test';
import assert from 'node:assert/strict';
import { dialogHarness, flushDialogs } from './dialog-harness.mjs';
import { validateProjectPhysics2DInputReplay } from '../../engine/project-physics2d-input-replay.mjs';
import en from '../../web/i18n/en.js';
import ja from '../../web/i18n/ja.js';

const assemblyId = '11111111-1111-4111-8111-111111111111';
const backendId = 'org.viento.godot4', snapshotId = `sha256:${'b'.repeat(64)}`;
function initial() {
  return { supported: true, available: true, platform: 'linux', backend: {
    format: 'viento-execution-backend', schemaVersion: 1, id: backendId, version: '0.37.0', label: 'Godot', platforms: ['linux'],
    plans: [{ kind: 'project', schemaVersion: 1, runtimeProtocolVersion: 11 }], capabilities: ['scene2d', 'physics.observe2d'],
    execution: { build: true, headlessLogic: true, windowPreview: true, windowCapture: false, offscreenRender: false, embeddedViewport: false, gpuCompute: false }, extensions: [],
  }, scenes: [{ id: assemblyId, kind: 'project', title: 'Project', sourcePath: 'documents/project.json' }],
  latestBuild: { id: 'build-one', backendId, sceneId: assemblyId, targetId: assemblyId, targetKind: 'project', sceneCount: 1, physicsReplayAvailable: true, snapshotId }, job: null };
}
async function harness(state = initial()) {
  let payload = state, dictionary = {}; const calls = [], languages = [];
  const context = { editable: true, dirty: false, busy: false, creating: false, path: 'documents/project.json' };
  const translated = (key, ...values) => (dictionary[key] || key).replace(/\{(\d+)\}/g, (_, index) => values[index] ?? '');
  const h = await dialogHarness('app-project-build', {
    PROJECT_BUILD_API_PATH: '/api/project-build',
    validateProjectPhysics2DInputReplay: value => validateProjectPhysics2DInputReplay(JSON.parse(JSON.stringify(value))),
    t: translated, onLanguageChange: callback => languages.push(callback),
    translatePage: root => { for (const item of root.querySelectorAll('[data-i18n]')) item.textContent = translated(item.dataset.i18n); },
    fetchJsonApiRequest: async (url, request) => { calls.push({ url, body: request.body ? JSON.parse(request.body) : null }); return { payload }; },
  });
  const controller = h.runtime.setupProjectBuild({ getContext: () => context });
  controller.setAvailable(true); h.element('projectBuildBtn').click(); await flushDialogs();
  return { ...h, controller, context, calls,
    async refresh(value = payload) { payload = value; h.element('projectBuildRefresh').click(); await flushDialogs(); },
    language(value) { dictionary = value; languages.forEach(callback => callback()); },
    input(value) { const input = h.element('projectBuildPhysicsReplayProgram'); input.value = value; input.dispatch('input'); return input; },
  };
}

test('physics replay submits the owned frozen project, 30 input steps and nothing to ordinary headless runs', async () => {
  const h = await harness();
  assert.equal(h.element('projectBuildPhysicsReplay').hidden, false);
  assert.equal(h.element('projectBuildPhysicsReplay').disabled, false);
  const value = JSON.parse(h.element('projectBuildPhysicsReplayProgram').value);
  assert.equal(value.steps.length, 30); assert.equal(value.fixedDelta, 1 / 60);
  assert.deepEqual(value.steps.at(-1), { left: false, right: false, up: false, down: false, jump: false });
  h.element('projectBuildPhysicsReplay').click(); await flushDialogs();
  assert.deepEqual(h.calls.at(-1).body, { action: 'run', buildId: 'build-one', mode: 'headless', physicsControlProgram: value });
  h.element('projectBuildHeadless').click(); await flushDialogs();
  assert.deepEqual(h.calls.at(-1).body, { action: 'run', buildId: 'build-one', mode: 'headless' });
  assert.equal(h.context.dirty, false);
});

test('invalid JSON, shape and missing final release are rejected locally, preserving input', async () => {
  const h = await harness(), before = h.calls.length;
  const original = JSON.parse(h.element('projectBuildPhysicsReplayProgram').value);
  for (const value of ['{', JSON.stringify({ ...original, steps: original.steps.slice(0, 29) }), JSON.stringify({ ...original, steps: [...original.steps.slice(0, 29), { ...original.steps[29], jump: true }] })]) {
    const input = h.input(value); input.focus(); input.selectionStart = input.selectionEnd = 1;
    h.element('projectBuildPhysicsReplay').click(); await flushDialogs();
    assert.equal(h.calls.length, before); assert.equal(input.value, value); assert.equal(input.selectionStart, 1);
    assert.equal(h.document.activeElement, input); assert.equal(h.element('projectBuildPhysicsReplayEditor').open, true);
    assert.equal(h.element('projectBuildPhysicsReplayError').hidden, false);
  }
  h.input(JSON.stringify(original)); assert.equal(h.element('projectBuildPhysicsReplayError').hidden, true);
});

test('capability, project ownership, scene count and draft guards prevent dispatch', async () => {
  for (const mutate of [s => s.backend.id = 'org.viento.bevy', s => s.backend.capabilities = ['scene2d'], s => s.backend.execution.headlessLogic = false,
    s => { s.scenes[0].kind = 'scene'; s.latestBuild.targetKind = 'scene'; }, s => s.latestBuild.targetKind = 'scene', s => s.latestBuild.sceneCount = 2,
    s => delete s.latestBuild.physicsReplayAvailable, s => s.latestBuild.physicsReplayAvailable = false,
    s => s.latestBuild.sceneId = '22222222-2222-4222-8222-222222222222']) {
    const state = initial(); mutate(state); const h = await harness(state), before = h.calls.length;
    assert.ok(h.element('projectBuildPhysicsReplay').hidden || h.element('projectBuildPhysicsReplay').disabled);
    h.element('projectBuildPhysicsReplay').dispatch('click'); await flushDialogs(); assert.equal(h.calls.length, before);
  }
  const h = await harness();
  for (const flag of ['dirty', 'creating', 'busy']) {
    h.context[flag] = true; h.controller.setAvailable(true); const before = h.calls.length;
    h.element('projectBuildPhysicsReplay').dispatch('click'); await flushDialogs(); assert.equal(h.calls.length, before, flag);
    h.context[flag] = false; h.controller.setAvailable(true);
  }
});

test('polling, reopening and language changes preserve local text; example is explicit', async () => {
  const h = await harness(); const input = h.input('{unfinished local input'); input.focus(); input.selectionStart = 2; input.selectionEnd = 7;
  await h.refresh(); h.language(en); h.language(ja); h.language({});
  assert.equal(input.value, '{unfinished local input'); assert.equal(input.selectionStart, 2); assert.equal(input.selectionEnd, 7);
  h.element('projectBuildClose').click(); await flushDialogs(); h.element('projectBuildBtn').click(); await flushDialogs();
  assert.equal(input.value, '{unfinished local input');
  h.element('projectBuildPhysicsReplayExample').click(); assert.equal(JSON.parse(input.value).steps.length, 30);
});

test('replay labels and limits are translated in English and Japanese', async () => {
  const h = await harness();
  for (const dictionary of [en, ja]) {
    h.language(dictionary);
    assert.equal(h.element('projectBuildPhysicsReplay').textContent, dictionary['物理输入回放']);
    assert.ok(dictionary['只支持单场景、含二维物理且无行为、声音和动画的 Godot 项目。输入作用于全部方向键角色；controls 为 none 的角色不消费内建动作。固定 30 步、每步 1/60 秒；最后一步须全部释放。运行不写入作品；可显式保存回放文档。完成只表示输入流程与采样结束，不表示玩法验收通过。']);
    assert.ok(dictionary['物理输入回放仅支持单场景、含二维物理且无行为、声音和动画的 Godot 项目。']);
  }
});

test('switching to another frozen project preserves local input but always uses the new owned build', async () => {
  const h = await harness();
  const input = h.element('projectBuildPhysicsReplayProgram');
  const value = JSON.parse(input.value); value.steps[0].left = true; value.steps[0].right = false;
  const raw = JSON.stringify(value); h.input(raw);
  const next = initial(); const other = '22222222-2222-4222-8222-222222222222';
  next.scenes = [{ id: other, kind: 'project', title: 'Other', sourcePath: 'documents/other.json' }];
  next.latestBuild = { ...next.latestBuild, id: 'build-two', sceneId: other, targetId: other };
  await h.refresh(next); assert.equal(input.value, raw);
  h.element('projectBuildPhysicsReplay').click(); await flushDialogs();
  assert.deepEqual(h.calls.at(-1).body, { action: 'run', buildId: 'build-two', mode: 'headless', physicsControlProgram: value });
  assert.equal(h.context.dirty, false);
});

test('replay status shows only owned, valid job evidence and never mistakes it for gameplay acceptance', async () => {
  const h = await harness(), program = JSON.parse(h.element('projectBuildPhysicsReplayProgram').value);
  const makeJob = () => ({ id: 'replay-one', kind: 'run', status: 'succeeded', phase: 'completed', backendId,
    sceneId: assemblyId, targetId: assemblyId, targetKind: 'project', buildId: 'build-one', snapshotId,
    diagnostics: [], events: [], logs: '', physicsControl: { program, sha256: `sha256:${'a'.repeat(64)}`, complete: true } });
  const state = initial(); state.job = makeJob(); await h.refresh(state);
  const status = h.element('projectBuildPhysicsReplayStatus');
  assert.equal(status.hidden, false); assert.match(status.textContent, /已完成.*30 步.*sha256:a{64}.*不表示玩法验收通过/);
  for (const [result, complete, text] of [['running', false, /进行中/], ['failed', true, /未完成/], ['cancelled', true, /未完成/], ['succeeded', false, /未完成/]]) {
    const next = initial(); next.job = makeJob(); next.job.status = result; next.job.physicsControl.complete = complete;
    await h.refresh(next); assert.equal(status.hidden, false); assert.match(status.textContent, text);
  }
  for (const mutate of [j => j.id = '', j => j.kind = 'build', j => j.sceneId = 'elsewhere', j => j.targetId = 'elsewhere',
    j => j.targetKind = 'scene', j => j.buildId = 'old-build', j => j.backendId = 'org.viento.bevy',
    j => j.snapshotId = `sha256:${'c'.repeat(64)}`, j => j.status = 'passed', j => j.physicsControl.sha256 = 'sha256:bad',
    j => j.physicsControl.complete = 'true', j => j.physicsControl.program.steps.pop(), j => j.physicsControl.extra = 'ignored',
    j => delete j.physicsControl]) {
    const next = initial(); next.job = structuredClone(makeJob()); mutate(next.job);
    await h.refresh(next); assert.equal(status.hidden, true);
  }
});

test('timeline edits local JSON by step, preserves focus, and reserves the final release', async () => {
  const h = await harness(), raw = h.element('projectBuildPhysicsReplayProgram');
  // The fixture's basic selector supports one data attribute at a time.
  const get = (action, step) => h.element('projectBuildPhysicsTimeline').querySelectorAll('[data-action]')
    .find(item => item.dataset.action === action && item.dataset.step === String(step));
  const left = get('left', 0), final = get('jump', 29), before = h.calls.length;
  assert.equal(left.getAttribute('aria-pressed'), 'false');
  left.focus(); left.dispatch('focus'); left.click();
  assert.equal(JSON.parse(raw.value).steps[0].left, true);
  assert.equal(left.getAttribute('aria-pressed'), 'true');
  assert.equal(h.document.activeElement, left); assert.equal(h.context.dirty, false);
  assert.equal(final.getAttribute('aria-disabled'), 'true'); final.click();
  assert.equal(JSON.parse(raw.value).steps[29].jump, false);
  left.dispatch('keydown', { key: 'ArrowRight' }); assert.equal(h.document.activeElement, get('left', 1));
  assert.equal(h.calls.length, before);
});

test('timeline refuses invalid raw drafts and supports reversible range edits with final release', async () => {
  const h = await harness(), raw = h.element('projectBuildPhysicsReplayProgram'), before = h.calls.length;
  const get = (action, step) => h.element('projectBuildPhysicsTimeline').querySelectorAll('[data-action]')
    .find(item => item.dataset.action === action && item.dataset.step === String(step));
  const valid = raw.value, invalid = '{ "work in progress": '; h.input(invalid);
  assert.equal(get('right', 0).disabled, true);
  assert.equal(h.element('projectBuildPhysicsRangePress').disabled, true);
  get('right', 0).dispatch('click'); h.element('projectBuildPhysicsRangePress').dispatch('click');
  assert.equal(raw.value, invalid); assert.equal(h.element('projectBuildPhysicsTimelineInvalid').hidden, false);
  const compact = JSON.stringify(JSON.parse(valid)); h.input(compact);
  h.element('projectBuildPhysicsRangeAction').value = 'left';
  h.element('projectBuildPhysicsRangeStart').value = '1'; h.element('projectBuildPhysicsRangeEnd').value = '1';
  h.element('projectBuildPhysicsRangeRelease').click(); assert.equal(raw.value, compact);
  h.element('projectBuildPhysicsRangeStart').value = '2'; h.element('projectBuildPhysicsRangeEnd').value = '4';
  h.element('projectBuildPhysicsRangePress').click();
  let program = JSON.parse(raw.value);
  assert.deepEqual(program.steps.slice(1, 4).map(step => step.left), [true, true, true]);
  assert.equal(program.steps[0].left, false); assert.equal(program.steps[4].left, false);
  h.element('projectBuildPhysicsRangeEnd').value = '30'; const pressed = raw.value;
  h.element('projectBuildPhysicsRangePress').click(); assert.equal(raw.value, pressed);
  assert.equal(h.element('projectBuildPhysicsRangeError').hidden, false);
  h.element('projectBuildPhysicsRangeRelease').click(); program = JSON.parse(raw.value);
  assert.ok(program.steps.every(step => !step.left)); assert.equal(h.element('projectBuildPhysicsRangeError').hidden, true);
  assert.equal(h.calls.length, before); assert.equal(h.context.dirty, false);
});

test('timeline labels translate in place and polling retains raw caret and focused controls', async () => {
  const h = await harness(), raw = h.element('projectBuildPhysicsReplayProgram');
  const right = h.element('projectBuildPhysicsTimeline').querySelectorAll('[data-action]')
    .find(item => item.dataset.action === 'right' && item.dataset.step === '0');
  right.focus(); right.dispatch('focus'); h.language(en);
  assert.match(right.getAttribute('aria-label'), /Step 1: Right, Pressed/);
  assert.equal(h.document.activeElement, right);
  h.language(ja); assert.match(right.getAttribute('aria-label'), /ステップ 1/);
  assert.equal(h.document.activeElement, right);
  const value = '{unfinished'; h.input(value); raw.focus(); raw.selectionStart = 2; raw.selectionEnd = 5;
  await h.refresh(); h.language(en);
  assert.equal(raw.value, value); assert.equal(raw.selectionStart, 2); assert.equal(raw.selectionEnd, 5);
  assert.equal(h.document.activeElement, raw);
});
