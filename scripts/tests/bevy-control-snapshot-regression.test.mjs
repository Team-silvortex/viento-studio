import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { BEVY_EXECUTION_ADAPTER as bevy } from '../backends/bevy-adapter.mjs';

const fixture = JSON.parse(await fs.readFile(new URL('./fixtures/scene-model/legacy-plan-v2.json', import.meta.url), 'utf8')).plan;
async function mock(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-bevy-control-snapshot-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const directory = path.join(root, 'project'), executable = path.join(root, 'tool'), marker = path.join(root, 'executed');
  await fs.mkdir(directory);
  const plan = structuredClone(fixture);
  plan.resources = []; plan.requiredCapabilities = plan.requiredCapabilities.filter(item => item !== 'image');
  for (const actor of plan.actors) delete actor.imageResourceId;
  const generated = await bevy.generate(plan);
  for (const [name, bytes] of generated.files) await fs.writeFile(path.join(directory, name), bytes);
  await fs.writeFile(executable, `#!${process.execPath}\nconst fs=require('node:fs');\nfs.writeFileSync(${JSON.stringify(marker)},'executed');\nconsole.log(fs.readFileSync('control-program.json','utf8'));\n`, { mode: 0o700 });
  return { directory, marker, plan, tool: { executable } };
}
const keys = (left = false, right = false, up = false, down = false) => ({ left, right, up, down });
const single = () => ({ format: 'viento-runtime-control', schemaVersion: 1, fixedDelta: 0,
  steps: [keys(false, true), keys()] });
const paired = (instanceId) => ({ format: 'viento-runtime-control', schemaVersion: 2, fixedDelta: 0.125,
  steps: [{ inputs: [{ instanceId, ...keys(false, true) }] }, { inputs: [{ instanceId, ...keys() }] }] });

test('Bevy rejects a caller program invalid at invocation even if immediately repaired', { skip: process.platform !== 'linux' }, async t => {
  const f = await mock(t), value = single();
  const pending = bevy.executePhase({ phase: 'run', directory: f.directory, tool: f.tool, controlProgram: value });
  value.fixedDelta = 0.125;
  await assert.rejects(pending, { errorCode: 'runtime_control_invalid' });
  await assert.rejects(fs.stat(f.marker), { code: 'ENOENT' });
  await assert.rejects(fs.stat(path.join(f.directory, 'control-program.json')), { code: 'ENOENT' });
});

test('Bevy snapshots nested per-instance controls before asynchronous staging', { skip: process.platform !== 'linux' }, async t => {
  const f = await mock(t), value = paired(f.plan.actors[0].instanceId), original = structuredClone(value);
  const pending = bevy.executePhase({ phase: 'run', directory: f.directory, tool: f.tool, controlProgram: value });
  value.steps[0].inputs[0].right = false;
  value.steps[0].inputs[0].instanceId = f.plan.actors[1].instanceId;
  value.steps[0].inputs.push({ instanceId: f.plan.actors[0].instanceId, ...keys(true) });
  const result = await pending;
  assert.equal(result.status, 'succeeded', result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), original);
  assert.equal(await fs.readFile(f.marker, 'utf8'), 'executed');
  await assert.rejects(fs.stat(path.join(f.directory, 'control-program.json')), { code: 'ENOENT' });
});
