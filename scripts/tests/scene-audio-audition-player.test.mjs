import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import { initializeStudioCore } from '../../engine/studio-core.mjs';
import { captureSceneAudioResources } from '../../engine/scene-audio-resources.mjs';
import { prepareSceneAudioAudition } from '../../engine/scene-audio-audition.mjs';
import { createSceneAudioAudition } from '../../web/modules/scene-audio-audition.js';
await initializeStudioCore(() => fs.readFile(new URL('../../engine/studio-core.wasm', import.meta.url)));

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const hash = value => createHash('sha256').update(value).digest('hex'), rev = value => 'sha256:' + hash(value);
const gate = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const tick = () => new Promise(resolve => setImmediate(resolve));
async function prepared(frames = 80) {
  const bytes = Buffer.alloc(44 + frames * 2); bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22); bytes.writeUInt32LE(8000, 24);
  bytes.writeUInt32LE(16000, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(frames * 2, 40);
  const content = JSON.stringify({ format: 'viento-scene-audio', schemaVersion: 1, sceneObjectId: id(1),
    tracks: [{ id: id(2), resourceId: id(3), role: 'music', volume: .5, loop: true }], cues: [] });
  const source = { sourcePath: 'documents/audio/test.json', token: 'audition-test', content, sourceRevision: rev(content), baseSourceRevision: rev(content) };
  const context = { format: 'viento-audio-creation-context', schemaVersion: 1, status: 'ready', worldId: 'world:' + hash('world'),
    baseRevision: rev('world-state'), documentRoot: 'documents', documentTypes: [{ id: 'audio', label: 'Audio' }],
    scene: { objectId: id(1), objectRevision: rev('scene'), sourcePath: 'documents/scenes/demo.json', sourceRevision: rev('scene-source') },
    manifest: { objectId: id(8), objectRevision: rev('metadata'), sourcePath: source.sourcePath, sourceRevision: rev(content), documentType: 'audio',
      parserProfile: 'structured', content, relations: [{ kind: 'reference', targetId: id(1), slot: 'scene' }], assetBindings: [{ assetId: id(3), role: 'audio' }], trackCount: 1 },
    resources: [{ resourceId: id(3), resourceRevision: rev('resource'), name: 'Tone', sourcePath: 'tone.wav', sha256: hash(bytes), size: bytes.length, availability: 'unverified' }] };
  const catalog = captureSceneAudioResources(source, context);
  return prepareSceneAudioAudition(source, catalog, id(3), { getResources: async () => captureSceneAudioResources(source, context), readBytes: async () => bytes, digestBytes: hash });
}
const sample = await prepared();
const decoded = (length = 480, sampleRate = 48000, numberOfChannels = 1) => ({ length, sampleRate, numberOfChannels, duration: length / sampleRate });
function context(options = {}) {
  const events = [], sources = [], gains = [];
  let resumes = 0;
  const ctx = { events, sources, gains, currentTime: options.time ?? 0, sampleRate: options.rate ?? 48000, destination: {},
    resume() { events.push('resume'); return options.resume?.(++resumes) ?? Promise.resolve(); },
    close() { events.push('close'); return Promise.resolve(); },
    decodeAudioData(bytes) { events.push('decode'); assert.ok(bytes instanceof ArrayBuffer); return options.decode?.(bytes) ?? Promise.resolve(decoded(480, ctx.sampleRate)); },
    createGain() {
      events.push('gain'); options.createGain?.();
      const value = { gain: { value: 1 }, connect() { events.push('gain-connect'); options.gainConnect?.(); },
        disconnect() { events.push('gain-disconnect'); value.disconnected = true; } };
      gains.push(value); return value;
    },
    createBufferSource() {
      events.push('source'); options.createSource?.(sources.length);
      const node = { loop: false, onended: null,
        set buffer(value) { options.setBuffer?.(sources.length); this.bufferValue = value; },
        connect() { events.push('source-connect'); options.sourceConnect?.(sources.length); },
        start(when = 0, offset = 0) { node.started = { when, offset }; events.push('start'); options.start?.(sources.length); },
        stop() { events.push('stop'); node.stopped = true; },
        disconnect() { events.push('source-disconnect'); node.disconnected = true; } };
      sources.push(node); return node;
    } };
  return ctx;
}
function harness({ load = async () => sample, contexts = [context()], onChange = () => {} } = {}) {
  const states = [], created = [], player = createSceneAudioAudition({ load, createContext: () => { const ctx = contexts[created.length]; created.push(ctx); return ctx; },
    onChange: value => { states.push(value); onChange(value); } });
  return { player, states, created, contexts, request: { source: {}, catalog: {}, resourceId: id(3), trackId: id(2), volume: .25, loop: false, isCurrent: () => true } };
}
test('audition player is optional and never creates an audio device before an explicit play', () => {
  const player = createSceneAudioAudition({ load: null }); assert.equal(player.available(), false); assert.deepEqual(player.snapshot(), { status: 'idle', trackId: null, resourceId: null, positionSeconds: 0, durationSeconds: 0 });
  const h = harness(); assert.equal(h.player.available(), true); assert.equal(h.created.length, 0); h.player.dispose(); assert.equal(h.player.available(), false);
});
test('audition player unlocks synchronously, plays verified bytes through authored gain and loop, then cleans on end', async () => {
  const h = harness(), playing = h.player.play(h.request); assert.equal(h.created.length, 1); assert.equal(h.contexts[0].events[0], 'resume');
  assert.equal(h.player.snapshot().status, 'loading'); assert.equal(await playing, true); const ctx = h.contexts[0];
  assert.equal(ctx.gains[0].gain.value, .25); assert.equal(ctx.sources[0].loop, false); assert.equal(h.player.snapshot().status, 'playing');
  assert.ok(Object.isFrozen(h.player.snapshot())); ctx.sources[0].onended(); assert.equal(h.player.snapshot().status, 'idle');
  assert.deepEqual(ctx.events.slice(-4), ['stop', 'source-disconnect', 'gain-disconnect', 'close']);
});
test('audition player validates finite gain, bool loop and identities before device access', async () => {
  for (const patch of [...[NaN, Infinity, -1, 1.01, '0.5'].map(volume => ({ volume })), { loop: 1 }, { trackId: 'bad' }, { resourceId: '../wav' }]) {
    const h = harness(); assert.equal(await h.player.play({ ...h.request, ...patch }), false); assert.equal(h.created.length, 0); assert.equal(h.player.snapshot().errorCode, 'scene_audio_audition_invalid');
  }
});
test('audition player stop during load aborts its request, closes device and ignores late success', async () => {
  const pending = gate(); let signal; const h = harness({ load: (source, catalog, id, options) => { signal = options.signal; return pending.promise; } });
  const playing = h.player.play(h.request); h.player.stop(); assert.equal(await playing, false); assert.equal(signal.aborted, true);
  pending.resolve(sample); await tick(); assert.equal(h.player.snapshot().status, 'idle'); assert.deepEqual(h.contexts[0].events, ['resume', 'close']);
});
test('audition player a newer play owns state even when an older load rejects later', async () => {
  const pending = gate(); let calls = 0; const h = harness({ contexts: [context(), context()], load: () => ++calls === 1 ? pending.promise : sample });
  const first = h.player.play(h.request), second = h.player.play({ ...h.request, trackId: id(9), volume: 0, loop: true });
  assert.equal(await first, false); assert.equal(await second, true); pending.reject(new Error('late')); await tick();
  assert.equal(h.player.snapshot().trackId, id(9)); assert.equal(h.contexts[1].gains[0].gain.value, 0); assert.equal(h.contexts[1].sources[0].loop, true); h.player.stop();
});
test('audition player serializes actual decoding across cancelled playback requests', async () => {
  const decoding = gate(), firstContext = context({ decode: () => decoding.promise }), nextContext = context();
  const h = harness({ contexts: [firstContext, nextContext] }); const first = h.player.play(h.request); await tick();
  assert.ok(firstContext.events.includes('decode')); const second = h.player.play({ ...h.request, trackId: id(9) }); await tick();
  assert.equal(await first, false); assert.equal(nextContext.events.includes('decode'), false); decoding.resolve(decoded());
  assert.equal(await second, true); assert.equal(firstContext.events.includes('start'), false); assert.equal(nextContext.events.filter(x => x === 'decode').length, 1); h.player.stop();
});
test('audition player stop while waiting to decode removes that queued request', async () => {
  const decoding = gate(), h = harness({ contexts: [context({ decode: () => decoding.promise }), context()] });
  const first = h.player.play(h.request); await tick(); const second = h.player.play(h.request); await tick(); h.player.stop();
  assert.equal(await first, false); assert.equal(await second, false); decoding.reject(new Error('old decode')); await tick();
  assert.equal(h.contexts[1].events.includes('decode'), false); assert.equal(h.player.snapshot().status, 'idle');
});
test('audition player disposal during decode prevents late nodes, state updates and reopening', async () => {
  const decoding = gate(), h = harness({ contexts: [context({ decode: () => decoding.promise })] }); const playing = h.player.play(h.request); await tick();
  h.player.dispose(); const count = h.states.length; assert.equal(await playing, false); decoding.resolve(decoded()); await tick();
  assert.equal(h.states.length, count); assert.equal(h.contexts[0].events.includes('start'), false); assert.equal(await h.player.play(h.request), false);
});
test('audition player immediate resume failure is handled before a pending load can finish', async () => {
  const pending = gate(), h = harness({ contexts: [context({ resume: () => Promise.reject(new Error('device')) })], load: () => pending.promise });
  assert.equal(await h.player.play(h.request), false); assert.equal(h.player.snapshot().errorCode, 'scene_audio_audition_device');
  assert.ok(h.contexts[0].events.includes('close')); pending.reject(new Error('late load')); await tick();
});
test('audition player stale resume rejection cannot disturb a newer playing track', async () => {
  const resumed = gate(), h = harness({ contexts: [context({ resume: () => resumed.promise }), context()] });
  const first = h.player.play(h.request), second = h.player.play({ ...h.request, trackId: id(9) });
  assert.equal(await first, false); assert.equal(await second, true); resumed.reject(new Error('late device')); await tick(); assert.equal(h.player.snapshot().trackId, id(9)); h.player.stop();
});
test('audition player refuses unbranded prepared bytes and preserves known verification errors', async () => {
  for (const load of [async () => ({ ...sample }), async () => { throw Object.assign(Error('changed'), { errorCode: 'scene_audio_audition_resource_changed' }); }]) {
    const h = harness({ load }); assert.equal(await h.player.play(h.request), false); assert.equal(h.contexts[0].events.includes('decode'), false);
    assert.match(h.player.snapshot().errorCode, /^scene_audio_audition_(invalid|resource_changed)$/);
  }
});
test('audition player bounds resampled Float32 memory before calling decode', async () => {
  const large = await prepared(2000000), h = harness({ load: async () => large, contexts: [context({ rate: 192000 })] });
  assert.equal(await h.player.play(h.request), false); assert.equal(h.player.snapshot().errorCode, 'scene_audio_audition_decoded_limit'); assert.equal(h.contexts[0].events.includes('decode'), false);
});
test('audition player handles decoder errors, invalid output and device start errors with complete cleanup', async () => {
  for (const [options, code] of [[{ decode: async () => { throw new Error('codec'); } }, 'decode'], [{ decode: async () => ({ length: 480, numberOfChannels: 2 }) }, 'decode'],
    [{ decode: async () => ({ length: 128 * 1024 * 1024, numberOfChannels: 1 }) }, 'decode'], [{ start: () => { throw new Error('device'); } }, 'device']]) {
    const h = harness({ contexts: [context(options)] }); assert.equal(await h.player.play(h.request), false); assert.equal(h.player.snapshot().errorCode, `scene_audio_audition_${code}`);
    assert.equal(h.contexts[0].events.filter(x => x === 'close').length, 1); if (code === 'device') assert.ok(h.contexts[0].events.includes('gain-disconnect'));
  }
});
test('audition player rechecks external ownership after each asynchronous stage', async () => {
  for (const boundary of ['load', 'resume', 'decode']) {
    const pending = gate(); let current = true; const options = boundary === 'load' ? { load: () => pending.promise }
      : { contexts: [context({ [boundary]: () => pending.promise })] };
    const h = harness(options), playing = h.player.play({ ...h.request, isCurrent: () => current }); await tick(); current = false;
    pending.resolve(boundary === 'load' ? sample : boundary === 'decode' ? decoded() : undefined);
    assert.equal(await playing, false); assert.equal(h.player.snapshot().status, 'idle'); assert.equal(h.contexts[0].events.includes('start'), false);
  }
});
test('audition player observer failures do not alter the owned lifecycle', async () => {
  const h = harness({ onChange: () => { throw Error('view'); } }); assert.equal(await h.player.play(h.request), true); h.player.stop(); assert.equal(h.player.snapshot().status, 'idle');
});
test('audition player synchronous device failures clean up without leaking rejected calls', async () => {
  for (const phase of ['create', 'resume', 'decode']) {
    const ctx = context({ [phase]: () => { throw Error('device unavailable'); } });
    const player = createSceneAudioAudition({ load: async () => sample, createContext: () => { if (phase === 'create') throw Error('no device'); return ctx; } });
    const { request } = harness(); assert.equal(await player.play(request), false);
    assert.equal(player.snapshot().errorCode, `scene_audio_audition_${phase === 'decode' ? 'decode' : 'device'}`);
    assert.equal(ctx.events.filter(value => value === 'close').length, phase === 'create' ? 0 : 1);
  }
});
test('audition player maps PCM errors and cannot be reopened by a disposal observer', async () => {
  const failed = harness({ load: async () => { throw Object.assign(Error('bad PCM'), { errorCode: 'build_audio_format' }); } });
  assert.equal(await failed.player.play(failed.request), false); assert.equal(failed.player.snapshot().errorCode, 'scene_audio_audition_format');
  let duringDispose; const h = harness({ onChange: state => { if (state.status === 'idle') duringDispose = h.player.play(h.request); } });
  assert.equal(await h.player.play(h.request), true); h.player.dispose(); assert.equal(await duringDispose, false); assert.equal(h.created.length, 1);
});


const longSample = await prepared(80000);
function transport(options = {}) {
  const ctx = context({ decode: async () => decoded(480000), ...options });
  return { ...harness({ load: async () => longSample, contexts: [ctx] }), ctx };
}
const closeTo = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} should equal ${expected}`);

test('audition transport derives frozen progress from the audio clock without observer notifications', async () => {
  const h = transport({ time: 20 }); assert.equal(await h.player.play(h.request), true);
  const updates = h.states.length; h.ctx.currentTime = 22.5;
  assert.equal(h.player.snapshot().status, 'playing'); assert.equal(h.player.snapshot().durationSeconds, 10);
  assert.equal(h.player.snapshot().positionSeconds, 2.5); assert.ok(Object.isFrozen(h.player.snapshot()));
  h.ctx.currentTime = 40; assert.equal(h.player.snapshot().positionSeconds, 10);
  assert.equal(h.states.length, updates); h.player.stop();
  assert.equal(h.player.snapshot().positionSeconds, 0); assert.equal(h.player.snapshot().durationSeconds, 0);
});

test('audition transport pause preserves offset and resume synchronously unlocks the same verified buffer', async () => {
  let loads = 0; const ctx = context({ decode: async () => decoded(480000) });
  const h = harness({ load: async () => { loads++; return longSample; }, contexts: [ctx] });
  assert.equal(await h.player.play(h.request), true); ctx.currentTime = 2.25;
  const oldEnded = ctx.sources[0].onended;
  assert.equal(h.player.pause(), true); assert.equal(h.player.snapshot().status, 'paused');
  assert.equal(ctx.sources[0].stopped, true); assert.equal(ctx.sources[0].disconnected, true);
  assert.equal(ctx.gains[0].disconnected, undefined); assert.equal(ctx.events.includes('close'), false);
  ctx.currentTime = 50; assert.equal(h.player.snapshot().positionSeconds, 2.25);
  const resumed = h.player.resume(); assert.equal(ctx.events.at(-1), 'resume'); assert.equal(h.player.snapshot().status, 'resuming');
  assert.equal(await resumed, true); assert.deepEqual(ctx.sources[1].started, { when: 0, offset: 2.25 });
  assert.equal(ctx.sources[1].bufferValue, ctx.sources[0].bufferValue);
  oldEnded(); assert.equal(h.player.snapshot().status, 'playing'); ctx.currentTime = 51;
  assert.equal(h.player.snapshot().positionSeconds, 3.25); assert.equal(loads, 1);
  assert.equal(ctx.events.filter(x => x === 'decode').length, 1); assert.equal(h.created.length, 1); assert.equal(ctx.gains.length, 1);
  h.player.stop(); assert.equal(ctx.sources[1].stopped, true); assert.equal(ctx.gains[0].disconnected, true);
});

test('audition transport seeking while paused changes only the retained offset', async () => {
  const h = transport(); await h.player.play(h.request); h.ctx.currentTime = 1; h.player.pause();
  const eventCount = h.ctx.events.length; assert.equal(h.player.seek(6.75), true);
  assert.equal(h.ctx.events.length, eventCount); assert.equal(h.player.snapshot().positionSeconds, 6.75);
  assert.equal(h.player.snapshot().status, 'paused'); h.ctx.currentTime = 8;
  assert.equal(await h.player.resume(), true); assert.equal(h.ctx.sources[1].started.offset, 6.75);
  h.ctx.currentTime = 9; assert.equal(h.player.snapshot().positionSeconds, 7.75); h.player.dispose();
});

test('audition transport seeks with fresh one-shot nodes and ignores every older ended callback', async () => {
  const h = transport(); await h.player.play(h.request); const oldEnded = h.ctx.sources[0].onended;
  h.ctx.currentTime = 1; assert.equal(h.player.seek(6), true);
  assert.equal(h.ctx.sources[0].stopped, true); assert.equal(h.ctx.sources[0].disconnected, true);
  assert.equal(h.ctx.sources[1].started.offset, 6); assert.equal(h.player.snapshot().positionSeconds, 6);
  const replacedEnded = h.ctx.sources[1].onended; assert.equal(h.player.seek(3), true);
  oldEnded(); replacedEnded(); assert.equal(h.player.snapshot().status, 'playing');
  assert.equal(h.ctx.events.includes('close'), false); h.ctx.currentTime = 2;
  assert.equal(h.player.snapshot().positionSeconds, 4); h.ctx.sources[2].onended();
  assert.equal(h.player.snapshot().status, 'idle'); assert.equal(h.ctx.events.filter(x => x === 'close').length, 1);
});

test('audition transport wraps loop progress and maps an exact-duration seek to the loop beginning', async () => {
  const h = transport({ time: 10 }); await h.player.play({ ...h.request, loop: true });
  h.ctx.currentTime = 32.125; closeTo(h.player.snapshot().positionSeconds, 2.125);
  assert.equal(h.player.pause(), true); closeTo(h.player.snapshot().positionSeconds, 2.125);
  assert.equal(h.player.seek(10), true); assert.equal(h.player.snapshot().positionSeconds, 0);
  assert.equal(await h.player.resume(), true); assert.equal(h.ctx.sources[1].started.offset, 0);
  h.ctx.currentTime = 35; assert.equal(h.player.seek(10), true);
  assert.equal(h.ctx.sources[2].started.offset, 0); assert.equal(h.ctx.sources[2].loop, true);
  assert.equal(h.player.snapshot().status, 'playing'); h.player.stop();
});

test('audition transport pauses at a non-loop endpoint and resumes it from the beginning', async () => {
  const h = transport(); await h.player.play(h.request);
  const ended = h.ctx.sources[0].onended; assert.equal(h.player.seek(10), true);
  assert.equal(h.player.snapshot().status, 'paused'); assert.equal(h.player.snapshot().positionSeconds, 10);
  assert.equal(h.ctx.sources.length, 1); ended(); assert.equal(h.player.snapshot().status, 'paused');
  assert.equal(await h.player.resume(), true); assert.equal(h.ctx.sources[1].started.offset, 0);
  h.ctx.currentTime = 10; assert.equal(h.player.pause(), true); assert.equal(h.player.snapshot().positionSeconds, 10);
  assert.equal(await h.player.resume(), true); assert.equal(h.ctx.sources[2].started.offset, 0); h.player.stop();
});

test('audition transport rejects invalid seek inputs without changing playback or paused state', async () => {
  for (const paused of [false, true]) {
    const h = transport(); await h.player.play(h.request); h.ctx.currentTime = 2; if (paused) h.player.pause();
    const before = h.player.snapshot(), events = h.ctx.events.length, states = h.states.length;
    for (const value of [NaN, Infinity, -Infinity, -0.001, 10.001, '2', null, undefined, {}, [], true]) {
      assert.equal(h.player.seek(value), false); assert.deepEqual(h.player.snapshot(), before);
    }
    assert.equal(h.ctx.events.length, events); assert.equal(h.states.length, states); h.player.dispose();
  }
});

test('audition transport rejects controls before loading, during loading, after errors and after disposal', async () => {
  const pending = gate(), h = harness({ load: () => pending.promise });
  const noControl = async () => { assert.equal(h.player.pause(), false); assert.equal(await h.player.resume(), false); assert.equal(h.player.seek(0), false); };
  await noControl(); const playing = h.player.play(h.request); await noControl();
  pending.reject(Error('failed')); assert.equal(await playing, false); assert.equal(h.player.snapshot().status, 'error');
  await noControl(); h.player.dispose(); await noControl(); assert.equal(h.created.length, 1);
});

test('audition transport rejects duplicate resume and seeking while resume is pending, and stop cancels it', async () => {
  const pending = gate(), h = transport({ resume: count => count === 2 ? pending.promise : Promise.resolve() });
  await h.player.play(h.request); h.ctx.currentTime = 2; h.player.pause();
  const resumed = h.player.resume(); assert.equal(h.player.snapshot().status, 'resuming');
  assert.equal(h.player.snapshot().positionSeconds, 2); assert.equal(h.player.snapshot().durationSeconds, 10);
  assert.equal(await h.player.resume(), false); assert.equal(h.player.seek(4), false); assert.equal(h.player.pause(), false);
  assert.equal(h.ctx.events.filter(x => x === 'resume').length, 2); h.player.stop(); assert.equal(await resumed, false);
  pending.resolve(); await tick(); assert.equal(h.ctx.sources.length, 1); assert.equal(h.player.snapshot().status, 'idle');
});

test('audition transport a replaced owner survives a late rejected continuation', async () => {
  const pending = gate(), ctx = context({ decode: async () => decoded(480000), resume: count => count === 2 ? pending.promise : Promise.resolve() });
  const h = harness({ load: async () => longSample, contexts: [ctx, context({ decode: async () => decoded(480000) })] });
  await h.player.play(h.request); ctx.currentTime = 2; h.player.pause(); const resumed = h.player.resume();
  assert.equal(await h.player.play({ ...h.request, trackId: id(9) }), true); assert.equal(await resumed, false);
  pending.reject(Error('late')); await tick(); assert.equal(h.player.snapshot().trackId, id(9));
  assert.equal(h.player.snapshot().status, 'playing'); assert.equal(ctx.sources.length, 1); h.player.dispose();
});

test('audition transport revalidates external ownership for every pause, resume and seek control', async () => {
  for (const action of ['pause', 'resume', 'seek']) for (const throws of [false, true]) {
    let current = true; const h = transport();
    await h.player.play({ ...h.request, isCurrent: () => { if (!current && throws) throw Error('replaced'); return current; } });
    if (action === 'resume') h.player.pause(); current = false;
    assert.equal(await h.player[action](2), false); assert.equal(h.player.snapshot().status, 'idle');
    assert.equal(h.ctx.events.filter(x => x === 'close').length, 1); assert.equal(h.ctx.sources.length, 1);
    assert.equal(h.player.snapshot().durationSeconds, 0);
  }
});

test('audition transport revalidates ownership after an asynchronous continuation', async () => {
  let current = true; const pending = gate(), h = transport({ resume: count => count === 2 ? pending.promise : Promise.resolve() });
  await h.player.play({ ...h.request, isCurrent: () => current }); h.player.pause(); const resumed = h.player.resume();
  current = false; pending.resolve(); assert.equal(await resumed, false); assert.equal(h.player.snapshot().status, 'idle');
  assert.equal(h.ctx.sources.length, 1); assert.equal(h.ctx.events.filter(x => x === 'close').length, 1);
});

test('audition transport rejects unusable initial audio clocks before resuming or loading', async () => {
  for (const value of [NaN, Infinity, -1, '0']) {
    const h = transport(); h.ctx.currentTime = value; assert.equal(await h.player.play(h.request), false);
    assert.equal(h.player.snapshot().errorCode, 'scene_audio_audition_device');
    assert.equal(h.ctx.events.includes('resume'), false); assert.equal(h.ctx.events.includes('decode'), false);
    assert.equal(h.ctx.events.filter(x => x === 'close').length, 1);
  }
});

test('audition transport progress reads remain side-effect free when the device clock becomes invalid', async () => {
  for (const value of [NaN, Infinity, -1, '1']) {
    const h = transport(); await h.player.play(h.request); h.ctx.currentTime = 1; h.player.seek(2);
    const events = h.ctx.events.length, states = h.states.length; h.ctx.currentTime = value;
    assert.equal(h.player.snapshot().positionSeconds, 2); assert.equal(h.player.snapshot().durationSeconds, 10);
    assert.equal(h.ctx.events.length, events); assert.equal(h.states.length, states);
    assert.equal(h.player.pause(), false); assert.equal(h.player.snapshot().errorCode, 'scene_audio_audition_device');
    assert.equal(h.player.snapshot().durationSeconds, 0); assert.equal(h.ctx.events.filter(x => x === 'close').length, 1);
  }
});

test('audition transport rejects backwards clocks on pause, seek and resume', async () => {
  for (const action of ['pause', 'seek', 'resume']) {
    const h = transport({ time: 10 }); await h.player.play(h.request); h.ctx.currentTime = 12; h.player.seek(2);
    if (action === 'resume') h.player.pause(); h.ctx.currentTime = 11;
    assert.equal(await h.player[action](4), false); assert.equal(h.player.snapshot().errorCode, 'scene_audio_audition_device');
    assert.equal(h.ctx.events.filter(x => x === 'close').length, 1);
  }
});

test('audition transport rejects buffers without a valid finite sample-aligned duration', async () => {
  for (const patch of [{ duration: NaN }, { duration: Infinity }, { duration: 0 }, { duration: -1 }, { duration: '10' },
    { duration: 10.5 }, { sampleRate: 24000 }, { sampleRate: NaN }]) {
    const h = transport({ decode: async () => ({ ...decoded(480000), ...patch }) });
    assert.equal(await h.player.play(h.request), false); assert.equal(h.player.snapshot().errorCode, 'scene_audio_audition_decode');
    assert.equal(h.ctx.sources.length, 0); assert.equal(h.ctx.events.filter(x => x === 'close').length, 1);
  }
});

test('audition transport cleans every partially created node when setup or replacement fails', async () => {
  for (const phase of ['createGain', 'gainConnect', 'createSource', 'setBuffer', 'sourceConnect', 'start']) {
    for (const action of ['play', 'seek', 'resume']) {
      if (action !== 'play' && ['createGain', 'gainConnect'].includes(phase)) continue;
      let broken = action === 'play';
      const h = transport({ [phase]: () => { if (broken) throw Error(phase); } });
      if (action !== 'play') {
        assert.equal(await h.player.play(h.request), true); if (action === 'resume') h.player.pause(); broken = true;
      }
      assert.equal(await h.player[action](action === 'play' ? h.request : 2), false, `${phase} during ${action}`);
      assert.equal(h.player.snapshot().errorCode, 'scene_audio_audition_device');
      for (const node of h.ctx.sources) { assert.equal(node.stopped, true); assert.equal(node.disconnected, true); assert.equal(node.onended, null); }
      for (const gain of h.ctx.gains) assert.equal(gain.disconnected, true);
      assert.equal(h.ctx.events.filter(x => x === 'close').length, 1); assert.equal(h.player.snapshot().durationSeconds, 0);
    }
  }
});

test('audition transport handles synchronous or rejected continuation errors without retained buffers', async () => {
  for (const rejection of [false, true]) {
    const h = transport({ resume: count => { if (count === 2) { if (rejection) return Promise.reject(Error('blocked')); throw Error('blocked'); } } });
    await h.player.play(h.request); h.player.pause(); assert.equal(await h.player.resume(), false);
    assert.equal(h.player.snapshot().errorCode, 'scene_audio_audition_device'); assert.equal(h.player.snapshot().durationSeconds, 0);
    assert.equal(h.ctx.sources.length, 1); assert.equal(h.ctx.events.filter(x => x === 'close').length, 1);
  }
});

test('audition transport stopping from a paused observer cannot retain or restart its buffer', async () => {
  let h; const ctx = context({ decode: async () => decoded(480000) });
  h = harness({ load: async () => longSample, contexts: [ctx], onChange: state => { if (state.status === 'paused') h.player.stop(); } });
  await h.player.play(h.request); assert.equal(h.player.pause(), false); assert.equal(h.player.snapshot().status, 'idle');
  assert.equal(await h.player.resume(), false); assert.equal(ctx.sources.length, 1);
  assert.equal(ctx.events.filter(x => x === 'close').length, 1);
});

test('audition transport a resuming observer may replace playback without an older continuation taking it back', async () => {
  let h, replacement; const contexts = [context({ decode: async () => decoded(480000) }), context({ decode: async () => decoded(480000) })];
  h = harness({ load: async () => longSample, contexts, onChange: state => {
    if (state.status === 'resuming') replacement = h.player.play({ ...h.request, trackId: id(9) });
  } });
  await h.player.play(h.request); h.player.pause(); assert.equal(await h.player.resume(), false);
  assert.equal(await replacement, true); assert.equal(h.player.snapshot().trackId, id(9)); assert.equal(h.player.snapshot().status, 'playing');
  assert.equal(contexts[0].sources.length, 1); h.player.dispose();
});

test('audition transport a playing observer can pause a replacement node without corrupting its seek position', async () => {
  let h, pauseOnPlaying = false; const ctx = context({ decode: async () => decoded(480000) });
  h = harness({ load: async () => longSample, contexts: [ctx], onChange: state => { if (state.status === 'playing' && pauseOnPlaying) h.player.pause(); } });
  await h.player.play(h.request); pauseOnPlaying = true; assert.equal(h.player.seek(4), true);
  assert.equal(h.player.snapshot().status, 'paused'); assert.equal(h.player.snapshot().positionSeconds, 4);
  assert.equal(ctx.sources[1].stopped, true); assert.equal(ctx.events.includes('close'), false); h.player.dispose();
});

test('audition transport disposal while resuming releases the buffer and ignores a late successful resume', async () => {
  const pending = gate(), h = transport({ resume: count => count === 2 ? pending.promise : Promise.resolve() });
  await h.player.play(h.request); h.player.pause(); const resumed = h.player.resume(); h.player.dispose();
  const states = h.states.length; assert.equal(await resumed, false); pending.resolve(); await tick();
  assert.equal(h.states.length, states); assert.equal(h.ctx.sources.length, 1); assert.equal(h.player.snapshot().durationSeconds, 0);
  assert.equal(h.ctx.events.filter(x => x === 'close').length, 1); assert.equal(await h.player.resume(), false);
});

test('audition transport ownership callbacks cannot let a replaced owner reclaim state', async () => {
  let replace = false, replacement; const h = harness({ load: async () => longSample,
    contexts: [context({ decode: async () => decoded(480000) }), context({ decode: async () => decoded(480000) })] });
  await h.player.play({ ...h.request, isCurrent: () => {
    if (replace) { replace = false; replacement = h.player.play({ ...h.request, trackId: id(9) }); }
    return true;
  } });
  replace = true; assert.equal(h.player.pause(), false); assert.equal(await replacement, true);
  assert.equal(h.player.snapshot().status, 'playing'); assert.equal(h.player.snapshot().trackId, id(9));
  assert.equal(h.contexts[0].events.filter(x => x === 'close').length, 1); h.player.dispose();
});

test('audition transport a loading observer can replace a request before its resource load', async () => {
  let h, replacement, loads = 0;
  h = harness({ load: async () => { loads++; return longSample; },
    contexts: [context({ decode: async () => decoded(480000) }), context({ decode: async () => decoded(480000) })],
    onChange: state => { if (state.status === 'loading' && state.trackId === id(2)) replacement = h.player.play({ ...h.request, trackId: id(9) }); } });
  assert.equal(await h.player.play(h.request), false); assert.equal(await replacement, true);
  assert.equal(loads, 1); assert.equal(h.player.snapshot().trackId, id(9)); assert.equal(h.contexts[0].sources.length, 0); h.player.dispose();
});

test('audition transport reentrant device calls cannot create orphan nodes or publish stale continuation state', async () => {
  for (const phase of ['resume', 'createSource', 'sourceConnect', 'start']) {
    let h, armed = false;
    const ctx = context({ decode: async () => decoded(480000), [phase]: () => { if (armed) h.player.stop(); } });
    h = harness({ load: async () => longSample, contexts: [ctx] }); await h.player.play(h.request);
    if (phase === 'resume') h.player.pause(); armed = true;
    assert.equal(await (phase === 'resume' ? h.player.resume() : h.player.seek(2)), false);
    assert.equal(h.player.snapshot().status, 'idle'); assert.equal(h.player.snapshot().durationSeconds, 0);
    for (const node of ctx.sources) { assert.equal(node.stopped, true); assert.equal(node.disconnected, true); }
    assert.equal(ctx.events.filter(x => x === 'close').length, 1);
  }
});
