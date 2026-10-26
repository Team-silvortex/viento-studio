import { canonicalJson } from './canonical-json.mjs';
import { createProjectExecutionBudget, PROJECT_EXECUTION_BUDGET_POLICY } from './project-execution-budget.mjs';
import { projectRuntimeExact as exact, copyProjectRuntimeData as copy, copyProjectEventSnapshotData as copySnapshot, invalidProjectRuntime as invalid } from './project-runtime-contracts.mjs';
import { projectSharedStateKey as keyValid, projectSharedStateScalar as scalar, copyProjectStateOrigin as originCopy } from './project-shared-state.mjs';

// Subscription storage and callbacks belong to the execution backend. This
// portable contract admits only frozen recipients and their ordered outcomes.
export const PROJECT_EVENT_LIMITS = Object.freeze({ messages: PROJECT_EXECUTION_BUDGET_POLICY.eventPublishes, recipients: 64,
  deliveries: PROJECT_EXECUTION_BUDGET_POLICY.eventDeliveries, subscriptionId: PROJECT_EXECUTION_BUDGET_POLICY.eventRegistrations,
  pending: 64, pendingBytes: 16384, totalBytes: PROJECT_EXECUTION_BUDGET_POLICY.eventBytes });
const tokenValid = id => Number.isInteger(id) && id >= 1 && id <= PROJECT_EVENT_LIMITS.subscriptionId;
const sequenceValid = id => Number.isInteger(id) && id >= 1 && id <= PROJECT_EVENT_LIMITS.messages;
const ownerKey = (name, origin) => canonicalJson({ name, origin });

function entryData(input, tokens) {
  if (!exact(input, ['sequence', 'name', 'value', 'origin', 'deliveries']) || !sequenceValid(input.sequence)
    || !keyValid(input.name) || !Array.isArray(input.deliveries) || input.deliveries.length > PROJECT_EVENT_LIMITS.recipients) throw invalid();
  const checked = scalar(input.value), origin = originCopy(input.origin);
  const entry = { sequence: input.sequence, name: input.name, value: checked.value, origin, deliveries: [] };
  for (const [index, item] of input.deliveries.entries()) {
    if (!exact(item, ['subscriptionId', 'origin', 'status']) || !tokenValid(item.subscriptionId)
      || index > 0 && item.subscriptionId <= input.deliveries[index - 1].subscriptionId
      || !['pending', 'handled', 'skipped'].includes(item.status)) throw invalid();
    const recipient = originCopy(item.origin);
    if (recipient.visitIndex !== origin.visitIndex || recipient.sceneId !== origin.sceneId) throw invalid();
    const identity = ownerKey(input.name, recipient), known = tokens.get(item.subscriptionId);
    if (known !== undefined && known !== identity) throw invalid();
    tokens.set(item.subscriptionId, identity);
    entry.deliveries.push({ subscriptionId: item.subscriptionId, origin: recipient, status: item.status });
  }
  return { entry, bytes: input.name.length + checked.bytes };
}

export function validateProjectEventSnapshot(input) {
  const snapshot = copySnapshot(input);
  if (!exact(snapshot, ['sequence', 'entries']) || !Number.isInteger(snapshot.sequence) || snapshot.sequence < 0
    || snapshot.sequence > PROJECT_EVENT_LIMITS.messages || !Array.isArray(snapshot.entries) || snapshot.entries.length !== snapshot.sequence) throw invalid();
  const tokens = new Map(), retired = new Set(), entries = [];
  let bytes = 0, deliveries = 0, pending = 0, pendingBytes = 0, unhandled = false, previousVisit = 0, pendingVisit = null;
  for (const [index, inputEntry] of snapshot.entries.entries()) {
    const checked = entryData(inputEntry, tokens), entry = checked.entry;
    if (entry.sequence !== index + 1 || entry.origin.visitIndex < previousVisit
      || pendingVisit !== null && entry.origin.visitIndex !== pendingVisit) throw invalid();
    previousVisit = entry.origin.visitIndex; bytes += checked.bytes; deliveries += entry.deliveries.length;
    let entryPending = false;
    for (const delivery of entry.deliveries) {
      if (delivery.status === 'pending') { unhandled = true; entryPending = true; pendingVisit = entry.origin.visitIndex; }
      else if (unhandled || delivery.status === 'handled' && retired.has(delivery.subscriptionId)) throw invalid();
      if (delivery.status === 'skipped') retired.add(delivery.subscriptionId);
    }
    if (entryPending) { pending++; pendingBytes += checked.bytes; }
    entries.push(entry);
  }
  if (bytes > PROJECT_EVENT_LIMITS.totalBytes || deliveries > PROJECT_EVENT_LIMITS.deliveries
    || pending > PROJECT_EVENT_LIMITS.pending || pendingBytes > PROJECT_EVENT_LIMITS.pendingBytes) throw invalid();
  return { sequence: snapshot.sequence, entries };
}

export function createProjectEventBus() {
  const entries = [], queue = [], tokens = new Map(), retired = new Set(), budget = createProjectExecutionBudget();
  let pendingBytes = 0;
  return Object.freeze({
    get sequence() { return entries.length; },
    get pendingCount() { return queue.length; },
    publish(input) {
      const data = copy(input);
      if (!exact(data, ['sequence', 'name', 'value', 'origin', 'recipients']) || !Array.isArray(data.recipients)) throw invalid();
      const candidateTokens = new Map(tokens);
      const checked = entryData({ sequence: data.sequence, name: data.name, value: data.value, origin: data.origin,
        deliveries: data.recipients.map(recipient => {
          if (!exact(recipient, ['subscriptionId', 'origin'])) throw invalid();
          return { ...recipient, status: 'pending' };
        }) }, candidateTokens);
      const { entry, bytes } = checked, hasRecipients = entry.deliveries.length > 0;
      if (entry.sequence !== entries.length + 1 || entry.deliveries.some(delivery => retired.has(delivery.subscriptionId))
        || entries.length && entry.origin.visitIndex < entries.at(-1).origin.visitIndex
        || queue.length && entry.origin.visitIndex !== queue[0].entry.origin.visitIndex
        || hasRecipients && (queue.length >= PROJECT_EVENT_LIMITS.pending || pendingBytes + bytes > PROJECT_EVENT_LIMITS.pendingBytes)) throw invalid();
      // Commit every reserved recipient and byte together; a rejected publish
      // cannot consume a sequence, token owner or future delivery allowance.
      if (!budget.reserve({ eventPublishes: 1, eventDeliveries: entry.deliveries.length, eventBytes: bytes })) throw invalid();
      entries.push(entry);
      for (const [id, owner] of candidateTokens) tokens.set(id, owner);
      if (hasRecipients) { queue.push({ entry, bytes, index: 0 }); pendingBytes += bytes; }
    },
    deliver(input) {
      const data = copy(input), head = queue[0];
      if (!exact(data, ['sequence', 'subscriptionId', 'status', 'visitIndex', 'sceneId']) || !head
        || data.sequence !== head.entry.sequence || data.subscriptionId !== head.entry.deliveries[head.index].subscriptionId
        || !['handled', 'skipped'].includes(data.status) || data.status === 'handled' && retired.has(data.subscriptionId) || data.visitIndex !== head.entry.origin.visitIndex || data.sceneId !== head.entry.origin.sceneId) throw invalid();
      // A skipped receipt proves this token was withdrawn. Earlier captured
      // recipients remain queued, but future publications cannot recapture it.
      if (data.status === 'skipped') retired.add(data.subscriptionId);
      head.entry.deliveries[head.index++].status = data.status;
      if (head.index === head.entry.deliveries.length) { pendingBytes -= head.bytes; queue.shift(); }
    },
    snapshot() { return copySnapshot({ sequence: entries.length, entries }); },
  });
}
