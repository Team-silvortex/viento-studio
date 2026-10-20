import { canonicalJson } from './canonical-json.mjs';
import { projectRuntimeExact as exact, projectRuntimeUuid as uuid, projectRuntimeTime as time,
  copyProjectRuntimeData as copy, copyProjectAnimationClipSnapshotData as copyClips, invalidProjectRuntime as invalid } from './project-runtime-contracts.mjs';
import { copyProjectStateOrigin as originCopy } from './project-shared-state.mjs';

// A receipt is an executed transport command, not a live visual sample. The
// wire reader separately verifies its transition against the frozen Rust model.
export const PROJECT_ANIMATION_COMMAND_LIMITS = Object.freeze({ commands: 256, pending: 64 });
function clipData(clip, animation, origin) {
  if (clip === null) return null;
  if (!exact(clip, ['id', 'name', 'startSeconds', 'endSeconds', 'loop', 'source']) || !uuid(clip.id)
    || typeof clip.name !== 'string' || !clip.name.trim() || clip.name !== clip.name.trim() || [...clip.name].length > 128
    || /[\u0000-\u001f\u007f\ud800-\udfff]/u.test(clip.name)
    || !Number.isFinite(clip.startSeconds) || !Number.isFinite(clip.endSeconds)
    || clip.startSeconds < 0 || clip.startSeconds >= clip.endSeconds || clip.endSeconds > animation.durationSeconds || typeof clip.loop !== 'boolean') throw invalid();
  const source = originCopy({ ...origin, source: clip.source }).source;
  if (source.objectId !== animation.objectId || source.sourcePath !== animation.source.sourcePath
    || source.sourceRevision !== animation.source.sourceRevision || !/^\/clips\/(?:[0-9]|[12][0-9]|3[01])$/.test(source.propertyPath)) throw invalid();
  return { ...clip, source };
}
function commandData(input, previous, identities, protocolVersion) {
  const clips = protocolVersion === 6;
  if (!exact(input, ['sequence', 'command', 'state', 'origin', 'animation', ...(clips ? ['clip'] : [])])
    || !Number.isInteger(input.sequence) || input.sequence < 1 || input.sequence > PROJECT_ANIMATION_COMMAND_LIMITS.commands) throw invalid();
  const { command, state, animation } = input, seek = command?.action === 'seek', select = command?.action === 'select';
  if (!exact(command, ['action', ...(seek ? ['positionSeconds'] : []), ...(clips && select ? ['clipId'] : [])])
    || !['play', 'pause', 'stop', 'seek', ...(clips ? ['select'] : [])].includes(command.action)
    || !exact(animation, ['objectId', 'source', 'durationSeconds', 'loop']) || !uuid(animation.objectId)
    || !Number.isFinite(animation.durationSeconds) || animation.durationSeconds <= 0 || animation.durationSeconds > 60 || typeof animation.loop !== 'boolean'
    || !exact(state, ['sceneObjectId', 'phase', 'positionSeconds', 'timeSeconds', ...(clips ? ['clipId'] : [])])
    || !['playing', 'paused', 'stopped', 'finished'].includes(state.phase) || !time(state.timeSeconds)) throw invalid();
  const origin = originCopy(input.origin), source = originCopy({ ...origin, source: animation.source }).source;
  const clip = clips ? clipData(input.clip, animation, origin) : null;
  const duration = clip ? clip.endSeconds - clip.startSeconds : animation.durationSeconds, loop = clip ? clip.loop : animation.loop;
  if (!Number.isFinite(state.positionSeconds) || state.positionSeconds < 0 || state.positionSeconds > duration
    || loop && state.positionSeconds === duration
    || seek && (!Number.isFinite(command.positionSeconds) || command.positionSeconds < 0 || command.positionSeconds > duration)
    || clips && state.clipId !== (clip?.id ?? null)
    || select && (command.clipId !== state.clipId || state.phase !== 'paused' || state.positionSeconds !== 0)
    || clips && !select && state.clipId !== (previous?.origin.visitIndex === origin.visitIndex ? previous.state.clipId : null)
    || source.objectId !== animation.objectId || state.sceneObjectId !== origin.sceneId || animation.objectId === origin.sceneId
    || input.sequence !== (previous?.sequence || 0) + 1
    || previous && (origin.visitIndex < previous.origin.visitIndex || origin.visitIndex === previous.origin.visitIndex
      && (origin.sceneId !== previous.origin.sceneId || state.timeSeconds < previous.state.timeSeconds))
    || command.action === 'play' && (state.phase !== 'playing' || state.positionSeconds >= duration)
    || command.action === 'pause' && state.phase !== 'paused'
    || command.action === 'stop' && (state.phase !== 'stopped' || state.positionSeconds !== 0)
    || seek && (state.phase !== 'paused' || state.positionSeconds !== (loop && command.positionSeconds === duration ? 0 : command.positionSeconds))) throw invalid();
  const checkIdentity = (key, value) => {
    const identity = canonicalJson(value), known = identities.get(key);
    if (known !== undefined && known !== identity) throw invalid();
    identities.set(key, identity);
  };
  checkIdentity(origin.sceneId, animation);
  if (clip) {
    checkIdentity(`${origin.sceneId}/${clip.id}`, clip);
    checkIdentity(`${origin.sceneId}${clip.source.propertyPath}`, clip.id);
  }
  return { sequence: input.sequence, command, state, origin, animation: { ...animation, source }, ...(clips ? { clip } : {}) };
}
function protocol(version) { if (![5, 6].includes(version)) throw invalid(); return version === 6 ? copyClips : copy; }
export function validateProjectAnimationCommandsSnapshot(input, { protocolVersion = 5 } = {}) {
  const snapshot = protocol(protocolVersion)(input);
  if (!exact(snapshot, ['sequence', 'entries']) || !Number.isInteger(snapshot.sequence) || snapshot.sequence < 0
    || snapshot.sequence > PROJECT_ANIMATION_COMMAND_LIMITS.commands || !Array.isArray(snapshot.entries) || snapshot.entries.length !== snapshot.sequence) throw invalid();
  const entries = [], identities = new Map();
  for (const entry of snapshot.entries) entries.push(commandData(entry, entries.at(-1), identities, protocolVersion));
  return { sequence: snapshot.sequence, entries };
}
export function createProjectAnimationCommands({ protocolVersion = 5 } = {}) {
  const detach = protocol(protocolVersion), entries = [], identities = new Map();
  return Object.freeze({
    get sequence() { return entries.length; },
    append(input) {
      const candidate = new Map(identities), entry = commandData(copy(input), entries.at(-1), candidate, protocolVersion);
      entries.push(entry);
      for (const [key, value] of candidate) identities.set(key, value);
    },
    snapshot() { return detach({ sequence: entries.length, entries }); },
  });
}
