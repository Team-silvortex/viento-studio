// First audio opt-in is a closed three-file World mutation. This module owns
// declarations and registration receipts; hosts verify PCM bytes without copying
// or changing media. Recovery uses frozen dependency evidence only.
import { validateWorldCommand } from './world-command-contract.mjs';
import { prepareObjectCreate } from './world-object-create.mjs';
import { appendRecordItem } from './world-record-edit.mjs';
import { createWorldProjection, canonicalJson } from './world-projection.mjs';
import { inspectSceneAudio } from './scene-audio-core.mjs';
import { resolveSceneAudio } from './scene-audio.mjs';
import { createScene2DPlan } from './build-plan.mjs';
import { validateSceneCreateRegistration } from './world-scene-create.mjs';
import { validateDocumentModels } from './document-model.mjs';
import { parseJsonSource } from './json-source.mjs';
import { normalizeSourcePath } from './source-path.mjs';
import { createError } from './service-error.mjs';

export const AUDIO_CREATE_RECOVERY_LIMITS = Object.freeze({ bytes: 32 * 1024 * 1024,
  sceneBytes: 8 * 1024 * 1024, definitionBytes: 8 * 1024 * 1024, definitions: 128, resources: 16, resourceRecordBytes: 65536 });
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const revision = value => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
const compare = (a, b) => a.objectId < b.objectId ? -1 : a.objectId > b.objectId ? 1 : 0;
const same = (a, b) => canonicalJson(a) === canonicalJson(b);
const diagnostic = (message, propertyPath = '', details = {}) => ({ severity: 'error', code: 'build_audio_invalid', message, propertyPath, ...details });
const invalid = (message, diagnostics = []) => { throw createError(422, message, { diagnostics }, 'world_audio_invalid'); };
const conflict = () => { throw createError(409, 'World or scene changed; refresh and preview again', {}, 'world_revision_conflict'); };
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
const utf8Length = text => {
  if (typeof text !== 'string' || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(text)) return Infinity;
  return new TextEncoder().encode(text).length;
};
const readable = document => document?.record?.format === 'viento-document' && document.record.version === 1
  && uuid(document.record.id) && document.record.sourcePath === document.sourcePath
  && typeof document.sourcePath === 'string' && normalizeSourcePath(document.sourcePath) === document.sourcePath
  && typeof document.content === 'string' && revision(document.sourceRevision);
const linked = (record, id) => record.relations?.some(relation => typeof relation.kind === 'string' && relation.kind !== 'part-of' && relation.targetId === id);

function sceneFacts(source, sceneObjectId, manifestId = null) {
  const scene = source.documents.find(document => document.record?.id === sceneObjectId);
  if (!readable(scene) || !scene.sourcePath.toLowerCase().endsWith('.json')) invalid('An available registered Scene2D document is required');
  const optIns = (scene.record.relations || []).filter(relation => relation.kind === 'audio');
  if (manifestId === null ? optIns.length !== 0 : optIns.length !== 1 || optIns[0].targetId !== manifestId) {
    invalid('First audio creation requires a scene without a audio declaration', [diagnostic('The scene already has a audio relation.', '/sceneObjectId')]);
  }
  const parsed = parseJsonSource(scene.content), value = parsed.value;
  if (!parsed.ok || value?.format !== 'viento-scene2d' || ![2, 3].includes(value.schemaVersion)
    || !Array.isArray(value.actors) || value.actors.length < 1 || value.actors.length > 128
    || value.actors.some(actor => !uuid(actor?.instanceId) || !uuid(actor?.objectId))
    || new Set(value.actors.map(actor => actor.instanceId)).size !== value.actors.length) {
    invalid('Audio requires an unambiguous Scene2D schemaVersion 2 or 3', parsed.diagnostics);
  }
  const definitions = new Map();
  for (const actor of value.actors) {
    const definition = source.documents.find(document => document.record?.id === actor.objectId);
    if (!readable(definition) || actor.objectId === sceneObjectId || actor.objectId === manifestId || !linked(scene.record, actor.objectId)) {
      invalid('Every scene instance requires an available linked definition', [diagnostic('Register a nonownership scene-to-definition dependency.', '/sceneObjectId',
        { relatedObjectId: actor.objectId, instanceId: actor.instanceId })]);
    }
    definitions.set(actor.objectId, definition);
  }
  return { scene, instances: value.actors.map(({ instanceId, objectId }) => ({ instanceId, objectId })), definitions: [...definitions.values()] };
}

function checkedManifest(content) {
  const parsed = parseJsonSource(content);
  if (!parsed.ok || utf8Length(content) > 32768) invalid('The audio declaration must be complete bounded JSON', parsed.diagnostics);
  try { return inspectSceneAudio(parsed.value).document; } catch { invalid('The audio declaration is invalid'); }
}
// Readonly admission also recognizes an existing manifest for safe navigation
// and convergence after an uncertain save; preparation below only permits empty.
export function inspectAudioCreateScene(source, projection, sceneObjectId) {
  if (![2, 3].includes(source.workspace?.version)) invalid('Audio creation requires a registered workspace');
  const scene = source.documents.find(document => document.record?.id === sceneObjectId);
  const selected = (scene?.record?.relations || []).filter(relation => relation.kind === 'audio');
  if (selected.length > 1) invalid('A scene may select only one audio declaration');
  const manifest = selected.length ? source.documents.find(document => document.record?.id === selected[0].targetId) : null;
  if (selected.length && !readable(manifest)) invalid('The selected audio declaration is unavailable');
  const facts = sceneFacts(source, sceneObjectId, manifest?.record.id ?? null);
  const checked = createScene2DPlan({ source, projection }, sceneObjectId);
  if (!checked.ok) invalid('The existing scene is invalid', checked.diagnostics);
  return { scene: facts.scene, definitions: facts.definitions, manifest };
}
export function audioCreateRegistration(record, value) {
  return { ...record, relations: [{ kind: 'references', targetId: value.sceneObjectId, slot: '' }],
    assetBindings: [...new Set(value.tracks.map(track => track.resourceId))].sort().map(assetId => ({ assetId, role: 'audio' })) };
}

export function appendSceneAudioRelation(content, manifestId) {
  if (typeof content !== 'string' || !uuid(manifestId)) invalid('Invalid scene audio registration');
  // JSON.parse owns values; the existing insertion helper preserves unrelated
  // metadata bytes, including extension numbers, escapes and CRLF layout.
  let before;
  try { before = JSON.parse(content.replace(/^\uFEFF/, '')); } catch { invalid('Invalid scene registration'); }
  if (!before || before.format !== 'viento-document' || before.version !== 1 || !uuid(before.id) || before.id === manifestId
    || before.relations !== undefined && !Array.isArray(before.relations)
    || (before.relations || []).some(relation => relation?.kind === 'audio')) invalid('The scene already has a audio declaration or invalid registration');
  const bom = content.startsWith('\uFEFF') ? '\uFEFF' : '';
  const edit = appendRecordItem(content.slice(bom.length), 'relations', { kind: 'audio', targetId: manifestId, slot: '' });
  return { ...edit, afterContent: bom + edit.afterContent };
}

// Both mutated registrations have exact before/after images. The remaining
// registry must be identical through every possible partial publish state.
export function audioCreationRegistryGuard(registry, manifestId, sceneId) {
  const byId = (a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  return canonicalJson({ documents: registry.documents.filter(record => ![manifestId, sceneId].includes(record.id)).sort(byId),
    assets: [...registry.assets].sort(byId) });
}

function evidenceSnapshot(input) {
  let sourceBytes = 0;
  const exact = (value, keys) => {
    if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new TypeError('Expected dependency data');
    const descriptors = Object.getOwnPropertyDescriptors(value), names = Reflect.ownKeys(descriptors);
    if (names.length !== keys.length || names.some(key => typeof key !== 'string' || !keys.includes(key)
      || !descriptors[key].enumerable || !Object.hasOwn(descriptors[key], 'value'))) throw new TypeError('Invalid dependency data fields');
    return Object.fromEntries(keys.map(key => [key, descriptors[key].value]));
  };
  const entry = (value, limit) => {
    const result = exact(value, ['objectId', 'sourcePath', 'sourceRevision', 'content']);
    if (!uuid(result.objectId) || !revision(result.sourceRevision) || typeof result.sourcePath !== 'string' || result.sourcePath.length > 4096
      || normalizeSourcePath(result.sourcePath) !== result.sourcePath || utf8Length(result.sourcePath) === Infinity
      || typeof result.content !== 'string' || result.content.length > limit) throw new TypeError('Invalid dependency source');
    const bytes = utf8Length(result.content);
    if (bytes > limit || (sourceBytes += bytes) > AUDIO_CREATE_RECOVERY_LIMITS.bytes) throw new TypeError('Dependency evidence exceeds transaction budget');
    return result;
  };
  const list = (value, limit, capture) => {
    if (!Array.isArray(value) || value.length > limit || Object.getPrototypeOf(value) !== Array.prototype) throw new TypeError('Invalid dependency list');
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Reflect.ownKeys(descriptors).length !== value.length + 1) throw new TypeError('Invalid dependency list fields');
    return Array.from({ length: value.length }, (_, index) => { const d = descriptors[index]; if (!d?.enumerable || !Object.hasOwn(d, 'value')) throw new TypeError('Invalid dependency item'); return capture(d.value); });
  };
  const safeRecord = value => {
    const ancestors = new Set(); let nodes = 0;
    const copy = (v, depth = 0) => {
      if (++nodes > 4096 || depth > 8) throw new TypeError('Unbounded asset metadata');
      if (v === null || typeof v === 'boolean' || typeof v === 'number' && Number.isFinite(v)) return v;
      if (typeof v === 'string' && utf8Length(v) <= AUDIO_CREATE_RECOVERY_LIMITS.resourceRecordBytes) return v;
      if (!v || typeof v !== 'object' || ancestors.has(v)) throw new TypeError('Invalid asset metadata');
      const array = Array.isArray(v), proto = Object.getPrototypeOf(v), ds = Object.getOwnPropertyDescriptors(v);
      if (proto !== (array ? Array.prototype : Object.prototype) && proto !== null) throw new TypeError('Invalid asset metadata');
      const keys = Reflect.ownKeys(ds), length = array ? ds.length.value : 0;
      if (array && (length > 256 || keys.length !== length + 1)) throw new TypeError('Invalid asset list');
      ancestors.add(v); const out = array ? [] : {};
      for (const key of array ? Array.from({ length }, (_, i) => String(i)) : keys) {
        const d = ds[key]; if (typeof key !== 'string' || ['__proto__', 'constructor', 'prototype'].includes(key) || !d?.enumerable || !Object.hasOwn(d, 'value')) throw new TypeError('Invalid asset metadata');
        out[key] = copy(d.value, depth + 1);
      }
      ancestors.delete(v); return out;
    };
    const record = copy(value); if (utf8Length(JSON.stringify(record)) > AUDIO_CREATE_RECOVERY_LIMITS.resourceRecordBytes) throw new TypeError('Asset metadata exceeds budget'); return record;
  };
  const raw = exact(input, ['scene', 'definitions', 'resources']), limits = AUDIO_CREATE_RECOVERY_LIMITS;
  const result = { scene: entry(raw.scene, limits.sceneBytes), definitions: list(raw.definitions, limits.definitions, value => entry(value, limits.definitionBytes)),
    resources: list(raw.resources, limits.resources, value => { const row = exact(value, ['resourceId', 'resourceRevision', 'record']);
      if (!uuid(row.resourceId) || !revision(row.resourceRevision)) throw new TypeError('Invalid resource identity'); return { ...row, record: safeRecord(row.record) }; }) };
  const documents = [result.scene, ...result.definitions];
  if (!result.resources.length || new Set(documents.map(item => item.objectId)).size !== documents.length || new Set(documents.map(item => item.sourcePath)).size !== documents.length
    || new Set(result.resources.map(item => item.resourceId)).size !== result.resources.length) throw new TypeError('Duplicate dependency');
  if (utf8Length(JSON.stringify(result)) > limits.bytes) throw new TypeError('Dependency evidence exceeds transaction budget');
  return result;
}

// Recovery consumes frozen document and resource registrations only. It never
// reads or restores current audio, scene or actor bytes.
export async function validateAudioCreateRecovery(manifestRecord, manifestContent, sceneRecord, input, registry, { digest }) {
  try {
    const recovery = evidenceSnapshot(input), value = checkedManifest(manifestContent);
    if (manifestRecord?.format !== 'viento-document' || manifestRecord.version !== 1 || !uuid(manifestRecord.id)
      || !same(Object.keys(manifestRecord).sort(), ['format', 'version', 'id', 'sourcePath', 'documentType', 'parserProfile', 'relations', 'assetBindings'].sort())
      || typeof manifestRecord.sourcePath !== 'string' || normalizeSourcePath(manifestRecord.sourcePath) !== manifestRecord.sourcePath
      || !manifestRecord.sourcePath.toLowerCase().endsWith('.json') || !same(manifestRecord, audioCreateRegistration(manifestRecord, value))
      || sceneRecord?.id !== value.sceneObjectId || recovery.scene.objectId !== value.sceneObjectId) throw new TypeError('Invalid audio registrations');
    const records = [...registry.documents.filter(record => ![sceneRecord.id, manifestRecord.id].includes(record.id)), sceneRecord, manifestRecord];
    validateDocumentModels(records);
    const byId = new Map(records.map(record => [record.id, record])), documents = new Map();
    for (const item of [recovery.scene, ...recovery.definitions]) {
      const record = byId.get(item.objectId);
      if (!record || record.sourcePath !== item.sourcePath || item.objectId === manifestRecord.id || `sha256:${await digest(item.content)}` !== item.sourceRevision) throw new TypeError('Dependency evidence does not match its registration or hash');
      documents.set(item.objectId, { record, ...item });
    }
    const source = { documents: [...documents.values()], assets: [] }, facts = sceneFacts(source, value.sceneObjectId, manifestRecord.id);
    if (!same(recovery.definitions.map(item => item.objectId).sort(), [...new Set(facts.instances.map(item => item.objectId))].sort())) throw new TypeError('Unexpected actor evidence');
    const expected = [...new Set(value.tracks.map(track => track.resourceId))].sort();
    if (!same(recovery.resources.map(item => item.resourceId).sort(), expected)) throw new TypeError('Unexpected audio evidence');
    for (const item of recovery.resources) {
      if (item.record?.id !== item.resourceId || item.record?.format !== 'viento-asset' || item.record.version !== 1
        || !same(item.record, registry.assets.find(record => record.id === item.resourceId))
        || `sha256:${await digest(canonicalJson(item.record))}` !== item.resourceRevision) throw new TypeError('Audio evidence does not match its registration');
      source.assets.push({ record: item.record, availability: 'present-unverified' });
    }
    source.documents.push({ record: manifestRecord, sourcePath: manifestRecord.sourcePath, sourceRevision: `sha256:${await digest(manifestContent)}`, content: manifestContent });
    const registration = validateSceneCreateRegistration(sceneRecord, recovery.scene.content, { ...registry, documents: records });
    const audio = resolveSceneAudio({ source }, { schemaVersion: 2, scene: { objectId: value.sceneObjectId } });
    const diagnostics = [...registration.diagnostics, ...audio.diagnostics];
    return { ok: diagnostics.length === 0, diagnostics };
  } catch (error) { return { ok: false, diagnostics: error.payload?.diagnostics?.length ? error.payload.diagnostics : [diagnostic('Invalid frozen audio creation dependencies.')] }; }
}

export async function prepareAudioCreate(source, projection, sceneRecordContent, rawRequest, { digest }) {
  const request = validateWorldCommand(rawRequest);
  if (request.command !== 'audio.create') throw createError(400, 'Expected audio.create', {}, 'world_command_invalid');
  if (projection.world.id !== request.worldId || projection.world.revision !== request.baseRevision) conflict();
  const sceneObject = projection.objects.find(object => object.id === request.sceneObjectId);
  if (!sceneObject || sceneObject.revision !== request.sceneObjectRevision || sceneObject.documentRefs[0]?.sourceRevision !== request.sceneSourceRevision) conflict();
  const { scene, manifest } = inspectAudioCreateScene(source, projection, request.sceneObjectId);
  if (manifest) invalid('The scene already has an audio declaration');
  if (`sha256:${await digest(scene.content)}` !== request.sceneSourceRevision) conflict();
  if (!request.sourcePath.toLowerCase().endsWith('.json')) invalid('An audio declaration requires a JSON source path');
  const value = checkedManifest(request.content);
  if (value.sceneObjectId !== request.sceneObjectId) invalid('The audio declaration belongs to another scene');
  const { sceneObjectId, sceneObjectRevision, sceneSourceRevision, ...createRequest } = request;
  const base = await prepareObjectCreate(source, projection, { ...createRequest, command: 'object.create' }, { digest });
  const record = audioCreateRegistration(base.result.changes[0].record, value);
  const metadata = appendSceneAudioRelation(sceneRecordContent, record.id);
  if (!same(metadata.before, scene.record)) conflict();
  const nextSource = { ...base.nextSource, documents: base.nextSource.documents.map(document => document.record?.id === record.id
    ? { ...document, record, descriptor: { ...document.descriptor, ...record } }
    : document.record?.id === scene.record.id ? { ...document, record: metadata.after, descriptor: { ...document.descriptor, relations: metadata.after.relations } } : document) };
  try { validateDocumentModels(nextSource.documents.filter(document => document.record).map(document => document.record)); }
  catch { invalid('The audio registrations are invalid'); }
  const next = await createWorldProjection(nextSource, { digest }), build = createScene2DPlan({ source: nextSource, projection: next }, scene.record.id);
  if (!build.ok) invalid('The audio scene is invalid', build.diagnostics);
  const describe = document => ({ objectId: document.record.id, sourcePath: document.sourcePath, sourceRevision: document.sourceRevision, content: document.content });
  const facts = sceneFacts(source, scene.record.id), resourceIds = [...new Set(value.tracks.map(track => track.resourceId))].sort();
  let audioRecovery;
  try { audioRecovery = evidenceSnapshot({ scene: describe(scene), definitions: facts.definitions.map(describe).sort(compare),
    resources: resourceIds.map(resourceId => ({ resourceId, resourceRevision: projection.resources.find(item => item.id === resourceId)?.revision,
      record: source.assets.find(item => item.record?.id === resourceId)?.record })) }); }
  catch { invalid('The audio creation dependencies exceed the recoverable transaction budget'); }
  const registry = { documents: source.documents.filter(document => document.record).map(document => document.record), assets: (source.assets || []).map(asset => asset.record) };
  const recoveryCheck = await validateAudioCreateRecovery(record, request.content, metadata.after, audioRecovery, registry, { digest });
  if (!recoveryCheck.ok) invalid('The audio dependencies cannot be safely recovered', recoveryCheck.diagnostics);
  const { mode, ...input } = request, preconditionIds = [...new Set([scene.record.id, ...facts.definitions.map(document => document.record.id)])].sort();
  const proposal = { ...base.result.proposal, id: `proposal:${await digest(canonicalJson(input))}`,
    commands: [{ id: request.command, input }], affectedObjects: [record.id, scene.record.id],
    preconditions: preconditionIds.map(objectId => ({ objectId, revision: projection.objects.find(object => object.id === objectId).revision })) };
  const change = { ...base.result.changes[0], kind: 'audio.create', record };
  const recordContent = `${JSON.stringify(record, null, 2)}\n`, recordPath = `metadata/documents/${scene.record.id}.json`;
  const relation = { kind: 'audio', targetId: record.id, slot: '' };
  const relationChange = { kind: 'relation.add', objectId: scene.record.id, sourcePath: scene.sourcePath,
    targetObjectId: record.id, targetSourcePath: request.sourcePath, recordPath, relation,
    beforeRecordRevision: `sha256:${await digest(sceneRecordContent)}`, afterRecordRevision: `sha256:${await digest(metadata.afterContent)}` };
  return { kind: 'audio.create', nextSource, audioRecovery: freeze(audioRecovery),
    registryHash: `sha256:${await digest(audioCreationRegistryGuard(registry, record.id, scene.record.id))}`,
    plans: [{ ...base.plans[0], change }, { ...base.plans[1], afterContent: recordContent,
      change: { ...base.plans[1].change, afterSourceRevision: `sha256:${await digest(recordContent)}` } },
    { sourcePath: recordPath, beforeContent: sceneRecordContent, afterContent: metadata.afterContent,
      change: { objectId: scene.record.id, beforeSourceRevision: relationChange.beforeRecordRevision, afterSourceRevision: relationChange.afterRecordRevision } }],
    result: { ...base.result, revision: next.world.revision, proposal, changes: [change, relationChange],
      object: next.objects.find(object => object.id === record.id), scene: next.objects.find(object => object.id === scene.record.id),
      relation: next.relations.find(item => item.sourceObjectId === scene.record.id && item.targetObjectId === record.id && item.properties.kind === 'audio') } };
}
