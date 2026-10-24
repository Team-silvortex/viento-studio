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
const tool=process.env.VIENTO_GODOT_BIN, real={skip:!tool?'Set VIENTO_GODOT_BIN for actual combined state condition checks':false,timeout:120000};
const xdg=await fs.mkdtemp(path.join(os.tmpdir(),'viento-combinations-xdg-'));
const saved=Object.fromEntries(['XDG_CACHE_HOME','XDG_CONFIG_HOME','XDG_DATA_HOME'].map(key=>[key,process.env[key]]));
for(const[key,name]of [['XDG_CACHE_HOME','cache'],['XDG_CONFIG_HOME','config'],['XDG_DATA_HOME','data']]){process.env[key]=path.join(xdg,name);await fs.mkdir(process.env[key]);}
after(async()=>{for(const[key,value]of Object.entries(saved)){if(value===undefined)delete process.env[key];else process.env[key]=value;}await fs.rm(xdg,{recursive:true,force:true});});
const rows=(result,event)=>result.record.events.filter(row=>row.event===event);
const passed=result=>assert.equal(result.ok,true,JSON.stringify(result.record?.diagnostics||result));
const printed=(result,prefix)=>result.record.phases.at(-1).stdout.split('\n').filter(line=>line.startsWith(prefix)).map(line=>JSON.parse(line.slice(prefix.length)));
const combinedTable=condition=>{const table=structuredClone(DEFAULT_ANIMATION_STATE_TABLE);table.transitions[0].trigger.condition=condition;return table;};
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
  const output=path.join(f.temporary,'combinations-build'),built=await buildProject({root:f.author,targetId:f.assemblyId,tool,output});
  assert.equal(built.ok,true,JSON.stringify(built.diagnostics||built.record?.diagnostics));
  assert.equal(await fs.readFile(path.join(f.author,'documents/scripts/checkpoint.txt'),'utf8'),content);
  assert.equal(adapter.descriptor.version,'0.21.0');
  return {...f,output,content};
}
const run=f=>runProjectBuild({buildDirectory:f.output,tool,headless:true,smoke:false});

const entries=result=>rows(result,'animation-state-entered');
const snapshots=result=>rows(result,'animation-state-snapshot');
const selector={kind:'projectState',key:'combat.value'};

const leaf=(value=true,key,operator='eq')=>({type:typeof value==='number'?'number':typeof value==='string'?'string':'boolean',operator,value,...(key?{selector:{kind:'projectState',key}}:{})});
const group=(combine,conditions)=>({combine,conditions});
const matchLeaf=(condition,payload,state)=>{
  const value=condition.selector?state:payload,{selector,...scalar}=condition;
  return value!==undefined&&evaluateAnimationStateCondition(scalar,value);
};

test('real all/any groups preserve mixed strict scalar truth values and accept exactly one transition per matching group',real,async t=>{
  const near=2**-53;
  const conditions=[group('all',[leaf(0,undefined,'gt'),leaf(true,'combat.value')]),group('any',[leaf(0,undefined,'gt'),leaf(true,'combat.value')]),
    group('all',[leaf('prefix\u0000tail',undefined,'ne'),leaf('日本語🎮','combat.value')]),group('any',[leaf(false,undefined,'ne'),leaf(near,'combat.value','gte')]),
    group('all',Array.from({length:8},(_,index)=>leaf(true,index%2?'combat.value':undefined))),group('any',Array.from({length:8},(_,index)=>leaf(true,index<7?'combat.value':undefined))),
    group('all',[leaf(0,'combat.value','ne')]),group('any',[leaf('','combat.value','ne')]),group('all',[leaf(Number.MIN_VALUE),leaf(near,'combat.value')])];
  const values=[{payload:1,state:true},{payload:0,state:true},{payload:'x',state:true},{payload:true,state:undefined},{payload:false,state:false},
    {payload:'日本語🎮',state:'日本語🎮'},{payload:true,state:near},{payload:'prefix',state:1},{payload:Number.MIN_VALUE,state:near}];
  const cases=conditions.flatMap((condition,index)=>values.map(value=>({...value,index,matched:condition.combine==='all'?condition.conditions.every(part=>matchLeaf(part,value.payload,value.state)):condition.conditions.some(part=>matchLeaf(part,value.payload,value.state))})));
  const table={initialState:'idle',states:[{key:'idle'}],transitions:conditions.map((condition,index)=>({from:'idle',to:'idle',trigger:{kind:'event',name:'case'+index,condition}}))};
  const body=cases.map((row,index)=>`\t${row.state===undefined?'p.erase_state("combat.value")':`p.write_state("combat.value",${literal(row.state)})`}\n\tvar before_${index}: int=host.animation_control.sequence\n\tvar revision_${index}: int=host.state_revision\n\tp.publish_event("case${row.index}",${literal(row.payload)})\n\thost.flush_requests()\n\tprint("CASE:"+JSON.stringify([${index},host.animation_control.sequence-before_${index},receiver._state,receiver._active,host.state_revision-revision_${index}]))`).join('\n');
  const f=await build(t,table,body),result=await run(f);passed(result);
  assert.equal(result.record.events[0].protocol,10);assert.deepEqual(printed(result,'CASE:'),cases.map((row,index)=>[index,row.matched?2:0,0,true,0]));
  assert.equal(entries(result).length,1+cases.filter(row=>row.matched).length);assert.ok(entries(result).every(row=>row.stateIndex===0));
  assert.equal(snapshots(result)[0].controllers[0].status,'active');assert.equal(snapshots(result)[0].controllers[0].stateIndex,0);
  assert.ok(rows(result,'event-delivery').every(row=>row.status==='handled'));assert.equal(rows(result,'event-delivery').length,cases.length);
});

async function standalone(t,sources,probeSource){
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'viento-combinations-standalone-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  await fs.writeFile(path.join(directory,'project.godot'),'config_version=5\n[application]\nconfig/name="Combined condition runtime proof"\n');
  for(const [name,content]of Object.entries(sources))await fs.writeFile(path.join(directory,name),content);
  await fs.writeFile(path.join(directory,'probe.gd'),probeSource);
  const result=await promisify(execFile)(tool,['--headless','--path',directory,'--script','res://probe.gd'],{timeout:30000,maxBuffer:1024*1024});
  assert.equal(/SCRIPT ERROR|Parse Error/.test(result.stderr),false,result.stderr);return result.stdout;
}
const portMethods=`\tvar calls=0
\tvar token=0
\tvar commands: Array=[]
\tfunc subscribe_event(_name,_callback) -> int:
\t\tcalls+=1
\t\ttoken+=1
\t\treturn token
\tfunc unsubscribe_event(_token) -> bool:
\t\treturn true
\tfunc subscribe_animation_completed(_callback) -> int:
\t\tcalls+=1
\t\ttoken+=1
\t\treturn token
\tfunc unsubscribe_animation_completed(_token) -> bool:
\t\treturn true
\tfunc select_animation_clip(_clip) -> bool:
\t\tcalls+=1
\t\tcommands.append("select")
\t\treturn true
\tfunc play_animation() -> bool:
\t\tcalls+=1
\t\tcommands.append("play")
\t\treturn true
`;

test('real GDS short-circuit traces preserve leaf order repeated reads and skipped shared-state leaves',real,async t=>{
  const a=leaf(true,'a'),b=leaf(true,'b'),c=leaf(true,'c');
  const cases=[
    {condition:group('all',[a,b,c]),values:{a:false,b:true,c:true},payload:true,reads:['a'],matched:false},
    {condition:group('all',[a,b,c]),values:{a:true,b:false,c:true},payload:true,reads:['a','b'],matched:false},
    {condition:group('all',[a,b,c]),values:{a:true,b:true,c:true},payload:true,reads:['a','b','c'],matched:true},
    {condition:group('any',[a,b,c]),values:{a:true,b:true,c:true},payload:true,reads:['a'],matched:true},
    {condition:group('any',[a,b,c]),values:{a:false,b:true,c:true},payload:true,reads:['a','b'],matched:true},
    {condition:group('any',[a,b,c]),values:{a:false,b:false,c:false},payload:true,reads:['a','b','c'],matched:false},
    {condition:group('all',[leaf(0,undefined,'gt'),a]),values:{a:true},payload:0,reads:[],matched:false},
    {condition:group('all',[leaf(0,undefined,'gt'),a]),values:{a:true},payload:1,reads:['a'],matched:true},
    {condition:group('any',[leaf(),a]),values:{a:true},payload:true,reads:[],matched:true},
    {condition:group('any',[leaf(),a]),values:{a:true},payload:false,reads:['a'],matched:true},
    {condition:group('all',[a,a]),values:{a:true},payload:false,reads:['a','a'],matched:true},
    {condition:group('any',[leaf(false,'missing','ne'),b]),values:{b:true},payload:true,reads:['missing','b'],matched:true},
    {condition:group('all',[leaf(false,'a','ne'),b]),values:{a:0,b:true},payload:true,reads:['a'],matched:false},
  ];
  const table={initialState:'idle',states:[{key:'idle'}],transitions:cases.map((row,index)=>({from:'idle',to:'idle',trigger:{kind:'event',name:'case'+index,condition:row.condition}}))};
  const source=generateEditableGodotAnimationStateScript(table).content;
  const probe=`extends SceneTree
class TracePort extends RefCounted:
${portMethods}\tvar reads: Array=[]
\tvar values: Dictionary={}
\tfunc read_state(key) -> Variant:
\t\treads.append(key)
\t\treturn values.get(key)
func _initialize() -> void:
\tvar port=TracePort.new()
\tvar node=load("res://controller.gd").new()
\tnode.set_meta("viento_project",port)
\troot.add_child(node)
\tcall_deferred("_check",node,port)
func _check(node,port) -> void:
${cases.map((row,index)=>`\tport.values=${JSON.stringify(row.values)}\n\tport.reads.clear()\n\tport.commands.clear()\n\tvar handled_${index}=node._on_event(${literal(row.payload)},"case${index}")\n\tprint("TRACE:"+JSON.stringify([${index},handled_${index},port.reads,port.commands.size(),node._active]))`).join('\n')}
\tnode.free()
\tquit()
`;
  const stdout=await standalone(t,{'controller.gd':source},probe),traces=stdout.split('\n').filter(line=>line.startsWith('TRACE:')).map(line=>JSON.parse(line.slice(6)));
  assert.deepEqual(traces,cases.map((row,index)=>[index,true,row.reads,row.matched?2:0,true]));
});

const branches=()=>({initialState:'idle',states:[{key:'idle'},{key:'all'},{key:'any'},{key:'leaf'},{key:'fallback'}],eventSelection:'firstMatch',transitions:[
  {from:'idle',to:'all',trigger:{kind:'event',name:'choose',condition:group('all',[leaf('go'),leaf(true,'combat.value')])}},
  {from:'idle',to:'any',trigger:{kind:'event',name:'choose',condition:group('any',[leaf('alt'),leaf(true,'combat.other')])}},
  {from:'idle',to:'leaf',trigger:{kind:'event',name:'choose',condition:leaf(true)}},
  {from:'idle',to:'fallback',trigger:{kind:'event',name:'choose'}},
]});
test('real mixed firstMatch groups and scalar branches read state at delivery time and execute only the first match',real,async t=>{
  const scenarios=[{state:true,other:true,payload:'go',after:'',stateIndex:1},{state:false,other:true,payload:'go',after:'',stateIndex:2},
    {state:false,other:false,payload:true,after:'',stateIndex:3},{state:undefined,other:undefined,payload:false,after:'',stateIndex:4},
    {state:false,other:undefined,payload:'go',after:'p.write_state("combat.value",true)',stateIndex:1},
    {state:true,other:undefined,payload:'go',after:'p.erase_state("combat.value")',stateIndex:4}];
  const set=(key,value)=>value===undefined?`p.erase_state("${key}")`:`p.write_state("${key}",${literal(value)})`;
  const body=scenarios.map((row,index)=>`\treceiver._enter_state(0)\n\thost.flush_requests()\n\t${set('combat.value',row.state)}\n\t${set('combat.other',row.other)}\n\tvar before_${index}: int=host.animation_control.sequence\n\tp.publish_event("choose",${literal(row.payload)})\n${row.after?'\t'+row.after+'\n':''}\thost.flush_requests()\n\tprint("CHOSEN:"+JSON.stringify([receiver._state,host.animation_control.sequence-before_${index},receiver._active]))`).join('\n');
  const f=await build(t,branches(),body),result=await run(f);passed(result);
  assert.deepEqual(printed(result,'CHOSEN:'),scenarios.map(row=>[row.stateIndex,2,true]));
  assert.deepEqual(entries(result).map(row=>row.stateIndex),[0,...scenarios.flatMap(row=>[0,row.stateIndex])]);
  assert.equal(snapshots(result)[0].controllers[0].stateIndex,4);assert.equal(rows(result,'event-delivery').length,6);
});

test('real a matching all group with rejected entry does not attempt a matching any branch or fallback',real,async t=>{
  // Author bindings are valid; corrupt the selected runtime clip to test fail-stop without fallback.
  const f=await build(t,branches(),'\tp.write_state("combat.value",true)\n\tp.write_state("combat.other",true)\n\treceiver._clips[1] = "61616161-6161-4161-8161-000000000099"\n\tp.publish_event("choose","go")\n\thost.flush_requests()');
  const result=await run(f);assert.equal(result.ok,false);assert.ok(result.record.diagnostics.some(row=>row.code==='runtime_behavior_animation_clip'&&row.bindingId===f.bindingId));
  assert.equal(rows(result,'animation-command').length,2);assert.deepEqual(entries(result).map(row=>row.stateIndex),[0]);assert.equal(snapshots(result)[0].reason,'aborted');assert.equal(snapshots(result)[0].controllers[0].status,'inactive');
});

test('real payload-only v5 accepts the legacy port while a shared-state leaf requires read_state before side effects',real,async t=>{
  const sources={'payload.gd':generateEditableGodotAnimationStateScript(combinedTable(group('all',[leaf(true)]))).content,
    'shared.gd':generateEditableGodotAnimationStateScript(combinedTable(group('all',[leaf(true,'combat.value')]))).content};
  const probe=`extends SceneTree
class OldPort extends RefCounted:
${portMethods}func _initialize() -> void:
\tvar first=OldPort.new()
\tvar second=OldPort.new()
\tvar payload=load("res://payload.gd").new()
\tvar shared=load("res://shared.gd").new()
\tpayload.set_meta("viento_project",first)
\tshared.set_meta("viento_project",second)
\troot.add_child(payload)
\troot.add_child(shared)
\tcall_deferred("_check",payload,shared,first,second)
func _check(payload,shared,first,second) -> void:
\tvar handled=payload._on_event(true,"action")
\tprint("PORT:"+JSON.stringify([payload._active,handled,payload._state,first.calls,shared._active,second.calls]))
\tpayload.free()
\tshared.free()
\tquit()
`;
  const stdout=await standalone(t,sources,probe);assert.match(stdout,/PORT:\[true,true,1,6,false,0\]/);
});

test('real v5 BOM/CRLF group controller retains p10 entries completion and immutable author bytes in an independent ZIP',real,async t=>{
  const table=combinedTable(group('all',[leaf(true),leaf('攻撃🎮','combat.value')]));
  const f=await build(t,table,`\tp.publish_event("action",true)\n\thost.flush_requests()\n\tp.write_state("combat.value",${literal('攻撃🎮')})\n\tp.publish_event("action",true)\n\thost.flush_requests()\n\t_step(0.5)`,{bom:true});
  const verify=events=>{
    assert.equal(events[0].protocol,10);assert.equal(events.at(-1).animationStateEntrySequence,3);
    assert.deepEqual(events.filter(row=>row.event==='animation-state-entered').map(row=>row.stateIndex),[0,1,0]);
    assert.deepEqual(events.filter(row=>row.event==='animation-command'&&row.command.action==='select').map(row=>row.command.clipId),[f.clipIds[0][0],f.clipIds[0][1],f.clipIds[0][0]]);
    assert.deepEqual(events.filter(row=>row.event==='event-delivery').map(row=>row.status),['handled','handled']);assert.equal(events.filter(row=>row.event==='animation-completed').length,1);
    assert.equal(events.find(row=>row.event==='animation-state-snapshot').controllers[0].stateIndex,0);
  };
  const result=await run(f);passed(result);verify(result.record.events);
  const inspect=()=>inspectBackendProject({buildDirectory:f.output}),delivery=await planBackendProjectDelivery({inspection:await inspect(),assertCurrent:inspect});
  const zip=path.join(f.temporary,'combined-controller.zip');await writeExportZip(delivery,zip);assert.ok((await verifyBackendProjectDelivery(zip)).fileCount>0);
  const moved=path.join(f.temporary,'moved'),archive=await yauzl.openPromise(zip,{lazyEntries:true,autoClose:false});
  try{for await(const entry of archive.eachEntry()){const chunks=[];for await(const chunk of await archive.openReadStreamPromise(entry))chunks.push(chunk);const file=path.join(moved,entry.fileName);await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,Buffer.concat(chunks));}}
  finally{await new Promise(resolve=>{archive.reader.once('close',resolve);archive.close();});}
  const snapshot=JSON.parse(await fs.readFile(path.join(f.output,'snapshot.json')));await fs.rm(f.author,{recursive:true});await fs.rm(f.output,{recursive:true});
  const directory=path.join(moved,'project'),retained=await fs.readFile(path.join(directory,'behaviors',f.scriptId+'.gd'),'utf8');assert.equal(retained,f.content);assert.deepEqual(readAnimationStateScriptSource(retained).table,table);
  const manifest=JSON.parse(await fs.readFile(path.join(directory,'assembly.json')));assert.equal(manifest.schemaVersion,11);assert.deepEqual(manifest.animationStateWrappers,[{scriptObjectId:f.scriptId,path:`animation-state-wrappers/${f.scriptId}.gd`}]);
  const identified=await adapter.identify(tool);
  for(const phase of [...adapter.buildPhases,'run']){const execution=await adapter.executePhase({phase,directory,tool:identified,smoke:false,timeoutMs:60000});
    assert.equal(execution.status,'succeeded',execution.stdout+execution.stderr);assert.deepEqual(adapter.diagnostics(execution,snapshot.plan),[],execution.stdout+execution.stderr);
    if(phase==='run'){const reader=adapter.createEventReader(snapshot.plan);reader.push(execution.stdout);assert.deepEqual(reader.finish().diagnostics,[],execution.stdout+execution.stderr);verify(reader.events);}
  }
});
