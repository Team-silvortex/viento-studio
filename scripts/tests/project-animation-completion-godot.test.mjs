import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import yauzl from 'yauzl';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { listScriptStarters } from '../../engine/script-authoring.mjs';
const execFileAsync = promisify(execFile);
import { projectAnimationClipsAuthor } from './helpers/project-animation-clips-author-fixture.mjs';
import { projectAnimationControlAuthor } from './helpers/project-animation-control-author-fixture.mjs';
import { buildProject, runProjectBuild } from '../adapters/node-project-build.mjs';
import { GODOT4_EXECUTION_ADAPTER as adapter } from '../backends/godot4-adapter.mjs';
import { godotAssemblyScripts } from '../backends/godot4-project.mjs';
import { inspectBackendProject } from '../adapters/node-backend-project.mjs';
import { planBackendProjectDelivery, verifyBackendProjectDelivery } from '../adapters/node-backend-project-delivery.mjs';
import { writeExportZip } from '../lib/export-package.mjs';
const tool = process.env.VIENTO_GODOT_BIN;
const real = { skip: !tool ? 'Set VIENTO_GODOT_BIN for actual completion callbacks' : false, timeout: 90000 };
const rows = (r, event) => r.record.events.filter(row => row.event === event);
const output = (r, prefix) => r.record.phases.at(-1).stdout.split('\n').filter(line => line.startsWith(prefix)).map(line => JSON.parse(line.slice(prefix.length)));
const passed = r => assert.equal(r.ok, true, JSON.stringify(r.record?.diagnostics || r));
function probe({ setup = '', body = '', callback = 'return true', fields = '' } = {}) {
  return `extends Node
var p
var received: Array = []
${fields}
func _ready() -> void:
\tp = get_meta("viento_project")
\tp.subscribe_animation_completed(_completed)
${setup}
\tcall_deferred("_probe")
func _completed(clip_id) -> bool:
\treceived.append(clip_id)
\tprint("COMPLETED:" + JSON.stringify(clip_id))
${callback.split('\n').map(line => '\t'+line).join('\n')}
func _step(seconds: float, flush: bool = true) -> void:
\tvar host = get_tree().root.get_node("VientoProject")
\thost.elapsed_seconds += seconds
\thost.total_seconds += seconds
\thost.current.project_step(seconds)
\tif flush:
\t\thost.flush_requests()
func _probe() -> void:
\tvar host = get_tree().root.get_node("VientoProject")
\thost.set_process(false)
\thost.flush_requests()
${body}
\thost.finish_project()
`;
}
async function fixture(t, script, options = {}) {
  const f = options.legacy ? await projectAnimationControlAuthor(t, { sprites: options.sprites ?? true }) : await projectAnimationClipsAuthor(t, { sprites: options.sprites ?? true });
  if (script) await f.script('checkpoint', script(f));
  const directory = path.join(f.temporary, 'completion-build');
  const built = await buildProject({ root: f.author, targetId: f.assemblyId, tool, output: directory });
  assert.equal(built.ok, true, JSON.stringify(built.diagnostics || built.record?.diagnostics));
  return { ...f, output: directory };
}
const run = f => runProjectBuild({ buildDirectory: f.output, tool, headless: true, smoke: false });
const select = f => `\tp.select_animation_clip("${f.clipIds[0][1]}")\n\tp.play_animation()`;

for (const sprites of [false,true]) test(`real completion safely chains a nonloop clip into a loop with visual sampling (${sprites})`, real, async t => {
  const f = await fixture(t, f => probe({ setup: select(f),
    body: '\t_step(0.25)\n\t_step(0.25)\n\tprint("AFTER_CHAIN:" + JSON.stringify([host.current.project_animation_clip, host.current.project_animation_position, host.current.animation_time, host.current.animation_visuals["'+f.instanceId+'"].position.x]))',
    callback: `return p.select_animation_clip("${f.clipIds[0][0]}") and p.play_animation()` }), { sprites });
  const result = await run(f); passed(result);
  assert.equal(result.record.events[0].protocol, 7);
  const [done] = rows(result, 'animation-completed');
  assert.equal(done.commandSequence, 2); assert.equal(done.completionSequence, 1);
  assert.deepEqual(done.state, { sceneObjectId: f.sceneIds[0], clipId: f.clipIds[0][1], phase: 'finished', positionSeconds: .5, timeSeconds: .5 });
  assert.deepEqual(rows(result, 'animation-completion-delivery').map(row => row.status), ['handled']);
  assert.deepEqual(rows(result, 'animation-command').map(row => row.command.action), ['select','play','select','play']);
  assert.deepEqual(output(result, 'AFTER_CHAIN:'), [[f.clipIds[0][0],0,.25,25]]);
  assert.equal(result.record.events.at(-1).animationCompletionSequence, 1);
});

for (const sprites of [false,true]) test(`real old author format naturally completes the whole timeline with null payload (${sprites})`, real, async t => {
  const f = await fixture(t, () => probe({ body: '\t_step(1)\n\t_step(1)' }), { legacy: true, sprites });
  const result = await run(f); passed(result);
  assert.deepEqual(output(result, 'COMPLETED:'), [null]);
  assert.equal(rows(result, 'animation-completed')[0].commandSequence, 0);
  assert.equal(rows(result, 'animation-command').length, 0);
});

test('real looping, seek-to-end, pause, stop and selection do not manufacture natural completions', real, async t => {
  const f = await fixture(t, f => probe({ body: `\t_step(2)
\tp.select_animation_clip("${f.clipIds[0][1]}")
\tp.seek_animation(0.5)
\thost.flush_requests()
\t_step(2)
\tp.play_animation()
\tp.pause_animation()
\thost.flush_requests()
\t_step(2)
\tp.stop_animation()
\thost.flush_requests()
\t_step(2)
\tp.select_animation_clip(null)
\thost.flush_requests()
\t_step(2)` }));
  const result = await run(f); passed(result);
  assert.equal(rows(result, 'animation-completed').length, 0); assert.deepEqual(output(result, 'COMPLETED:'), []);
});

test('real replay rearms completion once and an unchanged endpoint never emits twice', real, async t => {
  const f = await fixture(t, f => probe({ setup: select(f), body: '\t_step(0.5)\n\t_step(0.25)\n\tp.play_animation()\n\thost.flush_requests()\n\t_step(0.5)\n\t_step(0.25)' }));
  const result = await run(f); passed(result);
  assert.deepEqual(rows(result, 'animation-completed').map(row => [row.completionSequence,row.commandSequence,row.state.timeSeconds]), [[1,2,.5],[2,3,1.25]]);
  assert.deepEqual(output(result, 'COMPLETED:'), [f.clipIds[0][1],f.clipIds[0][1]]);
});

for (const action of ['pause_animation()', 'stop_animation()', 'seek_animation(0.1)', 'select_animation_clip(null)', 'play_animation()']) test(`real subsequent ${action} cancels pending delivery without retiring the subscription`, real, async t => {
  const f = await fixture(t, f => probe({ setup: select(f), body: `\t_step(0.5, false)
\tp.${action}
\thost.flush_requests()
\tp.select_animation_clip("${f.clipIds[0][1]}")
\tp.play_animation()
\thost.flush_requests()
\t_step(0.5)` }));
  const result = await run(f); passed(result);
  assert.deepEqual(rows(result, 'animation-completion-delivery').map(row => row.status), ['skipped','handled']);
  assert.deepEqual(output(result, 'COMPLETED:'), [f.clipIds[0][1]]);
});

test('real command advancement records the preceding natural endpoint before cancelling its callback', real, async t => {
  const f = await fixture(t, f => probe({ setup: select(f), body: '\thost.elapsed_seconds += 0.5\n\thost.total_seconds += 0.5\n\tp.pause_animation()\n\thost.flush_requests()' }));
  const result = await run(f); passed(result);
  const relevant = result.record.events.filter(row => ['animation-completed','animation-command','animation-completion-delivery'].includes(row.event));
  assert.deepEqual(relevant.map(row => row.event), ['animation-command','animation-command','animation-completed','animation-command','animation-completion-delivery']);
  assert.equal(relevant[2].commandSequence, 2); assert.equal(relevant.at(-1).status, 'skipped');
});

test('real finish request cancels pending completion before closing the scene', real, async t => {
  const f = await fixture(t, f => probe({ setup: select(f), body: '\t_step(0.5, false)' }));
  const result = await run(f); passed(result);
  assert.deepEqual(rows(result, 'animation-completion-delivery').map(row => row.status), ['skipped']);
  assert.deepEqual(output(result, 'COMPLETED:'), []);
});

test('real unregistering a captured callback skips it and a fresh subscription handles the next play', real, async t => {
  const f = await fixture(t, f => probe({ setup: select(f), body: `\tvar token = p.subscribe_animation_completed(_completed)
\t_step(0.5, false)
\tprint("WITHDRAWN:" + JSON.stringify(p.unsubscribe_animation_completed(token)))
\thost.flush_requests()
\tp.subscribe_animation_completed(_completed)
\tp.play_animation()
\thost.flush_requests()
\t_step(0.5)` }));
  const result = await run(f); passed(result);
  assert.deepEqual(rows(result, 'animation-completion-delivery').map(row => row.status), ['skipped','handled']);
  assert.deepEqual(output(result, 'WITHDRAWN:'), [true]);
  assert.deepEqual(rows(result, 'animation-completed').map(row => row.recipients[0].subscriptionId), [1,2]);
});

test('real callback failure retains the recipient source and stops the delivery queue', real, async t => {
  const f = await fixture(t, f => probe({ setup: select(f), body: '\t_step(0.5)', callback: 'return false' }));
  const result = await run(f);
  assert.equal(result.ok, false);
  assert.ok(result.record.diagnostics.some(row => row.code === 'runtime_behavior_animation_completion_callback' && row.bindingId === f.bindingId));
  assert.equal(rows(result, 'animation-completion-delivery').length, 0);
  assert.equal(rows(result, 'finished').length, 0);
});

test('completion project ZIP is runnable with source ownership after author/build deletion', real, async t => {
  const f = await fixture(t, f => probe({ setup: select(f), body: '\t_step(0.5)' }));
  const inspect = () => inspectBackendProject({ buildDirectory: f.output });
  const delivery = await planBackendProjectDelivery({ inspection: await inspect(), assertCurrent: inspect });
  const zip = path.join(f.temporary, 'completed.zip'); await writeExportZip(delivery, zip);
  assert.ok((await verifyBackendProjectDelivery(zip)).fileCount > 0);
  const moved = path.join(f.temporary, 'moved'), archive = await yauzl.openPromise(zip, { lazyEntries: true, autoClose: false });
  try { for await (const entry of archive.eachEntry()) {
    const chunks = []; for await (const chunk of await archive.openReadStreamPromise(entry)) chunks.push(chunk);
    const file = path.join(moved, entry.fileName); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, Buffer.concat(chunks));
  } } finally { await new Promise(resolve => { archive.reader.once('close', resolve); archive.close(); }); }
  const runtimeBackend = JSON.parse(await fs.readFile(path.join(f.output, 'build.json'))).backend;
  const snapshot = JSON.parse(await fs.readFile(path.join(f.output, 'snapshot.json')));
  await fs.rm(f.author, { recursive: true }); await fs.rm(f.output, { recursive: true });
  const directory = path.join(moved, 'project'), scripts = await godotAssemblyScripts(directory);
  assert.ok(scripts.includes('project-animation-completions.gd')); assert.ok(scripts.includes('project-completion-runtime.gd'));
  assert.equal(JSON.parse(await fs.readFile(path.join(directory, 'assembly.json'))).schemaVersion, 8);
  const identified = await adapter.identify(tool);
  for (const phase of [...adapter.buildPhases, 'run']) {
    const result = await adapter.executePhase({ phase, directory, tool: identified, smoke: false, timeoutMs: 60000 });
    assert.equal(result.status, 'succeeded', result.stdout + result.stderr);
    assert.deepEqual(adapter.diagnostics(result, snapshot.plan), [], result.stdout + result.stderr);
    if (phase === 'run') { const reader = adapter.createEventReader(snapshot.plan, { capabilities: runtimeBackend.capabilities }); reader.push(result.stdout);
      assert.deepEqual(reader.finish().diagnostics, [], result.stdout + result.stderr);
      assert.equal(reader.events.filter(row => row.event === 'animation-completed').length, 1);
    }
  }
});

test('real switching cancels old completion, revokes stale ports and reentry subscribes exactly once', real, async t => {
  const f = await projectAnimationClipsAuthor(t);
  await f.script('checkpoint', probe({ setup: select(f), body: `\tif p.read_state("returned") == null:
\t\t_step(0.5, false)
\t\thost.set_meta("old_port", p)
\t\tp.request_scene("${f.sceneIds[1]}")
\t\thost.flush_requests()
\t\treturn
\tprint("STALE_COMPLETION:" + JSON.stringify(host.get_meta("old_port").unsubscribe_animation_completed(1)))
\t_step(0.5)` }));
  await f.script('second', `extends Node\nfunc _ready() -> void:\n\tvar p = get_meta("viento_project")\n\tp.write_state("returned", true)\n\tp.request_scene("${f.sceneIds[0]}")\n`);
  const directory = path.join(f.temporary, 'roundtrip'), built = await buildProject({ root: f.author, targetId: f.assemblyId, tool, output: directory });
  assert.equal(built.ok, true, JSON.stringify(built.record?.diagnostics || built));
  const result = await run({ output: directory }); passed(result);
  assert.deepEqual(rows(result, 'scene-enter').map(row => row.sceneId), [f.sceneIds[0],f.sceneIds[1],f.sceneIds[0]]);
  assert.deepEqual(rows(result, 'animation-completion-delivery').map(row => [row.visitIndex,row.status]), [[1,'skipped'],[3,'handled']]);
  assert.deepEqual(output(result, 'STALE_COMPLETION:'), [false]);
  assert.equal(output(result, 'COMPLETED:').length, 1);
});

test('real freed recipient is skipped while another completion subscriber remains callable', real, async t => {
  const f = await projectAnimationClipsAuthor(t);
  await f.edit('documents/behaviors/demo.json', manifest => manifest.bindings.push({ ...structuredClone(manifest.bindings[0]), bindingId: f.secondBindingId, implementation: { ...manifest.bindings[0].implementation, sourceObjectId: f.secondScriptId } }));
  await f.edit('metadata/documents/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee.json', metadata => metadata.relations.push({ kind: 'reference', targetId: f.secondScriptId, slot: 'implementation' }));
  await f.script('second', 'extends Node\nfunc _ready() -> void:\n\tget_meta("viento_project").subscribe_animation_completed(_done)\nfunc _done(_clip) -> bool:\n\tprint("DEAD_CALLBACK")\n\treturn true\n');
  await f.script('checkpoint', probe({ setup: select(f), body: `\t_step(0.5, false)
\tget_parent().get_node("behavior_${f.secondBindingId.replaceAll('-','_')}").free()
\thost.flush_requests()` }));
  const directory = path.join(f.temporary, 'freed'), built = await buildProject({ root: f.author, targetId: f.assemblyId, tool, output: directory });
  assert.equal(built.ok, true, JSON.stringify(built.record?.diagnostics || built));
  const result = await run({ output: directory }); passed(result);
  assert.deepEqual(rows(result, 'animation-completion-delivery').map(row => row.status), ['handled','skipped']);
  assert.equal(result.record.phases.at(-1).stdout.includes('DEAD_CALLBACK'), false);
});

test('real completion starter guards absent, invalid and freed ports and preserves select failure', real, async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-completion-starter-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const starter = listScriptStarters().find(row => row.id === 'godot-project-animation-completion');
  await fs.writeFile(path.join(directory, 'project.godot'), 'config_version=5\n[application]\nconfig/name="Completion starter lifecycle"\n');
  await fs.writeFile(path.join(directory, 'starter.gd'), starter.content);
  const methods = {
    subscribe_animation_completed: 'func subscribe_animation_completed(value):\n\tcallback = value\n\tcalls.append("subscribe")\n\treturn 1\n',
    unsubscribe_animation_completed: 'func unsubscribe_animation_completed(_id):\n\tcalls.append("unsubscribe")\n\treturn true\n',
    select_animation_clip: 'func select_animation_clip(id):\n\tcalls.append(["select",id])\n\treturn accepted\n',
    play_animation: 'func play_animation():\n\tcalls.append("play")\n\treturn true\n',
  };
  for (const excluded of [...Object.keys(methods),'none']) await fs.writeFile(path.join(directory, `${excluded}.gd`), 'extends RefCounted\nvar callback\nvar calls = []\nvar accepted = true\n' + Object.entries(methods).filter(([key]) => key !== excluded).map(([,value]) => value).join(''));
  await fs.writeFile(path.join(directory, 'object.gd'), 'extends Object\nvar callback\nvar calls = []\nvar accepted = true\n' + Object.values(methods).join(''));
  await fs.writeFile(path.join(directory, 'probe.gd'), `extends SceneTree
func _initialize() -> void:
\tcall_deferred("_probe")
func _probe() -> void:
\tvar starter = load("res://starter.gd")
\tfor name in ["subscribe_animation_completed","unsubscribe_animation_completed","select_animation_clip","play_animation"]:
\t\tvar port = load("res://" + name + ".gd").new()
\t\tvar node = starter.new()
\t\tnode.set_meta("viento_project",port)
\t\troot.add_child(node)
\t\tnode.free()
\t\tprint("GUARD:" + JSON.stringify(port.calls))
\tfor value in [null,true,1,"old",{}]:
\t\tvar node = starter.new()
\t\tif value != null:
\t\t\tnode.set_meta("viento_project",value)
\t\troot.add_child(node)
\t\tnode.free()
\tvar dead = Object.new()
\tvar stale = starter.new()
\tstale.set_meta("viento_project",dead)
\tdead.free()
\troot.add_child(stale)
\tstale.free()
\tvar freed = load("res://object.gd").new()
\tvar receiver = starter.new()
\treceiver.set_meta("viento_project",freed)
\troot.add_child(receiver)
\tfreed.free()
\tprint("FREED:" + JSON.stringify(receiver._on_animation_completed(null)))
\treceiver.free()
\tfor accepted in [false,true]:
\t\tvar port = load("res://none.gd").new()
\t\tport.accepted = accepted
\t\tvar node = starter.new()
\t\tnode.set_meta("viento_project",port)
\t\troot.add_child(node)
\t\tprint("MISMATCH:" + JSON.stringify(port.callback.call("different")))
\t\tprint("MATCH:" + JSON.stringify(port.callback.call(null)))
\t\tnode.free()
\t\tprint("CALLS:" + JSON.stringify(port.calls))
\tquit()
`);
  const result = await execFileAsync(tool, ['--headless','--path',directory,'--script','res://probe.gd'], { timeout:30000,maxBuffer:1024*1024 });
  assert.equal(/SCRIPT ERROR|Parse Error/.test(result.stderr), false, result.stderr);
  const printed = prefix => result.stdout.split('\n').filter(line => line.startsWith(prefix)).map(line => JSON.parse(line.slice(prefix.length)));
  assert.deepEqual(printed('GUARD:'), [[],[],[],[]]); assert.deepEqual(printed('FREED:'), [false]);
  assert.deepEqual(printed('MISMATCH:'), [true,true]); assert.deepEqual(printed('MATCH:'), [false,true]);
  assert.deepEqual(printed('CALLS:'), [['subscribe',['select',null],'unsubscribe'],['subscribe',['select',null],'play','unsubscribe']]);
});

test('generated inventory accepts historical schemas 5/6/7 and explicitly requires completion scripts only for 8', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-completion-inventory-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const sceneId = '11111111-1111-4111-8111-111111111111', assemblyId = '22222222-2222-4222-8222-222222222222';
  await fs.mkdir(path.join(directory,'scenes',sceneId), { recursive:true });
  for (const schemaVersion of [5,6,7,8]) {
    const scripts = ['project-runtime.gd','project-events.gd','project-audio.gd',...(schemaVersion>=6?['project-control-runtime.gd','project-animation.gd']:[]),...(schemaVersion>=7?['project-clip-runtime.gd']:[]),...(schemaVersion===8?['project-completion-runtime.gd','project-animation-completions.gd']:[])];
    const runtimeScripts = [`scenes/${sceneId}/runtime.gd`,`scenes/${sceneId}/project-scene.gd`];
    for (const script of [...scripts,...runtimeScripts]) await fs.writeFile(path.join(directory,script),'extends Node\n');
    await fs.writeFile(path.join(directory,'assembly.json'),JSON.stringify({ format:'viento-godot-project',schemaVersion,assembly:{objectId:assemblyId},entrySceneId:sceneId,scenes:[{sceneId,entry:`scenes/${sceneId}/main.tscn`,runtimeScripts}],behaviorSources:[] }));
    assert.deepEqual(await godotAssemblyScripts(directory),[...scripts,...runtimeScripts]);
  }
  await fs.rm(path.join(directory,'project-animation-completions.gd'));
  await assert.rejects(godotAssemblyScripts(directory));
});


test('real completion follows the Rust subtraction boundary when endpoint addition rounds below duration', real, async t => {
  const f = await projectAnimationControlAuthor(t, { sprites:false });
  await f.edit('documents/animations/scene-0.json', document => { document.durationSeconds = 1 + 2 ** -52; });
  await f.script('checkpoint', probe({ setup:'\tp.seek_animation(PackedByteArray([0,0,0,0,0,0,160,60]).decode_double(0))\n\tp.play_animation()', body:'\t_step(1)\n\tp.pause_animation()\n\thost.flush_requests()' }));
  const directory = path.join(f.temporary,'rounding'), built = await buildProject({ root:f.author,targetId:f.assemblyId,tool,output:directory });
  assert.equal(built.ok,true,JSON.stringify(built.record?.diagnostics || built));
  const result = await run({output:directory}); passed(result);
  assert.equal(rows(result,'animation-completed').length,1);
  assert.equal(rows(result,'animation-completed')[0].state.positionSeconds,1 + 2 ** -52);
  assert.deepEqual(output(result,'COMPLETED:'),[null]);
});
