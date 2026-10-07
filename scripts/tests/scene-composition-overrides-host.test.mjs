import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash, webcrypto } from 'node:crypto';
import { dispatchStudioCoreCompositionPatch } from '../../engine/studio-core.mjs';
import { prepareSceneCompositionOverrideApply } from '../../engine/scene-composition-overrides.mjs';
import { editorHarness, deferred } from './editor-harness.mjs';

const saved = '\uFEFF' + (await fs.readFile(new URL('../../examples/scene-composition/recipe.json', import.meta.url), 'utf8')).replaceAll('\n', '\r\n');
const authored = JSON.parse(saved.replace(/^\uFEFF/, ''));
const sourcePath = 'documents/scenes/recipe.json', sceneId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const instanceId = authored.placements[1].actorIds.companion, placementId = authored.placements[1].placementId;
const draftText = saved.replace('Two parties', '未保存の配方😀');
const hash = content => 'sha256:' + createHash('sha256').update(content).digest('hex');
const normalize = content => content.replace(/\r\n|\r/g, '\n');
const current = h => h.runtime.getSourceEditorContent();
function proposal(content = draftText) {
  const values = { position: [210, 180], color: '#d0a040' };
  const result = dispatchStudioCoreCompositionPatch({ protocolVersion: 1, operation: 'sceneComposition.patchOverrides', content, placementId, actorKey: 'companion', values });
  return { sceneId, sourcePath, baseSourceRevision: hash(saved), sourceRevision: hash(content), instanceId, placementId, actorKey: 'companion', values, ...result };
}
async function fixture({ clean = false, ...overrides } = {}) {
  const reads = [], writes = [];
  const h = await editorHarness({ prepareSceneCompositionOverrideApply,
    readDocSource: async value => { reads.push(value); throw Error('Unexpected file read'); },
    writeDoc: async value => { writes.push(value); throw Error('Unexpected file write'); }, ...overrides });
  h.doc.sourcePath = sourcePath; h.doc._sourceCachedText = saved; h.runtime.rebuildDocPathCaches(h.state.docs);
  h.begin(saved, hash(saved)); h.state.activeEditSource = sourcePath; h.state.activeEditPath = h.doc.path;
  if (!clean) { h.source.value = normalize(draftText); h.runtime.refreshEditSessionDirtyState(); }
  return { ...h, reads, writes };
}
const untouchedDisk = h => {
  assert.equal(h.doc._sourceCachedText, saved); assert.equal(h.state.activeEditSourceVersion, hash(saved));
  assert.equal(h.reads.length, 0); assert.equal(h.writes.length, 0);
};

test('clean source sessions can create an instance override without inventing an initial dirty edit', async () => {
  const h = await fixture({ clean: true }); assert.equal(h.state.editHasUnsavedChanges, false);
  const source = await h.runtime.getSceneCompositionSource(sourcePath);
  assert.equal(source.content, saved); assert.equal(source.baseSourceRevision, hash(saved));
  const request = proposal(saved), beforeVersion = h.state.activeEditSourceVersion;
  assert.equal((await h.runtime.applySceneCompositionOverrideDraft(request)).applied, true);
  assert.equal(current(h), request.afterContent); assert.equal(h.state.editHasUnsavedChanges, true);
  const after = h.runtime.captureEditorDraft(); assert.equal(after.expectedVersion, beforeVersion); assert.equal(after.baselineContent, saved);
  untouchedDisk(h);
});

test('dirty source application preserves Unicode, line endings, selection and the ordinary save baseline', async () => {
  const h = await fixture(), request = proposal(); h.source.setSelectionRange(2, 8); h.source.scrollTop = 37;
  const result = await h.runtime.applySceneCompositionOverrideDraft(request);
  assert.equal(result.applied, true); assert.equal(current(h), request.afterContent); assert.equal(h.source.selectionStart, 2); assert.equal(h.source.scrollTop, 37);
  assert.ok(current(h).startsWith('\uFEFF')); assert.ok(current(h).includes('\r\n')); assert.ok(current(h).includes('未保存の配方😀'));
  assert.equal(h.runtime.captureEditorDraft().baselineContent, saved); assert.equal(h.runtime.captureEditorDraft().expectedVersion, hash(saved));
  const value = JSON.parse(current(h).replace(/^\uFEFF/, ''));
  assert.deepEqual(value.fragments, authored.fragments); assert.deepEqual(value.placements[0], authored.placements[0]);
  assert.equal(value.placements[1].actorIds.companion, instanceId); untouchedDisk(h);
});

test('foreign paths, baselines, target identities and altered afterContent cannot replace the current source', async () => {
  for (const alter of [p => { p.sourcePath = 'documents/elsewhere.json'; }, p => { p.baseSourceRevision = hash('other'); },
    p => { p.sourceRevision = hash(saved); }, p => { p.afterContent += ' '; }, p => { p.values.position[0] = 211; },
    p => { p.instanceId = authored.placements[0].actorIds.companion; }, p => { p.changedPaths = []; }]) {
    const h = await fixture(), request = proposal(); alter(request);
    await assert.rejects(h.runtime.applySceneCompositionOverrideDraft(request));
    assert.equal(current(h), draftText); untouchedDisk(h);
  }
});

test('other modes, inactive editors and busy states reject override application and source acquisition', async () => {
  for (const alter of [h => { h.state.editInputMode = 'blocks'; }, h => { h.state.editInputMode = 'fields'; },
    h => { h.state.isEditing = false; }, h => { h.state.isCreating = true; }, h => { h.state.mode = 'browse'; }, h => { h.state.isMutatingWorld = true; }]) {
    const h = await fixture(); alter(h);
    assert.equal(await h.runtime.getSceneCompositionSource(sourcePath), null);
    await assert.rejects(h.runtime.applySceneCompositionOverrideDraft(proposal()), { errorCode: 'scene_composition_override_conflict' });
    assert.equal(current(h), draftText); untouchedDisk(h);
  }
});

test('a source change during the saved-baseline digest invalidates the proposal', async () => {
  const waiting = deferred(), reached = deferred();
  const h = await fixture({ crypto: { subtle: { digest: async (...args) => { reached.resolve(); await waiting.promise; return webcrypto.subtle.digest(...args); } } } });
  const applying = h.runtime.applySceneCompositionOverrideDraft(proposal()); await reached.promise;
  h.source.value += ' '; h.runtime.refreshEditSessionDirtyState(); const expected = current(h); waiting.resolve();
  await assert.rejects(applying, { errorCode: 'scene_composition_override_conflict' });
  assert.equal(current(h), expected); untouchedDisk(h);
});

test('the parent preview owner is checked again after patch preparation and before editing memory', async () => {
  const waiting = deferred(), reached = deferred(); let owns = true;
  const h = await fixture({ prepareSceneCompositionOverrideApply: async (...args) => {
    const result = await prepareSceneCompositionOverrideApply(...args); reached.resolve(); await waiting.promise; return result;
  } });
  const applying = h.runtime.applySceneCompositionOverrideDraft(proposal(), { isCurrent: () => owns }); await reached.promise;
  owns = false; waiting.resolve();
  await assert.rejects(applying, { errorCode: 'scene_composition_override_conflict' });
  assert.equal(current(h), draftText); untouchedDisk(h);
});

test('an old proposal cannot be replayed and an old focus receipt cannot focus a later editor', async () => {
  const h = await fixture(), request = proposal(), receipt = await h.runtime.applySceneCompositionOverrideDraft(request);
  await assert.rejects(h.runtime.applySceneCompositionOverrideDraft(request), { errorCode: 'scene_composition_override_conflict' });
  h.source.focused = false; h.source.value += ' '; h.runtime.refreshEditSessionDirtyState(); receipt.focus();
  assert.equal(h.source.focused, false); untouchedDisk(h);
});

test('clean source acquisition refuses a snapshot if the live text changes during hashing', async () => {
  const waiting = deferred();
  const h = await fixture({ clean: true, crypto: { subtle: { digest: () => waiting.promise } } });
  const snapshot = h.runtime.getSceneCompositionSource(sourcePath); h.source.value += ' '; h.runtime.refreshEditSessionDirtyState();
  waiting.resolve(await webcrypto.subtle.digest('SHA-256', new TextEncoder().encode(saved)));
  assert.equal(await snapshot, null); untouchedDisk(h);
});
