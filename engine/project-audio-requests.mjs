import { validateProjectAssemblyPlan } from './project-assembly-plan-contract.mjs';
import { PROJECT_EXECUTION_BUDGET_POLICY } from './project-execution-budget.mjs';
import { PROJECT_AUDIO_COMMAND_LIMITS } from './project-audio-commands.mjs';
import { copyProjectRuntimeData as copy, projectRuntimeExact as exact } from './project-runtime-contracts.mjs';
import { createProjectQueuedRequestsReader, assertProjectQueuedRequestsReaderOptions } from './project-queued-requests.mjs';

export const PROJECT_AUDIO_REQUEST_PREFIX = 'VIENTO_AUDIO_REQUEST:';
const originKeys = ['visitIndex', 'sceneId', 'bindingId', 'instanceId', 'objectId'];

export function createProjectAudioRequestsReader(input, { runtimeReader, protocolVersion = 4, onSnapshot, retainedRequests = 128 } = {}) {
  assertProjectQueuedRequestsReaderOptions({ runtimeReader, onSnapshot, retainedRequests }, { name: 'audio', limit: PROJECT_EXECUTION_BUDGET_POLICY.audioRequests });
  if (![4, 5, 6, 7, 8, 9, 10, 11].includes(protocolVersion)) throw new TypeError('Invalid project audio request reader.');
  const plan = validateProjectAssemblyPlan(input), scenes = new Map(plan.scenes.map(scene => [scene.scene.objectId, scene]));
  return createProjectQueuedRequestsReader({ runtimeReader, onSnapshot, retainedRequests }, {
    name: 'audio', prefix: PROJECT_AUDIO_REQUEST_PREFIX, limit: PROJECT_EXECUTION_BUDGET_POLICY.audioRequests,
    pendingLimit: PROJECT_AUDIO_COMMAND_LIMITS.pending, acceptedKeys: ['origin', 'trackId', 'action'],
    acceptedData(frame, current) {
      if (!exact(frame.origin, originKeys) || frame.origin.visitIndex !== current.visitIndex || frame.origin.sceneId !== current.sceneId
        || !['play', 'stop'].includes(frame.action)) return false;
      const scene = scenes.get(current.sceneId), binding = scene.behaviors?.bindings.find(item => item.bindingId === frame.origin.bindingId
        && item.instanceId === frame.origin.instanceId && item.objectId === frame.origin.objectId);
      const track = scene.audio?.document.tracks.find(item => item.id === frame.trackId);
      const source = scene.audio?.locations.tracks.find(item => item.id === frame.trackId)?.declaration;
      if (!binding || !track || !source) return false;
      return { origin: { ...frame.origin, source: copy(binding.declaration) },
        track: { trackId: track.id, resourceId: track.resourceId, source: copy(source) }, action: frame.action };
    },
    matchesReceipt: (row, frame) => row && originKeys.every(key => row.origin[key] === frame[key])
      && row.action === frame.action && row.track.trackId === frame.trackId && row.track.resourceId === frame.resourceId,
  });
}
