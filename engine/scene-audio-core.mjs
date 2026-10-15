// Stateless native audio rules. Hosts own source text, clocks, resources and
// playback devices; there is no JavaScript substitute for a missing core.
import { dispatchStudioCoreSceneAudio, STUDIO_CORE_PROTOCOL_VERSION } from './studio-core.mjs';
function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
export function inspectSceneAudio(document) {
  return freeze(dispatchStudioCoreSceneAudio({ protocolVersion: STUDIO_CORE_PROTOCOL_VERSION,
    operation: 'sceneAudio.inspect', document }));
}
export function sampleSceneAudio(document, timeSeconds) {
  return freeze(dispatchStudioCoreSceneAudio({ protocolVersion: STUDIO_CORE_PROTOCOL_VERSION,
    operation: 'sceneAudio.sample', document, timeSeconds }));
}
