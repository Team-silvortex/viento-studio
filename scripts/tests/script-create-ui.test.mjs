import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { dialogHarness, flushDialogs } from './dialog-harness.mjs';
import { deferred } from './editor-harness.mjs';
import { listScriptStarters, prepareScriptDraft, isScriptDraftProposal, prepareScriptDraftApply } from '../../engine/script-authoring.mjs';
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
    listScriptStarters,
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

for (const starterId of ['godot-project-animation', 'godot-project-animation-clip', 'godot-project-animation-event']) test(`${starterId} keeps all reviewed bytes and choices across three languages before ordinary draft handoff`, async t => {
  const h = await fixture(t), starter = listScriptStarters().find(item => item.id === starterId);
  h.open(); h.set('Starter', starter.id, 'change'); h.set('Type', 'note', 'change'); h.set('Path', 'documents/scripts/动画 控制.txt');
  for (const locale of ['en', 'ja', 'zh']) {
    h.language(locale); const dictionary = { en, ja }[locale] || {};
    assert.equal(h.el('Starter').value, starter.id); assert.equal(h.el('Source').textContent, starter.content);
    assert.equal(h.el('Description').textContent, dictionary[starter.description] || starter.description);
    assert.equal(h.el('Type').value, 'note'); assert.equal(h.el('Path').value, 'documents/scripts/动画 控制.txt');
    assert.equal(h.calls.length, 0); assert.equal(h.el('Apply').disabled, false);
  }
  await h.click('Apply'); assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].proposal.content, starter.content); assert.equal(h.calls[0].proposal.starterId, starter.id);
  assert.equal(h.calls[0].proposal.documentType, 'note'); assert.equal(h.el('Dialog').open, false); assert.deepEqual(h.focused, [true]);
});
