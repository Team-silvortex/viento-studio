import { createStudioModuleRegistry } from '../../engine/studio-modules.mjs';
import { setupSettings } from '../i18n/settings.js';
import { setupMediaEditor } from './app-media-editor.js';
import { setupExport } from './app-export.js';
import { setupProjectSettings } from './app-project-settings.js';
import { setupWorldBrowser } from './app-world-browser.js';
import { setupProjectBuild } from './app-project-build.js';
import { setupScene3DPreview } from './app-scene3d-preview.js';

const IDS = Object.freeze({ document: 'org.viento.document', settings: 'org.viento.settings', world: 'org.viento.world',
  project: 'org.viento.project', export: 'org.viento.export', media: 'org.viento.media', build: 'org.viento.build', scene3d: 'org.viento.scene3d' });
const copy = value => JSON.parse(JSON.stringify(value));

/**
 * Studio's browser composition root. Domain options are injected separately;
 * controllers and source authority are never handed to sibling modules.
 * Existing views mount once. A project profile requests additive capabilities;
 * capability refresh is not hot loading, disposal or permission to save.
 */
export async function setupStudioSystem({ settings, features = {}, ports = {} } = {}) {
  const registry = createStudioModuleRegistry();
  const enabledModules = { [IDS.project]: features.project !== false, [IDS.export]: features.export !== false, [IDS.media]: features.media !== false,
    [IDS.scene3d]: Boolean(ports.scene3d) && features.scene3d !== false };
  let profile = null, plan = registry.plan(profile, { enabledModules });
  let hostCapabilities = { semanticProjection: false, semanticCommands: [], projectBuild: false, scenePreview: false };
  const controllers = new Map(), initialized = [IDS.document];
  const active = id => plan.modules.some(module => module.id === id && module.active);
  const injectedPorts = Object.fromEntries(['world', 'build', 'project', 'export', 'media', 'scene3d']
    .map(name => [name, Object.freeze({ ...(ports[name] || {}) })]));
  const options = name => injectedPorts[name];
  function mount(id, setup, injected) {
    if (!active(id)) return null;
    const controller = setup(injected); controllers.set(id, controller); initialized.push(id); return controller;
  }
  // Language preferences must finish before any localized domain view mounts.
  if (active(IDS.settings)) { await setupSettings(settings ?? ports.settings ?? {}); initialized.push(IDS.settings); }
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

  function applyCapabilities() {
    controllers.get(IDS.world)?.setAvailable?.(active(IDS.world) && hostCapabilities.semanticProjection, [...hostCapabilities.semanticCommands]);
    controllers.get(IDS.build)?.setAvailable?.(active(IDS.build) && hostCapabilities.projectBuild, [...hostCapabilities.semanticCommands],
      { scenePreview: active(IDS.build) && hostCapabilities.scenePreview });
  }
  function updateCapabilities(payload) {
    hostCapabilities = { semanticProjection: payload?.semanticProjection === true,
      semanticCommands: Array.isArray(payload?.semanticCommands) ? payload.semanticCommands.filter(command => typeof command === 'string') : [],
      projectBuild: payload?.projectBuild === true, scenePreview: payload?.scenePreview === true };
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
  function refreshMedia() { controllers.get(IDS.media)?.refresh?.(); controllers.get(IDS.scene3d)?.refresh?.(); }
  function snapshot() {
    return copy({ format: 'viento-studio-system', schemaVersion: 1, lifecycle: 'boot-only', hotReload: false,
      initializedModules: [...initialized], plan, hostCapabilities });
  }
  return Object.freeze({ refreshMedia, updateCapabilities, updateProject, snapshot });
}
