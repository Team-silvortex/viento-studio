// Saved audio track choices for an unregistered first behavior. Native/WASM
// audio rules own the declaration; this layer owns origin and local text only.
import { captureSceneAudioDirectory } from './scene-audio-directory.mjs';
import { inspectSceneAudio } from './scene-audio-core.mjs';
import { captureSceneBehaviorCreateOrigin, listSceneBehaviorCreateStringParameters } from './scene-behavior-create-references.mjs';
import { parseJsonSource, locateJsonSource } from './json-source.mjs';

const catalogs = new WeakMap();
const fail = (code = 'scene_behavior_create_audio_invalid') => { throw Object.assign(new TypeError('Invalid first-behavior audio origin, directory or String selection.'), { errorCode: code }); };
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.exec(value)?.[0] === value;
const revision = value => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.exec(value)?.[0] === value;
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
const same = (left, right) => left.worldId === right.worldId && left.baseRevision === right.baseRevision
  && ['objectId', 'objectRevision', 'sourcePath', 'sourceRevision'].every(key => left.scene[key] === right.scene[key]);
function record(input, keys) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) fail();
  const descriptors = Object.getOwnPropertyDescriptors(input), names = Reflect.ownKeys(descriptors);
  if (names.length !== keys.length || names.some(key => typeof key !== 'string' || !keys.includes(key))
    || keys.some(key => !descriptors[key]?.enumerable || !Object.hasOwn(descriptors[key], 'value'))) fail();
  return Object.fromEntries(keys.map(key => [key, descriptors[key].value]));
}
export function captureSceneBehaviorCreateAudio(inputOrigin, raw) {
  let origin, directory;
  try { origin = captureSceneBehaviorCreateOrigin(inputOrigin); directory = captureSceneAudioDirectory(raw, origin.scene.objectId); }
  catch { fail(); }
  if (directory.worldId !== origin.worldId || directory.revision !== origin.baseRevision
    || ['objectId', 'sourcePath', 'sourceRevision'].some(key => directory.scene[key] !== origin.scene[key])) fail('scene_behavior_create_audio_origin_changed');
  let tracks;
  try { tracks = directory.manifest ? inspectSceneAudio(parseJsonSource(directory.manifest.content).value).document.tracks
    .map(track => ({ trackId: track.id, resourceId: track.resourceId, role: track.role })) : []; }
  catch { fail(); }
  if (tracks.some(track => !uuid(track.trackId) || !uuid(track.resourceId)) || directory.manifest && (!uuid(directory.manifest.objectId) || !revision(directory.manifest.sourceRevision))) fail();
  const value = freeze({ status: directory.status, worldId: directory.worldId, revision: directory.revision, scene: directory.scene,
    manifest: directory.manifest ? Object.fromEntries(['objectId', 'sourcePath', 'sourceRevision'].map(key => [key, directory.manifest[key]])) : null, tracks });
  catalogs.set(value, origin); return value;
}
export function isSceneBehaviorCreateAudio(value) { return Boolean(value && typeof value === 'object' && catalogs.has(value)); }
export function sceneBehaviorCreateAudioMatchOrigin(catalog, inputOrigin) {
  if (!isSceneBehaviorCreateAudio(catalog)) return false;
  try { return same(catalogs.get(catalog), captureSceneBehaviorCreateOrigin(inputOrigin)); } catch { return false; }
}
export function proposeSceneBehaviorCreateAudio(input) {
  const { content, catalog, origin, parameter, trackId } = record(input, ['content', 'catalog', 'origin', 'parameter', 'trackId']);
  if (!sceneBehaviorCreateAudioMatchOrigin(catalog, origin) || !uuid(trackId) || !catalog.tracks.some(track => track.trackId === trackId) || typeof parameter !== 'string') fail();
  const existing = listSceneBehaviorCreateStringParameters(content).find(row => row.name === parameter);
  if (!existing) fail();
  if (existing.value === trackId) return freeze({ content, changed: false });
  const source = parseJsonSource(content), location = locateJsonSource(source, '/' + parameter.replaceAll('~', '~0').replaceAll('/', '~1'));
  if (!location?.exact || location.encoding !== 'utf-16') fail();
  const next = content.slice(0, location.start) + JSON.stringify(trackId) + content.slice(location.end);
  listSceneBehaviorCreateStringParameters(next);
  return freeze({ content: next, changed: true });
}
