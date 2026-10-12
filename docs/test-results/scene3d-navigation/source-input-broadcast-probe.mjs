import '../../../scripts/adapters/node-studio-core.mjs';
import { createScene3DSourceLocation, scene3DSourceDisplaySelection } from '../../../engine/scene3d-navigation.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { createHash } from 'node:crypto';

const root = new URL('../../../', import.meta.url), out = new URL('./', import.meta.url);
const runtime = await fs.readFile(new URL('web/modules/app-runtime.js', root), 'utf8');
const source = await fs.readFile(new URL('examples/scene3d/scene.json', root), 'utf8');
const id = JSON.parse(source).objects[0].instanceId;
const sha = value => createHash('sha256').update(value).digest('hex');
const normalize = value => value.replace(/\r\n|\r/g, '\n');
const host = runtime.slice(runtime.indexOf('let scene3DSourceReadEpoch'), runtime.indexOf('\nasync function applySceneCompositionOverrideDraft'));
const dirty = runtime.slice(runtime.indexOf('function refreshEditSessionDirtyState()'), runtime.indexOf('\nfunction captureEditorDraft()'));
const start = runtime.indexOf('    const onSourceInput = () => {');
const handler = runtime.slice(start, runtime.indexOf("    editEditorEl.addEventListener('input', onSourceInput);", start));
assert.ok(start > 0 && handler.includes('studioSystem?.refreshMedia()'));
assert.ok(!/applyDraft|locateScene3DSource|saveCurrentDoc|setSourceEditorContent|setSelectionRange|scene3DPreviewController/.test(handler));

const cases = [];
async function run(name, callback) { await callback(); cases.push({ name, ok: true }); }
function fixture(withSystem = true) {
  let content = '\ufeff' + source.replaceAll('\n', '\r\n');
  const baseline = content, doc = { path: 'scene', _sourceCachedText: baseline };
  const editor = { value: normalize(content), selectionStart: 2, selectionEnd: 4, scrollTop: 19, clientHeight: 200,
    setSelectionRange(a, b) { this.selectionStart = a; this.selectionEnd = b; }, focus() {}, scrollIntoView() {} };
  const state = { isEditing: true, isCreating: false, editInputMode: 'source', activeEditPath: 'scene',
    activeEditSource: 'documents/scene.json', editHasUnsavedChanges: false };
  const observed = [], statuses = [];
  const context = vm.createContext({ state, editorLoadToken: 3, scenePreviewDraftEpoch: 7, scenePreviewDraftState: [],
    sourceNavigationToken: 0, editSessionBaselineContent: baseline, editSessionVersion: 'saved-version', editEditorEl: editor,
    createScene3DSourceLocation, scene3DSourceDisplaySelection, getActiveDoc: () => doc,
    isEditModeActive: () => true, isEditorBusy: () => false, isInEditSession: () => state.isEditing,
    canonicalizeSourcePath: x => x, getCurrentEditContent: () => content, getCurrentEditDraftContent: () => content,
    editDirtyIndicatorEl: null, editSaveBtnEl: null, editMetricsEl: null, draftObserver: null,
    setEditorStatus: value => statuses.push(value), t: value => value, getComputedStyle: () => ({ lineHeight: '20px' }),
    studioSystem: null });
  vm.runInContext(host + '\n' + dirty + '\n' + handler + '\nglobalThis.input = onSourceInput;', context);
  context.refreshEditSessionDirtyState();
  if (withSystem) context.studioSystem = { refreshMedia() { observed.push({ dirty: state.editHasUnsavedChanges,
    token: context.scene3DSourceContext().sourceToken, content, selection: [editor.selectionStart, editor.selectionEnd],
    baseline: context.editSessionBaselineContent, version: context.editSessionVersion }); } };
  return { context, state, editor, doc, observed, statuses, baseline, content: () => content,
    change(raw) { content = raw; editor.value = normalize(raw); }, read: () => context.getScene3DSourceSnapshot() };
}

await run('actual input broadcasts only after the actual dirty/epoch update and grants no source writer', async () => {
  const h = fixture(), old = await h.read(), data = JSON.parse(source); data.objects[0].name = 'Edited 🦊';
  const current = '\ufeff' + JSON.stringify(data, null, 2).replaceAll('\n', '\r\n'); h.change(current); h.context.input();
  assert.equal(h.observed.length, 1); assert.equal(h.observed[0].dirty, true); assert.notEqual(h.observed[0].token, old.token);
  assert.equal(h.observed[0].content, current); assert.deepEqual(h.observed[0].selection, [2, 4]);
  assert.equal(h.observed[0].baseline, h.baseline); assert.equal(h.observed[0].version, 'saved-version');
  assert.equal(h.doc._sourceCachedText, h.baseline); assert.equal(h.content(), current);
  assert.equal(await h.context.locateScene3DSource(old, { instanceId: id }), false);
  assert.deepEqual([h.editor.selectionStart, h.editor.selectionEnd, h.editor.scrollTop], [2, 4, 19]);
  const fresh = await h.read(), located = await h.context.locateScene3DSource(fresh, { instanceId: id });
  assert.equal(located.located, true); assert.equal(h.content(), current); assert.equal(h.doc._sourceCachedText, h.baseline);
});
await run('restoring baseline broadcasts clean current owner without saving and inactive input does not broadcast', async () => {
  const h = fixture(); h.change(h.baseline + ' '); h.context.input(); h.change(h.baseline); h.context.input();
  assert.deepEqual(h.observed.map(x => x.dirty), [true, false]); assert.notEqual(h.observed[0].token, h.observed[1].token);
  assert.equal(h.context.editSessionBaselineContent, h.baseline); assert.equal(h.context.editSessionVersion, 'saved-version');
  h.state.isEditing = false; const epoch = h.context.scenePreviewDraftEpoch; h.context.input();
  assert.equal(h.observed.length, 2); assert.equal(h.context.scenePreviewDraftEpoch, epoch); assert.equal(h.statuses.length, 0);
});
await run('boot without optional composition root still updates dirty state without throwing', () => {
  const h = fixture(false); h.change(h.baseline + ' '); assert.doesNotThrow(() => h.context.input());
  assert.equal(h.state.editHasUnsavedChanges, true); assert.equal(h.observed.length, 0);
  assert.equal(h.doc._sourceCachedText, h.baseline); assert.deepEqual([h.editor.selectionStart, h.editor.selectionEnd], [2, 4]);
});
const map = JSON.parse(await fs.readFile(new URL('source-hashes-confirmed.json', out), 'utf8'));
assert.equal(sha(runtime), map['web/modules/app-runtime.js']);
const report = { format: 'viento-scene3d-navigation-source-input-quality', schemaVersion: 1, observedAt: new Date().toISOString(),
  ok: true, node: process.version, passed: cases.length, failed: 0, cases,
  sourceSha256: sha(runtime), confirmedManifestSha256: sha(await fs.readFile(new URL('source-hashes-confirmed.json', out))),
  scope: 'Actual runtime input handler, dirty/epoch update, readonly snapshot and native-WASM selection host with simulated editor storage and a composition-root observer. Checks notification ordering and normal ownership without source writes, Save, browser, GPU or device claims.' };
const bytes = JSON.stringify(report, null, 2) + '\n';
await fs.writeFile(new URL('source-input-broadcast.json', out), bytes, { flag: 'wx' });
console.log(JSON.stringify({ ok: true, passed: cases.length, report: 'source-input-broadcast.json', sha256: sha(bytes) }));
