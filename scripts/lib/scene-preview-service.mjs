import { sceneStructureActors } from '../../engine/scene-structure.mjs';
import { randomUUID } from 'node:crypto';
import { createError } from '../../engine/service-error.mjs';
import { validateSceneDraftRequest } from '../../engine/scene-draft-preview.mjs';
import { captureBuildSnapshot, captureSceneDraftPreview } from '../adapters/node-build-snapshot.mjs';
import { SCENE_PREVIEW_API_PATH } from '../../engine/scene-preview-contract.mjs';

const services = new Set();
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const fail = (code, message, status = 400) => createError(status, message, {}, code);
const clone = value => JSON.parse(JSON.stringify(value));
const mediaTypes = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', svg: 'image/svg+xml' };
const MAX_BYTES = 128 * 1024 * 1024;

export async function stopScenePreviewServices() {
  await Promise.all([...services].map(service => service.close()));
}

// Preview owns frozen, hash-verified image bytes, never a live asset path. A new
// capture cancels its predecessor and waits for it, bounding in-flight memory.
export function createScenePreviewService(root, {
  enabled = process.platform === 'linux', ttlMs = 10 * 60 * 1000,
  capture = captureBuildSnapshot, captureDraft = captureSceneDraftPreview,
} = {}) {
  let closed = false, closing, active = null, retainedBytes = 0;
  const previews = new Map();
  const ready = () => {
    if (closed) throw fail('scene_preview_closed', 'Scene preview service is closing.', 503);
    if (!enabled) throw fail('scene_preview_unavailable', 'Scene previews are not enabled on this host.', 403);
  };
  function discard(id) {
    const entry = previews.get(id);
    if (!entry) return false;
    clearTimeout(entry.timer); previews.delete(id); retainedBytes -= entry.byteLength;
    return true;
  }
  function prune() {
    for (const [id, entry] of previews) if (entry.expiresAt <= Date.now()) discard(id);
  }
  async function create(payload, { signal } = {}) {
    ready();
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)
      || !Object.hasOwn(payload, 'sceneId') || Object.keys(payload).some(key => !['sceneId', 'draft'].includes(key)) || !uuid(payload.sceneId)) {
      throw fail('scene_preview_request_invalid', 'Select a registered scene identity.');
    }
    const isDraft = Object.hasOwn(payload, 'draft');
    if (isDraft) validateSceneDraftRequest(payload.sceneId, payload.draft);
    const previous = active;
    previous?.controller.abort();
    const owner = { controller: new AbortController(), promise: null };
    active = owner;
    const cancel = () => owner.controller.abort();
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) cancel();
    const assertOwner = () => {
      if (closed) throw fail('scene_preview_closed', 'Scene preview service is closing.', 503);
      if (active !== owner || owner.controller.signal.aborted) throw fail('scene_preview_superseded', 'A newer preview request replaced this capture.', 409);
    };
    owner.promise = (async () => {
      if (previous) await previous.promise.catch(() => {});
      assertOwner();
      let captured;
      try { captured = isDraft
        ? await captureDraft(root, payload.sceneId, payload.draft, { signal: owner.controller.signal })
        : await capture(root, payload.sceneId, { signal: owner.controller.signal }); }
      catch (error) {
        assertOwner();
        throw fail(error.errorCode || 'scene_preview_failed', 'Cannot freeze this scene preview.',
          error.errorCode === 'scene_preview_request_invalid' ? 400
            : ['scene_preview_draft_conflict', 'build_input_changed', 'world_read_conflict', 'world_recovery_required'].includes(error.errorCode) ? 409 : 422);
      }
      assertOwner();
      const draft = isDraft && captured.draft ? { baseSourceRevision: captured.draft.baseSourceRevision,
        sourceRevision: captured.draft.sourceRevision } : undefined;
      if (!captured.ok) return { ok: false, previewId: null, diagnostics: clone(captured.diagnostics || []), ...(draft ? { draft } : {}) };
      const previewId = randomUUID();
      const resources = captured.plan.resources.map(resource => ({ id: resource.id, sha256: resource.sha256, size: resource.size,
        contentType: mediaTypes[resource.extension],
        url: `${SCENE_PREVIEW_API_PATH}?previewId=${previewId}&resourceId=${resource.id}` }));
      const byteLength = resources.reduce((size, resource) => size + resource.size, 0);
      if (byteLength > MAX_BYTES || resources.some(resource => !resource.contentType || captured.resources.get(resource.id)?.length !== resource.size)) {
        throw fail('scene_preview_limit', 'Scene preview images exceed the supported memory limit.', 422);
      }
      const result = { ok: true, format: 'viento-scene-preview', schemaVersion: captured.plan.schemaVersion || 1, previewId,
        snapshotId: captured.snapshotId, scene: captured.plan.scene, actors: captured.plan.actors, resources,
        diagnostics: captured.diagnostics || [] };
      if (captured.sceneStructure !== undefined) {
        sceneStructureActors(captured.sceneStructure, captured.plan.actors);
        const { format, schemaVersion, sourceSchemaVersion, groups, memberships } = captured.sceneStructure;
        result.sceneStructure = clone({ format, schemaVersion, sourceSchemaVersion, groups, memberships });
      }
      if (captured.sourceLocations) result.sourceLocations = clone(captured.sourceLocations);
      if (draft) result.draft = draft;
      if (!isDraft && captured.sceneEditing) {
        const { worldId, baseRevision, objectRevision, sourceRevision, content } = captured.sceneEditing;
        result.sceneEditing = { worldId, baseRevision, objectRevision, sourceRevision, content };
      }
      prune();
      while (previews.size >= 2 || retainedBytes + byteLength > MAX_BYTES) discard(previews.keys().next().value);
      const timer = setTimeout(() => discard(previewId), ttlMs);
      timer.unref?.();
      previews.set(previewId, { byteLength, expiresAt: Date.now() + ttlMs, timer,
        resources: captured.resources, descriptors: new Map(resources.map(resource => [resource.id, resource])) });
      retainedBytes += byteLength;
      return clone(result);
    })();
    try { return await owner.promise; }
    finally { signal?.removeEventListener('abort', cancel); if (active === owner) active = null; }
  }
  function resource(previewId, resourceId) {
    ready();
    if (!uuid(previewId) || !uuid(resourceId)) throw fail('scene_preview_request_invalid', 'Invalid preview or resource identity.');
    prune();
    const entry = previews.get(previewId), descriptor = entry?.descriptors.get(resourceId);
    if (!descriptor) throw fail('scene_preview_expired', 'This preview resource is no longer available; refresh the preview.', 404);
    // Only the HTTP responder receives these immutable bytes. Sharing avoids
    // creating a full extra asset copy for every concurrent image request.
    return { bytes: entry.resources.get(resourceId), contentType: descriptor.contentType };
  }
  function release(previewId) {
    ready();
    if (!uuid(previewId)) throw fail('scene_preview_request_invalid', 'Invalid preview identity.');
    return { released: discard(previewId) };
  }
  const service = { create, resource, release, close() {
    if (closing) return closing;
    closed = true; active?.controller.abort();
    for (const id of previews.keys()) discard(id);
    closing = Promise.resolve(active?.promise).catch(() => {}).finally(() => services.delete(service));
    return closing;
  } };
  services.add(service);
  return service;
}
