import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { exportScene3DProject, executeScene3DProject } from '../../../scripts/adapters/node-scene3d-export.mjs';

const base = path.dirname(fileURLToPath(import.meta.url)), root = path.resolve(base, '../../..');
const godot = '/home/chiharukiryu/.cache/io.viento.studio/toolchains/godot/4.7.2-stable/linux-x86_64/Godot_v4.7.2-stable_linux.x86_64';
const expectedGodotHash = '8d106cbe6144c2dc7e881d61d2429c1a8a76e6b22ef48bd5e48dcf934953f71e';
const hash = value => createHash('sha256').update(value).digest('hex');
const owned = ['scripts/backends/godot4-scene3d.mjs', 'scripts/backends/godot3d/runtime.gd', 'scripts/adapters/node-scene3d-export.mjs',
  'scripts/tests/scene3d-particles-backend.test.mjs', 'engine/scene3d.mjs', 'engine/scene3d-particles.mjs', 'engine/studio-core.mjs', 'engine/studio-core.wasm'];
async function hashes() { return Object.fromEntries(await Promise.all(owned.map(async file => { const bytes = await fs.readFile(path.join(root, file)); return [file, { bytes: bytes.length, sha256: hash(bytes) }]; }))); }
async function toolIdentity() {
  const stat = await fs.lstat(godot); assert.ok(stat.isFile() && !stat.isSymbolicLink());
  const sha256=hash(await fs.readFile(godot));assert.equal(sha256,expectedGodotHash);
  return { dev: stat.dev, ino: stat.ino, bytes: stat.size, sha256 };
}
const field = override => ({ center:[0,3,0],extent:[10,8,10],velocity:[.25,-6,-.5],size:[.035,.65,.035],color:'#aAccEe',count:32,seed:12345,...override });
const cases = [
  ['absent',undefined], ['disabled',field({count:0})], ['rain',field({})],
  ['snow',field({velocity:[-.2,-.7,.15],size:[.12,.12,.12],color:'#eeeeff',count:64,seed:0})],
  ['negative-wrap',field({velocity:[-1.25,-6.75,-.125],seed:0x9e3779b9})],
  ['maximum',field({count:4096,seed:4294967295}),{color:'#aabbcc',density:.075}],
  ['small-fast',field({extent:[.01,.015,.02],size:[.001,.001,.001],velocity:[1000,-1000,.125],center:[100000,-100000,100000],count:4})],
  ['tiny-velocity',field({velocity:[-1e-20,1e-40,5e-324],count:1})]
];
const report = {format:'viento-scene3d-particles-godot-evidence',schemaVersion:1,ok:false,
  scope:'Actual pinned Linux Godot identify/import/script-check and headless MultiMesh resource/data/material/AABB plus explicit-time shader-uniform probe. Host compares phases and offsets to the independent Rust core. No headless proof of shader-deformed GPU pixels, visual rain/snow realism, WebGL/Godot pixel equality, physics, gameplay, Android or installation.',
  node:{executable:process.execPath,version:process.version,sha256:hash(await fs.readFile(process.execPath))},tool:{path:godot,...await toolIdentity()},sourcesBefore:await hashes(),cases:[]};
try {
  for (const [name,particles,fog] of cases) {
    const temporary = await fs.mkdtemp(path.join(os.tmpdir(),'viento-particle-godot-')), pin=await fs.lstat(temporary);
    const record={name,ok:false,fixture:{path:temporary,dev:pin.dev,ino:pin.ino,removed:false}};
    try {
      const value=JSON.parse(await fs.readFile(path.join(root,'examples/scene3d/scene.json'),'utf8'));
      if(particles)value.particleField=particles;if(fog)value.fog=fog;
      const content='\ufeff'+JSON.stringify(value,null,2).replaceAll('\n','\r\n')+'\r\n',input=path.join(temporary,'source.json'),output=path.join(temporary,'project');
      await fs.writeFile(input,content);const receipt=await exportScene3DProject({input,output});
      const execution=await executeScene3DProject(receipt,{godotBin:godot,run:true});
      record.sourceSha256=hash(Buffer.from(content));record.manifest=receipt.manifest;
      record.execution={...execution,phases:execution.phases.map(phase=>({...phase,stdout:{bytes:Buffer.byteLength(phase.stdout),sha256:hash(Buffer.from(phase.stdout))},stderr:phase.stderr}))};
      if(execution.probe?.particleField){const phaseData=execution.probe.particleField.phases;record.execution.probe={...execution.probe,particleField:{...execution.probe.particleField,phases:{count:phaseData.length,sha256:hash(Buffer.from(JSON.stringify(phaseData))),first:phaseData[0],last:phaseData.at(-1)}}};}
      if(!execution.ok && execution.errorCode !== 'scene3d_particle_probe_unavailable') record.failureOutput=execution.phases;
      const expectedUnavailable = (particles?.count ?? 0) > 0;
      assert.equal(execution.ok,!expectedUnavailable,JSON.stringify(record));if(expectedUnavailable)assert.equal(execution.errorCode,'scene3d_particle_probe_unavailable');
      record.outcome=expectedUnavailable?'expected-dummy-instance-data-unavailable':'verified';assert.equal(execution.phases.length,4);assert.ok(execution.phases.every(phase=>phase.status==='succeeded'&&phase.exitCode===0));
      assert.ok(execution.phases.every(phase=>Buffer.byteLength(phase.stdout)<1024*1024));
      assert.equal(await fs.readFile(input,'utf8'),content);assert.equal(await fs.readFile(path.join(output,'source.json'),'utf8'),content);
      if(!particles)assert.equal(Object.hasOwn(execution.probe,'particleField'),false);
      else { assert.equal(execution.probe.particleField.instanceCount,particles.count);assert.deepEqual(execution.probe.particleField.clock,{timeSeconds:3600,processing:false});assert.equal(execution.probe.particleField.samples.length,4); }
      await fs.writeFile(path.join(base,`godot-source-${name}.json`),content);
      record.generatedFiles=[];
      for(const file of [...receipt.manifest.files.map(entry=>entry.path),'scene3d-project.json']){const bytes=await fs.readFile(path.join(output,file));record.generatedFiles.push({path:file,bytes:bytes.length,sha256:hash(bytes)});}
      record.ok=true;
    } catch(error){record.error={name:error.name,message:error.message,code:error.errorCode||error.code};throw error;}
    finally {const current=await fs.lstat(temporary);assert.ok(current.isDirectory()&&!current.isSymbolicLink()&&current.dev===pin.dev&&current.ino===pin.ino);await fs.rm(temporary,{recursive:true});record.fixture.removed=true;report.cases.push(record);await fs.writeFile(path.join(base,`godot-${name}.json`),JSON.stringify(record,null,2)+'\n');}
  }
  report.sourcesAfter=await hashes();assert.deepEqual(report.sourcesAfter,report.sourcesBefore);report.toolAfter=await toolIdentity();assert.deepEqual(report.toolAfter,Object.fromEntries(Object.entries(report.tool).filter(([key])=>key!=='path')));report.ok=true;
} catch(error){report.error={name:error.name,message:error.message,code:error.errorCode||error.code};process.exitCode=1;}
finally{await fs.writeFile(path.join(base,'godot.json'),JSON.stringify(report,null,2)+'\n');}
console.log(JSON.stringify({ok:report.ok,cases:report.cases.map(c=>({name:c.name,ok:c.ok,probeBytes:c.execution?.phases.at(-1)?.stdout.bytes})),error:report.error}));
