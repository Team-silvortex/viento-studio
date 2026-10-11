import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createSceneCompositionPlacementDraft, prepareSceneCompositionPlacementApply } from '../../engine/scene-composition-placement.mjs';
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
  const draft = await createSceneCompositionPlacementDraft(f.model, f.source, f.model.actors[actor].instanceId, { digest: hash });
  return { ...f, draft };
}
const prepare = (source, proposal, digest = hash) => prepareSceneCompositionPlacementApply(source, proposal, { digest });
function deferred() { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; }

test('saved and dirty placement drafts expose raw offsets and exact source-ordered actor and group targets', async () => {
  for (const dirty of [false, true]) for (const actor of [0, 2]) {
    const { draft, source, model } = await open(await fixture(recipe(), { dirty }), actor), value = parse(source.content);
    const placement = value.placements[actor / 2], fragment = value.fragments[0];
    assert.equal(draft.instanceId, model.actors[actor].instanceId); assert.equal(draft.placementId, placement.placementId);
    assert.equal(draft.fragmentId, fragment.fragmentId); assert.deepEqual(draft.offset, placement.offset || null);
    assert.deepEqual(draft.targets, fragment.actors.map(a => ({ instanceId: placement.actorIds[a.key], actorKey: a.key })));
    assert.deepEqual(draft.groups, fragment.groups.map(g => ({ groupId: placement.groupIds[g.key], groupKey: g.key })));
    assert.deepEqual(Object.keys(draft).sort(), ['instanceId', 'placementId', 'fragmentId', 'offset', 'targets', 'groups', 'propose'].sort());
  }
});

test('SET shifts every actor in only the chosen placement while retaining local override and group declarations', async () => {
  const { draft, source } = await open(null, 2), before = parse(source.content), proposal = draft.propose([50.5, -60.25]);
  const after = parse(proposal.afterContent), expected = structuredClone(before); expected.placements[1].offset = [50.5, -60.25];
  assert.deepEqual(after, expected); assert.deepEqual(proposal.changedPaths, ['/placements/1/offset']);
  assert.deepEqual(await prepare(source, proposal), { afterContent: proposal.afterContent, changedPaths: proposal.changedPaths });
  const expanded = expandSceneComposition(proposal.afterContent).scene;
  assert.deepEqual(expanded.actors[2].position, [150.5, 79.75]); assert.deepEqual(expanded.actors[3].position, [250.5, 119.75]);
  assert.deepEqual(expanded.groups, expandSceneComposition(source.content).scene.groups);
  assert.equal(expanded.actors[2].speed, before.placements[1].overrides[0].values.speed);
  const rebuilt = await fixture(proposal.afterContent); assert.deepEqual(rebuilt.model.actors[2].position, [150.5, 79.75]);
});

test('RESET removes the declaration and restores zero without materializing template or instance values', async () => {
  const { draft, source } = await open(null, 2), proposal = draft.propose(null), after = parse(proposal.afterContent);
  assert.equal(proposal.offset, null); assert.equal(Object.hasOwn(after.placements[1], 'offset'), false);
  const expected = parse(source.content); delete expected.placements[1].offset; assert.deepEqual(after, expected);
  assert.deepEqual(expandSceneComposition(proposal.afterContent).scene.actors[2].position, [100, 140]);
  assert.deepEqual(expandSceneComposition(proposal.afterContent).scene.actors[3].position, [200, 180]);
  await prepare(source, proposal);
});

test('undeclared and explicit zero are different author intents even though the expanded scene is identical', async () => {
  const f = await open(), set = f.draft.propose([0, 0]);
  assert.deepEqual(expandSceneComposition(set.afterContent).scene, expandSceneComposition(f.source.content).scene);
  assert.deepEqual(set.changedPaths, ['/placements/0/offset']); await prepare(f.source, set);
  const next = await open(await fixture(set.afterContent)), reset = next.draft.propose(null);
  assert.deepEqual(next.draft.offset, [0, 0]); assert.equal(Object.hasOwn(parse(reset.afterContent).placements[0], 'offset'), false);
  assert.deepEqual(expandSceneComposition(reset.afterContent).scene, expandSceneComposition(set.afterContent).scene);
  await prepare(next.source, reset);
});

test('semantic pair noops preserve escaped keys and fractional untouched axes exactly', async () => {
  const value = recipe(); value.placements[1].offset = [360.125, 80.25];
  const raw = serialize(value).replace('"offset"', '"offs\\u0065t"').replace('360.125', '3.60125e2').replace('80.25', '8.02500e1');
  const { draft, source } = await open(await fixture(raw), 2);
  assert.throws(() => draft.propose([360.125, 80.25]), unchanged);
  const proposal = draft.propose([360.5, 80.25]); assert.equal(proposal.afterContent, source.content.replace('3.60125e2', '360.5'));
});

test('net noops and malformed offset intents reject before any author proposal is returned', async () => {
  const first = await open(), second = await open(null, 2);
  assert.throws(() => first.draft.propose(null), unchanged); assert.throws(() => second.draft.propose([360,80]), unchanged);
  for (const value of [undefined, {}, [], [1], [1,2,3], ['1',2], [NaN,0], [Infinity,0], [100001,0], [0,-100001], new Array(2)]) assert.throws(() => first.draft.propose(value), invalid);
  const extra = [1,2]; extra.extra = true; assert.throws(() => first.draft.propose(extra), invalid);
  let reads = 0; const accessor = [1,2]; Object.defineProperty(accessor, '0', { enumerable:true, get() { reads++; return 1; } });
  assert.throws(() => first.draft.propose(accessor), invalid); assert.equal(reads, 0);
  assert.deepEqual(first.draft.propose([1,2]).offset, [1,2]);
});

test('detached draft and proposal views cannot mutate private canonical offset and target state', async () => {
  const f = await open(null, 2); f.draft.offset[0] = 999; f.draft.targets.reverse(); f.draft.groups[0].groupKey = 'forged';
  const input = [12,13], proposal = f.draft.propose(input); input[0] = 999;
  assert.deepEqual(proposal.offset, [12,13]); const next = f.draft.propose([12,13]);
  proposal.offset[0] = 100; proposal.targets[0].actorKey = 'forged'; proposal.groups.reverse(); proposal.changedPaths.length = 0;
  assert.deepEqual(f.draft.propose([12,13]), next);
});

test('factory snapshots current source model actors groups and identity before asynchronous hashing', async () => {
  const f = await fixture(), original = structuredClone(f), wait = deferred(); let content, calls = 0;
  const pending = createSceneCompositionPlacementDraft(f.model, f.source, f.model.actors[0].instanceId, { digest: text => { content = text; calls++; return wait.promise; } });
  f.source.content = '{}'; f.source.sourcePath = 'other.json'; f.model.actors[0].position[0] = 999;
  f.model.sourceLocations.actors[2].composition.localKey = 'forged'; f.model.sourceLocations.groups[0].composition.localKey = 'forged';
  f.model.sceneStructure.groups[0].name = 'forged'; wait.resolve(hash(content));
  const draft = await pending; assert.equal(calls,1); assert.equal(draft.placementId,parse(original.source.content).placements[0].placementId);
  assert.equal(draft.propose([2,3]).sourcePath, original.source.sourcePath);
});

test('prepare snapshots all source and candidate nested values before asynchronous hashing', async () => {
  const f = await open(null,2), proposal = f.draft.propose([5,6]), expected = structuredClone(proposal), source = structuredClone(f.source), wait = deferred();
  const pending = prepare(source,proposal,() => wait.promise);
  source.content='{}'; source.sourcePath='other.json'; proposal.offset[0]=8; proposal.targets.reverse(); proposal.groups.reverse(); proposal.changedPaths.length=0; proposal.afterContent='{}';
  wait.resolve(hash(f.source.content)); assert.deepEqual(await pending,{afterContent:expected.afterContent,changedPaths:expected.changedPaths});
});

test('every actor and every group provenance must match the complete source preview including unrelated placements', async () => {
  const original = await fixture();
  for (const corrupt of [
    f => { f.model.sourceLocations.groups.pop(); }, f => { f.model.sourceLocations.groups.reverse(); },
    f => { f.model.sourceLocations.groups[3].composition.localKey='party'; },
    f => { f.model.sourceLocations.groups[3].declaration.sourceRevision=revision('stale'); },
    f => { f.model.sourceLocations.groups[3].groupId=f.model.sourceLocations.groups[2].groupId; },
    f => { f.model.sourceLocations.groups[3].composition.extra=true; },
    f => { f.model.sourceLocations.actors[3].objectId=ids.first; },
    f => { f.model.sourceLocations.actors[3].composition.placementId=example.placements[0].placementId; },
    f => { f.model.sourceLocations.actors.reverse(); }, f => { f.model.sceneStructure.groups[3].name='wrong'; },
    f => { f.model.actors[3].position[0]++; }, f => { f.model.composition.placementCount=1; },
  ]) {
    const f=structuredClone(original); corrupt(f);
    await assert.rejects(createSceneCompositionPlacementDraft(f.model,f.source,f.model.actors[0].instanceId,{digest:hash}),invalid);
  }
});

test('stale source hashes saved bases paths and draft identities reject the bound session', async () => {
  const original=await fixture(recipe(),{dirty:true});
  for (const corrupt of [f=>{f.source.baseSourceRevision=revision('different');},f=>{f.source.sourcePath='other.json';},f=>{f.model.scene.sourceRevision=revision('old');},f=>{f.model.composition.sourceRevision=revision('old');}]) {
    const f=structuredClone(original);corrupt(f);await assert.rejects(createSceneCompositionPlacementDraft(f.model,f.source,f.model.actors[0].instanceId,{digest:hash}),conflict);
  }
  await assert.rejects(createSceneCompositionPlacementDraft(original.model,original.source,original.model.actors[0].instanceId,{digest:()=> 'bad'}),invalid);
});

test('apply rejects forged candidates offset intent stable mappings order changed paths and foreign placement identity', async () => {
  const f=await open(null,2), proposal=f.draft.propose([3,4]);
  for (const corrupt of [p=>{p.offset=[4,3];},p=>{p.placementId=example.placements[0].placementId;},p=>{p.fragmentId='other';},p=>{p.instanceId=ids.first;},
    p=>{p.targets.reverse();},p=>{p.targets[0].instanceId=p.targets[1].instanceId;},p=>{p.targets[0].actorKey='companion';},p=>{p.targets[0].extra=true;},
    p=>{p.groups.reverse();},p=>{p.groups.pop();},p=>{p.groups[0].groupId=p.groups[1].groupId;},p=>{p.groups[0].groupKey='other';},p=>{p.groups[0].extra=true;},
    p=>{p.changedPaths=[];},p=>{p.changedPaths.push(p.changedPaths[0]);},p=>{p.changedPaths=['/placements/0/offset'];},p=>{p.afterContent=p.afterContent+' ';},p=>{p.extra=true;},p=>{p.sceneId='bad';}]) {
    const changed=structuredClone(proposal);corrupt(changed);await assert.rejects(prepare(f.source,changed),invalid);
  }
  for (const corrupt of [s=>{s.content+=' ';},s=>{s.sourcePath='other.json';},s=>{s.baseSourceRevision=revision('newbase');}]) {
    const source=structuredClone(f.source);corrupt(source);await assert.rejects(prepare(source,proposal),conflict);
  }
});

test('apply rejects canonical no-op offsets and malformed pair values instead of approving a fake author change', async () => {
  const f=await open(null,2), proposal=f.draft.propose([3,4]);
  const noop={...proposal,offset:[360,80],afterContent:f.source.content,changedPaths:[]};await assert.rejects(prepare(f.source,noop),unchanged);
  for (const offset of [undefined,[NaN,0],new Array(2),[100001,0]]) await assert.rejects(prepare(f.source,{...proposal,offset}),invalid);
});

test('all final shifted actors are validated atomically including a safe selected local override and unsafe companion', async () => {
  const value=recipe();value.placements[1].overrides[0].values.position=[0,0];
  const f=await open(await fixture(value),2);
  assert.throws(()=>f.draft.propose([99801,0]),{errorCode:'scene_composition_invalid'});
  assert.deepEqual(f.draft.propose([99800,0]).offset,[99800,0]);
  assert.deepEqual(f.draft.propose(null).offset,null);
});

test('UTF-8 source and final candidate budgets preserve exact-limit noops reset and shrinking edits', async () => {
  const prefix=serialize(recipe()), raw=prefix+' '.repeat(128*1024-Buffer.byteLength(prefix)), f=await open(await fixture(raw),2);
  assert.throws(()=>f.draft.propose([36000,8000]),{errorCode:'scene_composition_limit'});
  assert.ok(Buffer.byteLength(f.draft.propose([1,2]).afterContent)<Buffer.byteLength(raw));
  assert.ok(Buffer.byteLength(f.draft.propose(null).afterContent)<Buffer.byteLength(raw));
  const f0=await open(await fixture(raw));assert.throws(()=>f0.draft.propose([0,0]),{errorCode:'scene_composition_limit'});
  await assert.rejects(createSceneCompositionPlacementDraft(f.model,{...f.source,content:raw+' '},f.model.actors[2].instanceId,{digest:hash}),{errorCode:'scene_composition_override_content_limit'});
});

test('ordinary previews unrelated UUIDs invalid paths and malformed source sessions cannot enter placement editing', async () => {
  const f=await fixture();
  for (const source of [{...f.source,extra:true},{...f.source,sourcePath:'recipe.md'},{...f.source,baseSourceRevision:'old'},{...f.source,content:'\ud800'}]) {
    await assert.rejects(createSceneCompositionPlacementDraft(f.model,source,f.model.actors[0].instanceId,{digest:hash}),invalid);
  }
  await assert.rejects(createSceneCompositionPlacementDraft(f.model,f.source,ids.first,{digest:hash}),invalid);
  const ordinary=structuredClone(f.model);delete ordinary.composition;await assert.rejects(createSceneCompositionPlacementDraft(ordinary,f.source,f.model.actors[0].instanceId,{digest:hash}),invalid);
});
