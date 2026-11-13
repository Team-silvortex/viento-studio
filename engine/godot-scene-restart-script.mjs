// Restart is a separate ordinary author starter. Keep the historical retry
// source and its different-member contract byte-for-byte unchanged.
import { GODOT_ACTION_SCENE_RETRY_SCRIPT } from './godot-scene-retry-script.mjs';
const replaceOnce = (source, before, after) => {
  if (source.split(before).length !== 2) throw new Error('The retry author source changed; review the restart author source.');
  return source.replace(before, after);
};
let source = GODOT_ACTION_SCENE_RETRY_SCRIPT.replaceAll('viento_project_retry', 'viento_project_restart').replaceAll('request_retry', 'request_restart');
source = replaceOnce(source, '@export var target_scene_id: String = ""\n', '');
source = replaceOnce(source, `func _uuid(value: String) -> bool:
\tvar pattern := RegEx.new()
\tpattern.compile("^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$")
\treturn value.length() == 36 and pattern.search(value) != null

`, '');
source = replaceOnce(source, 'if action_name.is_empty() or not _uuid(target_scene_id):\n\t\t_fail("Choose an existing input action and a target member scene UUID.")',
  'if action_name.is_empty():\n\t\t_fail("Choose an existing input action.")');
source = replaceOnce(source, '_project.request_restart(target_scene_id, _initial_values)', '_project.request_restart(_initial_values)');
source = replaceOnce(source, 'Level retry: ', 'Level restart: ');
export const GODOT_ACTION_SCENE_RESTART_SCRIPT = source;
