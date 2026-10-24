// Saved physics instance identities only. Movement defaults, rendering and
// simulation remain build concerns; this reader never reads asset bytes or writes.
import '../adapters/node-studio-core.mjs';
import { readWorldSnapshot } from '../adapters/node-world-projection.mjs';
import { captureScenePhysics2DTargetDirectory } from '../../engine/scene-physics2d-targets.mjs';
import { parseJsonSource } from '../../engine/json-source.mjs';
import { getCreatePathError } from '../../engine/document-contract.mjs';
import { normalizeSourcePath } from '../../engine/source-path.mjs';
import { canRelateObject } from '../../engine/world-command-contract.mjs';
import { createError } from '../../engine/service-error.mjs';

const uuid = value => typeof value === 'string' && value.length === 36 && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const revision = value => typeof value === 'string' && value.length === 71 && /^sha256:[a-f0-9]{64}$/.test(value);
const fail = kind => { throw createError({ invalid: 400, conflict: 409, unavailable: 422, limit: 413 }[kind], {
  invalid: 'Invalid scene physics target directory.', conflict: 'Physics target sources changed; read again.',
  unavailable: 'The registered physics target source is unavailable.', limit: 'The physics target source exceeds its limits.',
}[kind], {}, `scene_physics2d_targets_${kind}`); };
const readable = document => document?.record?.format === 'viento-document' && document.record.version === 1 && uuid(document.record.id)
  && document.record.sourcePath === document.sourcePath && typeof document.sourcePath === 'string'
  && normalizeSourcePath(document.sourcePath) === document.sourcePath && typeof document.content === 'string' && revision(document.sourceRevision);
const describe = document => ({ objectId: document.record.id, sourcePath: document.sourcePath, sourceRevision: document.sourceRevision });
const linked = (record, objectId) => record.relations?.some(relation => typeof relation.kind === 'string' && relation.kind.trim()
  && relation.kind !== 'part-of' && relation.targetId === objectId);
function requestScene(input) {
  try {
    if (!input || typeof input !== 'object' || Array.isArray(input) || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) fail('invalid');
    const keys = Reflect.ownKeys(input), descriptor = Object.getOwnPropertyDescriptor(input, 'sceneObjectId');
    if (keys.length !== 1 || keys[0] !== 'sceneObjectId' || !descriptor?.enumerable || !Object.hasOwn(descriptor, 'value') || !uuid(descriptor.value)) fail('invalid');
    return descriptor.value;
  } catch { fail('invalid'); }
}
export function createScenePhysics2DTargetsService(root) {
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
    const objects = new Map(projection.objects.map(object => [object.id, object]));
    const documentRoot = source.definition.paths.documents;
    if (typeof documentRoot !== 'string' || !documentRoot || getCreatePathError(`${documentRoot}/manifest.json`)) fail('invalid');
    const available = document => {
      if (!readable(document) || !canRelateObject(objects.get(document.record.id))) fail('unavailable');
      if (document.sourcePath.length > 4096 || !document.sourcePath.startsWith(documentRoot + '/') || getCreatePathError(document.sourcePath)) fail('invalid');
      return document;
    };
    const scene = available(documents.get(sceneObjectId));
    if (!scene.sourcePath.endsWith('.json')) fail('invalid');
    const parsed = parseJsonSource(scene.content), model = parsed.value;
    if (!parsed.ok || model?.format !== 'viento-scene2d' || ![2, 3].includes(model.schemaVersion)
      || !Array.isArray(model.actors) || model.actors.length < 1 || model.actors.length > 128
      || model.actors.some(actor => !uuid(actor?.instanceId) || !uuid(actor?.objectId))
      || new Set(model.actors.map(actor => actor.instanceId)).size !== model.actors.length) fail('invalid');
    const relations = (scene.record.relations || []).filter(relation => relation.kind === 'references' && relation.slot === 'physics2d');
    if (relations.length > 1) fail('invalid');
    if (!relations.length) fail('unavailable');
    const manifest = available(documents.get(relations[0].targetId));
    if (!manifest.sourcePath.endsWith('.json') || manifest.record.id === sceneObjectId || manifest.sourcePath === scene.sourcePath
      || !manifest.record.relations?.some(relation => relation.kind === 'references' && relation.targetId === sceneObjectId)) fail('invalid');
    if (manifest.content.length > 65536 || Buffer.byteLength(manifest.content, 'utf8') > 65536) fail('limit');
    const targets = model.actors.map(actor => {
      const definition = available(documents.get(actor.objectId));
      if (actor.objectId === sceneObjectId || actor.objectId === manifest.record.id || !linked(scene.record, actor.objectId)) fail('invalid');
      return { instanceId: actor.instanceId, objectId: actor.objectId, name: objects.get(actor.objectId).name, sourcePath: definition.sourcePath };
    });
    const result = { format: 'viento-scene-physics2d-targets', schemaVersion: 1, worldId: projection.world.id, revision: projection.world.revision,
      scene: describe(scene), manifest: { ...describe(manifest), content: manifest.content }, targets };
    // Rust checks the declaration including its scene identity. Missing body
    // instances remain readable so authors can repair their saved targets.
    try { return captureScenePhysics2DTargetDirectory(result, sceneObjectId); } catch { fail('invalid'); }
  } });
}
