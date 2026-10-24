// Manual, side-effect-free authoring samples, never runtime observations.
import { inspectAnimationStateDeclarationWithCombinations, evaluateAnimationStateCondition } from './animation-state-conditions-core.mjs';
import { supportsStudioCoreAnimationStateConditions } from './studio-core.mjs';
import { PROJECT_SHARED_STATE_LIMITS, projectSharedStateKey, projectSharedStateScalar } from './project-shared-state.mjs';
const models = new WeakSet();
const invalid = () => Object.assign(new TypeError('Expected an admitted animation table and a bounded manual event sample.'), { errorCode: 'animation_state_event_preview_invalid' });
const unavailable = () => Object.assign(new Error('Animation event preview requires the Rust scalar comparison capability.'), { errorCode: 'studio_core_unavailable' });
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
function guarded(operation) {
  try { return operation(); } catch (error) {
    if (error?.errorCode === 'studio_core_unavailable' || error?.errorCode === 'studio_core_response_invalid') throw error;
    throw invalid();
  }
}
// Descriptor-only traversal also checks unused samples, before any comparison.
function copySample(input) {
  let nodes = 0, characters = 0;
  const active = new Set();
  function copy(value, depth = 0) {
    if (++nodes > 512 || depth > 6) throw invalid();
    if (value === null || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') { if ((characters += value.length) > 32768) throw invalid(); return value; }
    if (!value || typeof value !== 'object' || active.has(value)) throw invalid();
    const array = Array.isArray(value), prototype = Object.getPrototypeOf(value);
    if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) throw invalid();
    const properties = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(properties);
    if (array && (properties.length.value > 64 || keys.length !== properties.length.value + 1) || !array && keys.length > 4) throw invalid();
    const result = array ? [] : {};
    active.add(value);
    for (const key of array ? Array.from({ length: properties.length.value }, (_, index) => String(index)) : keys) {
      const property = properties[key];
      if (typeof key !== 'string' || ['__proto__', 'constructor', 'prototype', 'toJSON'].includes(key) || !property?.enumerable || !Object.hasOwn(property, 'value')) throw invalid();
      result[key] = copy(property.value, depth + 1);
    }
    active.delete(value); return result;
  }
  return copy(input);
}
function assertModel(model) { if (!models.has(model)) throw invalid(); }
function candidatesFor(model, stateKey, eventName) {
  assertModel(model);
  if (typeof stateKey !== 'string' || !model.states.some(state => state.key === stateKey) || !projectSharedStateKey(eventName)) throw invalid();
  return model.table.transitions.flatMap((edge, transitionIndex) => edge.from === stateKey && edge.trigger.kind === 'event' && edge.trigger.name === eventName ? [{ edge, transitionIndex }] : []);
}
const leavesFor = condition => condition ? (Object.hasOwn(condition, 'combine') ? condition.conditions : [condition]) : [];
export function createAnimationStateEventPreview(table) {
  return guarded(() => {
    const inspected = inspectAnimationStateDeclarationWithCombinations(table);
    const model = freeze({ table: inspected.table, states: inspected.states, eventNames: inspected.eventNames });
    models.add(model); return model;
  });
}
export function animationStateEventPreviewKeys(model, stateKey, eventName) {
  return guarded(() => freeze([...new Set(candidatesFor(model, stateKey, eventName).flatMap(({ edge }) => leavesFor(edge.trigger.condition).flatMap(leaf => leaf.selector ? [leaf.selector.key] : [])))]));
}
export function evaluateAnimationStateEventPreview(model, input) {
  return guarded(() => {
    assertModel(model);
    const sample = copySample(input);
    if (!exact(sample, ['stateKey', 'event', 'projectState']) || !exact(sample.event, ['name', 'value']) || !Array.isArray(sample.projectState)) throw invalid();
    const candidates = candidatesFor(model, sample.stateKey, sample.event.name);
    sample.event.value = projectSharedStateScalar(sample.event.value).value;
    const shared = new Map(); let bytes = 0;
    for (const entry of sample.projectState) {
      if (!exact(entry, ['key', 'value']) || !projectSharedStateKey(entry.key) || shared.has(entry.key)) throw invalid();
      const scalar = projectSharedStateScalar(entry.value);
      entry.value = scalar.value; bytes += entry.key.length + scalar.bytes;
      shared.set(entry.key, entry.value);
    }
    if (shared.size > PROJECT_SHARED_STATE_LIMITS.keys || bytes > PROJECT_SHARED_STATE_LIMITS.bytes) throw invalid();
    // Even an unmatched sample must not conceal a missing comparison capability.
    if (model.table.transitions.some(edge => Object.hasOwn(edge.trigger, 'condition')) && !supportsStudioCoreAnimationStateConditions()) throw unavailable();
    let selected = null;
    const trace = candidates.map(({ edge, transitionIndex }) => {
      const condition = edge.trigger.condition, kind = condition ? condition.combine ?? 'scalar' : 'fallback';
      const skipped = selected !== null;
      let stopped = skipped, matches = kind === 'fallback' || kind === 'all';
      const leaves = leavesFor(condition).map((leaf, index) => {
        if (stopped) return { index, condition: leaf, status: 'not-evaluated' };
        const present = !leaf.selector || shared.has(leaf.selector.key);
        const value = leaf.selector ? shared.get(leaf.selector.key) : sample.event.value;
        const actual = present ? { status: 'present', value } : { status: 'missing' };
        // Missing is not a scalar. Every present value (including a different
        // type) goes through the existing Rust comparator, never a JS predicate.
        const result = present ? evaluateAnimationStateCondition({ type: leaf.type, operator: leaf.operator, value: leaf.value }, value) : false;
        const reason = !present ? 'missing' : typeof value !== leaf.type ? 'type-mismatch' : 'comparison';
        matches = result;
        if (kind === 'all' && !result || kind === 'any' && result) stopped = true;
        return { index, condition: leaf, status: 'evaluated', actual, matches: result, reason };
      });
      const status = skipped ? 'not-evaluated' : matches ? 'selected' : 'rejected';
      if (status === 'selected') selected = { transitionIndex, stateKey: edge.to };
      return { transitionIndex, from: edge.from, to: edge.to, kind, status, leaves };
    });
    return freeze({ ...sample, candidates: trace, selected });
  });
}
