// Camera generation is a final optional view layer after the historical scene,
// physics and input-map generators. No legacy GD or original scene is replaced.
import fs from 'node:fs/promises';
import { validateProjectAssemblyPlan } from '../../engine/project-assembly-plan.mjs';
import { validateSceneCamera2DPlan } from '../../engine/scene-camera2d.mjs';
import { buildError, buildHash } from '../adapters/node-build-snapshot.mjs';
import { CAMERA2D_CAPABILITY, CAMERA2D_LIMITS_CAPABILITY, cameraLimitsSceneScript, cameraLimitsDocumentPath, cameraBaseDocument, cameraInventoryName, cameraOriginalSettingsName, cameraSceneScript, cameraProjectScript,
  cameraProjectScene, cameraSourceURL, cameraScenePath, cameraDocumentPath, cameraJson, cameraSettings,
  cameraProjectHost, cameraProjectMain, cameraSceneMain, cameraProjectSource, cameraInventory } from './godot4-camera2d-projection.mjs';
export { CAMERA2D_CAPABILITY, CAMERA2D_LIMITS_CAPABILITY };
const invalid = () => { throw buildError('build_camera2d_inventory_invalid', 'Invalid generated camera2d project.'); };
export async function applyGodotCamera2DProject(generated, input) {
  if (input?.kind !== 'project') throw buildError('build_camera2d_requires_project', 'Runtime camera2d currently requires a project assembly.');
  const plan = validateProjectAssemblyPlan(input), selected = plan.scenes.filter(scene => Object.hasOwn(scene, 'camera2d'));
  if (!selected.length) return generated;
  const cameras = selected.map(scene => ({ id: scene.scene.objectId, document: validateSceneCamera2DPlan(scene).document }));
  const bounded = cameras.some(camera => camera.document.schemaVersion === 2);
  const ids = cameras.map(camera => camera.id), original = generated.files.get('project.godot'), clockOriginal = generated.files.get('execution-clock-original.godot');
  const main = generated.files.get('project.tscn');
  if (!Buffer.isBuffer(original) || !Buffer.isBuffer(main)) invalid();
  const host = cameraProjectHost(main);
  if (!generated.files.has(host)) invalid();
  const [scene, project] = await Promise.all(['scene', 'project'].map(name => fs.readFile(cameraSourceURL(name))));
  const files = [[cameraInventoryName, cameraInventory(ids)], [cameraOriginalSettingsName, original],
    [cameraSceneScript, scene], ...(bounded ? [[cameraLimitsSceneScript, await fs.readFile(cameraSourceURL('limits-scene'))]] : []), [cameraProjectScript, cameraProjectSource(project, host, ids)], [cameraProjectScene, cameraProjectMain()],
    ...cameras.flatMap(camera => [[cameraScenePath(camera.id), cameraSceneMain(camera.id, camera.document.schemaVersion === 2)],
      [cameraDocumentPath(camera.id), cameraJson(cameraBaseDocument(camera.document))],
      ...(camera.document.schemaVersion === 2 ? [[cameraLimitsDocumentPath(camera.id), cameraJson(camera.document)]] : [])])];
  for (const [name] of files) if (generated.files.has(name)) invalid();
  const settings = cameraSettings(original), clockSettings = clockOriginal ? cameraSettings(clockOriginal) : null;
  for (const [name, bytes] of files) generated.files.set(name, bytes);
  generated.files.set('project.godot', settings);
  // Keep the historical scheduling layer's original+autoload invariant intact.
  if (clockSettings) generated.files.set('execution-clock-original.godot', clockSettings);
  generated.backend = { ...generated.backend, version: bounded ? '0.44.0' : '0.43.0', capabilities: [...new Set([...generated.backend.capabilities, CAMERA2D_CAPABILITY, ...(bounded ? [CAMERA2D_LIMITS_CAPABILITY] : [])])],
    sha256: buildHash(Buffer.concat([Buffer.from(generated.backend.sha256), settings, ...files.map(([, bytes]) => bytes),
      ...await Promise.all(['', '-projection', '-inventory'].map(suffix => fs.readFile(new URL(`./godot4-camera2d${suffix}.mjs`, import.meta.url))))])) };
  return generated;
}
