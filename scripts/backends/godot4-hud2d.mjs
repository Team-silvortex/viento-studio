import fs from 'node:fs/promises';
import { validateProjectAssemblyPlan } from '../../engine/project-assembly-plan.mjs';
import { validateSceneHUD2DPlan } from '../../engine/scene-hud2d.mjs';
import { buildError, buildHash } from '../adapters/node-build-snapshot.mjs';
import { HUD2D_CAPABILITY, hudInventoryName, hudOriginalSettingsName, hudOriginalClockSettingsName, hudProjectScript, hudSceneScript, hudProjectScene,
  hudSourceURL, hudDocumentPath, hudJson, hudInnerEntry, hudSettings, hudProjectHost, hudProjectMain, hudProjectSource, hudInventory } from './godot4-hud2d-projection.mjs';
export { HUD2D_CAPABILITY };
const invalid = () => { throw buildError('build_hud2d_inventory_invalid', 'Invalid generated HUD2D project.'); };
export async function applyGodotHUD2DProject(generated, input) {
  if (input?.kind !== 'project') throw buildError('build_hud2d_requires_project', 'HUD2D currently requires a project assembly.');
  const plan = validateProjectAssemblyPlan(input), selected = plan.scenes.filter(scene => Object.hasOwn(scene, 'hud2d'));
  if (!selected.length) return generated;
  const huds = selected.map(scene => ({ id: scene.scene.objectId, document: validateSceneHUD2DPlan(scene).document })), ids = huds.map(hud => hud.id);
  const original = generated.files.get('project.godot'), clockOriginal = generated.files.get('execution-clock-original.godot');
  if (!Buffer.isBuffer(original)) invalid();
  const entry = hudInnerEntry(original), main = generated.files.get(entry); if (!Buffer.isBuffer(main)) invalid();
  const host = hudProjectHost(main); if (!generated.files.has(host)) invalid();
  const [scene, project] = await Promise.all(['scene', 'project'].map(name => fs.readFile(hudSourceURL(name))));
  const files = [[hudInventoryName, hudInventory(ids)], [hudOriginalSettingsName, original],
    ...(clockOriginal ? [[hudOriginalClockSettingsName, clockOriginal]] : []),
    [hudSceneScript, scene], [hudProjectScript, hudProjectSource(project, host, ids)], [hudProjectScene, hudProjectMain()],
    ...huds.map(hud => [hudDocumentPath(hud.id), hudJson(hud.document)])];
  for (const [name] of files) if (generated.files.has(name)) invalid();
  const settings = hudSettings(original), clockSettings = clockOriginal ? hudSettings(clockOriginal) : null;
  for (const [name, bytes] of files) generated.files.set(name, bytes);
  generated.files.set('project.godot', settings); if (clockSettings) generated.files.set('execution-clock-original.godot', clockSettings);
  generated.backend = { ...generated.backend, version: '0.45.0', capabilities: [...new Set([...generated.backend.capabilities, HUD2D_CAPABILITY])],
    sha256: buildHash(Buffer.concat([Buffer.from(generated.backend.sha256), settings, ...files.map(([, bytes]) => bytes),
      ...await Promise.all(['', '-projection', '-inventory'].map(suffix => fs.readFile(new URL(`./godot4-hud2d${suffix}.mjs`, import.meta.url))))])) };
  return generated;
}
