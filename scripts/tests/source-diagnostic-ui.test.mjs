import test from 'node:test';
import assert from 'node:assert/strict';
import { dialogHarness } from './dialog-harness.mjs';
import { createSourceDiagnosticSnapshot } from '../../engine/source-diagnostic.mjs';
import { createSourceLineIndex } from '../../engine/source-position.mjs';
import en from '../../web/i18n/en.js';
import ja from '../../web/i18n/ja.js';

const diagnostic = (overrides = {}) => ({ sourcePath: 'scenes/example.json', propertyPath: '/actors/0/speed',
  code: 'build_actor_value', severity: 'error', messageKey: '场景无法预览，请检查下方诊断。',
  detail: 'Speed must be a number.', sourceRevision: `sha256:${'a'.repeat(64)}`, status: 'exact', range: { start: 7, end: 8 }, ...overrides });

async function fixture(t, options = {}) {
  let language = 'zh', translate = () => {}, subscriptions = 0;
  const context = { visible: true, sourceToken: 'source:1', ...options.context };
  const h = await dialogHarness('app-source-diagnostic', {
    createSourceDiagnosticSnapshot: options.validate || createSourceDiagnosticSnapshot, createSourceLineIndex,
    t: (key, ...values) => String(({ en, ja }[language]?.[key] || key)).replace(/\{(\d+)\}/g, (_, i) => values[i]),
    onLanguageChange(fn) { translate = fn; subscriptions++; return () => { translate = () => {}; subscriptions--; }; },
  });
  const document = h.runtime.document, textarea = h.element('docSourceEditor'), container = h.element('docEditorWrap');
  textarea.isConnected = container.isConnected = true;
  textarea.readOnly = false; textarea.disabled = false;
  textarea.value = options.text ?? '\ufeffalpha\n雪😀字\nomega\n';
  textarea.selectionStart = 7; textarea.selectionEnd = 8; textarea.selectionDirection = 'backward';
  textarea.scrollTop = 37; textarea.scrollLeft = 13;
  const selections = [], inputs = [];
  textarea.setSelectionRange = (start, end, direction = 'none') => {
    selections.push([start, end, direction]);
    textarea.selectionStart = start; textarea.selectionEnd = end; textarea.selectionDirection = direction;
    textarea.scrollTop = textarea.scrollLeft = 999;
  };
  textarea.addEventListener('input', event => inputs.push(event));
  document.execCommand = () => assert.fail('diagnostics must not issue text commands');
  textarea.setRangeText = () => assert.fail('diagnostics must not replace source');
  const controller = h.runtime.setupSourceDiagnostic({ textarea, container, getContext: options.getContext || (() => context) });
  t.after(() => controller.dispose());
  const el = suffix => h.element('sourceDiagnostic' + suffix);
  return { ...h, document, textarea, container, context, selections, inputs, controller, el,
    language(value) { language = value; translate(); }, subscriptions: () => subscriptions };
}

const sourceState = h => [h.textarea.value, h.textarea.selectionStart, h.textarea.selectionEnd,
  h.textarea.selectionDirection, h.textarea.scrollTop, h.textarea.scrollLeft];

test('diagnostic display is read-only, detached from the textarea, and reports exact logical coordinates', async t => {
  const h = await fixture(t), before = sourceState(h);
  assert.equal(Object.isFrozen(h.controller), true);
  assert.deepEqual(Object.keys(h.controller).sort(), ['clear', 'dispose', 'refresh', 'show']);
  assert.equal(h.el('Panel').hidden, true);
  assert.equal(h.controller.show(diagnostic()), true);
  assert.equal(h.el('Panel').parentElement, h.container);
  assert.equal(h.el('Panel').hidden, false); assert.equal(h.el('Panel').dataset.status, 'exact');
  assert.equal(h.el('Title').textContent, '原文诊断：错误');
  assert.equal(h.el('Location').textContent, 'scenes/example.json · /actors/0/speed · 第 2 行，第 1 列');
  assert.equal(h.el('Code').textContent, 'build_actor_value');
  assert.equal(h.el('Details').open, false);
  assert.deepEqual(sourceState(h), before); assert.equal(h.inputs.length, 0); assert.equal(h.selections.length, 0);
});

test('stale, approximate and unavailable diagnostics explain their limits without invented coordinates', async t => {
  const h = await fixture(t);
  for (const [status, expected] of [['stale', /已失效/], ['approximate', /大致/], ['unavailable', /没有可用/]]) {
    const value = diagnostic({ status, severity: 'warning' }); delete value.range;
    assert.equal(h.controller.show(value), true);
    assert.equal(h.el('Panel').dataset.status, status); assert.equal(h.el('Title').textContent, '原文诊断：警告');
    assert.equal(h.el('Location').textContent, 'scenes/example.json · /actors/0/speed');
    assert.match(h.el('State').textContent, expected);
  }
  const value = diagnostic({ status: 'unavailable', severity: 'info', propertyPath: '', detail: '' }); delete value.range;
  h.controller.show(value); assert.equal(h.el('Title').textContent, '原文诊断：提示');
  assert.equal(h.el('DetailText').hidden, true); assert.equal(h.el('Location').textContent, 'scenes/example.json');
});

test('actual source bounds and surrogate boundaries reject dishonest exact locations without replacing a valid panel', async t => {
  const h = await fixture(t); h.controller.show(diagnostic());
  const previous = h.el('Panel').textContent, before = sourceState(h);
  for (const range of [{ start: 9, end: 10 }, { start: 8, end: 9 }, { start: 99, end: 99 }, { start: -1, end: 0 }, { start: 8, end: 7 }]) {
    assert.equal(h.controller.show(diagnostic({ range })), false);
    assert.equal(h.el('Panel').textContent, previous); assert.deepEqual(sourceState(h), before);
  }
  assert.equal(h.controller.show(diagnostic({ range: { start: 8, end: 10 } })), true);
  assert.match(h.el('Location').textContent, /第 2 行，第 2 列/);
  assert.equal(h.controller.show(diagnostic({ range: { start: h.textarea.value.length, end: h.textarea.value.length } })), true);
  assert.match(h.el('Location').textContent, /第 4 行，第 1 列/);
});

test('initial BOM offsets share the visible first column and empty source supports a point location', async t => {
  const h = await fixture(t);
  for (const start of [0, 1]) {
    assert.equal(h.controller.show(diagnostic({ range: { start, end: start } })), true);
    assert.match(h.el('Location').textContent, /第 1 行，第 1 列/);
  }
  const empty = await fixture(t, { text: '' });
  assert.equal(empty.controller.show(diagnostic({ range: { start: 0, end: 0 } })), true);
  assert.match(empty.el('Location').textContent, /第 1 行，第 1 列/);
});

test('bounded DTO validation fails closed for malformed snapshots and never invokes authored accessors', async t => {
  const h = await fixture(t); let accessed = 0;
  const accessor = diagnostic(); Object.defineProperty(accessor, 'detail', { enumerable: true, get() { accessed++; return 'bad'; } });
  for (const value of [null, {}, diagnostic({ detail: 'x'.repeat(8193) }), diagnostic({ extra: true }),
    diagnostic({ severity: 'fatal' }), diagnostic({ status: 'stale' }), diagnostic({ sourcePath: '../outside.json' }), accessor]) {
    assert.equal(h.controller.show(value), false); assert.equal(h.el('Panel').hidden, true);
  }
  assert.equal(accessed, 0); assert.equal(h.inputs.length, 0);
});

test('busy read-only or disabled source retains its diagnostic when the host still exposes this document', async t => {
  const h = await fixture(t); h.textarea.readOnly = true; h.textarea.disabled = true;
  assert.equal(h.controller.show(diagnostic()), true); h.controller.refresh();
  assert.equal(h.el('Panel').hidden, false); assert.equal(h.el('Panel').dataset.status, 'exact');
  assert.equal(h.selections.length, 0); assert.equal(h.inputs.length, 0);
});

test('document switch, editor closure and disconnection clear results permanently instead of reviving them', async t => {
  for (const mutate of [h => h.context.sourceToken = 'source:2', h => h.context.visible = false,
    h => h.context.sourceToken = '', h => h.textarea.isConnected = false, h => h.container.isConnected = false]) {
    const h = await fixture(t); h.controller.show(diagnostic()); mutate(h); h.controller.refresh();
    assert.equal(h.el('Panel').hidden, true); assert.equal(h.el('Code').textContent, ''); assert.equal(h.el('Details').open, false);
    h.context.sourceToken = 'source:1'; h.context.visible = true; h.textarea.isConnected = h.container.isConnected = true;
    h.controller.refresh(); assert.equal(h.el('Panel').hidden, true);
  }
  const h = await fixture(t); h.controller.show(diagnostic()); h.context.sourceToken = 'source:2';
  assert.equal(h.controller.show(null), false); assert.equal(h.el('Panel').hidden, true);
});

test('every input invalidates the observed location, even unchanged bytes or a subsequent undo', async t => {
  const h = await fixture(t), original = h.textarea.value; h.controller.show(diagnostic());
  h.textarea.dispatch('input'); assert.equal(h.el('Panel').dataset.status, 'changed');
  assert.equal(h.el('Location').textContent, 'scenes/example.json · /actors/0/speed');
  assert.match(h.el('State').textContent, /尚未重新检查/);
  h.textarea.value += 'edited'; h.textarea.dispatch('input'); h.textarea.value = original; h.textarea.dispatch('input');
  h.controller.refresh(); assert.equal(h.el('Panel').dataset.status, 'changed');
  assert.equal(h.inputs.length, 3); assert.equal(h.selections.length, 0);
});

test('a changed programmatic source cannot revive its exact status by returning to the original bytes', async t => {
  const h = await fixture(t), original = h.textarea.value; h.controller.show(diagnostic());
  h.textarea.value += 'new'; h.controller.refresh(); assert.equal(h.el('Panel').dataset.status, 'changed');
  h.textarea.value = original; h.controller.refresh(); assert.equal(h.el('Panel').dataset.status, 'changed');
  assert.equal(h.inputs.length, 0);
});

test('language changes translate only interface messages while preserving edits, details state and source selection', async t => {
  const h = await fixture(t); h.controller.show(diagnostic()); h.el('Details').open = true; h.textarea.dispatch('input');
  const before = sourceState(h);
  for (const language of ['en', 'ja', 'zh']) {
    h.language(language); assert.equal(h.el('Panel').dataset.status, 'changed'); assert.equal(h.el('Details').open, true);
    assert.equal(h.el('Message').textContent, ({ en, ja }[language]?.[diagnostic().messageKey] || diagnostic().messageKey));
    assert.equal(h.el('Code').textContent, 'build_actor_value'); assert.equal(h.el('DetailText').textContent, 'Speed must be a number.');
    assert.deepEqual(sourceState(h), before);
  }
  assert.equal(h.inputs.length, 1); assert.equal(h.selections.length, 0);
});

test('authored details, message fallback, paths and codes remain literal text without HTML injection', async t => {
  const h = await fixture(t), raw = '<img src=x onerror="throw 1">\n<script>bad()</script>';
  const value = diagnostic({ sourcePath: 'scenes/<b>.json', propertyPath: '/<i>', code: '<b>code</b>',
    messageKey: '<svg onload=bad()>', detail: raw });
  assert.equal(h.controller.show(value), true);
  assert.equal(h.el('Message').textContent, value.messageKey); assert.equal(h.el('DetailText').textContent, raw);
  assert.equal(h.el('Code').textContent, value.code); assert.match(h.el('Location').textContent, /scenes\/<b>\.json · \/<i>/);
  for (const suffix of ['Message', 'Code', 'DetailText', 'Location']) assert.equal(h.el(suffix).children.length, 0);
  assert.equal(h.el('Panel').querySelector('script'), null); assert.equal(h.el('Panel').querySelector('img'), null);
});

test('pointer dismissal preserves textarea focus, native selection and scroll without issuing input', async t => {
  const h = await fixture(t); h.controller.show(diagnostic()); h.textarea.focus(); const before = sourceState(h);
  assert.equal(h.el('Dismiss').dispatch('pointerdown', { button: 0 }).defaultPrevented, true);
  h.el('Dismiss').click(); assert.equal(h.el('Panel').hidden, true); assert.equal(h.document.activeElement, h.textarea);
  assert.deepEqual(sourceState(h), before); assert.equal(h.selections.length, 0); assert.equal(h.inputs.length, 0);
});

test('keyboard dismissal restores the current selection and scroll if focusing the textarea resets them', async t => {
  const h = await fixture(t); h.controller.show(diagnostic()); const before = sourceState(h);
  h.el('Dismiss').focus(); h.textarea.focus = () => {
    h.document.activeElement = h.textarea; h.textarea.selectionStart = h.textarea.selectionEnd = 0;
    h.textarea.scrollTop = h.textarea.scrollLeft = 0;
  };
  h.el('Dismiss').click(); assert.deepEqual(sourceState(h), before);
  assert.deepEqual(h.selections, [[7, 8, 'backward']]); assert.equal(h.inputs.length, 0);
});

test('dismissal cannot apply an old selection after focus changes document, text, visibility or modal ownership', async t => {
  for (const mutate of [h => h.context.sourceToken = 'other', h => h.textarea.value = 'other',
    h => h.context.visible = false, h => { const modal = h.document.createElement('dialog'); h.document.body.append(modal); modal.showModal(); }]) {
    const h = await fixture(t); h.controller.show(diagnostic()); h.el('Dismiss').focus();
    h.textarea.focus = () => { mutate(h); };
    h.el('Dismiss').click(); assert.equal(h.selections.length, 0); assert.equal(h.inputs.length, 0);
  }
});

test('dismissal does not steal focus from an open dialog or an unavailable textarea', async t => {
  for (const mutate of [h => h.textarea.disabled = true, h => h.textarea.readOnly = true,
    h => { const modal = h.document.createElement('dialog'); h.document.body.append(modal); modal.showModal(); }]) {
    const h = await fixture(t); h.controller.show(diagnostic()); h.el('Dismiss').focus(); mutate(h);
    h.textarea.focus = () => assert.fail('must not steal focus'); h.el('Dismiss').click(); assert.equal(h.selections.length, 0);
  }
});

test('a new explicit snapshot resets changed status and detail disclosure while staying detached from its input object', async t => {
  const h = await fixture(t), value = diagnostic(); h.controller.show(value);
  value.code = 'changed-outside'; value.range.start = 0; value.detail = 'changed detail'; h.controller.refresh();
  assert.equal(h.el('Code').textContent, 'build_actor_value'); assert.match(h.el('Location').textContent, /第 2 行/);
  h.textarea.dispatch('input'); h.el('Details').open = true;
  assert.equal(h.controller.show(diagnostic({ range: { start: 1, end: 1 } })), true);
  assert.equal(h.el('Panel').dataset.status, 'exact'); assert.equal(h.el('Details').open, false);
  assert.match(h.el('Location').textContent, /第 1 行，第 1 列/);
});

test('context changes during validation reject the snapshot even when the host returns one mutable context object', async t => {
  const context = { visible: true, sourceToken: 'one' }; let calls = 0;
  const h = await fixture(t, { getContext() { if (++calls > 1) context.sourceToken = 'two'; return context; } });
  assert.equal(h.controller.show(diagnostic()), false); assert.equal(h.el('Panel').hidden, true);
  const unavailable = await fixture(t, { getContext() { throw new Error('closed'); } });
  assert.equal(unavailable.controller.show(diagnostic()), false); assert.equal(unavailable.el('Panel').hidden, true);
});

test('oversized exact source fails safely and disposal removes observers without affecting source', async t => {
  const large = await fixture(t, { text: 'a'.repeat(4 * 1024 * 1024 + 1) });
  assert.equal(large.controller.show(diagnostic()), false); assert.equal(large.el('Panel').hidden, true);
  const h = await fixture(t); h.controller.show(diagnostic()); const before = sourceState(h), panel = h.el('Panel');
  const inputObservers = h.textarea.listeners.get('input').length;
  h.controller.dispose(); h.controller.dispose(); assert.equal(h.subscriptions(), 0);
  assert.equal(h.textarea.listeners.get('input').length, inputObservers - 1);
  assert.equal(h.container.contains(panel), false); assert.equal(h.container.classList.contains('source-diagnostic-container'), false);
  assert.equal(h.controller.show(diagnostic()), false); h.controller.refresh(); h.language('ja');
  assert.deepEqual(sourceState(h), before); assert.equal(h.inputs.length, 0);
  const noElements = h.runtime.setupSourceDiagnostic(); assert.equal(noElements.show(diagnostic()), false);
  noElements.clear(); noElements.refresh(); noElements.dispose();
});
