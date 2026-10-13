// One saved recipe becomes a new, independent author document. Expansion owns
// author fields; resolved preview values are evidence, never serialized source.
// The host brackets the saved preview with World reads and later submits the
// ordinary scene.create command, whose transaction rechecks that World revision.
import { expandSceneComposition } from './scene-composition.mjs';
import { canonicalJson } from './canonical-json.mjs';
import { getCreatePathError, conflictsWithSourcePath } from './document-contract.mjs';

const invalid = () => Object.assign(new TypeError('Invalid saved composition materialization.'), { errorCode: 'scene_composition_materialize_invalid' });
const conflict = () => Object.assign(new Error('The saved recipe or World changed during review.'), { errorCode: 'scene_composition_materialize_conflict' });
const destination = () => Object.assign(new TypeError('Choose an unused scene identity and portable destination.'), { errorCode: 'scene_composition_materialize_destination' });
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const revision = value => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
const text = (value, limit, empty = false) => typeof value === 'string' && (empty || value.length > 0) && value.length <= limit;
const identity = value => text(value, 200) && !/[\u0000-\u001f\u007f]/.test(value);
const typeId = value => typeof value === 'string' && /^[a-z][a-z0-9_-]{0,63}$/.test(value);
const relative = value => text(value, 4096) && !value.includes('\\') && !/^[a-z]:/i.test(value)
  && !/[\u0000-\u001f\u007f]/.test(value) && !value.split('/').some(part => !part || part === '.' || part === '..');
const title = value => text(value, 160) && Boolean(value.trim()) && !/[\u0000-\u001f\u007f]/.test(value);
const same = (a, b) => canonicalJson(a) === canonicalJson(b);
const freeze = value => {
  if (value && typeof value === 'object') { for (const item of Object.values(value)) freeze(item); Object.freeze(value); }
  return value;
};

function object(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== null && Object.getPrototypeOf(prototype) !== null) throw invalid();
  return value;
}
function field(value, key, optional = false) {
  object(value);
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor && optional) return undefined;
  if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) throw invalid();
  return descriptor.value;
}
function exact(value, required, optional = []) {
  object(value);
  const allowed = [...required, ...optional], keys = Reflect.ownKeys(value), result = {};
  if (keys.some(key => typeof key !== 'string' || !allowed.includes(key))) throw invalid();
  for (const key of required) result[key] = field(value, key);
  for (const key of optional) if (Object.hasOwn(value, key)) result[key] = field(value, key);
  return result;
}
function list(value, limit) {
  if (!Array.isArray(value)) throw invalid();
  const length = Object.getOwnPropertyDescriptor(value, 'length')?.value;
  if (!Number.isSafeInteger(length) || length < 0 || length > limit || Reflect.ownKeys(value).length !== length + 1) throw invalid();
  return Array.from({ length }, (_, index) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) throw invalid();
    return descriptor.value;
  });
}
function jsonCopy(input) {
  let nodes = 0, characters = 0;
  const visit = (value, depth = 0) => {
    if (++nodes > 150000 || depth > 48) throw invalid();
    if (typeof value === 'string') { characters += value.length; if (characters > 4 * 1024 * 1024) throw invalid(); return value; }
    if (value === null || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value)) return value;
    if (Array.isArray(value)) return list(value, 50000).map(item => visit(item, depth + 1));
    object(value);
    const result = {};
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== 'string' || key === '__proto__') throw invalid();
      Object.defineProperty(result, key, { enumerable: true, configurable: true, writable: true, value: visit(field(value, key), depth + 1) });
    }
    return result;
  };
  return visit(input);
}

// Only capture the catalogue fields this operation consumes. Other documents'
// parsed properties can be large and do not belong in a materialization seed.
function catalogue(projection, recipeId) {
  if (field(projection, 'format') !== 'viento-world-projection' || field(projection, 'schemaVersion') !== 1) throw invalid();
  const world = field(projection, 'world'), worldId = field(world, 'id'), baseRevision = field(world, 'revision');
  const version = field(world, 'sourceWorkspaceVersion');
  if (!identity(worldId) || !revision(baseRevision) || ![2, 3].includes(version)) throw invalid();
  const documentTypes = list(field(projection, 'types'), 1024).flatMap(type => {
    const definition = field(type, 'definition'), id = field(definition, 'id', true);
    if (id === undefined) return [];
    const label = field(type, 'label');
    if (!typeId(id) || !text(label, 256)) throw invalid();
    return [{ id, label }];
  });
  if (!documentTypes.length || new Set(documentTypes.map(type => type.id)).size !== documentTypes.length) throw invalid();
  const existingIdentities = [], existingPaths = [];
  let recipe;
  for (const value of list(field(projection, 'objects'), 50000)) {
    const id = field(value, 'id');
    if (!identity(id)) throw invalid();
    existingIdentities.push(id);
    const refs = list(field(value, 'documentRefs'), 32);
    for (const ref of refs) { const path = field(ref, 'sourcePath'); if (!relative(path)) throw invalid(); existingPaths.push(path); }
    if (id === recipeId) {
      const provenance = field(value, 'provenance'), documentType = field(provenance, 'documentType');
      const objectRevision = field(value, 'revision');
      if (recipe || refs.length !== 1 || field(provenance, 'identity') !== 'registered' || !revision(objectRevision)
        || !documentTypes.some(type => type.id === documentType)) throw invalid();
      const sourcePath = field(refs[0], 'sourcePath'), sourceRevision = field(refs[0], 'sourceRevision');
      if (!sourcePath.toLowerCase().endsWith('.json') || !revision(sourceRevision)) throw invalid();
      recipe = { objectId: recipeId, sourcePath, sourceRevision, documentType };
    }
  }
  for (const resource of list(field(projection, 'resources'), 50000)) {
    const id = field(resource, 'id'); if (!identity(id)) throw invalid(); existingIdentities.push(id);
  }
  if (!recipe || new Set(existingIdentities).size !== existingIdentities.length) throw invalid();
  return { worldId, baseRevision, documentRoot: version === 3 ? 'documents' : 'design-data', documentTypes,
    existingIdentities, existingPaths, recipe };
}

function validatePreview(preview, captured, expanded, source) {
  const owner = captured.recipe;
  if (preview.ok !== true || preview.format !== 'viento-scene-preview' || preview.schemaVersion !== 2
    || !uuid(preview.previewId) || !revision(preview.snapshotId)
    || ['draft', 'sceneEditing', 'snapshot'].some(key => Object.hasOwn(preview, key))
    || !Array.isArray(preview.diagnostics) || preview.diagnostics.some(item => item?.severity === 'error')) throw invalid();
  const composition = preview.composition, scene = preview.scene;
  if (composition?.format !== 'viento-scene-composition-preview' || composition.schemaVersion !== 1
    || composition.recipeObjectId !== owner.objectId || composition.sourcePath !== owner.sourcePath
    || composition.sourceRevision !== owner.sourceRevision || scene?.objectId !== owner.objectId
    || scene.sourcePath !== owner.sourcePath || scene.sourceRevision !== owner.sourceRevision) throw conflict();
  if (composition.fragmentCount !== source.fragments.length || composition.placementCount !== source.placements.length
    || !same([scene.title, scene.viewport, scene.background], [expanded.scene.title, expanded.scene.viewport, expanded.scene.background])) throw invalid();
  const actors = list(preview.actors, 128), locations = list(preview.sourceLocations?.actors, 128);
  if (actors.length !== expanded.scene.actors.length || locations.length !== actors.length) throw invalid();
  for (const [index, expected] of expanded.scene.actors.entries()) {
    const actor = actors[index], location = locations[index], origin = expanded.sourceMap.actors[index];
    if (actor.instanceId !== expected.instanceId || actor.objectId !== expected.objectId
      || location.instanceId !== expected.instanceId || location.objectId !== expected.objectId
      || location.composition?.fragmentId !== origin.fragmentId || location.composition.placementId !== origin.placementId
      || location.composition.localKey !== origin.localKey || location.declaration?.objectId !== owner.objectId
      || location.declaration.sourcePath !== owner.sourcePath || location.declaration.sourceRevision !== owner.sourceRevision) throw invalid();
    for (const key of ['position', 'size', 'color', 'speed', 'controls', 'imageResourceId']) if (Object.hasOwn(expected, key)) {
      if (key === 'imageResourceId' && expected[key] === null ? Object.hasOwn(actor, key) : !same(actor[key], expected[key])) throw invalid();
    }
  }
  const structure = { format: 'viento-scene-structure', schemaVersion: 1, sourceSchemaVersion: 3, groups: expanded.scene.groups,
    memberships: expanded.scene.actors.filter(actor => Object.hasOwn(actor, 'groupId'))
      .map(actor => ({ instanceId: actor.instanceId, groupId: actor.groupId })) };
  if (!same(preview.sceneStructure, structure)) throw invalid();
}

export async function createSceneCompositionMaterialization(input, { digest } = {}) {
  try {
  const value = exact(input, ['projection', 'confirmedWorld', 'preview', 'recipeId', 'content']);
  if (!uuid(value.recipeId) || typeof value.content !== 'string' || typeof digest !== 'function') throw invalid();
  const captured = catalogue(value.projection, value.recipeId);
  const confirmed = exact(value.confirmedWorld, ['id', 'revision']);
  if (!identity(confirmed.id) || !revision(confirmed.revision)) throw invalid();
  if (confirmed.id !== captured.worldId || confirmed.revision !== captured.baseRevision) throw conflict();
  const preview = jsonCopy(value.preview);
  const expanded = expandSceneComposition(value.content);
  const source = JSON.parse(value.content.replace(/^\uFEFF/, ''));
  // Capture everything before yielding to the host digest: caller changes must
  // not combine a different source/catalogue with this validation response.
  const hashed = await digest(value.content);
  if (typeof hashed !== 'string' || !/^[a-f0-9]{64}$/.test(hashed)) throw invalid();
  if (`sha256:${hashed}` !== captured.recipe.sourceRevision) throw conflict();
  validatePreview(preview, captured, expanded, source);
  return freeze({ format: 'viento-scene-composition-materialization', schemaVersion: 1, ...captured,
    recipe: { ...captured.recipe, title: expanded.scene.title }, scene: expanded.scene,
    content: JSON.stringify(expanded.scene, null, 2) + '\n' });
  } catch (error) {
    if (error?.errorCode === 'scene_composition_materialize_conflict') throw error;
    throw invalid();
  }
}

export function buildSceneCompositionMaterializationCommand(seed, input) {
  try {
    const captured = exact(seed, ['format', 'schemaVersion', 'worldId', 'baseRevision', 'documentRoot', 'documentTypes',
      'existingIdentities', 'existingPaths', 'recipe', 'scene', 'content']);
    const target = exact(input, ['objectId', 'documentType', 'sourcePath'], ['title', 'mode']);
    const scene = jsonCopy(captured.scene), recipe = exact(captured.recipe, ['objectId', 'sourcePath', 'sourceRevision', 'documentType', 'title']);
    if (captured.format !== 'viento-scene-composition-materialization' || captured.schemaVersion !== 1
      || !identity(captured.worldId) || !revision(captured.baseRevision) || !['documents', 'design-data'].includes(captured.documentRoot)
      || !uuid(recipe.objectId) || !relative(recipe.sourcePath) || !revision(recipe.sourceRevision) || !typeId(recipe.documentType)
      || scene.format !== 'viento-scene2d' || scene.schemaVersion !== 3 || !title(scene.title) || recipe.title !== scene.title
      || !text(captured.content, 262144) || captured.content !== JSON.stringify(scene, null, 2) + '\n') throw invalid();
    const identities = list(captured.existingIdentities, 100000), paths = list(captured.existingPaths, 100000);
    const types = list(captured.documentTypes, 1024).map(value => exact(value, ['id', 'label']));
    if (identities.some(value => !identity(value)) || paths.some(value => !relative(value))
      || types.some(value => !typeId(value.id) || !text(value.label, 256))) throw invalid();
    const name = Object.hasOwn(target, 'title') ? target.title : scene.title;
    const mode = Object.hasOwn(target, 'mode') ? target.mode : 'preview';
    if (!uuid(target.objectId) || identities.includes(target.objectId) || !types.some(type => type.id === target.documentType)
      || !text(target.sourcePath, 1024) || getCreatePathError(target.sourcePath)
      || !target.sourcePath.startsWith(captured.documentRoot + '/') || !target.sourcePath.toLowerCase().endsWith('.json')
      || paths.some(path => conflictsWithSourcePath(target.sourcePath, path)) || !title(name) || !['preview', 'apply'].includes(mode)) throw destination();
    const content = JSON.stringify({ ...scene, title: name }, null, 2) + '\n';
    if (content.length > 262144) throw destination();
    return freeze({ command: 'scene.create', mode, worldId: captured.worldId, baseRevision: captured.baseRevision,
      actorRef: { kind: 'user', id: 'local-ui' }, objectId: target.objectId, documentType: target.documentType,
      sourcePath: target.sourcePath, content });
  } catch (error) {
    if (error?.errorCode === 'scene_composition_materialize_destination') throw error;
    throw invalid();
  }
}
