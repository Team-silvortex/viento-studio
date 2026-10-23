import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import yauzl from 'yauzl';
import { DEFAULT_EDITABLE_GODOT_ANIMATION_STATE_SCRIPT, generateEditableGodotAnimationStateScript, readAnimationStateScriptSource } from '../../engine/animation-state-script-source.mjs';
import { projectAnimationClipsAuthor } from './helpers/project-animation-clips-author-fixture.mjs';
import { buildProject, runProjectBuild } from '../adapters/node-project-build.mjs';
import { GODOT4_EXECUTION_ADAPTER as adapter } from '../backends/godot4-adapter.mjs';
import { inspectBackendProject } from '../adapters/node-backend-project.mjs';
import { planBackendProjectDelivery, verifyBackendProjectDelivery } from '../adapters/node-backend-project-delivery.mjs';
import { writeExportZip } from '../lib/export-package.mjs';
const tool=process.env.VIENTO_GODOT_BIN;
const real={skip:!tool?'Set VIENTO_GODOT_BIN for reopened source and portable ZIP execution':false,timeout:120000};

test('real saved BOM/CRLF source reopens, edits its event, and retains its exact declaration in an independently runnable ZIP',real,async t=>{
  const f=await projectAnimationClipsAuthor(t);
  const keys=['XDG_CACHE_HOME','XDG_CONFIG_HOME','XDG_DATA_HOME'],previous=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
  for(const [index,key] of keys.entries()){process.env[key]=path.join(f.temporary,'xdg-'+index);await fs.mkdir(process.env[key]);}
  t.after(()=>{for(const key of keys){if(previous[key]===undefined)delete process.env[key];else process.env[key]=previous[key];}});
  const original='\uFEFF'+DEFAULT_EDITABLE_GODOT_ANIMATION_STATE_SCRIPT.replaceAll('\n','\r\n');
  await f.script('checkpoint',original);
  const saved=await fs.readFile(path.join(f.author,'documents/scripts/checkpoint.txt'),'utf8');
  const reopened=readAnimationStateScriptSource(saved),table=structuredClone(reopened.table);
  table.transitions[0].trigger.name='combat.attack';
  const generated=generateEditableGodotAnimationStateScript(table);
  const updated=reopened.bom+generated.content.replaceAll('\n',reopened.newline);
  assert.equal(readAnimationStateScriptSource(updated).table.transitions[0].trigger.name,'combat.attack');
  await f.script('checkpoint',updated);
  await f.edit('documents/behaviors/demo.json',manifest=>{
    manifest.bindings[0].parameters={clip_idle:f.clipIds[0][0],clip_action:f.clipIds[0][1]};
    manifest.bindings.push({...structuredClone(manifest.bindings[0]),bindingId:f.secondBindingId,
      implementation:{...manifest.bindings[0].implementation,sourceObjectId:f.secondScriptId},parameters:{}});
  });
  await f.edit('metadata/documents/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee.json',metadata=>metadata.relations.push({kind:'reference',targetId:f.secondScriptId,slot:'implementation'}));
  await f.script('second',`extends Node
func _ready() -> void:
\tcall_deferred("_probe")
func _probe() -> void:
\tvar p=get_meta("viento_project")
\tvar host=get_tree().root.get_node("VientoProject")
\thost.set_process(false)
\thost.flush_requests()
\tp.publish_event("action",false)
\tp.publish_event("combat.attack",true)
\thost.flush_requests()
\thost.elapsed_seconds+=0.5
\thost.total_seconds+=0.5
\thost.current.project_step(0.5)
\thost.flush_requests()
\thost.finish_project()
`);
  const output=path.join(f.temporary,'source-build');
  const built=await buildProject({root:f.author,targetId:f.assemblyId,tool,output});
  assert.equal(built.ok,true,JSON.stringify(built.diagnostics||built.record?.diagnostics));
  const result=await runProjectBuild({buildDirectory:output,tool,headless:true,smoke:false});
  assert.equal(result.ok,true,JSON.stringify(result.record?.diagnostics));
  const verifyEvents=events=>{
    assert.equal(events[0].protocol,9);
    assert.deepEqual(events.filter(row=>row.event==='event-publish').map(row=>[row.name,row.recipients.length]),[['action',0],['combat.attack',1]]);
    const commands=events.filter(row=>row.event==='animation-command');
    assert.deepEqual(commands.filter(row=>row.command.action==='select').map(row=>row.command.clipId),[f.clipIds[0][0],f.clipIds[0][1],f.clipIds[0][0]]);
    assert.ok(commands.every(row=>row.bindingId===f.bindingId));
    assert.equal(events.filter(row=>row.event==='animation-completed').length,1);
  };
  verifyEvents(result.record.events);
  const inspect=()=>inspectBackendProject({buildDirectory:output});
  const delivery=await planBackendProjectDelivery({inspection:await inspect(),assertCurrent:inspect});
  const zip=path.join(f.temporary,'editable-controller.zip');await writeExportZip(delivery,zip);assert.ok((await verifyBackendProjectDelivery(zip)).fileCount>0);
  const moved=path.join(f.temporary,'moved'),archive=await yauzl.openPromise(zip,{lazyEntries:true,autoClose:false});
  try{for await(const entry of archive.eachEntry()){const chunks=[];for await(const chunk of await archive.openReadStreamPromise(entry))chunks.push(chunk);const file=path.join(moved,entry.fileName);await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,Buffer.concat(chunks));}}
  finally{await new Promise(resolve=>{archive.reader.once('close',resolve);archive.close();});}
  const snapshot=JSON.parse(await fs.readFile(path.join(output,'snapshot.json')));
  await fs.rm(f.author,{recursive:true});await fs.rm(output,{recursive:true});
  const directory=path.join(moved,'project'),retained=await fs.readFile(path.join(directory,'behaviors',f.scriptId+'.gd'),'utf8');
  assert.equal(retained,updated);assert.deepEqual(readAnimationStateScriptSource(retained),readAnimationStateScriptSource(updated));
  const identified=await adapter.identify(tool);
  for(const phase of [...adapter.buildPhases,'run']){
    const execution=await adapter.executePhase({phase,directory,tool:identified,smoke:false,timeoutMs:60000});
    assert.equal(execution.status,'succeeded',execution.stdout+execution.stderr);
    assert.deepEqual(adapter.diagnostics(execution,snapshot.plan),[],execution.stdout+execution.stderr);
    if(phase==='run'){const reader=adapter.createEventReader(snapshot.plan);reader.push(execution.stdout);assert.deepEqual(reader.finish().diagnostics,[],execution.stdout+execution.stderr);verifyEvents(reader.events);}
  }
});
