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



test('inventory10 admits 32 scenes and 256 distinct original/wrapper scripts within the fixed 4 MiB budget',async t=>{
  const f=await fixture(t),directory=await stage(f),original=JSON.parse(f.generated.files.get('assembly.json'));
  const id=n=>'73737373-7373-4737-8737-'+String(n).padStart(12,'0');
  const sourceIds=Array.from({length:256},(_,i)=>id(10000+i)),sceneIds=Array.from({length:32},(_,i)=>id(i+1));
  const states=Array.from({length:16},(_,i)=>'state_'+String(i).padStart(26,'0'));
  const inventory={...original,entrySceneId:sceneIds[0],behaviorSources:sourceIds.map(objectId=>({objectId,path:`behaviors/${objectId}.gd`})),animationStateWrappers:sourceIds.map(scriptObjectId=>({scriptObjectId,path:`animation-state-wrappers/${scriptObjectId}.gd`})),scenes:sceneIds.map((sceneId,sceneIndex)=>({sceneId,entry:`scenes/${sceneId}/main.tscn`,runtimeScripts:['runtime.gd','behavior-runtime.gd','audio-runtime.gd','animation-runtime.gd','project-scene.gd'].map(file=>`scenes/${sceneId}/${file}`),animationStateControllers:Array.from({length:32},(_,i)=>({bindingId:id(1000+sceneIndex*32+i),instanceId:id(2000+i),objectId:id(3000+i),scriptObjectId:sourceIds[sceneIndex*8+i%8],states,clips:states.map((_,j)=>id(4000+j))}))}))};
  const bytes=Buffer.from(JSON.stringify(inventory,null,2));assert.ok(bytes.length>1024*1024&&bytes.length<4*1024*1024,String(bytes.length));
  const paths=[...inventory.behaviorSources.map(row=>row.path),...inventory.animationStateWrappers.map(row=>row.path),...inventory.scenes.flatMap(row=>row.runtimeScripts)];
  for(const file of paths){const destination=path.join(directory,file);await fs.mkdir(path.dirname(destination),{recursive:true});await fs.writeFile(destination,'extends Node\n');}
  await fs.writeFile(path.join(directory,'assembly.json'),bytes);
  const scripts=await godotAssemblyScripts(directory);assert.equal(new Set(scripts).size,scripts.length);assert.equal(scripts.length,682);
  for(const file of paths)assert.ok(scripts.includes(file),file);
});
