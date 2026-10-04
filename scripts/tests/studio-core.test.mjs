import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { STUDIO_CORE_PROTOCOL_VERSION, dispatchStudioCore, ensureStudioCoreReady, getStudioCoreMetadata } from '../../engine/studio-core.mjs';
import { createSceneLayoutDraft } from '../../engine/scene-layout.mjs';

const request = (operation, fields = {}) => ({ protocolVersion: 1, operation, ...fields });
const actor = (objectId, position, size = [80, 60]) => ({ objectId, position, size });
const actors = [actor('first', [101.25, 205.5]), actor('second', [310.75, 300.25], [40, 20]), actor('outside', [20, 20], [10, 10])];
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
const roundedPositions = changes => changes.map(change => change.position);
const nativePath = process.env.VIENTO_STUDIO_CORE_BIN || fileURLToPath(new URL(`../../crates/viento-studio-core/target/debug/viento-core${process.platform === 'win32' ? '.exe' : ''}`, import.meta.url));
let nativeAvailable = true;
try { await fs.access(nativePath, fsConstants.X_OK); } catch { nativeAvailable = false; }
const nativeSkip = nativeAvailable ? false : `Native Rust parity requires VIENTO_STUDIO_CORE_BIN or an executable at ${nativePath}; WASM tests still run.`;
async function nativeResponses(input) {
  const text = typeof input === 'string' ? input : JSON.stringify(input);
  // End stdin explicitly: the JSON-lines process continues until EOF. Async
  // pipes also avoid spawnSync retaining the writer in restricted Node hosts.
  const result = await new Promise((resolve, reject) => {
    const child = spawn(nativePath, [], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', failure = null;
    const timer = setTimeout(() => { failure = new Error('Native core timed out.'); child.kill('SIGKILL'); }, 10000);
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', value => { stdout += value; if (Buffer.byteLength(stdout) > 4 * 1024 * 1024) { failure = new Error('Native response exceeds test output bound.'); child.kill('SIGKILL'); } });
    child.stderr.on('data', value => { stderr = (stderr + value).slice(-4096); });
    child.stdin.on('error', error => { failure ||= error; });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', (status, signal) => { clearTimeout(timer); if (failure) reject(failure); else resolve({ status, signal, stdout, stderr }); });
    child.stdin.end(text.endsWith('\n') ? text : text + '\n');
  });
  assert.equal(result.signal, null, 'native core must not crash or time out');
  assert.equal(result.status, 0, `native status ${result.status}: ${result.stderr}`);
  try { return result.stdout.trim().split('\n').map(line => JSON.parse(line)); }
  catch { assert.fail(`Native core did not return JSON-lines responses: ${result.stdout.slice(0, 200)} ${result.stderr.slice(0, 200)}`); }
}
async function nativeResponse(input) {
  const responses = await nativeResponses(input); assert.equal(responses.length, 1); return responses[0];
}
function wasmOutcome(value) {
  try { return { ok: true, changes: dispatchStudioCore(value) }; }
  catch (error) { assert.equal(typeof error.errorCode, 'string'); return { ok: false, errorCode: error.errorCode }; }
}
function compactOutcome(value) {
  assert.equal(value.protocolVersion, 1); assert.equal(typeof value.ok, 'boolean');
  if (value.ok) { assert.ok(Array.isArray(value.changes)); return { ok: true, changes: value.changes }; }
  assert.equal(typeof value.errorCode, 'string'); assert.equal(Object.hasOwn(value, 'changes'), false, 'failed native batches cannot expose partial changes');
  return { ok: false, errorCode: value.errorCode };
}

const knownRequests = [
  request('move', { actors, ids: ['first', 'second'], delta: [10.4, -4.6], snap: 0 }),
  request('move', { actors, ids: ['first', 'second'], delta: [10.4, -4.6], snap: 32 }),
  request('move', { actors, ids: ['second', 'first'], delta: [10.4, -4.6], snap: 32 }),
  request('move', { actors, ids: [], delta: [1, 2], snap: 0 }),
  request('move', { actors: [actor('half', [0, 0])], ids: ['half'], delta: [-0.5, -1.5], snap: 0 }),
  request('move', { actors: [actor('half', [0, 0])], ids: ['half'], delta: [-16, -48], snap: 32 }),
  request('move', { actors: [actor('a', [-90000, 90000]), actor('b', [90000, -90000])], ids: ['a', 'b'], delta: [Number.MAX_VALUE, -Number.MAX_VALUE], snap: 32 }),
  request('move', { actors: [actor('a', [-90690.61234776235, 0]), actor('b', [-77737.83179106213, 0])], ids: ['a', 'b'], delta: [1000000, 0], snap: 0 }),
  request('move', { actors: [actor('a', [-90000, 90000]), actor('b', [90000, -90000])], ids: ['a', 'b'], delta: [1, 1], snap: Number.MIN_VALUE }),
  ...['left', 'center', 'right', 'top', 'middle', 'bottom'].map(alignment => request('align', { actors, ids: ['first', 'second'], alignment })),
  request('validateBatch', { actors, changes: [{ objectId: 'first', position: [100000, -100000] }, { objectId: 'second', position: [-1.5, 2.25] }] }),
  request('validateBatch', { actors, changes: [] }),
  request('move', { actors, ids: ['first', 'first'], delta: [1, 2], snap: 0 }),
  request('move', { actors, ids: ['missing'], delta: [1, 2], snap: 0 }),
  request('move', { actors, ids: ['first'], delta: [null, 2], snap: 0 }),
  request('move', { actors, ids: ['first'], delta: [1, 2], snap: -1 }),
  request('align', { actors, ids: ['first'], alignment: 'distribute' }),
  request('validateBatch', { actors, changes: [{ objectId: 'first', position: [50, 60] }, { objectId: 'second', position: [100001, 0] }] }),
  request('validateBatch', { actors, changes: [{ objectId: 'first', position: [50, 60] }, { objectId: 'first', position: [70, 80] }] }),
  request('unknown'), { protocolVersion: 2, operation: 'move', actors, ids: ['first'], delta: [1, 2], snap: 0 },
];

// Fixed seed and quarter-unit source positions make failures reproducible. A
// mix of near-boundary actors and very large deltas exercises group clamping.
function deterministicRequests() {
  let seed = 0x4f434944;
  const next = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed; };
  const values = [];
  for (let index = 0; index < 36; index++) {
    const group = Array.from({ length: 2 + index % 3 }, (_, i) => actor(`随机-${index}-${i}`, [(next() % 800001 - 400000) / 4, (next() % 800001 - 400000) / 4], [1 + next() % 400, 1 + next() % 400]));
    if (index % 4 === 0) group[0].position[index % 2] = index % 8 ? 99999.75 : -99999.75;
    const ids = group.map(value => value.objectId); if (index % 2) ids.reverse();
    const magnitude = index % 3 ? 300000 : Number.MAX_VALUE;
    values.push(request('move', { actors: group, ids, delta: [index % 2 ? magnitude : -magnitude, (next() % 2001 - 1000) / 2], snap: [0, 32, 0.125, Number.MIN_VALUE][index % 4] }));
    if (index % 3 === 0) values.push(request('align', { actors: group, ids, alignment: ['left', 'center', 'right', 'top', 'middle', 'bottom'][index / 3 % 6] }));
  }
  return values;
}

test('studio core loads a real standalone Rust WASM module and exposes protocol metadata', async () => {
  await ensureStudioCoreReady();
  assert.equal(STUDIO_CORE_PROTOCOL_VERSION, 1);
  assert.deepEqual(getStudioCoreMetadata(), { protocolVersion: 1, backend: 'rust-wasm', ready: true });
  const bytes = await fs.readFile(new URL('../../engine/studio-core.wasm', import.meta.url));
  assert.equal(WebAssembly.validate(bytes), true);
  const module = await WebAssembly.compile(bytes);
  assert.deepEqual(WebAssembly.Module.imports(module), [], 'the mathematical core needs no host filesystem, browser, or runtime imports');
  const exports = WebAssembly.Module.exports(module);
  assert.ok(exports.some(item => item.name === 'memory' && item.kind === 'memory'));
  for (const name of ['viento_core_protocol_version', 'viento_core_input', 'viento_core_run', 'viento_core_output_len']) assert.ok(exports.some(item => item.name === name && item.kind === 'function'), name);
});

test('WASM group motion preserves input order, fractional spacing, anchor snapping, and caller data', () => {
  const input = freeze(structuredClone(knownRequests[0])), before = JSON.stringify(input);
  assert.deepEqual(dispatchStudioCore(input), [{ objectId: 'first', position: [111.25, 200.5] }, { objectId: 'second', position: [320.75, 295.25] }]);
  assert.deepEqual(dispatchStudioCore(knownRequests[1]), [{ objectId: 'first', position: [96, 192] }, { objectId: 'second', position: [305.5, 286.75] }]);
  assert.deepEqual(dispatchStudioCore(knownRequests[2]), [{ objectId: 'second', position: [320, 288] }, { objectId: 'first', position: [110.5, 193.25] }]);
  const changes = dispatchStudioCore(input); changes[0].position[0] = 999; assert.equal(JSON.stringify(input), before);
  assert.deepEqual(dispatchStudioCore(knownRequests[3]), []);
});

test('WASM rounding follows JavaScript negative halfway behavior and accepts subnormal snap sizes', () => {
  assert.deepEqual(roundedPositions(dispatchStudioCore(knownRequests[4])), [[0, -1]]);
  assert.deepEqual(roundedPositions(dispatchStudioCore(knownRequests[5])), [[0, -32]]);
  assert.deepEqual(roundedPositions(dispatchStudioCore(knownRequests[8])), [[-89999, 90001], [90001, -89999]]);
});

test('WASM boundary movement applies one bounded displacement without squeezing the group', () => {
  assert.deepEqual(roundedPositions(dispatchStudioCore(knownRequests[6])), [[-80000, 80000], [100000, -100000]]);
  const source = knownRequests[7], result = dispatchStudioCore(source);
  assert.ok(result.every(item => item.position.every(value => Number.isFinite(value) && Math.abs(value) <= 100000)));
  assert.ok(Math.abs((result[1].position[0] - result[0].position[0]) - (source.actors[1].position[0] - source.actors[0].position[0])) < 1e-9);
});

test('WASM six-way alignment uses each full size and refuses the entire overflowing result', () => {
  const group = [actor('a', [100, 200], [80, 60]), actor('b', [300, 250], [40, 100])];
  const expected = { left: [[100, 200], [80, 250]], center: [[190, 200], [190, 250]], right: [[280, 200], [300, 250]],
    top: [[100, 200], [300, 220]], middle: [[100, 235], [300, 235]], bottom: [[100, 270], [300, 250]] };
  for (const [alignment, positions] of Object.entries(expected)) {
    assert.deepEqual(roundedPositions(dispatchStudioCore(request('align', { actors: group, ids: ['a', 'b'], alignment }))), positions);
    assert.deepEqual(roundedPositions(dispatchStudioCore(request('align', { actors: group, ids: ['b', 'a'], alignment }))), [...positions].reverse());
  }
  const overflow = request('align', { actors: [actor('a', [-99990, 0], [100, 60]), actor('b', [0, 0], [20, 20])], ids: ['a', 'b'], alignment: 'left' });
  assert.throws(() => dispatchStudioCore(overflow), { errorCode: 'scene_layout_position_invalid' });
});

test('WASM rejects unsupported protocols and commands instead of silently selecting a fallback', () => {
  for (const value of [null, [], {}, { operation: 'move' }, { protocolVersion: '1', operation: 'move' }, { protocolVersion: 0, operation: 'move' }, request('unknown')]) {
    assert.throws(() => dispatchStudioCore(value), { errorCode: 'studio_core_request_invalid' });
  }
  assert.throws(() => dispatchStudioCore(request('align', { actors, ids: ['first'], alignment: 'distribute' })), { errorCode: 'scene_layout_alignment_invalid' });
});

test('WASM rejects malformed geometry and transport-only non-JSON values before they can become null or disappear', () => {
  for (const values of [{ ids: ['first', 'first'] }, { ids: ['missing'] }, { ids: [null] }, { delta: [null, 1] }, { delta: ['1', 2] }, { delta: [1] }, { snap: -1 }, { snap: 100001 }]) {
    assert.throws(() => dispatchStudioCore(request('move', { actors, ids: ['first'], delta: [1, 2], snap: 0, ...values })), { errorCode: 'scene_layout_position_invalid' });
  }
  for (const malformed of [NaN, Infinity, -Infinity, undefined, 1n, () => {}]) {
    assert.throws(() => dispatchStudioCore(request('move', { actors, ids: ['first'], delta: [malformed, 1], snap: 0 })), { errorCode: 'studio_core_request_invalid' });
  }
  assert.throws(() => dispatchStudioCore(request('move', { actors, ids: ['first'], delta: Array(2), snap: 0 })), { errorCode: 'studio_core_request_invalid' });
  const circular = request('move', { actors, ids: ['first'], delta: [1, 2], snap: 0 }); circular.self = circular;
  assert.throws(() => dispatchStudioCore(circular), { errorCode: 'studio_core_request_invalid' });
});

test('WASM input has a one MiB byte limit including multi-byte object identities', () => {
  const id = '界'.repeat(200000);
  assert.throws(() => dispatchStudioCore(request('move', { actors: [actor(id, [0, 0])], ids: [id], delta: [1, 2], snap: 0 })), { errorCode: 'studio_core_input_limit' });
  assert.deepEqual(dispatchStudioCore(knownRequests[0]), [{ objectId: 'first', position: [111.25, 200.5] }, { objectId: 'second', position: [320.75, 295.25] }], 'a rejected large input does not poison the next dispatch');
});

test('WASM validates a complete position batch before publishing any change', () => {
  const input = freeze(structuredClone(knownRequests[15])), before = JSON.stringify(input);
  assert.deepEqual(dispatchStudioCore(input), input.changes); assert.equal(JSON.stringify(input), before);
  assert.deepEqual(dispatchStudioCore(knownRequests[16]), []);
  for (const changes of [
    [{ objectId: 'first', position: [1, 2] }, { objectId: 'second', position: [100001, 0] }],
    [{ objectId: 'first', position: [1, 2] }, { objectId: 'first', position: [3, 4] }],
    [{ objectId: 'first', position: [1, 2] }, { objectId: 'missing', position: [3, 4] }],
    [{ objectId: 'first', position: [1, 2], size: [80, 60] }],
  ]) assert.throws(() => dispatchStudioCore(request('validateBatch', { actors, changes })), { errorCode: 'scene_layout_position_invalid' });
  assert.deepEqual(dispatchStudioCore(input), input.changes, 'failed batches have no retained partial state');
});

test('Rust-backed batch validation leaves the editor draft and redo history untouched on a later invalid actor', () => {
  const a = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', b = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', sceneId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const revision = 'sha256:' + '1'.repeat(64), declaration = { format: 'viento-scene2d', schemaVersion: 1, title: 'Atomic draft', viewport: [640, 480], background: '#101827', actors: [
    { objectId: a, position: [10, 20], useProjectionDefaults: true, imageResourceId: null }, { objectId: b, position: [30, 40], useProjectionDefaults: true },
  ] };
  const content = '\uFEFF' + JSON.stringify(declaration, null, '\t').replaceAll('\n', '\r\n') + '\r\n';
  const draft = createSceneLayoutDraft({ scene: { objectId: sceneId, sourcePath: 'documents/scenes/atomic.json', sourceRevision: revision }, actors: declaration.actors.map(value => ({ ...value, size: [80, 60] })),
    sceneEditing: { worldId: 'world:test', baseRevision: revision, objectRevision: revision, sourceRevision: revision, content } });
  assert.ok(draft);
  try {
    draft.setPositions([{ objectId: a, position: [11, 21] }, { objectId: b, position: [31, 41] }]); assert.equal(draft.undo(), true);
    const before = draft.state(); assert.equal(before.canRedo, true);
    assert.throws(() => draft.setPositions([{ objectId: a, position: [500, 600] }, { objectId: b, position: [0, 100001] }]), { errorCode: 'scene_layout_position_invalid' });
    assert.equal(draft.command().content, content); assert.deepEqual(draft.state(), before); assert.deepEqual(draft.currentPosition(a), [10, 20]);
    assert.equal(draft.redo(), true); assert.deepEqual(draft.actors().map(value => value.position), [[11, 21], [31, 41]]);
  } finally { draft.dispose(); }
});

test('native Rust and real WASM return identical results for fixed edge cases and seeded boundary samples', { skip: nativeSkip }, async () => {
  const samples = [...knownRequests, ...deterministicRequests()];
  for (const [index, value] of samples.entries()) {
    const before = JSON.stringify(value), expected = wasmOutcome(value), actual = compactOutcome(await nativeResponse(value));
    assert.deepEqual(actual, expected, `sample ${index}: ${before}`); assert.equal(JSON.stringify(value), before);
    if (actual.ok) assert.ok(actual.changes.every(change => change.position.every(coordinate => Number.isFinite(coordinate) && Math.abs(coordinate) <= 100000)), `bounded sample ${index}`);
  }
});

test('native JSON transport rejects corrupt documents and oversized UTF-8 inputs without partial results', { skip: nativeSkip }, async () => {
  for (const input of ['', '{', '{"protocolVersion":1,"operation":', 'null', '[]', '{"protocolVersion":2,"operation":"move"}']) {
    assert.deepEqual(compactOutcome(await nativeResponse(input)), { ok: false, errorCode: 'studio_core_request_invalid' });
  }
  const id = '界'.repeat(200000), large = request('move', { actors: [actor(id, [0, 0])], ids: [id], delta: [1, 2], snap: 0 });
  assert.deepEqual(compactOutcome(await nativeResponse(large)), { ok: false, errorCode: 'studio_core_input_limit' });
});


test('real WASM ABI handles owned memory, invalid UTF-8 and allocation limits without replaying old commands', async () => {
  const bytes = await fs.readFile(new URL('../../engine/studio-core.wasm', import.meta.url));
  const { instance } = await WebAssembly.instantiate(bytes, {}), api = instance.exports, encoder = new TextEncoder(), decoder = new TextDecoder('utf-8', { fatal: true });
  assert.equal(api.viento_core_protocol_version(), 1);
  const run = () => {
    const pointer = api.viento_core_run() >>> 0, length = api.viento_core_output_len();
    assert.ok(pointer && length && pointer + length <= api.memory.buffer.byteLength);
    return JSON.parse(decoder.decode(new Uint8Array(api.memory.buffer, pointer, length)));
  };
  const input = value => {
    const data = value instanceof Uint8Array ? value : encoder.encode(typeof value === 'string' ? value : JSON.stringify(value));
    const pointer = api.viento_core_input(data.byteLength) >>> 0;
    if (data.byteLength) { assert.ok(pointer && pointer + data.byteLength <= api.memory.buffer.byteLength); new Uint8Array(api.memory.buffer, pointer, data.byteLength).set(data); }
    else assert.equal(pointer, 0);
    return compactOutcome(run());
  };
  assert.deepEqual(compactOutcome(run()), { ok: false, errorCode: 'studio_core_request_invalid' }, 'uninitialized input cannot execute');
  assert.deepEqual(input(knownRequests[0]), wasmOutcome(knownRequests[0]));
  for (const malformed of ['', '{', 'null', '[]', new Uint8Array([0xff, 0xfe]), '{"protocolVersion":1e999,"operation":"move"}']) {
    assert.deepEqual(input(malformed), { ok: false, errorCode: 'studio_core_request_invalid' });
  }
  // This grows owned input storage; reading output uses the current buffer,
  // never a detached pre-growth view of WASM memory.
  assert.deepEqual(input(request('move', { actors: [], ids: [], delta: [0, 0], padding: 'x'.repeat(900000) })), { ok: true, changes: [] });
  for (const length of [1024 * 1024 + 1, 0xffffffff, 0]) {
    assert.equal(api.viento_core_input(length), 0);
    assert.deepEqual(compactOutcome(run()), { ok: false, errorCode: length ? 'studio_core_input_limit' : 'studio_core_request_invalid' });
  }
  assert.deepEqual(input(knownRequests[1]), wasmOutcome(knownRequests[1]), 'valid requests recover after rejected input allocation');
});

test('native JSON-lines transport recovers after invalid and oversized messages within one process', { skip: nativeSkip }, async () => {
  const line = JSON.stringify(knownRequests[0]), huge = JSON.stringify({ payload: 'x'.repeat(1024 * 1024) });
  const outcomes = (await nativeResponses([line, '{invalid', huge, line].join('\n'))).map(compactOutcome);
  assert.deepEqual(outcomes, [wasmOutcome(knownRequests[0]), { ok: false, errorCode: 'studio_core_request_invalid' },
    { ok: false, errorCode: 'studio_core_input_limit' }, wasmOutcome(knownRequests[0])]);
});

test('the WASM bridge rejects serializers and accessors without executing caller code', () => {
  let called = 0;
  const getter = request('move', { actors, ids: ['first'], delta: [1, 2] });
  Object.defineProperty(getter, 'snap', { enumerable: true, get() { called++; return 0; } });
  const custom = request('move', { actors, ids: ['first'], delta: [1, 2], toJSON() { called++; return {}; } });
  for (const value of [getter, custom]) assert.throws(() => dispatchStudioCore(value), { errorCode: 'studio_core_request_invalid' });
  assert.equal(called, 0);
});


test('the actual Node adapter remains importable and fails closed when the shipped WASM is missing or corrupted', async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-core-load-failure-'));
  try {
    const original = await fs.readFile(new URL('../../engine/studio-core.wasm', import.meta.url));
    const corrupted = Buffer.from(original); corrupted[0] ^= 0xff;
    for (const mode of ['missing', 'corrupted']) {
      const directory = path.join(temporary, mode), engineDirectory = path.join(directory, 'engine'), adapterDirectory = path.join(directory, 'scripts', 'adapters');
      await fs.mkdir(engineDirectory, { recursive: true }); await fs.mkdir(adapterDirectory, { recursive: true });
      const loaderPath = path.join(engineDirectory, 'studio-core.mjs'), adapterPath = path.join(adapterDirectory, 'node-studio-core.mjs');
      await fs.copyFile(new URL('../../engine/studio-core.mjs', import.meta.url), loaderPath);
      await fs.copyFile(new URL('../adapters/node-studio-core.mjs', import.meta.url), adapterPath);
      if (mode === 'corrupted') await fs.writeFile(path.join(engineDirectory, 'studio-core.wasm'), corrupted);
      // Preserve the production engine/adapter paths and execute their actual
      // initialization. Filesystem and WebAssembly methods are not mocked.
      await import(pathToFileURL(adapterPath).href);
      const loader = await import(pathToFileURL(loaderPath).href);
      assert.deepEqual(loader.getStudioCoreMetadata(), { protocolVersion: 1, backend: 'rust-wasm', ready: false, errorCode: 'studio_core_unavailable' }, mode);
      await assert.rejects(loader.ensureStudioCoreReady(), { errorCode: 'studio_core_unavailable' });
      assert.throws(() => loader.dispatchStudioCore(request('move', { actors: [], ids: [], delta: [0, 0] })), { errorCode: 'studio_core_unavailable' });
      assert.throws(() => loader.dispatchStudioCoreDraft(request('layoutDraft.create', { actors: [actor('a', [0, 0])] })), { errorCode: 'studio_core_unavailable' });
      assert.equal(loader.getStudioCoreMetadata().ready, false);
    }
    assert.equal(getStudioCoreMetadata().ready, true, 'failed isolated copies do not poison the working runtime');
  } finally { await fs.rm(temporary, { recursive: true, force: true }); }
});
