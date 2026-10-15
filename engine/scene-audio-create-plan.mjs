// Creation allocates no identities and owns no project, media or playback IO.
// The existing Rust inspector remains the single audio-format authority.
import { inspectSceneAudio } from './scene-audio-core.mjs';
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
const invalid = () => { throw new TypeError('Expected exact audio creation data.'); };
function record(value, fields) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) invalid();
  const keys = Reflect.ownKeys(value); if (keys.length !== fields.length || keys.some(key => typeof key !== 'string' || !fields.includes(key))) invalid();
  return Object.fromEntries(fields.map(key => { const d = Object.getOwnPropertyDescriptor(value, key); if (!d?.enumerable || !Object.hasOwn(d, 'value')) invalid(); return [key, d.value]; }));
}
function creationTrack(value) {
  if (!value || typeof value !== 'object') invalid();
  const mode = Object.getOwnPropertyDescriptor(value, 'startMode');
  if (mode && (!mode.enumerable || !Object.hasOwn(mode, 'value') || !['timeline', 'behavior'].includes(mode.value))) invalid();
  const startMode = mode ? mode.value : 'timeline';
  return { ...record(value, ['trackId', 'cueId', 'resourceId', 'role', 'volume', 'loop',
    ...(startMode === 'timeline' ? ['atSeconds'] : []), ...(mode ? ['startMode'] : [])]), startMode };
}
export function createSceneAudioCreationDraft(input) {
  try {
    const raw = record(input, ['sceneObjectId', 'tracks']), list = raw.tracks;
    if (!Array.isArray(list) || ![Array.prototype, null].includes(Object.getPrototypeOf(list))) invalid();
    const length = Object.getOwnPropertyDescriptor(list, 'length')?.value;
    if (!Number.isSafeInteger(length) || length < 1 || length > 16 || Reflect.ownKeys(list).length !== length + 1) invalid();
    const tracks = [], cues = [], behaviorCueIds = new Set();
    for (let index = 0; index < length; index++) {
      const d = Object.getOwnPropertyDescriptor(list, String(index)); if (!d?.enumerable || !Object.hasOwn(d, 'value')) invalid();
      const row = creationTrack(d.value);
      tracks.push({ id: row.trackId, resourceId: row.resourceId, role: row.role, volume: row.volume, loop: row.loop });
      if (row.startMode === 'behavior') behaviorCueIds.add(row.cueId);
      // Retain and validate draft cue identities for mode switches, without
      // persisting a timeline cue for behavior-triggered tracks.
      cues.push({ id: row.cueId, trackId: row.trackId, atSeconds: row.startMode === 'behavior' ? 0 : row.atSeconds, action: 'play' });
    }
    let { document } = inspectSceneAudio({ format: 'viento-scene-audio', schemaVersion: 1, sceneObjectId: raw.sceneObjectId, tracks, cues });
    if (behaviorCueIds.size) ({ document } = inspectSceneAudio({ ...document, cues: document.cues.filter(cue => !behaviorCueIds.has(cue.id)) }));
    return freeze({ ok: true, content: JSON.stringify(document, null, 2) + '\n', resourceIds: [...new Set(document.tracks.map(track => track.resourceId))].sort(), diagnostics: [] });
  } catch (error) {
    return freeze({ ok: false, content: null, resourceIds: [], diagnostics: [{ severity: 'error', code: error?.errorCode === 'studio_core_unavailable' ? error.errorCode : 'build_audio_invalid',
      message: 'Expected allocated scene/track/cue/resource identities and complete bounded audio settings.', propertyPath: '' }] });
  }
}
