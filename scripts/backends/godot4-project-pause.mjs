import fs from 'node:fs/promises';
import { buildError, buildHash } from '../adapters/node-build-snapshot.mjs';
import { PROJECT_PAUSE_CAPABILITY, pauseInventoryName, pauseOriginalSettingsName, pauseOriginalClockSettingsName,
  pauseProjectScript, pauseInputScript, pauseProjectScene, pauseSourceURL, pauseInputSourceURL, pauseInnerEntry, pauseSettings,
  pauseProjectSource, pauseInputSource, pauseProjectMain, pauseInventory, restartInventoryName, restartProjectScript, restartProjectMain } from './godot4-project-pause-projection.mjs';
export { PROJECT_PAUSE_CAPABILITY };
const invalid = () => { throw buildError('build_project_pause_inventory_invalid', 'Invalid generated project pause project.'); };
export async function applyGodotProjectPause(generated) {
  const original = generated.files.get('project.godot'), clock = generated.files.get('execution-clock-original.godot') || null;
  if (!Buffer.isBuffer(original) || clock !== null && !Buffer.isBuffer(clock) || !generated.files.has('assembly.json')
    || !generated.files.has('execution-budget.json') || !Buffer.isBuffer(generated.files.get(restartInventoryName))
    || !Buffer.isBuffer(generated.files.get(restartProjectScript))) invalid();
  const entry = pauseInnerEntry(original), main = generated.files.get(entry);
  if (!Buffer.isBuffer(main) || !main.equals(restartProjectMain())) invalid();
  const [template, inputTemplate] = await Promise.all([fs.readFile(pauseSourceURL), fs.readFile(pauseInputSourceURL)]);
  const settings = pauseSettings(original), clockSettings = clock === null ? null : pauseSettings(clock);
  const files = [[pauseInventoryName, pauseInventory(original, clock)], [pauseOriginalSettingsName, original],
    ...(clock === null ? [] : [[pauseOriginalClockSettingsName, clock]]),
    [pauseProjectScript, pauseProjectSource(template)], [pauseInputScript, pauseInputSource(inputTemplate)], [pauseProjectScene, pauseProjectMain()]];
  for (const [name] of files) if (generated.files.has(name)) invalid();
  const sources = await Promise.all(['', '-projection', '-inventory'].map(suffix => fs.readFile(new URL(`./godot4-project-pause${suffix}.mjs`, import.meta.url))));
  for (const [name, bytes] of files) generated.files.set(name, bytes);
  generated.files.set('project.godot', settings); if (clockSettings !== null) generated.files.set('execution-clock-original.godot', clockSettings);
  generated.backend = { ...generated.backend, version: '0.48.0', capabilities: [...new Set([...generated.backend.capabilities, PROJECT_PAUSE_CAPABILITY])],
    sha256: buildHash(Buffer.concat([Buffer.from(generated.backend.sha256), settings, ...files.map(([, bytes]) => bytes), ...sources])) };
  return generated;
}
