// One engine-independent admission facade for current drafts. Version probing
// inspects own data descriptors only; the chosen Rust bridge validates everything.
import { inspectAnimationStateTable } from './animation-state-table-core.mjs';
import { dispatchStudioCoreAnimationStateConditions, STUDIO_CORE_PROTOCOL_VERSION } from './studio-core.mjs';
const freeze = value => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};
const ownValue = (value, key) => value && typeof value === 'object' ? Object.getOwnPropertyDescriptor(value, key)?.value : undefined;
function hasCondition(table) {
  const transitions = ownValue(table, 'transitions');
  if (!Array.isArray(transitions)) return false;
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(transitions))) {
    const trigger = ownValue(descriptor.value, 'trigger');
    if (trigger && typeof trigger === 'object' && Object.getOwnPropertyDescriptor(trigger, 'condition')) return true;
  }
  return false;
}
export function inspectAnimationStateDeclaration(table) {
  if (!hasCondition(table)) return inspectAnimationStateTable(table);
  return freeze(dispatchStudioCoreAnimationStateConditions({ protocolVersion: STUDIO_CORE_PROTOCOL_VERSION, operation: 'animationStateTable.inspectConditional', table }));
}
export function inspectAnimationStateCondition(condition) {
  return freeze(dispatchStudioCoreAnimationStateConditions({ protocolVersion: STUDIO_CORE_PROTOCOL_VERSION, operation: 'animationStateCondition.inspect', condition }).condition);
}
export function evaluateAnimationStateCondition(condition, value) {
  return dispatchStudioCoreAnimationStateConditions({ protocolVersion: STUDIO_CORE_PROTOCOL_VERSION, operation: 'animationStateCondition.evaluate', condition, value }).matches;
}
