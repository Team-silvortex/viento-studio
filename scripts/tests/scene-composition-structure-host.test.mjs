import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash, webcrypto } from 'node:crypto';
import { dispatchStudioCoreCompositionStructure } from '../../engine/studio-core.mjs';
import { prepareSceneCompositionStructureApply } from '../../engine/scene-composition-structure.mjs';
import { editorHarness, deferred } from './editor-harness.mjs';

const authored = JSON.parse(await fs.readFile(new URL('../../examples/scene-composition/recipe.json', import.meta.url), 'utf8'));
const saved = '\uFEFF' + (JSON.stringify(authored, null, 2) + '\n').replaceAll('\n', '\r\n');
const sourcePath = 'documents/scenes/recipe.json', sceneId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const draftText = saved.replace('Two parties', '未保存の構造😀');
const hash = content => 'sha256:' + createHash('sha256').update(content).digest('hex');
const current = h => h.runtime.getSourceEditorContent();
// The VM controller's constructed snapshots cross a JSON boundary into this
// host-module test; product code runs both sides in the same browser realm.
const prepare = (source, proposal, options) => prepareSceneCompositionStructureApply(JSON.parse(JSON.stringify(source)), JSON.parse(JSON.stringify(proposal)), options);
function proposal(content = draftText, action = 'remove') {
  const edit = action === 'remove' ? { action, fragmentId: 'party', actorKey: 'leader' } : { action, fragmentId: 'party',
    actor: { key: 'newActor', objectId: authored.fragments[0].actors[0].objectId, position: [80, 90], size: [24, 24], color: '#123456', speed: 0, controls: 'none' },
    instances: authored.placements.map((p, i) => ({ placementId: p.placementId, instanceId: `9000000${i}-1111-4111-8111-111111111111` })) };
  const patch = dispatchStudioCoreCompositionStructure({ protocolVersion: 1, operation: action === 'remove' ? 'sceneComposition.removeFragmentActor' : 'sceneComposition.addFragmentActor', content, fragmentId: edit.fragmentId,
    ...(action === 'remove' ? { actorKey: edit.actorKey } : { actor: edit.actor, instances: edit.instances }) });
  const fields = ['position', 'size', 'color', 'speed', 'controls', 'imageResourceId'];
  const targets = action === 'remove' ? authored.placements.map(p => ({ placementId: p.placementId, instanceId: p.actorIds.leader, actorKey: 'leader',
    overrides: fields.filter(field => Object.hasOwn(p.overrides?.find(o => o.actorKey === 'leader')?.values || {}, field)) }))
    : edit.instances.map(p => ({ ...p, actorKey: edit.actor.key, overrides: [] }));
  return { sceneId, sourcePath, baseSourceRevision: hash(saved), sourceRevision: hash(content), edit, targets, ...patch };
}
async function fixture({ clean = false, ...overrides } = {}) {
  const writes = [], reads = [];
  const h = await editorHarness({ prepareSceneCompositionStructureApply: prepare,
    readDocSource: async value => { reads.push(value); throw Error('Unexpected file read'); },
    writeDoc: async value => { writes.push(value); throw Error('Unexpected file write'); }, ...overrides });
  h.doc.sourcePath = sourcePath; h.doc._sourceCachedText = saved; h.runtime.rebuildDocPathCaches(h.state.docs);
  h.begin(saved, hash(saved)); h.state.activeEditSource = sourcePath; h.state.activeEditPath = h.doc.path;
  if (!clean) { h.source.value = draftText.replace(/\r\n|\r/g, '\n'); h.runtime.refreshEditSessionDirtyState(); }
  return { ...h, writes, reads };
}
function untouched(h) {
  assert.equal(h.doc._sourceCachedText, saved); assert.equal(h.state.activeEditSourceVersion, hash(saved));
  const snapshot = h.runtime.captureEditorDraft();
  if (snapshot) { assert.equal(snapshot.baselineContent, saved); assert.equal(snapshot.expectedVersion, hash(saved)); }
  assert.equal(h.reads.length, 0); assert.equal(h.writes.length, 0);
}

test('clean source accepts a new fragment member as a dirty draft with unchanged save baseline', async () => {
  const h = await fixture({ clean: true }), p = proposal(saved, 'add');
  assert.equal((await h.runtime.applySceneCompositionStructureDraft(p)).applied, true);
  assert.equal(current(h), p.afterContent); assert.equal(h.state.editHasUnsavedChanges, true); untouched(h);
});

test('removing the selected opener preserves BOM/CRLF, original OC and resource, groups, other identities and editor selection', async () => {
  const h = await fixture(), p = proposal(); h.source.setSelectionRange(2, 8); h.source.scrollTop = 37;
  assert.equal((await h.runtime.applySceneCompositionStructureDraft(p)).applied, true);
  assert.equal(current(h), p.afterContent); assert.ok(current(h).startsWith('\uFEFF')); assert.ok(current(h).includes('\r\n'));
  assert.ok(current(h).includes('未保存の構造😀')); assert.equal(h.source.selectionStart, 2); assert.equal(h.source.selectionEnd, 8); assert.equal(h.source.scrollTop, 37);
  const after = JSON.parse(current(h).slice(1)); assert.deepEqual(after.fragments[0].groups, authored.fragments[0].groups);
  assert.deepEqual(after.fragments[0].actors, [authored.fragments[0].actors[1]]);
  for (const [i, placement] of after.placements.entries()) {
    assert.deepEqual(placement.actorIds, { companion: authored.placements[i].actorIds.companion });
    assert.deepEqual(placement.groupIds, authored.placements[i].groupIds);
    assert.equal(placement.overrides?.some(o => o.actorKey === 'leader') || false, false);
  }
  assert.equal(after.fragments[0].actors[0].imageResourceId, authored.fragments[0].actors[1].imageResourceId); untouched(h);
});

test('altered edit, target IDs/overrides, candidate bytes, paths or revisions cannot replace live source', async () => {
  for (const alter of [p => { p.edit.actorKey = 'companion'; }, p => { p.targets.reverse(); }, p => { p.targets[0].instanceId = sceneId; },
    p => { p.targets[1].overrides = []; }, p => { p.afterContent += ' '; }, p => { p.changedPaths = []; },
    p => { p.sourcePath = 'documents/elsewhere.json'; }, p => { p.sourceRevision = hash(saved); }, p => { p.baseSourceRevision = hash('other'); }]) {
    const h = await fixture(), p = proposal(); alter(p);
    await assert.rejects(h.runtime.applySceneCompositionStructureDraft(p)); assert.equal(current(h), draftText); untouched(h);
  }
});

test('source acquisition and structure apply require a current writable source editor', async () => {
  for (const alter of [h => { h.state.editInputMode = 'blocks'; }, h => { h.state.editInputMode = 'fields'; }, h => { h.state.isEditing = false; },
    h => { h.state.isCreating = true; }, h => { h.state.mode = 'browse'; }, h => { h.state.isMutatingWorld = true; }]) {
    const h = await fixture(); alter(h); assert.equal(await h.runtime.getSceneCompositionSource(sourcePath), null);
    await assert.rejects(h.runtime.applySceneCompositionStructureDraft(proposal()), { errorCode: 'scene_composition_override_conflict' });
    assert.equal(current(h), draftText); untouched(h);
  }
});

test('author text changes during digest preserve newer input and reject structural application', async () => {
  const waiting = deferred(), reached = deferred();
  const h = await fixture({ crypto: { subtle: { digest: async (...args) => { reached.resolve(); await waiting.promise; return webcrypto.subtle.digest(...args); } } } });
  const applying = h.runtime.applySceneCompositionStructureDraft(proposal()); await reached.promise;
  h.source.value += ' '; h.runtime.refreshEditSessionDirtyState(); const expected = current(h); waiting.resolve();
  await assert.rejects(applying, { errorCode: 'scene_composition_override_conflict' }); assert.equal(current(h), expected); untouched(h);
});

test('late preparation cannot apply to a closed/replaced preview owner', async () => {
  const waiting = deferred(), reached = deferred(); let owns = true;
  const h = await fixture({ prepareSceneCompositionStructureApply: async (...args) => {
    const value = await prepare(...args); reached.resolve(); await waiting.promise; return value;
  } });
  const applying = h.runtime.applySceneCompositionStructureDraft(proposal(), { isCurrent: () => owns }); await reached.promise;
  owns = false; waiting.resolve(); await assert.rejects(applying, { errorCode: 'scene_composition_override_conflict' }); assert.equal(current(h), draftText); untouched(h);
});

test('successful structural receipt and proposal cannot be replayed into a newer source session', async () => {
  const h = await fixture(), p = proposal(), result = await h.runtime.applySceneCompositionStructureDraft(p);
  await assert.rejects(h.runtime.applySceneCompositionStructureDraft(p));
  h.source.focused = false; h.source.value += ' '; h.runtime.refreshEditSessionDirtyState(); result.focus(); assert.equal(h.source.focused, false); untouched(h);
});
