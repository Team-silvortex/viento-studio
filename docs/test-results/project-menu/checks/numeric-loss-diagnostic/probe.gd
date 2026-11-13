extends SceneTree
func _initialize() -> void:
	var host = load("res://project-menu-runtime.gd").new()
	for literal in ["1", "1.0", "1e0", "-0", "1e-300", "5e-324", "0.30000000000000004", "0.000001", "1e-7", "1.2345678901234567", "2.2250738585072014e-308", "2.225073858507201e-308", "1e-308", "1e-309", "1e-310", "1e-320", "1e-323", "9.9e-324", "4.9406564584124654e-324", "2.2250738585072013e-308", "1.2345678901234567e-300", "1.0000000000000002e-300"]:
		var parsed = host.menu_parse('[{"id":"r","label":"R","command":"restart","values":{"value":' + literal + '}}]', "scene")
		assert(parsed != null)
		var value = parsed[0]["values"]["value"]
		var bytes := PackedByteArray()
		bytes.resize(8)
		bytes.encode_double(0, value)
		var direct := PackedByteArray()
		direct.resize(8)
		direct.encode_double(0, literal.to_float())
		print("MENU_DOUBLE:" + JSON.stringify({"literal":literal,"bytesLittleEndian":bytes.hex_encode(),"directToFloatBytes":direct.hex_encode(),"serialized":JSON.stringify(value,"",true,true)},"",true,true))
	host.free()
	quit()
