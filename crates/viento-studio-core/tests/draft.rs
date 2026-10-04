use serde_json::{json, Value};
use viento_studio_core::{
    dispatch_json, LayoutDraft, LayoutDraftState, PositionChange, LAYOUT_HISTORY_LIMIT,
    MAX_LAYOUT_ACTORS, MAX_LAYOUT_DRAFTS,
};

fn actor(id: impl Into<String>, x: f64, y: f64) -> PositionChange {
    PositionChange {
        object_id: id.into(),
        position: [x, y],
    }
}

fn request(operation: &str, fields: Value) -> Value {
    let mut value = fields.as_object().unwrap().clone();
    value.insert("protocolVersion".into(), json!(1));
    value.insert("operation".into(), json!(operation));
    serde_json::from_slice(&dispatch_json(&serde_json::to_vec(&value).unwrap())).unwrap()
}

fn create(actors: Value) -> String {
    let response = request("layoutDraft.create", json!({"actors":actors}));
    assert_eq!(response["ok"], true, "{response}");
    assert_eq!(response["protocolVersion"], 1);
    assert_eq!(response["draft"]["changed"], false);
    response["draft"]["draftId"].as_str().unwrap().into()
}

fn operate(operation: &str, id: &str) -> Value {
    request(operation, json!({"draftId":id}))
}

fn close(id: &str) {
    assert_eq!(
        operate("layoutDraft.close", id),
        json!({"protocolVersion":1,"ok":true,"draft":{"draftId":id,"closed":true}})
    );
}

#[test]
fn native_draft_owns_atomic_batches_and_independent_snapshots() {
    let initial = vec![actor("b", 20.0, 30.0), actor("a", 0.0, 0.0)];
    let mut draft = LayoutDraft::new(initial.clone()).unwrap();
    assert_eq!(
        draft.state(),
        LayoutDraftState {
            dirty: false,
            can_undo: false,
            can_redo: false
        }
    );
    assert!(!draft.undo().unwrap());
    assert!(!draft.redo().unwrap());
    assert!(!draft.reset().unwrap());
    assert!(draft
        .set_positions(&[actor("a", 100.0, -100.0), actor("b", 7.0, 8.0)])
        .unwrap());
    let edited = vec![actor("b", 7.0, 8.0), actor("a", 100.0, -100.0)];
    assert_eq!(draft.positions(), edited);
    let mut snapshot = draft.positions();
    snapshot[0].position[0] = 200.0;
    assert_eq!(draft.positions(), edited);
    assert!(draft.state().dirty);
    assert!(draft.undo().unwrap());
    assert_eq!(draft.positions(), initial);
    assert!(!draft.state().dirty);
    assert!(!draft.state().can_undo);
    assert!(draft.state().can_redo);
    assert!(draft.redo().unwrap());
    assert_eq!(draft.positions(), edited);
    assert!(draft.reset().unwrap());
    assert_eq!(draft.positions(), initial);
    assert!(!draft.undo().unwrap());
    assert!(!draft.redo().unwrap());
}

#[test]
fn invalid_or_noop_batches_preserve_redo_and_all_positions() {
    let mut draft = LayoutDraft::new(vec![actor("a", 0.0, 0.0), actor("b", 1.0, 1.0)]).unwrap();
    draft.set_positions(&[actor("a", 20.0, 30.0)]).unwrap();
    draft.undo().unwrap();
    let baseline = draft.positions();
    let state = draft.state();
    for bad in [
        vec![actor("a", 4.0, 5.0), actor("missing", 1.0, 2.0)],
        vec![actor("a", 4.0, 5.0), actor("a", 1.0, 2.0)],
        vec![actor("a", 4.0, 5.0), actor("b", f64::NAN, 2.0)],
        vec![actor("a", f64::INFINITY, 2.0)],
        vec![actor("a", -100001.0, 2.0)],
    ] {
        assert_eq!(
            draft.set_positions(&bad).unwrap_err().error_code,
            "scene_layout_position_invalid"
        );
        assert_eq!(draft.positions(), baseline);
        assert_eq!(draft.state(), state);
    }
    for noop in [vec![], baseline.clone()] {
        assert!(!draft.set_positions(&noop).unwrap());
        assert_eq!(draft.positions(), baseline);
        assert_eq!(draft.state(), state);
    }
    assert!(draft.redo().unwrap());
    assert_eq!(draft.positions()[0].position, [20.0, 30.0]);
    draft.undo().unwrap();
    draft.set_positions(&[actor("b", 9.0, 10.0)]).unwrap();
    assert!(!draft.redo().unwrap());
}

#[test]
fn history_keeps_exactly_one_hundred_batches_and_original_dirty_baseline() {
    let mut draft = LayoutDraft::new(vec![actor("a", 0.0, 0.0)]).unwrap();
    for step in 1..=LAYOUT_HISTORY_LIMIT + 1 {
        draft
            .set_positions(&[actor("a", step as f64, 0.0)])
            .unwrap();
    }
    for _ in 0..LAYOUT_HISTORY_LIMIT {
        assert!(draft.undo().unwrap());
    }
    assert!(!draft.undo().unwrap());
    assert_eq!(draft.positions()[0].position, [1.0, 0.0]);
    assert!(draft.state().dirty);
    for _ in 0..LAYOUT_HISTORY_LIMIT {
        assert!(draft.redo().unwrap());
    }
    assert!(!draft.redo().unwrap());
    assert_eq!(draft.positions()[0].position, [101.0, 0.0]);
    draft.set_positions(&[actor("a", 0.0, -0.0)]).unwrap();
    assert!(!draft.state().dirty);
    assert!(draft.state().can_undo);
    assert!(draft.reset().unwrap());
    assert!(!draft.state().can_undo);
    assert!(!draft.state().can_redo);
    assert!(!draft.reset().unwrap());
}

#[test]
fn full_actor_batch_is_one_step_and_limits_are_measured_in_utf8_bytes() {
    let initial: Vec<_> = (0..MAX_LAYOUT_ACTORS)
        .map(|index| actor(format!("actor-{index}"), index as f64, 0.0))
        .collect();
    let mut draft = LayoutDraft::new(initial.clone()).unwrap();
    let edited: Vec<_> = initial
        .iter()
        .map(|value| actor(value.object_id.clone(), value.position[0] + 1.0, 100000.0))
        .collect();
    assert!(draft.set_positions(&edited).unwrap());
    assert_eq!(draft.positions(), edited);
    assert!(draft.undo().unwrap());
    assert!(!draft.undo().unwrap());
    assert_eq!(draft.positions(), initial);
    assert!(draft.redo().unwrap());
    assert_eq!(draft.positions(), edited);
    let too_many = vec![actor("a", 0.0, 0.0); MAX_LAYOUT_ACTORS + 1];
    assert_eq!(
        draft.set_positions(&too_many).unwrap_err().error_code,
        "scene_layout_draft_limit"
    );
    assert_eq!(draft.positions(), edited);
    for actors in [
        vec![],
        too_many,
        vec![actor("", 0.0, 0.0)],
        vec![actor("a".repeat(129), 0.0, 0.0)],
        vec![actor("日".repeat(43), 0.0, 0.0)],
    ] {
        assert_eq!(
            LayoutDraft::new(actors).unwrap_err().error_code,
            "scene_layout_draft_limit"
        );
    }
    assert!(LayoutDraft::new(vec![actor("日".repeat(42) + "ab", -100000.0, 100000.0)]).is_ok());
    assert_eq!(
        LayoutDraft::new(vec![actor("a", 0.0, 0.0), actor("a", 1.0, 0.0)])
            .unwrap_err()
            .error_code,
        "scene_layout_position_invalid"
    );
}

#[test]
fn dispatcher_drafts_isolate_histories_and_release_without_handle_reuse() {
    let initial = json!([{"objectId":"a","position":[0.0,0.0]}]);
    let first = create(initial.clone());
    let second = create(initial.clone());
    assert_ne!(first, second);
    let changed = request(
        "layoutDraft.setPositions",
        json!({"draftId":first,"changes":[{"objectId":"a","position":[3.0,4.0]}]}),
    );
    assert_eq!(changed["draft"]["changed"], true);
    assert_eq!(
        changed["draft"]["state"],
        json!({"dirty":true,"canUndo":true,"canRedo":false})
    );
    assert!(changed.get("changes").is_none());
    assert!(changed["draft"].get("history").is_none());
    assert_eq!(
        operate("layoutDraft.read", &second)["draft"]["positions"],
        initial
    );
    assert_eq!(
        operate("layoutDraft.undo", &first)["draft"]["positions"],
        initial
    );
    assert_eq!(
        operate("layoutDraft.redo", &first)["draft"]["positions"][0]["position"],
        json!([3.0, 4.0])
    );
    assert_eq!(
        operate("layoutDraft.reset", &first)["draft"]["state"],
        json!({"dirty":false,"canUndo":false,"canRedo":false})
    );
    close(&first);
    assert_eq!(
        operate("layoutDraft.read", &first)["errorCode"],
        "scene_layout_draft_invalid"
    );
    assert_eq!(
        operate("layoutDraft.close", &first)["errorCode"],
        "scene_layout_draft_invalid"
    );
    let replacement = create(initial);
    assert!(replacement.parse::<u64>().unwrap() > second.parse::<u64>().unwrap());
    close(&replacement);
    close(&second);
}

#[test]
fn full_registry_rejects_without_evicting_or_mutating_active_drafts() {
    let initial = json!([{"objectId":"a","position":[0.0,0.0]}]);
    let ids: Vec<_> = (0..MAX_LAYOUT_DRAFTS)
        .map(|_| create(initial.clone()))
        .collect();
    request(
        "layoutDraft.setPositions",
        json!({"draftId":ids[0],"changes":[{"objectId":"a","position":[9.0,9.0]}]}),
    );
    operate("layoutDraft.undo", &ids[0]);
    let before = operate("layoutDraft.read", &ids[0]);
    assert_eq!(
        request("layoutDraft.create", json!({"actors":initial}))["errorCode"],
        "scene_layout_draft_limit"
    );
    assert_eq!(operate("layoutDraft.read", &ids[0]), before);
    for id in &ids {
        assert_eq!(operate("layoutDraft.read", id)["ok"], true);
    }
    close(&ids[MAX_LAYOUT_DRAFTS - 1]);
    let replacement = create(initial);
    assert!(
        replacement.parse::<u64>().unwrap() > ids[MAX_LAYOUT_DRAFTS - 1].parse::<u64>().unwrap()
    );
    assert_eq!(operate("layoutDraft.read", &ids[0]), before);
    close(&replacement);
    for id in &ids[..MAX_LAYOUT_DRAFTS - 1] {
        close(id);
    }
}

#[test]
fn protocol_rejects_bad_handles_and_malformed_batches_without_losing_redo() {
    let id = create(json!([{"objectId":"a","position":[0.0,0.0]}]));
    request(
        "layoutDraft.setPositions",
        json!({"draftId":id,"changes":[{"objectId":"a","position":[1.0,2.0]}]}),
    );
    operate("layoutDraft.undo", &id);
    let before = operate("layoutDraft.read", &id);
    for changes in [
        json!(null),
        json!({}),
        json!([null]),
        json!([{"objectId":"a","position":[3.0,4.0],"extra":true}]),
        json!([{"objectId":"a","position":[3,null]}]),
        json!([{"objectId":"a","position":[3,"4"]}]),
        json!([{"objectId":"a","position":[3.0,4.0,5.0]}]),
        json!([{"objectId":"a","position":[3.0,4.0]},{"objectId":"a","position":[4.0,5.0]}]),
    ] {
        assert_eq!(
            request(
                "layoutDraft.setPositions",
                json!({"draftId":id,"changes":changes})
            )["errorCode"],
            "scene_layout_position_invalid"
        );
        assert_eq!(operate("layoutDraft.read", &id), before);
    }
    for changes in [json!([]), json!([{"objectId":"a","position":[0.0,0.0]}])] {
        assert_eq!(
            request(
                "layoutDraft.setPositions",
                json!({"draftId":id,"changes":changes})
            )["draft"]["changed"],
            false
        );
        assert_eq!(operate("layoutDraft.read", &id), before);
    }
    for handle in [
        json!(null),
        json!(1),
        json!(""),
        json!("0"),
        json!("01"),
        json!("+1"),
        json!("-1"),
        json!("1 "),
        json!("18446744073709551616"),
    ] {
        assert_eq!(
            request("layoutDraft.read", json!({"draftId":handle}))["errorCode"],
            "scene_layout_draft_invalid"
        );
    }
    assert_eq!(
        request("layoutDraft.unsupported", json!({"draftId":id}))["errorCode"],
        "studio_core_request_invalid"
    );
    assert_eq!(operate("layoutDraft.read", &id), before);
    close(&id);
}

#[test]
fn native_threads_have_independent_draft_sessions() {
    let id = create(json!([{"objectId":"a","position":[1.0,2.0]}]));
    let captured = id.clone();
    std::thread::spawn(move || {
        assert_eq!(
            operate("layoutDraft.read", &captured)["errorCode"],
            "scene_layout_draft_invalid"
        );
        let own = create(json!([{"objectId":"a","position":[9.0,8.0]}]));
        assert_eq!(
            operate("layoutDraft.read", &own)["draft"]["positions"][0]["position"],
            json!([9.0, 8.0])
        );
        close(&own);
    })
    .join()
    .unwrap();
    assert_eq!(
        operate("layoutDraft.read", &id)["draft"]["positions"][0]["position"],
        json!([1.0, 2.0])
    );
    close(&id);
}
