import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import { dialogHarness, flushDialogs } from './dialog-harness.mjs';
import { deferred } from './editor-harness.mjs';
import { PROJECT_BUILD_API_PATH } from '../../engine/project-build-contract.mjs';

const recipeId = '11111111-1111-4111-8111-111111111111', instanceId = '22222222-2222-4222-8222-222222222222';
const previewId = '33333333-3333-4333-8333-333333333333', secondId = '55555555-5555-4555-8555-555555555555';
const placementId = '66666666-6666-4666-8666-666666666666', groupId = '77777777-7777-4777-8777-777777777777';
const path = 'documents/scenes/recipe.json', base = 'sha256:' + 'a'.repeat(64);
const recipe = { id: recipeId, kind: 'composition', title: 'Recipe', sourcePath: path };
const candidate = () => ({ sceneId: recipeId, sourcePath: path, baseSourceRevision: base, instanceId, placementId,
  fragmentId: 'party', offset: null, targets: [{ instanceId, actorKey: 'leader' }, { instanceId: secondId, actorKey: 'companion' }],
  groups: [{ groupId, groupKey: 'party' }], afterContent: '{"candidate":"原文😀"}' });
function checked(p = candidate()) {
  const hash = 'sha256:' + createHash('sha256').update(p.afterContent).digest('hex');
  return { ok: true, format: 'viento-scene-preview', schemaVersion: 2, previewId,
    scene: { objectId: recipeId, sourcePath: path, sourceRevision: hash }, actors: p.targets.map(t => ({ instanceId: t.instanceId })), sceneStructure: { groups: p.groups.map(g => ({ groupId: g.groupId })) },
    sourceLocations: { actors: p.targets.map(t => ({ instanceId: t.instanceId, composition: { fragmentId: p.fragmentId, placementId, localKey: t.actorKey } })),
      groups: p.groups.map(g => ({ groupId: g.groupId, composition: { fragmentId: p.fragmentId, placementId, localKey: g.groupKey } })) },
    draft: { baseSourceRevision: base, sourceRevision: hash },
    composition: { format: 'viento-scene-composition-preview', schemaVersion: 1, recipeObjectId: recipeId, sourcePath: path, sourceRevision: hash, fragmentCount: 1, placementCount: 2 } };
}
async function fixture(t, options = {}) {
  const calls = [], opened = [], applied = [], invalidations = [];
  const context = { editable: true, dirty: false, creating: false, busy: false, path,
    sceneDraftPath: path, sceneDraftToken: 'source:1', compositionSourceWritable: true };
  let preview, child;
  const h = await dialogHarness('app-project-build', {
    crypto: webcrypto, PROJECT_BUILD_API_PATH, SCENE_PREVIEW_API_PATH: '/api/scene-preview',
    supportsStudioCoreCompositionPlacement: () => options.supported !== false,
    setupScenePreview: config => { preview = config; return { setAvailable() {}, setScene() {}, setVisible() {}, invalidate() { invalidations.push(true); } }; },
    setupSceneCompositionPlacement: config => { child = config; return { open: input => { opened.push(input); return true; }, refresh() {} }; },
    fetchJsonApiRequest: async (url, request) => {
      calls.push({ url, request });
      if (url.startsWith('/api/scene-preview')) return request.method === 'DELETE' ? { payload: { ok: true } } : options.validate ? options.validate(url, request) : { payload: checked() };
      return { payload: { supported: true, available: false, scenes: [], previewDocuments: [recipe], job: null, reason: 'tool_missing' } };
    },
  });
  const controller = h.runtime.setupProjectBuild({ getContext: () => context,
    getCompositionSource: options.source || (async () => ({ sourcePath: path, baseSourceRevision: base, content: '{}' })),
    applyCompositionPlacementDraft: async (...args) => { applied.push(args); return options.apply ? options.apply(...args) : { applied: true, focus() {} }; } });
  controller.setAvailable(true, [], { scenePreview: true }); h.element('projectBuildBtn').click(); await flushDialogs();
  h.element('projectBuildTabPreview').click(); await flushDialogs(); t.after(() => h.element('projectBuildDialog').close());
  return { ...h, preview, child, opened, calls, applied, context, invalidations };
}
const input = () => ({ model: { composition: {}, scene: { objectId: recipeId, sourcePath: path } }, actorId: instanceId, isCurrent: () => true });

test('the placement child opens only against the active source and its independent capability, without requesting a media catalog', async t => {
  const h = await fixture(t); assert.equal(await h.preview.editCompositionPlacement(input()), true); assert.equal(h.opened.length, 1);
  assert.equal(h.opened[0].source.sourcePath, path); assert.equal(h.opened[0].isCurrent(), true); assert.equal(h.calls.some(c => c.url === '/api/world'), false);
  h.context.sceneDraftPath = 'other.json'; assert.equal(await h.preview.editCompositionPlacement(input()), false);
  const absent = await fixture(t, { supported: false }); assert.equal(await absent.preview.editCompositionPlacement(input()), false); assert.equal(absent.opened.length, 0);
});

test('late source acquisition cannot open a placement editor under a new owner', async t => {
  const pending = deferred(), h = await fixture(t, { source: () => pending.promise });
  const opening = h.preview.editCompositionPlacement(input()); h.context.sceneDraftPath = 'other.json';
  pending.resolve({ sourcePath: path, baseSourceRevision: base, content: '{}' }); assert.equal(await opening, false); assert.equal(h.opened.length, 0);
});

test('offset restoration validates the full exact candidate and releases the temporary preview lease', async t => {
  const h = await fixture(t), request = candidate(); assert.equal((await h.child.validateDraft(request)).ok, true);
  assert.deepEqual(JSON.parse(h.calls.find(c => c.request?.method === 'POST').request.body), { sceneId: recipeId,
    draft: { sourcePath: path, baseSourceRevision: base, content: request.afterContent } });
  assert.ok(h.calls.some(c => c.request?.method === 'DELETE' && c.url.includes(previewId))); assert.equal(h.applied.length, 0);
});

test('placement approval requires exact actor and group identities, count, fragment provenance and source order', async t => {
  for (const alter of [p => p.actors.pop(), p => p.actors.push(p.actors[0]), p => p.sceneStructure.groups.pop(), p => p.sceneStructure.groups.push(p.sceneStructure.groups[0]),
    p => p.sourceLocations.actors.pop(), p => p.sourceLocations.actors.reverse(), p => p.sourceLocations.groups.pop(),
    p => { p.sourceLocations.actors[1].composition.fragmentId = 'foreign'; }, p => { p.sourceLocations.groups[0].composition.localKey = 'foreign'; },
    p => { p.sourceLocations.groups[0].composition.placementId = recipeId; }]) {
    const payload = checked(); alter(payload); const h = await fixture(t, { validate: async () => ({ payload }) });
    await assert.rejects(h.child.validateDraft(candidate()), { errorCode: 'scene_composition_override_invalid' }); assert.equal(h.applied.length, 0);
    assert.ok(h.calls.some(c => c.request?.method === 'DELETE'));
  }
});

test('zero-group placements remain valid while extra related provenance is rejected', async t => {
  const request = candidate(); request.groups = []; const payload = checked(request);
  const h = await fixture(t, { validate: async () => ({ payload }) }); assert.equal((await h.child.validateDraft(request)).ok, true);
  payload.sourceLocations.groups.push({ groupId, composition: { placementId, fragmentId: 'party', localKey: 'party' } });
  await assert.rejects(h.child.validateDraft(request), { errorCode: 'scene_composition_override_invalid' });
});

test('dependency failure and owner changes during preview cannot approve or apply an offset', async t => {
  const bad = checked(); bad.ok = false; bad.diagnostics = [{ code: 'scene_image_missing' }];
  const first = await fixture(t, { validate: async () => ({ payload: bad }) });
  await assert.rejects(first.child.validateDraft(candidate()), { errorCode: 'scene_composition_override_invalid' }); assert.equal(first.applied.length, 0);
  const pending = deferred(), h = await fixture(t, { validate: () => pending.promise });
  const reviewing = h.child.validateDraft(candidate()); h.context.sceneDraftToken = 'source:2'; pending.resolve({ payload: checked() });
  await assert.rejects(reviewing, { errorCode: 'scene_composition_override_conflict' }); assert.ok(h.calls.some(c => c.request?.method === 'DELETE'));
});

test('completion binds the complete offset and targets proposal plus the identical host receipt', async t => {
  const h = await fixture(t), request = candidate(), result = await h.child.applySourceDraft(request);
  for (const alter of [p => { p.offset = [0, 0]; }, p => { p.groups = []; }, p => { p.targets.reverse(); }]) {
    const forged = structuredClone(request); alter(forged); h.child.sourceApplied(result, forged); assert.equal(h.element('projectBuildDialog').open, true);
  }
  h.child.sourceApplied({ ...result }, request); assert.equal(h.element('projectBuildDialog').open, true);
  h.context.sceneDraftToken = 'source:2'; h.child.sourceApplied(result, structuredClone(request)); assert.equal(h.element('projectBuildDialog').open, false);
});
