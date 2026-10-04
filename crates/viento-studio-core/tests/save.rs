use serde_json::{json, Value};
use viento_studio_core::{
    dispatch_json, LayoutDraft, LayoutSaveAction as Action, LayoutSaveOutcome as Outcome,
    LayoutSavePhase as Phase, LayoutSaveState, LayoutSaveWorkflow, PositionChange,
};

fn actor(x: f64) -> PositionChange {
    PositionChange {
        object_id: "a".into(),
        position: [x, 0.0],
    }
}

fn resolve(workflow: &mut LayoutSaveWorkflow, outcome: Outcome, code: Option<&str>) {
    let id = workflow.state().request_id.unwrap();
    workflow.resolve(&id, outcome, code).unwrap();
}

fn workflow_at(phase: Phase) -> LayoutSaveWorkflow {
    let mut workflow = LayoutSaveWorkflow::default();
    if phase == Phase::Editing {
        return workflow;
    }
    workflow.begin(Action::Preview, true, true, false).unwrap();
    if phase == Phase::Checking {
        return workflow;
    }
    if phase == Phase::Conflict {
        resolve(
            &mut workflow,
            Outcome::Error,
            Some("world_revision_conflict"),
        );
        return workflow;
    }
    resolve(&mut workflow, Outcome::Accepted, None);
    if phase == Phase::Reviewed {
        return workflow;
    }
    workflow.begin(Action::Apply, true, true, false).unwrap();
    if phase == Phase::Applying {
        return workflow;
    }
    if matches!(phase, Phase::Uncertain | Phase::Verifying) {
        resolve(&mut workflow, Outcome::Error, Some("network_unavailable"));
        if phase == Phase::Verifying {
            workflow.begin(Action::Verify, false, false, true).unwrap();
        }
        return workflow;
    }
    resolve(&mut workflow, Outcome::Accepted, None);
    if phase == Phase::Saved {
        let id = workflow.state().request_id.unwrap();
        workflow.refreshed(&id).unwrap();
    }
    workflow
}

fn assert_flags(state: &LayoutSaveState, phase: Phase) {
    assert_eq!(state.phase, phase);
    assert_eq!(
        state.busy,
        matches!(
            phase,
            Phase::Checking | Phase::Applying | Phase::Verifying | Phase::Refreshing
        )
    );
    assert_eq!(
        state.editable,
        matches!(phase, Phase::Editing | Phase::Reviewed)
    );
    assert_eq!(state.reviewed, phase == Phase::Reviewed);
    assert_eq!(
        state.saved,
        matches!(phase, Phase::Refreshing | Phase::Saved)
    );
    assert_eq!(state.conflict, phase == Phase::Conflict);
    assert_eq!(
        state.uncertain,
        matches!(phase, Phase::Uncertain | Phase::Verifying)
    );
    assert_eq!(state.request_id.is_some(), state.busy);
}

#[test]
fn flags_are_derived_from_all_nine_phases_and_request_ids_are_monotonic() {
    for phase in [
        Phase::Editing,
        Phase::Checking,
        Phase::Reviewed,
        Phase::Applying,
        Phase::Uncertain,
        Phase::Verifying,
        Phase::Refreshing,
        Phase::Saved,
        Phase::Conflict,
    ] {
        assert_flags(&workflow_at(phase).state(), phase);
    }
    let mut workflow = LayoutSaveWorkflow::default();
    let mut previous = 0_u64;
    for _ in 0..5 {
        workflow.begin(Action::Preview, true, true, false).unwrap();
        let token = workflow.state().request_id.unwrap().parse::<u64>().unwrap();
        assert!(token > previous);
        previous = token;
        resolve(&mut workflow, Outcome::Accepted, None);
        workflow.invalidate().unwrap();
    }
}

#[test]
fn begin_guards_dirty_permission_pending_input_and_phase_without_mutation() {
    for phase in [Phase::Editing, Phase::Reviewed] {
        for (dirty, editable, pending) in [
            (false, true, false),
            (true, false, false),
            (true, true, true),
        ] {
            let mut workflow = workflow_at(phase);
            let before = workflow.state();
            for action in [Action::Preview, Action::Apply] {
                assert!(workflow.begin(action, dirty, editable, pending).is_err());
                assert_eq!(workflow.state(), before);
            }
        }
    }
    for phase in [
        Phase::Checking,
        Phase::Applying,
        Phase::Uncertain,
        Phase::Verifying,
        Phase::Refreshing,
        Phase::Saved,
        Phase::Conflict,
    ] {
        let mut workflow = workflow_at(phase);
        let before = workflow.state();
        for action in [Action::Preview, Action::Apply] {
            assert!(workflow.begin(action, true, true, false).is_err());
            assert_eq!(workflow.state(), before);
        }
        assert!(workflow.invalidate().is_err());
        assert_eq!(workflow.state(), before);
    }
    let mut workflow = workflow_at(Phase::Editing);
    assert!(workflow.begin(Action::Apply, true, true, false).is_err());
    assert!(workflow.begin(Action::Verify, true, true, false).is_err());
    let mut uncertain = workflow_at(Phase::Uncertain);
    uncertain.begin(Action::Verify, false, false, true).unwrap();
    assert_flags(&uncertain.state(), Phase::Verifying);
}

#[test]
fn error_matrix_keeps_definite_conflicts_distinct_from_uncertain_writes() {
    for phase in [Phase::Checking, Phase::Applying, Phase::Verifying] {
        for code in [
            None,
            Some(""),
            Some("world_revision_conflict"),
            Some("world_read_conflict"),
            Some("world_object_not_found"),
            Some("world_scene_invalid"),
            Some("world_command_invalid"),
            Some("network_unavailable"),
            Some("unexpected_response"),
        ] {
            let mut workflow = workflow_at(phase);
            resolve(&mut workflow, Outcome::Error, code);
            let expected = if matches!(
                code,
                Some("world_revision_conflict" | "world_read_conflict" | "world_object_not_found")
            ) {
                Phase::Conflict
            } else if phase == Phase::Checking
                || phase == Phase::Applying
                    && matches!(code, Some("world_scene_invalid" | "world_command_invalid"))
            {
                Phase::Editing
            } else {
                Phase::Uncertain
            };
            assert_flags(&workflow.state(), expected);
        }
    }
}

#[test]
fn stale_repeated_or_malformed_completions_leave_the_workflow_unchanged() {
    for phase in [
        Phase::Checking,
        Phase::Applying,
        Phase::Verifying,
        Phase::Refreshing,
    ] {
        let mut workflow = workflow_at(phase);
        let before = workflow.state();
        for token in ["", "0", "01", "+1", "-1", "18446744073709551616", "999"] {
            assert!(workflow.resolve(token, Outcome::Accepted, None).is_err());
            assert!(workflow.refreshed(token).is_err());
            assert_eq!(workflow.state(), before);
        }
        let id = before.request_id.as_ref().unwrap();
        assert!(workflow
            .resolve(id, Outcome::Error, Some(&"a".repeat(129)))
            .is_err());
        assert!(workflow
            .resolve(id, Outcome::Error, Some(&"日".repeat(43)))
            .is_err());
        assert_eq!(workflow.state(), before);
        if matches!(phase, Phase::Checking | Phase::Applying) {
            assert!(workflow.resolve(id, Outcome::Different, None).is_err());
            assert_eq!(workflow.state(), before);
        }
        if phase != Phase::Refreshing {
            workflow.resolve(id, Outcome::Accepted, None).unwrap();
            let after = workflow.state();
            assert!(workflow.resolve(id, Outcome::Error, None).is_err());
            assert_eq!(workflow.state(), after);
        }
    }
    let mut workflow = workflow_at(Phase::Checking);
    let old = workflow.state().request_id.unwrap();
    workflow.resolve(&old, Outcome::Error, None).unwrap();
    workflow.begin(Action::Preview, true, true, false).unwrap();
    let current = workflow.state();
    assert!(workflow.resolve(&old, Outcome::Accepted, None).is_err());
    assert_eq!(workflow.state(), current);
}

#[test]
fn accepted_save_is_one_way_even_when_refresh_fails_and_verification_can_conflict() {
    for phase in [Phase::Applying, Phase::Verifying] {
        let mut workflow = workflow_at(phase);
        let id = workflow.state().request_id.unwrap();
        workflow.resolve(&id, Outcome::Accepted, None).unwrap();
        assert_flags(&workflow.state(), Phase::Refreshing);
        assert_eq!(workflow.state().request_id.as_deref(), Some(id.as_str()));
        let confirmed = workflow.state();
        assert!(workflow
            .resolve(&id, Outcome::Error, Some("refresh_failed"))
            .is_err());
        assert_eq!(workflow.state(), confirmed);
        workflow.refreshed(&id).unwrap();
        assert_flags(&workflow.state(), Phase::Saved);
        let saved = workflow.state();
        assert!(workflow.refreshed(&id).is_err());
        assert!(workflow.invalidate().is_err());
        assert_eq!(workflow.state(), saved);
    }
    let mut workflow = workflow_at(Phase::Verifying);
    resolve(&mut workflow, Outcome::Different, None);
    assert_flags(&workflow.state(), Phase::Conflict);
}

fn draft_at(phase: Phase) -> LayoutDraft {
    let mut draft = LayoutDraft::new(vec![actor(0.0)]).unwrap();
    draft.set_positions(&[actor(1.0)]).unwrap();
    if phase == Phase::Editing {
        return draft;
    }
    draft.begin_save(Action::Preview, true, false).unwrap();
    if phase == Phase::Checking {
        return draft;
    }
    let token = draft.save_state().request_id.unwrap();
    if phase == Phase::Conflict {
        draft
            .resolve_save(&token, Outcome::Error, Some("world_read_conflict"))
            .unwrap();
        return draft;
    }
    draft.resolve_save(&token, Outcome::Accepted, None).unwrap();
    if phase == Phase::Reviewed {
        return draft;
    }
    draft.begin_save(Action::Apply, true, false).unwrap();
    if phase == Phase::Applying {
        return draft;
    }
    let token = draft.save_state().request_id.unwrap();
    if matches!(phase, Phase::Uncertain | Phase::Verifying) {
        draft.resolve_save(&token, Outcome::Error, None).unwrap();
        if phase == Phase::Verifying {
            draft.begin_save(Action::Verify, false, true).unwrap();
        }
        return draft;
    }
    draft.resolve_save(&token, Outcome::Accepted, None).unwrap();
    if phase == Phase::Saved {
        draft.refreshed_save(&token).unwrap();
    }
    draft
}

#[test]
fn draft_uses_authoritative_dirty_and_freezes_all_mutations_outside_editable_phases() {
    let mut clean = LayoutDraft::new(vec![actor(0.0)]).unwrap();
    assert!(clean.begin_save(Action::Preview, true, false).is_err());
    for phase in [
        Phase::Checking,
        Phase::Applying,
        Phase::Uncertain,
        Phase::Verifying,
        Phase::Refreshing,
        Phase::Saved,
        Phase::Conflict,
    ] {
        let mut draft = draft_at(phase);
        let before = (draft.positions(), draft.state(), draft.save_state());
        for result in [
            draft.set_positions(&[actor(5.0)]),
            draft.set_positions(&[]),
            draft.undo(),
            draft.redo(),
            draft.reset(),
        ] {
            assert_eq!(result.unwrap_err().error_code, "scene_layout_save_invalid");
        }
        assert_eq!(
            (draft.positions(), draft.state(), draft.save_state()),
            before
        );
    }
}

#[test]
fn actual_draft_edits_invalidate_reviews_but_invalid_batches_and_noops_do_not() {
    for operation in ["set", "undo", "reset"] {
        let mut draft = draft_at(Phase::Reviewed);
        let reviewed = draft.save_state();
        assert!(!draft.set_positions(&[]).unwrap());
        assert!(!draft.set_positions(&[actor(1.0)]).unwrap());
        assert!(!draft.redo().unwrap());
        assert!(draft.set_positions(&[actor(f64::NAN)]).is_err());
        assert_eq!(draft.save_state(), reviewed);
        match operation {
            "set" => {
                draft.set_positions(&[actor(2.0)]).unwrap();
            }
            "undo" => {
                draft.undo().unwrap();
            }
            _ => {
                draft.reset().unwrap();
            }
        }
        assert_flags(&draft.save_state(), Phase::Editing);
    }
    let mut draft = LayoutDraft::new(vec![actor(0.0)]).unwrap();
    draft.set_positions(&[actor(1.0)]).unwrap();
    draft.set_positions(&[actor(2.0)]).unwrap();
    draft.undo().unwrap();
    draft.begin_save(Action::Preview, true, false).unwrap();
    let token = draft.save_state().request_id.unwrap();
    draft.resolve_save(&token, Outcome::Accepted, None).unwrap();
    assert!(draft.state().can_redo);
    draft.redo().unwrap();
    assert_flags(&draft.save_state(), Phase::Editing);
}

fn request(operation: &str, draft_id: &str, fields: Value) -> Value {
    let mut request = fields.as_object().unwrap().clone();
    request.insert("operation".into(), json!(operation));
    request.insert("protocolVersion".into(), json!(1));
    request.insert("draftId".into(), json!(draft_id));
    serde_json::from_slice(&dispatch_json(&serde_json::to_vec(&request).unwrap())).unwrap()
}

fn create() -> String {
    let response = request(
        "layoutDraft.create",
        "",
        json!({"actors":[{"objectId":"a","position":[0,0]}]}),
    );
    let id = response["draft"]["draftId"].as_str().unwrap().to_owned();
    assert_eq!(
        request(
            "layoutDraft.setPositions",
            &id,
            json!({"changes":[{"objectId":"a","position":[1,0]}]})
        )["ok"],
        true
    );
    id
}

#[test]
fn protocol_validates_shapes_and_draft_handles_without_changing_any_session() {
    let first = create();
    let second = create();
    let before = request("layoutSave.read", &first, json!({}));
    assert_eq!(before["save"]["draftId"], first);
    assert!(before.get("draft").is_none());
    assert_eq!(before["save"]["state"]["requestId"], Value::Null);
    for fields in [
        json!({}),
        json!({"action":"bogus","editable":true,"inputPending":false}),
        json!({"action":"preview","editable":"true","inputPending":false}),
        json!({"action":"preview","editable":true,"inputPending":0}),
    ] {
        assert_eq!(
            request("layoutSave.begin", &first, fields)["errorCode"],
            "scene_layout_save_invalid"
        );
        assert_eq!(request("layoutSave.read", &first, json!({})), before);
    }
    let begin = request(
        "layoutSave.begin",
        &first,
        json!({"action":"preview","editable":true,"inputPending":false}),
    );
    let token = begin["save"]["state"]["requestId"].as_str().unwrap();
    for fields in [
        json!({}),
        json!({"requestId":1,"outcome":"accepted"}),
        json!({"requestId":token,"outcome":"invalid"}),
        json!({"requestId":token,"outcome":"error","errorCode":false}),
        json!({"requestId":token,"outcome":"error","errorCode":"a".repeat(129)}),
    ] {
        assert_eq!(
            request("layoutSave.resolve", &first, fields)["errorCode"],
            "scene_layout_save_invalid"
        );
        assert_eq!(request("layoutSave.read", &first, json!({})), begin);
    }
    for operation in [
        "layoutDraft.setPositions",
        "layoutDraft.undo",
        "layoutDraft.redo",
        "layoutDraft.reset",
    ] {
        assert_eq!(
            request(operation, &first, json!({"changes":null}))["errorCode"],
            "scene_layout_save_invalid"
        );
    }
    assert_eq!(
        request("layoutSave.read", &second, json!({}))["save"]["state"]["phase"],
        "editing"
    );
    assert_eq!(
        request(
            "layoutSave.resolve",
            &second,
            json!({"requestId":token,"outcome":"accepted"})
        )["errorCode"],
        "scene_layout_save_invalid"
    );
    assert_eq!(
        request(
            "layoutSave.resolve",
            &first,
            json!({"requestId":token,"outcome":"accepted","errorCode":null})
        )["save"]["state"]["phase"],
        "reviewed"
    );
    assert_eq!(request("layoutDraft.close", &first, json!({}))["ok"], true);
    assert_eq!(
        request("layoutSave.read", &first, json!({}))["errorCode"],
        "scene_layout_draft_invalid"
    );
    let replacement = create();
    assert_ne!(replacement, first);
    assert_eq!(
        request("layoutSave.read", &replacement, json!({}))["save"]["state"]["phase"],
        "editing"
    );
    for id in [second, replacement] {
        assert_eq!(request("layoutDraft.close", &id, json!({}))["ok"], true);
    }
}
