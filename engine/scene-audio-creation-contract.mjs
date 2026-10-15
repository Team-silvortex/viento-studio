// Portable creation directory/request/receipt boundary. No IO or identity allocation.
import { canonicalJson } from './canonical-json.mjs';
import { getCreatePathError, portablePath } from './document-contract.mjs';
import { validateWorldCommand } from './world-command-contract.mjs';
import { parseJsonSource } from './json-source.mjs';
import { inspectSceneAudio } from './scene-audio-core.mjs';
export const SCENE_AUDIO_CREATION_API_PATH = '/api/scene-audio-creation';
const invalid = () => { throw Object.assign(new TypeError('Invalid scene audio creation context or result.'), { errorCode: 'scene_audio_creation_invalid' }); };
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const revision = value => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
const taggedHash = (value, tag) => typeof value === 'string' && new RegExp(`^${tag}:[a-f0-9]{64}$`).test(value);
const malformedText = value => /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value);
const text = (value, limit) => typeof value === 'string' && value.length > 0 && value.length <= limit && !malformedText(value);
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
const same = (actual, expected) => { if (canonicalJson(actual) !== canonicalJson(expected)) invalid(); };
const guard = action => { try { return action(); } catch { invalid(); } };
function exact(value, keys) { if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) invalid(); }
function capture(input) {
  let nodes = 0, characters = 0;
  const ancestors = new Set();
  const copy = (value, depth = 0) => {
    if (++nodes > 32768 || depth > 16) invalid();
    if (typeof value === 'string') {
      if (value.length > 32768 || (characters += value.length) > 1048576 || malformedText(value)) invalid();
      return value;
    }
    if (value === null || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value)) return value;
    if (!value || typeof value !== 'object' || ancestors.has(value)) invalid();
    const array = Array.isArray(value), prototype = Object.getPrototypeOf(value);
    if (prototype !== (array ? Array.prototype : Object.prototype) && prototype !== null) invalid();
    const length = array ? Object.getOwnPropertyDescriptor(value, 'length')?.value : 0;
    if (array && (!Number.isSafeInteger(length) || length < 0 || length > 256)) invalid();
    const keys = Reflect.ownKeys(value);
    if (array ? keys.length !== length + 1 : keys.length > 2048) invalid();
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

function audioDocument(content) {
  if (!text(content, 32768) || new TextEncoder().encode(content).length > 32768) invalid();
  const parsed = parseJsonSource(content); if (!parsed.ok) invalid(); return inspectSceneAudio(parsed.value).document;
}
function dependencies(content) {
  const document = audioDocument(content);
  return { document, relations: [{ kind: 'references', targetId: document.sceneObjectId, slot: '' }],
    assetBindings: [...new Set(document.tracks.map(track => track.resourceId))].sort().map(assetId => ({ assetId, role: 'audio' })) };
}
function context(input, sceneObjectId) {
  const value = capture(input);
  exact(value, ['format', 'schemaVersion', 'status', 'worldId', 'baseRevision', 'documentRoot', 'documentTypes', 'scene', 'manifest', 'resources']);
  if (value.format !== 'viento-audio-creation-context' || value.schemaVersion !== 1 || !['empty', 'ready'].includes(value.status)
    || !taggedHash(value.worldId, 'world') || !revision(value.baseRevision) || !text(value.documentRoot, 900)
    || getCreatePathError(`${value.documentRoot}/audio.json`) || !Array.isArray(value.documentTypes) || !value.documentTypes.length
    || !Array.isArray(value.resources)) invalid();
  const types = new Set();
  for (const type of value.documentTypes) { exact(type, ['id', 'label']); if (!/^[a-z][a-z0-9_-]{0,63}$/.test(type.id) || !text(type.label, 160) || types.has(type.id)) invalid(); types.add(type.id); }
  const describe = (item, extra = []) => {
    exact(item, ['objectId', 'objectRevision', 'sourcePath', 'sourceRevision', ...extra]);
    if (!uuid(item.objectId) || !revision(item.objectRevision) || !revision(item.sourceRevision)
      || !text(item.sourcePath, 1024) || !item.sourcePath.startsWith(value.documentRoot + '/') || !/\.json$/i.test(item.sourcePath) || getCreatePathError(item.sourcePath)) invalid();
  };
  describe(value.scene); if (sceneObjectId !== undefined && sceneObjectId !== value.scene.objectId) invalid();
  const ids = new Set(), paths = new Set();
  for (const resource of value.resources) {
    exact(resource, ['resourceId', 'resourceRevision', 'name', 'sourcePath', 'sha256', 'size', 'availability']);
    if (!uuid(resource.resourceId) || !revision(resource.resourceRevision) || !text(resource.name, 160)
      || !text(resource.sourcePath, 1024) || !/\.wav$/i.test(resource.sourcePath) || !portablePath(resource.sourcePath) || resource.sourcePath.split('/').some(part => new TextEncoder().encode(part).length > 255)
      || !/^[a-f0-9]{64}$/.test(resource.sha256) || !Number.isSafeInteger(resource.size) || resource.size < 44 || resource.size > 32 * 1024 * 1024
      || resource.availability !== 'unverified' || ids.has(resource.resourceId) || paths.has(resource.sourcePath)) invalid();
    ids.add(resource.resourceId); paths.add(resource.sourcePath);
  }
  if (value.status === 'empty') { if (value.manifest !== null) invalid(); }
  else {
    describe(value.manifest, ['documentType', 'parserProfile', 'content', 'relations', 'assetBindings', 'trackCount']);
    const m = value.manifest, declared = dependencies(m.content);
    if (m.objectId === value.scene.objectId || m.sourcePath === value.scene.sourcePath || !types.has(m.documentType) || !text(m.parserProfile, 64)
      || m.trackCount !== declared.document.tracks.length || declared.document.sceneObjectId !== value.scene.objectId) invalid();
    if (!Array.isArray(m.relations) || !Array.isArray(m.assetBindings)) invalid();
    // Existing metadata may carry author annotations. The descriptor-safe capture
    // already bounds and retains them; only new creation/confirmation is exact.
    const record = item => item !== null && typeof item === 'object' && !Array.isArray(item);
    for (const relation of m.relations) { if (!record(relation) || typeof relation.kind !== 'string' || !relation.kind.trim() || !uuid(relation.targetId) || Object.hasOwn(relation, 'slot') && typeof relation.slot !== 'string') invalid(); }
    for (const binding of m.assetBindings) { if (!record(binding) || !uuid(binding.assetId) || typeof binding.role !== 'string') invalid(); }
    if (!m.relations.some(relation => relation.kind !== 'part-of' && relation.targetId === value.scene.objectId)
      || declared.assetBindings.some(binding => !m.assetBindings.some(item => item.assetId === binding.assetId))) invalid();
  }
  return freeze(value);
}
export function captureSceneAudioCreationContext(value, sceneObjectId) {
  return guard(() => { if (!uuid(sceneObjectId)) invalid(); return context(value, sceneObjectId); });
}
export function createSceneAudioCreationRequest(input, draft, mode = 'preview') {
  return guard(() => {
    const catalog = context(input), value = capture(draft); exact(value, ['objectId', 'documentType', 'sourcePath', 'content']);
    if (catalog.status !== 'empty' || !catalog.documentTypes.some(type => type.id === value.documentType)
      || !uuid(value.objectId) || value.objectId === catalog.scene.objectId || catalog.resources.some(resource => resource.resourceId === value.objectId)
      || !text(value.sourcePath, 1024) || !value.sourcePath.startsWith(catalog.documentRoot + '/') || !/\.json$/i.test(value.sourcePath) || getCreatePathError(value.sourcePath)) invalid();
    const { document } = dependencies(value.content);
    if (document.sceneObjectId !== catalog.scene.objectId || document.tracks.some(track => !catalog.resources.some(resource => resource.resourceId === track.resourceId))) invalid();
    return freeze(validateWorldCommand({ command: 'audio.create', mode, worldId: catalog.worldId, baseRevision: catalog.baseRevision,
      actorRef: { kind: 'user', id: 'studio-audio-create' }, ...value, sceneObjectId: catalog.scene.objectId,
      sceneObjectRevision: catalog.scene.objectRevision, sceneSourceRevision: catalog.scene.sourceRevision }));
  });
}
export function confirmSceneAudioCreation(input, requested, sourceRevision) {
  return guard(() => {
    const catalog = context(input), request = validateWorldCommand(capture(requested));
    if (request.command !== 'audio.create' || !revision(sourceRevision)) invalid();
    const m = catalog.manifest; if (catalog.status !== 'ready' || !m) return false;
    const declared = dependencies(request.content);
    return catalog.worldId === request.worldId && catalog.scene.objectId === request.sceneObjectId && catalog.scene.sourceRevision === request.sceneSourceRevision
      && m.objectId === request.objectId && m.sourcePath === request.sourcePath && m.sourceRevision === sourceRevision && m.content === request.content
      && m.documentType === request.documentType && canonicalJson(m.relations) === canonicalJson(declared.relations)
      && canonicalJson(m.assetBindings) === canonicalJson(declared.assetBindings);
  });
}
export function validateSceneAudioCreationResult(result, requested, input, sourceRevision) {
  return guard(() => {
    const catalog = context(input), request = validateWorldCommand(capture(requested)), value = capture(result), applying = request.mode === 'apply';
    const expectedRequest = createSceneAudioCreationRequest(catalog, Object.fromEntries(['objectId','documentType','sourcePath','content'].map(key => [key, request[key]])), request.mode); same(request, expectedRequest);
    exact(value, ['status', 'worldId', 'baseRevision', 'revision', 'proposal', 'changes', 'object', 'scene', 'relation', ...(applying ? ['receipt'] : [])]);
    if (!revision(sourceRevision) || value.status !== (applying ? 'applied' : 'preview') || value.worldId !== request.worldId || value.baseRevision !== request.baseRevision
      || !revision(value.revision) || value.revision === value.baseRevision || !Array.isArray(value.changes) || value.changes.length !== 2) invalid();
    const first = value.changes[0], relation = value.changes[1], declared = dependencies(request.content), expectedRelation = { kind: 'audio', targetId: request.objectId, slot: '' };
    exact(first, ['kind', 'objectId', 'sourcePath', 'beforeSourceRevision', 'afterSourceRevision', 'beforeText', 'afterText', 'recordPath', 'record']);
    if (!text(first.record?.parserProfile, 64)) invalid();
    const record = { format: 'viento-document', version: 1, id: request.objectId, sourcePath: request.sourcePath,
      documentType: request.documentType, parserProfile: first.record.parserProfile, relations: declared.relations, assetBindings: declared.assetBindings };
    same(first, { kind: 'audio.create', objectId: request.objectId, sourcePath: request.sourcePath, beforeSourceRevision: null, afterSourceRevision: sourceRevision,
      beforeText: null, afterText: request.content, recordPath: `metadata/documents/${request.objectId}.json`, record });
    exact(relation, ['kind', 'objectId', 'sourcePath', 'targetObjectId', 'targetSourcePath', 'recordPath', 'relation', 'beforeRecordRevision', 'afterRecordRevision']);
    if (!revision(relation.beforeRecordRevision) || !revision(relation.afterRecordRevision) || relation.beforeRecordRevision === relation.afterRecordRevision) invalid();
    same(relation, { kind: 'relation.add', objectId: request.sceneObjectId, sourcePath: catalog.scene.sourcePath, targetObjectId: request.objectId,
      targetSourcePath: request.sourcePath, recordPath: `metadata/documents/${request.sceneObjectId}.json`, relation: expectedRelation,
      beforeRecordRevision: relation.beforeRecordRevision, afterRecordRevision: relation.afterRecordRevision });
    if (value.object?.format !== 'viento-object' || value.object.schemaVersion !== 1 || value.object.id !== request.objectId || value.object.worldId !== request.worldId
      || !revision(value.object.revision) || value.object.typeRef !== `io.viento.document/${request.documentType}`) invalid();
    same(value.object.documentRefs, [{ sourcePath: request.sourcePath, sourceRevision }]); same(value.object.provenance?.descriptor, record);
    if (value.scene?.id !== request.sceneObjectId || value.scene.worldId !== request.worldId || !revision(value.scene.revision)
      || value.scene.revision === request.sceneObjectRevision || value.scene.provenance?.descriptor?.id !== request.sceneObjectId) invalid();
    same(value.scene.documentRefs, [{ sourcePath: catalog.scene.sourcePath, sourceRevision: request.sceneSourceRevision }]);
    same(value.scene.provenance.descriptor.relations.filter(item => item.kind === 'audio'), [expectedRelation]);
    exact(value.relation, ['id', 'worldId', 'sourceObjectId', 'targetObjectId', 'typeRef', 'properties']);
    if (!taggedHash(value.relation.id, 'relation')) invalid();
    same(value.relation, { id: value.relation.id, worldId: request.worldId, sourceObjectId: request.sceneObjectId, targetObjectId: request.objectId,
      typeRef: 'io.viento.relation/audio', properties: expectedRelation });
    const p = value.proposal, { mode, ...commandInput } = request;
    exact(p, ['format', 'schemaVersion', 'id', 'worldId', 'actorRef', 'baseRevision', 'commands', 'preconditions', 'affectedObjects', 'state']);
    if (!taggedHash(p.id, 'proposal') || !Array.isArray(p.preconditions) || !p.preconditions.length || p.preconditions.length > 129
      || new Set(p.preconditions.map(item => item.objectId)).size !== p.preconditions.length
      || !p.preconditions.some(item => item.objectId === request.sceneObjectId && item.revision === request.sceneObjectRevision)) invalid();
    for (const precondition of p.preconditions) { exact(precondition, ['objectId', 'revision']); if (!uuid(precondition.objectId) || !revision(precondition.revision) || precondition.objectId === request.objectId) invalid(); }
    same(p, { format: 'viento-changeset', schemaVersion: 1, id: p.id, worldId: request.worldId, actorRef: request.actorRef, baseRevision: request.baseRevision,
      commands: [{ id: 'audio.create', input: commandInput }], preconditions: p.preconditions, affectedObjects: [request.objectId, request.sceneObjectId], state: 'proposed' });
    if (applying) { const receipt = value.receipt; exact(receipt, ['format', 'schemaVersion', 'transactionId', 'worldId', 'proposalId', 'baseRevision', 'revision', 'state']);
      if (!uuid(receipt.transactionId)) invalid(); same(receipt, { format: 'viento-transaction-receipt', schemaVersion: 1, transactionId: receipt.transactionId,
        worldId: request.worldId, proposalId: p.id, baseRevision: request.baseRevision, revision: value.revision, state: 'committed' }); }
    return freeze(value);
  });
}
