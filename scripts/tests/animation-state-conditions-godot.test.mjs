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
const tool=process.env.VIENTO_GODOT_BIN, real={skip:!tool?'Set VIENTO_GODOT_BIN for actual conditional state behavior checks':false,timeout:120000};
const xdg=await fs.mkdtemp(path.join(os.tmpdir(),'viento-conditions-xdg-'));
const saved=Object.fromEntries(['XDG_CACHE_HOME','XDG_CONFIG_HOME','XDG_DATA_HOME'].map(key=>[key,process.env[key]]));
for(const[key,name]of [['XDG_CACHE_HOME','cache'],['XDG_CONFIG_HOME','config'],['XDG_DATA_HOME','data']]){process.env[key]=path.join(xdg,name);await fs.mkdir(process.env[key]);}
after(async()=>{for(const[key,value]of Object.entries(saved)){if(value===undefined)delete process.env[key];else process.env[key]=value;}await fs.rm(xdg,{recursive:true,force:true});});
const rows=(result,event)=>result.record.events.filter(row=>row.event===event);
const passed=result=>assert.equal(result.ok,true,JSON.stringify(result.record?.diagnostics||result));
const printed=(result,prefix)=>result.record.phases.at(-1).stdout.split('\n').filter(line=>line.startsWith(prefix)).map(line=>JSON.parse(line.slice(prefix.length)));
const conditionalTable=condition=>{const table=structuredClone(DEFAULT_ANIMATION_STATE_TABLE);table.transitions[0].trigger.condition=condition;return table;};
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
    manifest.bindings[0].parameters=parameters?parameters(f):{clip_idle:f.clipIds[0][0],...(table.states.length>1?{clip_action:f.clipIds[0][1]}:{})};
    manifest.bindings.push({...structuredClone(manifest.bindings[0]),bindingId:f.secondBindingId,implementation:{...manifest.bindings[0].implementation,sourceObjectId:f.secondScriptId},parameters:{}});
  });
  await f.edit('metadata/documents/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee.json',metadata=>metadata.relations.push({kind:'reference',targetId:f.secondScriptId,slot:'implementation'}));
  await f.script('second',probe(f,typeof body==='function'?body(f):body));
  if(edit)await edit(f);
  const output=path.join(f.temporary,'conditions-build'),built=await buildProject({root:f.author,targetId:f.assemblyId,tool,output});
  assert.equal(built.ok,true,JSON.stringify(built.diagnostics||built.record?.diagnostics));
  return {...f,output,content};
}
const run=f=>runProjectBuild({buildDirectory:f.output,tool,headless:true,smoke:false});

test('actual project event guards match Rust typed comparisons, exact doubles and strings while false guards keep subscriptions alive',real,async t=>{
  const special='"\\\n\r\t\b\f日本語🎮',near=2**-53;
  const conditions=[{type:'boolean',operator:'eq',value:true},{type:'boolean',operator:'ne',value:false},
    {type:'string',operator:'eq',value:special},{type:'string',operator:'ne',value:''},
    ...['eq','ne','lt','lte','gt','gte'].map(operator=>({type:'number',operator,value:near})),
    {type:'number',operator:'eq',value:Number.MIN_VALUE},{type:'number',operator:'eq',value:0},
    {type:'string',operator:'eq',value:'prefix\u0000tail'},{type:'string',operator:'ne',value:'prefix\u0000tail'}];
  const cases=conditions.flatMap((condition,index)=>{
    const values=condition.type==='boolean'?[false,true,0,1,'true']:condition.type==='string'?(index>=12?['prefix','prefix�tail','prefixtail','']:['',special,'0',0,false])
      :index===10?[0,Number.MIN_VALUE,Number.MIN_VALUE*2]:index===11?[-0,0,false,'0']:[false,'0',-1e9,0,near,near+2**-105,1e9];
    return values.map(value=>({index,value,matched:evaluateAnimationStateCondition(condition,value)}));
  });
  const table={initialState:'idle',states:[{key:'idle'}],transitions:conditions.map((condition,index)=>({from:'idle',to:'idle',trigger:{kind:'event',name:'case'+index,condition}}))};
  const body=cases.map((row,index)=>`\tvar before_${index}: int=host.animation_control.sequence\n\tp.publish_event("case${row.index}",${literal(row.value)})\n\thost.flush_requests()\n\tprint("CASE:"+JSON.stringify([${index},host.animation_control.sequence-before_${index},receiver._state]))`).join('\n')
    +'\n\tvar int_before: int=host.animation_control.sequence\n\tp.publish_event("case11",0)\n\thost.flush_requests()\n\tprint("INT:"+JSON.stringify(host.animation_control.sequence-int_before))';
  const f=await build(t,table,body),result=await run(f);passed(result);
  assert.equal(result.record.events[0].protocol,7);
  assert.deepEqual(printed(result,'CASE:'),cases.map((row,index)=>[index,row.matched?2:0,0]));
  assert.deepEqual(printed(result,'INT:'),[2]);
  assert.equal(rows(result,'event-publish').length,cases.length+1);
  assert.ok(rows(result,'event-publish').every(row=>row.recipients.length===1));
  assert.ok(rows(result,'event-delivery').every(row=>row.status==='handled'));
  assert.equal(rows(result,'animation-command').length,2+2*cases.filter(row=>row.matched).length+2);
  assert.ok(rows(result,'animation-command').every(row=>row.bindingId===f.bindingId));
});

for(const match of [false,true])test(`same-safe-point ${match?'matching guard preempts':'unmatched guard retains'} a captured natural completion`,real,async t=>{
  const table=conditionalTable({type:'boolean',operator:'eq',value:true});
  table.transitions.push({from:'action',to:'action',trigger:{kind:'event',name:'restart',condition:{type:'number',operator:'gte',value:1}}});
  const f=await build(t,table,`\tp.publish_event("action",true)
\thost.flush_requests()
\t_step(0.5,false)
\tp.publish_event("restart",${match?'1':'0'})
\thost.flush_requests()
\tprint("STATE:"+JSON.stringify(receiver._state))`),result=await run(f);passed(result);
  assert.deepEqual(rows(result,'animation-completion-delivery').map(row=>row.status),[match?'skipped':'handled']);
  assert.deepEqual(printed(result,'STATE:'),[match?1:0]);
  assert.equal(rows(result,'animation-command').length,6);
});

for(const match of [false,true])test(`guard ${match?'match exposes':'mismatch does not enqueue'} an unknown target clip`,real,async t=>{
  const f=await build(t,conditionalTable({type:'boolean',operator:'eq',value:true}),`\tp.publish_event("action",${match})\n\thost.flush_requests()`,{parameters:f=>({clip_idle:f.clipIds[0][0],clip_action:'61616161-6161-4161-8161-000000000099'})});
  const result=await run(f);
  if(match){assert.equal(result.ok,false);assert.ok(result.record.diagnostics.some(row=>row.code==='runtime_behavior_animation_clip'&&row.bindingId===f.bindingId));}
  else{passed(result);assert.deepEqual(rows(result,'event-delivery').map(row=>row.status),['handled']);}
  assert.equal(rows(result,'animation-command').length,2);
});

test('conditional callback rejects unsupported scalars without side effects and standalone missing ports remain safe',real,async t=>{
  const table=conditionalTable({type:'number',operator:'ne',value:0});
  const f=await build(t,table,`\tfor value in [null,[],{},NAN,INF,-INF,1000000001.0]:
\t\tprint("INVALID:"+JSON.stringify([receiver._condition_matches(value,receiver._TRANSITIONS[0]["trigger"]["condition"]),receiver._on_event(value,"action"),receiver._state]))`);
  const result=await run(f);passed(result);assert.deepEqual(printed(result,'INVALID:'),Array.from({length:7},()=>[false,true,0]));assert.equal(rows(result,'animation-command').length,2);
  const directory=path.join(f.temporary,'standalone');await fs.mkdir(directory);
  await fs.writeFile(path.join(directory,'project.godot'),'config_version=5\n[application]\nconfig/name="Conditions without project ports"\n');
  await fs.writeFile(path.join(directory,'controller.gd'),f.content);
  await fs.writeFile(path.join(directory,'probe.gd'),'extends SceneTree\nfunc _initialize() -> void:\n\tvar node=load("res://controller.gd").new()\n\troot.add_child(node)\n\tprint("ALIVE:"+JSON.stringify(node._active))\n\tnode.free()\n\tquit()\n');
  const native=await promisify(execFile)(tool,['--headless','--path',directory,'--script','res://probe.gd'],{timeout:30000,maxBuffer:1024*1024});
  assert.equal(/SCRIPT ERROR|Parse Error/.test(native.stderr),false,native.stderr);assert.match(native.stdout,/ALIVE:false/);
});

test('v1→conditional v2 BOM/CRLF source survives independent ZIP delivery and executes guards after original files are removed',real,async t=>{
  const before='\uFEFF'+DEFAULT_EDITABLE_GODOT_ANIMATION_STATE_SCRIPT.replaceAll('\n','\r\n'),read=readAnimationStateScriptSource(before);
  const table=structuredClone(read.table);table.transitions[0].trigger.name='combat.attack';table.transitions[0].trigger.condition={type:'string',operator:'eq',value:'攻撃🎮'};
  const f=await build(t,table,`\tp.publish_event("combat.attack",false)
\tp.publish_event("combat.attack",${literal('攻撃🎮')})
\thost.flush_requests()
\t_step(0.5)`,{bom:true});
  const verify=events=>{
    assert.equal(events[0].protocol,7);
    assert.deepEqual(events.filter(row=>row.event==='animation-command'&&row.command.action==='select').map(row=>row.command.clipId),[f.clipIds[0][0],f.clipIds[0][1],f.clipIds[0][0]]);
    assert.deepEqual(events.filter(row=>row.event==='event-delivery').map(row=>row.status),['handled','handled']);
    assert.equal(events.filter(row=>row.event==='animation-completed').length,1);
  };
  const result=await run(f);passed(result);verify(result.record.events);
  const inspect=()=>inspectBackendProject({buildDirectory:f.output}),delivery=await planBackendProjectDelivery({inspection:await inspect(),assertCurrent:inspect});
  const zip=path.join(f.temporary,'conditional-controller.zip');await writeExportZip(delivery,zip);assert.ok((await verifyBackendProjectDelivery(zip)).fileCount>0);
  const moved=path.join(f.temporary,'moved'),archive=await yauzl.openPromise(zip,{lazyEntries:true,autoClose:false});
  try{for await(const entry of archive.eachEntry()){const chunks=[];for await(const chunk of await archive.openReadStreamPromise(entry))chunks.push(chunk);const file=path.join(moved,entry.fileName);await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,Buffer.concat(chunks));}}
  finally{await new Promise(resolve=>{archive.reader.once('close',resolve);archive.close();});}
  const snapshot=JSON.parse(await fs.readFile(path.join(f.output,'snapshot.json')));await fs.rm(f.author,{recursive:true});await fs.rm(f.output,{recursive:true});
  const directory=path.join(moved,'project'),retained=await fs.readFile(path.join(directory,'behaviors',f.scriptId+'.gd'),'utf8');
  assert.equal(retained,f.content);assert.deepEqual(readAnimationStateScriptSource(retained).table,table);
  assert.ok(retained.startsWith('\uFEFF'));assert.equal(retained.replaceAll('\r\n','').includes('\n'),false);
  const identified=await adapter.identify(tool);
  for(const phase of [...adapter.buildPhases,'run']){
    const execution=await adapter.executePhase({phase,directory,tool:identified,smoke:false,timeoutMs:60000});
    assert.equal(execution.status,'succeeded',execution.stdout+execution.stderr);assert.deepEqual(adapter.diagnostics(execution,snapshot.plan),[],execution.stdout+execution.stderr);
    if(phase==='run'){const reader=adapter.createEventReader(snapshot.plan);reader.push(execution.stdout);assert.deepEqual(reader.finish().diagnostics,[],execution.stdout+execution.stderr);verify(reader.events);}
  }
});
