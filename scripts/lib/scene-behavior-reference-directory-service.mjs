// Inspect one coherent saved World. No tool, resource-byte or write authority is
// needed to offer names beside portable instance, member-scene and action values.
import '../adapters/node-studio-core.mjs';
import { readWorldSnapshot } from '../adapters/node-world-projection.mjs';
import { captureSceneBehaviorReferenceDirectory } from '../../engine/scene-behavior-reference-directory.mjs';
import { inspectProjectAssembly } from '../../engine/project-assembly.mjs';
import { inspectProjectInputMap } from '../../engine/project-input-map.mjs';
import { parseJsonSource } from '../../engine/json-source.mjs';
import { normalizeSourcePath, sourceFileName } from '../../engine/source-path.mjs';
import { createError } from '../../engine/service-error.mjs';

const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const revision = value => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
const unicode = value => !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value);
const fail = kind => { throw createError({ invalid: 400, conflict: 409, unavailable: 422, limit: 413 }[kind], {
  invalid: 'Invalid scene behavior reference directory.', conflict: 'Scene behavior reference sources changed; inspect again.',
  unavailable: 'A selected scene behavior reference source is unavailable.', limit: 'The scene behavior reference directory exceeds its limits.',
}[kind], {}, `scene_behavior_reference_directory_${kind}`); };
function request(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) fail('invalid');
  const descriptors = Object.getOwnPropertyDescriptors(input), keys = Reflect.ownKeys(descriptors);
  if (keys.length !== 2 || keys.some(key => !['sceneObjectId', 'assemblyObjectId'].includes(key))) fail('invalid');
  for (const key of ['sceneObjectId', 'assemblyObjectId']) if (!descriptors[key]?.enumerable || !Object.hasOwn(descriptors[key], 'value')) fail('invalid');
  const sceneObjectId = descriptors.sceneObjectId.value, assemblyObjectId = descriptors.assemblyObjectId.value;
  if (!uuid(sceneObjectId) || !(assemblyObjectId === null || uuid(assemblyObjectId))) fail('invalid');
  return { sceneObjectId, assemblyObjectId };
}
const readable = document => document?.record?.format === 'viento-document' && document.record.version === 1 && uuid(document.record.id)
  && document.record.sourcePath === document.sourcePath && typeof document.sourcePath === 'string' && document.sourcePath.length <= 4096
  && unicode(document.sourcePath) && normalizeSourcePath(document.sourcePath) === document.sourcePath && !/^[A-Za-z]:/.test(document.sourcePath)
  && typeof document.content === 'string' && revision(document.sourceRevision);
const json = document => readable(document) && /\.json$/i.test(document.sourcePath);
const describe = document => ({ objectId: document.record.id, sourcePath: document.sourcePath, sourceRevision: document.sourceRevision });
const bounded = content => {
  if (content.length > 32768 || Buffer.byteLength(content, 'utf8') > 32768) fail('limit');
  if (!unicode(content)) fail('invalid');
};
function sceneModel(document, current = false) {
  if (!json(document)) fail('unavailable');
  const parsed = parseJsonSource(document.content), value = parsed.value;
  if (!parsed.ok || value?.format !== 'viento-scene2d' || !(current ? [2, 3] : [1, 2, 3]).includes(value.schemaVersion)) fail('invalid');
  if (current && (!Array.isArray(value.actors) || value.actors.length < 1 || value.actors.length > 128
    || value.actors.some(actor => !uuid(actor?.instanceId) || !uuid(actor?.objectId))
    || new Set(value.actors.map(actor => actor.instanceId)).size !== value.actors.length)) fail('invalid');
  return value;
}
export function createSceneBehaviorReferenceDirectoryService({ PROJECT_ROOT, readSnapshot = readWorldSnapshot } = {}) {
  if (typeof PROJECT_ROOT !== 'string' || !PROJECT_ROOT || typeof readSnapshot !== 'function') fail('invalid');
  return Object.freeze({ async inspect(input) {
    // Capture both caller fields before the first await. No later request edit
    // can switch the assembly or scene in the captured saved World.
    const { sceneObjectId, assemblyObjectId } = request(input);
    let observed;
    try { observed = await readSnapshot(PROJECT_ROOT); }
    catch (error) {
      if (['world_read_conflict', 'world_recovery_required', 'world_journal_invalid'].includes(error.errorCode)) fail('conflict');
      fail(error.statusCode === 413 ? 'limit' : 'unavailable');
    }
    const { source, projection } = observed;
    if (![2, 3].includes(source?.workspace?.version)) fail('unavailable');
    const documents = new Map(source.documents.filter(document => document.record).map(document => [document.record.id, document]));
    const scene = documents.get(sceneObjectId), model = sceneModel(scene, true);
    const names = new Map(projection.objects.map(object => [object.id, object.name]));
    const name = document => {
      const candidate = names.get(document.record.id), label = typeof candidate === 'string' && candidate.trim() && unicode(candidate)
        ? candidate : sourceFileName(document.sourcePath);
      return label.replace(/[\x00-\x1f\x7f]/g, ' ').slice(0, 160).replace(/[\ud800-\udbff]$/, '');
    };
    const named = document => ({ ...describe(document), name: name(document) });
    const instances = model.actors.map(actor => {
      const definition = documents.get(actor.objectId);
      if (!readable(definition)) fail('unavailable');
      if (actor.objectId === sceneObjectId || definition.sourcePath === scene.sourcePath
        || !(scene.record.relations || []).some(relation => typeof relation.kind === 'string' && relation.kind.trim()
          && relation.kind !== 'part-of' && relation.targetId === actor.objectId)) fail('invalid');
      return { instanceId: actor.instanceId, ...named(definition) };
    });
    const candidates = [], declarations = new Map();
    for (const document of documents.values()) {
      if (!json(document)) continue;
      const checked = inspectProjectAssembly(document.content);
      // An unrelated malformed document does not choose a context. A requested
      // assembly is checked explicitly below and can never fall back to empty.
      if (!checked.recognized || !checked.ok || !checked.value.sceneIds.includes(sceneObjectId)) continue;
      candidates.push({ ...describe(document), name: checked.value.title });
      declarations.set(document.record.id, checked.value);
      if (candidates.length > 256) fail('limit');
    }
    candidates.sort((a, b) => a.objectId.localeCompare(b.objectId));
    const result = { format: 'viento-scene-behavior-reference-directory', schemaVersion: 1,
      worldId: projection.world.id, revision: projection.world.revision, scene: describe(scene),
      instances, assemblies: candidates, selectedAssembly: null };
    if (assemblyObjectId !== null) {
      const assembly = documents.get(assemblyObjectId);
      if (!json(assembly)) fail('unavailable');
      bounded(assembly.content);
      const checked = inspectProjectAssembly(assembly.content), value = declarations.get(assemblyObjectId);
      if (!checked.recognized || !checked.ok || !value || assemblyObjectId === sceneObjectId) fail('invalid');
      const members = value.sceneIds.map(id => {
        const member = documents.get(id); sceneModel(member);
        if (id === assemblyObjectId || member.sourcePath === assembly.sourcePath) fail('invalid');
        return named(member);
      });
      let inputMap = null, actions = [];
      if (value.schemaVersion === 2) {
        const input = documents.get(value.inputMapId);
        if (!json(input)) fail('unavailable');
        if (value.inputMapId === assemblyObjectId || input.sourcePath === assembly.sourcePath) fail('invalid');
        bounded(input.content);
        try { actions = inspectProjectInputMap(input.content).actions; } catch { fail('invalid'); }
        inputMap = describe(input);
      }
      result.selectedAssembly = { ...candidates.find(candidate => candidate.objectId === assemblyObjectId), members, inputMap, actions };
    }
    try { return captureSceneBehaviorReferenceDirectory(result, sceneObjectId); } catch { fail('invalid'); }
  } });
}
