import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { createHash, webcrypto } from 'node:crypto';
import { createScene3DEnvironmentProposal, isScene3DEnvironmentProposal, prepareScene3DEnvironmentApply } from '../../engine/scene3d-environment.mjs';
import { createScene3DObjectsProposal, isScene3DObjectsProposal, prepareScene3DObjectsApply } from '../../engine/scene3d-objects.mjs';
import { createScene3DTransformProposal, isScene3DTransformProposal, prepareScene3DTransformApply } from '../../engine/scene3d-transform.mjs';

// Execute the actual runtime reader and shared application functions. Only the
// editor storage, scheduling and UI effects are supplied by this bounded host.
const runtime = await fs.readFile(new URL('../../web/modules/app-runtime.js', import.meta.url), 'utf8');
const original = '\ufeff' + (await fs.readFile(new URL('../../examples/scene3d/scene.json', import.meta.url), 'utf8')).replaceAll('\n', '\r\n');
const sourceModel = JSON.parse(original.slice(1));
const instanceId = sourceModel.objects[0].instanceId;
const revision = value => `sha256:${createHash('sha256').update(value).digest('hex')}`;
const readonly = runtime.slice(runtime.indexOf('let scene3DSourceReadEpoch'), runtime.indexOf('\nasync function applySceneCompositionOverrideDraft'));
const host = runtime.slice(runtime.indexOf('let scene3DTransformReadEpoch'), runtime.indexOf('\nasync function applySceneSourceLayoutDraft'));
assert.ok(readonly.length > 100 && host.length > 100, 'the actual runtime source boundaries must exist');
const conflict = value => value?.errorCode === 'scene3d_environment_conflict';

function fixture() {
  let content = original, busy = false, editable = true, doc = { path: 'scene', _sourceCachedText: original };
  let digestCount = 0, gateAt = 0, release;
  const state = { isEditing: true, isCreating: false, editInputMode: 'source', activeEditPath: 'scene',
    activeEditSource: 'documents/scene.json', editHasUnsavedChanges: false };
  const editor = { value: original, selectionStart: 17, selectionEnd: 27, scrollTop: 73, focusCount: 0,
    setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; }, focus() { this.focusCount++; } };
  const statuses = [], context = vm.createContext({ state, editorLoadToken: 3, scenePreviewDraftEpoch: 7, TextEncoder,
    editSessionBaselineContent: original, editSessionVersion: revision(original), editEditorEl: editor,
    isScene3DEnvironmentProposal, prepareScene3DEnvironmentApply,
    isScene3DTransformProposal, prepareScene3DTransformApply, isScene3DObjectsProposal, prepareScene3DObjectsApply,
    getActiveDoc: () => doc, isEditModeActive: () => editable, isEditorBusy: () => busy,
    canonicalizeSourcePath: value => value || '', getCurrentEditContent: () => content,
    setSourceEditorContent(value) { content = value; editor.value = value; },
    refreshEditSessionDirtyState() { state.editHasUnsavedChanges = content !== context.editSessionBaselineContent; context.scenePreviewDraftEpoch++; },
    refreshEditButtons() {}, t: value => value, setEditorStatus: value => statuses.push(value),
    crypto: { subtle: { async digest(algorithm, bytes) {
      if (++digestCount === gateAt) await new Promise(resolve => { release = resolve; });
      return webcrypto.subtle.digest(algorithm, bytes);
    } } },
  });
  vm.runInContext(readonly + '\n' + host, context);
  return { context, state, editor, statuses,
    source: () => context.getScene3DTransformSourceSnapshot(), flags: () => context.scene3DTransformSourceContext(),
    apply: (proposal, guard) => context.applyScene3DEnvironmentDraft(proposal, guard), content: () => content, doc: () => doc,
    setContent(value) { content = value; editor.value = value; }, setBusy: value => { busy = value; },
    setEditable: value => { editable = value; }, setDoc: value => { doc = value; },
    blockNext(offset = 1) { gateAt = digestCount + offset; release = undefined; },
    async waitBlocked() {
      for (let n = 0; n < 100 && !release; n++) await new Promise(resolve => setTimeout(resolve, 2));
      assert.equal(typeof release, 'function', 'the requested real digest boundary was reached');
    }, release: () => release() };
}

const values = { background: '#ABCDEF', camera: { position: [11, 7, 9], target: [1, 2, 1], fovDegrees: 72, near: 0.1, far: 1500 },
  light: { direction: [-2, -4, -1], color: '#FedCBA', energy: 0 } };
const review = async (h, next = values) => createScene3DEnvironmentProposal(await h.source(), { values: next });
const proposals = source => ({
  environment: createScene3DEnvironmentProposal(source, { values }),
  transforms: createScene3DTransformProposal(source, { instanceId, values: { position: [3, 4, 5] } }),
  objects: createScene3DObjectsProposal(source, { action: 'copy', instanceId,
    newInstanceId: 'aaaaaaaa-1111-4111-8111-111111111111', name: 'Independent copy' }),
});
const apply = (h, kind, proposal) => kind === 'environment' ? h.apply(proposal)
  : kind === 'transforms' ? h.context.applyScene3DTransformDraft(proposal) : h.context.applyScene3DObjectsDraft(proposal);
const errorCode = kind => `scene3d_${kind === 'transforms' ? 'transform' : kind}_conflict`;

test('environment source admission preserves the five-field author snapshot and three-field readonly preview', async () => {
  const h = fixture(), source = await h.source(), read = await h.context.getScene3DSourceSnapshot();
  assert.deepEqual(Object.keys(source).sort(), ['baseSourceRevision', 'content', 'sourcePath', 'sourceRevision', 'token']);
  assert.deepEqual(Object.keys(read).sort(), ['content', 'sourcePath', 'token']);
  assert.equal(source.content, original); assert.equal(read.content, original);
  assert.equal(source.baseSourceRevision, revision(original)); assert.equal(source.sourceRevision, revision(original));
  assert.equal(source.sourcePath, 'documents/scene.json'); assert.notEqual(source.token, read.token);
});

test('combined environment apply updates only unsaved source and guards the exact completion owner', async () => {
  const h = fixture(), p = await review(h), owner = h.flags().sourceToken, receipt = await h.apply(p);
  assert.deepEqual(Object.keys(receipt).sort(), ['applied', 'content', 'focus', 'sourcePath', 'sourceToken']);
  assert.equal(receipt.applied, true); assert.equal(receipt.content, p.afterContent); assert.equal(receipt.sourcePath, p.sourcePath);
  assert.notEqual(receipt.sourceToken, owner); assert.equal(receipt.sourceToken, h.flags().sourceToken);
  assert.equal(h.content(), p.afterContent); assert.equal(h.state.editHasUnsavedChanges, true);
  assert.equal(h.context.editSessionBaselineContent, original); assert.equal(h.context.editSessionVersion, revision(original));
  assert.equal(h.doc()._sourceCachedText, original); assert.equal(h.editor.selectionStart, 17);
  assert.equal(h.editor.selectionEnd, 27); assert.equal(h.editor.scrollTop, 73);
  const after = JSON.parse(h.content().slice(1)); assert.deepEqual(after.objects, sourceModel.objects);
  assert.deepEqual(after.viewport, sourceModel.viewport); assert.equal(after.name, sourceModel.name);
  assert.equal(after.light.energy, 0); assert.equal(after.background, '#ABCDEF');
  receipt.focus(); assert.equal(h.editor.focusCount, 1);
  h.setContent(p.afterContent + ' '); receipt.focus(); assert.equal(h.editor.focusCount, 1);
});

test('all three private brands are pairwise isolated and cloned receipts never grant source authority', async () => {
  const h = fixture(), p = proposals(await h.source());
  for (const destination of Object.keys(p)) for (const origin of Object.keys(p)) if (destination !== origin) {
    await assert.rejects(apply(h, destination, p[origin]), e => e.errorCode === errorCode(destination));
  }
  for (const clone of [structuredClone(p.environment), { ...p.environment }, JSON.parse(JSON.stringify(p.environment))]) {
    await assert.rejects(h.apply(clone), conflict);
  }
  assert.equal(h.content(), original); assert.equal(h.state.editHasUnsavedChanges, false);
  await h.apply(p.environment); assert.equal(h.content(), p.environment.afterContent);
});

test('environment and each existing authoring domain mutually revoke already-reviewed old source intents', async () => {
  for (const first of ['environment', 'transforms', 'objects']) for (const second of ['environment', 'transforms', 'objects']) if (first !== second) {
    const h = fixture(), p = proposals(await h.source()); await apply(h, first, p[first]);
    await assert.rejects(apply(h, second, p[second]), e => e.errorCode === errorCode(second));
    assert.equal(h.content(), p[first].afterContent); assert.equal(h.doc()._sourceCachedText, original);
  }
});

test('cancel, content/path/owner replacement and editor session changes reject at all three real digest awaits', async () => {
  for (const boundary of [1, 2, 3]) for (const change of ['cancel', 'bytes', 'doc', 'load', 'baseline', 'version', 'epoch', 'path', 'busy', 'editable']) {
    const h = fixture(), p = await review(h); let current = true;
    h.blockNext(boundary); const pending = h.apply(p, { isCurrent: () => current }); await h.waitBlocked();
    if (change === 'cancel') current = false;
    if (change === 'bytes') h.setContent(original + ' ');
    if (change === 'doc') h.setDoc({ ...h.doc() });
    if (change === 'load') h.context.editorLoadToken++;
    if (change === 'baseline') h.context.editSessionBaselineContent += ' ';
    if (change === 'version') h.context.editSessionVersion = revision(original + '\t');
    if (change === 'epoch') h.context.scenePreviewDraftEpoch++;
    if (change === 'path') h.state.activeEditSource = 'documents/other.json';
    if (change === 'busy') h.setBusy(true);
    if (change === 'editable') h.setEditable(false);
    const before = h.content(); h.release(); await assert.rejects(pending, conflict);
    assert.equal(h.content(), before, `${change} at digest ${boundary}`);
    assert.equal(h.doc()._sourceCachedText, original); assert.equal(h.statuses.length, 0);
  }
});

test('reader captures the exact current and saved bytes and refuses changed owner during either digest', async () => {
  for (const boundary of [1, 2]) for (const change of ['doc', 'load', 'bytes', 'version', 'busy', 'path']) {
    const h = fixture(); h.blockNext(boundary); const pending = h.source(); await h.waitBlocked();
    if (change === 'doc') h.setDoc({ ...h.doc() });
    if (change === 'load') h.context.editorLoadToken++;
    if (change === 'bytes') h.setContent(original + ' ');
    if (change === 'version') h.context.editSessionVersion = revision(original + ' ');
    if (change === 'busy') h.setBusy(true);
    if (change === 'path') h.state.activeEditSource = 'documents/other.json';
    h.release(); assert.equal(await pending, null, `${change} at reader digest ${boundary}`);
  }
  const h = fixture(); h.setContent(original + ' '); const s = await h.source();
  assert.equal(s.baseSourceRevision, revision(original)); assert.equal(s.sourceRevision, revision(original + ' '));
  const p = createScene3DEnvironmentProposal(s, { values }); await h.apply(p);
  assert.ok(h.content().endsWith(' ')); assert.equal(h.context.editSessionBaselineContent, original);
});

test('replay cannot apply and restoring original environment produces a clean draft without changing saved state', async () => {
  const h = fixture(), p = await review(h); await h.apply(p); await assert.rejects(h.apply(p), conflict);
  const back = await review(h, { background: sourceModel.background, camera: sourceModel.camera, light: sourceModel.light });
  const receipt = await h.apply(back);
  assert.equal(h.content(), original); assert.equal(h.state.editHasUnsavedChanges, false); assert.equal(receipt.content, original);
  assert.equal(h.context.editSessionBaselineContent, original); assert.equal(h.context.editSessionVersion, revision(original));
  assert.equal(h.doc()._sourceCachedText, original); assert.match(h.statuses.at(-1), /已保存版本一致/);
  const other = fixture(); other.context.editSessionVersion = `sha256:${'0'.repeat(64)}`; assert.equal(await other.source(), null);
});

test('environment wrapper and shared source application cannot save, fetch, render or execute a backend', () => {
  assert.doesNotMatch(host, /fetch\s*\(|\.request\s*\(|saveEdit|setEditSessionClean|_sourceCachedText\s*=|WebGL|buildProject|applySceneComposition/);
  assert.match(runtime, /scene3dEnvironment:\s*\{ getContext: scene3DTransformSourceContext, getSource: getScene3DTransformSourceSnapshot, applyDraft: applyScene3DEnvironmentDraft \}/);
  assert.match(runtime, /scene3d:\s*\{ getContext: scene3DSourceContext, getSource: getScene3DSourceSnapshot, locateSource: locateScene3DSource \}/);
});
