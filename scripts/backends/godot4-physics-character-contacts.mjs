// Movement-collision edges wrap the existing native motor and its event port.
// Generated hooks consume the sole movement result; no geometric query is added.
import fs from 'node:fs/promises';
import path from 'node:path';
import { generateGodotPhysicsOneWayProject, godotPhysicsOneWayAssemblyScripts } from './godot4-physics-one-way.mjs';
import { buildHash, buildError, readBuildFile } from '../adapters/node-build-snapshot.mjs';
import { resolveContainedPath } from '../lib/contained-path.mjs';

export const GODOT_CHARACTER_CONTACTS_CAPABILITY = 'physics.character-contacts2d';
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const invalid = () => { throw buildError('build_physics_character_contacts_invalid', 'Invalid generated character movement contacts inventory.'); };
const replaceOne = (value, before, after) => { if (value.split(before).length !== 2) invalid(); return value.replace(before, after); };
function hook(source) {
  if (source.includes('character_contacts') || source.includes('func physics_observation_move(')) invalid();
  let result = replaceOne(source, 'var character_events_ports: Dictionary = {}',
    'var character_events_ports: Dictionary = {}\nvar character_contacts = preload("res://character-contacts-helper.gd").new()');
  result = replaceOne(result, '\treturn project_port', '\tcharacter_contacts.attach(self, binding, instance)\n\treturn project_port');
  result = replaceOne(result, 'or character_events_flushing:', 'or character_events_flushing or character_contacts.flushing:');
  result = replaceOne(result, '\tcharacter_events_stepping = true\n\tsuper.project_step(delta)',
    '\tcharacter_events_stepping = true\n\tcharacter_contacts.begin(self)\n\tsuper.project_step(delta)');
  result = replaceOne(result, '\tcharacter_events_flushing = false', '\tcharacter_events_flushing = false\n\tcharacter_contacts.finish(self)');
  result = replaceOne(result, 'func character_events_revoke() -> void:\n', 'func character_events_revoke() -> void:\n\tcharacter_contacts.revoke()\n');
  return result + '\nfunc physics_observation_move(character: CharacterBody2D, motion: Vector2, response: String) -> Array:\n\tvar contacts := super.physics_observation_move(character, motion, response)\n\tcharacter_contacts.sample(self, character, contacts)\n\treturn contacts\n';
}

export async function generateGodotPhysicsCharacterContactsProject(input) {
  const generated = await generateGodotPhysicsOneWayProject(input);
  if (!generated.files.has('character-motion-project.json')) return generated;
  const manifest = JSON.parse(generated.files.get('character-motion-project.json'));
  const helper = await fs.readFile(new URL('./godot4/physics-character-contacts-helper.gd', import.meta.url));
  const port = await fs.readFile(new URL('./godot4/physics-character-contacts-port.gd', import.meta.url));
  const generator = await fs.readFile(new URL('./godot4-physics-character-contacts.mjs', import.meta.url));
  for (const id of manifest.sceneIds) {
    const prefix = `scenes/${id}`, source = generated.files.get(`${prefix}/project-scene.gd`);
    generated.files.set(`${prefix}/character-contacts-original.gd`, source);
    generated.files.set(`${prefix}/project-scene.gd`, Buffer.from(hook(source.toString())));
  }
  generated.files.set('character-contacts-helper.gd', helper);
  generated.files.set('character-contacts-port.gd', port);
  generated.files.set('character-contacts-project.json', Buffer.from(JSON.stringify({ format: 'viento-godot-character-contacts-project', schemaVersion: 1,
    sceneIds: manifest.sceneIds }, null, 2) + '\n'));
  generated.backend = { ...generated.backend, version: '0.27.0', capabilities: [...generated.backend.capabilities, GODOT_CHARACTER_CONTACTS_CAPABILITY],
    sha256: buildHash(Buffer.concat([Buffer.from(generated.backend.sha256), generator, helper, port])) };
  return generated;
}

export async function godotPhysicsCharacterContactsAssemblyScripts(directory, signal) {
  const scripts = await godotPhysicsOneWayAssemblyScripts(directory, signal);
  const read = async (name, limit = 8192) => readBuildFile(await resolveContainedPath(directory, path.join(directory, name)), limit, signal);
  const optional = async (name, limit) => {
    try { return await read(name, limit); } catch (error) { if (error.code === 'ENOENT') return null; invalid(); }
  };
  const inventory = await optional('character-contacts-project.json'), helper = await optional('character-contacts-helper.gd', 65536), port = await optional('character-contacts-port.gd', 65536);
  try {
    const assemblyBytes = await optional('assembly.json', 4 * 1024 * 1024), motionBytes = await optional('character-motion-project.json');
    const selected = [], added = [];
    for (const row of assemblyBytes === null ? [] : JSON.parse(assemblyBytes).scenes) {
      const id = row.sceneId, prefix = `scenes/${id}`, original = `${prefix}/character-contacts-original.gd`;
      const originalBytes = await optional(original, 65536), entry = (await read(`${prefix}/project-scene.gd`, 65536)).toString();
      if (originalBytes === null && !entry.includes('character_contacts') && !entry.includes('character-contacts-helper.gd')) continue;
      if (!scripts || originalBytes === null || entry !== hook(originalBytes.toString())) invalid();
      selected.push(id); added.push(original);
    }
    if (inventory === null) { if (helper !== null || port !== null || selected.length) invalid(); return scripts; }
    if (!scripts || helper === null || port === null || motionBytes === null) invalid();
    const manifest = JSON.parse(inventory), motion = JSON.parse(motionBytes);
    if (!exact(manifest, ['format', 'schemaVersion', 'sceneIds']) || manifest.format !== 'viento-godot-character-contacts-project'
      || manifest.schemaVersion !== 1 || !Array.isArray(manifest.sceneIds) || !selected.length
      || manifest.sceneIds.length !== selected.length || manifest.sceneIds.some((id, index) => id !== selected[index])
      || selected.length !== motion.sceneIds.length || selected.some((id, index) => id !== motion.sceneIds[index])) invalid();
    return [...scripts, 'character-contacts-helper.gd', 'character-contacts-port.gd', ...added];
  } catch { invalid(); }
}
