// Independent receipt-authentication fault injection. Fake ABI is limited to forged
// fragment receipts/cap exports; other operations relay to the actual fresh WASM.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { sha } from './boundary-cases.mjs';
const root=fileURLToPath(new URL('../../../',import.meta.url)),e=fileURLToPath(new URL('./',import.meta.url));
assert.equal(process.version,'v24.20.0');
const read=relative=>fs.readFile(path.join(root,relative)),fileSha=async file=>sha(await fs.readFile(file));
const hashes=JSON.parse(await fs.readFile(path.join(e,'source-hashes.json'),'utf8'));
async function frozen(){for(const [file,digest]of Object.entries(hashes))assert.equal(await fileSha(path.join(root,file)),digest,`Source changed: ${file}`);}
await frozen();
const binaryManifest=JSON.parse(await fs.readFile(path.join(e,'native-helpers.json'),'utf8'));
for(const item of binaryManifest.binaries){const bytes=await fs.readFile(item.path);assert.equal(bytes.length,item.bytes);assert.equal(sha(bytes),item.sha256);}
assert.equal(await fileSha(process.execPath),'89af8424dd53e560b1933f87ba650d8bf57c83ca5a04600eefb31f416aabbae7');
const bytes=await read('engine/studio-core.wasm'),{instance}=await WebAssembly.instantiate(bytes,{}),api=instance.exports;
const copy=v=>JSON.parse(JSON.stringify(v)),decode=text=>JSON.parse(text.replace(/^\uFEFF/,''));
const example=JSON.parse(await read('examples/scene-composition/recipe.json'));
const encode=v=>'\uFEFF'+JSON.stringify(v,null,'\t').replaceAll('\n','\r\n')+'\r\n \t';
const request=(content=encode(example),values={color:'#223344',speed:170},actorKey='leader')=>({protocolVersion:1,operation:'sceneComposition.patchFragmentActor',content,fragmentId:'party',actorKey,values});
function wasm(input){const encoded=new TextEncoder().encode(JSON.stringify(input)),pointer=api.viento_core_input(encoded.length)>>>0;
 new Uint8Array(api.memory.buffer,pointer,encoded.length).set(encoded);const output=api.viento_core_run()>>>0,length=api.viento_core_output_len();
 return JSON.parse(new TextDecoder('utf8',{fatal:true}).decode(new Uint8Array(api.memory.buffer,output,length)));}
let sequence=0;
async function faultBridge(response,feature=1){const module=await import(pathToFileURL(path.join(root,`engine/studio-core.mjs`)).href+`?independent-fragment-receipt=${++sequence}`);
 const memory=new WebAssembly.Memory({initial:40}),original=WebAssembly.instantiate;let inputLength=0,outputLength=0;
 try{WebAssembly.instantiate=async()=>({instance:{exports:{memory,viento_core_protocol_version:()=>1,
  viento_core_scene_composition_version:()=>1,viento_core_scene_composition_patch_version:()=>1,viento_core_scene_composition_edit_version:()=>1,
  viento_core_scene_composition_positions_version:()=>1,...(feature===null?{}:{viento_core_scene_composition_fragment_version:()=>feature}),
  viento_core_input:length=>{inputLength=length;return 16;},viento_core_run:()=>{
   const input=JSON.parse(new TextDecoder().decode(new Uint8Array(memory.buffer,16,inputLength))),value=input.operation==='sceneComposition.patchFragmentActor'?response:wasm(input),out=new TextEncoder().encode(JSON.stringify(value));
   outputLength=out.length;new Uint8Array(memory.buffer,1048576,out.length).set(out);return 1048576;
  },viento_core_output_len:()=>outputLength}}});await module.initializeStudioCore(()=>new Uint8Array([1]));
 }finally{WebAssembly.instantiate=original;}return module;}
const checks=[];const input=request();
const attacks=[
 ['sibling-actor-modification',r=>{const v=decode(r.compositionPatch.afterContent);v.fragments[0].actors[1].position[0]++;r.compositionPatch.afterContent=encode(v);}],
 ['placement-override-modification',r=>{const v=decode(r.compositionPatch.afterContent);v.placements[1].overrides[0].values.speed=999;r.compositionPatch.afterContent=encode(v);}],
 ['stable-definition-identity-modification',r=>{const v=decode(r.compositionPatch.afterContent);v.fragments[0].actors[0].objectId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';r.compositionPatch.afterContent=encode(v);}],
 ['changed-path-order-forgery',r=>r.compositionPatch.changedPaths.reverse()],
 ['duplicate-decoded-candidate-key',r=>{r.compositionPatch.afterContent=r.compositionPatch.afterContent.replace('"schemaVersion": 1','"schemaVersion": 1, "schemaVersion": 1');}],
];
for(const [id,alter]of attacks){const response=wasm(input);assert.equal(response.ok,true);alter(response);const module=await faultBridge(response);
 assert.throws(()=>module.dispatchStudioCoreCompositionFragment(input),{errorCode:'studio_core_unavailable'});assert.equal(module.getStudioCoreMetadata().ready,false);
 checks.push({id,ok:true,rejectedOperations:1,failedClosed:true});}
{const noop=request(undefined,{speed:160}),response=wasm(noop);assert.deepEqual(response.compositionPatch.changedPaths,[]);response.compositionPatch.afterContent+=' ';
 const module=await faultBridge(response);assert.throws(()=>module.dispatchStudioCoreCompositionFragment(noop),{errorCode:'studio_core_unavailable'});assert.equal(module.getStudioCoreMetadata().ready,false);
 checks.push({id:'noop-original-byte-forgery',ok:true,rejectedOperations:1,failedClosed:true});}
for(const feature of [null,0,2]){const module=await faultBridge(wasm(input),feature);
 assert.equal(module.supportsStudioCoreCompositionFragment(),false);assert.equal(module.supportsStudioCoreCompositionPatch(),true);
 assert.equal(module.supportsStudioCoreCompositionEdit(),true);assert.equal(module.supportsStudioCoreCompositionPositions(),true);
 assert.throws(()=>module.dispatchStudioCoreCompositionFragment(input),{errorCode:'studio_core_unavailable'});
 const old={protocolVersion:1,operation:'sceneComposition.patchOverrides',content:input.content,placementId:example.placements[1].placementId,actorKey:'leader',values:{speed:9}};
 assert.deepEqual(module.dispatchStudioCoreCompositionPatch(old),wasm(old).compositionPatch);assert.equal(module.getStudioCoreMetadata().ready,true);
 checks.push({id:`independent-cap-${feature===null?'missing':feature}`,ok:true,rejectedOperations:1,oldPatchActuallyExecuted:true});}
async function nativeRequests(inputs){const executable=binaryManifest.binaries.find(item=>item.path.endsWith('/viento-core')).path;
 return new Promise((resolve,reject)=>{let stdout='',stderr='',failure;const child=spawn(executable,[],{stdio:['pipe','pipe','pipe']});
 const timer=setTimeout(()=>{failure=new Error('Bounded native parity timed out');child.kill('SIGKILL');},30000);
 child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');child.stdout.on('data',text=>{stdout+=text;if(Buffer.byteLength(stdout)>16*1024*1024){failure=new Error('Native parity output exceeded budget');child.kill('SIGKILL');}});
 child.stderr.on('data',text=>stderr=(stderr+text).slice(-4096));child.stdin.on('error',error=>failure||=error);
 child.once('error',error=>{clearTimeout(timer);reject(error);});child.once('close',(code,signal)=>{clearTimeout(timer);if(failure)return reject(failure);
  try{assert.equal(code,0,stderr);assert.equal(signal,null);const responses=stdout.trim().split('\n').map(JSON.parse);assert.equal(responses.length,inputs.length);resolve(responses);}catch(error){reject(error);}});
 child.stdin.end(inputs.map(value=>JSON.stringify(value)).join('\n')+'\n');});}
const unused=copy(example);unused.fragments.push({...copy(example.fragments[0]),fragmentId:'unused'});
const bounds=copy(example);for(const actor of bounds.fragments[0].actors)actor.position=[0,0];bounds.placements[1].offset=[99900,0];bounds.placements[1].overrides[0].values.position=[0,0];
const inherited=copy(example);inherited.fragments[0].actors[0].useProjectionDefaults=true;
const inputs=[input,request(undefined,{speed:160}),request(encode(inherited),{imageResourceId:null}),{...request(encode(unused)),fragmentId:'unused'},
 request(encode(bounds),{position:[101,0]},'companion'),request(undefined,{}),request(undefined,{imageResourceId:null}),{...input,resetFields:[]}];
assert.deepEqual(await nativeRequests(inputs),inputs.map(wasm));checks.push({id:'actual-fresh-native-and-raw-wasm-parity',ok:true,requests:inputs.length,noSkip:true});
await frozen();for(const item of binaryManifest.binaries)assert.equal(await fileSha(item.path),item.sha256);
const report={ok:true,recordedAt:new Date().toISOString(),scope:'Independent bridge fault injection for six malformed fragment receipts and three absent/unsupported capability versions. Fake ABI supplies fragment responses/capabilities only; legacy operations relay to actual Rust WASM. Separately eight requests run through the real fresh native core and real raw WASM. No persistence, GUI, build, installed application or device acceptance.',
 runtime:{version:process.version,sha256:await fileSha(process.execPath)},sourceManifest:{files:Object.keys(hashes).length,sha256:await fileSha(path.join(e,'source-hashes.json'))},
 binaryManifestSha256:await fileSha(path.join(e,'native-helpers.json')),binaries:binaryManifest.binaries,wasmSha256:sha(bytes),checks,
 counts:{groups:checks.length,forgedReceipts:attacks.length+1,unsupportedCaps:3,rejectedOperations:checks.reduce((n,x)=>n+(x.rejectedOperations||0),0),actualNativeParityRequests:inputs.length},
 proofSha256:await fileSha(fileURLToPath(import.meta.url)),sourcesAndBinariesStable:true,initialProofCorrection:{log:'boundary-receipt-probe-initial.log',kind:'fixture-identity-collision',explanation:'Initial identity attack accidentally supplied the existing definition UUID and therefore made no identity change; corrected the proof fixture to a different valid UUID. Product sources and binaries unchanged.'}};
await fs.writeFile(path.join(e,'boundary-receipt-probe.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({ok:true,...report.counts}));
