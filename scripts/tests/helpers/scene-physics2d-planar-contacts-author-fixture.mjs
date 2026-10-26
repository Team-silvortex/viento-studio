import { scenePhysics2DContactEventsAuthor } from './scene-physics2d-contact-events-author-fixture.mjs';

// Ordinary saved author sources: no motor, engine-private event publication or
// synthetic contact. The input driver only supplies the existing arrow actions.
export async function scenePhysics2DPlanarContactsAuthor(t, { consumers = false, response = 'slide', live = false } = {}) {
  const f = await scenePhysics2DContactEventsAuthor(t, { consumers, jump: false });
  await f.edit('documents/scenes/demo.json', scene => {
    scene.actors[0].position = [100, 180];
    scene.actors[2].position = [145, 180]; scene.actors[2].size = [10, 100];
  });
  await f.edit(f.physicsPath, document => {
    document.schemaVersion = 2; delete document.bodies[0].characterMotion;
    document.bodies[0].collisionResponse = response;
    document.bodies[2].shape.size = [10, 100];
  });
  await f.edit(f.manifestPath, document => { document.bindings = document.bindings.filter(binding => binding.bindingId !== f.motionPublisherBindingId); });
  await f.script('motion-input', `extends Node
var ticks := -1
func _ready() -> void:
\tInput.action_press("ui_right")
func _physics_process(_delta: float) -> void:
${live ? '\tticks += 1' : '\tvar step: int = get_parent().get_parent().get("physics_observation_step")\n\tif step == ticks:\n\t\treturn\n\tticks = step'}
\tInput.action_release("ui_right")
\tInput.action_release("ui_left")
\tif ticks < 9 or ticks >= 17:
\t\tInput.action_press("ui_right")
\telif ticks >= 11 and ticks < 14:
\t\tInput.action_press("ui_left")
${live ? '\tif ticks >= 30:\n\t\tget_tree().root.get_node("VientoProject").call_deferred("finish_project")\n' : ''}func _exit_tree() -> void:
\tInput.action_release("ui_right")
\tInput.action_release("ui_left")
`);
  return { ...f, response };
}
