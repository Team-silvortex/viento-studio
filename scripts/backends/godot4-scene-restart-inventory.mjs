// Authenticate this fixed outer layer before the retry reader consumes its
// retained settings. No caller supplies an override or a manifest-selected path.
import fs from 'node:fs/promises';
import path from 'node:path';
import { buildError, readBuildFile } from '../adapters/node-build-snapshot.mjs';
import { validateGodotProjectPauseInventory } from './godot4-project-pause-inventory.mjs';
import { resolveContainedPath } from '../lib/contained-path.mjs';
import { restartInventoryName, restartOriginalSettingsName, restartOriginalClockSettingsName, restartProjectScript, restartProjectScene,
  restartSourceURL, restartInnerEntry, restartSettings, restartProjectSource, restartProjectMain, restartInventory,
  retryInventoryName, retryProjectScript, retryProjectMain } from './godot4-scene-restart-projection.mjs';
const invalid = () => { throw buildError('build_scene_restart_inventory_invalid', 'Invalid generated scene restart inventory.'); };
const autoload = '\n[autoload]\n\nVientoExecutionClock="*res://execution-clock-host.gd"\n';
export async function validateGodotSceneRestartInventory(directory, signal) {
  const read = async (name, maximum = 65536) => readBuildFile(await resolveContainedPath(directory, path.join(directory, name)), maximum, signal);
  const optional = async name => { try { return await read(name); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } };
  try {
    signal?.throwIfAborted();
    const pause = await validateGodotProjectPauseInventory(directory, signal);
    const manifest = await optional(restartInventoryName), owned = [];
    for (const row of await fs.readdir(directory, { withFileTypes: true })) if (row.name.startsWith('restart-')) {
      if (!row.isFile()) invalid(); owned.push(row.name);
    }
    if (manifest === null) {
      if (pause !== null || owned.length || (await optional('project.godot'))?.includes('res://restart-project.tscn')) invalid();
      return null;
    }
    const [original, clock, outerActual, outerActualClock, script, main, template, retryManifest] = await Promise.all([
      read(restartOriginalSettingsName), optional(restartOriginalClockSettingsName), read('project.godot'), optional('execution-clock-original.godot'),
      read(restartProjectScript), read(restartProjectScene), fs.readFile(restartSourceURL), optional(retryInventoryName),
    ]);
    const actual = pause ? pause.innerSettings : outerActual, actualClock = pause ? pause.innerClockSettings : outerActualClock;
    const entry = restartInnerEntry(original);
    if (retryManifest === null || !(await read(entry)).equals(retryProjectMain())) invalid();
    await read(retryProjectScript);
    if (!manifest.equals(restartInventory(original, clock)) || !actual.equals(restartSettings(original))
      || !script.equals(restartProjectSource(template)) || !main.equals(restartProjectMain()) || (clock === null) !== (actualClock === null)) invalid();
    if (clock !== null && (!original.toString().endsWith(autoload)
      || !clock.equals(original.subarray(0, original.length - Buffer.byteLength(autoload))) || !actualClock.equals(restartSettings(clock)))) invalid();
    const expected = [restartInventoryName, restartOriginalSettingsName, restartProjectScript, restartProjectScene];
    if (clock !== null) expected.push(restartOriginalClockSettingsName);
    const retained = [];
    for (const name of owned) {
      if (name === `${restartProjectScript}.uid`) { if (!/^uid:\/\/[a-z0-9]+\r?\n?$/.test((await read(name, 128)).toString())) invalid(); }
      else retained.push(name);
    }
    if (JSON.stringify(retained.sort()) !== JSON.stringify(expected.sort())) invalid();
    return { scripts: [restartProjectScript, ...(pause?.scripts || [])], innerSettings: original, innerClockSettings: clock };
  } catch (error) { if (error?.name === 'AbortError' || signal?.aborted) throw error; invalid(); }
}
