import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { createHash, webcrypto } from 'node:crypto';
import { createScene3DTranslationProposal, isScene3DTranslationProposal, prepareScene3DTranslationApply } from '../../engine/scene3d-translation.mjs';
import { createScene3DPropertiesProposal, isScene3DPropertiesProposal, prepareScene3DPropertiesApply } from '../../engine/scene3d-properties.mjs';
import { createScene3DEnvironmentProposal, isScene3DEnvironmentProposal, prepareScene3DEnvironmentApply } from '../../engine/scene3d-environment.mjs';
import { createScene3DObjectsProposal, isScene3DObjectsProposal, prepareScene3DObjectsApply } from '../../engine/scene3d-objects.mjs';
import { createScene3DTransformProposal, isScene3DTransformProposal, prepareScene3DTransformApply } from '../../engine/scene3d-transform.mjs';

// Run the real runtime reader and application functions with real native-backed
// authoring domains. This fixture supplies editor storage and digest scheduling.
const runtime = await fs.readFile(new URL('../../web/modules/app-runtime.js', import.meta.url), 'utf8');
const original = '\ufeff' + (await fs.readFile(new URL('../../examples/scene3d/scene.json', import.meta.url), 'utf8')).replaceAll('\n', '\r\n');
const sourceModel = JSON.parse(original.slice(1)), instanceId = sourceModel.objects[0].instanceId;
const revision = value => `sha256:${createHash('sha256').update(value).digest('hex')}`;
const readonly = runtime.slice(runtime.indexOf('let scene3DSourceReadEpoch'), runtime.indexOf('\nasync function applySceneCompositionOverrideDraft'));
const host = runtime.slice(runtime.indexOf('let scene3DTransformReadEpoch'), runtime.indexOf('\nasync function applySceneSourceLayoutDraft'));
assert.ok(readonly.length > 100 && host.length > 100, 'the actual runtime source boundaries must exist');
const conflict = value => value?.errorCode === 'scene3d_translation_conflict';

function fixture() {
  let content = original, busy = false, editable = true, doc = { path: 'scene', _sourceCachedText: original };
  let digestCount = 0, gateAt = 0, release;
  const state = { isEditing: true, isCreating: false, editInputMode: 'source', activeEditPath: 'scene',
    activeEditSource: 'documents/scene.json', editHasUnsavedChanges: false };
  const editor = { value: original, selectionStart: 17, selectionEnd: 27, scrollTop: 73, focusCount: 0,
    setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; }, focus() { this.focusCount++; } };
  const statuses = [], context = vm.createContext({ state, editorLoadToken: 3, scenePreviewDraftEpoch: 7, TextEncoder,
    editSessionBaselineContent: original, editSessionVersion: revision(original), editEditorEl: editor,
    isScene3DTranslationProposal, prepareScene3DTranslationApply, isScene3DPropertiesProposal, prepareScene3DPropertiesApply, isScene3DEnvironmentProposal, prepareScene3DEnvironmentApply,
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
    apply: (proposal, guard) => context.applyScene3DTranslationDraft(proposal, guard), content: () => content, doc: () => doc,
    setContent(value) { content = value; editor.value = value; }, setBusy: value => { busy = value; },
    setEditable: value => { editable = value; }, setDoc: value => { doc = value; },
    blockNext(offset = 1) { gateAt = digestCount + offset; release = undefined; },
    async waitBlocked() {
      for (let n = 0; n < 100 && !release; n++) await new Promise(resolve => setTimeout(resolve, 2));
      assert.equal(typeof release, 'function', 'the requested real digest boundary was reached');
    }, release: () => release() };
}

const values = { name: 'Independent properties', color: '#AbCdEf' };
const instanceIds = sourceModel.objects.slice(0, 2).map(object => object.instanceId);
const offset = [3, 0, 2];
const review = async (h, next = offset) => createScene3DTranslationProposal(await h.source(), { instanceIds, offset: next });
const proposals = source => ({
  translation: createScene3DTranslationProposal(source, { instanceIds, offset }),
  properties: createScene3DPropertiesProposal(source, { instanceId, values }),
  environment: createScene3DEnvironmentProposal(source, { values: { background: '#ABCDEF', light: { energy: 0 } } }),
  transforms: createScene3DTransformProposal(source, { instanceId, values: { position: [3, 4, 5] } }),
  objects: createScene3DObjectsProposal(source, { action: 'copy', instanceId,
    newInstanceId: 'aaaaaaaa-1111-4111-8111-111111111111', name: 'Independent copy' }),
});
const wrappers = { translation: 'applyScene3DTranslationDraft', properties: 'applyScene3DPropertiesDraft', environment: 'applyScene3DEnvironmentDraft',
  transforms: 'applyScene3DTransformDraft', objects: 'applyScene3DObjectsDraft' };
const apply = (h, kind, proposal) => h.context[wrappers[kind]](proposal);
const errorCode = kind => `scene3d_${kind === 'transforms' ? 'transform' : kind}_conflict`;

test('translation uses the same five-field author snapshot while readonly preview retains exactly three fields', async () => {
  const h = fixture(), source = await h.source(), read = await h.context.getScene3DSourceSnapshot();
  assert.deepEqual(Object.keys(source).sort(), ['baseSourceRevision', 'content', 'sourcePath', 'sourceRevision', 'token']);
  assert.deepEqual(Object.keys(read).sort(), ['content', 'sourcePath', 'token']);
  assert.equal(source.content, original); assert.equal(read.content, original);
  assert.equal(source.baseSourceRevision, revision(original)); assert.equal(source.sourceRevision, revision(original));
  assert.equal(source.sourcePath, 'documents/scene.json'); assert.notEqual(source.token, read.token);
});

test('one complete translation applies only to the owned unsaved source, retaining saved state, cursor and completion identity', async () => {
  const h = fixture(), p = await review(h), owner = h.flags().sourceToken, receipt = await h.apply(p);
  assert.deepEqual(Object.keys(receipt).sort(), ['applied', 'content', 'focus', 'sourcePath', 'sourceToken']);
  assert.equal(receipt.applied, true); assert.equal(receipt.content, p.afterContent); assert.equal(receipt.sourcePath, p.sourcePath);
  assert.notEqual(receipt.sourceToken, owner); assert.equal(receipt.sourceToken, h.flags().sourceToken);
  assert.equal(h.content(), p.afterContent); assert.equal(h.state.editHasUnsavedChanges, true);
  assert.equal(h.context.editSessionBaselineContent, original); assert.equal(h.context.editSessionVersion, revision(original));
  assert.equal(h.doc()._sourceCachedText, original); assert.equal(h.editor.selectionStart, 17);
  assert.equal(h.editor.selectionEnd, 27); assert.equal(h.editor.scrollTop, 73);
  const expected = structuredClone(sourceModel); for (const object of expected.objects) if (instanceIds.includes(object.instanceId)) object.position = object.position.map((value, axis) => value + offset[axis]);
  assert.deepEqual(JSON.parse(h.content().slice(1)), expected);
  assert.equal(h.statuses.at(-1), '3D整体移动已应用到原文草稿；尚未保存。');
  receipt.focus(); assert.equal(h.editor.focusCount, 1);
  h.setDoc({ ...h.doc() }); receipt.focus(); assert.equal(h.editor.focusCount, 1);
});

test('five private proposal brands reject all twenty foreign-domain applications and all detached clones', async () => {
  const h = fixture(), p = proposals(await h.source()); let foreignPairs = 0;
  for (const destination of Object.keys(p)) for (const origin of Object.keys(p)) if (destination !== origin) {
    await assert.rejects(apply(h, destination, p[origin]), e => e.errorCode === errorCode(destination)); foreignPairs++;
  }
  assert.equal(foreignPairs, 20);
  for (const kind of Object.keys(p)) for (const clone of [structuredClone(p[kind]), { ...p[kind] }, JSON.parse(JSON.stringify(p[kind]))]) {
    await assert.rejects(apply(h, kind, clone), e => e.errorCode === errorCode(kind));
  }
  assert.equal(h.content(), original); assert.equal(h.state.editHasUnsavedChanges, false); assert.equal(h.statuses.length, 0);
  await h.apply(p.translation); assert.equal(h.content(), p.translation.afterContent);
});

test('all five source authoring domains revoke previously reviewed sibling intents without changing the save baseline', async () => {
  const kinds = ['translation', 'properties', 'environment', 'transforms', 'objects']; let pairs = 0;
  for (const first of kinds) for (const second of kinds) if (first !== second) {
    const h = fixture(), p = proposals(await h.source()); await apply(h, first, p[first]);
    await assert.rejects(apply(h, second, p[second]), e => e.errorCode === errorCode(second));
    assert.equal(h.content(), p[first].afterContent); assert.equal(h.doc()._sourceCachedText, original);
    assert.equal(h.context.editSessionBaselineContent, original); pairs++;
  }
  assert.equal(pairs, 20);
});

test('cancel and replaced editor ownership reject translation at all three actual digest awaits', async () => {
  const changes = ['cancel', 'bytes', 'doc', 'load', 'baseline', 'version', 'epoch', 'path', 'activePath', 'busy', 'editable', 'creating', 'mode'];
  for (const boundary of [1, 2, 3]) for (const change of changes) {
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
    if (change === 'activePath') h.state.activeEditPath = 'other';
    if (change === 'busy') h.setBusy(true);
    if (change === 'editable') h.setEditable(false);
    if (change === 'creating') h.state.isCreating = true;
    if (change === 'mode') h.state.editInputMode = 'fields';
    const before = h.content(); h.release(); await assert.rejects(pending, conflict);
    assert.equal(h.content(), before, `${change} at digest ${boundary}`);
    assert.equal(h.doc()._sourceCachedText, original); assert.equal(h.statuses.length, 0);
  }
});

test('author source reader refuses replacement during either digest and retains preexisting dirty bytes', async () => {
  for (const boundary of [1, 2]) for (const change of ['doc', 'load', 'bytes', 'version', 'baseline', 'busy', 'path', 'activePath', 'mode']) {
    const h = fixture(); h.blockNext(boundary); const pending = h.source(); await h.waitBlocked();
    if (change === 'doc') h.setDoc({ ...h.doc() });
    if (change === 'load') h.context.editorLoadToken++;
    if (change === 'bytes') h.setContent(original + ' ');
    if (change === 'version') h.context.editSessionVersion = revision(original + ' ');
    if (change === 'baseline') h.context.editSessionBaselineContent += ' ';
    if (change === 'busy') h.setBusy(true);
    if (change === 'path') h.state.activeEditSource = 'documents/other.json';
    if (change === 'activePath') h.state.activeEditPath = 'other';
    if (change === 'mode') h.state.editInputMode = 'fields';
    h.release(); assert.equal(await pending, null, `${change} at reader digest ${boundary}`);
  }
  const h = fixture(); h.setContent(original + '\t '); const s = await h.source();
  assert.equal(s.baseSourceRevision, revision(original)); assert.equal(s.sourceRevision, revision(original + '\t '));
  const p = createScene3DTranslationProposal(s, { instanceIds, offset }); await h.apply(p);
  assert.ok(h.content().endsWith('\t ')); assert.equal(h.context.editSessionBaselineContent, original);
});

test('replay fails and reversing an exactly representable translation produces a clean draft without resetting saved version or cache', async () => {
  const h = fixture(), p = await review(h); await h.apply(p); await assert.rejects(h.apply(p), conflict);
  const back = await review(h, offset.map(value => -value));
  const receipt = await h.apply(back);
  assert.equal(h.content(), original); assert.equal(h.state.editHasUnsavedChanges, false); assert.equal(receipt.content, original);
  assert.equal(h.context.editSessionBaselineContent, original); assert.equal(h.context.editSessionVersion, revision(original));
  assert.equal(h.doc()._sourceCachedText, original); assert.equal(h.statuses.at(-1), '3D整体移动已应用；文本与已保存版本一致。');
  const other = fixture(); other.context.editSessionVersion = `sha256:${'0'.repeat(64)}`; assert.equal(await other.source(), null);
});

test('translation wrapper and shared source application retain memory-only authority and readonly preview has no apply port', () => {
  assert.doesNotMatch(host, /fetch\s*\(|\.request\s*\(|saveEdit|setEditSessionClean|_sourceCachedText\s*=|WebGL|buildProject|applySceneComposition/);
  assert.match(runtime, /scene3dTranslation:\s*\{ getContext: scene3DTransformSourceContext, getSource: getScene3DTransformSourceSnapshot, applyDraft: applyScene3DTranslationDraft \}/);
  assert.match(runtime, /scene3d:\s*\{ getContext: scene3DSourceContext, getSource: getScene3DSourceSnapshot, locateSource: locateScene3DSource \}/);
});
