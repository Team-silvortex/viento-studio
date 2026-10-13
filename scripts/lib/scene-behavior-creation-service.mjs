import { readWorldSnapshot } from '../adapters/node-world-projection.mjs';
import { inspectBehaviorCreateScene } from '../../engine/world-behavior-create.mjs';
import { SCENE_BEHAVIOR_LIMITS } from '../../engine/scene-behaviors.mjs';
import { sourceFileName } from '../../engine/source-path.mjs';
import { createError } from '../../engine/service-error.mjs';

const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const revision = value => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
const label = value => String(value).slice(0, 160).replace(/[\ud800-\udbff]$/, '');
const validText = value => typeof value === 'string' && !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value);
const fail = () => { throw createError(400, 'Invalid behavior creation context request.', {}, 'world_command_invalid'); };

export function createSceneBehaviorCreationService(root) {
  return Object.freeze({ async inspect(payload) {
    if (!payload || typeof payload !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(payload))) fail();
    const keys = Reflect.ownKeys(payload), property = Object.getOwnPropertyDescriptor(payload, 'sceneObjectId');
    if (keys.length !== 1 || keys[0] !== 'sceneObjectId' || !property?.enumerable || !Object.hasOwn(property, 'value') || !uuid(property.value)) fail();
    const sceneObjectId = property.value;
    const observed = await readWorldSnapshot(root);
    const { scene, instances } = inspectBehaviorCreateScene(observed.source, observed.projection, sceneObjectId);
    const sourceObjects = new Map(observed.projection.objects.map(object => [object.id, object]));
    const object = sourceObjects.get(sceneObjectId);
    const sources = observed.source.documents.filter(document => uuid(document.record?.id) && document.record.id !== sceneObjectId
      && document.record.sourcePath === document.sourcePath && /\.txt$/i.test(document.sourcePath)
      && revision(document.sourceRevision) && validText(document.content)
      && document.content.length <= SCENE_BEHAVIOR_LIMITS.sourceBytes && Buffer.byteLength(document.content) <= SCENE_BEHAVIOR_LIMITS.sourceBytes)
      .map(document => ({ objectId: document.record.id, sourcePath: document.sourcePath, sourceRevision: document.sourceRevision,
        name: label(sourceFileName(document.sourcePath)) })).sort((a, b) => a.sourcePath < b.sourcePath ? -1 : a.sourcePath > b.sourcePath ? 1 : 0);
    if (sources.length > 256) throw createError(413, 'Behavior creation supports at most 256 source candidates.', {}, 'world_behavior_create_limit');
    return freeze({ format: 'viento-behavior-creation-context', schemaVersion: 1,
      worldId: observed.projection.world.id, baseRevision: observed.projection.world.revision,
      documentRoot: observed.source.definition.paths.documents,
      documentTypes: observed.source.definition.documentTypes.map(type => ({ id: type.id, label: type.label })),
      scene: { objectId: sceneObjectId, objectRevision: object.revision, sourcePath: scene.sourcePath, sourceRevision: scene.sourceRevision,
        instances: instances.map(instance => ({ ...instance, name: label(sourceObjects.get(instance.objectId)?.name || instance.objectId) })) }, sources });
  } });
}
