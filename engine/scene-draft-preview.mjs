// A draft is a read-only overlay of one registered scene's exact UTF-8 source.
// Registration records remain untouched; projection is derived again so source
// diagnostics, field locations and world revisions never describe older text.
import { createWorldProjection } from './world-projection.mjs';
import { createError } from './service-error.mjs';
import { MAX_SCENE_DRAFT_BYTES } from './scene-preview-contract.mjs';

const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const revision = value => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
const invalid = () => createError(400, 'Provide a bounded draft of the selected registered scene.', {}, 'scene_preview_request_invalid');
const exactKeys = (value, keys) => plain(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));

export function validateSceneDraftRequest(sceneId, draft) {
  if (!uuid(sceneId) || !exactKeys(draft, ['sourcePath', 'baseSourceRevision', 'content'])
    || typeof draft.sourcePath !== 'string' || !draft.sourcePath.length || draft.sourcePath.length > 4096
    || !revision(draft.baseSourceRevision) || typeof draft.content !== 'string' || draft.content.length > MAX_SCENE_DRAFT_BYTES) throw invalid();
  // UTF-8 would silently replace lone surrogate code units and lose identity.
  for (const character of draft.content) {
    const code = character.codePointAt(0);
    if (code >= 0xd800 && code <= 0xdfff) throw invalid();
  }
  if (new TextEncoder().encode(draft.content).length > MAX_SCENE_DRAFT_BYTES) throw invalid();
}

export async function overlaySceneDraftPreview(observed, sceneId, draft, { digest }) {
  validateSceneDraftRequest(sceneId, draft);
  const document = observed?.source?.documents?.find(item => item.record?.id === sceneId);
  if (!document || !observed.projection?.objects?.some(item => item.id === sceneId)
    || typeof document.content !== 'string' || document.sourcePath !== draft.sourcePath
    || !document.sourcePath.toLowerCase().endsWith('.json')) throw invalid();
  if (document.sourceRevision !== draft.baseSourceRevision) throw createError(409,
    'The saved scene changed; reload it before previewing this draft.', {}, 'scene_preview_draft_conflict');
  const sourceRevision = `sha256:${await digest(draft.content)}`;
  if (!revision(sourceRevision) || `sha256:${await digest(document.content)}` !== document.sourceRevision) {
    throw new TypeError('Draft preview requires an exact SHA-256 source observation.');
  }
  const source = structuredClone(observed.source);
  const overlay = source.documents.find(item => item.record?.id === sceneId);
  overlay.content = draft.content; overlay.sourceRevision = sourceRevision;
  const projection = await createWorldProjection(source, { digest });
  return { source, projection, draft: { baseSourceRevision: draft.baseSourceRevision, sourceRevision } };
}
