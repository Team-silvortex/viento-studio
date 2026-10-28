import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { scenePhysics2DCharacterEventsAuthor } from './helpers/scene-physics2d-character-events-author-fixture.mjs';
import { captureBuildSnapshot } from '../adapters/node-build-snapshot.mjs';
import { validateGeneratedExecutionProject } from '../adapters/node-execution-backends.mjs';
import { listScriptStarters } from '../../engine/script-authoring.mjs';
import { GODOT4_EXECUTION_ADAPTER as adapter } from '../backends/godot4-adapter.mjs';
import { generateGodotPhysicsCharacterIntentProject } from '../backends/godot4-physics-character-intent.mjs';
import { applyGodotInputMap } from '../backends/godot4-input-map.mjs';
import { runBuildProcess } from '../lib/build-process.mjs';
import { checkExecutionBackendSupport } from '../../engine/backend-capabilities.mjs';
import { BEVY_EXECUTION_ADAPTER } from '../backends/bevy-adapter.mjs';

const id = n => `93939393-9393-4393-8393-${String(n).padStart(12, '0')}`;
const inputDocument = { format: 'viento-input-map', schemaVersion: 1, actions: [
  { name: 'p1_left', keys: ['KeyA'] }, { name: 'p1_right', keys: ['KeyD'] }, { name: 'p1_jump', keys: ['KeyW'] },
  { name: 'p2_left', keys: ['KeyH'] }, { name: 'p2_right', keys: ['KeyJ'] }, { name: 'p2_jump', keys: ['KeyU'] },
] };
async function setup(t) {
  const f = await scenePhysics2DCharacterEventsAuthor(t, { jump: false, controls: 'none' });
  const second = id(1), first = f.instanceId;
  await f.edit('documents/scenes/demo.json', scene => {
    scene.actors.push({ ...structuredClone(scene.actors[0]), instanceId: second, position: [300, 178] });
  });
  await f.edit(f.physicsPath, doc => { doc.bodies.push({ ...structuredClone(doc.bodies[0]), id: id(2), instanceId: second }); });
  const intent = listScriptStarters().find(item => item.id === 'godot-character-intent').content;
  await f.addBehavior(id(3), id(4), 'map-intent-first', intent, {left_action:'p1_left',right_action:'p1_right',jump_action:'p1_jump'}, first);
  await f.addBehavior(id(5), id(6), 'map-intent-second', intent, {left_action:'p2_left',right_action:'p2_right',jump_action:'p2_jump'}, second);
  await f.addBehavior(id(7), id(8), 'map-monitor', `extends Node
var tick := 0
func _physics_process(_delta: float) -> void:
\ttick += 1
\tif tick % 5 != 0:
\t\treturn
\tvar scene = get_parent().get_parent()
\tvar positions = {}
\tfor actor in scene.actors:
\t\tpositions[actor["instanceId"]] = actor["node"].position.x
\tprint("MAP_SAMPLE:" + JSON.stringify({"first": positions["${first}"], "second": positions["${second}"], "tick": tick}))
`, {}, first);
  const captured = await captureBuildSnapshot(f.author, f.assemblyId);
  assert.equal(captured.ok, true, JSON.stringify(captured.diagnostics));
  const plan = structuredClone(captured.plan);
  plan.schemaVersion = 2;
  plan.inputMap = { objectId: id(9), sourcePath:'documents/input/test.json', sourceRevision:`sha256:${'0'.repeat(64)}`, document:structuredClone(inputDocument) };
  plan.requiredCapabilities.push('project.input-map'); plan.requiredCapabilities.sort();
  return { ...f, captured, plan, first, second };
}
async function sourceHashes(root) {
  const names = (await fs.readdir(root, { recursive: true, withFileTypes: true })).filter(item => item.isFile())
    .map(item => path.join(item.parentPath, item.name)).sort();
  return await Promise.all(names.map(async name => [path.relative(root, name), createHash('sha256').update(await fs.readFile(name)).digest('hex')]));
}
async function stage(f, generated, label) {
  const directory = path.join(f.temporary, label); await fs.mkdir(directory);
  for (const [name, bytes] of [...generated.files, ...[...generated.resourceFiles].map(([id, file]) => [file, f.captured.resources.get(id)])]) {
    await fs.mkdir(path.dirname(path.join(directory, name)), { recursive: true }); await fs.writeFile(path.join(directory, name), bytes);
  }
  return directory;
}

test('Godot input mapping is opt-in, preserves old project bytes and rejects unsupported mappings', async t => {
  const f = await setup(t), before = await sourceHashes(f.author);
  const old = await adapter.generate(f.captured.plan), historical = await generateGodotPhysicsCharacterIntentProject(f.captured.plan);
  assert.deepEqual(old.files, historical.files); assert.deepEqual(old.backend, historical.backend);
  const first = await adapter.generate(f.plan), second = await adapter.generate(f.plan);
  assert.deepEqual(first.files, second.files); assert.deepEqual(first.backend, second.backend);
  for (const [name, bytes] of old.files) if (!['project.godot', 'execution-clock-original.godot'].includes(name)) assert.deepEqual(first.files.get(name), bytes, name);
  assert.match(first.files.get('project.godot').toString(), /p1_right=\{[\s\S]*?"physical_keycode":68/);
  assert.match(first.files.get('project.godot').toString(), /p2_right=\{[\s\S]*?"physical_keycode":74/);
  assert.ok(first.backend.capabilities.includes('project.input-map'));
  assert.doesNotThrow(() => validateGeneratedExecutionProject(adapter, f.plan, first));
  assert.throws(() => validateGeneratedExecutionProject(adapter, f.plan, { ...first, backend: { ...first.backend, capabilities: first.backend.capabilities.filter(value => value !== 'project.input-map') } }));
  assert.throws(() => validateGeneratedExecutionProject(adapter, f.plan, { ...first, backend: { ...first.backend, capabilities: 'project.input-map' } }));
  assert.ok(checkExecutionBackendSupport(BEVY_EXECUTION_ADAPTER.descriptor, { operation:'build', plan:f.plan }).length);
  for (const key of ['Unknown', 'ShiftLeft', 'Escape']) {
    const plan = structuredClone(f.plan); plan.inputMap.document.actions[0].keys = [key];
    await assert.rejects(adapter.generate(plan));
  }
  for (const name of ['ui_left', 'x"\n[input]']) {
    const plan = structuredClone(f.plan); plan.inputMap.document.actions[0].name = name;
    await assert.rejects(adapter.generate(plan));
  }
  await assert.rejects(applyGodotInputMap({ files:new Map([['project.godot', Buffer.from('[input]\n')]]), backend:old.backend }, f.plan.inputMap), { errorCode:'build_input_map_invalid' });
  assert.deepEqual(await sourceHashes(f.author), before);
});

const executable = process.env.VIENTO_GODOT_BIN;
test('real Godot window: isolated XTest keyboard moves each mapped character independently', { skip: !executable || !process.env.VIENTO_XVFB_TEST ? 'Set VIENTO_GODOT_BIN and VIENTO_XVFB_TEST for isolated Xvfb keyboard test' : false, timeout:120000 }, async t => {
  const f = await setup(t), before = await sourceHashes(f.author), generated = await adapter.generate(f.plan), directory = await stage(f, generated, 'mapped-project');
  const env = { ...process.env, GODOT_SILENCE_ROOT_WARNING:'1', XDG_DATA_HOME:path.join(f.temporary,'xdg/data'), XDG_CONFIG_HOME:path.join(f.temporary,'xdg/config'), XDG_CACHE_HOME:path.join(f.temporary,'xdg/cache') };
  const imported = await runBuildProcess(executable, ['--headless','--path',directory,'--editor','--quit'], { cwd:directory, env, timeoutMs:60000 });
  assert.equal(imported.status, 'succeeded', imported.stdout + imported.stderr); assert.doesNotMatch(imported.stdout + imported.stderr, /SCRIPT ERROR|ERROR:/);
  const tool = await adapter.identify(executable);
  const checked = await adapter.executePhase({ phase:'script-check', tool, directory, timeoutMs:60000 });
  assert.equal(checked.status, 'succeeded', checked.stdout + checked.stderr);
  assert.deepEqual(adapter.diagnostics(checked, f.plan), [], checked.stdout + checked.stderr);
  const helper = new URL('./helpers/input-map-keyboard.py', import.meta.url).pathname;
  const result = await runBuildProcess('xvfb-run', ['-a','python3',helper,executable,directory], { cwd:directory, env, timeoutMs:45000 });
  assert.equal(result.status, 'succeeded', result.stdout + result.stderr);
  const data = JSON.parse(result.stdout.trim().split('\n').at(-1));
  t.diagnostic(`XTest synthetic system keyboard evidence: ${JSON.stringify(data)}`);
  const { baseline:a, afterD:b, afterJ:c } = data;
  assert.ok(data.focus && data.sampleCount > 15, JSON.stringify(data));
  assert.ok(b.first - a.first > 80 && Math.abs(b.second - a.second) < 1, JSON.stringify(data));
  assert.ok(c.second - b.second > 80 && Math.abs(c.first - b.first) < 1, JSON.stringify(data));
  assert.deepEqual(await sourceHashes(f.author), before);
});
