import { validateWorldCommand } from './world-command-contract.mjs';
import { createWorldProjection, canonicalJson } from './world-projection.mjs';
import { createProjectModel } from './project.mjs';
import { getCreatePathError, conflictsWithSourcePath } from './document-contract.mjs';
import { createError } from './service-error.mjs';

const fail = (status, code, message) => { throw createError(status, message, {}, code); };

// The caller supplies the identity and exact source, so preview, CLI and GUI
// agree on one object. A template is an authoring aid, never a second authority.
export async function prepareObjectCreate(source, projection, rawRequest, { digest }) {
  const request = validateWorldCommand(rawRequest);
  if (request.command !== 'object.create') fail(400, 'world_command_invalid', 'Expected object.create');
  if (projection.world.id !== request.worldId || projection.world.revision !== request.baseRevision) {
    fail(409, 'world_revision_conflict', 'World changed; refresh and preview again');
  }
  if (![2, 3].includes(source.workspace.version)) fail(422, 'world_create_unavailable', 'Object creation requires a registered v2 or v3 workspace');
  const type = source.definition.documentTypes.find(item => item.id === request.documentType);
  if (!type) fail(422, 'world_type_unknown', 'Choose a document type defined by this project');
  const { objectId, sourcePath, content } = request;
  if (getCreatePathError(sourcePath) || !sourcePath.startsWith(`${source.definition.paths.documents}/`)) {
    fail(400, 'world_create_path_invalid', 'Choose a portable source path inside the document root');
  }
  if (projection.objects.some(item => item.id === objectId) || projection.resources.some(item => item.id === objectId)) {
    fail(409, 'world_identity_conflict', 'This identity is already registered');
  }
  if (source.documents.some(item => conflictsWithSourcePath(sourcePath, item.sourcePath))) {
    fail(409, 'world_create_path_conflict', 'This source location is already reserved');
  }
  const record = { format: 'viento-document', version: 1, id: objectId, sourcePath,
    documentType: type.id, parserProfile: type.parserProfile, relations: [], assetBindings: [] };
  const model = createProjectModel({ paths: source.definition.paths, documentTypes: source.definition.documentTypes, templates: {} });
  const sourceRevision = `sha256:${await digest(content)}`;
  const nextSource = { ...source, documents: [...source.documents, { sourcePath, record, content, sourceRevision,
    descriptor: model.resolveDocumentDefinition(source.workspace, sourcePath, record) }] };
  const next = await createWorldProjection(nextSource, { digest });
  if (next.diagnostics.some(item => item.objectId === objectId && item.code === 'unparsed-document')) {
    fail(422, 'world_create_source_invalid', 'The source cannot be parsed in the selected format');
  }
  const { mode, ...input } = request;
  const proposal = { format: 'viento-changeset', schemaVersion: 1, id: `proposal:${await digest(canonicalJson(input))}`,
    worldId: request.worldId, actorRef: request.actorRef, baseRevision: request.baseRevision,
    commands: [{ id: request.command, input }], preconditions: [], affectedObjects: [objectId], state: 'proposed' };
  const change = { kind: 'object.create', objectId, sourcePath, beforeSourceRevision: null, afterSourceRevision: sourceRevision,
    beforeText: null, afterText: content, recordPath: `metadata/documents/${objectId}.json`, record };
  const recordContent = `${JSON.stringify(record, null, 2)}\n`;
  return { kind: 'object.create', nextSource, plans: [
    { sourcePath, beforeContent: null, afterContent: content, change },
    { sourcePath: change.recordPath, beforeContent: null, afterContent: recordContent,
      change: { objectId, beforeSourceRevision: null, afterSourceRevision: `sha256:${await digest(recordContent)}` } },
  ], result: { status: 'preview', worldId: request.worldId, baseRevision: request.baseRevision, revision: next.world.revision,
    proposal, changes: [change], object: next.objects.find(item => item.id === objectId) } };
}
