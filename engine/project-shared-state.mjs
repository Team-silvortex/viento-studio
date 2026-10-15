import { canonicalJson } from './canonical-json.mjs';
import { PROJECT_RUNTIME_MAX_VISITS, projectRuntimeUuid as uuid, projectRuntimeExact as exact, copyProjectRuntimeData as copy,
  invalidProjectRuntime as invalid } from './project-runtime-contracts.mjs';

// Session data has no author document, storage or process dependency. Limits
// count UTF-8 payload bytes, not JSON escaping or implementation overhead.
export const PROJECT_SHARED_STATE_LIMITS = Object.freeze({ keys: 64, mutations: 1024, bytes: 16384, stringBytes: 4096, numberMagnitude: 1e9 });
const encoder = new TextEncoder();
const keyValid = key => typeof key === 'string' && /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(key)
  && !['constructor', 'prototype', '__proto__'].includes(key);
const revisionValid = revision => Number.isInteger(revision) && revision >= 1 && revision <= PROJECT_SHARED_STATE_LIMITS.mutations;
const pointerValid = value => typeof value === 'string' && value.length <= 4096 && (value === '' || value.startsWith('/')) && !/~(?:[^01]|$)/.test(value);
const pathValid = value => typeof value === 'string' && value.length > 0 && value.length <= 4096
  && !/[\\\0]/.test(value) && !value.startsWith('/') && !/^[A-Za-z]:/.test(value)
  && value.split('/').every(part => part && part !== '.' && part !== '..') && !value.startsWith('.');

function scalar(value) {
  if (typeof value === 'boolean') return { value, bytes: 1 };
  if (typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= PROJECT_SHARED_STATE_LIMITS.numberMagnitude) {
    return { value: value === 0 ? 0 : value, bytes: 8 };
  }
  if (typeof value !== 'string') throw invalid();
  // TextEncoder replaces lone surrogates. Reject them first so every backend
  // admits exactly the same text instead of silently repairing author values.
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const low = value.charCodeAt(++index);
      if (!(low >= 0xdc00 && low <= 0xdfff)) throw invalid();
    } else if (code >= 0xdc00 && code <= 0xdfff) throw invalid();
  }
  const bytes = encoder.encode(value).length;
  if (bytes > PROJECT_SHARED_STATE_LIMITS.stringBytes) throw invalid();
  return { value, bytes };
}

function sourceValid(source) {
  if (!exact(source, ['objectId', 'sourcePath', 'sourceRevision', 'propertyPath', ...(Object.hasOwn(source || {}, 'sourceRange') ? ['sourceRange'] : [])])
    || !uuid(source.objectId) || !pathValid(source.sourcePath) || !/^sha256:[a-f0-9]{64}$/.test(source.sourceRevision)
    || !pointerValid(source.propertyPath)) return false;
  if (Object.hasOwn(source, 'sourceRange')) {
    const range = source.sourceRange;
    if (!exact(range, ['start', 'end', 'encoding', ...(Object.hasOwn(range || {}, 'propertyPath') ? ['propertyPath'] : []), ...(Object.hasOwn(range || {}, 'exact') ? ['exact'] : [])])
      || !Number.isSafeInteger(range.start) || range.start < 0 || !Number.isSafeInteger(range.end) || range.end <= range.start
      || range.encoding !== 'utf-16' || Object.hasOwn(range, 'propertyPath') && !pointerValid(range.propertyPath)
      || Object.hasOwn(range, 'exact') && typeof range.exact !== 'boolean') return false;
  }
  return true;
}

function originValid(origin) {
  return exact(origin, ['visitIndex', 'sceneId', 'bindingId', 'instanceId', 'objectId', 'source'])
    && Number.isInteger(origin.visitIndex) && origin.visitIndex >= 1 && origin.visitIndex <= PROJECT_RUNTIME_MAX_VISITS
    && ['sceneId', 'bindingId', 'instanceId', 'objectId'].every(key => uuid(origin[key])) && sourceValid(origin.source);
}

function budget(entries) {
  if (entries.length > PROJECT_SHARED_STATE_LIMITS.keys) throw invalid();
  let bytes = 0;
  for (const entry of entries) {
    if (!keyValid(entry.key)) throw invalid();
    const checked = scalar(entry.value); entry.value = checked.value;
    bytes += entry.key.length + checked.bytes;
  }
  if (bytes > PROJECT_SHARED_STATE_LIMITS.bytes) throw invalid();
}

export function validateProjectSharedStateSnapshot(input) {
  const state = copy(input);
  if (!exact(state, ['revision', 'entries', 'lastChange']) || !Number.isInteger(state.revision)
    || state.revision < 0 || state.revision > PROJECT_SHARED_STATE_LIMITS.mutations || !Array.isArray(state.entries)) throw invalid();
  const revisions = new Set();
  for (const [index, entry] of state.entries.entries()) {
    if (!exact(entry, ['key', 'value', 'revision', 'origin']) || !revisionValid(entry.revision) || entry.revision > state.revision
      || revisions.has(entry.revision) || !originValid(entry.origin) || index > 0 && state.entries[index - 1].key >= entry.key) throw invalid();
    revisions.add(entry.revision);
  }
  budget(state.entries);
  if (state.revision === 0) {
    if (state.entries.length || state.lastChange !== null) throw invalid();
  } else {
    const change = state.lastChange;
    if (!exact(change, ['operation', 'key', 'revision', 'origin']) || !['set', 'delete'].includes(change.operation)
      || !keyValid(change.key) || change.revision !== state.revision || !originValid(change.origin)) throw invalid();
    const entry = state.entries.find(candidate => candidate.key === change.key);
    if (change.operation === 'delete' ? entry !== undefined || revisions.has(change.revision)
      : !entry || entry.revision !== change.revision || canonicalJson(entry.origin) !== canonicalJson(change.origin)) throw invalid();
    const ordered = [...state.entries, change].sort((first, second) => first.revision - second.revision);
    if (ordered.some((entry, index) => index > 0 && entry.origin.visitIndex < ordered[index - 1].origin.visitIndex)) throw invalid();
  }
  return state;
}

// This admits successful wire mutations, not author requests: emitting a no-op
// or a missing delete is a protocol error. All candidate checks precede commit.
export function createProjectSharedState() {
  let state = { revision: 0, entries: [], lastChange: null };
  return Object.freeze({
    get revision() { return state.revision; },
    apply(input) {
      const change = copy(input), setting = change?.operation === 'set';
      if (!exact(change, ['operation', 'key', 'revision', 'origin', ...(setting ? ['value'] : [])])
        || !['set', 'delete'].includes(change.operation) || !keyValid(change.key) || !originValid(change.origin)
        || !revisionValid(change.revision) || change.revision !== state.revision + 1
        || state.lastChange && change.origin.visitIndex < state.lastChange.origin.visitIndex) throw invalid();
      const previous = state.entries.find(entry => entry.key === change.key);
      const value = setting ? scalar(change.value).value : undefined;
      if (setting ? previous && typeof previous.value === typeof value && previous.value === value : !previous) throw invalid();
      const entries = state.entries.filter(entry => entry.key !== change.key);
      if (setting) entries.push({ key: change.key, value, revision: change.revision, origin: change.origin });
      entries.sort((first, second) => first.key < second.key ? -1 : first.key > second.key ? 1 : 0);
      const lastChange = { operation: change.operation, key: change.key, revision: change.revision, origin: change.origin };
      state = validateProjectSharedStateSnapshot({ revision: change.revision, entries, lastChange });
    },
    snapshot() { return copy(state); },
  });
}

// Project messages deliberately share the exact state key, scalar and frozen
// binding-source vocabulary; these helpers never invoke caller accessors.
export const projectSharedStateKey = keyValid;
export const projectSharedStateScalar = scalar;
export function copyProjectStateOrigin(input) {
  const origin = copy(input);
  if (!originValid(origin)) throw invalid();
  return origin;
}
