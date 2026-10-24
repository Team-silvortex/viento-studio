// Readonly first-physics context. Scene identity and saved declarations are
// sufficient; creation does not require an engine, script or playable media.
import '../adapters/node-studio-core.mjs';
import { readWorldSnapshot } from '../adapters/node-world-projection.mjs';
import { inspectPhysics2DCreateScene } from '../../engine/world-physics2d-create.mjs';
import { captureScenePhysics2DCreationContext } from '../../engine/scene-physics2d-creation-contract.mjs';
import { parseJsonSource } from '../../engine/json-source.mjs';
import { createError } from '../../engine/service-error.mjs';

const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const fail = () => { throw createError(400, 'Invalid physics2d creation context request.', {}, 'world_command_invalid'); };
function requestedScene(payload) {
  try {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload) || ![Object.prototype, null].includes(Object.getPrototypeOf(payload))) fail();
    const keys = Reflect.ownKeys(payload), property = Object.getOwnPropertyDescriptor(payload, 'sceneObjectId');
    if (keys.length !== 1 || keys[0] !== 'sceneObjectId' || !property?.enumerable || !Object.hasOwn(property, 'value') || !uuid(property.value)) fail();
    return property.value;
  } catch { fail(); }
}
export function createScenePhysics2DCreationService(root) {
  return Object.freeze({ async inspect(payload) {
    const sceneObjectId = requestedScene(payload), observed = await readWorldSnapshot(root);
    const { scene, manifest, targets } = inspectPhysics2DCreateScene(observed.source, observed.projection, sceneObjectId);
    const objects = new Map(observed.projection.objects.map(object => [object.id, object]));
    const context = { format: 'viento-physics2d-creation-context', schemaVersion: 1, status: manifest ? 'ready' : 'empty',
      worldId: observed.projection.world.id, baseRevision: observed.projection.world.revision,
      documentRoot: observed.source.definition.paths.documents,
      documentTypes: observed.source.definition.documentTypes.map(type => ({ id: type.id, label: type.label })),
      scene: { objectId: sceneObjectId, objectRevision: objects.get(sceneObjectId).revision,
        sourcePath: scene.sourcePath, sourceRevision: scene.sourceRevision }, targets,
      manifest: manifest ? { objectId: manifest.record.id, objectRevision: objects.get(manifest.record.id).revision,
        sourcePath: manifest.sourcePath, sourceRevision: manifest.sourceRevision,
        documentType: manifest.record.documentType, parserProfile: manifest.record.parserProfile, content: manifest.content,
        relations: structuredClone(manifest.record.relations), assetBindings: structuredClone(manifest.record.assetBindings),
        bodyCount: parseJsonSource(manifest.content).value.bodies.length } : null };
    try { return captureScenePhysics2DCreationContext(context, sceneObjectId); }
    catch { throw createError(422, 'Physics2D creation context is unavailable.', {}, 'world_physics2d_invalid'); }
  } });
}
