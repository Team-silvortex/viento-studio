import './adapters/node-studio-core.mjs';
import { open } from 'node:fs/promises';
import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { expandSceneComposition, MAX_SCENE_COMPOSITION_BYTES } from '../engine/scene-composition.mjs';
import { inspectSceneComposition, validateSceneCompositionDependencies } from '../engine/scene-composition-document.mjs';
import { readWorldSnapshot } from './adapters/node-world-projection.mjs';

const fail = (errorCode, message) => Object.assign(new Error(message), { errorCode });
const usage = 'Use --input <recipe.json> or --root <workspace> --object <UUID> [--revision sha256:...], optionally --emit scene|bundle.';
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);

async function readRecipeFile(input) {
  // A bounded descriptor read avoids trusting an earlier stat while another
  // process grows the file. Nonblocking open also prevents waiting on a FIFO.
  let file, bytes;
  try {
    file = await open(input, constants.O_RDONLY | constants.O_NONBLOCK);
    const before = await file.stat();
    if (!before.isFile()) throw fail('scene_composition_input', 'The composition input must be a regular file.');
    if (before.size > MAX_SCENE_COMPOSITION_BYTES) throw fail('scene_composition_limit', 'Scene composition source exceeds 128 KiB.');
    const buffer = Buffer.alloc(MAX_SCENE_COMPOSITION_BYTES + 1);
    let total = 0;
    while (total < buffer.length) {
      const { bytesRead } = await file.read(buffer, total, buffer.length - total, null);
      if (!bytesRead) break;
      total += bytesRead;
    }
    if (total > MAX_SCENE_COMPOSITION_BYTES) throw fail('scene_composition_limit', 'Scene composition source exceeds 128 KiB.');
    const after = await file.stat();
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs || total !== after.size) {
      throw fail('scene_composition_input_changed', 'The composition input changed while it was read. Retry with a stable file.');
    }
    bytes = buffer.subarray(0, total);
  } catch (error) {
    if (error.errorCode) throw error;
    throw fail('scene_composition_input', 'The composition input could not be read.');
  } finally { await file?.close(); }
  return bytes;
}

export async function runSceneComposeCommand(argv) {
  let values;
  try {
    ({ values } = parseArgs({ args: argv, strict: true, options: {
      input: { type: 'string' }, root: { type: 'string' }, object: { type: 'string' }, revision: { type: 'string' },
      emit: { type: 'string', default: 'scene' },
    } }));
  } catch { throw fail('scene_composition_arguments', usage); }
  const registered = Object.hasOwn(values, 'root') || Object.hasOwn(values, 'object');
  if (!['scene', 'bundle'].includes(values.emit) || (registered
    ? !values.root || !uuid(values.object) || Object.hasOwn(values, 'input')
      || Object.hasOwn(values, 'revision') && !/^sha256:[a-f0-9]{64}$/.test(values.revision)
    : !values.input || Object.hasOwn(values, 'revision'))) throw fail('scene_composition_arguments', usage);
  if (registered) {
    const { source, projection } = await readWorldSnapshot(path.resolve(values.root));
    const document = source.documents.find(item => item.record?.id === values.object);
    if (!document || !document.sourcePath.toLowerCase().endsWith('.json') || typeof document.content !== 'string') {
      throw fail('scene_composition_document', 'Select an available registered JSON recipe document.');
    }
    if (values.revision !== undefined && values.revision !== document.sourceRevision) {
      throw fail('scene_composition_revision_conflict', 'The recipe changed. Read its current version before expanding again.');
    }
    const checked = inspectSceneComposition(document.content);
    if (!checked.recognized || !checked.ok) throw fail('scene_composition_invalid', 'The registered document is not a valid scene composition recipe.');
    if (validateSceneCompositionDependencies(checked, document.record, source).length) {
      throw fail('scene_composition_dependencies', 'The recipe references unavailable definitions or unregistered images.');
    }
    const composition = expandSceneComposition(document.content);
    if (values.emit === 'scene') return composition.scene;
    return { format: 'viento-scene-composition-result', schemaVersion: 1, sourceRevision: document.sourceRevision,
      origin: { kind: 'registered-document', objectId: document.record.id, sourcePath: document.sourcePath,
        worldId: projection.world.id, worldRevision: projection.world.revision }, ...composition };
  }
  const bytes = await readRecipeFile(values.input);
  let content;
  try { content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { throw fail('scene_composition_invalid', 'The composition input must be valid UTF-8 JSON.'); }
  const composition = expandSceneComposition(content);
  if (values.emit === 'scene') return composition.scene;
  return { format: 'viento-scene-composition-result', schemaVersion: 1,
    sourceRevision: `sha256:${createHash('sha256').update(bytes).digest('hex')}`, ...composition };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runSceneComposeCommand(process.argv.slice(2)).then(value => process.stdout.write(JSON.stringify(value, null, 2) + '\n'))
    .catch(error => { process.stderr.write(JSON.stringify({ errorCode: error.errorCode || 'scene_composition_failed', message: error.message }) + '\n'); process.exitCode = 1; });
}
