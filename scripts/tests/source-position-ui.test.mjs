import { revealSourceOffset } from '../../web/modules/app-source-reveal.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { dialogHarness, flushDialogs } from './dialog-harness.mjs';
import { createSourceLineIndex } from '../../engine/source-position.mjs';
import en from '../../web/i18n/en.js';
import ja from '../../web/i18n/ja.js';

async function fixture(t, settings = {}) {
  let language = 'zh', translate = () => {}, subscriptions = 0, builds = 0;
  const context = { editable: true, sourceToken: 'source:1', ...settings.context };
  const h = await dialogHarness('app-source-position', {
    revealSourceOffset,
    createSourceLineIndex(value) { builds++; return createSourceLineIndex(value); },
    t: (key, ...values) => String(({ en, ja }[language]?.[key] || key)).replace(/\{(\d+)\}/g, (_, i) => values[i]),
    onLanguageChange(fn) { translate = fn; subscriptions++; return () => { translate = () => {}; subscriptions--; }; },
  });
  const document = h.runtime.document, textarea = h.element('docSourceEditor'), container = h.element('docEditorWrap');
  const captured = new Map();
  document.addEventListener = (type, fn, capture) => { assert.equal(capture, true); captured.set(type, fn); };
  document.removeEventListener = (type, fn, capture) => { assert.equal(capture, true); if (captured.get(type) === fn) captured.delete(type); };
  document.capture = type => captured.get(type)?.();
  textarea.isConnected = container.isConnected = true;
  textarea.readOnly = false; textarea.disabled = false;
  textarea.value = settings.text ?? '\ufeffalpha\n雪😀字\nomega\n';
  textarea.selectionStart = settings.start ?? 7; textarea.selectionEnd = settings.end ?? 10;
  textarea.selectionDirection = settings.direction ?? 'forward';
  textarea.scrollTop = 81; textarea.scrollLeft = 19;
  const selections = [], inputs = [];
  textarea.setSelectionRange = (start, end, direction = 'none') => {
    selections.push([start, end, direction]);
    textarea.selectionStart = start; textarea.selectionEnd = end; textarea.selectionDirection = direction;
    textarea.scrollTop = 999; textarea.scrollLeft = 999;
  };
  textarea.addEventListener('input', event => inputs.push(event));
  document.execCommand = () => assert.fail('navigation must not execute text commands');
  textarea.setRangeText = () => assert.fail('navigation must not replace text');
  const controller = h.runtime.setupSourcePosition({ textarea, container, getContext: settings.getContext || (() => context) });
  t.after(() => controller.dispose());
  const el = suffix => h.element('sourcePosition' + suffix);
  return { ...h, document, textarea, container, context, selections, inputs, controller, el,
    open() { el('Open').click(); }, submit(value) { el('Line').value = value; el('Form').dispatch('submit'); },
    key(properties) { return textarea.dispatch('keydown', properties); },
    language(value) { language = value; translate(); }, builds: () => builds,
    subscriptions: () => subscriptions, captures: () => captured.size };
}

function state(h) { return [h.textarea.value, h.textarea.selectionStart, h.textarea.selectionEnd,
  h.textarea.selectionDirection, h.textarea.scrollTop, h.textarea.scrollLeft]; }

test('position bar exposes only lifecycle methods and reports logical UTF16 active-end coordinates', async t => {
  const h = await fixture(t);
  assert.deepEqual(Object.keys(h.controller).sort(), ['dispose', 'refresh']);
  assert.equal(h.el('Bar').parentElement, h.container); assert.equal(h.el('Bar').hidden, false);
  assert.equal(h.el('Text').textContent, '第 2 行，第 4 列 · 共 4 行');
  h.textarea.selectionDirection = 'backward'; h.textarea.dispatch('select');
  assert.equal(h.el('Text').textContent, '第 2 行，第 1 列 · 共 4 行');
  h.textarea.selectionStart = 0; h.textarea.dispatch('keyup');
  assert.equal(h.el('Text').textContent, '第 1 行，第 1 列 · 共 4 行');
  assert.equal(h.inputs.length, 0); assert.equal(h.selections.length, 0);
});

test('selection, focus, key and language refresh reuse the exact text index until text changes', async t => {
  const h = await fixture(t); assert.equal(h.builds(), 1);
  for (let i = 0; i < 20; i++) { h.textarea.dispatch('select'); h.textarea.dispatch('keyup'); h.controller.refresh(); }
  h.language('ja'); h.textarea.focus(); h.document.capture('selectionchange');
  assert.equal(h.builds(), 1);
  h.textarea.value += 'last'; h.textarea.dispatch('input'); assert.equal(h.builds(), 2);
  h.controller.refresh(); assert.equal(h.builds(), 2);
});

test('navigation collapses at the requested row start, preserves source and emits no input', async t => {
  const h = await fixture(t); const source = h.textarea.value;
  h.open(); assert.equal(h.el('Dialog').open, true); assert.equal(h.el('Line').value, '2'); assert.equal(h.el('Line').max, '4');
  assert.equal(h.el('Open').disabled, true); h.submit('3');
  assert.equal(h.el('Dialog').open, false); assert.equal(h.document.activeElement, h.textarea);
  assert.deepEqual(h.selections, [[12, 12, 'none']]); assert.equal(h.textarea.value, source); assert.equal(h.inputs.length, 0);
  assert.equal(h.el('Text').textContent, '第 3 行，第 1 列 · 共 4 行');
});

test('first line skips an initial BOM and terminal empty line remains navigable', async t => {
  const h = await fixture(t); h.open(); h.submit('1'); assert.equal(h.textarea.selectionStart, 1);
  h.open(); h.submit('4'); assert.equal(h.textarea.selectionStart, h.textarea.value.length);
  const empty = await fixture(t, { text: '', start: 0, end: 0 }); empty.open(); empty.submit('1');
  assert.equal(empty.textarea.selectionStart, 0); assert.equal(empty.el('Text').textContent, '第 1 行，第 1 列 · 共 1 行');
});

test('invalid, fractional, exponential, nonfinite and out-of-range rows stay open without moving source', async t => {
  const h = await fixture(t), before = state(h); h.open();
  for (const value of ['', '0', '-1', '2.5', '2.0', '1e0', ' 2', 'Infinity', '5', '9007199254740992']) {
    h.submit(value); assert.equal(h.el('Dialog').open, true); assert.deepEqual(state(h), before);
    assert.match(h.el('Status').textContent, /整数/);
  }
  assert.equal(h.selections.length, 0); h.submit('2'); assert.equal(h.el('Dialog').open, false);
});

test('cancel, native Escape and external close return the exact selection and both scroll axes', async t => {
  for (const close of [h => h.el('Cancel').click(), h => h.el('Dialog').dispatch('cancel'), async h => { h.el('Dialog').close(); await flushDialogs(); }]) {
    const h = await fixture(t, { direction: 'backward' }), before = state(h); h.open(); h.el('Line').value = '3';
    await close(h); assert.deepEqual(state(h), before); assert.equal(h.document.activeElement, h.textarea); assert.equal(h.inputs.length, 0);
  }
});

test('source-only Ctrl/Cmd G shortcut preserves ordinary Tab and other browser shortcuts', async t => {
  const h = await fixture(t);
  for (const props of [{ key: 'Tab' }, { key: 'Tab', shiftKey: true }, { key: 'g', ctrlKey: true, shiftKey: true },
    { key: 'g', ctrlKey: true, altKey: true }, { key: 'g', metaKey: true, repeat: true }, { key: 'g' },
    { key: 'g', ctrlKey: true, defaultPrevented: true }, { key: 'g', ctrlKey: true, target: h.el('Open') }, { key: 'l', ctrlKey: true }]) {
    h.key(props); assert.equal(h.el('Dialog').open, false);
  }
  for (const modifier of ['ctrlKey', 'metaKey']) {
    const event = h.key({ key: 'g', [modifier]: true }); assert.equal(event.defaultPrevented, true); assert.equal(event.stopped, true);
    assert.equal(h.el('Dialog').open, true); h.el('Cancel').click();
  }
});

test('textarea and input IME sessions suppress navigation including keyCode229 and Enter repeat', async t => {
  const h = await fixture(t); h.textarea.dispatch('compositionstart'); h.el('Open').click();
  h.key({ key: 'g', ctrlKey: true }); assert.equal(h.el('Dialog').open, false);
  h.textarea.dispatch('compositionend');
  h.key({ key: 'g', ctrlKey: true, isComposing: true }); h.key({ key: 'g', ctrlKey: true, keyCode: 229 });
  assert.equal(h.el('Dialog').open, false); h.open(); h.el('Line').value = '3';
  h.el('Line').dispatch('compositionstart'); h.el('Form').dispatch('submit'); assert.equal(h.el('Dialog').open, true);
  h.el('Line').dispatch('compositionend');
  for (const props of [{ isComposing: true }, { keyCode: 229 }, { repeat: true }, { defaultPrevented: true }]) {
    h.el('Line').dispatch('keydown', { key: 'Enter', bubbles: true, ...props }); assert.equal(h.el('Dialog').open, true);
  }
  const repeatButton = h.el('Go').dispatch('keydown', { key: 'Enter', repeat: true, bubbles: true });
  assert.equal(repeatButton.defaultPrevented, true); assert.equal(h.el('Dialog').open, true);
  h.el('Line').dispatch('keydown', { key: 'Enter', bubbles: true }); assert.equal(h.el('Dialog').open, false); assert.equal(h.textarea.selectionStart, 12);
});

test('stale source, token, mode, busy, readonly and disconnection reject Go and cancel restoration', async t => {
  for (const mutate of [h => h.context.sourceToken = 'source:2', h => h.textarea.value += 'new', h => h.context.editable = false,
    h => h.textarea.readOnly = true, h => h.textarea.disabled = true, h => h.textarea.isConnected = false,
    h => h.container.isConnected = false, h => h.context.sourceToken = '']) {
    const h = await fixture(t); h.open(); mutate(h); h.submit('3');
    assert.equal(h.el('Dialog').open, true); assert.match(h.el('Status').textContent, /已变化/);
    h.el('Cancel').click(); assert.equal(h.el('Dialog').open, false); assert.equal(h.selections.length, 0);
  }
});

test('an observed stale session cannot revive after source content returns to the old value', async t => {
  const h = await fixture(t), original = h.textarea.value; h.open(); h.textarea.value += 'x'; h.controller.refresh();
  h.textarea.value = original; h.submit('3'); assert.equal(h.el('Go').disabled, true); assert.equal(h.selections.length, 0);
  h.el('Cancel').click(); assert.equal(h.selections.length, 0);
});

test('foreign dialogs protect the source before refresh and closing one re-enables the position entry', async t => {
  const h = await fixture(t); const foreign = h.document.createElement('dialog'); h.document.body.append(foreign); foreign.showModal();
  h.open(); assert.equal(h.el('Dialog').open, false); assert.equal(h.el('Open').disabled, true);
  foreign.close(); h.document.capture('close'); assert.equal(h.el('Open').disabled, false);
  h.open(); foreign.showModal(); h.submit('3'); h.el('Cancel').click(); assert.equal(h.selections.length, 0);
});

test('focus listeners that change source ownership cannot receive a stale selection on Go or cancel', async t => {
  for (const finish of [h => h.submit('3'), h => h.el('Cancel').click()]) {
    const h = await fixture(t); h.open(); h.textarea.focus = () => { h.context.sourceToken = 'source:other'; h.textarea.value = 'other'; h.textarea.selectionStart = h.textarea.selectionEnd = 0; };
    finish(h); assert.equal(h.textarea.value, 'other'); assert.equal(h.selections.length, 0); assert.equal(h.inputs.length, 0);
  }
});

test('language changes update labels only and preserve pending input and source selection/scroll', async t => {
  const h = await fixture(t), before = state(h); h.open(); h.el('Line').value = '3';
  for (const language of ['en', 'ja', 'zh']) {
    h.language(language); assert.equal(h.el('Line').value, '3'); assert.deepEqual(state(h), before);
    assert.equal(h.el('Open').textContent, ({ en, ja }[language]?.['跳转到行'] || '跳转到行'));
  }
  assert.equal(h.inputs.length, 0); assert.equal(h.builds(), 1);
});

test('unavailable or oversized sources retain native text editing without an index or crash', async t => {
  const h = await fixture(t, { text: 'x'.repeat(4 * 1024 * 1024 + 1), start: 0, end: 0 });
  assert.equal(h.el('Open').disabled, true); assert.match(h.el('Text').textContent, /无法/); h.open(); assert.equal(h.el('Dialog').open, false);
  assert.equal(h.builds(), 1); h.controller.refresh(); assert.equal(h.builds(), 1);
  h.textarea.value = 'ok'; h.textarea.dispatch('input'); assert.equal(h.el('Open').disabled, false);
  h.context.editable = false; h.controller.refresh(); assert.equal(h.el('Bar').hidden, true);
});

test('a measured mirror copies actual wrap metrics, uses text content and is removed after navigation', async t => {
  const h = await fixture(t); const measured = [], create = h.document.createElement;
  h.textarea.clientWidth = 230; h.textarea.clientHeight = 100;
  h.document.defaultView = { getComputedStyle: () => ({ fontFamily: 'mono', fontSize: '14px', lineHeight: '20px',
    paddingLeft: '12px', paddingRight: '12px', tabSize: '4', whiteSpace: 'pre-wrap', overflowWrap: 'break-word' }) };
  h.document.createElement = tag => { const node = create(tag); node.getBoundingClientRect = () => ({ top: 0, left: 0 });
    if (tag === 'div') measured.push(node); return node; };
  h.document.createRange = () => ({setStart(){},setEnd(){},getBoundingClientRect:()=>({top:820,left:0,height:20})});
  h.open(); h.submit('3'); assert.equal(h.textarea.scrollTop, 780); assert.equal(h.textarea.scrollLeft, 0);
  assert.equal(measured.length, 1); assert.equal(measured[0].style.width, '230px'); assert.equal(measured[0].style.tabSize, '4');
  assert.equal(measured[0].style.whiteSpace, 'pre-wrap'); assert.equal(measured[0].textContent, h.textarea.value + '\u200b');
  assert.equal(h.document.body.children.includes(measured[0]), false); assert.equal(h.inputs.length, 0);
});

test('mirror measurement failure removes its temporary element without replacing text', async t => {
  const h = await fixture(t); const create = h.document.createElement, mirrors = [];
  h.textarea.clientWidth = 230; h.textarea.clientHeight = 100; h.document.defaultView = { getComputedStyle: () => ({}) };
  h.document.createElement = tag => { const node = create(tag); node.getBoundingClientRect = () => { throw new Error('measurement unavailable'); };
    if (tag === 'div') mirrors.push(node); return node; };
  h.document.createRange = () => ({setStart(){},setEnd(){},getBoundingClientRect:()=>({top:820,left:0,height:20})});
  h.open(); h.submit('3'); assert.equal(h.textarea.selectionStart, 12); assert.equal(h.inputs.length, 0);
  assert.equal(mirrors.length, 1); assert.equal(h.document.body.children.includes(mirrors[0]), false);
});

test('dispose removes modal, bar, document listeners and subscriptions without late navigation', async t => {
  const h = await fixture(t); h.open(); const button = h.el('Open'), form = h.el('Form');
  h.controller.dispose(); h.controller.dispose(); assert.equal(h.el('Dialog'), null); assert.equal(h.el('Bar'), null);
  assert.equal(h.subscriptions(), 0); assert.equal(h.captures(), 0); assert.equal(h.container.classList.contains('source-position-container'), false);
  button.dispatch('click'); form.dispatch('submit'); h.key({ key: 'g', ctrlKey: true }); h.language('ja'); h.controller.refresh();
  assert.equal(h.selections.length, 0); assert.equal(h.inputs.length, 0);
});

test('all navigation interface strings have English and Japanese translations', async () => {
  const source = await fs.readFile(new URL('../../web/modules/app-source-position.js', import.meta.url), 'utf8');
  const keys = new Set([...source.matchAll(/'([^'\n]*[\u3400-\u9fff][^'\n]*)'/g)].map(match => match[1]));
  for (const key of keys) { assert.ok(en[key], `English: ${key}`); assert.ok(ja[key], `Japanese: ${key}`); }
});
