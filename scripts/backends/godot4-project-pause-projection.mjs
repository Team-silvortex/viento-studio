// Pause is an optional outer capability. The complete restart/retry/runtime
// stack is retained byte-for-byte and consumed only after this authentication.
import { buildHash } from '../adapters/node-build-snapshot.mjs';
import { restartInventoryName, restartProjectScript, restartProjectScene, restartProjectMain } from './godot4-scene-restart-projection.mjs';
export { restartInventoryName, restartProjectScript, restartProjectScene, restartProjectMain };
export { PROJECT_PAUSE_CAPABILITY } from '../../engine/scene-pause-capability.mjs';
export const pauseInventoryName = 'project-pause.json';
export const pauseOriginalSettingsName = 'project-pause-original.godot';
export const pauseOriginalClockSettingsName = 'project-pause-original-clock.godot';
export const pauseProjectScript = 'project-pause-runtime.gd';
export const pauseInputScript = 'project-pause-input.gd';
export const pauseProjectScene = 'project-pause.tscn';
export const pauseSourceURL = new URL('./godot4/project-pause-runtime.gd', import.meta.url);
export const pauseInputSourceURL = new URL('./godot4/project-pause-input.gd', import.meta.url);
const invalid = () => { throw new TypeError('Invalid generated project pause projection.'); };
export function pauseInnerEntry(settings) {
  if (!Buffer.isBuffer(settings)) invalid();
  const matches = [...settings.toString().matchAll(/^run\/main_scene="res:\/\/([^"\r\n]+)"$/gm)];
  if (matches.length !== 1 || matches[0][1] !== restartProjectScene) invalid();
  return matches[0][1];
}
export function pauseSettings(original) {
  const entry = pauseInnerEntry(original);
  return Buffer.from(original.toString().replace(`run/main_scene="res://${entry}"`, `run/main_scene="res://${pauseProjectScene}"`));
}
export function pauseProjectSource(template) {
  if (!Buffer.isBuffer(template) || !template.toString().startsWith(`extends "res://${restartProjectScript}"\n`)) invalid();
  return Buffer.from(template);
}
export function pauseInputSource(template) {
  if (!Buffer.isBuffer(template) || !template.toString().startsWith('extends Node\n')) invalid();
  return Buffer.from(template);
}
export const pauseProjectMain = () => Buffer.from(`[gd_scene load_steps=2 format=3]\n\n[ext_resource type="Script" path="res://${pauseProjectScript}" id="1"]\n\n[node name="VientoProject" type="Node2D"]\nscript = ExtResource("1")\n`);
export const pauseInventory = (settings, clock) => Buffer.from(JSON.stringify({
  format: 'viento-godot-project-pause', schemaVersion: 1,
  inner: { entry: pauseInnerEntry(settings), host: restartProjectScript, settingsSha256: buildHash(settings), clockSettingsSha256: clock === null ? null : buildHash(clock) },
}, null, 2) + '\n');
