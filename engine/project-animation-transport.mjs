import { advanceSceneAnimationTransport, advanceSceneAnimationClipTransport } from './scene-animation-core.mjs';
import { projectRuntimeExact as exact, copyProjectRuntimeData as copy, invalidProjectRuntime as invalid } from './project-runtime-contracts.mjs';

// One portable boundary connects protocol versions to the Rust transport. The
// host cannot choose a range or repair a receipt using renderer-owned state.
export function advanceProjectAnimationTransport(animation, protocolVersion, request) {
  const input = copy(request);
  if (!exact(input, ['state', 'timeSeconds', 'command'])) throw invalid();
  if (protocolVersion === 5) {
    if (animation.document.schemaVersion === 3) throw invalid();
    return advanceSceneAnimationTransport({ document: animation.document, ...input });
  }
  if (![6, 7, 8, 9, 10].includes(protocolVersion)) throw invalid();
  if (animation.document.schemaVersion === 3) return advanceSceneAnimationClipTransport({ document: animation.document, ...input });
  // A mixed project may visit an older animation. Its only selection is the
  // whole document; retain its original Rust rules and add the explicit null.
  let state = input.state;
  if (state !== null) {
    if (!exact(state, ['sceneObjectId', 'phase', 'positionSeconds', 'timeSeconds', 'clipId']) || state.clipId !== null) throw invalid();
    const { clipId, ...legacy } = state; state = legacy;
  }
  const advance = (current, command) => advanceSceneAnimationTransport({ document: animation.document,
    state: current, timeSeconds: input.timeSeconds, command });
  if (input.command?.action === 'select') {
    if (!exact(input.command, ['action', 'clipId']) || input.command.clipId !== null) throw invalid();
    state = advance(advance(state, { action: 'stop' }), { action: 'pause' });
  } else state = advance(state, input.command);
  return Object.freeze({ ...state, clipId: null });
}

export function projectAnimationClipDeclaration(animation, clipId) {
  if (clipId === null) return null;
  const clip = animation.document.clips?.find(candidate => candidate.id === clipId);
  const source = animation.locations.clips?.find(candidate => candidate.id === clipId)?.declaration;
  if (!clip || !source) throw invalid();
  return { ...clip, source };
}
