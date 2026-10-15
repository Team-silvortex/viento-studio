// The optional audio stream is admitted independently of actor/behavior frames.
// Runtime IDs resolve only through frozen, host-owned declarations.
import { validateSceneAudioPlan, stripSceneAudioPlan } from './scene-audio.mjs';
import { sampleSceneAudio } from './scene-audio-core.mjs';
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
export function createSceneAudioEventReader(input, { onEvent, createBaseReader } = {}) {
  const plan = structuredClone(input), audio = validateSceneAudioPlan(plan);
  if (typeof createBaseReader !== 'function') throw new TypeError('An actor runtime reader is required.');
  const events = [], diagnostics = [], expected = sampleSceneAudio(audio.document, 60).commands;
  const tracks = new Map(audio.document.tracks.map(track => [track.id, track]));
  let audioFinishTime = null;
  let sceneReady = false, sceneFinished = false, ready = false, finished = false, failed = false, next = 0, pending = '', dropping = false, ended = false;
  const issue = (message = 'Invalid audio runtime protocol frame.', details = {}) => {
    if (diagnostics.length < 128) diagnostics.push({ severity: 'error', code: 'runtime_audio_protocol_invalid', message,
      ...audio.manifest, propertyPath: '', ...details });
  };
  const publish = frame => { if (events.length < 4096) { events.push(frame); onEvent?.(frame); return frame; } issue('Runtime event budget exceeded.'); return null; };
  const base = createBaseReader(stripSceneAudioPlan(plan), { onEvent: frame => {
    if (frame.event === 'ready') sceneReady = true;
    if (frame.event === 'finished') {
      if (!finished && !failed) issue('Audio completion is missing.');
      // A scene finished frame belongs to the bounded, two-step smoke driver.
      // A shorter self-reported audio clock must not hide scheduled cues.
      if (finished && audioFinishTime !== 2 * frame.fixedDelta) issue('Audio completion time differs from the two scene steps.');
      sceneFinished = true;
    }
    publish(frame);
  } });
  const audioLine = text => {
    let frame; try { frame = JSON.parse(text.slice('VIENTO_AUDIO:'.length)); } catch { issue(); return null; }
    if (!frame || frame.protocol !== 1 || sceneFinished || finished || failed) { issue(); return null; }
    if (frame.event === 'ready') {
      if (!sceneReady || ready || !exact(frame, ['protocol', 'event', 'sceneObjectId', 'trackIds']) || frame.sceneObjectId !== audio.document.sceneObjectId
        || !Array.isArray(frame.trackIds) || JSON.stringify(frame.trackIds) !== JSON.stringify(audio.document.tracks.map(track => track.id))) { issue(); return null; }
      ready = true;
    } else if (frame.event === 'command') {
      const command = expected[next];
      if (!ready || !exact(frame, ['protocol', 'event', 'cueId', 'trackId', 'resourceId', 'action', 'atSeconds']) || !command
        || ['cueId', 'trackId', 'resourceId', 'action', 'atSeconds'].some(key => command[key] !== frame[key])) { issue(); return null; }
      next++;
    } else if (frame.event === 'finished') {
      if (!ready || !exact(frame, ['protocol', 'event', 'timeSeconds']) || !Number.isFinite(frame.timeSeconds) || frame.timeSeconds < 0
        || next !== expected.filter(command => command.atSeconds <= Math.min(frame.timeSeconds, 60)).length) { issue(); return null; }
      finished = true; audioFinishTime = frame.timeSeconds;
    } else if (frame.event === 'diagnostic') {
      const track = tracks.get(frame.trackId);
      if (!sceneReady || !exact(frame, ['protocol', 'event', 'severity', 'code', 'message', 'trackId', 'resourceId']) || frame.severity !== 'error'
        || frame.code !== 'runtime_audio_failed' || typeof frame.message !== 'string' || !frame.message || frame.message.length > 4096
        || !track || track.resourceId !== frame.resourceId) { issue(); return null; }
      const location = audio.locations.tracks.find(item => item.id === track.id).declaration;
      diagnostics.push({ severity: 'error', code: frame.code, message: frame.message, ...location, resourceId: track.resourceId }); failed = true;
    } else { issue(); return null; }
    return publish({ ...frame, protocol: plan.schemaVersion, event: 'audio', audioEvent: frame.event });
  };
  const line = text => {
    if (text.startsWith('VIENTO_AUDIO:')) audioLine(text);
    else { const before = base.diagnostics.length; base.push(text + '\n'); diagnostics.push(...base.diagnostics.slice(before)); }
  };
  return { events, diagnostics,
    push(text) {
      if (ended || typeof text !== 'string') return [];
      const start = events.length;
      for (const piece of text.split(/(?<=\n)/)) {
        const complete = piece.endsWith('\n');
        if (!dropping) {
          if (pending.length + piece.length > 65536) { if (/^VIENTO_(?:AUDIO|RUNTIME):/.test(pending + piece.slice(0, 20))) issue('Runtime frame budget exceeded.'); pending = ''; dropping = true; }
          else pending += piece;
        }
        if (complete) { if (!dropping) line(pending.replace(/\r?\n$/, '')); pending = ''; dropping = false; }
      }
      return events.slice(start);
    },
    finish() {
      if (!ended) {
        if (pending && !dropping) line(pending);
        const before = base.diagnostics.length; base.finish(); diagnostics.push(...base.diagnostics.slice(before));
        // Cancellation/process failures may end without finished; the process
        // owner decides that terminal status. Never invent a successful finish.
        pending = ''; ended = true;
      }
      return { events, diagnostics };
    },
  };
}
