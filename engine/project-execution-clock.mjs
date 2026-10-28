import { PROJECT_EXECUTION_BUDGET_POLICY } from './project-execution-budget.mjs';
import { copyProjectRuntimeData as copy, projectRuntimeExact as exact } from './project-runtime-contracts.mjs';

export const PROJECT_EXECUTION_CLOCK_PREFIX = 'VIENTO_EXECUTION_CLOCK:';
const maxLine = 16384, maxFrames = 8192, dimensions = Object.keys(PROJECT_EXECUTION_BUDGET_POLICY);
const empty = () => Object.fromEntries(dimensions.map(key => [key, 0]));
const integer = value => Number.isSafeInteger(value) && value >= 0;
const vector = value => exact(value, dimensions) && dimensions.every(key => integer(value[key]) && value[key] <= PROJECT_EXECUTION_BUDGET_POLICY[key]);
const encoder = new TextEncoder();

// Engine frame pairs identify observation windows, not causal transactions or
// replenishable admission budgets. Legacy readers continue to own all gameplay.
export function createProjectExecutionClockReader({ runtimeReader, onSnapshot, retainedWindows = 32 } = {}) {
  if (!runtimeReader || typeof runtimeReader.push !== 'function' || typeof runtimeReader.finish !== 'function') throw new TypeError('A project runtime reader is required.');
  if (!Number.isInteger(retainedWindows) || retainedWindows < 1 || retainedWindows > maxFrames) throw new TypeError('Retained execution windows must be between 1 and 8192.');
  if (onSnapshot !== undefined && typeof onSnapshot !== 'function') throw new TypeError('An execution observation callback must be a function.');
  const windows = [], diagnostics = [];
  let phase = 'waiting', total = empty(), base = empty(), totalWindows = 0, terminal = false, ended = false;
  let pending = '', mode = 'detect', attempted = 0, limitReported = false;
  const snapshot = () => ({ format: 'viento-execution-clock-observation', schemaVersion: 1, policyVersion: 1,
    limits: { ...PROJECT_EXECUTION_BUDGET_POLICY }, phase, total: { ...total }, totalWindows, windows: copy(windows),
    retention: { limit: retainedWindows, total: totalWindows, retained: windows.length, dropped: totalWindows - windows.length,
      firstIndex: windows[0]?.index ?? null, lastIndex: windows.at(-1)?.index ?? null } });
  const publish = () => onSnapshot?.(snapshot());
  const issue = (message = 'Invalid execution clock observation.', code = 'runtime_execution_clock_invalid') => {
    if (diagnostics.length < 128) diagnostics.push({ severity: 'error', code, message });
  };
  const attempt = () => {
    if (attempted < maxFrames) { attempted++; return true; }
    if (!limitReported) { limitReported = true; issue('Execution clock observation frame limit exceeded.', 'runtime_execution_clock_limit'); }
    return false;
  };
  const admit = frame => {
    if (terminal || !exact(frame, ['protocol', 'event', 'index', 'clock', 'used', 'total', 'reason'])
      || frame.protocol !== 1 || frame.event !== 'sample' || !integer(frame.index) || frame.index < 1
      || !exact(frame.clock, ['idleFrame', 'physicsFrame']) || !integer(frame.clock.idleFrame) || !integer(frame.clock.physicsFrame)
      || !vector(frame.used) || !vector(frame.total) || !['sample', 'rejected', 'finished', 'aborted'].includes(frame.reason)) return false;
    const previous = windows.at(-1), next = frame.index === totalWindows + 1;
    let candidateBase = base;
    if (!previous) {
      if (frame.index !== 1) return false;
    } else if (next) {
      if (frame.clock.idleFrame < previous.clock.idleFrame || frame.clock.physicsFrame < previous.clock.physicsFrame
        || frame.clock.idleFrame === previous.clock.idleFrame && frame.clock.physicsFrame === previous.clock.physicsFrame) return false;
      candidateBase = total;
    } else if (frame.index !== totalWindows || frame.clock.idleFrame !== previous.clock.idleFrame || frame.clock.physicsFrame !== previous.clock.physicsFrame
      || dimensions.some(key => frame.used[key] < previous.used[key])) return false;
    if (dimensions.some(key => frame.total[key] !== candidateBase[key] + frame.used[key] || frame.total[key] < total[key])) return false;
    if (!next && frame.reason === 'sample' && dimensions.every(key => frame.used[key] === previous.used[key])) return false;
    const row = { index: frame.index, clock: frame.clock, used: frame.used, total: frame.total, reason: frame.reason };
    base = { ...candidateBase }; total = { ...frame.total };
    if (next) { totalWindows++; windows.push(row); if (windows.length > retainedWindows) windows.shift(); }
    else windows[windows.length - 1] = row;
    terminal = frame.reason === 'finished' || frame.reason === 'aborted';
    phase = frame.reason === 'finished' ? 'finished' : frame.reason === 'aborted' ? 'incomplete' : 'recording';
    return true;
  };
  const line = value => {
    if (!attempt()) return;
    let accepted = false;
    try {
      if (encoder.encode(value).length > maxLine) throw new TypeError('Oversized observation.');
      accepted = admit(copy(JSON.parse(value.slice(PROJECT_EXECUTION_CLOCK_PREFIX.length))));
    } catch { /* A malformed observation cannot change the admitted state. */ }
    if (accepted) publish(); else issue();
  };
  // Detect only the short prefix before delegating other bytes immediately.
  // A huge non-clock line is governed entirely by its original reader, while
  // a huge clock line is discarded without keeping an unbounded partial line.
  const consume = (piece, complete, accepted) => {
    if (mode === 'detect') {
      const count = Math.min(PROJECT_EXECUTION_CLOCK_PREFIX.length - pending.length, piece.length);
      pending += piece.slice(0, count); piece = piece.slice(count);
      if (!PROJECT_EXECUTION_CLOCK_PREFIX.startsWith(pending)) {
        accepted.push(...runtimeReader.push(pending + piece)); pending = ''; mode = 'pass';
        if (complete) mode = 'detect';
        return;
      }
      if (pending === PROJECT_EXECUTION_CLOCK_PREFIX) mode = 'clock';
      else if (complete) {
        accepted.push(...runtimeReader.push(pending + piece)); pending = ''; mode = 'detect'; return;
      } else return;
    }
    if (mode === 'pass') accepted.push(...runtimeReader.push(piece));
    else if (mode === 'clock') {
      if (pending.length + piece.length > maxLine + 2) {
        if (attempt()) issue('Execution clock observation line limit exceeded.');
        pending = ''; mode = 'drop';
      } else pending += piece;
    }
    if (complete) {
      const observed = mode === 'clock' ? pending.replace(/\r?\n$/, '') : null;
      // Consume the line before invoking observers, including when a consumer
      // aborts by throwing. A later finish must not admit this frame twice.
      pending = ''; mode = 'detect';
      if (observed !== null) line(observed);
    }
  };
  const api = {
    get events() { return runtimeReader.events; },
    get diagnostics() { return [...runtimeReader.diagnostics, ...copy(diagnostics)]; },
    get executionClock() { return snapshot(); },
    push(text) {
      if (ended || typeof text !== 'string') return [];
      const accepted = [];
      let offset = 0;
      while (offset < text.length) {
        const newline = text.indexOf('\n', offset), end = newline < 0 ? text.length : newline + 1;
        consume(text.slice(offset, end), newline >= 0, accepted); offset = end;
      }
      return accepted;
    },
    finish() {
      if (!ended) {
        const trailing = pending, trailingMode = mode;
        pending = ''; mode = 'detect';
        if (trailingMode === 'clock' && trailing) line(trailing);
        else if (trailingMode === 'detect' && trailing) runtimeReader.push(trailing);
        ended = true; runtimeReader.finish();
        if (!terminal || diagnostics.length || runtimeReader.diagnostics.length) phase = 'incomplete';
        publish();
      }
      return { events: api.events, diagnostics: api.diagnostics };
    },
  };
  // Physics composition exposes snapshot() rather than a physics getter.
  if (typeof runtimeReader.snapshot === 'function') api.snapshot = () => runtimeReader.snapshot();
  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(runtimeReader))) {
    if (!Object.hasOwn(api, key) && descriptor.get) Object.defineProperty(api, key, { enumerable: descriptor.enumerable, get: () => runtimeReader[key] });
  }
  publish();
  return Object.freeze(api);
}
