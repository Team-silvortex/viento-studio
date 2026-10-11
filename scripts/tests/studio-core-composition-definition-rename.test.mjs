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
const nativePath = process.env.VIENTO_STUDIO_CORE_BIN || fileURLToPath(new URL('../../desktop/.cache/fragment-rename-core-target/debug/viento-core', import.meta.url));
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
  const module = await import(new URL(`../../engine/studio-core.mjs?composition-definition-rename-response=${++bridgeId}`, import.meta.url));
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
      ...(feature === null ? {} : { viento_core_scene_composition_definition_rename_version: () => feature }),
      viento_core_input: length => { inputLength = length; return 16; }, viento_core_run: () => {
        const input = JSON.parse(new TextDecoder().decode(new Uint8Array(memory.buffer, 16, inputLength)));
        const value = input.operation === 'sceneComposition.renameFragmentDefinition' ? response : wasm(input);
        const encoded = new TextEncoder().encode(JSON.stringify(value)); outputLength = encoded.length;
        new Uint8Array(memory.buffer, 1048576, encoded.length).set(encoded); return 1048576;
      }, viento_core_output_len: () => outputLength,
    } } }); await module.initializeStudioCore(() => new Uint8Array([1]));
  } finally { WebAssembly.instantiate = instantiate; } return module;
}

const rename=(content=recipe(),fragmentId='pair',newFragmentId='renamed')=>({protocolVersion:1,operation:'sceneComposition.renameFragmentDefinition',content:typeof content==='string'?content:serialize(content),fragmentId,newFragmentId});
test('rename capability is independently optional and original definitions and locator remain usable',async()=>{
  assert.equal(api.viento_core_scene_composition_definition_rename_version(),1);assert.equal(core.supportsStudioCoreCompositionDefinitionRename(),true);for(const feature of [null,0,2]){const module=await responseBridge(wasm(rename()),feature);assert.equal(module.supportsStudioCoreCompositionDefinitionRename(),false);assert.equal(module.supportsStudioCoreCompositionDefinitions(),true);assert.throws(()=>module.dispatchStudioCoreCompositionDefinitionRename(rename()),{errorCode:'studio_core_unavailable'});assert.deepEqual(module.dispatchStudioCoreCompositionDefinitions(copy()),core.dispatchStudioCoreCompositionDefinitions(copy()));assert.ok(module.dispatchStudioCoreCompositionDefinitionLocations({protocolVersion:1,operation:'sceneComposition.inspectDefinitionLocations',content:rename().content,paths:['/fragments/0']}).locations[0].exact);assert.equal(module.getStudioCoreMetadata().ready,true);}
  const renameOnly=await responseBridge(wasm(rename()),1,null);assert.equal(renameOnly.supportsStudioCoreCompositionDefinitions(),false);assert.deepEqual(renameOnly.dispatchStudioCoreCompositionDefinitionRename(rename()),patch(rename()));
});
test('rename uses its own dispatch domain and does not widen old definition operations',()=>{
  for(const dispatcher of [core.dispatchStudioCoreCompositionDefinitions,core.dispatchStudioCoreCompositionDefinitionLocations,core.dispatchStudioCoreCompositionPatch,core.dispatchStudioCoreCompositionFragment,core.dispatchStudioCoreCompositionFragmentEdit,core.dispatchStudioCoreCompositionPlacement,core.dispatchStudioCoreCompositionPlacements,core.dispatchStudioCoreCompositionGroups,core.dispatchStudioCoreCompositionStructure,core.dispatchStudioCoreCompositionPositions])assert.throws(()=>dispatcher(rename()),{errorCode:'studio_core_request_invalid'});for(const input of [add(),copy(),remove(),set()])assert.throws(()=>patch(input),{errorCode:'studio_core_request_invalid'});assert.equal(core.getStudioCoreMetadata().ready,true);
});
test('used rename updates all raw refs in source order while keeping scene geometry identities and all local fields',()=>{
  const input=rename(),result=patch(input),expected=recipe();expected.fragments[0].fragmentId='renamed';for(const p of expected.placements)p.fragmentId='renamed';assert.deepEqual(parse(result.afterContent),expected);assert.deepEqual(result.changedPaths,['/fragments/0/fragmentId','/placements/0/fragmentId','/placements/1/fragmentId']);assert.deepEqual(wasm(input).compositionPatch,result);assert.deepEqual(wasm({protocolVersion:1,operation:'sceneComposition.expand',content:input.content}).composition.scene,wasm({protocolVersion:1,operation:'sceneComposition.expand',content:result.afterContent}).composition.scene);
});
test('unused rename and interleaved unrelated refs are preserved and byte no-op is explicit',()=>{
  const input=rename(recipe(),'unused','new_unused'),result=patch(input);assert.equal(result.afterContent,input.content.replace('"unused"','"new_unused"'));assert.deepEqual(result.changedPaths,['/fragments/1/fragmentId']);const raw=serialize(recipe()).replaceAll('"pair"','"p\\u0061ir"');assert.deepEqual(patch(rename(raw,'pair','pair')),{afterContent:raw,changedPaths:[]});const value=recipe();value.placements[1].fragmentId='unused';value.placements[1].actorIds={dormant:id(90)};value.placements[1].groupIds={};delete value.placements[1].overrides;assert.deepEqual(patch(rename(value)).changedPaths,['/fragments/0/fragmentId','/placements/0/fragmentId']);
});
test('escaped identity values and keys preserve BOM CRLF emoji null flag and exponent source tokens',()=>{
  const value=recipe();value.fragments[0].actors[1].imageResourceId=null;const raw=serialize(value).replaceAll('"fragmentId"','"\\u0066ragmentId"').replaceAll('"pair"','"p\\u0061ir"').replace('10.125','1.0125e1');const result=patch(rename(raw));assert.equal(result.afterContent,raw.replaceAll('"p\\u0061ir"','"renamed"'));assert.ok(result.afterContent.includes('1.0125e1')&&result.afterContent.startsWith('\uFEFF')&&result.afterContent.endsWith('\r\n \t'));
});
test('exact bounded local rename requests reject invalid names duplicate identity and unsafe original recipes',()=>{
  for(const input of [rename(recipe(),'missing','new'),rename(recipe(),'pair','unused'),rename(recipe(),'pair',''),rename(recipe(),'pair','1bad'),rename(recipe(),'pair','日本語'),rename(recipe(),'pair','a'.repeat(65)),rename(recipe(),'pair',' new')])assert.throws(()=>patch(input),{errorCode:'scene_composition_invalid'});for(const input of [{...rename(),cascade:true},{...rename(),newFragmentId:undefined},{...rename(),operation:'sceneComposition.renameFragment'}])assert.throws(()=>patch(input),{errorCode:'studio_core_request_invalid'});const unsafe=recipe();unsafe.fragments[1].actors[0].position=[100001,0];assert.throws(()=>patch(rename(unsafe,'pair','pair')),{errorCode:'scene_composition_invalid'});const duplicate=serialize(recipe()).replace('"schemaVersion": 1','"schemaVersion": 1, "schemaVersion": 1');assert.throws(()=>patch(rename(duplicate)),{errorCode:'scene_composition_invalid'});assert.equal(core.getStudioCoreMetadata().ready,true);
});
test('strict bridge snapshots reject accessors serializers hidden and nonfinite values without invoking code',()=>{
  let calls=0;const getter=rename();Object.defineProperty(getter,'newFragmentId',{enumerable:true,get(){calls++;return 'new';}});const hidden=rename();Object.defineProperty(hidden,'hidden',{value:1});for(const input of [getter,hidden,{...rename(),toJSON(){calls++;return rename();}},{...rename(),newFragmentId:Infinity}])assert.throws(()=>patch(input),{errorCode:'studio_core_request_invalid'});assert.equal(calls,0);
});
test('malformed rename receipts wrong refs paths identities and semantic or unrelated lexical changes fail closed',async()=>{
  const input=rename(),good=wasm(input);for(const alter of [r=>{r.extra=true;},r=>{r.compositionPatch.extra=true;},r=>{r.compositionPatch.changedPaths=[];},r=>r.compositionPatch.changedPaths.reverse(),r=>r.compositionPatch.changedPaths.pop(),r=>{r.compositionPatch.afterContent=input.content;},r=>{r.compositionPatch.afterContent+=' ';},r=>{r.compositionPatch.afterContent=r.compositionPatch.afterContent.replace('10.125','1.0125e1');},r=>{r.compositionPatch.afterContent=r.compositionPatch.afterContent.replace('"renamed"','"r\\u0065named"');},r=>{r.compositionPatch.afterContent=r.compositionPatch.afterContent.replace('"Root"','"R\\u006fot"');},r=>{r.compositionPatch.afterContent=r.compositionPatch.afterContent.replace('"renamed"','"wrong"');},r=>{const value=parse(r.compositionPatch.afterContent);value.placements[1].fragmentId='pair';r.compositionPatch.afterContent=serialize(value);},r=>{const value=parse(r.compositionPatch.afterContent);value.placements[1].offset=[1,2];r.compositionPatch.afterContent=serialize(value);},r=>{const value=parse(r.compositionPatch.afterContent);value.fragments[0].actors[0].objectId=id(2);r.compositionPatch.afterContent=serialize(value);}]){const response=structuredClone(good);alter(response);const module=await responseBridge(response);assert.throws(()=>module.dispatchStudioCoreCompositionDefinitionRename(input),{errorCode:'studio_core_unavailable'});assert.equal(module.getStudioCoreMetadata().ready,false);}
  const noop=rename(recipe(),'pair','pair');for(const alter of [r=>{r.compositionPatch.afterContent+=' ';},r=>{r.compositionPatch.changedPaths=['/fragments/0/fragmentId'];}]){const response=wasm(noop);alter(response);const module=await responseBridge(response);assert.throws(()=>module.dispatchStudioCoreCompositionDefinitionRename(noop),{errorCode:'studio_core_unavailable'});}
});
test('final atomic whole source budget rejects longer ID growth but permits shorter rename at exact limit',()=>{
  let raw=serialize(recipe());raw+=' '.repeat(131072-Buffer.byteLength(raw));assert.throws(()=>patch(rename(raw,'pair','longer')),{errorCode:'scene_composition_limit'});const result=patch(rename(raw,'pair','p'));assert.ok(Buffer.byteLength(result.afterContent)<131072);assert.deepEqual(patch(rename(raw,'pair','pair')),{afterContent:raw,changedPaths:[]});assert.throws(()=>patch(rename(raw+' ','pair','p')),{errorCode:'scene_composition_limit'});
});
test('rename leaves live native geometry history and metadata intact',()=>{
  const created=core.dispatchStudioCoreDraft({protocolVersion:1,operation:'layoutDraft.create',actors:[{objectId:'live-layout',position:[10.125,20.25]}]}),metadata=core.getStudioCoreMetadata();try{for(let n=0;n<5;n++){patch(rename());patch(rename(recipe(),'pair','pair'));}assert.deepEqual(core.dispatchStudioCoreDraft({protocolVersion:1,operation:'layoutDraft.read',draftId:created.draftId}),created);assert.deepEqual(core.getStudioCoreMetadata(),metadata);}finally{core.dispatchStudioCoreDraft({protocolVersion:1,operation:'layoutDraft.close',draftId:created.draftId});}
});
test('fresh native CLI and actual WASM agree on rename bytes paths noops errors and prior domains',{skip:!nativeAvailable},async()=>{
  const raw=serialize(recipe()).replaceAll('"fragmentId"','"\\u0066ragmentId"').replaceAll('"pair"','"p\\u0061ir"').replace('10.125','1.0125e1');let full=serialize(recipe());full+=' '.repeat(131072-Buffer.byteLength(full));const input=[rename(),rename(raw),rename(recipe(),'unused','copy_unused'),rename(raw,'pair','pair'),rename(recipe(),'pair','Pair'),rename(recipe(),'missing','new'),rename(recipe(),'pair','unused'),rename(recipe(),'pair','日本語'),{...rename(),extra:true},rename(full,'pair','longer'),rename(full,'pair','p'),add(),copy(),remove(),{protocolVersion:1,operation:'sceneComposition.inspectDefinitionLocations',content:raw,paths:['/fragments/0/fragmentId']},set(),{protocolVersion:1,operation:'sceneComposition.expand',content:raw}];assert.deepEqual(await nativeSequence(input),input.map(wasm));
});
