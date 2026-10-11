import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as core from '../../engine/studio-core.mjs';

const bytes = await fs.readFile(new URL('../../engine/studio-core.wasm', import.meta.url));
const nativePath = process.env.VIENTO_STUDIO_CORE_BIN || fileURLToPath(new URL('../../desktop/.cache/group-authoring-core-target/debug/viento-core', import.meta.url));
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
const add = (content=recipe(),fragmentId='pair') => { const value=typeof content==='string'?parse(content):content;return {protocolVersion:1,operation:'sceneComposition.addFragmentGroup',content:typeof content==='string'?content:serialize(content),fragmentId,group:{key:'extra',name:'Extra / 组🦊',...(fragmentId==='pair'?{parentKey:'sub'}:{})},instances:value.placements.filter(p=>p.fragmentId===fragmentId).map((p,i)=>({placementId:p.placementId,groupId:id(900+i)}))};};
const edit = (content=recipe(),groupKey='sub',name='Renamed',parentKey=null,fragmentId='pair') => ({protocolVersion:1,operation:'sceneComposition.editFragmentGroup',content:typeof content==='string'?content:serialize(content),fragmentId,groupKey,name,parentKey});
const assign = (content=recipe(),actorKey='leader',groupKey='sub',fragmentId='pair') => ({protocolVersion:1,operation:'sceneComposition.assignFragmentActorGroup',content:typeof content==='string'?content:serialize(content),fragmentId,actorKey,groupKey});
const remove = (content=leaf(),groupKey='extra',fragmentId='pair') => ({protocolVersion:1,operation:'sceneComposition.removeFragmentGroup',content:typeof content==='string'?content:serialize(content),fragmentId,groupKey});
function leaf(){const value=recipe();value.fragments[0].groups.push({key:'extra',name:'Empty',parentKey:'sub'});value.placements.forEach((p,i)=>{p.groupIds.extra=id(800+i);});return value;}
const set = () => ({protocolVersion:1,operation:'sceneComposition.patchFragmentActor',content:serialize(recipe()),fragmentId:'pair',actorKey:'leader',values:{speed:10}});
const patch=input=>core.dispatchStudioCoreCompositionGroups(input);
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
  const module = await import(new URL(`../../engine/studio-core.mjs?composition-groups-response=${++bridgeId}`, import.meta.url));
  const memory = new WebAssembly.Memory({ initial: 40 }), instantiate = WebAssembly.instantiate; let inputLength = 0, outputLength = 0;
  try {
    WebAssembly.instantiate = async () => ({ instance: { exports: { memory, viento_core_protocol_version: () => 1,
      viento_core_scene_composition_version: () => 1, viento_core_scene_composition_patch_version: () => 1,
      viento_core_scene_composition_edit_version: () => 1, viento_core_scene_composition_positions_version: () => 1,
      viento_core_scene_composition_fragment_version: () => 1, viento_core_scene_composition_fragment_edit_version: () => 1,
      viento_core_scene_composition_placement_version: () => 1, viento_core_scene_composition_structure_version: () => 1,
      viento_core_scene_composition_placements_version: () => 1,
      ...(feature === null ? {} : { viento_core_scene_composition_groups_version: () => feature }),
      viento_core_input: length => { inputLength = length; return 16; }, viento_core_run: () => {
        const input = JSON.parse(new TextDecoder().decode(new Uint8Array(memory.buffer, 16, inputLength)));
        const value = ['sceneComposition.addFragmentGroup','sceneComposition.editFragmentGroup','sceneComposition.assignFragmentActorGroup','sceneComposition.removeFragmentGroup'].includes(input.operation) ? response : wasm(input);
        const encoded = new TextEncoder().encode(JSON.stringify(value)); outputLength = encoded.length;
        new Uint8Array(memory.buffer, 1048576, encoded.length).set(encoded); return 1048576;
      }, viento_core_output_len: () => outputLength,
    } } }); await module.initializeStudioCore(() => new Uint8Array([1]));
  } finally { WebAssembly.instantiate = instantiate; } return module;
}

test('groups capability is optional without disabling earlier independent composition capabilities',async()=>{
  assert.equal(api.viento_core_scene_composition_groups_version(),1);assert.equal(core.supportsStudioCoreCompositionGroups(),true);
  for(const feature of [null,0,2]){const module=await responseBridge(wasm(add()),feature);assert.equal(module.supportsStudioCoreCompositionGroups(),false);assert.equal(module.supportsStudioCoreCompositionPlacements(),true);assert.equal(module.supportsStudioCoreCompositionPlacement(),true);assert.equal(module.supportsStudioCoreCompositionStructure(),true);assert.throws(()=>module.dispatchStudioCoreCompositionGroups(add()),{errorCode:'studio_core_unavailable'});assert.deepEqual(module.dispatchStudioCoreCompositionFragment(set()),core.dispatchStudioCoreCompositionFragment(set()));assert.equal(module.getStudioCoreMetadata().ready,true);}
});
test('all four group operations are separated from every existing editing domain',()=>{
  for(const dispatcher of [core.dispatchStudioCoreCompositionPatch,core.dispatchStudioCoreCompositionFragment,core.dispatchStudioCoreCompositionPlacement,core.dispatchStudioCoreCompositionPlacements,core.dispatchStudioCoreCompositionStructure,core.dispatchStudioCoreCompositionPositions])for(const request of [add(),edit(),assign(),remove()])assert.throws(()=>dispatcher(request),{errorCode:'studio_core_request_invalid'});
  assert.throws(()=>patch(set()),{errorCode:'studio_core_request_invalid'});assert.equal(core.getStudioCoreMetadata().ready,true);
});
test('ADD atomically appends the declaration and complete source-ordered UUID maps with unchanged actor geometry',()=>{
  const input=add(),result=patch(input),expected=recipe();expected.fragments[0].groups.push(input.group);expected.placements.forEach((p,i)=>{p.groupIds.extra=input.instances[i].groupId;});assert.deepEqual(parse(result.afterContent),expected);assert.deepEqual(result.changedPaths,['/fragments/0/groups/2','/placements/0/groupIds/extra','/placements/1/groupIds/extra']);assert.deepEqual(wasm(input).compositionPatch,result);
  const unused=patch(add(recipe(),'unused'));assert.deepEqual(unused.changedPaths,['/fragments/1/groups/0']);assert.deepEqual(parse(unused.afterContent).placements,recipe().placements);
});
test('EDIT name and parent and ASSIGN actor membership preserve semantic noops byte-for-byte',()=>{
  const raw=serialize(recipe()).replace('"Sub"','"\\u0053ub"').replace('150,','1.50e2,');for(const input of [edit(raw,'sub','Sub','root'),edit(raw,'root','Root',null),assign(raw,'companion','sub')])assert.deepEqual(patch(input),{afterContent:raw,changedPaths:[]});
  const changed=patch(edit(raw));assert.deepEqual(changed.changedPaths,['/fragments/0/groups/1/name','/fragments/0/groups/1/parentKey']);assert.ok(changed.afterContent.includes('1.50e2'));const expected=recipe();expected.fragments[0].groups[1].name='Renamed';delete expected.fragments[0].groups[1].parentKey;assert.deepEqual(parse(changed.afterContent),expected);
  const setGroup=patch(assign());assert.deepEqual(setGroup.changedPaths,['/fragments/0/actors/0/groupKey']);assert.equal(parse(setGroup.afterContent).fragments[0].actors[0].groupKey,'sub');const reset=patch(assign(recipe(),'leader',null));assert.equal(Object.hasOwn(parse(reset.afterContent).fragments[0].actors[0],'groupKey'),false);assert.deepEqual(reset.changedPaths,['/fragments/0/actors/0/groupKey']);assert.deepEqual(patch(assign(reset.afterContent,'leader',null)),{afterContent:reset.afterContent,changedPaths:[]});
});
test('REMOVE requires a raw empty leaf including unused fragments and permits empty groups and UUID maps',()=>{
  const input=remove(),result=patch(input);assert.deepEqual(parse(result.afterContent),recipe());assert.deepEqual(result.changedPaths,['/fragments/0/groups/2','/placements/0/groupIds/extra','/placements/1/groupIds/extra']);for(const key of ['root','sub'])assert.throws(()=>patch(remove(recipe(),key)),{errorCode:'scene_composition_invalid'});
  const last=recipe();last.fragments[0].groups.pop();last.fragments[0].actors.forEach(a=>{delete a.groupKey;});last.placements.forEach(p=>{delete p.groupIds.sub;});const erased=patch(remove(last,'root'));assert.deepEqual(parse(erased.afterContent).fragments[0].groups,[]);assert.ok(parse(erased.afterContent).placements.every(p=>Object.keys(p.groupIds).length===0));
  const unused=recipe();unused.fragments[1].groups=[{key:'extra',name:'Empty'}];assert.deepEqual(patch(remove(unused,'extra','unused')).changedPaths,['/fragments/1/groups/0']);unused.fragments[1].actors[0].groupKey='extra';assert.throws(()=>patch(remove(unused,'extra','unused')),{errorCode:'scene_composition_invalid'});
});
test('exact mappings and all generated identity collisions fail without poisoning a valid core',()=>{
  for(const mutate of [i=>i.instances.pop(),i=>i.instances.reverse(),i=>i.instances.push({placementId:id(999),groupId:id(998)}),i=>{i.instances[0].extra=true;},i=>{i.instances[0].placementId=id(99);},i=>{i.instances[1].groupId=i.instances[0].groupId;},...[id(10),id(11),id(24),'BAD'].map(id=>i=>{i.instances[0].groupId=id;})]){const input=add();mutate(input);assert.throws(()=>patch(input),{errorCode:'scene_composition_invalid'});assert.equal(core.getStudioCoreMetadata().ready,true);}
  const reusable=add();reusable.instances[0].groupId=id(1);assert.equal(parse(patch(reusable).afterContent).placements[0].groupIds.extra,id(1));
});
test('strict operation DTOs references names cycles and hidden JSON code fail closed',()=>{
  for(const input of [{...add(),extra:true},{...edit(),instances:[]},{...assign(),parentKey:null},{...remove(),name:'x'}])assert.throws(()=>patch(input),{errorCode:'studio_core_request_invalid'});
  for(const input of [edit(recipe(),'missing'),edit(recipe(),'root','x','sub'),edit(recipe(),'root','x','root'),edit(recipe(),'sub','x','missing'),edit(recipe(),'root',' '),edit(recipe(),'root','x\n'),edit(recipe(),'root','🦊'.repeat(81)),assign(recipe(),'missing'),assign(recipe(),'leader','missing'),{...add(),group:{key:'extra',name:'x',parentKey:null}},{...add(),group:{key:'root',name:'x'}}])assert.throws(()=>patch(input),{errorCode:'scene_composition_invalid'});
  let calls=0;const getter=add();Object.defineProperty(getter,'instances',{enumerable:true,get(){calls++;return [];}});for(const input of [getter,{...add(),instances:new Array(2)},{...edit(),name:Infinity},{...add(),toJSON(){calls++;return add();}}])assert.throws(()=>patch(input),{errorCode:'studio_core_request_invalid'});assert.equal(calls,0);
});
test('malformed success receipts cannot change any unrequested name parent actor field or path',async()=>{
  const good=wasm(edit());for(const alter of [r=>{r.extra=true;},r=>{r.compositionPatch.extra=true;},r=>{r.compositionPatch.changedPaths=[];},r=>{r.compositionPatch.changedPaths=['/fragments/0/groups/0/name'];},r=>{r.compositionPatch.changedPaths.reverse();},r=>{r.compositionPatch.changedPaths.push(r.compositionPatch.changedPaths[0]);},r=>{const v=parse(r.compositionPatch.afterContent);v.fragments[0].groups[0].name='forged';r.compositionPatch.afterContent=serialize(v);},r=>{const v=parse(r.compositionPatch.afterContent);v.fragments[0].groups[1].parentKey='root';r.compositionPatch.afterContent=serialize(v);},r=>{const v=parse(r.compositionPatch.afterContent);v.fragments[0].actors[0].groupKey='sub';r.compositionPatch.afterContent=serialize(v);},r=>{const v=parse(r.compositionPatch.afterContent);v.placements[1].offset=[1,2];r.compositionPatch.afterContent=serialize(v);}]){const value=structuredClone(good);alter(value);const module=await responseBridge(value);assert.throws(()=>module.dispatchStudioCoreCompositionGroups(edit()),{errorCode:'studio_core_unavailable'});assert.equal(module.getStudioCoreMetadata().ready,false);}
  const raw=serialize(recipe()),noop=wasm(edit(raw,'root','Root',null));noop.compositionPatch.afterContent+=' ';const module=await responseBridge(noop);assert.throws(()=>module.dispatchStudioCoreCompositionGroups(edit(raw,'root','Root',null)),{errorCode:'studio_core_unavailable'});
});
test('whole candidate depth expanded group and final byte budgets permit shrinking edits',()=>{
  let content=serialize(leaf());content+=' '.repeat(131072-Buffer.byteLength(content));const growth=add(content);growth.group.key='growth';assert.throws(()=>patch(growth),{errorCode:'scene_composition_limit'});assert.ok(Buffer.byteLength(patch(remove(content)).afterContent)<131072);assert.ok(Buffer.byteLength(patch(edit(content,'root','R',null)).afterContent)<131072);
  const value=recipe();value.fragments[1].groups=Array.from({length:16},(_,i)=>({key:`g${i}`,name:`G${i}`,...(i?{parentKey:`g${i-1}`}:{})}));const next=add(value,'unused');next.group.parentKey='g15';assert.throws(()=>patch(next),{errorCode:'scene_composition_invalid'});next.group.parentKey='g14';assert.ok(patch(next).afterContent);
  value.fragments[1].groups=Array.from({length:126},(_,i)=>({key:`g${i}`,name:`G${i}`}));assert.throws(()=>patch(add(value,'unused')),{errorCode:'scene_composition_limit'});
});
test('fresh native CLI and WASM agree on all four operations raw noops and independent older domains',{skip:!nativeAvailable},async()=>{
  const unused=recipe();unused.fragments[1].groups=[{key:'extra',name:'Empty'}];const inputs=[add(),add(recipe(),'unused'),edit(),edit(recipe(),'root','Root',null),edit(recipe(),'sub','Sub','root'),assign(),assign(recipe(),'leader',null),remove(),remove(recipe(),'root'),remove(unused,'extra','unused'),{...add(),instances:[]},edit(recipe(),'root','x','sub'),edit(recipe(),'root','x\n'),assign(recipe(),'leader','missing'),{...edit(),extra:true},set(),{protocolVersion:1,operation:'sceneComposition.expand',content:serialize(recipe())},{protocolVersion:1,operation:'sceneComposition.editPlacementOffset',content:serialize(recipe()),placementId:id(10),offset:[0,0]},{protocolVersion:1,operation:'sceneComposition.removePlacement',content:serialize(recipe()),placementId:id(20)}];assert.deepEqual(await nativeSequence(inputs),inputs.map(wasm));
});
