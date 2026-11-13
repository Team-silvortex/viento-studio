// Canonical official restart source alone declares same-scene restart semantics.
// Advisory parameter discovery may accept BOM/CRLF; preflight does not normalize
// author source. State initializer parsing remains shared with explicit retry.
import { GODOT_ACTION_SCENE_RESTART_SCRIPT } from './godot-scene-restart-script.mjs';
import { parseProjectSceneRetryStateValues, DEFAULT_PROJECT_SCENE_RETRY_STATE_VALUES } from './project-scene-retry-diagnostics.mjs';
import { parseJsonSource, locateJsonSource } from './json-source.mjs';

export const DEFAULT_PROJECT_SCENE_RESTART_STATE_VALUES = DEFAULT_PROJECT_SCENE_RETRY_STATE_VALUES;
const LIMIT = 256;
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const invalid = () => { throw Object.assign(new TypeError('Invalid bounded scene restart inspection input.'), { errorCode: 'build_scene_restart_invalid' }); };
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

export function inspectProjectSceneRestartReferences(inputScenes, inputDocuments) {
  const scenes = list(inputScenes, 32), documents = list(inputDocuments, 200000);
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
    const manifest = data(behaviors, 'manifest');
    const source = Object.fromEntries(['objectId', 'sourcePath', 'sourceRevision'].map(key => [key, data(manifest, key)]));
    for (const [index, binding] of list(data(behaviors, 'bindings', []), 32).entries()) {
      const code = sources.get(data(data(binding, 'implementation'), 'sourceObjectId'));
      if (code !== GODOT_ACTION_SCENE_RESTART_SCRIPT) continue;
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
        const propertyPath = `/bindings/${index}/parameters/${parameter}`;
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
      if (!actionValid(data(parameters, 'action_name', 'ui_accept'))) report('action_name', 'build_scene_restart_parameter_invalid', 'Choose a non-empty text input action for restart.', 'action');
      const text = data(parameters, 'state_values_json', DEFAULT_PROJECT_SCENE_RETRY_STATE_VALUES);
      try { parseProjectSceneRetryStateValues(text); }
      catch (error) {
        if (error?.errorCode !== 'build_scene_retry_values_invalid') throw error;
        report('state_values_json', 'build_scene_restart_values_invalid', error.message, error.reason);
      }
    }
  }
  if (count > LIMIT) diagnostics[LIMIT - 1] = { ...diagnostics[LIMIT - 1], code: 'build_scene_restart_limit',
    message: 'Further scene restart errors were omitted. Check the reported behavior bindings.', omittedCount: count - (LIMIT - 1) };
  return freeze(diagnostics);
}
