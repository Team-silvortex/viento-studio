// Authenticate the entire optional derived chain before exposing any old main
// view. Reads never mutate the frozen project, author files or tool caches.
import fs from 'node:fs/promises';
import path from 'node:path';
import { buildError, readBuildFile } from '../adapters/node-build-snapshot.mjs';
import { resolveContainedPath } from '../lib/contained-path.mjs';
import { planarInventoryName, planarHelpers, planarSourceURL, planarInstanceIds, planarScenePath, planarBackupPath,
  planarMain, planarOriginalEntry, planarInheritanceProjection, planarSceneSource } from './godot4-physics-planar-intent-projection.mjs';
const invalid = () => { throw buildError('build_physics_planar_intent_invalid', 'Invalid generated planar intent inventory.'); };
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
async function ownedFiles(directory, strict) {
  const result = [];
  async function entries(name) {
    try { return await fs.readdir(path.join(directory, name), { withFileTypes: true }); }
    catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  }
  for (const row of await entries('')) if (row.name.startsWith('planar-intent')) {
    if (!row.isFile()) invalid(); result.push(row.name);
  }
  const scenes = await entries('scenes');
  if (strict && scenes.length > 64) invalid();
  for (const scene of scenes) {
    if (!scene.isDirectory()) continue;
    const prefix = `scenes/${scene.name}`;
    for (const row of await entries(prefix)) if (row.name.startsWith('planar-intent')) {
      if (row.name === 'planar-intent' && row.isDirectory()) {
        const chain = await entries(`${prefix}/planar-intent`);
        if (chain.length > 64) invalid();
        for (const file of chain) { if (!file.isFile()) invalid(); result.push(`${prefix}/planar-intent/${file.name}`); }
      } else { if (!row.isFile()) invalid(); result.push(`${prefix}/${row.name}`); }
    }
  }
  return result.sort();
}
export async function validateGodotPlanarIntentInventory(directory, signal) {
  const read = async (name, maximum = 65536) => readBuildFile(await resolveContainedPath(directory, path.join(directory, name)), maximum, signal);
  const optional = async (name, maximum) => { try { return await read(name, maximum); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } };
  try {
    signal?.throwIfAborted();
    const manifestBytes = await optional(planarInventoryName, 8192), owned = await ownedFiles(directory, manifestBytes !== null);
    if (manifestBytes === null && owned.length) invalid();
    let rows;
    try {
      const assemblyBytes = await optional('assembly.json', 4 * 1024 * 1024);
      rows = assemblyBytes === null ? [] : JSON.parse(assemblyBytes).scenes;
    } catch (error) {
      if (error?.name === 'AbortError' || signal?.aborted) throw error;
      if (manifestBytes === null) return null;
      invalid();
    }
    if (!Array.isArray(rows) || rows.length > 32) { if (manifestBytes === null) return null; invalid(); }
    if (manifestBytes === null) {
      if (owned.length) invalid();
      for (const row of rows) {
        if (!uuid(row?.sceneId)) continue;
        let main;
        try { main = await optional(`scenes/${row.sceneId}/main.tscn`); }
        catch (error) { if (error?.name === 'AbortError' || signal?.aborted) throw error; continue; }
        if (main?.includes('planar-intent')) invalid();
      }
      return null;
    }
    const manifest = JSON.parse(manifestBytes);
    if (!exact(manifest, ['format', 'schemaVersion', 'sceneIds']) || manifest.format !== 'viento-godot-planar-intent-project'
      || manifest.schemaVersion !== 1 || !Array.isArray(manifest.sceneIds)) invalid();
    const [helper, port, wrapper] = await Promise.all(['helper', 'port', 'scene'].map(name => fs.readFile(planarSourceURL(name))));
    for (const [index, expected] of [helper, port].entries()) if (!(await read(planarHelpers[index])).equals(expected)) invalid();
    const expectedOwned = [planarInventoryName, ...planarHelpers], sceneIds = [], mains = new Map(), scripts = [...planarHelpers];
    for (const row of rows) {
      const id = row.sceneId;
      if (!uuid(id)) invalid();
      const prefix = `scenes/${id}`, declarationBytes = await optional(`${prefix}/physics.json`, 131072);
      const scene = JSON.parse(await read(`${prefix}/scene.json`, 4 * 1024 * 1024));
      const document = declarationBytes === null ? null : JSON.parse(declarationBytes);
      // Historical generation moves optional motor/platform fields to strict
      // sidecars. Reconstruct eligibility from those facts, never from the
      // downgraded physics.json alone; the complete old validators follow.
      const motionBytes = await optional(`${prefix}/character-motion.json`), platformBytes = await optional(`${prefix}/platform-motion.json`);
      const motors = motionBytes === null ? null : JSON.parse(motionBytes);
      if (motors !== null && (!Array.isArray(motors.bodies) || motors.sceneObjectId !== id)) invalid();
      const motorIds = new Set((motors?.bodies || []).map(body => body.instanceId));
      const projectedDocument = document === null ? null : { ...document, bodies: document.bodies.map(body => motorIds.has(body.instanceId) ? { ...body, characterMotion: true } : body) };
      const ids = planarInstanceIds({ ...scene, physics: projectedDocument === null ? undefined : { document: projectedDocument } });
      if (!ids.length) continue;
      if (ids.length > 128 || new Set(ids).size !== ids.length || ids.some(id => !uuid(id))) invalid();
      const original = await read(planarBackupPath(id)), main = await read(`${prefix}/main.tscn`);
      const expectedEntry = `${prefix}/${platformBytes !== null ? 'platform-control-scene' : 'project-scene'}.gd`;
      if (main.toString() !== planarMain(id) || planarOriginalEntry(original.toString(), id) !== expectedEntry) invalid();
      const projection = await planarInheritanceProjection(id, original.toString(), read);
      const sceneBytes = await read(planarScenePath(id));
      if (sceneBytes.toString() !== planarSceneSource(wrapper.toString(), projection.entry, ids)) invalid();
      for (const [name, bytes] of projection.files) if (!(await read(name)).equals(bytes)) invalid();
      expectedOwned.push(planarBackupPath(id), planarScenePath(id), ...projection.files.keys());
      scripts.push(planarScenePath(id), ...projection.files.keys()); sceneIds.push(id); mains.set(id, original);
    }
    // Godot editor import produces inert .gd.uid companions. Admit only a
    // normal UID next to an already authenticated GD, never another script,
    // an orphan UID, a link or a UID-derived resource selection.
    const generatedScripts = new Set(expectedOwned.filter(name => name.endsWith('.gd'))), retained = [];
    for (const name of owned) {
      if (name.endsWith('.gd.uid') && generatedScripts.has(name.slice(0, -4))) {
        const uid = (await read(name, 128)).toString();
        if (!/^uid:\/\/[a-z0-9]+\r?\n?$/.test(uid)) invalid();
      } else retained.push(name);
    }
    if (!sceneIds.length || manifest.sceneIds.length !== sceneIds.length || manifest.sceneIds.some((id, index) => id !== sceneIds[index])
      || JSON.stringify(retained) !== JSON.stringify(expectedOwned.sort())) invalid();
    return { sceneIds, mains, scripts };
  } catch (error) { if (error?.name === 'AbortError' || signal?.aborted) throw error; invalid(); }
}
