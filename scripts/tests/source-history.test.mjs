import test from 'node:test';
import assert from 'node:assert/strict';
import { setupSourceHistory } from '../../web/modules/app-source-history.js';
import { editorHarness } from './editor-harness.mjs';

// Model only the synchronous browser command/event boundary. Real browser and
// installed WebKit tests exercise its native history stack and keyboard route.
function fixture(t, options = {}) {
  const context = { editable: true, sourceToken: 'session:1', ...options.context };
  const listeners = new Map(), commands = [], inputs = [];
  const textarea = options.textarea || { value: 'edited source', isConnected: true };
  const container = options.container || { isConnected: true };
  const document = options.document || {};
  document.activeElement = textarea;
  document.querySelector = () => options.modal ? {} : null;
  document.defaultView = { Event: class {
    constructor(type, properties) { this.type = type; Object.assign(this, properties); }
  } };
  textarea.ownerDocument = document;
  textarea.isConnected = container.isConnected = true;
  textarea.readOnly = textarea.disabled = false;
  textarea.addEventListener = (type, listener) => {
    if (!listeners.has(type)) listeners.set(type, new Set());
    listeners.get(type).add(listener);
  };
  textarea.removeEventListener = (type, listener) => listeners.get(type)?.delete(listener);
  const dispatch = (type, properties = {}) => {
    const event = { type, target: textarea,
      preventDefault() { this.defaultPrevented = true; },
      stopPropagation() { this.stopped = true; }, ...properties };
    for (const listener of [...(listeners.get(type) || [])]) listener(event);
    return event;
  };
  textarea.dispatchEvent = event => { dispatch(event.type, event); return true; };
  textarea.setRangeText = () => assert.fail('history must not rewrite the source');
  textarea.focus = () => assert.fail('history must not steal focus');
  textarea.addEventListener('input', event => { inputs.push(event); options.onInput?.({ textarea, context }); });
  document.execCommand = (command, ...args) => {
    commands.push([command, ...args]);
    if (options.exec) return options.exec({ command, textarea, context, document, dispatch });
    textarea.value = command === 'undo' ? 'original source' : 'edited source';
    if (options.nativeInput !== false) dispatch('input', { bubbles: true, inputType: command === 'undo' ? 'historyUndo' : 'historyRedo' });
    return true;
  };
  const controller = setupSourceHistory({ textarea, container, getContext: options.getContext || (() => context) });
  t.after(() => controller.dispose());
  return { textarea, container, document, context, commands, inputs, controller, dispatch, listeners,
    key: (properties = {}) => dispatch('keydown', { key: 'z', ctrlKey: true, ...properties }) };
}

test('Ctrl/Cmd Z, Shift Z and Ctrl Y each use one native history command and one input', t => {
  const h = fixture(t);
  for (const [properties, command] of [[{}, 'undo'], [{ key: 'Z', shiftKey: true }, 'redo'],
    [{ ctrlKey: false, metaKey: true }, 'undo'], [{ ctrlKey: false, metaKey: true, shiftKey: true }, 'redo'],
    [{}, 'undo'], [{ key: 'y' }, 'redo']]) {
    const before = h.commands.length, event = h.key(properties);
    assert.equal(event.defaultPrevented, true); assert.equal(event.stopped, true);
    assert.equal(h.commands.length, before + 1); assert.deepEqual(h.commands.at(-1), [command, false]);
    assert.equal(h.inputs.length, before + 1);
    assert.equal(h.inputs.at(-1).inputType, command === 'undo' ? 'historyUndo' : 'historyRedo');
  }
});

test('a host omitting native input receives exactly one ordinary input per text change', t => {
  const h = fixture(t, { nativeInput: false }); h.key(); h.key({ key: 'y' });
  assert.equal(h.commands.length, 2); assert.equal(h.inputs.length, 2);
  assert.ok(h.inputs.every(event => event.bubbles)); assert.equal(h.textarea.value, 'edited source');
});

test('false command results that changed text still notify once without retrying', t => {
  const h = fixture(t, { exec: ({ textarea }) => { textarea.value = 'native result'; return false; } });
  h.key(); assert.equal(h.commands.length, 1); assert.equal(h.inputs.length, 1); assert.equal(h.textarea.value, 'native result');
});

test('unsupported, throwing, or empty native history leaves the text untouched and emits no input', t => {
  for (const exec of [() => false, () => true, () => { throw Error('unsupported'); }]) {
    const h = fixture(t, { exec }); const event = h.key();
    assert.equal(event.defaultPrevented, true); assert.equal(h.commands.length, 1);
    assert.equal(h.textarea.value, 'edited source'); assert.equal(h.inputs.length, 0);
  }
});

test('unrelated or already handled shortcuts pass through without taking focus or running a command', t => {
  const h = fixture(t);
  for (const properties of [{ key: 's' }, { key: 'f' }, { key: 'Tab', ctrlKey: false },
    { ctrlKey: false }, { metaKey: true }, { altKey: true }, { repeat: true },
    { key: 'y', shiftKey: true }, { key: 'y', ctrlKey: false, metaKey: true },
    { defaultPrevented: true }, { target: {} }]) {
    const event = h.key(properties);
    assert.equal(h.commands.length, 0); assert.notEqual(event.stopped, true);
    assert.equal(event.defaultPrevented, properties.defaultPrevented);
  }
});

test('IME sessions and composition-marked events retain ownership of undo keys', t => {
  const h = fixture(t); h.dispatch('compositionstart');
  assert.notEqual(h.key().defaultPrevented, true); assert.equal(h.commands.length, 0);
  h.dispatch('compositionend');
  for (const properties of [{ isComposing: true }, { keyCode: 229 }]) assert.notEqual(h.key(properties).defaultPrevented, true);
  assert.equal(h.commands.length, 0); h.key(); assert.equal(h.commands.length, 1);
});

test('busy, readonly, disconnected, missing-owner and unfocused source sessions cannot run history', t => {
  for (const disable of [h => { h.context.editable = false; }, h => { h.context.sourceToken = ''; },
    h => { h.context.sourceToken = null; }, h => { h.textarea.readOnly = true; }, h => { h.textarea.disabled = true; },
    h => { h.textarea.isConnected = false; }, h => { h.container.isConnected = false; },
    h => { h.document.activeElement = {}; }, h => { h.document.execCommand = undefined; }]) {
    const h = fixture(t); disable(h); assert.notEqual(h.key().defaultPrevented, true);
    assert.equal(h.commands.length, 0); assert.equal(h.inputs.length, 0);
  }
});

test('open modal dialogs and failing context providers leave the shortcut to its current owner', t => {
  for (const options of [{ modal: true }, { getContext: () => null }, { getContext: () => { throw Error('gone'); } }]) {
    const h = fixture(t, options); assert.notEqual(h.key().defaultPrevented, true); assert.equal(h.commands.length, 0);
  }
});

test('synchronous navigation during a native command never notifies the new document', t => {
  const h = fixture(t, { exec: ({ textarea, context }) => {
    textarea.value = 'the next document'; context.sourceToken = 'session:2'; return true;
  } });
  h.key(); assert.equal(h.commands.length, 1); assert.equal(h.inputs.length, 0); assert.equal(h.textarea.value, 'the next document');
});

test('losing editability, focus, or disposal during a native command suppresses fallback input', t => {
  for (const relinquish of [h => { h.context.editable = false; }, h => { h.document.activeElement = {}; },
    h => h.controller.dispose()]) {
    let h;
    h = fixture(t, { exec: ({ textarea }) => { textarea.value = 'native changed text'; relinquish(h); return true; } });
    h.key(); assert.equal(h.commands.length, 1); assert.equal(h.inputs.length, 0);
  }
});

test('native input may navigate without a duplicate input or overwriting the next document', t => {
  const h = fixture(t, { onInput: ({ textarea, context }) => {
    textarea.value = 'new owner'; context.sourceToken = 'session:2';
  } });
  h.key(); assert.equal(h.commands.length, 1); assert.equal(h.inputs.length, 1); assert.equal(h.textarea.value, 'new owner');
});

test('native and fallback input cannot recursively start another history command', t => {
  for (const nativeInput of [true, false]) {
    let h; h = fixture(t, { nativeInput, onInput: () => h.key({ key: 'y' }) });
    h.key(); assert.equal(h.commands.length, 1); assert.equal(h.inputs.length, 1); assert.equal(h.textarea.value, 'original source');
  }
});

test('dispose is idempotent and detaches listeners; absent source returns an inert controller', t => {
  const h = fixture(t); h.controller.dispose(); h.controller.dispose();
  h.dispatch('compositionstart'); h.key(); assert.equal(h.commands.length, 0);
  assert.equal(h.listeners.get('keydown').size, 0); assert.equal(h.listeners.get('compositionstart').size, 0);
  assert.equal(h.listeners.get('compositionend').size, 0); setupSourceHistory().dispose();
});

test('host context gates source history through editing modes and every busy workflow', async t => {
  const editor = await editorHarness(); editor.begin();
  const h = fixture(t, { textarea: editor.source, getContext: () => editor.runtime.sourceEditorContext(), exec: () => false });
  for (const [key, value] of [['mode', 'browse'], ['editBackendAvailable', false], ['editInputMode', 'blocks'],
    ['editInputMode', 'fields'], ['isSaving', true], ['isRebuilding', true], ['isLoadingSource', true],
    ['isLoadingTemplate', true], ['isLoadingFields', true], ['isImportingMedia', true], ['isExporting', true],
    ['isConfiguringProject', true], ['isMutatingWorld', true]]) {
    const previous = editor.state[key]; editor.state[key] = value;
    assert.notEqual(h.key().defaultPrevented, true, key); editor.state[key] = previous;
  }
  assert.equal(h.commands.length, 0); assert.equal(h.key().defaultPrevented, true); assert.equal(h.commands.length, 1);
  editor.runtime.resetDocEditorState(); assert.notEqual(h.key().defaultPrevented, true); assert.equal(h.commands.length, 1);
});

test('history inputs use ordinary dirty tracking and Save retains BOM and CRLF', async t => {
  const writes = [], editor = await editorHarness({ writeDoc: async payload => { writes.push(payload); return { version: '2' }; } });
  editor.runtime.rebuildIndexForDoc = async () => {};
  const before = '\uFEFFextends Node\r\n\r\nfunc _ready():\r\n\tpass\r\n';
  const after = before.replace('\tpass', '\tprint("hello")');
  editor.begin(before, '1'); editor.source.value = after; editor.runtime.handleSourceInput();
  assert.equal(editor.state.editHasUnsavedChanges, true);
  const h = fixture(t, { textarea: editor.source, getContext: () => editor.runtime.sourceEditorContext(),
    onInput: () => editor.runtime.handleSourceInput(), exec: ({ command, textarea, dispatch }) => {
      textarea.value = command === 'undo' ? before : after;
      dispatch('input', { bubbles: true, inputType: command === 'undo' ? 'historyUndo' : 'historyRedo' }); return true;
    } });
  h.key(); assert.equal(editor.state.editHasUnsavedChanges, false); assert.equal(editor.runtime.getCurrentEditContent(), before);
  h.key({ shiftKey: true }); assert.equal(editor.state.editHasUnsavedChanges, true); assert.equal(editor.runtime.getCurrentEditContent(), after);
  assert.equal(writes.length, 0); h.textarea.focus = () => {}; await editor.runtime.saveCurrentDoc();
  assert.equal(writes.length, 1); assert.equal(writes[0].content, after); assert.equal(editor.state.editHasUnsavedChanges, false);
  assert.equal(h.inputs.length, 2); assert.equal(h.commands.length, 2);
});
