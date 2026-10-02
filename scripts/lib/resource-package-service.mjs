import fs from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { resolveContainedPath } from './contained-path.mjs';
import { readPackageCatalog, publicPackageCatalog } from './resource-package-catalog.mjs';
import { unpackResourcePackage, PACKAGE_UUID } from './resource-package-reader.mjs';
import { planPackageImport } from './resource-package-import.mjs';
import { applyPackageImport, recoverPackageImport } from './resource-package-transaction.mjs';
import { packageImportPending } from './resource-package-state.mjs';
import { PACKAGE_LIMITS, packageError } from '../../engine/resource-package.mjs';

export function createResourcePackageService(root, { ttlMs = 15 * 60 * 1000, imported = () => {} } = {}) {
  const jobs = new Map(); let busy = false;
  function retain(job) {
    clearTimeout(job.timer);
    if (!job.users && !job.released) { job.timer = setTimeout(() => { void release(job.id).catch(() => {}); }, ttlMs); job.timer.unref?.(); }
    return job;
  }
  async function release(id) {
    const job = jobs.get(id); if (!job) return;
    clearTimeout(job.timer); job.released = true;
    if (job.users) return;
    job.removing ??= fs.rm(job.directory, { recursive: true, force: true }).then(() => jobs.delete(id)).catch(error => {
      job.timer = setTimeout(() => { void release(id).catch(() => {}); }, Math.min(ttlMs, 30000)); job.timer.unref?.(); throw error;
    }).finally(() => { job.removing = null; });
    return job.removing;
  }
  const result = (job, plan) => ({ id: job.id, revision: plan.revision, ...plan.summary });
  async function inspect(input, signal) {
    if (busy) throw packageError('正在处理另一份资源包，请稍候', 409);
    if (jobs.size >= 3) throw packageError('请先关闭其他资源包预览后重试', 409);
    busy = true; let job;
    try {
      signal?.throwIfAborted();
      const cache = await resolveContainedPath(root, path.join(root, '.viento/cache/resource-packages'), { allowMissing: true });
      await fs.mkdir(cache, { recursive: true, mode: 0o700 });
      await resolveContainedPath(root, cache);
      for (const item of await fs.readdir(cache, { withFileTypes: true })) {
        if (!item.isDirectory() || !PACKAGE_UUID.test(item.name) || jobs.has(item.name)) continue;
        const file = path.join(cache, item.name);
        if (Date.now() - (await fs.stat(file)).mtimeMs > 24 * 60 * 60 * 1000) await fs.rm(file, { recursive: true });
      }
      const id = randomUUID(), directory = path.join(cache, id); await fs.mkdir(directory, { mode: 0o700 });
      job = { id, directory, users: 1, released: false }; jobs.set(id, job);
      const zip = path.join(directory, 'package.zip'); let size = 0;
      const limited = new Transform({ transform(chunk, encoding, done) {
        size += chunk.length;
        if (size > PACKAGE_LIMITS.fileBytes) return done(packageError('资源包压缩文件超过 8 GiB 限制', 413));
        done(null, chunk);
      } });
      await pipeline(input, limited, createWriteStream(zip, { flags: 'wx', mode: 0o600 }), { signal });
      job.pack = await unpackResourcePackage(zip, directory, signal);
      await fs.rm(zip);
      const plan = await planPackageImport(root, job.pack, signal);
      signal?.throwIfAborted();
      return result(job, plan);
    } catch (error) {
      if (job) job.released = true;
      if (error.code === 'ENOSPC') throw packageError('磁盘空间不足，无法导入资源包');
      throw error;
    } finally {
      busy = false;
      if (job) { job.users -= 1; if (job.released) await release(job.id).catch(() => {}); else retain(job); }
    }
  }
  async function command(payload, signal) {
    if (payload?.action === 'release') { await release(payload.id); return { released: true }; }
    if (busy) throw packageError('正在处理另一份资源包，请稍候', 409);
    if (payload?.action === 'recover') {
      busy = true;
      try { const result = await recoverPackageImport(root); if (result.status === 'imported') await imported(); return result; }
      finally { busy = false; }
    }
    if (!['preview', 'import'].includes(payload?.action)) throw packageError('资源包操作无效');
    const job = PACKAGE_UUID.test(payload.id || '') && jobs.get(payload.id);
    if (!job || job.released) throw packageError('资源包预览已过期，请重新选择文件', 410);
    busy = true; job.users += 1; clearTimeout(job.timer);
    try {
      if (payload.action === 'preview') return result(job, await planPackageImport(root, job.pack, signal));
      const result = await applyPackageImport(root, job.pack, payload.revision, signal);
      job.released = true; await imported(); return result;
    } finally { busy = false; job.users -= 1; if (job.released) await release(job.id).catch(() => {}); else retain(job); }
  }
  return { catalog: async signal => publicPackageCatalog(await readPackageCatalog(root, signal)), inspect, command,
    status: async () => ({ pending: await packageImportPending(root) }), release };
}
