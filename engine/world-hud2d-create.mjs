// First hud opt-in changes only the new source and two registrations.
// Frozen scene/definition evidence is validated again before crash recovery.
import { validateWorldCommand } from './world-command-contract.mjs';
import { prepareObjectCreate } from './world-object-create.mjs';
import { appendRecordItem } from './world-record-edit.mjs';
import { createWorldProjection, canonicalJson } from './world-projection.mjs';
import { inspectSceneHUD2DDocument } from './scene-hud2d.mjs';
import { validateDocumentModels } from './document-model.mjs';
import { parseJsonSource } from './json-source.mjs';
import { normalizeSourcePath } from './source-path.mjs';
import { createError } from './service-error.mjs';

export const HUD2D_CREATE_RECOVERY_LIMITS = Object.freeze({ bytes: 32 * 1024 * 1024,
  sceneBytes: 8 * 1024 * 1024, definitionBytes: 8 * 1024 * 1024, definitions: 128 });
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const revision = value => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
const same = (a, b) => canonicalJson(a) === canonicalJson(b);
const diagnostic = (message, propertyPath = '') => ({ severity: 'error', code: 'build_hud2d_invalid', message, propertyPath });
const invalid = (message, diagnostics = []) => { throw createError(422, message, { diagnostics }, 'world_hud2d_invalid'); };
const conflict = () => { throw createError(409, 'World or scene changed; refresh and preview again', {}, 'world_revision_conflict'); };
const bytes = value => typeof value === 'string' && !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value) ? new TextEncoder().encode(value).length : Infinity;
const readable = doc => doc?.record?.format === 'viento-document' && doc.record.version === 1 && uuid(doc.record.id)
  && doc.record.sourcePath === doc.sourcePath && typeof doc.sourcePath === 'string' && normalizeSourcePath(doc.sourcePath) === doc.sourcePath
  && typeof doc.content === 'string' && revision(doc.sourceRevision);
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };

function sceneFacts(source, sceneId, hudId = null) {
  const scene = source.documents.find(doc => doc.record?.id === sceneId);
  if (!readable(scene) || !scene.sourcePath.endsWith('.json')) invalid('An available registered Scene2D document is required');
  const slots = (scene.record.relations || []).filter(item => item.kind === 'references' && item.slot === 'hud2d');
  if (hudId === null ? slots.length !== 0 : slots.length !== 1 || slots[0].targetId !== hudId) invalid('A scene may select only one hud2d declaration');
  const parsed = parseJsonSource(scene.content), value = parsed.value;
  if (!parsed.ok || value?.format !== 'viento-scene2d' || ![1, 2, 3].includes(value.schemaVersion)
    || !Array.isArray(value.actors) || value.actors.length < 1 || value.actors.length > 128
    || value.actors.some(actor => !uuid(actor?.objectId) || value.schemaVersion !== 1 && !uuid(actor?.instanceId))
    || new Set(value.actors.map(actor => value.schemaVersion === 1 ? actor.objectId : actor.instanceId)).size !== value.actors.length) invalid('HUD2D requires an unambiguous Scene2D schemaVersion 1, 2 or 3', parsed.diagnostics);
  const definitions = new Map();
  for (const actor of value.actors) {
    const definition = source.documents.find(doc => doc.record?.id === actor.objectId);
    if (!readable(definition) || [sceneId, hudId].includes(actor.objectId)
      || !scene.record.relations?.some(item => typeof item.kind === 'string' && item.kind.trim() && item.kind !== 'part-of' && item.targetId === actor.objectId)) {
      invalid('Every scene instance requires an available linked definition', [diagnostic('Register a scene-to-definition dependency.', '/sceneObjectId')]);
    }
    definitions.set(actor.objectId, definition);
  }
  return { scene, instances: value.actors.map(({ instanceId, objectId }) => ({ instanceId: value.schemaVersion === 1 ? objectId : instanceId, objectId })), definitions: [...definitions.values()] };
}
function checkedDocument(content) {
  if (typeof content !== 'string' || content.length > 65536 || bytes(content) > 65536) invalid('The hud2d declaration exceeds its source budget');
  const checked = inspectSceneHUD2DDocument(content);
  if (!checked.recognized || !checked.ok) invalid('The hud2d declaration is invalid', checked.diagnostics);
  return checked.value;
}
export function inspectHUD2DCreateScene(source, projection, sceneObjectId) {
  if (![2, 3].includes(source.workspace?.version)) invalid('HUD2D creation requires a registered workspace');
  const scene = source.documents.find(doc => doc.record?.id === sceneObjectId);
  const selected = (scene?.record?.relations || []).filter(item => item.kind === 'references' && item.slot === 'hud2d');
  if (selected.length > 1) invalid('A scene may select only one hud2d declaration');
  const manifest = selected.length ? source.documents.find(doc => doc.record?.id === selected[0].targetId) : null;
  if (selected.length && !readable(manifest)) invalid('The selected hud2d declaration is unavailable');
  const facts = sceneFacts(source, sceneObjectId, manifest?.record.id ?? null);
  const objects = new Map(projection.objects.map(object => [object.id, object]));
  if ([facts.scene, ...facts.definitions, ...(manifest ? [manifest] : [])].some(doc => {
    const object = objects.get(doc.record.id);
    return !object || !revision(object.revision) || object.documentRefs?.[0]?.sourceRevision !== doc.sourceRevision;
  })) invalid('Scene and actor definitions must have available registered identities');
  if (manifest) {
    const value = checkedDocument(manifest.content), reverse = (manifest.record.relations || []).filter(item => item.kind === 'references' && item.slot === 'scene');
    if (!manifest.sourcePath.endsWith('.json') || value.sceneObjectId !== sceneObjectId || reverse.length !== 1 || reverse[0].targetId !== sceneObjectId) invalid('The existing hud2d must reference this scene');
  }
  return { ...facts, manifest };
}
export function hud2DCreateRegistration(record, value) {
  return { ...record, relations: [{ kind: 'references', targetId: value.sceneObjectId, slot: 'scene' }], assetBindings: [] };
}
export function appendSceneHUD2DRelation(content, hudId) {
  if (typeof content !== 'string' || !uuid(hudId)) invalid('Invalid scene hud2d registration');
  let before;
  try { before = JSON.parse(content.replace(/^\uFEFF/, '')); } catch { invalid('Invalid scene registration'); }
  if (!before || before.format !== 'viento-document' || before.version !== 1 || !uuid(before.id) || before.id === hudId
    || before.relations !== undefined && !Array.isArray(before.relations)
    || (before.relations || []).some(item => item?.kind === 'references' && item.slot === 'hud2d')) invalid('The scene already has a hud2d declaration or invalid registration');
  const bom = content.startsWith('\uFEFF') ? '\uFEFF' : '';
  const edit = appendRecordItem(content.slice(bom.length), 'relations', { kind: 'references', targetId: hudId, slot: 'hud2d' });
  return { ...edit, afterContent: bom + edit.afterContent };
}
export function hud2DCreationRegistryGuard(registry, hudId, sceneId) {
  const compare = (a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  return canonicalJson({ documents: registry.documents.filter(record => ![hudId, sceneId].includes(record.id)).sort(compare), assets: [...registry.assets].sort(compare) });
}
function evidenceSnapshot(input) {
  const exact = (value, keys) => {
    if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new TypeError('Invalid evidence');
    const descriptors = Object.getOwnPropertyDescriptors(value), names = Reflect.ownKeys(descriptors);
    if (names.length !== keys.length || names.some(key => typeof key !== 'string' || !keys.includes(key) || !descriptors[key].enumerable || !Object.hasOwn(descriptors[key], 'value'))) throw new TypeError('Invalid evidence fields');
    return Object.fromEntries(keys.map(key => [key, descriptors[key].value]));
  };
  let total = 0;
  const entry = (value, limit) => {
    const item = exact(value, ['objectId', 'sourcePath', 'sourceRevision', 'content']);
    if (!uuid(item.objectId) || !revision(item.sourceRevision) || typeof item.sourcePath !== 'string' || item.sourcePath.length > 4096
      || normalizeSourcePath(item.sourcePath) !== item.sourcePath || bytes(item.sourcePath) === Infinity || typeof item.content !== 'string'
      || item.content.length > limit || bytes(item.content) > limit || (total += bytes(item.content)) > HUD2D_CREATE_RECOVERY_LIMITS.bytes) throw new TypeError('Invalid evidence source');
    return item;
  };
  const value = exact(input, ['scene', 'definitions']), raw = value.definitions;
  if (!Array.isArray(raw) || Object.getPrototypeOf(raw) !== Array.prototype || raw.length > HUD2D_CREATE_RECOVERY_LIMITS.definitions) throw new TypeError('Invalid evidence list');
  const descriptors = Object.getOwnPropertyDescriptors(raw);
  if (Reflect.ownKeys(descriptors).length !== raw.length + 1) throw new TypeError('Invalid evidence list fields');
  const definitions = Array.from({ length: raw.length }, (_, index) => { const d = descriptors[index]; if (!d?.enumerable || !Object.hasOwn(d, 'value')) throw new TypeError('Invalid evidence item'); return entry(d.value, HUD2D_CREATE_RECOVERY_LIMITS.definitionBytes); });
  const result = { scene: entry(value.scene, HUD2D_CREATE_RECOVERY_LIMITS.sceneBytes), definitions }, all = [result.scene, ...definitions];
  if (new Set(all.map(item => item.objectId)).size !== all.length || new Set(all.map(item => item.sourcePath)).size !== all.length || bytes(JSON.stringify(result)) > HUD2D_CREATE_RECOVERY_LIMITS.bytes) throw new TypeError('Duplicate or oversized evidence');
  return result;
}
export async function validateHUD2DCreateRecovery(record, content, sceneRecord, input, registry, { digest }) {
  try {
    const recovery = evidenceSnapshot(input), value = checkedDocument(content);
    if (record?.format !== 'viento-document' || record.version !== 1 || !uuid(record.id)
      || !same(Object.keys(record).sort(), ['format', 'version', 'id', 'sourcePath', 'documentType', 'parserProfile', 'relations', 'assetBindings'].sort())
      || typeof record.sourcePath !== 'string' || normalizeSourcePath(record.sourcePath) !== record.sourcePath || !record.sourcePath.endsWith('.json')
      || !same(record, hud2DCreateRegistration(record, value)) || sceneRecord?.id !== value.sceneObjectId || recovery.scene.objectId !== value.sceneObjectId) throw new TypeError('Invalid hud registrations');
    const records = [...registry.documents.filter(item => ![sceneRecord.id, record.id].includes(item.id)), sceneRecord, record];
    validateDocumentModels(records);
    const byId = new Map(records.map(item => [item.id, item])), documents = [];
    for (const item of [recovery.scene, ...recovery.definitions]) {
      const matched = byId.get(item.objectId);
      if (!matched || matched.sourcePath !== item.sourcePath || item.objectId === record.id || `sha256:${await digest(item.content)}` !== item.sourceRevision) throw new TypeError('Evidence mismatch');
      documents.push({ record: matched, ...item });
    }
    const facts = sceneFacts({ documents, assets: [] }, value.sceneObjectId, record.id);
    if (!same(recovery.definitions.map(item => item.objectId).sort(), [...new Set(facts.instances.map(item => item.objectId))].sort())) throw new TypeError('Unexpected actor evidence');
    return { ok: true, diagnostics: [] };
  } catch (error) { return { ok: false, diagnostics: error.payload?.diagnostics?.length ? error.payload.diagnostics : [diagnostic('Invalid frozen hud2d creation dependencies.')] }; }
}
export async function prepareHUD2DCreate(source, projection, sceneRecordContent, rawRequest, { digest }) {
  const request = validateWorldCommand(rawRequest);
  if (request.command !== 'hud2d.create') throw createError(400, 'Expected hud2d.create', {}, 'world_command_invalid');
  if (projection.world.id !== request.worldId || projection.world.revision !== request.baseRevision) conflict();
  const sceneObject = projection.objects.find(object => object.id === request.sceneObjectId);
  if (!sceneObject || sceneObject.revision !== request.sceneObjectRevision || sceneObject.documentRefs[0]?.sourceRevision !== request.sceneSourceRevision) conflict();
  const { scene, manifest, definitions } = inspectHUD2DCreateScene(source, projection, request.sceneObjectId);
  if (manifest) invalid('The scene already has a hud2d declaration');
  if (`sha256:${await digest(scene.content)}` !== request.sceneSourceRevision) conflict();
  if (!request.sourcePath.endsWith('.json')) invalid('A hud2d declaration requires a JSON source path');
  const value = checkedDocument(request.content);
  if (value.sceneObjectId !== request.sceneObjectId) invalid('The hud2d declaration belongs to another scene');
  const { sceneObjectId, sceneObjectRevision, sceneSourceRevision, ...createRequest } = request;
  const base = await prepareObjectCreate(source, projection, { ...createRequest, command: 'object.create' }, { digest });
  const record = hud2DCreateRegistration(base.result.changes[0].record, value), metadata = appendSceneHUD2DRelation(sceneRecordContent, record.id);
  if (!same(metadata.before, scene.record)) conflict();
  const nextSource = { ...base.nextSource, documents: base.nextSource.documents.map(doc => doc.record?.id === record.id
    ? { ...doc, record, descriptor: { ...doc.descriptor, ...record } }
    : doc.record?.id === scene.record.id ? { ...doc, record: metadata.after, descriptor: { ...doc.descriptor, relations: metadata.after.relations } } : doc) };
  try { validateDocumentModels(nextSource.documents.filter(doc => doc.record).map(doc => doc.record)); } catch { invalid('The hud2d registrations are invalid'); }
  const next = await createWorldProjection(nextSource, { digest });
  const describe = doc => ({ objectId: doc.record.id, sourcePath: doc.sourcePath, sourceRevision: doc.sourceRevision, content: doc.content });
  let hud2DRecovery;
  try { hud2DRecovery = evidenceSnapshot({ scene: describe(scene), definitions: definitions.map(describe).sort((a,b) => a.objectId < b.objectId ? -1 : a.objectId > b.objectId ? 1 : 0) }); }
  catch { invalid('The hud2d creation dependencies exceed the recoverable transaction budget'); }
  const registry = { documents: source.documents.filter(doc => doc.record).map(doc => doc.record), assets: (source.assets || []).map(asset => asset.record) };
  const checked = await validateHUD2DCreateRecovery(record, request.content, metadata.after, hud2DRecovery, registry, { digest });
  if (!checked.ok) invalid('The hud2d dependencies cannot be safely recovered', checked.diagnostics);
  const { mode, ...input } = request, preconditionIds = [...new Set([scene.record.id, ...definitions.map(doc => doc.record.id)])].sort();
  const proposal = { ...base.result.proposal, id: `proposal:${await digest(canonicalJson(input))}`, commands: [{ id: request.command, input }],
    affectedObjects: [record.id, scene.record.id], preconditions: preconditionIds.map(objectId => ({ objectId, revision: projection.objects.find(object => object.id === objectId).revision })) };
  const change = { ...base.result.changes[0], kind: 'hud2d.create', record }, recordContent = `${JSON.stringify(record, null, 2)}\n`, recordPath = `metadata/documents/${scene.record.id}.json`;
  const relation = { kind: 'references', targetId: record.id, slot: 'hud2d' };
  const relationChange = { kind: 'relation.add', objectId: scene.record.id, sourcePath: scene.sourcePath, targetObjectId: record.id,
    targetSourcePath: request.sourcePath, recordPath, relation, beforeRecordRevision: `sha256:${await digest(sceneRecordContent)}`, afterRecordRevision: `sha256:${await digest(metadata.afterContent)}` };
  return { kind: 'hud2d.create', nextSource, hud2DRecovery: freeze(hud2DRecovery), registryHash: `sha256:${await digest(hud2DCreationRegistryGuard(registry, record.id, scene.record.id))}`,
    plans: [{ ...base.plans[0], change }, { ...base.plans[1], afterContent: recordContent, change: { ...base.plans[1].change, afterSourceRevision: `sha256:${await digest(recordContent)}` } },
      { sourcePath: recordPath, beforeContent: sceneRecordContent, afterContent: metadata.afterContent, change: { objectId: scene.record.id, beforeSourceRevision: relationChange.beforeRecordRevision, afterSourceRevision: relationChange.afterRecordRevision } }],
    result: { ...base.result, revision: next.world.revision, proposal, changes: [change, relationChange], object: next.objects.find(object => object.id === record.id),
      scene: next.objects.find(object => object.id === scene.record.id), relation: next.relations.find(item => item.sourceObjectId === scene.record.id && item.targetObjectId === record.id && item.properties.kind === 'references' && item.properties.slot === 'hud2d') } };
}
