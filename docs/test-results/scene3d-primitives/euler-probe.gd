extends SceneTree
func _initialize():
    var v = Vector3(deg_to_rad(23.0), deg_to_rad(-41.0), deg_to_rad(67.0))
    var b = Basis.from_euler(v, EULER_ORDER_XYZ)
    print(JSON.stringify({"format":"viento-scene3d-euler-probe","order":EULER_ORDER_XYZ,"degrees":[23,-41,67],"columns":[[b.x.x,b.x.y,b.x.z],[b.y.x,b.y.y,b.y.z],[b.z.x,b.z.y,b.z.z]]}))
    quit(0)
