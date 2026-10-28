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
import { generateGodotExecutionBudgetProject, godotExecutionBudgetAssemblyScripts,
  godotExecutionBudgetAnimationBytes } from '../backends/godot4-execution-budget.mjs';
import { generateGodotExecutionClockProject, godotExecutionClockAssemblyScripts } from '../backends/godot4-execution-clock.mjs';
import { generateGodotExecutionFramesProject, godotExecutionFramesAssemblyScripts } from '../backends/godot4-execution-frames.mjs';
import { generateGodotAnimationRequestsProject, godotAnimationRequestsAssemblyScripts } from '../backends/godot4-animation-requests.mjs';
import { GODOT4_EXECUTION_ADAPTER as adapter } from '../backends/godot4-adapter.mjs';

const invalid = { errorCode: 'build_animation_requests_invalid' };
const queues = ['project-animation.gd', 'project-animation-targets.gd'];
const helperName = 'animation-request-emitter.gd', sidecar = 'animation-requests.json';
const backupName = name => `animation-requests-original-${name}.txt`;
const additions = generated => [...generated.files.keys()].filter(name => name.startsWith('animation-request'));
const json = value => JSON.stringify(value, null, 2) + '\n';
async function fixture(t, kind = 'animation') {
  const f = await (kind === 'events' ? projectEventsAuthor : kind === 'physics' ? scenePhysics2DPlatformEventsAuthor : projectAnimationClipsAuthor)(t);
  if (kind === 'states') await f.script('checkpoint', DEFAULT_EDITABLE_GODOT_ANIMATION_STATE_SCRIPT);
  if (kind === 'instances' || kind === 'mixed') for (const index of kind === 'mixed' ? [0] : [0, 1])
    await f.edit(`documents/animations/scene-${index}.json`, doc => { doc.schemaVersion = 4; doc.playbackScope = 'instance'; });
  const captured = await captureBuildSnapshot(f.author, f.assemblyId); assert.equal(captured.ok, true);
  const before = structuredClone(captured.plan), previous = await generateGodotExecutionFramesProject(captured.plan);
  const generated = await generateGodotAnimationRequestsProject(captured.plan); assert.deepEqual(captured.plan, before);
  const stage = async (output = generated) => {
    const directory = await fs.mkdtemp(path.join(f.temporary, 'animation-requests-'));
    for (const [name, content] of output.files) {
      const file = path.join(directory, name); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, content);
    }
    return directory;
  };
  return { ...f, captured, generated, previous, stage };
}

for (const [kind, count, protocol] of [['animation', 1, 7], ['states', 1, 10], ['instances', 2, 11], ['mixed', 2, 11], ['physics', 1, 10]])
  test(`animation request observation preserves ${kind} business protocol ${protocol} and existing queue admission`, async t => {
    const f = await fixture(t, kind), generated = f.generated, selected = queues.slice(0, count);
    assert.equal(generated.backend.version, '0.35.0'); assert.equal(generated.backend.protocolVersion, protocol);
    assert.deepEqual(generated.backend.capabilities, [...f.previous.backend.capabilities, 'runtime.animation-requests']);
    assert.notEqual(generated.backend.sha256, f.previous.backend.sha256);
    assert.deepEqual(generated.sourceMap, f.previous.sourceMap); assert.deepEqual(generated.resourceFiles, f.previous.resourceFiles);
    for (const [name, bytes] of f.previous.files) {
      if (!selected.includes(name)) assert.deepEqual(generated.files.get(name), bytes, name);
      else {
        const source = generated.files.get(name).toString();
        assert.deepEqual(generated.files.get(backupName(name)), bytes);
        assert.equal(source.split('owner.execution_budget.reserve({"animationRequests": 1})').length, 2);
        assert.ok(source.indexOf('reserved_count += 1') < source.indexOf('"requestId": reserved_count'));
        assert.match(source, /queue\.push_back\([^\n]+\)\n\tpreload\("res:\/\/animation-request-emitter.gd"\)\.emit_accepted\(queue.back\(\)\)\n\towner.schedule_flush\(\)/);
        assert.match(source, /owner\.project_emit\("animation-command",[\s\S]+?\n\t\tpreload\("res:\/\/animation-request-emitter.gd"\)\.emit_applied\(request, sequence\)\n\t\tqueue.pop_front\(\)/);
        assert.match(source, /func clear\(\) -> void:\n\twhile not queue.is_empty\(\):\n\t\tpreload\("res:\/\/animation-request-emitter.gd"\)\.emit_discarded\(queue\[0\]\)\n\t\tqueue.pop_front\(\)/);
      }
    }
    assert.deepEqual(additions(generated).sort(), [sidecar, helperName, ...selected.map(backupName)].sort());
    const manifest = JSON.parse(generated.files.get(sidecar));
    assert.deepEqual(manifest, { format: 'viento-godot-animation-requests', schemaVersion: 1, protocolVersion: 1,
      scope: 'session', clock: 'godot-engine-frames', helper: { path: helperName, sha256: buildHash(generated.files.get(helperName)) },
      scripts: selected.map(name => ({ path: name, original: backupName(name), sha256: buildHash(generated.files.get(name)),
        originalSha256: buildHash(f.previous.files.get(name)) })) });
    assert.deepEqual((await godotAnimationRequestsAssemblyScripts(await f.stage())).sort(),
      [...generated.files.keys()].filter(name => name.endsWith('.gd')).sort());
    assert.deepEqual((await godotAnimationRequestsAssemblyScripts(await f.stage(f.previous))).sort(),
      [...f.previous.files.keys()].filter(name => name.endsWith('.gd')).sort());
  });

test('projects without animation keep the complete 0.34 artifact and standalone scenes receive no request observer', async t => {
  const f = await fixture(t, 'events');
  assert.deepEqual(f.generated, f.previous); assert.equal(f.generated.backend.version, '0.34.0');
  assert.deepEqual(additions(f.generated), []);
  const scene = await adapter.generate(f.captured.plan.scenes[0]);
  assert.equal(scene.backend.capabilities.includes('runtime.animation-requests'), false);
  assert.deepEqual(additions(scene), []);
  assert.equal(await godotAnimationRequestsAssemblyScripts(await f.stage(scene)), null);
});

test('request inventory rejects every missing, linked, non-file, oversized or altered helper, backup and queue', async t => {
  const f = await fixture(t, 'instances'), directory = await f.stage();
  for (const name of [...additions(f.generated), ...queues]) {
    const file = path.join(directory, name), bytes = await fs.readFile(file), target = path.join(f.temporary, 'link-target');
    await fs.rm(file); await assert.rejects(godotAnimationRequestsAssemblyScripts(directory), invalid, `${name} missing`);
    await fs.writeFile(target, bytes); await fs.symlink(target, file);
    await assert.rejects(godotAnimationRequestsAssemblyScripts(directory), invalid, `${name} linked`);
    await fs.rm(file); await fs.mkdir(file);
    await assert.rejects(godotAnimationRequestsAssemblyScripts(directory), invalid, `${name} directory`);
    await fs.rm(file, { recursive: true }); await fs.writeFile(file, Buffer.alloc(65537, 32));
    await assert.rejects(godotAnimationRequestsAssemblyScripts(directory), invalid, `${name} oversized`);
    await fs.writeFile(file, Buffer.concat([bytes, Buffer.from('\n# modified\n')]));
    await assert.rejects(godotAnimationRequestsAssemblyScripts(directory), invalid, `${name} modified`);
    await fs.writeFile(file, bytes);
  }
  assert.ok(await godotAnimationRequestsAssemblyScripts(directory));
});

test('request sidecars cannot redirect source reads, change identities or invent protocol fields', async t => {
  const f = await fixture(t), directory = await f.stage(), file = path.join(directory, sidecar);
  const manifest = JSON.parse(f.generated.files.get(sidecar));
  for (const changed of [{ ...manifest, protocolVersion: 2 }, { ...manifest, schemaVersion: 2 }, { ...manifest, scope: 'scene' },
    { ...manifest, clock: 'elapsed-time' }, { ...manifest, extra: true }, { ...manifest, scripts: [] },
    { ...manifest, helper: { ...manifest.helper, path: '../author.gd' } },
    { ...manifest, scripts: [{ ...manifest.scripts[0], path: '../author.gd' }] },
    { ...manifest, scripts: [{ ...manifest.scripts[0], original: '../author.gd' }] },
    { ...manifest, scripts: [{ ...manifest.scripts[0], sha256: '0'.repeat(64) }] },
    { ...manifest, scripts: [{ ...manifest.scripts[0], originalSha256: '0'.repeat(64) }] }]) {
    await fs.writeFile(file, json(changed)); await assert.rejects(godotAnimationRequestsAssemblyScripts(directory), invalid);
  }
  for (const changed of ['{', json(manifest).replace('"scope": "session",', '"scope": "scene", "scope": "session",')]) {
    await fs.writeFile(file, changed); await assert.rejects(godotAnimationRequestsAssemblyScripts(directory), invalid);
  }
});

test('matching modified backup and generated queue hashes cannot replace the frozen budget source', async t => {
  const f = await fixture(t, 'instances'), directory = await f.stage();
  for (const name of queues) {
    const original = Buffer.concat([f.previous.files.get(name), Buffer.from('\n# coordinated edit\n')]);
    const changed = Buffer.concat([f.generated.files.get(name), Buffer.from('\n# coordinated edit\n')]);
    const manifest = JSON.parse(f.generated.files.get(sidecar));
    Object.assign(manifest.scripts.find(row => row.path === name), { sha256: buildHash(changed), originalSha256: buildHash(original) });
    await fs.writeFile(path.join(directory, backupName(name)), original); await fs.writeFile(path.join(directory, name), changed);
    await fs.writeFile(path.join(directory, sidecar), json(manifest));
    await assert.rejects(godotAnimationRequestsAssemblyScripts(directory), invalid, name);
    for (const restored of [name, backupName(name), sidecar]) await fs.writeFile(path.join(directory, restored), f.generated.files.get(restored));
  }
});

test('request inventory rejects partial downgrade, orphan files and observer remnants without a sidecar', async t => {
  const f = await fixture(t, 'instances'), directory = await f.stage();
  for (const name of queues) {
    await fs.writeFile(path.join(directory, name), f.previous.files.get(name));
    await assert.rejects(godotAnimationRequestsAssemblyScripts(directory), invalid, `${name} downgraded`);
    await fs.writeFile(path.join(directory, name), f.generated.files.get(name));
  }
  for (const name of additions(f.generated)) {
    await fs.rm(path.join(directory, name)); await assert.rejects(godotAnimationRequestsAssemblyScripts(directory), invalid);
  }
  for (const name of queues) await fs.writeFile(path.join(directory, name), f.previous.files.get(name));
  // A complete restoration is a historical directory; frozen build metadata
  // and host regeneration independently reject a falsely declared new build.
  assert.ok(await godotAnimationRequestsAssemblyScripts(directory));
  for (const name of [...additions(f.generated), 'animation-requests-original-author.gd.txt']) {
    await fs.writeFile(path.join(directory, name), f.generated.files.get(name) || 'orphan');
    await assert.rejects(godotAnimationRequestsAssemblyScripts(directory), invalid, `${name} orphan`);
    await fs.rm(path.join(directory, name));
  }
  for (const name of queues) {
    await fs.writeFile(path.join(directory, name), f.generated.files.get(name));
    await assert.rejects(godotAnimationRequestsAssemblyScripts(directory), invalid, `${name} transformed`);
    await fs.writeFile(path.join(directory, name), f.previous.files.get(name));
  }
});

test('request inventory requires each previous policy layer and bounds the assembly inventory', async t => {
  const f = await fixture(t), directory = await f.stage();
  for (const name of ['execution-frames.json', 'execution-clock.json', 'execution-budget.json']) {
    await fs.rm(path.join(directory, name)); await assert.rejects(godotAnimationRequestsAssemblyScripts(directory), invalid);
    await fs.writeFile(path.join(directory, name), f.generated.files.get(name));
  }
  await fs.writeFile(path.join(directory, 'assembly.json'), Buffer.alloc(4 * 1024 * 1024 + 1));
  await assert.rejects(godotAnimationRequestsAssemblyScripts(directory), invalid);
});

test('only the complete fixed animation Buffer map can cross the previous inventory readers', async t => {
  const f = await fixture(t, 'instances'), directory = await f.stage();
  const originalRuntime = f.generated.files.get('execution-frames-original-project-runtime.gd.txt');
  const originals = new Map(queues.map(name => [name, f.previous.files.get(name)]));
  for (const [reader, errorCode] of [
    [(dir, signal, map) => godotExecutionFramesAssemblyScripts(dir, signal, map), 'build_execution_frames_invalid'],
    [(dir, signal, map) => godotExecutionClockAssemblyScripts(dir, signal, originalRuntime, map), 'build_execution_clock_invalid'],
    [(dir, signal, map) => godotExecutionBudgetAssemblyScripts(dir, signal, originalRuntime, map), 'build_execution_budget_invalid'],
  ]) {
    assert.ok(await reader(directory, undefined, originals));
    for (const map of ['../author.gd', {}, new Map(), new Map([['project-animation.gd', '../author.gd']]),
      new Map([['behaviors/author.gd', Buffer.from('source')]]), new Map([['project-animation.gd', originals.get('project-animation.gd')]]),
      new Map([...originals, ['project-runtime.gd', originalRuntime]])])
      await assert.rejects(reader(directory, undefined, map), { errorCode });
    const copy = new Map([...originals].map(([name, bytes]) => [name, Buffer.from(bytes)]));
    const pending = reader(directory, undefined, copy); for (const bytes of copy.values()) bytes.fill(0); copy.clear();
    assert.ok(await pending, 'caller changes cannot affect admitted original bytes');
    for (const name of queues) {
      const file = path.join(directory, name), bytes = await fs.readFile(file), target = path.join(f.temporary, 'override-link');
      await fs.rm(file); await assert.rejects(reader(directory, undefined, originals), { errorCode });
      await fs.writeFile(target, bytes); await fs.symlink(target, file);
      await assert.rejects(reader(directory, undefined, originals), { errorCode });
      await fs.rm(file); await fs.writeFile(file, Buffer.alloc(65537));
      await assert.rejects(reader(directory, undefined, originals), { errorCode });
      await fs.writeFile(file, bytes);
    }
  }
  for (const [reader, layer, errorCode] of [
    [(dir, map) => godotExecutionFramesAssemblyScripts(dir, undefined, map), 'execution-frames.json', 'build_execution_frames_invalid'],
    [(dir, map) => godotExecutionClockAssemblyScripts(dir, undefined, originalRuntime, map), 'execution-clock.json', 'build_execution_clock_invalid'],
    [(dir, map) => godotExecutionBudgetAssemblyScripts(dir, undefined, originalRuntime, map), 'execution-budget.json', 'build_execution_budget_invalid'],
  ]) {
    await fs.rm(path.join(directory, layer)); await assert.rejects(reader(directory, originals), { errorCode });
    await fs.writeFile(path.join(directory, layer), f.generated.files.get(layer));
  }
});

test('old budget and clock generations remain readable and original animation bytes cover the historical queue variants', async t => {
  const f = await fixture(t, 'instances');
  for (const generate of [generateGodotExecutionBudgetProject, generateGodotExecutionClockProject]) {
    const old = await generate(f.captured.plan);
    assert.deepEqual((await godotAnimationRequestsAssemblyScripts(await f.stage(old))).sort(),
      [...old.files.keys()].filter(name => name.endsWith('.gd')).sort());
  }
  for (const schema of [6, 7, 8, 9, 10, 11, 12]) {
    const originals = await godotExecutionBudgetAnimationBytes(schema), template = schema === 6 ? 'project-animation.gd' : 'project-animation-clips.gd';
    const expected = (await fs.readFile(new URL('../backends/godot4/' + template, import.meta.url), 'utf8'))
      .replace('if reserved_count >= 256 or queue.size() >= 64:', 'if queue.size() >= 64 or not owner.execution_budget.reserve({"animationRequests": 1}):');
    assert.deepEqual(originals.get('project-animation.gd'), Buffer.from(expected));
    assert.equal(originals.has('project-animation-targets.gd'), schema === 12);
  }
});

test('request inventory keeps cancellation distinct from invalid generated bytes', async t => {
  const f = await fixture(t), controller = new AbortController(); controller.abort();
  await assert.rejects(godotAnimationRequestsAssemblyScripts(await f.stage(), controller.signal), { name: 'AbortError' });
});
