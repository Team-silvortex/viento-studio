// Optional per-character commands reuse the frozen movement/fact hooks. Author
// schemas, project protocols, old generators and the native solver stay intact.
import fs from 'node:fs/promises';
import path from 'node:path';
import { validateProjectAssemblyPlan } from '../../engine/project-assembly-plan.mjs';
import { generateGodotPhysicsMovementContactsProject, godotPhysicsMovementContactsAssemblyScripts } from './godot4-physics-movement-contacts.mjs';
import { buildHash, buildError, readBuildFile } from '../adapters/node-build-snapshot.mjs';
import { resolveContainedPath } from '../lib/contained-path.mjs';

export const GODOT_CHARACTER_DROP_THROUGH_CAPABILITY = 'physics.character-drop-through2d';
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const invalid = () => { throw buildError('build_physics_drop_through_invalid', 'Invalid generated character drop-through inventory.'); };
const sources = [
  ['movement-contacts-helper.gd', './godot4/physics-drop-through-bridge.gd'],
  ['drop-through-helper.gd', './godot4/physics-drop-through-helper.gd'],
  ['drop-through-port.gd', './godot4/physics-drop-through-port.gd'],
];
const selected = scene => scene.physics?.document.bodies.some(body => body.characterMotion)
  && scene.physics.document.bodies.some(body => body.oneWay);

export async function generateGodotPhysicsDropThroughProject(input) {
  if (input?.kind !== 'project') throw buildError('build_physics_requires_project', 'Scene physics currently requires a project assembly.');
  const plan = validateProjectAssemblyPlan(input), generated = await generateGodotPhysicsMovementContactsProject(plan);
  const sceneIds = plan.scenes.filter(selected).map(scene => scene.scene.objectId);
  if (!sceneIds.length) return generated;
  const files = await Promise.all(sources.map(async ([name, source]) => [name, await fs.readFile(new URL(source, import.meta.url))]));
  // Preserve the published generator identity while inventory validation evolves.
  const generator = await fs.readFile(new URL('./godot4-physics-drop-through-v0.29.mjs.txt', import.meta.url));
  generated.files.set('movement-contacts-base-helper.gd', generated.files.get('movement-contacts-helper.gd'));
  for (const [name, bytes] of files) generated.files.set(name, bytes);
  generated.files.set('drop-through-project.json', Buffer.from(JSON.stringify({ format: 'viento-godot-drop-through-project', schemaVersion: 1, sceneIds }, null, 2) + '\n'));
  generated.backend = { ...generated.backend, version: '0.29.0', capabilities: [...generated.backend.capabilities, GODOT_CHARACTER_DROP_THROUGH_CAPABILITY],
    sha256: buildHash(Buffer.concat([Buffer.from(generated.backend.sha256), generator, ...files.map(([, bytes]) => bytes)])) };
  return generated;
}

export async function godotPhysicsDropThroughAssemblyScripts(directory, signal) {
  const read = async (name, limit = 65536) => readBuildFile(await resolveContainedPath(directory, path.join(directory, name)), limit, signal);
  const optional = async (name, limit) => {
    try { return await read(name, limit); } catch (error) { if (error.code === 'ENOENT') return null; invalid(); }
  };
  const inventory = await optional('drop-through-project.json', 8192);
  const base = await optional('movement-contacts-base-helper.gd');
  const entries = await Promise.all(sources.map(async ([name, source]) => ({ name, source, bytes: await optional(name) })));
  // The verified intent bridge wraps this exact historical helper.
  if (await optional('character-intent-project.json', 8192) !== null) {
    const bridge = await optional('movement-contacts-helper.gd');
    const original = await optional('character-intent-original-contacts.gd');
    if (bridge === null || !bridge.equals(await fs.readFile(new URL('./godot4/physics-character-intent-bridge.gd', import.meta.url))) || original === null) invalid();
    entries[0].bytes = original;
  }
  if (inventory === null) {
    if (base !== null || entries.slice(1).some(entry => entry.bytes !== null)
      || entries[0].bytes?.includes('drop-through') || entries[0].bytes?.includes('movement-contacts-base-helper.gd')) invalid();
    return await godotPhysicsMovementContactsAssemblyScripts(directory, signal);
  }
  try {
    const scripts = await godotPhysicsMovementContactsAssemblyScripts(directory, signal);
    if (!scripts || base === null || !base.equals(await fs.readFile(new URL('./godot4/physics-movement-contacts-helper.gd', import.meta.url)))) invalid();
    for (const entry of entries) if (entry.bytes === null || !entry.bytes.equals(await fs.readFile(new URL(entry.source, import.meta.url)))) invalid();
    const manifest = JSON.parse(inventory), assembly = JSON.parse(await read('assembly.json', 4 * 1024 * 1024)), sceneIds = [];
    for (const scene of assembly.scenes) {
      const prefix = `scenes/${scene.sceneId}`;
      const motion = await optional(`${prefix}/character-motion.json`), platforms = await optional(`${prefix}/one-way.json`);
      if (motion !== null && platforms !== null && JSON.parse(motion).bodies.length && JSON.parse(platforms).bodies.length) sceneIds.push(scene.sceneId);
    }
    if (!exact(manifest, ['format', 'schemaVersion', 'sceneIds']) || manifest.format !== 'viento-godot-drop-through-project'
      || manifest.schemaVersion !== 1 || !Array.isArray(manifest.sceneIds) || !sceneIds.length
      || manifest.sceneIds.length !== sceneIds.length || manifest.sceneIds.some((id, index) => id !== sceneIds[index])) invalid();
    return [...scripts, 'movement-contacts-base-helper.gd', 'drop-through-helper.gd', 'drop-through-port.gd'];
  } catch { invalid(); }
}
