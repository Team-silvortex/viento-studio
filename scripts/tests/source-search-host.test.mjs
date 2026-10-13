import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { editorHarness } from './editor-harness.mjs';
import { planSourceReplacement } from '../../engine/source-search.mjs';

const applyNativeResult = (h, query, replacement, all = true) => {
  const plan = planSourceReplacement({ text: h.source.value, query, replacement, matchCase: true,
    selectionStart: h.source.selectionStart ?? 0, selectionEnd: h.source.selectionEnd ?? 0, all });
  assert.equal(plan.changed, true);
  h.source.value = h.source.value.slice(0, plan.start) + plan.replacement + h.source.value.slice(plan.end);
  h.source.setSelectionRange(plan.selectionStart, plan.selectionEnd);
  h.runtime.handleSourceInput();
};

test('source search and diagnostics observe ordinary edits and reloads through independent controllers', async () => {
  const writes = [], h = await editorHarness({ writeDoc: async value => { writes.push(value); return { version: '2' }; } });
  h.begin('one one\n', '1'); h.runtime.__refreshes = [];
  vm.runInContext('sourceSearchController={refresh(){__refreshes.push("search")}};sourceDiagnosticController={refresh(){__refreshes.push("diagnostic")}};', h.runtime);
  const token = h.runtime.sourceEditorContext().sourceToken;
  applyNativeResult(h, 'one', 'two');
  assert.deepEqual([...h.runtime.__refreshes], ['diagnostic', 'search']);
  assert.equal(h.runtime.sourceEditorContext().sourceToken, token);
  assert.equal(h.state.editHasUnsavedChanges, true); assert.deepEqual(writes, []);
  h.runtime.__refreshes = []; h.runtime.setSourceEditorContent('other source\n');
  assert.deepEqual([...h.runtime.__refreshes], ['diagnostic', 'search']);
  assert.notEqual(h.runtime.sourceEditorContext().sourceToken, token);
});

test('literal replacements remain a normal draft and save only the current source with BOM and CRLF', async () => {
  const writes = [], h = await editorHarness({ writeDoc: async value => { writes.push(value); return { version: '2' }; } });
  // This host test isolates ordinary persistence; real catalogue rebuilding is covered in Chrome.
  h.runtime.rebuildIndexForDoc = async () => {};
  const original = '\ufeffextends Node\r\n# 雪😀 one\r\nvar value = "one"\r\n';
  h.begin(original, '1'); const token = h.runtime.sourceEditorContext().sourceToken;
  applyNativeResult(h, 'one', '$&\\literal');
  const expected = original.replaceAll('one', () => '$&\\literal');
  assert.equal(h.runtime.getCurrentEditContent(), expected);
  assert.equal(h.runtime.sourceEditorContext().sourceToken, token);
  assert.equal(h.state.editHasUnsavedChanges, true); assert.equal(writes.length, 0);
  await h.runtime.saveCurrentDoc();
  assert.equal(writes.length, 1); assert.equal(writes[0].content, expected);
  assert.equal(h.state.editHasUnsavedChanges, false);
});

test('native undo input restoring source clears dirty state without implicit persistence', async () => {
  const writes = [], h = await editorHarness({ writeDoc: async value => { writes.push(value); return { version: '2' }; } });
  const original = '\ufeffone\r\none\r\n'; h.begin(original, '1');
  const token = h.runtime.sourceEditorContext().sourceToken;
  applyNativeResult(h, 'one', 'changed'); assert.equal(h.state.editHasUnsavedChanges, true);
  h.source.value = original; h.runtime.handleSourceInput();
  assert.equal(h.runtime.getCurrentEditContent(), original);
  assert.equal(h.state.editHasUnsavedChanges, false);
  assert.equal(h.runtime.sourceEditorContext().sourceToken, token); assert.deepEqual(writes, []);
});

test('a save conflict preserves replaced text and draft state for the ordinary conflict workflow', async () => {
  const writes = [], h = await editorHarness({ writeDoc: async value => { writes.push(value); throw new Error('conflict'); } });
  h.runtime.logRuntimeErrorOrMessage = (_label, error) => error.message;
  h.begin('one\ntwo\n', '1'); applyNativeResult(h, 'one', 'new source');
  const before = h.runtime.getCurrentEditContent(); await h.runtime.saveCurrentDoc();
  assert.equal(writes.length, 1); assert.equal(h.runtime.getCurrentEditContent(), before);
  assert.equal(h.state.editHasUnsavedChanges, true);
});
