import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { createRuntimeCaseReport, RUNTIME_CASE_REPORT_FILE_MAX_BYTES } from '../../engine/runtime-case-report.mjs';
import { writeRuntimeCaseReport, readRuntimeCaseReport } from '../lib/runtime-case-reports.mjs';

const clone = value => JSON.parse(JSON.stringify(value));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const scene = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', object = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const instance = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', other = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';
const documentId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', foreign = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const fields = { left: false, right: false, up: false, down: false };
function report({ executionStatus = 'succeeded', failed = false, empty = false } = {}) {
  const context = { sceneSourcePath: 'documents/scenes/场景:一.json', sceneObjectId: scene,
    buildId: '11111111-1111-4111-8111-111111111111', snapshotId: 'sha256:' + '1'.repeat(64), backendId: 'org.viento.bevy',
    suiteDocumentId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', suiteSourceVersion: 'sha256:' + '2'.repeat(64),
    documentId, sourceVersion: 'sha256:' + '3'.repeat(64), sessionId: empty ? null : '22222222-2222-4222-8222-222222222222' };
  const definition = { format: 'viento-runtime-case', schemaVersion: 1,
    program: { format: 'viento-runtime-control', schemaVersion: 2, fixedDelta: .125, steps: [{ inputs: [] }, { inputs: [] }] },
    checks: [{ instanceId: instance, stepIndex: 0, position: { value: [failed ? 201 : 200, 220], tolerance: 0 }, state: 'idle' },
      { instanceId: other, stepIndex: 1, state: 'idle' }] };
  const samples = empty ? [] : Array.from({ length: executionStatus === 'succeeded' ? 2 : 1 }, (_, stepIndex) => ({
    format: 'viento-runtime-trace', schemaVersion: 1, protocolVersion: 2, event: 'sample', stepIndex,
    actors: [{ instanceId: instance, objectId: object, position: [200, 220], state: 'idle' },
      { instanceId: other, objectId: object, position: [500, 220], state: 'idle' }] }));
  return createRuntimeCaseReport({ context, executionStatus, targets: [{ instanceId: instance, objectId: object },
    { instanceId: other, objectId: object }], definition, samples });
}
async function fixture(t) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-runtime-case-reports-'));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const directory = path.join(base, 'owned', 'receipt'); await fs.mkdir(directory, { recursive: true });
  return { base, directory };
}
async function changed(h, pin, change, { repin = false } = {}) {
  const value = JSON.parse(await fs.readFile(pin.path)); change(value);
  const bytes = Buffer.from(JSON.stringify(value) + '\n'); await fs.writeFile(pin.path, bytes);
  return repin ? { ...pin, sha256: hash(bytes) } : pin;
}
const code = (name, status) => error => error.errorCode === name && error.statusCode === status;

test('owned member reports publish compact UTF-8 bytes and return immutable private context and content pins', async t => {
  const h = await fixture(t), value = report(), pin = await writeRuntimeCaseReport(h.directory, value);
  const bytes = await fs.readFile(pin.path);
  assert.deepEqual(bytes, Buffer.from(JSON.stringify(value) + '\n')); assert.equal(pin.sha256, hash(bytes));
  assert.equal(path.basename(pin.path), `member-${documentId}.json`); assert.ok(Object.isFrozen(pin) && Object.isFrozen(pin.context));
  if (process.platform !== 'win32') assert.equal((await fs.stat(pin.path)).mode & 0o777, 0o600);
  const read = await readRuntimeCaseReport(h.directory, pin); assert.deepEqual(read, value);
  assert.ok(Object.isFrozen(read) && Object.isFrozen(read.samples));
  assert.deepEqual(await fs.readdir(h.directory), [path.basename(pin.path)]);
});

test('assertion failure and cancelled prefixes keep execution facts while pre-process failure has explicit null session and unavailable checks', async t => {
  for (const options of [{ failed: true }, { executionStatus: 'cancelled' }, { executionStatus: 'failed', empty: true }]) {
    const h = await fixture(t), value = report(options), pin = await writeRuntimeCaseReport(h.directory, value);
    const read = await readRuntimeCaseReport(h.directory, pin); assert.deepEqual(read, value);
    assert.equal(read.evaluation.status, options.failed ? 'failed' : 'incomplete');
    if (options.empty) { assert.equal(read.context.sessionId, null); assert.equal(read.evaluation.unavailableChecks, 2); }
    else if (options.executionStatus === 'cancelled') { assert.equal(read.samples.length, 1); assert.equal(read.evaluation.passedChecks, 1); assert.equal(read.evaluation.unavailableChecks, 1); }
  }
});

test('cached report read survives author source going offline and successful build pruning without opening either tree', async t => {
  const h = await fixture(t), author = path.join(h.base, 'author'), build = path.join(h.base, 'build');
  await fs.mkdir(author); await fs.mkdir(build); await fs.writeFile(path.join(author, 'source.json'), '{}');
  const value = report(), pin = await writeRuntimeCaseReport(h.directory, value), before = await fs.readFile(pin.path);
  await fs.rename(author, author + '-offline'); await fs.rm(build, { recursive: true });
  assert.deepEqual(await readRuntimeCaseReport(h.directory, pin), value); assert.deepEqual(await fs.readFile(pin.path), before);
});

test('missing member files use a public unavailable status without revealing private paths or their native cause', async t => {
  const h = await fixture(t), pin = await writeRuntimeCaseReport(h.directory, report()); await fs.unlink(pin.path);
  await assert.rejects(readRuntimeCaseReport(h.directory, pin), error => {
    assert.equal(error.errorCode, 'runtime_report_unavailable'); assert.equal(error.statusCode, 404);
    assert.ok(error.cause); assert.ok(!error.message.includes(h.base)); assert.ok(!JSON.stringify(error).includes(h.base)); return true;
  });
});

test('final report links are refused even when the linked file has the exact originally pinned bytes', async t => {
  const h = await fixture(t), pin = await writeRuntimeCaseReport(h.directory, report()), original = path.join(h.base, 'original.json');
  await fs.rename(pin.path, original); await fs.symlink(original, pin.path);
  await assert.rejects(readRuntimeCaseReport(h.directory, pin), code('runtime_report_changed', 409));
});

test('links in receipt and ancestor directories are refused for reads and writes without replacing external files', async t => {
  const h = await fixture(t), pin = await writeRuntimeCaseReport(h.directory, report()), alias = path.join(h.base, 'alias');
  await fs.symlink(path.dirname(h.directory), alias);
  const aliasDirectory = path.join(alias, 'receipt'), aliasPin = { ...pin, path: path.join(aliasDirectory, path.basename(pin.path)) };
  await assert.rejects(readRuntimeCaseReport(aliasDirectory, aliasPin), code('runtime_report_changed', 409));
  await assert.rejects(writeRuntimeCaseReport(aliasDirectory, report()), code('runtime_report_changed', 409));
  await fs.rename(h.directory, h.directory + '-original'); await fs.symlink(h.directory + '-original', h.directory);
  await assert.rejects(readRuntimeCaseReport(h.directory, pin), code('runtime_report_changed', 409));
  assert.deepEqual(await fs.readdir(h.directory + '-original'), [path.basename(pin.path)]);
});

test('nonregular member entries cannot block report reads', async t => {
  const h = await fixture(t), pin = await writeRuntimeCaseReport(h.directory, report()); await fs.unlink(pin.path); await fs.mkdir(pin.path);
  await assert.rejects(readRuntimeCaseReport(h.directory, pin), code('runtime_report_changed', 409));
});

test('raw report changes and forged private paths are rejected before returning a parsed result', async t => {
  const h = await fixture(t), pin = await writeRuntimeCaseReport(h.directory, report()); await fs.appendFile(pin.path, ' ');
  await assert.rejects(readRuntimeCaseReport(h.directory, pin), code('runtime_report_changed', 409));
  await assert.rejects(readRuntimeCaseReport(h.directory, { ...pin, path: path.join(h.base, 'author.json') }), code('runtime_report_changed', 409));
});

test('all expected context fields remain pinned independently of an otherwise structurally valid replacement report', async t => {
  for (const [key, replacement] of Object.entries({ sceneSourcePath: 'documents/scenes/other.json', sceneObjectId: foreign,
    buildId: foreign, snapshotId: 'sha256:' + 'a'.repeat(64), backendId: 'org.viento.godot4', suiteDocumentId: foreign,
    suiteSourceVersion: 'sha256:' + 'b'.repeat(64), documentId: foreign, sourceVersion: 'sha256:' + 'c'.repeat(64), sessionId: foreign })) {
    const h = await fixture(t), pin = await writeRuntimeCaseReport(h.directory, report());
    const forged = await changed(h, pin, value => { value.context[key] = replacement; }, { repin: true });
    await assert.rejects(readRuntimeCaseReport(h.directory, forged), code('runtime_report_changed', 409), key);
  }
});

test('a valid replacement definition and its correctly recomputed evaluation still cannot replace the admitted case hash', async t => {
  const h = await fixture(t), pin = await writeRuntimeCaseReport(h.directory, report()), replacement = report({ failed: true });
  const bytes = Buffer.from(JSON.stringify(replacement) + '\n'); await fs.writeFile(pin.path, bytes);
  await assert.rejects(readRuntimeCaseReport(h.directory, { ...pin, sha256: hash(bytes) }), code('runtime_report_changed', 409));
});

test('corrupt evaluations and extra tool or path fields fail pure structure checks even with a matching raw digest', async t => {
  for (const change of [value => { value.evaluation.failedChecks = 1; }, value => { value.tool = '/private/tool'; }, value => { value.samples[1].stepIndex = 0; }]) {
    const h = await fixture(t), pin = await writeRuntimeCaseReport(h.directory, report());
    const forged = await changed(h, pin, change, { repin: true });
    await assert.rejects(readRuntimeCaseReport(h.directory, forged), code('runtime_report_invalid', 422));
  }
});

test('oversized regular files are rejected before parsing and malformed UTF-8 or JSON receives controlled invalid errors', async t => {
  for (const [bytes, errorCode, status] of [[Buffer.alloc(RUNTIME_CASE_REPORT_FILE_MAX_BYTES + 1, 32), 'runtime_report_limit', 413],
    [Buffer.from([0xc3, 0x28]), 'runtime_report_invalid', 422], [Buffer.from('{'), 'runtime_report_invalid', 422]]) {
    const h = await fixture(t), pin = await writeRuntimeCaseReport(h.directory, report()); await fs.writeFile(pin.path, bytes);
    await assert.rejects(readRuntimeCaseReport(h.directory, { ...pin, sha256: hash(bytes) }), code(errorCode, status));
  }
});

test('changes during an open file read are rejected despite the original inode being retained', async t => {
  const h = await fixture(t), pin = await writeRuntimeCaseReport(h.directory, report()), originalOpen = fs.open; let injected = false;
  fs.open = async (...args) => {
    const handle = await originalOpen(...args);
    if (args[0] !== pin.path) return handle;
    return { stat: handle.stat.bind(handle), close: handle.close.bind(handle), async read(...readArgs) {
      const result = await handle.read(...readArgs); if (!injected) { injected = true; await fs.appendFile(pin.path, ' '); } return result;
    } };
  };
  try { await assert.rejects(readRuntimeCaseReport(h.directory, pin), code('runtime_report_changed', 409)); }
  finally { fs.open = originalOpen; }
  assert.equal(injected, true);
});

test('writer and reader detach mutable definitions and private pins before awaiting filesystem work', async t => {
  const h = await fixture(t), original = report(), mutable = clone(original), writing = writeRuntimeCaseReport(h.directory, mutable);
  mutable.context.documentId = foreign; mutable.samples.length = 0; mutable.evaluation.status = 'failed';
  const pin = await writing, mutablePin = clone(pin), reading = readRuntimeCaseReport(h.directory, mutablePin);
  mutablePin.path = path.join(h.base, 'wrong'); mutablePin.sha256 = 'f'.repeat(64); mutablePin.context.sceneObjectId = foreign;
  assert.deepEqual(await reading, original);
});

test('private pin accessors cannot execute and ordinary read results cannot mutate persisted detail', async t => {
  const h = await fixture(t), pin = await writeRuntimeCaseReport(h.directory, report()), accessor = clone(pin); let accessed = 0;
  Object.defineProperty(accessor, 'path', { enumerable: true, get() { accessed++; throw new Error('must not run'); } });
  await assert.rejects(readRuntimeCaseReport(h.directory, accessor), code('runtime_report_invalid', 422)); assert.equal(accessed, 0);
  const value = await readRuntimeCaseReport(h.directory, pin); assert.throws(() => value.samples.pop(), TypeError);
  assert.deepEqual(await readRuntimeCaseReport(h.directory, pin), report());
});

test('exclusive atomic publication never overwrites an existing report and cleans only its own temporary file', async t => {
  const h = await fixture(t), target = path.join(h.directory, `member-${documentId}.json`), external = Buffer.from('external owner');
  await fs.writeFile(target, external);
  await assert.rejects(writeRuntimeCaseReport(h.directory, report()), code('runtime_report_changed', 409));
  assert.deepEqual(await fs.readFile(target), external); assert.deepEqual(await fs.readdir(h.directory), [path.basename(target)]);
});

test('failed publication preserves existing cache content, removes its own staging bytes and exposes no private native path', async t => {
  const h = await fixture(t), unrelated = path.join(h.directory, 'keep.json'); await fs.writeFile(unrelated, 'keep');
  const originalLink = fs.link; fs.link = async () => { throw Object.assign(new Error('private ' + h.directory), { code: 'EIO' }); };
  try {
    await assert.rejects(writeRuntimeCaseReport(h.directory, report()), error => {
      assert.ok(code('runtime_report_invalid', 422)(error)); assert.ok(!error.message.includes(h.base)); assert.ok(!JSON.stringify(error).includes(h.base)); return true;
    });
  } finally { fs.link = originalLink; }
  assert.deepEqual(await fs.readdir(h.directory), ['keep.json']); assert.equal(await fs.readFile(unrelated, 'utf8'), 'keep');
});

test('invalid writer data fails before filesystem access and pure errors map to public invalid status', async t => {
  const h = await fixture(t), value = clone(report()); value.evaluation.status = 'failed';
  await assert.rejects(writeRuntimeCaseReport(h.directory, value), error => {
    assert.ok(code('runtime_report_invalid', 422)(error)); assert.equal(error.cause.errorCode, 'runtime_case_report_invalid'); return true;
  });
  assert.deepEqual(await fs.readdir(h.directory), []);
});
