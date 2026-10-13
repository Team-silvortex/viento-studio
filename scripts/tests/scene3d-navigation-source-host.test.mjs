import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { createScene3DSourceLocation, scene3DSourceDisplaySelection } from '../../engine/scene3d-navigation.mjs';

const runtime = await fs.readFile(new URL('../../web/modules/app-runtime.js', import.meta.url), 'utf8');
const source = runtime.slice(runtime.indexOf('let scene3DSourceReadEpoch'), runtime.indexOf('\nasync function applySceneCompositionOverrideDraft'));
const sample = JSON.parse(await fs.readFile(new URL('../../examples/scene3d/scene.json', import.meta.url), 'utf8'));
sample.name = '箱🦊\r\nSample'; sample.objects[0].name = '🦊 Object';
const original = '\ufeff' + JSON.stringify(sample, null, '\t').replaceAll('\n', '\r\n') + '\r\n \t', target = sample.objects[0].instanceId;
const display = content => content.replace(/\r\n|\r/g, '\n');
function fixture() {
  let content = original, doc = { path: 'scene', _sourceCachedText: original }, busy = false, editable = true, gate = null;
  const state = { isEditing: true, isCreating: false, editInputMode: 'source', activeEditPath: 'scene', activeEditSource: 'documents/scene.json', editHasUnsavedChanges: false };
  const editor = { value: display(original), selectionStart: 7, selectionEnd: 13, scrollTop: 51, clientHeight: 200, focusCount: 0, scrollCount: 0,
    setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; }, focus() { this.focusCount++; }, scrollIntoView() { this.scrollCount++; } };
  const statuses = [], context = vm.createContext({ state, editorLoadToken: 3, scenePreviewDraftEpoch: 7, sourceNavigationToken: 2,
    editSessionBaselineContent: original, editSessionVersion: 'original-version', editEditorEl: editor, createScene3DSourceLocation, scene3DSourceDisplaySelection,
    getCurrentEditContent: () => content, getActiveDoc: () => doc, isEditModeActive: () => editable, isEditorBusy: () => busy,
    canonicalizeSourcePath: value => value || '', getComputedStyle: () => ({ lineHeight: '24px' }), t: (value, replacement) => value.replace('{0}', replacement),
    setEditorStatus: value => statuses.push(value) });
  vm.runInContext(source, context);
  const read = context.getScene3DSourceSnapshot;
  context.getScene3DSourceSnapshot = async () => { const snapshot = await read(); if (gate) await gate.promise; return snapshot; };
  return { context, state, editor, statuses, content: () => content, doc: () => doc,
    source: () => read(), locate: (snapshot, options = {}) => context.locateScene3DSource(snapshot, { instanceId: target, ...options }),
    setContent(value) { content = value; editor.value = display(value); }, setDoc(value) { doc = value; }, setBusy(value) { busy = value; }, setEditable(value) { editable = value; },
    block() { let release; const promise = new Promise(resolve => { release = resolve; }); gate = { promise, release }; }, release() { gate.release(); gate = null; } };
}
const selection = h => [h.editor.selectionStart, h.editor.selectionEnd, h.editor.scrollTop, h.editor.focusCount];
const unchanged = h => {
  assert.equal(h.context.editSessionBaselineContent, original); assert.equal(h.context.editSessionVersion, 'original-version');
  assert.equal(h.doc()._sourceCachedText, original); assert.equal(h.state.editHasUnsavedChanges, false);
};

test('actual navigation selects exact native UTF16 declaration while preserving source baseline cache and dirty state', async () => {
  const h = fixture(), snapshot = await h.source(), receipt = await h.locate(snapshot);
  assert.equal(receipt.located, true); assert.equal(Object.isFrozen(receipt), true); assert.equal(h.editor.focusCount, 0);
  assert.deepEqual(JSON.parse(h.editor.value.slice(h.editor.selectionStart, h.editor.selectionEnd)), sample.objects[0]);
  assert.equal(h.editor.scrollTop, Math.max(0, (h.editor.value.slice(0, h.editor.selectionStart).split('\n').length - 1) * 24 - 100));
  assert.equal(h.content(), original); unchanged(h); assert.equal(h.statuses.at(-1), '已定位草稿字段：/objects/0');
  assert.equal(receipt.focus(), true); assert.equal(h.editor.focusCount, 1); assert.equal(h.editor.scrollCount, 1); assert.equal(receipt.focus(), false);
});

test('unsaved source is navigated exactly without normalizing bytes or saving its original baseline', async () => {
  const h = fixture(), value = { ...sample, objects: [...sample.objects].reverse() }, dirty = JSON.stringify(value, null, 2) + '\n';
  h.setContent(dirty); h.state.editHasUnsavedChanges = true;
  const receipt = await h.locate(await h.source()); assert.equal(receipt.located, true);
  assert.deepEqual(JSON.parse(dirty.slice(h.editor.selectionStart, h.editor.selectionEnd)), sample.objects[0]); assert.equal(h.content(), dirty);
  assert.equal(h.context.editSessionBaselineContent, original); assert.equal(h.doc()._sourceCachedText, original); assert.equal(h.state.editHasUnsavedChanges, true);
});

test('stale bytes token path and caller-provided ranges are refused without moving the cursor', async () => {
  for (const change of ['bytes', 'token', 'path', 'range', 'identity', 'malformed']) {
    const h = fixture(), snapshot = await h.source(), before = selection(h); let identity = target;
    if (change === 'bytes') h.setContent(original + ' ');
    if (change === 'token') snapshot.token = 'old';
    if (change === 'path') snapshot.sourcePath = 'documents/other.json';
    if (change === 'range') snapshot.sourceRange = { start: 0, end: 1 };
    if (change === 'identity') identity = 'missing';
    if (change === 'malformed') { snapshot.content = '{}'; h.setContent('{}'); }
    assert.equal(await h.locate(snapshot, { instanceId: identity }), false, change); assert.deepEqual(selection(h), before); assert.equal(h.statuses.length, 0);
  }
});

test('cancel and all source owner replacements across actual readonly await leave selection untouched', async () => {
  for (const change of ['cancel', 'bytes', 'value', 'doc', 'load', 'epoch', 'request', 'baseline', 'version', 'busy', 'path', 'activePath', 'mode', 'editable', 'creating']) {
    const h = fixture(), snapshot = await h.source(), before = selection(h); let current = true;
    h.block(); const pending = h.locate(snapshot, { isCurrent: () => current }); await Promise.resolve();
    if (change === 'cancel') current = false;
    if (change === 'bytes') h.setContent(original + ' ');
    if (change === 'value') h.editor.value += ' ';
    if (change === 'doc') h.setDoc({ ...h.doc() });
    if (change === 'load') h.context.editorLoadToken++;
    if (change === 'epoch') h.context.scenePreviewDraftEpoch++;
    if (change === 'request') h.context.sourceNavigationToken++;
    if (change === 'baseline') h.context.editSessionBaselineContent += ' ';
    if (change === 'version') h.context.editSessionVersion = 'reloaded';
    if (change === 'busy') h.setBusy(true);
    if (change === 'path') h.state.activeEditSource = 'documents/other.json';
    if (change === 'activePath') h.state.activeEditPath = 'other';
    if (change === 'mode') h.state.editInputMode = 'fields';
    if (change === 'editable') h.setEditable(false);
    if (change === 'creating') h.state.isCreating = true;
    h.release(); assert.equal(await pending, false, change); assert.deepEqual(selection(h), before, change); assert.equal(h.statuses.length, 0);
  }
});

test('approval callbacks cannot change ownership at any of three gates and still authorize cursor movement', async () => {
  for (const boundary of [1, 2, 3]) {
    const h = fixture(), snapshot = await h.source(), before = selection(h); let approvals = 0;
    assert.equal(await h.locate(snapshot, { isCurrent: () => { if (++approvals === boundary) h.setContent(original + '\t'); return true; } }), false);
    assert.deepEqual(selection(h), before); assert.equal(h.statuses.length, 0);
  }
});

test('returned focus is valid after modal approval closes but cannot steal focus from a changed document session', async () => {
  const first = fixture(); let current = true;
  const receipt = await first.locate(await first.source(), { isCurrent: () => current }); current = false;
  assert.equal(receipt.focus(), true); assert.equal(first.editor.focusCount, 1);
  for (const change of ['bytes', 'doc', 'load', 'epoch', 'request', 'baseline', 'version', 'busy', 'path', 'activePath', 'mode']) {
    const h = fixture(), result = await h.locate(await h.source());
    if (change === 'bytes') h.setContent(original + ' ');
    if (change === 'doc') h.setDoc({ ...h.doc() });
    if (change === 'load') h.context.editorLoadToken++;
    if (change === 'epoch') h.context.scenePreviewDraftEpoch++;
    if (change === 'request') h.context.sourceNavigationToken++;
    if (change === 'baseline') h.context.editSessionBaselineContent += ' ';
    if (change === 'version') h.context.editSessionVersion = 'reloaded';
    if (change === 'busy') h.setBusy(true);
    if (change === 'path') h.state.activeEditSource = 'documents/other.json';
    if (change === 'activePath') h.state.activeEditPath = 'other';
    if (change === 'mode') h.state.editInputMode = 'fields';
    assert.equal(result.focus(), false, change); assert.equal(h.editor.focusCount, 0);
  }
});

test('new source-navigation requests supersede waiting requests even when the source bytes are identical', async () => {
  const h = fixture(), snapshot = await h.source(); h.block(); const older = h.locate(snapshot);
  await Promise.resolve(); const newer = h.locate(snapshot, { instanceId: sample.objects[1].instanceId });
  h.release(); assert.equal(await older, false); const receipt = await newer; assert.equal(receipt.located, true);
  assert.deepEqual(JSON.parse(h.editor.value.slice(h.editor.selectionStart, h.editor.selectionEnd)), sample.objects[1]);
});

test('ineligible active editor never grants selection or source write capability', async () => {
  for (const change of [h => h.setEditable(false), h => h.setBusy(true), h => { h.state.activeEditPath = 'other'; }, h => { h.state.editInputMode = 'fields'; },
    h => { h.state.isCreating = true; }, h => { h.state.activeEditSource = 'documents/scene.md'; }]) {
    const h = fixture(), snapshot = await h.source(), before = selection(h); change(h);
    assert.equal(await h.locate(snapshot), false); assert.deepEqual(selection(h), before); assert.equal(h.content(), original);
  }
});

test('readonly snapshot remains strict three-field and runtime port adds only selection navigation', async () => {
  const h = fixture(); assert.deepEqual(Object.keys(await h.source()).sort(), ['content', 'sourcePath', 'token']);
  assert.match(runtime, /scene3d:\s*\{ getContext: scene3DSourceContext, getSource: getScene3DSourceSnapshot, locateSource: locateScene3DSource \}/);
  assert.doesNotMatch(source, /fetch\s*\(|\.request\s*\(|applyDraft|saveEdit|setSourceEditorContent|setEditSessionClean|refreshEditSessionDirtyState|_sourceCachedText\s*=|WebGL|buildProject/);
});

test('ordinary source input refreshes independent views through the root without changing editor selection or granting write ports', () => {
  const start = runtime.indexOf('function handleSourceInput() {'), end = runtime.indexOf('\nfunction handleCreatePathKeydown', start);
  assert.ok(start > 0 && end > start);
  assert.match(runtime, /editEditorEl\.addEventListener\('input', handleSourceInput\)/);
  const handler = runtime.slice(start, end); let inSession = true, dirty = 0, refresh = 0;
  const context = vm.createContext({ sourceIndentationController: null, sourcePositionController: null, sourceDiagnosticController: null, sourceSearchController: null, isInEditSession: () => inSession, refreshEditSessionDirtyState: () => { dirty++; },
    studioSystem: { refreshMedia: () => { refresh++; } } });
  vm.runInContext(handler + '\nthis.onInput = handleSourceInput;', context);
  context.onInput(); assert.equal(dirty, 1); assert.equal(refresh, 1);
  inSession = false; context.onInput(); assert.equal(dirty, 1); assert.equal(refresh, 1);
  inSession = true; context.studioSystem = null; context.onInput(); assert.equal(dirty, 2); assert.equal(refresh, 1);
  assert.doesNotMatch(handler, /getSource|locateSource|applyDraft|saveEdit|setSourceEditorContent|setSelectionRange|fetch|WebGL/);
});
