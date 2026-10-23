import { canonicalJson } from './canonical-json.mjs';
import { PROJECT_RUNTIME_MAX_VISITS, projectRuntimeExact as exact, projectRuntimeUuid as uuid, projectRuntimeTime as time,
  copyProjectRuntimeData as copy, copyProjectAnimationCompletionSnapshotData as copySnapshot, invalidProjectRuntime as invalid } from './project-runtime-contracts.mjs';
import { copyProjectStateOrigin as originCopy } from './project-shared-state.mjs';

// Natural completion belongs to the animation and visit, not to a fictitious
// publishing behavior. Recipients retain their separate author origins.
export const PROJECT_ANIMATION_COMPLETION_LIMITS = Object.freeze({
  completions: 320, recipients: 64, deliveries: 1024, subscriptionId: 1024, pending: 64,
});
const integer = (value, low, high) => Number.isInteger(value) && value >= low && value <= high;
const pointer = value => typeof value === 'string' && value.length <= 4096
  && (value === '' || value.startsWith('/')) && !/~(?:[^01]|$)/.test(value);
function sourceData(input) {
  if (!exact(input, ['objectId', 'sourcePath', 'sourceRevision', 'propertyPath', ...(Object.hasOwn(input || {}, 'sourceRange') ? ['sourceRange'] : [])])
    || !uuid(input.objectId) || typeof input.sourcePath !== 'string' || !input.sourcePath.length || input.sourcePath.length > 4096
    || /[\\\0]/.test(input.sourcePath) || input.sourcePath.startsWith('/') || input.sourcePath.startsWith('.') || /^[A-Za-z]:/.test(input.sourcePath)
    || input.sourcePath.split('/').some(part => !part || part === '.' || part === '..')
    || !/^sha256:[a-f0-9]{64}$/.test(input.sourceRevision) || !pointer(input.propertyPath)) throw invalid();
  if (Object.hasOwn(input, 'sourceRange')) {
    const range = input.sourceRange;
    if (!exact(range, ['start', 'end', 'encoding', ...(Object.hasOwn(range || {}, 'propertyPath') ? ['propertyPath'] : []), ...(Object.hasOwn(range || {}, 'exact') ? ['exact'] : [])])
      || !Number.isSafeInteger(range.start) || range.start < 0 || !Number.isSafeInteger(range.end) || range.end <= range.start
      || range.encoding !== 'utf-16' || Object.hasOwn(range, 'propertyPath') && !pointer(range.propertyPath)
      || Object.hasOwn(range, 'exact') && typeof range.exact !== 'boolean') throw invalid();
  }
  return input;
}
function identity(map, key, value) {
  const encoded = canonicalJson(value), old = map.get(key);
  if (old !== undefined && old !== encoded) throw invalid();
  map.set(key, encoded);
}
function entryData(input, previous, identities, tokens) {
  if (!exact(input, ['sequence', 'commandSequence', 'visitIndex', 'sceneId', 'state', 'animation', 'clip', 'deliveries'])
    || !integer(input.sequence, 1, PROJECT_ANIMATION_COMPLETION_LIMITS.completions)
    || input.sequence !== (previous?.sequence || 0) + 1 || !integer(input.commandSequence, 0, 256)
    || !integer(input.visitIndex, 1, PROJECT_RUNTIME_MAX_VISITS) || !uuid(input.sceneId)
    || !Array.isArray(input.deliveries) || input.deliveries.length > PROJECT_ANIMATION_COMPLETION_LIMITS.recipients) throw invalid();
  const { state, animation, clip } = input;
  if (!exact(animation, ['objectId', 'source', 'durationSeconds', 'loop']) || !uuid(animation.objectId)
    || animation.objectId === input.sceneId || !Number.isFinite(animation.durationSeconds)
    || animation.durationSeconds <= 0 || animation.durationSeconds > 60 || typeof animation.loop !== 'boolean'
    || !exact(state, ['sceneObjectId', 'phase', 'positionSeconds', 'timeSeconds', 'clipId'])
    || state.sceneObjectId !== input.sceneId || state.phase !== 'finished' || !time(state.timeSeconds)) throw invalid();
  const source = sourceData(animation.source);
  if (source.objectId !== animation.objectId || source.propertyPath !== '') throw invalid();
  if (clip !== null) {
    if (!exact(clip, ['id', 'name', 'startSeconds', 'endSeconds', 'loop', 'source']) || !uuid(clip.id)
      || typeof clip.name !== 'string' || !clip.name.trim() || clip.name !== clip.name.trim() || [...clip.name].length > 128
      || /[\u0000-\u001f\u007f\ud800-\udfff]/u.test(clip.name)
      || !Number.isFinite(clip.startSeconds) || !Number.isFinite(clip.endSeconds)
      || clip.startSeconds < 0 || clip.startSeconds >= clip.endSeconds || clip.endSeconds > animation.durationSeconds
      || typeof clip.loop !== 'boolean') throw invalid();
    const declaration = sourceData(clip.source);
    if (declaration.objectId !== animation.objectId || declaration.sourcePath !== source.sourcePath
      || declaration.sourceRevision !== source.sourceRevision || !/^\/clips\/(?:[0-9]|[12][0-9]|3[01])$/.test(declaration.propertyPath)) throw invalid();
    identity(identities, `${input.sceneId}/${clip.id}`, clip);
    identity(identities, `${input.sceneId}${declaration.propertyPath}`, clip.id);
  }
  const duration = clip ? clip.endSeconds - clip.startSeconds : animation.durationSeconds;
  if ((clip ? clip.loop : animation.loop) || state.clipId !== (clip?.id ?? null) || state.positionSeconds !== duration
    || previous && (input.commandSequence < previous.commandSequence || input.visitIndex < previous.visitIndex
      || input.visitIndex === previous.visitIndex && (input.sceneId !== previous.sceneId
        || state.timeSeconds < previous.state.timeSeconds || input.commandSequence === previous.commandSequence))) throw invalid();
  identity(identities, input.sceneId, animation);
  const deliveries = input.deliveries.map((delivery, index) => {
    if (!exact(delivery, ['subscriptionId', 'origin', 'status'])
      || !integer(delivery.subscriptionId, 1, PROJECT_ANIMATION_COMPLETION_LIMITS.subscriptionId)
      || index > 0 && delivery.subscriptionId <= input.deliveries[index - 1].subscriptionId
      || !['pending', 'handled', 'skipped'].includes(delivery.status)) throw invalid();
    const origin = originCopy(delivery.origin);
    if (origin.sceneId !== input.sceneId || origin.visitIndex !== input.visitIndex) throw invalid();
    identity(tokens, delivery.subscriptionId, origin);
    return { subscriptionId: delivery.subscriptionId, origin, status: delivery.status };
  });
  return { ...input, deliveries };
}
export function validateProjectAnimationCompletionsSnapshot(input) {
  const snapshot = copySnapshot(input);
  if (!exact(snapshot, ['sequence', 'entries']) || !integer(snapshot.sequence, 0, PROJECT_ANIMATION_COMPLETION_LIMITS.completions)
    || !Array.isArray(snapshot.entries) || snapshot.entries.length !== snapshot.sequence) throw invalid();
  const identities = new Map(), tokens = new Map(), entries = [];
  let deliveries = 0, pending = 0, unhandled = false, pendingVisit = null;
  for (const candidate of snapshot.entries) {
    const entry = entryData(candidate, entries.at(-1), identities, tokens);
    if (pendingVisit !== null && entry.visitIndex !== pendingVisit) throw invalid();
    let pendingEntry = false;
    for (const delivery of entry.deliveries) {
      if (delivery.status === 'pending') { unhandled = true; pendingEntry = true; pendingVisit = entry.visitIndex; }
      else if (unhandled) throw invalid();
    }
    deliveries += entry.deliveries.length;
    if (pendingEntry) pending++;
    entries.push(entry);
  }
  if (deliveries > PROJECT_ANIMATION_COMPLETION_LIMITS.deliveries || pending > PROJECT_ANIMATION_COMPLETION_LIMITS.pending) throw invalid();
  return { sequence: snapshot.sequence, entries };
}
export function createProjectAnimationCompletions() {
  const entries = [], queue = [], identities = new Map(), tokens = new Map();
  let totalDeliveries = 0;
  return Object.freeze({
    get sequence() { return entries.length; },
    get pendingCount() { return queue.length; },
    append(input) {
      const data = copy(input), candidateIdentities = new Map(identities), candidateTokens = new Map(tokens);
      if (!exact(data, ['sequence', 'commandSequence', 'visitIndex', 'sceneId', 'state', 'animation', 'clip', 'recipients']) || !Array.isArray(data.recipients)) throw invalid();
      const { recipients, ...fields } = data;
      const entry = entryData({ ...fields, deliveries: recipients.map(recipient => {
        if (!exact(recipient, ['subscriptionId', 'origin'])) throw invalid();
        return { ...recipient, status: 'pending' };
      }) }, entries.at(-1), candidateIdentities, candidateTokens);
      if (totalDeliveries + recipients.length > PROJECT_ANIMATION_COMPLETION_LIMITS.deliveries
        || recipients.length && queue.length >= PROJECT_ANIMATION_COMPLETION_LIMITS.pending
        || queue.length && queue[0].entry.visitIndex !== entry.visitIndex) throw invalid();
      entries.push(entry); totalDeliveries += recipients.length;
      for (const [key, value] of candidateIdentities) identities.set(key, value);
      for (const [key, value] of candidateTokens) tokens.set(key, value);
      if (recipients.length) queue.push({ entry, index: 0 });
    },
    deliver(input, currentCommandSequence) {
      const data = copy(input), head = queue[0];
      if (!exact(data, ['sequence', 'subscriptionId', 'visitIndex', 'sceneId', 'status']) || !head
        || !integer(currentCommandSequence, 0, 256) || currentCommandSequence < head.entry.commandSequence
        || data.sequence !== head.entry.sequence || data.subscriptionId !== head.entry.deliveries[head.index].subscriptionId
        || data.visitIndex !== head.entry.visitIndex || data.sceneId !== head.entry.sceneId
        || !['handled', 'skipped'].includes(data.status)
        || data.status === 'handled' && currentCommandSequence !== head.entry.commandSequence) throw invalid();
      // A skipped notification can be stale while its subscription stays live.
      head.entry.deliveries[head.index++].status = data.status;
      if (head.index === head.entry.deliveries.length) queue.shift();
    },
    snapshot() { return copySnapshot({ sequence: entries.length, entries }); },
  });
}

// Query snapshots contain declarations and command history, not the author
// curves. Check their shared identities and completion boundaries; the wire
// reader additionally replays every transition against the frozen Rust model.
export function validateProjectAnimationCompletionTimeline(completions, commands) {
  for (const completion of completions.entries) {
    if (completion.commandSequence > commands.sequence) throw invalid();
    const preceding = commands.entries[completion.commandSequence - 1];
    const following = commands.entries[completion.commandSequence];
    if (preceding && preceding.origin.visitIndex > completion.visitIndex
      || following && (following.origin.visitIndex < completion.visitIndex
        || following.origin.visitIndex === completion.visitIndex && following.state.timeSeconds < completion.state.timeSeconds)) throw invalid();
    const anchor = preceding?.origin.visitIndex === completion.visitIndex ? preceding : null;
    if (anchor && (anchor.origin.sceneId !== completion.sceneId
      || canonicalJson(anchor.animation) !== canonicalJson(completion.animation) || canonicalJson(anchor.clip) !== canonicalJson(completion.clip))
      || !anchor && completion.clip !== null) throw invalid();
    const state = anchor?.state;
    const duration = completion.state.positionSeconds;
    const elapsed = completion.state.timeSeconds - (state?.timeSeconds ?? 0);
    const position = state?.positionSeconds ?? 0;
    if (state && state.phase !== 'playing' || elapsed < 0
      || elapsed < duration - position && position + elapsed < duration) throw invalid();
    for (const command of commands.entries) {
      if (command.origin.sceneId !== completion.sceneId) continue;
      if (canonicalJson(command.animation) !== canonicalJson(completion.animation)
        || command.clip && completion.clip && (command.clip.id === completion.clip.id
          || command.clip.source.propertyPath === completion.clip.source.propertyPath)
          && canonicalJson(command.clip) !== canonicalJson(completion.clip)) throw invalid();
    }
  }
  return completions;
}
