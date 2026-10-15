// Saved author relations only. This directory neither edits registrations nor
// loads an execution backend; every identity comes from one observed world.
import { readWorldSnapshot } from '../adapters/node-world-projection.mjs';
import { captureSceneBehaviorDirectory } from '../../engine/scene-behavior-directory.mjs';
import { getCreatePathError } from '../../engine/document-contract.mjs';
import { inspectSceneBehaviors, validateSceneBehaviorDependencies, SCENE_BEHAVIOR_LIMITS } from '../../engine/scene-behaviors.mjs';
import { parseJsonSource } from '../../engine/json-source.mjs';
import { normalizeSourcePath, sourceFileName } from '../../engine/source-path.mjs';
import { canRelateObject } from '../../engine/world-command-contract.mjs';
import { createError } from '../../engine/service-error.mjs';

const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const revision = value => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
const diagnostic = (code, message, propertyPath = '', details = {}) => ({ severity: 'error', code, message, propertyPath, ...details });
const fail = (kind, diagnostics = []) => {
  throw createError({ invalid: 400, conflict: 409, unavailable: 422, limit: 413 }[kind], {
    invalid: 'Invalid behavior directory context.', conflict: 'Behavior directory dependencies changed; inspect again.',
    unavailable: 'Behavior directory dependencies are unavailable.', limit: 'Behavior directory exceeds its source limits.',
  }[kind], { diagnostics }, `scene_behavior_directory_${kind}`);
};
const linked = (record, objectId) => record.relations?.some(relation => typeof relation.kind === 'string'
  && relation.kind !== 'part-of' && relation.targetId === objectId);
const readable = document => document?.record?.format === 'viento-document' && document.record.version === 1
  && uuid(document.record.id) && document.record.sourcePath === document.sourcePath
  && typeof document.sourcePath === 'string' && normalizeSourcePath(document.sourcePath) === document.sourcePath
  && typeof document.content === 'string' && revision(document.sourceRevision);
const utf8Bytes = value => typeof value !== 'string'
  || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value) ? Infinity : Buffer.byteLength(value, 'utf8');
const boundedSource = document => document.content.length <= SCENE_BEHAVIOR_LIMITS.sourceBytes
  && utf8Bytes(document.content) <= SCENE_BEHAVIOR_LIMITS.sourceBytes;
const sourceLimit = objectId => fail('limit', [diagnostic('build_behavior_source_invalid',
  'A behavior source requires valid UTF-8 and at most 64 KiB.', '', { relatedObjectId: objectId })]);

function requestSceneId(input) {
  let sceneObjectId;
  try {
    if (!input || typeof input !== 'object' || Array.isArray(input)
      || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) throw new TypeError();
    const keys = Reflect.ownKeys(input), descriptor = Object.getOwnPropertyDescriptor(input, 'sceneObjectId');
    if (keys.length !== 1 || keys[0] !== 'sceneObjectId' || !descriptor?.enumerable
      || !Object.hasOwn(descriptor, 'value') || !uuid(descriptor.value)) throw new TypeError();
    sceneObjectId = descriptor.value;
  } catch { fail('invalid'); }
  return sceneObjectId;
}

// Successful responses share the browser's exact data contract. Legacy names
// can remain in the registry without making unrelated candidates unusable.
function captureResult(result, sceneObjectId) {
  try { return captureSceneBehaviorDirectory(result, sceneObjectId); }
  catch { fail('invalid'); }
}

export function createSceneBehaviorDirectoryService(root) {
  return Object.freeze({ async inspect(input) {
    // Capture exact data before the first await. Getters and later caller edits
    // never change which scene is inspected.
    const sceneObjectId = requestSceneId(input);
    let observed;
    try { observed = await readWorldSnapshot(root); }
    catch (error) {
      if (['world_read_conflict', 'world_recovery_required', 'world_journal_invalid'].includes(error.errorCode)) fail('conflict');
      fail(error.statusCode === 413 ? 'limit' : 'unavailable');
    }
    const { source, projection } = observed;
    if (![2, 3].includes(source.workspace?.version)) fail('unavailable');
    const documentRoot = source.definition.paths.documents;
    if (typeof documentRoot !== 'string' || !documentRoot || documentRoot.length > 900 || utf8Bytes(documentRoot) === Infinity
      || getCreatePathError(`${documentRoot}/manifest.json`)) fail('invalid');
    const supportedPath = document => typeof document.sourcePath === 'string' && document.sourcePath.length <= 1024
      && utf8Bytes(document.sourcePath) !== Infinity && document.sourcePath.startsWith(documentRoot + '/') && !getCreatePathError(document.sourcePath);
    const invalidPath = document => fail('invalid', [diagnostic('build_behavior_source_invalid',
      'The registered source requires a supported portable path of at most 1024 characters.', '', { relatedObjectId: document.record.id })]);
    const documents = new Map(source.documents.filter(document => document.record).map(document => [document.record.id, document]));
    const objects = new Map(projection.objects.map(object => [object.id, object]));
    const scene = documents.get(sceneObjectId);
    const describe = document => {
      const object = objects.get(document.record.id);
      if (!canRelateObject(object) || !revision(object.revision)) fail('unavailable');
      return { objectId: document.record.id, objectRevision: object.revision,
        sourcePath: document.sourcePath, sourceRevision: document.sourceRevision };
    };
    if (!readable(scene)) fail('unavailable');
    if (!supportedPath(scene)) invalidPath(scene);
    const parsed = scene.sourcePath.toLowerCase().endsWith('.json') ? parseJsonSource(scene.content) : null;
    const sceneValue = parsed?.value;
    if (!parsed?.ok || sceneValue?.format !== 'viento-scene2d' || ![2, 3].includes(sceneValue.schemaVersion)
      || !Array.isArray(sceneValue.actors) || sceneValue.actors.length < 1 || sceneValue.actors.length > 128
      || sceneValue.actors.some(actor => !uuid(actor?.instanceId) || !uuid(actor?.objectId))
      || new Set(sceneValue.actors.map(actor => actor.instanceId)).size !== sceneValue.actors.length) {
      fail('invalid', [diagnostic('build_behavior_scene_invalid', 'Select an unambiguous registered Scene2D v2 or v3.', '/sceneObjectId')]);
    }
    const relations = (scene.record.relations || []).filter(relation => relation.kind === 'behavior');
    if (relations.length > 1) fail('invalid', [diagnostic('build_behavior_invalid', 'A scene opts into at most one behavior manifest.', '/sceneObjectId')]);
    const manifest = relations.length ? documents.get(relations[0].targetId) : null;
    // Keep the same all-instance dependency boundary as the independent behavior
    // editor, including actors that do not yet have a behavior binding.
    for (const actor of sceneValue.actors) {
      const definition = documents.get(actor.objectId), details = { relatedObjectId: actor.objectId, instanceId: actor.instanceId };
      if (!readable(definition) || actor.objectId === sceneObjectId || actor.objectId === manifest?.record.id) {
        fail('unavailable', [diagnostic('build_behavior_dependency_unavailable', 'Every instance requires another available registered definition.', '/sceneObjectId', details)]);
      }
      if (!linked(scene.record, actor.objectId)) fail('invalid', [diagnostic('build_behavior_unlinked',
        'Register a nonownership scene-to-definition dependency.', '/sceneObjectId', details)]);
    }
    const result = { format: 'viento-scene-behavior-directory', schemaVersion: 1, status: relations.length ? 'ready' : 'empty',
      worldId: projection.world.id, baseRevision: projection.world.revision, documentRoot,
      scene: describe(scene), manifest: null, sources: [] };
    if (!relations.length) return captureResult(result, sceneObjectId);
    if (!readable(manifest)) fail('unavailable');
    if (!supportedPath(manifest)) invalidPath(manifest);
    if (manifest.record.id === sceneObjectId || !manifest.sourcePath.toLowerCase().endsWith('.json')) fail('invalid');
    if (manifest.content.length > SCENE_BEHAVIOR_LIMITS.manifestBytes || utf8Bytes(manifest.content) > SCENE_BEHAVIOR_LIMITS.manifestBytes) fail('limit');
    const checked = inspectSceneBehaviors(manifest.content);
    if (!checked.recognized || !checked.ok) fail('invalid', checked.diagnostics);
    if (checked.value.sceneObjectId !== sceneObjectId) fail('invalid', [diagnostic('build_behavior_scene_invalid',
      'The behavior manifest must declare the scene that opted into it.', '/sceneObjectId')]);
    const used = new Map();
    for (const binding of checked.value.bindings) {
      const objectId = binding.implementation.sourceObjectId;
      if (!used.has(objectId)) used.set(objectId, []);
      used.get(objectId).push(binding.bindingId);
      const document = documents.get(objectId);
      if (readable(document) && !boundedSource(document)) sourceLimit(objectId);
    }
    const errors = validateSceneBehaviorDependencies(checked.value, manifest.record, source);
    if (errors.length) fail(errors.some(item => item.code === 'build_behavior_dependency_unavailable') ? 'unavailable' : 'invalid', errors);
    result.manifest = { ...describe(manifest), bindingCount: checked.value.bindings.length };
    for (const document of documents.values()) {
      if (!document.sourcePath.toLowerCase().endsWith('.txt')
        || document.record.id === sceneObjectId || document.record.id === manifest.record.id) continue;
      const isLinked = linked(manifest.record, document.record.id), required = isLinked || used.has(document.record.id);
      if (!readable(document)) {
        if (required) fail('unavailable', [diagnostic('build_behavior_dependency_unavailable',
          'An associated behavior script is unavailable.', '', { relatedObjectId: document.record.id })]);
        continue;
      }
      if (!supportedPath(document)) { if (required) invalidPath(document); continue; }
      if (!boundedSource(document)) { if (required) sourceLimit(document.record.id); continue; }
      result.sources.push({ ...describe(document), name: sourceFileName(document.sourcePath).slice(0, 160).replace(/[\ud800-\udbff]$/, ''),
        linked: isLinked, usedByBindingIds: used.get(document.record.id) || [] });
      if (result.sources.length > 256) fail('limit');
    }
    result.sources.sort((a, b) => a.sourcePath < b.sourcePath ? -1 : a.sourcePath > b.sourcePath ? 1 : 0);
    return captureResult(result, sceneObjectId);
  } });
}
