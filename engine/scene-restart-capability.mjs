// Only an exact, bound official source declares this optional requirement.
// Custom source is never interpreted; trusted backends separately expose ports.
import { GODOT_ACTION_SCENE_RESTART_SCRIPT } from './godot-scene-restart-script.mjs';
export const SCENE_RESTART_CAPABILITY = 'project.scene-restart';
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const own = (value, key) => value && typeof value === 'object' ? Object.getOwnPropertyDescriptor(value, key)?.value : undefined;
function rows(value, maximum) {
  const length = own(value, 'length');
  if (!Array.isArray(value) || !Number.isInteger(length) || length < 0 || length > maximum) return [];
  return Array.from({ length }, (_, index) => own(value, String(index)));
}
export function sceneRestartCapabilities(behaviors) {
  if (own(behaviors, 'backendId') !== 'org.viento.godot4' || own(behaviors, 'language') !== 'gdscript') return [];
  const sources = new Map();
  for (const source of rows(own(behaviors, 'sources'), 8)) {
    const id = own(source, 'objectId');
    if (uuid(id)) sources.set(id, sources.has(id) ? null : own(source, 'content'));
  }
  return rows(own(behaviors, 'bindings'), 32).some(binding => {
    const id = own(own(binding, 'implementation'), 'sourceObjectId');
    return uuid(id) && sources.get(id) === GODOT_ACTION_SCENE_RESTART_SCRIPT;
  })
    ? [SCENE_RESTART_CAPABILITY] : [];
}
