// Read-only creation catalog. No backend, process, asset-body, or write access.
import { readWorldSnapshot } from '../adapters/node-world-projection.mjs';
import { inspectSceneComposition } from '../../engine/scene-composition-document.mjs';
import { renderProjectionRuntime } from '../../engine/object-projection-template.mjs';
import { validateCompositionCreateCatalog } from '../../engine/scene-composition-create.mjs';
import { createError } from '../../engine/service-error.mjs';

const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const revision = value => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
const label = value => String(value).slice(0, 160).replace(/[\ud800-\udbff]$/, '');
export function createSceneCompositionCreateService(root) {
  return Object.freeze({ async inspect() {
    const { source, projection } = await readWorldSnapshot(root);
    if (![2, 3].includes(source.workspace.version)) throw createError(422, 'Composition creation requires a registered workspace.', {}, 'composition_authoring_unavailable');
    const byId = new Map(projection.objects.map(object => [object.id, object]));
    const errors = new Set(projection.diagnostics.filter(issue => issue.severity === 'error').map(issue => issue.objectId));
    const knownTypes = new Set(source.definition.documentTypes.map(type => type.id));
    const objects = [];
    for (const document of source.documents) {
      const record = document.record, object = byId.get(record?.id);
      if (!uuid(record?.id) || !object || object.provenance.identity !== 'registered' || record.sourcePath !== document.sourcePath
        || !knownTypes.has(record.documentType) || errors.has(record.id) || !revision(document.sourceRevision)
        || typeof document.content !== 'string' || inspectSceneComposition(document.content).recognized) continue;
      let canInheritProjection = false;
      if (Object.hasOwn(object.provenance, 'authoredProjection')) {
        try { canInheritProjection = Boolean(object.provenance.authoredProjection && renderProjectionRuntime(object.provenance.authoredProjection)); }
        catch { continue; }
        if (!canInheritProjection) continue;
      }
      objects.push({ id: record.id, name: label(object.name || record.id), sourcePath: document.sourcePath,
        sourceRevision: document.sourceRevision, canInheritProjection });
    }
    const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
    const value = { format: 'viento-scene-composition-create-context', schemaVersion: 1,
      worldId: projection.world.id, worldRevision: projection.world.revision, documentRoot: source.definition.paths.documents,
      documentTypes: source.definition.documentTypes.map(type => ({ id: type.id, label: type.label })),
      existingPaths: source.documents.map(document => document.sourcePath).sort(compare),
      existingIdentities: [...new Set([...projection.objects.map(object => object.id), ...projection.resources.map(resource => resource.id)].filter(uuid))].sort(compare),
      objects: objects.sort((a, b) => compare(a.sourcePath, b.sourcePath)) };
    try { return validateCompositionCreateCatalog(value); }
    catch { throw createError(413, 'The composition creation catalog exceeds its supported bounds.', {}, 'composition_authoring_limit'); }
  } });
}
