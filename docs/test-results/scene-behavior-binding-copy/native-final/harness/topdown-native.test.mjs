import 'file:///home/chiharukiryu/cdev/viento-studio/scripts/adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import yauzl from 'file:///home/chiharukiryu/cdev/viento-studio/node_modules/yauzl/index.js';
import {buildProject} from 'file:///home/chiharukiryu/cdev/viento-studio/scripts/adapters/node-project-build.mjs';
import {GODOT4_EXECUTION_ADAPTER as adapter} from 'file:///home/chiharukiryu/cdev/viento-studio/scripts/backends/godot4-adapter.mjs';
import {runBuildProcess} from 'file:///home/chiharukiryu/cdev/viento-studio/scripts/lib/build-process.mjs';
import {inspectBackendProject} from 'file:///home/chiharukiryu/cdev/viento-studio/scripts/adapters/node-backend-project.mjs';
import {planBackendProjectDelivery,verifyBackendProjectDelivery} from 'file:///home/chiharukiryu/cdev/viento-studio/scripts/adapters/node-backend-project-delivery.mjs';
import {writeExportZip} from 'file:///home/chiharukiryu/cdev/viento-studio/scripts/lib/export-package.mjs';
const sample=process.env.VIENTO_TOPDOWN_SOURCE||fileURLToPath(new URL('../../examples/topdown-collect/',import.meta.url));
const helpers=process.env.VIENTO_TOPDOWN_HELPERS||fileURLToPath(new URL('./helpers/',import.meta.url));
const executable=process.env.VIENTO_GODOT_BIN;
const real={skip:!executable||!process.env.VIENTO_XVFB_TEST?'Set VIENTO_GODOT_BIN and VIENTO_XVFB_TEST under isolated Xvfb for actual game keyboard tests':false,timeout:240000};
const ident=n=>`c011ec70-2026-4113-8113-${String(n).padStart(12,'0')}`;
const hash=x=>createHash('sha256').update(x).digest('hex');
async function inventory(root){const files=(await fs.readdir(root,{recursive:true,withFileTypes:true})).filter(x=>x.isFile());return Object.fromEntries(await Promise.all(files.map(async x=>{const p=path.join(x.parentPath||x.path,x.name);return[path.relative(root,p),hash(await fs.readFile(p))];})));}
async function prepare(t){const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'viento-topdown-native-'));t.after(()=>fs.rm(temporary,{recursive:true,force:true}));const author=path.join(temporary,'author');await fs.cp(sample,author,{recursive:true});const before=await inventory(author),output=path.join(temporary,'build');const result=await buildProject({root:author,targetId:ident(100),tool:executable,output,timeoutMs:90000});assert.equal(result.ok,true,JSON.stringify(result));const snapshot=JSON.parse(await fs.readFile(path.join(output,'snapshot.json')));const generated=await adapter.generate(snapshot.plan);return{temporary,author,before,output,plan:snapshot.plan,generated,directory:path.join(output,'project'),tool:await adapter.identify(executable)};}
function succeeded(result){assert.equal(result.status,'succeeded',result.stdout+result.stderr);assert.doesNotMatch(result.stdout+result.stderr,/(?:SCRIPT ERROR:|ERROR:|TOPDOWN_OBSERVER_ERROR:)/);}
async function keyboard(f,output){await fs.mkdir(output,{recursive:true});for(const phase of adapter.buildPhases)succeeded(await adapter.executePhase({phase,directory:f.directory,tool:f.tool,timeoutMs:90000}));
 const observer=await fs.readFile(path.join(helpers,'topdown-observer.gd'),'utf8');
 await fs.writeFile(path.join(f.directory,'topdown-observer.gd'),observer);
 await fs.writeFile(path.join(f.directory,'topdown-observer.tscn'),`[gd_scene load_steps=2 format=3]\n\n[ext_resource type="Script" path="res://topdown-observer.gd" id="1"]\n\n[node name="VientoProject" type="Node2D"]\nscript = ExtResource("1")\nsample_directory = ${JSON.stringify(path.join(output,'frames'))}\n`);
 let result;try{result=await runBuildProcess('python3',[path.join(helpers,'topdown-keyboard.py'),executable,f.directory,output],{cwd:f.directory,env:{...process.env,LIBGL_ALWAYS_SOFTWARE:'1',XDG_DATA_HOME:path.join(f.temporary,'xdg/data'),XDG_CONFIG_HOME:path.join(f.temporary,'xdg/config'),XDG_CACHE_HOME:path.join(f.temporary,'xdg/cache')},timeoutMs:120000});succeeded(result);}finally{for(const name of ['topdown-observer.gd','topdown-observer.gd.uid','topdown-observer.tscn'])await fs.rm(path.join(f.directory,name),{force:true});}
 const data=JSON.parse(await fs.readFile(path.join(output,'keyboard.json'))),stdout=await fs.readFile(path.join(output,'window-output.log'),'utf8');
 const reader=adapter.createEventReader(f.plan,{capabilities:f.generated.backend.capabilities});reader.push(stdout);const received=reader.finish();assert.deepEqual(received.diagnostics,[],JSON.stringify(received.diagnostics));
 const visits=received.events.filter(x=>x.event==='scene-enter');assert.deepEqual(visits.map(x=>x.sceneId),[30,31,32,31,33,31].map(ident));assert.deepEqual(visits.map(x=>x.visitIndex),[1,2,3,4,5,6]);assert.equal(received.events.at(-1).event,'finished');
 const published=received.events.filter(x=>x.event==='event-publish');for(const [name,count]of [['game.collect',3],['game.door_open',1],['game.hazard',3],['game.complete',1],['game.failed',1]])assert.equal(published.filter(x=>x.name===name).length,count,name);
 const first=data.stages.find(x=>x.label==='first-attempt').sample,reset=data.stages.find(x=>x.label==='failure-retry').sample;assert.deepEqual(reset.state,first.state);assert.deepEqual(reset.actors[ident(301)].position,first.actors[ident(301)].position);assert.ok(reset.stateRevision>first.stateRevision);
 assert.ok(data.stages.find(x=>x.label==='all-crystals-door-open').sample.hudTexts.some(x=>x.text==='Score: 3'));assert.ok(reset.hudTexts.some(x=>x.text==='Health: 3'));
 for(const[name,bytes]of f.generated.files)assert.deepEqual(await fs.readFile(path.join(f.directory,name)),bytes,name);
 await fs.writeFile(path.join(output,'protocol.json'),JSON.stringify({tool:f.tool,events:received.events,stages:data.stages,generatedFiles:Object.fromEntries([...f.generated.files].map(([name,b])=>[name,hash(b)]))},null,2)+'\n');return{data,received};}
const evidence=process.env.VIENTO_TOPDOWN_EVIDENCE_DIR;
async function output(f,name){if(!evidence)return path.join(f.temporary,name);const resolved=path.resolve(evidence),topic="/tmp/viento-behavior-copy-native/evidence";assert.ok(resolved.startsWith(topic+path.sep));return path.join(resolved,name);}
test('actual reference game collects once, collides with locked gate, unlocks and wins, then takes real hazard damage and retries',real,async t=>{const original=await inventory(sample),f=await prepare(t);await keyboard(f,await output(f,'keyboard'));assert.deepEqual(await inventory(f.author),f.before);assert.deepEqual(await inventory(sample),original);});
test('delivered game project repeats real keyboard gameplay after original author and generated paths become unavailable',real,async t=>{const original=await inventory(sample),f=await prepare(t),inspect=()=>inspectBackendProject({buildDirectory:f.output});const delivery=await planBackendProjectDelivery({inspection:await inspect(),assertCurrent:inspect}),zip=path.join(f.temporary,'game.viento-build.zip');await writeExportZip(delivery,zip);const verification=await verifyBackendProjectDelivery(zip),restored=path.join(f.temporary,'restored');await fs.mkdir(restored);
 const archive=await yauzl.openPromise(zip,{lazyEntries:true,autoClose:false});try{for await(const entry of archive.eachEntry()){assert.ok(!entry.fileName.startsWith('/')&&!entry.fileName.split('/').includes('..'));const chunks=[];for await(const chunk of await archive.openReadStreamPromise(entry))chunks.push(chunk);const p=path.join(restored,entry.fileName);await fs.mkdir(path.dirname(p),{recursive:true});await fs.writeFile(p,Buffer.concat(chunks));}}finally{await new Promise(resolve=>{archive.reader.once('close',resolve);archive.close();});}
 await fs.rename(f.author,f.author+'.offline');await fs.rename(f.output,f.output+'.offline');await assert.rejects(fs.access(f.author),{code:'ENOENT'});await assert.rejects(fs.access(f.output),{code:'ENOENT'});const dest=await output(f,'offline-keyboard');await keyboard({...f,directory:path.join(restored,'project')},dest);assert.deepEqual(await inventory(f.author+'.offline'),f.before);assert.deepEqual(await inventory(sample),original);
 if(evidence){await fs.copyFile(zip,path.join(evidence,'game.viento-build.zip'));await fs.writeFile(path.join(evidence,'offline-delivery.json'),JSON.stringify({originalPathsUnavailable:true,zip:{bytes:(await fs.stat(zip)).size,sha256:hash(await fs.readFile(zip)),verification},authorBefore:f.before,authorAfter:await inventory(f.author+'.offline')},null,2)+'\n');}
});
