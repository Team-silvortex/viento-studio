import { parseDocument, isMap } from 'yaml';
import { validateWorldCommand } from './world-command-contract.mjs';
import { validateObjectProjection, validateProjectionDependencies } from './object-projection.mjs';
import { appendResourceBinding } from './world-resources.mjs';
import { registrationGuard } from './world-record-edit.mjs';
import { createWorldProjection, canonicalJson } from './world-projection.mjs';
import { createError } from './service-error.mjs';

const fail = (status, code, message, payload = {}) => { throw createError(status, message, payload, code); };
const invalid = (message, propertyPath = '', diagnostics) => fail(422, 'world_projection_invalid', message, {
  diagnostics: diagnostics?.length ? diagnostics : [{ severity: 'error', code: 'object-projection-invalid', message, propertyPath }],
});
const pointer = value => value.replaceAll('~', '~0').replaceAll('/', '~1');

// The same restricted transformation is used by planning and recovery. Only
// changed scalar tokens are replaced; candidate whitespace and key order are
// never copied over the author's source or the frozen template.
export async function updateObjectProjectionContent(beforeContent, candidateContent, record, { digest }) {
  const before = await validateObjectProjection(beforeContent, record, { digest });
  const candidate = await validateObjectProjection(candidateContent, record, { digest });
  for (const checked of [before, candidate]) if (!checked.recognized || !checked.ok) {
    invalid('An available valid object projection is required', '', checked.diagnostics);
  }
  for (const key of ['format', 'schemaVersion', 'sourceObjectId', 'template']) {
    if (canonicalJson(before.value[key]) !== canonicalJson(candidate.value[key])) invalid('Projection identity and template are fixed', `/${key}`);
  }
  const offset = beforeContent.startsWith('\uFEFF') ? 1 : 0;
  const parsed = parseDocument(beforeContent.slice(offset), { keepSourceTokens: true, intAsBigInt: true, uniqueKeys: true });
  if (parsed.errors.length || !isMap(parsed.contents)) invalid('Projection source cannot be edited losslessly');
  const find = (node, key) => node.items.find(item => item.key?.value === key)?.value;
  const configuration = find(parsed.contents, 'configuration');
  if (!isMap(configuration)) invalid('Projection configuration cannot be edited losslessly', '/configuration');
  const replacements = [];
  const replace = (node, oldValue, value, propertyPath) => {
    if (canonicalJson(oldValue) === canonicalJson(value)) return;
    if (!node?.range || !Number.isInteger(node.range[0]) || !Number.isInteger(node.range[1])) invalid('Projection value has no source range', propertyPath);
    replacements.push({ start: node.range[0] + offset, end: node.range[1] + offset, text: JSON.stringify(value), propertyPath });
  };
  replace(find(parsed.contents, 'title'), before.value.title, candidate.value.title, '/title');
  for (const field of before.value.template.snapshot.fields) replace(find(configuration, field.id),
    before.value.configuration[field.id], candidate.value.configuration[field.id], `/configuration/${pointer(field.id)}`);
  let afterContent = beforeContent;
  for (const edit of [...replacements].sort((a, b) => b.start - a.start)) {
    afterContent = afterContent.slice(0, edit.start) + edit.text + afterContent.slice(edit.end);
  }
  const after = await validateObjectProjection(afterContent, record, { digest });
  if (!after.ok || canonicalJson(after.value) !== canonicalJson(candidate.value)) invalid('Projection values cannot be represented without changing other data', '', after.diagnostics);
  return { before: before.value, after: after.value, afterContent, changedPaths: replacements.map(item => item.propertyPath) };
}

// Append only newly required image identities. Older bindings remain valid for
// explicit scene overrides and other consumers of the same authored object.
export function appendProjectionImageBindings(recordContent, declaration) {
  let before;
  try { before = JSON.parse(recordContent); } catch { invalid('Projection registration is not valid JSON'); }
  if (!Array.isArray(before.assetBindings)) invalid('Projection images must have a registered binding list');
  let after = before, afterContent = recordContent;
  const addedBindings = [];
  for (const field of declaration.template.snapshot.fields.filter(item => item.type === 'image')) {
    const assetId = declaration.configuration[field.id];
    if (!assetId || after.assetBindings.some(item => item.assetId === assetId)) continue;
    const binding = { assetId, role: 'image' }, edit = appendResourceBinding(afterContent, binding);
    after = edit.after; afterContent = edit.afterContent; addedBindings.push(binding);
  }
  return { before, after, afterContent, addedBindings };
}

export async function prepareProjectionUpdate(source, projection, recordContent, rawRequest, { digest }) {
  const request = validateWorldCommand(rawRequest);
  if (request.command !== 'projection.update') fail(400, 'world_command_invalid', 'Expected projection.update');
  const conflict = () => fail(409, 'world_revision_conflict', 'World, object or source changed; refresh and preview again');
  if (projection.world.id !== request.worldId || projection.world.revision !== request.baseRevision) conflict();
  const object = projection.objects.find(item => item.id === request.objectId);
  if (!object) fail(404, 'world_object_not_found', 'Object not found');
  if (object.revision !== request.objectRevision || object.documentRefs[0]?.sourceRevision !== request.sourceRevision) conflict();
  const document = source.documents.find(item => item.record?.id === object.id), sourcePath = document?.sourcePath || '';
  try {
    if (![2, 3].includes(source.workspace.version) || !document || !sourcePath.toLowerCase().endsWith('.json')
      || !source.definition.documentTypes.some(item => item.id === document.record.documentType)
      || !object.provenance.authoredProjection || projection.diagnostics.some(item => item.objectId === object.id && item.severity === 'error')) {
      invalid('An available valid registered projection is required');
    }
    if (typeof document.content !== 'string' || `sha256:${await digest(document.content)}` !== request.sourceRevision) conflict();
    const edit = await updateObjectProjectionContent(document.content, request.content, document.record, { digest });
    const metadata = appendProjectionImageBindings(recordContent, edit.after);
    if (canonicalJson(metadata.before) !== canonicalJson(document.record)) conflict();
    for (const [value, record] of [[edit.before, metadata.before], [edit.after, metadata.after]]) {
      const diagnostics = validateProjectionDependencies(value, record, source);
      if (diagnostics.length) invalid('Projection dependencies are invalid', '', diagnostics);
    }
    const afterSourceRevision = `sha256:${await digest(edit.afterContent)}`;
    const nextSource = { ...source, documents: source.documents.map(item => item === document ? {
      ...item, content: edit.afterContent, sourceRevision: afterSourceRevision, record: metadata.after,
      descriptor: { ...item.descriptor, assetBindings: metadata.after.assetBindings },
    } : item) };
    const next = await createWorldProjection(nextSource, { digest });
    const diagnostics = next.diagnostics.filter(item => item.objectId === object.id && item.severity === 'error');
    if (diagnostics.length) invalid('Projection dependencies are invalid', '', diagnostics);
    const { mode, ...input } = request;
    const proposal = { format: 'viento-changeset', schemaVersion: 1, id: `proposal:${await digest(canonicalJson(input))}`,
      worldId: request.worldId, actorRef: request.actorRef, baseRevision: request.baseRevision,
      commands: [{ id: request.command, input }], preconditions: [{ objectId: object.id, revision: object.revision }],
      affectedObjects: [object.id], state: 'proposed' };
    const recordPath = `metadata/documents/${object.id}.json`;
    const change = { kind: 'projection.update', objectId: object.id, sourcePath, recordPath, changedPaths: edit.changedPaths,
      addedBindings: metadata.addedBindings, beforeSourceRevision: request.sourceRevision, afterSourceRevision,
      beforeRecordRevision: `sha256:${await digest(recordContent)}`, afterRecordRevision: `sha256:${await digest(metadata.afterContent)}` };
    const registry = { documents: source.documents.filter(item => item.record).map(item => item.record), assets: (source.assets || []).map(item => item.record) };
    return { kind: 'projection.update', nextSource, registryHash: `sha256:${await digest(registrationGuard(registry, object.id))}`,
      plans: [{ sourcePath, beforeContent: document.content, afterContent: edit.afterContent, change },
        { sourcePath: recordPath, beforeContent: recordContent, afterContent: metadata.afterContent,
          change: { objectId: object.id, beforeSourceRevision: change.beforeRecordRevision, afterSourceRevision: change.afterRecordRevision } }],
      result: { status: 'preview', worldId: request.worldId, baseRevision: request.baseRevision, revision: next.world.revision,
        proposal, changes: [{ ...change, afterText: edit.afterContent }], object: next.objects.find(item => item.id === object.id) } };
  } catch (error) {
    if (error.errorCode === 'world_projection_invalid') error.payload.diagnostics = error.payload.diagnostics.map(item => ({ ...item, objectId: object.id, sourcePath }));
    throw error;
  }
}
