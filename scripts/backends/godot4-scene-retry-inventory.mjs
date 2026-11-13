// Authenticate the fixed outer retry files before any inner settings reader
// consumes their retained bytes. No manifest field supplies a caller path.
import fs from 'node:fs/promises';
import path from 'node:path';
import { buildError, readBuildFile } from '../adapters/node-build-snapshot.mjs';
import { resolveContainedPath } from '../lib/contained-path.mjs';
import { retryInventoryName, retryOriginalSettingsName, retryOriginalClockSettingsName, retryProjectScript, retryProjectScene,
  retrySourceURL, retryInnerEntry, retrySettings, retryProjectHost, retryProjectSource, retryProjectMain, retryInventory } from './godot4-scene-retry-projection.mjs';
const invalid = () => { throw buildError('build_scene_retry_inventory_invalid', 'Invalid generated scene retry inventory.'); };
const autoload = '\n[autoload]\n\nVientoExecutionClock="*res://execution-clock-host.gd"\n';
export async function validateGodotSceneRetryInventory(directory, signal) {
  const read = async (name, maximum = 65536) => readBuildFile(await resolveContainedPath(directory, path.join(directory, name)), maximum, signal);
  const optional = async name => { try { return await read(name); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } };
  try {
    signal?.throwIfAborted();
    const manifest = await optional(retryInventoryName), owned = [];
    for (const row of await fs.readdir(directory, { withFileTypes: true })) if (row.name.startsWith('retry-')) {
      if (!row.isFile()) invalid(); owned.push(row.name);
    }
    if (manifest === null) {
      if (owned.length || (await optional('project.godot'))?.includes('res://retry-project.tscn')) invalid();
      return null;
    }
    const [original, clock, actual, actualClock, script, main, template] = await Promise.all([
      read(retryOriginalSettingsName), optional(retryOriginalClockSettingsName), read('project.godot'), optional('execution-clock-original.godot'),
      read(retryProjectScript), read(retryProjectScene), fs.readFile(retrySourceURL),
    ]);
    const entry = retryInnerEntry(original), host = retryProjectHost(await read(entry)); await read(host);
    if (!manifest.equals(retryInventory(original, clock, entry, host)) || !actual.equals(retrySettings(original))
      || !script.equals(retryProjectSource(template, host)) || !main.equals(retryProjectMain()) || (clock === null) !== (actualClock === null)) invalid();
    if (clock !== null && (!original.toString().endsWith(autoload)
      || !clock.equals(original.subarray(0, original.length - Buffer.byteLength(autoload))) || !actualClock.equals(retrySettings(clock)))) invalid();
    const expected = [retryInventoryName, retryOriginalSettingsName, retryProjectScript, retryProjectScene];
    if (clock !== null) expected.push(retryOriginalClockSettingsName);
    const retained = [];
    for (const name of owned) {
      if (name === `${retryProjectScript}.uid`) { if (!/^uid:\/\/[a-z0-9]+\r?\n?$/.test((await read(name, 128)).toString())) invalid(); }
      else retained.push(name);
    }
    if (JSON.stringify(retained.sort()) !== JSON.stringify(expected.sort())) invalid();
    return { scripts: [retryProjectScript], innerSettings: original, innerClockSettings: clock };
  } catch (error) { if (error?.name === 'AbortError' || signal?.aborted) throw error; invalid(); }
}
