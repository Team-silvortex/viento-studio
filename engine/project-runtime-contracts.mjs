// Portable project runtime boundaries. No node paths, process handles or author
// edits cross this contract; each visit owns a fresh existing scene reader.
export const PROJECT_RUNTIME_PROTOCOL = 1;
export const PROJECT_RUNTIME_PREFIX = 'VIENTO_PROJECT:';
export const PROJECT_RUNTIME_MAX_VISITS = 64;
export const PROJECT_RUNTIME_MAX_EVENTS = 4096;
export const PROJECT_RUNTIME_MAX_LINE = 131072;
export const projectRuntimeUuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
export const projectRuntimeExact = (value, keys) => value !== null && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
export const projectRuntimeTime = value => Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER;
export const projectRuntimeSameTime = (first, second) => Math.abs(first - second) <= 1e-6;
export const invalidProjectRuntime = () => Object.assign(new TypeError('Invalid project runtime data.'), { errorCode: 'runtime_project_invalid' });

// Descriptor traversal rejects executable accessors, sparse arrays, cycles and
// serialization hooks before callers serialize an event or query a snapshot.
function copyBoundedRuntimeData(input, maxCharacters) {
  let nodes = 0, chars = 0;
  const active = new Set();
  function copy(value, depth = 0) {
    if (++nodes > 262144 || depth > 32) throw invalidProjectRuntime();
    if (value === null || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
      if (value.length > 131072 || (chars += value.length) > maxCharacters) throw invalidProjectRuntime();
      return value;
    }
    if (!value || typeof value !== 'object' || active.has(value)) throw invalidProjectRuntime();
    const array = Array.isArray(value), prototype = Object.getPrototypeOf(value);
    if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) throw invalidProjectRuntime();
    const properties = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(properties);
    if (array && (!Number.isSafeInteger(properties.length?.value) || properties.length.value > 8192 || keys.length !== properties.length.value + 1)
      || !array && keys.length > 128) throw invalidProjectRuntime();
    const result = array ? [] : {};
    active.add(value);
    for (const key of array ? Array.from({ length: properties.length.value }, (_, index) => String(index)) : keys) {
      const descriptor = properties[key];
      if (typeof key !== 'string' || ['__proto__', 'constructor', 'prototype'].includes(key)
        || !descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) throw invalidProjectRuntime();
      result[key] = copy(descriptor.value, depth + 1);
    }
    active.delete(value); return result;
  }
  return copy(input);
}

// Existing frames and protocol 1/2 observations retain their original bound.
export const copyProjectRuntimeData = input => copyBoundedRuntimeData(input, 8 * 1024 * 1024);
// At most 1152 event origins can each carry three 4096-character source fields,
// plus 512 KiB payload. An observation also contains the independently bounded
// 4 MiB child and 65 shared-state origins. These larger limits are DTO-only.
export const copyProjectEventSnapshotData = input => copyBoundedRuntimeData(input, 16 * 1024 * 1024);
export const copyProjectEventObservationData = input => copyBoundedRuntimeData(input, 24 * 1024 * 1024);

// Protocol 4 additionally retains 256 commands with two bounded origins each.
export const copyProjectAudioObservationData = input => copyBoundedRuntimeData(input, 32 * 1024 * 1024);

// Protocol 5 adds 256 animation receipts with behavior and animation origins.
export const copyProjectAnimationObservationData = input => copyBoundedRuntimeData(input, 40 * 1024 * 1024);

// Protocol 6 adds one bounded clip declaration/source per animation receipt.
export const copyProjectAnimationClipSnapshotData = input => copyBoundedRuntimeData(input, 12 * 1024 * 1024);
export const copyProjectAnimationClipObservationData = input => copyBoundedRuntimeData(input, 48 * 1024 * 1024);

// Protocol 7 adds at most 320 natural completions and 1024 independently
// sourced recipients. These are observation budgets, never wire line budgets.
export const copyProjectAnimationCompletionSnapshotData = input => copyBoundedRuntimeData(input, 24 * 1024 * 1024);
export const copyProjectAnimationCompletionObservationData = input => copyBoundedRuntimeData(input, 80 * 1024 * 1024);

export function freezeProjectRuntimeData(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freezeProjectRuntimeData); Object.freeze(value); }
  return value;
}
