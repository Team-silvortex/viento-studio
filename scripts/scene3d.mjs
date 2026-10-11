import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { readScene3DInput, exportScene3DProject, executeScene3DProject } from './adapters/node-scene3d-export.mjs';

export async function runScene3DCommand(argv, { signal } = {}) {
  const { values } = parseArgs({ args: argv, strict: true, options: { input: { type: 'string' }, output: { type: 'string' }, emit: { type: 'string' }, check: { type: 'boolean' }, run: { type: 'boolean' }, 'godot-bin': { type: 'string' } } });
  const invalid = () => { throw Object.assign(new Error('Use --input <source>, optional --emit model|plan, or --output <new-directory> [--check|--run --godot-bin <absolute-file>].'), { errorCode: 'scene3d_request_invalid' }); };
  if (!values.input || values.emit !== undefined && !['model', 'plan'].includes(values.emit) || values.check && values.run) invalid();
  if (!values.output) {
    if (values.check || values.run || values['godot-bin']) invalid();
    const captured = await readScene3DInput(values.input, { signal }); return values.emit === 'model' ? captured.model.model : captured.plan;
  }
  if (values.emit || Boolean(values.check || values.run) !== (values['godot-bin'] !== undefined)) invalid();
  // Path/tool argument admission precedes output mutation or execution.
  if (values['godot-bin'] !== undefined && !path.isAbsolute(values['godot-bin'])) invalid();
  const project = await exportScene3DProject({ input: values.input, output: values.output, signal });
  const execution = values.check || values.run ? await executeScene3DProject(project, { godotBin: values['godot-bin'], run: Boolean(values.run), signal }) : null;
  return { ok: execution?.ok ?? true, project, ...(execution ? { execution } : {}) };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const controller = new AbortController(), abort = () => controller.abort();
  process.on('SIGINT', abort); process.on('SIGTERM', abort);
  try { const result = await runScene3DCommand(process.argv.slice(2), { signal: controller.signal }); console.log(JSON.stringify(result, null, 2)); if (result.ok === false) process.exitCode = 1; }
  catch (error) { console.log(JSON.stringify({ ok: false, errorCode: error.errorCode || error.code || 'scene3d_export_failed', error: error.message, preservedPaths: error.preservedPaths })); process.exitCode = 1; }
  finally { process.off('SIGINT', abort); process.off('SIGTERM', abort); }
}
