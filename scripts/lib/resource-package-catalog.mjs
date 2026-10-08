import fs from 'node:fs/promises';
import '../adapters/node-studio-core.mjs';
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
import { validateObjectProjection, validateProjectionDependencies } from '../../engine/object-projection.mjs';
import { inspectSceneComposition, validateSceneCompositionDependencies } from '../../engine/scene-composition-document.mjs';
import { inspectSceneBehaviors, sceneBehaviorDocumentIds, validateSceneBehaviorDependencies } from '../../engine/scene-behaviors.mjs';
import { inspectRuntimeCaseDocument, runtimeCaseDocumentIds, validateRuntimeCaseDocumentDependencies,
  RUNTIME_CASE_DOCUMENT_FILE_MAX_BYTES } from '../../engine/runtime-case-document.mjs';
import { inspectRuntimeCaseSuite, runtimeCaseSuiteDocumentIds, validateRuntimeCaseSuiteDependencies,
  RUNTIME_CASE_SUITE_FILE_MAX_BYTES } from '../../engine/runtime-case-suite.mjs';

export const packageDigest = bytes => createHash('sha256').update(bytes).digest('hex');
const stamp = stat => [stat.dev, stat.ino, stat.size, stat.mtimeMs, stat.ctimeMs];

// Preserve ordinary document decoding. Recognized recipes additionally require
// the exact UTF-8 bytes and JSON path accepted by the composition CLI.
export function inspectPackageComposition(bytes, sourcePath) {
  const checked = inspectSceneComposition(bytes.toString('utf8'));
  if (!checked.recognized) return checked;
  let valid = sourcePath.toLowerCase().endsWith('.json');
  try { new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { valid = false; }
  return valid ? checked : { recognized: true, ok: false, value: null,
    dependencies: { objectIds: [], imageResourceIds: [] },
    diagnostics: [{ severity: 'error', code: 'composition-document-invalid',
      message: 'A scene composition requires UTF-8 JSON source in a .json document.', propertyPath: '' }] };
}

export function packageDocumentClassification(projection, composition) {
  return composition.recognized ? '{"format":"viento-scene-composition"}'
    : projection.recognized ? '{"format":"viento-object-projection"}' : '';
}

export function inspectPackageSceneBehaviors(bytes, sourcePath) {
  const checked = inspectSceneBehaviors(bytes.toString('utf8'));
  if (!checked.recognized) return checked;
  let valid = sourcePath.toLowerCase().endsWith('.json');
  try { new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { valid = false; }
  return valid ? checked : { recognized: true, ok: false, value: null, diagnostics: [{ severity: 'error',
    code: 'build_behavior_invalid', message: 'A behavior manifest requires UTF-8 JSON in a registered .json document.', propertyPath: '' }] };
}

export function inspectPackageRuntimeCase(bytes, sourcePath) {
  const checked = inspectRuntimeCaseDocument(bytes.toString('utf8'));
  if (!checked.recognized) return checked;
  let valid = sourcePath.toLowerCase().endsWith('.json') && bytes.length <= RUNTIME_CASE_DOCUMENT_FILE_MAX_BYTES;
  try { new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { valid = false; }
  return valid ? checked : { recognized: true, ok: false, value: null, diagnostics: [{ severity: 'error',
    code: 'runtime_case_document_invalid', message: 'A runtime case requires bounded UTF-8 JSON in a registered .json document.', propertyPath: '' }] };
}

export function inspectPackageRuntimeCaseSuite(bytes, sourcePath) {
  const checked = inspectRuntimeCaseSuite(bytes.toString('utf8'));
  if (!checked.recognized) return checked;
  let valid = sourcePath.toLowerCase().endsWith('.json') && bytes.length <= RUNTIME_CASE_SUITE_FILE_MAX_BYTES;
  try { new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { valid = false; }
  return valid ? checked : { recognized: true, ok: false, value: null, diagnostics: [{ severity: 'error',
    code: 'runtime_suite_invalid', message: 'A runtime case suite requires bounded UTF-8 JSON in a registered .json document.', propertyPath: '' }] };
}

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
  const projectionChecks = [], compositionChecks = [], behaviorChecks = [], caseChecks = [], suiteChecks = [], documentSources = [];
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
        const sourceText = source.toString('utf8');
        const projection = await validateObjectProjection(sourceText, record, { digest: packageDigest });
        const composition = inspectPackageComposition(source, relative);
        const behavior = inspectPackageSceneBehaviors(source, relative);
        const runtimeCase = inspectPackageRuntimeCase(source, relative);
        const suite = inspectPackageRuntimeCaseSuite(source, relative);
        // Dependency validation only needs availability and the projection or
        // composition classification. Do not retain every source body.
        documentSources.push({ record, sourcePath: relative,
          content: packageDocumentClassification(projection, composition) });
        if (projection.recognized) projectionChecks.push({ item, record, projection });
        if (composition.recognized) compositionChecks.push({ item, record, composition });
        if (behavior.recognized) behaviorChecks.push({ item, record, behavior });
        if (runtimeCase.recognized) caseChecks.push({ item, record, checked: runtimeCase });
        if (suite.recognized) suiteChecks.push({ item, record, checked: suite });
        const fingerprint = { size: source.length, sha256: packageDigest(source) };
        sources.set(record.id, fingerprint); revisions.push([record.id, fingerprint.sha256]);
        const parsed = parseSourceContent(source.toString('utf8'), relative, resolveDocumentDefinition(workspace, relative, record));
        if (parsed.parseError) item.problems.push('正文解析失败');
        item.name = composition.ok && composition.recognized ? composition.value.scene.title : parsed.title || item.name;
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
        if (composition.ok) for (const id of [...composition.dependencies.objectIds, ...composition.dependencies.imageResourceIds]) deps.add(id);
        if (behavior.ok && behavior.recognized) for (const id of sceneBehaviorDocumentIds(behavior.value)) deps.add(id);
        if (runtimeCase.ok && runtimeCase.recognized) for (const id of runtimeCaseDocumentIds(runtimeCase.value)) deps.add(id);
        if (suite.ok && suite.recognized) for (const id of runtimeCaseSuiteDocumentIds(suite.value)) deps.add(id);
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
  // Metadata alone cannot describe a projection whose JSON was edited outside
  // the semantic command. Refuse incomplete selective packages, while complete
  // workspace backups remain able to preserve the original damaged bytes.
  const projectionSource = { documents: documentSources, assets: registry.assets.map(record => ({ record })) };
  // Only opted-in declarative manifests require the actual scene/script body.
  // Re-observe these source-derived UUID dependencies against catalog hashes;
  // ordinary author documents still retain only their thin classification.
  const bodyDependencyIds = new Set([...behaviorChecks.filter(item => item.behavior.ok).flatMap(item => sceneBehaviorDocumentIds(item.behavior.value)),
    ...caseChecks.filter(item => item.checked.ok).flatMap(item => runtimeCaseDocumentIds(item.checked.value)),
    ...suiteChecks.filter(item => item.checked.ok).flatMap(item => runtimeCaseSuiteDocumentIds(item.checked.value))]);
  for (const id of bodyDependencyIds) {
    const document = documentSources.find(item => item.record.id === id);
    if (!document) continue;
    document.content = null;
    try {
      const bytes = await readPackageBytes(root, document.sourcePath, signal);
      if (JSON.stringify({ size: bytes.length, sha256: packageDigest(bytes) }) !== JSON.stringify(sources.get(id))) throw packageError('资源清单已变化，请刷新后重新选择', 409);
      document.content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    } catch (error) { signal?.throwIfAborted(); if (error.statusCode === 409) throw error; }
  }
  for (const { item, record, projection } of projectionChecks) {
    if (!projection.ok || validateProjectionDependencies(projection.value, record, projectionSource).length) item.problems.push('正文解析失败');
  }
  for (const { item, record, composition } of compositionChecks) {
    if (!composition.ok || validateSceneCompositionDependencies(composition, record, projectionSource).length) item.problems.push('正文解析失败');
  }
  for (const { item, record, behavior } of behaviorChecks) {
    if (!behavior.ok || validateSceneBehaviorDependencies(behavior.value, record, projectionSource).length) item.problems.push('正文解析失败');
  }
  for (const { item, record, checked } of caseChecks) {
    if (!checked.ok || validateRuntimeCaseDocumentDependencies(checked.value, record, projectionSource).length) item.problems.push('正文解析失败');
  }
  for (const { item, record, checked } of suiteChecks) {
    if (!checked.ok || validateRuntimeCaseSuiteDependencies(checked.value, record, projectionSource).length) item.problems.push('正文解析失败');
  }
  const byId = new Map(entries.map(item => [item.id, item]));
  for (const item of entries) for (const dependency of item.dependencies) if (!byId.has(dependency)) item.problems.push(dependency);
  for (const record of registry.documents) for (const relation of record.relations || []) {
    if (relation.kind === 'part-of') byId.get(relation.targetId)?.children.push(record.id);
  }
  for (const { item, checked } of [...caseChecks, ...suiteChecks]) if (checked.ok && item.status === 'available' && !item.problems.length) {
    const scene = byId.get(checked.value.sceneObjectId);
    if (scene && !scene.children.includes(item.id)) scene.children.push(item.id);
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
