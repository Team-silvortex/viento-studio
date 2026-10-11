import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { webcrypto } from 'node:crypto';
import { createSceneCompositionPlacementsDraft, prepareSceneCompositionPlacementsApply } from '../../engine/scene-composition-placements.mjs';
import { dialogHarness, flushDialogs } from './dialog-harness.mjs';
import { deferred } from './editor-harness.mjs';
import { placementsFixture, copy, decoded, hash } from './scene-composition-placements-fixture.mjs';
import en from '../../web/i18n/en.js';
import ja from '../../web/i18n/ja.js';

async function settle(h) { for (let index = 0; index < 200; index++) { await flushDialogs();
  if (!h.el('Dialog').open || h.el('Dialog').getAttribute('aria-busy') !== 'true') return; await new Promise(resolve => setTimeout(resolve, 1)); }
  assert.fail('Placement editor remained busy'); }
async function harness(t, options = {}) {
  const value = await placementsFixture(options), checks = [], applies = [], receipts = [], alerts = [];
  const context = { editable: true, creating: false, busy: false, compositionSourceWritable: true, canEditCompositionPlacements: true,
    sceneDraftPath: value.source.sourcePath, sceneDraftToken: 1 };
  let live = true, confirm = true, language = 'zh-CN', languageListener = () => {}, generated = 0, memory = value.source.content;
  const factory = async (...args) => { const draft = await createSceneCompositionPlacementsDraft(...args);
    return { fragments: draft.fragments, placements: draft.placements, propose(input) { return draft.propose(copy(input)); } }; };
  const translate = (key, ...args) => String(({ en, ja }[language] || {})[key] || key).replace(/\{(\d+)\}/g, (_, index) => args[index] ?? '');
  const h = await dialogHarness('app-scene-composition-placements', { crypto: { subtle: webcrypto.subtle, randomUUID: () => { generated++; return webcrypto.randomUUID(); } }, queueMicrotask,
    createSceneCompositionPlacementsDraft: options.factory || factory, ...(options.supported === false ? { supportsStudioCoreCompositionPlacements: () => false } : {}),
    t: translate, translatePage(root) { for (const node of root.querySelectorAll('[data-i18n]')) node.textContent = translate(node.dataset.i18n); },
    onLanguageChange(listener) { languageListener = listener; return () => {}; }, fetchJsonApiRequest() { assert.fail('The parent owns transport and dependency checks'); },
  });
  h.runtime.window.confirm = () => confirm; h.runtime.window.alert = value => alerts.push(value);
  const controller = h.runtime.setupSceneCompositionPlacements({ getContext: () => context,
    validateDraft: async (proposal, guard) => { checks.push(copy(proposal)); return options.validate ? options.validate(proposal, guard) : { ok: true }; },
    applySourceDraft: async (proposal, guard) => { applies.push(copy(proposal)); if (options.apply) return options.apply(proposal, guard, context);
      const prepared = await prepareSceneCompositionPlacementsApply({ ...value.source, content: memory }, copy(proposal), { digest: hash });
      if (!guard.isCurrent()) throw Error('Owner changed'); memory = prepared.afterContent; context.sceneDraftToken++; return { applied: true }; },
    sourceApplied: async (result, proposal) => { receipts.push({ result, proposal: copy(proposal) }); },
  });
  const el = suffix => h.element(`sceneCompositionPlacements${suffix}`), open = extra => controller.open({ ...value, isCurrent: () => live, ...extra });
  t.after(() => controller.destroy()); if (!options.skipOpen) assert.equal(await open(), true);
  const input = (suffix, raw) => { if (suffix === 'OffsetEnabled') el(suffix).checked = Boolean(raw); else el(suffix).value = String(raw);
    el(suffix).dispatch(['Fragment', 'Placement', 'OffsetEnabled'].includes(suffix) ? 'change' : 'input'); };
  const check = async () => { el('Check').click(); await settle({ el }); };
  return { ...h, value, context, controller, el, checks, applies, receipts, alerts, open, input, check, generated: () => generated,
    memory: () => memory, setLive: value => { live = value; }, setConfirm: value => { confirm = value; }, setLanguage(value) { language = value; languageListener(); } };
}

test('whole-recipe entry offers unused fragments and existing placements without allocating identities or starting an operation', async t => {
  const h = await harness(t); assert.equal(h.generated(), 0); assert.equal(h.el('Check').disabled, true); assert.equal(h.el('Apply').disabled, true);
  assert.deepEqual(h.el('Fragment').children.map(option => option.value), ['party', 'unused']); assert.equal(h.el('Placement').children.length, 2);
  assert.equal(h.el('Placement').value, h.value.recipe.placements[0].placementId); assert.equal(h.memory(), h.value.source.content);
});

test('adding an unused fragment allocates actor/group/placement identities once and leaves shared declarations unchanged', async t => {
  const h = await harness(t); h.input('Fragment', 'unused'); h.el('Add').click();
  const count = 1 + h.value.recipe.fragments[1].actors.length + h.value.recipe.fragments[1].groups.length; assert.equal(h.generated(), count);
  await h.check(); const p = h.checks[0], after = decoded(p.afterContent), last = after.placements.at(-1);
  assert.equal(p.edit.action, 'add'); assert.equal(p.edit.fragmentId, 'unused'); assert.equal(Object.hasOwn(p.edit, 'offset'), false);
  assert.equal(Object.hasOwn(last, 'overrides'), false); assert.deepEqual(after.fragments, h.value.recipe.fragments);
  assert.deepEqual(after.placements.slice(0, -1), h.value.recipe.placements); assert.equal(new Set([last.placementId, ...Object.values(last.actorIds), ...Object.values(last.groupIds)]).size, count);
  assert.deepEqual(p.targets.overrides, []); assert.equal(h.el('Apply').disabled, false);
});

test('explicit zero offset remains declared while checks, numeric edits and language changes keep the identity maps fixed', async t => {
  const h = await harness(t); h.el('Add').click(); h.input('OffsetEnabled', true); await h.check(); const first = h.checks[0], count = h.generated();
  h.input('X', '12'); h.input('X', '0'); h.setLanguage('en'); await h.check(); h.setLanguage('ja');
  assert.equal(h.generated(), count); assert.deepEqual(h.checks[1].edit.actorIds, first.edit.actorIds); assert.equal(h.checks[1].edit.placementId, first.edit.placementId);
  assert.deepEqual(h.checks[1].edit.offset, [0, 0]); assert.equal(h.el('Apply').disabled, false); assert.equal(h.el('Title').textContent, ja['管理片段放置']);
});

test('copy uses fresh nested-group identities and preserves all six raw override fields, explicit offset and shared fragments', async t => {
  const h = await harness(t); h.el('Copy').click(); await h.check(); const p = h.checks[0], after = decoded(p.afterContent), original = after.placements[0], added = after.placements.at(-1);
  assert.equal(p.edit.action, 'copy'); assert.equal(p.edit.sourcePlacementId, original.placementId); assert.deepEqual(added.offset, original.offset); assert.deepEqual(added.overrides, original.overrides);
  assert.deepEqual(after.fragments, h.value.recipe.fragments); assert.deepEqual(p.targets.overrides[0].fields, ['position', 'size', 'color', 'speed', 'controls', 'imageResourceId']);
  for (const key of Object.keys(original.actorIds)) assert.notEqual(added.actorIds[key], original.actorIds[key]);
  for (const key of Object.keys(original.groupIds)) assert.notEqual(added.groupIds[key], original.groupIds[key]);
  assert.equal(h.el('Targets').children[0].dataset.placementId, added.placementId);
});

test('copy keeps absent offset and explicitly empty overrides distinct from newly declared values', async t => {
  const h = await harness(t, { noOffset: true }); h.el('Copy').click(); await h.check(); assert.equal(Object.hasOwn(decoded(h.checks[0].afterContent).placements.at(-1), 'offset'), false);
  h.input('Placement', h.value.recipe.placements[1].placementId); h.el('Copy').click(); await h.check(); assert.deepEqual(decoded(h.checks.at(-1).afterContent).placements.at(-1).overrides, []);
});

test('removing the opener placement reviews every removed actor/group/override and preserves all other declarations', async t => {
  const h = await harness(t); h.el('Remove').click(); await h.check(); const p = h.checks[0], after = decoded(p.afterContent);
  assert.equal(p.edit.placementId, h.value.recipe.placements[0].placementId); assert.deepEqual(after.fragments, h.value.recipe.fragments);
  assert.deepEqual(after.placements, [h.value.recipe.placements[1]]); assert.deepEqual(p.targets.actors.map(item => item.instanceId), Object.values(h.value.recipe.placements[0].actorIds));
  assert.deepEqual(p.targets.groups.map(item => item.groupId), Object.values(h.value.recipe.placements[0].groupIds)); assert.equal(p.targets.overrides[0].fields.length, 6);
});

test('the last placement cannot be removed but can still be copied or added to', async t => {
  const h = await harness(t, { single: true }); assert.equal(h.el('Remove').disabled, true); h.el('Remove').dispatch('click');
  assert.equal(h.el('Check').disabled, true); assert.equal(h.generated(), 0); assert.equal(h.el('Copy').disabled, false); assert.equal(h.el('Add').disabled, false);
});

test('unfinished offset input survives a failed check without consuming the pending identities', async t => {
  const h = await harness(t); h.el('Add').click(); h.input('OffsetEnabled', true); h.input('X', ''); const count = h.generated(); await h.check();
  assert.equal(h.el('X').value, ''); assert.equal(h.el('Apply').disabled, true); assert.equal(h.checks.length, 0); assert.equal(h.generated(), count); assert.equal(h.memory(), h.value.source.content);
});

test('unselected offset controls preserve their raw text and omit the optional declaration', async t => {
  const h = await harness(t); h.el('Add').click(); h.input('OffsetEnabled', true); h.input('X', '19'); h.input('Y', '23'); h.input('OffsetEnabled', false); await h.check();
  assert.equal(h.el('X').value, '19'); assert.equal(h.el('Y').value, '23'); assert.equal(Object.hasOwn(h.checks[0].edit, 'offset'), false);
});

test('cancel confirmation retains edits when declined, then discards without source application and returns focus', async t => {
  const h = await harness(t, { skipOpen: true }), opener = h.element('settingsBtn'); opener.focus(); await h.open(); h.el('Add').click(); const count = h.generated();
  h.setConfirm(false); h.el('Cancel').click(); assert.equal(h.el('Dialog').open, true); assert.equal(h.generated(), count);
  h.setConfirm(true); h.el('Cancel').click(); await flushDialogs(); assert.equal(h.el('Dialog').open, false); assert.equal(h.document.activeElement, opener);
  assert.equal(h.applies.length, 0); assert.equal(h.memory(), h.value.source.content);
});

test('a pending check locks every operation and a forced close makes its late approval inert', async t => {
  const waiting = deferred(), reached = deferred(), h = await harness(t, { validate: async () => { reached.resolve(); return waiting.promise; } });
  h.el('Copy').click(); h.el('Check').click(); await reached.promise;
  for (const suffix of ['Fragment', 'Placement', 'Add', 'Copy', 'Remove', 'OffsetEnabled', 'X', 'Y', 'Check', 'Apply', 'Cancel', 'Close']) assert.equal(h.el(suffix).disabled, true, suffix);
  h.el('Dialog').close(); await flushDialogs(); waiting.resolve({ ok: true }); await flushDialogs(); assert.equal(h.el('Dialog').open, false); assert.equal(h.receipts.length, 0);
});

test('late open success after source ownership changes creates no dialog or alert', async t => {
  const waiting = deferred(), reached = deferred(), h = await harness(t, { skipOpen: true, factory: async (...args) => {
    const draft = await createSceneCompositionPlacementsDraft(...args); reached.resolve(); await waiting.promise; return draft;
  } });
  const opening = h.open(); await reached.promise; h.setLive(false); waiting.resolve(); assert.equal(await opening, false); assert.equal(h.el('Dialog').open, false); assert.deepEqual(h.alerts, []);
});

test('late open rejection after closing the parent does not show a stale error', async t => {
  const waiting = deferred(), reached = deferred(), h = await harness(t, { skipOpen: true, factory: async () => { reached.resolve(); return waiting.promise; } });
  const opening = h.open(); await reached.promise; h.setLive(false); waiting.reject(Error('Late failure')); assert.equal(await opening, false); assert.deepEqual(h.alerts, []);
});

test('candidate diagnostics retain the operation and identity maps without authorizing apply', async t => {
  const h = await harness(t, { validate: async () => ({ ok: false, diagnostics: [{ code: 'build_resource_unavailable', propertyPath: '/resources/0' }] }) });
  h.el('Add').click(); const count = h.generated(); await h.check(); assert.equal(h.el('Apply').disabled, true); assert.equal(h.el('Review').hidden, false);
  assert.equal(h.el('Diagnostics').children.length, 1); assert.equal(h.generated(), count); assert.equal(h.applies.length, 0);
});

test('silent raw input changes invalidate a completed approval before applying', async t => {
  const h = await harness(t); h.el('Add').click(); h.input('OffsetEnabled', true); await h.check(); h.el('X').value = '44'; h.el('Apply').click(); await settle(h);
  assert.equal(h.applies.length, 0); assert.equal(h.el('Apply').disabled, true); assert.equal(h.memory(), h.value.source.content);
});

test('silent placement selection changes cannot reuse an approved removal', async t => {
  const h = await harness(t); h.el('Remove').click(); await h.check(); h.el('Placement').value = h.value.recipe.placements[1].placementId; h.el('Apply').click(); await settle(h);
  assert.equal(h.applies.length, 0); assert.equal(h.el('Apply').disabled, true);
});

test('silent field changes during candidate checks cannot receive late approval', async t => {
  const waiting = deferred(), reached = deferred(), h = await harness(t, { validate: async () => { reached.resolve(); return waiting.promise; } });
  h.el('Add').click(); h.input('OffsetEnabled', true); h.el('Check').click(); await reached.promise; h.el('X').value = '99'; waiting.resolve({ ok: true }); await settle(h);
  assert.equal(h.el('Apply').disabled, true); assert.equal(h.generated(), 5); assert.equal(h.applies.length, 0);
});

test('missing application receipt retains the edit and does not send a source-applied notification', async t => {
  const h = await harness(t, { apply: async () => ({ applied: false }) }); h.el('Copy').click(); await h.check(); h.el('Apply').click(); await settle(h);
  assert.equal(h.el('Dialog').open, true); assert.equal(h.receipts.length, 0); assert.equal(h.memory(), h.value.source.content);
});

test('legitimate draft-token advancement completes application once and does not save any file', async t => {
  const h = await harness(t, { dirty: true }); h.el('Remove').click(); await h.check(); const p = h.checks[0]; h.el('Apply').click(); await settle(h);
  assert.equal(h.el('Dialog').open, false); assert.equal(h.context.sceneDraftToken, 2); assert.equal(h.receipts.length, 1); assert.equal(h.memory(), p.afterContent);
  assert.equal(h.value.source.content.includes('未保存😀'), true); assert.equal(h.value.saved.includes('未保存😀'), false);
});

test('closing the parent during apply rejects the late source result without notifying completion', async t => {
  const waiting = deferred(), reached = deferred(), h = await harness(t, { apply: async (_p, guard) => { reached.resolve(); await waiting.promise;
    if (!guard.isCurrent()) throw Error('Owner changed'); return { applied: true }; } });
  h.el('Remove').click(); await h.check(); h.el('Apply').click(); await reached.promise; h.setLive(false); waiting.resolve(); await settle(h);
  assert.equal(h.receipts.length, 0); assert.equal(h.el('Apply').disabled, true); assert.equal(h.memory(), h.value.source.content);
});

test('capability loss, wrong source, busy and non-source ownership all disable the independent placement entry', async t => {
  for (const [key, value] of [['canEditCompositionPlacements', false], ['compositionSourceWritable', false], ['editable', false], ['busy', true], ['creating', true], ['sceneDraftPath', 'elsewhere.json']]) {
    const h = await harness(t); h.context[key] = value; h.controller.refresh(); assert.equal(h.el('Add').disabled, true); assert.equal(h.el('Check').disabled, true); h.controller.destroy();
  }
});

test('missing new ABI only disables this editor and performs no draft work', async t => {
  const h = await harness(t, { supported: false, skipOpen: true, factory() { assert.fail('Unsupported capability must not load a draft'); } });
  assert.equal(await h.open(), false); assert.equal(h.generated(), 0); assert.deepEqual(h.alerts, []);
});

test('all authored placement UI labels and messages have English and Japanese translations', async () => {
  const source = await fs.readFile(new URL('../../web/modules/app-scene-composition-placements.js', import.meta.url), 'utf8');
  const keys = [...source.matchAll(/(?:data-i18n="([^"]+)"|'([^'\n]*[\u3400-\u9fff][^'\n]*)')/g)].map(match => match[1] || match[2]);
  for (const key of new Set(keys)) { assert.equal(typeof en[key], 'string', `English: ${key}`); assert.equal(typeof ja[key], 'string', `Japanese: ${key}`); }
});
