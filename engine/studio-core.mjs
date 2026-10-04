// Hosts inject the Rust module bytes once. Missing or unsupported modules leave
// reading available; operations fail explicitly instead of using JS rules.
export const STUDIO_CORE_PROTOCOL_VERSION = 1;
const MAX_MESSAGE_BYTES = 1024 * 1024;
const MAX_MODULE_BYTES = 4 * 1024 * 1024;
const encoder = new TextEncoder(), decoder = new TextDecoder('utf-8', { fatal: true });
let runtime = null, loadError = null, dispatching = false, initialization = null;
const GEOMETRY_OPERATIONS = new Set(['move', 'align', 'validateBatch']);
const DRAFT_OPERATIONS = new Set(['create', 'setPositions', 'undo', 'redo', 'reset', 'read', 'close'].map(name => `layoutDraft.${name}`));
const SOURCE_OPERATIONS = new Set(['sceneSource.inspect', 'sceneSource.patch']);
const SAVE_OPERATIONS = new Set(['read', 'invalidate', 'begin', 'resolve', 'refreshed'].map(name => `layoutSave.${name}`));

const fail = (errorCode, message, cause) => Object.assign(new Error(message, cause ? { cause } : undefined), { errorCode });
const unavailable = () => fail('studio_core_unavailable', 'The Rust scene layout core is unavailable.', loadError);

export function initializeStudioCore(loadBytes) {
  if (initialization) return initialization;
  initialization = Promise.resolve().then(async () => {
    try {
      if (typeof loadBytes !== 'function') throw new TypeError('A Rust core byte loader is required.');
      const bytes = await loadBytes();
      if (!bytes?.byteLength || bytes.byteLength > MAX_MODULE_BYTES) throw new Error('Rust core module size is invalid.');
      const { instance } = await WebAssembly.instantiate(bytes, {}), exports = instance.exports;
      for (const name of ['viento_core_protocol_version', 'viento_core_input', 'viento_core_run', 'viento_core_output_len']) {
        if (typeof exports[name] !== 'function') throw new Error(`Rust core export is missing: ${name}.`);
      }
      if (!(exports.memory instanceof WebAssembly.Memory) || exports.viento_core_protocol_version() !== STUDIO_CORE_PROTOCOL_VERSION) {
        throw new Error('Rust core protocol or memory does not match this application.');
      }
      runtime = exports;
    } catch (error) { loadError = error; }
    return getStudioCoreMetadata();
  });
  return initialization;
}

export function getStudioCoreMetadata() {
  return Object.freeze({ protocolVersion: STUDIO_CORE_PROTOCOL_VERSION, backend: 'rust-wasm', ready: Boolean(runtime),
    ...(runtime ? {} : { errorCode: 'studio_core_unavailable' }) });
}

export async function ensureStudioCoreReady() {
  await initialization;
  if (!runtime) throw unavailable();
  return getStudioCoreMetadata();
}

// JSON.stringify would silently turn invalid floating values and array holes
// into null, and omit undefined fields. Reject such inputs before the ABI so
// Rust receives the caller's actual values. Accessors/custom serializers are
// excluded too: crossing this boundary must not execute caller-owned code.
function assertJson(value, ancestors = new Set(), depth = 0) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (!value || typeof value !== 'object' || depth > 64 || ancestors.has(value)) throw fail('studio_core_request_invalid', 'Rust core requests must contain finite JSON values.');
  const array = Array.isArray(value), prototype = Object.getPrototypeOf(value);
  if (!array && prototype !== null && Object.getPrototypeOf(prototype) !== null) throw fail('studio_core_request_invalid', 'Rust core requests must contain plain JSON objects.');
  if (Object.getOwnPropertyDescriptor(value, 'toJSON') || prototype && Object.getOwnPropertyDescriptor(prototype, 'toJSON')) throw fail('studio_core_request_invalid', 'Rust core requests must not use custom JSON serializers.');
  const descriptors = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(descriptors);
  ancestors.add(value);
  if (array) {
    if (keys.length !== value.length + 1) throw fail('studio_core_request_invalid', 'Rust core arrays must be dense and contain no extra properties.');
    for (let index = 0; index < value.length; index++) {
      const property = descriptors[index];
      if (!property || !Object.hasOwn(property, 'value') || !property.enumerable) throw fail('studio_core_request_invalid', 'Rust core arrays must contain explicit JSON values.');
      assertJson(property.value, ancestors, depth + 1);
    }
  } else {
    for (const key of keys) {
      const property = descriptors[key];
      if (typeof key !== 'string' || !property.enumerable || !Object.hasOwn(property, 'value')) throw fail('studio_core_request_invalid', 'Rust core objects must contain ordinary JSON properties.');
      assertJson(property.value, ancestors, depth + 1);
    }
  }
  ancestors.delete(value);
}

function memoryBytes(pointer, length) {
  if (!Number.isInteger(pointer) || !Number.isInteger(length) || length <= 0 || length > MAX_MESSAGE_BYTES) throw new Error('Rust core returned invalid buffer coordinates.');
  const address = pointer >>> 0;
  if (!address || address + length > runtime.memory.buffer.byteLength) throw new Error('Rust core buffer is outside its memory.');
  return new Uint8Array(runtime.memory.buffer, address, length);
}

function dispatch(request, operations, validate) {
  if (!runtime) throw unavailable();
  if (dispatching) throw fail('studio_core_request_invalid', 'Rust core calls must not be nested.');
  assertJson(request);
  // Reject cross-domain calls before Rust can mutate or allocate a session.
  if (!operations.has(request?.operation)) throw fail('studio_core_request_invalid', 'This Rust core operation does not belong to the requested interface.');
  const input = encoder.encode(JSON.stringify(request));
  if (!input.length || input.length > MAX_MESSAGE_BYTES) throw fail('studio_core_input_limit', 'Rust core request exceeds the message size limit.');
  let result;
  dispatching = true;
  try {
    const inputPointer = runtime.viento_core_input(input.length);
    memoryBytes(inputPointer, input.length).set(input);
    const outputPointer = runtime.viento_core_run(), outputLength = runtime.viento_core_output_len();
    result = JSON.parse(decoder.decode(memoryBytes(outputPointer, outputLength)));
    if (!result || result.protocolVersion !== STUDIO_CORE_PROTOCOL_VERSION || typeof result.ok !== 'boolean') throw new Error('Rust core returned an incompatible response.');
    if (result.ok) {
      validate(result, request);
    } else if (typeof result.errorCode !== 'string' || !/^[a-z][a-z0-9_]{0,127}$/.test(result.errorCode) || typeof result.message !== 'string') {
      throw new Error('Rust core returned a malformed error.');
    }
  } catch (error) {
    runtime = null; loadError = error;
    throw unavailable();
  } finally { dispatching = false; }
  if (!result.ok) throw fail(result.errorCode, result.message);
  return result;
}

function record(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}
function positiveId(value) {
  return typeof value === 'string' && /^[1-9][0-9]{0,19}$/.test(value) && BigInt(value) <= 18446744073709551615n;
}
function validPosition(change, bounded = false) {
  return record(change, ['objectId', 'position']) && typeof change.objectId === 'string'
    && Array.isArray(change.position) && change.position.length === 2
    && change.position.every(value => typeof value === 'number' && Number.isFinite(value) && (!bounded || Math.abs(value) <= 100000));
}
export function dispatchStudioCore(request) {
  return dispatch(request, GEOMETRY_OPERATIONS, result => {
    if (!Array.isArray(result.changes) || !result.changes.every(change => validPosition(change))) throw new Error('Rust core returned malformed position data.');
  }).changes;
}

// Draft state and history belong to Rust. The host receives a detached snapshot,
// checks its shape/identity, and never repairs an incomplete response locally.
export function dispatchStudioCoreDraft(request) {
  return dispatch(request, DRAFT_OPERATIONS, (result, input) => {
    const draft = result.draft;
    if (!record(result, ['protocolVersion', 'ok', 'draft']) || !draft || !positiveId(draft.draftId)
      || input.operation !== 'layoutDraft.create' && draft.draftId !== input.draftId) throw new Error('Rust core returned an incompatible draft identity.');
    if (input.operation === 'layoutDraft.close') {
      if (!record(draft, ['draftId', 'closed']) || draft.closed !== true) throw new Error('Rust core did not confirm closing the draft.');
      return;
    }
    if (!record(draft, ['draftId', 'positions', 'state', 'changed']) || typeof draft.changed !== 'boolean'
      || !record(draft.state, ['dirty', 'canUndo', 'canRedo']) || !Object.values(draft.state).every(value => typeof value === 'boolean')
      || !Array.isArray(draft.positions) || !draft.positions.length || draft.positions.length > 128
      || !draft.positions.every(change => validPosition(change, true) && change.objectId && encoder.encode(change.objectId).length <= 128)
      || new Set(draft.positions.map(change => change.objectId)).size !== draft.positions.length) throw new Error('Rust core returned malformed draft state.');
    if (input.operation === 'layoutDraft.create' && (!Array.isArray(input.actors) || input.actors.length !== draft.positions.length
      || input.actors.some((actor, index) => actor.objectId !== draft.positions[index].objectId))) throw new Error('Rust core returned another draft actor set.');
  }).draft;
}


// These phase/flag checks validate the Rust contract; the host never advances
// the save workflow or classifies remote failures on its own.
export function dispatchStudioCoreSave(request) {
  return dispatch(request, SAVE_OPERATIONS, (result, input) => {
    const save = result.save, state = save?.state;
    if (!record(result, ['protocolVersion', 'ok', 'save']) || !record(save, ['draftId', 'state'])
      || !positiveId(save.draftId) || save.draftId !== input.draftId
      || !record(state, ['phase', 'requestId', 'busy', 'editable', 'reviewed', 'saved', 'conflict', 'uncertain'])
      || !['editing', 'checking', 'reviewed', 'applying', 'uncertain', 'verifying', 'refreshing', 'saved', 'conflict'].includes(state.phase)
      || !['busy', 'editable', 'reviewed', 'saved', 'conflict', 'uncertain'].every(key => typeof state[key] === 'boolean')) {
      throw new Error('Rust core returned malformed save workflow state.');
    }
    const phaseMatchesOperation = input.operation === 'layoutSave.read'
      || input.operation === 'layoutSave.invalidate' && state.phase === 'editing'
      || input.operation === 'layoutSave.begin' && state.phase === { preview: 'checking', apply: 'applying', verify: 'verifying' }[input.action]
      || input.operation === 'layoutSave.refreshed' && state.phase === 'saved'
      || input.operation === 'layoutSave.resolve' && (input.outcome === 'accepted' && ['reviewed', 'refreshing'].includes(state.phase)
        || input.outcome === 'different' && state.phase === 'conflict' || input.outcome === 'error' && ['editing', 'conflict', 'uncertain'].includes(state.phase));
    if (!phaseMatchesOperation) throw new Error('Rust core returned a save phase incompatible with this operation.');
    const busy = ['checking', 'applying', 'verifying', 'refreshing'].includes(state.phase);
    if (state.busy !== busy || state.editable !== ['editing', 'reviewed'].includes(state.phase)
      || state.reviewed !== (state.phase === 'reviewed') || state.saved !== ['refreshing', 'saved'].includes(state.phase)
      || state.conflict !== (state.phase === 'conflict') || state.uncertain !== ['uncertain', 'verifying'].includes(state.phase)
      || (busy ? !positiveId(state.requestId) : state.requestId !== null)
      || busy && ['layoutSave.resolve', 'layoutSave.refreshed'].includes(input.operation) && state.requestId !== input.requestId) {
      throw new Error('Rust core returned inconsistent save workflow flags or request identity.');
    }
  }).save;
}


// Source inspection/patching is stateless and does not allocate a layout draft.
// An older protocol-1 core can still provide its existing geometry operations.
export function dispatchStudioCoreSource(request) {
  assertJson(request);
  if (!SOURCE_OPERATIONS.has(request?.operation)) throw fail('studio_core_request_invalid', 'This Rust core operation does not belong to the source interface.');
  if (!runtime || typeof runtime.viento_core_scene_source_version !== 'function'
    || runtime.viento_core_scene_source_version() !== 1) throw unavailable();
  return dispatch(request, SOURCE_OPERATIONS, (result, input) => {
    const source = result.source;
    if (!record(result, ['protocolVersion', 'ok', 'source'])) throw new Error('Rust core returned an incompatible source response.');
    if (input.operation === 'sceneSource.inspect') {
      if (!record(source, ['schemaVersion', 'actorCount']) || ![1, 2, 3].includes(source.schemaVersion)
        || !Number.isInteger(source.actorCount) || source.actorCount < 1 || source.actorCount > 128) throw new Error('Rust core returned malformed source inspection.');
      return;
    }
    if (!record(source, ['afterContent', 'changedPaths']) || typeof source.afterContent !== 'string'
      || encoder.encode(source.afterContent).length > 128 * 1024 || !Array.isArray(source.changedPaths)
      || source.changedPaths.length > 256 || !Array.isArray(input.changes) || source.changedPaths.length > input.changes.length * 2
      || source.changedPaths.some(value => typeof value !== 'string' || !/^\/actors\/(?:0|[1-9][0-9]{0,2})\/position\/[01]$/.test(value))) {
      throw new Error('Rust core returned malformed source patch.');
    }
    let previous = -1;
    for (const pointer of source.changedPaths) {
      const parts = pointer.split('/'), actor = Number(parts[2]), index = actor * 2 + Number(parts[4]);
      if (actor >= 128 || index <= previous) throw new Error('Rust core returned unordered or repeated coordinate paths.');
      previous = index;
    }
    if ((source.changedPaths.length === 0) !== (source.afterContent === input.content)) throw new Error('Rust core returned inconsistent source patch state.');
  }).source;
}
