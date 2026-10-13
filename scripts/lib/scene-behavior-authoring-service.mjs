// Read-only authoring catalog. Source text remains data; this service never
// starts a tool, edits registrations or grants runtime authority.
import { createHash } from 'node:crypto';
import { readWorldSnapshot } from '../adapters/node-world-projection.mjs';
import { inspectSceneBehaviors, validateSceneBehaviorDependencies, SCENE_BEHAVIOR_LIMITS } from '../../engine/scene-behaviors.mjs';
import { parseJsonSource } from '../../engine/json-source.mjs';
import { normalizeSourcePath, sourceFileName } from '../../engine/source-path.mjs';
import { canonicalJson } from '../../engine/canonical-json.mjs';
import { createError } from '../../engine/service-error.mjs';

const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const revision = value => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
const diagnostic = (code, message, propertyPath = '', details = {}) => ({ severity: 'error', code, message, propertyPath, ...details });
const fail = (kind, diagnostics = [], status = kind === 'conflict' ? 409 : kind === 'unavailable' ? 422 : 400) => {
  throw createError(status, { invalid: 'Invalid behavior authoring input.', conflict: 'Behavior authoring dependencies changed; inspect again.',
    unavailable: 'Behavior authoring dependencies are unavailable.' }[kind], { diagnostics }, `scene_behavior_authoring_${kind}`);
};

function utf8Bytes(text) {
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const low = text.charCodeAt(++index);
      if (!(low >= 0xdc00 && low <= 0xdfff)) return Infinity;
    } else if (code >= 0xdc00 && code <= 0xdfff) return Infinity;
  }
  return Buffer.byteLength(text, 'utf8');
}

function requestData(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) fail('invalid');
  const properties = Object.getOwnPropertyDescriptors(input), keys = Reflect.ownKeys(properties);
  if (keys.length !== 2 || keys.some(key => typeof key !== 'string' || !['sourcePath', 'content'].includes(key))
    || ['sourcePath', 'content'].some(key => !properties[key]?.enumerable || !Object.hasOwn(properties[key], 'value'))) fail('invalid');
  const sourcePath = properties.sourcePath.value, content = properties.content.value;
  if (typeof sourcePath !== 'string' || sourcePath.length > 4096 || utf8Bytes(sourcePath) === Infinity || normalizeSourcePath(sourcePath) !== sourcePath
    || !sourcePath.toLowerCase().endsWith('.json') || typeof content !== 'string') fail('invalid');
  if (content.length > SCENE_BEHAVIOR_LIMITS.manifestBytes || utf8Bytes(content) > SCENE_BEHAVIOR_LIMITS.manifestBytes) {
    fail('invalid', [diagnostic('build_behavior_invalid', 'A behavior manifest requires valid UTF-8 and at most 32 KiB.')], 413);
  }
  const checked = inspectSceneBehaviors(content);
  if (!checked.recognized || !checked.ok) fail('invalid', checked.diagnostics);
  return { sourcePath, value: checked.value };
}

function registered(document) {
  return document?.record?.format === 'viento-document' && uuid(document.record.id)
    && document.record.sourcePath === document.sourcePath && typeof document.sourcePath === 'string'
    && normalizeSourcePath(document.sourcePath) === document.sourcePath;
}
const readable = document => registered(document) && typeof document.content === 'string' && revision(document.sourceRevision);
const linked = (record, id) => record.relations?.some(relation => typeof relation.kind === 'string' && relation.kind !== 'part-of' && relation.targetId === id);
const unavailableDiagnostics = diagnostics => diagnostics.some(item => item.code === 'build_behavior_dependency_unavailable');
const compare = (a, b) => a.objectId < b.objectId ? -1 : a.objectId > b.objectId ? 1 : 0;
const boundedName = value => value.slice(0, 160).replace(/[\ud800-\udbff]$/, '');

export function createSceneBehaviorAuthoringService(root) {
  return Object.freeze({ async inspect(input) {
    // Detach the caller's two data fields before the first await. No property
    // accessor, serializer or later mutation participates in this request.
    const { sourcePath, value } = requestData(input);
    let observed;
    try { observed = await readWorldSnapshot(root); }
    catch (error) {
      if (['world_read_conflict', 'world_recovery_required', 'world_journal_invalid'].includes(error.errorCode)) fail('conflict');
      fail('unavailable', [], error.statusCode === 413 ? 413 : 422);
    }
    const documents = observed.source.documents, manifest = documents.find(document => document.sourcePath === sourcePath);
    if (!readable(manifest)) fail('unavailable');
    const errors = validateSceneBehaviorDependencies(value, manifest.record, observed.source);
    if (errors.length) fail(unavailableDiagnostics(errors) ? 'unavailable' : 'invalid', errors);
    const scene = documents.find(document => document.record?.id === value.sceneObjectId);
    if (!readable(scene)) fail('unavailable');
    const behaviorRelations = (scene.record.relations || []).filter(relation => relation.kind === 'behavior');
    if (behaviorRelations.length !== 1 || behaviorRelations[0].targetId !== manifest.record.id) {
      fail('invalid', [diagnostic('build_behavior_unlinked', 'The scene must opt into exactly this one registered behavior manifest.', '/sceneObjectId',
        { relatedObjectId: scene.record.id })]);
    }
    // The dependency validator supplies the strict schema/identity gate. Read
    // the same captured scene bytes to retain independent repeated instances.
    const actors = parseJsonSource(scene.content).value.actors, definitions = new Map();
    for (const actor of actors) {
      const definition = documents.find(document => document.record?.id === actor.objectId);
      if (!readable(definition) || actor.objectId === scene.record.id || actor.objectId === manifest.record.id) {
        fail('unavailable', [diagnostic('build_behavior_dependency_unavailable', 'Every scene instance requires an available registered definition.', '/sceneObjectId',
          { relatedObjectId: actor.objectId, instanceId: actor.instanceId })]);
      }
      if (!linked(scene.record, actor.objectId)) fail('invalid', [diagnostic('build_behavior_unlinked',
        'Register a nonownership scene-to-definition dependency.', '/sceneObjectId', { relatedObjectId: actor.objectId, instanceId: actor.instanceId })]);
      definitions.set(actor.objectId, definition);
    }
    const names = new Map(observed.projection.objects.map(object => [object.id, object.name]));
    const name = document => boundedName(typeof names.get(document.record.id) === 'string' && names.get(document.record.id).trim()
      && utf8Bytes(names.get(document.record.id)) !== Infinity ? names.get(document.record.id) : sourceFileName(document.sourcePath));
    const describe = document => ({ objectId: document.record.id, sourcePath: document.sourcePath, sourceRevision: document.sourceRevision, name: name(document) });
    const sourceDocuments = documents.filter(document => readable(document) && document.sourcePath.toLowerCase().endsWith('.txt')
      && document.record.id !== manifest.record.id && document.record.id !== scene.record.id && linked(manifest.record, document.record.id));
    if (sourceDocuments.length > 256) fail('invalid', [diagnostic('build_behavior_source_invalid', 'The authoring catalog supports at most 256 registered source candidates.')], 413);
    // Catalogs include unused registered candidates, but each candidate is
    // bounded before it can be offered as a new implementation choice.
    for (const document of sourceDocuments) if (document.content.length > SCENE_BEHAVIOR_LIMITS.sourceBytes
      || utf8Bytes(document.content) > SCENE_BEHAVIOR_LIMITS.sourceBytes) fail('invalid', [diagnostic('build_behavior_source_invalid',
        'A behavior source requires valid UTF-8 and at most 64 KiB.', '', { relatedObjectId: document.record.id })], 413);
    const dependencies = document => ({ objectId: document.record.id, record: document.record, sourceRevision: document.sourceRevision });
    const dependencyState = { format: 'viento-behavior-authoring-dependencies', schemaVersion: 1, workspaceId: observed.source.workspace.id,
      manifest: { objectId: manifest.record.id, record: manifest.record }, scene: dependencies(scene),
      sources: sourceDocuments.map(dependencies).sort(compare), definitions: [...definitions.values()].map(dependencies).sort(compare) };
    const dependencyRevision = `sha256:${createHash('sha256').update(canonicalJson(dependencyState)).digest('hex')}`;
    return freeze({ format: 'viento-behavior-authoring-context', schemaVersion: 1, sourcePath, objectId: manifest.record.id,
      scene: { objectId: scene.record.id, sourcePath: scene.sourcePath, sourceRevision: scene.sourceRevision,
        instances: actors.map(actor => ({ instanceId: actor.instanceId, objectId: actor.objectId, name: name(definitions.get(actor.objectId)) })) },
      sources: sourceDocuments.map(document => ({ ...describe(document), name: boundedName(sourceFileName(document.sourcePath)) })).sort(compare), dependencyRevision });
  } });
}
