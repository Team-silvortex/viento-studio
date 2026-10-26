import { scenePhysics2DDropThroughAuthor } from './scene-physics2d-drop-through-author-fixture.mjs';
const id = n => `83838383-8383-4838-8838-${String(n).padStart(12, '0')}`;

// Author source only: one moving platform, one independent stationary support,
// and two characters sharing a definition. The editor enables the opt-in body
// field explicitly; the default native fixture starts with it already saved.
export async function scenePhysics2DPlatformMotionAuthor(t, { enabled = true, consumers = true, oneWay = true,
  circle = false, offset = [0, 0], offsetX = 48, speed = 240, live = false, jump = false, drop = false,
  bothRiders = false, noCharacters = false } = {}) {
  const f = await scenePhysics2DDropThroughAuthor(t, { consumers, drop: false, circle, offset });
  const stationaryInstanceId = id(1), stationaryBodyId = id(2);
  await f.edit('documents/scenes/demo.json', scene => {
    scene.actors[2].position[1] = 340;
    const platform = scene.actors.find(actor => actor.instanceId === f.platformInstanceId);
    platform.size = [200, 10];
    const other = scene.actors.find(actor => actor.instanceId === f.otherInstanceId);
    if (!bothRiders) other.position[0] = 440;
    scene.actors.push({ ...structuredClone(platform), instanceId: stationaryInstanceId, position: [440, 160], size: [120, 10], color: '#9dabc3' });
  });
  await f.edit(f.physicsPath, document => {
    document.schemaVersion = enabled ? 5 : 4;
    const platform = document.bodies.find(body => body.id === f.platformBodyId);
    platform.shape.size = [200, 10];
    if (!oneWay) delete platform.oneWay;
    if (enabled) platform.platformMotion = { kind: 'horizontal', offsetX, speed };
    const stationary = { ...structuredClone(platform), id: stationaryBodyId, instanceId: stationaryInstanceId, shape: { kind: 'box', size: [120, 10] } };
    delete stationary.platformMotion;
    document.bodies.push(stationary);
    if (noCharacters) document.bodies = document.bodies.filter(body => body.kind !== 'character');
  });
  if (!drop || !oneWay || noCharacters) await f.edit(f.manifestPath, document => {
    document.bindings = document.bindings.filter(binding => binding.bindingId !== f.dropBindingId);
  });
  if (noCharacters) await f.edit(f.manifestPath, document => {
    document.bindings = document.bindings.filter(binding => ![f.publisherBindingId, f.contactBindingId].includes(binding.bindingId));
  });
  await f.script('motion-input', `extends Node
var ticks := -1
func _physics_process(_delta: float) -> void:
${live ? '\tticks += 1' : '\tvar step: int = get_parent().get_parent().get("physics_observation_step")\n\tif step == ticks:\n\t\treturn\n\tticks = step'}
\tif ticks == 10:
\t\t${jump ? 'Input.action_press("ui_accept")' : drop ? 'Input.action_press("ui_down")' : 'pass'}
\tif ticks == 11:
\t\tInput.action_release("ui_accept")
\t\tInput.action_release("ui_down")
${live ? '\tif ticks >= 30:\n\t\tget_tree().root.get_node("VientoProject").call_deferred("finish_project")\n' : ''}func _exit_tree() -> void:
\tInput.action_release("ui_accept")
\tInput.action_release("ui_down")
`);
  return { ...f, offsetX, speed, stationaryInstanceId, stationaryBodyId, enabled, expectedLandingY: 320 };
}
