import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { webcrypto } from 'node:crypto';
import { createSceneCompositionDefinitionsDraft, prepareSceneCompositionDefinitionsApply } from '../../engine/scene-composition-definitions.mjs';
import { supportsStudioCoreCompositionDefinitionRename } from '../../engine/studio-core.mjs';
import { dialogHarness, flushDialogs } from './dialog-harness.mjs';
import { deferred } from './editor-harness.mjs';
import { definitionsFixture, copy, decoded, hash } from './scene-composition-definitions-fixture.mjs';
import en from '../../web/i18n/en.js';
import ja from '../../web/i18n/ja.js';

async function settle(h) {
  for (let n = 0; n < 200; n++) {
    await flushDialogs();
    if (!h.el('Dialog').open || h.el('Dialog').getAttribute('aria-busy') !== 'true') return;
    await new Promise(resolve => setTimeout(resolve, 1));
  }
  assert.fail('Rename editor remained busy');
}
async function harness(t, options = {}) {
  const value = await definitionsFixture(options), checks = [], applies = [], receipts = [], alerts = [];
  const context = { editable: true, creating: false, busy: false, compositionSourceWritable: true,
    canEditCompositionDefinitions: true, sceneDraftPath: value.source.sourcePath, sceneDraftToken: 1 };
  let live = true, confirm = true, language = 'zh-CN', languageListener = () => {}, generated = 0, memory = value.source.content;
  let supported = options.supported !== false;
  const translate = (key, ...args) => String(({ en, ja }[language] || {})[key] || key).replace(/\{(\d+)\}/g, (_, n) => args[n] ?? '');
  const factory = async (...args) => {
    const draft = await createSceneCompositionDefinitionsDraft(...args);
    return { fragments: draft.fragments, propose(input) { return draft.propose(copy(input)); } };
  };
  const h = await dialogHarness('app-scene-composition-definitions', {
    crypto: { subtle: webcrypto.subtle, randomUUID() { generated++; return webcrypto.randomUUID(); } }, queueMicrotask,
    createSceneCompositionDefinitionsDraft: options.factory || factory,
    ...(!options.noProbe ? { supportsStudioCoreCompositionDefinitionRename: () => supported && supportsStudioCoreCompositionDefinitionRename() } : {}),
    t: translate, translatePage(root) { for (const item of root.querySelectorAll('[data-i18n]')) item.textContent = translate(item.dataset.i18n); },
    onLanguageChange(listener) { languageListener = listener; return () => {}; },
    fetchJsonApiRequest() { assert.fail('Dependency transport and ordinary Save remain parent owned'); },
  });
  h.runtime.window.confirm = () => confirm; h.runtime.window.alert = text => alerts.push(text);
  const controller = h.runtime.setupSceneCompositionDefinitions({ getContext: () => context,
    validateDraft: async (proposal, guard) => { checks.push(copy(proposal)); return options.validate ? options.validate(proposal, guard) : { ok: true }; },
    applySourceDraft: async (proposal, guard) => {
      applies.push(copy(proposal)); if (options.apply) return options.apply(proposal, guard, context);
      const result = await prepareSceneCompositionDefinitionsApply({ ...value.source, content: memory }, copy(proposal), { digest: hash });
      if (!guard.isCurrent()) throw Error('Source owner changed');
      memory = result.afterContent; context.sceneDraftToken++; return { applied: true };
    },
    sourceApplied: async (result, proposal) => { receipts.push({ result, proposal: copy(proposal) }); },
  });
  const el = suffix => h.element('sceneCompositionDefinitions' + suffix);
  const open = extra => controller.open({ ...value, isCurrent: () => live, ...extra });
  t.after(() => controller.destroy()); if (!options.skipOpen) assert.equal(await open(), true);
  const input = (suffix, raw) => { el(suffix).value = String(raw); el(suffix).dispatch(suffix === 'Fragment' ? 'change' : 'input'); };
  const check = async () => { el('Check').click(); await settle({ el }); };
  const rename = raw => { el('Rename').click(); if (raw !== undefined) input('FragmentId', raw); };
  return { ...h, value, context, controller, el, checks, applies, receipts, alerts, open, input, check, rename,
    generated: () => generated, memory: () => memory, setLive(v) { live = v; }, setConfirm(v) { confirm = v; },
    setSupported(v) { supported = v; }, setLanguage(v) { language = v; languageListener(); } };
}
const references = h => h.el('Targets').querySelectorAll('li[data-placement-id]');

test('placed definition rename pre-fills the current ID and explains that only removal requires no placements', async t => {
  const h = await harness(t); h.rename(); assert.equal(h.el('FragmentId').value, 'party');
  assert.equal(h.el('ActorFields').hidden, true); assert.equal(h.el('Fields').hidden, false);
  assert.match(h.el('RemoveHint').textContent, /已放置和未放置片段均可重命名/);
  assert.match(h.el('OperationHint').textContent, /区分大小写/); assert.equal(h.generated(), 0);
});

test('same-ID rename reports unchanged and never requests candidate approval', async t => {
  const h = await harness(t); h.rename(); await h.check();
  assert.equal(h.checks.length, 0); assert.equal(h.el('Apply').disabled, true);
  assert.match(h.el('Message').textContent, /片段标识未变化/); assert.equal(h.el('FragmentId').value, 'party');
  assert.equal(h.memory(), h.value.source.content);
});

test('multi-placement rename reviews actual stable actor and group UUIDs with an exact empty target proposal', async t => {
  const h = await harness(t); h.rename('renamedParty'); await h.check(); const proposal = h.checks[0];
  assert.deepEqual(proposal.edit, { action: 'rename', fragmentId: 'party', newFragmentId: 'renamedParty' }); assert.deepEqual(proposal.targets, []);
  assert.equal(Object.keys(proposal).length, 8); assert.equal(h.el('Targets').children[0].dataset.previousFragmentId, 'party');
  assert.equal(h.el('Targets').children[0].dataset.fragmentId, 'renamedParty');
  assert.deepEqual(references(h).map(item => item.dataset.placementId), h.value.recipe.placements.map(item => item.placementId));
  for (const [n, row] of references(h).entries()) {
    assert.deepEqual(row.querySelectorAll('p[data-instance-id]').map(item => item.dataset.instanceId), h.value.recipe.fragments[0].actors.map(actor => h.value.recipe.placements[n].actorIds[actor.key]));
    assert.deepEqual(row.querySelectorAll('p[data-group-id]').map(item => item.dataset.groupId), h.value.recipe.fragments[0].groups.map(group => h.value.recipe.placements[n].groupIds[group.key]));
  }
  const expected = copy(h.value.recipe); expected.fragments[0].fragmentId = 'renamedParty'; expected.placements.forEach(item => { item.fragmentId = 'renamedParty'; });
  assert.deepEqual(decoded(proposal.afterContent), expected); assert.equal(h.el('Source').textContent, proposal.afterContent);
  assert.equal(h.generated(), 0); assert.equal(h.el('Apply').disabled, false);
});

test('unused definition rename changes only its declaration and displays no virtual identities', async t => {
  const h = await harness(t); h.input('Fragment', 'unused'); h.rename('unusedNew'); await h.check();
  const expected = copy(h.value.recipe); expected.fragments[1].fragmentId = 'unusedNew';
  assert.deepEqual(decoded(h.checks[0].afterContent), expected); assert.deepEqual(h.checks[0].targets, []);
  assert.equal(references(h).length, 0); assert.equal(h.generated(), 0);
});

test('the last remaining used definition can be renamed while REMOVE stays disabled', async t => {
  const h = await harness(t, { oneFragment: true }); assert.equal(h.el('Remove').disabled, true);
  h.rename('soleParty'); await h.check(); assert.equal(h.checks.length, 1); assert.equal(h.el('Apply').disabled, false);
});

test('IDs are case sensitive and the existing differently cased references update consistently', async t => {
  const h = await harness(t); h.rename('Party'); await h.check(); assert.equal(h.checks.length, 1);
  const after = decoded(h.checks[0].afterContent); assert.equal(after.fragments[0].fragmentId, 'Party');
  assert.deepEqual(after.placements.map(item => item.fragmentId), ['Party', 'Party']);
});

test('duplicate invalid and incomplete rename IDs retain raw input and never approve', async t => {
  for (const raw of ['unused', '', '9invalid', 'invalid space', 'a'.repeat(65)]) {
    const h = await harness(t); h.rename(raw); await h.check(); assert.equal(h.el('FragmentId').value, raw);
    assert.equal(h.checks.length, 0); assert.equal(h.el('Apply').disabled, true); assert.equal(h.memory(), h.value.source.content);
  }
});

test('missing rename adapter leaves all three original definition operations usable without changing the harness', async t => {
  const h = await harness(t, { noProbe: true }); assert.equal(h.el('Rename').disabled, true); h.el('Rename').dispatch('click');
  assert.equal(h.el('Check').disabled, true); h.el('Add').click(); await h.check(); assert.equal(h.checks[0].edit.action, 'add');
  h.el('Copy').click(); await h.check(); assert.equal(h.checks[1].edit.action, 'copy');
  h.input('Fragment', 'unused'); h.el('Remove').click(); await h.check(); assert.equal(h.checks[2].edit.action, 'remove');
  assert.equal(h.generated(), 0);
});

test('unsupported rename capability disables only rename while original ADD COPY and REMOVE check normally', async t => {
  const h = await harness(t, { supported: false }); assert.equal(h.el('Rename').disabled, true);
  assert.match(h.el('RenameHint').textContent, /新增、复制和移除仍可使用/);
  for (const suffix of ['Add', 'Copy']) { h.el(suffix).click(); await h.check(); }
  h.input('Fragment', 'unused'); h.el('Remove').click(); await h.check();
  assert.deepEqual(h.checks.map(p => p.edit.action), ['add', 'copy', 'remove']);
});

test('losing rename capability before check rejects the intent but a confirmed switch to COPY remains available', async t => {
  const h = await harness(t); h.rename('future'); h.setSupported(false); h.controller.refresh();
  assert.equal(h.el('Check').disabled, true); h.el('Check').dispatch('click'); await settle(h); assert.equal(h.checks.length, 0);
  assert.equal(h.el('Copy').disabled, false); h.el('Copy').click(); await h.check(); assert.equal(h.checks[0].edit.action, 'copy');
});

test('losing rename capability after approval prevents apply and preserves the typed ID', async t => {
  const h = await harness(t); h.rename('future'); await h.check(); h.setSupported(false); h.el('Apply').dispatch('click'); await settle(h);
  assert.equal(h.applies.length, 0); assert.equal(h.el('Apply').disabled, true); assert.equal(h.el('FragmentId').value, 'future');
  h.setSupported(true); h.controller.refresh(); assert.equal(h.el('Apply').disabled, true); await h.check(); assert.equal(h.el('Apply').disabled, false);
});

test('ordinary source application advances the token once and reports the exact committed proposal without saving disk', async t => {
  const h = await harness(t, { dirty: true }); h.rename('committed'); await h.check(); h.el('Apply').click(); await settle(h);
  assert.equal(h.el('Dialog').open, false); assert.equal(h.context.sceneDraftToken, 2);
  assert.equal(h.receipts.length, 1); assert.deepEqual(h.receipts[0].proposal, h.checks[0]);
  assert.equal(h.memory(), h.checks[0].afterContent); assert.equal(h.value.saved.includes('committed'), false);
  assert.equal(h.generated(), 0);
});

test('cancel and keyboard Escape preserve the original source and return focus only after explicit discard', async t => {
  const h = await harness(t, { skipOpen: true }); const opener = h.document.createElement('button'); h.document.body.append(opener); opener.focus(); await h.open();
  h.rename('cancelled'); h.setConfirm(false); h.el('Cancel').click(); assert.equal(h.el('Dialog').open, true);
  h.el('Dialog').dispatch('cancel'); assert.equal(h.el('Dialog').open, true);
  h.setConfirm(true); h.el('Dialog').dispatch('cancel'); await flushDialogs(); await flushDialogs();
  assert.equal(h.el('Dialog').open, false); assert.equal(h.document.activeElement, opener); assert.equal(h.memory(), h.value.source.content);
  assert.equal(h.applies.length, 0);
});

test('switching fragment or operation honors discard and retains the entered rename until confirmed', async t => {
  const h = await harness(t); h.rename('retained'); h.setConfirm(false); h.input('Fragment', 'unused');
  assert.equal(h.el('Fragment').value, 'party'); assert.equal(h.el('FragmentId').value, 'retained');
  h.el('Copy').click(); assert.equal(h.el('FragmentId').value, 'retained'); h.setConfirm(true); h.input('Fragment', 'unused');
  h.rename(); assert.equal(h.el('FragmentId').value, 'unused');
});

test('silent raw ID and selected source changes invalidate an existing approval before apply', async t => {
  for (const alter of [h => { h.el('FragmentId').value = 'unreviewed'; }, h => { h.el('Fragment').value = 'unused'; }]) {
    const h = await harness(t); h.rename('reviewed'); await h.check(); alter(h); h.el('Apply').dispatch('click'); await settle(h);
    assert.equal(h.applies.length, 0); assert.equal(h.el('Apply').disabled, true); assert.equal(h.memory(), h.value.source.content);
  }
});

test('normal rename input invalidates approval while language changes preserve both input and approval', async t => {
  const h = await harness(t); h.rename('reviewed'); await h.check(); h.setLanguage('en'); h.setLanguage('ja');
  assert.equal(h.el('FragmentId').value, 'reviewed'); assert.equal(h.el('Apply').disabled, false);
  h.input('FragmentId', 'changed'); assert.equal(h.el('Apply').disabled, true); assert.equal(h.el('Review').hidden, true);
});

test('pending rename review locks all actions and silent edits cannot gain a delayed approval', async t => {
  const waiting = deferred(); const h = await harness(t, { validate: () => waiting.promise }); h.rename('waiting'); h.el('Check').click(); await flushDialogs();
  for (const suffix of ['Add', 'Copy', 'Rename', 'Remove', 'Fragment', 'FragmentId', 'Close', 'Cancel', 'Apply']) assert.equal(h.el(suffix).disabled, true, suffix);
  h.el('FragmentId').value = 'silent'; waiting.resolve({ ok: true }); await settle(h);
  assert.equal(h.el('Apply').disabled, true); assert.equal(h.el('FragmentId').value, 'silent'); assert.equal(h.applies.length, 0);
});

test('a lost source token during delayed review prevents approval and keeps the rename draft', async t => {
  const waiting = deferred(); const h = await harness(t, { validate: () => waiting.promise }); h.rename('waiting'); h.el('Check').click(); await flushDialogs();
  h.context.sceneDraftToken++; waiting.resolve({ ok: true }); await settle(h);
  assert.equal(h.el('Apply').disabled, true); assert.match(h.el('Message').textContent, /原文或预览已变化/); assert.equal(h.el('FragmentId').value, 'waiting');
});

test('forced close during review cannot approve or reopen the next dialog session', async t => {
  const waiting = deferred(); const h = await harness(t, { validate: () => waiting.promise }); h.rename('waiting'); h.el('Check').click(); await flushDialogs();
  h.el('Dialog').close(); await flushDialogs(); assert.equal(await h.open(), true); waiting.resolve({ ok: true }); await settle(h);
  assert.equal(h.el('Dialog').open, true); assert.equal(h.el('Check').disabled, true); assert.equal(h.el('Apply').disabled, true); assert.equal(h.applies.length, 0);
});

test('late open success and rejection from a replaced source owner stay silent', async t => {
  for (const reject of [false, true]) {
    const waiting = deferred(); const h = await harness(t, { skipOpen: true, factory: () => waiting.promise }); const opening = h.open(); h.setLive(false);
    if (reject) waiting.reject(Error('late failure')); else waiting.resolve({ fragments: [], propose() {} });
    assert.equal(await opening, false); assert.equal(h.el('Dialog').open, false); assert.deepEqual(h.alerts, []);
  }
});

test('source guard rejecting a delayed apply keeps the raw rename and cannot send a completion receipt', async t => {
  const waiting = deferred(); let guard;
  const h = await harness(t, { apply: async (_proposal, ownership) => { guard = ownership; await waiting.promise; if (!ownership.isCurrent()) throw Error('Owner changed'); return { applied: true }; } });
  h.rename('guarded'); await h.check(); h.el('Apply').click(); await flushDialogs(); h.context.sceneDraftToken++; assert.equal(guard.isCurrent(), false);
  waiting.resolve(); await settle(h); assert.equal(h.receipts.length, 0); assert.equal(h.el('FragmentId').value, 'guarded'); assert.equal(h.memory(), h.value.source.content);
});

test('external source conflict preserves local rename and original disk baseline for the ordinary Save workflow', async t => {
  const h = await harness(t, { apply: async () => { throw Object.assign(Error('External content changed'), { errorCode: 'scene_composition_definitions_conflict' }); } });
  h.rename('conflictDraft'); await h.check(); h.el('Apply').click(); await settle(h);
  assert.equal(h.el('Dialog').open, true); assert.equal(h.el('FragmentId').value, 'conflictDraft'); assert.equal(h.receipts.length, 0);
  assert.equal(h.memory(), h.value.source.content); assert.match(h.el('Message').textContent, /原文或预览已变化/);
});

test('detached review and apply payloads cannot mutate the internal approved rename', async t => {
  const h = await harness(t, { validate: async proposal => { proposal.edit.newFragmentId = 'forged'; proposal.targets.push({ fake: true }); return { ok: true }; } });
  h.rename('honest'); await h.check(); h.el('Apply').click(); await settle(h);
  assert.equal(h.applies[0].edit.newFragmentId, 'honest'); assert.deepEqual(h.applies[0].targets, []); assert.equal(decoded(h.memory()).fragments[0].fragmentId, 'honest');
});

test('all new rename messages translate in English and Japanese and identity text never injects markup', async t => {
  const source = await fs.readFile(new URL('../../web/modules/app-scene-composition-definitions.js', import.meta.url), 'utf8');
  const keys = new Set([...source.matchAll(/data-i18n="([^"]+)"|\bt\('([^']+)'/g)].map(match => match[1] || match[2]));
  for (const key of keys) for (const [locale, messages] of [['en', en], ['ja', ja]]) assert.equal(typeof messages[key], 'string', locale + ': ' + key);
  const h = await harness(t); h.rename('<script>bad</script>'); assert.equal(h.el('Targets').querySelectorAll('script').length, 0);
  assert.ok(h.el('Targets').textContent.includes('<script>bad</script>'));
  for (const locale of ['en', 'ja']) { h.setLanguage(locale); const messages = locale === 'en' ? en : ja;
    assert.equal(h.el('Rename').textContent, messages['重命名片段定义']); assert.equal(h.el('FieldTitle').textContent, messages['重命名片段定义']);
    assert.equal(h.el('OperationHint').textContent, messages['填写配方内唯一的新标识，区分大小写；全部现有放置引用会同步更新，身份与声明保持。']);
  }
  await h.check(); assert.equal(h.el('Apply').disabled, true); assert.equal(h.generated(), 0);
});
