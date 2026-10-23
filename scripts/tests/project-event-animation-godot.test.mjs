import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { listScriptStarters } from '../../engine/script-authoring.mjs';
import { projectEventAnimationAuthor } from './helpers/project-event-animation-author-fixture.mjs';
import { buildProject, runProjectBuild } from '../adapters/node-project-build.mjs';

const tool = process.env.VIENTO_GODOT_BIN;
const real = { skip: !tool ? 'Set VIENTO_GODOT_BIN for actual event-triggered animation' : false, timeout: 120000 };
const execFileAsync = promisify(execFile);
const rows = (result, event) => result.record.events.filter(row => row.event === event);
const commands = result => rows(result, 'animation-command');
const printed = (result, prefix) => result.record.phases.at(-1).stdout.split('\n').filter(line => line.startsWith(prefix)).map(line => JSON.parse(line.slice(prefix.length)));
const publisher = body => `extends Node\nfunc _ready() -> void:\n\tvar p = get_meta("viento_project")\n${body}`;
async function build(t, edit, options) {
  const f = await projectEventAnimationAuthor(t, options);
  if (edit) await edit(f);
  const output = path.join(f.temporary, 'event-animation-build');
  const built = await buildProject({ root: f.author, targetId: f.assemblyId, tool, output });
  assert.equal(built.ok, true, JSON.stringify(built.diagnostics || built.record?.diagnostics));
  return { ...f, output };
}
const run = (f, options = {}) => runProjectBuild({ buildDirectory: f.output, tool, headless: true, smoke: true, ...options });
function succeeded(result) { assert.equal(result.ok, true, JSON.stringify(result.record?.diagnostics || result)); }
function rejected(result, f, code) {
  assert.equal(result.ok, false);
  assert.ok(result.record.diagnostics.some(row => row.code === code && row.bindingId === f.receiverBindingId && row.sourcePath === 'documents/behaviors/demo.json'), JSON.stringify(result.record.diagnostics));
  assert.equal(result.record.diagnostics.some(row => row.code === 'runtime_project_protocol_invalid'), false, JSON.stringify(result.record.diagnostics));
  assert.equal(rows(result, 'finished').length, 0);
}
const pair = clipId => [['select', clipId, 0, 'paused'], ['play', clipId, 0, 'playing']];
const states = result => commands(result).map(row => [row.command.action, row.state.clipId, row.state.positionSeconds, row.state.phase]);

// Node parameters configure the saved clip; event payloads never select clips.
test('real event starter filters names, ignores every scalar payload and owns its select/play receipts', real, async t => {
  const f = await build(t, async f => {
    await f.configure({ event_name: 'attack', clip_id: f.clipIds[0][1] });
    await f.script('publisher', publisher(`\tp.publish_event("checkpoint", true)\n\tfor value in [0, true, false, 42, 0.25, "${f.clipIds[0][0]}", "雨 / 风 🌧"]:\n\t\tp.publish_event("attack", value)\n`));
  });
  const result = await run(f); succeeded(result);
  assert.equal(result.record.events[0].protocol, 7);
  assert.deepEqual(rows(result, 'event-publish').map(row => row.recipients.length), [0, 1, 1, 1, 1, 1, 1, 1]);
  assert.deepEqual(rows(result, 'event-delivery').map(row => row.status), Array(7).fill('handled'));
  assert.deepEqual(states(result), Array.from({ length: 7 }, () => pair(f.clipIds[0][1])).flat());
  assert.ok(commands(result).every(row => row.bindingId === f.receiverBindingId && row.instanceId === f.instanceId));
  assert.ok(rows(result, 'event-publish').every(row => row.bindingId === f.publisherBindingId));
  const timeline = result.record.events.map(row => row.event);
  assert.ok(timeline.lastIndexOf('event-delivery') < timeline.indexOf('animation-command'));
  assert.equal(result.record.events.at(-1).animationCommandSequence, 14);
  assert.equal(result.record.runtime.project.sharedState.revision, 0);
});

for (const sprites of [false, true]) test(`real repeated events restart the selected clip after clock advancement (${sprites ? 'sprite and transform' : 'transform'})`, real, async t => {
  const f = await build(t, f => f.script('publisher', publisher(`\tp.publish_event("checkpoint", true)\n\tcall_deferred("_again")\nfunc _again() -> void:\n\tvar scene = get_tree().root.get_node("VientoProject/VientoScene")\n\tscene.project_host.elapsed_seconds += 0.25\n\tscene.project_host.total_seconds += 0.25\n\tscene.project_step(0.25)\n\tprint("BEFORE_EVENT:" + JSON.stringify([scene.project_animation_position, scene.animation_time, scene.animation_visuals["${f.instanceId}"].position.x${sprites ? `, scene.animation_sprites["${f.instanceId}"].frame` : ''}]))\n\tget_meta("viento_project").publish_event("checkpoint", true)\n\tcall_deferred("_after")\nfunc _after() -> void:\n\tvar scene = get_tree().root.get_node("VientoProject/VientoScene")\n\tprint("AFTER_EVENT:" + JSON.stringify([scene.project_animation_position, scene.animation_time, scene.animation_visuals["${f.instanceId}"].position.x${sprites ? `, scene.animation_sprites["${f.instanceId}"].frame` : ''}, scene.project_animation_phase]))\n\tget_tree().root.propagate_notification(NOTIFICATION_WM_CLOSE_REQUEST)\n`)), { sprites });
  const result = await run(f, { smoke: false }); succeeded(result);
  assert.deepEqual(states(result), [...pair(f.clipIds[0][1]), ...pair(f.clipIds[0][1])]);
  assert.deepEqual(commands(result).map(row => row.state.timeSeconds), [0, 0, .25, .25]);
  assert.deepEqual(printed(result, 'BEFORE_EVENT:'), [sprites ? [.25, .75, 75, 3] : [.25, .75, 75]]);
  assert.deepEqual(printed(result, 'AFTER_EVENT:'), [sprites ? [0, .5, 50, 3, 'playing'] : [0, .5, 50, 'playing']]);
});

test('real starter only subscribes: absent events keep automatic whole animation and emit no commands', real, async t => {
  const f = await build(t, f => f.script('publisher', `extends Node
func _ready() -> void:
\tcall_deferred("_probe")
func _probe() -> void:
\tvar scene = get_tree().root.get_node("VientoProject/VientoScene")
\tscene.project_host.elapsed_seconds += 0.25
\tscene.project_host.total_seconds += 0.25
\tscene.project_step(0.25)
\tprint("AUTOPLAY:" + JSON.stringify([scene.project_animation_clip, scene.project_animation_position, scene.animation_time, scene.animation_visuals["${f.instanceId}"].position.x, scene.project_animation_phase]))
\tget_tree().root.propagate_notification(NOTIFICATION_WM_CLOSE_REQUEST)
`));
  const result = await run(f, { smoke: false }); succeeded(result);
  assert.deepEqual(printed(result, 'AUTOPLAY:'), [[null, .25, .25, 25, 'playing']]);
  assert.equal(commands(result).length, 0); assert.equal(rows(result, 'event-publish').length, 0);
});

test('real deferred publication works when the publisher is declared before the receiver', real, async t => {
  const f = await build(t, async f => {
    await f.edit('documents/behaviors/demo.json', manifest => { manifest.bindings.reverse(); });
    await f.script('publisher', `extends Node
func _ready() -> void:
\tcall_deferred("_publish")
func _publish() -> void:
\tget_meta("viento_project").publish_event("checkpoint", true)
`);
  });
  const result = await run(f); succeeded(result);
  assert.deepEqual(rows(result, 'event-publish').map(row => row.recipients.length), [1]);
  assert.deepEqual(rows(result, 'event-delivery').map(row => row.status), ['handled']);
  assert.deepEqual(states(result), pair(f.clipIds[0][1]));
});

test('real default empty clip selects the whole timeline regardless of payload', real, async t => {
  const f = await build(t, async f => {
    await f.configure({});
    await f.script('publisher', publisher(`\tp.publish_event("checkpoint", "${f.clipIds[0][1]}")\n`));
  });
  const result = await run(f); succeeded(result); assert.deepEqual(states(result), pair(null));
});

test('real empty event name disables the subscription without changing playback', real, async t => {
  const f = await build(t, async f => {
    await f.configure({ event_name: '', clip_id: f.clipIds[0][1] });
    await f.script('publisher', publisher('\tp.publish_event("checkpoint", true)\n'));
  });
  const result = await run(f); succeeded(result);
  assert.deepEqual(rows(result, 'event-publish').map(row => row.recipients.length), [0]);
  assert.equal(commands(result).length, 0);
});

test('real invalid saved clip reports the receiver author source and never enqueues play', real, async t => {
  const f = await build(t, async f => {
    await f.configure({ clip_id: '60606060-6060-4060-8060-000000000999' });
    await f.script('publisher', publisher('\tp.publish_event("checkpoint", true)\n'));
  });
  const result = await run(f); rejected(result, f, 'runtime_behavior_animation_clip');
  assert.equal(commands(result).length, 0); assert.equal(rows(result, 'event-delivery').length, 0);
});

test('real A→B→A clears old subscriptions and reentry delivers once to the new receiver', real, async t => {
  const f = await build(t, async f => {
    await f.script('publisher', publisher(`\tp.publish_event("checkpoint", true)\n\tif p.read_state("returned") == null:\n\t\tp.request_scene("${f.sceneIds[1]}")\n`));
    await f.script('second', publisher(`\tp.publish_event("checkpoint", "no receiver in this scene")\n\tp.write_state("returned", true)\n\tp.request_scene("${f.sceneIds[0]}")\n`));
  });
  const result = await run(f); succeeded(result);
  assert.deepEqual(rows(result, 'scene-enter').map(row => row.sceneId), [f.sceneIds[0], f.sceneIds[1], f.sceneIds[0]]);
  assert.deepEqual(rows(result, 'event-publish').map(row => [row.visitIndex, row.recipients.length]), [[1,1],[2,0],[3,1]]);
  assert.deepEqual(commands(result).map(row => [row.visitIndex, row.command.action]), [[1,'select'],[1,'play'],[3,'select'],[3,'play']]);
  const deliveries = rows(result, 'event-delivery');
  assert.deepEqual(deliveries.map(row => row.status), ['handled','handled']);
  assert.ok(deliveries[1].subscriptionId > deliveries[0].subscriptionId);
});

test('real receiver exit unsubscribes pending callbacks before a behavior is freed', real, async t => {
  const f = await build(t, f => f.script('publisher', publisher(`\tp.publish_event("checkpoint", true)\n\tvar receiver = get_parent().get_node("behavior_${f.receiverBindingId.replaceAll('-', '_')}")\n\treceiver.free()\n\tp.publish_event("checkpoint", false)\n`)));
  const result = await run(f); succeeded(result);
  assert.deepEqual(rows(result, 'event-publish').map(row => row.recipients.length), [1,0]);
  assert.deepEqual(rows(result, 'event-delivery').map(row => row.status), ['skipped']);
  assert.equal(commands(result).length, 0);
});

test('real standalone scene safely skips the starter and old author formats now expose explicit clip rejection', real, async t => {
  const f = await projectEventAnimationAuthor(t);
  const singleOutput = path.join(f.temporary, 'single');
  const built = await buildProject({ root: f.author, scene: f.sceneIds[0], tool, output: singleOutput });
  assert.equal(built.ok, true, JSON.stringify(built.diagnostics || built.record?.diagnostics));
  const single = await run({ output: singleOutput }); succeeded(single);
  assert.equal(rows(single, 'animation-command').length, 0);
  assert.equal(rows(single, 'event-publish').length, 0);
  for (const index of [0,1]) await f.edit(`documents/animations/scene-${index}.json`, document => { document.schemaVersion = 2; delete document.clips; });
  await f.script('publisher', publisher('\tp.publish_event("checkpoint", true)\n'));
  const output = path.join(f.temporary, 'legacy');
  const legacyBuilt = await buildProject({ root: f.author, targetId: f.assemblyId, tool, output });
  assert.equal(legacyBuilt.ok, true, JSON.stringify(legacyBuilt.diagnostics || legacyBuilt.record?.diagnostics));
  const legacy = await run({ output }); rejected(legacy, f, 'runtime_behavior_animation_clip');
  assert.equal(legacy.record.events[0].protocol, 7);
  assert.deepEqual(rows(legacy, 'event-publish').map(row => row.recipients.length), [1]);
  assert.equal(commands(legacy).length, 0);
});

for (const count of [32,33]) test(`real ${count} same-safe-point events inherit the 64 pending animation command budget`, real, async t => {
  const f = await build(t, f => f.script('publisher', publisher(`\tfor i in range(${count}):\n\t\tp.publish_event("checkpoint", i)\n`)));
  const result = await run(f);
  assert.equal(rows(result, 'event-publish').length, count);
  assert.equal(rows(result, 'event-delivery').length, 32);
  if (count === 32) {
    succeeded(result); assert.deepEqual(states(result), Array.from({ length: 32 }, () => pair(f.clipIds[0][1])).flat());
    assert.equal(result.record.events.at(-1).animationCommandSequence, 64);
  } else {
    rejected(result, f, 'runtime_behavior_animation_limit'); assert.equal(commands(result).length, 0);
  }
});

// Real Godot lifecycle probes cover incomplete/invalid port objects without
// changing any generated backend or replacing the starter under test.
test('real starter guards all required ports and cleans up its subscription on ordinary exit', real, async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-event-animation-ports-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const starter = listScriptStarters().find(item => item.id === 'godot-project-animation-event');
  await fs.writeFile(path.join(directory, 'project.godot'), 'config_version=5\n[application]\nconfig/name="Event animation port probe"\n');
  await fs.writeFile(path.join(directory, 'starter.gd'), starter.content);
  const methods = {
    subscribe_event: 'func subscribe_event(_name, _callback):\n\tcalls.append("subscribe")\n\treturn 1\n',
    unsubscribe_event: 'func unsubscribe_event(_token):\n\tcalls.append("unsubscribe")\n\treturn false\n',
    select_animation_clip: 'func select_animation_clip(_clip):\n\tcalls.append("select")\n\treturn accepted\n',
    play_animation: 'func play_animation():\n\tcalls.append("play")\n\treturn true\n',
  };
  for (const excluded of [...Object.keys(methods), 'none']) {
    await fs.writeFile(path.join(directory, `${excluded}.gd`), 'extends RefCounted\nvar calls = []\nvar accepted = true\n' + Object.entries(methods).filter(([name]) => name !== excluded).map(([,source]) => source).join(''));
  }
  await fs.writeFile(path.join(directory, 'object-port.gd'), 'extends Object\nvar calls = []\nvar accepted = true\n' + Object.values(methods).join(''));
  await fs.writeFile(path.join(directory, 'probe.gd'), `extends SceneTree
func _initialize() -> void:
\tcall_deferred("_probe")
func _probe() -> void:
\tvar starter = load("res://starter.gd")
\tfor name in ["subscribe_event", "unsubscribe_event", "select_animation_clip", "play_animation"]:
\t\tvar port = load("res://" + name + ".gd").new()
\t\tvar node = starter.new()
\t\tnode.set_meta("viento_project", port)
\t\troot.add_child(node)
\t\tnode.free()
\t\tprint("PORT_GUARD:" + JSON.stringify([name, port.calls]))
\tfor value in [null, true, 123, "old", {}]:
\t\tvar node = starter.new()
\t\tif value != null:
\t\t\tnode.set_meta("viento_project", value)
\t\troot.add_child(node)
\t\tnode.free()
\tvar dead = Object.new()
\tvar stale = starter.new()
\tstale.set_meta("viento_project", dead)
\tdead.free()
\troot.add_child(stale)
\tstale.free()
\tfor accepted in [true, false]:
\t\tvar port = load("res://none.gd").new()
\t\tport.accepted = accepted
\t\tvar node = starter.new()
\t\tnode.set_meta("viento_project", port)
\t\troot.add_child(node)
\t\tvar response = node._on_event(true)
\t\troot.remove_child(node)
\t\tprint("PORT_EXIT:" + JSON.stringify([response, port.calls, node._subscription, node._project]))
\t\tnode.free()
\tvar released_port = load("res://object-port.gd").new()
\tvar released_receiver = starter.new()
\treleased_receiver.set_meta("viento_project", released_port)
\troot.add_child(released_receiver)
\treleased_port.free()
\tvar released_result = released_receiver._on_event(true)
\troot.remove_child(released_receiver)
\tprint("PORT_RELEASED:" + JSON.stringify([released_result, released_receiver._subscription, released_receiver._project]))
\treleased_receiver.free()
\tprint("PORT_DONE:true")
\tquit()
`);
  const result = await execFileAsync(tool, ['--headless', '--path', directory, '--script', 'res://probe.gd'], { timeout: 30000, maxBuffer: 1024 * 1024 });
  assert.doesNotMatch(result.stdout + result.stderr, /SCRIPT ERROR|ERROR:|WARNING:.*leaked/);
  const records = prefix => result.stdout.split('\n').filter(line => line.startsWith(prefix)).map(line => JSON.parse(line.slice(prefix.length)));
  assert.deepEqual(records('PORT_GUARD:'), Object.keys(methods).map(method => [method,[]]));
  assert.deepEqual(records('PORT_EXIT:'), [[true,['subscribe','select','play','unsubscribe'],0,null],[false,['subscribe','select','unsubscribe'],0,null]]);
  assert.deepEqual(records('PORT_RELEASED:'), [[false,0,null]]);
  assert.deepEqual(records('PORT_DONE:'), [true]);
});
