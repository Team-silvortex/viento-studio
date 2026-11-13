import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { dialogHarness, flushDialogs } from './dialog-harness.mjs';
import { deferred } from './editor-harness.mjs';
import { listScriptStarters, prepareScriptDraft, isScriptDraftProposal, prepareScriptDraftApply, prepareAnimationStateScriptDraft, DEFAULT_ANIMATION_STATE_TABLE, supportsAnimationStateScript } from '../../engine/script-authoring.mjs';
import { setupAnimationStateScript } from '../../web/modules/app-animation-state-script.js';
import en from '../../web/i18n/en.js';
import ja from '../../web/i18n/ja.js';

const copy = value => JSON.parse(JSON.stringify(value));
const settle = async () => { await flushDialogs(); await flushDialogs(); };
async function fixture(t, settings = {}) {
  let language = 'zh', changedLanguage = () => {}, unsubscribeCount = 0;
  const context = { editable: true, busy: false, dirty: false, creating: false, sourceToken: 'source:1',
    documentRoot: 'documents', documentTypes: [{ id: 'note', label: 'Note <b>' }, { id: 'script', label: 'My scripts' }], ...settings.context };
  const calls = [], proposals = [], focused = [], confirms = [];
  const translate = (key, ...args) => (({ en, ja }[language]?.[key] || key).replace(/\{(\d+)\}/g, (_, n) => String(args[n] ?? '')));
  const h = await dialogHarness('app-script-create', {
    listScriptStarters, DEFAULT_ANIMATION_STATE_TABLE, setupAnimationStateScript,
    supportsAnimationStateScript: () => settings.supports?.() ?? supportsAnimationStateScript(),
    ...(settings.combinationSupport ? { supportsStudioCoreAnimationStateCombinations: settings.combinationSupport } : {}),
    ...(settings.selectorSupport ? { supportsStudioCoreAnimationStateSelectors: settings.selectorSupport } : {}),
    ...(settings.branchSupport ? { supportsStudioCoreAnimationStateBranches: settings.branchSupport } : {}),
    ...(settings.conditionSupport ? { supportsStudioCoreAnimationStateConditions: settings.conditionSupport } : {}),
    prepareAnimationStateScriptDraft: (owner, request, table) => { const proposal = settings.prepareState ? settings.prepareState(copy(owner), copy(request), copy(table)) : prepareAnimationStateScriptDraft(copy(owner), copy(request), copy(table)); proposals.push(proposal); return proposal; },
    prepareScriptDraft: (owner, request) => { const proposal = prepareScriptDraft(copy(owner), copy(request)); proposals.push(proposal); return proposal; },
    t: translate,
    translatePage: root => { for (const node of root.querySelectorAll('[data-i18n]')) node.textContent = translate(node.dataset.i18n); },
    onLanguageChange: listener => { changedLanguage = listener; return () => { unsubscribeCount++; changedLanguage = () => {}; }; },
  });
  h.runtime.window.confirm = message => { confirms.push(message); return settings.confirm?.() ?? true; };
  let controller;
  controller = h.runtime.setupScriptCreate({ getContext: () => context, createDraft: async (proposal, ports) => {
    calls.push({ proposal, ports });
    if (settings.createDraft) return settings.createDraft(proposal, ports, { context, refresh: () => controller.refresh() });
    assert.equal(ports.isCurrent(), true);
    const content = prepareScriptDraftApply(copy({ sourceToken: context.sourceToken, documentRoot: context.documentRoot, documentTypes: context.documentTypes }), proposal);
    assert.equal(content.content, proposal.content);
    context.sourceToken = 'new-draft'; context.creating = true; context.dirty = true; controller.refresh();
    return { applied: true, focus: () => { assert.equal(h.element('scriptCreateDialog').open, false); focused.push(true); } };
  } });
  t.after(() => controller.dispose());
  const el = suffix => h.element('scriptCreate' + suffix);
  return { ...h, controller, context, el, calls, proposals, focused, confirms,
    open: () => controller.open(), click: async suffix => { el(suffix).click(); await settle(); },
    set: (suffix, value, event = 'input') => { el(suffix).value = value; if (event) el(suffix).dispatch(event); },
    language: value => { language = value; changedLanguage(); }, unsubscribeCount: () => unsubscribeCount };
}


for (const id of ['godot-action-scene-switch', 'godot-event-scene-switch']) {
  test(`${id} keeps exact preview through multilingual selection and only hands off an explicitly reviewed draft`, async t => {
    const h = await fixture(t), starter = listScriptStarters().find(item => item.id === id);
    assert.ok(starter); assert.equal(h.open(), true); h.set('Starter', id, 'change');
    h.set('Path', `documents/scripts/${id}.txt`);
    assert.equal(h.el('Source').textContent, starter.content); assert.equal(h.calls.length, 0);
    for (const language of ['en', 'ja', 'zh']) {
      h.language(language); assert.equal(h.el('Starter').value, id);
      assert.equal(h.el('Source').textContent, starter.content); assert.equal(h.calls.length, 0);
      if (language !== 'zh') assert.notEqual(h.el('Description').textContent, starter.description);
    }
    await h.click('Apply'); assert.equal(h.calls.length, 1);
    assert.equal(isScriptDraftProposal(h.calls[0].proposal), true);
    assert.equal(h.calls[0].proposal.content, starter.content);
    assert.equal(h.calls[0].proposal.sourcePath, `documents/scripts/${id}.txt`);
    assert.equal(h.calls[0].ports.isCurrent(), false);
  });
  test(`${id} refuses dirty editors, retains a rejected cancellation, and invalidates stale sessions`, async t => {
    const dirty = await fixture(t, {context: {dirty: true}}); assert.equal(dirty.open(), false); assert.equal(dirty.calls.length, 0);
    let confirm = false; const h = await fixture(t, {confirm: () => confirm}); assert.equal(h.open(), true);
    h.set('Starter', id, 'change'); h.set('Path', `documents/scripts/${id}.txt`); const content = h.el('Source').textContent;
    await h.click('Cancel'); assert.equal(h.el('Dialog').open, true); assert.equal(h.el('Source').textContent, content);
    assert.equal(h.calls.length, 0); h.context.sourceToken = 'another-session'; h.controller.refresh();
    await h.click('Apply'); assert.equal(h.calls.length, 0); assert.equal(h.el('Apply').disabled, true);
    assert.equal(h.el('Starter').value, id); assert.equal(h.el('Source').textContent, content);
    confirm = true; await h.click('Cancel'); assert.equal(h.el('Dialog').open, false);
  });
}
