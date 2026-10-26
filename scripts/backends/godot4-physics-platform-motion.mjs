// Explicit horizontal trajectories extend a frozen old plan projection. The
// original solvers and facts remain owned by the historical physics layers.
import fs from 'node:fs/promises';
import path from 'node:path';
import { validateProjectAssemblyPlan } from '../../engine/project-assembly-plan.mjs';
import { SCENE_PHYSICS2D_PLATFORM_MOTION_CAPABILITY } from '../../engine/scene-physics2d.mjs';
import { generateGodotPhysicsDropThroughProject, godotPhysicsDropThroughAssemblyScripts } from './godot4-physics-drop-through.mjs';
import { buildHash, buildError, readBuildFile } from '../adapters/node-build-snapshot.mjs';
import { resolveContainedPath } from '../lib/contained-path.mjs';
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const invalid = () => { throw buildError('build_physics_platform_motion_invalid', 'Invalid generated moving platform inventory.'); };
const replaceOne = (source, before, after) => { if (source.split(before).length !== 2) invalid(); return source.replace(before, after); };
const helperName = 'platform-motion-helper.gd';
const helperURL = new URL('./godot4/physics-platform-motion-helper.gd', import.meta.url);
function hook(source, id, motor) {
  if (source.includes('platform_motion') || source.includes('platform-motion-helper.gd')) invalid();
  let result = replaceOne(source, '\nfunc _ready() -> void:', '\nvar platform_motion = preload("res://platform-motion-helper.gd").new()\n\nfunc _ready() -> void:');
  result = replaceOne(result, '\tsuper._ready()', `\tsuper._ready()\n\tplatform_motion.install(self, "res://scenes/${id}/platform-motion.json")`);
  result = replaceOne(result, 'func _process(delta: float) -> void:\n', 'func _process(delta: float) -> void:\n\tplatform_motion.begin(self, delta)\n');
  if (motor) {
    result = replaceOne(result, '\t\t\tvar before := character.global_position', '\t\t\tmotion = platform_motion.motion(self, character, motion, velocity)\n\t\t\tvar before := character.global_position');
    const move = '\t\t\tvar contacts := physics_observation_move(character, motion, body.get("collisionResponse", "stop"))';
    result = replaceOne(result, move, move + '\n\t\t\tplatform_motion.sample(self, character, contacts)');
  }
  return result;
}
function oneWay(source, id) {
  const ready = 'func _ready() -> void:\n\tsuper._ready()';
  // Historical one-way installation follows the same native root factory.
  return replaceOne(source, ready, ready + `\n\tif not preload("res://physics-one-way-helper.gd").install(self, "res://scenes/${id}/one-way.json"):\n\t\treturn`);
}
async function historicalRuntime(id, motor) {
  const prefix = `scenes/${id}`;
  if (!motor) return (await fs.readFile(new URL('./godot4/physics-observation-runtime.gd', import.meta.url), 'utf8'))
    .replace('__PHYSICS_RUNTIME__', `res://${prefix}/physics-observation-base.gd`).replace('__PHYSICS_DOCUMENT__', `res://${prefix}/physics.json`);
  let source = (await fs.readFile(new URL('./godot4/physics-character-motion-runtime.gd', import.meta.url), 'utf8'))
    .replace('__PHYSICS_RUNTIME__', `res://${prefix}/character-motion-base.gd`).replace('__PHYSICS_DOCUMENT__', `res://${prefix}/physics.json`).replace('__MOTION_DOCUMENT__', `res://${prefix}/character-motion.json`);
  source = replaceOne(source, '\t\t\t\t\tvelocity.y = -motor["jumpSpeed"]', '\t\t\t\t\tvelocity.y = -motor["jumpSpeed"]\n\t\t\t\t\tcall("character_events_jump", instance_id)');
  return replaceOne(source, '\t\t\t\tcharacter_motion_grounded[instance_id] = grounded',
    '\t\t\t\tvar character_events_was_grounded: bool = character_motion_grounded[instance_id]\n\t\t\t\tcharacter_motion_grounded[instance_id] = grounded\n\t\t\t\tcall("character_events_ground", instance_id, character_events_was_grounded, grounded)');
}
export async function generateGodotPhysicsPlatformMotionProject(input) {
  if (input?.kind !== 'project') throw buildError('build_physics_requires_project', 'Scene physics currently requires a project assembly.');
  const plan = validateProjectAssemblyPlan(input), legacy = structuredClone(plan);
  const selected = plan.scenes.filter(scene => scene.physics?.document.bodies.some(body => body.platformMotion));
  for (const scene of legacy.scenes) {
    scene.requiredCapabilities = scene.requiredCapabilities.filter(value => value !== SCENE_PHYSICS2D_PLATFORM_MOTION_CAPABILITY);
    if (scene.physics?.document.schemaVersion !== 5) continue;
    scene.physics.document.schemaVersion = 4;
    for (const body of scene.physics.document.bodies) delete body.platformMotion;
  }
  legacy.requiredCapabilities = legacy.requiredCapabilities.filter(value => value !== SCENE_PHYSICS2D_PLATFORM_MOTION_CAPABILITY);
  const generated = await generateGodotPhysicsDropThroughProject(legacy);
  if (!selected.length) return generated;
  const helper = await fs.readFile(helperURL), generator = await fs.readFile(new URL('./godot4-physics-platform-motion.mjs', import.meta.url));
  for (const scene of selected) {
    const id = scene.scene.objectId, prefix = `scenes/${id}`, original = generated.files.get(`${prefix}/runtime.gd`);
    const motor = generated.files.has(`${prefix}/character-motion.json`), base = generated.files.get(`${prefix}/one-way-original.gd`);
    generated.files.set(`${prefix}/platform-motion-original.gd`, original);
    if (base) {
      generated.files.set(`${prefix}/platform-motion-one-way-original.gd`, base);
      const hooked = hook(base.toString(), id, motor);
      generated.files.set(`${prefix}/one-way-original.gd`, Buffer.from(hooked));
      generated.files.set(`${prefix}/runtime.gd`, Buffer.from(oneWay(hooked, id)));
    } else generated.files.set(`${prefix}/runtime.gd`, Buffer.from(hook(original.toString(), id, motor)));
    generated.files.set(`${prefix}/platform-motion.json`, Buffer.from(JSON.stringify({ format: 'viento-godot-platform-motion2d', schemaVersion: 1, sceneObjectId: id,
      bodies: scene.physics.document.bodies.filter(body => body.platformMotion).map(body => ({ bodyId: body.id, instanceId: body.instanceId, platformMotion: body.platformMotion })),
      characters: scene.physics.document.bodies.filter(body => body.characterMotion).map(body => body.instanceId) }, null, 2) + '\n'));
  }
  generated.files.set(helperName, helper);
  generated.files.set('platform-motion-project.json', Buffer.from(JSON.stringify({ format: 'viento-godot-platform-motion-project', schemaVersion: 1,
    sceneIds: selected.map(scene => scene.scene.objectId) }, null, 2) + '\n'));
  generated.backend = { ...generated.backend, version: '0.30.0', capabilities: [...generated.backend.capabilities, SCENE_PHYSICS2D_PLATFORM_MOTION_CAPABILITY],
    sha256: buildHash(Buffer.concat([Buffer.from(generated.backend.sha256), generator, helper])) };
  return generated;
}
export async function godotPhysicsPlatformMotionAssemblyScripts(directory, signal) {
  const read = async (name, limit = 65536) => readBuildFile(await resolveContainedPath(directory, path.join(directory, name)), limit, signal);
  const optional = async (name, limit) => { try { return await read(name, limit); } catch (error) { if (error.code === 'ENOENT') return null; invalid(); } };
  const inventory = await optional('platform-motion-project.json', 8192), helper = await optional(helperName);
  try {
    const assemblyBytes = await optional('assembly.json', 4 * 1024 * 1024), assembly = assemblyBytes === null ? [] : JSON.parse(assemblyBytes).scenes;
    const selected = [], added = [];
    for (const row of assembly) {
      const id = row.sceneId, prefix = `scenes/${id}`, originalName = `${prefix}/platform-motion-original.gd`, originalOneWayName = `${prefix}/platform-motion-one-way-original.gd`;
      const documentBytes = await optional(`${prefix}/platform-motion.json`), originalBytes = await optional(originalName), originalOneWay = await optional(originalOneWayName);
      const runtime = (await read(`${prefix}/runtime.gd`)).toString(), oldOneWay = await optional(`${prefix}/one-way-original.gd`);
      const touched = documentBytes !== null || originalBytes !== null || originalOneWay !== null || runtime.includes('platform_motion') || runtime.includes(helperName) || oldOneWay?.includes('platform_motion');
      if (inventory === null) { if (touched) invalid(); continue; }
      if (!touched) continue;
      if (documentBytes === null || originalBytes === null) invalid();
      const motionBytes = await optional(`${prefix}/character-motion.json`), platformBytes = await optional(`${prefix}/one-way.json`);
      const motor = motionBytes !== null, hasOneWay = platformBytes !== null, historical = await historicalRuntime(id, motor);
      if (originalBytes.toString() !== (hasOneWay ? oneWay(historical, id) : historical)) invalid();
      const hooked = hook(historical, id, motor);
      if (hasOneWay) {
        if (originalOneWay === null || originalOneWay.toString() !== historical || oldOneWay === null || oldOneWay.toString() !== hooked || runtime !== oneWay(hooked, id)) invalid();
        added.push(originalOneWayName);
      } else if (originalOneWay !== null || oldOneWay !== null || runtime !== hooked) invalid();
      const document = JSON.parse(documentBytes), declaration = JSON.parse(await read(`${prefix}/physics.json`, 131072));
      if (!exact(document, ['format', 'schemaVersion', 'sceneObjectId', 'bodies', 'characters']) || document.format !== 'viento-godot-platform-motion2d'
        || document.schemaVersion !== 1 || document.sceneObjectId !== id || !Array.isArray(document.bodies) || !document.bodies.length
        || document.bodies.length > declaration.bodies.length || new Set(document.bodies.map(body => body.bodyId)).size !== document.bodies.length
        || new Set(document.bodies.map(body => body.instanceId)).size !== document.bodies.length) invalid();
      const expectedCharacters = motor ? JSON.parse(motionBytes).bodies.map(body => body.instanceId) : [];
      if (!Array.isArray(document.characters) || document.characters.length !== expectedCharacters.length || document.characters.some((value, index) => value !== expectedCharacters[index])) invalid();
      for (const body of document.bodies) {
        const original = declaration.bodies.find(value => value.id === body.bodyId), motion = body.platformMotion;
        if (!exact(body, ['bodyId', 'instanceId', 'platformMotion']) || !original || original.instanceId !== body.instanceId || original.kind !== 'static' || original.shape.kind !== 'box'
          || !exact(motion, ['kind', 'offsetX', 'speed']) || motion.kind !== 'horizontal' || !Number.isFinite(motion.offsetX) || Math.abs(motion.offsetX) < 1 || Math.abs(motion.offsetX) > 8192
          || !Number.isFinite(motion.speed) || motion.speed < 1 || motion.speed > 2000) invalid();
      }
      selected.push(id); added.push(originalName);
    }
    if (inventory === null) { if (helper !== null) invalid(); return await godotPhysicsDropThroughAssemblyScripts(directory, signal); }
    if (helper === null || !helper.equals(await fs.readFile(helperURL))) invalid();
    const manifest = JSON.parse(inventory);
    if (!exact(manifest, ['format', 'schemaVersion', 'sceneIds']) || manifest.format !== 'viento-godot-platform-motion-project' || manifest.schemaVersion !== 1
      || !Array.isArray(manifest.sceneIds) || !selected.length || manifest.sceneIds.length !== selected.length || manifest.sceneIds.some((value, index) => value !== selected[index])) invalid();
    const scripts = await godotPhysicsDropThroughAssemblyScripts(directory, signal);
    if (!scripts) invalid();
    return [...scripts, helperName, ...added];
  } catch { invalid(); }
}
