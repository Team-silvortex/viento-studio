extends SceneTree

func _initialize() -> void:
	call_deferred("probe")

func alive(refs: Array) -> int:
	var count := 0
	for ref in refs:
		if ref.get_ref() != null:
			count += 1
	return count

func probe() -> void:
	var refs: Array = []
	var peaks: Array = []
	for cycle in range(32):
		var owner = Node.new()
		root.add_child(owner)
		var player = AudioStreamPlayer.new()
		var stream = AudioStreamWAV.new()
		stream.format = AudioStreamWAV.FORMAT_16_BITS
		stream.mix_rate = 22050
		stream.loop_mode = AudioStreamWAV.LOOP_FORWARD
		stream.loop_end = 22050
		var data = PackedByteArray()
		data.resize(44100)
		stream.data = data
		player.stream = stream
		refs.append(weakref(stream))
		stream = null
		owner.add_child(player)
		player.play()
		refs.append(weakref(player.get_stream_playback()))
		await create_timer(0.025).timeout
		player.stop()
		root.remove_child(owner)
		owner.free()
		peaks.append(alive(refs))
	var started = Time.get_ticks_msec()
	while alive(refs) > 0 and Time.get_ticks_msec() - started < 500:
		await process_frame
	print("AUDIO_SHUTDOWN_CYCLES:" + JSON.stringify({"cycles": 32, "objectsTracked": refs.size(),
		"aliveAfterEachStop": peaks, "remaining": alive(refs), "drainMilliseconds": Time.get_ticks_msec() - started}))
	quit()
