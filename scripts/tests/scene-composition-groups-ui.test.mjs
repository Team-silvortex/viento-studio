import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { webcrypto } from 'node:crypto';
import { createSceneCompositionGroupsDraft, prepareSceneCompositionGroupsApply } from '../../engine/scene-composition-groups.mjs';
import { dialogHarness, flushDialogs } from './dialog-harness.mjs';
import { deferred } from './editor-harness.mjs';
import { groupsFixture, copy, decoded, hash } from './scene-composition-groups-fixture.mjs';
import en from '../../web/i18n/en.js';
import ja from '../../web/i18n/ja.js';

async function settle(h) { for (let index = 0; index < 200; index++) { await flushDialogs();
  if (!h.el('Dialog').open || h.el('Dialog').getAttribute('aria-busy') !== 'true') return; await new Promise(resolve => setTimeout(resolve, 1)); }
  assert.fail('Group editor remained busy'); }
async function harness(t, options = {}) {
  const value = await groupsFixture(options), checks = [], applies = [], receipts = [], alerts = [];
  const context = { editable: true, creating: false, busy: false, compositionSourceWritable: true, canEditCompositionGroups: true,
    sceneDraftPath: value.source.sourcePath, sceneDraftToken: 1 };
  let live = true, confirm = true, language = 'zh-CN', languageListener = () => {}, generated = 0, memory = value.source.content;
  const factory = async (...args) => { const draft = await createSceneCompositionGroupsDraft(...args);
    return { fragments: draft.fragments, propose(input) { return draft.propose(copy(input)); } }; };
  const translate = (key, ...args) => String(({ en, ja }[language] || {})[key] || key).replace(/\{(\d+)\}/g, (_, index) => args[index] ?? '');
  const h = await dialogHarness('app-scene-composition-groups', { crypto: { subtle: webcrypto.subtle, randomUUID: () => { generated++; return webcrypto.randomUUID(); } }, queueMicrotask,
    createSceneCompositionGroupsDraft: options.factory || factory, ...(options.supported === false ? { supportsStudioCoreCompositionGroups: () => false } : {}),
    t: translate, translatePage(root) { for (const node of root.querySelectorAll('[data-i18n]')) node.textContent = translate(node.dataset.i18n); },
    onLanguageChange(listener) { languageListener = listener; return () => {}; }, fetchJsonApiRequest() { assert.fail('The parent owns transport and dependency checks'); },
  });
  h.runtime.window.confirm = () => confirm; h.runtime.window.alert = value => alerts.push(value);
  const controller = h.runtime.setupSceneCompositionGroups({ getContext: () => context,
    validateDraft: async (proposal, guard) => { checks.push(copy(proposal)); return options.validate ? options.validate(proposal, guard) : { ok: true }; },
    applySourceDraft: async (proposal, guard) => { applies.push(copy(proposal)); if (options.apply) return options.apply(proposal, guard, context);
      const prepared = await prepareSceneCompositionGroupsApply({ ...value.source, content: memory }, copy(proposal), { digest: hash });
      if (!guard.isCurrent()) throw Error('Owner changed'); memory = prepared.afterContent; context.sceneDraftToken++; return { applied: true }; },
    sourceApplied: async (result, proposal) => { receipts.push({ result, proposal: copy(proposal) }); },
  });
  const el = suffix => h.element(`sceneCompositionGroups${suffix}`), open = extra => controller.open({ ...value, isCurrent: () => live, ...extra });
  t.after(() => controller.destroy()); if (!options.skipOpen) assert.equal(await open(), true);
  const input = (suffix, raw) => { el(suffix).value = String(raw); el(suffix).dispatch(['Fragment', 'Group', 'Actor', 'Parent', 'Assignment'].includes(suffix) ? 'change' : 'input'); };
  const check = async () => { el('Check').click(); await settle({ el }); };
  return { ...h, value, context, controller, el, checks, applies, receipts, alerts, open, input, check, generated: () => generated,
    memory: () => memory, setLive: value => { live = value; }, setConfirm: value => { confirm = value; }, setLanguage(value) { language = value; languageListener(); } };
}


test('raw groups, parent declarations and actor memberships are available without choosing a canvas actor', async t => {
  const h = await harness(t); assert.equal(h.generated(), 0); assert.equal(h.el('Check').disabled, true);
  assert.deepEqual(h.el('Fragment').children.map(v => v.value), ['party', 'unused']); assert.equal(h.el('Before').children.length, 5);
  h.input('Group', 'spare'); h.el('Edit').click(); assert.equal(h.el('Name').value, '  Spare  '); assert.equal(h.el('Parent').value, 'party'); assert.equal(h.el('Key').disabled, true);
});

test('the optional opener actor selects its raw fragment membership without binding edit authority to canvas selection', async t => {
  const h = await harness(t, { skipOpen: true }); assert.equal(await h.open({ actorId: h.value.model.actors[3].instanceId }), true);
  assert.equal(h.el('Actor').value, 'companion'); h.el('Assign').click(); assert.equal(h.el('Assignment').value, 'companions');
  h.input('Assignment', 'spare'); await h.check(); assert.equal(h.checks[0].edit.actorKey, 'companion'); assert.equal(h.generated(), 0);
});

test('new groups allocate independent placement identities once across repeated checks, raw edits and language changes', async t => {
  const h = await harness(t); h.el('Add').click(); h.input('Key', 'new-team'); h.input('Name', '  新队伍😀  '); h.input('Parent', 'companions');
  assert.equal(h.generated(), 2); await h.check(); const first = h.checks[0], after = decoded(first.afterContent);
  assert.equal(after.fragments[0].groups.at(-1).name, '  新队伍😀  '); assert.equal(first.targets.length, 2);
  h.input('Name', 'Other'); h.input('Name', '  新队伍😀  '); h.setLanguage('en'); await h.check(); h.setLanguage('ja');
  assert.equal(h.generated(), 2); assert.deepEqual(h.checks[1].edit.instances, first.edit.instances); assert.equal(h.el('Apply').disabled, false);
  assert.equal(h.el('Parent').children[0].textContent, ja['根组织组']); assert.equal(h.el('Assignment').children[0].textContent, ja['取消归组']);
  assert.equal(h.el('Name').value, '  新队伍😀  '); assert.equal(h.el('Parent').value, 'companions');
  for (const [index, placement] of after.placements.entries()) { assert.equal(placement.groupIds['new-team'], first.edit.instances[index].groupId);
    assert.deepEqual(placement.actorIds, h.value.recipe.placements[index].actorIds); assert.deepEqual(placement.overrides, h.value.recipe.placements[index].overrides); }
});

test('editing names and parents preserves raw name spacing, stable identities, actor coordinates and drawing order', async t => {
  const h = await harness(t); h.input('Group', 'companions'); h.el('Edit').click(); h.input('Name', '  Companions revised  '); h.input('Parent', ''); await h.check();
  const p = h.checks[0], after = decoded(p.afterContent); assert.equal(p.edit.parentKey, null); assert.equal(p.edit.name, '  Companions revised  ');
  assert.equal(Object.hasOwn(after.fragments[0].groups[1], 'parentKey'), false); assert.deepEqual(after.fragments[0].actors, h.value.recipe.fragments[0].actors);
  assert.deepEqual(after.placements, h.value.recipe.placements); for (const target of p.targets) assert.equal(target.groups[1].parentGroupId, null);
  const row = h.el('Targets').children[0].children.find(v => v.dataset.groupKey === 'companions'); assert.equal(row.dataset.parentGroupId, ''); assert.equal(row.dataset.beforeParentGroupId, h.value.recipe.placements[0].groupIds.party);
});

test('actor assignment updates every placement membership and ungrouping deletes only the raw shared groupKey', async t => {
  for (const destination of ['spare', '']) { const h = await harness(t); h.input('Actor', 'companion'); h.el('Assign').click(); assert.equal(h.el('Assignment').value, 'companions');
    h.input('Assignment', destination); await h.check(); const p = h.checks[0], after = decoded(p.afterContent);
    assert.equal(p.edit.groupKey, destination || null); assert.equal(after.fragments[0].actors[1].groupKey, destination || undefined); assert.deepEqual(after.placements, h.value.recipe.placements);
    for (const [index, target] of p.targets.entries()) assert.equal(target.actors[1].groupId, destination ? h.value.recipe.placements[index].groupIds[destination] : null);
    const row = h.el('Targets').children[0].children.find(v => v.dataset.actorKey === 'companion'); assert.equal(row.dataset.beforeGroupId, h.value.recipe.placements[0].groupIds.companions); }
});

test('only empty leaf removal is enabled; direct actors and direct children are never promoted implicitly', async t => {
  const h = await harness(t); for (const key of ['party', 'companions']) { h.input('Group', key); assert.equal(h.el('Remove').disabled, true); h.el('Remove').dispatch('click'); assert.equal(h.el('Check').disabled, true); }
  h.input('Group', 'spare'); assert.equal(h.el('Remove').disabled, false); h.el('Remove').click(); await h.check(); const p = h.checks[0], after = decoded(p.afterContent);
  assert.equal(after.fragments[0].groups.length, 2); assert.deepEqual(after.fragments[0].actors, h.value.recipe.fragments[0].actors);
  for (const placement of after.placements) assert.equal(Object.hasOwn(placement.groupIds, 'spare'), false);
  assert.equal(h.el('Targets').children[0].children.some(v => v.dataset.removedGroupId === h.value.recipe.placements[0].groupIds.spare), true);
});

test('unused fragments support deleting their last empty group and adding groups without creating rendered instances', async t => {
  const h = await harness(t); h.input('Fragment', 'unused'); h.el('Remove').click(); await h.check(); assert.deepEqual(h.checks[0].targets, []);
  assert.deepEqual(decoded(h.checks[0].afterContent).fragments[1].groups, []); assert.equal(h.generated(), 0);
  h.el('Add').click(); await h.check(); assert.deepEqual(h.checks[1].edit.instances, []); assert.equal(h.generated(), 0); assert.equal(h.el('Targets').children.length, 0);
  assert.ok(h.el('Impact').textContent.includes('不生成场景实例'));
});

test('fragments with no groups can add a root group and ungrouped actors remain ungrouped', async t => {
  const h = await harness(t, { noGroups: true }); assert.equal(h.el('Edit').disabled, true); assert.equal(h.el('Remove').disabled, true);
  h.el('Add').click(); await h.check(); assert.equal(Object.hasOwn(h.checks[0].edit.group, 'parentKey'), false);
  for (const target of h.checks[0].targets) { assert.equal(target.groups.length, 1); assert.equal(target.actors.every(v => v.groupId === null), true); }
});

test('cycles, unknown parent/assignment, empty names and duplicate keys reject atomically while preserving raw input and IDs', async t => {
  for (const invalid of [h => { h.el('Edit').click(); h.input('Parent', 'companions'); }, h => { h.el('Add').click(); h.input('Key', 'party'); },
    h => { h.el('Add').click(); h.input('Name', ''); }, h => { h.el('Add').click(); h.input('Parent', 'missing'); }, h => { h.el('Assign').click(); h.input('Assignment', 'missing'); }]) {
    const h = await harness(t); invalid(h); const sig = [h.el('Key').value, h.el('Name').value, h.el('Parent').value, h.el('Assignment').value], count = h.generated(); await h.check();
    assert.equal(h.checks.length, 0); assert.equal(h.el('Apply').disabled, true); assert.equal(h.memory(), h.value.source.content); assert.equal(h.generated(), count);
    assert.deepEqual([h.el('Key').value, h.el('Name').value, h.el('Parent').value, h.el('Assignment').value], sig);
  }
});

test('new groups exceeding the organization depth limit leave the pending UUIDs and draft intact', async t => {
  const h = await harness(t, { deep: true }); h.el('Add').click(); h.input('Parent', 'level15'); await h.check(); assert.equal(h.checks.length, 0);
  assert.equal(h.generated(), 2); assert.equal(h.el('Parent').value, 'level15'); assert.equal(h.memory(), h.value.source.content);
});

test('semantic no-op edit and assignment are reported without accepting a preview or adding declarations', async t => {
  const h = await harness(t); h.el('Edit').click(); await h.check(); assert.equal(h.checks.length, 0); assert.equal(h.el('Apply').disabled, true);
  assert.ok(h.el('Message').textContent.includes('没有变化')); h.el('Assign').click(); await h.check(); assert.equal(h.checks.length, 0); assert.equal(h.memory(), h.value.source.content);
});

test('cancel confirmation preserves edits when declined and returns focus without applying when accepted', async t => {
  const h = await harness(t, { skipOpen: true }), opener = h.element('settingsBtn'); opener.focus(); await h.open(); h.el('Add').click(); h.setConfirm(false); h.el('Cancel').click();
  assert.equal(h.el('Dialog').open, true); assert.equal(h.generated(), 2); h.setConfirm(true); h.el('Close').click(); await flushDialogs();
  assert.equal(h.el('Dialog').open, false); assert.equal(h.document.activeElement, opener); assert.equal(h.applies.length, 0); assert.equal(h.memory(), h.value.source.content);
});

test('declining selection change preserves the operation, raw values and identity allocation', async t => {
  const h = await harness(t); h.el('Add').click(); h.input('Name', 'Pending'); h.setConfirm(false); h.input('Fragment', 'unused');
  assert.equal(h.el('Fragment').value, 'party'); assert.equal(h.el('Name').value, 'Pending'); assert.equal(h.generated(), 2); await h.check(); assert.equal(h.checks[0].edit.fragmentId, 'party');
});

test('pending candidate checks lock all controls and a forced close makes delayed approvals inert', async t => {
  const waiting = deferred(), reached = deferred(), h = await harness(t, { validate: async () => { reached.resolve(); return waiting.promise; } });
  h.el('Add').click(); h.el('Check').click(); await reached.promise;
  for (const suffix of ['Fragment', 'Group', 'Actor', 'Key', 'Name', 'Parent', 'Assignment', 'Add', 'Edit', 'Assign', 'Remove', 'Check', 'Apply', 'Cancel', 'Close']) assert.equal(h.el(suffix).disabled, true, suffix);
  h.el('Dialog').close(); await flushDialogs(); waiting.resolve({ ok: true }); await flushDialogs(); assert.equal(h.el('Dialog').open, false); assert.equal(h.receipts.length, 0);
});

test('late open success and failure after the source owner changes never reopen or alert a detached dialog', async t => {
  for (const reject of [false, true]) { const waiting = deferred(), reached = deferred(), h = await harness(t, { skipOpen: true, factory: async (...args) => {
    const draft = await createSceneCompositionGroupsDraft(...args); reached.resolve(); await waiting.promise; if (reject) throw Error('Late failure'); return draft;
  } }); const opening = h.open(); await reached.promise; h.setLive(false); waiting.resolve(); assert.equal(await opening, false); assert.deepEqual(h.alerts, []); assert.equal(h.el('Dialog').open, false); }
});

test('failed complete candidate checks retain diagnostics and stable identities without approving source application', async t => {
  const h = await harness(t, { validate: async () => ({ ok: false, diagnostics: [{ code: 'build_resource_unavailable', propertyPath: '/resources/0' }] }) });
  h.el('Add').click(); await h.check(); assert.equal(h.el('Apply').disabled, true); assert.equal(h.el('Review').hidden, false); assert.equal(h.el('Diagnostics').children.length, 1);
  assert.equal(h.generated(), 2); assert.equal(h.memory(), h.value.source.content);
});

test('silent raw name, parent, actor and group changes invalidate complete approvals before application', async t => {
  for (const [suffix, value] of [['Name', 'Changed'], ['Parent', 'companions'], ['Actor', 'companion'], ['Group', 'spare']]) {
    const h = await harness(t); h.el('Add').click(); await h.check(); h.el(suffix).value = value; h.el('Apply').click(); await settle(h); assert.equal(h.applies.length, 0); assert.equal(h.el('Apply').disabled, true);
  }
});

test('silent raw membership changes during review prevent delayed approval', async t => {
  const waiting = deferred(), reached = deferred(), h = await harness(t, { validate: async () => { reached.resolve(); return waiting.promise; } });
  h.el('Assign').click(); h.input('Assignment', 'spare'); h.el('Check').click(); await reached.promise; h.el('Assignment').value = 'companions'; waiting.resolve({ ok: true }); await settle(h);
  assert.equal(h.el('Apply').disabled, true); assert.equal(h.applies.length, 0); assert.equal(h.generated(), 0);
});

test('missing successful receipt retains the proposed group without sending completion', async t => {
  const h = await harness(t, { apply: async () => ({ applied: false }) }); h.el('Add').click(); await h.check(); h.el('Apply').click(); await settle(h);
  assert.equal(h.el('Dialog').open, true); assert.equal(h.receipts.length, 0); assert.equal(h.memory(), h.value.source.content);
});

test('legitimate source-token advancement completes a group application while preserving the ordinary Save baseline', async t => {
  const h = await harness(t, { dirty: true }); h.input('Group', 'spare'); h.el('Remove').click(); await h.check(); const p = h.checks[0]; h.el('Apply').click(); await settle(h);
  assert.equal(h.el('Dialog').open, false); assert.equal(h.context.sceneDraftToken, 2); assert.equal(h.receipts.length, 1); assert.equal(h.memory(), p.afterContent);
  assert.equal(h.value.saved.includes('未保存😀'), false); assert.equal(h.value.source.content.includes('未保存😀'), true);
});

test('parent closure during preparation rejects delayed group application and preserves author source', async t => {
  const waiting = deferred(), reached = deferred(), h = await harness(t, { apply: async (_p, guard) => { reached.resolve(); await waiting.promise;
    if (!guard.isCurrent()) throw Error('Owner changed'); return { applied: true }; } }); h.el('Add').click(); await h.check(); h.el('Apply').click(); await reached.promise;
  h.setLive(false); waiting.resolve(); await settle(h); assert.equal(h.receipts.length, 0); assert.equal(h.el('Apply').disabled, true); assert.equal(h.memory(), h.value.source.content);
});

test('unsupported group capability and invalid author context fail closed without draft work or sibling access', async t => {
  const h = await harness(t, { supported: false, skipOpen: true, factory() { assert.fail('No ABI must not create a draft'); } }); assert.equal(await h.open(), false); assert.deepEqual(h.alerts, []);
  for (const [key, value] of [['canEditCompositionGroups', false], ['compositionSourceWritable', false], ['editable', false], ['busy', true], ['creating', true], ['sceneDraftPath', 'other.json']]) {
    const valid = await harness(t); valid.context[key] = value; valid.controller.refresh(); assert.equal(valid.el('Add').disabled, true); assert.equal(valid.el('Check').disabled, true); valid.controller.destroy();
  }
});

test('all new group UI and host messages have English and Japanese translations', async () => {
  const source = await fs.readFile(new URL('../../web/modules/app-scene-composition-groups.js', import.meta.url), 'utf8');
  const keys = [...source.matchAll(/(?:data-i18n="([^"]+)"|'([^'\n]*[\u3400-\u9fff][^'\n]*)')/g)].map(match => match[1] || match[2]);
  for (const key of new Set(keys)) { assert.equal(typeof en[key], 'string', `English: ${key}`); assert.equal(typeof ja[key], 'string', `Japanese: ${key}`); }
  for (const key of ['组织分组已应用到原文草稿；尚未保存。', '组织分组已应用；文本与已保存版本一致。']) { assert.equal(typeof en[key], 'string'); assert.equal(typeof ja[key], 'string'); }
});
