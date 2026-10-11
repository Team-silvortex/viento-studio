import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { createHash, webcrypto } from 'node:crypto';
import { createSceneCompositionBatchLayoutDraft, prepareSceneCompositionBatchLayoutApply } from '../../engine/scene-composition-batch-layout.mjs';
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
  recipe.scene.title = '批次 / Batch / 一括 🦊';
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
  assert.fail('Recipe batch layout remained busy');
}
async function harness(t, options = {}) {
  const value = await fixture(options), validation = [], proposals = [], applied = [], views = [], copies = [], guards = [];
  let memory = value.source.content, live = true, callbacks;
  const context = { editable: true, dirty: Boolean(options.dirty), creating: false, busy: false, compositionSourceWritable: true,
    canEditCompositionBatchLayout: true, sceneDraftPath: value.source.sourcePath, sceneDraftToken: 1 };
  const h = await dialogHarness('app-scene-composition-batch-layout', {
    crypto: webcrypto, queueMicrotask, createSceneCompositionBatchLayoutDraft: options.factory || createSceneCompositionBatchLayoutDraft,
    // The real outline, helper, Rust history/geometry and exact patch execute.
    // Drawing and pointer input are spies here; native browser checks own those.
    createScenePreviewCanvas: settings => { callbacks = settings; return Object.fromEntries(['setScene', 'setVisible', 'setImages', 'selectMany', 'setMultiSelect', 'setMovableIds', 'setEditing', 'setSnap', 'setGrid', 'fit', 'zoom', 'destroy'].map(name => [name, (...args) => views.push({ name, args })])); },
    requestWorldCommand() { assert.fail('Batch layout must not issue World commands'); },
    fetchJsonApiRequest() { assert.fail('The parent owns dependency validation'); },
  });
  const outlineSource = (await fs.readFile(new URL('../../web/modules/app-scene-outline.js', import.meta.url), 'utf8'))
    .replace(/^import[\s\S]*?from ['"][^'"]+['"];\n/gm, '').replaceAll('export ', '');
  vm.runInContext(outlineSource, h.runtime);
  const createElement = h.document.createElement;
  h.document.createElement = tag => { const element = createElement(tag); if (tag === 'canvas') { element.getContext = () => ({ drawImage() {} }); copies.push(element); } return element; };
  const controller = h.runtime.setupSceneCompositionBatchLayout({ getContext: () => context,
    validateDraft: async (proposal, guard) => { validation.push(copy(proposal)); guards.push(guard); return options.validate ? options.validate(proposal, guard) : { ok: true }; },
    applySourceDraft: async (proposal, guard) => {
      proposals.push(copy(proposal)); if (options.apply) return options.apply(proposal, guard, context);
      const prepared = await prepareSceneCompositionBatchLayoutApply({ ...value.source, content: memory }, proposal, { digest: hash });
      if (!guard.isCurrent()) throw Object.assign(new Error('The source owner changed'), { errorCode: 'scene_composition_override_conflict' });
      memory = prepared.afterContent; context.sceneDraftToken++; context.dirty = true; return { applied: true };
    }, sourceApplied: (result, proposal) => applied.push({ result, proposal }),
  });
  const el = suffix => h.element(`sceneCompositionBatchLayout${suffix}`), open = (extra = {}) => controller.open({ ...value, isCurrent: () => live, ...extra });
  t.after(async () => { controller.destroy(); await flushDialogs(); });
  if (!options.skipOpen) assert.equal(await open(), true);
  const input = (suffix, raw, commit = true) => { el(suffix).value = String(raw); el(suffix).dispatch('input'); if (commit) el(suffix).dispatch('change'); };
  const check = async () => { el('Check').click(); await settle({ el }); };
  const rendered = () => views.filter(item => item.name === 'setScene' && item.args[0]).at(-1)?.args[0];
  const selection = () => copy(views.filter(item => item.name === 'selectMany').at(-1)?.args[0]);
  const choose = actorIds => callbacks.onSelect(actorIds[0] || null, { ids: actorIds });
  return { ...h, el, value, context, controller, validation, proposals, applied, views, copies, guards, callbacks, open, input, check, rendered, selection, choose,
    move: position => callbacks.onMove(value.actorId, position), memory: () => memory, setLive: value => { live = value; } };
}

test('a recipe batch starts with one chosen instance and exposes all stable identities without changing source', async t => {
  const h = await harness(t);
  assert.deepEqual(h.selection(), [h.value.actorId]); assert.equal(h.el('X').value, '460'); assert.equal(h.el('Y').value, '220');
  assert.deepEqual(copy(h.rendered().actors), h.value.model.actors);
  assert.deepEqual(copy(h.views.filter(item => item.name === 'setMovableIds').at(-1).args[0]), h.value.model.actors.map(actor => actor.instanceId));
  assert.equal(h.views.find(item => item.name === 'setMultiSelect').args[0], true);
  assert.equal(h.el('Objects').querySelectorAll('input[data-actor-id]').length, 4);
  assert.equal(h.el('Objects').querySelectorAll('input[data-group-id]').length, 4);
  assert.equal(h.el('Dialog').dataset.dirty, 'false'); assert.equal(h.el('Check').disabled, true);
  assert.equal(h.memory(), h.value.source.content);
});

test('opening without a chosen identity defaults to the first instance; unknown initial identity grants no foreign target', async t => {
  for (const actorId of [undefined, 'unknown']) {
    const h = await harness(t, { skipOpen: true }); assert.equal(await h.open({ actorId }), true);
    assert.deepEqual(h.selection(), [h.value.model.actors[0].instanceId]); assert.equal(h.el('X').value, '120');
  }
});

test('outline search, descendant groups, checkbox toggles and selection actions are view state only', async t => {
  const h = await harness(t), actors = h.value.model.actors;
  const groupId = h.value.model.sceneStructure.groups[0].groupId;
  h.el('Objects').querySelector(`button[data-group-id="${groupId}"]`).click();
  assert.deepEqual(h.selection(), actors.slice(0, 2).map(actor => actor.instanceId)); assert.equal(h.el('Coordinates').hidden, true);
  h.el('Objects').querySelector(`input[data-actor-id="${actors[2].instanceId}"]`).dispatch('change'); assert.equal(h.selection().length, 3);
  h.el('Search').value = actors[2].instanceId; h.el('Search').dispatch('input');
  assert.equal(h.el('Objects').querySelectorAll('input[data-actor-id]').length, 1); assert.equal(h.selection().length, 3);
  h.el('SelectAll').click(); assert.equal(h.selection().length, 4);
  h.el('ClearSelection').click(); assert.deepEqual(h.selection(), []); assert.equal(h.el('Coordinates').hidden, true);
  h.el('SelectAll').click(); assert.equal(h.selection().length, 4); assert.equal(h.el('Dialog').dataset.dirty, 'false');
  assert.equal(h.validation.length, 0); assert.equal(h.memory(), h.value.source.content);
});

test('an entire gesture crosses different offsets in one history step and reviews only net changed targets', async t => {
  const h = await harness(t, { dirty: true }), actors = h.value.model.actors, chosen = [actors[0], actors[2]];
  h.choose(chosen.map(actor => actor.instanceId));
  h.callbacks.onMoveMany(chosen.map(actor => ({ objectId: actor.instanceId, position: [actor.position[0] + 10, actor.position[1] + 5] })));
  assert.equal(h.el('Dialog').dataset.dirty, 'true'); assert.equal(h.el('Coordinates').hidden, true);
  h.el('Undo').click(); assert.deepEqual(copy(h.rendered().actors), h.value.model.actors); assert.equal(h.el('Dialog').dataset.dirty, 'false');
  h.el('Redo').click(); await h.check();
  const proposal = h.validation[0]; assert.equal(proposal.changes.length, 2);
  assert.deepEqual(proposal.changes.map(change => change.position), [[130, 185], [110, 145]]);
  assert.deepEqual(proposal.changes.map(change => change.instanceId), chosen.map(actor => actor.instanceId));
  assert.equal(h.el('Targets').children.length, 2); assert.equal(h.el('Apply').disabled, false);
  assert.equal(h.el('Source').textContent, proposal.afterContent); assert.equal(h.memory(), h.value.source.content);
  const after = JSON.parse(proposal.afterContent.replace(/^\uFEFF/, '')), expected = copy(h.value.recipe);
  expected.placements[0].overrides = [{ actorKey: 'leader', values: { position: [130, 185] } }];
  expected.placements[1].overrides[0].values.position = [110, 145]; assert.deepEqual(after, expected);
  assert.ok(proposal.afterContent.startsWith('\uFEFF{\r\n')); assert.ok(proposal.afterContent.endsWith('\r\n \t'));
  assert.deepEqual(h.rendered().actors.filter(actor => !chosen.some(item => item.instanceId === actor.instanceId)), actors.filter(actor => !chosen.some(item => item.instanceId === actor.instanceId)));
  h.el('Apply').click(); await settle(h); assert.equal(h.memory(), proposal.afterContent); assert.equal(h.applied.length, 1);
  assert.equal(h.proposals.length, 1); assert.equal(h.el('Dialog').open, false); assert.equal(h.context.dirty, true);
});

test('all six alignments use resolved sizes and each can be undone as one batch', async t => {
  for (const suffix of ['Left', 'Center', 'Right', 'Top', 'Middle', 'Bottom']) {
    const h = await harness(t); h.el('SelectAll').click(); h.el(`Align${suffix}`).click();
    assert.equal(h.el('Dialog').dataset.dirty, 'true', suffix); await h.check();
    assert.ok(h.validation[0].changes.length > 0); assert.equal(h.el('Apply').disabled, false);
    h.el('Undo').click(); assert.deepEqual(copy(h.rendered().actors), h.value.model.actors); assert.equal(h.el('Dialog').dataset.dirty, 'false');
    h.el('Redo').click(); assert.equal(h.el('Dialog').dataset.dirty, 'true'); assert.equal(h.el('Apply').disabled, true);
  }
});

test('one locally out-of-range target rejects the whole gesture and preserves redo and every sibling position', async t => {
  const h = await harness(t), chosen = [h.value.model.actors[0], h.value.model.actors[2]];
  h.choose(chosen.map(actor => actor.instanceId));
  h.callbacks.onMoveMany(chosen.map(actor => ({ objectId: actor.instanceId, position: [actor.position[0] + 10, actor.position[1]] })));
  h.el('Undo').click(); assert.equal(h.el('Redo').disabled, false);
  h.callbacks.onMoveMany([{ objectId: chosen[0].instanceId, position: [130, 180] }, { objectId: chosen[1].instanceId, position: [-100000, 220] }]);
  assert.deepEqual(copy(h.rendered().actors), h.value.model.actors); assert.equal(h.el('Dialog').dataset.dirty, 'false');
  assert.equal(h.el('Redo').disabled, false); assert.match(h.el('Message').textContent, /整批布局修改未执行/);
  h.el('Redo').click(); assert.equal(h.el('Dialog').dataset.dirty, 'true'); assert.equal(h.memory(), h.value.source.content);
});

test('selection changes retain reviewed geometry, while unknown or mismatched gesture targets cannot mutate it', async t => {
  const h = await harness(t), original = copy(h.value.model.actors); h.move([470, 225]); await h.check();
  const proposed = h.el('Source').textContent; h.choose([original[0].instanceId]);
  assert.equal(h.el('Apply').disabled, false); assert.equal(h.el('X').value, '120'); assert.equal(h.el('Source').textContent, proposed);
  h.callbacks.onMove(h.value.actorId, [999, 999]); assert.equal(h.rendered().actors[2].position[0], 470);
  h.choose([original[0].instanceId, original[1].instanceId]);
  h.callbacks.onMoveMany([{ objectId: original[0].instanceId, position: [999, 999] }, { objectId: original[2].instanceId, position: [999, 999] }]);
  assert.equal(h.rendered().actors[0].position[0], 120); assert.equal(h.el('Apply').disabled, false);
  h.choose(['foreign']); assert.deepEqual(h.selection(), []); assert.equal(h.el('Apply').disabled, false); assert.equal(h.memory(), h.value.source.content);
});

test('numeric edits move only the selected instance and a completed change invalidates prior approval', async t => {
  const h = await harness(t); h.move([470, 225]); await h.check(); h.input('X', 471.5);
  assert.equal(h.el('Apply').disabled, true); await h.check();
  assert.deepEqual(h.validation.at(-1).changes.map(change => change.position), [[111.5, 145]]);
  assert.equal(h.el('Targets').children.length, 1); assert.equal(h.el('X').value, '471.5');
});

test('unfinished and silently changed raw input cannot approve, select, align or apply a different position', async t => {
  const h = await harness(t); h.move([470, 225]); await h.check(); h.el('X').value = '999';
  h.el('Apply').dispatch('click'); await settle(h); assert.equal(h.proposals.length, 0); assert.equal(h.el('Apply').disabled, true);
  h.choose(h.value.model.actors.map(actor => actor.instanceId)); assert.deepEqual(h.selection(), [h.value.actorId]);
  h.el('AlignLeft').dispatch('click'); assert.equal(h.rendered().actors[2].position[0], 470);
  h.el('Undo').click(); assert.equal(h.el('X').value, '470'); assert.equal(h.rendered().actors[2].position[0], 470);
  h.input('X', '', false); h.move([490, 240]); assert.equal(h.el('X').value, ''); assert.equal(h.el('Check').disabled, true);
  h.el('Undo').click(); assert.equal(h.el('X').value, '470'); h.el('Undo').click(); assert.equal(h.el('X').value, '460');
  h.input('X', -100000); assert.equal(h.el('X').value, '-100000'); assert.equal(h.rendered().actors[2].position[0], 460);
  h.el('Undo').click(); assert.equal(h.el('X').value, '460'); assert.equal(h.el('Dialog').dataset.dirty, 'false');
});

test('returning every moved instance to its opening position produces no empty override or approval', async t => {
  const h = await harness(t), actors = h.value.model.actors; h.el('SelectAll').click();
  h.callbacks.onMoveMany(actors.map(actor => ({ objectId: actor.instanceId, position: [actor.position[0] + 10, actor.position[1]] })));
  await h.check(); assert.equal(h.validation.length, 1);
  h.callbacks.onMoveMany(actors.map(actor => ({ objectId: actor.instanceId, position: actor.position })));
  h.el('Check').dispatch('click'); await settle(h); assert.equal(h.validation.length, 1);
  assert.equal(h.el('Dialog').dataset.dirty, 'false'); assert.equal(h.el('Review').hidden, true); assert.equal(h.el('Apply').disabled, true);
  assert.equal(h.memory(), h.value.source.content);
});

test('pan, snap, grid and zoom controls keep independent history and source bytes', async t => {
  const h = await harness(t); h.move([470, 225]); h.el('Pan').click();
  assert.equal(h.views.filter(item => item.name === 'setEditing').at(-1).args[0], false);
  h.el('Move').click(); assert.equal(h.views.filter(item => item.name === 'setEditing').at(-1).args[0], true);
  h.el('Snap').checked = true; h.el('Snap').dispatch('change'); assert.equal(h.views.filter(item => item.name === 'setSnap').at(-1).args[0], 32);
  h.el('Grid').checked = false; h.el('Grid').dispatch('change'); assert.equal(h.views.filter(item => item.name === 'setGrid').at(-1).args[0], false);
  h.el('Fit').click(); h.el('ZoomIn').click(); h.el('ZoomOut').click(); h.callbacks.onViewChange({ scale: 1.25 }); assert.equal(h.el('Zoom').textContent, '125%');
  h.el('Undo').click(); assert.equal(h.el('Dialog').dataset.dirty, 'false'); assert.equal(h.memory(), h.value.source.content);
});

test('Ctrl+S checks then applies one batch and undo shortcuts remain local', async t => {
  const h = await harness(t); h.move([470, 225]);
  const event = h.el('Dialog').dispatch('keydown', { key: 's', ctrlKey: true }); await settle(h);
  assert.equal(event.defaultPrevented, true); assert.equal(h.validation.length, 1); assert.equal(h.proposals.length, 0);
  h.el('Dialog').dispatch('keydown', { key: 'z', metaKey: true }); assert.equal(h.el('X').value, '460');
  h.el('Dialog').dispatch('keydown', { key: 'z', ctrlKey: true, shiftKey: true }); assert.equal(h.el('X').value, '470');
  h.el('Dialog').dispatch('keydown', { key: 's', ctrlKey: true }); await settle(h);
  h.el('Dialog').dispatch('keydown', { key: 's', metaKey: true }); await settle(h);
  assert.equal(h.proposals.length, 1); assert.equal(h.el('Dialog').open, false);
});

test('cancel and Escape discard only the batch; declining retains selected instances and geometry history', async t => {
  const h = await harness(t); h.move([470, 225]); const confirmations = [];
  h.runtime.window.confirm = prompt => { confirmations.push(prompt); return false; };
  h.el('Cancel').click(); h.el('Dialog').dispatch('cancel'); assert.equal(confirmations.length, 2);
  assert.equal(h.el('Dialog').open, true); assert.equal(h.el('X').value, '470'); assert.match(confirmations[0], /原文草稿不会改变/);
  h.el('Undo').click(); h.el('Redo').click(); assert.equal(h.el('X').value, '470');
  h.runtime.window.confirm = () => true; h.el('Dialog').dispatch('cancel'); await flushDialogs();
  assert.equal(h.el('Dialog').open, false); assert.equal(h.memory(), h.value.source.content); assert.equal(h.proposals.length, 0);
});

test('source, capability and originating preview changes invalidate approval while retaining all batch positions', async t => {
  for (const mutate of [h => h.context.sceneDraftToken++, h => { h.context.sceneDraftPath = 'other.json'; }, h => { h.context.compositionSourceWritable = false; },
    h => { h.context.canEditCompositionBatchLayout = false; }, h => { h.context.busy = true; }, h => h.setLive(false)]) {
    const h = await harness(t); h.move([470, 225]); await h.check(); mutate(h); h.el('Apply').dispatch('click'); await settle(h);
    assert.equal(h.proposals.length, 0); assert.equal(h.el('Dialog').open, true); assert.equal(h.el('X').value, '470');
    assert.equal(h.el('Dialog').dataset.dirty, 'true'); assert.equal(h.el('Apply').disabled, true); assert.equal(h.el('Check').disabled, true);
    assert.match(h.el('Message').textContent, /批次布局修改保留/); assert.equal(h.memory(), h.value.source.content);
  }
});

test('dependency failure retains the complete candidate, target list and diagnostics without approving application', async t => {
  const h = await harness(t, { validate: async () => { throw Object.assign(new Error('Missing image'), { payload: { diagnostics: [{ code: 'build_resource_unavailable' }] } }); } });
  h.move([470, 225]); await h.check(); assert.equal(h.el('Apply').disabled, true); assert.equal(h.el('Dialog').dataset.dirty, 'true');
  assert.equal(h.el('Source').textContent, h.validation[0].afterContent); assert.equal(h.el('Targets').children.length, 1);
  assert.equal(h.el('Diagnostics').children.length, 1); assert.equal(h.memory(), h.value.source.content); assert.equal(h.proposals.length, 0);
});

test('pending checks lock selection, movement and numeric input; stale validation cannot approve a changed source', async t => {
  const wait = deferred(), h = await harness(t, { validate: () => wait.promise }); h.move([470, 225]); h.el('Check').click();
  assert.equal(h.el('Cancel').disabled, true); assert.equal(h.el('X').disabled, true); h.move([490, 240]); assert.equal(h.el('X').value, '470');
  h.choose(h.value.model.actors.map(actor => actor.instanceId)); assert.deepEqual(h.selection(), [h.value.actorId]);
  assert.equal(h.el('Search').disabled, true); h.context.sceneDraftToken++; assert.equal(h.guards[0].isCurrent(), false);
  wait.resolve({ ok: true }); await settle(h); assert.equal(h.el('Apply').disabled, true); assert.equal(h.el('X').value, '470');
});

test('a closed check cannot approve or paint over a reopened batch layout', async t => {
  const wait = deferred(), h = await harness(t, { validate: () => wait.promise }); h.move([470, 225]); h.el('Check').click();
  h.el('Dialog').close(); await flushDialogs(); assert.equal(h.guards[0].isCurrent(), false);
  assert.equal(await h.open(), true); h.move([480, 230]); wait.resolve({ ok: true }); await settle(h);
  assert.equal(h.el('X').value, '480'); assert.equal(h.el('Apply').disabled, true); assert.equal(h.el('Review').hidden, true);
  assert.equal(h.el('Dialog').open, true); assert.equal(h.memory(), h.value.source.content); assert.equal(h.applied.length, 0);
});

test('an ambiguous apply result never claims success or discards the editable batch', async t => {
  for (const result of [undefined, false, true, {}, { ok: true }, { applied: false }]) {
    const h = await harness(t, { apply: async () => result }); h.move([470, 225]); await h.check(); h.el('Apply').click(); await settle(h);
    assert.equal(h.el('Dialog').open, true); assert.equal(h.el('X').value, '470'); assert.equal(h.el('Dialog').dataset.dirty, 'true');
    assert.equal(h.applied.length, 0); assert.equal(h.el('Apply').disabled, true); assert.equal(h.memory(), h.value.source.content);
  }
});

test('forced close invalidates a pending apply guard before source memory can be replaced', async t => {
  const reached = deferred(), release = deferred(); let accepted = 0;
  const h = await harness(t, { apply: async (proposal, guard) => {
    await prepareSceneCompositionBatchLayoutApply(h.value.source, proposal, { digest: hash }); assert.equal(guard.isCurrent(), true);
    reached.resolve(); await release.promise;
    if (!guard.isCurrent()) throw Object.assign(new Error('Closed'), { errorCode: 'scene_composition_override_conflict' });
    accepted++; return { applied: true };
  } });
  h.move([470, 225]); await h.check(); h.el('Apply').click(); await reached.promise;
  h.el('Dialog').close(); await flushDialogs(); release.resolve(); await settle(h);
  assert.equal(accepted, 0); assert.equal(h.applied.length, 0); assert.equal(h.el('Dialog').open, false); assert.equal(h.memory(), h.value.source.content);
});

test('a stale asynchronous opening releases its Rust batch without replacing a newer layout', async t => {
  const release = deferred(); let calls = 0, disposed = 0;
  const h = await harness(t, { skipOpen: true, factory: async (...args) => {
    const draft = await createSceneCompositionBatchLayoutDraft(...args); const result = { ...draft, dispose() { disposed++; draft.dispose(); } };
    if (++calls === 1) await release.promise; return result;
  } });
  const first = h.open(); await flushDialogs(); h.context.sceneDraftToken++; assert.equal(await h.open(), true);
  release.resolve(); assert.equal(await first, false); assert.equal(disposed, 1); assert.equal(h.el('X').value, '460');
  h.el('Cancel').click(); await flushDialogs(); assert.equal(disposed, 2);
});

test('an asynchronous opening failure loses its alert and cannot disturb a closed originating preview', async t => {
  const release = deferred(), h = await harness(t, { skipOpen: true, factory: async () => release.promise });
  const alerts = []; h.runtime.window.alert = text => alerts.push(text);
  const opening = h.open(); await flushDialogs(); h.setLive(false); release.reject(new Error('Late core failure'));
  assert.equal(await opening, false); assert.deepEqual(alerts, []); assert.equal(h.el('Dialog').open, false);
  assert.equal(h.memory(), h.value.source.content);
});

test('closing and destroying release only owned image copies and every Rust batch', async t => {
  let disposed = 0; const h = await harness(t, { skipOpen: true, factory: async (...args) => {
    const draft = await createSceneCompositionBatchLayoutDraft(...args); return { ...draft, dispose() { disposed++; draft.dispose(); } };
  } });
  const image = { width: 64, height: 32 };
  assert.equal(await h.open({ images: new Map([['image', image]]) }), true); assert.equal(h.copies.length, 1);
  h.el('Cancel').click(); await flushDialogs(); assert.equal(disposed, 1); assert.equal(h.copies[0].width, 0); assert.equal(h.copies[0].height, 0);
  assert.deepEqual(image, { width: 64, height: 32 });
  assert.equal(await h.open({ images: new Map([['image', image]]) }), true); h.controller.dispose(); await flushDialogs();
  assert.equal(disposed, 2); assert.equal(h.copies[1].width, 0); assert.equal(h.views.filter(item => item.name === 'destroy').length, 1);
  assert.equal(await h.open(), false); assert.deepEqual(image, { width: 64, height: 32 });
});

test('a history core failure retains geometry and does not obstruct batch teardown', async t => {
  let disposed = 0; const h = await harness(t, { factory: async (...args) => {
    const draft = await createSceneCompositionBatchLayoutDraft(...args); return { ...draft,
      undo() { throw Object.assign(new Error('Unavailable'), { errorCode: 'studio_core_unavailable' }); }, dispose() { disposed++; draft.dispose(); } };
  } });
  h.move([470, 225]); h.el('Undo').click(); assert.equal(h.el('X').value, '470'); assert.equal(h.el('Dialog').dataset.dirty, 'true');
  assert.match(h.el('Message').textContent, /组件未能加载/); h.el('Cancel').click(); await flushDialogs();
  assert.equal(disposed, 1); assert.equal(h.el('Dialog').open, false);
});

test('batch canvas and parent feedback messages are complete in English and Japanese', async () => {
  const source = await fs.readFile(new URL('../../web/modules/app-scene-composition-batch-layout.js', import.meta.url), 'utf8');
  const keys = [...source.matchAll(/(?:'([^'\n]*[\u3400-\u9fff][^'\n]*)'|data-i18n(?:-aria-label)?="([^"]+)")/g)].map(match => match[1] || match[2]);
  keys.push('配方批次布局暂不可用，请重新预览当前配方后重试。', '批次布局已应用到原文草稿；尚未保存。', '批次布局已应用；文本与已保存版本一致。');
  for (const key of new Set(keys)) { assert.ok(en[key], `English: ${key}`); assert.ok(ja[key], `Japanese: ${key}`); }
});
