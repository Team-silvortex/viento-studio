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
const nativePath = process.env.VIENTO_STUDIO_CORE_BIN || fileURLToPath(new URL('../../desktop/.cache/scene3d-alignment-core-target/debug/viento-core', import.meta.url));
let nativeAvailable = true;
try { await fs.access(nativePath, constants.X_OK); } catch { nativeAvailable = false; }
const clone = value => JSON.parse(JSON.stringify(value));
const id = n => `${n.toString(16).padStart(8, '0')}-1111-4111-8111-111111111111`;
const serialize = value => '\uFEFF' + JSON.stringify(value, null, '\t').replaceAll('\n', '\r\n') + '\r\n \t';
const parsed = content => JSON.parse(content.replace(/^\uFEFF/, ''));
function sample() {
  return { format:'viento-scene3d',schemaVersion:1,name:'Alignment / 对齐 / 整列 🦊',viewport:[800,600],background:'#0d1829',
    camera:{position:[8,6,8],target:[0,0,0],fovDegrees:60,near:.05,far:1000},light:{direction:[-1,-2,-1],color:'#ffffff',energy:1},
    objects:[[-2,1.5,0],[100,20,30],[0,0,0]].map((position,index)=>({instanceId:id(index+1),name:`Box ${index} 箱🦊`,primitive:'box',position,
      rotationDegrees:[23,-41,67],size:[1.5,3,1.5],color:'#87d8b9'})) };
}
const request = (axis='x', content=sample(), instanceIds=[id(3),id(1)], anchorInstanceId=id(1)) => ({protocolVersion:1,operation:'scene3d.alignObjects',content:typeof content==='string'?content:serialize(content),instanceIds,anchorInstanceId,axis});
const patch = input => core.dispatchStudioCoreScene3DAlignmentPatch(input);
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
  const axis=['x','y','z'].indexOf(input.axis),reference=value.objects.find(object=>object.instanceId===input.anchorInstanceId).position[axis];
  for(const [index,object] of value.objects.entries()) {
    if(!selected.has(object.instanceId))continue;instanceIds.push(object.instanceId);
    if(reference===object.position[axis])continue;
    const path=`/objects/${index}/position/${axis}`,range=locateJsonSource(indexed,path);assert.equal(range.exact,true);
    edits.push({...range,text:JSON.stringify(reference)});changedPaths.push(path);
  }
  let afterContent=input.content;
  for(const edit of edits.sort((a,b)=>b.start-a.start))afterContent=afterContent.slice(0,edit.start)+edit.text+afterContent.slice(edit.end);
  return {instanceIds,anchorInstanceId:input.anchorInstanceId,axis:input.axis,beforeContent:input.content,afterContent,changedPaths};
}
let bridgeId=0;
async function responseBridge(response,alignmentVersion=1,parseVersion=1) {
  const module=await import(new URL(`../../engine/studio-core.mjs?scene3d-alignment-response=${++bridgeId}`,import.meta.url));
  const memory=new WebAssembly.Memory({initial:40}),instantiate=WebAssembly.instantiate;let inputLength=0,outputLength=0;
  try {
    WebAssembly.instantiate=async()=>({instance:{exports:{memory,viento_core_protocol_version:()=>1,
      viento_core_scene3d_translation_version:()=>1,viento_core_scene3d_patch_version:()=>1,viento_core_scene3d_objects_version:()=>1,viento_core_scene3d_environment_version:()=>1,viento_core_scene3d_properties_version:()=>1,
      ...(alignmentVersion===null?{}:{viento_core_scene3d_alignment_version:()=>alignmentVersion}),...(parseVersion===null?{}:{viento_core_scene3d_version:()=>parseVersion}),
      viento_core_input:length=>{inputLength=length;return 16;},viento_core_run:()=>{
        const input=JSON.parse(new TextDecoder().decode(new Uint8Array(memory.buffer,16,inputLength)));
        const value=input.operation==='scene3d.alignObjects'?(typeof response==='function'?response(input):response):wasm(input);
        const encoded=new TextEncoder().encode(JSON.stringify(value));outputLength=encoded.length;new Uint8Array(memory.buffer,1048576,encoded.length).set(encoded);return 1048576;
      },viento_core_output_len:()=>outputLength}}});
    await module.initializeStudioCore(()=>new Uint8Array([1]));
  } finally { WebAssembly.instantiate=instantiate; }
  return module;
}
async function nativeSequence(inputs) {
  return new Promise((resolve,reject)=>{
    const child=spawn(nativePath,[],{stdio:['pipe','pipe','pipe']});let stdout='',stderr='',failure;
    const timer=setTimeout(()=>{failure=Error('Alignment native parity timeout');child.kill('SIGKILL');},30000);
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

test('alignment probe is independent, parse-dependent and preserves every prior author operation',async()=>{
  assert.equal(nativeWasm.viento_core_scene3d_alignment_version(),1);assert.equal(core.supportsStudioCoreScene3DAlignmentPatch(),true);
  for(const version of [null,0,2]) {
    const module=await responseBridge(wasm(request()),version);assert.equal(module.supportsStudioCoreScene3DAlignmentPatch(),false);
    assert.throws(()=>module.dispatchStudioCoreScene3DAlignmentPatch(request()),{errorCode:'studio_core_unavailable'});
    assert.deepEqual(module.dispatchStudioCoreScene3D(parseInput(serialize(sample()))),core.dispatchStudioCoreScene3D(parseInput(serialize(sample()))));
    for(const supports of [module.supportsStudioCoreScene3DPatch,module.supportsStudioCoreScene3DObjectsPatch,module.supportsStudioCoreScene3DEnvironmentPatch,module.supportsStudioCoreScene3DPropertiesPatch,module.supportsStudioCoreScene3DTranslationPatch])assert.equal(supports(),true);
    assert.equal(module.getStudioCoreMetadata().ready,true);
  }
  for(const version of [null,0,2]) {const module=await responseBridge(wasm(request()),1,version);assert.equal(module.supportsStudioCoreScene3DAlignmentPatch(),false);assert.throws(()=>module.dispatchStudioCoreScene3DAlignmentPatch(request()),{errorCode:'studio_core_unavailable'});assert.equal(module.getStudioCoreMetadata().ready,true);}
});
test('real predecessor module retains five authoring domains while the new alignment alone is unavailable',async()=>{
  const predecessor=await fs.readFile(new URL('../../docs/test-results/scene3d-alignment-authoring/previous-studio-core.wasm',import.meta.url));
  const module=await import(new URL(`../../engine/studio-core.mjs?scene3d-alignment-predecessor=${++bridgeId}`,import.meta.url));await module.initializeStudioCore(()=>predecessor);
  assert.equal(module.supportsStudioCoreScene3DAlignmentPatch(),false);assert.equal(module.supportsStudioCoreScene3D(),true);
  for(const supports of [module.supportsStudioCoreScene3DPatch,module.supportsStudioCoreScene3DObjectsPatch,module.supportsStudioCoreScene3DEnvironmentPatch,module.supportsStudioCoreScene3DPropertiesPatch,module.supportsStudioCoreScene3DTranslationPatch])assert.equal(supports(),true);
  assert.throws(()=>module.dispatchStudioCoreScene3DAlignmentPatch(request()),{errorCode:'studio_core_unavailable'});
  assert.deepEqual(module.dispatchStudioCoreScene3D(parseInput(serialize(sample()))),core.dispatchStudioCoreScene3D(parseInput(serialize(sample()))));
});
test('alignment has a closed operation domain and cannot borrow translation, geometry or any old author dispatch',()=>{
  for(const dispatch of [core.dispatchStudioCore,core.dispatchStudioCoreDraft,core.dispatchStudioCoreSource,core.dispatchStudioCoreScene3D,core.dispatchStudioCoreScene3DPatch,core.dispatchStudioCoreScene3DObjectsPatch,core.dispatchStudioCoreScene3DEnvironmentPatch,core.dispatchStudioCoreScene3DPropertiesPatch,core.dispatchStudioCoreScene3DTranslationPatch,core.dispatchStudioCoreComposition])assert.throws(()=>dispatch(request()),{errorCode:'studio_core_request_invalid'});
  for(const operation of ['scene3d.translateObjects','scene3d.patchObjectTransform','scene3d.parse','align','move'])assert.throws(()=>patch({...request(),operation}),{errorCode:'studio_core_request_invalid'});
  assert.equal(core.getStudioCoreMetadata().ready,true);
});
test('all three axes copy the explicit selected reference in canonical source order and leave complete other semantics untouched',()=>{
  for(const axis of ['x','y','z']) {
    const input=request(axis,sample(),[id(3),id(2),id(1)],id(2)),before=clone(input),result=patch(input);
    assert.deepEqual(result,expected(input));assert.deepEqual(result,wasm(input).scene3dAlignmentPatch);assert.deepEqual(input,before);
    assert.deepEqual(result.instanceIds,[id(1),id(2),id(3)]);assert.equal(result.anchorInstanceId,id(2));assert.equal(result.axis,axis);
    const after=parsed(result.afterContent),reference=sample().objects[1].position[['x','y','z'].indexOf(axis)];
    for(const object of after.objects)assert.equal(object.position[['x','y','z'].indexOf(axis)],reference);
    assert.deepEqual(after.camera,sample().camera);assert.deepEqual(after.light,sample().light);
    for(const [index,object] of after.objects.entries())for(const key of ['rotationDegrees','size','instanceId','name','color','primitive'])assert.deepEqual(object[key],sample().objects[index][key]);
  }
});
test('only selected numeric value tokens change while BOM CRLF escaped keys IDs Unicode exponents and unselected zeros remain exact',()=>{
  let content=serialize(sample()).replaceAll('"position"','"posi\\u0074ion"').replace('"objects"','"objec\\u0074s"').replace(id(1),'0000000\\u0031-1111-4111-8111-111111111111').replace('1000','1.000e3');
  content=replaceValue(content,'/objects/0/position/0','-2.00e0');content=replaceValue(content,'/objects/0/position/2','-0e0');content=replaceValue(content,'/objects/1/position/0','1e2');
  const input=request('x',content),result=patch(input);assert.deepEqual(result,expected(input));assert.match(result.afterContent,/-2\.00e0/);assert.match(result.afterContent,/-0e0/);assert.match(result.afterContent,/1e2/);assert.match(result.afterContent,/1\.000e3/);
});
test('same-valued axes are native noops and retain distinct negative-zero exponent spellings and all requested identities',()=>{
  const value=sample();value.objects[0].position=[0,1.5,0];value.objects[2].position=[0,0,0];
  let content=serialize(value);content=replaceValue(content,'/objects/0/position/0','-0e0');content=replaceValue(content,'/objects/2/position/0','0.000e3');
  const result=patch(request('x',content));assert.equal(result.afterContent,content);assert.deepEqual(result.changedPaths,[]);assert.deepEqual(result.instanceIds,[id(1),id(3)]);
});
test('direct world coordinates include subnormal and extreme references without relative arithmetic or geometry effects',()=>{
  const value=sample();value.objects[0].position=[5e-324,-100000,100000];value.objects[2].position=[0,100000,-100000];
  for(const axis of ['x','y','z']) {const input=request(axis,value),result=patch(input);assert.deepEqual(result,expected(input));assert.equal(parsed(result.afterContent).objects[2].position[['x','y','z'].indexOf(axis)],value.objects[0].position[['x','y','z'].indexOf(axis)]);}
});
test('all 128 instances remain source ordered while the explicit anchor has no net path',()=>{
  const value=sample();value.objects=Array.from({length:128},(_,i)=>({...clone(value.objects[0]),instanceId:id(i+1),position:[i,0,0]}));
  const input=request('x',value,value.objects.map(o=>o.instanceId).reverse(),id(128)),result=patch(input);
  assert.equal(result.instanceIds.length,128);assert.equal(result.changedPaths.length,127);assert.equal(result.changedPaths[126],'/objects/126/position/0');assert.deepEqual(result,expected(input));
});
test('only final complete candidate budgets govern atomic grow-shrink, oversize rejection and no-op source retention',()=>{
  const value=sample();value.objects[0].position=[100000,0,0];value.objects[1].position=[0,0,0];value.objects[2].position=[-99999.99999999999,0,0];
  let content=serialize(value);content+=' '.repeat(131072-Buffer.byteLength(content));
  const combined=patch(request('x',content,[id(3),id(2),id(1)]));assert.ok(Buffer.byteLength(combined.afterContent)<131072);assert.deepEqual(combined,expected(request('x',content,[id(3),id(2),id(1)])));
  assert.throws(()=>patch(request('x',content,[id(2),id(1)])),{errorCode:'scene3d_limit'});
  assert.ok(Buffer.byteLength(patch(request('x',content,[id(1),id(2)],id(2))).afterContent)<131072);
  assert.equal(patch(request('y',content,[id(1),id(2)])).afterContent,content);
  assert.throws(()=>patch(request('y',content+' ',[id(1),id(2)])),{errorCode:'scene3d_limit'});
});
test('exact request admission rejects getters serializers hidden fields sparse IDs invalid reference and axis without invoking caller code',()=>{
  let reads=0;const getter=request();Object.defineProperty(getter.instanceIds,'0',{enumerable:true,get(){reads++;return id(1);}});
  const serialized={...request(),toJSON(){reads++;return request();}},hidden=request();Object.defineProperty(hidden,'secret',{value:true});const sparse=request();sparse.instanceIds=[id(1),,id(3)];
  for(const input of [getter,serialized,hidden,sparse,{...request(),extra:true},{...request(),instanceIds:[]},{...request(),instanceIds:[id(1)]},{...request(),instanceIds:[id(1),id(1)]},{...request(),instanceIds:[id(1),null]},
    {...request(),anchorInstanceId:id(2)}, {...request(),anchorInstanceId:null}, {...request(),anchorInstanceId:'AAAAAAAA-1111-4111-8111-111111111111'}, {...request(),axis:'X'},{...request(),axis:' x'},{...request(),axis:'left'},{...request(),axis:0},{...request(),axis:null},{...request(),protocolVersion:2}])assert.throws(()=>patch(input),{errorCode:'studio_core_request_invalid'});
  assert.equal(reads,0);assert.equal(core.getStudioCoreMetadata().ready,true);
});
test('unknown targets and invalid unselected source objects fail in their own domains without poisoning ready state',()=>{
  assert.throws(()=>patch(request('x',sample(),[id(99),id(1)])),{errorCode:'scene3d_alignment_invalid'});
  assert.throws(()=>patch(request('x',sample(),[id(99),id(1)],id(99))),{errorCode:'scene3d_alignment_invalid'});
  const bad=sample();bad.objects[1].size=[0,1,1];assert.throws(()=>patch(request('x',bad)),{errorCode:'scene3d_invalid'});
  const source=serialize(sample()).replace('"schemaVersion": 1','"schemaVersion": 1,"schema\\u0056ersion":1');assert.throws(()=>patch(request('x',source)),{errorCode:'scene3d_invalid'});assert.equal(core.getStudioCoreMetadata().ready,true);
});
test('malicious envelope target reference axis source and paths receipts fail closed only in the forged bridge',async()=>{
  const input=request(),good=wasm(input);
  for(const mutate of [r=>{r.extra=true;},r=>{r.scene3dAlignmentPatch.extra=true;},r=>{r.scene3dAlignmentPatch.instanceIds.reverse();},r=>{r.scene3dAlignmentPatch.instanceIds.pop();},r=>{r.scene3dAlignmentPatch.anchorInstanceId=id(3);},r=>{r.scene3dAlignmentPatch.axis='y';},r=>{r.scene3dAlignmentPatch.beforeContent+=' ';},r=>{r.scene3dAlignmentPatch.changedPaths.push(r.scene3dAlignmentPatch.changedPaths[0]);},r=>{r.scene3dAlignmentPatch.afterContent=input.content;},r=>{delete r.scene3dAlignmentPatch.axis;}]) {
    const response=clone(good);mutate(response);const module=await responseBridge(response);assert.throws(()=>module.dispatchStudioCoreScene3DAlignmentPatch(input),{errorCode:'studio_core_unavailable'});assert.equal(module.getStudioCoreMetadata().ready,false);
  }
  assert.equal(core.getStudioCoreMetadata().ready,true);
});
test('numeric receipt witness rejects hidden key gaps formatting and all unrequested numeric lexeme rewrites',async()=>{
  const input=request(),good=wasm(input);
  for(const mutate of [s=>s+' ',s=>s.replace('\r\n','\n'),s=>s.replace('"objects"','"objec\\u0074s"'),s=>s.replace('Alignment','Changed'),s=>s.replace('1000','1e3'),s=>s.replace('"schemaVersion": 1','"schemaVersion": 1.0'),s=>s.replace('-2,','-2.000,')]) {
    const response=clone(good),original=response.scene3dAlignmentPatch.afterContent;response.scene3dAlignmentPatch.afterContent=mutate(original);assert.notEqual(response.scene3dAlignmentPatch.afterContent,original);
    const module=await responseBridge(response);assert.throws(()=>module.dispatchStudioCoreScene3DAlignmentPatch(input),{errorCode:'studio_core_unavailable'});
  }
});
test('full after model verification rejects an unselected object environment geometry or wrong requested coordinate',async()=>{
  const input=request(),good=wasm(input);
  for(const [path,value] of [['/objects/1/position/0','101'],['/camera/fovDegrees','61'],['/objects/2/position/0','9'],['/objects/0/rotationDegrees/0','24']]) {
    const response=clone(good);response.scene3dAlignmentPatch.afterContent=replaceValue(response.scene3dAlignmentPatch.afterContent,path,value);const module=await responseBridge(response);assert.throws(()=>module.dispatchStudioCoreScene3DAlignmentPatch(input),{errorCode:'studio_core_unavailable'});
  }
});
test('semantic key swaps and no-op token normalization cannot hide behind equal final models',async()=>{
  const value=sample();value.objects[0].position=[1.5,3,1.5];value.objects[2].position=[.5,3,1.5];const input=request('x',value),good=wasm(input),response=clone(good),content=response.scene3dAlignmentPatch.afterContent;
  const range=locateJsonSource(parseJsonSource(content),'/objects/2'),object=content.slice(range.start,range.end).replace('"position"','"SWAP"').replace('"size"','"position"').replace('"SWAP"','"size"');response.scene3dAlignmentPatch.afterContent=content.slice(0,range.start)+object+content.slice(range.end);
  assert.deepEqual(parsed(response.scene3dAlignmentPatch.afterContent),parsed(content));const module=await responseBridge(response);assert.throws(()=>module.dispatchStudioCoreScene3DAlignmentPatch(input),{errorCode:'studio_core_unavailable'});
  value.objects[2].position=[1.5,3,1.5];const noop=request('x',serialize(value).replaceAll('1.5,','1.50e0,')),goodNoop=wasm(noop),valid=await responseBridge(goodNoop);assert.deepEqual(valid.dispatchStudioCoreScene3DAlignmentPatch(noop),goodNoop.scene3dAlignmentPatch);
  goodNoop.scene3dAlignmentPatch.afterContent=goodNoop.scene3dAlignmentPatch.afterContent.replace('1.50e0,','1.5,');const forged=await responseBridge(goodNoop);assert.throws(()=>forged.dispatchStudioCoreScene3DAlignmentPatch(noop),{errorCode:'studio_core_unavailable'});
});
test('alignment is stateless and cannot mutate an existing 2D geometry draft or older 3D parse plan',()=>{
  const draft=core.dispatchStudioCoreDraft({protocolVersion:1,operation:'layoutDraft.create',actors:[{objectId:'alignment-isolated',position:[12.5,7.25]}]});
  try{const before=core.dispatchStudioCoreDraft({protocolVersion:1,operation:'layoutDraft.read',draftId:draft.draftId});for(const axis of ['x','y','z'])patch(request(axis));assert.deepEqual(core.dispatchStudioCoreDraft({protocolVersion:1,operation:'layoutDraft.read',draftId:draft.draftId}),before);}finally{core.dispatchStudioCoreDraft({protocolVersion:1,operation:'layoutDraft.close',draftId:draft.draftId});}
  assert.deepEqual(core.dispatchStudioCoreScene3D(parseInput(serialize(sample()))).model,{...sample(),format:'viento-scene3d-model'});
});
test('fresh native CLI and WASM agree on atomic alignment, raw duplicate requests, limits and five prior domains',{skip:!nativeAvailable},async()=>{
  const value=sample();value.objects[0].position=[100000,0,0];value.objects[1].position=[0,0,0];value.objects[2].position=[-99999.99999999999,0,0];let full=serialize(value);full+=' '.repeat(131072-Buffer.byteLength(full));const raw=JSON.stringify(request());
  const inputs=[request(),request('y'),request('z',sample(),[id(1),id(2)],id(2)),request('x',value),request('x',sample(),[id(1)]),request('x',sample(),[]),request('x',sample(),[id(1),id(1)]),request('x',sample(),[id(99),id(1)]),request('x',sample(),[id(99),id(1)],id(99)),request('X'),{...request(),extra:true},
    request('x',full,[id(1),id(2)]),request('x',full,[id(1),id(2),id(3)]),request('x',full,[id(1),id(2)],id(2)),request('y',full+' '),
    raw.replace('"axis":','"ax\\u0069s":"y","axis":'),raw.replace('"anchorInstanceId":','"anchorInstanceId":null,"anchor\\u0049nstanceId":'),raw.replace('"instanceIds":','"instanceIds":[],"instance\\u0049ds":'),parseInput(serialize(sample())),
    {protocolVersion:1,operation:'scene3d.patchObjectTransform',content:serialize(sample()),instanceId:id(1),values:{position:[3,1.5,0]}},
    {protocolVersion:1,operation:'scene3d.patchProperties',content:serialize(sample()),instanceId:id(1),values:{name:'Compatible'}},
    {protocolVersion:1,operation:'scene3d.translateObjects',content:serialize(sample()),instanceIds:[id(1)],offset:[1,0,0]}];
  assert.equal(inputs.length,22);assert.deepEqual(await nativeSequence(inputs),inputs.map(wasm));
});
