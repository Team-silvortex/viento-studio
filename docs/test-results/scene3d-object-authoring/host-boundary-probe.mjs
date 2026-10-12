// Actual application source functions with only editor storage and scheduling
// injected. Actual native proposal brands and preparation are retained.
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import '../../../scripts/adapters/node-studio-core.mjs';
import { createScene3DObjectsProposal, isScene3DObjectsProposal, prepareScene3DObjectsApply } from '../../../engine/scene3d-objects.mjs';
import { createScene3DTransformProposal, isScene3DTransformProposal, prepareScene3DTransformApply } from '../../../engine/scene3d-transform.mjs';
const root = new URL('../../../', import.meta.url), hash = x => crypto.createHash('sha256').update(x).digest('hex');
const raw = '\uFEFF' + (await fs.readFile(new URL('examples/scene3d/scene.json', root), 'utf8')).replaceAll('\n', '\r\n');
const source = await fs.readFile(new URL('web/modules/app-runtime.js', root), 'utf8'), id = JSON.parse(raw.slice(1)).objects[1].instanceId;
const readonly = source.slice(source.indexOf('let scene3DSourceReadEpoch'), source.indexOf('\nasync function applySceneCompositionOverrideDraft'));
const host = source.slice(source.indexOf('let scene3DTransformReadEpoch'), source.indexOf('\nasync function applySceneSourceLayoutDraft'));
assert(readonly.startsWith('let ') && host.startsWith('let ') && host.includes('async function applyScene3DAuthoringDraft'));
const revision = value => `sha256:${hash(value)}`;
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
function fixture() {
  let content = raw, doc = { path: 'scene', _sourceCachedText: raw }, busy = false, editable = true, digests = 0, gate = null;
  const state = { isEditing: true, isCreating: false, editInputMode: 'source', activeEditPath: 'scene', activeEditSource: 'documents/scene.json', editHasUnsavedChanges: false };
  const editor = { value: raw, selectionStart: 11, selectionEnd: 19, scrollTop: 41, focuses: 0,
    setSelectionRange(a, b) { this.selectionStart = a; this.selectionEnd = b; }, focus() { this.focuses++; } };
  const context = vm.createContext({ state, editorLoadToken: 3, scenePreviewDraftEpoch: 7, TextEncoder,
    editSessionBaselineContent: raw, editSessionVersion: revision(raw), editEditorEl: editor,
    isScene3DObjectsProposal, prepareScene3DObjectsApply, isScene3DTransformProposal, prepareScene3DTransformApply,
    getActiveDoc: () => doc, isEditModeActive: () => editable, isEditorBusy: () => busy,
    canonicalizeSourcePath: value => value || '', getCurrentEditContent: () => content,
    setSourceEditorContent(value) { content = value; editor.value = value; },
    refreshEditSessionDirtyState() { state.editHasUnsavedChanges = content !== context.editSessionBaselineContent; context.scenePreviewDraftEpoch++; },
    refreshEditButtons() {}, setEditorStatus() {}, t: x => x,
    crypto: { subtle: { async digest(algorithm, value) { const count = ++digests; if (gate && gate.number === count) { gate.entered.resolve(); await gate.release.promise; } return crypto.webcrypto.subtle.digest(algorithm, value); } } },
  });
  vm.runInContext(readonly + '\n' + host, context);
  return { context, state, editor, source: () => context.getScene3DTransformSourceSnapshot(), apply: (p, options) => context.applyScene3DObjectsDraft(p, options),
    content: () => content, doc: () => doc, reloadDoc() { doc = { ...doc }; }, setBusy(value) { busy = value; },
    setContent(value) { content = value; editor.value = value; }, setEditable(value) { editable = value; },
    block(offset) { gate = { number: digests + offset, entered: deferred(), release: deferred() }; return gate; } };
}
const intent = (n = 0) => ({ action: 'copy', instanceId: id, newInstanceId: `${(0xabcdef00 + n).toString(16)}-1111-4111-8111-111111111111`, name: `Copy ${n}` });
const checks = [];
async function check(id, run) { try { await run(); checks.push({ id, ok: true }); } catch (error) { checks.push({ id, ok: false, message: error.message }); } }
await check('readonly-source-remains-three-fields-and-shared-write-source-five-fields', async () => {
  const h = fixture(); assert.deepEqual(Object.keys(await h.context.getScene3DSourceSnapshot()).sort(), ['content', 'sourcePath', 'token']);
  assert.deepEqual(Object.keys(await h.source()).sort(), ['baseSourceRevision', 'content', 'sourcePath', 'sourceRevision', 'token']);
  assert.doesNotMatch(readonly, /prepareScene3D|applyDraft|setSourceEditorContent|saveEdit/);
});
await check('later-object-apply-wins-while-earlier-baseline-digest-is-pending', async () => {
  const h = fixture(), s = await h.source(), first = createScene3DObjectsProposal(s, intent(1)), second = createScene3DObjectsProposal(s, intent(2));
  const gate = h.block(1), pending = h.apply(first); await gate.entered.promise;
  const done = await h.apply(second); assert.equal(done.content, second.afterContent); gate.release.resolve();
  await assert.rejects(pending, { errorCode: 'scene3d_objects_conflict' }); assert.equal(h.content(), second.afterContent);
  assert.equal(h.doc()._sourceCachedText, raw); assert.equal(h.context.editSessionBaselineContent, raw); assert.equal(h.context.editSessionVersion, revision(raw));
});
await check('transform-and-objects-race-share-owner-not-proposal-authority', async () => {
  for (const firstKind of ['objects', 'transform']) {
    const h = fixture(), s = await h.source(), objects = createScene3DObjectsProposal(s, intent(3)), transform = createScene3DTransformProposal(s, { instanceId: id, values: { position: [9, 1.5, 0] } });
    const gate = h.block(1), pending = firstKind === 'objects' ? h.apply(objects) : h.context.applyScene3DTransformDraft(transform);
    await gate.entered.promise;
    const winner = firstKind === 'objects' ? await h.context.applyScene3DTransformDraft(transform) : await h.apply(objects);
    gate.release.resolve(); await assert.rejects(pending, { errorCode: firstKind === 'objects' ? 'scene3d_objects_conflict' : 'scene3d_transform_conflict' });
    assert.equal(h.content(), winner.content); assert.equal(h.context.editSessionBaselineContent, raw);
  }
});
await check('busy-version-reload-and-draft-epoch-at-each-three-awaits-cannot-author-write', async () => {
  for (const offset of [1, 2, 3]) for (const mutate of ['busy', 'version', 'reloadDoc', 'epoch']) {
    const h = fixture(), p = createScene3DObjectsProposal(await h.source(), intent(4)), gate = h.block(offset), pending = h.apply(p);
    await gate.entered.promise;
    if (mutate === 'busy') h.setBusy(true); if (mutate === 'version') h.context.editSessionVersion = revision(raw + ' ');
    if (mutate === 'reloadDoc') h.reloadDoc(); if (mutate === 'epoch') h.context.scenePreviewDraftEpoch++;
    gate.release.resolve(); await assert.rejects(pending, { errorCode: 'scene3d_objects_conflict' }); assert.equal(h.content(), raw); assert.equal(h.doc()._sourceCachedText, raw);
  }
});
await check('exact-current-token-receipt-restores-cursor-without-resetting-save-baseline', async () => {
  const h = fixture(); h.setContent(raw + ' '); const p = createScene3DObjectsProposal(await h.source(), intent(5)), beforeToken = h.context.scene3DTransformSourceContext().sourceToken, receipt = await h.apply(p);
  assert.equal(receipt.content, p.afterContent); assert.notEqual(receipt.sourceToken, beforeToken); assert.equal(receipt.sourceToken, h.context.scene3DTransformSourceContext().sourceToken);
  assert.equal(h.editor.selectionStart, 11); assert.equal(h.editor.selectionEnd, 19); assert.equal(h.editor.scrollTop, 41);
  assert.equal(h.context.editSessionBaselineContent, raw); assert.equal(h.context.editSessionVersion, revision(raw)); assert.equal(h.doc()._sourceCachedText, raw);
  receipt.focus(); assert.equal(h.editor.focuses, 1); h.reloadDoc(); receipt.focus(); assert.equal(h.editor.focuses, 1);
  await assert.rejects(h.apply(p), { errorCode: 'scene3d_objects_conflict' });
});
await check('shared-application-port-has-no-write-path-through-readonly-or-cross-domain-copies', async () => {
  const h = fixture(), s = await h.source(), p = createScene3DObjectsProposal(s, intent(6)), transform = createScene3DTransformProposal(s, { instanceId: id, values: { position: [9, 1.5, 0] } });
  for (const bad of [transform, JSON.parse(JSON.stringify(p)), { ...p }]) await assert.rejects(h.apply(bad), { errorCode: 'scene3d_objects_conflict' });
  await assert.rejects(h.context.applyScene3DTransformDraft(p), { errorCode: 'scene3d_transform_conflict' });
  assert.equal(h.content(), raw); assert.doesNotMatch(host, /fetch\s*\(|saveEdit|setEditSessionClean|_sourceCachedText\s*=|WebGL|buildProject/);
});
const report = { format: 'viento-scene3d-objects-independent-host-boundary', schemaVersion: 1, runtime: process.version,
  applicationSourceSha256: hash(source), checks, passed: checks.filter(x => x.ok).length, failed: checks.filter(x => !x.ok).length,
  digestRaceVariants: 12, concurrentApplicationCases: 3,
  scope: 'Actual extracted application source functions and actual Rust-backed private proposal/prepare. Editor memory and await scheduling are injected. Confirms ownership, cursor, cached bytes and Save preconditions remain; does not itself execute ordinary Save, browser rendering, backend runtime, installation or device.' };
assert(process.argv[2], 'NEW report path required'); await fs.writeFile(process.argv[2], JSON.stringify(report, null, 2) + '\n', { flag: 'wx' }); console.log(JSON.stringify(report, null, 2)); if (report.failed) process.exitCode = 1;
