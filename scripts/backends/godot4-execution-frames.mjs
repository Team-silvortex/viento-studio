// Exact business-frame metadata wraps the frozen coordinator print sites. It
// neither schedules work nor changes any business protocol or admission quota.
import fs from 'node:fs/promises';
import path from 'node:path';
import { generateGodotExecutionClockProject, godotExecutionClockAssemblyScripts } from './godot4-execution-clock.mjs';
import { godotExecutionBudgetRuntimeBytes, copyGodotAnimationOriginals, copyGodotAudioOriginal } from './godot4-execution-budget.mjs';
import { buildHash, buildError, readBuildFile } from '../adapters/node-build-snapshot.mjs';
import { resolveContainedPath } from '../lib/contained-path.mjs';

export const GODOT_EXECUTION_FRAMES_CAPABILITY = 'runtime.execution-frames';
const helperName = 'execution-frame-emitter.gd', sidecar = 'execution-frames.json';
const print = 'print("VIENTO_PROJECT:" + JSON.stringify(data, "", true, true))';
const emit = `preload("res://${helperName}").emit_frame(data)`;
const allNames = ['project-runtime.gd', 'project-control-runtime.gd', 'project-clip-runtime.gd',
  'project-completion-runtime.gd', 'project-animation-state-runtime.gd',
  'project-animation-state-entry-runtime.gd', 'project-animation-state-trigger-runtime.gd', 'project-animation-target-runtime.gd'];
const sourceURL = name => new URL(`./godot4/${name}`, import.meta.url);
const backupName = name => `execution-frames-original-${name}.txt`;
const invalid = () => { throw buildError('build_execution_frames_invalid', 'Invalid generated execution frame inventory.'); };
const namesFor = schema => {
  if (![5, 6, 7, 8, 9, 10, 11, 12].includes(schema)) invalid();
  return allNames.slice(0, schema - 4);
};
function transform(original) {
  const source = original.toString();
  if (source.split(print).length !== 2 || source.includes('execution-frame') || source.includes('VIENTO_EXECUTION_FRAME:')) invalid();
  return Buffer.from(source.replace(print, emit));
}
async function expectedScripts(schema) {
  return Promise.all(namesFor(schema).map(async name => {
    const original = name === 'project-runtime.gd' ? await godotExecutionBudgetRuntimeBytes() : await fs.readFile(sourceURL(name));
    return { name, original, changed: transform(original) };
  }));
}
function document(rows, helper) {
  return Buffer.from(JSON.stringify({ format: 'viento-godot-execution-frames', schemaVersion: 1,
    protocolVersion: 1, scope: 'session', clock: 'godot-engine-frames',
    helper: { path: helperName, sha256: buildHash(helper) },
    scripts: rows.map(({ name, original, changed }) => ({ path: name, original: backupName(name),
      sha256: buildHash(changed), originalSha256: buildHash(original) })) }, null, 2) + '\n');
}
export async function generateGodotExecutionFramesProject(input) {
  const generated = await generateGodotExecutionClockProject(input);
  const schema = JSON.parse(generated.files.get('assembly.json')).schemaVersion;
  const rows = await expectedScripts(schema), helper = await fs.readFile(sourceURL(helperName));
  for (const name of [sidecar, helperName, ...allNames.map(backupName)]) if (generated.files.has(name)) invalid();
  for (const { name, original, changed } of rows) {
    if (!generated.files.get(name)?.equals(original)) invalid();
    generated.files.set(backupName(name), original);
    generated.files.set(name, changed);
  }
  const inventory = document(rows, helper);
  generated.files.set(helperName, helper); generated.files.set(sidecar, inventory);
  generated.backend = { ...generated.backend, version: '0.34.0',
    capabilities: [...generated.backend.capabilities, GODOT_EXECUTION_FRAMES_CAPABILITY],
    sha256: buildHash(Buffer.concat([Buffer.from(generated.backend.sha256),
      await fs.readFile(new URL('./godot4-execution-frames.mjs', import.meta.url)), helper, inventory,
      ...rows.flatMap(({ original, changed }) => [original, changed])])) };
  return generated;
}

// The fixed inventory never supplies paths to the reader. Validate transformed
// files and frozen originals before forwarding one trusted, in-memory override.
export async function godotExecutionFramesAssemblyScripts(directory, signal, animationOriginals, originalProjectAudio) {
  let animations, audio;
  try { animations = copyGodotAnimationOriginals(animationOriginals); audio = copyGodotAudioOriginal(originalProjectAudio); } catch { invalid(); }
  const read = async (name, limit = 65536) => readBuildFile(await resolveContainedPath(directory, path.join(directory, name)), limit, signal);
  const optional = async name => { try { return await read(name); } catch (error) { if (error.code === 'ENOENT') return null; invalid(); } };
  try {
    signal?.throwIfAborted();
    const reserved = new Set([sidecar, ...allNames.map(backupName)]);
    if ((await fs.readdir(directory)).some(name => name.startsWith('execution-frames') && !reserved.has(name))) invalid();
    const inventory = await optional(sidecar), helper = await optional(helperName);
    const contents = new Map(await Promise.all(allNames.map(async name => [name, await optional(name)])));
    const originals = new Map(await Promise.all(allNames.map(async name => [name, await optional(backupName(name))])));
    if (inventory === null) {
      if (animations !== undefined || audio !== undefined) invalid();
      if (helper !== null || [...originals.values()].some(bytes => bytes !== null)
        || [...contents.values()].some(bytes => bytes?.includes('execution-frame') || bytes?.includes('VIENTO_EXECUTION_FRAME:'))) invalid();
      return await godotExecutionClockAssemblyScripts(directory, signal);
    }
    const assembly = JSON.parse(await read('assembly.json', 4 * 1024 * 1024));
    const rows = await expectedScripts(assembly.schemaVersion), expectedHelper = await fs.readFile(sourceURL(helperName));
    if (helper === null || !helper.equals(expectedHelper) || !inventory.equals(document(rows, expectedHelper))) invalid();
    const expected = new Map(rows.map(row => [row.name, row]));
    for (const name of allNames) {
      const row = expected.get(name), actual = contents.get(name), original = originals.get(name);
      if (row ? actual === null || original === null || !actual.equals(row.changed) || !original.equals(row.original)
        : actual !== null || original !== null) invalid();
    }
    // Frame envelopes always extend a clock-enabled project. Legacy projects
    // without this sidecar remain readable only through the absence branch.
    await read('execution-clock.json');
    const previous = await godotExecutionClockAssemblyScripts(directory, signal, originals.get('project-runtime.gd'), animations, audio);
    if (!previous) invalid();
    return [...previous, helperName];
  } catch (error) { if (error?.name === 'AbortError' || signal?.aborted) throw error; invalid(); }
}
