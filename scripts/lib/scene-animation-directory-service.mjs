// Read saved declarations only. Named ranges remain useful when images are
// absent or rendering is unavailable; build and playback validate those inputs.
// This service does not create a build plan, read assets or modify author data.
import '../adapters/node-studio-core.mjs';
import { readWorldSnapshot } from '../adapters/node-world-projection.mjs';
import { captureSceneAnimationDirectory } from '../../engine/scene-animation-directory.mjs';
import { parseJsonSource } from '../../engine/json-source.mjs';
import { normalizeSourcePath } from '../../engine/source-path.mjs';
import { createError } from '../../engine/service-error.mjs';

const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const revision = value => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
const fail = kind => { throw createError({ invalid: 400, conflict: 409, unavailable: 422, limit: 413 }[kind], {
  invalid: 'Invalid scene animation identity directory.', conflict: 'Scene animation identity sources changed; read again.',
  unavailable: 'The registered scene animation identity source is unavailable.', limit: 'The scene animation identity source exceeds its limits.',
}[kind], {}, `scene_animation_directory_${kind}`); };
const readable = document => document?.record?.format === 'viento-document' && document.record.version === 1 && uuid(document.record.id)
  && document.record.sourcePath === document.sourcePath && typeof document.sourcePath === 'string'
  && document.sourcePath.length <= 4096 && normalizeSourcePath(document.sourcePath) === document.sourcePath
  && /\.json$/i.test(document.sourcePath) && typeof document.content === 'string' && revision(document.sourceRevision);
const describe = document => ({ objectId: document.record.id, sourcePath: document.sourcePath, sourceRevision: document.sourceRevision });
function sceneId(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) fail('invalid');
  const keys = Reflect.ownKeys(input), descriptor = Object.getOwnPropertyDescriptor(input, 'sceneObjectId');
  if (keys.length !== 1 || keys[0] !== 'sceneObjectId' || !descriptor?.enumerable || !Object.hasOwn(descriptor, 'value') || !uuid(descriptor.value)) fail('invalid');
  return descriptor.value;
}
export function createSceneAnimationDirectoryService(root) {
  return Object.freeze({ async inspect(input) {
    const sceneObjectId = sceneId(input);
    let observed;
    try { observed = await readWorldSnapshot(root); }
    catch (error) {
      if (['world_read_conflict', 'world_recovery_required', 'world_journal_invalid'].includes(error.errorCode)) fail('conflict');
      fail(error.statusCode === 413 ? 'limit' : 'unavailable');
    }
    const { source, projection } = observed;
    if (![2, 3].includes(source.workspace?.version)) fail('unavailable');
    const scene = source.documents.find(document => document.record?.id === sceneObjectId);
    if (!readable(scene)) fail('unavailable');
    const parsed = parseJsonSource(scene.content), model = parsed.value;
    if (!parsed.ok || model?.format !== 'viento-scene2d' || ![2, 3].includes(model.schemaVersion)
      || !Array.isArray(model.actors) || model.actors.length < 1 || model.actors.length > 128
      || model.actors.some(actor => !uuid(actor?.instanceId) || !uuid(actor?.objectId))
      || new Set(model.actors.map(actor => actor.instanceId)).size !== model.actors.length) fail('invalid');
    const relations = (scene.record.relations || []).filter(relation => relation.kind === 'animation');
    if (relations.length > 1) fail('invalid');
    const result = { format: 'viento-scene-animation-directory', schemaVersion: 1, status: relations.length ? 'ready' : 'empty',
      worldId: projection.world.id, revision: projection.world.revision, scene: describe(scene), manifest: null };
    if (relations.length) {
      const manifest = source.documents.find(document => document.record?.id === relations[0].targetId);
      if (!readable(manifest)) fail('unavailable');
      if (manifest.record.id === sceneObjectId || manifest.sourcePath === scene.sourcePath
        || !(manifest.record.relations || []).some(relation => typeof relation.kind === 'string' && relation.kind.trim()
          && relation.kind !== 'part-of' && relation.targetId === sceneObjectId)) fail('invalid');
      if (manifest.content.length > 131072 || Buffer.byteLength(manifest.content, 'utf8') > 131072) fail('limit');
      result.manifest = { ...describe(manifest), content: manifest.content };
    }
    try { return captureSceneAnimationDirectory(result, sceneObjectId); } catch { fail('invalid'); }
  } });
}
