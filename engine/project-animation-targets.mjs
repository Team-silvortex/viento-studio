// Explicit playback targets are independent of command origins. Only the wire
// reader has the frozen author plan needed to prove track membership.
import { projectRuntimeExact as exact, projectRuntimeUuid as uuid,
  copyProjectRuntimeData as copy, freezeProjectRuntimeData as freeze, invalidProjectRuntime as invalid } from './project-runtime-contracts.mjs';

export function captureProjectAnimationTarget(input) {
  const target = copy(input);
  if (target?.kind === 'scene' && exact(target, ['kind'])) return freeze(target);
  if (target?.kind === 'instance' && exact(target, ['kind', 'instanceId']) && uuid(target.instanceId)) return freeze(target);
  throw invalid();
}
export function projectAnimationTargetKey(input) {
  const target = captureProjectAnimationTarget(input);
  return target.kind === 'scene' ? 'scene' : `instance/${target.instanceId}`;
}
export function projectAnimationTargetForBinding(animation, binding) {
  if (!animation?.document || !binding || !uuid(binding.instanceId)) throw invalid();
  if (animation.document.schemaVersion === 4 && animation.document.playbackScope === 'instance') {
    if (!animation.document.tracks.some(track => track.instanceId === binding.instanceId)) throw invalid();
    return captureProjectAnimationTarget({ kind: 'instance', instanceId: binding.instanceId });
  }
  return captureProjectAnimationTarget({ kind: 'scene' });
}
export function validateProjectAnimationTarget(animation, input, binding = null) {
  const target = captureProjectAnimationTarget(input);
  const instance = animation?.document?.schemaVersion === 4 && animation.document.playbackScope === 'instance';
  if (!animation?.document || instance !== (target.kind === 'instance')
    || instance && !animation.document.tracks.some(track => track.instanceId === target.instanceId)
    || binding && projectAnimationTargetKey(projectAnimationTargetForBinding(animation, binding)) !== projectAnimationTargetKey(target)) throw invalid();
  return target;
}
export function initialProjectAnimationTargetState(animation, target) {
  return target.kind === 'instance' ? { sceneObjectId: animation.document.sceneObjectId,
    phase: 'stopped', positionSeconds: 0, timeSeconds: 0, clipId: null } : null;
}
