// State-to-clip configuration for one behavior form. This model never writes
// source, executes controllers, or grants ordinary draft/Save authority.
import { hasAnimationStateScriptMarker, readAnimationStateScriptSource } from './animation-state-script-source.mjs';
import { isSceneBehaviorAnimationClips } from './scene-animation-directory.mjs';

const format = 'viento-animation-state-bindings';
const invalid = () => { throw Object.assign(new TypeError('Expected bounded animation state bindings and a saved animation catalog.'), { errorCode: 'animation_state_bindings_invalid' }); };
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
const stateKey = value => typeof value === 'string' && /^[a-z][a-z0-9_]{0,31}$/.exec(value)?.[0] === value;
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.exec(value)?.[0] === value;
const text = value => typeof value === 'string' && value.length <= 4096
  && [...value].every(character => { const code = character.codePointAt(0); return code < 0xd800 || code > 0xdfff; });
function record(value, required, optional = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) invalid();
  const descriptors = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(descriptors);
  if (keys.length < required.length || keys.length > required.length + optional.length
    || keys.some(key => typeof key !== 'string' || ![...required, ...optional].includes(key))
    || required.some(key => !Object.hasOwn(descriptors, key))) invalid();
  const result = {};
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) invalid();
    result[key] = descriptor.value;
  }
  return result;
}
function array(value, maximum, minimum = 0) {
  if (!Array.isArray(value) || ![Array.prototype, null].includes(Object.getPrototypeOf(value))) invalid();
  const descriptors = Object.getOwnPropertyDescriptors(value), length = descriptors.length?.value;
  if (!Number.isSafeInteger(length) || length < minimum || length > maximum || Reflect.ownKeys(descriptors).length !== length + 1) invalid();
  return Array.from({ length }, (_, index) => {
    const descriptor = descriptors[index];
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) invalid();
    return descriptor.value;
  });
}
export function captureAnimationStateBindings(input) {
  const value = record(input, ['format', 'schemaVersion', 'initialState', 'states']);
  if (value.format !== format || value.schemaVersion !== 1 || !stateKey(value.initialState)) invalid();
  const keys = new Set();
  value.states = array(value.states, 16, 1).map(inputState => {
    const state = record(inputState, ['stateKey', 'parameterName', 'hasCompletion']);
    if (!stateKey(state.stateKey) || keys.has(state.stateKey) || state.parameterName !== `clip_${state.stateKey}` || typeof state.hasCompletion !== 'boolean') invalid();
    keys.add(state.stateKey); return state;
  });
  if (!keys.has(value.initialState)) invalid();
  return freeze(value);
}
export function discoverAnimationStateBindings(content) {
  if (!hasAnimationStateScriptMarker(content)) return null;
  let declaration;
  try { declaration = readAnimationStateScriptSource(content); }
  catch (error) {
    if (/^animation_state_script_source_(?:invalid|modified|unsupported|limit)$/.test(error?.errorCode || error?.code || '')
      || error?.errorCode === 'animation_state_table_invalid' || error?.errorCode === 'studio_core_unavailable') return null;
    throw error;
  }
  const completed = new Set(declaration.table.transitions.filter(edge => edge.trigger.kind === 'completed').map(edge => edge.from));
  return captureAnimationStateBindings({ format, schemaVersion: 1, initialState: declaration.table.initialState,
    states: declaration.table.states.map(state => ({ stateKey: state.key, parameterName: `clip_${state.key}`, hasCompletion: completed.has(state.key) })) });
}

export function reviewAnimationStateBindings(input) {
  const value = record(input, ['declaration', 'catalog', 'parameters'], ['selections']);
  const declaration = captureAnimationStateBindings(value.declaration);
  // Brand validation happens before any catalog fields are read. The caller
  // separately checks the catalog's source and the current behavior session.
  if (!isSceneBehaviorAnimationClips(value.catalog)) invalid();
  const catalog = value.catalog, parameters = array(value.parameters, 32).map(inputParameter => {
    const parameter = record(inputParameter, ['name', 'type', 'value']);
    if (!text(parameter.name) || !['string', 'number', 'boolean'].includes(parameter.type) || !text(parameter.value)) invalid();
    return parameter;
  });
  const selections = new Map();
  if (Object.hasOwn(value, 'selections')) {
    const rows = array(value.selections, 16, 1), keys = new Set(declaration.states.map(state => state.stateKey));
    if (rows.length !== declaration.states.length) invalid();
    for (const inputSelection of rows) {
      const selection = record(inputSelection, ['stateKey', 'clipId']);
      if (!keys.has(selection.stateKey) || selections.has(selection.stateKey) || !text(selection.clipId)) invalid();
      selections.set(selection.stateKey, selection.clipId);
    }
  }
  const issues = [], issue = (code, state = null, severity = 'error') => ({ code, severity, stateKey: state?.stateKey ?? null, parameterName: state?.parameterName ?? null });
  if (catalog.status !== 'ready') issues.push(issue('animation-missing'));
  const states = declaration.states.map(state => {
    const rows = parameters.filter(parameter => parameter.name === state.parameterName), problems = [];
    if (rows.length > 1) problems.push(issue('duplicate-parameter', state));
    if (rows.some(parameter => parameter.type !== 'string')) problems.push(issue('type-mismatch', state));
    const clipId = selections.has(state.stateKey) ? selections.get(state.stateKey) : rows[0]?.value ?? '';
    const clip = catalog.clips.find(candidate => candidate.clipId === clipId);
    if (clipId !== '') {
      if (!uuid(clipId)) problems.push(issue('invalid-clip', state));
      else if (!clip) problems.push(issue('clip-missing', state));
    }
    // The existing catalog exposes loop for named clips only. An empty value
    // means the full animation; its looping behavior must be checked in that
    // document rather than inferred or invented here.
    if (state.hasCompletion && clip?.loop) problems.push(issue('completion-loop', state, 'warning'));
    issues.push(...problems); return { ...state, clipId, issues: problems };
  });
  const missing = states.filter(state => !parameters.some(parameter => parameter.name === state.parameterName));
  if (parameters.length + missing.length > 32) issues.push(issue('parameter-limit'));
  const canApply = !issues.some(item => item.severity === 'error'), selected = new Map(states.map(state => [state.parameterName, state.clipId]));
  const merged = canApply ? [...parameters.map(parameter => selected.has(parameter.name) ? { ...parameter, value: selected.get(parameter.name) } : parameter),
    ...missing.map(state => ({ name: state.parameterName, type: 'string', value: state.clipId }))] : null;
  return freeze({ states, issues, canApply, parameters: merged });
}
