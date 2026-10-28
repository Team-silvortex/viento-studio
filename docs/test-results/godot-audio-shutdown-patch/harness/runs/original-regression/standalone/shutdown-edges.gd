extends SceneTree

func _initialize() -> void:
	call_deferred("probe")

func probe() -> void:
	var mode = OS.get_cmdline_user_args()[0]
	var owner = Node.new()
	root.add_child(owner)
	var player = AudioStreamPlayer.new()
	var stream = AudioStreamWAV.new()
	stream.format = AudioStreamWAV.FORMAT_16_BITS
	stream.mix_rate = 22050
	stream.loop_mode = AudioStreamWAV.LOOP_FORWARD
	stream.loop_end = 22050
	var bytes = PackedByteArray()
	bytes.resize(44100)
	stream.data = bytes
	player.stream = stream
	var stream_ref = weakref(stream)
	stream = null
	owner.add_child(player)
	player.play()
	var playback_ref = weakref(player.get_stream_playback())
	var extra_refs: Array = []
	var extra_stream_refs: Array = []
	var player_count := 1
	var paused_count := 0
	if mode == "immediate-paused-quit":
		player.stream_paused = true
		paused_count = 1 if player.stream_paused else 0
	elif mode == "immediate-multiple-quit":
		for index in range(7):
			var additional_player := AudioStreamPlayer.new()
			additional_player.stream = player.stream.duplicate()
			extra_stream_refs.append(weakref(additional_player.stream))
			owner.add_child(additional_player)
			additional_player.play()
			extra_refs.append(weakref(additional_player.get_stream_playback()))
			player_count += 1
	if mode.begins_with("failed-"):
		await create_timer(0.025).timeout
	if mode == "immediate-replay-stop-free":
		player.stop()
		player.play()
		extra_refs.append(weakref(player.get_stream_playback()))
	if mode in ["immediate-stop-free", "immediate-replay-stop-free", "failed-stop-free"]:
		player.stop()
		root.remove_child(owner)
		owner.free()
	var code := 23 if mode.begins_with("failed-") else 0
	print("AUDIO_SHUTDOWN_EDGE:" + JSON.stringify({"mode": mode, "exitCode": code,
		"streamAliveBeforeQuit": stream_ref.get_ref() != null,
		"playbackAliveBeforeQuit": playback_ref.get_ref() != null,
		"extraPlaybacks": extra_refs.size(), "extraStreams": extra_stream_refs.size(),
		"playerCount": player_count, "pausedCount": paused_count}))
	# These paths intentionally have no cleanup wait. A nonzero application exit
	# still follows engine teardown; this does not pretend SIGKILL can clean up.
	quit(code)
