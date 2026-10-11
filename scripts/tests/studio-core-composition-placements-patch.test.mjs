import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as core from '../../engine/studio-core.mjs';

const bytes = await fs.readFile(new URL('../../engine/studio-core.wasm', import.meta.url));
const nativePath = process.env.VIENTO_STUDIO_CORE_BIN || fileURLToPath(new URL('../../desktop/.cache/placement-structure-core-target/debug/viento-core', import.meta.url));
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
const add = (content=recipe()) => ({protocolVersion:1,operation:'sceneComposition.addPlacement',content:typeof content==='string'?content:serialize(content),fragmentId:'pair',placementId:id(900),actorIds:{leader:id(901),companion:id(902)},groupIds:{root:id(903),sub:id(904)}});
const copy = (content=recipe(),index=1) => {const value=typeof content==='string'?parse(content):content,{fragmentId,...input}=add(content);return {...input,operation:'sceneComposition.copyPlacement',sourcePlacementId:value.placements[index].placementId};};
const remove = (content=recipe(),index=0) => {const value=typeof content==='string'?parse(content):content;return {protocolVersion:1,operation:'sceneComposition.removePlacement',content:typeof content==='string'?content:serialize(content),placementId:value.placements[index].placementId};};
const set = () => ({protocolVersion:1,operation:'sceneComposition.patchFragmentActor',content:serialize(recipe()),fragmentId:'pair',actorKey:'leader',values:{speed:10}});
const patch=input=>core.dispatchStudioCoreCompositionPlacements(input);
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
  const module = await import(new URL(`../../engine/studio-core.mjs?composition-placements-response=${++bridgeId}`, import.meta.url));
  const memory = new WebAssembly.Memory({ initial: 40 }), instantiate = WebAssembly.instantiate; let inputLength = 0, outputLength = 0;
  try {
    WebAssembly.instantiate = async () => ({ instance: { exports: { memory, viento_core_protocol_version: () => 1,
      viento_core_scene_composition_version: () => 1, viento_core_scene_composition_patch_version: () => 1,
      viento_core_scene_composition_edit_version: () => 1, viento_core_scene_composition_positions_version: () => 1,
      viento_core_scene_composition_fragment_version: () => 1, viento_core_scene_composition_fragment_edit_version: () => 1,
      viento_core_scene_composition_placement_version: () => 1, viento_core_scene_composition_structure_version: () => 1,
      ...(feature === null ? {} : { viento_core_scene_composition_placements_version: () => feature }),
      viento_core_input: length => { inputLength = length; return 16; }, viento_core_run: () => {
        const input = JSON.parse(new TextDecoder().decode(new Uint8Array(memory.buffer, 16, inputLength)));
        const value = ['sceneComposition.addPlacement','sceneComposition.copyPlacement','sceneComposition.removePlacement'].includes(input.operation) ? response : wasm(input);
        const encoded = new TextEncoder().encode(JSON.stringify(value)); outputLength = encoded.length;
        new Uint8Array(memory.buffer, 1048576, encoded.length).set(encoded); return 1048576;
      }, viento_core_output_len: () => outputLength,
    } } }); await module.initializeStudioCore(() => new Uint8Array([1]));
  } finally { WebAssembly.instantiate = instantiate; } return module;
}


test('placement structure capability is optional without disabling existing offset fragment or shared structure domains',async()=>{
  assert.equal(api.viento_core_scene_composition_placements_version(),1);assert.equal(core.supportsStudioCoreCompositionPlacements(),true);
  for(const feature of [null,0,2]){const module=await responseBridge(wasm(add()),feature);assert.equal(module.supportsStudioCoreCompositionPlacements(),false);assert.equal(module.supportsStudioCoreCompositionPlacement(),true);assert.equal(module.supportsStudioCoreCompositionStructure(),true);assert.throws(()=>module.dispatchStudioCoreCompositionPlacements(add()),{errorCode:'studio_core_unavailable'});assert.deepEqual(module.dispatchStudioCoreCompositionFragment(set()),core.dispatchStudioCoreCompositionFragment(set()));assert.equal(module.getStudioCoreMetadata().ready,true);}
});
test('all three placement operations remain separated from existing composition operations',()=>{
  for(const dispatcher of [core.dispatchStudioCoreCompositionPatch,core.dispatchStudioCoreCompositionFragment,core.dispatchStudioCoreCompositionPlacement,core.dispatchStudioCoreCompositionStructure,core.dispatchStudioCoreCompositionPositions])for(const request of [add(),copy(),remove()])assert.throws(()=>dispatcher(request),{errorCode:'studio_core_request_invalid'});
  assert.throws(()=>patch(set()),{errorCode:'studio_core_request_invalid'});assert.equal(core.getStudioCoreMetadata().ready,true);
});
test('ADD and COPY return exact one-item paths complete IDs and unchanged nonplacement source',()=>{
  for(const input of [add(),{...add(),offset:[0,0]},copy()]){const result=patch(input),expected=recipe();const placement=input.operation==='sceneComposition.copyPlacement'?structuredClone(expected.placements[1]):{fragmentId:'pair'};Object.assign(placement,{placementId:input.placementId,actorIds:input.actorIds,groupIds:input.groupIds});if(Object.hasOwn(input,'offset'))placement.offset=input.offset;expected.placements.push(placement);assert.deepEqual(parse(result.afterContent),expected);assert.deepEqual(result.changedPaths,['/placements/2']);assert.deepEqual(wasm(input).compositionPatch,result);}
});
test('copy only replaces identity tokens while preserving exact null exponent spellings declarations order and old bytes',()=>{
  const value=recipe();value.placements[1].overrides=[{actorKey:'companion',values:{imageResourceId:null,controls:'none',speed:18.25,color:'#abcdef',size:[32,48],position:[111,222]}}];const raw=serialize(value).replace('18.25','1.825e1').replace('300,','3.00e2,');const result=patch(copy(raw)),original=raw.slice(raw.lastIndexOf('"placementId"')-6,raw.lastIndexOf('"placementId"')+50);assert.equal((result.afterContent.match(/1\.825e1/g)||[]).length,2);assert.equal((result.afterContent.match(/3\.00e2/g)||[]).length,2);assert.ok(result.afterContent.startsWith('\uFEFF'));assert.ok(result.afterContent.endsWith('\r\n \t'));assert.deepEqual(parse(result.afterContent).placements[2].overrides,value.placements[1].overrides);assert.ok(result.afterContent.includes(original));
});
test('REMOVE clears the whole placement retains fragment bytes and cannot remove last or absent placement',()=>{
  const good=recipe();for(const index of [0,1]){const result=patch(remove(good,index)),expected=structuredClone(good);expected.placements.splice(index,1);assert.deepEqual(parse(result.afterContent),expected);assert.deepEqual(result.changedPaths,[`/placements/${index}`]);assert.deepEqual(wasm(remove(good,index)).compositionPatch,result);}good.placements.pop();assert.throws(()=>patch(remove(good)),{errorCode:'scene_composition_invalid'});assert.throws(()=>patch({...remove(),placementId:id(99)}),{errorCode:'scene_composition_invalid'});
});
test('Rust validates exact action DTO maps all old and new identity collisions and candidate world bounds',()=>{
  for(const mutate of [i=>{i.fragmentId='missing';},i=>{delete i.actorIds.companion;},i=>{i.groupIds.extra=id(999);},i=>{i.actorIds.leader=i.actorIds.companion;},i=>{i.actorIds.leader=i.groupIds.sub;},i=>{i.actorIds.leader=i.placementId;},i=>{i.placementId=id(10);},i=>{i.actorIds.leader=id(24);},i=>{i.offset=[100000,0];},i=>{i.offset=null;}]){const input=add();mutate(input);assert.throws(()=>patch(input),{errorCode:'scene_composition_invalid'});assert.equal(core.getStudioCoreMetadata().ready,true);}
  for(const input of [{...add(),overrides:[]},{...copy(),offset:[0,0]},{...copy(),fragmentId:'pair'},{...remove(),groupIds:{}}])assert.throws(()=>patch(input),{errorCode:'studio_core_request_invalid'});assert.throws(()=>patch({...copy(),sourcePlacementId:id(999)}),{errorCode:'scene_composition_invalid'});
});
test('strict bridge snapshots reject accessors nonfinite sparse and custom JSON request values without executing code',()=>{
  let calls=0;const getter=add();Object.defineProperty(getter,'actorIds',{enumerable:true,get(){calls++;return add().actorIds;}});assert.throws(()=>patch(getter),{errorCode:'studio_core_request_invalid'});assert.equal(calls,0);for(const input of [{...add(),offset:[,0]},{...add(),offset:[Infinity,0]},{...add(),toJSON(){calls++;return add();}}])assert.throws(()=>patch(input),{errorCode:'studio_core_request_invalid'});assert.equal(calls,0);assert.ok(patch(add()).afterContent);
});
test('malformed success receipts fail closed on path candidate extra fields and incomplete identity declarations',async()=>{
  const good=wasm(copy());for(const alter of [r=>{r.compositionPatch.changedPaths=[];},r=>{r.compositionPatch.changedPaths=['/placements/0'];},r=>{r.compositionPatch.changedPaths.push('/placements/2');},r=>{r.compositionPatch.extra=true;},r=>{r.extra=true;},r=>{const value=parse(r.compositionPatch.afterContent);value.placements[0].offset=[1,2];r.compositionPatch.afterContent=serialize(value);},r=>{const value=parse(r.compositionPatch.afterContent);delete value.placements[2].actorIds.companion;r.compositionPatch.afterContent=serialize(value);},r=>{const value=parse(r.compositionPatch.afterContent);value.placements[2].overrides=[];r.compositionPatch.afterContent=serialize(value);}]){const result=structuredClone(good);alter(result);const module=await responseBridge(result);assert.throws(()=>module.dispatchStudioCoreCompositionPlacements(copy()),{errorCode:'studio_core_unavailable'});assert.equal(module.getStudioCoreMetadata().ready,false);}
});
test('final source and aggregate actor group budgets are validated while shrinking delete remains available',()=>{
  let content=serialize(recipe());content+=' '.repeat(128*1024-Buffer.byteLength(content));assert.throws(()=>patch(copy(content)),{errorCode:'scene_composition_limit'});assert.ok(Buffer.byteLength(patch(remove(content)).afterContent)<128*1024);
  const value=recipe();value.fragments.pop();value.placements=Array.from({length:64},(_,i)=>({placementId:id(1000+i*5),fragmentId:'pair',actorIds:{leader:id(1001+i*5),companion:id(1002+i*5)},groupIds:{root:id(1003+i*5),sub:id(1004+i*5)}}));assert.throws(()=>patch(add(value)),{errorCode:'scene_composition_limit'});assert.ok(patch(remove(value)).afterContent);
});
test('fresh native CLI and WASM produce identical complete success errors and bytes for new and existing domains',{skip:!nativeAvailable},async()=>{
  const value=recipe();value.placements.pop();const inputs=[add(),{...add(),offset:[0,0]},copy(),copy(recipe(),0),remove(),remove(recipe(),1),remove(value),{...copy(),sourcePlacementId:id(999)},{...add(),overrides:[]},{...add(),offset:[100000,0]},set(),{protocolVersion:1,operation:'sceneComposition.expand',content:serialize(recipe())}];assert.deepEqual(await nativeSequence(inputs),inputs.map(wasm));
});
