import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import '../adapters/node-studio-core.mjs';
import { createScene3DPlan } from '../../engine/scene3d.mjs';
import { prepareScene3DParticleField, sampleScene3DParticleField } from '../../engine/scene3d-particles.mjs';
import { generateGodotScene3DProject, validateGodotScene3DPlan } from '../backends/godot4-scene3d.mjs';
import { exportScene3DProject, executeScene3DProject } from '../adapters/node-scene3d-export.mjs';

const source = JSON.parse(await fs.readFile(new URL('../../examples/scene3d/scene.json', import.meta.url), 'utf8'));
const field = (overrides = {}) => ({ center: [2, 3, -4], extent: [12, 10, 8], velocity: [1.25, -6, -.25], size: [.04, .7, .04], color: '#AacCeE', count: 32, seed: 12345, ...overrides });
const rgba = color => [1, 3, 5].map(index => parseInt(color.slice(index, index + 2), 16) / 255).concat(1);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const dir = vector => { const n = Math.hypot(...vector); return vector.map(value => value / n); };
const basis = angles => { const [x,y,z] = angles.map(value => value*Math.PI/180), cx=Math.cos(x),sx=Math.sin(x),cy=Math.cos(y),sy=Math.sin(y),cz=Math.cos(z),sz=Math.sin(z); return [[cy*cz,cx*sz+sx*sy*cz,sx*sz-cx*sy*cz],[-cy*sz,cx*cz-sx*sy*sz,sx*cz+cx*sy*sz],[sy,-sx*cy,cx*cy]]; };
function expectedProbe(scene) {
  const value = { format:'viento-scene3d-probe',schemaVersion:1,ok:true,issues:[],objectCount:scene.objects.length,
    objects:scene.objects.map(object => ({instanceId:object.instanceId,name:object.name,position:object.position,declaredRotationDegrees:object.rotationDegrees,basisColumns:basis(object.rotationDegrees),size:object.size,color:object.color,materialColor:rgba(object.color),rotationOrder:'XYZ'})),
    camera:{position:scene.camera.position,forward:dir(scene.camera.target.map((v,i)=>v-scene.camera.position[i])),fovDegrees:scene.camera.fovDegrees,near:scene.camera.near,far:scene.camera.far},light:{forward:dir(scene.light.direction),energy:scene.light.energy,color:rgba(scene.light.color)},coordinateSystem:'RH-Y-up-negative-Z-forward',rotationOrder:'XYZ',scope:'Fixture only; actual engine proof is separate.' };
  if (scene.fog) value.fog = {mode:0,enabled:scene.fog.density>0,density:Math.fround(scene.fog.density),color:rgba(scene.fog.color),lightEnergy:1,heightDensity:0,sunScatter:0,aerialPerspective:0,skyAffect:0};
  if (scene.particleField) {
    const {field:f,phases} = prepareScene3DParticleField(scene.particleField), bounds=f.extent.map((v,i)=>v+f.size[i]);
    value.particleField = {clock:{timeSeconds:3600,processing:false},instanceCount:f.count,visibleInstanceCount:f.count,transformFormat:1,useCustomData:true,center:f.center.map(Math.fround),extent:f.extent.map(Math.fround),size:f.size.map(Math.fround),color:rgba(f.color).map(Math.fround),aabb:{position:bounds.map(v=>Math.fround(-v/2)),size:bounds.map(Math.fround)},phases:phases.map(p=>[...p,1]),transformsIdentity:true,samples:[0,.5,2,3600].map(timeSeconds=>({timeSeconds,offset:sampleScene3DParticleField(f,timeSeconds).offset.map(Math.fround)}))};
  }
  return value;
}
async function fixture(t, particles = field(), fog) {
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'viento-particle-backend-')); const identity=await fs.lstat(directory);
  t.after(async()=>{ const st=await fs.lstat(directory); assert.equal(st.ino,identity.ino); assert.equal(st.dev,identity.dev); assert.equal(st.isSymbolicLink(),false); await fs.rm(directory,{recursive:true}); });
  const value=structuredClone(source); if(particles!==null)value.particleField=particles;if(fog)value.fog=fog;
  const content='\ufeff'+JSON.stringify(value,null,2).replaceAll('\n','\r\n')+'\r\n',input=path.join(directory,'scene.json'),output=path.join(directory,'output'); await fs.writeFile(input,content);
  return {directory,input,output,value,content};
}
async function fakeGodot(f,mutation='') {
  const receipt=path.join(f.directory,'expected.json'); await fs.writeFile(receipt,JSON.stringify(expectedProbe(f.value)));
  const file=path.join(f.directory,'fake-godot');
  await fs.writeFile(file,`#!${process.execPath}\nconst fs=require('node:fs');if(process.argv.includes('--version')){console.log('4.7.2.stable.fixture');return;}if(!process.argv.includes('--viento-scene3d-probe'))return;const p=JSON.parse(fs.readFileSync(${JSON.stringify(receipt)},'utf8'));${mutation};console.log('VIENTO_SCENE3D_PROBE '+JSON.stringify(p));`,{mode:0o700});return file;
}

test('particle adapter generates one bounded MultiMesh and consumes exact Rust phases without engine RNG or TIME',async()=>{
  for(const count of [0,1,4096]) {
    const value={...source,particleField:field({count})},plan=createScene3DPlan(JSON.stringify(value)),before=JSON.stringify(plan);
    const generated=await generateGodotScene3DProject(plan),text=generated.files.get('scene.tscn').toString(),runtime=generated.files.get('runtime.gd').toString();
    assert.equal((text.match(/type="MultiMeshInstance3D"/g)||[]).length,1);assert.ok(text.includes('transform_format = 1\nuse_custom_data = true'));
    assert.ok(text.includes('size = Vector3(0.04, 0.7, 0.04)'));assert.ok(text.includes('shader_parameter/sample_offset = Vector3(0, 0, 0)'));
    assert.ok(text.includes('custom_aabb = AABB(-6.02, -5.35, -4.02, 12.04, 10.7, 8.04)'));
    const phases=prepareScene3DParticleField(value.particleField).phases.flat();
    assert.ok(text.includes(`metadata/viento_phases = PackedVector3Array(${phases.join(', ')})`));
    assert.match(text,/INSTANCE_CUSTOM/);assert.doesNotMatch(text,/\bTIME\b|randf|randi|GPUParticles|CPUParticles/);
    assert.ok(runtime.includes('set_instance_custom_data'));assert.ok(runtime.includes('get_instance_custom_data'));assert.ok(runtime.includes('particle_elapsed >= 3600.0'));
    assert.deepEqual([...generated.files.keys()],['project.godot','scene.tscn','runtime.gd']);assert.ok(generated.files.get('scene.tscn').length<1024*1024);assert.equal(JSON.stringify(plan),before);
  }
});

test('strict particle source rejects unknown keys getters invalid count seed extent and size',()=>{
  const plan=createScene3DPlan(JSON.stringify(source));
  for(const invalid of [null,{},field({count:-1}),field({count:4097}),field({count:.1}),field({seed:-1}),field({seed:4294967296}),field({seed:1.1}),field({extent:[0,1,1]}),field({size:[20,1,1]}),field({velocity:[1001,0,0]}),field({color:'#ffffffff'}),{...field(),rain:true}])
    assert.throws(()=>validateGodotScene3DPlan({...plan,scene:{...plan.scene,particleField:invalid}}));
  let read=0;const getter=field();Object.defineProperty(getter,'count',{enumerable:true,get(){read++;return 12;}});assert.throws(()=>validateGodotScene3DPlan({...plan,scene:{...plan.scene,particleField:getter}}));assert.equal(read,0);
  assert.throws(()=>validateGodotScene3DPlan({...plan,scene:{...plan.scene,weather:field()}}));
});

test('particle exports preserve BOM CRLF source neutral data six-file inventory and additive capability',async t=>{
  for(const count of [0,16]) {
    const f=await fixture(t,field({count}),{color:'#aabbcc',density:0}),receipt=await exportScene3DProject(f);
    assert.equal(await fs.readFile(f.input,'utf8'),f.content);assert.equal(await fs.readFile(path.join(f.output,'source.json'),'utf8'),f.content);
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(f.output,'plan.json'),'utf8')).scene.particleField,f.value.particleField);
    assert.ok(receipt.manifest.backend.capabilities.includes('scene3d.particle-field'));assert.ok(receipt.manifest.backend.capabilities.includes('scene3d.distance-fog'));
    assert.equal((await fs.readdir(f.output)).length,6);
    for(const entry of receipt.manifest.files){const bytes=await fs.readFile(path.join(f.output,entry.path));assert.equal(bytes.length,entry.bytes);assert.equal(hash(bytes),entry.sha256);}
  }
});

test('particle probe host accepts disabled max and negative wrap sampled field with independent Rust values',async t=>{
  for(const particles of [field({count:0}),field({count:4096,seed:4294967295}),field({velocity:[0,-6,0]}),field({velocity:[1000,-1000,.125],extent:[.01,.01,.02],size:[.001,.001,.001]}),field({velocity:[-1e-20,1e-40,5e-324]})]){
    const f=await fixture(t,particles),tool=await fakeGodot(f),result=await executeScene3DProject(await exportScene3DProject(f),{godotBin:tool,run:true});
    assert.equal(result.ok,true,JSON.stringify(result));assert.equal(result.probe.particleField.phases.length,particles.count);assert.match(result.scope,/no shader-deformed GPU pixel verification/);
  }
});

test('particle probe rejects omissions extra data altered phases transforms bounds material and time samples',async t=>{
  const mutations=['delete p.particleField','p.particleField=null','p.particleField.extra=true','delete p.particleField.aabb',
    'p.particleField.instanceCount++','p.particleField.visibleInstanceCount=-1','p.particleField.transformFormat=0','p.particleField.useCustomData=false','p.particleField.transformsIdentity=false',
    'p.particleField.center[0]++','p.particleField.extent[0]++','p.particleField.size[0]++','p.particleField.color[0]=0',
    'p.particleField.aabb.size[0]--','p.particleField.aabb.position[0]++','p.particleField.aabb.extra=true',
    'p.particleField.phases.pop()','p.particleField.phases[0][0]=0','p.particleField.phases[0][3]=0','p.particleField.phases[0].push(0)',
    'p.particleField.clock.processing=true','p.particleField.clock.timeSeconds=3601','delete p.particleField.clock','p.particleField.samples.pop()','p.particleField.samples[1].timeSeconds=0','p.particleField.samples[1].offset[1]=0','p.particleField.samples[1].offset.push(0)','p.particleField.samples[1].extra=true'];
  for(const mutation of mutations){const f=await fixture(t),tool=await fakeGodot(f,mutation),result=await executeScene3DProject(await exportScene3DProject(f),{godotBin:tool,run:true});assert.equal(result.errorCode,'scene3d_probe_invalid',mutation);}
});

test('no-field and fog-only projects retain old probe shape and reject injected particle authority',async t=>{
  for(const fog of [undefined,{color:'#aabbcc',density:.1}]){
    const f=await fixture(t,null,fog),tool=await fakeGodot(f),receipt=await exportScene3DProject(f),result=await executeScene3DProject(receipt,{godotBin:tool,run:true});
    assert.equal(result.ok,true,JSON.stringify(result));assert.equal(Object.hasOwn(result.probe,'particleField'),false);assert.equal(receipt.manifest.backend.capabilities.includes('scene3d.particle-field'),false);
    assert.doesNotMatch(await fs.readFile(path.join(f.output,'scene.tscn'),'utf8'),/MultiMesh|ParticleField|Shader_particles/);
    const wrong=await fixture(t,null,fog),bad=await fakeGodot(wrong,'p.particleField={}');assert.equal((await executeScene3DProject(await exportScene3DProject(wrong),{godotBin:bad,run:true})).errorCode,'scene3d_probe_invalid');
  }
});

test('particle receipts keep ownership single-use and generated shader hash protections',async t=>{
  const f=await fixture(t),tool=await fakeGodot(f),receipt=await exportScene3DProject(f);
  await assert.rejects(executeScene3DProject(structuredClone(receipt),{godotBin:tool,run:true}),{errorCode:'scene3d_owner_invalid'});
  assert.equal((await executeScene3DProject(receipt,{godotBin:tool,run:true})).ok,true);await assert.rejects(executeScene3DProject(receipt,{godotBin:tool,run:true}),{errorCode:'scene3d_owner_invalid'});
  const changed=await fixture(t),owned=await exportScene3DProject(changed);await fs.appendFile(path.join(changed.output,'scene.tscn'),'\n; changed shader\n');
  await assert.rejects(executeScene3DProject(owned,{godotBin:process.execPath,run:true}),{errorCode:'scene3d_output_changed'});
});
