import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { resolveContainedPath } from './contained-path.mjs';
import { createError } from '../../engine/service-error.mjs';
import { readPackageFence } from './resource-package-state.mjs';

export const transactionError = (code, message) => createError(409, message, {}, code);
export const transactionHash = bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
export const TRANSACTION_DIRECTORY = '.viento/world-transactions';
export async function transactionPath(root, name = '') {
  return resolveContainedPath(root, path.join(root, TRANSACTION_DIRECTORY, name), { allowMissing: true });
}
export async function readTransactionFile(root, name, limit) {
  const file = await transactionPath(root, name);
  const handle = await fs.open(file, 'r');
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > limit) throw transactionError('world_journal_invalid', 'Invalid transaction file');
    const bytes = Buffer.alloc(stat.size + 1);
    let size = 0;
    while (size < bytes.length) {
      const { bytesRead } = await handle.read(bytes, size, bytes.length - size, null);
      if (!bytesRead) break;
      size += bytesRead;
    }
    if (size !== stat.size) throw transactionError('world_journal_invalid', 'Transaction file changed while reading');
    return bytes.subarray(0, size);
  } finally { await handle.close(); }
}
export function validateTransactionReceipt(receipt) {
  return receipt?.format === 'viento-transaction-receipt' && receipt.schemaVersion === 1 && Object.keys(receipt).length === 8
    && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(receipt.transactionId) && ['committed', 'rolled-back'].includes(receipt.state)
    && typeof receipt.worldId === 'string' && receipt.worldId.length > 0 && /^proposal:[a-f0-9]{64}$/.test(receipt.proposalId)
    && /^sha256:[a-f0-9]{64}$/.test(receipt.baseRevision) && /^sha256:[a-f0-9]{64}$/.test(receipt.revision);
}
export async function readTransactionStatus(root) {
  try {
    let pending = false, receipt = null, token = null;
    try { await fs.lstat(await transactionPath(root, 'active')); pending = true; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    try {
      const bytes = await readTransactionFile(root, 'head.json', 8192);
      receipt = JSON.parse(bytes); token = transactionHash(bytes);
      if (!validateTransactionReceipt(receipt)) throw new Error('Invalid receipt');
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    return { pending, receipt, token };
  } catch (error) {
    if (error.errorCode?.startsWith('world_')) throw error;
    throw transactionError('world_journal_invalid', 'Cannot read transaction state; preserve it for recovery');
  }
}
export async function readWorldFence(root) {
  const { pending, token } = await readTransactionStatus(root);
  if (pending) throw transactionError('world_recovery_required', 'A transaction is unfinished; recover before reading or writing');
  const packageToken = await readPackageFence(root);
  return packageToken ? transactionHash(JSON.stringify([token, packageToken])) : token;
}
export async function assertWorldFence(root, token) {
  if (await readWorldFence(root) !== token) throw transactionError('world_read_conflict', 'A transaction completed during this read; retry');
}
