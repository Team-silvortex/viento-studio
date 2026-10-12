import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { createHash, webcrypto } from 'node:crypto';
import { createScene3DTransformProposal, prepareScene3DTransformApply, isScene3DTransformProposal } from '../../engine/scene3d-transform.mjs';

const source = await fs.readFile(new URL('../../web/modules/app-runtime.js', import.meta.url), 'utf8');
const original = '\ufeff' + (await fs.readFile(new URL('../../examples/scene3d/scene.json', import.meta.url), 'utf8')).replaceAll('\n', '\r\n');
const id = JSON.parse(original.slice(1)).objects[0].instanceId;
const revision = value => `sha256:${createHash('sha256').update(value).digest('hex')}`;
const error = value => value?.errorCode === 'scene3d_transform_conflict';
const readonly = source.slice(source.indexOf('let scene3DSourceReadEpoch'), source.indexOf('\nasync function applySceneCompositionOverrideDraft'));
const host = source.slice(source.indexOf('let scene3DTransformReadEpoch'), source.indexOf('\nasync function applySceneSourceLayoutDraft'));

function fixture() {
  let content = original, busy = false, editable = true, doc = { path: 'scene', _sourceCachedText: original }, digestCount = 0, gateAt = 0, release;
  const state = { isEditing: true, isCreating: false, editInputMode: 'source', activeEditPath: 'scene', activeEditSource: 'documents/scene.json', editHasUnsavedChanges: false };
  const editor = { value: original, selectionStart: 17, selectionEnd: 27, scrollTop: 73, focusCount: 0,
    setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; }, focus() { this.focusCount++; } };
  const statuses = [], context = vm.createContext({ state, editorLoadToken: 3, scenePreviewDraftEpoch: 7, TextEncoder,
    editSessionBaselineContent: original, editSessionVersion: revision(original), editEditorEl: editor,
    isScene3DTransformProposal, prepareScene3DTransformApply,
    getActiveDoc: () => doc, isEditModeActive: () => editable, isEditorBusy: () => busy, canonicalizeSourcePath: value => value || '', getCurrentEditContent: () => content,
    setSourceEditorContent(value) { content = value; editor.value = value; },
    refreshEditSessionDirtyState() { state.editHasUnsavedChanges = content !== context.editSessionBaselineContent; context.scenePreviewDraftEpoch++; },
    refreshEditButtons() {}, t: value => value, setEditorStatus: value => statuses.push(value),
    crypto: { subtle: { async digest(algorithm, value) { const n = ++digestCount; if (n === gateAt) await new Promise(resolve => { release = resolve; }); return webcrypto.subtle.digest(algorithm, value); } } },
  });
  vm.runInContext(readonly + '\n' + host, context);
  return { context, state, editor, statuses, source: () => context.getScene3DTransformSourceSnapshot(), flags: () => context.scene3DTransformSourceContext(),
    apply: (p, guard) => context.applyScene3DTransformDraft(p, guard), content: () => content, doc: () => doc,
    setContent: value => { content = value; editor.value = value; }, setBusy: value => { busy = value; }, setEditable: value => { editable = value; },
    setDoc: value => { doc = value; }, blockNext: (offset = 1) => { gateAt = digestCount + offset; },
    waitBlocked: async () => { for (let n = 0; n < 50 && !release; n++) await new Promise(resolve => setTimeout(resolve, 2)); assert.equal(typeof release, 'function'); },
    release: () => release() };
}
const review = async h => createScene3DTransformProposal(await h.source(), { instanceId: id, values: { position: [3, 4, 5] } });

test('actual source host returns only five captured identity/source/revision values, leaving old preview exactly readonly', async () => {
  const h = fixture(), snapshot = await h.source();
  assert.deepEqual(Object.keys(snapshot).sort(), ['baseSourceRevision', 'content', 'sourcePath', 'sourceRevision', 'token']);
  assert.equal(snapshot.content, original); assert.equal(snapshot.baseSourceRevision, revision(original));
  assert.deepEqual(Object.keys(await h.context.getScene3DSourceSnapshot()).sort(), ['content', 'sourcePath', 'token']);
  assert.deepEqual(Object.keys(h.flags()).sort(), ['busy', 'creating', 'editable', 'sourceJSON', 'sourcePath', 'sourceToken']);
});
test('actual apply changes only in-memory draft, retains saved baseline/cache/version, selection and scroll', async () => {
  const h = fixture(), p = await review(h), beforeToken = h.flags().sourceToken;
  const receipt = await h.apply(p); assert.equal(receipt.applied, true); assert.equal(h.content(), p.afterContent);
  assert.equal(receipt.content, p.afterContent); assert.equal(receipt.sourcePath, p.sourcePath); assert.notEqual(receipt.sourceToken, beforeToken);
  assert.equal(receipt.sourceToken, h.flags().sourceToken); assert.equal(h.state.editHasUnsavedChanges, true);
  assert.equal(h.context.editSessionBaselineContent, original); assert.equal(h.context.editSessionVersion, revision(original)); assert.equal(h.doc()._sourceCachedText, original);
  assert.equal(h.editor.selectionStart, 17); assert.equal(h.editor.selectionEnd, 27); assert.equal(h.editor.scrollTop, 73);
  assert.match(h.statuses.at(-1), /尚未保存/); receipt.focus(); assert.equal(h.editor.focusCount, 1);
  h.setContent(p.afterContent + ' '); receipt.focus(); assert.equal(h.editor.focusCount, 1);
});
test('clone/getter/previously applied proposal cannot replay through the host', async () => {
  const h = fixture(), p = await review(h); let reads = 0;
  const getter = Object.defineProperty({}, 'sourcePath', { get() { reads++; throw Error('getter'); } });
  for (const value of [structuredClone(p), getter]) await assert.rejects(h.apply(value), error);
  assert.equal(reads, 0); assert.equal(h.content(), original); await h.apply(p); await assert.rejects(h.apply(p), error); assert.equal(h.content(), p.afterContent);
});
test('wrong saved baseline SHA cannot be reviewed or applied', async () => {
  const h = fixture(), p = await review(h); h.context.editSessionVersion = `sha256:${'0'.repeat(64)}`;
  assert.equal(await h.source(), null); await assert.rejects(h.apply(p), error); assert.equal(h.content(), original);
});
test('closing or editing while apply is waiting cannot update a draft at any of its three digest boundaries', async () => {
  for (const boundary of [1, 2, 3]) for (const change of ['cancel', 'bytes', 'doc', 'load', 'baseline', 'version', 'busy', 'mode', 'path']) {
    const h = fixture(), p = await review(h); let current = true; h.blockNext(boundary); const pending = h.apply(p, { isCurrent: () => current }); await h.waitBlocked();
    if (change === 'cancel') current = false;
    if (change === 'bytes') h.setContent(original + ' ');
    if (change === 'doc') h.setDoc({ ...h.doc() });
    if (change === 'load') h.context.editorLoadToken++;
    if (change === 'baseline') h.context.editSessionBaselineContent += ' ';
    if (change === 'version') h.context.editSessionVersion = 'external-version';
    if (change === 'busy') h.setBusy(true);
    if (change === 'mode') h.state.editInputMode = 'fields';
    if (change === 'path') h.state.activeEditSource = 'documents/other.json';
    const before = h.content(); h.release(); await assert.rejects(pending, error); assert.equal(h.content(), before, `${boundary}/${change}`);
    assert.equal(h.doc()._sourceCachedText, original); assert.equal(h.state.editHasUnsavedChanges, false);
  }
});
test('source snapshot is invalidated by navigation or silent raw edits during either SHA wait', async () => {
  for (const boundary of [1, 2]) {
    const h = fixture(); h.blockNext(boundary); const pending = h.source(); await h.waitBlocked(); h.setContent(original + '\r\n'); h.release();
    assert.equal(await pending, null); assert.equal(h.context.scenePreviewDraftEpoch, 7);
  }
});
test('same-path document replacement and leaving/reopening the raw editor invalidate a previous review', async () => {
  for (const change of [h => h.setDoc({ ...h.doc() }), h => { h.state.editInputMode = 'fields'; h.flags(); h.state.editInputMode = 'source'; }]) {
    const h = fixture(), p = await review(h); change(h); await assert.rejects(h.apply(p), error); assert.equal(h.content(), original);
  }
});
test('unsaved raw content is independently hashed from its saved baseline', async () => {
  const h = fixture(), unsaved = original + ' '; h.setContent(unsaved); const s = await h.source();
  assert.equal(s.baseSourceRevision, revision(original)); assert.equal(s.sourceRevision, revision(unsaved));
  const p = createScene3DTransformProposal(s, { instanceId: id, values: { size: [4, 5, 6] } }); await h.apply(p);
  assert.equal(h.context.editSessionBaselineContent, original); assert.equal(h.doc()._sourceCachedText, original); assert.ok(h.content().endsWith(' '));
});
test('creation, nonJSON, non-source modes, busy and wrong editor identity cannot offer authoring authority', async () => {
  for (const change of [h => { h.state.isCreating = true; }, h => { h.state.isEditing = false; }, h => { h.state.editInputMode = 'fields'; },
    h => { h.state.activeEditPath = 'different'; }, h => { h.state.activeEditSource = 'documents/scene.md'; }, h => h.setBusy(true), h => h.setEditable(false)]) {
    const h = fixture(); change(h); assert.equal(await h.source(), null);
  }
});
test('3D authoring host calls no Save, filesystem, HTTP, World, renderer or backend authority', () => {
  assert.doesNotMatch(host, /fetch\s*\(|\.request\s*\(|saveEdit|setEditSessionClean|_sourceCachedText\s*=|WebGL|buildProject|applySceneComposition/);
  assert.match(source, /scene3dTransforms:\s*\{ getContext: scene3DTransformSourceContext, getSource: getScene3DTransformSourceSnapshot, applyDraft: applyScene3DTransformDraft \}/);
});
