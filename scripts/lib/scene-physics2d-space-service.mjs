// An observed saved-scene layout, independent of Build, engine installations,
// existing physics declarations and media-byte acquisition.
import { readWorldSnapshot } from '../adapters/node-world-projection.mjs';
import { resolveScene2DModel } from '../../engine/scene-model.mjs';
import { captureScenePhysics2DSpaceDirectory } from '../../engine/scene-physics2d-space.mjs';
import { getCreatePathError } from '../../engine/document-contract.mjs';
import { canRelateObject } from '../../engine/world-command-contract.mjs';
import { createError } from '../../engine/service-error.mjs';

const uuid = value => typeof value === 'string' && value.length === 36 && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const fail = kind => { throw createError({ invalid: 400, conflict: 409, unavailable: 422, limit: 413 }[kind], {
  invalid: 'Invalid saved scene physics space.', conflict: 'Scene sources changed; read the space again.',
  unavailable: 'The registered scene space is unavailable.', limit: 'Scene sources exceed the read limits.',
}[kind], {}, `scene_physics2d_space_${kind}`); };
function requestScene(input) {
  try {
    if (!input || typeof input !== 'object' || Array.isArray(input) || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) fail('invalid');
    const keys = Reflect.ownKeys(input), descriptor = Object.getOwnPropertyDescriptor(input, 'sceneObjectId');
    if (keys.length !== 1 || keys[0] !== 'sceneObjectId' || !descriptor?.enumerable || !Object.hasOwn(descriptor, 'value') || !uuid(descriptor.value)) fail('invalid');
    return descriptor.value;
  } catch { fail('invalid'); }
}
export function createScenePhysics2DSpaceService(root) {
  return Object.freeze({ async inspect(input) {
    const sceneObjectId = requestScene(input);
    let observed;
    try { observed = await readWorldSnapshot(root); }
    catch (error) {
      if (['world_read_conflict', 'world_recovery_required', 'world_journal_invalid'].includes(error.errorCode)) fail('conflict');
      fail(error.statusCode === 413 ? 'limit' : 'unavailable');
    }
    const { source, projection } = observed;
    if (![2, 3].includes(source.workspace?.version)) fail('unavailable');
    const document = source.documents.find(item => item.record?.id === sceneObjectId);
    if (!document || typeof document.content !== 'string' || !canRelateObject(projection.objects.find(item => item.id === sceneObjectId))) fail('unavailable');
    const documentRoot = source.definition.paths.documents;
    if (typeof documentRoot !== 'string' || !documentRoot || getCreatePathError(`${documentRoot}/scene.json`)) fail('invalid');
    const resolved = resolveScene2DModel(observed, sceneObjectId);
    if (!resolved.ok || ![2, 3].includes(resolved.model?.schemaVersion)) fail('invalid');
    const model = resolved.model;
    if ([model.scene, ...model.actors].some(item => !item.sourcePath.startsWith(documentRoot + '/') || getCreatePathError(item.sourcePath))) fail('invalid');
    const { objectId, sourcePath, sourceRevision, title, viewport, background } = model.scene;
    const actors = model.actors.map(({ instanceId, objectId, name, sourcePath, sourceRevision, position, size, color }) =>
      ({ instanceId, objectId, name, sourcePath, sourceRevision, position, size, color }));
    try { return captureScenePhysics2DSpaceDirectory({ format: 'viento-scene-physics2d-space', schemaVersion: 1,
      worldId: projection.world.id, revision: projection.world.revision,
      scene: { objectId, sourcePath, sourceRevision, title, viewport, background }, actors }, sceneObjectId); }
    catch { fail('invalid'); }
  } });
}
