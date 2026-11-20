// Source-bound, read-only choices for a first behavior's parameter JSON. No
// behavior registration, hidden relation, I/O or runtime authority is created.
import { captureSceneBehaviorReferenceDirectory } from './scene-behavior-reference-directory.mjs';
import { createSceneBehaviorCreationDraft } from './scene-behavior-create-plan.mjs';
import { applySceneBehaviorCreateParameterSources } from './scene-behavior-create-parameters.mjs';
import { parseJsonSource, locateJsonSource } from './json-source.mjs';

const origins = new WeakMap();
const invalid = () => { throw Object.assign(new TypeError('Invalid first-behavior reference origin, directory or parameter selection.'), { errorCode: 'scene_behavior_create_references_invalid' }); };
const full = (pattern, value) => typeof value === 'string' && pattern.exec(value)?.[0] === value;
const uuid = value => full(/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/, value);
const revision = value => full(/^sha256:[a-f0-9]{64}$/, value);
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
function record(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) invalid();
  const descriptors = Object.getOwnPropertyDescriptors(value), names = Reflect.ownKeys(descriptors);
  if (names.length !== keys.length || names.some(key => typeof key !== 'string' || !keys.includes(key))
    || keys.some(key => !descriptors[key]?.enumerable || !Object.hasOwn(descriptors[key], 'value'))) invalid();
  return Object.fromEntries(keys.map(key => [key, descriptors[key].value]));
}
export function captureSceneBehaviorCreateOrigin(value) {
  const captured = record(value, ['worldId', 'baseRevision', 'scene']);
  captured.scene = record(captured.scene, ['objectId', 'objectRevision', 'sourcePath', 'sourceRevision']);
  if (!full(/^world:[a-f0-9]{64}$/, captured.worldId) || !revision(captured.baseRevision)
    || !uuid(captured.scene.objectId) || !revision(captured.scene.objectRevision) || !revision(captured.scene.sourceRevision)
    || typeof captured.scene.sourcePath !== 'string' || !captured.scene.sourcePath || captured.scene.sourcePath.length > 4096) invalid();
  return freeze(captured);
}
const same = (a, b) => a.worldId === b.worldId && a.baseRevision === b.baseRevision
  && ['objectId', 'objectRevision', 'sourcePath', 'sourceRevision'].every(key => a.scene[key] === b.scene[key]);
export function captureSceneBehaviorCreateReferences(inputOrigin, raw) {
  const captured = captureSceneBehaviorCreateOrigin(inputOrigin), directory = captureSceneBehaviorReferenceDirectory(raw, captured.scene.objectId);
  if (directory.worldId !== captured.worldId || directory.revision !== captured.baseRevision
    || ['objectId', 'sourcePath', 'sourceRevision'].some(key => directory.scene[key] !== captured.scene[key])) invalid();
  origins.set(directory, captured);
  return directory;
}
export function isSceneBehaviorCreateReferences(value) { return Boolean(value && typeof value === 'object' && origins.has(value)); }
export function sceneBehaviorCreateReferencesMatchOrigin(catalog, inputOrigin) {
  if (!isSceneBehaviorCreateReferences(catalog)) return false;
  try { return same(origins.get(catalog), captureSceneBehaviorCreateOrigin(inputOrigin)); } catch { return false; }
}
const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const empty = createSceneBehaviorCreationDraft({ sceneObjectId: id, backendId: 'org.viento.godot4', language: 'gdscript', bindings: [{ bindingId: id, instanceId: id, sourceObjectId: id }] }).content;
function parameters(content) {
  // Reuse the first-creation scalar/UTF-8/budget authority. Its identity-only
  // skeleton is internal data, never an authored manifest or a source brand.
  applySceneBehaviorCreateParameterSources({ content: empty, parameters: [content] });
  const parsed = parseJsonSource(content);
  if (!parsed.ok) invalid();
  return parsed;
}
export function listSceneBehaviorCreateStringParameters(content) {
  const parsed = parameters(content);
  return freeze(Object.entries(parsed.value).filter(([, value]) => typeof value === 'string').map(([name, value]) => ({ name, value })));
}
export function proposeSceneBehaviorCreateReference(input) {
  const { content, catalog, origin: selectedOrigin, parameter, kind, value } = record(input, ['content', 'catalog', 'origin', 'parameter', 'kind', 'value']);
  if (!sceneBehaviorCreateReferencesMatchOrigin(catalog, selectedOrigin) || !['instance', 'scene', 'action'].includes(kind)
    || typeof parameter !== 'string' || typeof value !== 'string' || value.length > 4096) invalid();
  const choices = kind === 'instance' ? catalog.instances.map(row => row.instanceId)
    : kind === 'scene' ? (catalog.selectedAssembly?.members || []).map(row => row.objectId)
      : (catalog.selectedAssembly?.actions || []).map(row => row.name);
  if (!choices.includes(value) || kind !== 'action' && !uuid(value)) invalid();
  const parsed = parameters(content);
  if (!Object.hasOwn(parsed.value, parameter) || typeof parsed.value[parameter] !== 'string') invalid();
  if (parsed.value[parameter] === value) return freeze({ content, changed: false });
  const pointer = '/' + parameter.replaceAll('~', '~0').replaceAll('/', '~1'), location = locateJsonSource(parsed, pointer);
  if (!location?.exact || location.encoding !== 'utf-16') invalid();
  const next = content.slice(0, location.start) + JSON.stringify(value) + content.slice(location.end);
  parameters(next);
  return freeze({ content: next, changed: true });
}
