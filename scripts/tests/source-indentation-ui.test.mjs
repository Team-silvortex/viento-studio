import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { dialogHarness } from './dialog-harness.mjs';
import { planSourceIndentation, detectSourceIndentation } from '../../engine/source-indentation.mjs';
import en from '../../web/i18n/en.js';
import ja from '../../web/i18n/ja.js';

async function fixture(t, settings = {}) {
  let language = 'zh', changeLanguage = () => {}, subscriptions = 0;
  const context = { editable: true, sourceToken: 'source:1', ...settings.context };
  const commands = [], inputs = [];
  const h = await dialogHarness('app-source-indentation', {
    planSourceIndentation: value => planSourceIndentation(structuredClone(value)),
    detectSourceIndentation,
    t: key => ({ en, ja }[language]?.[key] || key),
    Event: class { constructor(type, options) { this.type = type; Object.assign(this, options); } },
    onLanguageChange: callback => { changeLanguage = callback; subscriptions++; return () => { subscriptions--; changeLanguage = () => {}; }; },
  });
  const document = h.runtime.document, textarea = h.element('docSourceEditor'), container = h.element('docEditorWrap');
  const captured = new Map();
  document.addEventListener = (type, listener, capture) => { assert.equal(capture, true); captured.set(type, listener); };
  document.removeEventListener = (type, listener, capture) => { assert.equal(capture, true); if (captured.get(type) === listener) captured.delete(type); };
  document.capture = type => captured.get(type)?.();
  document.capturedCount = () => captured.size;
  const create = document.createElement;
  document.createElement = tag => {
    const node = create(tag);
    // innerHTML creates these elements through the harness's constructor.
    const query = node.querySelector.bind(node);
    node.querySelector = selector => { const result = query(selector); if (result?.tagName === 'SELECT') result.options = result.children; return result; };
    return node;
  };
  container.prepend = node => { node.parentElement = container; container.children.unshift(node); };
  textarea.isConnected = container.isConnected = true;
  textarea.readOnly = false; textarea.disabled = false;
  textarea.value = settings.text ?? 'alpha\nbeta\n';
  textarea.selectionStart = settings.start ?? 0; textarea.selectionEnd = settings.end ?? 10;
  textarea.selectionDirection = settings.direction ?? 'forward';
  textarea.scrollTop = 81; textarea.scrollLeft = 19;
  textarea.setSelectionRange = (start, end, direction = 'none') => {
    textarea.selectionStart = start; textarea.selectionEnd = end; textarea.selectionDirection = direction;
    textarea.scrollTop = 999; textarea.scrollLeft = 999;
  };
  textarea.dispatchEvent = event => textarea.dispatch(event.type, { bubbles: event.bubbles });
  textarea.addEventListener('input', event => { inputs.push(event); settings.onInput?.({ textarea, context }); });
  document.execCommand = (command, ui, replacement) => {
    commands.push({ command, ui, replacement, start: textarea.selectionStart, end: textarea.selectionEnd });
    if (settings.exec) return settings.exec({ textarea, context, command, replacement });
    textarea.value = textarea.value.slice(0, textarea.selectionStart) + replacement + textarea.value.slice(textarea.selectionEnd);
    if (settings.nativeInput !== false) textarea.dispatch('input', { bubbles: true, inputType: 'insertText' });
    return true;
  };
  const controller = h.runtime.setupSourceIndentation({ textarea, container, getContext: () => context });
  t.after(() => controller.dispose());
  const el = name => h.element(name === 'Outdent' ? 'sourceOutdent' : 'sourceIndent' + name);
  return { ...h, controller, context, textarea, container, document, commands, inputs, el,
    unit(value) { el('Unit').value = value; el('Unit').dispatch('change'); },
    key(properties) { return textarea.dispatch('keydown', properties); },
    language(value) { language = value; changeLanguage(); }, subscriptions: () => subscriptions };
}

test('toolbar exposes only refresh/dispose and detects existing indentation on the first editable source', async t => {
  const h = await fixture(t, { text: 'func run():\n\twork()\n' });
  assert.deepEqual(Object.keys(h.controller).sort(), ['dispose', 'refresh']);
  assert.equal(h.el('Toolbar').parentElement, h.container); assert.equal(h.el('Unit').value, 'tab');
  assert.equal(h.el('').disabled, false); assert.equal(h.el('Toolbar').hidden, false);
  assert.equal(h.commands.length, 0); assert.equal(h.inputs.length, 0);
});

test('one native transaction changes all selected lines and emits only one ordinary input', async t => {
  const h = await fixture(t); h.unit('spaces-2');
  h.el('').click();
  assert.equal(h.commands.length, 1); assert.equal(h.commands[0].command, 'insertText'); assert.equal(h.commands[0].ui, false);
  assert.equal(h.textarea.value, '  alpha\n  beta\n'); assert.equal(h.inputs.length, 1);
  assert.equal(h.textarea.selectionStart, 2); assert.equal(h.textarea.selectionEnd, 14);
  assert.equal(h.textarea.scrollTop, 81); assert.equal(h.textarea.scrollLeft, 19);
});

test('a backward selection remains backward and both scroll axes are restored', async t => {
  const h = await fixture(t, { direction: 'backward' }); h.unit('tab'); h.el('').click();
  assert.equal(h.textarea.selectionDirection, 'backward'); assert.equal(h.textarea.selectionStart, 1); assert.equal(h.textarea.selectionEnd, 12);
  assert.equal(h.textarea.scrollTop, 81); assert.equal(h.textarea.scrollLeft, 19);
  assert.equal(h.document.activeElement, h.textarea);
});

test('successful native changes missing an input event notify the ordinary editor exactly once', async t => {
  const h = await fixture(t, { nativeInput: false }); h.el('').click();
  assert.equal(h.commands.length, 1); assert.equal(h.inputs.length, 1); assert.equal(h.inputs[0].bubbles, true);
});

test('unsupported or throwing native commands never fall back to direct source replacement', async t => {
  for (const exec of [() => false, () => { throw new Error('unsupported'); }]) {
    const h = await fixture(t, { exec, direction: 'backward' });
    h.textarea.setRangeText = () => assert.fail('non-undoable fallback'); h.el('').click();
    assert.equal(h.textarea.value, 'alpha\nbeta\n'); assert.equal(h.commands.length, 1); assert.equal(h.inputs.length, 0);
    assert.equal(h.textarea.selectionStart, 0); assert.equal(h.textarea.selectionEnd, 10); assert.equal(h.textarea.selectionDirection, 'backward');
    assert.equal(h.textarea.scrollTop, 81); assert.equal(h.textarea.scrollLeft, 19);
    assert.match(h.el('Status').textContent, /未执行/); assert.equal(h.document.activeElement, h.textarea);
  }
});

test('a partial native result is reported and notified without retrying or overwriting it', async t => {
  const h = await fixture(t, { exec: ({ textarea }) => { textarea.value = 'partial change'; return false; } });
  h.el('').click(); assert.equal(h.textarea.value, 'partial change'); assert.equal(h.commands.length, 1); assert.equal(h.inputs.length, 1);
  assert.match(h.el('Status').textContent, /未能完整/);
});

test('outdent without a removable prefix leaves selection and input untouched', async t => {
  const h = await fixture(t); h.el('Outdent').click();
  assert.equal(h.commands.length, 0); assert.equal(h.inputs.length, 0);
  assert.equal(h.textarea.selectionStart, 0); assert.equal(h.textarea.selectionEnd, 10);
});

test('Ctrl/Cmd brackets work only on the textarea, while Tab and browser modifier combinations pass through', async t => {
  const h = await fixture(t); h.unit('spaces-2');
  for (const properties of [{ key: 'Tab' }, { key: 'Tab', shiftKey: true }, { key: ']', ctrlKey: true, shiftKey: true },
    { key: '[', metaKey: true, altKey: true }, { key: ']', ctrlKey: true, repeat: true }, { key: ']' },
    { key: ']', ctrlKey: true, target: h.el('Unit') }, { key: ']', ctrlKey: true, defaultPrevented: true }]) {
    const event = h.key(properties); assert.equal(h.commands.length, 0); assert.notEqual(event.stopped, true);
  }
  const indent = h.key({ key: ']', ctrlKey: true }); assert.equal(indent.defaultPrevented, true); assert.equal(indent.stopped, true);
  const outdent = h.key({ key: '[', metaKey: true }); assert.equal(outdent.defaultPrevented, true); assert.equal(outdent.stopped, true);
  assert.equal(h.commands.length, 2); assert.equal(h.textarea.value, 'alpha\nbeta\n');
});

test('composition sessions block both buttons and shortcuts even when an event lacks isComposing', async t => {
  const h = await fixture(t); h.textarea.dispatch('compositionstart');
  h.el('').click(); h.el('Outdent').click(); const key = h.key({ key: ']', ctrlKey: true });
  assert.equal(h.commands.length, 0); assert.notEqual(key.defaultPrevented, true); assert.equal(h.el('').disabled, true);
  h.textarea.dispatch('compositionend'); assert.equal(h.el('').disabled, false);
  h.key({ key: ']', ctrlKey: true, isComposing: true }); h.key({ key: ']', ctrlKey: true, keyCode: 229 });
  h.el('').dispatch('click', { isComposing: true }); assert.equal(h.commands.length, 0);
  h.el('').click(); assert.equal(h.commands.length, 1);
});

test('busy, readonly, disabled and disconnected editor contexts cannot mutate source', async t => {
  for (const disable of [h => h.context.editable = false, h => h.textarea.readOnly = true, h => h.textarea.disabled = true,
    h => h.textarea.isConnected = false, h => h.container.isConnected = false, h => h.context.sourceToken = '']) {
    const h = await fixture(t); disable(h); h.el('').dispatch('click');
    const event = h.key({ key: ']', ctrlKey: true }); assert.notEqual(event.defaultPrevented, true);
    assert.equal(h.commands.length, 0); assert.equal(h.textarea.value, 'alpha\nbeta\n');
  }
});

test('an open dialog protects editor text even before a toolbar refresh', async t => {
  const h = await fixture(t); const dialog = h.document.createElement('dialog'); h.document.body.append(dialog); dialog.showModal();
  h.el('').dispatch('click'); const event = h.key({ key: ']', ctrlKey: true });
  assert.equal(h.commands.length, 0); assert.notEqual(event.defaultPrevented, true); assert.equal(h.el('').disabled, true);
  dialog.close(); h.textarea.dispatch('focus'); assert.equal(h.el('').disabled, false);
});


test('a new script created while a modal is open detects its source and enables on return focus', async t => {
  const h = await fixture(t, { text: '  old text' }); const dialog = h.document.createElement('dialog'); h.document.body.append(dialog); dialog.showModal();
  h.context.sourceToken = 'new:script'; h.textarea.value = 'func run():\n\twork()\n'; h.controller.refresh();
  assert.equal(h.el('').disabled, true); assert.equal(h.el('Unit').value, 'spaces-2');
  dialog.close(); h.textarea.dispatch('focus');
  assert.equal(h.el('').disabled, false); assert.equal(h.el('Unit').value, 'tab'); assert.equal(h.commands.length, 0);
});

test('closing settings after a language refresh re-enables controls without moving source focus', async t => {
  const h = await fixture(t); const dialog = h.document.createElement('dialog'); h.document.body.append(dialog); dialog.showModal();
  h.language('ja'); assert.equal(h.el('').disabled, true);
  const other = h.document.createElement('button'); h.document.body.append(other); other.focus();
  dialog.close(); h.document.capture('close');
  assert.equal(h.el('').disabled, false); assert.equal(h.document.activeElement, other); assert.equal(h.commands.length, 0);
});

test('unit selection persists through edits/language/refresh and is detected again for a new editable source', async t => {
  const h = await fixture(t, { text: 'func run():\n\twork()\n' }); h.unit('spaces-2');
  h.textarea.value = 'func run():\n    work()\n'; h.textarea.dispatch('input'); h.language('ja'); h.controller.refresh();
  assert.equal(h.el('Unit').value, 'spaces-2');
  h.context.editable = false; h.context.sourceToken = 'source:2'; h.controller.refresh();
  assert.equal(h.el('Unit').value, 'spaces-2'); assert.equal(h.el('Toolbar').hidden, true);
  h.textarea.value = 'func run():\n\twork()\n'; h.context.editable = true; h.controller.refresh();
  assert.equal(h.el('Unit').value, 'tab'); assert.equal(h.el('Toolbar').hidden, false);
});

test('language refresh only changes labels and preserves content, selection, scroll and command history', async t => {
  const h = await fixture(t, { direction: 'backward' }); h.unit('spaces-2');
  const initial = [h.textarea.value, h.textarea.selectionStart, h.textarea.selectionEnd, h.textarea.selectionDirection, h.textarea.scrollTop, h.textarea.scrollLeft];
  for (const language of ['en', 'ja', 'zh']) {
    h.language(language); assert.equal(h.el('').textContent, ({ en, ja }[language]?.['增加缩进'] || '增加缩进'));
    assert.deepEqual([h.textarea.value, h.textarea.selectionStart, h.textarea.selectionEnd, h.textarea.selectionDirection, h.textarea.scrollTop, h.textarea.scrollLeft], initial);
    assert.equal(h.el('Unit').value, 'spaces-2'); assert.equal(h.commands.length, 0);
  }
});

test('button pointer selection protection does not consume other mouse buttons or composition', async t => {
  const h = await fixture(t); assert.equal(h.el('').dispatch('pointerdown', { button: 0 }).defaultPrevented, true);
  assert.notEqual(h.el('').dispatch('pointerdown', { button: 1 }).defaultPrevented, true);
  h.textarea.dispatch('compositionstart'); assert.notEqual(h.el('').dispatch('pointerdown', { button: 0 }).defaultPrevented, true);
});

test('focus-driven session changes cancel before issuing any native text operation', async t => {
  const h = await fixture(t); h.textarea.focus = () => { h.context.sourceToken = 'other'; h.textarea.value = 'other source'; };
  h.el('').click(); assert.equal(h.commands.length, 0); assert.equal(h.textarea.value, 'other source'); assert.equal(h.inputs.length, 0);
});

test('native input cannot recursively start another indentation transaction', async t => {
  let h; h = await fixture(t, { onInput: () => h.el('').dispatch('click') });
  h.el('').click(); assert.equal(h.commands.length, 1); assert.equal(h.inputs.length, 1);
});

test('dispose removes all textarea listeners and the toolbar without late edits or language subscriptions', async t => {
  const h = await fixture(t); const button = h.el(''); h.controller.dispose(); h.controller.dispose();
  assert.equal(h.el('Toolbar'), null); assert.equal(h.subscriptions(), 0); assert.equal(h.document.capturedCount(), 0); assert.equal(h.container.classList.contains('source-indentation-container'), false);
  button.dispatch('click'); h.key({ key: ']', ctrlKey: true }); h.language('ja'); h.controller.refresh();
  assert.equal(h.commands.length, 0); assert.equal(h.inputs.length, 0);
});

test('all visible indentation messages have English and Japanese translations', async () => {
  const source = await fs.readFile(new URL('../../web/modules/app-source-indentation.js', import.meta.url), 'utf8');
  const keys = new Set([...source.matchAll(/'([^'\n]*[\u3400-\u9fff][^'\n]*)'/g)].map(match => match[1]));
  for (const key of keys) { assert.ok(en[key], `English: ${key}`); assert.ok(ja[key], `Japanese: ${key}`); }
});
