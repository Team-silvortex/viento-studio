import { createError } from './service-error.mjs';
import { canonicalJson } from './world-projection.mjs';
import { createDocumentFieldDraft } from './fields.mjs';
import { fieldValueValid, serializeFieldDraft } from './field-changes.mjs';
import { validateObjectProjection } from './object-projection.mjs';

import { validateWorldCommand, canSetObjectProperty } from './world-command-contract.mjs';
export { WORLD_COMMAND_API_PATH, worldMutationDescriptors, validateWorldCommand, canSetObjectProperty } from './world-command-contract.mjs';

const fail = (status, code, message, payload = {}) => { throw createError(status, message, payload, code); };

// The portable planner validates a snapshot and produces one exact source edit.
// Hosts own locking and publishing; this function never performs a write.
export async function preparePropertySet(projection, content, rawRequest, { digest }) {
  const request = validateWorldCommand(rawRequest), { world } = projection;
  if (request.command !== 'property.set') fail(400, 'world_command_invalid', 'Expected property.set');
  const conflict = () => fail(409, 'world_revision_conflict', 'World changed; refresh and preview again', { currentRevision: world.revision });
  if (world.id !== request.worldId || world.revision !== request.baseRevision) conflict();
  const object = projection.objects.find(item => item.id === request.objectId);
  if (!object) fail(404, 'world_object_not_found', 'Object not found');
  if (object.revision !== request.objectRevision || object.documentRefs[0].sourceRevision !== request.sourceRevision) conflict();
  if (!canSetObjectProperty(projection, object)) fail(422, 'world_property_read_only', 'This object does not support property commands');
  const sourcePath = object.documentRefs[0].sourcePath;
  if (typeof content !== 'string' || `sha256:${await digest(content)}` !== request.sourceRevision) conflict();
  const binding = object.propertyBindings.find(item => item.propertyPath === request.propertyPath);
  if (!binding) fail(400, 'world_property_not_found', 'Property is not mapped in this source revision');
  const model = createDocumentFieldDraft(content, sourcePath, object.provenance.parser);
  const index = model.fields.findIndex(field => `/properties/field-${field.id}` === request.propertyPath);
  const field = model.fields[index];
  if (!field || field.start !== binding.authorityRef.range.start || field.end !== binding.authorityRef.range.end) conflict();
  if (!fieldValueValid(field, request.value)) fail(422, 'world_property_value_invalid', 'Value does not match the property type');
  const values = model.fields.map(item => item.value); values[index] = request.value;
  const afterContent = serializeFieldDraft(content, model, values);
  if (Object.hasOwn(object.provenance, 'authoredProjection')) {
    const checked = await validateObjectProjection(afterContent, object.provenance.descriptor, { digest });
    if (!checked.ok || !checked.recognized) fail(422, 'world_projection_invalid', 'Projection value does not match its template', {
      diagnostics: checked.diagnostics.map(item => ({ ...item, objectId: object.id, sourcePath })) });
  }
  let after;
  try { after = createDocumentFieldDraft(afterContent, sourcePath, object.provenance.parser); }
  catch { fail(422, 'world_property_roundtrip', 'This value cannot be represented without changing the document structure'); }
  const expected = field.kind === 'number' && request.value !== field.value ? request.value.trim() : request.value;
  const normalize = value => model.format === 'text' ? value.replace(/\r\n|\r/g, '\n') : value;
  if (after.fields.length !== model.fields.length || after.omitted !== model.omitted
    || after.fields.some((item, i) => ['id', 'key', 'label', 'group', 'kind'].some(key => item[key] !== model.fields[i][key])
      || normalize(item.value) !== normalize(i === index ? expected : model.fields[i].value))) {
    fail(422, 'world_property_roundtrip', 'This value changes other fields or document structure; use the source editor');
  }
  const { mode, command, ...input } = request;
  const proposal = { format: 'viento-changeset', schemaVersion: 1,
    id: `proposal:${await digest(canonicalJson(input))}`, worldId: world.id, actorRef: request.actorRef,
    baseRevision: world.revision, commands: [{ id: command, input }],
    preconditions: [{ objectId: object.id, revision: object.revision }], affectedObjects: [object.id], state: 'proposed' };
  return { sourcePath, beforeContent: content, afterContent, proposal,
    change: { objectId: object.id, propertyPath: request.propertyPath, sourcePath, label: field.label,
      beforeValue: field.value, afterValue: after.fields[index].value,
      beforeSourceRevision: request.sourceRevision, afterSourceRevision: `sha256:${await digest(afterContent)}`,
      range: { start: field.start, end: field.end, unit: 'utf16' },
      beforeText: content.slice(field.start, field.end),
      afterText: afterContent.slice(field.start, afterContent.length - (content.length - field.end)) } };
}
