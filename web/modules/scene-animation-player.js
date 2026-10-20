import { sampleSceneAnimation, sampleSceneAnimationClip } from '../../engine/scene-animation-core.mjs';

// The clock schedules Rust samples. Rendering and source authority stay outside.
export function createSceneAnimationPlayer({ onSample, onState = () => {}, now = () => performance.now(),
  schedule = callback => requestAnimationFrame(callback), cancel = handle => cancelAnimationFrame(handle), sample = sampleSceneAnimation, sampleClip = sampleSceneAnimationClip,
  isCurrent = () => true } = {}) {
  let model = null, clipId = null, position = 0, state = 'stopped', handle = null, origin = 0, disposed = false, generation = 0;
  const duration = () => { const clip = model?.clips?.find(item => item.id === clipId); return clip ? clip.endSeconds - clip.startSeconds : model?.durationSeconds || 0; };
  const emit = () => onState({ state, positionSeconds: position });
  const clear = () => { generation++; if (handle !== null) cancel(handle); handle = null; };
  function render(seconds) {
    if (!model || disposed || !isCurrent()) return false;
    const value = model.schemaVersion === 3 ? sampleClip(model, clipId, seconds) : sample(model, seconds);
    position = value.localTimeSeconds; onSample(value); return value;
  }
  function tick(ticket) {
    if (ticket !== generation) return;
    handle = null;
    if (disposed || state !== 'playing') return;
    if (!isCurrent()) { pause(); return; }
    try {
      const value = render(Math.max(0, (now() - origin) / 1000));
      if (ticket !== generation) return;
      if (!value) { pause(); return; }
      if (value.finished) state = 'paused';
      emit(); if (ticket === generation && state === 'playing') handle = schedule(() => tick(ticket));
    } catch { if (ticket !== generation) return; state = 'error'; clear(); emit(); }
  }
  function pause() { if (disposed) return; clear(); if (state === 'playing') state = 'paused'; emit(); }
  return Object.freeze({
    load(document) { if (disposed) return; clear(); model = document; clipId = null; position = 0; state = 'stopped'; render(0); emit(); },
    selectClip(value) {
      if (disposed || !model || !isCurrent() || value !== null && (model.schemaVersion !== 3 || !model.clips.some(clip => clip.id === value))) return false;
      clear(); clipId = value; position = 0; state = 'paused';
      try { const result = render(0); emit(); return Boolean(result); }
      catch { state = 'error'; clear(); emit(); return false; }
    },
    play() {
      if (disposed || !model || !isCurrent()) return false;
      clear(); if (position >= duration()) position = 0;
      origin = now() - position * 1000; state = 'playing'; const ticket = generation; emit();
      if (ticket === generation && state === 'playing') handle = schedule(() => tick(ticket)); return true;
    },
    pause,
    seek(seconds) {
      if (disposed || !model || !Number.isFinite(seconds) || seconds < 0 || seconds > duration() || !isCurrent()) return false;
      clear(); state = 'paused'; const value = render(seconds); emit(); return Boolean(value);
    },
    stop() { if (disposed) return; clear(); state = 'stopped'; position = 0; if (model && isCurrent()) render(0); emit(); },
    clear() { if (disposed) return; clear(); model = null; clipId = null; position = 0; state = 'stopped'; emit(); },
    dispose() { clear(); disposed = true; model = null; },
  });
}
