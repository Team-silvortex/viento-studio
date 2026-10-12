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
const { instance } = await WebAssembly.instantiate(bytes, {}), nativeWasm = instance.exports;
const nativePath = process.env.VIENTO_STUDIO_CORE_BIN || fileURLToPath(new URL('../../desktop/.cache/scene3d-removal-core-target/debug/viento-core', import.meta.url));
let nativeAvailable = true;
try { await fs.access(nativePath, constants.X_OK); } catch { nativeAvailable = false; }
const clone = value => JSON.parse(JSON.stringify(value));
const id = n => `${n.toString(16).padStart(8, '0')}-1111-4111-8111-111111111111`;
const serialize = value => '\uFEFF' + JSON.stringify(value, null, '\t').replaceAll('\n', '\r\n') + '\r\n \t';
const parsed = content => JSON.parse(content.replace(/^\uFEFF/, ''));
function sample() {
  return { format:'viento-scene3d',schemaVersion:1,name:'Copy / 对齐 / 整列 🦊',viewport:[800,600],background:'#0d1829',
    camera:{position:[8,6,8],target:[0,0,0],fovDegrees:60,near:.05,far:1000},light:{direction:[-1,-2,-1],color:'#ffffff',energy:1},
    objects:[[10,3,4],[-8,8,2],[-10,-2,-3],[90,80,70]].map((position,index)=>({instanceId:id(index+1),name:`Box ${index} 箱🦊`,primitive:'box',position,
      rotationDegrees:[23,-41,67],size:[1.5,3,1.5],color:'#87d8b9'})) };
}
const request = (ids=[3,1], content=sample()) => ({protocolVersion:1,operation:'scene3d.removeObjects',content:typeof content==='string'?content:serialize(content),instanceIds:ids.map(value=>typeof value==='number'?id(value):value)});
const patch = input => core.dispatchStudioCoreScene3DRemovalPatch(input);
const parseInput = content => ({protocolVersion:1,operation:'scene3d.parse',content});
function wasm(input) {
  const encoded = new TextEncoder().encode(typeof input==='string'?input:JSON.stringify(input)), pointer=nativeWasm.viento_core_input(encoded.length)>>>0;
  new Uint8Array(nativeWasm.memory.buffer,pointer,encoded.length).set(encoded);
  const output=nativeWasm.viento_core_run()>>>0,length=nativeWasm.viento_core_output_len();
  return JSON.parse(new TextDecoder('utf8',{fatal:true}).decode(new Uint8Array(nativeWasm.memory.buffer,output,length)));
}
function replaceValue(content,path,text) {
  const range=locateJsonSource(parseJsonSource(content),path);assert.equal(range.exact,true);
  return content.slice(0,range.start)+text+content.slice(range.end);
}
let bridgeId=0;
async function responseBridge(response,removalVersion=1,parseVersion=1) {
  const module=await import(new URL(`../../engine/studio-core.mjs?scene3d-removal-response=${++bridgeId}`,import.meta.url));
  const memory=new WebAssembly.Memory({initial:40}),instantiate=WebAssembly.instantiate;let inputLength=0,outputLength=0;
  try {
    WebAssembly.instantiate=async()=>({instance:{exports:{memory,viento_core_protocol_version:()=>1,
      viento_core_scene3d_copy_version:()=>1,viento_core_scene3d_distribution_version:()=>1,viento_core_scene3d_alignment_version:()=>1,viento_core_scene3d_translation_version:()=>1,viento_core_scene3d_patch_version:()=>1,viento_core_scene3d_objects_version:()=>1,viento_core_scene3d_environment_version:()=>1,viento_core_scene3d_properties_version:()=>1,
      ...(removalVersion===null?{}:{viento_core_scene3d_removal_version:()=>removalVersion}),...(parseVersion===null?{}:{viento_core_scene3d_version:()=>parseVersion}),
      viento_core_input:length=>{inputLength=length;return 16;},viento_core_run:()=>{
        const input=JSON.parse(new TextDecoder().decode(new Uint8Array(memory.buffer,16,inputLength)));
        const value=input.operation==='scene3d.removeObjects'?(typeof response==='function'?response(input):response):wasm(input);
        const encoded=new TextEncoder().encode(JSON.stringify(value));outputLength=encoded.length;new Uint8Array(memory.buffer,1048576,encoded.length).set(encoded);return 1048576;
      },viento_core_output_len:()=>outputLength}}});
    await module.initializeStudioCore(()=>new Uint8Array([1]));
  } finally { WebAssembly.instantiate=instantiate; }
  return module;
}
async function nativeSequence(inputs) {
  return new Promise((resolve,reject)=>{
    const child=spawn(nativePath,[],{stdio:['pipe','pipe','pipe']});let stdout='',stderr='',failure;
    const timer=setTimeout(()=>{failure=Error('Copy native parity timeout');child.kill('SIGKILL');},30000);
    child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
    child.stdout.on('data',text=>{stdout+=text;if(Buffer.byteLength(stdout)>16*1024*1024){failure=Error('Native output budget exceeded');child.kill('SIGKILL');}});
    child.stderr.on('data',text=>{stderr=(stderr+text).slice(-4096);});child.stdin.on('error',error=>{failure||=error;});
    child.once('error',error=>{clearTimeout(timer);reject(error);});child.once('close',(code,signal)=>{
      clearTimeout(timer);if(failure)return reject(failure);
      try {assert.equal(signal,null);assert.equal(code,0,stderr);const output=stdout.trim().split('\n').map(JSON.parse);assert.equal(output.length,inputs.length);resolve(output);}catch(error){reject(error);}
    });
    child.stdin.end(inputs.map(input=>typeof input==='string'?input:JSON.stringify(input)).join('\n')+'\n');
  });
}


function expected(input) {
  const value=parsed(input.content),indexed=parseJsonSource(input.content),selected=new Set(input.instanceIds),removed=value.objects.map(object=>selected.has(object.instanceId));
  const locations=value.objects.map((_,i)=>locateJsonSource(indexed,`/objects/${i}`)),ranges=[];
  for(let index=0;index<locations.length;){if(!removed[index]){index++;continue;}const first=index;while(index<locations.length&&removed[index])index++;ranges.push(index<locations.length?{start:locations[first].start,end:locations[index].start}:first>0?{start:locations[first-1].end,end:locations[index-1].end}:{start:locations[first].start,end:locations[index-1].end});}
  let afterContent='',cursor=0;for(const range of ranges){afterContent+=input.content.slice(cursor,range.start);cursor=range.end;}afterContent+=input.content.slice(cursor);
  return {instanceIds:value.objects.filter((_,i)=>removed[i]).map(o=>o.instanceId),beforeContent:input.content,afterContent,changedPaths:value.objects.flatMap((_,i)=>removed[i]?[`/objects/${i}`]:[])};
}
const olderRequests = content => [
 ['dispatchStudioCoreScene3DPatch',{protocolVersion:1,operation:'scene3d.patchObjectTransform',content,instanceId:id(1),values:{position:[1,2,3]}}],
 ['dispatchStudioCoreScene3DObjectsPatch',{protocolVersion:1,operation:'scene3d.patchObjects',content,action:'copy',instanceId:id(1),newInstanceId:id(99),name:'Old explicit name'}],
 ['dispatchStudioCoreScene3DEnvironmentPatch',{protocolVersion:1,operation:'scene3d.patchEnvironment',content,values:{background:'#123456'}}],
 ['dispatchStudioCoreScene3DPropertiesPatch',{protocolVersion:1,operation:'scene3d.patchProperties',content,instanceId:id(1),values:{name:'Old'}}],
 ['dispatchStudioCoreScene3DTranslationPatch',{protocolVersion:1,operation:'scene3d.translateObjects',content,instanceIds:[id(1)],offset:[1,0,0]}],
 ['dispatchStudioCoreScene3DAlignmentPatch',{protocolVersion:1,operation:'scene3d.alignObjects',content,instanceIds:[id(1),id(2)],anchorInstanceId:id(1),axis:'x'}],
 ['dispatchStudioCoreScene3DDistributionPatch',{protocolVersion:1,operation:'scene3d.distributeObjects',content,instanceIds:[id(1),id(2),id(3)],axis:'x'}],
 ['dispatchStudioCoreScene3DCopyPatch',{protocolVersion:1,operation:'scene3d.copyObjects',content,copies:[{sourceInstanceId:id(1),newInstanceId:id(99)}],offset:[1,0,0]}]];
const probes = ['Patch','ObjectsPatch','EnvironmentPatch','PropertiesPatch','TranslationPatch','AlignmentPatch','DistributionPatch','CopyPatch'];

test('ninth optional removal capability depends on parse while all eight older author probes remain available',async()=>{
 assert.equal(core.supportsStudioCoreScene3DRemovalPatch(),true);
 for(const version of [null,0,2]){const fake=await responseBridge(null,version);assert.equal(fake.supportsStudioCoreScene3DRemovalPatch(),false);assert.throws(()=>fake.dispatchStudioCoreScene3DRemovalPatch(request()),{errorCode:'studio_core_unavailable'});for(const name of probes)assert.equal(fake[`supportsStudioCoreScene3D${name}`](),true);assert.ok(fake.dispatchStudioCoreScene3D(parseInput(request().content)).model);}
 for(const version of [null,0,2]){const fake=await responseBridge(null,1,version);assert.equal(fake.supportsStudioCoreScene3DRemovalPatch(),false);assert.throws(()=>fake.dispatchStudioCoreScene3DRemovalPatch(request()),{errorCode:'studio_core_unavailable'});}
});
test('actual copied predecessor retains parse and all eight old operations with only removal unavailable',async()=>{
 const previous=await fs.readFile(new URL('../../docs/test-results/scene3d-removal-authoring/previous-studio-core.wasm',import.meta.url)),module=await import(new URL('../../engine/studio-core.mjs?removal-old-predecessor',import.meta.url));await module.initializeStudioCore(()=>previous);assert.equal(module.supportsStudioCoreScene3DRemovalPatch(),false);assert.throws(()=>module.dispatchStudioCoreScene3DRemovalPatch(request()),{errorCode:'studio_core_unavailable'});assert.ok(module.dispatchStudioCoreScene3D(parseInput(request().content)).model);for(const[name,input]of olderRequests(request().content))assert.ok(module[name](input).afterContent);
});
test('receipt exposes exactly four fields and canonical original paths with independently filtered whole model',()=>{
 const input=request(),result=patch(input);assert.deepEqual(Object.keys(result).sort(),['instanceIds','beforeContent','afterContent','changedPaths'].sort());assert.deepEqual(result,expected(input));assert.deepEqual(result.instanceIds,[id(1),id(3)]);assert.deepEqual(result.changedPaths,['/objects/0','/objects/2']);const after=parsed(result.afterContent),before=parsed(input.content);assert.deepEqual(after.objects,[before.objects[1],before.objects[3]]);for(const key of ['camera','light','name','viewport','background'])assert.deepEqual(after[key],before[key]);
});
test('first middle final consecutive alternating and disjoint runs are one exact original-source cut',()=>{
 for(const ids of [[1],[2],[4],[1,2],[3,2],[4,3],[3,1],[4,1],[4,2,1]]){const input=request(ids),result=patch(input);assert.deepEqual(result,expected(input));const tree=parseJsonSource(input.content),after=parseJsonSource(result.afterContent),selected=new Set(input.instanceIds);let surviving=0;for(const[index,object]of parsed(input.content).objects.entries()){if(selected.has(object.instanceId))continue;const a=locateJsonSource(tree,`/objects/${index}`),b=locateJsonSource(after,`/objects/${surviving++}`);assert.equal(input.content.slice(a.start,a.end),result.afterContent.slice(b.start,b.end));}}
});
test('BOM CRLF astral Unicode escaped keys authored number tokens and mixed padding remain byte-for-byte',()=>{
 let content=serialize(sample()).replace('"objects"','"obje\\u0063ts"').replaceAll('1.5','1.50e0').replaceAll('3,','3e0,').replace('"Box 3 箱🦊"','"Box 3 \\u7bb1🦊"');content=replaceValue(content,'/objects/3/rotationDegrees/0','-0e0');const input=request([3,1],content),result=patch(input);assert.deepEqual(result,expected(input));assert.ok(result.afterContent.startsWith('\uFEFF'));assert.ok(result.afterContent.endsWith('\r\n \t'));assert.ok(result.afterContent.includes('1.50e0')&&result.afterContent.includes('-0e0')&&result.afterContent.includes('obje\\u0063ts'));
});
test('127 removals from 128 declarations leave one survivor and 128 removals are invalid',()=>{
 const value=sample(),prototype=value.objects[0];value.objects=Array.from({length:128},(_,i)=>({...clone(prototype),instanceId:id(i+1),name:`Same 箱🦊 ${i}`}));const input=request(Array.from({length:127},(_,i)=>127-i),JSON.stringify(value)),result=patch(input);assert.equal(result.instanceIds.length,127);assert.deepEqual(result.changedPaths.at(-1),'/objects/126');assert.deepEqual(parsed(result.afterContent).objects,[value.objects[127]]);assert.throws(()=>patch(request(Array.from({length:128},(_,i)=>i+1),JSON.stringify(value))),{errorCode:'scene3d_removal_invalid'});
});
test('allselected singleton empty duplicate unknown uppercase malformed identities never repair source inventory',()=>{
 const value=sample();value.objects=value.objects.slice(0,1);assert.throws(()=>patch(request([1],value)),{errorCode:'scene3d_removal_invalid'});
 for(const ids of [[],[1,2,3,4],[1,1],[99],['FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF'],[null],[false],[id(1)+'x'],Array.from({length:129},(_,i)=>i+1)])assert.throws(()=>patch(request(ids)),{errorCode:'scene3d_removal_invalid'});for(const instanceIds of [null,{},'one'])assert.throws(()=>patch({...request(),instanceIds}),{errorCode:'scene3d_removal_invalid'});
});
test('original complete source byte/object budgets precede invalid removal intents',()=>{
 const base=JSON.stringify(sample()),exact=base+' '.repeat(128*1024-Buffer.byteLength(base));assert.ok(patch(request([1],exact)).afterContent.length<exact.length);assert.throws(()=>patch(request([],exact+' ')),{errorCode:'scene3d_limit'});const value=sample(),prototype=value.objects[0];value.objects=Array.from({length:129},(_,i)=>({...clone(prototype),instanceId:id(i+1)}));assert.throws(()=>patch(request([1],JSON.stringify(value))),{errorCode:'scene3d_limit'});
});
test('invalid original source reports the existing parse error before empty or unknown removal IDs',()=>{
 const texts=['{}','{',serialize({...sample(),format:'viento-scene2d'}),serialize({...sample(),objects:[]}),request().content.replace('"objects":','"objects":[],"objects":')];for(const content of texts){const error=wasm(parseInput(content)).errorCode;assert.ok(error);assert.throws(()=>patch(request([],content)),{errorCode:error});}
});
test('exact DTO rejects accessors serializers inherited extras holes and other operation shapes before executing caller code',()=>{
 let reads=0;const getter=request();Object.defineProperty(getter,'operation',{enumerable:true,get(){reads++;return 'scene3d.removeObjects';}});const nested=request();Object.defineProperty(nested.instanceIds,0,{enumerable:true,get(){reads++;return id(3);}});const serializer=request();serializer.toJSON=()=>{reads++;return request();};const hidden=request();Object.defineProperty(hidden.instanceIds,'hidden',{value:true});for(const input of [getter,nested,serializer,hidden,{...request(),instanceIds:Array(1)},{...request(),extra:true},Object.create(request()),{...request(),operation:'scene3d.patchObjects',action:'remove',instanceId:id(1)}])assert.throws(()=>patch(input),{errorCode:'studio_core_request_invalid'});assert.equal(reads,0);assert.equal(core.supportsStudioCoreScene3DRemovalPatch(),true);
});
test('forged reordered IDs shifted paths or missing extra fields poison only the offending fake runtime',async()=>{
 const input=request(),valid=wasm(input);for(const mutate of [r=>r.scene3dRemovalPatch.instanceIds.reverse(),r=>r.scene3dRemovalPatch.changedPaths=['/objects/0','/objects/1'],r=>r.scene3dRemovalPatch.beforeContent+=' ',r=>r.scene3dRemovalPatch.extra=true,r=>delete r.scene3dRemovalPatch.instanceIds,r=>r.extra=true,r=>delete r.scene3dRemovalPatch.changedPaths]){const forged=clone(valid);mutate(forged);const fake=await responseBridge(forged);assert.throws(()=>fake.dispatchStudioCoreScene3DRemovalPatch(input),{errorCode:'studio_core_unavailable'});assert.equal(fake.supportsStudioCoreScene3DRemovalPatch(),false);assert.throws(()=>fake.dispatchStudioCoreScene3D(parseInput(input.content)),{errorCode:'studio_core_unavailable'});}assert.equal(core.supportsStudioCoreScene3DRemovalPatch(),true);
});
test('semantic surviving-root mutations alternate removal and harmless-looking reformatting all fail complete text reconstruction',async()=>{
 const input=request(),valid=wasm(input);for(const mutate of [p=>p.afterContent+=' ',p=>p.afterContent=p.afterContent.replaceAll('\r\n','\n'),p=>p.afterContent=serialize({...parsed(p.afterContent),background:'#112233'}),p=>p.afterContent=replaceValue(p.afterContent,'/objects/0/name','"Changed"'),p=>p.afterContent=expected(request([4,2],input.content)).afterContent,p=>p.afterContent=p.beforeContent]){const forged=clone(valid);mutate(forged.scene3dRemovalPatch);const fake=await responseBridge(forged);assert.throws(()=>fake.dispatchStudioCoreScene3DRemovalPatch(input),{errorCode:'studio_core_unavailable'});assert.equal(fake.supportsStudioCoreScene3DRemovalPatch(),false);}
});
test('raw WASM rejects decoded duplicate unknown missing fields and trailing input while retaining old operation requests',()=>{
 const serialized=JSON.stringify(request());for(const raw of [serialized.replace('{','{"instanceIds":[],'),serialized.replace('{','{"instance\\u0049ds":[],'),serialized.replace('{','{"unknown":true,'),serialized.replace('{','{"protocolVersion":1,'),serialized+' {}'])assert.equal(wasm(raw).errorCode,'studio_core_request_invalid');for(const[name,input]of olderRequests(request().content)){assert.ok(core[name](input).afterContent);assert.equal(wasm(input).ok,true);}
});
test('CLI and WASM emit identical success/error envelopes across run patterns strict admission source budgets and all eight legacy domains',{skip:!nativeAvailable},async()=>{
 const content=request().content,inputs=[];for(const ids of [[1],[2],[4],[1,2],[3,2],[4,3],[3,1],[4,1],[4,2,1],[],[1,1],[99],[1,2,3,4]])inputs.push(request(ids,content));inputs.push(request([],content+' '.repeat(128*1024)),request([1],'{}'),request([1],serialize({...sample(),objects:[]})),{...request(),unknown:true},{...request(),instanceIds:null});for(const[,input]of olderRequests(content))inputs.push(input);const raw=JSON.stringify(request());inputs.push(raw.replace('{','{"instanceIds":[],'),raw.replace('{','{"instance\\u0049ds":[],'));const value=sample(),prototype=value.objects[0];value.objects=Array.from({length:128},(_,i)=>({...clone(prototype),instanceId:id(i+1)}));inputs.push(request(Array.from({length:127},(_,i)=>127-i),JSON.stringify(value)),request(Array.from({length:128},(_,i)=>i+1),JSON.stringify(value)));const native=await nativeSequence(inputs);assert.deepEqual(native,inputs.map(wasm));assert.equal(inputs.length,30);
});
