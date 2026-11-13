// Advisory defaults for exactly one fixed ordinary starter, never arbitrary
// export inference. Recognition grants neither execution nor write authority.
import { GODOT_ACTION_SCENE_RESTART_SCRIPT } from './godot-scene-restart-script.mjs';
import { captureScriptParameterContract } from './script-parameter-interface.mjs';

const LIMIT = 64 * 1024;
// Only advisory discovery accepts these reversible representations. Build
// preflight and action suggestions retain canonical-LF-only recognition.
const representations = new Set([GODOT_ACTION_SCENE_RESTART_SCRIPT, GODOT_ACTION_SCENE_RESTART_SCRIPT.replaceAll('\n', '\r\n')]
  .flatMap(content => [content, '\uFEFF' + content]).filter(content => new TextEncoder().encode(content).length <= LIMIT));
export function hasGodotSceneRestartParameterDeclaration(content) {
  return typeof content === 'string' && content.length <= LIMIT && representations.has(content);
}
export function discoverGodotSceneRestartParameterContract(content) {
  if (!hasGodotSceneRestartParameterDeclaration(content)) return null;
  return captureScriptParameterContract({ format: 'viento-script-parameters', schemaVersion: 1,
    backendId: 'org.viento.godot4', language: 'gdscript', status: 'ready', parameters: [
      { name: 'action_name', type: 'string', defaultValue: 'ui_accept', referenceKind: '' },
      { name: 'state_values_json', type: 'string', defaultValue: '{"score":0,"health":100}', referenceKind: '' },
    ] });
}
