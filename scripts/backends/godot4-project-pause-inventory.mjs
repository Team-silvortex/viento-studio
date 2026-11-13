// Authenticate the optional outer pause layer before any retained settings are
// read. Neither its manifest nor a caller selects additional source paths.
import fs from 'node:fs/promises';
import path from 'node:path';
import { buildError, readBuildFile } from '../adapters/node-build-snapshot.mjs';
import { resolveContainedPath } from '../lib/contained-path.mjs';
import { validateGodotProjectMenuInventory } from './godot4-project-menu-inventory.mjs';
import { pauseInventoryName, pauseOriginalSettingsName, pauseOriginalClockSettingsName, pauseProjectScript, pauseInputScript,
  pauseProjectScene, pauseSourceURL, pauseInputSourceURL, pauseInnerEntry, pauseSettings, pauseProjectSource, pauseInputSource,
  pauseProjectMain, pauseInventory, restartInventoryName, restartProjectScript, restartProjectMain } from './godot4-project-pause-projection.mjs';
const invalid = () => { throw buildError('build_project_pause_inventory_invalid', 'Invalid generated project pause inventory.'); };
const autoload = '\n[autoload]\n\nVientoExecutionClock="*res://execution-clock-host.gd"\n';
export async function validateGodotProjectPauseInventory(directory, signal) {
  const read = async (name, maximum = 65536) => readBuildFile(await resolveContainedPath(directory, path.join(directory, name)), maximum, signal);
  const optional = async name => { try { return await read(name); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } };
  try {
    signal?.throwIfAborted();
    const menu = await validateGodotProjectMenuInventory(directory, signal);
    const manifest = await optional(pauseInventoryName), owned = [];
    for (const row of await fs.readdir(directory, { withFileTypes: true })) if (row.name.startsWith('project-pause')) {
      if (!row.isFile()) invalid(); owned.push(row.name);
    }
    if (manifest === null) {
      if (menu !== null || owned.length || (await optional('project.godot'))?.includes(`res://${pauseProjectScene}`)) invalid();
      return null;
    }
    const [original, clock, outerActual, outerActualClock, script, inputScript, main, template, inputTemplate, restartManifest] = await Promise.all([
      read(pauseOriginalSettingsName), optional(pauseOriginalClockSettingsName), read('project.godot'), optional('execution-clock-original.godot'),
      read(pauseProjectScript), read(pauseInputScript), read(pauseProjectScene), fs.readFile(pauseSourceURL), fs.readFile(pauseInputSourceURL), optional(restartInventoryName),
    ]);
    const actual = menu ? menu.innerSettings : outerActual, actualClock = menu ? menu.innerClockSettings : outerActualClock;
    const entry = pauseInnerEntry(original);
    if (restartManifest === null || !(await read(entry)).equals(restartProjectMain())) invalid();
    await read(restartProjectScript);
    if (!manifest.equals(pauseInventory(original, clock)) || !actual.equals(pauseSettings(original))
      || !script.equals(pauseProjectSource(template)) || !inputScript.equals(pauseInputSource(inputTemplate))
      || !main.equals(pauseProjectMain()) || (clock === null) !== (actualClock === null)) invalid();
    if (clock !== null && (!original.toString().endsWith(autoload)
      || !clock.equals(original.subarray(0, original.length - Buffer.byteLength(autoload))) || !actualClock.equals(pauseSettings(clock)))) invalid();
    const expected = [pauseInventoryName, pauseOriginalSettingsName, pauseProjectScript, pauseInputScript, pauseProjectScene];
    if (clock !== null) expected.push(pauseOriginalClockSettingsName);
    const retained = [];
    for (const name of owned) {
      if ([`${pauseProjectScript}.uid`, `${pauseInputScript}.uid`].includes(name)) { if (!/^uid:\/\/[a-z0-9]+\r?\n?$/.test((await read(name, 128)).toString())) invalid(); }
      else retained.push(name);
    }
    if (JSON.stringify(retained.sort()) !== JSON.stringify(expected.sort())) invalid();
    return { scripts: [pauseProjectScript, pauseInputScript, ...(menu?.scripts || [])], innerSettings: original, innerClockSettings: clock };
  } catch (error) { if (error?.name === 'AbortError' || signal?.aborted) throw error; invalid(); }
}
