// First behavior opt-in is one declarative World mutation: two new files and
// one lossless registration append. Scripts remain author data, never code here.
import { validateWorldCommand } from './world-command-contract.mjs';
import { prepareObjectCreate } from './world-object-create.mjs';
import { appendRecordItem } from './world-record-edit.mjs';
import { createWorldProjection, canonicalJson } from './world-projection.mjs';
import { inspectSceneBehaviors, validateSceneBehaviorDependencies, sceneBehaviorDocumentIds } from './scene-behaviors.mjs';
import { createScene2DPlan } from './build-plan.mjs';
import { validateSceneCreateRegistration } from './world-scene-create.mjs';
import { validateDocumentModels } from './document-model.mjs';
import { parseJsonSource } from './json-source.mjs';
import { normalizeSourcePath } from './source-path.mjs';
import { createError } from './service-error.mjs';

export const BEHAVIOR_CREATE_RECOVERY_LIMITS = Object.freeze({ bytes: 32 * 1024 * 1024,
  sceneBytes: 8 * 1024 * 1024, definitionBytes: 8 * 1024 * 1024, definitions: 128, scriptBytes: 65536, scripts: 8 });
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const revision = value => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
const compare = (a, b) => a.objectId < b.objectId ? -1 : a.objectId > b.objectId ? 1 : 0;
const same = (a, b) => canonicalJson(a) === canonicalJson(b);
const diagnostic = (message, propertyPath = '', details = {}) => ({ severity: 'error', code: 'build_behavior_invalid', message, propertyPath, ...details });
const invalid = (message, diagnostics = []) => { throw createError(422, message, { diagnostics }, 'world_behavior_invalid'); };
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
  const optIns = (scene.record.relations || []).filter(relation => relation.kind === 'behavior');
  if (manifestId === null ? optIns.length !== 0 : optIns.length !== 1 || optIns[0].targetId !== manifestId) {
    invalid('First behavior creation requires a scene without a behavior declaration', [diagnostic('The scene already has a behavior relation.', '/sceneObjectId')]);
  }
  const parsed = parseJsonSource(scene.content), value = parsed.value;
  if (!parsed.ok || value?.format !== 'viento-scene2d' || ![2, 3].includes(value.schemaVersion)
    || !Array.isArray(value.actors) || value.actors.length < 1 || value.actors.length > 128
    || value.actors.some(actor => !uuid(actor?.instanceId) || !uuid(actor?.objectId))
    || new Set(value.actors.map(actor => actor.instanceId)).size !== value.actors.length) {
    invalid('Behaviors require an unambiguous Scene2D schemaVersion 2 or 3', parsed.diagnostics);
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

// The readonly creation catalog shares the exact admission gate. It does not
// allocate identities, create records or infer an engine from a template.
export function inspectBehaviorCreateScene(source, projection, sceneObjectId) {
  if (![2, 3].includes(source.workspace?.version)) invalid('Behavior creation requires a registered workspace');
  const { scene, instances } = sceneFacts(source, sceneObjectId);
  const checked = createScene2DPlan({ source, projection }, sceneObjectId);
  if (!checked.ok) invalid('The existing scene is invalid', checked.diagnostics);
  return { scene, instances };
}

export function behaviorCreateRegistration(record, manifestValue) {
  return { ...record, relations: sceneBehaviorDocumentIds(manifestValue).map(targetId => ({ kind: 'references', targetId, slot: '' })), assetBindings: [] };
}

export function appendSceneBehaviorRelation(content, manifestId) {
  if (typeof content !== 'string' || !uuid(manifestId)) invalid('Invalid scene behavior registration');
  // JSON.parse owns values; the existing insertion helper preserves unrelated
  // metadata bytes, including extension numbers, escapes and CRLF layout.
  let before;
  try { before = JSON.parse(content.replace(/^\uFEFF/, '')); } catch { invalid('Invalid scene registration'); }
  if (!before || before.format !== 'viento-document' || before.version !== 1 || !uuid(before.id) || before.id === manifestId
    || before.relations !== undefined && !Array.isArray(before.relations)
    || (before.relations || []).some(relation => relation?.kind === 'behavior')) invalid('The scene already has a behavior declaration or invalid registration');
  const bom = content.startsWith('\uFEFF') ? '\uFEFF' : '';
  const edit = appendRecordItem(content.slice(bom.length), 'relations', { kind: 'behavior', targetId: manifestId, slot: '' });
  return { ...edit, afterContent: bom + edit.afterContent };
}

// Both mutated registrations have exact before/after images. The remaining
// registry must be identical through every possible partial publish state.
export function behaviorCreationRegistryGuard(registry, manifestId, sceneId) {
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
    if (bytes > limit || (sourceBytes += bytes) > BEHAVIOR_CREATE_RECOVERY_LIMITS.bytes) throw new TypeError('Dependency evidence exceeds transaction budget');
    return result;
  };
  const list = (input, limit, bytes) => {
    if (!Array.isArray(input) || input.length > limit || Object.getPrototypeOf(input) !== Array.prototype) throw new TypeError('Invalid dependency list');
    const descriptors = Object.getOwnPropertyDescriptors(input);
    if (Reflect.ownKeys(descriptors).length !== input.length + 1) throw new TypeError('Invalid dependency list fields');
    const result = [];
    for (let index = 0; index < input.length; index++) {
      const descriptor = descriptors[index];
      if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) throw new TypeError('Invalid dependency list item');
      result.push(entry(descriptor.value, bytes));
    }
    if (new Set(result.map(item => item.objectId)).size !== result.length || new Set(result.map(item => item.sourcePath)).size !== result.length) throw new TypeError('Duplicate dependency');
    return result;
  };
  const raw = exact(input, ['scene', 'scripts', 'definitions']), limits = BEHAVIOR_CREATE_RECOVERY_LIMITS;
  const result = { scene: entry(raw.scene, limits.sceneBytes), scripts: list(raw.scripts, limits.scripts, limits.scriptBytes),
    definitions: list(raw.definitions, limits.definitions, limits.definitionBytes) };
  const ids = new Map(), paths = new Map();
  for (const item of [result.scene, ...result.scripts, ...result.definitions]) {
    if (ids.has(item.objectId) && (item.objectId === result.scene.objectId || !same(ids.get(item.objectId), item))
      || paths.has(item.sourcePath) && paths.get(item.sourcePath) !== item.objectId) throw new TypeError('Ambiguous dependency');
    ids.set(item.objectId, item); paths.set(item.sourcePath, item.objectId);
  }
  if (utf8Length(JSON.stringify(result)) > limits.bytes) throw new TypeError('Dependency evidence exceeds transaction budget');
  return result;
}

// Recovery consumes these frozen bytes only. It never parses today's script or
// actor source, and these observations are never written back to the project.
export async function validateBehaviorCreateRecovery(manifestRecord, manifestContent, sceneRecord, input, registry, { digest }) {
  try {
    const recovery = evidenceSnapshot(input), checked = inspectSceneBehaviors(manifestContent);
    if (!checked.recognized || !checked.ok) return { ok: false, diagnostics: checked.diagnostics };
    const value = checked.value;
    if (manifestRecord?.format !== 'viento-document' || manifestRecord.version !== 1 || !uuid(manifestRecord.id)
      || !same(Object.keys(manifestRecord).sort(), ['format', 'version', 'id', 'sourcePath', 'documentType', 'parserProfile', 'relations', 'assetBindings'].sort())
      || typeof manifestRecord.sourcePath !== 'string' || normalizeSourcePath(manifestRecord.sourcePath) !== manifestRecord.sourcePath
      || !manifestRecord.sourcePath.toLowerCase().endsWith('.json') || !same(manifestRecord, behaviorCreateRegistration(manifestRecord, value))
      || sceneRecord?.id !== value.sceneObjectId || recovery.scene.objectId !== value.sceneObjectId) throw new TypeError('Invalid behavior registrations');
    const expectedSources = [...new Set(value.bindings.map(binding => binding.implementation.sourceObjectId))].sort();
    if (!same(recovery.scripts.map(item => item.objectId).sort(), expectedSources)) throw new TypeError('Unexpected behavior source evidence');
    const records = [...registry.documents.filter(record => record.id !== sceneRecord.id && record.id !== manifestRecord.id), sceneRecord, manifestRecord];
    validateDocumentModels(records);
    const byId = new Map(records.map(record => [record.id, record])), documents = new Map();
    for (const item of [recovery.scene, ...recovery.scripts, ...recovery.definitions]) {
      const record = byId.get(item.objectId);
      if (!record || record.sourcePath !== item.sourcePath || item.objectId === manifestRecord.id || `sha256:${await digest(item.content)}` !== item.sourceRevision) throw new TypeError('Dependency evidence does not match its registration or hash');
      documents.set(item.objectId, { record, ...item });
    }
    const source = { documents: [...documents.values()] }, facts = sceneFacts(source, value.sceneObjectId, manifestRecord.id);
    if (!same(recovery.definitions.map(item => item.objectId).sort(), [...new Set(facts.instances.map(item => item.objectId))].sort())) throw new TypeError('Unexpected actor evidence');
    const registration = validateSceneCreateRegistration(sceneRecord, recovery.scene.content, { ...registry, documents: records });
    const diagnostics = [...registration.diagnostics, ...validateSceneBehaviorDependencies(value, manifestRecord, source)];
    return { ok: diagnostics.length === 0, diagnostics };
  } catch (error) { return { ok: false, diagnostics: error.payload?.diagnostics?.length ? error.payload.diagnostics : [diagnostic('Invalid frozen behavior creation dependencies.')] }; }
}

export async function prepareBehaviorCreate(source, projection, sceneRecordContent, rawRequest, { digest }) {
  const request = validateWorldCommand(rawRequest);
  if (request.command !== 'behavior.create') throw createError(400, 'Expected behavior.create', {}, 'world_command_invalid');
  if (projection.world.id !== request.worldId || projection.world.revision !== request.baseRevision) conflict();
  const sceneObject = projection.objects.find(object => object.id === request.sceneObjectId);
  if (!sceneObject || sceneObject.revision !== request.sceneObjectRevision || sceneObject.documentRefs[0]?.sourceRevision !== request.sceneSourceRevision) conflict();
  const { scene } = inspectBehaviorCreateScene(source, projection, request.sceneObjectId);
  if (`sha256:${await digest(scene.content)}` !== request.sceneSourceRevision) conflict();
  if (!request.sourcePath.toLowerCase().endsWith('.json')) invalid('A behavior declaration requires a JSON source path');
  const checked = inspectSceneBehaviors(request.content);
  if (!checked.recognized || !checked.ok || checked.value.sceneObjectId !== request.sceneObjectId) invalid('The behavior declaration is invalid', checked.diagnostics);
  const value = checked.value, { sceneObjectId, sceneObjectRevision, sceneSourceRevision, ...createRequest } = request;
  const base = await prepareObjectCreate(source, projection, { ...createRequest, command: 'object.create' }, { digest });
  const record = behaviorCreateRegistration(base.result.changes[0].record, value);
  const metadata = appendSceneBehaviorRelation(sceneRecordContent, record.id);
  if (!same(metadata.before, scene.record)) conflict();
  const nextSource = { ...base.nextSource, documents: base.nextSource.documents.map(document => document.record?.id === record.id
    ? { ...document, record, descriptor: { ...document.descriptor, ...record } }
    : document.record?.id === scene.record.id ? { ...document, record: metadata.after, descriptor: { ...document.descriptor, relations: metadata.after.relations } } : document) };
  const dependencies = validateSceneBehaviorDependencies(value, record, nextSource);
  if (dependencies.length) invalid('The behavior dependencies are invalid', dependencies);
  try { validateDocumentModels(nextSource.documents.filter(document => document.record).map(document => document.record)); }
  catch { invalid('The behavior registrations are invalid'); }
  const next = await createWorldProjection(nextSource, { digest }), build = createScene2DPlan({ source: nextSource, projection: next }, scene.record.id);
  if (!build.ok) invalid('The behavior scene is invalid', build.diagnostics);
  const describe = document => ({ objectId: document.record.id, sourcePath: document.sourcePath, sourceRevision: document.sourceRevision, content: document.content });
  const facts = sceneFacts(source, scene.record.id), scriptIds = [...new Set(value.bindings.map(binding => binding.implementation.sourceObjectId))];
  let behaviorRecovery;
  try { behaviorRecovery = evidenceSnapshot({ scene: describe(scene), scripts: scriptIds.map(id => describe(source.documents.find(document => document.record?.id === id))).sort(compare),
    definitions: facts.definitions.map(describe).sort(compare) }); }
  catch { invalid('The behavior creation dependencies exceed the recoverable transaction budget'); }
  const registry = { documents: source.documents.filter(document => document.record).map(document => document.record), assets: (source.assets || []).map(asset => asset.record) };
  const recoveryCheck = await validateBehaviorCreateRecovery(record, request.content, metadata.after, behaviorRecovery, registry, { digest });
  if (!recoveryCheck.ok) invalid('The behavior dependencies cannot be safely recovered', recoveryCheck.diagnostics);
  const { mode, ...input } = request, preconditionIds = [...new Set([scene.record.id, ...scriptIds, ...facts.definitions.map(document => document.record.id)])].sort();
  const proposal = { ...base.result.proposal, id: `proposal:${await digest(canonicalJson(input))}`,
    commands: [{ id: request.command, input }], affectedObjects: [record.id, scene.record.id],
    preconditions: preconditionIds.map(objectId => ({ objectId, revision: projection.objects.find(object => object.id === objectId).revision })) };
  const change = { ...base.result.changes[0], kind: 'behavior.create', record };
  const recordContent = `${JSON.stringify(record, null, 2)}\n`, recordPath = `metadata/documents/${scene.record.id}.json`;
  const relation = { kind: 'behavior', targetId: record.id, slot: '' };
  const relationChange = { kind: 'relation.add', objectId: scene.record.id, sourcePath: scene.sourcePath,
    targetObjectId: record.id, targetSourcePath: request.sourcePath, recordPath, relation,
    beforeRecordRevision: `sha256:${await digest(sceneRecordContent)}`, afterRecordRevision: `sha256:${await digest(metadata.afterContent)}` };
  return { kind: 'behavior.create', nextSource, behaviorRecovery: freeze(behaviorRecovery),
    registryHash: `sha256:${await digest(behaviorCreationRegistryGuard(registry, record.id, scene.record.id))}`,
    plans: [{ ...base.plans[0], change }, { ...base.plans[1], afterContent: recordContent,
      change: { ...base.plans[1].change, afterSourceRevision: `sha256:${await digest(recordContent)}` } },
    { sourcePath: recordPath, beforeContent: sceneRecordContent, afterContent: metadata.afterContent,
      change: { objectId: scene.record.id, beforeSourceRevision: relationChange.beforeRecordRevision, afterSourceRevision: relationChange.afterRecordRevision } }],
    result: { ...base.result, revision: next.world.revision, proposal, changes: [change, relationChange],
      object: next.objects.find(object => object.id === record.id), scene: next.objects.find(object => object.id === scene.record.id),
      relation: next.relations.find(item => item.sourceObjectId === scene.record.id && item.targetObjectId === record.id && item.properties.kind === 'behavior') } };
}
