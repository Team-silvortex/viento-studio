// Restart adds an independent port outside the complete retry layer. Historical
// factories, author scripts and business frames retain their original bytes.
import { buildHash } from '../adapters/node-build-snapshot.mjs';
import { retryInventoryName, retryProjectScript, retryProjectScene, retryProjectMain } from './godot4-scene-retry-projection.mjs';
export { retryInventoryName, retryProjectScript, retryProjectScene, retryProjectMain };
export { SCENE_RESTART_CAPABILITY } from '../../engine/scene-restart-capability.mjs';
export const restartInventoryName = 'restart-project.json';
export const restartOriginalSettingsName = 'restart-original.godot';
export const restartOriginalClockSettingsName = 'restart-original-clock.godot';
export const restartProjectScript = 'restart-project-runtime.gd';
export const restartProjectScene = 'restart-project.tscn';
export const restartSourceURL = new URL('./godot4/restart-project-runtime.gd', import.meta.url);
const invalid = () => { throw new TypeError('Invalid generated scene restart projection.'); };
export function restartInnerEntry(settings) {
  if (!Buffer.isBuffer(settings)) invalid();
  const matches = [...settings.toString().matchAll(/^run\/main_scene="res:\/\/([^"\r\n]+)"$/gm)];
  if (matches.length !== 1 || matches[0][1] !== retryProjectScene) invalid();
  return matches[0][1];
}
export function restartSettings(original) {
  const entry = restartInnerEntry(original);
  return Buffer.from(original.toString().replace(`run/main_scene="res://${entry}"`, `run/main_scene="res://${restartProjectScene}"`));
}
export function restartProjectSource(template) {
  if (!Buffer.isBuffer(template) || !template.toString().startsWith(`extends "res://${retryProjectScript}"\n`)) invalid();
  return Buffer.from(template);
}
export const restartProjectMain = () => Buffer.from(`[gd_scene load_steps=2 format=3]\n\n[ext_resource type="Script" path="res://${restartProjectScript}" id="1"]\n\n[node name="VientoProject" type="Node2D"]\nscript = ExtResource("1")\n`);
export const restartInventory = (settings, clock) => Buffer.from(JSON.stringify({
  format: 'viento-godot-scene-restart-project', schemaVersion: 1, maximumInitialValues: 16,
  inner: { entry: restartInnerEntry(settings), host: retryProjectScript, settingsSha256: buildHash(settings), clockSettingsSha256: clock === null ? null : buildHash(clock) },
}, null, 2) + '\n');
