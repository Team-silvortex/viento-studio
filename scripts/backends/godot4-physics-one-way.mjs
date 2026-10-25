// Native one-way shapes extend generated projects without changing movement,
// behavior lifetime, project protocols, or any historical physics generator.
import fs from 'node:fs/promises';
import path from 'node:path';
import { validateProjectAssemblyPlan } from '../../engine/project-assembly-plan.mjs';
import { SCENE_PHYSICS2D_ONE_WAY_CAPABILITY } from '../../engine/scene-physics2d.mjs';
import { generateGodotPhysicsCharacterEventsProject, godotPhysicsCharacterEventsAssemblyScripts } from './godot4-physics-character-events.mjs';
import { buildHash, buildError, readBuildFile } from '../adapters/node-build-snapshot.mjs';
import { resolveContainedPath } from '../lib/contained-path.mjs';

const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const invalid = () => { throw buildError('build_physics_one_way_invalid', 'Invalid generated one-way platform inventory.'); };
const ready = 'func _ready() -> void:\n\tsuper._ready()';
function install(source, sceneId) {
  if (source.split(ready).length !== 2 || source.includes('physics-one-way-helper.gd')) invalid();
  return source.replace(ready, ready + `\n\tif not preload("res://physics-one-way-helper.gd").install(self, "res://scenes/${sceneId}/one-way.json"):\n\t\treturn`);
}
export const hasGodotPhysicsOneWay = plan => (plan?.kind === 'project' ? plan.scenes : [plan])
  ?.some(scene => scene?.physics?.document?.schemaVersion === 4) === true;

export async function generateGodotPhysicsOneWayProject(input) {
  if (input?.kind !== 'project') throw buildError('build_physics_requires_project', 'Scene physics currently requires a project assembly.');
  const plan = validateProjectAssemblyPlan(input), legacy = structuredClone(plan);
  const selected = plan.scenes.filter(scene => scene.physics?.document.bodies.some(body => body.oneWay));
  for (const scene of legacy.scenes) {
    scene.requiredCapabilities = scene.requiredCapabilities.filter(value => value !== SCENE_PHYSICS2D_ONE_WAY_CAPABILITY);
    if (scene.physics?.document.schemaVersion !== 4) continue;
    scene.physics.document.schemaVersion = 3;
    for (const body of scene.physics.document.bodies) delete body.oneWay;
  }
  legacy.requiredCapabilities = legacy.requiredCapabilities.filter(value => value !== SCENE_PHYSICS2D_ONE_WAY_CAPABILITY);
  const generated = await generateGodotPhysicsCharacterEventsProject(legacy);
  if (!selected.length) return generated;
  const helper = await fs.readFile(new URL('./godot4/physics-one-way-helper.gd', import.meta.url));
  const generator = await fs.readFile(new URL('./godot4-physics-one-way.mjs', import.meta.url));
  for (const child of selected) {
    const sceneId = child.scene.objectId, prefix = `scenes/${sceneId}`, source = generated.files.get(`${prefix}/runtime.gd`);
    generated.files.set(`${prefix}/one-way-original.gd`, source);
    generated.files.set(`${prefix}/runtime.gd`, Buffer.from(install(source.toString(), sceneId)));
    generated.files.set(`${prefix}/one-way.json`, Buffer.from(JSON.stringify({ format: 'viento-godot-one-way2d', schemaVersion: 1,
      sceneObjectId: sceneId, bodies: child.physics.document.bodies.filter(body => body.oneWay)
        .map(body => ({ bodyId: body.id, instanceId: body.instanceId, oneWay: body.oneWay })) }, null, 2) + '\n'));
  }
  generated.files.set('physics-one-way-helper.gd', helper);
  generated.files.set('one-way-project.json', Buffer.from(JSON.stringify({ format: 'viento-godot-one-way-project', schemaVersion: 1,
    sceneIds: selected.map(scene => scene.scene.objectId) }, null, 2) + '\n'));
  generated.backend = { ...generated.backend, version: '0.26.0', capabilities: [...generated.backend.capabilities, SCENE_PHYSICS2D_ONE_WAY_CAPABILITY],
    sha256: buildHash(Buffer.concat([Buffer.from(generated.backend.sha256), generator, helper])) };
  return generated;
}

export async function godotPhysicsOneWayAssemblyScripts(directory, signal) {
  const scripts = await godotPhysicsCharacterEventsAssemblyScripts(directory, signal);
  const read = async (name, limit = 8192) => readBuildFile(await resolveContainedPath(directory, path.join(directory, name)), limit, signal);
  const optional = async (name, limit) => {
    try { return await read(name, limit); } catch (error) { if (error.code === 'ENOENT') return null; invalid(); }
  };
  const inventory = await optional('one-way-project.json'), helper = await optional('physics-one-way-helper.gd', 65536);
  try {
    const assemblyBytes = await optional('assembly.json', 4 * 1024 * 1024), selected = [], added = [];
    const physicalBytes = await optional('physics-project.json'), physical = physicalBytes === null ? [] : JSON.parse(physicalBytes).sceneIds;
    for (const row of assemblyBytes === null ? [] : JSON.parse(assemblyBytes).scenes) {
      const id = row.sceneId, prefix = `scenes/${id}`, original = `${prefix}/one-way-original.gd`;
      const originalBytes = await optional(original, 65536), documentBytes = await optional(`${prefix}/one-way.json`, 65536);
      const runtime = (await read(`${prefix}/runtime.gd`, 65536)).toString();
      if (originalBytes === null && documentBytes === null && !runtime.includes('physics-one-way-helper.gd') && !runtime.includes('one-way.json')) continue;
      if (!scripts || !physical.includes(id) || originalBytes === null || documentBytes === null
        || runtime !== install(originalBytes.toString(), id)) invalid();
      const document = JSON.parse(documentBytes), declaration = JSON.parse(await read(`${prefix}/physics.json`, 131072));
      if (!exact(document, ['format', 'schemaVersion', 'sceneObjectId', 'bodies']) || document.format !== 'viento-godot-one-way2d'
        || document.schemaVersion !== 1 || document.sceneObjectId !== id || !Array.isArray(document.bodies) || !document.bodies.length
        || document.bodies.length > declaration.bodies.length || new Set(document.bodies.map(body => body.bodyId)).size !== document.bodies.length
        || new Set(document.bodies.map(body => body.instanceId)).size !== document.bodies.length) invalid();
      for (const body of document.bodies) {
        const declared = declaration.bodies.find(value => value.id === body.bodyId);
        if (!exact(body, ['bodyId', 'instanceId', 'oneWay']) || !declared || declared.instanceId !== body.instanceId
          || declared.kind !== 'static' || declared.shape.kind !== 'box' || !exact(body.oneWay, ['margin'])
          || !Number.isFinite(body.oneWay.margin) || body.oneWay.margin < 1 || body.oneWay.margin > 64) invalid();
      }
      selected.push(id); added.push(original);
    }
    if (inventory === null) { if (helper !== null || selected.length) invalid(); return scripts; }
    if (!scripts || helper === null) invalid();
    const manifest = JSON.parse(inventory);
    if (!exact(manifest, ['format', 'schemaVersion', 'sceneIds']) || manifest.format !== 'viento-godot-one-way-project'
      || manifest.schemaVersion !== 1 || !Array.isArray(manifest.sceneIds) || !selected.length
      || manifest.sceneIds.length !== selected.length || manifest.sceneIds.some((id, index) => id !== selected[index])) invalid();
    return [...scripts, 'physics-one-way-helper.gd', ...added];
  } catch { invalid(); }
}
