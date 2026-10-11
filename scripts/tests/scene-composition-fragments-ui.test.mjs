import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash, webcrypto } from 'node:crypto';
import { createSceneCompositionFragmentDraft, prepareSceneCompositionFragmentApply } from '../../engine/scene-composition-fragments.mjs';
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
async function fixture({ dirty = false, inherit = true, templateValues = {}, bothMasked = false } = {}) {
  const observed = copy(golden.observed), recipe = copy(example);
  observed.source.workspace.version = 3; observed.source.definition = { documentTypes: [{ id: 'document', label: 'Document' }] };
  recipe.fragments[0].actors[0] = { key: 'leader', objectId: ids.first, groupKey: 'party', position: [120, 180], useProjectionDefaults: true, ...templateValues };
  recipe.fragments[0].actors[1].objectId = ids.first;
  if (inherit) recipe.placements[1].overrides[0].values.imageResourceId = null;
  if (!inherit) recipe.fragments[0].actors[0] = { ...recipe.fragments[0].actors[0], useProjectionDefaults: false,
    size: [80, 60], color: '#ffffff', speed: 160, controls: 'arrows', imageResourceId: ids.image, ...templateValues };
  if (bothMasked) recipe.placements[0].overrides = [{ actorKey: 'leader', values: { speed: 10 } }];
  const document = observed.source.documents.find(item => item.record.id === ids.scene);
  document.record.relations = []; document.record.assetBindings = [];
  document.content = '\uFEFF' + JSON.stringify(recipe, null, '\t').replaceAll('\n', '\r\n') + '\r\n \t'; document.sourceRevision = revision(document.content);
  for (const item of observed.source.documents) item.descriptor = { ...item.record };
  observed.projection = await createWorldProjection(observed.source, { digest: hash });
  const result = await resolveSceneCompositionPreview(observed, ids.scene, { digest: hash });
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  const plan = scene2DModelToPlan(result.model), baseSourceRevision = dirty ? revision('saved baseline') : document.sourceRevision;
  const model = { ok: true, format: 'viento-scene-preview', schemaVersion: 2,
    scene: plan.scene, actors: plan.actors, composition: result.composition, sourceLocations: result.model.sourceLocations,
    sceneStructure: createSceneStructure(result.model), resources: [], diagnostics: [],
    ...(dirty ? { draft: { baseSourceRevision, sourceRevision: document.sourceRevision } } : {}) };
  return { model, recipe, source: { sourcePath: document.sourcePath, content: document.content, baseSourceRevision }, actorId: model.actors[2].instanceId,
    images: [{ id: ids.image, name: 'Traveler portrait', path: 'portraits/traveler.svg' }] };
}
async function settle(h) {
  for (let index = 0; index < 100; index++) {
    await flushDialogs(); if (h.el('Dialog').getAttribute('aria-busy') !== 'true') return;
    await new Promise(resolve => setTimeout(resolve, 1));
  }
  assert.fail('Shared fragment form remained busy');
}
async function harness(t, options = {}) {
  const value = await fixture(options), validation = [], proposals = [], applied = [], guards = [];
  let memory = value.source.content, live = true;
  const context = { editable: true, dirty: Boolean(options.dirty), creating: false, busy: false, compositionSourceWritable: true,
    canEditCompositionFragment: true, sceneDraftPath: value.source.sourcePath, sceneDraftToken: 1 };
  const h = await dialogHarness('app-scene-composition-fragments', {
    crypto: webcrypto, queueMicrotask, createSceneCompositionFragmentDraft: options.factory || createSceneCompositionFragmentDraft,
    ...(options.supported === false ? { supportsStudioCoreCompositionFragment: () => false } : {}),
    requestWorldCommand() { assert.fail('The shared declaration form must not request World'); },
    fetchJsonApiRequest() { assert.fail('The parent owns full candidate dependency checks'); },
  });
  const controller = h.runtime.setupSceneCompositionFragments({ getContext: () => context,
    validateDraft: async (proposal, guard) => { validation.push(proposal); guards.push(guard); return options.validate ? options.validate(proposal, guard) : { ok: true }; },
    applySourceDraft: async (proposal, guard) => {
      proposals.push(proposal); if (options.apply) return options.apply(proposal, guard, context);
      const prepared = await prepareSceneCompositionFragmentApply({ ...value.source, content: memory }, proposal, { digest: hash });
      if (!guard.isCurrent()) throw Object.assign(new Error('The source owner changed'), { errorCode: 'scene_composition_override_conflict' });
      memory = prepared.afterContent; context.sceneDraftToken++; context.dirty = true; return { applied: true };
    }, sourceApplied: (result, proposal) => applied.push({ result, proposal }),
  });
  const el = suffix => h.element(`sceneCompositionFragments${suffix}`), open = (extra = {}) => controller.open({ ...value, isCurrent: () => live, ...extra });
  t.after(async () => { controller.destroy(); await flushDialogs(); });
  if (!options.skipOpen) assert.equal(await open(), true);
  const select = (suffix, selected = true) => { el(`${suffix}Selected`).checked = selected; el(`${suffix}Selected`).dispatch('change'); };
  const input = (suffix, raw) => { el(suffix).value = String(raw); el(suffix).dispatch(['Controls', 'Image'].includes(suffix) ? 'change' : 'input'); };
  const check = async () => { el('Check').click(); await settle({ el }); };
  return { ...h, el, value, context, controller, validation, proposals, applied, guards, open, input, select, check, memory: () => memory, setLive: v => { live = v; } };
}

test('raw fragment declarations appear disabled; selected instance overrides and projection defaults do not become template values', async t => {
  const h = await harness(t), before = copy(h.value);
  assert.equal(h.el('X').value, '120'); assert.equal(h.el('Y').value, '180'); assert.deepEqual(h.value.model.actors[2].position, [460, 220]);
  for (const suffix of ['Width', 'Height', 'Color', 'Speed', 'Controls', 'Image']) assert.equal(h.el(suffix).value, '');
  for (const suffix of ['X', 'Y', 'Width', 'Height', 'Color', 'Speed', 'Controls', 'Image']) assert.equal(h.el(suffix).disabled, true);
  assert.match(h.el('Identity').textContent, /party.*leader/); assert.doesNotMatch(h.el('Identity').textContent, /放置/);
  assert.equal(h.el('Targets').children.length, 2); assert.match(h.el('Impact').textContent, /2.*尚未选择/);
  assert.equal(h.el('Check').disabled, true); assert.equal(h.el('Apply').disabled, true);
  assert.equal(h.el('Dialog').dataset.dirty, 'false'); assert.deepEqual(h.value, before); assert.equal(h.memory(), before.source.content);
});

test('position is one explicit SET pair and reviews the full source with every referencing placement and mask', async t => {
  const h = await harness(t, { dirty: true }), before = copy(h.value);
  h.select('Position'); h.input('X', 130); await h.check();
  const candidate = copy(h.validation[0]); assert.deepEqual(candidate.values, { position: [130, 180] });
  assert.deepEqual(candidate.changedPaths, ['/fragments/0/actors/0/position']);
  assert.deepEqual(candidate.targets, [{ instanceId: h.value.model.actors[0].instanceId, placementId: h.value.recipe.placements[0].placementId, overrides: [] },
    { instanceId: h.value.actorId, placementId: h.value.recipe.placements[1].placementId, overrides: ['position', 'color', 'speed', 'controls', 'imageResourceId'] }]);
  const rows = h.el('Targets').children; assert.deepEqual(rows.map(row => row.dataset.instanceId), candidate.targets.map(row => row.instanceId));
  assert.match(rows[0].textContent, /参与共享修改.*局部位置/); assert.match(rows[1].textContent, /局部覆盖仍优先.*局部位置/);
  assert.match(h.el('Impact').textContent, /2.*1/); assert.equal(h.el('Review').open, true); assert.equal(h.el('Source').textContent, candidate.afterContent);
  assert.equal(h.memory(), before.source.content); assert.equal(h.proposals.length, 0); assert.equal(h.el('Apply').disabled, false);
  const expected = copy(before.recipe); expected.fragments[0].actors[0].position = [130, 180];
  assert.deepEqual(JSON.parse(candidate.afterContent.replace(/^\uFEFF/, '')), expected);
  assert.ok(candidate.afterContent.startsWith('\uFEFF{\r\n')); assert.ok(candidate.afterContent.endsWith('\r\n \t'));
  h.el('Apply').click(); await settle(h);
  assert.equal(h.el('Dialog').open, false); assert.equal(h.memory(), candidate.afterContent); assert.equal(h.context.dirty, true);
  assert.equal(h.applied.length, 1); assert.deepEqual(copy(h.applied[0].proposal), candidate); assert.deepEqual(h.value, before);
});

test('checking unchanged declared values performs no validation and creates no template patch', async t => {
  const h = await harness(t); h.select('Position'); assert.equal(h.el('Check').disabled, true);
  h.el('Check').dispatch('click'); await settle(h); assert.equal(h.validation.length, 0); assert.equal(h.el('Dialog').dataset.dirty, 'false');
  h.input('X', 121); h.input('X', 120); assert.equal(h.el('Check').disabled, true); assert.equal(h.memory(), h.value.source.content);
});

test('explicitly adding a missing declaration equal to the current inherited value still changes source', async t => {
  const h = await harness(t), actor = h.value.model.actors[0];
  h.select('Size'); h.input('Width', actor.size[0]); h.input('Height', actor.size[1]); await h.check();
  assert.deepEqual(copy(h.validation[0].values), { size: actor.size }); assert.deepEqual(copy(h.validation[0].changedPaths), ['/fragments/0/actors/0/size']);
  assert.equal(Object.hasOwn(h.value.recipe.fragments[0].actors[0], 'size'), false); assert.equal(h.el('Apply').disabled, false);
  assert.ok(h.el('Targets').children.every(row => /参与共享修改.*尺寸/.test(row.textContent)));
});

test('a missing size remains an empty pair until both dimensions are explicitly set', async t => {
  const h = await harness(t); assert.equal(h.el('Width').value, ''); assert.equal(h.el('Height').value, '');
  h.select('Size'); h.input('Width', 64); await h.check(); assert.equal(h.validation.length, 0); assert.equal(h.el('Width').value, '64');
  h.input('Height', 64); await h.check(); assert.deepEqual(copy(h.validation[0].values), { size: [64, 64] });
  assert.deepEqual(copy(h.validation[0].changedPaths), ['/fragments/0/actors/0/size']);
});

test('all six explicitly selected field sets update only the shared declaration and preserve every placement', async t => {
  const h = await harness(t);
  for (const suffix of ['Position', 'Size', 'Color', 'Speed', 'Controls', 'Image']) h.select(suffix);
  for (const [suffix, value] of [['X', 130], ['Y', 190], ['Width', 60], ['Height', 80], ['Color', '#aabbccdd'], ['Speed', 123.5], ['Controls', 'none'], ['Image', ids.image]]) h.input(suffix, value);
  await h.check(); assert.deepEqual(copy(h.validation[0].values), { position: [130, 190], size: [60, 80], color: '#aabbccdd', speed: 123.5, controls: 'none', imageResourceId: ids.image });
  assert.equal(h.validation[0].changedPaths.length, 6);
  const after = JSON.parse(h.validation[0].afterContent.replace(/^\uFEFF/, ''));
  assert.deepEqual(after.placements, h.value.recipe.placements); assert.deepEqual(after.fragments[0].groups, h.value.recipe.fragments[0].groups);
  assert.deepEqual(after.fragments[0].actors[1], h.value.recipe.fragments[0].actors[1]); assert.equal(after.fragments[0].actors[0].objectId, ids.first);
  assert.equal(after.fragments[0].actors[0].useProjectionDefaults, true); assert.equal(h.el('Apply').disabled, false);
});

test('unchecked fields preserve inheritance even if their raw inputs have been edited', async t => {
  const h = await harness(t); h.select('Color'); h.input('Color', '#aabbcc'); h.select('Color', false);
  h.select('Speed'); h.input('Speed', 50); await h.check();
  assert.deepEqual(copy(h.validation[0].values), { speed: 50 });
  const after = JSON.parse(h.validation[0].afterContent.replace(/^\uFEFF/, ''));
  assert.equal(Object.hasOwn(after.fragments[0].actors[0], 'color'), false); assert.equal(h.el('Color').value, '#aabbcc'); assert.equal(h.el('Color').disabled, true);
});

test('the reviewed impact omits checked fields whose declaration is unchanged', async t => {
  const h = await harness(t); h.select('Position'); h.select('Color'); h.input('Color', '#aabbcc'); await h.check();
  assert.deepEqual(copy(h.validation[0].values), { color: '#aabbcc' }); assert.doesNotMatch(h.el('Targets').textContent, /局部位置/);
  assert.match(h.el('Targets').textContent, /颜色/);
});

test('all locally masked instances explicitly report a declaration-only edit that still passes source checking', async t => {
  const h = await harness(t, { bothMasked: true }); h.select('Speed'); h.input('Speed', 100); await h.check();
  assert.match(h.el('Impact').textContent, /所有引用实例均有局部覆盖.*只更新片段声明/);
  assert.ok(h.el('Targets').children.every(row => /局部覆盖仍优先.*速度/.test(row.textContent)));
  assert.equal(h.el('Apply').disabled, false); assert.equal(h.validation[0].targets.length, 2);
});

test('image omission is blank and separate from an explicit null allowed by projection inheritance', async t => {
  const h = await harness(t); assert.equal(h.el('Image').value, '');
  assert.ok(h.el('Image').children.some(item => item.value === '__none__')); assert.ok(h.el('Image').children.some(item => /Traveler portrait.*portraits/.test(item.textContent)));
  h.select('Image'); await h.check(); assert.equal(h.validation.length, 0); assert.match(h.el('Message').textContent, /所选字段/);
  h.input('Image', '__none__'); await h.check(); assert.deepEqual(copy(h.validation[0].values), { imageResourceId: null });
  assert.deepEqual(copy(h.validation[0].changedPaths), ['/fragments/0/actors/0/imageResourceId']);
  assert.match(h.el('Targets').children[1].textContent, /局部覆盖仍优先.*场景图片/);
});

test('an already declared null is shown explicitly and selecting that same null is a no-op', async t => {
  const h = await harness(t, { templateValues: { imageResourceId: null } }); assert.equal(h.el('Image').value, '__none__');
  assert.match(h.el('ImageStatus').textContent, /已声明/); h.select('Image'); assert.equal(h.el('Check').disabled, true);
  h.el('Check').dispatch('click'); await settle(h); assert.equal(h.validation.length, 0);
  h.input('Image', ids.image); await h.check(); assert.deepEqual(copy(h.validation[0].values), { imageResourceId: ids.image });
});

test('a noninheriting fragment cannot explicitly clear its image and retains an unavailable declaration in the picker', async t => {
  const h = await harness(t, { inherit: false, skipOpen: true }); assert.equal(await h.open({ images: [] }), true);
  assert.equal(h.el('Image').value, ids.image); assert.ok(h.el('Image').children.some(item => item.value === ids.image && /资源不可用/.test(item.textContent)));
  assert.ok(h.el('Image').children.every(item => item.value !== '__none__'));
  h.select('Image'); h.input('Image', '__none__'); await h.check(); assert.equal(h.validation.length, 0); assert.equal(h.el('Apply').disabled, true);
  assert.match(h.el('Message').textContent, /所选字段/); assert.equal(h.memory(), h.value.source.content);
});

test('each invalid selected field is rejected without consuming unfinished input or altering source', async t => {
  const h = await harness(t);
  for (const [group, suffix, raw] of [['Position', 'X', ''], ['Size', 'Width', '0'], ['Color', 'Color', 'red'], ['Speed', 'Speed', '2001'], ['Controls', 'Controls', 'gamepad'], ['Image', 'Image', 'not-a-resource']]) {
    h.select(group); if (group === 'Size') h.input('Height', 64); h.input(suffix, raw); await h.check();
    assert.equal(h.validation.length, 0, suffix); assert.equal(h.el(suffix).value, raw); assert.equal(h.el('Apply').disabled, true); h.select(group, false);
  }
  assert.equal(h.memory(), h.value.source.content); assert.equal(h.proposals.length, 0);
});

test('silently changing a numeric field after approval invalidates the candidate before application', async t => {
  const h = await harness(t); h.select('Position'); h.input('X', 130); await h.check();
  h.el('Y').value = '999'; h.el('Apply').dispatch('click'); await settle(h);
  assert.equal(h.proposals.length, 0); assert.equal(h.el('Apply').disabled, true); assert.equal(h.el('Review').hidden, true); assert.equal(h.el('Y').value, '999');
});

test('silently changing selected checkboxes or unchecked raw fields also revokes approval', async t => {
  const h = await harness(t); h.select('Speed'); h.input('Speed', 100); await h.check();
  h.el('ColorSelected').checked = true; h.el('Color').value = '#aabbcc'; h.el('Apply').dispatch('click'); await settle(h);
  assert.equal(h.proposals.length, 0); assert.equal(h.el('Apply').disabled, true);
  h.select('Color', false); await h.check(); assert.equal(h.el('Apply').disabled, false);
  h.el('Color').value = '#ffffff'; h.controller.refresh(); assert.equal(h.el('Apply').disabled, true); assert.equal(h.el('Review').hidden, true);
});

test('dependency validation receives detached canonical values and targets rather than mutable approval state', async t => {
  const h = await harness(t, { validate(candidate) { candidate.values.speed = 0; candidate.targets[0].overrides.push('speed'); candidate.afterContent = 'tampered'; return { ok: true }; } });
  h.select('Speed'); h.input('Speed', 100); await h.check(); assert.equal(h.el('Apply').disabled, false);
  assert.notEqual(h.el('Source').textContent, 'tampered'); h.el('Apply').click(); await settle(h);
  assert.deepEqual(copy(h.proposals[0].values), { speed: 100 }); assert.deepEqual(copy(h.proposals[0].targets[0].overrides), []);
  assert.deepEqual(copy(h.applied[0].proposal), copy(h.proposals[0]));
});

test('pending dependency checks lock all controls and a silent raw change cannot approve the late result', async t => {
  const wait = deferred(), h = await harness(t, { validate: () => wait.promise });
  h.select('Speed'); h.input('Speed', 100); h.el('Check').click(); await flushDialogs();
  for (const suffix of ['PositionSelected', 'SizeSelected', 'ColorSelected', 'SpeedSelected', 'ControlsSelected', 'ImageSelected', 'Speed', 'Check', 'Apply', 'Close', 'Cancel']) assert.equal(h.el(suffix).disabled, true, suffix);
  assert.equal(h.controller.close(), false); h.el('Speed').value = '101'; wait.resolve({ ok: true }); await settle(h);
  assert.equal(h.el('Apply').disabled, true); assert.equal(h.el('Speed').value, '101'); assert.equal(h.el('Review').hidden, true); assert.equal(h.memory(), h.value.source.content);
});

test('failed validation retains author input and diagnostics without granting application', async t => {
  const h = await harness(t, { validate: () => ({ ok: false, diagnostics: [{ code: 'asset_missing', propertyPath: '/fragments/0/actors/0/imageResourceId' }] }) });
  h.select('Image'); h.input('Image', ids.image); await h.check();
  assert.equal(h.el('Apply').disabled, true); assert.equal(h.el('Image').value, ids.image); assert.match(h.el('Diagnostics').textContent, /asset_missing.*imageResourceId/);
  assert.equal(h.el('Review').hidden, false); assert.equal(h.memory(), h.value.source.content);
});

test('parent source token or ownership changes revoke approval while preserving the form for inspection', async t => {
  const h = await harness(t); h.select('Speed'); h.input('Speed', 100); await h.check(); h.context.sceneDraftToken++; h.controller.refresh();
  assert.equal(h.el('Apply').disabled, true); assert.equal(h.el('Speed').value, '100'); assert.match(h.el('Message').textContent, /原文或预览已变化/);
  h.el('Apply').dispatch('click'); await settle(h); assert.equal(h.proposals.length, 0); assert.equal(h.memory(), h.value.source.content);
});

test('late validation after parent closure cannot approve or apply a shared edit', async t => {
  const wait = deferred(), h = await harness(t, { validate: () => wait.promise }); h.select('Speed'); h.input('Speed', 100); h.el('Check').click();
  h.setLive(false); wait.resolve({ ok: true }); await settle(h); assert.equal(h.guards[0].isCurrent(), false);
  assert.equal(h.el('Apply').disabled, true); assert.match(h.el('Message').textContent, /原文或预览已变化/); assert.equal(h.proposals.length, 0);
});

test('late open success or failure after owner loss stays silent and never opens an expired form', async t => {
  const success = deferred(), h = await harness(t, { skipOpen: true, factory: () => success.promise }), alerts = [];
  h.runtime.window.alert = message => alerts.push(message); const opening = h.open(); h.setLive(false); success.resolve({});
  assert.equal(await opening, false); assert.equal(h.el('Dialog').open, false); assert.deepEqual(alerts, []);
  const failure = deferred(), other = await harness(t, { skipOpen: true, factory: () => failure.promise }); other.runtime.window.alert = message => alerts.push(message);
  const failing = other.open(); other.context.sceneDraftToken++; failure.reject(new Error('late failure'));
  assert.equal(await failing, false); assert.equal(other.el('Dialog').open, false); assert.deepEqual(alerts, []);
});

test('a newer asynchronous open supersedes the earlier request without replacing its established form', async t => {
  const first = deferred(); let calls = 0;
  const h = await harness(t, { skipOpen: true, factory(...args) { calls++; return calls === 1 ? first.promise : createSceneCompositionFragmentDraft(...args); } });
  const earlier = h.open(); assert.equal(await h.open({ actorId: h.value.model.actors[1].instanceId }), true);
  assert.match(h.el('Identity').textContent, /companion/); first.resolve({}); assert.equal(await earlier, false);
  assert.equal(h.el('Dialog').open, true); assert.match(h.el('Identity').textContent, /companion/); assert.equal(h.el('X').value, '200');
});

test('cancelling or returning to preview discards only the unapplied fragment proposal and restores opener focus', async t => {
  const h = await harness(t, { skipOpen: true }), opener = h.document.createElement('button'); h.document.body.append(opener); opener.focus(); assert.equal(await h.open(), true);
  h.select('Speed'); h.input('Speed', 100); await h.check(); h.runtime.window.confirm = () => false;
  h.el('Cancel').click(); assert.equal(h.el('Dialog').open, true); assert.equal(h.el('Speed').value, '100');
  h.runtime.window.confirm = () => true; h.el('Close').click(); await flushDialogs(); await flushDialogs();
  assert.equal(h.el('Dialog').open, false); assert.equal(h.document.activeElement, opener); assert.equal(h.proposals.length, 0); assert.equal(h.memory(), h.value.source.content);
  assert.equal(await h.open(), true); assert.equal(h.el('SpeedSelected').checked, false); assert.equal(h.el('Speed').value, '');
});

test('an unaccepted or stale apply preserves edits, requires rechecking and cannot report completion', async t => {
  const wait = deferred(), h = await harness(t, { apply: async (candidate, guard) => { await wait.promise; if (!guard.isCurrent()) throw new Error('stale apply'); return { applied: false }; } });
  h.select('Speed'); h.input('Speed', 100); await h.check(); h.el('Apply').click(); await flushDialogs();
  assert.equal(h.el('Cancel').disabled, true); h.setLive(false); wait.resolve(); await settle(h);
  assert.equal(h.applied.length, 0); assert.equal(h.el('Dialog').open, true); assert.equal(h.el('Speed').value, '100'); assert.equal(h.el('Apply').disabled, true); assert.equal(h.memory(), h.value.source.content);
});

test('a silent raw change while application is pending invalidates the guard before a host can edit source', async t => {
  const wait = deferred(), h = await harness(t, { apply: async (candidate, guard) => { await wait.promise; assert.equal(guard.isCurrent(), false); throw new Error('Raw fields changed before application'); } });
  h.select('Speed'); h.input('Speed', 100); await h.check(); h.el('Apply').click(); await flushDialogs();
  h.el('Speed').value = '102'; wait.resolve(); await settle(h);
  assert.equal(h.applied.length, 0); assert.equal(h.el('Dialog').open, true); assert.equal(h.el('Speed').value, '102'); assert.equal(h.el('Apply').disabled, true);
  assert.equal(h.el('Review').hidden, true); assert.equal(h.memory(), h.value.source.content);
});

test('destroying during an asynchronous apply cannot complete into a replaced dialog and dispose is idempotent', async t => {
  const wait = deferred(), h = await harness(t, { apply: () => wait.promise }); h.select('Speed'); h.input('Speed', 100); await h.check();
  h.el('Apply').click(); const dialog = h.el('Dialog'); h.controller.dispose(); h.controller.destroy(); wait.resolve({ applied: true }); await flushDialogs(); await flushDialogs();
  assert.equal(h.applied.length, 0); assert.equal(dialog.open, false); assert.equal(await h.open(), false); assert.equal(h.memory(), h.value.source.content);
});

test('read-only or missing fragment capability never creates a draft', async t => {
  const h = await harness(t, { skipOpen: true, factory() { assert.fail('An ineligible source must not create a draft'); } });
  for (const [key, value] of [['canEditCompositionFragment', false], ['compositionSourceWritable', false], ['editable', false], ['busy', true], ['creating', true]]) {
    const before = h.context[key]; h.context[key] = value; assert.equal(await h.open(), false); h.context[key] = before;
  }
  const other = await harness(t, { skipOpen: true, supported: false, factory() { assert.fail('Unsupported core must not create a fragment draft'); } }); assert.equal(await other.open(), false);
});

test('Chinese, English and Japanese include every new shared-fragment workflow message and placeholder', async () => {
  const source = await fs.readFile(new URL('../../web/modules/app-scene-composition-fragments.js', import.meta.url), 'utf8');
  const keys = new Set([...source.matchAll(/data-i18n="([^"$]+)"/g)].map(match => match[1]));
  for (const match of source.matchAll(/(?:t\(|message = |\? |: |report\(error, )'([^']*[\u4e00-\u9fff][^']*)'/g)) keys.add(match[1]);
  for (const key of keys) for (const language of [en, ja]) {
    assert.equal(typeof language[key], 'string', key); assert.ok(language[key].length);
    assert.deepEqual(language[key].match(/\{\d+\}/g) || [], key.match(/\{\d+\}/g) || [], key);
  }
  for (const key of ['编辑共享片段', '修改会作用于引用此片段的多个放置；局部覆盖仍优先。', '共享片段已应用到原文草稿；尚未保存。', '共享片段已应用；文本与已保存版本一致。']) assert.ok(en[key] && ja[key]);
});
