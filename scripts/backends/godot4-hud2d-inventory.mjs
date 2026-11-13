// This fully authenticates the optional outer settings before any camera layer
// consumes the retained inner view. Callers cannot supply a settings override.
import fs from 'node:fs/promises';
import path from 'node:path';
import { validateGodotSceneRetryInventory } from './godot4-scene-retry-inventory.mjs';
import { validateSceneHUD2DDocument } from '../../engine/scene-hud2d.mjs';
import { buildError, readBuildFile } from '../adapters/node-build-snapshot.mjs';
import { resolveContainedPath } from '../lib/contained-path.mjs';
import { hudInventoryName, hudOriginalSettingsName, hudOriginalClockSettingsName, hudProjectScript, hudSceneScript, hudProjectScene,
  hudSourceURL, hudDocumentPath, hudJson, hudInnerEntry, hudSettings, hudProjectHost, hudProjectMain, hudProjectSource, hudInventory } from './godot4-hud2d-projection.mjs';
const invalid = () => { throw buildError('build_hud2d_inventory_invalid', 'Invalid generated HUD2D inventory.'); };
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const autoload = '\n[autoload]\n\nVientoExecutionClock="*res://execution-clock-host.gd"\n';
async function ownedFiles(directory, active) {
  const read = async name => { try { return await fs.readdir(name, { withFileTypes: true }); } catch (error) { if (error.code === 'ENOENT') return []; throw error; } };
  const result = [];
  for (const row of await read(directory)) if (row.name.startsWith('hud2d')) { if (!row.isFile()) invalid(); result.push(row.name); }
  const scenes = path.join(directory, 'scenes'), stat = await fs.lstat(scenes).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
  if (stat === null) return result.sort(); if (!stat.isDirectory() || stat.isSymbolicLink()) invalid();
  const members = await read(scenes); if (members.length > 256) invalid();
  for (const member of members) {
    if (active && member.isSymbolicLink()) invalid(); if (!member.isDirectory()) continue;
    const children = await read(path.join(scenes, member.name)); if (children.length > 256) invalid();
    for (const row of children) if (row.name.startsWith('hud2d')) { if (!row.isFile()) invalid(); result.push(`scenes/${member.name}/${row.name}`); }
  }
  return result.sort();
}
export async function validateGodotHUD2DInventory(directory, signal) {
  const read = async (name, maximum = 65536) => readBuildFile(await resolveContainedPath(directory, path.join(directory, name)), maximum, signal);
  const optional = async name => { try { return await read(name); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } };
  try {
    signal?.throwIfAborted();
    const manifestBytes = await optional(hudInventoryName), owned = await ownedFiles(directory, manifestBytes !== null);
    if (manifestBytes === null) { if (owned.length) invalid(); return null; }
    const manifest = JSON.parse(manifestBytes), assembly = JSON.parse(await read('assembly.json', 4 * 1024 * 1024));
    if (!exact(manifest, ['format', 'schemaVersion', 'sceneIds']) || manifest.format !== 'viento-godot-hud2d-project' || manifest.schemaVersion !== 1
      || !Array.isArray(manifest.sceneIds) || !manifest.sceneIds.length || manifest.sceneIds.length > 32 || manifest.sceneIds.some(id => !uuid(id))
      || new Set(manifest.sceneIds).size !== manifest.sceneIds.length || !manifestBytes.equals(hudInventory(manifest.sceneIds)) || !Array.isArray(assembly.scenes)) invalid();
    const ids = new Set(manifest.sceneIds), selected = assembly.scenes.filter(scene => ids.has(scene.sceneId));
    if (selected.length !== ids.size || selected.some((scene, index) => scene.sceneId !== manifest.sceneIds[index])) invalid();
    const retry = await validateGodotSceneRetryInventory(directory, signal);
    const [original, actualEntry, originalClock, actualClockEntry, sceneSource, projectSource, sceneScript, projectScript, main] = await Promise.all([
      read(hudOriginalSettingsName), read('project.godot'), optional(hudOriginalClockSettingsName), optional('execution-clock-original.godot'),
      fs.readFile(hudSourceURL('scene')), fs.readFile(hudSourceURL('project')), read(hudSceneScript), read(hudProjectScript), read(hudProjectScene),
    ]);
    const actual = retry ? retry.innerSettings : actualEntry, actualClock = retry ? retry.innerClockSettings : actualClockEntry;
    const host = hudProjectHost(await read(hudInnerEntry(original)));
    await read(host);
    if (!actual.equals(hudSettings(original)) || !sceneScript.equals(sceneSource) || !projectScript.equals(hudProjectSource(projectSource, host, manifest.sceneIds)) || !main.equals(hudProjectMain())) invalid();
    if ((originalClock === null) !== (actualClock === null)) invalid();
    if (originalClock !== null && (!original.toString().endsWith(autoload) || !originalClock.equals(original.subarray(0, original.length - Buffer.byteLength(autoload))) || !actualClock.equals(hudSettings(originalClock)))) invalid();
    const expected = [hudInventoryName, hudOriginalSettingsName, hudSceneScript, hudProjectScript, hudProjectScene];
    if (originalClock !== null) expected.push(hudOriginalClockSettingsName);
    for (const { sceneId } of selected) {
      const bytes = await read(hudDocumentPath(sceneId)), document = validateSceneHUD2DDocument(JSON.parse(bytes));
      if (document.sceneObjectId !== sceneId || !bytes.equals(hudJson(document))) invalid(); expected.push(hudDocumentPath(sceneId));
    }
    const scripts = [hudSceneScript, hudProjectScript], retained = [];
    for (const name of owned) {
      if (name.endsWith('.gd.uid') && scripts.includes(name.slice(0, -4))) { if (!/^uid:\/\/[a-z0-9]+\r?\n?$/.test((await read(name, 128)).toString())) invalid(); }
      else retained.push(name);
    }
    if (JSON.stringify(retained) !== JSON.stringify(expected.sort())) invalid();
    // Buffers are detached owned reads, returned only after full layer admission.
    return { sceneIds: manifest.sceneIds, scripts, innerSettings: original, innerClockSettings: originalClock };
  } catch (error) { if (error?.name === 'AbortError' || signal?.aborted) throw error; invalid(); }
}
