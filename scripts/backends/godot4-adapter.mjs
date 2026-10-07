// Godot-specific process arguments and generated project conventions stay here.
// The host executor consumes only the neutral adapter contract below.
import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { validateExecutionBackendDescriptor, checkExecutionBackendSupport } from '../../engine/backend-capabilities.mjs';
import { validateSceneControlProgram, validateSceneControlPlan } from '../../engine/scene-control-program.mjs';
import { buildHash, buildError, readBuildFile } from '../adapters/node-build-snapshot.mjs';
import { resolveContainedPath } from '../lib/contained-path.mjs';
import { runBuildProcess } from '../lib/build-process.mjs';
import { identifyGodot, generateGodotProject, godotDiagnostics, createRuntimeEventReader } from './godot4-dispatch.mjs';
import { generateGodotBehaviorProject, godotBehaviorDiagnostics, createBehaviorRuntimeEventReader } from './godot4-behaviors.mjs';

const descriptor = validateExecutionBackendDescriptor({
  format: 'viento-execution-backend', schemaVersion: 1, id: 'org.viento.godot4', label: 'Godot 4', version: '0.5.0',
  platforms: ['linux'], plans: [{ kind: 'scene2d', schemaVersion: 1, runtimeProtocolVersion: 1 }, { kind: 'scene2d', schemaVersion: 2, runtimeProtocolVersion: 2 }, { kind: 'scene2d', schemaVersion: 3, runtimeProtocolVersion: 3 }],
  capabilities: ['scene2d', 'input.arrows', 'state.movement', 'image', 'behavior.bindings', 'behavior.gdscript', 'runtime.control-replay', 'runtime.control-replay.instances'],
  execution: { build: true, headlessLogic: true, windowPreview: true, windowCapture: true, offscreenRender: false, embeddedViewport: false, gpuCompute: false },
  extensions: [],
});
const buildPhases = Object.freeze(['import', 'script-check']);
const runtimePhases = Object.freeze(['import']);
const absolute = value => typeof value === 'string' && path.isAbsolute(value) && !value.includes('\0');
const support = request => {
  const diagnostics = checkExecutionBackendSupport(descriptor, request);
  if (diagnostics.length) throw buildError(diagnostics[0].code, diagnostics[0].message, { diagnostics });
};

async function availability({ toolPath, enabled = true, platform = process.platform } = {}) {
  if (!enabled || !descriptor.platforms.includes(platform)) return { supported: false, available: false, reason: 'platform_unsupported' };
  if (!absolute(toolPath)) return { supported: true, available: false, reason: 'tool_missing' };
  try {
    const stat = await fs.stat(toolPath); await fs.access(toolPath, constants.X_OK);
    return { supported: true, available: stat.isFile(), reason: stat.isFile() ? null : 'tool_missing' };
  } catch { return { supported: true, available: false, reason: 'tool_missing' }; }
}

async function generate(plan) {
  support({ operation: 'build', plan });
  // Detach before the generator's asynchronous file reads so callers cannot
  // change an admitted plan while its project bytes are being produced.
  const generated = await (plan.schemaVersion === 3 ? generateGodotBehaviorProject : generateGodotProject)(structuredClone(plan));
  return { ...generated, resourceFiles: new Map(generated.imageFiles),
    artifact: { kind: 'godot-project', entry: 'project.godot', requiresTool: true } };
}

async function fingerprint() {
  // Include the admission rules and host contract implementation without
  // changing the historical generator/runtime fingerprint in build.backend.
  const files = [
    ['scripts/backends/godot4-adapter.mjs', new URL('./godot4-adapter.mjs', import.meta.url)],
    ['engine/backend-capabilities.mjs', new URL('../../engine/backend-capabilities.mjs', import.meta.url)],
    ['scripts/adapters/node-execution-backends.mjs', new URL('../adapters/node-execution-backends.mjs', import.meta.url)],
    ['scripts/backends/godot4-behaviors.mjs', new URL('./godot4-behaviors.mjs', import.meta.url)],
    ['scripts/backends/godot4/behavior-runtime.gd', new URL('./godot4/behavior-runtime.gd', import.meta.url)],
    ['engine/scene-behaviors.mjs', new URL('../../engine/scene-behaviors.mjs', import.meta.url)],
    ['engine/build-plan.mjs', new URL('../../engine/build-plan.mjs', import.meta.url)],
    ['engine/scene-control-program.mjs', new URL('../../engine/scene-control-program.mjs', import.meta.url)],
    ['scripts/backends/godot4/control-runtime.gd', new URL('./godot4/control-runtime.gd', import.meta.url)],
    ['scripts/backends/godot4/control.tscn', new URL('./godot4/control.tscn', import.meta.url)],
  ];
  const identities = await Promise.all(files.map(async ([file, url]) => ({ path: file, sha256: buildHash(await fs.readFile(url)) })));
  return { id: descriptor.id, contractVersion: 1, sha256: buildHash(JSON.stringify(identities)) };
}

async function executePhase({ phase, tool, directory, signal, timeoutMs = 30000, onOutput, mode = 'headlessLogic', smoke = true, capturePath, controlProgram } = {}) {
  if (!['import', 'script-check', 'run'].includes(phase)) throw buildError('build_execution_unsupported', 'Godot does not support this execution phase.');
  if (controlProgram !== undefined && (phase !== 'run' || mode !== 'headlessLogic' || !smoke)) {
    throw buildError('runtime_control_unsupported', 'Control replay requires a headless smoke run.');
  }
  let args;
  if (phase === 'run') {
    if (!['headlessLogic', 'windowPreview', 'windowCapture'].includes(mode)) throw buildError('build_execution_unsupported', 'Godot does not support this execution mode.');
    support({ operation: mode, platform: process.platform });
    if (typeof smoke !== 'boolean') throw buildError('runtime_mode_invalid', 'Select a boolean smoke-run option.');
    if (mode === 'windowCapture' ? !smoke || !absolute(capturePath) : capturePath !== undefined) {
      throw buildError('runtime_capture_mode', 'Preview capture requires a windowed smoke run and an absolute capture path.');
    }
    args = [...(mode === 'headlessLogic' ? ['--headless'] : []), '--', ...(smoke ? ['--viento-smoke'] : []),
      ...(mode === 'windowCapture' ? [`--viento-capture=${capturePath}`] : [])];
  } else {
    support({ operation: 'build', platform: process.platform });
    if (capturePath !== undefined) throw buildError('runtime_capture_mode', 'Preview capture is only available for a windowed smoke run.');
    args = phase === 'import' ? ['--headless', '--editor', '--import'] : ['--headless', '--script', 'res://runtime.gd', '--check-only'];
  }
  if (!absolute(tool?.executable)) throw buildError('build_tool_required', 'Provide an identified absolute Godot executable path.');
  if (!absolute(directory)) throw buildError('build_output_invalid', 'Execute Godot only in an absolute generated-project directory.');
  const options = { cwd: directory, env: { ...process.env, GODOT_SILENCE_ROOT_WARNING: '1',
      XDG_DATA_HOME: path.join(directory, '.host/data'), XDG_CONFIG_HOME: path.join(directory, '.host/config'), XDG_CACHE_HOME: path.join(directory, '.host/cache') },
    signal, timeoutMs, onOutput };
  if (phase === 'script-check') {
    const scripts = ['runtime.gd'];
    let manifest;
    try { manifest = JSON.parse(await readBuildFile(path.join(directory, 'behaviors.json'), 128 * 1024, signal)); }
    catch (error) { if (error.code !== 'ENOENT') throw buildError('build_behavior_invalid', 'Invalid generated behavior inventory.'); }
    if (manifest) {
      if (manifest.format !== 'viento-godot-behaviors' || manifest.schemaVersion !== 1 || !Array.isArray(manifest.sources)
        || manifest.sources.length < 1 || manifest.sources.length > 8
        || new Set(manifest.sources.map(source => source.objectId)).size !== manifest.sources.length
        || manifest.sources.some(source => !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(source.objectId)
          || source.path !== `behaviors/${source.objectId}.gd`)) throw buildError('build_behavior_invalid', 'Invalid generated behavior inventory.');
      scripts.push('behavior-runtime.gd', ...manifest.sources.map(source => source.path));
      for (const script of scripts) await readBuildFile(await resolveContainedPath(directory, path.join(directory, script)), 65536, signal);
    }
    const started = Date.now(); let stdout = '', stderr = '', result;
    for (const script of scripts) {
      const remaining = timeoutMs - (Date.now() - started), budget = 1024 * 1024 - Buffer.byteLength(stdout + stderr);
      if (remaining <= 0 || budget <= 0) return { status: remaining <= 0 ? 'timeout' : 'output-limit', exitCode: null, stdout, stderr, durationMs: Date.now() - started };
      result = await runBuildProcess(tool.executable, ['--path', directory, '--headless', '--script', `res://${script}`, '--check-only'],
        { ...options, timeoutMs: remaining, maxOutputBytes: budget });
      stdout += result.stdout; stderr += result.stderr;
      if (result.status !== 'succeeded' || /(?:^|\n)\s*(?:SCRIPT ERROR:|ERROR:)/.test(result.stdout + '\n' + result.stderr)) break;
    }
    return { ...result, stdout, stderr, durationMs: Date.now() - started };
  }
  if (controlProgram === undefined) return runBuildProcess(tool.executable, ['--path', directory, ...args], options);
  if (phase !== 'run' || mode !== 'headlessLogic' || !smoke) throw buildError('runtime_control_unsupported', 'Control replay requires a headless smoke run.');
  let program;
  try { program = validateSceneControlProgram(controlProgram); }
  catch (error) { throw buildError(error.errorCode || 'runtime_control_invalid', 'Invalid bounded runtime control program.'); }
  const stat = await fs.lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw buildError('build_output_invalid', 'Control replay requires an owned generated directory.');
  const scene = JSON.parse(await readBuildFile(path.join(directory, 'scene.json'), 4 * 1024 * 1024, signal));
  if (scene.schemaVersion !== undefined && scene.schemaVersion !== 2 || await fs.access(path.join(directory, 'behaviors.json')).then(() => true, error => {
    if (error.code === 'ENOENT') return false; throw error;
  })) throw buildError('runtime_control_unsupported', 'Control replay currently supports scene plans 1 and 2.');
  if (!Array.isArray(scene.actors) || scene.actors.length * program.steps.length > 1024) throw buildError('runtime_control_limit', 'Runtime control actor-step budget exceeded.');
  if (program.schemaVersion === 2) {
    try {
      validateSceneControlPlan({ format: 'viento-build-plan', kind: 'scene2d', schemaVersion: scene.schemaVersion ?? 1,
        scene: { objectId: scene.objectId, sourcePath: 'scene.json' }, actors: scene.actors }, program);
    } catch (error) { throw buildError(error.errorCode || 'runtime_control_invalid', error.message); }
  }
  const files = [
    ['control-runtime.gd', await fs.readFile(new URL('./godot4/control-runtime.gd', import.meta.url))],
    ['control.tscn', await fs.readFile(new URL('./godot4/control.tscn', import.meta.url))],
    ['control-program.json', Buffer.from(JSON.stringify(program) + '\n')],
  ];
  const staged = [];
  try {
    for (const [file, bytes] of files) {
      const target = path.join(directory, file);
      await fs.writeFile(target, bytes, { flag: 'wx', mode: 0o600 }); staged.push(target);
    }
    return await runBuildProcess(tool.executable, ['--path', directory, '--headless', 'res://control.tscn', '--', '--viento-smoke'], options);
  } finally {
    for (const target of staged) await fs.rm(target, { force: true });
  }
}

async function cleanupProject(directory) {
  if (!absolute(directory)) throw buildError('build_output_invalid', 'Cleanup requires an absolute generated-project directory.');
  const stat = await fs.lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw buildError('build_output_invalid', 'Cleanup requires a generated-project directory, not a link.');
  // rm removes a cache symlink itself, never the directory it points at.
  for (const name of ['.godot', '.host']) await fs.rm(path.join(directory, name), { recursive: true, force: true });
}

export const GODOT4_EXECUTION_ADAPTER = Object.freeze({
  descriptor, contractVersion: 1, acceptsLegacyBuildRecords: true, buildPhases, runtimePhases,
  availability, identify: identifyGodot, generate, fingerprint, executePhase,
  diagnostics: (result, plan) => (plan.schemaVersion === 3 ? godotBehaviorDiagnostics : godotDiagnostics)(result, plan),
  createEventReader: (plan, options) => (plan.schemaVersion === 3 ? createBehaviorRuntimeEventReader : createRuntimeEventReader)(plan, options), cleanupProject,
});
