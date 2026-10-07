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
const candidate = () => ({ sceneId: recipeId, sourcePath: path, baseSourceRevision: base, instanceId, afterContent: '{"candidate":"原文😀"}' });
function checked(p = candidate()) {
  const hash = 'sha256:' + createHash('sha256').update(p.afterContent).digest('hex');
  return { ok: true, format: 'viento-scene-preview', schemaVersion: 2, previewId,
    scene: { objectId: recipeId, sourcePath: path, sourceRevision: hash }, actors: [{ instanceId }],
    draft: { baseSourceRevision: base, sourceRevision: hash },
    composition: { format: 'viento-scene-composition-preview', schemaVersion: 1, recipeObjectId: recipeId,
      sourcePath: path, sourceRevision: hash, fragmentCount: 1, placementCount: 2 } };
}
async function fixture(t, options = {}) {
  const calls = [], opened = [], applied = [];
  const context = { editable: true, dirty: false, creating: false, busy: false, path,
    sceneDraftPath: path, sceneDraftToken: 'source:1', compositionSourceWritable: true };
  let preview, override;
  const h = await dialogHarness('app-project-build', {
    crypto: webcrypto, PROJECT_BUILD_API_PATH, SCENE_PREVIEW_API_PATH: '/api/scene-preview', WORLD_API_PATH: '/api/world', supportsStudioCoreCompositionPatch: () => true,
    setupScenePreview: config => { preview = config; return { setAvailable() {}, setScene() {}, setVisible() {}, invalidate() {} }; },
    setupSceneCompositionOverrides: config => { override = config; return { open: input => { opened.push(input); return true; }, refresh() {} }; },
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
    applyCompositionDraft: async (...args) => { applied.push(args); return options.apply ? options.apply(...args) : { applied: true, focus() {} }; } });
  controller.setAvailable(true, [], { scenePreview: true }); h.element('projectBuildBtn').click(); await flushDialogs();
  h.element('projectBuildTabPreview').click(); await flushDialogs();
  t.after(() => { h.element('projectBuildDialog').close(); });
  return { ...h, preview, override, calls, opened, applied, context };
}
const input = () => ({ model: { composition: {}, scene: { objectId: recipeId, sourcePath: path } }, instanceId, isCurrent: () => true });

test('clean recipe source opens override editing with named registered images and no write endpoint', async t => {
  const h = await fixture(t); assert.equal(h.preview.getContext().canEditCompositionOverride, true);
  assert.equal(await h.preview.editCompositionOverride(input()), true);
  assert.equal(h.opened.length, 1); assert.equal(h.opened[0].source.sourcePath, path);
  assert.deepEqual(JSON.parse(JSON.stringify(h.opened[0].images)), [{ id: imageId, name: 'Picture', path: 'assets/picture.svg' }]);
  assert.ok(h.calls.every(call => !call.request?.method || call.request.method === 'GET'));
});

test('a delayed source open cannot edit a closed or reopened parent session', async t => {
  const pending = deferred(), h = await fixture(t, { source: () => pending.promise });
  const opening = h.preview.editCompositionOverride(input()); h.element('projectBuildDialog').close(); h.element('projectBuildBtn').click();
  pending.resolve({ sourcePath: path, baseSourceRevision: base, content: '{}' }); assert.equal(await opening, false); assert.equal(h.opened.length, 0);
});

test('candidate checking uses the exact draft and releases its independent preview lease', async t => {
  const h = await fixture(t), request = candidate(); assert.equal((await h.override.validateDraft(request)).ok, true);
  const post = h.calls.find(call => call.request?.method === 'POST');
  assert.deepEqual(JSON.parse(post.request.body), { sceneId: recipeId, draft: { sourcePath: path, baseSourceRevision: base, content: request.afterContent } });
  assert.ok(h.calls.some(call => call.request?.method === 'DELETE' && call.url.includes(previewId))); assert.equal(h.applied.length, 0);
});

test('mismatched validation revisions, identity, counts or generated write grants never approve a candidate', async t => {
  for (const alter of [p => { p.scene.sourceRevision = base; }, p => { p.draft.baseSourceRevision = 'sha256:' + 'b'.repeat(64); },
    p => { p.composition.recipeObjectId = instanceId; }, p => { p.composition.fragmentCount = 33; },
    p => { p.sceneEditing = {}; }, p => { p.snapshot = {}; }, p => { p.actors = []; }]) {
    const payload = checked(); alter(payload);
    const h = await fixture(t, { validate: async () => ({ payload }) });
    await assert.rejects(h.override.validateDraft(candidate()), { errorCode: 'scene_composition_override_invalid' });
    assert.equal(h.applied.length, 0); assert.ok(h.calls.some(call => call.request?.method === 'DELETE'));
  }
});

test('closing the parent or changing the source token while validation waits rejects the late response', async t => {
  for (const close of [true, false]) {
    const waiting = deferred(), h = await fixture(t, { validate: () => waiting.promise });
    const checking = h.override.validateDraft(candidate());
    if (close) h.element('projectBuildDialog').close(); else h.context.sceneDraftToken = 'source:2';
    waiting.resolve({ payload: checked() });
    await assert.rejects(checking, { errorCode: 'scene_composition_override_conflict' }); assert.equal(h.applied.length, 0);
    assert.ok(h.calls.some(call => call.request?.method === 'DELETE'));
  }
});

test('apply delegates a live parent owner and completion closes only its own editor session', async t => {
  const h = await fixture(t), request = candidate();
  const result = await h.override.applySourceDraft(request, { isCurrent: () => true });
  assert.equal(h.applied[0][1].isCurrent(), true); h.override.sourceApplied(result, request);
  assert.equal(h.element('projectBuildDialog').open, false); assert.equal(h.applied[0][1].isCurrent(), false);
  h.element('projectBuildBtn').click(); await flushDialogs(); h.override.sourceApplied(result, request);
  assert.equal(h.element('projectBuildDialog').open, true);
});
