// First physics2d opt-in owns three file plans only. Physics2D declarations and
// actor identities are independent of build, renderer, behavior and media IO.
// Recovery validates frozen scene/definition evidence without restoring sources.
import { validateWorldCommand } from './world-command-contract.mjs';
import { prepareObjectCreate } from './world-object-create.mjs';
import { appendRecordItem } from './world-record-edit.mjs';
import { createWorldProjection, canonicalJson } from './world-projection.mjs';
import { inspectScenePhysics2D } from './scene-physics2d-core.mjs';
import { validateDocumentModels } from './document-model.mjs';
import { parseJsonSource } from './json-source.mjs';
import { normalizeSourcePath } from './source-path.mjs';
import { createError } from './service-error.mjs';

export const PHYSICS2D_CREATE_RECOVERY_LIMITS = Object.freeze({ bytes: 32 * 1024 * 1024,
  sceneBytes: 8 * 1024 * 1024, definitionBytes: 8 * 1024 * 1024, definitions: 128 });
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const revision = value => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
const compare = (a, b) => a.objectId < b.objectId ? -1 : a.objectId > b.objectId ? 1 : 0;
const same = (a, b) => canonicalJson(a) === canonicalJson(b);
const diagnostic = (message, propertyPath = '', details = {}) => ({ severity: 'error', code: 'build_physics_invalid', message, propertyPath, ...details });
const invalid = (message, diagnostics = []) => { throw createError(422, message, { diagnostics }, 'world_physics2d_invalid'); };
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
const linked = (record, id) => record.relations?.some(relation => typeof relation.kind === 'string' && relation.kind.trim() && relation.kind !== 'part-of' && relation.targetId === id);

function sceneFacts(source, sceneObjectId, manifestId = null) {
  const scene = source.documents.find(document => document.record?.id === sceneObjectId);
  if (!readable(scene) || !scene.sourcePath.endsWith('.json')) invalid('An available registered Scene2D document is required');
  const optIns = (scene.record.relations || []).filter(relation => relation.kind === 'references' && relation.slot === 'physics2d');
  if (manifestId === null ? optIns.length !== 0 : optIns.length !== 1 || optIns[0].targetId !== manifestId) {
    invalid('First physics2d creation requires a scene without a physics2d declaration', [diagnostic('The scene already has a physics2d relation.', '/sceneObjectId')]);
  }
  const parsed = parseJsonSource(scene.content), value = parsed.value;
  if (!parsed.ok || value?.format !== 'viento-scene2d' || ![2, 3].includes(value.schemaVersion)
    || !Array.isArray(value.actors) || value.actors.length < 1 || value.actors.length > 128
    || value.actors.some(actor => !uuid(actor?.instanceId) || !uuid(actor?.objectId))
    || new Set(value.actors.map(actor => actor.instanceId)).size !== value.actors.length) {
    invalid('Physics2D requires an unambiguous Scene2D schemaVersion 2 or 3', parsed.diagnostics);
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
  if (typeof content !== 'string' || content.length > 65536 || utf8Length(content) > 65536) invalid('The physics2d declaration exceeds its source budget');
  const parsed = parseJsonSource(content);
  if (!parsed.ok) invalid('The physics2d declaration must be complete bounded JSON', parsed.diagnostics);
  try { return inspectScenePhysics2D(parsed.value).document; } catch { invalid('The physics2d declaration is invalid'); }
}
// Authoring owns identity membership only. Effective movement, simulation and
// engine capability checks belong to the independent build preflight.
function membershipDiagnostics(document, instances) {
  const ids = new Set(instances.map(instance => instance.instanceId));
  return document.bodies.flatMap((body, index) => ids.has(body.instanceId) ? [] : [diagnostic(
    'Select a stable instance from this scene.', `/bodies/${index}/instanceId`, { bodyId: body.id, instanceId: body.instanceId })]);
}
// Readonly admission also recognizes an existing manifest for safe navigation
// and convergence after an uncertain save; preparation below only permits empty.
export function inspectPhysics2DCreateScene(source, projection, sceneObjectId) {
  if (![2, 3].includes(source.workspace?.version)) invalid('Physics2D creation requires a registered workspace');
  const scene = source.documents.find(document => document.record?.id === sceneObjectId);
  const selected = (scene?.record?.relations || []).filter(relation => relation.kind === 'references' && relation.slot === 'physics2d');
  if (selected.length > 1) invalid('A scene may select only one physics2d declaration');
  const manifest = selected.length ? source.documents.find(document => document.record?.id === selected[0].targetId) : null;
  if (selected.length && !readable(manifest)) invalid('The selected physics2d declaration is unavailable');
  const facts = sceneFacts(source, sceneObjectId, manifest?.record.id ?? null);
  const objects = new Map(projection.objects.map(object => [object.id, object]));
  if ([facts.scene, ...facts.definitions, ...(manifest ? [manifest] : [])].some(document => {
    const object = objects.get(document.record.id);
    return !object || !revision(object.revision) || object.documentRefs?.[0]?.sourceRevision !== document.sourceRevision;
  })) invalid('Scene and actor definitions must have available registered identities');
  const targets = facts.instances.map(actor => ({ ...actor, name: objects.get(actor.objectId).name,
    sourcePath: facts.definitions.find(document => document.record.id === actor.objectId).sourcePath }));
  if (manifest) {
    const value = checkedManifest(manifest.content);
    if (!manifest.sourcePath.endsWith('.json') || value.sceneObjectId !== sceneObjectId || !manifest.record.relations?.some(relation => relation.kind === 'references' && relation.targetId === sceneObjectId)) {
      invalid('The existing physics2d must reference this scene');
    }
    // Keep navigation available when an old target was removed. Creation and
    // frozen recovery below still require membership of every new body.
  }
  return { ...facts, targets, manifest };
}
export function physics2DCreateRegistration(record, value) {
  return { ...record, relations: [{ kind: 'references', targetId: value.sceneObjectId, slot: '' }],
    assetBindings: [] };
}

export function appendScenePhysics2DRelation(content, manifestId) {
  if (typeof content !== 'string' || !uuid(manifestId)) invalid('Invalid scene physics2d registration');
  // JSON.parse owns values; the existing insertion helper preserves unrelated
  // metadata bytes, including extension numbers, escapes and CRLF layout.
  let before;
  try { before = JSON.parse(content.replace(/^\uFEFF/, '')); } catch { invalid('Invalid scene registration'); }
  if (!before || before.format !== 'viento-document' || before.version !== 1 || !uuid(before.id) || before.id === manifestId
    || before.relations !== undefined && !Array.isArray(before.relations)
    || (before.relations || []).some(relation => relation?.kind === 'references' && relation.slot === 'physics2d')) invalid('The scene already has a physics2d declaration or invalid registration');
  const bom = content.startsWith('\uFEFF') ? '\uFEFF' : '';
  const edit = appendRecordItem(content.slice(bom.length), 'relations', { kind: 'references', targetId: manifestId, slot: 'physics2d' });
  return { ...edit, afterContent: bom + edit.afterContent };
}

// Both mutated registrations have exact before/after images. The remaining
// registry must be identical through every possible partial publish state.
export function physics2DCreationRegistryGuard(registry, manifestId, sceneId) {
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
    if (bytes > limit || (sourceBytes += bytes) > PHYSICS2D_CREATE_RECOVERY_LIMITS.bytes) throw new TypeError('Dependency evidence exceeds transaction budget');
    return result;
  };
  const list = (value, limit, capture) => {
    if (!Array.isArray(value) || value.length > limit || Object.getPrototypeOf(value) !== Array.prototype) throw new TypeError('Invalid dependency list');
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Reflect.ownKeys(descriptors).length !== value.length + 1) throw new TypeError('Invalid dependency list fields');
    return Array.from({ length: value.length }, (_, index) => { const d = descriptors[index]; if (!d?.enumerable || !Object.hasOwn(d, 'value')) throw new TypeError('Invalid dependency item'); return capture(d.value); });
  };
  const raw = exact(input, ['scene', 'definitions']), limits = PHYSICS2D_CREATE_RECOVERY_LIMITS;
  const result = { scene: entry(raw.scene, limits.sceneBytes), definitions: list(raw.definitions, limits.definitions, value => entry(value, limits.definitionBytes)) };
  const documents = [result.scene, ...result.definitions];
  if (new Set(documents.map(item => item.objectId)).size !== documents.length || new Set(documents.map(item => item.sourcePath)).size !== documents.length) throw new TypeError('Duplicate dependency');
  if (utf8Length(JSON.stringify(result)) > limits.bytes) throw new TypeError('Dependency evidence exceeds transaction budget');
  return result;
}

// Recovery consumes frozen scene and actor evidence only. It never reads or
// restores current author sources, physics simulation or unrelated resources.
export async function validatePhysics2DCreateRecovery(manifestRecord, manifestContent, sceneRecord, input, registry, { digest }) {
  try {
    const recovery = evidenceSnapshot(input), value = checkedManifest(manifestContent);
    if (manifestRecord?.format !== 'viento-document' || manifestRecord.version !== 1 || !uuid(manifestRecord.id)
      || !same(Object.keys(manifestRecord).sort(), ['format', 'version', 'id', 'sourcePath', 'documentType', 'parserProfile', 'relations', 'assetBindings'].sort())
      || typeof manifestRecord.sourcePath !== 'string' || normalizeSourcePath(manifestRecord.sourcePath) !== manifestRecord.sourcePath
      || !manifestRecord.sourcePath.endsWith('.json') || !same(manifestRecord, physics2DCreateRegistration(manifestRecord, value))
      || sceneRecord?.id !== value.sceneObjectId || recovery.scene.objectId !== value.sceneObjectId) throw new TypeError('Invalid physics2d registrations');
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
    source.documents.push({ record: manifestRecord, sourcePath: manifestRecord.sourcePath, sourceRevision: `sha256:${await digest(manifestContent)}`, content: manifestContent });
    const diagnostics = membershipDiagnostics(value, facts.instances);
    return { ok: diagnostics.length === 0, diagnostics };
  } catch (error) { return { ok: false, diagnostics: error.payload?.diagnostics?.length ? error.payload.diagnostics : [diagnostic('Invalid frozen physics2d creation dependencies.')] }; }
}

export async function preparePhysics2DCreate(source, projection, sceneRecordContent, rawRequest, { digest }) {
  const request = validateWorldCommand(rawRequest);
  if (request.command !== 'physics2d.create') throw createError(400, 'Expected physics2d.create', {}, 'world_command_invalid');
  if (projection.world.id !== request.worldId || projection.world.revision !== request.baseRevision) conflict();
  const sceneObject = projection.objects.find(object => object.id === request.sceneObjectId);
  if (!sceneObject || sceneObject.revision !== request.sceneObjectRevision || sceneObject.documentRefs[0]?.sourceRevision !== request.sceneSourceRevision) conflict();
  const { scene, manifest } = inspectPhysics2DCreateScene(source, projection, request.sceneObjectId);
  if (manifest) invalid('The scene already has a physics2d declaration');
  if (`sha256:${await digest(scene.content)}` !== request.sceneSourceRevision) conflict();
  if (!request.sourcePath.endsWith('.json')) invalid('A physics2d declaration requires a JSON source path');
  const value = checkedManifest(request.content);
  if (value.sceneObjectId !== request.sceneObjectId) invalid('The physics2d declaration belongs to another scene');
  const { sceneObjectId, sceneObjectRevision, sceneSourceRevision, ...createRequest } = request;
  const base = await prepareObjectCreate(source, projection, { ...createRequest, command: 'object.create' }, { digest });
  const record = physics2DCreateRegistration(base.result.changes[0].record, value);
  const metadata = appendScenePhysics2DRelation(sceneRecordContent, record.id);
  if (!same(metadata.before, scene.record)) conflict();
  const nextSource = { ...base.nextSource, documents: base.nextSource.documents.map(document => document.record?.id === record.id
    ? { ...document, record, descriptor: { ...document.descriptor, ...record } }
    : document.record?.id === scene.record.id ? { ...document, record: metadata.after, descriptor: { ...document.descriptor, relations: metadata.after.relations } } : document) };
  try { validateDocumentModels(nextSource.documents.filter(document => document.record).map(document => document.record)); }
  catch { invalid('The physics2d registrations are invalid'); }
  const next = await createWorldProjection(nextSource, { digest });
  const diagnostics = membershipDiagnostics(value, sceneFacts(source, scene.record.id).instances);
  if (diagnostics.length) invalid('The physics2d scene is invalid', diagnostics);
  const describe = document => ({ objectId: document.record.id, sourcePath: document.sourcePath, sourceRevision: document.sourceRevision, content: document.content });
  const facts = sceneFacts(source, scene.record.id);
  let physics2DRecovery;
  try { physics2DRecovery = evidenceSnapshot({ scene: describe(scene), definitions: facts.definitions.map(describe).sort(compare) }); }
  catch { invalid('The physics2d creation dependencies exceed the recoverable transaction budget'); }
  const registry = { documents: source.documents.filter(document => document.record).map(document => document.record), assets: (source.assets || []).map(asset => asset.record) };
  const recoveryCheck = await validatePhysics2DCreateRecovery(record, request.content, metadata.after, physics2DRecovery, registry, { digest });
  if (!recoveryCheck.ok) invalid('The physics2d dependencies cannot be safely recovered', recoveryCheck.diagnostics);
  const { mode, ...input } = request, preconditionIds = [...new Set([scene.record.id, ...facts.definitions.map(document => document.record.id)])].sort();
  const proposal = { ...base.result.proposal, id: `proposal:${await digest(canonicalJson(input))}`,
    commands: [{ id: request.command, input }], affectedObjects: [record.id, scene.record.id],
    preconditions: preconditionIds.map(objectId => ({ objectId, revision: projection.objects.find(object => object.id === objectId).revision })) };
  const change = { ...base.result.changes[0], kind: 'physics2d.create', record };
  const recordContent = `${JSON.stringify(record, null, 2)}\n`, recordPath = `metadata/documents/${scene.record.id}.json`;
  const relation = { kind: 'references', targetId: record.id, slot: 'physics2d' };
  const relationChange = { kind: 'relation.add', objectId: scene.record.id, sourcePath: scene.sourcePath,
    targetObjectId: record.id, targetSourcePath: request.sourcePath, recordPath, relation,
    beforeRecordRevision: `sha256:${await digest(sceneRecordContent)}`, afterRecordRevision: `sha256:${await digest(metadata.afterContent)}` };
  return { kind: 'physics2d.create', nextSource, physics2DRecovery: freeze(physics2DRecovery),
    registryHash: `sha256:${await digest(physics2DCreationRegistryGuard(registry, record.id, scene.record.id))}`,
    plans: [{ ...base.plans[0], change }, { ...base.plans[1], afterContent: recordContent,
      change: { ...base.plans[1].change, afterSourceRevision: `sha256:${await digest(recordContent)}` } },
    { sourcePath: recordPath, beforeContent: sceneRecordContent, afterContent: metadata.afterContent,
      change: { objectId: scene.record.id, beforeSourceRevision: relationChange.beforeRecordRevision, afterSourceRevision: relationChange.afterRecordRevision } }],
    result: { ...base.result, revision: next.world.revision, proposal, changes: [change, relationChange],
      object: next.objects.find(object => object.id === record.id), scene: next.objects.find(object => object.id === scene.record.id),
      relation: next.relations.find(item => item.sourceObjectId === scene.record.id && item.targetObjectId === record.id && item.properties.kind === 'references' && item.properties.slot === 'physics2d') } };
}
