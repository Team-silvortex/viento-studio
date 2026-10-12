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
const nativePath = process.env.VIENTO_STUDIO_CORE_BIN || fileURLToPath(new URL('../../desktop/.cache/scene3d-environment-core-target/debug/viento-core', import.meta.url));
let nativeAvailable = true;
try { await fs.access(nativePath, constants.X_OK); } catch { nativeAvailable = false; }
const clone = value => JSON.parse(JSON.stringify(value));
const id = n => `${n.toString(16).padStart(8, '0')}-1111-4111-8111-111111111111`;
const serialize = value => '\uFEFF' + JSON.stringify(value, null, '\t').replaceAll('\n', '\r\n') + '\r\n \t';
const parsed = content => JSON.parse(content.replace(/^\uFEFF/, ''));
function sample() {
  return { format:'viento-scene3d', schemaVersion:1, name:'Environment / 環境 / 原文🦊', viewport:[800,600], background:'#0d1829',
    camera:{position:[8,6,8],target:[0,0,0],fovDegrees:60,near:0.05,far:1000},
    light:{direction:[-1,-2,-1],color:'#ffffff',energy:1},objects:[
      {instanceId:id(1),name:'Original "objects" \\ 🦊',primitive:'box',position:[-2,1.5,0],rotationDegrees:[0,25,0],size:[1.5,3,1.5],color:'#87d8b9'},
      {instanceId:id(2),name:'Other',primitive:'box',position:[100,20,30],rotationDegrees:[15,20,30],size:[1,2,3],color:'#FFFFFF'},
    ] };
}
const request = (values={background:'#102030'}, content=sample()) => ({protocolVersion:1,operation:'scene3d.patchEnvironment',content:typeof content==='string'?content:serialize(content),values});
const patch = input => core.dispatchStudioCoreScene3DEnvironmentPatch(input);
const parseInput = content => ({protocolVersion:1,operation:'scene3d.parse',content});
function wasm(input) {
  const encoded = new TextEncoder().encode(typeof input==='string'?input:JSON.stringify(input));
  const pointer = nativeWasm.viento_core_input(encoded.length) >>> 0;
  new Uint8Array(nativeWasm.memory.buffer,pointer,encoded.length).set(encoded);
  const output = nativeWasm.viento_core_run() >>> 0, length = nativeWasm.viento_core_output_len();
  return JSON.parse(new TextDecoder('utf8',{fatal:true}).decode(new Uint8Array(nativeWasm.memory.buffer,output,length)));
}
const fields = [['background',false],['camera/position',true],['camera/target',true],['camera/fovDegrees',false],['camera/near',false],['camera/far',false],['light/direction',true],['light/color',false],['light/energy',false]];
function expected(input) {
  const before=parsed(input.content),indexed=parseJsonSource(input.content),edits=[],changedPaths=[];
  for(const [path,vector] of fields) {
    const keys=path.split('/'),old=keys.reduce((value,key)=>value?.[key],before),next=keys.reduce((value,key)=>value?.[key],input.values);
    if(next===undefined)continue;
    for(let axis=0;axis<(vector?3:1);axis++) {
      const prior=vector?old[axis]:old,value=vector?next[axis]:next;if(prior===value)continue;
      const propertyPath='/'+path+(vector?'/'+axis:''),range=locateJsonSource(indexed,propertyPath);
      assert.equal(range.exact,true);changedPaths.push(propertyPath);edits.push({...range,text:JSON.stringify(value)});
    }
  }
  let afterContent=input.content;
  for(const edit of edits.sort((a,b)=>b.start-a.start))afterContent=afterContent.slice(0,edit.start)+edit.text+afterContent.slice(edit.end);
  return {beforeContent:input.content,afterContent,changedPaths};
}
function sourceWithLexemes() {
  let content = serialize(sample()).replaceAll('"position"','"posi\\u0074ion"').replace('"background"','"backgrou\\u006ed"')
    .replace('#0d1829','#0d18\\u00329').replace('#ffffff','#ffff\\u0066f').replace('1000','1.000e3')
    .replace('"energy": 1','"energy": 1.00e0').replace('"target": [\r\n\t\t\t0,','"target": [\r\n\t\t\t-0e0,');
  const range=locateJsonSource(parseJsonSource(content),'/objects/0/position/0');
  content=content.slice(0,range.start)+'-2.00e0'+content.slice(range.end);return content;
}
let bridgeId=0;
async function responseBridge(response, environmentVersion=1, parseVersion=1) {
  const module=await import(new URL(`../../engine/studio-core.mjs?scene3d-environment-response=${++bridgeId}`,import.meta.url));
  const memory=new WebAssembly.Memory({initial:40}),instantiate=WebAssembly.instantiate;let inputLength=0,outputLength=0;
  try {
    WebAssembly.instantiate=async()=>({instance:{exports:{memory,viento_core_protocol_version:()=>1,
      viento_core_scene3d_patch_version:()=>1,viento_core_scene3d_objects_version:()=>1,viento_core_scene_composition_version:()=>1,
      ...(environmentVersion===null?{}:{viento_core_scene3d_environment_version:()=>environmentVersion}),
      ...(parseVersion===null?{}:{viento_core_scene3d_version:()=>parseVersion}),
      viento_core_input:length=>{inputLength=length;return 16;},viento_core_run:()=>{
        const input=JSON.parse(new TextDecoder().decode(new Uint8Array(memory.buffer,16,inputLength)));
        const value=input.operation==='scene3d.patchEnvironment'?(typeof response==='function'?response(input):response):wasm(input);
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
    const timer=setTimeout(()=>{failure=new Error('Native 3D environment parity timeout');child.kill('SIGKILL');},30000);
    child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
    child.stdout.on('data',text=>{stdout+=text;if(Buffer.byteLength(stdout)>16*1024*1024){failure=new Error('Native output budget exceeded');child.kill('SIGKILL');}});
    child.stderr.on('data',text=>{stderr=(stderr+text).slice(-4096);});child.stdin.on('error',error=>{failure||=error;});
    child.once('error',error=>{clearTimeout(timer);reject(error);});
    child.once('close',(code,signal)=>{clearTimeout(timer);if(failure)return reject(failure);try{assert.equal(signal,null);assert.equal(code,0,stderr);const outputs=stdout.trim().split('\n').map(JSON.parse);assert.equal(outputs.length,inputs.length);resolve(outputs);}catch(error){reject(error);}});
    child.stdin.end(inputs.map(input=>typeof input==='string'?input:JSON.stringify(input)).join('\n')+'\n');
  });
}

test('environment capability is independently optional and requires old parse probe version one',async()=>{
  assert.equal(nativeWasm.viento_core_scene3d_environment_version(),1);assert.equal(core.supportsStudioCoreScene3DEnvironmentPatch(),true);
  for(const version of [null,0,2]) {
    const module=await responseBridge(wasm(request()),version);
    assert.equal(module.supportsStudioCoreScene3DEnvironmentPatch(),false);
    assert.throws(()=>module.dispatchStudioCoreScene3DEnvironmentPatch(request()),{errorCode:'studio_core_unavailable'});
    assert.deepEqual(module.dispatchStudioCoreScene3D(parseInput(serialize(sample()))),core.dispatchStudioCoreScene3D(parseInput(serialize(sample()))));
    assert.equal(module.supportsStudioCoreScene3DPatch(),true);assert.equal(module.supportsStudioCoreScene3DObjectsPatch(),true);
    assert.equal(module.getStudioCoreMetadata().ready,true);
  }
  for(const version of [null,0,2]) {
    const module=await responseBridge(wasm(request()),1,version);
    assert.equal(module.supportsStudioCoreScene3DEnvironmentPatch(),false);
    assert.throws(()=>module.dispatchStudioCoreScene3DEnvironmentPatch(request()),{errorCode:'studio_core_unavailable'});
    assert.equal(module.getStudioCoreMetadata().ready,true);
  }
});

test('new environment operation is isolated from old parsing transform objects 2D geometry and composition domains',()=>{
  for(const dispatch of [core.dispatchStudioCore,core.dispatchStudioCoreDraft,core.dispatchStudioCoreSource,core.dispatchStudioCoreScene3D,
    core.dispatchStudioCoreScene3DPatch,core.dispatchStudioCoreScene3DObjectsPatch,core.dispatchStudioCoreComposition,
    core.dispatchStudioCoreCompositionDefinitions,core.dispatchStudioCoreCompositionDefinitionLocations,core.dispatchStudioCoreCompositionDefinitionRename,
    core.dispatchStudioCoreCompositionGroups,core.dispatchStudioCoreCompositionPlacements,core.dispatchStudioCoreCompositionStructure])assert.throws(()=>dispatch(request()),{errorCode:'studio_core_request_invalid'});
  for(const operation of ['scene3d.parse','scene3d.patchObjects','scene3d.patchObjectTransform','sceneComposition.expand','move'])assert.throws(()=>patch({...request(),operation}),{errorCode:'studio_core_request_invalid'});
  assert.equal(core.getStudioCoreMetadata().ready,true);
});

test('atomic mixed background camera and light leaf changes follow canonical path order and exact source edits',()=>{
  const input=request({light:{energy:2,color:'#123456',direction:[2,-3,4]},camera:{far:4000,near:2,fovDegrees:70,target:[1,2,3],position:[9,7,6]},background:'#102030'});
  assert.deepEqual(patch(input),expected(input));assert.deepEqual(patch(input),wasm(input).scene3dEnvironmentPatch);
  assert.deepEqual(patch(input).changedPaths,fields.flatMap(([path,vector])=>vector?[0,1,2].map(axis=>'/'+path+'/'+axis):['/'+path]));
  assert.deepEqual(input,request({light:{energy:2,color:'#123456',direction:[2,-3,4]},camera:{far:4000,near:2,fovDegrees:70,target:[1,2,3],position:[9,7,6]},background:'#102030'}));
});

test('partial vectors retain unchanged axes and all objects byte-for-byte including BOM CRLF escaped keys and exponents',()=>{
  const content=sourceWithLexemes(),input=request({background:'#aabbcc',camera:{position:[9,6,8],far:2000},light:{direction:[-1,-3,-1],color:'#fedcba'}},content);
  const result=patch(input);assert.deepEqual(result,expected(input));
  const prior=parseJsonSource(content),after=parseJsonSource(result.afterContent),a=locateJsonSource(prior,'/objects'),b=locateJsonSource(after,'/objects');
  assert.equal(content.slice(a.start,a.end),result.afterContent.slice(b.start,b.end));assert.match(result.afterContent,/-2\.00e0/);
  assert.match(result.afterContent,/posi\\u0074ion/);assert.equal(result.changedPaths.length,5);
});

test('semantic no-op preserves exponent negative zero escaped colors and entire raw content without poisoning',()=>{
  const content=sourceWithLexemes();const result=patch(request({background:'#0d1829',camera:{position:[8,6,8],target:[-0,0,0],far:1000},light:{direction:[-1,-2,-1],color:'#ffffff',energy:1}},content));
  assert.deepEqual(result,{beforeContent:content,afterContent:content,changedPaths:[]});assert.equal(core.getStudioCoreMetadata().ready,true);
});

test('near-only may fail while near and far together are validated atomically against the final camera',()=>{
  assert.throws(()=>patch(request({camera:{near:2000}})),{errorCode:'scene3d_environment_invalid'});
  assert.equal(core.getStudioCoreMetadata().ready,true);
  const input=request({camera:{near:2000,far:4000}});assert.deepEqual(patch(input),expected(input));
});

test('position and target can both move when the intermediate old target would make the camera invalid',()=>{
  assert.throws(()=>patch(request({camera:{position:[0,0,0]}})),{errorCode:'scene3d_environment_invalid'});
  const input=request({camera:{position:[0,0,0],target:[8,6,8]}});assert.deepEqual(patch(input),expected(input));
});

test('complete native cross-field camera and light constraints reject zero vertical and invalid plane candidates',()=>{
  for(const values of [{camera:{target:[8,7,8]}},{camera:{target:[8,6,8]}},{camera:{near:0}},{camera:{near:10001,far:20000}},
    {camera:{fovDegrees:180}},{camera:{far:100001}},{light:{direction:[0,0,0]}},{light:{direction:[0,-2,0]}},{light:{energy:17}}])assert.throws(()=>patch(request(values)),{errorCode:'scene3d_environment_invalid'});
  assert.equal(core.getStudioCoreMetadata().ready,true);
});

test('native final parsing handles original numeric boundaries subnormal light and clipped camera together',()=>{
  for(const values of [{camera:{near:0.001,far:100000,fovDegrees:1},light:{energy:0}},
    {camera:{near:10000,far:10100,fovDegrees:179},light:{energy:16,direction:[5e-324,0,0]}},
    {camera:{position:[-100000,0,100000],target:[100000,0,-100000]},background:'#ABCDEF'}])assert.deepEqual(patch(request(values)),expected(request(values)));
});

test('strict nested DTO rejects empty null extra fields getters serializers hidden attributes and sparse nonfinite vectors',()=>{
  let calls=0;const getter=request();Object.defineProperty(getter.values,'camera',{enumerable:true,get(){calls++;return {near:1};}});
  const nested=request({camera:{near:1}});Object.defineProperty(nested.values.camera,'near',{enumerable:true,get(){calls++;return 1;}});
  const hidden=request({light:{energy:2}});Object.defineProperty(hidden.values.light,'secret',{value:true,enumerable:false});
  const sparse=request({camera:{target:[1,,3]}});
  for(const input of [getter,nested,hidden,sparse,{...request(),toJSON(){calls++;return request();}},{...request(),extra:true},
    {...request(),protocolVersion:2},request({}),request(null),request({camera:{}}),request({light:{}}),request({camera:null}),request({light:null}),
    request({camera:{near:null}}),request({light:{energy:NaN}}),request({camera:{position:[1,2,Infinity]}}),request({camera:{up:[0,1,0]}}),
    request({background:'white'}),request({objects:[]}),request({light:{direction:[1,2]}}),request({light:{direction:[1,2,'3']}})])assert.throws(()=>patch(input),{errorCode:'studio_core_request_invalid'});
  assert.equal(calls,0);assert.equal(core.getStudioCoreMetadata().ready,true);
});

function duplicateRequests() {
  const common=`"protocolVersion":1,"operation":"scene3d.patchEnvironment","content":${JSON.stringify(serialize(sample()))}`;
  return [`{${common},"values":{"camera":null,"cam\\u0065ra":{"near":2}}}`,
    `{${common},"values":{"camera":{"near":null,"ne\\u0061r":2}}}`,
    `{${common},"values":{"light":{"energy":1,"en\\u0065rgy":2}}}`,
    `{${common},"values":{"background":"#ffffff","background":"#123456"}}`,
    `{${common},"protocolVersion":1,"values":{"background":"#ffffff"}}`];
}

test('raw JSON duplicate decoded keys are rejected before native Value hides top values camera and light fields',()=>{
  for(const input of duplicateRequests()){const result=wasm(input);assert.equal(result.ok,false);assert.equal(result.errorCode,'studio_core_request_invalid');}
});

test('source camera and light field order and escaped keys never determine canonical changedPath order',()=>{
  const value=sample();value.camera='__CAMERA__';value.light='__LIGHT__';
  const content=serialize(value).replace('"__CAMERA__"','{"far":1e3,"near":0.05,"fovDegrees":60,"target":[0,-0e0,0],"posi\\u0074ion":[8,6,8]}')
    .replace('"__LIGHT__"','{"energy":1e0,"color":"#ffffff","direction":[-1,-2,-1]}');
  const input=request({light:{energy:2,direction:[-1,-3,-1]},camera:{far:2000,position:[9,6,8]},background:'#aabbcc'},content);
  const result=patch(input);assert.deepEqual(result,expected(input));
  assert.deepEqual(result.changedPaths,['/background','/camera/position/0','/camera/far','/light/direction/1','/light/energy']);
  assert.match(result.afterContent,/\[0,-0e0,0\]/);
});

test('invalid original full scene cannot be repaired and decoded source duplicates keep existing parse errors',()=>{
  const invalid=sample();invalid.objects[0].size=[0,1,1];
  assert.throws(()=>patch(request({background:'#ffffff'},invalid)),{errorCode:'scene3d_invalid'});
  const duplicate=serialize(sample()).replace('"background":','"background":"#ffffff","background":');
  assert.throws(()=>patch(request({background:'#ffffff'},duplicate)),{errorCode:'scene3d_invalid'});
  assert.equal(core.getStudioCoreMetadata().ready,true);
});

test('whole original and final UTF8 budget allows exact no-op and shrink but rejects growth atomically',()=>{
  let content=serialize(sample());content+=' '.repeat(128*1024-Buffer.byteLength(content));assert.equal(Buffer.byteLength(content),128*1024);
  assert.equal(patch(request({camera:{far:1000}},content)).afterContent,content);
  assert.throws(()=>patch(request({camera:{far:10000}},content)),{errorCode:'scene3d_limit'});
  assert.equal(Buffer.byteLength(patch(request({camera:{far:100}},content)).afterContent),128*1024-1);
  assert.throws(()=>patch(request({camera:{far:100}},content+' ')),{errorCode:'scene3d_limit'});
  assert.equal(core.getStudioCoreMetadata().ready,true);
});

test('receipt envelope exact fields before source canonical paths budget and no-op all bind the request',async()=>{
  const input=request({camera:{near:2},background:'#102030'}),good=wasm(input);
  const mutations=[result=>{result.extra=true;},result=>{result.scene3dEnvironmentPatch.extra=true;},result=>{delete result.scene3dEnvironmentPatch.beforeContent;},
    result=>{result.scene3dEnvironmentPatch.beforeContent+=' ';},result=>{result.scene3dEnvironmentPatch.changedPaths.reverse();},
    result=>{result.scene3dEnvironmentPatch.changedPaths=['/objects/0/position/0'];},result=>{result.scene3dEnvironmentPatch.afterContent=input.content;},
    result=>{result.scene3dEnvironmentPatch.afterContent=' '.repeat(128*1024+1);},result=>{result.scene3dEnvironmentPatch.changedPaths=[];}];
  for(const mutate of mutations){const result=clone(good);mutate(result);const module=await responseBridge(result);assert.throws(()=>module.dispatchStudioCoreScene3DEnvironmentPatch(input),{errorCode:'studio_core_unavailable'});assert.equal(module.getStudioCoreMetadata().ready,false);}
  const noop=request({camera:{near:0.05}}),module=await responseBridge(input=>{const result=wasm(input);result.scene3dEnvironmentPatch.afterContent+=' ';return result;});
  assert.throws(()=>module.dispatchStudioCoreScene3DEnvironmentPatch(noop),{errorCode:'studio_core_unavailable'});
});

test('success cannot alter an unrequested complete object viewport name or environment semantic value',async()=>{
  const input=request({background:'#102030'});
  for(const change of [value=>{value.objects[0].position[0]=7;},value=>{value.viewport=[1024,600];},value=>{value.name+=' changed';},
    value=>{value.camera.near=2;},value=>{value.light.energy=3;}]) {
    const result=wasm(input),value=parsed(result.scene3dEnvironmentPatch.afterContent);change(value);result.scene3dEnvironmentPatch.afterContent=serialize(value);
    const module=await responseBridge(result);assert.throws(()=>module.dispatchStudioCoreScene3DEnvironmentPatch(input),{errorCode:'studio_core_unavailable'});
  }
});

test('success cannot normalize unchanged numeric string key or whitespace lexemes even when full semantics stay equal',async()=>{
  const input=request({background:'#102030'},sourceWithLexemes());
  for(const change of [text=>text.replace('1.000e3','1000'),text=>text.replace('-2.00e0','-2'),text=>text.replace('#ffff\\u0066f','#ffffff'),
    text=>text.replace('posi\\u0074ion','position'),text=>text.replace('\r\n','\n'),text=>text+' ']) {
    const result=wasm(input);result.scene3dEnvironmentPatch.afterContent=change(result.scene3dEnvironmentPatch.afterContent);
    const module=await responseBridge(result);assert.throws(()=>module.dispatchStudioCoreScene3DEnvironmentPatch(input),{errorCode:'studio_core_unavailable'});
  }
});

test('success cannot swap camera key slots instead of changing the exact requested numeric value leaves',async()=>{
  const value=sample();value.camera.position=[1,0,0];value.camera.target=[0,0,0];
  const input=request({camera:{position:[0,0,0],target:[1,0,0]}},value),good=wasm(input);
  assert.deepEqual(good.scene3dEnvironmentPatch.changedPaths,['/camera/position/0','/camera/target/0']);
  const forged=clone(good);forged.scene3dEnvironmentPatch.afterContent=input.content
    .replace('"position": [','"__KEY__": [').replace('"target": [','"position": [').replace('"__KEY__": [','"target": [');
  assert.deepEqual(parsed(forged.scene3dEnvironmentPatch.afterContent),parsed(good.scene3dEnvironmentPatch.afterContent));
  assert.equal(forged.scene3dEnvironmentPatch.afterContent.split('"__KEY__"').length,1);
  const module=await responseBridge(forged);
  assert.throws(()=>module.dispatchStudioCoreScene3DEnvironmentPatch(input),{errorCode:'studio_core_unavailable'});
  assert.equal(module.getStudioCoreMetadata().ready,false);
  assert.deepEqual(patch(input),expected(input));
});

test('stateless environment edits leave prior geometry history object edits and transform semantics unchanged',()=>{
  const draft=core.dispatchStudioCoreDraft({protocolVersion:1,operation:'layoutDraft.create',actors:[{objectId:'old-layout',position:[10.125,20.25]}]});
  try {
    const before=core.dispatchStudioCoreDraft({protocolVersion:1,operation:'layoutDraft.read',draftId:draft.draftId});
    for(const input of [request(),request({camera:{near:2,far:4000}}),request({light:{energy:1}})])patch(input);
    assert.deepEqual(core.dispatchStudioCoreDraft({protocolVersion:1,operation:'layoutDraft.read',draftId:draft.draftId}),before);
    const transform={protocolVersion:1,operation:'scene3d.patchObjectTransform',content:serialize(sample()),instanceId:id(1),values:{position:[1,2,3]}};
    assert.deepEqual(core.dispatchStudioCoreScene3DPatch(transform),wasm(transform).scene3dPatch);
    const copy={protocolVersion:1,operation:'scene3d.patchObjects',content:serialize(sample()),action:'copy',instanceId:id(1),newInstanceId:id(3),name:'Copied'};
    assert.deepEqual(core.dispatchStudioCoreScene3DObjectsPatch(copy),wasm(copy).scene3dObjectsPatch);
  } finally {core.dispatchStudioCoreDraft({protocolVersion:1,operation:'layoutDraft.close',draftId:draft.draftId});}
});

test('fresh native JSON CLI and real WASM agree on 20 environment lexical atomic invalid budget and old-domain requests',{skip:!nativeAvailable},async()=>{
  let exact=serialize(sample());exact+=' '.repeat(128*1024-Buffer.byteLength(exact));const invalid=sample();invalid.objects[0].size=[0,1,1];
  const inputs=[request(),request({camera:{near:2000,far:4000}}),request({camera:{position:[0,0,0],target:[8,6,8]}}),request({light:{direction:[5e-324,0,0],energy:16}}),
    request({background:'#0d1829',camera:{far:1000},light:{color:'#ffffff',energy:1}},sourceWithLexemes()),request({camera:{near:2000}}),
    request({camera:{target:[8,7,8]}}),request({light:{direction:[0,0,0]}}),request({light:{direction:[0,-2,0]}}),request({camera:{far:10000}},exact),
    request({camera:{far:100}},exact),request({},invalid),...duplicateRequests(),parseInput(sourceWithLexemes()),
    {protocolVersion:1,operation:'scene3d.patchObjectTransform',content:serialize(sample()),instanceId:id(1),values:{position:[1,2,3]}},
    {protocolVersion:1,operation:'scene3d.patchObjects',content:serialize(sample()),action:'copy',instanceId:id(1),newInstanceId:id(3),name:'Copied'}];
  assert.equal(inputs.length,20);assert.deepEqual(await nativeSequence(inputs),inputs.map(wasm));
});
