// A host-owned recovery index, never a deletion receipt or directory scanner.
import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { validateBackendProjectManifest, BACKEND_PROJECT_MANIFEST_MAX_BYTES } from '../../engine/backend-project.mjs';

export const BACKEND_PROJECT_CATALOG_FILE = 'backend-project-catalog.json';
export const BACKEND_PROJECT_CATALOG_MAX_RECORDS = 256;
export const BACKEND_PROJECT_CATALOG_MAX_BYTES = 1024 * 1024;
const lockName = '.backend-project-catalog.lock';
const receipts = new WeakMap();
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const sha = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const revision = value => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
const backend = value => typeof value === 'string' && /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)+$/.test(value) && value.length <= 192;
const decimal = value => typeof value === 'string' && /^(?:0|[1-9][0-9]{0,31})$/.test(value);
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const error = (code = 'backend_project_catalog_invalid') => Object.assign(new Error('The backend project recovery index cannot be verified.'), { errorCode: code });
const fail = code => { throw error(code); };
const json = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
function exact(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail();
  const descriptors = Object.getOwnPropertyDescriptors(value), own = Reflect.ownKeys(descriptors);
  if (own.length !== keys.length || own.some(key => !keys.includes(key) || !descriptors[key].enumerable || !('value' in descriptors[key]))) fail();
  return Object.fromEntries(keys.map(key => [key, descriptors[key].value]));
}
function text(value, limit) {
  return typeof value === 'string' && value.length <= limit && !/[\u0000\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value);
}
function sourcePath(value) {
  if (!text(value, 4096) || !value || value.startsWith('/') || /^[A-Za-z]:\//.test(value) || value.includes('\\')) return false;
  const parts = value.split('/').filter(part => part && part !== '.');
  return parts.length > 0 && !parts.includes('..') && !parts[0].startsWith('.');
}
function physical(value) {
  const result = exact(value, ['dev', 'ino']);
  if (!decimal(result.dev) || !decimal(result.ino)) fail();
  return Object.freeze(result);
}
function directoryName(value) { return uuid(value) || typeof value === 'string' && value.startsWith('.viento-prune-') && uuid(value.slice(14)); }
function entryValue(input) {
  const project = Object.hasOwn(input || {}, 'targetId');
  const value = exact(input, ['buildId', 'snapshotId', 'manifestSha256', 'directory', 'physical', 'workspaceId',
    ...(project ? ['targetId', 'targetKind'] : ['sceneId']), 'sourcePath', 'title', 'createdAt']);
  if (!uuid(value.buildId) || !revision(value.snapshotId) || !sha(value.manifestSha256) || !directoryName(value.directory)
    || !text(value.workspaceId, 192) || !value.workspaceId || !uuid(project ? value.targetId : value.sceneId) || project && value.targetKind !== 'project' || !sourcePath(value.sourcePath)
    || !text(value.title, 160) || !text(value.createdAt, 24) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value.createdAt)
    || !Number.isFinite(Date.parse(value.createdAt)) || new Date(value.createdAt).toISOString() !== value.createdAt) fail();
  value.physical = physical(value.physical);
  return Object.freeze(value);
}
export const catalogProjectTarget = entry => Object.freeze({ objectId: entry.targetId ?? entry.sceneId, planKind: entry.targetKind ?? 'scene2d' });
const targetFields = project => project.schemaVersion === 2 ? { targetId: project.source.assemblyId, targetKind: 'project' } : { sceneId: project.source.sceneId };
const sameTarget = (left, right) => catalogProjectTarget(left).objectId === catalogProjectTarget(right).objectId
  && catalogProjectTarget(left).planKind === catalogProjectTarget(right).planKind;
const statIdentity = stat => ({ dev: stat.dev.toString(), ino: stat.ino.toString() });
const sameIdentity = (a, b) => a.dev === b.dev && a.ino === b.ino;

// Unlike author-selected roots, every ancestor of this host cache namespace is
// checked. A selected alias cannot redirect later index or project operations.
async function ancestors(directory, { create = false, missing = false } = {}) {
  const absolute = path.resolve(directory), root = path.parse(absolute).root;
  let current = root;
  for (const part of absolute.slice(root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    let stat;
    try { stat = await fs.lstat(current, { bigint: true }); }
    catch (cause) {
      if (cause.code !== 'ENOENT') throw cause;
      if (create) {
        try { await fs.mkdir(current, { mode: 0o700 }); } catch (cause) { if (cause.code !== 'EEXIST') throw cause; }
        stat = await fs.lstat(current, { bigint: true });
      } else if (missing) return null;
      else throw cause;
    }
    if (!stat.isDirectory() || stat.isSymbolicLink()) fail('backend_project_catalog_changed');
  }
  if (await fs.realpath(absolute) !== absolute) fail('backend_project_catalog_changed');
  return statIdentity(await fs.lstat(absolute, { bigint: true }));
}
async function regularBytes(file, limit, { missing = false } = {}) {
  let handle;
  try { handle = await fs.open(file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0) | (constants.O_NONBLOCK || 0)); }
  catch (cause) { if (missing && cause.code === 'ENOENT') return null; throw cause; }
  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || before.nlink !== 1n || before.size > BigInt(limit)) fail('backend_project_catalog_changed');
    const bytes = Buffer.alloc(Number(before.size) + 1); let offset = 0;
    while (offset < bytes.length) { const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, null); if (!bytesRead) break; offset += bytesRead; }
    const after = await handle.stat({ bigint: true });
    if (offset !== Number(before.size) || !sameIdentity(statIdentity(before), statIdentity(after)) || before.mtimeNs !== after.mtimeNs
      || before.ctimeNs !== after.ctimeNs || after.nlink !== 1n) fail('backend_project_catalog_changed');
    return { bytes: bytes.subarray(0, offset), physical: statIdentity(before) };
  } finally { await handle.close(); }
}
async function syncDirectory(directory) {
  const handle = await fs.open(directory, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try { await handle.sync(); } finally { await handle.close(); }
}
function parse(bytes) { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }

/** Only a catalog-produced receipt can guard an old project for read/run.
 * This receipt does not contain a write ledger and cannot authorize cleanup.
 */
export async function assertCatalogProject(entry) {
  try {
    const receipt = receipts.get(entry);
    if (!receipt) fail('backend_project_catalog_invalid');
    await receipt.assertNamespace();
    const directory = path.join(receipt.namespace, entry.directory), found = await ancestors(directory);
    if (!sameIdentity(found, entry.physical)) fail('backend_project_owner_changed');
    const stored = await regularBytes(path.join(directory, 'backend-project.json'), BACKEND_PROJECT_MANIFEST_MAX_BYTES);
    if (hash(stored.bytes) !== entry.manifestSha256) fail('backend_project_changed');
    const project = validateBackendProjectManifest(parse(stored.bytes));
    if (project.buildId !== entry.buildId || project.snapshotId !== entry.snapshotId || project.backend.id !== receipt.backendId
      || project.source.workspaceId !== entry.workspaceId || !sameTarget(targetFields(project), entry) || project.source.sourcePath !== entry.sourcePath) fail('backend_project_changed');
    const after = await ancestors(directory); await receipt.assertNamespace();
    if (!sameIdentity(after, entry.physical)) fail('backend_project_owner_changed');
    return { buildDirectory: directory, expectedBuildId: entry.buildId, expectedSnapshotId: entry.snapshotId, expectedManifestSha256: entry.manifestSha256 };
  } catch (cause) {
    if (cause.errorCode?.startsWith('backend_project_')) throw cause;
    fail(cause.code === 'ENOENT' ? 'backend_project_catalog_unavailable' : 'backend_project_catalog_changed');
  }
}

export function createBackendProjectCatalog(options) {
  const { namespace, backendId } = exact(options, ['namespace', 'backendId']);
  if (!text(namespace, 8192) || !path.isAbsolute(namespace) || path.resolve(namespace) !== namespace || !backend(backendId)
    || path.basename(namespace) !== backendId || !/^[a-f0-9]{24}$/.test(path.basename(path.dirname(namespace)))
    || path.basename(path.dirname(path.dirname(namespace))) !== 'editor') fail();
  const namespaceSha256 = `sha256:${hash(namespace)}`, index = path.join(namespace, BACKEND_PROJECT_CATALOG_FILE);
  let namespacePhysical = null;
  async function assertNamespace({ create = false, missing = false } = {}) {
    const found = await ancestors(namespace, { create, missing });
    if (found && namespacePhysical && !sameIdentity(found, namespacePhysical)) fail('backend_project_catalog_changed');
    if (!found && namespacePhysical) fail('backend_project_catalog_changed');
    if (found && !namespacePhysical) namespacePhysical = found;
    return found;
  }
  function brand(value) {
    const entry = entryValue(value);
    receipts.set(entry, { namespace, backendId, assertNamespace, owner: api });
    return entry;
  }
  function document(entries) {
    return Object.freeze({ format: 'viento-backend-project-catalog', schemaVersion: entries.some(entry => Object.hasOwn(entry, 'targetId')) ? 2 : 1, namespaceSha256, backendId,
      entries: Object.freeze(entries.sort((a, b) => compare(a.createdAt, b.createdAt) || compare(a.buildId, b.buildId))) });
  }
  function validateDocument(input) {
    const value = exact(input, ['format', 'schemaVersion', 'namespaceSha256', 'backendId', 'entries']);
    if (value.format !== 'viento-backend-project-catalog' || ![1, 2].includes(value.schemaVersion)
      || value.namespaceSha256 !== namespaceSha256 || value.backendId !== backendId
      || !Array.isArray(value.entries) || value.entries.length > BACKEND_PROJECT_CATALOG_MAX_RECORDS
      || Reflect.ownKeys(value.entries).length !== value.entries.length + 1
      || value.schemaVersion === 1 && value.entries.some(entry => Object.hasOwn(entry || {}, 'targetId'))) fail();
    const ids = new Set(), directories = new Set(), entries = value.entries.map(brand);
    for (const entry of entries) {
      if (ids.has(entry.buildId) || directories.has(entry.directory)) fail(); ids.add(entry.buildId); directories.add(entry.directory);
    }
    return document(entries);
  }
  async function load() {
    const found = await assertNamespace({ missing: true });
    if (!found) return { value: document([]), bytes: null };
    const stored = await regularBytes(index, BACKEND_PROJECT_CATALOG_MAX_BYTES, { missing: true });
    await assertNamespace();
    if (!stored) return { value: document([]), bytes: null };
    try { return { value: validateDocument(parse(stored.bytes)), bytes: stored.bytes }; }
    catch { fail('backend_project_catalog_corrupt'); }
  }
  async function acquire() {
    await assertNamespace({ create: true });
    const lock = path.join(namespace, lockName), deadline = Date.now() + 2000;
    for (;;) {
      if (Date.now() >= deadline) fail('backend_project_catalog_busy');
      await assertNamespace();
      let handle;
      try { handle = await fs.open(lock, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW || 0), 0o600); }
      catch (cause) {
        if (cause.code !== 'EEXIST') throw cause;
        let stat;
        try { stat = await fs.lstat(lock, { bigint: true }); }
        catch (cause) { if (cause.code === 'ENOENT') continue; throw cause; }
        if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1n) fail('backend_project_catalog_changed');
        if (Date.now() >= deadline) fail('backend_project_catalog_busy');
        await delay(20); continue;
      }
      const identity = statIdentity(await handle.stat({ bigint: true }));
      try {
        await handle.writeFile(json({ format: 'viento-backend-project-catalog-lock', schemaVersion: 1, owner: randomUUID(), pid: process.pid }));
        await handle.sync();
        await assertNamespace();
        return { lock, identity, handle };
      } catch (cause) {
        await handle.close();
        try {
          await assertNamespace();
          const found = await fs.lstat(lock, { bigint: true });
          if (found.isFile() && found.nlink === 1n && sameIdentity(statIdentity(found), identity)) await fs.unlink(lock);
        } catch { /* A replaced lock belongs to someone else; keep it. */ }
        throw cause;
      }
    }
  }
  async function release(owned) {
    try {
      await assertNamespace();
      const found = await fs.lstat(owned.lock, { bigint: true });
      if (!found.isFile() || found.isSymbolicLink() || found.nlink !== 1n || !sameIdentity(statIdentity(found), owned.identity)) fail('backend_project_catalog_changed');
      await fs.unlink(owned.lock); await syncDirectory(namespace);
    } finally { await owned.handle.close(); }
  }
  async function mutate(change) {
    const owned = await acquire(); let temporary, temporaryPhysical;
    try {
      const before = await load(), value = await change(before.value);
      const bytes = json(value);
      if (bytes.length > BACKEND_PROJECT_CATALOG_MAX_BYTES) fail('backend_project_catalog_limit');
      if (before.bytes?.equals(bytes)) return value;
      temporary = path.join(namespace, `.backend-project-catalog-${randomUUID()}.tmp`);
      const handle = await fs.open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW || 0), 0o600);
      try { await handle.writeFile(bytes); await handle.sync(); temporaryPhysical = statIdentity(await handle.stat({ bigint: true })); }
      finally { await handle.close(); }
      await assertNamespace();
      const current = await regularBytes(index, BACKEND_PROJECT_CATALOG_MAX_BYTES, { missing: true });
      if (Boolean(current) !== Boolean(before.bytes) || current && !current.bytes.equals(before.bytes)) fail('backend_project_catalog_changed');
      const lock = await fs.lstat(owned.lock, { bigint: true });
      if (!lock.isFile() || lock.nlink !== 1n || !sameIdentity(statIdentity(lock), owned.identity)) fail('backend_project_catalog_changed');
      const staged = await regularBytes(temporary, BACKEND_PROJECT_CATALOG_MAX_BYTES);
      if (!sameIdentity(staged.physical, temporaryPhysical) || !staged.bytes.equals(bytes)) fail('backend_project_catalog_changed');
      await fs.rename(temporary, index); temporary = null; await syncDirectory(namespace); await assertNamespace();
      const published = await regularBytes(index, BACKEND_PROJECT_CATALOG_MAX_BYTES);
      if (!sameIdentity(published.physical, temporaryPhysical) || !published.bytes.equals(bytes)) fail('backend_project_catalog_changed');
      return value;
    } finally {
      try {
        if (temporary) {
          await assertNamespace();
          try {
            const found = await fs.lstat(temporary, { bigint: true });
            if (found.isFile() && found.nlink === 1n && sameIdentity(statIdentity(found), temporaryPhysical)) await fs.unlink(temporary);
          } catch (cause) { if (cause.code !== 'ENOENT') throw cause; }
        }
      } finally { await release(owned); }
    }
  }
  async function safe(operation) {
    try { return await operation(); }
    catch (cause) {
      if (cause.errorCode?.startsWith('backend_project_')) throw cause;
      fail(cause.code === 'ENOENT' ? 'backend_project_catalog_unavailable' : 'backend_project_catalog_changed');
    }
  }
  const api = Object.freeze({
    read: () => safe(async () => (await load()).value),
    upsert(input) {
      const receipt = receipts.get(input);
      if (receipt?.owner !== api) return Promise.reject(error());
      return safe(() => mutate(async before => {
        await assertCatalogProject(input);
        const entries = [...before.entries], previous = entries.findIndex(entry => entry.buildId === input.buildId);
        if (entries.some(entry => entry.directory === input.directory && entry.buildId !== input.buildId)) fail('backend_project_catalog_changed');
        if (previous < 0) { if (entries.length >= BACKEND_PROJECT_CATALOG_MAX_RECORDS) fail('backend_project_catalog_limit'); entries.push(input); }
        else {
          const prior = entries[previous];
          if (prior.snapshotId !== input.snapshotId || prior.manifestSha256 !== input.manifestSha256 || !sameIdentity(prior.physical, input.physical)
            || prior.workspaceId !== input.workspaceId || !sameTarget(prior, input) || prior.sourcePath !== input.sourcePath
            || prior.createdAt !== input.createdAt || prior.title !== input.title) fail('backend_project_catalog_changed');
          entries[previous] = input;
        }
        return document(entries);
      }));
    },
    remove(buildId) {
      if (!uuid(buildId)) return Promise.reject(error());
      return safe(() => mutate(before => document(before.entries.filter(entry => entry.buildId !== buildId))));
    },
    capture(input) {
      let values, project, pin;
      try {
        values = exact(input, ['buildDirectory', 'project', 'manifestSha256', 'title', 'createdAt', 'retentionPin']);
        project = validateBackendProjectManifest(values.project);
        const descriptors = Object.getOwnPropertyDescriptors(values.retentionPin || {});
        if (['directory', 'dev', 'ino', 'files'].some(key => !descriptors[key] || !('value' in descriptors[key]))) fail();
        pin = Object.fromEntries(['directory', 'dev', 'ino', 'files'].map(key => [key, descriptors[key].value]));
        const manifest = exact(Map.prototype.get.call(pin.files, 'backend-project.json'), ['size', 'sha256']);
        if (project.backend.id !== backendId || !sha(values.manifestSha256) || manifest.sha256 !== values.manifestSha256 || pin.directory !== values.buildDirectory
          || !Number.isSafeInteger(pin.dev) || !Number.isSafeInteger(pin.ino) || pin.dev < 0 || pin.ino < 0
          || path.dirname(values.buildDirectory) !== namespace || !directoryName(path.basename(values.buildDirectory))) fail();
        pin = { directory: pin.directory, physical: { dev: String(pin.dev), ino: String(pin.ino) } };
        values = { ...values, project: undefined, retentionPin: undefined };
        entryValue({ buildId: project.buildId, snapshotId: project.snapshotId, manifestSha256: values.manifestSha256,
          directory: path.basename(values.buildDirectory), physical: pin.physical, workspaceId: project.source.workspaceId,
          ...targetFields(project), sourcePath: project.source.sourcePath, title: values.title, createdAt: values.createdAt });
      } catch (cause) { return Promise.reject(cause.errorCode ? cause : error()); }
      return safe(async () => {
        await assertNamespace();
        if (!sameIdentity(await ancestors(pin.directory), pin.physical)) fail('backend_project_owner_changed');
        const entry = brand({ buildId: project.buildId, snapshotId: project.snapshotId, manifestSha256: values.manifestSha256,
          directory: path.basename(values.buildDirectory), physical: pin.physical, workspaceId: project.source.workspaceId,
          ...targetFields(project), sourcePath: project.source.sourcePath, title: values.title, createdAt: values.createdAt });
        await assertCatalogProject(entry);
        return entry;
      });
    },
    assertProject(entry) {
      if (receipts.get(entry)?.owner !== api) return Promise.reject(error());
      return safe(() => assertCatalogProject(entry));
    },
  });
  return api;
}
