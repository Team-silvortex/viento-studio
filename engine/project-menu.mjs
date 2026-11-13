// Portable menu declarations contain bounded data and known commands only.
// Parsing grants neither a runtime port nor author-script execution authority.
import { parseJsonSource } from './json-source.mjs';
import { projectSharedStateKey, projectSharedStateScalar } from './project-shared-state.mjs';

export const PROJECT_MENU_DEFAULT_ITEMS = '[{"id":"finish","label":"Exit","command":"finish"}]';
export const PROJECT_MENU_LIMITS = Object.freeze({ items: 8, bytes: 8192, text: 160, valueKeys: 16, valueBytes: 4096 });
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.exec(value)?.[0] === value;
const invalid = (reason, parameter = 'items_json') => { throw Object.assign(new TypeError('Invalid bounded project menu configuration.'), { errorCode: 'build_project_menu_configuration_invalid', reason, parameter }); };
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
function data(value, key, fallback, parameter = 'items_json') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid('object', parameter);
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor) return fallback;
  if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) invalid('property', parameter);
  return descriptor.value;
}
export function projectMenuTextValid(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 320 && [...value].length <= PROJECT_MENU_LIMITS.text
    && !/[\u0000-\u001f\u007f-\u009f]/u.test(value)
    && !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value);
}
function context(options) {
  const displayMode = data(options, 'displayMode', 'scene', 'display_mode');
  if (!['scene', 'paused'].includes(displayMode)) invalid('display_mode', 'display_mode');
  const sceneIds = data(options, 'sceneIds'), currentSceneId = data(options, 'currentSceneId');
  if (currentSceneId !== undefined && !uuid(currentSceneId)) invalid('context');
  let members;
  if (sceneIds !== undefined) {
    if (!Array.isArray(sceneIds) || sceneIds.length > 32) invalid('context');
    const descriptors = Object.getOwnPropertyDescriptors(sceneIds);
    if (Reflect.ownKeys(descriptors).length !== sceneIds.length + 1) invalid('context');
    members = new Set();
    for (let index = 0; index < sceneIds.length; index++) {
      const entry = descriptors[index];
      if (!entry?.enumerable || !Object.hasOwn(entry, 'value') || !uuid(entry.value) || members.has(entry.value)) invalid('context');
      members.add(entry.value);
    }
  }
  return { displayMode, members, currentSceneId };
}
export function parseProjectMenuItems(items_json, options = {}) {
  const { displayMode, members, currentSceneId } = context(options);
  if (typeof items_json !== 'string' || items_json.length > PROJECT_MENU_LIMITS.bytes
    || new TextEncoder().encode(items_json).length > PROJECT_MENU_LIMITS.bytes || items_json.startsWith('\uFEFF')) invalid('items_json');
  const parsed = parseJsonSource(items_json);
  if (!parsed.ok) invalid(parsed.ambiguous ? 'duplicate' : 'items_json');
  const items = parsed.value;
  if (!Array.isArray(items) || items.length < 1 || items.length > PROJECT_MENU_LIMITS.items) invalid('items');
  const seen = new Set();
  for (const item of items) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) invalid('item');
    const id = data(item, 'id'), label = data(item, 'label'), command = data(item, 'command');
    if (typeof id !== 'string' || /^[a-z][a-z0-9_]{0,47}$/.exec(id)?.[0] !== id || seen.has(id)) invalid('id');
    seen.add(id);
    if (!projectMenuTextValid(label)) invalid('label');
    const allowed = displayMode === 'paused' ? ['resume', 'finish'] : ['scene', 'retry', 'restart', 'finish'];
    if (!allowed.includes(command)) invalid('command');
    const required = ['id', 'label', 'command', ...(['scene', 'retry'].includes(command) ? ['targetSceneId'] : [])];
    const permitted = [...required, ...(['retry', 'restart'].includes(command) ? ['values'] : [])];
    if (Object.keys(item).some(key => !permitted.includes(key)) || required.some(key => !Object.hasOwn(item, key))) invalid('fields');
    if (['scene', 'retry'].includes(command)) {
      const target = data(item, 'targetSceneId');
      if (!uuid(target) || target === currentSceneId || members && !members.has(target)) invalid('target');
    }
    if (['retry', 'restart'].includes(command)) {
      const values = data(item, 'values', {});
      if (!values || typeof values !== 'object' || Array.isArray(values)) invalid('values');
      const entries = Object.entries(values);
      if (entries.length > PROJECT_MENU_LIMITS.valueKeys) invalid('values');
      let payloadBytes = 0;
      for (const [key, value] of entries) {
        if (!projectSharedStateKey(key) || /[^A-Za-z0-9_.-]/.test(key)
          || typeof value === 'string' && /[\u0000-\u001f\u007f-\u009f]/u.test(value)) invalid('values');
        // Match the runtime state payload ledger, independent of number spelling
        // and JSON escaping. Parsed author data is kept exactly as captured.
        try { payloadBytes += key.length + projectSharedStateScalar(value).bytes; }
        catch { invalid('values'); }
      }
      if (payloadBytes > PROJECT_MENU_LIMITS.valueBytes) invalid('values');
    }
  }
  return freeze(items);
}
export function validateProjectMenuConfiguration(configuration, options = {}) {
  if (!configuration || typeof configuration !== 'object' || Array.isArray(configuration)
    || Reflect.ownKeys(configuration).length !== 3 || Reflect.ownKeys(configuration).some(key => !['title', 'items_json', 'display_mode'].includes(key))) invalid('fields');
  const title = data(configuration, 'title', undefined, 'title'), displayMode = data(configuration, 'display_mode', undefined, 'display_mode');
  if (!projectMenuTextValid(title)) invalid('title', 'title');
  if (!['scene', 'paused'].includes(displayMode)) invalid('display_mode', 'display_mode');
  const items_json = data(configuration, 'items_json');
  const items = parseProjectMenuItems(items_json, { displayMode, sceneIds: data(options, 'sceneIds'), currentSceneId: data(options, 'currentSceneId') });
  return freeze({ title, displayMode, items });
}
