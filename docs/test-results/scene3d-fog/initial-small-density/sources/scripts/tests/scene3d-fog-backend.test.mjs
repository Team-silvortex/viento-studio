import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import '../adapters/node-studio-core.mjs';
import { createScene3DPlan } from '../../engine/scene3d.mjs';
import { generateGodotScene3DProject, validateGodotScene3DPlan } from '../backends/godot4-scene3d.mjs';
import { exportScene3DProject, executeScene3DProject, readScene3DInput } from '../adapters/node-scene3d-export.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const scene = () => ({ format: 'viento-scene3d', schemaVersion: 1, name: 'Prototype / 原文 / 立体 🦊', viewport: [640, 480], background: '#102030', camera: { position: [6, 5, 8], target: [0, 1, 0], fovDegrees: 55, near: .1, far: 1000 }, light: { direction: [-1, -2, -1], color: '#ffffee', energy: 2 }, objects: [{ instanceId: randomUUID(), name: 'Box " quoted \\ text\n🦊', primitive: 'box', position: [1.25, 1.5, -2], rotationDegrees: [23, -41, 67], size: [2, 3, 4], color: '#44AAee' }] });
async function fixture(t) { const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-scene3d-export-test-')); t.after(() => fs.rm(directory, { recursive: true, force: true })); const input = path.join(directory, 'scene.json'), value = scene(), content = '\ufeff' + JSON.stringify(value, null, 2).replaceAll('\n', '\r\n') + '\r\n'; await fs.writeFile(input, content); return { directory, input, output: path.join(directory, 'output'), value, content }; }
const absent = async name => assert.rejects(fs.lstat(name), { code: 'ENOENT' });

async function fakeGodot(f, mode='') {
  const file=path.join(f.directory,'fake-godot');
  const script=`#!${process.execPath}\nconst fs=require('node:fs');const path=require('node:path');fs.appendFileSync(${JSON.stringify(path.join(f.directory,'executions'))},'phase\\n');const args=process.argv.slice(2);if(args.includes('--version')){console.log("4.7.2.stable.fixture");return;}if(!args.includes('--viento-scene3d-probe')){return;}const s=JSON.parse(fs.readFileSync('plan.json','utf8')).scene;const dir=v=>{const m=Math.max(...v.map(Math.abs)),w=v.map(x=>x/m),n=Math.hypot(...w);return w.map(x=>x/n);};const rgba=c=>[1,3,5].map(n=>parseInt(c.slice(n,n+2),16)/255).concat(1);const basis=a=>{const [x,y,z]=a.map(v=>v*Math.PI/180),cx=Math.cos(x),sx=Math.sin(x),cy=Math.cos(y),sy=Math.sin(y),cz=Math.cos(z),sz=Math.sin(z);return [[cy*cz,cx*sz+sx*sy*cz,sx*sz-cx*sy*cz],[-cy*sz,cx*cz-sx*sy*sz,sx*cz+cx*sy*sz],[sy,-sx*cy,cx*cy]];};const p={format:'viento-scene3d-probe',schemaVersion:1,ok:true,issues:[],objectCount:s.objects.length,objects:s.objects.map(o=>({instanceId:o.instanceId,name:o.name,position:o.position,declaredRotationDegrees:o.rotationDegrees,basisColumns:basis(o.rotationDegrees),size:o.size,color:o.color,materialColor:rgba(o.color),rotationOrder:'XYZ'})),camera:{position:s.camera.position,forward:dir(s.camera.target.map((v,n)=>v-s.camera.position[n])),fovDegrees:s.camera.fovDegrees,near:s.camera.near,far:s.camera.far},light:{forward:dir(s.light.direction),energy:s.light.energy,color:rgba(s.light.color)},coordinateSystem:'RH-Y-up-negative-Z-forward',rotationOrder:'XYZ',scope:'Fixture only.'};if(s.fog)p.fog={mode:0,enabled:s.fog.density>0,density:Math.fround(s.fog.density),color:rgba(s.fog.color),lightEnergy:1,heightDensity:0,sunScatter:0,aerialPerspective:0,skyAffect:0};${mode};console.log('VIENTO_SCENE3D_PROBE '+JSON.stringify(p));`;
  await fs.writeFile(file,script,{mode:0o700});return file;
}

async function withFog(t, fog = { color: '#7aA0cf', density: .04 }) {
  const f = await fixture(t); if (fog !== undefined) f.value.fog = fog;
  f.content = '\ufeff' + JSON.stringify(f.value, null, 2).replaceAll('\n', '\r\n') + '\r\n'; await fs.writeFile(f.input, f.content); return f;
}

test('Godot generation declares bounded exponential distance fog without height sun sky or aerial contributions', async () => {
  for (const density of [0, .04, 1, 1e-40, 5e-324]) {
    const value = { ...scene(), fog: { color: '#7aA0cf', density } }, plan = createScene3DPlan(JSON.stringify(value)), original = JSON.stringify(plan);
    const result = await generateGodotScene3DProject(plan), text = result.files.get('scene.tscn').toString();
    for (const line of ['fog_mode = 0', `fog_enabled = ${density > 0}`, `fog_density = ${density}`, 'fog_light_energy = 1.0', 'fog_height_density = 0.0', 'fog_sun_scatter = 0.0', 'fog_aerial_perspective = 0.0', 'fog_sky_affect = 0.0']) assert.ok(text.includes(line), line);
    assert.match(text, /fog_light_color = Color\(0.47843137254901963, 0.6274509803921569, 0.8117647058823529, 1\)/);
    assert.deepEqual(result.plan.scene.fog, value.fog); assert.equal(JSON.stringify(plan), original);
  }
  const noFog = await generateGodotScene3DProject(createScene3DPlan(JSON.stringify(scene())));
  assert.doesNotMatch(noFog.files.get('scene.tscn').toString(), /fog_/); assert.equal(Object.hasOwn(noFog.plan.scene, 'fog'), false);
});

test('adapter accepts only the optional fog record and rejects unknown dimensions engine fields and accessors', () => {
  const plan = createScene3DPlan(JSON.stringify(scene()));
  for (const fog of [null, {}, { color: '#aabbcc' }, { color: '#aabbcc', density: -.01 }, { color: '#aabbcc', density: 1.01 },
    { color: '#aabbcc', density: 0, enabled: true }, { color: '#aabbccff', density: 0 }, { color: '#aabbcc', density: '0.1' }, { color: '#aabbcc', density: Infinity }])
    assert.throws(() => validateGodotScene3DPlan({ ...plan, scene: { ...plan.scene, fog } }));
  assert.throws(() => validateGodotScene3DPlan({ ...plan, scene: { ...plan.scene, weather: { fog: { color: '#aabbcc', density: .1 } } } }));
  let reads = 0; const fog = { density: .1 }; Object.defineProperty(fog, 'color', { enumerable: true, get() { reads++; return '#aabbcc'; } });
  assert.throws(() => validateGodotScene3DPlan({ ...plan, scene: { ...plan.scene, fog } })); assert.equal(reads, 0);
});

test('fog export retains exact source and neutral data with a truthful artifact capability and full inventory', async t => {
  for (const density of [0, .2]) {
    const f = await withFog(t, { color: '#bBdDeE', density }), receipt = await exportScene3DProject(f);
    assert.ok(receipt.manifest.backend.capabilities.includes('scene3d.distance-fog'));
    assert.equal(await fs.readFile(path.join(f.output, 'source.json'), 'utf8'), f.content);
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(f.output, 'plan.json'), 'utf8')).scene.fog, f.value.fog);
    for (const file of receipt.manifest.files) { const bytes = await fs.readFile(path.join(f.output, file.path)); assert.equal(hash(bytes), file.sha256); assert.equal(bytes.length, file.bytes); }
    assert.equal(await fs.readFile(f.input, 'utf8'), f.content);
  }
});

test('host accepts actual-property fog receipts including disabled zero and float32 tiny values', async t => {
  for (const density of [0, .04, 1, 1e-40, 5e-324]) {
    const f = await withFog(t, { color: '#7aA0cf', density }), tool = await fakeGodot(f), receipt = await exportScene3DProject(f), result = await executeScene3DProject(receipt, { godotBin: tool, run: true });
    assert.equal(result.ok, true, JSON.stringify(result)); assert.equal(result.probe.fog.enabled, density > 0); assert.equal(result.probe.fog.density, Math.fround(density));
    assert.equal(result.probe.fog.skyAffect, 0); assert.equal(await fs.readFile(f.input, 'utf8'), f.content);
  }
});

test('host rejects omitted forged extra or mismatched fog properties without widening probe admission', async t => {
  const mutations = ['delete p.fog', 'p.fog.extra = true', 'delete p.fog.density', 'p.fog = null', 'p.fog.enabled = false', 'p.fog.enabled = 1',
    'p.fog.mode = 1', 'p.fog.density = 0', 'p.fog.color = [0,0,0,1]', 'p.fog.color.push(1)', 'p.fog.lightEnergy = 2',
    'p.fog.heightDensity = .001', 'p.fog.sunScatter = .1', 'p.fog.aerialPerspective = .1', 'p.fog.skyAffect = .1', 'p.fog.density = "0.04"'];
  for (const mutation of mutations) {
    const f = await withFog(t), tool = await fakeGodot(f, mutation), receipt = await exportScene3DProject(f), result = await executeScene3DProject(receipt, { godotBin: tool, run: true });
    assert.equal(result.ok, false, mutation); assert.equal(result.errorCode, 'scene3d_probe_invalid', mutation);
  }
  const tiny = await withFog(t, { color: '#7aA0cf', density: 1e-40 }), tool = await fakeGodot(tiny, 'p.fog.density = 0');
  assert.equal((await executeScene3DProject(await exportScene3DProject(tiny), { godotBin: tool, run: true })).errorCode, 'scene3d_probe_invalid');
});

test('no-fog source retains the old exact probe shape and refuses a newly injected fog receipt', async t => {
  const f = await fixture(t), tool = await fakeGodot(f), receipt = await exportScene3DProject(f), result = await executeScene3DProject(receipt, { godotBin: tool, run: true });
  assert.equal(result.ok, true); assert.equal(Object.hasOwn(result.probe, 'fog'), false); assert.equal(receipt.manifest.backend.capabilities.includes('scene3d.distance-fog'), false);
  const forged = await fixture(t), badTool = await fakeGodot(forged, 'p.fog = {enabled:false}');
  assert.equal((await executeScene3DProject(await exportScene3DProject(forged), { godotBin: badTool, run: true })).errorCode, 'scene3d_probe_invalid');
});

test('fog receipts retain single-use ownership and altered source or generated fog cannot authorize execution', async t => {
  const f = await withFog(t), tool = await fakeGodot(f), receipt = await exportScene3DProject(f);
  await assert.rejects(executeScene3DProject(JSON.parse(JSON.stringify(receipt)), { godotBin: tool, run: true }), { errorCode: 'scene3d_owner_invalid' });
  assert.equal((await executeScene3DProject(receipt, { godotBin: tool, run: true })).ok, true);
  await assert.rejects(executeScene3DProject(receipt, { godotBin: tool, run: true }), { errorCode: 'scene3d_owner_invalid' });
  const other = await withFog(t), changed = await exportScene3DProject(other); await fs.appendFile(path.join(other.output, 'scene.tscn'), '\nfog_density = 0.9\n');
  await assert.rejects(executeScene3DProject(changed, { godotBin: process.execPath, run: true }), { errorCode: 'scene3d_output_changed' });
});
