import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { resolveContainedPath } from './contained-path.mjs';
import { packageError } from '../../engine/resource-package.mjs';

export const PACKAGE_TRANSACTION = '.viento/package-import';
export async function packageTransactionPath(root, relative = '') {
  return resolveContainedPath(root, path.join(root, PACKAGE_TRANSACTION, relative), { allowMissing: true });
}
export async function packageImportPending(root) {
  try { await fs.lstat(await packageTransactionPath(root, 'active')); return true; }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}
export async function readPackageFence(root) {
  if (await packageImportPending(root)) throw Object.assign(packageError('资源包导入尚未完成，请先恢复导入', 409), { errorCode: 'resource_package_recovery_required' });
  try {
    const file = await packageTransactionPath(root, 'head');
    if ((await fs.stat(file)).size > 128) throw packageError('资源包导入记录无效');
    const value = await fs.readFile(file, 'utf8');
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\n$/.test(value)) throw packageError('资源包导入记录无效');
    return createHash('sha256').update(value).digest('hex');
  } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
