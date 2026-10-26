import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { projectEventsAuthor } from './helpers/project-events-author-fixture.mjs';
import { projectAnimationClipsAuthor } from './helpers/project-animation-clips-author-fixture.mjs';
import { scenePhysics2DPlatformEventsAuthor } from './helpers/scene-physics2d-platform-events-author-fixture.mjs';
import { DEFAULT_EDITABLE_GODOT_ANIMATION_STATE_SCRIPT } from '../../engine/animation-state-script-source.mjs';
import { PROJECT_EXECUTION_BUDGET_POLICY, createProjectExecutionBudget } from '../../engine/project-execution-budget.mjs';
import { captureBuildSnapshot } from '../adapters/node-build-snapshot.mjs';
import { generateGodotAssemblyProject, godotAssemblyScripts } from '../backends/godot4-project.mjs';
import { generateGodotPhysicsPlatformEventsProject } from '../backends/godot4-physics-platform-events.mjs';
import { generateGodotExecutionBudgetProject, godotExecutionBudgetAssemblyScripts } from '../backends/godot4-execution-budget.mjs';
import { generateGodotProject } from '../backends/godot4-dispatch.mjs';
import { generateGodotBehaviorProject } from '../backends/godot4-behaviors.mjs';
import { generateGodotAudioProject } from '../backends/godot4-audio.mjs';
import { generateGodotAnimationProject } from '../backends/godot4-clip-animation.mjs';
import { GODOT4_EXECUTION_ADAPTER as adapter } from '../backends/godot4-adapter.mjs';

const invalid = { errorCode: 'build_execution_budget_invalid' };
const tool = process.env.VIENTO_GODOT_BIN;
const native = { skip: !tool && 'Set VIENTO_GODOT_BIN for real execution policy probes', timeout: 60000 };
const execute = promisify(execFile);
async function ready(t, kind = 'events') {
  const f = await (kind === 'events' ? projectEventsAuthor : kind === 'physics' ? scenePhysics2DPlatformEventsAuthor : projectAnimationClipsAuthor)(t);
  if (kind === 'states') await f.script('checkpoint', DEFAULT_EDITABLE_GODOT_ANIMATION_STATE_SCRIPT);
  if (kind === 'instances') for (const index of [0, 1]) await f.edit(`documents/animations/scene-${index}.json`, doc => {
    doc.schemaVersion = 4; doc.playbackScope = 'instance';
  });
  const captured = await captureBuildSnapshot(f.author, f.assemblyId); assert.equal(captured.ok, true, JSON.stringify(captured.diagnostics));
  const plan = captured.plan, before = structuredClone(plan);
  const old = await (kind === 'physics' ? generateGodotPhysicsPlatformEventsProject : generateGodotAssemblyProject)(plan);
  const generated = await generateGodotExecutionBudgetProject(plan);
  assert.deepEqual(plan, before);
  return { ...f, captured, old, generated };
}
async function stage(f, generated = f.generated) {
  const directory = await fs.mkdtemp(path.join(f.temporary, 'budget-project-'));
  for (const [name, bytes] of [...generated.files, ...[...generated.resourceFiles].map(([id, name]) => [name, f.captured.resources.get(id)])]) {
    const file = path.join(directory, name); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, bytes);
  }
  return directory;
}
for (const kind of ['events', 'animation', 'states', 'instances', 'physics']) test(`${kind} selects the shared finite budget without changing protocols, author bytes or unrelated generated files`, async t => {
  const f = await ready(t, kind), policy = JSON.parse(f.generated.files.get('execution-budget.json'));
  assert.equal(f.generated.backend.version, '0.32.0'); assert.equal(f.generated.backend.protocolVersion, f.old.backend.protocolVersion);
  assert.deepEqual(f.generated.backend.capabilities, f.old.backend.capabilities); assert.deepEqual(f.generated.sourceMap, f.old.sourceMap);
  assert.deepEqual(f.generated.resourceFiles, f.old.resourceFiles); assert.deepEqual(policy.limits, PROJECT_EXECUTION_BUDGET_POLICY);
  assert.equal(policy.policyVersion, 1); assert.equal(policy.scope, 'session');
  assert.equal(policy.scripts.length, kind === 'instances' ? 5 : kind === 'events' ? 3 : 4);
  const changed = new Set(policy.scripts);
  for (const [name, bytes] of f.old.files) {
    if (changed.has(name)) assert.notDeepEqual(f.generated.files.get(name), bytes, name);
    else assert.deepEqual(f.generated.files.get(name), bytes, name);
  }
  const viaAdapter = await adapter.generate(f.captured.plan);
  assert.deepEqual([...viaAdapter.files], [...f.generated.files]); assert.equal(viaAdapter.backend.sha256, f.generated.backend.sha256);
  const directory = await stage(f), inventory = await godotExecutionBudgetAssemblyScripts(directory);
  assert.deepEqual([...inventory].sort(), [...f.generated.files.keys()].filter(name => name.endsWith('.gd')).sort());
  const legacy = await stage(f, f.old), oldInventory = await godotExecutionBudgetAssemblyScripts(legacy);
  assert.deepEqual([...oldInventory].sort(), [...f.old.files.keys()].filter(name => name.endsWith('.gd')).sort());
});

test('strict budget inventory rejects every missing, linked or altered policy and transformed script', async t => {
  const f = await ready(t, 'instances'), directory = await stage(f), policy = JSON.parse(f.generated.files.get('execution-budget.json'));
  for (const name of [...policy.scripts, 'execution-budget.json', 'project-execution-budget.gd']) {
    const file = path.join(directory, name), bytes = await fs.readFile(file);
    await fs.rm(file); await assert.rejects(godotExecutionBudgetAssemblyScripts(directory), invalid, `${name} missing`);
    await fs.symlink(path.join(f.author, 'viento.project.json'), file);
    await assert.rejects(godotExecutionBudgetAssemblyScripts(directory), invalid, `${name} linked`);
    await fs.rm(file); await fs.writeFile(file, Buffer.concat([bytes, Buffer.from('\n# modified\n')]));
    await assert.rejects(godotExecutionBudgetAssemblyScripts(directory), invalid, `${name} modified`); await fs.writeFile(file, bytes);
  }
  assert.ok(await godotExecutionBudgetAssemblyScripts(directory));
});
test('removing the sidecar and helper cannot downgrade converted runtimes to the historical inventory', async t => {
  const f = await ready(t), directory = await stage(f);
  await fs.rm(path.join(directory, 'execution-budget.json')); await fs.rm(path.join(directory, 'project-execution-budget.gd'));
  await assert.rejects(godotExecutionBudgetAssemblyScripts(directory), invalid);
  for (const [name, bytes] of f.old.files) await fs.writeFile(path.join(directory, name), bytes);
  assert.ok(await godotExecutionBudgetAssemblyScripts(directory));
  for (const name of ['project-runtime.gd', 'project-events.gd', 'project-audio.gd', 'project-execution-budget.gd']) {
    await fs.writeFile(path.join(directory, name), f.generated.files.get(name));
    await assert.rejects(godotExecutionBudgetAssemblyScripts(directory), invalid, name);
    if (f.old.files.has(name)) await fs.writeFile(path.join(directory, name), f.old.files.get(name)); else await fs.rm(path.join(directory, name));
  }
});
test('invented policy paths, numbers, dimensions and animation inventory cannot select executable source', async t => {
  const f = await ready(t), directory = await stage(f), file = path.join(directory, 'execution-budget.json');
  const original = await fs.readFile(file), policy = JSON.parse(original);
  for (const changed of [
    { ...policy, policyVersion: 2 }, { ...policy, scope: 'frame' }, { ...policy, extra: true },
    { ...policy, scripts: ['behaviors/author.gd'] }, { ...policy, scripts: [...policy.scripts, '../outside.gd'] },
    { ...policy, limits: { ...policy.limits, eventPublishes: 129 } },
    { ...policy, limits: { ...policy.limits, unexpected: 1 } },
  ]) { await fs.writeFile(file, JSON.stringify(changed)); await assert.rejects(godotExecutionBudgetAssemblyScripts(directory), invalid); }
  await fs.writeFile(file, original);
  await fs.writeFile(path.join(directory, 'project-animation-targets.gd'), 'extends RefCounted\n');
  await assert.rejects(godotExecutionBudgetAssemblyScripts(directory), invalid);
});
test('standalone scene generation remains byte-identical and does not receive a project policy', async t => {
  const f = await ready(t), child = f.captured.plan.scenes[0];
  const generated = await adapter.generate(child);
  assert.equal(generated.files.has('execution-budget.json'), false); assert.equal(generated.files.has('project-execution-budget.gd'), false);
  assert.notEqual(generated.backend.version, '0.32.0');
  const original = await (child.animation ? generateGodotAnimationProject : child.audio ? generateGodotAudioProject : child.schemaVersion === 3 ? generateGodotBehaviorProject : generateGodotProject)(child);
  assert.deepEqual([...generated.files], [...original.files]); assert.deepEqual(generated.backend, original.backend);
  assert.deepEqual(generated.sourceMap, original.sourceMap);
});

test('legacy schema 6, 7, 9 and 10 inventory shapes retain their historical script selection without a policy sidecar', async t => {
  for (const schema of [6, 7, 9, 10]) {
    const f = await ready(t, schema < 9 ? 'animation' : 'states'), directory = await stage(f, f.old);
    const file = path.join(directory, 'assembly.json'), manifest = JSON.parse(await fs.readFile(file));
    manifest.schemaVersion = schema;
    if (schema < 10) delete manifest.animationStateWrappers;
    if (schema === 9) for (const scene of manifest.scenes) for (const controller of scene.animationStateControllers) delete controller.scriptObjectId;
    await fs.writeFile(file, JSON.stringify(manifest));
    const before = await Promise.all([...f.old.files.keys()].map(name => fs.readFile(path.join(directory, name))));
    assert.deepEqual(await godotExecutionBudgetAssemblyScripts(directory), await godotAssemblyScripts(directory));
    assert.deepEqual(await Promise.all([...f.old.files.keys()].map(name => fs.readFile(path.join(directory, name)))), before);
    await assert.rejects(fs.stat(path.join(directory, 'execution-budget.json')), { code: 'ENOENT' });
  }
});

for (const kind of ['events', 'animation', 'states', 'instances', 'physics']) test(`real Godot parses and runs the ${kind} project with unchanged accepted protocol`, native, async t => {
  const f = await ready(t, kind), directory = await stage(f), identified = await adapter.identify(tool);
  for (const phase of adapter.buildPhases) {
    const result = await adapter.executePhase({ phase, directory, tool: identified, timeoutMs: 60000 });
    assert.equal(result.status, 'succeeded', result.stdout + result.stderr);
    assert.deepEqual(adapter.diagnostics(result, f.captured.plan), [], result.stdout + result.stderr);
  }
  const result = await adapter.executePhase({ phase: 'run', directory, tool: identified, smoke: true, mode: 'headlessLogic', timeoutMs: 60000 });
  assert.equal(result.status, 'succeeded', result.stdout + result.stderr);
  assert.deepEqual(adapter.diagnostics(result, f.captured.plan), [], result.stdout + result.stderr);
  const reader = adapter.createEventReader(f.captured.plan, { smoke: true, capabilities: f.generated.backend.capabilities });
  reader.push(result.stdout); assert.deepEqual(reader.finish().diagnostics, [], result.stdout + result.stderr);
});
test('real helper matches atomic JavaScript costs, rejects invalid values and preserves detached snapshots', native, async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-budget-vector-')); t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const limits = PROJECT_EXECUTION_BUDGET_POLICY;
  const requests = [{ eventPublishes: 1, eventBytes: 4096, eventDeliveries: 64 }, { stateMutations: 1024 },
    { eventPublishes: 1, stateMutations: 1 }, { audioRequests: 256 }, { animationRequests: 256 }, { eventRegistrations: 1024 },
    {}, { eventPublishes: 0 }, { eventPublishes: -1 }, { eventPublishes: 1.5 }, { eventPublishes: Number.MAX_SAFE_INTEGER + 1 }, { unknown: 0 },
    { eventPublishes: 127 }, { eventPublishes: 1 }, { eventBytes: limits.eventBytes - 4096 }, { eventDeliveries: limits.eventDeliveries - 64 }];
  const budget = createProjectExecutionBudget(), expected = requests.map(value => ({ accepted: budget.reserve(value), used: budget.snapshot() }));
  await fs.copyFile(new URL('../backends/godot4/project-execution-budget.gd', import.meta.url), path.join(directory, 'project-execution-budget.gd'));
  await fs.writeFile(path.join(directory, 'execution-budget.json'), JSON.stringify({ format: 'viento-godot-execution-budget', schemaVersion: 1, policyVersion: 1, scope: 'session', limits }));
  await fs.writeFile(path.join(directory, 'project.godot'), 'config_version=5\n[application]\nconfig/name="Finite execution budget probe"\n');
  await fs.writeFile(path.join(directory, 'probe.gd'), `extends SceneTree
func _initialize() -> void:
\tvar budget = preload("res://project-execution-budget.gd").new()
\tvar initial = budget.snapshot()
\tvar requests = JSON.parse_string(${JSON.stringify(JSON.stringify(requests))})
\tvar result: Array = []
\tfor costs in requests:
\t\tvar accepted: bool = budget.reserve(costs)
\t\tresult.push_back({"accepted":accepted,"used":budget.snapshot()})
\tassert(initial.is_read_only())
\tfor key in initial:
\t\tassert(initial[key] == 0)
\tassert(not budget.reserve({"eventBytes":NAN}))
\tassert(not budget.reserve({"eventBytes":INF}))
\tassert(not budget.reserve({"eventBytes":true}))
\tassert(not budget.reserve([]))
\tassert(not budget.reserve(null))
\tprint("BUDGET_VECTOR:" + JSON.stringify(result))
\tquit()
`);
  const result = await execute(tool, ['--headless', '--path', directory, '--script', 'res://probe.gd'], { timeout: 30000, maxBuffer: 1024 * 1024, env: { ...process.env, GODOT_SILENCE_ROOT_WARNING: '1', XDG_DATA_HOME: path.join(directory, 'data'), XDG_CONFIG_HOME: path.join(directory, 'config'), XDG_CACHE_HOME: path.join(directory, 'cache') } });
  assert.doesNotMatch(result.stdout + result.stderr, /SCRIPT ERROR:|ERROR:/);
  const line = result.stdout.split('\n').find(line => line.startsWith('BUDGET_VECTOR:')); assert.ok(line, result.stdout + result.stderr);
  assert.deepEqual(JSON.parse(line.slice('BUDGET_VECTOR:'.length)), expected);
});
