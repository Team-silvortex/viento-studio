import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createServer } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { scenePhysics2DInputInstancesAuthor, physicsInstanceReplay, physicsInstanceCase } from './helpers/scene-physics2d-input-instances-author-fixture.mjs';
import { createProjectBuildService } from '../lib/project-build-service.mjs';
import { handleApiRequest } from '../lib/doc-server-routes.mjs';
import { runProjectBuild } from '../adapters/node-project-build.mjs';
import { createExecutionBackendRegistry } from '../adapters/node-execution-backends.mjs';
import { GODOT4_EXECUTION_ADAPTER as godot } from '../backends/godot4-adapter.mjs';
import { buildHash } from '../adapters/node-build-snapshot.mjs';
import { inventory } from './runtime-case-fixture.mjs';

const capability = 'physics.input-replay-instances2d';
const unknown = '74747474-7474-4474-8474-000000000999';
const tool = { executable: process.execPath, version: 'controlled-host-boundary', sha256: buildHash('physics instance admission fixture'),
  platform: process.platform, arch: process.arch };
async function settled(service) {
  for (let attempt = 0; attempt < 3000; attempt++) {
    const result = await service.status(); if (result.job?.status !== 'running') return result;
    await delay(5);
  }
  assert.fail('Controlled build did not settle.');
}
async function fixture(t, enabled = true) {
  const f = await scenePhysics2DInputInstancesAuthor(t), phases = [];
  const descriptor = { ...godot.descriptor, capabilities: [...new Set([
    ...godot.descriptor.capabilities.filter(value => value !== capability), ...(enabled ? [capability] : []),
  ])] };
  // Actual author capture, generation, frozen records, HTTP and host admission;
  // phase execution is injected. This never starts or certifies native Godot.
  const registry = createExecutionBackendRegistry([{ ...godot, descriptor,
    availability: async () => ({ supported: true, available: true, reason: null }),
    identify: async () => ({ ...tool }),
    async generate(plan) {
      const generated = await godot.generate(plan);
      if (!enabled) generated.backend = { ...generated.backend, capabilities: generated.backend.capabilities.filter(value => value !== capability) };
      return generated;
    },
    async executePhase({ phase }) {
      phases.push(phase);
      return { phase, status: phase === 'run' ? 'failed' : 'succeeded', exitCode: phase === 'run' ? 1 : 0,
        stdout: '', stderr: phase === 'run' ? 'Controlled host fixture; no native process was executed.' : '' };
    },
  }]);
  const cacheRoot = path.join(f.temporary, 'controlled-instance-cache');
  const service = createProjectBuildService(f.author, { tool: tool.executable, cacheRoot, backendRegistry: registry });
  t.after(() => service.close());
  await service.command({ action: 'build', targetId: f.assemblyId });
  const built = await settled(service);
  assert.equal(built.job.status, 'succeeded', JSON.stringify(built.job.diagnostics));
  const detail = await service.command({ action: 'inspect-project', buildId: built.latestBuild.id });
  return { ...f, phases, registry, service, built, buildDirectory: detail.buildDirectory };
}
async function http(t, projectBuild) {
  const server = createServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url, `http://${request.headers.host}`);
      if (!await handleApiRequest({ pathname: requestUrl.pathname, request, response, requestUrl, service: { projectBuild } })) {
        response.statusCode = 404; response.end();
      }
    } catch (error) { response.statusCode = 500; response.end(JSON.stringify({ error: error.message })); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const base = `http://127.0.0.1:${server.address().port}/api/project-build`;
  return async payload => {
    const response = await fetch(base, { method: payload === undefined ? 'GET' : 'POST',
      headers: { Connection: 'close', ...(payload === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) }) });
    const body = await response.json(); return { status: response.status, data: body.data || body };
  };
}

test('HTTP and direct Node host reject v2 targets outside the frozen controlled physical directory before jobs or session directories', async t => {
  const f = await fixture(t), request = await http(t, f.service), build = f.built.latestBuild;
  assert.equal(build.physicsReplayAvailable, true); assert.equal(build.physicsReplayInstancesAvailable, true);
  assert.deepEqual(build.physicsReplayTargets.map(({ instanceId }) => instanceId), [f.instanceId, f.secondInstanceId]);
  assert.equal(build.physicsReplayTargets[0].objectId, build.physicsReplayTargets[1].objectId, 'same OC has distinct instance inputs');
  assert.deepEqual(build.physicsReplayTargets.map(({ bodyId }) => bodyId), [f.physics.bodies[0].id, f.secondBodyId]);
  build.physicsReplayTargets[0].instanceId = unknown;
  assert.equal((await request()).data.latestBuild.physicsReplayTargets[0].instanceId, f.instanceId, 'public snapshots cannot mutate host eligibility');
  const beforeAuthor = await inventory(f.author), beforeBuild = await inventory(f.buildDirectory), beforePhases = [...f.phases];
  const targets = [unknown, f.sensorInstanceId, f.wallInstanceId, f.nonphysicalInstanceId, f.noneInstanceId];
  for (const instanceId of targets) {
    const program = physicsInstanceReplay(instanceId), embedded = physicsInstanceCase(f.instanceId);
    embedded.program = program;
    for (const payload of [{ physicsControlProgram: program }, { physicsReplayCase: embedded }]) {
      const response = await request({ action: 'run', buildId: build.id, mode: 'headless', ...payload });
      assert.equal(response.status, 422, JSON.stringify(response));
      assert.equal(response.data.errorCode, 'runtime_physics2d_input_target_invalid');
      assert.equal((await request()).data.job.id, f.built.job.id);
      const result = await runProjectBuild({ buildDirectory: f.buildDirectory, tool: tool.executable, backendRegistry: f.registry, ...payload });
      assert.equal(result.ok, false); assert.equal(result.sessionDirectory, undefined);
      assert.equal(result.diagnostics[0].code, 'runtime_physics2d_input_target_invalid');
    }
  }
  assert.deepEqual(f.phases, beforePhases, 'invalid requests never execute an import or run phase');
  await assert.rejects(fs.stat(path.join(f.buildDirectory, 'sessions')), { code: 'ENOENT' });
  assert.deepEqual(await inventory(f.author), beforeAuthor); assert.deepEqual(await inventory(f.buildDirectory), beforeBuild);
});

test('missing per-instance capability rejects v2 in HTTP and direct host while retaining legacy replay discovery', async t => {
  const f = await fixture(t, false), request = await http(t, f.service), build = f.built.latestBuild;
  assert.equal(build.physicsReplayAvailable, true); assert.equal(build.physicsReplayInstancesAvailable, false);
  assert.equal(build.physicsReplayTargets, undefined);
  const before = await inventory(f.buildDirectory), phases = [...f.phases];
  for (const payload of [{ physicsControlProgram: physicsInstanceReplay(f.instanceId) }, { physicsReplayCase: physicsInstanceCase(f.instanceId) }]) {
    const response = await request({ action: 'run', buildId: build.id, mode: 'headless', ...payload });
    assert.equal(response.status, 422); assert.equal(response.data.errorCode, 'runtime_physics2d_input_unsupported');
    assert.equal((await request()).data.job.id, f.built.job.id);
    const result = await runProjectBuild({ buildDirectory: f.buildDirectory, tool: tool.executable, backendRegistry: f.registry, ...payload });
    assert.equal(result.ok, false); assert.equal(result.sessionDirectory, undefined);
    assert.equal(result.diagnostics[0].code, 'runtime_physics2d_input_unsupported');
  }
  assert.deepEqual(f.phases, phases);
  await assert.rejects(fs.stat(path.join(f.buildDirectory, 'sessions')), { code: 'ENOENT' });
  assert.deepEqual(await inventory(f.buildDirectory), before);
});

test('v2 host eligibility remains bound to the frozen instance directory after the author scene changes', async t => {
  const f = await fixture(t), original = f.built.latestBuild.physicsReplayTargets[0].instanceId;
  await f.edit('documents/scenes/demo.json', scene => { scene.actors[0].instanceId = unknown; scene.actors[0].controls = 'none'; });
  const before = await inventory(f.author);
  const visible = (await f.service.status()).latestBuild;
  assert.equal(visible.physicsReplayTargets[0].instanceId, original);
  await assert.rejects(f.service.command({ action: 'run', buildId: visible.id, mode: 'headless', physicsControlProgram: physicsInstanceReplay(unknown) }),
    { errorCode: 'runtime_physics2d_input_target_invalid' });
  const accepted = await f.service.command({ action: 'run', buildId: visible.id, mode: 'headless', physicsControlProgram: physicsInstanceReplay(original) });
  assert.notEqual(accepted.job.id, f.built.job.id, 'frozen target passed admission despite author edits');
  const ended = (await settled(f.service)).job;
  assert.equal(ended.status, 'failed', 'injected phase intentionally supplies no native execution evidence');
  assert.equal(ended.physicsControl.complete, false);
  assert.ok(f.phases.includes('run'));
  assert.deepEqual(await inventory(f.author), before);
});
