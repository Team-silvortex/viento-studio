import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { validateSceneAuthoringCandidate } from '../../engine/scene-authoring-candidate.mjs';
import { createSceneCompositionOverrideDraft } from '../../engine/scene-composition-overrides.mjs';
import { createSceneCompositionBatchLayoutDraft } from '../../engine/scene-composition-batch-layout.mjs';
import { createSceneCompositionFragmentDraft } from '../../engine/scene-composition-fragments.mjs';
import { createSceneCompositionPlacementDraft } from '../../engine/scene-composition-placement.mjs';
import { createSceneCompositionStructureDraft } from '../../engine/scene-composition-structure.mjs';
import { resolveSceneCompositionPreview } from '../../engine/scene-composition-preview.mjs';
import { createWorldProjection } from '../../engine/world-projection.mjs';
import { scene2DModelToPlan } from '../../engine/build-plan.mjs';
import { createSceneStructure } from '../../engine/scene-structure.mjs';

const golden = JSON.parse(await fs.readFile(new URL('./fixtures/scene-model/legacy-plan-v1.json', import.meta.url), 'utf8'));
const example = JSON.parse(await fs.readFile(new URL('../../examples/scene-composition/recipe.json', import.meta.url), 'utf8'));
const { ids } = golden;
const id = n => `${n.toString(16).padStart(8, '0')}-1111-4111-8111-111111111111`;
const hash = content => createHash('sha256').update(content).digest('hex');
const revision = content => `sha256:${hash(content)}`;
const serialize = value => '\uFEFF' + JSON.stringify(value, null, '\t').replaceAll('\n', '\r\n') + '\r\n \t';
const invalid = error => error?.errorCode === 'scene_composition_override_invalid' && !(error instanceof TypeError);
function recipe() {
  const value = structuredClone(example);
  value.fragments[0].actors[0] = { key: 'leader', objectId: ids.first, groupKey: 'party', position: [120.125, 180.25], useProjectionDefaults: true };
  value.fragments[0].actors[1] = { key: 'companion', objectId: ids.second, groupKey: 'companions', position: [200.5, 180.75],
    useProjectionDefaults: true, size: [48, 48], speed: 17, color: '#112233', controls: 'arrows', imageResourceId: null };
  value.fragments.push({ fragmentId: 'unused', actors: [{ key: 'dormant', objectId: ids.first, position: [0, 0], useProjectionDefaults: true }], groups: [] });
  value.placements[0].overrides = [{ actorKey: 'leader', values: { speed: 2 } }];
  return value;
}
async function fixture(content = serialize(recipe()), dirty = false) {
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
  const model = { ok: true, format: 'viento-scene-preview', schemaVersion: 2, scene: plan.scene, actors: plan.actors,
    sourceLocations: result.model.sourceLocations, composition: result.composition, sceneStructure: createSceneStructure(result.model) };
  const source = { sourcePath: document.sourcePath, baseSourceRevision: dirty ? revision('saved baseline') : document.sourceRevision, content };
  if (dirty) model.draft = { baseSourceRevision: source.baseSourceRevision, sourceRevision: document.sourceRevision };
  return { model, source };
}
async function preview(kind, proposal) {
  const f = await fixture(proposal.afterContent), sourceRevision = revision(proposal.afterContent);
  return { kind, proposal, sourceRevision, payload: { ...f.model, previewId: id(999), draft: { baseSourceRevision: proposal.baseSourceRevision, sourceRevision } } };
}
async function cases(dirty = false) {
  const f = await fixture(undefined, dirty), first = f.model.actors[0].instanceId, third = f.model.actors[2].instanceId;
  const instance = await createSceneCompositionOverrideDraft(f.model, f.source, first, { digest: hash });
  const batch = await createSceneCompositionBatchLayoutDraft(f.model, f.source, { digest: hash });
  batch.setPositions([{ objectId: first, position: [10, 20] }, { objectId: third, position: [400, 300] }]);
  const fragment = await createSceneCompositionFragmentDraft(f.model, f.source, first, { digest: hash });
  const inherited = await createSceneCompositionFragmentDraft(f.model, f.source, f.model.actors[1].instanceId, { digest: hash });
  const placement = await createSceneCompositionPlacementDraft(f.model, f.source, third, { digest: hash });
  const structure = await createSceneCompositionStructureDraft(f.model, f.source, { digest: hash });
  const actor = { key: 'third', objectId: ids.first, groupKey: 'companions', position: [10.5, 20.25], useProjectionDefaults: true };
  const proposals = [['instance', instance.propose({ speed: 7 })], ['instance', instance.propose({ position: [30, 40] })],
    ['positions', batch.propose()], ['fragment', fragment.propose({ speed: 11 })], ['fragment', inherited.proposeEdit({ values: {}, reset: ['speed'] })],
    ['placement', placement.propose([50, 60])], ['placement', placement.propose(null)],
    ['structure', structure.propose({ action: 'add', fragmentId: 'party', actor, instances: recipe().placements.map((p, index) => ({ placementId: p.placementId, instanceId: id(900 + index) })) })],
    ['structure', structure.propose({ action: 'remove', fragmentId: 'party', actorKey: 'leader' })],
    ['structure', structure.propose({ action: 'add', fragmentId: 'unused', actor: { key: 'second', objectId: ids.first, position: [0, 0], useProjectionDefaults: true }, instances: [] })]];
  batch.dispose();
  return Promise.all(proposals.map(([kind, proposal]) => preview(kind, proposal)));
}
const saved = await cases();
const run = c => validateSceneAuthoringCandidate(c.kind, c.proposal, c.payload, { sourceRevision: c.sourceRevision });
const pick = kind => structuredClone(saved.find(c => c.kind === kind));
const rejects = (original, mutations) => { for (const mutate of mutations) { const c = structuredClone(original); mutate(c); assert.throws(() => run(c), invalid); } };

// These are true shared Rust edits and projection-resolved preview models,
// independent of an execution backend, authoring GUI or HTTP test double.
test('all five domains accept real saved and dirty source candidates including field reset layout offset reset and structure changes', async () => {
  for (const c of [...saved, ...await cases(true)]) assert.deepEqual(run(c), { kind: c.kind, previewId: c.payload.previewId,
    sceneId: c.proposal.sceneId, sourcePath: c.proposal.sourcePath, baseSourceRevision: c.proposal.baseSourceRevision, sourceRevision: c.sourceRevision });
});

test('candidate receipts are detached frozen identifiers and expose no GUI backend tool or save state', () => {
  const c = pick('placement'), receipt = run(c), before = { ...receipt };
  c.proposal.sceneId = id(8); c.proposal.sourcePath = 'other.json'; c.proposal.afterContent = '{}'; c.payload.previewId = id(7); c.payload.scene.sourceRevision = revision('other');
  assert.deepEqual(receipt, before); assert.ok(Object.isFrozen(receipt)); assert.throws(() => { receipt.kind = 'instance'; }, TypeError);
  assert.deepEqual(Object.keys(receipt).sort(), ['kind', 'previewId', 'sceneId', 'sourcePath', 'baseSourceRevision', 'sourceRevision'].sort());
});

test('unknown kinds fail closed even with an otherwise valid single-instance receipt', () => {
  const c = pick('instance'); for (const kind of [undefined, null, '', 'layout', 'override', 'constructor', 'toString', '__proto__', 'backend', 1, {}, []]) {
    assert.throws(() => validateSceneAuthoringCandidate(kind, c.proposal, c.payload, { sourceRevision: c.sourceRevision }), invalid);
  }
});

test('every domain retains strict preview envelope scene owner source hash saved baseline and forbidden capability boundaries', () => {
  for (const kind of ['instance', 'positions', 'fragment', 'placement', 'structure']) rejects(pick(kind), [
    c => { c.payload.ok = false; }, c => { c.payload.format = 'other'; }, c => { c.payload.schemaVersion = 1; }, c => { c.payload.previewId = 'bad'; },
    c => { c.payload.sceneEditing = null; }, c => { c.payload.snapshot = null; }, c => { c.payload.scene.objectId = id(99); },
    c => { c.payload.scene.sourcePath = 'other.json'; }, c => { c.payload.scene.sourceRevision = revision('other'); },
    c => { c.payload.composition.format = 'other'; }, c => { c.payload.composition.schemaVersion = 2; }, c => { c.payload.composition.recipeObjectId = id(99); },
    c => { c.payload.composition.sourcePath = 'other.json'; }, c => { c.payload.composition.sourceRevision = revision('other'); },
    c => { c.payload.composition.fragmentCount = 0; }, c => { c.payload.composition.fragmentCount = 33; }, c => { c.payload.composition.fragmentCount = 1.5; },
    c => { c.payload.composition.placementCount = 0; }, c => { c.payload.composition.placementCount = 129; }, c => { c.payload.composition.placementCount = '2'; },
    c => { c.payload.draft.baseSourceRevision = revision('other'); }, c => { c.payload.draft.sourceRevision = revision('other'); },
    c => { c.sourceRevision = revision('other'); }, c => { c.proposal.sceneId = 'bad'; }, c => { c.proposal.baseSourceRevision = 'bad'; },
    c => { c.proposal.sourcePath = ''; }, c => { c.proposal.afterContent = false; }, c => { c.proposal.afterContent = '🦊'.repeat(32769); },
  ]);
});

test('missing non-record and malformed nested shapes yield the same diagnostic refusal instead of raw TypeErrors', () => {
  for (const kind of ['instance', 'positions', 'fragment', 'placement', 'structure']) {
    const c = pick(kind);
    for (const value of [undefined, null, false, 0, '', [], () => {}]) {
      assert.throws(() => validateSceneAuthoringCandidate(kind, value, c.payload, { sourceRevision: c.sourceRevision }), invalid);
      assert.throws(() => validateSceneAuthoringCandidate(kind, c.proposal, value, { sourceRevision: c.sourceRevision }), invalid);
    }
    for (const value of [undefined, null, {}, []]) assert.throws(() => validateSceneAuthoringCandidate(kind, c.proposal, c.payload, value), invalid);
    rejects(c, [d => { delete d.payload.scene; }, d => { d.payload.scene = null; }, d => { delete d.payload.composition; }, d => { d.payload.composition = null; },
      d => { delete d.payload.draft; }, d => { d.payload.draft = null; }, d => { d.payload.actors = {}; }, d => { d.payload.actors[0] = null; }]);
  }
  for (const kind of ['positions', 'fragment', 'placement', 'structure']) rejects(pick(kind), [c => { delete c.payload.sourceLocations; }, c => { c.payload.sourceLocations.actors = null; }, c => { c.payload.sourceLocations.actors[0] = null; }]);
});

test('invalid errors preserve the rejected payload for existing diagnostic handlers', () => {
  const c = pick('instance'); c.payload.ok = false;
  assert.throws(() => run(c), error => invalid(error) && error.payload === c.payload && /reviewed source/.test(error.message));
});

test('instance fields and layout require their selected actor to remain in the candidate', () => {
  const c = pick('instance'); rejects(c, [d => { d.proposal.instanceId = id(88); }, d => { d.payload.actors = []; }, d => { d.payload.actors.shift(); }]);
  assert.equal(run(saved[1]).kind, 'instance');
});

test('position batches retain bounded unique changed actors and their placement-local provenance', () => {
  const c = pick('positions'); rejects(c, [
    d => { d.proposal.changes = []; }, d => { d.proposal.changes = Array.from({ length: 129 }, () => d.proposal.changes[0]); },
    d => { d.proposal.changes[1].instanceId = d.proposal.changes[0].instanceId; }, d => { d.proposal.changes[0] = null; },
    d => { d.proposal.changes[0].instanceId = id(88); }, d => { d.proposal.changes[0].placementId = id(88); }, d => { d.proposal.changes[0].actorKey = 'other'; },
    d => { d.payload.actors.shift(); }, d => { d.payload.sourceLocations.actors.shift(); },
    d => { d.payload.sourceLocations.actors[0].composition.placementId = id(88); }, d => { d.payload.sourceLocations.actors[0].composition.localKey = 'other'; },
  ]);
});

test('shared fragments retain the full related target set in source order with a unique selected instance', () => {
  const c = pick('fragment'); rejects(c, [
    d => { d.proposal.targets = []; }, d => { d.proposal.targets.pop(); }, d => { d.proposal.targets.reverse(); }, d => { d.proposal.targets.push({ ...d.proposal.targets[0] }); },
    d => { d.proposal.targets[1].instanceId = d.proposal.targets[0].instanceId; }, d => { d.proposal.targets[0] = null; }, d => { d.proposal.instanceId = id(88); },
    d => { d.proposal.targets[0].placementId = id(88); }, d => { d.proposal.fragmentId = 'unused'; }, d => { d.proposal.actorKey = 'companion'; },
    d => { d.payload.sourceLocations.actors.reverse(); }, d => { d.payload.sourceLocations.actors[0].composition = null; }, d => { d.payload.actors.shift(); },
  ]);
});

test('placement actors retain exact source-ordered targets unique identities and local keys', () => {
  const c = pick('placement'); rejects(c, [
    d => { d.proposal.targets = []; }, d => { d.proposal.targets.pop(); }, d => { d.proposal.targets.reverse(); }, d => { d.proposal.targets[1].instanceId = d.proposal.targets[0].instanceId; },
    d => { d.proposal.instanceId = id(88); }, d => { d.proposal.placementId = id(88); }, d => { d.proposal.fragmentId = 'unused'; }, d => { d.proposal.targets[0].actorKey = 'other'; },
    d => { d.payload.actors.push({ ...d.payload.actors[2] }); }, d => { d.payload.sourceLocations.actors[2].composition.localKey = 'other'; },
    d => { d.payload.sourceLocations.actors.push({ ...d.payload.sourceLocations.actors[2] }); },
  ]);
});

test('placement group membership comes from sceneStructure and keeps complete ordered group provenance', () => {
  const c = pick('placement'); rejects(c, [
    d => { d.proposal.groups.pop(); }, d => { d.proposal.groups.reverse(); }, d => { d.proposal.groups.push({ ...d.proposal.groups[0] }); }, d => { d.proposal.groups[1].groupId = d.proposal.groups[0].groupId; },
    d => { d.proposal.groups[0].groupKey = 'other'; }, d => { d.proposal.groups[0] = null; }, d => { delete d.payload.sceneStructure; },
    d => { d.payload.sceneStructure.groups = []; }, d => { d.payload.sceneStructure.groups[0] = null; }, d => { d.payload.sceneStructure.groups.push({ ...d.payload.sceneStructure.groups[2] }); },
    d => { d.payload.sourceLocations.groups.pop(); }, d => { d.payload.sourceLocations.groups.reverse(); }, d => { d.payload.sourceLocations.groups[2].composition.localKey = 'other'; },
    d => { d.payload.sourceLocations.groups[2].composition.fragmentId = 'unused'; }, d => { d.payload.sourceLocations.groups[2].composition.placementId = id(88); },
    d => { d.payload.sourceLocations.groups[2] = null; },
  ]);
  const extraTopLevelGroups = structuredClone(c); extraTopLevelGroups.payload.groups = []; assert.equal(run(extraTopLevelGroups).kind, 'placement');
});

test('structure validates complete actor and group identity and source-ordered provenance against actual Rust expansion', () => {
  const c = pick('structure'); rejects(c, [
    d => { d.payload.composition.fragmentCount++; }, d => { d.payload.composition.placementCount++; },
    d => { d.payload.actors.pop(); }, d => { d.payload.actors[1] = { ...d.payload.actors[0] }; }, d => { d.payload.actors[0].objectId = id(88); },
    d => { d.payload.sourceLocations.actors.pop(); }, d => { d.payload.sourceLocations.actors.reverse(); }, d => { d.payload.sourceLocations.actors[0].instanceId = id(88); },
    d => { d.payload.sourceLocations.actors[0].objectId = id(88); }, d => { d.payload.sourceLocations.actors[0].composition.fragmentId = 'unused'; },
    d => { d.payload.sourceLocations.actors[0].composition.placementId = id(88); }, d => { d.payload.sourceLocations.actors[0].composition.localKey = 'other'; },
    d => { d.payload.sourceLocations.actors[0].declaration.objectId = id(88); }, d => { d.payload.sourceLocations.actors[0].declaration.sourcePath = 'other.json'; },
    d => { d.payload.sourceLocations.actors[0].declaration.sourceRevision = revision('other'); }, d => { d.payload.sourceLocations.actors[0].declaration = null; },
    d => { d.payload.sceneStructure.groups.pop(); }, d => { d.payload.sceneStructure.groups[1] = { ...d.payload.sceneStructure.groups[0] }; },
    d => { d.payload.sourceLocations.groups.pop(); }, d => { d.payload.sourceLocations.groups.reverse(); }, d => { d.payload.sourceLocations.groups[0].groupId = id(88); },
    d => { d.payload.sourceLocations.groups[0].composition.fragmentId = 'unused'; }, d => { d.payload.sourceLocations.groups[0].composition.placementId = id(88); },
    d => { d.payload.sourceLocations.groups[0].composition.localKey = 'other'; }, d => { d.payload.sourceLocations.groups[0].declaration.objectId = id(88); },
    d => { d.payload.sourceLocations.groups[0].declaration.sourcePath = 'other.json'; }, d => { d.payload.sourceLocations.groups[0].declaration.sourceRevision = revision('other'); },
  ]);
});

test('structure removal accepts the removed opener being absent and unused fragment edits retain empty target sets', () => {
  const removed = saved.find(c => c.kind === 'structure' && c.proposal.edit.action === 'remove');
  assert.equal(removed.payload.actors.some(a => a.instanceId === removed.proposal.targets[0].instanceId), false); assert.equal(run(removed).kind, 'structure');
  const unused = saved.find(c => c.kind === 'structure' && c.proposal.edit.fragmentId === 'unused'); assert.deepEqual(unused.proposal.targets, []); assert.equal(run(unused).kind, 'structure');
});

test('structure rejects malformed duplicate-key or out-of-range recipes before granting a candidate receipt', () => {
  const c = pick('structure'); rejects(c, [
    d => { d.proposal.afterContent = '{}'; }, d => { d.proposal.afterContent = '{'; },
    d => { d.proposal.afterContent = d.proposal.afterContent.replace('"schemaVersion": 1', '"schemaVersion": 1,"schema\\u0056ersion":1'); },
    d => { const value = JSON.parse(d.proposal.afterContent.replace(/^\uFEFF/, '')); value.fragments[0].actors[0].position = [100001, 0]; d.proposal.afterContent = serialize(value); },
  ]);
});

test('projection-resolved candidate values remain compatible with raw inherited recipe declarations', () => {
  const c = pick('fragment'), value = JSON.parse(c.proposal.afterContent.replace(/^\uFEFF/, ''));
  assert.equal(Object.hasOwn(value.fragments[0].actors[0], 'size'), false); assert.deepEqual(c.payload.actors[0].size, [80, 60]);
  assert.equal(run(c).kind, 'fragment');
});
