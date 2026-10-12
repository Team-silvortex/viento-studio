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
const nativePath = process.env.VIENTO_STUDIO_CORE_BIN || fileURLToPath(new URL('../../desktop/.cache/scene3d-copy-core-target/debug/viento-core', import.meta.url));
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
const request = (offset=[1,2,3], content=sample(), copies=[{sourceInstanceId:id(3),newInstanceId:id(1003)},{sourceInstanceId:id(1),newInstanceId:id(1001)}]) => ({protocolVersion:1,operation:'scene3d.copyObjects',content:typeof content==='string'?content:serialize(content),copies,offset});
const patch = input => core.dispatchStudioCoreScene3DCopyPatch(input);
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
function expected(input) {
  const value=parsed(input.content),indexed=parseJsonSource(input.content),bySource=new Map(input.copies.map(pair=>[pair.sourceInstanceId,pair])),copies=[],rawCopies=[];
  const locations=value.objects.map((_,i)=>locateJsonSource(indexed,`/objects/${i}`));
  for(const[originalIndex,object]of value.objects.entries()){
    const pair=bySource.get(object.instanceId);if(!pair)continue;
    const range=locations[originalIndex],edits=[{...locateJsonSource(indexed,`/objects/${originalIndex}/instanceId`),text:JSON.stringify(pair.newInstanceId)}];
    for(let axis=0;axis<3;axis++){const next=object.position[axis]+input.offset[axis];if(next!==object.position[axis])edits.push({...locateJsonSource(indexed,`/objects/${originalIndex}/position/${axis}`),text:JSON.stringify(next)});}
    let raw=input.content.slice(range.start,range.end);for(const edit of edits.sort((a,b)=>b.start-a.start))raw=raw.slice(0,edit.start-range.start)+edit.text+raw.slice(edit.end-range.start);
    copies.push(pair);rawCopies.push(raw);
  }
  let first=locations[0].start;while(first>0&&/[ \t\r\n]/.test(input.content[first-1]))first--;
  assert.equal(input.content[first-1],'[');const padding=input.content.slice(first,locations[0].start),end=locations.at(-1).end;
  return {copies,offset:clone(input.offset),beforeContent:input.content,afterContent:input.content.slice(0,end)+rawCopies.map(raw=>','+padding+raw).join('')+input.content.slice(end),changedPaths:copies.map((_,i)=>`/objects/${value.objects.length+i}`)};
}
let bridgeId=0;
async function responseBridge(response,copyVersion=1,parseVersion=1) {
  const module=await import(new URL(`../../engine/studio-core.mjs?scene3d-copy-response=${++bridgeId}`,import.meta.url));
  const memory=new WebAssembly.Memory({initial:40}),instantiate=WebAssembly.instantiate;let inputLength=0,outputLength=0;
  try {
    WebAssembly.instantiate=async()=>({instance:{exports:{memory,viento_core_protocol_version:()=>1,
      viento_core_scene3d_distribution_version:()=>1,viento_core_scene3d_alignment_version:()=>1,viento_core_scene3d_translation_version:()=>1,viento_core_scene3d_patch_version:()=>1,viento_core_scene3d_objects_version:()=>1,viento_core_scene3d_environment_version:()=>1,viento_core_scene3d_properties_version:()=>1,
      ...(copyVersion===null?{}:{viento_core_scene3d_copy_version:()=>copyVersion}),...(parseVersion===null?{}:{viento_core_scene3d_version:()=>parseVersion}),
      viento_core_input:length=>{inputLength=length;return 16;},viento_core_run:()=>{
        const input=JSON.parse(new TextDecoder().decode(new Uint8Array(memory.buffer,16,inputLength)));
        const value=input.operation==='scene3d.copyObjects'?(typeof response==='function'?response(input):response):wasm(input);
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


test('copy has an independent parse-dependent optional probe and leaves all seven previous author domains available',async()=>{
  assert.equal(core.supportsStudioCoreScene3DCopyPatch(),true);
  for(const version of [null,0,2]){const fake=await responseBridge(null,version);assert.equal(fake.supportsStudioCoreScene3DCopyPatch(),false);assert.throws(()=>fake.dispatchStudioCoreScene3DCopyPatch(request()),{errorCode:'studio_core_unavailable'});for(const name of ['supportsStudioCoreScene3DPatch','supportsStudioCoreScene3DObjectsPatch','supportsStudioCoreScene3DEnvironmentPatch','supportsStudioCoreScene3DPropertiesPatch','supportsStudioCoreScene3DTranslationPatch','supportsStudioCoreScene3DAlignmentPatch','supportsStudioCoreScene3DDistributionPatch'])assert.equal(fake[name](),true);assert.ok(fake.dispatchStudioCoreScene3D(parseInput(request().content)).model);}
  for(const version of [null,0,2]){const fake=await responseBridge(null,1,version);assert.equal(fake.supportsStudioCoreScene3DCopyPatch(),false);assert.throws(()=>fake.dispatchStudioCoreScene3DCopyPatch(request()),{errorCode:'studio_core_unavailable'});}
});
test('actual predecessor WASM keeps parse and seven old author operations while only copy is absent',async()=>{
  const previous=await fs.readFile(new URL('../../docs/test-results/scene3d-copy-authoring/previous-studio-core.wasm',import.meta.url)),module=await import(new URL('../../engine/studio-core.mjs?copy-old-predecessor',import.meta.url));await module.initializeStudioCore(()=>previous);assert.equal(module.supportsStudioCoreScene3DCopyPatch(),false);assert.throws(()=>module.dispatchStudioCoreScene3DCopyPatch(request()),{errorCode:'studio_core_unavailable'});
  const content=request().content;assert.ok(module.dispatchStudioCoreScene3D(parseInput(content)).model);
  const inputs=olderRequests(content);for(const[name,input]of inputs)assert.ok(module[name](input).afterContent);
});
function olderRequests(content){return [['dispatchStudioCoreScene3DPatch',{protocolVersion:1,operation:'scene3d.patchObjectTransform',content,instanceId:id(1),values:{position:[1,2,3]}}],['dispatchStudioCoreScene3DObjectsPatch',{protocolVersion:1,operation:'scene3d.patchObjects',content,action:'copy',instanceId:id(1),newInstanceId:id(99),name:'Old explicit name'}],['dispatchStudioCoreScene3DEnvironmentPatch',{protocolVersion:1,operation:'scene3d.patchEnvironment',content,values:{background:'#123456'}}],['dispatchStudioCoreScene3DPropertiesPatch',{protocolVersion:1,operation:'scene3d.patchProperties',content,instanceId:id(1),values:{name:'Old'}}],['dispatchStudioCoreScene3DTranslationPatch',{protocolVersion:1,operation:'scene3d.translateObjects',content,instanceIds:[id(1)],offset:[1,0,0]}],['dispatchStudioCoreScene3DAlignmentPatch',{protocolVersion:1,operation:'scene3d.alignObjects',content,instanceIds:[id(1),id(2)],anchorInstanceId:id(1),axis:'x'}],['dispatchStudioCoreScene3DDistributionPatch',{protocolVersion:1,operation:'scene3d.distributeObjects',content,instanceIds:[id(1),id(2),id(3)],axis:'x'}]];}
test('copy preserves the declared source-new UUID association and canonically appends in source order',()=>{
  const input=request(),result=patch(input),value=parsed(result.afterContent),original=parsed(input.content);assert.deepEqual(result,expected(input));assert.deepEqual(result.copies,[input.copies[1],input.copies[0]]);assert.deepEqual(result.changedPaths,['/objects/4','/objects/5']);assert.deepEqual(value.objects.slice(0,4),original.objects);
  for(let i=0;i<2;i++){const pair=result.copies[i],source=original.objects.find(o=>o.instanceId===pair.sourceInstanceId);assert.deepEqual(value.objects[4+i],{...source,instanceId:pair.newInstanceId,position:source.position.map((v,a)=>v+input.offset[a])});}for(const key of ['camera','light','name','viewport','background'])assert.deepEqual(value[key],original[key]);
});
test('one insertion preserves original prefix suffix unusual inter-object trivia BOM CRLF and Unicode',()=>{
  let content=serialize(sample()).replaceAll('"instanceId"','"instance\\u0049d"').replaceAll('"position"','"posi\\u0074ion"').replaceAll('},\r\n','} \r\n ,\t\r\n');const input=request([1,0,0],content),r=patch(input);assert.deepEqual(r,expected(input));assert.ok(r.afterContent.startsWith('\uFEFF'));assert.equal(r.afterContent.match(/instance\\u0049d/g).length,6);assert.equal(r.afterContent.match(/posi\\u0074ion/g).length,7);assert.ok(r.afterContent.includes('箱🦊'));
});
test('zero shared offset remains a structural copy without normalizing negative zero exponents or names',()=>{
  let content=serialize(sample());content=replaceValue(content,'/objects/0/name',JSON.stringify(id(1)));content=replaceValue(content,'/objects/0/position/0','1.000e1');content=replaceValue(content,'/objects/0/position/1','-0e0');const input=request([0,0,0],content,[{sourceInstanceId:id(1),newInstanceId:id(1001)}]),r=patch(input);assert.deepEqual(r,expected(input));assert.notEqual(r.afterContent,content);const copy=parsed(r.afterContent).objects.at(-1);assert.equal(copy.name,id(1));assert.equal(copy.instanceId,id(1001));assert.ok(Object.is(copy.position[1],-0));assert.equal(r.afterContent.match(/1\.000e1/g).length,2);assert.equal(r.afterContent.match(/-0e0/g).length,2);
});
test('all net XYZ positions change together while rounded noops retain their source token spelling',()=>{
  const value=sample();value.objects[0].position=[100000,0,-0];let content=serialize(value);content=replaceValue(content,'/objects/0/position/0','1.00000e5');content=replaceValue(content,'/objects/0/position/2','-0e0');const input=request([5e-324,5e-324,0],content,[{sourceInstanceId:id(1),newInstanceId:id(1001)}]),r=patch(input);assert.deepEqual(r,expected(input));assert.equal(parsed(r.afterContent).objects.at(-1).position[1],5e-324);assert.equal(r.afterContent.match(/1\.00000e5/g).length,2);assert.equal(r.afterContent.match(/-0e0/g).length,2);
  assert.deepEqual(patch(request([-5,7,-9])),expected(request([-5,7,-9])));
});
test('the effective maximum 64 distinct original sources can create 64 copies and fill all 128 declarations',()=>{
  const value=sample(),prototype=value.objects[0];value.objects=Array.from({length:64},(_,i)=>({...clone(prototype),instanceId:id(i+1),position:[i,0,0]}));const pairs=value.objects.map(o=>({sourceInstanceId:o.instanceId,newInstanceId:id(Number.parseInt(o.instanceId.slice(0,8),16)+1000)})).reverse();const input=request([1,0,0],value,pairs),r=patch(input);assert.equal(r.copies.length,64);assert.equal(parsed(r.afterContent).objects.length,128);assert.equal(r.changedPaths[0],'/objects/64');assert.equal(r.changedPaths.at(-1),'/objects/127');assert.deepEqual(r,expected(input));
});
test('final 129 objects, overflowed batch offset and unknown sources never yield partial copies',()=>{
  const value=sample(),proto=value.objects[0];value.objects=Array.from({length:65},(_,i)=>({...clone(proto),instanceId:id(i+1),position:[0,0,0]}));const pairs=value.objects.slice(0,64).map(o=>({sourceInstanceId:o.instanceId,newInstanceId:id(Number.parseInt(o.instanceId.slice(0,8),16)+1000)}));assert.throws(()=>patch(request([0,0,0],value,pairs)),{errorCode:'scene3d_limit'});
  value.objects[1].position[0]=100000;assert.throws(()=>patch(request([1,0,0],value,pairs.slice(0,2))),{errorCode:'scene3d_copy_invalid'});assert.throws(()=>patch(request([0,0,0],sample(),[{sourceInstanceId:id(99),newInstanceId:id(1001)}])),{errorCode:'scene3d_copy_invalid'});assert.equal(core.getStudioCoreMetadata().ready,true);
});
test('complete final byte budgeting permits an exactly fitting batch and atomically refuses one extra byte',()=>{
  let content=serialize(sample()),input=request([1,0,0],content),growth=Buffer.byteLength(expected(input).afterContent)-Buffer.byteLength(content);content+=' '.repeat(131072-growth-Buffer.byteLength(content));assert.equal(Buffer.byteLength(patch(request([1,0,0],content)).afterContent),131072);assert.throws(()=>patch(request([1,0,0],content+' ')),{errorCode:'scene3d_limit'});
});
test('exact JSON shape rejects hidden accessors serializers sparse pairs nested keys and old domain operations without executing user code',()=>{
  let reads=0;const accessor=request();Object.defineProperty(accessor.copies[0],'newInstanceId',{enumerable:true,get(){reads++;throw Error('getter');}});const hidden=request();Object.defineProperty(hidden.copies[0],'hidden',{value:true});const serializer=request();serializer.copies[0].toJSON=()=>{reads++;return {};};const sparse=request();delete sparse.copies[0];
  for(const input of [accessor,hidden,serializer,sparse,{...request(),axis:'x'},{...request(),operation:'scene3d.patchObjects'},{...request(),offset:[NaN,0,0]}])assert.throws(()=>patch(input),{errorCode:'studio_core_request_invalid'});assert.equal(reads,0);
  for(const input of [request([200001,0,0]),request([0,0]),request([0,0,0],sample(),[]),request([0,0,0],sample(),[{sourceInstanceId:id(1),newInstanceId:'ABCDEF00-1111-4111-8111-111111111111'}]),request([0,0,0],sample(),[{sourceInstanceId:id(1),newInstanceId:id(2)}]),request([0,0,0],sample(),[{sourceInstanceId:id(1),newInstanceId:id(1001)},{sourceInstanceId:id(1),newInstanceId:id(1002)}])])assert.throws(()=>patch(input),{errorCode:'scene3d_copy_invalid'});
});
test('invalid unselected original declarations and decoded duplicate source keys retain old parser errors',()=>{
  const value=sample();value.objects[3].size=[0,1,1];assert.throws(()=>patch(request([0,0,0],value)),{errorCode:'scene3d_invalid'});const content=serialize(sample()).replace('"objects":','"objects":[],"objec\\u0074s":');assert.throws(()=>patch(request([0,0,0],content)),{errorCode:'scene3d_invalid'});assert.equal(core.getStudioCoreMetadata().ready,true);
});
test('malicious complete receipt identity order offset paths envelope and original prefix changes fail closed',async()=>{
  const input=request(),r=expected(input),base={protocolVersion:1,ok:true,scene3dCopyPatch:r};const bad=[{...base,extra:true},{...base,scene3dCopyPatch:{...r,copies:[...r.copies].reverse()}},{...base,scene3dCopyPatch:{...r,offset:[0,0,0]}},{...base,scene3dCopyPatch:{...r,changedPaths:['/objects/5','/objects/4']}},{...base,scene3dCopyPatch:{...r,beforeContent:r.beforeContent+' '}},{...base,scene3dCopyPatch:{...r,extra:true}},{...base,scene3dCopyPatch:{...r,afterContent:replaceValue(r.afterContent,'/objects/0/position/0','11')}}];for(const value of bad){const fake=await responseBridge(value);assert.throws(()=>fake.dispatchStudioCoreScene3DCopyPatch(input),{errorCode:'studio_core_unavailable'});assert.equal(fake.getStudioCoreMetadata().ready,false);}
});
test('whole cloned values and exact CST forbid copied name suffix color numeric lexeme or whitespace normalization',async()=>{
  const input=request(),r=expected(input);for(const content of [replaceValue(r.afterContent,'/objects/4/name','"Suffix"'),replaceValue(r.afterContent,'/objects/4/color','"#123456"'),replaceValue(r.afterContent,'/objects/4/size/0','1.500'),r.afterContent.replace('"instanceId": "000003e9','"instanceId" : "000003e9')]){const fake=await responseBridge({protocolVersion:1,ok:true,scene3dCopyPatch:{...r,afterContent:content}});assert.throws(()=>fake.dispatchStudioCoreScene3DCopyPatch(input),{errorCode:'studio_core_unavailable'});}
});
test('same-valued geometry keys cannot swap slots even when the complete copied model is semantically identical',async()=>{
  const value=sample();value.objects[0].position=[1,2,3];value.objects[0].rotationDegrees=[1,2,3];const input=request([0,0,0],value,[{sourceInstanceId:id(1),newInstanceId:id(1001)}]),r=expected(input);const range=locateJsonSource(parseJsonSource(r.afterContent),'/objects/4');let raw=r.afterContent.slice(range.start,range.end);raw=raw.replace('"position"','"temporary-key"').replace('"rotationDegrees"','"position"').replace('"temporary-key"','"rotationDegrees"');const afterContent=r.afterContent.slice(0,range.start)+raw+r.afterContent.slice(range.end);assert.deepEqual(parsed(afterContent),parsed(r.afterContent));const fake=await responseBridge({protocolVersion:1,ok:true,scene3dCopyPatch:{...r,afterContent}});assert.throws(()=>fake.dispatchStudioCoreScene3DCopyPatch(input),{errorCode:'studio_core_unavailable'});
});
test('name equal to source UUID cannot borrow the only authorized identity value token',async()=>{
  const value=sample();value.objects[0].name=id(1);const input=request([0,0,0],value,[{sourceInstanceId:id(1),newInstanceId:id(1001)}]),r=expected(input);assert.deepEqual(patch(input),r);const bad=replaceValue(r.afterContent,'/objects/4/name',JSON.stringify(id(1001)));const fake=await responseBridge({protocolVersion:1,ok:true,scene3dCopyPatch:{...r,afterContent:bad}});assert.throws(()=>fake.dispatchStudioCoreScene3DCopyPatch(input),{errorCode:'studio_core_unavailable'});
});
test('forged success cannot bypass final target bounds or total object count',async()=>{
  const input=request([200000,0,0]),bad=expected(input);const fake=await responseBridge({protocolVersion:1,ok:true,scene3dCopyPatch:bad});assert.throws(()=>fake.dispatchStudioCoreScene3DCopyPatch(input),{errorCode:'studio_core_unavailable'});
});
test('fresh CLI and WASM agree on complete valid copies semantic rejections decoded duplicates and seven old operations',{skip:!nativeAvailable},async()=>{
  const invalid=sample();invalid.objects[2].position[0]=100000;const raw=JSON.stringify(request());const inputs=[request(),request([0,0,0]),request([-2,3,-4]),request([5e-324,0,0]),request([1,0,0],invalid),request([200001,0,0]),request([0,0,0],sample(),[]),request([0,0,0],sample(),[{sourceInstanceId:id(1),newInstanceId:id(2)}]),request([0,0,0],sample(),[{sourceInstanceId:id(1),newInstanceId:id(1001)},{sourceInstanceId:id(1),newInstanceId:id(1002)}]),raw.replace('"copies":','"copies":[],"cop\\u0069es":'),raw.replace('"sourceInstanceId":','"sourceInstanceId":"bad","sourceInstance\\u0049d":'),raw.replace('"newInstanceId":','"name":"extra","newInstanceId":'),...olderRequests(request().content).map(([,v])=>v)];assert.equal(inputs.length,19);assert.deepEqual(await nativeSequence(inputs),inputs.map(wasm));
});
