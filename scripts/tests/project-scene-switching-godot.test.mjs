import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { projectSceneSwitchingAuthor } from './helpers/project-scene-switching-fixture.mjs';
import { captureBuildSnapshot } from '../adapters/node-build-snapshot.mjs';
import { buildProject, runProjectBuild } from '../adapters/node-project-build.mjs';
import { GODOT4_EXECUTION_ADAPTER as adapter } from '../backends/godot4-adapter.mjs';
import { validateGeneratedExecutionProject } from '../adapters/node-execution-backends.mjs';
import { listScriptStarters } from '../../engine/script-authoring.mjs';

const executable = process.env.VIENTO_GODOT_BIN;
const real = { skip: !executable ? 'Set VIENTO_GODOT_BIN for real project transitions' : false };
const json = value => JSON.stringify(value, null, 2) + '\n';
async function materialize(t, options = {}, edit) {
  const f = await projectSceneSwitchingAuthor(t, options); if (edit) await edit(f);
  const captured = await captureBuildSnapshot(f.author, f.assemblyId); assert.equal(captured.ok, true, JSON.stringify(captured.diagnostics));
  const generated = validateGeneratedExecutionProject(adapter, captured.plan, await adapter.generate(captured.plan)), directory = path.join(f.temporary, 'generated');
  for (const [name, bytes] of [...generated.files, ...[...generated.resourceFiles].map(([id, name]) => [name, captured.resources.get(id)])]) {
    const file = path.join(directory, name); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, bytes);
  }
  return { ...f, captured, generated, directory };
}
async function prepare(t, options, edit) {
  const f = await materialize(t, options, edit), tool = await adapter.identify(executable);
  for (const phase of adapter.buildPhases) {
    const result = await adapter.executePhase({ phase, directory: f.directory, tool, timeoutMs: 60000 });
    assert.equal(result.status, 'succeeded', result.stdout + result.stderr);
    assert.deepEqual(adapter.diagnostics(result, f.captured.plan), [], result.stdout + result.stderr);
  }
  return { ...f, tool };
}
async function run(f, options = {}) {
  const result = await adapter.executePhase({ phase: 'run', directory: f.directory, tool: f.tool, timeoutMs: 30000, ...options });
  const reader = adapter.createEventReader(f.captured.plan, { capabilities: f.generated.backend.capabilities }); reader.push(result.stdout); const received = reader.finish();
  return { result, received };
}
const enters = received => received.events.filter(frame => frame.event === 'scene-enter');
const exits = received => received.events.filter(frame => frame.event === 'scene-exit');

test('project generated bridge owns lifecycle while copied author scripts and saved schema stay unchanged', async t => {
  const f = await materialize(t), before = JSON.stringify(f.captured.plan);
  assert.match(f.generated.files.get('project.godot').toString(), /run\/main_scene="res:\/\/project.tscn"/);
  assert.ok(f.generated.files.has('project-runtime.gd'));
  for (const child of f.captured.plan.scenes) {
    const prefix = `scenes/${child.scene.objectId}`;
    assert.match(f.generated.files.get(`${prefix}/behavior-runtime.gd`).toString(), /set_meta\("viento_project", call\("project_behavior_port", binding, instance\)\)/);
    for (const script of child.behaviors.sources) assert.equal(f.generated.files.get(`behaviors/${script.objectId}.gd`).toString(), script.content);
  }
  assert.equal(JSON.stringify(f.captured.plan), before); assert.equal(f.captured.plan.schemaVersion, 1);
  assert.equal(f.captured.plan.requiredCapabilities.includes('project.scene-switching'), false);
  assert.ok(f.generated.backend.capabilities.includes('project.scene-switching'));
});

test('real Godot A→B→A uses the built-in starter, records fresh visits and stops B audio before returning', real, async t => {
  const f = await prepare(t, {}, async value => {
    const starter = listScriptStarters().find(item => item.id === 'godot-scene-switch'); assert.ok(starter);
    await fs.writeFile(path.join(value.author, 'documents/scripts/second.txt'), starter.content);
    const file = path.join(value.author, 'documents/behaviors/second.json'), manifest = JSON.parse(await fs.readFile(file));
    manifest.bindings[0].parameters = { target_scene_id: value.sceneIds[0] }; await fs.writeFile(file, json(manifest));
  });
  const { result, received } = await run(f);
  assert.equal(result.status, 'succeeded', result.stdout + result.stderr); assert.deepEqual(received.diagnostics, [], result.stdout + result.stderr);
  assert.deepEqual(enters(received).map(frame => frame.sceneId), [f.sceneIds[0], f.sceneIds[1], f.sceneIds[0]]);
  assert.deepEqual(enters(received).map(frame => frame.visitIndex), [1, 2, 3]);
  assert.deepEqual(exits(received).map(frame => [frame.reason, frame.elapsedSeconds]), [['switch', 0], ['switch', 0], ['finished', .5]]);
  const audioFinish = received.events.findIndex(frame => frame.event === 'scene-event' && frame.visitIndex === 2 && frame.stream === 'audio' && frame.frame.event === 'finished');
  const leave = received.events.findIndex(frame => frame.event === 'scene-exit' && frame.visitIndex === 2);
  assert.ok(audioFinish >= 0 && audioFinish < leave); assert.equal(received.events[audioFinish].frame.timeSeconds, 0);
  const readyStates = received.events.filter(frame => frame.event === 'scene-event' && frame.stream === 'runtime' && frame.frame.event === 'ready');
  assert.deepEqual(readyStates[0].frame.actors, readyStates[2].frame.actors);
  assert.deepEqual(received.events.at(-1), { protocol: 4, event: 'finished', assemblyId: f.assemblyId, visitCount: 3, totalSeconds: .5, stateRevision: 0, eventSequence: 0, audioCommandSequence: 0 });
  assert.equal(result.stdout.split('\n').some(line => /^VIENTO_(?:RUNTIME|AUDIO):/.test(line)), false);
});

test('real Godot rejects an old visit port without polluting the next visit or preventing its own valid request', real, async t => {
  const f = await prepare(t, {}, async value => {
    const first = path.join(value.author, 'documents/scripts/checkpoint.txt');
    let source = await fs.readFile(first, 'utf8'); source = source.replace('static var first_visit', 'static var retained_port\nstatic var first_visit');
    source = source.replace('\tfirst_visit = false', '\tfirst_visit = false\n\tretained_port = get_meta("viento_project")'); await fs.writeFile(first, source);
    const second = path.join(value.author, 'documents/scripts/second.txt');
    await fs.writeFile(second, `extends Node\nfunc _ready() -> void:\n\tvar previous = load("res://behaviors/${value.scriptId}.gd").retained_port\n\tprint("STALE_PORT:" + str(previous.request_scene("${value.sceneIds[0]}")))\n\tget_meta("viento_project").request_scene("${value.sceneIds[0]}")\n`);
  });
  const { result, received } = await run(f); assert.equal(result.status, 'succeeded', result.stdout + result.stderr);
  assert.deepEqual(received.diagnostics, [], result.stdout + result.stderr); assert.match(result.stdout, /STALE_PORT:false/);
  assert.equal(enters(received).length, 3);
});

for (const [mode, code, count] of [['invalid-target', 'runtime_behavior_scene_target', 1], ['loop', 'runtime_behavior_scene_limit', 64]]) {
  test(`real Godot ${mode} fails at the requesting binding without a false completion`, real, async t => {
    const f = await prepare(t, { mode }), { result, received } = await run(f);
    assert.equal(result.status, 'failed', result.stdout + result.stderr);
    assert.ok(received.diagnostics.some(item => item.code === code && item.objectId && item.sourcePath), JSON.stringify(received.diagnostics));
    assert.equal(received.diagnostics.some(item => item.code === 'runtime_project_protocol_invalid'), false, JSON.stringify(received.diagnostics));
    assert.equal(enters(received).length, count); assert.equal(received.events.some(frame => frame.event === 'finished'), false);
  });
}

test('real live project processes each author behavior once per frame and closes with an ordered audio exit', real, async t => {
  const f = await prepare(t, { mode: 'no-switch' }, async value => {
    await fs.writeFile(path.join(value.author, 'documents/scripts/checkpoint.txt'), `extends Node\nvar last_frame := -1\nvar count := 0\nfunc _process(_delta: float) -> void:\n\tvar frame := Engine.get_process_frames()\n\tif frame == last_frame:\n\t\tpush_error("DUPLICATE_AUTHOR_PROCESS")\n\tlast_frame = frame\n\tcount += 1\n\tif count == 2:\n\t\tget_meta("viento_project").request_scene("${value.sceneIds[1]}")\n`);
    await fs.writeFile(path.join(value.author, 'documents/scripts/second.txt'), 'extends Node\nvar count := 0\nfunc _process(_delta: float) -> void:\n\tcount += 1\n\tif count == 3:\n\t\tget_tree().root.propagate_notification(NOTIFICATION_WM_CLOSE_REQUEST)\n');
  });
  const { result, received } = await run(f, { smoke: false });
  assert.equal(result.status, 'succeeded', result.stdout + result.stderr); assert.deepEqual(received.diagnostics, [], result.stdout + result.stderr);
  assert.equal(result.stdout.includes('DUPLICATE_AUTHOR_PROCESS'), false); assert.equal(result.stderr.includes('DUPLICATE_AUTHOR_PROCESS'), false);
  assert.deepEqual(enters(received).map(frame => frame.sceneId), f.sceneIds);
  assert.ok(exits(received).every(frame => frame.elapsedSeconds > 0)); assert.equal(received.events.at(-1).event, 'finished');
});

test('real project supports legacy v1 members and retains the two fixed actor steps', real, async t => {
  const f = await prepare(t, { mode: 'no-switch' }, async value => {
    for (const [index, id] of value.sceneIds.entries()) {
      const file = path.join(value.author, `documents/scenes/${index === 0 ? 'demo' : 'audio'}.json`), scene = JSON.parse(await fs.readFile(file));
      scene.schemaVersion = 1; scene.actors = [scene.actors[0]]; delete scene.actors[0].instanceId;
      scene.actors[0].controls = 'arrows'; scene.actors[0].speed = 80; await fs.writeFile(file, json(scene));
      const metadata = path.join(value.author, `metadata/documents/${id}.json`), record = JSON.parse(await fs.readFile(metadata));
      record.relations = record.relations.filter(relation => !['behavior', 'audio'].includes(relation.kind)); await fs.writeFile(metadata, json(record));
    }
  });
  const { result, received } = await run(f); assert.equal(result.status, 'succeeded', result.stdout + result.stderr);
  assert.deepEqual(received.diagnostics, [], result.stdout + result.stderr);
  assert.equal(enters(received).length, 1); assert.equal(exits(received)[0].elapsedSeconds, .5);
  assert.equal(exits(received)[0].actors[0].position[0], f.captured.plan.scenes[0].actors[0].position[0] + 20);
  assert.equal(exits(received)[0].actors[0].state, 'idle');
});


test('real host rejects an early-close project smoke without rejecting an unrestricted zero-duration run', real, async t => {
  const f = await projectSceneSwitchingAuthor(t, { mode: 'no-switch' });
  await fs.writeFile(path.join(f.author, 'documents/scripts/checkpoint.txt'),
    'extends Node\nfunc _ready() -> void:\n\tget_tree().root.propagate_notification(NOTIFICATION_WM_CLOSE_REQUEST)\n');
  const output = path.join(f.temporary, 'early-close-build');
  const built = await buildProject({ root: f.author, targetId: f.assemblyId, tool: executable, output });
  assert.equal(built.ok, true, JSON.stringify(built.diagnostics || built.record?.diagnostics));
  const bounded = await runProjectBuild({ buildDirectory: output, tool: executable, headless: true, smoke: true });
  assert.equal(bounded.ok, false); assert.equal(bounded.status, 'failed');
  assert.ok(bounded.record.diagnostics.some(item => item.code === 'runtime_protocol_incomplete'), JSON.stringify(bounded.record.diagnostics));
  assert.equal(bounded.record.events.at(-1).event, 'scene-exit');
  assert.equal(bounded.record.events.at(-1).elapsedSeconds, 0);
  assert.equal(bounded.record.events.some(frame => frame.event === 'finished'), false);
  const unrestricted = await runProjectBuild({ buildDirectory: output, tool: executable, headless: true, smoke: false });
  assert.equal(unrestricted.ok, true, JSON.stringify(unrestricted.record?.diagnostics));
  assert.deepEqual(unrestricted.record.diagnostics, []);
  assert.equal(unrestricted.record.events.at(-1).event, 'finished');
  assert.equal(unrestricted.record.events.at(-1).totalSeconds, 0);
});
