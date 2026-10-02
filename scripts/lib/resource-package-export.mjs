import { constants } from 'node:fs';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { resolveContainedPath } from './contained-path.mjs';
import { readPackageCatalog, packageDigest } from './resource-package-catalog.mjs';
import { resolveDocumentDefinition } from './project-layout.mjs';
import { selectPackageEntries, RESOURCE_PACKAGE_FORMAT, RESOURCE_PACKAGE_VERSION, PACKAGE_LIMITS, packageError } from '../../engine/resource-package.mjs';
import { userMessage } from './user-message.mjs';

export async function packageFileHash(base, relative, signal) {
  const file = await resolveContainedPath(base, path.join(base, relative));
  signal?.throwIfAborted();
  const handle = await fs.open(file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0) | (constants.O_NONBLOCK || 0));
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > PACKAGE_LIMITS.fileBytes) throw packageError('资源包中的文件不可用');
    const hash = createHash('sha256'); let size = 0;
    for await (const chunk of handle.createReadStream({ signal, autoClose: false })) { size += chunk.length; hash.update(chunk); }
    signal?.throwIfAborted();
    const after = await handle.stat();
    if (size !== stat.size || after.mtimeMs !== stat.mtimeMs || after.ctimeMs !== stat.ctimeMs) throw packageError('资源清单已变化，请刷新后重新选择', 409);
    return { size, sha256: hash.digest('hex') };
  } finally { await handle.close(); }
}

export async function addResourcePackage(root, options, { addFile, addBuffer }, signal) {
  const catalog = await readPackageCatalog(root, signal);
  if (typeof options.revision !== 'string' || options.revision !== catalog.revision) throw packageError('资源清单已变化，请刷新后重新选择', 409);
  for (const key of ['includeDependencies', 'includeChildren']) if (options[key] !== undefined && typeof options[key] !== 'boolean') throw packageError('资源包选项无效');
  const selection = selectPackageEntries(catalog.entries, options.ids, options);
  if (selection.selected.filter(item => item.category === 'document').reduce((sum, item) => sum + item.size, 0) > PACKAGE_LIMITS.sourceBytes) {
    throw packageError('所选正文超过 64 MB，请分开分享或使用完整项目包');
  }
  const documents = [], assets = [], requirements = [], typeIds = new Set();
  for (const item of [...selection.selected, ...selection.requirements]) {
    if (item.status !== 'available' || item.problems.length) throw packageError(userMessage`资源不可用或引用不完整：${item.path}`);
  }
  for (const item of selection.selected) {
    const metadata = catalog.records.get(item.id);
    const expected = { size: metadata.bytes.length, sha256: packageDigest(metadata.bytes) };
    await addFile(root, metadata.path, metadata.path, expected);
    if (item.category === 'document') {
      const source = catalog.sources.get(item.id), record = metadata.record;
      await addFile(root, item.path, item.path, source);
      const definition = resolveDocumentDefinition(catalog.workspace, record.sourcePath, record);
      typeIds.add(definition.documentType);
      documents.push({ id: item.id, sourcePath: item.path, definition: {
        documentType: definition.documentType, parserProfile: definition.parserProfile,
        parserOptions: definition.parserOptions || {}, fieldGroups: definition.fieldGroups || [],
      } });
    } else {
      await addFile(catalog.assetRoot, metadata.record.location.path, item.path, metadata.record.content);
      assets.push({ id: item.id, path: item.path });
    }
  }
  for (const item of selection.requirements) {
    const metadata = catalog.records.get(item.id);
    const content = item.category === 'document'
      ? catalog.sources.get(item.id)
      : metadata.record.content || await packageFileHash(catalog.assetRoot, metadata.record.location.path, signal);
    requirements.push({ id: item.id, category: item.category, path: item.path, recordSha256: packageDigest(metadata.bytes), content });
  }
  const types = catalog.types.filter(type => typeIds.has(type.id)).map(({ content, templateSource, ...type }) => type);
  for (const type of types) {
    const template = catalog.templates.get(type.id);
    if (template) addBuffer(template.sourcePath, template.bytes);
  }
  return { documentCount: documents.length, assetCount: assets.length, title: catalog.workspace.name,
    archiveManifest: { format: RESOURCE_PACKAGE_FORMAT, version: RESOURCE_PACKAGE_VERSION, exportedAt: Math.floor(Date.now() / 1000),
      source: { id: catalog.workspace.id, name: catalog.workspace.name, version: catalog.workspace.version, paths: catalog.paths },
      roots: options.ids, includeDependencies: options.includeDependencies !== false, includeChildren: options.includeChildren !== false,
      documents, assets, types, requirements },
    validate: async validationSignal => {
      if ((await readPackageCatalog(root, validationSignal)).revision !== catalog.revision) throw packageError('资源清单已变化，请刷新后重新选择', 409);
    } };
}
