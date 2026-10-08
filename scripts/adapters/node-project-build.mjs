import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { canonicalJson, createWorldProjection } from '../../engine/world-projection.mjs';
import { createScene2DPlan } from '../../engine/build-plan.mjs';
import { createSceneRuntimeObservation } from '../../engine/scene-runtime-query.mjs';
import { validateSceneControlProgram, validateSceneControlPlan, createSceneControlTraceReader } from '../../engine/scene-control-program.mjs';
import { validateRuntimeCase, validateRuntimeCasePlan, evaluateRuntimeCase } from '../../engine/runtime-verification-case.mjs';
import { checkExecutionBackendSupport } from '../../engine/backend-capabilities.mjs';
import { captureBuildSnapshot, buildHash, buildError, readBuildFile } from './node-build-snapshot.mjs';
import { resolveContainedPath } from '../lib/contained-path.mjs';
import { resolveAssetRoot } from '../lib/workspace.mjs';
import { DEFAULT_EXECUTION_BACKEND, createExecutionBackendRegistry, assertBackendOperation,
  executionAdapterFingerprint, validateGeneratedExecutionProject, executionPhaseDiagnostics, attachFrozenDiagnosticSources } from './node-execution-backends.mjs';

const json = value => JSON.stringify(value, null, 2) + '\n';
const within = (root, target) => { const relative = path.relative(root, target); return relative === '' || relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative); };
const diagnostic = (error, plan) => ({ severity: 'error', code: error.errorCode || 'build_failed', message: error.errorCode ? error.message : 'Build operation failed.',
  objectId: plan?.scene.objectId || null, sourcePath: plan?.scene.sourcePath || '', propertyPath: '' });
const aborted = signal => { if (signal?.aborted) throw buildError('build_cancelled', 'Build operation cancelled.'); };

export function projectBuildCacheRoot(env = process.env) {
  const base = env.XDG_CACHE_HOME && path.isAbsolute(env.XDG_CACHE_HOME) ? env.XDG_CACHE_HOME : path.join(os.homedir(), '.cache');
  return path.join(base, 'io.viento.studio', 'builds');
}

async function physicalDestination(destination) {
  const parts = [];
  let existing = path.resolve(destination);
  for (;;) {
    try { return path.join(await fs.realpath(existing), ...parts); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      // A dangling symlink is also an existing path, never a create parent.
      try { await fs.lstat(existing); throw buildError('build_output_invalid', 'Output must not contain a dangling link.'); }
      catch (statError) { if (statError.code !== 'ENOENT') throw statError; }
      parts.unshift(path.basename(existing)); existing = path.dirname(existing);
    }
  }
}

async function reserveBuildDirectory(root, requested, id) {
  const output = await physicalDestination(requested || path.join(projectBuildCacheRoot(), id));
  const assets = await physicalDestination(resolveAssetRoot(root));
  if (within(root, output) || within(assets, output)) throw buildError('build_output_in_source', 'Build output must be outside the source workspace and asset store.');
  await fs.mkdir(path.dirname(output), { recursive: true });
  try { await fs.mkdir(output, { mode: 0o700 }); }
  catch (error) { throw buildError(error.code === 'EEXIST' ? 'build_output_exists' : 'build_output_invalid', 'Output must be a new writable directory. Existing output is preserved.'); }
  return output;
}

async function saveRecord(directory, name, record) {
  const temporary = path.join(directory, `.${name}.${randomUUID()}`);
  try { await fs.writeFile(temporary, json(record), { flag: 'wx', mode: 0o600 }); await fs.rename(temporary, path.join(directory, name)); }
  finally { await fs.rm(temporary, { force: true }); }
}

export async function buildProject({ root, scene, godot, tool = godot, backendId = DEFAULT_EXECUTION_BACKEND,
  backendRegistry = createExecutionBackendRegistry(), output, signal, timeoutMs = 30000, expectedSnapshotId, onProgress = () => {} }) {
  let directory, plan, record;
  try {
    root = await fs.realpath(root);
    onProgress({ phase: 'snapshot' });
    const captured = await captureBuildSnapshot(root, scene, { signal });
    plan = captured.plan;
    if (!captured.ok) return { ok: false, status: 'rejected', diagnostics: captured.diagnostics };
    if (expectedSnapshotId && expectedSnapshotId !== captured.snapshotId) throw buildError('build_snapshot_changed', 'Saved project inputs changed; check the build plan again.');
    const adapter = backendRegistry.resolve(backendId);
    const missing = checkExecutionBackendSupport(adapter.descriptor, { operation: 'build', platform: process.platform, plan });
    if (missing.length) return { ok: false, status: 'rejected', diagnostics: missing };
    onProgress({ phase: 'tool' });
    const identifiedTool = await adapter.identify(tool, { signal });
    onProgress({ phase: 'generate' });
    const generated = validateGeneratedExecutionProject(adapter, plan, await adapter.generate(plan));
    const executionAdapter = await executionAdapterFingerprint(adapter);
    const snapshotBytes = Buffer.from(json(captured.snapshot));
    if (snapshotBytes.length > 80 * 1024 * 1024) throw buildError('build_input_limit', 'Serialized build snapshot exceeds 80 MiB.');
    aborted(signal);
    const buildId = randomUUID();
    directory = await reserveBuildDirectory(root, output, buildId);
    record = { format: 'viento-build-record', schemaVersion: 1, buildId, status: 'building',
      snapshotId: captured.snapshotId, backend: generated.backend, executionAdapter,
      tool: { version: identifiedTool.version, sha256: identifiedTool.sha256, platform: identifiedTool.platform, arch: identifiedTool.arch },
      artifact: { ...generated.artifact, entry: `project/${generated.artifact.entry}`, files: [] },
      diagnostics: [], phases: [] };
    await saveRecord(directory, 'build.json', record);
    await fs.writeFile(path.join(directory, 'snapshot.json'), snapshotBytes, { flag: 'wx' });
    await fs.writeFile(path.join(directory, 'source-map.json'), json(generated.sourceMap), { flag: 'wx' });
    const project = path.join(directory, 'project');
    await fs.mkdir(project);
    for (const resource of plan.resources) generated.files.set(generated.resourceFiles.get(resource.id), captured.resources.get(resource.id));
    for (const [relative, bytes] of generated.files) {
      aborted(signal);
      const file = path.join(project, relative);
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, bytes, { flag: 'wx' });
      record.artifact.files.push({ path: relative, size: bytes.length, sha256: buildHash(bytes) });
    }
    const onOutput = output => onProgress({ output });
    for (const phase of adapter.buildPhases) {
      onProgress({ phase });
      const result = await adapter.executePhase({ phase, tool: identifiedTool, directory: project, signal, timeoutMs, onOutput });
      record.phases.push({ phase, ...result });
      record.diagnostics.push(...executionPhaseDiagnostics(adapter, result, plan));
      if (record.diagnostics.length) break;
    }
    // Caches are regenerable. Keep the small generated project, not editor or
    // shader caches in every build. Runtime gets its own temporary project.
    await adapter.cleanupProject(project);
    if (plan.behaviors) record.diagnostics = attachFrozenDiagnosticSources(record.diagnostics, captured.snapshot.source.documents,
      [plan.behaviors.manifest.objectId, ...plan.behaviors.sources.map(source => source.objectId)]);
    record.status = record.diagnostics.length ? (record.phases.some(item => item.status === 'cancelled') ? 'cancelled' : record.phases.some(item => item.status === 'timeout') ? 'timeout' : 'failed') : 'succeeded';
    await saveRecord(directory, 'build.json', record);
    return { ok: record.status === 'succeeded', status: record.status, buildDirectory: directory, record };
  } catch (error) {
    const status = signal?.aborted ? 'cancelled' : 'failed';
    const item = diagnostic(signal?.aborted ? buildError('build_cancelled', 'Build operation cancelled.') : error, plan);
    if (record && directory) {
      record.status = status; record.diagnostics.push(item);
      await fs.rm(path.join(directory, 'project'), { recursive: true, force: true });
      await saveRecord(directory, 'build.json', record);
      return { ok: false, status, buildDirectory: directory, record };
    }
    return { ok: false, status, diagnostics: [item] };
  }
}

// Author suites need the same restored frozen semantics before scheduling any
// member. This reads no author workspace and starts no tool or runtime session.
export async function readFrozenProjectBuild(buildDirectory, { backendId, backendRegistry = createExecutionBackendRegistry(), signal } = {}) {
  buildDirectory = await fs.realpath(buildDirectory);
  const read = async (name, limit) => readBuildFile(await resolveContainedPath(buildDirectory, path.join(buildDirectory, name)), limit, signal);
  const build = JSON.parse(await read('build.json', 4 * 1024 * 1024));
  const snapshot = JSON.parse(await read('snapshot.json', 80 * 1024 * 1024));
  if (build.format !== 'viento-build-record' || build.schemaVersion !== 1 || build.status !== 'succeeded'
    || typeof build.backend?.id !== 'string' || snapshot.format !== 'viento-build-snapshot' || snapshot.schemaVersion !== 1
    || build.snapshotId !== `sha256:${buildHash(canonicalJson(snapshot))}`) throw buildError('runtime_build_invalid', 'Select a successful build with an intact snapshot.');
  if (backendId !== undefined && backendId !== build.backend.id) throw buildError('runtime_backend_changed', 'The selected execution backend differs from this frozen build.');
  const adapter = backendRegistry.resolve(build.backend.id);
  const projection = await createWorldProjection(snapshot.source, { digest: buildHash });
  const restored = createScene2DPlan({ source: snapshot.source, projection }, snapshot.plan?.scene?.objectId);
  if (!restored.ok || canonicalJson(restored.plan) !== canonicalJson(snapshot.plan)
    || restored.plan.resources.reduce((sum, item) => sum + item.size, 0) > 128 * 1024 * 1024) throw buildError('runtime_build_invalid', 'The frozen scene plan is invalid.');
  return { buildDirectory, build, snapshot, adapter, plan:restored.plan };
}

export async function runProjectBuild({ buildDirectory, godot, tool = godot, backendId,
  backendRegistry = createExecutionBackendRegistry(), signal, timeoutMs = 30000, headless = true, smoke = true, capture = false,
  controlProgram: inputControlProgram, runtimeCase: inputRuntimeCase, runtimeCaseSceneId, expectedBuildId, expectedSnapshotId, onProgress = () => {} }) {
  let sessionDirectory, record, plan, frozenSourceDocuments, observation, controlProgram, runtimeCase;
  // Callback consumers receive detached DTOs and cannot alter admitted input,
  // events, samples or the session record while a process is running.
  const publish = event => onProgress(JSON.parse(JSON.stringify(event)));
  try {
    if (runtimeCaseSceneId !== undefined && (inputRuntimeCase === undefined || typeof runtimeCaseSceneId !== 'string'
      || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(runtimeCaseSceneId))) {
      throw buildError('runtime_case_scene_mismatch', 'A scene binding requires a runtime case and a valid scene identity.');
    }
    if (inputRuntimeCase !== undefined) {
      runtimeCase = validateRuntimeCase(inputRuntimeCase);
      if (inputControlProgram !== undefined) throw buildError('runtime_case_invalid', 'Select either a verification case or a control program.');
      if (headless !== true || smoke !== true || capture !== false) throw buildError('runtime_case_unsupported', 'Runtime verification requires a finite headless smoke run.');
      controlProgram = runtimeCase.program;
    }
    if (inputControlProgram !== undefined) {
      controlProgram = validateSceneControlProgram(inputControlProgram);
      if (headless !== true || smoke !== true || capture !== false) throw buildError('runtime_control_mode', 'Control replay requires a finite headless smoke run.');
    }
    if (capture && (headless || !smoke)) throw buildError('runtime_capture_mode', 'Preview capture requires a windowed smoke run.');
    const frozen = await readFrozenProjectBuild(buildDirectory, { backendId, backendRegistry, signal });
    buildDirectory = frozen.buildDirectory; plan = frozen.plan;
    const { build, snapshot, adapter } = frozen;
    if (expectedBuildId !== undefined && build.buildId !== expectedBuildId
      || expectedSnapshotId !== undefined && build.snapshotId !== expectedSnapshotId) {
      throw buildError('runtime_build_invalid', 'The owned frozen build changed before execution.');
    }
    const read = async (name, limit) => readBuildFile(await resolveContainedPath(buildDirectory, path.join(buildDirectory, name)), limit, signal);
    const operation = capture ? 'windowCapture' : headless ? 'headlessLogic' : 'windowPreview';
    assertBackendOperation(adapter, operation);
    if (controlProgram && (!adapter.descriptor.capabilities.includes('runtime.control-replay')
      || controlProgram.schemaVersion === 2 && !adapter.descriptor.capabilities.includes('runtime.control-replay.instances'))) {
      throw buildError(runtimeCase ? 'runtime_case_unsupported' : 'runtime_control_unsupported', 'This backend does not support control replay.');
    }
    if (runtimeCaseSceneId !== undefined && plan.scene.objectId !== runtimeCaseSceneId) {
      throw buildError('runtime_case_scene_mismatch', 'The runtime case belongs to a different frozen scene.');
    }
    if (runtimeCase) runtimeCase = validateRuntimeCasePlan(plan, runtimeCase);
    if (controlProgram && (plan.kind !== 'scene2d' || ![1, 2].includes(plan.schemaVersion) || plan.behaviors)) {
      throw buildError(runtimeCase ? 'runtime_case_unsupported' : 'runtime_control_unsupported', 'Control replay requires a Scene2D plan version 1 or 2 without authored behaviors.');
    }
    if (controlProgram) controlProgram = validateSceneControlPlan(plan, controlProgram);
    frozenSourceDocuments = snapshot.source.documents;
    assertBackendOperation(adapter, operation, plan);
    const generated = validateGeneratedExecutionProject(adapter, plan, await adapter.generate(plan));
    if (generated.backend.protocolVersion !== build.backend.protocolVersion
      || generated.backend.sha256 !== build.backend.sha256) throw buildError('runtime_adapter_changed', 'Backend code changed; rebuild this project before running.');
    const executionAdapter = await executionAdapterFingerprint(adapter);
    if (build.executionAdapter !== undefined ? canonicalJson(build.executionAdapter) !== canonicalJson(executionAdapter)
      : !adapter.acceptsLegacyBuildRecords) throw buildError('runtime_adapter_changed', 'Execution adapter changed; rebuild this project before running.');
    if (build.artifact?.kind !== generated.artifact.kind || build.artifact?.entry !== `project/${generated.artifact.entry}`
      || build.artifact?.requiresTool !== generated.artifact.requiresTool) throw buildError('runtime_artifact_changed', 'Generated artifact declaration changed.');
    publish({ phase: 'tool' });
    const identifiedTool = await adapter.identify(tool, { signal });
    if (identifiedTool.sha256 !== build.tool.sha256 || identifiedTool.version !== build.tool.version) throw buildError('runtime_tool_changed', 'Use the exact toolchain recorded by this build, or rebuild.');
    // Reconstruct the allowed outputs from the frozen plan, never accept an
    // arbitrary path or executable from a stored build record.
    const allowed = new Set([...generated.files.keys(), ...generated.resourceFiles.values()]);
    if (!Array.isArray(build.artifact.files) || build.artifact.files.length !== allowed.size) throw buildError('runtime_artifact_changed', 'Generated artifact inventory changed.');
    const bytes = new Map();
    for (const file of build.artifact.files) {
      if (!allowed.delete(file.path)) throw buildError('runtime_artifact_changed', 'Generated artifact inventory changed.');
      const content = await read(`project/${file.path}`, 32 * 1024 * 1024);
      const expected = generated.files.get(file.path);
      const resource = plan.resources.find(item => generated.resourceFiles.get(item.id) === file.path);
      if (content.length !== file.size || buildHash(content) !== file.sha256
        || (expected && !content.equals(expected)) || (resource && buildHash(content) !== resource.sha256)) throw buildError('runtime_artifact_changed', 'Generated artifact bytes changed; rebuild instead of editing the output.');
      bytes.set(file.path, content);
    }
    aborted(signal);
    // Runtime identities and navigation come only from the revalidated frozen
    // plan. No process frame can introduce an object or author location.
    observation = createSceneRuntimeObservation(plan, { ...(controlProgram ? { controlProgram } : {}) });
    const sessions = await resolveContainedPath(buildDirectory, path.join(buildDirectory, 'sessions'), { allowMissing: true });
    await fs.mkdir(sessions, { recursive: true });
    const sessionId = randomUUID(); sessionDirectory = path.join(sessions, sessionId);
    await fs.mkdir(sessionDirectory, { mode: 0o700 });
    record = { format: 'viento-runtime-session', schemaVersion: 1, sessionId, buildId: build.buildId,
      snapshotId: build.snapshotId, backendId: build.backend.id, executionAdapter, tool: build.tool,
      mode: headless ? 'headless-logic' : 'window-preview', smoke, status: 'starting', events: [], diagnostics: [], phases: [],
      runtime: observation.snapshot(),
      ...(controlProgram ? { control: { program: controlProgram, sha256: `sha256:${buildHash(canonicalJson(controlProgram))}`, samples: [] } } : {}),
      ...(runtimeCase ? { verification: { definition: runtimeCase, sha256: `sha256:${buildHash(canonicalJson(runtimeCase))}`,
        evaluation: evaluateRuntimeCase(plan, runtimeCase, [], { complete: false }) } } : {}) };
    await saveRecord(sessionDirectory, 'session.json', record);
    publish({ runtime: observation.snapshot(), ...(record.verification ? { verification: record.verification } : {}) });
    const project = path.join(sessionDirectory, 'project'); await fs.mkdir(project);
    for (const [relative, content] of bytes) {
      await fs.mkdir(path.dirname(path.join(project, relative)), { recursive: true });
      await fs.writeFile(path.join(project, relative), content, { flag: 'wx' });
    }
    for (const phase of adapter.runtimePhases) {
      publish({ phase });
      const result = await adapter.executePhase({ phase, tool: identifiedTool, directory: project, signal, timeoutMs, onOutput: output => publish({ output }) });
      record.phases.push({ phase, ...result }); record.diagnostics.push(...executionPhaseDiagnostics(adapter, result, plan));
      if (record.diagnostics.length) break;
    }
    if (!record.diagnostics.length) {
      const runtime = adapter.createEventReader(plan, { onEvent: event => {
        if (observation.push(event)) {
          record.runtime = observation.snapshot();
          // A consumer may cancel in response to ready. Publish the corresponding
          // detached view first so that cancellation cannot hide admitted state.
          publish({ runtime: observation.snapshot() });
        }
        publish({ event, ...(event.event === 'ready' ? { phase: 'running' } : {}) });
      } });
      const trace = controlProgram ? createSceneControlTraceReader(plan, controlProgram, {
        onRuntime: text => runtime.push(text),
        onSample: sample => {
          record.control.samples.push(JSON.parse(JSON.stringify(sample)));
          if (runtimeCase) record.verification.evaluation = evaluateRuntimeCase(plan, runtimeCase, record.control.samples, { complete: false });
          if (observation.pushSample(sample)) {
            record.runtime = observation.snapshot();
            publish({ runtime: observation.snapshot(), controlSample: sample,
              ...(record.verification ? { verification: record.verification } : {}) });
          }
        },
      }) : null;
      record.status = 'running'; await saveRecord(sessionDirectory, 'session.json', record);
      publish({ phase: 'starting' });
      const result = await adapter.executePhase({ phase: 'run', tool: identifiedTool, directory: project, signal, timeoutMs, mode: operation, smoke,
        ...(controlProgram ? { controlProgram: JSON.parse(JSON.stringify(controlProgram)) } : {}),
        ...(capture ? { capturePath: path.join(sessionDirectory, 'preview.png') } : {}),
        onOutput: output => { publish({ output }); if (output.stream === 'stdout') (trace || runtime).push(output.text); } });
      if (trace) trace.finish({ requireComplete: result.status === 'succeeded' });
      runtime.finish();
      record.phases.push({ phase: 'run', ...result }); record.events = runtime.events;
      record.diagnostics.push(...executionPhaseDiagnostics(adapter, result, plan), ...runtime.diagnostics, ...(trace?.diagnostics || []));
      if (!record.diagnostics.length && (!runtime.events.some(item => item.event === 'ready') || smoke && !runtime.events.some(item => item.event === 'finished'))) {
        record.diagnostics.push(diagnostic(buildError('runtime_protocol_incomplete', 'Runtime exited without the required lifecycle events.'), plan));
      }
    }
    record.status = record.diagnostics.length ? (record.phases.some(item => item.status === 'cancelled') ? 'cancelled' : record.phases.some(item => item.status === 'timeout') ? 'timeout' : 'failed') : 'succeeded';
    if (capture && record.status === 'succeeded') record.capture = 'preview.png';
  } catch (error) {
    const status = signal?.aborted ? 'cancelled' : 'failed';
    const item = diagnostic(signal?.aborted ? buildError('runtime_cancelled', 'Runtime cancelled.') : error, plan);
    if (!record) return { ok: false, status, diagnostics: [item] };
    record.status = status; record.diagnostics.push(item);
  } finally {
    if (sessionDirectory) await fs.rm(path.join(sessionDirectory, 'project'), { recursive: true, force: true });
  }
  if (observation) record.runtime = observation.snapshot();
  if (runtimeCase && record.verification) {
    if (signal?.aborted && record.status === 'succeeded') {
      record.status = 'cancelled'; record.diagnostics.push(diagnostic(buildError('runtime_cancelled', 'Runtime cancelled.'), plan));
    }
    try { record.verification.evaluation = evaluateRuntimeCase(plan, runtimeCase, record.control.samples, { complete: record.status === 'succeeded' }); }
    catch (error) {
      record.diagnostics.push(diagnostic(error, plan)); record.status = 'failed';
      record.verification.evaluation = evaluateRuntimeCase(plan, runtimeCase, [], { complete: false });
    }
  }
  if (plan.behaviors) record.diagnostics = attachFrozenDiagnosticSources(record.diagnostics, frozenSourceDocuments,
    [plan.behaviors.manifest.objectId, ...plan.behaviors.sources.map(source => source.objectId)]);
  await saveRecord(sessionDirectory, 'session.json', record);
  // Final record persistence is the case commit point. Cancellation during
  // that awaited write must not leave a passed disk record behind.
  if (runtimeCase && signal?.aborted && record.status === 'succeeded') {
    record.status = 'cancelled'; record.diagnostics.push(diagnostic(buildError('runtime_cancelled', 'Runtime cancelled.'), plan));
    record.verification.evaluation = evaluateRuntimeCase(plan, runtimeCase, record.control.samples, { complete: false });
    await saveRecord(sessionDirectory, 'session.json', record);
  }
  return { ok: record.status === 'succeeded' && (!record.verification || record.verification.evaluation.status === 'passed'), status: record.status, sessionDirectory, record };
}
