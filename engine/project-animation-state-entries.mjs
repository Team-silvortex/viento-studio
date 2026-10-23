// Accepted script entries are separate from executed animation receipts. Each
// successful call is retained, including re-entering the same state and clip.
import { canonicalJson } from './canonical-json.mjs';
import { createProjectAnimationStateCatalog } from './project-animation-states.mjs';
import { copyProjectStateOrigin as originCopy } from './project-shared-state.mjs';
import { projectRuntimeExact as exact, projectRuntimeUuid as uuid, projectRuntimeTime as time,
  copyProjectRuntimeData as copy, copyProjectAnimationStateEntriesSnapshotData as detach,
  invalidProjectRuntime as invalid } from './project-runtime-contracts.mjs';

export const PROJECT_ANIMATION_STATE_ENTRY_LIMITS = Object.freeze({ entries: 128 });
const integer = (value, minimum, maximum) => Number.isInteger(value) && value >= minimum && value <= maximum;
const stateKey = value => typeof value === 'string' && /^[a-z][a-z0-9_]{0,31}$/.test(value);
const identity = entry => canonicalJson({ ...entry.origin, visitIndex: 0, scriptSource: entry.scriptSource });
const controllerKey = origin => `${origin.sceneId}/${origin.bindingId}`;
const visitKey = origin => `${origin.visitIndex}/${controllerKey(origin)}`;

function entryData(input, previous, identities) {
  if (!exact(input, ['sequence', 'origin', 'scriptSource', 'timeSeconds', 'commandSequence', 'stateKey', 'clipId'])
    || !integer(input.sequence, 1, 128) || input.sequence !== (previous?.sequence || 0) + 1
    || !time(input.timeSeconds) || !integer(input.commandSequence, 0, 256)
    || !stateKey(input.stateKey) || input.clipId !== null && !uuid(input.clipId)) throw invalid();
  const origin = originCopy(input.origin), scriptSource = originCopy({ ...origin, source: input.scriptSource }).source;
  if (scriptSource.propertyPath !== '' || Object.hasOwn(scriptSource, 'sourceRange')
    || previous && (origin.visitIndex < previous.origin.visitIndex || input.commandSequence < previous.commandSequence
      || origin.visitIndex === previous.origin.visitIndex && (origin.sceneId !== previous.origin.sceneId || input.timeSeconds < previous.timeSeconds))) throw invalid();
  const result = { ...input, origin, scriptSource }, key = controllerKey(origin), sourceIdentity = identity(result);
  if (identities.has(key) && identities.get(key) !== sourceIdentity) throw invalid();
  identities.set(key, sourceIdentity);
  return result;
}

export function validateProjectAnimationStateEntriesSnapshot(input) {
  const snapshot = detach(input);
  if (!exact(snapshot, ['sequence', 'entries']) || !integer(snapshot.sequence, 0, 128)
    || !Array.isArray(snapshot.entries) || snapshot.entries.length !== snapshot.sequence) throw invalid();
  const entries = [], identities = new Map();
  for (const entry of snapshot.entries) entries.push(entryData(entry, entries.at(-1), identities));
  return { sequence: snapshot.sequence, entries };
}

export function createProjectAnimationStateEntries(input) {
  const catalog = createProjectAnimationStateCatalog(input), controllers = new Map();
  for (const scene of catalog.scenes) for (const controller of scene.controllers) controllers.set(`${scene.sceneId}/${controller.bindingId}`, controller);
  const entries = [], identities = new Map(), latest = new Map();
  return Object.freeze({
    get sequence() { return entries.length; },
    append(inputEntry) {
      const input = copy(inputEntry);
      if (!exact(input, ['sequence', 'visitIndex', 'sceneId', 'timeSeconds', 'commandSequence', 'bindingId', 'instanceId', 'objectId', 'stateIndex', 'clipId'])) throw invalid();
      const declared = controllers.get(`${input.sceneId}/${input.bindingId}`);
      if (!declared || input.instanceId !== declared.instanceId || input.objectId !== declared.objectId
        || !integer(input.stateIndex, 0, declared.states.length - 1) || input.clipId !== declared.clips[input.stateIndex]) throw invalid();
      const candidate = new Map(identities), entry = entryData({ sequence: input.sequence,
        origin: { visitIndex: input.visitIndex, sceneId: input.sceneId, bindingId: declared.bindingId,
          instanceId: declared.instanceId, objectId: declared.objectId, source: declared.source },
        scriptSource: declared.scriptSource, timeSeconds: input.timeSeconds, commandSequence: input.commandSequence,
        stateKey: declared.states[input.stateIndex], clipId: input.clipId }, entries.at(-1), candidate);
      entries.push(entry); latest.set(visitKey(entry.origin), entry);
      for (const [key, value] of candidate) identities.set(key, value);
    },
    validateTerminalSnapshot(input) {
      for (const controller of input.controllers) {
        const declared = controllers.get(`${input.sceneId}/${controller.bindingId}`);
        const entry = latest.get(`${input.visitIndex}/${input.sceneId}/${controller.bindingId}`);
        if (entry && (entry.timeSeconds > input.timeSeconds || entry.commandSequence > input.commandSequence)
          || controller.status === 'active' && (!declared || !entry
            || entry.stateKey !== declared.states[controller.stateIndex] || entry.clipId !== controller.clipId)) throw invalid();
      }
    },
    snapshot() { return detach({ sequence: entries.length, entries }); },
  });
}

export function validateProjectAnimationStateEntriesTimeline(snapshot, commands, visits, states) {
  const latest = new Map(), boundaries = new Map(states.entries.map(entry => [entry.visitIndex, entry]));
  const sources = new Map(), bindingSources = new Map();
  for (const boundary of states.entries) for (const controller of boundary.controllers) sources.set(controllerKey(controller.origin), identity(controller));
  for (const command of commands.entries) {
    const key = controllerKey(command.origin), sourceIdentity = canonicalJson({ ...command.origin, visitIndex: 0 });
    if (bindingSources.has(key) && bindingSources.get(key) !== sourceIdentity) throw invalid();
    bindingSources.set(key, sourceIdentity);
  }
  for (const entry of snapshot.entries) {
    const visit = visits[entry.origin.visitIndex - 1], preceding = commands.entries[entry.commandSequence - 1], following = commands.entries[entry.commandSequence];
    if (!visit || visit.sceneId !== entry.origin.sceneId || visit.phase === 'waiting' || entry.commandSequence > commands.sequence
      || ['left', 'finished'].includes(visit.phase) && entry.timeSeconds > visit.elapsedSeconds
      || preceding && (preceding.origin.visitIndex > entry.origin.visitIndex || preceding.origin.visitIndex === entry.origin.visitIndex && preceding.state.timeSeconds > entry.timeSeconds)
      || following && (following.origin.visitIndex < entry.origin.visitIndex || following.origin.visitIndex === entry.origin.visitIndex && following.state.timeSeconds < entry.timeSeconds)) throw invalid();
    const key = controllerKey(entry.origin);
    if (sources.has(key) && sources.get(key) !== identity(entry)
      || bindingSources.has(key) && bindingSources.get(key) !== canonicalJson({ ...entry.origin, visitIndex: 0 })) throw invalid();
    const boundary = boundaries.get(entry.origin.visitIndex);
    if (boundary) {
      const controller = boundary.controllers.find(controller => controller.origin.bindingId === entry.origin.bindingId);
      if (!controller || identity(controller) !== identity(entry) || entry.timeSeconds > boundary.timeSeconds || entry.commandSequence > boundary.commandSequence) throw invalid();
    }
    latest.set(visitKey(entry.origin), entry);
  }
  for (const boundary of states.entries) for (const controller of boundary.controllers) {
    if (controller.status !== 'active') continue;
    const entry = latest.get(visitKey(controller.origin));
    if (!entry || entry.stateKey !== controller.stateKey || entry.clipId !== controller.clipId) throw invalid();
  }
  return snapshot;
}
