import fs from 'node:fs/promises';
import { buildError, buildHash } from '../adapters/node-build-snapshot.mjs';
import { SCENE_RESTART_CAPABILITY, restartInventoryName, restartOriginalSettingsName, restartOriginalClockSettingsName,
  restartProjectScript, restartProjectScene, restartSourceURL, restartInnerEntry, restartSettings, restartProjectSource,
  restartProjectMain, restartInventory, retryInventoryName, retryProjectScript, retryProjectMain } from './godot4-scene-restart-projection.mjs';
export { SCENE_RESTART_CAPABILITY };
const invalid = () => { throw buildError('build_scene_restart_inventory_invalid', 'Invalid generated scene restart project.'); };
export async function applyGodotSceneRestartProject(generated) {
  const original = generated.files.get('project.godot'), clock = generated.files.get('execution-clock-original.godot') || null;
  if (!Buffer.isBuffer(original) || clock !== null && !Buffer.isBuffer(clock) || !generated.files.has('assembly.json')
    || !generated.files.has('execution-budget.json') || !Buffer.isBuffer(generated.files.get(retryInventoryName))
    || !Buffer.isBuffer(generated.files.get(retryProjectScript))) invalid();
  const entry = restartInnerEntry(original), main = generated.files.get(entry);
  if (!Buffer.isBuffer(main) || !main.equals(retryProjectMain())) invalid();
  const template = await fs.readFile(restartSourceURL), settings = restartSettings(original), clockSettings = clock === null ? null : restartSettings(clock);
  const files = [[restartInventoryName, restartInventory(original, clock)], [restartOriginalSettingsName, original],
    ...(clock === null ? [] : [[restartOriginalClockSettingsName, clock]]),
    [restartProjectScript, restartProjectSource(template)], [restartProjectScene, restartProjectMain()]];
  for (const [name] of files) if (generated.files.has(name)) invalid();
  const sources = await Promise.all(['', '-projection', '-inventory'].map(suffix => fs.readFile(new URL(`./godot4-scene-restart${suffix}.mjs`, import.meta.url))));
  for (const [name, bytes] of files) generated.files.set(name, bytes);
  generated.files.set('project.godot', settings); if (clockSettings !== null) generated.files.set('execution-clock-original.godot', clockSettings);
  generated.backend = { ...generated.backend, version: '0.47.0', capabilities: [...new Set([...generated.backend.capabilities, SCENE_RESTART_CAPABILITY])],
    sha256: buildHash(Buffer.concat([Buffer.from(generated.backend.sha256), settings, ...files.map(([, bytes]) => bytes), ...sources])) };
  return generated;
}
