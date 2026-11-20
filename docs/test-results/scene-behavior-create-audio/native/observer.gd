extends "res://project-runtime.gd"

# Test-only independent child: reads native players and shared state. It never
# calls a gameplay port, publishes an event, or starts/stops an audio player.
var audio_observer
class AudioObserver extends Node:
	var project_ref: WeakRef
	var started_msec := 0
	var success_msec := -1
	var sampled_msec := -50
	var done := false
	func _ready() -> void:
		started_msec = Time.get_ticks_msec()
	func _process(_delta: float) -> void:
		if done:
			return
		var project = project_ref.get_ref()
		if project == null:
			return
		var now := Time.get_ticks_msec()
		var sample: Dictionary = project.audio_observer_snapshot()
		if now - sampled_msec >= 50:
			sampled_msec = now
			print("FIRST_AUDIO_SAMPLE:" + JSON.stringify(sample, "", true, true))
		var tracks: Dictionary = sample.get("tracks", {})
		var selected: Dictionary = tracks.get("4cd0d63e-60a2-4ab3-8bb1-00e97e5f397d", {})
		var unselected: Dictionary = tracks.get("b52a066a-032e-4642-baf4-87330ad24fbb", {})
		if sample.get("state", {}).get("last_event") == "hello" and selected.get("playing") == true and unselected.get("playing") == false:
			if success_msec < 0:
				success_msec = now
			var hold_seconds: float = maxf(1.1, float(selected.get("lengthSeconds", 0.0)) + 0.25)
			if float(now - success_msec) / 1000.0 >= hold_seconds:
				done = true
				sample["observedPlayingSeconds"] = float(now - success_msec) / 1000.0
				print("FIRST_AUDIO_FINAL:" + JSON.stringify(sample, "", true, true))
				# Exercise the generated project's ordinary close handling only.
				get_tree().root.propagate_notification(NOTIFICATION_WM_CLOSE_REQUEST)
				return
		elif success_msec >= 0:
			done = true
			print("FIRST_AUDIO_OBSERVER_ERROR:Playback or state changed during observation.")
			get_tree().quit(1)
		if now - started_msec > 10000:
			done = true
			print("FIRST_AUDIO_OBSERVER_ERROR:No stable event-driven playback within ten seconds.")
			get_tree().quit(1)

func _ready() -> void:
	super._ready()
	audio_observer = AudioObserver.new()
	audio_observer.project_ref = weakref(self)
	add_child(audio_observer)

func audio_observer_snapshot() -> Dictionary:
	var tracks: Dictionary = {}
	var scene = current
	if is_instance_valid(scene):
		var players: Variant = scene.get("audio_players")
		if players is Dictionary:
			for id in players:
				var player = players[id]
				if not is_instance_valid(player) or not player is AudioStreamPlayer:
					continue
				var stream = player.stream
				tracks[id] = {"nativeClass": player.get_class(), "playing": player.playing,
					"gain": db_to_linear(player.volume_db), "streamPresent": stream != null,
					"streamClass": stream.get_class() if stream != null else "",
					"lengthSeconds": stream.get_length() if stream != null else 0.0,
					"loopMode": stream.loop_mode if stream is AudioStreamWAV else -1,
					"streamInstanceId": stream.get_instance_id() if stream != null else -1}
	return {"sceneId": current_scene, "visitIndex": visit_index, "state": shared_state.duplicate(true),
		"stateRevision": state_revision, "tracks": tracks, "failed": failed, "finished": finished,
		"nativeAudioDriver": AudioServer.get_driver_name(), "elapsedSeconds": elapsed_seconds}
