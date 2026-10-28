import { canonicalJson } from './canonical-json.mjs';
import { copyProjectRuntimeData as copy, projectRuntimeExact as exact } from './project-runtime-contracts.mjs';

const maxLine = 16384, encoder = new TextEncoder();
const integer = value => Number.isSafeInteger(value) && value >= 0;
const same = (a, b) => canonicalJson(a) === canonicalJson(b);
const validClock = value => exact(value, ['idleFrame', 'physicsFrame']) && integer(value.idleFrame) && integer(value.physicsFrame);
const forward = (next, previous) => !previous || next.idleFrame >= previous.idleFrame && next.physicsFrame >= previous.physicsFrame;

// Keep constructor option failures ahead of domain-plan parsing, including in
// existing public adapters whose error ordering is part of compatibility.
export function assertProjectQueuedRequestsReaderOptions({ runtimeReader, onSnapshot, retainedRequests = 128 }, { name, limit }) {
  if (!runtimeReader || typeof runtimeReader.push !== 'function' || typeof runtimeReader.finish !== 'function'
    || runtimeReader.executionFrames?.format !== 'viento-project-execution-frames'
    || !Number.isInteger(retainedRequests) || retainedRequests < 1 || retainedRequests > limit
    || onSnapshot !== undefined && typeof onSnapshot !== 'function') throw new TypeError(`Invalid project ${name} request reader.`);
}

// Domain adapters own frozen declarations and payload/receipt matching. This
// mechanism observes queue facts only: it never executes, reschedules, refunds,
// or assumes an accepted request completed without its explicit outcome.
export function createProjectQueuedRequestsReader({ runtimeReader, onSnapshot, retainedRequests = 128 }, domain) {
  const { name, prefix, limit } = domain, getter = `${name}Requests`, maxAttempts = limit * 2;
  const label = name[0].toUpperCase() + name.slice(1);
  assertProjectQueuedRequestsReaderOptions({ runtimeReader, onSnapshot, retainedRequests }, domain);
  const pending = [], settled = [], diagnostics = [], counts = { accepted: 0, applied: 0, discarded: 0, pending: 0 };
  let phase = 'waiting', current = null, lastBusiness = null, lastClock = null, receipt = null, runtimeError = false;
  let completed = false, ended = false, closing = false, failed = false, buffer = '', mode = 'detect', attempted = 0, limitReported = false;
  const refreshPhase = () => { phase = failed || runtimeError || diagnostics.length || runtimeReader.diagnostics.length
    || completed && pending.length || ended && !completed ? 'incomplete' : completed ? 'finished' : counts.accepted ? 'recording' : 'waiting'; };
  const snapshot = () => {
    const requests = [...settled, ...pending].sort((a, b) => a.requestId - b.requestId);
    return copy({ format: `viento-project-${name}-requests`, schemaVersion: 1, phase, counts,
      requests, retention: { limit: retainedRequests, total: counts.accepted, retained: requests.length,
        dropped: counts.accepted - requests.length, pending: pending.length, terminal: settled.length,
        firstRequestId: requests[0]?.requestId ?? null, lastRequestId: requests.at(-1)?.requestId ?? null } });
  };
  const publish = () => onSnapshot?.(snapshot());
  const issue = (message = `Invalid ${name} request observation.`, code = `runtime_${name}_request_invalid`) => {
    if (diagnostics.length < 128) diagnostics.push({ severity: 'error', code, message });
    refreshPhase();
  };
  const attempt = () => {
    if (attempted < maxAttempts) { attempted++; return true; }
    if (!limitReported) { limitReported = true; issue(`${label} request observation count limit exceeded.`, `runtime_${name}_request_limit`); }
    return false;
  };
  const matchCommand = domain.matchesReceipt;
  const observe = frame => {
    const positions = runtimeReader.executionFrames, position = positions.frames.at(-1);
    if (!position || position.index !== positions.totalFrames) {
      issue('An admitted business frame has no exact execution position.'); return;
    }
    lastBusiness = { frame, position };
    if (!forward(position.clock, lastClock)) issue('Business execution precedes an accepted request observation.');
    if (frame.event === 'scene-enter') current = { visitIndex: frame.visitIndex, sceneId: frame.sceneId, ready: false };
    else if (frame.event === 'scene-event' && frame.stream === 'runtime' && frame.frame.event === 'ready') current.ready = true;
    else if (frame.event === 'scene-event' && frame.frame.event === 'diagnostic' && frame.frame.severity === 'error') runtimeError = true;
    else if (frame.event === `${name}-command`) {
      if (receipt || !matchCommand(pending[0], frame)) issue(`An ${name} receipt has no matching pending request.`);
      else receipt = { requestId: pending[0].requestId, commandSequence: frame.commandSequence,
        executionFrameIndex: position.index, clock: position.clock };
    } else if (frame.event === 'scene-exit') {
      if (pending.length) issue(`A scene exited with unresolved ${name} requests.`);
      current = null;
    } else if (frame.event === 'finished') completed = true;
    refreshPhase();
  };
  // At most one legacy frame reaches each delegation, including when a callback
  // throws after admission and the underlying raw tail retains only one frame.
  const delegate = text => {
    const before = runtimeReader.retention.total;
    let admitted;
    try { admitted = runtimeReader.push(text); }
    catch (error) {
      if (runtimeReader.retention.total === before + 1) observe(runtimeReader.events.at(-1));
      failed = closing = true; refreshPhase();
      try { publish(); } catch { /* Keep the downstream observer failure. */ }
      throw error;
    }
    for (const frame of admitted) observe(frame);
    return admitted;
  };
  const accept = frame => {
    if (!exact(frame, ['protocol', 'event', 'requestId', 'clock', ...domain.acceptedKeys])
      || frame.requestId !== counts.accepted + 1 || counts.accepted >= limit || pending.length >= domain.pendingLimit
      || !current?.ready || runtimeError || completed) return false;
    const data = domain.acceptedData(frame, current);
    if (!data) return false;
    pending.push({ requestId: frame.requestId, status: 'pending', acceptedClock: frame.clock, ...data });
    counts.accepted++; counts.pending++; return true;
  };
  const settle = frame => {
    const row = pending[0];
    if (!row || row.requestId !== frame.requestId) return false;
    if (frame.event === 'applied') {
      const positions = runtimeReader.executionFrames, latest = positions.frames.at(-1);
      if (!exact(frame, ['protocol', 'event', 'requestId', 'clock', 'commandSequence', 'executionFrameIndex'])
        || !receipt || receipt.requestId !== row.requestId || receipt.commandSequence !== frame.commandSequence
        || receipt.executionFrameIndex !== frame.executionFrameIndex || lastBusiness?.position.index !== frame.executionFrameIndex
        || positions.totalFrames !== frame.executionFrameIndex || latest?.index !== frame.executionFrameIndex || !same(latest.clock, frame.clock)
        || !same(receipt.clock, frame.clock) || lastBusiness.frame.event !== `${name}-command`
        || !matchCommand(row, lastBusiness.frame)) return false;
      row.status = 'applied'; row.applied = { clock: frame.clock, commandSequence: frame.commandSequence, executionFrameIndex: frame.executionFrameIndex };
      counts.applied++; receipt = null;
    } else {
      if (!exact(frame, ['protocol', 'event', 'requestId', 'clock', 'reason']) || frame.reason !== 'abort' || !runtimeError || receipt) return false;
      row.status = 'discarded'; row.discarded = { clock: frame.clock, reason: frame.reason }; counts.discarded++;
    }
    pending.shift(); counts.pending--; settled.push(row);
    if (settled.length > retainedRequests) settled.shift();
    return true;
  };
  const line = text => {
    let frame, accepted = false;
    try {
      if (encoder.encode(text).length > maxLine) { issue(`${label} request observation line limit exceeded.`, `runtime_${name}_request_limit`); return; }
      frame = copy(JSON.parse(text.slice(prefix.length)));
      if (frame?.protocol === 1 && ['accepted', 'applied', 'discarded'].includes(frame.event) && integer(frame.requestId) && frame.requestId > 0
        && validClock(frame.clock) && forward(frame.clock, lastClock) && forward(frame.clock, lastBusiness?.position.clock)) {
        accepted = frame.event === 'accepted' ? accept(frame) : settle(frame);
      }
    } catch { /* Malformed observations cannot alter the accepted queue. */ }
    if (!accepted) { issue(); return; }
    lastClock = frame.clock; refreshPhase(); publish();
  };
  const consume = (piece, complete, accepted) => {
    if (mode === 'detect') {
      let offset = 0;
      while (offset < piece.length && mode === 'detect') {
        buffer += piece[offset++];
        if (buffer === prefix) mode = attempt() ? 'request' : 'drop';
        else if (!prefix.startsWith(buffer)) {
          const text = buffer + piece.slice(offset); buffer = ''; mode = complete ? 'detect' : 'pass';
          accepted.push(...delegate(text)); return;
        }
      }
      piece = piece.slice(offset);
      if (mode === 'detect') {
        if (complete) { const trailing = buffer; buffer = ''; accepted.push(...delegate(trailing)); }
        return;
      }
    }
    if (mode === 'pass') { if (complete) mode = 'detect'; accepted.push(...delegate(piece)); return; }
    if (mode === 'request') {
      if (buffer.length + piece.length > maxLine + 2) {
        issue(`${label} request observation line limit exceeded.`, `runtime_${name}_request_limit`); buffer = ''; mode = 'drop';
      } else buffer += piece;
    }
    if (complete) {
      const text = mode === 'request' ? buffer.replace(/\r?\n$/, '') : null;
      buffer = ''; mode = 'detect'; if (text !== null) line(text);
    }
  };
  const api = {
    get events() { return runtimeReader.events; },
    get diagnostics() { return [...runtimeReader.diagnostics, ...copy(diagnostics)]; },
    get [getter]() { return snapshot(); },
    push(text) {
      if (ended || closing || typeof text !== 'string') return [];
      const accepted = [];
      for (let offset = 0; offset < text.length;) {
        const newline = text.indexOf('\n', offset), end = newline < 0 ? text.length : newline + 1;
        consume(text.slice(offset, end), newline >= 0, accepted); offset = end;
      }
      return accepted;
    },
    finish() {
      if (!ended) {
        closing = true;
        const trailing = buffer, trailingMode = mode; buffer = ''; mode = 'detect';
        if (trailingMode === 'request' && trailing) line(trailing);
        else if (trailingMode === 'detect' && trailing) delegate(trailing);
        const before = runtimeReader.retention.total;
        try { runtimeReader.finish(); }
        catch (error) {
          if (runtimeReader.retention.total === before + 1) observe(runtimeReader.events.at(-1));
          failed = true; refreshPhase(); throw error;
        }
        if (runtimeReader.retention.total === before + 1) observe(runtimeReader.events.at(-1));
        ended = true; refreshPhase(); publish();
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
