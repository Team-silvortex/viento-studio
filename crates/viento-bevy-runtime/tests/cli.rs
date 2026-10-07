use serde_json::{Value, json};
use std::{
    env, fs,
    io::{BufRead, BufReader, Read},
    path::PathBuf,
    process::{Child, Command, Output, Stdio},
    sync::{
        atomic::{AtomicU64, Ordering},
        mpsc,
    },
    thread,
    time::Duration,
};

const BINARY: &str = env!("CARGO_BIN_EXE_viento-bevy-runtime");
const OBJECT: &str = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const FIRST: &str = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
const SECOND: &str = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2";

struct Fixture(PathBuf);
impl Fixture {
    fn new(version: u8) -> Self {
        static NEXT: AtomicU64 = AtomicU64::new(0);
        let path = env::temp_dir().join(format!(
            "viento-bevy-cli-test-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir(&path).unwrap();
        let mut actor = json!({"objectId":OBJECT,"position":[100,200],"size":[32,48],"color":"#80d0a0","speed":160,"controls":"arrows"});
        let actors = if version == 2 {
            actor["instanceId"] = json!(FIRST);
            let mut idle = actor.clone();
            idle["instanceId"] = json!(SECOND);
            idle["controls"] = json!("none");
            idle["speed"] = json!(200);
            json!([actor, idle])
        } else {
            json!([actor])
        };
        fs::write(path.join("scene-data.json"), json!({"format":"viento-bevy-scene","schemaVersion":version,
            "scene":{"objectId":"dddddddd-dddd-4ddd-8ddd-dddddddddddd","title":"CLI fixture","viewport":[640,480],"background":"#0c1725"},
            "actors":actors,"resources":[]}).to_string()).unwrap();
        Self(path)
    }
    fn run(&self, argument: &str) -> Output {
        Command::new(BINARY)
            .args(["--scene"])
            .arg(self.0.join("scene-data.json"))
            .arg(argument)
            .output()
            .unwrap()
    }
    fn bytes(&self) -> Vec<u8> {
        fs::read(self.0.join("scene-data.json")).unwrap()
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn frames(output: &Output) -> Vec<Value> {
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(output.stderr.is_empty());
    String::from_utf8(output.stdout.clone())
        .unwrap()
        .lines()
        .map(|line| {
            serde_json::from_str(
                line.strip_prefix("VIENTO_RUNTIME:")
                    .expect("stdout must contain only runtime frames"),
            )
            .unwrap()
        })
        .collect()
}

#[test]
fn trusted_tool_identity_is_exact_and_metadata_has_no_execution_claims() {
    let version = Command::new(BINARY).arg("--version").output().unwrap();
    assert!(version.status.success());
    assert!(version.stderr.is_empty());
    assert_eq!(version.stdout, b"viento-bevy-runtime 0.3.0 bevy 0.19.1\n");
    let metadata = Command::new(BINARY).arg("--metadata").output().unwrap();
    assert_eq!(
        serde_json::from_slice::<Value>(&metadata.stdout).unwrap(),
        json!({"runtimeKind":"viento-bevy-runtime","runtimeVersion":"0.3.0","bevyVersion":"0.19.1","protocolVersions":[1,2]})
    );
}

#[test]
fn actual_process_emits_legacy_protocol_with_fixed_movement_and_idle_transition() {
    let fixture = Fixture::new(1);
    let original = fixture.bytes();
    let result = frames(&fixture.run("--smoke"));
    assert_eq!(
        result
            .iter()
            .map(|frame| frame["event"].as_str().unwrap())
            .collect::<Vec<_>>(),
        vec!["ready", "state", "state", "finished"]
    );
    assert!(result.iter().all(|frame| frame["protocol"] == 1));
    assert_eq!(
        result[1],
        json!({"protocol":1,"event":"state","objectId":OBJECT,"state":"moving"})
    );
    assert_eq!(result[2]["state"], "idle");
    assert_eq!(result[3]["actors"][0]["position"], json!([140.0, 200.0]));
    assert_eq!(result[3]["fixedDelta"], 0.25);
    assert!(result[3]["actors"][0].get("instanceId").is_none());
    assert_eq!(fixture.bytes(), original);
}

#[test]
fn actual_process_preserves_two_instance_identities_and_control_settings() {
    let fixture = Fixture::new(2);
    let original = fixture.bytes();
    let result = frames(&fixture.run("--smoke"));
    assert!(result.iter().all(|frame| frame["protocol"] == 2));
    assert_eq!(result.len(), 4);
    assert_eq!(result[1]["instanceId"], FIRST);
    assert_eq!(result[1]["objectId"], OBJECT);
    let actors = result.last().unwrap()["actors"].as_array().unwrap();
    assert_eq!(actors[0]["instanceId"], FIRST);
    assert_eq!(actors[0]["position"], json!([140.0, 200.0]));
    assert_eq!(actors[1]["instanceId"], SECOND);
    assert_eq!(actors[1]["position"], json!([100.0, 200.0]));
    assert!(
        actors
            .iter()
            .all(|actor| actor["state"] == "idle" && actor["objectId"] == OBJECT)
    );
    assert_eq!(fixture.bytes(), original);
}

#[test]
fn scene_check_is_read_only_and_rejects_author_paths_and_unknown_arguments() {
    let fixture = Fixture::new(2);
    let original = fixture.bytes();
    let checked = fixture.run("--check");
    assert!(checked.status.success());
    assert!(checked.stdout.is_empty());
    assert!(checked.stderr.is_empty());
    assert_eq!(fixture.bytes(), original);
    let mut value: Value = serde_json::from_slice(&original).unwrap();
    value["actors"][0]["sourcePath"] = json!("/untrusted/author.rs");
    fs::write(fixture.0.join("scene-data.json"), value.to_string()).unwrap();
    let invalid = fixture.run("--check");
    assert!(!invalid.status.success());
    assert!(invalid.stdout.is_empty());
    let invalid = fixture.run("--window");
    assert!(!invalid.status.success());
    assert!(invalid.stdout.is_empty());
    let invalid = Command::new(BINARY)
        .args(["--scene", "scene-data.json", "--smoke"])
        .output()
        .unwrap();
    assert!(!invalid.status.success());
    assert!(invalid.stdout.is_empty());
}

struct OwnedChild(Child);
impl Drop for OwnedChild {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

#[test]
fn ordinary_headless_session_can_be_cancelled_without_editing_frozen_data() {
    let fixture = Fixture::new(2);
    let original = fixture.bytes();
    let mut child = OwnedChild(
        Command::new(BINARY)
            .arg("--scene")
            .arg(fixture.0.join("scene-data.json"))
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .unwrap(),
    );
    let output = child.0.stdout.take().unwrap();
    let (sender, receiver) = mpsc::channel();
    let reader = thread::spawn(move || {
        let mut stream = BufReader::new(output);
        let mut ready = String::new();
        stream.read_line(&mut ready).unwrap();
        sender.send(ready).unwrap();
        let mut rest = String::new();
        stream.read_to_string(&mut rest).unwrap();
        rest
    });
    let line = receiver
        .recv_timeout(Duration::from_secs(5))
        .expect("runtime must become ready promptly");
    let ready: Value =
        serde_json::from_str(line.trim().strip_prefix("VIENTO_RUNTIME:").unwrap()).unwrap();
    assert_eq!(ready["event"], "ready");
    thread::sleep(Duration::from_millis(80));
    assert!(child.0.try_wait().unwrap().is_none());
    child.0.kill().unwrap();
    child.0.wait().unwrap();
    assert!(
        reader.join().unwrap().is_empty(),
        "idle session must not flood protocol stdout"
    );
    let mut error = String::new();
    child
        .0
        .stderr
        .take()
        .unwrap()
        .read_to_string(&mut error)
        .unwrap();
    assert!(error.is_empty());
    assert_eq!(fixture.bytes(), original);
}

fn controls() -> Value {
    let input = |left, right, up, down| json!({"left":left,"right":right,"up":up,"down":down});
    json!({"format":"viento-runtime-control","schemaVersion":1,"fixedDelta":0.125,
        "steps":[input(false,true,false,false),input(false,false,true,false),input(true,false,false,false),
            input(false,false,false,true),input(false,true,true,false),input(true,true,true,true),input(false,false,false,false)]})
}

fn replay(fixture: &Fixture, control: &PathBuf, extra: &[&str]) -> Output {
    Command::new(BINARY)
        .arg("--scene")
        .arg(fixture.0.join("scene-data.json"))
        .arg("--control-program")
        .arg(control)
        .args(extra)
        .output()
        .unwrap()
}

#[test]
fn actual_control_replay_emits_complete_ordered_samples_for_both_protocols() {
    for version in [1, 2] {
        let fixture = Fixture::new(version);
        let original = fixture.bytes();
        let path = fixture.0.join("control-program.json");
        let program = controls().to_string();
        fs::write(&path, &program).unwrap();
        let output = replay(&fixture, &path, &["--smoke"]);
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        assert!(output.stderr.is_empty());
        let mut samples = Vec::new();
        let mut runtime = Vec::new();
        for line in String::from_utf8(output.stdout).unwrap().lines() {
            if let Some(frame) = line.strip_prefix("VIENTO_RUNTIME:") {
                runtime.push(serde_json::from_str::<Value>(frame).unwrap());
            } else if let Some(frame) = line.strip_prefix("VIENTO_TRACE:") {
                samples.push(serde_json::from_str::<Value>(frame).unwrap());
            } else {
                panic!("Unexpected runtime stdout");
            }
        }
        assert_eq!(runtime[0]["event"], "ready");
        assert_eq!(runtime.last().unwrap()["event"], "finished");
        assert_eq!(runtime.last().unwrap()["fixedDelta"], 0.125);
        assert_eq!(samples.len(), 7);
        for (index, sample) in samples.iter().enumerate() {
            assert_eq!(sample["format"], "viento-runtime-trace");
            assert_eq!(sample["schemaVersion"], 1);
            assert_eq!(sample["protocolVersion"], version);
            assert_eq!(sample["event"], "sample");
            assert_eq!(sample["stepIndex"], index);
            if version == 2 {
                assert_eq!(sample["actors"][0]["instanceId"], FIRST);
                assert_eq!(sample["actors"][1]["instanceId"], SECOND);
                assert_eq!(sample["actors"][1]["position"], json!([100.0, 200.0]));
                assert_eq!(sample["actors"][1]["state"], "idle");
            }
        }
        assert_eq!(samples[0]["actors"][0]["position"], json!([120.0, 200.0]));
        assert_eq!(samples[1]["actors"][0]["position"], json!([120.0, 180.0]));
        assert_eq!(samples[2]["actors"][0]["position"], json!([100.0, 180.0]));
        assert_eq!(samples[3]["actors"][0]["position"], json!([100.0, 200.0]));
        assert!(
            (samples[4]["actors"][0]["position"][0].as_f64().unwrap()
                - (100.0 + 20.0 * std::f64::consts::FRAC_1_SQRT_2))
                .abs()
                < 1e-12
        );
        assert_eq!(samples[5]["actors"][0]["state"], "idle");
        assert_eq!(
            samples[5]["actors"][0]["position"],
            samples[4]["actors"][0]["position"]
        );
        assert_eq!(
            runtime.last().unwrap()["actors"],
            samples.last().unwrap()["actors"]
        );
        assert_eq!(fixture.bytes(), original);
        assert_eq!(fs::read_to_string(path).unwrap(), program);
    }
}

#[test]
fn native_control_admission_rejects_invalid_mode_paths_schema_and_actor_step_budget() {
    let fixture = Fixture::new(2);
    let path = fixture.0.join("control-program.json");
    fs::write(&path, controls().to_string()).unwrap();
    for extra in [vec![], vec!["--check"], vec!["--smoke", "--check"]] {
        let result = replay(&fixture, &path, &extra);
        assert!(!result.status.success());
        assert!(result.stdout.is_empty());
    }
    for changed in [
        {
            let mut value = controls();
            value["sourcePath"] = json!("author.rs");
            value
        },
        {
            let mut value = controls();
            value["steps"][0]["down"] = json!(1);
            value
        },
        {
            let mut value = controls();
            value["steps"][6]["right"] = json!(true);
            value
        },
        {
            let mut value = controls();
            value["fixedDelta"] = json!(0);
            value
        },
    ] {
        fs::write(&path, changed.to_string()).unwrap();
        let result = replay(&fixture, &path, &["--smoke"]);
        assert!(!result.status.success());
        assert!(result.stdout.is_empty());
    }
    let outside = Fixture::new(2);
    let outside_path = outside.0.join("control-program.json");
    fs::write(&outside_path, controls().to_string()).unwrap();
    let result = replay(&fixture, &outside_path, &["--smoke"]);
    assert!(!result.status.success());
    assert!(result.stdout.is_empty());
    let mut scene: Value = serde_json::from_slice(&fixture.bytes()).unwrap();
    let actor = scene["actors"][0].clone();
    scene["actors"] = json!(
        (0..32)
            .map(|index| {
                let mut actor = actor.clone();
                actor["instanceId"] = json!(format!("bbbbbbbb-bbbb-4bbb-8bbb-{index:012x}"));
                actor
            })
            .collect::<Vec<_>>()
    );
    fs::write(fixture.0.join("scene-data.json"), scene.to_string()).unwrap();
    let mut program = controls();
    program["steps"] = json!(vec![
        json!({"left":false,"right":false,"up":false,"down":false});
        33
    ]);
    fs::write(&path, program.to_string()).unwrap();
    let result = replay(&fixture, &path, &["--smoke"]);
    assert!(!result.status.success());
    assert!(result.stdout.is_empty());
    assert!(String::from_utf8_lossy(&result.stderr).contains("actor-step budget"));
}

fn instance_controls() -> Value {
    let row = |id, left, right, up, down| json!({"instanceId":id,"left":left,"right":right,"up":up,"down":down});
    json!({"format":"viento-runtime-control","schemaVersion":2,"fixedDelta":0.125,"steps":[
        {"inputs":[row(FIRST,false,true,false,false),row(SECOND,true,false,false,false)]},
        {"inputs":[row(FIRST,false,false,true,false)]},{"inputs":[]}]})
}

#[test]
fn actual_instance_replay_preserves_independent_movement_and_empty_step_release() {
    let fixture = Fixture::new(2);
    let mut scene: Value = serde_json::from_slice(&fixture.bytes()).unwrap();
    scene["actors"][1]["controls"] = json!("arrows");
    scene["actors"][1]["speed"] = json!(80);
    scene["actors"][1]["position"] = json!([500, 220]);
    fs::write(fixture.0.join("scene-data.json"), scene.to_string()).unwrap();
    let before = fixture.bytes();
    let path = fixture.0.join("control-program.json");
    let program = instance_controls().to_string();
    fs::write(&path, &program).unwrap();
    let output = replay(&fixture, &path, &["--smoke"]);
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(output.stderr.is_empty());
    let mut samples = Vec::new();
    let mut runtime = Vec::new();
    for line in String::from_utf8(output.stdout).unwrap().lines() {
        if let Some(frame) = line.strip_prefix("VIENTO_TRACE:") {
            samples.push(serde_json::from_str::<Value>(frame).unwrap());
        } else {
            runtime.push(
                serde_json::from_str::<Value>(line.strip_prefix("VIENTO_RUNTIME:").unwrap())
                    .unwrap(),
            );
        }
    }
    assert_eq!(samples.len(), 3);
    assert_eq!(samples[0]["actors"][0]["position"], json!([120.0, 200.0]));
    assert_eq!(samples[0]["actors"][1]["position"], json!([490.0, 220.0]));
    assert_eq!(samples[1]["actors"][0]["position"], json!([120.0, 180.0]));
    assert_eq!(samples[1]["actors"][1]["state"], "idle");
    assert!(
        samples[2]["actors"]
            .as_array()
            .unwrap()
            .iter()
            .all(|actor| actor["state"] == "idle")
    );
    assert_eq!(runtime.first().unwrap()["event"], "ready");
    assert_eq!(
        runtime.last().unwrap()["actors"],
        samples.last().unwrap()["actors"]
    );
    assert_eq!(fixture.bytes(), before);
    assert_eq!(fs::read_to_string(path).unwrap(), program);
}

#[test]
fn native_instance_targets_are_admitted_before_any_ready_frame() {
    let fixture = Fixture::new(2);
    let path = fixture.0.join("control-program.json");
    let before = fixture.bytes();
    for id in [OBJECT, "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"] {
        let mut program = instance_controls();
        program["steps"][0]["inputs"][0]["instanceId"] = json!(id);
        fs::write(&path, program.to_string()).unwrap();
        let output = replay(&fixture, &path, &["--smoke"]);
        assert!(!output.status.success());
        assert!(output.stdout.is_empty());
        assert!(String::from_utf8_lossy(&output.stderr).contains("target instance is missing"));
    }
    let mut duplicate = instance_controls();
    let row = duplicate["steps"][0]["inputs"][0].clone();
    duplicate["steps"][0]["inputs"]
        .as_array_mut()
        .unwrap()
        .push(row);
    fs::write(&path, duplicate.to_string()).unwrap();
    let output = replay(&fixture, &path, &["--smoke"]);
    assert!(!output.status.success());
    assert!(output.stdout.is_empty());
    assert_eq!(fixture.bytes(), before);
    let legacy = Fixture::new(1);
    let path = legacy.0.join("control-program.json");
    fs::write(&path, instance_controls().to_string()).unwrap();
    let output = replay(&legacy, &path, &["--smoke"]);
    assert!(!output.status.success());
    assert!(output.stdout.is_empty());
    assert!(String::from_utf8_lossy(&output.stderr).contains("requires a scene plan version 2"));
}
