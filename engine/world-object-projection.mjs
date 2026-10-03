import { validateWorldCommand } from './world-command-contract.mjs';
import { prepareObjectCreate } from './world-object-create.mjs';
import { createWorldProjection, canonicalJson } from './world-projection.mjs';
import { validateObjectProjection, projectionRegistration } from './object-projection.mjs';
import { registrationGuard } from './world-record-edit.mjs';
import { createError } from './service-error.mjs';

const invalid = diagnostics => { throw createError(422, 'The object projection is invalid', { diagnostics }, 'world_projection_invalid'); };

export async function prepareProjectionCreate(source, projection, rawRequest, { digest }) {
  const request = validateWorldCommand(rawRequest);
  if (request.command !== 'projection.create') throw createError(400, 'Expected projection.create', {}, 'world_command_invalid');
  const reject = diagnostics => invalid(diagnostics.map(item => ({ ...item, objectId: request.objectId, sourcePath: request.sourcePath })));
  const checked = await validateObjectProjection(request.content, {}, { digest });
  if (!request.sourcePath.toLowerCase().endsWith('.json') || !checked.recognized || !checked.ok) reject(checked.diagnostics.length ? checked.diagnostics
    : [{ severity: 'error', code: 'object-projection-invalid', message: 'Expected a JSON object projection declaration', propertyPath: '' }]);
  const base = await prepareObjectCreate(source, projection, { ...request, command: 'object.create' }, { digest });
  const change = { ...base.result.changes[0], kind: 'projection.create', record: projectionRegistration(base.result.changes[0].record, checked.value) };
  const nextSource = { ...base.nextSource, documents: base.nextSource.documents.map(item => item.record?.id === request.objectId
    ? { ...item, record: change.record, descriptor: { ...item.descriptor, ...change.record } } : item) };
  const next = await createWorldProjection(nextSource, { digest });
  const diagnostics = next.diagnostics.filter(item => item.objectId === request.objectId && item.severity === 'error');
  if (diagnostics.length) reject(diagnostics);
  const core = projection.objects.find(item => item.id === checked.value.sourceObjectId);
  const { mode, ...input } = request;
  const proposal = { ...base.result.proposal, id: `proposal:${await digest(canonicalJson(input))}`,
    commands: [{ id: request.command, input }], preconditions: [{ objectId: core.id, revision: core.revision }] };
  const registry = { documents: source.documents.filter(item => item.record).map(item => item.record), assets: (source.assets || []).map(item => item.record) };
  const recordContent = `${JSON.stringify(change.record, null, 2)}\n`;
  return { kind: 'projection.create', nextSource, registryHash: `sha256:${await digest(registrationGuard(registry, request.objectId))}`,
    plans: [{ ...base.plans[0], change }, { ...base.plans[1], afterContent: recordContent,
      change: { ...base.plans[1].change, afterSourceRevision: `sha256:${await digest(recordContent)}` } }],
    result: { ...base.result, revision: next.world.revision, proposal, changes: [change], object: next.objects.find(item => item.id === request.objectId) } };
}
