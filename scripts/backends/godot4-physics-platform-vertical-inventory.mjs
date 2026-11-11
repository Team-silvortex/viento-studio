import { validateGodotPlanarIntentInventory } from './godot4-physics-planar-intent-inventory.mjs';
// Authenticate the vertical projection before historical inventory readers
// normalize its scene entry. This module never generates or writes files.
import fs from 'node:fs/promises';
import path from 'node:path';
import { buildError, readBuildFile } from '../adapters/node-build-snapshot.mjs';
import { resolveContainedPath } from '../lib/contained-path.mjs';

import { validateGodotPlatformControlInventory } from './godot4-physics-platform-control-inventory.mjs';

export const verticalNames = ['platform-vertical-motion-helper.gd', 'platform-vertical-events-helper.gd'];
export const verticalDropName = 'platform-vertical-drop-helper.gd';
export const verticalInventoryName = 'platform-vertical-project.json';
export const verticalSourceURL = name => new URL(`./godot4/physics-${name}`, import.meta.url);
const dropSetup = '\tvar contacts = get("movement_contacts")\n\tif contacts != null and contacts.get("drop_through") != null:\n\t\tcontacts.drop_through = preload("res://platform-vertical-drop-helper.gd").new()\n';
export const verticalSceneSource = (source, id, ids, drop = false) => source.replace('__SCENE_RUNTIME__', `res://scenes/${id}/project-scene.gd`).replace('__PLATFORM_IDS__', JSON.stringify(ids)).replace('__DROP_SETUP__', drop ? dropSetup : '');
export const verticalOriginalMain = id => `[gd_scene load_steps=2 format=3]\n\n[ext_resource type="Script" path="res://scenes/${id}/platform-events-scene.gd" id="1"]\n\n[node name="VientoScene" type="Node2D"]\nscript = ExtResource("1")\n`;
export const verticalMain = id => verticalOriginalMain(id).replace('/platform-events-scene.gd"', '/platform-vertical-scene.gd"');
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const invalid = () => { throw buildError('build_physics_platform_vertical_invalid', 'Invalid generated vertical platform inventory.'); };
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);

export async function validateGodotPlatformVerticalInventory(directory, signal) {
  const read = async (name, limit = 65536) => readBuildFile(await resolveContainedPath(directory, path.join(directory, name)), limit, signal);
  const optional = async (name, limit) => { try { return await read(name, limit); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } };
  try {
    signal?.throwIfAborted();
    const planar = await validateGodotPlanarIntentInventory(directory, signal);
    const controls = await validateGodotPlatformControlInventory(directory, signal);
    const manifestBytes = await optional(verticalInventoryName, 8192);
    const helpers = await Promise.all(verticalNames.map(name => optional(name)));
    const dropHelper = await optional(verticalDropName), hasDrop = await optional('drop-through-project.json', 8192) !== null;
    const assemblyBytes = await optional('assembly.json', 4 * 1024 * 1024);
    const rows = assemblyBytes === null ? [] : JSON.parse(assemblyBytes).scenes;
    if (!Array.isArray(rows) || rows.length > 32) invalid();
    const ids = [], mains = new Map(), scripts = [];
    const wrapper = (await fs.readFile(verticalSourceURL('platform-vertical-scene.gd'))).toString();
    for (const row of rows) {
      const id = row.sceneId;
      if (!uuid(id)) invalid();
      const prefix = `scenes/${id}`, backupName = `${prefix}/platform-vertical-original.tscn.txt`, sceneName = `${prefix}/platform-vertical-scene.gd`;
      const [documentBytes, backup, scene, rawMain] = await Promise.all([
        optional(`${prefix}/platform-vertical.json`), optional(backupName), optional(sceneName), read(`${prefix}/main.tscn`),
      ]);
      const main = controls?.mains.get(id) || planar?.mains.get(id) || rawMain;
      const touched = documentBytes !== null || backup !== null || scene !== null || main.includes('platform-vertical');
      if (!touched) continue;
      if (manifestBytes === null || documentBytes === null || backup === null || scene === null
        || backup.toString() !== verticalOriginalMain(id) || main.toString() !== verticalMain(id)) invalid();
      const document = JSON.parse(documentBytes), proxy = JSON.parse(await read(`${prefix}/platform-motion.json`));
      if (!exact(document, ['format', 'schemaVersion', 'sceneObjectId', 'bodies']) || document.format !== 'viento-godot-platform-vertical2d'
        || document.schemaVersion !== 1 || document.sceneObjectId !== id || !Array.isArray(document.bodies)
        || !document.bodies.length || document.bodies.length > 128 || !Array.isArray(proxy.bodies)
        || new Set(document.bodies.map(body => body.bodyId)).size !== document.bodies.length
        || new Set(document.bodies.map(body => body.instanceId)).size !== document.bodies.length) invalid();
      let previousIndex = -1;
      for (const body of document.bodies) {
        const motion = body.platformMotion, at = proxy.bodies.findIndex(value => value.bodyId === body.bodyId);
        const historical = proxy.bodies[at];
        if (!exact(body, ['bodyId', 'instanceId', 'platformMotion']) || !uuid(body.bodyId) || !uuid(body.instanceId)
          || at <= previousIndex || !historical || historical.instanceId !== body.instanceId
          || !exact(motion, ['kind', 'offsetY', 'speed']) || motion.kind !== 'vertical'
          || !Number.isFinite(motion.offsetY) || Math.abs(motion.offsetY) < 1 || Math.abs(motion.offsetY) > 8192
          || !Number.isFinite(motion.speed) || motion.speed < 1 || motion.speed > 2000
          || !exact(historical.platformMotion, ['kind', 'offsetX', 'speed']) || historical.platformMotion.kind !== 'horizontal'
          || historical.platformMotion.offsetX !== motion.offsetY || historical.platformMotion.speed !== motion.speed) invalid();
        previousIndex = at;
      }
      if (scene.toString() !== verticalSceneSource(wrapper, id, proxy.bodies.map(body => body.instanceId), hasDrop)) invalid();
      ids.push(id); mains.set(id, backup); scripts.push(sceneName);
    }
    if (manifestBytes === null) {
      if (helpers.some(bytes => bytes !== null) || dropHelper !== null) invalid();
      return null;
    }
    const manifest = JSON.parse(manifestBytes);
    if (!exact(manifest, ['format', 'schemaVersion', 'sceneIds']) || manifest.format !== 'viento-godot-platform-vertical-project'
      || manifest.schemaVersion !== 1 || !Array.isArray(manifest.sceneIds) || !ids.length
      || manifest.sceneIds.length !== ids.length || manifest.sceneIds.some((id, index) => id !== ids[index])) invalid();
    for (const [index, name] of verticalNames.entries()) if (helpers[index] === null || !helpers[index].equals(await fs.readFile(verticalSourceURL(name)))) invalid();
    if (hasDrop ? dropHelper === null || !dropHelper.equals(await fs.readFile(verticalSourceURL(verticalDropName))) : dropHelper !== null) invalid();
    return { sceneIds: ids, mains, scripts: [...verticalNames, ...(hasDrop ? [verticalDropName] : []), ...scripts] };
  } catch (error) {
    if (error?.name === 'AbortError' || signal?.aborted) throw error;
    invalid();
  }
}
