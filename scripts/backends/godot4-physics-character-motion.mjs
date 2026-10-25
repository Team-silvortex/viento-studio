// Opt-in character motion wraps the frozen response and observation generators.
import fs from 'node:fs/promises';
import path from 'node:path';
import { validateProjectAssemblyPlan } from '../../engine/project-assembly-plan.mjs';
import { SCENE_PHYSICS2D_MOTION_CAPABILITY } from '../../engine/scene-physics2d.mjs';
import { generateGodotPhysicsObservationProject, godotPhysicsObservationAssemblyScripts } from './godot4-physics-observation.mjs';
import { buildHash, buildError, readBuildFile } from '../adapters/node-build-snapshot.mjs';
import { resolveContainedPath } from '../lib/contained-path.mjs';

const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const invalid = () => { throw buildError('build_physics_character_motion_invalid', 'Invalid generated character motion inventory.'); };
export const hasGodotPhysicsCharacterMotion = plan => (plan?.kind === 'project' ? plan.scenes : [plan])
  ?.some(scene => scene?.physics?.document?.schemaVersion === 3) === true;

export async function generateGodotPhysicsCharacterMotionProject(input) {
  if (input?.kind !== 'project') throw buildError('build_physics_requires_project', 'Scene physics currently requires a project assembly.');
  const plan = validateProjectAssemblyPlan(input), legacy = structuredClone(plan);
  const selected = plan.scenes.filter(scene => scene.physics?.document.bodies.some(body => body.characterMotion));
  // Format 3 remains buildable after the last motor is removed. Old generators
  // receive only format 2, retaining their file formats and runtime protocols.
  for (const scene of legacy.scenes) {
    scene.requiredCapabilities = scene.requiredCapabilities.filter(value => value !== SCENE_PHYSICS2D_MOTION_CAPABILITY);
    if (scene.physics?.document.schemaVersion !== 3) continue;
    scene.physics.document.schemaVersion = 2;
    for (const body of scene.physics.document.bodies) delete body.characterMotion;
  }
  legacy.requiredCapabilities = legacy.requiredCapabilities.filter(value => value !== SCENE_PHYSICS2D_MOTION_CAPABILITY);
  const generated = await generateGodotPhysicsObservationProject(legacy);
  if (!selected.length) return generated;
  const runtime = await fs.readFile(new URL('./godot4/physics-character-motion-runtime.gd', import.meta.url));
  const generator = await fs.readFile(new URL('./godot4-physics-character-motion.mjs', import.meta.url));
  for (const child of selected) {
    const prefix = `scenes/${child.scene.objectId}`, base = `${prefix}/character-motion-base.gd`;
    generated.files.set(base, generated.files.get(`${prefix}/runtime.gd`));
    generated.files.set(`${prefix}/runtime.gd`, Buffer.from(runtime.toString().replace('__PHYSICS_RUNTIME__', `res://${base}`)
      .replace('__PHYSICS_DOCUMENT__', `res://${prefix}/physics.json`).replace('__MOTION_DOCUMENT__', `res://${prefix}/character-motion.json`)));
    generated.files.set(`${prefix}/character-motion.json`, Buffer.from(JSON.stringify({ format: 'viento-godot-character-motion2d', schemaVersion: 1,
      sceneObjectId: child.scene.objectId, bodies: child.physics.document.bodies.filter(body => body.characterMotion)
        .map(body => ({ bodyId: body.id, instanceId: body.instanceId, characterMotion: body.characterMotion })) }, null, 2) + '\n'));
  }
  generated.files.set('character-motion-project.json', Buffer.from(JSON.stringify({ format: 'viento-godot-character-motion-project',
    schemaVersion: 1, sceneIds: selected.map(scene => scene.scene.objectId) }, null, 2) + '\n'));
  generated.backend = { ...generated.backend, version: '0.24.0', capabilities: [...generated.backend.capabilities, SCENE_PHYSICS2D_MOTION_CAPABILITY],
    sha256: buildHash(Buffer.concat([Buffer.from(generated.backend.sha256), generator, runtime])) };
  return generated;
}

export async function godotPhysicsCharacterMotionAssemblyScripts(directory, signal) {
  const scripts = await godotPhysicsObservationAssemblyScripts(directory, signal);
  const read = async (name, limit = 8192) => readBuildFile(await resolveContainedPath(directory, path.join(directory, name)), limit, signal);
  const optional = async (name, limit) => {
    try { return await read(name, limit); } catch (error) { if (error.code === 'ENOENT') return null; invalid(); }
  };
  const inventory = await optional('character-motion-project.json');
  if (!scripts) { if (inventory !== null) invalid(); return null; }
  try {
    const physical = JSON.parse(await read('physics-project.json')), selected = [], added = [];
    for (const id of physical.sceneIds) {
      const prefix = `scenes/${id}`, base = `${prefix}/character-motion-base.gd`;
      const documentBytes = await optional(`${prefix}/character-motion.json`, 65536), baseBytes = await optional(base, 65536);
      const entry = (await read(`${prefix}/runtime.gd`, 65536)).toString();
      if (documentBytes === null && baseBytes === null && !entry.includes('character-motion-base.gd')) continue;
      if (documentBytes === null || baseBytes === null || entry.split(`extends "res://${base}"`).length !== 2) invalid();
      const document = JSON.parse(documentBytes), declaration = JSON.parse(await read(`${prefix}/physics.json`, 131072));
      if (!exact(document, ['format', 'schemaVersion', 'sceneObjectId', 'bodies']) || document.format !== 'viento-godot-character-motion2d'
        || document.schemaVersion !== 1 || document.sceneObjectId !== id || !Array.isArray(document.bodies) || !document.bodies.length
        || document.bodies.length > declaration.bodies.length || new Set(document.bodies.map(body => body.bodyId)).size !== document.bodies.length) invalid();
      for (const body of document.bodies) {
        const original = declaration.bodies.find(value => value.id === body.bodyId), motion = body.characterMotion;
        if (!exact(body, ['bodyId', 'instanceId', 'characterMotion']) || !original || original.instanceId !== body.instanceId
          || original.kind !== 'character' || original.collisionResponse !== 'slide'
          || !exact(motion, ['kind', 'gravity', 'jumpSpeed', 'maxFallSpeed']) || motion.kind !== 'platformer'
          || ![['gravity', 1, 20000], ['jumpSpeed', 0, 4000], ['maxFallSpeed', 1, 4000]].every(([key, min, max]) =>
            Number.isFinite(motion[key]) && motion[key] >= min && motion[key] <= max)) invalid();
      }
      selected.push(id); added.push(base);
    }
    if (inventory === null) { if (selected.length) invalid(); return scripts; }
    const manifest = JSON.parse(inventory);
    if (!exact(manifest, ['format', 'schemaVersion', 'sceneIds']) || manifest.format !== 'viento-godot-character-motion-project'
      || manifest.schemaVersion !== 1 || !Array.isArray(manifest.sceneIds) || !selected.length
      || manifest.sceneIds.length !== selected.length || manifest.sceneIds.some((id, index) => id !== selected[index])) invalid();
    return [...scripts, ...added];
  } catch { invalid(); }
}
