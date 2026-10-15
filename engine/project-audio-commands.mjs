import { canonicalJson } from './canonical-json.mjs';
import { projectRuntimeExact as exact, projectRuntimeUuid as uuid, projectRuntimeTime as time,
  copyProjectRuntimeData as copy, invalidProjectRuntime as invalid } from './project-runtime-contracts.mjs';
import { copyProjectStateOrigin as originCopy } from './project-shared-state.mjs';

// Receipts describe completed backend calls, never device playback state.
// The backend separately reserves its bounded queue before accepting requests.
export const PROJECT_AUDIO_COMMAND_LIMITS = Object.freeze({ commands: 256, pending: 64 });
function commandData(input, previous, tracks) {
  if (!exact(input, ['sequence', 'action', 'timeSeconds', 'origin', 'track'])
    || !Number.isInteger(input.sequence) || input.sequence < 1 || input.sequence > PROJECT_AUDIO_COMMAND_LIMITS.commands
    || !['play', 'stop'].includes(input.action) || !time(input.timeSeconds)
    || !exact(input.track, ['trackId', 'resourceId', 'source']) || !uuid(input.track.trackId) || !uuid(input.track.resourceId)) throw invalid();
  const origin = originCopy(input.origin);
  // Track declarations share the same bounded source-location vocabulary, but
  // retain their own document/range rather than inheriting the behavior source.
  const source = originCopy({ ...origin, source: input.track.source }).source;
  if (input.sequence !== (previous?.sequence || 0) + 1 || previous && (origin.visitIndex < previous.origin.visitIndex
    || origin.visitIndex === previous.origin.visitIndex && (origin.sceneId !== previous.origin.sceneId || input.timeSeconds < previous.timeSeconds))) throw invalid();
  const track = { trackId: input.track.trackId, resourceId: input.track.resourceId, source };
  const key = `${origin.sceneId}:${track.trackId}`, identity = canonicalJson(track), known = tracks.get(key);
  if (known !== undefined && known !== identity) throw invalid();
  tracks.set(key, identity);
  return { sequence: input.sequence, action: input.action, timeSeconds: input.timeSeconds === 0 ? 0 : input.timeSeconds, origin, track };
}

export function validateProjectAudioCommandsSnapshot(input) {
  const snapshot = copy(input);
  if (!exact(snapshot, ['sequence', 'entries']) || !Number.isInteger(snapshot.sequence) || snapshot.sequence < 0
    || snapshot.sequence > PROJECT_AUDIO_COMMAND_LIMITS.commands || !Array.isArray(snapshot.entries) || snapshot.entries.length !== snapshot.sequence) throw invalid();
  const entries = [], tracks = new Map();
  for (const entry of snapshot.entries) entries.push(commandData(entry, entries.at(-1), tracks));
  return { sequence: snapshot.sequence, entries };
}

export function createProjectAudioCommands() {
  const entries = [], tracks = new Map();
  return Object.freeze({
    get sequence() { return entries.length; },
    append(input) {
      const candidateTracks = new Map(tracks), entry = commandData(copy(input), entries.at(-1), candidateTracks);
      entries.push(entry);
      for (const [key, value] of candidateTracks) tracks.set(key, value);
    },
    snapshot() { return copy({ sequence: entries.length, entries }); },
  });
}
