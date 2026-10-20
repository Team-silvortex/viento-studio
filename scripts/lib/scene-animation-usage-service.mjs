// One observed saved scope, not a global reference index or deletion approval.
// The World reader observes document bytes/metadata; this service never reads
// image bytes, interprets scripts or requires executable scene dependencies.
import '../adapters/node-studio-core.mjs';
import { readWorldSnapshot } from '../adapters/node-world-projection.mjs';
import { captureSceneAnimationUsageDirectory } from '../../engine/scene-animation-usage.mjs';
import { parseJsonSource } from '../../engine/json-source.mjs';
import { normalizeSourcePath } from '../../engine/source-path.mjs';
import { createError } from '../../engine/service-error.mjs';

const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const revision = value => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
const fail = kind => { throw createError({ invalid: 400, conflict: 409, unavailable: 422, limit: 413 }[kind], {
  invalid: 'Invalid scene animation usage scope.', conflict: 'Scene animation usage sources changed; read again.',
  unavailable: 'The registered scene animation usage source is unavailable.', limit: 'The scene animation usage source exceeds its limits.',
}[kind], {}, `scene_animation_usage_${kind}`); };
const readable = document => document?.record?.format === 'viento-document' && document.record.version === 1 && uuid(document.record.id)
  && document.record.sourcePath === document.sourcePath && typeof document.sourcePath === 'string' && document.sourcePath.length <= 4096
  && normalizeSourcePath(document.sourcePath) === document.sourcePath && /\.json$/i.test(document.sourcePath)
  && typeof document.content === 'string' && revision(document.sourceRevision);
const describe = document => ({ objectId: document.record.id, sourcePath: document.sourcePath, sourceRevision: document.sourceRevision });
function requestScene(input) {
  try {
    if (!input || typeof input !== 'object' || Array.isArray(input) || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) fail('invalid');
    const keys = Reflect.ownKeys(input), descriptor = Object.getOwnPropertyDescriptor(input, 'sceneObjectId');
    if (keys.length !== 1 || keys[0] !== 'sceneObjectId' || !descriptor?.enumerable || !Object.hasOwn(descriptor, 'value') || !uuid(descriptor.value)) fail('invalid');
    return descriptor.value;
  } catch { fail('invalid'); }
}
export function createSceneAnimationUsageService(root) {
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
    const documents = new Map(source.documents.filter(document => document.record).map(document => [document.record.id, document]));
    const scene = documents.get(sceneObjectId);
    if (!readable(scene)) fail('unavailable');
    const parsed = parseJsonSource(scene.content), model = parsed.value;
    if (!parsed.ok || model?.format !== 'viento-scene2d' || ![2, 3].includes(model.schemaVersion)
      || !Array.isArray(model.actors) || model.actors.length < 1 || model.actors.length > 128
      || model.actors.some(actor => !uuid(actor?.instanceId) || !uuid(actor?.objectId))
      || new Set(model.actors.map(actor => actor.instanceId)).size !== model.actors.length) fail('invalid');
    function selected(kind, required, byteLimit) {
      const relations = (scene.record.relations || []).filter(relation => relation.kind === kind);
      if (relations.length > 1) fail('invalid');
      if (!relations.length) { if (required) fail('unavailable'); return null; }
      const document = documents.get(relations[0].targetId);
      if (!readable(document)) fail('unavailable');
      if (document.record.id === sceneObjectId || document.sourcePath === scene.sourcePath
        || !(document.record.relations || []).some(relation => typeof relation.kind === 'string' && relation.kind.trim()
          && relation.kind !== 'part-of' && relation.targetId === sceneObjectId)) fail('invalid');
      if (document.content.length > byteLimit || Buffer.byteLength(document.content, 'utf8') > byteLimit) fail('limit');
      return { ...describe(document), content: document.content };
    }
    const result = { format: 'viento-scene-animation-usage', schemaVersion: 1, worldId: projection.world.id, revision: projection.world.revision,
      scene: describe(scene), animation: selected('animation', true, 131072), behavior: selected('behavior', false, 32768) };
    try { return captureSceneAnimationUsageDirectory(result, sceneObjectId); } catch { fail('invalid'); }
  } });
}
