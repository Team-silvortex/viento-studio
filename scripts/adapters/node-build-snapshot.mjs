import './node-studio-core.mjs';
import { overlaySceneDraftPreview, validateSceneDraftRequest } from '../../engine/scene-draft-preview.mjs';
import { createSceneStructure } from '../../engine/scene-structure.mjs';
import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { readWorldSnapshot } from './node-world-projection.mjs';
import { scene2DModelToPlan, attachSceneBehaviorPlan, buildActorFieldLocation } from '../../engine/build-plan.mjs';
import { sceneActorIdentity } from '../../engine/scene-identity.mjs';
import { resolveScene2DModel } from '../../engine/scene-model.mjs';
import { resolveSceneCompositionPreview } from '../../engine/scene-composition-preview.mjs';
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
  // Build requests always capture saved bytes, even if callers supply unknown
  // options. Draft previews cannot become executable build snapshots.
  return captureScene(root, sceneRef, { signal });
}

export async function captureScenePreviewSnapshot(root, sceneRef, { signal } = {}) {
  return captureScene(root, sceneRef, { signal, compositionPreview: true });
}

export async function captureSceneDraftPreview(root, sceneRef, draft, { signal } = {}) {
  validateSceneDraftRequest(sceneRef, draft);
  return captureScene(root, sceneRef, { signal, draft, compositionPreview: true });
}

async function captureScene(root, sceneRef, { signal, draft, compositionPreview = false } = {}) {
  root = await fs.realpath(root);
  signal?.throwIfAborted();
  const fence = await readWorldFence(root);
  await resolveContainedPath(root, path.join(root, '.viento/local.json'), { allowMissing: true });
  const observed = await readWorldSnapshot(root);
  signal?.throwIfAborted();
  const effective = draft ? await overlaySceneDraftPreview(observed, sceneRef, draft, { digest: buildHash }) : observed;
  signal?.throwIfAborted();
  const composition = compositionPreview ? await resolveSceneCompositionPreview(effective, sceneRef, { digest: buildHash }) : null;
  signal?.throwIfAborted();
  const draftMeta = draft ? { draft: effective.draft } : {};
  const previewMeta = { ...draftMeta, ...(composition?.composition ? { composition: composition.composition } : {}) };
  const assertDraftBaseline = after => {
    if (draft && after.source.documents.find(item => item.record?.id === sceneRef)?.sourceRevision !== draft.baseSourceRevision) {
      throw buildError('scene_preview_draft_conflict', 'The saved scene changed while freezing this draft.');
    }
  };
  const finishInvalidPreview = async result => {
    if (draft || composition?.recognized) {
      signal?.throwIfAborted();
      const after = await readWorldSnapshot(root);
      assertDraftBaseline(after);
      if (canonicalJson(after.source) !== canonicalJson(observed.source)) throw buildError('build_input_changed', 'Workspace changed while freezing draft inputs; retry.');
      await assertWorldFence(root, fence);
      signal?.throwIfAborted();
    }
    return { ...result, ...previewMeta };
  };
  const resolved = composition?.recognized ? composition : resolveScene2DModel(effective, sceneRef);
  let planned = { ok: resolved.ok, plan: resolved.model ? scene2DModelToPlan(resolved.model) : null, diagnostics: resolved.diagnostics };
  if (planned.ok && !compositionPreview && !draft) planned = attachSceneBehaviorPlan(effective, planned.plan);
  if (!planned.ok) return finishInvalidPreview(planned);
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
      return finishInvalidPreview({ ok: false, plan: planned.plan, diagnostics: [{ severity: 'error', code: error.errorCode || 'build_resource_unavailable',
        message: 'Cannot freeze image bytes; check availability and the registered hash.', resourceId: resource.id,
        ...(resolved.model.sourceLocations.actors.find(item => sceneActorIdentity(item) === sceneActorIdentity(actor))?.fields.imageResourceId
          || buildActorFieldLocation(actor, 'imageResourceId')) }] });
    }
  }
  signal?.throwIfAborted();
  const after = await readWorldSnapshot(root);
  assertDraftBaseline(after);
  if (canonicalJson(after.source) !== canonicalJson(observed.source) || resolveAssetRoot(root) !== assetRoot) {
    throw buildError('build_input_changed', 'Workspace changed while freezing build inputs; retry.');
  }
  await assertWorldFence(root, fence);
  signal?.throwIfAborted();
  if (composition?.recognized) {
    // A recipe preview is a transient expansion. It never yields the build
    // envelope or editing preconditions used to write a registered scene.
    const identity = { format: 'viento-scene-composition-preview', schemaVersion: 1,
      source: effective.source, plan: planned.plan, ...previewMeta };
    return { ...planned, ...previewMeta, snapshotId: `sha256:${buildHash(canonicalJson(identity))}`, resources,
      sourceLocations: resolved.model.sourceLocations, sceneStructure: createSceneStructure(resolved.model) };
  }
  if (draft) {
    // Domain-separated identity only. Never expose a build-snapshot envelope,
    // journal preconditions or a reusable disk build result for unsaved bytes.
    const identity = { format: 'viento-scene-draft-preview', schemaVersion: 1,
      source: effective.source, plan: planned.plan, draft: effective.draft };
    return { ...planned, ...draftMeta, snapshotId: `sha256:${buildHash(canonicalJson(identity))}`, resources,
      sourceLocations: resolved.model.sourceLocations,
      ...(resolved.model.schemaVersion === 3 ? { sceneStructure: createSceneStructure(resolved.model) } : {}) };
  }
  // Exact document text + parsed authoring descriptors are enough to reproduce
  // this plan. Resources travel separately as bytes identified by their hash.
  const snapshot = { format: 'viento-build-snapshot', schemaVersion: 1,
    source: observed.source, plan: planned.plan };
  const object = observed.projection.objects.find(item => item.id === planned.plan.scene.objectId);
  const document = observed.source.documents.find(item => item.record?.id === object?.id);
  // Editor preconditions come from the same fenced observation as the rendered
  // actors. They are deliberately outside the reproducible build snapshot.
  const sceneEditing = object && document ? {
    worldId: observed.projection.world.id, baseRevision: observed.projection.world.revision,
    objectRevision: object.revision, sourceRevision: document.sourceRevision, content: document.content,
  } : undefined;
  return { ...planned, snapshot, snapshotId: `sha256:${buildHash(canonicalJson(snapshot))}`, resources, sceneEditing,
    sourceLocations: resolved.model.sourceLocations,
    ...(resolved.model.schemaVersion === 3 ? { sceneStructure: createSceneStructure(resolved.model) } : {}) };
}
