// Two standalone native interactions with an already paused vertical platform.
// Does not enter the app test list or write author data outside disposable fixtures.
import '../adapters/node-studio-core.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { captureBuildSnapshot } from '../adapters/node-build-snapshot.mjs';
import { GODOT4_EXECUTION_ADAPTER as adapter } from '../backends/godot4-adapter.mjs';
import { scenePhysics2DPlatformControlAuthor } from './helpers/scene-physics2d-platform-control-author-fixture.mjs';
const appRoot = fileURLToPath(new URL('../../', import.meta.url));
const outputRoot = path.join(appRoot, 'docs/test-results/scene-physics2d-platform-control');
const tool = process.env.VIENTO_GODOT_BIN;
if (!tool || !path.isAbsolute(tool)) throw Error('Set VIENTO_GODOT_BIN to an absolute executable.');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const baseline = JSON.parse(await fs.readFile(path.join(outputRoot, 'native-evidence.json'), 'utf8')).sourceFiles;
const ownPath = 'scripts/tests/platform-control-paused-character-smoke.mjs';
const sourceHashes = { ...baseline, [ownPath]: hash(await fs.readFile(path.join(appRoot, ownPath))) };
const report = { format: 'viento-paused-platform-character-proof', schemaVersion: 1,
  startedAt: new Date().toISOString(), sourceHashes, cases: [], limitations: ['Actual Linux Godot headless logic; no window, installed Tauri, Android or Bevy execution.'] };
let stdout = '';
async function authorHashes(directory, prefix = '') {
  const output = {};
  for (const row of await fs.readdir(path.join(directory, prefix), { withFileTypes: true })) {
    const name = prefix ? `${prefix}/${row.name}` : row.name;
    if (row.isDirectory()) Object.assign(output, await authorHashes(directory, name));
    else { assert.ok(row.isFile()); output[name] = hash(await fs.readFile(path.join(directory, name))); }
  }
  return output;
}
try {
  for (const interaction of ['jump', 'drop']) {
    const cleanups = [];
    try {
      const f = await scenePhysics2DPlatformControlAuthor({ after: callback => cleanups.push(callback) }, { [interaction]: true });
      await f.addBehavior('96969696-9696-4696-8696-000000000001', '96969696-9696-4696-8696-000000000002', 'paused-character-probe', `extends Node
var ticks := -1
var control
var scene
func _ready() -> void:
\tscene = get_parent().get_parent()
\tcontrol = get_meta("viento_platform_control")
\tassert(control.request_running(false))
func _physics_process(_delta: float) -> void:
\tvar tick: int = scene.physics_observation_step
\tif tick == ticks:
\t\treturn
\tticks = tick
\tvar character: CharacterBody2D
\tfor actor in scene.actors:
\t\tif actor["instanceId"] == "${f.instanceId}":
\t\t\tcharacter = actor["node"]
\tvar platform = get_parent()
\tprint("PAUSED_CHARACTER:" + JSON.stringify({"step":ticks,"running":control.read_running(),"phase":scene.platform_motion.platforms["${f.platformInstanceId}"]["phase"],"platform":[platform.position.x,platform.position.y],"position":[character.position.x,character.position.y],"grounded":scene.character_motion_grounded.get("${f.instanceId}",false),"platformException":character.get_collision_exceptions().has(platform)}))
`, {}, f.platformInstanceId);
      const beforeAuthors = await authorHashes(f.author), captured = await captureBuildSnapshot(f.author, f.assemblyId);
      assert.equal(captured.ok, true, JSON.stringify(captured.diagnostics));
      const frozen = structuredClone(captured.plan), generated = await adapter.generate(captured.plan);
      assert.deepEqual(captured.plan, frozen);
      assert.equal(generated.backend.version, '0.40.0');
      const directory = await fs.mkdtemp(path.join(f.temporary, `paused-${interaction}-`));
      for (const [name, bytes] of [...generated.files, ...[...(generated.resourceFiles || [])].map(([id, name]) => [name, captured.resources.get(id)])]) {
        const file = path.join(directory, name); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, bytes);
      }
      const identified = await adapter.identify(tool);
      for (const phase of adapter.runtimePhases) {
        const imported = await adapter.executePhase({ phase, directory, tool: identified, timeoutMs: 60000 });
        assert.equal(imported.status, 'succeeded', imported.stdout + imported.stderr);
        assert.deepEqual(adapter.diagnostics(imported, captured.plan), [], imported.stdout + imported.stderr);
      }
      const result = await adapter.executePhase({ phase: 'run', directory, tool: identified, timeoutMs: 60000 });
      stdout += `CASE ${interaction}\n` + result.stdout + result.stderr + '\n';
      assert.equal(result.status, 'succeeded', result.stdout + result.stderr);
      assert.deepEqual(adapter.diagnostics(result, captured.plan), [], result.stdout + result.stderr);
      const reader = adapter.createEventReader(captured.plan, { smoke: true, capabilities: generated.backend.capabilities });
      reader.push(result.stdout); assert.deepEqual(reader.finish().diagnostics, [], result.stdout);
      assert.equal(reader.snapshot().phase, 'finished');
      const probes = result.stdout.split('\n').filter(line => line.startsWith('PAUSED_CHARACTER:')).map(line => JSON.parse(line.slice('PAUSED_CHARACTER:'.length)));
      const rows = probes.filter(row => row.step > 0), settled = rows.filter(row => row.step >= 3 && row.step <= 10), after = rows.filter(row => row.step > 10);
      assert.ok(rows.length >= 29); assert.ok(rows.every(row => row.phase === 0 && row.running === false && row.platform[1] === 160));
      assert.ok(settled.every(row => row.grounded && Math.abs(row.position[1] - 145) < .2));
      assert.ok(after.some(row => !row.grounded));
      const events = reader.events.filter(row => row.event === 'event-publish' && row.bindingId === f.publisherBindingId);
      if (interaction === 'jump') {
        assert.ok(after.some(row => row.position[1] < 120), JSON.stringify(after));
        assert.equal(events.filter(row => row.name === 'physics.jumped').length, 1);
        assert.ok(after.some(row => row.step >= 27 && row.grounded && Math.abs(row.position[1] - 145) < .2));
      } else {
        assert.ok(after.some(row => row.platformException), JSON.stringify(after));
        assert.ok(after.some(row => row.position[1] > 180));
        assert.ok(after.some(row => !row.platformException && row.position[1] > 180));
        assert.equal(events.filter(row => row.name === 'physics.jumped').length, 0);
      }
      assert.deepEqual(await authorHashes(f.author), beforeAuthors);
      for (const [name, bytes] of generated.files) assert.deepEqual(await fs.readFile(path.join(directory, name)), bytes, name);
      report.cases.push({ interaction, passed: true, tool: identified, backend: generated.backend, probes, movementEvents: events,
        physicsSamples: reader.snapshot().samples.filter(row => row.instanceId === f.instanceId), authorFiles: Object.keys(beforeAuthors).length,
        authorSha256: hash(JSON.stringify(beforeAuthors)), authorUnchanged: true, generatedFilesUnchanged: true });
      console.log(`PASS paused vertical platform ${interaction}: ${rows.length} native steps, phase frozen, character left support, author files unchanged.`);
    } finally { for (const cleanup of cleanups.reverse()) await cleanup(); }
  }
  for (const [file, expected] of Object.entries(sourceHashes)) assert.equal(hash(await fs.readFile(path.join(appRoot, file))), expected, `Source changed during smoke: ${file}`);
  report.sourceSnapshotUnchanged = true; report.passed = 2; report.failed = 0; report.ok = true;
} catch (error) {
  report.ok = false; report.failure = error.stack; console.error(error); process.exitCode = 1;
} finally {
  report.finishedAt = new Date().toISOString();
  const sanitize = text => text.replaceAll('/home/chiharukiryu/.cache/io.viento.studio/toolchains', '<toolchains>').replaceAll(appRoot, '<app-root>').replace(/\/tmp\/viento-[^\s"'\\]+/g, '<temporary>');
  await fs.writeFile(path.join(outputRoot, 'paused-character.json'), sanitize(JSON.stringify(report, null, 2)) + '\n');
  await fs.writeFile(path.join(outputRoot, 'paused-character-stdout.log'), sanitize(stdout));
}
