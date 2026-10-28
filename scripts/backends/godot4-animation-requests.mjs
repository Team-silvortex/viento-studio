// Observe the accepted queue lifecycle around its existing commit points.
// Frozen runtimes, successful business frames and finite budgets stay intact.
import fs from 'node:fs/promises';
import path from 'node:path';
import { generateGodotExecutionFramesProject, godotExecutionFramesAssemblyScripts } from './godot4-execution-frames.mjs';
import { godotExecutionBudgetAnimationBytes, copyGodotAudioOriginal } from './godot4-execution-budget.mjs';
import { buildHash, buildError, readBuildFile } from '../adapters/node-build-snapshot.mjs';
import { resolveContainedPath } from '../lib/contained-path.mjs';

export const GODOT_ANIMATION_REQUESTS_CAPABILITY = 'runtime.animation-requests';
const helperName = 'animation-request-emitter.gd', sidecar = 'animation-requests.json';
const allNames = ['project-animation.gd', 'project-animation-targets.gd'];
const sourceURL = name => new URL(`./godot4/${name}`, import.meta.url);
const backupName = name => `animation-requests-original-${name}.txt`;
const invalid = () => { throw buildError('build_animation_requests_invalid', 'Invalid generated animation request inventory.'); };
const once = (source, before, after) => {
  if (source.split(before).length !== 2) invalid();
  return source.replace(before, after);
};
function transform(original) {
  let source = original.toString();
  if (source.includes('animation-request') || source.includes('VIENTO_ANIMATION_REQUEST:') || source.includes('"requestId"')) invalid();
  source = once(source, '\tqueue.push_back({"visitIndex":', '\tqueue.push_back({"requestId": reserved_count, "visitIndex":');
  source = once(source, '\towner.schedule_flush()\n', `\tpreload("res://${helperName}").emit_accepted(queue.back())\n\towner.schedule_flush()\n`);
  source = once(source, '\t\tqueue.pop_front()\n', `\t\tpreload("res://${helperName}").emit_applied(request, sequence)\n\t\tqueue.pop_front()\n`);
  source = once(source, '\tqueue.clear()\n', `\twhile not queue.is_empty():\n\t\tpreload("res://${helperName}").emit_discarded(queue[0])\n\t\tqueue.pop_front()\n`);
  return Buffer.from(source);
}
async function expectedScripts(schema) {
  return [...await godotExecutionBudgetAnimationBytes(schema)].map(([name, original]) => ({ name, original, changed: transform(original) }));
}
function document(rows, helper) {
  return Buffer.from(JSON.stringify({ format: 'viento-godot-animation-requests', schemaVersion: 1,
    protocolVersion: 1, scope: 'session', clock: 'godot-engine-frames',
    helper: { path: helperName, sha256: buildHash(helper) },
    scripts: rows.map(({ name, original, changed }) => ({ path: name, original: backupName(name),
      sha256: buildHash(changed), originalSha256: buildHash(original) })) }, null, 2) + '\n');
}
export async function generateGodotAnimationRequestsProject(input) {
  const generated = await generateGodotExecutionFramesProject(input);
  if (!generated.files.has('project-animation.gd')) return generated;
  const schema = JSON.parse(generated.files.get('assembly.json')).schemaVersion;
  const rows = await expectedScripts(schema), helper = await fs.readFile(sourceURL(helperName));
  if (!rows.length) invalid();
  for (const name of [sidecar, helperName, ...allNames.map(backupName)]) if (generated.files.has(name)) invalid();
  for (const { name, original, changed } of rows) {
    if (!generated.files.get(name)?.equals(original)) invalid();
    generated.files.set(backupName(name), original); generated.files.set(name, changed);
  }
  const inventory = document(rows, helper);
  generated.files.set(helperName, helper); generated.files.set(sidecar, inventory);
  generated.backend = { ...generated.backend, version: '0.35.0',
    capabilities: [...generated.backend.capabilities, GODOT_ANIMATION_REQUESTS_CAPABILITY],
    sha256: buildHash(Buffer.concat([Buffer.from(generated.backend.sha256),
      await fs.readFile(new URL('./godot4-animation-requests.mjs', import.meta.url)), helper, inventory,
      ...rows.flatMap(({ original, changed }) => [original, changed])])) };
  return generated;
}

// Read only fixed names; author paths cannot select helpers or original bytes.
// The previous readers receive copied originals after both versions match the
// frozen template and exact transform, and still inspect real on-disk files.
export async function godotAnimationRequestsAssemblyScripts(directory, signal, originalProjectAudio) {
  let audio;
  try { audio = copyGodotAudioOriginal(originalProjectAudio); } catch { invalid(); }
  const read = async (name, limit = 65536) => readBuildFile(await resolveContainedPath(directory, path.join(directory, name)), limit, signal);
  const optional = async name => { try { return await read(name); } catch (error) { if (error.code === 'ENOENT') return null; invalid(); } };
  try {
    signal?.throwIfAborted();
    const reserved = new Set([sidecar, ...allNames.map(backupName)]);
    if ((await fs.readdir(directory)).some(name => name.startsWith('animation-requests') && !reserved.has(name))) invalid();
    const inventory = await optional(sidecar), helper = await optional(helperName);
    const contents = new Map(await Promise.all(allNames.map(async name => [name, await optional(name)])));
    const originals = new Map(await Promise.all(allNames.map(async name => [name, await optional(backupName(name))])));
    if (inventory === null) {
      if (helper !== null || [...originals.values()].some(bytes => bytes !== null)
        || [...contents.values()].some(bytes => bytes?.includes('animation-request') || bytes?.includes('VIENTO_ANIMATION_REQUEST:') || bytes?.includes('"requestId"'))) invalid();
      return await godotExecutionFramesAssemblyScripts(directory, signal, undefined, audio);
    }
    const assembly = JSON.parse(await read('assembly.json', 4 * 1024 * 1024));
    const rows = await expectedScripts(assembly.schemaVersion), expectedHelper = await fs.readFile(sourceURL(helperName));
    if (!rows.length || helper === null || !helper.equals(expectedHelper) || !inventory.equals(document(rows, expectedHelper))) invalid();
    const expected = new Map(rows.map(row => [row.name, row]));
    for (const name of allNames) {
      const row = expected.get(name), actual = contents.get(name), original = originals.get(name);
      if (row ? actual === null || original === null || !actual.equals(row.changed) || !original.equals(row.original)
        : actual !== null || original !== null) invalid();
    }
    const overrides = new Map(rows.map(({ name }) => [name, originals.get(name)]));
    const previous = await godotExecutionFramesAssemblyScripts(directory, signal, overrides, audio);
    if (!previous) invalid();
    return [...previous, helperName];
  } catch (error) { if (error?.name === 'AbortError' || signal?.aborted) throw error; invalid(); }
}
