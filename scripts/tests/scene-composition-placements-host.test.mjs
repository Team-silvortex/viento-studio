import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { createSceneCompositionPlacementsDraft, prepareSceneCompositionPlacementsApply } from '../../engine/scene-composition-placements.mjs';
import { placementsFixture, copy, decoded, hash, revision } from './scene-composition-placements-fixture.mjs';
import { editorHarness, deferred } from './editor-harness.mjs';

const prepare = (source, proposal, options) => prepareSceneCompositionPlacementsApply(copy(source), copy(proposal), options);
async function fixture({ clean = false, ...overrides } = {}) {
  const value = await placementsFixture({ dirty: !clean }), writes = [], reads = [];
  const h = await editorHarness({ prepareSceneCompositionPlacementsApply: prepare,
    readDocSource: async value => { reads.push(value); throw Error('Unexpected file read'); },
    writeDoc: async value => { writes.push(value); throw Error('Unexpected file write'); }, ...overrides });
  h.doc.sourcePath = value.source.sourcePath; h.doc._sourceCachedText = value.saved; h.runtime.rebuildDocPathCaches(h.state.docs);
  h.begin(value.saved, revision(value.saved)); h.state.activeEditSource = value.source.sourcePath; h.state.activeEditPath = h.doc.path;
  if (!clean) { h.source.value = value.source.content.replace(/\r\n|\r/g, '\n'); h.runtime.refreshEditSessionDirtyState(); }
  const draft = await createSceneCompositionPlacementsDraft(value.model, value.source, { digest: hash });
  const proposal = action => {
    const original = value.recipe.placements[0], part = value.recipe.fragments[0];
    const maps = { placementId: webcrypto.randomUUID(), actorIds: Object.fromEntries(part.actors.map(item => [item.key, webcrypto.randomUUID()])),
      groupIds: Object.fromEntries(part.groups.map(item => [item.key, webcrypto.randomUUID()])) };
    return draft.propose(action === 'remove' ? { action, placementId: original.placementId }
      : action === 'copy' ? { action, sourcePlacementId: original.placementId, ...maps } : { action: 'add', fragmentId: part.fragmentId, ...maps, offset: [0, 0] });
  };
  return { ...h, value, writes, reads, proposal, current: () => h.runtime.getSourceEditorContent() };
}
function untouched(h) { assert.equal(h.doc._sourceCachedText, h.value.saved); assert.equal(h.state.activeEditSourceVersion, revision(h.value.saved));
  const captured = h.runtime.captureEditorDraft(); if (captured) { assert.equal(captured.baselineContent, h.value.saved); assert.equal(captured.expectedVersion, revision(h.value.saved)); }
  assert.equal(h.reads.length, 0); assert.equal(h.writes.length, 0); }

test('adding a placement to clean source produces an unsaved draft and retains the ordinary Save baseline', async () => {
  const h = await fixture({ clean: true }), p = h.proposal('add');
  assert.equal((await h.runtime.applySceneCompositionPlacementsDraft(p)).applied, true); assert.equal(h.current(), p.afterContent);
  assert.equal(h.state.editHasUnsavedChanges, true); assert.deepEqual(decoded(h.current()).fragments, h.value.recipe.fragments); untouched(h);
});

test('copy preserves complete source declarations, BOM/CRLF, identity separation, selection and existing dirty text', async () => {
  const h = await fixture(), p = h.proposal('copy'); h.source.setSelectionRange(3, 11); h.source.scrollTop = 34;
  assert.equal((await h.runtime.applySceneCompositionPlacementsDraft(p)).applied, true); assert.equal(h.current(), p.afterContent);
  const after = decoded(h.current()); assert.deepEqual(after.placements.at(-1).overrides, after.placements[0].overrides); assert.deepEqual(after.placements.at(-1).offset, [0, 0]);
  assert.deepEqual(after.placements.slice(0, -1), h.value.recipe.placements); assert.deepEqual(after.fragments, h.value.recipe.fragments);
  assert.equal(h.current().startsWith('\uFEFF'), true); assert.equal(h.current().includes('\r\n'), true); assert.equal(h.current().includes('未保存😀'), true);
  assert.equal(h.source.selectionStart, 3); assert.equal(h.source.selectionEnd, 11); assert.equal(h.source.scrollTop, 34); untouched(h);
});

test('removing the opener placement only removes its instances/groups/overrides and retains the definition and other placement', async () => {
  const h = await fixture(), p = h.proposal('remove'); assert.equal((await h.runtime.applySceneCompositionPlacementsDraft(p)).applied, true);
  const after = decoded(h.current()); assert.deepEqual(after.fragments, h.value.recipe.fragments); assert.deepEqual(after.placements, [h.value.recipe.placements[1]]); untouched(h);
});

test('tampered edit, complete actor/group target receipt, source bytes, changed paths and revision cannot replace the editor', async () => {
  for (const alter of [p => { p.edit.placementId = p.edit.sourcePlacementId; }, p => { p.targets.actors.reverse(); },
    p => { p.targets.groups.reverse(); }, p => { p.targets.actors[0].objectId = p.sceneId; }, p => { p.targets.actors.pop(); },
    p => { p.targets.groups[0].groupId = p.targets.actors[0].instanceId; }, p => { p.targets.overrides[0].fields = []; },
    p => { p.targets.fragmentId = 'unused'; }, p => { p.afterContent += ' '; }, p => { p.changedPaths = []; },
    p => { p.sourceRevision = revision('other'); }, p => { p.baseSourceRevision = revision('other'); }]) {
    const h = await fixture(), p = copy(h.proposal('copy')); alter(p); await assert.rejects(h.runtime.applySceneCompositionPlacementsDraft(p));
    assert.equal(h.current(), h.value.source.content); untouched(h);
  }
});

test('placement source acquisition and application require a current writable ordinary source session', async () => {
  for (const alter of [h => { h.state.editInputMode = 'blocks'; }, h => { h.state.editInputMode = 'fields'; }, h => { h.state.isEditing = false; },
    h => { h.state.isCreating = true; }, h => { h.state.mode = 'browse'; }, h => { h.state.isMutatingWorld = true; }]) {
    const h = await fixture(); alter(h); assert.equal(await h.runtime.getSceneCompositionSource(h.value.source.sourcePath), null);
    await assert.rejects(h.runtime.applySceneCompositionPlacementsDraft(h.proposal('remove')), { errorCode: 'scene_composition_override_conflict' });
    assert.equal(h.current(), h.value.source.content); untouched(h);
  }
});

test('source edits while hashing invalidate a placement application and preserve the newer draft', async () => {
  const waiting = deferred(), reached = deferred(), h = await fixture({ crypto: { subtle: { digest: async (...args) => {
    reached.resolve(); await waiting.promise; return webcrypto.subtle.digest(...args);
  } } } });
  const applying = h.runtime.applySceneCompositionPlacementsDraft(h.proposal('copy')); await reached.promise;
  h.source.value += ' '; h.runtime.refreshEditSessionDirtyState(); const expected = h.current(); waiting.resolve();
  await assert.rejects(applying, { errorCode: 'scene_composition_override_conflict' }); assert.equal(h.current(), expected); untouched(h);
});

test('a closed preview rejects late preparation and committed focus cannot target a newer source session', async () => {
  const waiting = deferred(), reached = deferred(); let owns = true;
  const h = await fixture({ prepareSceneCompositionPlacementsApply: async (...args) => { const prepared = await prepare(...args); reached.resolve(); await waiting.promise; return prepared; } });
  const applying = h.runtime.applySceneCompositionPlacementsDraft(h.proposal('remove'), { isCurrent: () => owns }); await reached.promise;
  owns = false; waiting.resolve(); await assert.rejects(applying, { errorCode: 'scene_composition_override_conflict' }); assert.equal(h.current(), h.value.source.content); untouched(h);
  const valid = await fixture(), result = await valid.runtime.applySceneCompositionPlacementsDraft(valid.proposal('remove'));
  valid.source.focused = false; valid.source.value += ' '; valid.runtime.refreshEditSessionDirtyState(); result.focus(); assert.equal(valid.source.focused, false); untouched(valid);
});
