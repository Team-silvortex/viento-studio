// A creation helper prepares ordinary author source. Rust owns recipe rules;
// the document editor alone owns registration and durable saving.
import { expandSceneComposition } from './scene-composition.mjs';
import { getCreatePathError, conflictsWithSourcePath } from './document-contract.mjs';
import { canonicalJson } from './canonical-json.mjs';

export const SCENE_COMPOSITION_CREATE_API_PATH = '/api/scene-composition-create';
// Limit only the creation assistant; authored recipe and runtime limits stay in Rust.
export const SCENE_COMPOSITION_CREATE_MAX_ACTORS = 64;
const proposals = new WeakMap();
const error = (kind = 'invalid') => Object.assign(new TypeError('The composition draft does not match its current creation context.'), { errorCode: `composition_authoring_${kind}` });
const fail = () => { throw error(); };
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const revision = value => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
const text = (value, max) => typeof value === 'string' && value.length > 0 && value.length <= max;
const reserved = new Set(['__proto__', 'constructor', 'prototype']);
const keys = value => Object.keys(value);
function exact(value, expected) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || keys(value).length !== expected.length || expected.some(key => !Object.hasOwn(value, key))) fail();
}
// Detach data descriptors before reading any nested values or invoking Rust.
// A catalog is bounded independently of its workspace's full source bytes.
function capture(input) {
  let nodes = 0, bytes = 0;
  const seen = new Set();
  const copy = (value, depth = 0) => {
    if (++nodes > 400000 || depth > 8) fail();
    if (typeof value === 'string') {
      if (value.length > 4096 || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value)
        || (bytes += new TextEncoder().encode(value).length) > 16 * 1024 * 1024) fail();
      return value;
    }
    if (typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value)) return value;
    if (!value || typeof value !== 'object' || seen.has(value)) fail();
    const array = Array.isArray(value), prototype = Object.getPrototypeOf(value);
    if (prototype !== (array ? Array.prototype : Object.prototype) && prototype !== null) fail();
    const descriptors = Object.getOwnPropertyDescriptors(value), names = Reflect.ownKeys(descriptors);
    if (names.some(key => typeof key !== 'string' || reserved.has(key) || !Object.hasOwn(descriptors[key], 'value')
      || !(array && key === 'length') && !descriptors[key].enumerable)) fail();
    seen.add(value);
    let result;
    if (array) {
      const length = descriptors.length?.value;
      if (!Number.isSafeInteger(length) || length < 0 || length > 100000 || names.length !== length + 1) fail();
      result = [];
      for (let index = 0; index < length; index++) { if (!Object.hasOwn(descriptors, index)) fail(); result.push(copy(descriptors[index].value, depth + 1)); }
    } else {
      if (names.length > 32) fail();
      result = {};
      for (const key of names) result[key] = copy(descriptors[key].value, depth + 1);
    }
    seen.delete(value); return result;
  };
  return copy(input);
}
const relative = value => text(value, 4096) && !value.includes('\\') && !/^[a-z]:/i.test(value) && !/[\x00-\x1f\x7f]/.test(value)
  && !value.split('/').some(part => !part || part === '.' || part === '..');
function types(value) {
  if (!Array.isArray(value) || !value.length || value.length > 256) fail();
  const ids = new Set();
  for (const type of value) {
    exact(type, ['id', 'label']);
    if (typeof type.id !== 'string' || !/^[a-z][a-z0-9_-]{0,63}$/.test(type.id) || reserved.has(type.id) || !text(type.label, 4096) || ids.has(type.id)) fail();
    ids.add(type.id);
  }
}
function editor(input) {
  const value = capture(input); exact(value, ['sourceToken', 'documentRoot', 'documentTypes']);
  if (!text(value.sourceToken, 256) || !text(value.documentRoot, 900) || value.documentRoot.split('/')[0] === 'docs-standard'
    || getCreatePathError(`${value.documentRoot}/recipe.json`)) fail();
  types(value.documentTypes); return value;
}
export function validateCompositionCreateCatalog(input) {
  const value = capture(input);
  exact(value, ['format', 'schemaVersion', 'worldId', 'worldRevision', 'documentRoot', 'documentTypes', 'existingPaths', 'existingIdentities', 'objects']);
  if (value.format !== 'viento-scene-composition-create-context' || value.schemaVersion !== 1 || !text(value.worldId, 200)
    || !revision(value.worldRevision)) fail();
  editor({ sourceToken: 'catalog', documentRoot: value.documentRoot, documentTypes: value.documentTypes });
  if (!Array.isArray(value.existingPaths) || value.existingPaths.length > 50000 || value.existingPaths.some(path => !relative(path))
    || new Set(value.existingPaths).size !== value.existingPaths.length || !Array.isArray(value.existingIdentities)
    || value.existingIdentities.some(id => !uuid(id)) || new Set(value.existingIdentities).size !== value.existingIdentities.length
    || !Array.isArray(value.objects) || value.objects.length > 50000) fail();
  const ids = new Set(), paths = new Set(), identities = new Set(value.existingIdentities), existingPaths = new Set(value.existingPaths);
  for (const object of value.objects) {
    exact(object, ['id', 'name', 'sourcePath', 'sourceRevision', 'canInheritProjection']);
    if (!uuid(object.id) || ids.has(object.id) || !text(object.name, 160) || !relative(object.sourcePath) || paths.has(object.sourcePath)
      || !revision(object.sourceRevision) || typeof object.canInheritProjection !== 'boolean' || !identities.has(object.id) || !existingPaths.has(object.sourcePath)) fail();
    ids.add(object.id); paths.add(object.sourcePath);
  }
  return freeze(value);
}
const singleRequestKeys = ['documentType', 'sourcePath', 'title', 'fragmentId', 'actorKey', 'objectId', 'useProjectionDefaults', 'position', 'viewport', 'background', 'placementId', 'instanceId'];
const multiRequestKeys = ['documentType', 'sourcePath', 'title', 'fragmentId', 'viewport', 'background', 'placementId', 'actors'];
const actorRequestKeys = ['actorKey', 'objectId', 'useProjectionDefaults', 'position', 'instanceId'];
const requestKeys = value => Object.hasOwn(value, 'actors') ? multiRequestKeys : singleRequestKeys;
function prepare(current, catalog, input) {
  const request = capture(input); exact(request, requestKeys(request));
  const inputs = Object.hasOwn(request, 'actors') ? request.actors
    : [Object.fromEntries(actorRequestKeys.map(key => [key, request[key]]))];
  if (!Array.isArray(inputs) || inputs.length < 1 || inputs.length > SCENE_COMPOSITION_CREATE_MAX_ACTORS) fail();
  if (current.documentRoot !== catalog.documentRoot || canonicalJson(current.documentTypes) !== canonicalJson(catalog.documentTypes)) throw error('conflict');
  if (!catalog.documentTypes.some(type => type.id === request.documentType) || !text(request.sourcePath, 1024)
    || !request.sourcePath.startsWith(`${current.documentRoot}/`) || !/\.json$/i.test(request.sourcePath) || getCreatePathError(request.sourcePath)) fail();
  if (catalog.existingPaths.some(path => conflictsWithSourcePath(request.sourcePath, path))) throw error('path_conflict');
  const identities = new Set(catalog.existingIdentities), actorKeys = new Set();
  const objects = new Map(catalog.objects.map(object => [object.id, object]));
  if (!uuid(request.placementId) || identities.has(request.placementId)) fail();
  identities.add(request.placementId);
  const actors = [], actorIds = {};
  for (const input of inputs) {
    exact(input, actorRequestKeys);
    const object = objects.get(input.objectId);
    if (!object || typeof input.actorKey !== 'string' || reserved.has(input.actorKey) || actorKeys.has(input.actorKey)
      || typeof input.useProjectionDefaults !== 'boolean' || input.useProjectionDefaults && !object.canInheritProjection
      || !uuid(input.instanceId) || identities.has(input.instanceId)) fail();
    actorKeys.add(input.actorKey); identities.add(input.instanceId);
    actors.push({ key: input.actorKey, objectId: input.objectId, position: input.position,
      ...(input.useProjectionDefaults ? { useProjectionDefaults: true } : { size: [64, 64], color: '#87d8b9', speed: 160, controls: 'arrows' }) });
    actorIds[input.actorKey] = input.instanceId;
  }
  const source = { format: 'viento-scene-composition', schemaVersion: 1,
    scene: { title: request.title, viewport: request.viewport, background: request.background },
    fragments: [{ fragmentId: request.fragmentId, actors, groups: [] }],
    placements: [{ placementId: request.placementId, fragmentId: request.fragmentId, actorIds, groupIds: {} }] };
  const content = JSON.stringify(source, null, 2) + '\n';
  try { expandSceneComposition(content); } catch { fail(); }
  return { request, content };
}
export function prepareCompositionDraft(editorContext, inputCatalog, input) {
  const current = editor(editorContext), catalog = validateCompositionCreateCatalog(inputCatalog);
  const { request, content } = prepare(current, catalog, input);
  const proposal = freeze({ format: 'viento-scene-composition-draft', schemaVersion: 1, ...current,
    worldId: catalog.worldId, worldRevision: catalog.worldRevision, ...request, content });
  proposals.set(proposal, catalog); return proposal;
}
export function isCompositionDraftProposal(value) { return Boolean(value && typeof value === 'object' && proposals.has(value)); }
export function prepareCompositionDraftApply(editorContext, inputCatalog, proposal) {
  if (!isCompositionDraftProposal(proposal)) throw error('conflict');
  try {
    const current = editor(editorContext), catalog = validateCompositionCreateCatalog(inputCatalog), original = proposals.get(proposal);
    if (canonicalJson(current) !== canonicalJson({ sourceToken: proposal.sourceToken, documentRoot: proposal.documentRoot, documentTypes: proposal.documentTypes })
      || canonicalJson(catalog) !== canonicalJson(original)) throw error('conflict');
    const { content } = prepare(current, catalog, Object.fromEntries(requestKeys(proposal).map(key => [key, proposal[key]])));
    if (content !== proposal.content) throw error('conflict');
    return freeze({ documentType: proposal.documentType, sourcePath: proposal.sourcePath, content });
  } catch { throw error('conflict'); }
}
