// Protocol 10 records the actual callback scope of an accepted entry. It does
// not identify a chosen transition or claim that queued playback has executed.
import { createProjectAnimationStateCatalog } from './project-animation-states.mjs';
import { canonicalJson } from './canonical-json.mjs';
import { createProjectAnimationStateEntries, validateProjectAnimationStateEntriesSnapshot } from './project-animation-state-entries.mjs';
import { projectRuntimeExact as exact, copyProjectRuntimeData as copy,
  copyProjectAnimationStateEntriesSnapshotData as detach, invalidProjectRuntime as invalid } from './project-runtime-contracts.mjs';

const integer = (value, max) => Number.isInteger(value) && value >= 1 && value <= max;
function triggerData(input) {
  if (['initial', 'direct'].includes(input?.kind) && exact(input, ['kind'])) return input;
  const field = input?.kind === 'event' ? 'eventSequence' : input?.kind === 'completed' ? 'completionSequence' : null;
  if (!field || !exact(input, ['kind', field, 'subscriptionId'])
    || !integer(input[field], field === 'eventSequence' ? 128 : 320) || !integer(input.subscriptionId, 1024)) throw invalid();
  return input;
}
const triggerKey = trigger => ['event', 'completed'].includes(trigger.kind)
  ? `${trigger.kind}/${trigger.eventSequence ?? trigger.completionSequence}/${trigger.subscriptionId}` : null;
const withoutTrigger = ({ trigger, ...entry }) => entry;

export function validateProjectAnimationStateTriggeredEntriesSnapshot(input) {
  const snapshot = detach(input);
  if (!exact(snapshot, ['sequence', 'entries']) || !Array.isArray(snapshot.entries)) throw invalid();
  const triggers = [], seen = new Set();
  for (const entry of snapshot.entries) {
    if (!exact(entry, ['sequence', 'origin', 'scriptSource', 'timeSeconds', 'commandSequence', 'stateKey', 'clipId', 'trigger'])) throw invalid();
    const trigger = triggerData(entry.trigger), key = triggerKey(trigger);
    if (key && seen.has(key)) throw invalid();
    if (key) seen.add(key);
    triggers.push(trigger);
  }
  const base = validateProjectAnimationStateEntriesSnapshot({ sequence: snapshot.sequence, entries: snapshot.entries.map(withoutTrigger) });
  return { sequence: base.sequence, entries: base.entries.map((entry, index) => ({ ...entry, trigger: triggers[index] })) };
}

// Inputs here are already admitted event/completion snapshots. A recipient's
// frozen origin includes its source, not just its display identity.
function evidence(entry, events, completions, pendingOnly = false) {
  const trigger = entry.trigger;
  if (trigger.kind === 'initial' || trigger.kind === 'direct') return null;
  const snapshot = trigger.kind === 'event' ? events : completions;
  const sequence = trigger.eventSequence ?? trigger.completionSequence;
  const record = snapshot?.entries[sequence - 1];
  const delivery = record?.deliveries.find(item => item.subscriptionId === trigger.subscriptionId);
  if (!record || record.sequence !== sequence || !delivery
    || canonicalJson(delivery.origin) !== canonicalJson(entry.origin)
    || !['pending', 'handled'].includes(delivery.status)) throw invalid();
  // Event 'skipped' permanently retires its subscription, including messages
  // already queued before withdrawal. Completion 'skipped' only marks stale
  // playback and does not retire a live completion subscription.
  if (trigger.kind === 'event' && events.entries.some(item => item.sequence < sequence
    && item.deliveries.some(item => item.subscriptionId === trigger.subscriptionId && item.status === 'skipped'))) throw invalid();
  if (pendingOnly || delivery.status === 'pending') {
    // The wire entry is emitted inside this synchronous callback, before the
    // delivery receipt. A later queued recipient cannot explain this entry,
    // including a retained snapshot whose callback has not been confirmed.
    const head = snapshot.entries.find(item => item.deliveries.some(item => item.status === 'pending'));
    const first = head?.deliveries.find(item => item.status === 'pending');
    if (head !== record || first !== delivery) throw invalid();
  }
  if (trigger.kind === 'completed' && (entry.timeSeconds !== record.state.timeSeconds
    || entry.commandSequence !== record.commandSequence)) throw invalid();
  return trigger.kind === 'event' ? { kind: 'event', event: record, delivery } : { kind: 'completed', completion: record, delivery };
}

export function createProjectAnimationStateTriggeredEntries(plan) {
  const base = createProjectAnimationStateEntries(plan), triggers = [], seen = new Set(), controllers = new Map();
  for (const scene of createProjectAnimationStateCatalog(plan).scenes) for (const controller of scene.controllers) {
    controllers.set(`${scene.sceneId}/${controller.bindingId}`, controller);
  }
  return Object.freeze({
    get sequence() { return base.sequence; },
    append(input, events, completions) {
      const value = copy(input);
      if (!exact(value, ['sequence', 'visitIndex', 'sceneId', 'timeSeconds', 'commandSequence', 'bindingId', 'instanceId', 'objectId', 'stateIndex', 'clipId', 'trigger'])) throw invalid();
      const trigger = triggerData(value.trigger), key = triggerKey(trigger);
      if (key && seen.has(key)) throw invalid();
      // The base append commits only after trigger evidence passes.
      // Build the prospective declared origin using the same immutable catalog
      // as the base reader; never trust a source supplied by the wire frame.
      const controller = controllers.get(`${value.sceneId}/${value.bindingId}`);
      if (!controller) throw invalid();
      evidence({ ...value, origin: { visitIndex: value.visitIndex, sceneId: value.sceneId,
        bindingId: controller.bindingId, instanceId: controller.instanceId, objectId: controller.objectId,
        source: controller.source } }, events, completions, true);
      base.append(withoutTrigger(value));
      triggers.push(trigger); if (key) seen.add(key);
    },
    validateDelivery(kind, sequence, subscriptionId, status) {
      if (status === 'skipped' && seen.has(`${kind}/${sequence}/${subscriptionId}`)) throw invalid();
    },
    validateTerminalSnapshot(input) { base.validateTerminalSnapshot(input); },
    snapshot() { const snapshot = base.snapshot(); return { ...snapshot, entries: snapshot.entries.map((entry, index) => ({ ...entry, trigger: copy(triggers[index]) })) }; },
  });
}

export function validateProjectAnimationStateEntryTriggersTimeline(snapshot, events, completions) {
  const order = new Map();
  for (const entry of snapshot.entries) {
    evidence(entry, events, completions);
    const trigger = entry.trigger;
    if (!triggerKey(trigger)) continue;
    const position = [trigger.eventSequence ?? trigger.completionSequence, trigger.subscriptionId], previous = order.get(trigger.kind);
    if (previous && (position[0] < previous[0] || position[0] === previous[0] && position[1] <= previous[1])) throw invalid();
    order.set(trigger.kind, position);
  }
  return snapshot;
}

export function projectAnimationStateEntryTriggerEvidence(entry, events, completions) {
  return entry.trigger ? evidence(entry, events, completions) : null;
}
