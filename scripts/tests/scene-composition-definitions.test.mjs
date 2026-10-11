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

test('saved and dirty definition directory contains frozen raw declarations with source-ordered related placements',async()=>{
  for(const dirty of [false,true]){const f=await open(await fixture(recipe(),{dirty})),raw=parse(f.source.content);assert.deepEqual(Object.keys(f.draft).sort(),['fragments','propose']);assert.deepEqual(f.draft.fragments,raw.fragments.map(fragment=>({...fragment,placements:raw.placements.filter(p=>p.fragmentId===fragment.fragmentId)})));assert.equal(f.draft.fragments[1].placements.length,0);assert.equal(Object.hasOwn(f.draft.fragments[0].placements[0],'offset'),false);assert.throws(()=>f.draft.fragments.pop(),TypeError);assert.throws(()=>{f.draft.fragments[0].placements[0].actorIds.leader=ids.first;},TypeError);}
});
test('ADD complete native grouped definition is unplaced with no generated targets or UUID allocation',async()=>{
  for(const dirty of [false,true]){const f=await open(await fixture(recipe(),{dirty})),fragment=declaration();fragment.groups=[{key:'root',name:'Root'},{key:'child',name:'Child / 组🦊',parentKey:'root'}];fragment.actors[0].groupKey='child';fragment.actors[0].imageResourceId=null;const p=f.draft.propose(add(fragment)),expected=recipe();expected.fragments.push(fragment);assert.deepEqual(parse(p.afterContent),expected);assert.deepEqual(p.targets,[]);assert.deepEqual(p.changedPaths,['/fragments/2']);assert.deepEqual(expandSceneComposition(p.afterContent).scene,expandSceneComposition(f.source.content).scene);assert.deepEqual(await prepare(f.source,p),{afterContent:p.afterContent,changedPaths:p.changedPaths});const rebuilt=await fixture(p.afterContent);assert.equal(rebuilt.model.actors.length,4);assert.equal(rebuilt.model.composition.fragmentCount,3);assert.deepEqual(parse(p.afterContent).placements,recipe().placements);}
});
test('COPY preserves original token spans escaped keys names numeric lexemes null flags and actor group order',async()=>{
  const raw=serialize(recipe()).replace('"fragmentId"','"\\u0066ragmentId"').replace('120.125','1.20125e2').replace('"Party / 队伍 / 隊"','"\\u0050arty / 队伍 / 隊"'),f=await open(await fixture(raw)),p=f.draft.propose(copy()),original=span(raw,'/fragments/0'),expected=original.replace('"party"','"duplicate"');assert.equal(span(p.afterContent,'/fragments/2'),expected);assert.equal(span(p.afterContent,'/fragments/0'),original);assert.equal(span(p.afterContent,'/fragments/1'),span(raw,'/fragments/1'));assert.equal(span(p.afterContent,'/placements'),span(raw,'/placements'));assert.ok(p.afterContent.startsWith('\uFEFF')&&p.afterContent.endsWith('\r\n \t'));assert.deepEqual(p.targets,[]);assert.deepEqual(p.changedPaths,['/fragments/2']);assert.deepEqual(expandSceneComposition(p.afterContent).scene,expandSceneComposition(raw).scene);await prepare(f.source,p);await fixture(p.afterContent);
});
test('COPY unused definitions retains local identity and reusable object references without placement maps',async()=>{
  const f=await open(),p=f.draft.propose(copy('dormantCopy','unused')),raw=parse(p.afterContent);assert.deepEqual(raw.fragments[2],{...recipe().fragments[1],fragmentId:'dormantCopy'});assert.deepEqual(raw.placements,recipe().placements);assert.deepEqual(p.targets,[]);await prepare(f.source,p);const next=await open(await fixture(p.afterContent));assert.deepEqual(next.draft.fragments[2].placements,[]);assert.deepEqual(next.draft.propose(remove('dormantCopy')).targets,[]);
});
test('REMOVE first middle and tail unused definitions preserves retained tokens while rebuilding shifted source provenance',async()=>{
  for(const index of [0,1,2])for(const compact of [true,false]){const value=recipe(),used=value.fragments[0];value.fragments=[declaration('unused1'),declaration('unused2')];value.fragments.splice(index===0?2:index===1?0:1,0,used);const removed=value.fragments[index].fragmentId,raw=compact?JSON.stringify(value):serialize(value),f=await open(await fixture(raw)),p=f.draft.propose(remove(removed)),before=expandSceneComposition(raw);assert.deepEqual(p.targets,[]);assert.deepEqual(p.changedPaths,[`/fragments/${index}`]);value.fragments.splice(index,1);assert.deepEqual(parse(p.afterContent),value);for(let n=0;n<3;n++)if(n!==index)assert.equal(span(raw,`/fragments/${n}`),span(p.afterContent,`/fragments/${n<index?n:n-1}`));assert.equal(span(raw,'/placements'),span(p.afterContent,'/placements'));assert.deepEqual(before.scene,expandSceneComposition(p.afterContent).scene);await prepare(f.source,p);const rebuilt=await fixture(p.afterContent);assert.equal(rebuilt.model.composition.fragmentCount,2);assert.deepEqual(rebuilt.model.actors.map(a=>[a.instanceId,a.position]),f.model.actors.map(a=>[a.instanceId,a.position]));if(index===0){assert.equal(before.sourceMap.actors[0].templatePath,'/fragments/2/actors/0');assert.equal(expandSceneComposition(p.afterContent).sourceMap.actors[0].templatePath,'/fragments/1/actors/0');}}
});
test('used missing last definitions and duplicate local IDs cannot be removed or implicitly renamed',async()=>{
  const f=await open();for(const input of [remove('party'),remove('missing'),copy('party'),copy('unused'),copy('new','missing'),copy('bad:name'),copy('1bad'),add(declaration('party'))])assert.throws(()=>f.draft.propose(input),invalid);const value=recipe();value.fragments.pop();const last=await open(await fixture(value));assert.throws(()=>last.draft.propose(remove('party')),invalid);const next=f.draft.propose(copy('new'));await prepare(f.source,next);const after=await open(await fixture(next.afterContent));assert.throws(()=>after.draft.propose(add(declaration('new'))),invalid);
});
test('exact edit and native actor group rules validate all unused declarations without editor-side fallbacks',async()=>{
  const f=await open();for(const input of [{...add(),extra:true},{...copy(),fragment:declaration()},{...remove(),sourceFragmentId:'party'},{action:['add'],fragment:declaration()},{action:'rename',fragmentId:'party',name:'new'},add({...declaration(),extra:true}),add({...declaration(),actors:[]}),add({...declaration(),groups:undefined}),add({...declaration(),actors:[{...declaration().actors[0],position:[100001,0]}]}),add({...declaration(),actors:[{...declaration().actors[0],groupKey:'missing'}]}),add({...declaration(),groups:[{key:'loop',name:'Loop',parentKey:'loop'}]}),add({...declaration(),actors:[{...declaration().actors[0],useProjectionDefaults:false}]})])assert.throws(()=>f.draft.propose(input),invalid);const explicit=declaration();Object.assign(explicit.actors[0],{useProjectionDefaults:false,size:[32,48],color:'#ffffff',speed:0,controls:'none'});assert.ok(f.draft.propose(add(explicit)).afterContent);
});
test('32 fragments and aggregate 128 declared actors groups include unplaced definitions and copied declarations',async()=>{
  const count=recipe();for(let n=2;n<32;n++)count.fragments.push(declaration(`f${n}`));const f=await open(await fixture(count));for(const input of [add(),copy()])assert.throws(()=>f.draft.propose(input),{errorCode:'scene_composition_definitions_content_limit'});await prepare(f.source,f.draft.propose(remove('f31')));
  const actors=recipe();actors.fragments[1].actors=Array.from({length:126},(_,n)=>({...declaration().actors[0],key:`a${n}`}));const a=await open(await fixture(actors));for(const input of [add(),copy('new','party')])assert.throws(()=>a.draft.propose(input),{errorCode:'scene_composition_definitions_content_limit'});await prepare(a.source,a.draft.propose(remove('unused')));
  const groups=recipe();groups.fragments[1].groups=Array.from({length:126},(_,n)=>({key:`g${n}`,name:`G${n}`}));const g=await open(await fixture(groups));assert.throws(()=>g.draft.propose(copy()),{errorCode:'scene_composition_definitions_content_limit'});
});
test('128KiB final source limit rejects growth and retains shrinking unplaced-definition delete',async()=>{
  let raw=serialize(recipe());raw+=' '.repeat(131072-Buffer.byteLength(raw));const f=await open(await fixture(raw));for(const input of [add(),copy()])assert.throws(()=>f.draft.propose(input),{errorCode:'scene_composition_definitions_content_limit'});const p=f.draft.propose(remove());assert.ok(Buffer.byteLength(p.afterContent)<131072);assert.deepEqual(parse(p.afterContent).placements,recipe().placements);await prepare(f.source,p);
});
test('whole preview provenance and complete organizational semantics bind original source independently of selected definition',async()=>{
  const original=await fixture();for(const mutate of [m=>m.sourceLocations.actors.reverse(),m=>m.sourceLocations.groups.pop(),m=>{m.sourceLocations.groups[3].composition.localKey='party';},m=>{m.sourceLocations.groups[3].declaration.sourceRevision=revision('old');},m=>{m.sceneStructure.groups[3].name='forged';},m=>{delete m.sceneStructure.groups[3].parentGroupId;},m=>m.sceneStructure.memberships.reverse(),m=>{m.sceneStructure.memberships[3].groupId=id(999);},m=>{m.actors[3].groupId=id(999);},m=>{m.actors[3].position[0]++;},m=>{m.composition.fragmentCount=1;}]){const f=structuredClone(original);mutate(f.model);await assert.rejects(createSceneCompositionDefinitionsDraft(f.model,f.source,{digest:hash}),invalid);}for(const model of [null,1,[],{},'bad'])await assert.rejects(createSceneCompositionDefinitionsDraft(model,original.source,{digest:hash}),invalid);
});
test('saved and dirty source revisions path and digest bind independently from rendered identity equality',async()=>{
  const original=await fixture(recipe(),{dirty:true});for(const mutate of [f=>{f.source.sourcePath='other.json';},f=>{f.source.baseSourceRevision=revision('different');},f=>{f.model.composition.sourceRevision=revision('different');},f=>{f.source.content+=' ';}]){const f=structuredClone(original);mutate(f);await assert.rejects(createSceneCompositionDefinitionsDraft(f.model,f.source,{digest:hash}),conflict);}await open(original);await assert.rejects(createSceneCompositionDefinitionsDraft(original.model,original.source,{digest:()=> 'bad'}),invalid);
});
test('factory detaches source model and raw-directory authority before asynchronous digest',async()=>{
  const f=await fixture(),input=structuredClone(f),gate=deferred(),opening=createSceneCompositionDefinitionsDraft(input.model,input.source,{digest:()=>gate.promise});input.source.content='{}';input.model.actors[0].position[0]++;input.model.sourceLocations.groups=[];gate.resolve(hash(f.source.content));const d=await opening,p=d.propose(add()),expected=structuredClone(p);p.edit.fragment.actors[0].position[0]=999;p.targets.push({instanceId:id(999)});p.changedPaths=[];assert.deepEqual(d.propose(add()),expected);await prepare(f.source,expected);
});
test('host snapshots before digest and reconstructs exact intent empty targets candidate bytes and paths for all actions',async()=>{
  for(const action of [add(),copy(),remove()]){const f=await open(),good=f.draft.propose(action);for(const mutate of [p=>{p.targets.push({});},p=>{p.targets={};},p=>{p.changedPaths=[];},p=>{p.changedPaths.push(p.changedPaths[0]);},p=>{p.changedPaths[0]='/fragments/0';},p=>{p.afterContent+=' ';},p=>{p.edit.extra=true;},p=>{p.extra=true;},p=>{p.sceneId='bad';}]){const p=structuredClone(good);mutate(p);await assert.rejects(prepare(f.source,p),invalid);}for(const mutate of [s=>{s.sourcePath='other.json';},s=>{s.baseSourceRevision=revision('old');},s=>{s.content+=' ';}]){const source=structuredClone(f.source);mutate(source);await assert.rejects(prepare(source,good),conflict);}const proposal=structuredClone(good),source=structuredClone(f.source),gate=deferred(),applying=prepare(source,proposal,()=>gate.promise);source.content='{}';proposal.edit.action='remove';proposal.targets.push({});proposal.changedPaths=[];proposal.afterContent='{}';gate.resolve(hash(f.source.content));assert.deepEqual(await applying,{afterContent:good.afterContent,changedPaths:good.changedPaths});}
});
test('strict raw snapshots reject accessors serializers sparse hidden nonfinite and cyclic intentions without executing code',async()=>{
  const f=await open();let calls=0;const getter=add();Object.defineProperty(getter,'fragment',{enumerable:true,get(){calls++;return declaration();}});assert.throws(()=>f.draft.propose(getter),invalid);assert.throws(()=>f.draft.propose({...add(),toJSON(){calls++;return add();}}),invalid);const hidden=add();hidden[Symbol('x')]=true;assert.throws(()=>f.draft.propose(hidden),invalid);const cycle=add();cycle.fragment.actors[0].cycle=cycle;assert.throws(()=>f.draft.propose(cycle),invalid);for(const input of [add({...declaration(),actors:new Array(1)}),add({...declaration(),actors:[{...declaration().actors[0],position:[NaN,0]}]}),{...copy(),fragmentId:undefined}])assert.throws(()=>f.draft.propose(input),invalid);const deep=add();deep.extra={};let cursor=deep.extra;for(let i=0;i<70;i++){cursor.next={};cursor=cursor.next;}assert.throws(()=>f.draft.propose(deep),invalid);const p=f.draft.propose(add());Object.defineProperty(p.edit.fragment.actors[0],'position',{enumerable:true,get(){calls++;return [0,0];}});await assert.rejects(prepare(f.source,p),invalid);assert.equal(calls,0);
});
test('unused raw object and explicit-image availability remains an existing host dependency gate rather than pure engine authority',async()=>{
  const f=await open();for(const field of ['objectId','imageResourceId']){const fragment=declaration();fragment.actors[0][field]=id(999);const p=f.draft.propose(add(fragment));await prepare(f.source,p);const observed=structuredClone(f.observed),document=observed.source.documents.find(d=>d.record.id===ids.scene);document.content=p.afterContent;document.sourceRevision=revision(p.afterContent);observed.projection=await createWorldProjection(observed.source,{digest:hash});const result=await resolveSceneCompositionPreview(observed,ids.scene,{digest:hash});assert.equal(result.ok,false);assert.ok(result.diagnostics.some(d=>d.code==='composition-document-invalid'&&(field==='objectId'?d.relatedObjectId===id(999):d.resourceId===id(999))));assert.deepEqual(expandSceneComposition(p.afterContent).scene,expandSceneComposition(f.source.content).scene);}
});
