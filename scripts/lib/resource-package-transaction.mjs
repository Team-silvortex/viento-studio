import fs from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { withRegistryLock, readWorkspace, readRegistry, resolveAssetRoot, portablePath, assertPortableFileTree } from './workspace.mjs';
import { packageDigest, readPackageBytes } from './resource-package-catalog.mjs';
import { packageFileHash } from './resource-package-export.mjs';
import { planPackageImport, packageDestination } from './resource-package-import.mjs';
import { packageTransactionPath, packageImportPending } from './resource-package-state.mjs';
import { readTransactionStatus } from './world-transaction-state.mjs';
import { workspacePaths, validateProjectTypes } from './project-layout.mjs';
import { resolveContainedPath } from './contained-path.mjs';
import { PACKAGE_UUID } from './resource-package-reader.mjs';
import { PACKAGE_LIMITS, packageError } from '../../engine/resource-package.mjs';
import { canonicalJson } from '../../engine/world-projection.mjs';

async function syncFile(file) { const handle = await fs.open(file, 'r'); try { await handle.sync(); } finally { await handle.close(); } }
async function syncDirectory(directory) {
  const handle = await fs.open(directory, 'r');
  try { await handle.sync(); } catch (error) { if (!['EINVAL', 'ENOTSUP', 'EBADF'].includes(error.code)) throw error; }
  finally { await handle.close(); }
}
async function sameFile(file, expected) {
  try {
    const actual = await packageFileHash(path.dirname(file), path.basename(file));
    return actual.size === expected.size && actual.sha256 === expected.sha256;
  } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
const recoveryError = () => packageError('资源包导入尚未完成，请先恢复导入', 409);

async function finishImport(root, intent, { checkpoint = async () => {} } = {}) {
  const active = await packageTransactionPath(root, 'active');
  const current = readWorkspace(root), paths = workspacePaths(current);
  if (intent?.format !== 'viento-package-import' || intent.version !== 1 || !PACKAGE_UUID.test(intent.id)
    || intent.workspaceId !== current.id || intent.assetRoot !== resolveAssetRoot(root) || !Array.isArray(intent.files)
    || !Array.isArray(intent.reused) || intent.files.length + intent.reused.length > PACKAGE_LIMITS.files
    || !Number.isInteger(intent.mode) || intent.mode < 0 || intent.mode > 0o777
    || typeof intent.before !== 'string' || typeof intent.after !== 'string') throw recoveryError();
  const before = Buffer.from(intent.before, 'base64'), after = Buffer.from(intent.after, 'base64');
  let beforeValue, afterValue;
  try { beforeValue = JSON.parse(before); afterValue = JSON.parse(after); validateProjectTypes(afterValue); } catch { throw recoveryError(); }
  const { documentTypes: oldTypes, ...oldRest } = beforeValue, { documentTypes: newTypes, ...newRest } = afterValue;
  if (canonicalJson(oldRest) !== canonicalJson(newRest) || (oldTypes || []).some((type, i) => canonicalJson(type) !== canonicalJson(newTypes?.[i]))) throw recoveryError();
  const workspaceBytes = await readPackageBytes(root, 'workspace.json');
  if (!workspaceBytes.equals(before) && !workspaceBytes.equals(after)) throw recoveryError();
  const names = new Set();
  // Validate the whole journal and all staged bytes before continuing a commit.
  const allFiles = [...intent.files, ...intent.reused];
  for (let i = 0; i < allFiles.length; i += 1) {
    const file = allFiles[i];
    if (!file || !portablePath(file.path) || !['assets', 'project'].includes(file.store)
      || !Number.isSafeInteger(file.size) || file.size < 0 || file.size > PACKAGE_LIMITS.fileBytes || !/^[a-f0-9]{64}$/.test(file.sha256)
      || (file.store === 'project' && !file.path.startsWith(`${paths.documents}/`) && !file.path.startsWith(`${paths.templates}/`)
        && !/^metadata\/(documents|assets)\/[0-9a-f-]{36}\.json$/.test(file.path))
      || names.has(`${file.store}/${file.path}`)) throw recoveryError();
    names.add(`${file.store}/${file.path}`);
    if (i < intent.files.length && !await sameFile(await resolveContainedPath(root, path.join(active, 'payload', String(i))), file)) throw recoveryError();
    const target = await packageDestination(root, intent.assetRoot, file.store, file.path);
    const match = await sameFile(target, file);
    if (match === false || (i >= intent.files.length && match !== true)) throw recoveryError();
  }
  assertPortableFileTree(names);
  for (let i = 0; i < intent.files.length; i += 1) {
    const file = intent.files[i], target = await packageDestination(root, intent.assetRoot, file.store, file.path);
    const temporary = path.join(path.dirname(target), `.viento-import-${intent.id}-${i}.tmp`);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await packageDestination(root, intent.assetRoot, file.store, file.path);
    const base = file.store === 'assets' && intent.assetRoot !== path.join(root, 'assets') ? intent.assetRoot : root;
    await resolveContainedPath(base, temporary, { allowMissing: true });
    if (await sameFile(target, file) !== true) {
      // A journal-owned temporary may contain a partial copy after interruption.
      // Final paths are only published as complete, exclusive hard links.
      await fs.rm(temporary, { force: true });
      try { await fs.link(path.join(active, 'payload', String(i)), temporary); await fs.chmod(temporary, 0o644); }
      catch (error) {
        if (error.code !== 'EXDEV') throw error;
        await pipeline(createReadStream(path.join(active, 'payload', String(i))), createWriteStream(temporary, { flags: 'wx', mode: 0o644 }));
      }
      await syncFile(temporary);
      if (!await sameFile(temporary, file)) throw recoveryError();
      try { await fs.link(temporary, target); }
      catch (error) { if (error.code !== 'EEXIST' || !await sameFile(target, file)) throw error; }
    }
    await fs.rm(temporary, { force: true });
    await syncDirectory(path.dirname(target));
    await checkpoint({ phase: 'file', index: i });
  }
  if (!before.equals(after)) {
    const live = await readPackageBytes(root, 'workspace.json');
    if (!live.equals(before) && !live.equals(after)) throw recoveryError();
    if (!live.equals(after)) {
      const temporary = await packageTransactionPath(root, 'active/workspace.json');
      await fs.writeFile(temporary, after); await fs.chmod(temporary, intent.mode); await syncFile(temporary);
      await fs.rename(temporary, path.join(root, 'workspace.json')); await syncDirectory(root);
    }
  }
  await checkpoint({ phase: 'manifest' });
  for (const file of allFiles) if (!await sameFile(await packageDestination(root, intent.assetRoot, file.store, file.path), file)) throw recoveryError();
  if (!(await readPackageBytes(root, 'workspace.json')).equals(after) || resolveAssetRoot(root) !== intent.assetRoot) throw recoveryError();
  await readRegistry(root, { allowPendingWorldTransaction: true });
  const head = await packageTransactionPath(root, 'head'), headTemporary = await packageTransactionPath(root, 'active/head');
  await fs.writeFile(headTemporary, `${intent.id}\n`); await syncFile(headTemporary);
  await fs.rename(headTemporary, head); await syncDirectory(path.dirname(head));
  // Retire by rename before cleanup: an interrupted recursive removal must not
  // leave a half-deleted active journal that prevents reading a committed import.
  const retired = await packageTransactionPath(root, `completed-${intent.id}`);
  await fs.rename(active, retired); await syncDirectory(path.dirname(active));
  await fs.rm(retired, { recursive: true, force: true }).catch(() => {});
  return { status: 'imported', ...intent.summary };
}

export async function applyPackageImport(root, pack, revision, signal, options = {}) {
  return withRegistryLock(root, async () => {
    signal?.throwIfAborted();
    const plan = await planPackageImport(root, pack, signal);
    if (plan.summary.conflicts.length) throw packageError('导入存在冲突，请先处理冲突后重新预览', 409);
    if (typeof revision !== 'string' || revision !== plan.revision) throw packageError('目标项目已变化，请重新预览导入', 409);
    if (!plan.summary.newFiles && plan.workspaceBefore.equals(plan.workspaceAfter)) return { status: 'imported', ...plan.summary };
    const id = randomUUID(), preparing = await packageTransactionPath(root, `preparing-${id}`);
    const journalRoot = await packageTransactionPath(root); await fs.mkdir(journalRoot, { recursive: true, mode: 0o700 });
    for (const item of await fs.readdir(journalRoot, { withFileTypes: true })) {
      if (!item.isDirectory() || !/^(preparing|completed)-[a-f0-9-]{36}$/.test(item.name)) continue;
      const directory = path.join(journalRoot, item.name);
      if (Date.now() - (await fs.stat(directory)).mtimeMs > 24 * 60 * 60 * 1000) await fs.rm(directory, { recursive: true });
    }
    await fs.mkdir(path.join(preparing, 'payload'), { recursive: true, mode: 0o700 });
    let published = false;
    try {
      const entries = plan.files.filter(file => !file.reuse);
      for (let i = 0; i < entries.length; i += 1) {
        signal?.throwIfAborted();
        const entry = entries[i], target = path.join(preparing, 'payload', String(i));
        if (entry.buffer) await fs.writeFile(target, entry.buffer, { flag: 'wx', mode: 0o600 });
        else await fs.link(await resolveContainedPath(pack.content, path.join(pack.content, entry.source)), target);
        await syncFile(target);
        if (!await sameFile(target, entry.expected)) throw packageError('资源包格式无效、文件损坏或版本不受支持');
      }
      const intent = { format: 'viento-package-import', version: 1, id, workspaceId: plan.workspace.id, assetRoot: plan.assetRoot,
        mode: (await fs.stat(path.join(root, 'workspace.json'))).mode & 0o777,
        before: plan.workspaceBefore.toString('base64'), after: plan.workspaceAfter.toString('base64'),
        files: entries.map(file => ({ store: file.store, path: file.path, ...file.expected })),
        reused: plan.files.filter(file => file.reuse).map(file => ({ store: file.store, path: file.path, ...file.expected })), summary: plan.summary };
      const bytes = Buffer.from(JSON.stringify(intent));
      if (bytes.length > PACKAGE_LIMITS.jsonBytes) throw packageError('资源包中的正文或元数据超过大小限制');
      await fs.writeFile(path.join(preparing, 'intent.json'), bytes, { flag: 'wx', mode: 0o600 });
      await syncFile(path.join(preparing, 'intent.json')); await syncDirectory(path.join(preparing, 'payload')); await syncDirectory(preparing);
      if ((await planPackageImport(root, pack, signal)).revision !== revision) throw packageError('目标项目已变化，请重新预览导入', 409);
      signal?.throwIfAborted();
      await fs.rename(preparing, await packageTransactionPath(root, 'active')); published = true;
      await syncDirectory(path.dirname(preparing));
      // From publication onward the durable transaction owns the work, even if
      // its HTTP client disconnects. Recovery can finish after a process crash.
      await options.checkpoint?.({ phase: 'prepared' });
      return await finishImport(root, intent, options);
    } finally { if (!published) await fs.rm(preparing, { recursive: true, force: true }); }
  });
}

export async function recoverPackageImport(root, options = {}) {
  return withRegistryLock(root, async () => {
    if ((await readTransactionStatus(root)).pending) throw packageError('请先恢复对象事务，再恢复资源包导入', 409);
    if (!await packageImportPending(root)) return { status: 'idle' };
    let intent;
    try { intent = JSON.parse(await readPackageBytes(root, '.viento/package-import/active/intent.json')); }
    catch { throw recoveryError(); }
    return finishImport(root, intent, options);
  }, { allowPendingWorldTransaction: true });
}
