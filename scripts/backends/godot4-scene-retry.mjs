import fs from 'node:fs/promises';
import { buildError, buildHash } from '../adapters/node-build-snapshot.mjs';
import { SCENE_RETRY_CAPABILITY, retryInventoryName, retryOriginalSettingsName, retryOriginalClockSettingsName,
  retryProjectScript, retryProjectScene, retrySourceURL, retryInnerEntry, retrySettings, retryProjectHost,
  retryProjectSource, retryProjectMain, retryInventory } from './godot4-scene-retry-projection.mjs';
export { SCENE_RETRY_CAPABILITY };
const invalid = () => { throw buildError('build_scene_retry_inventory_invalid', 'Invalid generated scene retry project.'); };
export async function applyGodotSceneRetryProject(generated) {
  const original = generated.files.get('project.godot'), clock = generated.files.get('execution-clock-original.godot') || null;
  if (!Buffer.isBuffer(original) || clock !== null && !Buffer.isBuffer(clock) || !generated.files.has('assembly.json') || !generated.files.has('execution-budget.json')) invalid();
  const entry = retryInnerEntry(original), main = generated.files.get(entry);
  if (!Buffer.isBuffer(main)) invalid();
  const host = retryProjectHost(main); if (!generated.files.has(host)) invalid();
  const template = await fs.readFile(retrySourceURL), settings = retrySettings(original), clockSettings = clock === null ? null : retrySettings(clock);
  const files = [[retryInventoryName, retryInventory(original, clock, entry, host)], [retryOriginalSettingsName, original],
    ...(clock === null ? [] : [[retryOriginalClockSettingsName, clock]]),
    [retryProjectScript, retryProjectSource(template, host)], [retryProjectScene, retryProjectMain()]];
  for (const [name] of files) if (generated.files.has(name)) invalid();
  for (const [name, bytes] of files) generated.files.set(name, bytes);
  generated.files.set('project.godot', settings); if (clockSettings !== null) generated.files.set('execution-clock-original.godot', clockSettings);
  generated.backend = { ...generated.backend, version: '0.46.0', capabilities: [...new Set([...generated.backend.capabilities, SCENE_RETRY_CAPABILITY])],
    sha256: buildHash(Buffer.concat([Buffer.from(generated.backend.sha256), settings, ...files.map(([, bytes]) => bytes),
      ...await Promise.all(['', '-projection', '-inventory'].map(suffix => fs.readFile(new URL(`./godot4-scene-retry${suffix}.mjs`, import.meta.url))))])) };
  return generated;
}
