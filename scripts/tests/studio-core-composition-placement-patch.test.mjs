import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as core from '../../engine/studio-core.mjs';

const bytes = await fs.readFile(new URL('../../engine/studio-core.wasm', import.meta.url));
const nativePath = process.env.VIENTO_STUDIO_CORE_BIN || fileURLToPath(new URL('../../crates/viento-studio-core/target/debug/viento-core', import.meta.url));
let nativeAvailable = true; try { await fs.access(nativePath, constants.X_OK); } catch { nativeAvailable = false; }
const id = n => `${n.toString(16).padStart(8, '0')}-1111-4111-8111-111111111111`;
const serialize = value => '\uFEFF' + JSON.stringify(value, null, '\t').replaceAll('\n', '\r\n') + '\r\n \t';
const parse = content => JSON.parse(content.replace(/^\uFEFF/, ''));
function recipe() {
  return { format: 'viento-scene-composition', schemaVersion: 1,
    scene: { title: '共有 / Shared / 配方🦊', viewport: [640, 480], background: '#112233' },
    fragments: [{ fragmentId: 'pair', groups: [], actors: [
      { key: 'leader', objectId: id(1), position: [10, 20], size: [32, 48], color: '#ffffff', speed: 150, controls: 'arrows' },
      { key: 'companion', objectId: id(1), position: [30, 40], useProjectionDefaults: true },
    ] }], placements: [
      { placementId: id(10), fragmentId: 'pair', actorIds: { leader: id(11), companion: id(12) }, groupIds: {} },
      { placementId: id(20), fragmentId: 'pair', actorIds: { leader: id(21), companion: id(22) }, groupIds: {}, offset: [300, 80],
        overrides: [{ actorKey: 'leader', values: { position: [111, 222], speed: 18.25 } }] },
    ] };
}
const setRequest = (content = recipe(), values = { position: [12, 22], speed: 160 }, actorKey = 'leader', fragmentId = 'pair') => ({
  protocolVersion: 1, operation: 'sceneComposition.patchFragmentActor', content: typeof content === 'string' ? content : serialize(content), fragmentId, actorKey, values });
const patch = input => core.dispatchStudioCoreCompositionPlacement(input);
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
    const timer = setTimeout(() => { failure = new Error('Native fragment parity timed out'); child.kill('SIGKILL'); }, 30000);
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', text => { stdout += text; if (Buffer.byteLength(stdout) > 16 * 1024 * 1024) { failure = new Error('Native output budget exceeded'); child.kill('SIGKILL'); } });
    child.stderr.on('data', text => { stderr = (stderr + text).slice(-4096); });
    child.stdin.on('error', error => { failure ||= error; });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', (code, signal) => {
      clearTimeout(timer); if (failure) return reject(failure);
      try { assert.equal(signal, null); assert.equal(code, 0, stderr); const outputs = stdout.trim().split('\n').map(JSON.parse); assert.equal(outputs.length, inputs.length); resolve(outputs); } catch (error) { reject(error); }
    });
    child.stdin.end(inputs.map(input => JSON.stringify(input)).join('\n') + '\n');
  });
}
let bridgeId = 0;
async function responseBridge(response, feature = 1) {
  const module = await import(new URL(`../../engine/studio-core.mjs?composition-placement-response=${++bridgeId}`, import.meta.url));
  const memory = new WebAssembly.Memory({ initial: 40 }), instantiate = WebAssembly.instantiate; let inputLength = 0, outputLength = 0;
  try {
    WebAssembly.instantiate = async () => ({ instance: { exports: { memory, viento_core_protocol_version: () => 1,
      viento_core_scene_composition_version: () => 1, viento_core_scene_composition_patch_version: () => 1,
      viento_core_scene_composition_edit_version: () => 1, viento_core_scene_composition_positions_version: () => 1,
      viento_core_scene_composition_fragment_version: () => 1, viento_core_scene_composition_fragment_edit_version: () => 1,
      ...(feature === null ? {} : { viento_core_scene_composition_placement_version: () => feature }),
      viento_core_input: length => { inputLength = length; return 16; },
      viento_core_run: () => {
        const input = JSON.parse(new TextDecoder().decode(new Uint8Array(memory.buffer, 16, inputLength)));
        const value = input.operation === 'sceneComposition.editPlacementOffset' ? response : wasm(input);
        const encoded = new TextEncoder().encode(JSON.stringify(value)); outputLength = encoded.length;
        new Uint8Array(memory.buffer, 1048576, encoded.length).set(encoded); return 1048576;
      }, viento_core_output_len: () => outputLength,
    } } }); await module.initializeStudioCore(() => new Uint8Array([1]));
  } finally { WebAssembly.instantiate = instantiate; } return module;
}

const request = (content = recipe(), offset = [12.5, -30.25], placementId = id(20)) => ({ protocolVersion: 1,
  operation: 'sceneComposition.editPlacementOffset', content: typeof content === 'string' ? content : serialize(content), placementId, offset });

test('placement offset capability is optional independently of all existing actor and fragment domains', async () => {
  assert.equal(api.viento_core_scene_composition_placement_version(),1); assert.equal(core.supportsStudioCoreCompositionPlacement(),true);
  for (const feature of [null,0,2]) {
    const module=await responseBridge(wasm(request()),feature);
    assert.equal(module.supportsStudioCoreCompositionPlacement(),false); assert.equal(module.supportsStudioCoreCompositionFragmentEdit(),true);
    assert.equal(module.supportsStudioCoreCompositionPatch(),true); assert.equal(module.supportsStudioCoreCompositionPositions(),true);
    assert.throws(()=>module.dispatchStudioCoreCompositionPlacement(request()),{errorCode:'studio_core_unavailable'});
    assert.deepEqual(module.dispatchStudioCoreCompositionFragment(setRequest()),core.dispatchStudioCoreCompositionFragment(setRequest()));
    assert.equal(module.getStudioCoreMetadata().ready,true);
  }
});

test('cross-domain operations are rejected before any source or geometry mutation', () => {
  assert.throws(()=>core.dispatchStudioCoreCompositionFragment(request()),{errorCode:'studio_core_request_invalid'});
  assert.throws(()=>core.dispatchStudioCoreCompositionFragmentEdit(request()),{errorCode:'studio_core_request_invalid'});
  assert.throws(()=>core.dispatchStudioCoreCompositionPatch(request()),{errorCode:'studio_core_request_invalid'});
  assert.throws(()=>core.dispatchStudioCoreCompositionPlacement(setRequest()),{errorCode:'studio_core_request_invalid'});
  assert.equal(core.getStudioCoreMetadata().ready,true);assert.ok(patch(request()).changedPaths.length);
});

test('SET and RESET affect exactly one author offset and all its final actors including local overrides', () => {
  const input=request(),result=patch(input),expected=recipe();expected.placements[1].offset=input.offset;
  assert.deepEqual(parse(result.afterContent),expected);assert.deepEqual(result.changedPaths,['/placements/1/offset']);
  assert.deepEqual(wasm(input).compositionPatch,result);
  const expanded=wasm({protocolVersion:1,operation:'sceneComposition.expand',content:result.afterContent}).composition.scene;
  assert.deepEqual(expanded.actors[2].position,[123.5,191.75]);assert.deepEqual(expanded.actors[3].position,[42.5,9.75]);
  const reset=patch(request(result.afterContent,null));assert.equal(Object.hasOwn(parse(reset.afterContent).placements[1],'offset'),false);
  assert.deepEqual(parse(reset.afterContent).fragments,recipe().fragments);assert.deepEqual(parse(reset.afterContent).placements[1].overrides,recipe().placements[1].overrides);
});

test('missing versus explicit zero is preserved across SET RESET and semantic no-op receipts', () => {
  const missing=request(recipe(),null,id(10));assert.deepEqual(patch(missing),{afterContent:missing.content,changedPaths:[]});
  const zero=patch(request(recipe(),[0,0],id(10)));assert.deepEqual(zero.changedPaths,['/placements/0/offset']);
  assert.deepEqual(patch(request(zero.afterContent,[-0,0],id(10))),{afterContent:zero.afterContent,changedPaths:[]});
  const reset=patch(request(zero.afterContent,null,id(10)));assert.deepEqual(reset.changedPaths,['/placements/0/offset']);
  assert.equal(Object.hasOwn(parse(reset.afterContent).placements[0],'offset'),false);
});

test('pair edits preserve BOM CRLF escaped decoded keys original exponent axis and unrelated tokens', () => {
  const raw=serialize(recipe()).replace('"offset"','"offs\\u0065t"').replace('300,','3.00e2,').replace('80\r','8.000e1\r');
  assert.deepEqual(patch(request(raw,[300,80])),{afterContent:raw,changedPaths:[]});
  const result=patch(request(raw,[301.25,80]));assert.equal(result.afterContent,raw.replace('3.00e2','301.25'));
});

test('invalid pair intents identities extra request members and accessor arrays reject without poisoning later valid calls', () => {
  for (const offset of [false,{},[],[1],[1,2,3],['1',2],[null,0],[NaN,0],[Infinity,0],[100001,0],[0,-100001],new Array(2)]) {
    assert.throws(()=>patch(request(recipe(),offset)));assert.equal(core.getStudioCoreMetadata().ready,true);
  }
  for (const extra of [{values:{}},{unknown:true}])assert.throws(()=>patch({...request(),...extra}),{errorCode:'studio_core_request_invalid'});
  assert.throws(()=>patch(request(recipe(),[1,2],id(99))),{errorCode:'scene_composition_invalid'});
  let reads=0;const input=request();Object.defineProperty(input.offset,'0',{enumerable:true,get(){reads++;return 1;}});
  assert.throws(()=>patch(input),{errorCode:'studio_core_request_invalid'});assert.equal(reads,0);assert.ok(patch(request()).changedPaths.length);
});

test('full original and candidate expansion rejects invalid unused fragments duplicates and any final actor bounds', () => {
  const value=recipe();value.placements[1].overrides[0].values.position=[0,0];
  assert.throws(()=>patch(request(value,[99980,0])),{errorCode:'scene_composition_invalid'});assert.ok(patch(request(value,[99970,0])).changedPaths.length);
  value.placements[1].offset=[99990,0];assert.throws(()=>patch(request(value,null)),{errorCode:'scene_composition_invalid'});
  const raw=serialize(recipe()),duplicate=raw.replace('"schemaVersion": 1','"schemaVersion": 1, "schema\\u0056ersion": 1');
  assert.throws(()=>patch(request(duplicate,null)),{errorCode:'scene_composition_invalid'});
  const bad=recipe(),unused=structuredClone(bad.fragments[0]);unused.fragmentId='unused';unused.actors[0].controls='bad';bad.fragments.push(unused);
  assert.throws(()=>patch(request(bad,null)),{errorCode:'scene_composition_invalid'});assert.equal(core.getStudioCoreMetadata().ready,true);
});

test('complete UTF-8 budgets permit shrink reset and exact-limit noops but reject new declaration growth', () => {
  const prefix=serialize(recipe()),raw=prefix+' '.repeat(128*1024-Buffer.byteLength(prefix));
  assert.throws(()=>patch(request(raw,[0,0],id(10))),{errorCode:'scene_composition_limit'});
  assert.throws(()=>patch(request(raw,[30000,8000])),{errorCode:'scene_composition_limit'});
  assert.equal(patch(request(raw,[300,80])).afterContent,raw);assert.ok(Buffer.byteLength(patch(request(raw,null)).afterContent)<128*1024);
  assert.throws(()=>patch(request(raw+' ',null)),{errorCode:'scene_composition_limit'});
});

test('forged placement receipts cannot alter templates local overrides stable identities or path ordering', async () => {
  const input=request();
  for (const corrupt of [r=>{r.compositionPatch.changedPaths=[];},r=>{r.compositionPatch.changedPaths.push('/placements/1/offset');},r=>{r.compositionPatch.changedPaths=['/placements/0/offset'];},
    r=>{r.compositionPatch.afterContent=input.content;},r=>{r.compositionPatch.extra=true;},r=>{r.extra=true;},
    r=>{const value=parse(r.compositionPatch.afterContent);value.fragments[0].actors[0].speed=0;r.compositionPatch.afterContent=serialize(value);},
    r=>{const value=parse(r.compositionPatch.afterContent);value.placements[1].overrides[0].values.position=[0,0];r.compositionPatch.afterContent=serialize(value);},
    r=>{const value=parse(r.compositionPatch.afterContent);value.placements[0].offset=[1,2];r.compositionPatch.afterContent=serialize(value);},
    r=>{const value=parse(r.compositionPatch.afterContent);value.placements[1].actorIds.leader=id(99);r.compositionPatch.afterContent=serialize(value);},
    r=>{r.compositionPatch.afterContent=r.compositionPatch.afterContent.replace('"offset": [','"offset": [0,0], "offs\\u0065t": [');},
  ]) {
    const response=wasm(input);corrupt(response);const module=await responseBridge(response);
    assert.throws(()=>module.dispatchStudioCoreCompositionPlacement(input),{errorCode:'studio_core_unavailable'});assert.equal(module.getStudioCoreMetadata().ready,false);
  }
});

test('strict post-expansion rejects even semantically matching forged patches of invalid recipes', async () => {
  const value=recipe();value.placements[1].overrides[0].values.position=[0,0];const input=request(value,[99980,0]),after=structuredClone(value);after.placements[1].offset=input.offset;
  const module=await responseBridge({protocolVersion:1,ok:true,compositionPatch:{afterContent:serialize(after),changedPaths:['/placements/1/offset']}});
  assert.throws(()=>module.dispatchStudioCoreCompositionPlacement(input),{errorCode:'studio_core_unavailable'});
  const raw=serialize(recipe()).replace('"offset": [','"offset": [0,0], "offs\\u0065t": ['),duplicate=request(raw,[1,2]);
  const final=recipe();final.placements[1].offset=[1,2];const other=await responseBridge({protocolVersion:1,ok:true,compositionPatch:{afterContent:serialize(final),changedPaths:['/placements/1/offset']}});
  assert.throws(()=>other.dispatchStudioCoreCompositionPlacement(duplicate),{errorCode:'studio_core_unavailable'});
});

test('native CLI and real WASM match exact bytes receipts noops limits and failures for placement offsets', {skip:!nativeAvailable}, async () => {
  const raw=serialize(recipe()).replace('"offset"','"offs\\u0065t"').replace('300,','3.00e2,'),zero=patch(request(recipe(),[0,0],id(10))).afterContent;
  const prefix=serialize(recipe()),budget=prefix+' '.repeat(128*1024-Buffer.byteLength(prefix));
  const inputs=[request(),request(recipe(),null),request(recipe(),null,id(10)),request(recipe(),[0,0],id(10)),request(zero,null,id(10)),
    request(zero,[0,0],id(10)),request(raw,[301.5,80]),request(raw,[300,80]),request(recipe(),[100001,0]),request(recipe(),[99980,0]),
    request(recipe(),[1,2],id(99)),{...request(),extra:true},request(budget,[0,0],id(10)),request(budget,null),request(budget+' ',null)];
  assert.deepEqual(await nativeSequence(inputs),inputs.map(wasm));
});
