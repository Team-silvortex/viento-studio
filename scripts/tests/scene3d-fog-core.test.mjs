import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { parseScene3DSource } from '../../engine/scene3d.mjs';
import { dispatchStudioCoreScene3DEnvironmentPatch, supportsStudioCoreScene3DFog, getStudioCoreMetadata } from '../../engine/studio-core.mjs';
import { createScene3DTransformProposal, prepareScene3DTransformApply } from '../../engine/scene3d-transform.mjs';
import { createScene3DEnvironmentProposal, isScene3DEnvironmentProposal, prepareScene3DEnvironmentApply } from '../../engine/scene3d-environment.mjs';
const bytes=await fs.readFile(new URL('../../engine/studio-core.wasm',import.meta.url));
const {instance}=await WebAssembly.instantiate(bytes,{}),native=instance.exports;
const model=()=>({format:'viento-scene3d',schemaVersion:1,name:'Fog · 霧 · 雾 🦊 } "fog"',viewport:[800,600],background:'#0d1829',
 camera:{position:[8,6,8],target:[0,0,0],fovDegrees:60,near:.05,far:1000},light:{direction:[-1,-2,-1],color:'#ffffff',energy:1},
 objects:[{instanceId:'10000000-1111-4111-8111-111111111111',name:'"density":0 } snow雪😀',primitive:'box',position:[0,1,0],rotationDegrees:[23,-41,67],size:[1,2,3],color:'#87d8b9'}]});
const source=v=>'\uFEFF'+JSON.stringify(v,null,'\t').replaceAll('\n','\r\n')+'\r\n \t';
const parseText=content=>JSON.parse(content.replace(/^\uFEFF/,''));
const request=(content,values)=>({protocolVersion:1,operation:'scene3d.patchEnvironment',content,values});
const patch=(content,values)=>dispatchStudioCoreScene3DEnvironmentPatch(request(content,values));
const fogText=fog=>',"fog":{"color":'+JSON.stringify(fog.color)+',"density":'+String(fog.density)+'}';
const replaceLast=(content,find,text)=>{const at=content.lastIndexOf(find);assert.ok(at>=0);return content.slice(0,at)+text+content.slice(at+find.length);};
const inserted=(content,fog)=>{const end=content.lastIndexOf('}');return content.slice(0,end)+fogText(fog)+content.slice(end);};
const hash=value=>createHash('sha256').update(value).digest('hex');
const snapshot=content=>({sourcePath:'documents/fog.scene3d.json',token:'fog:1:0',content,baseSourceRevision:'sha256:'+hash(content),sourceRevision:'sha256:'+hash(content)});
function wasm(value){const encoded=new TextEncoder().encode(typeof value==='string'?value:JSON.stringify(value)),input=native.viento_core_input(encoded.length)>>>0;new Uint8Array(native.memory.buffer,input,encoded.length).set(encoded);const output=native.viento_core_run()>>>0;return JSON.parse(new TextDecoder().decode(new Uint8Array(native.memory.buffer,output,native.viento_core_output_len())));}
function objectRaw(content){const parsed=parseScene3DSource(content);return parsed.sourceLocations.objects.map(row=>content.slice(row.sourceRange.start,row.sourceRange.end));}

test('optional fog probe is ready while schemaVersion1 absence stays absent without injected defaults',()=>{
 assert.equal(supportsStudioCoreScene3DFog(),true);assert.equal(native.viento_core_scene3d_fog_version(),1);
 const content=source(model()),parsed=parseScene3DSource(content);assert.equal(parsed.model.schemaVersion,1);assert.equal(Object.hasOwn(parsed.model,'fog'),false);assert.equal(Object.isFrozen(parsed.model),true);
 const result=patch(content,{background:'#102030'});assert.equal(Object.hasOwn(parseScene3DSource(result.afterContent).model,'fog'),false);assert.deepEqual(objectRaw(result.afterContent),objectRaw(content));
});
test('native parse keeps explicit zero and positive fog presence as deeply frozen author values',()=>{
 for(const density of [0,.00001,.25,1]){const v=model();v.fog={color:'#AbCdEF',density};const parsed=parseScene3DSource(source(v));assert.deepEqual(parsed.model.fog,v.fog);assert.ok(Object.isFrozen(parsed.model.fog));assert.equal(parsed.model.schemaVersion,1);}
});
test('absent fog insertion is canonical at the final root brace and keeps every original BOM CRLF Unicode and object byte',()=>{
 const content=source(model()).replace('"background"','"backgrou\\u006ed"').replace('1000','1.000e3'),fog={color:'#A0b1C2',density:.125};const result=patch(content,{fog});
 assert.deepEqual(result,{beforeContent:content,afterContent:inserted(content,fog),changedPaths:['/fog']});assert.deepEqual(parseScene3DSource(result.afterContent).model.fog,fog);assert.deepEqual(objectRaw(result.afterContent),objectRaw(content));
});
test('absent fog at zero density is a real declaration insertion and can obtain an environment review brand',async()=>{
 const content=source(model()),p=createScene3DEnvironmentProposal(snapshot(content),{values:{fog:{color:'#ffffff',density:0}}});
 assert.equal(isScene3DEnvironmentProposal(p),true);assert.deepEqual(p.changedPaths,['/fog']);assert.equal(Object.hasOwn(p.beforeEnvironment,'fog'),false);assert.deepEqual(p.afterEnvironment.fog,{color:'#ffffff',density:0});assert.equal(Object.isFrozen(p.afterEnvironment.fog),true);
 assert.equal((await prepareScene3DEnvironmentApply(snapshot(content),p,{digest:hash})).afterContent,inserted(content,{color:'#ffffff',density:0}));
});
test('existing fog leaf changes retain escaped key spellings and only use color then density paths',()=>{
 const v=model();v.fog={density:.25,color:'#aBcDeF'};const content=source(v).replace('"fog"','"f\\u006fg"').replace('"density"','"dens\\u0069ty"').replace('0.25','2.500e-1');const result=patch(content,{fog:{color:'#102030',density:.5}});
 assert.deepEqual(result.changedPaths,['/fog/color','/fog/density']);assert.equal(result.afterContent,content.replace('"#aBcDeF"','"#102030"').replace('2.500e-1','0.5'));assert.deepEqual(objectRaw(result.afterContent),objectRaw(content));
});
test('semantically equal escaped color and signed zero density preserve original lexical bytes and produce a native noop',()=>{
 const v=model();v.fog={color:'#ffffff',density:0};const content=replaceLast(source(v).replace('"fog"','"f\\u006fg"').replace('"density": 0','"density": -0e0'),'"color": "#ffffff"','"color": "\\u0023ffffff"');const result=patch(content,{fog:{color:'#ffffff',density:0}});
 assert.deepEqual(result,{beforeContent:content,afterContent:content,changedPaths:[]});assert.throws(()=>createScene3DEnvironmentProposal(snapshot(content),{values:{fog:{color:'#ffffff',density:0}}}),{errorCode:'scene3d_environment_unchanged'});
});
test('mixed old environment fields plus absent fog form one exact candidate with old path order then the insertion',async()=>{
 const content=source(model()),fog={color:'#123456',density:.2};const values={light:{energy:2},fog,camera:{fovDegrees:55},background:'#102030'};const result=patch(content,values);
 const oldExpected=content.replace('"background": "#0d1829"','"background": "#102030"').replace('"fovDegrees": 60','"fovDegrees": 55').replace('"energy": 1','"energy": 2');
 assert.equal(result.afterContent,inserted(oldExpected,fog));assert.deepEqual(result.changedPaths,['/background','/camera/fovDegrees','/light/energy','/fog']);assert.deepEqual(objectRaw(result.afterContent),objectRaw(content));
 const p=createScene3DEnvironmentProposal(snapshot(content),{values});assert.equal((await prepareScene3DEnvironmentApply(snapshot(content),p,{digest:hash})).afterContent,result.afterContent);
});
test('unrequested explicit fog remains raw and present during ordinary background or camera authoring',()=>{
 const v=model();v.fog={color:'#abcdef',density:.1};const content=source(v).replace('"fog"','"fo\\u0067"').replace('0.1','1.000e-1');const result=patch(content,{background:'#112233'});
 assert.equal(result.afterContent,content.replace('"background": "#0d1829"','"background": "#112233"'));assert.deepEqual(result.changedPaths,['/background']);assert.deepEqual(parseScene3DSource(result.afterContent).model.fog,v.fog);
 const p=createScene3DEnvironmentProposal(snapshot(content),{values:{camera:{near:.1}}});assert.deepEqual(p.beforeEnvironment.fog,p.afterEnvironment.fog);assert.deepEqual(p.beforeEnvironment.fog,v.fog);
});
test('native source rejects missing fog fields unknown fields out of range density and decoded duplicate keys',()=>{
 for(const fog of [{color:'#ffffff'},{density:.1},{color:'#ffffff',density:.1,extra:true},{color:'#xyzxyz',density:.1},{color:'#ffffff',density:-.01},{color:'#ffffff',density:1.00001},{color:'#ffffff',density:null},null]){const v=model();v.fog=fog;assert.throws(()=>parseScene3DSource(source(v)));}
 const v=model();v.fog={color:'#ffffff',density:.1};const raw=source(v).replace('"density":','"density":0,"dens\\u0069ty":');assert.throws(()=>parseScene3DSource(raw),{errorCode:'scene3d_invalid'});
});
test('fog patch requests require complete strict finite JSON DTOs and reject accessor code without executing it',()=>{
 const content=source(model());for(const fog of [{color:'#ffffff'},{density:.1},{color:'#ffffff',density:.1,extra:true},null,[],{color:'#ffffff',density:'0.1'}])assert.throws(()=>patch(content,{fog}),{errorCode:'studio_core_request_invalid'});
 for(const density of [-.01,1.00001])assert.throws(()=>patch(content,{fog:{color:'#ffffff',density}}));for(const density of [Infinity,NaN])assert.throws(()=>patch(content,{fog:{color:'#ffffff',density}}),{errorCode:'studio_core_request_invalid'});
 let reads=0;const fog={density:.1};Object.defineProperty(fog,'color',{enumerable:true,get(){reads++;return '#ffffff';}});assert.throws(()=>patch(content,{fog}),{errorCode:'studio_core_request_invalid'});assert.equal(reads,0);assert.equal(getStudioCoreMetadata().ready,true);
});
test('raw duplicate fog and nested density patch keys never bypass request admission',()=>{
 const raw=JSON.stringify(request(source(model()),{fog:{color:'#ffffff',density:.1}}));
 for(const text of [raw.replace('"fog":','"fog":{},"fo\\u0067":'),raw.replace('"density":','"density":0,"dens\\u0069ty":')]){const result=wasm(text);assert.equal(result.ok,false);assert.equal(result.errorCode,'studio_core_request_invalid');}
});
test('whole source byte budget permits exactly fitting insertion and rejects growth one byte beyond',()=>{
 const fog={color:'#ffffff',density:.1},base=source(model()),growth=Buffer.byteLength(fogText(fog));let content=base+' '.repeat(131072-growth-Buffer.byteLength(base));const result=patch(content,{fog});assert.equal(Buffer.byteLength(result.afterContent),131072);assert.equal(result.afterContent,inserted(content,fog));assert.throws(()=>patch(content+' ',{fog}),{errorCode:'scene3d_limit'});assert.equal(getStudioCoreMetadata().ready,true);
});
test('fog environment proposal binds captured source before digest and serializable clones have no approval authority',async()=>{
 const content=source(model()),current=snapshot(content),values={fog:{color:'#abcdef',density:.25}},p=createScene3DEnvironmentProposal(current,{values});values.fog.density=1;assert.equal(p.afterEnvironment.fog.density,.25);assert.equal(p.values.fog.density,.25);
 await assert.rejects(prepareScene3DEnvironmentApply(snapshot(content),structuredClone(p),{digest:hash}),{errorCode:'scene3d_environment_conflict'});
 let release;const applying=prepareScene3DEnvironmentApply(current,p,{digest:async value=>{await new Promise(resolve=>{release=resolve;});return hash(value);}});current.content='late mutation';current.token='late token';release();assert.equal((await applying).afterContent,p.afterContent);
});

test('existing object transform review and apply retain optional fog declaration and every raw fog token',async()=>{
 const v=model();v.fog={color:'#ABCDEF',density:.1};const content=source(v).replace('"fog"','"f\\u006fg"').replace('"density": 0.1','"density": 1.000e-1').replace('#ABCDEF','#AB\\u0043DEF');
 const p=createScene3DTransformProposal(snapshot(content),{instanceId:v.objects[0].instanceId,values:{position:[10,20,-30]}}),ready=await prepareScene3DTransformApply(snapshot(content),p,{digest:hash});
 assert.deepEqual(parseScene3DSource(ready.afterContent).model.fog,v.fog);assert.deepEqual(parseScene3DSource(ready.afterContent).model.objects[0].position,[10,20,-30]);
 const key='"f\\u006fg"',beforeAt=content.lastIndexOf(key),afterAt=ready.afterContent.lastIndexOf(key);assert.ok(beforeAt>=0&&afterAt>=0);assert.equal(ready.afterContent.slice(afterAt),content.slice(beforeAt));
 assert.deepEqual(ready.changedPaths,['/objects/0/position/0','/objects/0/position/1','/objects/0/position/2']);
});
