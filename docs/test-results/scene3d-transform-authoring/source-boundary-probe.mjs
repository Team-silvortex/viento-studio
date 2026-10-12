// Independent actual Rust-backed proposal/receipt probe. No files are authored,
// no source save, build, renderer or external engine is invoked.
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import '../../../scripts/adapters/node-studio-core.mjs';
import * as core from '../../../engine/studio-core.mjs';
import { parseScene3DSource } from '../../../engine/scene3d.mjs';
import { createScene3DTransformProposal, isScene3DTransformProposal, prepareScene3DTransformApply } from '../../../engine/scene3d-transform.mjs';
const root=new URL('../../../',import.meta.url), copy=x=>JSON.parse(JSON.stringify(x));
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
const content=await fs.readFile(new URL('examples/scene3d/scene.json',root),'utf8'), original=JSON.parse(content), id=original.objects[1].instanceId;
const bytes=await fs.readFile(new URL('engine/studio-core.wasm',root));
assert.equal(hash(bytes),'8639baa69e67e51c911ef032a9df79e7c10da3662b02d1507fe0bf19192623ba');
const source=(raw=content)=>({sourcePath:'documents/scenes/boxes.json',token:'load:4:draft:7',content:raw,baseSourceRevision:`sha256:${hash(content)}`,sourceRevision:`sha256:${hash(raw)}`});
const digest=async value=>hash(value), change={instanceId:id,values:{position:[5,1.5,0]}};
const request=values=>({protocolVersion:1,operation:'scene3d.patchObjectTransform',content,instanceId:id,values});
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};};
const checks=[];
async function check(name,action){try{await action();checks.push({id:name,ok:true});}catch(error){checks.push({id:name,ok:false,message:error.message});}}
await check('branded-deepfrozen-intent-does-not-borrow-caller-values',async()=>{
 const input=copy(change),p=createScene3DTransformProposal(source(),input);input.values.position[0]=999;assert.equal(p.values.position[0],5);assert(isScene3DTransformProposal(p));assert(Object.isFrozen(p)&&Object.isFrozen(p.values)&&Object.isFrozen(p.values.position)&&Object.isFrozen(p.afterObject));
 const result=await prepareScene3DTransformApply(source(),p,{digest});assert.equal(parseScene3DSource(result.afterContent).model.objects[1].position[0],5);assert.deepEqual(p.changedPaths,['/objects/1/position/0']);
});
await check('serialized-or-copied-proposal-never-conveys-apply-authority',async()=>{
 const p=createScene3DTransformProposal(source(),change);let calls=0;for(const value of [copy(p),{...p},null]){assert(!isScene3DTransformProposal(value));await assert.rejects(prepareScene3DTransformApply(source(),value,{digest:async x=>{calls++;return hash(x);}}),{errorCode:'scene3d_transform_conflict'});}assert.equal(calls,0);
});
await check('semantic-noop-preserves-exponents-negative-zero-whitespace-and-rejects-approval',()=>{
 const raw='\ufeff'+content.replace(/("instanceId":\s*"40000001-1111-4111-8111-111111111111"[\s\S]*?"position"\s*:\s*)\[\s*-2,\s*1\.5,\s*0\s*\]/,'$1[-2.00e0, 1.50, -0e0]').replace(/\n/g,'\r\n');
 assert(raw.includes('-2.00e0'));const r=core.dispatchStudioCoreScene3DPatch({...request({position:[-2,1.5,0]}),content:raw});assert.equal(r.afterContent,raw);assert.deepEqual(r.changedPaths,[]);assert.throws(()=>createScene3DTransformProposal(source(raw),{instanceId:id,values:{position:[-2,1.5,0]}}),{errorCode:'scene3d_transform_unchanged'});
});
await check('wrong-path-token-base-current-or-raw-content-is-rejected-before-digest',async()=>{
 const p=createScene3DTransformProposal(source(),change);let calls=0;
 for(const [field,value] of [['sourcePath','documents/scenes/other.json'],['token','same-path-new-load'],['baseSourceRevision','sha256:'+'a'.repeat(64)],['sourceRevision','sha256:'+'b'.repeat(64)],['content',content+' ']])await assert.rejects(prepareScene3DTransformApply({...source(),[field]:value},p,{digest:async x=>{calls++;return hash(x);}}),{errorCode:'scene3d_transform_conflict'});assert.equal(calls,0);
});
await check('claimed-current-sha-must-match-actual-content-not-only-proposal',async()=>{
 const s={...source(),sourceRevision:'sha256:'+'a'.repeat(64)},p=createScene3DTransformProposal(s,change);await assert.rejects(prepareScene3DTransformApply(s,p,{digest}),{errorCode:'scene3d_transform_conflict'});
});
await check('digest-return-guards-reject-wrong-case-size-type-and-value',async()=>{
 const p=createScene3DTransformProposal(source(),change);for(const result of [hash(content).toUpperCase(),'a'.repeat(63),null,0,'b'.repeat(64)])await assert.rejects(prepareScene3DTransformApply(source(),p,{digest:async()=>result}),{errorCode:'scene3d_transform_conflict'});
});
await check('preawait-source-snapshot-is-detached-and-host-must-recheck-current-owner',async()=>{
 const s=source(),p=createScene3DTransformProposal(s,change),d=deferred();const pending=prepareScene3DTransformApply(s,p,{digest:()=>d.promise});s.content='mutated after await';s.token='new-owner';s.sourcePath='other.json';d.resolve(hash(content));const r=await pending;assert.equal(r.sourcePath,p.sourcePath);assert.equal(r.afterContent,p.afterContent);
});
await check('source-descriptor-accessor-is-rejected-without-running-caller-code',()=>{
 let reads=0;const s=source();Object.defineProperty(s,'token',{get(){reads++;return'fake'},enumerable:true});assert.throws(()=>createScene3DTransformProposal(s,change),{errorCode:'scene3d_transform_invalid'});assert.equal(reads,0);
});
await check('mixed-valid-and-invalid-values-are-atomic-and-do-not-disable-existing-core',()=>{
 assert.throws(()=>core.dispatchStudioCoreScene3DPatch(request({position:[10,1.5,0],size:[1,0,1]})),{errorCode:'studio_core_request_invalid'});assert.equal(core.getStudioCoreMetadata().ready,true);assert.equal(parseScene3DSource(content).model.objects[1].position[0],-2);
});
await check('unrelated-invalid-camera-or-object-prevents-any-target-edit',()=>{
 for(const mutate of [x=>x.camera.target=x.camera.position.slice(),x=>x.objects[2].size[0]=0]){const bad=copy(original);mutate(bad);assert.throws(()=>createScene3DTransformProposal(source(JSON.stringify(bad)),change));}assert.equal(core.getStudioCoreMetadata().ready,true);
});
await check('lexical-edit-keeps-all-nonnumeric-gaps-unrequested-values-and-identities',()=>{
 const raw='\ufeff'+content.replace('"objects"','"objec\\u0074s"').replace('1000','1.000e3').replace('方柱','方柱🦊').replace(/\n/g,'\r\n');const p=createScene3DTransformProposal(source(raw),change),after=JSON.parse(p.afterContent.replace(/^\uFEFF/,'')),expected=JSON.parse(raw.replace(/^\uFEFF/,''));expected.objects[1].position[0]=5;assert.deepEqual(after,expected);assert(p.afterContent.startsWith('\ufeff')&&p.afterContent.includes('\r\n')&&p.afterContent.includes('objec\\u0074s')&&p.afterContent.includes('1.000e3'));
});
const coreText=await fs.readFile(new URL('engine/studio-core.mjs',root),'utf8');
for(const capability of ['absent','unsupported'])await check(`new-edit-capability-${capability}-keeps-actual-old-3d-read-ready`,async()=>{
 const actual=await WebAssembly.instantiate(bytes,{}),exports={...actual.instance.exports};if(capability==='absent')delete exports.viento_core_scene3d_patch_version;else exports.viento_core_scene3d_patch_version=()=>2;
 const context=vm.createContext({TextEncoder,TextDecoder,WebAssembly:{Memory:WebAssembly.Memory,instantiate:async()=>({instance:{exports}})}});
 vm.runInContext(coreText.replace(/^export /gm,'')+'\nglobalThis.api={initializeStudioCore,supportsStudioCoreScene3D,supportsStudioCoreScene3DPatch,dispatchStudioCoreScene3D,dispatchStudioCoreScene3DPatch,getStudioCoreMetadata};',context);
 await context.api.initializeStudioCore(async()=>bytes);assert.equal(context.api.supportsStudioCoreScene3D(),true);assert.equal(context.api.supportsStudioCoreScene3DPatch(),false);assert.equal(context.api.dispatchStudioCoreScene3D({protocolVersion:1,operation:'scene3d.parse',content}).model.objects.length,3);assert.throws(()=>context.api.dispatchStudioCoreScene3DPatch(request({position:[5,1.5,0]})),{errorCode:'studio_core_unavailable'});assert.equal(context.api.getStudioCoreMetadata().ready,true);
});
await check('independent-seven-raw-native-wasm-edit-error-and-noop-receipts-match',async()=>{
 const file=new URL('desktop/.cache/scene3d-transform-core-target/debug/viento-core',root);assert.equal(hash(await fs.readFile(file)),'8ea1ee06f1b8520b2ad219aff0139a6b73200a585c28fb48ec6a20e849485b46');
 const inputs=[request({position:[5,1.5,0]}),request({size:[2,3,4],rotationDegrees:[1,2,3]}),request({position:[-2,1.5,0]}),{...request({position:[0,0,0]}),instanceId:'ffffffff-ffff-4fff-8fff-ffffffffffff'},request({}),request({position:[5,1.5,0],size:[1,0,1]}),JSON.stringify(request({position:[5,1.5,0]})).replace('"values":','"values":{},"values":')];
 const child=spawnSync(file.pathname,[],{input:inputs.map(x=>typeof x==='string'?x:JSON.stringify(x)).join('\n')+'\n',encoding:'utf8',timeout:5000,maxBuffer:1024*1024});assert.equal(child.status,0);assert.equal(child.stderr,'');const native=child.stdout.trim().split('\n').map(JSON.parse);
 const actual=await WebAssembly.instantiate(bytes,{}),ex=actual.instance.exports;
 const wasm=inputs.map(x=>{const b=new TextEncoder().encode(typeof x==='string'?x:JSON.stringify(x)),p=ex.viento_core_input(b.length);new Uint8Array(ex.memory.buffer,p,b.length).set(b);const start=ex.viento_core_run(),len=ex.viento_core_output_len();return JSON.parse(new TextDecoder().decode(new Uint8Array(ex.memory.buffer,start,len)));});assert.deepEqual(native,wasm);assert.equal(native.length,7);
});
const sourceHashes={};for(const name of ['engine/scene3d-transform.mjs','engine/studio-core.mjs','crates/viento-studio-core/src/scene3d_patch.rs','web/modules/app-runtime.js','web/modules/app-studio-system.js'])sourceHashes[name]=hash(await fs.readFile(new URL(name,root)));
const report={format:'viento-scene3d-transform-independent-source-boundary',schemaVersion:1,runtime:process.version,sourceHashes,wasm:{bytes:bytes.length,sha256:hash(bytes)},checks,passed:checks.filter(x=>x.ok).length,failed:checks.filter(x=>!x.ok).length,nativeParityRequests:7,scope:'Actual pure proposal + native-backed module/source checks; two isolated VM capability variants use actual WASM old parser. Detached prepare does not confer permission to write after caller ownership changes. No browser/render/backend tool/save/install/device claim.'};
assert(process.argv[2],'NEW report destination required');await fs.writeFile(process.argv[2],JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(report,null,2));if(report.failed)process.exitCode=1;
