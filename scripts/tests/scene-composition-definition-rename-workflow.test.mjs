import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSceneCompositionDefinitionsDraft, prepareSceneCompositionDefinitionsApply } from '../../engine/scene-composition-definitions.mjs';
import { validateSceneAuthoringCandidate } from '../../engine/scene-authoring-candidate.mjs';
import { createSceneAuthoringWorkflow } from '../../engine/scene-authoring-workflow.mjs';
import { resolveSceneCompositionPreview } from '../../engine/scene-composition-preview.mjs';
import { createWorldProjection } from '../../engine/world-projection.mjs';
import { scene2DModelToPlan } from '../../engine/build-plan.mjs';
import { createSceneStructure } from '../../engine/scene-structure.mjs';
import { expandSceneComposition } from '../../engine/scene-composition.mjs';
import { placementsFixture, hash, revision, copy, ids } from './scene-composition-placements-fixture.mjs';

const id = n => `${n.toString(16).padStart(8, '0')}-4444-4444-8444-444444444444`;
const invalid = { errorCode: 'scene_composition_override_invalid' };
const conflict = { errorCode: 'scene_composition_override_conflict' };
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const effective = actors => actors.map(({ fieldSources, declaration, ...actor }) => actor);
async function preview(observedSource, content, baseline) {
  const observed = copy(observedSource), document = observed.source.documents.find(item => item.record.id === ids.scene);
  document.content = content; document.sourceRevision = revision(content);
  observed.projection = await createWorldProjection(observed.source, { digest: hash });
  const result = await resolveSceneCompositionPreview(observed, ids.scene, { digest: hash });
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  const plan = scene2DModelToPlan(result.model);
  return { ok: true, format: 'viento-scene-preview', schemaVersion: 2, previewId: id(99), scene: plan.scene, actors: plan.actors,
    composition: result.composition, sourceLocations: result.model.sourceLocations, sceneStructure: createSceneStructure(result.model),
    draft: { baseSourceRevision: baseline, sourceRevision: revision(content) } };
}
async function fixture(dirty = false, escaped = false) {
  const f = await placementsFixture({ dirty });
  if (escaped) f.source.content = f.source.content.replaceAll('"fragmentId"', '"fr\\u0061gmentId"').replaceAll('"party"', '"pa\\u0072ty"');
  f.model = await preview(f.observed, f.source.content, f.source.baseSourceRevision);
  f.draft = await createSceneCompositionDefinitionsDraft(f.model, f.source, { digest: hash });
  return f;
}
const run = (proposal, payload) => validateSceneAuthoringCandidate('definitions', proposal, payload, { sourceRevision: revision(proposal.afterContent) });

test('rename used and unplaced definitions preserves the real effective scene and every generated identity in saved dirty and escaped sources', async () => {
  for (const [dirty, escaped] of [[false, false], [true, false], [true, true]]) {
    const f = await fixture(dirty, escaped);
    for (const [fragmentId, newFragmentId] of [['party', 'new_party'], ['unused', 'sleeping'], ['party', 'Party']]) {
      const proposal = f.draft.propose({ action: 'rename', fragmentId, newFragmentId });
      assert.deepEqual(proposal.targets, []);
      const payload = await preview(f.observed, proposal.afterContent, f.source.baseSourceRevision);
      assert.equal(run(proposal, payload).kind, 'definitions');
      assert.deepEqual(effective(payload.actors), effective(f.model.actors));
      assert.deepEqual(payload.sceneStructure, f.model.sceneStructure);
      assert.deepEqual(expandSceneComposition(proposal.afterContent).scene, expandSceneComposition(f.source.content).scene);
      for (const kind of ['actors', 'groups']) for (const [index, location] of payload.sourceLocations[kind].entries()) {
        assert.equal(location.composition.fragmentId, fragmentId === 'party' ? newFragmentId : 'party');
        assert.equal(location.declaration.propertyPath, f.model.sourceLocations[kind][index].declaration.propertyPath);
        assert.equal(location.declaration.sourceRevision, revision(proposal.afterContent));
      }
      assert.deepEqual(await prepareSceneCompositionDefinitionsApply(f.source, proposal, { digest: hash }),
        { afterContent: proposal.afterContent, changedPaths: proposal.changedPaths });
      assert.ok(proposal.afterContent.startsWith('\uFEFF') && proposal.afterContent.endsWith('\r\n \t'));
    }
  }
});

test('rename candidates reject old fragment provenance and forged identity order effective fields or UTF16 contribution ranges', async () => {
  const f = await fixture(true, true), proposal = f.draft.propose({ action: 'rename', fragmentId: 'party', newFragmentId: 'longer_shared_definition' });
  const payload = await preview(f.observed, proposal.afterContent, f.source.baseSourceRevision);
  for (const change of [
    p => { p.sourceLocations.actors[0].composition.fragmentId = 'party'; },
    p => { p.sourceLocations.groups[0].composition.fragmentId = 'party'; },
    p => { p.sourceLocations.actors[0].declaration.sourceRange = copy(f.model.sourceLocations.actors[0].declaration.sourceRange); },
    p => { p.sourceLocations.groups[0].declaration.contributors = copy(f.model.sourceLocations.groups[0].declaration.contributors); },
    p => { p.sourceLocations.actors[0].declaration.contributors.reverse(); },
    p => { p.sourceLocations.groups[0].declaration.sourceRange.end++; },
    p => { p.actors.reverse(); }, p => { p.actors[0].position[0]++; }, p => { p.actors[0].objectId = id(70); },
    p => { p.sceneStructure.groups[0].name = 'Forged'; }, p => { p.sceneStructure.memberships.reverse(); },
    p => { p.composition.fragmentCount++; }, p => { p.composition.placementCount--; },
    p => { p.sourceLocations.actors.pop(); }, p => { p.sceneEditing = {}; }, p => { p.snapshot = {}; },
    p => { p.scene.objectId = id(77); }, p => { p.scene.sourceRevision = revision('old'); },
  ]) { const corrupt = copy(payload); change(corrupt); assert.throws(() => run(proposal, corrupt), invalid); }
});

test('rename noops collisions unknown identities and whitespace normalization cannot grant a raw source approval', async () => {
  const f = await fixture(true, true);
  assert.throws(() => f.draft.propose({ action: 'rename', fragmentId: 'party', newFragmentId: 'party' }),
    { errorCode: 'scene_composition_definitions_unchanged' });
  for (const edit of [
    { action: 'rename', fragmentId: 'party', newFragmentId: 'unused' },
    { action: 'rename', fragmentId: 'missing', newFragmentId: 'new' },
    { action: 'rename', fragmentId: 'party', newFragmentId: ' party ' },
    { action: 'rename', fragmentId: 'party', newFragmentId: 'new', extra: true },
  ]) assert.throws(() => f.draft.propose(edit), { errorCode: 'scene_composition_definitions_invalid' });
  assert.equal((await preview(f.observed, f.source.content, f.source.baseSourceRevision)).draft.sourceRevision, revision(f.source.content));
});

test('rename apply reconstructs all reference updates and rejects hidden actor changes dropped paths or wrong source owners', async () => {
  const f = await fixture(true), proposal = f.draft.propose({ action: 'rename', fragmentId: 'party', newFragmentId: 'renamed' });
  for (const mutate of [
    p => { p.changedPaths.pop(); }, p => { p.changedPaths.reverse(); }, p => { p.edit.newFragmentId = 'other'; },
    p => { p.targets.push({ instanceId: f.actorId }); }, p => { p.afterContent += ' '; },
    p => { const value = JSON.parse(p.afterContent.replace(/^\uFEFF/, '')); value.fragments[0].actors[0].position[0]++; p.afterContent = JSON.stringify(value); },
  ]) { const value = copy(proposal); mutate(value); await assert.rejects(prepareSceneCompositionDefinitionsApply(f.source, value, { digest: hash })); }
  for (const source of [{ ...f.source, content: f.source.content + ' ' }, { ...f.source, sourcePath: 'documents/other.json' },
    { ...f.source, baseSourceRevision: revision('different save') }])
    await assert.rejects(prepareSceneCompositionDefinitionsApply(source, proposal, { digest: hash }), { errorCode: 'scene_composition_definitions_conflict' });
});

async function workflow(f, ports = {}) {
  const calls = { reviewed: [], released: [], writes: [], notified: [], catalogs: [] }, receipt = { applied: true };
  const state = { open: true, session: 1, selected: ids.scene, sourcePath: f.source.sourcePath,
    previewSupported: true, previewActive: true, requestBusy: false, running: false,
    context: { editable: true, creating: false, busy: false, compositionSourceWritable: true,
      sceneDraftPath: f.source.sourcePath, sceneDraftToken: 'source:1' } };
  const controller = createSceneAuthoringWorkflow({ kind: 'definitions', capabilityKey: 'canEditCompositionDefinitions', isSupported: () => true,
    getState: () => state, getSource: async () => copy(f.source), loadCatalog: async () => { calls.catalogs.push(true); return { objects: [], images: [] }; }, digest: hash,
    reviewCandidate: async proposal => { calls.reviewed.push(copy(proposal)); return preview(f.observed, proposal.afterContent, proposal.baseSourceRevision); },
    releasePreview: previewId => calls.released.push(previewId),
    applyDraft: async proposal => { await prepareSceneCompositionDefinitionsApply(f.source, proposal, { digest: hash }); calls.writes.push(copy(proposal)); state.context.sceneDraftToken = 'source:2'; return receipt; },
    onApplied: (...args) => calls.notified.push(args), ...ports });
  const editor = { open: async () => true };
  assert.equal(await controller.open(editor, { model: f.model, actorId: f.actorId, isCurrent: () => true }), true);
  return { controller, calls, state, receipt };
}

test('rename retains its existing independent definitions domain catalog and single-use memory completion without execution backend state', async () => {
  const f = await fixture(), proposal = f.draft.propose({ action: 'rename', fragmentId: 'party', newFragmentId: 'new_party' }), h = await workflow(f);
  assert.equal(h.controller.getContext().canEditCompositionDefinitions, true);
  assert.equal(Object.hasOwn(h.controller.getContext(), 'canEditCompositionGroups'), false);
  assert.equal(h.calls.catalogs.length, 1);
  await h.controller.validateDraft(proposal); assert.deepEqual(h.calls.released, [id(99)]);
  const receipt = await h.controller.applySourceDraft(proposal); assert.equal(receipt, h.receipt);
  assert.equal(h.controller.sourceApplied(receipt, proposal), true); assert.equal(h.controller.sourceApplied(receipt, proposal), false);
  assert.equal(h.calls.writes.length, 1); assert.equal(h.calls.notified.length, 1);
});

test('late rename candidate cannot approve a replaced author source and releases its real temporary preview', async () => {
  const f = await fixture(true), proposal = f.draft.propose({ action: 'rename', fragmentId: 'party', newFragmentId: 'new_party' });
  const gate = deferred(), h = await workflow(f, { reviewCandidate: () => gate.promise });
  const checking = h.controller.validateDraft(proposal); h.state.context.sceneDraftToken = 'source:new';
  gate.resolve(await preview(f.observed, proposal.afterContent, proposal.baseSourceRevision));
  await assert.rejects(checking, conflict); assert.deepEqual(h.calls.released, [id(99)]); assert.deepEqual(h.calls.writes, []);
});

test('forged rename provenance cannot approve or write even when every generated UUID is genuine', async () => {
  const f = await fixture(), proposal = f.draft.propose({ action: 'rename', fragmentId: 'party', newFragmentId: 'new_party' });
  const h = await workflow(f, { reviewCandidate: async value => { const result = await preview(f.observed, value.afterContent, value.baseSourceRevision);
    result.sourceLocations.groups[0].composition.fragmentId = 'party'; return result; } });
  await assert.rejects(h.controller.validateDraft(proposal), invalid); assert.deepEqual(h.calls.released, [id(99)]);
  assert.deepEqual(h.calls.writes, []); assert.deepEqual(h.calls.notified, []);
});

test('rename input mutation or reset during application invalidates the definitions completion receipt', async () => {
  const f = await fixture();
  for (const mutate of [p => { p.edit.newFragmentId = 'another'; }, (_p, h) => h.controller.reset()]) {
    const proposal = f.draft.propose({ action: 'rename', fragmentId: 'party', newFragmentId: 'new_party' }), gate = deferred();
    const h = await workflow(f, { applyDraft: () => gate.promise });
    const applying = h.controller.applySourceDraft(proposal); mutate(proposal, h); gate.resolve(h.receipt);
    await assert.rejects(applying, conflict); assert.equal(h.controller.sourceApplied(h.receipt, proposal), false); assert.deepEqual(h.calls.notified, []);
  }
});
