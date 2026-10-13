import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createHash } from 'node:crypto';
import yazl from 'yazl';
import yauzl from 'yauzl';
import { planBackendProjectDelivery, verifyBackendProjectDelivery } from '../adapters/node-backend-project-delivery.mjs';
import { inspectBackendProject } from '../adapters/node-backend-project.mjs';
import { writeExportZip } from '../lib/export-package.mjs';
import { backendProjectFixture } from './helpers/backend-project-fixture.mjs';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const invalid = error => Boolean(error.errorCode?.startsWith('backend_project_delivery_'));
const changed = error => invalid(error) || Boolean(error.errorCode?.startsWith('backend_project_')) || error.errorCode === 'export_failed';
async function delivery(t, options = {}) {
  const f = await backendProjectFixture(t, options);
  const inspect = () => inspectBackendProject({ buildDirectory: f.directory, ...f.pins });
  const inspection = await inspect(), plan = await planBackendProjectDelivery({ inspection, assertCurrent: inspect });
  return { ...f, inspect, inspection, plan, output: path.join(f.temporary, 'delivery.zip') };
}
async function zipEntries(file) {
  const zip = await yauzl.openPromise(file, { lazyEntries: true, autoClose: false });
  const result = [];
  try { for await (const entry of zip.eachEntry()) { const chunks = []; for await (const chunk of await zip.openReadStreamPromise(entry)) chunks.push(chunk); result.push({ path: entry.fileName, buffer: Buffer.concat(chunks) }); } }
  finally { await new Promise(resolve => { zip.reader.once('close', resolve); zip.close(); }); }
  return result;
}
async function rewrite(file, entries) {
  const zip = new yazl.ZipFile(), writing = pipeline(zip.outputStream, createWriteStream(file, { flags: 'wx' }));
  for (const entry of entries) zip.addBuffer(entry.buffer, entry.path, { ...(entry.mode ? { mode: entry.mode } : {}) });
  zip.end(); await writing;
}

test('Godot, scripted Godot and Bevy deliveries use the existing streaming writer and independently verify after relocation', async t => {
  for (const options of [{}, { behaviors: true }, { backend: 'bevy', version: 2 }]) {
    const f = await delivery(t, options); await writeExportZip(f.plan, f.output);
    const moved = path.join(f.temporary, 'moved.zip'); await fs.rename(f.output, moved); await fs.rm(f.author, { recursive: true });
    const result = await verifyBackendProjectDelivery(moved);
    assert.deepEqual(result.delivery, f.plan.delivery); assert.equal(result.fileCount, f.project.files.length + 1);
    assert.equal(result.assetCount, f.project.resources.length); assert.equal(result.bytes, (await fs.stat(moved)).size);
    const entries = await zipEntries(moved), names = entries.map(row => row.path).sort();
    assert.deepEqual(names, [...f.project.files.map(row => row.path), 'README.md', 'manifest.json'].sort());
    assert.equal(f.plan.entries.filter(row => row.buffer).length, 1, 'generated files remain streamed, only bounded README is buffered');
    const readme = entries.find(row => row.path === 'README.md').buffer.toString();
    for (const text of ['中文', 'English', '日本語', '.viento.zip', f.project.tool.version]) assert.ok(readme.includes(text));
    for (const text of [f.author, f.directory, '/usr/bin/', 'snapshot.source']) assert.equal(entries.some(row => row.buffer.includes(text)), false);
  }
});

test('delivery only copies the immutable whitelist and never enumerates extra directories or leaks local files', async t => {
  const f = await delivery(t), extras = path.join(f.directory, 'sessions'); await fs.mkdir(extras); await fs.writeFile(path.join(extras, 'private.log'), 'PRIVATE');
  await fs.writeFile(path.join(f.directory, 'project/local-secret.txt'), 'PRIVATE'); await fs.symlink(f.author, path.join(f.directory, 'outside'));
  const inspected = await f.inspect(); assert.equal(inspected.inspection.complete, false);
  const original = fs.readdir; let extraReads = 0;
  fs.readdir = async (directory, ...args) => { if (directory === extras) extraReads++; return original.call(fs, directory, ...args); };
  try {
    const plan = await planBackendProjectDelivery({ inspection: inspected, assertCurrent: f.inspect }); await writeExportZip(plan, f.output);
    await verifyBackendProjectDelivery(f.output); assert.equal(extraReads, 0);
    const entries = await zipEntries(f.output); assert.equal(entries.some(row => row.buffer.includes('PRIVATE') || row.path.includes('sessions') || row.path.includes('local-secret')), false);
  } finally { fs.readdir = original; }
  assert.equal(await fs.readFile(path.join(extras, 'private.log'), 'utf8'), 'PRIVATE');
});

test('a frozen recorded project remains deliverable when the author workspace is offline and no tool is queried', async t => {
  const f = await delivery(t); await fs.rm(f.author, { recursive: true });
  let checks = 0;
  const plan = await planBackendProjectDelivery({ inspection: f.inspection, assertCurrent: async () => { checks++; await f.inspect(); } });
  await writeExportZip(plan, f.output); assert.equal(checks, 2);
  assert.equal((await verifyBackendProjectDelivery(f.output)).delivery.project.buildId, f.build.buildId);
});

test('delivery rejects modified registered bytes and preserves stale inspection pinning', async t => {
  for (const target of ['file', 'manifest', 'inspection']) {
    const f = await delivery(t);
    if (target === 'file') await fs.appendFile(path.join(f.directory, f.project.files[0].path), 'changed');
    else if (target === 'manifest') await fs.appendFile(path.join(f.directory, 'backend-project.json'), ' ');
    else f.inspection.inspection.manifestSha256 = 'f'.repeat(64);
    await assert.rejects(writeExportZip(f.plan, f.output), changed);
  }
});

test('delivery detects a same-length content replacement even with no-op host recheck', async t => {
  const f = await delivery(t), inspection = await f.inspect();
  const plan = await planBackendProjectDelivery({ inspection, assertCurrent: async () => {} });
  const file = path.join(f.directory, f.project.files[0].path), bytes = await fs.readFile(file); bytes[0] ^= 1; await fs.writeFile(file, bytes);
  await assert.rejects(plan.validateSnapshot(), invalid);
});

test('delivery refuses unrecorded sources missing host authorization and filesystem links without following them', async t => {
  const f = await delivery(t);
  await assert.rejects(planBackendProjectDelivery({ inspection: f.inspection }), invalid);
  await assert.rejects(planBackendProjectDelivery({ inspection: { ...f.inspection, inspection: { ...f.inspection.inspection, recorded: false } }, assertCurrent: f.inspect }), invalid);
  const target = path.join(f.directory, f.project.files[0].path), outside = path.join(f.temporary, 'outside'); await fs.rename(target, outside); await fs.symlink(outside, target);
  await assert.rejects(planBackendProjectDelivery({ inspection: f.inspection, assertCurrent: async () => {} }));
  assert.equal((await fs.lstat(target)).isSymbolicLink(), true);
});

test('delivery cancellation propagates during planning, final writer verification and ZIP reading', async t => {
  const f = await delivery(t), controller = new AbortController(); controller.abort(new Error('cancel delivery'));
  await assert.rejects(planBackendProjectDelivery({ inspection: f.inspection, assertCurrent: f.inspect, signal: controller.signal }), /cancel delivery/);
  await assert.rejects(verifyBackendProjectDelivery(f.output, { signal: controller.signal }), /cancel delivery/);
  const stopping = new AbortController(); let checks = 0;
  const plan = await planBackendProjectDelivery({ inspection: f.inspection, assertCurrent: async () => { if (++checks === 2) stopping.abort(new Error('cancel final')); } });
  await assert.rejects(writeExportZip(plan, f.output, stopping.signal), /cancel final/);
  const valid = path.join(f.temporary, 'valid.zip'); await writeExportZip(f.plan, valid);
  const reading = new AbortController(), original = yauzl.ZipFile.prototype.openReadStreamPromise;
  yauzl.ZipFile.prototype.openReadStreamPromise = async function (...args) { const stream = await original.apply(this, args); stream.once('data', () => reading.abort(new Error('cancel reading'))); return stream; };
  try { await assert.rejects(verifyBackendProjectDelivery(valid, { signal: reading.signal }), /cancel reading/); }
  finally { yauzl.ZipFile.prototype.openReadStreamPromise = original; }
});

test('ZIP verifier rejects unknown duplicate symbolic and corrupted records with no extraction', async t => {
  const f = await delivery(t); await writeExportZip(f.plan, f.output); const source = await zipEntries(f.output);
  const mutations = [
    rows => rows.push({ path: 'snapshot.json', buffer: Buffer.from('private') }),
    rows => rows.push({ ...rows[0] }),
    rows => { rows[0].mode = 0o120777; },
    rows => { rows[0].buffer = Buffer.from('changed bytes'); },
    rows => { rows.splice(rows.findIndex(row => row.path === 'README.md'), 1); },
    rows => { const entry = rows.find(row => row.path === 'manifest.json'), manifest = JSON.parse(entry.buffer); manifest.extra = true; entry.buffer = Buffer.from(JSON.stringify(manifest)); },
    rows => { const entry = rows.find(row => row.path === 'manifest.json'), manifest = JSON.parse(entry.buffer); manifest.provenance.fileName = '../escaped.zip'; entry.buffer = Buffer.from(JSON.stringify(manifest)); },
    rows => { const entry = rows.find(row => row.path === 'manifest.json'), manifest = JSON.parse(entry.buffer), first = rows[0]; first.buffer = Buffer.from('changed bytes'); const record = manifest.files.find(row => row.path === first.path); record.size = first.buffer.length; record.sha256 = digest(first.buffer); entry.buffer = Buffer.from(JSON.stringify(manifest)); },
  ];
  for (const [index, mutate] of mutations.entries()) {
    const rows = source.map(row => ({ ...row, buffer: Buffer.from(row.buffer) })); mutate(rows);
    const file = path.join(f.temporary, `bad-${index}.zip`); await rewrite(file, rows); await assert.rejects(verifyBackendProjectDelivery(file), invalid);
  }
  const broken = path.join(f.temporary, 'broken.zip'); await fs.writeFile(broken, 'not zip'); await assert.rejects(verifyBackendProjectDelivery(broken), invalid);
  const after = await fs.readdir(f.temporary); assert.equal(after.some(name => name === 'content' || name === 'project'), false);
});

test('ZIP verifier rejects traversal case-collision entry kinds and oversized metadata before consuming payloads', async t => {
  const f = await delivery(t); await writeExportZip(f.plan, f.output); const source = await zipEntries(f.output);
  const collision = path.join(f.temporary, 'collision.zip'); await rewrite(collision, [...source, { path: 'readme.md', buffer: Buffer.from('bad') }]);
  await assert.rejects(verifyBackendProjectDelivery(collision), invalid);
  const traversal = path.join(f.temporary, 'traversal.zip'); await rewrite(traversal, [{ path: 'aaaa/secret', buffer: Buffer.from('secret') }]);
  const bytes = await fs.readFile(traversal); for (let at = bytes.indexOf('aaaa/secret'); at >= 0; at = bytes.indexOf('aaaa/secret', at + 1)) bytes.write('../x/secret', at); await fs.writeFile(traversal, bytes);
  await assert.rejects(verifyBackendProjectDelivery(traversal), invalid);
  const huge = path.join(f.temporary, 'huge.zip'); await rewrite(huge, [{ path: 'manifest.json', buffer: Buffer.alloc(8 * 1024 * 1024 + 1) }]); await assert.rejects(verifyBackendProjectDelivery(huge), invalid);
  const directory = path.join(f.temporary, 'directory.zip'); await rewrite(directory, source);
  const directoryBytes = await fs.readFile(directory), header = directoryBytes.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  directoryBytes.writeUInt32LE((directoryBytes.readUInt32LE(header + 38) | 0x10) >>> 0, header + 38);
  await fs.writeFile(directory, directoryBytes); await assert.rejects(verifyBackendProjectDelivery(directory), invalid);
});

test('ZIP verifier checks extractor CRC and local header names compression flags and non-streaming sizes', async t => {
  const f = await delivery(t); await writeExportZip(f.plan, f.output);
  const original = await fs.readFile(f.output);
  const central = original.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])), local = original.readUInt32LE(central + 42);
  assert.ok(original.readUInt16LE(local + 6) & 8, 'the existing streaming writer legitimately leaves local CRC unset');
  assert.equal(original.readUInt32LE(local + 14), 0);
  await verifyBackendProjectDelivery(f.output);
  const mutations = [
    bytes => bytes.writeUInt32LE((bytes.readUInt32LE(central + 16) ^ 1) >>> 0, central + 16),
    bytes => { bytes[local + 30] ^= 1; },
    bytes => bytes.writeUInt16LE(bytes.readUInt16LE(local + 8) === 0 ? 8 : 0, local + 8),
    bytes => bytes.writeUInt16LE(bytes.readUInt16LE(local + 6) ^ 0x800, local + 6),
    bytes => { bytes.writeUInt16LE(bytes.readUInt16LE(local + 6) & ~8, local + 6); bytes.writeUInt16LE(bytes.readUInt16LE(central + 8) & ~8, central + 8); },
  ];
  for (const [index, mutate] of mutations.entries()) {
    const bytes = Buffer.from(original); mutate(bytes);
    const file = path.join(f.temporary, `header-corrupt-${index}.zip`); await fs.writeFile(file, bytes);
    await assert.rejects(verifyBackendProjectDelivery(file), invalid);
  }
});
