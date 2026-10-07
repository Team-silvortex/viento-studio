import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createError } from '../../engine/service-error.mjs';
import { readWorldSnapshot } from '../adapters/node-world-projection.mjs';
import { captureBuildSnapshot, buildHash, readBuildFile } from '../adapters/node-build-snapshot.mjs';
import { buildProject, runProjectBuild, projectBuildCacheRoot } from '../adapters/node-project-build.mjs';
import { checkExecutionBackendSupport } from '../../engine/backend-capabilities.mjs';
import { DEFAULT_EXECUTION_BACKEND, createExecutionBackendRegistry } from '../adapters/node-execution-backends.mjs';
import { inspectSceneComposition } from '../../engine/scene-composition-document.mjs';
import { querySceneRuntimeObservation } from '../../engine/scene-runtime-query.mjs';
import { validateSceneControlProgram, validateSceneControlPlan } from '../../engine/scene-control-program.mjs';
import { canonicalJson } from '../../engine/canonical-json.mjs';

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
  tool = godot, backendId = DEFAULT_EXECUTION_BACKEND, backendRegistry = createExecutionBackendRegistry(), cacheRoot = projectBuildCacheRoot(),
} = {}) {
  const adapter = backendRegistry.resolve(backendId);
  let closed = false, closePromise, job = null, active = null, latestBuild = null;
  let scenes = [], previewDocuments = [], catalogAt = 0, catalogRead;
  const builds = new Map(), ownedOutputs = [];
  const namespace = path.join(cacheRoot, 'editor', buildHash(path.resolve(root)).slice(0, 24));

  async function toolState() {
    return adapter.availability({ toolPath: tool, enabled, platform: process.platform });
  }

  async function readScenes() {
    if (Date.now() - catalogAt < 3000) return;
    if (!catalogRead) catalogRead = (async () => {
      const observed = await readWorldSnapshot(root);
      const result = [], previews = [];
      for (const document of observed.source.documents) {
        if (!document.record?.id || !document.sourcePath.toLowerCase().endsWith('.json')) continue;
        let value, parsed = false;
        try { value = JSON.parse(document.content?.replace(/^\uFEFF/, '')); parsed = true; } catch { /* Keep a known broken declaration diagnosable below. */ }
        const composition = inspectSceneComposition(document.content);
        if (composition.recognized || !parsed && previewDocuments.some(item => item.id === document.record.id && item.kind === 'composition')) {
          previews.push({ id: document.record.id, sourcePath: document.sourcePath, kind: 'composition',
            title: typeof value?.scene?.title === 'string' ? value.scene.title.slice(0, 160) : path.basename(document.sourcePath) });
          continue;
        }
        if (value?.format !== 'viento-scene2d' && !scenes.some(scene => scene.id === document.record.id)) continue;
        const scene = { id: document.record.id, sourcePath: document.sourcePath,
          title: typeof value?.title === 'string' ? value.title.slice(0, 160) : path.basename(document.sourcePath) };
        result.push(scene); previews.push({ ...scene, kind: 'scene' });
      }
      scenes = result; previewDocuments = previews; catalogAt = Date.now();
    })().finally(() => { catalogRead = null; });
    await catalogRead;
  }

  async function status({ refresh = false } = {}) {
    if (closed) throw fail('build_service_closed', 'Build service is closing.', 503);
    const tool = await toolState();
    if (refresh) catalogAt = 0;
    if (tool.supported) await readScenes();
    return { ...tool, platform: process.platform, backend: clone(adapter.descriptor),
      scenes: clone(scenes), previewDocuments: clone(previewDocuments), job: clone(job), latestBuild: clone(latestBuild) };
  }

  function progress(event) {
    if (!job || !active) return;
    // Keep the admitted object view independently of the bounded raw-event
    // ring, including frames observed while cancellation terminates the tool.
    if (event.runtime) job.runtime = clone(event.runtime);
    if (event.controlSample && job.control && job.control.samples.length < job.control.program.steps.length) {
      job.control.samples.push(clone(event.controlSample));
    }
    if (active.controller.signal.aborted) return;
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
        const diagnostics = captured.ok ? checkExecutionBackendSupport(adapter.descriptor, { operation: 'build', platform: process.platform, plan: captured.plan }) : captured.diagnostics;
        result = { ok: !diagnostics.length, status: diagnostics.length ? 'failed' : 'succeeded', diagnostics };
        if (result.ok) job.plan = { snapshotId: captured.snapshotId, title: captured.plan.scene.title,
          actorCount: captured.plan.actors.length, resourceCount: captured.plan.resources.length,
          ...(captured.plan.behaviors ? { behaviorBindingCount: captured.plan.behaviors.bindings.length,
            behaviorSourceCount: captured.plan.behaviors.sources.length } : {}) };
      } else if (payload.action === 'build') {
        const output = path.join(namespace, job.id);
        result = await buildProject({ root, scene: sceneId, tool, backendId, backendRegistry, output, signal: controller.signal,
          expectedSnapshotId: payload.expectedSnapshotId, onProgress: progress });
        if (result.buildDirectory) ownedOutputs.push(result.buildDirectory);
        if (result.ok) {
          const entry = { id: result.record.buildId, sceneId, backendId, snapshotId: result.record.snapshotId,
            title: scenes.find(scene => scene.id === sceneId)?.title || sceneId };
          const frozenPlan = JSON.parse(await readBuildFile(path.join(result.buildDirectory, 'snapshot.json'), 80 * 1024 * 1024, controller.signal)).plan;
          entry.planSchemaVersion = frozenPlan.schemaVersion; entry.actorCount = frozenPlan.actors.length;
          // Targets and admission facts belong to this successful frozen build,
          // never a later author edit or an HTTP-supplied engine identity.
          const controlPlan = { format: frozenPlan.format, kind: frozenPlan.kind, schemaVersion: frozenPlan.schemaVersion,
            scene: { objectId: frozenPlan.scene.objectId, sourcePath: frozenPlan.scene.sourcePath },
            actors: frozenPlan.actors.map(actor => ({ objectId: actor.objectId, ...(actor.instanceId ? { instanceId: actor.instanceId } : {}) })) };
          if (frozenPlan.schemaVersion === 2 && adapter.descriptor.capabilities.includes('runtime.control-replay.instances')) {
            entry.controlTargets = frozenPlan.actors.map(actor => ({ instanceId: actor.instanceId, objectId: actor.objectId,
              name: (actor.name || actor.objectId).replace(/\s+/gu, ' ').trim().slice(0, 160) || actor.objectId }));
          }
          builds.set(entry.id, { ...entry, directory: result.buildDirectory, controlPlan }); latestBuild = entry; job.buildId = entry.id;
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
        result = await runProjectBuild({ buildDirectory: entry.directory, tool, backendId, backendRegistry, signal: controller.signal,
          headless: payload.mode === 'headless', smoke: payload.mode === 'headless',
          timeoutMs: payload.mode === 'window' ? 300000 : 30000,
          ...(payload.controlProgram !== undefined ? { controlProgram: payload.controlProgram } : {}), onProgress: progress });
        if (result.record?.runtime) job.runtime = clone(result.record.runtime);
        if (result.record?.control) job.control = clone(result.record.control);
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
      || !['plan', 'build', 'run', 'cancel', 'inspect'].includes(payload.action)) throw fail('build_request_invalid', 'Invalid build action.');
    const allowed = { plan: ['action', 'sceneId'], build: ['action', 'sceneId', 'expectedSnapshotId'], run: ['action', 'buildId', 'mode', 'controlProgram'], cancel: ['action', 'jobId'],
      inspect: ['action', 'jobId', 'instanceId', 'objectId'] }[payload.action];
    if (Object.keys(payload).some(key => !allowed.includes(key))) throw fail('build_request_invalid', 'Unknown build request field.');
    let controlProgram;
    if (Object.hasOwn(payload, 'controlProgram')) {
      try { controlProgram = validateSceneControlProgram(payload.controlProgram); }
      catch (error) {
        throw fail(error.errorCode === 'runtime_control_limit' ? 'runtime_control_limit' : 'runtime_control_invalid',
          'Invalid finite control replay program.', error.errorCode === 'runtime_control_limit' ? 422 : 400);
      }
      if (payload.mode !== 'headless') throw fail('runtime_control_mode', 'Control replay requires headless mode.', 422);
    }
    // Capture request scalars and validated values before awaiting host state.
    // Callers cannot change the job after ownership admission begins.
    payload = { ...payload, ...(controlProgram ? { controlProgram } : {}) };
    if (payload.action === 'inspect') {
      if (!uuid(payload.jobId) || Object.hasOwn(payload, 'instanceId') && !uuid(payload.instanceId)
        || Object.hasOwn(payload, 'objectId') && !uuid(payload.objectId)) throw fail('build_request_invalid', 'Invalid runtime query identity.');
      if (payload.jobId !== job?.id || job.kind !== 'run') throw fail('runtime_query_job_missing', 'This runtime task is not available.', 404);
      if (!job.runtime) throw fail('runtime_query_unavailable', 'Runtime object observation is not available yet.', 409);
      const selection = { ...(payload.instanceId !== undefined ? { instanceId: payload.instanceId } : {}),
        ...(payload.objectId !== undefined ? { objectId: payload.objectId } : {}) };
      let view;
      try { view = querySceneRuntimeObservation(job.runtime, selection); }
      catch { throw fail('build_request_invalid', 'Invalid runtime query.'); }
      return { ...view, jobId: job.id, buildId: job.buildId, snapshotId: job.snapshotId, backendId: job.backendId, status: job.status };
    }
    if (payload.action === 'cancel') {
      if (!uuid(payload.jobId) || payload.jobId !== job?.id) throw fail('build_job_missing', 'Build task is not available.', 404);
      if (active) { job.phase = 'cancelling'; active.controller.abort(); }
      return status();
    }
    if (active) throw fail('build_busy', 'A build task is already active.', 409);
    const tool = await toolState();
    if (!tool.supported) throw fail('build_platform_unsupported', 'Project builds are not enabled on this host.', 403);
    if (payload.action !== 'plan' && !tool.available) throw fail('build_tool_required', 'Configure the selected backend tool on the local host before building.', 422);
    if (payload.action === 'run') {
      if (!uuid(payload.buildId) || !builds.has(payload.buildId)) throw fail('build_artifact_missing', 'This build is no longer available; rebuild the scene.', 404);
      if (!['headless', 'window'].includes(payload.mode)) throw fail('build_request_invalid', 'Invalid runtime mode.');
      const diagnostics = checkExecutionBackendSupport(adapter.descriptor, { operation: payload.mode === 'headless' ? 'headlessLogic' : 'windowPreview', platform: process.platform });
      if (diagnostics.length) throw fail(diagnostics[0].code, diagnostics[0].message, 422);
      if (controlProgram && (!adapter.descriptor.capabilities.includes('runtime.control-replay')
        || controlProgram.schemaVersion === 2 && !adapter.descriptor.capabilities.includes('runtime.control-replay.instances')
        || ![1, 2].includes(builds.get(payload.buildId).planSchemaVersion))) {
        throw fail('runtime_control_unsupported', 'This build does not support finite control replay.', 422);
      }
      if (controlProgram) {
        try { controlProgram = validateSceneControlPlan(builds.get(payload.buildId).controlPlan, controlProgram); }
        catch (error) { throw fail(error.errorCode || 'runtime_control_invalid', 'Control replay does not match this frozen build.', 422); }
      }
    } else {
      if (!uuid(payload.sceneId) || payload.expectedSnapshotId !== undefined
        && (typeof payload.expectedSnapshotId !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(payload.expectedSnapshotId))) throw fail('build_request_invalid', 'Invalid scene or snapshot identity.');
      await readScenes();
      if (!scenes.some(scene => scene.id === payload.sceneId)) throw fail('build_scene_required', 'Select a registered Scene2D document.', 404);
      if (payload.action === 'build') {
        const diagnostics = checkExecutionBackendSupport(adapter.descriptor, { operation: 'build', platform: process.platform });
        if (diagnostics.length) throw fail(diagnostics[0].code, diagnostics[0].message, 422);
      }
    }
    // Recheck after await: simultaneous POSTs cannot both acquire the slot.
    if (closed) throw fail('build_service_closed', 'Build service is closing.', 503);
    if (active) throw fail('build_busy', 'A build task is already active.', 409);
    const controller = new AbortController();
    job = { id: randomUUID(), kind: payload.action, sceneId: payload.sceneId || builds.get(payload.buildId).sceneId,
      backendId,
      ...(payload.action === 'run' ? { buildId: builds.get(payload.buildId).id, snapshotId: builds.get(payload.buildId).snapshotId } : {}),
      status: 'running', phase: payload.action === 'run' ? 'tool' : 'snapshot', createdAt: new Date().toISOString(),
      diagnostics: [], events: [], logs: '', plan: null, runtime: null,
      ...(controlProgram ? { control: { program: clone(controlProgram), sha256: `sha256:${buildHash(canonicalJson(controlProgram))}`, samples: [] } } : {}) };
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
