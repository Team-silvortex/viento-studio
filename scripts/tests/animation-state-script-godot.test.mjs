import '../adapters/node-studio-core.mjs';
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import yauzl from 'yauzl';
import { generateGodotAnimationStateScript, DEFAULT_ANIMATION_STATE_TABLE, DEFAULT_GODOT_ANIMATION_STATE_SCRIPT } from '../../engine/godot-animation-state-script.mjs';
import { projectAnimationClipsAuthor } from './helpers/project-animation-clips-author-fixture.mjs';
import { buildProject, runProjectBuild } from '../adapters/node-project-build.mjs';
import { GODOT4_EXECUTION_ADAPTER as adapter } from '../backends/godot4-adapter.mjs';
import { inspectBackendProject } from '../adapters/node-backend-project.mjs';
import { planBackendProjectDelivery, verifyBackendProjectDelivery } from '../adapters/node-backend-project-delivery.mjs';
import { writeExportZip } from '../lib/export-package.mjs';
const execFileAsync = promisify(execFile), tool = process.env.VIENTO_GODOT_BIN;
const real = { skip: !tool ? 'Set VIENTO_GODOT_BIN for actual state-table behaviors' : false, timeout: 120000 };
// Every native child inherits private XDG directories, including the project
// build adapter, so no test imports or editor state reach the user's profile.
const xdg = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-state-xdg-'));
const savedEnv = Object.fromEntries(['XDG_CACHE_HOME','XDG_CONFIG_HOME','XDG_DATA_HOME'].map(key => [key, process.env[key]]));
for (const [key, name] of [['XDG_CACHE_HOME','cache'],['XDG_CONFIG_HOME','config'],['XDG_DATA_HOME','data']]) {
  process.env[key] = path.join(xdg, name); await fs.mkdir(process.env[key]);
}
after(async () => { for (const [key,value] of Object.entries(savedEnv)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } await fs.rm(xdg, { recursive: true, force: true }); });
const rows = (result, event) => result.record.events.filter(row => row.event === event);
const commands = result => rows(result, 'animation-command');
const selections = result => commands(result).filter(row => row.command.action === 'select').map(row => row.command.clipId);
const passed = result => assert.equal(result.ok, true, JSON.stringify(result.record?.diagnostics || result));
const printed = (result, prefix) => result.record.phases.at(-1).stdout.split('\n').filter(line => line.startsWith(prefix)).map(line => JSON.parse(line.slice(prefix.length)));
const event = (from, to, name) => ({ from, to, trigger: { kind: 'event', name } });
const completed = (from, to) => ({ from, to, trigger: { kind: 'completed' } });
const movementTable = () => ({ initialState:'idle', states:[{key:'idle'},{key:'walk'},{key:'attack'}], transitions:[
  event('idle','walk','move'),event('walk','idle','idle'),event('idle','attack','attack'),event('walk','attack','attack'),
  event('attack','attack','attack'),event('attack','walk','move'),completed('attack','idle'),
] });
function publisher(f, body) {
  return `extends Node
var p
func _ready() -> void:
\tcall_deferred("_probe")
func _step(seconds: float, flush: bool = true) -> void:
\tvar host = get_tree().root.get_node("VientoProject")
\thost.elapsed_seconds += seconds
\thost.total_seconds += seconds
\thost.current.project_step(seconds)
\tif flush:
\t\thost.flush_requests()
func _probe() -> void:
\tp = get_meta("viento_project")
\tvar host = get_tree().root.get_node("VientoProject")
\thost.set_process(false)
\thost.flush_requests()
\tvar receiver = get_parent().get_node("behavior_${f.bindingId.replaceAll('-','_')}")
${body}
\thost.finish_project()
`;
}
async function author(t, { table = DEFAULT_ANIMATION_STATE_TABLE, sprites = true, parameters, body = '' } = {}) {
  const f = await projectAnimationClipsAuthor(t, { sprites });
  const publisherId = '61616161-6161-4161-8161-000000000001', publisherBindingId = '61616161-6161-4161-8161-000000000002';
  const walkId = '61616161-6161-4161-8161-000000000003';
  await f.edit('documents/animations/scene-0.json', document => document.clips.push({ id:walkId, name:'Walking', startSeconds:0, endSeconds:.25, loop:true }));
  const config = parameters ? parameters(f, walkId) : table.states.length === 2
    ? { clip_idle:f.clipIds[0][0], clip_action:f.clipIds[0][1] }
    : { clip_idle:f.clipIds[0][0], clip_walk:walkId, clip_attack:f.clipIds[0][1] };
  await f.edit('documents/behaviors/demo.json', manifest => {
    manifest.bindings[0].parameters = config;
    manifest.bindings.push({ ...structuredClone(manifest.bindings[0]), bindingId:publisherBindingId,
      implementation:{...manifest.bindings[0].implementation,sourceObjectId:publisherId}, parameters:{} });
  });
  const record = await f.read(`metadata/documents/${f.scriptId}.json`);
  await f.write(`metadata/documents/${publisherId}.json`, {...record,id:publisherId,sourcePath:'documents/scripts/state-probe.txt'});
  await f.edit('metadata/documents/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee.json', metadata => metadata.relations.push({kind:'reference',targetId:publisherId,slot:'implementation'}));
  const generated = generateGodotAnimationStateScript(table);
  await f.script('checkpoint', generated.content);
  await f.script('state-probe', publisher(f, typeof body === 'function' ? body(f,walkId) : body));
  return {...f,publisherId,publisherBindingId,walkId,generated};
}
async function build(t, options, edit) {
  const f = await author(t, options); if(edit) await edit(f);
  const output = path.join(f.temporary,'state-build');
  const built = await buildProject({root:f.author,targetId:f.assemblyId,tool,output});
  assert.equal(built.ok,true,JSON.stringify(built.diagnostics || built.record?.diagnostics));
  return {...f,output};
}
const run = f => runProjectBuild({buildDirectory:f.output,tool,headless:true,smoke:false});

test('trusted defaults import without core initialization and exactly match public validated generation', async () => {
  const generated = generateGodotAnimationStateScript(DEFAULT_ANIMATION_STATE_TABLE);
  assert.equal(generated.content,DEFAULT_GODOT_ANIMATION_STATE_SCRIPT);
  assert.deepEqual(generated.parameters,[{stateKey:'idle',name:'clip_idle',defaultValue:''},{stateKey:'action',name:'clip_action',defaultValue:''}]);
  assert.ok(Object.isFrozen(generated) && Object.isFrozen(generated.parameters[0]) && Object.isFrozen(DEFAULT_ANIMATION_STATE_TABLE.transitions[0].trigger));
  const script = `import assert from 'node:assert/strict';import {getStudioCoreMetadata} from ${JSON.stringify(new URL('../../engine/studio-core.mjs',import.meta.url).href)};import {DEFAULT_GODOT_ANIMATION_STATE_SCRIPT} from ${JSON.stringify(new URL('../../engine/godot-animation-state-script.mjs',import.meta.url).href)};assert.equal(getStudioCoreMetadata().ready,false);assert.ok(DEFAULT_GODOT_ANIMATION_STATE_SCRIPT.startsWith('extends Node'));`;
  await execFileAsync(process.execPath,['--input-type=module','-e',script]);
});

test('unsafe event text is rejected by the core before source generation', () => {
  for (const name of ['x";print(1)','line\nbreak','slash\\quote','空白','constructor','prototype','bad\u0000name']) {
    const table=structuredClone(DEFAULT_ANIMATION_STATE_TABLE);table.transitions[0].trigger.name=name;
    assert.throws(()=>generateGodotAnimationStateScript(table));
  }
});

for (const sprites of [false,true]) test(`real state controller selects idle, ignores unknown events, runs action and completes back to idle (${sprites})`, real, async t => {
  const f=await build(t,{sprites,body:`\tp.publish_event("unknown", true)
\tp.publish_event("action", "ignored payload")
\thost.flush_requests()
\t_step(0.25)
\tprint("MID:" + JSON.stringify([receiver._state,host.current.animation_time,host.current.animation_visuals["${'INSTANCE'}"].position.x]))
\t_step(0.25)
\tprint("END:" + JSON.stringify([receiver._state,host.current.project_animation_position,host.current.animation_time]))`},async f=> {
    const text=await fs.readFile(path.join(f.author,'documents/scripts/state-probe.txt'),'utf8'); await f.script('state-probe',text.replace('INSTANCE',f.instanceId));
  });
  const result=await run(f);passed(result);
  assert.deepEqual(selections(result),[f.clipIds[0][0],f.clipIds[0][1],f.clipIds[0][0]]);
  assert.deepEqual(printed(result,'MID:'),[[1,.75,75]]);assert.deepEqual(printed(result,'END:'),[[0,0,.25]]);
  assert.deepEqual(rows(result,'event-publish').map(row=>row.recipients.length),[0,1]);
  assert.deepEqual(rows(result,'animation-completion-delivery').map(row=>row.status),['handled']);
  assert.ok(commands(result).every(row=>row.bindingId===f.bindingId));
  assert.ok(rows(result,'event-publish').every(row=>row.bindingId===f.publisherBindingId));
  assert.equal(result.record.events[0].protocol,7);
});

test('real FIFO event transitions, unmatched duplicate inputs and explicit self edges have distinct behavior', real, async t => {
  const f=await build(t,{table:movementTable(),body:`\tp.publish_event("move", false)
\tp.publish_event("move", 12)
\tp.publish_event("attack", 0.25)
\thost.flush_requests()
\t_step(0.25)
\tp.publish_event("attack", "restart")
\thost.flush_requests()
\tprint("RESTART:" + JSON.stringify([receiver._state,host.current.project_animation_position]))
\t_step(0.5)`});
  const result=await run(f);passed(result);
  assert.deepEqual(selections(result),[f.clipIds[0][0],f.walkId,f.clipIds[0][1],f.clipIds[0][1],f.clipIds[0][0]]);
  assert.deepEqual(printed(result,'RESTART:'),[[2,0]]);
  assert.equal(rows(result,'animation-completed').length,1);
  assert.deepEqual(rows(result,'event-delivery').map(row=>row.status),['handled','handled','handled','handled']);
});

test('real same-safe-point movement supersedes an already captured attack completion', real, async t => {
  const f=await build(t,{table:movementTable(),body:`\tp.publish_event("attack",true)
\thost.flush_requests()
\t_step(0.5,false)
\tp.publish_event("move",false)
\thost.flush_requests()
\tprint("RACE:" + JSON.stringify([receiver._state,host.current.project_animation_clip]))`});
  const result=await run(f);passed(result);
  assert.deepEqual(selections(result),[f.clipIds[0][0],f.clipIds[0][1],f.walkId]);
  assert.deepEqual(rows(result,'animation-completion-delivery').map(row=>row.status),['skipped']);
  assert.deepEqual(printed(result,'RACE:'),[[1,f.walkId]]);
});

test('real captured clip parameters survive later script mutation and preserve completion matching', real, async t => {
  const f=await build(t,{body:`\treceiver.clip_action = "not-a-uuid"
\tp.publish_event("action",true)
\thost.flush_requests()
\treceiver.clip_idle = "different"
\t_step(0.5)
\tp.publish_event("action",false)
\thost.flush_requests()`});
  const result=await run(f);passed(result);
  assert.deepEqual(selections(result),[f.clipIds[0][0],f.clipIds[0][1],f.clipIds[0][0],f.clipIds[0][1]]);
});

test('real bound event callback keeps dotted and hyphenated names exact with a publisher declared first', real, async t => {
  const table=structuredClone(DEFAULT_ANIMATION_STATE_TABLE);table.transitions[0].trigger.name='Action.test-01';
  const f=await build(t,{table,body:'\tp.publish_event("Action.test-01",true)\n\thost.flush_requests()'},f=>f.edit('documents/behaviors/demo.json',manifest=>manifest.bindings.reverse()));
  const result=await run(f);passed(result);
  assert.deepEqual(selections(result),[f.clipIds[0][0],f.clipIds[0][1]]);
  assert.equal(rows(result,'event-publish')[0].name,'Action.test-01');
  assert.deepEqual(rows(result,'event-delivery').map(row=>row.status),['handled']);
});

test('real exit revokes both subscriptions including captured pending deliveries', real, async t => {
  const f=await build(t,{body:`\tp.publish_event("action",true)
\thost.flush_requests()
\t_step(0.5,false)
\tp.publish_event("action",true)
\treceiver.free()
\tp.publish_event("action",false)
\thost.flush_requests()`});
  const result=await run(f);passed(result);
  assert.deepEqual(selections(result),[f.clipIds[0][0],f.clipIds[0][1]]);
  assert.deepEqual(rows(result,'event-publish').map(row=>row.recipients.length),[1,1,0]);
  assert.deepEqual(rows(result,'event-delivery').map(row=>row.status),['handled','skipped']);
  assert.deepEqual(rows(result,'animation-completion-delivery').map(row=>row.status),['skipped']);
});

test('real scene reentry starts a fresh controller and cannot retain old subscriptions', real, async t => {
  const f=await build(t,{body:f=>`\tif p.read_state("returned") == null:
\t\tp.publish_event("action",true)
\t\thost.flush_requests()
\t\t_step(0.5,false)
\t\tp.request_scene("${f.sceneIds[1]}")
\t\thost.flush_requests()
\t\treturn
\tp.publish_event("action",true)
\thost.flush_requests()
\t_step(0.5)`},f=>f.script('second',`extends Node
func _ready() -> void:
\tvar p=get_meta("viento_project")
\tp.publish_event("action",true)
\tp.write_state("returned",true)
\tp.request_scene("${f.sceneIds[0]}")
`));
  const result=await run(f);passed(result);
  assert.deepEqual(rows(result,'scene-enter').map(row=>row.sceneId),[f.sceneIds[0],f.sceneIds[1],f.sceneIds[0]]);
  assert.deepEqual(rows(result,'event-publish').map(row=>[row.visitIndex,row.recipients.length]),[[1,1],[2,0],[3,1]]);
  assert.deepEqual(rows(result,'animation-completion-delivery').map(row=>[row.visitIndex,row.status]),[[1,'skipped'],[3,'handled']]);
});

test('real syntactically valid unknown clip is rejected by the runtime with controller source ownership', real, async t => {
  const f=await build(t,{parameters:f=>({clip_idle:f.clipIds[0][0],clip_action:'61616161-6161-4161-8161-000000000099'}),body:'\tp.publish_event("action",true)\n\thost.flush_requests()'});
  const result=await run(f);assert.equal(result.ok,false);
  assert.ok(result.record.diagnostics.some(row=>row.code==='runtime_behavior_animation_clip'&&row.bindingId===f.bindingId&&row.sourcePath==='documents/behaviors/demo.json'),JSON.stringify(result.record.diagnostics));
  assert.deepEqual(selections(result),[f.clipIds[0][0]]);
});

test('real standalone scene safely leaves its ordinary automatic animation untouched', real, async t => {
  const f=await author(t);await f.script('state-probe','extends Node\n');
  const output=path.join(f.temporary,'standalone'),built=await buildProject({root:f.author,scene:f.sceneIds[0],tool,output});
  assert.equal(built.ok,true,JSON.stringify(built.diagnostics||built.record?.diagnostics));
  const result=await runProjectBuild({buildDirectory:output,tool,headless:true,smoke:true});passed(result);
  assert.equal(commands(result).length,0);assert.equal(rows(result,'event-publish').length,0);
});

for(const count of [32,33]) test(`real ${count} explicit self edges inherit the bounded command queue after initial entry`, real, async t=>{
  const table={initialState:'idle',states:[{key:'idle'}],transitions:[event('idle','idle','again')]};
  const f=await build(t,{table,parameters:f=>({clip_idle:f.clipIds[0][0]}),body:`\tfor i in range(${count}):\n\t\tp.publish_event("again",i)\n\thost.flush_requests()`});
  const result=await run(f);
  if(count===32){passed(result);assert.equal(commands(result).length,66);}
  else {assert.equal(result.ok,false);assert.ok(result.record.diagnostics.some(row=>row.code==='runtime_behavior_animation_limit'));assert.equal(commands(result).length,2);}
});

test('state-controller ZIP runs elsewhere with exact source receipts after the author and build are removed',real,async t=>{
  const f=await build(t,{body:'\tp.publish_event("action",true)\n\thost.flush_requests()\n\t_step(0.5)'});
  const inspect=()=>inspectBackendProject({buildDirectory:f.output});
  const delivery=await planBackendProjectDelivery({inspection:await inspect(),assertCurrent:inspect});
  const zip=path.join(f.temporary,'controller.zip');await writeExportZip(delivery,zip);assert.ok((await verifyBackendProjectDelivery(zip)).fileCount>0);
  const moved=path.join(f.temporary,'moved'),archive=await yauzl.openPromise(zip,{lazyEntries:true,autoClose:false});
  try{for await(const entry of archive.eachEntry()){const chunks=[];for await(const chunk of await archive.openReadStreamPromise(entry))chunks.push(chunk);const file=path.join(moved,entry.fileName);await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,Buffer.concat(chunks));}}
  finally{await new Promise(resolve=>{archive.reader.once('close',resolve);archive.close();});}
  const snapshot=JSON.parse(await fs.readFile(path.join(f.output,'snapshot.json')));
  await fs.rm(f.author,{recursive:true});await fs.rm(f.output,{recursive:true});
  const directory=path.join(moved,'project'),identified=await adapter.identify(tool);
  for(const phase of [...adapter.buildPhases,'run']){
    const result=await adapter.executePhase({phase,directory,tool:identified,smoke:false,timeoutMs:60000});
    assert.equal(result.status,'succeeded',result.stdout+result.stderr);assert.deepEqual(adapter.diagnostics(result,snapshot.plan),[],result.stdout+result.stderr);
    if(phase==='run'){const reader=adapter.createEventReader(snapshot.plan);reader.push(result.stdout);assert.deepEqual(reader.finish().diagnostics,[],result.stdout+result.stderr);
      assert.equal(reader.events.filter(row=>row.event==='animation-command').length,6);assert.ok(reader.events.filter(row=>row.event==='animation-command').every(row=>row.bindingId===f.bindingId));}
  }
});

test('real generated source validates all parameters and ports before startup and fail-stops partial admission',real,async t=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'viento-state-ports-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  await fs.writeFile(path.join(directory,'project.godot'),'config_version=5\n[application]\nconfig/name="State controller lifecycle"\n');
  await fs.writeFile(path.join(directory,'controller.gd'),DEFAULT_GODOT_ANIMATION_STATE_SCRIPT);
  const methods={
    subscribe_event:'func subscribe_event(name, value):\n\tcalls.append(["event",name])\n\tevent_callback=value\n\treturn 0 if fail_event else 1\n',
    unsubscribe_event:'func unsubscribe_event(token):\n\tcalls.append(["unsub_event",token])\n\treturn true\n',
    subscribe_animation_completed:'func subscribe_animation_completed(value):\n\tcalls.append("completed")\n\tcompletion_callback=value\n\treturn 0 if fail_completion else 1\n',
    unsubscribe_animation_completed:'func unsubscribe_animation_completed(token):\n\tcalls.append(["unsub_completed",token])\n\treturn true\n',
    select_animation_clip:'func select_animation_clip(value):\n\tcalls.append(["select",value])\n\treturn not fail_select\n',
    play_animation:'func play_animation():\n\tcalls.append("play")\n\treturn not fail_play\n',
  };
  const fields='var calls=[]\nvar event_callback\nvar completion_callback\nvar fail_event=false\nvar fail_completion=false\nvar fail_select=false\nvar fail_play=false\n';
  for(const excluded of [...Object.keys(methods),'none'])await fs.writeFile(path.join(directory,excluded+'.gd'),'extends RefCounted\n'+fields+Object.entries(methods).filter(([name])=>name!==excluded).map(([,source])=>source).join(''));
  await fs.writeFile(path.join(directory,'object.gd'),'extends Object\n'+fields+Object.values(methods).join(''));
  await fs.writeFile(path.join(directory,'probe.gd'),`extends SceneTree
func _initialize() -> void:
\tcall_deferred("_probe")
func _probe() -> void:
\tvar source=load("res://controller.gd")
\tfor method in ${JSON.stringify(Object.keys(methods))}:
\t\tvar port=load("res://"+method+".gd").new()
\t\tvar node=source.new()
\t\tnode.set_meta("viento_project",port)
\t\troot.add_child(node)
\t\tnode.free()
\t\tprint("MISSING:"+JSON.stringify(port.calls))
\tfor value in [null,true,1,"old",{}]:
\t\tvar node=source.new()
\t\tif value!=null:
\t\t\tnode.set_meta("viento_project",value)
\t\troot.add_child(node)
\t\tnode.free()
\tvar dead=Object.new()
\tvar stale=source.new()
\tstale.set_meta("viento_project",dead)
\tdead.free()
\troot.add_child(stale)
\tstale.free()
\tvar freed=load("res://object.gd").new()
\tvar receiver=source.new()
\treceiver.set_meta("viento_project",freed)
\troot.add_child(receiver)
\tfreed.free()
\tprint("FREED:"+JSON.stringify(receiver._on_completed(null)))
\treceiver.free()
\tfor value in ["bad","61616161-6161-4161-8161-000000000099\\n","61616161-6161-4161-8161-00000000009A"]:
\t\tvar port=load("res://none.gd").new()
\t\tvar node=source.new()
\t\tnode.clip_action=value
\t\tnode.set_meta("viento_project",port)
\t\troot.add_child(node)
\t\tnode.free()
\t\tprint("INVALID:"+JSON.stringify(port.calls))
\tfor failure in ["fail_event","fail_completion","fail_select","fail_play","none"]:
\t\tvar port=load("res://none.gd").new()
\t\tif failure!="none":
\t\t\tport.set(failure,true)
\t\tvar node=source.new()
\t\tnode.set_meta("viento_project",port)
\t\troot.add_child(node)
\t\tprint("LOGICAL:"+JSON.stringify([failure,node._state,node._active]))
\t\tif failure=="none":
\t\t\tprint("ARITY:"+JSON.stringify(port.event_callback.get_argument_count()))
\t\t\tprint("MISMATCH:"+JSON.stringify(port.completion_callback.call("different")))
\t\t\tport.event_callback.call(42)
\t\t\tport.completion_callback.call(null)
\t\tnode.free()
\t\tprint("CALLS:"+JSON.stringify([failure,port.calls]))
\tquit()
`);
  const result=await execFileAsync(tool,['--headless','--path',directory,'--script','res://probe.gd'],{timeout:30000,maxBuffer:1024*1024});
  assert.equal(/SCRIPT ERROR|Parse Error/.test(result.stderr),false,result.stderr);
  const output=prefix=>result.stdout.split('\n').filter(line=>line.startsWith(prefix)).map(line=>JSON.parse(line.slice(prefix.length)));
  assert.deepEqual(output('MISSING:'),Array.from({length:6},()=>[]));assert.deepEqual(output('INVALID:'),[[],[],[]]);assert.deepEqual(output('FREED:'),[false]);
  assert.deepEqual(output('LOGICAL:'),[['fail_event',-1,false],['fail_completion',-1,false],['fail_select',-1,false],['fail_play',-1,false],['none',0,true]]);
  const subscribe=[['event','action'],'completed'],unsubscribe=[['unsub_event',1],['unsub_completed',1]];
  assert.deepEqual(output('CALLS:'),[
    ['fail_event',[['event','action']]],['fail_completion',[['event','action'],'completed',['unsub_event',1]]],
    ['fail_select',[...subscribe,['select',null],...unsubscribe]],['fail_play',[...subscribe,['select',null],'play',...unsubscribe]],
    ['none',[...subscribe,...Array.from({length:3},()=>[['select',null],'play']).flat(),...unsubscribe]],
  ]);
  assert.deepEqual(output('ARITY:'),[1]);assert.deepEqual(output('MISMATCH:'),[true]);
});
