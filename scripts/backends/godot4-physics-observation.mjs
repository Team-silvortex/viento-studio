// Smoke-only physical observations wrap the existing generators. Their files,
// author formats and project runtime protocols keep their original contracts.
import fs from 'node:fs/promises';
import path from 'node:path';
import { validateProjectAssemblyPlan } from '../../engine/project-assembly-plan.mjs';
import { generateGodotPhysicsProject, hasGodotPhysics } from './godot4-physics.mjs';
import { generateGodotPhysicsResponseProject, hasGodotPhysicsResponse, godotPhysicsResponseAssemblyScripts } from './godot4-physics-response.mjs';
import { buildHash, buildError, readBuildFile } from '../adapters/node-build-snapshot.mjs';
import { resolveContainedPath } from '../lib/contained-path.mjs';

export const GODOT_PHYSICS_OBSERVATION_CAPABILITY = 'physics.observe2d';
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const invalid = () => { throw buildError('build_physics_observation_invalid', 'Invalid generated physics observation inventory.'); };
const replaceOne = (value, before, after) => {
  if (value.split(before).length !== 2) invalid();
  return value.replace(before, after);
};

export async function generateGodotPhysicsObservationProject(input) {
  if (input?.kind !== 'project') throw buildError('build_physics_requires_project', 'Scene physics currently requires a project assembly.');
  const plan = validateProjectAssemblyPlan(input);
  const generated = await (hasGodotPhysicsResponse(plan) ? generateGodotPhysicsResponseProject : generateGodotPhysicsProject)(plan);
  if (!hasGodotPhysics(plan)) return generated;
  const selected = plan.scenes.filter(scene => Object.hasOwn(scene, 'physics'));
  const runtime = await fs.readFile(new URL('./godot4/physics-observation-runtime.gd', import.meta.url));
  const coordinator = await fs.readFile(new URL('./godot4/project-physics-observation-runtime.gd', import.meta.url));
  const generator = await fs.readFile(new URL('./godot4-physics-observation.mjs', import.meta.url));
  for (const child of selected) {
    const prefix = `scenes/${child.scene.objectId}`, base = `${prefix}/physics-observation-base.gd`;
    generated.files.set(base, generated.files.get(`${prefix}/runtime.gd`));
    generated.files.set(`${prefix}/runtime.gd`, Buffer.from(runtime.toString()
      .replace('__PHYSICS_RUNTIME__', `res://${base}`).replace('__PHYSICS_DOCUMENT__', `res://${prefix}/physics.json`)));
  }
  generated.files.set('project-physics-observation-runtime.gd', coordinator);
  generated.files.set('project.tscn', Buffer.from(replaceOne(generated.files.get('project.tscn').toString(),
    'path="res://project-physics-runtime.gd"', 'path="res://project-physics-observation-runtime.gd"')));
  generated.files.set('physics-observation-project.json', Buffer.from(JSON.stringify({ format: 'viento-godot-physics-observation-project',
    schemaVersion: 1, sceneIds: selected.map(scene => scene.scene.objectId) }, null, 2) + '\n'));
  generated.backend = { ...generated.backend, version: '0.23.0',
    capabilities: [...generated.backend.capabilities, GODOT_PHYSICS_OBSERVATION_CAPABILITY],
    sha256: buildHash(Buffer.concat([Buffer.from(generated.backend.sha256), generator, runtime, coordinator])) };
  return generated;
}

export async function godotPhysicsObservationAssemblyScripts(directory, signal) {
  const scripts = await godotPhysicsResponseAssemblyScripts(directory, signal);
  const read = async (name, maximum = 8192) => readBuildFile(await resolveContainedPath(directory, path.join(directory, name)), maximum, signal);
  const optional = async (name, maximum) => {
    try { return await read(name, maximum); }
    catch (error) { if (error.code === 'ENOENT') return null; invalid(); }
  };
  const inventory = await optional('physics-observation-project.json');
  const coordinator = await optional('project-physics-observation-runtime.gd', 65536);
  if (inventory === null) {
    if (coordinator !== null) invalid();
    if (scripts) {
      const entry = (await read('project.tscn')).toString();
      if (entry.includes('project-physics-observation-runtime.gd')) invalid();
      const physical = JSON.parse(await read('physics-project.json'));
      for (const id of physical.sceneIds) if (await optional(`scenes/${id}/physics-observation-base.gd`, 65536) !== null) invalid();
    }
    return scripts;
  }
  if (!scripts || coordinator === null) invalid();
  try {
    const observation = JSON.parse(inventory), physical = JSON.parse(await read('physics-project.json'));
    const entry = (await read('project.tscn')).toString();
    if (!exact(observation, ['format', 'schemaVersion', 'sceneIds'])
      || observation.format !== 'viento-godot-physics-observation-project' || observation.schemaVersion !== 1
      || !Array.isArray(observation.sceneIds) || observation.sceneIds.length !== physical.sceneIds.length
      || observation.sceneIds.some((id, index) => id !== physical.sceneIds[index])
      || entry.split('path="res://project-physics-observation-runtime.gd"').length !== 2) invalid();
    const added = ['project-physics-observation-runtime.gd', ...observation.sceneIds.map(id => `scenes/${id}/physics-observation-base.gd`)];
    for (const name of added) await read(name, 65536);
    return [...scripts, ...added];
  } catch { invalid(); }
}
