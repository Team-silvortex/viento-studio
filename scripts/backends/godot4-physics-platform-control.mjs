// Behavior-local platform control is independent of author geometry, events
// and rendering. Projects with no moving platform retain their old output.
import fs from 'node:fs/promises';
import { validateProjectAssemblyPlan } from '../../engine/project-assembly-plan.mjs';
import { generateGodotPhysicsPlatformVerticalProject, godotPhysicsPlatformVerticalAssemblyScripts } from './godot4-physics-platform-vertical.mjs';
import { buildError, buildHash } from '../adapters/node-build-snapshot.mjs';
import { PLATFORM_CONTROL_CAPABILITY, controlInventoryName, controlHelpers, controlPortName, controlSourceURL,
  controlOriginalMain, controlMain, controlHelperSource, controlGroundSource, controlSceneSource,
  validateGodotPlatformControlInventory } from './godot4-physics-platform-control-inventory.mjs';
export { PLATFORM_CONTROL_CAPABILITY };
const invalid = () => { throw buildError('build_physics_platform_control_invalid', 'Invalid generated platform control projection.'); };
export async function generateGodotPhysicsPlatformControlProject(input) {
  if (input?.kind !== 'project') throw buildError('build_physics_requires_project', 'Scene physics currently requires a project assembly.');
  const plan = validateProjectAssemblyPlan(input);
  const selected = plan.scenes.filter(scene => scene.physics?.document.bodies.some(body => body.platformMotion));
  const generated = await generateGodotPhysicsPlatformVerticalProject(plan);
  if (!selected.length) return generated;
  const [helper, port, wrapper, verticalWrapper] = await Promise.all([
    fs.readFile(controlSourceURL('helper'), 'utf8'), fs.readFile(controlSourceURL('port')), fs.readFile(controlSourceURL('scene'), 'utf8'),
    fs.readFile(new URL('./godot4/physics-platform-vertical-scene.gd', import.meta.url), 'utf8'),
  ]);
  for (const name of [...controlHelpers, controlPortName, controlInventoryName]) if (generated.files.has(name)) invalid();
  const variants = new Set(), hasDrop = generated.files.has('drop-through-helper.gd');
  for (const scene of selected) {
    const id = scene.scene.objectId, prefix = `scenes/${id}`, vertical = scene.physics.document.bodies.some(body => body.platformMotion?.kind === 'vertical');
    const original = generated.files.get(`${prefix}/main.tscn`);
    if (!original || original.toString() !== controlOriginalMain(id, vertical)) invalid();
    const ids = scene.physics.document.bodies.filter(body => body.platformMotion).map(body => body.instanceId);
    generated.files.set(`${prefix}/platform-control-original.tscn.txt`, original);
    generated.files.set(`${prefix}/main.tscn`, Buffer.from(controlMain(id)));
    generated.files.set(`${prefix}/platform-control-scene.gd`, Buffer.from(controlSceneSource(wrapper, id, ids,
      { vertical, drop: hasDrop, ground: controlGroundSource(verticalWrapper) })));
    variants.add(vertical ? 1 : 0);
  }
  generated.files.set(controlPortName, port);
  for (const variant of [...variants].sort()) generated.files.set(controlHelpers[variant], Buffer.from(controlHelperSource(helper, variant === 1)));
  const manifest = Buffer.from(JSON.stringify({ format: 'viento-godot-platform-control-project', schemaVersion: 1,
    sceneIds: selected.map(scene => scene.scene.objectId) }, null, 2) + '\n');
  generated.files.set(controlInventoryName, manifest);
  generated.backend = { ...generated.backend, version: '0.40.0', capabilities: [...new Set([...generated.backend.capabilities, PLATFORM_CONTROL_CAPABILITY])],
    sha256: buildHash(Buffer.concat([Buffer.from(generated.backend.sha256), await fs.readFile(new URL('./godot4-physics-platform-control.mjs', import.meta.url)),
      await fs.readFile(new URL('./godot4-physics-platform-control-inventory.mjs', import.meta.url)), Buffer.from(helper), port, Buffer.from(wrapper), manifest])) };
  return generated;
}
export async function godotPhysicsPlatformControlAssemblyScripts(directory, signal) {
  const controls = await validateGodotPlatformControlInventory(directory, signal);
  const previous = await godotPhysicsPlatformVerticalAssemblyScripts(directory, signal);
  if (controls === null) return previous;
  if (!previous) invalid();
  return [...previous, ...controls.scripts];
}
