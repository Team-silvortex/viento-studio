import fs from 'node:fs/promises';
import path from 'node:path';
import { godotSceneNavigationAuthor } from './godot-scene-navigation-author-fixture.mjs';
import { runtimeId } from './project-runtime-fixture.mjs';
import { GODOT_ACTION_SCENE_RETRY_SCRIPT } from '../../../engine/godot-scene-retry-script.mjs';

// Ordinary saved author documents only. The generated runtime is never patched.
export async function godotSceneRetryAuthor(t) {
  const f = await godotSceneNavigationAuthor(t);
  const initialValues = { level: 1, score: 0, health: 100, key_found: false };
  const [menuId, gameId, failureId] = f.sceneIds;
  const initialScriptId = runtimeId(1101), initialBindingId = runtimeId(1102);
  const menu = await f.read('documents/behaviors/demo.json');
  menu.bindings[0].parameters = { action_name: 'retry_game', target_scene_id: gameId, state_values_json: JSON.stringify(initialValues) };
  menu.bindings.push({ ...structuredClone(menu.bindings[0]), bindingId: initialBindingId, parameters: {}, implementation: { ...menu.bindings[0].implementation, sourceObjectId: initialScriptId } });
  await f.write('documents/behaviors/demo.json', menu);
  await fs.writeFile(path.join(f.author, 'documents/scripts/checkpoint.txt'), GODOT_ACTION_SCENE_RETRY_SCRIPT);
  const scriptRecord = await f.read(`metadata/documents/${f.scriptId}.json`);
  await f.write(`metadata/documents/${initialScriptId}.json`, { ...scriptRecord, id: initialScriptId, sourcePath: 'documents/scripts/retry-initial.txt' });
  await fs.writeFile(path.join(f.author, 'documents/scripts/retry-initial.txt'), `extends Node
func _ready() -> void:
\tvar project = get_meta("viento_project")
\tif project.read_state("progress") == null:
\t\tproject.write_state("progress", "menu-seed")
`);
  const menuRecord = await f.read('metadata/documents/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee.json');
  menuRecord.relations.push({ kind: 'reference', targetId: initialScriptId, slot: 'implementation' });
  await f.write('metadata/documents/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee.json', menuRecord);
  const game = await f.read('documents/behaviors/second.json');
  game.bindings[0].parameters = { event_name: 'game.failed', target_scene_id: failureId, payload_filter: 'lose' };
  await f.write('documents/behaviors/second.json', game);
  await fs.writeFile(path.join(f.author, 'documents/scripts/navigation-publisher.txt'), `extends Node
var project
var ticks := 0
var last_frame := -1
var audits := 0
var subscription := 0
func _ready() -> void:
\tproject = get_meta("viento_project")
\tsubscription = project.subscribe_event("game.audit", _audit)
\tassert(subscription > 0, "game audit subscription was refused")
func _audit(_value) -> bool:
\taudits += 1
\treturn true
func _process(_delta: float) -> void:
\tvar frame := Engine.get_process_frames()
\tassert(frame != last_frame, "duplicate behavior processing in one frame")
\tlast_frame = frame
\tticks += 1
func _unhandled_input(event: InputEvent) -> void:
\tif event.is_action_pressed("game_mutate", false):
\t\tassert(project.write_state("level", 4))
\t\tassert(project.write_state("score", 75))
\t\tassert(project.write_state("health", 12))
\t\tassert(project.write_state("key_found", true))
\t\tassert(project.write_state("progress", "checkpoint-7"))
\t\tassert(project.publish_event("game.audit", true))
\tif event.is_action_pressed("game_fail", false):
\t\tassert(project.publish_event("game.failed", "lose"))
\t\tassert(project.publish_event("game.failed", "lose"))
func _exit_tree() -> void:
\tif project != null and subscription > 0:
\t\tproject.unsubscribe_event(subscription)
`);
  const failure = await f.read('documents/behaviors/results.json');
  failure.bindings[0].parameters = { action_name: 'retry_game', target_scene_id: gameId, state_values_json: JSON.stringify(initialValues) };
  await f.write('documents/behaviors/results.json', failure);
  await fs.writeFile(path.join(f.author, 'documents/scripts/navigation-results.txt'), GODOT_ACTION_SCENE_RETRY_SCRIPT);
  await f.write('documents/projects/navigation-input.json', { format: 'viento-input-map', schemaVersion: 1, actions: [
    { name: 'retry_game', keys: ['Enter', 'Space'] }, { name: 'game_mutate', keys: ['KeyM'] }, { name: 'game_fail', keys: ['KeyF'] },
  ] });
  for (const [index, name] of ['demo', 'audio', 'results'].entries()) {
    const scene = await f.read(`documents/scenes/${name}.json`); scene.title = ['Menu', 'Game', 'Failure'][index];
    for (const actor of scene.actors) actor.position[1] = 280;
    if (index === 1) { scene.actors[0].controls = 'arrows'; scene.actors[0].speed = 180; }
    await f.write(`documents/scenes/${name}.json`, scene);
    const hud = await f.read(`documents/projects/navigation-hud-${index}.json`);
    hud.elements = [{ ...hud.elements[0], offset: [16, 48], content: { kind: 'literal', text: ['Menu: Enter starts a new attempt', 'Game: arrows move, M changes state, F fails', 'Failure: release Enter, then retry'][index] } }, ...Object.keys(initialValues).map((key, row) => ({
      ...structuredClone(hud.elements[0]), id: runtimeId(1120 + index * 10 + row), offset: [16, 88 + row * 36], size: [520, 32], fontSize: 20,
      content: { kind: 'state', key, prefix: `${key}: `, suffix: '', missing: '(unset)' },
    }))];
    await f.write(`documents/projects/navigation-hud-${index}.json`, hud);
  }
  const gameScene = await f.read('documents/scenes/audio.json');
  return { ...f, menuId, gameId, failureId, initialValues, initialScriptId, initialBindingId, gameActorId: gameScene.actors[0].instanceId, gameInitialPosition: gameScene.actors[0].position };
}
