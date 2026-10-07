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
const COMPOSITION_OPERATIONS = new Set(['sceneComposition.expand']);
const COMPOSITION_PATCH_OPERATIONS = new Set(['sceneComposition.patchOverrides']);
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

// Experimental composition returns an ordinary v3 scene and separate recipe
// pointers. The host checks the boundary, while Rust owns expansion rules.
export function dispatchStudioCoreComposition(request) {
  assertJson(request);
  if (!COMPOSITION_OPERATIONS.has(request?.operation)) throw fail('studio_core_request_invalid', 'This Rust core operation does not belong to the composition interface.');
  if (!runtime || typeof runtime.viento_core_scene_composition_version !== 'function'
    || runtime.viento_core_scene_composition_version() !== 1) throw unavailable();
  return dispatch(request, COMPOSITION_OPERATIONS, (result, input) => {
    const invalid = () => { throw new Error('Rust core returned malformed scene composition data.'); };
    const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
    const key = value => typeof value === 'string' && /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(value);
    const members = (value, required, optional = []) => value && typeof value === 'object' && !Array.isArray(value)
      && required.every(name => Object.hasOwn(value, name)) && Object.keys(value).every(name => required.includes(name) || optional.includes(name));
    const pair = (value, min, max) => Array.isArray(value) && value.length === 2 && value.every(item => typeof item === 'number' && Number.isFinite(item) && item >= min && item <= max);
    const hex = value => typeof value === 'string' && /^#[a-f0-9]{6}(?:[a-f0-9]{2})?$/i.test(value);
    const { composition } = result;
    if (!record(result, ['protocolVersion', 'ok', 'composition']) || !record(composition, ['scene', 'sourceMap'])) invalid();
    const { scene, sourceMap } = composition;
    const recipe = JSON.parse(input.content.replace(/^\uFEFF/, ''));
    const at = pointer => {
      let value = recipe;
      for (const name of pointer.slice(1).split('/')) {
        if (!value || typeof value !== 'object' || !Object.hasOwn(value, name)) invalid();
        value = value[name];
      }
      return value;
    };
    if (!record(scene, ['format', 'schemaVersion', 'title', 'viewport', 'background', 'actors', 'groups'])
      || scene.format !== 'viento-scene2d' || scene.schemaVersion !== 3 || typeof scene.title !== 'string' || !scene.title.trim() || scene.title.length > 160 || /[\x00-\x1f]/.test(scene.title)
      || !pair(scene.viewport, 64, 4096) || !scene.viewport.every(Number.isInteger) || !hex(scene.background)
      || !Array.isArray(scene.actors) || scene.actors.length < 1 || scene.actors.length > 128
      || !Array.isArray(scene.groups) || scene.groups.length > 128 || encoder.encode(JSON.stringify(scene)).length > 128 * 1024) invalid();
    const identities = new Set(), groupIds = new Set();
    for (const group of scene.groups) {
      if (!members(group, ['groupId', 'name'], ['parentGroupId']) || !uuid(group.groupId) || identities.has(group.groupId)
        || typeof group.name !== 'string' || !group.name.trim() || group.name.length > 160 || /[\x00-\x1f\x7f]/.test(group.name)
        || Object.hasOwn(group, 'parentGroupId') && !uuid(group.parentGroupId)) invalid();
      identities.add(group.groupId); groupIds.add(group.groupId);
    }
    for (const group of scene.groups) if (Object.hasOwn(group, 'parentGroupId') && !groupIds.has(group.parentGroupId)) invalid();
    const parents = new Map(scene.groups.map(group => [group.groupId, group.parentGroupId]));
    for (const group of scene.groups) {
      const seen = new Set();
      for (let id = group.groupId; id !== undefined; id = parents.get(id)) {
        if (seen.has(id) || seen.size >= 16) invalid();
        seen.add(id);
      }
    }
    for (const actor of scene.actors) {
      if (!members(actor, ['instanceId', 'objectId', 'position'], ['groupId', 'size', 'color', 'speed', 'controls', 'imageResourceId', 'useProjectionDefaults'])
        || !uuid(actor.instanceId) || !uuid(actor.objectId) || identities.has(actor.instanceId) || !pair(actor.position, -100000, 100000)
        || Object.hasOwn(actor, 'groupId') && !groupIds.has(actor.groupId)
        || Object.hasOwn(actor, 'size') && !pair(actor.size, 1, 2048) || Object.hasOwn(actor, 'color') && !hex(actor.color)
        || Object.hasOwn(actor, 'speed') && !(typeof actor.speed === 'number' && actor.speed >= 0 && actor.speed <= 2000)
        || Object.hasOwn(actor, 'controls') && !['arrows', 'none'].includes(actor.controls)
        || Object.hasOwn(actor, 'imageResourceId') && actor.imageResourceId !== null && !uuid(actor.imageResourceId)
        || actor.useProjectionDefaults !== true && (actor.imageResourceId === null || ['size', 'color', 'speed', 'controls'].some(name => !Object.hasOwn(actor, name)))
        || Object.hasOwn(actor, 'useProjectionDefaults') && typeof actor.useProjectionDefaults !== 'boolean') invalid();
      identities.add(actor.instanceId);
    }
    if (!record(sourceMap, ['format', 'schemaVersion', 'actors', 'groups']) || sourceMap.format !== 'viento-scene-composition-map' || sourceMap.schemaVersion !== 1) invalid();
    const pointer = value => typeof value === 'string' && value.length <= 256
      && /^\/(?:fragments|placements)\/(?:0|[1-9][0-9]{0,2})(?:\/(?:[a-zA-Z][a-zA-Z0-9_-]{0,63}|0|[1-9][0-9]{0,2}))*$/.test(value);
    for (const [kind, identity, mapping] of [['actors', 'instanceId', 'actorIds'], ['groups', 'groupId', 'groupIds']]) {
      if (!Array.isArray(sourceMap[kind]) || sourceMap[kind].length !== scene[kind].length) invalid();
      for (const [index, item] of sourceMap[kind].entries()) {
        const value = scene[kind][index];
        if (!record(item, [identity, 'placementId', 'fragmentId', 'localKey', 'templatePath', 'placementPath', 'identityPath', 'fields'])
          || item[identity] !== value[identity] || !uuid(item.placementId) || !key(item.fragmentId) || !key(item.localKey)
          || !pointer(item.templatePath) || !new RegExp(`^/fragments/(?:0|[1-9][0-9]?)/${kind}/(?:0|[1-9][0-9]{0,2})$`).test(item.templatePath)
          || !/^\/placements\/(?:0|[1-9][0-9]{0,2})$/.test(item.placementPath)
          || item.identityPath !== `${item.placementPath}/${mapping}/${item.localKey}`
          || !record(item.fields, Object.keys(value).filter(name => name !== identity))) invalid();
        if (at(item.identityPath) !== item[identity] || at(item.templatePath)?.key !== item.localKey
          || at(item.placementPath)?.placementId !== item.placementId || at(item.placementPath)?.fragmentId !== item.fragmentId
          || at(item.templatePath.split('/').slice(0, 3).join('/'))?.fragmentId !== item.fragmentId) invalid();
        const template = at(item.templatePath), placement = at(item.placementPath);
        const overrideIndex = kind === 'actors' && Array.isArray(placement.overrides)
          ? placement.overrides.findIndex(override => override?.actorKey === item.localKey) : -1;
        for (const [field, paths] of Object.entries(item.fields)) {
          if (!Array.isArray(paths) || paths.length < 1 || paths.length > 2 || !paths.every(pointer) || new Set(paths).size !== paths.length) invalid();
          // Check provenance ownership without duplicating Rust's value expansion.
          // An existing pointer in another placement is not this field's source.
          let expected;
          if (kind === 'actors' && field === 'groupId') {
            expected = [`${item.templatePath}/groupKey`, `${item.placementPath}/groupIds/${template.groupKey}`];
          } else if (kind === 'groups' && field === 'parentGroupId') {
            expected = [`${item.templatePath}/parentKey`, `${item.placementPath}/groupIds/${template.parentKey}`];
          } else {
            const overridden = overrideIndex >= 0 && Object.hasOwn(placement.overrides[overrideIndex].values ?? {}, field);
            expected = [overridden ? `${item.placementPath}/overrides/${overrideIndex}/values/${field}` : `${item.templatePath}/${field}`];
            if (kind === 'actors' && field === 'position' && Object.hasOwn(placement, 'offset')) expected.push(`${item.placementPath}/offset`);
          }
          if (paths.length !== expected.length || paths.some((path, index) => path !== expected[index])) invalid();
          for (const path of paths) at(path);
        }
      }
    }
  }).composition;
}

export function supportsStudioCoreCompositionPatch() {
  return Boolean(runtime && typeof runtime.viento_core_scene_composition_patch_version === 'function'
    && runtime.viento_core_scene_composition_patch_version() === 1);
}

// This boundary verifies the narrow set operation and stable target ownership;
// only Rust chooses byte edits, formatting and recipe validity. No JS fallback.
export function dispatchStudioCoreCompositionPatch(request) {
  assertJson(request);
  if (!COMPOSITION_PATCH_OPERATIONS.has(request?.operation)) throw fail('studio_core_request_invalid', 'This Rust core operation does not belong to the composition patch interface.');
  if (!supportsStudioCoreCompositionPatch()) throw unavailable();
  const patch = dispatch(request, COMPOSITION_PATCH_OPERATIONS, (result, input) => {
    const invalid = () => { throw new Error('Rust core returned malformed composition override patch data.'); };
    const fields = ['position', 'size', 'color', 'speed', 'controls', 'imageResourceId'];
    const same = (left, right) => {
      if (left === right) return true;
      if (!left || !right || typeof left !== 'object' || typeof right !== 'object' || Array.isArray(left) !== Array.isArray(right)) return false;
      const keys = Object.keys(left);
      return keys.length === Object.keys(right).length && keys.every(key => Object.hasOwn(right, key) && same(left[key], right[key]));
    };
    const patch = result.compositionPatch;
    if (!record(result, ['protocolVersion', 'ok', 'compositionPatch']) || !record(patch, ['afterContent', 'changedPaths'])
      || typeof patch.afterContent !== 'string' || encoder.encode(patch.afterContent).length > 128 * 1024
      || !Array.isArray(patch.changedPaths) || patch.changedPaths.length > fields.length
      || !record(input, ['protocolVersion', 'operation', 'content', 'placementId', 'actorKey', 'values'])
      || typeof input.content !== 'string' || encoder.encode(input.content).length > 128 * 1024
      || typeof input.placementId !== 'string' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(input.placementId)
      || typeof input.actorKey !== 'string' || !/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(input.actorKey)
      || !input.values || typeof input.values !== 'object' || Array.isArray(input.values)
      || !Object.keys(input.values).length || Object.keys(input.values).some(key => !fields.includes(key))) invalid();
    const before = JSON.parse(input.content.replace(/^\uFEFF/, ''));
    const after = JSON.parse(patch.afterContent.replace(/^\uFEFF/, ''));
    if (before?.format !== 'viento-scene-composition' || before.schemaVersion !== 1 || !Array.isArray(before.placements)
      || before.placements.length < 1 || before.placements.length > 128) invalid();
    const indices = before.placements.flatMap((placement, index) => placement?.placementId === input.placementId ? [index] : []);
    if (indices.length !== 1) invalid();
    const placementIndex = indices[0], placement = before.placements[placementIndex];
    if (!placement.actorIds || !Object.hasOwn(placement.actorIds, input.actorKey)
      || Object.hasOwn(placement, 'overrides') && !Array.isArray(placement.overrides)) invalid();
    const overrides = placement.overrides || [];
    const matching = overrides.flatMap((value, index) => value?.actorKey === input.actorKey ? [index] : []);
    if (matching.length > 1) invalid();
    const overrideIndex = matching.length ? matching[0] : overrides.length;
    const existing = matching.length ? overrides[overrideIndex].values : {};
    if (!existing || typeof existing !== 'object' || Array.isArray(existing)) invalid();
    const changed = fields.filter(field => Object.hasOwn(input.values, field)
      && (!Object.hasOwn(existing, field) || !same(existing[field], input.values[field])));
    const expectedPaths = changed.map(field => `/placements/${placementIndex}/overrides/${overrideIndex}/values/${field}`);
    if (!same(patch.changedPaths, expectedPaths)
      || (expectedPaths.length === 0) !== (patch.afterContent === input.content)) invalid();
    if (changed.length) {
      if (!Object.hasOwn(placement, 'overrides')) placement.overrides = overrides;
      if (!matching.length) overrides.push({ actorKey: input.actorKey, values: existing });
      for (const field of changed) existing[field] = input.values[field];
    }
    if (!same(before, after)) invalid();
  }).compositionPatch;
  // JSON equality above guards write scope, but does not detect duplicate
  // decoded source keys. Revalidate with the existing core after the first
  // dispatch ends; never nest WASM buffer calls or add another JS parser.
  try {
    dispatchStudioCoreComposition({ protocolVersion: STUDIO_CORE_PROTOCOL_VERSION,
      operation: 'sceneComposition.expand', content: patch.afterContent });
  } catch (error) {
    runtime = null; loadError = error;
    throw unavailable();
  }
  return patch;
}
