// A capability-scoped author port, layered over the existing single solver.
import fs from 'node:fs/promises';
import path from 'node:path';
import { generateGodotAudioRequestsProject, godotAudioRequestsAssemblyScripts } from './godot4-audio-requests.mjs';
import { hookCharacterIntent } from './godot4-physics-character-intent-transform.mjs';
import { historicalRuntime, hook as hookPlatform, oneWay } from './godot4-physics-platform-motion.mjs';
import { buildHash, buildError, readBuildFile } from '../adapters/node-build-snapshot.mjs';
import { resolveContainedPath } from '../lib/contained-path.mjs';

export const GODOT_CHARACTER_INTENT_CAPABILITY = 'physics.character-intent2d';
const names = ['character-intent-bridge.gd', 'character-intent-helper.gd', 'character-intent-port.gd'];
const inventoryName = 'character-intent-project.json';
const backupName = 'character-intent-original-contacts.gd';
const sourceURL = name => new URL(`./godot4/physics-${name}`, import.meta.url);
const invalid = () => { throw buildError('build_physics_character_intent_invalid', 'Invalid generated character intent inventory.'); };
const selected = scene => scene.physics?.document.bodies.some(body => body.characterMotion && scene.actors.some(actor => actor.instanceId === body.instanceId && actor.controls === 'none'));
const backup = (id, file) => `scenes/${id}/character-intent-original-${file}.gd.txt`;
const inventory = scenes => Buffer.from(JSON.stringify({ format: 'viento-godot-character-intent-project', schemaVersion: 1, sceneIds: scenes }, null, 2) + '\n');
export async function generateGodotPhysicsCharacterIntentProject(input) {
  const plan = structuredClone(input);
  const generated = await generateGodotAudioRequestsProject(plan);
  const ids = plan.scenes.filter(selected).map(scene => scene.scene.objectId);
  if (!ids.length) return generated;
  const files = await Promise.all(names.map(async name => [name, await fs.readFile(sourceURL(name))]));
  for (const name of [...names, inventoryName, backupName]) if (generated.files.has(name)) invalid();
  generated.files.set(backupName, generated.files.get('movement-contacts-helper.gd'));
  generated.files.set('movement-contacts-helper.gd', files[0][1]);
  for (const [name, bytes] of files.slice(1)) generated.files.set(name, bytes);
  for (const id of ids) {
    const prefix = `scenes/${id}`;
    for (const file of ['runtime', 'one-way-original']) {
      const name = `${prefix}/${file}.gd`, original = generated.files.get(name);
      if (!original) { if (file === 'runtime') invalid(); else continue; }
      generated.files.set(backup(id, file), original);
      generated.files.set(name, Buffer.from(hookCharacterIntent(original.toString())));
    }
  }
  const manifest = inventory(ids); generated.files.set(inventoryName, manifest);
  generated.backend = { ...generated.backend, version: '0.37.0', capabilities: [...generated.backend.capabilities, GODOT_CHARACTER_INTENT_CAPABILITY],
    sha256: buildHash(Buffer.concat([Buffer.from(generated.backend.sha256), await fs.readFile(new URL('./godot4-physics-character-intent.mjs', import.meta.url)),
      await fs.readFile(new URL('./godot4-physics-character-intent-transform.mjs', import.meta.url)), ...files.map(([, bytes]) => bytes), manifest])) };
  return generated;
}
export async function godotPhysicsCharacterIntentAssemblyScripts(directory, signal) {
  const read = async (name, limit = 65536) => readBuildFile(await resolveContainedPath(directory, path.join(directory, name)), limit, signal);
  const optional = async (name, limit) => { try { return await read(name, limit); } catch (error) { if (error.code === 'ENOENT') return null; invalid(); } };
  try {
    signal?.throwIfAborted();
    const manifest = await optional(inventoryName), bridge = await optional('movement-contacts-helper.gd');
    const old = await optional(backupName), helper = await optional(names[1]), port = await optional(names[2]);
    const assemblyBytes = await optional('assembly.json', 4 * 1024 * 1024);
    const scenes = assemblyBytes ? JSON.parse(assemblyBytes).scenes : [];
    if (manifest === null) {
      if (old !== null || helper !== null || port !== null || bridge?.includes('character-intent')) invalid();
      for (const row of scenes) {
        const prefix = `scenes/${row.sceneId}`;
        if (await optional(backup(row.sceneId, 'runtime')) !== null || await optional(backup(row.sceneId, 'one-way-original')) !== null
          || (await optional(`${prefix}/runtime.gd`))?.includes('character_intent')) invalid();
      }
      return await godotAudioRequestsAssemblyScripts(directory, signal);
    }
    if (old === null || helper === null || port === null || bridge === null) invalid();
    const expected = await Promise.all(names.map(name => fs.readFile(sourceURL(name))));
    if (!bridge.equals(expected[0]) || !helper.equals(expected[1]) || !port.equals(expected[2])) invalid();
    const drop = await optional('drop-through-project.json');
    const expectedOriginal = await fs.readFile(new URL(drop === null ? './godot4/physics-movement-contacts-helper.gd' : './godot4/physics-drop-through-bridge.gd', import.meta.url));
    if (!old.equals(expectedOriginal)) invalid();
    const selectedIds = [], added = [];
    for (const row of scenes) {
      const id = row.sceneId, prefix = `scenes/${id}`;
      const motion = await optional(`${prefix}/character-motion.json`), sceneBytes = await read(`${prefix}/scene.json`, 4 * 1024 * 1024);
      const scene = JSON.parse(sceneBytes), data = motion === null ? null : JSON.parse(motion);
      const eligible = data?.bodies?.some(body => scene.actors.some(actor => actor.instanceId === body.instanceId && actor.controls === 'none')) === true;
      let historical = eligible ? await historicalRuntime(id, true) : null;
      if (eligible && await optional(`${prefix}/platform-motion.json`) !== null) historical = hookPlatform(historical, id, true);
      const oneWayPresent = eligible && await optional(`${prefix}/one-way.json`) !== null;
      for (const file of ['runtime', 'one-way-original']) {
        const original = await optional(backup(id, file)), actual = await optional(`${prefix}/${file}.gd`);
        if (eligible && (file === 'runtime' || actual !== null)) {
          const expectedOriginal = file === 'runtime' && oneWayPresent ? oneWay(historical, id) : historical;
          if (original === null || original.toString() !== expectedOriginal || actual === null || actual.toString() !== hookCharacterIntent(expectedOriginal)) invalid();
        } else if (original !== null || actual?.includes('character_intent')) invalid();
      }
      if (eligible) selectedIds.push(id);
    }
    if (!selectedIds.length || !manifest.equals(inventory(selectedIds))) invalid();
    const previous = await godotAudioRequestsAssemblyScripts(directory, signal);
    if (!previous) invalid();
    return [...previous, backupName, names[1], names[2]];
  } catch (error) { if (error?.name === 'AbortError' || signal?.aborted) throw error; invalid(); }
}
