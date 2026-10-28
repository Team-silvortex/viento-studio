import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import yauzl from 'yauzl';
import { projectAnimationClipsAuthor } from './helpers/project-animation-clips-author-fixture.mjs';
import { buildProject, runProjectBuild } from '../adapters/node-project-build.mjs';
import { captureBuildSnapshot } from '../adapters/node-build-snapshot.mjs';
import { GODOT4_EXECUTION_ADAPTER as adapter } from '../backends/godot4-adapter.mjs';
import { generateGodotAnimationProject as generateLegacy } from '../backends/godot4-sprite-animation.mjs';
import { godotAssemblyScripts } from '../backends/godot4-project.mjs';
import { inspectBackendProject } from '../adapters/node-backend-project.mjs';
import { planBackendProjectDelivery, verifyBackendProjectDelivery } from '../adapters/node-backend-project-delivery.mjs';
import { writeExportZip } from '../lib/export-package.mjs';
const tool = process.env.VIENTO_GODOT_BIN;
const real = { skip: !tool ? 'Set VIENTO_GODOT_BIN for actual clip transport' : false };
const rows = result => result.record.events.filter(row => row.event === 'animation-command');
const printed = (result, prefix) => result.record.phases.at(-1).stdout.split('\n').filter(line => line.startsWith(prefix)).map(line => JSON.parse(line.slice(prefix.length)));
const commands = actions => `extends Node\nfunc _ready() -> void:\n\tvar p = get_meta("viento_project")\n${actions.map(action => `\tp.${action}\n`).join('')}`;
async function build(t, edit, options) {
  const f = await projectAnimationClipsAuthor(t, options); if (edit) await edit(f);
  const output = path.join(f.temporary, 'clip-build');
  const built = await buildProject({ root: f.author, targetId: f.assemblyId, tool, output });
  assert.equal(built.ok, true, JSON.stringify(built.diagnostics || built.record?.diagnostics)); return { ...f, output };
}
const run = (f, options = {}) => runProjectBuild({ buildDirectory: f.output, tool, headless: true, smoke: true, ...options });
function rejected(result, f, code) {
  assert.equal(result.ok, false); assert.ok(result.record?.diagnostics.some(row => row.code === code && row.bindingId === f.bindingId), JSON.stringify(result));
  assert.equal(result.record.events.some(row => row.event === 'finished'), false);
  assert.equal(result.record.diagnostics.some(row => row.code === 'runtime_project_protocol_invalid'), false, JSON.stringify(result.record.diagnostics));
}

test('clip generation carries the directory, capability and source ownership without duplicating tracks or assets', async t => {
  for (const sprites of [false, true]) {
    const f = await projectAnimationClipsAuthor(t, { sprites }), captured = await captureBuildSnapshot(f.author, f.sceneIds[0]);
    assert.equal(captured.ok, true, JSON.stringify(captured.diagnostics));
    const generated = await adapter.generate(captured.plan), legacy = await generateLegacy(captured.plan);
    assert.equal(captured.plan.animation.schemaVersion, 2); assert.equal(generated.backend.version, '0.15.0');
    assert.ok(generated.backend.capabilities.includes('animation.clips2d'));
    assert.deepEqual(generated.files, legacy.files); assert.deepEqual(generated.resourceFiles, legacy.imageFiles);
    assert.deepEqual(JSON.parse(generated.files.get('animation.json')).clips.map(clip => clip.id), f.clipIds[0]);
    assert.deepEqual(generated.sourceMap.animation.clips.map(row => row.declaration.propertyPath), ['/clips/0', '/clips/1']);
  }
});

test('real same-clock selection and seek execute FIFO on local ranges and return to the whole timeline', real, async t => {
  const f = await build(t, f => f.script('checkpoint', commands([
    `select_animation_clip("${f.clipIds[0][0]}")`, 'seek_animation(0.5)', 'play_animation()', 'stop_animation()',
    `select_animation_clip("${f.clipIds[0][1]}")`, 'seek_animation(0.5)', 'play_animation()', 'select_animation_clip()', 'seek_animation(0.8)',
  ])));
  const result = await run(f); assert.equal(result.ok, true, JSON.stringify(result.record?.diagnostics || result));
  assert.equal(result.record.events[0].protocol, 7); assert.equal(result.record.events.at(-1).animationCommandSequence, 9);
  assert.deepEqual(rows(result).map(row => [row.command.action,row.state.clipId,row.state.positionSeconds,row.state.phase]), [
    ['select',f.clipIds[0][0],0,'paused'], ['seek',f.clipIds[0][0],0,'paused'], ['play',f.clipIds[0][0],0,'playing'], ['stop',f.clipIds[0][0],0,'stopped'],
    ['select',f.clipIds[0][1],0,'paused'], ['seek',f.clipIds[0][1],.5,'paused'], ['play',f.clipIds[0][1],0,'playing'], ['select',null,0,'paused'], ['seek',null,.8,'paused'],
  ]);
  const files = await godotAssemblyScripts(path.join(f.output, 'project')); assert.ok(files.includes('project-clip-runtime.gd'));
});

for (const sprites of [false,true]) test(`real nonloop clip samples the document endpoint once despite the whole loop (${sprites})`, real, async t => {
  const f = await build(t, f => f.script('checkpoint', `extends Node
func _ready() -> void:
\tvar p = get_meta("viento_project")
\tp.select_animation_clip("${f.clipIds[0][1]}")
\tp.seek_animation(0.5)
\tcall_deferred("_probe")
func _probe() -> void:
\tvar scene = get_tree().root.get_node("VientoProject/VientoScene")
\tprint("CLIP_VISUAL:" + JSON.stringify([scene.project_animation_position, scene.animation_time, scene.animation_visuals["${f.instanceId}"].position.x${sprites ? `, scene.animation_sprites["${f.instanceId}"].frame` : ''}]))
\tget_tree().root.propagate_notification(NOTIFICATION_WM_CLOSE_REQUEST)
`), { sprites });
  const result = await run(f, { smoke: false }); assert.equal(result.ok, true, JSON.stringify(result.record?.diagnostics || result));
  assert.deepEqual(printed(result, 'CLIP_VISUAL:'), [sprites ? [.5,1,100,3] : [.5,1,100]]);
});

test('real queued selection constrains a later seek at execution rather than admitting the old whole range', real, async t => {
  const f = await build(t, f => f.script('checkpoint', commands([`select_animation_clip("${f.clipIds[0][1]}")`, 'seek_animation(0.75)'])));
  const result = await run(f); rejected(result, f, 'runtime_behavior_animation_command');
  assert.deepEqual(rows(result).map(row => row.command.action), ['select']);
});

for (const argument of ['true', '"missing"', '"59595959-5959-4595-8595-000000000999"']) test(`real invalid clip selection ${argument} has no successful receipt`, real, async t => {
  const f = await build(t, f => f.script('checkpoint', commands([`select_animation_clip(${argument})`])));
  const result = await run(f); rejected(result, f, 'runtime_behavior_animation_clip'); assert.equal(rows(result).length, 0);
});

test('real selected clip clock is anchored across render steps, pause and natural completion', real, async t => {
  const f = await build(t, f => f.script('checkpoint', `extends Node
func _ready() -> void:
\tvar p = get_meta("viento_project")
\tp.select_animation_clip("${f.clipIds[0][1]}")
\tp.seek_animation(0.1)
\tp.play_animation()
\tcall_deferred("_probe")
func _probe() -> void:
\tvar scene = get_tree().root.get_node("VientoProject/VientoScene")
\tfor index in range(8):
\t\tscene.project_host.elapsed_seconds += 0.05
\t\tscene.project_host.total_seconds += 0.05
\t\tscene.project_step(0.05)
\tprint("CLIP_END:" + JSON.stringify([scene.project_animation_position,scene.project_animation_phase,scene.animation_time,scene.animation_finished]))
\tget_meta("viento_project").play_animation()
\tget_tree().root.propagate_notification(NOTIFICATION_WM_CLOSE_REQUEST)
`));
  const result = await run(f, { smoke: false }); assert.equal(result.ok, true, JSON.stringify(result.record?.diagnostics || result));
  assert.deepEqual(printed(result, 'CLIP_END:'), [[.5,'finished',1,false]]); assert.equal(rows(result).at(-1).state.positionSeconds, 0);
});

test('real mixed project supports whole selection in a legacy member and reentry revokes stale clip ports', real, async t => {
  const f = await build(t, async f => {
    await f.script('checkpoint', `extends Node
static var old
static var first := true
func _ready() -> void:
\tvar p = get_meta("viento_project")
\tif first:
\t\tfirst = false
\t\told = p
\t\tp.select_animation_clip("${f.clipIds[0][0]}")
\t\tp.request_scene("${f.sceneIds[1]}")
\telse:
\t\tp.pause_animation()
`);
    await f.script('second', `extends Node
func _ready() -> void:
\tvar p = get_meta("viento_project")
\tvar old = load("res://behaviors/${f.scriptId}.gd").old
\tprint("CLIP_STALE:" + JSON.stringify(old.select_animation_clip(null)))
\tp.select_animation_clip()
\tp.play_animation()
\tp.request_scene("${f.sceneIds[0]}")
`);
  }, { mixed: true });
  const result = await run(f); assert.equal(result.ok, true, JSON.stringify(result.record?.diagnostics || result));
  assert.deepEqual(printed(result, 'CLIP_STALE:'), [false]);
  assert.deepEqual(rows(result).map(row => [row.visitIndex,row.command.action,row.state.clipId,row.state.positionSeconds]), [[1,'select',f.clipIds[0][0],0],[2,'select',null,0],[2,'play',null,0],[3,'pause',null,0]]);
});

test('real mixed legacy member rejects a clip declared only by another scene', real, async t => {
  const f = await build(t, async f => {
    await f.script('checkpoint', commands([`request_scene("${f.sceneIds[1]}")`]));
    await f.script('second', commands([`select_animation_clip("${f.clipIds[0][0]}")`]));
  }, { mixed: true });
  const result = await run(f); assert.equal(result.ok, false);
  assert.ok(result.record.diagnostics.some(row => row.code === 'runtime_behavior_animation_clip' && row.bindingId === f.secondBindingId), JSON.stringify(result.record.diagnostics));
  assert.equal(rows(result).length, 0);
});

test('real single scene with a clip directory retains automatic whole playback', real, async t => {
  const f = await projectAnimationClipsAuthor(t), output = path.join(f.temporary, 'single');
  const built = await buildProject({ root: f.author, scene: f.sceneIds[0], tool, output });
  assert.equal(built.ok, true, JSON.stringify(built.diagnostics || built.record?.diagnostics));
  assert.equal(built.record.backend.version, '0.15.0');
  const result = await run({ output }); assert.equal(result.ok, true, JSON.stringify(result.record?.diagnostics || result));
  assert.equal(result.record.events.some(row => row.event === 'animation-command'), false);
});

test('clip project ZIP retains its directory, source map and controller after author/build deletion', real, async t => {
  const f = await build(t, f => f.script('checkpoint', commands([`select_animation_clip("${f.clipIds[0][1]}")`, 'seek_animation(0.5)'])));
  const inspect = () => inspectBackendProject({ buildDirectory: f.output });
  const delivery = await planBackendProjectDelivery({ inspection: await inspect(), assertCurrent: inspect });
  const zip = path.join(f.temporary, 'clips.zip'); await writeExportZip(delivery, zip); assert.ok((await verifyBackendProjectDelivery(zip)).fileCount > 0);
  const moved = path.join(f.temporary, 'moved'), archive = await yauzl.openPromise(zip, { lazyEntries: true, autoClose: false });
  const inventory = [];
  try { for await (const entry of archive.eachEntry()) {
    inventory.push(entry.fileName); const chunks = []; for await (const chunk of await archive.openReadStreamPromise(entry)) chunks.push(chunk);
    const file = path.join(moved, entry.fileName); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, Buffer.concat(chunks));
  } } finally { await new Promise(resolve => { archive.reader.once('close', resolve); archive.close(); }); }
  assert.ok(inventory.includes('project/project-clip-runtime.gd'));
  const runtimeBackend = JSON.parse(await fs.readFile(path.join(f.output, 'build.json'))).backend;
  const snapshot = JSON.parse(await fs.readFile(path.join(f.output, 'snapshot.json')));
  await fs.rm(f.author, { recursive: true }); await fs.rm(f.output, { recursive: true });
  const identified = await adapter.identify(tool), directory = path.join(moved, 'project');
  for (const phase of [...adapter.buildPhases, 'run']) {
    const result = await adapter.executePhase({ phase, directory, tool: identified, timeoutMs: 60000 });
    assert.equal(result.status, 'succeeded', result.stdout + result.stderr); assert.deepEqual(adapter.diagnostics(result, snapshot.plan), [], result.stdout + result.stderr);
    if (phase === 'run') { const reader = adapter.createEventReader(snapshot.plan, { capabilities: runtimeBackend.capabilities }); reader.push(result.stdout); assert.deepEqual(reader.finish().diagnostics, [], result.stdout + result.stderr); assert.equal(reader.events.filter(row => row.event === 'animation-command').length, 2); }
  }
});

test('real clip loop overrides a nonloop whole timeline and keeps the same local clock for sprite and transform', real, async t => {
  const f = await build(t, async f => {
    await f.edit('documents/animations/scene-0.json', document => { document.loop = false; });
    await f.script('checkpoint', `extends Node
func _ready() -> void:
\tvar p = get_meta("viento_project")
\tp.select_animation_clip("${f.clipIds[0][0]}")
\tp.play_animation()
\tcall_deferred("_probe")
func _probe() -> void:
\tvar scene = get_tree().root.get_node("VientoProject/VientoScene")
\tscene.project_host.elapsed_seconds += 1.25
\tscene.project_host.total_seconds += 1.25
\tscene.project_step(1.25)
\tprint("CLIP_LOOP:" + JSON.stringify([scene.project_animation_position,scene.animation_time,scene.animation_visuals["${f.instanceId}"].position.x,scene.animation_sprites["${f.instanceId}"].frame,scene.project_animation_phase]))
\tget_meta("viento_project").pause_animation()
\tget_tree().root.propagate_notification(NOTIFICATION_WM_CLOSE_REQUEST)
`);
  });
  const result = await run(f, { smoke: false }); assert.equal(result.ok, true, JSON.stringify(result.record?.diagnostics || result));
  assert.deepEqual(printed(result, 'CLIP_LOOP:'), [[.25,.5,50,3,'playing']]);
  assert.equal(rows(result).at(-1).state.positionSeconds, .25);
});
