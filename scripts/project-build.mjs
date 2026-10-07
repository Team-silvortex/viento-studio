import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { captureBuildSnapshot, readBuildFile, buildError } from './adapters/node-build-snapshot.mjs';
import { buildProject, runProjectBuild } from './adapters/node-project-build.mjs';
import { executionHostConfiguration } from './adapters/node-execution-tool.mjs';
import { createExecutionBackendRegistry, DEFAULT_EXECUTION_BACKEND } from './adapters/node-execution-backends.mjs';
import { checkExecutionBackendSupport } from '../engine/backend-capabilities.mjs';
import { validateSceneControlProgram, SCENE_CONTROL_V1_FILE_MAX_BYTES, SCENE_CONTROL_V2_FILE_MAX_BYTES } from '../engine/scene-control-program.mjs';

export async function runProjectBuildCommand(argv, { signal } = {}) {
  const { values } = parseArgs({ args: argv, strict: true, options: {
    command: { type: 'string', default: 'plan' }, root: { type: 'string' }, scene: { type: 'string' },
    godot: { type: 'string' }, backend: { type: 'string' }, tool: { type: 'string' },
    output: { type: 'string' }, build: { type: 'string' },
    'timeout-ms': { type: 'string', default: '30000' }, window: { type: 'boolean' },
    interactive: { type: 'boolean' }, capture: { type: 'boolean' },
    'control-program': { type: 'string' },
  } });
  if (!['plan', 'build', 'run'].includes(values.command)) throw new Error('Use --command plan, build or run.');
  const timeoutMs = Number(values['timeout-ms']);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 3600000) throw new Error('Timeout must be 1–3600000 milliseconds.');
  const configuration = executionHostConfiguration({ backendId: values.backend, tool: values.tool ?? values.godot });
  if (values.godot !== undefined && (values.tool !== undefined || configuration.backendId !== DEFAULT_EXECUTION_BACKEND)) {
    throw new Error('--godot is the Godot-only legacy alias; use --backend <id> --tool <path> for the selected backend.');
  }
  const explicitBackend = values.backend !== undefined || process.env.VIENTO_EXECUTION_BACKEND !== undefined;
  let controlProgram;
  if (values['control-program'] !== undefined) {
    if (values.command !== 'run' || values.window || values.interactive || values.capture) {
      throw buildError('runtime_control_unsupported', 'Control replay requires a headless finite run.');
    }
    try {
      const bytes = await readBuildFile(path.resolve(values['control-program']), SCENE_CONTROL_V2_FILE_MAX_BYTES, signal);
      controlProgram = validateSceneControlProgram(JSON.parse(bytes.toString('utf8')));
      if (controlProgram.schemaVersion === 1 && bytes.length > SCENE_CONTROL_V1_FILE_MAX_BYTES) {
        throw buildError('build_input_limit', 'Global control programs are limited to 16 KiB.');
      }
    } catch (error) {
      signal?.throwIfAborted();
      throw buildError(error.errorCode || 'runtime_control_invalid', 'Select a valid bounded JSON control program.');
    }
  }
  if (values.command === 'run') {
    if (!values.build || values.root || values.scene || values.output) throw new Error('Run requires --build <directory>; it runs frozen output without reopening source.');
    return runProjectBuild({ buildDirectory: values.build, tool: configuration.tool,
      ...(explicitBackend ? { backendId: configuration.backendId } : {}),
      ...(controlProgram ? { controlProgram } : {}),
      signal, timeoutMs, headless: !values.window, smoke: !values.interactive, capture: Boolean(values.capture) });
  }
  if (!values.root || !values.scene || values.build || values.window || values.interactive || values.capture) throw new Error('Plan/build require --root <workspace> --scene <document UUID or source path>.');
  if (values.command === 'build') return buildProject({ root: values.root, scene: values.scene, ...configuration, output: values.output, signal, timeoutMs });
  if (values.output) throw new Error('Plan does not write output; omit --output.');
  const captured = await captureBuildSnapshot(values.root, values.scene, { signal });
  const diagnostics = captured.ok && explicitBackend ? checkExecutionBackendSupport(
    createExecutionBackendRegistry().resolve(configuration.backendId).descriptor,
    { operation: 'build', platform: process.platform, plan: captured.plan }) : captured.diagnostics;
  return { ok: captured.ok && !diagnostics.length, plan: captured.plan, snapshotId: captured.snapshotId, diagnostics };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  process.on('SIGINT', cancel); process.on('SIGTERM', cancel);
  try {
    const result = await runProjectBuildCommand(process.argv.slice(2), { signal: controller.signal });
    console.log(JSON.stringify(result, null, 2)); if (!result.ok) process.exitCode = 1;
  } catch (error) {
    console.log(JSON.stringify({ ok: false, status: controller.signal.aborted ? 'cancelled' : 'failed', error: error.message, errorCode: error.errorCode || 'build_request_invalid' }));
    process.exitCode = 1;
  } finally { process.off('SIGINT', cancel); process.off('SIGTERM', cancel); }
}
