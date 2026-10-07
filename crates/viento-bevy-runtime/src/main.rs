use bevy::prelude::*;
use serde::{Deserialize, Deserializer};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, HashSet},
    env, fs,
    io::{self, Read, Write},
    path::{Path, PathBuf},
    process::ExitCode,
    thread,
    time::Duration,
};

const VERSION: &str = "viento-bevy-runtime 0.3.0 bevy 0.19.1";
const MAX_SCENE_BYTES: u64 = 4 * 1024 * 1024;
const MAX_CONTROL_BYTES: u64 = 16 * 1024;
const MAX_INSTANCE_CONTROL_BYTES: u64 = 256 * 1024;
const MAX_RESOURCE_BYTES: u64 = 32 * 1024 * 1024;
const MAX_RESOURCE_TOTAL: u64 = 256 * 1024 * 1024;

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct SceneData {
    format: String,
    schema_version: u8,
    scene: SceneDeclaration,
    actors: Vec<ActorDeclaration>,
    resources: Vec<ResourceDeclaration>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct SceneDeclaration {
    object_id: String,
    title: String,
    viewport: [u32; 2],
    background: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct ActorDeclaration {
    #[serde(default, deserialize_with = "optional_string")]
    instance_id: Option<String>,
    object_id: String,
    position: [f64; 2],
    size: [f64; 2],
    color: String,
    speed: f64,
    controls: Controls,
    #[serde(default, deserialize_with = "optional_string")]
    image_resource_id: Option<String>,
}

fn optional_string<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Option<String>, D::Error> {
    String::deserialize(deserializer).map(Some)
}

#[derive(Clone, Copy, Deserialize, Component, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
enum Controls {
    Arrows,
    None,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ResourceDeclaration {
    id: String,
    sha256: String,
    size: u64,
    extension: String,
    file: String,
}

fn uuid(value: &str) -> bool {
    value.len() == 36
        && value.bytes().enumerate().all(|(i, c)| {
            if [8, 13, 18, 23].contains(&i) {
                c == b'-'
            } else {
                c.is_ascii_digit() || (b'a'..=b'f').contains(&c)
            }
        })
}

fn color(value: &str) -> bool {
    matches!(value.len(), 7 | 9)
        && value.starts_with('#')
        && value.as_bytes()[1..].iter().all(u8::is_ascii_hexdigit)
}

fn finite_pair(value: [f64; 2], min: f64, max: f64) -> bool {
    value
        .into_iter()
        .all(|number| number.is_finite() && (min..=max).contains(&number))
}

impl SceneData {
    fn validate(&self) -> Result<(), &'static str> {
        if self.format != "viento-bevy-scene" || ![1, 2].contains(&self.schema_version) {
            return Err("Unsupported scene DTO format or schema version.");
        }
        if !uuid(&self.scene.object_id)
            || self.scene.title.is_empty()
            || self.scene.title.encode_utf16().count() > 512
            || !self
                .scene
                .viewport
                .into_iter()
                .all(|n| (64..=4096).contains(&n))
            || !color(&self.scene.background)
        {
            return Err("Invalid scene declaration.");
        }
        if !(1..=128).contains(&self.actors.len()) || self.resources.len() > 128 {
            return Err("Scene cardinality exceeds the supported budget.");
        }
        let mut identities = HashSet::new();
        for actor in &self.actors {
            let identity = match (self.schema_version, actor.instance_id.as_deref()) {
                (1, None) => actor.object_id.as_str(),
                (2, Some(id)) if uuid(id) => id,
                _ => return Err("Invalid actor instance identity."),
            };
            if !uuid(&actor.object_id)
                || !identities.insert(identity)
                || !finite_pair(actor.position, -100000.0, 100000.0)
                || !finite_pair(actor.size, 1.0, 2048.0)
                || !color(&actor.color)
                || !actor.speed.is_finite()
                || !(0.0..=2000.0).contains(&actor.speed)
                || actor
                    .image_resource_id
                    .as_deref()
                    .is_some_and(|id| !uuid(id))
            {
                return Err("Invalid actor declaration or duplicate identity.");
            }
        }
        let mut resources = HashSet::new();
        let mut total = 0_u64;
        for resource in &self.resources {
            if !uuid(&resource.id)
                || !resources.insert(resource.id.as_str())
                || resource.sha256.len() != 64
                || !resource
                    .sha256
                    .bytes()
                    .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
                || !(1..=MAX_RESOURCE_BYTES).contains(&resource.size)
                || !["png", "jpg", "jpeg", "webp", "svg"].contains(&resource.extension.as_str())
                || resource.file != format!("images/{}.{}", resource.id, resource.extension)
            {
                return Err("Invalid generated resource declaration.");
            }
            total += resource.size;
        }
        if total > MAX_RESOURCE_TOTAL {
            return Err("Generated resource byte budget exceeded.");
        }
        if self.actors.iter().any(|actor| {
            actor
                .image_resource_id
                .as_deref()
                .is_some_and(|id| !resources.contains(id))
        }) {
            return Err("Actor references an undeclared generated resource.");
        }
        Ok(())
    }
}

fn read_scene(path: &Path) -> Result<(SceneData, PathBuf), String> {
    if !path.is_absolute() {
        return Err("Scene DTO path must be absolute.".into());
    }
    let metadata = fs::symlink_metadata(path).map_err(|_| "Cannot read generated scene DTO.")?;
    if !metadata.file_type().is_file() || metadata.len() > MAX_SCENE_BYTES {
        return Err("Scene DTO must be a bounded regular file.".into());
    }
    let parent = path
        .parent()
        .ok_or("Scene DTO must have a parent directory.")?;
    let root = fs::canonicalize(parent).map_err(|_| "Cannot resolve generated scene directory.")?;
    let mut bytes = Vec::new();
    fs::File::open(path)
        .map_err(|_| "Cannot open generated scene DTO.")?
        .take(MAX_SCENE_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "Cannot read generated scene DTO.")?;
    if bytes.len() as u64 > MAX_SCENE_BYTES {
        return Err("Scene DTO byte budget exceeded.".into());
    }
    let scene: SceneData =
        serde_json::from_slice(&bytes).map_err(|_| "Invalid generated scene DTO JSON.")?;
    scene.validate().map_err(str::to_owned)?;
    Ok((scene, root))
}

fn check_resource(root: &Path, resource: &ResourceDeclaration) -> io::Result<()> {
    // Generated names are already exact UUID paths. Neither the images
    // directory nor the file may be a symlink; no author path is interpreted.
    let images = root.join("images");
    if !fs::symlink_metadata(&images)?.file_type().is_dir() {
        return Err(io::Error::other("Invalid generated images directory."));
    }
    let path = root.join(&resource.file);
    let metadata = fs::symlink_metadata(&path)?;
    if !metadata.file_type().is_file()
        || metadata.len() != resource.size
        || !fs::canonicalize(&path)?.starts_with(root)
    {
        return Err(io::Error::other("Invalid generated resource file."));
    }
    let mut file = fs::File::open(&path)?;
    let mut hash = Sha256::new();
    let mut total = 0_u64;
    let mut buffer = [0_u8; 65536];
    loop {
        let count = file.read(&mut buffer)?;
        if count == 0 {
            break;
        }
        total += count as u64;
        if total > resource.size {
            return Err(io::Error::other("Generated resource size changed."));
        }
        hash.update(&buffer[..count]);
    }
    if total != resource.size || format!("{:x}", hash.finalize()) != resource.sha256 {
        return Err(io::Error::other("Generated resource integrity mismatch."));
    }
    Ok(())
}

#[derive(Clone, Component)]
struct ActorIdentity {
    order: usize,
    object_id: String,
    instance_id: Option<String>,
}
#[derive(Component)]
struct Position([f64; 2]);
#[derive(Component)]
struct Extent([f64; 2]);
#[derive(Component)]
struct Tint(String);
#[derive(Component)]
struct Speed(f64);
#[derive(Component)]
struct ImageBinding(Option<String>);
#[derive(Component, Clone, Copy, PartialEq, Eq)]
enum MotionState {
    Idle,
    Moving,
}
impl MotionState {
    fn name(self) -> &'static str {
        match self {
            Self::Idle => "idle",
            Self::Moving => "moving",
        }
    }
}
#[derive(Clone, Copy, Default, Deserialize)]
#[serde(deny_unknown_fields)]
struct ArrowInput {
    left: bool,
    right: bool,
    up: bool,
    down: bool,
}
impl ArrowInput {
    fn direction(self) -> [f64; 2] {
        let x = i8::from(self.right) - i8::from(self.left);
        let y = i8::from(self.down) - i8::from(self.up);
        let length = f64::from(x * x + y * y).sqrt();
        if length == 0.0 {
            [0.0, 0.0]
        } else {
            [f64::from(x) / length, f64::from(y) / length]
        }
    }
    fn released(self) -> bool {
        !self.left && !self.right && !self.up && !self.down
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct InstanceInput {
    instance_id: String,
    left: bool,
    right: bool,
    up: bool,
    down: bool,
}
impl InstanceInput {
    fn arrows(&self) -> ArrowInput {
        ArrowInput {
            left: self.left,
            right: self.right,
            up: self.up,
            down: self.down,
        }
    }
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct InstanceStep {
    inputs: Vec<InstanceInput>,
}
#[derive(Deserialize)]
#[serde(untagged)]
enum ControlStep {
    Global(ArrowInput),
    Instances(InstanceStep),
}
impl ControlStep {
    fn released(&self) -> bool {
        match self {
            Self::Global(arrows) => arrows.released(),
            Self::Instances(step) => step.inputs.iter().all(|input| input.arrows().released()),
        }
    }
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct ControlProgram {
    format: String,
    schema_version: u8,
    fixed_delta: f64,
    steps: Vec<ControlStep>,
}
impl ControlProgram {
    fn validate(&self) -> Result<(), &'static str> {
        if self.format != "viento-runtime-control"
            || ![1, 2].contains(&self.schema_version)
            || !self.fixed_delta.is_finite()
            || self.fixed_delta <= 0.0
            || self.fixed_delta > 0.25
            || !(1..=64).contains(&self.steps.len())
            || self.steps.len() as f64 * self.fixed_delta > 8.0
            || !self.steps.last().is_some_and(ControlStep::released)
        {
            return Err("Invalid bounded runtime control program.");
        }
        let mut rows = 0;
        for step in &self.steps {
            match (self.schema_version, step) {
                (1, ControlStep::Global(_)) => {}
                (2, ControlStep::Instances(step)) => {
                    if step.inputs.len() > 128 {
                        return Err("Runtime control step exceeds the instance cardinality limit.");
                    }
                    let mut ids = HashSet::new();
                    for input in &step.inputs {
                        if !uuid(&input.instance_id) || !ids.insert(input.instance_id.as_str()) {
                            return Err("Invalid or duplicate runtime control instance identity.");
                        }
                    }
                    rows += step.inputs.len();
                    if rows > 1024 {
                        return Err("Runtime control input row budget exceeded.");
                    }
                }
                _ => return Err("Runtime control step shape does not match its schema version."),
            }
        }
        Ok(())
    }
    fn validate_scene(&self, scene: &SceneData) -> Result<(), &'static str> {
        if scene.actors.len() * self.steps.len() > 1024 {
            return Err("Runtime control actor-step budget exceeded.");
        }
        if self.schema_version == 2 {
            if scene.schema_version != 2 {
                return Err("Instance control replay requires a scene plan version 2.");
            }
            let known: HashSet<_> = scene
                .actors
                .iter()
                .filter_map(|actor| actor.instance_id.as_deref())
                .collect();
            for step in &self.steps {
                if let ControlStep::Instances(step) = step
                    && step
                        .inputs
                        .iter()
                        .any(|input| !known.contains(input.instance_id.as_str()))
                {
                    return Err("Runtime control target instance is missing.");
                }
            }
        }
        Ok(())
    }
}

fn read_control_program(path: &Path, root: &Path) -> Result<ControlProgram, String> {
    if !path.is_absolute()
        || path
            .parent()
            .and_then(|parent| fs::canonicalize(parent).ok())
            .as_deref()
            != Some(root)
    {
        return Err("Control program must be inside the generated scene directory.".into());
    }
    let metadata =
        fs::symlink_metadata(path).map_err(|_| "Cannot read runtime control program.")?;
    if !metadata.file_type().is_file() || metadata.len() > MAX_INSTANCE_CONTROL_BYTES {
        return Err("Control program must be a bounded regular file.".into());
    }
    let mut bytes = Vec::new();
    fs::File::open(path)
        .map_err(|_| "Cannot open runtime control program.")?
        .take(MAX_INSTANCE_CONTROL_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "Cannot read runtime control program.")?;
    if bytes.len() as u64 > MAX_INSTANCE_CONTROL_BYTES {
        return Err("Control program byte budget exceeded.".into());
    }
    let program: ControlProgram =
        serde_json::from_slice(&bytes).map_err(|_| "Invalid runtime control program JSON.")?;
    if program.schema_version == 1 && bytes.len() as u64 > MAX_CONTROL_BYTES {
        return Err("Global control program byte budget exceeded.".into());
    }
    program.validate().map_err(str::to_owned)?;
    Ok(program)
}

#[derive(Resource, Default)]
struct InputStep {
    arrows: ArrowInput,
    instances: Option<HashMap<String, ArrowInput>>,
    delta: f64,
}
#[derive(Resource, Default)]
struct StateChanges(Vec<(ActorIdentity, MotionState)>);

fn movement(
    step: Res<InputStep>,
    mut changes: ResMut<StateChanges>,
    mut actors: Query<(
        &ActorIdentity,
        &mut Position,
        &Speed,
        &Controls,
        &mut MotionState,
    )>,
) {
    for (identity, mut position, speed, controls, mut state) in &mut actors {
        let direction = if *controls == Controls::Arrows {
            step.instances
                .as_ref()
                .map_or(step.arrows, |inputs| {
                    identity
                        .instance_id
                        .as_deref()
                        .and_then(|id| inputs.get(id))
                        .copied()
                        .unwrap_or_default()
                })
                .direction()
        } else {
            [0.0, 0.0]
        };
        let moving = direction != [0.0, 0.0] && speed.0 > 0.0;
        let next = if moving {
            MotionState::Moving
        } else {
            MotionState::Idle
        };
        if moving {
            position.0[0] += direction[0] * speed.0 * step.delta;
            position.0[1] += direction[1] * speed.0 * step.delta;
        }
        if *state != next {
            *state = next;
            changes.0.push((identity.clone(), next));
        }
    }
}

fn create_app(scene: &SceneData) -> App {
    let mut app = App::new();
    app.add_plugins(MinimalPlugins)
        .init_resource::<InputStep>()
        .init_resource::<StateChanges>()
        .add_systems(Update, movement);
    for (order, actor) in scene.actors.iter().enumerate() {
        app.world_mut().spawn((
            ActorIdentity {
                order,
                object_id: actor.object_id.clone(),
                instance_id: actor.instance_id.clone(),
            },
            Position(actor.position),
            Extent(actor.size),
            Tint(actor.color.clone()),
            Speed(actor.speed),
            actor.controls,
            MotionState::Idle,
            ImageBinding(actor.image_resource_id.clone()),
        ));
    }
    app
}

fn identity_fields(identity: &ActorIdentity, value: &mut Value) {
    value["objectId"] = json!(identity.object_id);
    if let Some(id) = &identity.instance_id {
        value["instanceId"] = json!(id);
    }
}

fn states(app: &mut App) -> Vec<Value> {
    let world = app.world_mut();
    let mut query = world.query::<(
        &ActorIdentity,
        &Position,
        &MotionState,
        &Extent,
        &Tint,
        &ImageBinding,
    )>();
    let mut states: Vec<_> = query
        .iter(world)
        .map(|(identity, position, state, extent, tint, image)| {
            // Geometry and binding data are real ECS components but this adapter
            // has no renderer. Reading them here keeps that boundary explicit.
            let _ = (&extent.0, &tint.0, &image.0);
            let mut value = json!({"position": position.0, "state": state.name()});
            identity_fields(identity, &mut value);
            (identity.order, value)
        })
        .collect();
    states.sort_by_key(|(order, _)| *order);
    states.into_iter().map(|(_, value)| value).collect()
}

fn emit(protocol: u8, event: &str, mut value: Value) -> io::Result<()> {
    value["protocol"] = json!(protocol);
    value["event"] = json!(event);
    let mut output = io::stdout().lock();
    writeln!(output, "VIENTO_RUNTIME:{value}")?;
    output.flush()
}

fn update(app: &mut App, right: bool, delta: f64) -> Vec<Value> {
    update_controls(
        app,
        ArrowInput {
            right,
            ..Default::default()
        },
        delta,
    )
}

fn update_controls(app: &mut App, arrows: ArrowInput, delta: f64) -> Vec<Value> {
    update_input(
        app,
        InputStep {
            arrows,
            instances: None,
            delta,
        },
    )
}

fn update_instances(app: &mut App, inputs: Vec<InstanceInput>, delta: f64) -> Vec<Value> {
    let instances = inputs
        .into_iter()
        .map(|input| {
            let arrows = input.arrows();
            (input.instance_id, arrows)
        })
        .collect();
    update_input(
        app,
        InputStep {
            arrows: ArrowInput::default(),
            instances: Some(instances),
            delta,
        },
    )
}

fn update_input(app: &mut App, step: InputStep) -> Vec<Value> {
    *app.world_mut().resource_mut::<InputStep>() = step;
    app.update();
    let mut changes = std::mem::take(&mut app.world_mut().resource_mut::<StateChanges>().0);
    changes.sort_by_key(|(identity, _)| identity.order);
    changes
        .into_iter()
        .map(|(identity, state)| {
            let mut value = json!({"state": state.name()});
            identity_fields(&identity, &mut value);
            value
        })
        .collect()
}

fn resource_failure(scene: &SceneData, resource: &ResourceDeclaration) -> Value {
    let mut value = json!({"severity":"error", "code":"runtime_image_failed", "message":"Generated resource failed integrity check."});
    if let Some((order, actor)) = scene
        .actors
        .iter()
        .enumerate()
        .find(|(_, actor)| actor.image_resource_id.as_deref() == Some(&resource.id))
    {
        identity_fields(
            &ActorIdentity {
                order,
                object_id: actor.object_id.clone(),
                instance_id: actor.instance_id.clone(),
            },
            &mut value,
        );
        value["resourceId"] = json!(resource.id);
    } else {
        value["objectId"] = json!(scene.scene.object_id);
    }
    value
}

fn emit_trace(protocol: u8, step_index: usize, actors: Vec<Value>) -> io::Result<()> {
    let value = json!({"format":"viento-runtime-trace","schemaVersion":1,"protocolVersion":protocol,
        "event":"sample","stepIndex":step_index,"actors":actors});
    let mut output = io::stdout().lock();
    writeln!(output, "VIENTO_TRACE:{value}")?;
    output.flush()
}

fn run_scene(
    path: &Path,
    smoke: bool,
    check: bool,
    control_path: Option<&Path>,
) -> Result<(), String> {
    let (scene, root) = read_scene(path)?;
    let program = control_path
        .map(|path| read_control_program(path, &root))
        .transpose()?;
    if let Some(program) = &program {
        program.validate_scene(&scene).map_err(str::to_owned)?;
    }
    for resource in &scene.resources {
        if check_resource(&root, resource).is_err() {
            emit(
                scene.schema_version,
                "diagnostic",
                resource_failure(&scene, resource),
            )
            .map_err(|_| "Cannot write runtime diagnostic.")?;
            return Err("Generated resource failed integrity check.".into());
        }
    }
    if check {
        return Ok(());
    }
    let mut app = create_app(&scene);
    emit(
        scene.schema_version,
        "ready",
        json!({"sceneObjectId":scene.scene.object_id, "actors":states(&mut app)}),
    )
    .map_err(|_| "Cannot write runtime frame.")?;
    if let Some(program) = program {
        for (index, step) in program.steps.into_iter().enumerate() {
            let changes = match step {
                ControlStep::Global(arrows) => {
                    update_controls(&mut app, arrows, program.fixed_delta)
                }
                ControlStep::Instances(step) => {
                    update_instances(&mut app, step.inputs, program.fixed_delta)
                }
            };
            for state in changes {
                emit(scene.schema_version, "state", state)
                    .map_err(|_| "Cannot write runtime frame.")?;
            }
            emit_trace(scene.schema_version, index, states(&mut app))
                .map_err(|_| "Cannot write runtime trace.")?;
        }
        emit(
            scene.schema_version,
            "finished",
            json!({"actors":states(&mut app), "fixedDelta":program.fixed_delta}),
        )
        .map_err(|_| "Cannot write runtime frame.")?;
        return Ok(());
    }
    if smoke {
        for right in [true, false] {
            for state in update(&mut app, right, 0.25) {
                emit(scene.schema_version, "state", state)
                    .map_err(|_| "Cannot write runtime frame.")?;
            }
        }
        let result = states(&mut app);
        for (index, state) in result.iter().enumerate() {
            let actor = &scene.actors[index];
            let expected = actor.position[0]
                + if actor.controls == Controls::Arrows {
                    actor.speed * 0.25
                } else {
                    0.0
                };
            if state["position"][0].as_f64() != Some(expected)
                || state["position"][1].as_f64() != Some(actor.position[1])
                || state["state"] != "idle"
            {
                return Err("Bevy movement or state verification failed.".into());
            }
        }
        emit(
            scene.schema_version,
            "finished",
            json!({"actors":result, "fixedDelta":0.25}),
        )
        .map_err(|_| "Cannot write runtime frame.")?;
        return Ok(());
    }
    // Input is host-driven only in the fixed smoke path for now. A normal
    // headless session idles at 60 Hz until its owning host cancels it.
    loop {
        update(&mut app, false, 1.0 / 60.0);
        thread::sleep(Duration::from_secs_f64(1.0 / 60.0));
    }
}

fn execute() -> Result<(), String> {
    let args: Vec<_> = env::args_os().skip(1).collect();
    if args.len() == 1 && args[0] == "--version" {
        println!("{VERSION}");
        return Ok(());
    }
    if args.len() == 1 && args[0] == "--metadata" {
        println!(
            "{}",
            json!({"runtimeKind":"viento-bevy-runtime","runtimeVersion":"0.3.0","bevyVersion":"0.19.1","protocolVersions":[1,2]})
        );
        return Ok(());
    }
    let mut scene = None;
    let mut smoke = false;
    let mut check = false;
    let mut control = None;
    let mut index = 0;
    while index < args.len() {
        if args[index] == "--scene" && scene.is_none() && index + 1 < args.len() {
            index += 1;
            scene = Some(PathBuf::from(&args[index]));
        } else if args[index] == "--control-program" && control.is_none() && index + 1 < args.len()
        {
            index += 1;
            control = Some(PathBuf::from(&args[index]));
        } else if args[index] == "--smoke" && !smoke {
            smoke = true;
        } else if args[index] == "--check" && !check {
            check = true;
        } else {
            return Err("Invalid runtime arguments.".into());
        }
        index += 1;
    }
    if smoke && check {
        return Err("Choose either scene check or smoke execution.".into());
    }
    if control.is_some() && (!smoke || check) {
        return Err("A control program requires a headless smoke run.".into());
    }
    run_scene(
        &scene.ok_or("Expected --scene with a generated scene DTO path.")?,
        smoke,
        check,
        control.as_deref(),
    )
}

fn main() -> ExitCode {
    match execute() {
        Ok(()) => ExitCode::SUCCESS,
        Err(message) => {
            eprintln!("{message}");
            ExitCode::FAILURE
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};

    const SCENE: &str = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    const OBJECT: &str = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const INSTANCE: &str = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
    const RESOURCE: &str = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

    fn fixture(version: u8) -> Value {
        let mut actor = json!({"objectId":OBJECT,"position":[200.0,220.0],"size":[32,48],"color":"#80d0a0","speed":160,"controls":"arrows"});
        if version == 2 {
            actor["instanceId"] = json!(INSTANCE);
        }
        json!({"format":"viento-bevy-scene","schemaVersion":version,
            "scene":{"objectId":SCENE,"title":"Bevy ECS test","viewport":[640,480],"background":"#0c1725"},
            "actors":[actor],"resources":[]})
    }

    fn parse(value: Value) -> Result<SceneData, String> {
        let scene: SceneData = serde_json::from_value(value).map_err(|error| error.to_string())?;
        scene.validate().map_err(str::to_owned)?;
        Ok(scene)
    }

    struct TempDirectory(PathBuf);
    impl TempDirectory {
        fn new() -> Self {
            static NEXT: AtomicU64 = AtomicU64::new(0);
            let path = env::temp_dir().join(format!(
                "viento-bevy-runtime-test-{}-{}",
                std::process::id(),
                NEXT.fetch_add(1, Ordering::Relaxed)
            ));
            fs::create_dir(&path).unwrap();
            Self(path)
        }
    }
    impl Drop for TempDirectory {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn legacy_definition_identity_round_trips_through_real_bevy_system() {
        let scene = parse(fixture(1)).unwrap();
        let mut app = create_app(&scene);
        assert_eq!(states(&mut app)[0]["position"], json!([200.0, 220.0]));
        let changes = update(&mut app, true, 0.25);
        assert_eq!(changes, vec![json!({"objectId":OBJECT,"state":"moving"})]);
        assert_eq!(
            update(&mut app, false, 0.25),
            vec![json!({"objectId":OBJECT,"state":"idle"})]
        );
        let result = states(&mut app);
        assert_eq!(result[0]["position"], json!([240.0, 220.0]));
        assert!(result[0].get("instanceId").is_none());
    }

    #[test]
    fn repeated_definition_instances_use_independent_controls_and_speed_components() {
        let mut value = fixture(2);
        let mut idle = value["actors"][0].clone();
        idle["instanceId"] = json!("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2");
        idle["controls"] = json!("none");
        idle["speed"] = json!(900);
        let mut stopped = value["actors"][0].clone();
        stopped["instanceId"] = json!("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3");
        stopped["speed"] = json!(0);
        value["actors"]
            .as_array_mut()
            .unwrap()
            .extend([idle, stopped]);
        let scene = parse(value).unwrap();
        let mut app = create_app(&scene);
        let changes = update(&mut app, true, 0.25);
        assert_eq!(changes.len(), 1);
        assert_eq!(changes[0]["instanceId"], INSTANCE);
        update(&mut app, false, 0.25);
        let result = states(&mut app);
        assert_eq!(result[0]["position"], json!([240.0, 220.0]));
        assert_eq!(result[1]["position"], json!([200.0, 220.0]));
        assert_eq!(result[2]["position"], json!([200.0, 220.0]));
        let world = app.world_mut();
        let mut query = world.query::<(&Extent, &Tint, &ImageBinding)>();
        assert_eq!(query.iter(world).count(), 3);
        assert!(
            query
                .iter(world)
                .all(|(extent, tint, image)| extent.0 == [32.0, 48.0]
                    && tint.0 == "#80d0a0"
                    && image.0.is_none())
        );
    }

    #[test]
    fn actor_identity_schema_boundaries_are_strict() {
        let mut missing = fixture(2);
        missing["actors"][0]
            .as_object_mut()
            .unwrap()
            .remove("instanceId");
        assert!(parse(missing).is_err());
        let mut extra = fixture(1);
        extra["actors"][0]["instanceId"] = json!(INSTANCE);
        assert!(parse(extra).is_err());
        let mut null = fixture(1);
        null["actors"][0]["instanceId"] = Value::Null;
        assert!(parse(null).is_err());
        let mut duplicate = fixture(2);
        let actor = duplicate["actors"][0].clone();
        duplicate["actors"].as_array_mut().unwrap().push(actor);
        assert!(parse(duplicate).is_err());
        let mut duplicate = fixture(1);
        let actor = duplicate["actors"][0].clone();
        duplicate["actors"].as_array_mut().unwrap().push(actor);
        assert!(parse(duplicate).is_err());
        assert!(parse(fixture(3)).is_err());
    }

    #[test]
    fn json_unknown_duplicate_and_null_fields_are_rejected() {
        for level in ["root", "scene", "actor"] {
            let mut value = fixture(2);
            match level {
                "root" => value["sourcePath"] = json!("/untrusted"),
                "scene" => value["scene"]["sourcePath"] = json!("/untrusted"),
                _ => value["actors"][0]["sourcePath"] = json!("/untrusted"),
            }
            assert!(parse(value).is_err());
        }
        let original = fixture(2).to_string();
        let duplicate = original.replacen("\"speed\":160", "\"speed\":160,\"speed\":200", 1);
        assert!(serde_json::from_str::<SceneData>(&duplicate).is_err());
        let mut null = fixture(2);
        null["actors"][0]["imageResourceId"] = Value::Null;
        assert!(parse(null).is_err());
    }

    #[test]
    fn scalar_cardinality_and_geometry_budgets_are_enforced() {
        for (field, value) in [
            ("speed", json!(-1)),
            ("position", json!([100001, 0])),
            ("size", json!([0, 32])),
            ("color", json!("red")),
            ("controls", json!("keyboard")),
        ] {
            let mut input = fixture(2);
            input["actors"][0][field] = value;
            assert!(parse(input).is_err());
        }
        let mut input = fixture(2);
        input["scene"]["viewport"] = json!([63, 480]);
        assert!(parse(input).is_err());
        let mut input = fixture(2);
        input["actors"] = json!([]);
        assert!(parse(input).is_err());
        assert!(!finite_pair([f64::INFINITY, 0.0], -100000.0, 100000.0));
        assert!(!finite_pair([f64::NAN, 0.0], -100000.0, 100000.0));
    }

    fn resource_fixture() -> (TempDirectory, SceneData) {
        let directory = TempDirectory::new();
        fs::create_dir(directory.0.join("images")).unwrap();
        let bytes = b"<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>";
        fs::write(directory.0.join(format!("images/{RESOURCE}.svg")), bytes).unwrap();
        let mut value = fixture(2);
        value["actors"][0]["imageResourceId"] = json!(RESOURCE);
        value["resources"] = json!([{"id":RESOURCE,"sha256":format!("{:x}",Sha256::digest(bytes)),
            "size":bytes.len(),"extension":"svg","file":format!("images/{RESOURCE}.svg")}]);
        (directory, parse(value).unwrap())
    }

    #[test]
    fn generated_resource_reads_exact_complete_registered_bytes() {
        let (directory, scene) = resource_fixture();
        check_resource(&directory.0, &scene.resources[0]).unwrap();
        let mut changed = fs::read(directory.0.join(&scene.resources[0].file)).unwrap();
        changed[0] = b'!';
        fs::write(directory.0.join(&scene.resources[0].file), changed).unwrap();
        assert!(check_resource(&directory.0, &scene.resources[0]).is_err());
        let diagnostic = resource_failure(&scene, &scene.resources[0]);
        assert_eq!(diagnostic["instanceId"], INSTANCE);
        assert_eq!(diagnostic["resourceId"], RESOURCE);
        assert!(diagnostic.get("sourcePath").is_none());
    }

    #[test]
    fn generated_resource_path_and_reference_cannot_escape_inventory() {
        let mut value = fixture(2);
        value["actors"][0]["imageResourceId"] = json!(RESOURCE);
        assert!(parse(value).is_err());
        let (_, scene) = resource_fixture();
        let mut value = fixture(2);
        value["resources"] = json!([{"id":RESOURCE,"sha256":scene.resources[0].sha256,
            "size":scene.resources[0].size,"extension":"svg","file":"../secret.svg"}]);
        assert!(parse(value).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn scene_and_image_symlinks_are_rejected_before_reading() {
        use std::os::unix::fs::symlink;
        let (directory, scene) = resource_fixture();
        let outside = TempDirectory::new();
        let path = directory.0.join(&scene.resources[0].file);
        fs::rename(&path, outside.0.join("original.svg")).unwrap();
        symlink(outside.0.join("original.svg"), &path).unwrap();
        assert!(check_resource(&directory.0, &scene.resources[0]).is_err());
        fs::remove_file(&path).unwrap();
        fs::remove_dir(directory.0.join("images")).unwrap();
        symlink(&outside.0, directory.0.join("images")).unwrap();
        assert!(check_resource(&directory.0, &scene.resources[0]).is_err());
        let real_scene = outside.0.join("scene.json");
        fs::write(&real_scene, fixture(2).to_string()).unwrap();
        let alias = directory.0.join("scene.json");
        symlink(real_scene, &alias).unwrap();
        assert!(read_scene(&alias).is_err());
    }

    #[test]
    fn scene_file_read_is_bounded_and_requires_absolute_regular_file() {
        let directory = TempDirectory::new();
        let path = directory.0.join("scene.json");
        fs::write(&path, fixture(2).to_string()).unwrap();
        assert!(read_scene(&path).is_ok());
        assert!(read_scene(Path::new("scene.json")).is_err());
        assert!(read_scene(&directory.0).is_err());
        fs::File::create(&path)
            .unwrap()
            .set_len(MAX_SCENE_BYTES + 1)
            .unwrap();
        assert!(read_scene(&path).is_err());
    }

    fn control_fixture() -> Value {
        json!({"format":"viento-runtime-control","schemaVersion":1,"fixedDelta":0.125,
            "steps":[{"left":false,"right":true,"up":false,"down":false},
                {"left":false,"right":false,"up":false,"down":false}]})
    }

    #[test]
    fn arrow_vectors_cancel_opposites_and_normalize_diagonal_motion() {
        let diagonal = ArrowInput {
            right: true,
            up: true,
            ..Default::default()
        }
        .direction();
        assert!((diagonal[0] - std::f64::consts::FRAC_1_SQRT_2).abs() < 1e-15);
        assert!((diagonal[1] + std::f64::consts::FRAC_1_SQRT_2).abs() < 1e-15);
        assert_eq!(
            ArrowInput {
                left: true,
                right: true,
                ..Default::default()
            }
            .direction(),
            [0.0, 0.0]
        );
        assert_eq!(
            ArrowInput {
                down: true,
                ..Default::default()
            }
            .direction(),
            [0.0, 1.0]
        );
        assert_eq!(
            ArrowInput {
                up: true,
                ..Default::default()
            }
            .direction(),
            [0.0, -1.0]
        );
    }

    #[test]
    fn replay_updates_real_ecs_with_input_cancellation_none_controls_and_zero_speed() {
        let mut value = fixture(2);
        let mut none = value["actors"][0].clone();
        none["instanceId"] = json!("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2");
        none["controls"] = json!("none");
        let mut stopped = value["actors"][0].clone();
        stopped["instanceId"] = json!("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3");
        stopped["speed"] = json!(0);
        value["actors"]
            .as_array_mut()
            .unwrap()
            .extend([none, stopped]);
        let scene = parse(value).unwrap();
        let mut app = create_app(&scene);
        let changes = update_controls(
            &mut app,
            ArrowInput {
                left: true,
                up: true,
                ..Default::default()
            },
            0.125,
        );
        assert_eq!(changes.len(), 1);
        assert_eq!(changes[0]["instanceId"], INSTANCE);
        let samples = states(&mut app);
        let x = samples[0]["position"][0].as_f64().unwrap();
        let y = samples[0]["position"][1].as_f64().unwrap();
        assert!((x - (200.0 - 20.0 * std::f64::consts::FRAC_1_SQRT_2)).abs() < 1e-12);
        assert!((y - (220.0 - 20.0 * std::f64::consts::FRAC_1_SQRT_2)).abs() < 1e-12);
        assert_eq!(samples[1]["position"], json!([200.0, 220.0]));
        assert_eq!(samples[2]["position"], json!([200.0, 220.0]));
        assert_eq!(
            update_controls(
                &mut app,
                ArrowInput {
                    left: true,
                    right: true,
                    ..Default::default()
                },
                0.125
            )[0]["state"],
            "idle"
        );
        assert_eq!(states(&mut app)[0]["position"], samples[0]["position"]);
        assert!(update_controls(&mut app, ArrowInput::default(), 0.125).is_empty());
    }

    #[test]
    fn control_program_schema_limits_and_last_release_are_strict() {
        let valid: ControlProgram = serde_json::from_value(control_fixture()).unwrap();
        valid.validate().unwrap();
        for (field, value) in [
            ("format", json!("other")),
            ("schemaVersion", json!(2)),
            ("fixedDelta", json!(0)),
            ("fixedDelta", json!(0.251)),
            ("steps", json!([])),
        ] {
            let mut input = control_fixture();
            input[field] = value;
            let parsed: ControlProgram = serde_json::from_value(input).unwrap();
            assert!(parsed.validate().is_err());
        }
        let mut input = control_fixture();
        input["steps"][1]["right"] = json!(true);
        assert!(
            serde_json::from_value::<ControlProgram>(input)
                .unwrap()
                .validate()
                .is_err()
        );
        let mut input = control_fixture();
        input["steps"][0]["sourcePath"] = json!("author.gd");
        assert!(serde_json::from_value::<ControlProgram>(input).is_err());
        let mut input = control_fixture();
        input["steps"][0]["right"] = json!(1);
        assert!(serde_json::from_value::<ControlProgram>(input).is_err());
        let mut input = control_fixture();
        input["steps"] = json!(vec![
            json!({"left":false,"right":false,"up":false,"down":false});
            65
        ]);
        assert!(
            serde_json::from_value::<ControlProgram>(input)
                .unwrap()
                .validate()
                .is_err()
        );
        let mut input = control_fixture();
        input["fixedDelta"] = json!(0.25);
        input["steps"] = json!(vec![
            json!({"left":false,"right":false,"up":false,"down":false});
            33
        ]);
        assert!(
            serde_json::from_value::<ControlProgram>(input)
                .unwrap()
                .validate()
                .is_err()
        );
        let duplicate = control_fixture().to_string().replacen(
            "\"schemaVersion\":1",
            "\"schemaVersion\":1,\"schemaVersion\":1",
            1,
        );
        assert!(serde_json::from_str::<ControlProgram>(&duplicate).is_err());
    }

    #[test]
    fn control_file_must_be_bounded_regular_absolute_and_in_scene_directory() {
        let directory = TempDirectory::new();
        let path = directory.0.join("control-program.json");
        fs::write(&path, control_fixture().to_string()).unwrap();
        read_control_program(&path, &directory.0).unwrap();
        assert!(read_control_program(Path::new("control-program.json"), &directory.0).is_err());
        assert!(read_control_program(&directory.0, &directory.0).is_err());
        let other = TempDirectory::new();
        assert!(read_control_program(&path, &other.0).is_err());
        #[cfg(unix)]
        {
            let alias = directory.0.join("alias.json");
            std::os::unix::fs::symlink(&path, &alias).unwrap();
            assert!(read_control_program(&alias, &directory.0).is_err());
        }
        fs::File::create(&path)
            .unwrap()
            .set_len(MAX_CONTROL_BYTES + 1)
            .unwrap();
        assert!(read_control_program(&path, &directory.0).is_err());
    }

    fn instance_program_fixture() -> Value {
        let row = |id, left, right, up, down| json!({"instanceId":id,"left":left,"right":right,"up":up,"down":down});
        json!({"format":"viento-runtime-control","schemaVersion":2,"fixedDelta":0.125,
            "steps":[{"inputs":[row(INSTANCE,false,true,false,false),row("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2",true,false,false,false)]},
                {"inputs":[row(INSTANCE,false,false,true,false)]},{"inputs":[]}]})
    }

    #[test]
    fn real_ecs_instance_inputs_are_independent_and_unlisted_instances_release() {
        let mut value = fixture(2);
        let mut second = value["actors"][0].clone();
        second["instanceId"] = json!("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2");
        second["position"] = json!([500, 220]);
        second["speed"] = json!(80);
        let mut none = value["actors"][0].clone();
        none["instanceId"] = json!("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3");
        none["controls"] = json!("none");
        let mut zero = value["actors"][0].clone();
        zero["instanceId"] = json!("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb4");
        zero["speed"] = json!(0);
        value["actors"]
            .as_array_mut()
            .unwrap()
            .extend([second, none, zero]);
        let scene = parse(value).unwrap();
        let mut program = instance_program_fixture();
        program["steps"][0]["inputs"].as_array_mut().unwrap().extend([
            json!({"instanceId":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3","left":false,"right":true,"up":false,"down":false}),
            json!({"instanceId":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb4","left":false,"right":true,"up":false,"down":false})]);
        let program: ControlProgram = serde_json::from_value(program).unwrap();
        program.validate().unwrap();
        program.validate_scene(&scene).unwrap();
        let mut app = create_app(&scene);
        for (index, step) in program.steps.into_iter().enumerate() {
            let ControlStep::Instances(step) = step else {
                panic!("Expected instance inputs")
            };
            let changes = update_instances(&mut app, step.inputs, 0.125);
            let samples = states(&mut app);
            match index {
                0 => {
                    assert_eq!(changes.len(), 2);
                    assert_eq!(samples[0]["position"], json!([220.0, 220.0]));
                    assert_eq!(samples[1]["position"], json!([490.0, 220.0]));
                }
                1 => {
                    assert_eq!(changes.len(), 1);
                    assert_eq!(
                        changes[0]["instanceId"],
                        "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2"
                    );
                    assert_eq!(changes[0]["state"], "idle");
                    assert_eq!(samples[0]["position"], json!([220.0, 200.0]));
                    assert_eq!(samples[1]["position"], json!([490.0, 220.0]));
                }
                _ => {
                    assert_eq!(changes.len(), 1);
                    assert!(samples.iter().all(|sample| sample["state"] == "idle"));
                }
            }
            for sample in &samples[2..] {
                assert_eq!(sample["state"], "idle");
                assert_eq!(sample["position"], json!([200.0, 220.0]));
            }
        }
    }

    #[test]
    fn instance_program_rejects_duplicate_unknown_definition_targets_and_legacy_plan() {
        let mut value = fixture(2);
        let mut second = value["actors"][0].clone();
        second["instanceId"] = json!("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2");
        value["actors"].as_array_mut().unwrap().push(second);
        let scene = parse(value).unwrap();
        let program: ControlProgram = serde_json::from_value(instance_program_fixture()).unwrap();
        program.validate().unwrap();
        program.validate_scene(&scene).unwrap();
        assert!(program.validate_scene(&parse(fixture(1)).unwrap()).is_err());
        for id in [OBJECT, "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"] {
            let mut input = instance_program_fixture();
            input["steps"][0]["inputs"][0]["instanceId"] = json!(id);
            let program: ControlProgram = serde_json::from_value(input).unwrap();
            program.validate().unwrap();
            assert!(program.validate_scene(&scene).is_err());
        }
        let mut duplicate = instance_program_fixture();
        let row = duplicate["steps"][0]["inputs"][0].clone();
        duplicate["steps"][0]["inputs"]
            .as_array_mut()
            .unwrap()
            .push(row);
        assert!(
            serde_json::from_value::<ControlProgram>(duplicate)
                .unwrap()
                .validate()
                .is_err()
        );
        let mut input = instance_program_fixture();
        input["steps"][0]["inputs"][0]["sourcePath"] = json!("author.rs");
        assert!(serde_json::from_value::<ControlProgram>(input).is_err());
        let mut input = instance_program_fixture();
        input["steps"][0]["inputs"][0]["right"] = json!(1);
        assert!(serde_json::from_value::<ControlProgram>(input).is_err());
        let mut input = instance_program_fixture();
        input["steps"][2]["inputs"] =
            json!([{"instanceId":INSTANCE,"left":false,"right":true,"up":false,"down":false}]);
        assert!(
            serde_json::from_value::<ControlProgram>(input)
                .unwrap()
                .validate()
                .is_err()
        );
        let mut rows = instance_program_fixture();
        let inputs = (0..128).map(|index| json!({"instanceId":format!("bbbbbbbb-bbbb-4bbb-8bbb-{index:012x}"),"left":false,"right":false,"up":false,"down":false})).collect::<Vec<_>>();
        rows["steps"] = json!(vec![json!({"inputs":inputs}); 9]);
        assert!(
            serde_json::from_value::<ControlProgram>(rows)
                .unwrap()
                .validate()
                .is_err()
        );
    }

    #[test]
    fn instance_program_uses_256_kib_file_budget_while_global_keeps_16_kib() {
        let directory = TempDirectory::new();
        let path = directory.0.join("control-program.json");
        let mut bytes = instance_program_fixture().to_string().into_bytes();
        bytes.resize((MAX_CONTROL_BYTES + 100) as usize, b' ');
        fs::write(&path, &bytes).unwrap();
        read_control_program(&path, &directory.0).unwrap();
        let mut global = control_fixture().to_string().into_bytes();
        global.resize(bytes.len(), b' ');
        fs::write(&path, global).unwrap();
        assert!(read_control_program(&path, &directory.0).is_err());
        fs::File::create(&path)
            .unwrap()
            .set_len(MAX_INSTANCE_CONTROL_BYTES + 1)
            .unwrap();
        assert!(read_control_program(&path, &directory.0).is_err());
    }
}
