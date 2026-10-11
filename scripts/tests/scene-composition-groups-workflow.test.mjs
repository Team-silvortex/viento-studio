import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSceneCompositionGroupsDraft } from '../../engine/scene-composition-groups.mjs';
import { validateSceneAuthoringCandidate } from '../../engine/scene-authoring-candidate.mjs';
import { createSceneAuthoringWorkflow } from '../../engine/scene-authoring-workflow.mjs';
import { resolveSceneCompositionPreview } from '../../engine/scene-composition-preview.mjs';
import { createWorldProjection } from '../../engine/world-projection.mjs';
import { scene2DModelToPlan } from '../../engine/build-plan.mjs';
import { createSceneStructure } from '../../engine/scene-structure.mjs';
import { placementsFixture, hash, revision, copy, ids } from './scene-composition-placements-fixture.mjs';

const id = n => `${n.toString(16).padStart(8, '0')}-2222-4222-8222-222222222222`;
const invalid = { errorCode: 'scene_composition_override_invalid' };
const conflict = { errorCode: 'scene_composition_override_conflict' };
const serialize = value => '\uFEFF' + JSON.stringify(value, null, '\t').replaceAll('\n', '\r\n') + '\r\n \t';
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };
// Source ranges and revisions advance after a source edit. Every effective
// actor field, including order and definition/projection origins, stays fixed.
const effectiveActors = actors => actors.map(({ fieldSources, declaration, ...actor }) => actor);

async function preview(observedSource, content, baseSourceRevision) {
  const observed = copy(observedSource);
  const document = observed.source.documents.find(item => item.record.id === ids.scene);
  document.content = content; document.sourceRevision = revision(content);
  observed.projection = await createWorldProjection(observed.source, { digest: hash });
  const result = await resolveSceneCompositionPreview(observed, ids.scene, { digest: hash });
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  const plan = scene2DModelToPlan(result.model);
  return { ok: true, format: 'viento-scene-preview', schemaVersion: 2, previewId: id(999), scene: plan.scene, actors: plan.actors,
    composition: result.composition, sourceLocations: result.model.sourceLocations, sceneStructure: createSceneStructure(result.model),
    draft: { baseSourceRevision, sourceRevision: revision(content) } };
}
async function fixture(dirty = false) {
  const original = await placementsFixture(), recipe = copy(original.recipe);
  recipe.fragments[0].groups.push({ key: 'spare', name: 'Empty 😀' });
  recipe.placements.forEach((placement, index) => { placement.groupIds.spare = id(710 + index); });
  const saved = serialize(recipe), content = dirty ? saved.replace('Two parties', '未保存 😀') : saved;
  const source = { sourcePath: original.source.sourcePath, baseSourceRevision: revision(saved), content };
  const model = await preview(original.observed, content, source.baseSourceRevision);
  const draft = await createSceneCompositionGroupsDraft(model, source, { digest: hash });
  const proposals = [
    draft.propose({ action: 'add', fragmentId: 'party', group: { key: 'extra', name: '新组', parentKey: 'party' },
      instances: recipe.placements.map((placement, index) => ({ placementId: placement.placementId, groupId: id(900 + index) })) }),
    draft.propose({ action: 'edit', fragmentId: 'party', groupKey: 'companions', name: 'Renamed 子组', parentKey: null }),
    draft.propose({ action: 'assign', fragmentId: 'party', actorKey: 'leader', groupKey: 'companions' }),
    draft.propose({ action: 'assign', fragmentId: 'party', actorKey: 'companion', groupKey: null }),
    draft.propose({ action: 'remove', fragmentId: 'party', groupKey: 'spare' }),
    draft.propose({ action: 'add', fragmentId: 'unused', group: { key: 'extra', name: 'Dormant' }, instances: [] }),
  ];
  return { recipe, model, source, proposals, observed: original.observed };
}
const run = (proposal, payload) => validateSceneAuthoringCandidate('groups', proposal, payload, { sourceRevision: revision(proposal.afterContent) });

test('group four-action candidates use real complete saved and dirty previews without changing runtime actor order or positions', async () => {
  for (const dirty of [false, true]) {
    const f = await fixture(dirty);
    for (const proposal of f.proposals) {
      const payload = await preview(f.observed, proposal.afterContent, f.source.baseSourceRevision);
      assert.equal(run(proposal, payload).kind, 'groups');
      assert.deepEqual(effectiveActors(payload.actors), effectiveActors(f.model.actors));
      if (proposal.edit.fragmentId === 'unused') assert.deepEqual(proposal.targets, []);
    }
  }
});

test('group candidate rejects same-identity forged names parents presence order and extra organization fields', async () => {
  const f = await fixture(), proposal = f.proposals[1];
  const payload = await preview(f.observed, proposal.afterContent, f.source.baseSourceRevision);
  for (const change of [
    p => { p.sceneStructure.groups[0].name = 'Forged valid name'; },
    p => { p.sceneStructure.groups[1].parentGroupId = p.sceneStructure.groups[0].groupId; },
    p => { p.sceneStructure.groups[0].parentGroupId = null; },
    p => { delete p.sceneStructure.groups[0].name; },
    p => { p.sceneStructure.groups.reverse(); },
    p => { p.sceneStructure.groups[0].position = [10, 20]; },
    p => { p.sceneStructure.groups.push({ ...p.sceneStructure.groups[0] }); },
    p => { p.sceneStructure.groups.pop(); },
    p => { p.sceneStructure.schemaVersion = 2; },
    p => { p.sceneStructure.sourceSchemaVersion = 2; },
    p => { p.sceneStructure.format = 'other'; },
    p => { p.sceneStructure.extra = true; },
  ]) {
    const value = copy(payload); change(value); assert.throws(() => run(proposal, value), invalid);
  }
});

test('group candidate binds exact ordered memberships even when every actor and group identity is otherwise genuine', async () => {
  const f = await fixture(), proposal = f.proposals[2];
  const payload = await preview(f.observed, proposal.afterContent, f.source.baseSourceRevision);
  for (const change of [
    p => { delete p.sceneStructure.memberships; },
    p => { p.sceneStructure.memberships = []; },
    p => { p.sceneStructure.memberships.pop(); },
    p => { p.sceneStructure.memberships.push({ ...p.sceneStructure.memberships[0] }); },
    p => { p.sceneStructure.memberships.reverse(); },
    p => { p.sceneStructure.memberships[0].groupId = p.sceneStructure.groups[0].groupId; },
    p => { p.sceneStructure.memberships[0].instanceId = p.actors[1].instanceId; },
    p => { p.sceneStructure.memberships[0].extra = null; },
    p => { p.actors[0].groupId = p.sceneStructure.groups[0].groupId; },
  ]) {
    const value = copy(payload); change(value); assert.throws(() => run(proposal, value), invalid);
  }
  const enriched = copy(payload);
  for (const actor of enriched.actors) actor.groupId = enriched.sceneStructure.memberships.find(item => item.instanceId === actor.instanceId).groupId;
  assert.equal(run(proposal, enriched).kind, 'groups');
  const ungrouped = f.proposals[3], ungroupedPayload = await preview(f.observed, ungrouped.afterContent, f.source.baseSourceRevision);
  ungroupedPayload.actors[1].groupId = undefined;
  assert.throws(() => run(ungrouped, ungroupedPayload), invalid);
});

test('group candidate rejects foreign incomplete or reordered contribution provenance and forbidden execution receipts', async () => {
  const f = await fixture(), proposal = f.proposals[0];
  const payload = await preview(f.observed, proposal.afterContent, f.source.baseSourceRevision);
  for (const change of [
    p => { p.sourceLocations.groups.reverse(); }, p => { p.sourceLocations.groups.pop(); },
    p => { p.sourceLocations.groups[0].composition.localKey = 'extra'; },
    p => { p.sourceLocations.groups[0].declaration.sourcePath = 'foreign.json'; },
    p => { p.sourceLocations.groups[0].declaration.sourceRevision = revision('stale'); },
    p => { p.sourceLocations.actors.pop(); }, p => { p.sourceLocations.actors.reverse(); },
    p => { p.sourceLocations.actors[0].objectId = id(880); },
    p => { p.composition.fragmentCount++; }, p => { p.composition.placementCount--; },
    p => { p.scene.sourceRevision = revision('foreign'); },
    p => { p.draft.baseSourceRevision = revision('foreign'); },
    p => { p.snapshot = {}; }, p => { p.sceneEditing = {}; },
  ]) {
    const value = copy(payload); change(value); assert.throws(() => run(proposal, value), invalid);
  }
});

async function workflowFixture(overrides = {}) {
  const f = await fixture(), proposal = f.proposals[2];
  const state = { open: true, session: 1, selected: ids.scene, sourcePath: f.source.sourcePath, previewSupported: true, previewActive: true,
    requestBusy: false, running: false, backend: { available: false }, context: { editable: true, creating: false, busy: false,
      compositionSourceWritable: true, sceneDraftPath: f.source.sourcePath, sceneDraftToken: 'draft:1' } };
  const calls = { apply: [], released: [], applied: [] }, receipt = { applied: true };
  const ports = { kind: 'groups', capabilityKey: 'canEditCompositionGroups', isSupported: () => true,
    getState: () => state, getSource: async () => f.source,
    reviewCandidate: async value => preview(f.observed, value.afterContent, value.baseSourceRevision),
    releasePreview: identity => calls.released.push(identity), digest: async value => hash(value),
    applyDraft: async (value, guard) => { assert.equal(guard.isCurrent(), true); calls.apply.push(value); state.context.sceneDraftToken = 'draft:2'; return receipt; },
    onApplied: (result, value) => calls.applied.push({ result, value }), ...overrides };
  return { ...f, proposal, state, calls, receipt, ports, workflow: createSceneAuthoringWorkflow(ports) };
}

test('group authoring exposes only its capability and applies one detached source receipt without execution availability', async () => {
  const f = await workflowFixture(); assert.equal(f.workflow.canEdit(), true);
  assert.deepEqual(Object.keys(f.workflow.getContext()).sort(), ['editable', 'creating', 'busy', 'compositionSourceWritable', 'sceneDraftPath', 'sceneDraftToken', 'canEditCompositionGroups'].sort());
  const opened = [];
  assert.equal(await f.workflow.open({ open: async value => { opened.push(value); return true; } }, { model: f.model, actorId: null, isCurrent: () => true }), true);
  assert.notEqual(opened[0].source, f.source);
  assert.deepEqual(await f.workflow.validateDraft(f.proposal), { ok: true });
  const result = await f.workflow.applySourceDraft(f.proposal);
  assert.equal(f.workflow.sourceApplied(result, f.proposal), true); assert.equal(f.calls.apply.length, 1);
  assert.notEqual(f.calls.apply[0], f.proposal); assert.equal(f.workflow.sourceApplied(result, f.proposal), false);
  assert.deepEqual(f.calls.released, [id(999)]);
  for (const capabilityKey of ['canEditCompositionPlacement', 'canEditCompositionStructure', 'canEditCompositionPlacements', 'canEditCompositionOverride'])
    assert.throws(() => createSceneAuthoringWorkflow({ kind: 'groups', capabilityKey }), invalid);
  const unsupported = await workflowFixture({ isSupported: () => false }); assert.equal(unsupported.workflow.canEdit(), false);
  f.state.context.compositionSourceWritable = false; assert.equal(f.workflow.canEdit(), false);
});

test('late group review rejects a replaced source owner and releases the actual complete preview receipt', async () => {
  const wait = deferred(); let submitted;
  const f = await workflowFixture({ reviewCandidate: async value => { submitted = value; return wait.promise; } });
  const checking = f.workflow.validateDraft(f.proposal);
  await Promise.resolve(); f.state.context.sceneDraftToken = 'replacement';
  wait.resolve(await preview(f.observed, submitted.afterContent, submitted.baseSourceRevision));
  await assert.rejects(checking, conflict); assert.deepEqual(f.calls.released, [id(999)]); assert.equal(f.calls.apply.length, 0);
});

test('forged organization review returns no approval and still releases the temporary preview', async () => {
  const f = await workflowFixture({ reviewCandidate: async value => {
    const payload = await preview((await fixture()).observed, value.afterContent, value.baseSourceRevision);
    payload.sceneStructure.memberships[0].groupId = payload.sceneStructure.groups[0].groupId;
    return payload;
  } });
  await assert.rejects(f.workflow.validateDraft(f.proposal), invalid);
  assert.deepEqual(f.calls.released, [id(999)]); assert.equal(f.calls.apply.length, 0);
});

test('mutating group intent while applying or resetting the window invalidates the source receipt', async () => {
  const wait = deferred(); let guard, submitted;
  const f = await workflowFixture({ applyDraft: async (value, current) => { submitted = value; guard = current; return wait.promise; } });
  const applying = f.workflow.applySourceDraft(f.proposal);
  assert.notEqual(submitted, f.proposal); f.proposal.edit.groupKey = null;
  assert.equal(guard.isCurrent(), false); wait.resolve(f.receipt);
  await assert.rejects(applying, conflict); assert.equal(f.workflow.sourceApplied(f.receipt, f.proposal), false);
  const stable = await workflowFixture(); const result = await stable.workflow.applySourceDraft(stable.proposal);
  stable.workflow.reset(); assert.equal(stable.workflow.sourceApplied(result, stable.proposal), false);
});
