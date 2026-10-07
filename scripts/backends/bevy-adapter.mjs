// Bevy owns its tool identity and CLI here. The shared executor keeps ownership
// of inventories, source/resource fences, cancellation and persisted records.
import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { validateExecutionBackendDescriptor, checkExecutionBackendSupport } from '../../engine/backend-capabilities.mjs';
import { createSceneRuntimeEventReader } from '../../engine/scene-runtime-events.mjs';
import { validateSceneControlProgram, validateSceneControlPlan } from '../../engine/scene-control-program.mjs';
import { buildError, buildHash, readBuildFile } from '../adapters/node-build-snapshot.mjs';
import { runBuildProcess } from '../lib/build-process.mjs';
import { generateBevyProject, BEVY_RUNTIME_IDENTITY } from './bevy-project.mjs';

const descriptor = validateExecutionBackendDescriptor({
  format: 'viento-execution-backend', schemaVersion: 1, id: 'org.viento.bevy', label: 'Bevy', version: '0.3.0', platforms: ['linux'],
  plans: [{ kind: 'scene2d', schemaVersion: 1, runtimeProtocolVersion: 1 }, { kind: 'scene2d', schemaVersion: 2, runtimeProtocolVersion: 2 }],
  capabilities: ['scene2d', 'input.arrows', 'state.movement', 'runtime.control-replay', 'runtime.control-replay.instances'],
  execution: { build: true, headlessLogic: true, windowPreview: false, windowCapture: false, offscreenRender: false, embeddedViewport: false, gpuCompute: false }, extensions: [],
});
const absolute = value => typeof value === 'string' && path.isAbsolute(value) && !value.includes('\0');
const support = request => {
  const diagnostics = checkExecutionBackendSupport(descriptor, request);
  if (diagnostics.length) throw buildError(diagnostics[0].code, diagnostics[0].message, { diagnostics });
};
async function availability({ toolPath, enabled = true, platform = process.platform } = {}) {
  if (!enabled || !descriptor.platforms.includes(platform)) return { supported: false, available: false, reason: 'platform_unsupported' };
  const missing = { supported: true, available: false, reason: 'tool_missing' };
  if (!absolute(toolPath)) return missing;
  try {
    const stat = await fs.stat(toolPath); await fs.access(toolPath, constants.X_OK);
    return { supported: true, available: stat.isFile(), reason: stat.isFile() ? null : 'tool_missing' };
  } catch { return missing; }
}
async function identify(executable, { signal } = {}) {
  support({ operation: 'build', platform: process.platform });
  if (!absolute(executable)) throw buildError('build_tool_required', 'Provide an absolute Viento Bevy runtime executable.');
  let binary, bytes;
  try { binary = await fs.realpath(executable); bytes = await readBuildFile(binary, 512 * 1024 * 1024, signal); }
  catch { signal?.throwIfAborted(); throw buildError('build_tool_unavailable', 'Cannot read the selected Bevy runtime executable.'); }
  const probe = await runBuildProcess(binary, ['--version'], { cwd: path.dirname(binary), timeoutMs: 10000, signal });
  if (probe.status !== 'succeeded') throw buildError(`build_tool_${probe.status}`, 'Cannot query the Bevy runtime identity.', { processResult: probe });
  if (probe.stdout.trim() !== BEVY_RUNTIME_IDENTITY || probe.stderr.trim()) throw buildError('build_tool_version', 'Use the pinned Viento Bevy runtime 0.3.0 built with Bevy 0.19.1.');
  return { executable: binary, version: BEVY_RUNTIME_IDENTITY, sha256: buildHash(bytes), platform: process.platform, arch: process.arch };
}
async function generate(plan) {
  support({ operation: 'build', plan });
  return generateBevyProject(structuredClone(plan));
}
async function fingerprint() {
  const paths = ['scripts/backends/bevy-adapter.mjs', 'scripts/backends/bevy-project.mjs', 'engine/scene-runtime-events.mjs',
    'engine/scene-control-program.mjs', 'engine/build-plan.mjs', 'engine/backend-capabilities.mjs', 'scripts/adapters/node-execution-backends.mjs'];
  const identities = await Promise.all(paths.map(async file => ({ path: file, sha256: buildHash(await fs.readFile(new URL(`../../${file}`, import.meta.url))) })));
  return { id: descriptor.id, contractVersion: 1, sha256: buildHash(JSON.stringify(identities)) };
}
async function executePhase({ phase, tool, directory, signal, timeoutMs = 30000, onOutput, mode = 'headlessLogic', smoke = true, capturePath, controlProgram } = {}) {
  if (!['scene-check', 'run'].includes(phase)) throw buildError('build_execution_unsupported', 'Bevy does not support this execution phase.');
  if (controlProgram !== undefined && (phase !== 'run' || mode !== 'headlessLogic' || !smoke)) {
    throw buildError('runtime_control_unsupported', 'Control replay requires a headless smoke run.');
  }
  if (capturePath !== undefined) throw buildError('runtime_capture_mode', 'The headless Bevy backend cannot capture a preview.');
  if (phase === 'run' && mode !== 'headlessLogic') throw buildError('build_execution_unsupported', 'Bevy supports headless logic only.');
  support({ operation: phase === 'run' ? mode : 'build', platform: process.platform });
  if (typeof smoke !== 'boolean') throw buildError('runtime_mode_invalid', 'Select a boolean smoke-run option.');
  if (!absolute(tool?.executable)) throw buildError('build_tool_required', 'Provide an identified absolute Bevy runtime executable path.');
  if (!absolute(directory)) throw buildError('build_output_invalid', 'Execute Bevy only in an absolute generated-project directory.');
  let program;
  if (controlProgram !== undefined) {
    if (phase !== 'run' || mode !== 'headlessLogic' || !smoke) throw buildError('runtime_control_unsupported', 'Control replay requires a headless smoke run.');
    try { program = validateSceneControlProgram(controlProgram); }
    catch (error) { throw buildError(error.errorCode || 'runtime_control_invalid', 'Invalid bounded runtime control program.'); }
  }
  const controlPath = path.join(directory, 'control-program.json');
  let staged = false;
  const args = ['--scene', path.join(directory, 'scene-data.json'), ...(phase === 'scene-check' ? ['--check'] : smoke ? ['--smoke'] : []),
    ...(program ? ['--control-program', controlPath] : [])];
  try {
    if (program) {
      const stat = await fs.lstat(directory);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw buildError('build_output_invalid', 'Control replay requires an owned generated directory.');
      const scene = JSON.parse(await readBuildFile(path.join(directory, 'scene-data.json'), 4 * 1024 * 1024, signal));
      if (![1, 2].includes(scene.schemaVersion)) throw buildError('runtime_control_unsupported', 'Control replay currently supports scene plans 1 and 2.');
      if (!Array.isArray(scene.actors) || scene.actors.length * program.steps.length > 1024) throw buildError('runtime_control_limit', 'Runtime control actor-step budget exceeded.');
      if (program.schemaVersion === 2) {
        try {
          validateSceneControlPlan({ format: 'viento-build-plan', kind: 'scene2d', schemaVersion: scene.schemaVersion,
            scene: { objectId: scene.scene?.objectId, sourcePath: 'scene-data.json' }, actors: scene.actors }, program);
        } catch (error) { throw buildError(error.errorCode || 'runtime_control_invalid', error.message); }
      }
      await fs.writeFile(controlPath, JSON.stringify(program) + '\n', { flag: 'wx', mode: 0o600 }); staged = true;
    }
    const result = await runBuildProcess(tool.executable, args, { cwd: directory, signal, timeoutMs, onOutput,
      env: { ...process.env, XDG_DATA_HOME: path.join(directory, '.host/data'),
        XDG_CONFIG_HOME: path.join(directory, '.host/config'), XDG_CACHE_HOME: path.join(directory, '.host/cache') } });
    return { ...result, phase };
  } finally {
    if (staged) await fs.rm(controlPath, { force: true });
  }
}
function diagnostics(result, plan) {
  const reader = createSceneRuntimeEventReader(plan);
  if (result.phase !== 'run') reader.push(result.stdout);
  const reported = reader.finish().diagnostics;
  if (result.status !== 'succeeded') reported.push({ severity: 'error', code: `build_process_${result.status.replaceAll('-', '_')}`,
    message: `Bevy runtime process ${result.status}.`, objectId: plan.scene.objectId, sourcePath: plan.scene.sourcePath, propertyPath: '' });
  return reported;
}
async function cleanupProject(directory) {
  if (!absolute(directory)) throw buildError('build_output_invalid', 'Cleanup requires an absolute generated-project directory.');
  const stat = await fs.lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw buildError('build_output_invalid', 'Cleanup requires a generated-project directory, not a link.');
  await fs.rm(path.join(directory, '.host'), { recursive: true, force: true });
}
export const BEVY_EXECUTION_ADAPTER = Object.freeze({ descriptor, contractVersion: 1, acceptsLegacyBuildRecords: false,
  buildPhases: Object.freeze(['scene-check']), runtimePhases: Object.freeze([]), availability, identify, generate, fingerprint,
  executePhase, diagnostics, createEventReader: createSceneRuntimeEventReader, cleanupProject });
