import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSceneCompositionDefinitionsDraft } from '../../engine/scene-composition-definitions.mjs';
import { validateSceneAuthoringCandidate } from '../../engine/scene-authoring-candidate.mjs';
import { createSceneAuthoringWorkflow } from '../../engine/scene-authoring-workflow.mjs';
import { resolveSceneCompositionPreview } from '../../engine/scene-composition-preview.mjs';
import { createWorldProjection } from '../../engine/world-projection.mjs';
import { scene2DModelToPlan } from '../../engine/build-plan.mjs';
import { createSceneStructure } from '../../engine/scene-structure.mjs';
import { placementsFixture, hash, revision, copy, ids } from './scene-composition-placements-fixture.mjs';

const id = n => `${n.toString(16).padStart(8, '0')}-3333-4333-8333-333333333333`;
const invalid = { errorCode: 'scene_composition_override_invalid' };
const conflict = { errorCode: 'scene_composition_override_conflict' };
const serialize = value => '\uFEFF' + JSON.stringify(value, null, '\t').replaceAll('\n', '\r\n') + '\r\n \t';
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };
const effectiveActors = actors => actors.map(({ fieldSources, declaration, ...actor }) => actor);
async function resolve(observedSource, content) {
  const observed = copy(observedSource), document = observed.source.documents.find(item => item.record.id === ids.scene);
  document.content = content; document.sourceRevision = revision(content);
  observed.projection = await createWorldProjection(observed.source, { digest: hash });
  return resolveSceneCompositionPreview(observed, ids.scene, { digest: hash });
}
async function preview(observedSource, content, baseSourceRevision) {
  const result = await resolve(observedSource, content);
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  const plan = scene2DModelToPlan(result.model);
  return { ok: true, format: 'viento-scene-preview', schemaVersion: 2, previewId: id(999), scene: plan.scene, actors: plan.actors,
    composition: result.composition, sourceLocations: result.model.sourceLocations, sceneStructure: createSceneStructure(result.model),
    draft: { baseSourceRevision, sourceRevision: revision(content) } };
}
async function fixture(dirty = false) {
  const original = await placementsFixture(), recipe = copy(original.recipe);
  // Deleting an unused definition before the live fragment changes every
  // template JSON Pointer, even though the effective scene stays identical.
  recipe.fragments.unshift({ ...copy(recipe.fragments[1]), fragmentId: 'ahead' });
  const saved = serialize(recipe), content = dirty ? saved.replace('Two parties', '未保存 😀') : saved;
  const source = { sourcePath: original.source.sourcePath, baseSourceRevision: revision(saved), content };
  const model = await preview(original.observed, content, source.baseSourceRevision);
  const draft = await createSceneCompositionDefinitionsDraft(model, source, { digest: hash });
  const edits = [
    { action: 'add', fragment: { fragmentId: 'new_definition', actors: [{ key: 'first', objectId: ids.first, position: [10.25, -20.125], useProjectionDefaults: true }], groups: [] } },
    { action: 'copy', sourceFragmentId: 'party', fragmentId: 'independent_copy' },
    { action: 'copy', sourceFragmentId: 'unused', fragmentId: 'dormant_copy' },
    { action: 'remove', fragmentId: 'ahead' },
  ];
  return { recipe, model, source, draft, proposals: edits.map(edit => draft.propose(edit)), observed: original.observed };
}
const run = (proposal, payload) => validateSceneAuthoringCandidate('definitions', proposal, payload, { sourceRevision: revision(proposal.afterContent) });

test('definition three-action saved and dirty candidates preserve every effective actor and ordered organization while shifting raw source pointers correctly', async () => {
  for (const dirty of [false, true]) {
    const f = await fixture(dirty);
    for (const proposal of f.proposals) {
      assert.deepEqual(proposal.targets, []);
      const payload = await preview(f.observed, proposal.afterContent, f.source.baseSourceRevision);
      assert.equal(run(proposal, payload).kind, 'definitions');
      assert.deepEqual(effectiveActors(payload.actors), effectiveActors(f.model.actors));
      assert.deepEqual(payload.sceneStructure, f.model.sceneStructure);
      if (proposal.edit.action === 'remove') {
        assert.match(f.model.sourceLocations.actors[0].declaration.propertyPath, /^\/fragments\/1\//);
        assert.match(payload.sourceLocations.actors[0].declaration.propertyPath, /^\/fragments\/0\//);
      }
    }
  }
});

test('definition candidate rejects fabricated instance targets and same-identity forged names parents or actor memberships', async () => {
  const f = await fixture(), proposal = f.proposals[1], payload = await preview(f.observed, proposal.afterContent, f.source.baseSourceRevision);
  const fake = copy(proposal); fake.targets.push({ instanceId: payload.actors[0].instanceId }); assert.throws(() => run(fake, payload), invalid);
  for (const change of [
    p => { p.sceneStructure.groups[0].name = 'Different valid name'; },
    p => { p.sceneStructure.groups[0].parentGroupId = null; },
    p => { delete p.sceneStructure.groups[1].parentGroupId; },
    p => { p.sceneStructure.groups.reverse(); },
    p => { p.sceneStructure.memberships.reverse(); },
    p => { p.sceneStructure.memberships[0].groupId = p.sceneStructure.groups[1].groupId; },
    p => { p.sceneStructure.extra = true; },
  ]) { const value = copy(payload); change(value); assert.throws(() => run(proposal, value), invalid); }
});

test('definition review checks existing actor order and every source-declared runtime field instead of approving genuine identities with forged positions', async () => {
  const f = await fixture(), proposal = f.proposals[0], payload = await preview(f.observed, proposal.afterContent, f.source.baseSourceRevision);
  for (const change of [
    p => { p.actors.reverse(); }, p => { p.actors[0].position[0]++; }, p => { p.actors[0].size = [90, 90]; },
    p => { p.actors[0].color = '#123456'; }, p => { p.actors[0].speed = 5; }, p => { p.actors[0].controls = 'arrows'; },
    p => { p.actors[0].useProjectionDefaults = false; }, p => { p.actors[0].imageResourceId = id(88); },
    p => { p.actors[0].objectId = id(77); }, p => { p.actors.pop(); }, p => { p.actors.push(copy(p.actors[0])); },
  ]) { const value = copy(payload); change(value); assert.throws(() => run(proposal, value), invalid); }
});

test('definition removal regenerates complete actor and group contribution provenance and rejects stale counts paths owners or execution authority', async () => {
  const f = await fixture(), proposal = f.proposals[3], payload = await preview(f.observed, proposal.afterContent, f.source.baseSourceRevision);
  for (const change of [
    p => { p.composition.fragmentCount++; }, p => { p.composition.placementCount++; },
    p => { p.sourceLocations.actors.reverse(); }, p => { p.sourceLocations.groups.pop(); },
    p => { p.sourceLocations.actors[0].composition.fragmentId = 'ahead'; },
    p => { p.sourceLocations.actors[0].declaration.sourceRevision = revision('old'); },
    p => { p.sourceLocations.actors[0].declaration.sourcePath = 'other.json'; },
    p => { p.sourceLocations.actors[0].declaration.propertyPath = '/fragments/1/actors/0'; },
    p => { p.sourceLocations.actors[0].declaration.sourceRange.start++; },
    p => { p.sourceLocations.groups[0].declaration.propertyPath = '/fragments/1/groups/0'; },
    p => { p.sourceLocations.groups[0].declaration.contributors.reverse(); },
    p => { p.sourceLocations.actors[0].declaration.contributors[0].sourceRange.end++; },
    p => { p.sourceLocations.groups[0].composition.localKey = 'unknown'; },
    p => { p.draft.baseSourceRevision = revision('other'); }, p => { p.snapshot = {}; }, p => { p.sceneEditing = {}; },
    p => { p.scene.objectId = id(77); }, p => { p.composition.recipeObjectId = id(78); },
  ]) { const value = copy(payload); change(value); assert.throws(() => run(proposal, value), invalid); }
});

test('unused added definitions still require real registered object and explicit image declarations through complete candidate review', async () => {
  const f = await fixture();
  for (const extra of [{ objectId: id(70) }, { objectId: ids.scene }, { objectId: ids.first, imageResourceId: id(71) }]) {
    const proposal = f.draft.propose({ action: 'add', fragment: { fragmentId: 'new_refs', groups: [],
      actors: [{ key: 'first', objectId: ids.first, position: [0, 0], useProjectionDefaults: true, ...extra }] } });
    const result = await resolve(f.observed, proposal.afterContent);
    assert.equal(result.ok, false); assert.ok(result.diagnostics.length);
    assert.ok(result.diagnostics.some(item => item.propertyPath.startsWith('/fragments/3/actors/0/')));
    assert.deepEqual(proposal.targets, []);
  }
});

async function workflowFixture(overrides = {}) {
  const f = await fixture(), proposal = f.proposals[3];
  const state = { open: true, session: 1, selected: ids.scene, sourcePath: f.source.sourcePath, previewSupported: true, previewActive: true,
    requestBusy: false, running: false, backend: { available: false }, context: { editable: true, creating: false, busy: false,
      compositionSourceWritable: true, sceneDraftPath: f.source.sourcePath, sceneDraftToken: 'draft:1' } };
  const calls = { apply: [], released: [], applied: [] }, receipt = { applied: true };
  const ports = { kind: 'definitions', capabilityKey: 'canEditCompositionDefinitions', isSupported: () => true,
    getState: () => state, getSource: async () => f.source, reviewCandidate: async value => preview(f.observed, value.afterContent, value.baseSourceRevision),
    releasePreview: identity => calls.released.push(identity), digest: async value => hash(value),
    applyDraft: async (value, guard) => { assert.equal(guard.isCurrent(), true); calls.apply.push(value); state.context.sceneDraftToken = 'draft:2'; return receipt; },
    onApplied: (result, value) => calls.applied.push({ result, value }), ...overrides };
  return { ...f, proposal, state, calls, receipt, ports, workflow: createSceneAuthoringWorkflow(ports) };
}

test('definition authoring owns its catalog and capability and applies one detached source receipt without an execution backend', async () => {
  const f = await workflowFixture(); assert.equal(f.workflow.canEdit(), true);
  await assert.rejects(f.workflow.validateDraft({ ...copy(f.proposal), sceneId: id(76) }), conflict);
  assert.deepEqual(Object.keys(f.workflow.getContext()).sort(), ['editable', 'creating', 'busy', 'compositionSourceWritable', 'sceneDraftPath', 'sceneDraftToken', 'canEditCompositionDefinitions'].sort());
  const opened = [];
  assert.equal(await f.workflow.open({ open: async value => { opened.push(value); return true; } }, { model: f.model, actorId: null, isCurrent: () => true }), true);
  assert.notEqual(opened[0].source, f.source);
  assert.deepEqual(await f.workflow.validateDraft(f.proposal), { ok: true });
  const result = await f.workflow.applySourceDraft(f.proposal); assert.equal(f.workflow.sourceApplied(result, f.proposal), true);
  assert.equal(f.calls.apply.length, 1); assert.notEqual(f.calls.apply[0], f.proposal); assert.equal(f.workflow.sourceApplied(result, f.proposal), false);
  assert.deepEqual(f.calls.released, [id(999)]);
  for (const capabilityKey of ['canEditCompositionGroups', 'canEditCompositionFragment', 'canEditCompositionStructure', 'canEditCompositionPlacements'])
    assert.throws(() => createSceneAuthoringWorkflow({ kind: 'definitions', capabilityKey }), invalid);
  const unsupported = await workflowFixture({ isSupported: () => false }); assert.equal(unsupported.workflow.canEdit(), false);
});

test('late and corrupted definition candidate receipts grant no approval and release their real temporary preview', async () => {
  const wait = deferred(); let submitted;
  const f = await workflowFixture({ reviewCandidate: async value => { submitted = value; return wait.promise; } });
  const checking = f.workflow.validateDraft(f.proposal); await Promise.resolve(); f.state.context.sceneDraftToken = 'new-owner';
  wait.resolve(await preview(f.observed, submitted.afterContent, submitted.baseSourceRevision));
  await assert.rejects(checking, conflict); assert.deepEqual(f.calls.released, [id(999)]); assert.equal(f.calls.apply.length, 0);
  const hostile = await workflowFixture({ reviewCandidate: async value => {
    const payload = await preview(f.observed, value.afterContent, value.baseSourceRevision); payload.actors[0].position[0]++; return payload;
  } });
  await assert.rejects(hostile.workflow.validateDraft(hostile.proposal), invalid);
  assert.deepEqual(hostile.calls.released, [id(999)]); assert.equal(hostile.calls.apply.length, 0);
});

test('definition intent mutation during apply or a reset invalidates only its own single-use source completion', async () => {
  const wait = deferred(); let guard, submitted;
  const f = await workflowFixture({ applyDraft: async (value, current) => { submitted = value; guard = current; return wait.promise; } });
  const applying = f.workflow.applySourceDraft(f.proposal);
  assert.notEqual(submitted, f.proposal); f.proposal.edit.fragmentId = 'unused'; assert.equal(guard.isCurrent(), false);
  wait.resolve(f.receipt); await assert.rejects(applying, conflict); assert.equal(f.workflow.sourceApplied(f.receipt, f.proposal), false);
  const stable = await workflowFixture(), result = await stable.workflow.applySourceDraft(stable.proposal);
  stable.workflow.reset(); assert.equal(stable.workflow.sourceApplied(result, stable.proposal), false);
});
