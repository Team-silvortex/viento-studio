import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import Ajv2020 from 'ajv/dist/2020.js';
import { STUDIO_MODULES, createStudioModuleRegistry } from '../../engine/studio-modules.mjs';

const profile = required => ({format:'viento-studio-profile',schemaVersion:1,required:required.map(capability=>({capability,apiVersion:1})),optional:[]});
const capability=(plan,id)=>plan.capabilities.find(item=>item.capability===id);
test('3D representation and preview are a separate fixed module with only document dependency',()=>{
 const declaration=STUDIO_MODULES.find(item=>item.id==='org.viento.scene3d');
 assert.deepEqual(declaration.dependencies,[{id:'org.viento.document',apiVersion:1}]);
 assert.deepEqual(declaration.contributions.map(item=>item.capability),['scene.representation.scene3d','scene.preview.scene3d']);
 const p=createStudioModuleRegistry().plan(profile(['scene.representation.scene3d','scene.preview.scene3d']));
 assert.equal(p.satisfied,true);assert.ok(p.requests.every(item=>item.moduleId===declaration.id));
 for(const key of ['backendId','execute','writable','sourcePath','save','getSource'])assert.equal(Object.hasOwn(p,key),false);
});
test('3D disablement preserves 2D and ordinary document modules while accurately diagnosing its own requests',()=>{
 const p=createStudioModuleRegistry().plan(profile(['scene.representation.scene3d']),{enabledModules:{'org.viento.scene3d':false}});
 assert.equal(p.satisfied,false);assert.equal(p.requests[0].status,'inactive');
 assert.equal(capability(p,'scene.representation.scene2d').active,true);assert.equal(capability(p,'document.edit').active,true);
 assert.equal(capability(p,'scene.preview.scene3d').active,false);
});
test('a 3D representation does not depend on 2D/world backend capabilities',()=>{
 const p=createStudioModuleRegistry().plan(profile(['scene.representation.scene3d']),{enabledModules:{'org.viento.build':false,'org.viento.world':false}});
 assert.equal(p.satisfied,true);assert.equal(capability(p,'scene.representation.scene3d').active,true);
 assert.equal(capability(p,'scene.representation.scene2d').active,false);assert.equal(capability(p,'backend.execution').active,false);
});
test('schema and example describe strict 3D boxes without 2D or executable author fields',async()=>{
 const schema=JSON.parse(await fs.readFile(new URL('../../schemas/scene3d-v1.schema.json',import.meta.url)));
 const example=JSON.parse(await fs.readFile(new URL('../../examples/scene3d/scene.json',import.meta.url)));
 const validate=new Ajv2020({allErrors:true}).compile(schema);assert.equal(validate(example),true,JSON.stringify(validate.errors));
 for(const mutate of [d=>d.format='viento-scene2d',d=>d.script='res://custom.gd',d=>d.objects[0].objectId='unregistered',d=>d.objects[0].primitive='mesh',d=>d.objects[0].size[0]=0,d=>d.camera.near=0,d=>d.objects[0].instanceId='../asset',d=>d.camera.fovDegrees=180,d=>d.objects=[]]){
  const next=structuredClone(example);mutate(next);assert.equal(validate(next),false);
 }
 assert.equal(new Set(example.objects.map(object=>object.instanceId)).size,example.objects.length);
});
