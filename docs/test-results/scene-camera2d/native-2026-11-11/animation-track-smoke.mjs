import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
const repo='/home/chiharukiryu/cdev/viento-studio', base='file://'+repo+'/', at=relative=>new URL(relative,base).href;
await import(at('scripts/adapters/node-studio-core.mjs'));
const {projectAnimationControlAuthor}=await import(at('scripts/tests/helpers/project-animation-control-author-fixture.mjs'));
const {captureBuildSnapshot}=await import(at('scripts/adapters/node-build-snapshot.mjs'));
const {GODOT4_EXECUTION_ADAPTER:adapter}=await import(at('scripts/backends/godot4-adapter.mjs'));
const {cameraOn,cameraStage}=await import(at('scripts/tests/helpers/godot-camera2d-fixture.mjs'));
const {runBuildProcess}=await import(at('scripts/lib/build-process.mjs'));
const callbacks=[],t={after(fn){callbacks.push(fn);}},out=path.join(repo,'docs/test-results/scene-camera2d/native-2026-11-11'), executable=process.env.VIENTO_GODOT_BIN;
const hash=bytes=>createHash('sha256').update(bytes).digest('hex'), instance='96969696-9696-4696-8696-000000000001';
function success(r){assert.equal(r.status,'succeeded',r.stdout+r.stderr);assert.doesNotMatch(r.stdout+r.stderr,/SCRIPT ERROR:|ERROR:/);}
try {
const f=await projectAnimationControlAuthor(t,{sprites:false,secondAnimation:false});
await f.edit('documents/scenes/demo.json',scene=>{const first=scene.actors[0];scene.actors=[{...first,position:[1000,800],controls:'none',speed:0},{...first,instanceId:instance,position:[1400,900],size:[40,40],color:'#20d080',speed:0,controls:'none'}];});
for(const sceneId of f.sceneIds) await f.edit(`metadata/documents/${sceneId}.json`,record=>{record.relations=record.relations.filter(row=>!['behavior','audio'].includes(row.kind));});
await f.edit('documents/animations/scene-0.json',document=>{document.tracks[0].instanceId=instance;});
const captured=await captureBuildSnapshot(f.author,f.assemblyId);assert.equal(captured.ok,true,JSON.stringify(captured.diagnostics));
const plan=structuredClone(captured.plan);plan.resources=[];plan.requiredCapabilities=plan.requiredCapabilities.filter(x=>x!=='image');
for(const scene of plan.scenes){scene.resources=[];scene.requiredCapabilities=scene.requiredCapabilities.filter(x=>x!=='image');for(const actor of scene.actors)delete actor.imageResourceId;}
cameraOn(plan,0,{mode:'follow',targetInstanceId:instance,offset:[0,0],zoom:2});
const generated=await adapter.generate(plan),directory=await cameraStage(t,generated),tool=await adapter.identify(executable);
for(const phase of adapter.buildPhases)success(await adapter.executePhase({phase,directory,tool,timeoutMs:60000}));
const source=`extends "res://camera2d-project-runtime.gd"
func snap(label: String) -> void:
\tvar actor = current.actors[1].node
\tvar visual = actor.get_child(0)
\tvar camera = current.get_node("VientoCamera2D").camera
\tcamera.force_update_scroll()
\tvar center = camera.get_screen_center_position()
\tprint("VIENTO_ANIMATION_CAMERA:"+JSON.stringify({"label":label,"logical":[actor.position.x,actor.position.y],"visualName":str(visual.name),"visualOffset":[visual.position.x,visual.position.y],"center":[center.x,center.y],"cameraParent":str(camera.get_parent().name),"time":current.animation_time}))
\tawait RenderingServer.frame_post_draw
\tget_viewport().get_texture().get_image().save_png(${JSON.stringify(out)}+"/animation-"+label+".png")
func run_project_smoke() -> void:
\tawait get_tree().process_frame
\tawait snap("before")
\telapsed_seconds += 0.5
\ttotal_seconds += 0.5
\tcurrent.project_step(0.5)
\tawait get_tree().process_frame
\tawait snap("after")
\tfinish_project()
`;
await fs.writeFile(path.join(directory,'camera-animation-test.gd'),source);
await fs.writeFile(path.join(directory,'camera-animation-test.tscn'),'[gd_scene load_steps=2 format=3]\n\n[ext_resource type="Script" path="res://camera-animation-test.gd" id="1"]\n\n[node name="VientoProject" type="Node2D"]\nscript = ExtResource("1")\n');
const result=await runBuildProcess(executable,['--path',directory,'res://camera-animation-test.tscn','--','--viento-smoke'],{cwd:directory,env:{...process.env,GODOT_SILENCE_ROOT_WARNING:'1'},timeoutMs:60000});
success(result);const samples=result.stdout.split('\n').filter(x=>x.startsWith('VIENTO_ANIMATION_CAMERA:')).map(x=>JSON.parse(x.slice('VIENTO_ANIMATION_CAMERA:'.length)));
assert.equal(samples.length,2);assert.deepEqual(samples[0].logical,[1400,900]);assert.deepEqual(samples[1].logical,samples[0].logical);assert.deepEqual(samples[0].center,[1400,900]);assert.deepEqual(samples[1].center,samples[0].center);assert.equal(samples[0].visualName,'VientoVisual');assert.deepEqual(samples[0].visualOffset,[0,0]);assert.deepEqual(samples[1].visualOffset,[50,0]);assert.equal(samples[1].time,.5);
for(const[name,bytes]of generated.files)assert.deepEqual(await fs.readFile(path.join(directory,name)),bytes,name);
const images={};for(const name of ['before','after']){const file=path.join(out,'animation-'+name+'.png');images[name]={file:path.basename(file),sha256:hash(await fs.readFile(file))};}
await fs.writeFile(path.join(out,'animation-track-follow.json'),JSON.stringify({scope:'Additional standalone native smoke without changes to frozen production or tests',source,sourceSha256:hash(source),tool,plan,generatedHashes:Object.fromEntries([...generated.files].map(([n,b])=>[n,hash(b)])),samples,images,nativeStdout:result.stdout,nativeStderr:result.stderr},null,2)+'\n');
console.log(JSON.stringify({success:true,samples,images}));
}finally{for(const fn of callbacks.reverse())await fn();}
