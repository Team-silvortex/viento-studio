import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const bytes=await fs.readFile(new URL('../../engine/studio-core.wasm',import.meta.url));const {instance}=await WebAssembly.instantiate(bytes,{}),native=instance.exports;
const scene=()=>({format:'viento-scene3d',schemaVersion:1,name:'Fog witness🦊',viewport:[800,600],background:'#0d1829',camera:{position:[8,6,8],target:[0,0,0],fovDegrees:60,near:.05,far:1000},light:{direction:[-1,-2,-1],color:'#ffffff',energy:1},objects:[{instanceId:'10000000-1111-4111-8111-111111111111',name:'fog density color',primitive:'box',position:[0,1,0],rotationDegrees:[23,-41,67],size:[1,2,3],color:'#87d8b9'}]});
const source=()=> '\uFEFF'+JSON.stringify(scene(),null,'\t').replaceAll('\n','\r\n')+'\r\n \t';
const fog={color:'#abcDEF',density:.125};
const request=content=>({protocolVersion:1,operation:'scene3d.patchEnvironment',content,values:{fog}});
function wasm(input){const encoded=new TextEncoder().encode(JSON.stringify(input)),pointer=native.viento_core_input(encoded.length)>>>0;new Uint8Array(native.memory.buffer,pointer,encoded.length).set(encoded);const output=native.viento_core_run()>>>0;return JSON.parse(new TextDecoder().decode(new Uint8Array(native.memory.buffer,output,native.viento_core_output_len())));}
let seq=0;
async function bridge(reply,fogVersion=1){const module=await import(new URL('../../engine/studio-core.mjs?fog-response='+ ++seq,import.meta.url)),memory=new WebAssembly.Memory({initial:40}),old=WebAssembly.instantiate;let length=0,outputLength=0;
 try{WebAssembly.instantiate=async()=>({instance:{exports:{memory,viento_core_protocol_version:()=>1,viento_core_scene3d_version:()=>1,viento_core_scene3d_environment_version:()=>1,...(fogVersion===null?{}:{viento_core_scene3d_fog_version:()=>fogVersion}),viento_core_input:size=>{length=size;return 16;},viento_core_run:()=>{const input=JSON.parse(new TextDecoder().decode(new Uint8Array(memory.buffer,16,length)));const value=input.operation==='scene3d.patchEnvironment'&&Object.hasOwn(input.values,'fog')?(typeof reply==='function'?reply(input):reply):wasm(input);const data=new TextEncoder().encode(JSON.stringify(value));outputLength=data.length;new Uint8Array(memory.buffer,1048576,data.length).set(data);return 1048576;},viento_core_output_len:()=>outputLength}}});await module.initializeStudioCore(()=>new Uint8Array([1]));}finally{WebAssembly.instantiate=old;}return module;
}
const parseRequest=content=>({protocolVersion:1,operation:'scene3d.parse',content});

test('fog capability absent zero or unsupported disables fog requests while existing no-fog parse and ordinary environment remain usable',async()=>{
 for(const version of [null,0,2]){const m=await bridge(null,version),content=source();assert.equal(m.supportsStudioCoreScene3DFog(),false);assert.throws(()=>m.dispatchStudioCoreScene3DEnvironmentPatch(request(content)),{errorCode:'studio_core_unavailable'});assert.equal(m.getStudioCoreMetadata().ready,true);assert.equal(Object.hasOwn(m.dispatchStudioCoreScene3D(parseRequest(content)).model,'fog'),false);assert.equal(m.dispatchStudioCoreScene3DEnvironmentPatch({...request(content),values:{background:'#102030'}}).afterContent,content.replace('"#0d1829"','"#102030"'));}
});
test('a parse receipt containing explicit fog cannot borrow an old parse probe without the fog capability',async()=>{
 const v=scene();v.fog=fog;for(const version of [null,0,2]){const m=await bridge(null,version);assert.throws(()=>m.dispatchStudioCoreScene3D(parseRequest(JSON.stringify(v))),{errorCode:'studio_core_unavailable'});assert.equal(m.getStudioCoreMetadata().ready,false);}const m=await bridge(null,1);assert.deepEqual(m.dispatchStudioCoreScene3D(parseRequest(JSON.stringify(v))).model.fog,fog);
});
test('fog-enabled native whole receipt succeeds unchanged in its exact insertion spelling',async()=>{
 const input=request(source()),reply=wasm(input);assert.equal(reply.ok,true);const m=await bridge(reply);assert.deepEqual(m.dispatchStudioCoreScene3DEnvironmentPatch(input),reply.scene3dEnvironmentPatch);assert.equal(m.getStudioCoreMetadata().ready,true);
});
test('forged insertion cannot change original object numbers key spellings root whitespace or other string fields',async()=>{
 const input=request(source()),reply=wasm(input),original=reply.scene3dEnvironmentPatch.afterContent;
 for(const afterContent of [original.replace('"position"','"posi\\u0074ion"'),original.replace('"Fog witness🦊"','"Different"'),original.replace('"size": [\r\n\t\t\t\t1,','"size": [\r\n\t\t\t\t1.0,'),original+' ',original.replace('"background"','"backgrou\\u006ed"')]){assert.notEqual(afterContent,original);const m=await bridge({...reply,scene3dEnvironmentPatch:{...reply.scene3dEnvironmentPatch,afterContent}});assert.throws(()=>m.dispatchStudioCoreScene3DEnvironmentPatch(input),{errorCode:'studio_core_unavailable'});}
});
test('the new fog member itself must match canonical key order strings and number tokens, not only semantic equality',async()=>{
 const input=request(source()),reply=wasm(input),original=reply.scene3dEnvironmentPatch.afterContent;
 for(const afterContent of [original.replace(',"fog":{"color":"#abcDEF","density":0.125}',',"fog":{"density":0.125,"color":"#abcDEF"}'),original.replace('"density":0.125','"density":1.25e-1'),original.replace('"#abcDEF"','"\\u0023abcDEF"'),original.replace(',"fog":',', "fog":')]){assert.notEqual(afterContent,original);const m=await bridge({...reply,scene3dEnvironmentPatch:{...reply.scene3dEnvironmentPatch,afterContent}});assert.throws(()=>m.dispatchStudioCoreScene3DEnvironmentPatch(input),{errorCode:'studio_core_unavailable'});}
});
test('before binding complete changed paths and requested fog semantics remain required in every receipt',async()=>{
 const input=request(source()),reply=wasm(input),patch=reply.scene3dEnvironmentPatch;
 for(const bad of [{...reply,extra:true},{...reply,scene3dEnvironmentPatch:{...patch,changedPaths:['/fog/density']}},{...reply,scene3dEnvironmentPatch:{...patch,beforeContent:input.content+' '}},{...reply,scene3dEnvironmentPatch:{...patch,afterContent:patch.afterContent.replace('"density":0.125','"density":0.25')}},{...reply,scene3dEnvironmentPatch:{...patch,afterContent:input.content}}]){const m=await bridge(bad);assert.throws(()=>m.dispatchStudioCoreScene3DEnvironmentPatch(input),{errorCode:'studio_core_unavailable'});}
});
