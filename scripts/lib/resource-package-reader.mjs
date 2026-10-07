import fs from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import path from 'node:path';
import { Transform, addAbortSignal } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createHash } from 'node:crypto';
import yauzl from 'yauzl';
import { portablePath, assertPortableFileTree } from './workspace.mjs';
import { validateProjectTypes, workspacePaths } from './project-layout.mjs';
import { validateDocumentModels } from './document-model.mjs';
import { PACKAGE_LIMITS, RESOURCE_PACKAGE_FORMAT, RESOURCE_PACKAGE_VERSION, packageError } from '../../engine/resource-package.mjs';
import { readPackageBytes, inspectPackageComposition, inspectPackageSceneBehaviors, packageDocumentClassification } from './resource-package-catalog.mjs';
import { inspectObjectProjection } from '../../engine/object-projection.mjs';
import { validateSceneCompositionDependencies } from '../../engine/scene-composition-document.mjs';
import { sceneBehaviorDocumentIds, validateSceneBehaviorDependencies } from '../../engine/scene-behaviors.mjs';

export const PACKAGE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const hashValue = value => Number.isSafeInteger(value?.size) && value.size >= 0 && value.size <= PACKAGE_LIMITS.fileBytes && /^[a-f0-9]{64}$/.test(value.sha256);
const invalid = () => { throw packageError('资源包格式无效、文件损坏或版本不受支持'); };
const plain = value => value && typeof value === 'object' && !Array.isArray(value);

function validateManifest(manifest) {
  if (!plain(manifest) || manifest.format !== RESOURCE_PACKAGE_FORMAT || manifest.version !== RESOURCE_PACKAGE_VERSION
    || !Number.isSafeInteger(manifest.exportedAt) || manifest.exportedAt < 0
    || typeof manifest.includeDependencies !== 'boolean' || typeof manifest.includeChildren !== 'boolean'
    || ![2, 3].includes(manifest.source?.version) || !PACKAGE_UUID.test(manifest.source.id)
    || typeof manifest.source.name !== 'string' || !Array.isArray(manifest.files) || manifest.files.length > PACKAGE_LIMITS.files
    || !['documents', 'assets', 'types', 'requirements', 'roots'].every(key => Array.isArray(manifest[key]))
    || manifest.documents.length + manifest.assets.length === 0) invalid();
  const paths = workspacePaths(manifest.source);
  if (JSON.stringify(Object.entries(manifest.source.paths || {}).sort()) !== JSON.stringify(Object.entries(paths).sort())) invalid();
  if (manifest.types.length) validateProjectTypes({ version: manifest.source.version, documentTypes: manifest.types });
  const ids = new Set(), allowed = new Set();
  for (const doc of manifest.documents) {
    if (!plain(doc) || !PACKAGE_UUID.test(doc.id) || ids.has(doc.id) || !portablePath(doc.sourcePath)
      || !doc.sourcePath.startsWith(`${paths.documents}/`) || !plain(doc.definition)
      || typeof doc.definition.documentType !== 'string' || !doc.definition.documentType.trim() || doc.definition.documentType.length > 120
      || !plain(doc.definition.parserOptions) || !Array.isArray(doc.definition.fieldGroups)
      || !['structured', 'prose', 'legacy-hero'].includes(doc.definition.parserProfile)) invalid();
    ids.add(doc.id); allowed.add(doc.sourcePath); allowed.add(`metadata/documents/${doc.id}.json`);
  }
  for (const asset of manifest.assets) {
    if (!plain(asset) || !PACKAGE_UUID.test(asset.id) || ids.has(asset.id) || !portablePath(asset.path) || !asset.path.startsWith('assets/')) invalid();
    ids.add(asset.id); allowed.add(asset.path); allowed.add(`metadata/assets/${asset.id}.json`);
  }
  if (!manifest.roots.length || manifest.roots.some(id => !ids.has(id)) || new Set(manifest.roots).size !== manifest.roots.length) invalid();
  for (const type of manifest.types) if (type.template) allowed.add(`${paths.templates}/${type.template}`);
  for (const item of manifest.requirements) {
    if (!plain(item) || !PACKAGE_UUID.test(item.id) || ids.has(item.id) || !['document', 'asset'].includes(item.category)
      || !portablePath(item.path) || !item.path.startsWith(`${item.category === 'asset' ? 'assets' : paths.documents}/`)
      || !/^[a-f0-9]{64}$/.test(item.recordSha256) || !hashValue(item.content)) invalid();
    ids.add(item.id);
  }
  const files = new Map(); let total = 0;
  for (const file of manifest.files) {
    if (!plain(file) || !allowed.has(file.path) || files.has(file.path) || !hashValue(file)) invalid();
    files.set(file.path, file); total += file.size;
  }
  if (allowed.size !== files.size || total > PACKAGE_LIMITS.totalBytes) invalid();
  assertPortableFileTree(files.keys());
  return files;
}

// Inspection only writes to an isolated cache directory. No archive path is ever
// interpreted as a destination in the active project.
export async function unpackResourcePackage(file, directory, signal) {
  signal?.throwIfAborted();
  let zip;
  try { zip = await yauzl.openPromise(file, { lazyEntries: true, autoClose: false, strictFileNames: true, validateEntrySizes: true }); }
  catch { signal?.throwIfAborted(); invalid(); }
  let zipFailure = null, failed = false;
  zip.on('error', error => { zipFailure = error; });
  // Keep ownership until the underlying descriptor closes, including after a
  // cancelled stream. The cache can then be safely removed on Windows too.
  const closed = new Promise(resolve => { zip.reader.once('close', resolve); zip.reader.once('error', resolve); });
  try {
    signal?.throwIfAborted();
    const entries = new Map();
    for await (const entry of zip.eachEntry()) {
      signal?.throwIfAborted();
      const mode = (entry.externalFileAttributes >>> 16) & 0o170000;
      if (entries.size >= PACKAGE_LIMITS.files + 1 || !portablePath(entry.fileName) || entries.has(entry.fileName)
        || (mode && mode !== 0o100000) || entry.isEncrypted() || ![0, 8].includes(entry.compressionMethod)
        || entry.uncompressedSize > PACKAGE_LIMITS.fileBytes) invalid();
      entries.set(entry.fileName, entry);
    }
    assertPortableFileTree(entries.keys());
    const manifestEntry = entries.get('manifest.json');
    if (!manifestEntry || manifestEntry.uncompressedSize > PACKAGE_LIMITS.jsonBytes) invalid();
    const chunks = []; let bytes = 0;
    const manifestStream = await zip.openReadStreamPromise(manifestEntry);
    if (signal) addAbortSignal(signal, manifestStream);
    for await (const chunk of manifestStream) {
      signal?.throwIfAborted(); bytes += chunk.length;
      if (bytes > PACKAGE_LIMITS.jsonBytes) invalid(); chunks.push(chunk);
    }
    let manifest;
    try { manifest = JSON.parse(Buffer.concat(chunks)); } catch { invalid(); }
    const files = validateManifest(manifest);
    if (entries.size !== files.size + 1 || [...files].some(([name, file]) => entries.get(name)?.uncompressedSize !== file.size)) invalid();
    const space = await fs.statfs(directory);
    if (space.bavail * space.bsize < [...files.values()].reduce((sum, file) => sum + file.size, 0) + 128 * 1024 ** 2) throw packageError('磁盘空间不足，无法导入资源包');
    const content = path.join(directory, 'content'); await fs.mkdir(content, { mode: 0o700 });
    for (const [name, file] of files) {
      signal?.throwIfAborted();
      const target = path.join(content, name); await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
      const hash = createHash('sha256'); let size = 0;
      const verified = new Transform({ transform(chunk, encoding, done) {
        size += chunk.length;
        if (size > file.size) return done(packageError('资源包格式无效、文件损坏或版本不受支持'));
        hash.update(chunk); done(null, chunk);
      } });
      await pipeline(await zip.openReadStreamPromise(entries.get(name)), verified, createWriteStream(target, { flags: 'wx', mode: 0o600 }), { signal });
      if (size !== file.size || hash.digest('hex') !== file.sha256) invalid();
    }
    const records = new Map();
    for (const [category, items] of [['documents', manifest.documents], ['assets', manifest.assets]]) for (const item of items) {
      const raw = await readPackageBytes(content, `metadata/${category}/${item.id}.json`, signal);
      let record; try { record = JSON.parse(raw); } catch { invalid(); }
      if (!plain(record) || record.id !== item.id || record.version !== 1) invalid();
      if (category === 'documents') {
        if (record.format !== 'viento-document' || record.sourcePath !== item.sourcePath || !Array.isArray(record.assetBindings)
          || record.assetBindings.some(link => !PACKAGE_UUID.test(link?.assetId) || typeof link.role !== 'string')) invalid();
      } else if (record.format !== 'viento-asset' || typeof record.name !== 'string' || !['image', 'video', 'audio', 'font', 'text', 'other'].includes(record.kind)
        || record.location?.store !== 'main' || `assets/${record.location.path}` !== item.path || !Array.isArray(record.tags) || record.tags.some(tag => typeof tag !== 'string')
        || !Array.isArray(record.legacyPaths) || record.legacyPaths.some(alias => !portablePath(alias) || !alias.startsWith('assets/'))
        || (record.content !== null && (!hashValue(record.content) || record.content.sha256 !== files.get(item.path).sha256 || record.content.size !== files.get(item.path).size))) invalid();
      records.set(record.id, { record, raw });
    }
    validateDocumentModels([...manifest.documents.map(doc => records.get(doc.id).record),
      ...manifest.requirements.filter(item => item.category === 'document').map(item => ({ id: item.id, sourcePath: item.path }))]);
    const assetIds = new Set([...manifest.assets.map(asset => asset.id), ...manifest.requirements.filter(item => item.category === 'asset').map(item => item.id)]);
    if (manifest.documents.some(doc => records.get(doc.id).record.assetBindings.some(link => !assetIds.has(link.assetId)))) invalid();
    // Recipe references are authored in the source, not mirrored into metadata.
    // A checksum-correct archive cannot erase a dependency from its manifest.
    const documentIds = new Set([...manifest.documents.map(doc => doc.id), ...manifest.requirements.filter(item => item.category === 'document').map(item => item.id)]);
    const compositionChecks = [], behaviorChecks = [], documentSources = [];
    for (const item of manifest.documents) {
      const bytes = await readPackageBytes(content, item.sourcePath, signal), record = records.get(item.id).record;
      const checked = inspectPackageComposition(bytes, item.sourcePath);
      documentSources.push({ record, content: packageDocumentClassification(inspectObjectProjection(bytes.toString('utf8'), record), checked) });
      const behavior = inspectPackageSceneBehaviors(bytes, item.sourcePath);
      if (behavior.recognized) {
        if (!behavior.ok || sceneBehaviorDocumentIds(behavior.value).some(id => !documentIds.has(id))) invalid();
        behaviorChecks.push({ record, checked: behavior });
      }
      if (!checked.recognized) continue;
      if (!checked.ok || checked.dependencies.objectIds.some(id => !documentIds.has(id))
        || checked.dependencies.imageResourceIds.some(id => !assetIds.has(id))) invalid();
      compositionChecks.push({ record, checked });
    }
    // Requirements are pinned but their bytes/kind become available only when
    // a target is selected. Import planning repeats validation against them.
    const compositionSource = {
      documents: [...documentSources, ...manifest.requirements.filter(item => item.category === 'document')
        .map(item => ({ record: { id: item.id }, content: '' }))],
      assets: [...manifest.assets.map(item => ({ record: records.get(item.id).record })),
        ...manifest.requirements.filter(item => item.category === 'asset').map(item => ({ record: { id: item.id, kind: 'image' } }))],
    };
    for (const { record, checked } of compositionChecks) if (validateSceneCompositionDependencies(checked, record, compositionSource).length) invalid();
    const behaviorIds = new Set(behaviorChecks.flatMap(item => sceneBehaviorDocumentIds(item.checked.value)));
    for (const id of behaviorIds) {
      const document = documentSources.find(item => item.record.id === id);
      if (!document) continue;
      const bytes = await readPackageBytes(content, document.record.sourcePath, signal);
      try { document.content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
      catch { invalid(); }
    }
    const requiredDocuments = manifest.requirements.filter(item => item.category === 'document');
    const requiredIds = new Set(requiredDocuments.map(item => item.id));
    const behaviorSource = { documents: [...documentSources, ...requiredDocuments.map(item => ({
      record: { id: item.id, format: 'viento-document', sourcePath: item.path }, content: null }))] };
    for (const { record, checked } of behaviorChecks) {
      // A declared requirement is hash-pinned but its body is unavailable until
      // target selection. Only this availability diagnostic may be deferred;
      // metadata links, document kinds/paths and included bodies are checked now.
      if (validateSceneBehaviorDependencies(checked.value, record, behaviorSource).some(diagnostic =>
        diagnostic.code !== 'build_behavior_dependency_unavailable' || !requiredIds.has(diagnostic.relatedObjectId))) invalid();
    }
    signal?.throwIfAborted();
    if (zipFailure) throw zipFailure;
    return { manifest, files, records, content };
  } catch (error) {
    failed = true;
    signal?.throwIfAborted();
    if (error.errorCode || error.code === 'ENOSPC') throw error;
    throw packageError('资源包格式无效、文件损坏或版本不受支持');
  } finally {
    zip.close(); await closed;
    if (zipFailure && !failed) { signal?.throwIfAborted(); invalid(); }
  }
}
