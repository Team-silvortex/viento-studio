// Portable, output-only detail for one terminal suite member. Recorded IDs and
// author revisions are provenance supplied by the host, not proof that arbitrary
// external data came from an engine or hashes back to original author bytes.
// No author parser, runtime lifecycle replay, filesystem or engine is imported.
import { validateRuntimeCasePlan, evaluateRuntimeCase } from './runtime-verification-case.mjs';
import { canonicalJson } from './canonical-json.mjs';

export const RUNTIME_CASE_REPORT_FORMAT = 'viento-runtime-case-report';
export const RUNTIME_CASE_REPORT_FILE_MAX_BYTES = 2 * 1024 * 1024;

const has = (value, key) => Object.hasOwn(value, key);
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const revision = value => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
const backend = value => typeof value === 'string' && value.length <= 128
  && /^[a-z][a-z0-9_-]*(?:\.[a-z][a-z0-9_-]*)+$/.test(value);
const invalid = (code = 'runtime_case_report_invalid') => Object.assign(
  new TypeError('Invalid finite runtime case report.'), { errorCode: code });

// Well-formed Unicode is required before JSON.stringify could silently escape
// an unpaired surrogate. This counts actual compact export bytes without Node
// Buffer or a browser TextEncoder dependency. The export includes one newline.
function utf8Length(value) {
  let bytes = 0;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code < 0x80) bytes++;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(++index);
      if (!(next >= 0xdc00 && next <= 0xdfff)) throw invalid();
      bytes += 4;
    } else if (code >= 0xdc00 && code <= 0xdfff) throw invalid();
    else bytes += 3;
  }
  return bytes;
}

function detach(input) {
  const active = new Set();
  let nodes = 0, characters = 0;
  function copy(value, depth) {
    if (++nodes > 65536 || depth > 14) throw invalid('runtime_case_report_limit');
    if (value === null || typeof value === 'boolean') return value;
    if (typeof value === 'number') { if (!Number.isFinite(value)) throw invalid(); return value; }
    if (typeof value === 'string') {
      if (value.length > 4096 || (characters += value.length) > RUNTIME_CASE_REPORT_FILE_MAX_BYTES) {
        throw invalid('runtime_case_report_limit');
      }
      utf8Length(value);
      return value;
    }
    if (!value || typeof value !== 'object' || active.has(value)) throw invalid();
    const array = Array.isArray(value), prototype = Object.getPrototypeOf(value);
    if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) throw invalid();
    const descriptors = Object.getOwnPropertyDescriptors(value), names = Reflect.ownKeys(descriptors);
    if (names.some(key => typeof key !== 'string' || ['__proto__', 'constructor', 'prototype'].includes(key))) throw invalid();
    for (const key of names) {
      if (!has(descriptors[key], 'value') || !(array && key === 'length') && !descriptors[key].enumerable) throw invalid();
    }
    active.add(value);
    let output;
    if (array) {
      const length = descriptors.length?.value;
      if (!Number.isSafeInteger(length) || length < 0 || names.length !== length + 1) throw invalid();
      if (length > 1024) throw invalid('runtime_case_report_limit');
      output = [];
      for (let index = 0; index < length; index++) {
        if (!has(descriptors, String(index))) throw invalid();
        output.push(copy(descriptors[index].value, depth + 1));
      }
    } else {
      if (names.length > 32) throw invalid('runtime_case_report_limit');
      output = {};
      for (const key of names) {
        if (key.length > 128 || (characters += key.length) > RUNTIME_CASE_REPORT_FILE_MAX_BYTES) {
          throw invalid('runtime_case_report_limit');
        }
        utf8Length(key);
        output[key] = copy(descriptors[key].value, depth + 1);
      }
    }
    active.delete(value);
    return output;
  }
  try { return copy(input, 0); }
  catch (caught) {
    if (['runtime_case_report_invalid', 'runtime_case_report_limit'].includes(caught?.errorCode)) throw caught;
    throw invalid();
  }
}

function exact(value, fields) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).length !== fields.length || fields.some(field => !has(value, field))) throw invalid();
}

function freeze(value) {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

function admit(input, persisted) {
  const value = detach(input);
  exact(value, persisted
    ? ['format', 'schemaVersion', 'context', 'executionStatus', 'targets', 'definition', 'samples', 'evaluation']
    : ['context', 'executionStatus', 'targets', 'definition', 'samples']);
  if (persisted && (value.format !== RUNTIME_CASE_REPORT_FORMAT || value.schemaVersion !== 1)) throw invalid();
  const context = value.context;
  exact(context, ['sceneSourcePath', 'sceneObjectId', 'buildId', 'snapshotId', 'backendId',
    'suiteDocumentId', 'suiteSourceVersion', 'documentId', 'sourceVersion', 'sessionId']);
  if (!['sceneObjectId', 'buildId', 'suiteDocumentId', 'documentId'].every(key => uuid(context[key]))
    || !['snapshotId', 'suiteSourceVersion', 'sourceVersion'].every(key => revision(context[key]))
    || !backend(context.backendId) || typeof context.sceneSourcePath !== 'string'
    || !['succeeded', 'failed', 'cancelled', 'timeout'].includes(value.executionStatus)
    || !(uuid(context.sessionId) || context.sessionId === null && value.executionStatus !== 'succeeded')) throw invalid();
  if (!Array.isArray(value.targets) || value.targets.length < 1) throw invalid();
  if (value.targets.length > 128) throw invalid('runtime_case_report_limit');
  const seen = new Set();
  for (const target of value.targets) {
    exact(target, ['instanceId', 'objectId']);
    if (!uuid(target.instanceId) || !uuid(target.objectId) || seen.has(target.instanceId)) throw invalid();
    seen.add(target.instanceId);
  }
  if (Array.isArray(value.samples) && value.samples.length > 64) throw invalid('runtime_case_report_limit');
  const plan = { format: 'viento-build-plan', schemaVersion: 2, kind: 'scene2d',
    scene: { objectId: context.sceneObjectId, sourcePath: context.sceneSourcePath }, actors: value.targets };
  let definition, evaluation;
  try {
    definition = validateRuntimeCasePlan(plan, value.definition);
    evaluation = evaluateRuntimeCase(plan, definition, value.samples, { complete: value.executionStatus === 'succeeded' });
  } catch (caught) {
    throw invalid(caught?.errorCode === 'runtime_case_limit' ? 'runtime_case_report_limit' : 'runtime_case_report_invalid');
  }
  // An externally stored evaluation is checked in full, including all expected,
  // actual, per-field pass flags and summary counts. It is never trusted as-is.
  if (persisted && canonicalJson(value.evaluation) !== canonicalJson(evaluation)) throw invalid();
  const report = { format: RUNTIME_CASE_REPORT_FORMAT, schemaVersion: 1, context,
    executionStatus: value.executionStatus, targets: value.targets, definition, samples: value.samples, evaluation };
  if (utf8Length(JSON.stringify(report)) + 1 > RUNTIME_CASE_REPORT_FILE_MAX_BYTES) throw invalid('runtime_case_report_limit');
  return freeze(report);
}

export function createRuntimeCaseReport(input) { return admit(input, false); }
export function validateRuntimeCaseReport(input) { return admit(input, true); }
