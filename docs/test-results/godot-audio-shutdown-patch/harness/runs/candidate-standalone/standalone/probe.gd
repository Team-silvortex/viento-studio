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
	stream.loop_begin = 0
	stream.loop_end = 22050
	var data = PackedByteArray()
	data.resize(44100)
	stream.data = data
	player.stream = stream
	var stream_ref = weakref(stream)
	stream = null
	owner.add_child(player)
	var playback_ref
	if mode != "never-play":
		player.play()
		playback_ref = weakref(player.get_stream_playback())
		await create_timer(0.05).timeout
	player.stop()
	if mode == "clear-stream":
		player.stream = null
	root.remove_child(owner)
	owner.free()
	var before = [stream_ref.get_ref() != null, playback_ref != null and playback_ref.get_ref() != null]
	if mode == "two-frames":
		await process_frame
		await process_frame
	elif mode == "wait-100ms":
		await create_timer(0.1).timeout
	elif mode == "observe-release":
		var deadline = Time.get_ticks_msec() + 500
		while (stream_ref.get_ref() != null or (playback_ref != null and playback_ref.get_ref() != null)) and Time.get_ticks_msec() < deadline:
			await process_frame
	print("AUDIO_SHUTDOWN_PROBE:" + JSON.stringify({"mode": mode, "before": before,
		"after": [stream_ref.get_ref() != null, playback_ref != null and playback_ref.get_ref() != null]}))
	quit()
