use serde_json::Value;
use std::io::Write;
use std::process::{Command, Stdio};
use viento_studio_core::MAX_INPUT_BYTES;

#[test]
fn native_json_lines_recovers_after_bad_json_and_an_oversized_line() {
    let mut child = Command::new(env!("CARGO_BIN_EXE_viento-core"))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    let mut input = child.stdin.take().unwrap();
    input.write_all(b"{\n").unwrap();
    input.write_all(&vec![b' '; MAX_INPUT_BYTES + 1]).unwrap();
    input.write_all(b"\n").unwrap();
    // The final line intentionally has no trailing newline.
    input
        .write_all(br#"{"protocolVersion":1,"operation":"validateBatch","actors":[],"changes":[]}"#)
        .unwrap();
    drop(input);
    let output = child.wait_with_output().unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let lines = String::from_utf8(output.stdout).unwrap();
    let responses: Vec<Value> = lines
        .lines()
        .map(|line| serde_json::from_str(line).unwrap())
        .collect();
    assert_eq!(responses.len(), 3);
    assert_eq!(responses[0]["errorCode"], "studio_core_request_invalid");
    assert_eq!(responses[1]["errorCode"], "studio_core_input_limit");
    assert_eq!(responses[2]["ok"], true);
    assert_eq!(responses[2]["changes"], serde_json::json!([]));
}

#[test]
fn native_json_lines_share_draft_history_until_explicit_close() {
    use serde_json::json;
    let mut child = Command::new(env!("CARGO_BIN_EXE_viento-core"))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    let mut input = child.stdin.take().unwrap();
    for request in [
        json!({"protocolVersion":1,"operation":"layoutDraft.create","actors":[{"objectId":"a","position":[0.0,0.0]}]}),
        json!({"protocolVersion":1,"operation":"layoutDraft.setPositions","draftId":"1","changes":[{"objectId":"a","position":[3.0,4.0]}]}),
        json!({"protocolVersion":1,"operation":"layoutDraft.undo","draftId":"1"}),
        json!({"protocolVersion":1,"operation":"layoutDraft.read","draftId":"1"}),
        json!({"protocolVersion":1,"operation":"layoutDraft.redo","draftId":"1"}),
        json!({"protocolVersion":1,"operation":"layoutDraft.close","draftId":"1"}),
        json!({"protocolVersion":1,"operation":"layoutDraft.read","draftId":"1"}),
    ] {
        serde_json::to_writer(&mut input, &request).unwrap();
        input.write_all(b"\n").unwrap();
    }
    drop(input);
    let output = child.wait_with_output().unwrap();
    assert!(output.status.success());
    let lines = String::from_utf8(output.stdout).unwrap();
    let responses: Vec<Value> = lines
        .lines()
        .map(|line| serde_json::from_str(line).unwrap())
        .collect();
    assert_eq!(responses.len(), 7);
    assert_eq!(responses[0]["draft"]["draftId"], "1");
    assert_eq!(responses[1]["draft"]["state"]["canUndo"], true);
    assert_eq!(
        responses[2]["draft"]["positions"][0]["position"],
        json!([0.0, 0.0])
    );
    assert_eq!(responses[3]["draft"]["state"]["canRedo"], true);
    assert_eq!(
        responses[4]["draft"]["positions"][0]["position"],
        json!([3.0, 4.0])
    );
    assert_eq!(responses[5]["draft"]["closed"], true);
    assert_eq!(responses[6]["errorCode"], "scene_layout_draft_invalid");
}
