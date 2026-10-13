extends SceneTree
func _initialize():
    var env: Environment = Environment.new()
    env.fog_density = 1e-40
    print("DENSITY_DIAGNOSTIC ", JSON.stringify({"literal":1e-40,"actual":env.fog_density}, "", true, true))
    print("DENSITY_DEFAULT ", JSON.stringify({"literal":1e-40,"actual":env.fog_density}))
    quit()
