import { PROJECT_RUNTIME_PREFIX, PROJECT_RUNTIME_MAX_LINE, PROJECT_RUNTIME_MAX_EVENTS,
  copyProjectRuntimeData as copy, projectRuntimeExact as exact } from './project-runtime-contracts.mjs';

export const PROJECT_EXECUTION_FRAME_PREFIX = 'VIENTO_EXECUTION_FRAME:';
const maxLine = PROJECT_RUNTIME_MAX_LINE + 512;
const integer = value => Number.isSafeInteger(value) && value >= 0;
const referenceKeys = ['protocol', 'event', 'assemblyId', 'entrySceneId', 'nextSceneId', 'visitIndex', 'sceneId',
  'bindingId', 'instanceId', 'objectId', 'sequence', 'commandSequence', 'completionSequence', 'entrySequence',
  'revision', 'subscriptionId', 'stream', 'targetCommandSequence'];
const reference = frame => {
  const result = {};
  for (const key of referenceKeys) if (Object.hasOwn(frame, key)) result[key] = frame[key];
  if (frame.event === 'scene-event') result.childEvent = frame.frame.event;
  return result;
};

// An exact engine-frame envelope adds position only after the original project
// reader admits its unchanged DTO. This layer owns no gameplay or clock reset.
export function createProjectExecutionFramesReader({ runtimeReader, onSnapshot, retainedFrames = 128 } = {}) {
  if (!runtimeReader || typeof runtimeReader.push !== 'function' || typeof runtimeReader.finish !== 'function') throw new TypeError('A project runtime reader is required.');
  if (!Number.isInteger(retainedFrames) || retainedFrames < 1 || retainedFrames > PROJECT_RUNTIME_MAX_EVENTS) throw new TypeError('Retained execution frames must be between 1 and 4096.');
  if (onSnapshot !== undefined && typeof onSnapshot !== 'function') throw new TypeError('An execution frame callback must be a function.');
  const frames = [], diagnostics = [];
  let phase = 'waiting', totalFrames = 0, terminal = false, ended = false, interrupted = false, closing = false, closeFailed = false;
  let pending = '', mode = 'detect', attempted = 0, limitReported = false;
  const snapshot = () => ({ format: 'viento-project-execution-frames', schemaVersion: 1, phase, totalFrames,
    frames: copy(frames), retention: { limit: retainedFrames, total: totalFrames, retained: frames.length,
      dropped: totalFrames - frames.length, firstIndex: frames[0]?.index ?? null, lastIndex: frames.at(-1)?.index ?? null } });
  const publish = () => onSnapshot?.(snapshot());
  const issue = (message = 'Invalid execution frame envelope.', code = 'runtime_execution_frame_invalid') => {
    if (diagnostics.length < 128) diagnostics.push({ severity: 'error', code, message });
  };
  const attempt = () => {
    if (attempted < PROJECT_RUNTIME_MAX_EVENTS) { attempted++; return true; }
    if (!limitReported) { limitReported = true; issue('Execution frame envelope count limit exceeded.', 'runtime_execution_frame_limit'); }
    return false;
  };
  const record = (envelope, frame) => {
    totalFrames++;
    frames.push({ index: envelope.index, clock: envelope.clock, reference: reference(frame) });
    if (frames.length > retainedFrames) frames.shift();
    terminal = frame.event === 'finished'; phase = terminal ? 'finished' : 'recording';
  };
  const delegate = (text, business = false) => {
    try { return runtimeReader.push(text); }
    catch (error) {
      // Only an enveloped business frame can leave a replayable project buffer.
      // Independent streams retain their existing final observer notification.
      if (business) interrupted = true; else { closing = true; closeFailed = true; }
      phase = 'incomplete'; throw error;
    }
  };
  const line = (value, accepted) => {
    let envelope, wire;
    try {
      if (value.length > maxLine) {
        issue('Execution frame envelope line limit exceeded.', 'runtime_execution_frame_limit'); return;
      }
      envelope = copy(JSON.parse(value.slice(PROJECT_EXECUTION_FRAME_PREFIX.length)));
      const previous = frames.at(-1)?.clock;
      if (terminal || !exact(envelope, ['protocol', 'index', 'clock', 'frame']) || envelope.protocol !== 1
        || !integer(envelope.index) || envelope.index !== totalFrames + 1
        || !exact(envelope.clock, ['idleFrame', 'physicsFrame']) || !integer(envelope.clock.idleFrame) || !integer(envelope.clock.physicsFrame)
        || previous && (envelope.clock.idleFrame < previous.idleFrame || envelope.clock.physicsFrame < previous.physicsFrame)) {
        issue(); return;
      }
      wire = PROJECT_RUNTIME_PREFIX + JSON.stringify(envelope.frame) + '\n';
      if (wire.length > PROJECT_RUNTIME_MAX_LINE) {
        issue('Wrapped project frame line limit exceeded.', 'runtime_execution_frame_limit'); return;
      }
    } catch { issue(); return; }
    const before = runtimeReader.retention?.total;
    let admitted;
    try { admitted = delegate(wire, true); }
    catch (error) {
      // Legacy onEvent runs after admission but can throw before its line buffer
      // is cleared. Recover that admitted fact, then quarantine this delegate:
      // finishing or retrying it could replay the same business frame.
      const after = runtimeReader.retention?.total, last = runtimeReader.events?.at(-1);
      if (integer(before) && after === before + 1 && last) record(envelope, last);
      phase = 'incomplete';
      try { publish(); } catch { /* Preserve the original collaborator failure. */ }
      throw error;
    }
    if (admitted.length === 1) {
      record(envelope, admitted[0]); accepted.push(admitted[0]); publish();
    }
    // Invalid business DTOs retain only their original reader diagnostics and
    // do not consume an envelope identity or move its accepted clock forward.
  };
  const consume = (piece, complete, accepted) => {
    if (mode === 'detect') {
      let offset = 0;
      while (offset < piece.length && mode === 'detect') {
        pending += piece[offset++];
        if (pending === PROJECT_EXECUTION_FRAME_PREFIX) mode = attempt() ? 'frame' : 'drop';
        else if (pending === PROJECT_RUNTIME_PREFIX) {
          if (attempt()) issue('A project frame is missing its execution envelope.');
          pending = ''; mode = 'drop';
        } else if (!PROJECT_EXECUTION_FRAME_PREFIX.startsWith(pending) && !PROJECT_RUNTIME_PREFIX.startsWith(pending)) {
          const passthrough = pending + piece.slice(offset); pending = ''; mode = complete ? 'detect' : 'pass';
          accepted.push(...delegate(passthrough)); return;
        }
      }
      piece = piece.slice(offset);
      if (mode === 'detect') {
        if (complete) { const trailing = pending; pending = ''; accepted.push(...delegate(trailing)); }
        return;
      }
    }
    if (mode === 'pass') {
      if (complete) mode = 'detect';
      accepted.push(...delegate(piece)); return;
    }
    if (mode === 'frame') {
      if (pending.length + piece.length > maxLine + 2) {
        issue('Execution frame envelope line limit exceeded.', 'runtime_execution_frame_limit'); pending = ''; mode = 'drop';
      } else pending += piece;
    }
    if (complete) {
      const observed = mode === 'frame' ? pending.replace(/\r?\n$/, '') : null;
      pending = ''; mode = 'detect';
      if (observed !== null) line(observed, accepted);
    }
  };
  const api = {
    get events() { return runtimeReader.events; },
    get diagnostics() { return [...runtimeReader.diagnostics, ...copy(diagnostics)]; },
    get executionFrames() { return snapshot(); },
    push(text) {
      if (ended || closing || interrupted || typeof text !== 'string') return [];
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
        closing = true;
        const trailing = pending, trailingMode = mode; pending = ''; mode = 'detect';
        if (!interrupted) {
          if (trailingMode === 'frame' && trailing) line(trailing, []);
          else if (trailingMode === 'detect' && trailing) delegate(trailing);
        }
        if (!interrupted) {
          // Business pushes always carry a newline and quarantine their own
          // failures above. Only independent stream finalization remains here;
          // its consumed clock tail may still need a later finish notification.
          try { runtimeReader.finish(); }
          catch (error) { closeFailed = true; phase = 'incomplete'; throw error; }
        }
        ended = true;
        if (interrupted || closeFailed || !terminal || diagnostics.length || runtimeReader.diagnostics.length) phase = 'incomplete';
        publish();
      }
      return { events: api.events, diagnostics: api.diagnostics };
    },
  };
  if (typeof runtimeReader.snapshot === 'function') api.snapshot = () => runtimeReader.snapshot();
  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(runtimeReader))) {
    if (!Object.hasOwn(api, key) && descriptor.get) Object.defineProperty(api, key, { enumerable: descriptor.enumerable, get: () => runtimeReader[key] });
  }
  publish();
  return Object.freeze(api);
}
