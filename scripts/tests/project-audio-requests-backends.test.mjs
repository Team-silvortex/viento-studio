import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { projectAudioControlAuthor } from './helpers/project-audio-control-author-fixture.mjs';
import { projectAnimationClipsAuthor } from './helpers/project-animation-clips-author-fixture.mjs';
import { scenePhysics2DPlatformEventsAuthor } from './helpers/scene-physics2d-platform-events-author-fixture.mjs';
import { DEFAULT_EDITABLE_GODOT_ANIMATION_STATE_SCRIPT } from '../../engine/animation-state-script-source.mjs';
import { buildHash, captureBuildSnapshot } from '../adapters/node-build-snapshot.mjs';
import { generateGodotExecutionBudgetProject, godotExecutionBudgetAssemblyScripts, godotExecutionBudgetAudioBytes } from '../backends/godot4-execution-budget.mjs';
import { generateGodotExecutionClockProject, godotExecutionClockAssemblyScripts } from '../backends/godot4-execution-clock.mjs';
import { generateGodotExecutionFramesProject, godotExecutionFramesAssemblyScripts } from '../backends/godot4-execution-frames.mjs';
import { generateGodotAnimationRequestsProject, godotAnimationRequestsAssemblyScripts } from '../backends/godot4-animation-requests.mjs';
import { generateGodotAudioRequestsProject, godotAudioRequestsAssemblyScripts } from '../backends/godot4-audio-requests.mjs';
import { generateGodotAudioProject } from '../backends/godot4-audio.mjs';

const invalid = { errorCode: 'build_audio_requests_invalid' };
const queueName = 'project-audio.gd', helperName = 'audio-request-emitter.gd', sidecar = 'audio-requests.json';
const backupName = 'audio-requests-original-project-audio.gd.txt';
const added = [helperName, sidecar, backupName], json = value => JSON.stringify(value, null, 2) + '\n';
async function fixture(t, kind = 'audio', { withoutAudio = false } = {}) {
  const f = await (kind === 'audio' ? projectAudioControlAuthor : kind === 'physics' ? scenePhysics2DPlatformEventsAuthor : projectAnimationClipsAuthor)(t);
  const edit = async (file, fn) => { const value = JSON.parse(await fs.readFile(path.join(f.author, file))); fn(value); await fs.writeFile(path.join(f.author, file), json(value)); };
  if (kind === 'states') await f.script('checkpoint', DEFAULT_EDITABLE_GODOT_ANIMATION_STATE_SCRIPT);
  if (kind === 'instances' || kind === 'mixed') for (const index of kind === 'mixed' ? [0] : [0, 1])
    await edit(`documents/animations/scene-${index}.json`, doc => { doc.schemaVersion = 4; doc.playbackScope = 'instance'; });
  if (withoutAudio) for (const id of f.sceneIds) await edit(`metadata/documents/${id}.json`, record => { record.relations = record.relations.filter(row => row.kind !== 'audio'); });
  const captured = await captureBuildSnapshot(f.author, f.assemblyId); assert.equal(captured.ok, true, json(captured.diagnostics));
  const before = structuredClone(captured.plan), previous = await generateGodotAnimationRequestsProject(captured.plan);
  const generated = await generateGodotAudioRequestsProject(captured.plan); assert.deepEqual(captured.plan, before);
  const stage = async (output = generated) => {
    const directory = await fs.mkdtemp(path.join(f.temporary, 'audio-requests-'));
    for (const [name, content] of output.files) {
      const file = path.join(directory, name); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, content);
    }
    return directory;
  };
  return { ...f, captured, generated, previous, stage };
}

for (const [kind, protocol] of [['audio', 4], ['animation', 7], ['states', 10], ['instances', 11], ['mixed', 11], ['physics', 10]])
  test(`audio request observation preserves ${kind} business protocol ${protocol} and composes with existing queues`, async t => {
    const f = await fixture(t, kind), generated = f.generated;
    assert.equal(generated.backend.version, '0.36.0'); assert.equal(generated.backend.protocolVersion, protocol);
    assert.deepEqual(generated.backend.capabilities, [...f.previous.backend.capabilities, 'runtime.audio-requests']);
    assert.notEqual(generated.backend.sha256, f.previous.backend.sha256);
    assert.deepEqual(generated.sourceMap, f.previous.sourceMap); assert.deepEqual(generated.resourceFiles, f.previous.resourceFiles);
    for (const [name, bytes] of f.previous.files) if (name !== queueName) assert.deepEqual(generated.files.get(name), bytes, name);
    const source = generated.files.get(queueName).toString();
    assert.deepEqual(generated.files.get(backupName), f.previous.files.get(queueName));
    assert.equal(source.split('owner.execution_budget.reserve({"audioRequests": 1})').length, 2);
    assert.ok(source.indexOf('reserved_count += 1') < source.indexOf('"requestId": reserved_count'));
    assert.match(source, /queue\.push_back\([\s\S]+?\n\tpreload\("res:\/\/audio-request-emitter.gd"\)\.emit_accepted\(queue.back\(\)\)\n\towner.schedule_flush\(\)/);
    assert.match(source, /owner\.project_emit\("audio-command",[\s\S]+?\n\t\tpreload\("res:\/\/audio-request-emitter.gd"\)\.emit_applied\(request, sequence\)\n\t\tqueue.pop_front\(\)/);
    assert.match(source, /func clear\(\) -> void:\n\twhile not queue.is_empty\(\):\n\t\tpreload\("res:\/\/audio-request-emitter.gd"\)\.emit_discarded\(queue\[0\]\)\n\t\tqueue.pop_front\(\)/);
    assert.deepEqual([...generated.files.keys()].filter(name => name.startsWith('audio-request')).sort(), [...added].sort());
    assert.deepEqual(JSON.parse(generated.files.get(sidecar)), { format: 'viento-godot-audio-requests', schemaVersion: 1, protocolVersion: 1,
      scope: 'session', clock: 'godot-engine-frames', helper: { path: helperName, sha256: buildHash(generated.files.get(helperName)) },
      scripts: [{ path: queueName, original: backupName, sha256: buildHash(generated.files.get(queueName)), originalSha256: buildHash(f.previous.files.get(queueName)) }] });
    for (const output of [generated, f.previous]) assert.deepEqual((await godotAudioRequestsAssemblyScripts(await f.stage(output))).sort(),
      [...output.files.keys()].filter(name => name.endsWith('.gd')).sort());
  });

test('projects without audio tracks retain their complete previous artifact and standalone scenes stay historical', async t => {
  for (const kind of ['audio', 'animation']) {
    const f = await fixture(t, kind, { withoutAudio: true });
    assert.equal(f.captured.plan.scenes.some(scene => scene.audio), false);
    assert.deepEqual(f.generated, f.previous); assert.equal(f.generated.backend.version, kind === 'audio' ? '0.34.0' : '0.35.0');
    assert.equal(f.generated.backend.capabilities.includes('runtime.audio-requests'), false);
    assert.ok(await godotAudioRequestsAssemblyScripts(await f.stage()));
  }
  const f = await fixture(t), scene = await generateGodotAudioProject(f.captured.plan.scenes[0]);
  assert.equal(scene.backend.capabilities.includes('runtime.audio-requests'), false);
  assert.equal([...scene.files.keys()].some(name => name.startsWith('audio-request')), false);
  assert.equal(await godotAudioRequestsAssemblyScripts(await f.stage(scene)), null);
});

test('audio request inventory rejects missing linked non-file oversized and modified observation files and queue', async t => {
  const f = await fixture(t), directory = await f.stage();
  for (const name of [...added, queueName]) {
    const file = path.join(directory, name), bytes = await fs.readFile(file), target = path.join(f.temporary, 'audio-link-target');
    await fs.rm(file); await assert.rejects(godotAudioRequestsAssemblyScripts(directory), invalid, `${name} missing`);
    await fs.writeFile(target, bytes); await fs.symlink(target, file); await assert.rejects(godotAudioRequestsAssemblyScripts(directory), invalid, `${name} link`);
    await fs.rm(file); await fs.mkdir(file); await assert.rejects(godotAudioRequestsAssemblyScripts(directory), invalid, `${name} directory`);
    await fs.rm(file, { recursive: true }); await fs.writeFile(file, Buffer.alloc(65537)); await assert.rejects(godotAudioRequestsAssemblyScripts(directory), invalid, `${name} oversized`);
    await fs.writeFile(file, Buffer.concat([bytes, Buffer.from('\n# modified\n')])); await assert.rejects(godotAudioRequestsAssemblyScripts(directory), invalid, `${name} modified`);
    await fs.writeFile(file, bytes);
  }
  assert.ok(await godotAudioRequestsAssemblyScripts(directory));
});

test('audio sidecars cannot redirect sources alter schema or rewrite hashes around coordinated edits', async t => {
  const f = await fixture(t), directory = await f.stage(), file = path.join(directory, sidecar), manifest = JSON.parse(f.generated.files.get(sidecar));
  for (const changed of [{ ...manifest, protocolVersion: 2 }, { ...manifest, schemaVersion: 2 }, { ...manifest, scope: 'scene' },
    { ...manifest, clock: 'elapsed-time' }, { ...manifest, extra: true }, { ...manifest, scripts: [] },
    { ...manifest, helper: { ...manifest.helper, path: '../author.gd' } },
    ...['path', 'original', 'sha256', 'originalSha256'].map(key => ({ ...manifest, scripts: [{ ...manifest.scripts[0], [key]: '../author.gd' }] }))]) {
    await fs.writeFile(file, json(changed)); await assert.rejects(godotAudioRequestsAssemblyScripts(directory), invalid);
  }
  for (const changed of ['{', json(manifest).replace('"scope": "session",', '"scope": "scene", "scope": "session",')]) {
    await fs.writeFile(file, changed); await assert.rejects(godotAudioRequestsAssemblyScripts(directory), invalid);
  }
  const original = Buffer.concat([f.previous.files.get(queueName), Buffer.from('\n# coordinated edit\n')]);
  const changed = Buffer.concat([f.generated.files.get(queueName), Buffer.from('\n# coordinated edit\n')]);
  Object.assign(manifest.scripts[0], { sha256: buildHash(changed), originalSha256: buildHash(original) });
  await fs.writeFile(path.join(directory, backupName), original); await fs.writeFile(path.join(directory, queueName), changed);
  await fs.writeFile(file, json(manifest)); await assert.rejects(godotAudioRequestsAssemblyScripts(directory), invalid);
});

test('audio inventory rejects partial downgrades orphans and transformed queues without a sidecar', async t => {
  const f = await fixture(t), directory = await f.stage();
  await fs.writeFile(path.join(directory, queueName), f.previous.files.get(queueName));
  await assert.rejects(godotAudioRequestsAssemblyScripts(directory), invalid);
  await fs.writeFile(path.join(directory, queueName), f.generated.files.get(queueName));
  for (const name of added) { await fs.rm(path.join(directory, name)); await assert.rejects(godotAudioRequestsAssemblyScripts(directory), invalid); }
  await fs.writeFile(path.join(directory, queueName), f.previous.files.get(queueName));
  // A full restoration is a historical directory. Host regeneration and the
  // frozen backend declaration independently reject mislabelled new builds.
  assert.ok(await godotAudioRequestsAssemblyScripts(directory));
  for (const name of [...added, 'audio-requests-original-author.gd.txt', 'audio-request-other.gd']) {
    await fs.writeFile(path.join(directory, name), f.generated.files.get(name) || 'orphan');
    await assert.rejects(godotAudioRequestsAssemblyScripts(directory), invalid, name); await fs.rm(path.join(directory, name));
  }
  await fs.writeFile(path.join(directory, queueName), f.generated.files.get(queueName));
  await assert.rejects(godotAudioRequestsAssemblyScripts(directory), invalid);
});

test('audio observation requires all prior layers and a declared nonempty audio track inventory', async t => {
  const f = await fixture(t, 'instances'), directory = await f.stage();
  for (const name of ['animation-requests.json', 'execution-frames.json', 'execution-clock.json', 'execution-budget.json']) {
    await fs.rm(path.join(directory, name)); await assert.rejects(godotAudioRequestsAssemblyScripts(directory), invalid);
    await fs.writeFile(path.join(directory, name), f.generated.files.get(name));
  }
  const audioFiles = [...f.generated.files.keys()].filter(name => name.endsWith('/audio.json'));
  for (const name of audioFiles) await fs.writeFile(path.join(directory, name), json({ ...JSON.parse(f.generated.files.get(name)), tracks: [] }));
  await assert.rejects(godotAudioRequestsAssemblyScripts(directory), invalid);
  for (const name of audioFiles) await fs.writeFile(path.join(directory, name), f.generated.files.get(name));
  const file = path.join(directory, audioFiles[0]), target = path.join(f.temporary, 'audio-inventory-link');
  await fs.rm(file); await assert.rejects(godotAudioRequestsAssemblyScripts(directory), invalid);
  await fs.writeFile(target, f.generated.files.get(audioFiles[0])); await fs.symlink(target, file);
  await assert.rejects(godotAudioRequestsAssemblyScripts(directory), invalid);
  await fs.rm(file); await fs.writeFile(file, Buffer.alloc(4 * 1024 * 1024 + 1));
  await assert.rejects(godotAudioRequestsAssemblyScripts(directory), invalid);
});

test('only one copied fixed audio Buffer can cross every prior inventory reader without hiding actual file failures', async t => {
  const f = await fixture(t, 'instances'), directory = await f.stage();
  const runtime = f.generated.files.get('execution-frames-original-project-runtime.gd.txt');
  const animations = new Map(['project-animation.gd', 'project-animation-targets.gd'].map(name => [name, f.generated.files.get(`animation-requests-original-${name}.txt`)]));
  const original = f.previous.files.get(queueName);
  for (const [reader, errorCode] of [
    [(dir, bytes) => godotAnimationRequestsAssemblyScripts(dir, undefined, bytes), 'build_animation_requests_invalid'],
    [(dir, bytes) => godotExecutionFramesAssemblyScripts(dir, undefined, animations, bytes), 'build_execution_frames_invalid'],
    [(dir, bytes) => godotExecutionClockAssemblyScripts(dir, undefined, runtime, animations, bytes), 'build_execution_clock_invalid'],
    [(dir, bytes) => godotExecutionBudgetAssemblyScripts(dir, undefined, runtime, animations, bytes), 'build_execution_budget_invalid'],
  ]) {
    assert.ok(await reader(directory, original));
    for (const bytes of ['../author.gd', {}, new Map([[queueName, original]]), new Uint8Array(original), Buffer.alloc(0), Buffer.from('modified')])
      await assert.rejects(reader(directory, bytes), { errorCode });
    const copy = Buffer.from(original), pending = reader(directory, copy); copy.fill(0); assert.ok(await pending);
    const file = path.join(directory, queueName), actual = await fs.readFile(file), target = path.join(f.temporary, 'override-link');
    await fs.rm(file); await assert.rejects(reader(directory, original), { errorCode });
    await fs.writeFile(target, actual); await fs.symlink(target, file); await assert.rejects(reader(directory, original), { errorCode });
    await fs.rm(file); await fs.mkdir(file); await assert.rejects(reader(directory, original), { errorCode });
    await fs.rm(file, { recursive: true }); await fs.writeFile(file, Buffer.alloc(65537)); await assert.rejects(reader(directory, original), { errorCode });
    await fs.writeFile(file, actual);
  }
  for (const [reader, layer, errorCode] of [
    [(dir, bytes) => godotAnimationRequestsAssemblyScripts(dir, undefined, bytes), 'animation-requests.json', 'build_animation_requests_invalid'],
    [(dir, bytes) => godotExecutionFramesAssemblyScripts(dir, undefined, animations, bytes), 'execution-frames.json', 'build_execution_frames_invalid'],
    [(dir, bytes) => godotExecutionClockAssemblyScripts(dir, undefined, runtime, animations, bytes), 'execution-clock.json', 'build_execution_clock_invalid'],
    [(dir, bytes) => godotExecutionBudgetAssemblyScripts(dir, undefined, runtime, animations, bytes), 'execution-budget.json', 'build_execution_budget_invalid'],
  ]) {
    await fs.rm(path.join(directory, layer)); await assert.rejects(reader(directory, original), { errorCode });
    await fs.writeFile(path.join(directory, layer), f.generated.files.get(layer));
  }
});

test('historical budget clock frame and animation generations remain readable with known budget audio bytes', async t => {
  const f = await fixture(t, 'instances');
  for (const generate of [generateGodotExecutionBudgetProject, generateGodotExecutionClockProject, generateGodotExecutionFramesProject, generateGodotAnimationRequestsProject]) {
    const old = await generate(f.captured.plan);
    assert.deepEqual((await godotAudioRequestsAssemblyScripts(await f.stage(old))).sort(), [...old.files.keys()].filter(name => name.endsWith('.gd')).sort());
  }
  const original = await fs.readFile(new URL('../backends/godot4/project-audio.gd', import.meta.url), 'utf8');
  const expected = original.replace('if reserved_count >= 256 or queue.size() >= 64:', 'if queue.size() >= 64 or not owner.execution_budget.reserve({"audioRequests": 1}):');
  assert.deepEqual(await godotExecutionBudgetAudioBytes(), Buffer.from(expected));
});

test('audio request inventory preserves cancellation instead of treating it as modified bytes', async t => {
  const f = await fixture(t), controller = new AbortController(); controller.abort();
  await assert.rejects(godotAudioRequestsAssemblyScripts(await f.stage(), controller.signal), { name: 'AbortError' });
});


test('only the fixed helper UID metadata is allowed after import and it never becomes executable inventory', async t => {
  const f = await fixture(t), directory = await f.stage(), name = helperName + '.uid', file = path.join(directory, name);
  const expected = await godotAudioRequestsAssemblyScripts(directory), uid = 'uid://djrb14601dmmv\n';
  await fs.writeFile(file, uid); assert.deepEqual(await godotAudioRequestsAssemblyScripts(directory), expected);
  assert.equal(expected.includes(name), false);
  for (const extra of ['audio-request-other.gd.uid', name + '.bak', 'audio-requests-original-author.gd.uid']) {
    await fs.writeFile(path.join(directory, extra), uid); await assert.rejects(godotAudioRequestsAssemblyScripts(directory), invalid);
    await fs.rm(path.join(directory, extra));
  }
  for (const bytes of ['uid://../author.gd\n', 'uid://invalid', 'extends Node\n', Buffer.alloc(65)]) {
    await fs.writeFile(file, bytes); await assert.rejects(godotAudioRequestsAssemblyScripts(directory), invalid);
  }
  const target = path.join(f.temporary, 'uid-link'); await fs.writeFile(target, uid); await fs.rm(file); await fs.symlink(target, file);
  await assert.rejects(godotAudioRequestsAssemblyScripts(directory), invalid);
  await fs.rm(file); await fs.mkdir(file); await assert.rejects(godotAudioRequestsAssemblyScripts(directory), invalid);
  await fs.rm(file, { recursive: true }); await fs.writeFile(file, uid);
  await fs.rm(path.join(directory, helperName)); await assert.rejects(godotAudioRequestsAssemblyScripts(directory), invalid);
  await fs.writeFile(path.join(directory, helperName), f.generated.files.get(helperName));
  for (const addedName of added) await fs.rm(path.join(directory, addedName));
  await fs.writeFile(path.join(directory, queueName), f.previous.files.get(queueName));
  await assert.rejects(godotAudioRequestsAssemblyScripts(directory), invalid, 'UID alone cannot turn a historical directory into an observed build');
});

test('native host import and script-check admit the generated helper UID without modifying frozen source bytes', {
  skip: !process.env.VIENTO_GODOT_BIN && 'Set VIENTO_GODOT_BIN for the real import inventory regression', timeout: 120000,
}, async t => {
  const f = await fixture(t), directory = await f.stage();
  for (const [id, name] of f.generated.resourceFiles) {
    const file = path.join(directory, name); await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, f.captured.resources.get(id));
  }
  const { GODOT4_EXECUTION_ADAPTER: adapter } = await import('../backends/godot4-adapter.mjs');
  const tool = await adapter.identify(process.env.VIENTO_GODOT_BIN);
  const expected = await godotAudioRequestsAssemblyScripts(directory);
  const imported = await adapter.executePhase({ phase: 'import', tool, directory, timeoutMs: 60000 });
  assert.equal(imported.status, 'succeeded', json(imported)); assert.deepEqual(adapter.diagnostics(imported, f.captured.plan), []);
  assert.match(await fs.readFile(path.join(directory, helperName + '.uid'), 'utf8'), /^uid:\/\/[a-z0-9]{1,13}\r?\n$/);
  assert.deepEqual(await godotAudioRequestsAssemblyScripts(directory), expected);
  const checked = await adapter.executePhase({ phase: 'script-check', tool, directory, timeoutMs: 60000 });
  assert.equal(checked.status, 'succeeded', json(checked)); assert.deepEqual(adapter.diagnostics(checked, f.captured.plan), []);
  for (const [name, bytes] of f.generated.files) assert.deepEqual(await fs.readFile(path.join(directory, name)), bytes, name);
});
