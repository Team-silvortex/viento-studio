// Engine-independent declaration inspection. Rust owns strict admission and
// indexing; adapters own code generation, ports, playback and persistence.
import { dispatchStudioCoreAnimationStateTable, STUDIO_CORE_PROTOCOL_VERSION } from './studio-core.mjs';
const freeze = value => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};
export function inspectAnimationStateTable(table) {
  return freeze(dispatchStudioCoreAnimationStateTable({ protocolVersion: STUDIO_CORE_PROTOCOL_VERSION,
    operation: 'animationStateTable.inspect', table }));
}
