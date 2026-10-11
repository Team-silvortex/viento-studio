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

const RESET = ['size', 'color', 'speed', 'controls', 'imageResourceId'];
const edit = (draft, values = {}, reset = []) => draft.proposeEdit({ values, reset });

test('restoring all optional declarations exposes projection defaults while keeping every placement override', async () => {
  const { draft, source, model } = await open(null, 1), proposal = edit(draft, {}, [...RESET].reverse());
  assert.deepEqual(proposal.reset, RESET); assert.deepEqual(proposal.values, {});
  assert.deepEqual(proposal.changedPaths, RESET.map(field => `/fragments/0/actors/1/${field}`));
  assert.deepEqual(proposal.targets, draft.targets);
  const after = parse(proposal.afterContent), before = parse(source.content);
  assert.deepEqual(after.fragments[0].actors[1], { key: 'companion', objectId: ids.second, groupKey: 'companions', position: [200, 180], useProjectionDefaults: true });
  assert.deepEqual(after.placements, before.placements); assert.deepEqual(after.fragments[0].actors[0], before.fragments[0].actors[0]);
  const next = await fixture(proposal.afterContent);
  for (const index of [1, 3]) {
    assert.deepEqual(next.model.actors[index].size, [120, 40]); assert.equal(next.model.actors[index].color, '#557799');
    assert.equal(next.model.actors[index].speed, 0); assert.equal(next.model.actors[index].controls, 'none');
    assert.equal(next.model.actors[index].imageResourceId, golden.ids.image); assert.equal(next.model.actors[index].instanceId, model.actors[index].instanceId);
  }
  assert.deepEqual(await prepare(source, proposal), { afterContent: proposal.afterContent, changedPaths: proposal.changedPaths });
});

test('removing a raw declaration remains a source edit even when every effective value is unchanged', async () => {
  const value = recipe(); value.fragments[0].actors[1].speed = 0;
  const { draft, source, model } = await open(await fixture(value), 1), proposal = edit(draft, {}, ['speed']);
  assert.deepEqual(proposal.reset, ['speed']); assert.equal(proposal.afterContent === source.content, false);
  const next = await fixture(proposal.afterContent); assert.equal(next.model.actors[1].speed, model.actors[1].speed);
  assert.equal(Object.hasOwn(parse(proposal.afterContent).fragments[0].actors[1], 'speed'), false);
});

test('local override masks are unchanged and shield linked instances from restored shared defaults', async () => {
  const value = recipe(); value.fragments[0].actors[0].speed = 123;
  const { draft, source } = await open(await fixture(value)), proposal = edit(draft, {}, ['speed']);
  assert.deepEqual(proposal.targets, [
    { instanceId: value.placements[0].actorIds.leader, placementId: value.placements[0].placementId, overrides: [] },
    { instanceId: value.placements[1].actorIds.leader, placementId: value.placements[1].placementId, overrides: ['position', 'color', 'speed', 'controls'] },
  ]);
  const next = await fixture(proposal.afterContent); assert.equal(next.model.actors[0].speed, 160);
  assert.equal(next.model.actors[2].speed, value.placements[1].overrides[0].values.speed);
  assert.deepEqual(parse(proposal.afterContent).placements, parse(source.content).placements);
});

test('mixed SET/RESET uses one fixed-order receipt and omits nonexistent resets and semantic no-op sets', async () => {
  const { draft, source } = await open(null, 1), proposal = edit(draft, { position: [210, 190], color: '#112233', size: [48, 48] }, ['controls', 'speed']);
  assert.deepEqual(proposal.values, { position: [210, 190] }); assert.deepEqual(proposal.reset, ['speed', 'controls']);
  assert.deepEqual(proposal.changedPaths, ['/fragments/0/actors/1/position', '/fragments/0/actors/1/speed', '/fragments/0/actors/1/controls']);
  assert.deepEqual(await prepare(source, proposal), { afterContent: proposal.afterContent, changedPaths: proposal.changedPaths });
  const raw = await open(); const second = edit(raw.draft, { color: '#aabbcc' }, ['imageResourceId', 'speed']);
  assert.deepEqual(second.reset, []); assert.deepEqual(second.values, { color: '#aabbcc' });
});

test('legacy SET proposal retains its exact shape and both old and new SET-only candidates still apply', async () => {
  const { draft, source } = await open(), old = draft.propose({ speed: 100 }), fresh = edit(draft, { speed: 100 });
  assert.equal(Object.hasOwn(old, 'reset'), false); assert.deepEqual(fresh.reset, []);
  const { reset: ignored, ...equivalent } = fresh; assert.deepEqual(equivalent, old);
  assert.deepEqual(await prepare(source, fresh), await prepare(source, old));
});

test('image reset restores projection inheritance, while explicit null stays a distinct no-image declaration', async () => {
  const { draft, source } = await open(null, 1), restored = edit(draft, {}, ['imageResourceId']);
  const restoredPreview = await fixture(restored.afterContent);
  assert.equal(restoredPreview.model.actors[1].imageResourceId, golden.ids.image);
  assert.equal(Object.hasOwn(parse(restored.afterContent).fragments[0].actors[1], 'imageResourceId'), false);
  assert.throws(() => edit(draft, { imageResourceId: null }), unchanged);
  const value = recipe(); value.fragments[0].actors[1].imageResourceId = golden.ids.image;
  const using = await open(await fixture(value), 1), suppressed = edit(using.draft, { imageResourceId: null });
  assert.deepEqual(suppressed.reset, []); assert.equal(parse(suppressed.afterContent).fragments[0].actors[1].imageResourceId, null);
  assert.deepEqual(await prepare(source, restored), { afterContent: restored.afterContent, changedPaths: restored.changedPaths });
});

test('noninheriting declarations can delete images but cannot reset the four required attributes', async () => {
  for (const useProjectionDefaults of [false, undefined]) {
    const value = recipe(), actor = value.fragments[0].actors[1];
    if (useProjectionDefaults === undefined) delete actor.useProjectionDefaults; else actor.useProjectionDefaults = false;
    actor.imageResourceId = golden.ids.image;
    const { draft, source } = await open(await fixture(value), 1), proposal = edit(draft, {}, ['imageResourceId']);
    const after = parse(proposal.afterContent); assert.equal(Object.hasOwn(after.fragments[0].actors[1], 'imageResourceId'), false);
    assert.equal(after.fragments[0].actors[1].useProjectionDefaults, useProjectionDefaults);
    const next = await fixture(proposal.afterContent); assert.equal(next.model.actors[1].imageResourceId, undefined);
    for (const field of RESET.slice(0, 4)) assert.throws(() => edit(draft, {}, [field]), invalid);
    assert.deepEqual(await prepare(source, proposal), { afterContent: proposal.afterContent, changedPaths: proposal.changedPaths });
  }
});

test('reset intent cannot overlap SET even if the proposed value was itself a semantic no-op', async () => {
  const { draft } = await open(null, 1);
  for (const [field, value] of Object.entries(draft.values)) if (field !== 'position') {
    assert.throws(() => edit(draft, { [field]: value }, [field]), invalid);
  }
  for (const input of [null, {}, { values: {} }, { values: {}, reset: [], extra: true }, { values: {}, reset: ['position'] },
    { values: {}, reset: ['key'] }, { values: {}, reset: ['useProjectionDefaults'] }, { values: {}, reset: ['speed', 'speed'] },
    { values: {}, reset: new Array(1) }, { values: {}, reset: null }]) assert.throws(() => draft.proposeEdit(input), invalid);
  assert.deepEqual(edit(draft, {}, ['speed']).reset, ['speed']);
});

test('missing declarations and original-value SETs cannot create empty or implicit promotion proposals', async () => {
  const { draft } = await open();
  for (const reset of [[], ['speed'], RESET]) assert.throws(() => edit(draft, { position: [120, 180] }, reset), unchanged);
  const companion = await open(null, 1); assert.throws(() => edit(companion.draft, companion.draft.values, []), unchanged);
});

test('mixed edits retain BOM CRLF escaped keys unchanged numeric axes and every unrelated source byte', async () => {
  const value = recipe(); value.fragments[0].actors[1].speed = 17;
  let raw = serialize(value).replace('"position": [\r\n\t\t\t\t\t\t200,', '"posit\\u0069on": [\r\n\t\t\t\t\t\t2.000e2,');
  const { draft, source } = await open(await fixture(raw), 1), proposal = edit(draft, { position: [201, 180] }, ['speed']);
  assert.ok(proposal.afterContent.includes('"posit\\u0069on"')); assert.ok(proposal.afterContent.includes('\r\n\t\t\t\t\t\t180'));
  assert.equal(proposal.afterContent.startsWith('\uFEFF'), true); assert.equal(proposal.afterContent.endsWith('\r\n \t'), true);
  assert.deepEqual(parse(proposal.afterContent).placements, parse(source.content).placements);
  assert.deepEqual(await prepare(source, proposal), { afterContent: proposal.afterContent, changedPaths: proposal.changedPaths });
});

test('exact final source budget permits a deletion to pay for growth and rejects growth without mutation', async () => {
  const prefix = serialize(recipe()), content = prefix + ' '.repeat(128 * 1024 - Buffer.byteLength(prefix));
  const { draft, source } = await open(await fixture(content), 1), original = source.content;
  const proposal = edit(draft, { position: [9999, 9999] }, ['color']); assert.ok(Buffer.byteLength(proposal.afterContent) <= 128 * 1024);
  assert.throws(() => edit(draft, { position: [9999, 9999] }), { errorCode: 'scene_composition_limit' });
  assert.equal(source.content, original); assert.deepEqual(await prepare(source, proposal), { afterContent: proposal.afterContent, changedPaths: proposal.changedPaths });
});

test('restoring the last explicit optional declaration keeps mandatory identity placement and inheritance fields', async () => {
  const value = recipe(); for (const field of RESET) delete value.fragments[0].actors[1][field]; value.fragments[0].actors[1].speed = 17;
  const { draft, source } = await open(await fixture(value), 1), proposal = edit(draft, {}, ['speed']);
  const after = parse(proposal.afterContent); assert.equal(after.fragments[0].actors.length, 2);
  assert.deepEqual(after.fragments[0].actors[1], { key: 'companion', objectId: ids.second, groupKey: 'companions', position: [200, 180], useProjectionDefaults: true });
  assert.deepEqual(after.placements, parse(source.content).placements);
});

test('raw defaults targets and returned reset proposals remain independently detached', async () => {
  const { draft, source } = await open(null, 1); draft.values.speed = 999; draft.targets.reverse(); draft.useProjectionDefaults = false;
  const reset = ['speed', 'controls'], values = { position: [210, 190] }, candidate = edit(draft, values, reset);
  reset.push('size'); values.position[0] = 999; candidate.reset.reverse(); candidate.values.position[0] = 999; candidate.targets.pop();
  const pristine = edit(draft, { position: [210, 190] }, ['speed', 'controls']);
  assert.deepEqual(pristine.reset, ['speed', 'controls']); assert.deepEqual(pristine.values.position, [210, 190]); assert.equal(pristine.targets.length, 2);
  assert.deepEqual(await prepare(source, pristine), { afterContent: pristine.afterContent, changedPaths: pristine.changedPaths });
});

test('apply rejects forged reset order nonexistent deletions altered coverage extra shape and candidate bytes', async () => {
  const { draft, source } = await open(null, 1), proposal = edit(draft, { position: [210, 190] }, ['speed', 'controls']);
  for (const alter of [p => p.reset.reverse(), p => p.reset.push('speed'), p => p.reset.push('position'), p => { p.values.speed = 17; },
    p => { p.reset = ['size', 'controls']; }, p => { p.afterContent += ' '; }, p => { p.changedPaths.reverse(); },
    p => { p.targets.reverse(); }, p => { p.targets[1].overrides.push('size'); }, p => { p.targets.pop(); },
    p => { p.resetFields = []; }, p => { p.actorKey = 'leader'; }, p => { p.fragmentId = 'missing'; }]) {
    const candidate = structuredClone(proposal); alter(candidate); await assert.rejects(prepare(source, candidate), invalid);
  }
});

test('apply snapshots nested reset values targets source and byte receipt before awaiting its digest', async () => {
  const { draft, source } = await open(null, 1), proposal = edit(draft, { position: [210, 190] }, ['speed', 'controls']), before = structuredClone(proposal);
  const wait = deferred(); let text;
  const pending = prepare(source, proposal, content => { text = content; return wait.promise; });
  source.content = '{}'; proposal.reset.reverse(); proposal.values.position[0] = 999; proposal.targets.reverse(); proposal.afterContent = '{}';
  wait.resolve(hash(text)); assert.deepEqual(await pending, { afterContent: before.afterContent, changedPaths: before.changedPaths });
});

test('current source revisions saved baselines and paths still reject stale restore receipts', async () => {
  const { draft, source } = await open(null, 1), proposal = edit(draft, {}, ['speed']);
  for (const current of [{ ...source, content: source.content + ' ' }, { ...source, sourcePath: 'other.json' }, { ...source, baseSourceRevision: revision('changed') }]) {
    await assert.rejects(prepare(current, proposal), conflict);
  }
});
