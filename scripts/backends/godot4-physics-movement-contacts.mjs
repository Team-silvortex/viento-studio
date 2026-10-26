// One contact set per declared character, independent of the movement policy.
// Frozen generators keep their bytes and runtime protocols; only generated
// scene hooks and the pure-planar live delegation layer are extended here.
import fs from 'node:fs/promises';
import path from 'node:path';
import { validateProjectAssemblyPlan } from '../../engine/project-assembly-plan.mjs';
import { generateGodotPhysicsOneWayProject, godotPhysicsOneWayAssemblyScripts } from './godot4-physics-one-way.mjs';
import { GODOT_CHARACTER_CONTACTS_CAPABILITY, godotPhysicsCharacterContactsAssemblyScripts } from './godot4-physics-character-contacts.mjs';
import { buildHash, buildError, readBuildFile } from '../adapters/node-build-snapshot.mjs';
import { resolveContainedPath } from '../lib/contained-path.mjs';

const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const invalid = () => { throw buildError('build_physics_movement_contacts_invalid', 'Invalid generated character movement contacts inventory.'); };
const replaceOne = (value, before, after) => { if (value.split(before).length !== 2) invalid(); return value.replace(before, after); };
function hook(source, motor) {
  if (source.includes('movement_contacts') || source.includes('func physics_observation_move(')) invalid();
  let result;
  if (motor) {
    result = replaceOne(source, 'var character_events_ports: Dictionary = {}',
      'var character_events_ports: Dictionary = {}\nvar movement_contacts = preload("res://movement-contacts-helper.gd").new()');
    result = replaceOne(result, '\treturn project_port', '\tmovement_contacts.attach(self, binding, instance)\n\treturn project_port');
    result = replaceOne(result, 'or character_events_flushing:', 'or character_events_flushing or movement_contacts.flushing:');
    result = replaceOne(result, '\tcharacter_events_stepping = true\n\tsuper.project_step(delta)',
      '\tcharacter_events_stepping = true\n\tmovement_contacts.begin(self)\n\tsuper.project_step(delta)');
    result = replaceOne(result, '\tcharacter_events_flushing = false', '\tcharacter_events_flushing = false\n\tmovement_contacts.finish(self)');
    result = replaceOne(result, 'func character_events_revoke() -> void:\n', 'func character_events_revoke() -> void:\n\tmovement_contacts.revoke()\n');
  } else {
    result = replaceOne(source, 'var project_open := true', 'var project_open := true\nvar movement_contacts = preload("res://movement-contacts-helper.gd").new()');
    result = replaceOne(result, '\treturn project_host.make_port(project_visit, binding, instance)',
      '\tvar project_port: RefCounted = project_host.make_port(project_visit, binding, instance)\n\tmovement_contacts.attach(self, binding, instance)\n\treturn project_port');
    result = replaceOne(result, 'func project_step(delta: float) -> void:\n\tif project_open:\n\t\tsuper._process(delta)',
      'func project_step(delta: float) -> void:\n\tif not project_open or not movement_contacts.opened or movement_contacts.stepping or movement_contacts.flushing:\n\t\treturn\n\tmovement_contacts.begin(self)\n\tsuper._process(delta)\n\tmovement_contacts.finish(self)');
    result = replaceOne(result, 'func project_close(silent: bool = false) -> void:\n', 'func project_close(silent: bool = false) -> void:\n\tmovement_contacts.revoke()\n');
    result = replaceOne(result, 'func _ready() -> void:\n\tsuper._ready()', 'func _ready() -> void:\n\ttree_exiting.connect(movement_contacts.revoke)\n\tsuper._ready()');
  }
  return result + '\nfunc physics_observation_move(character: CharacterBody2D, motion: Vector2, response: String) -> Array:\n\tvar contacts := super.physics_observation_move(character, motion, response)\n\tmovement_contacts.sample(self, character, contacts)\n\treturn contacts\n';
}
const planarSource = (source, id) => source.toString().replace('__PLANAR_BASE_RUNTIME__', `res://scenes/${id}/movement-contacts-planar-original.gd`)
  .replace('__PHYSICS_DOCUMENT__', `res://scenes/${id}/physics.json`);

export async function generateGodotPhysicsMovementContactsProject(input) {
  if (input?.kind !== 'project') throw buildError('build_physics_requires_project', 'Scene physics currently requires a project assembly.');
  const plan = validateProjectAssemblyPlan(input), generated = await generateGodotPhysicsOneWayProject(plan);
  const selected = plan.scenes.filter(scene => scene.physics?.document.bodies.some(body => body.kind === 'character'));
  if (!selected.length) return generated;
  const motorIds = new Set(generated.files.has('character-motion-project.json') ? JSON.parse(generated.files.get('character-motion-project.json')).sceneIds : []);
  const helper = await fs.readFile(new URL('./godot4/physics-movement-contacts-helper.gd', import.meta.url));
  const port = await fs.readFile(new URL('./godot4/physics-character-contacts-port.gd', import.meta.url));
  const planar = await fs.readFile(new URL('./godot4/physics-planar-contacts-runtime.gd', import.meta.url));
  const generator = await fs.readFile(new URL('./godot4-physics-movement-contacts.mjs', import.meta.url));
  const sceneIds = [], planarSceneIds = [];
  for (const child of selected) {
    const id = child.scene.objectId, prefix = `scenes/${id}`, source = generated.files.get(`${prefix}/project-scene.gd`), motor = motorIds.has(id);
    sceneIds.push(id);
    generated.files.set(`${prefix}/movement-contacts-original.gd`, source);
    generated.files.set(`${prefix}/project-scene.gd`, Buffer.from(hook(source.toString(), motor)));
    if (!motor) {
      planarSceneIds.push(id);
      generated.files.set(`${prefix}/movement-contacts-planar-original.gd`, generated.files.get(`${prefix}/physics-observation-base.gd`));
      generated.files.set(`${prefix}/physics-observation-base.gd`, Buffer.from(planarSource(planar, id)));
    }
  }
  generated.files.set('movement-contacts-helper.gd', helper);
  generated.files.set('movement-contacts-port.gd', port);
  generated.files.set('movement-contacts-project.json', Buffer.from(JSON.stringify({ format: 'viento-godot-movement-contacts-project', schemaVersion: 1, sceneIds, planarSceneIds }, null, 2) + '\n'));
  generated.backend = { ...generated.backend, version: '0.28.0', capabilities: [...generated.backend.capabilities, GODOT_CHARACTER_CONTACTS_CAPABILITY],
    sha256: buildHash(Buffer.concat([Buffer.from(generated.backend.sha256), generator, helper, port, planar])) };
  return generated;
}

export async function godotPhysicsMovementContactsAssemblyScripts(directory, signal) {
  const read = async (name, limit = 8192) => readBuildFile(await resolveContainedPath(directory, path.join(directory, name)), limit, signal);
  const optional = async (name, limit) => {
    try { return await read(name, limit); } catch (error) { if (error.code === 'ENOENT') return null; invalid(); }
  };
  const inventory = await optional('movement-contacts-project.json'), helper = await optional('movement-contacts-helper.gd', 65536), port = await optional('movement-contacts-port.gd', 65536);
  try {
    // Inventory-less projects still undergo the complete historical validator.
    // Discover orphaned hooks in every assembly scene before taking that path.
    const assemblyBytes = await optional('assembly.json', 4 * 1024 * 1024), assembly = assemblyBytes === null ? [] : JSON.parse(assemblyBytes).scenes;
    const selected = [], planarSelected = [], added = [];
    const motionBytes = await optional('character-motion-project.json'), motorIds = new Set(motionBytes === null ? [] : JSON.parse(motionBytes).sceneIds);
    const planar = await fs.readFile(new URL('./godot4/physics-planar-contacts-runtime.gd', import.meta.url));
    for (const row of assembly) {
      const id = row.sceneId, prefix = `scenes/${id}`, original = `${prefix}/movement-contacts-original.gd`, planarOriginal = `${prefix}/movement-contacts-planar-original.gd`;
      const originalBytes = await optional(original, 65536), planarOriginalBytes = await optional(planarOriginal, 65536);
      const entry = (await read(`${prefix}/project-scene.gd`, 65536)).toString(), baseBytes = await optional(`${prefix}/physics-observation-base.gd`, 65536);
      const touched = originalBytes !== null || planarOriginalBytes !== null || entry.includes('movement_contacts') || entry.includes('movement-contacts-helper.gd') || baseBytes?.includes('movement-contacts-planar-original.gd');
      if (inventory === null) { if (touched) invalid(); continue; }
      if (await optional(`${prefix}/character-contacts-original.gd`, 65536) !== null || entry.includes('character_contacts')) invalid();
      const declarationBytes = await optional(`${prefix}/physics.json`, 131072);
      const declaration = declarationBytes === null ? null : JSON.parse(declarationBytes);
      const eligible = declaration !== null && declaration.bodies.some(body => body.kind === 'character');
      if (!eligible) { if (touched) invalid(); continue; }
      if (originalBytes === null || entry !== hook(originalBytes.toString(), motorIds.has(id))) invalid();
      selected.push(id); added.push(original);
      if (motorIds.has(id)) { if (planarOriginalBytes !== null || baseBytes?.includes('movement-contacts-planar-original.gd')) invalid(); }
      else {
        if (planarOriginalBytes === null || baseBytes === null || baseBytes.toString() !== planarSource(planar, id)) invalid();
        const schema = declaration.schemaVersion;
        if (![1, 2].includes(schema)) invalid();
        const legacyTemplate = await fs.readFile(new URL(schema === 1 ? './godot4/physics-runtime.gd' : './godot4/physics-response-runtime.gd', import.meta.url), 'utf8');
        const expectedOriginal = legacyTemplate.replace(schema === 1 ? '__BASE_RUNTIME__' : '__PHYSICS_RUNTIME__', `res://${prefix}/${schema === 1 ? 'physics-base' : 'physics-stop'}.gd`)
          .replace('__PHYSICS_DOCUMENT__', `res://${prefix}/physics.json`);
        if (planarOriginalBytes.toString() !== expectedOriginal) invalid();
        planarSelected.push(id); added.push(planarOriginal);
      }
    }
    if (inventory === null) {
      if (helper !== null || port !== null) invalid();
      return await godotPhysicsCharacterContactsAssemblyScripts(directory, signal);
    }
    if (helper === null || port === null) invalid();
    for (const name of ['character-contacts-project.json', 'character-contacts-helper.gd', 'character-contacts-port.gd']) if (await optional(name, 65536) !== null) invalid();
    const scripts = await godotPhysicsOneWayAssemblyScripts(directory, signal), manifest = JSON.parse(inventory);
    if (!scripts || !exact(manifest, ['format', 'schemaVersion', 'sceneIds', 'planarSceneIds']) || manifest.format !== 'viento-godot-movement-contacts-project'
      || manifest.schemaVersion !== 1 || !Array.isArray(manifest.sceneIds) || !Array.isArray(manifest.planarSceneIds) || !selected.length
      || manifest.sceneIds.length !== selected.length || manifest.sceneIds.some((id, index) => id !== selected[index])
      || manifest.planarSceneIds.length !== planarSelected.length || manifest.planarSceneIds.some((id, index) => id !== planarSelected[index])) invalid();
    return [...scripts, 'movement-contacts-helper.gd', 'movement-contacts-port.gd', ...added];
  } catch { invalid(); }
}
