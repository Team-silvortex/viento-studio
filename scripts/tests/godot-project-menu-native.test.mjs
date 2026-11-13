import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import yauzl from 'yauzl';
import { GODOT_PROJECT_MENU_SCRIPT } from '../../engine/godot-project-menu-script.mjs';
import { godotProjectMenuAuthor, menuInventory, menuCanonical, menuPauseAuthor, menuId } from './helpers/project-menu-author-fixture.mjs';
import { captureBuildSnapshot } from '../adapters/node-build-snapshot.mjs';
import { GODOT4_EXECUTION_ADAPTER as adapter } from '../backends/godot4-adapter.mjs';
import { runBuildProcess } from '../lib/build-process.mjs';
import { buildProject } from '../adapters/node-project-build.mjs';
import { inspectBackendProject } from '../adapters/node-backend-project.mjs';
import { planBackendProjectDelivery, verifyBackendProjectDelivery } from '../adapters/node-backend-project-delivery.mjs';
import { writeExportZip } from '../lib/export-package.mjs';

const executable = process.env.VIENTO_GODOT_BIN;
const native = { skip: !executable ? 'Set VIENTO_GODOT_BIN for actual project menu tests' : false, timeout: 240000 };
const windowNative = { ...native, skip: !executable || !process.env.VIENTO_XVFB_TEST ? 'Set VIENTO_GODOT_BIN and VIENTO_XVFB_TEST under isolated Xvfb for actual keyboard evidence' : false };
const hash = value => createHash('sha256').update(value).digest('hex');
const sourceNames = ['engine/project-menu.mjs', 'engine/scene-menu-capability.mjs', 'scripts/backends/godot4-project-menu.mjs', 'scripts/backends/godot4-project-menu-projection.mjs', 'scripts/backends/godot4-project-menu-inventory.mjs', 'scripts/backends/godot4-project-pause-inventory.mjs', 'engine/godot-project-menu-script.mjs', 'scripts/backends/godot4/project-menu-runtime.gd', 'scripts/backends/godot4/project-menu-input.gd', 'scripts/backends/godot4-adapter.mjs', 'scripts/tests/godot-project-menu-native.test.mjs', 'scripts/tests/helpers/project-menu-author-fixture.mjs', 'scripts/tests/helpers/project-menu-observer.gd', 'scripts/tests/helpers/project-menu-keyboard.py'];
const sourceHashes = async () => Object.fromEntries(await Promise.all(sourceNames.map(async name => [name, hash(await fs.readFile(name))])));
const succeeded = result => { assert.equal(result.status, 'succeeded', result.stdout + result.stderr); assert.doesNotMatch(result.stdout + result.stderr, /(?:SCRIPT ERROR:|ERROR:|PAUSE_OBSERVER_ERROR:)/); };
const envFor = f => ({ ...process.env, LIBGL_ALWAYS_SOFTWARE: '1', GODOT_SILENCE_ROOT_WARNING: '1', XDG_DATA_HOME: path.join(f.temporary, 'xdg/data'), XDG_CONFIG_HOME: path.join(f.temporary, 'xdg/config'), XDG_CACHE_HOME: path.join(f.temporary, 'xdg/cache') });
const printed = (stdout, prefix) => stdout.split('\n').filter(line => line.startsWith(prefix)).map(line => JSON.parse(line.slice(prefix.length)));
function evidenceDirectory() {
  const requested = process.env.VIENTO_PROJECT_MENU_EVIDENCE_DIR;
  if (!requested) return null;
  const resolved = path.resolve(requested), topic = path.resolve('docs/test-results/project-menu');
  assert.ok(resolved.startsWith('/tmp/') || resolved.startsWith(topic + path.sep), 'Use /tmp or a fresh project-menu evidence directory');
  return resolved;
}
async function evidence(name, value) {
  const directory = evidenceDirectory(); if (!directory) return;
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, name + '.json'), JSON.stringify(value, null, 2) + '\n');
}
async function unchanged(f) {
  for (const [name, bytes] of f.generated.files) assert.deepEqual(await fs.readFile(path.join(f.directory, name)), bytes, name);
}
async function prepare(t, options) {
  const f = await godotProjectMenuAuthor(t, options), before = await menuInventory(f.author), captured = await captureBuildSnapshot(f.author, f.assemblyId);
  assert.equal(captured.ok, true, JSON.stringify(captured.diagnostics));
  const generated = await adapter.generate(captured.plan), directory = path.join(f.temporary, 'generated');
  assert.ok(generated.backend.capabilities.includes('project.menu')); assert.ok(generated.backend.capabilities.includes('project.pause'));
  assert.ok(generated.files.has('project-menu-runtime.gd'));
  for (const [name, bytes] of [...generated.files, ...[...generated.resourceFiles].map(([id, name]) => [name, captured.resources.get(id)])]) {
    const file = path.join(directory, name); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, bytes);
  }
  const tool = await adapter.identify(executable);
  for (const phase of adapter.buildPhases) succeeded(await adapter.executePhase({ phase, directory, tool, timeoutMs: 90000 }));
  return { ...f, before, captured, generated, directory, tool };
}
async function installProbe(f, name, source) {
  await fs.writeFile(path.join(f.directory, name + '.gd'), source);
  await fs.writeFile(path.join(f.directory, name + '.tscn'), `[gd_scene load_steps=2 format=3]\n\n[ext_resource type="Script" path="res://${name}.gd" id="1"]\n\n[node name="VientoProject" type="Node2D"]\nscript = ExtResource("1")\n`);
  return async () => { for (const suffix of ['.gd', '.gd.uid', '.tscn']) await fs.rm(path.join(f.directory, name + suffix), { force: true }); };
}
function readEvents(f, stdout) {
  const reader = adapter.createEventReader(f.captured.plan, { capabilities: f.generated.backend.capabilities }); reader.push(stdout);
  return { reader, received: reader.finish() };
}

test('native menu ports revoke old visits and paused navigation, retry and restart cannot unfreeze gameplay', native, async t => {
  const sourceBefore = await sourceHashes(), canonicalBefore = await menuInventory(menuCanonical), previousPauseBefore = await menuInventory(menuPauseAuthor), f = await prepare(t);
  const probe = `extends "res://project-menu-runtime.gd"
func _ready() -> void:
\tsuper._ready()
\tcall_deferred("check_contract")
func check_contract() -> void:
\tawait get_tree().process_frame
\tvar start_behavior = current.find_child("behavior_${f.bindingIds.start.replaceAll('-', '_')}", true, false)
\tvar stale = start_behavior.get_meta("viento_project_menu")
\tassert(start_behavior.get_meta("viento_project_retry").request_retry(${JSON.stringify(f.gameId)}, {"score":0,"health":3,"door_open":false}))
\tflush_requests()
\tassert(not stale.configure("Stale", '[{"id":"finish","label":"Exit","command":"finish"}]', "scene"))
\tvar behavior = current.find_child("behavior_${f.bindingIds.level.replaceAll('-', '_')}", true, false)
\tvar port = behavior.get_meta("viento_project_menu")
\tvar pause = behavior.get_meta("viento_project_pause")
\tassert(not MenuPort.new(self).configure("Forged", '[{"id":"finish","label":"Exit","command":"finish"}]', "scene"))
\tfor command in ["scene", "retry", "restart"]:
\t\tvar item := {"id":"forbidden","label":"Forbidden","command":command}
\t\tif command in ["scene", "retry"]:
\t\t\titem["targetSceneId"] = ${JSON.stringify(f.menuId)}
\t\tassert(menu_parse(JSON.stringify([item]), "paused") == null)
\t\tassert(not port.configure("Forbidden", JSON.stringify([item]), "paused"))
\tvar before_state = shared_state.duplicate(true)
\tvar before_budget = execution_budget.snapshot()
\tvar before_revision := state_revision
\tvar before_visit := visit_index
\tvar before_node = current.get_instance_id()
\tvar before_seconds := total_seconds
\tassert(pause.request_pause(true))
\tassert(not behavior.get_meta("viento_project").request_scene(${JSON.stringify(f.winId)}))
\tassert(not behavior.get_meta("viento_project_retry").request_retry(${JSON.stringify(f.menuId)}, {"score":99}))
\tassert(not behavior.get_meta("viento_project_restart").request_restart({"score":99}))
\tassert(not menu_dispatch(self, port, "resume", "paused"))
\tawait get_tree().process_frame
\tassert(get_tree().paused and pause.status() == "paused")
\tassert(shared_state == before_state and execution_budget.snapshot() == before_budget and state_revision == before_revision)
\tassert(visit_index == before_visit and current.get_instance_id() == before_node and total_seconds == before_seconds)
\tprint("MENU_CONTRACT:" + JSON.stringify({"ok":true,"pausedCommandsRejected":["scene","retry","restart"],"state":shared_state,"visit":visit_index,"budget":execution_budget.snapshot()}))
\tfinish_project()
`;
  const cleanup = await installProbe(f, 'project-menu-contract', probe); let result;
  try { result = await runBuildProcess(executable, ['--headless', '--path', f.directory, 'res://project-menu-contract.tscn'], { cwd: f.directory, env: envFor(f), timeoutMs: 45000 }); succeeded(result); }
  finally { await cleanup(); }
  const contracts = printed(result.stdout, 'MENU_CONTRACT:'); assert.equal(contracts.length, 1); assert.equal(contracts[0].ok, true);
  const { received } = readEvents(f, result.stdout); assert.deepEqual(received.diagnostics, []); assert.equal(received.events.at(-1).event, 'finished');
  await unchanged(f); assert.deepEqual(await menuInventory(f.author), f.before); assert.deepEqual(await menuInventory(menuCanonical), canonicalBefore); assert.deepEqual(await sourceHashes(), sourceBefore); assert.deepEqual(await menuInventory(menuPauseAuthor), previousPauseBefore);
  await evidence('controlled-contracts', { ok: true, scope: 'Actual registered visit ports and parser in explicit API probes; no GUI claim.', probe, stdout: result.stdout, stderr: result.stderr, contracts, sourceBefore, sourceAfter: await sourceHashes(), previousPauseBefore, previousPauseAfter: await menuInventory(menuPauseAuthor), authorBefore: f.before, authorAfter: await menuInventory(f.author) });
});

async function keyboard(f, output, mode = 'full') {
  await fs.mkdir(output, { recursive: true });
  const observer = await fs.readFile(new URL('./helpers/project-menu-observer.gd', import.meta.url), 'utf8'), observerName = 'project-menu-observer';
  await fs.writeFile(path.join(f.directory, observerName + '.gd'), observer);
  await fs.writeFile(path.join(f.directory, observerName + '.tscn'), `[gd_scene load_steps=2 format=3]\n\n[ext_resource type="Script" path="res://${observerName}.gd" id="1"]\n\n[node name="VientoProject" type="Node2D"]\nscript = ExtResource("1")\nsample_directory = ${JSON.stringify(path.join(output, 'frames'))}\n`);
  try {
    succeeded(await runBuildProcess(executable, ['--path', f.directory, '--headless', '--check-only', '--script', 'res://project-menu-observer.gd'], { cwd: f.directory, env: envFor(f), timeoutMs: 45000 }));
    succeeded(await runBuildProcess('python3', [fileURLToPath(new URL('./helpers/project-menu-keyboard.py', import.meta.url)), executable, f.directory, output, mode], { cwd: f.directory, env: envFor(f), timeoutMs: 120000 }));
  } finally { for (const suffix of ['.gd', '.gd.uid', '.tscn']) await fs.rm(path.join(f.directory, observerName + suffix), { force: true }); }
  const stdout = await fs.readFile(path.join(output, 'window-output.log'), 'utf8'), data = JSON.parse(await fs.readFile(path.join(output, 'keyboard.json'))), { received } = readEvents(f, stdout);
  assert.deepEqual(received.diagnostics, [], JSON.stringify(received.diagnostics)); assert.equal(received.events.at(-1).event, 'finished');
  const visits = received.events.filter(row => row.event === 'scene-enter');
  if (mode === 'scene-restart') {
    assert.deepEqual(visits.map(row => row.sceneId), [f.menuId, f.menuId, f.menuId]); assert.deepEqual(visits.map(row => row.visitIndex), [1, 2, 3]);
    assert.ok(data.actions.some(row => row.mouse === 'restart'));
  } else if (mode === 'full') {
    assert.deepEqual(visits.map(row => row.sceneId), [f.menuId, f.gameId, f.winId, f.menuId, f.gameId, f.failureId, f.menuId]);
    assert.deepEqual(visits.map(row => row.visitIndex), [1, 2, 3, 4, 5, 6, 7]);
    assert.ok(data.actions.some(row => row.mouse === 'start')); assert.ok(data.actions.some(row => row.mouse === 'resume'));
    assert.ok(data.actions.some(row => row.mouse === 'title')); assert.ok(data.actions.some(row => row.mouse === 'exit'));
  } else { assert.deepEqual(visits.map(row => row.sceneId), [f.menuId, f.gameId]); }
  const pauseFrames = printed(stdout, 'VIENTO_PROJECT_PAUSE:'); if (mode === 'scene-restart') assert.deepEqual(pauseFrames, []); else assert.ok(pauseFrames.length >= (mode === 'full' ? 6 : 1));
  assert.ok(pauseFrames.every((row, index) => row.sequence === index + 1 && row.visitIndex === 2 && row.sceneId === f.gameId));
  if (mode !== 'scene-restart') {
    const frozen = data.stages.find(row => row.label === 'paused-gameplay-frozen').sample;
    assert.equal(frozen.treePaused, true); assert.equal(frozen.menuMode, 'paused');
    assert.ok(frozen.menuButtons.some(row => row.id === 'resume' && row.visible && !row.disabled));
    assert.ok(frozen.menuButtons.some(row => row.id === 'exit' && row.visible && !row.disabled));
  }
  const screenshots = Object.fromEntries(await Promise.all((await fs.readdir(path.join(output, 'frames'))).filter(name => name.endsWith('.png')).map(async name => [name, hash(await fs.readFile(path.join(output, 'frames', name)))])));
  assert.ok(Object.keys(screenshots).length >= (mode === 'full' ? 8 : 3)); await unchanged(f);
  await fs.writeFile(path.join(output, 'verification.json'), JSON.stringify({ ok: true, scope: data.scope, browserAuthorSource: f.browserAuthorSource || null, tool: f.tool, events: received.events, pauseFrames, screenshots, generatedFiles: Object.fromEntries([...f.generated.files].map(([name, bytes]) => [name, hash(bytes)])) }, null, 2) + '\n');
  return { stages: data.stages.length, samples: data.samples.length, visits: visits.length, screenshots: Object.keys(screenshots).length, events: received.events.length, pauseFrames: pauseFrames.length };
}
function keyboardOutput(f, name) { return path.join(evidenceDirectory() || f.temporary, name); }
test('actual mouse and keyboard menus traverse start, paused resume, victory, failure, return and shutdown', windowNative, async t => {
  const sourceBefore = await sourceHashes(), canonicalBefore = await menuInventory(menuCanonical), previousPauseBefore = await menuInventory(menuPauseAuthor), f = await prepare(t), results = [];
  for (const mode of ['full', 'paused-finish', 'paused-escape', 'paused-close']) results.push({ mode, ...await keyboard(f, keyboardOutput(f, mode), mode) });
  assert.deepEqual(await menuInventory(f.author), f.before); assert.deepEqual(await menuInventory(menuCanonical), canonicalBefore); assert.deepEqual(await sourceHashes(), sourceBefore); assert.deepEqual(await menuInventory(menuPauseAuthor), previousPauseBefore);
  await evidence('window-flow', { ok: true, results, browserAuthorSource: f.browserAuthorSource || null, sourceBefore, sourceAfter: await sourceHashes(), previousPauseBefore, previousPauseAfter: await menuInventory(menuPauseAuthor), authorBefore: f.before, authorAfter: await menuInventory(f.author), canonicalSampleBefore: canonicalBefore, canonicalSampleAfter: await menuInventory(menuCanonical) });
});

test('standard delivered project ZIP repeats the same mouse and keyboard menu flow after original author and build paths become unavailable', windowNative, async t => {
  const sourceBefore = await sourceHashes(), canonicalBefore = await menuInventory(menuCanonical), previousPauseBefore = await menuInventory(menuPauseAuthor), f = await godotProjectMenuAuthor(t), before = await menuInventory(f.author), output = path.join(f.temporary, 'build');
  const built = await buildProject({ root: f.author, targetId: f.assemblyId, tool: executable, output, timeoutMs: 90000 }); assert.equal(built.ok, true, JSON.stringify(built.record?.diagnostics || built));
  const snapshot = JSON.parse(await fs.readFile(path.join(output, 'snapshot.json'))), generated = await adapter.generate(snapshot.plan), inspect = () => inspectBackendProject({ buildDirectory: output });
  const delivery = await planBackendProjectDelivery({ inspection: await inspect(), assertCurrent: inspect }), zip = path.join(f.temporary, 'menu.viento-build.zip');
  await writeExportZip(delivery, zip); const verified = await verifyBackendProjectDelivery(zip), relocated = path.join(f.temporary, 'relocated'); await fs.mkdir(relocated);
  const archive = await yauzl.openPromise(zip, { lazyEntries: true, autoClose: false });
  try {
    for await (const entry of archive.eachEntry()) {
      assert.ok(!entry.fileName.startsWith('/') && !entry.fileName.split('/').includes('..'));
      const chunks = []; for await (const chunk of await archive.openReadStreamPromise(entry)) chunks.push(chunk);
      const file = path.join(relocated, entry.fileName); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, Buffer.concat(chunks));
    }
  } finally { await new Promise(resolve => { archive.reader.once('close', resolve); archive.close(); }); }
  await fs.rename(f.author, f.author + '.offline'); await fs.rename(output, output + '.offline');
  await assert.rejects(fs.access(f.author), { code: 'ENOENT' }); await assert.rejects(fs.access(output), { code: 'ENOENT' });
  const ready = { ...f, before, captured: { plan: snapshot.plan }, generated, directory: path.join(relocated, 'project'), tool: await adapter.identify(executable) };
  assert.equal(await fs.readFile(path.join(ready.directory, `behaviors/${f.sourceId}.gd`), 'utf8'), GODOT_PROJECT_MENU_SCRIPT);
  const phases = [];
  for (const phase of adapter.buildPhases) { const result = await adapter.executePhase({ phase, directory: ready.directory, tool: ready.tool, timeoutMs: 90000 }); succeeded(result); phases.push({ phase, status: result.status, stdout: result.stdout, stderr: result.stderr }); }
  const result = await keyboard(ready, keyboardOutput(ready, 'offline-keyboard'));
  assert.deepEqual(await menuInventory(f.author + '.offline'), before); assert.deepEqual(await menuInventory(menuCanonical), canonicalBefore); assert.deepEqual(await sourceHashes(), sourceBefore); assert.deepEqual(await menuInventory(menuPauseAuthor), previousPauseBefore);
  if (evidenceDirectory()) await fs.copyFile(zip, path.join(evidenceDirectory(), 'menu.viento-build.zip'));
  await evidence('offline-delivery', { ok: true, ...result, browserAuthorSource: f.browserAuthorSource || null, originalPathsUnavailable: true, phases, zip: { bytes: (await fs.stat(zip)).size, sha256: hash(await fs.readFile(zip)), verification: verified }, authorBefore: before, authorAfter: await menuInventory(f.author + '.offline'), canonicalSampleBefore: canonicalBefore, canonicalSampleAfter: await menuInventory(menuCanonical), sourceBefore, sourceAfter: await sourceHashes() });
});

test('actual scene menu restarts the same member once per released mouse or Enter gesture without resetting the session ledger', windowNative, async t => {
  const sourceBefore = await sourceHashes(), canonicalBefore = await menuInventory(menuCanonical), previousPauseBefore = await menuInventory(menuPauseAuthor);
  const uiBefore = process.env.VIENTO_PROJECT_MENU_AUTHOR ? await menuInventory(process.env.VIENTO_PROJECT_MENU_AUTHOR) : null;
  const f = await prepare(t, { sceneRestart: true }); assert.ok(f.sceneRestartVariant);
  const result = await keyboard(f, keyboardOutput(f, 'scene-restart'), 'scene-restart');
  assert.deepEqual(await menuInventory(f.author), f.before); assert.deepEqual(await menuInventory(menuCanonical), canonicalBefore);
  assert.deepEqual(await menuInventory(menuPauseAuthor), previousPauseBefore); assert.deepEqual(await sourceHashes(), sourceBefore);
  if (uiBefore) assert.deepEqual(await menuInventory(process.env.VIENTO_PROJECT_MENU_AUTHOR), uiBefore);
  await evidence('scene-restart-flow', { ok: true, ...result, browserAuthorSource: f.browserAuthorSource || null, fixtureVariant: f.sceneRestartVariant, uiBefore, uiAfter: uiBefore && await menuInventory(process.env.VIENTO_PROJECT_MENU_AUTHOR), sourceBefore, sourceAfter: await sourceHashes(), authorBefore: f.before, authorAfter: await menuInventory(f.author), previousPauseBefore, previousPauseAfter: await menuInventory(menuPauseAuthor) });
});
