import test from 'node:test';
import assert from 'node:assert/strict';
import { dialogHarness } from './dialog-harness.mjs';
import { findSourceMatches, planSourceReplacement } from '../../engine/source-search.mjs';
import en from '../../web/i18n/en.js';
import ja from '../../web/i18n/ja.js';

async function fixture(t, settings = {}) {
  let language = 'zh', translate = () => {}, subscriptions = 0, scans = 0;
  const context = { editable: true, sourceToken: 'source:1', ...settings.context };
  const commands = [], inputs = [], selections = [], reveals = [], captures = new Map();
  const h = await dialogHarness('app-source-search', {
    findSourceMatches: value => { scans++; return findSourceMatches(structuredClone(value)); },
    planSourceReplacement: value => planSourceReplacement(structuredClone(value)),
    revealSourceOffset: (...args) => { reveals.push(args.slice(1)); return true; },
    t: (key, ...values) => String(({ en, ja }[language]?.[key] || key)).replace(/\{(\d+)\}/g, (_, i) => values[i]),
    Event: class { constructor(type, options) { this.type = type; Object.assign(this, options); } },
    onLanguageChange(fn) { translate = fn; subscriptions++; return () => { translate = () => {}; subscriptions--; }; },
  });
  const document = h.runtime.document, textarea = h.element('docSourceEditor'), container = h.element('docEditorWrap');
  container.prepend = node => { node.parentElement = container; container.children.unshift(node); };
  document.addEventListener = (type, fn, capture) => { assert.equal(capture, true); captures.set(type, fn); };
  document.removeEventListener = (type, fn, capture) => { assert.equal(capture, true); if (captures.get(type) === fn) captures.delete(type); };
  document.capture = type => captures.get(type)?.();
  textarea.isConnected = container.isConnected = true; textarea.readOnly = textarea.disabled = false;
  textarea.value = settings.text ?? '\ufeffcat DOG cat\nCat\ncat';
  textarea.selectionStart = settings.start ?? 0; textarea.selectionEnd = settings.end ?? 0;
  textarea.selectionDirection = settings.direction ?? 'forward'; textarea.scrollTop = 73; textarea.scrollLeft = 15;
  textarea.setSelectionRange = (start, end, direction = 'none') => {
    selections.push([start, end, direction]); textarea.selectionStart = start; textarea.selectionEnd = end;
    textarea.selectionDirection = direction; textarea.scrollTop = textarea.scrollLeft = 999;
  };
  textarea.setRangeText = () => assert.fail('replacement must use native undo');
  textarea.dispatchEvent = event => textarea.dispatch(event.type, { bubbles: event.bubbles });
  textarea.addEventListener('input', event => { inputs.push(event); settings.onInput?.({ textarea, context }); });
  document.execCommand = (command, ui, replacement) => {
    commands.push({ command, ui, replacement, start: textarea.selectionStart, end: textarea.selectionEnd });
    if (settings.exec) return settings.exec({ textarea, context, command, replacement });
    textarea.value = textarea.value.slice(0, textarea.selectionStart) + replacement + textarea.value.slice(textarea.selectionEnd);
    if (settings.nativeInput !== false) textarea.dispatch('input', { bubbles: true, inputType: 'insertText' });
    return true;
  };
  const controller = h.runtime.setupSourceSearch({ textarea, container, getContext: settings.getContext || (() => context) });
  t.after(() => controller.dispose());
  const el = suffix => h.element('sourceSearch' + suffix);
  return { ...h, controller, context, textarea, container, document, commands, inputs, selections, reveals, el,
    open() { el('Open').click(); }, fill(suffix, value) { el(suffix).value = value; el(suffix).dispatch('input'); },
    search(value = 'cat') { el('Open').click(); el('Query').value = value; el('Query').dispatch('input'); },
    key(properties) { return textarea.dispatch('keydown', properties); },
    language(value) { language = value; translate(); }, subscriptions: () => subscriptions, scans: () => scans,
    captures: () => captures.size };
}
const sourceState = h => [h.textarea.value, h.textarea.selectionStart, h.textarea.selectionEnd,
  h.textarea.selectionDirection, h.textarea.scrollTop, h.textarea.scrollLeft];

test('source-local controls open with literal case-sensitive counts without editing or selecting source', async t => {
  const h = await fixture(t), before = sourceState(h);
  assert.equal(Object.isFrozen(h.controller), true); assert.deepEqual(Object.keys(h.controller).sort(), ['dispose', 'refresh']);
  assert.equal(h.el('Tools').parentElement, h.container); assert.equal(h.el('Panel').hidden, true);
  h.search(); assert.equal(h.el('Panel').hidden, false); assert.equal(h.el('MatchCase').checked, true);
  assert.equal(h.el('Status').dataset.count, '3'); assert.equal(h.el('Status').dataset.current, '0');
  assert.equal(h.el('Status').textContent, '找到 3 处匹配。');
  assert.deepEqual(sourceState(h), before); assert.equal(h.selections.length, 0); assert.equal(h.commands.length, 0); assert.equal(h.inputs.length, 0);
});

test('navigation selects exact occurrences and wraps both directions without input or source writes', async t => {
  const h = await fixture(t); h.search(); const text = h.textarea.value;
  for (const expected of [1, 9, 17, 1]) { h.el('Next').click(); assert.equal(h.textarea.selectionStart, expected); assert.equal(h.textarea.selectionEnd, expected + 3); }
  h.el('Previous').click(); assert.equal(h.textarea.selectionStart, 17); assert.equal(h.el('Status').dataset.current, '3');
  assert.equal(h.reveals.length, 5); assert.equal(h.inputs.length, 0); assert.equal(h.commands.length, 0); assert.equal(h.textarea.value, text);
});

test('case option and literal metacharacters use core matches, not regular expression syntax', async t => {
  const h = await fixture(t, { text: 'CAT cat Cat .* $& $1 .*' }); h.search('cat');
  assert.equal(h.el('Status').dataset.count, '1'); h.el('MatchCase').checked = false; h.el('MatchCase').dispatch('change');
  assert.equal(h.el('Status').dataset.count, '3'); h.fill('Query', '.*'); assert.equal(h.el('Status').dataset.count, '2');
  h.fill('Query', '$&'); assert.equal(h.el('Status').dataset.count, '1'); assert.equal(h.commands.length, 0);
});

test('query and replacement support literal newlines while ordinary query Enter navigates', async t => {
  const h = await fixture(t, { text: '\ufeffa\nb\na\nb\n' }); h.search('a\nb'); h.fill('Replacement', 'x\ny');
  assert.equal(h.el('Query').tagName, 'TEXTAREA'); assert.equal(h.el('Status').dataset.count, '2');
  const event = h.el('Query').dispatch('keydown', { key: 'Enter', bubbles: true }); assert.equal(event.defaultPrevented, true);
  assert.equal(h.textarea.selectionStart, 1); h.el('Replace').click();
  assert.equal(h.textarea.value, '\ufeffx\ny\na\nb\n'); assert.equal(h.inputs.length, 1); assert.equal(h.commands.length, 1);
});

test('only an exact selected occurrence can be replaced; single replacement is one native edit with a core-planned caret', async t => {
  const h = await fixture(t); h.search(); h.fill('Replacement', '$&/$1'); h.el('Replace').dispatch('click');
  assert.equal(h.commands.length, 0); h.el('Next').click(); h.el('Replace').click();
  assert.equal(h.commands.length, 1); assert.deepEqual(h.commands[0], { command: 'insertText', ui: false, replacement: '$&/$1', start: 1, end: 4 });
  assert.equal(h.textarea.value, '\ufeff$&/$1 DOG cat\nCat\ncat'); assert.equal(h.textarea.selectionStart, 6); assert.equal(h.textarea.selectionEnd, 6);
  assert.equal(h.inputs.length, 1); assert.equal(h.el('Status').dataset.count, '2');
});

test('replace all keeps untouched surrounding source and uses exactly one minimal-span native command', async t => {
  const h = await fixture(t); h.search(); h.fill('Replacement', 'fox'); h.el('ReplaceAll').click();
  assert.equal(h.commands.length, 1); assert.equal(h.commands[0].start, 1); assert.equal(h.commands[0].end, 20);
  assert.equal(h.commands[0].replacement, 'fox DOG fox\nCat\nfox'); assert.equal(h.textarea.value, '\ufefffox DOG fox\nCat\nfox');
  assert.equal(h.textarea.selectionStart, 20); assert.equal(h.inputs.length, 1); assert.equal(h.el('Status').dataset.count, '0');
});

test('successful native commands lacking input notify the ordinary editor once; native input is never duplicated', async t => {
  for (const nativeInput of [true, false]) {
    const h = await fixture(t, { nativeInput }); h.search(); h.fill('Replacement', 'x'); h.el('ReplaceAll').click();
    assert.equal(h.inputs.length, 1); assert.equal(h.inputs[0].bubbles, true); assert.equal(h.commands.length, 1);
  }
});

test('unsupported and throwing native replacements preserve source, selection, scroll and undo without fallback', async t => {
  for (const exec of [() => false, () => { throw new Error('unsupported'); }]) {
    const h = await fixture(t, { exec }); h.search(); h.fill('Replacement', 'fox'); h.el('Next').click();
    h.textarea.selectionDirection = 'backward'; h.textarea.scrollTop = 91; h.textarea.scrollLeft = 27; const before = sourceState(h);
    h.el('Replace').click(); assert.deepEqual(sourceState(h), before); assert.equal(h.inputs.length, 0); assert.equal(h.commands.length, 1);
    assert.match(h.el('Status').textContent, /未执行替换/);
  }
});

test('partial native results are reported and notified once without a retry or source overwrite', async t => {
  const h = await fixture(t, { exec: ({ textarea }) => { textarea.value = 'partial'; return false; } });
  h.search(); h.fill('Replacement', 'fox'); h.el('ReplaceAll').click();
  assert.equal(h.textarea.value, 'partial'); assert.equal(h.commands.length, 1); assert.equal(h.inputs.length, 1);
  assert.match(h.el('Status').textContent, /未能完整应用/);
});

test('identical replacement and no matches perform no native operation and preserve source', async t => {
  const h = await fixture(t); h.search(); h.fill('Replacement', 'cat'); const before = sourceState(h); h.el('ReplaceAll').click();
  assert.equal(h.commands.length, 0); assert.deepEqual(sourceState(h), before); assert.match(h.el('Status').textContent, /相同/);
  h.fill('Query', 'missing'); h.el('ReplaceAll').dispatch('click'); assert.equal(h.commands.length, 0); assert.equal(h.inputs.length, 0);
});

test('search caches scans across selection and language updates but refreshes live after source input', async t => {
  const h = await fixture(t); h.search(); const scanned = h.scans(); h.el('Next').click(); h.language('ja');
  h.controller.refresh(); h.textarea.dispatch('select'); assert.equal(h.scans(), scanned);
  h.textarea.value += ' cat'; h.textarea.dispatch('input'); assert.equal(h.el('Status').dataset.count, '4'); assert.equal(h.scans(), scanned + 1);
});

test('language refresh localizes post-replacement counts without changing fields, selection or command history', async t => {
  const h = await fixture(t); h.search(); h.fill('Replacement', 'fox'); h.el('ReplaceAll').click(); const before = sourceState(h);
  for (const language of ['en', 'ja', 'zh']) {
    h.language(language); const key = '已替换 {0} 处；请按普通流程保存。';
    assert.equal(h.el('Status').textContent, ({ en, ja }[language]?.[key] || key).replace('{0}', '3'));
    assert.equal(h.el('Query').value, 'cat'); assert.equal(h.el('Replacement').value, 'fox'); assert.deepEqual(sourceState(h), before);
  }
  assert.equal(h.commands.length, 1); assert.equal(h.inputs.length, 1);
});

test('search shortcuts are source-local and preserve Tab, browser alternatives, repeats and already-handled events', async t => {
  const h = await fixture(t);
  for (const properties of [{ key: 'Tab' }, { key: 'f', ctrlKey: true, shiftKey: true }, { key: 'f', ctrlKey: true, altKey: true },
    { key: 'f', metaKey: true, repeat: true }, { key: 'f', ctrlKey: true, defaultPrevented: true }, { key: 'f' }]) {
    const event = h.key(properties); assert.notEqual(event.stopped, true); assert.equal(h.el('Panel').hidden, true);
  }
  for (const modifier of ['ctrlKey', 'metaKey']) {
    const event = h.key({ key: 'f', [modifier]: true }); assert.equal(event.defaultPrevented, true); assert.equal(h.el('Panel').hidden, false);
    h.fill('Query', 'cat'); h.key({ key: 'F3' }); assert.equal(h.textarea.selectionStart, modifier === 'ctrlKey' ? 1 : 9);
    h.el('Query').focus(); const escape = h.el('Query').dispatch('keydown', { key: 'Escape', bubbles: true });
    assert.equal(escape.defaultPrevented, true); assert.equal(h.el('Panel').hidden, true); assert.equal(h.document.activeElement, h.textarea);
  }
  h.open(); h.key({ key: 'F3', shiftKey: true }); assert.equal(h.textarea.selectionStart, 1);
});

test('active query and replacement IME fields remain enabled while every navigation and replace action is blocked', async t => {
  for (const suffix of ['Query', 'Replacement']) {
    const h = await fixture(t); h.search(); h.fill('Replacement', 'fox'); h.el('Next').click();
    const field = h.el(suffix); field.focus(); field.dispatch('compositionstart');
    assert.equal(field.disabled, false); assert.equal(h.document.activeElement, field);
    assert.equal(h.el('Next').disabled, true); assert.equal(h.el('ReplaceAll').disabled, true);
    h.el('ReplaceAll').dispatch('click'); h.key({ key: 'F3' }); field.dispatch('keydown', { key: 'Enter', bubbles: true });
    assert.equal(h.commands.length, 0); field.dispatch('compositionend'); assert.equal(h.el('ReplaceAll').disabled, false);
    for (const props of [{ isComposing: true }, { keyCode: 229 }]) h.el('ReplaceAll').dispatch('click', props);
    assert.equal(h.commands.length, 0); h.el('ReplaceAll').click(); assert.equal(h.commands.length, 1);
  }
});

test('source composition also blocks actions, and a new source clears a stranded composition session', async t => {
  const h = await fixture(t); h.search(); h.textarea.dispatch('compositionstart'); h.el('Next').dispatch('click');
  assert.equal(h.selections.length, 0); h.context.sourceToken = 'source:2'; h.controller.refresh();
  assert.equal(h.el('Panel').hidden, true); assert.equal(h.el('Query').value, ''); assert.equal(h.el('Open').disabled, false);
  h.open(); h.fill('Query', 'cat'); h.el('Next').click(); assert.equal(h.textarea.selectionStart, 1);
});

test('busy, readonly, disabled, disconnected and modal editor contexts cannot mutate or navigate', async t => {
  for (const mutate of [h => h.context.editable = false, h => h.textarea.readOnly = true, h => h.textarea.disabled = true,
    h => h.textarea.isConnected = false, h => h.container.isConnected = false, h => h.context.sourceToken = '',
    h => { const dialog = h.document.createElement('dialog'); h.document.body.append(dialog); dialog.showModal(); }]) {
    const h = await fixture(t); h.search(); h.fill('Replacement', 'fox'); const before = sourceState(h); mutate(h);
    h.el('ReplaceAll').dispatch('click'); h.el('Next').dispatch('click'); h.controller.refresh();
    assert.equal(h.commands.length, 0); assert.deepEqual(sourceState(h), before); assert.equal(h.el('ReplaceAll').disabled, true);
  }
});

test('same-session busy and modal pauses retain query and resume; token replacement clears every search field', async t => {
  const h = await fixture(t); h.search(); h.fill('Replacement', 'fox'); h.context.editable = false; h.controller.refresh();
  assert.equal(h.el('Tools').hidden, true); h.context.editable = true; h.controller.refresh(); assert.equal(h.el('Panel').hidden, false);
  const dialog = h.document.createElement('dialog'); h.document.body.append(dialog); dialog.showModal(); h.language('ja');
  assert.equal(h.el('Next').disabled, true); dialog.close(); h.document.capture('close'); assert.equal(h.el('Next').disabled, false);
  h.context.sourceToken = 'other'; h.controller.refresh(); assert.equal(h.el('Panel').hidden, true);
  assert.equal(h.el('Query').value, ''); assert.equal(h.el('Replacement').value, ''); assert.equal(h.el('MatchCase').checked, true);
});

test('focus changes to source, options, query or another focused input abort before the native command', async t => {
  for (const mutate of [h => h.context.sourceToken = 'other', h => h.textarea.value = 'other', h => h.el('Query').value = 'dog',
    h => h.el('Replacement').value = 'other', h => h.el('MatchCase').checked = false, h => h.el('Query').focus()]) {
    const h = await fixture(t); h.search(); h.fill('Replacement', 'fox'); const focus = h.textarea.focus.bind(h.textarea);
    h.textarea.focus = () => { focus(); mutate(h); }; h.el('ReplaceAll').click();
    assert.equal(h.commands.length, 0); assert.equal(h.inputs.length, 0);
  }
});

test('selection event reentrancy cannot mutate stale query options or redirect replacement to another field', async t => {
  for (const mutate of [h => h.el('Query').value = 'dog', h => h.el('MatchCase').checked = false, h => h.el('Query').focus(),
    h => { h.context.sourceToken = 'other'; h.textarea.value = 'new document'; }]) {
    const h = await fixture(t); h.search(); h.fill('Replacement', 'fox'); const select = h.textarea.setSelectionRange;
    h.textarea.setSelectionRange = (...args) => { select(...args); mutate(h); }; h.el('ReplaceAll').click();
    assert.equal(h.commands.length, 0); assert.equal(h.inputs.length, 0);
  }
});

test('native input and focus listeners cannot recursively start a second replacement', async t => {
  let h; h = await fixture(t, { onInput: () => h.el('ReplaceAll').dispatch('click') }); h.search(); h.fill('Replacement', 'fox');
  const focus = h.textarea.focus.bind(h.textarea);
  h.textarea.focus = () => { focus(); h.el('ReplaceAll').dispatch('click'); };
  h.el('ReplaceAll').click(); assert.equal(h.commands.length, 1); assert.equal(h.inputs.length, 1);
});

test('native input switching the document receives no stale selection, fallback input or follow-up command', async t => {
  const h = await fixture(t, { onInput: ({ textarea, context }) => {
    context.sourceToken = 'other'; textarea.value = 'new document'; textarea.selectionStart = textarea.selectionEnd = 2;
  } }); h.search(); h.fill('Replacement', 'fox'); h.el('ReplaceAll').click();
  assert.equal(h.textarea.value, 'new document'); assert.equal(h.textarea.selectionStart, 2); assert.equal(h.textarea.selectionEnd, 2);
  assert.equal(h.inputs.length, 1); assert.equal(h.commands.length, 1); assert.equal(h.selections.length, 1);
  assert.equal(h.el('Panel').hidden, true);
});

test('native command switching ownership without input never synthesizes input into the new document, including throw paths', async t => {
  for (const throws of [false, true]) {
    const h = await fixture(t, { exec: ({ textarea, context }) => {
      context.sourceToken = 'other'; textarea.value = 'new document'; textarea.selectionStart = textarea.selectionEnd = 2;
      if (throws) throw Error('after switch'); return false;
    } }); h.search(); h.fill('Replacement', 'fox'); h.el('ReplaceAll').click();
    assert.equal(h.inputs.length, 0); assert.equal(h.textarea.value, 'new document'); assert.equal(h.textarea.selectionStart, 2);
    assert.equal(h.selections.length, 1); assert.equal(h.el('Panel').hidden, true);
  }
});

test('fallback input switching ownership is emitted once and prevents stale post-edit selection', async t => {
  const h = await fixture(t, { nativeInput: false, onInput: ({ textarea, context }) => {
    context.sourceToken = 'other'; textarea.value = 'new document'; textarea.selectionStart = textarea.selectionEnd = 2;
  } }); h.search(); h.fill('Replacement', 'fox'); h.el('ReplaceAll').click();
  assert.equal(h.inputs.length, 1); assert.equal(h.selections.length, 1); assert.equal(h.textarea.selectionStart, 2);
});

test('closing search restores selection and scroll, but cannot close a newly opened source session during focus', async t => {
  const h = await fixture(t); h.search(); const before = sourceState(h); h.el('Close').click();
  assert.deepEqual(sourceState(h), before); assert.equal(h.el('Panel').hidden, true); assert.equal(h.inputs.length, 0);
  h.open(); const focus = h.textarea.focus.bind(h.textarea); h.textarea.focus = () => {
    focus(); h.context.sourceToken = 'other'; h.controller.refresh(); h.open(); h.fill('Query', 'other');
  };
  h.el('Close').click(); assert.equal(h.el('Panel').hidden, false); assert.equal(h.el('Query').value, 'other');
});

test('search and replacement budgets reject expensive results before any native edit and allow recovery', async t => {
  const h = await fixture(t, { text: 'a'.repeat(10001) }); h.search('a');
  assert.equal(h.el('Next').disabled, true); assert.equal(h.el('ReplaceAll').disabled, true); assert.match(h.el('Status').textContent, /超出限制/);
  h.fill('Query', 'a'.repeat(4097)); assert.match(h.el('Status').textContent, /支持范围/);
  h.fill('Query', 'aaa'); h.fill('Replacement', 'z'.repeat(65537)); h.el('ReplaceAll').click(); assert.equal(h.commands.length, 0);
  h.fill('Replacement', 'z'); h.el('ReplaceAll').click(); assert.equal(h.commands.length, 1);
});

test('disposal removes all observers and controls without late edits or source mutation', async t => {
  const h = await fixture(t); h.search(); const button = h.el('ReplaceAll'), before = sourceState(h);
  h.controller.dispose(); h.controller.dispose(); button.dispatch('click'); h.key({ key: 'f', ctrlKey: true }); h.language('ja'); h.controller.refresh();
  assert.equal(h.subscriptions(), 0); assert.equal(h.captures(), 0); assert.equal(h.el('Tools'), null);
  assert.equal(h.container.classList.contains('source-search-container'), false); assert.deepEqual(sourceState(h), before); assert.equal(h.commands.length, 0);
  const noop = h.runtime.setupSourceSearch(); noop.refresh(); noop.dispose();
});
