import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as core from '../../engine/studio-core.mjs';
import { parseJsonSource, locateJsonSource } from '../../engine/json-source.mjs';

const bytes = await fs.readFile(new URL('../../engine/studio-core.wasm', import.meta.url));
const nativePath = process.env.VIENTO_STUDIO_CORE_BIN || fileURLToPath(new URL('../../desktop/.cache/definition-authoring-core-target/debug/viento-core', import.meta.url));
let nativeAvailable = true; try { await fs.access(nativePath, constants.X_OK); } catch { nativeAvailable = false; }
const id = n => `${n.toString(16).padStart(8, '0')}-1111-4111-8111-111111111111`;
const serialize = value => '\uFEFF' + JSON.stringify(value, null, '\t').replaceAll('\n', '\r\n') + '\r\n \t';
const parse = content => JSON.parse(content.replace(/^\uFEFF/, ''));
function recipe() {
  return { format: 'viento-scene-composition', schemaVersion: 1,
    scene: { title: 'Structure / 共有 / 配方🦊', viewport: [640, 480], background: '#112233' },
    fragments: [{ fragmentId: 'pair', groups: [{ key: 'root', name: 'Root' }, { key: 'sub', name: 'Sub', parentKey: 'root' }], actors: [
      { key: 'leader', objectId: id(1), groupKey: 'root', position: [10.125, 20.25], size: [32, 48], color: '#ffffff', speed: 150, controls: 'arrows' },
      { key: 'companion', objectId: id(1), groupKey: 'sub', position: [30.5, 40.75], useProjectionDefaults: true },
    ] }, { fragmentId: 'unused', actors: [{ key: 'dormant', objectId: id(1), position: [0, 0], useProjectionDefaults: true }], groups: [] }], placements: [
      { placementId: id(10), fragmentId: 'pair', actorIds: { leader: id(11), companion: id(12) }, groupIds: { root: id(13), sub: id(14) },
        overrides: [{ actorKey: 'companion', values: { speed: 6 } }, { actorKey: 'leader', values: { color: '#654321' } }] },
      { placementId: id(20), fragmentId: 'pair', actorIds: { leader: id(21), companion: id(22) }, groupIds: { root: id(23), sub: id(24) }, offset: [300, 80],
        overrides: [{ actorKey: 'leader', values: { position: [111, 222], speed: 18.25 } }] },
    ] };
}
const fragment=(fragmentId='new')=>({fragmentId,actors:[{key:'hero',objectId:id(1),position:[10.125,20.25],useProjectionDefaults:true}],groups:[]});
const add=(content=recipe(),declaration=fragment())=>({protocolVersion:1,operation:'sceneComposition.addFragmentDefinition',content:typeof content==='string'?content:serialize(content),fragment:declaration});
const copy=(content=recipe(),fragmentId='duplicate',sourceFragmentId='pair')=>({protocolVersion:1,operation:'sceneComposition.copyFragmentDefinition',content:typeof content==='string'?content:serialize(content),sourceFragmentId,fragmentId});
const remove=(content=recipe(),fragmentId='unused')=>({protocolVersion:1,operation:'sceneComposition.removeFragmentDefinition',content:typeof content==='string'?content:serialize(content),fragmentId});
const set = () => ({protocolVersion:1,operation:'sceneComposition.patchFragmentActor',content:serialize(recipe()),fragmentId:'pair',actorKey:'leader',values:{speed:10}});
const patch=input=>core.dispatchStudioCoreCompositionDefinitions(input);
const { instance } = await WebAssembly.instantiate(bytes, {}), api = instance.exports;
function wasm(input) {
  const encoded = new TextEncoder().encode(typeof input === 'string' ? input : JSON.stringify(input)), pointer = api.viento_core_input(encoded.length) >>> 0;
  new Uint8Array(api.memory.buffer, pointer, encoded.length).set(encoded);
  const output = api.viento_core_run() >>> 0, length = api.viento_core_output_len();
  return JSON.parse(new TextDecoder('utf8', { fatal: true }).decode(new Uint8Array(api.memory.buffer, output, length)));
}
async function nativeSequence(inputs) {
  return new Promise((resolve, reject) => {
    const child = spawn(nativePath, [], { stdio: ['pipe', 'pipe', 'pipe'] }); let stdout = '', stderr = '', failure;
    const timer = setTimeout(() => { failure = new Error('Native structure parity timed out'); child.kill('SIGKILL'); }, 30000);
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', text => { stdout += text; if (Buffer.byteLength(stdout) > 16 * 1024 * 1024) { failure = new Error('Native output budget exceeded'); child.kill('SIGKILL'); } });
    child.stderr.on('data', text => { stderr = (stderr + text).slice(-4096); }); child.stdin.on('error', error => { failure ||= error; });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', (code, signal) => { clearTimeout(timer); if (failure) return reject(failure);
      try { assert.equal(signal, null); assert.equal(code, 0, stderr); const outputs = stdout.trim().split('\n').map(JSON.parse); assert.equal(outputs.length, inputs.length); resolve(outputs); } catch (error) { reject(error); }
    }); child.stdin.end(inputs.map(input => JSON.stringify(input)).join('\n') + '\n');
  });
}
let bridgeId = 0;
async function responseBridge(response, feature = 1) {
  const module = await import(new URL(`../../engine/studio-core.mjs?composition-definitions-response=${++bridgeId}`, import.meta.url));
  const memory = new WebAssembly.Memory({ initial: 40 }), instantiate = WebAssembly.instantiate; let inputLength = 0, outputLength = 0;
  try {
    WebAssembly.instantiate = async () => ({ instance: { exports: { memory, viento_core_protocol_version: () => 1,
      viento_core_scene_composition_version: () => 1, viento_core_scene_composition_patch_version: () => 1,
      viento_core_scene_composition_edit_version: () => 1, viento_core_scene_composition_positions_version: () => 1,
      viento_core_scene_composition_fragment_version: () => 1, viento_core_scene_composition_fragment_edit_version: () => 1,
      viento_core_scene_composition_placement_version: () => 1, viento_core_scene_composition_structure_version: () => 1,
      viento_core_scene_composition_placements_version: () => 1,
      viento_core_scene_composition_groups_version: () => 1,
      ...(feature === null ? {} : { viento_core_scene_composition_definitions_version: () => feature }),
      viento_core_input: length => { inputLength = length; return 16; }, viento_core_run: () => {
        const input = JSON.parse(new TextDecoder().decode(new Uint8Array(memory.buffer, 16, inputLength)));
        const value = ['sceneComposition.addFragmentDefinition','sceneComposition.copyFragmentDefinition','sceneComposition.removeFragmentDefinition','sceneComposition.inspectDefinitionLocations'].includes(input.operation) ? response : wasm(input);
        const encoded = new TextEncoder().encode(JSON.stringify(value)); outputLength = encoded.length;
        new Uint8Array(memory.buffer, 1048576, encoded.length).set(encoded); return 1048576;
      }, viento_core_output_len: () => outputLength,
    } } }); await module.initializeStudioCore(() => new Uint8Array([1]));
  } finally { WebAssembly.instantiate = instantiate; } return module;
}

test('definition capability is independently optional and leaves all previous composition domains usable',async()=>{
  assert.equal(api.viento_core_scene_composition_definitions_version(),1);assert.equal(core.supportsStudioCoreCompositionDefinitions(),true);for(const feature of [null,0,2]){const module=await responseBridge(wasm(add()),feature);assert.equal(module.supportsStudioCoreCompositionDefinitions(),false);assert.equal(module.supportsStudioCoreCompositionGroups(),true);assert.equal(module.supportsStudioCoreCompositionPlacements(),true);assert.equal(module.supportsStudioCoreCompositionStructure(),true);assert.throws(()=>module.dispatchStudioCoreCompositionDefinitions(add()),{errorCode:'studio_core_unavailable'});assert.deepEqual(module.dispatchStudioCoreCompositionFragment(set()),core.dispatchStudioCoreCompositionFragment(set()));assert.equal(module.getStudioCoreMetadata().ready,true);}
});
test('all three definition operations reject cross-domain dispatch and unknown operation authority',()=>{
  for(const dispatcher of [core.dispatchStudioCoreCompositionPatch,core.dispatchStudioCoreCompositionFragment,core.dispatchStudioCoreCompositionFragmentEdit,core.dispatchStudioCoreCompositionPlacement,core.dispatchStudioCoreCompositionPlacements,core.dispatchStudioCoreCompositionGroups,core.dispatchStudioCoreCompositionStructure,core.dispatchStudioCoreCompositionPositions])for(const request of [add(),copy(),remove()])assert.throws(()=>dispatcher(request),{errorCode:'studio_core_request_invalid'});assert.throws(()=>patch(set()),{errorCode:'studio_core_request_invalid'});assert.throws(()=>patch({...copy(),operation:'sceneComposition.renameFragmentDefinition'}),{errorCode:'studio_core_request_invalid'});assert.equal(core.getStudioCoreMetadata().ready,true);
});
test('ADD accepts a complete native unplaced declaration with groups and no generated identity maps',()=>{
  const declaration=fragment();declaration.groups=[{key:'root',name:'Root'},{key:'sub',name:'Sub / 组🦊',parentKey:'root'}];declaration.actors[0].groupKey='sub';declaration.actors[0].imageResourceId=null;const input=add(recipe(),declaration),result=patch(input),expected=recipe();expected.fragments.push(declaration);assert.deepEqual(parse(result.afterContent),expected);assert.deepEqual(result.changedPaths,['/fragments/2']);assert.deepEqual(wasm(input).compositionPatch,result);assert.deepEqual(wasm({protocolVersion:1,operation:'sceneComposition.expand',content:input.content}).composition.scene,wasm({protocolVersion:1,operation:'sceneComposition.expand',content:result.afterContent}).composition.scene);
});
test('COPY original body preserves escaped key exponent null and flag spelling for both used and unused definitions',()=>{
  const value=recipe();value.fragments[0].actors[1].imageResourceId=null;const raw=serialize(value).replace('"fragmentId"','"\\u0066ragmentId"').replace('10.125','1.0125e1');for(const original of ['pair','unused']){const input=copy(raw,'duplicate',original),result=patch(input),after=parse(result.afterContent),expected=structuredClone(value);expected.fragments.push({...structuredClone(expected.fragments.find(f=>f.fragmentId===original)),fragmentId:'duplicate'});assert.deepEqual(after,expected);assert.deepEqual(result.changedPaths,['/fragments/2']);assert.deepEqual(after.placements,value.placements);assert.ok(result.afterContent.startsWith('\uFEFF')&&result.afterContent.endsWith('\r\n \t'));assert.ok(result.afterContent.includes('1.0125e1'));if(original==='pair')assert.equal((result.afterContent.match(/1\.0125e1/g)||[]).length,2);}
});
test('REMOVE unplaced definitions rebuilds source-map indices while preserving the complete generated scene',()=>{
  const value=recipe();value.fragments.reverse();const input=remove(value),result=patch(input),expected=structuredClone(value);expected.fragments.shift();assert.deepEqual(parse(result.afterContent),expected);assert.deepEqual(result.changedPaths,['/fragments/0']);const before=wasm({protocolVersion:1,operation:'sceneComposition.expand',content:input.content}).composition,after=wasm({protocolVersion:1,operation:'sceneComposition.expand',content:result.afterContent}).composition;assert.deepEqual(before.scene,after.scene);assert.equal(before.sourceMap.actors[0].templatePath,'/fragments/1/actors/0');assert.equal(after.sourceMap.actors[0].templatePath,'/fragments/0/actors/0');
});
test('referenced missing last definitions duplicate IDs and exact request violations fail without poisoning runtime',()=>{
  const one=recipe();one.fragments.pop();for(const input of [remove(recipe(),'pair'),remove(recipe(),'missing'),remove(one,'pair'),copy(recipe(),'pair'),copy(recipe(),'unused'),copy(recipe(),'new','missing'),copy(recipe(),'1bad'),add(recipe(),fragment('pair')),add(recipe(),{...fragment(),actors:[]}),add(recipe(),{...fragment(),groups:[{key:'cycle',name:'Cycle',parentKey:'cycle'}]})]){assert.throws(()=>patch(input),{errorCode:'scene_composition_invalid'});assert.equal(core.getStudioCoreMetadata().ready,true);}for(const input of [{...add(),offset:[0,0]},{...copy(),actorIds:{}},{...remove(),cascade:true}])assert.throws(()=>patch(input),{errorCode:'studio_core_request_invalid'});
});
test('strict bridge JSON snapshots do not execute accessors serializers sparse nonfinite or hidden values',()=>{
  let calls=0;const getter=add();Object.defineProperty(getter,'fragment',{enumerable:true,get(){calls++;return fragment();}});for(const input of [getter,{...add(),fragment:{...fragment(),actors:new Array(1)}},{...add(),fragment:{...fragment(),actors:[{...fragment().actors[0],position:[Infinity,0]}]}},{...copy(),toJSON(){calls++;return copy();}}])assert.throws(()=>patch(input),{errorCode:'studio_core_request_invalid'});assert.equal(calls,0);assert.ok(patch(copy()).afterContent);
});
test('malformed success envelopes paths and any nonrequested definition or placement mutation fail closed',async()=>{
  const good=wasm(copy());for(const alter of [r=>{r.extra=true;},r=>{r.compositionPatch.extra=true;},r=>{r.compositionPatch.changedPaths=[];},r=>{r.compositionPatch.changedPaths=['/fragments/0'];},r=>{r.compositionPatch.changedPaths.push('/fragments/2');},r=>{r.compositionPatch.afterContent=copy().content;},r=>{const v=parse(r.compositionPatch.afterContent);v.fragments[2].fragmentId='forged';r.compositionPatch.afterContent=serialize(v);},r=>{const v=parse(r.compositionPatch.afterContent);v.fragments[0].groups[1].name='forged';r.compositionPatch.afterContent=serialize(v);},r=>{const v=parse(r.compositionPatch.afterContent);delete v.fragments[2].actors[1].useProjectionDefaults;r.compositionPatch.afterContent=serialize(v);},r=>{const v=parse(r.compositionPatch.afterContent);v.placements[1].offset=[1,2];r.compositionPatch.afterContent=serialize(v);},r=>{const v=parse(r.compositionPatch.afterContent);v.fragments.pop();r.compositionPatch.afterContent=serialize(v);}]){const value=structuredClone(good);alter(value);const module=await responseBridge(value);assert.throws(()=>module.dispatchStudioCoreCompositionDefinitions(copy()),{errorCode:'studio_core_unavailable'});assert.equal(module.getStudioCoreMetadata().ready,false);}
});
test('all original and final fragment source budgets reject growth and unsafe unused declarations while permitting shrink',()=>{
  let content=serialize(recipe());content+=' '.repeat(131072-Buffer.byteLength(content));for(const input of [add(content),copy(content)])assert.throws(()=>patch(input),{errorCode:'scene_composition_limit'});assert.ok(Buffer.byteLength(patch(remove(content)).afterContent)<131072);const value=recipe();for(let n=2;n<32;n++)value.fragments.push(fragment(`f${n}`));assert.throws(()=>patch(copy(value)),{errorCode:'scene_composition_limit'});const unsafe=recipe();unsafe.fragments[1].actors[0].size=[0,32];assert.throws(()=>patch(remove(unsafe)),{errorCode:'scene_composition_invalid'});const duplicate=serialize(recipe()).replace('"schemaVersion": 1','"schemaVersion": 1, "schemaVersion": 1');assert.throws(()=>patch(copy(duplicate)),{errorCode:'scene_composition_invalid'});
});
test('fresh native CLI and WASM return identical bytes paths and failures for definition and previous domains',{skip:!nativeAvailable},async()=>{
  const one=recipe();one.fragments.pop();const reverse=recipe();reverse.fragments.reverse();const grouped=fragment();grouped.groups=[{key:'root',name:'Root'}];grouped.actors[0].groupKey='root';const raw=serialize(recipe()).replace('10.125','1.0125e1');const inputs=[add(),add(recipe(),grouped),copy(),copy(recipe(),'new','unused'),copy(raw),remove(),remove(reverse),remove(recipe(),'pair'),remove(one,'pair'),remove(recipe(),'missing'),copy(recipe(),'pair'),copy(recipe(),'new','missing'),add(recipe(),{...fragment(),actors:[]}),{...copy(),extra:true},set(),{protocolVersion:1,operation:'sceneComposition.expand',content:serialize(recipe())},{protocolVersion:1,operation:'sceneComposition.editPlacementOffset',content:serialize(recipe()),placementId:id(10),offset:[0,0]},{protocolVersion:1,operation:'sceneComposition.removePlacement',content:serialize(recipe()),placementId:id(20)},{protocolVersion:1,operation:'sceneComposition.editFragmentGroup',content:serialize(recipe()),fragmentId:'pair',groupKey:'sub',name:'Renamed',parentKey:null}];assert.deepEqual(await nativeSequence(inputs),inputs.map(wasm));
});

const inspect=(content=serialize(recipe()),paths=[''])=>({protocolVersion:1,operation:'sceneComposition.inspectDefinitionLocations',content,paths});
const locations=request=>core.dispatchStudioCoreCompositionDefinitionLocations(request);
test('Rust definition ranges equal host UTF16 CST locations for BOM CRLF multilingual emoji escaped keys and nearest containers',()=>{
  const value=recipe();value.scene.title='中文 / 日本語 / 🦊 "quoted"';value.fragments[0].groups[1].name='组 / 組 / 🦊';
  const raw=serialize(value).replace('"fragmentId"','"\\u0066ragmentId"').replace('10.125','1.0125e1'),parsed=parseJsonSource(raw),paths=['','/scene/title','/fragments/0','/fragments/0/fragmentId','/fragments/0/groups/1/name','/fragments/0/actors/0/position/0','/placements/1/overrides/0/values/position/1','/missing','/scene/title/missing','/fragments/0/actors/0/position/00','/fragments/0/actors/0/position/0/missing','/fragments/999999999999999999999999999999999999','/fragments/-','/fragments/0/actors/0/unknown/~0~1','/scene/未知🦊'];
  assert.equal(parsed.ok,true);const expected=paths.map(path=>locateJsonSource(parsed,path,{nearest:true}));assert.deepEqual(locations(inspect(raw,paths)),{locations:expected});assert.deepEqual(wasm(inspect(raw,paths)).compositionLocations,{locations:expected});assert.equal(expected[0].start,1);assert.ok(expected.some(range=>range.exact===false));const title=expected[1];assert.equal(JSON.parse(raw.slice(title.start,title.end)),value.scene.title);assert.deepEqual(locations(inspect(raw,[])),{locations:[]});
});
test('location requests bind unique ordered pointers and bounded UTF8 lengths while preserving whole recipe admission',()=>{
  const raw=serialize(recipe());for(const paths of [['bad'],['/~2'],['/~'],['/scene','/scene']])assert.throws(()=>locations(inspect(raw,paths)),{errorCode:'scene_composition_invalid'});for(const paths of [null,[1]])assert.throws(()=>locations(inspect(raw,paths)),{errorCode:'studio_core_request_invalid'});assert.throws(()=>locations({...inspect(),nearest:true}),{errorCode:'studio_core_request_invalid'});
  const full=Array.from({length:4096},(_,i)=>`/absent${i}`);const response=locations(inspect(raw,full));assert.equal(response.locations.length,4096);assert.ok(response.locations.every(range=>range.propertyPath===''&&range.exact===false));assert.throws(()=>locations(inspect(raw,[...full,'/absent4096'])),{errorCode:'scene_composition_limit'});assert.throws(()=>locations(inspect(raw,['/'+'x'.repeat(4096)])),{errorCode:'scene_composition_limit'});assert.throws(()=>locations(inspect(raw,['/'+'🦊'.repeat(1024)])),{errorCode:'scene_composition_limit'});
  const invalid=recipe();invalid.fragments[1].actors[0].size=[0,32];assert.throws(()=>locations(inspect(serialize(invalid),[])),{errorCode:'scene_composition_invalid'});let calls=0;const accessor=inspect();Object.defineProperty(accessor,'paths',{enumerable:true,get(){calls++;return [''];}});assert.throws(()=>locations(accessor),{errorCode:'studio_core_request_invalid'});assert.equal(calls,0);assert.equal(core.getStudioCoreMetadata().ready,true);
});
test('malformed location receipts reject missing null unordered wrong paths offsets encoding exactness and extra fields',async()=>{
  const input=inspect(serialize(recipe()),['/scene/title','/scene/background','/fragments/0/actors/0/position/00']),good=wasm(input);for(const mutate of [r=>{r.extra=true;},r=>{r.compositionLocations.extra=true;},r=>{r.compositionLocations.locations.pop();},r=>{r.compositionLocations.locations[0]=null;},r=>r.compositionLocations.locations.reverse(),r=>{r.compositionLocations.locations[0].propertyPath='/scene';},r=>{r.compositionLocations.locations[0].start++;},r=>{r.compositionLocations.locations[0].end=999999;},r=>{r.compositionLocations.locations[0].encoding='utf-8';},r=>{r.compositionLocations.locations[0].exact=false;},r=>{r.compositionLocations.locations[2].propertyPath='/fragments';},r=>{r.compositionLocations.locations[0].extra=true;}]){const response=structuredClone(good);mutate(response);const module=await responseBridge(response);assert.throws(()=>module.dispatchStudioCoreCompositionDefinitionLocations(input),{errorCode:'studio_core_unavailable'});assert.equal(module.getStudioCoreMetadata().ready,false);}
});
test('read-only location interface remains separate from author edits and leaves live geometry drafts unchanged',async()=>{
  const input=inspect(serialize(recipe()),['/scene','/fragments/0/actors/0','/fragments/0/actors/0/absent']);assert.throws(()=>patch(input),{errorCode:'studio_core_request_invalid'});assert.throws(()=>locations(add()),{errorCode:'studio_core_request_invalid'});const created=core.dispatchStudioCoreDraft({protocolVersion:1,operation:'layoutDraft.create',actors:[{objectId:'live-layout',position:[10.125,20.25]}]}),metadata=core.getStudioCoreMetadata();try{for(let n=0;n<5;n++)locations(input);assert.deepEqual(core.dispatchStudioCoreDraft({protocolVersion:1,operation:'layoutDraft.read',draftId:created.draftId}),created);assert.deepEqual(core.getStudioCoreMetadata(),metadata);}finally{core.dispatchStudioCoreDraft({protocolVersion:1,operation:'layoutDraft.close',draftId:created.draftId});}
  for(const feature of [null,0,2]){const module=await responseBridge(wasm(input),feature);assert.throws(()=>module.dispatchStudioCoreCompositionDefinitionLocations(input),{errorCode:'studio_core_unavailable'});assert.equal(module.supportsStudioCoreCompositionGroups(),true);assert.equal(module.getStudioCoreMetadata().ready,true);}
});
test('fresh native and actual WASM agree on read-only UTF16 pointer locations nearest fallbacks and errors',{skip:!nativeAvailable},async()=>{
  const value=recipe();value.scene.title='中文 / 日本語 / 🦊';const raw=serialize(value).replace('"fragmentId"','"\\u0066ragmentId"').replace('10.125','1.0125e1'),inputs=[inspect(raw,['','/scene/title','/fragments/0/fragmentId','/fragments/0/actors/0/position/00','/scene/title/missing','/unknown/~0~1']),inspect(raw,[]),inspect(raw,['/~2']),inspect(raw,['/scene','/scene']),{...inspect(raw,['']),nearest:true}];assert.deepEqual(await nativeSequence(inputs),inputs.map(wasm));
});
