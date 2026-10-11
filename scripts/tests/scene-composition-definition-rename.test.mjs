import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createSceneCompositionDefinitionsDraft, prepareSceneCompositionDefinitionsApply } from '../../engine/scene-composition-definitions.mjs';
import { expandSceneComposition } from '../../engine/scene-composition.mjs';
import { resolveSceneCompositionPreview } from '../../engine/scene-composition-preview.mjs';
import { createWorldProjection } from '../../engine/world-projection.mjs';
import { scene2DModelToPlan } from '../../engine/build-plan.mjs';
import { createSceneStructure } from '../../engine/scene-structure.mjs';
import { parseJsonSource, locateJsonSource } from '../../engine/json-source.mjs';

const golden = JSON.parse(await fs.readFile(new URL('./fixtures/scene-model/legacy-plan-v1.json', import.meta.url), 'utf8'));
const example = JSON.parse(await fs.readFile(new URL('../../examples/scene-composition/recipe.json', import.meta.url), 'utf8'));
const { ids } = golden;
const id = n => `${n.toString(16).padStart(8, '0')}-1111-4111-8111-111111111111`;
const hash = content => createHash('sha256').update(content).digest('hex');
const revision = content => `sha256:${hash(content)}`;
const parse = content => JSON.parse(content.replace(/^\uFEFF/, ''));
const serialize = value => '\uFEFF' + JSON.stringify(value, null, '\t').replaceAll('\n', '\r\n') + '\r\n \t';
const invalid = error => error?.errorCode === 'scene_composition_definitions_invalid';
const conflict = error => error?.errorCode === 'scene_composition_definitions_conflict';
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
  return { model, source, observed };
}
async function open(f=null) { f ||= await fixture();return {...f,draft:await createSceneCompositionDefinitionsDraft(f.model,f.source,{digest:hash})}; }
const prepare=(source,p,digest=hash)=>prepareSceneCompositionDefinitionsApply(source,p,{digest});
const declaration=(fragmentId='new')=>({fragmentId,actors:[{key:'hero',objectId:ids.first,position:[10.125,20.25],useProjectionDefaults:true}],groups:[]});
const add=(fragment=declaration())=>({action:'add',fragment});
const copy=(fragmentId='duplicate',sourceFragmentId='party')=>({action:'copy',sourceFragmentId,fragmentId});
const remove=(fragmentId='unused')=>({action:'remove',fragmentId});
function deferred(){let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};}
const span=(source,path)=>{const range=locateJsonSource(parseJsonSource(source),path);assert.ok(range&&range.exact);return source.slice(range.start,range.end);};

const rename=(fragmentId='party',newFragmentId='renamed')=>({action:'rename',fragmentId,newFragmentId});
const unchanged=error=>error?.errorCode==='scene_composition_definitions_unchanged';
test('saved and dirty rename keeps the exact proposal shape and stable complete effective scene',async()=>{
  for(const dirty of [false,true]){const f=await open(await fixture(recipe(),{dirty})),p=f.draft.propose(rename());const expected=recipe();expected.fragments[0].fragmentId='renamed';for(const placement of expected.placements)placement.fragmentId='renamed';assert.deepEqual(parse(p.afterContent),expected);assert.deepEqual(p.targets,[]);assert.deepEqual(Object.keys(p),['sceneId','sourcePath','baseSourceRevision','sourceRevision','edit','targets','afterContent','changedPaths']);assert.deepEqual(p.changedPaths,['/fragments/0/fragmentId','/placements/0/fragmentId','/placements/1/fragmentId']);assert.deepEqual(expandSceneComposition(p.afterContent).scene,expandSceneComposition(f.source.content).scene);assert.deepEqual(await prepare(f.source,p),{afterContent:p.afterContent,changedPaths:p.changedPaths});}
});
test('unused and interleaved placements rename only related identities without allocating UUIDs',async()=>{
  const value=recipe();value.placements[1].fragmentId='unused';value.placements[1].actorIds={dormant:id(70)};value.placements[1].groupIds={};delete value.placements[1].overrides;const f=await open(await fixture(value)),p=f.draft.propose(rename());assert.deepEqual(p.changedPaths,['/fragments/0/fragmentId','/placements/0/fragmentId']);assert.deepEqual(parse(p.afterContent).placements[1],value.placements[1]);const normal=await open(),unused=normal.draft.propose(rename('unused','new_unused'));assert.deepEqual(unused.changedPaths,['/fragments/1/fragmentId']);assert.deepEqual(parse(unused.afterContent).placements,recipe().placements);assert.equal(unused.afterContent,normal.source.content.replace('"unused"','"new_unused"'));
});
test('decoded escaped identities and keys preserve every unrelated token BOM CRLF names and numeric spelling',async()=>{
  const raw=serialize(recipe()).replaceAll('"fragmentId"','"\\u0066ragmentId"').replaceAll('"party"','"p\\u0061rty"').replace('120.125','1.20125e2'),f=await open(await fixture(raw)),p=f.draft.propose(rename());let expected=raw;const index=parseJsonSource(raw);for(const path of [...p.changedPaths].reverse()){const range=locateJsonSource(index,path);expected=expected.slice(0,range.start)+'"renamed"'+expected.slice(range.end);}assert.equal(p.afterContent,expected);assert.ok(p.afterContent.startsWith('\uFEFF')&&p.afterContent.endsWith('\r\n \t'));await prepare(f.source,p);
});
test('same identity produces explicit unchanged rejection while valid case-sensitive identity changes are retained',async()=>{
  const f=await open();assert.throws(()=>f.draft.propose(rename('party','party')),unchanged);const p=f.draft.propose(rename('party','Party'));assert.equal(p.edit.newFragmentId,'Party');await prepare(f.source,p);const noop={...p,edit:rename('party','party'),afterContent:f.source.content,changedPaths:[]};await assert.rejects(prepare(f.source,noop),unchanged);
});
test('exact rename intent rejects missing extra whitespace unicode slash duplicate and missing identities',async()=>{
  const f=await open();for(const edit of [{action:'rename',fragmentId:'party'},{...rename(),extra:true},{...rename(),newFragmentId:null},rename('missing','new'),rename('party','unused'),rename('party',''),rename('party','1bad'),rename('party','日本語'),rename('party','../x'),rename('party',' renamed'),rename('party','a'.repeat(65))])assert.throws(()=>f.draft.propose(edit),invalid);assert.ok(f.draft.propose(rename()));
});
test('full host receipt reconstruction rejects identity path target order source and lexical forgery',async()=>{
  const f=await open(),p=f.draft.propose(rename());for(const alter of [x=>{x.extra=true;},x=>{x.targets=[{}];},x=>{x.changedPaths.reverse();},x=>{x.changedPaths.pop();},x=>{x.changedPaths[0]='/fragments/0';},x=>{x.edit.newFragmentId='other';},x=>{x.afterContent+=' ';},x=>{x.afterContent=x.afterContent.replace('120.125','1.20125e2');},x=>{x.afterContent=x.afterContent.replace('"speed": 17','"speed": 18');},x=>{x.afterContent=x.afterContent.replace('"renamed"','"forged"');}]){const bad=structuredClone(p);alter(bad);await assert.rejects(prepare(f.source,bad),invalid);}await assert.rejects(prepare({...f.source,content:f.source.content+' '},p),conflict);await assert.rejects(prepare({...f.source,baseSourceRevision:revision('other')},p),conflict);
});
test('whole organizational semantics and source-ordered actor group provenance remain mandatory for opening rename',async()=>{
  const f=await fixture();for(const alter of [m=>{m.sceneStructure.groups[0].name='forged';},m=>{m.sceneStructure.groups[1].parentGroupId=null;},m=>{m.sceneStructure.memberships.reverse();},m=>{m.sourceLocations.actors[0].composition.fragmentId='unused';},m=>{m.sourceLocations.groups[0].composition.fragmentId='unused';},m=>{m.sourceLocations.groups.reverse();},m=>{m.sourceLocations.actors[0].declaration.sourceRevision=revision('other');}]){const model=structuredClone(f.model);alter(model);await assert.rejects(createSceneCompositionDefinitionsDraft(model,f.source,{digest:hash}),invalid);}
});
test('preawait model source and proposal snapshots block late caller changes during open and prepare',async()=>{
  const f=await fixture(),gate=deferred();const opening=createSceneCompositionDefinitionsDraft(f.model,f.source,{digest:async text=>{await gate.promise;return hash(text);}});const original=structuredClone(f.source);f.source.content='invalid';f.model.sourceLocations.actors[0].composition.fragmentId='forged';gate.resolve();const draft=await opening,p=draft.propose(rename());const second=deferred(),pending=prepare(original,p,async text=>{await second.promise;return hash(text);});const after=p.afterContent;p.edit.newFragmentId='late';p.targets.push({});p.afterContent='late';original.content='late';second.resolve();assert.deepEqual(await pending,{afterContent:after,changedPaths:['/fragments/0/fragmentId','/placements/0/fragmentId','/placements/1/fragmentId']});
});
test('strict rename snapshots reject accessors serializers symbols hidden fields cycles and sparse arrays without running code',async()=>{
  const f=await open();let calls=0;const getter=rename();Object.defineProperty(getter,'newFragmentId',{enumerable:true,get(){calls++;return 'new';}});const hidden=rename();Object.defineProperty(hidden,'secret',{value:1});const symbol=rename();symbol[Symbol('hidden')]=1;const cycle=rename();cycle.self=cycle;for(const edit of [getter,hidden,symbol,cycle,{...rename(),toJSON(){calls++;return rename();}}])assert.throws(()=>f.draft.propose(edit),invalid);const p=f.draft.propose(rename());Object.defineProperty(p.edit,'newFragmentId',{enumerable:true,get(){calls++;return 'new';}});await assert.rejects(prepare(f.source,p),invalid);assert.equal(calls,0);
});
test('final whole source budget rejects atomic growth permits shrink and still reports no-op at exact limit',async()=>{
  const raw=serialize(recipe()),full=raw+' '.repeat(131072-Buffer.byteLength(raw)),f=await open(await fixture(full));assert.throws(()=>f.draft.propose(rename('party','longer')),e=>e.errorCode==='scene_composition_definitions_content_limit');const p=f.draft.propose(rename('party','p'));assert.ok(Buffer.byteLength(p.afterContent)<131072);await prepare(f.source,p);assert.throws(()=>f.draft.propose(rename('party','party')),unchanged);
});
test('reopened rename binds regenerated provenance and permits subsequent original copy add remove actions',async()=>{
  const f=await open(),p=f.draft.propose(rename()),next=await open(await fixture(p.afterContent));assert.equal(next.draft.fragments[0].fragmentId,'renamed');assert.ok(next.model.sourceLocations.actors.every(x=>x.composition.fragmentId==='renamed'));const copied=next.draft.propose(copy('duplicate','renamed'));await prepare(next.source,copied);assert.ok(next.draft.propose(add()).afterContent);assert.ok(next.draft.propose(remove()).afterContent);assert.deepEqual(next.model.sceneStructure,f.model.sceneStructure);
});
