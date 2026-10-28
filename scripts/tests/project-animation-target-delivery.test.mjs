import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import yauzl from 'yauzl';
import { projectAnimationClipsAuthor } from './helpers/project-animation-clips-author-fixture.mjs';
import { buildProject } from '../adapters/node-project-build.mjs';
import { inspectBackendProject } from '../adapters/node-backend-project.mjs';
import { planBackendProjectDelivery, verifyBackendProjectDelivery } from '../adapters/node-backend-project-delivery.mjs';
import { writeExportZip } from '../lib/export-package.mjs';
import { GODOT4_EXECUTION_ADAPTER as adapter } from '../backends/godot4-adapter.mjs';
import { godotAssemblyScripts } from '../backends/godot4-project.mjs';
import { generateEditableGodotAnimationStateScript } from '../../engine/animation-state-script-source.mjs';
import { DEFAULT_ANIMATION_STATE_TABLE } from '../../engine/godot-animation-state-script.mjs';

const tool = process.env.VIENTO_GODOT_BIN;
const instanceB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';
const probeBinding = '62626262-6262-4262-8262-000000000001';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
async function hashes(directory, prefix = '') {
  const result = {};
  for (const entry of (await fs.readdir(path.join(directory, prefix), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const name = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) Object.assign(result, await hashes(directory, name));
    else { assert.ok(entry.isFile(), name); result[name] = digest(await fs.readFile(path.join(directory, name))); }
  }
  return result;
}
const driver = `extends Node
func _ready() -> void:
\tcall_deferred("_probe")
func _probe() -> void:
\tvar host = get_tree().root.get_node("VientoProject")
\thost.set_process(false)
\thost.flush_requests()
\tvar port = get_meta("viento_project")
\tport.write_state("ready", true)
\tport.publish_event("action", true)
\thost.flush_requests()
\thost.elapsed_seconds += 0.5
\thost.total_seconds += 0.5
\thost.current.project_step(0.5)
\thost.flush_requests()
\tprint("DELIVERY_LANES:" + JSON.stringify(host.current.project_animation_lanes))
\thost.finish_project()
`;

test('protocol11 backend ZIP runs both instance controllers after author and build paths disappear', {
  skip: !tool ? 'Set VIENTO_GODOT_BIN for actual relocated target delivery' : false, timeout: 180000,
}, async t => {
  const f = await projectAnimationClipsAuthor(t, { sprites: true });
  const xdg = path.join(f.temporary, 'xdg');
  const savedEnvironment = Object.fromEntries(['XDG_CACHE_HOME', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME'].map(key => [key, process.env[key]]));
  for (const [key, name] of [['XDG_CACHE_HOME', 'cache'], ['XDG_CONFIG_HOME', 'config'], ['XDG_DATA_HOME', 'data']]) {
    process.env[key] = path.join(xdg, name); await fs.mkdir(process.env[key], { recursive: true });
  }
  t.after(() => { for (const [key, value] of Object.entries(savedEnvironment)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  } });
  const table = structuredClone(DEFAULT_ANIMATION_STATE_TABLE);
  table.transitions[0].trigger.condition = { combine: 'all', conditions: [
    { type: 'boolean', operator: 'eq', value: true },
    { type: 'boolean', operator: 'eq', value: true, selector: { kind: 'projectState', key: 'ready' } },
  ] };
  const source = generateEditableGodotAnimationStateScript(table).content;
  await f.script('checkpoint', source); await f.script('second', driver);
  await f.edit('documents/animations/scene-0.json', document => {
    document.schemaVersion = 4; document.playbackScope = 'instance';
    document.tracks.push(...document.tracks.map((track, index) => ({ ...structuredClone(track),
      id: `62626262-6262-4262-8262-${String(index + 100).padStart(12, '0')}`, instanceId: instanceB })));
  });
  await f.edit('documents/behaviors/demo.json', document => {
    const first = document.bindings[0]; first.parameters = { clip_idle: f.clipIds[0][0], clip_action: f.clipIds[0][1] };
    document.bindings.push({ ...structuredClone(first), bindingId: f.secondBindingId, instanceId: instanceB });
    document.bindings.push({ ...structuredClone(first), bindingId: probeBinding, parameters: {},
      implementation: { ...first.implementation, sourceObjectId: f.secondScriptId } });
  });
  await f.edit('metadata/documents/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee.json', document => {
    document.relations.push({ kind: 'reference', targetId: f.secondScriptId, slot: 'implementation' });
  });
  const before = await hashes(f.author), buildDirectory = path.join(f.temporary, 'build');
  const report = { format: 'viento-animation-target-delivery-test', schemaVersion: 1, success: false,
    assertions: [], authorBefore: before, phases: [], sourceDependencies: {} };
  const evidence = process.env.VIENTO_TARGET_DELIVERY_EVIDENCE;
  if (evidence) await fs.mkdir(evidence, { recursive: true });
  t.after(async () => { if (evidence) await fs.writeFile(path.join(evidence, 'report.json'), JSON.stringify(report, null, 2) + '\n'); });
  const built = await buildProject({ root: f.author, targetId: f.assemblyId, tool, output: buildDirectory });
  if (evidence && built.record) await fs.writeFile(path.join(evidence, 'build.json'), JSON.stringify(built.record, null, 2) + '\n');
  assert.equal(built.ok, true, JSON.stringify(built.record?.diagnostics || built));
  assert.deepEqual(await hashes(f.author), before);
  const snapshot = JSON.parse(await fs.readFile(path.join(buildDirectory, 'snapshot.json')));
  const inspect = () => inspectBackendProject({ buildDirectory });
  const delivery = await planBackendProjectDelivery({ inspection: await inspect(), assertCurrent: inspect });
  const zip = path.join(f.temporary, 'instance-targets.zip');
  await writeExportZip(delivery, zip);
  report.delivery = await verifyBackendProjectDelivery(zip);
  report.zip = { bytes: (await fs.stat(zip)).size, sha256: digest(await fs.readFile(zip)) };
  assert.ok(report.delivery.fileCount > 0);
  report.assertions.push('recorded backend project ZIP passes delivery verification');
  const moved = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-target-delivery-relocated-'));
  t.after(() => fs.rm(moved, { recursive: true, force: true }));
  const archive = await yauzl.openPromise(zip, { lazyEntries: true, autoClose: false });
  const zipFiles = [];
  try { for await (const entry of archive.eachEntry()) {
    assert.ok(!entry.fileName.startsWith('/') && !entry.fileName.split('/').includes('..'));
    const chunks = []; for await (const chunk of await archive.openReadStreamPromise(entry)) chunks.push(chunk);
    const file = path.join(moved, entry.fileName);
    await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, Buffer.concat(chunks)); zipFiles.push(entry.fileName);
  } } finally { await new Promise(resolve => { archive.reader.once('close', resolve); archive.close(); }); }
  report.zipFiles = zipFiles;
  const directory = path.join(moved, 'project');
  const inventory = JSON.parse(await fs.readFile(path.join(directory, 'assembly.json')));
  assert.equal(inventory.schemaVersion, 12);
  assert.deepEqual(inventory.scenes.map(scene => scene.animationScope), ['instance', 'scene']);
  assert.equal(inventory.animationStateWrappers.length, 1);
  const scripts = await godotAssemblyScripts(directory);
  report.inventory = inventory; report.scripts = scripts;
  const expectedProject = await adapter.generate(snapshot.plan);
  const directModules = ['project-animation-target-runtime.gd', 'project-animation-targets.gd', 'project-animation-target-completions.gd'];
  for (const name of directModules) {
    assert.ok(scripts.includes(name));
    const expected = await fs.readFile(new URL('../backends/godot4/' + name, import.meta.url));
    assert.deepEqual(await fs.readFile(path.join(directory, name)), expectedProject.files.get(name));
    if (name === 'project-animation-target-runtime.gd') assert.deepEqual(
      await fs.readFile(path.join(directory, `execution-frames-original-${name}.txt`)), expected);
    report.sourceDependencies[name] = digest(expected);
  }
  for (const name of scripts) assert.ok(zipFiles.includes('project/' + name), name);
  for (const scene of inventory.scenes) {
    const sceneScript = await fs.readFile(path.join(directory, path.dirname(scene.entry), 'project-scene.gd'), 'utf8');
    assert.ok(sceneScript.includes('func project_animation_target_snapshot('));
    assert.ok(sceneScript.includes('func project_animation_execute_target('));
  }
  for (const name of ['project-animation-target-scene.gd', '../../engine/project-animation-targets.mjs']) {
    const url = name.startsWith('../') ? new URL(name, new URL('../backends/', import.meta.url)) : new URL('../backends/godot4/' + name, import.meta.url);
    report.sourceDependencies[name] = digest(await fs.readFile(url));
  }
  assert.ok(!zipFiles.some(name => name.startsWith('project/engine/') || name.endsWith('snapshot.json') || name.includes('/.godot/')));
  for (const [id, expected] of [[f.scriptId, source], [f.secondScriptId, driver]]) {
    assert.equal(await fs.readFile(path.join(directory, 'behaviors', id + '.gd'), 'utf8'), expected);
  }
  report.assertions.push('inventory12 mixed scopes, wrappers and every declared script exist in ZIP',
    'three target runtime files match current generated bytes; original coordinator backup matches the frozen source',
    'host target helper remains an adapter dependency, with no host JS dependency in generated project',
    'v5 authored state script and probe source preserved byte-for-byte');
  await fs.rename(f.author, f.author + '.offline'); await fs.rename(buildDirectory, buildDirectory + '.offline');
  await assert.rejects(fs.access(f.author)); await assert.rejects(fs.access(buildDirectory));
  report.assertions.push('original author and build paths absent during relocated execution');
  const identified = await adapter.identify(tool); report.tool = identified;
  for (const phase of [...adapter.buildPhases, 'run']) {
    const result = await adapter.executePhase({ phase, directory, tool: identified, smoke: false, timeoutMs: 60000 });
    report.phases.push({ phase, ...result });
    assert.equal(result.status, 'succeeded', result.stdout + result.stderr);
    assert.deepEqual(adapter.diagnostics(result, snapshot.plan), [], result.stdout + result.stderr);
    if (phase !== 'run') continue;
    const reader = adapter.createEventReader(snapshot.plan, { capabilities: built.record.backend.capabilities }); reader.push(result.stdout);
    assert.deepEqual(reader.finish().diagnostics, [], result.stdout + result.stderr);
    const events = reader.events; report.events = events;
    assert.equal(events[0].protocol, 11); assert.equal(events.at(-1).event, 'finished');
    const commands = events.filter(row => row.event === 'animation-command');
    assert.equal(commands.length, 12);
    assert.deepEqual([...new Set(commands.map(row => row.target.instanceId))].sort(), [f.instanceId, instanceB].sort());
    const completed = events.filter(row => row.event === 'animation-completed');
    assert.equal(completed.length, 2);
    assert.deepEqual(completed.map(row => row.target.instanceId).sort(), [f.instanceId, instanceB].sort());
    assert.ok(completed.every(row => row.commandSequence === 8 && row.state.timeSeconds === .5 && row.recipients.length === 1));
    assert.deepEqual(events.filter(row => row.event === 'animation-completion-delivery').map(row => row.status), ['handled', 'handled']);
    const entries = events.filter(row => row.event === 'animation-state-entered');
    assert.equal(entries.length, 6);
    assert.deepEqual(entries.map(row => row.stateIndex), [0, 0, 1, 1, 0, 0]);
    assert.deepEqual(entries.slice(-2).map(row => row.trigger.completionSequence), [1, 2]);
    report.assertions.push('relocated real Godot imports, checks all scripts, and finishes without protocol diagnostics',
      'both target controllers execute idle→action→completion→idle with two independently anchored completions');
  }
  report.authorAfter = await hashes(f.author + '.offline'); assert.deepEqual(report.authorAfter, before);
  assert.equal(await fs.readFile(path.join(directory, 'behaviors', f.scriptId + '.gd'), 'utf8'), source);
  report.assertions.push('all author fixture file hashes unchanged after build, ZIP and relocated run');
  report.success = true;
  if (evidence) { await fs.copyFile(zip, path.join(evidence, 'instance-targets.zip')); await fs.writeFile(path.join(evidence, 'author-sha256.json'), JSON.stringify({ before, after: report.authorAfter }, null, 2) + '\n'); }
});
