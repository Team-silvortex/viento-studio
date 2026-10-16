import test from 'node:test';
import assert from 'node:assert/strict';
import { createSceneAudioMediaReader } from '../../web/modules/app-scene-audio-media.js';

const resource = { resourceId: '00000000-0000-4000-8000-000000000003', size: 64 };
const code = suffix => ({ errorCode: `scene_audio_audition_${suffix}` });
const gate = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
function response({ chunks = [new Uint8Array(64)], length = '64', status = 200, redirected = false, read } = {}) {
  const events = [], reader = { async read() { events.push('read'); return read ? read() : chunks.length ? { value: chunks.shift(), done: false } : { done: true }; },
    cancel() { events.push('cancel'); return Promise.resolve(); }, releaseLock() { events.push('release'); } };
  return { status, redirected, headers: { get: () => length }, body: { getReader() { events.push('lock'); return reader; }, cancel() { events.push('body-cancel'); } }, events };
}
test('audition media reads only the ID URL with same-origin no-store options and returns exact bytes', async () => {
  const reply = response({ chunks: [Uint8Array.from({ length: 20 }, (_, i) => i), new Uint8Array(44).fill(9)] }); let requested;
  const read = createSceneAudioMediaReader({ fetch: async (url, options) => { requested = { url, options }; return reply; } });
  const bytes = await read({ ...resource, sourcePath: '../../ignored.wav', url: 'https://ignored.invalid' });
  assert.equal(requested.url, `/asset-files/${resource.resourceId}`);
  assert.deepEqual({ ...requested.options, signal: null }, { method: 'GET', cache: 'no-store', credentials: 'same-origin', redirect: 'error', signal: null });
  assert.equal(bytes.byteLength, 64); assert.equal(bytes[19], 19); assert.equal(bytes[63], 9);
  assert.equal(requested.options.signal.aborted, true); assert.deepEqual(reply.events, ['lock', 'read', 'read', 'read', 'release']);
});
test('audition media rejects invalid IDs, limits and property accessors before network access', async () => {
  let calls = 0; const read = createSceneAudioMediaReader({ fetch: async () => { calls++; } });
  for (const value of [null, {}, { ...resource, resourceId: '../wav' }, { ...resource, resourceId: 'https://example.test' },
    ...[0, 43, NaN, Infinity, 64.5, '64', 32 * 1024 * 1024 + 1].map(size => ({ ...resource, size }))]) await assert.rejects(read(value), code('invalid'));
  const accessor = { ...resource }; Object.defineProperty(accessor, 'resourceId', { get() { assert.fail('accessor executed'); } });
  await assert.rejects(read(accessor), code('invalid')); assert.equal(calls, 0);
});
test('audition media rejects partial, empty, redirected and missing-body responses', async () => {
  for (const status of [204, 206, 301, 304, 404, 500]) {
    const reply = response({ status }); await assert.rejects(createSceneAudioMediaReader({ fetch: async () => reply })(resource), code('response'));
    assert.deepEqual(reply.events, ['body-cancel']);
  }
  for (const reply of [response({ redirected: true }), { status: 200, body: null }]) await assert.rejects(createSceneAudioMediaReader({ fetch: async () => reply })(resource), code('response'));
});
test('audition media requires exact numeric Content-Length when supplied and always counts the stream', async () => {
  for (const length of ['', ' 64', '64 ', '+64', '064', '64.0', '6.4e1', '65', '63', 'Infinity']) {
    const reply = response({ length }); await assert.rejects(createSceneAudioMediaReader({ fetch: async () => reply })(resource), code('size'));
    assert.deepEqual(reply.events, ['lock', 'cancel', 'release']);
  }
  const reply = response({ length: null }); assert.equal((await createSceneAudioMediaReader({ fetch: async () => reply })(resource)).length, 64);
});
test('audition media cancels and releases overlong, truncated and invalid chunk streams', async () => {
  for (const chunks of [[new Uint8Array(65)], [new Uint8Array(40), new Uint8Array(25)], [new Uint8Array(63)], [new ArrayBuffer(64)]]) {
    const reply = response({ chunks, length: null }); await assert.rejects(createSceneAudioMediaReader({ fetch: async () => reply })(resource), code('size'));
    assert.deepEqual(reply.events.slice(-2), ['cancel', 'release']);
  }
});
test('audition media handles pre-abort without fetching and aborts a pending request', async () => {
  let calls = 0; const pre = new AbortController(); pre.abort();
  await assert.rejects(createSceneAudioMediaReader({ fetch: async () => { calls++; } })(resource, { signal: pre.signal }), code('aborted')); assert.equal(calls, 0);
  const pending = gate(), controller = new AbortController(); let incoming;
  const reading = createSceneAudioMediaReader({ fetch: (url, options) => { incoming = options.signal; return pending.promise; } })(resource, { signal: controller.signal });
  controller.abort(); await assert.rejects(reading, code('aborted')); assert.equal(incoming.aborted, true);
  const late = response(); pending.resolve(late); await new Promise(resolve => setImmediate(resolve)); assert.deepEqual(late.events, ['body-cancel']);
});
test('audition media aborts pending stream reads and releases their lock', async () => {
  const pending = gate(), entered = gate(), controller = new AbortController();
  const reply = response({ read: () => { entered.resolve(); return pending.promise; } });
  const reading = createSceneAudioMediaReader({ fetch: async () => reply })(resource, { signal: controller.signal });
  await entered.promise; controller.abort(); await assert.rejects(reading, code('aborted'));
  assert.deepEqual(reply.events.slice(-2), ['cancel', 'release']); pending.reject(new Error('late read failure'));
});
test('audition media times out headers and bodies without waiting for an uncooperative fetch', async () => {
  for (const body of [false, true]) {
    const pending = gate(), reply = response({ read: () => pending.promise });
    const read = createSceneAudioMediaReader({ timeoutMs: 10, fetch: () => body ? Promise.resolve(reply) : pending.promise });
    await assert.rejects(read(resource), code('timeout'));
    if (body) assert.deepEqual(reply.events.slice(-2), ['cancel', 'release']);
    pending.reject(new Error('late failure'));
  }
});
test('audition media network and reader failures retain cleanup and permit a fresh retry', async () => {
  let fail = true; const replies = [];
  const read = createSceneAudioMediaReader({ fetch: async () => { if (fail) throw new Error('offline'); const reply = response(); replies.push(reply); return reply; } });
  await assert.rejects(read(resource), code('network')); fail = false; await read(resource); await read(resource); assert.equal(replies.length, 2);
  const reply = response({ read: async () => { throw new Error('read broke'); } });
  await assert.rejects(createSceneAudioMediaReader({ fetch: async () => reply })(resource), code('network')); assert.deepEqual(reply.events.slice(-2), ['cancel', 'release']);
});
