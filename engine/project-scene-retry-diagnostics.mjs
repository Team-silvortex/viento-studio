// Only the exact official retry source has declarative retry semantics. This
// bounded author-plan check owns no runtime port, state or source mutation.
import { GODOT_ACTION_SCENE_RETRY_SCRIPT } from './godot-scene-retry-script.mjs';
import { projectSharedStateKey, projectSharedStateScalar } from './project-shared-state.mjs';
import { parseJsonSource, locateJsonSource } from './json-source.mjs';

export const PROJECT_SCENE_RETRY_LIMITS = Object.freeze({ keys: 16, bytes: 4096 });
export const DEFAULT_PROJECT_SCENE_RETRY_STATE_VALUES = '{"score":0,"health":100}';
const LIMIT = 256;
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const invalid = () => { throw Object.assign(new TypeError('Invalid bounded scene retry inspection input.'), { errorCode: 'build_scene_retry_invalid' }); };
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
const valuesInvalid = reason => { throw Object.assign(new TypeError('Expected at most 16 bounded shared-state scalar initializers in a JSON object of at most 4096 UTF-8 bytes.'), { errorCode: 'build_scene_retry_values_invalid', reason }); };

// JSON text is an ordinary scalar behavior parameter. Duplicate decoded keys,
// BOM, nested values and null are rejected before any initializer is admitted.
export function parseProjectSceneRetryStateValues(text) {
  if (typeof text !== 'string') valuesInvalid('type');
  if (text.length > PROJECT_SCENE_RETRY_LIMITS.bytes) valuesInvalid('text');
  try { projectSharedStateScalar(text); } catch { valuesInvalid('text'); }
  if (text.startsWith('\uFEFF')) valuesInvalid('json');
  const parsed = parseJsonSource(text);
  if (!parsed.ok) valuesInvalid('json');
  const value = parsed.value;
  if (!value || typeof value !== 'object' || Array.isArray(value)) valuesInvalid('object');
  const entries = Object.entries(value);
  if (entries.length > PROJECT_SCENE_RETRY_LIMITS.keys) valuesInvalid('keys');
  const checked = [];
  for (const [key, initial] of entries) {
    if (!projectSharedStateKey(key)) valuesInvalid('key');
    let scalar;
    try { scalar = projectSharedStateScalar(initial).value; } catch { valuesInvalid('value'); }
    checked.push([key, scalar]);
  }
  checked.sort(([first], [second]) => first < second ? -1 : first > second ? 1 : 0);
  return freeze(Object.fromEntries(checked));
}

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

export function inspectProjectSceneRetryReferences(inputScenes, inputDocuments) {
  const scenes = list(inputScenes, 32), documents = list(inputDocuments, 200000);
  const members = new Set(scenes.map(scene => data(data(scene, 'scene'), 'objectId')));
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
      if (code !== GODOT_ACTION_SCENE_RETRY_SCRIPT) continue;
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
      const target = data(parameters, 'target_scene_id', '');
      if (target === '') report('target_scene_id', 'build_scene_retry_target_invalid', 'Choose another scene in this project assembly for retry.', 'required');
      else if (!uuid(target)) report('target_scene_id', 'build_scene_retry_target_invalid', 'The retry target requires a lowercase UUID.', 'uuid');
      else if (target === sceneId) report('target_scene_id', 'build_scene_retry_target_invalid', 'Choose a different scene; this retry starter does not reload the current scene.', 'current');
      else if (!members.has(target)) report('target_scene_id', 'build_scene_retry_target_invalid', 'The retry target is not a member of this project assembly.', 'member');
      if (!actionValid(data(parameters, 'action_name', 'ui_accept'))) report('action_name', 'build_scene_retry_parameter_invalid', 'Choose a non-empty text input action for retry.', 'action');
      const text = data(parameters, 'state_values_json', DEFAULT_PROJECT_SCENE_RETRY_STATE_VALUES);
      try { parseProjectSceneRetryStateValues(text); }
      catch (error) {
        if (error?.errorCode !== 'build_scene_retry_values_invalid') throw error;
        report('state_values_json', error.errorCode, error.message, error.reason);
      }
    }
  }
  if (count > LIMIT) diagnostics[LIMIT - 1] = { ...diagnostics[LIMIT - 1], code: 'build_scene_retry_limit',
    message: 'Further scene retry errors were omitted. Check the reported behavior bindings.', omittedCount: count - (LIMIT - 1) };
  return freeze(diagnostics);
}
