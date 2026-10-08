import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { runProjectBuild } from '../adapters/node-project-build.mjs';
import { createExecutionBackendRegistry } from '../adapters/node-execution-backends.mjs';
import { canonicalJson } from '../../engine/canonical-json.mjs';
import { buildHash } from '../adapters/node-build-snapshot.mjs';
import { fixture, inventory, registry, build, fakeTool, backendId, runtimeCase, unknown, phaseResult } from './runtime-case-fixture.mjs';

test('verification is detached, persisted and separate from execution status without changing author or frozen bytes', async t => {
  const h = await fixture(t), authors = await inventory(h.root), backendRegistry = await build(h), frozen = await inventory(h.output);
  const definition = runtimeCase(), expected = runtimeCase(), updates = [];
  const pending = runProjectBuild({ buildDirectory: h.output, backendRegistry, tool: fakeTool.executable, runtimeCase: definition,
    onProgress(event) { if (event.verification) { updates.push(event.verification.evaluation.status); event.verification.definition.checks[0].position.value[0] = -100; } } });
  definition.checks[0].instanceId = unknown; definition.program.steps[0].inputs.length = 0;
  const result = await pending;
  assert.equal(result.ok, true, JSON.stringify(result)); assert.equal(result.status, 'succeeded');
  assert.equal(result.record.verification.evaluation.status, 'passed'); assert.deepEqual(result.record.verification.definition, expected);
  assert.equal(result.record.verification.sha256, `sha256:${buildHash(canonicalJson(expected))}`);
  assert.ok(updates.every(status => status === 'incomplete'));
  const saved = JSON.parse(await fs.readFile(path.join(result.sessionDirectory, 'session.json')));
  assert.deepEqual(saved.verification, result.record.verification); assert.equal(saved.control.samples.length, 4);
  assert.deepEqual(await inventory(h.root), authors);
  const after = await inventory(h.output); for (const [file, hash] of Object.entries(frozen)) assert.equal(after[file], hash, file);
  await assert.rejects(fs.stat(path.join(result.sessionDirectory, 'project')), { code: 'ENOENT' });
});

test('a failed expectation keeps execution succeeded and produces an unsuccessful verification result', async t => {
  const h = await fixture(t), backendRegistry = await build(h), definition = runtimeCase();
  definition.checks[1].position.value[0] = 999;
  const result = await runProjectBuild({ buildDirectory: h.output, backendRegistry, tool: fakeTool.executable, runtimeCase: definition });
  assert.equal(result.status, 'succeeded'); assert.equal(result.record.status, 'succeeded'); assert.equal(result.ok, false);
  assert.equal(result.record.diagnostics.length, 0); assert.equal(result.record.verification.evaluation.status, 'failed');
  assert.equal(result.record.verification.evaluation.failedChecks, 1); assert.deepEqual(result.record.verification.evaluation.checks[1].actual.position, [200, 220]);
});

test('case structure, conflicting programs and non-finite modes are rejected before filesystem access', async () => {
  for (const options of [{ runtimeCase: { ...runtimeCase(), checks: [] } }, { runtimeCase: runtimeCase(), controlProgram: runtimeCase().program },
    { runtimeCase: runtimeCase(), headless: false }, { runtimeCase: runtimeCase(), smoke: false }, { runtimeCase: runtimeCase(), capture: true }]) {
    const result = await runProjectBuild({ buildDirectory: '/not/an/owned/build', ...options });
    assert.equal(result.ok, false); assert.match(result.diagnostics[0].code, /^runtime_case_/); assert.equal(result.sessionDirectory, undefined);
  }
});

test('unknown instances and plan 1 reject before tool identification or runtime allocation', async t => {
  for (const version of [1, 2]) {
    const h = await fixture(t, { version }); let identifies = 0;
    const base = registry().resolve(backendId), backendRegistry = createExecutionBackendRegistry([{ ...base, identify: async () => { identifies++; return { ...fakeTool }; } }]);
    await build(h, backendRegistry); const definition = runtimeCase(); if (version === 2) definition.checks[0].instanceId = unknown;
    const result = await runProjectBuild({ buildDirectory: h.output, backendRegistry, tool: fakeTool.executable, runtimeCase: definition });
    assert.equal(result.diagnostics[0].code, version === 1 ? 'runtime_case_unsupported' : 'runtime_case_target_missing');
    assert.equal(identifies, 1); await assert.rejects(fs.stat(path.join(h.output, 'sessions')), { code: 'ENOENT' });
  }
});

test('cancelled, timed out and thrown executions preserve actual prefix checks and mark missing samples unavailable', async t => {
  for (const outcome of ['cancelled', 'timeout', 'throw']) {
    const h = await fixture(t), backendRegistry = registry({ execute({ ready, sample, flush }) {
      ready(); sample(0); flush(); if (outcome === 'throw') throw new Error('private backend failure'); return phaseResult('run', outcome);
    } }); await build(h, backendRegistry);
    const result = await runProjectBuild({ buildDirectory: h.output, backendRegistry, tool: fakeTool.executable, runtimeCase: runtimeCase() });
    assert.equal(result.ok, false); assert.equal(result.status, outcome === 'throw' ? 'failed' : outcome);
    const evaluation = result.record.verification.evaluation;
    assert.equal(evaluation.status, 'incomplete'); assert.equal(evaluation.checks.length, 3);
    assert.equal(evaluation.checks[0].status, 'passed'); assert.equal(evaluation.unavailableChecks, 2);
    assert.equal(evaluation.checks[1].actual, null);
  }
});

test('invalid trace cannot become a successful verification or invent unavailable actors', async t => {
  const h = await fixture(t), backendRegistry = registry({ execute({ ready, sample, finished, flush }) {
    ready(); sample(0); sample(2); finished(); flush(); return phaseResult('run');
  } }); await build(h, backendRegistry);
  const result = await runProjectBuild({ buildDirectory: h.output, backendRegistry, tool: fakeTool.executable, runtimeCase: runtimeCase() });
  assert.equal(result.ok, false); assert.equal(result.record.verification.evaluation.status, 'incomplete');
  assert.equal(result.record.verification.evaluation.unavailableChecks, 2);
  assert.ok(result.record.diagnostics.some(item => item.code.startsWith('runtime_control_trace_')));
});
