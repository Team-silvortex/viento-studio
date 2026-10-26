import test from 'node:test';
import assert from 'node:assert/strict';
import { dialogHarness, flushDialogs } from './dialog-harness.mjs';
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


const starterId = 'godot-character-drop-through';
const selectedStarter = () => { const value = listScriptStarters().find(row => row.id === starterId); assert.ok(value); return value; };

test('drop-through starter renders exact ordinary source and queued one-way semantics in three languages without replacing focus', async t => {
  const h = await fixture(t), starter = selectedStarter(); h.open(); h.set('Starter', starterId, 'change');
  h.set('Path', 'documents/scripts/drop-through.txt'); const node = h.el('Starter'); node.focus();
  for (const language of ['en', 'ja', 'zh']) {
    h.language(language); const dictionary = { en, ja }[language] || {};
    assert.equal(h.el('Starter'), node); assert.equal(h.document.activeElement, node); assert.equal(node.value, starterId);
    assert.equal(h.el('Source').textContent, starter.content); assert.equal(h.el('Description').textContent, dictionary[starter.description] || starter.description);
    assert.equal(h.el('Path').value, 'documents/scripts/drop-through.txt'); assert.equal(h.calls.length, 0);
    const option = node.children.find(row => row.value === starterId); assert.equal(option.textContent, dictionary[starter.label] || starter.label);
  }
  assert.ok(en[starter.label] && ja[starter.label] && en[starter.description] && ja[starter.description]);
});

test('drop-through starter cancellation writes nothing and explicit apply hands off only the exact branded ordinary TXT draft', async t => {
  const h = await fixture(t), starter = selectedStarter(); h.open(); h.set('Starter', starterId, 'change');
  h.set('Path', 'documents/scripts/drop-through.txt'); await h.click('Cancel');
  assert.equal(h.calls.length, 0); assert.equal(h.el('Dialog').open, false);
  h.open(); h.set('Starter', starterId, 'change'); h.set('Path', 'documents/scripts/drop-through.txt'); await h.click('Apply');
  assert.equal(h.calls.length, 1); const proposal = h.calls[0].proposal;
  assert.ok(isScriptDraftProposal(proposal)); assert.equal(proposal.starterId, starterId); assert.equal(proposal.content, starter.content);
  assert.equal(proposal.sourcePath, 'documents/scripts/drop-through.txt'); assert.deepEqual(h.focused, [true]);
});

