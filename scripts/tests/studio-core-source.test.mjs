import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import * as core from '../../engine/studio-core.mjs';
import { patchSceneSourcePositions } from '../../engine/scene-source-layout.mjs';

const fixture = JSON.parse(await fs.readFile(new URL('fixtures/studio-core-source/legacy-patches.json', import.meta.url), 'utf8'));
assert.equal(fixture.format, 'viento-legacy-scene-source-golden');
assert.equal(fixture.cases.length, 82);
assert.equal(fixture.legacyModuleSha256, '7d5cb1bbac71d53c29a158356e00f03e503c7abe65a7c5083cde74c51cf1f2d4');
const bytes = await fs.readFile(new URL('../../engine/studio-core.wasm', import.meta.url));
const nativePath = process.env.VIENTO_STUDIO_CORE_BIN || fileURLToPath(new URL(`../../crates/viento-studio-core/target/debug/viento-core${process.platform === 'win32' ? '.exe' : ''}`, import.meta.url));
let nativeAvailable = true;
try { await fs.access(nativePath, fsConstants.X_OK); } catch { nativeAvailable = false; }
const nativeSkip = nativeAvailable ? false : 'Native source parity requires VIENTO_STUDIO_CORE_BIN; real WASM and frozen legacy cases still run.';
const uuid = n => n.toString(16).padStart(8, '0') + '-1111-4111-8111-111111111111';
const actorId = uuid(1), instanceId = uuid(11);
const scene = version => ({ format: 'viento-scene2d', schemaVersion: version, ...(version === 3 ? { groups: [] } : {}),
  actors: [{ objectId: actorId, ...(version === 1 ? {} : { instanceId }), position: [0, 0] }] });
const content = JSON.stringify(scene(1));
const request = (operation, content, fields = {}) => ({ protocolVersion: 1, operation: `sceneSource.${operation}`, content, ...fields });
const digest = value => createHash('sha256').update(value).digest('hex');
const outcome = result => {
  assert.equal(result.protocolVersion, 1); assert.equal(typeof result.ok, 'boolean');
  if (result.ok) {
    assert.deepEqual(Object.keys(result).sort(), ['ok', 'protocolVersion', 'source']);
    return { ok: true, ...result.source };
  }
  assert.equal(typeof result.errorCode, 'string'); assert.equal(typeof result.message, 'string');
  for (const key of ['source', 'changes', 'draft', 'save']) assert.equal(Object.hasOwn(result, key), false, 'errors cannot expose partially parsed or changed source');
  return { ok: false, errorCode: result.errorCode };
};
async function rawWasm() {
  const { instance } = await WebAssembly.instantiate(bytes, {}), api = instance.exports;
  return input => {
    const raw = new TextEncoder().encode(typeof input === 'string' ? input : JSON.stringify(input)), pointer = api.viento_core_input(raw.length) >>> 0;
    if (pointer) { assert.ok(pointer + raw.length <= api.memory.buffer.byteLength); new Uint8Array(api.memory.buffer, pointer, raw.length).set(raw); }
    const output = api.viento_core_run() >>> 0, length = api.viento_core_output_len();
    assert.ok(output && length > 0 && length <= 1024 * 1024 && output + length <= api.memory.buffer.byteLength);
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(api.memory.buffer, output, length)));
  };
}
async function nativeSequence(inputs) {
  return new Promise((resolve, reject) => {
    const child = spawn(nativePath, [], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', failure;
    const timer = setTimeout(() => { failure = new Error('Native scene source parity timed out.'); child.kill('SIGKILL'); }, 30000);
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { stdout += chunk; if (Buffer.byteLength(stdout) > 16 * 1024 * 1024) { failure = new Error('Native output exceeds its test bound.'); child.kill('SIGKILL'); } });
    child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-4096); });
    child.stdin.on('error', error => { failure ||= error; });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', (code, signal) => {
      clearTimeout(timer); if (failure) return reject(failure);
      try { assert.equal(signal, null); assert.equal(code, 0, stderr); const responses = stdout.trim().split('\n').map(line => JSON.parse(line)); assert.equal(responses.length, inputs.length); resolve(responses); } catch (error) { reject(error); }
    });
    child.stdin.end(inputs.map(value => typeof value === 'string' ? value : JSON.stringify(value)).join('\n') + '\n');
  });
}
const legacyRequests = fixture.cases.flatMap(item => [
  { label: `${item.name}:inspect`, input: request('inspect', item.content), expected: item.expectedInspect },
  { label: `${item.name}:patch`, input: request('patch', item.content, { changes: item.changes }), expected: item.expected },
].map(value => item.name === 'literal-surrogate' ? { ...value, expected: { ok: false, errorCode: 'studio_core_request_invalid' } } : value));

function floatingCases() {
  const values = [-0, 0, 100000, -100000, 99999.99999999999, 1e-6, -1e-6, 0.0000009999999999999997,
    0.0000010000000000000002, 1e-7, -1e-7, 5e-324, -5e-324, Number.MIN_VALUE * 2, 2.2250738585072014e-308, 2 ** -25, -(2 ** -25), 2 ** -28, -(2 ** -28)];
  // Reproducible IEEE-754 bit patterns, including subnormals and difficult
  // shortest-roundtrip decimals; no Rust formatting routine is reused here.
  let seed = 0x31415926; const next = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0);
  const buffer = new ArrayBuffer(8), view = new DataView(buffer);
  while (values.length < 320) {
    view.setUint32(0, next()); view.setUint32(4, next());
    const value = view.getFloat64(0); if (Number.isFinite(value) && Math.abs(value) <= 100000) values.push(value);
  }
  return values.map((value, index) => {
    const y = index % 2 ? -value : value, changes = [{ objectId: actorId, position: [value, y] }];
    return { label: `binary64:${index}:${String(value)}`, input: request('patch', content, { changes }), expected: {
      ok: true, afterContent: content.replace('[0,0]', JSON.stringify([value, y])), changedPaths: value === 0 ? [] : ['/actors/0/position/0', '/actors/0/position/1'],
    } };
  });
}
function boundaries() {
  const cases = [], inspect = (label, value, ok = true, errorCode = 'scene_source_layout_invalid') => cases.push({ label,
    input: request('inspect', typeof value === 'string' ? value : JSON.stringify(value)), expected: ok ? { ok: true, schemaVersion: 3, actorCount: 1 } : { ok: false, errorCode } });
  const group = n => ({ groupId: uuid(1000 + n), name: `Group ${n}` });
  for (const count of [0, 128, 129]) { const value = scene(3); value.groups = Array.from({ length: count }, (_, index) => group(index)); inspect(`groups:${count}`, value, count <= 128); }
  for (const depth of [16, 17]) { const value = scene(3); value.groups = Array.from({ length: depth }, (_, index) => ({ ...group(index), ...(index ? { parentGroupId: uuid(999 + index) } : {}) })); inspect(`group-depth:${depth}`, value, depth <= 16); }
  for (const length of [160, 161]) { const value = scene(3); value.groups = [{ ...group(0), name: '😀'.repeat(80) + (length === 161 ? 'x' : '') }]; inspect(`group-name-utf16:${length}`, value, length <= 160); }
  for (const count of [0, 128, 129]) {
    const value = scene(3); value.actors = Array.from({ length: count }, (_, index) => ({ objectId: actorId, instanceId: uuid(2000 + index), position: [index, 0] }));
    cases.push({ label: `actors:${count}`, input: request('inspect', JSON.stringify(value)), expected: count >= 1 && count <= 128 ? { ok: true, schemaVersion: 3, actorCount: count } : { ok: false, errorCode: 'scene_source_layout_invalid' } });
  }
  const empty = JSON.stringify({ ...scene(3), note: '' });
  for (const length of [131072, 131073]) inspect(`source-bytes:${length}`, empty.replace('"note":""', '"note":"' + 'x'.repeat(length - Buffer.byteLength(empty)) + '"'), length <= 131072, 'scene_source_layout_content_limit');
  const multibyte = empty.replace('"note":""', '"note":"' + '中'.repeat(Math.ceil((131073 - Buffer.byteLength(empty)) / 3)) + '"');
  assert.ok(multibyte.length < 131072 && Buffer.byteLength(multibyte) > 131072); inspect('UTF8-limit-not-UTF16', multibyte, false, 'scene_source_layout_content_limit');
  for (const depth of [63, 64]) inspect(`JSON-depth:${depth}`, JSON.stringify(scene(3)).slice(0, -1) + ',"extra":' + '['.repeat(depth) + '0' + ']'.repeat(depth) + '}', depth <= 63);
  // Growth is bounded too: a valid 128 KiB source cannot gain coordinate bytes.
  const full = content.slice(0, -1) + ',"padding":"' + 'x'.repeat(131072 - Buffer.byteLength(content) - ',"padding":""'.length) + '"}';
  assert.equal(Buffer.byteLength(full), 131072);
  cases.push({ label: 'patch-output-limit', input: request('patch', full, { changes: [{ objectId: actorId, position: [100000, 0] }] }), expected: { ok: false, errorCode: 'scene_source_layout_content_limit' } });
  return cases;
}
const floats = floatingCases(), bounded = boundaries();
async function checkCases(cases, native = false) {
  const wasm = await rawWasm(), nativeResults = native ? await nativeSequence(cases.map(item => item.input)) : null;
  const results = [];
  for (const [index, item] of cases.entries()) {
    const actual = wasm(item.input); assert.deepEqual(outcome(actual), item.expected, item.label);
    if (nativeResults) assert.deepEqual(nativeResults[index], actual, `native/WASM: ${item.label}`);
    results.push(actual);
  }
  return results;
}

test('source core is real standalone WASM with an explicit source feature version and no host I/O imports', async () => {
  const module = await WebAssembly.compile(bytes); assert.deepEqual(WebAssembly.Module.imports(module), []);
  const instance = await WebAssembly.instantiate(module, {}); assert.equal(instance.exports.viento_core_protocol_version(), 1);
  assert.equal(instance.exports.viento_core_scene_source_version(), 1);
  await core.ensureStudioCoreReady(); assert.equal(typeof core.dispatchStudioCoreSource, 'function');
});
test('real WASM inspect and patch preserve 82 frozen pre-Rust source cases', async t => {
  await checkCases(legacyRequests); t.diagnostic(`${legacyRequests.length} frozen inspect/patch responses; Unicode, decoded duplicate keys, JSON number spellings, v1/v2/v3 and group constraints`);
});
test('public JavaScript source patch retains the frozen legacy results and error codes', () => {
  for (const item of fixture.cases) {
    let actual; try { actual = { ok: true, ...patchSceneSourcePositions(item.content, item.changes) }; } catch (error) { actual = { ok: false, errorCode: error.errorCode }; }
    assert.deepEqual(actual, item.expected, item.name);
  }
});
test('WASM emits JavaScript canonical coordinate tokens across binary64 roundtrip and exponent thresholds', async t => {
  await checkCases(floats); t.diagnostic(`${floats.length} deterministic IEEE-754 samples; all untouched source bytes remain exact`);
});
test('source parsing and patched output enforce UTF8, UTF16, actor, group and depth bounds without partial results', async t => {
  await checkCases(bounded); t.diagnostic(`${bounded.length} boundary requests`);
});
test('native and WASM return identical complete source responses for all legacy, binary64 and boundary requests', { skip: nativeSkip }, async t => {
  const cases = [...legacyRequests, ...floats, ...bounded], results = await checkCases(cases, true);
  t.diagnostic(`${cases.length} identical native/WASM request-response samples; SHA256 ${digest(JSON.stringify({ requests: cases.map(item => item.input), responses: results }))}`);
});

let bridgeId = 0;
async function responseBridge(response, feature = 1) {
  const module = await import(new URL(`../../engine/studio-core.mjs?source-response=${++bridgeId}`, import.meta.url));
  const memory = new WebAssembly.Memory({ initial: 32 }), encoded = new TextEncoder().encode(JSON.stringify(response)), instantiate = WebAssembly.instantiate;
  try {
    WebAssembly.instantiate = async () => ({ instance: { exports: { memory, viento_core_protocol_version: () => 1,
      ...(feature === null ? {} : { viento_core_scene_source_version: () => feature }), viento_core_input: () => 16,
      viento_core_run: () => { new Uint8Array(memory.buffer, 1048576, encoded.length).set(encoded); return 1048576; }, viento_core_output_len: () => encoded.length,
    } } });
    await module.initializeStudioCore(() => new Uint8Array([1]));
  } finally { WebAssembly.instantiate = instantiate; }
  return module;
}
test('missing or unsupported source feature blocks only source editing while old geometry remains available', async () => {
  for (const feature of [null, 0, 2]) {
    const module = await responseBridge({ protocolVersion: 1, ok: true, changes: [] }, feature);
    assert.throws(() => module.dispatchStudioCoreSource(request('inspect', content)), { errorCode: 'studio_core_unavailable' });
    assert.equal(module.getStudioCoreMetadata().ready, true);
    assert.deepEqual(module.dispatchStudioCore({ protocolVersion: 1, operation: 'validateBatch', actors: [], changes: [] }), []);
  }
});
test('the source bridge rejects cross-domain and non-JSON requests without invoking user getters or damaging the core', async () => {
  await core.ensureStudioCoreReady(); let calls = 0;
  const getter = request('inspect', content); Object.defineProperty(getter, 'content', { enumerable: true, get() { calls++; return content; } });
  const operationGetter = request('inspect', content); Object.defineProperty(operationGetter, 'operation', { enumerable: true, get() { calls++; return 'sceneSource.inspect'; } });
  for (const value of [getter, operationGetter, request('inspect', content, { ignored: undefined }), request('patch', content, { changes: [{ objectId: actorId, position: [NaN, 0] }] }),
    { protocolVersion: 1, operation: 'layoutDraft.create', actors: [] }]) assert.throws(() => core.dispatchStudioCoreSource(value), { errorCode: 'studio_core_request_invalid' });
  assert.equal(calls, 0); assert.equal(core.getStudioCoreMetadata().ready, true);
  assert.throws(() => core.dispatchStudioCoreSource(request('inspect', '{')), { errorCode: 'scene_source_layout_invalid' });
  assert.equal(core.getStudioCoreMetadata().ready, true, 'ordinary source semantic failures do not poison the loaded core');
  assert.deepEqual(core.dispatchStudioCoreSource(request('inspect', content)), { schemaVersion: 1, actorCount: 1 });
});
test('the source bridge fails closed on malformed or mixed-domain source responses', async () => {
  const inspect = source => ({ protocolVersion: 1, ok: true, source });
  const invalid = [
    inspect({ schemaVersion: 0, actorCount: 1 }), inspect({ schemaVersion: 1, actorCount: 0 }), inspect({ schemaVersion: 1, actorCount: 129 }),
    inspect({ schemaVersion: 1, actorCount: 1, sceneId: actorId }), { ...inspect({ schemaVersion: 1, actorCount: 1 }), changes: [] },
  ];
  for (const value of invalid) {
    const module = await responseBridge(value); assert.throws(() => module.dispatchStudioCoreSource(request('inspect', content)), { errorCode: 'studio_core_unavailable' });
    assert.equal(module.getStudioCoreMetadata().ready, false);
  }
  for (const source of [{ afterContent: null, changedPaths: [] }, { afterContent: content, changedPaths: ['/private'] },
    { afterContent: content, changedPaths: ['/actors/0/position/0', '/actors/0/position/0'] },
    { afterContent: content, changedPaths: [], beforeContent: content },
    { afterContent: '中'.repeat(43691), changedPaths: ['/actors/0/position/0'] },
    ...['/actors/01/position/0', '/actors/128/position/0', '/actors/0/position/2'].map(pointer => ({ afterContent: content + ' ', changedPaths: [pointer] })),
    { afterContent: content + ' ', changedPaths: ['/actors/10/position/0', '/actors/2/position/0'] },
    { afterContent: content + ' ', changedPaths: [] }, { afterContent: content, changedPaths: ['/actors/0/position/0'] }]) {
    const module = await responseBridge(inspect(source));
    assert.throws(() => module.dispatchStudioCoreSource(request('patch', content, { changes: [{ objectId: actorId, position: [1, 2] }] })), { errorCode: 'studio_core_unavailable' });
    assert.equal(module.getStudioCoreMetadata().ready, false);
  }
});
