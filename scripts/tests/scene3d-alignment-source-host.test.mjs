import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { createHash, webcrypto } from 'node:crypto';
import { createScene3DAlignmentProposal, isScene3DAlignmentProposal, prepareScene3DAlignmentApply } from '../../engine/scene3d-alignment.mjs';
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
const conflict = value => value?.errorCode === 'scene3d_alignment_conflict';

function fixture() {
  let content = original, busy = false, editable = true, doc = { path: 'scene', _sourceCachedText: original };
  let digestCount = 0, gateAt = 0, release;
  const state = { isEditing: true, isCreating: false, editInputMode: 'source', activeEditPath: 'scene',
    activeEditSource: 'documents/scene.json', editHasUnsavedChanges: false };
  const editor = { value: original, selectionStart: 17, selectionEnd: 27, scrollTop: 73, focusCount: 0,
    setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; }, focus() { this.focusCount++; } };
  const writes = [], statuses = [], context = vm.createContext({ state, editorLoadToken: 3, scenePreviewDraftEpoch: 7, TextEncoder,
    editSessionBaselineContent: original, editSessionVersion: revision(original), editEditorEl: editor,
    isScene3DAlignmentProposal, prepareScene3DAlignmentApply, isScene3DTranslationProposal, prepareScene3DTranslationApply, isScene3DPropertiesProposal, prepareScene3DPropertiesApply, isScene3DEnvironmentProposal, prepareScene3DEnvironmentApply,
    isScene3DTransformProposal, prepareScene3DTransformApply, isScene3DObjectsProposal, prepareScene3DObjectsApply,
    getActiveDoc: () => doc, isEditModeActive: () => editable, isEditorBusy: () => busy,
    canonicalizeSourcePath: value => value || '', getCurrentEditContent: () => content,
    setSourceEditorContent(value) { writes.push(value); content = value; editor.value = value; },
    refreshEditSessionDirtyState() { state.editHasUnsavedChanges = content !== context.editSessionBaselineContent; context.scenePreviewDraftEpoch++; },
    refreshEditButtons() {}, t: value => value, setEditorStatus: value => statuses.push(value),
    crypto: { subtle: { async digest(algorithm, bytes) {
      if (++digestCount === gateAt) await new Promise(resolve => { release = resolve; });
      return webcrypto.subtle.digest(algorithm, bytes);
    } } },
  });
  vm.runInContext(readonly + '\n' + host, context);
  return { context, state, editor, statuses, writes,
    source: () => context.getScene3DTransformSourceSnapshot(), flags: () => context.scene3DTransformSourceContext(),
    apply: (proposal, guard) => context.applyScene3DAlignmentDraft(proposal, guard), content: () => content, doc: () => doc,
    setContent(value) { content = value; editor.value = value; }, setBusy: value => { busy = value; },
    setEditable: value => { editable = value; }, setDoc: value => { doc = value; },
    blockNext(offset = 1) { gateAt = digestCount + offset; release = undefined; },
    async waitBlocked() {
      for (let n = 0; n < 100 && !release; n++) await new Promise(resolve => setTimeout(resolve, 2));
      assert.equal(typeof release, 'function', 'the requested real digest boundary was reached');
    }, release: () => release() };
}

const instanceIds = sourceModel.objects.slice(0, 2).map(object => object.instanceId);
const edit = { instanceIds, anchorInstanceId: instanceIds[0], axis: 'x' };
const review = async h => createScene3DAlignmentProposal(await h.source(), edit);
const siblings = source => ({
 translation: createScene3DTranslationProposal(source, { instanceIds, offset: [3, 0, 2] }),
 properties: createScene3DPropertiesProposal(source, { instanceId, values: { color: '#AbCdEf' } }),
 environment: createScene3DEnvironmentProposal(source, { values: { background: '#ABCDEF' } }),
 transforms: createScene3DTransformProposal(source, { instanceId, values: { position: [3, 4, 5] } }),
 objects: createScene3DObjectsProposal(source, { action: 'copy', instanceId, newInstanceId: 'aaaaaaaa-1111-4111-8111-111111111111', name: 'Independent copy' }),
});
const wrappers = { translation: 'applyScene3DTranslationDraft', properties: 'applyScene3DPropertiesDraft', environment: 'applyScene3DEnvironmentDraft',
 transforms: 'applyScene3DTransformDraft', objects: 'applyScene3DObjectsDraft' };

test('alignment receives the existing five-field author source while preview retains three read-only fields', async () => {
 const h=fixture(), source=await h.source(), readonly=await h.context.getScene3DSourceSnapshot();
 assert.deepEqual(Object.keys(source).sort(), ['baseSourceRevision','content','sourcePath','sourceRevision','token']);
 assert.deepEqual(Object.keys(readonly).sort(), ['content','sourcePath','token']);
 assert.equal(source.content,original); assert.equal(source.baseSourceRevision,revision(original)); assert.notEqual(source.token,readonly.token);
});

test('a complete alignment writes source memory once, preserving unselected declarations, saved baseline, cached bytes and cursor', async () => {
 const h=fixture(); h.setContent(original+'\t '); const source=await h.source(), proposal=createScene3DAlignmentProposal(source, edit);
 const receipt=await h.apply(proposal); const expected=structuredClone(sourceModel);expected.objects[1].position[0]=expected.objects[0].position[0];
 assert.deepEqual(JSON.parse(h.content().slice(1)),expected);assert.deepEqual(h.writes,[proposal.afterContent]);assert.ok(h.content().endsWith('\t '));
 assert.equal(receipt.applied,true);assert.equal(receipt.content,proposal.afterContent);assert.equal(receipt.sourceToken,h.flags().sourceToken);
 assert.equal(h.context.editSessionBaselineContent,original);assert.equal(h.context.editSessionVersion,revision(original));assert.equal(h.doc()._sourceCachedText,original);
 assert.equal(h.editor.selectionStart,17);assert.equal(h.editor.selectionEnd,27);assert.equal(h.editor.scrollTop,73);assert.equal(h.state.editHasUnsavedChanges,true);
 assert.equal(h.statuses.at(-1),'3D位置对齐已应用到原文草稿；尚未保存。');receipt.focus();assert.equal(h.editor.focusCount,1);h.setDoc({...h.doc()});receipt.focus();assert.equal(h.editor.focusCount,1);
 await assert.rejects(h.apply(proposal),conflict);assert.equal(h.writes.length,1);
});

test('alignment private approval and all five prior author approvals are rejected across the new domain and detached clones', async () => {
 const h=fixture(),source=await h.source(),proposal=createScene3DAlignmentProposal(source, edit);let pairs=0;
 for(const [kind,foreign] of Object.entries(siblings(source))) {
  await assert.rejects(h.apply(foreign),conflict);
  await assert.rejects(h.context[wrappers[kind]](proposal),e=>e.errorCode===`scene3d_${kind==='transforms'?'transform':kind}_conflict`);pairs+=2;
 }
 for(const clone of [structuredClone(proposal),{...proposal},JSON.parse(JSON.stringify(proposal))])await assert.rejects(h.apply(clone),conflict);
 assert.equal(pairs,10);assert.deepEqual(h.writes,[]);assert.equal(h.content(),original);
});

test('alignment is invalidated by cancellation, same-path new owner, reference source bytes or baseline change at every actual digest boundary', async () => {
 for(const boundary of [1,2,3])for(const change of ['cancel','doc','load','bytes','baseline','mode']) {
  const h=fixture(),proposal=await review(h);let current=true;h.blockNext(boundary);const pending=h.apply(proposal,{isCurrent:()=>current});await h.waitBlocked();
  if(change==='cancel')current=false;if(change==='doc')h.setDoc({...h.doc()});if(change==='load')h.context.editorLoadToken++;
  if(change==='bytes')h.setContent(original+' ');if(change==='baseline')h.context.editSessionBaselineContent+=' ';if(change==='mode')h.state.editInputMode='fields';
  const before=h.content();h.release();await assert.rejects(pending,conflict);assert.equal(h.content(),before);assert.deepEqual(h.writes,[]);assert.equal(h.doc()._sourceCachedText,original);
 }
});

test('overlapping alignments and prior author winners leave exactly one complete write at every digest boundary', async () => {
 for(const boundary of [1,2,3]) {
  const h=fixture(),proposal=await review(h);h.blockNext(boundary);const old=h.apply(proposal);await h.waitBlocked();await h.apply(proposal);h.release();await assert.rejects(old,conflict);
  assert.deepEqual(h.writes,[proposal.afterContent]);assert.equal(h.content(),proposal.afterContent);
 }
 for(const [kind,wrapper] of Object.entries(wrappers)) {
  const h=fixture(),source=await h.source(),proposal=createScene3DAlignmentProposal(source,edit),winner=siblings(source)[kind];h.blockNext(2);const old=h.apply(proposal);await h.waitBlocked();
  await h.context[wrapper](winner);h.release();await assert.rejects(old,conflict);assert.deepEqual(h.writes,[winner.afterContent]);assert.equal(h.doc()._sourceCachedText,original);
 }
});

test('alignment source port retains only source/draft authority independently of preview, renderer, backend, world and ordinary save', () => {
 assert.doesNotMatch(host,/fetch\s*\(|\.request\s*\(|saveEdit|setEditSessionClean|_sourceCachedText\s*=|WebGL|buildProject|applySceneComposition/);
 assert.match(runtime,/scene3dAlignment:\s*\{ getContext: scene3DTransformSourceContext, getSource: getScene3DTransformSourceSnapshot, applyDraft: applyScene3DAlignmentDraft \}/);
 assert.match(runtime,/scene3d:\s*\{ getContext: scene3DSourceContext, getSource: getScene3DSourceSnapshot, locateSource: locateScene3DSource \}/);
});
