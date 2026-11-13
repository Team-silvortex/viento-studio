// Only the two exact official starters have declarative navigation semantics.
// This author-plan check owns no runtime, event publication or source mutation.
import { GODOT_ACTION_SCENE_SWITCH_SCRIPT, GODOT_EVENT_SCENE_SWITCH_SCRIPT } from './godot-scene-navigation-scripts.mjs';
import { projectSharedStateKey, projectSharedStateScalar } from './project-shared-state.mjs';
import { parseJsonSource, locateJsonSource } from './json-source.mjs';
const LIMIT = 256;
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const invalid = () => { throw Object.assign(new TypeError('Invalid bounded scene navigation inspection input.'), { errorCode: 'build_scene_navigation_invalid' }); };
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
function actionValid(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 4096
    && !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value);
}
function filterValid(value) {
  if (typeof value !== 'string' || value.length > 4096) return false;
  try { projectSharedStateScalar(value); return true; } catch { return false; }
}
export function inspectProjectSceneNavigationReferences(inputScenes, inputDocuments) {
  const scenes = list(inputScenes, 32), documents = list(inputDocuments, 200000), members = new Set(scenes.map(scene => data(data(scene, 'scene'), 'objectId')));
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
    const manifest = data(behaviors, 'manifest'), source = Object.fromEntries(['objectId', 'sourcePath', 'sourceRevision'].map(key => [key, data(manifest, key)]));
    const bindings = list(data(behaviors, 'bindings', []), 32);
    for (const [index, binding] of bindings.entries()) {
      const code = sources.get(data(data(binding, 'implementation'), 'sourceObjectId'));
      const action = code === GODOT_ACTION_SCENE_SWITCH_SCRIPT, event = code === GODOT_EVENT_SCENE_SWITCH_SCRIPT;
      if (!action && !event) continue;
      const parameters = data(binding, 'parameters', {}), sceneId = data(data(scene, 'scene'), 'objectId');
      const report = (parameter, code, message, reason) => {
        count++;
        if (diagnostics.length >= LIMIT) return;
        const propertyPath = `/bindings/${index}/parameters/${parameter}`;
        const row = { severity: 'error', code, message, ...source, propertyPath, sceneId,
          bindingId: data(binding, 'bindingId'), instanceId: data(binding, 'instanceId'), parameter, reason };
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
      const target = data(parameters, 'target_scene_id', '');
      if (target === '') report('target_scene_id', 'build_scene_navigation_target_invalid', 'Choose another scene in this project assembly.', 'required');
      else if (!uuid(target)) report('target_scene_id', 'build_scene_navigation_target_invalid', 'The target scene requires a lowercase UUID.', 'uuid');
      else if (target === sceneId) report('target_scene_id', 'build_scene_navigation_target_invalid', 'Choose a different scene; this starter does not restart the current scene.', 'current');
      else if (!members.has(target)) report('target_scene_id', 'build_scene_navigation_target_invalid', 'The target scene is not a member of this project assembly.', 'member');
      if (action && !actionValid(data(parameters, 'action_name', 'ui_accept'))) report('action_name', 'build_scene_navigation_parameter_invalid', 'Choose a non-empty text input action.', 'action');
      if (event && !projectSharedStateKey(data(parameters, 'event_name', 'game.complete'))) report('event_name', 'build_scene_navigation_parameter_invalid', 'Choose a valid project event name.', 'event');
      if (event && !filterValid(data(parameters, 'payload_filter', ''))) report('payload_filter', 'build_scene_navigation_parameter_invalid', 'Use an optional Unicode text payload filter of at most 4096 UTF-8 bytes.', 'filter');
    }
  }
  if (count > LIMIT) diagnostics[LIMIT - 1] = { ...diagnostics[LIMIT - 1], code: 'build_scene_navigation_limit',
    message: 'Further scene navigation errors were omitted. Check the reported behavior bindings.', omittedCount: count - (LIMIT - 1) };
  return freeze(diagnostics);
}
