import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { exportScene3DProject } from '../../../scripts/adapters/node-scene3d-export.mjs';
import { prepareScene3DParticleField, sampleScene3DParticleField } from '../../../engine/scene3d-particles.mjs';
import { runBuildProcess } from '../../../scripts/lib/build-process.mjs';
const base=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(base,'../../..');
const godot='/home/chiharukiryu/.cache/io.viento.studio/toolchains/godot/4.7.2-stable/linux-x86_64/Godot_v4.7.2-stable_linux.x86_64',xvfb='/usr/bin/Xvfb';
const hash=value=>createHash('sha256').update(value).digest('hex');
async function pin(file){const s=await fs.lstat(file);assert.ok(s.isFile()&&!s.isSymbolicLink());return{path:file,dev:s.dev,ino:s.ino,bytes:s.size,sha256:hash(await fs.readFile(file))};}
const tools={godot:await pin(godot),xvfb:await pin(xvfb)};assert.equal(tools.godot.sha256,'8d106cbe6144c2dc7e881d61d2429c1a8a76e6b22ef48bd5e48dcf934953f71e');
const sources=['scripts/backends/godot4-scene3d.mjs','scripts/backends/godot3d/runtime.gd','scripts/adapters/node-scene3d-export.mjs','engine/studio-core.wasm','engine/studio-core.mjs','engine/scene3d-particles.mjs'];
async function sourceHashes(){return Object.fromEntries(await Promise.all(sources.map(async p=>[p,hash(await fs.readFile(path.join(root,p)))])));}
const report={format:'viento-scene3d-particles-godot-gl-evidence',schemaVersion:1,ok:false,tools,sourcesBefore:await sourceHashes(),scope:'Isolated Xvfb with actual Godot Compatibility/OpenGL software rendering. Exact live MultiMesh phase/offset inputs plus rendered particle-center samples at three explicit times. No physical GPU, cross-renderer pixel equality, installation, Android, physics or gameplay claim.',cases:[]};
const server=spawn(xvfb,['-displayfd','1','-screen','0','640x480x24','-nolisten','tcp'],{stdio:['ignore','pipe','pipe']});let serverLog='';server.stderr.on('data',x=>{serverLog+=x;});
const display=await new Promise((resolve,reject)=>{let out='';const timer=setTimeout(()=>reject(Error('Xvfb startup timed out')),10000);server.once('error',reject);server.stdout.on('data',data=>{out+=data;if(/^\d+\n/.test(out)){clearTimeout(timer);resolve(':'+out.trim());}});server.once('exit',code=>{clearTimeout(timer);reject(Error('Xvfb exited '+code));});});
const f=override=>({center:[1,1,0],extent:[6,4,3],velocity:[.7,-1.25,-.3],size:[.14,.3,.14],color:'#bbddff',count:12,seed:12345,...override});
const cases=[['rain',f({})],['snow',f({size:[.2,.2,.2],velocity:[-.2,-.4,.15],count:64,seed:0})],['maximum',f({count:4096,seed:4294967295})]];
const helper=`extends SceneTree
func _initialize():
    call_deferred("run_proof")
func run_proof():
    var scene = load("res://scene.tscn").instantiate()
    root.add_child(scene)
    scene.set_process(false)
    var cases = JSON.parse_string(FileAccess.get_file_as_string("res://gpu_samples.json"))
    var frames: Array = []
    var all_ok: bool = true
    for sample in cases:
        scene.sample_particles(float(sample.timeSeconds))
        await process_frame
        await process_frame
        await RenderingServer.frame_post_draw
        var image: Image = root.get_texture().get_image()
        var background: Color = image.get_pixel(0, 0)
        var checked: int = 0
        var missed: Array = []
        for index in range(sample.positions.size()):
            var p = sample.positions[index]
            var screen: Vector2 = scene.get_node("Camera").unproject_position(Vector3(p[0],p[1],p[2]))
            var cx: int = int(round(screen.x))
            var cy: int = int(round(screen.y))
            var found: bool = false
            for dx in range(-1,2):
                for dy in range(-1,2):
                    var x: int = clampi(cx+dx,0,image.get_width()-1)
                    var y: int = clampi(cy+dy,0,image.get_height()-1)
                    var pixel: Color = image.get_pixel(x,y)
                    if absf(pixel.r-background.r)+absf(pixel.g-background.g)+absf(pixel.b-background.b)>0.12:
                        found=true
            checked+=1
            if not found:
                missed.append({"index":index,"screen":[screen.x,screen.y]})
        var output: String = "user://gpu-%s.png" % str(sample.timeSeconds)
        image.save_png(output)
        frames.append({"timeSeconds":sample.timeSeconds,"checked":checked,"missed":missed,"width":image.get_width(),"height":image.get_height(),"image":ProjectSettings.globalize_path(output)})
        all_ok=all_ok and missed.is_empty()
    print("VIENTO_PARTICLE_GPU "+JSON.stringify({"ok":all_ok,"adapter":RenderingServer.get_video_adapter_name(),"driver":DisplayServer.get_name(),"frames":frames}))
    quit(0 if all_ok else 2)
`;
try {
  for(const[name,particles]of cases){
    const temp=await fs.mkdtemp(path.join(os.tmpdir(),'viento-particle-gpu-')),owned=await fs.lstat(temp),rec={name,ok:false,fixture:{path:temp,dev:owned.dev,ino:owned.ino,removed:false}};
    try{
      const value=JSON.parse(await fs.readFile(path.join(root,'examples/scene3d/scene.json'),'utf8'));value.objects=[{...value.objects[0],position:[10000,0,0],size:[1,1,1]}];value.camera={position:[1,1,12],target:[1,1,0],fovDegrees:55,near:.1,far:100};value.viewport=[640,480];value.particleField=particles;
      const input=path.join(temp,'source.json'),output=path.join(temp,'project');await fs.writeFile(input,JSON.stringify(value));const receipt=await exportScene3DProject({input,output});
      const env={...process.env,DISPLAY:display,LIBGL_ALWAYS_SOFTWARE:'1',GODOT_SILENCE_ROOT_WARNING:'1',XDG_DATA_HOME:path.join(temp,'data'),XDG_CONFIG_HOME:path.join(temp,'config'),XDG_CACHE_HOME:path.join(temp,'cache')};
      const invoke=async(args)=>{assert.deepEqual(await pin(godot),tools.godot);const r=await runBuildProcess(godot,args,{cwd:output,env,timeoutMs:30000,maxOutputBytes:1024*1024});assert.equal(r.status,'succeeded',JSON.stringify(r));assert.equal(r.exitCode,0,JSON.stringify(r));assert.doesNotMatch(r.stdout+'\n'+r.stderr,/(?:^|\n)\s*(?:SCRIPT ERROR:|ERROR:)/);return r;};
      await invoke(['--path',output,'--headless','--editor','--import']);
      const live=await invoke(['--path',output,'--display-driver','x11','--rendering-driver','opengl3','--audio-driver','Dummy','--','--viento-scene3d-probe']);
      const lines=live.stdout.split('\n').filter(line=>line.startsWith('VIENTO_SCENE3D_PROBE '));assert.equal(lines.length,1);const probe=JSON.parse(lines[0].slice('VIENTO_SCENE3D_PROBE '.length)),actual=probe.particleField,prepared=prepareScene3DParticleField(particles);
      assert.equal(probe.ok,true);assert.equal(actual.displayDriver,'X11');assert.equal(actual.instanceDataAvailable,true);assert.equal(actual.useCustomData,false);assert.equal(actual.basesIdentity,true);assert.equal(actual.instanceCount,particles.count);assert.equal(actual.visibleInstanceCount,particles.count);assert.deepEqual(actual.nodePosition,[0,0,0]);assert.deepEqual(actual.phases,prepared.phases);
      for(const sample of actual.samples)assert.deepEqual(sample.offset,sampleScene3DParticleField(particles,sample.timeSeconds).offset.map(Math.fround));assert.deepEqual(actual.clock,{timeSeconds:3600,processing:false});
      rec.instances={count:actual.instanceCount,phaseSha256:hash(Buffer.from(JSON.stringify(actual.phases))),samples:actual.samples,clock:actual.clock,stdoutBytes:Buffer.byteLength(live.stdout),stdoutSha256:hash(Buffer.from(live.stdout)),adapterHeader:live.stdout.split('\n').slice(0,4)};assert.ok(rec.instances.stdoutBytes<1024*1024);
      if(name==='rain'){
        const samples=[0,.5,2].map(timeSeconds=>{const offset=sampleScene3DParticleField(particles,timeSeconds).offset;return{timeSeconds,positions:prepared.phases.map(phase=>phase.map((v,i)=>particles.center[i]+particles.extent[i]*((v+offset[i])%1-.5)))};});
        await fs.writeFile(path.join(output,'gpu_samples.json'),JSON.stringify(samples));await fs.writeFile(path.join(output,'gpu-proof.gd'),helper);
        const drawn=await invoke(['--path',output,'--display-driver','x11','--rendering-driver','opengl3','--audio-driver','Dummy','--script','res://gpu-proof.gd']);
        const resultLine=drawn.stdout.split('\n').find(line=>line.startsWith('VIENTO_PARTICLE_GPU '));assert.ok(resultLine);rec.rendered=JSON.parse(resultLine.slice('VIENTO_PARTICLE_GPU '.length));assert.equal(rec.rendered.ok,true);assert.equal(rec.rendered.frames.length,3);
        for(const frame of rec.rendered.frames){assert.equal(frame.checked,particles.count);assert.deepEqual(frame.missed,[]);assert.ok(frame.image.startsWith(temp+path.sep));const bytes=await fs.readFile(frame.image),name=`godot-gl-${frame.timeSeconds}.png`;await fs.writeFile(path.join(base,name),bytes);frame.image=name;frame.sha256=hash(bytes);}
        assert.equal(new Set(rec.rendered.frames.map(f=>f.sha256)).size,3);rec.helperSha256=hash(Buffer.from(helper));rec.sampleInputSha256=hash(Buffer.from(JSON.stringify(samples)));
      }
      for(const entry of receipt.manifest.files){const bytes=await fs.readFile(path.join(output,entry.path));assert.equal(hash(bytes),entry.sha256);}
      rec.ok=true;
    }catch(error){rec.error={name:error.name,message:error.message};throw error;}
    finally{const current=await fs.lstat(temp);assert.ok(!current.isSymbolicLink()&&current.dev===owned.dev&&current.ino===owned.ino);await fs.rm(temp,{recursive:true});rec.fixture.removed=true;report.cases.push(rec);}
  }
  report.sourcesAfter=await sourceHashes();assert.deepEqual(report.sourcesAfter,report.sourcesBefore);assert.deepEqual(await pin(godot),tools.godot);assert.deepEqual(await pin(xvfb),tools.xvfb);report.ok=true;
}catch(error){report.error={name:error.name,message:error.message};process.exitCode=1;}
finally{if(server.exitCode===null){server.kill('SIGTERM');await once(server,'exit');}report.display={isolated:true,serverExited:true,stderr:serverLog};await fs.writeFile(path.join(base,'godot-gl.json'),JSON.stringify(report,null,2)+'\n');}
console.log(JSON.stringify({ok:report.ok,cases:report.cases.map(c=>({name:c.name,ok:c.ok,bytes:c.instances?.stdoutBytes,frames:c.rendered?.frames.map(f=>({t:f.timeSeconds,checked:f.checked,missed:f.missed.length}))})),error:report.error}));
