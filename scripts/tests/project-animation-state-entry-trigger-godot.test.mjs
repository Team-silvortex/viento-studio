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
const tool=process.env.VIENTO_GODOT_BIN,real={skip:!tool?'Set VIENTO_GODOT_BIN for real entry trigger observations':false,timeout:120000};
const xdg=await fs.mkdtemp(path.join(os.tmpdir(),'viento-entry-trigger-xdg-'));
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
async function stage(f){const directory=path.join(f.temporary,'generated');for(const[name,bytes]of [...f.generated.files,...[...f.generated.resourceFiles].map(([id,name])=>[name,f.captured.resources.get(id)])]){const file=path.join(directory,name);await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,bytes);}return directory;}


const entries = result => result.record.runtime.project.animationStateEntries.entries;
const triggerRows = result => entries(result).map(row => row.trigger);
const tableFor = version => {
  const table = structuredClone(DEFAULT_ANIMATION_STATE_TABLE);
  if (version >= 2) table.transitions[0].trigger.condition = { type: 'boolean', operator: 'eq', value: true };
  if (version === 3) table.eventSelection = 'firstMatch';
  if (version === 4) table.transitions[0].trigger.condition.selector = { kind: 'projectState', key: 'combat.enabled' };
  if (version === 5) table.transitions[0].trigger.condition = { combine: 'all', conditions: [
    { type: 'boolean', operator: 'eq', value: true },
    { type: 'boolean', operator: 'eq', value: true, selector: { kind: 'projectState', key: 'combat.enabled' } },
  ] };
  return table;
};

test('protocol10 declares trigger capability and inventory11 without changing recognized author bytes', async t => {
  const f = await fixture(t), inventory = JSON.parse(f.generated.files.get('assembly.json'));
  assert.equal(f.generated.backend.protocolVersion, 10); assert.equal(f.generated.backend.version, '0.32.0');
  assert.equal(inventory.schemaVersion, 11); assert.ok(f.generated.backend.capabilities.includes('project.animation-state-entry-triggers'));
  assert.equal(f.generated.files.get(`behaviors/${f.scriptId}.gd`).toString(), f.content);
  assert.ok(f.generated.files.has('project-animation-state-trigger-runtime.gd'));
  const limited = { ...adapter, descriptor: { ...adapter.descriptor,
    capabilities: adapter.descriptor.capabilities.filter(value => value !== 'project.animation-state-entry-triggers') } };
  assert.throws(() => validateGeneratedExecutionProject(limited, f.captured.plan, f.generated));
  const directory = await stage(f);
  assert.ok((await godotAssemblyScripts(directory)).includes('project-animation-state-trigger-runtime.gd'));
  inventory.schemaVersion = 10;
  await fs.writeFile(path.join(directory, 'assembly.json'), JSON.stringify(inventory));
  assert.ok(!(await godotAssemblyScripts(directory)).includes('project-animation-state-trigger-runtime.gd'));
});

for (const version of [1, 2, 3, 4, 5]) test(`real v${version} preserves initial, event, completion and direct entry identity`, real, async t => {
  const f = await build(t, { table: tableFor(version), body: '\tp.write_state("combat.enabled",true)\n\tp.publish_event("action",true)\n\thost.flush_requests()\n\thost.elapsed_seconds+=0.5\n\thost.total_seconds+=0.5\n\thost.current.project_step(0.5)\n\thost.flush_requests()\n\treceiver._enter_state(1)\n\thost.flush_requests()' });
  const result = await run(f); passed(result);
  assert.deepEqual(entries(result).map(row => row.stateKey), ['idle', 'action', 'idle', 'action']);
  assert.deepEqual(triggerRows(result), [{ kind: 'initial' }, { kind: 'event', eventSequence: 1, subscriptionId: 1 },
    { kind: 'completed', completionSequence: 1, subscriptionId: 1 }, { kind: 'direct' }]);
  const frames = result.record.events, entryFrames = frames.filter(row => row.event === 'animation-state-entered');
  const before = (first, second) => assert.ok(frames.indexOf(first) < frames.indexOf(second));
  before(frames.find(row => row.event === 'event-publish'), entryFrames[1]);
  before(entryFrames[1], frames.find(row => row.event === 'event-delivery'));
  before(frames.find(row => row.event === 'animation-completed'), entryFrames[2]);
  before(entryFrames[2], frames.find(row => row.event === 'animation-completion-delivery'));
  assert.equal(result.record.runtime.project.events.entries[0].deliveries[0].status, 'handled');
  assert.equal(result.record.runtime.project.animationCompletions.entries[0].deliveries[0].status, 'handled');
});

test('real direct callback calls from another dispatched binding cannot borrow its event or completion identity', real, async t => {
  const f = await build(t, { edit: async f => f.script('second', `extends Node
func _ready() -> void:
	get_meta("viento_project").subscribe_event("relay", _relay)
	call_deferred("_probe")
func _relay(_value) -> bool:
	var receiver=get_parent().get_node("behavior_${f.bindingId.replaceAll('-', '_')}")
	return receiver._on_event(true, "action")
func _probe() -> void:
	var host=get_tree().root.get_node("VientoProject")
	host.set_process(false)
	host.flush_requests()
	var p=get_meta("viento_project")
	var receiver=get_parent().get_node("behavior_${f.bindingId.replaceAll('-', '_')}")
	p.publish_event("relay",true)
	host.flush_requests()
	receiver._on_completed(receiver._selected_clip)
	host.flush_requests()
	p.publish_event("action",true)
	host.flush_requests()
	host.elapsed_seconds+=0.5
	host.total_seconds+=0.5
	host.current.project_step(0.5)
	host.flush_requests()
	host.finish_project()
`) });
  const result = await run(f); passed(result);
  assert.deepEqual(triggerRows(result), [{ kind: 'initial' }, { kind: 'direct' }, { kind: 'direct' },
    { kind: 'event', eventSequence: 2, subscriptionId: 1 }, { kind: 'completed', completionSequence: 1, subscriptionId: 1 }]);
});

test('real a manual second ready invocation is direct rather than another initialization', real, async t => {
  const f = await build(t, { body: '\treceiver._ready()\n\thost.flush_requests()' }), result = await run(f); passed(result);
  assert.deepEqual(triggerRows(result), [{ kind: 'initial' }, { kind: 'direct' }]);
});

test('real same-frame self transitions bind each accepted entry to its own message and subscription', real, async t => {
  const table = { initialState: 'idle', states: [{ key: 'idle' }], transitions: [
    { from: 'idle', to: 'idle', trigger: { kind: 'event', name: 'action' } },
    { from: 'idle', to: 'idle', trigger: { kind: 'event', name: 'again' } },
  ] };
  const f = await build(t, { table, body: '\tp.publish_event("action",1)\n\tp.publish_event("again",2)\n\tp.publish_event("action",3)\n\thost.flush_requests()' }), result = await run(f); passed(result);
  assert.deepEqual(triggerRows(result), [{ kind: 'initial' }, { kind: 'event', eventSequence: 1, subscriptionId: 1 },
    { kind: 'event', eventSequence: 2, subscriptionId: 2 }, { kind: 'event', eventSequence: 3, subscriptionId: 1 }]);
  assert.ok(entries(result).every(row => row.timeSeconds === 0 && row.stateKey === 'idle'));
});

test('real nonmatching all group has no entry and its later matching event keeps its own identity', real, async t => {
  const table = tableFor(5), f = await build(t, { table, body: '\tp.write_state("combat.enabled",false)\n\tp.publish_event("action",true)\n\thost.flush_requests()\n\tp.write_state("combat.enabled",true)\n\tp.publish_event("action",true)\n\thost.flush_requests()' });
  const result = await run(f); passed(result);
  assert.deepEqual(triggerRows(result), [{ kind: 'initial' }, { kind: 'event', eventSequence: 2, subscriptionId: 1 }]);
});

test('real accepted event entry remains attributable when a preceding queued command fails before its execution', real, async t => {
  const f = await build(t, { body: '\tp.seek_animation(0.9)\n\tp.publish_event("action",true)\n\thost.flush_requests()' }), result = await run(f);
  assert.equal(result.ok, false); assert.ok(result.record.diagnostics.some(row => row.code === 'runtime_behavior_animation_command'));
  assert.deepEqual(triggerRows(result), [{ kind: 'initial' }, { kind: 'event', eventSequence: 1, subscriptionId: 1 }]);
  assert.equal(result.record.runtime.project.animationCommands.sequence, 2);
});

test('real rejected play has no successful event entry and retains the original accepted initialization', real, async t => {
  const f = await build(t, { body: '\thost.animation_control.reserved_count=255\n\tp.publish_event("action",true)\n\thost.flush_requests()' }), result = await run(f);
  assert.equal(result.ok, false); assert.ok(result.record.diagnostics.some(row => row.code === 'runtime_behavior_animation_limit'));
  assert.deepEqual(triggerRows(result), [{ kind: 'initial' }]);
});

test('real p9 runtime and wrapper remain runnable with their strict previous wire fields', real, async t => {
  const f = await fixture(t, { body: '\tp.publish_event("action",true)\n\thost.flush_requests()' }), directory = await stage(f);
  const scene = (await fs.readFile(path.join(directory, 'project.tscn'), 'utf8')).replace('project-animation-state-trigger-runtime.gd', 'project-animation-state-entry-runtime.gd');
  await fs.writeFile(path.join(directory, 'project.tscn'), scene);
  const wrapper = (await fs.readFile(new URL('../backends/godot4/project-animation-state-entry-wrapper.gd', import.meta.url), 'utf8')).replace('__SCRIPT_OBJECT_ID__', f.scriptId);
  await fs.writeFile(path.join(directory, `animation-state-wrappers/${f.scriptId}.gd`), wrapper);
  const inventory = JSON.parse(await fs.readFile(path.join(directory, 'assembly.json'))); inventory.schemaVersion = 10;
  await fs.writeFile(path.join(directory, 'assembly.json'), JSON.stringify(inventory));
  await fs.rm(path.join(directory, 'project-animation-state-trigger-runtime.gd'));
  const identified = await adapter.identify(tool);
  for (const phase of [...adapter.buildPhases, 'run']) {
    const result = await adapter.executePhase({ phase, directory, tool: identified, smoke: false, timeoutMs: 60000 });
    assert.equal(result.status, 'succeeded', result.stdout + result.stderr);
    assert.deepEqual(adapter.diagnostics(result, f.captured.plan), [], result.stdout + result.stderr);
    if (phase === 'run') {
      const reader = adapter.createEventReader(f.captured.plan, { protocolVersion: 9 }); reader.push(result.stdout);
      assert.deepEqual(reader.finish().diagnostics, [], result.stdout + result.stderr);
      assert.equal(reader.events[0].protocol, 9); assert.equal(reader.animationStateEntries.sequence, 2);
      assert.ok(reader.animationStateEntries.entries.every(row => !Object.hasOwn(row, 'trigger')));
    }
  }
});
