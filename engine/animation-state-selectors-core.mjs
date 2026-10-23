// Declaration-only selection of project-state values. Runtime adapters resolve
// the selected key when delivering the event; this facade never reads a store.
import { dispatchStudioCoreAnimationStateSelectors, STUDIO_CORE_PROTOCOL_VERSION } from './studio-core.mjs';
const freeze = value => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};
export function inspectAnimationStateSelectedTable(table) {
  return freeze(dispatchStudioCoreAnimationStateSelectors({ protocolVersion: STUDIO_CORE_PROTOCOL_VERSION,
    operation: 'animationStateTable.inspectSelected', table }));
}
