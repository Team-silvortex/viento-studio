import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const bytes=await fs.readFile(new URL('../../engine/studio-core.wasm',import.meta.url));const {instance}=await WebAssembly.instantiate(bytes,{}),native=instance.exports;
const scene=JSON.parse(await fs.readFile(new URL('../../examples/scene3d/scene.json',import.meta.url),'utf8'));
const field=()=>({center:[0,2,0],extent:[10,5,8],velocity:[-3,2.5,.001],size:[.1,.2,.1],color:'#aBcDeF',count:2,seed:0});
const source=()=> '\ufeff'+JSON.stringify({...scene,name:'Particle receipt 🦊 }'},null,'\t').replaceAll('\n','\r\n')+'\r\n \t';
const prepare=()=>({protocolVersion:1,operation:'scene3d.prepareParticleField',field:field()});
const sample=()=>({...prepare(),operation:'scene3d.sampleParticleField',timeSeconds:.5});
const patch=()=>({protocolVersion:1,operation:'scene3d.patchEnvironment',content:source(),values:{particleField:field(),fog:{color:'#abcdef',density:.125}}});
const parse=content=>({protocolVersion:1,operation:'scene3d.parse',content});
function wasm(input){const data=new TextEncoder().encode(JSON.stringify(input)),at=native.viento_core_input(data.length)>>>0;new Uint8Array(native.memory.buffer,at,data.length).set(data);const out=native.viento_core_run()>>>0;return JSON.parse(new TextDecoder().decode(new Uint8Array(native.memory.buffer,out,native.viento_core_output_len())));}
let seq=0;
async function bridge(reply,version=1,fogVersion=1){const module=await import(new URL('../../engine/studio-core.mjs?particle-response='+ ++seq,import.meta.url)),memory=new WebAssembly.Memory({initial:40}),old=WebAssembly.instantiate;let length=0,outputLength=0;
 try{WebAssembly.instantiate=async()=>({instance:{exports:{memory,viento_core_protocol_version:()=>1,viento_core_scene3d_version:()=>1,viento_core_scene3d_environment_version:()=>1,...(version===null?{}:{viento_core_scene3d_particles_version:()=>version}),...(fogVersion===null?{}:{viento_core_scene3d_fog_version:()=>fogVersion}),viento_core_input:size=>{length=size;return 16;},viento_core_run:()=>{const input=JSON.parse(new TextDecoder().decode(new Uint8Array(memory.buffer,16,length)));const result=reply?reply(input,wasm(input)):wasm(input);const data=new TextEncoder().encode(JSON.stringify(result));outputLength=data.length;new Uint8Array(memory.buffer,1048576,data.length).set(data);return 1048576;},viento_core_output_len:()=>outputLength}}});await module.initializeStudioCore(()=>new Uint8Array([1]));}finally{WebAssembly.instantiate=old;}return module;
}
const mutateParticle = mutate => (input,reply) => {if(input.operation==='scene3d.prepareParticleField'||input.operation==='scene3d.sampleParticleField')mutate(reply);return reply;};
const mutatePatch = mutate => (input,reply) => {if(input.operation==='scene3d.patchEnvironment')mutate(reply.scene3dEnvironmentPatch);return reply;};

test('missing zero and future optional particle probes fail closed without breaking old scene fog or environment operations',async()=>{
 for(const version of [null,0,2]){const m=await bridge(null,version),content=source();assert.equal(m.supportsStudioCoreScene3DParticles(),false);
 assert.throws(()=>m.dispatchStudioCoreScene3DParticles(prepare()),{errorCode:'studio_core_unavailable'});assert.throws(()=>m.dispatchStudioCoreScene3DParticles(sample()),{errorCode:'studio_core_unavailable'});assert.throws(()=>m.dispatchStudioCoreScene3DEnvironmentPatch(patch()),{errorCode:'studio_core_unavailable'});assert.equal(m.getStudioCoreMetadata().ready,true);
 assert.equal(Object.hasOwn(m.dispatchStudioCoreScene3D(parse(content)).model,'particleField'),false);assert.equal(m.dispatchStudioCoreScene3DEnvironmentPatch({...patch(),values:{background:'#123456'}}).afterContent,content.replace(JSON.stringify(scene.background),'"#123456"'));
 assert.ok(m.dispatchStudioCoreScene3DEnvironmentPatch({...patch(),values:{fog:{color:'#ffffff',density:.1}}}).afterContent.includes('"fog"'));}
});
test('particle capability is independent from fog and cannot validate new source fields through an old parse probe',async()=>{
 const m=await bridge(null,1,null);assert.equal(m.supportsStudioCoreScene3DParticles(),true);assert.equal(m.supportsStudioCoreScene3DFog(),false);assert.deepEqual(m.dispatchStudioCoreScene3DParticles(prepare()),wasm(prepare()).scene3dParticles);
 assert.ok(m.dispatchStudioCoreScene3DEnvironmentPatch({...patch(),values:{particleField:field()}}).afterContent.includes('"particleField"'));
 for(const version of [null,0,2]){const old=await bridge(null,version);assert.throws(()=>old.dispatchStudioCoreScene3D(parse(JSON.stringify({...scene,particleField:field()}))),{errorCode:'studio_core_unavailable'});assert.equal(old.getStudioCoreMetadata().ready,false);}
});
test('exact native preparation and sample receipts succeed without replacement',async()=>{
 const m=await bridge(null);assert.deepEqual(m.dispatchStudioCoreScene3DParticles(prepare()),wasm(prepare()).scene3dParticles);assert.deepEqual(m.dispatchStudioCoreScene3DParticles(sample()),wasm(sample()).scene3dParticles);assert.deepEqual(m.dispatchStudioCoreScene3DEnvironmentPatch(patch()),wasm(patch()).scene3dEnvironmentPatch);
});
test('valid-shaped forged phase sequences field parameters counts and precision cannot become prepared packets',async()=>{
 const mutations=[r=>{r.extra=true;},r=>{r.scene3dParticles.extra=true;},r=>{r.scene3dParticles.field.seed=1;},r=>{r.scene3dParticles.field.center[0]=1;},r=>{r.scene3dParticles.phases[0][0]=0;},r=>{r.scene3dParticles.phases.reverse();},r=>{r.scene3dParticles.phases[0][0]=.1;},r=>{r.scene3dParticles.phases[0].push(0);},r=>{r.scene3dParticles.phases.push([0,0,0]);},r=>{r.scene3dParticles.phases=r.scene3dParticles.phases.flat();},r=>{r.scene3dParticles.phases=Array.from({length:4097},()=>[0,0,0]);}];
 for(const mutate of mutations){const m=await bridge(mutateParticle(mutate));assert.throws(()=>m.dispatchStudioCoreScene3DParticles(prepare()),{errorCode:'studio_core_unavailable'});assert.equal(m.getStudioCoreMetadata().ready,false);}
});
test('sample receipt binds exact explicit time all offsets and strict shape',async()=>{
 for(const mutate of [r=>{r.scene3dParticles.timeSeconds=1;},r=>{r.scene3dParticles.offset[0]=.5;},r=>{r.scene3dParticles.offset[0]=1;},r=>{r.scene3dParticles.offset[0]=-.1;},r=>{r.scene3dParticles.offset.push(0);},r=>{r.scene3dParticles.field=field();}]){const m=await bridge(mutateParticle(mutate));assert.throws(()=>m.dispatchStudioCoreScene3DParticles(sample()),{errorCode:'studio_core_unavailable'});}
});
test('mixed insertion requires canonical fog then particle field property order exact number spelling and no old source normalization',async()=>{
 const input=patch(),normal=wasm(input).scene3dEnvironmentPatch.afterContent,pf=',"particleField":'+JSON.stringify(field()),fog=',"fog":{"color":"#abcdef","density":0.125}';
 const forgeries=[normal.replace(fog+pf,pf+fog),normal.replace('"count":2','"count":2e0'),normal.replace('"center":[0,2,0],"extent":[10,5,8]','"extent":[10,5,8],"center":[0,2,0]'),normal.replace('"seed":0','"s\\u0065ed":0'),normal.replace('"#aBcDeF"','"\\u0023aBcDeF"'),normal.replace('"background"','"backgrou\\u006ed"'),normal.replaceAll('\r\n','\n'),normal+' '];
 for(const afterContent of forgeries){assert.notEqual(afterContent,normal);const m=await bridge(mutatePatch(p=>{p.afterContent=afterContent;}));assert.throws(()=>m.dispatchStudioCoreScene3DEnvironmentPatch(input),{errorCode:'studio_core_unavailable'});}
});
test('new field insertion still binds complete changed paths original source and requested semantics',async()=>{
 for(const mutate of [p=>{p.changedPaths=['/particleField','/fog'];},p=>{p.changedPaths=['/fog','/particleField/count'];},p=>{p.beforeContent+=' ';},p=>{p.afterContent=p.afterContent.replace('"count":2','"count":0');},p=>{p.afterContent=p.beforeContent;}]){const m=await bridge(mutatePatch(mutate));assert.throws(()=>m.dispatchStudioCoreScene3DEnvironmentPatch(patch()),{errorCode:'studio_core_unavailable'});}
});
