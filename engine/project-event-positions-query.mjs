import { PROJECT_EVENT_LIMITS, validateProjectEventSnapshot } from './project-event-bus.mjs';
import { PROJECT_RUNTIME_MAX_EVENTS, copyProjectEventSnapshotData as copy, projectRuntimeExact as exact, invalidProjectRuntime as invalid } from './project-runtime-contracts.mjs';
import { canonicalJson } from './canonical-json.mjs';
import { projectSharedStateScalar } from './project-shared-state.mjs';

const nonnegative = value => Number.isSafeInteger(value) && value >= 0;
const position = value => exact(value, ['clock', 'executionFrameIndex'])
  && exact(value.clock, ['idleFrame', 'physicsFrame']) && nonnegative(value.clock.idleFrame) && nonnegative(value.clock.physicsFrame)
  && Number.isInteger(value.executionFrameIndex) && value.executionFrameIndex >= 1 && value.executionFrameIndex <= PROJECT_RUNTIME_MAX_EVENTS;

// A bounded read-only projection of admitted facts; missing receipts are not
// proof that a callback did not run. No runtime or author data is modified.
export function validateProjectEventPositions(input) {
  const view = copy(input);
  if (!exact(view, ['format', 'schemaVersion', 'phase', 'counts', 'retention', 'items'])
    || view.format !== 'viento-project-event-positions' || view.schemaVersion !== 1
    || !['waiting', 'recording', 'finished', 'incomplete'].includes(view.phase)
    || !exact(view.counts, ['published', 'settled', 'pending', 'deliveries', 'handled', 'skipped', 'pendingDeliveries'])
    || !Object.values(view.counts).every(nonnegative)
    || !exact(view.retention, ['limit', 'total', 'retained', 'dropped', 'pending', 'settled', 'firstSequence', 'lastSequence'])
    || !Array.isArray(view.items)) throw invalid();
  const c = view.counts, r = view.retention;
  if (!Number.isInteger(r.limit) || r.limit < 1 || r.limit > PROJECT_EVENT_LIMITS.messages
    || c.published > PROJECT_EVENT_LIMITS.messages || c.deliveries > PROJECT_EVENT_LIMITS.deliveries
    || c.pending > PROJECT_EVENT_LIMITS.pending || c.published !== c.settled + c.pending
    || c.deliveries !== c.handled + c.skipped + c.pendingDeliveries
    || c.pendingDeliveries < c.pending || c.pendingDeliveries > c.pending * PROJECT_EVENT_LIMITS.recipients
    || r.total !== c.published || r.pending !== c.pending || r.settled !== Math.min(r.limit, c.settled)
    || r.retained !== view.items.length || r.retained !== r.pending + r.settled
    || r.dropped !== r.total - r.retained
    || r.firstSequence !== (view.items[0]?.sequence ?? null) || r.lastSequence !== (view.items.at(-1)?.sequence ?? null)
    || view.phase === 'waiting' && c.published !== 0 || view.phase === 'recording' && c.published === 0
    || view.phase === 'finished' && c.pending !== 0) throw invalid();
  const tokens = new Map(), positions = [], timeline = [], counts = { pending: 0, settled: 0, deliveries: 0, handled: 0, skipped: 0, pendingDeliveries: 0 };
  let previousSequence = 0, previousVisit = 0, pendingSeen = false, pendingVisit = null, lastDeliveryIndex = 0, firstSettled = null, retainedBytes = 0, pendingBytes = 0;
  for (const item of view.items) {
    if (!exact(item, ['sequence', 'name', 'value', 'origin', 'deliveries', 'published'])
      || !Number.isInteger(item.sequence) || item.sequence <= previousSequence || item.sequence > c.published
      || !Array.isArray(item.deliveries) || !position(item.published)) throw invalid();
    const rows = item.deliveries.map(row => {
      if (!exact(row, ['subscriptionId', 'origin', 'status', ...(row?.status === 'pending' ? [] : ['delivered'])])
        || row.status !== 'pending' && !position(row.delivered)) throw invalid();
      return { subscriptionId: row.subscriptionId, origin: row.origin, status: row.status };
    });
    // Reuse the authoritative bus validator for scalar, source, token, visit,
    // recipient ordering and per-message FIFO rules, even when earlier rows
    // have been evicted from this view.
    const entry = { sequence: 1, name: item.name, value: item.value, origin: item.origin, deliveries: rows };
    validateProjectEventSnapshot({ sequence: 1, entries: [entry] });
    if (item.origin.visitIndex < previousVisit || pendingVisit !== null && item.origin.visitIndex !== pendingVisit) throw invalid();
    previousVisit = item.origin.visitIndex; previousSequence = item.sequence;
    positions.push(item.published);
    timeline.push({ index: item.published.executionFrameIndex, kind: 'publish', tokens: item.deliveries.map(row => row.subscriptionId) });
    const bytes = item.name.length + projectSharedStateScalar(item.value).bytes; retainedBytes += bytes;
    let itemPending = false;
    for (const row of item.deliveries) {
      const identity = canonicalJson({ name: item.name, origin: row.origin }), known = tokens.get(row.subscriptionId);
      if (known !== undefined && known !== identity) throw invalid();
      tokens.set(row.subscriptionId, identity); counts.deliveries++;
      if (row.status === 'pending') { itemPending = pendingSeen = true; pendingVisit = item.origin.visitIndex; counts.pendingDeliveries++; }
      else {
        if (pendingSeen || row.delivered.executionFrameIndex <= item.published.executionFrameIndex
          || row.delivered.executionFrameIndex <= lastDeliveryIndex) throw invalid();
        lastDeliveryIndex = row.delivered.executionFrameIndex; counts[row.status]++; positions.push(row.delivered);
        timeline.push({ index: row.delivered.executionFrameIndex, kind: 'delivery', token: row.subscriptionId, status: row.status });
      }
    }
    if (itemPending) { counts.pending++; pendingBytes += bytes; }
    else { counts.settled++; firstSettled ??= item.sequence; }
  }
  if (retainedBytes > PROJECT_EVENT_LIMITS.totalBytes || pendingBytes > PROJECT_EVENT_LIMITS.pendingBytes
    || counts.pending !== c.pending || counts.settled !== r.settled || counts.pendingDeliveries !== c.pendingDeliveries
    || counts.deliveries > c.deliveries || counts.handled > c.handled || counts.skipped > c.skipped
    || c.deliveries - counts.deliveries > r.dropped * PROJECT_EVENT_LIMITS.recipients
    || firstSettled !== null && firstSettled - 1 - view.items.filter(item => item.sequence < firstSettled).length < r.dropped) throw invalid();
  // Every admitted position is a unique business frame; counters are monotonic
  // in frame order even when a callback publishes another message first.
  positions.sort((a, b) => a.executionFrameIndex - b.executionFrameIndex);
  for (let i = 1; i < positions.length; i++) {
    const before = positions[i - 1], after = positions[i];
    if (after.executionFrameIndex <= before.executionFrameIndex || after.clock.idleFrame < before.clock.idleFrame
      || after.clock.physicsFrame < before.clock.physicsFrame) throw invalid();
  }
  const retired = new Set();
  timeline.sort((a, b) => a.index - b.index);
  for (const fact of timeline) {
    if (fact.kind === 'publish' && fact.tokens.some(token => retired.has(token))
      || fact.kind === 'delivery' && fact.status === 'handled' && retired.has(fact.token)) throw invalid();
    if (fact.kind === 'delivery' && fact.status === 'skipped') retired.add(fact.token);
  }
  for (let i = 1; i < view.items.length; i++) {
    if (view.items[i].published.executionFrameIndex <= view.items[i - 1].published.executionFrameIndex) throw invalid();
  }
  return view;
}
