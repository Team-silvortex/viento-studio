import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { createProjectBuildService } from '../lib/project-build-service.mjs';
import { createExecutionBackendRegistry } from '../adapters/node-execution-backends.mjs';
import { GODOT4_EXECUTION_ADAPTER } from '../backends/godot4-adapter.mjs';
import { buildHash } from '../adapters/node-build-snapshot.mjs';
import { createBackendProjectCatalog, BACKEND_PROJECT_CATALOG_FILE } from '../adapters/node-backend-project-catalog.mjs';

const sceneId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
async function fixture(t) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-project-delivery-service-'));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const root = path.join(base, 'author'), cacheRoot = path.join(base, 'cache');
  await fs.cp(new URL('../../examples/scene2d/', import.meta.url), root, { recursive: true });
  let identities = 0, generations = 0;
  // Real frozen generation/inspection and IO, bounded phase fixture only.
  // This test does not certify an engine import or runtime execution.
  const backendRegistry = createExecutionBackendRegistry([{ ...GODOT4_EXECUTION_ADAPTER,
    async generate(plan) { generations++; return GODOT4_EXECUTION_ADAPTER.generate(plan); },
    async identify(executable) { identities++; return { executable, version: '4.7.2.stable.fixture',
      sha256: buildHash('catalog phase fixture'), platform: process.platform, arch: process.arch }; },
    async executePhase() { return { status: 'succeeded', exitCode: 0, stdout: '', stderr: '' }; },
  }]);
  let service;
  const restart = async (tool = process.execPath) => {
    await service?.close(); service = createProjectBuildService(root, { cacheRoot, backendRegistry, tool, deliveryEnabled: true });
    t.after(() => service.close()); return service;
  };
  await restart();
  const build = async () => {
    await service.command({ action: 'build', sceneId });
    for (let i = 0; i < 1000; i++) {
      const state = await service.status();
      if (state.job?.status !== 'running') { assert.equal(state.job.status, 'succeeded', JSON.stringify(state)); return state; }
      await delay(5);
    }
    assert.fail('Build did not settle.');
  };
  return { base, root, cacheRoot, restart, build, get service() { return service; },
    counts: () => ({ identities, generations }) };
}


import { createExportService } from '../lib/export-service.mjs';
import { verifyBackendProjectDelivery } from '../adapters/node-backend-project-delivery.mjs';
async function reviewed(h) {
  const state = await h.build();
  const inspection = await h.service.command({ action: 'inspect-project', buildId: state.latestBuild.id });
  return { inspection, request: { kind: 'backend-project', buildId: state.latestBuild.id,
    expectedSnapshotId: inspection.project.snapshotId, expectedManifestSha256: inspection.inspection.manifestSha256 } };
}
const exporter = h => createExportService(h.root, { planBackendProjectDelivery: (request, signal) => h.service.deliveryPlan(request, signal) });

test('delivery service: build, review, export, independent verification and release leave author sources intact', async t => {
  const h = await fixture(t), { request, inspection } = await reviewed(h), exports = exporter(h);
  const author = await fs.readFile(path.join(h.root, 'documents/scenes/demo.json'));
  const count = h.counts().identities;
  assert.equal((await h.service.status()).projectManagement.delivery, 'viento-build-delivery-v1');
  const receipt = await exports.create(request); t.after(() => exports.release(receipt.id));
  assert.equal(receipt.delivery.project.buildId, request.buildId);
  assert.equal(receipt.delivery.manifestSha256, request.expectedManifestSha256);
  const verified = await verifyBackendProjectDelivery(exports.get(receipt.id).file);
  assert.equal(verified.fileCount, inspection.project.files.length + 1);
  assert.equal(h.counts().identities, count, 'delivery never invokes a tool');
  assert.deepEqual(await fs.readFile(path.join(h.root, 'documents/scenes/demo.json')), author);
  const file = exports.get(receipt.id).file;
  await exports.release(receipt.id); await assert.rejects(fs.stat(file), {code:'ENOENT'});
});

test('delivery service: review mismatch, arbitrary path, unknown build and disabled capability cannot authorize export', async t => {
  const h = await fixture(t), { request } = await reviewed(h), exports = exporter(h);
  for (const payload of [{...request, expectedManifestSha256: '0'.repeat(64)}, {...request, expectedSnapshotId:'sha256:'+'0'.repeat(64)}]) {
    await assert.rejects(exports.create(payload), {errorCode:'backend_project_delivery_changed'});
  }
  await assert.rejects(exports.create({...request, directory:h.root}), {errorCode:'build_request_invalid'});
  await assert.rejects(exports.create({...request, buildId:randomUUID()}), {errorCode:'build_artifact_missing'});
  const disabled = createProjectBuildService(h.root, {enabled:false, cacheRoot:h.cacheRoot, deliveryEnabled:true});
  t.after(() => disabled.close());
  await assert.rejects(disabled.deliveryPlan(request), {errorCode:'backend_project_delivery_unavailable'});
  await assert.rejects(createExportService(h.root).create(request));
  const retry = await exports.create(request); await exports.release(retry.id);
});

test('delivery service: ZIP preparation owns the task slot until disposed, preventing concurrent retention', async t => {
  const h = await fixture(t), { request, inspection } = await reviewed(h);
  const plan = await h.service.deliveryPlan(request); t.after(() => plan.dispose());
  for (const payload of [{action:'build',sceneId},{action:'plan',sceneId},{action:'tool-check'}, {action:'select-project',buildId:request.buildId}]) {
    await assert.rejects(h.service.command(payload), {errorCode:'build_busy'});
  }
  await assert.rejects(h.service.deliveryPlan(request), {errorCode:'build_busy'});
  await plan.validateSnapshot(plan.signal);
  assert.ok(await fs.stat(inspection.buildDirectory));
  await plan.dispose(); await plan.dispose();
  assert.equal((await h.build()).job.status, 'succeeded');
});

test('delivery service: close aborts an admitted writer and waits for its lease release', async t => {
  const h = await fixture(t), {request} = await reviewed(h);
  const plan = await h.service.deliveryPlan(request);
  let settled = false; const closing = h.service.close().then(() => {settled = true;});
  assert.equal(plan.signal.aborted, true); await delay(10); assert.equal(settled, false);
  await assert.rejects(plan.validateSnapshot(plan.signal));
  await plan.dispose(); await closing; assert.equal(settled,true);
});

test('delivery service: workspace replacement or registered file mutation between review and export is rejected', async t => {
  const h = await fixture(t), {request,inspection} = await reviewed(h), exports=exporter(h);
  const workspacePath = path.join(h.root,'workspace.json'), before=await fs.readFile(workspacePath);
  const value=JSON.parse(before); value.id=randomUUID(); await fs.writeFile(workspacePath,JSON.stringify(value));
  await assert.rejects(exports.create(request), {errorCode:'backend_project_workspace_changed'});
  await fs.writeFile(workspacePath,before);
  const file=inspection.project.files[0]; await fs.appendFile(path.join(inspection.buildDirectory,file.path),'changed');
  await assert.rejects(exports.create(request), {errorCode:'backend_project_changed'});
});

test('delivery service: cancellation during preparation releases task slot and creates no downloadable job', async t => {
  const h=await fixture(t), {request}=await reviewed(h), controller=new AbortController();
  const exports=createExportService(h.root,{planBackendProjectDelivery:async(payload,signal)=>{
    const plan=await h.service.deliveryPlan(payload,signal); controller.abort(); return plan;
  }});
  await assert.rejects(exports.create(request,controller.signal));
  const again=await h.service.deliveryPlan(request); await again.dispose();
});

test('delivery service: writer failure releases slot and removes partial package', async t => {
  const h=await fixture(t), {request}=await reviewed(h);
  const exports=createExportService(h.root,{planBackendProjectDelivery:async(payload,signal)=>{
    const plan=await h.service.deliveryPlan(payload,signal);
    return {...plan,validateSnapshot:async()=>{throw new Error('verification failure fixture');}};
  }});
  await assert.rejects(exports.create(request), /verification failure fixture/);
  const cache=path.join(h.root,'.viento/cache/exports'); assert.deepEqual(await fs.readdir(cache),[]);
  const again=await h.service.deliveryPlan(request); await again.dispose();
});
