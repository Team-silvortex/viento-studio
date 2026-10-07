import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { runProjectBuildCommand } from '../project-build.mjs';
import { buildHash } from '../adapters/node-build-snapshot.mjs';
import { canonicalJson } from '../../engine/world-projection.mjs';

const app = fileURLToPath(new URL('../../', import.meta.url));
const released = { left: false, right: false, up: false, down: false };
const program = { format: 'viento-runtime-control', schemaVersion: 1, fixedDelta: 0.125,
  steps: [{ ...released, right: true }, released, { ...released, left: true }, released] };
async function temporary(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-control-cli-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}
async function inventory(root) {
  const files = {};
  for (const entry of await fs.readdir(root, { recursive: true, withFileTypes: true })) if (entry.isFile()) {
    const file = path.join(entry.parentPath, entry.name);
    const relative = path.relative(root, file);
    if (!relative.startsWith('sessions/')) files[relative] = buildHash(await fs.readFile(file));
  }
  return files;
}

test('CLI control replay rejects non-run and non-finite modes before opening the selected input', async () => {
  for (const options of [[], ['--command', 'build'], ['--command', 'run', '--window'],
    ['--command', 'run', '--interactive'], ['--command', 'run', '--capture']]) {
    await assert.rejects(runProjectBuildCommand([...options, '--control-program', '/missing/control.json']),
      { errorCode: 'runtime_control_unsupported' });
  }
});

test('CLI controls accept only bounded regular JSON data; code, path overrides and symlinks are refused', async t => {
  const directory = await temporary(t), input = path.join(directory, 'input.json');
  const args = ['--command', 'run', '--build', path.join(directory, 'never-created'), '--control-program', input];
  for (const value of ['not-json', 'null', JSON.stringify({ ...program, sourcePath: '/tmp/injected' }),
    JSON.stringify({ ...program, steps: [{ ...released, script: 'execute()' }] }),
    JSON.stringify({ ...program, fixedDelta: 0.5 })]) {
    await fs.writeFile(input, value);
    await assert.rejects(runProjectBuildCommand(args), { errorCode: 'runtime_control_invalid' });
  }
  await fs.writeFile(input, ' '.repeat(256 * 1024 + 1));
  await assert.rejects(runProjectBuildCommand(args), { errorCode: 'build_input_limit' });
  await fs.writeFile(input, JSON.stringify(program) + ' '.repeat(16 * 1024));
  await assert.rejects(runProjectBuildCommand(args), { errorCode: 'build_input_limit' });
  const link = path.join(directory, 'linked.json');
  await fs.writeFile(input, JSON.stringify(program)); await fs.symlink(input, link);
  await assert.rejects(runProjectBuildCommand([...args.slice(0, -1), link]), { errorCode: 'runtime_control_invalid' });
  await assert.rejects(fs.stat(path.join(directory, 'never-created')), { code: 'ENOENT' });
});

for (const [backendId, tool] of [['org.viento.bevy', process.env.VIENTO_BEVY_BIN], ['org.viento.godot4', process.env.VIENTO_GODOT_BIN]]) {
  test(`CLI replays real ${backendId} offline, records every step and leaves author data and output unchanged`,
    { skip: !tool || process.platform !== 'linux', timeout: 60000 }, async t => {
      const directory = await temporary(t), workspace = path.join(directory, 'workspace'), output = path.join(directory, 'output');
      await fs.cp(path.join(app, 'examples/bevy-headless'), workspace, { recursive: true });
      const input = path.join(directory, 'control.json'); await fs.writeFile(input, JSON.stringify(program));
      const sourceBefore = await inventory(workspace);
      const built = await runProjectBuildCommand(['--command', 'build', '--root', workspace, '--scene',
        'dddddddd-dddd-4ddd-8ddd-dddddddddddd', '--backend', backendId, '--tool', tool, '--output', output]);
      assert.equal(built.ok, true, JSON.stringify(built)); const outputBefore = await inventory(output);
      await fs.rename(workspace, workspace + '-offline');
      const run = await runProjectBuildCommand(['--command', 'run', '--build', output, '--backend', backendId,
        '--tool', tool, '--control-program', input]);
      assert.equal(run.ok, true, JSON.stringify(run));
      assert.deepEqual(run.record.control.program, program);
      assert.equal(run.record.control.sha256, `sha256:${buildHash(canonicalJson(program))}`);
      assert.deepEqual(run.record.control.samples.map(sample => sample.actors[0].position), [[220, 220], [220, 220], [200, 220], [200, 220]]);
      assert.deepEqual(run.record.control.samples.map(sample => sample.actors[0].state), ['moving', 'idle', 'moving', 'idle']);
      assert.ok(run.record.control.samples.every(sample => sample.actors[1].state === 'idle'
        && sample.actors[1].position[0] === 500 && sample.actors[1].position[1] === 220));
      assert.deepEqual(run.record.runtime.control, { stepCount: 4, completedSteps: 4, fixedDelta: 0.125 });
      assert.equal(run.record.events.at(-1).fixedDelta, 0.125);
      assert.equal(run.record.events.at(-1).actors[0].position[0], 200);
      assert.deepEqual(await inventory(workspace + '-offline'), sourceBefore);
      assert.deepEqual(await inventory(output), outputBefore);
      await assert.rejects(fs.stat(path.join(run.sessionDirectory, 'project')), { code: 'ENOENT' });
      const ordinary = await runProjectBuildCommand(['--command', 'run', '--build', output, '--backend', backendId, '--tool', tool]);
      assert.equal(ordinary.ok, true, JSON.stringify(ordinary)); assert.equal(ordinary.record.control, undefined);
      assert.equal(ordinary.record.events.at(-1).actors[0].position[0], 240);
    });
}
