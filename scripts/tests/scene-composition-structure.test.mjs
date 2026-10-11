import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createSceneCompositionStructureDraft, prepareSceneCompositionStructureApply } from '../../engine/scene-composition-structure.mjs';
import { expandSceneComposition } from '../../engine/scene-composition.mjs';
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
const parse = content => JSON.parse(content.replace(/^\uFEFF/, ''));
const serialize = value => '\uFEFF' + JSON.stringify(value, null, '\t').replaceAll('\n', '\r\n') + '\r\n \t';
const invalid = error => error?.errorCode === 'scene_composition_structure_invalid';
const conflict = error => error?.errorCode === 'scene_composition_structure_conflict';
function recipe() {
  const value = structuredClone(example);
  value.scene.title = 'Shared structure / 共有 / 🦊';
  value.fragments[0].actors[0] = { key: 'leader', objectId: ids.first, groupKey: 'party', position: [120.125, 180.25], useProjectionDefaults: true };
  value.fragments[0].actors[1] = { key: 'companion', objectId: ids.second, groupKey: 'companions', position: [200.5, 180.75],
    useProjectionDefaults: true, size: [48, 48], speed: 17, color: '#112233', controls: 'arrows', imageResourceId: null };
  value.fragments.push({ fragmentId: 'unused', actors: [{ key: 'dormant', objectId: ids.first, position: [0, 0], useProjectionDefaults: true }], groups: [] });
  value.placements[0].overrides = [{ actorKey: 'leader', values: { speed: 2 } }, { actorKey: 'companion', values: { color: '#123456' } }];
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
async function open(f = null) { f ||= await fixture(); return { ...f, draft: await createSceneCompositionStructureDraft(f.model, f.source, { digest: hash }) }; }
const prepare = (source, proposal, digest = hash) => prepareSceneCompositionStructureApply(source, proposal, { digest });
const actor = () => ({ key: 'newActor', objectId: ids.first, groupKey: 'companions', position: [10.125, 20.25], useProjectionDefaults: true });
const add = (value = recipe()) => ({ action: 'add', fragmentId: 'party', actor: actor(), instances: value.placements.filter(p => p.fragmentId === 'party').map((p, index) => ({ placementId: p.placementId, instanceId: id(900 + index) })) });
const remove = actorKey => ({ action: 'remove', fragmentId: 'party', actorKey });
function deferred() { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; }

test('saved and dirty sessions enumerate complete raw declarations including unused fragments and deeply freeze public metadata', async () => {
  for (const dirty of [false, true]) {
    const { draft, source } = await open(await fixture(recipe(), { dirty })), value = parse(source.content);
    assert.deepEqual(Object.keys(draft).sort(), ['fragments', 'propose']);
    assert.deepEqual(draft.fragments, value.fragments.map(f => ({ fragmentId: f.fragmentId, actors: f.actors, groups: f.groups,
      placements: value.placements.filter(p => p.fragmentId === f.fragmentId).map(p => ({ placementId: p.placementId, offset: p.offset || null,
        actorIds: p.actorIds, groupIds: p.groupIds, overrides: p.overrides || null })) })));
    assert.equal(draft.fragments[1].placements.length, 0); assert.equal(draft.fragments[0].placements[0].offset, null);
    assert.throws(() => { draft.fragments[0].actors[0].position[0] = 999; }, TypeError);
    assert.throws(() => draft.fragments[0].placements[0].overrides.push({}), TypeError);
    assert.throws(() => { draft.fragments = []; }, TypeError);
    assert.equal(draft.propose(add()).edit.actor.position[0], 10.125);
  }
});

test('ADD expands the shared actor once in every placement using stable explicit IDs and a reusable definition', async () => {
  const { draft, source } = await open(), edit = add(), proposal = draft.propose(edit), before = parse(source.content), expected = structuredClone(before);
  expected.fragments[0].actors.push(edit.actor); expected.placements.forEach((p, i) => { p.actorIds.newActor = edit.instances[i].instanceId; });
  assert.deepEqual(parse(proposal.afterContent), expected);
  assert.deepEqual(proposal.targets, edit.instances.map(i => ({ ...i, actorKey: 'newActor', overrides: [] })));
  assert.deepEqual(proposal.changedPaths, ['/fragments/0/actors/2', '/placements/0/actorIds/newActor', '/placements/1/actorIds/newActor']);
  assert.deepEqual(await prepare(source, proposal), { afterContent: proposal.afterContent, changedPaths: proposal.changedPaths });
  const expanded = expandSceneComposition(proposal.afterContent).scene;
  assert.equal(expanded.actors.length, 6); assert.deepEqual(expanded.actors[2].position, [10.125, 20.25]);
  assert.deepEqual(expanded.actors[5].position, [370.125, 100.25]); assert.equal(expanded.actors[2].objectId, before.fragments[0].actors[0].objectId);
  const rebuilt = await fixture(proposal.afterContent); assert.equal(rebuilt.model.actors[5].instanceId, edit.instances[1].instanceId);
});

test('REMOVE clears matching actor IDs and only its override records while retaining groups and empty arrays', async () => {
  const { draft, source, model } = await open(), proposal = draft.propose(remove('leader')), before = parse(source.content), expected = structuredClone(before);
  expected.fragments[0].actors.shift(); for (const p of expected.placements) { delete p.actorIds.leader; p.overrides = p.overrides.filter(o => o.actorKey !== 'leader'); }
  assert.deepEqual(parse(proposal.afterContent), expected);
  assert.deepEqual(proposal.targets, [{ placementId: before.placements[0].placementId, instanceId: before.placements[0].actorIds.leader, actorKey: 'leader', overrides: ['speed'] },
    { placementId: before.placements[1].placementId, instanceId: before.placements[1].actorIds.leader, actorKey: 'leader', overrides: ['position', 'color', 'speed', 'controls'] }]);
  assert.deepEqual(proposal.changedPaths, ['/fragments/0/actors/0', '/placements/0/actorIds/leader', '/placements/0/overrides/0', '/placements/1/actorIds/leader', '/placements/1/overrides/0']);
  assert.deepEqual(parse(proposal.afterContent).placements[1].overrides, []);
  assert.deepEqual(expandSceneComposition(proposal.afterContent).scene.groups, expandSceneComposition(source.content).scene.groups);
  assert.equal(expandSceneComposition(proposal.afterContent).scene.actors.some(a => a.instanceId === model.actors[0].instanceId), false);
  await prepare(source, proposal); await open(await fixture(proposal.afterContent));
});

test('remove masks always use field order and remove any source override item index without disturbing neighbors', async () => {
  const value = recipe(); value.placements[0].overrides[1].values = { imageResourceId: null, controls: 'none', speed: 4, color: '#654321', size: [4, 5], position: [1, 2] };
  const { draft, source } = await open(await fixture(value)), p = draft.propose(remove('companion'));
  assert.deepEqual(p.targets[0].overrides, ['position', 'size', 'color', 'speed', 'controls', 'imageResourceId']);
  assert.deepEqual(parse(p.afterContent).placements[0].overrides, [value.placements[0].overrides[0]]);
  assert.deepEqual(p.changedPaths, ['/fragments/0/actors/1', '/placements/0/actorIds/companion', '/placements/0/overrides/1', '/placements/1/actorIds/companion']);
  await prepare(source, p);
});

test('unused fragments can add and remove declarations without inventing placements or IDs but cannot lose the last actor', async () => {
  const { draft, source } = await open(), edit = { action: 'add', fragmentId: 'unused', actor: { key: 'second', objectId: ids.first, position: [0, 0], useProjectionDefaults: true }, instances: [] };
  assert.throws(() => draft.propose({ action: 'remove', fragmentId: 'unused', actorKey: 'dormant' }), invalid);
  const p = draft.propose(edit); assert.deepEqual(p.targets, []); assert.deepEqual(p.changedPaths, ['/fragments/1/actors/1']); await prepare(source, p);
  const next = await open(await fixture(p.afterContent)), removed = next.draft.propose({ action: 'remove', fragmentId: 'unused', actorKey: 'dormant' });
  assert.deepEqual(removed.targets, []); assert.deepEqual(removed.changedPaths, ['/fragments/1/actors/0']); await prepare(next.source, removed);
  assert.deepEqual(expandSceneComposition(source.content).scene, expandSceneComposition(removed.afterContent).scene);
});

test('ADD mapping requires exactly all related placements in source order with unique IDs independent of referenced definition IDs', async () => {
  const { draft, model } = await open(), value = recipe(), good = add();
  for (const mutate of [e => e.instances.pop(), e => e.instances.push({ placementId: id(30), instanceId: id(99) }), e => e.instances.reverse(),
    e => { e.instances[1].instanceId = e.instances[0].instanceId; }, e => { e.instances[0].extra = true; }, e => { e.instances[0].placementId = id(99); },
    ...[value.placements[0].placementId, value.placements[0].actorIds.companion, value.placements[1].groupIds.party, model.scene.objectId, 'BAD'].map(collision => e => { e.instances[0].instanceId = collision; })]) {
    const edit = structuredClone(good); mutate(edit); assert.throws(() => draft.propose(edit), invalid);
  }
  // Definitions are reusable references, unlike placement/actor/group/scene identities.
  const sameDefinition = structuredClone(good); sameDefinition.actor.objectId = value.fragments[0].actors[0].objectId;
  assert.equal(draft.propose(sameDefinition).edit.actor.objectId, sameDefinition.actor.objectId);
});

test('complete native actor validation and exact structural intents reject invalid flags groups fields and last-actor removal', async () => {
  const { draft } = await open(), good = add();
  for (const mutate of [e => { e.action = 'set'; }, e => { e.fragmentId = 'unknown'; }, e => { e.extra = true; }, e => { e.actor.key = 'leader'; },
    e => { e.actor.key = '__proto__'; }, e => { e.actor.extra = true; }, e => { e.actor.objectId = 'bad'; }, e => { delete e.actor.position; },
    e => { e.actor.position = [100001, 0]; }, e => { e.actor.size = [0, 10]; }, e => { e.actor.groupKey = 'foreign'; }, e => { e.actor.controls = 'invalid'; },
    e => { e.actor.useProjectionDefaults = false; }, e => { e.actor.useProjectionDefaults = 'yes'; }, e => { e.actor.imageResourceId = 'bad'; },
    e => { e.actor.speed = -1; }, e => { e.actor.color = '#GGGGGG'; }]) {
    const edit = structuredClone(good); mutate(edit); assert.throws(() => draft.propose(edit), invalid);
  }
  for (const edit of [{ action: 'remove', fragmentId: 'party', actorKey: 'missing' }, { ...remove('leader'), actor: {} }, { ...remove('leader'), instances: [] }]) assert.throws(() => draft.propose(edit), invalid);
  assert.ok(draft.propose(good).changedPaths.length);
});

test('factory snapshots model source and all provenance before asynchronous digest and never exposes private edit authority', async () => {
  const f = await fixture(), model = structuredClone(f.model), source = structuredClone(f.source), wait = deferred();
  const pending = createSceneCompositionStructureDraft(model, source, { digest: () => wait.promise });
  model.actors[0].position[0]++; model.sourceLocations.groups.length = 0; model.composition.sourceRevision = revision('other'); source.content = '{}'; source.sourcePath = 'other.json';
  wait.resolve(hash(f.source.content)); const draft = await pending, first = draft.propose(add());
  first.edit.actor.position[0] = 9; first.edit.instances[0].instanceId = id(1); first.targets.length = 0; first.changedPaths.length = 0;
  const second = draft.propose(add()); assert.equal(second.edit.actor.position[0], 10.125); assert.equal(second.targets.length, 2); await prepare(f.source, second);
});

test('prepare snapshots the complete edit targets and candidate before asynchronous hashing', async () => {
  const f = await open(), proposal = f.draft.propose(add()), expected = structuredClone(proposal), source = structuredClone(f.source), wait = deferred();
  const pending = prepare(source, proposal, () => wait.promise);
  source.content = '{}'; source.sourcePath = 'other.json'; proposal.edit.actor.position[0] = 9; proposal.edit.instances.reverse(); proposal.targets.reverse(); proposal.changedPaths.length = 0; proposal.afterContent = '{}';
  wait.resolve(hash(f.source.content)); assert.deepEqual(await pending, { afterContent: expected.afterContent, changedPaths: expected.changedPaths });
});

test('all actor and group provenance and preview geometry bind the complete recipe including unrelated placements', async () => {
  const original = await fixture();
  for (const corrupt of [f => { f.model.sourceLocations.groups.pop(); }, f => { f.model.sourceLocations.groups.reverse(); },
    f => { f.model.sourceLocations.groups[3].composition.localKey = 'party'; }, f => { f.model.sourceLocations.groups[3].declaration.sourceRevision = revision('stale'); },
    f => { f.model.sourceLocations.groups[3].groupId = f.model.sourceLocations.groups[2].groupId; }, f => { f.model.sourceLocations.groups[3].composition.extra = true; },
    f => { f.model.sourceLocations.actors[3].objectId = ids.first; }, f => { f.model.sourceLocations.actors[3].composition.placementId = example.placements[0].placementId; },
    f => { f.model.sourceLocations.actors.reverse(); }, f => { f.model.sceneStructure.groups[3].name = 'wrong'; }, f => { f.model.actors[3].position[0]++; },
    f => { f.model.composition.placementCount = 1; }]) {
    const f = structuredClone(original); corrupt(f); await assert.rejects(createSceneCompositionStructureDraft(f.model, f.source, { digest: hash }), invalid);
  }
});

test('saved bases source paths content hashes and draft identities reject stale sessions', async () => {
  const original = await fixture(recipe(), { dirty: true });
  for (const corrupt of [f => { f.source.baseSourceRevision = revision('different'); }, f => { f.source.sourcePath = 'other.json'; },
    f => { f.model.scene.sourceRevision = revision('old'); }, f => { f.model.composition.sourceRevision = revision('old'); }]) {
    const f = structuredClone(original); corrupt(f); await assert.rejects(createSceneCompositionStructureDraft(f.model, f.source, { digest: hash }), conflict);
  }
  await assert.rejects(createSceneCompositionStructureDraft(original.model, original.source, { digest: () => 'bad' }), invalid);
});

test('apply rejects forged ADD action declaration mapping target masks candidates and receipt paths', async () => {
  const f = await open(), proposal = f.draft.propose(add());
  for (const corrupt of [p => { p.edit.action = 'remove'; }, p => { p.edit.actor.position[0]++; }, p => { p.edit.instances.reverse(); }, p => { p.edit.extra = true; },
    p => { p.edit.instances[0].instanceId = f.model.scene.objectId; }, p => { p.targets.reverse(); }, p => { p.targets.pop(); }, p => { p.targets[0].overrides.push('speed'); },
    p => { p.targets[0].actorKey = 'leader'; }, p => { p.targets[0].instanceId = p.targets[1].instanceId; }, p => { p.targets[0].extra = true; },
    p => { p.changedPaths = []; }, p => { p.changedPaths.push(p.changedPaths[0]); }, p => { p.changedPaths.reverse(); }, p => { p.afterContent += ' '; },
    p => { p.extra = true; }, p => { p.sceneId = 'bad'; }]) {
    const changed = structuredClone(proposal); corrupt(changed); await assert.rejects(prepare(f.source, changed), invalid);
  }
  for (const corrupt of [s => { s.content += ' '; }, s => { s.sourcePath = 'other.json'; }, s => { s.baseSourceRevision = revision('newbase'); }]) {
    const source = structuredClone(f.source); corrupt(source); await assert.rejects(prepare(source, proposal), conflict);
  }
});

test('apply recomputes REMOVE masks and UUID provenance without requiring the removed selected actor after the edit', async () => {
  const f = await open(), proposal = f.draft.propose(remove('leader'));
  for (const corrupt of [p => { p.targets[1].overrides.reverse(); }, p => { p.targets[0].overrides = []; }, p => { p.targets[0].placementId = p.targets[1].placementId; },
    p => { p.edit.actorKey = 'companion'; }, p => { p.afterContent = f.source.content; }, p => { p.edit.reset = []; }]) {
    const changed = structuredClone(proposal); corrupt(changed); await assert.rejects(prepare(f.source, changed), invalid);
  }
  assert.ok((await prepare(f.source, proposal)).afterContent.includes('companion'));
});

test('source snapshots and structural inputs reject accessors sparse arrays cycles non-JSON values without invoking user code', async () => {
  const f = await fixture(); let reads = 0;
  const badModel = structuredClone(f.model); Object.defineProperty(badModel.scene, 'objectId', { enumerable: true, get() { reads++; return ids.scene; } });
  await assert.rejects(createSceneCompositionStructureDraft(badModel, f.source, { digest: hash }), invalid);
  const badSource = { ...f.source }; Object.defineProperty(badSource, 'content', { enumerable: true, get() { reads++; return f.source.content; } });
  await assert.rejects(createSceneCompositionStructureDraft(f.model, badSource, { digest: hash }), invalid);
  const { draft } = await open(f);
  for (const value of [undefined, NaN, Infinity, new Array(2), new Date(), () => 1]) { const edit = add(); edit.actor.position = value; assert.throws(() => draft.propose(edit), invalid); }
  const getter = add(); Object.defineProperty(getter.actor, 'position', { enumerable: true, get() { reads++; return [1, 2]; } }); assert.throws(() => draft.propose(getter), invalid);
  const cyc = add(); cyc.actor.position = cyc; assert.throws(() => draft.propose(cyc), invalid);
  const serial = add(); serial.actor.toJSON = () => { reads++; return actor(); }; assert.throws(() => draft.propose(serial), invalid);
  const proposal = draft.propose(add()); Object.defineProperty(proposal.targets[0], 'actorKey', { enumerable: true, get() { reads++; return 'newActor'; } });
  await assert.rejects(prepare(f.source, proposal), invalid); assert.equal(reads, 0);
});

test('BOM CRLF escaped decoded keys exponent spelling and unrelated declarations survive exact token insertion and deletion', async () => {
  const raw = serialize(recipe()).replaceAll('"leader"', '"lead\\u0065r"').replace('120.125', '1.20125e2').replace('180.25', '1.80250e2');
  const f = await open(await fixture(raw));
  for (const p of [f.draft.propose(add()), f.draft.propose(remove('companion'))]) {
    assert.ok(p.afterContent.startsWith('\uFEFF')); assert.ok(p.afterContent.endsWith('\r\n \t'));
    assert.ok(p.afterContent.includes('1.20125e2')); assert.ok(p.afterContent.includes('1.80250e2')); assert.ok(p.afterContent.includes('"lead\\u0065r"'));
    assert.ok(p.afterContent.includes(raw.slice(raw.indexOf('"fragmentId": "unused"'), raw.indexOf('"placements"'))));
    assert.deepEqual(parse(p.afterContent).fragments[1], parse(raw).fragments[1]); await prepare(f.source, p);
  }
});

test('all newly expanded actors are bounded atomically after every placement offset while invalid drafts retain no state', async () => {
  const f = await open(), unsafe = add(); unsafe.actor.position = [99641, 0];
  assert.throws(() => f.draft.propose(unsafe), invalid);
  const safe = add(); safe.actor.position = [99640, 0]; assert.equal(expandSceneComposition(f.draft.propose(safe).afterContent).scene.actors[5].position[0], 100000);
  assert.deepEqual(f.draft.propose(add()).edit.instances, add().instances);
});

test('final UTF-8 byte budget rejects growing ADD while atomic REMOVE permits exact-limit source shrink', async () => {
  const prefix = serialize(recipe()), raw = prefix + ' '.repeat(128 * 1024 - Buffer.byteLength(prefix)), f = await open(await fixture(raw));
  assert.throws(() => f.draft.propose(add()), { errorCode: 'scene_composition_structure_content_limit' });
  const p = f.draft.propose(remove('leader')); assert.ok(Buffer.byteLength(p.afterContent) < 128 * 1024); await prepare(f.source, p);
  await assert.rejects(createSceneCompositionStructureDraft(f.model, { ...f.source, content: raw + ' ' }, { digest: hash }), { errorCode: 'scene_composition_structure_content_limit' });
});

test('ordinary preview and malformed source sessions cannot enter structural editing', async () => {
  const f = await fixture(), ordinary = structuredClone(f.model); delete ordinary.composition;
  await assert.rejects(createSceneCompositionStructureDraft(ordinary, f.source, { digest: hash }), invalid);
  for (const source of [{ ...f.source, extra: true }, { ...f.source, sourcePath: 'recipe.md' }, { ...f.source, baseSourceRevision: 'old' }]) await assert.rejects(createSceneCompositionStructureDraft(f.model, source, { digest: hash }), invalid);
});
