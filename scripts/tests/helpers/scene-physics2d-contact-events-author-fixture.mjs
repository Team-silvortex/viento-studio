import { scenePhysics2DCharacterEventsAuthor } from './scene-physics2d-character-events-author-fixture.mjs';
import { GODOT_CHARACTER_CONTACT_EVENTS_SCRIPT } from '../../../engine/godot-character-contact-events-script.mjs';
import { generateEditableGodotAnimationStateScript } from '../../../engine/animation-state-script-source.mjs';
import { DEFAULT_ANIMATION_STATE_TABLE } from '../../../engine/godot-animation-state-script.mjs';
const id = n => `76767676-7676-4676-8676-${String(n).padStart(12, '0')}`;

export async function scenePhysics2DContactEventsAuthor(t, { consumers = false, jump = true, hold = false, live = false } = {}) {
  const f = await scenePhysics2DCharacterEventsAuthor(t, { consumers, jump, hold, live });
  const motionPublisherScriptId = f.publisherScriptId, motionPublisherBindingId = f.publisherBindingId;
  const publisherScriptId = id(1), publisherBindingId = id(2), otherInstanceId = f.wallInstanceId;
  const otherBodyId = (await f.read(f.physicsPath)).bodies.find(body => body.instanceId === otherInstanceId).id;
  await f.addBehavior(publisherScriptId, publisherBindingId, 'contact-events', GODOT_CHARACTER_CONTACT_EVENTS_SCRIPT,
    { started_event: 'physics.contact_started', ended_event: 'physics.contact_ended', other_instance_id: otherInstanceId });
  if (consumers) {
    const table = structuredClone(DEFAULT_ANIMATION_STATE_TABLE); table.transitions[0].trigger.name = 'physics.contact_ended';
    await f.script('checkpoint', generateEditableGodotAnimationStateScript(table).content);
    await f.edit(f.manifestPath, document => {
      const audio = document.bindings.find(binding => binding.bindingId === f.audioBindingId);
      audio.parameters.event_name = 'physics.contact_started'; audio.parameters.instance_id = otherInstanceId;
    });
  }
  return { ...f, publisherScriptId, publisherBindingId, motionPublisherScriptId, motionPublisherBindingId, otherInstanceId, otherBodyId };
}
