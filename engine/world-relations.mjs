import { parseDocument, isMap, isSeq } from 'yaml';
import { createError } from './service-error.mjs';
import { validateWorldCommand, canRelateObject, RELATION_KINDS } from './world-command-contract.mjs';
import { validateDocumentModels } from './document-model.mjs';
import { createWorldProjection, canonicalJson } from './world-projection.mjs';

const fail = (status, code, message) => { throw createError(status, message, {}, code); };
const invalidRecord = () => fail(422, 'world_record_invalid', 'The registration cannot be edited without changing other data');

// Used by the planner and the recovery validator. Insert only new JSON tokens;
// never reserialize unknown fields, large numbers, or existing relation objects.
export function appendRelationRecord(content, relation) {
  if (!relation || Object.keys(relation).length !== 3 || !RELATION_KINDS.includes(relation.kind)
    || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(relation.targetId)
    || typeof relation.slot !== 'string' || relation.slot.length > 200
    || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(relation.slot)) invalidRecord();
  let before;
  try { before = JSON.parse(content); } catch { invalidRecord(); }
  const parsed = parseDocument(content, { keepSourceTokens: true, intAsBigInt: true, uniqueKeys: true });
  if (parsed.errors.length || !isMap(parsed.contents)) invalidRecord();
  const root = parsed.contents, pair = root.items.find(item => item.key?.value === 'relations');
  if (pair && !isSeq(pair.value)) invalidRecord();
  const target = pair ? pair.value : root, last = target.items.at(-1);
  const at = last ? (isMap(target) ? last.value : last)?.range?.[1] : target.range[0] + 1;
  if (!Number.isInteger(at) || !target.flow) invalidRecord();
  const value = pair ? JSON.stringify(relation) : `"relations": [${JSON.stringify(relation)}]`;
  const separator = last ? ', ' : '';
  const afterContent = content.slice(0, at) + separator + value + content.slice(at);
  let after;
  try { after = JSON.parse(afterContent); } catch { invalidRecord(); }
  if (canonicalJson(after) !== canonicalJson({ ...before, relations: [...(before.relations || []), relation] })) invalidRecord();
  return { before, after, afterContent };
}

// The changed record has its own exact byte hashes. The remaining registry
// guards relation targets and the ownership graph during crash recovery.
export function relationRegistryGuard(registry, objectId) {
  const byId = (a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  return canonicalJson({ documents: registry.documents.filter(item => item.id !== objectId).sort(byId),
    assets: [...registry.assets].sort(byId) });
}

export async function prepareRelationAdd(source, projection, recordContent, rawRequest, { digest }) {
  const request = validateWorldCommand(rawRequest);
  if (request.command !== 'relation.add') fail(400, 'world_command_invalid', 'Expected relation.add');
  const conflict = () => fail(409, 'world_revision_conflict', 'World or relation endpoints changed; refresh and preview again');
  if (projection.world.id !== request.worldId || projection.world.revision !== request.baseRevision) conflict();
  const object = projection.objects.find(item => item.id === request.objectId);
  const target = projection.objects.find(item => item.id === request.targetObjectId);
  if (!object || !target) fail(404, 'world_relation_object_missing', 'Both relation endpoints must exist');
  if (object.revision !== request.objectRevision || target.revision !== request.targetRevision) conflict();
  if (!canRelateObject(object) || !canRelateObject(target)) fail(422, 'world_relation_read_only', 'Both endpoints need registration and available source');
  if (object.id === target.id) fail(422, 'world_relation_self', 'An object cannot relate to itself');
  const document = source.documents.find(item => item.record?.id === object.id);
  if (document.record.relations?.some(item => item.kind === request.kind && item.targetId === target.id)) {
    fail(409, 'world_relation_exists', 'This relation already exists');
  }
  const relation = { kind: request.kind, targetId: target.id, slot: request.slot };
  const edit = appendRelationRecord(recordContent, relation);
  if (canonicalJson(edit.before) !== canonicalJson(document.record)) conflict();
  const nextSource = { ...source, documents: source.documents.map(item => item === document ? {
    ...item, record: edit.after, descriptor: { ...item.descriptor, relations: edit.after.relations },
  } : item) };
  try { validateDocumentModels(nextSource.documents.filter(item => item.record).map(item => item.record)); }
  catch { fail(422, 'world_relation_cycle', 'This relation would create an invalid ownership graph'); }
  const next = await createWorldProjection(nextSource, { digest });
  const { mode, ...input } = request;
  const proposal = { format: 'viento-changeset', schemaVersion: 1, id: `proposal:${await digest(canonicalJson(input))}`,
    worldId: request.worldId, actorRef: request.actorRef, baseRevision: request.baseRevision,
    commands: [{ id: request.command, input }], preconditions: [object, target].map(item => ({ objectId: item.id, revision: item.revision })),
    affectedObjects: [object.id, target.id], state: 'proposed' };
  const recordPath = `metadata/documents/${object.id}.json`;
  const change = { kind: 'relation.add', objectId: object.id, sourcePath: document.sourcePath, targetObjectId: target.id,
    targetSourcePath: target.documentRefs[0].sourcePath, recordPath, relation,
    beforeRecordRevision: `sha256:${await digest(recordContent)}`, afterRecordRevision: `sha256:${await digest(edit.afterContent)}` };
  const registry = { documents: source.documents.filter(item => item.record).map(item => item.record), assets: source.assets.map(item => item.record) };
  return { kind: 'relation.add', nextSource, mutation: relation,
    registryHash: `sha256:${await digest(relationRegistryGuard(registry, object.id))}`,
    plans: [{ sourcePath: recordPath, beforeContent: recordContent, afterContent: edit.afterContent,
      change: { objectId: object.id, beforeSourceRevision: change.beforeRecordRevision, afterSourceRevision: change.afterRecordRevision } }],
    result: { status: 'preview', worldId: request.worldId, baseRevision: request.baseRevision, revision: next.world.revision,
      proposal, changes: [change], relation: next.relations.find(item => item.sourceObjectId === object.id
        && item.targetObjectId === target.id && item.properties.kind === request.kind) } };
}
