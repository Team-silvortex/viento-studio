// Camera authoring uses the same revision-checked source writer as runtime cases.
// Creation is exclusively camera2d.create, including its scene opt-in transaction.
import { readWorldSnapshot } from '../adapters/node-world-projection.mjs';
import { inspectCamera2DCreateScene } from '../../engine/world-camera2d-create.mjs';
import { inspectSceneCamera2DDocument, validateSceneCamera2DDependencies } from '../../engine/scene-camera2d.mjs';
import { parseJsonSource } from '../../engine/json-source.mjs';
import { createError } from '../../engine/service-error.mjs';
import { createRuntimeAuthorDocumentService } from './runtime-author-documents.mjs';
import { createSceneCamera2DFramingContext } from './scene-camera2d-framing.mjs';

const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const fail = (code, message, status = 400) => createError(status, message, {}, code);
export function createSceneCamera2DDocumentService(root, options) {
  const documents = createRuntimeAuthorDocumentService(root, { prefix: 'scene_camera2d', inspect: inspectSceneCamera2DDocument,
    definition: value => value.camera,
    dependencies(value, record, source) {
      const diagnostics = [...validateSceneCamera2DDependencies(value, record, source)];
      const scene = source.documents.find(item => item.record?.id === value.sceneObjectId);
      const selected = scene?.record?.relations?.filter(item => item.kind === 'references' && item.slot === 'camera2d') || [];
      if (selected.length !== 1 || selected[0].targetId !== record.id) diagnostics.push({ code: 'scene_camera2d_selection_conflict',
        message: 'The selected scene camera changed; refresh before saving.', propertyPath: '/sceneObjectId' });
      return diagnostics;
    },
  }, options);
  return Object.freeze({
    async inspect(sceneId) {
      if (!uuid(sceneId)) throw fail('scene_camera2d_request', 'Select a registered scene.');
      const observed = await readWorldSnapshot(root);
      const { scene, manifest, targets } = inspectCamera2DCreateScene(observed.source, observed.projection, sceneId);
      const objects = new Map(observed.projection.objects.map(item => [item.id, item]));
      const context = { format: 'viento-camera2d-author-context', schemaVersion: 1,
        worldId: observed.projection.world.id, baseRevision: observed.projection.world.revision,
        documentRoot: observed.source.definition.paths.documents,
        documentTypes: observed.source.definition.documentTypes.map(item => ({ id: item.id, label: item.label || item.id })),
        scene: { objectId: sceneId, objectRevision: objects.get(sceneId).revision,
          sourcePath: scene.sourcePath, sourceRevision: scene.sourceRevision, viewport: parseJsonSource(scene.content).value.viewport },
        targets,
        manifest: manifest ? { objectId: manifest.record.id, sourcePath: manifest.sourcePath,
          sourceRevision: manifest.sourceRevision, content: manifest.content } : null };
      try { context.framing = createSceneCamera2DFramingContext(observed, sceneId, context); context.framingDiagnostics = []; }
      catch {
        context.framing = null;
        context.framingDiagnostics = [{ code: 'scene_camera2d_framing_unavailable',
          message: 'Camera composition references are unavailable; the numeric camera form remains available.',
          objectId: sceneId, sourcePath: scene.sourcePath, sourceRevision: scene.sourceRevision, propertyPath: '' }];
      }
      return context;
    },
    async save(input) {
      if (!uuid(input?.documentId) || input.sourcePath !== undefined || input.documentType !== undefined) {
        throw fail('scene_camera2d_request', 'Create a camera with its scene relation before updating its source.');
      }
      return documents.save(input);
    },
  });
}
