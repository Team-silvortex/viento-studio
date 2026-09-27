import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { canonicalJson } from '../../engine/world-projection.mjs';
import { readWorkspace, withRegistryLock } from './workspace.mjs';
import { workspacePaths } from './project-layout.mjs';
import { resolveContainedPath } from './contained-path.mjs';
import { writeDocumentAtomically } from './doc-file-store.mjs';
import { readTransactionStatus, readTransactionFile, transactionPath, transactionHash, transactionError,
} from './world-transaction-state.mjs';

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const hash = /^sha256:[a-f0-9]{64}$/;
const conflict = () => transactionError('world_recovery_conflict', 'Transaction sources changed externally; preserve the journal and resolve the conflict');
const invalid = () => transactionError('world_journal_invalid', 'Transaction journal is invalid; no recovery files were published');
const noop = async () => {};

async function syncDirectory(directory) {
  const handle = await fs.open(directory, 'r');
  try { await handle.sync(); } finally { await handle.close(); }
}
async function durableWrite(file, bytes) {
  await writeDocumentAtomically(file, bytes);
  await syncDirectory(path.dirname(file));
}
async function sourceSnapshot(root, sourcePath) {
  const file = await resolveContainedPath(root, path.join(root, sourcePath));
  const handle = await fs.open(file, 'r');
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > 8 * 1024 * 1024) throw conflict();
    const bytes = Buffer.alloc(stat.size + 1);
    let size = 0;
    while (size < bytes.length) {
      const { bytesRead } = await handle.read(bytes, size, bytes.length - size, null);
      if (!bytesRead) break;
      size += bytesRead;
    }
    if (size !== stat.size) throw conflict();
    return { file, stats: stat, bytes: bytes.subarray(0, size), revision: transactionHash(bytes.subarray(0, size)) };
  } finally { await handle.close(); }
}
const sourceTemporaryName = (intent, index) => `.viento-${intent.id}-${index}.tmp`;
async function sourceTemporary(root, intent, index) {
  const candidate = path.join(root, path.dirname(intent.entries[index].sourcePath), sourceTemporaryName(intent, index));
  const file = await resolveContainedPath(root, candidate, { allowMissing: true });
  try { if (!(await fs.lstat(file)).isFile()) throw conflict(); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  return file;
}
async function publishSource(root, intent, index, bytes, expectedRevision, ready = noop) {
  const entry = intent.entries[index];
  const previous = await sourceSnapshot(root, entry.sourcePath);
  if (previous.revision !== expectedRevision) throw conflict();
  await writeDocumentAtomically(previous.file, bytes, { previousStats: { ...previous.stats, mode: entry.mode }, temporaryName: sourceTemporaryName(intent, index),
    beforePublish: async () => {
      await ready();
      if ((await sourceSnapshot(root, entry.sourcePath)).revision !== expectedRevision) throw conflict();
    } });
  await syncDirectory(path.dirname(previous.file));
}
function receiptFor(intent, committed) {
  return { format: 'viento-transaction-receipt', schemaVersion: 1, transactionId: intent.id,
    worldId: intent.worldId, proposalId: intent.proposalId, baseRevision: intent.baseRevision,
    revision: committed ? intent.revision : intent.baseRevision, state: committed ? 'committed' : 'rolled-back' };
}
async function retire(root, intent) {
  const retired = await transactionPath(root, `cleanup-${intent.id}`);
  await fs.rename(await transactionPath(root, 'active'), retired);
  await syncDirectory(await transactionPath(root));
  // Once retired, this directory is garbage, never an input to recovery.
  await fs.rm(retired, { recursive: true, force: true }).catch(() => {});
}
async function loadIntent(root) {
  const bytes = await readTransactionFile(root, 'active/intent.json', 65536);
  const intent = JSON.parse(bytes), workspace = readWorkspace(root);
  const documents = workspacePaths(workspace).documents;
  if (intent.format !== 'viento-source-transaction' || intent.version !== 1 || !uuid.test(intent.id)
    || intent.projectId !== workspace?.id || intent.manifestHash !== transactionHash(canonicalJson(workspace))
    || typeof intent.worldId !== 'string' || !/^proposal:[a-f0-9]{64}$/.test(intent.proposalId)
    || !hash.test(intent.baseRevision) || !hash.test(intent.revision)
    || intent.previousHead !== null && !hash.test(intent.previousHead)
    || !Array.isArray(intent.entries) || !intent.entries.length || intent.entries.length > 32) throw invalid();
  const seen = new Set(), objects = new Set(), images = [];
  let total = 0;
  for (const [index, entry] of intent.entries.entries()) {
    if (!uuid.test(entry.objectId) || typeof entry.sourcePath !== 'string' || entry.sourcePath.includes('\\')
      || !entry.sourcePath.startsWith(`${documents}/`) || entry.sourcePath.split('/').some(part => !part || part === '.' || part === '..')
      || !hash.test(entry.before) || !hash.test(entry.after) || !Number.isInteger(entry.mode) || entry.mode < 0 || entry.mode > 0o777
      || seen.has(entry.sourcePath) || objects.has(entry.objectId)) throw invalid();
    seen.add(entry.sourcePath); objects.add(entry.objectId);
    const metadata = await resolveContainedPath(root, path.join(root, 'metadata/documents', `${entry.objectId}.json`));
    const metadataStat = await fs.stat(metadata);
    if (!metadataStat.isFile() || metadataStat.size > 1024 * 1024) throw invalid();
    const record = JSON.parse(await fs.readFile(metadata));
    if (record.id !== entry.objectId || record.sourcePath !== entry.sourcePath) throw conflict();
    const before = await readTransactionFile(root, `active/${index}.before`, 8 * 1024 * 1024);
    const after = await readTransactionFile(root, `active/${index}.after`, 8 * 1024 * 1024);
    total += before.length + after.length;
    if (total > 32 * 1024 * 1024 || transactionHash(before) !== entry.before || transactionHash(after) !== entry.after) throw invalid();
    images.push({ before, after });
  }
  let committed = false;
  try {
    const marker = JSON.parse(await readTransactionFile(root, 'active/commit.json', 1024));
    if (marker.id !== intent.id || marker.intentHash !== transactionHash(bytes)) throw invalid();
    committed = true;
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const { token, receipt } = await readTransactionStatus(root);
  if (token !== intent.previousHead && canonicalJson(receipt) !== canonicalJson(receiptFor(intent, committed))) throw invalid();
  return { intent, images, committed };
}

// Must be called while holding the registry lock. All inputs and all targets
// are checked before the first recovery write. An external edit never loses.
async function recoverLocked(root, checkpoint = noop) {
  if (!(await readTransactionStatus(root)).pending) return { status: 'idle' };
  try {
    const { intent, images, committed } = await loadIntent(root);
    const current = [], temporary = [];
    for (const [index, entry] of intent.entries.entries()) {
      const snapshot = await sourceSnapshot(root, entry.sourcePath);
      if (![entry.before, entry.after].includes(snapshot.revision)) throw conflict();
      current.push(snapshot.revision);
      temporary.push(await sourceTemporary(root, intent, index));
    }
    for (const [index, entry] of intent.entries.entries()) {
      const target = committed ? entry.after : entry.before;
      await fs.rm(temporary[index], { force: true });
      if (current[index] !== target) await publishSource(root, intent, index, committed ? images[index].after : images[index].before, current[index]);
      await checkpoint('recovery-file', { index, committed });
    }
    for (const entry of intent.entries) if ((await sourceSnapshot(root, entry.sourcePath)).revision !== (committed ? entry.after : entry.before)) throw conflict();
    const receipt = receiptFor(intent, committed);
    await durableWrite(await transactionPath(root, 'head.json'), JSON.stringify(receipt));
    await checkpoint('recovery-head', { committed });
    await retire(root, intent);
    return { status: committed ? 'committed' : 'rolled-back', receipt };
  } catch (error) {
    if (error.errorCode?.startsWith('world_')) throw error;
    throw invalid();
  }
}

export async function recoverWorldTransaction(root, { checkpoint = noop } = {}) {
  root = await fs.realpath(root);
  if (!(await readTransactionStatus(root)).pending) return { status: 'idle' };
  return withRegistryLock(root, () => recoverLocked(root, checkpoint), { allowPendingWorldTransaction: true });
}

// The caller holds the registry lock and has validated the complete plan.
export async function commitWorldTransaction(root, plan, { checkpoint = noop, beforeIntent = noop } = {}) {
  const { result } = plan, plans = plan.plans.filter(item => item.beforeContent !== item.afterContent);
  if (!plans.length) return { ...result, status: 'unchanged' };
  const state = await readTransactionStatus(root);
  if (state.pending) throw transactionError('world_recovery_required', 'Recover the unfinished transaction first');
  const id = randomUUID(), directory = await transactionPath(root), stage = await transactionPath(root, `staging-${id}`);
  const workspace = readWorkspace(root);
  const intent = { format: 'viento-source-transaction', version: 1, id, projectId: workspace.id,
    manifestHash: transactionHash(canonicalJson(workspace)), worldId: result.worldId, proposalId: result.proposal.id,
    baseRevision: result.baseRevision, revision: result.revision, previousHead: state.token, entries: [] };
  let active = false, committed = false;
  try {
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    await fs.chmod(directory, 0o700);
    // Directory durability is required; unsupported hosts fail before any source
    // changes. This is a process-crash protocol, not a hardware certification.
    await syncDirectory(root); await syncDirectory(path.dirname(directory)); await syncDirectory(directory);
    await fs.mkdir(stage, { mode: 0o700 });
    for (const [index, item] of plans.entries()) {
      const snapshot = await sourceSnapshot(root, item.sourcePath);
      if (snapshot.revision !== item.change.beforeSourceRevision) throw conflict();
      intent.entries.push({ objectId: item.change.objectId, sourcePath: item.sourcePath,
        before: item.change.beforeSourceRevision, after: item.change.afterSourceRevision, mode: snapshot.stats.mode & 0o777 });
      try { await fs.lstat(await sourceTemporary(root, intent, index)); throw conflict(); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      await durableWrite(path.join(stage, `${index}.before`), item.beforeContent);
      await durableWrite(path.join(stage, `${index}.after`), item.afterContent);
    }
    const intentBytes = JSON.stringify(intent);
    await durableWrite(path.join(stage, 'intent.json'), intentBytes);
    await beforeIntent();
    await fs.rename(stage, await transactionPath(root, 'active')); active = true;
    await syncDirectory(directory); await checkpoint('intent', { id });
    for (const [index, entry] of intent.entries.entries()) {
      await publishSource(root, intent, index, plans[index].afterContent, entry.before, () => checkpoint('source-ready', { index, id }));
      await checkpoint('data', { index, id });
    }
    for (const entry of intent.entries) if ((await sourceSnapshot(root, entry.sourcePath)).revision !== entry.after) throw conflict();
    await durableWrite(await transactionPath(root, 'active/commit.json'), JSON.stringify({ id, intentHash: transactionHash(intentBytes) }));
    committed = true; await checkpoint('commit', { id });
    const receipt = receiptFor(intent, true);
    await durableWrite(await transactionPath(root, 'head.json'), JSON.stringify(receipt));
    await checkpoint('head', { id });
    await retire(root, intent); active = false;
    return { ...result, status: 'applied', receipt };
  } catch (error) {
    if (active) {
      const recovery = await recoverLocked(root);
      if (recovery.status === 'committed') return { ...result, status: 'applied', receipt: recovery.receipt };
      if (recovery.status === 'idle' && committed) return { ...result, status: 'applied', receipt: receiptFor(intent, true) };
      if (committed) throw invalid();
    }
    throw error;
  } finally {
    await fs.rm(stage, { recursive: true, force: true }).catch(() => {});
  }
}
