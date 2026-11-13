import { hasGodotProjectMenuParameterDeclaration, discoverGodotProjectMenuParameterContract } from './godot-project-menu-parameters.mjs';
// Recognition belongs to fixed source-format providers. Never infer exports
// from arbitrary GDScript/Rust, execute source, or promote a marker to authority.
import { hasAnimationStateScriptMarker, readAnimationStateScriptSource } from './animation-state-script-source.mjs';
import { hasGodotProjectPauseParameterDeclaration, discoverGodotProjectPauseParameterContract } from './godot-project-pause-parameters.mjs';
import { hasGodotSceneRestartParameterDeclaration, discoverGodotSceneRestartParameterContract } from './godot-scene-restart-parameters.mjs';
import { hasGodotSceneRetryParameterDeclaration, discoverGodotSceneRetryParameterContract } from './godot-scene-retry-parameters.mjs';
import { captureScriptParameterContract } from './script-parameter-interface.mjs';

// Candidate detection only schedules optional inspection; it grants no contract.
export const hasScriptParameterDeclaration = content => hasGodotProjectMenuParameterDeclaration(content) || hasGodotProjectPauseParameterDeclaration(content) || hasGodotSceneRestartParameterDeclaration(content) || hasGodotSceneRetryParameterDeclaration(content) || hasAnimationStateScriptMarker(content);
// The exact retry provider is pure. Only the existing animation provider needs
// the optional native/WASM core; hosts keep that loader independently lazy.
export const requiresScriptParameterCore = content => hasAnimationStateScriptMarker(content);
export function discoverScriptParameterContract(content) {
  const menu = discoverGodotProjectMenuParameterContract(content);
  if (menu) return menu;
  const pause = discoverGodotProjectPauseParameterContract(content);
  if (pause) return pause;
  const restart = discoverGodotSceneRestartParameterContract(content);
  if (restart) return restart;
  const retry = discoverGodotSceneRetryParameterContract(content);
  if (retry) return retry;
  if (!hasAnimationStateScriptMarker(content)) return null;
  let status = 'ready', parameters = [];
  try {
    const checked = readAnimationStateScriptSource(content);
    parameters = checked.parameters.map(row => ({ name: row.name, type: 'string', defaultValue: row.defaultValue, referenceKind: 'animation-clip' }));
  } catch (error) {
    const code = error?.errorCode || error?.code;
    if (code === 'animation_state_script_source_unsupported') status = 'unsupported';
    else if (['animation_state_script_source_modified', 'animation_state_script_source_invalid', 'animation_state_script_source_limit'].includes(code)) status = 'modified';
    else if (code === 'studio_core_unavailable') status = 'unavailable';
    else throw error;
  }
  return captureScriptParameterContract({ format: 'viento-script-parameters', schemaVersion: 1,
    backendId: 'org.viento.godot4', language: 'gdscript', status, parameters });
}
