import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash, webcrypto } from 'node:crypto';
import { dispatchStudioCoreCompositionPlacement } from '../../engine/studio-core.mjs';
import { prepareSceneCompositionPlacementApply } from '../../engine/scene-composition-placement.mjs';
import { editorHarness, deferred } from './editor-harness.mjs';

const authored = JSON.parse(await fs.readFile(new URL('../../examples/scene-composition/recipe.json', import.meta.url), 'utf8'));
const saved = '\uFEFF' + (JSON.stringify(authored, null, 2) + '\n').replaceAll('\n', '\r\n');
const sourcePath = 'documents/scenes/recipe.json', sceneId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const placement = authored.placements[1], fragment = authored.fragments.find(f => f.fragmentId === placement.fragmentId);
const instanceId = placement.actorIds.leader, draftText = saved.replace('Two parties', '未保存の配方😀');
const hash = content => 'sha256:' + createHash('sha256').update(content).digest('hex');
const current = h => h.runtime.getSourceEditorContent();
function proposal(content = draftText, offset = [450, 90]) {
  const result = dispatchStudioCoreCompositionPlacement({ protocolVersion: 1, operation: 'sceneComposition.editPlacementOffset', content, placementId: placement.placementId, offset });
  return { sceneId, sourcePath, baseSourceRevision: hash(saved), sourceRevision: hash(content), instanceId,
    placementId: placement.placementId, fragmentId: placement.fragmentId, offset,
    targets: fragment.actors.map(a => ({ instanceId: placement.actorIds[a.key], actorKey: a.key })),
    groups: fragment.groups.map(g => ({ groupId: placement.groupIds[g.key], groupKey: g.key })), ...result };
}
async function fixture({ clean = false, ...overrides } = {}) {
  const reads = [], writes = [];
  const h = await editorHarness({ prepareSceneCompositionPlacementApply,
    readDocSource: async value => { reads.push(value); throw Error('Unexpected file read'); },
    writeDoc: async value => { writes.push(value); throw Error('Unexpected file write'); }, ...overrides });
  h.doc.sourcePath = sourcePath; h.doc._sourceCachedText = saved; h.runtime.rebuildDocPathCaches(h.state.docs);
  h.begin(saved, hash(saved)); h.state.activeEditSource = sourcePath; h.state.activeEditPath = h.doc.path;
  if (!clean) { h.source.value = draftText.replace(/\r\n|\r/g, '\n'); h.runtime.refreshEditSessionDirtyState(); }
  return { ...h, reads, writes };
}
function untouched(h) {
  assert.equal(h.doc._sourceCachedText, saved); assert.equal(h.state.activeEditSourceVersion, hash(saved));
  assert.equal(h.reads.length, 0); assert.equal(h.writes.length, 0);
}

test('clean placement source becomes a dirty in-memory draft while preserving the ordinary save preconditions', async () => {
  const h = await fixture({ clean: true }), request = proposal(saved);
  assert.equal((await h.runtime.getSceneCompositionSource(sourcePath)).content, saved);
  assert.equal((await h.runtime.applySceneCompositionPlacementDraft(request)).applied, true);
  assert.equal(current(h), request.afterContent); assert.equal(h.state.editHasUnsavedChanges, true);
  assert.equal(h.runtime.captureEditorDraft().baselineContent, saved); untouched(h);
});

test('dirty placement application preserves BOM, CRLF, cursor, OC declarations, instance overrides, mappings and every unrelated placement', async () => {
  const h = await fixture(), request = proposal(); h.source.setSelectionRange(2, 8); h.source.scrollTop = 37;
  assert.equal((await h.runtime.applySceneCompositionPlacementDraft(request)).applied, true);
  assert.equal(current(h), request.afterContent); assert.equal(h.source.selectionStart, 2); assert.equal(h.source.selectionEnd, 8); assert.equal(h.source.scrollTop, 37);
  assert.ok(current(h).startsWith('\uFEFF')); assert.ok(current(h).includes('\r\n')); assert.ok(current(h).includes('未保存の配方😀'));
  assert.equal(h.runtime.captureEditorDraft().baselineContent, saved); assert.equal(h.runtime.captureEditorDraft().expectedVersion, hash(saved));
  const value = JSON.parse(current(h).replace(/^\uFEFF/, ''));
  assert.deepEqual(value.fragments, authored.fragments); assert.deepEqual(value.placements[0], authored.placements[0]);
  assert.deepEqual(value.placements[1], { ...placement, offset: [450, 90] }); untouched(h);
});

test('restoring the optional offset deletes only its declaration and preserves all local overrides', async () => {
  const h = await fixture(), request = proposal(draftText, null);
  assert.equal((await h.runtime.applySceneCompositionPlacementDraft(request)).applied, true);
  const value = JSON.parse(current(h).replace(/^\uFEFF/, ''));
  assert.equal(Object.hasOwn(value.placements[1], 'offset'), false);
  const { offset, ...unchanged } = placement; assert.deepEqual(value.placements[1], unchanged); untouched(h);
});

test('altered target and group identities, ordering, candidate, paths and source revisions cannot replace the live editor', async () => {
  for (const alter of [p => { p.sourcePath = 'documents/elsewhere.json'; }, p => { p.baseSourceRevision = hash('other'); },
    p => { p.sourceRevision = hash(saved); }, p => { p.afterContent += ' '; }, p => { p.offset[0]++; }, p => { p.offset = null; },
    p => { p.targets.reverse(); }, p => { p.targets[0].instanceId = authored.placements[0].actorIds.leader; },
    p => { p.groups.reverse(); }, p => { p.groups[0].groupKey = 'foreign'; }, p => { p.changedPaths = []; }]) {
    const h = await fixture(), request = proposal(); alter(request);
    await assert.rejects(h.runtime.applySceneCompositionPlacementDraft(request)); assert.equal(current(h), draftText); untouched(h);
  }
});

test('field and block modes, inactive editors and busy states refuse placement source acquisition and application', async () => {
  for (const alter of [h => { h.state.editInputMode = 'blocks'; }, h => { h.state.editInputMode = 'fields'; },
    h => { h.state.isEditing = false; }, h => { h.state.isCreating = true; }, h => { h.state.mode = 'browse'; }, h => { h.state.isMutatingWorld = true; }]) {
    const h = await fixture(); alter(h); assert.equal(await h.runtime.getSceneCompositionSource(sourcePath), null);
    await assert.rejects(h.runtime.applySceneCompositionPlacementDraft(proposal()), { errorCode: 'scene_composition_override_conflict' });
    assert.equal(current(h), draftText); untouched(h);
  }
});

test('source changes while hashing invalidate placement application without losing the newer text', async () => {
  const waiting = deferred(), reached = deferred();
  const h = await fixture({ crypto: { subtle: { digest: async (...args) => { reached.resolve(); await waiting.promise; return webcrypto.subtle.digest(...args); } } } });
  const applying = h.runtime.applySceneCompositionPlacementDraft(proposal()); await reached.promise;
  h.source.value += ' '; h.runtime.refreshEditSessionDirtyState(); const expected = current(h); waiting.resolve();
  await assert.rejects(applying, { errorCode: 'scene_composition_override_conflict' }); assert.equal(current(h), expected); untouched(h);
});

test('late placement preparation cannot edit a replaced preview owner', async () => {
  const waiting = deferred(), reached = deferred(); let owns = true;
  const h = await fixture({ prepareSceneCompositionPlacementApply: async (...args) => {
    const result = await prepareSceneCompositionPlacementApply(...args); reached.resolve(); await waiting.promise; return result;
  } });
  const applying = h.runtime.applySceneCompositionPlacementDraft(proposal(), { isCurrent: () => owns }); await reached.promise;
  owns = false; waiting.resolve(); await assert.rejects(applying, { errorCode: 'scene_composition_override_conflict' }); assert.equal(current(h), draftText); untouched(h);
});

test('placement proposals and focus receipts cannot be replayed into later source sessions', async () => {
  const h = await fixture(), request = proposal(), receipt = await h.runtime.applySceneCompositionPlacementDraft(request);
  await assert.rejects(h.runtime.applySceneCompositionPlacementDraft(request), { errorCode: 'scene_composition_override_conflict' });
  h.source.focused = false; h.source.value += ' '; h.runtime.refreshEditSessionDirtyState(); receipt.focus(); assert.equal(h.source.focused, false); untouched(h);
});
