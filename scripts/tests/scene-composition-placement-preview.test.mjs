import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash, webcrypto } from 'node:crypto';
import { resolveSceneCompositionPreview } from '../../engine/scene-composition-preview.mjs';
import { createWorldProjection } from '../../engine/world-projection.mjs';
import { scene2DModelToPlan } from '../../engine/build-plan.mjs';
import { createSceneStructure } from '../../engine/scene-structure.mjs';
import { dialogHarness, flushDialogs } from './dialog-harness.mjs';
import { deferred } from './editor-harness.mjs';

const golden = JSON.parse(await fs.readFile(new URL('./fixtures/scene-model/legacy-plan-v1.json', import.meta.url), 'utf8'));
const example = JSON.parse(await fs.readFile(new URL('../../examples/scene-composition/recipe.json', import.meta.url), 'utf8'));
const hash = text => createHash('sha256').update(text).digest('hex'), revision = text => `sha256:${hash(text)}`;
const copy = value => JSON.parse(JSON.stringify(value)), { ids } = golden;
const previewId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
async function fixture({ dirty = false, inherit = true, overrideValues = {} } = {}) {
  const observed = copy(golden.observed), recipe = copy(example);
  observed.source.workspace.version = 3; observed.source.definition = { documentTypes: [{ id: 'document', label: 'Document' }] };
  recipe.fragments[0].actors[0] = { key: 'leader', objectId: ids.first, groupKey: 'party', position: [120, 180], useProjectionDefaults: true };
  recipe.fragments[0].actors[1].objectId = ids.first;
  Object.assign(recipe.placements[1].overrides[0].values, overrideValues);
  if (!inherit) recipe.fragments[0].actors[0] = { ...recipe.fragments[0].actors[0], useProjectionDefaults: false,
    size: [80, 60], color: '#ffffff', speed: 160, controls: 'arrows', imageResourceId: ids.image };
  const source = observed.source.documents.find(item => item.record.id === ids.scene);
  source.record.relations = []; source.record.assetBindings = [];
  source.content = '\uFEFF' + JSON.stringify(recipe, null, '\t').replaceAll('\n', '\r\n') + '\r\n'; source.sourceRevision = revision(source.content);
  for (const document of observed.source.documents) document.descriptor = { ...document.record };
  observed.projection = await createWorldProjection(observed.source, { digest: hash });
  const resolved = await resolveSceneCompositionPreview(observed, ids.scene, { digest: hash });
  assert.equal(resolved.ok, true, JSON.stringify(resolved.diagnostics));
  const plan = scene2DModelToPlan(resolved.model), baseSourceRevision = dirty ? `sha256:${'b'.repeat(64)}` : source.sourceRevision;
  const model = { ok: true, format: 'viento-scene-preview', schemaVersion: 2, previewId,
    scene: plan.scene, actors: plan.actors, composition: resolved.composition, sourceLocations: resolved.model.sourceLocations,
    sceneStructure: createSceneStructure(resolved.model), resources: [], diagnostics: [],
    ...(dirty ? { draft: { baseSourceRevision, sourceRevision: source.sourceRevision } } : {}) };
  return { model, recipe, observed, source: { sourcePath: source.sourcePath, content: source.content, baseSourceRevision }, instanceId: model.actors[2].instanceId,
    images: [{ id: ids.image, name: 'Traveler portrait', path: 'portraits/traveler.svg' }] };
}
async function previewHarness(t) {
  const value = await fixture(), context = { editable: true, dirty: false, busy: false, creating: false, previewKind: 'composition',
    canEditCompositionOverride: true, canEditCompositionLayout: true, canEditCompositionBatchLayout: true, canEditCompositionFragment: true, canEditCompositionPlacement: true, compositionSourceWritable: true, canPreviewDraft: true, sceneDraftPath: value.source.sourcePath, sceneDraftToken: 1 };
  const calls = [], opened = [], layouts = [], batches = [], fragments = [], placements = [], writes = []; let result = true;
  const h = await dialogHarness('app-scene-preview', { SCENE_PREVIEW_API_PATH: '/api/scene-preview',
    createScenePreviewCanvas: () => Object.fromEntries(['setScene', 'setImages', 'setVisible', 'select', 'fit', 'zoom', 'setGrid', 'destroy'].map(name => [name, () => {}])),
    fetchJsonApiRequest: (url, request) => { const wait = deferred(); calls.push({ url, request, ...wait }); if (request.method === 'DELETE') wait.resolve({ payload: { ok: true } }); return wait.promise; } });
  const container = h.document.createElement('section'); h.document.body.append(container);
  const controller = h.runtime.setupScenePreview({ container, getContext: () => context, getDraft: async () => value.source,
    editCompositionOverride: input => { opened.push(input); return result; }, editCompositionLayout: input => { layouts.push(input); return result; }, editCompositionBatchLayout: input => { batches.push(input); return result; }, editCompositionFragment: input => { fragments.push(input); return result; }, editCompositionPlacement: input => { placements.push(input); return result; }, editScene: () => writes.push('scene'), editLayout: () => writes.push('layout'), editDraftLayout: () => writes.push('draft-layout') });
  const resolve = async payload => { calls.filter(call => call.request.method === 'POST').at(-1).resolve({ payload }); await flushDialogs(); };
  t.after(() => controller.destroy()); controller.setAvailable(true); controller.setScene(ids.scene); controller.setVisible(true); await resolve(value.model);
  h.element('scenePreviewObjects').querySelector(`button[data-actor-id="${value.instanceId}"]`).click();
  return { ...h, value, context, container, controller, opened, layouts, batches, fragments, placements, writes, resolve, setResult: v => { result = v; } };
}

test('the placement action requires the current source-bound selected recipe instance and independent capability', async t => {
  const h = await previewHarness(t), button = h.element('scenePreviewCompositionPlacement');
  assert.equal(button.hidden, false); assert.equal(button.disabled, false); button.click(); await flushDialogs();
  assert.equal(h.placements.length, 1); assert.equal(h.placements[0].actorId, h.value.instanceId); assert.equal(h.placements[0].isCurrent(), true);
  for (const [key, value] of [['dirty', true], ['compositionSourceWritable', false], ['canEditCompositionPlacement', false], ['busy', true], ['sceneDraftPath', 'other.json']]) {
    const previous = h.context[key]; h.context[key] = value; h.controller.setScene(ids.scene);
    assert.equal(button.disabled, true); button.dispatch('click'); await flushDialogs(); h.context[key] = previous;
  }
  assert.equal(h.placements.length, 1); assert.equal(h.writes.length, 0);
});

test('a pending placement opening blocks every composition entry and a late rejection cannot revive a hidden preview', async t => {
  const h = await previewHarness(t), waiting = deferred(); h.setResult(waiting.promise);
  h.element('scenePreviewCompositionPlacement').click(); h.element('scenePreviewCompositionPlacement').dispatch('click');
  for (const id of ['scenePreviewCompositionOverride', 'scenePreviewCompositionLayout', 'scenePreviewCompositionBatchLayout', 'scenePreviewCompositionFragment']) h.element(id).dispatch('click');
  assert.equal(h.placements.length, 1); assert.equal(h.opened.length, 0); assert.equal(h.layouts.length, 0); assert.equal(h.batches.length, 0); assert.equal(h.fragments.length, 0);
  h.controller.setVisible(false); assert.equal(h.placements[0].isCurrent(), false); waiting.reject(Error('Late opening')); await flushDialogs();
  assert.equal(h.container.dataset.scenePreviewState, 'empty'); assert.equal(h.writes.length, 0);
});

test('changing selected actors or source tokens invalidates placement ownership', async t => {
  const h = await previewHarness(t); h.element('scenePreviewCompositionPlacement').click(); await flushDialogs(); const input = h.placements[0];
  h.element('scenePreviewObjects').querySelector(`button[data-actor-id="${h.value.model.actors[0].instanceId}"]`).click(); assert.equal(input.isCurrent(), false);
  h.element('scenePreviewObjects').querySelector(`button[data-actor-id="${h.value.instanceId}"]`).click(); assert.equal(input.isCurrent(), true);
  h.context.sceneDraftToken = 2; assert.equal(input.isCurrent(), false);
});

test('other pending composition operations exclude placement opening', async t => {
  for (const id of ['scenePreviewCompositionOverride', 'scenePreviewCompositionLayout', 'scenePreviewCompositionBatchLayout', 'scenePreviewCompositionFragment']) {
    const h = await previewHarness(t), waiting = deferred(); h.setResult(waiting.promise);
    h.element(id).click(); h.element('scenePreviewCompositionPlacement').dispatch('click'); assert.equal(h.placements.length, 0);
    waiting.resolve(true); await flushDialogs(); h.controller.destroy();
  }
});
