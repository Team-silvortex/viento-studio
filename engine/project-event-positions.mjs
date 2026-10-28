import { PROJECT_EVENT_LIMITS } from './project-event-bus.mjs';
import { copyProjectEventSnapshotData as copy } from './project-runtime-contracts.mjs';

const integer = value => Number.isSafeInteger(value) && value >= 0;
const invalid = () => new TypeError('Invalid project event positions reader.');

// Positions belong to admitted publication and delivery facts, never inferred
// callback entry, queue insertion, rollback, or abort outcomes. The event bus
// remains the sole authority for payload, origin, recipient and FIFO admission.
export function createProjectEventPositionsReader({ runtimeReader, onSnapshot, retainedEvents = 32 } = {}) {
  if (!runtimeReader || typeof runtimeReader.push !== 'function' || typeof runtimeReader.finish !== 'function'
    || runtimeReader.executionFrames?.format !== 'viento-project-execution-frames'
    || !Array.isArray(runtimeReader.executionFrames.frames) || !integer(runtimeReader.executionFrames.totalFrames)
    || !Array.isArray(runtimeReader.projectEvents?.entries) || !integer(runtimeReader.projectEvents.sequence)
    || !Array.isArray(runtimeReader.events) || !Array.isArray(runtimeReader.diagnostics) || !integer(runtimeReader.retention?.total)
    || !Number.isInteger(retainedEvents) || retainedEvents < 1 || retainedEvents > PROJECT_EVENT_LIMITS.messages
    || onSnapshot !== undefined && typeof onSnapshot !== 'function') throw invalid();
  const pending = new Map(), settled = [], diagnostics = [];
  const counts = { published: 0, settled: 0, pending: 0, deliveries: 0, handled: 0, skipped: 0, pendingDeliveries: 0 };
  let completed = false, ended = false, closing = false, failed = false;
  const phase = () => failed || diagnostics.length || runtimeReader.diagnostics.length
    || completed && pending.size || ended && !completed ? 'incomplete' : completed ? 'finished' : counts.published ? 'recording' : 'waiting';
  const snapshot = () => {
    const items = [...settled, ...pending.values()].sort((a, b) => a.sequence - b.sequence);
    return copy({ format: 'viento-project-event-positions', schemaVersion: 1, phase: phase(), counts,
      retention: { limit: retainedEvents, total: counts.published, retained: items.length, dropped: counts.published - items.length,
        pending: pending.size, settled: settled.length, firstSequence: items[0]?.sequence ?? null, lastSequence: items.at(-1)?.sequence ?? null }, items });
  };
  const publish = () => {
    try { onSnapshot?.(snapshot()); }
    catch (error) { failed = true; throw error; }
  };
  const issue = (message = 'An admitted event fact has no matching execution position or ledger entry.') => {
    if (diagnostics.length < 128) diagnostics.push({ severity: 'error', code: 'runtime_event_position_invalid', message });
  };
  const settle = item => {
    counts.settled++; settled.push(item); settled.sort((a, b) => a.sequence - b.sequence);
    // Zero-recipient publications can settle ahead of earlier queued messages.
    // Retain the latest publication identities, not callback completion order.
    if (settled.length > retainedEvents) settled.shift();
  };
  const observe = frame => {
    if (frame.event === 'finished') { completed = true; return true; }
    if (!['event-publish', 'event-delivery'].includes(frame.event)) return frame.event === 'scene-event' && frame.frame.event === 'diagnostic';
    const positions = runtimeReader.executionFrames, latest = positions.frames.at(-1);
    if (!latest || latest.index !== positions.totalFrames || latest.reference.event !== frame.event
      || latest.reference.protocol !== frame.protocol || latest.reference.sequence !== frame.sequence
      || latest.reference.visitIndex !== frame.visitIndex || latest.reference.sceneId !== frame.sceneId
      || frame.event === 'event-delivery' && latest.reference.subscriptionId !== frame.subscriptionId) { issue(); return true; }
    const ledger = runtimeReader.projectEvents, record = ledger.entries[frame.sequence - 1];
    if (!record || record.sequence !== frame.sequence) { issue(); return true; }
    const position = { clock: latest.clock, executionFrameIndex: latest.index };
    if (frame.event === 'event-publish') {
      if (frame.sequence !== counts.published + 1 || ledger.sequence !== frame.sequence
        || record.deliveries.some(row => row.status !== 'pending')) { issue(); return true; }
      const item = copy({ ...record, published: position });
      counts.published++; counts.deliveries += item.deliveries.length; counts.pendingDeliveries += item.deliveries.length;
      if (item.deliveries.length) { pending.set(item.sequence, item); counts.pending++; }
      else settle(item);
    } else {
      const item = pending.get(frame.sequence), index = item?.deliveries.findIndex(row => row.subscriptionId === frame.subscriptionId);
      const delivery = record.deliveries.find(row => row.subscriptionId === frame.subscriptionId);
      if (!item || index < 0 || item.deliveries[index].status !== 'pending' || !delivery
        || delivery.status !== frame.status || !['handled', 'skipped'].includes(delivery.status)) { issue(); return true; }
      item.deliveries[index] = copy({ ...delivery, delivered: position });
      counts[delivery.status]++; counts.pendingDeliveries--;
      if (item.deliveries.every(row => row.status !== 'pending')) { pending.delete(item.sequence); counts.pending--; settle(item); }
    }
    return true;
  };
  const recover = before => {
    if (runtimeReader.retention.total === before + 1) {
      try { observe(runtimeReader.events.at(-1)); }
      catch { issue('A downstream observer failed after admitting an event fact that could not be recovered.'); }
    }
  };
  const delegate = text => {
    const before = runtimeReader.retention.total;
    let admitted;
    try { admitted = runtimeReader.push(text); }
    catch (error) {
      recover(before); failed = closing = true;
      try { publish(); } catch { /* Preserve the original downstream failure. */ }
      throw error;
    }
    for (const frame of admitted) if (observe(frame)) publish();
    return admitted;
  };
  const api = {
    get events() { return runtimeReader.events; },
    get diagnostics() { return [...runtimeReader.diagnostics, ...copy(diagnostics)]; },
    get eventPositions() { return snapshot(); },
    push(text) {
      if (ended || closing || typeof text !== 'string') return [];
      const admitted = [];
      // No extra log buffer: the underlying framed reader owns all line limits.
      // One delegation can commit at most one business frame, including throws.
      for (let offset = 0; offset < text.length;) {
        const newline = text.indexOf('\n', offset), end = newline < 0 ? text.length : newline + 1;
        admitted.push(...delegate(text.slice(offset, end))); offset = end;
      }
      return admitted;
    },
    finish() {
      if (!ended) {
        closing = true;
        const before = runtimeReader.retention.total;
        try { runtimeReader.finish(); }
        catch (error) {
          recover(before); failed = true;
          try { publish(); } catch { /* Preserve downstream finish semantics. */ }
          throw error;
        }
        if (runtimeReader.retention.total === before + 1) observe(runtimeReader.events.at(-1));
        ended = true; publish();
      }
      return { events: api.events, diagnostics: api.diagnostics };
    },
  };
  if (typeof runtimeReader.snapshot === 'function') api.snapshot = () => runtimeReader.snapshot();
  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(runtimeReader))) {
    if (!Object.hasOwn(api, key) && descriptor.get) Object.defineProperty(api, key, { enumerable: descriptor.enumerable, get: () => runtimeReader[key] });
  }
  publish(); return Object.freeze(api);
}
