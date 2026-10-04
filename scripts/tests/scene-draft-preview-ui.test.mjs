import test from 'node:test';
import assert from 'node:assert/strict';
import { dialogHarness, flushDialogs } from './dialog-harness.mjs';
import { deferred } from './editor-harness.mjs';

const sceneOne = '11111111-1111-4111-8111-111111111111', sceneTwo = '22222222-2222-4222-8222-222222222222';
const actorId = '33333333-3333-4333-8333-333333333333', previewOne = '44444444-4444-4444-8444-444444444444';
const previewTwo = '55555555-5555-4555-8555-555555555555', previewThree = '77777777-7777-4777-8777-777777777777';
const imageId = '66666666-6666-4666-8666-666666666666', groupId = '88888888-8888-4888-8888-888888888888';
const sourcePath = 'documents/scenes/room.json', base = `sha256:${'a'.repeat(64)}`, revision = `sha256:${'b'.repeat(64)}`, failedRevision = `sha256:${'c'.repeat(64)}`;
const source = (path, field, hash = base) => ({ sourcePath: path, objectId: path === sourcePath ? sceneOne : actorId, propertyPath: field,
  sourceRevision: hash, sourceRange: { start: 2, end: 8, encoding: 'utf-16', propertyPath: field, exact: true } });
function preview({ draft = false, previewId = draft ? previewTwo : previewOne, sceneId = sceneOne, image = false } = {}) {
  const path = sceneId === sceneOne ? sourcePath : 'documents/scenes/other.json';
  return { ok: true, format: 'viento-scene-preview', schemaVersion: 2, previewId, snapshotId: `sha256:${previewId}`,
    scene: { objectId: sceneId, sourcePath: path, title: draft ? 'Draft' : 'Saved', viewport: [800, 480], background: '#123456' },
    actors: [{ instanceId: actorId, objectId: actorId, name: 'Actor', position: [draft ? 200 : 100, 100], size: [64, 64], speed: 30, controls: 'arrows', color: '#ffffff',
      sourcePath: 'documents/projections/player.json', declaration: source(path, '/actors/0'), ...(image ? { imageResourceId: imageId } : {}) }],
    sceneStructure: { format: 'viento-scene-structure', schemaVersion: 1, sourceSchemaVersion: 3, groups: [{ groupId, name: draft ? 'Draft group' : 'Saved group' }], memberships: [{ instanceId: actorId, groupId }] },
    sourceLocations: { scene: source(path, ''), actors: [{ instanceId: actorId, objectId: actorId, declaration: source(path, '/actors/0'),
      fields: { position: source(path, '/actors/0/position'), speed: source('documents/projections/player.json', '/configuration/speed') } }],
      groups: [{ groupId, declaration: source(path, '/groups/0'), fields: { name: source(path, '/groups/0/name') } }] },
    resources: image ? [{ id: imageId, size: 8, url: `/api/scene-preview?previewId=${previewId}&resourceId=${imageId}` }] : [], diagnostics: [],
    ...(draft ? { draft: { baseSourceRevision: base, sourceRevision: revision } } : { sceneEditing: { sourceRevision: base } }) };
}
async function harness(t) {
  const calls = [], assets = [], opened = [], edited = [], layouts = [], viewCalls = [], decoded = [], imageObjects = [], revoked = [];
  const context = { editable: true, dirty: true, creating: false, busy: false, canEditScene: true, canPreviewDraft: true, sceneDraftToken: 1 };
  let draftReader = async () => ({ sourcePath, baseSourceRevision: base, content: '{"format":"draft"}' });
  let autoDecode = true;
  class PreviewURL extends URL {
    static createObjectURL() { return 'blob:scene-draft'; }
    static revokeObjectURL(url) { revoked.push(url); }
  }
  class PreviewImage {
    naturalWidth = 32; naturalHeight = 32;
    constructor() { imageObjects.push(this); }
    set src(value) { if (value && autoDecode) queueMicrotask(() => this.onload?.()); }
  }
  const h = await dialogHarness('app-scene-preview', {
    SCENE_PREVIEW_API_PATH: '/api/scene-preview', URL: PreviewURL, Image: PreviewImage,
    location: { href: 'http://127.0.0.1/web/', origin: 'http://127.0.0.1' },
    createScenePreviewCanvas: () => Object.fromEntries(['setScene', 'setImages', 'setVisible', 'select', 'fit', 'zoom', 'setGrid', 'destroy'].map(name => [name, (...args) => viewCalls.push({ name, args })])),
    fetchJsonApiRequest: (url, request) => { const wait = deferred(), call = { url, request, ...wait }; calls.push(call); if (request.method === 'DELETE') wait.resolve({ payload: { ok: true } }); return wait.promise; },
    fetchWithTimeout: (url, request) => { const wait = deferred(); assets.push({ url, request, ...wait }); return wait.promise; },
  });
  const createElement = h.document.createElement;
  h.document.createElement = tag => { const element = createElement(tag); if (tag === 'canvas') { element.getContext = () => ({ drawImage() {} }); decoded.push(element); } return element; };
  const container = h.document.createElement('section'); h.document.body.append(container);
  const controller = h.runtime.setupScenePreview({ container, getContext: () => context, getDraft: id => draftReader(id),
    openSource: (...args) => opened.push(args), editScene: id => edited.push(id), editLayout: value => { layouts.push(value); return true; } });
  t.after(() => controller.destroy());
  controller.setAvailable(true); controller.setScene(sceneOne); controller.setVisible(true);
  const posts = () => calls.filter(call => call.request.method === 'POST');
  const post = () => posts().at(-1);
  const resolve = async value => { post().resolve({ payload: value }); await flushDialogs(); };
  const refreshDraft = async () => { h.element('scenePreviewDraftRefresh').click(); await flushDialogs(); };
  const rejectDraft = async (hash = failedRevision) => { post().reject(Object.assign(new Error('Bad draft'), { payload: { ok: false,
    draft: { baseSourceRevision: base, sourceRevision: hash }, diagnostics: [{ code: 'build_scene_value', ...source(sourcePath, '/viewport', hash) }] } })); await flushDialogs(); };
  const latestModel = () => viewCalls.filter(call => call.name === 'setScene' && call.args[0]).at(-1)?.args[0];
  const deleted = id => calls.some(call => call.request.method === 'DELETE' && call.url.includes(id));
  return { ...h, container, context, controller, calls, assets, opened, edited, layouts, viewCalls, decoded, imageObjects, revoked, posts, post, resolve,
    refreshDraft, rejectDraft, latestModel, deleted, setDraftReader: value => { draftReader = value; }, setAutoDecode: value => { autoDecode = value; } };
}

test('draft preview posts only the current scene source and stays read-only until a saved preview replaces it', async t => {
  const h = await harness(t); await h.resolve(preview()); await h.refreshDraft();
  assert.deepEqual(JSON.parse(h.post().request.body), { sceneId: sceneOne, draft: { sourcePath, baseSourceRevision: base, content: '{"format":"draft"}' } });
  await h.resolve(preview({ draft: true }));
  assert.equal(h.container.dataset.scenePreviewState, 'ready'); assert.match(h.element('scenePreviewMessage').textContent, /草稿尚未保存/);
  assert.match(h.element('scenePreviewProvenance').textContent, /未保存草稿.*已保存内容/);
  h.context.dirty = false; h.context.canPreviewDraft = false; h.controller.setScene(sceneOne);
  assert.equal(h.element('scenePreviewEdit').disabled, true); assert.equal(h.element('scenePreviewLayoutEdit').hidden, true);
  h.element('scenePreviewEdit').dispatch('click'); h.element('scenePreviewLayoutEdit').dispatch('click');
  assert.equal(h.edited.length, 0); assert.equal(h.layouts.length, 0);
  h.element('scenePreviewRefresh').click(); assert.equal(h.element('scenePreviewCanvas').hidden, true);
  await h.resolve(preview({ previewId: previewThree }));
  assert.equal(h.element('scenePreviewEdit').disabled, false); assert.equal(h.element('scenePreviewLayoutEdit').hidden, false);
  h.element('scenePreviewLayoutEdit').click(); assert.equal(h.layouts.length, 1);
  assert.ok(h.deleted(previewOne)); assert.ok(h.deleted(previewTwo));
});

test('invalid draft keeps saved canvas and outline while diagnostics navigate the failed draft revision', async t => {
  const h = await harness(t); await h.resolve(preview()); const paints = h.viewCalls.filter(call => call.name === 'setScene').length;
  await h.refreshDraft(); await h.rejectDraft();
  assert.equal(h.container.dataset.scenePreviewState, 'invalid'); assert.equal(h.element('scenePreviewCanvas').hidden, false);
  assert.match(h.element('scenePreviewMessage').textContent, /草稿有误.*上一次有效预览/);
  assert.match(h.element('scenePreviewProvenance').textContent, /上一次有效的已保存/);
  assert.match(h.element('scenePreviewObjects').textContent, /Saved group/);
  assert.equal(h.viewCalls.filter(call => call.name === 'setScene').length, paints); assert.equal(h.deleted(previewOne), false);
  h.element('scenePreviewSource').click(); await flushDialogs(); assert.equal(h.opened.at(-1)[1].previewDraft, undefined);
  assert.match(h.element('scenePreviewDiagnostics').textContent, /本次草稿/);
  h.element('scenePreviewDiagnostics').querySelector('button').click(); await flushDialogs();
  assert.equal(h.opened.at(-1)[1].previewDraft, true); assert.equal(h.opened.at(-1)[1].sourceRevision, failedRevision);
});

test('last valid draft source links keep their own hash, and saved projection links never carry the draft flag', async t => {
  const h = await harness(t); await h.resolve(preview()); await h.refreshDraft(); await h.resolve(preview({ draft: true }));
  h.element('scenePreviewObjects').querySelector(`button[data-actor-id="${actorId}"]`).click();
  await h.refreshDraft(); await h.rejectDraft();
  assert.match(h.element('scenePreviewProvenance').textContent, /上一次有效草稿/);
  h.element('scenePreviewProperties').querySelectorAll('dd')[0].querySelector('button').click(); await flushDialogs();
  assert.equal(h.opened.at(-1)[1].sourceRevision, revision); assert.equal(h.opened.at(-1)[1].previewDraft, true);
  h.element('scenePreviewProperties').querySelectorAll('dd')[3].querySelector('button').click(); await flushDialogs();
  assert.equal(h.opened.at(-1)[0], 'documents/projections/player.json'); assert.equal(h.opened.at(-1)[1].previewDraft, undefined);
  h.element('scenePreviewObjects').querySelector(`button[data-group-source="${groupId}"]`).click(); await flushDialogs();
  assert.equal(h.opened.at(-1)[1].sourceRevision, revision); assert.equal(h.opened.at(-1)[1].previewDraft, true);
  h.element('scenePreviewDiagnostics').querySelector('button').click(); await flushDialogs(); assert.equal(h.opened.at(-1)[1].sourceRevision, failedRevision);
});

test('source reads abandoned by an editor token change or scene switch never issue a draft request', async t => {
  const h = await harness(t); await h.resolve(preview()); const pending = deferred(); h.setDraftReader(() => pending.promise);
  await h.refreshDraft(); h.context.sceneDraftToken++; h.controller.setScene(sceneOne);
  pending.resolve({ sourcePath, baseSourceRevision: base, content: '{}' }); await flushDialogs();
  assert.equal(h.posts().length, 1); assert.equal(h.container.dataset.scenePreviewState, 'error'); assert.match(h.element('scenePreviewMessage').textContent, /草稿已变化/);
  const next = deferred(); h.setDraftReader(() => next.promise); await h.refreshDraft(); h.controller.setScene(sceneTwo);
  next.resolve({ sourcePath, baseSourceRevision: base, content: '{}' }); await flushDialogs();
  assert.equal(h.posts().length, 2); assert.deepEqual(JSON.parse(h.post().request.body), { sceneId: sceneTwo });
  await h.resolve(preview({ sceneId: sceneTwo, previewId: previewThree })); assert.equal(h.latestModel().scene.objectId, sceneTwo);
});

test('late draft responses after an unrendered token change are released and do not leave the UI loading', async t => {
  const h = await harness(t); await h.resolve(preview()); await h.refreshDraft(); h.context.sceneDraftToken++;
  await h.resolve(preview({ draft: true }));
  assert.equal(h.container.dataset.scenePreviewState, 'error'); assert.equal(h.latestModel().previewId, previewOne);
  assert.ok(h.deleted(previewTwo)); assert.equal(h.deleted(previewOne), false); assert.equal(h.element('scenePreviewDraftRefresh').disabled, false);
});

test('draft context loss cancels immediately and releases a late preview without crossing editor sessions', async t => {
  const h = await harness(t); await h.resolve(preview()); await h.refreshDraft(); const request = h.post();
  h.context.canPreviewDraft = false; h.controller.setScene(sceneOne); assert.equal(request.request.signal.aborted, true);
  request.resolve({ payload: preview({ draft: true }) }); await flushDialogs();
  assert.ok(h.deleted(previewTwo)); assert.equal(h.latestModel().previewId, previewOne); assert.equal(h.container.dataset.scenePreviewState, 'error');
});

test('draft images decode beside the valid preview, then atomically replace and release its resources', async t => {
  const h = await harness(t); await h.resolve(preview({ image: true })); h.assets[0].resolve(new Blob(['old data'])); await flushDialogs();
  const oldImage = h.viewCalls.filter(call => call.name === 'setImages').at(-1).args[0].get(imageId); assert.equal(oldImage.width, 64);
  await h.refreshDraft(); await h.resolve(preview({ draft: true, image: true }));
  assert.equal(h.latestModel().previewId, previewOne); assert.equal(oldImage.width, 64); assert.equal(h.deleted(previewOne), false);
  h.assets[1].resolve(new Blob(['new data'])); await flushDialogs();
  assert.equal(h.latestModel().previewId, previewTwo); assert.equal(h.container.dataset.scenePreviewState, 'ready');
  assert.equal(oldImage.width, 0); assert.ok(h.deleted(previewOne)); assert.equal(h.revoked.length, 2);
  const newImage = h.viewCalls.filter(call => call.name === 'setImages').at(-1).args[0].get(imageId);
  h.controller.setVisible(false); assert.equal(newImage.width, 64); assert.ok(h.deleted(previewTwo));
  h.controller.destroy(); assert.equal(newImage.width, 0);
});

test('token changes during image decoding discard candidate canvases and retain the valid scene', async t => {
  const h = await harness(t); await h.resolve(preview()); h.setAutoDecode(false);
  await h.refreshDraft(); await h.resolve(preview({ draft: true, image: true })); h.assets[0].resolve(new Blob(['new data'])); await flushDialogs();
  assert.equal(h.imageObjects.length, 1); h.context.sceneDraftToken++; h.imageObjects[0].onload(); await flushDialogs();
  assert.equal(h.latestModel().previewId, previewOne); assert.equal(h.container.dataset.scenePreviewState, 'error');
  assert.ok(h.deleted(previewTwo)); assert.ok(h.decoded.filter(value => value !== h.element('scenePreviewCanvas')).every(value => value.width === 0));
  assert.equal(h.revoked.length, 1);
});

test('hiding while draft resources are pending releases both snapshots and forbids a late paint', async t => {
  const h = await harness(t); await h.resolve(preview()); await h.refreshDraft(); await h.resolve(preview({ draft: true, image: true }));
  h.controller.setVisible(false); assert.ok(h.deleted(previewOne)); assert.ok(h.deleted(previewTwo));
  h.assets[0].resolve(new Blob(['new data'])); await flushDialogs();
  assert.equal(h.element('scenePreviewCanvas').hidden, true); assert.equal(h.imageObjects.length, 0);
});

test('unavailable or unreadable draft content preserves the last valid canvas and can be retried', async t => {
  const h = await harness(t); await h.resolve(preview());
  for (const reader of [async () => null, async () => { throw new Error('Editor unavailable'); }]) {
    h.setDraftReader(reader); await h.refreshDraft(); assert.equal(h.posts().length, 1);
    assert.equal(h.container.dataset.scenePreviewState, 'error'); assert.equal(h.latestModel().previewId, previewOne);
    assert.equal(h.element('scenePreviewDraftRefresh').disabled, false);
  }
});

test('an invalid saved scene can be repaired in a draft without saving it first', async t => {
  const h = await harness(t); h.post().reject(Object.assign(new Error('Bad saved content'), { payload: { diagnostics: [{ code: 'build_scene_json' }] } })); await flushDialogs();
  assert.equal(h.element('scenePreviewCanvas').hidden, true); await h.refreshDraft(); await h.resolve(preview({ draft: true }));
  assert.equal(h.container.dataset.scenePreviewState, 'ready'); assert.equal(h.element('scenePreviewCanvas').hidden, false);
  assert.equal(h.latestModel().draft.sourceRevision, revision);
});

test('untrusted draft responses cannot grant editing or omit the draft provenance', async t => {
  const h = await harness(t); await h.resolve(preview());
  for (const mutate of [value => { value.sceneEditing = {}; }, value => { delete value.draft; }, value => { value.draft.baseSourceRevision = failedRevision; }, value => { value.scene.sourcePath = 'other.json'; }]) {
    await h.refreshDraft(); const candidate = preview({ draft: true }); mutate(candidate); await h.resolve(candidate);
    assert.equal(h.latestModel().previewId, previewOne); assert.equal(h.container.dataset.scenePreviewState, 'error'); assert.ok(h.deleted(previewTwo));
  }
});

test('request limits and changed saved baselines explain why the draft could not be previewed', async t => {
  const h = await harness(t); await h.resolve(preview());
  for (const [errorCode, message] of [['scene_preview_request_invalid', /128 KiB/], ['scene_preview_draft_conflict', /编辑冲突/]]) {
    await h.refreshDraft(); h.post().reject(Object.assign(new Error(errorCode), { payload: { errorCode } })); await flushDialogs();
    assert.match(h.element('scenePreviewMessage').textContent, message); assert.equal(h.container.dataset.scenePreviewState, 'error');
    assert.equal(h.latestModel().previewId, previewOne); assert.match(h.element('scenePreviewProvenance').textContent, /上一次有效/);
  }
});

test('creating, busy, unmatched and unavailable contexts guard draft actions even for synthetic clicks', async t => {
  const h = await harness(t); await h.resolve(preview());
  for (const [key, value] of [['creating', true], ['busy', true], ['canPreviewDraft', false]]) {
    const before = h.context[key]; h.context[key] = value; h.controller.setScene(sceneOne);
    assert.equal(h.element('scenePreviewDraftRefresh').disabled, true); h.element('scenePreviewDraftRefresh').dispatch('click'); await flushDialogs();
    h.context[key] = before;
  }
  assert.equal(h.posts().length, 1); h.controller.setAvailable(false); h.element('scenePreviewDraftRefresh').dispatch('click'); await flushDialogs(); assert.equal(h.posts().length, 1);
});


test('closing the draft preview permits natural source edits and reopening keeps the last valid snapshot on errors', async t => {
  const h = await harness(t); await h.resolve(preview()); await h.refreshDraft(); await h.resolve(preview({ draft: true }));
  h.controller.setVisible(false); assert.ok(h.deleted(previewTwo)); assert.equal(h.element('scenePreviewCanvas').hidden, true);
  h.context.sceneDraftToken++; h.setDraftReader(async () => ({ sourcePath, baseSourceRevision: base, content: '{invalid' }));
  h.controller.setVisible(true); await flushDialogs();
  assert.equal(JSON.parse(h.post().request.body).draft.content, '{invalid');
  assert.equal(h.latestModel().previewId, previewTwo); await h.rejectDraft();
  assert.equal(h.container.dataset.scenePreviewState, 'invalid'); assert.equal(h.element('scenePreviewCanvas').hidden, false);
  assert.match(h.element('scenePreviewProvenance').textContent, /上一次有效草稿/);
  h.element('scenePreviewSource').click(); await flushDialogs(); assert.equal(h.opened.at(-1)[1].sourceRevision, revision);
  // Explicit saved refresh clears the retained draft and restores saved mode.
  h.element('scenePreviewRefresh').click(); assert.equal(h.element('scenePreviewCanvas').hidden, true);
  await h.resolve(preview({ previewId: previewThree })); h.controller.setVisible(false); h.controller.setVisible(true);
  assert.deepEqual(JSON.parse(h.post().request.body), { sceneId: sceneOne });
});

test('a retained hidden draft is cleared when the selected scene changes', async t => {
  const h = await harness(t); await h.resolve(preview()); await h.refreshDraft(); await h.resolve(preview({ draft: true, image: true }));
  h.assets[0].resolve(new Blob(['new data'])); await flushDialogs();
  const retained = h.viewCalls.filter(call => call.name === 'setImages').at(-1).args[0].get(imageId);
  h.controller.setVisible(false); assert.equal(retained.width, 64); h.controller.setScene(sceneTwo); assert.equal(retained.width, 0);
  h.controller.setVisible(true); assert.deepEqual(JSON.parse(h.post().request.body), { sceneId: sceneTwo });
  await h.resolve(preview({ sceneId: sceneTwo, previewId: previewThree })); assert.equal(h.latestModel().scene.objectId, sceneTwo);
});
