import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as core from '../../engine/studio-core.mjs';
import { parseJsonSource, locateJsonSource } from '../../engine/json-source.mjs';

const bytes=await fs.readFile(new URL('../../engine/studio-core.wasm',import.meta.url));
const {instance}=await WebAssembly.instantiate(bytes,{}),nativeWasm=instance.exports;
const nativePath=process.env.VIENTO_STUDIO_CORE_BIN||fileURLToPath(new URL('../../desktop/.cache/scene3d-property-core-target/debug/viento-core',import.meta.url));
let nativeAvailable=true;try{await fs.access(nativePath,constants.X_OK);}catch{nativeAvailable=false;}
const clone=value=>JSON.parse(JSON.stringify(value));
const id=n=>`${n.toString(16).padStart(8,'0')}-1111-4111-8111-111111111111`;
const serialize=value=>'\uFEFF'+JSON.stringify(value,null,'\t').replaceAll('\n','\r\n')+'\r\n \t';
const parsed=content=>JSON.parse(content.replace(/^\uFEFF/,''));
function sample(){return {format:'viento-scene3d',schemaVersion:1,name:'Properties / 属性 / プロパティ🦊',viewport:[800,600],background:'#0d1829',
 camera:{position:[8,6,8],target:[0,0,0],fovDegrees:60,near:0.05,far:1000},light:{direction:[-1,-2,-1],color:'#ffffff',energy:1},objects:[
 {instanceId:id(1),name:'Target\nline\r\n色 🦊',primitive:'box',position:[-2,1.5,0],rotationDegrees:[0,25,0],size:[1.5,3,1.5],color:'#87d8b9'},
 {instanceId:id(2),name:'Other',primitive:'box',position:[100,20,30],rotationDegrees:[15,20,30],size:[1,2,3],color:'#FFFFFF'}]};}
const request=(values={name:'New name'},content=sample(),instanceId=id(1))=>({protocolVersion:1,operation:'scene3d.patchProperties',content:typeof content==='string'?content:serialize(content),instanceId,values});
const patch=input=>core.dispatchStudioCoreScene3DPropertiesPatch(input);
const parseInput=content=>({protocolVersion:1,operation:'scene3d.parse',content});
function wasm(input){const encoded=new TextEncoder().encode(typeof input==='string'?input:JSON.stringify(input));const pointer=nativeWasm.viento_core_input(encoded.length)>>>0;
 new Uint8Array(nativeWasm.memory.buffer,pointer,encoded.length).set(encoded);const output=nativeWasm.viento_core_run()>>>0,length=nativeWasm.viento_core_output_len();
 return JSON.parse(new TextDecoder('utf8',{fatal:true}).decode(new Uint8Array(nativeWasm.memory.buffer,output,length)));}
function replaceValue(content,path,token){const range=locateJsonSource(parseJsonSource(content),path);assert.equal(range.exact,true);return content.slice(0,range.start)+token+content.slice(range.end);}
function expected(input){const before=parsed(input.content),index=before.objects.findIndex(object=>object.instanceId===input.instanceId),indexed=parseJsonSource(input.content),edits=[],changedPaths=[];
 for(const field of ['name','color']){if(!Object.hasOwn(input.values,field)||before.objects[index][field]===input.values[field])continue;const path=`/objects/${index}/${field}`,range=locateJsonSource(indexed,path);assert.equal(range.exact,true);changedPaths.push(path);edits.push({...range,text:JSON.stringify(input.values[field])});}
 let afterContent=input.content;for(const edit of edits.sort((a,b)=>b.start-a.start))afterContent=afterContent.slice(0,edit.start)+edit.text+afterContent.slice(edit.end);return {beforeContent:input.content,afterContent,changedPaths};}
function sourceWithLexemes(){let content=serialize(sample()).replaceAll('"name"','"na\\u006de"').replaceAll('"color"','"co\\u006cor"').replace(id(1),'0000000\\u0031-1111-4111-8111-111111111111').replace('1000','1.000e3');
 content=replaceValue(content,'/objects/0/name','"Tar\\u0067et\\nline\\r\\n色 🦊"');content=replaceValue(content,'/objects/0/color','"#87d8\\u00629"');
 content=replaceValue(content,'/objects/0/position/0','-2.00e0');return replaceValue(content,'/objects/0/rotationDegrees/0','-0e0');}
let bridgeId=0;
async function responseBridge(response,propertiesVersion=1,parseVersion=1){const module=await import(new URL(`../../engine/studio-core.mjs?scene3d-properties-response=${++bridgeId}`,import.meta.url));
 const memory=new WebAssembly.Memory({initial:40}),instantiate=WebAssembly.instantiate;let inputLength=0,outputLength=0;
 try{WebAssembly.instantiate=async()=>({instance:{exports:{memory,viento_core_protocol_version:()=>1,
 viento_core_scene3d_patch_version:()=>1,viento_core_scene3d_objects_version:()=>1,viento_core_scene3d_environment_version:()=>1,viento_core_scene_composition_version:()=>1,
 ...(propertiesVersion===null?{}:{viento_core_scene3d_properties_version:()=>propertiesVersion}),...(parseVersion===null?{}:{viento_core_scene3d_version:()=>parseVersion}),
 viento_core_input:length=>{inputLength=length;return 16;},viento_core_run:()=>{const input=JSON.parse(new TextDecoder().decode(new Uint8Array(memory.buffer,16,inputLength)));
 const value=input.operation==='scene3d.patchProperties'?(typeof response==='function'?response(input):response):wasm(input);const encoded=new TextEncoder().encode(JSON.stringify(value));outputLength=encoded.length;new Uint8Array(memory.buffer,1048576,encoded.length).set(encoded);return 1048576;},viento_core_output_len:()=>outputLength}}});
 await module.initializeStudioCore(()=>new Uint8Array([1]));}finally{WebAssembly.instantiate=instantiate;}return module;}
async function nativeSequence(inputs){return new Promise((resolve,reject)=>{const child=spawn(nativePath,[],{stdio:['pipe','pipe','pipe']});let stdout='',stderr='',failure;
 const timer=setTimeout(()=>{failure=new Error('Native 3D properties parity timeout');child.kill('SIGKILL');},30000);child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
 child.stdout.on('data',text=>{stdout+=text;if(Buffer.byteLength(stdout)>16*1024*1024){failure=new Error('Native output budget exceeded');child.kill('SIGKILL');}});child.stderr.on('data',text=>{stderr=(stderr+text).slice(-4096);});child.stdin.on('error',error=>{failure||=error;});
 child.once('error',error=>{clearTimeout(timer);reject(error);});child.once('close',(code,signal)=>{clearTimeout(timer);if(failure)return reject(failure);try{assert.equal(signal,null);assert.equal(code,0,stderr);const outputs=stdout.trim().split('\n').map(JSON.parse);assert.equal(outputs.length,inputs.length);resolve(outputs);}catch(error){reject(error);}});
 child.stdin.end(inputs.map(input=>typeof input==='string'?input:JSON.stringify(input)).join('\n')+'\n');});}

test('properties capability is independently optional with parse version one and does not disable older domains',async()=>{
 assert.equal(nativeWasm.viento_core_scene3d_properties_version(),1);assert.equal(core.supportsStudioCoreScene3DPropertiesPatch(),true);
 for(const version of [null,0,2]){const module=await responseBridge(wasm(request()),version);assert.equal(module.supportsStudioCoreScene3DPropertiesPatch(),false);assert.throws(()=>module.dispatchStudioCoreScene3DPropertiesPatch(request()),{errorCode:'studio_core_unavailable'});
 assert.deepEqual(module.dispatchStudioCoreScene3D(parseInput(serialize(sample()))),core.dispatchStudioCoreScene3D(parseInput(serialize(sample()))));assert.equal(module.supportsStudioCoreScene3DPatch(),true);assert.equal(module.supportsStudioCoreScene3DObjectsPatch(),true);assert.equal(module.supportsStudioCoreScene3DEnvironmentPatch(),true);assert.equal(module.getStudioCoreMetadata().ready,true);}
 for(const version of [null,0,2]){const module=await responseBridge(wasm(request()),1,version);assert.equal(module.supportsStudioCoreScene3DPropertiesPatch(),false);assert.throws(()=>module.dispatchStudioCoreScene3DPropertiesPatch(request()),{errorCode:'studio_core_unavailable'});assert.equal(module.getStudioCoreMetadata().ready,true);}
});

test('property operation has an isolated exact dispatch domain independent of transforms inventory environment and all 2D ops',()=>{
 for(const dispatch of [core.dispatchStudioCore,core.dispatchStudioCoreDraft,core.dispatchStudioCoreSource,core.dispatchStudioCoreScene3D,core.dispatchStudioCoreScene3DPatch,core.dispatchStudioCoreScene3DObjectsPatch,core.dispatchStudioCoreScene3DEnvironmentPatch,
 core.dispatchStudioCoreComposition,core.dispatchStudioCoreCompositionDefinitions,core.dispatchStudioCoreCompositionDefinitionLocations,core.dispatchStudioCoreCompositionDefinitionRename,core.dispatchStudioCoreCompositionGroups,core.dispatchStudioCoreCompositionPlacements,core.dispatchStudioCoreCompositionStructure])assert.throws(()=>dispatch(request()),{errorCode:'studio_core_request_invalid'});
 for(const operation of ['scene3d.parse','scene3d.patchObjectTransform','scene3d.patchObjects','scene3d.patchEnvironment','move'])assert.throws(()=>patch({...request(),operation}),{errorCode:'studio_core_request_invalid'});assert.equal(core.getStudioCoreMetadata().ready,true);
});

test('both properties bind exact target string value tokens and canonical name then color paths',()=>{
 const input=request({color:'#123456',name:'New name / 新名 / 名前🦊'},sample(),id(2));const result=patch(input);assert.deepEqual(result,expected(input));assert.deepEqual(result,wasm(input).scene3dPropertiesPatch);
 assert.deepEqual(result.changedPaths,['/objects/1/name','/objects/1/color']);assert.deepEqual(parsed(result.afterContent).objects[0],sample().objects[0]);assert.deepEqual(input,request({color:'#123456',name:'New name / 新名 / 名前🦊'},sample(),id(2)));
});

test('name-only color-only and mixed unchanged values never rewrite unselected strings',()=>{
 for(const values of [{name:'Changed'},{color:'#abcdef'},{name:sample().objects[0].name,color:'#123456'}]){const input=request(values);assert.deepEqual(patch(input),expected(input));assert.equal(patch(input).changedPaths.length,1);}
});

test('escaped keys UUID names colors numeric exponents signed zero and other whole raw object stay unchanged',()=>{
 const content=sourceWithLexemes(),input=request({name:'Changed'},content),result=patch(input);assert.deepEqual(result,expected(input));
 assert.match(result.afterContent,/1\.000e3/);assert.match(result.afterContent,/-2\.00e0/);assert.match(result.afterContent,/-0e0/);assert.match(result.afterContent,/#87d8\\u00629/);
 const beforeRange=locateJsonSource(parseJsonSource(content),'/objects/1'),afterRange=locateJsonSource(parseJsonSource(result.afterContent),'/objects/1');assert.equal(content.slice(beforeRange.start,beforeRange.end),result.afterContent.slice(afterRange.start,afterRange.end));
});

test('same decoded name and color native no-op retain escaped lexemes all bytes and readiness',()=>{
 const content=sourceWithLexemes(),result=patch(request({name:sample().objects[0].name,color:'#87d8b9'},content));assert.deepEqual(result,{beforeContent:content,afterContent:content,changedPaths:[]});assert.equal(core.getStudioCoreMetadata().ready,true);
});

test('name retains exact whitespace CRLF control characters backslashes quotes and astral Unicode without trimming',()=>{
 for(const name of [' \n\r\n\t ','quote" slash\\ newline\n tab\t null\0 中文日本語🦊\u2028','🦊'.repeat(256),'日'.repeat(256)]){
 const input=request({name}),result=patch(input);assert.deepEqual(result,expected(input));assert.equal(parsed(result.afterContent).objects[0].name,name);}
});

test('existing full scene parser owns name codepoint and color format constraints rather than a new JS semantic validator',()=>{
 for(const values of [{name:''},{name:'🦊'.repeat(257)},{color:'red'},{color:'#12345'},{color:'#zzzzzz'}])assert.throws(()=>patch(request(values)),{errorCode:'scene3d_properties_invalid'});
 assert.equal(core.getStudioCoreMetadata().ready,true);assert.deepEqual(patch(request({name:'🦊'.repeat(256),color:'#ABCDEF'})),expected(request({name:'🦊'.repeat(256),color:'#ABCDEF'})));
});

test('source key order with color before name and escaped identity never controls logical path order',()=>{
 const value=sample(),object=value.objects[0];value.objects[0]='__OBJECT__';const raw=`{"color":"#87d8b9","size":[1.5,3,1.5],"name":${JSON.stringify(object.name)},"position":[-2,1.5,-0e0],"rotationDegrees":[0,25,0],"primitive":"box","instanceId":${JSON.stringify(id(1))}}`;
 const content=serialize(value).replace('"__OBJECT__"',raw),input=request({color:'#ffffff',name:'Changed'},content);assert.deepEqual(patch(input),expected(input));assert.deepEqual(patch(input).changedPaths,['/objects/0/name','/objects/0/color']);assert.match(patch(input).afterContent,/\[-2,1\.5,-0e0\]/);
});

test('names equal to keys UUIDs or other actor names never redirect stable instance selection',()=>{
 for(const name of ['name','color',id(1),id(2),sample().objects[1].name]){const input=request({name}),result=patch(input);assert.deepEqual(result,expected(input));assert.deepEqual(parsed(result.afterContent).objects[1],sample().objects[1]);assert.equal(parsed(result.afterContent).objects[0].instanceId,id(1));}
 const value=sample();value.objects[0].name=value.objects[1].name;assert.deepEqual(patch(request({name:'Only second'},value,id(2))),expected(request({name:'Only second'},value,id(2))));
});

test('strict JSON DTO rejects null numeric unknown identity edits hidden fields getters and serializers before native calls',()=>{
 let calls=0;const getter=request();Object.defineProperty(getter.values,'name',{enumerable:true,get(){calls++;return 'Changed';}});const hidden=request();Object.defineProperty(hidden.values,'secret',{value:1,enumerable:false});
 for(const input of [getter,hidden,{...request(),toJSON(){calls++;return request();}},{...request(),extra:true},{...request(),protocolVersion:2},{...request(),instanceId:null},{...request(),instanceId:'bad'},
 request({}),request(null),request({name:null}),request({name:2}),request({color:2}),request({name:['x']}),request({position:[1,2,3]}),request({instanceId:id(2)})])assert.throws(()=>patch(input),{errorCode:'studio_core_request_invalid'});
 assert.equal(calls,0);assert.equal(core.getStudioCoreMetadata().ready,true);
});

function duplicateRequests(){const common=`"protocolVersion":1,"operation":"scene3d.patchProperties","content":${JSON.stringify(serialize(sample()))},"instanceId":${JSON.stringify(id(1))}`;
 return [`{${common},"protocolVersion":1,"values":{"name":"Changed"}}`,`{${common},"values":{"name":null,"na\\u006de":"Changed"}}`,`{${common},"values":{"color":"#123456","co\\u006cor":"#ffffff"}}`,`{${common},"values":{"name":"A"},"values":{"name":"B"}}`];}

test('raw JSON duplicate decoded keys including null-first values reject before Value can hide the author intent',()=>{
 for(const input of duplicateRequests()){const result=wasm(input);assert.equal(result.ok,false);assert.equal(result.errorCode,'studio_core_request_invalid');}
});

test('unknown target and invalid original complete scene are rejected without silently repairing name or environment',()=>{
 assert.throws(()=>patch(request({name:'Changed'},sample(),id(99))),{errorCode:'scene3d_properties_invalid'});const invalid=sample();invalid.objects[0].name='';assert.throws(()=>patch(request({name:'Repaired'},invalid)),{errorCode:'scene3d_invalid'});
 invalid.objects[0].name='Valid';invalid.camera.near=0;assert.throws(()=>patch(request({color:'#ffffff'},invalid)),{errorCode:'scene3d_invalid'});
 const duplicate=serialize(sample()).replace('"name": "Other"','"name":"A","name":"Other"');assert.throws(()=>patch(request({name:'Changed'},duplicate)),{errorCode:'scene3d_invalid'});assert.equal(core.getStudioCoreMetadata().ready,true);
});

test('whole original final UTF8 budgets include Unicode and JSON escapes without partial author changes',()=>{
 let content=serialize(sample());content+=' '.repeat(128*1024-Buffer.byteLength(content));assert.equal(Buffer.byteLength(content),128*1024);
 assert.equal(patch(request({name:sample().objects[0].name},content)).afterContent,content);assert.throws(()=>patch(request({name:'🦊'.repeat(256)},content)),{errorCode:'scene3d_limit'});
 const input=request({name:'x'},content);assert.deepEqual(patch(input),expected(input));assert.ok(Buffer.byteLength(patch(input).afterContent)<128*1024);assert.throws(()=>patch(request({name:'x'},content+' ')),{errorCode:'scene3d_limit'});assert.equal(core.getStudioCoreMetadata().ready,true);
});

test('receipt envelope exact source three fields paths no-op and candidate byte budget bind each requested string update',async()=>{
 const input=request({name:'New',color:'#123456'}),good=wasm(input);const mutations=[result=>{result.extra=true;},result=>{result.scene3dPropertiesPatch.extra=true;},result=>{delete result.scene3dPropertiesPatch.beforeContent;},
 result=>{result.scene3dPropertiesPatch.beforeContent+=' ';},result=>{result.scene3dPropertiesPatch.changedPaths.reverse();},result=>{result.scene3dPropertiesPatch.changedPaths=['/objects/1/name','/objects/1/color'];},result=>{result.scene3dPropertiesPatch.afterContent=input.content;},result=>{result.scene3dPropertiesPatch.afterContent=' '.repeat(128*1024+1);}];
 for(const mutate of mutations){const result=clone(good);mutate(result);const module=await responseBridge(result);assert.throws(()=>module.dispatchStudioCoreScene3DPropertiesPatch(input),{errorCode:'studio_core_unavailable'});assert.equal(module.getStudioCoreMetadata().ready,false);}
 const module=await responseBridge(input=>{const result=wasm(input);result.scene3dPropertiesPatch.afterContent+=' ';return result;});assert.throws(()=>module.dispatchStudioCoreScene3DPropertiesPatch(request({name:sample().objects[0].name})),{errorCode:'studio_core_unavailable'});
});

test('forged success cannot swap name color key tokens even when final scene exactly matches requested semantics',async()=>{
 const value=sample();value.objects[0].name='#ABCDEF';value.objects[0].color='#123456';const input=request({name:'#123456',color:'#ABCDEF'},value),good=wasm(input),forged=clone(good);
 const range=locateJsonSource(parseJsonSource(input.content),'/objects/0'),raw=input.content.slice(range.start,range.end).replace('"name":','"__KEY__":').replace('"color":','"name":').replace('"__KEY__":','"color":');
 forged.scene3dPropertiesPatch.afterContent=input.content.slice(0,range.start)+raw+input.content.slice(range.end);assert.deepEqual(parsed(forged.scene3dPropertiesPatch.afterContent),parsed(good.scene3dPropertiesPatch.afterContent));
 const module=await responseBridge(forged);assert.throws(()=>module.dispatchStudioCoreScene3DPropertiesPatch(input),{errorCode:'studio_core_unavailable'});assert.equal(module.getStudioCoreMetadata().ready,false);assert.deepEqual(patch(input),expected(input));
});

test('forged success cannot change unrelated objects identities root environment or native author geometry',async()=>{
 const input=request({name:'New'});for(const change of [value=>{value.objects[1].name='Changed';},value=>{value.objects[0].instanceId=id(3);},value=>{value.objects[0].position[0]=9;},value=>{value.name+=' changed';},value=>{value.background='#abcdef';},value=>{value.camera.near=2;},value=>{value.light.energy=3;}]){
 const result=wasm(input),value=parsed(result.scene3dPropertiesPatch.afterContent);change(value);result.scene3dPropertiesPatch.afterContent=serialize(value);const module=await responseBridge(result);assert.throws(()=>module.dispatchStudioCoreScene3DPropertiesPatch(input),{errorCode:'studio_core_unavailable'});}
});

test('forged same-semantic key color name exponent signed zero whitespace or noncanonical changed value token is rejected',async()=>{
 const input=request({color:'#123456'},sourceWithLexemes());for(const change of [text=>text.replace('Tar\\u0067et','Target'),text=>text.replace('na\\u006de','name'),text=>text.replace('1.000e3','1000'),text=>text.replace('-0e0','0'),text=>text.replace('\r\n','\n'),text=>text+' ',text=>text.replace('#123456','#12\\u0033456')]){
 const result=wasm(input);result.scene3dPropertiesPatch.afterContent=change(result.scene3dPropertiesPatch.afterContent);const module=await responseBridge(result);assert.throws(()=>module.dispatchStudioCoreScene3DPropertiesPatch(input),{errorCode:'studio_core_unavailable'});}
});

test('stateless property edits retain old geometry history and actual transform objects environment capability behavior',()=>{
 const draft=core.dispatchStudioCoreDraft({protocolVersion:1,operation:'layoutDraft.create',actors:[{objectId:'old-layout',position:[10.125,20.25]}]});try{
 const before=core.dispatchStudioCoreDraft({protocolVersion:1,operation:'layoutDraft.read',draftId:draft.draftId});for(const input of [request(),request({color:'#ABCDEF'}),request({name:sample().objects[0].name})])patch(input);assert.deepEqual(core.dispatchStudioCoreDraft({protocolVersion:1,operation:'layoutDraft.read',draftId:draft.draftId}),before);
 const content=serialize(sample()),transform={protocolVersion:1,operation:'scene3d.patchObjectTransform',content,instanceId:id(1),values:{position:[1,2,3]}};assert.deepEqual(core.dispatchStudioCoreScene3DPatch(transform),wasm(transform).scene3dPatch);
 const copy={protocolVersion:1,operation:'scene3d.patchObjects',content,action:'copy',instanceId:id(1),newInstanceId:id(3),name:'Copied'};assert.deepEqual(core.dispatchStudioCoreScene3DObjectsPatch(copy),wasm(copy).scene3dObjectsPatch);
 const environment={protocolVersion:1,operation:'scene3d.patchEnvironment',content,values:{background:'#aabbcc'}};assert.deepEqual(core.dispatchStudioCoreScene3DEnvironmentPatch(environment),wasm(environment).scene3dEnvironmentPatch);
 }finally{core.dispatchStudioCoreDraft({protocolVersion:1,operation:'layoutDraft.close',draftId:draft.draftId});}
});

test('fresh native CLI and actual WASM agree on 20 property string lexical bounds duplicate budget and old requests',{skip:!nativeAvailable},async()=>{
 let exact=serialize(sample());exact+=' '.repeat(128*1024-Buffer.byteLength(exact));const invalid=sample();invalid.objects[0].name='';const content=serialize(sample());
 const inputs=[request({name:'New',color:'#123456'}),request({name:'line\r\nquote"\\🦊'}),request({color:'#ABCDEF'}),request({name:sample().objects[0].name,color:'#87d8b9'},sourceWithLexemes()),request({name:'🦊'.repeat(256)}),request({name:' \n\r\n\t '}),request({name:''}),request({color:'red'}),request({name:'Changed'},sample(),id(99)),request({name:'Repaired'},invalid),request({name:'🦊'.repeat(256)},exact),request({name:'x'},exact),request({name:'x'},exact+' '),...duplicateRequests(),parseInput(sourceWithLexemes()),
 {protocolVersion:1,operation:'scene3d.patchEnvironment',content,values:{background:'#aabbcc'}},{protocolVersion:1,operation:'scene3d.patchObjectTransform',content,instanceId:id(1),values:{position:[1,2,3]}}];
 assert.equal(inputs.length,20);assert.deepEqual(await nativeSequence(inputs),inputs.map(wasm));
});
