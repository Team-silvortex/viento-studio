// A portable state table is compiled to ordinary, editable Godot behavior text.
// This adapter uses the existing scene-wide animation port; it owns no renderer
// or runtime protocol. Request acceptance is not an execution acknowledgement.
import { inspectAnimationStateTable } from './animation-state-table-core.mjs';
const freeze = value => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};
export const DEFAULT_ANIMATION_STATE_TABLE = freeze({
  initialState: 'idle', states: [{ key: 'idle' }, { key: 'action' }],
  transitions: [
    { from: 'idle', to: 'action', trigger: { kind: 'event', name: 'action' } },
    { from: 'action', to: 'idle', trigger: { kind: 'completed' } },
  ],
});
// Trusted static IR keeps importing the starter independent of WASM readiness.
const DEFAULT_IR = {
  table: DEFAULT_ANIMATION_STATE_TABLE, states: [{ key: 'idle', index: 0 }, { key: 'action', index: 1 }], initialIndex: 0,
  transitions: [
    { fromIndex: 0, toIndex: 1, trigger: { kind: 'event', name: 'action' } },
    { fromIndex: 1, toIndex: 0, trigger: { kind: 'completed' } },
  ], eventNames: ['action'],
};
function emit(inspected) {
  const parameters = inspected.states.map(({ key }) => ({ stateKey: key, name: `clip_${key}`, defaultValue: '' }));
  const content = `extends Node

# One controller owns the current scene's animation playhead.
# Empty clip parameters select the whole animation. Clip membership is checked
# by the project port, not by this table. Explicit self-edges restart playback.
${parameters.map(row => `@export var ${row.name}: String = ""`).join('\n')}
const _INITIAL_STATE: int = ${inspected.initialIndex}
const _EVENT_NAMES: Array = ${JSON.stringify(inspected.eventNames)}
const _TRANSITIONS: Array = ${JSON.stringify(inspected.transitions)}
var _project
var _event_subscriptions: Array = []
var _completion_subscription: int = 0
var _clips: Array = []
var _state: int = -1
var _selected_clip = null
var _active: bool = false

func _port_valid(project) -> bool:
\treturn typeof(project) == TYPE_OBJECT and is_instance_valid(project)

func _ready() -> void:
\tif not has_meta("viento_project"):
\t\treturn
\tvar project = get_meta("viento_project")
\tif not _port_valid(project):
\t\treturn
\tfor method in ["subscribe_event", "unsubscribe_event", "subscribe_animation_completed", "unsubscribe_animation_completed", "select_animation_clip", "play_animation"]:
\t\tif not project.has_method(method):
\t\t\treturn
\tvar clip_pattern := RegEx.new()
\tclip_pattern.compile("^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$")
\tfor value in [${parameters.map(row => row.name).join(', ')}]:
\t\tvar matched = clip_pattern.search(value)
\t\tif not value.is_empty() and (matched == null or matched.get_string() != value):
\t\t\t_clips.clear()
\t\t\tpush_error("Animation state clip parameters require a lowercase UUID or empty text.")
\t\t\treturn
\t\t_clips.append(null if value.is_empty() else value)
\t_project = project
\tfor event_name in _EVENT_NAMES:
\t\tvar token = _project.subscribe_event(event_name, _on_event.bind(event_name))
\t\tif typeof(token) != TYPE_INT or token <= 0:
\t\t\t_deactivate()
\t\t\treturn
\t\t_event_subscriptions.append(token)
\tvar completion_token = _project.subscribe_animation_completed(_on_completed)
\tif typeof(completion_token) != TYPE_INT or completion_token <= 0:
\t\t_deactivate()
\t\treturn
\t_completion_subscription = completion_token
\t_active = true
\t_enter_state(_INITIAL_STATE)

func _enter_state(next_state: int) -> bool:
\tif not _active or not _port_valid(_project):
\t\t_deactivate()
\t\treturn false
\tvar selection = _clips[next_state]
\tif not _project.select_animation_clip(selection):
\t\t_deactivate()
\t\treturn false
\tif not _project.play_animation():
\t\t# Fail-stop only: a previously accepted select is not rolled back.
\t\t_deactivate()
\t\treturn false
\t_state = next_state
\t_selected_clip = selection
\treturn true

func _on_event(_value, event_name: String) -> bool:
\tif not _active or not _port_valid(_project):
\t\t_deactivate()
\t\treturn false
\tfor edge in _TRANSITIONS:
\t\tif edge["fromIndex"] == _state and edge["trigger"]["kind"] == "event" and edge["trigger"]["name"] == event_name:
\t\t\treturn _enter_state(edge["toIndex"])
\treturn true

func _on_completed(clip_id) -> bool:
\tif not _active or not _port_valid(_project):
\t\t_deactivate()
\t\treturn false
\tif clip_id != _selected_clip:
\t\treturn true
\tfor edge in _TRANSITIONS:
\t\tif edge["fromIndex"] == _state and edge["trigger"]["kind"] == "completed":
\t\t\treturn _enter_state(edge["toIndex"])
\treturn true

func _deactivate() -> void:
\tvar project = _project
\tvar events = _event_subscriptions
\tvar completion = _completion_subscription
\t_project = null
\t_event_subscriptions = []
\t_completion_subscription = 0
\t_active = false
\t_state = -1
\t_selected_clip = null
\t_clips.clear()
\tif not _port_valid(project):
\t\treturn
\tif project.has_method("unsubscribe_event"):
\t\tfor token in events:
\t\t\tproject.unsubscribe_event(token)
\tif completion != 0 and project.has_method("unsubscribe_animation_completed"):
\t\tproject.unsubscribe_animation_completed(completion)

func _exit_tree() -> void:
\t_deactivate()
`;
  return freeze({ content, parameters });
}
export function generateGodotAnimationStateScript(table) {
  return emit(inspectAnimationStateTable(table));
}
export const DEFAULT_GODOT_ANIMATION_STATE_SCRIPT = emit(DEFAULT_IR).content;
