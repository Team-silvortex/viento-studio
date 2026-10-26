// Visit-local endpoint facts extend, but never rewrite, the frozen .30 motion
// implementation. The author decides whether to publish finite project events.
import fs from 'node:fs/promises';
import path from 'node:path';
import { generateGodotPhysicsPlatformMotionProject, godotPhysicsPlatformMotionAssemblyScripts } from './godot4-physics-platform-motion.mjs';
import { buildHash, buildError, readBuildFile } from '../adapters/node-build-snapshot.mjs';
import { resolveContainedPath } from '../lib/contained-path.mjs';
const capability = 'physics.platform-events2d';
const sourceURL = name => new URL(`./godot4/physics-platform-events-${name}.gd`, import.meta.url);
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const invalid = () => { throw buildError('build_physics_platform_events_invalid', 'Invalid generated platform endpoint inventory.'); };
const baseScene = id => `[gd_scene load_steps=2 format=3]\n\n[ext_resource type="Script" path="res://scenes/${id}/project-scene.gd" id="1"]\n\n[node name="VientoScene" type="Node2D"]\nscript = ExtResource("1")\n`;
const hookedScene = id => baseScene(id).replace('/project-scene.gd"', '/platform-events-scene.gd"');
const sceneSource = (source, id, ids) => source.replace('__SCENE_RUNTIME__', `res://scenes/${id}/project-scene.gd`).replace('__PLATFORM_IDS__', JSON.stringify(ids));
export async function generateGodotPhysicsPlatformEventsProject(input) {
  const generated = await generateGodotPhysicsPlatformMotionProject(input);
  const motion = generated.files.get('platform-motion-project.json');
  if (!motion) return generated;
  const scenes = JSON.parse(motion).sceneIds;
  const [helper, port, wrapper, generator] = await Promise.all(['helper', 'port', 'scene'].map(name => fs.readFile(sourceURL(name))).concat(fs.readFile(new URL('./godot4-physics-platform-events.mjs', import.meta.url))));
  for (const id of scenes) {
    const prefix = `scenes/${id}`, original = generated.files.get(`${prefix}/main.tscn`);
    if (!original || original.toString() !== baseScene(id)) invalid();
    const ids = JSON.parse(generated.files.get(`${prefix}/platform-motion.json`)).bodies.map(body => body.instanceId);
    generated.files.set(`${prefix}/platform-events-original.tscn`, original);
    generated.files.set(`${prefix}/main.tscn`, Buffer.from(hookedScene(id)));
    generated.files.set(`${prefix}/platform-events-scene.gd`, Buffer.from(sceneSource(wrapper.toString(), id, ids)));
  }
  generated.files.set('platform-events-helper.gd', helper);
  generated.files.set('platform-events-port.gd', port);
  generated.files.set('platform-events-project.json', Buffer.from(JSON.stringify({ format: 'viento-godot-platform-events-project', schemaVersion: 1, sceneIds: scenes }, null, 2) + '\n'));
  generated.backend = { ...generated.backend, version: '0.31.0', capabilities: [...generated.backend.capabilities, capability],
    sha256: buildHash(Buffer.concat([Buffer.from(generated.backend.sha256), generator, helper, port, wrapper])) };
  return generated;
}
export async function godotPhysicsPlatformEventsAssemblyScripts(directory, signal) {
  const read = async (name, limit = 65536) => readBuildFile(await resolveContainedPath(directory, path.join(directory, name)), limit, signal);
  const optional = async (name, limit) => { try { return await read(name, limit); } catch (error) { if (error.code === 'ENOENT') return null; invalid(); } };
  try {
    const inventory = await optional('platform-events-project.json', 8192), helper = await optional('platform-events-helper.gd'), port = await optional('platform-events-port.gd');
    const assemblyBytes = await optional('assembly.json', 4 * 1024 * 1024), rows = assemblyBytes === null ? [] : JSON.parse(assemblyBytes).scenes;
    const selected = [], added = [], wrapper = (await fs.readFile(sourceURL('scene'))).toString();
    for (const row of rows) {
      const id = row.sceneId, prefix = `scenes/${id}`, original = await optional(`${prefix}/platform-events-original.tscn`), scene = await optional(`${prefix}/platform-events-scene.gd`);
      const main = await read(`${prefix}/main.tscn`), motion = await optional(`${prefix}/platform-motion.json`);
      const touched = original !== null || scene !== null || main.includes('platform-events');
      if (inventory === null) { if (touched) invalid(); continue; }
      if (motion === null) { if (touched) invalid(); continue; }
      const ids = JSON.parse(motion).bodies.map(body => body.instanceId);
      if (original === null || original.toString() !== baseScene(id) || main.toString() !== hookedScene(id)
        || scene === null || scene.toString() !== sceneSource(wrapper, id, ids)) invalid();
      selected.push(id); added.push(`${prefix}/platform-events-scene.gd`);
    }
    if (inventory === null) {
      if (helper !== null || port !== null) invalid();
      return await godotPhysicsPlatformMotionAssemblyScripts(directory, signal);
    }
    const manifest = JSON.parse(inventory);
    if (!exact(manifest, ['format', 'schemaVersion', 'sceneIds']) || manifest.format !== 'viento-godot-platform-events-project' || manifest.schemaVersion !== 1
      || !Array.isArray(manifest.sceneIds) || !selected.length || manifest.sceneIds.length !== selected.length || manifest.sceneIds.some((id, index) => id !== selected[index])
      || helper === null || !helper.equals(await fs.readFile(sourceURL('helper'))) || port === null || !port.equals(await fs.readFile(sourceURL('port')))) invalid();
    const historical = await godotPhysicsPlatformMotionAssemblyScripts(directory, signal);
    if (!historical) invalid();
    return [...historical, 'platform-events-helper.gd', 'platform-events-port.gd', ...added];
  } catch { invalid(); }
}
