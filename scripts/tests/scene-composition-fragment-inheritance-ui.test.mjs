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
const resets = ['Size', 'Color', 'Speed', 'Controls', 'Image'];
async function fixture({ inherit = true, omit = [], maskAll = false, dirty = false, imageNull = false } = {}) {
  const observed = copy(golden.observed), recipe = copy(example);
  observed.source.workspace.version = 3; observed.source.definition = { documentTypes: [{ id: 'document', label: 'Document' }] };
  recipe.fragments[0].actors[0] = { key: 'leader', objectId: ids.first, groupKey: 'party', position: [120, 180], useProjectionDefaults: inherit,
    size: [80, 60], color: '#ffffff', speed: 160, controls: 'arrows', imageResourceId: imageNull ? null : ids.image };
  recipe.fragments[0].actors[1].objectId = ids.first;
  if (inherit) recipe.placements[1].overrides[0].values.imageResourceId = null;
  for (const key of omit) delete recipe.fragments[0].actors[0][key];
  if (maskAll) recipe.placements[0].overrides = [{ actorKey: 'leader', values: { speed: 12 } }];
  const document = observed.source.documents.find(item => item.record.id === ids.scene);
  document.record.relations = []; document.record.assetBindings = [];
  document.content = '\uFEFF' + JSON.stringify(recipe, null, '\t').replaceAll('\n', '\r\n') + '\r\n \t'; document.sourceRevision = revision(document.content);
  for (const item of observed.source.documents) item.descriptor = { ...item.record };
  observed.projection = await createWorldProjection(observed.source, { digest: hash });
  const preview = await resolveSceneCompositionPreview(observed, ids.scene, { digest: hash });
  assert.equal(preview.ok, true, JSON.stringify(preview.diagnostics));
  const plan = scene2DModelToPlan(preview.model), baseSourceRevision = dirty ? revision('saved baseline') : document.sourceRevision;
  const model = { ok: true, format: 'viento-scene-preview', schemaVersion: 2, scene: plan.scene, actors: plan.actors, composition: preview.composition,
    sourceLocations: preview.model.sourceLocations, sceneStructure: createSceneStructure(preview.model), resources: [], diagnostics: [],
    ...(dirty ? { draft: { baseSourceRevision, sourceRevision: document.sourceRevision } } : {}) };
  return { model, source: { sourcePath: document.sourcePath, content: document.content, baseSourceRevision }, recipe, actorId: model.actors[2].instanceId,
    images: [{ id: ids.image, name: 'Traveler', path: 'portraits/traveler.svg' }] };
}
async function settle(h) {
  for (let i = 0; i < 100; i++) { await flushDialogs(); if (h.el('Dialog').getAttribute('aria-busy') !== 'true') return; await new Promise(resolve => setTimeout(resolve, 1)); }
  assert.fail('Fragment inheritance UI remained busy');
}
async function harness(t, options = {}) {
  const value = await fixture(options), validation = [], proposals = [], applied = [], guards = [];
  let memory = value.source.content, live = true;
  const context = { editable: true, creating: false, busy: false, dirty: Boolean(options.dirty), compositionSourceWritable: true,
    canEditCompositionFragment: true, sceneDraftPath: value.source.sourcePath, sceneDraftToken: 1 };
  const h = await dialogHarness('app-scene-composition-fragments', {
    crypto: webcrypto, queueMicrotask, createSceneCompositionFragmentDraft: options.factory || createSceneCompositionFragmentDraft,
    ...(options.editSupported === false ? { supportsStudioCoreCompositionFragmentEdit: () => false } : {}),
    requestWorldCommand() { assert.fail('Fragment form must not fetch World or save authors'); },
    fetchJsonApiRequest() { assert.fail('The parent owns complete candidate dependency validation'); },
  });
  const controller = h.runtime.setupSceneCompositionFragments({ getContext: () => context,
    validateDraft: async (candidate, guard) => { validation.push(candidate); guards.push(guard); return options.validate ? options.validate(candidate, guard) : { ok: true }; },
    applySourceDraft: async (candidate, guard) => {
      proposals.push(candidate); if (options.apply) return options.apply(candidate, guard, context);
      const prepared = await prepareSceneCompositionFragmentApply({ ...value.source, content: memory }, candidate, { digest: hash });
      if (!guard.isCurrent()) throw Object.assign(new Error('Source owner changed'), { errorCode: 'scene_composition_override_conflict' });
      memory = prepared.afterContent; context.sceneDraftToken++; context.dirty = true; return { applied: true };
    }, sourceApplied: (result, candidate) => applied.push({ result, candidate }),
  });
  const el = suffix => h.element(`sceneCompositionFragments${suffix}`), open = (extra = {}) => controller.open({ ...value, isCurrent: () => live, ...extra });
  t.after(async () => { controller.destroy(); await flushDialogs(); });
  if (!options.skipOpen) assert.equal(await open(), true);
  const toggle = (suffix, property, checked = true, event = true) => { el(`${suffix}${property}`).checked = checked; if (event) el(`${suffix}${property}`).dispatch('change'); };
  const input = (suffix, raw) => { el(suffix).value = String(raw); el(suffix).dispatch(['Image', 'Controls'].includes(suffix) ? 'change' : 'input'); };
  const check = async () => { el('Check').click(); await settle({ el }); };
  return { ...h, el, value, controller, context, validation, proposals, applied, guards, open, input, check, toggle,
    restore: (suffix, checked = true) => toggle(suffix, 'Reset', checked), select: (suffix, checked = true) => toggle(suffix, 'Selected', checked),
    memory: () => memory, setLive: v => { live = v; } };
}

test('projection-enabled declarations expose five unchecked restorations and never offer position removal', async t => {
  const h = await harness(t); assert.equal(h.el('PositionReset'), null);
  for (const suffix of resets) { assert.equal(h.el(`${suffix}Reset`).checked, false); assert.equal(h.el(`${suffix}Reset`).disabled, false); assert.equal(h.el(`${suffix}Selected`).checked, false); }
  assert.match(h.el('ResetHelp').textContent, /移除共享片段声明.*投影继承.*局部覆盖.*位置声明必须保留/);
  assert.equal(h.el('Check').disabled, true); assert.equal(h.memory(), h.value.source.content);
});

test('undeclared optional fields have disabled restoration controls without inventing defaults', async t => {
  const h = await harness(t, { omit: ['size', 'color', 'speed', 'controls', 'imageResourceId'] });
  for (const suffix of resets) assert.equal(h.el(`${suffix}Reset`).disabled, true);
  for (const suffix of ['Width', 'Height', 'Color', 'Speed', 'Controls', 'Image']) assert.equal(h.el(suffix).value, '');
  h.restore('Size'); assert.equal(h.el('SizeReset').checked, false); assert.equal(h.el('Check').disabled, true); assert.equal(h.validation.length, 0);
});

test('pure restoration reviews a real declaration deletion while retaining displayed values and every local override', async t => {
  const h = await harness(t, { dirty: true }), before = copy(h.value);
  h.restore('Size'); assert.equal(h.el('Width').value, '80'); assert.equal(h.el('Height').value, '60'); assert.equal(h.el('Width').disabled, true);
  assert.equal(h.el('SizeSelected').checked, false); assert.match(h.el('SizeStatus').textContent, /恢复前的声明/); await h.check();
  const candidate = copy(h.validation[0]); assert.deepEqual(candidate.values, {}); assert.deepEqual(candidate.reset, ['size']);
  assert.deepEqual(candidate.changedPaths, ['/fragments/0/actors/0/size']); assert.equal(candidate.baseSourceRevision, before.source.baseSourceRevision);
  const after = JSON.parse(candidate.afterContent.replace(/^\uFEFF/, '')), expected = copy(before.recipe); delete expected.fragments[0].actors[0].size;
  assert.deepEqual(after, expected); assert.match(h.el('Targets').children[0].textContent, /重新继承投影.*尺寸/);
  assert.ok(candidate.afterContent.startsWith('\uFEFF{\r\n')); assert.ok(candidate.afterContent.endsWith('\r\n \t'));
  assert.equal(h.memory(), before.source.content); h.el('Apply').click(); await settle(h);
  assert.equal(h.memory(), candidate.afterContent); assert.equal(h.context.dirty, true); assert.equal(h.applied.length, 1); assert.equal(h.el('Dialog').open, false); assert.deepEqual(h.value, before);
});

test('mixed set and five restores produce one atomic candidate with net fields in canonical order', async t => {
  const h = await harness(t); for (const suffix of [...resets].reverse()) h.restore(suffix);
  h.select('Position'); h.input('X', 130); await h.check(); const candidate = copy(h.validation[0]);
  assert.deepEqual(candidate.values, { position: [130, 180] }); assert.deepEqual(candidate.reset, ['size', 'color', 'speed', 'controls', 'imageResourceId']);
  assert.equal(candidate.changedPaths.length, 6); const after = JSON.parse(candidate.afterContent.replace(/^\uFEFF/, ''));
  assert.deepEqual(after.fragments[0].actors[0], { key: 'leader', objectId: ids.first, groupKey: 'party', position: [130, 180], useProjectionDefaults: true });
  assert.deepEqual(after.placements, h.value.recipe.placements); assert.deepEqual(after.fragments[0].actors[1], h.value.recipe.fragments[0].actors[1]);
  assert.match(h.el('Targets').children[1].textContent, /局部覆盖仍优先.*局部位置.*颜色.*速度.*控制.*场景图片/);
});

test('selecting SET and restoration is mutually exclusive without erasing raw author input', async t => {
  const h = await harness(t); h.select('Speed'); h.input('Speed', 77); h.restore('Speed');
  assert.equal(h.el('SpeedSelected').checked, false); assert.equal(h.el('SpeedReset').checked, true); assert.equal(h.el('Speed').disabled, true); assert.equal(h.el('Speed').value, '77');
  h.select('Speed'); assert.equal(h.el('SpeedReset').checked, false); assert.equal(h.el('Speed').disabled, false); assert.equal(h.el('Speed').value, '77');
  await h.check(); assert.deepEqual(copy(h.validation[0].values), { speed: 77 }); assert.equal(Object.hasOwn(h.validation[0], 'reset'), false);
  h.restore('Speed'); h.restore('Speed', false); assert.equal(h.el('SpeedSelected').checked, false); assert.equal(h.el('Speed').value, '77'); assert.equal(h.el('Check').disabled, true);
});

test('an abandoned invalid numeric SET input is not substituted for a declaration deletion', async t => {
  const h = await harness(t); h.select('Size'); h.input('Width', ''); h.restore('Size'); await h.check();
  assert.deepEqual(copy(h.validation[0].values), {}); assert.deepEqual(copy(h.validation[0].reset), ['size']); assert.equal(h.el('Width').value, '');
  h.select('Size'); await h.check(); assert.equal(h.validation.length, 1); assert.equal(h.el('Apply').disabled, true); assert.equal(h.el('Width').value, '');
});

test('restoring an explicit null image is deletion and re-inheritance rather than another explicit no-image SET', async t => {
  const h = await harness(t, { imageNull: true }); assert.equal(h.el('Image').value, '__none__'); h.restore('Image'); await h.check();
  assert.deepEqual(copy(h.validation[0].values), {}); assert.deepEqual(copy(h.validation[0].reset), ['imageResourceId']);
  assert.equal(Object.hasOwn(JSON.parse(h.validation[0].afterContent.replace(/^\uFEFF/, '')).fragments[0].actors[0], 'imageResourceId'), false);
  assert.match(h.el('Targets').children[0].textContent, /重新继承投影.*场景图片/); assert.match(h.el('Targets').children[1].textContent, /局部覆盖仍优先.*场景图片/);
  assert.equal(h.el('Image').value, '__none__');
});

test('without projection inheritance only image removal is available and its impact is explicitly no-image', async t => {
  const h = await harness(t, { inherit: false });
  for (const suffix of ['Size', 'Color', 'Speed', 'Controls']) assert.equal(h.el(`${suffix}Reset`).disabled, true);
  assert.equal(h.el('ImageReset').disabled, false); assert.match(h.el('ImageResetLabel').textContent, /移除图片声明/); assert.match(h.el('ResetHelp').textContent, /未启用投影继承.*移除后无图/);
  h.restore('Image'); await h.check(); assert.deepEqual(copy(h.validation[0].reset), ['imageResourceId']);
  assert.match(h.el('Targets').children[0].textContent, /移除共享图片声明后不使用图片/); assert.doesNotMatch(h.el('Targets').textContent, /重新继承投影/);
  const after = JSON.parse(h.validation[0].afterContent.replace(/^\uFEFF/, '')); assert.equal(Object.hasOwn(after.fragments[0].actors[0], 'imageResourceId'), false);
  assert.equal(after.fragments[0].actors[0].useProjectionDefaults, false); assert.deepEqual(after.placements, h.value.recipe.placements);
});

test('all local masks still allow a real shared declaration deletion without implying effective instance changes', async t => {
  const h = await harness(t, { maskAll: true }); h.restore('Speed'); await h.check();
  assert.match(h.el('Impact').textContent, /所有引用实例均有局部覆盖.*只更新片段声明/);
  assert.ok(h.el('Targets').children.every(row => /局部覆盖仍优先.*速度/.test(row.textContent))); assert.equal(h.el('Apply').disabled, false);
  assert.equal(h.validation[0].targets.length, 2); assert.deepEqual(copy(h.validation[0].reset), ['speed']);
});

test('missing edit capability only disables restoration and retains the exact old SET proposal path', async t => {
  let edits = 0;
  const h = await harness(t, { editSupported: false, factory: async (...args) => { const draft = await createSceneCompositionFragmentDraft(...args); return { ...draft, proposeEdit() { edits++; assert.fail('Old core SET must not call fragment edit'); } }; } });
  for (const suffix of resets) assert.equal(h.el(`${suffix}Reset`).disabled, true); assert.match(h.el('ResetHelp').textContent, /字段设置仍可使用/);
  h.select('Speed'); h.input('Speed', 77); await h.check(); assert.deepEqual(copy(h.validation[0].values), { speed: 77 }); assert.equal(Object.hasOwn(h.validation[0], 'reset'), false);
  assert.equal(edits, 0); assert.equal(h.el('Apply').disabled, false); h.el('Apply').click(); await settle(h); assert.equal(h.applied.length, 1);
});

test('silently enabling a reset after SET approval cannot apply the earlier candidate', async t => {
  const h = await harness(t); h.select('Position'); h.input('X', 130); await h.check();
  h.toggle('Size', 'Reset', true, false); h.el('Apply').dispatch('click'); await settle(h);
  assert.equal(h.proposals.length, 0); assert.equal(h.el('Apply').disabled, true); assert.equal(h.el('Review').hidden, true); assert.equal(h.memory(), h.value.source.content);
});

test('silently removing a selected restore or modifying its disabled raw value revokes restoration approval', async t => {
  const h = await harness(t); h.restore('Size'); await h.check(); h.toggle('Size', 'Reset', false, false); h.controller.refresh();
  assert.equal(h.el('Apply').disabled, true); assert.equal(h.el('Review').hidden, true); h.restore('Size'); await h.check();
  h.el('Width').value = '999'; h.el('Apply').dispatch('click'); await settle(h);
  assert.equal(h.proposals.length, 0); assert.equal(h.el('Apply').disabled, true); assert.equal(h.el('Width').value, '999');
});

test('a silent SET/RESET overlap is rejected atomically rather than choosing one intent', async t => {
  const h = await harness(t); h.restore('Speed'); h.toggle('Speed', 'Selected', true, false); h.el('Speed').value = '77'; await h.check();
  assert.equal(h.validation.length, 0); assert.equal(h.el('Apply').disabled, true); assert.equal(h.memory(), h.value.source.content); assert.match(h.el('Message').textContent, /所选字段/);
});

test('reset targets and canonical candidate are detached from dependency validator mutations', async t => {
  const h = await harness(t, { validate(candidate) { candidate.reset.length = 0; candidate.targets[0].overrides.push('size'); candidate.afterContent = 'tampered'; return { ok: true }; } });
  h.restore('Size'); await h.check(); assert.equal(h.el('Apply').disabled, false); assert.notEqual(h.el('Source').textContent, 'tampered');
  h.el('Apply').click(); await settle(h); assert.deepEqual(copy(h.proposals[0].reset), ['size']); assert.deepEqual(copy(h.proposals[0].targets[0].overrides), []);
  assert.deepEqual(copy(h.applied[0].candidate), copy(h.proposals[0]));
});

test('pending full checks lock restoration and a late silent restore change cannot grant approval', async t => {
  const wait = deferred(), h = await harness(t, { validate: () => wait.promise }); h.restore('Size'); h.el('Check').click(); await flushDialogs();
  for (const suffix of resets) { assert.equal(h.el(`${suffix}Reset`).disabled, true); assert.equal(h.el(`${suffix}Selected`).disabled, true); }
  assert.equal(h.controller.close(), false); h.toggle('Size', 'Reset', false, false); wait.resolve({ ok: true }); await settle(h);
  assert.equal(h.el('Apply').disabled, true); assert.equal(h.el('Review').hidden, true); assert.equal(h.memory(), h.value.source.content);
});

test('invalid full inheritance dependencies retain the removal choice and diagnostics without application', async t => {
  const h = await harness(t, { validate: () => ({ ok: false, diagnostics: [{ code: 'projection_missing', propertyPath: '/fragments/0/actors/0/size' }] }) });
  h.restore('Size'); await h.check(); assert.equal(h.el('SizeReset').checked, true); assert.equal(h.el('Width').value, '80');
  assert.equal(h.el('Apply').disabled, true); assert.match(h.el('Diagnostics').textContent, /projection_missing.*size/); assert.equal(h.memory(), h.value.source.content);
});

test('stale source tokens and late parent completion revoke restoration authority while retaining declarations', async t => {
  const wait = deferred(), h = await harness(t, { validate: () => wait.promise }); h.restore('Color'); h.el('Check').click(); h.context.sceneDraftToken++; wait.resolve({ ok: true }); await settle(h);
  assert.equal(h.guards[0].isCurrent(), false); assert.equal(h.el('Apply').disabled, true); assert.equal(h.el('ColorReset').checked, true); assert.equal(h.el('Color').value, '#ffffff');
  assert.match(h.el('Message').textContent, /原文或预览已变化/); assert.equal(h.proposals.length, 0);
});

test('a reset changed silently while application awaits makes the host guard reject without completion', async t => {
  const wait = deferred(), h = await harness(t, { apply: async (candidate, guard) => { await wait.promise; assert.equal(guard.isCurrent(), false); throw new Error('Restoration intent changed'); } });
  h.restore('Size'); await h.check(); h.el('Apply').click(); await flushDialogs(); h.toggle('Size', 'Reset', false, false); wait.resolve(); await settle(h);
  assert.equal(h.applied.length, 0); assert.equal(h.el('Dialog').open, true); assert.equal(h.el('Apply').disabled, true); assert.equal(h.memory(), h.value.source.content);
});

test('cancel and reopen discard only restoration selections and leave the main source unchanged', async t => {
  const h = await harness(t); h.restore('Size'); await h.check(); h.runtime.window.confirm = () => false; h.el('Cancel').click(); assert.equal(h.el('Dialog').open, true);
  h.runtime.window.confirm = () => true; h.el('Close').click(); await flushDialogs(); assert.equal(h.el('Dialog').open, false); assert.equal(h.memory(), h.value.source.content);
  assert.equal(await h.open(), true); for (const suffix of resets) assert.equal(h.el(`${suffix}Reset`).checked, false); assert.equal(h.el('Width').value, '80'); assert.equal(h.el('Check').disabled, true);
});

test('all restoration explanations and dynamic intent labels are available in English and Japanese', async () => {
  const source = await fs.readFile(new URL('../../web/modules/app-scene-composition-fragments.js', import.meta.url), 'utf8');
  const keys = new Set(['恢复继承', '移除图片声明', ...[...source.matchAll(/(?:t\(|\? |: )'([^']*[\u4e00-\u9fff][^']*)'/g)].map(match => match[1])]);
  for (const key of keys) for (const language of [en, ja]) { assert.equal(typeof language[key], 'string', key); assert.deepEqual(language[key].match(/\{\d+\}/g) || [], key.match(/\{\d+\}/g) || [], key); }
});
