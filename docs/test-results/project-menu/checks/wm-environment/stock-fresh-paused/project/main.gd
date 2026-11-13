extends Node
func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
	get_tree().auto_accept_quit = false
	get_window().title = "VientoStockWMProbe"
	get_window().close_requested.connect(_on_close)
	if "--paused" in OS.get_cmdline_user_args():
		get_tree().paused = true
	print("PROBE_READY:" + JSON.stringify({"paused":get_tree().paused,"pid":OS.get_process_id()}))
func _on_close() -> void:
	print("PROBE_WINDOW_CLOSE_SIGNAL:" + str(get_tree().paused))
	get_tree().quit()
func _notification(what: int) -> void:
	if what == NOTIFICATION_WM_CLOSE_REQUEST:
		print("PROBE_NODE_CLOSE_NOTIFICATION:" + str(get_tree().paused))
