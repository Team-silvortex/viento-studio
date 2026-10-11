import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import { dialogHarness, flushDialogs } from './dialog-harness.mjs';
import { deferred } from './editor-harness.mjs';
import { PROJECT_BUILD_API_PATH } from '../../engine/project-build-contract.mjs';

const recipeId = '11111111-1111-4111-8111-111111111111', instanceId = '22222222-2222-4222-8222-222222222222';
const previewId = '33333333-3333-4333-8333-333333333333', imageId = '44444444-4444-4444-8444-444444444444';
const path = 'documents/scenes/recipe.json', base = 'sha256:' + 'a'.repeat(64);
const recipe = { id: recipeId, kind: 'composition', title: 'Recipe', sourcePath: path };
const secondId = '55555555-5555-4555-8555-555555555555', placementId = '66666666-6666-4666-8666-666666666666';
const candidate = () => ({ sceneId: recipeId, sourcePath: path, baseSourceRevision: base, changes: [
  { instanceId, placementId, actorKey: 'leader', position: [2, 3] },
  { instanceId: secondId, placementId, actorKey: 'companion', position: [5, 6] },
], afterContent: '{"candidate":"原文😀"}' });
function checked(p = candidate()) {
  const hash = 'sha256:' + createHash('sha256').update(p.afterContent).digest('hex');
  return { ok: true, format: 'viento-scene-preview', schemaVersion: 2, previewId,
    scene: { objectId: recipeId, sourcePath: path, sourceRevision: hash }, actors: p.changes.map(change => ({ instanceId: change.instanceId })),
    sourceLocations: { actors: p.changes.map(change => ({ instanceId: change.instanceId, composition: { placementId: change.placementId, localKey: change.actorKey } })) },
    draft: { baseSourceRevision: base, sourceRevision: hash },
    composition: { format: 'viento-scene-composition-preview', schemaVersion: 1, recipeObjectId: recipeId,
      sourcePath: path, sourceRevision: hash, fragmentCount: 1, placementCount: 2 } };
}
async function fixture(t, options = {}) {
  const calls = [], opened = [], layoutOpened = [], applied = [];
  const context = { editable: true, dirty: false, creating: false, busy: false, path,
    sceneDraftPath: path, sceneDraftToken: 'source:1', compositionSourceWritable: true };
  let preview, override, layout;
  const h = await dialogHarness('app-project-build', {
    crypto: webcrypto, PROJECT_BUILD_API_PATH, SCENE_PREVIEW_API_PATH: '/api/scene-preview', WORLD_API_PATH: '/api/world', supportsStudioCoreCompositionPatch: () => true, supportsStudioCoreCompositionPositions: () => options.supported !== false,
    setupScenePreview: config => { preview = config; return { setAvailable() {}, setScene() {}, setVisible() {}, invalidate() {} }; },
    setupSceneCompositionOverrides: config => { override = config; return { open: input => { opened.push(input); return true; }, refresh() {} }; },
    setupSceneCompositionBatchLayout: config => { layout = config; return { open: input => { layoutOpened.push(input); return true; }, refresh() {} }; },
    fetchJsonApiRequest: async (url, request) => {
      calls.push({ url, request });
      if (url.startsWith('/api/scene-preview')) {
        return request.method === 'DELETE' ? { payload: { ok: true } } : options.validate ? options.validate(url, request) : { payload: checked() };
      }
      if (url === '/api/world') return { payload: { resources: [{ id: imageId, descriptor: { kind: 'image', name: 'Picture', location: { path: 'assets/picture.svg' } }, availability: 'present-unverified' }] } };
      return { payload: { supported: true, available: false, scenes: [], previewDocuments: [recipe], job: null, reason: 'tool_missing' } };
    },
  });
  const controller = h.runtime.setupProjectBuild({ getContext: () => context,
    getCompositionSource: options.source || (async () => ({ sourcePath: path, baseSourceRevision: base, content: '{}' })),
    applyCompositionBatchDraft: async (...args) => { applied.push(args); return options.apply ? options.apply(...args) : { applied: true, focus() {} }; } });
  controller.setAvailable(true, [], { scenePreview: true }); h.element('projectBuildBtn').click(); await flushDialogs();
  h.element('projectBuildTabPreview').click(); await flushDialogs();
  t.after(() => { h.element('projectBuildDialog').close(); });
  return { ...h, preview, override, layout, layoutOpened, calls, opened, applied, context };
}
const input = () => ({ model: { composition: {}, scene: { objectId: recipeId, sourcePath: path } }, instanceId, isCurrent: () => true });

// The modal is a callback spy here; actual Rust, editor memory and browser
// execution are covered separately. These checks exercise the real parent.
test('batch layout opens a recipe source independently of parent actor selection or an image catalog', async t => {
  const h = await fixture(t), images = new Map([[imageId, { width: 2, height: 2 }]]);
  assert.equal(h.preview.getContext().canEditCompositionBatchLayout, true);
  assert.equal(await h.preview.editCompositionBatchLayout({ ...input(), images, actorId: null }), true);
  assert.equal(h.layoutOpened.length, 1); assert.equal(h.layoutOpened[0].actorId, null);
  assert.equal(h.layoutOpened[0].images, images); assert.equal(h.layoutOpened[0].source.sourcePath, path);
  assert.equal(h.calls.some(call => call.url === '/api/world'), false);
});

test('a missing batch capability preserves single-instance operations and blocks the new entry', async t => {
  const h = await fixture(t, { supported: false });
  assert.equal(h.preview.getContext().canEditCompositionOverride, true);
  assert.equal(h.preview.getContext().canEditCompositionLayout, true);
  assert.equal(h.preview.getContext().canEditCompositionBatchLayout, false);
  assert.equal(await h.preview.editCompositionBatchLayout(input()), false);
  assert.equal(h.layoutOpened.length, 0);
});

test('late source acquisition cannot open a batch after closing the parent or replacing its preview', async t => {
  for (const change of ['parent', 'owner']) {
    const pending = deferred(); let current = true;
    const h = await fixture(t, { source: () => pending.promise });
    const opening = h.preview.editCompositionBatchLayout({ ...input(), isCurrent: () => current });
    if (change === 'parent') h.element('projectBuildDialog').close(); else current = false;
    pending.resolve({ sourcePath: path, baseSourceRevision: base, content: '{}' });
    assert.equal(await opening, false); assert.equal(h.layoutOpened.length, 0);
  }
});

test('batch checking submits the full exact candidate and releases its separate preview lease', async t => {
  const h = await fixture(t), request = candidate();
  assert.equal((await h.layout.validateDraft(request)).ok, true);
  const post = h.calls.find(call => call.request?.method === 'POST');
  assert.deepEqual(JSON.parse(post.request.body), { sceneId: recipeId, draft: { sourcePath: path, baseSourceRevision: base, content: request.afterContent } });
  assert.ok(h.calls.some(call => call.request?.method === 'DELETE' && call.url.includes(previewId)));
  assert.equal(h.applied.length, 0);
});

test('every changed instance and its placement/local key must survive the full dependency check', async t => {
  for (const alter of [p => p.actors.pop(), p => p.sourceLocations.actors.pop(),
    p => { p.sourceLocations.actors[1].composition.localKey = 'leader'; },
    p => { p.sourceLocations.actors[0].composition.placementId = secondId; },
    p => { p.scene.sourceRevision = base; }, p => { p.sceneEditing = {}; }, p => { p.snapshot = {}; }]) {
    const payload = checked(); alter(payload);
    const h = await fixture(t, { validate: async () => ({ payload }) });
    await assert.rejects(h.layout.validateDraft(candidate()), { errorCode: 'scene_composition_override_invalid' });
    assert.ok(h.calls.some(call => call.request?.method === 'DELETE')); assert.equal(h.applied.length, 0);
  }
});

test('source token changes during batch validation reject late approval and release returned images', async t => {
  const pending = deferred(), h = await fixture(t, { validate: () => pending.promise });
  const checking = h.layout.validateDraft(candidate()); h.context.sceneDraftToken = 'source:2';
  pending.resolve({ payload: checked() });
  await assert.rejects(checking, { errorCode: 'scene_composition_override_conflict' });
  assert.ok(h.calls.some(call => call.request?.method === 'DELETE')); assert.equal(h.applied.length, 0);
});

test('batch completion accepts detached copies after a token advance and rejects changed member payloads', async t => {
  const h = await fixture(t, { apply: async () => { h.context.sceneDraftToken = 'source:2'; return { applied: true, focus() {} }; } });
  const request = candidate(), result = await h.layout.applySourceDraft(structuredClone(request));
  const wrong = structuredClone(request); wrong.changes[1].position[0]++;
  h.layout.sourceApplied(result, wrong); assert.equal(h.element('projectBuildDialog').open, true);
  h.layout.sourceApplied(result, request); assert.equal(h.element('projectBuildDialog').open, false);
  assert.equal(h.applied.length, 1);
});
