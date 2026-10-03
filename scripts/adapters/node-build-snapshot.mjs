import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { readWorldSnapshot } from './node-world-projection.mjs';
import { createScene2DPlan, buildActorFieldLocation } from '../../engine/build-plan.mjs';
import { canonicalJson } from '../../engine/world-projection.mjs';
import { resolveAssetRoot } from '../lib/workspace.mjs';
import { resolveContainedPath } from '../lib/contained-path.mjs';
import { readWorldFence, assertWorldFence } from '../lib/world-transaction-state.mjs';

export const buildHash = bytes => createHash('sha256').update(bytes).digest('hex');
export const buildError = (code, message, details = {}) => Object.assign(new Error(message), { errorCode: code, ...details });

// Read a bounded regular file without following a final symlink or blocking on
// a FIFO. Resource contents are retained in memory until the snapshot is frozen.
export async function readBuildFile(file, limit, signal) {
  signal?.throwIfAborted();
  const handle = await fs.open(file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0) | (constants.O_NONBLOCK || 0));
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > limit) throw buildError('build_input_limit', 'Build input is not a bounded regular file.');
    const buffer = Buffer.alloc(stat.size + 1);
    let offset = 0;
    while (offset < buffer.length) {
      signal?.throwIfAborted();
      const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, null);
      if (!bytesRead) break;
      offset += bytesRead;
    }
    const after = await handle.stat();
    if (offset !== stat.size || after.ctimeMs !== stat.ctimeMs || after.mtimeMs !== stat.mtimeMs) throw buildError('build_input_changed', 'Input changed during snapshot capture.');
    return buffer.subarray(0, offset);
  } finally { await handle.close(); }
}

export async function captureBuildSnapshot(root, sceneRef, { signal } = {}) {
  root = await fs.realpath(root);
  signal?.throwIfAborted();
  const fence = await readWorldFence(root);
  await resolveContainedPath(root, path.join(root, '.viento/local.json'), { allowMissing: true });
  const observed = await readWorldSnapshot(root);
  const planned = createScene2DPlan(observed, sceneRef);
  if (!planned.ok) return planned;
  const resources = new Map();
  const assetRoot = resolveAssetRoot(root);
  const boundary = assetRoot === path.join(root, 'assets') ? root : assetRoot;
  let totalBytes = 0;
  for (const resource of planned.plan.resources) {
    const record = observed.source.assets.find(item => item.record.id === resource.id).record;
    try {
      const file = await resolveContainedPath(boundary, path.join(assetRoot, record.location.path));
      if ((totalBytes += resource.size) > 128 * 1024 * 1024) throw buildError('build_input_limit', 'Selected images exceed 128 MiB.');
      const bytes = await readBuildFile(file, 32 * 1024 * 1024, signal);
      if (bytes.length !== resource.size || buildHash(bytes) !== resource.sha256) throw buildError('build_resource_changed', 'Image bytes no longer match the registered content hash.');
      resources.set(resource.id, bytes);
    } catch (error) {
      signal?.throwIfAborted();
      const actor = planned.plan.actors.find(actor => actor.imageResourceId === resource.id);
      return { ok: false, plan: planned.plan, diagnostics: [{ severity: 'error', code: error.errorCode || 'build_resource_unavailable',
        message: 'Cannot freeze image bytes; check availability and the registered hash.', resourceId: resource.id,
        ...buildActorFieldLocation(actor, 'imageResourceId') }] };
    }
  }
  signal?.throwIfAborted();
  const after = await readWorldSnapshot(root);
  if (canonicalJson(after.source) !== canonicalJson(observed.source) || resolveAssetRoot(root) !== assetRoot) {
    throw buildError('build_input_changed', 'Workspace changed while freezing build inputs; retry.');
  }
  await assertWorldFence(root, fence);
  // Exact document text + parsed authoring descriptors are enough to reproduce
  // this plan. Resources travel separately as bytes identified by their hash.
  const snapshot = { format: 'viento-build-snapshot', schemaVersion: 1,
    source: observed.source, plan: planned.plan };
  return { ...planned, snapshot, snapshotId: `sha256:${buildHash(canonicalJson(snapshot))}`, resources };
}
