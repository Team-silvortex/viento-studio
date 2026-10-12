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
const nativePath = process.env.VIENTO_STUDIO_CORE_BIN || fileURLToPath(new URL('../../desktop/.cache/scene3d-transform-core-target/debug/viento-core', import.meta.url));
let nativeAvailable = true;
try { await fs.access(nativePath, constants.X_OK); } catch { nativeAvailable = false; }
const id = n => `${n.toString(16).padStart(8, '0')}-1111-4111-8111-111111111111`;
const serialize = value => '\uFEFF' + JSON.stringify(value, null, '\t').replaceAll('\n', '\r\n') + '\r\n \t';
const parsed = content => JSON.parse(content.replace(/^\uFEFF/, ''));
function sample() {
  return { format:'viento-scene3d', schemaVersion:1, name:'Transforms / 変換 / 原文🦊', viewport:[800,600], background:'#0d1829',
    camera:{position:[8,6,8],target:[0,0,0],fovDegrees:60,near:0.05,far:1000},
    light:{direction:[-1,-2,-1],color:'#ffffff',energy:1},objects:[
      {instanceId:id(1),name:'Box number 1 \\"',primitive:'box',position:[-2,1.5,0],rotationDegrees:[0,25,0],size:[1.5,3,1.5],color:'#87d8b9'},
      {instanceId:id(2),name:'Other',primitive:'box',position:[100,20,30],rotationDegrees:[15,20,30],size:[1,2,3],color:'#FFFFFF'},
    ] };
}
const request = (values={position:[3,1.5,-4]}, content=sample(), instanceId=id(1)) => ({protocolVersion:1,operation:'scene3d.patchObjectTransform',content:typeof content==='string'?content:serialize(content),instanceId,values});
const patch = input => core.dispatchStudioCoreScene3DPatch(input);
const parseInput = content => ({protocolVersion:1,operation:'scene3d.parse',content});
function wasm(input) {
  const encoded = new TextEncoder().encode(typeof input==='string'?input:JSON.stringify(input));
  const pointer = nativeWasm.viento_core_input(encoded.length) >>> 0;
  new Uint8Array(nativeWasm.memory.buffer,pointer,encoded.length).set(encoded);
  const output = nativeWasm.viento_core_run() >>> 0, length = nativeWasm.viento_core_output_len();
  return JSON.parse(new TextDecoder('utf8',{fatal:true}).decode(new Uint8Array(nativeWasm.memory.buffer,output,length)));
}
function expected(input) {
  const before = parsed(input.content), indexed = parseJsonSource(input.content);
  const index = before.objects.findIndex(object=>object.instanceId===input.instanceId), edits=[], changedPaths=[];
  for(const field of ['position','rotationDegrees','size']) {
    if(!Object.hasOwn(input.values,field))continue;
    for(let axis=0;axis<3;axis++) {
      if(before.objects[index][field][axis]===input.values[field][axis])continue;
      const path=`/objects/${index}/${field}/${axis}`,range=locateJsonSource(indexed,path);
      assert.equal(range.exact,true);changedPaths.push(path);edits.push({...range,text:JSON.stringify(input.values[field][axis])});
    }
  }
  let afterContent=input.content;
  for(const edit of edits.sort((a,b)=>b.start-a.start))afterContent=afterContent.slice(0,edit.start)+edit.text+afterContent.slice(edit.end);
  return {instanceId:input.instanceId,beforeContent:input.content,afterContent,changedPaths};
}
let bridgeId=0;
async function responseBridge(response, patchVersion=1, parseVersion=1) {
  const module = await import(new URL(`../../engine/studio-core.mjs?scene3d-patch-response=${++bridgeId}`,import.meta.url));
  const memory = new WebAssembly.Memory({initial:40}), instantiate = WebAssembly.instantiate;
  let inputLength=0,outputLength=0;
  try {
    WebAssembly.instantiate = async()=>({instance:{exports:{memory,viento_core_protocol_version:()=>1,
      viento_core_scene_composition_version:()=>1,viento_core_scene_composition_definition_rename_version:()=>1,
      ...(patchVersion===null?{}:{viento_core_scene3d_patch_version:()=>patchVersion}),
      ...(parseVersion===null?{}:{viento_core_scene3d_version:()=>parseVersion}),
      viento_core_input:length=>{inputLength=length;return 16;},viento_core_run:()=>{
        const input=JSON.parse(new TextDecoder().decode(new Uint8Array(memory.buffer,16,inputLength)));
        const value=input.operation==='scene3d.patchObjectTransform'?(typeof response==='function'?response(input):response):wasm(input);
        const encoded=new TextEncoder().encode(JSON.stringify(value));outputLength=encoded.length;
        new Uint8Array(memory.buffer,1048576,encoded.length).set(encoded);return 1048576;
      },viento_core_output_len:()=>outputLength,
    }}});
    await module.initializeStudioCore(()=>new Uint8Array([1]));
  } finally {WebAssembly.instantiate=instantiate;}
  return module;
}
async function nativeSequence(inputs) {
  return new Promise((resolve,reject)=>{
    const child=spawn(nativePath,[],{stdio:['pipe','pipe','pipe']});let stdout='',stderr='',failure;
    const timer=setTimeout(()=>{failure=new Error('Native 3D transform parity timed out');child.kill('SIGKILL');},30000);
    child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
    child.stdout.on('data',text=>{stdout+=text;if(Buffer.byteLength(stdout)>16*1024*1024){failure=new Error('Native output budget exceeded');child.kill('SIGKILL');}});
    child.stderr.on('data',text=>{stderr=(stderr+text).slice(-4096);});child.stdin.on('error',error=>{failure||=error;});
    child.once('error',error=>{clearTimeout(timer);reject(error);});
    child.once('close',(code,signal)=>{clearTimeout(timer);if(failure)return reject(failure);try{assert.equal(signal,null);assert.equal(code,0,stderr);const outputs=stdout.trim().split('\n').map(JSON.parse);assert.equal(outputs.length,inputs.length);resolve(outputs);}catch(error){reject(error);}});
    child.stdin.end(inputs.map(input=>typeof input==='string'?input:JSON.stringify(input)).join('\n')+'\n');
  });
}

test('new transform capability requires its own optional version and the existing parse capability only',async()=>{
  assert.equal(nativeWasm.viento_core_scene3d_patch_version(),1);
  assert.equal(core.supportsStudioCoreScene3DPatch(),true);
  for(const version of [null,0,2]) {
    const module=await responseBridge(wasm(request()),version);
    assert.equal(module.supportsStudioCoreScene3DPatch(),false);
    assert.equal(module.supportsStudioCoreScene3D(),true);
    assert.throws(()=>module.dispatchStudioCoreScene3DPatch(request()),{errorCode:'studio_core_unavailable'});
    assert.deepEqual(module.dispatchStudioCoreScene3D(parseInput(serialize(sample()))),core.dispatchStudioCoreScene3D(parseInput(serialize(sample()))));
    assert.equal(module.supportsStudioCoreCompositionDefinitionRename(),true);
    assert.equal(module.getStudioCoreMetadata().ready,true);
  }
  for(const version of [null,0,2]) {
    const module=await responseBridge(wasm(request()),1,version);
    assert.equal(module.supportsStudioCoreScene3DPatch(),false);
    assert.throws(()=>module.dispatchStudioCoreScene3DPatch(request()),{errorCode:'studio_core_unavailable'});
    assert.equal(module.getStudioCoreMetadata().ready,true);
  }
});

test('the new operation is isolated from all old domains and admits no old parsing or geometry operation',()=>{
  for(const dispatch of [core.dispatchStudioCore,core.dispatchStudioCoreDraft,core.dispatchStudioCoreSource,core.dispatchStudioCoreScene3D,
    core.dispatchStudioCoreComposition,core.dispatchStudioCoreCompositionDefinitions,core.dispatchStudioCoreCompositionDefinitionLocations,
    core.dispatchStudioCoreCompositionDefinitionRename,core.dispatchStudioCoreCompositionGroups,core.dispatchStudioCoreCompositionPlacements,
    core.dispatchStudioCoreCompositionStructure])assert.throws(()=>dispatch(request()),{errorCode:'studio_core_request_invalid'});
  for(const operation of ['scene3d.parse','move','sceneSource.patch','sceneComposition.expand'])assert.throws(()=>patch({...request(),operation}),{errorCode:'studio_core_request_invalid'});
  assert.equal(core.getStudioCoreMetadata().ready,true);
});

test('net axes are replaced exactly in position rotationDegrees size XYZ order and retain unrelated objects',()=>{
  const input=request({size:[1.5,4,2],rotationDegrees:[30,25,-10],position:[3,1.5,-4]});
  const result=patch(input);assert.deepEqual(result,expected(input));assert.deepEqual(result,wasm(input).scene3dPatch);
  assert.deepEqual(result.changedPaths,['/objects/0/position/0','/objects/0/position/2','/objects/0/rotationDegrees/0','/objects/0/rotationDegrees/2','/objects/0/size/1','/objects/0/size/2']);
  assert.deepEqual(parsed(result.afterContent).objects[1],sample().objects[1]);assert.deepEqual(input,request({size:[1.5,4,2],rotationDegrees:[30,25,-10],position:[3,1.5,-4]}));
});

test('escaped keys and identity, Unicode, BOM CRLF and untouched exponent/negative-zero lexemes remain exact',()=>{
  const content=serialize(sample()).replace('"objects"','"objec\\u0074s"').replaceAll('"position"','"posi\\u0074ion"')
    .replace(id(1),'0000000\\u0031-1111-4111-8111-111111111111').replace('1000','1.000e3').replace('-2,','-2.00e0,')
    .replace('"rotationDegrees": [\r\n\t\t\t\t0,','"rotationDegrees": [\r\n\t\t\t\t-0e0,');
  const input=request({position:[-8.75,1.5,6.125]},content),result=patch(input);
  assert.deepEqual(result,expected(input));assert.match(result.afterContent,/1\.000e3/);assert.match(result.afterContent,/posi\\u0074ion/);
  assert.equal(result.beforeContent,content);
});

test('semantic no-op keeps the entire original text including exponent and signed zero with an empty path receipt',()=>{
  const content=serialize(sample()).replace('1000','1e3').replace('-2,','-2.000e0,').replace('"rotationDegrees": [\r\n\t\t\t\t0,','"rotationDegrees": [\r\n\t\t\t\t-0e0,');
  const result=patch(request({position:[-2,1.5,-0],rotationDegrees:[0,25,0],size:[1.5,3,1.5]},content));
  assert.deepEqual(result,{instanceId:id(1),beforeContent:content,afterContent:content,changedPaths:[]});assert.equal(core.getStudioCoreMetadata().ready,true);
});

test('triplets include all exact boundaries and signed subnormal/float values without dimension or unit conversion',()=>{
  for(const values of [{position:[-100000,5e-324,100000],rotationDegrees:[-36000,0,36000],size:[0.001,1,1000]},
    {position:[-0.0000001,2.2250738585072014e-308,12345.67890123456],rotationDegrees:[23,-41,67],size:[0.0010000000000001,99.125,0.25]}]) {
    const input=request(values),result=patch(input);assert.deepEqual(result,expected(input));
    for(const [field,value] of Object.entries(values))assert.deepEqual(parsed(result.afterContent).objects[0][field],value);
  }
});

test('exact request shape rejects getters, serializers, hidden keys, nonfinite and malformed vectors before native calls',()=>{
  let calls=0;const getter=request();Object.defineProperty(getter.values,'position',{enumerable:true,get(){calls++;return [1,2,3];}});
  const hidden=request();Object.defineProperty(hidden.values,'secret',{value:1,enumerable:false});
  const sparse=request();sparse.values.position=[1,,3];
  for(const input of [getter,hidden,sparse,{...request(),toJSON(){calls++;return request();}},{...request(),extra:true},
    {...request(),protocolVersion:2},{...request(),instanceId:null},request({}),request({color:'#ffffff'}),request({position:null}),
    request({position:[1,2]}),request({position:[1,2,3,4]}),request({position:[Infinity,2,3]}),request({size:[NaN,1,1]}),
    request({position:[100000.1,0,0]}),request({rotationDegrees:[0,-36000.1,0]}),request({size:[0,1,1]}),request({size:[1,1000.1,1]})]) {
    assert.throws(()=>patch(input),{errorCode:'studio_core_request_invalid'});
  }
  assert.equal(calls,0);assert.equal(core.getStudioCoreMetadata().ready,true);
});

test('unknown identity and complete malformed source retain native error semantics and leave the shared core ready',()=>{
  assert.throws(()=>patch(request({position:[1,2,3]},sample(),id(99))),{errorCode:'scene3d_patch_invalid'});
  for(const change of [v=>{v.objects[1].size=[0,1,1];},v=>{v.objects[1].instanceId=id(1);},v=>{v.camera.position=v.camera.target;},v=>{v.light.direction=[0,1,0];}]) {
    const value=sample();change(value);assert.throws(()=>patch(request({position:[-2,1.5,0]},value)),{errorCode:'scene3d_invalid'});
  }
  const content=serialize(sample()).replace('"schemaVersion": 1','"schemaVersion": 1, "schema\\u0056ersion": 1');
  assert.throws(()=>patch(request({position:[1,2,3]},content)),{errorCode:'scene3d_invalid'});
  assert.equal(core.getStudioCoreMetadata().ready,true);
});

test('original/final UTF8 budget validates growth atomically and accepts shrinking and no-op source at the exact bound',()=>{
  let content=serialize(sample());content+=' '.repeat(131072-Buffer.byteLength(content));
  assert.equal(patch(request({position:[-2,1.5,0]},content)).afterContent,content);
  assert.throws(()=>patch(request({position:[-100000,1.5,0]},content)),{errorCode:'scene3d_limit'});
  assert.ok(Buffer.byteLength(patch(request({position:[0,1.5,0]},content)).afterContent)<131072);
  assert.throws(()=>patch(request({position:[0,1.5,0]},content+' ')),{errorCode:'scene3d_limit'});
  assert.equal(core.getStudioCoreMetadata().ready,true);
});

test('malformed forged success envelopes identity before source and changed-path inventories poison only that bridge',async()=>{
  const input=request(),good=wasm(input);
  for(const mutate of [r=>{r.extra=true;},r=>{r.scene3dPatch.extra=true;},r=>{delete r.scene3dPatch.beforeContent;},
    r=>{r.scene3dPatch.instanceId=id(2);},r=>{r.scene3dPatch.beforeContent+=' ';},r=>{r.scene3dPatch.changedPaths=null;},
    r=>{r.scene3dPatch.changedPaths.reverse();},r=>r.scene3dPatch.changedPaths.push('/objects/0/position/0'),
    r=>{r.scene3dPatch.changedPaths[0]='/objects/1/position/0';},r=>{r.scene3dPatch.afterContent=input.content;},
    r=>{r.scene3dPatch.afterContent+=' '.repeat(131072);},r=>{r.scene3dPatch.afterContent=null;}]) {
    const response=structuredClone(good);mutate(response);const module=await responseBridge(response);
    assert.throws(()=>module.dispatchStudioCoreScene3DPatch(input),{errorCode:'studio_core_unavailable'});assert.equal(module.getStudioCoreMetadata().ready,false);
  }
  assert.equal(core.getStudioCoreMetadata().ready,true);
});

test('byte inventory rejects unrequested whitespace strings key spellings and numerically equal reformatting',async()=>{
  const input=request(),good=wasm(input);
  for(const mutate of [text=>text+' ',text=>text.replace('\r\n','\n'),text=>text.replace('"objects"','"objec\\u0074s"'),
    text=>text.replace('Transforms','Changed'),text=>text.replace('1000','1e3'),text=>text.replace('"schemaVersion": 1','"schemaVersion": 1.0')]) {
    const response=structuredClone(good);response.scene3dPatch.afterContent=mutate(response.scene3dPatch.afterContent);
    const module=await responseBridge(response);assert.throws(()=>module.dispatchStudioCoreScene3DPatch(input),{errorCode:'studio_core_unavailable'});
  }
});

test('complete native model comparison rejects lexically plausible edits to another object camera or wrong requested axes',async()=>{
  const input=request(),good=wasm(input);
  for(const mutate of [text=>text.replace('100,','101,'),text=>text.replace('"fovDegrees": 60','"fovDegrees": 61'),
    text=>text.replace('3,\r\n\t\t\t\t1.5,\r\n\t\t\t\t-4','4,\r\n\t\t\t\t1.5,\r\n\t\t\t\t-3')]) {
    const response=structuredClone(good),before=response.scene3dPatch.afterContent;response.scene3dPatch.afterContent=mutate(before);
    assert.notEqual(response.scene3dPatch.afterContent,before);
    const module=await responseBridge(response);assert.throws(()=>module.dispatchStudioCoreScene3DPatch(input),{errorCode:'studio_core_unavailable'});
  }
});

test('forged semantic no-op normalization is rejected while an exact genuine no-op is accepted',async()=>{
  const content=serialize(sample()).replace('-2,','-2.0,');const input=request({position:[-2,1.5,0]},content),good=wasm(input);
  const valid=await responseBridge(good);assert.deepEqual(valid.dispatchStudioCoreScene3DPatch(input),good.scene3dPatch);
  const response=structuredClone(good);response.scene3dPatch.afterContent=content.replace('-2.0,','-2,');
  const module=await responseBridge(response);assert.throws(()=>module.dispatchStudioCoreScene3DPatch(input),{errorCode:'studio_core_unavailable'});
});

test('new stateless calls leave existing geometry draft/history and old scene parse identity untouched',()=>{
  const created=core.dispatchStudioCoreDraft({protocolVersion:1,operation:'layoutDraft.create',actors:[{objectId:'live-layout',position:[10.125,20.25]}]});
  try {
    const before=core.dispatchStudioCoreDraft({protocolVersion:1,operation:'layoutDraft.read',draftId:created.draftId});
    for(let n=0;n<5;n++)patch(request({position:[n,1.5,0]}));
    assert.deepEqual(core.dispatchStudioCoreDraft({protocolVersion:1,operation:'layoutDraft.read',draftId:created.draftId}),before);
    assert.deepEqual(core.dispatchStudioCoreScene3D(parseInput(serialize(sample()))).model,{...sample(),format:'viento-scene3d-model'});
  } finally {core.dispatchStudioCoreDraft({protocolVersion:1,operation:'layoutDraft.close',draftId:created.draftId});}
});

test('fresh native CLI and actual WASM agree on patch exact bytes errors duplicates boundaries no-op and old parse',{skip:!nativeAvailable},async()=>{
  let full=serialize(sample());full+=' '.repeat(131072-Buffer.byteLength(full));
  const bad=sample();bad.objects[1].size=[0,1,1];
  const raw=JSON.stringify(request()),duplicates=[raw.replace('"values":','"values":{},"val\\u0075es":'),
    raw.replace('"position":[3,1.5,-4]','"position":[0,0,0],"posi\\u0074ion":[3,1.5,-4]')];
  const inputs=[request(),request({position:[-2,1.5,0]}),request({size:[0.001,1000,1]}),request({rotationDegrees:[-36000,25,36000]}),
    request({position:[5e-324,1.5,0]}),request({}),request({position:[1,2]}),request({size:[0,1,1]}),request({position:[1,2,3]},sample(),id(99)),
    request({position:[1,2,3]},bad),request({position:[-2,1.5,0]},full),request({position:[-100000,1.5,0]},full),
    request({position:[0,1.5,0]},full),request({position:[0,1.5,0]},full+' '),{...request(),extra:true},...duplicates,parseInput(serialize(sample()))];
  assert.deepEqual(await nativeSequence(inputs),inputs.map(wasm));assert.equal(inputs.length,18);
});
