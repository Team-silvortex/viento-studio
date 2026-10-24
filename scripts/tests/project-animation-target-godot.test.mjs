import '../adapters/node-studio-core.mjs';
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { projectAnimationClipsAuthor } from './helpers/project-animation-clips-author-fixture.mjs';
import { buildProject, runProjectBuild } from '../adapters/node-project-build.mjs';
import { captureBuildSnapshot } from '../adapters/node-build-snapshot.mjs';
import { generateEditableGodotAnimationStateScript } from '../../engine/animation-state-script-source.mjs';
import { DEFAULT_ANIMATION_STATE_TABLE } from '../../engine/godot-animation-state-script.mjs';
import { GODOT4_EXECUTION_ADAPTER as adapter } from '../backends/godot4-adapter.mjs';
import { godotAssemblyScripts } from '../backends/godot4-project.mjs';

const tool = process.env.VIENTO_GODOT_BIN;
const real = { skip: !tool ? 'Set VIENTO_GODOT_BIN for real scoped animation playback' : false, timeout: 120000 };
const xdg = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-animation-target-xdg-'));
const saved = Object.fromEntries(['XDG_CACHE_HOME', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME'].map(key => [key, process.env[key]]));
for (const [key, name] of [['XDG_CACHE_HOME', 'cache'], ['XDG_CONFIG_HOME', 'config'], ['XDG_DATA_HOME', 'data']]) {
  process.env[key] = path.join(xdg, name); await fs.mkdir(process.env[key]);
}
after(async () => {
  for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  await fs.rm(xdg, { recursive: true, force: true });
});
const instanceB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';
const probeBinding = '62626262-6262-4262-8262-000000000001';
const events = (result, event) => result.record.events.filter(row => row.event === event);
const printed = (result, prefix) => result.record.phases.at(-1).stdout.split('\n').filter(line => line.startsWith(prefix)).map(line => JSON.parse(line.slice(prefix.length)));
const passed = result => assert.equal(result.ok, true, JSON.stringify(result.record?.diagnostics || result));
const actorTarget = instanceId => ({ kind: 'instance', instanceId });
const probe = (f, body, { subscribe = true, callback = 'return true' } = {}) => `extends Node
var p
func _ready() -> void:
\tp = get_meta("viento_project")
${subscribe ? '\tp.subscribe_animation_completed(_done)\n' : ''}\tcall_deferred("_probe")
func _done(clip) -> bool:
\tprint("DONE_A:" + JSON.stringify(clip))
${callback.split('\n').map(line => '\t' + line).join('\n')}
func _step(seconds: float, flush: bool = true) -> void:
\tvar host = get_tree().root.get_node("VientoProject")
\thost.elapsed_seconds += seconds
\thost.total_seconds += seconds
\thost.current.project_step(seconds)
\tif flush:
\t\thost.flush_requests()
func _other(host):
\tfor actor in host.current.actors:
\t\tif actor["instanceId"] == "${f.otherInstanceId}":
\t\t\treturn actor["node"].get_node("behavior_${f.secondBindingId.replaceAll('-', '_')}").get_meta("viento_project")
\treturn null
func _sample(host) -> void:
\tvar output: Array = []
\tfor identity in ["${f.instanceId}", "${instanceB}"]:
\t\tvar target = host.current.project_animation_target_for_instance(identity)
\t\tvar row = host.current.project_animation_target_snapshot(target)
\t\trow["target"] = target
\t\trow["visualX"] = host.current.animation_visuals[identity].position.x
\t\tvar sprites = host.current.get("animation_sprites")
\t\tif sprites is Dictionary and sprites.has(identity):
\t\t\trow["spriteFrame"] = sprites[identity].frame
\t\toutput.push_back(row)
\tprint("LANES:" + JSON.stringify(output))
func _probe() -> void:
\tvar host = get_tree().root.get_node("VientoProject")
\thost.set_process(false)
\thost.flush_requests()
\tvar q = _other(host)
${typeof body === 'function' ? body(f) : body}
\thost.finish_project()
`;
const subscriber = `extends Node
func _ready() -> void:
\tget_meta("viento_project").subscribe_animation_completed(_done)
func _done(clip) -> bool:
\tprint("DONE_B:" + JSON.stringify(clip))
\treturn true
`;
async function author(t, { scope = 'instance', sprites = false, sameTarget = false, loop = true } = {}) {
  const f = await projectAnimationClipsAuthor(t, { sprites });
  f.otherInstanceId = sameTarget ? f.instanceId : instanceB;
  await f.edit('documents/animations/scene-0.json', document => {
    document.schemaVersion = 4; document.playbackScope = scope; document.loop = loop;
    document.tracks.push(...document.tracks.map((track, index) => ({ ...structuredClone(track), id: `62626262-6262-4262-8262-${String(index + 100).padStart(12, '0')}`, instanceId: instanceB })));
  });
  if (scope === 'scene') await f.edit('documents/animations/scene-1.json', document => { document.schemaVersion = 4; document.playbackScope = 'instance'; });
  await f.edit('documents/behaviors/demo.json', document => {
    document.bindings.push({ ...structuredClone(document.bindings[0]), bindingId: f.secondBindingId,
      instanceId: f.otherInstanceId, implementation: { ...document.bindings[0].implementation, sourceObjectId: f.secondScriptId } });
  });
  await f.edit('metadata/documents/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee.json', document => document.relations.push({ kind: 'reference', targetId: f.secondScriptId, slot: 'implementation' }));
  await f.script('second', subscriber);
  return { ...f, output: path.join(f.temporary, 'scoped-build') };
}
async function build(t, body, options = {}) {
  const f = await author(t, options); await f.script('checkpoint', probe(f, body, options));
  const result = await buildProject({ root: f.author, targetId: f.assemblyId, tool, output: f.output });
  assert.equal(result.ok, true, JSON.stringify(result.record?.diagnostics || result)); return f;
}
const run = f => runProjectBuild({ buildDirectory: f.output, tool, headless: true, smoke: false });
const selectBoth = f => `\tp.select_animation_clip("${f.clipIds[0][1]}")\n\tp.play_animation()\n\tq.select_animation_clip("${f.clipIds[0][1]}")\n\tq.play_animation()\n\thost.flush_requests()`;

test('schema4 emits protocol11 and inventory12 with independent target modules and unchanged old templates', async t => {
  const f = await author(t); await f.script('checkpoint', 'extends Node\n');
  const captured = await captureBuildSnapshot(f.author, f.assemblyId); assert.equal(captured.ok, true, JSON.stringify(captured.diagnostics));
  const generated = await adapter.generate(captured.plan);
  assert.equal(generated.backend.protocolVersion, 11); assert.equal(generated.backend.version, '0.20.0');
  assert.equal(JSON.parse(generated.files.get('assembly.json')).schemaVersion, 12);
  for (const name of ['project-animation-target-runtime.gd', 'project-animation-targets.gd', 'project-animation-target-completions.gd']) assert.ok(generated.files.has(name), name);
  for (const [output, source] of [['project-animation.gd', 'project-animation-clips.gd'], ['project-animation-completions.gd', 'project-animation-completions.gd']]) {
    assert.deepEqual(generated.files.get(output), await fs.readFile(new URL('../backends/godot4/' + source, import.meta.url)));
  }
  assert.equal(generated.files.get(`behaviors/${f.scriptId}.gd`).toString(), 'extends Node\n');
  const directory = path.join(f.temporary, 'inventory');
  for (const [name, bytes] of generated.files) { const file = path.join(directory, name); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, bytes); }
  assert.ok((await godotAssemblyScripts(directory)).includes('project-animation-target-runtime.gd'));
});

test('real instance scope starts stopped without fabricated completions', real, async t => {
  const f = await build(t, '\t_step(2)\n\t_sample(host)'), result = await run(f); passed(result);
  assert.equal(events(result, 'animation-command').length, 0); assert.equal(events(result, 'animation-completed').length, 0);
  assert.deepEqual(printed(result, 'LANES:')[0].map(row => [row.phase, row.positionSeconds, row.visualX]), [['stopped', 0, 0], ['stopped', 0, 0]]);
});

for (const sprites of [false, true]) test(`real two target clocks retain different clips and visual samples (${sprites})`, real, async t => {
  const f = await build(t, f => `\tp.select_animation_clip("${f.clipIds[0][1]}")
\tp.play_animation()
\tq.select_animation_clip("${f.clipIds[0][0]}")
\tq.play_animation()
\thost.flush_requests()
\t_step(0.25)
\t_sample(host)
\t_step(0.25)
\t_sample(host)`, { sprites }), result = await run(f); passed(result);
  const samples = printed(result, 'LANES:');
  assert.deepEqual(samples[0].map(row => [row.phase, row.positionSeconds, row.visualX]), [['playing', .25, 75], ['playing', .25, 50]]);
  assert.deepEqual(samples[1].map(row => [row.phase, row.positionSeconds, row.visualX]), [['finished', .5, 100], ['playing', 0, 25]]);
  if (sprites) assert.deepEqual(samples[1].map(row => row.spriteFrame), [3, 1]);
  const [completion] = events(result, 'animation-completed');
  assert.deepEqual(completion.target, actorTarget(f.instanceId)); assert.equal(completion.targetCommandSequence, 2); assert.equal(completion.commandSequence, 4);
  assert.deepEqual(completion.recipients.map(row => row.bindingId), [f.bindingId]);
  assert.equal(printed(result, 'DONE_B:').length, 0);
});

test('real same-frame natural completions are distinct and both target subscriptions are delivered', real, async t => {
  const f = await build(t, f => selectBoth(f) + '\n\t_step(0.5)\n\t_step(0.25)'), result = await run(f); passed(result);
  const completions = events(result, 'animation-completed');
  assert.deepEqual(completions.map(row => [row.target.instanceId, row.commandSequence, row.targetCommandSequence, row.state.timeSeconds]), [[f.instanceId, 4, 2, .5], [instanceB, 4, 4, .5]]);
  assert.deepEqual(events(result, 'animation-completion-delivery').map(row => row.status), ['handled', 'handled']);
  assert.equal(printed(result, 'DONE_A:').length, 1); assert.equal(printed(result, 'DONE_B:').length, 1);
});

test('real A command cancels only A pending completion while B stays deliverable and can replay', real, async t => {
  const f = await build(t, f => selectBoth(f) + `
\t_step(0.5, false)
\tp.pause_animation()
\thost.flush_requests()
\tq.play_animation()
\thost.flush_requests()
\t_step(0.5)`), result = await run(f); passed(result);
  assert.deepEqual(events(result, 'animation-completion-delivery').map(row => row.status), ['skipped', 'handled', 'handled']);
  assert.deepEqual(events(result, 'animation-completed').map(row => [row.target.instanceId, row.targetCommandSequence]), [[f.instanceId, 2], [instanceB, 4], [instanceB, 6]]);
  assert.equal(printed(result, 'DONE_A:').length, 0); assert.equal(printed(result, 'DONE_B:').length, 2);
});

test('real same target bindings share a head and queue order decides the last applied clip', real, async t => {
  const f = await build(t, f => `\tp.select_animation_clip("${f.clipIds[0][1]}")
\tp.play_animation()
\tq.select_animation_clip("${f.clipIds[0][0]}")
\tq.play_animation()
\thost.flush_requests()
\t_step(0.25)
\t_sample(host)
\tp.stop_animation()
\thost.flush_requests()
\t_sample(host)`, { sameTarget: true }), result = await run(f); passed(result);
  const commands = events(result, 'animation-command');
  assert.deepEqual(new Set(commands.map(row => row.bindingId)), new Set([f.bindingId, f.secondBindingId]));
  assert.ok(commands.every(row => row.target.instanceId === f.instanceId));
  const samples = printed(result, 'LANES:'); assert.equal(samples[0][0].clipId, f.clipIds[0][0]); assert.equal(samples[0][0].visualX, 50);
  assert.deepEqual(samples[1].map(row => [row.phase, row.visualX]), [['stopped', 25], ['stopped', 0]]);
});

test('real explicit scene scope preserves automatic whole-scene playback and shared recipients', real, async t => {
  const f = await build(t, '\t_step(0.25)\n\t_sample(host)\n\t_step(0.75)', { scope: 'scene', loop: false }), result = await run(f); passed(result);
  assert.deepEqual(printed(result, 'LANES:')[0].map(row => [row.target, row.visualX]), [[{ kind: 'scene' }, 25], [{ kind: 'scene' }, 25]]);
  const [completion] = events(result, 'animation-completed'); assert.deepEqual(completion.target, { kind: 'scene' }); assert.equal(completion.targetCommandSequence, 0);
  assert.equal(completion.recipients.length, 2); assert.deepEqual(events(result, 'animation-completion-delivery').map(row => row.status), ['handled', 'handled']);
});

for (const action of ['pause_animation()', 'stop_animation()', 'seek_animation(0.1)', 'select_animation_clip(null)', 'play_animation()']) test(`real ${action} does not affect another target head`, real, async t => {
  const f = await build(t, f => selectBoth(f) + `\n\t_step(0.25)\n\tp.${action}\n\thost.flush_requests()\n\t_sample(host)`), result = await run(f); passed(result);
  const other = printed(result, 'LANES:')[0][1]; assert.equal(other.phase, 'playing'); assert.equal(other.positionSeconds, .25); assert.equal(other.visualX, 75);
});

for (const version of [1, 5]) test(`real generated v${version} state scripts keep source bytes and completion enters only its target controller`, real, async t => {
  const f = await author(t); const table = structuredClone(DEFAULT_ANIMATION_STATE_TABLE);
  if (version === 5) table.transitions[0].trigger.condition = { combine: 'all', conditions: [
    { type: 'boolean', operator: 'eq', value: true }, { type: 'boolean', operator: 'eq', value: true, selector: { kind: 'projectState', key: 'ready' } },
  ] };
  const source = generateEditableGodotAnimationStateScript(table).content; await f.script('checkpoint', source);
  await f.edit('documents/behaviors/demo.json', document => {
    for (const binding of document.bindings) {
      binding.implementation.sourceObjectId = f.scriptId;
      binding.parameters = { clip_idle: f.clipIds[0][0], clip_action: f.clipIds[0][1] };
    }
    document.bindings.push({ ...structuredClone(document.bindings[0]), bindingId: probeBinding, parameters: {}, implementation: { ...document.bindings[0].implementation, sourceObjectId: f.secondScriptId } });
  });
  await f.script('second', probe(f, '\tp.write_state("ready",true)\n\tp.publish_event("action",true)\n\thost.flush_requests()\n\t_step(0.5)', { subscribe: false }));
  const built = await buildProject({ root: f.author, targetId: f.assemblyId, tool, output: f.output }); assert.equal(built.ok, true, JSON.stringify(built.record?.diagnostics || built));
  assert.equal(await fs.readFile(path.join(f.output, 'project/behaviors/' + f.scriptId + '.gd'), 'utf8'), source);
  const result = await run(f); passed(result);
  const entries = result.record.runtime.project.animationStateEntries.entries;
  assert.deepEqual(entries.map(row => row.stateKey), ['idle', 'idle', 'action', 'action', 'idle', 'idle']);
  assert.deepEqual(entries.slice(-2).map(row => row.trigger.completionSequence), [1, 2]);
  assert.deepEqual(events(result, 'animation-completed').map(row => row.recipients.length), [1, 1]);
  assert.equal(events(result, 'animation-command').length, 12);
});

test('real mutable port binding cannot retarget a registered origin', real, async t => {
  const f = await build(t, `\tp.binding["instanceId"]="${instanceB}"\n\tp.play_animation()`, { subscribe: false }), result = await run(f);
  assert.equal(result.ok, false); assert.equal(events(result, 'animation-command').length, 0);
  assert.ok(result.record.diagnostics.some(row => row.code === 'runtime_behavior_animation_missing' && row.bindingId === f.bindingId && row.instanceId === f.instanceId), JSON.stringify(result.record.diagnostics));
  assert.ok(!result.record.diagnostics.some(row => row.code === 'runtime_protocol_invalid'));
});

test('real mixed-scope scene switching revokes old ports and resets same-identity target lanes on reentry', real, async t => {
  const f = await author(t);
  await f.script('checkpoint', probe(f, f => `\tif p.read_state("returned") == null:
${selectBoth(f).split('\n').map(line => '\t' + line).join('\n')}
\t\t_step(0.5, false)
\t\thost.set_meta("old_target_port", q)
\t\tp.request_scene("${f.sceneIds[1]}")
\t\thost.flush_requests()
\t\treturn
\tprint("OLD_TARGET_PORT:" + JSON.stringify(host.get_meta("old_target_port").play_animation()))
\t_sample(host)
${selectBoth(f)}
\t_step(0.5)`));
  await f.script('second', `extends Node
func _ready() -> void:
\tvar p=get_meta("viento_project")
\tif get_tree().root.get_node("VientoProject").current_scene=="${f.sceneIds[1]}":
\t\tp.write_state("returned",true)
\t\tp.request_scene("${f.sceneIds[0]}")
\telse:
\t\tp.subscribe_animation_completed(_done)
func _done(clip) -> bool:
\tprint("DONE_B:"+JSON.stringify(clip))
\treturn true
`);
  const built = await buildProject({ root: f.author, targetId: f.assemblyId, tool, output: f.output });
  assert.equal(built.ok, true, JSON.stringify(built.record?.diagnostics || built));
  const result = await run(f); passed(result);
  assert.deepEqual(events(result, 'scene-enter').map(row => row.sceneId), [f.sceneIds[0], f.sceneIds[1], f.sceneIds[0]]);
  assert.deepEqual(printed(result, 'OLD_TARGET_PORT:'), [false]);
  assert.deepEqual(printed(result, 'LANES:')[0].map(row => [row.phase, row.positionSeconds]), [['stopped', 0], ['stopped', 0]]);
  assert.deepEqual(events(result, 'animation-completion-delivery').map(row => [row.visitIndex, row.status]), [[1, 'skipped'], [1, 'skipped'], [3, 'handled'], [3, 'handled']]);
});

test('real replacing a port entire binding cannot borrow another registered target or source', real, async t => {
  const f = await build(t, `\tp.binding=q.binding.duplicate(true)
\tprint("PORT_CALLS:"+JSON.stringify([p.play_animation(),p.pause_animation(),p.stop_animation(),p.seek_animation(0.1),p.select_animation_clip(null),p.subscribe_animation_completed(_done),p.unsubscribe_animation_completed(1)]))
\tprint("PORT_SUBSCRIPTIONS:"+JSON.stringify(host.animation_completions.subscriptions.keys()))`, { subscribe: false });
  const result = await run(f);
  assert.equal(result.ok, false, JSON.stringify(events(result, 'animation-command')));
  assert.equal(events(result, 'animation-command').length, 0);
  assert.deepEqual(printed(result, 'PORT_CALLS:'), [[false, false, false, false, false, 0, false]]);
  assert.deepEqual(printed(result, 'PORT_SUBSCRIPTIONS:'), [[1]]);
  const originErrors = result.record.diagnostics.filter(row => row.code === 'runtime_behavior_animation_missing');
  // Build records deduplicate equal diagnostics; each public return is checked above.
  assert.ok(originErrors.length > 0, JSON.stringify(result.record.diagnostics));
  assert.ok(originErrors.every(row => row.bindingId === f.bindingId && row.instanceId === f.instanceId));
  assert.ok(!result.record.diagnostics.some(row => row.code === 'runtime_protocol_invalid'));
});
