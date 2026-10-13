import test from 'node:test';
import assert from 'node:assert/strict';
import { createScene3DPlayback } from '../../web/modules/scene3d-playback.js';
function fixture(onSample = () => true) {
  const frames = new Map(), history = [], samples = []; let seq = 0;
  const clock = createScene3DPlayback({ onSample: n => { samples.push(n); return onSample(n); }, onChange: state => history.push(state),
    requestFrame: fn => { frames.set(++seq, fn); return seq; }, cancelFrame: id => frames.delete(id) });
  const frame = timestamp => { const [id, fn] = frames.entries().next().value; frames.delete(id); fn(timestamp); };
  return { clock, frames, history, samples, frame };
}
test('explicit time is deterministic, pause has no late work, and resume does not count the pause', () => {
  const h = fixture(); assert.equal(h.frames.size, 0); assert.equal(h.clock.seek(1.5), true);
  h.clock.play(); h.frame(100); h.frame(600); assert.equal(h.clock.snapshot().timeSeconds, 2);
  const late = [...h.frames.values()][0]; h.clock.pause(); const length = h.samples.length; late(90000);
  assert.equal(h.samples.length, length); assert.equal(h.frames.size, 0);
  h.clock.play(); h.frame(100000); assert.equal(h.clock.snapshot().timeSeconds, 2);
  h.frame(100250); assert.equal(h.clock.snapshot().timeSeconds, 2.25);
  h.clock.seek(0); assert.equal(h.clock.snapshot().playing, false); assert.equal(h.frames.size, 0);
});
test('time cap, invalid seeks and failed sampling cannot continue playback', () => {
  const h = fixture(); h.clock.seek(3599); h.clock.play(); h.frame(0); h.frame(99999);
  assert.deepEqual(h.clock.snapshot(), { timeSeconds: 3600, playing: false }); assert.equal(h.clock.play(), false);
  for (const value of [-1, 3601, NaN, Infinity, '1']) { assert.equal(h.clock.seek(value), false); assert.equal(h.clock.snapshot().timeSeconds, 3600); }
  const failure = fixture(n => n < .5); failure.clock.play(); failure.frame(0); failure.frame(500);
  assert.deepEqual(failure.clock.snapshot(), { timeSeconds: 0, playing: false }); assert.equal(failure.frames.size, 0);
});
test('dispose/reset revoke every queued callback; thrown sampler and invalid RAF timestamp stop safely', () => {
  for (const action of ['reset', 'dispose']) {
    const h = fixture(); h.clock.play(); const late = [...h.frames.values()][0]; h.clock[action](); const count = h.samples.length;
    late(500); assert.equal(h.samples.length, count); assert.equal(h.frames.size, 0);
    if (action === 'dispose') { assert.equal(h.clock.play(), false); assert.equal(h.clock.seek(3), false); }
  }
  const fail = fixture(() => { throw Error('failed'); }); assert.equal(fail.clock.play(), false);
  const invalid = fixture(); invalid.clock.play(); invalid.frame(NaN); assert.equal(invalid.clock.snapshot().playing, false);
});
