import '../adapters/node-studio-core.mjs';
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import yauzl from 'yauzl';
import { DEFAULT_ANIMATION_STATE_TABLE } from '../../engine/godot-animation-state-script.mjs';
import { generateEditableGodotAnimationStateScript, readAnimationStateScriptSource } from '../../engine/animation-state-script-source.mjs';
import { projectAnimationClipsAuthor } from './helpers/project-animation-clips-author-fixture.mjs';
import { buildProject, runProjectBuild } from '../adapters/node-project-build.mjs';
import { GODOT4_EXECUTION_ADAPTER as adapter } from '../backends/godot4-adapter.mjs';
import { inspectBackendProject } from '../adapters/node-backend-project.mjs';
import { planBackendProjectDelivery, verifyBackendProjectDelivery } from '../adapters/node-backend-project-delivery.mjs';
import { writeExportZip } from '../lib/export-package.mjs';
const tool=process.env.VIENTO_GODOT_BIN, real={skip:!tool?'Set VIENTO_GODOT_BIN for actual ordered animation branch checks':false,timeout:120000};
const xdg=await fs.mkdtemp(path.join(os.tmpdir(),'viento-branches-xdg-'));
const saved=Object.fromEntries(['XDG_CACHE_HOME','XDG_CONFIG_HOME','XDG_DATA_HOME'].map(key=>[key,process.env[key]]));
for(const[key,name]of [['XDG_CACHE_HOME','cache'],['XDG_CONFIG_HOME','config'],['XDG_DATA_HOME','data']]){process.env[key]=path.join(xdg,name);await fs.mkdir(process.env[key]);}
after(async()=>{for(const[key,value]of Object.entries(saved)){if(value===undefined)delete process.env[key];else process.env[key]=value;}await fs.rm(xdg,{recursive:true,force:true});});
const rows=(result,event)=>result.record.events.filter(row=>row.event===event);
const passed=result=>assert.equal(result.ok,true,JSON.stringify(result.record?.diagnostics||result));
const printed=(result,prefix)=>result.record.phases.at(-1).stdout.split('\n').filter(line=>line.startsWith(prefix)).map(line=>JSON.parse(line.slice(prefix.length)));
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
    manifest.bindings[0].parameters=parameters?parameters(f):Object.fromEntries(table.states.map(state=>['clip_'+state.key,f.clipIds[0][state.key==='first'||state.key==='action'?1:0]]));
    manifest.bindings.push({...structuredClone(manifest.bindings[0]),bindingId:f.secondBindingId,implementation:{...manifest.bindings[0].implementation,sourceObjectId:f.secondScriptId},parameters:{}});
  });
  await f.edit('metadata/documents/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee.json',metadata=>metadata.relations.push({kind:'reference',targetId:f.secondScriptId,slot:'implementation'}));
  await f.script('second',probe(f,typeof body==='function'?body(f):body));
  if(edit)await edit(f);
  const output=path.join(f.temporary,'branches-build'),built=await buildProject({root:f.author,targetId:f.assemblyId,tool,output});
  assert.equal(built.ok,true,JSON.stringify(built.diagnostics||built.record?.diagnostics));
  return {...f,output,content};
}
const run=f=>runProjectBuild({buildDirectory:f.output,tool,headless:true,smoke:false});

const branchTable = () => ({initialState:'idle',states:[{key:'idle'},{key:'first'},{key:'second'},{key:'fallback'}],eventSelection:'firstMatch',transitions:[
  {from:'idle',to:'first',trigger:{kind:'event',name:'choose',condition:{type:'number',operator:'gte',value:0}}},
  {from:'idle',to:'second',trigger:{kind:'event',name:'choose',condition:{type:'number',operator:'gte',value:-1}}},
  {from:'idle',to:'fallback',trigger:{kind:'event',name:'choose'}},
  {from:'first',to:'idle',trigger:{kind:'completed'}},
]});
const choose = (value,index) => `\treceiver._enter_state(0)\n\thost.flush_requests()\n\tvar before_${index}: int=host.animation_control.sequence\n\tp.publish_event("choose",${literal(value)})\n\thost.flush_requests()\n\tprint("CHOICE:"+JSON.stringify([receiver._state,host.animation_control.sequence-before_${index},receiver._active]))`;

for(const reversed of [false,true])test(`actual ordered branches select one ${reversed?'reordered':'declared'} first match and otherwise use the last fallback`,real,async t=>{
  const table=branchTable();if(reversed)[table.transitions[0],table.transitions[1]]=[table.transitions[1],table.transitions[0]];
  const values=[0,1,-.5,-2,true,'0'],f=await build(t,table,values.map(choose).join('\n')),result=await run(f);passed(result);
  assert.deepEqual(printed(result,'CHOICE:'),values.map((_,index)=>[index<2?(reversed?2:1):index===2?2:3,2,true]));
  assert.equal(rows(result,'event-publish').length,values.length);assert.ok(rows(result,'event-publish').every(row=>row.recipients.length===1));assert.ok(rows(result,'event-delivery').every(row=>row.status==='handled'));
});

test('unmatched conditions including cross-type ne preserve the state and live subscription until a later matching event',real,async t=>{
  const table=branchTable();table.transitions=table.transitions.slice(0,2);table.transitions[0].trigger.condition={type:'number',operator:'ne',value:0};table.transitions[1].trigger.condition={type:'string',operator:'eq',value:'go'};
  const values=[false,0,'0',true,'go',1],f=await build(t,table,values.map(choose).join('\n')),result=await run(f);passed(result);
  assert.deepEqual(printed(result,'CHOICE:'),[[0,0,true],[0,0,true],[0,0,true],[0,0,true],[2,2,true],[1,2,true]]);
  assert.ok(rows(result,'event-delivery').every(row=>row.status==='handled'));
});

test('a matching self-edge restarts once, entering a new state does not cascade, and natural completion returns once',real,async t=>{
  const table={initialState:'idle',states:[{key:'idle'},{key:'action'}],eventSelection:'firstMatch',transitions:[
    {from:'idle',to:'idle',trigger:{kind:'event',name:'choose',condition:{type:'number',operator:'lt',value:0}}},
    {from:'idle',to:'action',trigger:{kind:'event',name:'choose'}},
    {from:'action',to:'idle',trigger:{kind:'event',name:'choose'}},
    {from:'action',to:'idle',trigger:{kind:'completed'}},
  ]};
  const f=await build(t,table,`${choose(-1,0)}\n${choose(1,1)}\n\t_step(0.5)\n\tprint("COMPLETED:"+JSON.stringify(receiver._state))`),result=await run(f);passed(result);
  assert.deepEqual(printed(result,'CHOICE:'),[[0,2,true],[1,2,true]]);assert.deepEqual(printed(result,'COMPLETED:'),[0]);
  assert.equal(rows(result,'animation-completed').length,1);assert.deepEqual(rows(result,'animation-completion-delivery').map(row=>row.status),['handled']);
});

for(const match of [false,true])test(`ordered event group ${match?'matching':'unmatched'} at a natural completion safe point retains existing scheduling semantics`,real,async t=>{
  const table={...structuredClone(DEFAULT_ANIMATION_STATE_TABLE),eventSelection:'firstMatch'};
  table.transitions.push({from:'action',to:'action',trigger:{kind:'event',name:'restart',condition:{type:'number',operator:'lt',value:0}}},{from:'action',to:'action',trigger:{kind:'event',name:'restart',condition:{type:'number',operator:'gte',value:1}}});
  const f=await build(t,table,`\tp.publish_event("action",true)\n\thost.flush_requests()\n\t_step(0.5,false)\n\tp.publish_event("restart",${match?'1':'0'})\n\thost.flush_requests()\n\tprint("STATE:"+JSON.stringify(receiver._state))`),result=await run(f);passed(result);
  assert.deepEqual(rows(result,'animation-completion-delivery').map(row=>row.status),[match?'skipped':'handled']);assert.deepEqual(printed(result,'STATE:'),[match?1:0]);assert.equal(rows(result,'animation-command').length,6);
});

test('failure entering the first matching branch stops execution without attempting the fallback',real,async t=>{
  const f=await build(t,branchTable(),`\tp.publish_event("choose",1)\n\thost.flush_requests()`,{parameters:f=>({clip_idle:f.clipIds[0][0],clip_first:'61616161-6161-4161-8161-000000000099',clip_second:f.clipIds[0][0],clip_fallback:f.clipIds[0][0]})});
  const result=await run(f);assert.equal(result.ok,false);assert.ok(result.record.diagnostics.some(row=>row.code==='runtime_behavior_animation_clip'&&row.bindingId===f.bindingId));assert.equal(rows(result,'animation-command').length,2);
});

test('explicit firstMatch with no transitions compiles and activates without event subscriptions',real,async t=>{
  const table={initialState:'idle',states:[{key:'idle'}],transitions:[],eventSelection:'firstMatch'};
  const f=await build(t,table,`\tprint("EMPTY:"+JSON.stringify([receiver._state,receiver._active,receiver._event_subscriptions.size()]))`),result=await run(f);passed(result);assert.deepEqual(printed(result,'EMPTY:'),[[0,true,0]]);
});

test('v3 exact floating thresholds and encoded Unicode strings choose the corresponding branch',real,async t=>{
  const table=branchTable();table.transitions[0].trigger.condition={type:'number',operator:'eq',value:Number.MIN_VALUE};table.transitions[1].trigger.condition={type:'string',operator:'eq',value:'"\\\n日本語🎮'};
  const values=[Number.MIN_VALUE,0,'"\\\n日本語🎮','日本語'],f=await build(t,table,values.map(choose).join('\n')),result=await run(f);passed(result);assert.deepEqual(printed(result,'CHOICE:'),[[1,2,true],[3,2,true],[2,2,true],[3,2,true]]);
});

test('v3 BOM/CRLF source survives independent ZIP delivery after author and build removal',real,async t=>{
  const table=branchTable(),f=await build(t,table,`${choose(-.5,0)}\n${choose(1,1)}\n\t_step(0.5)`,{bom:true});
  const verify=events=>{assert.equal(events[0].protocol,9);assert.deepEqual(events.filter(row=>row.event==='event-delivery').map(row=>row.status),['handled','handled']);assert.equal(events.filter(row=>row.event==='animation-completed').length,1);};
  const result=await run(f);passed(result);verify(result.record.events);assert.deepEqual(printed(result,'CHOICE:'),[[2,2,true],[1,2,true]]);
  const inspect=()=>inspectBackendProject({buildDirectory:f.output}),delivery=await planBackendProjectDelivery({inspection:await inspect(),assertCurrent:inspect});
  const zip=path.join(f.temporary,'branches-controller.zip');await writeExportZip(delivery,zip);assert.ok((await verifyBackendProjectDelivery(zip)).fileCount>0);
  const moved=path.join(f.temporary,'moved'),archive=await yauzl.openPromise(zip,{lazyEntries:true,autoClose:false});
  try{for await(const entry of archive.eachEntry()){const chunks=[];for await(const chunk of await archive.openReadStreamPromise(entry))chunks.push(chunk);const file=path.join(moved,entry.fileName);await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,Buffer.concat(chunks));}}
  finally{await new Promise(resolve=>{archive.reader.once('close',resolve);archive.close();});}
  const snapshot=JSON.parse(await fs.readFile(path.join(f.output,'snapshot.json')));await fs.rm(f.author,{recursive:true});await fs.rm(f.output,{recursive:true});
  const directory=path.join(moved,'project'),retained=await fs.readFile(path.join(directory,'behaviors',f.scriptId+'.gd'),'utf8');assert.equal(retained,f.content);assert.deepEqual(readAnimationStateScriptSource(retained).table,table);
  assert.ok(retained.startsWith('\uFEFF'));assert.equal(retained.replaceAll('\r\n','').includes('\n'),false);
  const identified=await adapter.identify(tool);
  for(const phase of [...adapter.buildPhases,'run']){
    const execution=await adapter.executePhase({phase,directory,tool:identified,smoke:false,timeoutMs:60000});assert.equal(execution.status,'succeeded',execution.stdout+execution.stderr);assert.deepEqual(adapter.diagnostics(execution,snapshot.plan),[],execution.stdout+execution.stderr);
    if(phase==='run'){const reader=adapter.createEventReader(snapshot.plan);reader.push(execution.stdout);assert.deepEqual(reader.finish().diagnostics,[],execution.stdout+execution.stderr);verify(reader.events);}
  }
});
