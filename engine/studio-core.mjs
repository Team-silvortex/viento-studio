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
const COMPOSITION_PATCH_OPERATIONS = new Set(['sceneComposition.patchOverrides', 'sceneComposition.editOverrides']);
const COMPOSITION_POSITION_OPERATIONS = new Set(['sceneComposition.patchPositions']);
const COMPOSITION_FRAGMENT_OPERATIONS = new Set(['sceneComposition.patchFragmentActor']);
const COMPOSITION_FRAGMENT_EDIT_OPERATIONS = new Set(['sceneComposition.editFragmentActor']);
const COMPOSITION_PLACEMENT_OPERATIONS = new Set(['sceneComposition.editPlacementOffset']);
const COMPOSITION_GROUPS_OPERATIONS = new Set(['sceneComposition.addFragmentGroup','sceneComposition.editFragmentGroup','sceneComposition.assignFragmentActorGroup','sceneComposition.removeFragmentGroup']);
const COMPOSITION_DEFINITIONS_OPERATIONS = new Set(['sceneComposition.addFragmentDefinition', 'sceneComposition.copyFragmentDefinition', 'sceneComposition.removeFragmentDefinition']);
const COMPOSITION_DEFINITION_LOCATION_OPERATIONS = new Set(['sceneComposition.inspectDefinitionLocations']);
const COMPOSITION_DEFINITION_RENAME_OPERATIONS = new Set(['sceneComposition.renameFragmentDefinition']);
const COMPOSITION_PLACEMENTS_OPERATIONS = new Set(['sceneComposition.addPlacement', 'sceneComposition.copyPlacement', 'sceneComposition.removePlacement']);
const COMPOSITION_STRUCTURE_OPERATIONS = new Set(['sceneComposition.addFragmentActor', 'sceneComposition.removeFragmentActor']);
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

export function supportsStudioCoreCompositionEdit() {
  return Boolean(runtime && typeof runtime.viento_core_scene_composition_edit_version === 'function'
    && runtime.viento_core_scene_composition_edit_version() === 1);
}

export function supportsStudioCoreCompositionPositions() {
  return Boolean(runtime && typeof runtime.viento_core_scene_composition_positions_version === 'function'
    && runtime.viento_core_scene_composition_positions_version() === 1);
}

export function supportsStudioCoreCompositionFragment() {
  return Boolean(runtime && typeof runtime.viento_core_scene_composition_fragment_version === 'function'
    && runtime.viento_core_scene_composition_fragment_version() === 1);
}

export function supportsStudioCoreCompositionFragmentEdit() {
  return Boolean(runtime && typeof runtime.viento_core_scene_composition_fragment_edit_version === 'function'
    && runtime.viento_core_scene_composition_fragment_edit_version() === 1);
}

export function supportsStudioCoreCompositionPlacement() {
  return Boolean(runtime && typeof runtime.viento_core_scene_composition_placement_version === 'function'
    && runtime.viento_core_scene_composition_placement_version() === 1);
}

export function supportsStudioCoreCompositionStructure() {
  return Boolean(runtime && typeof runtime.viento_core_scene_composition_structure_version === 'function'
    && runtime.viento_core_scene_composition_structure_version() === 1);
}

// Shared structure has an independent optional capability and strict receipt.
// The source-preserving edit remains in Rust; this layer validates its scope.
export function dispatchStudioCoreCompositionStructure(request) {
  assertJson(request);
  if (!COMPOSITION_STRUCTURE_OPERATIONS.has(request?.operation)) throw fail('studio_core_request_invalid', 'This operation does not belong to the shared composition structure interface.');
  if (!supportsStudioCoreCompositionStructure()) throw unavailable();
  const patch = dispatch(request, COMPOSITION_STRUCTURE_OPERATIONS, (result, input) => {
    const invalid = () => { throw new Error('Rust core returned malformed composition structure data.'); };
    const same = (a, b) => {
      if (a === b) return true;
      if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false;
      const keys = Object.keys(a);
      return keys.length === Object.keys(b).length && keys.every(key => Object.hasOwn(b, key) && same(a[key], b[key]));
    };
    const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
    const key = value => typeof value === 'string' && /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(value);
    const adding = input.operation === 'sceneComposition.addFragmentActor', patch = result.compositionPatch;
    if (!record(result, ['protocolVersion', 'ok', 'compositionPatch']) || !record(patch, ['afterContent', 'changedPaths'])
      || !record(input, ['protocolVersion', 'operation', 'content', 'fragmentId', ...(adding ? ['actor', 'instances'] : ['actorKey'])])
      || typeof input.content !== 'string' || encoder.encode(input.content).length > 128 * 1024 || !key(input.fragmentId)
      || typeof patch.afterContent !== 'string' || encoder.encode(patch.afterContent).length > 128 * 1024
      || !Array.isArray(patch.changedPaths) || patch.changedPaths.length < 1 || patch.changedPaths.length > 257) invalid();
    const before = JSON.parse(input.content.replace(/^\uFEFF/, '')), after = JSON.parse(patch.afterContent.replace(/^\uFEFF/, ''));
    const fragmentIndex = before.fragments?.findIndex(fragment => fragment.fragmentId === input.fragmentId);
    if (!Number.isInteger(fragmentIndex) || fragmentIndex < 0) invalid();
    const fragment = before.fragments[fragmentIndex], related = before.placements.flatMap((placement, index) => placement.fragmentId === input.fragmentId ? [{ placement, index }] : []), paths = [];
    if (adding) {
      const actor = input.actor;
      if (!actor || typeof actor !== 'object' || Array.isArray(actor) || !key(actor.key)
        || fragment.actors.some(item => item.key === actor.key) || !Array.isArray(input.instances) || input.instances.length !== related.length) invalid();
      const identities = new Set(before.placements.flatMap(placement => [placement.placementId, ...Object.values(placement.actorIds), ...Object.values(placement.groupIds)]));
      paths.push(`/fragments/${fragmentIndex}/actors/${fragment.actors.length}`); fragment.actors.push(actor);
      related.forEach(({ placement, index }, targetIndex) => {
        const instance = input.instances[targetIndex];
        if (!record(instance, ['placementId', 'instanceId']) || instance.placementId !== placement.placementId || !uuid(instance.instanceId) || identities.has(instance.instanceId)) invalid();
        identities.add(instance.instanceId); placement.actorIds[actor.key] = instance.instanceId;
        paths.push(`/placements/${index}/actorIds/${actor.key}`);
      });
    } else {
      if (!key(input.actorKey) || fragment.actors.length < 2) invalid();
      const actorIndex = fragment.actors.findIndex(actor => actor.key === input.actorKey); if (actorIndex < 0) invalid();
      fragment.actors.splice(actorIndex, 1); paths.push(`/fragments/${fragmentIndex}/actors/${actorIndex}`);
      for (const { placement, index } of related) {
        delete placement.actorIds[input.actorKey]; paths.push(`/placements/${index}/actorIds/${input.actorKey}`);
        const overrideIndex = placement.overrides?.findIndex(item => item.actorKey === input.actorKey) ?? -1;
        if (overrideIndex >= 0) { placement.overrides.splice(overrideIndex, 1); paths.push(`/placements/${index}/overrides/${overrideIndex}`); }
      }
    }
    if (!same(paths, patch.changedPaths) || patch.afterContent === input.content || !same(before, after)) invalid();
  }).compositionPatch;
  try {
    dispatchStudioCoreComposition({ protocolVersion: STUDIO_CORE_PROTOCOL_VERSION, operation: 'sceneComposition.expand', content: request.content });
    dispatchStudioCoreComposition({ protocolVersion: STUDIO_CORE_PROTOCOL_VERSION, operation: 'sceneComposition.expand', content: patch.afterContent });
  } catch (error) { runtime = null; loadError = error; throw unavailable(); }
  return patch;
}

// Placement author offsets have a separate capability and no geometry session.
export function dispatchStudioCoreCompositionPlacement(request) {
  assertJson(request);
  if (!COMPOSITION_PLACEMENT_OPERATIONS.has(request?.operation)) throw fail('studio_core_request_invalid', 'This Rust core operation does not belong to the composition placement interface.');
  if (!supportsStudioCoreCompositionPlacement()) throw unavailable();
  const patch = dispatch(request, COMPOSITION_PLACEMENT_OPERATIONS, (result, input) => {
    const invalid = () => { throw new Error('Rust core returned malformed composition placement data.'); };
    const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
    const same = (a, b) => {
      if (a === b) return true;
      if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false;
      const keys = Object.keys(a);
      return keys.length === Object.keys(b).length && keys.every(key => Object.hasOwn(b, key) && same(a[key], b[key]));
    };
    const pair = value => Array.isArray(value) && value.length === 2
      && value.every(axis => typeof axis === 'number' && Number.isFinite(axis) && Math.abs(axis) <= 100000);
    const patch = result.compositionPatch;
    if (!record(result, ['protocolVersion', 'ok', 'compositionPatch']) || !record(patch, ['afterContent', 'changedPaths'])
      || typeof patch.afterContent !== 'string' || encoder.encode(patch.afterContent).length > 128 * 1024
      || !Array.isArray(patch.changedPaths) || patch.changedPaths.length > 1
      || !record(input, ['protocolVersion', 'operation', 'content', 'placementId', 'offset']) || input.protocolVersion !== STUDIO_CORE_PROTOCOL_VERSION
      || typeof input.content !== 'string' || encoder.encode(input.content).length > 128 * 1024
      || !uuid(input.placementId) || input.offset !== null && !pair(input.offset)) invalid();
    const before = JSON.parse(input.content.replace(/^\uFEFF/, ''));
    const after = JSON.parse(patch.afterContent.replace(/^\uFEFF/, ''));
    if (before?.format !== 'viento-scene-composition' || before.schemaVersion !== 1 || !Array.isArray(before.placements)) invalid();
    const placements = before.placements.flatMap((placement, index) => placement?.placementId === input.placementId ? [index] : []);
    if (placements.length !== 1) invalid();
    const index = placements[0], placement = before.placements[index];
    const changed = input.offset === null ? Object.hasOwn(placement, 'offset')
      : !Object.hasOwn(placement, 'offset') || !same(placement.offset, input.offset);
    const paths = changed ? [`/placements/${index}/offset`] : [];
    if (changed) {
      if (input.offset === null) delete placement.offset;
      else placement.offset = input.offset;
    }
    if (!same(patch.changedPaths, paths) || (paths.length === 0) !== (patch.afterContent === input.content) || !same(before, after)) invalid();
  }).compositionPatch;
  // Validate both complete recipes strictly, including duplicate decoded keys.
  try {
    dispatchStudioCoreComposition({ protocolVersion: STUDIO_CORE_PROTOCOL_VERSION, operation: 'sceneComposition.expand', content: request.content });
    dispatchStudioCoreComposition({ protocolVersion: STUDIO_CORE_PROTOCOL_VERSION, operation: 'sceneComposition.expand', content: patch.afterContent });
  } catch (error) { runtime = null; loadError = error; throw unavailable(); }
  return patch;
}

// A fragment declaration has its own narrow domain. Validate exact target
// semantics and receipts here; Rust retains all parsing and byte edit rules.
export function dispatchStudioCoreCompositionFragment(request) {
  return dispatchCompositionFragmentRequest(request, false);
}

export function dispatchStudioCoreCompositionFragmentEdit(request) {
  return dispatchCompositionFragmentRequest(request, true);
}

function dispatchCompositionFragmentRequest(request, editing) {
  assertJson(request);
  const operations = editing ? COMPOSITION_FRAGMENT_EDIT_OPERATIONS : COMPOSITION_FRAGMENT_OPERATIONS;
  if (!operations.has(request?.operation)) throw fail('studio_core_request_invalid', 'This Rust core operation does not belong to the composition fragment interface.');
  if (!(editing ? supportsStudioCoreCompositionFragmentEdit() : supportsStudioCoreCompositionFragment())) throw unavailable();
  const patch = dispatch(request, operations, (result, input) => {
    const invalid = () => { throw new Error('Rust core returned malformed composition fragment actor data.'); };
    const fields = ['position', 'size', 'color', 'speed', 'controls', 'imageResourceId'];
    const key = value => typeof value === 'string' && /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(value);
    const same = (a, b) => {
      if (a === b) return true;
      if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false;
      const keys = Object.keys(a);
      return keys.length === Object.keys(b).length && keys.every(key => Object.hasOwn(b, key) && same(a[key], b[key]));
    };
    const resets = editing ? input.reset : [];
    const patch = result.compositionPatch;
    if (!record(result, ['protocolVersion', 'ok', 'compositionPatch']) || !record(patch, ['afterContent', 'changedPaths'])
      || typeof patch.afterContent !== 'string' || encoder.encode(patch.afterContent).length > 128 * 1024
      || !Array.isArray(patch.changedPaths) || patch.changedPaths.length > fields.length
      || !record(input, ['protocolVersion', 'operation', 'content', 'fragmentId', 'actorKey', 'values', ...(editing ? ['reset'] : [])])
      || typeof input.content !== 'string' || encoder.encode(input.content).length > 128 * 1024
      || !key(input.fragmentId) || !key(input.actorKey) || !input.values || typeof input.values !== 'object' || Array.isArray(input.values)
      || Object.keys(input.values).some(field => !fields.includes(field))
      || !Array.isArray(resets) || resets.length > fields.length - 1 || new Set(resets).size !== resets.length
      || resets.some(field => field === 'position' || !fields.includes(field) || Object.hasOwn(input.values, field))
      || !Object.keys(input.values).length && !resets.length) invalid();
    const before = JSON.parse(input.content.replace(/^\uFEFF/, ''));
    const after = JSON.parse(patch.afterContent.replace(/^\uFEFF/, ''));
    if (before?.format !== 'viento-scene-composition' || before.schemaVersion !== 1 || !Array.isArray(before.fragments)) invalid();
    const fragments = before.fragments.flatMap((fragment, index) => fragment?.fragmentId === input.fragmentId ? [index] : []);
    if (fragments.length !== 1) invalid();
    const fragmentIndex = fragments[0], fragment = before.fragments[fragmentIndex];
    if (!Array.isArray(fragment.actors)) invalid();
    const actors = fragment.actors.flatMap((actor, index) => actor?.key === input.actorKey ? [index] : []);
    if (actors.length !== 1) invalid();
    const actorIndex = actors[0], actor = fragment.actors[actorIndex];
    if (actor.useProjectionDefaults !== true && resets.some(field => field !== 'imageResourceId')) invalid();
    const changed = fields.filter(field => resets.includes(field) && Object.hasOwn(actor, field)
      || Object.hasOwn(input.values, field) && (!Object.hasOwn(actor, field) || !same(actor[field], input.values[field])));
    const paths = changed.map(field => `/fragments/${fragmentIndex}/actors/${actorIndex}/${field}`);
    for (const field of changed) {
      if (resets.includes(field)) delete actor[field];
      else actor[field] = input.values[field];
    }
    if (!same(patch.changedPaths, paths) || (paths.length === 0) !== (patch.afterContent === input.content) || !same(before, after)) invalid();
  }).compositionPatch;
  // Re-expansion also rejects duplicate decoded source keys in both recipes.
  try {
    dispatchStudioCoreComposition({ protocolVersion: STUDIO_CORE_PROTOCOL_VERSION, operation: 'sceneComposition.expand', content: request.content });
    dispatchStudioCoreComposition({ protocolVersion: STUDIO_CORE_PROTOCOL_VERSION, operation: 'sceneComposition.expand', content: patch.afterContent });
  } catch (error) { runtime = null; loadError = error; throw unavailable(); }
  return patch;
}

// Batch positions have their own capability and receipt checks. Byte edits and
// strict recipe parsing stay in Rust; old set/reset bridges remain independent.
export function dispatchStudioCoreCompositionPositions(request) {
  assertJson(request);
  if (!COMPOSITION_POSITION_OPERATIONS.has(request?.operation)) throw fail('studio_core_request_invalid', 'This Rust core operation does not belong to the composition position interface.');
  if (!supportsStudioCoreCompositionPositions()) throw unavailable();
  const patch = dispatch(request, COMPOSITION_POSITION_OPERATIONS, (result, input) => {
    const invalid = () => { throw new Error('Rust core returned malformed composition position batch data.'); };
    const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
    const same = (a, b) => {
      if (a === b) return true;
      if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false;
      const keys = Object.keys(a);
      return keys.length === Object.keys(b).length && keys.every(key => Object.hasOwn(b, key) && same(a[key], b[key]));
    };
    const patch = result.compositionPatch;
    if (!record(result, ['protocolVersion', 'ok', 'compositionPatch']) || !record(patch, ['afterContent', 'changedPaths'])
      || typeof patch.afterContent !== 'string' || encoder.encode(patch.afterContent).length > 128 * 1024
      || !Array.isArray(patch.changedPaths) || patch.changedPaths.length > 128
      || !record(input, ['protocolVersion', 'operation', 'content', 'changes']) || typeof input.content !== 'string'
      || encoder.encode(input.content).length > 128 * 1024 || !Array.isArray(input.changes)
      || !input.changes.length || input.changes.length > 128) invalid();
    const before = JSON.parse(input.content.replace(/^\uFEFF/, ''));
    const after = JSON.parse(patch.afterContent.replace(/^\uFEFF/, ''));
    if (before?.format !== 'viento-scene-composition' || before.schemaVersion !== 1
      || !Array.isArray(before.placements) || !Array.isArray(before.fragments)) invalid();
    const seen = new Set(), targets = [];
    for (const change of input.changes) {
      if (!record(change, ['placementId', 'actorKey', 'position']) || !uuid(change.placementId)
        || typeof change.actorKey !== 'string' || !/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(change.actorKey)
        || !Array.isArray(change.position) || change.position.length !== 2
        || change.position.some(n => typeof n !== 'number' || !Number.isFinite(n) || Math.abs(n) > 100000)) invalid();
      const identity = `${change.placementId}/${change.actorKey}`;
      if (seen.has(identity)) invalid(); seen.add(identity);
      const placementIndex = before.placements.findIndex(item => item.placementId === change.placementId);
      const placement = before.placements[placementIndex], fragment = before.fragments.find(item => item.fragmentId === placement?.fragmentId);
      const actorIndex = fragment?.actors?.findIndex(item => item.key === change.actorKey), actor = fragment?.actors?.[actorIndex];
      if (!placement || !Object.hasOwn(placement.actorIds || {}, change.actorKey) || !actor
        || Object.hasOwn(placement, 'overrides') && !Array.isArray(placement.overrides)) invalid();
      const entries = placement.overrides || [], matches = entries.flatMap((entry, index) => entry.actorKey === change.actorKey ? [index] : []);
      if (matches.length > 1) invalid();
      const local = matches.length ? entries[matches[0]].values : {};
      if (!local || typeof local !== 'object' || Array.isArray(local)) invalid();
      if (!same(local.position ?? actor.position, change.position)) targets.push({ placementIndex, actorIndex, change });
    }
    targets.sort((a, b) => a.placementIndex - b.placementIndex || a.actorIndex - b.actorIndex);
    const paths = [];
    for (const { placementIndex, change } of targets) {
      const placement = before.placements[placementIndex]; placement.overrides ||= [];
      let index = placement.overrides.findIndex(entry => entry.actorKey === change.actorKey);
      if (index < 0) { index = placement.overrides.length; placement.overrides.push({ actorKey: change.actorKey, values: {} }); }
      placement.overrides[index].values.position = [...change.position];
      paths.push(`/placements/${placementIndex}/overrides/${index}/values/position`);
    }
    if (!same(patch.changedPaths, paths) || (paths.length === 0) !== (patch.afterContent === input.content) || !same(before, after)) invalid();
  }).compositionPatch;
  try {
    dispatchStudioCoreComposition({ protocolVersion: STUDIO_CORE_PROTOCOL_VERSION, operation: 'sceneComposition.expand', content: request.content });
    dispatchStudioCoreComposition({ protocolVersion: STUDIO_CORE_PROTOCOL_VERSION, operation: 'sceneComposition.expand', content: patch.afterContent });
  } catch (error) { runtime = null; loadError = error; throw unavailable(); }
  return patch;
}

// This boundary verifies narrow set/reset operations and stable target ownership;
// only Rust chooses byte edits, formatting and recipe validity. No JS fallback.
export function dispatchStudioCoreCompositionPatch(request) {
  assertJson(request);
  if (!COMPOSITION_PATCH_OPERATIONS.has(request?.operation)) throw fail('studio_core_request_invalid', 'This Rust core operation does not belong to the composition patch interface.');
  if (!(request.operation === 'sceneComposition.editOverrides'
    ? supportsStudioCoreCompositionEdit() : supportsStudioCoreCompositionPatch())) throw unavailable();
  const patch = dispatch(request, COMPOSITION_PATCH_OPERATIONS, (result, input) => {
    const invalid = () => { throw new Error('Rust core returned malformed composition override patch data.'); };
    const fields = ['position', 'size', 'color', 'speed', 'controls', 'imageResourceId'];
    const editing = input.operation === 'sceneComposition.editOverrides';
    const resets = editing ? input.resetFields : [];
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
      || !record(input, ['protocolVersion', 'operation', 'content', 'placementId', 'actorKey', 'values', ...(editing ? ['resetFields'] : [])])
      || typeof input.content !== 'string' || encoder.encode(input.content).length > 128 * 1024
      || typeof input.placementId !== 'string' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(input.placementId)
      || typeof input.actorKey !== 'string' || !/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(input.actorKey)
      || !input.values || typeof input.values !== 'object' || Array.isArray(input.values)
      || Object.keys(input.values).some(key => !fields.includes(key))
      || !Array.isArray(resets) || resets.length > fields.length || new Set(resets).size !== resets.length
      || resets.some(field => !fields.includes(field) || Object.hasOwn(input.values, field))
      || !Object.keys(input.values).length && !resets.length) invalid();
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
    const changed = fields.filter(field => resets.includes(field) && Object.hasOwn(existing, field)
      || Object.hasOwn(input.values, field) && (!Object.hasOwn(existing, field) || !same(existing[field], input.values[field])));
    const expectedPaths = changed.map(field => `/placements/${placementIndex}/overrides/${overrideIndex}/values/${field}`);
    if (!same(patch.changedPaths, expectedPaths)
      || (expectedPaths.length === 0) !== (patch.afterContent === input.content)) invalid();
    if (changed.length) {
      if (!Object.hasOwn(placement, 'overrides')) placement.overrides = overrides;
      if (!matching.length) overrides.push({ actorKey: input.actorKey, values: existing });
      for (const field of changed) {
        if (resets.includes(field)) delete existing[field];
        else existing[field] = input.values[field];
      }
      if (!Object.keys(existing).length) overrides.splice(overrideIndex, 1);
    }
    if (!same(before, after)) invalid();
  }).compositionPatch;
  // JSON equality cannot detect duplicate decoded keys. A deletion might even
  // remove the duplicate from the candidate, so verify both the original and
  // candidate after dispatch; never nest WASM calls or add another JS parser.
  try {
    dispatchStudioCoreComposition({ protocolVersion: STUDIO_CORE_PROTOCOL_VERSION,
      operation: 'sceneComposition.expand', content: request.content });
    dispatchStudioCoreComposition({ protocolVersion: STUDIO_CORE_PROTOCOL_VERSION,
      operation: 'sceneComposition.expand', content: patch.afterContent });
  } catch (error) {
    runtime = null; loadError = error;
    throw unavailable();
  }
  return patch;
}

/** Independent placement structure capability; earlier value domains remain usable. */
export function supportsStudioCoreCompositionPlacements() {
  return Boolean(runtime && typeof runtime.viento_core_scene_composition_placements_version === 'function'
    && runtime.viento_core_scene_composition_placements_version() === 1);
}
export function dispatchStudioCoreCompositionPlacements(request) {
  assertJson(request);
  if (!COMPOSITION_PLACEMENTS_OPERATIONS.has(request?.operation)) throw fail('studio_core_request_invalid', 'This operation does not belong to the placement structure interface.');
  if (!supportsStudioCoreCompositionPlacements()) throw unavailable();
  const patch = dispatch(request, COMPOSITION_PLACEMENTS_OPERATIONS, (result, input) => {
    const invalid = () => { throw new Error('Rust core returned malformed placement structure data.'); };
    const same = (a, b) => {
      if (a === b) return true;
      if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false;
      const keys = Object.keys(a); return keys.length === Object.keys(b).length && keys.every(key => Object.hasOwn(b, key) && same(a[key], b[key]));
    };
    const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
    const removing = input.operation === 'sceneComposition.removePlacement', copying = input.operation === 'sceneComposition.copyPlacement', patch = result.compositionPatch;
    const required = ['protocolVersion', 'operation', 'content', 'placementId', ...(removing ? [] : [copying ? 'sourcePlacementId' : 'fragmentId', 'actorIds', 'groupIds'])];
    if (!record(result, ['protocolVersion', 'ok', 'compositionPatch']) || !record(patch, ['afterContent', 'changedPaths'])
      || !input || typeof input !== 'object' || required.some(key => !Object.hasOwn(input,key))
      || Object.keys(input).some(key => !required.includes(key) && !(input.operation === 'sceneComposition.addPlacement' && key === 'offset'))
      || !uuid(input.placementId) || typeof input.content !== 'string' || encoder.encode(input.content).length > 128 * 1024
      || typeof patch.afterContent !== 'string' || encoder.encode(patch.afterContent).length > 128 * 1024 || !Array.isArray(patch.changedPaths) || patch.changedPaths.length !== 1) invalid();
    const before = JSON.parse(input.content.replace(/^\uFEFF/, '')), after = JSON.parse(patch.afterContent.replace(/^\uFEFF/, ''));
    if (!Array.isArray(before.placements) || !Array.isArray(before.fragments)) invalid();
    let index;
    if (removing) {
      index = before.placements.findIndex(placement => placement.placementId === input.placementId);
      if (index < 0 || before.placements.length < 2) invalid();
      before.placements.splice(index, 1);
    } else {
      const original = copying ? before.placements.find(placement => placement.placementId === input.sourcePlacementId) : null;
      if (copying && (!uuid(input.sourcePlacementId) || !original)) invalid();
      const fragmentId = copying ? original.fragmentId : input.fragmentId, fragment = before.fragments.find(fragment => fragment.fragmentId === fragmentId);
      if (!fragment) invalid();
      const used = new Set(before.placements.flatMap(placement => [placement.placementId,...Object.values(placement.actorIds),...Object.values(placement.groupIds)]));
      if (used.has(input.placementId)) invalid(); used.add(input.placementId);
      for (const [name,declarations] of [['actorIds',fragment.actors],['groupIds',fragment.groups]]) {
        const map = input[name]; if (!map || typeof map !== 'object' || Array.isArray(map) || Object.keys(map).length !== declarations.length) invalid();
        for (const declaration of declarations) { const id = map[declaration.key]; if (!uuid(id) || used.has(id)) invalid(); used.add(id); }
      }
      const placement = copying ? { ...original, placementId:input.placementId, actorIds:input.actorIds, groupIds:input.groupIds }
        : { placementId:input.placementId, fragmentId, actorIds:input.actorIds, groupIds:input.groupIds, ...(Object.hasOwn(input,'offset') ? { offset:input.offset } : {}) };
      index = before.placements.length; before.placements.push(placement);
    }
    if (patch.changedPaths[0] !== `/placements/${index}` || patch.afterContent === input.content || !same(before,after)) invalid();
  }).compositionPatch;
  try {
    dispatchStudioCoreComposition({ protocolVersion: STUDIO_CORE_PROTOCOL_VERSION, operation: 'sceneComposition.expand', content: request.content });
    dispatchStudioCoreComposition({ protocolVersion: STUDIO_CORE_PROTOCOL_VERSION, operation: 'sceneComposition.expand', content: patch.afterContent });
  } catch (error) { runtime = null; loadError = error; throw unavailable(); }
  return patch;
}

/** Optional organizational group authoring, separate from placement/actor edits. */
export function supportsStudioCoreCompositionGroups() {
  return Boolean(runtime && typeof runtime.viento_core_scene_composition_groups_version === 'function'
    && runtime.viento_core_scene_composition_groups_version() === 1);
}
export function dispatchStudioCoreCompositionGroups(request) {
  assertJson(request);
  if (!COMPOSITION_GROUPS_OPERATIONS.has(request?.operation)) throw fail('studio_core_request_invalid','This operation does not belong to the shared group interface.');
  if (!supportsStudioCoreCompositionGroups()) throw unavailable();
  const patch = dispatch(request,COMPOSITION_GROUPS_OPERATIONS,(result,input)=>{
    const invalid=()=>{throw new Error('Rust core returned malformed shared group data.');};
    const same=(a,b)=>{if(a===b)return true;if(!a||!b||typeof a!=='object'||typeof b!=='object'||Array.isArray(a)!==Array.isArray(b))return false;const keys=Object.keys(a);return keys.length===Object.keys(b).length&&keys.every(key=>Object.hasOwn(b,key)&&same(a[key],b[key]));};
    const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
    const localKey=value=>typeof value==='string'&&/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(value);
    const operations={ 'sceneComposition.addFragmentGroup':['group','instances'],'sceneComposition.editFragmentGroup':['groupKey','name','parentKey'],
      'sceneComposition.assignFragmentActorGroup':['actorKey','groupKey'],'sceneComposition.removeFragmentGroup':['groupKey'] };
    const patch=result.compositionPatch;
    if(!record(result,['protocolVersion','ok','compositionPatch'])||!record(patch,['afterContent','changedPaths'])
      ||!record(input,['protocolVersion','operation','content','fragmentId',...operations[input.operation]])||!localKey(input.fragmentId)
      ||typeof input.content!=='string'||encoder.encode(input.content).length>128*1024||typeof patch.afterContent!=='string'||encoder.encode(patch.afterContent).length>128*1024
      ||!Array.isArray(patch.changedPaths)||patch.changedPaths.length>129)invalid();
    const before=JSON.parse(input.content.replace(/^\uFEFF/,'')),after=JSON.parse(patch.afterContent.replace(/^\uFEFF/,''));
    const index=before.fragments?.findIndex(fragment=>fragment.fragmentId===input.fragmentId);
    if(!Number.isInteger(index)||index<0||!Array.isArray(before.placements))invalid();
    const fragment=before.fragments[index],related=before.placements.flatMap((placement,index)=>placement.fragmentId===input.fragmentId?[{placement,index}]:[]),paths=[];
    if(input.operation==='sceneComposition.addFragmentGroup') {
      const group=input.group;
      if(!group||typeof group!=='object'||Array.isArray(group)||!localKey(group.key)||!Object.hasOwn(group,'name')
        ||Object.keys(group).some(key=>!['key','name','parentKey'].includes(key))||fragment.groups.some(item=>item.key===group.key)
        ||!Array.isArray(input.instances)||input.instances.length!==related.length)invalid();
      const identities=new Set(before.placements.flatMap(placement=>[placement.placementId,...Object.values(placement.actorIds),...Object.values(placement.groupIds)]));
      paths.push(`/fragments/${index}/groups/${fragment.groups.length}`);fragment.groups.push(group);
      related.forEach(({placement,index:placementIndex},targetIndex)=>{const instance=input.instances[targetIndex];
        if(!record(instance,['placementId','groupId'])||instance.placementId!==placement.placementId||!uuid(instance.groupId)||identities.has(instance.groupId))invalid();
        identities.add(instance.groupId);placement.groupIds[group.key]=instance.groupId;paths.push(`/placements/${placementIndex}/groupIds/${group.key}`);
      });
    } else if(input.operation==='sceneComposition.assignFragmentActorGroup') {
      const actorIndex=fragment.actors.findIndex(actor=>actor.key===input.actorKey),group=input.groupKey;
      if(!localKey(input.actorKey)||actorIndex<0||!(group===null||localKey(group)))invalid();
      const actor=fragment.actors[actorIndex];
      if(group===null?Object.hasOwn(actor,'groupKey'):actor.groupKey!==group) {
        if(group===null)delete actor.groupKey;else actor.groupKey=group;
        paths.push(`/fragments/${index}/actors/${actorIndex}/groupKey`);
      }
    } else {
      const groupIndex=fragment.groups.findIndex(group=>group.key===input.groupKey);
      if(!localKey(input.groupKey)||groupIndex<0)invalid();
      const group=fragment.groups[groupIndex];
      if(input.operation==='sceneComposition.editFragmentGroup') {
        if(typeof input.name!=='string'||!(input.parentKey===null||localKey(input.parentKey)))invalid();
        if(group.name!==input.name){group.name=input.name;paths.push(`/fragments/${index}/groups/${groupIndex}/name`);}
        if(input.parentKey===null?Object.hasOwn(group,'parentKey'):group.parentKey!==input.parentKey) {
          if(input.parentKey===null)delete group.parentKey;else group.parentKey=input.parentKey;
          paths.push(`/fragments/${index}/groups/${groupIndex}/parentKey`);
        }
      } else {
        if(fragment.actors.some(actor=>actor.groupKey===input.groupKey)||fragment.groups.some(group=>group.parentKey===input.groupKey))invalid();
        fragment.groups.splice(groupIndex,1);paths.push(`/fragments/${index}/groups/${groupIndex}`);
        for(const {placement,index:placementIndex} of related){delete placement.groupIds[input.groupKey];paths.push(`/placements/${placementIndex}/groupIds/${input.groupKey}`);}
      }
    }
    if(!same(paths,patch.changedPaths)||!same(before,after)||(paths.length===0)!==(patch.afterContent===input.content))invalid();
  }).compositionPatch;
  try {
    dispatchStudioCoreComposition({protocolVersion:STUDIO_CORE_PROTOCOL_VERSION,operation:'sceneComposition.expand',content:request.content});
    dispatchStudioCoreComposition({protocolVersion:STUDIO_CORE_PROTOCOL_VERSION,operation:'sceneComposition.expand',content:patch.afterContent});
  } catch(error){runtime=null;loadError=error;throw unavailable();}
  return patch;
}

/** Optional raw fragment definition management; no generated identities or placement edits. */
export function supportsStudioCoreCompositionDefinitions() {
  return Boolean(runtime && typeof runtime.viento_core_scene_composition_definitions_version === 'function'
    && runtime.viento_core_scene_composition_definitions_version() === 1);
}
export function dispatchStudioCoreCompositionDefinitions(request) {
  assertJson(request);
  if (!COMPOSITION_DEFINITIONS_OPERATIONS.has(request?.operation)) throw fail('studio_core_request_invalid', 'This operation does not belong to the fragment definition interface.');
  if (!supportsStudioCoreCompositionDefinitions()) throw unavailable();
  const patch = dispatch(request, COMPOSITION_DEFINITIONS_OPERATIONS, (result, input) => {
    const invalid = () => { throw new Error('Rust core returned malformed fragment definition data.'); };
    const same = (a, b) => { if (a === b) return true; if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false; const keys = Object.keys(a); return keys.length === Object.keys(b).length && keys.every(key => Object.hasOwn(b, key) && same(a[key], b[key])); };
    const key = value => typeof value === 'string' && /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(value);
    const fields = { 'sceneComposition.addFragmentDefinition': ['fragment'], 'sceneComposition.copyFragmentDefinition': ['sourceFragmentId', 'fragmentId'], 'sceneComposition.removeFragmentDefinition': ['fragmentId'] };
    const patch = result.compositionPatch;
    if (!record(result, ['protocolVersion', 'ok', 'compositionPatch']) || !record(patch, ['afterContent', 'changedPaths'])
      || !record(input, ['protocolVersion', 'operation', 'content', ...fields[input.operation]])
      || typeof input.content !== 'string' || encoder.encode(input.content).length > 128 * 1024
      || typeof patch.afterContent !== 'string' || encoder.encode(patch.afterContent).length > 128 * 1024
      || !Array.isArray(patch.changedPaths) || patch.changedPaths.length !== 1 || patch.afterContent === input.content) invalid();
    const before = JSON.parse(input.content.replace(/^\uFEFF/, '')), after = JSON.parse(patch.afterContent.replace(/^\uFEFF/, ''));
    if (!Array.isArray(before.fragments) || !Array.isArray(before.placements)) invalid();
    const id = input.operation === 'sceneComposition.addFragmentDefinition' ? input.fragment?.fragmentId : input.fragmentId;
    if (!key(id)) invalid();
    let index;
    if (input.operation === 'sceneComposition.removeFragmentDefinition') {
      index = before.fragments.findIndex(fragment => fragment.fragmentId === id);
      if (index < 0 || before.fragments.length < 2 || before.placements.some(placement => placement.fragmentId === id)) invalid();
      before.fragments.splice(index, 1);
    } else {
      if (before.fragments.some(fragment => fragment.fragmentId === id)) invalid();
      index = before.fragments.length;
      let fragment;
      if (input.operation === 'sceneComposition.copyFragmentDefinition') {
        if (!key(input.sourceFragmentId)) invalid();
        const original = before.fragments.find(fragment => fragment.fragmentId === input.sourceFragmentId);
        if (!original) invalid();
        fragment = JSON.parse(JSON.stringify(original)); fragment.fragmentId = id;
      } else {
        if (!record(input.fragment, ['fragmentId', 'actors', 'groups']) || !Array.isArray(input.fragment.actors)
          || !input.fragment.actors.length || !Array.isArray(input.fragment.groups)) invalid();
        fragment = input.fragment;
      }
      before.fragments.push(fragment);
    }
    if (patch.changedPaths[0] !== `/fragments/${index}` || !same(before, after)) invalid();
  }).compositionPatch;
  try {
    dispatchStudioCoreComposition({ protocolVersion: STUDIO_CORE_PROTOCOL_VERSION, operation: 'sceneComposition.expand', content: request.content });
    dispatchStudioCoreComposition({ protocolVersion: STUDIO_CORE_PROTOCOL_VERSION, operation: 'sceneComposition.expand', content: patch.afterContent });
  } catch (error) { runtime = null; loadError = error; throw unavailable(); }
  return patch;
}

/** Independently optional identity rename. Only identity value tokens may differ;
 * the token inventory verifies byte preservation without parsing source paths. */
export function supportsStudioCoreCompositionDefinitionRename() {
  return Boolean(runtime && typeof runtime.viento_core_scene_composition_definition_rename_version === 'function'
    && runtime.viento_core_scene_composition_definition_rename_version() === 1);
}
export function dispatchStudioCoreCompositionDefinitionRename(request) {
  assertJson(request);
  if (!COMPOSITION_DEFINITION_RENAME_OPERATIONS.has(request?.operation)) throw fail('studio_core_request_invalid', 'This operation does not belong to the fragment rename interface.');
  if (!supportsStudioCoreCompositionDefinitionRename()) throw unavailable();
  const patch = dispatch(request, COMPOSITION_DEFINITION_RENAME_OPERATIONS, (result, input) => {
    const invalid = () => { throw new Error('Rust core returned malformed fragment rename data.'); };
    const same = (a, b) => { if (a === b) return true; if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false; const keys = Object.keys(a); return keys.length === Object.keys(b).length && keys.every(key => Object.hasOwn(b, key) && same(a[key], b[key])); };
    const key = value => typeof value === 'string' && /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(value);
    const patch = result.compositionPatch;
    if (!record(result, ['protocolVersion', 'ok', 'compositionPatch']) || !record(patch, ['afterContent', 'changedPaths'])
      || !record(input, ['protocolVersion', 'operation', 'content', 'fragmentId', 'newFragmentId'])
      || typeof input.content !== 'string' || encoder.encode(input.content).length > 128 * 1024
      || typeof patch.afterContent !== 'string' || encoder.encode(patch.afterContent).length > 128 * 1024
      || !Array.isArray(patch.changedPaths) || !key(input.fragmentId) || !key(input.newFragmentId)) invalid();
    const before = JSON.parse(input.content.replace(/^\uFEFF/, '')), after = JSON.parse(patch.afterContent.replace(/^\uFEFF/, ''));
    if (!Array.isArray(before.fragments) || !Array.isArray(before.placements)) invalid();
    const index = before.fragments.findIndex(fragment => fragment.fragmentId === input.fragmentId);
    if (index < 0) invalid();
    const paths = [];
    if (input.fragmentId !== input.newFragmentId) {
      if (before.fragments.some(fragment => fragment.fragmentId === input.newFragmentId)) invalid();
      before.fragments[index].fragmentId = input.newFragmentId; paths.push(`/fragments/${index}/fragmentId`);
      for (const [index, placement] of before.placements.entries()) {
        if (placement.fragmentId === input.fragmentId) { placement.fragmentId = input.newFragmentId; paths.push(`/placements/${index}/fragmentId`); }
      }
    }
    if (!same(paths, patch.changedPaths) || !same(before, after) || (paths.length === 0) !== (input.content === patch.afterContent)) invalid();
    if (!paths.length) return;
    // Inventory JSON string tokens only. JSON.parse above owns syntax and
    // semantic validation; no source-path parser or host dependency is used.
    const inventory = content => {
      const strings = [], between = []; let last = 0;
      for (let index = 0; index < content.length; index++) {
        if (content[index] !== '"') continue;
        const start = index; between.push(content.slice(last, start));
        for (index++; index < content.length; index++) { if (content[index] === '\\') { index++; continue; } if (content[index] === '"') break; }
        strings.push(content.slice(start, index + 1)); last = index + 1;
      }
      between.push(content.slice(last)); return { strings, between };
    };
    const original = inventory(input.content), changed = inventory(patch.afterContent);
    if (!same(original.between, changed.between) || original.strings.length !== changed.strings.length) invalid();
    let count = 0;
    for (let index = 0; index < original.strings.length; index++) {
      if (original.strings[index] === changed.strings[index]) continue;
      if (JSON.parse(original.strings[index]) !== input.fragmentId || changed.strings[index] !== JSON.stringify(input.newFragmentId)) invalid();
      count++;
    }
    if (count !== paths.length) invalid();
  }).compositionPatch;
  try {
    dispatchStudioCoreComposition({ protocolVersion: STUDIO_CORE_PROTOCOL_VERSION, operation: 'sceneComposition.expand', content: request.content });
    dispatchStudioCoreComposition({ protocolVersion: STUDIO_CORE_PROTOCOL_VERSION, operation: 'sceneComposition.expand', content: patch.afterContent });
  } catch (error) { runtime = null; loadError = error; throw unavailable(); }
  return patch;
}

/** Read-only recipe CST locations. Shares the optional definitions ABI, while
 * keeping the three author edits and their patch receipts separate. */
export function dispatchStudioCoreCompositionDefinitionLocations(request) {
  assertJson(request);
  if (!COMPOSITION_DEFINITION_LOCATION_OPERATIONS.has(request?.operation)) throw fail('studio_core_request_invalid', 'This operation does not belong to the definition location interface.');
  if (!supportsStudioCoreCompositionDefinitions()) throw unavailable();
  const response = dispatch(request, COMPOSITION_DEFINITION_LOCATION_OPERATIONS, (result, input) => {
    const invalid = () => { throw new Error('Rust core returned malformed definition source locations.'); };
    const pointer = value => typeof value === 'string' && (value === '' || value.startsWith('/')) && !/~(?:[^01]|$)/.test(value);
    const same = (a, b) => { if (a === b) return true; if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false; const keys = Object.keys(a); return keys.length === Object.keys(b).length && keys.every(key => Object.hasOwn(b, key) && same(a[key], b[key])); };
    if (!record(result, ['protocolVersion', 'ok', 'compositionLocations']) || !record(result.compositionLocations, ['locations'])
      || !record(input, ['protocolVersion', 'operation', 'content', 'paths']) || typeof input.content !== 'string'
      || encoder.encode(input.content).length > 128 * 1024 || !Array.isArray(input.paths) || input.paths.length > 4096
      || input.paths.some(path => !pointer(path) || encoder.encode(path).length > 4096) || new Set(input.paths).size !== input.paths.length
      || !Array.isArray(result.compositionLocations.locations) || result.compositionLocations.locations.length !== input.paths.length) invalid();
    const root = JSON.parse(input.content.replace(/^\uFEFF/, '')), ranges = new Map();
    const container = value => value !== null && typeof value === 'object';
    const boundary = offset => !(offset > 0 && offset < input.content.length
      && input.content.charCodeAt(offset) >= 0xdc00 && input.content.charCodeAt(offset) <= 0xdfff
      && input.content.charCodeAt(offset - 1) >= 0xd800 && input.content.charCodeAt(offset - 1) <= 0xdbff);
    for (const [index, range] of result.compositionLocations.locations.entries()) {
      const parts = input.paths[index] === '' ? [] : input.paths[index].slice(1).split('/').map(part => part.replaceAll('~1', '/').replaceAll('~0', '~'));
      let value = root, nearest = { value: root, count: 0 }, exact = true, count = parts.length;
      for (const [index, part] of parts.entries()) {
        if (!container(value) || !Object.hasOwn(value, part) || Array.isArray(value) && !/^(?:0|[1-9][0-9]*)$/.test(part)) {
          value = nearest.value; count = nearest.count; exact = false; break;
        }
        value = value[part];
        if (container(value)) nearest = { value, count: index + 1 };
      }
      const propertyPath = parts.slice(0, count).map(part => '/' + part.replaceAll('~', '~0').replaceAll('/', '~1')).join('');
      if (!record(range, ['propertyPath', 'start', 'end', 'encoding', 'exact']) || range.propertyPath !== propertyPath || range.exact !== exact
        || range.encoding !== 'utf-16' || !Number.isSafeInteger(range.start) || !Number.isSafeInteger(range.end)
        || range.start < 0 || range.end <= range.start || range.end > input.content.length || !boundary(range.start) || !boundary(range.end)) invalid();
      const key = `${range.start}:${range.end}`;
      if (!ranges.has(key)) {
        const token = input.content.slice(range.start, range.end);
        if (token.trim() !== token) invalid();
        ranges.set(key, JSON.parse(token));
      }
      if (!same(ranges.get(key), value)) invalid();
    }
  }).compositionLocations;
  try { dispatchStudioCoreComposition({ protocolVersion: STUDIO_CORE_PROTOCOL_VERSION, operation: 'sceneComposition.expand', content: request.content }); }
  catch (error) { runtime = null; loadError = error; throw unavailable(); }
  return response;
}

/** Independently optional 3D primitive source parsing. Rust owns admission and
 * CST parsing; this boundary binds a complete detached receipt to its source. */
export function supportsStudioCoreScene3D() {
  return Boolean(runtime && typeof runtime.viento_core_scene3d_version === 'function' && runtime.viento_core_scene3d_version() === 1);
}
export function dispatchStudioCoreScene3D(request) {
  assertJson(request);
  if (request?.operation !== 'scene3d.parse') throw fail('studio_core_request_invalid', 'This operation does not belong to the 3D scene interface.');
  if (!supportsStudioCoreScene3D()) throw unavailable();
  return dispatch(request, new Set(['scene3d.parse']), (result, input) => {
    const invalid = () => { throw new Error('Rust core returned malformed 3D scene data.'); };
    const same = (a, b) => { if (a === b) return true; if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false; const keys = Object.keys(a); return keys.length === Object.keys(b).length && keys.every(key => Object.hasOwn(b, key) && same(a[key], b[key])); };
    const number = (value, min, max) => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
    const triple = (value, min, max) => Array.isArray(value) && value.length === 3 && value.every(item => number(item, min, max));
    const name = value => typeof value === 'string' && Array.from(value).length >= 1 && Array.from(value).length <= 256;
    const color = value => typeof value === 'string' && /^#[a-fA-F0-9]{6}$/.test(value);
    const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
    const direction = (value, minimum) => { const horizontal = Math.hypot(value[0], value[2]), length = Math.hypot(horizontal, value[1]); return length > 0 && length >= minimum && horizontal / length >= 1e-4; };
    const keys = ['format', 'schemaVersion', 'name', 'viewport', 'background', 'camera', 'light', 'objects'];
    if (!record(result, ['protocolVersion', 'ok', 'scene3d']) || !record(input, ['protocolVersion', 'operation', 'content'])
      || typeof input.content !== 'string' || encoder.encode(input.content).length > 128 * 1024 || !record(result.scene3d, ['model', 'sourceLocations'])) invalid();
    const original = JSON.parse(input.content.replace(/^\uFEFF/, '')), { model, sourceLocations } = result.scene3d;
    if (!record(original, keys) || original.format !== 'viento-scene3d' || original.schemaVersion !== 1 || !record(model, keys)
      || model.format !== 'viento-scene3d-model' || model.schemaVersion !== 1 || !name(model.name) || !color(model.background)
      || !Array.isArray(model.viewport) || model.viewport.length !== 2 || !model.viewport.every(item => Number.isInteger(item) && number(item, 1, 8192))) invalid();
    const camera = model.camera, light = model.light;
    if (!record(camera, ['position', 'target', 'fovDegrees', 'near', 'far']) || !triple(camera.position, -100000, 100000) || !triple(camera.target, -100000, 100000)
      || !direction(camera.target.map((value, index) => value - camera.position[index]), 0.01) || !number(camera.fovDegrees, 1, 179)
      || !number(camera.near, 0.001, 10000) || !number(camera.far, 0.001, 100000) || camera.far - camera.near < 0.001 || camera.far < camera.near * 1.01
      || !record(light, ['direction', 'color', 'energy']) || !triple(light.direction, -100000, 100000) || !direction(light.direction, 0)
      || !color(light.color) || !number(light.energy, 0, 16) || !Array.isArray(model.objects) || model.objects.length < 1 || model.objects.length > 128) invalid();
    const ids = new Set();
    for (const object of model.objects) {
      if (!record(object, ['instanceId', 'name', 'primitive', 'position', 'rotationDegrees', 'size', 'color']) || !uuid(object.instanceId) || ids.has(object.instanceId)
        || !name(object.name) || object.primitive !== 'box' || !triple(object.position, -100000, 100000) || !triple(object.rotationDegrees, -36000, 36000)
        || !triple(object.size, 0.001, 1000) || !color(object.color)) invalid();
      ids.add(object.instanceId);
    }
    original.format = 'viento-scene3d-model'; original.schemaVersion = 1;
    if (!same(original, model) || !record(sourceLocations, ['objects']) || !Array.isArray(sourceLocations.objects) || sourceLocations.objects.length !== model.objects.length) invalid();
    const split = index => index > 0 && index < input.content.length && input.content.charCodeAt(index - 1) >= 0xd800 && input.content.charCodeAt(index - 1) <= 0xdbff && input.content.charCodeAt(index) >= 0xdc00 && input.content.charCodeAt(index) <= 0xdfff;
    let end = 0;
    for (const [index, location] of sourceLocations.objects.entries()) {
      if (!record(location, ['instanceId', 'propertyPath', 'sourceRange']) || location.instanceId !== model.objects[index].instanceId || location.propertyPath !== `/objects/${index}`) invalid();
      const range = location.sourceRange;
      if (!record(range, ['start', 'end', 'encoding', 'exact']) || !Number.isSafeInteger(range.start) || !Number.isSafeInteger(range.end)
        || range.start < end || range.end <= range.start || range.end > input.content.length || range.encoding !== 'utf-16' || range.exact !== true || split(range.start) || split(range.end)) invalid();
      const token = input.content.slice(range.start, range.end);
      if (!token.startsWith('{') || !token.endsWith('}') || !same(JSON.parse(token), model.objects[index])) invalid();
      end = range.end;
    }
  }).scene3d;
}
