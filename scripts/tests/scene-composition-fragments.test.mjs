import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createSceneCompositionFragmentDraft, prepareSceneCompositionFragmentApply } from '../../engine/scene-composition-fragments.mjs';
import { expandSceneComposition } from '../../engine/scene-composition.mjs';
import { resolveSceneCompositionPreview } from '../../engine/scene-composition-preview.mjs';
import { createWorldProjection } from '../../engine/world-projection.mjs';
import { scene2DModelToPlan } from '../../engine/build-plan.mjs';
import { createSceneStructure } from '../../engine/scene-structure.mjs';

const golden = JSON.parse(await fs.readFile(new URL('./fixtures/scene-model/legacy-plan-v1.json', import.meta.url), 'utf8'));
const example = JSON.parse(await fs.readFile(new URL('../../examples/scene-composition/recipe.json', import.meta.url), 'utf8'));
const { ids } = golden;
const hash = content => createHash('sha256').update(content).digest('hex');
const revision = content => `sha256:${hash(content)}`;
const parse = content => JSON.parse(content.replace(/^\uFEFF/, ''));
const serialize = value => '\uFEFF' + JSON.stringify(value, null, '\t').replaceAll('\n', '\r\n') + '\r\n \t';
const unchanged = error => error?.errorCode === 'scene_composition_override_unchanged';
const invalid = error => error?.errorCode === 'scene_composition_override_invalid';
const conflict = error => error?.errorCode === 'scene_composition_override_conflict';
function recipe() {
  const value = structuredClone(example);
  value.scene.title = 'Shared fragment / 共有宣言 / 🦊';
  value.fragments[0].actors[0] = { key: 'leader', objectId: ids.first, groupKey: 'party', position: [120, 180], useProjectionDefaults: true };
  value.fragments[0].actors[1] = { key: 'companion', objectId: ids.second, groupKey: 'companions', position: [200, 180],
    useProjectionDefaults: true, size: [48, 48], speed: 17, color: '#112233', controls: 'arrows', imageResourceId: null };
  return value;
}
async function fixture(value = recipe(), { dirty = false } = {}) {
  const observed = structuredClone(golden.observed);
  observed.source.workspace.version = 3;
  observed.source.definition = { documentTypes: [{ id: 'document', label: 'Document' }] };
  const document = observed.source.documents.find(item => item.record.id === ids.scene);
  document.record.relations = []; document.record.assetBindings = [];
  document.content = typeof value === 'string' ? value : serialize(value); document.sourceRevision = revision(document.content);
  for (const item of observed.source.documents) item.descriptor = { ...item.record };
  observed.projection = await createWorldProjection(observed.source, { digest: hash });
  const result = await resolveSceneCompositionPreview(observed, ids.scene, { digest: hash });
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  const plan = scene2DModelToPlan(result.model);
  const model = { ok: true, format: 'viento-scene-preview', schemaVersion: 2, scene: plan.scene, actors: plan.actors,
    sourceLocations: result.model.sourceLocations, composition: result.composition, sceneStructure: createSceneStructure(result.model) };
  const source = { sourcePath: document.sourcePath, baseSourceRevision: dirty ? revision('saved baseline') : document.sourceRevision, content: document.content };
  if (dirty) model.draft = { baseSourceRevision: source.baseSourceRevision, sourceRevision: document.sourceRevision };
  return { model, source };
}
async function open(f = null, actor = 0) {
  f ||= await fixture();
  const draft = await createSceneCompositionFragmentDraft(f.model, f.source, f.model.actors[actor].instanceId, { digest: hash });
  return { ...f, draft };
}
const prepare = (source, proposal, digest = hash) => prepareSceneCompositionFragmentApply(source, proposal, { digest });
function deferred() { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; }

test('saved and dirty shared drafts expose only raw declarations and canonical source-ordered targets', async () => {
  for (const dirty of [false, true]) {
    const { draft, source, model } = await open(await fixture(recipe(), { dirty }), 2);
    assert.deepEqual(draft.values, { position: [120, 180] });
    assert.equal(draft.instanceId, model.actors[2].instanceId); assert.equal(draft.objectId, ids.first);
    assert.equal(draft.fragmentId, example.fragments[0].fragmentId); assert.equal(draft.actorKey, 'leader'); assert.equal(draft.useProjectionDefaults, true);
    assert.deepEqual(draft.targets, [
      { instanceId: model.actors[0].instanceId, placementId: example.placements[0].placementId, overrides: [] },
      { instanceId: model.actors[2].instanceId, placementId: example.placements[1].placementId, overrides: ['position', 'color', 'speed', 'controls'] },
    ]);
    assert.throws(() => draft.propose({ position: [120, 180] }), unchanged);
    assert.equal(draft.propose({ speed: model.actors[2].speed }).baseSourceRevision, source.baseSourceRevision);
  }
});

test('only authored fields change a shared template while every placement identity and override remains byte-stable', async () => {
  const { draft, source, model } = await open(await fixture(recipe(), { dirty: true }));
  const proposal = draft.propose({ position: [130, 190], speed: 123, controls: 'none' });
  assert.deepEqual(proposal.values, { position: [130, 190], speed: 123, controls: 'none' });
  assert.deepEqual(proposal.changedPaths, ['/fragments/0/actors/0/position', '/fragments/0/actors/0/speed', '/fragments/0/actors/0/controls']);
  assert.deepEqual(proposal.targets, draft.targets); assert.equal(proposal.sourceRevision, revision(source.content));
  const before = parse(source.content), after = parse(proposal.afterContent);
  assert.deepEqual(after.placements, before.placements); assert.deepEqual(after.scene, before.scene);
  assert.deepEqual(after.fragments[0].groups, before.fragments[0].groups);
  assert.deepEqual(after.fragments[0].actors[1], before.fragments[0].actors[1]);
  assert.equal(after.fragments[0].actors[0].useProjectionDefaults, true);
  const actors = expandSceneComposition(proposal.afterContent).scene.actors;
  assert.deepEqual(actors[0].position, [130, 190]); assert.deepEqual(actors[2].position, model.actors[2].position);
  assert.equal(actors[0].speed, 123); assert.equal(actors[2].speed, model.actors[2].speed);
  assert.equal(proposal.afterContent.startsWith('\uFEFF'), true); assert.equal(proposal.afterContent.endsWith('\r\n \t'), true);
  assert.deepEqual(await prepare(source, proposal), { afterContent: proposal.afterContent, changedPaths: proposal.changedPaths });
});

test('an undeclared field matching the selected instance effective value is still an explicit shared declaration', async () => {
  const { draft, source, model } = await open(null, 2), values = { speed: model.actors[2].speed, color: model.actors[2].color };
  const proposal = draft.propose(values), after = parse(proposal.afterContent);
  assert.deepEqual(proposal.values, values); assert.deepEqual(proposal.changedPaths, ['/fragments/0/actors/0/color', '/fragments/0/actors/0/speed']);
  assert.deepEqual(after.placements, parse(source.content).placements);
  assert.equal(after.fragments[0].actors[0].speed, model.actors[2].speed); assert.equal(after.fragments[0].actors[0].size, undefined);
  assert.deepEqual(await prepare(source, proposal), { afterContent: proposal.afterContent, changedPaths: proposal.changedPaths });
});

test('existing declared semantic noops are omitted without publishing incidental effective defaults', async () => {
  const { draft, source } = await open(null, 1);
  assert.throws(() => draft.propose(draft.values), unchanged);
  const proposal = draft.propose({ position: draft.values.position, size: [48, 48], speed: 17, controls: 'none' });
  assert.deepEqual(proposal.values, { controls: 'none' }); assert.deepEqual(proposal.changedPaths, ['/fragments/0/actors/1/controls']);
  assert.equal(proposal.afterContent, source.content.replace('"controls": "arrows"', '"controls": "none"'));
});

test('all overridden instances can conceal runtime changes while the template declaration still changes', async () => {
  const value = recipe(); value.fragments[0].actors[0].speed = 100;
  value.placements[0].overrides = [{ actorKey: 'leader', values: { speed: 180 } }];
  value.placements[1].overrides[0].values.speed = 180;
  const { draft, source } = await open(await fixture(value)); const proposal = draft.propose({ speed: 120 });
  assert.deepEqual(proposal.changedPaths, ['/fragments/0/actors/0/speed']);
  const actors = expandSceneComposition(proposal.afterContent).scene.actors;
  assert.equal(actors[0].speed, 180); assert.equal(actors[2].speed, 180);
  assert.notEqual(source.content, proposal.afterContent); assert.deepEqual(await prepare(source, proposal), { afterContent: proposal.afterContent, changedPaths: proposal.changedPaths });
});

test('offset validation is atomic and local coverage can shield a placement from shared position change', async () => {
  const value = recipe(); value.placements[1].offset = [99900, 0];
  value.fragments[0].actors.forEach(actor => { actor.position = [0, 0]; }); value.placements[1].overrides[0].values.position = [0, 0];
  const { draft, source } = await open(await fixture(value)); const good = draft.propose({ position: [101, 0] });
  assert.deepEqual(expandSceneComposition(good.afterContent).scene.actors[2].position, [99900, 0]);
  assert.deepEqual(await prepare(source, good), { afterContent: good.afterContent, changedPaths: good.changedPaths });
  const companion = await open(await fixture(value), 1);
  assert.throws(() => companion.draft.propose({ position: [101, 0] }), { errorCode: 'scene_composition_invalid' });
  assert.deepEqual(companion.draft.values.position, [0, 0]); assert.equal(source.content, serialize(value));
});

test('all six fields can be set with explicit null only when template inheritance permits it', async () => {
  const { draft, source } = await open();
  const proposal = draft.propose({ position: [130, 190], size: [64, 96], color: '#abcDEF88', speed: 0, controls: 'none', imageResourceId: null });
  assert.equal(proposal.changedPaths.length, 6);
  assert.deepEqual(await prepare(source, proposal), { afterContent: proposal.afterContent, changedPaths: proposal.changedPaths });
  const value = recipe(); value.fragments[0].actors[1].useProjectionDefaults = false; delete value.fragments[0].actors[1].imageResourceId;
  const strict = await open(await fixture(value), 1); assert.equal(strict.draft.useProjectionDefaults, false);
  assert.throws(() => strict.draft.propose({ imageResourceId: null }), { errorCode: 'scene_composition_invalid' });
});

test('source lexemes keep BOM CRLF escaped keys numeric spellings and unchanged axes', async () => {
  let raw = serialize(recipe()).replace('"position": [\r\n\t\t\t\t\t\t120,', '"posit\\u0069on": [\r\n\t\t\t\t\t\t1.200e2,');
  assert.notEqual(raw, serialize(recipe()));
  const { draft, source } = await open(await fixture(raw)); const proposal = draft.propose({ position: [121, 180] });
  assert.equal(proposal.afterContent, source.content.replace('1.200e2', '121'));
  assert.deepEqual(await prepare(source, proposal), { afterContent: proposal.afterContent, changedPaths: proposal.changedPaths });
});

test('raw draft values targets and returned proposals are independently detached', async () => {
  const { draft, source } = await open();
  draft.values.position[0] = 999; draft.targets[0].overrides.push('size'); draft.targets.reverse();
  const input = { position: [130, 190], size: [48, 64] }, proposal = draft.propose(input);
  input.position[0] = 999; proposal.values.position[0] = 999; proposal.targets[0].instanceId = ids.first; proposal.changedPaths.reverse();
  const pristine = draft.propose({ position: [130, 190], size: [48, 64] });
  assert.deepEqual(pristine.values.position, [130, 190]); assert.equal(pristine.targets[0].overrides.length, 0);
  assert.deepEqual(await prepare(source, pristine), { afterContent: pristine.afterContent, changedPaths: pristine.changedPaths });
});

test('factory snapshots all model source and provenance data before its one asynchronous digest', async () => {
  const f = await fixture(recipe(), { dirty: true }), before = structuredClone(f), wait = deferred(); let content, calls = 0;
  const pending = createSceneCompositionFragmentDraft(f.model, f.source, f.model.actors[0].instanceId, { digest: text => { content = text; calls++; return wait.promise; } });
  f.model.actors[2].position[0] = 999; f.model.sourceLocations.actors[2].composition.localKey = 'forged'; f.source.content = '{}';
  wait.resolve(hash(content)); const draft = await pending;
  assert.equal(calls, 1); assert.deepEqual(draft.values, { position: [120, 180] });
  const proposal = draft.propose({ speed: 100 }); assert.equal(proposal.sourceRevision, revision(before.source.content));
  assert.deepEqual(await prepare(before.source, proposal), { afterContent: proposal.afterContent, changedPaths: proposal.changedPaths });
});

test('apply snapshots source proposal nested values targets and byte receipt before digest', async () => {
  const { draft, source } = await open(), proposal = draft.propose({ position: [130, 190], speed: 100 }), before = structuredClone(proposal);
  const wait = deferred(); let text;
  const pending = prepare(source, proposal, content => { text = content; return wait.promise; });
  source.content = '{}'; proposal.values.position[0] = 999; proposal.targets.reverse(); proposal.changedPaths.reverse(); proposal.afterContent = '{}';
  wait.resolve(hash(text)); assert.deepEqual(await pending, { afterContent: before.afterContent, changedPaths: before.changedPaths });
});

test('current source baseline and path conflicts reject before replacing editor memory', async () => {
  const { draft, source } = await open(), proposal = draft.propose({ speed: 100 });
  for (const current of [{ ...source, content: source.content + ' ' }, { ...source, sourcePath: 'other.json' }, { ...source, baseSourceRevision: revision('changed') }]) {
    await assert.rejects(prepare(current, proposal), conflict);
  }
});

test('apply recomputes strict target order override coverage mappings fields and exact byte receipt', async () => {
  const { draft, source } = await open(), proposal = draft.propose({ position: [130, 190], speed: 100 });
  for (const alter of [p => { p.afterContent += ' '; }, p => { p.targets.reverse(); }, p => { p.targets[0].instanceId = p.targets[1].instanceId; },
    p => { p.targets[1].overrides.reverse(); }, p => { p.targets[1].placementId = p.targets[0].placementId; }, p => { p.targets.pop(); },
    p => { p.targets.push(structuredClone(p.targets[0])); }, p => { p.targets[0].extra = true; }, p => { p.instanceId = ids.first; },
    p => { p.fragmentId = 'missing'; }, p => { p.actorKey = 'companion'; }, p => { p.values.position[0]++; },
    p => { p.values.color = '#112233'; }, p => { p.values.position = [120, 180]; }, p => { p.changedPaths.reverse(); }, p => { p.resetFields = []; }]) {
    const changed = structuredClone(proposal); alter(changed); await assert.rejects(prepare(source, changed), invalid);
  }
});

test('the complete preview provenance is bound including siblings duplicates and nonselected placements', async () => {
  const f = await fixture();
  for (const mutate of [x => { x.model.sourceLocations.actors[3].composition.placementId = example.placements[0].placementId; },
    x => { x.model.sourceLocations.actors[2].declaration.sourceRevision = revision('stale'); },
    x => { x.model.sourceLocations.actors.push(structuredClone(x.model.sourceLocations.actors[0])); },
    x => { x.model.sourceLocations.actors[3] = structuredClone(x.model.sourceLocations.actors[2]); },
    x => { x.model.actors[3].position[0]++; }, x => { x.model.sceneEditing = {}; },
    x => { x.source.content += ' '; }, x => { x.source.baseSourceRevision = revision('other'); }]) {
    const changed = structuredClone(f); mutate(changed);
    await assert.rejects(createSceneCompositionFragmentDraft(changed.model, changed.source, changed.model.actors[0].instanceId, { digest: hash }), e => invalid(e) || conflict(e));
  }
});

test('strict set-only inputs reject identity reset invalid omitted and sparse values without poisoning the draft', async () => {
  const { draft } = await open();
  for (const values of [null, [], { objectId: ids.first }, { key: 'other' }, { groupKey: 'other' }, { useProjectionDefaults: false }, { resetFields: ['speed'] },
    { position: new Array(2) }, { position: [NaN, 1] }, { position: [Infinity, 1] }, { size: [0, 1] }, { speed: 2001 }, { controls: 'wasd' }, { color: 'red' }, { imageResourceId: '' }]) {
    assert.throws(() => draft.propose(values), invalid);
  }
  assert.throws(() => draft.propose({}), unchanged); assert.equal(draft.propose({ speed: 1 }).values.speed, 1);
});

test('invalid sources hashes revisions and ordinary scene bindings cannot create a shared fragment draft', async () => {
  const f = await fixture();
  for (const source of [{ ...f.source, extra: true }, { ...f.source, content: '\uD800' }, { ...f.source, sourcePath: 'scene.md' }, { ...f.source, baseSourceRevision: 'sha256:bad' }]) {
    await assert.rejects(createSceneCompositionFragmentDraft(f.model, source, f.model.actors[0].instanceId, { digest: hash }), invalid);
  }
  await assert.rejects(createSceneCompositionFragmentDraft(f.model, f.source, f.model.actors[0].instanceId, { digest: () => 'bad' }), invalid);
  await assert.rejects(createSceneCompositionFragmentDraft(f.model, f.source, ids.first, { digest: hash }), invalid);
  const ordinary = structuredClone(f.model); delete ordinary.composition;
  await assert.rejects(createSceneCompositionFragmentDraft(ordinary, f.source, f.model.actors[0].instanceId, { digest: hash }), invalid);
});
