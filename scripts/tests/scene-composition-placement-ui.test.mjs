import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash, webcrypto } from 'node:crypto';
import { createSceneCompositionPlacementDraft, prepareSceneCompositionPlacementApply } from '../../engine/scene-composition-placement.mjs';
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
async function fixture({ dirty = false, absent = false, zero = false, ungrouped = false } = {}) {
  const observed = copy(golden.observed), recipe = copy(example);
  observed.source.workspace.version = 3; observed.source.definition = { documentTypes: [{ id: 'document', label: 'Document' }] };
  for (const actor of recipe.fragments[0].actors) actor.objectId = ids.first;
  if (absent) delete recipe.placements[1].offset;
  if (zero) recipe.placements[1].offset = [0, 0];
  if (ungrouped) {
    recipe.fragments[0].groups = []; for (const actor of recipe.fragments[0].actors) delete actor.groupKey;
    for (const placement of recipe.placements) placement.groupIds = {};
  }
  const document = observed.source.documents.find(item => item.record.id === ids.scene);
  document.record.relations = []; document.record.assetBindings = [];
  document.content = '\uFEFF' + JSON.stringify(recipe, null, '\t').replaceAll('\n', '\r\n') + '\r\n \t'; document.sourceRevision = revision(document.content);
  for (const item of observed.source.documents) item.descriptor = { ...item.record };
  observed.projection = await createWorldProjection(observed.source, { digest: hash });
  const preview = await resolveSceneCompositionPreview(observed, ids.scene, { digest: hash }); assert.equal(preview.ok, true, JSON.stringify(preview.diagnostics));
  const plan = scene2DModelToPlan(preview.model), baseSourceRevision = dirty ? revision('saved baseline') : document.sourceRevision;
  const model = { ok: true, format: 'viento-scene-preview', schemaVersion: 2, scene: plan.scene, actors: plan.actors,
    composition: preview.composition, sourceLocations: preview.model.sourceLocations, sceneStructure: createSceneStructure(preview.model), resources: [], diagnostics: [],
    ...(dirty ? { draft: { baseSourceRevision, sourceRevision: document.sourceRevision } } : {}) };
  return { model, recipe, source: { sourcePath: document.sourcePath, content: document.content, baseSourceRevision }, actorId: model.actors[2].instanceId };
}
async function settle(h) {
  for (let i = 0; i < 100; i++) { await flushDialogs(); if (h.el('Dialog').getAttribute('aria-busy') !== 'true') return; await new Promise(resolve => setTimeout(resolve, 1)); }
  assert.fail('Placement form remained busy');
}
async function harness(t, options = {}) {
  const value = await fixture(options), validation = [], proposals = [], applied = [], guards = [];
  let memory = value.source.content, live = true;
  const context = { editable: true, creating: false, busy: false, dirty: Boolean(options.dirty), compositionSourceWritable: true,
    canEditCompositionPlacement: true, sceneDraftPath: value.source.sourcePath, sceneDraftToken: 1, ...options.context };
  const h = await dialogHarness('app-scene-composition-placement', { crypto: webcrypto, queueMicrotask,
    createSceneCompositionPlacementDraft: options.factory || createSceneCompositionPlacementDraft,
    ...(options.supported === false ? { supportsStudioCoreCompositionPlacement: () => false } : {}),
    requestWorldCommand() { assert.fail('Placement form must not fetch World or save authors'); },
    fetchJsonApiRequest() { assert.fail('The parent owns full candidate dependency validation'); },
  });
  const controller = h.runtime.setupSceneCompositionPlacement({ getContext: () => context,
    validateDraft: async (candidate, guard) => { validation.push(candidate); guards.push(guard); return options.validate ? options.validate(candidate, guard) : { ok: true }; },
    applySourceDraft: async (candidate, guard) => {
      proposals.push(candidate); if (options.apply) return options.apply(candidate, guard, context);
      const prepared = await prepareSceneCompositionPlacementApply({ ...value.source, content: memory }, candidate, { digest: hash });
      if (!guard.isCurrent()) throw Object.assign(new Error('Source owner changed'), { errorCode: 'scene_composition_override_conflict' });
      memory = prepared.afterContent; context.sceneDraftToken++; context.dirty = true; return { applied: true };
    }, sourceApplied: (result, candidate) => applied.push({ result, candidate }),
  });
  const el = suffix => h.element(`sceneCompositionPlacement${suffix}`), open = (extra = {}) => controller.open({ ...value, isCurrent: () => live, ...extra });
  t.after(async () => { controller.destroy(); await flushDialogs(); });
  if (!options.skipOpen) assert.equal(await open(), true);
  const restore = (checked = true, event = true) => { el('Reset').checked = checked; if (event) el('Reset').dispatch('change'); };
  const input = (suffix, raw, event = true) => { el(suffix).value = String(raw); if (event) el(suffix).dispatch('input'); };
  const check = async () => { el('Check').click(); await settle({ el }); };
  return { ...h, el, value, controller, context, validation, proposals, applied, guards, open, input, check, restore, memory: () => memory, setLive: v => { live = v; } };
}

test('declared placement offset opens raw values and lists every mapped actor and organizational group', async t => {
  const h = await harness(t), before = copy(h.value);
  assert.equal(h.el('X').value, '360'); assert.equal(h.el('Y').value, '80'); assert.match(h.el('Declared').textContent, /已声明.*360.*80/);
  assert.match(h.el('Effective').textContent, /生效偏移.*360.*80/); assert.match(h.el('Identity').textContent, /10000001.*party/);
  assert.equal(h.el('Reset').checked, false); assert.equal(h.el('Reset').disabled, false); assert.equal(h.el('Check').disabled, true);
  assert.deepEqual(h.el('Targets').children.map(row => row.dataset.instanceId), h.value.model.actors.slice(2).map(actor => actor.instanceId));
  assert.deepEqual(h.el('Targets').children.map(row => row.dataset.actorKey), ['leader', 'companion']);
  assert.equal(h.el('Groups').children.length, 2); assert.match(h.el('GroupNote').textContent, /分组.*2.*不提供空间变换/);
  assert.equal(h.el('Dialog').dataset.dirty, 'false'); assert.equal(h.memory(), before.source.content); assert.deepEqual(h.value, before);
});

test('an absent declaration stays an empty pair while the effective zero default is explained without adding source', async t => {
  const h = await harness(t, { absent: true }); assert.equal(h.el('X').value, ''); assert.equal(h.el('Y').value, '');
  assert.match(h.el('Declared').textContent, /未声明.*留空/); assert.match(h.el('Effective').textContent, /生效偏移.*0.*0/);
  assert.equal(h.el('Reset').disabled, true); assert.equal(h.el('Check').disabled, true); h.restore(); assert.equal(h.el('Reset').checked, false);
  assert.equal(h.el('Check').disabled, true); assert.equal(h.validation.length, 0); assert.equal(h.memory(), h.value.source.content);
});

test('setting both coordinates patches only one placement and reviews the full exact source before normal-save memory application', async t => {
  const h = await harness(t, { dirty: true }), before = copy(h.value); h.input('X', 400); h.input('Y', 90); await h.check();
  const candidate = copy(h.validation[0]); assert.deepEqual(candidate.offset, [400, 90]); assert.deepEqual(candidate.changedPaths, ['/placements/1/offset']);
  assert.equal(candidate.baseSourceRevision, before.source.baseSourceRevision); assert.equal(candidate.instanceId, before.actorId);
  assert.deepEqual(candidate.targets, [{ instanceId: before.model.actors[2].instanceId, actorKey: 'leader' }, { instanceId: before.model.actors[3].instanceId, actorKey: 'companion' }]);
  assert.deepEqual(candidate.groups, [{ groupId: before.recipe.placements[1].groupIds.party, groupKey: 'party' }, { groupId: before.recipe.placements[1].groupIds.companions, groupKey: 'companions' }]);
  const expected = copy(before.recipe); expected.placements[1].offset = [400, 90]; assert.deepEqual(JSON.parse(candidate.afterContent.replace(/^\uFEFF/, '')), expected);
  assert.ok(candidate.afterContent.startsWith('\uFEFF{\r\n')); assert.ok(candidate.afterContent.endsWith('\r\n \t'));
  assert.equal(h.el('Source').textContent, candidate.afterContent); assert.match(h.el('Diff').textContent, /\/placements\/1\/offset.*移除的原文[\s\S]*新增的原文/s);
  assert.equal(h.el('Review').open, true); assert.equal(h.memory(), before.source.content); assert.equal(h.el('Apply').disabled, false);
  h.el('Apply').click(); await settle(h); assert.equal(h.memory(), candidate.afterContent); assert.equal(h.context.dirty, true); assert.equal(h.applied.length, 1); assert.equal(h.el('Dialog').open, false); assert.deepEqual(h.value, before);
});

test('restoring an offset removes its declaration atomically and preserves all local overrides and sibling placements', async t => {
  const h = await harness(t); h.restore(); assert.equal(h.el('X').value, '360'); assert.equal(h.el('Y').value, '80'); assert.equal(h.el('X').disabled, true);
  assert.match(h.el('Effective').textContent, /移除声明.*缺省.*恢复前输入/); await h.check(); const candidate = copy(h.validation[0]);
  assert.equal(candidate.offset, null); const expected = copy(h.value.recipe); delete expected.placements[1].offset;
  assert.deepEqual(JSON.parse(candidate.afterContent.replace(/^\uFEFF/, '')), expected); assert.deepEqual(candidate.changedPaths, ['/placements/1/offset']);
  assert.match(h.el('Diff').textContent, /offset/); assert.equal(h.el('Apply').disabled, false); assert.equal(h.memory(), h.value.source.content);
});

test('explicit zero and absent offset remain distinct source states in both directions', async t => {
  const absent = await harness(t, { absent: true }); absent.input('X', 0); absent.input('Y', 0); await absent.check();
  assert.deepEqual(copy(absent.validation[0].offset), [0, 0]); assert.deepEqual(JSON.parse(absent.validation[0].afterContent.replace(/^\uFEFF/, '')).placements[1].offset, [0, 0]);
  const declared = await harness(t, { zero: true }); declared.restore(); await declared.check(); assert.equal(declared.validation[0].offset, null);
  assert.equal(Object.hasOwn(JSON.parse(declared.validation[0].afterContent.replace(/^\uFEFF/, '')).placements[1], 'offset'), false);
});

test('semantic same values and returning to the initial offset create no candidate or explicit rewrite', async t => {
  const h = await harness(t); h.input('X', '360.0'); assert.equal(h.el('Check').disabled, true); h.el('Check').dispatch('click'); await settle(h);
  h.input('Y', 91); h.input('Y', 80); assert.equal(h.el('Check').disabled, true); assert.equal(h.validation.length, 0); assert.equal(h.memory(), h.value.source.content);
});

test('empty, nonfinite and out-of-range pairs retain raw input and cannot reach dependency validation', async t => {
  const h = await harness(t);
  for (const raw of ['', 'Infinity', 'NaN', '100001', '-100001']) {
    h.input('X', raw); await h.check(); assert.equal(h.validation.length, 0); assert.equal(h.el('Apply').disabled, true); assert.equal(h.el('X').value, raw);
  }
  h.input('X', 400); h.input('Y', ''); await h.check(); assert.equal(h.validation.length, 0); assert.equal(h.el('Y').value, ''); assert.equal(h.memory(), h.value.source.content);
});

test('a legal offset pair that puts any mapped actor beyond world bounds is rejected before a candidate is exposed', async t => {
  const h = await harness(t); h.input('X', 99999); await h.check();
  assert.equal(h.validation.length, 0); assert.equal(h.el('Review').hidden, true); assert.equal(h.el('Apply').disabled, true); assert.equal(h.el('X').value, '99999'); assert.equal(h.memory(), h.value.source.content);
});

test('choosing a companion still binds the whole placement; ungrouped placements require no guessed organization', async t => {
  const h = await harness(t, { ungrouped: true, skipOpen: true }); assert.equal(await h.open({ actorId: h.value.model.actors[3].instanceId }), true);
  h.input('X', 401); await h.check(); assert.equal(h.validation[0].instanceId, h.value.model.actors[3].instanceId); assert.equal(h.validation[0].targets.length, 2);
  assert.deepEqual(copy(h.validation[0].groups), []); assert.equal(h.el('Groups').children.length, 0); assert.match(h.el('GroupNote').textContent, /分组.*0/);
});

test('restoration preserves unfinished input and cancelling restoration reopens the exact original user input', async t => {
  const h = await harness(t); h.input('X', ''); h.restore(); await h.check(); assert.equal(h.validation[0].offset, null); assert.equal(h.el('X').value, '');
  h.restore(false); assert.equal(h.el('X').disabled, false); assert.equal(h.el('X').value, ''); await h.check(); assert.equal(h.validation.length, 1); assert.equal(h.el('Apply').disabled, true);
});

test('validator mutations cannot replace canonical offset, all targets, group identities or exact source', async t => {
  const h = await harness(t, { validate(candidate) { candidate.offset = null; candidate.targets.length = 0; candidate.groups[0].groupId = ids.first; candidate.afterContent = 'tampered'; return { ok: true }; } });
  h.input('X', 400); await h.check(); assert.equal(h.el('Apply').disabled, false); assert.notEqual(h.el('Source').textContent, 'tampered');
  h.el('Apply').click(); await settle(h); assert.deepEqual(copy(h.proposals[0].offset), [400, 80]); assert.equal(h.proposals[0].targets.length, 2);
  assert.equal(h.proposals[0].groups[0].groupId, h.value.recipe.placements[1].groupIds.party); assert.deepEqual(copy(h.applied[0].candidate), copy(h.proposals[0]));
});

test('silent numeric changes or restoring after approval invalidate the entire candidate before application', async t => {
  const h = await harness(t); h.input('X', 400); await h.check(); h.input('Y', 91, false); h.el('Apply').dispatch('click'); await settle(h);
  assert.equal(h.proposals.length, 0); assert.equal(h.el('Review').hidden, true); await h.check(); h.restore(true, false); h.el('Apply').dispatch('click'); await settle(h);
  assert.equal(h.proposals.length, 0); assert.equal(h.el('Apply').disabled, true); assert.equal(h.memory(), h.value.source.content);
});

test('silent changes to disabled restoration input or reset choice also revoke restoration approval', async t => {
  const h = await harness(t); h.restore(); await h.check(); h.input('X', 999, false); h.controller.refresh(); assert.equal(h.el('Apply').disabled, true);
  await h.check(); h.restore(false, false); h.el('Apply').dispatch('click'); await settle(h); assert.equal(h.proposals.length, 0); assert.equal(h.el('Review').hidden, true);
});

test('pending checks lock every operation and late changed intent cannot acquire approval', async t => {
  const wait = deferred(), h = await harness(t, { validate: () => wait.promise }); h.input('X', 400); h.el('Check').click(); await flushDialogs();
  for (const suffix of ['X', 'Y', 'Reset', 'Check', 'Apply', 'Close', 'Cancel']) assert.equal(h.el(suffix).disabled, true);
  assert.equal(h.controller.close(), false); h.restore(true, false); wait.resolve({ ok: true }); await settle(h);
  assert.equal(h.el('Apply').disabled, true); assert.equal(h.el('Review').hidden, true); assert.equal(h.memory(), h.value.source.content);
});

test('invalid full scene or image checks keep the offset and diagnostic without granting application', async t => {
  const h = await harness(t, { validate: () => ({ ok: false, diagnostics: [{ code: 'image_missing', propertyPath: '/placements/1/offset' }] }) });
  h.input('X', 400); await h.check(); assert.equal(h.el('X').value, '400'); assert.match(h.el('Diagnostics').textContent, /image_missing.*offset/);
  assert.equal(h.el('Apply').disabled, true); assert.equal(h.proposals.length, 0); assert.equal(h.memory(), h.value.source.content);
});

test('source owner or token loss while checking revokes a late result and preserves the form for inspection', async t => {
  const wait = deferred(), h = await harness(t, { validate: () => wait.promise }); h.restore(); h.el('Check').click(); h.context.sceneDraftToken++; h.setLive(false);
  wait.resolve({ ok: true }); await settle(h); assert.equal(h.guards[0].isCurrent(), false); assert.equal(h.el('Apply').disabled, true);
  assert.equal(h.el('Reset').checked, true); assert.equal(h.el('X').value, '360'); assert.match(h.el('Status').textContent, /原文或预览已变化/);
});

test('a silent raw change while application awaits makes the host guard reject without completing or editing memory', async t => {
  const wait = deferred(), h = await harness(t, { apply: async (candidate, guard) => { await wait.promise; assert.equal(guard.isCurrent(), false); throw new Error('Raw intent changed'); } });
  h.input('X', 400); await h.check(); h.el('Apply').click(); await flushDialogs(); assert.equal(h.el('Reset').disabled, true); h.input('Y', 92, false);
  wait.resolve(); await settle(h); assert.equal(h.applied.length, 0); assert.equal(h.el('Dialog').open, true); assert.equal(h.el('Apply').disabled, true); assert.equal(h.memory(), h.value.source.content);
});

test('late open success and failure after owner loss never show a dialog or an expired alert', async t => {
  for (const reject of [false, true]) {
    const wait = deferred(), ready = deferred(), h = await harness(t, { skipOpen: true, factory: async (...args) => { const draft = await createSceneCompositionPlacementDraft(...args); ready.resolve(); await wait.promise; return draft; } });
    let alerts = 0; h.runtime.window.alert = () => alerts++; const opening = h.open(); await ready.promise; h.setLive(false);
    if (reject) wait.reject(new Error('Late failure')); else wait.resolve(); assert.equal(await opening, false); assert.equal(h.el('Dialog').open, false); assert.equal(alerts, 0);
  }
});

test('a newer asynchronous open supersedes an older placement request without replacing the established form', async t => {
  const wait = deferred(); let calls = 0;
  const h = await harness(t, { skipOpen: true, factory: async (...args) => { const draft = await createSceneCompositionPlacementDraft(...args); if (++calls === 1) await wait.promise; return draft; } });
  const older = h.open(); await flushDialogs(); assert.equal(await h.open({ actorId: h.value.model.actors[0].instanceId }), true); wait.resolve(); assert.equal(await older, false);
  assert.match(h.el('Identity').textContent, /10000000-1111/); assert.equal(h.el('X').value, ''); assert.equal(h.el('Reset').disabled, true);
});

test('model names and original source are detached before asynchronous opening so later caller mutation cannot alter review', async t => {
  const wait = deferred(), h = await harness(t, { skipOpen: true, factory: async (...args) => { const draft = await createSceneCompositionPlacementDraft(...args); await wait.promise; return draft; } });
  const original = h.value.source.content, opening = h.open(); await flushDialogs(); h.value.source.content = 'caller changed'; h.value.model.actors[2].name = 'caller changed';
  wait.resolve(); assert.equal(await opening, true); h.input('X', 400); await h.check(); assert.doesNotMatch(h.el('Targets').textContent, /caller changed/);
  assert.notEqual(h.el('Source').textContent, 'caller changed'); assert.match(h.el('Diff').textContent, /移除的原文/); assert.equal(h.memory(), original);
});

test('cancel or return preserves main source; declined discard stays open and reopen starts from raw declared values', async t => {
  const h = await harness(t), opener = h.document.createElement('button'); opener.focus(); h.controller.close(); await flushDialogs(); assert.equal(await h.open(), true);
  h.restore(); h.runtime.window.confirm = () => false; h.el('Cancel').click(); assert.equal(h.el('Dialog').open, true);
  h.runtime.window.confirm = () => true; h.el('Close').click(); await flushDialogs(); assert.equal(h.el('Dialog').open, false); assert.equal(h.document.activeElement, opener); assert.equal(h.memory(), h.value.source.content);
  assert.equal(await h.open(), true); assert.equal(h.el('Reset').checked, false); assert.equal(h.el('X').value, '360'); assert.equal(h.el('Check').disabled, true);
});

test('read-only or missing placement capability declines before creating a draft and leaves other controllers independent', async t => {
  for (const options of [{ supported: false }, { context: { editable: false } }, { context: { canEditCompositionPlacement: false } }]) {
    let created = 0; const h = await harness(t, { ...options, skipOpen: true, factory: () => { created++; assert.fail('Unavailable placement must not create a draft'); } });
    assert.equal(await h.open(), false); assert.equal(created, 0); assert.equal(h.el('Dialog').open, false);
  }
});

test('destroying during a pending apply cannot complete into a replaced dialog and dispose remains idempotent', async t => {
  const wait = deferred(), h = await harness(t, { apply: () => wait.promise }); h.input('X', 400); await h.check(); h.el('Apply').click(); await flushDialogs(); h.controller.destroy();
  wait.resolve({ applied: true }); await flushDialogs(); assert.equal(h.applied.length, 0); assert.equal(h.el('Dialog'), null); h.controller.dispose(); assert.equal(await h.open(), false);
});

test('English and Japanese contain every placement workflow message and preserve all placeholders', async () => {
  const source = await fs.readFile(new URL('../../web/modules/app-scene-composition-placement.js', import.meta.url), 'utf8');
  const keys = new Set([...source.matchAll(/data-i18n="([^"]+)"|(?:t\(|\? |: |message = |report\(error, )'([^']*[\u4e00-\u9fff][^']*)'/g)].map(match => match[1] || match[2]));
  for (const key of ['整组偏移编辑暂不可用，请重新预览当前配方后重试。', '整组偏移已应用到原文草稿；尚未保存。', '整组偏移已应用；文本与已保存版本一致。']) keys.add(key);
  for (const key of keys) for (const language of [en, ja]) { assert.equal(typeof language[key], 'string', key); assert.deepEqual(language[key].match(/\{\d+\}/g) || [], key.match(/\{\d+\}/g) || [], key); }
});
