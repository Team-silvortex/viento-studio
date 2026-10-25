import { scenePhysics2DCharacterMotionAuthor } from './scene-physics2d-character-motion-author-fixture.mjs';
import { GODOT_CHARACTER_MOTION_EVENTS_SCRIPT } from '../../../engine/godot-character-motion-events-script.mjs';
import { GODOT_PROJECT_EVENT_AUDIO_SCRIPT } from '../../../engine/godot-project-event-audio-script.mjs';
import { generateEditableGodotAnimationStateScript } from '../../../engine/animation-state-script-source.mjs';
import { DEFAULT_ANIMATION_STATE_TABLE } from '../../../engine/godot-animation-state-script.mjs';
const id = n => `73737373-7373-4373-8373-${String(n).padStart(12, '0')}`;

export async function scenePhysics2DCharacterEventsAuthor(t, { consumers = false, jump = true, hold = false, airRetry = false, live = false, obstacle, controls = 'arrows' } = {}) {
  const f = await scenePhysics2DCharacterMotionAuthor(t, { animation: consumers, jump: false, obstacle, controls });
  const manifestId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', manifestPath = 'documents/behaviors/demo.json';
  const publisherScriptId = id(1), publisherBindingId = id(2), driverScriptId = id(3), driverBindingId = id(4);
  const audioScriptId = id(5), audioBindingId = id(6), firstAudioId = id(7);
  const prototype = (await f.read(manifestPath)).bindings[0], scriptRecord = await f.read(`metadata/documents/${f.scriptId}.json`);
  const addBehavior = async (scriptId, bindingId, name, content, parameters = {}, instanceId = f.instanceId) => {
    await f.script(name, content);
    await f.write(`metadata/documents/${scriptId}.json`, { ...scriptRecord, id: scriptId, sourcePath: `documents/scripts/${name}.txt` });
    await f.edit(`metadata/documents/${manifestId}.json`, document => { document.relations.push({ kind: 'references', targetId: scriptId, slot: 'implementation' }); });
    await f.edit(manifestPath, document => { document.bindings.push({ ...structuredClone(prototype), bindingId, instanceId, parameters, events: [],
      implementation: { ...prototype.implementation, sourceObjectId: scriptId } }); });
  };
  await addBehavior(publisherScriptId, publisherBindingId, 'motion-events', GODOT_CHARACTER_MOTION_EVENTS_SCRIPT, { jumped_event: 'physics.jumped', landed_event: 'physics.landed' });
  await addBehavior(driverScriptId, driverBindingId, 'motion-input', `extends Node
var ticks := -1
func _ready() -> void:
${live ? '\tInput.action_press("ui_right")' : '\tpass'}
func _physics_process(_delta: float) -> void:
${live ? '\tticks += 1' : '\tvar step: int = get_parent().get_parent().get("physics_observation_step")\n\tif step == ticks:\n\t\treturn\n\tticks = step'}
${jump ? '\tif ticks == 6' + (airRetry ? ' or ticks == 10' : '') + ':\n\t\tInput.action_press("ui_accept")\n' : ''}${jump && !hold ? '\tif ticks == 7 or ticks == 11:\n\t\tInput.action_release("ui_accept")\n' : ''}${live ? '\tif ticks == 15:\n\t\tInput.action_release("ui_right")\n\tif ticks == 30:\n\t\tget_tree().root.get_node("VientoProject").call_deferred("finish_project")\n' : ''}func _exit_tree() -> void:
\tInput.action_release("ui_accept")
${live ? '\tInput.action_release("ui_right")' : ''}
`);
  let trackId;
  if (consumers) {
    const table = structuredClone(DEFAULT_ANIMATION_STATE_TABLE); table.transitions[0].trigger.name = 'physics.jumped';
    await f.script('checkpoint', generateEditableGodotAnimationStateScript(table).content);
    const audio = await f.read('documents/audio/demo.json'); audio.cues = []; audio.sceneObjectId = f.sceneIds[0]; trackId = audio.tracks[0].id;
    await f.write('documents/audio/first.json', audio);
    const record = await f.read('metadata/documents/88888888-8888-4888-8888-888888888888.json');
    await f.write(`metadata/documents/${firstAudioId}.json`, { ...record, id: firstAudioId, sourcePath: 'documents/audio/first.json',
      relations: record.relations.map(row => row.targetId === f.sceneIds[1] ? { ...row, targetId: f.sceneIds[0] } : row) });
    await f.edit(`metadata/documents/${f.sceneIds[0]}.json`, record => { record.relations.push({ kind: 'audio', targetId: firstAudioId, slot: 'scene audio' }); });
    await addBehavior(audioScriptId, audioBindingId, 'landing-audio', GODOT_PROJECT_EVENT_AUDIO_SCRIPT, { event_name: 'physics.landed', track_id: trackId, instance_id: f.instanceId });
  }
  return { ...f, manifestId, manifestPath, publisherScriptId, publisherBindingId, driverScriptId, driverBindingId,
    audioScriptId, audioBindingId, firstAudioId, trackId, animationBindingId: f.bindingId, actionClipId: f.clipIds[0][1], addBehavior };
}
