import { sampleSceneAnimation } from '../../engine/scene-animation-core.mjs';

// The clock schedules Rust samples. Rendering and source authority stay outside.
export function createSceneAnimationPlayer({ onSample, onState = () => {}, now = () => performance.now(),
  schedule = callback => requestAnimationFrame(callback), cancel = handle => cancelAnimationFrame(handle), sample = sampleSceneAnimation,
  isCurrent = () => true } = {}) {
  let model = null, position = 0, state = 'stopped', handle = null, origin = 0, disposed = false, generation = 0;
  const emit = () => onState({ state, positionSeconds: position });
  const clear = () => { generation++; if (handle !== null) cancel(handle); handle = null; };
  function render(seconds) {
    if (!model || disposed || !isCurrent()) return false;
    const value = sample(model, seconds);
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
    load(document) { if (disposed) return; clear(); model = document; position = 0; state = 'stopped'; render(0); emit(); },
    play() {
      if (disposed || !model || !isCurrent()) return false;
      clear(); if (position >= model.durationSeconds) position = 0;
      origin = now() - position * 1000; state = 'playing'; const ticket = generation; emit();
      if (ticket === generation && state === 'playing') handle = schedule(() => tick(ticket)); return true;
    },
    pause,
    seek(seconds) {
      if (disposed || !model || !Number.isFinite(seconds) || seconds < 0 || seconds > model.durationSeconds || !isCurrent()) return false;
      clear(); state = 'paused'; const value = render(seconds); emit(); return Boolean(value);
    },
    stop() { if (disposed) return; clear(); state = 'stopped'; position = 0; if (model && isCurrent()) render(0); emit(); },
    clear() { if (disposed) return; clear(); model = null; position = 0; state = 'stopped'; emit(); },
    dispose() { clear(); disposed = true; model = null; },
  });
}
