import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import '../adapters/node-studio-core.mjs';
import { captureSceneAudioResources } from '../../engine/scene-audio-resources.mjs';
import { prepareSceneAudioAudition, isSceneAudioAudition, sceneAudioAuditionBytes } from '../../engine/scene-audio-audition.mjs';
import { validatePcmWave } from '../../engine/audio-wav.mjs';
import { validatePcmWave as legacyValidatePcmWave } from '../lib/audio-wav.mjs';

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const revision = bytes => 'sha256:' + hash(bytes);
const actualWave = new Uint8Array(await fs.readFile(new URL('../../examples/scene-audio/assets/tone.wav', import.meta.url)));
const content = '\ufeff' + JSON.stringify({ format: 'viento-scene-audio', schemaVersion: 1, sceneObjectId: id(1),
  tracks: [{ id: id(2), resourceId: id(3), role: 'music', volume: .5, loop: true }], cues: [] }, null, '\t').replaceAll('\n', '\r\n') + '\r\n';
const source = () => ({ sourcePath: 'documents/audio/demo.json', token: 'source:1', content,
  baseSourceRevision: revision(content), sourceRevision: revision(content) });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const invalid = { errorCode: 'scene_audio_audition_invalid' };
const conflict = { errorCode: 'scene_audio_audition_conflict' };
const changed = { errorCode: 'scene_audio_audition_resource_changed' };

function fixture(bytes = actualWave) {
  const s = source(), resource = n => ({ resourceId: id(n), resourceRevision: revision('resource-' + n), name: `Sound ${n}`,
    sourcePath: `sound-${n}.wav`, sha256: hash(bytes), size: bytes.length, availability: 'unverified' });
  const context = { format: 'viento-audio-creation-context', schemaVersion: 1, status: 'ready', worldId: 'world:' + hash('world'),
    baseRevision: revision('world-state'), documentRoot: 'documents', documentTypes: [{ id: 'audio', label: 'Audio' }],
    scene: { objectId: id(1), objectRevision: revision('scene'), sourcePath: 'documents/scenes/demo.json', sourceRevision: revision('scene-source') },
    manifest: { objectId: id(8), objectRevision: revision('audio-metadata'), sourcePath: s.sourcePath, sourceRevision: s.baseSourceRevision,
      documentType: 'audio', parserProfile: 'structured', content, relations: [{ kind: 'references', targetId: id(1), slot: '' }],
      assetBindings: [{ assetId: id(3), role: 'audio' }, { assetId: id(4), role: 'audio' }], trackCount: 1 },
    resources: [resource(3), resource(4), resource(5)] };
  const catalog = captureSceneAudioResources(s, context), calls = [];
  const ports = {
    getResources: async captured => { calls.push('catalog'); return captureSceneAudioResources(captured, context); },
    readBytes: async selected => { calls.push('bytes'); assert.ok(Object.isFrozen(selected)); assert.equal(selected.resourceId, id(3)); return bytes; },
    digestBytes: async captured => { calls.push('digest'); return hash(captured); },
  };
  return { source: s, context, catalog, calls, ports, run: overrides => prepareSceneAudioAudition(s, catalog, id(3), { ...ports, ...overrides }) };
}

test('prepares the actual registered WAV with a frozen description and independent decoder bytes', async () => {
  const f = fixture(), beforeSource = { ...f.source }, beforeContext = structuredClone(f.context), p = await f.run();
  assert.ok(isSceneAudioAudition(p)); assert.ok(Object.isFrozen(p));
  assert.deepEqual(p, { resourceId: id(3), name: 'Sound 3', channels: 1, sampleRate: 22050, frames: 22050, durationSeconds: 1 });
  assert.deepEqual(f.calls, ['catalog', 'bytes', 'digest']); assert.deepEqual(f.source, beforeSource); assert.deepEqual(f.context, beforeContext);
  const first = sceneAudioAuditionBytes(p), second = sceneAudioAuditionBytes(p);
  assert.ok(first instanceof ArrayBuffer); assert.notEqual(first, second); assert.deepEqual(new Uint8Array(first), actualWave);
  new Uint8Array(first).fill(0); assert.deepEqual(new Uint8Array(second), actualWave);
  assert.deepEqual(new Uint8Array(sceneAudioAuditionBytes(p)), actualWave);
});

test('the legacy PCM validator is the shared function and its original format rules remain unchanged', async () => {
  assert.equal(legacyValidatePcmWave, validatePcmWave);
  const stereo = new Uint8Array(48), view = new DataView(stereo.buffer);
  stereo.set(new TextEncoder().encode('RIFF'), 0); view.setUint32(4, 40, true); stereo.set(new TextEncoder().encode('WAVEfmt '), 8);
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 2, true); view.setUint32(24, 96000, true);
  view.setUint32(28, 384000, true); view.setUint16(32, 4, true); view.setUint16(34, 16, true);
  stereo.set(new TextEncoder().encode('data'), 36); view.setUint32(40, 4, true);
  const p = await fixture(stereo).run(); assert.equal(p.channels, 2); assert.equal(p.sampleRate, 96000); assert.equal(p.durationSeconds, 1 / 96000);
  for (const mutate of [b => { b[0] = 0; }, b => { b[20] = 3; }, b => { b[22] = 3; }, b => { b[34] = 8; }, b => { b[40]--; }]) {
    const bytes = actualWave.slice(); mutate(bytes);
    await assert.rejects(fixture(bytes).run(), { errorCode: 'build_audio_format' });
  }
});

test('audition and resource brands cannot be forged by spreading cloning or changing prototypes', async () => {
  const f = fixture(), p = await f.run();
  for (const fake of [null, {}, { ...p }, structuredClone(p), Object.create(p)]) {
    assert.equal(isSceneAudioAudition(fake), false); assert.throws(() => sceneAudioAuditionBytes(fake), invalid);
  }
  for (const catalog of [null, {}, { ...f.catalog }, structuredClone(f.catalog), Object.create(f.catalog)]) {
    await assert.rejects(prepareSceneAudioAudition(f.source, catalog, id(3), f.ports), invalid);
  }
});

test('requires a bound selectable resource and never reads unknown unbound or unavailable choices', async () => {
  for (const resourceId of [id(5), id(99), '', null, { toString() { throw Error('Must not coerce'); } }]) {
    const f = fixture(); await assert.rejects(prepareSceneAudioAudition(f.source, f.catalog, resourceId, f.ports), invalid); assert.deepEqual(f.calls, []);
  }
  const f = fixture(); f.context.resources = f.context.resources.filter(row => row.resourceId !== id(3));
  const catalog = captureSceneAudioResources(f.source, f.context);
  await assert.rejects(prepareSceneAudioAudition(f.source, catalog, id(3), f.ports), invalid); assert.deepEqual(f.calls, []);
});

test('every source field must match and descriptor capture rejects accessors extras and prototypes before IO', async () => {
  for (const key of Object.keys(source())) {
    const f = fixture(); f.source[key] += 'x'; await assert.rejects(f.run(), conflict); assert.deepEqual(f.calls, []);
  }
  let getterCalls = 0;
  for (const alter of [s => Object.defineProperty(s, 'content', { enumerable: true, get() { getterCalls++; return content; } }),
    s => Object.setPrototypeOf(s, { inherited: true }), s => { s.extra = true; },
    s => Object.defineProperty(s, 'token', { enumerable: false, value: 'source:1' })]) {
    const f = fixture(); alter(f.source); await assert.rejects(f.run(), invalid); assert.deepEqual(f.calls, []);
  }
  assert.equal(getterCalls, 0);
});

test('the source is captured before the first await and the reader receives only the chosen frozen registration', async () => {
  const f = fixture(), gate = deferred(); let captured;
  const pending = f.run({ getResources: value => { captured = value; return gate.promise; },
    readBytes: async (selected, options) => { assert.equal(selected.resourceId, id(3)); assert.ok(Object.isFrozen(selected)); assert.deepEqual(options, { signal: undefined }); return actualWave; } });
  f.source.content = '{}'; f.source.token = 'source:2';
  assert.ok(Object.isFrozen(captured)); assert.equal(captured.content, content); assert.equal(captured.token, 'source:1');
  gate.resolve(captureSceneAudioResources(captured, f.context)); assert.ok(isSceneAudioAudition(await pending));
});

test('fresh directory checks reject the original object forged catalogs and another source before byte reads', async () => {
  const f = fixture();
  for (const fresh of [f.catalog, { ...f.catalog }, structuredClone(f.catalog),
    captureSceneAudioResources({ ...f.source, token: 'source:2' }, f.context)]) {
    await assert.rejects(f.run({ getResources: async () => fresh }), conflict);
  }
  assert.deepEqual(f.calls, []);
});

test('fresh directory comparison covers world source metadata bound and unbound registration changes', async () => {
  for (const alter of [raw => { raw.worldId = 'world:' + hash('other'); }, raw => { raw.baseRevision = revision('next-world'); },
    raw => { raw.scene.objectRevision = revision('next-scene'); }, raw => { raw.scene.sourceRevision = revision('next-scene-source'); },
    raw => { raw.manifest.objectRevision = revision('next-object'); }, raw => { raw.manifest.relations[0].note = 'new'; },
    raw => { raw.manifest.assetBindings[1].role = 'new'; }, raw => { raw.resources[0].resourceRevision = revision('next-resource'); },
    raw => { raw.resources[0].sha256 = hash('changed'); }, raw => { raw.resources[0].sourcePath = 'new.wav'; },
    raw => { raw.resources[2].name = 'Unbound registration changed'; }, raw => { raw.resources.reverse(); }, raw => { raw.resources.pop(); }]) {
    const f = fixture(); alter(f.context); await assert.rejects(f.run(), conflict); assert.deepEqual(f.calls, ['catalog']);
  }
});

test('size and byte type limits are checked before hashing and PCM decoding', async () => {
  for (const bytes of [actualWave.subarray(0, 43), actualWave.subarray(1), new Uint8Array(actualWave.length + 1), new Uint8Array(32 * 1024 * 1024 + 1)]) {
    const f = fixture(); await assert.rejects(f.run({ readBytes: async () => bytes }), changed); assert.deepEqual(f.calls, ['catalog']);
  }
  for (const bytes of [actualWave.buffer, [...actualWave], new DataView(actualWave.buffer), null, new Uint8Array(new SharedArrayBuffer(actualWave.length))]) {
    const f = fixture(); await assert.rejects(f.run({ readBytes: async () => bytes }), invalid); assert.deepEqual(f.calls, ['catalog']);
  }
});

test('hash verification uses the exact bytes and rejects malformed or mismatched digests', async () => {
  for (const digest of [hash('changed'), 'sha256:' + hash(actualWave), hash(actualWave).toUpperCase(), null, true]) {
    await assert.rejects(fixture().run({ digestBytes: async () => digest }), changed);
  }
  const corrupted = actualWave.slice(); corrupted[corrupted.length - 1] ^= 1;
  await assert.rejects(fixture().run({ readBytes: async () => corrupted }), changed);
});

test('read bytes digest input and decoder output stay isolated across asynchronous mutation', async () => {
  const original = actualWave.slice(), f = fixture(original), gate = deferred(), entered = deferred(); let digestInput;
  const pending = f.run({ digestBytes: bytes => { digestInput = bytes; entered.resolve(); return gate.promise; } });
  await entered.promise;
  assert.notEqual(digestInput, original); assert.notEqual(digestInput.buffer, original.buffer);
  original.fill(0); const expected = hash(digestInput); digestInput.fill(0); gate.resolve(expected);
  const prepared = await pending; assert.deepEqual(new Uint8Array(sceneAudioAuditionBytes(prepared)), actualWave);
  const detached = sceneAudioAuditionBytes(prepared); structuredClone(detached, { transfer: [detached] });
  assert.equal(detached.byteLength, 0); assert.deepEqual(new Uint8Array(sceneAudioAuditionBytes(prepared)), actualWave);
});

test('byte capture uses the typed-array view offset without invoking overridden accessors', async () => {
  const backing = new Uint8Array(actualWave.length + 16); backing.set(actualWave, 8); const view = backing.subarray(8, -8); let reads = 0;
  for (const key of ['byteLength', 'buffer', 'byteOffset']) Object.defineProperty(view, key, { get() { reads++; throw Error('Must not read own accessors'); } });
  const prepared = await fixture().run({ readBytes: async () => view });
  assert.equal(reads, 0); assert.deepEqual(new Uint8Array(sceneAudioAuditionBytes(prepared)), actualWave);
  const nodeBuffer = Buffer.from(actualWave); assert.ok(isSceneAudioAudition(await fixture().run({ readBytes: async () => nodeBuffer })));
});

test('caller ownership is checked initially and after all three awaited ports', async () => {
  const initial = fixture(); await assert.rejects(initial.run({ isCurrent: () => false }), conflict); assert.deepEqual(initial.calls, []);
  for (const stage of ['getResources', 'readBytes', 'digestBytes']) {
    const f = fixture(), entered = deferred(), gate = deferred(); let owns = true;
    const pending = f.run({ isCurrent: () => owns, [stage]: async (...args) => { const result = await f.ports[stage](...args); entered.resolve(); await gate.promise; return result; } });
    await entered.promise; owns = false; gate.resolve(); await assert.rejects(pending, conflict);
    assert.deepEqual(f.calls, ['catalog', 'bytes', 'digest'].slice(0, ['getResources', 'readBytes', 'digestBytes'].indexOf(stage) + 1));
  }
});

test('abort is checked initially and after directory read byte read and digest with the same signal forwarded', async () => {
  const first = fixture(), aborted = new AbortController(); aborted.abort();
  await assert.rejects(first.run({ signal: aborted.signal }), { name: 'AbortError' }); assert.deepEqual(first.calls, []);
  for (const stage of ['getResources', 'readBytes', 'digestBytes']) {
    const f = fixture(), entered = deferred(), gate = deferred(), controller = new AbortController();
    const ports = { ...f.ports, readBytes: async (selected, { signal }) => { assert.equal(signal, controller.signal); return f.ports.readBytes(selected); } };
    const pending = f.run({ ...ports, signal: controller.signal, [stage]: async (...args) => { const value = await ports[stage](...args); entered.resolve(); await gate.promise; return value; } });
    await entered.promise; controller.abort(); gate.resolve(); await assert.rejects(pending, { name: 'AbortError' });
  }
});

test('port failures propagate without advancing to later operations or granting an audition brand', async () => {
  for (const stage of ['getResources', 'readBytes', 'digestBytes']) {
    const f = fixture(), failure = Error('Expected read failure');
    await assert.rejects(f.run({ [stage]: async () => { throw failure; } }), error => error === failure);
    assert.deepEqual(f.calls, ['catalog', 'bytes', 'digest'].slice(0, ['getResources', 'readBytes', 'digestBytes'].indexOf(stage)));
  }
  for (const key of ['getResources', 'readBytes', 'digestBytes', 'isCurrent']) {
    const f = fixture(); await assert.rejects(f.run({ [key]: null }), invalid); assert.deepEqual(f.calls, []);
  }
});
