import { isSceneAudioAudition, sceneAudioAuditionBytes } from '../../engine/scene-audio-audition.mjs';

const MAX_DECODED_BYTES = 128 * 1024 * 1024;
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const error = code => Object.assign(new Error('Audio audition could not complete.'), { errorCode: `scene_audio_audition_${code}` });
const defaultContext = () => new globalThis.AudioContext();

// This adapter owns one transient player. It never owns a document or Save.
export function createSceneAudioAudition({ load, createContext = defaultContext, onChange = () => {} } = {}) {
  let disposed = false, active = null, visibleOwner = null, decodeTail = Promise.resolve();
  let state = Object.freeze({ status: 'idle', trackId: null, resourceId: null });
  const available = () => !disposed && typeof load === 'function' && typeof createContext === 'function'
    && (createContext !== defaultContext || typeof globalThis.AudioContext === 'function');
  function clock(owner) {
    const now = owner.context.currentTime;
    if (typeof now !== 'number' || !Number.isFinite(now) || now < 0 || now < owner.clockFloor) throw error('device');
    return now;
  }
  function position(owner, now = clock(owner)) {
    const seconds = owner.offset + (owner.status === 'playing' ? now - owner.startedAt : 0);
    if (!Number.isFinite(seconds) || seconds < 0) throw error('device');
    return owner.loop ? seconds % owner.duration : Math.min(owner.duration, seconds);
  }
  function snapshot() {
    const owner = visibleOwner === active && active?.buffer ? active : null;
    let seconds = owner?.offset ?? 0;
    if (owner) {
      try { seconds = position(owner); } catch { /* Reads never invoke observers or advance the transport. */ }
    }
    return Object.freeze({ ...state, positionSeconds: seconds, durationSeconds: owner?.duration ?? 0 });
  }
  function publish(status, owner = null, code) {
    if (owner) owner.status = status;
    visibleOwner = owner;
    state = Object.freeze({ status, trackId: owner?.trackId ?? null, resourceId: owner?.resourceId ?? null,
      ...(code ? { errorCode: code } : {}) });
    try { onChange(snapshot()); } catch { /* An observer does not own playback. */ }
  }
  function owns(owner) {
    if (!owner || disposed || active !== owner || owner.controller.signal.aborted) return false;
    try { return owner.isCurrent() === true && !disposed && active === owner && !owner.controller.signal.aborted; } catch { return false; }
  }
  const check = owner => { if (!owns(owner)) throw error('stale'); };
  function disconnectNode(owner) {
    const node = owner.node;
    owner.node = null;
    owner.nodeGeneration++;
    if (!node) return;
    try { node.onended = null; } catch { /* A failed device cannot prevent the remaining cleanup. */ }
    try { node.stop(); } catch { /* It may already have ended. */ }
    try { node.disconnect(); } catch { /* Cleanup is idempotent. */ }
  }
  function release(owner) {
    owner.buffer = null;
    if (!owner.released) { owner.released = true; owner.controller.abort(); }
    disconnectNode(owner);
    const gain = owner.gain; owner.gain = null;
    try { gain?.disconnect(); } catch { /* Cleanup is idempotent. */ }
    if (owner.context && !owner.closed) {
      owner.closed = true;
      try { Promise.resolve(owner.context.close()).catch(() => {}); } catch { /* Already closed. */ }
    }
  }
  function stop() {
    const owner = active; active = null;
    if (owner) release(owner);
    if (!disposed && !active) publish('idle');
  }
  function failed(owner, failure, stage) {
    const valid = owns(owner), current = active === owner;
    if (current) active = null;
    release(owner);
    if (current && !disposed && !active) {
      if (!valid) publish('idle');
      else publish('error', owner, failure?.errorCode === 'build_audio_format' ? 'scene_audio_audition_format'
        : /^scene_audio_audition_[a-z_]+$/.test(failure?.errorCode || '') ? failure.errorCode : `scene_audio_audition_${stage}`);
    }
    return false;
  }
  function waitFor(operation, owner) {
    const signal = owner.controller.signal;
    Promise.resolve(operation).catch(() => {});
    if (signal.aborted) return Promise.reject(error('stale'));
    let cancel;
    const cancelled = new Promise((_, reject) => { cancel = () => reject(error('stale')); signal.addEventListener('abort', cancel, { once: true }); });
    return Promise.race([operation, cancelled]).finally(() => signal.removeEventListener('abort', cancel));
  }
  function startNode(owner, seconds) {
    check(owner);
    const generation = ++owner.nodeGeneration;
    // Record the node before assigning or connecting anything: every failure
    // path can then stop and disconnect a partially initialized source.
    const node = owner.context.createBufferSource(); owner.node = node; check(owner);
    node.buffer = owner.buffer; node.loop = owner.loop; check(owner);
    node.connect(owner.gain); check(owner);
    node.onended = () => {
      if (active !== owner || owner.node !== node || owner.nodeGeneration !== generation) return;
      active = null; release(owner);
      if (!disposed && !active) publish('idle');
    };
    const now = clock(owner);
    owner.offset = seconds; owner.startedAt = now; owner.clockFloor = now; owner.status = 'playing';
    check(owner); node.start(0, seconds); check(owner);
  }
  function control(...statuses) {
    const owner = active;
    if (!owner) return null;
    if (!owns(owner)) { failed(owner, error('stale'), 'device'); return null; }
    return statuses.includes(owner.status) && owner.buffer ? owner : null;
  }
  async function play(request = {}) {
    if (disposed) return false;
    const { source, catalog, resourceId, trackId, volume, loop, isCurrent = () => true } = request || {};
    const owner = { controller: new AbortController(), resourceId, trackId, isCurrent, context: null, node: null, gain: null,
      closed: false, released: false, buffer: null, duration: 0, offset: 0, startedAt: 0, clockFloor: 0,
      nodeGeneration: 0, operation: 0, status: 'loading', loop };
    const prior = active; active = owner; if (prior) release(prior);
    let stage = 'invalid';
    try {
      if (!uuid(resourceId) || !uuid(trackId) || typeof volume !== 'number' || !Number.isFinite(volume)
        || volume < 0 || volume > 1 || typeof loop !== 'boolean' || typeof isCurrent !== 'function') throw error('invalid');
      if (!available()) throw error('unavailable');
      check(owner);
      // Both calls happen in the original click stack, before the first await.
      stage = 'device'; owner.context = createContext(); check(owner);
      owner.clockFloor = clock(owner);
      const resumed = Promise.resolve(owner.context.resume());
      resumed.catch(() => {}); // Attach immediately, even when load is delayed.
      check(owner); publish('loading', owner); check(owner);
      stage = 'load';
      const prepared = await waitFor(Promise.all([
        Promise.resolve(load(source, catalog, resourceId, { isCurrent: () => owns(owner), signal: owner.controller.signal })),
        resumed.catch(() => { throw error('device'); }),
      ]).then(([value]) => value), owner);
      check(owner);
      if (!isSceneAudioAudition(prepared) || prepared.resourceId !== resourceId) throw error('invalid');
      const rate = owner.context.sampleRate;
      const decodedSize = Math.ceil(prepared.frames * rate / prepared.sampleRate) * prepared.channels * 4;
      if (!Number.isFinite(rate) || rate <= 0 || !Number.isSafeInteger(decodedSize) || decodedSize <= 0 || decodedSize > MAX_DECODED_BYTES) throw error('decoded_limit');
      stage = 'decode';
      // decodeAudioData cannot be aborted. Serialize the actual calls, including
      // abandoned ones, so replacing a request cannot multiply decode memory.
      await waitFor(decodeTail, owner); check(owner);
      const decoding = Promise.resolve(owner.context.decodeAudioData(sceneAudioAuditionBytes(prepared)));
      decodeTail = decoding.then(() => {}, () => {});
      const buffer = await waitFor(decoding, owner); check(owner);
      if (!buffer || buffer.numberOfChannels !== prepared.channels || !Number.isSafeInteger(buffer.length)
        || buffer.length <= 0 || buffer.length * buffer.numberOfChannels * 4 > MAX_DECODED_BYTES
        || buffer.sampleRate !== rate || typeof buffer.duration !== 'number' || !Number.isFinite(buffer.duration)
        || buffer.duration <= 0 || Math.abs(buffer.duration - buffer.length / rate) > Number.EPSILON * Math.max(1, buffer.duration)) throw error('decode');
      owner.buffer = buffer; owner.duration = buffer.duration;
      stage = 'device';
      owner.gain = owner.context.createGain(); check(owner); owner.gain.gain.value = volume;
      owner.gain.connect(owner.context.destination);
      startNode(owner, 0); publish('playing', owner);
      return owns(owner);
    } catch (failure) { return failed(owner, failure, stage); }
  }
  function pause() {
    const owner = control('playing');
    if (!owner) return false;
    try {
      const now = clock(owner), seconds = position(owner, now);
      owner.offset = seconds; owner.clockFloor = now; owner.status = 'paused';
      disconnectNode(owner); check(owner); publish('paused', owner);
      return owns(owner);
    } catch (failure) { return failed(owner, failure, 'device'); }
  }
  async function resume() {
    const owner = control('paused');
    if (!owner) return false;
    const operation = ++owner.operation;
    try {
      owner.clockFloor = clock(owner);
      owner.status = 'resuming';
      // The user gesture resumes the existing context, without a new resource
      // request or decode. A paused buffer belongs only to this owner.
      const resumed = Promise.resolve(owner.context.resume()); resumed.catch(() => {});
      check(owner); publish('resuming', owner); check(owner);
      await waitFor(resumed, owner); check(owner);
      if (owner.operation !== operation || owner.status !== 'resuming') return false;
      startNode(owner, owner.offset >= owner.duration ? 0 : owner.offset);
      publish('playing', owner);
      return owns(owner);
    } catch (failure) { return failed(owner, failure, 'device'); }
  }
  function seek(seconds) {
    const owner = control('playing', 'paused');
    if (!owner || typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0 || seconds > owner.duration) return false;
    try {
      const now = clock(owner), target = owner.loop && seconds === owner.duration ? 0 : seconds;
      const playing = owner.status === 'playing';
      owner.offset = target; owner.clockFloor = now;
      if (playing) disconnectNode(owner);
      check(owner);
      if (playing && target < owner.duration) startNode(owner, target);
      else owner.status = 'paused';
      publish(owner.status, owner);
      return owns(owner);
    } catch (failure) { return failed(owner, failure, 'device'); }
  }
  function dispose() {
    if (disposed) return;
    disposed = true; const owner = active; active = null;
    if (owner) release(owner);
    publish('idle');
  }
  return Object.freeze({ available, snapshot, play, pause, resume, seek, stop, dispose });
}
