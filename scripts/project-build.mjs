import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { captureBuildSnapshot } from './adapters/node-build-snapshot.mjs';
import { buildProject, runProjectBuild } from './adapters/node-project-build.mjs';

export async function runProjectBuildCommand(argv, { signal } = {}) {
  const { values } = parseArgs({ args: argv, strict: true, options: {
    command: { type: 'string', default: 'plan' }, root: { type: 'string' }, scene: { type: 'string' },
    godot: { type: 'string' }, output: { type: 'string' }, build: { type: 'string' },
    'timeout-ms': { type: 'string', default: '30000' }, window: { type: 'boolean' },
    interactive: { type: 'boolean' }, capture: { type: 'boolean' },
  } });
  if (!['plan', 'build', 'run'].includes(values.command)) throw new Error('Use --command plan, build or run.');
  const timeoutMs = Number(values['timeout-ms']);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 3600000) throw new Error('Timeout must be 1–3600000 milliseconds.');
  const godot = values.godot || process.env.VIENTO_GODOT_BIN;
  if (values.command === 'run') {
    if (!values.build || values.root || values.scene || values.output) throw new Error('Run requires --build <directory>; it runs frozen output without reopening source.');
    return runProjectBuild({ buildDirectory: values.build, godot, signal, timeoutMs, headless: !values.window, smoke: !values.interactive, capture: Boolean(values.capture) });
  }
  if (!values.root || !values.scene || values.build || values.window || values.interactive || values.capture) throw new Error('Plan/build require --root <workspace> --scene <document UUID or source path>.');
  if (values.command === 'build') return buildProject({ root: values.root, scene: values.scene, godot, output: values.output, signal, timeoutMs });
  if (values.output) throw new Error('Plan does not write output; omit --output.');
  const captured = await captureBuildSnapshot(values.root, values.scene, { signal });
  return { ok: captured.ok, plan: captured.plan, snapshotId: captured.snapshotId, diagnostics: captured.diagnostics };
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
