import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { createSceneCompositionGroupsDraft, prepareSceneCompositionGroupsApply } from '../../engine/scene-composition-groups.mjs';
import { groupsFixture, copy, decoded, hash, revision } from './scene-composition-groups-fixture.mjs';
import { editorHarness, deferred } from './editor-harness.mjs';

const prepare = (source, proposal, options) => prepareSceneCompositionGroupsApply(copy(source), copy(proposal), options);
async function fixture({ clean = false, ...overrides } = {}) {
  const value = await groupsFixture({ dirty: !clean }), writes = [], reads = [];
  const h = await editorHarness({ prepareSceneCompositionGroupsApply: prepare,
    readDocSource: async value => { reads.push(value); throw Error('Unexpected file read'); },
    writeDoc: async value => { writes.push(value); throw Error('Unexpected file write'); }, ...overrides });
  h.doc.sourcePath = value.source.sourcePath; h.doc._sourceCachedText = value.saved; h.runtime.rebuildDocPathCaches(h.state.docs);
  h.begin(value.saved, revision(value.saved)); h.state.activeEditSource = value.source.sourcePath; h.state.activeEditPath = h.doc.path;
  if (!clean) { h.source.value = value.source.content.replace(/\r\n|\r/g, '\n'); h.runtime.refreshEditSessionDirtyState(); }
  const draft = await createSceneCompositionGroupsDraft(value.model, value.source, { digest: hash });
  const proposal = action => draft.propose(action === 'remove' ? { action, fragmentId: 'party', groupKey: 'spare' }
    : action === 'assign' ? { action, fragmentId: 'party', actorKey: 'leader', groupKey: 'spare' }
    : action === 'edit' ? { action, fragmentId: 'party', groupKey: 'spare', name: '  Changed group😀  ', parentKey: null }
    : { action: 'add', fragmentId: 'party', group: { key: 'fresh', name: 'Fresh group', parentKey: 'companions' },
      instances: value.recipe.placements.map(item => ({ placementId: item.placementId, groupId: webcrypto.randomUUID() })) });
  return { ...h, value, writes, reads, proposal, current: () => h.runtime.getSourceEditorContent() };
}
function untouched(h) { assert.equal(h.doc._sourceCachedText, h.value.saved); assert.equal(h.state.activeEditSourceVersion, revision(h.value.saved));
  const captured = h.runtime.captureEditorDraft(); if (captured) { assert.equal(captured.baselineContent, h.value.saved); assert.equal(captured.expectedVersion, revision(h.value.saved)); }
  assert.equal(h.reads.length, 0); assert.equal(h.writes.length, 0); }


test('new organization groups become an unsaved source draft without changing ordinary Save baseline or saved cache', async () => {
  const h = await fixture({ clean: true }), p = h.proposal('add'); assert.equal((await h.runtime.applySceneCompositionGroupsDraft(p)).applied, true);
  assert.equal(h.current(), p.afterContent); assert.equal(h.state.editHasUnsavedChanges, true);
  assert.equal(decoded(h.current()).fragments[0].groups.at(-1).key, 'fresh'); untouched(h);
});

test('group names and parent declarations preserve name spaces, source format, selection, identity and all actor geometry', async () => {
  const h = await fixture(), p = h.proposal('edit'); h.source.setSelectionRange(3, 11); h.source.scrollTop = 34;
  assert.equal((await h.runtime.applySceneCompositionGroupsDraft(p)).applied, true); const after = decoded(h.current());
  assert.equal(after.fragments[0].groups.at(-1).name, '  Changed group😀  '); assert.equal(Object.hasOwn(after.fragments[0].groups.at(-1), 'parentKey'), false);
  assert.deepEqual(after.fragments[0].actors, h.value.recipe.fragments[0].actors); assert.deepEqual(after.placements, h.value.recipe.placements);
  assert.equal(h.current().startsWith('\uFEFF'), true); assert.equal(h.current().includes('\r\n'), true); assert.equal(h.current().includes('未保存😀'), true);
  assert.equal(h.source.selectionStart, 3); assert.equal(h.source.selectionEnd, 11); assert.equal(h.source.scrollTop, 34); untouched(h);
});

test('actor membership applies only the shared declaration while preserving every placement and runtime field', async () => {
  const h = await fixture(), p = h.proposal('assign'); assert.equal((await h.runtime.applySceneCompositionGroupsDraft(p)).applied, true);
  const after = decoded(h.current()); assert.equal(after.fragments[0].actors[0].groupKey, 'spare'); assert.deepEqual(after.placements, h.value.recipe.placements);
  const { groupKey: beforeGroup, ...before } = h.value.recipe.fragments[0].actors[0], { groupKey: afterGroup, ...actor } = after.fragments[0].actors[0];
  assert.notEqual(beforeGroup, afterGroup); assert.deepEqual(actor, before); untouched(h);
});

test('empty leaf removal deletes only its declaration and per-placement mappings without moving members or reordering actors', async () => {
  const h = await fixture(), p = h.proposal('remove'); assert.equal((await h.runtime.applySceneCompositionGroupsDraft(p)).applied, true);
  const after = decoded(h.current()); assert.deepEqual(after.fragments[0].actors, h.value.recipe.fragments[0].actors); assert.equal(after.fragments[0].groups.length, 2);
  for (const [index, placement] of after.placements.entries()) { const { groupIds: oldGroups, ...original } = h.value.recipe.placements[index], { groupIds, ...rest } = placement;
    assert.deepEqual(rest, original); assert.equal(Object.hasOwn(groupIds, 'spare'), false); assert.deepEqual(Object.keys(groupIds), ['party', 'companions']); }
  untouched(h);
});

test('forged complete organizational targets, intents, source bytes, revisions and changed paths never replace author source', async () => {
  for (const alter of [p => { p.edit.group.name = 'Forged'; }, p => { p.edit.instances.reverse(); }, p => { p.targets.reverse(); }, p => { p.targets[0].groups.reverse(); },
    p => { p.targets[0].actors.reverse(); }, p => { p.targets[0].groups[0].name = 'Forged'; }, p => { p.targets[0].groups[0].parentGroupId = p.targets[0].groups[1].groupId; },
    p => { p.targets[0].actors[0].groupId = null; }, p => { p.targets[0].actors[0].objectId = p.sceneId; }, p => { p.targets[0].groups.pop(); },
    p => { p.afterContent += ' '; }, p => { p.changedPaths = []; }, p => { p.sourceRevision = revision('other'); }, p => { p.baseSourceRevision = revision('other'); }]) {
    const h = await fixture(), p = copy(h.proposal('add')); alter(p); await assert.rejects(h.runtime.applySceneCompositionGroupsDraft(p));
    assert.equal(h.current(), h.value.source.content); untouched(h);
  }
});

test('organizational edits require an owned writable source editor; fields, blocks, create, browse and busy modes are refused', async () => {
  for (const alter of [h => { h.state.editInputMode = 'blocks'; }, h => { h.state.editInputMode = 'fields'; }, h => { h.state.isEditing = false; },
    h => { h.state.isCreating = true; }, h => { h.state.mode = 'browse'; }, h => { h.state.isMutatingWorld = true; }]) {
    const h = await fixture(); alter(h); assert.equal(await h.runtime.getSceneCompositionSource(h.value.source.sourcePath), null);
    await assert.rejects(h.runtime.applySceneCompositionGroupsDraft(h.proposal('remove')), { errorCode: 'scene_composition_override_conflict' });
    assert.equal(h.current(), h.value.source.content); untouched(h);
  }
});

test('source edits during asynchronous hashing revoke a group edit and preserve the newer source draft', async () => {
  const waiting = deferred(), reached = deferred(), h = await fixture({ crypto: { subtle: { digest: async (...args) => {
    reached.resolve(); await waiting.promise; return webcrypto.subtle.digest(...args);
  } } } }); const applying = h.runtime.applySceneCompositionGroupsDraft(h.proposal('add')); await reached.promise;
  h.source.value += ' '; h.runtime.refreshEditSessionDirtyState(); const expected = h.current(); waiting.resolve();
  await assert.rejects(applying, { errorCode: 'scene_composition_override_conflict' }); assert.equal(h.current(), expected); untouched(h);
});

test('parent closure during pure preparation blocks delayed application and later focus cannot target a changed source session', async () => {
  const waiting = deferred(), reached = deferred(); let owns = true;
  const h = await fixture({ prepareSceneCompositionGroupsApply: async (...args) => { const prepared = await prepare(...args); reached.resolve(); await waiting.promise; return prepared; } });
  const applying = h.runtime.applySceneCompositionGroupsDraft(h.proposal('remove'), { isCurrent: () => owns }); await reached.promise;
  owns = false; waiting.resolve(); await assert.rejects(applying, { errorCode: 'scene_composition_override_conflict' }); assert.equal(h.current(), h.value.source.content); untouched(h);
  const valid = await fixture(), result = await valid.runtime.applySceneCompositionGroupsDraft(valid.proposal('assign')); valid.source.focused = false;
  valid.source.value += ' '; valid.runtime.refreshEditSessionDirtyState(); result.focus(); assert.equal(valid.source.focused, false); untouched(valid);
});
