// Independent scheduling observation wraps the frozen finite-budget project.
// It never resets admission, edits old GDScript or changes the project wire.
import fs from 'node:fs/promises';
import path from 'node:path';
import { generateGodotExecutionBudgetProject, godotExecutionBudgetAssemblyScripts, copyGodotAnimationOriginals, copyGodotAudioOriginal } from './godot4-execution-budget.mjs';
import { buildHash, buildError, readBuildFile } from '../adapters/node-build-snapshot.mjs';
import { resolveContainedPath } from '../lib/contained-path.mjs';

export const GODOT_EXECUTION_CLOCK_CAPABILITY = 'runtime.execution-clock';
const sources = ['execution-clock-host.gd', 'execution-clock-budget.gd'];
const sidecar = 'execution-clock.json', backup = 'execution-clock-original.godot';
const sourceURL = name => new URL(`./godot4/${name}`, import.meta.url);
const autoload = '\n[autoload]\n\nVientoExecutionClock="*res://execution-clock-host.gd"\n';
const manifest = () => Buffer.from(JSON.stringify({ format: 'viento-godot-execution-clock', schemaVersion: 1,
  policyVersion: 1, clock: 'godot-engine-frames', retainedWindows: 32, original: backup, scripts: sources }, null, 2) + '\n');
const invalid = () => { throw buildError('build_execution_clock_invalid', 'Invalid generated execution clock inventory.'); };
const install = original => {
  if (!original || /\[autoload\]|VientoExecutionClock|execution-clock/.test(original.toString())) invalid();
  return Buffer.concat([original, Buffer.from(autoload)]);
};

export async function generateGodotExecutionClockProject(input) {
  const generated = await generateGodotExecutionBudgetProject(input);
  const original = generated.files.get('project.godot'), settings = install(original);
  const scripts = await Promise.all(sources.map(async name => [name, await fs.readFile(sourceURL(name))]));
  for (const name of [sidecar, backup, ...sources]) if (generated.files.has(name)) invalid();
  generated.files.set(backup, original); generated.files.set('project.godot', settings);
  generated.files.set(sidecar, manifest());
  for (const [name, bytes] of scripts) generated.files.set(name, bytes);
  generated.backend = { ...generated.backend, version: '0.33.0',
    capabilities: [...generated.backend.capabilities, GODOT_EXECUTION_CLOCK_CAPABILITY],
    sha256: buildHash(Buffer.concat([Buffer.from(generated.backend.sha256),
      await fs.readFile(new URL('./godot4-execution-clock.mjs', import.meta.url)), settings, manifest(), ...scripts.map(([, bytes]) => bytes)])) };
  return generated;
}

export async function godotExecutionClockAssemblyScripts(directory, signal, originalProjectRuntime, animationOriginals, originalProjectAudio) {
  if (originalProjectRuntime !== undefined && !Buffer.isBuffer(originalProjectRuntime)) invalid();
  const originalRuntime = originalProjectRuntime === undefined ? undefined : Buffer.from(originalProjectRuntime);
  let animations, audio;
  try { animations = copyGodotAnimationOriginals(animationOriginals); audio = copyGodotAudioOriginal(originalProjectAudio); } catch { invalid(); }
  const read = async (name, limit = 65536) => readBuildFile(await resolveContainedPath(directory, path.join(directory, name)), limit, signal);
  const optional = async name => { try { return await read(name); } catch (error) { if (error.code === 'ENOENT') return null; invalid(); } };
  try {
    const inventory = await optional(sidecar), original = await optional(backup), entry = await optional('project.godot');
    const scripts = await Promise.all(sources.map(async name => [name, await optional(name)]));
    if (inventory === null) {
      if (originalRuntime !== undefined || animations !== undefined || audio !== undefined) invalid();
      if (original !== null || scripts.some(([, bytes]) => bytes !== null) || entry?.includes('execution-clock') || entry?.includes('VientoExecutionClock')) invalid();
      return await godotExecutionBudgetAssemblyScripts(directory, signal, originalRuntime, animations, audio);
    }
    if (!inventory.equals(manifest()) || original === null || entry === null || !entry.equals(install(original))) invalid();
    for (const [name, bytes] of scripts) if (bytes === null || !bytes.equals(await fs.readFile(sourceURL(name)))) invalid();
    const previous = await godotExecutionBudgetAssemblyScripts(directory, signal, originalRuntime, animations, audio);
    if (!previous) invalid();
    return [...previous, ...sources];
  } catch (error) { if (error?.name === 'AbortError' || signal?.aborted) throw error; invalid(); }
}
