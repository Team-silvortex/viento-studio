// Advisory defaults for one exact ordinary starter. No marker, export parsing,
// runtime execution or source mutation is needed to recognize its fixed body.
import { GODOT_ACTION_SCENE_RETRY_SCRIPT } from './godot-scene-retry-script.mjs';
import { captureScriptParameterContract } from './script-parameter-interface.mjs';

const LIMIT = 64 * 1024;
// Compare only the reversible representations accepted by the existing source
// reader: one optional leading BOM and either uniform LF or uniform CRLF.
// Author input is never normalized, copied, coerced or interpreted as code.
const representations = new Set([GODOT_ACTION_SCENE_RETRY_SCRIPT, GODOT_ACTION_SCENE_RETRY_SCRIPT.replaceAll('\n', '\r\n')]
  .flatMap(content => [content, '\uFEFF' + content]).filter(content => new TextEncoder().encode(content).length <= LIMIT));

export function hasGodotSceneRetryParameterDeclaration(content) {
  return typeof content === 'string' && content.length <= LIMIT && representations.has(content);
}
export function discoverGodotSceneRetryParameterContract(content) {
  if (!hasGodotSceneRetryParameterDeclaration(content)) return null;
  return captureScriptParameterContract({ format: 'viento-script-parameters', schemaVersion: 1,
    backendId: 'org.viento.godot4', language: 'gdscript', status: 'ready', parameters: [
      { name: 'action_name', type: 'string', defaultValue: 'ui_accept', referenceKind: '' },
      { name: 'target_scene_id', type: 'string', defaultValue: '', referenceKind: '' },
      { name: 'state_values_json', type: 'string', defaultValue: '{"score":0,"health":100}', referenceKind: '' },
    ] });
}
