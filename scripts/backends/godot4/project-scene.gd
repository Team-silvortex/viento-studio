extends "__BASE_RUNTIME__"

const PROJECT_AUDIO_TRACKS = __AUDIO_TRACKS__

var project_host
var project_visit := 0
var project_open := true

func _ready() -> void:
	super._ready()
	# The project owns both deterministic smoke steps and live actor/audio time.
	# Author behavior children retain their normal single Godot process callback.
	smoke = true
	set_process(false)

func run_smoke() -> void:
	pass

func project_behavior_port(binding: Dictionary, instance: Node) -> RefCounted:
	return project_host.make_port(project_visit, binding, instance)

func emit(event: String, data: Dictionary = {}) -> void:
	if not project_open or event == "finished":
		return
	if event == "diagnostic":
		__DIAGNOSTIC_FLAGS__
	data["protocol"] = __CHILD_PROTOCOL__
	data["event"] = event
	project_host.scene_event(project_visit, "runtime", data)

func audio_emit(event: String, data: Dictionary = {}) -> void:
	if not project_open:
		return
	data["protocol"] = 1
	data["event"] = event
	project_host.scene_event(project_visit, "audio", data)

func project_step(delta: float) -> void:
	if project_open:
		super._process(delta)

func project_close(silent: bool = false) -> void:
	process_mode = Node.PROCESS_MODE_DISABLED
	__BEHAVIOR_FINISH__
	if silent:
		project_open = false
	__AUDIO_SHUTDOWN__
	project_open = false

# Generated private bridge: author ports receive only a boolean acceptance.
func project_audio_resource(track_id: String) -> String:
	return PROJECT_AUDIO_TRACKS.get(track_id, "")

func project_audio_execute(track_id: String, action: String) -> bool:
	__AUDIO_CONTROL__

func project_audio_time() -> float:
	__AUDIO_TIME__
