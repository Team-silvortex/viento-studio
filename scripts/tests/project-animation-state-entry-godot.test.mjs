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
import { godotAssemblyScripts, godotAssemblyDiagnostics } from '../backends/godot4-project.mjs';
import { validateGeneratedExecutionProject } from '../adapters/node-execution-backends.mjs';
import { inspectBackendProject } from '../adapters/node-backend-project.mjs';
import { planBackendProjectDelivery, verifyBackendProjectDelivery } from '../adapters/node-backend-project-delivery.mjs';
import { writeExportZip } from '../lib/export-package.mjs';
const tool=process.env.VIENTO_GODOT_BIN,real={skip:!tool?'Set VIENTO_GODOT_BIN for real animation state entries':false,timeout:120000};
const xdg=await fs.mkdtemp(path.join(os.tmpdir(),'viento-state-entry-xdg-'));
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


const entries = result => result.record.events.filter(row => row.event === 'animation-state-entered');
test('state entry wrappers are shared per source and keep author source maps unchanged', async t => {
  const duplicate='71717171-7171-4171-8171-000000000001';
  const f=await fixture(t,{edit:async f=>f.edit('documents/behaviors/demo.json',document=>document.bindings.splice(1,0,{...structuredClone(document.bindings[0]),bindingId:duplicate}))});
  const manifest=JSON.parse(f.generated.files.get('assembly.json'));
  assert.equal(manifest.schemaVersion,11);assert.equal(f.generated.backend.protocolVersion,10);
  assert.deepEqual(manifest.animationStateWrappers,[{scriptObjectId:f.scriptId,path:`animation-state-wrappers/${f.scriptId}.gd`}]);
  assert.equal(manifest.scenes[0].animationStateControllers.length,2);
  assert.equal(f.generated.files.get(`behaviors/${f.scriptId}.gd`).toString(),f.content);
  assert.ok(f.generated.files.get(`animation-state-wrappers/${f.scriptId}.gd`).toString().startsWith(`extends "res://behaviors/${f.scriptId}.gd"`));
  assert.deepEqual(f.generated.sourceMap.animationStateWrappers,manifest.animationStateWrappers);
  for(const binding of f.generated.sourceMap.behaviors.filter(row=>row.sourceObjectId===f.scriptId)) assert.equal(binding.generatedPath,`behaviors/${f.scriptId}.gd`);
  const directory=await stage(f),inventory=await godotAssemblyScripts(directory);
  assert.ok(inventory.includes('project-animation-state-entry-runtime.gd'));assert.ok(inventory.includes(`animation-state-wrappers/${f.scriptId}.gd`));
  for(const change of [v=>v.animationStateWrappers[0].path='../escape.gd',v=>v.animationStateWrappers.push(v.animationStateWrappers[0]),v=>v.animationStateWrappers=[],v=>v.scenes[0].animationStateControllers[0].scriptObjectId=f.secondScriptId]){
    const altered=structuredClone(manifest);change(altered);await fs.writeFile(path.join(directory,'assembly.json'),JSON.stringify(altered));await assert.rejects(godotAssemblyScripts(directory),{errorCode:'build_assembly_invalid'});
  }
  // The prior inventory remains readable with its exact old field set.
  const {animationStateWrappers,...old}=manifest;old.schemaVersion=9;old.scenes=old.scenes.map(scene=>({...scene,animationStateControllers:scene.animationStateControllers.map(({scriptObjectId,...controller})=>controller)}));
  await fs.writeFile(path.join(directory,'assembly.json'),JSON.stringify(old));const legacy=await godotAssemblyScripts(directory);assert.ok(!legacy.includes('project-animation-state-entry-runtime.gd'));assert.ok(!legacy.some(file=>file.startsWith('animation-state-wrappers/')));
});

test('only protocol9/10 generated outputs get the bounded 1024 file allowance',async t=>{
  const f=await fixture(t),files=new Map(f.generated.files);while(files.size<1024)files.set(`extra/${files.size}.txt`,Buffer.from('fixture'));
  assert.equal(validateGeneratedExecutionProject(adapter,f.captured.plan,{...f.generated,files}).files.size,1024);
  files.set('extra/overflow.txt',Buffer.from('fixture'));assert.throws(()=>validateGeneratedExecutionProject(adapter,f.captured.plan,{...f.generated,files}));
  files.delete('extra/overflow.txt');const old={...adapter,descriptor:{...adapter.descriptor,plans:adapter.descriptor.plans.map(plan=>plan.kind==='project'?{...plan,runtimeProtocolVersion:8}:plan)}};
  assert.throws(()=>validateGeneratedExecutionProject(old,f.captured.plan,{...f.generated,files,backend:{...f.generated.backend,protocolVersion:8}}));
});

test('real entries preserve initial entry and repeated same-frame self and cross-state requests',real,async t=>{
  const f=await build(t,{body:'\treceiver._enter_state(1)\n\treceiver._enter_state(0)\n\treceiver._enter_state(0)\n\thost.flush_requests()',parameters:f=>({clip_idle:f.clipIds[0][0],clip_action:f.clipIds[0][0]})}),result=await run(f);passed(result);
  assert.deepEqual(entries(result).map(row=>[row.sequence,row.stateIndex,row.timeSeconds,row.commandSequence]),[[1,0,0,0],[2,1,0,2],[3,0,0,2],[4,0,0,2]]);
  assert.equal(result.record.runtime.project.animationStateEntries.entries.length,4);
  assert.equal(result.record.events[0].animationStateEntrySequence,0);assert.equal(result.record.events.at(-1).animationStateEntrySequence,4);
  assert.equal(rows(result)[0].controllers[0].stateIndex,0);assert.equal(rows(result)[0].commandSequence,8);
});

test('real independently bound wrappers retain distinct instance origins for one shared source',real,async t=>{
  const duplicate='71717171-7171-4171-8171-000000000001';
  const f=await build(t,{body:'\treceiver._enter_state(1)\n\thost.flush_requests()\n\tassert(not p.has_method("record_animation_state_entry"))',edit:async f=>f.edit('documents/behaviors/demo.json',document=>document.bindings.splice(1,0,{...structuredClone(document.bindings[0]),bindingId:duplicate}))}),result=await run(f);passed(result);
  assert.deepEqual(entries(result).map(row=>[row.bindingId,row.stateIndex]),[[f.bindingId,0],[duplicate,0],[f.bindingId,1]]);
  assert.equal(new Set(result.record.runtime.project.animationStateEntries.entries.map(row=>row.scriptSource.objectId)).size,1);
});

test('real accepted select followed by rejected play has no successful state-entry record',real,async t=>{
  const f=await build(t,{body:'\thost.animation_control.reserved_count=255\n\treceiver._enter_state(1)'}),result=await run(f);
  assert.equal(result.ok,false);assert.ok(result.record,JSON.stringify(result));assert.ok(result.record.diagnostics.some(row=>row.code==='runtime_behavior_animation_limit'));
  assert.deepEqual(entries(result).map(row=>row.stateIndex),[0]);assert.equal(rows(result)[0].reason,'aborted');assert.equal(rows(result)[0].controllers[0].status,'inactive');
});

test('real accepted state survives in trace when a queued command fails before its playback executes',real,async t=>{
  const f=await build(t,{body:'\tp.seek_animation(0.9)\n\treceiver._enter_state(1)\n\thost.flush_requests()'}),result=await run(f);
  assert.equal(result.ok,false);assert.ok(result.record,JSON.stringify(result));assert.ok(result.record.diagnostics.some(row=>row.code==='runtime_behavior_animation_command'));
  assert.deepEqual(entries(result).map(row=>[row.stateIndex,row.commandSequence]),[[0,0],[1,2]]);
  assert.equal(result.record.runtime.project.animationCommands.sequence,2);assert.equal(rows(result)[0].controllers[0].stateIndex,1);
});

for(const variant of ['v2','v3'])test(`real ${variant} entries capture conditional event selection and natural completion`,real,async t=>{
  const table=structuredClone(DEFAULT_ANIMATION_STATE_TABLE);table.transitions[0].trigger.condition={type:'boolean',operator:'eq',value:true};
  if(variant==='v3'){table.eventSelection='firstMatch';table.transitions.splice(1,0,{from:'idle',to:'idle',trigger:{kind:'event',name:'action'}});}
  const f=await build(t,{table,body:'\tp.publish_event("action",false)\n\thost.flush_requests()\n\tp.publish_event("action",true)\n\thost.flush_requests()\n\thost.elapsed_seconds+=0.5\n\thost.total_seconds+=0.5\n\thost.current.project_step(0.5)\n\thost.flush_requests()'}),result=await run(f);passed(result);
  assert.deepEqual(entries(result).map(row=>row.stateIndex),variant==='v3'?[0,0,1,0]:[0,1,0]);
  assert.equal(entries(result).at(-1).timeSeconds,.5);assert.equal(result.record.events.filter(row=>row.event==='animation-completed').length,1);
});

test('real repeated observation-port calls cannot fabricate another successful entry',real,async t=>{
  const f=await build(t,{body:'\treceiver.get_meta("viento_project").record_animation_state_entry()'}),result=await run(f);
  assert.equal(result.ok,false);assert.ok(result.record,JSON.stringify(result));assert.ok(result.record.diagnostics.some(row=>row.code==='runtime_behavior_animation_state_entry_invalid'));
  assert.deepEqual(entries(result).map(row=>row.stateIndex),[0]);assert.equal(rows(result)[0].reason,'aborted');
});

test('wrapper diagnostics belong to generated assembly and never borrow author source lines',async t=>{
  const f=await fixture(t);const diagnostics=godotAssemblyDiagnostics({status:'succeeded',stdout:'',stderr:`SCRIPT ERROR: Parse Error: wrapper failure\n  at: res://animation-state-wrappers/${f.scriptId}.gd:8\n  at: res://behaviors/${f.scriptId}.gd:79`},f.captured.plan);
  assert.ok(diagnostics.length);for(const diagnostic of diagnostics){assert.equal(diagnostic.sourcePath,f.captured.plan.assembly.sourcePath);assert.equal(diagnostic.sourceLine,undefined);assert.equal(diagnostic.sourceRange,undefined);}
});
