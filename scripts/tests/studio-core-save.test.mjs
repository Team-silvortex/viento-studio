import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const actor = (position = [0, 0]) => ({ objectId: 'actor', position });
const draft = (operation, fields = {}) => ({ protocolVersion: 1, operation: `layoutDraft.${operation}`, draftId: '1', ...fields });
const save = (operation, fields = {}) => ({ protocolVersion: 1, operation: `layoutSave.${operation}`, draftId: '1', ...fields });
const begin = (action, fields = {}) => save('begin', { action, editable: true, inputPending: false, ...fields });
const resolve = (requestId, outcome, fields = {}) => save('resolve', { requestId, outcome, ...fields });
const create = () => ({ protocolVersion: 1, operation: 'layoutDraft.create', actors: [actor()] });
const move = (position = [10, 20], fields = {}) => draft('setPositions', { changes: [actor(position)], ...fields });
const phases = ['editing', 'checking', 'reviewed', 'applying', 'uncertain', 'verifying', 'refreshing', 'saved', 'conflict'];
const busyPhases = ['checking', 'applying', 'verifying', 'refreshing'];
const state = (phase, requestId = null) => ({ phase, requestId, busy: busyPhases.includes(phase), editable: ['editing', 'reviewed'].includes(phase),
  reviewed: phase === 'reviewed', saved: ['refreshing', 'saved'].includes(phase), conflict: phase === 'conflict', uncertain: ['uncertain', 'verifying'].includes(phase) });
const wasmBytes = await fs.readFile(new URL('../../engine/studio-core.wasm', import.meta.url));
const nativePath = process.env.VIENTO_STUDIO_CORE_BIN || fileURLToPath(new URL(`../../crates/viento-studio-core/target/debug/viento-core${process.platform === 'win32' ? '.exe' : ''}`, import.meta.url));
let nativeAvailable = true;
try { await fs.access(nativePath, fsConstants.X_OK); } catch { nativeAvailable = false; }
const nativeSkip = nativeAvailable ? false : `Native save-state parity requires VIENTO_STUDIO_CORE_BIN or an executable at ${nativePath}.`;
let bridgeId = 0;
async function bridge() {
  const module = await import(new URL(`../../engine/studio-core.mjs?save-contract=${++bridgeId}`, import.meta.url));
  await module.initializeStudioCore(() => wasmBytes); await module.ensureStudioCoreReady(); return module;
}
async function rawWasm() {
  const { instance } = await WebAssembly.instantiate(wasmBytes, {}), api = instance.exports;
  const encoder = new TextEncoder(), decoder = new TextDecoder('utf-8', { fatal: true });
  return value => {
    const bytes = encoder.encode(typeof value === 'string' ? value : JSON.stringify(value)), inputPointer = api.viento_core_input(bytes.length) >>> 0;
    assert.ok(inputPointer && inputPointer + bytes.length <= api.memory.buffer.byteLength);
    new Uint8Array(api.memory.buffer, inputPointer, bytes.length).set(bytes);
    const outputPointer = api.viento_core_run() >>> 0, length = api.viento_core_output_len();
    assert.ok(outputPointer && length > 0 && outputPointer + length <= api.memory.buffer.byteLength);
    return JSON.parse(decoder.decode(new Uint8Array(api.memory.buffer, outputPointer, length)));
  };
}
async function nativeSequence(sequence) {
  return new Promise((accept, reject) => {
    const child = spawn(nativePath, [], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', failure = null;
    const timer = setTimeout(() => { failure = new Error('Native save-state sequence timed out.'); child.kill('SIGKILL'); }, 30000);
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { stdout += chunk; if (Buffer.byteLength(stdout) > 8 * 1024 * 1024) { failure = new Error('Native response limit exceeded.'); child.kill('SIGKILL'); } });
    child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-4096); });
    child.stdin.on('error', error => { failure ||= error; });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', (code, signal) => {
      clearTimeout(timer); if (failure) return reject(failure);
      try {
        assert.equal(signal, null); assert.equal(code, 0, stderr);
        const responses = stdout.trim().split('\n').map(line => JSON.parse(line));
        assert.equal(responses.length, sequence.length); accept(responses);
      } catch (error) { reject(error); }
    });
    child.stdin.end(sequence.map(value => typeof value === 'string' ? value : JSON.stringify(value)).join('\n') + '\n');
  });
}
function envelope(value) {
  assert.equal(value.protocolVersion, 1); assert.equal(typeof value.ok, 'boolean');
  if (!value.ok) {
    assert.equal(typeof value.errorCode, 'string'); assert.equal(typeof value.message, 'string');
    assert.equal(Object.hasOwn(value, 'save'), false); assert.equal(Object.hasOwn(value, 'draft'), false);
  } else if (value.save) {
    assert.deepEqual(Object.keys(value).sort(), ['ok', 'protocolVersion', 'save']);
    assert.deepEqual(Object.keys(value.save).sort(), ['draftId', 'state']);
    assert.match(value.save.draftId, /^[1-9][0-9]*$/);
    const actual = value.save.state; assert.ok(phases.includes(actual.phase));
    assert.deepEqual(actual, state(actual.phase, actual.requestId));
    if (actual.busy) assert.match(actual.requestId, /^[1-9][0-9]*$/);
    else assert.equal(actual.requestId, null);
  } else assert.ok(value.draft, 'only current draft or compact save state can cross this boundary');
  return value;
}
function trace(label) {
  const entries = [];
  return { label, entries,
    push(value, check = () => {}) { entries.push({ value, check }); return this; },
    phase(value, phase, token = null, draftId = '1') { return this.push(value, result => { assert.equal(result.ok, true); assert.deepEqual(result.save, { draftId, state: state(phase, token) }); }); },
    error(value, errorCode = 'scene_layout_save_invalid') { return this.push(value, result => { assert.equal(result.ok, false); assert.equal(result.errorCode, errorCode); }); },
  };
}
function prepared(t) {
  return t.push(create()).push(move()).phase(begin('preview'), 'checking', '1').phase(resolve('1', 'accepted'), 'reviewed');
}
function inPhase(phase) {
  const t = trace(phase).push(create()).push(move());
  if (phase === 'editing') return t;
  t.phase(begin('preview'), 'checking', '1'); if (phase === 'checking') return t;
  t.phase(resolve('1', 'accepted'), 'reviewed'); if (phase === 'reviewed') return t;
  t.phase(begin('apply'), 'applying', '2'); if (phase === 'applying') return t;
  if (phase === 'conflict') return t.phase(resolve('2', 'error', { errorCode: 'world_revision_conflict' }), 'conflict');
  if (phase === 'refreshing' || phase === 'saved') {
    t.phase(resolve('2', 'accepted'), 'refreshing', '2');
    return phase === 'saved' ? t.phase(save('refreshed', { requestId: '2' }), 'saved') : t;
  }
  t.phase(resolve('2', 'error', { errorCode: 'network_timeout' }), 'uncertain'); if (phase === 'uncertain') return t;
  return t.phase(begin('verify', { editable: false, inputPending: true }), 'verifying', '3');
}
async function runTrace(t, withNative = false) {
  const run = await rawWasm(), actual = [];
  for (let index = 0; index < t.entries.length; index++) {
    const entry = t.entries[index], result = envelope(run(entry.value));
    try { entry.check(result); } catch (error) { error.message = `${t.label} item ${index} ${JSON.stringify(entry.value)}: ${error.message}`; throw error; }
    actual.push(result);
  }
  if (withNative) {
    const native = await nativeSequence(t.entries.map(item => item.value));
    for (let index = 0; index < actual.length; index++) assert.deepEqual(envelope(native[index]), actual[index], `${t.label} native/WASM item ${index}`);
  }
  return t.entries.length;
}

function happyPath() {
  const t = trace('save gates and receipt');
  t.push(create()).phase(save('read'), 'editing').error(begin('preview')).error(begin('apply')).error(begin('verify')).push(move());
  for (const flags of [{ editable: false }, { inputPending: true }, { editable: false, inputPending: true }]) t.error(begin('preview', flags));
  t.phase(begin('preview'), 'checking', '1').error(begin('preview')).error(begin('apply')).error(begin('verify'));
  t.phase(resolve('1', 'accepted'), 'reviewed');
  for (const flags of [{ editable: false }, { inputPending: true }, { editable: false, inputPending: true }]) t.error(begin('apply', flags));
  t.phase(begin('apply'), 'applying', '2').error(resolve('2', 'different')).phase(save('read'), 'applying', '2').phase(resolve('2', 'accepted'), 'refreshing', '2');
  t.error(begin('apply')).error(begin('verify')).error(begin('preview')).error(save('refreshed', { requestId: '1' }));
  t.phase(save('read'), 'refreshing', '2').phase(save('refreshed', { requestId: '2' }), 'saved');
  t.error(save('refreshed', { requestId: '2' })).error(begin('apply')).error(begin('preview')).error(begin('verify'));
  t.phase(save('read'), 'saved').push(draft('read'), result => assert.equal(result.draft.state.dirty, true, 'saved status must not mutate baseline/history'));
  return t.push(draft('close'));
}
function lateResponses() {
  const t = prepared(trace('stale and duplicate receipts'));
  t.error(resolve('1', 'accepted')).phase(begin('preview'), 'checking', '2');
  t.error(resolve('1', 'error', { errorCode: 'world_revision_conflict' })).phase(save('read'), 'checking', '2');
  t.error(resolve('3', 'accepted')).phase(save('read'), 'checking', '2');
  t.phase(resolve('2', 'accepted'), 'reviewed').phase(begin('apply'), 'applying', '3');
  t.error(resolve('2', 'accepted')).phase(save('read'), 'applying', '3');
  t.phase(resolve('3', 'accepted'), 'refreshing', '3').error(resolve('3', 'error', { errorCode: 'network_timeout' }));
  t.phase(save('read'), 'refreshing', '3').phase(save('refreshed', { requestId: '3' }), 'saved').error(resolve('3', 'accepted'));
  t.push(draft('close')).push(create());
  t.error(save('read'), 'scene_layout_draft_invalid').error(resolve('3', 'accepted'), 'scene_layout_draft_invalid');
  t.phase(save('read', { draftId: '2' }), 'editing', null, '2').push(move([30, 40], { draftId: '2' }));
  t.phase(begin('preview', { draftId: '2' }), 'checking', '1', '2');
  t.error(resolve('1', 'accepted'), 'scene_layout_draft_invalid').phase(save('read', { draftId: '2' }), 'checking', '1', '2');
  return t.push(draft('close', { draftId: '2' }));
}
function concurrentDrafts() {
  const t = trace('independent draft save sessions').push(create()).push(create());
  t.push(move()).push(move([30, 40], { draftId: '2' }));
  t.phase(begin('preview'), 'checking', '1').phase(begin('preview', { draftId: '2' }), 'checking', '1', '2');
  t.phase(resolve('1', 'accepted', { draftId: '2' }), 'reviewed', null, '2').phase(save('read'), 'checking', '1');
  t.phase(begin('preview', { draftId: '2' }), 'checking', '2', '2').error(resolve('2', 'accepted'));
  t.phase(save('read'), 'checking', '1').phase(resolve('1', 'accepted'), 'reviewed');
  t.push(draft('close')).phase(save('read', { draftId: '2' }), 'checking', '2', '2');
  return t.phase(resolve('2', 'accepted', { draftId: '2' }), 'reviewed', null, '2').push(draft('close', { draftId: '2' }));
}
function unknownPath() {
  const t = inPhase('uncertain');
  t.error(begin('apply')).error(begin('preview')).error(save('invalidate')).phase(save('read'), 'uncertain');
  t.phase(begin('verify', { editable: false, inputPending: true }), 'verifying', '3').error(begin('verify'));
  t.phase(resolve('3', 'error', { errorCode: 'network_timeout' }), 'uncertain');
  t.error(resolve('3', 'accepted')).phase(begin('verify'), 'verifying', '4');
  t.phase(resolve('4', 'accepted'), 'refreshing', '4').phase(save('refreshed', { requestId: '4' }), 'saved');
  return t.error(begin('apply')).push(draft('close'));
}
function differentPath() {
  const t = inPhase('verifying');
  t.phase(resolve('3', 'different'), 'conflict').error(begin('preview')).error(begin('apply')).error(begin('verify')).error(save('invalidate'));
  return t.phase(save('read'), 'conflict').push(draft('close'));
}
function reviewInvalidation() {
  const t = prepared(trace('approval invalidation'));
  t.push(move()).phase(save('read'), 'reviewed');
  t.error(move([100001, 0]), 'scene_layout_position_invalid').phase(save('read'), 'reviewed');
  t.push(draft('setPositions', { changes: [] })).phase(save('read'), 'reviewed');
  t.error(draft('setPositions', { changes: [actor([30, 40]), actor([50, 60])] }), 'scene_layout_position_invalid').phase(save('read'), 'reviewed');
  t.phase(save('invalidate'), 'editing').error(begin('apply')).push(move()).phase(save('read'), 'editing');
  t.phase(begin('preview'), 'checking', '2').phase(resolve('2', 'accepted'), 'reviewed');
  t.push(move([20, 30])).phase(save('read'), 'editing');
  t.phase(begin('preview'), 'checking', '3').phase(resolve('3', 'accepted'), 'reviewed');
  t.push(draft('undo')).phase(save('read'), 'editing');
  t.phase(begin('preview'), 'checking', '4').phase(resolve('4', 'accepted'), 'reviewed');
  t.push(draft('redo')).phase(save('read'), 'editing');
  t.phase(begin('preview'), 'checking', '5').phase(resolve('5', 'accepted'), 'reviewed');
  return t.push(draft('reset')).phase(save('read'), 'editing').error(begin('preview')).push(draft('close'));
}
const conflicts = ['world_revision_conflict', 'world_read_conflict', 'world_object_not_found'];
const definitelyRejected = ['world_scene_invalid', 'world_command_invalid'];
const errorCodes = [...conflicts, ...definitelyRejected, 'scene_layout_response_invalid', 'network_timeout', 'future_server_error', '', null, undefined];
function errorMatrix() {
  return ['preview', 'apply', 'verify'].flatMap(action => errorCodes.map(errorCode => {
    const t = inPhase({ preview: 'checking', apply: 'applying', verify: 'verifying' }[action]);
    t.label = `${action}: ${String(errorCode)}`;
    const token = { preview: '1', apply: '2', verify: '3' }[action];
    const next = conflicts.includes(errorCode) ? 'conflict' : action === 'preview' || action === 'apply' && definitelyRejected.includes(errorCode) ? 'editing' : 'uncertain';
    return t.phase(resolve(token, 'error', errorCode === undefined ? {} : { errorCode }), next).phase(save('read'), next).push(draft('close'));
  }));
}
function mutationGates() {
  return phases.filter(phase => !['editing', 'reviewed'].includes(phase)).map(phase => {
    const t = inPhase(phase), expected = t.entries.at(-1);
    for (const operation of [move([30, 40]), draft('undo'), draft('redo'), draft('reset'), save('invalidate')]) t.error(operation);
    t.push(save('read'), expected.check);
    t.push(draft('read'), result => {
      assert.deepEqual(result.draft.positions, [actor([10, 20])]);
      assert.deepEqual(result.draft.state, { dirty: true, canUndo: true, canRedo: false });
    });
    return t.push(draft('close')).error(save('read'), 'scene_layout_draft_invalid');
  });
}
function invalidInputs() {
  const t = inPhase('checking'); t.label = 'invalid transition input';
  for (const requestId of [null, '', '0', '01', '-1', '1.0', 1, '18446744073709551616']) t.error(resolve(requestId, 'accepted'));
  for (const outcome of [null, '', 'success', 1, false]) t.error(resolve('1', outcome));
  for (const errorCode of [false, 1, {}, [], 'x'.repeat(129), '界'.repeat(43)]) t.error(resolve('1', 'error', { errorCode }));
  t.error(resolve('1', 'different')).error(save('refreshed', { requestId: '1' }));
  t.phase(save('read'), 'checking', '1');
  t.phase(resolve('1', 'error', { errorCode: '界'.repeat(42) + 'ab' }), 'editing');
  for (const fields of [{ action: 'save' }, { action: null }, { editable: 1 }, { inputPending: 0 }, { editable: null }, { inputPending: null }]) t.error(begin('preview', fields));
  t.phase(begin('preview'), 'checking', '2').phase(resolve('2', 'accepted'), 'reviewed').push(draft('close'));
  return t;
}

const essentialTraces = () => [happyPath(), lateResponses(), concurrentDrafts(), unknownPath(), differentPath(), reviewInvalidation(), invalidInputs(), ...mutationGates()];

test('real WASM save transitions enforce review gates, stale receipts, unknown-save locks, and bounded lifecycle ownership', async () => {
  for (const value of essentialTraces()) await runTrace(value);
});

test('real WASM classifies preview, apply, and verification errors without making unknown outcomes writable', async () => {
  for (const value of errorMatrix()) await runTrace(value);
});

test('native and WASM preserve identical save state across complete persistent sessions and the error matrix', { skip: nativeSkip }, async t => {
  let samples = 0;
  for (const value of [...essentialTraces(), ...errorMatrix()]) samples += await runTrace(value, true);
  t.diagnostic(`${samples} persistent native/WASM request-response samples`);
});

test('the real save bridge leaves state untouched on invalid transport or cross-domain calls', async () => {
  const core = await bridge(), id = core.dispatchStudioCoreDraft(create()).draftId;
  const read = () => core.dispatchStudioCoreSave(save('read', { draftId: id }));
  try {
    core.dispatchStudioCoreDraft(move([10, 20], { draftId: id }));
    const pending = core.dispatchStudioCoreSave(begin('preview', { draftId: id }));
    let called = 0;
    const getter = resolve(pending.state.requestId, 'accepted', { draftId: id });
    Object.defineProperty(getter, 'outcome', { enumerable: true, get() { called++; return 'accepted'; } });
    for (const value of [getter, resolve(pending.state.requestId, 'error', { draftId: id, errorCode: undefined }), resolve(pending.state.requestId, 'error', { draftId: id, errorCode: NaN })]) {
      assert.throws(() => core.dispatchStudioCoreSave(value), { errorCode: 'studio_core_request_invalid' });
    }
    for (const [dispatch, value] of [
      [core.dispatchStudioCore, begin('preview', { draftId: id })], [core.dispatchStudioCoreDraft, begin('preview', { draftId: id })],
      [core.dispatchStudioCoreSave, draft('close', { draftId: id })], [core.dispatchStudioCoreSave, create()],
    ]) assert.throws(() => dispatch(value), { errorCode: 'studio_core_request_invalid' });
    assert.equal(called, 0); assert.deepEqual(read(), pending); assert.equal(core.getStudioCoreMetadata().ready, true);
    pending.state.phase = 'saved'; pending.state.saved = true;
    assert.deepEqual(read().state, state('checking', '1'), 'caller-owned snapshots cannot alter the authoritative workflow');
    core.dispatchStudioCoreSave(resolve('1', 'accepted', { draftId: id }));
    assert.equal(read().state.phase, 'reviewed');
  } finally { core.dispatchStudioCoreDraft(draft('close', { draftId: id })); }
});

async function responseBridge(response) {
  const module = await import(new URL(`../../engine/studio-core.mjs?save-invalid-response=${++bridgeId}`, import.meta.url));
  const memory = new WebAssembly.Memory({ initial: 17 }), encoded = new TextEncoder().encode(JSON.stringify(response)), instantiate = WebAssembly.instantiate;
  try {
    WebAssembly.instantiate = async () => ({ instance: { exports: {
      memory, viento_core_protocol_version: () => 1, viento_core_input: () => 16,
      viento_core_run: () => { new Uint8Array(memory.buffer, 1048576, encoded.length).set(encoded); return 1048576; }, viento_core_output_len: () => encoded.length,
    } } });
    await module.initializeStudioCore(() => new Uint8Array([1]));
  } finally { WebAssembly.instantiate = instantiate; }
  return module;
}
const response = (phase = 'editing', requestId = null) => ({ protocolVersion: 1, ok: true, save: { draftId: '1', state: state(phase, requestId) } });

test('the save bridge accepts every declared state without repairing inconsistent flags', async () => {
  for (const phase of phases) {
    const expected = response(phase, busyPhases.includes(phase) ? '1' : null), core = await responseBridge(expected);
    assert.deepEqual(core.dispatchStudioCoreSave(save('read')), expected.save);
  }
});

test('the save bridge fails closed on state, token, identity, and shape mismatches', async () => {
  const malformed = [];
  for (const phase of phases) {
    for (const key of ['busy', 'editable', 'reviewed', 'saved', 'conflict', 'uncertain']) {
      const value = response(phase, busyPhases.includes(phase) ? '1' : null); value.save.state[key] = !value.save.state[key]; malformed.push(value);
    }
    const wrongToken = response(phase, busyPhases.includes(phase) ? null : '1'); malformed.push(wrongToken);
  }
  for (const requestId of ['0', '01', '-1', '1.0', 1, '', '18446744073709551616']) malformed.push(response('checking', requestId));
  for (const modify of [value => { value.protocolVersion = 2; }, value => { value.save.draftId = '2'; }, value => { value.save.draftId = 1; },
    value => { value.save.state.phase = 'complete'; }, value => { value.save.state.history = []; }, value => { value.save.state.busy = 0; },
    value => { delete value.save.state.requestId; }, value => { value.save.authorText = 'private'; }, value => { value.changes = []; }]) {
    const value = response(); modify(value); malformed.push(value);
  }
  for (const value of malformed) {
    const core = await responseBridge(value);
    assert.throws(() => core.dispatchStudioCoreSave(save('read')), { errorCode: 'studio_core_unavailable' }, JSON.stringify(value));
    assert.equal(core.getStudioCoreMetadata().ready, false);
  }
  const core = await responseBridge(response('refreshing', '2'));
  assert.throws(() => core.dispatchStudioCoreSave(resolve('1', 'accepted')), { errorCode: 'studio_core_unavailable' }, 'a saved acknowledgement cannot belong to a different operation');
});
