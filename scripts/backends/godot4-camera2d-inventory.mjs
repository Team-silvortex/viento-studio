// Authenticate only this optional view layer. Old inventories continue reading
// the unchanged original main scenes, project manifest and runtime scripts.
import fs from 'node:fs/promises';
import path from 'node:path';
import { validateSceneCamera2DDocument } from '../../engine/scene-camera2d.mjs';
import { buildError, readBuildFile } from '../adapters/node-build-snapshot.mjs';
import { resolveContainedPath } from '../lib/contained-path.mjs';
import { validateGodotSceneRetryInventory } from './godot4-scene-retry-inventory.mjs';
import { validateGodotHUD2DInventory } from './godot4-hud2d-inventory.mjs';
import { cameraLimitsSceneScript, cameraLimitsDocumentPath, cameraBaseDocument, cameraInventoryName, cameraOriginalSettingsName, cameraSceneScript, cameraProjectScript, cameraProjectScene,
  cameraSourceURL, cameraScenePath, cameraDocumentPath, cameraJson, cameraSettings, cameraProjectHost, cameraProjectMain,
  cameraSceneMain, cameraProjectSource, cameraInventory } from './godot4-camera2d-projection.mjs';
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const invalid = () => { throw buildError('build_camera2d_inventory_invalid', 'Invalid generated camera2d inventory.'); };
const autoload = '\n[autoload]\n\nVientoExecutionClock="*res://execution-clock-host.gd"\n';
async function ownedFiles(directory, active) {
  const read = async name => {
    try { return await fs.readdir(name, { withFileTypes: true }); }
    catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  };
  const rows = [];
  for (const row of await read(directory)) if (row.name.startsWith('camera2d')) {
    if (!row.isFile()) invalid(); rows.push(row.name);
  }
  const scenesPath = path.join(directory, 'scenes');
  const sceneStat = await fs.lstat(scenesPath).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
  if (sceneStat === null) return rows.sort();
  if (!sceneStat.isDirectory() || sceneStat.isSymbolicLink()) invalid();
  const scenes = await read(scenesPath); if (scenes.length > 256) invalid();
  for (const scene of scenes) {
    if (active && scene.isSymbolicLink()) invalid();
    if (!scene.isDirectory()) continue;
    const entries = await read(path.join(scenesPath, scene.name)); if (entries.length > 256) invalid();
    for (const row of entries) if (row.name.startsWith('camera2d')) {
      if (!row.isFile()) invalid(); rows.push(`scenes/${scene.name}/${row.name}`);
    }
  }
  return rows.sort();
}
export async function validateGodotCamera2DInventory(directory, signal) {
  const read = async (name, maximum = 65536) => readBuildFile(await resolveContainedPath(directory, path.join(directory, name)), maximum, signal);
  const optional = async (name, maximum) => { try { return await read(name, maximum); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } };
  try {
    signal?.throwIfAborted();
    const manifestBytes = await optional(cameraInventoryName, 16384), owned = await ownedFiles(directory, manifestBytes !== null);
    if (manifestBytes === null) { if (owned.length) invalid(); return null; }
    const manifest = JSON.parse(manifestBytes), assembly = JSON.parse(await read('assembly.json', 4 * 1024 * 1024));
    if (!exact(manifest, ['format', 'schemaVersion', 'sceneIds']) || manifest.format !== 'viento-godot-camera2d-project'
      || manifest.schemaVersion !== 1 || !Array.isArray(manifest.sceneIds) || !manifest.sceneIds.length || manifest.sceneIds.length > 32
      || manifest.sceneIds.some(id => !uuid(id)) || new Set(manifest.sceneIds).size !== manifest.sceneIds.length
      || !manifestBytes.equals(cameraInventory(manifest.sceneIds)) || !Array.isArray(assembly.scenes)) invalid();
    const declared = new Set(manifest.sceneIds), selected = assembly.scenes.filter(scene => declared.has(scene.sceneId));
    if (selected.length !== declared.size || selected.some((scene, index) => scene.sceneId !== manifest.sceneIds[index])) invalid();
    const retry = await validateGodotSceneRetryInventory(directory, signal);
    const outer = await validateGodotHUD2DInventory(directory, signal);
    const [sceneSource, projectSource, original, actualEntry, projectMain, projectScript, sceneScript, oldMain, actualClock] = await Promise.all([
      fs.readFile(cameraSourceURL('scene')), fs.readFile(cameraSourceURL('project')), read(cameraOriginalSettingsName), read('project.godot'),
      read(cameraProjectScene), read(cameraProjectScript), read(cameraSceneScript), read('project.tscn'), optional('execution-clock-original.godot'),
    ]);
    const entry = outer ? outer.innerSettings : retry ? retry.innerSettings : actualEntry,
      clockOriginal = outer ? outer.innerClockSettings : retry ? retry.innerClockSettings : actualClock;
    const host = cameraProjectHost(oldMain);
    if (!entry.equals(cameraSettings(original)) || !projectMain.equals(cameraProjectMain()) || !sceneScript.equals(sceneSource)
      || !projectScript.equals(cameraProjectSource(projectSource, host, manifest.sceneIds))) invalid();
    if (clockOriginal !== null && (!original.toString().endsWith(autoload)
      || !clockOriginal.equals(cameraSettings(original.subarray(0, original.length - Buffer.byteLength(autoload)))))) invalid();
    const expected = [cameraInventoryName, cameraOriginalSettingsName, cameraSceneScript, cameraProjectScript, cameraProjectScene];
    let bounded = false;
    for (const row of selected) {
      const id = row.sceneId, [main, bytes, sceneBytes] = await Promise.all([read(cameraScenePath(id)), read(cameraDocumentPath(id), 16384), read(`scenes/${id}/scene.json`, 4 * 1024 * 1024)]);
      const base = validateSceneCamera2DDocument(JSON.parse(bytes)), limitsBytes = await optional(cameraLimitsDocumentPath(id), 16384);
      const document = limitsBytes === null ? base : validateSceneCamera2DDocument(JSON.parse(limitsBytes)), scene = JSON.parse(sceneBytes);
      const hasLimits = limitsBytes !== null;
      if (base.schemaVersion !== 1 || hasLimits && (document.schemaVersion !== 2 || !limitsBytes.equals(cameraJson(document))
        || !bytes.equals(cameraJson(cameraBaseDocument(document))))) invalid();
      bounded ||= hasLimits;
      if (document.sceneObjectId !== id || !bytes.equals(cameraJson(base)) || !main.equals(cameraSceneMain(id, hasLimits))
        || ![2, 3].includes(scene.schemaVersion) || !Array.isArray(scene.actors)) invalid();
      if (document.camera.mode === 'follow' && scene.actors.filter(actor => actor.instanceId === document.camera.targetInstanceId).length !== 1) invalid();
      expected.push(cameraScenePath(id), cameraDocumentPath(id));
      if (hasLimits) expected.push(cameraLimitsDocumentPath(id));
    }
    const expectedScripts = new Set([cameraSceneScript, cameraProjectScript]), retained = [];
    if (bounded) {
      if (!(await read(cameraLimitsSceneScript)).equals(await fs.readFile(cameraSourceURL('limits-scene')))) invalid();
      expected.push(cameraLimitsSceneScript); expectedScripts.add(cameraLimitsSceneScript);
    }
    for (const name of owned) {
      if (name.endsWith('.gd.uid') && expectedScripts.has(name.slice(0, -4))) {
        if (!/^uid:\/\/[a-z0-9]+\r?\n?$/.test((await read(name, 128)).toString())) invalid();
      } else retained.push(name);
    }
    if (JSON.stringify(retained) !== JSON.stringify(expected.sort())) invalid();
    return { sceneIds: manifest.sceneIds, scripts: [...expectedScripts] };
  } catch (error) { if (error?.name === 'AbortError' || signal?.aborted) throw error; invalid(); }
}
