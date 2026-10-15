import '../adapters/node-studio-core.mjs';
import { readWorldSnapshot } from '../adapters/node-world-projection.mjs';
import { inspectAudioCreateScene } from '../../engine/world-audio-create.mjs';
import { parseJsonSource } from '../../engine/json-source.mjs';
import { sourceFileName } from '../../engine/source-path.mjs';
import { createError } from '../../engine/service-error.mjs';

const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const revision = value => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
const label = value => String(value).slice(0, 160).replace(/[\ud800-\udbff]$/, '');
const fail = () => { throw createError(400, 'Invalid audio creation context request.', {}, 'world_command_invalid'); };

export function createSceneAudioCreationService(root) {
  return Object.freeze({ async inspect(payload) {
    if (!payload || typeof payload !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(payload))) fail();
    const keys = Reflect.ownKeys(payload), property = Object.getOwnPropertyDescriptor(payload, 'sceneObjectId');
    if (keys.length !== 1 || keys[0] !== 'sceneObjectId' || !property?.enumerable || !Object.hasOwn(property, 'value') || !uuid(property.value)) fail();
    const sceneObjectId = property.value;
    const observed = await readWorldSnapshot(root);
    const { scene, manifest } = inspectAudioCreateScene(observed.source, observed.projection, sceneObjectId);
    const objects = new Map(observed.projection.objects.map(object => [object.id, object]));
    const resourceObjects = new Map(observed.projection.resources.map(resource => [resource.id, resource]));
    // Catalog inspection only checks registration and regular-file availability.
    // Selected files receive bounded PCM/hash verification during preview/apply.
    const resources = observed.source.assets.filter(({ record, availability }) => uuid(record.id) && record.kind === 'audio'
      && availability === 'present-unverified' && /\.wav$/i.test(record.location?.path || '')
      && /^[a-f0-9]{64}$/.test(record.content?.sha256) && Number.isSafeInteger(record.content?.size)
      && record.content.size >= 44 && record.content.size <= 32 * 1024 * 1024 && revision(resourceObjects.get(record.id)?.revision))
      .map(({ record }) => ({ resourceId: record.id, resourceRevision: resourceObjects.get(record.id).revision,
        name: label(record.name || sourceFileName(record.location.path)), sourcePath: record.location.path,
        sha256: record.content.sha256, size: record.content.size, availability: 'unverified' }))
      .sort((a, b) => a.sourcePath < b.sourcePath ? -1 : a.sourcePath > b.sourcePath ? 1 : a.resourceId.localeCompare(b.resourceId));
    if (resources.length > 256) throw createError(413, 'Audio creation supports at most 256 resource candidates.', {}, 'world_audio_create_limit');
    return freeze({ format: 'viento-audio-creation-context', schemaVersion: 1, status: manifest ? 'ready' : 'empty',
      worldId: observed.projection.world.id, baseRevision: observed.projection.world.revision,
      documentRoot: observed.source.definition.paths.documents,
      documentTypes: observed.source.definition.documentTypes.map(type => ({ id: type.id, label: type.label })),
      scene: { objectId: sceneObjectId, objectRevision: objects.get(sceneObjectId).revision,
        sourcePath: scene.sourcePath, sourceRevision: scene.sourceRevision }, resources,
      manifest: manifest ? { objectId: manifest.record.id, objectRevision: objects.get(manifest.record.id).revision,
        sourcePath: manifest.sourcePath, sourceRevision: manifest.sourceRevision,
        documentType: manifest.record.documentType, parserProfile: manifest.record.parserProfile, content: manifest.content,
        relations: structuredClone(manifest.record.relations), assetBindings: structuredClone(manifest.record.assetBindings),
        trackCount: parseJsonSource(manifest.content).value.tracks.length } : null });
  } });
}
