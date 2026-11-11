import { scenePhysics2DPlatformControlAuthor } from './scene-physics2d-platform-control-author-fixture.mjs';
import { GODOT_PHYSICS_SENSOR_OCCUPANCY_SCRIPT } from '../../../engine/godot-physics-sensor-occupancy-script.mjs';
import { GODOT_PHYSICS_SENSOR_SCRIPT } from '../../../engine/godot-physics-sensor-script.mjs';
import { GODOT_PLATFORM_CONTROL_SCRIPT } from '../../../engine/godot-platform-control-script.mjs';

const id = n => `98989898-9898-4898-8898-${String(n).padStart(12, '0')}`;

// Ordinary author sources on the existing platform fixture. Every scene, script,
// parameter and relation is saved through its established disposable author API.
export async function scenePhysics2DSensorOccupancyAuthor(t, { roundTrip = false } = {}) {
  const f = await scenePhysics2DPlatformControlAuthor(t, { consumers: false });
  const sensorTwoInstanceId = id(1), sensorTwoBodyId = id(2), sensorTwoScriptId = id(3), sensorTwoBindingId = id(4);
  const controlScriptId = id(5), controlBindingId = id(6), controlTwoScriptId = id(7), controlTwoBindingId = id(8);
  const probeScriptId = id(9), probeBindingId = id(10), legacyScriptId = id(11), legacyBindingId = id(12);
  await f.edit('documents/scenes/demo.json', scene => {
    for (const actor of scene.actors) { actor.controls = 'none'; actor.speed = 0; }
    scene.actors.find(actor => actor.instanceId === f.instanceId).position = [90, 100];
    scene.actors.find(actor => actor.instanceId === f.otherInstanceId).position = [110, 100];
    scene.actors.find(actor => actor.instanceId === f.wallInstanceId).position = [1200, 500];
    const sensor = scene.actors.find(actor => actor.instanceId === f.sensorInstanceId);
    sensor.position = [100, 100]; sensor.size = [80, 80];
    scene.actors.push({ ...structuredClone(sensor), instanceId: sensorTwoInstanceId, position: [300, 100] });
    scene.actors.find(actor => actor.instanceId === f.platformInstanceId).position = [600, 400];
    scene.actors.find(actor => actor.instanceId === f.stationaryInstanceId).position = [800, 400];
  });
  await f.edit(f.physicsPath, physics => {
    for (const body of physics.bodies.filter(body => body.kind === 'character')) {
      delete body.characterMotion; body.collisionResponse = 'stop'; body.mask = 0;
    }
    const sensor = physics.bodies.find(body => body.instanceId === f.sensorInstanceId);
    sensor.shape.size = [80, 80];
    physics.bodies.push({ ...structuredClone(sensor), id: sensorTwoBodyId, instanceId: sensorTwoInstanceId });
  });
  await f.edit(f.manifestPath, manifest => {
    // Keep the old sensor's registered identity, replace only this fixture's
    // authored script and remove unrelated motion/event starters from the run.
    manifest.bindings = manifest.bindings.filter(binding => [f.bindingId, f.sensorBindingId].includes(binding.bindingId));
    manifest.bindings.find(binding => binding.bindingId === f.sensorBindingId).parameters = {
      occupied_event: 'physics.occupied', vacant_event: 'physics.vacant',
    };
  });
  await f.script('checkpoint', 'extends Node\n');
  await f.script('sensor', GODOT_PHYSICS_SENSOR_OCCUPANCY_SCRIPT);
  await f.addBehavior(sensorTwoScriptId, sensorTwoBindingId, 'sensor-occupancy-two', GODOT_PHYSICS_SENSOR_OCCUPANCY_SCRIPT,
    { occupied_event: 'physics.occupied', vacant_event: 'physics.vacant' }, sensorTwoInstanceId);
  await f.addBehavior(controlScriptId, controlBindingId, 'sensor-platform-control', GODOT_PLATFORM_CONTROL_SCRIPT,
    { initial_running: false, resume_event: 'physics.occupied', pause_event: 'physics.vacant', instance_id: f.sensorInstanceId }, f.platformInstanceId);
  await f.addBehavior(controlTwoScriptId, controlTwoBindingId, 'sensor-platform-control-two', GODOT_PLATFORM_CONTROL_SCRIPT,
    { initial_running: false, resume_event: 'physics.occupied', pause_event: 'physics.vacant', instance_id: sensorTwoInstanceId }, f.stationaryInstanceId);
  await f.addBehavior(legacyScriptId, legacyBindingId, 'legacy-sensor-coexists', GODOT_PHYSICS_SENSOR_SCRIPT,
    { entered_event: 'legacy.entered', exited_event: 'legacy.exited' }, sensorTwoInstanceId);
  const probe = `extends Node
var ticks := -1
var scene
func _ready() -> void:
\tscene = get_parent().get_parent()
func _actor(identity: String) -> Node2D:
\tfor actor in scene.actors:
\t\tif actor["instanceId"] == identity:
\t\t\treturn actor["node"]
\treturn null
func _physics_process(_delta: float) -> void:
\tvar tick: int = scene.physics_observation_step
\tif ticks == tick:
\t\treturn
\tticks = tick
${roundTrip ? `\tif scene.project_visit == 1 and ticks == 10:
\t\tassert(get_meta("viento_project").request_scene("${f.sceneIds[1]}"))
` : `\tif ticks == 5:
\t\t_actor("${f.instanceId}").position = Vector2(200, 100)
\tif ticks == 9:
\t\t_actor("${f.otherInstanceId}").position = Vector2(200, 130)
\tif ticks == 13:
\t\t_actor("${f.instanceId}").position = Vector2(300, 100)
\tif ticks == 17:
\t\t_actor("${f.instanceId}").position = Vector2(200, 100)
\t\t_actor("${f.otherInstanceId}").position = Vector2(100, 100)
`}
\tvar platforms := []
\tfor identity in ["${f.platformInstanceId}", "${f.stationaryInstanceId}"]:
\t\tvar value = scene.platform_motion.platforms[identity]
\t\tvar running = null
\t\tfor child in value["node"].get_ref().get_children():
\t\t\tif child.has_meta("viento_platform_control"):
\t\t\t\trunning = child.get_meta("viento_platform_control").read_running()
\t\t\t\tbreak
\t\tplatforms.append({"instanceId":identity,"phase":value["phase"],"running":running,"position":[value["node"].get_ref().position.x,value["node"].get_ref().position.y]})
\tprint("OCCUPANCY_PROBE:" + JSON.stringify({"step":ticks,"visit":scene.project_visit,"platforms":platforms}))
`;
  await f.addBehavior(probeScriptId, probeBindingId, 'sensor-occupancy-probe', probe, {}, f.platformInstanceId);
  if (roundTrip) await f.script('second', `extends Node
func _ready() -> void:
\tassert(get_meta("viento_project").request_scene("${f.sceneIds[0]}"))
`);
  return { ...f, roundTrip, sensorTwoInstanceId, sensorTwoBodyId, sensorTwoScriptId, sensorTwoBindingId,
    controlScriptId, controlBindingId, controlTwoScriptId, controlTwoBindingId, probeScriptId, probeBindingId, legacyScriptId, legacyBindingId };
}
