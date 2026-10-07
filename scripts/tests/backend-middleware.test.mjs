import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { createExecutionBackendRegistry, validateGeneratedExecutionProject, executionPhaseDiagnostics } from '../adapters/node-execution-backends.mjs';
import { GODOT4_EXECUTION_ADAPTER } from '../backends/godot4-adapter.mjs';
import { buildProject, runProjectBuild } from '../adapters/node-project-build.mjs';
import { captureBuildSnapshot, buildHash } from '../adapters/node-build-snapshot.mjs';
import { createProjectBuildService } from '../lib/project-build-service.mjs';
import { runBuildProcess } from '../lib/build-process.mjs';

// This is an isolated executable contract fixture, never a registered product
// engine. Node drives it so an accidental Godot argument/filename fails visibly.
const backendId = 'org.viento.test-runtime';
const sceneId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const sha = '1'.repeat(64);
const descriptor = () => ({ ...structuredClone(GODOT4_EXECUTION_ADAPTER.descriptor), id: backendId, label: 'Contract fixture', version: '1.0.0',
  execution: { build: true, headlessLogic: true, windowPreview: false, windowCapture: false, offscreenRender: false, embeddedViewport: false, gpuCompute: false } });

function implementation(options = {}) {
  const calls = [], declaration = descriptor();
  const adapter = { descriptor: declaration, contractVersion: 1, acceptsLegacyBuildRecords: false, buildPhases: ['prepare'], runtimePhases: [],
    async availability({ enabled }) { calls.push('availability'); return { supported: enabled, available: enabled, reason: enabled ? null : 'platform_unsupported' }; },
    async identify(tool) { calls.push('identify'); assert.equal(tool, process.execPath); return { executable: tool, sha256: sha, version: process.version, platform: process.platform, arch: process.arch }; },
    async fingerprint() { return { id: backendId, contractVersion: 1, sha256: options.fingerprint || sha }; },
    async generate(plan) {
      calls.push('generate');
      const actor = plan.actors[0];
      const script = `if(process.argv.length!==2)throw Error('Engine-specific arguments leaked');console.log(JSON.stringify({event:'ready',objectId:${JSON.stringify(actor.objectId)}}));console.log(JSON.stringify({event:'finished'}));`;
      const generated = { files: new Map([['entry.mjs', Buffer.from(script)]]), resourceFiles: new Map(plan.resources.map(resource => [resource.id, `media/${resource.id}.bytes`])),
        sourceMap: { fixture: true }, backend: { id: backendId, version: '1.0.0', protocolVersion: plan.schemaVersion, sha256: sha },
        artifact: { kind: 'fixture-project', entry: 'entry.mjs', requiresTool: true } };
      return options.alter ? options.alter(generated) : generated;
    },
    async executePhase({ phase, tool, directory, signal, timeoutMs, onOutput }) {
      calls.push(phase);
      assert.ok(['prepare', 'run'].includes(phase));
      return runBuildProcess(tool.executable, phase === 'prepare' ? ['--check', 'entry.mjs'] : ['entry.mjs'], { cwd: directory, signal, timeoutMs, onOutput });
    },
    diagnostics(result) { return result.status === 'succeeded' ? [] : [{ severity: 'error', code: 'fixture_process_failed', message: result.status }]; },
    createEventReader(_plan, { onEvent }) {
      const events = [], diagnostics = []; let pending = '';
      const line = text => { if (!text) return; const event = JSON.parse(text); events.push(event); onEvent?.(event); };
      return { events, diagnostics, push(text) { pending += text; const lines = pending.split('\n'); pending = lines.pop(); lines.forEach(line); }, finish() { line(pending); pending = ''; } };
    },
    async cleanupProject() { calls.push('cleanup'); },
  };
  const registry = createExecutionBackendRegistry([adapter]);
  return { adapter, registry, calls, options };
}

async function fixture(t, options) {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-backend-contract-'));
  t.after(() => fs.rm(temporary, { recursive: true, force: true }));
  const root = path.join(temporary, 'source'); await fs.cp(new URL('../../examples/scene2d/', import.meta.url), root, { recursive: true });
  return { temporary, root, output: path.join(temporary, 'output'), ...implementation(options) };
}
async function inventory(root) {
  const entries = {};
  for (const entry of await fs.readdir(root, { recursive: true, withFileTypes: true })) if (entry.isFile()) {
    const file = path.join(entry.parentPath, entry.name); entries[path.relative(root, file)] = buildHash(await fs.readFile(file));
  }
  return entries;
}
const build = h => buildProject({ root: h.root, scene: sceneId, tool: process.execPath, backendId, backendRegistry: h.registry, output: h.output });
const run = (h, extra = {}) => runProjectBuild({ buildDirectory: h.output, tool: process.execPath, backendId, backendRegistry: h.registry, ...extra });
const absent = async directory => assert.rejects(fs.stat(directory), { code: 'ENOENT' });

test('host registry captures implementations once and only exposes detached transport data', () => {
  const h = implementation(), adapter = h.registry.resolve(backendId);
  h.adapter.identify = () => { throw new Error('later mutation'); }; h.adapter.descriptor.execution.headlessLogic = false;
  assert.equal(adapter.descriptor.execution.headlessLogic, true); assert.notEqual(adapter.identify, h.adapter.identify);
  assert.ok(Object.isFrozen(h.registry.descriptors()[0].execution));
  assert.throws(() => h.registry.resolve('org.viento.unregistered'), { errorCode: 'build_backend_missing' });
  assert.throws(() => createExecutionBackendRegistry([h.adapter, h.adapter]), { errorCode: 'build_backend_invalid' });
  for (const bad of [{ ...h.adapter, contractVersion: 2 }, { ...h.adapter, executePhase: undefined }, { ...h.adapter, runtimePhases: ['run'] }, { ...h.adapter, buildPhases: ['prepare', 'prepare'] }]) {
    assert.throws(() => createExecutionBackendRegistry([bad]), { errorCode: 'build_backend_invalid' });
  }
});

test('non-Godot adapter runs through production build and frozen runtime without engine-specific conventions', async t => {
  const h = await fixture(t), before = await inventory(h.root);
  const result = await build(h); assert.equal(result.ok, true); assert.equal(result.record.backend.id, backendId);
  assert.equal(result.record.artifact.entry, 'project/entry.mjs'); assert.equal(result.record.artifact.kind, 'fixture-project');
  assert.deepEqual(result.record.executionAdapter, { id: backendId, contractVersion: 1, sha256: sha });
  assert.deepEqual(result.record.phases.map(item => item.phase), ['prepare']);
  const session = await run(h); assert.equal(session.ok, true); assert.equal(session.record.mode, 'headless-logic');
  assert.deepEqual(session.record.events.map(event => event.event), ['ready', 'finished']);
  assert.equal(session.record.executionAdapter.id, backendId); await absent(path.join(session.sessionDirectory, 'project'));
  assert.deepEqual(await inventory(h.root), before);
  assert.deepEqual(h.calls.filter(item => ['prepare', 'run', 'cleanup'].includes(item)), ['prepare', 'cleanup', 'run']);
});

test('missing build capability or unsupported plan refuses before tool probes and output publication', async t => {
  for (const mutate of [value => { value.execution.build = false; }, value => { value.capabilities = []; }, value => { value.plans = []; }]) {
    const h = await fixture(t), declaration = descriptor(); mutate(declaration); h.adapter.descriptor = declaration;
    h.registry = createExecutionBackendRegistry([h.adapter]);
    const result = await build(h); assert.equal(result.ok, false); assert.equal(result.status, 'rejected');
    assert.ok(['build_execution_unsupported', 'build_capability_missing', 'build_backend_plan_unsupported'].includes(result.diagnostics[0].code));
    assert.ok(!h.calls.includes('identify')); await absent(h.output);
  }
});

test('unsupported runtime modes, foreign backend and changed adapter refuse before tool identification or session creation', async t => {
  const h = await fixture(t); assert.equal((await build(h)).ok, true);
  const baseline = h.calls.filter(item => item === 'identify').length;
  for (const [options, code] of [[{ headless: false }, 'build_execution_unsupported'], [{ capture: true, headless: false }, 'build_execution_unsupported'],
    [{ backendId: 'org.viento.other' }, 'runtime_backend_changed']]) {
    const result = await run(h, options); assert.equal(result.ok, false); assert.equal(result.diagnostics[0].code, code);
  }
  h.options.fingerprint = '2'.repeat(64); const changed = await run(h);
  assert.equal(changed.diagnostics[0].code, 'runtime_adapter_changed'); assert.equal(h.calls.filter(item => item === 'identify').length, baseline);
  await absent(path.join(h.output, 'sessions'));
});

test('new adapters require their execution fingerprint; stored entry/kind/tool declarations never redirect execution', async t => {
  const h = await fixture(t); assert.equal((await build(h)).ok, true);
  const file = path.join(h.output, 'build.json'), original = JSON.parse(await fs.readFile(file));
  const baseline = h.calls.filter(item => item === 'identify').length;
  for (const [mutate, code] of [[value => { delete value.executionAdapter; }, 'runtime_adapter_changed'],
    [value => { value.executionAdapter.contractVersion = 2; }, 'runtime_adapter_changed'],
    [value => { value.artifact.entry = '../outside'; }, 'runtime_artifact_changed'],
    [value => { value.artifact.kind = 'executable'; }, 'runtime_artifact_changed'],
    [value => { value.artifact.requiresTool = false; }, 'runtime_artifact_changed']]) {
    const value = structuredClone(original); mutate(value); await fs.writeFile(file, JSON.stringify(value));
    assert.equal((await run(h)).diagnostics[0].code, code);
  }
  assert.equal(h.calls.filter(item => item === 'identify').length, baseline); await absent(path.join(h.output, 'sessions'));
});

test('malformed generated file/resource maps are refused before any output is created', async t => {
  for (const alter of [
    value => ({ ...value, files: new Map([['../outside', Buffer.from('x')]]) }),
    value => ({ ...value, files: new Map([['/absolute', Buffer.from('x')]]) }),
    value => ({ ...value, files: new Map([['a\\outside', Buffer.from('x')]]) }),
    value => ({ ...value, files: new Map([['entry.mjs', Buffer.from('x')], ['entry.mjs/child', Buffer.from('x')]]) }),
    value => ({ ...value, resourceFiles: new Map([...value.resourceFiles.keys()].map(id => [id, 'entry.mjs'])) }),
    value => ({ ...value, artifact: { ...value.artifact, entry: 'missing.mjs' } }),
  ]) {
    const h = await fixture(t, { alter }), before = await inventory(h.root);
    const result = await build(h); assert.equal(result.ok, false); assert.equal(result.diagnostics[0].code, 'build_backend_invalid');
    assert.ok(!h.calls.includes('prepare')); await absent(h.output); assert.deepEqual(await inventory(h.root), before);
  }
});

test('validated generated buffers, maps and metadata are detached before asynchronous publication', async t => {
  const h = await fixture(t), captured = await captureBuildSnapshot(h.root, sceneId), raw = await h.adapter.generate(captured.plan);
  const value = validateGeneratedExecutionProject(h.registry.resolve(backendId), captured.plan, raw), before = Buffer.from(value.files.get('entry.mjs'));
  raw.files.get('entry.mjs').fill(0); raw.resourceFiles.clear(); raw.sourceMap.fixture = false;
  assert.ok(value.files.get('entry.mjs').equals(before)); assert.equal(value.resourceFiles.size, 1); assert.equal(value.sourceMap.fixture, true);
  assert.ok(Object.isFrozen(value.sourceMap));
});

test('generic phase failure cannot become success when a backend omits failure diagnostics', () => {
  const plan = { scene: { objectId: sceneId, sourcePath: 'documents/scenes/demo.json' } };
  const adapter = { diagnostics: () => [] };
  for (const status of ['failed', 'cancelled', 'timeout', 'unavailable', 'output-limit', 'observer-failed']) {
    const diagnostics = executionPhaseDiagnostics(adapter, { status }, plan);
    assert.equal(diagnostics.length, 1); assert.equal(diagnostics[0].severity, 'error'); assert.equal(diagnostics[0].objectId, sceneId);
  }
  for (const result of [{}, { status: 'unknown' }, { status: 'succeeded', exitCode: 7 }]) {
    assert.throws(() => executionPhaseDiagnostics(adapter, result, plan), { errorCode: 'build_backend_invalid' });
  }
});

test('editor service publishes capabilities and drives the host-selected adapter while rejecting execution options from transport', async t => {
  const h = await fixture(t), before = await inventory(h.root);
  const service = createProjectBuildService(h.root, { enabled: true, tool: process.execPath, backendId, backendRegistry: h.registry, cacheRoot: path.join(h.temporary, 'cache') });
  t.after(() => service.close());
  const settle = async () => { for (let i = 0; i < 300; i++) { const value = await service.status(); if (value.job?.status !== 'running') return value; await delay(10); } assert.fail('fixture job stalled'); };
  const initial = await service.status(); assert.equal(initial.backend.format, 'viento-execution-backend'); assert.equal(initial.backend.execution.windowPreview, false);
  initial.backend.execution.headlessLogic = false; assert.equal((await service.status()).backend.execution.headlessLogic, true);
  for (const extra of [{ backendId }, { tool: process.execPath }, { executable: process.execPath }, { adapter: 'code' }, { output: h.output }]) {
    await assert.rejects(service.command({ action: 'plan', sceneId, ...extra }), { errorCode: 'build_request_invalid' });
  }
  await service.command({ action: 'plan', sceneId }); const planned = await settle(); assert.equal(planned.job.status, 'succeeded');
  await service.command({ action: 'build', sceneId, expectedSnapshotId: planned.job.plan.snapshotId }); const built = await settle();
  assert.equal(built.job.status, 'succeeded'); assert.equal(built.latestBuild.backendId, backendId);
  await assert.rejects(service.command({ action: 'run', buildId: built.latestBuild.id, mode: 'window' }), { errorCode: 'build_execution_unsupported', statusCode: 422 });
  await service.command({ action: 'run', buildId: built.latestBuild.id, mode: 'headless' });
  assert.equal((await settle()).job.status, 'succeeded'); assert.deepEqual(await inventory(h.root), before);
});

test('historical Godot build records without the new execution fingerprint still run with unchanged generated bytes', {
  skip: !process.env.VIENTO_GODOT_BIN && 'Set VIENTO_GODOT_BIN for actual historical Godot compatibility.',
}, async t => {
  const h = await fixture(t), before = await inventory(h.root), godot = process.env.VIENTO_GODOT_BIN;
  const built = await buildProject({ root: h.root, scene: sceneId, godot, output: h.output });
  assert.equal(built.ok, true); assert.equal(built.record.backend.sha256, 'dba885d7965715e56b1f1ac394dc78e3227d3502d23318a736dca6eb93beabe6');
  const oldRecord = structuredClone(built.record); delete oldRecord.executionAdapter;
  await fs.writeFile(path.join(h.output, 'build.json'), JSON.stringify(oldRecord));
  const session = await runProjectBuild({ buildDirectory: h.output, godot });
  assert.equal(session.ok, true); assert.equal(session.record.backendId, 'org.viento.godot4');
  assert.ok(session.record.events.some(event => event.event === 'finished'));
  assert.deepEqual(await inventory(h.root), before);
});
