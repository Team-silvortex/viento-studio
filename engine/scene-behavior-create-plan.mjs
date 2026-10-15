// First-creation source planning owns no identities, project reads or writes.
// The existing behavior inspector remains the author-format authority.
import { inspectSceneBehaviors, SCENE_BEHAVIOR_LIMITS } from './scene-behaviors.mjs';

const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
const invalid = () => { throw new TypeError('Expected a bounded, exact behavior creation data record.'); };
const diagnostic = () => ({ severity: 'error', code: 'build_behavior_invalid',
  message: 'Expected exact behavior creation fields, allocated identities and a bounded binding list.', propertyPath: '' });
const failure = diagnostics => freeze({ ok: false, content: null, sourceObjectIds: [], diagnostics });
function record(value, expected) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) invalid();
  const names = Reflect.ownKeys(value);
  if (names.length !== expected.length || names.some(name => typeof name !== 'string' || !expected.includes(name))) invalid();
  const result = {};
  for (const key of expected) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) invalid();
    result[key] = descriptor.value;
  }
  return result;
}
function text(value, limit) {
  if (typeof value !== 'string' || value.length > limit) invalid();
  return value;
}
function bindings(input) {
  if (!Array.isArray(input) || ![Array.prototype, null].includes(Object.getPrototypeOf(input))) invalid();
  const length = Object.getOwnPropertyDescriptor(input, 'length')?.value;
  if (!Number.isSafeInteger(length) || length < 1 || length > SCENE_BEHAVIOR_LIMITS.bindings || Reflect.ownKeys(input).length !== length + 1) invalid();
  const result = [];
  for (let index = 0; index < length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(input, String(index));
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) invalid();
    const value = record(descriptor.value, ['bindingId', 'instanceId', 'sourceObjectId']);
    result.push({ bindingId: text(value.bindingId, 36), instanceId: text(value.instanceId, 36), sourceObjectId: text(value.sourceObjectId, 36) });
  }
  return result;
}
export function createSceneBehaviorCreationDraft(input) {
  try {
    const raw = record(input, ['sceneObjectId', 'backendId', 'language', 'bindings']);
    const captured = { sceneObjectId: text(raw.sceneObjectId, 36), backendId: text(raw.backendId, 192), language: text(raw.language, 64), bindings: bindings(raw.bindings) };
    const content = JSON.stringify({ format: 'viento-scene-behaviors', schemaVersion: 1, sceneObjectId: captured.sceneObjectId,
      bindings: captured.bindings.map(({ bindingId, instanceId, sourceObjectId }) => ({ bindingId, instanceId,
        implementation: { backendId: captured.backendId, language: captured.language, sourceObjectId }, parameters: {}, events: [] })) }, null, 2) + '\n';
    const checked = inspectSceneBehaviors(content);
    if (!checked.recognized || !checked.ok) return failure(checked.diagnostics.length ? checked.diagnostics : [diagnostic()]);
    return freeze({ ok: true, content, sourceObjectIds: [...new Set(checked.value.bindings.map(binding => binding.implementation.sourceObjectId))].sort(), diagnostics: [] });
  } catch { return failure([diagnostic()]); }
}
