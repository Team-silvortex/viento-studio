//! Fixed Bevy host for generated Rust behaviors. This is native author code,
//! not a sandbox: the adapter owns process execution and source provenance.
use bevy::prelude::*;
use serde::Deserialize;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, HashSet},
    fs,
    io::{self, Read, Write},
    path::Path,
    thread,
    time::Duration,
};

pub const VERSION: &str = "viento-bevy-behaviors 0.2.0 bevy 0.19.1";
const MAX_SCENE_BYTES: u64 = 1024 * 1024;
const MAX_SOURCE_BYTES: u64 = 65536;

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct SceneData {
    format: String,
    schema_version: u8,
    scene: SceneDeclaration,
    actors: Vec<ActorDeclaration>,
    resources: Vec<Value>,
    sources: Vec<SourceDeclaration>,
    bindings: Vec<Binding>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct SceneDeclaration {
    object_id: String,
    title: String,
    viewport: [u32; 2],
    background: String,
}
#[derive(Clone, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct ActorDeclaration {
    instance_id: String,
    object_id: String,
    position: [f64; 2],
    size: [f64; 2],
    color: String,
    speed: f64,
    controls: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct SourceDeclaration {
    object_id: String,
    file: String,
    sha256: String,
    size: u64,
}
#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct Binding {
    binding_id: String,
    instance_id: String,
    object_id: String,
    implementation: Implementation,
    parameters: HashMap<String, Value>,
    events: Vec<Signal>,
}
#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct Implementation {
    backend_id: String,
    language: String,
    source_object_id: String,
}
#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct Signal {
    signal: String,
    event: String,
}

fn uuid(value: &str) -> bool {
    value.len() == 36
        && value.bytes().enumerate().all(|(index, byte)| {
            if [8, 13, 18, 23].contains(&index) {
                byte == b'-'
            } else {
                byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte)
            }
        })
}
fn hash(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}
fn name(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 64
        && value.bytes().enumerate().all(|(index, byte)| {
            byte.is_ascii_alphabetic() || byte == b'_' || index > 0 && byte.is_ascii_digit()
        })
}
fn scalar(value: &Value) -> bool {
    match value {
        Value::Bool(_) => true,
        Value::String(text) => text.encode_utf16().count() <= 4096,
        Value::Number(number) => number.as_f64().is_some_and(|value| {
            value.is_finite() && (value.fract() != 0.0 || value.abs() <= 9007199254740991.0)
        }),
        _ => false,
    }
}
fn color(value: &str) -> bool {
    matches!(value.len(), 7 | 9)
        && value.starts_with('#')
        && value.as_bytes()[1..].iter().all(u8::is_ascii_hexdigit)
}
fn pair(value: [f64; 2], min: f64, max: f64) -> bool {
    value
        .into_iter()
        .all(|number| number.is_finite() && (min..=max).contains(&number))
}
impl SceneData {
    fn validate(&self) -> Result<(), String> {
        if self.format != "viento-bevy-rust-scene"
            || self.schema_version != 1
            || !self.resources.is_empty()
            || !uuid(&self.scene.object_id)
            || self.scene.title.trim().is_empty()
            || self.scene.title.encode_utf16().count() > 160
            || self.scene.title.chars().any(|c| (c as u32) < 32)
            || !self
                .scene
                .viewport
                .into_iter()
                .all(|n| (64..=4096).contains(&n))
            || !color(&self.scene.background)
            || !(1..=128).contains(&self.actors.len())
            || !(1..=8).contains(&self.sources.len())
            || !(1..=32).contains(&self.bindings.len())
        {
            return Err("Invalid generated Rust behavior scene or unsupported capability.".into());
        }
        let mut actors = HashMap::new();
        for actor in &self.actors {
            if !uuid(&actor.instance_id)
                || !uuid(&actor.object_id)
                || actors
                    .insert(actor.instance_id.as_str(), actor.object_id.as_str())
                    .is_some()
                || !pair(actor.position, -100000.0, 100000.0)
                || !pair(actor.size, 1.0, 2048.0)
                || !color(&actor.color)
                || !actor.speed.is_finite()
                || !(0.0..=2000.0).contains(&actor.speed)
                || !["arrows", "none"].contains(&actor.controls.as_str())
            {
                return Err("Invalid generated actor declaration.".into());
            }
        }
        let mut sources = HashSet::new();
        for source in &self.sources {
            if !uuid(&source.object_id)
                || !sources.insert(source.object_id.as_str())
                || !hash(&source.sha256)
                || !(1..=MAX_SOURCE_BYTES).contains(&source.size)
                || source.file
                    != format!("src/behaviors/b_{}.rs", source.object_id.replace('-', "_"))
            {
                return Err("Invalid generated behavior source inventory.".into());
            }
        }
        let mut bindings = HashSet::new();
        let mut used = HashSet::new();
        for binding in &self.bindings {
            if !uuid(&binding.binding_id)
                || !bindings.insert(&binding.binding_id)
                || actors.get(binding.instance_id.as_str()) != Some(&binding.object_id.as_str())
                || binding.implementation.backend_id != "org.viento.bevy-rust"
                || binding.implementation.language != "rust"
                || !sources.contains(binding.implementation.source_object_id.as_str())
                || binding.parameters.len() > 32
                || binding.parameters.iter().any(|(key, value)| {
                    !name(key)
                        || ["constructor", "__proto__", "prototype"].contains(&key.as_str())
                        || !scalar(value)
                })
                || binding.events.len() > 8
            {
                return Err("Invalid generated behavior binding.".into());
            }
            used.insert(binding.implementation.source_object_id.as_str());
            let mut signals = HashSet::new();
            for signal in &binding.events {
                if !name(&signal.signal)
                    || !name(&signal.event)
                    || !signals.insert(signal.signal.as_str())
                {
                    return Err("Invalid or duplicate signal declaration.".into());
                }
            }
        }
        if used != sources {
            return Err("Generated source inventory contains unused entries.".into());
        }
        Ok(())
    }
}

fn bounded_read(path: &Path, limit: u64) -> Result<Vec<u8>, String> {
    let metadata = fs::symlink_metadata(path).map_err(|_| "Cannot read generated project file.")?;
    if !metadata.file_type().is_file() || metadata.len() > limit {
        return Err("Expected a bounded regular generated project file.".into());
    }
    let mut bytes = Vec::new();
    fs::File::open(path)
        .map_err(|_| "Cannot open generated project file.")?
        .take(limit + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "Cannot read generated project file.")?;
    if bytes.len() as u64 > limit {
        return Err("Generated project file exceeds its byte budget.".into());
    }
    Ok(bytes)
}
fn read_scene(path: &Path) -> Result<SceneData, String> {
    if !path.is_absolute() {
        return Err("Scene path must be absolute.".into());
    }
    let bytes = bounded_read(path, MAX_SCENE_BYTES)?;
    let scene: SceneData =
        serde_json::from_slice(&bytes).map_err(|_| "Invalid generated scene JSON.")?;
    scene.validate()?;
    let root = path.parent().ok_or("Missing generated project root.")?;
    let compiled: HashMap<_, _> = crate::behavior_sources::SOURCES.iter().copied().collect();
    if compiled.len() != scene.sources.len() {
        return Err("Compiled behavior inventory differs from the scene.".into());
    }
    for folder in [root.join("src"), root.join("src/behaviors")] {
        if !fs::symlink_metadata(folder)
            .map_err(|_| "Missing generated source directory.")?
            .file_type()
            .is_dir()
        {
            return Err("Expected regular generated source directories.".into());
        }
    }
    for source in &scene.sources {
        if compiled.get(source.object_id.as_str()) != Some(&source.sha256.as_str()) {
            return Err("Compiled source revision differs from the scene.".into());
        }
        let bytes = bounded_read(&root.join(&source.file), MAX_SOURCE_BYTES)?;
        if bytes.len() as u64 != source.size
            || format!("{:x}", Sha256::digest(&bytes)) != source.sha256
        {
            return Err("Generated source integrity mismatch.".into());
        }
    }
    Ok(scene)
}

#[derive(Clone, Debug)]
struct Failure {
    code: &'static str,
    message: String,
    parameter: Option<String>,
}
/// A host-owned fixed step. The first step has tick 0; modifying a local copy
/// cannot change the host clock or another binding's step.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct FixedStep {
    pub tick: u64,
    pub delta_seconds: f64,
}
/// Plain function pointers keep callback registration explicit and independent
/// of author source parsing. Per-binding state belongs in declared parameters
/// and the bound instance; the host never exposes another actor's position.
pub type FixedUpdateCallback = fn(&mut BehaviorContext<'_>, FixedStep) -> Result<(), String>;

#[derive(Clone, Copy, PartialEq)]
enum Lifecycle {
    Ready,
    FixedUpdate,
}

/// Per-callback transaction. Only a successful callback can commit its position,
/// registration, or events. Native author Rust can use the standard library;
/// these guarantees cover this host API, not arbitrary native side effects.
pub struct BehaviorContext<'a> {
    binding: &'a Binding,
    position: [f64; 2],
    lifecycle: Lifecycle,
    fixed_update: Option<FixedUpdateCallback>,
    emitted_before: usize,
    emissions: Vec<(String, Vec<Value>)>,
    failure: Option<Failure>,
}
impl<'a> BehaviorContext<'a> {
    fn new(binding: &'a Binding, position: [f64; 2], lifecycle: Lifecycle, emitted: usize) -> Self {
        Self {
            binding,
            position,
            lifecycle,
            fixed_update: None,
            emitted_before: emitted,
            emissions: Vec::new(),
            failure: None,
        }
    }
    fn fail(&mut self, code: &'static str, message: String, parameter: Option<String>) -> String {
        let message = if message.is_empty() {
            "Rust behavior callback returned an error.".to_owned()
        } else {
            message
        };
        if self.failure.is_none() {
            self.failure = Some(Failure {
                code,
                message: message.clone(),
                parameter,
            });
        }
        message
    }
    /// Register one fixed callback during ready. Repeated registration and
    /// registration from fixed_update poison the current transaction even when
    /// the caller ignores the returned error.
    pub fn on_fixed_update(&mut self, callback: FixedUpdateCallback) -> Result<(), String> {
        if self.lifecycle != Lifecycle::Ready || self.fixed_update.is_some() {
            return Err(self.fail(
                "runtime_behavior_lifecycle",
                "Register a fixed update callback once, from ready only.".into(),
                None,
            ));
        }
        self.fixed_update = Some(callback);
        Ok(())
    }
    pub fn position(&self) -> [f64; 2] {
        self.position
    }
    /// Author writes must stay finite and within the scene coordinate range.
    /// Existing built-in movement can cross that range and remains readable;
    /// a callback which does not write position never revalidates old motion.
    pub fn set_position(&mut self, position: [f64; 2]) -> Result<(), String> {
        if !pair(position, -100000.0, 100000.0) {
            return Err(self.fail(
                "runtime_behavior_position",
                "Behavior position must contain finite coordinates between -100000 and 100000."
                    .into(),
                None,
            ));
        }
        self.position = position;
        Ok(())
    }
    pub fn translate(&mut self, displacement: [f64; 2]) -> Result<(), String> {
        self.set_position([
            self.position[0] + displacement[0],
            self.position[1] + displacement[1],
        ])
    }
    fn parameter_error(&mut self, name: &str, expected: &str) -> String {
        let declared = self
            .binding
            .parameters
            .contains_key(name)
            .then(|| name.to_owned());
        self.fail(
            "runtime_behavior_parameter",
            format!("Expected {expected} parameter: {name}"),
            declared,
        )
    }
    pub fn string(&mut self, name: &str) -> Result<String, String> {
        self.binding
            .parameters
            .get(name)
            .and_then(Value::as_str)
            .map(str::to_owned)
            .ok_or_else(|| self.parameter_error(name, "text"))
    }
    pub fn number(&mut self, name: &str) -> Result<f64, String> {
        self.binding
            .parameters
            .get(name)
            .and_then(Value::as_f64)
            .ok_or_else(|| self.parameter_error(name, "numeric"))
    }
    pub fn boolean(&mut self, name: &str) -> Result<bool, String> {
        self.binding
            .parameters
            .get(name)
            .and_then(Value::as_bool)
            .ok_or_else(|| self.parameter_error(name, "boolean"))
    }
    pub fn emit(&mut self, signal: &str, arguments: Vec<Value>) -> Result<(), String> {
        let alias = self
            .binding
            .events
            .iter()
            .find(|event| event.signal == signal)
            .map(|event| event.event.clone());
        if alias.is_none()
            || arguments.len() > 4
            || !arguments.iter().all(scalar)
            || self.emitted_before + self.emissions.len() >= 64
        {
            return Err(self.fail(
                "runtime_behavior_signal",
                "Undeclared signal, invalid scalar arguments, or emission budget exceeded.".into(),
                None,
            ));
        }
        let alias = alias.unwrap();
        // JSON escaping can expand four individually bounded strings beyond a
        // neutral reader line. Admit the exact frame, including its prefix/LF.
        let frame = json!({"protocol":3,"event":"behavior","bindingId":self.binding.binding_id,
            "instanceId":self.binding.instance_id,"objectId":self.binding.object_id,
            "name":alias,"arguments":arguments});
        if serde_json::to_vec(&frame).map_or(true, |bytes| {
            bytes.len() + b"VIENTO_RUNTIME:\n".len() > 65536
        }) {
            return Err(self.fail(
                "runtime_behavior_signal",
                "Serialized signal exceeds the runtime frame byte budget.".into(),
                None,
            ));
        }
        self.emissions.push((alias, arguments));
        Ok(())
    }
}

#[derive(Clone, Component)]
struct Identity {
    order: usize,
    instance_id: String,
    object_id: String,
}
#[derive(Component)]
struct Position([f64; 2]);
#[derive(Component)]
struct Motion {
    speed: f64,
    arrows: bool,
    moving: bool,
}
#[derive(Resource, Default)]
struct Input {
    right: bool,
    delta: f64,
}
#[derive(Resource, Default)]
struct FixedClock(u64);
#[derive(Clone, Component)]
struct BehaviorBinding {
    order: usize,
    declaration: Binding,
    fixed_update: Option<FixedUpdateCallback>,
    emitted: usize,
    ready_completed: bool,
}

fn movement(input: Res<Input>, mut actors: Query<(&mut Position, &Motion)>) {
    for (mut position, motion) in &mut actors {
        if input.right && motion.arrows && motion.speed > 0.0 {
            position.0[0] += motion.speed * input.delta;
        }
    }
}
fn app(scene: &SceneData) -> App {
    let mut app = App::new();
    app.add_plugins(MinimalPlugins)
        .init_resource::<Input>()
        .init_resource::<FixedClock>()
        .add_systems(Update, movement);
    for (order, actor) in scene.actors.iter().enumerate() {
        app.world_mut().spawn((
            Identity {
                order,
                instance_id: actor.instance_id.clone(),
                object_id: actor.object_id.clone(),
            },
            Position(actor.position),
            Motion {
                speed: actor.speed,
                arrows: actor.controls == "arrows",
                moving: false,
            },
        ));
    }
    for (order, binding) in scene.bindings.iter().enumerate() {
        app.world_mut().spawn(BehaviorBinding {
            order,
            declaration: binding.clone(),
            fixed_update: None,
            emitted: 0,
            ready_completed: false,
        });
    }
    app
}
fn states(app: &mut App) -> Vec<Value> {
    let world = app.world_mut();
    let mut query = world.query::<(&Identity, &Position, &Motion)>();
    let mut actors: Vec<_> = query.iter(world).map(|(id, position, motion)| (id.order, json!({
        "instanceId":id.instance_id,"objectId":id.object_id,"position":position.0,"state":if motion.moving {"moving"} else {"idle"}
    }))).collect();
    actors.sort_by_key(|(order, _)| *order);
    actors.into_iter().map(|(_, state)| state).collect()
}
fn emit(event: &str, mut value: Value) -> Result<(), String> {
    value["protocol"] = json!(3);
    value["event"] = json!(event);
    let mut stdout = io::stdout().lock();
    writeln!(stdout, "VIENTO_RUNTIME:{value}")
        .and_then(|_| stdout.flush())
        .map_err(|_| "Cannot write runtime frame.".into())
}
#[derive(Debug)]
struct OwnedFailure {
    binding: Binding,
    failure: Failure,
}
fn ordered_bindings(app: &mut App) -> Vec<Entity> {
    let world = app.world_mut();
    let mut query = world.query::<(Entity, &BehaviorBinding)>();
    let mut bindings: Vec<_> = query
        .iter(world)
        .map(|(entity, binding)| (binding.order, entity))
        .collect();
    bindings.sort_by_key(|(order, _)| *order);
    bindings.into_iter().map(|(_, entity)| entity).collect()
}

/// Run one callback without exposing the ECS world to author code. Nothing is
/// committed until all host API calls and the callback itself have succeeded.
fn call_binding(
    app: &mut App,
    entity: Entity,
    lifecycle: Lifecycle,
    callback: impl FnOnce(&mut BehaviorContext<'_>) -> Result<(), String>,
) -> Result<Vec<Value>, Box<OwnedFailure>> {
    let runtime = app.world().get::<BehaviorBinding>(entity).unwrap().clone();
    let binding = &runtime.declaration;
    let world = app.world_mut();
    let mut query = world.query::<(Entity, &Identity, &Position)>();
    let (actor, position) = query
        .iter(world)
        .find(|(_, identity, _)| identity.instance_id == binding.instance_id)
        .map(|(entity, _, position)| (entity, position.0))
        .expect("Validated binding must reference its ECS actor.");
    let mut context = BehaviorContext::new(binding, position, lifecycle, runtime.emitted);
    if (lifecycle == Lifecycle::Ready && runtime.ready_completed)
        || (lifecycle == Lifecycle::FixedUpdate && !runtime.ready_completed)
    {
        context.fail(
            "runtime_behavior_lifecycle",
            "A binding must finish ready once before its fixed updates.".into(),
            None,
        );
    } else {
        let called =
            std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| callback(&mut context)));
        match called {
            Ok(Ok(())) => {}
            Ok(Err(message)) => {
                context.fail("runtime_behavior_script", message, None);
            }
            Err(_) => {
                context.fail(
                    "runtime_behavior_panic",
                    "Rust behavior callback panicked.".into(),
                    None,
                );
            }
        }
    }
    if let Some(failure) = context.failure {
        return Err(Box::new(OwnedFailure {
            binding: binding.clone(),
            failure,
        }));
    }
    world.get_mut::<Position>(actor).unwrap().0 = context.position;
    let mut committed = world.get_mut::<BehaviorBinding>(entity).unwrap();
    committed.emitted += context.emissions.len();
    if lifecycle == Lifecycle::Ready {
        committed.fixed_update = context.fixed_update;
        committed.ready_completed = true;
    }
    Ok(context
        .emissions
        .into_iter()
        .map(|(name, arguments)| {
            json!({"bindingId":binding.binding_id,"instanceId":binding.instance_id,
            "objectId":binding.object_id,"name":name,"arguments":arguments})
        })
        .collect())
}
fn report_failure(
    owned: OwnedFailure,
    output: &mut impl FnMut(&str, Value) -> Result<(), String>,
) -> Result<(), String> {
    let OwnedFailure { binding, failure } = owned;
    let mut diagnostic = json!({"severity":"error","code":failure.code,
        "message":failure.message.chars().take(1024).collect::<String>(),"bindingId":binding.binding_id,
        "instanceId":binding.instance_id,"objectId":binding.object_id});
    if let Some(parameter) = failure.parameter {
        diagnostic["parameter"] = json!(parameter);
    }
    output("diagnostic", diagnostic)?;
    Err("Rust behavior callback failed.".into())
}
fn run_behaviors(app: &mut App) -> Result<(), String> {
    for entity in ordered_bindings(app) {
        let source = app
            .world()
            .get::<BehaviorBinding>(entity)
            .unwrap()
            .declaration
            .implementation
            .source_object_id
            .clone();
        match call_binding(app, entity, Lifecycle::Ready, |context| {
            crate::behavior_sources::ready(&source, context)
        }) {
            Ok(events) => {
                for event in events {
                    emit("behavior", event)?;
                }
            }
            Err(owned) => return report_failure(*owned, &mut emit),
        }
    }
    Ok(())
}
fn update_with(
    app: &mut App,
    right: bool,
    delta: f64,
    output: &mut impl FnMut(&str, Value) -> Result<(), String>,
) -> Result<(), String> {
    let before: HashMap<_, _> = {
        let world = app.world_mut();
        let mut query = world.query::<(Entity, &Position)>();
        query
            .iter(world)
            .map(|(entity, position)| (entity, position.0))
            .collect()
    };
    let step = FixedStep {
        tick: app.world().resource::<FixedClock>().0,
        delta_seconds: delta,
    };
    *app.world_mut().resource_mut::<Input>() = Input { right, delta };
    // The built-in ECS motion runs first. Bound callbacks then observe each
    // earlier successful commit, in author manifest order, even on one actor.
    app.update();
    for entity in ordered_bindings(app) {
        let callback = app
            .world()
            .get::<BehaviorBinding>(entity)
            .unwrap()
            .fixed_update;
        if let Some(callback) = callback {
            match call_binding(app, entity, Lifecycle::FixedUpdate, |context| {
                callback(context, step)
            }) {
                Ok(events) => {
                    for event in events {
                        output("behavior", event)?;
                    }
                }
                Err(owned) => return report_failure(*owned, output),
            }
        }
    }
    // State reflects the complete step, including authored motion and exact
    // cancellation of built-in motion. Merely writing a position is not motion.
    let mut changes = Vec::new();
    let world = app.world_mut();
    let mut query = world.query::<(Entity, &Identity, &Position, &mut Motion)>();
    for (entity, identity, position, mut motion) in query.iter_mut(world) {
        let moving = position.0 != before[&entity];
        if moving != motion.moving {
            motion.moving = moving;
            changes.push((identity.clone(), moving));
        }
    }
    changes.sort_by_key(|(identity, _)| identity.order);
    for (id, moving) in changes {
        output(
            "state",
            json!({"instanceId":id.instance_id,"objectId":id.object_id,"state":if moving {"moving"} else {"idle"}}),
        )?;
    }
    world.resource_mut::<FixedClock>().0 = step
        .tick
        .checked_add(1)
        .ok_or("Fixed step clock overflow.")?;
    Ok(())
}
fn update(app: &mut App, right: bool, delta: f64) -> Result<(), String> {
    update_with(app, right, delta, &mut emit)
}
fn run_scene(path: &Path, check: bool, smoke: bool) -> Result<(), String> {
    let scene = read_scene(path)?;
    if check {
        return Ok(());
    }
    let mut app = app(&scene);
    emit(
        "ready",
        json!({"sceneObjectId":scene.scene.object_id,"actors":states(&mut app)}),
    )?;
    run_behaviors(&mut app)?;
    if smoke {
        update(&mut app, true, 0.25)?;
        update(&mut app, false, 0.25)?;
        emit(
            "finished",
            json!({"actors":states(&mut app),"fixedDelta":0.25}),
        )?;
        return Ok(());
    }
    loop {
        update(&mut app, false, 1.0 / 60.0)?;
        thread::sleep(Duration::from_secs_f64(1.0 / 60.0));
    }
}
pub fn execute() -> Result<(), String> {
    let args: Vec<_> = std::env::args_os().skip(1).collect();
    if args.len() == 1 && args[0] == "--version" {
        println!("{VERSION}");
        return Ok(());
    }
    let (mut path, mut check, mut smoke) = (None, false, false);
    let mut index = 0;
    while index < args.len() {
        if args[index] == "--scene" && path.is_none() && index + 1 < args.len() {
            index += 1;
            path = Some(std::path::PathBuf::from(&args[index]));
        } else if args[index] == "--check" && !check {
            check = true;
        } else if args[index] == "--smoke" && !smoke {
            smoke = true;
        } else {
            return Err("Invalid Rust behavior runtime arguments.".into());
        }
        index += 1;
    }
    if smoke && check {
        return Err("Choose check or smoke execution.".into());
    }
    run_scene(
        &path.ok_or("Expected an absolute --scene path.")?,
        check,
        smoke,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    fn binding() -> Binding {
        Binding {
            binding_id: "77777777-7777-4777-8777-777777777777".into(),
            instance_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1".into(),
            object_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa".into(),
            implementation: Implementation {
                backend_id: "org.viento.bevy-rust".into(),
                language: "rust".into(),
                source_object_id: "99999999-9999-4999-8999-999999999999".into(),
            },
            parameters: HashMap::from([
                ("checkpoint".into(), json!("east")),
                ("amount".into(), json!(40)),
                ("enabled".into(), json!(true)),
            ]),
            events: vec![Signal {
                signal: "checkpoint".into(),
                event: "arrived".into(),
            }],
        }
    }
    #[test]
    fn api_keeps_scalar_types_and_maps_declared_aliases() {
        let binding = binding();
        let mut context = BehaviorContext::new(&binding, [0.0, 0.0], Lifecycle::Ready, 0);
        assert_eq!(context.string("checkpoint").unwrap(), "east");
        assert_eq!(context.number("amount").unwrap(), 40.0);
        assert!(context.boolean("enabled").unwrap());
        context
            .emit(
                "checkpoint",
                vec![json!("east"), json!(40), json!(true), json!(1.5)],
            )
            .unwrap();
        assert_eq!(context.emissions[0].0, "arrived");
        assert!(context.failure.is_none());
    }
    #[test]
    fn api_refuses_undeclared_non_scalar_and_over_budget_signals() {
        for arguments in [
            vec![Value::Null],
            vec![json!({})],
            vec![json!(1); 5],
            vec![json!(9007199254740992_u64)],
        ] {
            let binding = binding();
            let mut context = BehaviorContext::new(&binding, [0.0, 0.0], Lifecycle::Ready, 0);
            assert!(context.emit("checkpoint", arguments).is_err());
            assert!(context.emissions.is_empty());
        }
        let binding = binding();
        let mut context = BehaviorContext::new(&binding, [0.0, 0.0], Lifecycle::Ready, 0);
        assert!(context.emit("other", vec![]).is_err());
        let mut context = BehaviorContext::new(&binding, [0.0, 0.0], Lifecycle::Ready, 0);
        for _ in 0..64 {
            context.emit("checkpoint", vec![]).unwrap();
        }
        assert!(context.emit("checkpoint", vec![]).is_err());
    }
    #[test]
    fn serialized_signal_budget_accounts_for_json_escaping_and_identity_envelope() {
        let binding = binding();
        let mut context = BehaviorContext::new(&binding, [0.0, 0.0], Lifecycle::Ready, 0);
        context
            .emit("checkpoint", vec![json!("\0".repeat(4096)); 2])
            .unwrap();
        assert_eq!(context.emissions.len(), 1);
        assert!(
            context
                .emit("checkpoint", vec![json!("\0".repeat(4096)); 4])
                .is_err()
        );
        assert_eq!(context.emissions.len(), 1);
        assert_eq!(context.failure.unwrap().code, "runtime_behavior_signal");
        let mut context = BehaviorContext::new(&binding, [0.0, 0.0], Lifecycle::Ready, 0);
        context
            .emit("checkpoint", vec![json!("字".repeat(4096)); 4])
            .unwrap();
    }
    #[test]
    fn ignored_parameter_errors_remain_binding_owned_failures() {
        let binding = binding();
        let mut context = BehaviorContext::new(&binding, [0.0, 0.0], Lifecycle::Ready, 0);
        assert!(context.number("checkpoint").is_err());
        let failure = context.failure.unwrap();
        assert_eq!(failure.parameter.as_deref(), Some("checkpoint"));
        let mut context = BehaviorContext::new(&binding, [0.0, 0.0], Lifecycle::Ready, 0);
        assert!(context.string("missing").is_err());
        assert!(context.failure.unwrap().parameter.is_none());
    }
    #[test]
    fn text_budget_counts_utf16_and_rejects_unsafe_integer_values() {
        assert!(scalar(&json!("x".repeat(4096))));
        assert!(!scalar(&json!("😀".repeat(2049))));
        assert!(scalar(&json!(9007199254740991_u64)));
        assert!(!scalar(&json!(9007199254740992_u64)));
        assert!(name("constructor"));
        assert!(!name("9bad"));
        assert!(!uuid("../outside"));
    }
    fn scene(bindings: Vec<Binding>) -> SceneData {
        let mut actors = Vec::new();
        for binding in &bindings {
            if actors
                .iter()
                .any(|actor: &ActorDeclaration| actor.instance_id == binding.instance_id)
            {
                continue;
            }
            actors.push(ActorDeclaration {
                instance_id: binding.instance_id.clone(),
                object_id: binding.object_id.clone(),
                position: [10.0, 20.0],
                size: [16.0, 16.0],
                color: "#112233".into(),
                speed: 40.0,
                controls: "arrows".into(),
            });
        }
        SceneData {
            format: "viento-bevy-rust-scene".into(),
            schema_version: 1,
            scene: SceneDeclaration {
                object_id: "11111111-1111-4111-8111-111111111111".into(),
                title: "Fixed behaviors".into(),
                viewport: [800, 600],
                background: "#112233".into(),
            },
            actors,
            resources: vec![],
            sources: vec![],
            bindings,
        }
    }
    fn idle(_: &mut BehaviorContext<'_>, _: FixedStep) -> Result<(), String> {
        Ok(())
    }
    fn step(app: &mut App, right: bool) -> (Result<(), String>, Vec<(String, Value)>) {
        let mut events = Vec::new();
        let result = update_with(app, right, 0.25, &mut |name, value| {
            events.push((name.to_owned(), value));
            Ok(())
        });
        (result, events)
    }
    fn register(app: &mut App, entity: Entity, callback: FixedUpdateCallback) {
        call_binding(app, entity, Lifecycle::Ready, |ctx| {
            ctx.on_fixed_update(callback)
        })
        .unwrap();
    }
    fn move_and_observe(ctx: &mut BehaviorContext<'_>, step: FixedStep) -> Result<(), String> {
        let before = ctx.position()[0];
        let amount = ctx.number("amount")?;
        ctx.translate([amount, 0.0])?;
        ctx.emit(
            "checkpoint",
            vec![
                json!(before),
                json!(ctx.position()[0]),
                json!(step.tick),
                json!(step.delta_seconds),
            ],
        )
    }
    #[test]
    fn old_ready_only_behavior_preserves_builtin_motion_and_state_transitions() {
        let mut app = app(&scene(vec![binding()]));
        let entity = ordered_bindings(&mut app)[0];
        let ready = call_binding(&mut app, entity, Lifecycle::Ready, |ctx| {
            ctx.emit("checkpoint", vec![json!("ready")])
        })
        .unwrap();
        assert_eq!(ready.len(), 1);
        assert!(
            app.world()
                .get::<BehaviorBinding>(entity)
                .unwrap()
                .fixed_update
                .is_none()
        );
        let (result, events) = step(&mut app, true);
        result.unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].0, "state");
        assert_eq!(events[0].1["state"], "moving");
        let (result, events) = step(&mut app, false);
        result.unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].1["state"], "idle");
        assert_eq!(states(&mut app)[0]["position"], json!([20.0, 20.0]));
        assert_eq!(app.world().resource::<FixedClock>().0, 2);
    }
    #[test]
    fn ready_can_commit_position_and_sees_its_own_pending_writes() {
        let mut app = app(&scene(vec![binding()]));
        let entity = ordered_bindings(&mut app)[0];
        call_binding(&mut app, entity, Lifecycle::Ready, |ctx| {
            assert_eq!(ctx.position(), [10.0, 20.0]);
            ctx.set_position([-10.0, 30.0])?;
            ctx.translate([2.0, -3.0])?;
            assert_eq!(ctx.position(), [-8.0, 27.0]);
            ctx.on_fixed_update(idle)
        })
        .unwrap();
        assert_eq!(states(&mut app)[0]["position"], json!([-8.0, 27.0]));
        assert_eq!(states(&mut app)[0]["state"], "idle");
    }
    #[test]
    fn callback_order_observes_builtin_motion_and_previous_binding_commits() {
        let mut first = binding();
        first.parameters.insert("amount".into(), json!(1));
        let mut second = first.clone();
        second.binding_id = "77777777-7777-4777-8777-777777777778".into();
        second.parameters.insert("amount".into(), json!(2));
        let mut third = first.clone();
        third.binding_id = "77777777-7777-4777-8777-777777777779".into();
        third.instance_id = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2".into();
        third.parameters.insert("amount".into(), json!(3));
        let mut app = app(&scene(vec![first, second, third]));
        for entity in ordered_bindings(&mut app) {
            register(&mut app, entity, move_and_observe);
        }
        let (result, events) = step(&mut app, true);
        result.unwrap();
        assert_eq!(events.len(), 5);
        assert_eq!(events[0].1["arguments"], json!([20.0, 21.0, 0, 0.25]));
        assert_eq!(events[1].1["arguments"], json!([21.0, 23.0, 0, 0.25]));
        assert_eq!(events[2].1["arguments"], json!([20.0, 23.0, 0, 0.25]));
        assert!(
            events[3..]
                .iter()
                .all(|(name, value)| name == "state" && value["state"] == "moving")
        );
        let (result, events) = step(&mut app, false);
        result.unwrap();
        assert_eq!(events.len(), 3);
        assert_eq!(events[0].1["arguments"], json!([23.0, 24.0, 1, 0.25]));
        assert_eq!(events[1].1["arguments"], json!([24.0, 26.0, 1, 0.25]));
        assert_eq!(events[2].1["arguments"], json!([23.0, 26.0, 1, 0.25]));
        assert!(
            states(&mut app)
                .iter()
                .all(|actor| actor["position"] == json!([26.0, 20.0]))
        );
    }
    #[test]
    fn author_motion_without_input_sets_moving_state() {
        let mut app = app(&scene(vec![binding()]));
        let entity = ordered_bindings(&mut app)[0];
        register(&mut app, entity, move_and_observe);
        let (result, events) = step(&mut app, false);
        result.unwrap();
        assert_eq!(events[1].1["state"], "moving");
        assert_eq!(states(&mut app)[0]["position"], json!([50.0, 20.0]));
    }
    #[test]
    fn cancelled_builtin_displacement_keeps_actor_idle() {
        fn cancel(ctx: &mut BehaviorContext<'_>, step: FixedStep) -> Result<(), String> {
            if step.tick == 0 {
                ctx.translate([-40.0 * step.delta_seconds, 0.0])?;
            }
            Ok(())
        }
        let mut app = app(&scene(vec![binding()]));
        let entity = ordered_bindings(&mut app)[0];
        register(&mut app, entity, cancel);
        for right in [true, false] {
            let (result, events) = step(&mut app, right);
            result.unwrap();
            assert!(events.is_empty());
        }
        assert_eq!(states(&mut app)[0]["position"], json!([10.0, 20.0]));
        assert_eq!(states(&mut app)[0]["state"], "idle");
    }
    #[test]
    fn error_panic_or_ignored_api_error_rolls_back_the_entire_callback() {
        for mode in 0..4 {
            let mut app = app(&scene(vec![binding()]));
            let entity = ordered_bindings(&mut app)[0];
            let error = call_binding(&mut app, entity, Lifecycle::Ready, |ctx| {
                ctx.set_position([99.0, 99.0])?;
                ctx.on_fixed_update(idle)?;
                ctx.emit("checkpoint", vec![json!("uncommitted")])?;
                match mode {
                    0 => Err("author error".into()),
                    1 => panic!("author panic"),
                    2 => {
                        let _ = ctx.number("checkpoint");
                        Ok(())
                    }
                    _ => {
                        let _ = ctx.set_position([f64::NAN, 0.0]);
                        Ok(())
                    }
                }
            })
            .unwrap_err();
            assert_eq!(
                error.failure.code,
                [
                    "runtime_behavior_script",
                    "runtime_behavior_panic",
                    "runtime_behavior_parameter",
                    "runtime_behavior_position"
                ][mode]
            );
            assert_eq!(states(&mut app)[0]["position"], json!([10.0, 20.0]));
            let runtime = app.world().get::<BehaviorBinding>(entity).unwrap();
            assert!(runtime.fixed_update.is_none());
            assert!(!runtime.ready_completed);
            assert_eq!(runtime.emitted, 0);
        }
    }
    #[test]
    fn duplicate_or_late_registration_is_sticky_and_transactional() {
        let mut app = app(&scene(vec![binding()]));
        let entity = ordered_bindings(&mut app)[0];
        let error = call_binding(&mut app, entity, Lifecycle::Ready, |ctx| {
            ctx.on_fixed_update(idle)?;
            let _ = ctx.on_fixed_update(move_and_observe);
            ctx.translate([5.0, 0.0])?;
            Ok(())
        })
        .unwrap_err();
        assert_eq!(error.failure.code, "runtime_behavior_lifecycle");
        register(&mut app, entity, idle);
        let error = call_binding(&mut app, entity, Lifecycle::FixedUpdate, |ctx| {
            ctx.translate([8.0, 0.0])?;
            let _ = ctx.on_fixed_update(move_and_observe);
            Ok(())
        })
        .unwrap_err();
        assert_eq!(error.failure.code, "runtime_behavior_lifecycle");
        assert_eq!(states(&mut app)[0]["position"], json!([10.0, 20.0]));
        assert!(
            app.world()
                .get::<BehaviorBinding>(entity)
                .unwrap()
                .fixed_update
                .is_some()
        );
    }
    #[test]
    fn ready_runs_once_and_fixed_cannot_run_before_ready() {
        let mut app = app(&scene(vec![binding()]));
        let entity = ordered_bindings(&mut app)[0];
        let error = call_binding(&mut app, entity, Lifecycle::FixedUpdate, |_| {
            panic!("must not call")
        })
        .unwrap_err();
        assert_eq!(error.failure.code, "runtime_behavior_lifecycle");
        register(&mut app, entity, idle);
        let error = call_binding(&mut app, entity, Lifecycle::Ready, |_| {
            panic!("must not call")
        })
        .unwrap_err();
        assert_eq!(error.failure.code, "runtime_behavior_lifecycle");
    }
    #[test]
    fn coordinate_commands_reject_nonfinite_overflow_and_out_of_range_values() {
        let binding = binding();
        for position in [
            [f64::NAN, 0.0],
            [f64::INFINITY, 0.0],
            [0.0, f64::NEG_INFINITY],
            [100000.1, 0.0],
            [0.0, -100000.1],
        ] {
            let mut ctx = BehaviorContext::new(&binding, [10.0, 20.0], Lifecycle::Ready, 0);
            assert!(ctx.set_position(position).is_err());
            assert_eq!(ctx.position(), [10.0, 20.0]);
            assert_eq!(ctx.failure.unwrap().code, "runtime_behavior_position");
        }
        let mut ctx = BehaviorContext::new(&binding, [f64::MAX, 0.0], Lifecycle::Ready, 0);
        assert!(ctx.translate([f64::MAX, 0.0]).is_err());
        let mut ctx = BehaviorContext::new(&binding, [0.0, 0.0], Lifecycle::Ready, 0);
        ctx.set_position([-100000.0, 100000.0]).unwrap();
    }
    #[test]
    fn passive_callback_does_not_reject_builtin_motion_outside_author_write_range() {
        let mut scene = scene(vec![binding()]);
        scene.actors[0].position = [100000.0, 0.0];
        let mut app = app(&scene);
        let entity = ordered_bindings(&mut app)[0];
        register(&mut app, entity, idle);
        let (result, _) = step(&mut app, true);
        result.unwrap();
        assert_eq!(states(&mut app)[0]["position"], json!([100010.0, 0.0]));
    }
    #[test]
    fn event_limit_is_cumulative_across_ready_and_all_fixed_steps() {
        fn emit_one(ctx: &mut BehaviorContext<'_>, _: FixedStep) -> Result<(), String> {
            ctx.translate([1.0, 0.0])?;
            let _ = ctx.emit("checkpoint", vec![]);
            Ok(())
        }
        let mut app = app(&scene(vec![binding()]));
        let entity = ordered_bindings(&mut app)[0];
        let ready = call_binding(&mut app, entity, Lifecycle::Ready, |ctx| {
            for _ in 0..63 {
                ctx.emit("checkpoint", vec![])?;
            }
            ctx.on_fixed_update(emit_one)
        })
        .unwrap();
        assert_eq!(ready.len(), 63);
        let (result, events) = step(&mut app, false);
        result.unwrap();
        assert_eq!(events[0].0, "behavior");
        assert_eq!(
            app.world().get::<BehaviorBinding>(entity).unwrap().emitted,
            64
        );
        assert_eq!(states(&mut app)[0]["position"], json!([11.0, 20.0]));
        let (result, events) = step(&mut app, false);
        assert!(result.is_err());
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].0, "diagnostic");
        assert_eq!(events[0].1["code"], "runtime_behavior_signal");
        assert_eq!(
            app.world().get::<BehaviorBinding>(entity).unwrap().emitted,
            64
        );
        assert_eq!(states(&mut app)[0]["position"], json!([11.0, 20.0]));
    }
    #[test]
    fn later_failure_keeps_prior_binding_commit_and_owns_its_diagnostic() {
        fn fail(ctx: &mut BehaviorContext<'_>, _: FixedStep) -> Result<(), String> {
            ctx.translate([1000.0, 0.0])?;
            ctx.emit("checkpoint", vec![json!("discard")])?;
            let _ = ctx.boolean("amount");
            Ok(())
        }
        let first = binding();
        let mut second = first.clone();
        second.binding_id = "77777777-7777-4777-8777-777777777778".into();
        let mut app = app(&scene(vec![first, second.clone()]));
        let bindings = ordered_bindings(&mut app);
        register(&mut app, bindings[0], move_and_observe);
        register(&mut app, bindings[1], fail);
        let (result, events) = step(&mut app, true);
        assert!(result.is_err());
        assert_eq!(events.len(), 2);
        assert_eq!(events[0].0, "behavior");
        assert_eq!(events[1].0, "diagnostic");
        assert_eq!(events[1].1["bindingId"], second.binding_id);
        assert_eq!(events[1].1["instanceId"], second.instance_id);
        assert_eq!(events[1].1["parameter"], "amount");
        assert_eq!(events[1].1["code"], "runtime_behavior_parameter");
        assert_eq!(states(&mut app)[0]["position"], json!([60.0, 20.0]));
        assert_eq!(
            app.world()
                .get::<BehaviorBinding>(bindings[0])
                .unwrap()
                .emitted,
            1
        );
        assert_eq!(
            app.world()
                .get::<BehaviorBinding>(bindings[1])
                .unwrap()
                .emitted,
            0
        );
    }
}
