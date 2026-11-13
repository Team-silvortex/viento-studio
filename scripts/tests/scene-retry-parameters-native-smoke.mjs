import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const app=fileURLToPath(new URL('../../',import.meta.url));
const keyboardDriver=fileURLToPath(new URL('./helpers/retry-parameters-keyboard.py',import.meta.url));
await import(app+'/scripts/adapters/node-studio-core.mjs');
const {buildProject}=await import(app+'/scripts/adapters/node-project-build.mjs');
const {GODOT4_EXECUTION_ADAPTER:adapter}=await import(app+'/scripts/backends/godot4-adapter.mjs');
const {runBuildProcess}=await import(app+'/scripts/lib/build-process.mjs');
const {readRegistry}=await import(app+'/scripts/lib/workspace.mjs');
const [author,output]=process.argv.slice(2),executable=process.env.VIENTO_GODOT_BIN;
assert.ok(author&&output&&executable&&path.isAbsolute(executable));assert.ok(output.startsWith('/tmp/'));
await fs.mkdir(output,{recursive:true});assert.deepEqual(await fs.readdir(output),[]);
const sha=value=>createHash('sha256').update(value).digest('hex');
async function tree(root){const result={};for(const row of await fs.readdir(root,{recursive:true,withFileTypes:true})){if(row.isFile()){const file=path.join(row.parentPath||row.path,row.name);result[path.relative(root,file)]=sha(await fs.readFile(file));}}return result;}
const before=await tree(author),registry=await readRegistry(author),assemblies=[];
for(const r of registry.documents){if(r.sourcePath.endsWith('.json')){const c=JSON.parse((await fs.readFile(path.join(author,r.sourcePath),'utf8')).replace(/^\uFEFF/,''));if(c.format==='viento-project-assembly')assemblies.push(r.id);}}
assert.equal(assemblies.length,1);
const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'viento-retry-parameters-native-'));
const env={...process.env,LIBGL_ALWAYS_SOFTWARE:'1',XDG_DATA_HOME:path.join(temporary,'data'),XDG_CONFIG_HOME:path.join(temporary,'config'),XDG_CACHE_HOME:path.join(temporary,'cache')};
const succeeded=r=>{assert.equal(r.status,'succeeded',r.stdout+r.stderr);assert.doesNotMatch(r.stdout+r.stderr,/(?:SCRIPT ERROR:|ERROR:|TOPDOWN_OBSERVER_ERROR:)/);};
try{
 const built=await buildProject({root:author,targetId:assemblies[0],tool:executable,output:path.join(temporary,'build'),timeoutMs:90000});assert.equal(built.ok,true,JSON.stringify(built));
 const snapshot=JSON.parse(await fs.readFile(path.join(temporary,'build/snapshot.json'))),generated=await adapter.generate(snapshot.plan),directory=path.join(temporary,'build/project'),tool=await adapter.identify(executable);
 for(const[name,data]of generated.files)assert.deepEqual(await fs.readFile(path.join(directory,name)),data);
 // Use the prior read-only observer, forwarding the idle hook once in a
 // non-physics project. No generated file or author behavior is replaced.
 const original=await fs.readFile(app+'/scripts/tests/helpers/topdown-observer.gd','utf8');assert.equal(original.split('_physics_process').length,3);
 const observer=original.replaceAll('_physics_process','_process');await fs.writeFile(path.join(directory,'parameter-observer.gd'),observer);
 await fs.writeFile(path.join(directory,'parameter-observer.tscn'),'[gd_scene load_steps=2 format=3]\n\n[ext_resource type="Script" path="res://parameter-observer.gd" id="1"]\n\n[node name="VientoProject" type="Node2D"]\nscript = ExtResource("1")\nsample_directory = '+JSON.stringify(path.join(output,'frames'))+'\n');
 for(const phase of adapter.buildPhases)succeeded(await adapter.executePhase({phase,directory,tool,timeoutMs:90000}));
 await fs.writeFile(path.join(output,'observer.gd'),observer);await fs.copyFile(keyboardDriver,path.join(output,'keyboard-driver.py'));
 succeeded(await runBuildProcess('python3',[keyboardDriver,executable,directory,output],{cwd:directory,env,timeoutMs:60000}));
 const reader=adapter.createEventReader(snapshot.plan,{capabilities:generated.backend.capabilities});reader.push(await fs.readFile(path.join(output,'window-output.log'),'utf8'));const received=reader.finish();assert.deepEqual(received.diagnostics,[]);
 assert.equal(received.events.filter(e=>e.event==='scene-enter').length,2);assert.equal(received.events.at(-1).event,'finished');
 for(const[name,data]of generated.files)assert.deepEqual(await fs.readFile(path.join(directory,name)),data,name);
 assert.deepEqual(await tree(author),before);
 await fs.writeFile(path.join(output,'verification.json'),JSON.stringify({ok:true,tool,assemblyId:assemblies[0],authorBefore:before,authorAfter:await tree(author),events:received.events,generatedFiles:Object.fromEntries([...generated.files].map(([n,b])=>[n,sha(b)])),observerSource:{source:'scripts/tests/helpers/topdown-observer.gd',sha256:sha(original),transformation:'exactly two _physics_process identifiers changed to _process; one inherited idle update call'},limitations:['Xvfb/Mesa software rendering and synthetic XTest keys, no physical device or installed app claim.','Observer writes captures only; generated runtime and ordinary authored retry source remain unchanged.']},null,2)+'\n');
 console.log(JSON.stringify({ok:true,events:received.events.length,generatedFiles:generated.files.size,authorFiles:Object.keys(before).length}));
}finally{await fs.rm(temporary,{recursive:true,force:true});}
