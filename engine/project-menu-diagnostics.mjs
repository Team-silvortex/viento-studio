// Only an exact bound official menu source declares portable menu semantics.
// Source provenance remains author-owned and is never normalized or executed.
import { GODOT_ACTION_PROJECT_PAUSE_SCRIPT } from './godot-project-pause-script.mjs';
import { GODOT_PROJECT_MENU_SCRIPT } from './godot-project-menu-script.mjs';
import { validateProjectMenuConfiguration, PROJECT_MENU_DEFAULT_ITEMS } from './project-menu.mjs';
import { parseJsonSource, locateJsonSource } from './json-source.mjs';

const LIMIT = 256;
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const invalid = () => { throw Object.assign(new TypeError('Invalid bounded project menu inspection input.'), { errorCode: 'build_project_menu_invalid' }); };
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };

function data(value, key, fallback) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fallback;
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor) return fallback;
  if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) invalid();
  return descriptor.value;
}
function list(value, maximum) {
  if (!Array.isArray(value)) invalid();
  const entries = Object.getOwnPropertyDescriptors(value), length = entries.length?.value;
  if (!Number.isSafeInteger(length) || length < 0 || length > maximum || Reflect.ownKeys(entries).length !== length + 1) invalid();
  return Array.from({ length }, (_, index) => {
    const entry = entries[index]; if (!entry?.enumerable || !Object.hasOwn(entry, 'value')) invalid(); return entry.value;
  });
}
export function inspectProjectMenuReferences(inputScenes, inputDocuments) {
  const scenes = list(inputScenes, 32), documents = list(inputDocuments, 200000);
  const members = scenes.map(scene => data(data(scene, 'scene'), 'objectId'));
  const byId = new Map(), parsed = new Map(), diagnostics = []; let count = 0;
  for (const document of documents) {
    const id = data(data(document, 'record'), 'id');
    if (!id) continue;
    byId.set(id, byId.has(id) ? null : document);
  }
  for (const scene of scenes) {
    const behaviors = data(scene, 'behaviors');
    if (data(behaviors, 'backendId') !== 'org.viento.godot4' || data(behaviors, 'language') !== 'gdscript') continue;
    const sources = new Map();
    for (const source of list(data(behaviors, 'sources', []), 8)) {
      const id = data(source, 'objectId'), content = data(source, 'content');
      sources.set(id, sources.has(id) ? null : content);
    }
    const configuredModes = new Set();
    const sceneBindings = list(data(behaviors, 'bindings', []), 32);
    const hasPause = sceneBindings.some(binding => sources.get(data(data(binding, 'implementation'), 'sourceObjectId')) === GODOT_ACTION_PROJECT_PAUSE_SCRIPT);
    const manifest = data(behaviors, 'manifest');
    const source = Object.fromEntries(['objectId', 'sourcePath', 'sourceRevision'].map(key => [key, data(manifest, key)]));
    for (const [index, binding] of sceneBindings.entries()) {
      const code = sources.get(data(data(binding, 'implementation'), 'sourceObjectId'));
      if (code !== GODOT_PROJECT_MENU_SCRIPT) continue;
      const parameters = data(binding, 'parameters', {}), sceneId = data(data(scene, 'scene'), 'objectId');
      const bindingId = data(binding, 'bindingId'), instanceId = data(binding, 'instanceId');
      // Output provenance is primitive captured data; recursive freezing must
      // never visit an arbitrary object supplied in an identity field.
      if (!uuid(sceneId) || !uuid(bindingId) || !uuid(instanceId) || !uuid(source.objectId)
        || typeof source.sourcePath !== 'string' || !source.sourcePath.length || source.sourcePath.length > 4096
        || typeof source.sourceRevision !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(source.sourceRevision)) invalid();
      const report = (parameter, code, message, reason) => {
        count++;
        if (diagnostics.length >= LIMIT) return;
        const propertyPath = parameter ? `/bindings/${index}/parameters/${parameter}` : `/bindings/${index}`;
        const row = { severity: 'error', code, message, ...source, propertyPath, sceneId,
          bindingId, instanceId, parameter, reason };
        const document = byId.get(source.objectId), record = data(document, 'record');
        if (document && data(document, 'sourcePath') === source.sourcePath && data(document, 'sourceRevision') === source.sourceRevision
          && data(record, 'sourcePath', source.sourcePath) === source.sourcePath) {
          const content = data(document, 'content');
          if (typeof content === 'string' && content.length <= 32768) {
            if (!parsed.has(document)) parsed.set(document, parseJsonSource(content));
            const range = locateJsonSource(parsed.get(document), propertyPath, { nearest: true });
            if (range) row.sourceRange = range;
          }
        }
        diagnostics.push(row);
      };
      const displayMode = data(parameters, 'display_mode', 'scene');
      const configuration = { title: data(parameters, 'title', 'Menu'),
        items_json: data(parameters, 'items_json', PROJECT_MENU_DEFAULT_ITEMS), display_mode: displayMode };
      if (['scene', 'paused'].includes(displayMode)) {
        if (configuredModes.has(displayMode)) report('', 'build_project_menu_duplicate', 'Use one official menu controller per display mode in each scene visit.', 'duplicate');
        configuredModes.add(displayMode);
        if (displayMode === 'paused' && !hasPause) report('display_mode', 'build_project_menu_pause_required', 'A paused menu requires one official pause controller in the same scene.', 'pause');
      }
      try { validateProjectMenuConfiguration(configuration, { sceneIds: members, currentSceneId: sceneId }); }
      catch (error) {
        if (error?.errorCode !== 'build_project_menu_configuration_invalid') throw error;
        report(error.parameter, error.errorCode, error.message, error.reason);
      }
    }
  }
  if (count > LIMIT) diagnostics[LIMIT - 1] = { ...diagnostics[LIMIT - 1], code: 'build_project_menu_limit',
    message: 'Further project menu errors were omitted. Check the reported behavior bindings.', omittedCount: count - (LIMIT - 1) };
  return freeze(diagnostics);
}
