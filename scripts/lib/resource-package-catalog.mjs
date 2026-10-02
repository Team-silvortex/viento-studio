import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { readWorkspace, readRegistry, resolveAssetRoot } from './workspace.mjs';
import { resolveContainedPath } from './contained-path.mjs';
import { resolveDocumentDefinition, workspacePaths, projectDefinition } from './project-layout.mjs';
import { parseSourceContent } from '../standardize-docs/doc-factory.mjs';
import { collectDocumentMedia, mediaUrl } from './media-format.mjs';
import { collectAssetImageRefs } from './image-index.mjs';
import { readWorldFence, assertWorldFence } from './world-transaction-state.mjs';
import { PACKAGE_LIMITS, packageError } from '../../engine/resource-package.mjs';

export const packageDigest = bytes => createHash('sha256').update(bytes).digest('hex');
const stamp = stat => [stat.dev, stat.ino, stat.size, stat.mtimeMs, stat.ctimeMs];

export async function readPackageBytes(base, relative, signal, limit = PACKAGE_LIMITS.jsonBytes) {
  signal?.throwIfAborted();
  const file = await resolveContainedPath(base, path.join(base, relative));
  const handle = await fs.open(file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0) | (constants.O_NONBLOCK || 0));
  try {
    signal?.throwIfAborted();
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > limit) throw packageError('资源包中的正文或元数据超过大小限制');
    const buffer = Buffer.alloc(stat.size + 1);
    let size = 0;
    while (size < buffer.length) {
      signal?.throwIfAborted();
      const result = await handle.read(buffer, size, buffer.length - size, null);
      if (!result.bytesRead) break;
      size += result.bytesRead;
    }
    signal?.throwIfAborted();
    if (size !== stat.size || JSON.stringify(stamp(await handle.stat())) !== JSON.stringify(stamp(stat))) {
      throw packageError('资源清单已变化，请刷新后重新选择', 409);
    }
    return buffer.subarray(0, size);
  } finally { await handle.close(); }
}

export async function readPackageCatalog(root, signal) {
  signal?.throwIfAborted();
  const fence = await readWorldFence(root), workspace = readWorkspace(root);
  if (!workspace || workspace.version < 2) throw packageError('请先登记项目，再使用资源包');
  const registry = await readRegistry(root, { signal }), assetRoot = resolveAssetRoot(root);
  if (registry.documents.length + registry.assets.length > PACKAGE_LIMITS.files) throw packageError('导出文件过多');
  const entries = [], records = new Map(), sources = new Map(), templates = new Map(), revisions = [workspace, assetRoot];
  let sourceBytes = 0;
  const countSource = bytes => {
    sourceBytes += bytes.length;
    if (sourceBytes > PACKAGE_LIMITS.sourceBytes) throw packageError('所选正文超过 64 MB，请分开分享或使用完整项目包');
  };
  const types = workspace.version === 3 || workspace.documentTypes ? projectDefinition(workspace).documentTypes : [];
  const byUrl = new Map();
  for (const asset of registry.assets) {
    byUrl.set(`/asset-files/${asset.id}`, asset.id);
    for (const alias of [`assets/${asset.location.path}`, ...asset.legacyPaths]) byUrl.set(`/${alias.split('/').map(encodeURIComponent).join('/')}`, asset.id);
  }
  for (const record of [...registry.documents, ...registry.assets]) {
    const category = record.format === 'viento-document' ? 'document' : 'asset';
    const recordPath = `metadata/${category === 'document' ? 'documents' : 'assets'}/${record.id}.json`;
    const bytes = await readPackageBytes(root, recordPath, signal);
    // Metadata can be edited outside the app while its source is being read.
    if (JSON.stringify(JSON.parse(bytes)) !== JSON.stringify(record)) throw packageError('资源清单已变化，请刷新后重新选择', 409);
    records.set(record.id, { record, bytes, path: recordPath });
    revisions.push([recordPath, packageDigest(bytes)]);
    const relative = category === 'document' ? record.sourcePath : record.location.path;
    const item = { id: record.id, category, name: category === 'document' ? path.basename(relative) : record.name,
      path: category === 'document' ? relative : `assets/${relative}`, kind: category === 'document' ? 'document' : record.kind,
      size: record.content?.size || 0, status: 'available', dependencies: [], children: [], problems: [] };
    try {
      const base = category === 'document' ? root : assetRoot;
      const stat = await fs.stat(await resolveContainedPath(base, path.join(base, relative)));
      signal?.throwIfAborted();
      if (!stat.isFile()) throw new Error('Not a file');
      item.size = stat.size; revisions.push([item.id, stamp(stat)]);
      if (category === 'asset' && record.content && stat.size !== record.content.size) item.status = 'changed';
      if (category === 'document') {
        const source = await readPackageBytes(root, relative, signal);
        const fingerprint = { size: source.length, sha256: packageDigest(source) };
        sources.set(record.id, fingerprint); revisions.push([record.id, fingerprint.sha256]);
        const parsed = parseSourceContent(source.toString('utf8'), relative, resolveDocumentDefinition(workspace, relative, record));
        if (parsed.parseError) item.problems.push('正文解析失败');
        item.name = parsed.title || item.name;
        const media = collectDocumentMedia(parsed.blocks);
        const urls = [...media.urls, ...collectAssetImageRefs(media.text, relative).map(file => `/${file.split('/').map(encodeURIComponent).join('/')}`)];
        const type = types.find(type => type.id === resolveDocumentDefinition(workspace, relative, record).documentType);
        if (type?.template) {
          if (!templates.has(type.id)) {
            const sourcePath = `${workspacePaths(workspace).templates}/${type.template}`;
            let bytes;
            try { bytes = await readPackageBytes(root, sourcePath, signal); }
            catch (error) { signal?.throwIfAborted(); if (error.code !== 'ENOENT') throw error; bytes = Buffer.from(type.content); }
            countSource(bytes);
            const parsedTemplate = parseSourceContent(bytes.toString('utf8'), sourcePath, type);
            if (parsedTemplate.parseError) throw packageError('资源包中的模板无法解析');
            const templateMedia = collectDocumentMedia(parsedTemplate.blocks);
            templates.set(type.id, { bytes, sourcePath, urls: [...templateMedia.urls,
              ...collectAssetImageRefs(templateMedia.text, sourcePath).map(file => `/${file.split('/').map(encodeURIComponent).join('/')}`)] });
            revisions.push([sourcePath, packageDigest(bytes)]);
          }
          urls.push(...templates.get(type.id).urls);
        }
        const deps = new Set([...(record.relations || []).map(link => link.targetId), ...record.assetBindings.map(link => link.assetId)]);
        for (const url of urls) {
          const id = byUrl.get(mediaUrl(url));
          if (id) deps.add(id); else item.problems.push(url);
        }
        item.dependencies = [...deps].sort();
      }
    } catch (error) {
      signal?.throwIfAborted();
      if (error.statusCode === 409) throw error;
      item.status = 'missing'; revisions.push([item.id, 'missing']);
    }
    entries.push(item);
  }
  const byId = new Map(entries.map(item => [item.id, item]));
  for (const item of entries) for (const dependency of item.dependencies) if (!byId.has(dependency)) item.problems.push(dependency);
  for (const record of registry.documents) for (const relation of record.relations || []) {
    if (relation.kind === 'part-of') byId.get(relation.targetId)?.children.push(record.id);
  }
  // A second read protects the catalogue revision against concurrent registration.
  if (JSON.stringify(await readRegistry(root, { signal })) !== JSON.stringify(registry)
    || JSON.stringify(readWorkspace(root)) !== JSON.stringify(workspace) || resolveAssetRoot(root) !== assetRoot) {
    throw packageError('资源清单已变化，请刷新后重新选择', 409);
  }
  await assertWorldFence(root, fence); signal?.throwIfAborted();
  return { workspace, registry, assetRoot, records, sources, templates, types, entries, revision: packageDigest(JSON.stringify(revisions)), paths: workspacePaths(workspace) };
}

export const publicPackageCatalog = catalog => ({ revision: catalog.revision, name: catalog.workspace.name, entries: catalog.entries });
