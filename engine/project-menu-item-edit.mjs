// Source-preserving menu target proposals only. The caller owns saved directory
// identities, current form rows, review, ordinary Save and runtime admission.
import { parseProjectMenuItems, projectMenuTextValid, PROJECT_MENU_LIMITS } from './project-menu.mjs';
import { parseJsonSource, locateJsonSource } from './json-source.mjs';

export const PROJECT_MENU_ITEM_EDIT_LIMITS = Object.freeze({ parameterCharacters: 4096 });
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const ID = /^[a-z][a-z0-9_]{0,47}$/;
const full = (pattern, value) => typeof value === 'string' && pattern.exec(value)?.[0] === value;
const invalid = (reason, detail) => {
  throw Object.assign(new TypeError('Expected a valid menu and an explicit, available navigation target.'), {
    errorCode: 'project_menu_item_edit_invalid', reason, ...(detail ? { detail } : {}),
  });
};
function record(input, fields) {
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) invalid('fields');
  const descriptors = Object.getOwnPropertyDescriptors(input), keys = Reflect.ownKeys(descriptors);
  if (keys.length !== fields.length || keys.some(key => typeof key !== 'string' || !fields.includes(key))) invalid('fields');
  const output = {};
  for (const key of fields) {
    const descriptor = descriptors[key];
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) invalid('fields');
    Object.defineProperty(output, key, { value: descriptor.value, enumerable: true });
  }
  return output;
}
function context(input) {
  const { sceneIds, currentSceneId } = input;
  if (!full(UUID, currentSceneId) || !Array.isArray(sceneIds)
    || ![Array.prototype, null].includes(Object.getPrototypeOf(sceneIds))) invalid('context');
  const descriptors = Object.getOwnPropertyDescriptors(sceneIds), size = descriptors.length?.value;
  if (!Number.isSafeInteger(size) || size < 1 || size > 32 || Reflect.ownKeys(descriptors).length !== size + 1) invalid('context');
  const ids = [];
  for (let index = 0; index < size; index++) {
    const descriptor = descriptors[index];
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value') || !full(UUID, descriptor.value) || ids.includes(descriptor.value)) invalid('context');
    ids.push(descriptor.value);
  }
  if (!ids.includes(currentSceneId)) invalid('context');
  return { sceneIds: ids, currentSceneId, displayMode: 'scene' };
}
function parse(content, options) {
  if (typeof content !== 'string') invalid('input');
  try { return parseProjectMenuItems(content, options); }
  catch (error) {
    if (error?.errorCode !== 'build_project_menu_configuration_invalid') throw error;
    const failure = Object.assign(new TypeError('The complete menu must be valid before proposing a target edit.'), {
      errorCode: 'project_menu_item_edit_invalid', reason: 'menu', menuReason: error.reason,
    });
    throw failure;
  }
}
function target(value, options) {
  if (!full(UUID, value) || value === options.currentSceneId || !options.sceneIds.includes(value)) invalid('target');
  return value;
}
function result(content, options) {
  // The menu's byte budget is independent of its enclosing ordinary String
  // parameter. A convenience proposal must satisfy both existing contracts.
  if (content.length > PROJECT_MENU_ITEM_EDIT_LIMITS.parameterCharacters) invalid('limit', 'parameter_characters');
  parse(content, options);
  return content;
}
function location(content, pointer) {
  const parsed = parseJsonSource(content), range = locateJsonSource(parsed, pointer);
  if (!parsed.ok || !range?.exact || range.encoding !== 'utf-16') invalid('menu');
  return range;
}

/** Inspect scene/retry targets in one complete scene-mode menu. */
export function inspectProjectMenuTargets(itemsJson, input) {
  const options = context(record(input, ['sceneIds', 'currentSceneId'])), items = parse(itemsJson, options);
  const targets = items.flatMap((item, index) => ['scene', 'retry'].includes(item.command)
    ? [Object.freeze({ id: item.id, label: item.label, command: item.command, targetSceneId: item.targetSceneId, index })] : []);
  return Object.freeze({ items, targets: Object.freeze(targets), canAppend: items.length < PROJECT_MENU_LIMITS.items });
}

/** Replace only the selected existing target String token, retaining all other bytes. */
export function editProjectMenuItemTarget(itemsJson, input) {
  const value = record(input, ['itemId', 'targetSceneId', 'sceneIds', 'currentSceneId']), options = context(value);
  const nextTarget = target(value.targetSceneId, options), items = parse(itemsJson, options);
  if (!full(ID, value.itemId)) invalid('item');
  const index = items.findIndex(item => item.id === value.itemId), item = items[index];
  if (!item || !['scene', 'retry'].includes(item.command)) invalid('item');
  if (item.targetSceneId === nextTarget) return result(itemsJson, options);
  const range = location(itemsJson, `/${index}/targetSceneId`);
  return result(itemsJson.slice(0, range.start) + JSON.stringify(nextTarget) + itemsJson.slice(range.end), options);
}

/** Append one explicitly configured navigation item; never initialize gameplay state. */
export function appendProjectMenuNavigationItem(itemsJson, input) {
  const value = record(input, ['id', 'label', 'command', 'targetSceneId', 'sceneIds', 'currentSceneId']), options = context(value);
  const nextTarget = target(value.targetSceneId, options), items = parse(itemsJson, options);
  if (items.length >= PROJECT_MENU_LIMITS.items) invalid('limit', 'items');
  if (!full(ID, value.id) || items.some(item => item.id === value.id) || !projectMenuTextValid(value.label)
    || !['scene', 'retry'].includes(value.command)) invalid('item');
  // Every serialized field has already been captured as a primitive. Only the
  // new item is serialized; old keys, escapes, numbers and whitespace stay raw.
  const item = { id: value.id, label: value.label, command: value.command, targetSceneId: nextTarget,
    ...(value.command === 'retry' ? { values: {} } : {}) };
  const range = location(itemsJson, `/${items.length - 1}`), addition = ',' + JSON.stringify(item);
  return result(itemsJson.slice(0, range.end) + addition + itemsJson.slice(range.end), options);
}
