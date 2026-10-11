import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash, webcrypto } from 'node:crypto';
import { dispatchStudioCoreCompositionFragmentEdit } from '../../engine/studio-core.mjs';
import { prepareSceneCompositionFragmentApply } from '../../engine/scene-composition-fragments.mjs';
import { editorHarness, deferred } from './editor-harness.mjs';

const authored = JSON.parse(await fs.readFile(new URL('../../examples/scene-composition/recipe.json', import.meta.url), 'utf8'));
authored.fragments[0].actors[0].useProjectionDefaults = true;
authored.fragments[0].actors[0].imageResourceId = null;
const saved = '\uFEFF' + (JSON.stringify(authored, null, 2) + '\n').replaceAll('\n', '\r\n');
// Real WASM exact declaration deletion plus the actual source-editor host.
const sourcePath = 'documents/scenes/recipe.json', sceneId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const instanceId = authored.placements[1].actorIds.leader, placementId = authored.placements[1].placementId;
const draftText = saved.replace('Two parties', '未保存の配方😀');
const hash = content => 'sha256:' + createHash('sha256').update(content).digest('hex');
const normalize = content => content.replace(/\r\n|\r/g, '\n');
const current = h => h.runtime.getSourceEditorContent();
function proposal(content = draftText) {
  const fragmentId = 'party', actorKey = 'leader', values = { position: [125, 185] }, reset = ['size','color','speed','controls','imageResourceId'];
  const targets = authored.placements.filter(p => p.fragmentId === fragmentId).map(p => ({ instanceId: p.actorIds[actorKey],
    placementId: p.placementId, overrides: ['position','size','color','speed','controls','imageResourceId'].filter(field =>
      Object.hasOwn(p.overrides?.find(o => o.actorKey === actorKey)?.values || {}, field)) }));
  const result = dispatchStudioCoreCompositionFragmentEdit({ protocolVersion: 1, operation: 'sceneComposition.editFragmentActor', content,
    fragmentId, actorKey, values, reset });
  return { sceneId, sourcePath, baseSourceRevision: hash(saved), sourceRevision: hash(content), instanceId, fragmentId, actorKey, values, reset, targets, ...result };
}
async function fixture({ clean = false, ...overrides } = {}) {
  const reads = [], writes = [];
  const h = await editorHarness({ prepareSceneCompositionFragmentApply,
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

test('clean source sessions accept an atomic shared declaration SET/RESET without writing disk', async () => {
  const h = await fixture({ clean: true }); assert.equal(h.state.editHasUnsavedChanges, false);
  const source = await h.runtime.getSceneCompositionSource(sourcePath);
  assert.equal(source.content, saved); assert.equal(source.baseSourceRevision, hash(saved));
  const request = proposal(saved), beforeVersion = h.state.activeEditSourceVersion;
  assert.equal((await h.runtime.applySceneCompositionFragmentDraft(request)).applied, true);
  assert.equal(current(h), request.afterContent); assert.equal(h.state.editHasUnsavedChanges, true);
  const after = h.runtime.captureEditorDraft(); assert.equal(after.expectedVersion, beforeVersion); assert.equal(after.baselineContent, saved);
  untouchedDisk(h);
});

test('dirty source application preserves Unicode, line endings, selection and the ordinary save baseline while preserving all placements', async () => {
  const h = await fixture(), request = proposal(); h.source.setSelectionRange(2, 8); h.source.scrollTop = 37;
  const result = await h.runtime.applySceneCompositionFragmentDraft(request);
  assert.equal(result.applied, true); assert.equal(current(h), request.afterContent); assert.equal(h.source.selectionStart, 2); assert.equal(h.source.scrollTop, 37);
  assert.ok(current(h).startsWith('\uFEFF')); assert.ok(current(h).includes('\r\n')); assert.ok(current(h).includes('未保存の配方😀'));
  assert.equal(h.runtime.captureEditorDraft().baselineContent, saved); assert.equal(h.runtime.captureEditorDraft().expectedVersion, hash(saved));
  const value = JSON.parse(current(h).replace(/^\uFEFF/, ''));
  assert.deepEqual(value.fragments[0].actors[1], authored.fragments[0].actors[1]);
  assert.deepEqual(value.fragments[0].actors[0].position, [125,185]);
  assert.deepEqual(value.placements, authored.placements);
  assert.deepEqual(value.placements[1].overrides[0], authored.placements[1].overrides[0]);
  for (const field of request.reset) assert.equal(Object.hasOwn(value.fragments[0].actors[0], field), false);
  assert.equal(value.fragments[0].actors[0].useProjectionDefaults, true);
  assert.equal(value.placements[1].actorIds.leader, instanceId); untouchedDisk(h);
});

test('foreign paths, baselines, target identities and altered afterContent cannot replace the current source', async () => {
  for (const alter of [p => { p.sourcePath = 'documents/elsewhere.json'; }, p => { p.baseSourceRevision = hash('other'); },
    p => { p.sourceRevision = hash(saved); }, p => { p.afterContent += ' '; }, p => { p.values.position[0] = 126; }, p => { p.reset = []; }, p => { p.reset.push('position'); }, p => { p.reset.reverse(); },
    p => { p.targets[1].instanceId = authored.placements[0].actorIds.leader; }, p => { p.changedPaths = []; }]) {
    const h = await fixture(), request = proposal(); alter(request);
    await assert.rejects(h.runtime.applySceneCompositionFragmentDraft(request));
    assert.equal(current(h), draftText); untouchedDisk(h);
  }
});

test('other modes, inactive editors and busy states reject fragment application and source acquisition', async () => {
  for (const alter of [h => { h.state.editInputMode = 'blocks'; }, h => { h.state.editInputMode = 'fields'; },
    h => { h.state.isEditing = false; }, h => { h.state.isCreating = true; }, h => { h.state.mode = 'browse'; }, h => { h.state.isMutatingWorld = true; }]) {
    const h = await fixture(); alter(h);
    assert.equal(await h.runtime.getSceneCompositionSource(sourcePath), null);
    await assert.rejects(h.runtime.applySceneCompositionFragmentDraft(proposal()), { errorCode: 'scene_composition_override_conflict' });
    assert.equal(current(h), draftText); untouchedDisk(h);
  }
});

test('a source change during the saved-baseline digest invalidates the proposal', async () => {
  const waiting = deferred(), reached = deferred();
  const h = await fixture({ crypto: { subtle: { digest: async (...args) => { reached.resolve(); await waiting.promise; return webcrypto.subtle.digest(...args); } } } });
  const applying = h.runtime.applySceneCompositionFragmentDraft(proposal()); await reached.promise;
  h.source.value += ' '; h.runtime.refreshEditSessionDirtyState(); const expected = current(h); waiting.resolve();
  await assert.rejects(applying, { errorCode: 'scene_composition_override_conflict' });
  assert.equal(current(h), expected); untouchedDisk(h);
});

test('the parent preview owner is checked again after patch preparation and before editing memory', async () => {
  const waiting = deferred(), reached = deferred(); let owns = true;
  const h = await fixture({ prepareSceneCompositionFragmentApply: async (...args) => {
    const result = await prepareSceneCompositionFragmentApply(...args); reached.resolve(); await waiting.promise; return result;
  } });
  const applying = h.runtime.applySceneCompositionFragmentDraft(proposal(), { isCurrent: () => owns }); await reached.promise;
  owns = false; waiting.resolve();
  await assert.rejects(applying, { errorCode: 'scene_composition_override_conflict' });
  assert.equal(current(h), draftText); untouchedDisk(h);
});

test('an old proposal cannot be replayed and an old focus receipt cannot focus a later editor', async () => {
  const h = await fixture(), request = proposal(), receipt = await h.runtime.applySceneCompositionFragmentDraft(request);
  await assert.rejects(h.runtime.applySceneCompositionFragmentDraft(request), { errorCode: 'scene_composition_override_conflict' });
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
