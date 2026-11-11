// Authenticate the optional control layer before any historical scene entry
// is normalized. This module owns no generator, execution process or writes.
import fs from 'node:fs/promises';
import path from 'node:path';
import { buildError, readBuildFile } from '../adapters/node-build-snapshot.mjs';
import { resolveContainedPath } from '../lib/contained-path.mjs';

export const PLATFORM_CONTROL_CAPABILITY = 'physics.platform-control2d';
export const controlInventoryName = 'platform-control-project.json';
export const controlHelpers = ['platform-control-helper.gd', 'platform-control-vertical-helper.gd'];
export const controlPortName = 'platform-control-port.gd';
export const controlSourceURL = name => new URL(`./godot4/physics-platform-control-${name}.gd`, import.meta.url);
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const invalid = () => { throw buildError('build_physics_platform_control_invalid', 'Invalid generated platform control inventory.'); };
const dropSetup = '\tvar contacts = get("movement_contacts")\n\tif contacts != null and contacts.get("drop_through") != null:\n\t\tcontacts.drop_through = preload("res://platform-vertical-drop-helper.gd").new()\n';
export const controlOriginalMain = (id, vertical) => `[gd_scene load_steps=2 format=3]\n\n[ext_resource type="Script" path="res://scenes/${id}/${vertical ? 'platform-vertical' : 'platform-events'}-scene.gd" id="1"]\n\n[node name="VientoScene" type="Node2D"]\nscript = ExtResource("1")\n`;
export const controlMain = id => controlOriginalMain(id, false).replace('/platform-events-scene.gd"', '/platform-control-scene.gd"');
export const controlHelperSource = (source, vertical) => source.replace('__PLATFORM_EVENTS__', `res://${vertical ? 'platform-vertical-events' : 'platform-events'}-helper.gd`);
export function controlGroundSource(source) {
  const marker = '\n# The carry solver';
  if (source.split(marker).length !== 2) invalid();
  return source.slice(source.indexOf(marker));
}
export const controlSceneSource = (source, id, ids, { vertical = false, drop = false, ground = '' } = {}) => source
  .replace('__SCENE_RUNTIME__', `res://scenes/${id}/project-scene.gd`).replace('__PLATFORM_IDS__', JSON.stringify(ids))
  .replace('__CONTROL_HELPER__', `res://${controlHelpers[vertical ? 1 : 0]}`)
  .replace('__DROP_SETUP__', vertical && drop ? dropSetup : '').replace('__VERTICAL_GROUND__', vertical ? ground : '');

export async function validateGodotPlatformControlInventory(directory, signal) {
  const read = async (name, limit = 65536) => readBuildFile(await resolveContainedPath(directory, path.join(directory, name)), limit, signal);
  const optional = async (name, limit) => { try { return await read(name, limit); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } };
  try {
    signal?.throwIfAborted();
    const [manifestBytes, port, horizontalHelper, verticalHelper, assemblyBytes, dropManifest] = await Promise.all([
      optional(controlInventoryName, 8192), optional(controlPortName), ...controlHelpers.map(name => optional(name)),
      optional('assembly.json', 4 * 1024 * 1024), optional('drop-through-project.json', 8192),
    ]);
    const rows = assemblyBytes === null ? [] : JSON.parse(assemblyBytes).scenes;
    if (!Array.isArray(rows) || rows.length > 32) invalid();
    const [wrapper, helperTemplate, expectedPort, verticalWrapper] = await Promise.all([
      fs.readFile(controlSourceURL('scene'), 'utf8'), fs.readFile(controlSourceURL('helper'), 'utf8'), fs.readFile(controlSourceURL('port')),
      fs.readFile(new URL('./godot4/physics-platform-vertical-scene.gd', import.meta.url), 'utf8'),
    ]);
    const sceneIds = [], mains = new Map(), scripts = [], variants = new Set();
    for (const row of rows) {
      const id = row.sceneId;
      if (!uuid(id)) invalid();
      const prefix = `scenes/${id}`, wrapperName = `${prefix}/platform-control-scene.gd`;
      const [backup, scene, main, motionBytes, verticalBytes] = await Promise.all([
        optional(`${prefix}/platform-control-original.tscn.txt`), optional(wrapperName), read(`${prefix}/main.tscn`),
        optional(`${prefix}/platform-motion.json`), optional(`${prefix}/platform-vertical.json`),
      ]);
      const touched = backup !== null || scene !== null || main.includes('platform-control');
      if (manifestBytes === null) { if (touched) invalid(); continue; }
      if (motionBytes === null) { if (touched) invalid(); continue; }
      const motion = JSON.parse(motionBytes), vertical = verticalBytes !== null;
      if (motion.format !== 'viento-godot-platform-motion2d' || motion.schemaVersion !== 1 || motion.sceneObjectId !== id
        || !Array.isArray(motion.bodies) || !motion.bodies.length || motion.bodies.length > 128
        || new Set(motion.bodies.map(body => body.instanceId)).size !== motion.bodies.length
        || motion.bodies.some(body => !uuid(body.instanceId))) invalid();
      if (backup === null || scene === null || backup.toString() !== controlOriginalMain(id, vertical) || main.toString() !== controlMain(id)
        || scene.toString() !== controlSceneSource(wrapper, id, motion.bodies.map(body => body.instanceId),
          { vertical, drop: dropManifest !== null, ground: controlGroundSource(verticalWrapper) })) invalid();
      sceneIds.push(id); variants.add(vertical ? 1 : 0); mains.set(id, backup); scripts.push(wrapperName);
    }
    const helpers = [horizontalHelper, verticalHelper];
    if (manifestBytes === null) {
      if (port !== null || helpers.some(bytes => bytes !== null)) invalid();
      return null;
    }
    const manifest = JSON.parse(manifestBytes);
    if (!exact(manifest, ['format', 'schemaVersion', 'sceneIds']) || manifest.format !== 'viento-godot-platform-control-project' || manifest.schemaVersion !== 1
      || !Array.isArray(manifest.sceneIds) || !sceneIds.length || manifest.sceneIds.length !== sceneIds.length
      || manifest.sceneIds.some((id, index) => id !== sceneIds[index]) || port === null || !port.equals(expectedPort)) invalid();
    for (const [index, bytes] of helpers.entries()) {
      if (variants.has(index) ? bytes === null || bytes.toString() !== controlHelperSource(helperTemplate, index === 1) : bytes !== null) invalid();
    }
    return { sceneIds, mains, scripts: [controlPortName, ...[...variants].sort().map(index => controlHelpers[index]), ...scripts] };
  } catch (error) {
    if (error?.name === 'AbortError' || signal?.aborted) throw error;
    invalid();
  }
}
