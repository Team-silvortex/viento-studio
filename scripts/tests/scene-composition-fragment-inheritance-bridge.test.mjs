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
const secondPlacementId = '77777777-7777-4777-8777-777777777777';
const candidate = () => ({ sceneId: recipeId, sourcePath: path, baseSourceRevision: base, instanceId,
  fragmentId: 'party', actorKey: 'companion', values: {}, reset: ['imageResourceId'], targets: [
    { instanceId, placementId, overrides: [] },
    { instanceId: secondId, placementId: secondPlacementId, overrides: ['color'] },
  ], afterContent: '{"candidate":"原文😀"}' });
function checked(p = candidate()) {
  const hash = 'sha256:' + createHash('sha256').update(p.afterContent).digest('hex');
  return { ok: true, format: 'viento-scene-preview', schemaVersion: 2, previewId,
    scene: { objectId: recipeId, sourcePath: path, sourceRevision: hash }, actors: p.targets.map(target => ({ instanceId: target.instanceId })),
    sourceLocations: { actors: p.targets.map(target => ({ instanceId: target.instanceId, composition: { fragmentId: p.fragmentId, placementId: target.placementId, localKey: p.actorKey } })) },
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
    crypto: webcrypto, PROJECT_BUILD_API_PATH, SCENE_PREVIEW_API_PATH: '/api/scene-preview', WORLD_API_PATH: '/api/world', supportsStudioCoreCompositionPatch: () => true, supportsStudioCoreCompositionPositions: () => true, supportsStudioCoreCompositionFragment: () => options.supported !== false,
    setupScenePreview: config => { preview = config; return { setAvailable() {}, setScene() {}, setVisible() {}, invalidate() {} }; },
    setupSceneCompositionOverrides: config => { override = config; return { open: input => { opened.push(input); return true; }, refresh() {} }; },
    setupSceneCompositionFragments: config => { layout = config; return { open: input => { layoutOpened.push(input); return true; }, refresh() {} }; },
    fetchJsonApiRequest: async (url, request) => {
      calls.push({ url, request });
      if (url.startsWith('/api/scene-preview')) {
        return request.method === 'DELETE' ? { payload: { ok: true } } : options.validate ? options.validate(url, request) : { payload: checked() };
      }
      if (url === '/api/world' && options.world) return options.world();
      if (url === '/api/world') return { payload: { resources: [{ id: imageId, descriptor: { kind: 'image', name: 'Picture', location: { path: 'assets/picture.svg' } }, availability: 'present-unverified' }] } };
      return { payload: { supported: true, available: false, scenes: [], previewDocuments: [recipe], job: null, reason: 'tool_missing' } };
    },
  });
  const controller = h.runtime.setupProjectBuild({ getContext: () => context,
    getCompositionSource: options.source || (async () => ({ sourcePath: path, baseSourceRevision: base, content: '{}' })),
    applyCompositionFragmentDraft: async (...args) => { applied.push(args); return options.apply ? options.apply(...args) : { applied: true, focus() {} }; } });
  controller.setAvailable(true, [], { scenePreview: true }); h.element('projectBuildBtn').click(); await flushDialogs();
  h.element('projectBuildTabPreview').click(); await flushDialogs();
  t.after(() => { h.element('projectBuildDialog').close(); });
  return { ...h, preview, override, layout, layoutOpened, calls, opened, applied, context };
}
const input = () => ({ model: { composition: {}, scene: { objectId: recipeId, sourcePath: path } }, actorId: instanceId, isCurrent: () => true });

// This file tests the actual parent with a child callback spy. Actual deletion,
// image dependency checks and editor persistence are independently exercised.
test('reset-only candidates send full exact source and release the candidate preview lease', async t => {
  const h = await fixture(t), request = candidate();
  assert.equal((await h.layout.validateDraft(request)).ok, true);
  const post = h.calls.find(call => call.request?.method === 'POST');
  assert.deepEqual(JSON.parse(post.request.body), { sceneId: recipeId,
    draft: { sourcePath: path, baseSourceRevision: base, content: request.afterContent } });
  assert.ok(h.calls.some(call => call.request?.method === 'DELETE' && call.url.includes(previewId)));
  assert.equal(h.applied.length, 0);
});

test('a reset that exposes an unavailable projection image cannot get candidate approval', async t => {
  const payload = checked(); payload.ok = false;
  payload.diagnostics = [{ code: 'scene_image_missing', message: 'The restored projection image is unavailable.' }];
  const h = await fixture(t, { validate: async () => ({ payload }) });
  await assert.rejects(h.layout.validateDraft(candidate()), { errorCode: 'scene_composition_override_invalid' });
  assert.ok(h.calls.some(call => call.request?.method === 'DELETE')); assert.equal(h.applied.length, 0);
});

test('reset-only candidates still require every linked actor and exact ordered source provenance', async t => {
  for (const alter of [p => p.actors.pop(), p => p.sourceLocations.actors.pop(),
    p => p.sourceLocations.actors.reverse(), p => { p.sourceLocations.actors[1].composition.localKey = 'leader'; }]) {
    const payload = checked(); alter(payload);
    const h = await fixture(t, { validate: async () => ({ payload }) });
    await assert.rejects(h.layout.validateDraft(candidate()), { errorCode: 'scene_composition_override_invalid' });
    assert.equal(h.applied.length, 0); assert.ok(h.calls.some(call => call.request?.method === 'DELETE'));
  }
});

test('source ownership changes while reviewing a reset invalidate approval and release its lease', async t => {
  const pending = deferred(), h = await fixture(t, { validate: () => pending.promise });
  const reviewing = h.layout.validateDraft(candidate()); h.context.sceneDraftToken = 'source:2';
  pending.resolve({ payload: checked() });
  await assert.rejects(reviewing, { errorCode: 'scene_composition_override_conflict' });
  assert.equal(h.applied.length, 0); assert.ok(h.calls.some(call => call.request?.method === 'DELETE'));
});

test('completion binds the exact reset list and same host receipt while allowing legal token advance', async t => {
  const h = await fixture(t), request = candidate();
  const result = await h.layout.applySourceDraft(request);
  const changed = JSON.parse(JSON.stringify(request)); changed.reset = ['color'];
  h.layout.sourceApplied(result, changed);
  assert.equal(h.element('projectBuildDialog').open, true);
  h.context.sceneDraftToken = 'source:2';
  h.layout.sourceApplied(result, JSON.parse(JSON.stringify(request)));
  assert.equal(h.element('projectBuildDialog').open, false);
});
