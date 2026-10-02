import { createError } from './service-error.mjs';
import { validateWorldCommand, canRelateObject } from './world-command-contract.mjs';
import { appendRecordItem, registrationGuard } from './world-record-edit.mjs';
import { createWorldProjection, canonicalJson } from './world-projection.mjs';

const fail = (status, code, message) => { throw createError(status, message, {}, code); };

// Shared with recovery: a resource command can append exactly one binding,
// never change the document source, resource record or an existing binding.
export function appendResourceBinding(content, binding) {
  if (!binding || Object.keys(binding).length !== 2
    || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(binding.assetId)
    || typeof binding.role !== 'string' || !binding.role.trim() || binding.role.length > 200
    || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(binding.role)) {
    fail(422, 'world_record_invalid', 'Invalid resource binding');
  }
  const edit = appendRecordItem(content, 'assetBindings', binding);
  if (!Array.isArray(edit.before.assetBindings)) fail(422, 'world_record_invalid', 'Resource bindings must be registered');
  if (edit.before.assetBindings.some(item => item.assetId === binding.assetId && item.role === binding.role)) {
    fail(409, 'world_resource_binding_exists', 'This resource is already bound in this slot');
  }
  return edit;
}

export async function prepareResourceBind(source, projection, recordContent, rawRequest, { digest }) {
  const request = validateWorldCommand(rawRequest);
  if (request.command !== 'resource.bind') fail(400, 'world_command_invalid', 'Expected resource.bind');
  const conflict = () => fail(409, 'world_revision_conflict', 'World, object or resource registration changed; refresh and preview again');
  if (projection.world.id !== request.worldId || projection.world.revision !== request.baseRevision) conflict();
  const object = projection.objects.find(item => item.id === request.objectId);
  const resource = projection.resources.find(item => item.id === request.resourceId);
  if (!object || !resource) fail(404, 'world_resource_target_missing', 'The object and registered resource must exist');
  if (object.revision !== request.objectRevision || resource.revision !== request.resourceRevision) conflict();
  if (!canRelateObject(object)) fail(422, 'world_resource_read_only', 'The object needs registration and available source');
  const document = source.documents.find(item => item.record?.id === object.id);
  const mutation = { assetId: resource.id, role: request.slot };
  const edit = appendResourceBinding(recordContent, mutation);
  if (canonicalJson(edit.before) !== canonicalJson(document.record)) conflict();
  const nextSource = { ...source, documents: source.documents.map(item => item === document ? {
    ...item, record: edit.after, descriptor: { ...item.descriptor, assetBindings: edit.after.assetBindings },
  } : item) };
  const next = await createWorldProjection(nextSource, { digest });
  const { mode, ...input } = request;
  const proposal = { format: 'viento-changeset', schemaVersion: 1, id: `proposal:${await digest(canonicalJson(input))}`,
    worldId: request.worldId, actorRef: request.actorRef, baseRevision: request.baseRevision,
    commands: [{ id: request.command, input }], preconditions: [{ objectId: object.id, revision: object.revision }],
    affectedObjects: [object.id], state: 'proposed' };
  const recordPath = `metadata/documents/${object.id}.json`;
  const change = { kind: 'resource.bind', objectId: object.id, sourcePath: document.sourcePath, resourceId: resource.id,
    resourceRevision: resource.revision, recordPath, binding: mutation,
    beforeRecordRevision: `sha256:${await digest(recordContent)}`, afterRecordRevision: `sha256:${await digest(edit.afterContent)}` };
  const registry = { documents: source.documents.filter(item => item.record).map(item => item.record), assets: source.assets.map(item => item.record) };
  return { kind: 'resource.bind', nextSource, mutation,
    registryHash: `sha256:${await digest(registrationGuard(registry, object.id))}`,
    plans: [{ sourcePath: recordPath, beforeContent: recordContent, afterContent: edit.afterContent,
      change: { objectId: object.id, beforeSourceRevision: change.beforeRecordRevision, afterSourceRevision: change.afterRecordRevision } }],
    result: { status: 'preview', worldId: request.worldId, baseRevision: request.baseRevision, revision: next.world.revision,
      proposal, changes: [change], binding: next.resourceBindings.find(item => item.objectId === object.id
        && item.resourceId === resource.id && item.slot === request.slot) } };
}
