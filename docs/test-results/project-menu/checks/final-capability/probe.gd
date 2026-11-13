extends "res://project-menu-runtime.gd"
func _ready() -> void:
	super._ready()
	var cases = JSON.parse_string(FileAccess.get_file_as_string("res://menu-final-capability-cases.json"))
	var results: Array = []
	for row in cases:
		var accepted := menu_parse(row["items_json"], row["mode"]) != null
		results.append({"label":row["label"],"portableAccepted":row["portableAccepted"],"backendAccepted":accepted,"expectedBackendAccepted":row["expectedBackendAccepted"],"reason":row["reason"]})
		assert(accepted == row["expectedBackendAccepted"])
	print("MENU_CAPABILITY_FINAL:" + JSON.stringify({"count":cases.size(),"results":results},"",true,true))
	finish_project()
