import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { dialogHarness, flushDialogs } from './dialog-harness.mjs';
import { deferred, editorHarness } from './editor-harness.mjs';
import { PROJECT_BUILD_API_PATH } from '../../engine/build-plan.mjs';
import en from '../../web/i18n/en.js';
import ja from '../../web/i18n/ja.js';

const scenes = [{ id: 'scene-one', title: 'First scene', sourcePath: 'documents/scenes/first.json' },
  { id: 'scene-two', title: 'Second scene', sourcePath: 'documents/scenes/second.json' }];
const initial = () => ({ supported: true, available: true, reason: null, backend: { id: 'godot4', version: '1', label: 'Godot 4' }, scenes, job: null, latestBuild: null });
const plan = { snapshotId: 'sha256:frozen', title: 'First scene', actorCount: 1, resourceCount: 1 };
const job = (kind, status = 'running', extra = {}) => ({ id: `job-${kind}`, kind, status, sceneId: 'scene-one', phase: 'snapshot', diagnostics: [], events: [], logs: '', ...extra });
async function harness(options = {}) {
  const current = { editable: true, dirty: false, creating: false, busy: false, path: scenes[0].sourcePath };
  const calls = [], opened = [];
  let state = options.state || initial();
  const h = await dialogHarness('app-project-build', {
    PROJECT_BUILD_API_PATH,
    fetchJsonApiRequest: async (url, request) => {
      const waiting = deferred(); calls.push({ url, request, body: request.body ? JSON.parse(request.body) : null, ...waiting });
      if (!request.method) waiting.resolve({ payload: state });
      return waiting.promise;
    }, ...options.overrides,
  });
  const controller = h.runtime.setupProjectBuild({ getContext: () => current,
    openSource: (...args) => { opened.push(args); return options.openSource ? options.openSource(...args) : true; } });
  controller.setAvailable(true); h.element('projectBuildBtn').click(); await flushDialogs();
  const setState = value => { state = value; };
  const refresh = async () => { h.element('projectBuildRefresh').click(); await flushDialogs(); };
  const tick = async () => { const [id, callback] = [...h.timers][0] || []; assert.ok(callback, 'a status poll is scheduled'); h.timers.delete(id); callback(); await flushDialogs(); };
  const resolve = async payload => { state = payload; calls.at(-1).resolve({ payload }); await flushDialogs(); };
  const finishPlan = async () => { h.element('projectBuildPlan').click(); await resolve({ ...state, job: job('plan', 'succeeded', { plan }) }); };
  return { ...h, current, calls, opened, controller, setState, refresh, tick, resolve, finishPlan };
}

test('build UI checks a frozen plan, submits that snapshot, and waits for an explicit run', async () => {
  const h = await harness();
  assert.equal(h.element('projectBuildGenerate').disabled, true);
  h.element('projectBuildPlan').click();
  assert.deepEqual(h.calls.at(-1).body, { action: 'plan', sceneId: 'scene-one' });
  await h.resolve({ ...initial(), job: job('plan') });
  assert.equal(h.element('projectBuildGenerate').disabled, true);
  h.setState({ ...initial(), job: job('plan', 'succeeded', { plan }) }); await h.tick();
  assert.equal(h.element('projectBuildGenerate').disabled, false);
  assert.match(h.element('projectBuildPlanCounts').textContent, /First scene.*1.*1/);
  h.element('projectBuildGenerate').click();
  assert.deepEqual(h.calls.at(-1).body, { action: 'build', sceneId: 'scene-one', expectedSnapshotId: 'sha256:frozen' });
  const built = { ...initial(), job: job('build', 'succeeded'), latestBuild: { id: 'built-one', sceneId: 'scene-one', snapshotId: plan.snapshotId, title: plan.title } };
  await h.resolve(built);
  assert.equal(h.calls.filter(call => call.body?.action === 'run').length, 0);
  assert.equal(h.element('projectBuildHeadless').disabled, false);
  h.element('projectBuildHeadless').click();
  assert.deepEqual(h.calls.at(-1).body, { action: 'run', buildId: 'built-one', mode: 'headless' });
  await h.resolve({ ...built, job: job('run', 'succeeded', { events: [{ event: 'ready' }, { event: 'finished' }] }) });
  assert.match(h.element('projectBuildEvents').textContent, /2/);
  h.element('projectBuildWindow').click();
  assert.deepEqual(h.calls.at(-1).body, { action: 'run', buildId: 'built-one', mode: 'window' });
});

test('scene switching cannot reuse another scene plan or artifact', async () => {
  const h = await harness(); await h.finishPlan();
  h.setState({ ...initial(), job: job('plan', 'succeeded', { plan }), latestBuild: { id: 'built-one', sceneId: 'scene-one' } }); await h.refresh();
  h.element('projectBuildScene').value = 'scene-two'; h.element('projectBuildScene').dispatch('change');
  assert.equal(h.element('projectBuildGenerate').disabled, true);
  assert.equal(h.element('projectBuildHeadless').disabled, true);
  await h.refresh();
  assert.equal(h.element('projectBuildScene').value, 'scene-two');
  assert.equal(h.element('projectBuildGenerate').disabled, true);
  h.element('projectBuildPlan').click();
  assert.deepEqual(h.calls.at(-1).body, { action: 'plan', sceneId: 'scene-two' });
});

test('draft, creation, busy and browse guards prevent task submission even when context changed after rendering', async () => {
  const h = await harness(); await h.finishPlan(); const count = h.calls.length;
  for (const key of ['dirty', 'creating', 'busy']) {
    h.current[key] = true; h.element('projectBuildGenerate').click();
    assert.equal(h.calls.length, count, key);
    h.current[key] = false;
    h.controller.setAvailable(true);
  }
  h.current.editable = false; h.element('projectBuildGenerate').click(); assert.equal(h.calls.length, count);
  assert.equal(h.current.dirty, false);
});

test('closing a running task preserves it and polling, while dirty drafts still allow cancellation', async () => {
  const h = await harness({ state: { ...initial(), job: job('run', 'running', { phase: 'running' }) } });
  h.current.dirty = true; h.element('projectBuildClose').click(); await flushDialogs();
  assert.equal(h.element('projectBuildDialog').open, false);
  assert.equal(h.current.dirty, true);
  assert.match(h.element('projectBuildBtn').textContent, /进行中/);
  await h.tick(); assert.equal(h.element('projectBuildDialog').open, false);
  h.element('projectBuildBtn').click(); await flushDialogs();
  assert.equal(h.element('projectBuildCancel').disabled, false);
  h.element('projectBuildCancel').click();
  assert.deepEqual(h.calls.at(-1).body, { action: 'cancel', jobId: 'job-run' });
  await h.resolve({ ...initial(), job: job('run', 'cancelled') });
  assert.equal(h.element('projectBuildCancel').hidden, true);
  assert.equal(h.current.dirty, true);
  assert.equal(h.timers.size, 0);
  const key = h.element('projectBuildDialog').dispatch('keydown', { key: 's', ctrlKey: true });
  assert.equal(key.defaultPrevented, true); assert.equal(key.stopped, true);
  h.element('projectBuildDialog').dispatch('cancel'); assert.equal(h.element('projectBuildDialog').open, false);
});

test('a lost submission response is reconciled with GET without resubmitting the task', async () => {
  const h = await harness(); h.element('projectBuildPlan').click();
  h.calls.at(-1).reject(new Error('network lost')); await flushDialogs();
  assert.match(h.element('projectBuildError').textContent, /刷新状态/);
  h.setState({ ...initial(), job: job('plan', 'succeeded', { plan }) }); await h.tick();
  assert.equal(h.calls.filter(call => call.body).length, 1);
  assert.equal(h.element('projectBuildGenerate').disabled, false);
  assert.equal(h.element('projectBuildError').hidden, true);
});

test('diagnostics retain exact source coordinates, protect declined navigation, and render details as text', async () => {
  let allow = false;
  const diagnostic = { code: 'build_actor_value', sourcePath: scenes[0].sourcePath, propertyPath: '/actors/0/speed', objectId: 'actor-one', message: '<script>bad()</script>' };
  const h = await harness({ state: { ...initial(), job: job('plan', 'failed', { diagnostics: [diagnostic], logs: '<img src=x onerror=bad()>' }) }, openSource: () => allow });
  const link = h.element('projectBuildDiagnostics').querySelector('button');
  assert.match(link.textContent, /\/actors\/0\/speed/);
  link.click(); await flushDialogs();
  assert.equal(h.element('projectBuildDialog').open, true);
  assert.equal(h.opened[0][0], scenes[0].sourcePath);
  assert.equal(h.opened[0][1].propertyPath, diagnostic.propertyPath);
  assert.equal(h.element('projectBuildLogs').children.length, 0);
  assert.match(h.element('projectBuildLogs').textContent, /<script>/);
  allow = true; link.click(); await flushDialogs();
  assert.equal(h.element('projectBuildDialog').open, false);
});

test('snapshot conflicts invalidate the approved plan and preserve original error details', async () => {
  const h = await harness(); await h.finishPlan(); h.element('projectBuildGenerate').click();
  h.calls.at(-1).reject(Object.assign(new Error('snapshot differs'), { payload: { errorCode: 'build_snapshot_conflict' } })); await flushDialogs();
  assert.equal(h.element('projectBuildGenerate').disabled, true);
  assert.match(h.element('projectBuildError').textContent, /工程内容已变化/);
  assert.match(h.element('projectBuildLogs').textContent, /snapshot differs/);
});

test('an unconfigured tool permits planning and blocks build/run; unsupported hosts hide the entry', async () => {
  const h = await harness({ state: { ...initial(), available: false, reason: 'tool_missing' } });
  assert.equal(h.element('projectBuildPlan').disabled, false);
  assert.match(h.element('projectBuildAvailability').textContent, /Godot 4/);
  await h.finishPlan(); assert.equal(h.element('projectBuildGenerate').disabled, true);
  h.controller.setAvailable(false);
  assert.equal(h.element('projectBuildBtn').hidden, true);
  assert.equal(h.element('projectBuildDialog').open, false);
});

test('all build dialog user messages have English and Japanese translations', async () => {
  const source = await fs.readFile(new URL('../../web/modules/app-project-build.js', import.meta.url), 'utf8');
  const keys = [...source.matchAll(/(?:'([^'\n]*[\u3400-\u9fff][^'\n]*)'|data-i18n="([^"]+)")/g)].map(match => match[1] || match[2]);
  for (const key of keys) { assert.ok(en[key], `English: ${key}`); assert.ok(ja[key], `Japanese: ${key}`); }
});


test('asynchronous snapshot conflicts invalidate the plan after the job completes', async () => {
  const h = await harness(); await h.finishPlan(); h.element('projectBuildGenerate').click();
  await h.resolve({ ...initial(), job: job('build') });
  h.setState({ ...initial(), job: job('build', 'failed', { diagnostics: [{ code: 'build_snapshot_changed', message: 'snapshot differs', sourcePath: scenes[0].sourcePath }] }) });
  await h.tick();
  assert.equal(h.element('projectBuildGenerate').disabled, true);
  assert.equal(h.element('projectBuildPlan').disabled, false);
  assert.equal(h.element('projectBuildPlanSummary').hidden, true);
  assert.match(h.element('projectBuildDiagnostics').textContent, /工程内容已变化/);
});


test('editor build context resolves generated source paths without changing the active draft', async () => {
  let buildContext;
  const stopAfterBuildSetup = new Error('Stop before unrelated editor setup');
  const h = await editorHarness({
    setupSettings: async () => {},
    setupProjectBuild: options => { buildContext = options.getContext; return { setAvailable() {} }; },
    setupWorldBrowser: () => { throw stopAfterBuildSetup; },
  });
  h.doc.sourcePath = 'docs-standard/documents/scenes/second.json';
  h.begin('未保存的场景草稿');
  h.state.editHasUnsavedChanges = true;
  await assert.rejects(h.runtime.initApp(), error => error === stopAfterBuildSetup);
  assert.equal(buildContext().path, 'documents/scenes/second.json');
  assert.equal(buildContext().dirty, true);
  assert.equal(h.source.value, '未保存的场景草稿');
  assert.equal(h.doc.sourcePath, 'docs-standard/documents/scenes/second.json');
});
