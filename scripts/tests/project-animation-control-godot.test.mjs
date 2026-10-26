import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import yauzl from 'yauzl';
import { projectAnimationControlAuthor } from './helpers/project-animation-control-author-fixture.mjs';
import { buildProject, runProjectBuild } from '../adapters/node-project-build.mjs';
import { captureBuildSnapshot } from '../adapters/node-build-snapshot.mjs';
import { GODOT4_EXECUTION_ADAPTER as adapter } from '../backends/godot4-adapter.mjs';
import { generateGodotAssemblyProject, godotAssemblyScripts } from '../backends/godot4-project.mjs';
import { inspectBackendProject } from '../adapters/node-backend-project.mjs';
import { planBackendProjectDelivery, verifyBackendProjectDelivery } from '../adapters/node-backend-project-delivery.mjs';
import { writeExportZip } from '../lib/export-package.mjs';

const tool = process.env.VIENTO_GODOT_BIN;
const real = { skip: !tool ? 'Set VIENTO_GODOT_BIN for actual project animation control' : false };
const rows = result => result.record.events.filter(row => row.event === 'animation-command');
const printed = (result, prefix) => result.record.phases.at(-1).stdout.split('\n').filter(line => line.startsWith(prefix)).map(line => JSON.parse(line.slice(prefix.length)));
async function build(t, edit, options) {
  const f = await projectAnimationControlAuthor(t, options); if (edit) await edit(f);
  const output = path.join(f.temporary, 'animation-control-build');
  const result = await buildProject({ root: f.author, targetId: f.assemblyId, tool, output });
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics || result.record?.diagnostics)); return { ...f, output };
}
const run = (f, options = {}) => runProjectBuild({ buildDirectory: f.output, tool, headless: true, smoke: true, ...options });
const commands = actions => `extends Node\nfunc _ready() -> void:\n\tvar p = get_meta("viento_project")\n${actions.map(action => `\tp.${action}\n`).join('')}`;
function rejected(result, f, code) {
  assert.equal(result.ok, false); assert.ok(result.record?.diagnostics.some(row => row.code === code && row.bindingId === f.bindingId), JSON.stringify(result.record?.diagnostics || result));
  assert.equal(result.record.events.some(row => row.event === 'finished'), false);
  assert.equal(result.record.diagnostics.some(row => row.code === 'runtime_project_protocol_invalid'), false, JSON.stringify(result.record.diagnostics));
}

test('historical assembly generation exposes protocol 7 and bounded generated scripts; ordinary projects retain protocol 4 files', async t => {
  const f = await projectAnimationControlAuthor(t), captured = await captureBuildSnapshot(f.author, f.assemblyId);
  assert.equal(captured.ok, true, JSON.stringify(captured.diagnostics));
  const generated = await generateGodotAssemblyProject(captured.plan);
  assert.equal(generated.backend.protocolVersion, 7); assert.equal(generated.backend.version, '0.16.0');
  assert.ok(generated.backend.capabilities.includes('project.animation-control'));
  assert.equal(JSON.parse(generated.files.get('assembly.json')).schemaVersion, 8);
  assert.ok(generated.files.has('project-control-runtime.gd')); assert.ok(generated.files.has('project-animation.gd'));
  for (const id of f.sceneIds) await f.edit(`metadata/documents/${id}.json`, row => { row.relations = row.relations.filter(relation => relation.kind !== 'animation'); });
  const ordinary = await captureBuildSnapshot(f.author, f.assemblyId), legacy = await generateGodotAssemblyProject(ordinary.plan);
  assert.equal(legacy.backend.protocolVersion, 4); assert.equal(JSON.parse(legacy.files.get('assembly.json')).schemaVersion, 5);
  assert.equal(legacy.files.has('project-control-runtime.gd'), false); assert.equal(legacy.files.has('project-animation.gd'), false);
  assert.deepEqual(legacy.files.get('project-runtime.gd'), await fs.readFile(new URL('../backends/godot4/project-runtime.gd', import.meta.url)));
});

test('real ready commands execute FIFO after initialization and return scene-clock transport states', real, async t => {
  const f = await build(t, f => f.script('checkpoint', commands(['pause_animation()', 'seek_animation(0.5)', 'play_animation()', 'stop_animation()'])));
  const result = await run(f); assert.equal(result.ok, true, JSON.stringify(result.record?.diagnostics || result));
  assert.equal(result.record.events[0].protocol, 7); assert.equal(result.record.events.at(-1).animationCommandSequence, 4);
  assert.deepEqual(rows(result).map(row => [row.command.action, row.state.phase, row.state.positionSeconds, row.state.timeSeconds]), [
    ['pause','paused',0,0], ['seek','paused',.5,0], ['play','playing',.5,0], ['stop','stopped',0,0],
  ]);
  assert.equal((await godotAssemblyScripts(path.join(f.output, 'project'))).filter(name => name.startsWith('project-')).length, 8);
});

test('real paused transport freezes sprite and transform while scene clock advances; seek end and play restart', real, async t => {
  const f = await build(t, async f => {
    await f.script('checkpoint', `extends Node
var p
func _ready() -> void:
\tp = get_meta("viento_project")
\tp.seek_animation(0.5)
\tcall_deferred("_observe")
func _observe() -> void:
\tvar scene = get_tree().root.get_node("VientoProject/VientoScene")
\tvar host = scene.project_host
\t# Test-only observation advances the normal project-owned clock and step.
\thost.elapsed_seconds += 0.25
\thost.total_seconds += 0.25
\tscene.project_step(0.25)
\tprint("ANIMATION_VISUAL:" + JSON.stringify([scene.animation_time, scene.animation_visuals["${f.instanceId}"].position.x, scene.animation_sprites["${f.instanceId}"].frame, scene.project_animation_phase]))
\tp.seek_animation(1.0)
\tp.play_animation()
\tp.pause_animation()
\tp.stop_animation()
\tget_tree().root.propagate_notification(NOTIFICATION_WM_CLOSE_REQUEST)
`);
  });
  const result = await run(f, { smoke: false }); assert.equal(result.ok, true, JSON.stringify(result.record?.diagnostics || result));
  const [visual] = printed(result, 'ANIMATION_VISUAL:'); assert.deepEqual(visual, [.5, 50, 3, 'paused']);
  assert.deepEqual(rows(result).slice(-4).map(row => [row.command.action, row.state.positionSeconds, row.state.phase]), [['seek',1,'paused'], ['play',0,'playing'], ['pause',0,'paused'], ['stop',0,'stopped']]);
});

test('real loop seek to duration wraps to zero and stays paused', real, async t => {
  const f = await build(t, f => f.script('checkpoint', commands(['seek_animation(1.0)'])), { loop: true });
  const result = await run(f); assert.equal(result.ok, true, JSON.stringify(result.record?.diagnostics || result));
  assert.deepEqual(rows(result).map(row => row.state), [{ sceneObjectId: f.sceneIds[0], phase: 'paused', positionSeconds: 0, timeSeconds: 0, clipId: null }]);
});

for (const [label, argument] of [['boolean', 'true'], ['negative', '-1'], ['out of range', '1.01'], ['NaN', 'NAN'], ['infinity', 'INF']]) test(`real ${label} seek fails without an execution receipt`, real, async t => {
  const f = await build(t, f => f.script('checkpoint', commands([`seek_animation(${argument})`])));
  const result = await run(f); rejected(result, f, 'runtime_behavior_animation_command'); assert.equal(rows(result).length, 0);
});

test('real failing event callback drops an accepted animation command', real, async t => {
  const f = await build(t, f => f.script('checkpoint', `extends Node
var p
func _ready() -> void:
\tp = get_meta("viento_project")
\tp.subscribe_event("animate", _on_animate)
\tp.publish_event("animate", true)
func _on_animate(_value) -> bool:
\tprint("ANIMATION_ACCEPTED:" + JSON.stringify(p.pause_animation()))
\treturn false
`));
  const result = await run(f); rejected(result, f, 'runtime_behavior_event_callback');
  assert.deepEqual(printed(result, 'ANIMATION_ACCEPTED:'), [true]); assert.equal(rows(result).length, 0);
});

test('real 65th pending request rejects the entire unexecuted animation queue', real, async t => {
  const f = await build(t, f => f.script('checkpoint', `extends Node
func _ready() -> void:
\tvar p = get_meta("viento_project")
\tvar accepted := 0
\tfor index in range(65):
\t\tif p.pause_animation():
\t\t\taccepted += 1
\tprint("ANIMATION_ACCEPTED:" + JSON.stringify(accepted))
`));
  const result = await run(f); rejected(result, f, 'runtime_behavior_animation_limit'); assert.deepEqual(printed(result, 'ANIMATION_ACCEPTED:'), [64]); assert.equal(rows(result).length, 0);
});

test('real old visit ports fail while A to B to A resets autoplay and fresh queue ownership', real, async t => {
  const f = await build(t, async f => {
    await f.script('checkpoint', `extends Node
static var old_port
static var first := true
func _ready() -> void:
\tvar p = get_meta("viento_project")
\tif first:
\t\tfirst = false
\t\told_port = p
\t\tp.seek_animation(0.5)
\t\tp.request_scene("${f.sceneIds[1]}")
\telse:
\t\tp.pause_animation()
`);
    await f.script('second', `extends Node
func _ready() -> void:
\tvar old = load("res://behaviors/${f.scriptId}.gd").old_port
\tprint("ANIMATION_STALE:" + JSON.stringify([old.play_animation(), old.pause_animation(), old.stop_animation(), old.seek_animation(0.25)]))
\tvar p = get_meta("viento_project")
\tp.pause_animation()
\tp.request_scene("${f.sceneIds[0]}")
`);
  });
  const result = await run(f); assert.equal(result.ok, true, JSON.stringify(result.record?.diagnostics || result));
  assert.deepEqual(printed(result, 'ANIMATION_STALE:'), [[false,false,false,false]]);
  assert.deepEqual(rows(result).map(row => [row.visitIndex,row.command.action,row.state.positionSeconds]), [[1,'seek',.5],[2,'pause',0],[3,'pause',0]]);
});

test('real non-animation member rejects control instead of touching another scene animation', real, async t => {
  const f = await build(t, async f => {
    await f.script('checkpoint', commands([`request_scene("${f.sceneIds[1]}")`]));
    await f.script('second', commands(['play_animation()']));
  }, { secondAnimation: false });
  const result = await run(f); assert.equal(result.ok, false);
  assert.ok(result.record.diagnostics.some(row => row.code === 'runtime_behavior_animation_missing' && row.bindingId === f.secondBindingId), JSON.stringify(result.record.diagnostics));
  assert.equal(rows(result).length, 0);
});

test('animation project ZIP includes its controller and runs after author and build removal', real, async t => {
  const f = await build(t, f => f.script('checkpoint', commands(['seek_animation(0.5)', 'pause_animation()'])));
  const inspect = () => inspectBackendProject({ buildDirectory: f.output });
  const delivery = await planBackendProjectDelivery({ inspection: await inspect(), assertCurrent: inspect });
  const zip = path.join(f.temporary, 'delivery.zip'); await writeExportZip(delivery, zip); assert.ok((await verifyBackendProjectDelivery(zip)).fileCount > 0);
  const moved = path.join(f.temporary, 'moved'), archive = await yauzl.openPromise(zip, { lazyEntries: true, autoClose: false });
  const inventory = [];
  try { for await (const entry of archive.eachEntry()) {
    inventory.push(entry.fileName); const chunks = []; for await (const chunk of await archive.openReadStreamPromise(entry)) chunks.push(chunk);
    const file = path.join(moved, entry.fileName); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, Buffer.concat(chunks));
  } } finally { await new Promise(resolve => { archive.reader.once('close', resolve); archive.close(); }); }
  assert.ok(inventory.includes('project/project-control-runtime.gd')); assert.ok(inventory.includes('project/project-animation.gd'));
  const snapshot = JSON.parse(await fs.readFile(path.join(f.output, 'snapshot.json')));
  await fs.rm(f.author, { recursive: true }); await fs.rm(f.output, { recursive: true });
  const identified = await adapter.identify(tool), directory = path.join(moved, 'project');
  for (const phase of [...adapter.buildPhases, 'run']) {
    const result = await adapter.executePhase({ phase, directory, tool: identified, timeoutMs: 60000 });
    assert.equal(result.status, 'succeeded', result.stdout + result.stderr); assert.deepEqual(adapter.diagnostics(result, snapshot.plan), [], result.stdout + result.stderr);
    if (phase === 'run') { const reader = adapter.createEventReader(snapshot.plan); reader.push(result.stdout); assert.deepEqual(reader.finish().diagnostics, [], result.stdout + result.stderr); assert.equal(reader.events.filter(row => row.event === 'animation-command').length, 2); }
  }
});

test('real natural completion is independent of shutdown and play restarts from zero', real, async t => {
  const f = await build(t, f => f.script('checkpoint', `extends Node
func _ready() -> void:
\tcall_deferred("_observe")
func _observe() -> void:
\tvar scene = get_tree().root.get_node("VientoProject/VientoScene")
\tscene.project_host.elapsed_seconds += 1.25
\tscene.project_host.total_seconds += 1.25
\tscene.project_step(1.25)
\tprint("ANIMATION_COMPLETE:" + JSON.stringify([scene.animation_time, scene.project_animation_phase, scene.animation_finished]))
\tget_meta("viento_project").play_animation()
\tget_tree().root.propagate_notification(NOTIFICATION_WM_CLOSE_REQUEST)
`));
  const result = await run(f, { smoke: false }); assert.equal(result.ok, true, JSON.stringify(result.record?.diagnostics || result));
  assert.deepEqual(printed(result, 'ANIMATION_COMPLETE:'), [[1,'finished',false]]);
  assert.deepEqual(rows(result).map(row => [row.command.action,row.state.phase,row.state.positionSeconds]), [['play','playing',0]]);
});

test('real request accepted before animation becomes unavailable has no execution receipt', real, async t => {
  const f = await build(t, f => f.script('checkpoint', `extends Node
func _ready() -> void:
\tcall_deferred("_probe")
func _probe() -> void:
\tprint("ANIMATION_ACCEPTED:" + JSON.stringify(get_meta("viento_project").play_animation()))
\tget_tree().root.get_node("VientoProject/VientoScene").animation_started = false
`));
  const result = await run(f); rejected(result, f, 'runtime_behavior_animation_unavailable');
  assert.deepEqual(printed(result, 'ANIMATION_ACCEPTED:'), [true]); assert.equal(rows(result).length, 0);
});

test('real 257th session request preserves the first 256 completed command receipts', real, async t => {
  const f = await build(t, async f => {
    const source = next => `extends Node
func _ready() -> void:
\tvar p = get_meta("viento_project")
\tfor index in range(64):
\t\tif not p.stop_animation():
\t\t\treturn
\tp.request_scene("${next}")
`;
    await f.script('checkpoint', source(f.sceneIds[1])); await f.script('second', source(f.sceneIds[0]));
  });
  const result = await run(f); rejected(result, f, 'runtime_behavior_animation_limit');
  assert.equal(rows(result).length, 256);
  assert.deepEqual(rows(result).map(row => row.commandSequence), Array.from({ length: 256 }, (_, index) => index + 1));
});

test('real event commands execute after event delivery and audio but before scene exit', real, async t => {
  const f = await build(t, async f => {
    await f.edit('documents/projects/demo.json', document => { document.entrySceneId = f.sceneIds[1]; });
    const trackId = (await f.read('documents/audio/demo.json')).tracks[0].id;
    await f.script('second', `extends Node
var p
func _ready() -> void:
\tp = get_meta("viento_project")
\tp.subscribe_event("animate", _on_animate)
\tp.publish_event("animate", true)
func _on_animate(_value) -> bool:
\tif not p.seek_animation(0.5):
\t\treturn false
\treturn p.play_audio("${trackId}")
`);
  });
  const result = await run(f); assert.equal(result.ok, true, JSON.stringify(result.record?.diagnostics || result));
  const events = result.record.events;
  const delivered = events.findIndex(row => row.event === 'event-delivery'), audio = events.findIndex(row => row.event === 'audio-command');
  const animated = events.findIndex(row => row.event === 'animation-command'), exit = events.findIndex(row => row.event === 'scene-exit');
  assert.ok(delivered < audio && audio < animated && animated < exit);
  assert.equal(rows(result)[0].bindingId, f.secondBindingId);
});

test('real frame sampling recomputes from command anchors at a rounding-sensitive endpoint', real, async t => {
  const f = await build(t, f => f.script('checkpoint', `extends Node
func _ready() -> void:
\tvar p = get_meta("viento_project")
\tp.seek_animation(0.2)
\tp.play_animation()
\tcall_deferred("_probe")
func _probe() -> void:
\tvar scene = get_tree().root.get_node("VientoProject/VientoScene")
\tfor index in range(8):
\t\tscene.project_host.elapsed_seconds += 0.1
\t\tscene.project_host.total_seconds += 0.1
\t\tscene.project_step(0.1)
\tprint("ANIMATION_ROUNDING:" + JSON.stringify([scene.animation_time, scene.project_animation_phase]))
\tget_meta("viento_project").play_animation()
\tget_tree().root.propagate_notification(NOTIFICATION_WM_CLOSE_REQUEST)
`));
  const result = await run(f, { smoke: false }); assert.equal(result.ok, true, JSON.stringify(result.record?.diagnostics || result));
  assert.deepEqual(printed(result, 'ANIMATION_ROUNDING:'), [[1,'finished']]);
  assert.equal(rows(result).at(-1).state.positionSeconds, 0);
});
