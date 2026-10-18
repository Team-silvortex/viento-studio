// Readonly first-animation context. Scene identity and saved declarations are
// sufficient; creation does not require an engine, script or playable media.
import '../adapters/node-studio-core.mjs';
import { readWorldSnapshot } from '../adapters/node-world-projection.mjs';
import { inspectAnimationCreateScene } from '../../engine/world-animation-create.mjs';
import { captureSceneAnimationCreationContext } from '../../engine/scene-animation-creation-contract.mjs';
import { parseJsonSource } from '../../engine/json-source.mjs';
import { createError } from '../../engine/service-error.mjs';

const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const fail = () => { throw createError(400, 'Invalid animation creation context request.', {}, 'world_command_invalid'); };
function requestedScene(payload) {
  try {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload) || ![Object.prototype, null].includes(Object.getPrototypeOf(payload))) fail();
    const keys = Reflect.ownKeys(payload), property = Object.getOwnPropertyDescriptor(payload, 'sceneObjectId');
    if (keys.length !== 1 || keys[0] !== 'sceneObjectId' || !property?.enumerable || !Object.hasOwn(property, 'value') || !uuid(property.value)) fail();
    return property.value;
  } catch { fail(); }
}
export function createSceneAnimationCreationService(root) {
  return Object.freeze({ async inspect(payload) {
    const sceneObjectId = requestedScene(payload), observed = await readWorldSnapshot(root);
    const { scene, manifest, targets } = inspectAnimationCreateScene(observed.source, observed.projection, sceneObjectId);
    const objects = new Map(observed.projection.objects.map(object => [object.id, object]));
    const context = { format: 'viento-animation-creation-context', schemaVersion: 1, status: manifest ? 'ready' : 'empty',
      worldId: observed.projection.world.id, baseRevision: observed.projection.world.revision,
      documentRoot: observed.source.definition.paths.documents,
      documentTypes: observed.source.definition.documentTypes.map(type => ({ id: type.id, label: type.label })),
      scene: { objectId: sceneObjectId, objectRevision: objects.get(sceneObjectId).revision,
        sourcePath: scene.sourcePath, sourceRevision: scene.sourceRevision }, targets,
      manifest: manifest ? { objectId: manifest.record.id, objectRevision: objects.get(manifest.record.id).revision,
        sourcePath: manifest.sourcePath, sourceRevision: manifest.sourceRevision,
        documentType: manifest.record.documentType, parserProfile: manifest.record.parserProfile, content: manifest.content,
        relations: structuredClone(manifest.record.relations), assetBindings: structuredClone(manifest.record.assetBindings),
        trackCount: parseJsonSource(manifest.content).value.tracks.length } : null };
    try { return captureSceneAnimationCreationContext(context, sceneObjectId); }
    catch { throw createError(422, 'Animation creation context is unavailable.', {}, 'world_animation_invalid'); }
  } });
}
