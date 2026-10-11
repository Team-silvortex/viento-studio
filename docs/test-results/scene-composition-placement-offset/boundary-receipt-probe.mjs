// Fake ABI applies only to new placement edit replies/capabilities. Legacy
// requests and separately labelled parity requests use the actual fresh WASM.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath,pathToFileURL } from 'node:url';
import { sha,copy,parse,serialize,request } from './boundary-cases.mjs';
const root=fileURLToPath(new URL('../../../',import.meta.url)),e=fileURLToPath(new URL('./',import.meta.url));
assert.equal(process.version,'v24.20.0');
const fileSha=async file=>sha(await fs.readFile(file)),hashes=JSON.parse(await fs.readFile(path.join(e,'source-hashes.json'),'utf8'));
async function frozen(){for(const [file,digest]of Object.entries(hashes))assert.equal(await fileSha(path.join(root,file)),digest,`Source changed: ${file}`);}
await frozen();const binaryManifest=JSON.parse(await fs.readFile(path.join(e,'native-helpers.json'),'utf8'));
for(const item of binaryManifest.binaries){const bytes=await fs.readFile(item.path);assert.equal(bytes.length,item.bytes);assert.equal(sha(bytes),item.sha256);}
assert.equal(await fileSha(process.execPath),'89af8424dd53e560b1933f87ba650d8bf57c83ca5a04600eefb31f416aabbae7');
const bytes=await fs.readFile(path.join(root,'engine/studio-core.wasm')),{instance}=await WebAssembly.instantiate(bytes,{}),api=instance.exports;
const example=JSON.parse(await fs.readFile(path.join(root,'examples/scene-composition/recipe.json'),'utf8')),content=serialize(example),placementId=example.placements[1].placementId;
function wasm(input){const encoded=new TextEncoder().encode(JSON.stringify(input)),pointer=api.viento_core_input(encoded.length)>>>0;
 new Uint8Array(api.memory.buffer,pointer,encoded.length).set(encoded);const output=api.viento_core_run()>>>0,length=api.viento_core_output_len();
 return JSON.parse(new TextDecoder('utf8',{fatal:true}).decode(new Uint8Array(api.memory.buffer,output,length)));}
let sequence=0;
async function faultBridge(response,feature=1){const module=await import(pathToFileURL(path.join(root,'engine/studio-core.mjs')).href+`?independent-placement-offset-receipt=${++sequence}`);
 const memory=new WebAssembly.Memory({initial:40}),originalInstantiate=WebAssembly.instantiate;let inputLength=0,outputLength=0;
 try{WebAssembly.instantiate=async()=>({instance:{exports:{memory,viento_core_protocol_version:()=>1,
  viento_core_scene_composition_version:()=>1,viento_core_scene_composition_patch_version:()=>1,viento_core_scene_composition_edit_version:()=>1,
  viento_core_scene_composition_positions_version:()=>1,viento_core_scene_composition_fragment_version:()=>1,viento_core_scene_composition_fragment_edit_version:()=>1,
  ...(feature===null?{}:{viento_core_scene_composition_placement_version:()=>feature}),viento_core_input:length=>{inputLength=length;return 16;},
  viento_core_run:()=>{const input=JSON.parse(new TextDecoder().decode(new Uint8Array(memory.buffer,16,inputLength))),value=input.operation==='sceneComposition.editPlacementOffset'?response:wasm(input),out=new TextEncoder().encode(JSON.stringify(value));
   outputLength=out.length;new Uint8Array(memory.buffer,1048576,out.length).set(out);return 1048576;},viento_core_output_len:()=>outputLength}}});
  await module.initializeStudioCore(()=>new Uint8Array([1]));
 }finally{WebAssembly.instantiate=originalInstantiate;}return module;}
const checks=[],input=request(content,placementId,[12.5,-20.25]);
const attacks=[
 ['wrong-offset-coordinate',r=>{const v=parse(r.compositionPatch.afterContent);v.placements[1].offset[0]++;r.compositionPatch.afterContent=serialize(v);}],
 ['set-substituted-by-offset-removal',r=>{const v=parse(r.compositionPatch.afterContent);delete v.placements[1].offset;r.compositionPatch.afterContent=serialize(v);}],
 ['stable-placement-identity-modification',r=>{const v=parse(r.compositionPatch.afterContent);v.placements[1].placementId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';r.compositionPatch.afterContent=serialize(v);}],
 ['actor-identity-remapping',r=>{const v=parse(r.compositionPatch.afterContent);[v.placements[1].actorIds.leader,v.placements[1].actorIds.companion]=[v.placements[1].actorIds.companion,v.placements[1].actorIds.leader];r.compositionPatch.afterContent=serialize(v);}],
 ['organizational-group-remapping',r=>{const v=parse(r.compositionPatch.afterContent);[v.placements[1].groupIds.party,v.placements[1].groupIds.companions]=[v.placements[1].groupIds.companions,v.placements[1].groupIds.party];r.compositionPatch.afterContent=serialize(v);}],
 ['template-position-modification',r=>{const v=parse(r.compositionPatch.afterContent);v.fragments[0].actors[0].position[0]++;r.compositionPatch.afterContent=serialize(v);}],
 ['local-override-position-modification',r=>{const v=parse(r.compositionPatch.afterContent);v.placements[1].overrides[0].values.position[0]++;r.compositionPatch.afterContent=serialize(v);}],
 ['unselected-placement-offset-modification',r=>{const v=parse(r.compositionPatch.afterContent);v.placements[0].offset=[9,9];r.compositionPatch.afterContent=serialize(v);}],
 ['wrong-changed-path-placement',r=>r.compositionPatch.changedPaths=['/placements/0/offset']],
 ['duplicate-changed-path',r=>r.compositionPatch.changedPaths.push(r.compositionPatch.changedPaths[0])],
 ['extra-receipt-key',r=>r.compositionPatch.reset=true],
 ['duplicate-decoded-candidate-key',r=>r.compositionPatch.afterContent=r.compositionPatch.afterContent.replace('"schemaVersion": 1','"schemaVersion": 1, "schemaVersion": 1')],
];
for(const [id,alter]of attacks){const response=wasm(input);assert.equal(response.ok,true);alter(response);const module=await faultBridge(response);
 assert.throws(()=>module.dispatchStudioCoreCompositionPlacement(input),{errorCode:'studio_core_unavailable'});assert.equal(module.getStudioCoreMetadata().ready,false);
 checks.push({id,ok:true,rejectedOperations:1,failedClosed:true});}
{const deleting=request(content,placementId,null),response=wasm(deleting);assert.equal(response.ok,true);const value=parse(response.compositionPatch.afterContent);value.placements[1].offset=[0,0];response.compositionPatch.afterContent=serialize(value);
 const module=await faultBridge(response);assert.throws(()=>module.dispatchStudioCoreCompositionPlacement(deleting),{errorCode:'studio_core_unavailable'});assert.equal(module.getStudioCoreMetadata().ready,false);
 checks.push({id:'delete-substituted-by-explicit-zero-author-declaration',ok:true,rejectedOperations:1,failedClosed:true});}
{const noop=request(content,example.placements[0].placementId,null),response=wasm(noop);assert.deepEqual(response.compositionPatch.changedPaths,[]);response.compositionPatch.afterContent+=' ';
 const module=await faultBridge(response);assert.throws(()=>module.dispatchStudioCoreCompositionPlacement(noop),{errorCode:'studio_core_unavailable'});assert.equal(module.getStudioCoreMetadata().ready,false);
 checks.push({id:'noop-original-byte-forgery',ok:true,rejectedOperations:1,failedClosed:true});}
const oldRequests=[
 ['dispatchStudioCoreCompositionFragment',{protocolVersion:1,operation:'sceneComposition.patchFragmentActor',content,fragmentId:'party',actorKey:'leader',values:{speed:171}}],
 ['dispatchStudioCoreCompositionFragmentEdit',{protocolVersion:1,operation:'sceneComposition.editFragmentActor',content,fragmentId:'party',actorKey:'leader',values:{},reset:['imageResourceId']}],
 ['dispatchStudioCoreCompositionPatch',{protocolVersion:1,operation:'sceneComposition.patchOverrides',content,placementId,actorKey:'leader',values:{speed:172}}],
 ['dispatchStudioCoreCompositionPatch',{protocolVersion:1,operation:'sceneComposition.editOverrides',content,placementId,actorKey:'leader',values:{},resetFields:['color']}],
 ['dispatchStudioCoreCompositionPositions',{protocolVersion:1,operation:'sceneComposition.patchPositions',content,changes:[{placementId:example.placements[0].placementId,actorKey:'leader',position:[125,182]},{placementId,actorKey:'companion',position:[201,180]}]}],
];
for(const feature of [null,0,2]){const module=await faultBridge(wasm(input),feature);
 assert.equal(module.supportsStudioCoreCompositionPlacement(),false);for(const cap of ['supportsStudioCoreCompositionFragment','supportsStudioCoreCompositionFragmentEdit','supportsStudioCoreCompositionPatch','supportsStudioCoreCompositionEdit','supportsStudioCoreCompositionPositions'])assert.equal(module[cap](),true);
 assert.throws(()=>module.dispatchStudioCoreCompositionPlacement(input),{errorCode:'studio_core_unavailable'});
 for(const [dispatch,old]of oldRequests){const actual=wasm(old);assert.equal(actual.ok,true);assert.deepEqual(module[dispatch](old),actual.compositionPatch);}
 assert.equal(module.getStudioCoreMetadata().ready,true);checks.push({id:`independent-cap-${feature===null?'missing':feature}`,ok:true,rejectedOperations:1,oldOperationsActuallyExecuted:oldRequests.length});}
async function nativeRequests(inputs){const executable=binaryManifest.binaries.find(item=>item.path.endsWith('/viento-core')).path;
 return new Promise((resolve,reject)=>{let stdout='',stderr='',failure;const child=spawn(executable,[],{stdio:['pipe','pipe','pipe']});
 const timer=setTimeout(()=>{failure=new Error('Bounded native parity timed out');child.kill('SIGKILL');},30000);
 child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');child.stdout.on('data',text=>{stdout+=text;if(Buffer.byteLength(stdout)>16*1024*1024){failure=new Error('Native parity output exceeded budget');child.kill('SIGKILL');}});
 child.stderr.on('data',text=>stderr=(stderr+text).slice(-4096));child.stdin.on('error',error=>failure||=error);
 child.once('error',error=>{clearTimeout(timer);reject(error);});child.once('close',(code,signal)=>{clearTimeout(timer);if(failure)return reject(failure);
  try{assert.equal(code,0,stderr);assert.equal(signal,null);const responses=stdout.trim().split('\n').map(JSON.parse);assert.equal(responses.length,inputs.length);resolve(responses);}catch(error){reject(error);}});
 child.stdin.end(inputs.map(value=>JSON.stringify(value)).join('\n')+'\n');});}
const atBounds=copy(example);for(const actor of atBounds.fragments[0].actors)actor.position=[0,0];atBounds.fragments[0].actors[1].position=[99990,0];atBounds.placements[1].offset=[0,0];atBounds.placements[1].overrides[0].values.position=[0,0];
const originalInvalid=copy(example);originalInvalid.fragments[0].actors[1].position=[100001,0];
const first=example.placements[0].placementId,inputs=[input,request(content,placementId,null),request(content,first,[0,0]),request(content,first,null),request(content,placementId,[360,80]),
 request(serialize(atBounds),placementId,[10,0]),request(serialize(atBounds),placementId,[11,0]),request(serialize(originalInvalid),placementId,null),request(content,placementId,[0]),
 request(content,placementId,[0,0,0]),request(content,placementId,[100001,0]),request(content,'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',[1,2]),
 request(content,placementId,[1,2],{values:{}}),request(content.replace('"schemaVersion": 1','"schemaVersion": 1, "schemaVersion": 1'),placementId,null),...oldRequests.map(([,old])=>old)];
assert.deepEqual(await nativeRequests(inputs),inputs.map(wasm));checks.push({id:'actual-fresh-native-and-raw-wasm-parity',ok:true,requests:inputs.length,noSkip:true});
await frozen();for(const item of binaryManifest.binaries)assert.equal(await fileSha(item.path),item.sha256);
const report={ok:true,recordedAt:new Date().toISOString(),scope:'Independent bridge fault injection supplies fourteen forged placement-offset receipts and three missing/unsupported placement capabilities. Only new edit replies/caps are faked; five old operations per capability run through real fresh Rust WASM. Separately nineteen bounded requests run through actual fresh native CLI and raw WASM. No live dependency resolution, GUI, author persistence, build, installed application or device acceptance.',
 runtime:{version:process.version,sha256:await fileSha(process.execPath)},sourceManifest:{files:Object.keys(hashes).length,sha256:await fileSha(path.join(e,'source-hashes.json'))},binaryManifestSha256:await fileSha(path.join(e,'native-helpers.json')),
 binaries:binaryManifest.binaries,wasmSha256:sha(bytes),checks,counts:{groups:checks.length,forgedReceipts:attacks.length+2,unsupportedCaps:3,rejectedOperations:checks.reduce((n,x)=>n+(x.rejectedOperations||0),0),
 oldOperationsActuallyExecuted:oldRequests.length*3,actualNativeParityRequests:inputs.length},proofSha256:await fileSha(fileURLToPath(import.meta.url)),sourcesAndBinariesStable:true};
await fs.writeFile(path.join(e,'boundary-receipt-probe.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({ok:true,...report.counts}));
