import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { fixture, service, builtService, settled, runtimeCase, unknown, registry, phaseResult, gate } from './runtime-case-fixture.mjs';

test('service detaches a case before candidate reads and preserves the author draft-independent frozen build', async t => {
  const h = await fixture(t), value = service(t, h), built = await builtService(value), definition = runtimeCase(), expected = runtimeCase();
  const pending = value.command({ action: 'run', buildId: built.latestBuild.id, mode: 'headless', runtimeCase: definition });
  definition.checks[0].instanceId = unknown; definition.program.steps.length = 0;
  await pending; const state = await settled(value);
  assert.equal(state.job.status, 'succeeded'); assert.equal(state.job.verification.evaluation.status, 'passed');
  assert.deepEqual(state.job.verification.definition, expected); assert.equal(state.job.control.samples.length, 4);
  assert.deepEqual(state.latestBuild, built.latestBuild);
  state.job.verification.definition.checks[0].position.value[0] = -999;
  assert.deepEqual((await value.status()).job.verification.definition, expected);
});

test('failed expectations remain succeeded execution jobs with explicit failed verification', async t => {
  const h = await fixture(t), value = service(t, h), built = await builtService(value), definition = runtimeCase();
  definition.checks[1].state = 'moving';
  await value.command({ action: 'run', buildId: built.latestBuild.id, mode: 'headless', runtimeCase: definition });
  const state = await settled(value); assert.equal(state.job.status, 'succeeded'); assert.equal(state.job.verification.evaluation.status, 'failed');
  assert.equal(state.job.verification.evaluation.failedChecks, 1); assert.equal(state.job.diagnostics.length, 0);
  const view = await value.command({ action: 'inspect', jobId: state.job.id }); assert.equal(view.actors.length, 2);
});

test('mode, mutual exclusion, foreign identities and limits reject without allocating or replacing a job', async t => {
  const h = await fixture(t), value = service(t, h), built = await builtService(value);
  const foreign = runtimeCase(); foreign.checks[0].instanceId = unknown;
  const large = runtimeCase(); large.checks = Array.from({ length: 129 }, () => runtimeCase().checks[0]);
  const base = { action: 'run', buildId: built.latestBuild.id, mode: 'headless', runtimeCase: runtimeCase() };
  for (const [patch, code] of [[{ mode: 'window' }, 'runtime_case_unsupported'], [{ controlProgram: runtimeCase().program }, 'runtime_case_invalid'],
    [{ runtimeCase: foreign }, 'runtime_case_target_missing'], [{ runtimeCase: large }, 'runtime_case_limit'],
    [{ runtimeCase: null }, 'runtime_case_invalid'], [{ sceneId: 'not-allowed' }, 'build_request_invalid']]) {
    await assert.rejects(value.command({ ...base, ...patch }), error => error.errorCode === code);
    const state = await value.status(); assert.equal(state.job.id, built.job.id); assert.deepEqual(state.latestBuild, built.latestBuild);
  }
});

test('plan 1 and missing instance capability fail case admission without replacing the owned build job', async t => {
  for (const version of [1, 2]) {
    const h = await fixture(t, { version }), value = service(t, h, { backendRegistry: registry({ instanceCapability: false }) }), built = await builtService(value);
    await assert.rejects(value.command({ action: 'run', buildId: built.latestBuild.id, mode: 'headless', runtimeCase: runtimeCase() }),
      error => error.errorCode === 'runtime_case_unsupported');
    assert.equal((await value.status()).job.id, built.job.id);
  }
});

test('source-offline owned verification runs and tool checks preserve bounded result status while new builds remain blocked', async t => {
  const h = await fixture(t), value = service(t, h), built = await builtService(value);
  await fs.rename(h.root, h.root + '-offline');
  const offline = await value.status({ refresh: true }); assert.equal(offline.catalogDiagnostic.code, 'build_catalog_unavailable');
  await value.command({ action: 'run', buildId: built.latestBuild.id, mode: 'headless', runtimeCase: runtimeCase() });
  const state = await settled(value); assert.equal(state.job.verification.evaluation.status, 'passed');
  const checked = await value.command({ action: 'tool-check' });
  assert.equal(checked.toolStatus.status, 'ready'); assert.deepEqual(checked.job.verification, state.job.verification);
  await assert.rejects(value.command({ action: 'plan', sceneId: built.latestBuild.sceneId }), error => error.errorCode === 'world_unavailable');
  await fs.rename(h.root + '-offline', h.root); assert.equal((await value.status({ refresh: true })).catalogDiagnostic, null);
});

test('cancelling a case retains incomplete checks and exclusive ownership until execution is reaped', async t => {
  const h = await fixture(t), started = gate(), finished = gate();
  const value = service(t, h, { backendRegistry: registry({ async execute(context) {
    context.ready(); context.sample(0); context.flush(); started.resolve();
    await new Promise(resolve => { if (context.signal.aborted) resolve(); else context.signal.addEventListener('abort', resolve, { once: true }); });
    await finished.promise; return phaseResult('run', 'cancelled');
  } }) }); const built = await builtService(value);
  await value.command({ action: 'run', buildId: built.latestBuild.id, mode: 'headless', runtimeCase: runtimeCase() }); await started.promise;
  const running = await value.status(); assert.equal(running.job.verification.evaluation.status, 'incomplete');
  await assert.rejects(value.command({ action: 'tool-check' }), error => error.errorCode === 'build_busy');
  await value.command({ action: 'cancel', jobId: running.job.id });
  assert.equal((await value.status()).job.status, 'running'); finished.resolve();
  const state = await settled(value); assert.equal(state.job.status, 'cancelled'); assert.equal(state.job.verification.evaluation.status, 'incomplete');
  assert.equal(state.job.verification.evaluation.unavailableChecks, 2); assert.equal(state.job.verification.evaluation.checks[0].status, 'passed');
});
