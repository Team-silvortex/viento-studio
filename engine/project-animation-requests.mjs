import { validateProjectAssemblyPlan } from './project-assembly-plan-contract.mjs';
import { validateProjectAnimationTarget } from './project-animation-targets.mjs';
import { canonicalJson } from './canonical-json.mjs';
import { PROJECT_EXECUTION_BUDGET_POLICY } from './project-execution-budget.mjs';
import { PROJECT_ANIMATION_COMMAND_LIMITS } from './project-animation-commands.mjs';
import { copyProjectRuntimeData as copy, projectRuntimeExact as exact } from './project-runtime-contracts.mjs';
import { createProjectQueuedRequestsReader, assertProjectQueuedRequestsReaderOptions } from './project-queued-requests.mjs';

export const PROJECT_ANIMATION_REQUEST_PREFIX = 'VIENTO_ANIMATION_REQUEST:';
const originKeys = ['visitIndex', 'sceneId', 'bindingId', 'instanceId', 'objectId'];
const same = (a, b) => canonicalJson(a) === canonicalJson(b);
const invalid = () => new TypeError('Invalid project animation request reader.');

export function createProjectAnimationRequestsReader(input, { runtimeReader, protocolVersion = 7, onSnapshot, retainedRequests = 128 } = {}) {
  assertProjectQueuedRequestsReaderOptions({ runtimeReader, onSnapshot, retainedRequests }, { name: 'animation', limit: PROJECT_EXECUTION_BUDGET_POLICY.animationRequests });
  if (![5, 6, 7, 8, 9, 10, 11].includes(protocolVersion)) throw invalid();
  const plan = validateProjectAssemblyPlan(input), scenes = new Map(plan.scenes.map(scene => [scene.scene.objectId, scene]));
  if (plan.scenes.some(scene => scene.animation?.document.playbackScope === 'instance') !== (protocolVersion === 11)) throw invalid();
  return createProjectQueuedRequestsReader({ runtimeReader, onSnapshot, retainedRequests }, {
    name: 'animation', prefix: PROJECT_ANIMATION_REQUEST_PREFIX, limit: PROJECT_EXECUTION_BUDGET_POLICY.animationRequests,
    pendingLimit: PROJECT_ANIMATION_COMMAND_LIMITS.pending, acceptedKeys: ['origin', 'target', 'command'],
    acceptedData(frame, current) {
      if (!exact(frame.origin, originKeys) || frame.origin.visitIndex !== current.visitIndex || frame.origin.sceneId !== current.sceneId) return false;
      const scene = scenes.get(current.sceneId), binding = scene.behaviors?.bindings.find(item => item.bindingId === frame.origin.bindingId
        && item.instanceId === frame.origin.instanceId && item.objectId === frame.origin.objectId);
      if (!binding || !scene.animation) return false;
      const target = validateProjectAnimationTarget(scene.animation, frame.target, binding), command = frame.command;
      if (!command || !['play', 'pause', 'stop', 'seek', ...(protocolVersion >= 6 ? ['select'] : [])].includes(command.action)
        || !exact(command, ['action', ...(command.action === 'seek' ? ['positionSeconds'] : []), ...(command.action === 'select' ? ['clipId'] : [])])
        || command.action === 'seek' && (!Number.isFinite(command.positionSeconds) || command.positionSeconds < 0
          || command.positionSeconds > scene.animation.document.durationSeconds)
        || command.action === 'select' && command.clipId !== null && !scene.animation.document.clips?.some(clip => clip.id === command.clipId)) return false;
      // Queued selections may change the range; execution checks the current clip.
      return { origin: { ...frame.origin, source: copy(binding.declaration) }, target, command };
    },
    matchesReceipt: (row, frame) => row && originKeys.every(key => row.origin[key] === frame[key])
      && same(row.command, frame.command) && same(row.target, protocolVersion === 11 ? frame.target : { kind: 'scene' }),
  });
}
