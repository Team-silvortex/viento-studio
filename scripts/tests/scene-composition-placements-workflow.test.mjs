import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createSceneCompositionPlacementsDraft } from '../../engine/scene-composition-placements.mjs';
import { validateSceneAuthoringCandidate } from '../../engine/scene-authoring-candidate.mjs';
import { createSceneAuthoringWorkflow } from '../../engine/scene-authoring-workflow.mjs';
import { resolveSceneCompositionPreview } from '../../engine/scene-composition-preview.mjs';
import { createWorldProjection } from '../../engine/world-projection.mjs';
import { scene2DModelToPlan } from '../../engine/build-plan.mjs';
import { createSceneStructure } from '../../engine/scene-structure.mjs';

const golden = JSON.parse(await fs.readFile(new URL('./fixtures/scene-model/legacy-plan-v1.json', import.meta.url), 'utf8'));
const recipe = JSON.parse(await fs.readFile(new URL('../../examples/scene-composition/recipe.json', import.meta.url), 'utf8'));
const { ids } = golden;
const id = n => `${n.toString(16).padStart(8, '0')}-1111-4111-8111-111111111111`;
const hash = content => createHash('sha256').update(content).digest('hex');
const revision = content => `sha256:${hash(content)}`;
const serialize = value => '\uFEFF' + JSON.stringify(value, null, '\t').replaceAll('\n', '\r\n') + '\r\n \t';
const invalid = { errorCode: 'scene_composition_override_invalid' };
const conflict = { errorCode: 'scene_composition_override_conflict' };
function declaration() {
  const value = structuredClone(recipe);
  value.fragments[0].actors[0].objectId = ids.first;
  value.fragments[0].actors[1].objectId = ids.second;
  value.fragments.push({ fragmentId: 'unused', actors: [{ key: 'dormant', objectId: ids.first, position: [20, 30], useProjectionDefaults: true }], groups: [] });
  return value;
}
async function preview(content, baseSourceRevision) {
  const observed = structuredClone(golden.observed);
  observed.source.workspace.version = 3;
  observed.source.definition = { documentTypes: [{ id: 'document', label: 'Document' }] };
  const document = observed.source.documents.find(item => item.record.id === ids.scene);
  document.record.relations = []; document.record.assetBindings = [];
  document.content = content; document.sourceRevision = revision(content);
  for (const item of observed.source.documents) item.descriptor = { ...item.record };
  observed.projection = await createWorldProjection(observed.source, { digest: hash });
  const result = await resolveSceneCompositionPreview(observed, ids.scene, { digest: hash });
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  const plan = scene2DModelToPlan(result.model);
  return { ok: true, format: 'viento-scene-preview', schemaVersion: 2, previewId: id(999), scene: plan.scene, actors: plan.actors,
    sourceLocations: result.model.sourceLocations, composition: result.composition, sceneStructure: createSceneStructure(result.model),
    draft: { baseSourceRevision, sourceRevision: document.sourceRevision } };
}
async function fixture() {
  const value = declaration(), content = serialize(value), baseSourceRevision = revision('saved baseline');
  const model = await preview(content, baseSourceRevision);
  const source = { sourcePath: model.scene.sourcePath, baseSourceRevision, content };
  const draft = await createSceneCompositionPlacementsDraft(model, source, { digest: hash });
  const maps = { placementId: id(900), actorIds: { leader: id(901), companion: id(902) }, groupIds: { party: id(903), companions: id(904) } };
  const edits = [
    { action: 'add', fragmentId: 'unused', placementId: id(950), actorIds: { dormant: id(951) }, groupIds: {}, offset: [50, 60] },
    { action: 'copy', sourcePlacementId: value.placements[1].placementId, ...maps },
    { action: 'remove', placementId: value.placements[0].placementId },
  ];
  const proposals = edits.map(edit => draft.propose(edit));
  return { value, model, source, proposals };
}
const run = (proposal, payload) => validateSceneAuthoringCandidate('placements', proposal, payload, { sourceRevision: revision(proposal.afterContent) });
function deferred() { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; }

test('placement add copy and removal use complete real candidate provenance including the removed opener', async () => {
  const f = await fixture();
  for (const proposal of f.proposals) {
    const payload = await preview(proposal.afterContent, f.source.baseSourceRevision);
    assert.equal(run(proposal, payload).kind, 'placements');
    assert.ok(!Object.hasOwn(payload, 'snapshot'));
    assert.ok(!Object.hasOwn(payload, 'sceneEditing'));
    if (proposal.edit.action === 'remove') assert.ok(!payload.actors.some(actor => actor.instanceId === f.model.actors[0].instanceId));
  }
});

test('placement candidate rejects incomplete duplicated reordered or forged actors groups and placement counts', async () => {
  const f = await fixture(), proposal = f.proposals[1], payload = await preview(proposal.afterContent, f.source.baseSourceRevision);
  for (const change of [
    p => { p.composition.placementCount--; }, p => { p.composition.fragmentCount++; },
    p => { p.actors.pop(); }, p => { p.actors.push({ ...p.actors[0] }); }, p => { p.actors[0].objectId = id(777); },
    p => { p.sourceLocations.actors.pop(); }, p => { p.sourceLocations.actors.reverse(); },
    p => { p.sourceLocations.actors[0].composition.placementId = id(778); },
    p => { p.sourceLocations.actors[0].composition.localKey = 'other'; },
    p => { p.sourceLocations.actors[0].declaration.sourceRevision = revision('stale'); },
    p => { p.sceneStructure.groups.pop(); }, p => { p.sceneStructure.groups.push({ ...p.sceneStructure.groups[0] }); },
    p => { p.sourceLocations.groups.reverse(); }, p => { p.sourceLocations.groups.pop(); },
    p => { p.sourceLocations.groups[0].composition.fragmentId = 'unused'; },
    p => { p.sourceLocations.groups[0].declaration.sourcePath = 'other.json'; },
    p => { p.snapshot = {}; }, p => { p.sceneEditing = {}; },
  ]) {
    const changed = structuredClone(payload); change(changed); assert.throws(() => run(proposal, changed), invalid);
  }
});

async function workflowFixture(overrides = {}) {
  const f = await fixture(), proposal = f.proposals[2];
  const state = { open: true, session: 1, selected: ids.scene, sourcePath: f.source.sourcePath, previewSupported: true, previewActive: true,
    requestBusy: false, running: false, backend: { available: false }, context: { editable: true, creating: false, busy: false,
      compositionSourceWritable: true, sceneDraftPath: f.source.sourcePath, sceneDraftToken: 'draft:1' } };
  const calls = { apply: [], released: [], applied: [] }, receipt = { applied: true };
  const ports = { kind: 'placements', capabilityKey: 'canEditCompositionPlacements', isSupported: () => true,
    getState: () => state, getSource: async () => f.source,
    reviewCandidate: async value => preview(value.afterContent, value.baseSourceRevision), releasePreview: identity => calls.released.push(identity),
    digest: async value => hash(value), applyDraft: async (value, guard) => { assert.equal(guard.isCurrent(), true); calls.apply.push(value); state.context.sceneDraftToken = 'draft:2'; return receipt; },
    onApplied: (result, value) => calls.applied.push({ result, value }), ...overrides };
  return { ...f, proposal, state, calls, receipt, ports, workflow: createSceneAuthoringWorkflow(ports) };
}

test('placement authoring keeps its own capability and requires source authority while execution may be unavailable', async () => {
  const f = await workflowFixture(); assert.equal(f.workflow.canEdit(), true);
  assert.equal(f.workflow.getContext().canEditCompositionPlacements, true);
  assert.ok(!Object.hasOwn(f.workflow.getContext(), 'canEditCompositionPlacement'));
  const input = { model: f.model, actorId: null, isCurrent: () => true };
  const opened = []; assert.equal(await f.workflow.open({ open: async value => { opened.push(value); return true; } }, input), true);
  assert.notEqual(opened[0].source, f.source); assert.equal(opened[0].source.content, f.source.content);
  assert.deepEqual(await f.workflow.validateDraft(f.proposal), { ok: true });
  const result = await f.workflow.applySourceDraft(f.proposal);
  assert.equal(f.workflow.sourceApplied(result, f.proposal), true); assert.equal(f.calls.applied.length, 1);
  assert.equal(f.workflow.sourceApplied(result, f.proposal), false);
  assert.deepEqual(f.calls.released, [id(999)]);
  for (const capabilityKey of ['canEditCompositionPlacement', 'canEditCompositionStructure', 'canEditCompositionOverride']) {
    assert.throws(() => createSceneAuthoringWorkflow({ kind: 'placements', capabilityKey }), invalid);
  }
  const unsupported = await workflowFixture({ isSupported: () => false }); assert.equal(unsupported.workflow.canEdit(), false);
  f.state.context.compositionSourceWritable = false; assert.equal(f.workflow.canEdit(), false);
});

test('late placement review cannot approve a replaced source owner and releases its temporary preview', async () => {
  const wait = deferred(); let submitted;
  const f = await workflowFixture({ reviewCandidate: async value => { submitted = value; return wait.promise; } });
  const checking = f.workflow.validateDraft(f.proposal);
  await Promise.resolve(); f.state.context.sceneDraftToken = 'replacement';
  wait.resolve(await preview(submitted.afterContent, submitted.baseSourceRevision));
  await assert.rejects(checking, conflict); assert.deepEqual(f.calls.released, [id(999)]); assert.equal(f.calls.apply.length, 0);
});

test('placement proposal mutation while applying invalidates the exact source receipt', async () => {
  const wait = deferred(); let guard, submitted;
  const f = await workflowFixture({ applyDraft: async (value, current) => { submitted = value; guard = current; return wait.promise; } });
  const applying = f.workflow.applySourceDraft(f.proposal);
  assert.notEqual(submitted, f.proposal); f.proposal.edit.placementId = id(880);
  assert.equal(guard.isCurrent(), false); wait.resolve(f.receipt);
  await assert.rejects(applying, conflict); assert.equal(f.workflow.sourceApplied(f.receipt, f.proposal), false);
});
