// Bounded declaration admission only. Runtime adapters own event-time reads and
// short-circuit evaluation; this interface cannot read or mutate project state.
import { dispatchStudioCoreAnimationStateCombinations, STUDIO_CORE_PROTOCOL_VERSION } from './studio-core.mjs';
const freeze = value => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};
export function inspectAnimationStateCombinedTable(table) {
  return freeze(dispatchStudioCoreAnimationStateCombinations({ protocolVersion: STUDIO_CORE_PROTOCOL_VERSION,
    operation: 'animationStateTable.inspectCombined', table }));
}
