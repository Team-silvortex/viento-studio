import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { canonicalJson, createWorldProjection } from '../../engine/world-projection.mjs';
import { checkBuildCapabilities, createScene2DPlan } from '../../engine/build-plan.mjs';
import { captureBuildSnapshot, buildHash, buildError, readBuildFile } from './node-build-snapshot.mjs';
import { resolveContainedPath } from '../lib/contained-path.mjs';
import { resolveAssetRoot } from '../lib/workspace.mjs';
import { runBuildProcess } from '../lib/build-process.mjs';
import { GODOT4_BACKEND, identifyGodot, generateGodotProject, godotDiagnostics, createRuntimeEventReader } from '../backends/godot4.mjs';

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

async function processPhase(tool, directory, args, options) {
  const result = await runBuildProcess(tool.executable, ['--path', directory, ...args], {
    cwd: directory, env: { ...process.env, GODOT_SILENCE_ROOT_WARNING: '1',
      XDG_DATA_HOME: path.join(directory, '.host/data'), XDG_CONFIG_HOME: path.join(directory, '.host/config'),
      XDG_CACHE_HOME: path.join(directory, '.host/cache') }, ...options,
  });
  return result;
}

export async function buildProject({ root, scene, godot, output, signal, timeoutMs = 30000, expectedSnapshotId, onProgress = () => {} }) {
  let directory, plan, record;
  try {
    root = await fs.realpath(root);
    onProgress({ phase: 'snapshot' });
    const captured = await captureBuildSnapshot(root, scene, { signal });
    plan = captured.plan;
    if (!captured.ok) return { ok: false, status: 'rejected', diagnostics: captured.diagnostics };
    if (expectedSnapshotId && expectedSnapshotId !== captured.snapshotId) throw buildError('build_snapshot_changed', 'Saved project inputs changed; check the build plan again.');
    const missing = checkBuildCapabilities(plan, GODOT4_BACKEND);
    if (missing.length) return { ok: false, status: 'rejected', diagnostics: missing };
    onProgress({ phase: 'tool' });
    const tool = await identifyGodot(godot, { signal });
    onProgress({ phase: 'generate' });
    const generated = await generateGodotProject(plan);
    const snapshotBytes = Buffer.from(json(captured.snapshot));
    if (snapshotBytes.length > 80 * 1024 * 1024) throw buildError('build_input_limit', 'Serialized build snapshot exceeds 80 MiB.');
    aborted(signal);
    const buildId = randomUUID();
    directory = await reserveBuildDirectory(root, output, buildId);
    record = { format: 'viento-build-record', schemaVersion: 1, buildId, status: 'building',
      snapshotId: captured.snapshotId, backend: generated.backend,
      tool: { version: tool.version, sha256: tool.sha256, platform: tool.platform, arch: tool.arch },
      artifact: { kind: GODOT4_BACKEND.artifactKind, entry: 'project/project.godot', requiresTool: true, files: [] },
      diagnostics: [], phases: [] };
    await saveRecord(directory, 'build.json', record);
    await fs.writeFile(path.join(directory, 'snapshot.json'), snapshotBytes, { flag: 'wx' });
    await fs.writeFile(path.join(directory, 'source-map.json'), json(generated.sourceMap), { flag: 'wx' });
    const project = path.join(directory, 'project');
    await fs.mkdir(project);
    for (const resource of plan.resources) generated.files.set(generated.imageFiles.get(resource.id), captured.resources.get(resource.id));
    for (const [relative, bytes] of generated.files) {
      aborted(signal);
      const file = path.join(project, relative);
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, bytes, { flag: 'wx' });
      record.artifact.files.push({ path: relative, size: bytes.length, sha256: buildHash(bytes) });
    }
    onProgress({ phase: 'import' });
    const onOutput = output => onProgress({ output });
    const imported = await processPhase(tool, project, ['--headless', '--editor', '--import'], { signal, timeoutMs, onOutput });
    record.phases.push({ phase: 'import', ...imported });
    record.diagnostics.push(...godotDiagnostics(imported, plan));
    if (!record.diagnostics.length) {
      onProgress({ phase: 'script-check' });
      const checked = await processPhase(tool, project, ['--headless', '--script', 'res://runtime.gd', '--check-only'], { signal, timeoutMs, onOutput });
      record.phases.push({ phase: 'script-check', ...checked });
      record.diagnostics.push(...godotDiagnostics(checked, plan));
    }
    // Caches are regenerable. Keep the small generated project, not editor or
    // shader caches in every build. Runtime gets its own temporary project.
    await fs.rm(path.join(project, '.godot'), { recursive: true, force: true });
    await fs.rm(path.join(project, '.host'), { recursive: true, force: true });
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

export async function runProjectBuild({ buildDirectory, godot, signal, timeoutMs = 30000, headless = true, smoke = true, capture = false, onProgress = () => {} }) {
  let sessionDirectory, record, plan;
  try {
    if (capture && (headless || !smoke)) throw buildError('runtime_capture_mode', 'Preview capture requires a windowed smoke run.');
    buildDirectory = await fs.realpath(buildDirectory);
    const read = async (name, limit) => readBuildFile(await resolveContainedPath(buildDirectory, path.join(buildDirectory, name)), limit, signal);
    const build = JSON.parse(await read('build.json', 4 * 1024 * 1024));
    const snapshot = JSON.parse(await read('snapshot.json', 80 * 1024 * 1024));
    if (build.format !== 'viento-build-record' || build.schemaVersion !== 1 || build.status !== 'succeeded'
      || build.backend?.id !== GODOT4_BACKEND.id || build.backend.protocolVersion !== 1
      || snapshot.format !== 'viento-build-snapshot' || snapshot.schemaVersion !== 1
      || build.snapshotId !== `sha256:${buildHash(canonicalJson(snapshot))}`) throw buildError('runtime_build_invalid', 'Select a successful build with an intact snapshot.');
    const projection = await createWorldProjection(snapshot.source, { digest: buildHash });
    const restored = createScene2DPlan({ source: snapshot.source, projection }, snapshot.plan?.scene?.objectId);
    if (!restored.ok || canonicalJson(restored.plan) !== canonicalJson(snapshot.plan)
      || restored.plan.resources.reduce((sum, item) => sum + item.size, 0) > 128 * 1024 * 1024) throw buildError('runtime_build_invalid', 'The frozen scene plan is invalid.');
    plan = restored.plan;
    const generated = await generateGodotProject(plan);
    if (generated.backend.sha256 !== build.backend.sha256) throw buildError('runtime_adapter_changed', 'Backend code changed; rebuild this project before running.');
    onProgress({ phase: 'tool' });
    const tool = await identifyGodot(godot, { signal });
    if (tool.sha256 !== build.tool.sha256 || tool.version !== build.tool.version) throw buildError('runtime_tool_changed', 'Use the exact toolchain recorded by this build, or rebuild.');
    // Reconstruct the allowed outputs from the frozen plan, never accept an
    // arbitrary path or executable from a stored build record.
    const allowed = new Set([...generated.files.keys(), ...generated.imageFiles.values()]);
    if (!Array.isArray(build.artifact.files) || build.artifact.files.length !== allowed.size) throw buildError('runtime_artifact_changed', 'Generated artifact inventory changed.');
    const bytes = new Map();
    for (const file of build.artifact.files) {
      if (!allowed.delete(file.path)) throw buildError('runtime_artifact_changed', 'Generated artifact inventory changed.');
      const content = await read(`project/${file.path}`, 32 * 1024 * 1024);
      const expected = generated.files.get(file.path);
      const resource = plan.resources.find(item => generated.imageFiles.get(item.id) === file.path);
      if (content.length !== file.size || buildHash(content) !== file.sha256
        || (expected && !content.equals(expected)) || (resource && buildHash(content) !== resource.sha256)) throw buildError('runtime_artifact_changed', 'Generated artifact bytes changed; rebuild instead of editing the output.');
      bytes.set(file.path, content);
    }
    aborted(signal);
    const sessions = await resolveContainedPath(buildDirectory, path.join(buildDirectory, 'sessions'), { allowMissing: true });
    await fs.mkdir(sessions, { recursive: true });
    const sessionId = randomUUID(); sessionDirectory = path.join(sessions, sessionId);
    await fs.mkdir(sessionDirectory, { mode: 0o700 });
    record = { format: 'viento-runtime-session', schemaVersion: 1, sessionId, buildId: build.buildId,
      snapshotId: build.snapshotId, backendId: build.backend.id, tool: build.tool,
      mode: headless ? 'headless-logic' : 'window-preview', smoke, status: 'starting', events: [], diagnostics: [], phases: [] };
    await saveRecord(sessionDirectory, 'session.json', record);
    const project = path.join(sessionDirectory, 'project'); await fs.mkdir(project);
    for (const [relative, content] of bytes) {
      await fs.mkdir(path.dirname(path.join(project, relative)), { recursive: true });
      await fs.writeFile(path.join(project, relative), content, { flag: 'wx' });
    }
    onProgress({ phase: 'import' });
    const imported = await processPhase(tool, project, ['--headless', '--editor', '--import'], { signal, timeoutMs, onOutput: output => onProgress({ output }) });
    record.phases.push({ phase: 'import', ...imported }); record.diagnostics.push(...godotDiagnostics(imported, plan));
    if (!record.diagnostics.length) {
      const options = [...(smoke ? ['--viento-smoke'] : []), ...(capture ? [`--viento-capture=${path.join(sessionDirectory, 'preview.png')}`] : [])];
      const runtime = createRuntimeEventReader(plan, { onEvent: event => onProgress({ event, ...(event.event === 'ready' ? { phase: 'running' } : {}) }) });
      record.status = 'running'; await saveRecord(sessionDirectory, 'session.json', record);
      onProgress({ phase: 'starting' });
      const result = await processPhase(tool, project, [...(headless ? ['--headless'] : []), '--', ...options], { signal, timeoutMs,
        onOutput: output => { onProgress({ output }); if (output.stream === 'stdout') runtime.push(output.text); } });
      runtime.finish();
      record.phases.push({ phase: 'run', ...result }); record.events = runtime.events;
      record.diagnostics.push(...godotDiagnostics(result, plan), ...runtime.diagnostics);
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
  await saveRecord(sessionDirectory, 'session.json', record);
  return { ok: record.status === 'succeeded', status: record.status, sessionDirectory, record };
}
