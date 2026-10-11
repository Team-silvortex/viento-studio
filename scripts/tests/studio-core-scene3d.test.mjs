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
const nativePath = process.env.VIENTO_STUDIO_CORE_BIN || fileURLToPath(new URL('../../desktop/.cache/scene3d-core-target/debug/viento-core', import.meta.url));
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
const patch=input=>core.dispatchStudioCoreCompositionDefinitionRename(input);
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
async function responseBridge(response, feature = 1, definitions = 1) {
  const module = await import(new URL(`../../engine/studio-core.mjs?scene3d-response=${++bridgeId}`, import.meta.url));
  const memory = new WebAssembly.Memory({ initial: 40 }), instantiate = WebAssembly.instantiate; let inputLength = 0, outputLength = 0;
  try {
    WebAssembly.instantiate = async () => ({ instance: { exports: { memory, viento_core_protocol_version: () => 1,
      viento_core_scene_composition_version: () => 1, viento_core_scene_composition_patch_version: () => 1,
      viento_core_scene_composition_edit_version: () => 1, viento_core_scene_composition_positions_version: () => 1,
      viento_core_scene_composition_fragment_version: () => 1, viento_core_scene_composition_fragment_edit_version: () => 1,
      viento_core_scene_composition_placement_version: () => 1, viento_core_scene_composition_structure_version: () => 1,
      viento_core_scene_composition_placements_version: () => 1,
      viento_core_scene_composition_groups_version: () => 1,
      ...(definitions === null ? {} : { viento_core_scene_composition_definitions_version: () => definitions }),
      viento_core_scene_composition_definition_rename_version: () => 1,
      ...(feature === null ? {} : { viento_core_scene3d_version: () => feature }),
      viento_core_input: length => { inputLength = length; return 16; }, viento_core_run: () => {
        const input = JSON.parse(new TextDecoder().decode(new Uint8Array(memory.buffer, 16, inputLength)));
        const value = input.operation === 'scene3d.parse' ? response : wasm(input);
        const encoded = new TextEncoder().encode(JSON.stringify(value)); outputLength = encoded.length;
        new Uint8Array(memory.buffer, 1048576, encoded.length).set(encoded); return 1048576;
      }, viento_core_output_len: () => outputLength,
    } } }); await module.initializeStudioCore(() => new Uint8Array([1]));
  } finally { WebAssembly.instantiate = instantiate; } return module;
}

const rename=(content=recipe(),fragmentId='pair',newFragmentId='renamed')=>({protocolVersion:1,operation:'sceneComposition.renameFragmentDefinition',content:typeof content==='string'?content:serialize(content),fragmentId,newFragmentId});

const sample=()=>({format:'viento-scene3d',schemaVersion:1,name:'Boxes / 箱 / 箱🦊',viewport:[800,600],background:'#0d1829',camera:{position:[8,6,8],target:[0,0,0],fovDegrees:60,near:0.05,far:1000},light:{direction:[-1,-2,-1],color:'#ffffff',energy:1},objects:[{instanceId:id(1),name:'Box / 箱🦊',primitive:'box',position:[0,1,0],rotationDegrees:[23,-41,67],size:[1,2,3],color:'#87d8b9'},{instanceId:id(2),name:'Second',primitive:'box',position:[-2,0.5,1],rotationDegrees:[0,0,0],size:[1,1,1],color:'#FFFFFF'}]});
const input=(content=sample())=>({protocolVersion:1,operation:'scene3d.parse',content:typeof content==='string'?content:serialize(content)});
const scene=request=>core.dispatchStudioCoreScene3D(request);
test('3D capability is independently optional and leaves all prior 2D authoring domains ready',async()=>{
 assert.equal(api.viento_core_scene3d_version(),1);assert.equal(core.supportsStudioCoreScene3D(),true);for(const feature of [null,0,2]){const module=await responseBridge(wasm(input()),feature);assert.equal(module.supportsStudioCoreScene3D(),false);assert.throws(()=>module.dispatchStudioCoreScene3D(input()),{errorCode:'studio_core_unavailable'});assert.equal(module.supportsStudioCoreCompositionPatch(),true);assert.equal(module.supportsStudioCoreCompositionDefinitionRename(),true);assert.deepEqual(module.dispatchStudioCoreCompositionDefinitionRename(rename()),patch(rename()));assert.deepEqual(module.dispatchStudioCoreCompositionDefinitions(copy()),core.dispatchStudioCoreCompositionDefinitions(copy()));assert.equal(module.getStudioCoreMetadata().ready,true);}
});
test('3D operation is not admitted by any legacy dispatch domain and cannot dispatch unrelated authoring ops',()=>{
 for(const dispatcher of [core.dispatchStudioCore,core.dispatchStudioCoreDraft,core.dispatchStudioCoreSource,core.dispatchStudioCoreComposition,core.dispatchStudioCoreCompositionDefinitions,core.dispatchStudioCoreCompositionDefinitionLocations,core.dispatchStudioCoreCompositionDefinitionRename,core.dispatchStudioCoreCompositionGroups,core.dispatchStudioCoreCompositionPlacements,core.dispatchStudioCoreCompositionStructure])assert.throws(()=>dispatcher(input()),{errorCode:'studio_core_request_invalid'});for(const request of [rename(),copy(),set(),{...input(),operation:'scene3d.patch'},{...input(),operation:'scene2d.parse'}])assert.throws(()=>scene(request),{errorCode:'studio_core_request_invalid'});assert.equal(core.getStudioCoreMetadata().ready,true);
});
test('complete strict 3D receipt remains raw authored model data with source-ordered exact object identity locations',()=>{
 const request=input(),result=scene(request);assert.deepEqual(result,wasm(request).scene3d);assert.deepEqual(result.model,{...sample(),format:'viento-scene3d-model'});assert.deepEqual(result.sourceLocations.objects.map(x=>[x.instanceId,x.propertyPath]),[[id(1),'/objects/0'],[id(2),'/objects/1']]);for(const [i,entry] of result.sourceLocations.objects.entries())assert.deepEqual(JSON.parse(request.content.slice(entry.sourceRange.start,entry.sourceRange.end)),sample().objects[i]);
});
test('source ranges match actual host UTF16 CST with BOM CRLF emoji escaped property keys and exponent lexemes',()=>{
 const raw=serialize(sample()).replace('"objects"','"objec\\u0074s"').replaceAll('"instanceId"','"ins\\u0074anceId"').replace('1000','1e3'),indexed=parseJsonSource(raw),result=scene(input(raw));for(const [i,entry] of result.sourceLocations.objects.entries()){const {propertyPath,...sourceRange}=locateJsonSource(indexed,`/objects/${i}`);assert.equal(entry.propertyPath,propertyPath);assert.deepEqual(entry.sourceRange,sourceRange);}assert.ok(result.sourceLocations.objects[0].sourceRange.start<Buffer.byteLength(raw.slice(0,result.sourceLocations.objects[0].sourceRange.start)));
});
test('exact request types prototypes serializers accessors and unknown keys fail without executing user code',()=>{
 let calls=0;const getter=input();Object.defineProperty(getter,'content',{enumerable:true,get(){calls++;return serialize(sample());}});for(const request of [getter,{...input(),toJSON(){calls++;return input();}},{...input(),extra:true},{...input(),content:null},{protocolVersion:1,operation:'scene3d.parse'}])assert.throws(()=>scene(request),{errorCode:'studio_core_request_invalid'});assert.equal(calls,0);assert.equal(core.getStudioCoreMetadata().ready,true);
});
test('malformed success envelopes model schema geometry object IDs identity order and source binding fail closed',async()=>{
 const request=input(),good=wasm(request);for(const change of [r=>{r.extra=true;},r=>{r.scene3d.extra=true;},r=>{r.scene3d.model.extra=true;},r=>{r.scene3d.model.format='viento-scene3d';},r=>{r.scene3d.model.schemaVersion=2;},r=>{r.scene3d.model.viewport=[0,600];},r=>{r.scene3d.model.camera.position=[0,0,0];},r=>{r.scene3d.model.light.direction=[0,1,0];},r=>{r.scene3d.model.objects[0].rotationDegrees=[1,2,3];},r=>{r.scene3d.model.objects[0].size=[0,1,1];},r=>{r.scene3d.model.objects[0].objectId=id(100);},r=>{r.scene3d.model.objects[1].instanceId=id(1);},r=>r.scene3d.model.objects.reverse(),r=>{r.scene3d.model.objects[0].name='unbound';},r=>{r.scene3d.sourceLocations=null;}]){const response=structuredClone(good);change(response);const module=await responseBridge(response);assert.throws(()=>module.dispatchStudioCoreScene3D(request),{errorCode:'studio_core_unavailable'});assert.equal(module.getStudioCoreMetadata().ready,false);}
});
test('all source-location receipt fields and exact whole-object UTF16 ranges are bound without nearest fallback',async()=>{
 const request=input(),good=wasm(request);for(const change of [r=>{r.scene3d.sourceLocations.extra=true;},r=>r.scene3d.sourceLocations.objects.pop(),r=>r.scene3d.sourceLocations.objects.reverse(),r=>{r.scene3d.sourceLocations.objects[0].extra=true;},r=>{r.scene3d.sourceLocations.objects[0].instanceId=id(2);},r=>{r.scene3d.sourceLocations.objects[0].propertyPath='/objects/1';},r=>{r.scene3d.sourceLocations.objects[0].sourceRange.extra=true;},r=>{r.scene3d.sourceLocations.objects[0].sourceRange.start++;},r=>{r.scene3d.sourceLocations.objects[0].sourceRange.start--;},r=>{r.scene3d.sourceLocations.objects[0].sourceRange.end--;},r=>{r.scene3d.sourceLocations.objects[0].sourceRange.end=999999;},r=>{r.scene3d.sourceLocations.objects[0].sourceRange.encoding='utf-8';},r=>{r.scene3d.sourceLocations.objects[0].sourceRange.exact=false;},r=>{r.scene3d.sourceLocations.objects[1].sourceRange=r.scene3d.sourceLocations.objects[0].sourceRange;}]){const response=structuredClone(good);change(response);const module=await responseBridge(response);assert.throws(()=>module.dispatchStudioCoreScene3D(request),{errorCode:'studio_core_unavailable'});assert.equal(module.getStudioCoreMetadata().ready,false);}
});
test('native author failures retain ready state and do not rewrite invalid sources or silently fall back to 2D',()=>{
 for(const alter of [v=>{v.objects=[];},v=>{v.objects[0].primitive='sphere';},v=>{v.objects[0].instanceId='bad';},v=>{v.camera.near=0;},v=>{v.light.direction=[0,0,0];},v=>{v.camera.position=[0,10,0];},v=>{v.objects[0].position=[100001,0,0];}]){const value=sample();alter(value);assert.throws(()=>scene(input(value)),{errorCode:'scene3d_invalid'});assert.equal(core.getStudioCoreMetadata().ready,true);}assert.throws(()=>scene(input(serialize(recipe()))),{errorCode:'scene3d_invalid'});assert.equal(core.getStudioCoreMetadata().ready,true);
});
test('bounded whole-source and object inventories accept limits and reject overflow using UTF8 bytes',()=>{
 let content=serialize(sample());content+=' '.repeat(131072-Buffer.byteLength(content));assert.equal(scene(input(content)).model.objects.length,2);assert.throws(()=>scene(input(content+' ')),{errorCode:'scene3d_limit'});const value=sample(),base=value.objects[0];value.objects=Array.from({length:128},(_,i)=>({...base,instanceId:id(i)}));assert.equal(scene(input(value)).model.objects.length,128);value.objects.push({...base,instanceId:id(128)});assert.throws(()=>scene(input(value)),{errorCode:'scene3d_limit'});
});
test('3D parsing does not mutate active native geometry history or existing core metadata',()=>{
 const created=core.dispatchStudioCoreDraft({protocolVersion:1,operation:'layoutDraft.create',actors:[{objectId:'live-layout',position:[10.125,20.25]}]}),metadata=core.getStudioCoreMetadata();try{for(let n=0;n<5;n++)scene(input());assert.deepEqual(core.dispatchStudioCoreDraft({protocolVersion:1,operation:'layoutDraft.read',draftId:created.draftId}),created);assert.deepEqual(core.getStudioCoreMetadata(),metadata);}finally{core.dispatchStudioCoreDraft({protocolVersion:1,operation:'layoutDraft.close',draftId:created.draftId});}
});
test('actual WASM and fresh native CLI agree on all 3D model range failures budgets and prior domains',{skip:!nativeAvailable},async()=>{
 const variants=[];for(const alter of [v=>{v.camera.position=[0,8,0];},v=>{v.light.direction=[0,1,0];},v=>{v.camera.near=0.0001;},v=>{v.objects[0].size=[0,1,1];},v=>{v.objects[1].instanceId=id(1);},v=>{v.objects[0].primitive='sphere';},v=>{v.viewport=[0,600];},v=>{v.extra=true;}]){const value=sample();alter(value);variants.push(input(value));}let full=serialize(sample());full+=' '.repeat(131072-Buffer.byteLength(full));const raw=serialize(sample()).replace('"objects"','"objec\\u0074s"').replace('1000','1e3');const requests=[input(),input(raw),input(full),input(full+' '),...variants,{...input(),extra:true},input(serialize(sample()).replace('"schemaVersion": 1','"schemaVersion": 1, "schemaVersion": 1')),rename(),copy(),set(),{protocolVersion:1,operation:'sceneComposition.expand',content:serialize(recipe())}];assert.deepEqual(await nativeSequence(requests),requests.map(wasm));
});
