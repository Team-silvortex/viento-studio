import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createSceneCompositionLayoutDraft } from '../../engine/scene-composition-layout.mjs';
import { prepareSceneCompositionOverrideApply } from '../../engine/scene-composition-overrides.mjs';
import { expandSceneComposition } from '../../engine/scene-composition.mjs';
import { resolveSceneCompositionPreview } from '../../engine/scene-composition-preview.mjs';
import { createWorldProjection } from '../../engine/world-projection.mjs';
import { scene2DModelToPlan } from '../../engine/build-plan.mjs';
import { createSceneStructure } from '../../engine/scene-structure.mjs';
import { parseJsonSource, locateJsonSource } from '../../engine/json-source.mjs';

const golden = JSON.parse(await fs.readFile(new URL('./fixtures/scene-model/legacy-plan-v1.json', import.meta.url), 'utf8'));
const example = JSON.parse(await fs.readFile(new URL('../../examples/scene-composition/recipe.json', import.meta.url), 'utf8'));
const { ids } = golden;
const hash = content => createHash('sha256').update(content).digest('hex');
const revision = content => `sha256:${hash(content)}`;
const parse = content => JSON.parse(content.replace(/^\uFEFF/, ''));
const serialize = value => '\uFEFF' + JSON.stringify(value, null, '\t').replaceAll('\n', '\r\n') + '\r\n \t';
const positionInvalid = error => error?.errorCode === 'scene_layout_position_invalid';
const unchanged = error => error?.errorCode === 'scene_composition_override_unchanged';
const sourceInvalid = error => error?.errorCode === 'scene_composition_override_invalid';
const conflict = error => error?.errorCode === 'scene_composition_override_conflict';
const runtimeActor = ({ fieldSources, declaration, ...value }) => value;

function recipe() {
  const value = structuredClone(example);
  value.scene.title = '配方🦊 / Canvas / キャンバス';
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
  document.content = typeof value === 'string' ? value : serialize(value);
  document.sourceRevision = revision(document.content);
  for (const item of observed.source.documents) item.descriptor = { ...item.record };
  observed.projection = await createWorldProjection(observed.source, { digest: hash });
  const result = await resolveSceneCompositionPreview(observed, ids.scene, { digest: hash });
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  const plan = scene2DModelToPlan(result.model);
  const model = { ok: true, format: 'viento-scene-preview', schemaVersion: 2, scene: plan.scene, actors: plan.actors,
    sourceLocations: result.model.sourceLocations, composition: result.composition, sceneStructure: createSceneStructure(result.model) };
  const source = { sourcePath: document.sourcePath, baseSourceRevision: dirty ? revision('saved baseline') : document.sourceRevision, content: document.content };
  if (dirty) model.draft = { baseSourceRevision: source.baseSourceRevision, sourceRevision: document.sourceRevision };
  return { model, source, observed };
}
async function open(t, f = null, index = 2) {
  f ||= await fixture();
  const draft = await createSceneCompositionLayoutDraft(f.model, f.source, f.model.actors[index].instanceId, { digest: hash });
  t.after(() => draft.dispose());
  return { ...f, draft };
}
const prepare = (source, proposal, digest = hash) => prepareSceneCompositionOverrideApply(source, proposal, { digest });
function deferred() {
  let resolve;
  const promise = new Promise(yes => { resolve = yes; });
  return { promise, resolve };
}

test('saved and dirty recipe sources bind one stable instance with all other canvas actors detached', async t => {
  for (const dirty of [false, true]) {
    const f = await fixture(recipe(), { dirty }), original = structuredClone(f), { draft } = await open(t, f);
    assert.equal(draft.actorId, f.model.actors[2].instanceId);
    assert.equal(draft.objectId, ids.first); assert.equal(draft.placementId, recipe().placements[1].placementId);
    assert.equal(draft.actorKey, 'leader'); assert.deepEqual(draft.offset, [360, 80]);
    assert.deepEqual(draft.currentPosition(draft.actorId), [460, 220]); assert.deepEqual(draft.localPosition(), [100, 140]);
    assert.deepEqual(draft.state(), { dirty: false, canUndo: false, canRedo: false });
    assert.deepEqual(draft.actors(), f.model.actors); assert.throws(() => draft.propose(), unchanged);
    const actors = draft.actors(); actors[0].position[0] = 900; actors[2].size[0] = 999;
    draft.offset[0] = 999; draft.currentPosition(draft.actorId)[0] = 999; draft.localPosition()[0] = 999;
    assert.deepEqual(draft.actors(), original.model.actors); assert.deepEqual(f, original);
  }
});

test('canvas world coordinates produce only an exact local position patch with untouched source bytes', async t => {
  const raw = serialize(recipe()).replace('"position": [', '"posit\\u0069on": [');
  const f = await fixture(raw, { dirty: true }), before = structuredClone(f), { draft } = await open(t, f);
  assert.equal(draft.setPosition(draft.actorId, [510, 250]), true);
  const proposal = draft.propose();
  assert.deepEqual(proposal.values, { position: [150, 170] }); assert.equal(Object.hasOwn(proposal, 'resetFields'), false);
  assert.equal(proposal.baseSourceRevision, f.source.baseSourceRevision);
  assert.deepEqual(proposal.changedPaths, ['/placements/1/overrides/0/values/position']);
  const path = proposal.changedPaths[0], oldRange = locateJsonSource(parseJsonSource(raw), path), nextRange = locateJsonSource(parseJsonSource(proposal.afterContent), path);
  assert.equal(oldRange.exact, true); assert.equal(nextRange.exact, true);
  assert.equal(raw.slice(0, oldRange.start), proposal.afterContent.slice(0, nextRange.start));
  assert.equal(raw.slice(oldRange.end), proposal.afterContent.slice(nextRange.end));
  assert.equal(proposal.afterContent.startsWith('\uFEFF'), true); assert.equal(proposal.afterContent.endsWith('\r\n \t'), true);
  assert.deepEqual(await prepare(f.source, proposal), { afterContent: proposal.afterContent, changedPaths: proposal.changedPaths });
  const candidate = expandSceneComposition(proposal.afterContent);
  assert.deepEqual(candidate.scene.actors[2].position, [510, 250]);
  assert.deepEqual(draft.actors().filter(actor => actor.instanceId !== draft.actorId), f.model.actors.filter(actor => actor.instanceId !== draft.actorId));
  assert.deepEqual(f, before);
});

test('a first position override keeps template, sibling instances, placement offset and group UUIDs unchanged', async t => {
  const f = await fixture(), { draft } = await open(t, f, 0), before = parse(f.source.content);
  draft.setPosition(draft.actorId, [140, 190]); const proposal = draft.propose(), after = parse(proposal.afterContent);
  assert.deepEqual(after.placements[0].overrides, [{ actorKey: 'leader', values: { position: [140, 190] } }]);
  delete after.placements[0].overrides; assert.deepEqual(after, before);
  const candidate = expandSceneComposition(proposal.afterContent), original = expandSceneComposition(f.source.content);
  assert.deepEqual(candidate.scene.actors.map(actor => actor.instanceId), original.scene.actors.map(actor => actor.instanceId));
  assert.deepEqual(candidate.scene.actors.slice(1), original.scene.actors.slice(1)); assert.deepEqual(candidate.scene.groups, original.scene.groups);
});

test('moving an explicitly suppressed image never promotes inherited appearance or edits its sibling definition', async t => {
  const f = await fixture(), { draft } = await open(t, f, 3);
  assert.equal(draft.actors()[3].imageResourceId, undefined);
  draft.setPosition(draft.actorId, [590, 240]); const proposal = draft.propose();
  assert.deepEqual(proposal.values, { position: [230, 160] });
  const after = parse(proposal.afterContent);
  assert.equal(after.fragments[0].actors[1].imageResourceId, null);
  assert.deepEqual(after.placements[1].overrides[1].values, { position: [230, 160] });
  const next = await fixture(proposal.afterContent);
  assert.deepEqual(runtimeActor(next.model.actors[1]), runtimeActor(f.model.actors[1]));
  assert.deepEqual(parse(proposal.afterContent).fragments, parse(f.source.content).fragments);
  assert.equal(next.model.actors[3].imageResourceId, undefined);
});

test('stable instance identity locates the same placement after declaration order changes', async t => {
  const value = recipe(); value.placements.reverse();
  const f = await fixture(value), { draft } = await open(t, f, 0);
  assert.equal(draft.actorId, example.placements[1].actorIds.leader);
  draft.setPosition(draft.actorId, [490, 250]); const proposal = draft.propose();
  assert.equal(proposal.placementId, example.placements[1].placementId);
  assert.deepEqual(proposal.changedPaths, ['/placements/0/overrides/0/values/position']);
  assert.deepEqual(parse(proposal.afterContent).placements[1], value.placements[1]);
});

test('unmoved fractional axes keep authored local numbers and returning to the original world position has no proposal', async t => {
  const value = recipe(); value.placements[1].offset = [0.2, 0.2]; value.placements[1].overrides[0].values.position = [0.1, 0.1];
  const { draft } = await open(t, await fixture(value)), initial = draft.currentPosition(draft.actorId);
  assert.notEqual(initial[1] - draft.offset[1], 0.1);
  assert.equal(draft.setPosition(draft.actorId, [...initial]), false);
  draft.setPosition(draft.actorId, [initial[0] + 1, initial[1]]);
  assert.equal(draft.localPosition()[1], 0.1); assert.equal(draft.propose().values.position[1], 0.1);
  draft.undo(); assert.equal(draft.state().dirty, false); assert.throws(() => draft.propose(), unchanged);
  draft.redo(); draft.setPosition(draft.actorId, initial);
  assert.equal(draft.state().dirty, false); assert.throws(() => draft.propose(), unchanged);
  assert.deepEqual(draft.localPosition(), [0.1, 0.1]);
});

test('world movement and absolute grid snapping use existing Rust geometry with one history step', async t => {
  const { draft } = await open(t);
  draft.move([draft.actorId], [12, 6], 32);
  assert.deepEqual(draft.currentPosition(draft.actorId), [480, 224]); assert.deepEqual(draft.propose().values.position, [120, 144]);
  assert.equal(draft.undo(), true); assert.equal(draft.state().dirty, false); assert.equal(draft.undo(), false);
  assert.equal(draft.redo(), true); assert.deepEqual(draft.currentPosition(draft.actorId), [480, 224]);
  draft.move([draft.actorId], [10.4, -0.5]); assert.deepEqual(draft.currentPosition(draft.actorId), [490, 224]);
  assert.deepEqual(draft.propose().values.position, [130, 144]);
});

test('foreign UUIDs, multiple changes and invalid world input cannot mutate history or discard redo', async t => {
  const f = await fixture(), { draft } = await open(t, f), id = draft.actorId;
  draft.setPosition(id, [470, 220]); draft.undo(); const actors = draft.actors(), state = draft.state();
  const reject = [() => draft.setPosition(f.model.actors[0].instanceId, [10, 20]),
    () => draft.setPosition(ids.first, [10, 20]), () => draft.move([f.model.actors[0].instanceId], [1, 2]),
    () => draft.move([id, id], [1, 2]), () => draft.setPositions([{ objectId: id, position: [1, 2] }, { objectId: id, position: [3, 4] }]),
    () => draft.setPositions([{ objectId: id, position: [1, 2], extra: true }]), () => draft.setPositions(new Array(1)),
    ...[null, [1], [1, 2, 3], [NaN, 1], [Infinity, 0], [100001, 0], ['1', 2], new Array(2)].map(value => () => draft.setPosition(id, value))];
  for (const operation of reject) {
    assert.throws(operation, positionInvalid); assert.deepEqual(draft.state(), state); assert.deepEqual(draft.actors(), actors);
  }
  assert.equal(draft.setPositions([]), false); assert.equal(draft.move([], [1, 2]), false);
  assert.equal(draft.setPosition(id, [460, 220]), false); assert.deepEqual(draft.state(), state);
  assert.equal(draft.redo(), true); assert.deepEqual(draft.currentPosition(id), [470, 220]);
});

test('local offset bounds reject otherwise legal world coordinates before Rust positions and history change', async t => {
  for (const offset of [100000, -100000]) {
    const value = recipe(); value.fragments[0].actors.forEach(actor => { actor.position = [0, 0]; });
    value.placements[1].offset = [offset, 0]; value.placements[1].overrides[0].values.position = [0, 0];
    const { draft } = await open(t, await fixture(value));
    draft.setPosition(draft.actorId, [0, 0]); draft.undo(); const state = draft.state(), actors = draft.actors();
    assert.throws(() => draft.setPosition(draft.actorId, [-Math.sign(offset), 0]), positionInvalid);
    assert.throws(() => draft.move([draft.actorId], [-offset * 2, 0]), positionInvalid);
    assert.deepEqual(draft.state(), state); assert.deepEqual(draft.actors(), actors);
    assert.equal(draft.redo(), true);
    const proposal = draft.propose(); assert.deepEqual(proposal.values.position, [-offset, 0]);
    assert.deepEqual(expandSceneComposition(proposal.afterContent).scene.actors[2].position, [0, 0]);
  }
});

test('bounded Rust history retains the original baseline after truncation and reset clears both directions', async t => {
  const { draft } = await open(t);
  for (let x = 461; x <= 561; x++) draft.setPosition(draft.actorId, [x, 220]);
  let count = 0; while (draft.undo()) count++;
  assert.equal(count, 100); assert.deepEqual(draft.currentPosition(draft.actorId), [461, 220]); assert.equal(draft.state().dirty, true);
  draft.reset(); assert.deepEqual(draft.currentPosition(draft.actorId), [460, 220]);
  assert.deepEqual(draft.state(), { dirty: false, canUndo: false, canRedo: false }); assert.throws(() => draft.propose(), unchanged);
});

test('the new factory rejects forged preview ownership, stale author bytes and malformed source before creating a layout', async () => {
  const f = await fixture();
  const changes = [x => { x.model.actors[2].instanceId = x.model.actors[0].instanceId; },
    x => { x.model.actors[2].objectId = ids.core; }, x => { x.model.actors[2].position[0]++; },
    x => { x.model.sourceLocations.actors[2].composition.placementId = recipe().placements[0].placementId; },
    x => { x.model.sceneStructure.groups.reverse(); }, x => { x.model.sceneEditing = {}; },
    x => { x.source.content += ' '; }, x => { x.source.baseSourceRevision = revision('other'); },
    x => { x.source.sourcePath = 'other.json'; }];
  for (const change of changes) {
    const next = structuredClone(f); change(next);
    await assert.rejects(createSceneCompositionLayoutDraft(next.model, next.source, f.model.actors[2].instanceId, { digest: hash }),
      error => sourceInvalid(error) || conflict(error));
  }
  for (const content of ['{bad', f.source.content.replace('"schemaVersion": 1,', '"schemaVersion": 1, "schemaVersion": 1,'), f.source.content + '\ud800']) {
    await assert.rejects(createSceneCompositionLayoutDraft(f.model, { ...f.source, content }, f.model.actors[2].instanceId, { digest: hash }));
  }
  await assert.rejects(createSceneCompositionLayoutDraft(f.model, f.source, ids.first, { digest: hash }), sourceInvalid);
});

test('factory snapshots source and every actor before awaiting its digest and all exposed values remain detached', async t => {
  const f = await fixture(recipe(), { dirty: true }), original = structuredClone(f), wait = deferred();
  let passed;
  const pending = createSceneCompositionLayoutDraft(f.model, f.source, f.model.actors[2].instanceId, { digest: content => { passed = content; return wait.promise; } });
  f.model.actors[2].position[0] = 999; f.model.actors[0].color = '#aabbcc'; f.model.scene.objectId = ids.core;
  f.model.sourceLocations.actors[2].composition.placementId = 'changed';
  f.source.content = '{}'; f.source.baseSourceRevision = revision('changed');
  wait.resolve(hash(passed)); const draft = await pending; t.after(() => draft.dispose());
  assert.deepEqual(draft.actors(), original.model.actors); assert.deepEqual(draft.localPosition(), [100, 140]);
  const input = [510, 250]; draft.setPosition(draft.actorId, input); input[0] = 999;
  const proposal = draft.propose(); proposal.values.position[0] = 999;
  assert.deepEqual(draft.propose().values, { position: [150, 170] });
  assert.equal(draft.propose().sourceRevision, revision(original.source.content));
  assert.deepEqual(await prepare(original.source, draft.propose()), { afterContent: draft.propose().afterContent, changedPaths: draft.propose().changedPaths });
});

test('existing apply preparation recomputes position receipts and rejects stale, forged and substituted targets', async t => {
  const f = await fixture(), { draft } = await open(t, f); draft.setPosition(draft.actorId, [510, 250]); const proposal = draft.propose();
  for (const source of [{ ...f.source, content: f.source.content + ' ' }, { ...f.source, baseSourceRevision: revision('changed') }, { ...f.source, sourcePath: 'other.json' }]) {
    await assert.rejects(prepare(source, proposal), conflict);
  }
  for (const mutate of [p => { p.afterContent += ' '; }, p => { p.values.position[0]++; },
    p => { p.instanceId = f.model.actors[0].instanceId; }, p => { p.actorKey = 'companion'; }, p => { p.changedPaths = ['/actors/2/position']; }]) {
    const changed = structuredClone(proposal); mutate(changed); await assert.rejects(prepare(f.source, changed), sourceInvalid);
  }
  const wait = deferred(), current = structuredClone(f.source), candidate = structuredClone(proposal), original = structuredClone(proposal);
  let passed;
  const pending = prepare(current, candidate, content => { passed = content; return wait.promise; });
  current.content = '{}'; candidate.values.position[0] = 999; candidate.afterContent = 'forged';
  wait.resolve(hash(passed)); assert.deepEqual(await pending, { afterContent: original.afterContent, changedPaths: original.changedPaths });
});

test('a full source budget refuses coordinate growth while keeping the author source and recoverable layout untouched', async t => {
  const content = serialize(recipe()), padding = ' '.repeat(128 * 1024 - Buffer.byteLength(content) - 1);
  const f = await fixture(content + padding), { draft } = await open(t, f), source = f.source.content;
  draft.setPosition(draft.actorId, [100000, 250]);
  assert.throws(() => draft.propose(), error => error?.errorCode === 'scene_composition_limit');
  assert.equal(f.source.content, source); assert.equal(draft.state().dirty, true);
  assert.equal(draft.undo(), true); assert.equal(draft.state().dirty, false);
});

test('single-instance sessions use the shared 32-slot Rust table and disposing releases their complete history', async t => {
  const f = await fixture(), drafts = [];
  t.after(() => { for (const draft of drafts) draft.dispose(); });
  for (let i = 0; i < 32; i++) drafts.push(await createSceneCompositionLayoutDraft(f.model, f.source, f.model.actors[2].instanceId, { digest: hash }));
  await assert.rejects(createSceneCompositionLayoutDraft(f.model, f.source, f.model.actors[2].instanceId, { digest: hash }), error => error?.errorCode === 'scene_layout_draft_limit');
  drafts[0].setPosition(drafts[0].actorId, [510, 250]); assert.deepEqual(drafts[1].currentPosition(drafts[1].actorId), [460, 220]);
  drafts[0].dispose(); drafts[0].dispose();
  assert.throws(() => drafts[0].setPosition(drafts[0].actorId, [520, 250]), error => error?.errorCode === 'scene_layout_draft_invalid');
  const replacement = await createSceneCompositionLayoutDraft(f.model, f.source, f.model.actors[2].instanceId, { digest: hash });
  drafts.push(replacement); assert.deepEqual(replacement.state(), { dirty: false, canUndo: false, canRedo: false });
});
