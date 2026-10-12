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
const nativePath = process.env.VIENTO_STUDIO_CORE_BIN || fileURLToPath(new URL('../../desktop/.cache/scene3d-distribution-core-target/debug/viento-core', import.meta.url));
let nativeAvailable = true;
try { await fs.access(nativePath, constants.X_OK); } catch { nativeAvailable = false; }
const clone = value => JSON.parse(JSON.stringify(value));
const id = n => `${n.toString(16).padStart(8, '0')}-1111-4111-8111-111111111111`;
const serialize = value => '\uFEFF' + JSON.stringify(value, null, '\t').replaceAll('\n', '\r\n') + '\r\n \t';
const parsed = content => JSON.parse(content.replace(/^\uFEFF/, ''));
function sample() {
  return { format:'viento-scene3d',schemaVersion:1,name:'Distribution / 对齐 / 整列 🦊',viewport:[800,600],background:'#0d1829',
    camera:{position:[8,6,8],target:[0,0,0],fovDegrees:60,near:.05,far:1000},light:{direction:[-1,-2,-1],color:'#ffffff',energy:1},
    objects:[[10,3,4],[-8,8,2],[-10,-2,-3],[90,80,70]].map((position,index)=>({instanceId:id(index+1),name:`Box ${index} 箱🦊`,primitive:'box',position,
      rotationDegrees:[23,-41,67],size:[1.5,3,1.5],color:'#87d8b9'})) };
}
const request = (axis='x', content=sample(), instanceIds=[id(3),id(1),id(2)]) => ({protocolVersion:1,operation:'scene3d.distributeObjects',content:typeof content==='string'?content:serialize(content),instanceIds,axis});
const patch = input => core.dispatchStudioCoreScene3DDistributionPatch(input);
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
  const value=parsed(input.content),selected=new Set(input.instanceIds),indexed=parseJsonSource(input.content),edits=[],changedPaths=[],axis=['x','y','z'].indexOf(input.axis);
  const targets=value.objects.map((object,index)=>({object,index,coordinate:object.position[axis]})).filter(({object})=>selected.has(object.instanceId)),ordered=[...targets].sort((a,b)=>a.coordinate===b.coordinate?a.index-b.index:a.coordinate<b.coordinate?-1:1);
  const start=ordered[0].coordinate,end=ordered.at(-1).coordinate,span=end-start;
  for(const[rank,target]of ordered.entries())target.next=span===0||rank===0||rank===ordered.length-1?target.coordinate:start+span*(rank/(ordered.length-1));
  for(const target of targets)if(target.next!==target.coordinate){const path=`/objects/${target.index}/position/${axis}`,range=locateJsonSource(indexed,path);assert.equal(range.exact,true);edits.push({...range,text:JSON.stringify(target.next)});changedPaths.push(path);}
  let afterContent=input.content;for(const edit of edits.sort((a,b)=>b.start-a.start))afterContent=afterContent.slice(0,edit.start)+edit.text+afterContent.slice(edit.end);
  return {instanceIds:targets.map(t=>t.object.instanceId),orderedInstanceIds:ordered.map(t=>t.object.instanceId),axis:input.axis,beforeContent:input.content,afterContent,changedPaths};
}
let bridgeId=0;
async function responseBridge(response,distributionVersion=1,parseVersion=1) {
  const module=await import(new URL(`../../engine/studio-core.mjs?scene3d-distribution-response=${++bridgeId}`,import.meta.url));
  const memory=new WebAssembly.Memory({initial:40}),instantiate=WebAssembly.instantiate;let inputLength=0,outputLength=0;
  try {
    WebAssembly.instantiate=async()=>({instance:{exports:{memory,viento_core_protocol_version:()=>1,
      viento_core_scene3d_alignment_version:()=>1,viento_core_scene3d_translation_version:()=>1,viento_core_scene3d_patch_version:()=>1,viento_core_scene3d_objects_version:()=>1,viento_core_scene3d_environment_version:()=>1,viento_core_scene3d_properties_version:()=>1,
      ...(distributionVersion===null?{}:{viento_core_scene3d_distribution_version:()=>distributionVersion}),...(parseVersion===null?{}:{viento_core_scene3d_version:()=>parseVersion}),
      viento_core_input:length=>{inputLength=length;return 16;},viento_core_run:()=>{
        const input=JSON.parse(new TextDecoder().decode(new Uint8Array(memory.buffer,16,inputLength)));
        const value=input.operation==='scene3d.distributeObjects'?(typeof response==='function'?response(input):response):wasm(input);
        const encoded=new TextEncoder().encode(JSON.stringify(value));outputLength=encoded.length;new Uint8Array(memory.buffer,1048576,encoded.length).set(encoded);return 1048576;
      },viento_core_output_len:()=>outputLength}}});
    await module.initializeStudioCore(()=>new Uint8Array([1]));
  } finally { WebAssembly.instantiate=instantiate; }
  return module;
}
async function nativeSequence(inputs) {
  return new Promise((resolve,reject)=>{
    const child=spawn(nativePath,[],{stdio:['pipe','pipe','pipe']});let stdout='',stderr='',failure;
    const timer=setTimeout(()=>{failure=Error('Distribution native parity timeout');child.kill('SIGKILL');},30000);
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

test('distribution has an independent parse-dependent optional probe and preserves six prior authoring domains',async()=>{
  assert.equal(nativeWasm.viento_core_scene3d_distribution_version(),1);assert.equal(core.supportsStudioCoreScene3DDistributionPatch(),true);
  for(const version of [null,0,2]){const module=await responseBridge(wasm(request()),version);assert.equal(module.supportsStudioCoreScene3DDistributionPatch(),false);assert.throws(()=>module.dispatchStudioCoreScene3DDistributionPatch(request()),{errorCode:'studio_core_unavailable'});for(const supports of [module.supportsStudioCoreScene3DPatch,module.supportsStudioCoreScene3DObjectsPatch,module.supportsStudioCoreScene3DEnvironmentPatch,module.supportsStudioCoreScene3DPropertiesPatch,module.supportsStudioCoreScene3DTranslationPatch,module.supportsStudioCoreScene3DAlignmentPatch])assert.equal(supports(),true);assert.deepEqual(module.dispatchStudioCoreScene3D(parseInput(serialize(sample()))),core.dispatchStudioCoreScene3D(parseInput(serialize(sample()))));assert.equal(module.getStudioCoreMetadata().ready,true);}
  for(const version of [null,0,2]){const module=await responseBridge(wasm(request()),1,version);assert.equal(module.supportsStudioCoreScene3DDistributionPatch(),false);assert.throws(()=>module.dispatchStudioCoreScene3DDistributionPatch(request()),{errorCode:'studio_core_unavailable'});assert.equal(module.getStudioCoreMetadata().ready,true);}
});
test('actual predecessor module keeps parse and all six authoring operations while new distribution alone is unavailable',async()=>{
  const predecessor=await fs.readFile(new URL('../../docs/test-results/scene3d-distribution-authoring/previous-studio-core.wasm',import.meta.url)),module=await import(new URL(`../../engine/studio-core.mjs?distribution-predecessor=${++bridgeId}`,import.meta.url));await module.initializeStudioCore(()=>predecessor);
  assert.equal(module.supportsStudioCoreScene3DDistributionPatch(),false);assert.equal(module.supportsStudioCoreScene3D(),true);for(const supports of [module.supportsStudioCoreScene3DPatch,module.supportsStudioCoreScene3DObjectsPatch,module.supportsStudioCoreScene3DEnvironmentPatch,module.supportsStudioCoreScene3DPropertiesPatch,module.supportsStudioCoreScene3DTranslationPatch,module.supportsStudioCoreScene3DAlignmentPatch])assert.equal(supports(),true);assert.throws(()=>module.dispatchStudioCoreScene3DDistributionPatch(request()),{errorCode:'studio_core_unavailable'});
  const content=serialize(sample()),operations=[{operation:'scene3d.patchObjectTransform',instanceId:id(1),values:{position:[1,2,3]}},{operation:'scene3d.patchObjects',action:'copy',instanceId:id(1),newInstanceId:id(99),name:'Copy'},{operation:'scene3d.patchEnvironment',values:{background:'#234567'}},{operation:'scene3d.patchProperties',instanceId:id(1),values:{name:'Old'}},{operation:'scene3d.translateObjects',instanceIds:[id(1)],offset:[1,0,0]},{operation:'scene3d.alignObjects',instanceIds:[id(1),id(2)],anchorInstanceId:id(1),axis:'x'}];
  const dispatchers=[module.dispatchStudioCoreScene3DPatch,module.dispatchStudioCoreScene3DObjectsPatch,module.dispatchStudioCoreScene3DEnvironmentPatch,module.dispatchStudioCoreScene3DPropertiesPatch,module.dispatchStudioCoreScene3DTranslationPatch,module.dispatchStudioCoreScene3DAlignmentPatch];for(const[i,input]of operations.entries())assert.ok(dispatchers[i]({protocolVersion:1,content,...input}).afterContent);
});
test('closed distribution request cannot borrow any old authoring or geometry dispatch',()=>{
  for(const dispatch of [core.dispatchStudioCore,core.dispatchStudioCoreDraft,core.dispatchStudioCoreSource,core.dispatchStudioCoreScene3D,core.dispatchStudioCoreScene3DPatch,core.dispatchStudioCoreScene3DObjectsPatch,core.dispatchStudioCoreScene3DEnvironmentPatch,core.dispatchStudioCoreScene3DPropertiesPatch,core.dispatchStudioCoreScene3DTranslationPatch,core.dispatchStudioCoreScene3DAlignmentPatch])assert.throws(()=>dispatch(request()),{errorCode:'studio_core_request_invalid'});
  for(const operation of ['scene3d.alignObjects','scene3d.translateObjects','scene3d.parse','align'])assert.throws(()=>patch({...request(),operation}),{errorCode:'studio_core_request_invalid'});assert.equal(core.getStudioCoreMetadata().ready,true);
});
test('source-order receipt and original numeric-order receipt are distinct while all three requested world axes preserve other semantics',()=>{
  for(const axis of ['x','y','z']){const input=request(axis),before=clone(input),result=patch(input);assert.deepEqual(result,expected(input));assert.deepEqual(result,wasm(input).scene3dDistributionPatch);assert.deepEqual(result.instanceIds,[id(1),id(2),id(3)]);assert.deepEqual(input,before);const after=parsed(result.afterContent);assert.deepEqual(after.objects[3],sample().objects[3]);assert.deepEqual(after.camera,sample().camera);assert.deepEqual(after.light,sample().light);for(const[index,object]of after.objects.entries())for(const key of ['instanceId','name','primitive','rotationDegrees','size','color'])assert.deepEqual(object[key],sample().objects[index][key]);}
  const result=patch(request());assert.deepEqual(result.orderedInstanceIds,[id(3),id(2),id(1)]);assert.deepEqual(result.changedPaths,['/objects/1/position/0']);assert.equal(parsed(result.afterContent).objects[1].position[0],0);
});
test('BOM CRLF escaped IDs and keys Unicode both extrema and every non-axis lexeme retain exact spelling',()=>{
  let content=serialize(sample()).replaceAll('"position"','"posi\\u0074ion"').replace('"objects"','"objec\\u0074s"').replace(id(1),'0000000\\u0031-1111-4111-8111-111111111111').replace('1000','1.000e3');content=replaceValue(content,'/objects/0/position/0','1.000e1');content=replaceValue(content,'/objects/2/position/0','-1.000e1');content=replaceValue(content,'/objects/1/position/2','2.000e0');const input=request('x',content),result=patch(input);assert.deepEqual(result,expected(input));assert.match(result.afterContent,/1\.000e1/);assert.match(result.afterContent,/-1\.000e1/);assert.match(result.afterContent,/2\.000e0/);assert.match(result.afterContent,/1\.000e3/);
});
test('ties are original declaration ordered including signed zero and unchanged zero still keeps its lexeme',()=>{
  const value=sample();value.objects=Array.from({length:5},(_,i)=>({...clone(value.objects[0]),instanceId:id(i+1),position:[[10,0,-0,0,-10][i],0,0]}));let content=serialize(value);content=replaceValue(content,'/objects/2/position/0','-0e0');const input=request('x',content,[id(4),id(3),id(2),id(1),id(5)]),result=patch(input);assert.deepEqual(result,expected(input));assert.deepEqual(result.orderedInstanceIds,[id(5),id(2),id(3),id(4),id(1)]);assert.deepEqual(result.changedPaths,['/objects/1/position/0','/objects/3/position/0']);assert.match(result.afterContent,/-0e0/);
});
test('binary64 operation order is fraction multiply then add and retains exact native-WASM result',()=>{
  const value=sample(),start=-41913.080518768766,end=49236.14455031027;value.objects.forEach((o,i)=>{o.position[0]=[end,start,-30000,0][i];});const input=request('x',value,[id(4),id(3),id(2),id(1)]),result=patch(input);assert.deepEqual(result,expected(input));assert.equal(parsed(result.afterContent).objects[2].position[0],-11530.005495742422);assert.notEqual(parsed(result.afterContent).objects[2].position[0],start+(end-start)/3);
});
test('zero-span and already uniform noops preserve complete bytes while collapsed nonzero-span native replies are errors',()=>{
  const flat=sample();flat.objects.forEach(o=>{o.position[0]=0;});let content=serialize(flat);content=replaceValue(content,'/objects/1/position/0','-0e0');assert.equal(patch(request('x',content)).afterContent,content);assert.deepEqual(patch(request('x',content)).changedPaths,[]);
  const uniform=sample();[10,0,-10].forEach((v,i)=>{uniform.objects[i].position[0]=v;});content=serialize(uniform).replace('1000','1e3');assert.equal(patch(request('x',content)).afterContent,content);
  const collapsed=sample();[1,1,1.0000000000000002].forEach((v,i)=>{collapsed.objects[i].position[0]=v;});assert.throws(()=>patch(request('x',collapsed)),{errorCode:'scene3d_distribution_invalid'});assert.equal(core.getStudioCoreMetadata().ready,true);
});
test('subnormal representable sequences and 128 source-ordered instances keep extrema and reject endpoint collapse',()=>{
  const small=sample();[0,0,1e-323].forEach((v,i)=>{small.objects[i].position[0]=v;});const result=patch(request('x',small));assert.equal(parsed(result.afterContent).objects[1].position[0],5e-324);small.objects[2].position[0]=5e-324;assert.throws(()=>patch(request('x',small)),{errorCode:'scene3d_distribution_invalid'});
  const large=sample();large.objects=Array.from({length:128},(_,i)=>({...clone(large.objects[0]),instanceId:id(i+1),position:[i*i,0,0]}));const input=request('x',large,large.objects.map(o=>o.instanceId).reverse()),full=patch(input);assert.deepEqual(full,expected(input));assert.equal(full.instanceIds.length,128);assert.equal(full.changedPaths.length,126);assert.equal(full.changedPaths[125],'/objects/126/position/0');assert.deepEqual(parsed(full.afterContent).objects[0],large.objects[0]);assert.deepEqual(parsed(full.afterContent).objects[127],large.objects[127]);
});
test('whole-source original and final budgets admit joint grow-shrink and no-op while refusing final growth',()=>{
  const value=sample();value.objects.forEach((o,i)=>{o.position[0]=[0,0,29999.999999999996,30000][i];});let content=serialize(value);content+=' '.repeat(131072-Buffer.byteLength(content));const input=request('x',content,[id(4),id(3),id(2),id(1)]),result=patch(input);assert.ok(Buffer.byteLength(result.afterContent)<131072);assert.deepEqual(result,expected(input));
  const growth=sample();[0,0,100000].forEach((v,i)=>{growth.objects[i].position[0]=v;});content=serialize(growth);content+=' '.repeat(131072-Buffer.byteLength(content));assert.throws(()=>patch(request('x',content)),{errorCode:'scene3d_limit'});assert.throws(()=>patch(request('x',content+' ')),{errorCode:'scene3d_limit'});
});
test('strict JSON DTO rejects accessors serializers hidden fields sparse identities and invalid closed axes without reading caller code',()=>{
  let reads=0;const getter=request();Object.defineProperty(getter.instanceIds,'0',{enumerable:true,get(){reads++;return id(1);}});const serialized={...request(),toJSON(){reads++;return request();}},hidden=request();Object.defineProperty(hidden,'secret',{value:true});const sparse=request();sparse.instanceIds=[id(1),,id(3)];
  for(const input of [getter,serialized,hidden,sparse,{...request(),extra:true},{...request(),anchorInstanceId:id(1)},{...request(),instanceIds:[]},{...request(),instanceIds:[id(1),id(2)]},{...request(),instanceIds:[id(1),id(1),id(3)]},{...request(),instanceIds:[id(1),id(2),null]},{...request(),axis:'X'},{...request(),axis:'center'},{...request(),axis:null},{...request(),protocolVersion:2}])assert.throws(()=>patch(input),{errorCode:'studio_core_request_invalid'});assert.equal(reads,0);assert.equal(core.getStudioCoreMetadata().ready,true);
});
test('unknown selected identities and invalid unselected declarations preserve old parse or new intent errors without poisoning',()=>{
  assert.throws(()=>patch(request('x',sample(),[id(99),id(1),id(2)])),{errorCode:'scene3d_distribution_invalid'});const bad=sample();bad.objects[3].size=[0,1,1];assert.throws(()=>patch(request('x',bad)),{errorCode:'scene3d_invalid'});const content=serialize(sample()).replace('"schemaVersion": 1','"schemaVersion": 1,"schema\\u0056ersion":1');assert.throws(()=>patch(request('x',content)),{errorCode:'scene3d_invalid'});assert.equal(core.getStudioCoreMetadata().ready,true);
});
test('malicious envelope numeric ordering axis membership before and paths receipts fail closed in the forged bridge',async()=>{
  const input=request(),good=wasm(input);for(const mutate of [r=>{r.extra=true;},r=>{r.scene3dDistributionPatch.extra=true;},r=>{r.scene3dDistributionPatch.instanceIds.reverse();},r=>{r.scene3dDistributionPatch.orderedInstanceIds.reverse();},r=>{r.scene3dDistributionPatch.orderedInstanceIds.pop();},r=>{r.scene3dDistributionPatch.axis='z';},r=>{r.scene3dDistributionPatch.beforeContent+=' ';},r=>{r.scene3dDistributionPatch.changedPaths.push(r.scene3dDistributionPatch.changedPaths[0]);},r=>{r.scene3dDistributionPatch.afterContent=input.content;},r=>{delete r.scene3dDistributionPatch.axis;}]){const response=clone(good);mutate(response);const module=await responseBridge(response);assert.throws(()=>module.dispatchStudioCoreScene3DDistributionPatch(input),{errorCode:'studio_core_unavailable'});assert.equal(module.getStudioCoreMetadata().ready,false);}assert.equal(core.getStudioCoreMetadata().ready,true);
});
test('native success cannot forge a zero-path approval when a positive span numerically collapses',async()=>{
  const value=sample();[1,1,1.0000000000000002].forEach((v,i)=>{value.objects[i].position[0]=v;});const input=request('x',value),response={protocolVersion:1,ok:true,scene3dDistributionPatch:{instanceIds:[id(1),id(2),id(3)],orderedInstanceIds:[id(1),id(2),id(3)],axis:'x',beforeContent:input.content,afterContent:input.content,changedPaths:[]}};const module=await responseBridge(response);assert.throws(()=>module.dispatchStudioCoreScene3DDistributionPatch(input),{errorCode:'studio_core_unavailable'});
});
test('numeric witness rejects endpoint lexeme key and formatting changes while full models reject unrequested values',async()=>{
  const input=request(),good=wasm(input);for(const mutate of [s=>s+' ',s=>s.replace('\r\n','\n'),s=>s.replace('"objects"','"objec\\u0074s"'),s=>s.replace('Distribution','Changed'),s=>s.replace('1000','1e3'),s=>replaceValue(s,'/objects/0/position/0','1e1'),s=>replaceValue(s,'/objects/2/position/0','-1e1'),s=>replaceValue(s,'/objects/3/position/0','91'),s=>replaceValue(s,'/objects/1/rotationDegrees/0','24'),s=>replaceValue(s,'/objects/1/position/0','0.1')]){const response=clone(good);response.scene3dDistributionPatch.afterContent=mutate(response.scene3dDistributionPatch.afterContent);const module=await responseBridge(response);assert.throws(()=>module.dispatchStudioCoreScene3DDistributionPatch(input),{errorCode:'studio_core_unavailable'});}
});
test('semantically identical key swaps and no-op token normalization cannot hide unrequested source changes',async()=>{
  const value=sample();value.objects[1].position=[-8,3,1.5];value.objects[1].size=[0.001,3,1.5];value.objects[0].position[0]=0.002;value.objects[2].position[0]=0;value.objects[1].position[0]=.0005;const input=request('x',value),good=wasm(input),response=clone(good),content=response.scene3dDistributionPatch.afterContent,range=locateJsonSource(parseJsonSource(content),'/objects/1'),object=content.slice(range.start,range.end).replace('"position"','"SWAP"').replace('"size"','"position"').replace('"SWAP"','"size"');response.scene3dDistributionPatch.afterContent=content.slice(0,range.start)+object+content.slice(range.end);assert.deepEqual(parsed(response.scene3dDistributionPatch.afterContent),parsed(content));const module=await responseBridge(response);assert.throws(()=>module.dispatchStudioCoreScene3DDistributionPatch(input),{errorCode:'studio_core_unavailable'});
  [10,0,-10].forEach((v,i)=>{value.objects[i].position[0]=v;});const noop=request('x',serialize(value).replace('1000','1e3')),goodNoop=wasm(noop);goodNoop.scene3dDistributionPatch.afterContent=goodNoop.scene3dDistributionPatch.afterContent.replace('1e3','1000');const fake=await responseBridge(goodNoop);assert.throws(()=>fake.dispatchStudioCoreScene3DDistributionPatch(noop),{errorCode:'studio_core_unavailable'});
});
test('fresh native CLI and current WASM agree on valid distribution, precision and budget rejection, raw duplicate requests and six prior domains',{skip:!nativeAvailable},async()=>{
  const collapsed=sample();[1,1,1.0000000000000002].forEach((v,i)=>{collapsed.objects[i].position[0]=v;});const tiny=sample();[0,0,1e-323].forEach((v,i)=>{tiny.objects[i].position[0]=v;});const budget=sample();budget.objects.forEach((o,i)=>{o.position[0]=[0,0,29999.999999999996,30000][i];});let full=serialize(budget);full+=' '.repeat(131072-Buffer.byteLength(full));const raw=JSON.stringify(request()),content=serialize(sample());
  const inputs=[request(),request('y'),request('z'),request('x',collapsed),request('x',tiny),request('x',sample(),[id(1),id(2)]),request('x',sample(),[id(1),id(1),id(3)]),request('x',sample(),[id(99),id(1),id(2)]),request('X'),{...request(),extra:true},request('x',full,[id(1),id(2),id(3),id(4)]),request('x',full+' '),raw.replace('"axis":','"ax\\u0069s":"y","axis":'),raw.replace('"instanceIds":','"instanceIds":[],"instance\\u0049ds":'),parseInput(content),
    {protocolVersion:1,operation:'scene3d.patchObjectTransform',content,instanceId:id(1),values:{position:[3,1.5,0]}},{protocolVersion:1,operation:'scene3d.patchObjects',content,action:'copy',instanceId:id(1),newInstanceId:id(99),name:'Copy'},
    {protocolVersion:1,operation:'scene3d.patchEnvironment',content,values:{background:'#123456'}},{protocolVersion:1,operation:'scene3d.patchProperties',content,instanceId:id(1),values:{name:'Compatible'}},
    {protocolVersion:1,operation:'scene3d.translateObjects',content,instanceIds:[id(1)],offset:[1,0,0]},{protocolVersion:1,operation:'scene3d.alignObjects',content,instanceIds:[id(1),id(2)],anchorInstanceId:id(1),axis:'x'}];assert.equal(inputs.length,21);assert.deepEqual(await nativeSequence(inputs),inputs.map(wasm));
});
