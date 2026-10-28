import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { projectEventsAuthor } from './helpers/project-events-author-fixture.mjs';
import { projectAnimationClipsAuthor } from './helpers/project-animation-clips-author-fixture.mjs';
import { scenePhysics2DPlatformEventsAuthor } from './helpers/scene-physics2d-platform-events-author-fixture.mjs';
import { DEFAULT_EDITABLE_GODOT_ANIMATION_STATE_SCRIPT } from '../../engine/animation-state-script-source.mjs';
import { captureBuildSnapshot } from '../adapters/node-build-snapshot.mjs';
import { generateGodotExecutionBudgetProject } from '../backends/godot4-execution-budget.mjs';
import { generateGodotExecutionClockProject, godotExecutionClockAssemblyScripts } from '../backends/godot4-execution-clock.mjs';
import { GODOT4_EXECUTION_ADAPTER as adapter } from '../backends/godot4-adapter.mjs';

const invalid = { errorCode: 'build_execution_clock_invalid' };
const added = ['execution-clock.json', 'execution-clock-original.godot', 'execution-clock-host.gd', 'execution-clock-budget.gd'];
async function fixture(t, kind = 'events') {
  const f = await (kind === 'events' ? projectEventsAuthor : kind === 'physics' ? scenePhysics2DPlatformEventsAuthor : projectAnimationClipsAuthor)(t);
  if (kind === 'states') await f.script('checkpoint', DEFAULT_EDITABLE_GODOT_ANIMATION_STATE_SCRIPT);
  if (kind === 'instances') for (const index of [0, 1]) await f.edit(`documents/animations/scene-${index}.json`, doc => {
    doc.schemaVersion = 4; doc.playbackScope = 'instance';
  });
  const captured = await captureBuildSnapshot(f.author, f.assemblyId); assert.equal(captured.ok, true);
  const before = structuredClone(captured.plan), previous = await generateGodotExecutionBudgetProject(captured.plan);
  const generated = await generateGodotExecutionClockProject(captured.plan); assert.deepEqual(captured.plan, before);
  const stage = async (output = generated) => {
    const directory = await fs.mkdtemp(path.join(f.temporary, 'execution-clock-'));
    for (const [name, content] of output.files) {
      const file = path.join(directory, name); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, content);
    }
    return directory;
  };
  return { ...f, captured, generated, previous, stage };
}

for (const kind of ['events', 'animation', 'states', 'instances', 'physics']) test(`scheduling observer preserves ${kind} runtime sources and independent wire contracts`, async t => {
  const f = await fixture(t, kind), generated = f.generated;
  assert.equal(generated.backend.version, '0.33.0');
  assert.equal(generated.backend.protocolVersion, f.previous.backend.protocolVersion);
  assert.deepEqual(generated.backend.capabilities, [...f.previous.backend.capabilities, 'runtime.execution-clock']);
  assert.deepEqual(generated.sourceMap, f.previous.sourceMap); assert.deepEqual(generated.resourceFiles, f.previous.resourceFiles);
  for (const [name, bytes] of f.previous.files) if (name !== 'project.godot') assert.deepEqual(generated.files.get(name), bytes, name);
  assert.deepEqual(generated.files.get('execution-clock-original.godot'), f.previous.files.get('project.godot'));
  assert.deepEqual([...generated.files.keys()].filter(name => !f.previous.files.has(name)).sort(), [...added].sort());
  assert.match(generated.files.get('project.godot').toString(), /\[autoload\]\n\nVientoExecutionClock="\*res:\/\/execution-clock-host.gd"/);
  const inventory = await godotExecutionClockAssemblyScripts(await f.stage());
  assert.deepEqual(inventory.sort(), [...generated.files.keys()].filter(name => name.endsWith('.gd')).sort());
  const legacy = await godotExecutionClockAssemblyScripts(await f.stage(f.previous));
  assert.deepEqual(legacy.sort(), [...f.previous.files.keys()].filter(name => name.endsWith('.gd')).sort());
  const current = await adapter.generate(f.captured.plan);
  const intent = f.captured.plan.scenes.some(scene => scene.physics?.document.bodies.some(body => body.characterMotion
    && scene.actors.some(actor => actor.instanceId === body.instanceId && actor.controls === 'none')));
  assert.equal(current.backend.capabilities.includes('physics.character-intent2d'), intent);
  assert.equal(current.backend.version, intent ? '0.37.0' : f.captured.plan.scenes.some(scene => scene.audio?.document.tracks.length) ? '0.36.0' : current.backend.protocolVersion === 4 ? '0.34.0' : '0.35.0');
  assert.equal(current.backend.protocolVersion, generated.backend.protocolVersion);
  assert.ok(current.backend.capabilities.includes('runtime.execution-frames'));
});

test('scheduling inventory rejects missing, linked or changed sidecars, autoload configuration and helpers', async t => {
  const f = await fixture(t, 'instances'), directory = await f.stage();
  for (const name of [...added, 'project.godot']) {
    const file = path.join(directory, name), bytes = await fs.readFile(file);
    await fs.rm(file); await assert.rejects(godotExecutionClockAssemblyScripts(directory), invalid, `${name} missing`);
    await fs.symlink(path.join(f.author, 'viento.project.json'), file);
    await assert.rejects(godotExecutionClockAssemblyScripts(directory), invalid, `${name} linked`);
    await fs.rm(file); await fs.writeFile(file, Buffer.concat([bytes, Buffer.from('\n# modified\n')]));
    await assert.rejects(godotExecutionClockAssemblyScripts(directory), invalid, `${name} changed`);
    await fs.writeFile(file, bytes);
  }
  assert.ok(await godotExecutionClockAssemblyScripts(directory));
});

test('removing scheduling sidecars cannot leave active or orphan observation code in the old inventory', async t => {
  const f = await fixture(t), directory = await f.stage();
  for (const name of added) {
    await fs.rm(path.join(directory, name));
    await assert.rejects(godotExecutionClockAssemblyScripts(directory), invalid, name);
  }
  await fs.writeFile(path.join(directory, 'project.godot'), f.previous.files.get('project.godot'));
  assert.ok(await godotExecutionClockAssemblyScripts(directory));
  for (const name of added) {
    await fs.writeFile(path.join(directory, name), f.generated.files.get(name));
    await assert.rejects(godotExecutionClockAssemblyScripts(directory), invalid, `${name} orphan`);
    await fs.rm(path.join(directory, name));
  }
});

test('scheduling policy cannot redirect autoloads, change storage limits or alter the session admission policy', async t => {
  const f = await fixture(t), directory = await f.stage(), file = path.join(directory, 'execution-clock.json');
  const manifest = JSON.parse(f.generated.files.get('execution-clock.json'));
  for (const changed of [{ ...manifest, scripts: ['behaviors/author.gd'] }, { ...manifest, original: '../other.godot' },
    { ...manifest, retainedWindows: 8192 }, { ...manifest, policyVersion: 2 }, { ...manifest, clock: 'reset-on-flush' }]) {
    await fs.writeFile(file, JSON.stringify(changed)); await assert.rejects(godotExecutionClockAssemblyScripts(directory), invalid);
  }
  await fs.writeFile(file, f.generated.files.get('execution-clock.json'));
  const policy = path.join(directory, 'execution-budget.json'), before = await fs.readFile(policy);
  await fs.writeFile(policy, before.toString().replace('"eventPublishes": 128', '"eventPublishes": 129'));
  await assert.rejects(godotExecutionClockAssemblyScripts(directory), invalid);
});

test('standalone scenes do not install project scheduling observers', async t => {
  const f = await fixture(t), generated = await adapter.generate(f.captured.plan.scenes[0]);
  assert.equal(generated.backend.capabilities.includes('runtime.execution-clock'), false);
  for (const name of added) assert.equal(generated.files.has(name), false);
  assert.equal((await godotExecutionClockAssemblyScripts(await f.stage(generated))), null);
});
