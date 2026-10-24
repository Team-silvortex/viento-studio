import '../adapters/node-studio-core.mjs';
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import yauzl from 'yauzl';
import { evaluateAnimationStateCondition } from '../../engine/animation-state-conditions-core.mjs';
import { DEFAULT_ANIMATION_STATE_TABLE } from '../../engine/godot-animation-state-script.mjs';
import { DEFAULT_EDITABLE_GODOT_ANIMATION_STATE_SCRIPT, generateEditableGodotAnimationStateScript, readAnimationStateScriptSource } from '../../engine/animation-state-script-source.mjs';
import { projectAnimationClipsAuthor } from './helpers/project-animation-clips-author-fixture.mjs';
import { buildProject, runProjectBuild } from '../adapters/node-project-build.mjs';
import { GODOT4_EXECUTION_ADAPTER as adapter } from '../backends/godot4-adapter.mjs';
import { inspectBackendProject } from '../adapters/node-backend-project.mjs';
import { planBackendProjectDelivery, verifyBackendProjectDelivery } from '../adapters/node-backend-project-delivery.mjs';
import { writeExportZip } from '../lib/export-package.mjs';
const tool=process.env.VIENTO_GODOT_BIN, real={skip:!tool?'Set VIENTO_GODOT_BIN for actual selected state condition checks':false,timeout:120000};
const xdg=await fs.mkdtemp(path.join(os.tmpdir(),'viento-selectors-xdg-'));
const saved=Object.fromEntries(['XDG_CACHE_HOME','XDG_CONFIG_HOME','XDG_DATA_HOME'].map(key=>[key,process.env[key]]));
for(const[key,name]of [['XDG_CACHE_HOME','cache'],['XDG_CONFIG_HOME','config'],['XDG_DATA_HOME','data']]){process.env[key]=path.join(xdg,name);await fs.mkdir(process.env[key]);}
after(async()=>{for(const[key,value]of Object.entries(saved)){if(value===undefined)delete process.env[key];else process.env[key]=value;}await fs.rm(xdg,{recursive:true,force:true});});
const rows=(result,event)=>result.record.events.filter(row=>row.event===event);
const passed=result=>assert.equal(result.ok,true,JSON.stringify(result.record?.diagnostics||result));
const printed=(result,prefix)=>result.record.phases.at(-1).stdout.split('\n').filter(line=>line.startsWith(prefix)).map(line=>JSON.parse(line.slice(prefix.length)));
const selectedTable=condition=>{const table=structuredClone(DEFAULT_ANIMATION_STATE_TABLE);table.transitions[0].trigger.condition={...condition,selector:{kind:'projectState',key:'combat.value'}};return table;};
const bytes=value=>{const buffer=new Uint8Array(8);new DataView(buffer.buffer).setFloat64(0,value,true);return [...buffer];};
const literal=value=>typeof value==='number'?`PackedByteArray(${JSON.stringify(bytes(value))}).decode_double(0)`
  :typeof value==='boolean'?String(value):value.length?`(${[...value].map(character=>`String.chr(${character.codePointAt(0)})`).join('+')})`:'""';
function probe(f,body){return `extends Node
func _ready() -> void:
\tcall_deferred("_probe")
func _step(seconds: float, flush: bool = true) -> void:
\tvar host=get_tree().root.get_node("VientoProject")
\thost.elapsed_seconds+=seconds
\thost.total_seconds+=seconds
\thost.current.project_step(seconds)
\tif flush:
\t\thost.flush_requests()
func _probe() -> void:
\tvar p=get_meta("viento_project")
\tvar host=get_tree().root.get_node("VientoProject")
\thost.set_process(false)
\thost.flush_requests()
\tvar receiver=get_parent().get_node("behavior_${f.bindingId.replaceAll('-','_')}")
${body}
\thost.finish_project()
`;}
async function build(t,table,body,{parameters,bom=false,edit}={}){
  const f=await projectAnimationClipsAuthor(t),source=generateEditableGodotAnimationStateScript(table).content;
  const content=bom?'\uFEFF'+source.replaceAll('\n','\r\n'):source;
  await f.script('checkpoint',content);
  await f.edit('documents/behaviors/demo.json',manifest=>{
    manifest.bindings[0].parameters=parameters?parameters(f):Object.fromEntries(table.states.map(state=>['clip_'+state.key,f.clipIds[0][state.key==='action'?1:0]]));
    manifest.bindings.push({...structuredClone(manifest.bindings[0]),bindingId:f.secondBindingId,implementation:{...manifest.bindings[0].implementation,sourceObjectId:f.secondScriptId},parameters:{}});
  });
  await f.edit('metadata/documents/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee.json',metadata=>metadata.relations.push({kind:'reference',targetId:f.secondScriptId,slot:'implementation'}));
  await f.script('second',probe(f,typeof body==='function'?body(f):body));
  if(edit)await edit(f);
  const output=path.join(f.temporary,'selectors-build'),built=await buildProject({root:f.author,targetId:f.assemblyId,tool,output});
  assert.equal(built.ok,true,JSON.stringify(built.diagnostics||built.record?.diagnostics));
  assert.equal(await fs.readFile(path.join(f.author,'documents/scripts/checkpoint.txt'),'utf8'),content);
  assert.equal(adapter.descriptor.version,'0.19.0');
  return {...f,output,content};
}
const run=f=>runProjectBuild({buildDirectory:f.output,tool,headless:true,smoke:false});

const entries=result=>rows(result,'animation-state-entered');
const snapshots=result=>rows(result,'animation-state-snapshot');
const selector={kind:'projectState',key:'combat.value'};

test('real shared-state guards preserve exact typed comparisons and treat missing or mismatched values as false even for ne',real,async t=>{
  const near=2**-53,text='"\\\n日本語🎮';
  const conditions=[{type:'boolean',operator:'eq',value:true},{type:'boolean',operator:'ne',value:false},
    {type:'string',operator:'eq',value:text},{type:'string',operator:'ne',value:'prefix\u0000tail'},
    ...['eq','ne','lt','lte','gt','gte'].map(operator=>({type:'number',operator,value:near})),{type:'number',operator:'eq',value:Number.MIN_VALUE}];
  const cases=conditions.flatMap((condition,index)=>{
    const values=condition.type==='boolean'?[undefined,false,true,1,'true']:condition.type==='string'?[undefined,text,'prefix',0,false]
      :index===10?[undefined,0,Number.MIN_VALUE,false,'0']:[undefined,false,'0',0,near,near+2**-105];
    return values.map(value=>({index,value,matched:value!==undefined&&evaluateAnimationStateCondition(condition,value)}));
  });
  const table={initialState:'idle',states:[{key:'idle'}],transitions:conditions.map((condition,index)=>({from:'idle',to:'idle',trigger:{kind:'event',name:'case'+index,condition:{...condition,selector}}}))};
  const body=cases.map((row,index)=>`\t${row.value===undefined?'p.erase_state("combat.value")':`p.write_state("combat.value",${literal(row.value)})`}\n\tvar before_${index}: int=host.animation_control.sequence\n\tvar revision_${index}: int=host.state_revision\n\tp.publish_event("case${row.index}",true)\n\thost.flush_requests()\n\tprint("CASE:"+JSON.stringify([${index},host.animation_control.sequence-before_${index},receiver._state,receiver._active,host.state_revision-revision_${index}]))`).join('\n');
  const f=await build(t,table,body),result=await run(f);passed(result);
  assert.equal(result.record.events[0].protocol,10);assert.deepEqual(printed(result,'CASE:'),cases.map((row,index)=>[index,row.matched?2:0,0,true,0]));
  assert.equal(entries(result).length,1+cases.filter(row=>row.matched).length);assert.ok(entries(result).every(row=>row.stateIndex===0));
  assert.equal(result.record.events.at(-1).animationStateEntrySequence,entries(result).length);
  assert.equal(snapshots(result)[0].controllers[0].stateIndex,0);assert.equal(snapshots(result)[0].controllers[0].status,'active');
  assert.ok(rows(result,'event-delivery').every(row=>row.status==='handled'));assert.ok(rows(result,'event-publish').every(row=>row.recipients.length===1));
});

const branches=()=>({initialState:'idle',states:[{key:'idle'},{key:'state'},{key:'payload'},{key:'fallback'}],eventSelection:'firstMatch',transitions:[
  {from:'idle',to:'state',trigger:{kind:'event',name:'choose',condition:{type:'boolean',operator:'eq',value:true,selector}}},
  {from:'idle',to:'payload',trigger:{kind:'event',name:'choose',condition:{type:'string',operator:'eq',value:'go'}}},
  {from:'idle',to:'fallback',trigger:{kind:'event',name:'choose'}},
]});
test('real mixed firstMatch groups read shared state at callback time and keep payload and fallback branches independent',real,async t=>{
  const scenarios=[{setup:'p.write_state("combat.value",false)',payload:'go',after:'',state:2},
    {setup:'p.write_state("combat.value",true)',payload:'go',after:'',state:1},
    {setup:'p.erase_state("combat.value")',payload:false,after:'',state:3},
    {setup:'p.write_state("combat.value",false)',payload:'go',after:'p.write_state("combat.value",true)',state:1},
    {setup:'p.write_state("combat.value",true)',payload:false,after:'p.erase_state("combat.value")',state:3}];
  const body=scenarios.map((row,index)=>`\treceiver._enter_state(0)\n\thost.flush_requests()\n\t${row.setup}\n\tvar before_${index}: int=host.animation_control.sequence\n\tp.publish_event("choose",${literal(row.payload)})\n${row.after?'\t'+row.after+'\n':''}\thost.flush_requests()\n\tprint("CHOSEN:"+JSON.stringify([receiver._state,host.animation_control.sequence-before_${index},receiver._active]))`).join('\n');
  const f=await build(t,branches(),body),result=await run(f);passed(result);
  assert.deepEqual(printed(result,'CHOSEN:'),scenarios.map(row=>[row.state,2,true]));
  assert.deepEqual(entries(result).map(row=>row.stateIndex),[0,...scenarios.flatMap(row=>[0,row.state])]);
  assert.equal(snapshots(result)[0].controllers[0].stateIndex,3);assert.equal(rows(result,'event-delivery').length,5);
});

test('real first matching project-state branch failure never attempts its valid fallback',real,async t=>{
  const f=await build(t,branches(),'\tp.write_state("combat.value",true)\n\tp.publish_event("choose","go")\n\thost.flush_requests()',{
    parameters:f=>({clip_idle:f.clipIds[0][0],clip_state:'61616161-6161-4161-8161-000000000099',clip_payload:f.clipIds[0][0],clip_fallback:f.clipIds[0][0]})});
  const result=await run(f);assert.equal(result.ok,false);assert.ok(result.record.diagnostics.some(row=>row.code==='runtime_behavior_animation_clip'&&row.bindingId===f.bindingId));
  assert.equal(rows(result,'animation-command').length,2);assert.deepEqual(entries(result).map(row=>row.stateIndex),[0]);
  assert.equal(snapshots(result)[0].reason,'aborted');assert.equal(snapshots(result)[0].controllers[0].status,'inactive');
});

test('real selected controllers see persistent shared state after scene reentry while old visit ports are revoked',real,async t=>{
  const f=await build(t,selectedTable({type:'boolean',operator:'eq',value:true}),'',{edit:async f=>{
    await f.script('second',`extends Node
static var old_port
func _ready() -> void:
\tcall_deferred("_probe")
func _probe() -> void:
\tvar p=get_meta("viento_project")
\tvar host=get_tree().root.get_node("VientoProject")
\thost.set_process(false)
\thost.flush_requests()
\tif host.visit_index==2:
\t\tprint("STALE:"+JSON.stringify([old_port.read_state("combat.value")==null,p.read_state("combat.value")==true]))
\t\tp.request_scene("${f.sceneIds[0]}")
\t\treturn
\tvar receiver=get_parent().get_node("behavior_${f.bindingId.replaceAll('-','_')}")
\tif host.visit_index==1:
\t\told_port=p
\t\tp.write_state("combat.value",true)
\t\tp.request_scene("${f.sceneIds[1]}")
\t\treturn
\tp.publish_event("action",false)
\thost.flush_requests()
\tprint("RETURN:"+JSON.stringify([receiver._state,receiver._active,p.read_state("combat.value")]))
\thost.finish_project()
`);
  }}),result=await run(f);passed(result);
  assert.deepEqual(printed(result,'STALE:'),[[true,true]]);assert.deepEqual(printed(result,'RETURN:'),[[1,true,true]]);
  assert.deepEqual(rows(result,'scene-enter').map(row=>row.sceneId),[f.sceneIds[0],f.sceneIds[1],f.sceneIds[0]]);
  assert.deepEqual(entries(result).map(row=>[row.visitIndex,row.stateIndex]),[[1,0],[3,0],[3,1]]);
  assert.equal(rows(result,'state').length,1);assert.equal(snapshots(result).at(-1).controllers[0].stateIndex,1);
});

test('real v4 declines an otherwise complete legacy port without read_state before any subscriptions or animation calls',real,async t=>{
  const f=await build(t,selectedTable({type:'number',operator:'ne',value:0}),'\tp.erase_state("combat.value")\n\tp.publish_event("action",true)\n\thost.flush_requests()');
  const result=await run(f);passed(result);assert.equal(rows(result,'animation-command').length,2);
  const directory=path.join(f.temporary,'standalone');await fs.mkdir(directory);
  await fs.writeFile(path.join(directory,'project.godot'),'config_version=5\n[application]\nconfig/name="Selector port admission"\n');
  await fs.writeFile(path.join(directory,'controller.gd'),f.content);
  const methods=['subscribe_event(a,b)','unsubscribe_event(a)','subscribe_animation_completed(a)','unsubscribe_animation_completed(a)','select_animation_clip(a)','play_animation()'];
  await fs.writeFile(path.join(directory,'probe.gd'),`extends SceneTree
class OldPort extends RefCounted:
\tvar calls=0
${methods.map(signature=>`\tfunc ${signature}:\n\t\tcalls+=1\n\t\treturn 1`).join('\n')}
func _initialize() -> void:
\tvar port=OldPort.new()
\tvar node=load("res://controller.gd").new()
\tnode.set_meta("viento_project",port)
\troot.add_child(node)
\tcall_deferred("_check",node,port)
func _check(node,port) -> void:
\tprint("PORT:"+JSON.stringify([node._active,port.calls,node._event_subscriptions.size(),node._completion_subscription]))
\tnode.free()
\tquit()
`);
  const native=await promisify(execFile)(tool,['--headless','--path',directory,'--script','res://probe.gd'],{timeout:30000,maxBuffer:1024*1024});
  assert.equal(/SCRIPT ERROR|Parse Error/.test(native.stderr),false,native.stderr);assert.match(native.stdout,/PORT:\[false,0,0,0\]/);
});

test('real v4 BOM/CRLF controller retains p10 entries and completion through independent ZIP delivery',real,async t=>{
  const table=selectedTable({type:'string',operator:'eq',value:'攻撃🎮'});
  const f=await build(t,table,`\tp.publish_event("action",${literal('攻撃🎮')})\n\thost.flush_requests()\n\tp.write_state("combat.value",${literal('攻撃🎮')})\n\tp.publish_event("action",false)\n\thost.flush_requests()\n\t_step(0.5)`,{bom:true});
  const verify=events=>{
    assert.equal(events[0].protocol,10);assert.equal(events.at(-1).animationStateEntrySequence,3);
    assert.deepEqual(events.filter(row=>row.event==='animation-state-entered').map(row=>row.stateIndex),[0,1,0]);
    assert.deepEqual(events.filter(row=>row.event==='animation-command'&&row.command.action==='select').map(row=>row.command.clipId),[f.clipIds[0][0],f.clipIds[0][1],f.clipIds[0][0]]);
    assert.deepEqual(events.filter(row=>row.event==='event-delivery').map(row=>row.status),['handled','handled']);
    assert.equal(events.filter(row=>row.event==='animation-completed').length,1);
    assert.equal(events.find(row=>row.event==='animation-state-snapshot').controllers[0].stateIndex,0);
  };
  const result=await run(f);passed(result);verify(result.record.events);
  const inspect=()=>inspectBackendProject({buildDirectory:f.output}),delivery=await planBackendProjectDelivery({inspection:await inspect(),assertCurrent:inspect});
  const zip=path.join(f.temporary,'selected-controller.zip');await writeExportZip(delivery,zip);assert.ok((await verifyBackendProjectDelivery(zip)).fileCount>0);
  const moved=path.join(f.temporary,'moved'),archive=await yauzl.openPromise(zip,{lazyEntries:true,autoClose:false});
  try{for await(const entry of archive.eachEntry()){const chunks=[];for await(const chunk of await archive.openReadStreamPromise(entry))chunks.push(chunk);const file=path.join(moved,entry.fileName);await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,Buffer.concat(chunks));}}
  finally{await new Promise(resolve=>{archive.reader.once('close',resolve);archive.close();});}
  const snapshot=JSON.parse(await fs.readFile(path.join(f.output,'snapshot.json')));await fs.rm(f.author,{recursive:true});await fs.rm(f.output,{recursive:true});
  const directory=path.join(moved,'project'),retained=await fs.readFile(path.join(directory,'behaviors',f.scriptId+'.gd'),'utf8');
  assert.equal(retained,f.content);assert.deepEqual(readAnimationStateScriptSource(retained).table,table);
  const manifest=JSON.parse(await fs.readFile(path.join(directory,'assembly.json')));assert.equal(manifest.schemaVersion,11);
  assert.deepEqual(manifest.animationStateWrappers,[{scriptObjectId:f.scriptId,path:`animation-state-wrappers/${f.scriptId}.gd`}]);
  assert.ok(retained.startsWith('\uFEFF'));assert.equal(retained.replaceAll('\r\n','').includes('\n'),false);
  const identified=await adapter.identify(tool);
  for(const phase of [...adapter.buildPhases,'run']){
    const execution=await adapter.executePhase({phase,directory,tool:identified,smoke:false,timeoutMs:60000});
    assert.equal(execution.status,'succeeded',execution.stdout+execution.stderr);assert.deepEqual(adapter.diagnostics(execution,snapshot.plan),[],execution.stdout+execution.stderr);
    if(phase==='run'){const reader=adapter.createEventReader(snapshot.plan);reader.push(execution.stdout);assert.deepEqual(reader.finish().diagnostics,[],execution.stdout+execution.stderr);verify(reader.events);}
  }
});
