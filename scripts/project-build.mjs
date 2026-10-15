import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { captureBuildSnapshot, readBuildFile, buildError } from './adapters/node-build-snapshot.mjs';
import { buildProject, runProjectBuild, readFrozenProjectBuild } from './adapters/node-project-build.mjs';
import { inspectBackendProject } from './adapters/node-backend-project.mjs';
import { executeRuntimeCaseSuite } from './adapters/node-runtime-case-suite.mjs';
import { captureRuntimeCaseSuite } from './lib/runtime-case-suites.mjs';
import { executionHostConfiguration } from './adapters/node-execution-tool.mjs';
import { probeExecutionTool } from './adapters/node-execution-tool-probe.mjs';
import { createExecutionBackendRegistry, DEFAULT_EXECUTION_BACKEND } from './adapters/node-execution-backends.mjs';
import { checkExecutionBackendSupport } from '../engine/backend-capabilities.mjs';
import { validateSceneControlProgram, SCENE_CONTROL_V1_FILE_MAX_BYTES, SCENE_CONTROL_V2_FILE_MAX_BYTES } from '../engine/scene-control-program.mjs';
import { validateRuntimeCase, RUNTIME_CASE_FILE_MAX_BYTES } from '../engine/runtime-verification-case.mjs';
import { inspectRuntimeCaseDocument } from '../engine/runtime-case-document.mjs';

export async function runProjectBuildCommand(argv, { signal } = {}) {
  const { values } = parseArgs({ args: argv, strict: true, options: {
    command: { type: 'string', default: 'plan' }, root: { type: 'string' }, scene: { type: 'string' }, target: { type: 'string' },
    godot: { type: 'string' }, backend: { type: 'string' }, tool: { type: 'string' },
    output: { type: 'string' }, build: { type: 'string' },
    'timeout-ms': { type: 'string' }, window: { type: 'boolean' },
    interactive: { type: 'boolean' }, capture: { type: 'boolean' },
    'control-program': { type: 'string' },
    'runtime-case': { type: 'string' },
    'runtime-suite': { type: 'string' },
  } });
  if (!['plan', 'build', 'run', 'inspect', 'tool-check'].includes(values.command)) throw new Error('Use --command plan, build, run, inspect or tool-check.');
  if (values.command === 'inspect') {
    if (!values.build || Object.keys(values).some(key => !['command', 'build', 'backend'].includes(key))) {
      throw buildError('build_request_invalid', 'Inspection accepts only --build and an optional --backend; it reads frozen output without a tool or author workspace.');
    }
    return { ok: true, ...await inspectBackendProject({ buildDirectory: path.resolve(values.build),
      ...(values.backend !== undefined ? { backendId: values.backend } : {}), signal }) };
  }
  const checkingTool = values.command === 'tool-check';
  const timeoutMs = Number(values['timeout-ms'] ?? (checkingTool ? '12000' : '30000'));
  const maxTimeout = checkingTool ? 12000 : 3600000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > maxTimeout) throw new Error(`Timeout must be 1–${maxTimeout} milliseconds.`);
  const hostEnvironment = { ...process.env }, requestedTool = values.tool ?? values.godot;
  const configuration = executionHostConfiguration({ env: hostEnvironment, backendId: values.backend, tool: requestedTool });
  if (values.godot !== undefined && (values.tool !== undefined || configuration.backendId !== DEFAULT_EXECUTION_BACKEND)) {
    throw new Error('--godot is the Godot-only legacy alias; use --backend <id> --tool <path> for the selected backend.');
  }
  if (checkingTool) {
    if (['root', 'scene', 'target', 'output', 'build', 'window', 'interactive', 'capture', 'control-program', 'runtime-case', 'runtime-suite'].some(key => values[key] !== undefined)) {
      throw buildError('build_request_invalid', 'Tool checks accept only the host backend, tool and bounded timeout; omit project and execution inputs.');
    }
    const adapter = createExecutionBackendRegistry().resolve(configuration.backendId);
    const { toolStatus } = await probeExecutionTool(adapter, { toolPath: configuration.tool, signal, timeoutMs });
    return { ok: toolStatus.status === 'ready', toolStatus };
  }
  const explicitBackend = values.backend !== undefined || hostEnvironment.VIENTO_EXECUTION_BACKEND !== undefined;
  const frozenConfiguration = frozen => {
    const selected = executionHostConfiguration({ env: hostEnvironment, backendId: frozen.build.backend.id, tool: requestedTool });
    if (values.godot !== undefined && selected.backendId !== DEFAULT_EXECUTION_BACKEND) {
      throw new Error('--godot is the Godot-only legacy alias; use --backend <id> --tool <path> for the selected backend.');
    }
    return selected;
  };
  // Decide the mode before opening either input file or the frozen build.
  if(values['runtime-suite']!==undefined) {
    if(values.command!=='run'||values['runtime-case']!==undefined||values['control-program']!==undefined
      ||values.window||values.interactive||values.capture||!values.root||!values.build||values.scene||values.target||values.output) {
      throw buildError('runtime_suite_unsupported','Suite runs require --root, --build and a registered --runtime-suite UUID or project-relative document path.');
    }
    if(timeoutMs>30000)throw buildError('runtime_suite_limit','Each suite member is limited to 30 seconds.');
    const backendRegistry=createExecutionBackendRegistry();
    const frozen=await readFrozenProjectBuild(values.build,{...(explicitBackend?{backendId:configuration.backendId}:{}),backendRegistry,signal});
    const selected=frozenConfiguration(frozen);
    if (frozen.plan.kind === 'project') throw buildError('runtime_case_unsupported', 'Runtime case suites require a single scene build.');
    const capture=await captureRuntimeCaseSuite(values.root,{documentRef:values['runtime-suite'],plan:frozen.plan,signal});
    return executeRuntimeCaseSuite({capture,plan:frozen.plan,authorRoot:values.root,buildDirectory:frozen.buildDirectory,
      buildId:frozen.build.buildId,snapshotId:frozen.build.snapshotId,tool:selected.tool,backendId:selected.backendId,
      backendRegistry,signal,caseTimeoutMs:timeoutMs});
  }
  if (values['runtime-case'] !== undefined && (values['control-program'] !== undefined
    || values.command !== 'run' || values.window || values.interactive || values.capture)) {
    throw buildError('runtime_case_unsupported', 'Runtime cases require a finite headless run and cannot be combined with a control-program input.');
  }
  let runtimeCase, runtimeCaseSceneId;
  if (values['runtime-case'] !== undefined) {
    try {
      const bytes = await readBuildFile(path.resolve(values['runtime-case']), RUNTIME_CASE_FILE_MAX_BYTES, signal);
      const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
      const document = inspectRuntimeCaseDocument(text);
      if (document.recognized) {
        if (!document.ok) throw buildError(document.diagnostics[0]?.code || 'runtime_case_document_invalid', 'Invalid saved runtime case document.');
        runtimeCase = document.value.case; runtimeCaseSceneId = document.value.sceneObjectId;
      } else runtimeCase = validateRuntimeCase(JSON.parse(text));
    } catch (error) {
      signal?.throwIfAborted();
      throw buildError(error.errorCode || 'runtime_case_invalid', 'Select a valid bounded JSON runtime case.');
    }
  }
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
    if (!values.build || values.root || values.scene || values.target || values.output) throw new Error('Run requires --build <directory>; it runs frozen output without reopening source.');
    const backendRegistry = createExecutionBackendRegistry();
    let frozen;
    try {
      frozen = await readFrozenProjectBuild(values.build, { ...(explicitBackend ? { backendId: configuration.backendId } : {}), backendRegistry, signal });
    } catch (error) {
      // Keep the ordinary run's result/diagnostic contract when its frozen
      // input is missing or invalid. Admission errors above still reject.
      return { ok: false, status: signal?.aborted ? 'cancelled' : 'failed', diagnostics: [{ severity: 'error',
        code: signal?.aborted ? 'runtime_cancelled' : error.errorCode || 'build_failed',
        message: signal?.aborted ? 'Runtime cancelled.' : error.errorCode ? error.message : 'Build operation failed.',
        objectId: null, sourcePath: '', propertyPath: '' }] };
    }
    const selected = frozenConfiguration(frozen);
    return runProjectBuild({ buildDirectory: frozen.buildDirectory, ...selected, backendRegistry,
      expectedBuildId: frozen.build.buildId, expectedSnapshotId: frozen.build.snapshotId,
      ...(controlProgram ? { controlProgram } : {}),
      ...(runtimeCase ? { runtimeCase } : {}),
      ...(runtimeCaseSceneId ? { runtimeCaseSceneId } : {}),
      signal, timeoutMs, headless: !values.window, smoke: !values.interactive, capture: Boolean(values.capture) });
  }
  if (!values.root || Boolean(values.scene) === Boolean(values.target) || values.build || values.window || values.interactive || values.capture) throw new Error('Plan/build require --root <workspace> and either --target <document UUID or source path> or legacy --scene.');
  if (values.command === 'build') return buildProject({ root: values.root, targetId: values.target ?? values.scene, ...configuration, output: values.output, signal, timeoutMs });
  if (values.output) throw new Error('Plan does not write output; omit --output.');
  const captured = await captureBuildSnapshot(values.root, values.target ?? values.scene, { signal });
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
