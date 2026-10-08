// A finite verification case describes expectations over admitted samples.
// It does not simulate motion, start a process or manufacture runtime lifecycle.
import { validateSceneControlProgram, validateSceneControlPlan, SCENE_CONTROL_TRACE_FORMAT } from './scene-control-program.mjs';

export const RUNTIME_CASE_FORMAT = 'viento-runtime-case';
export const RUNTIME_CASE_EVALUATION_FORMAT = 'viento-runtime-case-evaluation';
export const RUNTIME_CASE_FILE_MAX_BYTES = 256 * 1024;
export const RUNTIME_CASE_CHECK_LIMIT = 128;

const has = (value, key) => Object.hasOwn(value, key);
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const position = value => Array.isArray(value) && value.length === 2 && value.every(Number.isFinite);
const state = value => value === 'idle' || value === 'moving';
const error = (code = 'runtime_case_invalid') => Object.assign(new TypeError('Invalid finite runtime verification case or sample data.'), { errorCode: code });
const exact = (value, keys) => plain(value) && Object.keys(value).length === keys.length && keys.every(key => has(value, key));

function descriptors(value, array, code) {
  if (!value || typeof value !== 'object' || Array.isArray(value) !== array) throw error(code);
  const prototype = Object.getPrototypeOf(value);
  if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) throw error(code);
  const fields = Object.getOwnPropertyDescriptors(value), names = Reflect.ownKeys(fields);
  if (names.some(key => typeof key !== 'string' || ['__proto__', 'constructor', 'prototype'].includes(key))) throw error(code);
  for (const key of names) {
    if (!has(fields[key], 'value') || !(array && key === 'length') && !fields[key].enumerable) throw error(code);
  }
  return fields;
}

function detach(input, code = 'runtime_case_invalid') {
  const active = new Set();
  let nodes = 0, characters = 0;
  function copy(value, depth) {
    if (++nodes > 32768 || depth > 12) throw error(code);
    if (value === null || typeof value === 'boolean') return value;
    if (typeof value === 'number') { if (!Number.isFinite(value)) throw error(code); return value; }
    if (typeof value === 'string') {
      characters += value.length;
      if (value.length > 4096 || characters > 256 * 1024) throw error(code);
      return value;
    }
    if (!value || typeof value !== 'object' || active.has(value)) throw error(code);
    const array = Array.isArray(value), fields = descriptors(value, array, code), names = Reflect.ownKeys(fields);
    active.add(value);
    let result;
    if (array) {
      const length = fields.length?.value;
      if (!Number.isSafeInteger(length) || length < 0 || length > 1024 || names.length !== length + 1) throw error(code);
      result = [];
      for (let index = 0; index < length; index++) {
        if (!has(fields, String(index))) throw error(code);
        result.push(copy(fields[index].value, depth + 1));
      }
    } else {
      if (names.length > 32) throw error(code);
      result = {};
      for (const key of names) {
        characters += key.length;
        if (key.length > 128 || characters > 256 * 1024) throw error(code);
        result[key] = copy(fields[key].value, depth + 1);
      }
    }
    active.delete(value);
    return result;
  }
  try { return copy(input, 0); }
  catch (caught) { if (caught?.errorCode === code) throw caught; throw error(code); }
}

function freeze(value) {
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) freeze(item);
    Object.freeze(value);
  }
  return value;
}

function controlError(caught) {
  return error({ runtime_control_limit: 'runtime_case_limit', runtime_control_unsupported: 'runtime_case_unsupported',
    runtime_control_target_missing: 'runtime_case_target_missing' }[caught?.errorCode] || 'runtime_case_invalid');
}

export function validateRuntimeCase(input) {
  const fields = descriptors(input, false, 'runtime_case_invalid');
  if (Reflect.ownKeys(fields).length !== 4 || !['format', 'schemaVersion', 'program', 'checks'].every(key => has(fields, key))
    || fields.format.value !== RUNTIME_CASE_FORMAT || fields.schemaVersion.value !== 1) throw error();
  let program;
  // Validate the program before copying the case tree so its existing
  // descriptor-only input-budget precheck keeps the actionable limit code.
  try { program = validateSceneControlProgram(fields.program.value); }
  catch (caught) { throw controlError(caught); }
  const checkFields = descriptors(fields.checks.value, true, 'runtime_case_invalid');
  const checkCount = checkFields.length.value;
  if (!Number.isSafeInteger(checkCount) || checkCount < 1 || Reflect.ownKeys(checkFields).length !== checkCount + 1) throw error();
  if (checkCount > RUNTIME_CASE_CHECK_LIMIT) throw error('runtime_case_limit');
  const value = detach({ format: fields.format.value, schemaVersion: fields.schemaVersion.value, program, checks: fields.checks.value });
  const seen = new Set();
  for (const check of value.checks) {
    if (!plain(check) || Object.keys(check).some(key => !['instanceId', 'stepIndex', 'position', 'state'].includes(key))
      || !uuid(check.instanceId) || !Number.isSafeInteger(check.stepIndex) || check.stepIndex < 0
      || check.stepIndex >= value.program.steps.length || !has(check, 'position') && !has(check, 'state')) throw error();
    const key = `${check.instanceId}:${check.stepIndex}`;
    if (seen.has(key)) throw error();
    seen.add(key);
    if (has(check, 'position') && (!exact(check.position, ['value', 'tolerance']) || !position(check.position.value)
      || !Number.isFinite(check.position.tolerance) || check.position.tolerance < 0)) throw error();
    if (has(check, 'state') && !state(check.state)) throw error();
  }
  return freeze(value);
}

// The existing control admission supplies frozen plan/actor budget checks.
// Only actor identity is selected here; source text and engine handles are not
// copied into a case or an evaluation.
function admitPlan(inputPlan, value) {
  const planFields = descriptors(inputPlan, false, 'runtime_case_invalid');
  if (planFields.format?.value !== 'viento-build-plan' || planFields.kind?.value !== 'scene2d') throw error();
  if (planFields.schemaVersion?.value !== 2) throw error('runtime_case_unsupported');
  try { validateSceneControlPlan(inputPlan, value.program); }
  catch (caught) { throw controlError(caught); }
  const actorFields = descriptors(planFields.actors.value, true, 'runtime_case_invalid');
  const actors = new Map();
  for (let index = 0; index < actorFields.length.value; index++) {
    const fields = descriptors(actorFields[index].value, false, 'runtime_case_invalid');
    actors.set(fields.instanceId.value, fields.objectId.value);
  }
  if (value.checks.some(check => !actors.has(check.instanceId))) throw error('runtime_case_target_missing');
  return actors;
}

export function validateRuntimeCasePlan(plan, input) {
  const value = validateRuntimeCase(input);
  admitPlan(plan, value);
  return value;
}

function admitSamples(input, actors, stepCount) {
  const code = 'runtime_case_sample_invalid', samples = detach(input, code);
  if (!Array.isArray(samples) || samples.length > stepCount) throw error(code);
  const indexed = [];
  for (let index = 0; index < samples.length; index++) {
    const sample = samples[index];
    if (!exact(sample, ['format', 'schemaVersion', 'protocolVersion', 'event', 'stepIndex', 'actors'])
      || sample.format !== SCENE_CONTROL_TRACE_FORMAT || sample.schemaVersion !== 1 || sample.protocolVersion !== 2
      || sample.event !== 'sample' || !Number.isSafeInteger(sample.stepIndex) || sample.stepIndex !== index
      || !Array.isArray(sample.actors) || sample.actors.length !== actors.size) throw error(code);
    const values = new Map();
    for (const actor of sample.actors) {
      if (!exact(actor, ['instanceId', 'objectId', 'position', 'state']) || !actors.has(actor.instanceId)
        || actors.get(actor.instanceId) !== actor.objectId || values.has(actor.instanceId)
        || !position(actor.position) || !state(actor.state)) throw error(code);
      values.set(actor.instanceId, actor);
    }
    indexed.push(values);
  }
  return indexed;
}

export function evaluateRuntimeCase(plan, input, samples, options = {}) {
  const value = validateRuntimeCase(input), actors = admitPlan(plan, value), settings = detach(options);
  if (!plain(settings) || Object.keys(settings).some(key => key !== 'complete')
    || has(settings, 'complete') && typeof settings.complete !== 'boolean') throw error();
  const indexed = admitSamples(samples, actors, value.program.steps.length);
  const complete = settings.complete === true && indexed.length === value.program.steps.length;
  const checks = value.checks.map((check, checkIndex) => {
    const sample = indexed[check.stepIndex]?.get(check.instanceId);
    const positionPassed = !sample || !has(check, 'position') ? null
      : sample.position.every((coordinate, axis) => Math.abs(coordinate - check.position.value[axis]) <= check.position.tolerance);
    const statePassed = !sample || !has(check, 'state') ? null : sample.state === check.state;
    return { checkIndex, instanceId: check.instanceId, stepIndex: check.stepIndex,
      status: !sample ? 'unavailable' : positionPassed === false || statePassed === false ? 'failed' : 'passed',
      expected: { position: has(check, 'position') ? check.position : null, state: has(check, 'state') ? check.state : null },
      actual: sample ? { position: sample.position.slice(), state: sample.state } : null,
      positionPassed, statePassed };
  });
  const passedChecks = checks.filter(check => check.status === 'passed').length;
  const failedChecks = checks.filter(check => check.status === 'failed').length;
  const unavailableChecks = checks.filter(check => check.status === 'unavailable').length;
  return freeze({ format: RUNTIME_CASE_EVALUATION_FORMAT, schemaVersion: 1,
    status: !complete ? 'incomplete' : failedChecks ? 'failed' : 'passed', complete,
    stepCount: value.program.steps.length, sampleCount: indexed.length, checkCount: checks.length,
    passedChecks, failedChecks, unavailableChecks, checks });
}
