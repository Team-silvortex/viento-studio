// One explicit visit transaction overlays bounded session values before a member
// switch. Existing scene factories, author bytes and business frames stay owned
// by the historical layers beneath this wrapper.
import { buildHash } from '../adapters/node-build-snapshot.mjs';
export const SCENE_RETRY_CAPABILITY = 'project.scene-retry';
export const retryInventoryName = 'retry-project.json';
export const retryOriginalSettingsName = 'retry-original.godot';
export const retryOriginalClockSettingsName = 'retry-original-clock.godot';
export const retryProjectScript = 'retry-project-runtime.gd';
export const retryProjectScene = 'retry-project.tscn';
export const retrySourceURL = new URL('./godot4/retry-project-runtime.gd', import.meta.url);
const invalid = () => { throw new TypeError('Invalid generated scene retry projection.'); };
const hosts = new Set(['project-runtime.gd', 'project-control-runtime.gd', 'project-clip-runtime.gd', 'project-completion-runtime.gd',
  'project-animation-state-runtime.gd', 'project-animation-state-entry-runtime.gd', 'project-animation-state-trigger-runtime.gd',
  'project-animation-target-runtime.gd', 'project-physics-runtime.gd', 'project-physics-observation-runtime.gd',
  'camera2d-project-runtime.gd', 'hud2d-project-runtime.gd']);
export function retryInnerEntry(settings) {
  const matches = [...settings.toString().matchAll(/^run\/main_scene="res:\/\/([^"\r\n]+)"$/gm)];
  if (matches.length !== 1 || !['project.tscn', 'camera2d-project.tscn', 'hud2d-project.tscn'].includes(matches[0][1])) invalid();
  return matches[0][1];
}
export function retrySettings(original) {
  const entry = retryInnerEntry(original);
  return Buffer.from(original.toString().replace(`run/main_scene="res://${entry}"`, `run/main_scene="res://${retryProjectScene}"`));
}
export function retryProjectHost(original) {
  const match = /^\[gd_scene load_steps=2 format=3\]\n\n\[ext_resource type="Script" path="res:\/\/([a-z0-9-]+\.gd)" id="1"\]\n\n\[node name="VientoProject" type="Node2D"\]\nscript = ExtResource\("1"\)\n$/.exec(original.toString());
  if (!match || !hosts.has(match[1])) invalid(); return match[1];
}
export function retryProjectSource(template, host) {
  if (!hosts.has(host) || template.toString().split('__RETRY_PROJECT_BASE__').length !== 2) invalid();
  return Buffer.from(template.toString().replace('__RETRY_PROJECT_BASE__', host));
}
export const retryProjectMain = () => Buffer.from(`[gd_scene load_steps=2 format=3]\n\n[ext_resource type="Script" path="res://${retryProjectScript}" id="1"]\n\n[node name="VientoProject" type="Node2D"]\nscript = ExtResource("1")\n`);
export const retryInventory = (settings, clock, entry, host) => Buffer.from(JSON.stringify({
  format: 'viento-godot-scene-retry-project', schemaVersion: 1, maximumInitialValues: 16,
  inner: { entry, host, settingsSha256: buildHash(settings), clockSettingsSha256: clock === null ? null : buildHash(clock) },
}, null, 2) + '\n');
