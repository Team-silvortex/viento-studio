// Optional behavior intent for controls=none planar characters. Historical
// generator output and every original script remain independent of this layer.
import fs from 'node:fs/promises';
import { validateProjectAssemblyPlan } from '../../engine/project-assembly-plan.mjs';
import { generateGodotPhysicsPlatformControlProject, godotPhysicsPlatformControlAssemblyScripts } from './godot4-physics-platform-control.mjs';
import { buildError, buildHash } from '../adapters/node-build-snapshot.mjs';
import { PLANAR_INTENT_CAPABILITY, planarInventoryName, planarHelpers, planarSourceURL, planarInstanceIds, planarScenePath, planarBackupPath,
  planarMain, planarOriginalEntry, planarInheritanceProjection, planarSceneSource } from './godot4-physics-planar-intent-projection.mjs';
import { validateGodotPlanarIntentInventory } from './godot4-physics-planar-intent-inventory.mjs';
export { PLANAR_INTENT_CAPABILITY };
const invalid = () => { throw buildError('build_physics_planar_intent_invalid', 'Invalid generated planar intent projection.'); };
export async function generateGodotPhysicsPlanarIntentProject(input) {
  if (input?.kind !== 'project') throw buildError('build_physics_requires_project', 'Scene physics currently requires a project assembly.');
  const plan = validateProjectAssemblyPlan(input), generated = await generateGodotPhysicsPlatformControlProject(plan);
  const selected = plan.scenes.filter(scene => planarInstanceIds(scene).length);
  if (!selected.length) return generated;
  const [helper, port, wrapper] = await Promise.all(['helper', 'port', 'scene'].map(name => fs.readFile(planarSourceURL(name))));
  for (const name of [planarInventoryName, ...planarHelpers]) if (generated.files.has(name)) invalid();
  generated.files.set(planarHelpers[0], helper); generated.files.set(planarHelpers[1], port);
  for (const scene of selected) {
    const id = scene.scene.objectId, main = generated.files.get(`scenes/${id}/main.tscn`);
    if (!main || planarOriginalEntry(main.toString(), id) !== `scenes/${id}/${scene.physics.document.bodies.some(body => body.platformMotion) ? 'platform-control-scene' : 'project-scene'}.gd`) invalid();
    const projection = await planarInheritanceProjection(id, main.toString(), async name => {
      const bytes = generated.files.get(name); if (!bytes) invalid(); return bytes;
    });
    for (const [name, bytes] of projection.files) { if (generated.files.has(name)) invalid(); generated.files.set(name, bytes); }
    generated.files.set(planarBackupPath(id), main); generated.files.set(`scenes/${id}/main.tscn`, Buffer.from(planarMain(id)));
    generated.files.set(planarScenePath(id), Buffer.from(planarSceneSource(wrapper.toString(), projection.entry, planarInstanceIds(scene))));
  }
  const manifest = Buffer.from(JSON.stringify({ format: 'viento-godot-planar-intent-project', schemaVersion: 1,
    sceneIds: selected.map(scene => scene.scene.objectId) }, null, 2) + '\n');
  generated.files.set(planarInventoryName, manifest);
  generated.backend = { ...generated.backend, version: '0.41.0', capabilities: [...new Set([...generated.backend.capabilities, PLANAR_INTENT_CAPABILITY])],
    sha256: buildHash(Buffer.concat([Buffer.from(generated.backend.sha256), ...await Promise.all(['', '-projection', '-inventory'].map(suffix => fs.readFile(new URL(`./godot4-physics-planar-intent${suffix}.mjs`, import.meta.url)))), helper, port, wrapper, manifest])) };
  return generated;
}
export async function godotPhysicsPlanarIntentAssemblyScripts(directory, signal) {
  const planar = await validateGodotPlanarIntentInventory(directory, signal);
  const previous = await godotPhysicsPlatformControlAssemblyScripts(directory, signal);
  if (planar === null) return previous;
  if (!previous) invalid();
  return [...previous, ...planar.scripts];
}
