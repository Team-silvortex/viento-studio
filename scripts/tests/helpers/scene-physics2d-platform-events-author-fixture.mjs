import { scenePhysics2DPlatformMotionAuthor } from './scene-physics2d-platform-motion-author-fixture.mjs';
import { GODOT_PLATFORM_ENDPOINT_EVENTS_SCRIPT } from '../../../engine/godot-platform-endpoint-events-script.mjs';
import { generateEditableGodotAnimationStateScript } from '../../../engine/animation-state-script-source.mjs';
import { DEFAULT_ANIMATION_STATE_TABLE } from '../../../engine/godot-animation-state-script.mjs';
const id = n => `85858585-8585-4858-8858-${String(n).padStart(12, '0')}`;

// The body already declares a trajectory. enabled controls the ordinary author
// publisher binding, so Chrome can explicitly create/save the same starter.
export async function scenePhysics2DPlatformEventsAuthor(t, { enabled = true, consumers = true,
  originEvent = 'physics.platform_origin', destinationEvent = 'physics.platform_destination', ...options } = {}) {
  const f = await scenePhysics2DPlatformMotionAuthor(t, { ...options, enabled: true, consumers });
  const platformPublisherScriptId = id(1), platformPublisherBindingId = id(2);
  await f.edit(f.manifestPath, document => {
    document.bindings = document.bindings.filter(binding => ![f.publisherBindingId, f.contactBindingId].includes(binding.bindingId));
    if (consumers) document.bindings.find(binding => binding.bindingId === f.audioBindingId).parameters = {
      event_name: destinationEvent, track_id: f.trackId, instance_id: f.platformInstanceId,
    };
  });
  if (consumers) {
    const table = structuredClone(DEFAULT_ANIMATION_STATE_TABLE); table.transitions[0].trigger.name = destinationEvent;
    await f.script('checkpoint', generateEditableGodotAnimationStateScript(table).content);
  }
  if (enabled) await f.addBehavior(platformPublisherScriptId, platformPublisherBindingId, 'platform-endpoints', GODOT_PLATFORM_ENDPOINT_EVENTS_SCRIPT,
    { origin_event: originEvent, destination_event: destinationEvent }, f.platformInstanceId);
  return { ...f, enabled, originEvent, destinationEvent, platformPublisherScriptId, platformPublisherBindingId,
    publisherScriptId: platformPublisherScriptId, publisherBindingId: platformPublisherBindingId };
}
