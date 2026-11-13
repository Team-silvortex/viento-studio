// Optional view-only generated entry points. Actor, physics, media and project
// runtime source remains byte-exact; camera nodes never move logical objects.
export const CAMERA2D_CAPABILITY = 'scene.camera2d';
export const CAMERA2D_LIMITS_CAPABILITY = 'scene.camera2d.limits2d';
export const cameraInventoryName = 'camera2d-project.json';
export const cameraOriginalSettingsName = 'camera2d-original.godot';
export const cameraSceneScript = 'camera2d-scene.gd';
export const cameraLimitsSceneScript = 'camera2d-limits-scene.gd';
export const cameraProjectScript = 'camera2d-project-runtime.gd';
export const cameraProjectScene = 'camera2d-project.tscn';
export const cameraSourceURL = name => new URL(`./godot4/camera2d-${name}.gd`, import.meta.url);
export const cameraScenePath = id => `scenes/${id}/camera2d-main.tscn`;
export const cameraDocumentPath = id => `scenes/${id}/camera2d.json`;
export const cameraLimitsDocumentPath = id => `scenes/${id}/camera2d-limits.json`;
// The historical loader keeps receiving its exact v1 contract. The complete
// bounded author declaration remains alongside it and is authenticated as a pair.
export function cameraBaseDocument(document) {
  if (document.schemaVersion === 1) return document;
  const { limits, ...camera } = document.camera;
  return { ...document, schemaVersion: 1, camera };
}
export const cameraJson = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const invalid = () => { throw new TypeError('Invalid generated camera2d projection.'); };
const oldEntry = 'run/main_scene="res://project.tscn"';
const newEntry = `run/main_scene="res://${cameraProjectScene}"`;
export function cameraSettings(original) {
  const value = original.toString();
  if (value.split(oldEntry).length !== 2 || value.includes('camera2d')) invalid();
  return Buffer.from(value.replace(oldEntry, newEntry));
}
export function cameraProjectHost(original) {
  const match = /^\[gd_scene load_steps=2 format=3\]\n\n\[ext_resource type="Script" path="res:\/\/([a-z0-9-]+\.gd)" id="1"\]\n\n\[node name="VientoProject" type="Node2D"\]\nscript = ExtResource\("1"\)\n$/.exec(original.toString());
  if (!match || match[1].includes('camera2d')) invalid();
  return match[1];
}
export const cameraProjectMain = () => Buffer.from(`[gd_scene load_steps=2 format=3]\n\n[ext_resource type="Script" path="res://${cameraProjectScript}" id="1"]\n\n[node name="VientoProject" type="Node2D"]\nscript = ExtResource("1")\n`);
export const cameraSceneMain = (id, limits = false) => Buffer.from(`[gd_scene load_steps=3 format=3]\n\n[ext_resource type="PackedScene" path="res://scenes/${id}/main.tscn" id="1"]\n[ext_resource type="Script" path="res://${limits ? cameraLimitsSceneScript : cameraSceneScript}" id="2"]\n\n[node name="VientoScene" instance=ExtResource("1")]\n\n[node name="VientoCamera2D" type="Node" parent="."]\nscript = ExtResource("2")\ncamera_document = "res://${cameraDocumentPath(id)}"\n${limits ? `camera_limits_document = "res://${cameraLimitsDocumentPath(id)}"\n` : ''}`);
export const cameraProjectSource = (template, host, ids) => Buffer.from(template.toString().replace('__CAMERA_PROJECT_BASE__', host)
  .replace('__CAMERA_SCENES__', JSON.stringify(Object.fromEntries(ids.map(id => [id, cameraScenePath(id)])))));
export const cameraInventory = ids => cameraJson({ format: 'viento-godot-camera2d-project', schemaVersion: 1, sceneIds: ids });
