import { eventProject } from './project-event-bus-fixture.mjs';
import { runtimeId, enterScene, readyScene, exitScene } from './project-runtime-fixture.mjs';
export const animationFrame = frame => ({ ...frame, protocol: 5 });
export function animationProject() {
  const plan = eventProject();
  for (const [index, scene] of plan.scenes.entries()) {
    const manifest = { objectId: runtimeId(110 + index), sourcePath: `documents/animation-${index}.json`, sourceRevision: scene.scene.sourceRevision };
    const track = { id: runtimeId(120 + index), instanceId: scene.actors[0].instanceId, property: 'opacity', interpolation: 'linear',
      keyframes: [{ atSeconds: 0, value: 1 }, { atSeconds: 1, value: 0 }] };
    scene.animation = { format: 'viento-animation-plan', schemaVersion: 1, manifest,
      document: { format: 'viento-scene-animation', schemaVersion: 1, sceneObjectId: scene.scene.objectId, durationSeconds: 1, loop: false, tracks: [track] },
      locations: { tracks: [{ id: track.id, declaration: { ...manifest, propertyPath: '/tracks/0' } }] } };
    scene.requiredCapabilities.push('animation.visual2d');
  }
  plan.requiredCapabilities = [...new Set(['project.scenes', ...plan.scenes.flatMap(scene => scene.requiredCapabilities)])].sort();
  return plan;
}
export const animationReady = plan => ({ protocol: 5, event: 'ready', assemblyId: plan.assembly.objectId, entrySceneId: plan.entrySceneId,
  stateRevision: 0, eventSequence: 0, audioCommandSequence: 0, animationCommandSequence: 0 });
export function animationCommand(scene, visitIndex, commandSequence, action, timeSeconds, positionSeconds, phase, seekSeconds) {
  const { bindingId, instanceId, objectId } = scene.behaviors.bindings[0];
  return { protocol: 5, event: 'animation-command', commandSequence, visitIndex, sceneId: scene.scene.objectId, bindingId, instanceId, objectId,
    command: { action, ...(action === 'seek' ? { positionSeconds: seekSeconds } : {}) },
    state: { sceneObjectId: scene.scene.objectId, phase, positionSeconds, timeSeconds } };
}
export function animationReturnTrip(plan) {
  const [a, b] = plan.scenes;
  return [animationReady(plan), animationFrame(enterScene(a, 1)), animationFrame(readyScene(a, 1)),
    animationCommand(a, 1, 1, 'pause', .25, .25, 'paused'), animationCommand(a, 1, 2, 'seek', .25, .75, 'paused', .75),
    animationCommand(a, 1, 3, 'play', .25, .75, 'playing'), animationCommand(a, 1, 4, 'pause', .5, 1, 'paused'),
    animationCommand(a, 1, 5, 'play', .5, 0, 'playing'), animationFrame(exitScene(a, 1, .5, b)),
    animationFrame(enterScene(b, 2)), animationFrame(readyScene(b, 2)), animationCommand(b, 2, 6, 'pause', 0, 0, 'paused'), animationFrame(exitScene(b, 2, 0, a)),
    animationFrame(enterScene(a, 3)), animationFrame(readyScene(a, 3)), animationCommand(a, 3, 7, 'stop', 0, 0, 'stopped'),
    animationCommand(a, 3, 8, 'play', 0, 0, 'playing'), animationFrame(exitScene(a, 3, 0)),
    { protocol: 5, event: 'finished', assemblyId: plan.assembly.objectId, visitCount: 3, totalSeconds: .5,
      stateRevision: 0, eventSequence: 0, audioCommandSequence: 0, animationCommandSequence: 8 }];
}
