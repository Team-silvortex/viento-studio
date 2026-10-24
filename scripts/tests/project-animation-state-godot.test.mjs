import '../adapters/node-studio-core.mjs';
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import yauzl from 'yauzl';
import { DEFAULT_ANIMATION_STATE_TABLE } from '../../engine/godot-animation-state-script.mjs';
import { generateEditableGodotAnimationStateScript } from '../../engine/animation-state-script-source.mjs';
import { createProjectAnimationStateCatalog } from '../../engine/project-animation-states.mjs';
import { projectAnimationClipsAuthor } from './helpers/project-animation-clips-author-fixture.mjs';
import { captureBuildSnapshot } from '../adapters/node-build-snapshot.mjs';
import { buildProject, runProjectBuild } from '../adapters/node-project-build.mjs';
import { GODOT4_EXECUTION_ADAPTER as adapter } from '../backends/godot4-adapter.mjs';
import { godotAssemblyScripts } from '../backends/godot4-project.mjs';
import { validateGeneratedExecutionProject } from '../adapters/node-execution-backends.mjs';
import { inspectBackendProject } from '../adapters/node-backend-project.mjs';
import { planBackendProjectDelivery, verifyBackendProjectDelivery } from '../adapters/node-backend-project-delivery.mjs';
import { writeExportZip } from '../lib/export-package.mjs';
const tool=process.env.VIENTO_GODOT_BIN,real={skip:!tool?'Set VIENTO_GODOT_BIN for real animation state snapshots':false,timeout:120000};
const xdg=await fs.mkdtemp(path.join(os.tmpdir(),'viento-state-snapshot-xdg-'));
const saved=Object.fromEntries(['XDG_CACHE_HOME','XDG_CONFIG_HOME','XDG_DATA_HOME'].map(key=>[key,process.env[key]]));
for(const[key,name]of [['XDG_CACHE_HOME','cache'],['XDG_CONFIG_HOME','config'],['XDG_DATA_HOME','data']]){process.env[key]=path.join(xdg,name);await fs.mkdir(process.env[key]);}
after(async()=>{for(const[key,value]of Object.entries(saved)){if(value===undefined)delete process.env[key];else process.env[key]=value;}await fs.rm(xdg,{recursive:true,force:true});});
const probe=(f,body)=>`extends Node
func _ready() -> void:
\tcall_deferred("_probe")
func _probe() -> void:
\tvar host=get_tree().root.get_node("VientoProject")
\thost.set_process(false)
\thost.flush_requests()
\tvar receiver=get_parent().get_node("behavior_${f.bindingId.replaceAll('-','_')}")
\tvar p=get_meta("viento_project")
${body}
\thost.finish_project()
`;
async function fixture(t,{table=DEFAULT_ANIMATION_STATE_TABLE,body='',bom=false,parameters,edit,modified=false}={}){
  const f=await projectAnimationClipsAuthor(t);let content=generateEditableGodotAnimationStateScript(table).content;
  if(bom)content='\uFEFF'+content.replaceAll('\n','\r\n');if(modified)content+='\n# manual modification\n';
  await f.script('checkpoint',content);
  await f.edit('documents/behaviors/demo.json',document=>{
    document.bindings[0].parameters=parameters?parameters(f):Object.fromEntries(table.states.map(state=>['clip_'+state.key,f.clipIds[0][state.key==='action'?1:0]]));
    document.bindings.push({...structuredClone(document.bindings[0]),bindingId:f.secondBindingId,implementation:{...document.bindings[0].implementation,sourceObjectId:f.secondScriptId},parameters:{}});
  });
  await f.edit('metadata/documents/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee.json',document=>document.relations.push({kind:'reference',targetId:f.secondScriptId,slot:'implementation'}));
  await f.script('second',probe(f,typeof body==='function'?body(f):body));if(edit)await edit(f);
  const captured=await captureBuildSnapshot(f.author,f.assemblyId);assert.equal(captured.ok,true,JSON.stringify(captured.diagnostics));
  const generated=validateGeneratedExecutionProject(adapter,captured.plan,await adapter.generate(captured.plan));
  return {...f,captured,generated,content,output:path.join(f.temporary,'state-build')};
}
async function build(t,options){const f=await fixture(t,options),built=await buildProject({root:f.author,targetId:f.assemblyId,tool,output:f.output});assert.equal(built.ok,true,JSON.stringify(built.diagnostics||built.record?.diagnostics));return f;}
const run=f=>runProjectBuild({buildDirectory:f.output,tool,headless:true,smoke:false});
const passed=result=>assert.equal(result.ok,true,JSON.stringify(result.record?.diagnostics||result));
const rows=result=>result.record.events.filter(row=>row.event==='animation-state-snapshot');
const states=result=>result.record.runtime.project.animationStates.entries;
async function stage(f){const directory=path.join(f.temporary,'generated');for(const[name,bytes]of f.generated.files){const file=path.join(directory,name);await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,bytes);}return directory;}

test('only exact frozen state scripts select protocol10; manually edited scripts retain protocol7',async t=>{
  for(const modified of [false,true]){
    const f=await fixture(t,{modified}),inventory=JSON.parse(f.generated.files.get('assembly.json'));
    assert.equal(f.generated.backend.protocolVersion,modified?7:10);assert.equal(f.generated.backend.version,modified?'0.16.0':'0.19.0');assert.equal(inventory.schemaVersion,modified?8:11);
    assert.equal(f.generated.files.has('project-animation-state-runtime.gd'),!modified);
    assert.equal(f.generated.files.get(`behaviors/${f.scriptId}.gd`).toString(),f.content);
    if(!modified){const limited={...adapter,descriptor:{...adapter.descriptor,capabilities:adapter.descriptor.capabilities.filter(capability=>capability!=='project.animation-state-snapshots')}};assert.throws(()=>validateGeneratedExecutionProject(limited,f.captured.plan,f.generated));const expected=createProjectAnimationStateCatalog(f.captured.plan);assert.deepEqual(inventory.scenes[0].animationStateControllers,expected.scenes[0].controllers.map(({bindingId,instanceId,objectId,scriptObjectId,states,clips})=>({bindingId,instanceId,objectId,scriptObjectId,states,clips})));assert.deepEqual(inventory.scenes[1].animationStateControllers,[]);}
    const directory=await stage(f);assert.deepEqual((await godotAssemblyScripts(directory)).sort(),[...f.generated.files.keys()].filter(file=>file.endsWith('.gd')).sort());
    for(const protocolVersion of modified?[4,5,6,8,9,10]:[4,5,6,7,8,9])assert.throws(()=>validateGeneratedExecutionProject(adapter,f.captured.plan,{...f.generated,backend:{...f.generated.backend,protocolVersion}}));
  }
});

test('schema11 inventory rejects forged controller fields, duplicate bindings, clip mappings and missing runtime files',async t=>{
  const f=await fixture(t),directory=await stage(f),file=path.join(directory,'assembly.json'),original=JSON.parse(await fs.readFile(file));
  const changes=[value=>value.scenes[0].animationStateControllers[0].path='../x.gd',value=>value.scenes[0].animationStateControllers.push(value.scenes[0].animationStateControllers[0]),value=>value.scenes[0].animationStateControllers[0].clips.pop(),value=>value.scenes[0].animationStateControllers[0].states[0]='../x',value=>value.scenes.forEach(scene=>scene.animationStateControllers=[]),value=>value.scenes[0].animationStateControllers[0].clipId=null];
  for(const change of changes){const changed=structuredClone(original);change(changed);await fs.writeFile(file,JSON.stringify(changed));await assert.rejects(godotAssemblyScripts(directory),{errorCode:'build_assembly_invalid'});}
  await fs.writeFile(file,JSON.stringify(original));await fs.rm(path.join(directory,'project-animation-state-runtime.gd'));await assert.rejects(godotAssemblyScripts(directory));
});

test('real snapshots distinguish two states selecting the same clip and retain frozen source navigation',real,async t=>{
  const f=await build(t,{body:'\tp.publish_event("action",true)\n\thost.flush_requests()',parameters:f=>({clip_idle:f.clipIds[0][0],clip_action:f.clipIds[0][0]})}),result=await run(f);passed(result);
  assert.equal(rows(result).length,1);assert.equal(rows(result)[0].controllers[0].stateIndex,1);assert.equal(rows(result)[0].controllers[0].clipId,f.clipIds[0][0]);assert.equal(rows(result)[0].commandSequence,4);
  assert.equal(states(result)[0].controllers[0].stateKey,'action');assert.equal(states(result)[0].controllers[0].scriptSource.sourcePath,'documents/scripts/checkpoint.txt');assert.equal(result.record.events[0].animationStateSequence,0);assert.equal(result.record.events.at(-1).animationStateSequence,1);
  const exit=result.record.events.findIndex(row=>row.event==='scene-exit');assert.ok(result.record.events.findIndex(row=>row.event==='animation-state-snapshot')<exit);
});

test('real two bindings of one script retain separate state snapshots in frozen binding order',real,async t=>{
  const duplicate='71717171-7171-4171-8171-000000000001';
  const f=await build(t,{body:'\treceiver._enter_state(1)\n\thost.flush_requests()',edit:async f=>f.edit('documents/behaviors/demo.json',document=>document.bindings.splice(1,0,{...structuredClone(document.bindings[0]),bindingId:duplicate}))}),result=await run(f);passed(result);
  assert.deepEqual(rows(result)[0].controllers.map(row=>[row.bindingId,row.stateIndex]),[[f.bindingId,1],[duplicate,0]]);assert.deepEqual(states(result)[0].controllers.map(row=>row.stateKey),['action','idle']);
});

test('real event conditions and ordered branches are sampled from actual state rather than guessed from commands',real,async t=>{
  const table={...structuredClone(DEFAULT_ANIMATION_STATE_TABLE),eventSelection:'firstMatch'};table.transitions.unshift({from:'idle',to:'idle',trigger:{kind:'event',name:'action',condition:{type:'number',operator:'lt',value:0}}});
  const f=await build(t,{table,body:'\tp.publish_event("action",-1)\n\thost.flush_requests()\n\tp.publish_event("action",1)\n\thost.flush_requests()'}),result=await run(f);passed(result);assert.equal(states(result)[0].controllers[0].stateKey,'action');assert.equal(rows(result)[0].commandSequence,6);
});

for(const unavailable of [false,true])test(`real ${unavailable?'freed':'deactivated'} controller is explicit rather than fabricated as an active state`,real,async t=>{
  const f=await build(t,{body:unavailable?'\treceiver.free()':'\treceiver._deactivate()'}),result=await run(f);passed(result);
  assert.deepEqual(rows(result)[0].controllers.map(row=>[row.status,row.stateIndex,row.clipId]),[[unavailable?'unavailable':'inactive',unavailable?null:-1,null]]);assert.equal(states(result)[0].controllers[0].stateKey,null);
});

test('real diagnostic abort samples the controller before cleanup and does not fabricate a finished frame',real,async t=>{
  // Author bindings are valid; corrupt the resolved runtime clip to retain late fail-stop coverage.
  const f=await build(t,{body:'\treceiver._clips[1] = "71717171-7171-4171-8171-000000000099"\n\tp.publish_event("action",true)\n\thost.flush_requests()'}),result=await run(f);
  assert.equal(result.ok,false);assert.ok(result.record.diagnostics.some(row=>row.code==='runtime_behavior_animation_clip'));assert.equal(rows(result).length,1);assert.equal(rows(result)[0].reason,'aborted');assert.equal(rows(result)[0].controllers[0].status,'inactive');assert.equal(result.record.events.some(row=>row.event==='finished'),false);
});

test('real scene reentry uses a new visit and does not reuse previous weak controller state',real,async t=>{
  const f=await build(t,{edit:async f=>{
    await f.script('second',`extends Node
func _ready() -> void:
\tcall_deferred("_probe")
func _probe() -> void:
\tvar host=get_tree().root.get_node("VientoProject")
\thost.set_process(false)
\tvar p=get_meta("viento_project")
\tif host.visit_index==1:
\t\tp.publish_event("action",true)
\t\tp.request_scene("${f.sceneIds[1]}")
\telif host.visit_index==2:
\t\tp.request_scene("${f.sceneIds[0]}")
\telse:
\t\thost.finish_project()
\thost.flush_requests()
`);
  }}),result=await run(f);passed(result);
  assert.deepEqual(rows(result).map(row=>[row.sequence,row.visitIndex,row.reason,row.controllers[0].stateIndex]),[[1,1,'switch',1],[2,3,'finished',0]]);
  assert.equal(result.record.events.filter(row=>row.event==='scene-enter').length,3);
});

test('real BOM/CRLF state controller and snapshot layer survive ZIP delivery after deleting author and build trees',real,async t=>{
  const f=await build(t,{bom:true,body:'\tp.publish_event("action",true)\n\thost.flush_requests()'}),first=await run(f);passed(first);
  const inspect=()=>inspectBackendProject({buildDirectory:f.output}),delivery=await planBackendProjectDelivery({inspection:await inspect(),assertCurrent:inspect});
  const zip=path.join(f.temporary,'snapshot-project.zip');await writeExportZip(delivery,zip);assert.ok((await verifyBackendProjectDelivery(zip)).fileCount>0);
  const moved=path.join(f.temporary,'moved'),archive=await yauzl.openPromise(zip,{lazyEntries:true,autoClose:false});
  try{for await(const entry of archive.eachEntry()){const chunks=[];for await(const chunk of await archive.openReadStreamPromise(entry))chunks.push(chunk);const file=path.join(moved,entry.fileName);await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,Buffer.concat(chunks));}}finally{await new Promise(resolve=>{archive.reader.once('close',resolve);archive.close();});}
  const snapshot=JSON.parse(await fs.readFile(path.join(f.output,'snapshot.json')));await fs.rm(f.author,{recursive:true});await fs.rm(f.output,{recursive:true});
  const directory=path.join(moved,'project');assert.equal(await fs.readFile(path.join(directory,'behaviors',f.scriptId+'.gd'),'utf8'),f.content);assert.ok((await godotAssemblyScripts(directory)).includes('project-animation-state-runtime.gd'));
  const identified=await adapter.identify(tool);for(const phase of [...adapter.buildPhases,'run']){const execution=await adapter.executePhase({phase,directory,tool:identified,smoke:false,timeoutMs:60000});assert.equal(execution.status,'succeeded',execution.stdout+execution.stderr);assert.deepEqual(adapter.diagnostics(execution,snapshot.plan),[],execution.stdout+execution.stderr);if(phase==='run'){const reader=adapter.createEventReader(snapshot.plan);reader.push(execution.stdout);assert.deepEqual(reader.finish().diagnostics,[],execution.stdout+execution.stderr);const trace=reader.events.filter(row=>row.event==='animation-state-snapshot');assert.equal(trace.length,1);assert.equal(trace[0].controllers[0].stateIndex,1);assert.equal(reader.events.at(-1).animationStateSequence,1);}}
});

test('real v2 conditional script returns to idle on completion before its terminal snapshot',real,async t=>{
  const table=structuredClone(DEFAULT_ANIMATION_STATE_TABLE);table.transitions[0].trigger.condition={type:'boolean',operator:'eq',value:true};
  const f=await build(t,{table,body:'\tp.publish_event("action",false)\n\thost.flush_requests()\n\tp.publish_event("action",true)\n\thost.flush_requests()\n\thost.elapsed_seconds+=0.5\n\thost.total_seconds+=0.5\n\thost.current.project_step(0.5)\n\thost.flush_requests()'}),result=await run(f);passed(result);
  assert.equal(states(result)[0].controllers[0].stateKey,'idle');assert.equal(rows(result)[0].timeSeconds,.5);assert.equal(result.record.events.filter(row=>row.event==='animation-completed').length,1);
});

test('real abort before controller creation reports unavailable while preserving the primary diagnostic',real,async t=>{
  const f=await build(t,{edit:async f=>f.edit('documents/behaviors/demo.json',document=>{const publisher=document.bindings.pop();publisher.parameters={missing_export:1};document.bindings.unshift(publisher);})}),result=await run(f);
  assert.equal(result.ok,false);assert.ok(result.record.diagnostics.some(row=>row.code==='runtime_behavior_parameter'));assert.equal(rows(result).length,1);assert.equal(rows(result)[0].reason,'aborted');assert.equal(rows(result)[0].controllers[0].status,'unavailable');
});

test('real malformed private state fails explicitly and cannot masquerade as unavailable or a normal finish',real,async t=>{
  const f=await build(t,{body:'\treceiver._state=99'}),result=await run(f);
  assert.equal(result.ok,false);assert.equal(result.record.phases.at(-1).exitCode,1);assert.ok(result.record.diagnostics.some(row=>row.code==='runtime_behavior_animation_state_invalid'),JSON.stringify(result.record));assert.equal(rows(result).length,0);assert.equal(result.record.events.some(row=>row.event==='finished'),false);
});


test('maximum schema11 controller inventory fits its bounded budget while old inventories keep their original limit',async t=>{
  const f=await fixture(t),directory=await stage(f),original=JSON.parse(f.generated.files.get('assembly.json'));
  const id=number=>'73737373-7373-4737-8737-'+String(number).padStart(12,'0');
  const states=Array.from({length:16},(_,index)=>'state_'+String(index).padStart(26,'0'));
  const sceneIds=Array.from({length:32},(_,index)=>id(index+1));
  const inventory={...original,entrySceneId:sceneIds[0],scenes:sceneIds.map((sceneId,index)=>({sceneId,entry:`scenes/${sceneId}/main.tscn`,runtimeScripts:['runtime.gd','animation-runtime.gd','project-scene.gd'].map(name=>`scenes/${sceneId}/${name}`),animationStateControllers:Array.from({length:32},(_,binding)=>({bindingId:id(1000+index*32+binding),instanceId:id(2000+binding),objectId:id(3000+binding),scriptObjectId:f.scriptId,states,clips:states.map((_,clip)=>id(4000+clip))}))}))};
  const bytes=Buffer.from(JSON.stringify(inventory,null,2));assert.ok(bytes.length>1024*1024&&bytes.length<4*1024*1024,String(bytes.length));
  for(const scene of inventory.scenes)for(const file of scene.runtimeScripts){const destination=path.join(directory,file);await fs.mkdir(path.dirname(destination),{recursive:true});await fs.writeFile(destination,'extends Node\n');}
  const file=path.join(directory,'assembly.json');await fs.writeFile(file,bytes);assert.ok((await godotAssemblyScripts(directory)).length>96);
  const {animationStateWrappers,...old}=original;
  const legacy={...old,schemaVersion:8,scenes:original.scenes.map(({animationStateControllers,...scene})=>scene)};
  await fs.writeFile(file,JSON.stringify(legacy)+' '.repeat(128*1024));await assert.rejects(godotAssemblyScripts(directory),{errorCode:'build_assembly_invalid'});
});
