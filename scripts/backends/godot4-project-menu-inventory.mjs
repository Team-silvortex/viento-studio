// Authenticate the optional outer menu layer before any retained settings are
// read. Neither its manifest nor a caller selects additional source paths.
import fs from 'node:fs/promises';
import path from 'node:path';
import { buildError, readBuildFile } from '../adapters/node-build-snapshot.mjs';
import { resolveContainedPath } from '../lib/contained-path.mjs';
import { menuInventoryName, menuOriginalSettingsName, menuOriginalClockSettingsName, menuProjectScript, menuInputScript,
  menuProjectScene, menuSourceURL, menuInputSourceURL, menuInnerEntry, menuSettings, menuProjectSource, menuInputSource,
  menuProjectMain, menuInventory, pauseInventoryName, pauseProjectScript, pauseProjectMain } from './godot4-project-menu-projection.mjs';
const invalid = () => { throw buildError('build_project_menu_inventory_invalid', 'Invalid generated project menu inventory.'); };
const autoload = '\n[autoload]\n\nVientoExecutionClock="*res://execution-clock-host.gd"\n';
export async function validateGodotProjectMenuInventory(directory, signal) {
  const read = async (name, maximum = 65536) => readBuildFile(await resolveContainedPath(directory, path.join(directory, name)), maximum, signal);
  const optional = async name => { try { return await read(name); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } };
  try {
    signal?.throwIfAborted();
    const manifest = await optional(menuInventoryName), owned = [];
    for (const row of await fs.readdir(directory, { withFileTypes: true })) if (row.name.startsWith('project-menu')) {
      if (!row.isFile()) invalid(); owned.push(row.name);
    }
    if (manifest === null) {
      if (owned.length || (await optional('project.godot'))?.includes(`res://${menuProjectScene}`)) invalid();
      return null;
    }
    const [original, clock, actual, actualClock, script, inputScript, main, template, inputTemplate, pauseManifest] = await Promise.all([
      read(menuOriginalSettingsName), optional(menuOriginalClockSettingsName), read('project.godot'), optional('execution-clock-original.godot'),
      read(menuProjectScript), read(menuInputScript), read(menuProjectScene), fs.readFile(menuSourceURL), fs.readFile(menuInputSourceURL), optional(pauseInventoryName),
    ]);
    const entry = menuInnerEntry(original);
    if (pauseManifest === null || !(await read(entry)).equals(pauseProjectMain())) invalid();
    await read(pauseProjectScript);
    if (!manifest.equals(menuInventory(original, clock)) || !actual.equals(menuSettings(original))
      || !script.equals(menuProjectSource(template)) || !inputScript.equals(menuInputSource(inputTemplate))
      || !main.equals(menuProjectMain()) || (clock === null) !== (actualClock === null)) invalid();
    if (clock !== null && (!original.toString().endsWith(autoload)
      || !clock.equals(original.subarray(0, original.length - Buffer.byteLength(autoload))) || !actualClock.equals(menuSettings(clock)))) invalid();
    const expected = [menuInventoryName, menuOriginalSettingsName, menuProjectScript, menuInputScript, menuProjectScene];
    if (clock !== null) expected.push(menuOriginalClockSettingsName);
    const retained = [];
    for (const name of owned) {
      if ([`${menuProjectScript}.uid`, `${menuInputScript}.uid`].includes(name)) { if (!/^uid:\/\/[a-z0-9]+\r?\n?$/.test((await read(name, 128)).toString())) invalid(); }
      else retained.push(name);
    }
    if (JSON.stringify(retained.sort()) !== JSON.stringify(expected.sort())) invalid();
    return { scripts: [menuProjectScript, menuInputScript], innerSettings: original, innerClockSettings: clock };
  } catch (error) { if (error?.name === 'AbortError' || signal?.aborted) throw error; invalid(); }
}
