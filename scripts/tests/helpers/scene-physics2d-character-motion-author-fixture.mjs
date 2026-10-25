import { scenePhysics2DAuthor } from './scene-physics2d-author-fixture.mjs';
const id = n => `72727272-7272-4272-8272-${String(n).padStart(12, '0')}`;
export async function scenePhysics2DCharacterMotionAuthor(t, { animation = false, jump = false, hold = false, airRepeat = false, obstacle, controls = 'arrows', terminal = false } = {}) {
  const f = await scenePhysics2DAuthor(t, { animation });
  await f.edit('documents/scenes/demo.json', scene => {
    scene.actors[0].position = [100, 178]; scene.actors[0].controls = controls;
    scene.actors[2].position = [300, terminal ? 1000 : 200]; scene.actors[2].size = [1000, 20];
    if (obstacle) scene.actors.push({ ...structuredClone(scene.actors[2]), instanceId: id(1), position: obstacle === 'ceiling' ? [300, 160] : [140, 160], size: obstacle === 'ceiling' ? [1000, 10] : [10, 60] });
  });
  await f.edit(f.physicsPath, document => {
    document.schemaVersion = 3; document.bodies[0].collisionResponse = 'slide';
    document.bodies[0].characterMotion = { kind: 'platformer', gravity: 980, jumpSpeed: 120, maxFallSpeed: terminal ? 120 : 1200 };
    document.bodies[2].shape.size = [1000, 20];
    if (obstacle) document.bodies.push({ ...structuredClone(document.bodies[2]), id: id(2), instanceId: id(1), shape: { kind: 'box', size: obstacle === 'ceiling' ? [1000, 10] : [10, 60] } });
  });
  if (jump) await f.script('checkpoint', `extends Node
var ticks := -1
func _physics_process(_delta: float) -> void:
\tvar step: int = get_parent().get_parent().get("physics_observation_step")
\tif step == ticks:\n\t\treturn
\tticks = step
\tif ticks == 6${airRepeat ? ' or ticks == 10' : ''}:
\t\tInput.action_press("ui_accept")
${hold ? '' : '\tif ticks == 7 or ticks == 11:\n\t\tInput.action_release("ui_accept")\n'}func _exit_tree() -> void:
\tInput.action_release("ui_accept")
`);
  return f;
}
