// A bounded manual authoring path. Recording a result explicitly adopts its
// proposed target; it is never evidence of an accepted or executed animation.
import { createAnimationStateEventPreview, evaluateAnimationStateEventPreview } from './animation-state-event-preview.mjs';

export const ANIMATION_STATE_TRIAL_LIMITS = Object.freeze({ steps: 32, sampleBytes: 65536 });
const sequences = new WeakSet(), pendingOwners = new WeakMap(), encoder = new TextEncoder();
const invalid = () => Object.assign(new TypeError('Expected an admitted manual animation trial sequence and its own pending step.'), { errorCode: 'animation_state_trial_sequence_invalid' });
const limit = () => Object.assign(new RangeError('The manual animation trial sequence exceeds its step or sample-byte budget.'), { errorCode: 'animation_state_trial_sequence_limit' });
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
function guarded(operation) {
  try { return operation(); } catch (error) {
    if (['studio_core_unavailable', 'studio_core_response_invalid', 'animation_state_trial_sequence_limit'].includes(error?.errorCode)) throw error;
    throw invalid();
  }
}
function branded(value) { if (!sequences.has(value)) throw invalid(); return value; }
function sequence(value) { const result = freeze(value); sequences.add(result); return result; }
function record(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) throw invalid();
  const descriptors = Object.getOwnPropertyDescriptors(input), keys = Reflect.ownKeys(descriptors);
  if (!keys.length || keys.length > 3) throw invalid();
  const result = {};
  for (const key of keys) {
    if (typeof key !== 'string' || !['kind', 'event', 'projectState'].includes(key) || !descriptors[key].enumerable || !Object.hasOwn(descriptors[key], 'value')) throw invalid();
    result[key] = descriptors[key].value;
  }
  if (result.kind === 'event' ? keys.length !== 3 || !keys.includes('event') || !keys.includes('projectState') : result.kind !== 'completed' || keys.length !== 1) throw invalid();
  return result;
}
const sampleSize = input => encoder.encode(JSON.stringify(input)).length;
function budget(current, input) {
  if (current.steps.length >= ANIMATION_STATE_TRIAL_LIMITS.steps || current.sampleBytes + sampleSize(input) > ANIMATION_STATE_TRIAL_LIMITS.sampleBytes) throw limit();
}

export function createAnimationStateTrialSequence(table, initialStateKey) {
  return guarded(() => {
    // Resolve the default only after complete admission; never read an author's
    // initialState getter through a JavaScript default parameter expression.
    const model = createAnimationStateEventPreview(table), stateKey = initialStateKey === undefined ? model.table.initialState : initialStateKey;
    if (typeof stateKey !== 'string' || !model.states.some(state => state.key === stateKey)) throw invalid();
    return sequence({ model, initialStateKey: stateKey, stateKey, steps: [], sampleBytes: 0 });
  });
}

export function previewAnimationStateTrialStep(current, input) {
  return guarded(() => {
    branded(current);
    const request = record(input); let normalized, result;
    if (request.kind === 'event') {
      result = evaluateAnimationStateEventPreview(current.model, { stateKey: current.stateKey, event: request.event, projectState: request.projectState });
      normalized = { kind: 'event', event: result.event, projectState: result.projectState };
    } else {
      // This deliberately assumes the active playback matches the completion.
      // A table cannot establish clip identity, looping, elapsed time or life.
      const candidates = current.model.table.transitions.flatMap((edge, transitionIndex) => edge.from === current.stateKey && edge.trigger.kind === 'completed'
        ? [{ transitionIndex, from: edge.from, to: edge.to, kind: 'completed', status: 'selected', leaves: [] }] : []);
      const selected = candidates.length ? { transitionIndex: candidates[0].transitionIndex, stateKey: candidates[0].to } : null;
      result = { stateKey: current.stateKey, candidates, selected, assumption: 'current-playback-completed' };
      normalized = { kind: 'completed' };
    }
    const pending = freeze({ stateKey: current.stateKey, input: normalized, result });
    pendingOwners.set(pending, current); return pending;
  });
}

export function appendAnimationStateTrialStep(current, pending) {
  return guarded(() => {
    branded(current);
    if (!pendingOwners.has(pending) || pendingOwners.get(pending) !== current) throw invalid();
    budget(current, pending.input);
    const nextStateKey = pending.result.selected?.stateKey ?? current.stateKey;
    const step = { index: current.steps.length, stateKey: current.stateKey, input: pending.input, result: pending.result, nextStateKey };
    return sequence({ model: current.model, initialStateKey: current.initialStateKey, stateKey: nextStateKey,
      steps: [...current.steps, step], sampleBytes: current.sampleBytes + sampleSize(pending.input) });
  });
}

export function truncateAnimationStateTrialSequence(current, stepCount) {
  return guarded(() => {
    branded(current);
    if (!Number.isSafeInteger(stepCount) || stepCount < 0 || stepCount > current.steps.length) throw invalid();
    const steps = current.steps.slice(0, stepCount), stateKey = steps.length ? steps.at(-1).nextStateKey : current.initialStateKey;
    // Always a fresh identity, even at the same length: pending steps from the
    // previous branch cannot be attached to this newly chosen history prefix.
    return sequence({ model: current.model, initialStateKey: current.initialStateKey, stateKey, steps,
      sampleBytes: steps.reduce((bytes, step) => bytes + sampleSize(step.input), 0) });
  });
}
