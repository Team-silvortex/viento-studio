// Exact fixed ordinary source declarations only. Advisory representation
// recognition is never execution, registration or pause-controller authority.
import { GODOT_ACTION_PROJECT_PAUSE_SCRIPT } from './godot-project-pause-script.mjs';
import { captureScriptParameterContract } from './script-parameter-interface.mjs';
const LIMIT = 64 * 1024;
const representations = new Set([GODOT_ACTION_PROJECT_PAUSE_SCRIPT, GODOT_ACTION_PROJECT_PAUSE_SCRIPT.replaceAll('\n', '\r\n')]
  .flatMap(content => [content, '\uFEFF' + content]).filter(content => new TextEncoder().encode(content).length <= LIMIT));
export function hasGodotProjectPauseParameterDeclaration(content) {
  return typeof content === 'string' && content.length <= LIMIT && representations.has(content);
}
export function discoverGodotProjectPauseParameterContract(content) {
  if (!hasGodotProjectPauseParameterDeclaration(content)) return null;
  return captureScriptParameterContract({ format: 'viento-script-parameters', schemaVersion: 1,
    backendId: 'org.viento.godot4', language: 'gdscript', status: 'ready', parameters: [
      { name: 'action_name', type: 'string', defaultValue: 'pause', referenceKind: '' },
      { name: 'paused_text', type: 'string', defaultValue: 'Paused', referenceKind: '' },
      { name: 'resume_text', type: 'string', defaultValue: 'Release controls to resume', referenceKind: '' },
    ] });
}
