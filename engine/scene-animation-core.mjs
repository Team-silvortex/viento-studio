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
// Explicit authoring transformation. The native result never changes playback
// state or saves source text; callers decide whether to apply its document.
export function retimeSceneAnimation(document, durationSeconds) {
  return freeze(dispatchStudioCoreSceneAnimation({ protocolVersion: STUDIO_CORE_PROTOCOL_VERSION,
    operation: 'sceneAnimation.retime', document, durationSeconds }));
}
export function copySceneAnimationTrack(document, sourceTrackId, targetInstanceId, newTrackId) {
  return freeze(dispatchStudioCoreSceneAnimation({ protocolVersion: STUDIO_CORE_PROTOCOL_VERSION,
    operation: 'sceneAnimation.copyTrack', document, sourceTrackId, targetInstanceId, newTrackId }));
}
export function sampleSceneAnimation(document, timeSeconds) {
  return freeze(dispatchStudioCoreSceneAnimation({ protocolVersion: STUDIO_CORE_PROTOCOL_VERSION,
    operation: 'sceneAnimation.sample', document, timeSeconds }));
}

// Capture the argument record before property access so a transport request
// cannot invoke caller getters or serializers before reaching the strict ABI.
export function advanceSceneAnimationTransport(input) {
  return animationTransport(input, 'sceneAnimation.transport');
}
export function advanceSceneAnimationClipTransport(input) {
  return animationTransport(input, 'sceneAnimation.clipTransport');
}
export function sampleSceneAnimationClip(document, clipId, timeSeconds) {
  return freeze(dispatchStudioCoreSceneAnimation({ protocolVersion: STUDIO_CORE_PROTOCOL_VERSION,
    operation: 'sceneAnimation.sampleClip', document, clipId, timeSeconds }));
}
function animationTransport(input, operation) {
  const prototype = input && typeof input === 'object' ? Object.getPrototypeOf(input) : undefined;
  const fields = ['document', 'state', 'timeSeconds', 'command'];
  const properties = input && typeof input === 'object' ? Object.getOwnPropertyDescriptors(input) : {};
  if (Array.isArray(input) || prototype !== Object.prototype && prototype !== null || Reflect.ownKeys(properties).length !== fields.length
    || fields.some(key => !properties[key]?.enumerable || !Object.hasOwn(properties[key], 'value'))) {
    throw Object.assign(new TypeError('Expected a complete scene animation transport request.'), { errorCode: 'studio_core_request_invalid' });
  }
  return freeze(dispatchStudioCoreSceneAnimation({ protocolVersion: STUDIO_CORE_PROTOCOL_VERSION,
    operation, ...Object.fromEntries(fields.map(key => [key, properties[key].value])) }));
}
