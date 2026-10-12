import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { createHash, webcrypto } from 'node:crypto';
import { createScene3DObjectsProposal, isScene3DObjectsProposal, prepareScene3DObjectsApply } from '../../engine/scene3d-objects.mjs';
import { createScene3DTransformProposal, prepareScene3DTransformApply, isScene3DTransformProposal } from '../../engine/scene3d-transform.mjs';

const source = await fs.readFile(new URL('../../web/modules/app-runtime.js', import.meta.url), 'utf8');
const original = '\ufeff' + (await fs.readFile(new URL('../../examples/scene3d/scene.json', import.meta.url), 'utf8')).replaceAll('\n', '\r\n');
const id = JSON.parse(original.slice(1)).objects[0].instanceId;
const revision = value => `sha256:${createHash('sha256').update(value).digest('hex')}`;
const error = value => value?.errorCode === 'scene3d_objects_conflict';
const readonly = source.slice(source.indexOf('let scene3DSourceReadEpoch'), source.indexOf('\nasync function applySceneCompositionOverrideDraft'));
const host = source.slice(source.indexOf('let scene3DTransformReadEpoch'), source.indexOf('\nasync function applySceneSourceLayoutDraft'));

function fixture() {
  let content = original, busy = false, editable = true, doc = { path: 'scene', _sourceCachedText: original }, digestCount = 0, gateAt = 0, release;
  const state = { isEditing: true, isCreating: false, editInputMode: 'source', activeEditPath: 'scene', activeEditSource: 'documents/scene.json', editHasUnsavedChanges: false };
  const editor = { value: original, selectionStart: 17, selectionEnd: 27, scrollTop: 73, focusCount: 0,
    setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; }, focus() { this.focusCount++; } };
  const statuses = [], context = vm.createContext({ state, editorLoadToken: 3, scenePreviewDraftEpoch: 7, TextEncoder,
    editSessionBaselineContent: original, editSessionVersion: revision(original), editEditorEl: editor,
    isScene3DTransformProposal, prepareScene3DTransformApply, isScene3DObjectsProposal, prepareScene3DObjectsApply,
    getActiveDoc: () => doc, isEditModeActive: () => editable, isEditorBusy: () => busy, canonicalizeSourcePath: value => value || '', getCurrentEditContent: () => content,
    setSourceEditorContent(value) { content = value; editor.value = value; },
    refreshEditSessionDirtyState() { state.editHasUnsavedChanges = content !== context.editSessionBaselineContent; context.scenePreviewDraftEpoch++; },
    refreshEditButtons() {}, t: value => value, setEditorStatus: value => statuses.push(value),
    crypto: { subtle: { async digest(algorithm, value) { const n = ++digestCount; if (n === gateAt) await new Promise(resolve => { release = resolve; }); return webcrypto.subtle.digest(algorithm, value); } } },
  });
  vm.runInContext(readonly + '\n' + host, context);
  return { context, state, editor, statuses, source: () => context.getScene3DTransformSourceSnapshot(), flags: () => context.scene3DTransformSourceContext(),
    apply: (p, guard) => context.applyScene3DObjectsDraft(p, guard), content: () => content, doc: () => doc,
    setContent: value => { content = value; editor.value = value; }, setBusy: value => { busy = value; }, setEditable: value => { editable = value; },
    setDoc: value => { doc = value; }, blockNext: (offset = 1) => { gateAt = digestCount + offset; },
    waitBlocked: async () => { for (let n = 0; n < 50 && !release; n++) await new Promise(resolve => setTimeout(resolve, 2)); assert.equal(typeof release, 'function'); },
    release: () => release() };
}

const fresh = 'aaaaaaaa-1111-4111-8111-111111111111';
const edit = action => action === 'add' ? { action, object: { instanceId: fresh, name: 'Added', primitive: 'box', position: [0, 0, 0], rotationDegrees: [0, 0, 0], size: [1, 1, 1], color: '#87d8b9' } }
 : action === 'copy' ? { action, instanceId: id, newInstanceId: fresh, name: 'Copied' } : { action, instanceId: id };
const review = async (h, action = 'copy') => createScene3DObjectsProposal(await h.source(), edit(action));

test('shared source admission supplies unchanged five-field snapshot without extending readonly preview authority', async () => {
 const h = fixture(), s = await h.source();assert.deepEqual(Object.keys(s).sort(), ['baseSourceRevision','content','sourcePath','sourceRevision','token']);
 assert.deepEqual(Object.keys(await h.context.getScene3DSourceSnapshot()).sort(), ['content','sourcePath','token']);assert.equal(s.content, original);
});
test('each real object action applies only an unsaved draft, with original baseline, cache and cursor intact', async () => {
 for(const action of ['add','copy','remove']) {
  const h=fixture(),p=await review(h,action),owner=h.flags().sourceToken,receipt=await h.apply(p);
  assert.equal(receipt.applied,true);assert.equal(receipt.content,p.afterContent);assert.notEqual(receipt.sourceToken,owner);assert.equal(receipt.sourceToken,h.flags().sourceToken);
  assert.equal(h.content(),p.afterContent);assert.equal(h.state.editHasUnsavedChanges,true);assert.equal(h.context.editSessionBaselineContent,original);assert.equal(h.context.editSessionVersion,revision(original));assert.equal(h.doc()._sourceCachedText,original);
  assert.equal(h.editor.selectionStart,17);assert.equal(h.editor.selectionEnd,27);assert.equal(h.editor.scrollTop,73);receipt.focus();assert.equal(h.editor.focusCount,1);h.setContent(p.afterContent+' ');receipt.focus();assert.equal(h.editor.focusCount,1);
 }
});
test('private proposal brands cannot cross authoring domains or survive serialization through the actual source host', async () => {
 const h=fixture(),s=await h.source(),p=createScene3DObjectsProposal(s,edit('copy'));
 const transform=createScene3DTransformProposal(s,{instanceId:id,values:{position:[3,4,5]}});
 await assert.rejects(h.apply(transform),error);await assert.rejects(h.apply(structuredClone(p)),error);
 await assert.rejects(h.context.applyScene3DTransformDraft(p),e=>e.errorCode==='scene3d_transform_conflict');assert.equal(h.content(),original);
 await h.context.applyScene3DTransformDraft(transform);assert.equal(h.content(),transform.afterContent);
});
test('one legal structural apply revokes a simultaneous old transform review and vice versa', async () => {
 for(const first of ['objects','transform']) {
  const h=fixture(),s=await h.source(),p=createScene3DObjectsProposal(s,edit('copy')),transform=createScene3DTransformProposal(s,{instanceId:id,values:{position:[3,4,5]}});
  if(first==='objects'){await h.apply(p);await assert.rejects(h.context.applyScene3DTransformDraft(transform),e=>e.errorCode==='scene3d_transform_conflict');assert.equal(h.content(),p.afterContent);}
  else{await h.context.applyScene3DTransformDraft(transform);await assert.rejects(h.apply(p),error);assert.equal(h.content(),transform.afterContent);}
 }
});
test('cancel, source edits, same-path document replacement and reload cannot write during any digest await', async () => {
 for(const boundary of [1,2,3])for(const change of ['cancel','bytes','doc','load','baseline']) {
  const h=fixture(),p=await review(h);let current=true;h.blockNext(boundary);const pending=h.apply(p,{isCurrent:()=>current});await h.waitBlocked();
  if(change==='cancel')current=false;if(change==='bytes')h.setContent(original+' ');if(change==='doc')h.setDoc({...h.doc()});if(change==='load')h.context.editorLoadToken++;if(change==='baseline')h.context.editSessionBaselineContent+=' ';
  const before=h.content();h.release();await assert.rejects(pending,error);assert.equal(h.content(),before);assert.equal(h.doc()._sourceCachedText,original);
 }
});
test('an applied object proposal cannot replay, and bad saved version cannot authorize a source snapshot', async () => {
 const h=fixture(),p=await review(h);await h.apply(p);await assert.rejects(h.apply(p),error);assert.equal(h.content(),p.afterContent);
 const other=fixture();other.context.editSessionVersion=`sha256:${'0'.repeat(64)}`;assert.equal(await other.source(),null);
});
test('adding after unsaved raw text still guards the distinct saved baseline and exact current revision', async () => {
 const h=fixture();h.setContent(original+' ');const s=await h.source();assert.equal(s.baseSourceRevision,revision(original));assert.equal(s.sourceRevision,revision(original+' '));
 const p=createScene3DObjectsProposal(s,edit('add'));await h.apply(p);assert.ok(h.content().endsWith(' '));assert.equal(h.context.editSessionBaselineContent,original);
});
test('shared draft guard and independent object wrapper have no Save, HTTP, World or renderer authority', () => {
 assert.doesNotMatch(host,/fetch\s*\(|\.request\s*\(|saveEdit|setEditSessionClean|_sourceCachedText\s*=|WebGL|buildProject|applySceneComposition/);
 assert.match(source,/scene3dObjects:\s*\{ getContext: scene3DTransformSourceContext, getSource: getScene3DTransformSourceSnapshot, applyDraft: applyScene3DObjectsDraft \}/);
});
