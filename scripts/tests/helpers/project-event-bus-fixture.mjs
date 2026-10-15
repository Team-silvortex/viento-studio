import { sharedStateProject, sharedFrame, sharedReady, sharedFinished, stateFrame, stateOrigin } from './project-shared-state-fixture.mjs';
import { enterScene, readyScene, exitScene } from './project-runtime-fixture.mjs';
export { sharedStateProject as eventProject, stateOrigin as eventOrigin };
export const eventFrame = frame => ({ ...frame, protocol: 3 });
export const eventReady = plan => ({ ...eventFrame(sharedReady(plan)), eventSequence: 0 });
export const eventFinished = (plan, visits, seconds, stateRevision, sequence) => ({ ...eventFrame(sharedFinished(plan, visits, seconds, stateRevision)), eventSequence: sequence });
export const eventRecipient = (scene, subscriptionId) => {
  const { bindingId, instanceId, objectId } = scene.behaviors.bindings[0]; return { subscriptionId, bindingId, instanceId, objectId };
};
export const publication = (scene, visitIndex, sequence, name, value, recipients = [eventRecipient(scene, visitIndex)]) => {
  const { bindingId, instanceId, objectId } = scene.behaviors.bindings[0];
  return { protocol: 3, event: 'event-publish', visitIndex, sceneId: scene.scene.objectId, bindingId, instanceId, objectId, sequence, name, value, recipients };
};
export const delivery = (scene, visitIndex, sequence, subscriptionId, status = 'handled') => ({ protocol: 3, event: 'event-delivery', visitIndex, sceneId: scene.scene.objectId, sequence, subscriptionId, status });
export function eventReturnTrip(plan) {
  const [a, b] = plan.scenes;
  return [eventReady(plan), eventFrame(enterScene(a, 1)), eventFrame(readyScene(a, 1)), publication(a, 1, 1, 'door.open', '钥匙 / 鍵 🔑'),
    publication(a, 1, 2, 'door.open', false), eventFrame(stateFrame(a, 1, 1, 'seen', true)), delivery(a, 1, 1, 1), delivery(a, 1, 2, 1, 'skipped'),
    eventFrame(exitScene(a, 1, 0.25, b)), eventFrame(enterScene(b, 2)), eventFrame(readyScene(b, 2)), publication(b, 2, 3, 'door.open', 0), delivery(b, 2, 3, 2),
    eventFrame(exitScene(b, 2, 0.25, a)), eventFrame(enterScene(a, 3)), eventFrame(readyScene(a, 3)), publication(a, 3, 4, 'nobody', '', []),
    eventFrame(exitScene(a, 3, 0)), eventFinished(plan, 3, 0.5, 1, 4)];
}
