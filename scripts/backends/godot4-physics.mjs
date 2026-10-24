// Physics is an optional generated-project wrapper, never a mutation of the
// historical scene/assembly generators or their no-physics fingerprints.
import fs from 'node:fs/promises';
import path from 'node:path';
import { validateProjectAssemblyPlan } from '../../engine/project-assembly-plan.mjs';
import { validateScenePhysics2DPlan, stripScenePhysics2DPlan, SCENE_PHYSICS2D_CAPABILITIES } from '../../engine/scene-physics2d.mjs';
import { generateGodotAssemblyProject, godotAssemblyScripts, godotAssemblyDiagnostics } from './godot4-project.mjs';
import { buildHash, buildError, readBuildFile } from '../adapters/node-build-snapshot.mjs';
import { resolveContainedPath } from '../lib/contained-path.mjs';

const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const exact = (value, names) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === names.length && names.every(name => Object.hasOwn(value, name));
const invalid = () => { throw buildError('build_physics_invalid', 'Invalid generated physics project inventory.'); };
const replaceOne = (value, from, to) => { if (value.split(from).length !== 2) invalid(); return value.replace(from, to); };
export const hasGodotPhysics = plan => plan?.kind === 'project' ? plan.scenes?.some(scene => Object.hasOwn(scene, 'physics')) === true : Boolean(plan && Object.hasOwn(plan, 'physics'));

function stripProject(plan) {
  return { ...structuredClone(plan), scenes: plan.scenes.map(scene => Object.hasOwn(scene, 'physics') ? stripScenePhysics2DPlan(scene) : structuredClone(scene)),
    requiredCapabilities: plan.requiredCapabilities.filter(capability => !SCENE_PHYSICS2D_CAPABILITIES.includes(capability)) };
}
export async function generateGodotPhysicsProject(input) {
  if (input?.kind !== 'project') throw buildError('build_physics_requires_project', 'Scene physics currently requires a project assembly.');
  const plan = validateProjectAssemblyPlan(input), selected = plan.scenes.filter(scene => Object.hasOwn(scene, 'physics'));
  if (!selected.length) return generateGodotAssemblyProject(plan);
  for (const child of selected) validateScenePhysics2DPlan(child);
  const generated = await generateGodotAssemblyProject(stripProject(plan));
  const runtime = await fs.readFile(new URL('./godot4/physics-runtime.gd', import.meta.url));
  const coordinator = await fs.readFile(new URL('./godot4/project-physics-runtime.gd', import.meta.url));
  const generator = await fs.readFile(new URL('./godot4-physics.mjs', import.meta.url));
  for (const child of selected) {
    const prefix = `scenes/${child.scene.objectId}`, base = `${prefix}/physics-base.gd`;
    generated.files.set(base, generated.files.get(`${prefix}/runtime.gd`));
    generated.files.set(`${prefix}/runtime.gd`, Buffer.from(runtime.toString().replace('__BASE_RUNTIME__', `res://${base}`)
      .replace('__PHYSICS_DOCUMENT__', `res://${prefix}/physics.json`)));
    generated.files.set(`${prefix}/physics.json`, Buffer.from(JSON.stringify({ format: 'viento-godot-physics2d', schemaVersion: 1,
      sceneObjectId: child.scene.objectId, bodies: child.physics.document.bodies }, null, 2) + '\n'));
    const mapped = generated.sourceMap.scenes.find(scene => scene.sceneId === child.scene.objectId).sourceMap;
    mapped.physics = { manifest: child.physics.manifest, bodies: child.physics.document.bodies.map(body => ({ bodyId: body.id, instanceId: body.instanceId,
      declaration: child.physics.locations.bodies.find(row => row.id === body.id).declaration })) };
  }
  const originalEntry = generated.files.get('project.tscn').toString();
  const match = originalEntry.match(/path="res:\/\/([a-z-]+\.gd)"/); if (!match) invalid();
  generated.files.set('project.tscn', Buffer.from(replaceOne(originalEntry, `path="res://${match[1]}"`, 'path="res://project-physics-runtime.gd"')));
  generated.files.set('project-physics-runtime.gd', Buffer.from(coordinator.toString().replace('__PROJECT_RUNTIME__', `res://${match[1]}`)));
  generated.files.set('physics-project.json', Buffer.from(JSON.stringify({ format: 'viento-godot-physics-project', schemaVersion: 1,
    sceneIds: selected.map(scene => scene.scene.objectId) }, null, 2) + '\n'));
  generated.backend = { ...generated.backend, version: '0.21.0', capabilities: [...new Set([...generated.backend.capabilities, ...SCENE_PHYSICS2D_CAPABILITIES])],
    sha256: buildHash(Buffer.concat([Buffer.from(generated.backend.sha256), generator, runtime, coordinator])) };
  return generated;
}

export async function godotPhysicsAssemblyScripts(directory, signal) {
  let manifest;
  try { manifest = JSON.parse(await readBuildFile(await resolveContainedPath(directory, path.join(directory, 'physics-project.json')), 8192, signal)); }
  catch (error) { if (error.code === 'ENOENT') return null; invalid(); }
  if (!exact(manifest, ['format', 'schemaVersion', 'sceneIds']) || manifest.format !== 'viento-godot-physics-project' || manifest.schemaVersion !== 1
    || !Array.isArray(manifest.sceneIds) || manifest.sceneIds.length < 1 || manifest.sceneIds.length > 32
    || new Set(manifest.sceneIds).size !== manifest.sceneIds.length || manifest.sceneIds.some(id => !uuid(id))) invalid();
  const scripts = await godotAssemblyScripts(directory, signal); if (!scripts) invalid();
  const added = ['project-physics-runtime.gd'];
  for (const id of manifest.sceneIds) {
    if (!scripts.includes(`scenes/${id}/runtime.gd`)) invalid();
    added.push(`scenes/${id}/physics-base.gd`);
  }
  for (const script of added) await readBuildFile(await resolveContainedPath(directory, path.join(directory, script)), 65536, signal);
  return [...scripts, ...added];
}

export function godotPhysicsDiagnostics(result, plan) {
  const diagnostics = godotAssemblyDiagnostics(result, stripProject(plan));
  const lines = `${result.stdout}\n${result.stderr}`.replace(/\x1b\[[0-9;]*m/g, '').split('\n');
  for (const item of diagnostics) {
    const index = lines.findIndex(line => line.trim().slice(0, 4096) === item.message), vicinity = lines.slice(index, index + 4).join('\n');
    const child = plan.scenes.find(scene => scene.physics && vicinity.includes(`res://scenes/${scene.scene.objectId}/runtime.gd`));
    if (index >= 0 && child) Object.assign(item, child.physics.manifest, { propertyPath: '' });
  }
  return diagnostics;
}
