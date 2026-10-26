import { scenePhysics2DCharacterEventsAuthor } from './scene-physics2d-character-events-author-fixture.mjs';
import { GODOT_CHARACTER_DROP_THROUGH_SCRIPT } from '../../../engine/godot-character-drop-through-script.mjs';
import { GODOT_CHARACTER_CONTACT_EVENTS_SCRIPT } from '../../../engine/godot-character-contact-events-script.mjs';
import { generateEditableGodotAnimationStateScript } from '../../../engine/animation-state-script-source.mjs';
import { DEFAULT_ANIMATION_STATE_TABLE } from '../../../engine/godot-animation-state-script.mjs';
const id = n => `79797979-7979-4979-8979-${String(n).padStart(12, '0')}`;

// Two instances share an actor document. Only the first has an ordinary input
// script; the request cannot change the second instance's native collision mask.
export async function scenePhysics2DDropThroughAuthor(t, { consumers = true, live = false, circle = false, offset = [0, 0], margin = 1, gravity = 3000, drop = true } = {}) {
  const f = await scenePhysics2DCharacterEventsAuthor(t, { consumers, jump: false });
  const platformInstanceId = id(1), platformBodyId = id(2), otherInstanceId = id(3), otherBodyId = id(4);
  const dropScriptId = id(5), dropBindingId = id(6), contactScriptId = id(7), contactBindingId = id(8);
  const platformTop = 155 + offset[1], expectedSupportY = platformTop - 10, expectedLandingY = 210;
  await f.edit('documents/scenes/demo.json', scene => {
    scene.actors[0].position = [100, expectedSupportY - 1]; scene.actors[0].speed = 0;
    scene.actors[1].position = [500, 100];
    scene.actors[2].position = [300, 230]; scene.actors[2].size = [1000, 20];
    scene.actors.push({ ...structuredClone(scene.actors[2]), instanceId: platformInstanceId, position: [150, 160], size: [300, 10], color: '#b7d7f0' });
    scene.actors.push({ ...structuredClone(scene.actors[0]), instanceId: otherInstanceId, position: [180, expectedSupportY - 1], controls: 'none', color: '#e9ae76' });
  });
  await f.edit(f.physicsPath, document => {
    document.schemaVersion = 4;
    document.bodies[0].characterMotion = { kind: 'platformer', gravity, jumpSpeed: 400, maxFallSpeed: 1200 };
    if (circle) document.bodies[0].shape = { kind: 'circle', radius: 10 };
    document.bodies[2].shape.size = [1000, 20];
    document.bodies.push({ ...structuredClone(document.bodies[2]), id: platformBodyId, instanceId: platformInstanceId,
      shape: { kind: 'box', size: [300, 10] }, offset, oneWay: { margin } });
    document.bodies.push({ ...structuredClone(document.bodies[0]), id: otherBodyId, instanceId: otherInstanceId });
  });
  await f.addBehavior(dropScriptId, dropBindingId, 'drop-through', GODOT_CHARACTER_DROP_THROUGH_SCRIPT, { drop_action: 'ui_down' });
  await f.addBehavior(contactScriptId, contactBindingId, 'drop-contacts', GODOT_CHARACTER_CONTACT_EVENTS_SCRIPT,
    { started_event: 'physics.contact_started', ended_event: 'physics.contact_ended', other_instance_id: platformInstanceId });
  if (consumers) {
    const table = structuredClone(DEFAULT_ANIMATION_STATE_TABLE); table.transitions[0].trigger.name = 'physics.landed';
    await f.script('checkpoint', generateEditableGodotAnimationStateScript(table).content);
  }
  await f.script('motion-input', `extends Node
var ticks := -1
func _physics_process(_delta: float) -> void:
${live ? '\tticks += 1' : '\tvar step: int = get_parent().get_parent().get("physics_observation_step")\n\tif step == ticks:\n\t\treturn\n\tticks = step'}
${drop ? '\tif ticks == 6:\n\t\tInput.action_press("ui_down")\n\tif ticks == 14:\n\t\tInput.action_release("ui_down")\n' : '\tpass\n'}${live ? '\tif ticks >= 30:\n\t\tget_tree().root.get_node("VientoProject").call_deferred("finish_project")\n' : ''}func _exit_tree() -> void:
\tInput.action_release("ui_down")
`);
  return { ...f, platformInstanceId, platformBodyId, otherInstanceId, otherBodyId, dropScriptId, dropBindingId, contactScriptId, contactBindingId,
    platformTop, expectedSupportY, expectedLandingY, dropAction: 'ui_down', dropRequestTick: 6, dropReleaseTick: 14 };
}
