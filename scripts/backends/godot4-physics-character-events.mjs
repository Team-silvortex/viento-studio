// Author-facing native facts extend only generated motor projects. The frozen
// movement source still owns the sole integration and collision passes.
import fs from 'node:fs/promises';
import path from 'node:path';
import { generateGodotPhysicsCharacterMotionProject, godotPhysicsCharacterMotionAssemblyScripts } from './godot4-physics-character-motion.mjs';
import { buildHash, buildError, readBuildFile } from '../adapters/node-build-snapshot.mjs';
import { resolveContainedPath } from '../lib/contained-path.mjs';

export const GODOT_CHARACTER_EVENTS_CAPABILITY = 'physics.character-events2d';
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const invalid = () => { throw buildError('build_physics_character_events_invalid', 'Invalid generated character events inventory.'); };
const replaceOne = (value, before, after) => { if (value.split(before).length !== 2) invalid(); return value.replace(before, after); };

export async function generateGodotPhysicsCharacterEventsProject(input) {
  const generated = await generateGodotPhysicsCharacterMotionProject(input);
  if (!generated.files.has('character-motion-project.json')) return generated;
  const inventory = JSON.parse(generated.files.get('character-motion-project.json'));
  const wrapper = await fs.readFile(new URL('./godot4/physics-character-events-scene.gd', import.meta.url));
  const port = await fs.readFile(new URL('./godot4/physics-character-events-port.gd', import.meta.url));
  const generator = await fs.readFile(new URL('./godot4-physics-character-events.mjs', import.meta.url));
  for (const id of inventory.sceneIds) {
    const prefix = `scenes/${id}`, source = generated.files.get(`${prefix}/runtime.gd`), scene = generated.files.get(`${prefix}/project-scene.gd`);
    generated.files.set(`${prefix}/character-events-original.gd`, source);
    let hooked = replaceOne(source.toString(), '\t\t\t\t\tvelocity.y = -motor["jumpSpeed"]',
      '\t\t\t\t\tvelocity.y = -motor["jumpSpeed"]\n\t\t\t\t\tcall("character_events_jump", instance_id)');
    hooked = replaceOne(hooked, '\t\t\t\tcharacter_motion_grounded[instance_id] = grounded',
      '\t\t\t\tvar character_events_was_grounded: bool = character_motion_grounded[instance_id]\n\t\t\t\tcharacter_motion_grounded[instance_id] = grounded\n\t\t\t\tcall("character_events_ground", instance_id, character_events_was_grounded, grounded)');
    generated.files.set(`${prefix}/runtime.gd`, Buffer.from(hooked));
    generated.files.set(`${prefix}/character-events-scene-base.gd`, scene);
    generated.files.set(`${prefix}/project-scene.gd`, Buffer.from(wrapper.toString().replace('__SCENE_RUNTIME__', `res://${prefix}/character-events-scene-base.gd`)));
  }
  generated.files.set('character-events-port.gd', port);
  generated.files.set('character-events-project.json', Buffer.from(JSON.stringify({ format: 'viento-godot-character-events-project', schemaVersion: 1,
    sceneIds: inventory.sceneIds }, null, 2) + '\n'));
  generated.backend = { ...generated.backend, version: '0.25.0', capabilities: [...generated.backend.capabilities, GODOT_CHARACTER_EVENTS_CAPABILITY],
    sha256: buildHash(Buffer.concat([Buffer.from(generated.backend.sha256), generator, wrapper, port])) };
  return generated;
}

export async function godotPhysicsCharacterEventsAssemblyScripts(directory, signal) {
  const scripts = await godotPhysicsCharacterMotionAssemblyScripts(directory, signal);
  const read = async (name, limit = 8192) => readBuildFile(await resolveContainedPath(directory, path.join(directory, name)), limit, signal);
  const optional = async (name, limit) => {
    try { return await read(name, limit); } catch (error) { if (error.code === 'ENOENT') return null; invalid(); }
  };
  const inventory = await optional('character-events-project.json'), port = await optional('character-events-port.gd', 65536);
  if (!scripts) { if (inventory !== null || port !== null) invalid(); return null; }
  try {
    const motionBytes = await optional('character-motion-project.json'), selected = [], added = [];
    const physical = JSON.parse(await read('physics-project.json'));
    for (const id of physical.sceneIds) {
      const prefix = `scenes/${id}`, base = `${prefix}/character-events-scene-base.gd`, original = `${prefix}/character-events-original.gd`;
      const baseBytes = await optional(base, 65536), originalBytes = await optional(original, 65536);
      const entry = (await read(`${prefix}/project-scene.gd`, 65536)).toString(), runtime = (await read(`${prefix}/runtime.gd`, 65536)).toString();
      if (baseBytes === null && originalBytes === null && !entry.includes('character-events-scene-base.gd')
        && !runtime.includes('call("character_events_')) continue;
      if (baseBytes === null || originalBytes === null || entry.split(`extends "res://${base}"`).length !== 2
        || runtime.split('call("character_events_jump", instance_id)').length !== 2
        || runtime.split('call("character_events_ground", instance_id, character_events_was_grounded, grounded)').length !== 2) invalid();
      selected.push(id); added.push(base, original);
    }
    if (inventory === null) { if (port !== null || selected.length) invalid(); return scripts; }
    if (port === null || motionBytes === null) invalid();
    const manifest = JSON.parse(inventory), motion = JSON.parse(motionBytes);
    if (!exact(manifest, ['format', 'schemaVersion', 'sceneIds']) || manifest.format !== 'viento-godot-character-events-project'
      || manifest.schemaVersion !== 1 || !Array.isArray(manifest.sceneIds) || !selected.length
      || manifest.sceneIds.length !== selected.length || manifest.sceneIds.some((id, index) => id !== selected[index])
      || selected.length !== motion.sceneIds.length || selected.some((id, index) => id !== motion.sceneIds[index])) invalid();
    return [...scripts, 'character-events-port.gd', ...added];
  } catch { invalid(); }
}
