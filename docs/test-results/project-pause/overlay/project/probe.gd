extends Node2D

var failed := false
var finished := false
var pause_phase := "waiting-for-release"
var input_controller: Node
var test_port := RefCounted.new()

func pause_port_valid(_port) -> bool:
	return true
func pause_resume_released() -> bool:
	return false
func pause_cancel_resume() -> bool:
	return false
func pause_request(_port, _value: bool) -> bool:
	return false
func finish_project() -> void:
	pass

func rect_data(rect: Rect2) -> Dictionary:
	return {"x":rect.position.x,"y":rect.position.y,"width":rect.size.x,"height":rect.size.y}

func _ready() -> void:
	input_controller = preload("res://project-pause-input.gd").new(self)
	add_child(input_controller)
	var title := "暫時停止🌙".repeat(32)
	var help := "松开按键🎮".repeat(32)
	assert(title.length() == 160 and help.length() == 160)
	assert(input_controller.configure(test_port, "ui_accept", title, help))
	input_controller.show_phase("waiting-for-release")
	for _index in range(8):
		await get_tree().process_frame
	await RenderingServer.frame_post_draw
	var viewport := get_viewport().get_visible_rect()
	var panel: Rect2 = input_controller.pause_panel.get_global_rect()
	var scroll: ScrollContainer = input_controller.pause_scroll
	var bar: VScrollBar = scroll.get_v_scroll_bar()
	assert(viewport.size == Vector2(390, 300), "Viewport must be exactly 390x300")
	assert(panel.position.x >= 0 and panel.position.y >= 0 and panel.end.x <= viewport.end.x and panel.end.y <= viewport.end.y, "Panel escaped viewport")
	assert(input_controller.panel_style.bg_color.a == 1.0, "Panel background must be fully opaque")
	assert(bar.max_value > bar.page and bar.visible, "Long multilingual text must have a vertical scroll range")
	var image := get_viewport().get_texture().get_image()
	assert(image.save_png("res://../overlay-top.png") == OK)
	var expected := Color("#101b2b")
	var sample := image.get_pixel(int(panel.position.x + 6), int(panel.position.y + panel.size.y / 2))
	assert(absf(sample.r - expected.r) <= 2.0 / 255.0 and absf(sample.g - expected.g) <= 2.0 / 255.0 and absf(sample.b - expected.b) <= 2.0 / 255.0 and sample.a == 1.0, "Opaque panel pixels must cover the magenta background")
	var before := scroll.scroll_vertical
	scroll.scroll_vertical = int(bar.max_value)
	for _index in range(3):
		await get_tree().process_frame
	await RenderingServer.frame_post_draw
	assert(scroll.scroll_vertical > before, "Long text must be scrollable")
	var final_image := get_viewport().get_texture().get_image()
	assert(final_image.save_png("res://../overlay-scrolled.png") == OK)
	var report := {"ok":true,"scope":"Independent actual 390x300 Godot window with exact frozen production pause-input source and a minimal inert host; no gameplay behavior, production file edits, installed app or font-closure claim.","viewport":rect_data(viewport),"panel":rect_data(panel),"titleUnicodeCharacters":title.length(),"helpUnicodeCharacters":help.length(),"phase":"waiting-for-release","panelWithinViewport":true,"opaqueBackgroundAlpha":input_controller.panel_style.bg_color.a,"sampledBackgroundRGBA":[sample.r,sample.g,sample.b,sample.a],"expectedBackgroundHex":"#101b2b","underlyingViewportClearColor":"#e605cc","scroll":{"minimum":bar.min_value,"maximum":bar.max_value,"page":bar.page,"visible":bar.visible,"before":before,"after":scroll.scroll_vertical},"screenshots":["overlay-top.png","overlay-scrolled.png"],"engine":Engine.get_version_info(),"renderer":RenderingServer.get_current_rendering_method(),"adapter":RenderingServer.get_video_adapter_name()}
	print("PAUSE_OVERLAY_CHECK:" + JSON.stringify(report))
	var file := FileAccess.open("res://../verification.json", FileAccess.WRITE)
	file.store_string(JSON.stringify(report, "  ") + "\n")
	file.close()
	get_tree().quit()
