import { parseSourceContent } from './parse.mjs';
import { createDocumentFieldDraft } from './fields.mjs';
import { sourceFileName } from './source-path.mjs';
import { validateObjectProjection, validateProjectionDependencies } from './object-projection.mjs';

// Hashing is supplied by the host. The projection owns no filesystem, clock,
// cache or write operation, and never promotes parsed values to stored records.
export { canonicalJson } from './canonical-json.mjs';
import { canonicalJson } from './canonical-json.mjs';

const copy = value => JSON.parse(JSON.stringify(value));
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const byId = (a, b) => compare(a.id, b.id);
const typeRef = id => `io.viento.document/${encodeURIComponent(id)}`;

export async function createWorldProjection({ workspace, definition, documents, assets = [], diagnostics = [] }, { digest }) {
  if (!workspace?.id || ![1, 2, 3].includes(workspace.version)) throw new Error('A supported, identified workspace is required');
  const hash = async value => {
    const result = await digest(canonicalJson(value));
    if (!/^[a-f0-9]{64}$/.test(result)) throw new Error('Projection digest must be SHA-256 hex');
    return result;
  };
  const revision = async value => `sha256:${await hash(value)}`;
  const worldId = `world:${await hash(['viento-legacy-world', 1, workspace.id])}`;
  const issues = copy(diagnostics), objects = [], relations = [], resourceBindings = [];
  const issue = (code, objectId, sourcePath, severity = 'warning') => issues.push({ code, severity, objectId, sourcePath });
  const types = definition.documentTypes.map(type => ({ id: typeRef(type.id), version: 1, label: type.label,
    authorityKind: 'document', readOnly: true, definition: copy(type) })).sort(byId);
  if (!types.some(type => type.id === typeRef('document'))) types.push({ id: typeRef('document'), version: 1,
    label: 'Document', authorityKind: 'document', readOnly: true, definition: {} });
  const knownTypes = new Set(types.map(type => type.id));
  const ids = new Set(), paths = new Set(), authored = new Map();
  for (const source of [...documents].sort((a, b) => compare(a.sourcePath, b.sourcePath))) {
    const { sourcePath, record = null, descriptor = {}, content = null, sourceRevision = null } = source;
    const id = record?.id || `legacy-document:${await hash([workspace.id, sourcePath])}`;
    if (ids.has(id) || paths.has(sourcePath)) throw new Error('Duplicate object identity or source path');
    ids.add(id); paths.add(sourcePath);
    const registeredType = descriptor.documentType || 'document';
    const known = knownTypes.has(typeRef(registeredType));
    const object = { format: 'viento-object', schemaVersion: 1, id, worldId,
      typeRef: known ? typeRef(registeredType) : typeRef('document'), typeVersion: 1,
      revision: await revision({ sourcePath, content, sourceRevision, record, descriptor }), readOnly: true,
      name: sourceFileName(sourcePath), properties: {}, propertyBindings: [], behaviorBindings: [],
      documentRefs: [{ sourcePath, sourceRevision }],
      provenance: { identity: record ? 'registered' : 'path-derived', workspaceVersion: workspace.version,
        documentType: registeredType, descriptor: copy(record), parser: copy(descriptor) } };
    if (!record) issue('unregistered-document', id, sourcePath);
    if (!known) issue('unknown-document-type', id, sourcePath);
    const projected = await validateObjectProjection(content, record, { digest });
    if (projected.recognized) {
      object.provenance.authoredProjection = projected.ok ? copy({ sourceObjectId: projected.value.sourceObjectId,
        template: projected.value.template, configuration: projected.value.configuration }) : null;
      for (const diagnostic of projected.diagnostics) issues.push({ ...diagnostic, objectId: id, sourcePath });
      if (projected.ok) {
        authored.set(id, { object, source, declaration: projected.value });
        if (!sourcePath.toLowerCase().endsWith('.json')) issue('object-projection-invalid', id, sourcePath, 'error');
      }
    }
    if (content === null) issue('source-unavailable', id, sourcePath, 'error');
    else {
      try {
        const parsedTitle = parseSourceContent(content, sourcePath, descriptor).title;
        object.name = projected.recognized && projected.ok ? projected.value.title : parsedTitle || object.name;
        const draft = createDocumentFieldDraft(content, sourcePath, descriptor);
        for (const field of draft.fields) {
          // Template locks and the OC identity are not scalar edit targets.
          // Image configuration needs a registration transaction and cannot be
          // edited by property.set, which only replaces one source file.
          const configurationField = projected.value?.template.snapshot.fields.find(item => item.id === field.label);
          if (projected.recognized && (field.key !== 'title' && field.key !== 'configuration'
            || field.key === 'configuration' && (!configurationField || configurationField.type === 'image'))) continue;
          // A field ordinal is only meaningful together with this source revision.
          // Values retain their lexical precision (including very large numbers).
          const key = `field-${field.id}`;
          object.properties[key] = { label: configurationField?.label || field.label, group: field.group || '', kind: field.kind, value: field.value };
          object.propertyBindings.push({ propertyPath: `/properties/${key}`, authorityKind: 'document',
            authorityRef: { sourcePath, range: { start: field.start, end: field.end, unit: 'utf16' } }, sourceRevision });
        }
        if (draft.omitted) issue('unmapped-fields', id, sourcePath);
      } catch {
        object.properties = {}; object.propertyBindings = [];
        issue('unparsed-document', id, sourcePath, 'error');
      }
    }
    for (const relation of record?.relations || []) relations.push({ id: `relation:${await hash([id, relation])}`,
      worldId, sourceObjectId: id, targetObjectId: relation.targetId, typeRef: `io.viento.relation/${encodeURIComponent(relation.kind)}`,
      properties: copy(relation) });
    for (const binding of record?.assetBindings || []) resourceBindings.push({ id: `binding:${await hash([id, binding])}`,
      objectId: id, resourceId: binding.assetId, slot: binding.role, descriptor: copy(binding) });
    objects.push(object);
  }
  const resources = assets.map(({ record, availability = 'unverified' }) => ({ id: record.id, kind: 'file',
    revision: null, descriptor: copy(record), availability, contentVerified: false }));
  for (const resource of resources) resource.revision = await revision(resource.descriptor);
  const resourceIds = new Set(resources.map(resource => resource.id));
  for (const relation of relations) if (!ids.has(relation.targetObjectId)) issue('relation-target-missing', relation.sourceObjectId, '', 'error');
  for (const binding of resourceBindings) if (!resourceIds.has(binding.resourceId)) issue('resource-target-missing', binding.objectId, '', 'error');
  for (const resource of resources) if (resource.availability !== 'present-unverified') issues.push({
    code: 'resource-unavailable', severity: 'warning', resourceId: resource.id, availability: resource.availability });
  for (const [id, { object, source, declaration }] of authored) {
    const dependencies = validateProjectionDependencies(declaration, source.record || { id }, { documents, assets });
    if (issues.some(item => item.objectId === declaration.sourceObjectId && item.severity === 'error')) dependencies.push({
      severity: 'error', code: 'object-projection-invalid', message: 'Projection source has invalid content', propertyPath: '/sourceObjectId', relatedObjectId: declaration.sourceObjectId });
    for (const diagnostic of dependencies) issues.push({ ...diagnostic, objectId: id, sourcePath: source.sourcePath });
    if (issues.some(item => item.objectId === id && item.severity === 'error')) object.provenance.authoredProjection = null;
  }
  objects.sort(byId); relations.sort(byId); resources.sort(byId); resourceBindings.sort(byId); types.sort(byId);
  const world = { format: 'viento-world', schemaVersion: 1, id: worldId, projectId: workspace.id, name: workspace.name,
    revision: await revision({ projectionVersion: 1, workspace, definition,
      objects: objects.map(({ id, revision }) => ({ id, revision })), assets: resources.map(resource => resource.descriptor) }),
    readOnly: true, authorityKind: 'document', sourceWorkspaceVersion: workspace.version,
    typePackageRefs: ['io.viento.document@1'], environmentRefs: [], buildTargetRefs: [] };
  return { format: 'viento-world-projection', schemaVersion: 1, world, types, objects, relations, resources, resourceBindings,
    diagnostics: issues.sort((a, b) => compare(canonicalJson(a), canonicalJson(b))) };
}
