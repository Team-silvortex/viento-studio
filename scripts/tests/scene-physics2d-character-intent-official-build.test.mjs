import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { scenePhysics2DPlatformMotionAuthor } from './helpers/scene-physics2d-platform-motion-author-fixture.mjs';
import { captureBuildSnapshot } from '../adapters/node-build-snapshot.mjs';
import { GODOT4_EXECUTION_ADAPTER as adapter } from '../backends/godot4-adapter.mjs';
import { godotPhysicsCharacterIntentAssemblyScripts } from '../backends/godot4-physics-character-intent.mjs';

const executable = process.env.VIENTO_GODOT_BIN;
const real = { skip: !executable ? 'Set VIENTO_GODOT_BIN for native Godot build verification' : false, timeout: 240000 };

test('official Godot import and script-check cover intent, one-way platforms and moving-platform scripts', real, async t => {
  const author = await scenePhysics2DPlatformMotionAuthor(t, { consumers: false });
  await author.edit('documents/scenes/demo.json', scene => {
    scene.actors[0].controls = 'none';
    scene.actors[0].speed = 240;
  });
  const captured = await captureBuildSnapshot(author.author, author.assemblyId);
  assert.equal(captured.ok, true, JSON.stringify(captured.diagnostics));
  const generated = await adapter.generate(captured.plan);
  assert.equal(generated.backend.version, '0.37.0');
  assert.ok(generated.backend.capabilities.includes('physics.character-intent2d'));
  assert.ok(generated.backend.capabilities.includes('physics.character-drop-through2d'));
  assert.ok(generated.backend.capabilities.includes('physics.platform-motion2d'));

  const directory = await fs.mkdtemp(path.join(author.temporary, 'intent-official-build-'));
  for (const [name, bytes] of [...generated.files, ...[...generated.resourceFiles].map(([resourceId, name]) => [name, captured.resources.get(resourceId)])]) {
    await fs.mkdir(path.dirname(path.join(directory, name)), { recursive: true });
    await fs.writeFile(path.join(directory, name), bytes);
  }
  // Validation checks the .gd.txt historical copies byte-for-byte; they are
  // retained as data, not executable scripts. All 47 generated .gd files,
  // including the original contact bridge, must be compiled by script-check.
  const scripts = await godotPhysicsCharacterIntentAssemblyScripts(directory);
  const allScripts = [...generated.files.keys()].filter(name => name.endsWith('.gd'));
  assert.equal(allScripts.length, 47);
  assert.equal(new Set(scripts).size, scripts.length);
  assert.deepEqual(allScripts.filter(name => !scripts.includes(name)), []);
  for (const name of ['movement-contacts-helper.gd', 'character-intent-original-contacts.gd',
    'character-intent-helper.gd', 'character-intent-port.gd']) assert.ok(scripts.includes(name), name);
  const backups = [...generated.files.keys()].filter(name => name.includes('character-intent-original-') && name.endsWith('.gd.txt'));
  assert.equal(backups.length, 2);
  assert.ok(backups.every(name => !scripts.includes(name)));

  assert.deepEqual(adapter.buildPhases, ['import', 'script-check']);
  const tool = await adapter.identify(executable);
  for (const phase of adapter.buildPhases) {
    const result = await adapter.executePhase({ phase, directory, tool, timeoutMs: 180000 });
    assert.equal(result.status, 'succeeded', `${phase}: ${result.stdout}\n${result.stderr}`);
    assert.deepEqual(adapter.diagnostics(result, captured.plan), [], `${phase}: ${result.stdout}\n${result.stderr}`);
  }
});
