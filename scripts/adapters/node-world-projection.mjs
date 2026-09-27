import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createWorldProjection, canonicalJson } from '../../engine/world-projection.mjs';
import { queryWorldProjection, validateWorldQuery } from '../../engine/world-query.mjs';
import { createError } from '../../engine/service-error.mjs';
import { readWorkspace, readRegistry, resolveAssetRoot, walkFiles } from '../lib/workspace.mjs';
import { projectDefinition, resolveDocumentDefinition, workspacePaths } from '../lib/project-layout.mjs';
import { resolveContainedPath } from '../lib/contained-path.mjs';
import { DOCUMENT_SOURCE_EXTENSIONS } from '../../engine/document-contract.mjs';
import { readWorldFence, assertWorldFence } from '../lib/world-transaction-state.mjs';

const digest = value => createHash('sha256').update(value).digest('hex');
const changed = () => createError(409, 'Workspace changed while reading; retry the query', {}, 'world_read_conflict');
const unavailable = () => createError(422, 'Cannot read this workspace projection', {}, 'world_unavailable');
const maxFileBytes = 8 * 1024 * 1024, maxTotalBytes = 64 * 1024 * 1024;

export async function readWorldSnapshot(root) {
  try {
    root = await fs.realpath(root);
    const fence = await readWorldFence(root);
    // Validate every path component before the legacy readers open metadata.
    await resolveContainedPath(root, path.join(root, '.viento'), { allowMissing: true });
    await resolveContainedPath(root, path.join(root, 'metadata'), { allowMissing: true });
    const workspace = readWorkspace(root);
    if (!workspace) throw createError(422, 'An identified workspace is required; open a registered project', {}, 'world_workspace_required');
    const registry = await readRegistry(root), definition = projectDefinition(workspace);
    const documentsRoot = workspacePaths(workspace).documents;
    const inventory = async () => {
      const folder = await resolveContainedPath(root, path.join(root, documentsRoot));
      return (await walkFiles(folder)).filter(name => DOCUMENT_SOURCE_EXTENSIONS.includes(path.extname(name).toLowerCase()))
        .map(name => `${documentsRoot}/${name}`);
    };
    const paths = await inventory(), records = new Map(registry.documents.map(record => [record.sourcePath, record]));
    const documents = [], assets = [];
    let totalBytes = 0;
    const readSource = async sourcePath => {
      try {
        const absolute = await resolveContainedPath(root, path.join(root, sourcePath));
        const stat = await fs.stat(absolute);
        if (!stat.isFile()) throw unavailable();
        if (stat.size > maxFileBytes || (totalBytes += stat.size) > maxTotalBytes) throw createError(413,
          'Workspace source exceeds the projection read limit', {}, 'world_source_limit');
        const bytes = await fs.readFile(absolute);
        if (bytes.length !== stat.size) throw changed();
        return { content: new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes), sourceRevision: `sha256:${digest(bytes)}` };
      } catch (error) {
        if (error.code === 'ENOENT') return { content: null, sourceRevision: null };
        throw error;
      }
    };
    for (const sourcePath of [...new Set([...paths, ...records.keys()])].sort()) {
      const record = records.get(sourcePath) || null;
      documents.push({ sourcePath, record, descriptor: resolveDocumentDefinition(workspace, sourcePath, record || {}), ...await readSource(sourcePath) });
    }
    const assetRoot = resolveAssetRoot(root), boundary = path.resolve(assetRoot) === path.join(root, 'assets') ? root : assetRoot;
    for (const record of registry.assets) {
      let availability;
      try {
        const file = await resolveContainedPath(boundary, path.join(assetRoot, record.location.path));
        const stat = await fs.stat(file);
        availability = !stat.isFile() ? 'unreadable' : record.content && record.content.size !== stat.size ? 'size-changed' : 'present-unverified';
      } catch (error) { availability = error.code === 'ENOENT' ? 'missing' : 'unreadable'; }
      assets.push({ record, availability });
    }
    // Detect a changed inventory, registry or source, including same-size edits
    // with preserved timestamps. This is an observed view, not a Build snapshot.
    if (canonicalJson(readWorkspace(root)) !== canonicalJson(workspace)
      || canonicalJson(await readRegistry(root)) !== canonicalJson(registry)
      || canonicalJson(await inventory()) !== canonicalJson(paths)) throw changed();
    totalBytes = 0;
    for (const document of documents) if ((await readSource(document.sourcePath)).sourceRevision !== document.sourceRevision) throw changed();
    const source = { workspace, definition, documents, assets };
    const projection = await createWorldProjection(source, { digest });
    await assertWorldFence(root, fence);
    return { source, projection };
  } catch (error) {
    if (error.statusCode && error.errorCode?.startsWith('world_')) throw error;
    // Host paths and local resource bindings never cross the query boundary.
    throw unavailable();
  }
}

export async function readWorldProjection(root) {
  return (await readWorldSnapshot(root)).projection;
}

export function createWorldQueryService(root) {
  let reading = null;
  return async (query = {}) => {
    validateWorldQuery(query);
    if (!reading) reading = readWorldProjection(root).finally(() => { reading = null; });
    return queryWorldProjection(await reading, query);
  };
}
