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


const starterId = 'godot-character-contact-events';
const selectedStarter = () => { const value = listScriptStarters().find(row => row.id === starterId); assert.ok(value); return value; };

test('contact starter renders exact ordinary source and bounded collision semantics in three languages without replacing focus', async t => {
  const h = await fixture(t), starter = selectedStarter(); h.open(); h.set('Starter', starterId, 'change');
  h.set('Path', 'documents/scripts/move-collisions.txt'); const node = h.el('Starter'); node.focus();
  for (const language of ['en', 'ja', 'zh']) {
    h.language(language); const dictionary = { en, ja }[language] || {};
    assert.equal(h.el('Starter'), node); assert.equal(h.document.activeElement, node); assert.equal(node.value, starterId);
    assert.equal(h.el('Source').textContent, starter.content); assert.equal(h.el('Description').textContent, dictionary[starter.description] || starter.description);
    assert.equal(h.el('Path').value, 'documents/scripts/move-collisions.txt'); assert.equal(h.calls.length, 0);
    const option = node.children.find(row => row.value === starterId); assert.equal(option.textContent, dictionary[starter.label] || starter.label);
  }
  assert.ok(en[starter.label] && ja[starter.label] && en[starter.description] && ja[starter.description]);
});

test('contact starter cancellation writes nothing and explicit apply hands off only the exact branded ordinary TXT draft', async t => {
  const h = await fixture(t), starter = selectedStarter(); h.open(); h.set('Starter', starterId, 'change');
  h.set('Path', 'documents/scripts/collision-events.txt'); await h.click('Cancel');
  assert.equal(h.calls.length, 0); assert.equal(h.el('Dialog').open, false);
  h.open(); h.set('Starter', starterId, 'change'); h.set('Path', 'documents/scripts/collision-events.txt'); await h.click('Apply');
  assert.equal(h.calls.length, 1); const proposal = h.calls[0].proposal;
  assert.ok(isScriptDraftProposal(proposal)); assert.equal(proposal.starterId, starterId); assert.equal(proposal.content, starter.content);
  assert.equal(proposal.sourcePath, 'documents/scripts/collision-events.txt'); assert.deepEqual(h.focused, [true]);
});

const id = n => `${String(n).padStart(8, '0')}-1111-4111-8111-111111111111`;
const origin = bindingId => ({ visitIndex: 1, sceneId: id(1), bindingId, instanceId: id(2), objectId: id(3),
  source: { objectId: id(4), sourcePath: 'documents/behaviors/demo.json', sourceRevision: 'sha256:' + 'a'.repeat(64), propertyPath: bindingId === id(5) ? '/bindings/0' : '/bindings/1' } });
const contactHistory = () => ({ sequence: 3, entries: ['physics.contact_started', 'physics.contact_ended', 'physics.contact_started'].map((name, index) => ({
  sequence: index + 1, name, value: id(6), origin: origin(id(5)),
  deliveries: name.endsWith('started') ? [{ subscriptionId: 1, origin: origin(id(7)), status: 'handled' }] : []
})) });
async function observer(t) {
  let dictionary = {}, changedLanguage = () => {};
  const context = { available: true, visible: true, sessionOwner: 'contact-run-1', navigationOwner: 'visit-1', canOpenSource: true }, calls = [];
  const h = await dialogHarness('app-project-event-observation', {
    t: (key, ...values) => (dictionary[key] || key).replace(/\{(\d+)\}/g, (_, index) => values[index] ?? ''),
    onLanguageChange(callback) { changedLanguage = callback; return () => {}; }
  });
  const container = h.document.createElement('div'); container.id = 'projectEventTrace'; container.isConnected = true; h.document.body.append(container);
  const controller = h.runtime.setupProjectEventObservation({ container, getContext: () => context, onOpen: async (source, ticket) => { calls.push({source,ticket}); return true; } });
  t.after(() => controller.dispose()); const el = suffix => h.element('projectEventTrace' + suffix);
  return { ...h, controller, calls, context, el, rows: () => el('Entries').children.filter(row => !row.hidden),
    language(value) { dictionary = value; changedLanguage(); }, filter(value) { el('Search').value=value;el('Search').dispatch('input'); } };
}

test('contact event history preserves repeated started facts, other instance payload and separate self publisher identity', async t => {
  const h = await observer(t), history = contactHistory(); h.controller.setSnapshot(history);
  assert.deepEqual(h.rows().map(row => row.dataset.name), history.entries.map(row => row.name));
  for (const row of h.rows()) assert.equal(row.querySelector('.project-event-value').textContent, JSON.stringify(id(6)));
  h.rows()[0].querySelector('.project-event-publisher-source').click(); await settle();
  assert.equal(h.calls[0].source.instanceId, id(2)); assert.equal(h.calls[0].source.objectId, id(3));
  assert.equal(h.calls[0].source.source.objectId, id(4)); assert.notEqual(h.calls[0].source.instanceId, history.entries[0].value);
  h.rows()[0].querySelector('.project-event-subscriber-source').click(); await settle();
  assert.equal(h.calls[1].source.bindingId, id(7)); assert.equal(h.calls[1].source.source.propertyPath, '/bindings/1');
  assert.equal(h.rows()[1].querySelector('.project-event-subscriber-source'), null);
  for (const dictionary of [en, ja, {}]) { h.language(dictionary); assert.equal(h.rows().length, 3); assert.equal(h.rows()[2].dataset.sequence, '3'); }
});

test('contact filtering retains exact payload and focused source while a different run clears history instead of synthesizing ended', async t => {
  const h = await observer(t); h.controller.setSnapshot(contactHistory());h.filter('contact_started');
  assert.deepEqual(h.rows().map(row => row.dataset.sequence), ['1','3']);const button=h.rows()[1].querySelector('.project-event-publisher-source');button.focus();h.language(ja);
  assert.equal(h.document.activeElement,button);assert.equal(h.rows()[1].querySelector('.project-event-publisher-source'),button);
  h.filter('contact_ended');assert.equal(h.rows().length,1);assert.equal(h.rows()[0].dataset.sequence,'2');
  h.context.sessionOwner='contact-run-2';h.controller.refresh();assert.equal(h.el('Panel').hidden,true);assert.equal(h.rows().length,0);
  h.controller.setSnapshot({sequence:0,entries:[]});assert.equal(h.rows().length,0);assert.equal(h.el('Sequence').dataset.sequence,'0');assert.equal(h.calls.length,0);
});
