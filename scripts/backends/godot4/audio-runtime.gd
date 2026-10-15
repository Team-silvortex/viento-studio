extends "res://runtime.gd"

# Audio time advances through the existing scene _process call. In particular,
# the smoke driver's two explicit .25 second calls must never be doubled.
var audio_players: Dictionary = {}
var audio_tracks: Dictionary = {}
var audio_cues: Array = []
var audio_cursor := 0
var audio_time := 0.0
var audio_started := false
var audio_failed := false
var audio_finished := false

func audio_emit(event: String, data: Dictionary = {}) -> void:
	data["protocol"] = 1
	data["event"] = event
	print("VIENTO_AUDIO:" + JSON.stringify(data, "", true, true))

func audio_fail(message: String, track: Dictionary = {}) -> void:
	audio_failed = true
	for player in audio_players.values():
		player.stop()
	audio_emit("diagnostic", {"severity": "error", "code": "runtime_audio_failed", "message": message,
		"trackId": track.get("id", ""), "resourceId": track.get("resourceId", "")})
	set_process(false)
	get_tree().quit(1)

func emit(event: String, data: Dictionary = {}) -> void:
	if event == "diagnostic":
		audio_failed = true
	if event == "finished":
		audio_shutdown()
	super.emit(event, data)

func _ready() -> void:
	super._ready()
	if audio_failed:
		return
	var declaration = JSON.parse_string(FileAccess.get_file_as_string("res://audio.json"))
	if not declaration is Dictionary or declaration.get("format") != "viento-godot-audio":
		audio_fail("Cannot read generated audio manifest.")
		return
	for track in declaration["tracks"]:
		var loaded := load("res://" + track["file"]) as AudioStreamWAV
		if loaded == null:
			audio_fail("Cannot load generated PCM WAV audio.", track)
			return
		# Tracks may share a resource but must retain their own loop settings.
		var stream := loaded.duplicate() as AudioStreamWAV
		stream.loop_mode = AudioStreamWAV.LOOP_FORWARD if track["loop"] else AudioStreamWAV.LOOP_DISABLED
		stream.loop_begin = 0
		stream.loop_end = int(round(stream.get_length() * stream.mix_rate))
		var player := AudioStreamPlayer.new()
		player.name = "audio_" + track["id"].replace("-", "_")
		player.stream = stream
		# linear_to_db(0) is -INF, so a zero author gain is truly silent.
		player.volume_db = linear_to_db(float(track["volume"]))
		add_child(player)
		audio_players[track["id"]] = player
		audio_tracks[track["id"]] = track
	audio_cues = declaration["cues"]
	# Decode exact author doubles instead of the JSON parser's rounded numbers.
	for cue in audio_cues:
		cue["atSeconds"] = PackedByteArray(cue["atSecondsBytes"]).decode_double(0)
	audio_started = true
	audio_emit("ready", {"sceneObjectId": declaration["sceneObjectId"], "trackIds": audio_tracks.keys()})
	audio_advance(0.0)

func audio_advance(delta: float) -> void:
	if not audio_started or audio_failed or audio_finished:
		return
	audio_time += delta
	while audio_cursor < audio_cues.size() and float(audio_cues[audio_cursor]["atSeconds"]) <= audio_time:
		var cue: Dictionary = audio_cues[audio_cursor]
		var track: Dictionary = audio_tracks[cue["trackId"]]
		var player: AudioStreamPlayer = audio_players[cue["trackId"]]
		if cue["action"] == "play":
			player.play(0.0)
		else:
			player.stop()
		audio_emit("command", {"cueId": cue["id"], "trackId": cue["trackId"], "resourceId": track["resourceId"],
			"action": cue["action"], "atSeconds": cue["atSeconds"]})
		audio_cursor += 1

func _process(delta: float) -> void:
	if audio_failed:
		return
	super._process(delta)
	audio_advance(delta)

func run_smoke() -> void:
	if not audio_failed:
		super.run_smoke()

func audio_shutdown() -> void:
	if not audio_started or audio_finished:
		return
	for player in audio_players.values():
		player.stop()
	audio_finished = true
	if not audio_failed:
		audio_emit("finished", {"timeSeconds": audio_time})

func _exit_tree() -> void:
	audio_shutdown()
