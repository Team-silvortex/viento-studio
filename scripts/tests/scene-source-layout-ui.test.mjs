import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import { createSceneSourceLayoutDraft } from '../../engine/scene-source-layout.mjs';
import { createSceneStructure } from '../../engine/scene-structure.mjs';
import { dialogHarness, flushDialogs } from './dialog-harness.mjs';
import { deferred } from './editor-harness.mjs';

const sceneId = '11111111-1111-4111-8111-111111111111', objectId = '22222222-2222-4222-8222-222222222222';
const firstId = '33333333-3333-4333-8333-333333333333', secondId = '44444444-4444-4444-8444-444444444444';
const groupId = '55555555-5555-4555-8555-555555555555', previewId = '66666666-6666-4666-8666-666666666666';
const sourcePath = 'documents/scenes/draft.json', base = `sha256:${'a'.repeat(64)}`;
const digest = content => `sha256:${createHash('sha256').update(content).digest('hex')}`;
const copy = value => JSON.parse(JSON.stringify(value));
function fixture() {
  const declaration = { format: 'viento-scene2d', schemaVersion: 3, title: 'Uncommitted 日本語 😀', viewport: [800, 480], background: '#000000',
    groups: [{ groupId, name: 'Family' }], actors: [
      { instanceId: firstId, objectId, groupId, position: [100, 150], useProjectionDefaults: true },
      { instanceId: secondId, objectId, groupId, position: [300, 230], size: [32, 32] },
    ] };
  const content = '\uFEFF' + JSON.stringify(declaration, null, 2).replaceAll('\n', '\r\n').replace('100,', '1e2,');
  const model = { ok: true, format: 'viento-scene-preview', schemaVersion: 2, previewId, snapshotId: base,
    scene: { objectId: sceneId, sourcePath, sourceRevision: digest(content), viewport: [800, 480], background: '#000000' },
    draft: { baseSourceRevision: base, sourceRevision: digest(content) },
    actors: declaration.actors.map((actor, index) => ({ ...actor, name: `Actor ${index}`, size: actor.size || [64, 64], color: '#ffffff', speed: 0, controls: 'none' })),
    sceneStructure: createSceneStructure(declaration), resources: [] };
  return { model, source: { sourcePath, baseSourceRevision: base, content } };
}
async function settle(h) {
  for (let i = 0; i < 100; i++) {
    await flushDialogs();
    if (h.element('sceneLayoutDialog').getAttribute('aria-busy') !== 'true') return;
    await new Promise(resolve => setTimeout(resolve, 1));
  }
  assert.fail('Source layout stayed busy');
}
async function harness(t, options = {}) {
  const value = fixture(), proposals = [], busyCalls = [], views = [], refreshed = [], copies = [];
  const context = { editable: true, dirty: true, creating: false, busy: false, canEditScene: false, sceneDraftWritable: true, sceneDraftPath: sourcePath, sceneDraftToken: 1 };
  let callbacks, memory = value.source.content, current = true;
  const h = await dialogHarness('app-scene-layout', {
    crypto: webcrypto, createSceneSourceLayoutDraft: options.factory || createSceneSourceLayoutDraft,
    createScenePreviewCanvas: settings => { callbacks = settings; return Object.fromEntries(['setScene', 'setVisible', 'setImages', 'selectMany', 'setMultiSelect', 'setEditing', 'setSnap', 'setGrid', 'fit', 'zoom'].map(name => [name, (...args) => views.push({ name, args })])); },
    requestWorldCommand() { assert.fail('Source layout must not issue World commands'); },
    readDocSource() { assert.fail('Source layout must not read saved source'); },
    fetchJsonApiRequest() { assert.fail('Source layout must not issue API calls'); },
  });
  const createElement = h.document.createElement;
  h.document.createElement = tag => { const element = createElement(tag); if (tag === 'canvas') { element.getContext = () => ({ drawImage() {} }); copies.push(element); } return element; };
  const controller = h.runtime.setupSceneLayout({ getContext: () => context, setBusy: value => busyCalls.push(value),
    applySourceDraft: async (proposal, ownership) => { proposals.push(proposal); if (options.apply) return options.apply(proposal, context, ownership); memory = proposal.afterContent; context.sceneDraftToken++; return { applied: true }; },
    sourceApplied: async () => { refreshed.push(true); },
    reload() { assert.fail('Source mode must not reload saved source'); },
    applied() { assert.fail('Source mode must not report a saved scene'); },
  });
  controller.setAvailable(false); controller.setSourceAvailable(true);
  t.after(async () => { h.runtime.window.confirm = () => true; h.element('sceneLayoutDialog').close(); await flushDialogs(); });
  const open = (extra = {}) => controller.openSource({ ...value, isCurrent: () => current, ...extra });
  if (!options.skipOpen) assert.equal(await open(), true);
  const check = async () => { h.element('sceneLayoutCheck').click(); await settle(h); };
  return { ...h, controller, context, value, views, refreshed, copies, proposals, busyCalls, open, check, callbacks,
    move: position => callbacks.onMove(firstId, position), memory: () => memory, setCurrent: next => { current = next; } };
}

test('source layout reviews complete text and applies only to editor memory with no saved-scene capability', async t => {
  const h = await harness(t); assert.equal(h.element('sceneLayoutTitle').dataset.i18n, '调整草稿布局');
  assert.equal(h.element('sceneLayoutSave').dataset.i18n, '应用到文本草稿'); assert.equal(h.element('sceneLayoutReload').hidden, true);
  h.move([211, 151]); assert.equal(h.element('sceneLayoutDialog').dataset.dirty, 'true'); assert.equal(h.proposals.length, 0);
  const original = h.memory(); await h.check();
  assert.equal(h.element('sceneLayoutSave').disabled, false); assert.equal(h.element('sceneLayoutReview').open, true);
  const reviewed = h.element('sceneLayoutSource').textContent;
  assert.ok(reviewed.startsWith('\uFEFF{\r\n')); assert.match(reviewed, /Uncommitted 日本語 😀/); assert.match(reviewed, /"useProjectionDefaults": true/);
  assert.equal(h.memory(), original); assert.equal(h.proposals.length, 0);
  h.element('sceneLayoutSave').click(); await settle(h);
  assert.equal(h.memory(), reviewed); assert.equal(h.proposals.length, 1); assert.equal(h.refreshed.length, 1);
  assert.equal(h.element('sceneLayoutDialog').open, false); assert.equal(h.context.dirty, true); assert.deepEqual(h.busyCalls, []);
  assert.deepEqual(Object.keys(h.proposals[0]).sort(), ['afterContent', 'baseSourceRevision', 'changes', 'sceneId', 'sourcePath', 'sourceRevision']);
});

test('source group selection, shared history and numeric input invalidate review without calling saved workflow', async t => {
  const h = await harness(t); h.element('sceneLayoutObjects').querySelector(`button[data-group-id="${groupId}"]`).click();
  const selected = h.views.filter(call => call.name === 'selectMany').at(-1).args[0]; assert.deepEqual(copy(selected), [firstId, secondId]);
  h.callbacks.onMoveMany([{ objectId: firstId, position: [110, 160] }, { objectId: secondId, position: [310, 240] }]);
  await h.check(); assert.equal(h.element('sceneLayoutSave').disabled, false);
  h.element('sceneLayoutUndo').click(); assert.equal(h.element('sceneLayoutDialog').dataset.dirty, 'false');
  h.element('sceneLayoutRedo').click(); assert.equal(h.element('sceneLayoutSave').disabled, true);
  h.callbacks.onSelect(firstId); await h.check();
  const x = h.element('sceneLayoutX'); x.value = ''; x.dispatch('input'); x.dispatch('change');
  assert.equal(h.element('sceneLayoutSave').disabled, true); assert.equal(h.element('sceneLayoutCheck').disabled, true);
  h.element('sceneLayoutUndo').click(); assert.equal(x.value, '110');
  x.value = '112.5'; x.dispatch('input'); x.dispatch('change'); assert.equal(x.value, '112.5');
  await h.check(); h.element('sceneLayoutUndo').click(); assert.equal(x.value, '110'); assert.equal(h.element('sceneLayoutSave').disabled, true);
  assert.equal(h.proposals.length, 0); assert.equal(h.memory(), h.value.source.content);
});

test('source Ctrl+S checks then applies to the draft, never writes the saved scene', async t => {
  const h = await harness(t); h.move([210, 151]);
  const dialog = h.element('sceneLayoutDialog'); const first = dialog.dispatch('keydown', { key: 's', ctrlKey: true }); await settle(h);
  assert.equal(first.defaultPrevented, true); assert.equal(h.proposals.length, 0); assert.equal(h.element('sceneLayoutReview').hidden, false);
  dialog.dispatch('keydown', { key: 's', metaKey: true }); await settle(h);
  assert.equal(h.proposals.length, 1); assert.equal(h.refreshed.length, 1); assert.equal(dialog.open, false);
});

test('cancel and Escape preserve original text, and source mode cannot invoke saved reload', async t => {
  const h = await harness(t); h.move([210, 151]); const confirmations = [];
  h.runtime.window.confirm = value => { confirmations.push(value); return false; };
  h.element('sceneLayoutCancel').click(); h.element('sceneLayoutDialog').dispatch('cancel');
  h.element('sceneLayoutReload').dispatch('click'); assert.equal(h.element('sceneLayoutDialog').open, true);
  assert.equal(confirmations.length, 2); assert.match(confirmations[0], /文本草稿不会改变/);
  h.runtime.window.confirm = () => true; h.element('sceneLayoutCancel').click(); await settle(h);
  assert.equal(h.element('sceneLayoutDialog').open, false); assert.equal(h.memory(), h.value.source.content); assert.equal(h.proposals.length, 0);
});

test('changed source tokens, paths and preview owners reject application and retain coordinates', async t => {
  for (const mutate of [h => { h.context.sceneDraftToken++; }, h => { h.context.sceneDraftPath = 'other.json'; }, h => h.setCurrent(false)]) {
    const h = await harness(t); h.move([210, 151]); await h.check(); mutate(h);
    h.element('sceneLayoutSave').dispatch('click'); await settle(h);
    assert.equal(h.proposals.length, 0); assert.equal(h.memory(), h.value.source.content);
    assert.equal(h.element('sceneLayoutDialog').open, true); assert.equal(h.element('sceneLayoutDialog').dataset.dirty, 'true');
    assert.equal(h.element('sceneLayoutX').value, '210'); assert.match(h.element('sceneLayoutMessage').textContent, /布局修改保留/);
    assert.equal(h.element('sceneLayoutSave').disabled, true); assert.equal(h.element('sceneLayoutCheck').disabled, true);
  }
});

test('pending local apply locks controls and a late host conflict never discards layout changes', async t => {
  const pending = deferred(); const h = await harness(t, { apply: () => pending.promise });
  h.move([210, 151]); await h.check(); h.element('sceneLayoutSave').click();
  assert.equal(h.element('sceneLayoutDialog').getAttribute('aria-busy'), 'true'); assert.equal(h.element('sceneLayoutCancel').disabled, true);
  h.move([888, 999]); assert.equal(h.element('sceneLayoutX').value, '210');
  h.context.sceneDraftToken++; pending.reject(Object.assign(new Error('Changed during hash'), { errorCode: 'scene_source_layout_conflict' })); await settle(h);
  assert.equal(h.element('sceneLayoutDialog').open, true); assert.equal(h.element('sceneLayoutDialog').dataset.dirty, 'true');
  assert.equal(h.element('sceneLayoutX').value, '210'); assert.equal(h.refreshed.length, 0); assert.deepEqual(h.busyCalls, []);
});

test('ambiguous host result is never treated as applied and does not refresh or close', async t => {
  for (const result of [undefined, false, true, {}, { ok: true }, { applied: false }]) {
    const h = await harness(t, { apply: async () => result }); h.move([211, 151]); await h.check(); h.element('sceneLayoutSave').click(); await settle(h);
    assert.equal(h.refreshed.length, 0); assert.equal(h.element('sceneLayoutDialog').open, true); assert.equal(h.element('sceneLayoutDialog').dataset.dirty, 'true');
  }
});

test('late apply after a forced dialog close does not refresh or revive the disposed layout', async t => {
  const pending = deferred(), h = await harness(t, { apply: () => pending.promise }); h.move([211, 151]); await h.check();
  h.element('sceneLayoutSave').click(); h.element('sceneLayoutDialog').close(); await flushDialogs();
  pending.resolve({ applied: true }); await settle(h);
  assert.equal(h.refreshed.length, 0); assert.equal(h.element('sceneLayoutDialog').open, false); assert.equal(h.element('sceneLayoutDialog').dataset.dirty, 'false');
});

test('async source preparation discards stale instances and a later open wins without leaking images', async t => {
  const pending = deferred(); let disposed = 0, preparations = 0;
  const h = await harness(t, { skipOpen: true, factory: async (...args) => {
    const draft = await createSceneSourceLayoutDraft(...args); if (++preparations === 1) await pending.promise;
    return { ...draft, dispose() { disposed++; draft.dispose(); } };
  } });
  const first = h.open(); await flushDialogs();
  h.context.sceneDraftToken++; assert.equal(await h.open(), true);
  pending.resolve(); assert.equal(await first, false); assert.equal(disposed, 1);
  h.element('sceneLayoutCancel').click(); await flushDialogs(); assert.equal(disposed, 2);
  assert.equal(h.copies.length, 0); assert.equal(h.proposals.length, 0);
});

test('closing local layout releases cloned images while leaving preview-owned images intact', async t => {
  const h = await harness(t, { skipOpen: true }); const image = { width: 64, height: 32 };
  assert.equal(await h.open({ images: new Map([['image', image]]) }), true); assert.equal(h.copies.length, 1);
  h.element('sceneLayoutCancel').click(); await flushDialogs(); assert.equal(h.copies[0].width, 0); assert.equal(h.copies[0].height, 0);
  assert.deepEqual(image, { width: 64, height: 32 });
});

async function previewHarness(t, options = {}) {
  const current = fixture(), requests = [], openings = [], context = { editable: true, dirty: true, creating: false, busy: false, canPreviewDraft: true, canEditDraftLayout: true, sceneDraftToken: 1, sceneDraftPath: sourcePath };
  const h = await dialogHarness('app-scene-preview', {
    SCENE_PREVIEW_API_PATH: '/api/scene-preview',
    createScenePreviewCanvas: () => Object.fromEntries(['setScene', 'setImages', 'setVisible', 'select', 'fit', 'zoom', 'setGrid', 'destroy'].map(name => [name, () => {}])),
    fetchJsonApiRequest: (url, request) => { const pending = deferred(); requests.push({ url, request, ...pending }); if (request.method === 'DELETE') pending.resolve({ payload: { ok: true } }); return pending.promise; },
  });
  const container = h.document.createElement('section'); h.document.body.append(container);
  const controller = h.runtime.setupScenePreview({ container, getContext: () => context, getDraft: async () => current.source,
    editDraftLayout: async value => { openings.push(value); return options.open ? options.open(value) : true; } });
  t.after(() => controller.destroy());
  controller.setAvailable(true); controller.setScene(sceneId); controller.setVisible(true);
  const post = () => requests.filter(call => call.request.method === 'POST').at(-1);
  const saved = copy(current.model); delete saved.draft; saved.sceneEditing = {};
  post().resolve({ payload: saved }); await flushDialogs();
  const refresh = controller.refreshDraft(); await flushDialogs(); post().resolve({ payload: current.model }); await refresh;
  return { ...h, controller, container, context, openings, current, post };
}

test('draft layout entry requires a fresh valid draft and preserves saved edit locks', async t => {
  const h = await previewHarness(t); const entry = h.element('scenePreviewDraftLayoutEdit');
  assert.equal(entry.hidden, false); assert.equal(entry.disabled, false); assert.equal(h.element('scenePreviewLayoutEdit').hidden, true);
  entry.click(); await flushDialogs(); assert.equal(h.openings.length, 1); assert.equal(h.openings[0].isCurrent(), true);
  h.context.sceneDraftToken++; h.controller.setScene(sceneId); assert.equal(h.openings[0].isCurrent(), false); assert.equal(entry.disabled, true);
  entry.dispatch('click'); await flushDialogs(); assert.equal(h.openings.length, 1);
});

test('invalid draft leaves its last valid picture read-only until public refreshDraft succeeds', async t => {
  const h = await previewHarness(t); const refresh = h.controller.refreshDraft(); await flushDialogs();
  h.post().reject(Object.assign(new Error('bad json'), { payload: { diagnostics: [{ code: 'build_scene_json' }] } })); await refresh;
  assert.equal(h.container.dataset.scenePreviewState, 'invalid'); assert.equal(h.element('scenePreviewDraftLayoutEdit').disabled, true);
  h.element('scenePreviewDraftLayoutEdit').dispatch('click'); await flushDialogs(); assert.equal(h.openings.length, 0);
  h.context.sceneDraftToken++; const retry = h.controller.refreshDraft(); await flushDialogs();
  assert.ok(JSON.parse(h.post().request.body).draft); h.post().resolve({ payload: h.current.model }); await retry;
  assert.equal(h.element('scenePreviewDraftLayoutEdit').disabled, false);
});

test('pending layout open is single flight and stale completion cannot change a new preview', async t => {
  const pending = deferred(), h = await previewHarness(t, { open: () => pending.promise });
  h.element('scenePreviewDraftLayoutEdit').click(); h.element('scenePreviewDraftLayoutEdit').dispatch('click'); assert.equal(h.openings.length, 1);
  h.controller.setVisible(false); assert.equal(h.openings[0].isCurrent(), false);
  pending.resolve(false); await flushDialogs(); assert.doesNotMatch(h.element('scenePreviewMessage').textContent, /编辑暂不可用/);
  h.controller.setVisible(true); await flushDialogs(); h.post().resolve({ payload: h.current.model }); await flushDialogs();
  assert.equal(h.element('scenePreviewDraftLayoutEdit').disabled, false);
});


test('source apply exposes a live owner guard to reject late host preparation before changing memory', async t => {
  const reached = deferred(), release = deferred(); let accepts = 0;
  const h = await harness(t, { apply: async (proposal, context, owner) => {
    assert.equal(owner.isCurrent(), true); reached.resolve(); await release.promise;
    if (!owner.isCurrent()) throw Object.assign(new Error('The originating layout was closed'), { errorCode: 'scene_source_layout_conflict' });
    accepts++; return { applied: true };
  } });
  h.move([211, 151]); await h.check(); h.element('sceneLayoutSave').click(); await reached.promise;
  h.element('sceneLayoutDialog').close(); release.resolve(); await flushDialogs(); await settle(h);
  assert.equal(accepts, 0); assert.equal(h.memory(), h.value.source.content); assert.equal(h.refreshed.length, 0);
});

test('returning a source draft to its saved baseline refreshes saved provenance instead of retaining stale draft geometry', async t => {
  const h = await previewHarness(t); h.context.dirty = false; h.context.canPreviewDraft = false; h.context.sceneDraftToken++;
  const refresh = h.controller.refreshDraft(); await flushDialogs();
  assert.deepEqual(JSON.parse(h.post().request.body), { sceneId });
  const saved = copy(h.current.model); delete saved.draft; saved.sceneEditing = {};
  saved.actors[0].position = [50, 50]; h.post().resolve({ payload: saved }); await refresh;
  assert.equal(h.container.dataset.scenePreviewState, 'ready'); assert.equal(h.element('scenePreviewDraftLayoutEdit').hidden, true);
  assert.match(h.element('scenePreviewProvenance').textContent, /当前画面：已保存场景/);
});
