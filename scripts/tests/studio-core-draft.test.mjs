import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const request = (operation, fields = {}) => ({ protocolVersion: 1, operation: `layoutDraft.${operation}`, ...fields });
const actor = (objectId, position = [0, 0]) => ({ objectId, position });
const positions = values => values.map(value => value.position);
const clean = { dirty: false, canUndo: false, canRedo: false };
const wasmBytes = await fs.readFile(new URL('../../engine/studio-core.wasm', import.meta.url));
const nativePath = process.env.VIENTO_STUDIO_CORE_BIN || fileURLToPath(new URL(`../../crates/viento-studio-core/target/debug/viento-core${process.platform === 'win32' ? '.exe' : ''}`, import.meta.url));
let nativeAvailable = true;
try { await fs.access(nativePath, fsConstants.X_OK); } catch { nativeAvailable = false; }
const nativeSkip = nativeAvailable ? false : `Native draft parity requires VIENTO_STUDIO_CORE_BIN or an executable at ${nativePath}.`;
let bridgeId = 0;
async function bridge() {
  const module = await import(new URL(`../../engine/studio-core.mjs?draft-contract=${++bridgeId}`, import.meta.url));
  await module.initializeStudioCore(() => wasmBytes);
  await module.ensureStudioCoreReady();
  return module;
}
async function rawWasm() {
  const { instance } = await WebAssembly.instantiate(wasmBytes, {}), api = instance.exports;
  const encoder = new TextEncoder(), decoder = new TextDecoder('utf-8', { fatal: true });
  return value => {
    const bytes = encoder.encode(typeof value === 'string' ? value : JSON.stringify(value));
    const inputPointer = api.viento_core_input(bytes.length) >>> 0;
    assert.ok(inputPointer && inputPointer + bytes.length <= api.memory.buffer.byteLength);
    new Uint8Array(api.memory.buffer, inputPointer, bytes.length).set(bytes);
    const outputPointer = api.viento_core_run() >>> 0, length = api.viento_core_output_len();
    assert.ok(outputPointer && length > 0 && outputPointer + length <= api.memory.buffer.byteLength);
    return JSON.parse(decoder.decode(new Uint8Array(api.memory.buffer, outputPointer, length)));
  };
}
async function nativeSequence(sequence) {
  return new Promise((resolve, reject) => {
    // All requests share one native registry; spawning once per request would
    // accidentally test fresh registries and hide history or handle bugs.
    const child = spawn(nativePath, [], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', failure = null;
    const timer = setTimeout(() => { failure = new Error('Native draft sequence timed out.'); child.kill('SIGKILL'); }, 30000);
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      stdout += chunk;
      if (Buffer.byteLength(stdout) > 16 * 1024 * 1024) { failure = new Error('Native draft response bound exceeded.'); child.kill('SIGKILL'); }
    });
    child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-4096); });
    child.stdin.on('error', error => { failure ||= error; });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      if (failure) return reject(failure);
      try {
        assert.equal(signal, null); assert.equal(code, 0, stderr);
        const responses = stdout.trim().split('\n').map(line => JSON.parse(line));
        assert.equal(responses.length, sequence.length);
        resolve(responses);
      } catch (error) { reject(error); }
    });
    child.stdin.end(sequence.map(value => typeof value === 'string' ? value : JSON.stringify(value)).join('\n') + '\n');
  });
}
function compact(value) {
  assert.equal(value.protocolVersion, 1); assert.equal(typeof value.ok, 'boolean');
  if (!value.ok) {
    assert.equal(typeof value.errorCode, 'string'); assert.equal(typeof value.message, 'string');
    assert.equal(Object.hasOwn(value, 'draft'), false, 'failed operations must not expose partial draft mutations');
    return { ok: false, errorCode: value.errorCode };
  }
  assert.deepEqual(Object.keys(value).sort(), ['draft', 'ok', 'protocolVersion']);
  const draft = value.draft;
  assert.equal(typeof draft.draftId, 'string'); assert.match(draft.draftId, /^[1-9][0-9]*$/);
  if (draft.closed === true) {
    assert.deepEqual(Object.keys(draft).sort(), ['closed', 'draftId']);
  } else {
    assert.deepEqual(Object.keys(draft).sort(), ['changed', 'draftId', 'positions', 'state']);
    assert.equal(typeof draft.changed, 'boolean'); assert.ok(Array.isArray(draft.positions));
    assert.deepEqual(Object.keys(draft.state).sort(), ['canRedo', 'canUndo', 'dirty']);
    for (const key of ['dirty', 'canUndo', 'canRedo']) assert.equal(typeof draft.state[key], 'boolean');
    for (const item of draft.positions) {
      assert.deepEqual(Object.keys(item).sort(), ['objectId', 'position']);
      assert.equal(typeof item.objectId, 'string'); assert.equal(item.position.length, 2);
      assert.ok(item.position.every(coordinate => Number.isFinite(coordinate) && Math.abs(coordinate) <= 100000));
    }
  }
  return { ok: true, draft };
}
function outcome(dispatch, value) { return compact(dispatch(value)); }
function assertDraft(response, expectedPositions, state, changed) {
  assert.equal(response.ok, true);
  assert.deepEqual(positions(response.draft.positions), expectedPositions);
  assert.deepEqual(response.draft.state, state); assert.equal(response.draft.changed, changed);
}
async function compareSequence(sequence) {
  const wasm = await rawWasm(), expected = sequence.map(value => outcome(wasm, value));
  const actual = (await nativeSequence(sequence)).map(compact);
  for (let index = 0; index < sequence.length; index++) assert.deepEqual(actual[index], expected[index], `sequence item ${index}: ${JSON.stringify(sequence[index]).slice(0, 200)}`);
  return expected;
}

function historySequence() {
  const a = actor('a', [10, 20]), b = actor('b', [30, 40]);
  return [
    request('create', { actors: [a, b] }), request('create', { actors: [a, b] }),
    request('setPositions', { draftId: '1', changes: [actor('a', [11, 21]), actor('b', [31, 41])] }),
    request('read', { draftId: '2' }), request('undo', { draftId: '1' }),
    request('setPositions', { draftId: '1', changes: [actor('a', [500, 600]), actor('b', [100001, 0])] }),
    request('setPositions', { draftId: '1', changes: [a, a] }),
    request('setPositions', { draftId: '1', changes: [actor('missing')] }),
    request('setPositions', { draftId: '1', changes: [a] }),
    request('setPositions', { draftId: '1', changes: [] }), request('read', { draftId: '1' }),
    request('redo', { draftId: '1' }), request('undo', { draftId: '1' }),
    request('setPositions', { draftId: '1', changes: [actor('b', [50, 60])] }), request('redo', { draftId: '1' }),
    request('reset', { draftId: '1' }), request('reset', { draftId: '1' }),
    request('setPositions', { draftId: '1', changes: [actor('a', [12, 22])] }), request('undo', { draftId: '1' }),
    request('reset', { draftId: '1' }), request('read', { draftId: '2' }),
    request('close', { draftId: '1' }), request('read', { draftId: '1' }), request('close', { draftId: '2' }),
  ];
}

test('Rust WASM draft registries isolate sessions and preserve atomic changes, redo branches, and reset state', async () => {
  const run = await rawWasm(), sequence = historySequence(), result = sequence.map(value => outcome(run, value));
  assertDraft(result[0], [[10, 20], [30, 40]], clean, false);
  assertDraft(result[2], [[11, 21], [31, 41]], { dirty: true, canUndo: true, canRedo: false }, true);
  assertDraft(result[3], [[10, 20], [30, 40]], clean, false);
  assertDraft(result[4], [[10, 20], [30, 40]], { dirty: false, canUndo: false, canRedo: true }, true);
  for (const index of [5, 6, 7]) assert.deepEqual(result[index], { ok: false, errorCode: 'scene_layout_position_invalid' });
  for (const index of [8, 9, 10]) assertDraft(result[index], [[10, 20], [30, 40]], { dirty: false, canUndo: false, canRedo: true }, false);
  assertDraft(result[11], [[11, 21], [31, 41]], { dirty: true, canUndo: true, canRedo: false }, true);
  assertDraft(result[13], [[10, 20], [50, 60]], { dirty: true, canUndo: true, canRedo: false }, true);
  assert.equal(result[14].draft.changed, false, 'a new branch discards the old redo');
  assertDraft(result[15], [[10, 20], [30, 40]], clean, true);
  assertDraft(result[16], [[10, 20], [30, 40]], clean, false);
  assertDraft(result[19], [[10, 20], [30, 40]], clean, true, 'reset also clears redo at the original coordinates');
  assertDraft(result[20], [[10, 20], [30, 40]], clean, false);
  assert.deepEqual(result[21].draft, { draftId: '1', closed: true });
  assert.deepEqual(result[22], { ok: false, errorCode: 'scene_layout_draft_invalid' });
});

test('native and WASM draft histories return identical responses within persistent registries', { skip: nativeSkip }, async () => {
  await compareSequence(historySequence());
});

function worstCaseSequence() {
  const actors = Array.from({ length: 128 }, (_, index) => actor(`actor-${index}`, [index, -index]));
  const sequence = [request('create', { actors })];
  for (let step = 1; step <= 101; step++) sequence.push(request('setPositions', { draftId: '1', changes: actors.map(({ objectId }, index) => actor(objectId, [index + step, -index - step])) }));
  for (let step = 0; step <= 100; step++) sequence.push(request('undo', { draftId: '1' }));
  sequence.push(request('read', { draftId: '1' }));
  for (let step = 0; step <= 100; step++) sequence.push(request('redo', { draftId: '1' }));
  sequence.push(request('reset', { draftId: '1' }), request('close', { draftId: '1' }));
  return sequence;
}
function assertWorstCase(result, sequence) {
  const undos = result.slice(102, 203);
  assert.equal(undos.filter(value => value.draft.changed).length, 100, 'history retains exactly one hundred atomic batches');
  assertDraft(undos.at(-1), Array.from({ length: 128 }, (_, index) => [index + 1, -index - 1]), { dirty: true, canUndo: false, canRedo: true }, false);
  const redos = result.slice(204, 305);
  assert.equal(redos.filter(value => value.draft.changed).length, 100);
  assertDraft(redos.at(-1), Array.from({ length: 128 }, (_, index) => [index + 101, -index - 101]), { dirty: true, canUndo: true, canRedo: false }, false);
  assertDraft(result.at(-2), Array.from({ length: 128 }, (_, index) => [index, -index || 0]), clean, true);
  for (let index = 0; index < result.length; index++) {
    assert.ok(Buffer.byteLength(JSON.stringify(result[index])) < 128 * 100 + 512, 'response size must depend on current positions, never retained journal length');
    assert.ok(Buffer.byteLength(JSON.stringify(sequence[index])) < 128 * 100 + 512, 'requests must not send old snapshots or author source');
  }
}

test('128-actor WASM drafts bound history at 100 batches without round-tripping journal or author source', async () => {
  const run = await rawWasm(), sequence = worstCaseSequence();
  assertWorstCase(sequence.map(value => outcome(run, value)), sequence);
});

test('native and WASM agree on 128-actor, 100-step retention, undo, redo, and reset', { skip: nativeSkip }, async () => {
  const sequence = worstCaseSequence(); assertWorstCase(await compareSequence(sequence), sequence);
});

function lifecycleSequence() {
  const sequence = [];
  for (let index = 0; index < 32; index++) sequence.push(request('create', { actors: [actor(`draft-${index}`)] }));
  sequence.push(request('create', { actors: [actor('overflow')] }), request('close', { draftId: '17' }),
    request('create', { actors: [actor('replacement')] }), request('read', { draftId: '17' }), request('close', { draftId: '17' }));
  for (const operation of ['read', 'setPositions', 'undo', 'redo', 'reset', 'close']) {
    for (const draftId of ['0', '01', '-1', '1.0', '', 1, '18446744073709551616']) sequence.push(request(operation, { draftId, ...(operation === 'setPositions' ? { changes: [] } : {}) }));
  }
  sequence.push(request('read', { draftId: '1' }));
  for (let index = 1; index <= 33; index++) if (index !== 17) sequence.push(request('close', { draftId: String(index) }));
  sequence.push(request('create', { actors: [actor('after-release')] }), request('close', { draftId: '34' }));
  return sequence;
}

test('WASM draft capacity is released on close, handles are monotonic, and stale or malformed handles fail', async () => {
  const run = await rawWasm(), sequence = lifecycleSequence(), result = sequence.map(value => outcome(run, value));
  assert.deepEqual(result[32], { ok: false, errorCode: 'scene_layout_draft_limit' });
  assert.equal(result[34].draft.draftId, '33', 'closed handles cannot be recycled');
  for (let index = 35; index < 79; index++) assert.deepEqual(result[index], { ok: false, errorCode: 'scene_layout_draft_invalid' }, `item ${index}`);
  assertDraft(result[79], [[0, 0]], clean, false);
  assert.equal(result.at(-2).draft.draftId, '34');
});

test('native and WASM share capacity, monotonic identity, and stale-handle contracts', { skip: nativeSkip }, async () => {
  await compareSequence(lifecycleSequence());
});

test('WASM draft creation bounds actor count and UTF-8 identity bytes without consuming failed handles', async () => {
  const run = await rawWasm();
  for (const actors of [[], Array.from({ length: 129 }, (_, index) => actor(String(index))), [actor('界'.repeat(43))], [actor('x'.repeat(129))], [actor('', [0, 0])]]) {
    assert.deepEqual(outcome(run, request('create', { actors })), { ok: false, errorCode: 'scene_layout_draft_limit' });
  }
  for (const actors of [[actor('same'), actor('same')], [actor('invalid', [null, 1])], [actor('invalid', [100001, 0])]]) {
    assert.deepEqual(outcome(run, request('create', { actors })), { ok: false, errorCode: 'scene_layout_position_invalid' });
  }
  const accepted = outcome(run, request('create', { actors: [actor('界'.repeat(42) + 'ab')] }));
  assert.equal(accepted.draft.draftId, '1'); assert.equal(Buffer.byteLength(accepted.draft.positions[0].objectId), 128);
  assert.deepEqual(outcome(run, request('close', { draftId: '1' })).draft, { draftId: '1', closed: true });
});

test('the actual JS draft bridge owns only a handle and current response, with defensive result copies and explicit release', async () => {
  const core = await bridge(), input = request('create', { actors: [actor('a', [10, 20]), actor('b', [30, 40])] });
  const created = core.dispatchStudioCoreDraft(input), id = created.draftId;
  try {
    input.actors[0].position[0] = 999; created.positions[0].position[0] = 888; created.state.dirty = true;
    const actual = core.dispatchStudioCoreDraft(request('read', { draftId: id }));
    assert.deepEqual(actual.positions, [actor('a', [10, 20]), actor('b', [30, 40])]); assert.deepEqual(actual.state, clean);
    const changed = core.dispatchStudioCoreDraft(request('setPositions', { draftId: id, changes: [actor('b', [35, 45])] }));
    assert.equal(changed.changed, true); assert.deepEqual(Object.keys(changed).sort(), ['changed', 'draftId', 'positions', 'state']);
    let called = 0;
    const getter = request('setPositions', { draftId: id });
    Object.defineProperty(getter, 'changes', { enumerable: true, get() { called++; return []; } });
    for (const invalid of [getter, request('setPositions', { draftId: id, changes: [actor('a', [Infinity, 0])] }), request('setPositions', { draftId: id, changes: [actor('a', Array(2))] })]) {
      assert.throws(() => core.dispatchStudioCoreDraft(invalid), { errorCode: 'studio_core_request_invalid' });
    }
    assert.equal(called, 0); assert.equal(core.getStudioCoreMetadata().ready, true);
    assert.deepEqual(core.dispatchStudioCoreDraft(request('read', { draftId: id })).positions, [actor('a', [10, 20]), actor('b', [35, 45])]);
  } finally { assert.deepEqual(core.dispatchStudioCoreDraft(request('close', { draftId: id })), { draftId: id, closed: true }); }
  assert.throws(() => core.dispatchStudioCoreDraft(request('read', { draftId: id })), { errorCode: 'scene_layout_draft_invalid' });
});

async function responseBridge(response) {
  const module = await import(new URL(`../../engine/studio-core.mjs?draft-invalid-response=${++bridgeId}`, import.meta.url));
  const memory = new WebAssembly.Memory({ initial: 32 }), encoded = new TextEncoder().encode(JSON.stringify(response));
  const instantiate = WebAssembly.instantiate;
  try {
    WebAssembly.instantiate = async () => ({ instance: { exports: {
      memory, viento_core_protocol_version: () => 1, viento_core_input: () => 16,
      viento_core_run: () => { new Uint8Array(memory.buffer, 1048576, encoded.length).set(encoded); return 1048576; },
      viento_core_output_len: () => encoded.length,
    } } });
    await module.initializeStudioCore(() => new Uint8Array([1]));
  } finally { WebAssembly.instantiate = instantiate; }
  return module;
}

test('the draft bridge fails closed on incompatible response versions and malformed state envelopes', async () => {
  const draft = { draftId: '1', positions: [actor('a')], state: clean, changed: false };
  const responses = [
    { protocolVersion: 2, ok: true, draft }, { protocolVersion: 1, ok: true, changes: [] },
    { protocolVersion: 1, ok: true, draft: { ...draft, state: { ...clean, dirty: 0 } } },
    { protocolVersion: 1, ok: true, draft: { ...draft, positions: [actor('a', [null, 0])] } },
    { protocolVersion: 1, ok: true, draft: { ...draft, positions: [actor('a'), actor('a')] } },
    { protocolVersion: 1, ok: true, draft: { ...draft, positions: [actor('a', [100001, 0])] } },
    { protocolVersion: 1, ok: true, draft: { ...draft, journal: [] } },
    { protocolVersion: 1, ok: true, draft: { ...draft, draftId: 1 } },
    { protocolVersion: 1, ok: true, draft: { ...draft, changed: 'false' } },
    { protocolVersion: 1, ok: false, errorCode: 'bad-code', message: 'Invalid' },
  ];
  for (const response of responses) {
    const core = await responseBridge(response);
    assert.throws(() => core.dispatchStudioCoreDraft(request('create', { actors: [actor('a')] })), { errorCode: 'studio_core_unavailable' }, JSON.stringify(response));
    assert.equal(core.getStudioCoreMetadata().ready, false);
    assert.throws(() => core.dispatchStudioCoreDraft(request('create', { actors: [actor('b')] })), { errorCode: 'studio_core_unavailable' });
  }
});

test('stateful WASM ABI consumes each input once and cannot replay create, undo, or close', async () => {
  const { instance } = await WebAssembly.instantiate(wasmBytes, {}), api = instance.exports;
  const encoder = new TextEncoder(), decoder = new TextDecoder('utf-8', { fatal: true });
  const run = () => {
    const pointer = api.viento_core_run() >>> 0, length = api.viento_core_output_len();
    assert.ok(pointer && length > 0 && pointer + length <= api.memory.buffer.byteLength);
    return compact(JSON.parse(decoder.decode(new Uint8Array(api.memory.buffer, pointer, length))));
  };
  const send = value => {
    const bytes = encoder.encode(JSON.stringify(value)), pointer = api.viento_core_input(bytes.length) >>> 0;
    assert.ok(pointer); new Uint8Array(api.memory.buffer, pointer, bytes.length).set(bytes); return run();
  };
  const invalid = { ok: false, errorCode: 'studio_core_request_invalid' };
  assert.deepEqual(run(), invalid);
  assert.equal(send(request('create', { actors: [actor('a')] })).draft.draftId, '1');
  assert.deepEqual(run(), invalid, 'repeat ABI calls cannot create untracked registry entries');
  assert.equal(send(request('create', { actors: [actor('b')] })).draft.draftId, '2');
  send(request('setPositions', { draftId: '1', changes: [actor('a', [1, 2])] }));
  send(request('setPositions', { draftId: '1', changes: [actor('a', [3, 4])] }));
  assertDraft(send(request('undo', { draftId: '1' })), [[1, 2]], { dirty: true, canUndo: true, canRedo: true }, true);
  assert.deepEqual(run(), invalid, 'repeat ABI calls cannot undo a second history item');
  assertDraft(send(request('read', { draftId: '1' })), [[1, 2]], { dirty: true, canUndo: true, canRedo: true }, false);
  for (const length of [0, 1024 * 1024 + 1, 0xffffffff]) {
    assert.equal(api.viento_core_input(length), 0);
    assert.deepEqual(run(), { ok: false, errorCode: length ? 'studio_core_input_limit' : 'studio_core_request_invalid' });
    assert.deepEqual(run(), invalid, 'invalid allocations are also consumed once');
    assertDraft(send(request('read', { draftId: '1' })), [[1, 2]], { dirty: true, canUndo: true, canRedo: true }, false);
  }
  assert.deepEqual(send(request('close', { draftId: '1' })).draft, { draftId: '1', closed: true });
  assert.deepEqual(run(), invalid, 'repeat ABI calls cannot close a stale handle');
  assert.deepEqual(send(request('read', { draftId: '1' })), { ok: false, errorCode: 'scene_layout_draft_invalid' });
  assertDraft(send(request('read', { draftId: '2' })), [[0, 0]], clean, false);
  assert.deepEqual(send(request('close', { draftId: '2' })).draft, { draftId: '2', closed: true });
});

test('native and WASM reject malformed messages without losing an existing draft or its redo branch', { skip: nativeSkip }, async () => {
  const sequence = [request('create', { actors: [actor('a')] }), request('setPositions', { draftId: '1', changes: [actor('a', [1, 2])] }),
    request('undo', { draftId: '1' }), '{malformed', { protocolVersion: 2, operation: 'layoutDraft.reset', draftId: '1' },
    request('read', { draftId: '1' }), request('redo', { draftId: '1' }), request('close', { draftId: '1' })];
  const result = await compareSequence(sequence);
  for (const index of [3, 4]) assert.deepEqual(result[index], { ok: false, errorCode: 'studio_core_request_invalid' });
  assertDraft(result[5], [[0, 0]], { dirty: false, canUndo: false, canRedo: true }, false);
  assertDraft(result[6], [[1, 2]], { dirty: true, canUndo: true, canRedo: false }, true);
});
