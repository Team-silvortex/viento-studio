import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { runProjectBuildCommand } from '../project-build.mjs';
import { buildProject } from '../adapters/node-project-build.mjs';
import { createExecutionBackendRegistry } from '../adapters/node-execution-backends.mjs';
import { BEVY_EXECUTION_ADAPTER } from '../backends/bevy-adapter.mjs';
import { BEVY_RUNTIME_IDENTITY } from '../backends/bevy-project.mjs';
import { canonicalJson } from '../../engine/canonical-json.mjs';
import { RUNTIME_CASE_FILE_MAX_BYTES } from '../../engine/runtime-verification-case.mjs';

const app = fileURLToPath(new URL('../../', import.meta.url));
const sceneId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', objectId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const first = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', second = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';
const unknown = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const released = () => ({ left: false, right: false, up: false, down: false });
const row = (instanceId, direction) => ({ instanceId, ...released(), ...(direction ? { [direction]: true } : {}) });
const check = (instanceId, stepIndex, value, state) => ({ instanceId, stepIndex,
  position: { value, tolerance: 0.0001 }, state });
function definition() {
  return { format: 'viento-runtime-case', schemaVersion: 1,
    program: { format: 'viento-runtime-control', schemaVersion: 2, fixedDelta: 0.125,
      steps: [{ inputs: [row(first, 'right'), row(second, 'left')] }, { inputs: [row(second, 'up')] },
        { inputs: [row(first, 'left')] }, { inputs: [] }] },
    checks: [check(first, 0, [220,220], 'moving'), check(second, 0, [490,220], 'moving'),
      check(first, 1, [220,220], 'idle'), check(second, 1, [490,210], 'moving'),
      check(second, 2, [490,210], 'idle'), check(first, 3, [200,220], 'idle'), check(second, 3, [490,210], 'idle')] };
}
const globalProgram = () => ({ format: 'viento-runtime-control', schemaVersion: 1, fixedDelta: 0.125,
  steps: [{ ...released(), right: true }, released(), { ...released(), left: true }, released()] });
const json = (file, value) => fs.writeFile(file, JSON.stringify(value, null, 2) + '\n');
const absent = file => assert.rejects(fs.stat(file), { code: 'ENOENT' });
async function temporary(t) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-runtime-case-cli-'));
  t.after(() => fs.rm(base, { recursive: true, force: true })); return base;
}
async function inventory(directory) {
  const result = {};
  for (const entry of await fs.readdir(directory, { recursive: true, withFileTypes: true })) if (entry.isFile()) {
    const file = path.join(entry.parentPath, entry.name); result[path.relative(directory, file)] = hash(await fs.readFile(file));
  }
  return result;
}
async function fixture(t, version = 2) {
  const base = await temporary(t), root = path.join(base, 'workspace'), output = path.join(base, 'build');
  await fs.cp(path.join(app, 'examples/bevy-headless'), root, { recursive: true });
  const file = path.join(root, 'documents/scenes/demo.json'), scene = JSON.parse(await fs.readFile(file));
  scene.actors[1].controls = 'arrows';
  if (version === 1) { scene.schemaVersion = 1; scene.actors = [scene.actors[0]]; delete scene.actors[0].instanceId; }
  await json(file, scene);
  return { base, root, output };
}
const runArguments = (build, input, backendId = 'org.viento.bevy', tool = process.execPath) =>
  ['--command', 'run', '--build', build, '--backend', backendId, '--tool', tool, '--runtime-case', input];

test('runtime case CLI rejects unsupported modes and mutual inputs before opening either file or build', async () => {
  const base = runArguments('/missing-build', '/missing-case.json');
  for (const option of [['--window'], ['--interactive'], ['--capture'], ['--control-program', '/missing-control.json']]) {
    await assert.rejects(runProjectBuildCommand([...base, ...option]), { errorCode: 'runtime_case_unsupported' });
  }
  for (const command of ['plan', 'build']) {
    await assert.rejects(runProjectBuildCommand(['--command', command, '--runtime-case', '/missing-case.json']),
      { errorCode: 'runtime_case_unsupported' });
  }
  await assert.rejects(runProjectBuildCommand(['--command', 'tool-check', '--runtime-case', '/missing-case.json']),
    { errorCode: 'build_request_invalid' });
});

test('runtime case CLI bounds regular input files and refuses final symlinks before build admission', { skip: process.platform === 'win32' }, async t => {
  const base = await temporary(t), build = path.join(base, 'never-created-build'), file = path.join(base, 'case.json');
  await fs.writeFile(file, Buffer.alloc(RUNTIME_CASE_FILE_MAX_BYTES + 1, 0x20));
  await assert.rejects(runProjectBuildCommand(runArguments(build, file)), { errorCode: 'build_input_limit' });
  await json(file, definition()); const link = path.join(base, 'linked-case.json'); await fs.symlink(file, link);
  const before = await inventory(base);
  await assert.rejects(runProjectBuildCommand(runArguments(build, link)), { errorCode: 'runtime_case_invalid' });
  await assert.rejects(runProjectBuildCommand(runArguments(build, base)), { errorCode: 'build_input_limit' });
  assert.deepEqual(await inventory(base), before); await absent(build);
});

test('runtime case CLI rejects malformed, extra, duplicate, out-of-range and over-budget case data without allocating output', async t => {
  const base = await temporary(t), build = path.join(base, 'never-created-build'), file = path.join(base, 'case.json');
  const changes = [
    value => { value.backendId = 'org.viento.bevy'; },
    value => { value.program.toolPath = '/private/tool'; },
    value => { value.checks[0].objectId = objectId; },
    value => { value.checks.push(structuredClone(value.checks[0])); },
    value => { value.checks[0].stepIndex = value.program.steps.length; },
    value => { value.checks[0].position.tolerance = -1; },
    value => { value.checks[0].state = 'running'; },
    value => { value.checks[0].instanceId = 'definition-not-an-instance'; },
    value => { value.checks = []; },
  ];
  await fs.writeFile(file, '{invalid json');
  await assert.rejects(runProjectBuildCommand(runArguments(build, file)), { errorCode: 'runtime_case_invalid' });
  for (const change of changes) {
    const value = definition(); change(value); await json(file, value);
    const before = await inventory(base);
    await assert.rejects(runProjectBuildCommand(runArguments(build, file)), { errorCode: 'runtime_case_invalid' });
    assert.deepEqual(await inventory(base), before); await absent(build);
  }
  const overChecks = definition(); overChecks.checks = Array.from({ length: 129 }, () => structuredClone(overChecks.checks[0]));
  await json(file, overChecks);
  await assert.rejects(runProjectBuildCommand(runArguments(build, file)), { errorCode: 'runtime_case_limit' });
  const overSteps = definition(); overSteps.program.steps = Array.from({ length: 9 }, () => ({ inputs:
    Array.from({ length: 128 }, (_, index) => row(`bbbbbbbb-bbbb-4bbb-8bbb-${index.toString(16).padStart(12,'0')}`)) }));
  await json(file, overSteps);
  await assert.rejects(runProjectBuildCommand(runArguments(build, file)), { errorCode: 'runtime_case_limit' });
  await absent(build);
});

async function trustedGeneratedFixture(t, version = 2) {
  const h = await fixture(t, version), before = await inventory(h.root);
  const backendRegistry = createExecutionBackendRegistry([{ ...BEVY_EXECUTION_ADAPTER,
    async identify(executable) { return { executable, version: BEVY_RUNTIME_IDENTITY,
      sha256: 'a'.repeat(64), platform: process.platform, arch: process.arch }; },
    async executePhase() { return { status: 'succeeded', exitCode: 0, stdout: '', stderr: '' }; },
  }]);
  const built = await buildProject({ root: h.root, scene: sceneId, output: h.output, backendId: 'org.viento.bevy',
    backendRegistry, tool: process.execPath });
  assert.equal(built.ok, true, JSON.stringify(built.record?.diagnostics || built.diagnostics));
  assert.deepEqual(await inventory(h.root), before); return h;
}

test('runtime case CLI rejects unknown or definition-only targets against the frozen build before creating a session', { skip: process.platform !== 'linux' }, async t => {
  const h = await trustedGeneratedFixture(t), file = path.join(h.base, 'case.json');
  const authorBefore = await inventory(h.root), outputBefore = await inventory(h.output);
  for (const instanceId of [unknown, objectId]) {
    const value = definition(); value.checks[0].instanceId = instanceId; await json(file, value);
    const result = await runProjectBuildCommand(runArguments(h.output, file));
    assert.equal(result.ok, false); assert.equal(result.diagnostics[0].code, 'runtime_case_target_missing');
    assert.equal(result.record, undefined); assert.equal(result.sessionDirectory, undefined);
    assert.deepEqual(await inventory(h.output), outputBefore); await absent(path.join(h.output, 'sessions'));
  }
  assert.deepEqual(await inventory(h.root), authorBefore);
});

test('runtime case CLI preserves plan1 control compatibility by rejecting instance cases before allocating a session', { skip: process.platform !== 'linux' }, async t => {
  const h = await trustedGeneratedFixture(t, 1), file = path.join(h.base, 'case.json');
  const value = definition(); value.program = globalProgram(); await json(file, value);
  const before = await inventory(h.output), result = await runProjectBuildCommand(runArguments(h.output, file));
  assert.equal(result.ok, false); assert.equal(result.diagnostics[0].code, 'runtime_case_unsupported');
  assert.equal(result.record, undefined); assert.deepEqual(await inventory(h.output), before);
  await absent(path.join(h.output, 'sessions'));
});

const engines = [['org.viento.godot4', process.env.VIENTO_GODOT_BIN], ['org.viento.bevy', process.env.VIENTO_BEVY_BIN]];
for (const [backendId, tool] of engines) {
  test(`real ${backendId} CLI evaluates the same offline instance input as pass and one-check fail without changing execution`,
    { skip: !tool || process.platform !== 'linux', timeout: 90000 }, async t => {
      const h = await fixture(t), authorBefore = await inventory(h.root), good = definition(), bad = structuredClone(good);
      bad.checks[3].position.value[0] = 491;
      const goodFile = path.join(h.base, 'pass.json'), badFile = path.join(h.base, 'fail.json'), controlFile = path.join(h.base, 'control.json');
      await json(goodFile, good); await json(badFile, bad); await json(controlFile, globalProgram());
      const built = await runProjectBuildCommand(['--command', 'build', '--root', h.root, '--scene', sceneId,
        '--backend', backendId, '--tool', tool, '--output', h.output]);
      assert.equal(built.ok, true, JSON.stringify(built.record?.diagnostics || built.diagnostics));
      const frozenBefore = await inventory(path.join(h.output, 'project'));
      assert.deepEqual(await inventory(h.root), authorBefore); await fs.rename(h.root, h.root + '-offline');
      await absent(h.root);
      const passed = await runProjectBuildCommand(runArguments(h.output, goodFile, backendId, tool));
      const failed = await runProjectBuildCommand(runArguments(h.output, badFile, backendId, tool));
      assert.equal(passed.ok, true, JSON.stringify(passed.record?.diagnostics || passed.diagnostics));
      assert.equal(failed.ok, false);
      for (const [result, input] of [[passed, good], [failed, bad]]) {
        assert.equal(result.status, 'succeeded'); assert.equal(result.record.status, 'succeeded');
        assert.deepEqual(result.record.diagnostics, []);
        assert.ok(result.record.phases.every(phase => phase.status === 'succeeded'));
        assert.deepEqual(result.record.verification.definition, input);
        assert.equal(result.record.verification.sha256, `sha256:${hash(canonicalJson(input))}`);
        assert.equal(result.record.verification.evaluation.complete, true);
        assert.equal(result.record.verification.evaluation.sampleCount, 4);
        assert.equal(result.record.verification.evaluation.checkCount, 7);
        assert.equal(result.record.verification.evaluation.unavailableChecks, 0);
        assert.deepEqual(result.record.control.samples.map(sample => sample.actors.map(actor => ({ position: actor.position, state: actor.state }))), [
          [{ position: [220,220], state: 'moving' }, { position: [490,220], state: 'moving' }],
          [{ position: [220,220], state: 'idle' }, { position: [490,210], state: 'moving' }],
          [{ position: [200,220], state: 'moving' }, { position: [490,210], state: 'idle' }],
          [{ position: [200,220], state: 'idle' }, { position: [490,210], state: 'idle' }],
        ]);
        const persisted = JSON.parse(await fs.readFile(path.join(result.sessionDirectory, 'session.json')));
        assert.deepEqual(persisted.verification, result.record.verification);
        await absent(path.join(result.sessionDirectory, 'project'));
      }
      const passEvaluation = passed.record.verification.evaluation, failEvaluation = failed.record.verification.evaluation;
      assert.equal(passEvaluation.status, 'passed'); assert.equal(passEvaluation.passedChecks, 7); assert.equal(passEvaluation.failedChecks, 0);
      assert.equal(failEvaluation.status, 'failed'); assert.equal(failEvaluation.passedChecks, 6); assert.equal(failEvaluation.failedChecks, 1);
      assert.deepEqual(failEvaluation.checks.filter(item => item.status === 'failed').map(item => item.checkIndex), [3]);
      assert.equal(failEvaluation.checks[3].positionPassed, false); assert.equal(failEvaluation.checks[3].statePassed, true);
      assert.deepEqual(failEvaluation.checks[3].actual, { position: [490,210], state: 'moving' });
      assert.deepEqual(passed.record.control.program, failed.record.control.program);
      assert.equal(passed.record.control.sha256, failed.record.control.sha256);
      assert.notEqual(passed.record.verification.sha256, failed.record.verification.sha256);
      assert.deepEqual(passed.record.events, failed.record.events);
      const legacy = await runProjectBuildCommand(['--command', 'run', '--build', h.output, '--backend', backendId,
        '--tool', tool, '--control-program', controlFile]);
      assert.equal(legacy.ok, true, JSON.stringify(legacy.record?.diagnostics || legacy.diagnostics));
      assert.equal(Object.hasOwn(legacy.record, 'verification'), false);
      assert.equal(legacy.record.control.samples.length, 4);
      assert.deepEqual(legacy.record.events.at(-1).actors.map(actor => actor.position), [[200,220],[500,220]]);
      await absent(path.join(legacy.sessionDirectory, 'project'));
      assert.deepEqual(await inventory(h.root + '-offline'), authorBefore);
      assert.deepEqual(await inventory(path.join(h.output, 'project')), frozenBefore);
      t.diagnostic(`${backendId}: 7/7 checks passed; same program 6/7 passed, check 3 failed; ${passed.record.control.sha256}; ${built.record.tool.version}`);
    });
}
