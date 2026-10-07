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
const first = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';
const second = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';
const definition = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const release = { left: false, right: false, up: false, down: false };
const program = { format: 'viento-runtime-control', schemaVersion: 2, fixedDelta: 0.125, steps: [
  { inputs: [{ instanceId: first, ...release, right: true }, { instanceId: second, ...release, left: true }] },
  { inputs: [{ instanceId: second, ...release, up: true }] },
  { inputs: [{ instanceId: first, ...release, left: true }] },
  { inputs: [] },
] };
async function temporary(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-instance-cli-'));
  t.after(() => fs.rm(root, { recursive: true, force: true })); return root;
}
async function inventory(root) {
  const result = {};
  for (const entry of await fs.readdir(root, { recursive: true, withFileTypes: true })) if (entry.isFile()) {
    const file = path.join(entry.parentPath, entry.name), relative = path.relative(root, file);
    if (!relative.startsWith('sessions/')) result[relative] = buildHash(await fs.readFile(file));
  }
  return result;
}

test('instance-control CLI refuses code, paths, repeated targets and oversized data before accessing a build', async t => {
  const root = await temporary(t), input = path.join(root, 'control.json');
  const args = ['--command', 'run', '--build', path.join(root, 'uncreated'), '--control-program', input];
  for (const value of [{ ...program, backendId: 'org.viento.bevy' },
    { ...program, steps: [{ inputs: [{ instanceId: first, ...release, method: 'move' }] }, { inputs: [] }] },
    { ...program, steps: [{ inputs: [program.steps[0].inputs[0], program.steps[0].inputs[0]] }, { inputs: [] }] }]) {
    await fs.writeFile(input, JSON.stringify(value));
    await assert.rejects(runProjectBuildCommand(args), { errorCode: 'runtime_control_invalid' });
  }
  await fs.writeFile(input, JSON.stringify(program) + ' '.repeat(256 * 1024));
  await assert.rejects(runProjectBuildCommand(args), { errorCode: 'build_input_limit' });
  await assert.rejects(fs.stat(path.join(root, 'uncreated')), { code: 'ENOENT' });
});

for (const [backendId, tool] of [['org.viento.bevy', process.env.VIENTO_BEVY_BIN], ['org.viento.godot4', process.env.VIENTO_GODOT_BIN]]) {
  test(`real ${backendId} CLI routes repeated-definition instances independently and releases omitted inputs offline`,
    { skip: !tool || process.platform !== 'linux', timeout: 60000 }, async t => {
      const root = await temporary(t), workspace = path.join(root, 'workspace'), output = path.join(root, 'build');
      await fs.cp(path.join(app, 'examples/bevy-headless'), workspace, { recursive: true });
      const sceneFile = path.join(workspace, 'documents/scenes/demo.json'), scene = JSON.parse(await fs.readFile(sceneFile));
      scene.actors[1].controls = 'arrows'; await fs.writeFile(sceneFile, JSON.stringify(scene, null, 2) + '\n');
      const sourceBefore = await inventory(workspace);
      const built = await runProjectBuildCommand(['--command', 'build', '--root', workspace, '--scene',
        'dddddddd-dddd-4ddd-8ddd-dddddddddddd', '--backend', backendId, '--tool', tool, '--output', output]);
      assert.equal(built.ok, true, JSON.stringify(built)); const buildBefore = await inventory(output);
      await fs.rename(workspace, workspace + '-offline');
      const input = path.join(root, 'inputs.json');
      const runArgs = ['--command', 'run', '--build', output, '--backend', backendId, '--tool', tool, '--control-program', input];
      for (const target of [definition, 'cccccccc-cccc-4ccc-8ccc-cccccccccccc']) {
        await fs.writeFile(input, JSON.stringify({ ...program, steps: [{ inputs: [{ instanceId: target, ...release, right: true }] }, { inputs: [] }] }));
        const rejected = await runProjectBuildCommand(runArgs); assert.equal(rejected.ok, false);
        assert.ok(rejected.diagnostics.some(item => item.code === 'runtime_control_target_missing'), JSON.stringify(rejected));
        await assert.rejects(fs.stat(path.join(output, 'sessions')), { code: 'ENOENT' });
      }
      // Schema 2 permits larger pretty-print files; the old schema-1 limit stays 16 KiB.
      await fs.writeFile(input, JSON.stringify(program, null, 2) + ' '.repeat(20 * 1024));
      const ran = await runProjectBuildCommand(runArgs); assert.equal(ran.ok, true, JSON.stringify(ran));
      assert.deepEqual(ran.record.control.program, program);
      assert.equal(ran.record.control.sha256, `sha256:${buildHash(canonicalJson(program))}`);
      assert.deepEqual(ran.record.control.samples.map(sample => sample.actors.map(actor => actor.position)), [
        [[220, 220], [490, 220]], [[220, 220], [490, 210]], [[200, 220], [490, 210]], [[200, 220], [490, 210]],
      ]);
      assert.deepEqual(ran.record.control.samples.map(sample => sample.actors.map(actor => actor.state)), [
        ['moving', 'moving'], ['idle', 'moving'], ['moving', 'idle'], ['idle', 'idle'],
      ]);
      assert.deepEqual(ran.record.runtime.control, { stepCount: 4, completedSteps: 4, fixedDelta: 0.125 });
      assert.deepEqual(await inventory(workspace + '-offline'), sourceBefore);
      assert.deepEqual(await inventory(output), buildBefore);
      await assert.rejects(fs.stat(path.join(ran.sessionDirectory, 'project')), { code: 'ENOENT' });
    });
}
