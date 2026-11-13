// A final optional screen-space layer. Historical scene/camera/physics files
// are retained and authenticated before this independent project entry runs.
export const HUD2D_CAPABILITY = 'scene.hud2d';
export const hudInventoryName = 'hud2d-project.json';
export const hudOriginalSettingsName = 'hud2d-original.godot';
export const hudOriginalClockSettingsName = 'hud2d-original-clock.godot';
export const hudProjectScript = 'hud2d-project-runtime.gd';
export const hudSceneScript = 'hud2d-scene.gd';
export const hudProjectScene = 'hud2d-project.tscn';
export const hudSourceURL = name => new URL(`./godot4/hud2d-${name}.gd`, import.meta.url);
export const hudDocumentPath = id => `scenes/${id}/hud2d.json`;
export const hudJson = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const invalid = () => { throw new TypeError('Invalid generated HUD2D projection.'); };
export function hudInnerEntry(settings) {
  const value = settings.toString(), matches = [...value.matchAll(/^run\/main_scene="res:\/\/([^"\r\n]+)"$/gm)];
  if (matches.length !== 1 || !['project.tscn', 'camera2d-project.tscn'].includes(matches[0][1]) || value.includes('hud2d')) invalid();
  return matches[0][1];
}
export function hudSettings(original) {
  const entry = hudInnerEntry(original);
  return Buffer.from(original.toString().replace(`run/main_scene="res://${entry}"`, `run/main_scene="res://${hudProjectScene}"`));
}
export function hudProjectHost(original) {
  const match = /^\[gd_scene load_steps=2 format=3\]\n\n\[ext_resource type="Script" path="res:\/\/([a-z0-9-]+\.gd)" id="1"\]\n\n\[node name="VientoProject" type="Node2D"\]\nscript = ExtResource\("1"\)\n$/.exec(original.toString());
  if (!match || match[1].includes('hud2d')) invalid(); return match[1];
}
export const hudProjectMain = () => Buffer.from(`[gd_scene load_steps=2 format=3]\n\n[ext_resource type="Script" path="res://${hudProjectScript}" id="1"]\n\n[node name="VientoProject" type="Node2D"]\nscript = ExtResource("1")\n`);
export const hudProjectSource = (template, host, ids) => Buffer.from(template.toString().replace('__HUD_PROJECT_BASE__', host)
  .replace('__HUD_SCENES__', JSON.stringify(Object.fromEntries(ids.map(id => [id, `res://${hudDocumentPath(id)}`])))));
export const hudInventory = ids => hudJson({ format: 'viento-godot-hud2d-project', schemaVersion: 1, sceneIds: ids });
