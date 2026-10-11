import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import { dialogHarness } from './dialog-harness.mjs';

const sceneId = '11111111-1111-4111-8111-111111111111', objectId = '22222222-2222-4222-8222-222222222222';
const instanceId = '33333333-3333-4333-8333-333333333333', previewId = '44444444-4444-4444-8444-444444444444';
const resourceId = '55555555-5555-4555-8555-555555555555', sourcePath = 'documents/recipe.json';
const revision = value => 'sha256:' + createHash('sha256').update(value).digest('hex');
const names = ['Override', 'Layout', 'BatchLayout', 'Fragment', 'Placement', 'Structure', 'Placements', 'Groups', 'Definitions'];
const copy = value => JSON.parse(JSON.stringify(value));
const source = { sourcePath, baseSourceRevision: revision('{}'), content: '{}' };
const proposal = () => ({ sceneId, sourcePath, baseSourceRevision: source.baseSourceRevision,
  sourceRevision: source.baseSourceRevision, instanceId, afterContent: '{ }', changedPaths: ['/placements/0/overrides'] });
const input = () => ({ model: { composition: {}, scene: { objectId: sceneId, sourcePath } }, actorId: instanceId, isCurrent: () => true });
async function fixture(options = {}) {
  const handlers = {}, opened = [], calls = [], applies = [], notified = [];
  const state = { open: true, session: 1, selected: sceneId, sourcePath, previewSupported: true, previewActive: true,
    requestBusy: false, running: false, context: { editable: true, creating: false, busy: false, compositionSourceWritable: true,
      sceneDraftPath: sourcePath, sceneDraftToken: 1, unrelatedFeature: 'private backend state' } };
  const setups = Object.fromEntries(names.map(name => [`setupSceneComposition${name === 'Override' ? 'Overrides' : name === 'Fragment' ? 'Fragments' : name}`, value => {
    handlers[name] = value; return { open(data) { opened.push({ name, data }); return true; }, refresh() {} };
  }]));
  const h = await dialogHarness('app-scene-authoring', { crypto: webcrypto, supportsStudioCoreCompositionPlacements: () => true, supportsStudioCoreCompositionGroups: () => true, supportsStudioCoreCompositionDefinitions: () => true, ...setups });
  const controller = h.runtime.setupSceneAuthoring({ getState: () => state, getSource: async () => source,
    applyActions: Object.fromEntries(['instance', 'positions', 'fragment', 'placement', 'structure', 'placements', 'groups', 'definitions'].map(kind => [kind, async (value, guard) => {
      assert.equal(guard.isCurrent(), true); applies.push({ kind, value }); state.context.sceneDraftToken++;
      return { applied: true, focus() {} };
    }])), onApplied: (...values) => notified.push(values),
    request: async (url, request, timeout, message) => {
      calls.push({ url, request, timeout, message });
      if (url === '/api/world') return { payload: { objects: [
        { id: objectId, name: 'Actor', provenance: { identity: 'registered' }, documentRefs: [{ sourcePath: 'documents/actor.md', sourceRevision: revision('actor') }] },
        { id: sceneId, name: 'Recipe', provenance: { identity: 'registered' }, documentRefs: [{ sourcePath, sourceRevision: source.baseSourceRevision }] },
      ], resources: [{ id: resourceId, descriptor: { kind: 'image', name: 'Portrait', location: { path: 'portrait.svg' } }, availability: 'present-unverified' }], diagnostics: [] } };
      if (request.method === 'DELETE') return { payload: { ok: true } };
      const body = JSON.parse(request.body), hash = revision(body.draft.content);
      return { payload: { ok: true, format: 'viento-scene-preview', schemaVersion: 2, previewId,
        scene: { objectId: sceneId, sourcePath, sourceRevision: hash },
        composition: { format: 'viento-scene-composition-preview', schemaVersion: 1, recipeObjectId: sceneId,
          sourcePath, sourceRevision: hash, fragmentCount: 1, placementCount: 1 },
        draft: { baseSourceRevision: source.baseSourceRevision, sourceRevision: hash }, actors: [{ objectId, instanceId }] } };
    }, ...options });
  return { ...h, controller, handlers, opened, calls, applies, notified, state };
}

test('the nine editors receive only their own capability and source context; catalog ports are lazy and independent', async () => {
  const h = await fixture();
  assert.equal(Object.values(h.controller.previewContext()).every(Boolean), true);
  for (const name of names) {
    const context = h.handlers[name].getContext();
    assert.deepEqual(Object.keys(context).sort(), ['editable', 'creating', 'busy', 'compositionSourceWritable', 'sceneDraftPath', 'sceneDraftToken', `canEditComposition${name}`].sort());
    assert.equal(context[`canEditComposition${name}`], true);
    assert.equal(await h.controller.previewActions[`editComposition${name}`](input()), true);
  }
  assert.equal(h.calls.length, 4); assert.equal(h.opened.length, 9);
  for (const name of ['Override', 'Fragment', 'Structure', 'Definitions']) assert.equal(h.opened.find(v => v.name === name).data.images[0].id, resourceId);
  const catalog = h.opened.find(v => v.name === 'Structure').data;
  assert.deepEqual(copy(catalog.objects).map(v => v.id), [objectId]);
  assert.deepEqual(copy(h.opened.find(v => v.name === 'Definitions').data.objects).map(v => v.id), [objectId]);
  for (const name of ['Layout', 'BatchLayout', 'Placement', 'Placements', 'Groups']) assert.equal(Object.hasOwn(h.opened.find(v => v.name === name).data, 'images'), false);
  assert.equal(h.applies.length, 0); assert.equal(h.notified.length, 0);
});

test('browser adapter submits the exact source draft and releases the returned preview for each independent instance editor', async () => {
  const h = await fixture(), value = proposal();
  for (const name of ['Override', 'Layout']) assert.equal((await h.handlers[name].validateDraft(value)).ok, true);
  const posts = h.calls.filter(v => v.request.method === 'POST'), releases = h.calls.filter(v => v.request.method === 'DELETE');
  assert.equal(posts.length, 2); assert.equal(releases.length, 2);
  for (const post of posts) assert.deepEqual(JSON.parse(post.request.body), { sceneId, draft: { sourcePath, baseSourceRevision: source.baseSourceRevision, content: value.afterContent } });
  assert.ok(releases.every(v => v.url.includes(previewId))); assert.equal(h.applies.length, 0);
});

test('each entry invokes its source operation and keeps completion receipts private from every sibling editor', async () => {
  for (const [index, name] of names.entries()) {
    const h = await fixture(), value = proposal(), result = await h.handlers[name].applySourceDraft(value);
    for (const other of names.filter(v => v !== name)) assert.equal(h.handlers[other].sourceApplied(result, value), false);
    assert.equal(h.notified.length, 0);
    assert.equal(h.handlers[name].sourceApplied(result, value), true); assert.equal(h.notified.length, 1);
    assert.equal(h.applies[0].kind, ['instance', 'instance', 'positions', 'fragment', 'placement', 'structure', 'placements', 'groups', 'definitions'][index]);
    assert.equal(h.handlers[name].sourceApplied(result, value), false);
    assert.deepEqual(copy(h.notified[0][2]), { session: 1, sceneId, sourcePath });
  }
});

test('closing the host invalidates pending completions and saved entry guards without granting new source authority', async () => {
  const h = await fixture(), value = proposal(), result = await h.handlers.Override.applySourceDraft(value);
  await h.controller.previewActions.editCompositionLayout(input()); const guard = h.opened.at(-1).data.isCurrent;
  assert.equal(guard(), true); h.controller.closed(); assert.equal(guard(), false);
  assert.equal(h.handlers.Override.sourceApplied(result, value), false); assert.equal(h.notified.length, 0);
  h.state.open = false;
  assert.ok(Object.values(h.controller.previewContext()).every(v => v === false));
  for (const name of names) assert.equal(await h.controller.previewActions[`editComposition${name}`](input()), false);
});

test('all entries refuse running, busy, wrong source or non-preview owners without reading catalogs', async () => {
  for (const change of [h => { h.state.running = true; }, h => { h.state.requestBusy = true; }, h => { h.state.previewActive = false; },
    h => { h.state.context.sceneDraftPath = 'documents/other.json'; }, h => { h.state.context.compositionSourceWritable = false; }]) {
    const h = await fixture(); change(h);
    for (const name of names) assert.equal(await h.controller.previewActions[`editComposition${name}`](input()), false);
    assert.equal(h.calls.length, 0); assert.equal(h.opened.length, 0); assert.equal(h.applies.length, 0);
  }
});
