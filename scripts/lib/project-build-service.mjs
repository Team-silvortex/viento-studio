import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createError } from '../../engine/service-error.mjs';
import { readWorldSnapshot } from '../adapters/node-world-projection.mjs';
import { captureBuildSnapshot, buildHash } from '../adapters/node-build-snapshot.mjs';
import { buildProject, runProjectBuild, projectBuildCacheRoot } from '../adapters/node-project-build.mjs';
import { GODOT4_BACKEND } from '../backends/godot4-dispatch.mjs';

const services = new Set();
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const fail = (code, message, status = 400) => createError(status, message, {}, code);
const clone = value => JSON.parse(JSON.stringify(value));
const terminal = new Set(['succeeded', 'failed', 'cancelled', 'timeout']);

export async function stopProjectBuildServices() {
  await Promise.all([...services].map(service => service.close()));
}

// This service owns jobs across HTTP requests. Only the host can select a tool
// or cache root; HTTP receives opaque IDs and never supplies executable paths.
export function createProjectBuildService(root, {
  enabled = process.platform === 'linux', godot = process.env.VIENTO_GODOT_BIN,
  cacheRoot = projectBuildCacheRoot(),
} = {}) {
  let closed = false, closePromise, job = null, active = null, latestBuild = null;
  let scenes = [], catalogAt = 0, catalogRead;
  const builds = new Map(), ownedOutputs = [];
  const namespace = path.join(cacheRoot, 'editor', buildHash(path.resolve(root)).slice(0, 24));

  async function toolState() {
    if (!enabled || process.platform !== 'linux') return { supported: false, available: false, reason: 'platform_unsupported' };
    if (!godot || !path.isAbsolute(godot)) return { supported: true, available: false, reason: 'tool_missing' };
    try {
      const stat = await fs.stat(godot); await fs.access(godot, constants.X_OK);
      return { supported: true, available: stat.isFile(), reason: stat.isFile() ? null : 'tool_missing' };
    } catch { return { supported: true, available: false, reason: 'tool_missing' }; }
  }

  async function readScenes() {
    if (Date.now() - catalogAt < 3000) return;
    if (!catalogRead) catalogRead = (async () => {
      const observed = await readWorldSnapshot(root);
      const result = [];
      for (const document of observed.source.documents) {
        if (!document.record?.id || !document.sourcePath.toLowerCase().endsWith('.json')) continue;
        let value;
        try { value = JSON.parse(document.content?.replace(/^\uFEFF/, '')); } catch { /* A previously selected broken scene remains diagnosable below. */ }
        if (value?.format !== 'viento-scene2d' && !scenes.some(scene => scene.id === document.record.id)) continue;
        result.push({ id: document.record.id, sourcePath: document.sourcePath,
          title: typeof value?.title === 'string' ? value.title.slice(0, 160) : path.basename(document.sourcePath) });
      }
      scenes = result; catalogAt = Date.now();
    })().finally(() => { catalogRead = null; });
    await catalogRead;
  }

  async function status({ refresh = false } = {}) {
    if (closed) throw fail('build_service_closed', 'Build service is closing.', 503);
    const tool = await toolState();
    if (refresh) catalogAt = 0;
    if (tool.supported) await readScenes();
    return { ...tool, backend: { id: GODOT4_BACKEND.id, version: GODOT4_BACKEND.version, label: 'Godot 4' },
      scenes: clone(scenes), job: clone(job), latestBuild: clone(latestBuild) };
  }

  function progress(event) {
    if (!job || !active || active.controller.signal.aborted) return;
    if (event.phase) job.phase = event.phase;
    if (event.output) job.logs = (job.logs + event.output.text).slice(-32768);
    if (event.event) {
      job.events.push(event.event); if (job.events.length > 128) job.events.shift();
    }
  }

  async function runJob(payload, controller) {
    try {
      let result;
      const sceneId = job.sceneId;
      if (payload.action === 'plan') {
        const captured = await captureBuildSnapshot(root, sceneId, { signal: controller.signal });
        result = { ok: captured.ok, status: captured.ok ? 'succeeded' : 'failed', diagnostics: captured.diagnostics };
        if (captured.ok) job.plan = { snapshotId: captured.snapshotId, title: captured.plan.scene.title,
          actorCount: captured.plan.actors.length, resourceCount: captured.plan.resources.length };
      } else if (payload.action === 'build') {
        const output = path.join(namespace, job.id);
        result = await buildProject({ root, scene: sceneId, godot, output, signal: controller.signal,
          expectedSnapshotId: payload.expectedSnapshotId, onProgress: progress });
        if (result.buildDirectory) ownedOutputs.push(result.buildDirectory);
        if (result.ok) {
          const entry = { id: result.record.buildId, sceneId, snapshotId: result.record.snapshotId,
            title: scenes.find(scene => scene.id === sceneId)?.title || sceneId };
          builds.set(entry.id, { ...entry, directory: result.buildDirectory }); latestBuild = entry; job.buildId = entry.id;
        }
        // Only prune directories created by this service instance. Builds from
        // earlier sessions or CLI runs remain untouched and are never adopted.
        while (ownedOutputs.length > 3) {
          const old = ownedOutputs.shift();
          for (const [id, entry] of builds) if (entry.directory === old) builds.delete(id);
          if (latestBuild && !builds.has(latestBuild.id)) latestBuild = null;
          await fs.rm(old, { recursive: true, force: true });
        }
      } else {
        const entry = builds.get(payload.buildId);
        result = await runProjectBuild({ buildDirectory: entry.directory, godot, signal: controller.signal,
          headless: payload.mode === 'headless', smoke: payload.mode === 'headless',
          timeoutMs: payload.mode === 'window' ? 300000 : 30000, onProgress: progress });
        job.buildId = entry.id;
      }
      job.status = controller.signal.aborted ? 'cancelled' : terminal.has(result.status) ? result.status : 'failed';
      job.diagnostics = (result.record?.diagnostics || result.diagnostics || []).slice(0, 256);
    } catch (error) {
      job.status = controller.signal.aborted ? 'cancelled' : 'failed';
      job.diagnostics = [{ severity: 'error', code: controller.signal.aborted ? 'build_cancelled' : error.errorCode || 'build_failed',
        message: controller.signal.aborted ? 'Build operation cancelled.' : 'Cannot complete this build operation.',
        objectId: job.sceneId, sourcePath: scenes.find(scene => scene.id === job.sceneId)?.sourcePath || '', propertyPath: '' }];
    } finally {
      job.phase = 'completed'; job.finishedAt = new Date().toISOString(); active = null;
    }
  }

  async function command(payload) {
    if (closed) throw fail('build_service_closed', 'Build service is closing.', 503);
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)
      || !['plan', 'build', 'run', 'cancel'].includes(payload.action)) throw fail('build_request_invalid', 'Invalid build action.');
    const allowed = { plan: ['action', 'sceneId'], build: ['action', 'sceneId', 'expectedSnapshotId'], run: ['action', 'buildId', 'mode'], cancel: ['action', 'jobId'] }[payload.action];
    if (Object.keys(payload).some(key => !allowed.includes(key))) throw fail('build_request_invalid', 'Unknown build request field.');
    if (payload.action === 'cancel') {
      if (!uuid(payload.jobId) || payload.jobId !== job?.id) throw fail('build_job_missing', 'Build task is not available.', 404);
      if (active) { job.phase = 'cancelling'; active.controller.abort(); }
      return status();
    }
    if (active) throw fail('build_busy', 'A build task is already active.', 409);
    const tool = await toolState();
    if (!tool.supported) throw fail('build_platform_unsupported', 'Project builds are not enabled on this host.', 403);
    if (payload.action !== 'plan' && !tool.available) throw fail('build_tool_required', 'Configure VIENTO_GODOT_BIN on the local host before building.', 422);
    if (payload.action === 'run') {
      if (!uuid(payload.buildId) || !builds.has(payload.buildId)) throw fail('build_artifact_missing', 'This build is no longer available; rebuild the scene.', 404);
      if (!['headless', 'window'].includes(payload.mode)) throw fail('build_request_invalid', 'Invalid runtime mode.');
    } else {
      if (!uuid(payload.sceneId) || payload.expectedSnapshotId !== undefined
        && (typeof payload.expectedSnapshotId !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(payload.expectedSnapshotId))) throw fail('build_request_invalid', 'Invalid scene or snapshot identity.');
      await readScenes();
      if (!scenes.some(scene => scene.id === payload.sceneId)) throw fail('build_scene_required', 'Select a registered Scene2D document.', 404);
    }
    // Recheck after await: simultaneous POSTs cannot both acquire the slot.
    if (closed) throw fail('build_service_closed', 'Build service is closing.', 503);
    if (active) throw fail('build_busy', 'A build task is already active.', 409);
    const controller = new AbortController();
    job = { id: randomUUID(), kind: payload.action, sceneId: payload.sceneId || builds.get(payload.buildId).sceneId,
      status: 'running', phase: payload.action === 'run' ? 'tool' : 'snapshot', createdAt: new Date().toISOString(),
      diagnostics: [], events: [], logs: '', plan: null };
    // Start on a microtask after registering the owner; normal HTTP completion
    // does not cancel this task. Reopening the panel resumes observing it.
    active = { controller, promise: null };
    active.promise = Promise.resolve().then(() => runJob(payload, controller));
    return status();
  }

  const service = { status, command, close() {
    if (closePromise) return closePromise;
    closed = true;
    if (active) { job.phase = 'cancelling'; active.controller.abort(); }
    closePromise = Promise.resolve(active?.promise).finally(() => { services.delete(service); });
    return closePromise;
  } };
  services.add(service);
  return service;
}
