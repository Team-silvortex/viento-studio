// Collision responses extend only opted-in schema-2 physics projects. Legacy
// physical and non-physical generators retain their bytes and fingerprints.
import fs from 'node:fs/promises';
import path from 'node:path';
import { validateProjectAssemblyPlan } from '../../engine/project-assembly-plan.mjs';
import { SCENE_PHYSICS2D_SLIDE_CAPABILITY, scenePhysics2DCapabilities } from '../../engine/scene-physics2d.mjs';
import { generateGodotPhysicsProject, godotPhysicsAssemblyScripts } from './godot4-physics.mjs';
import { buildHash, buildError, readBuildFile } from '../adapters/node-build-snapshot.mjs';
import { resolveContainedPath } from '../lib/contained-path.mjs';

const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const invalid = () => { throw buildError('build_physics_invalid', 'Invalid generated physics response inventory.'); };
export const hasGodotPhysicsResponse = plan => (plan?.kind === 'project' ? plan.scenes : [plan])
  ?.some(scene => scene?.physics?.document?.schemaVersion === 2) === true;

export async function generateGodotPhysicsResponseProject(input) {
  if (input?.kind !== 'project') throw buildError('build_physics_requires_project', 'Scene physics currently requires a project assembly.');
  const plan = validateProjectAssemblyPlan(input);
  const selected = plan.scenes.filter(scene => scene.physics?.document.schemaVersion === 2);
  if (!selected.length) return generateGodotPhysicsProject(plan);
  // The old generator receives a complete legacy stop declaration. Response
  // semantics are then restored from the separately validated, detached plan.
  const legacy = structuredClone(plan);
  for (const scene of legacy.scenes) {
    scene.requiredCapabilities = scene.requiredCapabilities.filter(capability => capability !== SCENE_PHYSICS2D_SLIDE_CAPABILITY);
    if (scene.physics?.document.schemaVersion !== 2) continue;
    scene.physics.document.schemaVersion = 1;
    for (const body of scene.physics.document.bodies) delete body.collisionResponse;
  }
  legacy.requiredCapabilities = legacy.requiredCapabilities.filter(capability => capability !== SCENE_PHYSICS2D_SLIDE_CAPABILITY);
  const generated = await generateGodotPhysicsProject(legacy);
  const runtime = await fs.readFile(new URL('./godot4/physics-response-runtime.gd', import.meta.url));
  const generator = await fs.readFile(new URL('./godot4-physics-response.mjs', import.meta.url));
  for (const child of selected) {
    const prefix = `scenes/${child.scene.objectId}`, base = `${prefix}/physics-stop.gd`;
    generated.files.set(base, generated.files.get(`${prefix}/runtime.gd`));
    generated.files.set(`${prefix}/runtime.gd`, Buffer.from(runtime.toString().replace('__PHYSICS_RUNTIME__', `res://${base}`)
      .replace('__PHYSICS_DOCUMENT__', `res://${prefix}/physics.json`)));
    generated.files.set(`${prefix}/physics.json`, Buffer.from(JSON.stringify({ format: 'viento-godot-physics2d', schemaVersion: 2,
      sceneObjectId: child.scene.objectId, bodies: child.physics.document.bodies }, null, 2) + '\n'));
  }
  generated.files.set('physics-response-project.json', Buffer.from(JSON.stringify({ format: 'viento-godot-physics-response-project',
    schemaVersion: 1, sceneIds: selected.map(scene => scene.scene.objectId) }, null, 2) + '\n'));
  generated.backend = { ...generated.backend, version: '0.22.0', capabilities: [...new Set([...generated.backend.capabilities,
    ...selected.flatMap(scene => scenePhysics2DCapabilities(scene.physics.document))])],
  sha256: buildHash(Buffer.concat([Buffer.from(generated.backend.sha256), generator, runtime])) };
  return generated;
}

export async function godotPhysicsResponseAssemblyScripts(directory, signal) {
  const scripts = await godotPhysicsAssemblyScripts(directory, signal);
  if (!scripts) return null;
  const read = async (name, limit = 8192) => readBuildFile(await resolveContainedPath(directory, path.join(directory, name)), limit, signal);
  let inventory, response;
  try {
    inventory = JSON.parse(await read('physics-project.json'));
    try { response = JSON.parse(await read('physics-response-project.json')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const expected = [];
    for (const id of inventory.sceneIds) {
      const document = JSON.parse(await read(`scenes/${id}/physics.json`, 128 * 1024));
      if (document?.format !== 'viento-godot-physics2d' || ![1, 2].includes(document.schemaVersion) || document.sceneObjectId !== id) invalid();
      if (document.schemaVersion === 2) expected.push(id);
    }
    if (!response && !expected.length) return scripts;
    if (!exact(response, ['format', 'schemaVersion', 'sceneIds']) || response.format !== 'viento-godot-physics-response-project'
      || response.schemaVersion !== 1 || !Array.isArray(response.sceneIds) || !expected.length
      || response.sceneIds.length !== expected.length || response.sceneIds.some((id, index) => id !== expected[index])) invalid();
    const added = expected.map(id => `scenes/${id}/physics-stop.gd`);
    for (const name of added) await read(name, 65536);
    return [...scripts, ...added];
  } catch { invalid(); }
}
