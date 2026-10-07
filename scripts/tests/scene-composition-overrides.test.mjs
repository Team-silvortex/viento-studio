import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createSceneCompositionOverrideDraft, prepareSceneCompositionOverrideApply } from '../../engine/scene-composition-overrides.mjs';
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
const invalid = error => error?.errorCode === 'scene_composition_override_invalid';
const conflict = error => error?.errorCode === 'scene_composition_override_conflict';
const unchanged = error => error?.errorCode === 'scene_composition_override_unchanged';
const create = (fixture, actorIndex = 2, digest = hash) => createSceneCompositionOverrideDraft(fixture.model, fixture.source, fixture.model.actors[actorIndex].instanceId, { digest });
const prepare = (source, proposal, digest = hash) => prepareSceneCompositionOverrideApply(source, proposal, { digest });
const runtimeValues = actor => Object.fromEntries(['instanceId', 'objectId', 'position', 'size', 'color', 'speed', 'controls', 'imageResourceId'].map(key => [key, actor[key]]));
function recipe() {
  const value = structuredClone(example);
  value.scene.title = '配方🦊 / Recipe / レシピ';
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
function deferred() {
  let resolve;
  const promise = new Promise(yes => { resolve = yes; });
  return { promise, resolve };
}

test('saved and current-draft recipe sessions expose local values, world values, identity and image capability', async () => {
  for (const dirty of [false, true]) {
    const f = await fixture(recipe(), { dirty }), before = structuredClone(f), draft = await create(f);
    assert.equal(draft.actorId, f.model.actors[2].instanceId);
    assert.equal(draft.objectId, ids.first);
    assert.equal(draft.placementId, recipe().placements[1].placementId);
    assert.equal(draft.actorKey, 'leader'); assert.equal(draft.fragmentId, 'party');
    assert.equal(draft.canClearImage, true);
    assert.deepEqual(draft.offset, [360, 80]);
    assert.deepEqual(draft.values.position, [100, 140]);
    assert.deepEqual(draft.effectiveValues.position, [460, 220]);
    assert.deepEqual(draft.values.size, [80, 60]);
    assert.equal(draft.values.imageResourceId, ids.image);
    assert.deepEqual(draft.overrides, recipe().placements[1].overrides[0].values);
    assert.deepEqual(f, before);
  }
});

test('editing an existing override preserves all non-target source bytes and repeated checks use one baseline', async () => {
  const raw = serialize(recipe()).replace('"speed": 0,', '"spe\\u0065d": 0e0,');
  const f = await fixture(raw, { dirty: true }), draft = await create(f);
  const proposal = draft.propose({ ...draft.values, speed: 25 });
  assert.deepEqual(proposal.values, { speed: 25 });
  assert.deepEqual(proposal.changedPaths, ['/placements/1/overrides/0/values/speed']);
  assert.equal(proposal.afterContent, raw.replace('"spe\\u0065d": 0e0,', '"spe\\u0065d": 25,'));
  assert.deepEqual(Object.keys(proposal), ['sceneId', 'sourcePath', 'baseSourceRevision', 'sourceRevision', 'instanceId', 'placementId', 'actorKey', 'values', 'afterContent', 'changedPaths']);
  assert.deepEqual(await prepare(f.source, proposal), { afterContent: proposal.afterContent, changedPaths: proposal.changedPaths });
  const second = draft.propose({ speed: 26 });
  assert.equal(second.afterContent, raw.replace('"spe\\u0065d": 0e0,', '"spe\\u0065d": 26,'));
  assert.equal(f.source.content, raw);
});

test('adding the first override writes only changed fields and retains fragment, groups, identities and sibling placements', async () => {
  const f = await fixture(), draft = await create(f, 0), before = parse(f.source.content);
  const proposal = draft.propose({ ...draft.values, speed: 47, position: [140, 190] });
  assert.deepEqual(proposal.values, { position: [140, 190], speed: 47 });
  assert.deepEqual(proposal.changedPaths, ['/placements/0/overrides/0/values/position', '/placements/0/overrides/0/values/speed']);
  const after = parse(proposal.afterContent);
  assert.deepEqual(after.placements[0].overrides, [{ actorKey: 'leader', values: { position: [140, 190], speed: 47 } }]);
  delete after.placements[0].overrides;
  assert.deepEqual(after, before);
  assert.equal(proposal.afterContent.startsWith('\uFEFF'), true);
  assert.equal(proposal.afterContent.endsWith('\r\n \t'), true);
  assert.equal(proposal.afterContent.slice(0, proposal.afterContent.indexOf('"placements"')), f.source.content.slice(0, f.source.content.indexOf('"placements"')));
  assert.deepEqual(await prepare(f.source, proposal), { afterContent: proposal.afterContent, changedPaths: proposal.changedPaths });
  const next = await fixture(proposal.afterContent);
  assert.deepEqual(next.model.actors[0].position, [140, 190]);
  assert.deepEqual(runtimeValues(next.model.actors[2]), runtimeValues(f.model.actors[2]), 'a different instance of the same fragment is unaffected');
});

test('adding another actor override preserves the existing override and applies offset only during preview', async () => {
  const f = await fixture(), draft = await create(f, 3), proposal = draft.propose({ position: [230, 160], color: '#33445566' });
  const after = parse(proposal.afterContent);
  assert.deepEqual(after.placements[1].overrides[0], recipe().placements[1].overrides[0]);
  assert.deepEqual(after.placements[1].overrides[1], { actorKey: 'companion', values: { position: [230, 160], color: '#33445566' } });
  const next = await fixture(proposal.afterContent);
  assert.deepEqual(next.model.actors[3].position, [590, 240]);
  assert.deepEqual(runtimeValues(next.model.actors[1]), runtimeValues(f.model.actors[1]));
});

test('all six changed fields retain canonical receipt order and validate composed position bounds', async () => {
  const f = await fixture(), draft = await create(f), input = { imageResourceId: null, controls: 'arrows', speed: 2000,
    color: '#12345678', size: [1, 2048], position: [-100, 100] };
  const proposal = draft.propose(input), fields = ['position', 'size', 'color', 'speed', 'controls', 'imageResourceId'];
  assert.deepEqual(Object.keys(proposal.values), fields);
  assert.deepEqual(proposal.changedPaths, fields.map(field => `/placements/1/overrides/0/values/${field}`));
  assert.deepEqual(parse(proposal.afterContent).placements[1].overrides[0].values, input);
  assert.deepEqual(await prepare(f.source, proposal), { afterContent: proposal.afterContent, changedPaths: proposal.changedPaths });
  const next = await fixture(proposal.afterContent);
  assert.deepEqual(next.model.actors[2].position, [260, 180]);
  assert.deepEqual(next.model.actors[2].size, [1, 2048]);
  assert.equal(next.model.actors[2].speed, 2000);
  assert.equal(next.model.actors[2].controls, 'arrows');
  assert.equal(next.model.actors[2].color, '#12345678');
  assert.throws(() => draft.propose({ position: [100000, 0] }), error => error.errorCode === 'scene_composition_invalid');
});

test('unchanged and detached form values do not promote inherited defaults into authored overrides', async () => {
  const f = await fixture(), draft = await create(f, 0);
  assert.throws(() => draft.propose(draft.values), unchanged);
  assert.throws(() => draft.propose({}), unchanged);
  assert.throws(() => draft.propose({ speed: 160 }), unchanged);
  draft.values.position[0] = -900; draft.values.speed = 1;
  draft.effectiveValues.size[0] = 999; draft.overrides.speed = 1; draft.offset[0] = 999;
  assert.throws(() => draft.propose({ speed: 160, position: [120, 180] }), unchanged);
  const values = { position: [130, 190], speed: 170 }, proposal = draft.propose(values);
  values.position[0] = 999;
  assert.deepEqual(proposal.values, { position: [130, 190], speed: 170 });
  assert.deepEqual(parse(proposal.afterContent).placements[0].overrides[0].values, proposal.values);
  proposal.values.speed = 180;
  await assert.rejects(prepare(f.source, proposal), invalid);
});

test('image removal is explicit null only for inheriting actors; opaque image IDs await host dependency validation', async () => {
  const f = await fixture(), draft = await create(f, 0), proposal = draft.propose({ imageResourceId: null });
  assert.deepEqual(proposal.values, { imageResourceId: null });
  const next = await fixture(proposal.afterContent);
  assert.equal(next.model.actors[0].imageResourceId, undefined);
  assert.equal(next.model.actors[2].imageResourceId, ids.image);
  const unknown = '99999999-9999-4999-8999-999999999999';
  assert.deepEqual(draft.propose({ imageResourceId: unknown }).values, { imageResourceId: unknown });
  const explicit = recipe();
  Object.assign(explicit.fragments[0].actors[0], { useProjectionDefaults: false, size: [64, 64], color: '#ffffff', speed: 100, controls: 'arrows', imageResourceId: ids.image });
  const own = await create(await fixture(explicit), 0);
  assert.equal(own.canClearImage, false);
  assert.throws(() => own.propose({ imageResourceId: null }), error => error.errorCode === 'scene_composition_invalid');
});

test('override values reject unknown fields and invalid numeric, color, control or resource input', async () => {
  const draft = await create(await fixture());
  const invalidValues = [{ instanceId: ids.first }, { groupId: ids.first }, { objectId: ids.first }, { position: [1] },
    { position: [NaN, 2] }, { position: [100001, 2] }, { position: [1, 2, 3] }, { size: [0, 10] },
    { size: [1, 2049] }, { speed: -1 }, { speed: 2001 }, { speed: Infinity }, { controls: 'wasd' },
    { color: '#abc' }, { color: 'red' }, { imageResourceId: '' }, { imageResourceId: undefined }, { imageResourceId: 1 }, null, []];
  for (const values of invalidValues) assert.throws(() => draft.propose(values), invalid);
});

test('preview source, saved baseline, placement ownership and expanded scene structure must all match', async () => {
  const f = await fixture();
  const checks = [
    x => { x.source.content += ' '; }, x => { x.source.baseSourceRevision = revision('other'); },
    x => { x.source.sourcePath = 'other.json'; }, x => { x.model.scene.sourceRevision = revision('other'); },
    x => { x.model.composition.sourceRevision = revision('other'); }, x => { x.model.sceneEditing = {}; },
    x => { x.model.composition.placementCount++; }, x => { x.model.sourceLocations.actors[2].composition.placementId = x.model.sourceLocations.actors[0].composition.placementId; },
    x => { x.model.sourceLocations.actors[2].composition.localKey = 'companion'; },
    x => { x.model.sourceLocations.actors[2].declaration.sourcePath = 'other.json'; },
    x => { x.model.actors[2].position[0]++; }, x => { x.model.actors[2].speed++; },
    x => { x.model.actors[2].objectId = ids.core; }, x => { x.model.sceneStructure.memberships.pop(); },
    x => { delete x.model.composition; }, x => { x.model.ok = false; },
    x => { x.model.draft = { baseSourceRevision: revision('other'), sourceRevision: x.model.scene.sourceRevision }; },
  ];
  for (const change of checks) {
    const altered = structuredClone(f); change(altered);
    await assert.rejects(create(altered), error => invalid(error) || conflict(error));
  }
  const dirty = await fixture(recipe(), { dirty: true }); delete dirty.model.draft;
  await assert.rejects(create(dirty), conflict);
  await assert.rejects(createSceneCompositionOverrideDraft(f.model, f.source, ids.first, { digest: hash }), invalid);
});

test('apply recomputes exact content and paths and rejects forged receipts and target substitutions', async () => {
  const f = await fixture(), proposal = (await create(f)).propose({ speed: 42 });
  const checks = [
    x => { x.afterContent += ' '; }, x => { x.afterContent = x.afterContent.replace('#f1c46e', '#ffffff'); },
    x => { x.changedPaths = ['/placements/0/overrides/0/values/speed']; }, x => { x.values.speed = 43; },
    x => { x.instanceId = f.model.actors[0].instanceId; }, x => { x.placementId = recipe().placements[0].placementId; },
    x => { x.actorKey = 'companion'; }, x => { x.values.objectId = ids.core; }, x => { x.extra = true; },
  ];
  for (const change of checks) {
    const forged = structuredClone(proposal); change(forged);
    await assert.rejects(prepare(f.source, forged), invalid);
  }
  await assert.rejects(prepare(f.source, { ...proposal, values: {} }), unchanged);
  for (const source of [{ ...f.source, content: f.source.content + ' ' }, { ...f.source, content: '{bad syntax' },
    { ...f.source, baseSourceRevision: revision('changed') }, { ...f.source, sourcePath: 'other.json' }]) {
    await assert.rejects(prepare(source, proposal), conflict);
  }
  await assert.rejects(prepare(f.source, { ...proposal, sourceRevision: revision('forged') }), conflict);
});

test('create and apply detach every source and proposal value before waiting for digest', async () => {
  const f = await fixture(), original = structuredClone(f), wait = deferred();
  let passed;
  const pending = create(f, 2, content => { passed = content; return wait.promise; });
  f.source.content = 'changed editor'; f.source.baseSourceRevision = revision('changed saved');
  f.model.actors[2].position[0] = 999; f.model.sourceLocations.actors[2].composition.placementId = 'changed';
  wait.resolve(hash(passed));
  const draft = await pending;
  assert.deepEqual(draft.values.position, [100, 140]);
  const proposal = draft.propose({ position: [150, 180], speed: 8 });
  assert.equal(proposal.sourceRevision, revision(original.source.content));
  const next = deferred(), expected = structuredClone(proposal), current = structuredClone(original.source);
  const applying = prepare(current, proposal, content => { passed = content; return next.promise; });
  proposal.values.position[0] = 888; proposal.afterContent = 'forged'; proposal.changedPaths.push('/forged');
  current.content = 'another edit'; next.resolve(hash(passed));
  assert.deepEqual(await applying, { afterContent: expected.afterContent, changedPaths: expected.changedPaths });
});

test('invalid digest receipts and malformed, duplicate or oversized source fail before an applicable proposal exists', async () => {
  const f = await fixture();
  for (const digest of [undefined, () => 'bad', () => hash(f.source.content).toUpperCase(), () => revision(f.source.content)]) {
    await assert.rejects(createSceneCompositionOverrideDraft(f.model, f.source, f.model.actors[2].instanceId, { digest }), invalid);
  }
  for (const content of ['{broken', f.source.content.replace('"schemaVersion": 1,', '"schemaVersion": 1, "schemaVersion": 1,'), f.source.content + '\ud800']) {
    await assert.rejects(create({ ...f, source: { ...f.source, content } }), error => typeof error.errorCode === 'string');
  }
  await assert.rejects(create({ ...f, source: { ...f.source, content: ' '.repeat(128 * 1024 + 1) } }), error => error.errorCode === 'scene_composition_override_content_limit');
});
