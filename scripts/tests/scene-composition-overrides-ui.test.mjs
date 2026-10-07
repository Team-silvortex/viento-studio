import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash, webcrypto } from 'node:crypto';
import { createSceneCompositionOverrideDraft, prepareSceneCompositionOverrideApply } from '../../engine/scene-composition-overrides.mjs';
import { resolveSceneCompositionPreview } from '../../engine/scene-composition-preview.mjs';
import { createWorldProjection } from '../../engine/world-projection.mjs';
import { scene2DModelToPlan } from '../../engine/build-plan.mjs';
import { createSceneStructure } from '../../engine/scene-structure.mjs';
import { dialogHarness, flushDialogs } from './dialog-harness.mjs';
import { deferred } from './editor-harness.mjs';
import en from '../../web/i18n/en.js';
import ja from '../../web/i18n/ja.js';

const golden = JSON.parse(await fs.readFile(new URL('./fixtures/scene-model/legacy-plan-v1.json', import.meta.url), 'utf8'));
const example = JSON.parse(await fs.readFile(new URL('../../examples/scene-composition/recipe.json', import.meta.url), 'utf8'));
const hash = text => createHash('sha256').update(text).digest('hex'), revision = text => `sha256:${hash(text)}`;
const copy = value => JSON.parse(JSON.stringify(value)), { ids } = golden;
const previewId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
async function fixture({ dirty = false, inherit = true } = {}) {
  const observed = copy(golden.observed), recipe = copy(example);
  observed.source.workspace.version = 3; observed.source.definition = { documentTypes: [{ id: 'document', label: 'Document' }] };
  recipe.fragments[0].actors[0] = { key: 'leader', objectId: ids.first, groupKey: 'party', position: [120, 180], useProjectionDefaults: true };
  recipe.fragments[0].actors[1].objectId = ids.first;
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
async function settle(h) {
  for (let i = 0; i < 100; i++) {
    await flushDialogs(); if (h.el('Dialog').getAttribute('aria-busy') !== 'true') return;
    await new Promise(resolve => setTimeout(resolve, 1));
  }
  assert.fail('Override dialog stayed busy');
}
async function harness(t, options = {}) {
  const value = await fixture(options), validation = [], proposals = [], applied = [], requests = [];
  let memory = value.source.content, live = true;
  const context = { editable: true, dirty: Boolean(options.dirty), creating: false, busy: false, compositionSourceWritable: true,
    canEditCompositionOverride: true, sceneDraftPath: value.source.sourcePath, sceneDraftToken: 1 };
  const h = await dialogHarness('app-scene-composition-overrides', {
    crypto: webcrypto, queueMicrotask, createSceneCompositionOverrideDraft: options.factory || createSceneCompositionOverrideDraft,
    requestWorldCommand() { assert.fail('Instance override UI must not call World commands'); },
    fetchJsonApiRequest() { assert.fail('Only the parent dependency validator owns preview HTTP'); },
  });
  const controller = h.runtime.setupSceneCompositionOverrides({ getContext: () => context,
    validateDraft: async (proposal, guard) => { validation.push(proposal); requests.push(guard); return options.validate ? options.validate(proposal, guard) : { ok: true }; },
    applySourceDraft: async (proposal, guard) => {
      proposals.push(proposal); if (options.apply) return options.apply(proposal, guard, context);
      const prepared = await prepareSceneCompositionOverrideApply({ ...value.source, content: memory }, proposal, { digest: hash });
      if (!guard.isCurrent()) throw Object.assign(new Error('Stale editor'), { errorCode: 'scene_composition_override_conflict' });
      memory = prepared.afterContent; context.sceneDraftToken++; context.dirty = true; return { applied: true, focus() {} };
    }, sourceApplied: (result, proposal) => applied.push({ result, proposal }),
  });
  const el = suffix => h.element(`sceneCompositionOverrides${suffix}`);
  const open = (extra = {}) => controller.open({ ...value, isCurrent: () => live, ...extra });
  t.after(() => controller.destroy()); if (!options.skipOpen) assert.equal(await open(), true);
  const input = (suffix, raw) => { el(suffix).value = String(raw); el(suffix).dispatch(['Controls', 'Image'].includes(suffix) ? 'change' : 'input'); };
  const check = async () => { el('Check').click(); await settle({ el }); };
  return { ...h, el, value, controller, context, validation, proposals, applied, requests, open, input, check, memory: () => memory, setLive: v => { live = v; } };
}

test('clean source preview offers local values before placement offset and named images without changing the source', async t => {
  const h = await harness(t); assert.equal(h.el('X').value, '100'); assert.equal(h.el('Y').value, '140');
  assert.deepEqual(h.value.model.actors[2].position, [460, 220]); assert.match(h.el('Offset').textContent, /360.*80/);
  assert.match(h.el('Identity').textContent, /片段.*party.*放置.*局部标识.*leader/);
  assert.ok(h.el('Image').children.some(option => /Traveler portrait/.test(option.textContent)));
  assert.ok(h.el('Image').children.some(option => option.value === ''));
  assert.equal(h.el('Check').disabled, true); assert.equal(h.el('Apply').disabled, true);
  h.el('Apply').dispatch('click'); assert.equal(h.proposals.length, 0); assert.equal(h.memory(), h.value.source.content);
});

test('check reviews complete raw source and applies only changed local fields to editor memory after explicit approval', async t => {
  const h = await harness(t); h.input('X', 130); await h.check();
  assert.equal(h.validation.length, 1); assert.deepEqual(copy(h.validation[0].values), { position: [130, 140] });
  assert.equal(h.el('Review').hidden, false); assert.equal(h.el('Source').textContent, h.validation[0].afterContent);
  assert.ok(h.el('Source').textContent.startsWith('\uFEFF')); assert.match(h.el('Source').textContent, /\r\n/);
  assert.equal(h.memory(), h.value.source.content); assert.equal(h.proposals.length, 0); assert.equal(h.el('Apply').disabled, false);
  const next = JSON.parse(h.validation[0].afterContent.replace(/^\uFEFF/, ''));
  assert.deepEqual(next.fragments, h.value.recipe.fragments); assert.deepEqual(next.placements[0], h.value.recipe.placements[0]);
  assert.deepEqual(next.placements[1].overrides[0].values.position, [130, 140]);
  assert.equal(Object.hasOwn(next.placements[1].overrides[0].values, 'size'), false, 'unchanged inherited size remains inherited');
  h.el('Apply').click(); await settle(h); await flushDialogs();
  assert.equal(h.el('Dialog').open, false); assert.equal(h.proposals.length, 1); assert.equal(h.applied.length, 1);
  assert.equal(h.memory(), h.validation[0].afterContent); assert.equal(h.applied[0].result.applied, true);
});

test('six explicit fields form one scoped override while an unchanged field creates no extra override', async t => {
  const h = await harness(t, { dirty: true });
  for (const [field, value] of [['X', 131], ['Width', 95], ['Color', '#abcdef80'], ['Speed', 222], ['Controls', 'arrows'], ['Image', '']]) h.input(field, value);
  await h.check();
  assert.deepEqual(copy(h.validation[0].values), { position: [131, 140], size: [95, 60], color: '#abcdef80', speed: 222, controls: 'arrows', imageResourceId: null });
  h.input('X', 100); h.input('Width', 80); h.input('Color', '#f1c46e'); h.input('Speed', 0); h.input('Controls', 'none'); h.input('Image', ids.image);
  assert.equal(h.el('Check').disabled, true); assert.equal(h.el('Apply').disabled, true); assert.equal(h.el('Review').hidden, true);
});

test('non-inherited image fields keep their current resource and do not offer invalid clearing', async t => {
  const h = await harness(t, { inherit: false }); assert.ok(h.el('Image').children.some(option => option.value === ids.image));
  assert.equal(h.el('Image').children.some(option => option.value === ''), false);
  h.input('X', 125); await h.check(); assert.equal(Object.hasOwn(h.validation[0].values, 'imageResourceId'), false);
});

test('cancel and Escape discard only the override form and retain editor source and save preconditions', async t => {
  const h = await harness(t); h.input('X', 130); await h.check();
  const baseline = copy(h.value.source), prompts = [];
  h.runtime.window.confirm = prompt => { prompts.push(prompt); return false; };
  h.el('Cancel').click(); h.el('Dialog').dispatch('cancel'); assert.equal(h.el('Dialog').open, true); assert.equal(prompts.length, 2);
  h.runtime.window.confirm = () => true; h.el('Dialog').dispatch('cancel'); await flushDialogs();
  assert.equal(h.el('Dialog').open, false); assert.equal(h.memory(), baseline.content); assert.deepEqual(h.value.source, baseline); assert.equal(h.proposals.length, 0);
});

test('dependency validation failure keeps the full candidate source and fields but cannot authorize apply', async t => {
  let succeeds = false;
  const h = await harness(t, { validate: async () => { if (succeeds) return { ok: true }; throw Object.assign(new Error('Missing image'),
    { payload: { diagnostics: [{ code: 'build_image_unsupported', propertyPath: '/placements/1/overrides/0/values/imageResourceId' }] } }); } });
  h.input('X', 130); await h.check(); assert.equal(h.el('Review').hidden, false); assert.equal(h.el('X').value, '130');
  assert.match(h.el('Diagnostics').textContent, /build_image_unsupported/); assert.equal(h.el('Apply').disabled, true);
  h.el('Apply').dispatch('click'); assert.equal(h.proposals.length, 0); assert.equal(h.memory(), h.value.source.content);
  succeeds = true; await h.check(); assert.equal(h.el('Apply').disabled, false); assert.equal(h.el('Diagnostics').children.length, 0);
});

test('invalid numeric and recipe fields never call host validation or replace the source', async t => {
  for (const [field, value] of [['X', ''], ['X', 'NaN'], ['Width', 0], ['Speed', 2001], ['Color', 'red']]) {
    const h = await harness(t); h.input(field, value); await h.check();
    assert.equal(h.validation.length, 0); assert.equal(h.el('Apply').disabled, true); assert.equal(h.memory(), h.value.source.content);
    assert.match(h.el('Message').textContent, /字段值/);
  }
});

test('field changes invalidate the reviewed proposal, including programmatic input while validation is pending', async t => {
  const pending = deferred(), h = await harness(t, { validate: () => pending.promise }); h.input('X', 130); h.el('Check').click();
  assert.equal(h.el('X').disabled, true); assert.equal(h.el('Cancel').disabled, true);
  h.input('X', 140); pending.resolve({ ok: true }); await settle(h);
  assert.equal(h.el('Apply').disabled, true); assert.equal(h.el('Review').hidden, true); assert.equal(h.proposals.length, 0);
});

test('source, capability and preview ownership changes reject late validation and keep changes for review', async t => {
  for (const mutate of [h => h.context.sceneDraftToken++, h => { h.context.sceneDraftPath = 'other.json'; }, h => { h.context.canEditCompositionOverride = false; }, h => h.setLive(false)]) {
    const pending = deferred(), h = await harness(t, { validate: () => pending.promise }); h.input('X', 130); h.el('Check').click(); mutate(h);
    pending.resolve({ ok: true }); await settle(h); h.el('Apply').dispatch('click');
    assert.equal(h.el('Apply').disabled, true); assert.equal(h.el('Check').disabled, true); assert.equal(h.el('X').value, '130');
    assert.equal(h.proposals.length, 0); assert.equal(h.memory(), h.value.source.content);
  }
});

test('asynchronous opens discard old editor sessions and a newer open retains its own form', async t => {
  const pending = deferred(); let count = 0;
  const h = await harness(t, { skipOpen: true, factory: async (...args) => { const draft = await createSceneCompositionOverrideDraft(...args); if (++count === 1) await pending.promise; return draft; } });
  const first = h.open(); await flushDialogs(); h.context.sceneDraftToken++; assert.equal(await h.open(), true);
  h.input('X', 150); pending.resolve(); assert.equal(await first, false); assert.equal(h.el('X').value, '150'); assert.equal(h.el('Dialog').open, true);
});

test('ambiguous host apply results never close the form or claim success', async t => {
  for (const result of [undefined, false, true, {}, { ok: true }, { applied: false }]) {
    const h = await harness(t, { apply: async () => result }); h.input('X', 130); await h.check(); h.el('Apply').click(); await settle(h);
    assert.equal(h.el('Dialog').open, true); assert.equal(h.applied.length, 0); assert.equal(h.el('Apply').disabled, true); assert.equal(h.el('X').value, '130');
  }
});

test('guarded application exposes live ownership and a forced close cannot apply or reopen stale work', async t => {
  const pending = deferred(); let owner;
  const h = await harness(t, { apply: async (proposal, guard) => { owner = guard; await pending.promise; if (!guard.isCurrent()) throw Object.assign(new Error('Stale'), { errorCode: 'scene_composition_override_conflict' }); return { applied: true }; } });
  h.input('X', 130); await h.check(); h.el('Apply').click(); assert.equal(owner.isCurrent(), true);
  assert.equal(h.el('Cancel').disabled, true); h.el('Dialog').close(); await flushDialogs(); assert.equal(owner.isCurrent(), false);
  pending.resolve(); await settle(h); assert.equal(h.applied.length, 0); assert.equal(h.el('Dialog').open, false); assert.equal(h.memory(), h.value.source.content);
});

async function previewHarness(t) {
  const value = await fixture(), context = { editable: true, dirty: false, busy: false, creating: false, previewKind: 'composition',
    canEditCompositionOverride: true, compositionSourceWritable: true, canPreviewDraft: true, sceneDraftPath: value.source.sourcePath, sceneDraftToken: 1 };
  const calls = [], opened = [], writes = []; let result = true;
  const h = await dialogHarness('app-scene-preview', { SCENE_PREVIEW_API_PATH: '/api/scene-preview',
    createScenePreviewCanvas: () => Object.fromEntries(['setScene', 'setImages', 'setVisible', 'select', 'fit', 'zoom', 'setGrid', 'destroy'].map(name => [name, () => {}])),
    fetchJsonApiRequest: (url, request) => { const wait = deferred(); calls.push({ url, request, ...wait }); if (request.method === 'DELETE') wait.resolve({ payload: { ok: true } }); return wait.promise; } });
  const container = h.document.createElement('section'); h.document.body.append(container);
  const controller = h.runtime.setupScenePreview({ container, getContext: () => context, getDraft: async () => value.source,
    editCompositionOverride: input => { opened.push(input); return result; }, editScene: () => writes.push('scene'), editLayout: () => writes.push('layout'), editDraftLayout: () => writes.push('draft-layout') });
  const resolve = async payload => { calls.filter(call => call.request.method === 'POST').at(-1).resolve({ payload }); await flushDialogs(); };
  t.after(() => controller.destroy()); controller.setAvailable(true); controller.setScene(ids.scene); controller.setVisible(true); await resolve(value.model);
  h.element('scenePreviewObjects').querySelector(`button[data-actor-id="${value.instanceId}"]`).click();
  return { ...h, value, context, container, controller, opened, writes, resolve, setResult: v => { result = v; } };
}

test('only the source-bound clean saved or current draft recipe instance enables its own override action', async t => {
  const h = await previewHarness(t), button = h.element('scenePreviewCompositionOverride');
  assert.equal(button.hidden, false); assert.equal(button.disabled, false); button.click(); await flushDialogs();
  assert.equal(h.opened.length, 1); assert.equal(h.opened[0].instanceId, h.value.instanceId); assert.equal(h.opened[0].isCurrent(), true);
  for (const [key, value] of [['dirty', true], ['compositionSourceWritable', false], ['canEditCompositionOverride', false], ['busy', true], ['sceneDraftPath', 'other.json']]) {
    const old = h.context[key]; h.context[key] = value; h.controller.setScene(ids.scene); assert.equal(button.disabled, true); button.dispatch('click'); await flushDialogs(); h.context[key] = old;
  }
  assert.equal(h.opened.length, 1);
  h.context.dirty = true; h.element('scenePreviewDraftRefresh').click(); await flushDialogs();
  await h.resolve({ ...h.value.model, draft: { baseSourceRevision: h.value.source.baseSourceRevision, sourceRevision: revision(h.value.source.content) } });
  assert.equal(button.disabled, false); button.click(); await flushDialogs(); assert.equal(h.opened.length, 2);
  h.context.sceneDraftToken++; h.controller.setScene(ids.scene); assert.equal(button.disabled, true); assert.equal(h.opened.at(-1).isCurrent(), false);
  for (const id of ['scenePreviewEdit', 'scenePreviewLayoutEdit', 'scenePreviewDraftLayoutEdit']) { assert.equal(h.element(id).hidden, true); h.element(id).dispatch('click'); }
  assert.equal(h.writes.length, 0);
});

test('pending override opens are single flight and stale preview owners cannot revive the action', async t => {
  const h = await previewHarness(t), pending = deferred(); h.setResult(pending.promise);
  const button = h.element('scenePreviewCompositionOverride'); button.click(); button.dispatch('click'); assert.equal(h.opened.length, 1);
  h.context.sceneDraftToken++; h.controller.setVisible(false); assert.equal(h.opened[0].isCurrent(), false);
  pending.resolve(false); await flushDialogs(); assert.equal(h.container.dataset.scenePreviewState, 'empty'); assert.equal(h.writes.length, 0);
});


test('review approval cannot survive a changed form value even if its input event was missed', async t => {
  const h = await harness(t); h.input('X', 130); await h.check();
  h.el('X').value = '180'; h.el('Apply').dispatch('click'); await flushDialogs();
  assert.equal(h.proposals.length, 0); assert.equal(h.el('Apply').disabled, true); assert.equal(h.memory(), h.value.source.content);
});

test('instance override interface messages are complete in English and Japanese', async () => {
  const source = await fs.readFile(new URL('../../web/modules/app-scene-composition-overrides.js', import.meta.url), 'utf8');
  const keys = [...source.matchAll(/(?:'([^'\n]*[\u3400-\u9fff][^'\n]*)'|data-i18n="([^"]+)")/g)].map(match => match[1] || match[2]);
  for (const key of keys) { assert.ok(en[key], `English: ${key}`); assert.ok(ja[key], `Japanese: ${key}`); }
});
