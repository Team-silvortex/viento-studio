// Read-only registered WAV choices for one reviewed audio source. The host
// fetches context and verifies saved-content hashes; this grants no write IO.
import { captureSceneAudioCreationContext } from './scene-audio-creation-contract.mjs';
import { inspectSceneAudio } from './scene-audio-core.mjs';
import { parseJsonSource } from './json-source.mjs';
import { canonicalJson } from './canonical-json.mjs';

const catalogs = new WeakMap();
const sourceKeys = ['sourcePath', 'token', 'baseSourceRevision', 'sourceRevision', 'content'];
const fail = () => { throw Object.assign(new TypeError('The registered audio resources do not match this source.'), { errorCode: 'scene_audio_resources_invalid' }); };
const revision = value => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
const unicode = value => !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value);
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
function captureSource(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || ![Object.prototype, null].includes(Object.getPrototypeOf(input))
    || Object.getOwnPropertyDescriptor(Object.prototype, 'toJSON') || Object.getOwnPropertyDescriptor(Array.prototype, 'toJSON')) fail();
  const descriptors = Object.getOwnPropertyDescriptors(input), keys = Reflect.ownKeys(descriptors);
  if (keys.length !== sourceKeys.length || keys.some(key => typeof key !== 'string' || !sourceKeys.includes(key))
    || sourceKeys.some(key => !descriptors[key]?.enumerable || !Object.hasOwn(descriptors[key], 'value'))) fail();
  const source = Object.fromEntries(sourceKeys.map(key => [key, descriptors[key].value]));
  if (typeof source.sourcePath !== 'string' || !source.sourcePath || source.sourcePath.length > 4096 || !unicode(source.sourcePath)
    || source.sourcePath.startsWith('/') || /^[A-Za-z]:/.test(source.sourcePath) || /[\\\0]/.test(source.sourcePath)
    || source.sourcePath.split('/').some(part => !part || part === '.' || part === '..') || !/\.json$/i.test(source.sourcePath)
    || typeof source.token !== 'string' || !source.token || source.token.length > 256 || !unicode(source.token)
    || !revision(source.baseSourceRevision) || !revision(source.sourceRevision) || typeof source.content !== 'string'
    || source.content.length > 65536 || !unicode(source.content) || new TextEncoder().encode(source.content).length > 65536) fail();
  return Object.freeze(source);
}

export function captureSceneAudioResources(source, rawCreationContext) {
  const captured = captureSource(source), parsed = parseJsonSource(captured.content);
  if (!parsed.ok) fail();
  inspectSceneAudio(parsed.value);
  const context = captureSceneAudioCreationContext(rawCreationContext, parsed.value.sceneObjectId);
  if (context.status !== 'ready' || context.manifest.sourcePath !== captured.sourcePath
    || context.manifest.sourceRevision !== captured.baseSourceRevision) fail();
  const bound = new Set(context.manifest.assetBindings.map(binding => binding.assetId));
  const catalog = freeze({ sourcePath: captured.sourcePath, token: captured.token, baseSourceRevision: captured.baseSourceRevision,
    sourceRevision: captured.sourceRevision, sceneObjectId: parsed.value.sceneObjectId,
    worldId: context.worldId, worldRevision: context.baseRevision, objectId: context.manifest.objectId,
    objectRevision: context.manifest.objectRevision, savedContent: context.manifest.content,
    resources: context.resources.filter(resource => bound.has(resource.resourceId)) });
  catalogs.set(catalog, { source: captured, context, identityIds: Object.freeze(context.resources.map(resource => resource.resourceId)) });
  return catalog;
}
export function isSceneAudioResources(value) { return Boolean(value && typeof value === 'object' && catalogs.has(value)); }
export function sceneAudioResourcesMatchSource(catalog, source) {
  if (!isSceneAudioResources(catalog)) return false;
  try {
    const captured = captureSource(source), original = catalogs.get(catalog).source;
    return sourceKeys.every(key => captured[key] === original[key]);
  } catch { return false; }
}
export function sceneAudioResourcesEqual(left, right) {
  if (!isSceneAudioResources(left) || !isSceneAudioResources(right)) return false;
  const a = catalogs.get(left), b = catalogs.get(right);
  return sourceKeys.every(key => a.source[key] === b.source[key]) && canonicalJson(a.context) === canonicalJson(b.context);
}
// Identity allocation must also avoid available catalog entries that are not
// bound to this document. They remain unavailable as selectable resources.
export function sceneAudioResourceIdentityIds(catalog) {
  if (!isSceneAudioResources(catalog)) fail();
  return catalogs.get(catalog).identityIds;
}
