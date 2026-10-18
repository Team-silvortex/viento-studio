import test from 'node:test';
import assert from 'node:assert/strict';
import '../adapters/node-studio-core.mjs';
import { createSceneAnimationPlayer } from '../../web/modules/scene-animation-player.js';
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const model = loop => ({ format: 'viento-scene-animation', schemaVersion: 1, sceneObjectId: id(1), durationSeconds: 2, loop,
 tracks: [{ id: id(2), instanceId: id(3), property: 'opacity', interpolation: 'linear', keyframes: [{ atSeconds: 0, value: 0 }, { atSeconds: 2, value: 1 }] }] });
function fixture(options = {}) {
  const frames = new Map(), cancelled = [], samples = [], states = []; let now = 0, n = 0, current = true;
  const player = createSceneAnimationPlayer({ onSample: value => samples.push(value), onState: value => states.push(value), now: () => now,
    isCurrent: () => current, schedule: callback => { frames.set(++n, callback); return n; }, cancel: id => cancelled.push(id), ...options });
  return { player, frames, cancelled, samples, states, current(value) { current = value; }, time(value) { now = value; }, tick() { frames.get(n)(); } };
}
test('animation preview clock delegates interpolation, looping and completion to Rust', () => {
  for (const loop of [false, true]) {
    const h = fixture(); h.player.load(model(loop)); assert.equal(h.samples.at(-1).values[0].value, 0);
    h.player.play(); h.time(1000); h.tick(); assert.equal(h.samples.at(-1).values[0].value, 0.5);
    h.time(2500); h.tick(); assert.equal(h.samples.at(-1).values[0].value, loop ? 0.25 : 1); assert.equal(h.states.at(-1).state, loop ? 'playing' : 'paused');
    h.player.pause(); const count = h.samples.length; h.tick(); assert.equal(h.samples.length, count);
    h.player.seek(1); assert.equal(h.samples.at(-1).values[0].value, 0.5); h.player.stop(); assert.equal(h.samples.at(-1).localTimeSeconds, 0);
    h.player.dispose();
  }
});
test('cancelled old frame cannot draw or schedule after load play seek stop and clear', () => {
  for (const transition of [p => p.load(model(true)), p => p.seek(1), p => p.pause(), p => p.stop(), p => { p.clear(); p.load(model(true)); }]) {
    const h = fixture(); h.player.load(model(true)); h.player.play(); const stale = h.frames.get(1); transition(h.player); h.player.play();
    const samples = h.samples.length, frames = h.frames.size; h.time(500); stale();
    assert.equal(h.samples.length, samples); assert.equal(h.frames.size, frames); h.tick(); assert.equal(h.samples.length, samples + 1); h.player.dispose();
  }
});
test('source loss disposal and invalid seeking never produce further samples', () => {
  const h = fixture(); h.player.load(model(false)); h.player.play(); h.current(false); const count = h.samples.length; h.tick();
  assert.equal(h.samples.length, count); assert.equal(h.states.at(-1).state, 'paused'); assert.equal(h.player.play(), false);
  h.current(true); for (const time of [-1, NaN, Infinity, 3]) assert.equal(h.player.seek(time), false);
  h.player.dispose(); h.tick(); assert.equal(h.samples.length, count); assert.equal(h.player.play(), false);
});
test('reentrant state listeners cannot overwrite the new playback frame handle', () => {
  const frames = new Map(), cancelled = []; let clock = 0, serial = 0, reenter = false, player;
  player = createSceneAnimationPlayer({ now: () => clock, schedule: callback => { frames.set(++serial, callback); return serial; }, cancel: handle => cancelled.push(handle), onSample() {},
    onState(value) { if (reenter && value.state === 'playing' && value.positionSeconds > 0) { reenter = false; player.play(); } } });
  player.load(model(true)); player.play(); reenter = true; clock = 1000; frames.get(1)();
  assert.equal(frames.size, 2); player.pause(); assert.deepEqual(cancelled, [2]);
  player.dispose(); const count = frames.size; player.load(model(true)); player.play(); player.clear(); assert.equal(frames.size, count);
});
