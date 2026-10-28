import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { projectEventsAuthor } from './helpers/project-events-author-fixture.mjs';
import { projectAnimationClipsAuthor } from './helpers/project-animation-clips-author-fixture.mjs';
import { scenePhysics2DPlatformEventsAuthor } from './helpers/scene-physics2d-platform-events-author-fixture.mjs';
import { DEFAULT_EDITABLE_GODOT_ANIMATION_STATE_SCRIPT } from '../../engine/animation-state-script-source.mjs';
import { buildHash, captureBuildSnapshot } from '../adapters/node-build-snapshot.mjs';
import { generateGodotExecutionBudgetProject, godotExecutionBudgetAssemblyScripts } from '../backends/godot4-execution-budget.mjs';
import { generateGodotExecutionClockProject, godotExecutionClockAssemblyScripts } from '../backends/godot4-execution-clock.mjs';
import { generateGodotExecutionFramesProject, godotExecutionFramesAssemblyScripts } from '../backends/godot4-execution-frames.mjs';
import { GODOT4_EXECUTION_ADAPTER as adapter } from '../backends/godot4-adapter.mjs';

const invalid = { errorCode: 'build_execution_frames_invalid' };
const print = 'print("VIENTO_PROJECT:" + JSON.stringify(data, "", true, true))';
const emit = 'preload("res://execution-frame-emitter.gd").emit_frame(data)';
const sourceURL = name => new URL(`../backends/godot4/${name}`, import.meta.url);
const backupName = name => `execution-frames-original-${name}.txt`;
const names = ['project-runtime.gd', 'project-control-runtime.gd', 'project-clip-runtime.gd', 'project-completion-runtime.gd',
  'project-animation-state-runtime.gd', 'project-animation-state-entry-runtime.gd', 'project-animation-state-trigger-runtime.gd',
  'project-animation-target-runtime.gd'];
const added = generated => [...generated.files.keys()].filter(name => name.startsWith('execution-frame'));
const json = value => JSON.stringify(value, null, 2) + '\n';
async function fixture(t, kind = 'events') {
  const f = await (kind === 'events' ? projectEventsAuthor : kind === 'physics' ? scenePhysics2DPlatformEventsAuthor : projectAnimationClipsAuthor)(t);
  if (kind === 'states') await f.script('checkpoint', DEFAULT_EDITABLE_GODOT_ANIMATION_STATE_SCRIPT);
  if (kind === 'instances') for (const index of [0, 1]) await f.edit(`documents/animations/scene-${index}.json`, doc => {
    doc.schemaVersion = 4; doc.playbackScope = 'instance';
  });
  const captured = await captureBuildSnapshot(f.author, f.assemblyId); assert.equal(captured.ok, true);
  const before = structuredClone(captured.plan), previous = await generateGodotExecutionClockProject(captured.plan);
  const generated = await generateGodotExecutionFramesProject(captured.plan); assert.deepEqual(captured.plan, before);
  const stage = async (output = generated) => {
    const directory = await fs.mkdtemp(path.join(f.temporary, 'execution-frames-'));
    for (const [name, content] of output.files) {
      const file = path.join(directory, name); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, content);
    }
    return directory;
  };
  return { ...f, captured, generated, previous, stage };
}

for (const [kind, count, protocol] of [['events', 1, 4], ['animation', 4, 7], ['states', 7, 10], ['instances', 8, 11], ['physics', 7, 10]])
  test(`exact frame envelopes preserve ${kind} business bytes and protocol ${protocol}`, async t => {
    const f = await fixture(t, kind), generated = f.generated, selected = names.slice(0, count);
    assert.equal(generated.backend.version, '0.34.0');
    assert.equal(generated.backend.protocolVersion, protocol);
    assert.equal(generated.backend.protocolVersion, f.previous.backend.protocolVersion);
    assert.deepEqual(generated.backend.capabilities, [...f.previous.backend.capabilities, 'runtime.execution-frames']);
    assert.notEqual(generated.backend.sha256, f.previous.backend.sha256);
    assert.deepEqual(generated.sourceMap, f.previous.sourceMap); assert.deepEqual(generated.resourceFiles, f.previous.resourceFiles);
    for (const [name, bytes] of f.previous.files) {
      assert.deepEqual(generated.files.get(name), selected.includes(name) ? Buffer.from(bytes.toString().replace(print, emit)) : bytes, name);
      if (selected.includes(name)) {
        assert.equal(generated.files.get(name).includes('VIENTO_PROJECT:'), false, name);
        assert.equal(generated.files.get(name).toString().split(emit).length, 2, name);
        assert.deepEqual(generated.files.get(backupName(name)), bytes, name);
        if (name !== 'project-runtime.gd') assert.deepEqual(bytes, await fs.readFile(sourceURL(name)));
      }
    }
    assert.deepEqual(added(generated).sort(), ['execution-frames.json', 'execution-frame-emitter.gd', ...selected.map(backupName)].sort());
    const manifest = JSON.parse(generated.files.get('execution-frames.json'));
    assert.deepEqual(manifest, { format: 'viento-godot-execution-frames', schemaVersion: 1, protocolVersion: 1,
      scope: 'session', clock: 'godot-engine-frames',
      helper: { path: 'execution-frame-emitter.gd', sha256: buildHash(generated.files.get('execution-frame-emitter.gd')) },
      scripts: selected.map(name => ({ path: name, original: backupName(name), sha256: buildHash(generated.files.get(name)),
        originalSha256: buildHash(f.previous.files.get(name)) })) });
    const inventory = await godotExecutionFramesAssemblyScripts(await f.stage());
    assert.deepEqual(inventory.sort(), [...generated.files.keys()].filter(name => name.endsWith('.gd')).sort());
    const legacy = await godotExecutionFramesAssemblyScripts(await f.stage(f.previous));
    assert.deepEqual(legacy.sort(), [...f.previous.files.keys()].filter(name => name.endsWith('.gd')).sort());
  });

test('frame inventory rejects missing, linked, non-file and modified helpers, backups and coordinator bytes', async t => {
  const f = await fixture(t, 'instances'), directory = await f.stage();
  for (const name of [...added(f.generated), ...names]) {
    const file = path.join(directory, name), bytes = await fs.readFile(file);
    await fs.rm(file); await assert.rejects(godotExecutionFramesAssemblyScripts(directory), invalid, `${name} missing`);
    const target = path.join(f.temporary, 'link-target'); await fs.writeFile(target, bytes);
    await fs.symlink(target, file); await assert.rejects(godotExecutionFramesAssemblyScripts(directory), invalid, `${name} linked`);
    await fs.rm(file); await fs.mkdir(file); await assert.rejects(godotExecutionFramesAssemblyScripts(directory), invalid, `${name} directory`);
    await fs.rm(file, { recursive: true }); await fs.writeFile(file, Buffer.concat([bytes, Buffer.from('\n# modified\n')]));
    await assert.rejects(godotExecutionFramesAssemblyScripts(directory), invalid, `${name} modified`);
    await fs.writeFile(file, bytes);
  }
  assert.ok(await godotExecutionFramesAssemblyScripts(directory));
});

test('frame sidecar cannot redirect reads, alter hashes, add fields or redefine the protocol', async t => {
  const f = await fixture(t), directory = await f.stage(), file = path.join(directory, 'execution-frames.json');
  const manifest = JSON.parse(f.generated.files.get('execution-frames.json'));
  for (const changed of [{ ...manifest, protocolVersion: 2 }, { ...manifest, schemaVersion: 2 }, { ...manifest, scope: 'scene' },
    { ...manifest, clock: 'scheduled-window' }, { ...manifest, extra: true }, { ...manifest, scripts: [] },
    { ...manifest, helper: { ...manifest.helper, path: '../author.gd' } },
    { ...manifest, scripts: [{ ...manifest.scripts[0], path: '../author.gd' }] },
    { ...manifest, scripts: [{ ...manifest.scripts[0], original: '../author.gd' }] },
    { ...manifest, scripts: [{ ...manifest.scripts[0], sha256: '0'.repeat(64) }] },
    { ...manifest, scripts: [{ ...manifest.scripts[0], originalSha256: '0'.repeat(64) }] }]) {
    await fs.writeFile(file, json(changed)); await assert.rejects(godotExecutionFramesAssemblyScripts(directory), invalid);
  }
  for (const changed of ['{', json(manifest).replace('"scope": "session",', '"scope": "scene", "scope": "session",')]) {
    await fs.writeFile(file, changed); await assert.rejects(godotExecutionFramesAssemblyScripts(directory), invalid);
  }
  await fs.writeFile(file, f.generated.files.get('execution-frames.json'));
  assert.ok(await godotExecutionFramesAssemblyScripts(directory));
});

test('coordinated edits to backups, transformed files and matching hashes cannot redefine frozen coordinator source', async t => {
  const f = await fixture(t, 'instances'), directory = await f.stage();
  for (const name of names) {
    const original = Buffer.concat([f.previous.files.get(name), Buffer.from('\n# coordinated edit\n')]);
    const changed = Buffer.from(original.toString().replace(print, emit));
    const manifest = JSON.parse(f.generated.files.get('execution-frames.json'));
    Object.assign(manifest.scripts.find(row => row.path === name), { sha256: buildHash(changed), originalSha256: buildHash(original) });
    await fs.writeFile(path.join(directory, backupName(name)), original);
    await fs.writeFile(path.join(directory, name), changed);
    await fs.writeFile(path.join(directory, 'execution-frames.json'), json(manifest));
    await assert.rejects(godotExecutionFramesAssemblyScripts(directory), invalid, name);
    for (const restored of [name, backupName(name), 'execution-frames.json']) await fs.writeFile(path.join(directory, restored), f.generated.files.get(restored));
  }
});

test('partial removal, old coordinator substitution and orphan frame files cannot downgrade frame inventory', async t => {
  const f = await fixture(t, 'instances'), directory = await f.stage();
  for (const name of names) {
    await fs.writeFile(path.join(directory, name), f.previous.files.get(name));
    await assert.rejects(godotExecutionFramesAssemblyScripts(directory), invalid, `${name} downgraded`);
    await fs.writeFile(path.join(directory, name), f.generated.files.get(name));
  }
  for (const name of added(f.generated)) {
    await fs.rm(path.join(directory, name));
    await assert.rejects(godotExecutionFramesAssemblyScripts(directory), invalid, `${name} removed`);
  }
  for (const name of names) await fs.writeFile(path.join(directory, name), f.previous.files.get(name));
  // Once every generated source is restored, this is the valid historical
  // 0.33 directory. Frozen artifact metadata/fingerprints belong to the host.
  assert.ok(await godotExecutionFramesAssemblyScripts(directory));
  for (const name of [...added(f.generated), 'execution-frames-original-unlisted.gd.txt']) {
    await fs.writeFile(path.join(directory, name), f.generated.files.get(name) || 'orphan');
    await assert.rejects(godotExecutionFramesAssemblyScripts(directory), invalid, `${name} orphan`);
    await fs.rm(path.join(directory, name));
  }
  for (const name of names) {
    await fs.writeFile(path.join(directory, name), f.generated.files.get(name));
    await assert.rejects(godotExecutionFramesAssemblyScripts(directory), invalid, `${name} transformed without sidecar`);
    await fs.writeFile(path.join(directory, name), f.previous.files.get(name));
  }
});

test('frame inventory requires prior policy layers and bounds every generated byte source', async t => {
  const f = await fixture(t), directory = await f.stage();
  for (const name of ['execution-clock.json', 'execution-budget.json']) {
    await fs.rm(path.join(directory, name));
    await assert.rejects(godotExecutionFramesAssemblyScripts(directory), invalid, `${name} missing`);
    await fs.writeFile(path.join(directory, name), f.generated.files.get(name));
  }
  for (const name of ['execution-frames.json', 'execution-frame-emitter.gd', 'project-runtime.gd', backupName('project-runtime.gd')]) {
    await fs.writeFile(path.join(directory, name), Buffer.alloc(65537, 32));
    await assert.rejects(godotExecutionFramesAssemblyScripts(directory), invalid, `${name} too large`);
    await fs.writeFile(path.join(directory, name), f.generated.files.get(name));
  }
  await fs.writeFile(path.join(directory, 'assembly.json'), Buffer.alloc(4 * 1024 * 1024 + 1, 32));
  await assert.rejects(godotExecutionFramesAssemblyScripts(directory), invalid, 'assembly too large');
});

test('original-runtime override accepts only bytes and retains real-file and policy checks', async t => {
  const f = await fixture(t), directory = await f.stage();
  const original = f.previous.files.get('project-runtime.gd');
  for (const [reader, errorCode] of [[godotExecutionClockAssemblyScripts, 'build_execution_clock_invalid'],
    [godotExecutionBudgetAssemblyScripts, 'build_execution_budget_invalid']]) {
    assert.ok(await reader(directory, undefined, original));
    for (const invalidOverride of [new Map([['project-runtime.gd', original]]), '../author.gd', { path: '../author.gd' }])
      await assert.rejects(reader(directory, undefined, invalidOverride), { errorCode });
    const file = path.join(directory, 'project-runtime.gd'), bytes = await fs.readFile(file);
    await fs.rm(file); await assert.rejects(reader(directory, undefined, original), { errorCode }, 'override cannot hide missing actual');
    const target = path.join(f.temporary, 'runtime-link'); await fs.writeFile(target, bytes);
    await fs.symlink(target, file); await assert.rejects(reader(directory, undefined, original), { errorCode }, 'override cannot hide linked actual');
    await fs.rm(file); await fs.writeFile(file, Buffer.alloc(65537));
    await assert.rejects(reader(directory, undefined, original), { errorCode }, 'override cannot hide oversized actual');
    await fs.writeFile(file, bytes);
  }
  const old = await generateGodotExecutionBudgetProject(f.captured.plan), oldDirectory = await f.stage(old);
  await assert.rejects(godotExecutionClockAssemblyScripts(oldDirectory, undefined, original), { errorCode: 'build_execution_clock_invalid' });
  await fs.rm(path.join(oldDirectory, 'execution-budget.json'));
  await assert.rejects(godotExecutionBudgetAssemblyScripts(oldDirectory, undefined, original), { errorCode: 'build_execution_budget_invalid' });
});

test('frame inventories read historical finite-budget projects and standalone scenes without installing envelopes', async t => {
  const f = await fixture(t), old = await generateGodotExecutionBudgetProject(f.captured.plan);
  const oldScripts = await godotExecutionFramesAssemblyScripts(await f.stage(old));
  assert.deepEqual(oldScripts.sort(), [...old.files.keys()].filter(name => name.endsWith('.gd')).sort());
  const scene = await adapter.generate(f.captured.plan.scenes[0]);
  assert.equal(scene.backend.capabilities.includes('runtime.execution-frames'), false);
  assert.deepEqual(added(scene), []);
  assert.equal(await godotExecutionFramesAssemblyScripts(await f.stage(scene)), null);
});

test('abort preserves cancellation instead of reporting an invalid inventory', async t => {
  const f = await fixture(t), directory = await f.stage(), controller = new AbortController();
  controller.abort();
  await assert.rejects(godotExecutionFramesAssemblyScripts(directory, controller.signal), { name: 'AbortError' });
});
