import { createError } from './service-error.mjs';

export const WORLD_COMMAND_API_PATH = '/api/world/commands';
export const MAX_CHANGESET_COMMANDS = 32;
const revision = { type: 'string', pattern: '^sha256:[a-f0-9]{64}$' };
const identifier = { type: 'string', minLength: 1, maxLength: 200 };
const properties = {
  mode: { enum: ['preview', 'apply'] }, worldId: identifier, baseRevision: revision,
  objectId: identifier, objectRevision: revision, sourceRevision: revision,
  propertyPath: { type: 'string', pattern: '^/properties/field-[0-9]{1,4}$' },
  value: { type: 'string', maxLength: 262144 },
  actorRef: { type: 'object', properties: { kind: { enum: ['user', 'agent', 'tool'] }, id: identifier },
    required: ['kind', 'id'], additionalProperties: false },
};
const fail = (status, code, message, payload = {}) => { throw createError(status, message, payload, code); };
const batchProperties = { mode: properties.mode, worldId: identifier, baseRevision: revision, actorRef: properties.actorRef,
  commands: { type: 'array', minItems: 1, maxItems: MAX_CHANGESET_COMMANDS, items: { type: 'object',
    properties: { command: { const: 'property.set' }, ...Object.fromEntries(['objectId', 'objectRevision', 'sourceRevision', 'propertyPath', 'value'].map(key => [key, properties[key]])) },
    required: ['command', 'objectId', 'objectRevision', 'sourceRevision', 'propertyPath', 'value'], additionalProperties: false } } };
const createProperties = { mode: properties.mode, worldId: identifier, baseRevision: revision, actorRef: properties.actorRef,
  objectId: { type: 'string', pattern: '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' },
  documentType: { type: 'string', pattern: '^[a-z][a-z0-9_-]{0,63}$' },
  sourcePath: { type: 'string', minLength: 1, maxLength: 1024 }, content: { type: 'string', maxLength: 262144 } };
export const RELATION_KINDS = Object.freeze(['part-of', 'references']);
const relationProperties = { mode: properties.mode, worldId: identifier, baseRevision: revision, actorRef: properties.actorRef,
  objectId: createProperties.objectId, objectRevision: revision, targetObjectId: createProperties.objectId, targetRevision: revision,
  kind: { enum: [...RELATION_KINDS] }, slot: { type: 'string', maxLength: 200 } };
const resourceProperties = { mode: properties.mode, worldId: identifier, baseRevision: revision, actorRef: properties.actorRef,
  objectId: createProperties.objectId, objectRevision: revision, resourceId: createProperties.objectId, resourceRevision: revision,
  slot: { type: 'string', minLength: 1, maxLength: 200, pattern: '\\S' } };

export function worldMutationDescriptors() {
  return JSON.parse(JSON.stringify([{ format: 'viento-command', schemaVersion: 1, id: 'property.set', version: 1,
    inputSchema: { type: 'object', properties, required: Object.keys(properties), additionalProperties: false },
    outputSchema: { type: 'object', required: ['status', 'worldId', 'baseRevision', 'revision', 'proposal', 'change'],
      properties: { status: { enum: ['preview', 'applied', 'unchanged'] }, worldId: identifier, baseRevision: revision, revision } },
    targetTypes: ['io.viento.document/*'], preconditions: ['registered-object', 'known-document-type', 'matching-world-object-source-revisions', 'lossless-field-roundtrip'],
    effects: ['replace-one-document-property'], requiredCapabilities: ['world.read', 'document.write'], undoMode: 'inverse-command' },
  { format: 'viento-command', schemaVersion: 1, id: 'changeset.apply', version: 1,
    inputSchema: { type: 'object', properties: batchProperties, required: Object.keys(batchProperties), additionalProperties: false },
    outputSchema: { type: 'object', required: ['status', 'worldId', 'baseRevision', 'revision', 'proposal', 'changes'],
      properties: { status: { enum: ['preview', 'applied', 'unchanged'] }, worldId: identifier, baseRevision: revision, revision } },
    targetTypes: ['io.viento.document/*'], preconditions: ['one-property-per-object', 'matching-world-object-source-revisions', 'lossless-field-roundtrip'],
    effects: ['replace-document-properties-with-recovery'], requiredCapabilities: ['world.read', 'document.write'], undoMode: 'inverse-command' },
  { format: 'viento-command', schemaVersion: 1, id: 'object.create', version: 1,
    inputSchema: { type: 'object', properties: createProperties, required: Object.keys(createProperties), additionalProperties: false },
    outputSchema: { type: 'object', required: ['status', 'worldId', 'baseRevision', 'revision', 'proposal', 'changes', 'object'],
      properties: { status: { enum: ['preview', 'applied'] }, worldId: identifier, baseRevision: revision, revision } },
    targetTypes: ['io.viento.document/*'], preconditions: ['registered-workspace', 'known-document-type', 'matching-world-revision', 'unused-identity-and-source-path', 'parseable-source'],
    effects: ['create-document-and-registration-with-recovery'], requiredCapabilities: ['world.read', 'document.write'], undoMode: 'none' },
  { format: 'viento-command', schemaVersion: 1, id: 'relation.add', version: 1,
    inputSchema: { type: 'object', properties: relationProperties, required: Object.keys(relationProperties), additionalProperties: false },
    outputSchema: { type: 'object', required: ['status', 'worldId', 'baseRevision', 'revision', 'proposal', 'changes', 'relation'],
      properties: { status: { enum: ['preview', 'applied'] }, worldId: identifier, baseRevision: revision, revision } },
    targetTypes: ['io.viento.document/*'], preconditions: ['registered-endpoints-with-source', 'matching-world-and-endpoint-revisions', 'distinct-endpoints', 'unique-relation', 'acyclic-ownership'],
    effects: ['append-document-relation-with-recovery'], requiredCapabilities: ['world.read', 'document.write'], undoMode: 'none' },
  { format: 'viento-command', schemaVersion: 1, id: 'resource.bind', version: 1,
    inputSchema: { type: 'object', properties: resourceProperties, required: Object.keys(resourceProperties), additionalProperties: false },
    outputSchema: { type: 'object', required: ['status', 'worldId', 'baseRevision', 'revision', 'proposal', 'changes', 'binding'],
      properties: { status: { enum: ['preview', 'applied'] }, worldId: identifier, baseRevision: revision, revision } },
    targetTypes: ['io.viento.document/*'], preconditions: ['registered-object-with-source', 'registered-resource', 'matching-world-object-resource-revisions', 'unique-resource-slot-binding'],
    effects: ['append-resource-binding-with-recovery'], requiredCapabilities: ['world.read', 'document.write'], undoMode: 'none' }]));
}

export function validateWorldCommand(request) {
  const invalid = () => fail(400, 'world_command_invalid', 'Invalid world command request');
  if (!request || typeof request !== 'object' || Array.isArray(request) || !Object.hasOwn(request, 'command')) invalid();
  if (request.command === 'world.recover') {
    if (Object.keys(request).length !== 2 || !Object.hasOwn(request, 'mode') || request.mode !== 'apply') invalid();
    return { command: 'world.recover', mode: 'apply' };
  }
  if (!['property.set', 'changeset.apply', 'object.create', 'relation.add', 'resource.bind'].includes(request.command)) invalid();
  const check = (value, rule) => {
    if (rule.const) return value === rule.const;
    if (rule.enum) return rule.enum.includes(value);
    if (rule.type === 'array') return Array.isArray(value) && value.length >= rule.minItems && value.length <= rule.maxItems
      && Array.from(value).every(item => check(item, rule.items));
    if (rule.type === 'object') return value && typeof value === 'object' && !Array.isArray(value)
      && Object.keys(value).length === rule.required.length
      && rule.required.every(key => Object.hasOwn(value, key) && check(value[key], rule.properties[key]));
    return typeof value === 'string' && value.length >= (rule.minLength || 0) && value.length <= (rule.maxLength || 200)
      && (!rule.pattern || new RegExp(rule.pattern).test(value));
  };
  const rules = request.command === 'changeset.apply' ? batchProperties : request.command === 'object.create' ? createProperties
    : request.command === 'relation.add' ? relationProperties : request.command === 'resource.bind' ? resourceProperties : properties;
  if (Object.keys(request).length !== Object.keys(rules).length + 1
    || !Object.entries(rules).every(([key, rule]) => Object.hasOwn(request, key) && check(request[key], rule))) invalid();
  // Prevent UTF-8 encoding from replacing an unpaired UTF-16 surrogate on disk.
  const commands = request.command === 'changeset.apply' ? request.commands : [request];
  if (new Set(commands.map(item => item.objectId)).size !== commands.length) invalid();
  const malformed = value => typeof value === 'string' && /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value);
  if (commands.some(item => [item.value, item.content, item.sourcePath, item.slot].some(malformed))) invalid();
  return JSON.parse(JSON.stringify(request));
}

export function canSetObjectProperty(projection, object) {
  return object?.provenance.identity === 'registered' && Boolean(object.documentRefs[0]?.sourceRevision)
    && !projection.diagnostics.some(item => item.objectId === object.id
      && ['unknown-document-type', 'unparsed-document', 'source-unavailable'].includes(item.code));
}

export function canRelateObject(object) {
  return object?.provenance.identity === 'registered' && [2, 3].includes(object.provenance.workspaceVersion)
    && Boolean(object.documentRefs[0]?.sourceRevision);
}
