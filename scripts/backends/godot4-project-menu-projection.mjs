// Menu is an optional outer capability. The complete pause/restart/retry/runtime
// stack is retained byte-for-byte and consumed only after this authentication.
import { buildHash } from '../adapters/node-build-snapshot.mjs';
import { pauseInventoryName, pauseProjectScript, pauseProjectScene, pauseProjectMain } from './godot4-project-pause-projection.mjs';
export { pauseInventoryName, pauseProjectScript, pauseProjectScene, pauseProjectMain };
export { PROJECT_MENU_CAPABILITY } from '../../engine/scene-menu-capability.mjs';
export const menuInventoryName = 'project-menu.json';
export const menuOriginalSettingsName = 'project-menu-original.godot';
export const menuOriginalClockSettingsName = 'project-menu-original-clock.godot';
export const menuProjectScript = 'project-menu-runtime.gd';
export const menuInputScript = 'project-menu-input.gd';
export const menuProjectScene = 'project-menu.tscn';
export const menuSourceURL = new URL('./godot4/project-menu-runtime.gd', import.meta.url);
export const menuInputSourceURL = new URL('./godot4/project-menu-input.gd', import.meta.url);
const invalid = () => { throw new TypeError('Invalid generated project menu projection.'); };
export function menuInnerEntry(settings) {
  if (!Buffer.isBuffer(settings)) invalid();
  const matches = [...settings.toString().matchAll(/^run\/main_scene="res:\/\/([^"\r\n]+)"$/gm)];
  if (matches.length !== 1 || matches[0][1] !== pauseProjectScene) invalid();
  return matches[0][1];
}
export function menuSettings(original) {
  const entry = menuInnerEntry(original);
  return Buffer.from(original.toString().replace(`run/main_scene="res://${entry}"`, `run/main_scene="res://${menuProjectScene}"`));
}
export function menuProjectSource(template) {
  if (!Buffer.isBuffer(template) || !template.toString().startsWith(`extends "res://${pauseProjectScript}"\n`)) invalid();
  return Buffer.from(template);
}
export function menuInputSource(template) {
  if (!Buffer.isBuffer(template) || !template.toString().startsWith('extends Node\n')) invalid();
  return Buffer.from(template);
}
export const menuProjectMain = () => Buffer.from(`[gd_scene load_steps=2 format=3]\n\n[ext_resource type="Script" path="res://${menuProjectScript}" id="1"]\n\n[node name="VientoProject" type="Node2D"]\nscript = ExtResource("1")\n`);
export const menuInventory = (settings, clock) => Buffer.from(JSON.stringify({
  format: 'viento-godot-project-menu', schemaVersion: 1,
  inner: { entry: menuInnerEntry(settings), host: pauseProjectScript, settingsSha256: buildHash(settings), clockSettingsSha256: clock === null ? null : buildHash(clock) },
}, null, 2) + '\n');
