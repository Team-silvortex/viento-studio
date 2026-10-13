# Standalone static 3D prototype. No 2D event/case/behavior protocol is used.
extends Node3D

var issues: Array[String] = []
var particle_elapsed: float = 0.0
var particle_node: MultiMeshInstance3D

# This adapter consumes Rust-prepared phases. It never owns a random generator,
# actor identity, physics state or author-source edits.
func prepare_particles() -> void:
    particle_node = get_node_or_null("ParticleField")
    if particle_node == null:
        return
    var phases: PackedVector3Array = particle_node.get_meta("viento_phases")
    var multi: MultiMesh = particle_node.multimesh
    multi.instance_count = phases.size()
    multi.visible_instance_count = phases.size()
    for index in range(phases.size()):
        multi.set_instance_transform(index, Transform3D.IDENTITY)
        var phase: Vector3 = phases[index]
        multi.set_instance_custom_data(index, Color(phase.x, phase.y, phase.z, 1.0))
    sample_particles(0.0)

func sample_particles(time_seconds: float) -> void:
    if particle_node == null:
        return
    # Same explicit bounded time input as the pure core. Float64 arithmetic
    # precedes the Vector3/uniform float32 boundary; negative wrap stays positive.
    particle_elapsed = clampf(time_seconds, 0.0, 3600.0)
    var velocity: Array = particle_node.get_meta("viento_velocity")
    var extent: Array = particle_node.get_meta("viento_extent")
    var offset: Vector3 = Vector3.ZERO
    for axis in range(3):
        var phase: float = fmod(float(velocity[axis]) * particle_elapsed / float(extent[axis]), 1.0)
        if phase < 0.0:
            phase += 1.0
        if phase >= 1.0 or phase == 0.0:
            phase = 0.0
        offset[axis] = phase
    var material: ShaderMaterial = particle_node.multimesh.mesh.material
    material.set_shader_parameter("sample_offset", offset)

func _process(delta: float) -> void:
    sample_particles(minf(3600.0, particle_elapsed + maxf(0.0, delta)))
    if particle_elapsed >= 3600.0:
        set_process(false)

func particle_receipt() -> Dictionary:
    var multi: MultiMesh = particle_node.multimesh
    var mesh: BoxMesh = multi.mesh
    var material: ShaderMaterial = mesh.material
    var color: Color = material.get_shader_parameter("particle_color")
    var phases: Array = []
    var transforms_identity: bool = true
    for index in range(multi.instance_count):
        var phase: Color = multi.get_instance_custom_data(index)
        phases.append([phase.r, phase.g, phase.b, phase.a])
        transforms_identity = transforms_identity and multi.get_instance_transform(index).is_equal_approx(Transform3D.IDENTITY)
    var samples: Array = []
    for time_seconds in [0.0, 0.5, 2.0, 3600.0]:
        sample_particles(time_seconds)
        samples.append({"timeSeconds":particle_elapsed,"offset":components(material.get_shader_parameter("sample_offset"))})
    sample_particles(0.0)
    set_process(true)
    _process(3601.0)
    var clock: Dictionary = {"timeSeconds":particle_elapsed,"processing":is_processing()}
    sample_particles(0.0)
    return {"clock":clock,"instanceCount":multi.instance_count,"visibleInstanceCount":multi.visible_instance_count,"transformFormat":multi.transform_format,"useCustomData":multi.use_custom_data,"center":components(particle_node.position),"extent":components(material.get_shader_parameter("field_extent")),"size":components(mesh.size),"color":[color.r,color.g,color.b,color.a],"aabb":{"position":components(multi.custom_aabb.position),"size":components(multi.custom_aabb.size)},"phases":phases,"transformsIdentity":transforms_identity,"samples":samples}

func vector(values: Array) -> Vector3:
    return Vector3(float(values[0]), float(values[1]), float(values[2]))

func components(value: Vector3) -> Array:
    return [value.x, value.y, value.z]

func check(condition: bool, message: String) -> void:
    if not condition:
        issues.append(message)

func orient(node: Node3D) -> void:
    # Set the complete basis directly: position/Euler updates can lose the
    # small horizontal component near Y-up at float32 precision.
    node.transform = Transform3D(Basis.looking_at(node.get_meta("viento_forward"), Vector3.UP), node.position)

func _ready() -> void:
    var camera: Camera3D = $Camera
    var light: DirectionalLight3D = $Light
    orient(camera)
    orient(light)
    prepare_particles()
    set_process(particle_node != null and particle_node.multimesh.instance_count > 0)
    if "--viento-scene3d-probe" in OS.get_cmdline_user_args():
        set_process(false)
        call_deferred("probe")

func probe() -> void:
    var document = JSON.parse_string(FileAccess.get_file_as_string("res://plan.json"))
    if not document is Dictionary or document.get("kind") != "scene3d":
        print("VIENTO_SCENE3D_PROBE " + JSON.stringify({"format":"viento-scene3d-probe","schemaVersion":1,"ok":false,"issues":["plan"]}))
        get_tree().quit(2)
        return
    var scene: Dictionary = document.scene
    var objects: Array = []
    var camera: Camera3D = $Camera
    var light: DirectionalLight3D = $Light
    # Godot JSON parsing can underflow tiny source directions. These metadata
    # vectors were normalized by the validated host before float32 conversion;
    # the host independently matches this probe against its original plan.
    var camera_forward: Vector3 = camera.get_meta("viento_forward")
    var light_forward: Vector3 = light.get_meta("viento_forward")
    check(camera.position.is_equal_approx(vector(scene.camera.position)), "camera.position")
    check((-camera.global_basis.z).is_equal_approx(camera_forward), "camera.forward")
    check(is_equal_approx(camera.fov, float(scene.camera.fovDegrees)), "camera.fov")
    check(is_equal_approx(camera.near, float(scene.camera.near)), "camera.near")
    check(is_equal_approx(camera.far, float(scene.camera.far)), "camera.far")
    check((-light.global_basis.z).is_equal_approx(light_forward), "light.direction")
    check(light.light_color.is_equal_approx(Color(scene.light.color)), "light.color")
    check(is_equal_approx(light.light_energy, float(scene.light.energy)), "light.energy")
    var environment: Environment = $Environment.environment
    check(environment.background_color.is_equal_approx(Color(scene.background)), "background")
    var fog_receipt: Dictionary = {}
    if scene.has("fog"):
        var declared_fog: Dictionary = scene.fog
        check(environment.fog_mode == Environment.FOG_MODE_EXPONENTIAL, "fog.mode")
        # The host checks enabled against its exact authored density: Godot's
        # JSON parser may underflow tiny positive numbers before this probe.
        check(is_equal_approx(environment.fog_density, float(declared_fog.density)), "fog.density")
        check(environment.fog_light_color.is_equal_approx(Color(declared_fog.color)), "fog.color")
        check(is_equal_approx(environment.fog_light_energy, 1.0), "fog.lightEnergy")
        check(is_zero_approx(environment.fog_height_density), "fog.heightDensity")
        check(is_zero_approx(environment.fog_sun_scatter), "fog.sunScatter")
        check(is_zero_approx(environment.fog_aerial_perspective), "fog.aerialPerspective")
        check(is_zero_approx(environment.fog_sky_affect), "fog.skyAffect")
        fog_receipt = {"mode":environment.fog_mode,"enabled":environment.fog_enabled,"density":environment.fog_density,"color":[environment.fog_light_color.r,environment.fog_light_color.g,environment.fog_light_color.b,environment.fog_light_color.a],"lightEnergy":environment.fog_light_energy,"heightDensity":environment.fog_height_density,"sunScatter":environment.fog_sun_scatter,"aerialPerspective":environment.fog_aerial_perspective,"skyAffect":environment.fog_sky_affect}
    else:
        check(not environment.fog_enabled, "fog.absent")
    check(int(ProjectSettings.get_setting("display/window/size/viewport_width")) == int(scene.viewport[0]), "viewport.width")
    check(int(ProjectSettings.get_setting("display/window/size/viewport_height")) == int(scene.viewport[1]), "viewport.height")
    check(get_child_count() == scene.objects.size() + 3 + (1 if scene.has("particleField") else 0), "node.count")
    for index in range(scene.objects.size()):
        var declared: Dictionary = scene.objects[index]
        var node: MeshInstance3D = get_node("Box_%d" % index)
        var angles: Vector3 = Vector3(deg_to_rad(float(declared.rotationDegrees[0])), deg_to_rad(float(declared.rotationDegrees[1])), deg_to_rad(float(declared.rotationDegrees[2])))
        var expected_basis: Basis = Basis.from_euler(angles, EULER_ORDER_XYZ)
        check(node.rotation_order == EULER_ORDER_XYZ, "rotation.order")
        check(node.position.is_equal_approx(vector(declared.position)), "object.position")
        check(node.basis.is_equal_approx(expected_basis), "object.basis")
        check(node.mesh is BoxMesh and node.mesh.size.is_equal_approx(vector(declared.size)), "object.mesh.size")
        check(node.mesh.material.albedo_color.is_equal_approx(Color(declared.color)), "object.color")
        check(node.get_meta("viento_instance_id") == declared.instanceId, "object.instanceId")
        check(node.get_meta("viento_name") == declared.name, "object.name")
        objects.append({"instanceId":node.get_meta("viento_instance_id"),"name":node.get_meta("viento_name"),"position":components(node.position),"declaredRotationDegrees":declared.rotationDegrees,"basisColumns":[components(node.basis.x),components(node.basis.y),components(node.basis.z)],"size":components(node.mesh.size),"color":declared.color,"materialColor":[node.mesh.material.albedo_color.r,node.mesh.material.albedo_color.g,node.mesh.material.albedo_color.b,node.mesh.material.albedo_color.a],"rotationOrder":"XYZ"})
    var receipt: Dictionary = {"format":"viento-scene3d-probe","schemaVersion":1,"ok":issues.is_empty(),"issues":issues,"objectCount":objects.size(),"objects":objects,"camera":{"position":components(camera.position),"forward":components(-camera.global_basis.z),"fovDegrees":camera.fov,"near":camera.near,"far":camera.far},"light":{"forward":components(-light.global_basis.z),"energy":light.light_energy,"color":[light.light_color.r,light.light_color.g,light.light_color.b,light.light_color.a]},"coordinateSystem":"RH-Y-up-negative-Z-forward","rotationOrder":"XYZ","scope":"Static Godot tree/transform/material probe; no 2D runtime events or behavior execution."}
    if scene.has("fog"):
        receipt["fog"] = fog_receipt
    if scene.has("particleField"):
        check(particle_node != null, "particleField.node")
        if particle_node != null:
            receipt["particleField"] = particle_receipt()
        receipt["ok"] = issues.is_empty()
    # Default JSON formatting rounds tiny positive float32 densities to zero.
    # Preserve full precision for fog receipts; legacy output stays unchanged.
    if scene.has("particleField"):
        print("VIENTO_SCENE3D_PROBE " + JSON.stringify(receipt, "", true, true))
    else:
        print("VIENTO_SCENE3D_PROBE " + JSON.stringify(receipt, "", true, scene.has("fog")))
    get_tree().quit(0 if issues.is_empty() else 2)
