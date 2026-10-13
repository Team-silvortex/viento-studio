// Stateless Rust particle preparation and explicit-time sampling. Callers own
// clocks and rendering; a missing capability never substitutes JavaScript math.
import { dispatchStudioCoreScene3DParticles, STUDIO_CORE_PROTOCOL_VERSION } from './studio-core.mjs';
function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
export function prepareScene3DParticleField(field) {
  return freeze(dispatchStudioCoreScene3DParticles({ protocolVersion: STUDIO_CORE_PROTOCOL_VERSION,
    operation: 'scene3d.prepareParticleField', field }));
}
export function sampleScene3DParticleField(field, timeSeconds) {
  return freeze(dispatchStudioCoreScene3DParticles({ protocolVersion: STUDIO_CORE_PROTOCOL_VERSION,
    operation: 'scene3d.sampleParticleField', field, timeSeconds }));
}
