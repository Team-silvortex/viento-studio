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
const nativePath = process.env.VIENTO_STUDIO_CORE_BIN || fileURLToPath(new URL('../../desktop/.cache/scene3d-translation-core-target/debug/viento-core', import.meta.url));
let nativeAvailable = true;
try { await fs.access(nativePath, constants.X_OK); } catch { nativeAvailable = false; }
const clone = value => JSON.parse(JSON.stringify(value));
const id = n => `${n.toString(16).padStart(8, '0')}-1111-4111-8111-111111111111`;
const serialize = value => '\uFEFF' + JSON.stringify(value, null, '\t').replaceAll('\n', '\r\n') + '\r\n \t';
const parsed = content => JSON.parse(content.replace(/^\uFEFF/, ''));
function sample() {
  return { format:'viento-scene3d',schemaVersion:1,name:'Translation / 平移 / 移動 🦊',viewport:[800,600],background:'#0d1829',
    camera:{position:[8,6,8],target:[0,0,0],fovDegrees:60,near:.05,far:1000},light:{direction:[-1,-2,-1],color:'#ffffff',energy:1},
    objects:[[-2,1.5,0],[100,20,30],[0,0,0]].map((position,index)=>({instanceId:id(index+1),name:`Box ${index} 箱🦊`,primitive:'box',position,
      rotationDegrees:[23,-41,67],size:[1.5,3,1.5],color:'#87d8b9'})) };
}
const request = (offset=[1.25,-2,3], content=sample(), instanceIds=[id(3),id(1)]) => ({protocolVersion:1,operation:'scene3d.translateObjects',content:typeof content==='string'?content:serialize(content),instanceIds,offset});
const patch = input => core.dispatchStudioCoreScene3DTranslationPatch(input);
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
  const value=parsed(input.content),selected=new Set(input.instanceIds),indexed=parseJsonSource(input.content),edits=[],changedPaths=[],instanceIds=[];
  for(const [index,object] of value.objects.entries()) {
    if(!selected.has(object.instanceId))continue;instanceIds.push(object.instanceId);
    for(let axis=0;axis<3;axis++) {
      const next=object.position[axis]+input.offset[axis];if(next===object.position[axis])continue;
      const path=`/objects/${index}/position/${axis}`,range=locateJsonSource(indexed,path);assert.equal(range.exact,true);
      edits.push({...range,text:JSON.stringify(next)});changedPaths.push(path);
    }
  }
  let afterContent=input.content;
  for(const edit of edits.sort((a,b)=>b.start-a.start))afterContent=afterContent.slice(0,edit.start)+edit.text+afterContent.slice(edit.end);
  return {instanceIds,offset:clone(input.offset),beforeContent:input.content,afterContent,changedPaths};
}
let bridgeId=0;
async function responseBridge(response,translationVersion=1,parseVersion=1) {
  const module=await import(new URL(`../../engine/studio-core.mjs?scene3d-translation-response=${++bridgeId}`,import.meta.url));
  const memory=new WebAssembly.Memory({initial:40}),instantiate=WebAssembly.instantiate;let inputLength=0,outputLength=0;
  try {
    WebAssembly.instantiate=async()=>({instance:{exports:{memory,viento_core_protocol_version:()=>1,
      viento_core_scene3d_patch_version:()=>1,viento_core_scene3d_objects_version:()=>1,viento_core_scene3d_environment_version:()=>1,viento_core_scene3d_properties_version:()=>1,
      ...(translationVersion===null?{}:{viento_core_scene3d_translation_version:()=>translationVersion}),...(parseVersion===null?{}:{viento_core_scene3d_version:()=>parseVersion}),
      viento_core_input:length=>{inputLength=length;return 16;},viento_core_run:()=>{
        const input=JSON.parse(new TextDecoder().decode(new Uint8Array(memory.buffer,16,inputLength)));
        const value=input.operation==='scene3d.translateObjects'?(typeof response==='function'?response(input):response):wasm(input);
        const encoded=new TextEncoder().encode(JSON.stringify(value));outputLength=encoded.length;new Uint8Array(memory.buffer,1048576,encoded.length).set(encoded);return 1048576;
      },viento_core_output_len:()=>outputLength}}});
    await module.initializeStudioCore(()=>new Uint8Array([1]));
  } finally { WebAssembly.instantiate=instantiate; }
  return module;
}
async function nativeSequence(inputs) {
  return new Promise((resolve,reject)=>{
    const child=spawn(nativePath,[],{stdio:['pipe','pipe','pipe']});let stdout='',stderr='',failure;
    const timer=setTimeout(()=>{failure=Error('Translation native parity timeout');child.kill('SIGKILL');},30000);
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

test('translation probe is optional and parse-dependent without disabling old four author operations',async()=>{
  assert.equal(nativeWasm.viento_core_scene3d_translation_version(),1);assert.equal(core.supportsStudioCoreScene3DTranslationPatch(),true);
  for(const version of [null,0,2]) {
    const module=await responseBridge(wasm(request()),version);assert.equal(module.supportsStudioCoreScene3DTranslationPatch(),false);
    assert.throws(()=>module.dispatchStudioCoreScene3DTranslationPatch(request()),{errorCode:'studio_core_unavailable'});
    assert.deepEqual(module.dispatchStudioCoreScene3D(parseInput(serialize(sample()))),core.dispatchStudioCoreScene3D(parseInput(serialize(sample()))));
    for(const supports of [module.supportsStudioCoreScene3DPatch,module.supportsStudioCoreScene3DObjectsPatch,module.supportsStudioCoreScene3DEnvironmentPatch,module.supportsStudioCoreScene3DPropertiesPatch])assert.equal(supports(),true);
    assert.equal(module.getStudioCoreMetadata().ready,true);
  }
  for(const version of [null,0,2]) {
    const module=await responseBridge(wasm(request()),1,version);assert.equal(module.supportsStudioCoreScene3DTranslationPatch(),false);
    assert.throws(()=>module.dispatchStudioCoreScene3DTranslationPatch(request()),{errorCode:'studio_core_unavailable'});assert.equal(module.getStudioCoreMetadata().ready,true);
  }
});
test('predecessor WASM keeps all previous capabilities while translation alone is unavailable',async()=>{
  const predecessor=await fs.readFile(new URL('../../docs/test-results/scene3d-translation-authoring/previous-studio-core.wasm',import.meta.url));
  const module=await import(new URL(`../../engine/studio-core.mjs?scene3d-translation-predecessor=${++bridgeId}`,import.meta.url));await module.initializeStudioCore(()=>predecessor);
  assert.equal(module.supportsStudioCoreScene3DTranslationPatch(),false);assert.equal(module.supportsStudioCoreScene3D(),true);
  assert.equal(module.supportsStudioCoreScene3DPatch(),true);assert.equal(module.supportsStudioCoreScene3DObjectsPatch(),true);assert.equal(module.supportsStudioCoreScene3DEnvironmentPatch(),true);assert.equal(module.supportsStudioCoreScene3DPropertiesPatch(),true);
  assert.throws(()=>module.dispatchStudioCoreScene3DTranslationPatch(request()),{errorCode:'studio_core_unavailable'});
  assert.deepEqual(module.dispatchStudioCoreScene3D(parseInput(serialize(sample()))),core.dispatchStudioCoreScene3D(parseInput(serialize(sample()))));
});
test('atomic translation has a closed operation domain separate from all existing scene and geometry interfaces',()=>{
  for(const dispatch of [core.dispatchStudioCore,core.dispatchStudioCoreDraft,core.dispatchStudioCoreSource,core.dispatchStudioCoreScene3D,core.dispatchStudioCoreScene3DPatch,
    core.dispatchStudioCoreScene3DObjectsPatch,core.dispatchStudioCoreScene3DEnvironmentPatch,core.dispatchStudioCoreScene3DPropertiesPatch,core.dispatchStudioCoreComposition,
    core.dispatchStudioCoreCompositionDefinitions,core.dispatchStudioCoreCompositionGroups,core.dispatchStudioCoreCompositionPlacements,core.dispatchStudioCoreCompositionStructure]) {
    assert.throws(()=>dispatch(request()),{errorCode:'studio_core_request_invalid'});
  }
  for(const operation of ['scene3d.parse','scene3d.patchObjectTransform','scene3d.patchObjects','scene3d.patchProperties','move'])assert.throws(()=>patch({...request(),operation}),{errorCode:'studio_core_request_invalid'});
  assert.equal(core.getStudioCoreMetadata().ready,true);
});
test('selected identities and net axes are canonical source ordered regardless of caller order',()=>{
  const input=request(),before=clone(input),result=patch(input);assert.deepEqual(result,expected(input));assert.deepEqual(result,wasm(input).scene3dTranslationPatch);
  assert.deepEqual(result.instanceIds,[id(1),id(3)]);assert.deepEqual(result.changedPaths,['/objects/0/position/0','/objects/0/position/1','/objects/0/position/2','/objects/2/position/0','/objects/2/position/1','/objects/2/position/2']);
  assert.deepEqual(input,before);assert.deepEqual(parsed(result.afterContent).objects[1],sample().objects[1]);
  const after=parsed(result.afterContent);assert.deepEqual(after.camera,sample().camera);assert.deepEqual(after.light,sample().light);
});
test('BOM CRLF escaped keys Unicode and unselected exponent and signed zero spellings are exact',()=>{
  let content=serialize(sample()).replaceAll('"position"','"posi\\u0074ion"').replace('"objects"','"objec\\u0074s"').replace(id(1),'0000000\\u0031-1111-4111-8111-111111111111').replace('1000','1.000e3');
  content=replaceValue(content,'/objects/0/position/0','-2.00e0');content=replaceValue(content,'/objects/0/position/2','-0e0');content=replaceValue(content,'/objects/1/position/0','1e2');
  const input=request([.125,0,0],content),result=patch(input);assert.deepEqual(result,expected(input));assert.match(result.afterContent,/-0e0/);assert.match(result.afterContent,/1e2/);assert.match(result.afterContent,/1\.000e3/);
});
test('zero and fully rounded offsets keep complete source while partial rounding still returns every selected target',()=>{
  const value=sample();value.objects[0].position=[100000,0,0];value.objects[2].position=[0,0,0];
  let content=serialize(value);content=replaceValue(content,'/objects/0/position/1','-0e0');content=replaceValue(content,'/objects/0/position/0','1e5');
  for(const input of [request([-0,0,0],content),request([5e-324,0,0],content,[id(1)])]) {
    const result=patch(input);assert.equal(result.afterContent,content);assert.deepEqual(result.changedPaths,[]);
  }
  const input=request([5e-324,0,0],content),result=patch(input);assert.deepEqual(result,expected(input));assert.deepEqual(result.instanceIds,[id(1),id(3)]);assert.deepEqual(result.changedPaths,['/objects/2/position/0']);
});
test('atomic final bounds reject one target overflow and exact two-hundred-thousand offsets remain usable',()=>{
  const value=sample();value.objects[2].position=[100000,0,0];assert.throws(()=>patch(request([1,0,0],value)),{errorCode:'scene3d_translation_invalid'});
  value.objects[0].position=[-100000,100000,0];const input=request([200000,-200000,100000],value,[id(1)]),result=patch(input);
  assert.deepEqual(parsed(result.afterContent).objects[0].position,[100000,-100000,100000]);assert.deepEqual(result,expected(input));assert.equal(core.getStudioCoreMetadata().ready,true);
});
test('all 128 stable targets are source ordered and full byte budgets are atomic before and after',()=>{
  const value=sample();value.objects=Array.from({length:128},(_,i)=>({...clone(value.objects[0]),instanceId:id(i+1),position:[i,0,0]}));
  const input=request([.5,0,0],value,value.objects.map(o=>o.instanceId).reverse()),result=patch(input);assert.equal(result.instanceIds.length,128);assert.equal(result.changedPaths.length,128);assert.equal(result.changedPaths[127],'/objects/127/position/0');assert.deepEqual(result,expected(input));
  let content=serialize(sample());content+=' '.repeat(131072-Buffer.byteLength(content));
  assert.equal(patch(request([0,0,0],content)).afterContent,content);assert.throws(()=>patch(request([.125,0,0],content)),{errorCode:'scene3d_limit'});
  assert.ok(Buffer.byteLength(patch(request([2,0,0],content,[id(1)])).afterContent)<131072);assert.throws(()=>patch(request([0,0,0],content+' ')),{errorCode:'scene3d_limit'});
});
test('strict request refuses accessors serializers hidden fields sparse or repeated identities and invalid triplets without reading them',()=>{
  let reads=0;const getter=request();Object.defineProperty(getter.instanceIds,'0',{enumerable:true,get(){reads++;return id(1);}});
  const serialized={...request(),toJSON(){reads++;return request();}},hidden=request();Object.defineProperty(hidden,'secret',{value:true});
  const sparse=request();sparse.offset=[1,,3];
  for(const input of [getter,serialized,hidden,sparse,{...request(),extra:true},{...request(),instanceIds:[]},{...request(),instanceIds:[id(1),id(1)]},
    {...request(),instanceIds:[id(1).toUpperCase().replace('00000001','AAAAAAAA')]},{...request(),instanceIds:[null]},request([1,2]),request([1,2,3,4]),request([Infinity,0,0]),request([200000.1,0,0]),request([NaN,0,0]),{...request(),protocolVersion:2}]) {
    assert.throws(()=>patch(input),{errorCode:'studio_core_request_invalid'});
  }
  assert.equal(reads,0);assert.equal(core.getStudioCoreMetadata().ready,true);
});
test('unknown IDs and invalid unselected declarations retain domain or existing source errors without poisoning runtime',()=>{
  assert.throws(()=>patch(request([0,0,0],sample(),[id(99)])),{errorCode:'scene3d_translation_invalid'});
  const bad=sample();bad.objects[1].size=[0,1,1];assert.throws(()=>patch(request([1,0,0],bad)),{errorCode:'scene3d_invalid'});
  const source=serialize(sample()).replace('"schemaVersion": 1','"schemaVersion": 1,"schema\\u0056ersion":1');assert.throws(()=>patch(request([1,0,0],source)),{errorCode:'scene3d_invalid'});assert.equal(core.getStudioCoreMetadata().ready,true);
});
test('malicious envelopes order offset source and path receipts fail closed in only the forged bridge',async()=>{
  const input=request(),good=wasm(input);
  for(const mutate of [r=>{r.extra=true;},r=>{r.scene3dTranslationPatch.extra=true;},r=>{r.scene3dTranslationPatch.instanceIds.reverse();},r=>{r.scene3dTranslationPatch.instanceIds.pop();},r=>{r.scene3dTranslationPatch.offset[0]=2;},r=>{r.scene3dTranslationPatch.beforeContent+=' ';},r=>{r.scene3dTranslationPatch.changedPaths.reverse();},r=>{r.scene3dTranslationPatch.changedPaths.push(r.scene3dTranslationPatch.changedPaths[0]);},r=>{r.scene3dTranslationPatch.afterContent=input.content;},r=>{delete r.scene3dTranslationPatch.offset;}]) {
    const response=clone(good);mutate(response);const module=await responseBridge(response);assert.throws(()=>module.dispatchStudioCoreScene3DTranslationPatch(input),{errorCode:'studio_core_unavailable'});assert.equal(module.getStudioCoreMetadata().ready,false);
  }
  assert.equal(core.getStudioCoreMetadata().ready,true);
});
test('numeric-only receipt witness keeps keys gaps formatting and all unrequested numeric lexemes immutable',async()=>{
  const input=request(),good=wasm(input);
  for(const mutate of [s=>s+' ',s=>s.replace('\r\n','\n'),s=>s.replace('"objects"','"objec\\u0074s"'),s=>s.replace('Translation','Changed'),s=>s.replace('1000','1e3'),s=>s.replace('"schemaVersion": 1','"schemaVersion": 1.0'),s=>s.replace('-0.75,','-0.7500,')]) {
    const response=clone(good),original=response.scene3dTranslationPatch.afterContent;response.scene3dTranslationPatch.afterContent=mutate(original);assert.notEqual(response.scene3dTranslationPatch.afterContent,original);
    const module=await responseBridge(response);assert.throws(()=>module.dispatchStudioCoreScene3DTranslationPatch(input),{errorCode:'studio_core_unavailable'});
  }
});
test('complete before-after model verification rejects another object environment or wrong requested position value',async()=>{
  const input=request(),good=wasm(input);
  for(const [path,value] of [['/objects/1/position/0','101'],['/camera/fovDegrees','61'],['/objects/0/position/0','9'],['/objects/0/rotationDegrees/0','24']]) {
    const response=clone(good);response.scene3dTranslationPatch.afterContent=replaceValue(response.scene3dTranslationPatch.afterContent,path,value);const module=await responseBridge(response);
    assert.throws(()=>module.dispatchStudioCoreScene3DTranslationPatch(input),{errorCode:'studio_core_unavailable'});
  }
});
test('key-swap and unchanged-token rewrites cannot hide behind semantically equal final values',async()=>{
  const value=sample();value.objects[0].position=[.5,3,1.5];const input=request([1,0,0],value,[id(1)]),good=wasm(input);
  assert.deepEqual(parsed(good.scene3dTranslationPatch.afterContent).objects[0].position,value.objects[0].size);
  const response=clone(good),content=response.scene3dTranslationPatch.afterContent,objectRange=locateJsonSource(parseJsonSource(content),'/objects/0');
  const object=content.slice(objectRange.start,objectRange.end).replace('"position"','"SWAP"').replace('"size"','"position"').replace('"SWAP"','"size"');
  response.scene3dTranslationPatch.afterContent=content.slice(0,objectRange.start)+object+content.slice(objectRange.end);
  assert.deepEqual(parsed(response.scene3dTranslationPatch.afterContent),parsed(content));const module=await responseBridge(response);assert.throws(()=>module.dispatchStudioCoreScene3DTranslationPatch(input),{errorCode:'studio_core_unavailable'});
  const noop=request([0,0,0],serialize(sample()).replace('-2,','-2.0,')),goodNoop=wasm(noop),valid=await responseBridge(goodNoop);assert.deepEqual(valid.dispatchStudioCoreScene3DTranslationPatch(noop),goodNoop.scene3dTranslationPatch);
  goodNoop.scene3dTranslationPatch.afterContent=goodNoop.scene3dTranslationPatch.afterContent.replace('-2.0,','-2,');const forged=await responseBridge(goodNoop);assert.throws(()=>forged.dispatchStudioCoreScene3DTranslationPatch(noop),{errorCode:'studio_core_unavailable'});
});
test('translation is stateless and does not alter an existing native geometry draft or older primitive plan',()=>{
  const draft=core.dispatchStudioCoreDraft({protocolVersion:1,operation:'layoutDraft.create',actors:[{objectId:'translation-isolated',position:[12.5,7.25]}]});
  try {const before=core.dispatchStudioCoreDraft({protocolVersion:1,operation:'layoutDraft.read',draftId:draft.draftId});for(let n=0;n<3;n++)patch(request([n,0,0]));assert.deepEqual(core.dispatchStudioCoreDraft({protocolVersion:1,operation:'layoutDraft.read',draftId:draft.draftId}),before);}
  finally {core.dispatchStudioCoreDraft({protocolVersion:1,operation:'layoutDraft.close',draftId:draft.draftId});}
  assert.deepEqual(core.dispatchStudioCoreScene3D(parseInput(serialize(sample()))).model,{...sample(),format:'viento-scene3d-model'});
});
test('fresh native CLI and WASM agree on all atomic translations errors raw duplicate requests and predecessor parse',{skip:!nativeAvailable},async()=>{
  const value=sample();value.objects[0].position=[100000,0,0];const source=serialize(value),full=serialize(sample())+' '.repeat(131072-Buffer.byteLength(serialize(sample()))),raw=JSON.stringify(request());
  const inputs=[request(),request([0,0,0]),request([5e-324,0,0],source),request([1,0,0],source),request([200000,0,0]),request([-200000,0,0]),
    request([.125,0,0],full),request([2,0,0],full,[id(1)]),request([0,0,0],full+' '),request([1,2]),request([Infinity,0,0]),
    request([0,0,0],sample(),[]),request([0,0,0],sample(),[id(1),id(1)]),request([0,0,0],sample(),[id(99)]),{...request(),extra:true},
    raw.replace('"offset":','"off\\u0073et":[0,0,0],"offset":'),raw.replace('"instanceIds":','"instanceIds":[],"instance\\u0049ds":'),
    parseInput(serialize(sample())),{protocolVersion:1,operation:'scene3d.patchObjectTransform',content:serialize(sample()),instanceId:id(1),values:{position:[3,1.5,0]}},
    {protocolVersion:1,operation:'scene3d.patchProperties',content:serialize(sample()),instanceId:id(1),values:{name:'Compatible'}}];
  assert.equal(inputs.length,20);assert.deepEqual(await nativeSequence(inputs),inputs.map(wasm));
});
