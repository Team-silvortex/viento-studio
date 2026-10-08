import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { validateRuntimeCaseReport, RUNTIME_CASE_REPORT_FILE_MAX_BYTES } from '../../engine/runtime-case-report.mjs';
import { canonicalJson } from '../../engine/canonical-json.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const statuses = { runtime_report_invalid: 422, runtime_report_limit: 413, runtime_report_changed: 409, runtime_report_unavailable: 404 };
const invalid = (code = 'runtime_report_invalid', cause) => Object.assign(
  new Error('The owned runtime case report is unavailable or invalid.', cause ? { cause } : undefined), { errorCode: code, statusCode: statuses[code] });
const identity = stat => `${stat.dev}:${stat.ino}`;
const stamp = stat => `${identity(stat)}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
const contextKeys = ['sceneSourcePath', 'sceneObjectId', 'buildId', 'snapshotId', 'backendId',
  'suiteDocumentId', 'suiteSourceVersion', 'documentId', 'sourceVersion', 'sessionId'];

function fields(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw invalid();
  const descriptors = Object.getOwnPropertyDescriptors(value), names = Reflect.ownKeys(descriptors);
  if (names.length !== keys.length || names.some(key => !keys.includes(key))
    || keys.some(key => !Object.hasOwn(descriptors, key) || !descriptors[key].enumerable || !Object.hasOwn(descriptors[key], 'value'))) throw invalid();
  return Object.fromEntries(keys.map(key => [key, descriptors[key].value]));
}

// This pin is private host authority. Copy it before any await so a caller
// cannot redirect an in-flight read; HTTP never receives or supplies its path.
function capturePin(input) {
  const value = fields(input, ['documentId', 'sha256', 'path', 'context', 'definitionSha256']);
  const context = fields(value.context, contextKeys);
  if (!uuid(value.documentId) || !digest(value.sha256) || !digest(value.definitionSha256)
    || typeof value.path !== 'string' || context.documentId !== value.documentId
    || Object.values(context).some(item => item !== null && typeof item !== 'string')) throw invalid();
  return Object.freeze({ ...value, context: Object.freeze(context) });
}

// Reject links in the complete host-owned directory chain. The receipt was
// already selected by the scheduler; no author root, build or tool is opened.
async function directorySnapshot(directory, signal) {
  signal?.throwIfAborted();
  if (typeof directory !== 'string' || !path.isAbsolute(directory) || path.resolve(directory) !== directory) throw invalid();
  const absoluteRoot = path.parse(directory).root;
  const components = [absoluteRoot];
  let current = absoluteRoot;
  for (const component of path.relative(absoluteRoot, directory).split(path.sep).filter(Boolean)) {
    current = path.join(current, component); components.push(current);
  }
  const entries = [];
  for (const component of components) {
    signal?.throwIfAborted();
    const stat = await fs.lstat(component);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw invalid('runtime_report_changed');
    entries.push(identity(stat));
  }
  return entries;
}

async function assertDirectory(directory, expected, signal) {
  const actual = await directorySnapshot(directory, signal);
  if (canonicalJson(actual) !== canonicalJson(expected)) throw invalid('runtime_report_changed');
}

function reportFile(directory, documentId) {
  if (typeof directory !== 'string' || !path.isAbsolute(directory) || path.resolve(directory) !== directory || !uuid(documentId)) throw invalid();
  return path.join(directory, `member-${documentId}.json`);
}

function mappedError(error, signal) {
  signal?.throwIfAborted();
  if (Object.hasOwn(statuses, error?.errorCode)) return error;
  const code = error?.errorCode === 'runtime_case_report_limit' ? 'runtime_report_limit'
    : error?.code === 'ENOENT' ? 'runtime_report_unavailable'
      : ['EEXIST', 'ENOTDIR', 'ELOOP'].includes(error?.code) ? 'runtime_report_changed' : 'runtime_report_invalid';
  return invalid(code, error);
}

async function removeOwnedFile(file, owner) {
  if (!owner) return;
  try {
    const current = await fs.lstat(file);
    if (current.isFile() && !current.isSymbolicLink() && identity(current) === owner) await fs.unlink(file);
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
}

export async function writeRuntimeCaseReport(receiptDirectory, input, { signal } = {}) {
  // Validation returns detached, deeply frozen data and re-evaluates every
  // check before the first filesystem operation.
  let report;
  try { report = validateRuntimeCaseReport(input); } catch (error) { throw mappedError(error, signal); }
  const bytes = Buffer.from(JSON.stringify(report) + '\n');
  if (bytes.length > RUNTIME_CASE_REPORT_FILE_MAX_BYTES) throw invalid('runtime_report_limit');
  const file = reportFile(receiptDirectory, report.context.documentId);
  const pin = Object.freeze({ documentId: report.context.documentId, sha256: hash(bytes), path: file,
    context: report.context, definitionSha256: hash(canonicalJson(report.definition)) });
  let temporary, owner, published = false, committed = false;
  try {
    const directory = await directorySnapshot(receiptDirectory, signal);
    temporary = path.join(receiptDirectory, `.member-${randomUUID()}.tmp`);
    const handle = await fs.open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL
      | (constants.O_NOFOLLOW || 0), 0o600);
    try {
      owner = identity(await handle.stat());
      await handle.writeFile(bytes); await handle.sync();
    } finally { await handle.close(); }
    await assertDirectory(receiptDirectory, directory, signal);
    const staged = await fs.lstat(temporary);
    if (!staged.isFile() || staged.isSymbolicLink() || identity(staged) !== owner || staged.size !== bytes.length) throw invalid('runtime_report_changed');
    // A member report is immutable. Publishing a hard link is atomic and
    // exclusive; unlike rename, it cannot overwrite a concurrent creator.
    await fs.link(temporary, file); published = true;
    await assertDirectory(receiptDirectory, directory, signal);
    const final = await fs.lstat(file);
    if (!final.isFile() || final.isSymbolicLink() || identity(final) !== owner || final.size !== bytes.length) throw invalid('runtime_report_changed');
    committed = true;
    return pin;
  } catch (error) { throw mappedError(error, signal); }
  finally {
    // Never delete an existing or concurrently substituted report. Remove only
    // the inode created by this write, including an uncommitted publication.
    try {
      if (temporary) await removeOwnedFile(temporary, owner);
      if (published && !committed) await removeOwnedFile(file, owner);
    } catch (error) { throw mappedError(error, signal); }
  }
}

export async function readRuntimeCaseReport(receiptDirectory, inputPin, { signal } = {}) {
  const pin = capturePin(inputPin), file = reportFile(receiptDirectory, pin.documentId);
  if (pin.path !== file) throw invalid('runtime_report_changed');
  try {
    const directory = await directorySnapshot(receiptDirectory, signal);
    const before = await fs.lstat(file);
    if (!before.isFile() || before.isSymbolicLink()) throw invalid('runtime_report_changed');
    const handle = await fs.open(file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0) | (constants.O_NONBLOCK || 0));
    let bytes;
    try {
      const opened = await handle.stat();
      if (!opened.isFile() || identity(opened) !== identity(before)) throw invalid('runtime_report_changed');
      if (opened.size > RUNTIME_CASE_REPORT_FILE_MAX_BYTES) throw invalid('runtime_report_limit');
      bytes = Buffer.alloc(opened.size + 1);
      let offset = 0;
      while (offset < bytes.length) {
        signal?.throwIfAborted();
        const result = await handle.read(bytes, offset, bytes.length - offset, null);
        if (!result.bytesRead) break;
        offset += result.bytesRead;
      }
      if (offset !== opened.size || stamp(await handle.stat()) !== stamp(opened)) throw invalid('runtime_report_changed');
      bytes = bytes.subarray(0, offset);
      const current = await fs.lstat(file);
      if (!current.isFile() || current.isSymbolicLink() || stamp(current) !== stamp(opened)) throw invalid('runtime_report_changed');
    } finally { await handle.close(); }
    await assertDirectory(receiptDirectory, directory, signal);
    if (hash(bytes) !== pin.sha256) throw invalid('runtime_report_changed');
    let parsed;
    try { parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)); }
    catch { throw invalid(); }
    const report = validateRuntimeCaseReport(parsed);
    if (canonicalJson(report.context) !== canonicalJson(pin.context)
      || hash(canonicalJson(report.definition)) !== pin.definitionSha256) throw invalid('runtime_report_changed');
    return report;
  } catch (error) { throw mappedError(error, signal); }
}
