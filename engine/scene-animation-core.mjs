// Stateless visual animation semantics. Rust owns validation and interpolation;
// callers own author text, scene resolution, clocks, playback and rendering.
import { dispatchStudioCoreSceneAnimation, STUDIO_CORE_PROTOCOL_VERSION } from './studio-core.mjs';
const freeze = value => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};
export function inspectSceneAnimation(document) {
  return freeze(dispatchStudioCoreSceneAnimation({ protocolVersion: STUDIO_CORE_PROTOCOL_VERSION,
    operation: 'sceneAnimation.inspect', document }));
}
export function sampleSceneAnimation(document, timeSeconds) {
  return freeze(dispatchStudioCoreSceneAnimation({ protocolVersion: STUDIO_CORE_PROTOCOL_VERSION,
    operation: 'sceneAnimation.sample', document, timeSeconds }));
}
