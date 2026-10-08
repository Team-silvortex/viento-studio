// Import-free data contract shared by the GUI and the complete author suite module.
// Parsing author text and resolving dependencies stay outside this closure.
export const RUNTIME_CASE_SUITE_FORMAT = 'viento-runtime-case-suite';
export const RUNTIME_CASE_SUITE_FILE_MAX_BYTES = 16 * 1024;
export const RUNTIME_CASE_SUITE_DOCUMENT_MAX_COUNT = 16;
export const RUNTIME_CASE_SUITE_ACTOR_STEP_LIMIT = 4096;
export const RUNTIME_CASE_SUITE_CHECK_LIMIT = 1024;
const has = (value, key) => Object.hasOwn(value, key);
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const error = (code = 'runtime_suite_invalid') => Object.assign(new TypeError('Invalid finite runtime case suite.'), { errorCode: code });

function fields(value, array = false) {
  if (!value || typeof value !== 'object' || Array.isArray(value) !== array) throw error();
  const prototype = Object.getPrototypeOf(value);
  if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) throw error();
  const result = Object.getOwnPropertyDescriptors(value);
  for (const key of Reflect.ownKeys(result)) {
    if (typeof key !== 'string' || ['__proto__', 'constructor', 'prototype'].includes(key)
      || !has(result[key], 'value') || !(array && key === 'length') && !result[key].enumerable) throw error();
  }
  return result;
}

function dense(value, maximum, minimum = 0) {
  const result = fields(value, true), length = result.length.value;
  if (!Number.isSafeInteger(length) || length < minimum) throw error();
  if (length > maximum) throw error('runtime_suite_limit');
  if (Reflect.ownKeys(result).length !== length + 1) throw error();
  for (let index = 0; index < length; index++) if (!has(result, String(index))) throw error();
  return result;
}

export function validateRuntimeCaseSuite(input) {
  const values = fields(input), keys = ['format', 'schemaVersion', 'sceneObjectId', 'documentIds'];
  if (Reflect.ownKeys(values).length !== keys.length || !keys.every(key => has(values, key))
    || values.format.value !== RUNTIME_CASE_SUITE_FORMAT || values.schemaVersion.value !== 1
    || !uuid(values.sceneObjectId.value)) throw error();
  const entries = dense(values.documentIds.value, RUNTIME_CASE_SUITE_DOCUMENT_MAX_COUNT, 1), seen = new Set(), documentIds = [];
  for (let index = 0; index < entries.length.value; index++) {
    const id = entries[index].value;
    if (!uuid(id) || id === values.sceneObjectId.value || seen.has(id)) throw error();
    seen.add(id); documentIds.push(id);
  }
  return Object.freeze({ format: RUNTIME_CASE_SUITE_FORMAT, schemaVersion: 1,
    sceneObjectId: values.sceneObjectId.value, documentIds: Object.freeze(documentIds) });
}

export function summarizeRuntimeCaseSuite(input) {
  const values = dense(input, RUNTIME_CASE_SUITE_DOCUMENT_MAX_COUNT, 1);
  const counts = { queued: 0, running: 0, passed: 0, failed: 0, incomplete: 0, notRun: 0 };
  for (let index = 0; index < values.length.value; index++) {
    const state = values[index].value;
    if (!['queued', 'running', 'passed', 'failed', 'incomplete', 'not-run'].includes(state)) throw error();
    counts[state === 'not-run' ? 'notRun' : state]++;
  }
  const status = counts.queued || counts.running ? 'running'
    : counts.incomplete || counts.notRun ? 'incomplete' : counts.failed ? 'failed' : 'passed';
  return Object.freeze({ status, complete: status === 'passed' || status === 'failed', total: values.length.value,
    completed: counts.passed + counts.failed + counts.incomplete, ...counts });
}

// Internal shared guards: the author module reuses these without a second rule set.
export { fields as _suiteFields, dense as _suiteDense, error as _suiteError, uuid as _suiteUuid };
