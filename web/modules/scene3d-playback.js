// Host-owned preview clock. No scene schema, renderer, source writer or engine clock.
export function createScene3DPlayback({ onSample, onChange = () => {}, requestFrame, cancelFrame }) {
  let seconds = 0, playing = false, disposed = false, ticket = null, epoch = 0, origin = null, start = 0;
  const snapshot = () => Object.freeze({ timeSeconds: seconds, playing });
  const publish = () => onChange(snapshot());
  function stop() {
    epoch++; playing = false; origin = null;
    if (ticket !== null) cancelFrame(ticket); ticket = null;
  }
  function sample(value) {
    try { if (onSample(value) !== true) return false; } catch { return false; }
    seconds = value; return true;
  }
  function schedule() {
    const owner = epoch;
    ticket = requestFrame(timestamp => {
      if (disposed || !playing || owner !== epoch) return;
      ticket = null;
      if (!Number.isFinite(timestamp) || origin !== null && timestamp < origin) { stop(); publish(); return; }
      if (origin === null) origin = timestamp;
      const next = Math.min(3600, start + (timestamp - origin) / 1000);
      if (!sample(next)) stop();
      else if (next === 3600) stop();
      publish(); if (playing && owner === epoch) schedule();
    });
  }
  return Object.freeze({
    snapshot,
    play() {
      if (disposed || playing || seconds >= 3600 || !sample(seconds)) return false;
      playing = true; start = seconds; origin = null; epoch++; publish(); schedule(); return true;
    },
    pause() { if (disposed) return; stop(); publish(); },
    seek(value) {
      if (disposed) return false;
      stop(); const valid = Number.isFinite(value) && value >= 0 && value <= 3600;
      const accepted = valid && sample(value); publish(); return accepted;
    },
    reset() { if (disposed) return; stop(); seconds = 0; publish(); },
    dispose() { if (disposed) return; stop(); disposed = true; },
  });
}
