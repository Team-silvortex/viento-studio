import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash, webcrypto } from 'node:crypto';
import { dialogHarness, flushDialogs } from './dialog-harness.mjs';
import { deferred } from './editor-harness.mjs';
import { expandSceneComposition } from '../../engine/scene-composition.mjs';
import { dispatchStudioCoreCompositionStructure } from '../../engine/studio-core.mjs';
import { PROJECT_BUILD_API_PATH } from '../../engine/project-build-contract.mjs';

const recipe = JSON.parse(await fs.readFile(new URL('../../examples/scene-composition/recipe.json', import.meta.url), 'utf8'));
const sceneId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', previewId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const sourcePath = 'documents/scenes/recipe.json', content = JSON.stringify(recipe, null, 2);
const hash = value => 'sha256:' + createHash('sha256').update(value).digest('hex'), base = hash(content);
function proposal(action = 'remove', raw = content) {
  const edit = action === 'remove' ? { action, fragmentId: 'party', actorKey: 'leader' }
    : { action, fragmentId: 'party', actor: { key: 'third', objectId: recipe.fragments[0].actors[0].objectId,
      position: [250, 180], size: [32, 32], color: '#ffffff', speed: 0, controls: 'none' },
      instances: recipe.placements.map((p, i) => ({ placementId: p.placementId, instanceId: `9000000${i}-1111-4111-8111-111111111111` })) };
  const result = dispatchStudioCoreCompositionStructure({ protocolVersion: 1, operation: action === 'remove' ? 'sceneComposition.removeFragmentActor' : 'sceneComposition.addFragmentActor', content: raw,
    fragmentId: edit.fragmentId, ...(action === 'remove' ? { actorKey: edit.actorKey } : { actor: edit.actor, instances: edit.instances }) });
  return { sceneId, sourcePath, baseSourceRevision: base, sourceRevision: hash(raw), edit,
    targets: action === 'remove' ? recipe.placements.map(p => ({ placementId: p.placementId, instanceId: p.actorIds.leader, actorKey: 'leader', overrides: [] }))
      : edit.instances.map(p => ({ ...p, actorKey: 'third', overrides: [] })), ...result };
}
function checked(p) {
  const after = expandSceneComposition(p.afterContent), revision = hash(p.afterContent), parsed = JSON.parse(p.afterContent);
  return { ok: true, format: 'viento-scene-preview', schemaVersion: 2, previewId,
    scene: { objectId: sceneId, sourcePath, sourceRevision: revision }, actors: after.scene.actors,
    sceneStructure: { groups: after.scene.groups },
    sourceLocations: Object.fromEntries(['actors', 'groups'].map(kind => [kind, after.sourceMap[kind].map((entry, i) => ({
      [kind === 'actors' ? 'instanceId' : 'groupId']: entry[kind === 'actors' ? 'instanceId' : 'groupId'],
      ...(kind === 'actors' ? { objectId: after.scene.actors[i].objectId } : {}),
      composition: { fragmentId: entry.fragmentId, placementId: entry.placementId, localKey: entry.localKey },
      declaration: { objectId: sceneId, sourcePath, sourceRevision: revision } }))])),
    draft: { baseSourceRevision: base, sourceRevision: revision },
    composition: { format: 'viento-scene-composition-preview', schemaVersion: 1, recipeObjectId: sceneId, sourcePath, sourceRevision: revision,
      fragmentCount: parsed.fragments.length, placementCount: parsed.placements.length } };
}
async function fixture(t, options = {}) {
  const calls = [], opened = [], applied = [];
  const context = { editable: true, dirty: false, creating: false, busy: false, sceneDraftPath: sourcePath, sceneDraftToken: 'source:1', compositionSourceWritable: true };
  let preview, child;
  const p = options.proposal || proposal();
  const h = await dialogHarness('app-project-build', {
    crypto: webcrypto, expandSceneComposition, WORLD_API_PATH: '/api/world', PROJECT_BUILD_API_PATH, SCENE_PREVIEW_API_PATH: '/api/scene-preview',
    supportsStudioCoreCompositionStructure: () => options.supported !== false,
    setupScenePreview: config => { preview = config; return { setAvailable() {}, setScene() {}, setVisible() {}, invalidate() {} }; },
    setupSceneCompositionStructure: config => { child = config; return { open: input => { opened.push(input); return true; }, refresh() {} }; },
    fetchJsonApiRequest: async (url, request) => {
      calls.push({ url, request });
      if (url.startsWith('/api/scene-preview')) return request.method === 'DELETE' ? { payload: { ok: true } } : options.validate ? options.validate() : { payload: checked(p) };
      if (url === '/api/world') return { payload: options.catalog || { objects: [], resources: [] } };
      return { payload: { supported: true, available: false, scenes: [], previewDocuments: [{ id: sceneId, kind: 'composition', title: 'Recipe', sourcePath }], job: null, reason: 'tool_missing' } };
    },
  });
  const controller = h.runtime.setupProjectBuild({ getContext: () => context,
    getCompositionSource: options.source || (async () => ({ sourcePath, baseSourceRevision: base, content })),
    applyCompositionStructureDraft: async (...args) => { applied.push(args); return options.apply ? options.apply(...args) : { applied: true, focus() {} }; } });
  controller.setAvailable(true, [], { scenePreview: true }); h.element('projectBuildBtn').click(); await flushDialogs();
  h.element('projectBuildTabPreview').click(); await flushDialogs(); t.after(() => h.element('projectBuildDialog').close());
  return { ...h, context, preview, child, calls, opened, applied, p };
}
const input = () => ({ model: { composition: {}, scene: { objectId: sceneId, sourcePath } }, actorId: recipe.placements[0].actorIds.leader, isCurrent: () => true });

test('structure opens independently of selected actor and execution availability, with a registered object/media catalog', async t => {
  const registered = id => ({ id, name: 'Actor', provenance: { identity: 'registered' }, documentRefs: [{ sourcePath: 'documents/actor.md', sourceRevision: base }] });
  const actor = registered(recipe.fragments[0].actors[0].objectId), broken = registered('77777777-7777-4777-8777-777777777777');
  const h = await fixture(t, { catalog: { objects: [actor, registered(sceneId), broken, { ...actor, id: 'not-uuid' }],
    diagnostics: [{ objectId: broken.id, severity: 'error' }], resources: [] } });
  assert.equal(await h.preview.editCompositionStructure({ ...input(), actorId: null }), true);
  assert.deepEqual(JSON.parse(JSON.stringify(h.opened[0].objects)), [{ id: actor.id, name: 'Actor', sourcePath: 'documents/actor.md' }]);
  assert.equal(h.opened[0].isCurrent(), true); assert.equal(h.calls.filter(c => c.url === '/api/world').length, 1);
  h.context.sceneDraftPath = 'other.json'; assert.equal(await h.preview.editCompositionStructure(input()), false);
  const old = await fixture(t, { supported: false }); assert.equal(await old.preview.editCompositionStructure(input()), false);
});

test('late source and catalog acquisition cannot open under a replaced source owner', async t => {
  const pending = deferred(), h = await fixture(t, { source: () => pending.promise });
  const opening = h.preview.editCompositionStructure(input()); h.context.sceneDraftPath = 'other.json';
  pending.resolve({ sourcePath, baseSourceRevision: base, content }); assert.equal(await opening, false); assert.equal(h.opened.length, 0);
});

test('remove can approve a full candidate where the selected opener is absent; add validates new identities', async t => {
  for (const action of ['remove', 'add']) {
    const p = proposal(action), h = await fixture(t, { proposal: p });
    assert.equal((await h.child.validateDraft(p)).ok, true); assert.equal(h.applied.length, 0);
    assert.deepEqual(JSON.parse(h.calls.find(c => c.request?.method === 'POST').request.body), { sceneId, draft: { sourcePath, baseSourceRevision: base, content: p.afterContent } });
    assert.ok(h.calls.some(c => c.request?.method === 'DELETE' && c.url.includes(previewId)));
  }
});

test('whole candidate actor/group identities, definitions, provenance and recipe counts must match exact expansion', async t => {
  for (const alter of [p => p.actors.pop(), p => p.actors.push(p.actors[0]), p => p.sceneStructure.groups.pop(),
    p => p.sourceLocations.actors.reverse(), p => p.sourceLocations.groups.reverse(), p => { p.sourceLocations.actors[0].objectId = sceneId; },
    p => { p.actors[0].objectId = sceneId; }, p => { p.sourceLocations.actors[0].composition.localKey = 'foreign'; },
    p => { p.sourceLocations.groups[0].composition.fragmentId = 'foreign'; }, p => { p.sourceLocations.groups[0].declaration.sourceRevision = base; },
    p => { p.composition.fragmentCount++; }, p => { p.composition.placementCount++; }, p => { p.sourceLocations.actors[0].declaration.sourcePath = 'elsewhere.json'; }]) {
    const request = proposal(), payload = checked(request); alter(payload);
    const h = await fixture(t, { validate: async () => ({ payload }) });
    await assert.rejects(h.child.validateDraft(request), { errorCode: 'scene_composition_override_invalid' });
    assert.ok(h.calls.some(c => c.request?.method === 'DELETE')); assert.equal(h.applied.length, 0);
  }
});

test('unused fragment edits validate even when the effective actor set stays the same', async t => {
  const value = structuredClone(recipe); value.fragments.push({ fragmentId: 'unused', groups: [], actors: [{ ...value.fragments[0].actors[0], key: 'alone', groupKey: undefined }] });
  const raw = JSON.stringify(value), actor = { ...value.fragments[1].actors[0], key: 'second' }; delete actor.groupKey;
  const patch = dispatchStudioCoreCompositionStructure({ protocolVersion: 1, operation: 'sceneComposition.addFragmentActor', content: raw, fragmentId: 'unused', actor, instances: [] });
  const p = { ...proposal(), edit: { action: 'add', fragmentId: 'unused', actor, instances: [] }, targets: [], sourceRevision: hash(raw), ...patch };
  const h = await fixture(t, { proposal: p }); assert.equal((await h.child.validateDraft(p)).ok, true);
});

test('resource failures and source owner changes during asynchronous validation cannot approve', async t => {
  const p = proposal(), invalid = checked(p); invalid.ok = false;
  const first = await fixture(t, { validate: async () => ({ payload: invalid }) });
  await assert.rejects(first.child.validateDraft(p)); assert.equal(first.applied.length, 0);
  const pending = deferred(), h = await fixture(t, { validate: () => pending.promise });
  const checking = h.child.validateDraft(p); h.context.sceneDraftToken = 'source:2'; pending.resolve({ payload: checked(p) });
  await assert.rejects(checking, { errorCode: 'scene_composition_override_conflict' }); assert.ok(h.calls.some(c => c.request?.method === 'DELETE'));
});

test('apply completion binds the identical host receipt and complete structural edit before returning to source', async t => {
  const h = await fixture(t), p = proposal(), receipt = await h.child.applySourceDraft(p);
  const forged = structuredClone(p); forged.edit.actorKey = 'companion';
  h.child.sourceApplied(receipt, forged); assert.equal(h.element('projectBuildDialog').open, true);
  h.child.sourceApplied({ ...receipt }, p); assert.equal(h.element('projectBuildDialog').open, true);
  h.child.sourceApplied(receipt, p); assert.equal(h.element('projectBuildDialog').open, false);
});
