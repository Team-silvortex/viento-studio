import { setupSceneAnimation } from './app-scene-animation.js';
import { setupSceneCompositionCreate } from './app-scene-composition-create.js';
import { setupScriptCreate } from './app-script-create.js';
import { setupSceneAudio } from './app-scene-audio.js';
import { setupSceneBehaviors } from './app-scene-behaviors.js';
import { createStudioModuleRegistry } from '../../engine/studio-modules.mjs';
import { setupSettings } from '../i18n/settings.js';
import { setupMediaEditor } from './app-media-editor.js';
import { setupExport } from './app-export.js';
import { setupProjectSettings } from './app-project-settings.js';
import { setupWorldBrowser } from './app-world-browser.js';
import { setupProjectBuild } from './app-project-build.js';
import { setupScene3DPreview } from './app-scene3d-preview.js';
import { setupScene3DTransforms } from './app-scene3d-transforms.js';
import { setupScene3DObjects } from './app-scene3d-objects.js';
import { setupScene3DEnvironment } from './app-scene3d-environment.js';
import { setupScene3DProperties } from './app-scene3d-properties.js';
import { setupScene3DTranslation } from './app-scene3d-translation.js';
import { setupScene3DAlignment } from './app-scene3d-alignment.js';
import { setupScene3DDistribution } from './app-scene3d-distribution.js';
import { setupScene3DCopy } from './app-scene3d-copy.js';
import { setupScene3DRemoval } from './app-scene3d-removal.js';

const IDS = Object.freeze({ sceneAnimation: 'org.viento.scene-animation', compositionCreate: 'org.viento.scene-composition-create', scripts: 'org.viento.scripts', sceneBehaviors: 'org.viento.scene-behaviors', sceneAudio: 'org.viento.scene-audio', document: 'org.viento.document', settings: 'org.viento.settings', world: 'org.viento.world',
  project: 'org.viento.project', export: 'org.viento.export', media: 'org.viento.media', build: 'org.viento.build', scene3d: 'org.viento.scene3d',
  scene3dTransforms: 'org.viento.scene3d-transforms', scene3dObjects: 'org.viento.scene3d-objects', scene3dEnvironment: 'org.viento.scene3d-environment', scene3dProperties: 'org.viento.scene3d-properties',
  scene3dTranslation: 'org.viento.scene3d-translation', scene3dAlignment: 'org.viento.scene3d-alignment', scene3dDistribution: 'org.viento.scene3d-distribution', scene3dCopy: 'org.viento.scene3d-copy', scene3dRemoval: 'org.viento.scene3d-removal' });
const copy = value => JSON.parse(JSON.stringify(value));

/**
 * Studio's browser composition root. Domain options are injected separately;
 * controllers and source authority are never handed to sibling modules.
 * Existing views mount once. A project profile requests additive capabilities;
 * capability refresh is not hot loading, disposal or permission to save.
 */
export async function setupStudioSystem({ settings, features = {}, ports = {} } = {}) {
  const registry = createStudioModuleRegistry();
  const enabledModules = { [IDS.sceneAnimation]: Boolean(ports.sceneAnimation) && features.sceneAnimation !== false, [IDS.sceneAudio]: Boolean(ports.sceneAudio) && features.sceneAudio !== false, [IDS.compositionCreate]: Boolean(ports.compositionCreate) && features.compositionCreate !== false, [IDS.scripts]: Boolean(ports.scripts) && features.scripts !== false, [IDS.sceneBehaviors]: Boolean(ports.sceneBehaviors) && features.sceneBehaviors !== false, [IDS.project]: features.project !== false, [IDS.export]: features.export !== false, [IDS.media]: features.media !== false,
    [IDS.scene3d]: Boolean(ports.scene3d) && features.scene3d !== false,
    [IDS.scene3dTransforms]: Boolean(ports.scene3dTransforms) && features.scene3dTransforms !== false,
    [IDS.scene3dObjects]: Boolean(ports.scene3dObjects) && features.scene3dObjects !== false,
    [IDS.scene3dEnvironment]: Boolean(ports.scene3dEnvironment) && features.scene3dEnvironment !== false,
    [IDS.scene3dProperties]: Boolean(ports.scene3dProperties) && features.scene3dProperties !== false,
    [IDS.scene3dTranslation]: Boolean(ports.scene3dTranslation) && features.scene3dTranslation !== false,
    [IDS.scene3dAlignment]: Boolean(ports.scene3dAlignment) && features.scene3dAlignment !== false,
    [IDS.scene3dDistribution]: Boolean(ports.scene3dDistribution) && features.scene3dDistribution !== false,
    [IDS.scene3dCopy]: Boolean(ports.scene3dCopy) && features.scene3dCopy !== false,
    [IDS.scene3dRemoval]: Boolean(ports.scene3dRemoval) && features.scene3dRemoval !== false };
  let profile = null, plan = registry.plan(profile, { enabledModules });
  let hostCapabilities = { semanticProjection: false, semanticCommands: [], projectBuild: false, scenePreview: false, sceneAnimationPreview: false, sceneBehaviorDirectory: false };
  const controllers = new Map(), initialized = [IDS.document];
  const active = id => plan.modules.some(module => module.id === id && module.active);
  const injectedPorts = Object.fromEntries(['sceneAnimation', 'compositionCreate', 'scripts', 'sceneBehaviors', 'sceneAudio', 'world', 'build', 'project', 'export', 'media', 'scene3d', 'scene3dTransforms', 'scene3dObjects', 'scene3dEnvironment', 'scene3dProperties', 'scene3dTranslation', 'scene3dAlignment', 'scene3dDistribution', 'scene3dCopy', 'scene3dRemoval']
    .map(name => [name, Object.freeze({ ...(ports[name] || {}) })]));
  const options = name => injectedPorts[name];
  function mount(id, setup, injected) {
    if (!active(id)) return null;
    const controller = setup(injected); controllers.set(id, controller); initialized.push(id); return controller;
  }
  // Language preferences must finish before any localized domain view mounts.
  if (active(IDS.settings)) { await setupSettings(settings ?? ports.settings ?? {}); initialized.push(IDS.settings); }
  if (typeof setupSceneCompositionCreate === 'function') mount(IDS.compositionCreate, setupSceneCompositionCreate, options('compositionCreate'));
  if (typeof setupScriptCreate === 'function') mount(IDS.scripts, setupScriptCreate, options('scripts'));
  if (typeof setupSceneBehaviors === 'function') mount(IDS.sceneBehaviors, setupSceneBehaviors, options('sceneBehaviors'));
  if (typeof setupSceneAnimation === 'function') mount(IDS.sceneAnimation, setupSceneAnimation, options('sceneAnimation'));
  if (typeof setupSceneAudio === 'function') mount(IDS.sceneAudio, setupSceneAudio, options('sceneAudio'));
  mount(IDS.world, setupWorldBrowser, options('world'));
  mount(IDS.build, setupProjectBuild, options('build'));
  mount(IDS.project, setupProjectSettings, options('project'));
  const exports = mount(IDS.export, setupExport, options('export'));
  const exportAsset = typeof exports?.exportAsset === 'function' ? (...args) => exports.exportAsset(...args) : undefined;
  const mediaPorts = { ...options('media') };
  // This is an optional declared service, not a sibling controller reference.
  // A disabled exporter must not disable author media insertion/preview.
  delete mediaPorts.exportAsset;
  if (exportAsset) mediaPorts.exportAsset = exportAsset;
  mount(IDS.media, setupMediaEditor, Object.freeze(mediaPorts));
  // The 3D preview is optional and owns only its read-only source port. Missing
  // setup bindings in a legacy assembly adapter must not break base editing.
  if (typeof setupScene3DPreview === 'function') mount(IDS.scene3d, setupScene3DPreview, options('scene3d'));
  if (typeof setupScene3DTransforms === 'function') mount(IDS.scene3dTransforms, setupScene3DTransforms, options('scene3dTransforms'));
  if (typeof setupScene3DObjects === 'function') mount(IDS.scene3dObjects, setupScene3DObjects, options('scene3dObjects'));
  if (typeof setupScene3DEnvironment === 'function') mount(IDS.scene3dEnvironment, setupScene3DEnvironment, options('scene3dEnvironment'));
  if (typeof setupScene3DProperties === 'function') mount(IDS.scene3dProperties, setupScene3DProperties, options('scene3dProperties'));
  if (typeof setupScene3DTranslation === 'function') mount(IDS.scene3dTranslation, setupScene3DTranslation, options('scene3dTranslation'));
  if (typeof setupScene3DAlignment === 'function') mount(IDS.scene3dAlignment, setupScene3DAlignment, options('scene3dAlignment'));
  if (typeof setupScene3DDistribution === 'function') mount(IDS.scene3dDistribution, setupScene3DDistribution, options('scene3dDistribution'));
  if (typeof setupScene3DCopy === 'function') mount(IDS.scene3dCopy, setupScene3DCopy, options('scene3dCopy'));
  if (typeof setupScene3DRemoval === 'function') mount(IDS.scene3dRemoval, setupScene3DRemoval, options('scene3dRemoval'));

  function applyCapabilities() {
    controllers.get(IDS.compositionCreate)?.setAvailable?.(active(IDS.compositionCreate) && hostCapabilities.semanticProjection);
    controllers.get(IDS.world)?.setAvailable?.(active(IDS.world) && hostCapabilities.semanticProjection, [...hostCapabilities.semanticCommands]);
    controllers.get(IDS.build)?.setAvailable?.(active(IDS.build) && hostCapabilities.projectBuild, [...hostCapabilities.semanticCommands],
      { scenePreview: active(IDS.build) && hostCapabilities.scenePreview, sceneAnimationPreview: active(IDS.build) && active(IDS.sceneAnimation) && hostCapabilities.scenePreview && hostCapabilities.sceneAnimationPreview, sceneBehaviorDirectory: active(IDS.build) && hostCapabilities.sceneBehaviorDirectory });
  }
  function updateCapabilities(payload) {
    hostCapabilities = { semanticProjection: payload?.semanticProjection === true,
      semanticCommands: Array.isArray(payload?.semanticCommands) ? payload.semanticCommands.filter(command => typeof command === 'string') : [],
      projectBuild: payload?.projectBuild === true, scenePreview: payload?.scenePreview === true, sceneAnimationPreview: payload?.sceneAnimationPreview === true, sceneBehaviorDirectory: payload?.sceneBehaviorDirectory === true };
    applyCapabilities();
    return snapshot();
  }
  function updateProject(workspace) {
    // Registry null means no request. A manifest that explicitly declares null
    // is invalid and must keep its diagnostic rather than silently opt out.
    profile = workspace && Object.hasOwn(workspace, 'studioProfile')
      ? workspace.studioProfile == null ? {} : workspace.studioProfile : null;
    plan = registry.plan(profile, { enabledModules });
    // Requests and diagnostics change; mounted legacy views and unsaved source
    // remain owned by the original document/editor ports.
    applyCapabilities();
    return snapshot();
  }
  function refreshMedia() {
    controllers.get(IDS.compositionCreate)?.refresh?.();
    controllers.get(IDS.scripts)?.refresh?.();
    controllers.get(IDS.sceneBehaviors)?.refresh?.();
    controllers.get(IDS.sceneAudio)?.refresh?.();
    controllers.get(IDS.sceneAnimation)?.refresh?.();
    controllers.get(IDS.media)?.refresh?.(); controllers.get(IDS.scene3d)?.refresh?.(); controllers.get(IDS.scene3dTransforms)?.refresh?.(); controllers.get(IDS.scene3dObjects)?.refresh?.(); controllers.get(IDS.scene3dEnvironment)?.refresh?.(); controllers.get(IDS.scene3dProperties)?.refresh?.(); controllers.get(IDS.scene3dTranslation)?.refresh?.(); controllers.get(IDS.scene3dAlignment)?.refresh?.(); controllers.get(IDS.scene3dDistribution)?.refresh?.(); controllers.get(IDS.scene3dCopy)?.refresh?.(); controllers.get(IDS.scene3dRemoval)?.refresh?.();
  }
  function snapshot() {
    return copy({ format: 'viento-studio-system', schemaVersion: 1, lifecycle: 'boot-only', hotReload: false,
      initializedModules: [...initialized], plan, hostCapabilities });
  }
  return Object.freeze({ refreshMedia, updateCapabilities, updateProject, snapshot });
}
