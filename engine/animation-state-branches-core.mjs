// Explicit ordered event branches are admitted by their own optional Rust capability.
import { dispatchStudioCoreAnimationStateBranches, STUDIO_CORE_PROTOCOL_VERSION } from './studio-core.mjs';
const freeze = value => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};
export function inspectAnimationStateBranches(table) {
  return freeze(dispatchStudioCoreAnimationStateBranches({ protocolVersion: STUDIO_CORE_PROTOCOL_VERSION,
    operation: 'animationStateTable.inspectBranches', table }));
}
