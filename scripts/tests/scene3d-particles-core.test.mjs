import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { parseScene3DSource } from '../../engine/scene3d.mjs';
import { prepareScene3DParticleField, sampleScene3DParticleField } from '../../engine/scene3d-particles.mjs';
import { dispatchStudioCoreScene3DEnvironmentPatch, supportsStudioCoreScene3DParticles, getStudioCoreMetadata } from '../../engine/studio-core.mjs';
import { createScene3DTransformProposal, prepareScene3DTransformApply } from '../../engine/scene3d-transform.mjs';
import { createScene3DEnvironmentProposal, isScene3DEnvironmentProposal, prepareScene3DEnvironmentApply } from '../../engine/scene3d-environment.mjs';
const bytes = await fs.readFile(new URL('../../engine/studio-core.wasm', import.meta.url));
const { instance } = await WebAssembly.instantiate(bytes, {}), native = instance.exports;
const scene = JSON.parse(await fs.readFile(new URL('../../examples/scene3d/scene.json', import.meta.url), 'utf8'));
const field = () => ({ center:[0,2,0], extent:[10,5,8], velocity:[-3,2.5,.001], size:[.1,.2,.1], color:'#aBcDeF', count:2, seed:0 });
const source = v => '\ufeff' + JSON.stringify(v, null, '\t').replaceAll('\n','\r\n') + '\r\n \t';
const request = (content, values) => ({ protocolVersion:1, operation:'scene3d.patchEnvironment', content, values });
const patch = (content, values) => dispatchStudioCoreScene3DEnvironmentPatch(request(content, values));
const hash = value => createHash('sha256').update(value).digest('hex');
const snapshot = content => ({ sourcePath:'documents/particles.scene3d.json', token:'particles:1:0', content, baseSourceRevision:'sha256:'+hash(content), sourceRevision:'sha256:'+hash(content) });
const insert = (content, values) => { const at = content.lastIndexOf('}'); return content.slice(0,at) + Object.entries(values).map(([key,value]) => ','+JSON.stringify(key)+':'+JSON.stringify(value)).join('') + content.slice(at); };
function wasm(value) { const encoded=new TextEncoder().encode(typeof value==='string'?value:JSON.stringify(value)), at=native.viento_core_input(encoded.length)>>>0; new Uint8Array(native.memory.buffer,at,encoded.length).set(encoded); const out=native.viento_core_run()>>>0; return JSON.parse(new TextDecoder().decode(new Uint8Array(native.memory.buffer,out,native.viento_core_output_len()))); }
const prep = field => ({ protocolVersion:1, operation:'scene3d.prepareParticleField', field });

test('particle capability is optional and old schemaVersion1 scenes receive no default declaration', () => {
 assert.equal(supportsStudioCoreScene3DParticles(),true); assert.equal(native.viento_core_scene3d_particles_version(),1);
 const content=source(scene); assert.equal(Object.hasOwn(parseScene3DSource(content).model,'particleField'),false);
 assert.equal(Object.hasOwn(parseScene3DSource(patch(content,{background:'#123456'}).afterContent).model,'particleField'),false);
});
test('prepared native seed phases match fixed golden values and deeply freeze a captured field', () => {
 const value=field(), result=prepareScene3DParticleField(value);
 assert.deepEqual(result.phases, [[.3165935277938843,.8757069706916809,.4833001494407654],[.005915164947509766,.899222195148468,.9747592210769653]]);
 assert.deepEqual(result.field,value); assert.ok(Object.isFrozen(result)&&Object.isFrozen(result.field.center)&&Object.isFrozen(result.phases[0]));
 value.center[0]=99; value.seed=1; assert.equal(result.field.center[0],0); assert.equal(result.field.seed,0);
 assert.deepEqual(prepareScene3DParticleField({...field(),seed:2654435769}).phases[0],[.2526668906211853,.5698249340057373,.609617292881012]);
 assert.deepEqual(prepareScene3DParticleField({...field(),seed:4294967295}).phases[0],[.3166450262069702,.11001062393188477,.058625638484954834]);
});
test('count zero is a retained disabled declaration and 4096 exact Float32 triples stay within the phase budget', () => {
 assert.deepEqual(prepareScene3DParticleField({...field(),count:0}).phases,[]);
 const value={...field(),count:4096,seed:4294967295}, result=prepareScene3DParticleField(value); assert.equal(result.phases.length,4096);
 for(const triple of result.phases) for(const phase of triple) assert.ok(phase>=0&&phase<1&&Math.fround(phase)===phase);
 assert.deepEqual(prepareScene3DParticleField(value),result);
 assert.equal(parseScene3DSource(source({...scene,particleField:{...field(),count:0}})).model.particleField.count,0);
});
test('sampling is random access explicit time with signed wrapping and no accumulated state', () => {
 const value=field(), atHalf=sampleScene3DParticleField(value,.5);
 assert.deepEqual(atHalf,{timeSeconds:.5,offset:[.85,.25,.0000625]}); assert.ok(Object.isFrozen(atHalf.offset));
 assert.deepEqual(sampleScene3DParticleField(value,3600),{timeSeconds:3600,offset:[0,0,.45]});
 assert.deepEqual(sampleScene3DParticleField(value,0),{timeSeconds:0,offset:[0,0,0]}); assert.deepEqual(sampleScene3DParticleField(value,.5),atHalf);
 const tiny=sampleScene3DParticleField({...value,velocity:[-1e-20,1e-40,5e-324]},1);
 assert.deepEqual(tiny.offset,[0,1.9999999999999998e-41,0]); assert.equal(Object.is(tiny.offset[0],-0),false);
 const max=sampleScene3DParticleField({...value,extent:[.01,.01,.01],size:[.001,.001,.001],velocity:[1000,-1000,1000]},3600); assert.deepEqual(max.offset,[0,0,0]);
});
test('field ranges integer budgets shape and size within extent are shared by prepare source and environment admission', () => {
 const invalid = [{...field(),count:4097},{...field(),count:-1},{...field(),count:.5},{...field(),seed:4294967296},{...field(),seed:.5},{...field(),center:[0,0,100001]},{...field(),extent:[0,1,1]},{...field(),extent:[1,1,10001]},{...field(),velocity:[1001,0,0]},{...field(),size:[11,1,1]},{...field(),size:[0,1,1]},{...field(),color:'#gg0000'},{...field(),extra:1},{...field(),center:[1,2]},null];
 for(const value of invalid) { assert.throws(()=>prepareScene3DParticleField(value)); assert.throws(()=>parseScene3DSource(source({...scene,particleField:value}))); assert.throws(()=>patch(source(scene),{particleField:value})); }
 const missing=field(); delete missing.seed; assert.throws(()=>prepareScene3DParticleField(missing));
 for(const time of [-1,3600.001,NaN,Infinity,'1',null]) assert.throws(()=>sampleScene3DParticleField(field(),time),{errorCode:'studio_core_request_invalid'});
 const valid={center:[-100000,0,100000],extent:[.01,1000,10000],velocity:[-1000,0,1000],size:[.001,1000,1000],color:'#ABCDEF',count:4096,seed:4294967295}; assert.equal(prepareScene3DParticleField(valid).phases.length,4096);
});
test('accessors sparse arrays custom objects and nonfinite field values fail before caller code can run', () => {
 let calls=0;const value=field();Object.defineProperty(value,'seed',{enumerable:true,get(){calls++;return 0;}});assert.throws(()=>prepareScene3DParticleField(value),{errorCode:'studio_core_request_invalid'});assert.equal(calls,0);
 for(const bad of [{...field(),center:[,0,0]},{...field(),velocity:[Infinity,0,0]},Object.assign(Object.create({x:1}),field())])assert.throws(()=>prepareScene3DParticleField(bad),{errorCode:'studio_core_request_invalid'});
 assert.equal(getStudioCoreMetadata().ready,true);
});
test('first insertion and simultaneous fog addition retain all old bytes and fixed fog then field order', () => {
 const content=source({...scene,name:'雪 🦊 } particleField'}).replace('"background"','"backgrou\\u006ed"'),particleField=field(),fog={color:'#abcdef',density:.125};
 const result=patch(content,{particleField,fog});assert.equal(result.afterContent,insert(content,{fog,particleField}));assert.deepEqual(result.changedPaths,['/fog','/particleField']);
 assert.equal(patch(content,{particleField}).afterContent,insert(content,{particleField}));
 assert.deepEqual(parseScene3DSource(result.afterContent).model.particleField,particleField);
});
test('existing field updates exactly fifteen leaves in contract order without rebuilding unaffected source', () => {
 const old=field(), next={center:[1,3,2],extent:[11,6,9],velocity:[-4,3,.002],size:[.2,.3,.2],color:'#102030',count:3,seed:1};
 const content=source(scene).replace(/}\s*$/,'}') ; const withField=insert(content,{particleField:old}).replace('"particleField"','"particleF\\u0069eld"').replace('"count":2','"co\\u0075nt":2e0');
 const result=patch(withField,{particleField:next});const paths=Object.keys(next).flatMap(key=>Array.isArray(next[key])?[0,1,2].map(axis=>`/particleField/${key}/${axis}`):[`/particleField/${key}`]);assert.deepEqual(result.changedPaths,paths);assert.equal(paths.length,15);
 const canonicalOld=JSON.stringify(old).replace('"count":2','"co\\u0075nt":2e0'),canonicalNext=JSON.stringify(next).replace('"count":3','"co\\u0075nt":3');assert.equal(result.afterContent,withField.replace(canonicalOld,canonicalNext));
});
test('equal field requests preserve escaped colors keys numeric exponent and signed zero tokens as native noop', () => {
 const value=field(), content=insert(source(scene),{particleField:value}).replace('"count":2','"co\\u0075nt":2.00e0').replace('"center":[0,2,0]','"center":[-0e0,2,0]').replace('"#aBcDeF"','"\\u0023aBcDeF"');
 assert.deepEqual(patch(content,{particleField:value}),{beforeContent:content,afterContent:content,changedPaths:[]});
 assert.throws(()=>createScene3DEnvironmentProposal(snapshot(content),{values:{particleField:value}}),{errorCode:'scene3d_environment_unchanged'});
 const disabled=patch(content,{particleField:{...value,count:0}});assert.deepEqual(disabled.changedPaths,['/particleField/count']);assert.equal(disabled.afterContent,content.replace('2.00e0','0'));assert.equal(parseScene3DSource(disabled.afterContent).model.particleField.count,0);
});
test('particle review captures values freezes optional snapshots and rejects serialized approval clones', async () => {
 const content=source(scene),current=snapshot(content),value=field(),p=createScene3DEnvironmentProposal(current,{values:{particleField:value}});assert.equal(isScene3DEnvironmentProposal(p),true);assert.equal(Object.hasOwn(p.beforeEnvironment,'particleField'),false);assert.deepEqual(p.afterEnvironment.particleField,value);assert.ok(Object.isFrozen(p.afterEnvironment.particleField.extent));value.count=0;assert.equal(p.afterEnvironment.particleField.count,2);
 assert.equal((await prepareScene3DEnvironmentApply(snapshot(content),p,{digest:hash})).afterContent,insert(content,{particleField:field()}));
 await assert.rejects(prepareScene3DEnvironmentApply(snapshot(content),structuredClone(p),{digest:hash}),{errorCode:'scene3d_environment_conflict'});
 let release;const pending=prepareScene3DEnvironmentApply(current,p,{digest:async value=>{await new Promise(resolve=>{release=resolve;});return hash(value);}});current.content='late mutation';release();assert.equal((await pending).afterContent,p.afterContent);
});
test('ordinary environment and old transform apply preserve every raw optional field byte', async () => {
 const content=insert(source(scene),{fog:{color:'#ffffff',density:.125},particleField:field()}).replace('"seed":0','"s\\u0065ed":0e0');
 const environment=patch(content,{background:'#123456'});assert.equal(environment.afterContent,content.replace(JSON.stringify(scene.background),'"#123456"'));
 const p=createScene3DTransformProposal(snapshot(content),{instanceId:scene.objects[0].instanceId,values:{position:[11,12,13]}}),ready=await prepareScene3DTransformApply(snapshot(content),p,{digest:hash});
 const at=content.lastIndexOf(',"fog":'),afterAt=ready.afterContent.lastIndexOf(',"fog":');assert.equal(ready.afterContent.slice(afterAt),content.slice(at));assert.deepEqual(parseScene3DSource(ready.afterContent).model.particleField,field());
});
test('native duplicate raw fields request members decoded source keys and extra operation keys are rejected', () => {
 const wire=JSON.stringify(prep(field())),patchWire=JSON.stringify(request(source(scene),{particleField:field()}));
 for(const raw of [wire.replace('"seed":','"seed":0,"s\\u0065ed":'),wire.replace('"field":','"field":null,"field":'),wire.replace('"protocolVersion":1','"protocolVersion":0,"protocolVersion":1'),patchWire.replace('"particleField":','"particleField":null,"particleField":'),patchWire.replace('"seed":','"seed":null,"s\\u0065ed":')]){assert.equal(wasm(raw).errorCode,'studio_core_request_invalid');}
 assert.equal(wasm({...prep(field()),timeSeconds:0}).ok,false);assert.equal(wasm({...prep(field()),operation:'scene3d.sampleParticleField'}).ok,false);
 assert.throws(()=>parseScene3DSource(insert(source(scene),{particleField:field()}).replace('"seed":0','"seed":0,"s\\u0065ed":1')),{errorCode:'scene3d_invalid'});
});
test('insertion honors the exact native source byte limit without corrupting a rejected source', () => {
 const value=field(),base=source(scene),growth=Buffer.byteLength(',"particleField":'+JSON.stringify(value)),content=base+' '.repeat(131072-growth-Buffer.byteLength(base));
 assert.equal(Buffer.byteLength(patch(content,{particleField:value}).afterContent),131072);assert.throws(()=>patch(content+' ',{particleField:value}),{errorCode:'scene3d_limit'});assert.equal(getStudioCoreMetadata().ready,true);
});
