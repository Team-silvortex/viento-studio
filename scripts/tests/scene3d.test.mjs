import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseScene3DSource, createScene3DPlan, MAX_SCENE3D_BYTES } from '../../engine/scene3d.mjs';
import { parseJsonSource, locateJsonSource } from '../../engine/json-source.mjs';
import { expandSceneComposition } from '../../engine/scene-composition.mjs';
import fs from 'node:fs/promises';
const id=n=>`${n.toString(16).padStart(8,'0')}-1111-4111-8111-111111111111`;
const sample=()=>({format:'viento-scene3d',schemaVersion:1,name:'Boxes / 箱 / 箱🦊',viewport:[800,600],background:'#0d1829',camera:{position:[8,6,8],target:[0,0,0],fovDegrees:60,near:0.05,far:1000},light:{direction:[-1,-2,-1],color:'#ffffff',energy:1},objects:[{instanceId:id(1),name:'Box / 箱🦊',primitive:'box',position:[0,1,0],rotationDegrees:[23,-41,67],size:[1,2,3],color:'#87d8b9'},{instanceId:id(2),name:'Second',primitive:'box',position:[-2,0.5,1],rotationDegrees:[0,0,0],size:[1,1,1],color:'#FFFFFF'}]});
const text=value=>'\uFEFF'+JSON.stringify(value,null,'\t').replaceAll('\n','\r\n')+'\r\n \t';
const parse=value=>parseScene3DSource(typeof value==='string'?value:text(value));
const invalid={errorCode:'scene3d_invalid'},limit={errorCode:'scene3d_limit'};
function frozen(value){if(value&&typeof value==='object'){assert.equal(Object.isFrozen(value),true);for(const child of Object.values(value))frozen(child);}}
test('native 3D parsing returns an exact deeply frozen model with authored degree triples and stable identity order',()=>{
 const source=sample(),r=parse(source);assert.deepEqual(Object.keys(r).sort(),['model','sourceLocations']);assert.deepEqual(r.model,{...source,format:'viento-scene3d-model'});assert.deepEqual(r.model.objects.map(o=>o.instanceId),source.objects.map(o=>o.instanceId));assert.deepEqual(r.model.objects[0].rotationDegrees,[23,-41,67]);frozen(r);assert.throws(()=>r.model.objects.push(source.objects[0]),TypeError);assert.throws(()=>{r.model.camera.position[0]=0;},TypeError);
});
test('portable plan contains exact backend-neutral scene values and excludes source locations and source format',()=>{
 const source=sample(),{format,schemaVersion,...scene}=source,plan=createScene3DPlan(text(source));assert.deepEqual(plan,{format:'viento-build-plan',schemaVersion:1,kind:'scene3d',scene});assert.deepEqual(Object.keys(plan.scene).sort(),['background','camera','light','name','objects','viewport']);frozen(plan);assert.equal(Object.hasOwn(plan.scene,'sourceLocations'),false);assert.equal(Object.hasOwn(plan.scene.objects[0],'objectId'),false);assert.throws(()=>{plan.scene.objects[0].rotationDegrees[0]=1;},TypeError);
});
test('whole-object native UTF16 ranges agree with host CST for BOM CRLF nonBMP emoji escaped keys and numeric lexemes',()=>{
 const source=text(sample()).replace('"objects"','"objec\\u0074s"').replaceAll('"instanceId"','"ins\\u0074anceId"').replace('"position": [\r\n\t\t\t8','"position": [\r\n\t\t\t8.0'),r=parse(source),indexed=parseJsonSource(source);assert.equal(indexed.ok,true);for(const [index,loc] of r.sourceLocations.objects.entries()){const {propertyPath,...expected}=locateJsonSource(indexed,`/objects/${index}`);assert.deepEqual(loc,{instanceId:sample().objects[index].instanceId,propertyPath:`/objects/${index}`,sourceRange:expected});assert.deepEqual(JSON.parse(source.slice(loc.sourceRange.start,loc.sourceRange.end)),sample().objects[index]);}assert.ok(r.sourceLocations.objects[0].sourceRange.start<Buffer.byteLength(source.slice(0,r.sourceLocations.objects[0].sourceRange.start)));
});
test('each parse and plan is detached and cannot mutate later authoritative source or result calls',()=>{
 const source=sample(),raw=text(source),first=parse(raw),second=parse(raw);assert.notEqual(first,second);assert.notEqual(first.model.objects,second.model.objects);source.objects[0].position[0]=999;assert.equal(first.model.objects[0].position[0],0);assert.deepEqual(createScene3DPlan(raw).scene.objects,first.model.objects);assert.equal(raw,text(sample()));
});
test('strict root and nested DTOs reject unknown fields world references assets behavior hierarchy and missing declarations',()=>{
 for(const section of ['root','camera','light','object']){for(const key of ['worldId','assetId','objectId','parentId','behavior','unknown']){const value=sample(),target=section==='root'?value:section==='object'?value.objects[0]:value[section];target[key]='external';assert.throws(()=>parse(value),invalid);}const value=sample(),target=section==='root'?value:section==='object'?value.objects[0]:value[section];delete target[Object.keys(target)[0]];assert.throws(()=>parse(value),invalid);}for(const [field,bad] of [['format','viento-scene2d'],['schemaVersion',2],['schemaVersion',true]]){const value=sample();value[field]=bad;assert.throws(()=>parse(value),invalid);}
});
test('duplicate decoded JSON keys and unsafe syntax cannot be repaired or hidden inside valid raw objects',()=>{
 const raw=text(sample());for(const content of [raw.replace('"schemaVersion": 1','"schemaVersion": 1, "schemaVersion": 1'),raw.replace('"objects":','"objec\\u0074s": [], "objects":'),raw.replace('"primitive": "box"','"primitive": "sphere", "primitive": "box"'),raw.replace('"name": "Second"','"name": "\\ud800"'),raw+'false',raw.replace('1000','1e309'),'---\nformat: viento-scene3d'])assert.throws(()=>parse(content),invalid);
});
test('source arguments remain Unicode strings and reject serializers and lone surrogates without executing caller code',()=>{
 let calls=0;const wrapped={toString(){calls++;return text(sample());},toJSON(){calls++;return text(sample());}};for(const value of [null,42,wrapped,new String(text(sample())),text(sample())+'\ud800'])assert.throws(()=>parseScene3DSource(value),invalid);assert.equal(calls,0);
});
test('1–128 unique canonical object identities are admitted and output ranges remain in source order',()=>{
 const value=sample(),base=value.objects[0];value.objects=Array.from({length:128},(_,i)=>({...base,instanceId:id(i),name:`Box ${i}`}));const r=parse(value);assert.equal(r.model.objects.length,128);assert.equal(r.sourceLocations.objects.length,128);assert.ok(r.sourceLocations.objects.every((loc,i)=>loc.instanceId===id(i)&&loc.propertyPath===`/objects/${i}`));value.objects.push({...base,instanceId:id(129)});assert.throws(()=>parse(value),limit);for(const objects of [[],[base,{...base}],[{...base,instanceId:'not-uuid'}],[{...base,instanceId:id(1).toUpperCase()}]]){const v=sample();v.objects=objects;if(objects[0]?.instanceId===id(1).toUpperCase()&&id(1)===id(1).toUpperCase())v.objects[0].instanceId='ABCDEF01-1111-4111-8111-111111111111';assert.throws(()=>parse(v),invalid);}
});
test('names count Unicode codepoints and viewport requires bounded integral numbers',()=>{
 const value=sample();value.name='🦊'.repeat(256);value.objects[0].name='日'.repeat(256);value.viewport=[1,8192];assert.equal(parse(value).model.name,value.name);value.name+='🦊';assert.throws(()=>parse(value),invalid);for(const viewport of [[0,600],[8193,600],[800.5,600],[800],[800,600,1],['800',600]]){const v=sample();v.viewport=viewport;assert.throws(()=>parse(v),invalid);}const raw=text(sample()).replace('"schemaVersion": 1','"schemaVersion": 1e0').replace('800','8e2');assert.equal(parse(raw).model.schemaVersion,1);
});
test('GPU-safe camera and light Y-up bases and nondegenerate frustum reject unusable finite vectors',()=>{
 for(const [section,field,bad] of [['camera','position',[0,0,0]],['camera','position',[0,8,0]],['camera','position',[0.000001,8,0]],['camera','position',[0.001,0,0]],['camera','near',0.0001],['camera','near',10001],['camera','far',0.05],['camera','far',0.0505],['camera','far',100001],['camera','fovDegrees',180],['light','direction',[0,0,0]],['light','direction',[0,1,0]],['light','direction',[0.000001,1,0]],['light','energy',17]]){const value=sample();value[section][field]=bad;assert.throws(()=>parse(value),invalid);}const value=sample();value.camera.position=[0.01,0,0];value.camera.near=10000;value.camera.far=100000;value.light.direction=[1e-200,0,1e-200];value.light.energy=0;assert.ok(parse(value));
});
test('authored vector size rotation color boundaries remain exact without value normalization',()=>{
 const value=sample();value.objects[0].position=[-100000,100000,0];value.objects[0].rotationDegrees=[-36000,36000,0];value.objects[0].size=[0.001,1000,1];value.background='#ABCDEF';assert.deepEqual(parse(value).model.objects[0],value.objects[0]);for(const [field,bad] of [['position',[100001,0,0]],['rotationDegrees',[36001,0,0]],['size',[0,1,1]],['size',[1001,1,1]],['color','#zzzzzz'],['primitive','sphere']]){const v=sample();v.objects[0][field]=bad;assert.throws(()=>parse(v),invalid);}
});
test('128KiB UTF8 source budget admits exact limit and rejects extra Unicode bytes',()=>{
 const raw=text(sample()),full=raw+' '.repeat(MAX_SCENE3D_BYTES-Buffer.byteLength(raw));assert.ok(parse(full));assert.throws(()=>parse(full+' '),limit);assert.throws(()=>parseScene3DSource('🦊'.repeat(32769)),limit);
});
test('3D parsing and planning do not change existing 2D composition semantics or grant 2D-format fallback',async()=>{
 const content=await fs.readFile(new URL('../../examples/scene-composition/recipe.json',import.meta.url),'utf8'),before=expandSceneComposition(content);for(let i=0;i<3;i++)createScene3DPlan(text(sample()));assert.deepEqual(expandSceneComposition(content),before);assert.throws(()=>parse(content),invalid);assert.throws(()=>expandSceneComposition(text(sample())),{errorCode:'scene_composition_invalid'});
});
