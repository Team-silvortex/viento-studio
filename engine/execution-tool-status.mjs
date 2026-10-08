// Portable status data only. Paths, process output and executable authority stay
// inside the host probe; this module neither discovers nor executes a tool.
export const EXECUTION_TOOL_STATUS_SCHEMA_VERSION = 1;
export const EXECUTION_TOOL_STATUSES = Object.freeze(['unchecked', 'checking', 'ready', 'unavailable']);
export const EXECUTION_TOOL_REASONS = Object.freeze(['tool_missing', 'platform_unsupported', 'tool_version',
  'tool_timeout', 'tool_output_limit', 'tool_failed', 'tool_cancelled', 'tool_changed']);

const namespace = /^[a-z][a-z0-9_-]*(?:\.[a-z][a-z0-9_-]*)+$/;
const token = /^[a-z][a-z0-9_-]{0,31}$/;
const fields = ['format', 'schemaVersion', 'backendId', 'status', 'reason', 'identity'];
const identityFields = ['version', 'sha256', 'platform', 'arch'];

function invalid() {
  return Object.assign(new TypeError('Invalid execution tool status.'), { errorCode: 'build_tool_status_invalid' });
}

// Descriptor inspection precedes value access, including for factory inputs.
// This deliberately small DTO has no arrays or extension bags to hide authority.
function detach(input) {
  let nodes = 0, chars = 0;
  function copy(value, depth) {
    if (++nodes > 32 || depth > 3) throw invalid();
    if (value === null) return null;
    if (typeof value === 'string') {
      chars += value.length;
      if (value.length > 256 || chars > 1024) throw invalid();
      return value;
    }
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid();
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw invalid();
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    if (keys.length > 8 || keys.some(key => typeof key !== 'string'
      || ['__proto__', 'constructor', 'prototype'].includes(key))) throw invalid();
    const result = {};
    for (const key of keys) {
      const descriptor = descriptors[key];
      if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value') || key.length > 32) throw invalid();
      result[key] = copy(descriptor.value, depth + 1);
    }
    return result;
  }
  try { return copy(input, 0); }
  catch { throw invalid(); }
}

function exact(value, keys) {
  if (!value || typeof value !== 'object' || Object.keys(value).length !== keys.length
    || keys.some(key => !Object.hasOwn(value, key))) throw invalid();
}

export function validateExecutionToolStatus(input) {
  const value = detach(input);
  exact(value, fields);
  if (value.format !== 'viento-execution-tool-status' || value.schemaVersion !== EXECUTION_TOOL_STATUS_SCHEMA_VERSION
    || typeof value.backendId !== 'string' || value.backendId.length > 128 || !namespace.test(value.backendId)
    || !EXECUTION_TOOL_STATUSES.includes(value.status)) throw invalid();
  if (value.status === 'ready') {
    if (value.reason !== null) throw invalid();
    exact(value.identity, identityFields);
    const identity = value.identity;
    if (typeof identity.version !== 'string' || !identity.version.length || identity.version.trim() !== identity.version
      || /[\u0000-\u001f\u007f/\\]/.test(identity.version)
      || typeof identity.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(identity.sha256)
      || typeof identity.platform !== 'string' || !token.test(identity.platform)
      || typeof identity.arch !== 'string' || !token.test(identity.arch)) throw invalid();
    Object.freeze(identity);
  } else {
    if (value.identity !== null || (value.status === 'unavailable'
      ? !EXECUTION_TOOL_REASONS.includes(value.reason) : value.reason !== null)) throw invalid();
  }
  return Object.freeze(value);
}

export function createExecutionToolStatus(input) {
  const value = detach(input);
  if (!value || typeof value !== 'object' || !Object.hasOwn(value, 'backendId') || !Object.hasOwn(value, 'status')
    || Object.keys(value).some(key => !['backendId', 'status', 'reason', 'identity'].includes(key))) throw invalid();
  return validateExecutionToolStatus({ format: 'viento-execution-tool-status', schemaVersion: EXECUTION_TOOL_STATUS_SCHEMA_VERSION,
    backendId: value.backendId, status: value.status, reason: Object.hasOwn(value, 'reason') ? value.reason : null,
    identity: Object.hasOwn(value, 'identity') ? value.identity : null });
}
