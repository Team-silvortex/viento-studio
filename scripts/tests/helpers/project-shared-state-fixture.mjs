import { runtimeProject, runtimeId, projectReady, finishProject, enterScene, readyScene, exitScene } from './project-runtime-fixture.mjs';
export function sharedStateProject() {
  const plan = runtimeProject({ behavior: true }), [first, second] = plan.scenes;
  second.schemaVersion = 3; second.behaviors = structuredClone(first.behaviors);
  const behavior = second.behaviors;
  behavior.manifest.objectId = runtimeId(60); behavior.manifest.sourcePath = 'documents/second-behaviors.json';
  behavior.sources[0].objectId = runtimeId(61); behavior.sources[0].sourcePath = 'documents/second-script.txt';
  behavior.bindings[0].bindingId = runtimeId(62); behavior.bindings[0].implementation.sourceObjectId = runtimeId(61);
  behavior.bindings[0].declaration = { ...behavior.manifest, propertyPath: '/bindings/0' };
  return plan;
}
export const sharedFrame = frame => ({ ...frame, protocol: 2 });
export const sharedReady = plan => ({ ...sharedFrame(projectReady(plan)), stateRevision: 0 });
export const sharedFinished = (plan, visits, seconds, revision) => ({ ...sharedFrame(finishProject(plan, visits, seconds)), stateRevision: revision });
export const stateFrame = (scene, visitIndex, revision, key, value, operation = 'set') => {
  const binding = scene.behaviors.bindings[0];
  return { protocol: 2, event: 'state', visitIndex, sceneId: scene.scene.objectId,
    bindingId: binding.bindingId, instanceId: binding.instanceId, objectId: binding.objectId,
    revision, operation, key, ...(operation === 'set' ? { value } : {}) };
};
export const stateOrigin = (scene, visitIndex = 1) => {
  const binding = scene.behaviors.bindings[0];
  return { visitIndex, sceneId: scene.scene.objectId, bindingId: binding.bindingId, instanceId: binding.instanceId,
    objectId: binding.objectId, source: structuredClone(binding.declaration) };
};
export function stateReturnTrip(plan) {
  const [a, b] = plan.scenes;
  return [sharedReady(plan), sharedFrame(enterScene(a, 1)), sharedFrame(readyScene(a, 1)), stateFrame(a, 1, 1, 'coins', 1),
    sharedFrame(exitScene(a, 1, 0.25, b)), sharedFrame(enterScene(b, 2)), sharedFrame(readyScene(b, 2)), stateFrame(b, 2, 2, 'message', '风と風 🌬️'),
    stateFrame(b, 2, 3, 'coins', undefined, 'delete'), sharedFrame(exitScene(b, 2, 0.25, a)), sharedFrame(enterScene(a, 3)),
    sharedFrame(readyScene(a, 3)), stateFrame(a, 3, 4, 'coins', true), sharedFrame(exitScene(a, 3, 0)), sharedFinished(plan, 3, 0.5, 4)];
}
