// Prepare one verified, immutable audio-byte snapshot. Device access and
// playback belong to the browser adapter; no source or metadata is written.
import { isSceneAudioResources, sceneAudioResourcesMatchSource, sceneAudioResourcesEqual } from './scene-audio-resources.mjs';
import { validatePcmWave } from './audio-wav.mjs';

const auditions = new WeakMap();
const sourceKeys = ['sourcePath', 'token', 'baseSourceRevision', 'sourceRevision', 'content'];
const typedArray = Object.getPrototypeOf(Uint8Array.prototype);
const byteLength = Object.getOwnPropertyDescriptor(typedArray, 'byteLength').get;
const buffer = Object.getOwnPropertyDescriptor(typedArray, 'buffer').get;
const maximumBytes = 32 * 1024 * 1024;
const failure = code => { throw Object.assign(new Error(code === 'scene_audio_audition_conflict'
  ? 'The sound source or resource catalog changed; read the resources again.'
  : code === 'scene_audio_audition_resource_changed' ? 'The WAV bytes no longer match their registered size and hash.'
    : 'Invalid audio audition input.'), { errorCode: code }); };
const invalid = () => failure('scene_audio_audition_invalid');
function captureSource(source, catalog) {
  if (!source || typeof source !== 'object' || Array.isArray(source)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(source))) invalid();
  const descriptors = Object.getOwnPropertyDescriptors(source), keys = Reflect.ownKeys(descriptors);
  if (keys.length !== sourceKeys.length || keys.some(key => typeof key !== 'string' || !sourceKeys.includes(key))
    || sourceKeys.some(key => !descriptors[key]?.enumerable || !Object.hasOwn(descriptors[key], 'value'))) invalid();
  const captured = Object.freeze(Object.fromEntries(sourceKeys.map(key => [key, descriptors[key].value])));
  if (!sceneAudioResourcesMatchSource(catalog, captured)) failure('scene_audio_audition_conflict');
  return captured;
}
function captureBytes(value, expectedSize) {
  if (!(value instanceof Uint8Array)) invalid();
  let length, storage;
  try { length = byteLength.call(value); storage = buffer.call(value); } catch { invalid(); }
  // A shared backing store can change during copying. Other typed-array views,
  // including Node Buffers, are copied using built-ins without calling getters.
  if (!(storage instanceof ArrayBuffer)) invalid();
  if (length !== expectedSize || length < 44 || length > maximumBytes) failure('scene_audio_audition_resource_changed');
  const copied = new Uint8Array(length);
  try { Uint8Array.prototype.set.call(copied, value); } catch { invalid(); }
  return copied;
}

export async function prepareSceneAudioAudition(source, catalog, resourceId,
  { getResources, readBytes, digestBytes, isCurrent = () => true, signal } = {}) {
  if (!isSceneAudioResources(catalog) || typeof resourceId !== 'string' || typeof getResources !== 'function'
    || typeof readBytes !== 'function' || typeof digestBytes !== 'function' || typeof isCurrent !== 'function') invalid();
  const captured = captureSource(source, catalog);
  if (!catalog.resources.some(resource => resource.resourceId === resourceId)) invalid();
  const current = () => {
    if (signal?.aborted) throw signal.reason || Object.assign(new Error('Audio audition was aborted.'), { name: 'AbortError' });
    if (isCurrent() !== true) failure('scene_audio_audition_conflict');
  };
  current();
  const fresh = await getResources(captured);
  current();
  if (fresh === catalog || !sceneAudioResourcesMatchSource(fresh, captured) || !sceneAudioResourcesEqual(catalog, fresh)) {
    failure('scene_audio_audition_conflict');
  }
  const resource = fresh.resources.find(item => item.resourceId === resourceId);
  const received = await readBytes(resource, { signal });
  current();
  const bytes = captureBytes(received, resource.size);
  // A host digest implementation must never retain a view of the byte snapshot
  // that is subsequently handed to the decoder.
  const hash = await digestBytes(new Uint8Array(bytes));
  current();
  if (typeof hash !== 'string' || hash !== resource.sha256) failure('scene_audio_audition_resource_changed');
  const { channels, sampleRate, frames } = validatePcmWave(bytes);
  const prepared = Object.freeze({ resourceId, name: resource.name, channels, sampleRate, frames, durationSeconds: frames / sampleRate });
  auditions.set(prepared, bytes);
  return prepared;
}

export function isSceneAudioAudition(value) { return Boolean(value && typeof value === 'object' && auditions.has(value)); }
export function sceneAudioAuditionBytes(value) {
  if (!isSceneAudioAudition(value)) invalid();
  return new Uint8Array(auditions.get(value)).buffer;
}
