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
const backendId = 'org.viento.godot4';
const backend = () => ({ format: 'viento-execution-backend', schemaVersion: 1, id: backendId, version: '0.2.0', label: 'Godot 4',
  platforms: ['linux'], plans: [{ kind: 'scene2d', schemaVersion: 1, runtimeProtocolVersion: 1 }, { kind: 'scene2d', schemaVersion: 2, runtimeProtocolVersion: 2 }],
  capabilities: ['scene2d', 'input.arrows', 'state.movement', 'image'],
  execution: { build: true, headlessLogic: true, windowPreview: true, windowCapture: true, offscreenRender: false, embeddedViewport: false, gpuCompute: false }, extensions: [] });
const initial = () => ({ supported: true, available: true, reason: null, platform: 'linux', backend: backend(), scenes, job: null, latestBuild: null });
const plan = { snapshotId: 'sha256:frozen', title: 'First scene', actorCount: 1, resourceCount: 1 };
const job = (kind, status = 'running', extra = {}) => ({ id: `job-${kind}`, backendId, kind, status, sceneId: 'scene-one', phase: 'snapshot', diagnostics: [], events: [], logs: '', ...extra });
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
    getSceneDraft: options.getSceneDraft, applySceneDraft: options.applySceneDraft,
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
  const built = { ...initial(), job: job('build', 'succeeded'), latestBuild: { id: 'built-one', backendId, sceneId: 'scene-one', snapshotId: plan.snapshotId, title: plan.title } };
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
  h.setState({ ...initial(), job: job('plan', 'succeeded', { plan }), latestBuild: { id: 'built-one', backendId, sceneId: 'scene-one' } }); await h.refresh();
  h.element('projectBuildScene').value = 'scene-two'; h.element('projectBuildScene').dispatch('change');
  assert.equal(h.element('projectBuildGenerate').disabled, true);
  assert.equal(h.element('projectBuildHeadless').disabled, true);
  await h.refresh();
  assert.equal(h.element('projectBuildScene').value, 'scene-two');
  assert.equal(h.element('projectBuildGenerate').disabled, true);
  h.element('projectBuildPlan').click();
  assert.deepEqual(h.calls.at(-1).body, { action: 'plan', sceneId: 'scene-two' });
});

test('saving a layout refreshes preview and invalidates the approved build plan without submitting a job', async () => {
  let layout; const refreshed = [];
  const h = await harness({ overrides: {
    setupSceneLayout: options => { layout = options; return { setAvailable() {}, open() {} }; },
    setupScenePreview: () => ({ setAvailable() {}, setScene() {}, setVisible() {}, invalidate: () => refreshed.push(true) }),
  } });
  h.controller.setAvailable(true, ['scene.update'], { scenePreview: true });
  await h.finishPlan();
  assert.equal(h.element('projectBuildGenerate').disabled, false);
  const writes = h.calls.filter(call => call.body).length;
  await layout.applied({ changes: [{ objectId: 'scene-one', sourcePath: scenes[0].sourcePath }] });
  assert.equal(refreshed.length, 1);
  assert.equal(h.element('projectBuildGenerate').disabled, true);
  assert.equal(h.element('projectBuildPlanSummary').hidden, true);
  await h.refresh();
  assert.equal(h.element('projectBuildGenerate').disabled, true, 'polling cannot re-approve the old snapshot');
  assert.equal(h.calls.filter(call => call.body).length, writes, 'save never launches a plan or build');
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

test('preview and diagnostic navigation focus the source editor after the dialog closes, preserving legacy callbacks', async () => {
  for (const entry of ['preview', 'diagnostic']) {
    let preview; const focusStates = [];
    const diagnostic = { code: 'build_actor_value', sourcePath: scenes[0].sourcePath, propertyPath: '/actors/0/speed' };
    const h = await harness({ state: { ...initial(), job: job('plan', 'failed', { diagnostics: [diagnostic] }) },
      overrides: { setupScenePreview: options => { preview = options; return { setAvailable() {}, setScene() {}, setVisible() {}, invalidate() {} }; } },
      openSource: () => ({ focus: () => {
        focusStates.push(h.element('projectBuildDialog').open);
        h.element('docSourceEditor').focus();
      } }),
    });
    if (entry === 'preview') await preview.openSource(diagnostic.sourcePath, diagnostic);
    else { h.element('projectBuildDiagnostics').querySelector('button').click(); await flushDialogs(); }
    await flushDialogs();
    assert.deepEqual(focusStates, [false]);
    assert.equal(h.runtime.document.activeElement, h.element('docSourceEditor'));
    h.element('projectBuildBtn').click(); await flushDialogs();
    h.element('projectBuildClose').click(); await flushDialogs();
    assert.equal(h.runtime.document.activeElement, h.element('projectBuildBtn'));
    assert.equal(focusStates.length, 1);
  }
});

test('late source navigation cannot close a reopened dialog or replace a newer navigation focus', async () => {
  for (const interruption of ['reopen', 'newer']) {
    let preview; const reads = [], focused = [];
    const h = await harness({ overrides: { setupScenePreview: options => {
      preview = options; return { setAvailable() {}, setScene() {}, setVisible() {}, invalidate() {} };
    } }, openSource: () => { const read = deferred(); reads.push(read); return read.promise; } });
    const first = preview.openSource(scenes[0].sourcePath);
    if (interruption === 'reopen') {
      h.element('projectBuildClose').click(); await flushDialogs(); h.element('projectBuildBtn').click(); await flushDialogs();
    } else {
      const second = preview.openSource(scenes[1].sourcePath);
      reads[1].resolve({ focus: () => { focused.push('new'); h.element('docSourceEditor').focus(); } });
      await second; await flushDialogs();
    }
    reads[0].resolve({ focus: () => focused.push('old') });
    assert.equal(await first, false); await flushDialogs();
    assert.deepEqual(focused, interruption === 'reopen' ? [] : ['new']);
    assert.equal(h.element('projectBuildDialog').open, interruption === 'reopen');
    if (interruption === 'newer') assert.equal(h.runtime.document.activeElement, h.element('docSourceEditor'));
  }
});

test('queued dialog-close focus is discarded when the dialog is reopened before the close event', async () => {
  let preview; let focuses = 0;
  const h = await harness({ overrides: { setupScenePreview: options => {
    preview = options; return { setAvailable() {}, setScene() {}, setVisible() {}, invalidate() {} };
  } }, openSource: () => ({ focus: () => { focuses++; } }) });
  await preview.openSource(scenes[0].sourcePath);
  h.element('projectBuildBtn').click();
  h.element('projectBuildScene').focus();
  await flushDialogs();
  assert.equal(focuses, 0); assert.equal(h.element('projectBuildDialog').open, true);
  assert.equal(h.runtime.document.activeElement, h.element('projectBuildScene'));
});

test('multiple queued close events focus the final closed session only once', async () => {
  let preview; const focused = [];
  const h = await harness({ overrides: { setupScenePreview: options => {
    preview = options; return { setAvailable() {}, setScene() {}, setVisible() {}, invalidate() {} };
  } }, openSource: path => ({ focus: () => { focused.push(path); h.element('docSourceEditor').focus(); } }) });
  await preview.openSource(scenes[0].sourcePath);
  h.element('projectBuildBtn').click();
  await preview.openSource(scenes[1].sourcePath);
  await flushDialogs(); await flushDialogs();
  assert.deepEqual(focused, [scenes[1].sourcePath]);
  assert.equal(h.element('projectBuildDialog').open, false);
  assert.equal(h.runtime.document.activeElement, h.element('docSourceEditor'));
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
  assert.match(h.element('projectBuildAvailability').textContent, /构建工具/);
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

test('source layout bridge uses the active draft, refreshes draft preview, and does not require a disk-write command', async () => {
  let preview, layout, sourceEnabled; const opened = [], applied = [], refreshes = [];
  const draft = { sourcePath: scenes[0].sourcePath, baseSourceRevision: 'sha256:' + 'a'.repeat(64), content: 'raw draft' };
  const h = await harness({ getSceneDraft: async path => { assert.equal(path, draft.sourcePath); return draft; },
    applySceneDraft: async proposal => { applied.push(proposal); return { applied: true }; },
    overrides: {
      setupScenePreview: options => { preview = options; return { setAvailable() {}, setScene() {}, setVisible() {}, invalidate() { assert.fail('Draft application cannot switch to saved mode'); }, refreshDraft() { refreshes.push('draft'); } }; },
      setupSceneLayout: options => { layout = options; return { setAvailable() {}, setSourceAvailable(value) { sourceEnabled = value; }, openSource: async input => { assert.equal(input.isCurrent(), true); opened.push(input); return true; } }; },
    } });
  h.controller.setAvailable(true, [], { scenePreview: true });
  Object.assign(h.current, { dirty: true, sceneDraftWritable: true, sceneDraftPath: scenes[0].sourcePath, sceneDraftToken: 'one' });
  assert.equal(sourceEnabled, true); assert.equal(preview.getContext().canEditScene, false);
  assert.equal(preview.getContext().canEditDraftLayout, true);
  assert.equal(await preview.editDraftLayout({ model: { scene: { objectId: scenes[0].id, sourcePath: scenes[0].sourcePath } }, images: new Map(), isCurrent: () => true }), true);
  assert.equal(opened[0].source, draft);
  const proposal = { sceneId: scenes[0].id, sourcePath: scenes[0].sourcePath };
  assert.equal((await layout.applySourceDraft(proposal)).applied, true); assert.equal(applied[0], proposal);
  await layout.sourceApplied(); assert.deepEqual(refreshes, ['draft']);
  assert.equal(h.calls.some(call => call.request.method === 'POST'), false);
  h.current.sceneDraftWritable = false; assert.equal(preview.getContext().canEditDraftLayout, false);
  await assert.rejects(layout.applySourceDraft(proposal), { errorCode: 'scene_source_layout_conflict' });
});

test('source layout bridge discards delayed opens after scene or dialog ownership changes', async () => {
  for (const change of ['scene', 'close', 'preview']) {
    const waiting = deferred(), opened = []; let preview, previewCurrent = true;
    const h = await harness({ getSceneDraft: () => waiting.promise, overrides: {
      setupScenePreview: options => { preview = options; return { setAvailable() {}, setScene() {}, setVisible() {}, invalidate() {} }; },
      setupSceneLayout: () => ({ setAvailable() {}, setSourceAvailable() {}, openSource: input => { opened.push(input); return true; } }),
    } });
    h.controller.setAvailable(true, [], { scenePreview: true });
    Object.assign(h.current, { dirty: true, sceneDraftWritable: true, sceneDraftPath: scenes[0].sourcePath });
    const request = preview.editDraftLayout({ model: { scene: { objectId: scenes[0].id, sourcePath: scenes[0].sourcePath } }, isCurrent: () => previewCurrent });
    if (change === 'scene') { h.element('projectBuildScene').value = scenes[1].id; h.element('projectBuildScene').dispatch('change'); }
    else if (change === 'close') h.element('projectBuildClose').click();
    else previewCurrent = false;
    waiting.resolve({ sourcePath: scenes[0].sourcePath, content: 'old draft' });
    assert.equal(await request, false); assert.equal(opened.length, 0);
    assert.equal(h.calls.some(call => call.request.method === 'POST'), false);
  }
});


test('source apply propagates live origin ownership to the asynchronous editor host', async () => {
  for (const change of ['scene', 'close', 'layout', 'reopen']) {
    let layout, owner, live = true;
    const h = await harness({ applySceneDraft: async (_proposal, options) => { owner = options.isCurrent; return { applied: true }; }, overrides: {
      setupSceneLayout: options => { layout = options; return { setAvailable() {}, setSourceAvailable() {} }; },
    } });
    h.controller.setAvailable(true, [], { scenePreview: true });
    Object.assign(h.current, { dirty: true, sceneDraftWritable: true, sceneDraftPath: scenes[0].sourcePath });
    await layout.applySourceDraft({ sceneId: scenes[0].id, sourcePath: scenes[0].sourcePath }, { isCurrent: () => live });
    assert.equal(owner(), true);
    if (change === 'scene') { h.element('projectBuildScene').value = scenes[1].id; h.element('projectBuildScene').dispatch('change'); }
    else if (change === 'layout') live = false;
    else {
      h.element('projectBuildClose').click(); await flushDialogs();
      if (change === 'reopen') { h.element('projectBuildBtn').click(); await flushDialogs(); }
    }
    assert.equal(owner(), false);
  }
});
