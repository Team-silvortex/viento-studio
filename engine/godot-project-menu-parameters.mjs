// Only exact official source representations receive advisory defaults.
// Discovery neither executes source nor grants menu or gameplay authority.
import { GODOT_PROJECT_MENU_SCRIPT } from './godot-project-menu-script.mjs';
import { PROJECT_MENU_DEFAULT_ITEMS } from './project-menu.mjs';
import { captureScriptParameterContract } from './script-parameter-interface.mjs';
const LIMIT = 64 * 1024;
const representations = new Set([GODOT_PROJECT_MENU_SCRIPT, GODOT_PROJECT_MENU_SCRIPT.replaceAll('\n', '\r\n')]
  .flatMap(content => [content, '\uFEFF' + content]).filter(content => new TextEncoder().encode(content).length <= LIMIT));
export function hasGodotProjectMenuParameterDeclaration(content) {
  return typeof content === 'string' && content.length <= LIMIT && representations.has(content);
}
export function discoverGodotProjectMenuParameterContract(content) {
  if (!hasGodotProjectMenuParameterDeclaration(content)) return null;
  return captureScriptParameterContract({ format: 'viento-script-parameters', schemaVersion: 1,
    backendId: 'org.viento.godot4', language: 'gdscript', status: 'ready', parameters: [
      { name: 'title', type: 'string', defaultValue: 'Menu', referenceKind: '' },
      { name: 'items_json', type: 'string', defaultValue: PROJECT_MENU_DEFAULT_ITEMS, referenceKind: '' },
      { name: 'display_mode', type: 'string', defaultValue: 'scene', referenceKind: '' },
    ] });
}
