// Read-only directory data and an existing metadata-only World command. This
// module owns no source reads, writes, identity allocation or script execution.
import { canonicalJson } from './canonical-json.mjs';
import { getCreatePathError } from './document-contract.mjs';
import { SCENE_BEHAVIOR_LIMITS } from './scene-behaviors.mjs';

export const SCENE_BEHAVIOR_DIRECTORY_API_PATH = '/api/scene-behavior-directory';
const invalid = () => { throw Object.assign(new TypeError('Invalid scene behavior directory or script-link result.'), { errorCode: 'scene_behavior_directory_invalid' }); };
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const revision = value => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
const taggedHash = (value, tag) => typeof value === 'string' && new RegExp(`^${tag}:[a-f0-9]{64}$`).test(value);
const malformedText = value => /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value);
const text = (value, limit) => typeof value === 'string' && value.length > 0 && value.length <= limit && !malformedText(value);
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
const same = (actual, expected) => { if (canonicalJson(actual) !== canonicalJson(expected)) invalid(); };
const guard = action => { try { return action(); } catch { invalid(); } };
function exact(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) invalid();
}
// Capture descriptors before reading values. Getters, serializers, sparse arrays
// and unbounded collections never participate in validation or its output.
function capture(input) {
  let nodes = 0, characters = 0;
  const ancestors = new Set();
  const copy = (value, depth = 0) => {
    if (++nodes > 8192 || depth > 8) invalid();
    if (typeof value === 'string') {
      if (value.length > 4096 || (characters += value.length) > 524288 || malformedText(value)) invalid();
      return value;
    }
    if (value === null || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value)) return value;
    if (!value || typeof value !== 'object' || ancestors.has(value)) invalid();
    const array = Array.isArray(value), prototype = Object.getPrototypeOf(value);
    if (prototype !== (array ? Array.prototype : Object.prototype) && prototype !== null) invalid();
    const length = array ? Object.getOwnPropertyDescriptor(value, 'length')?.value : 0;
    if (array && (!Number.isSafeInteger(length) || length < 0 || length > 256)) invalid();
    const keys = Reflect.ownKeys(value);
    if (array ? keys.length !== length + 1 : keys.length > 20) invalid();
    const descriptors = new Map();
    for (const key of keys) {
      if (typeof key !== 'string' || key.length > 64 || ['__proto__', 'constructor', 'prototype'].includes(key)) invalid();
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !Object.hasOwn(descriptor, 'value') || !(array && key === 'length') && !descriptor.enumerable) invalid();
      descriptors.set(key, descriptor);
    }
    ancestors.add(value);
    const result = array ? [] : {};
    if (array) for (let index = 0; index < length; index++) {
      if (!descriptors.has(String(index))) invalid();
      result.push(copy(descriptors.get(String(index)).value, depth + 1));
    }
    else for (const key of keys) result[key] = copy(descriptors.get(key).value, depth + 1);
    ancestors.delete(value);
    return result;
  };
  return copy(input);
}
function directory(input, expectedSceneId) {
  const value = capture(input);
  exact(value, ['format', 'schemaVersion', 'status', 'worldId', 'baseRevision', 'documentRoot', 'scene', 'manifest', 'sources']);
  if (value.format !== 'viento-scene-behavior-directory' || value.schemaVersion !== 1 || !['empty', 'ready'].includes(value.status)
    || !taggedHash(value.worldId, 'world') || !revision(value.baseRevision) || !text(value.documentRoot, 900)
    || getCreatePathError(`${value.documentRoot}/manifest.json`) || !Array.isArray(value.sources)) invalid();
  const ids = new Set(), paths = new Set();
  const document = (item, fields, extension) => {
    exact(item, ['objectId', 'objectRevision', 'sourcePath', 'sourceRevision', ...fields]);
    if (!uuid(item.objectId) || !revision(item.objectRevision) || !revision(item.sourceRevision)
      || !text(item.sourcePath, 1024) || !item.sourcePath.startsWith(value.documentRoot + '/')
      || !item.sourcePath.toLowerCase().endsWith(extension) || getCreatePathError(item.sourcePath)
      || ids.has(item.objectId) || paths.has(item.sourcePath)) invalid();
    ids.add(item.objectId); paths.add(item.sourcePath);
  };
  document(value.scene, [], '.json');
  if (expectedSceneId !== undefined && value.scene.objectId !== expectedSceneId) invalid();
  if (value.status === 'empty') {
    if (value.manifest !== null || value.sources.length) invalid();
    return freeze(value);
  }
  document(value.manifest, ['bindingCount'], '.json');
  if (!Number.isSafeInteger(value.manifest.bindingCount) || value.manifest.bindingCount < 1
    || value.manifest.bindingCount > SCENE_BEHAVIOR_LIMITS.bindings || !value.sources.length || value.sources.length > 256) invalid();
  const bindingIds = new Set(); let usedSources = 0;
  for (const source of value.sources) {
    document(source, ['name', 'linked', 'usedByBindingIds'], '.txt');
    if (!text(source.name, 160) || typeof source.linked !== 'boolean' || !Array.isArray(source.usedByBindingIds)
      || source.usedByBindingIds.length > SCENE_BEHAVIOR_LIMITS.bindings) invalid();
    if (source.usedByBindingIds.length) {
      if (!source.linked || ++usedSources > SCENE_BEHAVIOR_LIMITS.sources) invalid();
    }
    for (const bindingId of source.usedByBindingIds) {
      if (!uuid(bindingId) || bindingIds.has(bindingId)) invalid();
      bindingIds.add(bindingId);
    }
  }
  if (bindingIds.size !== value.manifest.bindingCount) invalid();
  return freeze(value);
}
export function captureSceneBehaviorDirectory(value, sceneObjectId) {
  return guard(() => { if (!uuid(sceneObjectId)) invalid(); return directory(value, sceneObjectId); });
}
function linkRequest(catalog, sourceObjectId, mode) {
  if (catalog.status !== 'ready' || !uuid(sourceObjectId) || !['preview', 'apply'].includes(mode)) invalid();
  const source = catalog.sources.find(item => item.objectId === sourceObjectId);
  if (!source || source.linked) invalid();
  return freeze({ command: 'relation.add', mode, worldId: catalog.worldId, baseRevision: catalog.baseRevision,
    objectId: catalog.manifest.objectId, objectRevision: catalog.manifest.objectRevision,
    targetObjectId: source.objectId, targetRevision: source.objectRevision, kind: 'references', slot: '',
    actorRef: { kind: 'user', id: 'studio-behavior-links' } });
}
export function createBehaviorScriptLinkRequest(catalog, sourceObjectId, mode = 'preview') {
  return guard(() => linkRequest(directory(catalog), sourceObjectId, mode));
}
export function validateBehaviorScriptLinkResult(result, requested, catalog) {
  return guard(() => {
    const context = directory(catalog), request = capture(requested), value = capture(result);
    const expected = linkRequest(context, request?.targetObjectId, request?.mode);
    same(request, expected);
    const applying = request.mode === 'apply', source = context.sources.find(item => item.objectId === request.targetObjectId);
    exact(value, ['status', 'worldId', 'baseRevision', 'revision', 'proposal', 'changes', 'relation', ...(applying ? ['receipt'] : [])]);
    if (value.status !== (applying ? 'applied' : 'preview') || value.worldId !== request.worldId || value.baseRevision !== request.baseRevision
      || !revision(value.revision) || value.revision === value.baseRevision || !Array.isArray(value.changes) || value.changes.length !== 1) invalid();
    const change = value.changes[0], relation = { kind: 'references', targetId: source.objectId, slot: '' };
    exact(change, ['kind', 'objectId', 'sourcePath', 'targetObjectId', 'targetSourcePath', 'recordPath', 'relation', 'beforeRecordRevision', 'afterRecordRevision']);
    if (!revision(change.beforeRecordRevision) || !revision(change.afterRecordRevision) || change.beforeRecordRevision === change.afterRecordRevision) invalid();
    same(change, { kind: 'relation.add', objectId: context.manifest.objectId, sourcePath: context.manifest.sourcePath,
      targetObjectId: source.objectId, targetSourcePath: source.sourcePath, recordPath: `metadata/documents/${context.manifest.objectId}.json`, relation,
      beforeRecordRevision: change.beforeRecordRevision, afterRecordRevision: change.afterRecordRevision });
    exact(value.relation, ['id', 'worldId', 'sourceObjectId', 'targetObjectId', 'typeRef', 'properties']);
    if (!taggedHash(value.relation.id, 'relation')) invalid();
    same(value.relation, { id: value.relation.id, worldId: request.worldId, sourceObjectId: request.objectId, targetObjectId: source.objectId,
      typeRef: 'io.viento.relation/references', properties: relation });
    const proposal = value.proposal, { mode, ...input } = request;
    exact(proposal, ['format', 'schemaVersion', 'id', 'worldId', 'actorRef', 'baseRevision', 'commands', 'preconditions', 'affectedObjects', 'state']);
    if (!taggedHash(proposal.id, 'proposal')) invalid();
    same(proposal, { format: 'viento-changeset', schemaVersion: 1, id: proposal.id, worldId: request.worldId,
      actorRef: request.actorRef, baseRevision: request.baseRevision, commands: [{ id: 'relation.add', input }],
      preconditions: [{ objectId: request.objectId, revision: request.objectRevision }, { objectId: request.targetObjectId, revision: request.targetRevision }],
      affectedObjects: [request.objectId, request.targetObjectId], state: 'proposed' });
    if (applying) {
      const receipt = value.receipt;
      exact(receipt, ['format', 'schemaVersion', 'transactionId', 'worldId', 'proposalId', 'baseRevision', 'revision', 'state']);
      if (!uuid(receipt.transactionId)) invalid();
      same(receipt, { format: 'viento-transaction-receipt', schemaVersion: 1, transactionId: receipt.transactionId,
        worldId: request.worldId, proposalId: proposal.id, baseRevision: request.baseRevision, revision: value.revision, state: 'committed' });
    }
    return freeze(value);
  });
}
