import fs from 'node:fs/promises';
import { buildError, buildHash } from '../adapters/node-build-snapshot.mjs';
import { PROJECT_MENU_CAPABILITY, menuInventoryName, menuOriginalSettingsName, menuOriginalClockSettingsName,
  menuProjectScript, menuInputScript, menuProjectScene, menuSourceURL, menuInputSourceURL, menuInnerEntry, menuSettings,
  menuProjectSource, menuInputSource, menuProjectMain, menuInventory, pauseInventoryName, pauseProjectScript, pauseProjectMain } from './godot4-project-menu-projection.mjs';
export { PROJECT_MENU_CAPABILITY };
const invalid = () => { throw buildError('build_project_menu_inventory_invalid', 'Invalid generated project menu project.'); };
export async function applyGodotProjectMenu(generated) {
  const original = generated.files.get('project.godot'), clock = generated.files.get('execution-clock-original.godot') || null;
  if (!Buffer.isBuffer(original) || clock !== null && !Buffer.isBuffer(clock) || !generated.files.has('assembly.json')
    || !generated.files.has('execution-budget.json') || !Buffer.isBuffer(generated.files.get(pauseInventoryName))
    || !Buffer.isBuffer(generated.files.get(pauseProjectScript))) invalid();
  const entry = menuInnerEntry(original), main = generated.files.get(entry);
  if (!Buffer.isBuffer(main) || !main.equals(pauseProjectMain())) invalid();
  const [template, inputTemplate] = await Promise.all([fs.readFile(menuSourceURL), fs.readFile(menuInputSourceURL)]);
  const settings = menuSettings(original), clockSettings = clock === null ? null : menuSettings(clock);
  const files = [[menuInventoryName, menuInventory(original, clock)], [menuOriginalSettingsName, original],
    ...(clock === null ? [] : [[menuOriginalClockSettingsName, clock]]),
    [menuProjectScript, menuProjectSource(template)], [menuInputScript, menuInputSource(inputTemplate)], [menuProjectScene, menuProjectMain()]];
  for (const [name] of files) if (generated.files.has(name)) invalid();
  const sources = await Promise.all(['', '-projection', '-inventory'].map(suffix => fs.readFile(new URL(`./godot4-project-menu${suffix}.mjs`, import.meta.url))));
  for (const [name, bytes] of files) generated.files.set(name, bytes);
  generated.files.set('project.godot', settings); if (clockSettings !== null) generated.files.set('execution-clock-original.godot', clockSettings);
  generated.backend = { ...generated.backend, version: '0.49.0', capabilities: [...new Set([...generated.backend.capabilities, PROJECT_MENU_CAPABILITY])],
    sha256: buildHash(Buffer.concat([Buffer.from(generated.backend.sha256), settings, ...files.map(([, bytes]) => bytes), ...sources])) };
  return generated;
}
