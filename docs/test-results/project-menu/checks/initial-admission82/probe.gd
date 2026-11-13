extends "res://project-menu-runtime.gd"
func _ready() -> void:
	super._ready()
	var cases = JSON.parse_string(FileAccess.get_file_as_string("res://menu-parity-cases.json"))
	var results: Array = []
	for row in cases:
		var accepted := menu_parse(row["items_json"], row["mode"]) != null
		results.append({"label":row["label"],"expected":row["accepted"],"actual":accepted})
		if accepted != row["accepted"]:
			push_error("MENU_PARITY_MISMATCH:" + JSON.stringify(row))
			get_tree().quit(1)
			return
	print("MENU_PARITY_OK:" + JSON.stringify({"count":cases.size(),"results":results},"",true,true))
	finish_project()
