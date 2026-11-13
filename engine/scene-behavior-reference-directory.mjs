// Saved reference identities only. Choosing a value grants no runtime or write authority.
import { inspectSceneBehaviors } from './scene-behaviors.mjs';
import { validateProjectInputMap } from './project-input-map.mjs';
import { normalizeSourcePath } from './source-path.mjs';

export const SCENE_BEHAVIOR_REFERENCE_DIRECTORY_API_PATH = '/api/scene-behavior-reference-directory';
const catalogs = new WeakMap();
const sourceKeys = ['sourcePath', 'token', 'baseSourceRevision', 'sourceRevision', 'content'];
const sceneKeys = ['objectId', 'sourcePath', 'sourceRevision'];
const namedKeys = ['objectId', 'name', 'sourcePath', 'sourceRevision'];
const fail = () => { throw Object.assign(new TypeError('Invalid scene behavior reference directory or behavior source.'), {
  errorCode: 'scene_behavior_reference_directory_invalid',
}); };
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const revision = value => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
const unicode = value => !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value);
const text = (value, maximum) => typeof value === 'string' && value.length > 0 && value.length <= maximum && unicode(value);
const path = value => text(value, 4096) && normalizeSourcePath(value) === value && !/^[A-Za-z]:/.test(value);
const jsonPath = value => path(value) && /\.json$/i.test(value);
const same = (a, b, keys) => keys.every(key => a[key] === b[key]);
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
const guard = action => { try { return action(); } catch { fail(); } };

// Read exact data descriptors before values: no getter, serializer or inherited
// field can affect this detached capture, including nested arrays.
function record(input, keys) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) fail();
  const descriptors = Object.getOwnPropertyDescriptors(input), own = Reflect.ownKeys(descriptors);
  if (own.length !== keys.length || own.some(key => typeof key !== 'string' || !keys.includes(key))) fail();
  return Object.fromEntries(keys.map(key => {
    const descriptor = descriptors[key];
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) fail();
    return [key, descriptor.value];
  }));
}
function array(input, minimum, maximum) {
  if (!Array.isArray(input) || Object.getPrototypeOf(input) !== Array.prototype) fail();
  const descriptors = Object.getOwnPropertyDescriptors(input), length = descriptors.length?.value;
  if (!Number.isSafeInteger(length) || length < minimum || length > maximum || Reflect.ownKeys(descriptors).length !== length + 1) fail();
  return Array.from({ length }, (_, index) => {
    const descriptor = descriptors[String(index)];
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) fail();
    return descriptor.value;
  });
}
function describe(input, named = false, json = true) {
  const value = record(input, named ? namedKeys : sceneKeys);
  if (!uuid(value.objectId) || !(json ? jsonPath : path)(value.sourcePath) || !revision(value.sourceRevision)) fail();
  if (named && (!text(value.name, 160) || !value.name.trim() || /[\x00-\x1f\x7f]/.test(value.name))) fail();
  return value;
}
function uniqueDescriptors(values) {
  if (new Set(values.map(value => value.objectId)).size !== values.length || new Set(values.map(value => value.sourcePath)).size !== values.length) fail();
}
function directory(raw, sceneObjectId) {
  if (!uuid(sceneObjectId)) fail();
  const value = record(raw, ['format', 'schemaVersion', 'worldId', 'revision', 'scene', 'instances', 'assemblies', 'selectedAssembly']);
  if (value.format !== 'viento-scene-behavior-reference-directory' || value.schemaVersion !== 1
    || typeof value.worldId !== 'string' || !/^world:[a-f0-9]{64}$/.test(value.worldId) || !revision(value.revision)) fail();
  value.scene = describe(value.scene);
  if (value.scene.objectId !== sceneObjectId) fail();
  const definitions = new Map(), instances = new Set();
  value.instances = array(value.instances, 1, 128).map(rawInstance => {
    const row = record(rawInstance, ['instanceId', ...namedKeys]);
    if (!uuid(row.instanceId) || instances.has(row.instanceId)) fail();
    instances.add(row.instanceId);
    const { instanceId, ...descriptor } = row, captured = describe(descriptor, true, false);
    if (captured.objectId === sceneObjectId || captured.sourcePath === value.scene.sourcePath) fail();
    const previous = definitions.get(captured.objectId);
    if (previous && !same(previous, captured, namedKeys)) fail();
    if ([...definitions.values()].some(other => other.objectId !== captured.objectId && other.sourcePath === captured.sourcePath)) fail();
    definitions.set(captured.objectId, captured);
    return { instanceId, ...captured };
  });
  value.assemblies = array(value.assemblies, 0, 256).map(rawAssembly => describe(rawAssembly, true));
  uniqueDescriptors(value.assemblies);
  if (value.assemblies.some(assembly => assembly.objectId === sceneObjectId || assembly.sourcePath === value.scene.sourcePath)) fail();
  if (value.selectedAssembly !== null) {
    const selected = record(value.selectedAssembly, [...namedKeys, 'members', 'inputMap', 'actions']);
    const { members, inputMap, actions, ...identity } = selected, descriptor = describe(identity, true);
    if (!value.assemblies.some(assembly => same(assembly, descriptor, namedKeys))) fail();
    const capturedMembers = array(members, 1, 32).map(member => describe(member, true));
    uniqueDescriptors(capturedMembers);
    if (!capturedMembers.some(member => same(member, value.scene, sceneKeys))
      || capturedMembers.some(member => member.objectId === descriptor.objectId || member.sourcePath === descriptor.sourcePath)) fail();
    const capturedInput = inputMap === null ? null : describe(inputMap);
    let capturedActions;
    if (capturedInput) {
      if (capturedInput.objectId === descriptor.objectId || capturedInput.sourcePath === descriptor.sourcePath
        || capturedMembers.some(member => member.objectId === capturedInput.objectId || member.sourcePath === capturedInput.sourcePath)) fail();
      // Reuse the authored portable-map contract; built-in ui_* actions are not
      // declarations and never enter this catalog.
      capturedActions = validateProjectInputMap({ format: 'viento-input-map', schemaVersion: 1, actions }).actions;
    } else {
      capturedActions = array(actions, 0, 0);
    }
    value.selectedAssembly = { ...descriptor, members: capturedMembers, inputMap: capturedInput, actions: capturedActions };
  }
  return freeze(value);
}
function source(input) {
  const value = record(input, sourceKeys);
  if (!jsonPath(value.sourcePath) || !text(value.token, 256) || !revision(value.baseSourceRevision) || !revision(value.sourceRevision)
    || !text(value.content, 32768) || new TextEncoder().encode(value.content).length > 32768) fail();
  const checked = inspectSceneBehaviors(value.content);
  if (!checked.recognized || !checked.ok || !checked.value) fail();
  return { value: Object.freeze(value), sceneObjectId: checked.value.sceneObjectId };
}
export function captureSceneBehaviorReferenceDirectory(raw, sceneObjectId) {
  return guard(() => directory(raw, sceneObjectId));
}
export function captureSceneBehaviorReferences(inputSource, raw, expectedScene) {
  return guard(() => {
    const captured = source(inputSource), expected = describe(expectedScene), value = directory(raw, captured.sceneObjectId);
    if (!same(expected, value.scene, sceneKeys) || value.scene.sourcePath === captured.value.sourcePath
      || value.assemblies.some(assembly => assembly.sourcePath === captured.value.sourcePath)
      || value.selectedAssembly?.members.some(member => member.sourcePath === captured.value.sourcePath)
      || value.selectedAssembly?.inputMap?.sourcePath === captured.value.sourcePath) fail();
    catalogs.set(value, captured.value);
    return value;
  });
}
export function isSceneBehaviorReferences(value) { return Boolean(value && typeof value === 'object' && catalogs.has(value)); }
export function sceneBehaviorReferencesMatchSource(catalog, inputSource) {
  if (!isSceneBehaviorReferences(catalog)) return false;
  try { const captured = source(inputSource).value, original = catalogs.get(catalog); return same(original, captured, sourceKeys); }
  catch { return false; }
}
export function sceneBehaviorReferenceValue(catalog, selection) {
  return guard(() => {
    if (!isSceneBehaviorReferences(catalog)) fail();
    const { kind, value } = record(selection, ['kind', 'value']);
    if (!['instance', 'scene', 'action'].includes(kind) || typeof value !== 'string' || value.length > 4096 || !unicode(value)) fail();
    const values = kind === 'instance' ? catalog.instances.map(row => row.instanceId)
      : kind === 'scene' ? (catalog.selectedAssembly?.members || []).map(row => row.objectId)
        : (catalog.selectedAssembly?.actions || []).map(row => row.name);
    return values.includes(value) ? value : null;
  });
}
