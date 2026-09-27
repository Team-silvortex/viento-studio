import { createError } from './service-error.mjs';
import { worldMutationDescriptors } from './world-command-contract.mjs';

export const WORLD_API_PATH = '/api/world';
const revisionSchema = { type: 'string', pattern: '^sha256:[a-f0-9]{64}$' };
const inputs = {
  'world.inspect': {},
  'object.list': { search: { type: 'string', maxLength: 200 }, typeRef: { type: 'string', maxLength: 200 } },
  'object.inspect': { objectId: { type: 'string', minLength: 1, maxLength: 200 } },
  'world.validate': {},
};

export function worldCommandDescriptors() {
  return JSON.parse(JSON.stringify(Object.entries(inputs).map(([id, properties]) => ({ format: 'viento-command', schemaVersion: 1, id, version: 1,
    inputSchema: { type: 'object', properties: { ...properties, expectedRevision: revisionSchema },
      required: id === 'object.inspect' ? ['objectId'] : [], additionalProperties: false },
    outputSchema: { type: 'object', required: ['worldId', 'revision'], properties: { worldId: { type: 'string' }, revision: revisionSchema } },
    targetTypes: ['io.viento.document/World'], preconditions: ['supported-workspace', 'matching-revision-if-supplied'],
    effects: [], requiredCapabilities: ['world.read'], undoMode: 'none' }))));
}

export function validateWorldQuery(query = {}) {
  const { command = 'world.inspect', ...args } = query;
  const descriptor = worldCommandDescriptors().find(item => item.id === command);
  const invalid = () => { throw createError(400, 'Invalid world query', {}, 'world_query_invalid'); };
  if (!descriptor) invalid();
  for (const [key, value] of Object.entries(args)) {
    const rule = descriptor.inputSchema.properties[key];
    if (!Object.hasOwn(descriptor.inputSchema.properties, key) || typeof value !== 'string' || value.length > (rule.maxLength || 200) || value.length < (rule.minLength || 0)
      || (rule.pattern && !new RegExp(rule.pattern).test(value))) invalid();
  }
  for (const key of descriptor.inputSchema.required) if (!Object.hasOwn(args, key)) invalid();
  return { command, ...args };
}

export function queryWorldProjection(projection, query = {}) {
  const { command, expectedRevision, ...args } = validateWorldQuery(query);
  const { world } = projection;
  if (expectedRevision && expectedRevision !== world.revision) throw createError(409, 'World projection changed; refresh before querying this revision',
    { currentRevision: world.revision, expectedRevision }, 'world_revision_conflict');
  const base = { worldId: world.id, revision: world.revision };
  if (command === 'world.inspect') return { ...base, ...projection, commands: [...worldCommandDescriptors(), ...worldMutationDescriptors()] };
  if (command === 'object.list') return { ...base, objects: projection.objects.filter(object =>
    (!args.typeRef || object.typeRef === args.typeRef) && (!args.search ||
      [object.name, object.id, object.documentRefs[0].sourcePath].some(value => value.toLowerCase().includes(args.search.toLowerCase()))))
    .map(({ id, name, typeRef, revision, documentRefs }) => ({ id, name, typeRef, revision, documentRefs })) };
  if (command === 'object.inspect') {
    const object = projection.objects.find(object => object.id === args.objectId);
    if (!object) throw createError(404, 'Object not found', {}, 'world_object_not_found');
    return { ...base, object };
  }
  return { ...base, valid: !projection.diagnostics.some(item => item.severity === 'error'), diagnostics: projection.diagnostics,
    scope: 'document-projection', resourceContentsVerified: false };
}
