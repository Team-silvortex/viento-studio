import { godotAudioRequestsAssemblyScripts } from '../backends/godot4-audio-requests.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { projectAssemblyAuthor } from './helpers/project-assembly-backend-fixture.mjs';
import { captureBuildSnapshot, buildHash } from '../adapters/node-build-snapshot.mjs';
import { GODOT4_EXECUTION_ADAPTER as adapter } from '../backends/godot4-adapter.mjs';
import { godotAssemblyScripts } from '../backends/godot4-project.mjs';
import { validateGeneratedExecutionProject } from '../adapters/node-execution-backends.mjs';
import { entryScenePlan } from '../../engine/build-target.mjs';

async function fixture(t, options) {
  const f = await projectAssemblyAuthor(t, options), captured = await captureBuildSnapshot(f.author, f.assemblyId);
  assert.equal(captured.ok, true, JSON.stringify(captured.diagnostics));
  const generated = validateGeneratedExecutionProject(adapter, captured.plan, await adapter.generate(captured.plan));
  const directory = path.join(f.temporary, 'generated');
  for (const [name, bytes] of [...generated.files, ...[...generated.resourceFiles].map(([id, name]) => [name, captured.resources.get(id)])]) {
    const file = path.join(directory, name); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, bytes);
  }
  return { ...f, captured, generated, directory };
}

test('one project inventories every scene and shares resource copies without rewriting GDScript or JSON author strings', async t => {
  const f = await fixture(t), { plan } = f.captured;
  assert.equal(plan.scenes.length, 2); assert.equal(plan.resources.length, 2); assert.equal(f.generated.resourceFiles.size, 2);
  assert.equal([...f.generated.files.keys()].filter(name => name.endsWith('project.godot')).length, 1);
  assert.ok(f.generated.files.get('project.godot').toString().includes(`config/name=${JSON.stringify(plan.assembly.title)}\n`));
  assert.match(f.generated.files.get('project.godot').toString(), /res:\/\/project.tscn/);
  for (const child of plan.scenes) {
    const id = child.scene.objectId, prefix = `scenes/${id}`;
    assert.ok(f.generated.files.has(`${prefix}/main.tscn`));
    assert.match(f.generated.files.get(`${prefix}/runtime.gd`).toString(), new RegExp(`res://scenes/${id}/scene.json`));
    const content = JSON.parse(f.generated.files.get(`${prefix}/scene.json`));
    assert.equal(content.actors[0].imageFile, `images/${child.actors[0].imageResourceId}.svg`);
  }
  const source = plan.scenes[0].behaviors.sources[0];
  assert.equal(f.generated.files.get(`behaviors/${source.objectId}.gd`).toString(), source.content);
  assert.equal(buildHash(f.generated.files.get(`behaviors/${source.objectId}.gd`)), source.sourceRevision.slice(7));
  assert.equal(f.generated.backend.protocolVersion, 4);
  assert.deepEqual((await godotAudioRequestsAssemblyScripts(f.directory)).sort(), [...f.generated.files.keys()].filter(name => name.endsWith('.gd')).sort());
  const changed = structuredClone(plan), script = changed.scenes[0].behaviors.sources[0];
  script.content += '\n# literal res://runtime.gd and res://scene.json must stay unchanged\n';
  script.sourceRevision = `sha256:${buildHash(script.content)}`;
  const result = await adapter.generate(changed);
  assert.equal(result.files.get(`behaviors/${script.objectId}.gd`).toString(), script.content);
});

test('assembly generation rejects inconsistent shared resource inventories and script inventory escape paths', async t => {
  const f = await fixture(t), invalid = structuredClone(f.captured.plan);
  invalid.scenes[1].resources = structuredClone(invalid.scenes[1].resources);
  invalid.scenes[1].resources[0].sha256 = 'f'.repeat(64);
  await assert.rejects(adapter.generate(invalid));
  const file = path.join(f.directory, 'assembly.json'), inventory = JSON.parse(await fs.readFile(file));
  inventory.scenes[0].runtimeScripts.push('../secret.gd'); await fs.writeFile(file, JSON.stringify(inventory));
  await assert.rejects(godotAssemblyScripts(f.directory), { errorCode: 'build_assembly_invalid' });
});

const toolPath = process.env.VIENTO_GODOT_BIN;
for (const entry of ['behavior', 'audio']) test(`real Godot imports all members and runs only the ${entry} entry in one project`, {
  skip: !toolPath ? 'Set VIENTO_GODOT_BIN for real assembly engine checks' : false,
}, async t => {
  const f = await fixture(t, { entry, title: 'Two \"quoted\" scenes \\ 組装 [application]' }), tool = await adapter.identify(toolPath);
  for (const phase of adapter.buildPhases) {
    const result = await adapter.executePhase({ phase, directory: f.directory, tool, timeoutMs: 60000 });
    assert.equal(result.status, 'succeeded', result.stdout + result.stderr);
    assert.deepEqual(adapter.diagnostics(result, f.captured.plan), [], result.stdout + result.stderr);
  }
  const result = await adapter.executePhase({ phase: 'run', directory: f.directory, tool, timeoutMs: 30000 });
  assert.equal(result.status, 'succeeded', result.stdout + result.stderr);
  const reader = adapter.createEventReader(f.captured.plan, { capabilities: f.generated.backend.capabilities }); reader.push(result.stdout); const received = reader.finish();
  assert.deepEqual(received.diagnostics, [], result.stdout + result.stderr);
  assert.equal(received.events.some(event => event.event === 'ready'), true); assert.equal(received.events.some(event => event.event === 'finished'), true);
  const ready = received.events.find(event => event.event === 'ready');
  assert.equal(ready.entrySceneId, f.entrySceneId);
  assert.equal(received.events.find(event => event.event === 'scene-enter').sceneId, f.entrySceneId);
  assert.equal(received.events.some(event => event.event === 'scene-event' && event.stream === 'audio'), Boolean(entryScenePlan(f.captured.plan).audio));
  await adapter.cleanupProject(f.directory, { generatedFiles: [...f.generated.files.keys()], resourceFiles: [...f.generated.resourceFiles.values()] });
  assert.equal(await fs.access(path.join(f.directory, '.godot')).then(() => true, () => false), false);
});

test('real Godot rejects a non-entry authored script parse error and maps it to that source', {
  skip: !toolPath ? 'Set VIENTO_GODOT_BIN for real assembly engine checks' : false,
}, async t => {
  const f = await fixture(t, { entry: 'audio' }), tool = await adapter.identify(toolPath);
  const script = f.captured.plan.scenes[0].behaviors.sources[0], file = path.join(f.directory, `behaviors/${script.objectId}.gd`);
  await fs.writeFile(file, 'extends Node\nfunc invalid(:\n');
  const imported = await adapter.executePhase({ phase: 'import', directory: f.directory, tool, timeoutMs: 60000 });
  const checked = await adapter.executePhase({ phase: 'script-check', directory: f.directory, tool, timeoutMs: 60000 });
  const diagnostics = [...adapter.diagnostics(imported, f.captured.plan), ...adapter.diagnostics(checked, f.captured.plan)];
  assert.ok(diagnostics.some(item => item.objectId === script.objectId && item.sourcePath === script.sourcePath), JSON.stringify(diagnostics));
});
