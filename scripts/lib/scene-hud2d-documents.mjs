// HUD authoring reads one registered scene snapshot. First creation goes
// through hud2d.create; subsequent saves use the ordinary revision guard.
import { readWorldSnapshot } from '../adapters/node-world-projection.mjs';
import { inspectHUD2DCreateScene } from '../../engine/world-hud2d-create.mjs';
import { inspectSceneHUD2DDocument, validateSceneHUD2DDependencies } from '../../engine/scene-hud2d.mjs';
import { parseJsonSource } from '../../engine/json-source.mjs';
import { createError } from '../../engine/service-error.mjs';
import { createRuntimeAuthorDocumentService } from './runtime-author-documents.mjs';

const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const fail = (code, message, status = 400) => createError(status, message, {}, code);
export function createSceneHUD2DDocumentService(root, options) {
  const documents = createRuntimeAuthorDocumentService(root, { prefix: 'scene_hud2d', sceneVersions: [1, 2, 3], inspect: inspectSceneHUD2DDocument,
    definition: value => value.elements,
    dependencies(value, record, source) {
      const diagnostics = [...validateSceneHUD2DDependencies(value, record, source)];
      const scene = source.documents.find(item => item.record?.id === value.sceneObjectId);
      const selected = scene?.record?.relations?.filter(item => item.kind === 'references' && item.slot === 'hud2d') || [];
      if (selected.length !== 1 || selected[0].targetId !== record.id) diagnostics.push({ code: 'scene_hud2d_selection_conflict',
        message: 'The selected scene HUD changed; refresh before saving.', propertyPath: '/sceneObjectId' });
      return diagnostics;
    },
  }, options);
  return Object.freeze({
    async inspect(sceneId) {
      if (!uuid(sceneId)) throw fail('scene_hud2d_request', 'Select a registered scene.');
      const observed = await readWorldSnapshot(root);
      const { scene, manifest } = inspectHUD2DCreateScene(observed.source, observed.projection, sceneId);
      const object = observed.projection.objects.find(item => item.id === sceneId);
      return { format: 'viento-hud2d-author-context', schemaVersion: 1,
        worldId: observed.projection.world.id, baseRevision: observed.projection.world.revision,
        documentRoot: observed.source.definition.paths.documents,
        documentTypes: observed.source.definition.documentTypes.map(item => ({ id: item.id, label: item.label || item.id })),
        scene: { objectId: sceneId, objectRevision: object.revision, sourcePath: scene.sourcePath,
          sourceRevision: scene.sourceRevision, viewport: parseJsonSource(scene.content).value.viewport },
        manifest: manifest ? { objectId: manifest.record.id, sourcePath: manifest.sourcePath,
          sourceRevision: manifest.sourceRevision, content: manifest.content } : null };
    },
    async save(input) {
      if (!uuid(input?.documentId) || input.sourcePath !== undefined || input.documentType !== undefined) {
        throw fail('scene_hud2d_request', 'Create a HUD with its scene relation before updating its source.');
      }
      return documents.save(input);
    },
  });
}
