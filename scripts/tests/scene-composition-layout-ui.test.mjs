import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash, webcrypto } from 'node:crypto';
import { createSceneCompositionLayoutDraft } from '../../engine/scene-composition-layout.mjs';
import { prepareSceneCompositionOverrideApply } from '../../engine/scene-composition-overrides.mjs';
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
const { ids } = golden, copy = value => JSON.parse(JSON.stringify(value));
const hash = text => createHash('sha256').update(text).digest('hex'), revision = text => `sha256:${hash(text)}`;
async function fixture({ dirty = false } = {}) {
  const observed = copy(golden.observed), recipe = copy(example);
  observed.source.workspace.version = 3; observed.source.definition = { documentTypes: [{ id: 'document', label: 'Document' }] };
  recipe.scene.title = '布局 / Layout / 配置 🦊';
  recipe.fragments[0].actors[0] = { key: 'leader', objectId: ids.first, groupKey: 'party', position: [120, 180], useProjectionDefaults: true };
  recipe.fragments[0].actors[1].objectId = ids.first;
  recipe.placements[1].overrides[0].values.imageResourceId = null;
  const document = observed.source.documents.find(item => item.record.id === ids.scene);
  document.record.relations = []; document.record.assetBindings = [];
  document.content = '\uFEFF' + JSON.stringify(recipe, null, '\t').replaceAll('\n', '\r\n') + '\r\n \t';
  document.sourceRevision = revision(document.content);
  for (const item of observed.source.documents) item.descriptor = { ...item.record };
  observed.projection = await createWorldProjection(observed.source, { digest: hash });
  const result = await resolveSceneCompositionPreview(observed, ids.scene, { digest: hash });
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  const plan = scene2DModelToPlan(result.model), baseSourceRevision = dirty ? revision('saved baseline') : document.sourceRevision;
  const model = { ok: true, format: 'viento-scene-preview', schemaVersion: 2,
    scene: plan.scene, actors: plan.actors, composition: result.composition, sourceLocations: result.model.sourceLocations,
    sceneStructure: createSceneStructure(result.model), resources: [], diagnostics: [],
    ...(dirty ? { draft: { baseSourceRevision, sourceRevision: document.sourceRevision } } : {}) };
  return { model, recipe, source: { sourcePath: document.sourcePath, content: document.content, baseSourceRevision }, actorId: model.actors[2].instanceId };
}
async function settle(h) {
  for (let index = 0; index < 100; index++) {
    await flushDialogs(); if (h.el('Dialog').getAttribute('aria-busy') !== 'true') return;
    await new Promise(resolve => setTimeout(resolve, 1));
  }
  assert.fail('Composition layout remained busy');
}
async function harness(t, options = {}) {
  const value = await fixture(options), validation = [], proposals = [], applied = [], views = [], copies = [], guards = [];
  let memory = value.source.content, live = true, callbacks;
  const context = { editable: true, dirty: Boolean(options.dirty), creating: false, busy: false, compositionSourceWritable: true,
    canEditCompositionLayout: true, sceneDraftPath: value.source.sourcePath, sceneDraftToken: 1 };
  const h = await dialogHarness('app-scene-composition-layout', {
    crypto: webcrypto, queueMicrotask, createSceneCompositionLayoutDraft: options.factory || createSceneCompositionLayoutDraft,
    // The real helper, Rust history, source patch and apply preparation execute.
    // Only rendering is a spy; actual pointer rendering has its own canvas tests.
    createScenePreviewCanvas: settings => { callbacks = settings; return Object.fromEntries(['setScene', 'setVisible', 'setImages', 'select', 'setMultiSelect', 'setMovableIds', 'setEditing', 'setSnap', 'setGrid', 'fit', 'zoom', 'destroy'].map(name => [name, (...args) => views.push({ name, args })])); },
    requestWorldCommand() { assert.fail('Instance layout must not issue World commands'); },
    fetchJsonApiRequest() { assert.fail('The parent owns preview dependency validation'); },
  });
  const createElement = h.document.createElement;
  h.document.createElement = tag => { const element = createElement(tag); if (tag === 'canvas') { element.getContext = () => ({ drawImage() {} }); copies.push(element); } return element; };
  const controller = h.runtime.setupSceneCompositionLayout({ getContext: () => context,
    validateDraft: async (proposal, guard) => { validation.push(copy(proposal)); guards.push(guard); return options.validate ? options.validate(proposal, guard) : { ok: true }; },
    applySourceDraft: async (proposal, guard) => {
      proposals.push(copy(proposal)); if (options.apply) return options.apply(proposal, guard, context);
      const prepared = await prepareSceneCompositionOverrideApply({ ...value.source, content: memory }, proposal, { digest: hash });
      if (!guard.isCurrent()) throw Object.assign(new Error('The source owner changed'), { errorCode: 'scene_composition_override_conflict' });
      memory = prepared.afterContent; context.sceneDraftToken++; context.dirty = true; return { applied: true };
    }, sourceApplied: (result, proposal) => applied.push({ result, proposal }),
  });
  const el = suffix => h.element(`sceneCompositionLayout${suffix}`), open = (extra = {}) => controller.open({ ...value, isCurrent: () => live, ...extra });
  t.after(async () => { controller.destroy(); await flushDialogs(); });
  if (!options.skipOpen) assert.equal(await open(), true);
  const input = (suffix, raw, commit = true) => { el(suffix).value = String(raw); el(suffix).dispatch('input'); if (commit) el(suffix).dispatch('change'); };
  const check = async () => { el('Check').click(); await settle({ el }); };
  const rendered = () => views.filter(item => item.name === 'setScene' && item.args[0]).at(-1)?.args[0];
  return { ...h, el, value, context, controller, validation, proposals, applied, views, copies, guards, callbacks, open, input, check, rendered,
    move: position => callbacks.onMove(value.actorId, position), memory: () => memory, setLive: value => { live = value; } };
}

test('a clean recipe shows the complete scene but grants movement only to its fixed instance', async t => {
  const h = await harness(t);
  assert.equal(h.el('X').value, '460'); assert.equal(h.el('Y').value, '220');
  assert.match(h.el('Local').textContent, /100, 140/); assert.match(h.el('Offset').textContent, /360, 80/);
  assert.match(h.el('Identity').textContent, /leader/); assert.match(h.el('Identity').textContent, new RegExp(h.value.actorId));
  assert.deepEqual(copy(h.rendered().actors), h.value.model.actors);
  assert.deepEqual(copy(h.views.filter(item => item.name === 'setMovableIds').at(-1).args[0]), [h.value.actorId]);
  assert.equal(h.views.find(item => item.name === 'setMultiSelect').args[0], false);
  h.callbacks.onSelect(h.value.model.actors[0].instanceId); assert.equal(h.views.filter(item => item.name === 'select').at(-1).args[0], h.value.actorId);
  h.callbacks.onMove(h.value.model.actors[0].instanceId, [1, 2]);
  assert.equal(h.el('Dialog').dataset.dirty, 'false'); assert.equal(h.el('Check').disabled, true); assert.equal(h.el('Apply').disabled, true);
  assert.equal(h.memory(), h.value.source.content);
});

test('one world-space movement reviews a position-only exact recipe patch before guarded memory application', async t => {
  const h = await harness(t, { dirty: true }), original = copy(h.value);
  h.move([470, 225]); assert.equal(h.el('Dialog').dataset.dirty, 'true'); assert.match(h.el('Local').textContent, /110, 145/);
  assert.equal(h.validation.length, 0); assert.equal(h.proposals.length, 0); await h.check();
  assert.equal(h.el('Apply').disabled, false); assert.equal(h.el('Review').open, true);
  const proposal = h.validation[0]; assert.deepEqual(proposal.values, { position: [110, 145] });
  assert.deepEqual(proposal.changedPaths, ['/placements/1/overrides/0/values/position']);
  assert.equal(Object.hasOwn(proposal, 'resetFields'), false); assert.equal(h.el('Source').textContent, proposal.afterContent);
  assert.equal(h.memory(), original.source.content); assert.equal(proposal.baseSourceRevision, original.source.baseSourceRevision);
  const after = JSON.parse(proposal.afterContent.replace(/^\uFEFF/, '')), expected = copy(original.recipe);
  expected.placements[1].overrides[0].values.position = [110, 145]; assert.deepEqual(after, expected);
  assert.equal(after.placements[1].overrides[0].values.imageResourceId, null);
  assert.ok(proposal.afterContent.startsWith('\uFEFF{\r\n')); assert.ok(proposal.afterContent.endsWith('\r\n \t'));
  assert.deepEqual(h.rendered().actors.filter(actor => actor.instanceId !== h.value.actorId), original.model.actors.filter(actor => actor.instanceId !== h.value.actorId));
  h.el('Apply').click(); await settle(h);
  assert.equal(h.memory(), proposal.afterContent); assert.equal(h.proposals.length, 1); assert.equal(h.applied.length, 1);
  assert.equal(h.el('Dialog').open, false); assert.equal(h.context.dirty, true); assert.deepEqual(h.value, original);
});

test('one gesture is one history step; returning to the opening position makes the recipe a no-op', async t => {
  const h = await harness(t); h.move([470, 225]); h.move([480, 230]); await h.check();
  h.el('Undo').click(); assert.equal(h.el('X').value, '470'); assert.equal(h.el('Apply').disabled, true);
  h.el('Undo').click(); assert.equal(h.el('X').value, '460'); assert.equal(h.el('Dialog').dataset.dirty, 'false');
  h.el('Check').dispatch('click'); await settle(h); assert.equal(h.validation.length, 1);
  h.el('Redo').click(); assert.equal(h.el('X').value, '470'); h.move([490, 235]); assert.equal(h.el('Redo').disabled, true);
  h.move([460, 220]); assert.equal(h.el('Dialog').dataset.dirty, 'false'); assert.equal(h.memory(), h.value.source.content);
  assert.equal(h.proposals.length, 0);
});

test('moving an inherited first-placement position adds only its local override and returning to origin adds none', async t => {
  const h = await harness(t, { skipOpen: true }), actorId = h.value.model.actors[0].instanceId;
  assert.equal(await h.open({ actorId }), true); assert.equal(h.el('X').value, '120');
  h.callbacks.onMove(actorId, [130, 185]); await h.check();
  const proposal = h.validation[0], after = JSON.parse(proposal.afterContent.replace(/^\uFEFF/, ''));
  assert.deepEqual(after.placements[0].overrides, [{ actorKey: 'leader', values: { position: [130, 185] } }]);
  assert.deepEqual(after.placements[1], h.value.recipe.placements[1]);
  assert.deepEqual(after.fragments, h.value.recipe.fragments);
  h.callbacks.onMove(actorId, [120, 180]); h.el('Check').dispatch('click'); await settle(h);
  assert.equal(h.el('Dialog').dataset.dirty, 'false'); assert.equal(h.validation.length, 1); assert.equal(h.el('Review').hidden, true);
  assert.equal(h.memory(), h.value.source.content); assert.equal(h.proposals.length, 0);
});

test('world coordinates that produce an invalid local coordinate retain positions, history and unfinished input', async t => {
  const h = await harness(t); h.move([470, 225]); h.el('Undo').click();
  h.move([-100000, 220]); assert.equal(h.el('X').value, '460'); assert.equal(h.el('Redo').disabled, false);
  h.el('Redo').click(); assert.equal(h.el('X').value, '470');
  h.input('X', '-100000'); assert.equal(h.el('X').value, '-100000'); assert.equal(h.el('Check').disabled, true);
  assert.equal(h.rendered().actors.find(actor => actor.instanceId === h.value.actorId).position[0], 470);
  h.el('Undo').click(); assert.equal(h.el('X').value, '470');
  h.el('Undo').click(); assert.equal(h.el('X').value, '460'); assert.equal(h.el('Dialog').dataset.dirty, 'false');
});

test('unfinished or silently changed coordinate input cannot authorize a reviewed position', async t => {
  const h = await harness(t); h.move([470, 225]); await h.check();
  h.el('X').value = '999'; h.el('Apply').dispatch('click'); await settle(h);
  assert.equal(h.proposals.length, 0); assert.equal(h.el('Apply').disabled, true); assert.equal(h.el('Check').disabled, true);
  h.el('Undo').click(); assert.equal(h.el('X').value, '470');
  h.input('X', '', false); h.move([490, 240]); assert.equal(h.el('X').value, ''); assert.equal(h.el('Check').disabled, true);
  h.el('Undo').click(); assert.equal(h.el('X').value, '470');
  h.input('X', 471.5); assert.equal(h.el('X').value, '471.5'); assert.match(h.el('Local').textContent, /111.5, 145/);
  await h.check(); assert.deepEqual(h.validation.at(-1).values, { position: [111.5, 145] });
});

test('pan, snap, grid and zoom controls preserve the source and independent position history', async t => {
  const h = await harness(t); h.move([470, 225]); h.el('Pan').click();
  assert.equal(h.views.filter(item => item.name === 'setEditing').at(-1).args[0], false);
  h.el('Move').click(); assert.equal(h.views.filter(item => item.name === 'setEditing').at(-1).args[0], true);
  h.el('Snap').checked = true; h.el('Snap').dispatch('change'); assert.equal(h.views.filter(item => item.name === 'setSnap').at(-1).args[0], 32);
  h.el('Grid').checked = false; h.el('Grid').dispatch('change'); assert.equal(h.views.filter(item => item.name === 'setGrid').at(-1).args[0], false);
  h.el('Fit').click(); h.el('ZoomIn').click(); h.el('ZoomOut').click(); h.callbacks.onViewChange({ scale: 1.25 }); assert.equal(h.el('Zoom').textContent, '125%');
  h.el('Undo').click(); assert.equal(h.el('Dialog').dataset.dirty, 'false'); assert.equal(h.memory(), h.value.source.content);
});

test('Ctrl+S reviews then applies to the source draft and layout undo shortcuts remain local', async t => {
  const h = await harness(t); h.move([470, 225]);
  const event = h.el('Dialog').dispatch('keydown', { key: 's', ctrlKey: true }); await settle(h);
  assert.equal(event.defaultPrevented, true); assert.equal(h.validation.length, 1); assert.equal(h.proposals.length, 0);
  h.el('Dialog').dispatch('keydown', { key: 'z', metaKey: true }); assert.equal(h.el('X').value, '460');
  h.el('Dialog').dispatch('keydown', { key: 'z', ctrlKey: true, shiftKey: true }); assert.equal(h.el('X').value, '470');
  h.el('Dialog').dispatch('keydown', { key: 's', ctrlKey: true }); await settle(h);
  h.el('Dialog').dispatch('keydown', { key: 's', metaKey: true }); await settle(h);
  assert.equal(h.proposals.length, 1); assert.equal(h.el('Dialog').open, false);
});

test('cancel and Escape discard only the local instance layout; declining preserves its history', async t => {
  const h = await harness(t); h.move([470, 225]); const confirmations = [];
  h.runtime.window.confirm = prompt => { confirmations.push(prompt); return false; };
  h.el('Cancel').click(); h.el('Dialog').dispatch('cancel'); assert.equal(confirmations.length, 2);
  assert.equal(h.el('Dialog').open, true); assert.equal(h.el('X').value, '470'); assert.match(confirmations[0], /原文草稿不会改变/);
  h.el('Undo').click(); assert.equal(h.el('X').value, '460'); h.el('Redo').click(); assert.equal(h.el('X').value, '470');
  h.runtime.window.confirm = () => true; h.el('Dialog').dispatch('cancel'); await flushDialogs();
  assert.equal(h.el('Dialog').open, false); assert.equal(h.memory(), h.value.source.content); assert.equal(h.proposals.length, 0);
});

test('source, mode, capability and originating preview changes invalidate approval without discarding local positions', async t => {
  for (const mutate of [h => h.context.sceneDraftToken++, h => { h.context.sceneDraftPath = 'other.json'; }, h => { h.context.compositionSourceWritable = false; },
    h => { h.context.canEditCompositionLayout = false; }, h => { h.context.busy = true; }, h => h.setLive(false)]) {
    const h = await harness(t); h.move([470, 225]); await h.check(); mutate(h); h.el('Apply').dispatch('click'); await settle(h);
    assert.equal(h.proposals.length, 0); assert.equal(h.el('Dialog').open, true); assert.equal(h.el('X').value, '470');
    assert.equal(h.el('Dialog').dataset.dirty, 'true'); assert.equal(h.el('Apply').disabled, true); assert.equal(h.el('Check').disabled, true);
    assert.match(h.el('Message').textContent, /布局修改保留/); assert.equal(h.memory(), h.value.source.content);
  }
});

test('dependency validation failure keeps the candidate and coordinates without approving application', async t => {
  const h = await harness(t, { validate: async () => { throw Object.assign(new Error('Missing image'), { payload: { diagnostics: [{ code: 'build_resource_unavailable' }] } }); } });
  h.move([470, 225]); await h.check(); assert.equal(h.el('Apply').disabled, true); assert.equal(h.el('Dialog').dataset.dirty, 'true');
  assert.equal(h.el('X').value, '470'); assert.equal(h.el('Source').textContent, h.validation[0].afterContent); assert.equal(h.el('Diagnostics').children.length, 1);
  assert.equal(h.memory(), h.value.source.content); assert.equal(h.proposals.length, 0);
});

test('pending checks lock movement and late validation cannot restore approval for a changed source', async t => {
  const wait = deferred(), h = await harness(t, { validate: () => wait.promise }); h.move([470, 225]); h.el('Check').click();
  assert.equal(h.el('Cancel').disabled, true); assert.equal(h.el('X').disabled, true); h.move([490, 240]); assert.equal(h.el('X').value, '470');
  h.context.sceneDraftToken++; assert.equal(h.guards[0].isCurrent(), false); wait.resolve({ ok: true }); await settle(h);
  assert.equal(h.el('Apply').disabled, true); assert.equal(h.el('X').value, '470'); assert.equal(h.memory(), h.value.source.content);
});

test('a closed check cannot approve or paint over a reopened instance layout', async t => {
  const wait = deferred(), h = await harness(t, { validate: () => wait.promise }); h.move([470, 225]); h.el('Check').click();
  h.el('Dialog').close(); await flushDialogs(); assert.equal(h.guards[0].isCurrent(), false);
  assert.equal(await h.open(), true); h.move([480, 230]); wait.resolve({ ok: true }); await settle(h);
  assert.equal(h.el('X').value, '480'); assert.equal(h.el('Apply').disabled, true); assert.equal(h.el('Review').hidden, true);
  assert.equal(h.el('Dialog').open, true); assert.equal(h.memory(), h.value.source.content); assert.equal(h.applied.length, 0);
});

test('an ambiguous apply result never claims success or releases the editable layout', async t => {
  for (const result of [undefined, false, true, {}, { ok: true }, { applied: false }]) {
    const h = await harness(t, { apply: async () => result }); h.move([470, 225]); await h.check(); h.el('Apply').click(); await settle(h);
    assert.equal(h.el('Dialog').open, true); assert.equal(h.el('X').value, '470'); assert.equal(h.el('Dialog').dataset.dirty, 'true');
    assert.equal(h.applied.length, 0); assert.equal(h.el('Apply').disabled, true); assert.equal(h.memory(), h.value.source.content);
  }
});

test('a forced close invalidates a pending host guard before it can replace source memory', async t => {
  const reached = deferred(), release = deferred(); let accepted = 0;
  const h = await harness(t, { apply: async (proposal, guard) => {
    await prepareSceneCompositionOverrideApply(h.value.source, proposal, { digest: hash }); assert.equal(guard.isCurrent(), true);
    reached.resolve(); await release.promise;
    if (!guard.isCurrent()) throw Object.assign(new Error('Closed'), { errorCode: 'scene_composition_override_conflict' });
    accepted++; return { applied: true };
  } });
  h.move([470, 225]); await h.check(); h.el('Apply').click(); await reached.promise;
  h.el('Dialog').close(); await flushDialogs(); release.resolve(); await settle(h);
  assert.equal(accepted, 0); assert.equal(h.applied.length, 0); assert.equal(h.el('Dialog').open, false); assert.equal(h.memory(), h.value.source.content);
});

test('a stale asynchronous opening releases its Rust draft and cannot replace a newer layout', async t => {
  const release = deferred(); let calls = 0, disposed = 0;
  const h = await harness(t, { skipOpen: true, factory: async (...args) => {
    const draft = await createSceneCompositionLayoutDraft(...args); const result = { ...draft, dispose() { disposed++; draft.dispose(); } };
    if (++calls === 1) await release.promise; return result;
  } });
  const first = h.open(); await flushDialogs(); h.context.sceneDraftToken++; assert.equal(await h.open(), true);
  release.resolve(); assert.equal(await first, false); assert.equal(disposed, 1); assert.equal(h.el('X').value, '460');
  h.el('Cancel').click(); await flushDialogs(); assert.equal(disposed, 2);
});

test('closing and destroying release only cloned preview images and every owned Rust draft', async t => {
  let disposed = 0; const h = await harness(t, { skipOpen: true, factory: async (...args) => {
    const draft = await createSceneCompositionLayoutDraft(...args); return { ...draft, dispose() { disposed++; draft.dispose(); } };
  } });
  const image = { width: 64, height: 32 };
  assert.equal(await h.open({ images: new Map([['image', image]]) }), true); assert.equal(h.copies.length, 1);
  h.el('Cancel').click(); await flushDialogs(); assert.equal(disposed, 1); assert.equal(h.copies[0].width, 0); assert.equal(h.copies[0].height, 0);
  assert.deepEqual(image, { width: 64, height: 32 });
  assert.equal(await h.open({ images: new Map([['image', image]]) }), true); h.controller.dispose(); await flushDialogs();
  assert.equal(disposed, 2); assert.equal(h.copies[1].width, 0); assert.equal(h.views.filter(item => item.name === 'destroy').length, 1);
  assert.equal(await h.open(), false); assert.deepEqual(image, { width: 64, height: 32 });
});

test('a history operation failure retains the last Rust geometry and cannot obstruct local teardown', async t => {
  let disposed = 0;
  const h = await harness(t, { factory: async (...args) => {
    const draft = await createSceneCompositionLayoutDraft(...args);
    return { ...draft, undo() { throw Object.assign(new Error('History unavailable'), { errorCode: 'studio_core_unavailable' }); },
      dispose() { disposed++; draft.dispose(); } };
  } });
  h.move([470, 225]); h.el('Undo').click(); assert.equal(h.el('X').value, '470');
  assert.equal(h.el('Dialog').dataset.dirty, 'true'); assert.match(h.el('Message').textContent, /组件未能加载/);
  assert.equal(h.memory(), h.value.source.content); h.el('Cancel').click(); await flushDialogs();
  assert.equal(disposed, 1); assert.equal(h.el('Dialog').open, false);
});

test('the instance layout messages and new preview entry are complete in English and Japanese', async () => {
  const source = await fs.readFile(new URL('../../web/modules/app-scene-composition-layout.js', import.meta.url), 'utf8');
  const keys = [...source.matchAll(/(?:'([^'\n]*[\u3400-\u9fff][^'\n]*)'|data-i18n(?:-aria-label)?="([^"]+)")/g)].map(match => match[1] || match[2]);
  keys.push('调整此实例布局', '实例布局调整暂不可用，请重新预览当前配方后重试。');
  for (const key of new Set(keys)) { assert.ok(en[key], `English: ${key}`); assert.ok(ja[key], `Japanese: ${key}`); }
});
