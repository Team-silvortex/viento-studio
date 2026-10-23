import { clipProject, clipCommand } from './project-animation-clip-command-fixture.mjs';
import { animationReady } from './project-animation-command-fixture.mjs';
import { enterScene, readyScene, exitScene } from './project-runtime-fixture.mjs';

export const completionFrame = frame => ({ ...frame, protocol: 7,
  ...(['ready', 'finished'].includes(frame.event) ? { animationCompletionSequence: 0 } : {}) });
export function completionProject() {
  const plan = clipProject();
  plan.scenes[0].animation.document.loop = false;
  return plan;
}
export const completionStart = plan => [completionFrame(animationReady(plan)),
  completionFrame(enterScene(plan.scenes[0], 1)), completionFrame(readyScene(plan.scenes[0], 1))];
export const completionCommand = (...args) => completionFrame(clipCommand(...args));
export function animationCompleted(scene, visitIndex, sequence, commandSequence, seconds, clipId = null, tokens = [1]) {
  const clip = scene.animation.document.clips?.find(candidate => candidate.id === clipId);
  const { bindingId, instanceId, objectId } = scene.behaviors.bindings[0];
  return { protocol: 7, event: 'animation-completed', completionSequence: sequence, commandSequence,
    visitIndex, sceneId: scene.scene.objectId,
    state: { sceneObjectId: scene.scene.objectId, phase: 'finished',
      positionSeconds: clip ? clip.endSeconds - clip.startSeconds : scene.animation.document.durationSeconds,
      timeSeconds: seconds, clipId },
    recipients: tokens.map(subscriptionId => ({ subscriptionId, bindingId, instanceId, objectId })) };
}
export const completionDelivery = (scene, visitIndex, sequence, subscriptionId = 1, status = 'handled') =>
  ({ protocol: 7, event: 'animation-completion-delivery', completionSequence: sequence, subscriptionId,
    visitIndex, sceneId: scene.scene.objectId, status });
export function completionRun(plan = completionProject()) {
  const scene = plan.scenes[0], clip = scene.animation.document.clips[0].id, next = scene.animation.document.clips[1].id;
  return [...completionStart(plan),
    completionCommand(scene, 1, 1, { action: 'select', clipId: clip }, 0, 0, 'paused', clip),
    completionCommand(scene, 1, 2, { action: 'play' }, 0, 0, 'playing', clip),
    animationCompleted(scene, 1, 1, 2, .4, clip),
    completionDelivery(scene, 1, 1),
    completionCommand(scene, 1, 3, { action: 'select', clipId: next }, .4, 0, 'paused', next),
    completionCommand(scene, 1, 4, { action: 'play' }, .4, 0, 'playing', next),
    completionFrame(exitScene(scene, 1, .5)),
    { protocol: 7, event: 'finished', assemblyId: plan.assembly.objectId, visitCount: 1, totalSeconds: .5,
      stateRevision: 0, eventSequence: 0, audioCommandSequence: 0, animationCommandSequence: 4, animationCompletionSequence: 1 }];
}
