import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { createSceneCompositionDefinitionsDraft, prepareSceneCompositionDefinitionsApply } from '../../engine/scene-composition-definitions.mjs';
import { definitionsFixture, copy, decoded, hash, revision, ids } from './scene-composition-definitions-fixture.mjs';
import { editorHarness, deferred } from './editor-harness.mjs';

const prepare = (source, proposal, options) => prepareSceneCompositionDefinitionsApply(copy(source), copy(proposal), options);
async function fixture({ clean = false, ...overrides } = {}) {
  const value = await definitionsFixture({ dirty: !clean }), writes = [], reads = [];
  const h = await editorHarness({ prepareSceneCompositionDefinitionsApply: prepare,
    readDocSource: async value => { reads.push(value); throw Error('Unexpected file read'); },
    writeDoc: async value => { writes.push(value); throw Error('Unexpected file write'); }, ...overrides });
  h.doc.sourcePath = value.source.sourcePath; h.doc._sourceCachedText = value.saved; h.runtime.rebuildDocPathCaches(h.state.docs);
  h.begin(value.saved, revision(value.saved)); h.state.activeEditSource = value.source.sourcePath; h.state.activeEditPath = h.doc.path;
  if (!clean) { h.source.value = value.source.content.replace(/\r\n|\r/g, '\n'); h.runtime.refreshEditSessionDirtyState(); }
  const draft = await createSceneCompositionDefinitionsDraft(value.model, value.source, { digest: hash });
  const proposal = action => draft.propose(action === 'remove' ? { action, fragmentId: 'unused' }
    : action === 'copy' ? { action, sourceFragmentId: 'party', fragmentId: 'copiedParty' }
    : { action: 'add', fragment: { fragmentId: 'newDefinition', groups: [], actors: [{ key: 'hero', objectId: ids.core,
      position: [20, 30], size: [40, 50], color: '#ffffff', speed: 0, controls: 'none', imageResourceId: ids.image }] } });
  return { ...h, value, writes, reads, proposal, current: () => h.runtime.getSourceEditorContent() };
}
function untouched(h) { assert.equal(h.doc._sourceCachedText, h.value.saved); assert.equal(h.state.activeEditSourceVersion, revision(h.value.saved));
  const captured = h.runtime.captureEditorDraft(); if (captured) { assert.equal(captured.baselineContent, h.value.saved); assert.equal(captured.expectedVersion, revision(h.value.saved)); }
  assert.equal(h.reads.length, 0); assert.equal(h.writes.length, 0); }

test('ADD applies one unplaced definition only in source memory and preserves the normal saved baseline', async () => {
  const h = await fixture({ clean: true }), p = h.proposal('add'); assert.equal((await h.runtime.applySceneCompositionDefinitionsDraft(p)).applied, true);
  assert.equal(h.current(), p.afterContent); assert.equal(h.state.editHasUnsavedChanges, true); assert.deepEqual(decoded(h.current()).placements, h.value.recipe.placements);
  assert.deepEqual(decoded(h.current()).fragments.at(-1), p.edit.fragment); assert.deepEqual(p.targets, []); untouched(h);
});

test('COPY preserves all raw author fields and existing instance identities, current selection and formatting', async () => {
  const h = await fixture(), p = h.proposal('copy'); h.source.setSelectionRange(3, 11); h.source.scrollTop = 34;
  assert.equal((await h.runtime.applySceneCompositionDefinitionsDraft(p)).applied, true); const after = decoded(h.current());
  assert.deepEqual(after.fragments.at(-1), { ...h.value.recipe.fragments[0], fragmentId: 'copiedParty' }); assert.deepEqual(after.placements, h.value.recipe.placements);
  assert.equal(h.current().startsWith('\uFEFF'), true); assert.equal(h.current().includes('\r\n'), true); assert.equal(h.current().includes('1.60e2'), true);
  assert.equal(h.current().includes('未保存😀'), true); assert.equal(h.source.selectionStart, 3); assert.equal(h.source.selectionEnd, 11); assert.equal(h.source.scrollTop, 34); untouched(h);
});

test('REMOVE changes only an unplaced declaration and leaves all authored scene structure and placement mappings intact', async () => {
  const h = await fixture(), p = h.proposal('remove'); assert.equal((await h.runtime.applySceneCompositionDefinitionsDraft(p)).applied, true);
  const after = decoded(h.current()); assert.deepEqual(after.fragments, [h.value.recipe.fragments[0]]); assert.deepEqual(after.placements, h.value.recipe.placements);
  assert.deepEqual(p.targets, []); untouched(h);
});

test('forged intent, nonempty targets, candidate bytes, paths, source revisions or identities never replace the source', async () => {
  for (const alter of [p => { p.edit.fragmentId = 'forged'; }, p => { p.edit.sourceFragmentId = 'unused'; }, p => { p.targets = [{ fragmentId: 'party' }]; },
    p => { p.afterContent += ' '; }, p => { p.afterContent = p.afterContent.replace('"controls": "none"', '"controls": "arrows"'); },
    p => { p.changedPaths = []; }, p => { p.changedPaths.push('/placements/0'); }, p => { p.sourceRevision = revision('other'); },
    p => { p.baseSourceRevision = revision('other'); }, p => { p.sceneId = 'not-a-uuid'; }, p => { p.sourcePath = 'other.json'; }]) {
    const h = await fixture(), p = copy(h.proposal('copy')); alter(p); await assert.rejects(h.runtime.applySceneCompositionDefinitionsDraft(p)); assert.equal(h.current(), h.value.source.content); untouched(h);
  }
});

test('definition changes require the owned writable source editor and never gain create, blocks, fields or busy permissions', async () => {
  for (const alter of [h => { h.state.editInputMode = 'blocks'; }, h => { h.state.editInputMode = 'fields'; }, h => { h.state.isEditing = false; },
    h => { h.state.isCreating = true; }, h => { h.state.mode = 'browse'; }, h => { h.state.isMutatingWorld = true; }]) {
    const h = await fixture(); alter(h); assert.equal(await h.runtime.getSceneCompositionSource(h.value.source.sourcePath), null);
    await assert.rejects(h.runtime.applySceneCompositionDefinitionsDraft(h.proposal('remove')), { errorCode: 'scene_composition_override_conflict' });
    assert.equal(h.current(), h.value.source.content); untouched(h);
  }
});

test('source changes during asynchronous hashing retain the newer author draft and reject the prior definition proposal', async () => {
  const waiting = deferred(), reached = deferred(), h = await fixture({ crypto: { subtle: { digest: async (...args) => {
    reached.resolve(); await waiting.promise; return webcrypto.subtle.digest(...args);
  } } } }); const applying = h.runtime.applySceneCompositionDefinitionsDraft(h.proposal('add')); await reached.promise;
  h.source.value += ' '; h.runtime.refreshEditSessionDirtyState(); const expected = h.current(); waiting.resolve();
  await assert.rejects(applying, { errorCode: 'scene_composition_override_conflict' }); assert.equal(h.current(), expected); untouched(h);
});

test('parent closure during preparation rejects delayed application and completion focus cannot target a later edited source', async () => {
  const waiting = deferred(), reached = deferred(); let owns = true;
  const h = await fixture({ prepareSceneCompositionDefinitionsApply: async (...args) => { const prepared = await prepare(...args); reached.resolve(); await waiting.promise; return prepared; } });
  const applying = h.runtime.applySceneCompositionDefinitionsDraft(h.proposal('remove'), { isCurrent: () => owns }); await reached.promise;
  owns = false; waiting.resolve(); await assert.rejects(applying, { errorCode: 'scene_composition_override_conflict' }); assert.equal(h.current(), h.value.source.content); untouched(h);
  const valid = await fixture(), result = await valid.runtime.applySceneCompositionDefinitionsDraft(valid.proposal('copy')); valid.source.focused = false;
  valid.source.value += ' '; valid.runtime.refreshEditSessionDirtyState(); result.focus(); assert.equal(valid.source.focused, false); untouched(valid);
});
