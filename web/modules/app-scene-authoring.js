import { t } from '../i18n/index.js';
import { fetchJsonApiRequest } from './app-services.js';
import { createSceneAuthoringWorkflow } from '../../engine/scene-authoring-workflow.mjs';
import { SCENE_PREVIEW_API_PATH } from '../../engine/scene-preview-contract.mjs';
import { WORLD_API_PATH } from '../../engine/world-query.mjs';
import { renderProjectionRuntime } from '../../engine/object-projection-template.mjs';
import { supportsStudioCoreCompositionPatch, supportsStudioCoreCompositionPositions, supportsStudioCoreCompositionFragment, supportsStudioCoreCompositionPlacement, supportsStudioCoreCompositionStructure, supportsStudioCoreCompositionPlacements, supportsStudioCoreCompositionGroups, supportsStudioCoreCompositionDefinitions } from '../../engine/studio-core.mjs';
import { setupSceneCompositionOverrides } from './app-scene-composition-overrides.js';
import { setupSceneCompositionLayout } from './app-scene-composition-layout.js';
import { setupSceneCompositionBatchLayout } from './app-scene-composition-batch-layout.js';
import { setupSceneCompositionFragments } from './app-scene-composition-fragments.js';
import { setupSceneCompositionPlacement } from './app-scene-composition-placement.js';
import { setupSceneCompositionStructure } from './app-scene-composition-structure.js';
import { setupSceneCompositionPlacements } from './app-scene-composition-placements.js';
import { setupSceneCompositionGroups } from './app-scene-composition-groups.js';
import { setupSceneCompositionDefinitions } from './app-scene-composition-definitions.js';

// The browser adapter connects independent editors to source, review and
// navigation ports. Their workflow and candidate rules remain in engine/.
export function setupSceneAuthoring({ getState, getSource, applyActions, onApplied,
  request = fetchJsonApiRequest } = {}) {
  const digest = async content => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(content)))]
    .map(byte => byte.toString(16).padStart(2, '0')).join('');
  const readWorld = async () => (await request(WORLD_API_PATH, { cache: 'no-store' }, 15000, t('读取世界'))).payload;
  const imagesFrom = payload => (payload?.resources || []).filter(resource => resource.descriptor?.kind === 'image'
    && resource.availability === 'present-unverified' && /\.(png|jpe?g|webp|svg)$/i.test(resource.descriptor.location?.path || ''))
    .map(resource => ({ id: resource.id, name: resource.descriptor.name, path: resource.descriptor.location.path }));
  const loadImages = async ({ isCurrent }) => {
    const payload = await readWorld();
    return isCurrent() ? { images: imagesFrom(payload) } : null;
  };
  const loadStructureCatalog = async ({ sceneId, isCurrent }) => {
    const payload = await readWorld();
    if (!isCurrent()) return null;
    const objects = (payload?.objects || []).flatMap(object => {
      if (object.id === sceneId || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(object.id || '')
        || object.provenance?.identity !== 'registered' || !object.documentRefs?.[0]?.sourceRevision
        || (payload.diagnostics || []).some(item => item.objectId === object.id && item.severity === 'error')) return [];
      let projectionDefaults;
      if (Object.hasOwn(object.provenance, 'authoredProjection')) {
        try { projectionDefaults = renderProjectionRuntime(object.provenance.authoredProjection); } catch { return []; }
        if (!projectionDefaults) return [];
      }
      return [{ id: object.id, name: object.name, sourcePath: object.documentRefs[0].sourcePath,
        ...(projectionDefaults ? { projectionDefaults } : {}) }];
    });
    return { objects, images: imagesFrom(payload) };
  };
  const reviewCandidate = async proposal => (await request(SCENE_PREVIEW_API_PATH, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sceneId: proposal.sceneId, draft: { sourcePath: proposal.sourcePath,
      baseSourceRevision: proposal.baseSourceRevision, content: proposal.afterContent } }),
  }, 15000, t('正在检查配方与素材…'))).payload;
  const releasePreview = previewId => request(`${SCENE_PREVIEW_API_PATH}?previewId=${encodeURIComponent(previewId)}`, {
    method: 'DELETE', headers: { 'Content-Type': 'application/json' },
  }, 5000, t('释放场景预览'));
  const definitions = [
    ['Override', 'instance', supportsStudioCoreCompositionPatch, setupSceneCompositionOverrides, applyActions.instance, loadImages],
    ['Layout', 'instance', supportsStudioCoreCompositionPatch, setupSceneCompositionLayout, applyActions.instance],
    ['BatchLayout', 'positions', supportsStudioCoreCompositionPositions, setupSceneCompositionBatchLayout, applyActions.positions],
    ['Fragment', 'fragment', supportsStudioCoreCompositionFragment, setupSceneCompositionFragments, applyActions.fragment, loadImages],
    ['Placement', 'placement', supportsStudioCoreCompositionPlacement, setupSceneCompositionPlacement, applyActions.placement],
    ['Structure', 'structure', supportsStudioCoreCompositionStructure, setupSceneCompositionStructure, applyActions.structure, loadStructureCatalog],
    ['Placements', 'placements', supportsStudioCoreCompositionPlacements, setupSceneCompositionPlacements, applyActions.placements],
    ['Groups', 'groups', supportsStudioCoreCompositionGroups, setupSceneCompositionGroups, applyActions.groups],
    ['Definitions', 'definitions', supportsStudioCoreCompositionDefinitions, setupSceneCompositionDefinitions, applyActions.definitions, loadStructureCatalog],
  ];
  const entries = definitions.map(([name, kind, isSupported, setup, applyDraft, loadCatalog]) => {
    const capabilityKey = `canEditComposition${name}`;
    const workflow = createSceneAuthoringWorkflow({ kind, capabilityKey, isSupported, getState, getSource,
      loadCatalog, reviewCandidate, releasePreview, digest, applyDraft, onApplied });
    const editor = setup(workflow);
    return { name, capabilityKey, workflow, editor };
  });
  return {
    previewContext: () => Object.fromEntries(entries.map(({ capabilityKey, workflow }) => [capabilityKey, workflow.canEdit()])),
    previewActions: Object.fromEntries(entries.map(({ name, workflow, editor }) => [`editComposition${name}`, input => workflow.open(editor, input)])),
    refresh() { for (const { editor } of entries) editor.refresh?.(); },
    closed() { for (const { workflow } of entries) workflow.reset(); },
  };
}
