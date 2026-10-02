import fs from 'node:fs/promises';
import path from 'node:path';
import { readWorkspace, readRegistry, resolveAssetRoot, walkFiles, assertPortableFileTree, portablePath } from './workspace.mjs';
import { workspacePaths, projectDefinition, resolveDocumentDefinition, validateProjectTypes } from './project-layout.mjs';
import { resolveContainedPath } from './contained-path.mjs';
import { readPackageBytes, packageDigest } from './resource-package-catalog.mjs';
import { packageFileHash } from './resource-package-export.mjs';
import { readWorldFence, assertWorldFence } from './world-transaction-state.mjs';
import { appendRecordItem, replaceRecordString } from '../../engine/world-record-edit.mjs';
import { canonicalJson } from '../../engine/world-projection.mjs';
import { validateDocumentModels } from './document-model.mjs';
import { parseSourceContent } from '../standardize-docs/doc-factory.mjs';
import { collectDocumentMedia, mediaUrl } from './media-format.mjs';
import { collectAssetImageRefs } from './image-index.mjs';
import { packageError } from '../../engine/resource-package.mjs';

const key = value => value.normalize('NFC').toLowerCase();
export async function packageDestination(root, assetRoot, store, relative) {
  if (!portablePath(relative) || !['project', 'assets'].includes(store)) throw packageError('资源包导入记录无效');
  if (store === 'project') return resolveContainedPath(root, path.join(root, relative), { allowMissing: true });
  return assetRoot === path.join(root, 'assets')
    ? resolveContainedPath(root, path.join(assetRoot, relative), { allowMissing: true })
    : resolveContainedPath(assetRoot, path.join(assetRoot, relative), { allowMissing: true });
}

export async function planPackageImport(root, pack, signal) {
  const fence = await readWorldFence(root), workspace = readWorkspace(root);
  if (!workspace || workspace.version < 2) throw packageError('请先登记项目，再使用资源包');
  const paths = workspacePaths(workspace), assetRoot = resolveAssetRoot(root);
  const registry = await readRegistry(root, { signal });
  const workspaceBefore = await readPackageBytes(root, 'workspace.json', signal);
  if (canonicalJson(JSON.parse(workspaceBefore)) !== canonicalJson(workspace)) throw packageError('目标项目已变化，请重新预览导入', 409);
  let workspaceAfter = workspaceBefore.toString('utf8');
  const conflicts = [], files = [], items = [], reused = [], inventory = [];
  const conflict = (file, reason) => conflicts.push({ path: file, reason });
  const existingTypes = projectDefinition(workspace).documentTypes.map(({ content, templateSource, ...type }) => type);
  for (const type of pack.manifest.types) {
    const old = existingTypes.find(item => item.id === type.id);
    if (old) {
      if (canonicalJson(old) !== canonicalJson(type)) conflict(type.id, 'type');
    } else if ((workspace.version === 2 && !workspace.documentTypes) || existingTypes.some(item => key(item.directory) === key(type.directory))) {
      conflict(type.id, 'type');
    } else {
      if (!JSON.parse(workspaceAfter).documentTypes) for (const initial of existingTypes) workspaceAfter = appendRecordItem(workspaceAfter, 'documentTypes', initial).afterContent;
      workspaceAfter = appendRecordItem(workspaceAfter, 'documentTypes', type).afterContent; existingTypes.push(type);
    }
  }
  const nextWorkspace = JSON.parse(workspaceAfter);
  validateProjectTypes(nextWorkspace);
  const existingIds = new Map([...registry.documents, ...registry.assets].map(record => [record.id, record]));
  const incomingIds = new Set([...pack.manifest.documents, ...pack.manifest.assets].map(item => item.id));
  const mappedDocuments = [], mappedAssets = [];
  const remap = relative => relative.startsWith(`${pack.manifest.source.paths.documents}/`)
    ? `${paths.documents}/${relative.slice(pack.manifest.source.paths.documents.length + 1)}`
    : relative.startsWith(`${pack.manifest.source.paths.templates}/`) ? `${paths.templates}/${relative.slice(pack.manifest.source.paths.templates.length + 1)}` : relative;
  for (const item of pack.manifest.documents) {
    const { raw, record } = pack.records.get(item.id), sourcePath = remap(item.sourcePath);
    const content = sourcePath === record.sourcePath ? raw : Buffer.from(replaceRecordString(raw.toString('utf8'), 'sourcePath', sourcePath));
    const mapped = JSON.parse(content); mappedDocuments.push(mapped);
    const effective = resolveDocumentDefinition(nextWorkspace, sourcePath, mapped);
    const definition = { documentType: effective.documentType, parserProfile: effective.parserProfile,
      parserOptions: effective.parserOptions || {}, fieldGroups: effective.fieldGroups || [] };
    if (canonicalJson(definition) !== canonicalJson(item.definition)) conflict(sourcePath, 'type');
    files.push({ store: 'project', path: `metadata/documents/${item.id}.json`, buffer: content });
    items.push({ id: item.id, category: 'document', name: path.basename(sourcePath), path: sourcePath });
  }
  for (const item of pack.manifest.assets) {
    mappedAssets.push(pack.records.get(item.id).record);
    items.push({ id: item.id, category: 'asset', name: pack.records.get(item.id).record.name, path: item.path });
  }
  for (const item of pack.manifest.requirements) {
    const existing = existingIds.get(item.id), category = item.category === 'asset' ? 'assets' : 'documents';
    if (!existing || existing.format !== `viento-${item.category}`) { conflict(item.path, 'dependency'); continue; }
    let bytes = await readPackageBytes(root, `metadata/${category}/${item.id}.json`, signal);
    if (item.category === 'document' && paths.documents !== pack.manifest.source.paths.documents) {
      bytes = Buffer.from(replaceRecordString(bytes.toString('utf8'), 'sourcePath', `${pack.manifest.source.paths.documents}/${existing.sourcePath.slice(paths.documents.length + 1)}`));
    }
    const base = item.category === 'asset' ? assetRoot : root, relative = item.category === 'asset' ? existing.location.path : existing.sourcePath;
    let actual;
    try { actual = await packageFileHash(base, relative, signal); }
    catch (error) { signal?.throwIfAborted(); if (error.code !== 'ENOENT') throw error; }
    if (packageDigest(bytes) !== item.recordSha256 || canonicalJson(actual || null) !== canonicalJson(item.content)) conflict(item.path, 'dependency');
  }
  const mergedDocuments = [...registry.documents.filter(record => !incomingIds.has(record.id)), ...mappedDocuments];
  const mergedAssets = [...registry.assets.filter(record => !incomingIds.has(record.id)), ...mappedAssets];
  validateDocumentModels([...mergedDocuments, ...pack.manifest.requirements.filter(item => item.category === 'document' && !existingIds.has(item.id))
    .map(item => ({ id: item.id, sourcePath: remap(item.path) }))]);
  const sourceOwners = new Map(registry.documents.map(record => [key(record.sourcePath), record.id]));
  const assetOwners = new Map();
  for (const record of registry.assets) for (const alias of [`assets/${record.location.path}`, ...record.legacyPaths]) assetOwners.set(key(alias), record.id);
  const assetUrls = new Map();
  for (const record of mergedAssets) {
    assetUrls.set(`/asset-files/${record.id}`, record.id);
    for (const alias of [`assets/${record.location.path}`, ...record.legacyPaths]) assetUrls.set(`/${alias.split('/').map(encodeURIComponent).join('/')}`, record.id);
  }
  for (const record of mappedDocuments) {
    const old = existingIds.get(record.id), owner = sourceOwners.get(key(record.sourcePath));
    if ((old && old.format !== record.format) || (owner && owner !== record.id)) conflict(record.sourcePath, 'identity');
    sourceOwners.set(key(record.sourcePath), record.id);
  }
  for (const record of mappedAssets) {
    const old = existingIds.get(record.id);
    if (old && old.format !== record.format) conflict(`assets/${record.location.path}`, 'identity');
    for (const alias of [`assets/${record.location.path}`, ...record.legacyPaths]) {
      if (assetOwners.has(key(alias)) && assetOwners.get(key(alias)) !== record.id) conflict(alias, 'identity');
      assetOwners.set(key(alias), record.id);
    }
  }
  // Re-derive references from verified content; a modified manifest cannot hide
  // a missing asset by dropping it from its declared dependency list.
  const checkReferences = (raw, sourcePath, definition) => {
    const parsed = parseSourceContent(raw.toString('utf8'), sourcePath, definition);
    if (parsed.parseError) throw packageError('资源包中的正文或模板无法解析');
    const media = collectDocumentMedia(parsed.blocks);
    const urls = [...media.urls, ...collectAssetImageRefs(media.text, sourcePath).map(file => `/${file.split('/').map(encodeURIComponent).join('/')}`)];
    for (const url of urls) if (!assetUrls.has(mediaUrl(url))) conflict(sourcePath, 'dependency');
  };
  for (const item of pack.manifest.documents) checkReferences(await readPackageBytes(pack.content, item.sourcePath, signal), remap(item.sourcePath), item.definition);
  for (const type of pack.manifest.types) if (type.template) {
    const file = `${pack.manifest.source.paths.templates}/${type.template}`;
    checkReferences(await readPackageBytes(pack.content, file, signal), remap(file), type);
  }
  for (const file of pack.files.values()) {
    if (file.path.startsWith('metadata/documents/')) continue;
    files.push({ store: file.path.startsWith('assets/') ? 'assets' : 'project',
      path: file.path.startsWith('assets/') ? file.path.slice(7) : remap(file.path), source: file.path, expected: file });
  }
  // Include unregistered files in collision checks, including case and NFC
  // aliases which would collide after moving a package to another OS.
  for (const [base, prefix, store] of [[path.join(root, paths.documents), paths.documents, 'project'], [path.join(root, paths.templates), paths.templates, 'project'], [assetRoot, '', 'assets']]) {
    let existing = [];
    try { existing = await walkFiles(base, { signal }); }
    catch (error) { signal?.throwIfAborted(); if (error.code !== 'ENOENT' || (store === 'assets' && assetRoot !== path.join(root, 'assets'))) throw error; }
    const list = existing.map(file => prefix ? `${prefix}/${file}` : file);
    inventory.push([store, prefix, list]);
    try { assertPortableFileTree(new Set([...list, ...files.filter(file => file.store === store && (!prefix || file.path.startsWith(`${prefix}/`))).map(file => file.path)])); }
    catch { conflict(prefix || 'assets', 'path'); }
  }
  for (const file of files) {
    signal?.throwIfAborted();
    file.expected = file.buffer ? { size: file.buffer.length, sha256: packageDigest(file.buffer) } : { size: file.expected.size, sha256: file.expected.sha256 };
    const destination = await packageDestination(root, assetRoot, file.store, file.path);
    try {
      const stat = await fs.lstat(destination);
      if (!stat.isFile()) { conflict(file.path, 'path'); continue; }
      const actual = await packageFileHash(path.dirname(destination), path.basename(destination), signal);
      if (canonicalJson(actual) !== canonicalJson(file.expected)) conflict(file.path, 'content');
      else { file.reuse = true; reused.push(file.path); }
    } catch (error) { signal?.throwIfAborted(); if (error.code !== 'ENOENT') throw error; }
  }
  await assertWorldFence(root, fence); signal?.throwIfAborted();
  if (canonicalJson(await readRegistry(root, { signal })) !== canonicalJson(registry)
    || !(await readPackageBytes(root, 'workspace.json', signal)).equals(workspaceBefore) || resolveAssetRoot(root) !== assetRoot) throw packageError('目标项目已变化，请重新预览导入', 409);
  const revision = packageDigest(canonicalJson({ fence, registry, assetRoot, inventory, workspace: packageDigest(workspaceBefore),
    files: files.map(({ buffer, ...file }) => file), conflicts }));
  return { revision, workspace, assetRoot, files, workspaceBefore, workspaceAfter: Buffer.from(workspaceAfter),
    summary: { name: pack.manifest.source.name, items, conflicts, newFiles: files.filter(file => !file.reuse).length, reusedFiles: reused.length,
      documentCount: pack.manifest.documents.length, assetCount: pack.manifest.assets.length } };
}
