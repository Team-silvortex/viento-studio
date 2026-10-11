import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createSceneCompositionBatchLayoutDraft, prepareSceneCompositionBatchLayoutApply } from '../../engine/scene-composition-batch-layout.mjs';
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
const positionInvalid = error => error?.errorCode === 'scene_layout_position_invalid';
const unchanged = error => error?.errorCode === 'scene_composition_override_unchanged';
const invalid = error => error?.errorCode === 'scene_composition_override_invalid';
const conflict = error => error?.errorCode === 'scene_composition_override_conflict';
function recipe() {
  const value = structuredClone(example);
  value.scene.title = '配方🦊 / Batch / 一括';
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
async function open(t, f = null) {
  f ||= await fixture();
  const draft = await createSceneCompositionBatchLayoutDraft(f.model, f.source, { digest: hash });
  t.after(() => draft.dispose()); return { ...f, draft, actorIds: f.model.actors.map(actor => actor.instanceId) };
}
const prepare = (source, proposal, digest = hash) => prepareSceneCompositionBatchLayoutApply(source, proposal, { digest });
function deferred() { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; }

test('saved and dirty recipe bindings expose detached actors with one pristine geometry history', async t => {
  for (const dirty of [false, true]) {
    const f = await fixture(recipe(), { dirty }), before = structuredClone(f), { draft } = await open(t, f);
    assert.deepEqual(draft.actors(), f.model.actors); assert.deepEqual(draft.state(), { dirty: false, canUndo: false, canRedo: false });
    assert.throws(() => draft.propose(), unchanged);
    draft.actors()[0].position[0] = 900; draft.currentPosition(f.model.actors[0].instanceId)[0] = 900;
    assert.deepEqual(draft.actors(), before.model.actors); assert.deepEqual(f, before);
  }
});

test('same-placement and cross-placement movement produces a position-only atomic local patch in source order', async t => {
  const { draft, source, model, actorIds } = await open(t, await fixture(recipe(), { dirty: true }));
  draft.move([actorIds[3], actorIds[0], actorIds[1]], [20, 10]);
  const proposal = draft.propose();
  assert.deepEqual(proposal.changes, [
    { instanceId: actorIds[0], placementId: example.placements[0].placementId, actorKey: 'leader', position: [140, 190] },
    { instanceId: actorIds[1], placementId: example.placements[0].placementId, actorKey: 'companion', position: [220, 190] },
    { instanceId: actorIds[3], placementId: example.placements[1].placementId, actorKey: 'companion', position: [220, 190] },
  ]);
  assert.equal(proposal.baseSourceRevision, source.baseSourceRevision);
  assert.deepEqual(proposal.changedPaths, ['/placements/0/overrides/0/values/position', '/placements/0/overrides/1/values/position', '/placements/1/overrides/1/values/position']);
  const after = parse(proposal.afterContent), before = parse(source.content);
  assert.deepEqual(after.fragments, before.fragments); assert.deepEqual(after.scene, before.scene);
  assert.deepEqual(after.placements[1].overrides[0], before.placements[1].overrides[0]);
  assert.deepEqual(after.placements.map(p => p.actorIds), before.placements.map(p => p.actorIds));
  assert.deepEqual(after.placements.map(p => p.groupIds), before.placements.map(p => p.groupIds));
  assert.deepEqual(expandSceneComposition(proposal.afterContent).scene.actors[2].position, model.actors[2].position);
  assert.equal(proposal.afterContent.startsWith('\uFEFF'), true); assert.equal(proposal.afterContent.endsWith('\r\n \t'), true);
  assert.deepEqual(await prepare(source, proposal), { afterContent: proposal.afterContent, changedPaths: proposal.changedPaths });
  draft.undo(); assert.equal(draft.state().dirty, false); assert.equal(draft.undo(), false);
  draft.redo(); assert.deepEqual(draft.propose(), proposal);
});

test('different placement offsets keep selected world spacing and do not change offsets', async t => {
  const { draft, source, actorIds } = await open(t);
  const previous = actorIds.map(id => draft.currentPosition(id)); draft.move(actorIds, [-12, 6]);
  const positions = actorIds.map(id => draft.currentPosition(id));
  assert.deepEqual(positions, previous.map(([x, y]) => [x - 12, y + 6]));
  const proposal = draft.propose(), before = parse(source.content), after = parse(proposal.afterContent);
  assert.deepEqual(after.placements.map(p => p.offset), before.placements.map(p => p.offset));
  assert.deepEqual(proposal.changes.map(c => c.position), [[108, 186], [188, 186], [88, 146], [188, 186]]);
});

test('six alignments use resolved sizes and each alignment is one undoable atomic batch', async t => {
  for (const alignment of ['left', 'center', 'right', 'top', 'middle', 'bottom']) {
    const { draft, actorIds } = await open(t), before = draft.actors();
    assert.equal(draft.align([actorIds[0], actorIds[3]], alignment), true);
    const [a, b] = [draft.actors()[0], draft.actors()[3]], axis = ['left', 'center', 'right'].includes(alignment) ? 0 : 1;
    const edge = ['left', 'top'].includes(alignment) ? -1 : ['right', 'bottom'].includes(alignment) ? 1 : 0;
    assert.equal(a.position[axis] + edge * a.size[axis] / 2, b.position[axis] + edge * b.size[axis] / 2);
    assert.equal(draft.undo(), true); assert.deepEqual(draft.actors(), before); assert.equal(draft.undo(), false);
    assert.equal(draft.redo(), true); assert.ok(draft.propose().changes.length);
  }
});

test('grid movement is atomic and returning one actor to baseline omits it from the proposal', async t => {
  const { draft, actorIds } = await open(t); draft.move([actorIds[0], actorIds[2]], [10, 5], 32);
  assert.deepEqual(draft.currentPosition(actorIds[0]), [128, 192]); assert.deepEqual(draft.currentPosition(actorIds[2]), [468, 232]);
  draft.setPosition(actorIds[0], [120, 180]); assert.deepEqual(draft.propose().changes.map(c => c.instanceId), [actorIds[2]]);
  draft.reset(); assert.deepEqual(draft.state(), { dirty: false, canUndo: false, canRedo: false }); assert.throws(() => draft.propose(), unchanged);
});

test('fractional unmoved axes retain each authored local value and no-op actors retain inheritance', async t => {
  const value = recipe(); value.placements[1].offset = [0.2, 0.2]; value.placements[1].overrides[0].values.position = [0.1, 0.1];
  const { draft, actorIds, source } = await open(t, await fixture(value)), initial = draft.currentPosition(actorIds[2]);
  draft.setPositions([{ objectId: actorIds[2], position: [initial[0] + 1, initial[1]] }, { objectId: actorIds[0], position: [120, 180] }]);
  const proposal = draft.propose(); assert.equal(proposal.changes.length, 1); assert.equal(proposal.changes[0].position[1], 0.1);
  assert.equal(parse(proposal.afterContent).placements[0].overrides, undefined);
  draft.undo(); assert.throws(() => draft.propose(), unchanged); assert.equal(source.content, serialize(value));
});

test('a local out-of-bounds target rejects the whole otherwise-valid movement without losing redo', async t => {
  const value = recipe(); value.fragments[0].actors.forEach(actor => { actor.position = [0, 0]; });
  value.placements[1].offset = [100000, 0]; value.placements[1].overrides[0].values.position = [0, 0];
  const { draft, actorIds } = await open(t, await fixture(value));
  draft.setPosition(actorIds[0], [10, 10]); draft.undo(); const before = draft.actors(), state = draft.state();
  assert.throws(() => draft.setPositions([{ objectId: actorIds[0], position: [20, 20] }, { objectId: actorIds[2], position: [-1, 0] }]), positionInvalid);
  assert.throws(() => draft.move([actorIds[2]], [-100001, 0]), positionInvalid);
  assert.deepEqual(draft.actors(), before); assert.deepEqual(draft.state(), state); assert.equal(draft.redo(), true);
});

test('duplicate unknown malformed and sparse changes are rejected before history mutation', async t => {
  const { draft, actorIds } = await open(t); draft.setPosition(actorIds[0], [140, 190]); draft.undo();
  const before = draft.actors(), state = draft.state(), change = { objectId: actorIds[0], position: [140, 190] };
  for (const input of [null, new Array(1), [change, change], [{ ...change, objectId: ids.first }], [{ ...change, extra: true }],
    [{ ...change, position: [NaN, 1] }], [{ ...change, position: new Array(2) }], [{ ...change, position: [100001, 0] }]]) {
    assert.throws(() => draft.setPositions(input), positionInvalid); assert.deepEqual(draft.actors(), before); assert.deepEqual(draft.state(), state);
  }
  assert.throws(() => draft.move([actorIds[0], actorIds[0]], [1, 1]), positionInvalid);
  assert.equal(draft.setPositions([]), false); assert.deepEqual(draft.state(), state); assert.equal(draft.redo(), true);
});

test('100-step history truncates batches while reset still restores every original instance', async t => {
  const { draft, actorIds } = await open(t);
  for (let x = 1; x <= 101; x++) draft.move([actorIds[0], actorIds[2]], [1, 0]);
  let count = 0; while (draft.undo()) count++; assert.equal(count, 100);
  assert.deepEqual(draft.currentPosition(actorIds[0]), [121, 180]); assert.deepEqual(draft.currentPosition(actorIds[2]), [461, 220]);
  draft.reset(); assert.deepEqual(draft.currentPosition(actorIds[0]), [120, 180]); assert.deepEqual(draft.currentPosition(actorIds[2]), [460, 220]);
  assert.throws(() => draft.propose(), unchanged);
});

test('every actor provenance is checked, including noninitial actors, before a geometry session is allocated', async () => {
  const f = await fixture();
  for (const mutate of [x => { x.model.sourceLocations.actors[3].composition.placementId = example.placements[0].placementId; },
    x => { x.model.sourceLocations.actors[3].declaration.sourceRevision = revision('stale'); },
    x => { x.model.actors[3].position[0]++; }, x => { x.model.sceneEditing = {}; },
    x => { x.source.content += ' '; }, x => { x.source.baseSourceRevision = revision('other'); }]) {
    const changed = structuredClone(f); mutate(changed);
    await assert.rejects(createSceneCompositionBatchLayoutDraft(changed.model, changed.source, { digest: hash }), e => invalid(e) || conflict(e));
  }
});

test('factory snapshots all author and model data before its one asynchronous digest', async t => {
  const f = await fixture(recipe(), { dirty: true }), before = structuredClone(f), wait = deferred(); let content, calls = 0;
  const pending = createSceneCompositionBatchLayoutDraft(f.model, f.source, { digest: text => { content = text; calls++; return wait.promise; } });
  f.model.actors[3].position[0] = 999; f.model.sourceLocations.actors[3].composition.localKey = 'forged'; f.source.content = '{}';
  wait.resolve(hash(content)); const draft = await pending; t.after(() => draft.dispose());
  assert.equal(calls, 1); assert.deepEqual(draft.actors(), before.model.actors);
  draft.move(before.model.actors.map(a => a.instanceId), [10, 10]); const proposal = draft.propose();
  proposal.changes[0].position[0] = 999; assert.notEqual(draft.propose().changes[0].position[0], 999);
  assert.deepEqual(await prepare(before.source, draft.propose()), { afterContent: draft.propose().afterContent, changedPaths: draft.propose().changedPaths });
});

test('apply rejects stale sources, forged receipts, substituted UUID mappings and reordered or unchanged targets', async t => {
  const { draft, source, actorIds } = await open(t); draft.move(actorIds, [10, 10]); const proposal = draft.propose();
  for (const current of [{ ...source, content: source.content + ' ' }, { ...source, sourcePath: 'other.json' }, { ...source, baseSourceRevision: revision('changed') }]) {
    await assert.rejects(prepare(current, proposal), conflict);
  }
  for (const alter of [p => { p.afterContent += ' '; }, p => { p.changes.reverse(); }, p => { p.changes[0].instanceId = actorIds[1]; },
    p => { p.changes[0].actorKey = 'companion'; }, p => { p.changes[0].position[0]++; }, p => { p.changedPaths.reverse(); },
    p => { p.changes.push(structuredClone(p.changes[0])); }, p => { p.changes[0].position = [120, 180]; }]) {
    const candidate = structuredClone(proposal); alter(candidate); await assert.rejects(prepare(source, candidate), invalid);
  }
});

test('apply snapshots the complete proposal and source before awaiting host hashing', async t => {
  const { draft, source, actorIds } = await open(t); draft.move(actorIds, [10, 10]);
  const candidate = draft.propose(), original = structuredClone(candidate), current = structuredClone(source), wait = deferred(); let content;
  const pending = prepare(current, candidate, text => { content = text; return wait.promise; });
  current.content = '{}'; candidate.changes[0].position[0] = 999; candidate.afterContent = 'forged';
  wait.resolve(hash(content)); assert.deepEqual(await pending, { afterContent: original.afterContent, changedPaths: original.changedPaths });
});

test('over-budget candidates keep the original source and recoverable position history intact', async t => {
  const content = serialize(recipe()), padding = ' '.repeat(128 * 1024 - Buffer.byteLength(content));
  const { draft, source, actorIds } = await open(t, await fixture(content + padding)), original = source.content;
  draft.move([actorIds[0], actorIds[1]], [1, 1]);
  assert.throws(() => draft.propose(), e => e?.errorCode === 'scene_composition_limit');
  assert.equal(source.content, original); assert.equal(draft.state().dirty, true); assert.equal(draft.undo(), true); assert.throws(() => draft.propose(), unchanged);
});

test('32 shared Rust draft slots are reclaimed by idempotent disposal and disposed batches cannot mutate', async t => {
  const f = await fixture(), drafts = []; t.after(() => { for (const draft of drafts) draft.dispose(); });
  for (let i = 0; i < 32; i++) drafts.push(await createSceneCompositionBatchLayoutDraft(f.model, f.source, { digest: hash }));
  await assert.rejects(createSceneCompositionBatchLayoutDraft(f.model, f.source, { digest: hash }), e => e?.errorCode === 'scene_layout_draft_limit');
  drafts[0].move(f.model.actors.map(a => a.instanceId), [10, 10]); assert.equal(drafts[1].state().dirty, false);
  drafts[0].dispose(); drafts[0].dispose();
  assert.throws(() => drafts[0].move([], [1, 2]), e => e?.errorCode === 'scene_layout_draft_invalid');
  drafts.push(await createSceneCompositionBatchLayoutDraft(f.model, f.source, { digest: hash }));
});
