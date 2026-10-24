// Portable manual expectations, never recorded playback or runtime evidence.
import { ANIMATION_STATE_TRIAL_LIMITS, createAnimationStateTrialSequence, previewAnimationStateTrialStep,
  appendAnimationStateTrialStep, truncateAnimationStateTrialSequence } from './animation-state-trial-sequence.mjs';
import { PROJECT_SHARED_STATE_LIMITS, projectSharedStateKey, projectSharedStateScalar } from './project-shared-state.mjs';
import { parseJsonSource } from './json-source.mjs';

export const ANIMATION_STATE_TRIAL_CASE_LIMITS = Object.freeze({ ...ANIMATION_STATE_TRIAL_LIMITS, textBytes: 131072 });
const format = 'viento.animation-state-trial-case', cases = new WeakSet(), encoder = new TextEncoder();
const invalid = () => Object.assign(new TypeError('Expected a complete bounded manual animation trial case.'), { errorCode: 'animation_state_trial_case_invalid' });
const limit = () => Object.assign(new RangeError('The manual animation trial case exceeds its step, sample or text budget.'), { errorCode: 'animation_state_trial_case_limit' });
const stateMissing = () => Object.assign(new Error('The manual trial case initial state is absent from the current table.'), { errorCode: 'animation_state_trial_case_state_missing' });
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
// State identifiers follow the author table, not the broader project-state key grammar.
const stateKey = value => typeof value === 'string' && /^[a-z][a-z0-9_]{0,31}$/.test(value);
const byteSize = value => encoder.encode(JSON.stringify(value)).length;
function guarded(operation) {
  try { return operation(); } catch (error) {
    if (['animation_state_trial_case_limit', 'animation_state_trial_case_state_missing', 'studio_core_unavailable', 'studio_core_response_invalid'].includes(error?.errorCode)) throw error;
    throw invalid();
  }
}
function branded(value) { if (!cases.has(value)) throw invalid(); return value; }
function sample(input) {
  if (exact(input, ['kind']) && input.kind === 'completed') return { kind: 'completed' };
  if (!exact(input, ['kind', 'event', 'projectState']) || input.kind !== 'event' || !exact(input.event, ['name', 'value'])
    || !projectSharedStateKey(input.event.name) || !Array.isArray(input.projectState) || input.projectState.length > PROJECT_SHARED_STATE_LIMITS.keys) throw invalid();
  const event = { name: input.event.name, value: projectSharedStateScalar(input.event.value).value }, keys = new Set(); let bytes = 0;
  const projectState = input.projectState.map(entry => {
    if (!exact(entry, ['key', 'value']) || !projectSharedStateKey(entry.key) || keys.has(entry.key)) throw invalid();
    const scalar = projectSharedStateScalar(entry.value);
    keys.add(entry.key); bytes += entry.key.length + scalar.bytes;
    return { key: entry.key, value: scalar.value };
  });
  if (bytes > PROJECT_SHARED_STATE_LIMITS.bytes) throw invalid();
  return { kind: 'event', event, projectState };
}
// Only parsed JSON or an already-branded, frozen sequence reaches this helper;
// no caller record, accessor or serializer is traversed during admission.
function admit(input) {
  if (!exact(input, ['format', 'version', 'initialStateKey', 'steps']) || input.format !== format || input.version !== 1
    || !stateKey(input.initialStateKey) || !Array.isArray(input.steps) || !input.steps.length) throw invalid();
  if (input.steps.length > ANIMATION_STATE_TRIAL_CASE_LIMITS.steps) throw limit();
  let sampleBytes = 0, expectedState = input.initialStateKey;
  const steps = input.steps.map(step => {
    if (!exact(step, ['input', 'expected']) || !exact(step.expected, ['stateKey', 'transition']) || !stateKey(step.expected.stateKey)
      || typeof step.expected.transition !== 'boolean' || !step.expected.transition && step.expected.stateKey !== expectedState) throw invalid();
    const input = sample(step.input), expected = { stateKey: step.expected.stateKey, transition: step.expected.transition };
    sampleBytes += byteSize(input);
    if (sampleBytes > ANIMATION_STATE_TRIAL_CASE_LIMITS.sampleBytes) throw limit();
    expectedState = expected.stateKey;
    return { input, expected };
  });
  const result = freeze({ format, version: 1, initialStateKey: input.initialStateKey, steps });
  cases.add(result); return result;
}

export function createAnimationStateTrialCase(sequence) {
  return guarded(() => {
    // Reuse the sequence's own brand gate without changing its identity or
    // reading any untrusted properties before that gate has accepted it.
    truncateAnimationStateTrialSequence(sequence, 0);
    return admit({ format, version: 1, initialStateKey: sequence.initialStateKey, steps: sequence.steps.map(step => ({
      input: step.input, expected: { stateKey: step.nextStateKey, transition: step.result.selected !== null },
    })) });
  });
}

export function parseAnimationStateTrialCase(text) {
  return guarded(() => {
    if (typeof text !== 'string') throw invalid();
    if (text.length > ANIMATION_STATE_TRIAL_CASE_LIMITS.textBytes || encoder.encode(text).length > ANIMATION_STATE_TRIAL_CASE_LIMITS.textBytes) throw limit();
    const parsed = parseJsonSource(text);
    if (!parsed.ok || parsed.ambiguous) throw invalid();
    return admit(parsed.value);
  });
}

export function serializeAnimationStateTrialCase(value) {
  return guarded(() => {
    branded(value);
    const text = JSON.stringify(value) + '\n';
    if (encoder.encode(text).length > ANIMATION_STATE_TRIAL_CASE_LIMITS.textBytes) throw limit();
    return text;
  });
}

export function replayAnimationStateTrialCase(table, value) {
  return guarded(() => {
    branded(value);
    // Admit the entire current table before distinguishing a missing initial
    // state. Expected destinations are claims and need not exist in this table.
    let sequence = createAnimationStateTrialSequence(table);
    if (!sequence.model.states.some(state => state.key === value.initialStateKey)) throw stateMissing();
    if (sequence.stateKey !== value.initialStateKey) sequence = createAnimationStateTrialSequence(sequence.model.table, value.initialStateKey);
    let mismatchIndex = null;
    const steps = value.steps.map((step, index) => {
      if (mismatchIndex !== null) return { index, ...step, status: 'not-run', actual: null, result: null };
      const pending = previewAnimationStateTrialStep(sequence, step.input);
      sequence = appendAnimationStateTrialStep(sequence, pending);
      const actual = { stateKey: sequence.stateKey, transition: pending.result.selected !== null };
      const matched = actual.stateKey === step.expected.stateKey && actual.transition === step.expected.transition;
      if (!matched) mismatchIndex = index;
      return { index, ...step, status: matched ? 'passed' : 'failed', actual, result: pending.result };
    });
    return freeze({ case: value, status: mismatchIndex === null ? 'passed' : 'failed', initialStateKey: value.initialStateKey,
      stateKey: sequence.stateKey, mismatchIndex, steps });
  });
}
