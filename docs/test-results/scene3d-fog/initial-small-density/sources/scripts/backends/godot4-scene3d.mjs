// A standalone prototype adapter. It does not extend the 2D backend registry.
import fs from 'node:fs/promises';
import { createScene3DPlan } from '../../engine/scene3d.mjs';

const invalid = () => { throw Object.assign(new TypeError('Expected a bounded scene3d build plan.'), { errorCode: 'scene3d_plan_invalid' }); };
function detach(value, depth = 0, budget = { nodes: 0 }) {
  if (++budget.nodes > 20000 || depth > 16) invalid();
  if (value === null || ['string', 'boolean'].includes(typeof value)) return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (!value || typeof value !== 'object') invalid();
  const array = Array.isArray(value), proto = Object.getPrototypeOf(value), descriptors = Object.getOwnPropertyDescriptors(value);
  if (!array && proto !== Object.prototype && proto !== null || Object.hasOwn(descriptors, 'toJSON')) invalid();
  const keys = Reflect.ownKeys(descriptors), result = array ? [] : {};
  if (array && keys.length !== value.length + 1) invalid();
  for (const key of array ? Array.from({ length: value.length }, (_, n) => String(n)) : keys) {
    const property = descriptors[key];
    if (typeof key !== 'string' || !property || !property.enumerable || !Object.hasOwn(property, 'value')) invalid();
    Object.defineProperty(result, key, { value: detach(property.value, depth + 1, budget), enumerable: true });
  }
  return result;
}
export function validateGodotScene3DPlan(input) {
  const plan = detach(input);
  if (Object.keys(plan).length !== 4 || plan.format !== 'viento-build-plan' || plan.schemaVersion !== 1 || plan.kind !== 'scene3d' || !plan.scene) invalid();
  // Core owns author admission and bounds; the adapter does not reinterpret
  // projections, assets, behavior, groups or alternate engine scene schemas.
  const sceneKeys = ['name','viewport','background','camera','light','objects'];
  if (Object.keys(plan.scene).length !== sceneKeys.length + Number(Object.hasOwn(plan.scene, 'fog'))
    || !sceneKeys.every(key => Object.hasOwn(plan.scene,key))) invalid();
  const checked = createScene3DPlan(JSON.stringify({ format: 'viento-scene3d', schemaVersion: 1, ...plan.scene }));
  return checked;
}
const string = value => JSON.stringify(value);
const number = value => Object.is(value, -0) ? '-0.0' : String(value);
const vector = values => `Vector3(${values.map(number).join(', ')})`;
const rgba = value => { const channels = [1, 3, 5].map(start => parseInt(value.slice(start, start + 2), 16) / 255); return `Color(${channels.map(number).join(', ')}, 1)`; };
const normalize = values => { const scale = Math.max(...values.map(Math.abs)), scaled = values.map(value => value / scale), length = Math.hypot(...scaled); return scaled.map(value => value / length); };

export async function generateGodotScene3DProject(input) {
  const plan = validateGodotScene3DPlan(input), { scene } = plan;
  const runtime = await fs.readFile(new URL('./godot3d/runtime.gd', import.meta.url));
  const cameraForward = normalize(scene.camera.target.map((value, index) => value - scene.camera.position[index]));
  const lightForward = normalize(scene.light.direction);
  const lines = [`[gd_scene load_steps=${scene.objects.length * 2 + 3} format=3]`, '', '[ext_resource type="Script" path="res://runtime.gd" id="1_runtime"]', '',
    '[sub_resource type="Environment" id="Environment_scene"]', 'background_mode = 1', `background_color = ${rgba(scene.background)}`, 'ambient_light_source = 3', `ambient_light_color = ${rgba('#ffffff')}`, 'ambient_light_energy = 0.2', ''];
  if (scene.fog) lines.push('fog_mode = 0', `fog_enabled = ${scene.fog.density > 0}`, `fog_density = ${number(scene.fog.density)}`,
    `fog_light_color = ${rgba(scene.fog.color)}`, 'fog_light_energy = 1.0', 'fog_height_density = 0.0',
    'fog_sun_scatter = 0.0', 'fog_aerial_perspective = 0.0', 'fog_sky_affect = 0.0', '');
  for (const [index, object] of scene.objects.entries()) lines.push(`[sub_resource type="StandardMaterial3D" id="Material_${index}"]`, `albedo_color = ${rgba(object.color)}`, 'roughness = 0.8', '', `[sub_resource type="BoxMesh" id="Mesh_${index}"]`, `size = ${vector(object.size)}`, `material = SubResource("Material_${index}")`, '');
  lines.push('[node name="Scene3D" type="Node3D"]', 'script = ExtResource("1_runtime")', '', '[node name="Environment" type="WorldEnvironment" parent="."]', 'environment = SubResource("Environment_scene")', '',
    '[node name="Camera" type="Camera3D" parent="."]', `position = ${vector(scene.camera.position)}`, 'current = true', `fov = ${number(scene.camera.fovDegrees)}`, `near = ${number(scene.camera.near)}`, `far = ${number(scene.camera.far)}`, `metadata/viento_forward = ${vector(cameraForward)}`, '',
    '[node name="Light" type="DirectionalLight3D" parent="."]', `light_color = ${rgba(scene.light.color)}`, `light_energy = ${number(scene.light.energy)}`, `metadata/viento_forward = ${vector(lightForward)}`, '');
  for (const [index, object] of scene.objects.entries()) lines.push(`[node name="Box_${index}" type="MeshInstance3D" parent="."]`, `position = ${vector(object.position)}`, '; EULER_ORDER_XYZ = 0: column-vector transform T * Rx * Ry * Rz.', 'rotation_order = 0', `rotation = ${vector(object.rotationDegrees.map(degree => degree * Math.PI / 180))}`, `mesh = SubResource("Mesh_${index}")`, `metadata/viento_instance_id = ${string(object.instanceId)}`, `metadata/viento_name = ${string(object.name)}`, '');
  const project = ['config_version=5', '', '[application]', `config/name=${string(scene.name)}`, 'run/main_scene="res://scene.tscn"', '', '[display]', `window/size/viewport_width=${scene.viewport[0]}`, `window/size/viewport_height=${scene.viewport[1]}`, '', '[rendering]', 'renderer/rendering_method="gl_compatibility"', `environment/defaults/default_clear_color=${rgba(scene.background)}`, ''].join('\n');
  return { plan, files: new Map([['project.godot', Buffer.from(project)], ['scene.tscn', Buffer.from(lines.join('\n'))], ['runtime.gd', runtime]]) };
}
