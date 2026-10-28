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

test('standalone entry needs an editable idle editor and protects existing or new drafts', async t => {
  for (const patch of [{ editable: false }, { busy: true }, { dirty: true }, { creating: true }, { documentTypes: [] }, { sourceToken: '' }]) {
    const h = await fixture(t, { context: patch });
    assert.equal(h.open(), false); assert.equal(h.el('Btn').disabled, true); assert.equal(h.calls.length, 0);
  }
  const h = await fixture(t);
  assert.deepEqual(Object.keys(h.controller).sort(), ['dispose', 'open', 'refresh']);
  assert.equal(h.el('Btn').parentElement.id, 'docEditActions'); assert.equal(h.el('Btn').hidden, false);
  h.el('Btn').click(); assert.equal(h.el('Dialog').open, true); assert.equal(h.open(), false);
  assert.equal(h.el('Type').value, 'script'); assert.equal(h.el('Path').value, 'documents/scripts/new-script.txt');
  assert.equal(h.el('Dialog').dataset.dirty, 'false'); assert.equal(h.calls.length, 0);
});

test('any existing project type can register a TXT script, with the actual legacy document root', async t => {
  const h = await fixture(t, { context: { documentRoot: 'design-data', documentTypes: [{ id: 'character', label: '角色' }] } });
  assert.equal(h.open(), true); assert.equal(h.el('Type').value, 'character');
  assert.equal(h.el('Path').value, 'design-data/scripts/new-script.txt');
  await h.click('Apply'); assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].proposal.documentType, 'character'); assert.equal(h.calls[0].proposal.sourcePath, 'design-data/scripts/new-script.txt');
});

test('starter selection previews every exact source byte without calling the author port', async t => {
  const h = await fixture(t); h.open();
  for (const starter of listScriptStarters()) {
    h.set('Starter', starter.id, 'change');
    assert.equal(h.el('Source').textContent, starter.content); assert.equal(h.el('Description').textContent, starter.description);
    assert.equal(h.el('Source').tagName, 'PRE'); assert.equal(h.el('Apply').disabled, false); assert.equal(h.calls.length, 0);
  }
  assert.equal(h.el('Dialog').dataset.dirty, 'true');
  h.set('Starter', listScriptStarters()[0].id, 'change'); assert.equal(h.el('Dialog').dataset.dirty, 'false');
});

test('explicit handoff sends the branded reviewed proposal once and closes before focusing the new draft', async t => {
  const h = await fixture(t); h.open(); h.set('Starter', 'godot-signal', 'change'); h.set('Type', 'note', 'change'); h.set('Path', 'documents/scripts/我的脚本.txt');
  const preview = h.el('Source').textContent;
  await h.click('Apply');
  assert.equal(h.calls.length, 1); assert.equal(isScriptDraftProposal(h.calls[0].proposal), true);
  assert.equal(h.calls[0].proposal.content, preview); assert.equal(h.calls[0].proposal.documentType, 'note');
  assert.equal(h.el('Dialog').open, false); assert.equal(h.el('Dialog').dataset.dirty, 'false'); assert.deepEqual(h.focused, [true]);
  assert.equal(h.calls[0].ports.isCurrent(), false); assert.equal(h.el('Btn').disabled, true);
});

test('invalid or non-TXT paths keep choices and cannot be handed off', async t => {
  const h = await fixture(t); h.open();
  for (const path of ['documents/code.gd', 'other/code.txt', 'documents/../code.txt', 'documents/.hidden/a.txt', 'documents/CON.txt', 'documents/']) {
    h.set('Path', path); assert.equal(h.el('Apply').disabled, true, path); await h.click('Apply');
    assert.equal(h.calls.length, 0); assert.equal(h.el('Path').value, path); assert.equal(h.el('Dialog').dataset.dirty, 'true');
  }
  h.set('Path', 'documents/scripts/repaired.txt'); assert.equal(h.el('Apply').disabled, false);
});

test('silent field changes require a visible new review before applying', async t => {
  const h = await fixture(t); h.open(); const previous = h.el('Source').textContent;
  h.set('Starter', 'godot-signal', null); await h.click('Apply');
  assert.equal(h.calls.length, 0); assert.notEqual(h.el('Source').textContent, previous);
  await h.click('Apply'); assert.equal(h.calls.length, 1); assert.equal(h.calls[0].proposal.starterId, 'godot-signal');
});

test('context changes at click time cannot replace source or reset local choices', async t => {
  for (const change of [h => h.context.dirty = true, h => h.context.creating = true, h => h.context.busy = true,
    h => h.context.editable = false, h => h.context.sourceToken = 'other', h => h.context.documentRoot = 'design-data',
    h => h.context.documentTypes[1].label = 'Changed', h => h.context.documentTypes.pop()]) {
    const h = await fixture(t); h.open(); h.set('Path', 'documents/scripts/unfinished.txt'); change(h); await h.click('Apply');
    assert.equal(h.calls.length, 0); assert.equal(h.el('Dialog').open, true); assert.equal(h.el('Apply').disabled, true);
    assert.equal(h.el('Path').value, 'documents/scripts/unfinished.txt'); assert.match(h.el('Status').textContent, /已变化/);
  }
});

test('pending handoffs exclude duplicates, cancellation, typing and editor save shortcuts', async t => {
  const wait = deferred(), h = await fixture(t, { createDraft: () => wait.promise }); h.open(); h.el('Apply').click();
  assert.equal(h.el('Dialog').getAttribute('aria-busy'), 'true'); assert.equal(h.el('Path').disabled, true);
  h.el('Apply').click(); h.el('Close').click(); h.el('Dialog').dispatch('cancel'); assert.equal(h.calls.length, 1); assert.equal(h.el('Dialog').open, true);
  for (const event of [{ key: 's', ctrlKey: true }, { key: 's', metaKey: true }, { key: 'Enter', ctrlKey: true }]) {
    const key = h.el('Dialog').dispatch('keydown', event); assert.equal(key.defaultPrevented, true); assert.equal(key.stopped, true);
  }
  wait.resolve(false); await settle(); assert.equal(h.el('Dialog').getAttribute('aria-busy'), 'false'); assert.equal(h.el('Path').disabled, false);
});

test('ownership guard rejects a context that changes during a pending handoff, including change-and-return', async t => {
  const wait = deferred();
  const h = await fixture(t, { createDraft: async (_proposal, ports) => { await wait.promise; return ports.isCurrent() ? { applied: true } : false; } });
  h.open(); h.el('Apply').click(); assert.equal(h.calls[0].ports.isCurrent(), true);
  h.context.busy = true; h.controller.refresh(); h.context.busy = false; h.controller.refresh();
  assert.equal(h.calls[0].ports.isCurrent(), false); wait.resolve(); await settle();
  assert.equal(h.el('Dialog').open, true); assert.equal(h.el('Apply').disabled, true); assert.equal(h.focused.length, 0);
});

test('refusal and exceptions preserve the full local draft and allow retry', async t => {
  for (const throwing of [false, true]) {
    let count = 0;
    const h = await fixture(t, { createDraft: async () => { if (++count === 1) { if (throwing) throw new Error('host unavailable'); return false; } return { applied: true }; } });
    h.open(); h.set('Starter', 'godot-signal', 'change'); h.set('Path', 'documents/scripts/keep.txt');
    await h.click('Apply'); assert.equal(h.el('Dialog').open, true); assert.equal(h.el('Path').value, 'documents/scripts/keep.txt');
    assert.equal(h.el('Starter').value, 'godot-signal'); assert.equal(h.el('Apply').disabled, false); assert.match(h.el('Status').textContent, /已保留/);
    await h.click('Apply'); assert.equal(h.el('Dialog').open, false); assert.equal(h.calls.length, 2);
  }
});

test('dirty cancellation can be declined without losing fields, preview or language state', async t => {
  let allow = false; const h = await fixture(t, { confirm: () => allow }); h.open(); h.set('Path', 'documents/unfinished');
  h.language('ja'); await h.click('Cancel'); assert.equal(h.el('Dialog').open, true); assert.equal(h.el('Path').value, 'documents/unfinished');
  assert.equal(h.confirms[0], ja['丢弃本次脚本创建设置？编辑器内容不会改变。']);
  h.el('Dialog').dispatch('cancel', { isComposing: true }); assert.equal(h.confirms.length, 1);
  allow = true; await h.click('Close'); assert.equal(h.el('Dialog').open, false); assert.equal(h.el('Dialog').dataset.dirty, 'false'); assert.equal(h.calls.length, 0);
});

test('an externally closed old session cannot close or focus a newly opened panel', async t => {
  const wait = deferred(); let stolen = false;
  const h = await fixture(t, { createDraft: () => wait.promise }); h.open(); h.el('Apply').click(); h.el('Dialog').close(); await settle();
  assert.equal(h.calls[0].ports.isCurrent(), false); assert.equal(h.open(), true); h.set('Path', 'documents/scripts/new-session.txt');
  wait.resolve({ applied: true, focus: () => { stolen = true; } }); await settle();
  assert.equal(h.el('Dialog').open, true); assert.equal(h.el('Path').value, 'documents/scripts/new-session.txt'); assert.equal(stolen, false);
});

test('dispose invalidates pending handoff and removes the entry without a late focus', async t => {
  const wait = deferred(); const h = await fixture(t, { createDraft: () => wait.promise }); h.open(); h.el('Apply').click();
  h.controller.dispose(); assert.equal(h.calls[0].ports.isCurrent(), false); wait.resolve({ applied: true, focus: () => assert.fail('late focus') }); await settle();
  assert.equal(h.el('Dialog'), null); assert.equal(h.el('Btn'), null); assert.equal(h.unsubscribeCount(), 1);
  h.controller.dispose(); assert.equal(h.unsubscribeCount(), 1); assert.equal(h.open(), false);
});

test('language refresh keeps authored labels, invalid paths and source preview unchanged, using text-only labels', async t => {
  const h = await fixture(t); h.open(); h.set('Starter', 'godot-signal', 'change'); h.set('Path', 'documents/../未完成');
  const source = h.el('Source').textContent;
  for (const language of ['en', 'ja', 'zh']) {
    h.language(language); assert.equal(h.el('Path').value, 'documents/../未完成'); assert.equal(h.el('Starter').value, 'godot-signal');
    assert.equal(h.el('Type').value, 'script'); assert.equal(h.el('Type').children[0].textContent, 'Note <b>');
    assert.equal(h.el('Type').querySelector('b'), null); assert.equal(h.el('Source').textContent, source); assert.equal(h.calls.length, 0);
  }
});

test('all script dialog and starter messages have English and Japanese translations', async () => {
  const source = await fs.readFile(new URL('../../web/modules/app-script-create.js', import.meta.url), 'utf8');
  const keys = new Set([...source.matchAll(/data-i18n="([^"]+)"/g)].map(match => match[1]));
  for (const match of source.matchAll(/'([^'\n]*[\u3400-\u9fff][^'\n]*)'/g)) keys.add(match[1]);
  for (const starter of listScriptStarters()) { keys.add(starter.label); keys.add(starter.description); }
  for (const key of keys) { assert.ok(en[key], `English: ${key}`); assert.ok(ja[key], `Japanese: ${key}`); }
});


test('Bevy Rust drafts retain the selected backend, exact TXT contents and local review across language changes', async t => {
  for (const starterId of ['bevy-rust', 'bevy-rust-signal', 'bevy-rust-motion']) {
    const h = await fixture(t); h.open(); h.set('Starter', starterId, 'change'); h.set('Path', `documents/scripts/${starterId}.txt`);
    const before = h.el('Source').textContent;
    for (const locale of ['en', 'ja', 'zh']) {
      h.language(locale); assert.equal(h.el('Starter').value, starterId); assert.equal(h.el('Source').textContent, before);
      assert.equal(h.el('Apply').disabled, false); assert.equal(h.calls.length, 0);
    }
    await h.click('Apply'); assert.equal(h.calls.length, 1); const proposal = h.calls[0].proposal;
    assert.equal(proposal.backendId, 'org.viento.bevy-rust'); assert.equal(proposal.languageId, 'rust'); assert.equal(proposal.content, before);
    assert.equal(proposal.sourcePath, `documents/scripts/${starterId}.txt`); assert.equal(h.el('Dialog').open, false);
    assert.equal(proposal.content, listScriptStarters().find(item => item.id === starterId).content);
  }
});

for (const starterId of ['godot-project-animation', 'godot-project-animation-clip', 'godot-project-animation-event', 'godot-project-animation-completion', 'godot-character-intent']) test(`${starterId} keeps all reviewed bytes and choices across three languages before ordinary draft handoff`, async t => {
  const h = await fixture(t), starter = listScriptStarters().find(item => item.id === starterId);
  h.open(); h.set('Starter', starter.id, 'change'); h.set('Type', 'note', 'change'); h.set('Path', 'documents/scripts/动画 控制.txt');
  for (const locale of ['en', 'ja', 'zh']) {
    h.language(locale); const dictionary = { en, ja }[locale] || {};
    assert.equal(h.el('Starter').value, starter.id); assert.equal(h.el('Source').textContent, starter.content);
    assert.equal(h.el('Description').textContent, dictionary[starter.description] || starter.description);
    assert.equal(h.el('Starter').children.find(item => item.value === starterId).textContent, dictionary[starter.label] || starter.label);
    assert.equal(h.el('Type').value, 'note'); assert.equal(h.el('Path').value, 'documents/scripts/动画 控制.txt');
    assert.equal(h.calls.length, 0); assert.equal(h.el('Apply').disabled, false);
  }
  await h.click('Apply'); assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].proposal.content, starter.content); assert.equal(h.calls[0].proposal.starterId, starter.id);
  assert.equal(h.calls[0].proposal.documentType, 'note'); assert.equal(h.el('Dialog').open, false); assert.deepEqual(h.focused, [true]);
});

const stateStarter = 'godot-project-animation-state-table';
const stateElement = (h, suffix) => h.element('animationStateScript' + suffix);
const setState = (h, suffix, value, event = 'input') => { const element = stateElement(h, suffix); element.value = value; if (event) element.dispatch(event); };
const selectState = (h, suffix, key) => {
  const element = stateElement(h, suffix), option = element.children.find(item => item.dataset.stateKey === key);
  assert.ok(option, `state ${key} in ${suffix}`); element.value = option.value; element.dispatch('change');
};

test('state-table starter previews the exact generated custom source and hands it off as an ordinary branded TXT draft', async t => {
  const h = await fixture(t); h.open(); assert.equal(h.el('StateTable').hidden, true);
  h.set('Starter', stateStarter, 'change'); assert.equal(h.el('StateTable').hidden, false);
  setState(h, 'State2Key', 'attack'); stateElement(h, 'AddState').click(); setState(h, 'State3Key', 'walk');
  stateElement(h, 'AddTransition').click(); selectState(h, 'Transition3From', 'idle'); selectState(h, 'Transition3To', 'walk'); setState(h, 'Transition3Event', 'move');
  const table = { initialState: 'idle', states: [{ key: 'idle' }, { key: 'attack' }, { key: 'walk' }], transitions: [
    { from: 'idle', to: 'attack', trigger: { kind: 'event', name: 'action' } },
    { from: 'attack', to: 'idle', trigger: { kind: 'completed' } },
    { from: 'idle', to: 'walk', trigger: { kind: 'event', name: 'move' } },
  ] };
  h.set('Type', 'note', 'change'); h.set('Path', 'documents/scripts/state-table.txt');
  const expected = prepareAnimationStateScriptDraft({ sourceToken: 'source:1', documentRoot: 'documents', documentTypes: h.context.documentTypes },
    { starterId: stateStarter, documentType: 'note', sourcePath: 'documents/scripts/state-table.txt' }, table);
  assert.equal(h.el('Source').textContent, expected.content); assert.notEqual(expected.content, listScriptStarters().find(item => item.id === stateStarter).content);
  assert.equal(h.el('Apply').disabled, false); assert.equal(h.calls.length, 0);
  const input = stateElement(h, 'State2Key'); input.focus(); input.selectionStart = 1; input.selectionEnd = 4;
  for (const locale of ['en', 'ja', 'zh']) {
    h.language(locale); assert.equal(h.el('Source').textContent, expected.content); assert.equal(h.el('Apply').disabled, false);
    assert.equal(stateElement(h, 'State2Key'), input); assert.equal(h.document.activeElement, input); assert.equal(input.selectionStart, 1); assert.equal(input.selectionEnd, 4);
  }
  await h.click('Apply'); assert.equal(h.calls.length, 1); assert.equal(h.calls[0].proposal.content, expected.content);
  assert.equal(isScriptDraftProposal(h.calls[0].proposal), true); assert.equal(h.calls[0].proposal.documentType, 'note'); assert.equal(h.el('Dialog').open, false);
});

test('invalid state tables stay editable with no approved source, and missing references require explicit repair', async t => {
  const h = await fixture(t); h.open(); h.set('Starter', stateStarter, 'change');
  for (const invalid of ['idle', 'Attack', 'bad-key', '', 'a'.repeat(33)]) {
    setState(h, 'State2Key', invalid); assert.equal(h.el('Apply').disabled, true, invalid); assert.equal(h.el('Source').textContent, '');
    assert.match(h.el('Status').textContent, /状态标识/); await h.click('Apply'); assert.equal(h.calls.length, 0);
  }
  setState(h, 'State2Key', 'attack'); assert.equal(h.el('Apply').disabled, false);
  stateElement(h, 'State2Remove').click(); assert.equal(h.el('Apply').disabled, true);
  stateElement(h, 'AddState').click(); setState(h, 'State3Key', 'attack'); assert.equal(h.el('Apply').disabled, true);
  selectState(h, 'Transition1To', 'attack'); selectState(h, 'Transition2From', 'attack'); assert.equal(h.el('Apply').disabled, false);
  for (const name of ['constructor', 'prototype', '__proto__', 'bad name']) {
    setState(h, 'Transition1Event', name); assert.equal(h.el('Apply').disabled, true);
  }
  h.set('Starter', 'godot-node', 'change'); assert.equal(h.el('StateTable').hidden, true); assert.equal(h.el('Apply').disabled, false);
  h.set('Starter', stateStarter, 'change'); assert.equal(stateElement(h, 'Transition1Event').value, 'bad name'); assert.equal(h.el('Apply').disabled, true);
});

test('a silent table edit needs a new exact preview before handoff, including a hidden starter round trip', async t => {
  const h = await fixture(t); h.open(); h.set('Starter', stateStarter, 'change');
  const previous = h.el('Source').textContent; setState(h, 'State2Key', 'attack', null);
  await h.click('Apply'); assert.equal(h.calls.length, 0); assert.notEqual(h.el('Source').textContent, previous);
  const expected = h.el('Source').textContent; h.set('Starter', 'godot-node', 'change'); h.set('Starter', stateStarter, 'change');
  assert.equal(stateElement(h, 'State2Key').value, 'attack'); assert.equal(h.el('Source').textContent, expected);
  await h.click('Apply'); assert.equal(h.calls.length, 1); assert.equal(h.calls[0].proposal.content, expected);
});

test('state table settings participate in dirty cancellation even while another starter is selected', async t => {
  let allow = false; const h = await fixture(t, { confirm: () => allow }); h.open(); h.set('Starter', stateStarter, 'change');
  setState(h, 'State2Key', 'attack'); h.set('Starter', 'godot-node', 'change'); assert.equal(h.el('Dialog').dataset.dirty, 'true');
  await h.click('Cancel'); assert.equal(h.el('Dialog').open, true); assert.equal(h.confirms.length, 1);
  h.set('Starter', stateStarter, 'change'); assert.equal(stateElement(h, 'State2Key').value, 'attack');
  allow = true; await h.click('Cancel'); assert.equal(h.el('Dialog').open, false); assert.equal(h.calls.length, 0);
  h.open(); h.set('Starter', stateStarter, 'change'); assert.equal(stateElement(h, 'State2Key').value, 'action');
});

test('an unavailable state-table capability only disables this generator and revokes an in-flight handoff', async t => {
  let available = false;
  const h = await fixture(t, { supports: () => available }); h.open(); h.set('Starter', stateStarter, 'change');
  assert.equal(h.el('Apply').disabled, true); assert.equal(stateElement(h, 'State1Key').disabled, true); assert.equal(h.el('Source').textContent, '');
  assert.match(h.el('Status').textContent, /其他起始脚本/);
  for (const starter of listScriptStarters().filter(item => item.id !== stateStarter)) {
    h.set('Starter', starter.id, 'change'); assert.equal(h.el('Apply').disabled, false); assert.equal(h.el('Source').textContent, starter.content);
  }
  available = true;
  const wait = deferred(); const pending = await fixture(t, { supports: () => available, createDraft: async (_proposal, ports) => {
    await wait.promise; return ports.isCurrent() ? { applied: true } : false;
  } });
  pending.open(); pending.set('Starter', stateStarter, 'change'); pending.el('Apply').click(); assert.equal(pending.calls.length, 1);
  assert.equal(stateElement(pending, 'State1Key').disabled, true); assert.equal(pending.calls[0].ports.isCurrent(), true);
  available = false; pending.controller.refresh(); available = true; pending.controller.refresh();
  assert.equal(pending.calls[0].ports.isCurrent(), false); wait.resolve(); await settle();
  assert.equal(pending.el('Dialog').open, true); assert.equal(pending.el('Apply').disabled, true); assert.equal(stateElement(pending, 'State2Key').value, 'action');
});

test('state-table source changes and programmatic edits during handoff cannot apply a stale proposal', async t => {
  for (const mutate of [h => { h.context.sourceToken = 'new-owner'; h.controller.refresh(); }, h => setState(h, 'State2Key', 'late', null)]) {
    const wait = deferred(); const h = await fixture(t, { createDraft: async (_proposal, ports) => { await wait.promise; return ports.isCurrent() ? { applied: true } : false; } });
    h.open(); h.set('Starter', stateStarter, 'change'); h.el('Apply').click(); mutate(h);
    assert.equal(h.calls[0].ports.isCurrent(), false); wait.resolve(); await settle(); assert.equal(h.el('Dialog').open, true); assert.equal(h.focused.length, 0);
  }
});


test('state graph inspection and field location preserve the exact approved creation source',async t=>{
 const h=await fixture(t);h.open();h.set('Starter','godot-project-animation-state-table','change');const source=h.el('Source').textContent;
 const graph=suffix=>h.element('animationStateScriptGraph'+suffix);graph('Toggle').click();graph('Transition1Select').click();graph('State2Locate').click();
 for(const language of['en','ja','zh'])h.language(language);assert.equal(h.el('Source').textContent,source);assert.equal(h.el('Apply').disabled,false);
 graph('Toggle').click();assert.equal(h.el('Apply').disabled,false);assert.equal(h.calls.length,0);await h.click('Apply');assert.equal(h.calls[0].proposal.content,source);
});


test('conditional creation rejects incomplete numbers, preserves typed zero and keeps graph inspection outside source approval',async t=>{
 const h=await fixture(t);h.open();h.set('Starter','godot-project-animation-state-table','change');const set=(suffix,value,event='change')=>{const node=h.element('animationStateScriptTransition1Condition'+suffix);node.value=value;node.dispatch(event);};
 const old=h.el('Source').textContent;set('Mode','compare');set('Type','number');set('Number','1e-','input');assert.equal(h.el('Source').textContent,'');assert.equal(h.el('Apply').disabled,true);assert.match(h.el('Status').textContent,/载荷条件/);
 set('Number','0','input');const source=h.el('Source').textContent;assert.notEqual(source,old);assert.match(source,/godot-gdscript-v2/);assert.equal(h.el('Apply').disabled,false);
 h.element('animationStateScriptGraphToggle').click();assert.match(h.element('animationStateScriptGraphTransitions').textContent,/number.*==.*0/);for(const locale of['en','ja','zh'])h.language(locale);assert.equal(h.el('Source').textContent,source);assert.equal(h.el('Apply').disabled,false);
 await h.click('Apply');assert.equal(h.calls[0].proposal.content,source);
});

test('the optional condition marker withdraws conditional approvals and rejects an in-flight create after restoration',async t=>{
 const wait=deferred();let available=true;const h=await fixture(t,{conditionSupport:()=>available,createDraft:async(_p,ports)=>{await wait.promise;return ports.isCurrent()?{applied:true}:false;}});
 h.open();h.set('Starter','godot-project-animation-state-table','change');const mode=h.element('animationStateScriptTransition1ConditionMode');mode.value='compare';mode.dispatch('change');assert.equal(h.el('Apply').disabled,false);
 h.el('Apply').click();assert.equal(h.calls[0].ports.isCurrent(),true);available=false;h.controller.refresh();available=true;h.controller.refresh();assert.equal(h.calls[0].ports.isCurrent(),false);wait.resolve();await settle();assert.equal(h.el('Dialog').open,true);assert.equal(h.focused.length,0);
});

test('conditional script size errors preserve local inputs and explain the source budget',async t=>{
 const h=await fixture(t,{prepareState(){throw Object.assign(Error('budget'),{errorCode:'animation_state_script_source_limit'});}});h.open();h.set('Starter','godot-project-animation-state-table','change');assert.match(h.el('Status').textContent,/64 KiB/);assert.equal(h.el('Apply').disabled,true);assert.equal(h.element('animationStateScriptState2Key').value,'action');assert.equal(h.calls.length,0);
});

test('ordered branch creation previews v3, revises exact source after reordering and keeps graph navigation read-only', async t => {
  const h = await fixture(t); h.open(); h.set('Starter', stateStarter, 'change');
  setState(h, 'EventSelection', 'firstMatch', 'change'); setState(h, 'Transition1ConditionMode', 'compare', 'change');
  setState(h, 'Transition1ConditionType', 'number', 'change'); setState(h, 'Transition1ConditionNumber', '10'); setState(h, 'Transition1ConditionOperator', 'gte', 'change');
  stateElement(h, 'AddTransition').click(); selectState(h, 'Transition3From', 'idle'); selectState(h, 'Transition3To', 'idle'); setState(h, 'Transition3Event', 'action');
  const before = h.el('Source').textContent; assert.match(before, /godot-gdscript-v3/); assert.equal(h.el('Apply').disabled, false);
  stateElement(h, 'Transition3MoveUp').click(); const after = h.el('Source').textContent; assert.notEqual(after, before); assert.equal(h.el('Apply').disabled, false);
  h.element('animationStateScriptGraphToggle').click(); h.element('animationStateScriptGraphTransition2Locate').click(); assert.equal(h.document.activeElement, stateElement(h, 'Transition3From'));
  assert.equal(h.el('Source').textContent, after); assert.equal(h.el('Apply').disabled, false); await h.click('Apply'); assert.equal(h.calls[0].proposal.content, after);
});

test('switching an ordered table to unique preserves duplicate branches and prevents creation until repaired', async t => {
  const h = await fixture(t); h.open(); h.set('Starter', stateStarter, 'change'); setState(h, 'EventSelection', 'firstMatch', 'change'); setState(h, 'Transition1ConditionMode', 'compare', 'change');
  stateElement(h, 'AddTransition').click(); selectState(h, 'Transition3From', 'idle'); selectState(h, 'Transition3To', 'idle'); setState(h, 'Transition3Event', 'action');
  assert.equal(h.el('Apply').disabled, false); setState(h, 'EventSelection', 'unique', 'change'); assert.equal(h.el('Apply').disabled, true);
  assert.equal(stateElement(h, 'Transition3Event').value, 'action'); assert.equal(stateElement(h, 'Transition1ConditionMode').value, 'compare');
  setState(h, 'EventSelection', 'firstMatch', 'change'); assert.equal(h.el('Apply').disabled, false); await h.click('Cancel'); h.open(); h.set('Starter', stateStarter, 'change');
  assert.equal(stateElement(h, 'EventSelection').value, 'unique'); assert.equal(stateElement(h, 'Transitions').children.length, 2); assert.equal(h.calls.length, 0);
});

test('branch-only optional capability approves typed v3 without the older conditions marker', async t => {
  const h = await fixture(t, { conditionSupport: () => false, branchSupport: () => true }); h.open(); h.set('Starter', stateStarter, 'change');
  setState(h, 'EventSelection', 'firstMatch', 'change'); setState(h, 'Transition1ConditionMode', 'compare', 'change');
  assert.equal(h.el('Apply').disabled, false); assert.match(h.el('Source').textContent, /godot-gdscript-v3/);
  setState(h, 'EventSelection', 'unique', 'change'); assert.equal(h.el('Apply').disabled, true); assert.match(h.el('Status').textContent, /事件载荷条件/);
});

test('branch marker loss rejects an in-flight creation after restoration while old state tables remain available', async t => {
  let available = true; const wait = deferred();
  const h = await fixture(t, { branchSupport: () => available, createDraft: async (_proposal, ports) => { await wait.promise; return ports.isCurrent() ? { applied: true } : false; } });
  h.open(); h.set('Starter', stateStarter, 'change'); setState(h, 'EventSelection', 'firstMatch', 'change'); h.el('Apply').click(); assert.equal(h.calls[0].ports.isCurrent(), true);
  available = false; h.controller.refresh(); assert.match(h.el('Status').textContent, /有序事件分支/); available = true; h.controller.refresh(); assert.equal(h.calls[0].ports.isCurrent(), false);
  wait.resolve(); await settle(); assert.equal(h.el('Dialog').open, true); assert.equal(h.el('Apply').disabled, true);
  setState(h, 'EventSelection', 'unique', 'change'); assert.equal(h.el('Apply').disabled, false); available = false; h.controller.refresh(); assert.equal(h.el('Apply').disabled, false);
});

test('silent mode changes require a visible new script review, and invalid modes never hand off legacy source', async t => {
  const h = await fixture(t); h.open(); h.set('Starter', stateStarter, 'change'); setState(h, 'EventSelection', 'firstMatch', null); await h.click('Apply');
  assert.equal(h.calls.length, 0); assert.match(h.el('Source').textContent, /godot-gdscript-v3/); assert.equal(h.el('Apply').disabled, false);
  for (const invalid of ['', 'lastMatch']) { setState(h, 'EventSelection', invalid, null); await h.click('Apply'); assert.equal(h.calls.length, 0); assert.equal(h.el('Source').textContent, ''); assert.equal(h.el('Apply').disabled, true); }
  setState(h, 'EventSelection', 'unique', 'change'); assert.match(h.el('Source').textContent, /godot-gdscript-v1/); await h.click('Apply'); assert.equal(h.calls.length, 1);
});

test('a silent mode change during creation invalidates the handoff guard', async t => {
  const wait = deferred(), h = await fixture(t, { createDraft: async (_proposal, ports) => { await wait.promise; return ports.isCurrent() ? { applied: true } : false; } });
  h.open(); h.set('Starter', stateStarter, 'change'); h.el('Apply').click(); assert.equal(h.calls[0].ports.isCurrent(), true); setState(h, 'EventSelection', 'firstMatch', null); assert.equal(h.calls[0].ports.isCurrent(), false);
  wait.resolve(); await settle(); assert.equal(h.el('Dialog').open, true); assert.equal(h.focused.length, 0);
});

test('shared-state creation keeps literal keys, previews selector source and preserves exact source across graph and locale changes', async t => {
  const h = await fixture(t); h.open(); h.set('Starter', stateStarter, 'change');
  setState(h, 'Transition1ConditionMode', 'shared', 'change'); setState(h, 'Transition1ConditionKey', ' combat.enabled');
  assert.equal(h.el('Apply').disabled, true); assert.equal(h.el('Source').textContent, ''); assert.match(h.el('Status').textContent, /共享状态键/);
  setState(h, 'Transition1ConditionKey', 'combat.enabled'); setState(h, 'Transition1ConditionType', 'boolean', 'change'); setState(h, 'Transition1ConditionBoolean', 'true', 'change');
  const source = h.el('Source').textContent; assert.match(source, /godot-gdscript-v4/); assert.deepEqual(JSON.parse(source.split('\n')[1].slice('#@viento-animation-state-script '.length)).table.transitions[0].trigger.condition.selector, { kind: 'projectState', key: 'combat.enabled' }); assert.equal(h.el('Apply').disabled, false);
  h.element('animationStateScriptGraphToggle').click(); assert.match(h.element('animationStateScriptGraphTransitions').textContent, /combat.enabled.*boolean.*true/);
  const input = stateElement(h, 'Transition1ConditionKey'); input.focus(); input.selectionStart = 1; input.selectionEnd = 5;
  for (const locale of ['en', 'ja', 'zh']) { h.language(locale); assert.equal(h.el('Source').textContent, source); assert.equal(h.document.activeElement, input); assert.deepEqual([input.selectionStart, input.selectionEnd], [1, 5]); }
  await h.click('Apply'); assert.equal(h.calls.length, 1); assert.equal(h.calls[0].proposal.content, source);
});

test('selector-only capability approves shared unique and ordered tables without payload or branch markers', async t => {
  const h = await fixture(t, { conditionSupport: () => false, branchSupport: () => false, selectorSupport: () => true }); h.open(); h.set('Starter', stateStarter, 'change');
  setState(h, 'Transition1ConditionMode', 'shared', 'change'); setState(h, 'Transition1ConditionKey', 'combat.enabled'); assert.equal(h.el('Apply').disabled, false);
  setState(h, 'EventSelection', 'firstMatch', 'change'); assert.equal(h.el('Apply').disabled, false); assert.match(h.el('Source').textContent, /godot-gdscript-v4/);
  setState(h, 'Transition1ConditionMode', 'compare', 'change'); assert.equal(h.el('Apply').disabled, true); assert.match(h.el('Status').textContent, /有序事件分支/);
});

test('selector capability loss rejects pending creation even after restoration, while old payload creation remains usable', async t => {
  let available = true; const wait = deferred();
  const h = await fixture(t, { selectorSupport: () => available, createDraft: async (_proposal, ports) => { await wait.promise; return ports.isCurrent() ? { applied: true } : false; } });
  h.open(); h.set('Starter', stateStarter, 'change'); setState(h, 'Transition1ConditionMode', 'shared', 'change'); setState(h, 'Transition1ConditionKey', 'combat.enabled'); h.el('Apply').click(); assert.equal(h.calls[0].ports.isCurrent(), true);
  available = false; h.controller.refresh(); assert.match(h.el('Status').textContent, /项目共享状态条件/); available = true; h.controller.refresh(); assert.equal(h.calls[0].ports.isCurrent(), false);
  wait.resolve(); await settle(); assert.equal(h.el('Dialog').open, true); assert.equal(h.el('Apply').disabled, true); assert.equal(stateElement(h, 'Transition1ConditionKey').value, 'combat.enabled');
  setState(h, 'Transition1ConditionMode', 'compare', 'change'); available = false; h.controller.refresh(); assert.equal(h.el('Apply').disabled, false); assert.match(h.el('Source').textContent, /godot-gdscript-v2/);
});

test('a silently changed shared-state key must receive a new visible creation preview', async t => {
  const h = await fixture(t); h.open(); h.set('Starter', stateStarter, 'change'); setState(h, 'Transition1ConditionMode', 'shared', 'change'); setState(h, 'Transition1ConditionKey', 'combat.enabled');
  const before = h.el('Source').textContent; setState(h, 'Transition1ConditionKey', 'combat.ready', null); await h.click('Apply'); assert.equal(h.calls.length, 0); assert.notEqual(h.el('Source').textContent, before);
  assert.match(h.el('Source').textContent, /combat.ready/); await h.click('Apply'); assert.equal(h.calls.length, 1);
});


test('silent unknown condition sources fail closed instead of downgrading a shared condition to payload', async t => {
  const h = await fixture(t); h.open(); h.set('Starter', stateStarter, 'change'); setState(h, 'Transition1ConditionMode', 'shared', 'change'); setState(h, 'Transition1ConditionKey', 'combat.enabled');
  for (const invalid of ['', 'unknown']) { setState(h, 'Transition1ConditionMode', invalid, null); await h.click('Apply'); assert.equal(h.calls.length, 0); assert.equal(h.el('Apply').disabled, true); assert.equal(h.el('Source').textContent, ''); }
  setState(h, 'Transition1ConditionMode', 'shared', 'change'); assert.equal(h.calls.length, 0); assert.match(h.el('Source').textContent, /godot-gdscript-v4/); assert.equal(h.el('Apply').disabled, false); assert.equal(stateElement(h, 'Transition1ConditionKey').value, 'combat.enabled');
});

test('combined creation previews mixed ordered leaves, keeps graph inspection readonly and hands off the exact reviewed v5', async t => {
  const h = await fixture(t); h.open(); h.set('Starter', stateStarter, 'change');
  setState(h, 'Transition1ConditionMode', 'compare', 'change'); setState(h, 'Transition1ConditionType', 'number', 'change'); setState(h, 'Transition1ConditionNumber', '0');
  setState(h, 'Transition1ConditionCombination', 'all', 'change'); stateElement(h, 'Transition1ConditionAddItem').click();
  setState(h, 'Transition1ConditionItem2Mode', 'shared', 'change'); setState(h, 'Transition1ConditionItem2Key', 'combat.enabled'); setState(h, 'Transition1ConditionItem2Type', 'boolean', 'change');
  const source = h.el('Source').textContent; assert.match(source, /godot-gdscript-v5/); const declaration = JSON.parse(source.split('\n')[1].slice('#@viento-animation-state-script '.length));
  assert.deepEqual(declaration.table.transitions[0].trigger.condition, { combine: 'all', conditions: [{ type: 'number', operator: 'eq', value: 0 }, { type: 'boolean', operator: 'eq', value: false, selector: { kind: 'projectState', key: 'combat.enabled' } }] });
  h.element('animationStateScriptGraphToggle').click(); assert.match(h.element('animationStateScriptGraphTransitions').textContent, /全部满足.*事件载荷.*combat.enabled/);
  const key = stateElement(h, 'Transition1ConditionItem2Key'); key.focus(); key.selectionStart = 1; key.selectionEnd = 7;
  for (const locale of ['en', 'ja', 'zh']) { h.language(locale); assert.equal(h.document.activeElement, key); assert.deepEqual([key.selectionStart, key.selectionEnd], [1, 7]); assert.equal(h.el('Source').textContent, source); }
  setState(h, 'Transition1ConditionCombination', 'any', 'change'); assert.match(h.element('animationStateScriptGraphTransitions').textContent, /任一满足/); stateElement(h, 'Transition1ConditionItem2MoveUp').click(); const final = h.el('Source').textContent;
  assert.notEqual(final, source); assert.equal(h.el('Apply').disabled, false); await h.click('Apply'); assert.equal(h.calls.length, 1); assert.equal(h.calls[0].proposal.content, final);
});

test('empty groups and copied unfinished scalar input cannot generate, while one-item groups stay explicit', async t => {
  const h = await fixture(t); h.open(); h.set('Starter', stateStarter, 'change'); const legacy = h.el('Source').textContent;
  setState(h, 'Transition1ConditionCombination', 'all', 'change'); assert.equal(h.el('Source').textContent, ''); assert.equal(h.el('Apply').disabled, true); assert.match(h.el('Status').textContent, /1–8/);
  stateElement(h, 'Transition1ConditionAddItem').click(); assert.match(h.el('Source').textContent, /godot-gdscript-v5/); stateElement(h, 'Transition1ConditionItem1Remove').click(); assert.equal(h.el('Source').textContent, '');
  setState(h, 'Transition1ConditionCombination', 'single', 'change'); assert.equal(h.el('Source').textContent, legacy);
  const fresh = await fixture(t); fresh.open(); fresh.set('Starter', stateStarter, 'change'); setState(fresh, 'Transition1ConditionMode', 'compare', 'change'); setState(fresh, 'Transition1ConditionType', 'number', 'change'); setState(fresh, 'Transition1ConditionNumber', '1e-');
  setState(fresh, 'Transition1ConditionCombination', 'any', 'change'); assert.equal(stateElement(fresh, 'Transition1ConditionItem1Number').value, '1e-'); assert.equal(fresh.el('Source').textContent, ''); assert.equal(fresh.el('Apply').disabled, true);
});

test('combination-only capability approves mixed all/any with ordered events independently of all legacy markers', async t => {
  const h = await fixture(t, { conditionSupport: () => false, branchSupport: () => false, selectorSupport: () => false, combinationSupport: () => true }); h.open(); h.set('Starter', stateStarter, 'change');
  setState(h, 'Transition1ConditionCombination', 'all', 'change'); stateElement(h, 'Transition1ConditionAddItem').click(); setState(h, 'Transition1ConditionItem1Mode', 'shared', 'change'); setState(h, 'Transition1ConditionItem1Key', 'combat.enabled');
  setState(h, 'EventSelection', 'firstMatch', 'change'); assert.equal(h.el('Apply').disabled, false); assert.match(h.el('Source').textContent, /godot-gdscript-v5/);
  setState(h, 'Transition1ConditionCombination', 'single', 'change'); assert.equal(h.el('Apply').disabled, true); assert.match(h.el('Status').textContent, /有序事件分支/);
  setState(h, 'Transition1ConditionCombination', 'any', 'change'); assert.equal(h.el('Apply').disabled, false); assert.equal(stateElement(h, 'Transition1ConditionItem1Key').value, 'combat.enabled');
});

test('losing and restoring combination support revokes pending creation while single-source input remains available', async t => {
  let available = true; const wait = deferred(); const h = await fixture(t, { combinationSupport: () => available, createDraft: async (_proposal, ports) => { await wait.promise; return ports.isCurrent() ? { applied: true } : false; } });
  h.open(); h.set('Starter', stateStarter, 'change'); setState(h, 'Transition1ConditionMode', 'compare', 'change'); setState(h, 'Transition1ConditionCombination', 'all', 'change'); h.el('Apply').click(); assert.equal(h.calls[0].ports.isCurrent(), true);
  available = false; h.controller.refresh(); assert.match(h.el('Status').textContent, /不支持组合条件/); available = true; h.controller.refresh(); assert.equal(h.calls[0].ports.isCurrent(), false); wait.resolve(); await settle();
  assert.equal(h.el('Dialog').open, true); assert.equal(h.el('Apply').disabled, true); setState(h, 'Transition1ConditionCombination', 'single', 'change'); available = false; h.controller.refresh(); assert.equal(h.el('Apply').disabled, false); assert.match(h.el('Source').textContent, /godot-gdscript-v2/);
});

test('unknown group choices clear creation previews and a deliberate valid choice immediately rechecks retained items', async t => {
  const h = await fixture(t); h.open(); h.set('Starter', stateStarter, 'change'); setState(h, 'Transition1ConditionMode', 'compare', 'change'); setState(h, 'Transition1ConditionCombination', 'all', 'change');
  for (const event of ['change', null]) {
    setState(h, 'Transition1ConditionCombination', '', event); if (!event) await h.click('Apply');
    assert.equal(h.el('Source').textContent, ''); assert.equal(h.el('Apply').disabled, true); assert.equal(h.calls.length, 0);
    setState(h, 'Transition1ConditionCombination', 'all', 'change'); assert.match(h.el('Source').textContent, /godot-gdscript-v5/); assert.equal(h.el('Apply').disabled, false);
  }
});
