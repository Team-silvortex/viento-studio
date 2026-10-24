import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { generateGodotAssemblyProject, godotAssemblyScripts } from '../backends/godot4-project.mjs';
import { completionProject } from './helpers/project-animation-completion-fixture.mjs';
import { runtimeId } from './helpers/project-runtime-fixture.mjs';
import { generateEditableGodotAnimationStateScript } from '../../engine/animation-state-script-source.mjs';
import { DEFAULT_ANIMATION_STATE_TABLE } from '../../engine/godot-animation-state-script.mjs';

async function fixture(t, strict = true) {
  const plan = completionProject(), first = plan.scenes[0];
  first.animation.schemaVersion = 3; first.animation.document.schemaVersion = 4; first.animation.document.playbackScope = 'instance';
  first.requiredCapabilities.push('animation.instances2d');
  plan.requiredCapabilities = [...new Set(['project.scenes', ...plan.scenes.flatMap(scene => scene.requiredCapabilities)])].sort();
  if (strict) for (const scene of plan.scenes) scene.behaviors.sources[0].content = generateEditableGodotAnimationStateScript(DEFAULT_ANIMATION_STATE_TABLE).content;
  for (const scene of plan.scenes) for (const source of scene.behaviors.sources) source.sourceRevision = 'sha256:' + createHash('sha256').update(source.content).digest('hex');
  const generated = await generateGodotAssemblyProject(plan), directory = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-target-inventory-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  for (const [name, content] of generated.files) { const file = path.join(directory, name); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, content); }
  const inventory = JSON.parse(generated.files.get('assembly.json'));
  return { plan, generated, directory, inventory, write: data => fs.writeFile(path.join(directory, 'assembly.json'), JSON.stringify(data)) };
}

test('inventory12 admits mixed scope with frozen controller target membership and all target dependencies', async t => {
  const f = await fixture(t), scripts = await godotAssemblyScripts(f.directory);
  assert.equal(f.inventory.schemaVersion, 12);
  assert.deepEqual(f.inventory.scenes.map(row => row.animationScope), ['instance', 'scene']);
  assert.deepEqual(f.inventory.scenes[0].animationInstances, [f.plan.scenes[0].actors[0].instanceId]);
  for (const name of ['project-animation-target-runtime.gd', 'project-animation-targets.gd', 'project-animation-target-completions.gd',
    'project-animation-state-trigger-runtime.gd', 'project-animation-state-entry-runtime.gd', 'project-animation-state-runtime.gd']) assert.ok(scripts.includes(name), name);
  assert.equal(new Set(scripts).size, scripts.length);
});

test('inventory12 rejects a controller moved to a different existing actor without its own animation track', async t => {
  const f = await fixture(t), changed = structuredClone(f.inventory);
  changed.scenes[0].animationStateControllers[0].instanceId = f.plan.scenes[0].actors[1].instanceId;
  await f.write(changed); await assert.rejects(() => godotAssemblyScripts(f.directory));
  await f.write(f.inventory); assert.ok((await godotAssemblyScripts(f.directory)).length);
});

test('inventory12 rejects missing, duplicate, unknown shape and contradictory instance target sets', async t => {
  const f = await fixture(t);
  for (const mutate of [row => row.animationInstances = [], row => row.animationInstances.push(row.animationInstances[0]),
    row => row.animationInstances = [runtimeId(999)], row => delete row.animationInstances,
    row => row.animationInstances = [null], row => row.animationScope = 'scene', row => row.animationScope = 'none']) {
    const changed = structuredClone(f.inventory); mutate(changed.scenes[0]); await f.write(changed);
    await assert.rejects(() => godotAssemblyScripts(f.directory));
  }
});

test('scene-scoped controllers retain scene-wide targets even when their own actor has no track', async t => {
  const f = await fixture(t), changed = structuredClone(f.inventory);
  changed.scenes[1].animationStateControllers[0].instanceId = f.plan.scenes[1].actors[1].instanceId;
  await f.write(changed); assert.ok((await godotAssemblyScripts(f.directory)).length);
});

test('inventory12 without recognized controllers keeps an empty wrapper list and the target runtime chain', async t => {
  const f = await fixture(t, false);
  assert.deepEqual(f.inventory.animationStateWrappers, []); assert.ok(f.inventory.scenes.every(row => row.animationStateControllers.length === 0));
  assert.ok((await godotAssemblyScripts(f.directory)).includes('project-animation-target-runtime.gd'));
});

test('inventory11 preserves its original exact fields and does not acquire instance membership requirements', async t => {
  const f = await fixture(t), old = structuredClone(f.inventory); old.schemaVersion = 11;
  for (const row of old.scenes) { delete row.animationScope; delete row.animationInstances; }
  old.scenes[0].animationStateControllers[0].instanceId = f.plan.scenes[0].actors[1].instanceId;
  await f.write(old); const scripts = await godotAssemblyScripts(f.directory);
  assert.ok(scripts.includes('project-animation-state-trigger-runtime.gd'));
  assert.equal(scripts.includes('project-animation-target-runtime.gd'), false);
  old.scenes[0].animationScope = 'instance'; await f.write(old); await assert.rejects(() => godotAssemblyScripts(f.directory));
});
