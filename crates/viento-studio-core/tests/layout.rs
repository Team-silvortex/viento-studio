use serde_json::{json, Value};
use viento_studio_core::{dispatch_json, MAX_INPUT_BYTES};

fn request(operation: &str, fields: Value) -> Value {
    let mut value = fields.as_object().unwrap().clone();
    value.insert("protocolVersion".into(), json!(1));
    value.insert("operation".into(), json!(operation));
    serde_json::from_slice(&dispatch_json(&serde_json::to_vec(&value).unwrap())).unwrap()
}

fn actors() -> Value {
    json!([
        {"objectId":"first","position":[101.25,205.5],"size":[80,60]},
        {"objectId":"second","position":[310.75,300.25],"size":[40,20]},
        {"objectId":"outside","position":[20,20],"size":[10,10]}
    ])
}

fn positions(response: &Value) -> Vec<[f64; 2]> {
    assert_eq!(response["ok"], true, "{response}");
    assert_eq!(response["protocolVersion"], 1);
    response["changes"]
        .as_array()
        .unwrap()
        .iter()
        .map(|change| {
            [
                change["position"][0].as_f64().unwrap(),
                change["position"][1].as_f64().unwrap(),
            ]
        })
        .collect()
}

#[test]
fn movement_uses_shared_delta_and_first_selected_snap_anchor() {
    let source = actors();
    let mut input = json!({"actors":source,"ids":["first","second"],"delta":[10.4,-4.6]});
    assert_eq!(
        positions(&request("move", input.clone())),
        [[111.25, 200.5], [320.75, 295.25]]
    );
    input["snap"] = json!(32);
    assert_eq!(
        positions(&request("move", input.clone())),
        [[96.0, 192.0], [305.5, 286.75]]
    );
    input["ids"] = json!(["second", "first"]);
    let response = request("move", input);
    assert_eq!(positions(&response), [[320.0, 288.0], [110.5, 193.25]]);
    assert_eq!(response["changes"][0]["objectId"], "second");
    assert_eq!(source, actors());
}

#[test]
fn negative_ties_follow_javascript_round_in_both_free_and_snapped_movement() {
    let source = json!([{"objectId":"a","position":[10,10],"size":[1,1]}]);
    assert_eq!(
        positions(&request(
            "move",
            json!({"actors":source,"ids":["a"],"delta":[-0.5,-1.5]})
        )),
        [[10.0, 9.0]]
    );
    assert_eq!(
        positions(&request(
            "move",
            json!({"actors":source,"ids":["a"],"delta":[-26,-58],"snap":32})
        )),
        [[0.0, -32.0]]
    );
}

#[test]
fn group_clamp_preserves_spacing_at_both_boundaries() {
    let source = json!([
        {"objectId":"a","position":[-90000,90000],"size":[80,60]},
        {"objectId":"b","position":[90000,-90000],"size":[40,20]}
    ]);
    for snap in [0.0, 32.0] {
        let result = request(
            "move",
            json!({"actors":source,"ids":["a","b"],"delta":[f64::MAX,-f64::MAX],"snap":snap}),
        );
        assert_eq!(
            positions(&result),
            [[-80000.0, 80000.0], [100000.0, -100000.0]]
        );
    }
    let result = request(
        "move",
        json!({"actors":source,"ids":["a","b"],"delta":[1,1],"snap":f64::from_bits(1)}),
    );
    assert_eq!(
        positions(&result),
        [[-89999.0, 90001.0], [90001.0, -89999.0]]
    );
}

#[test]
fn fractional_boundary_cancellation_is_nudged_as_a_group() {
    let source = json!([
        {"objectId":"a","position":[-90690.61234776235,0],"size":[80,60]},
        {"objectId":"b","position":[-77737.83179106213,0],"size":[40,20]}
    ]);
    let result = positions(&request(
        "move",
        json!({"actors":source,"ids":["a","b"],"delta":[1000000,0]}),
    ));
    assert!(result.iter().flatten().all(|value| value.abs() <= 100000.0));
    assert!(
        ((result[1][0] - result[0][0]) - (-77737.83179106213 + 90690.61234776235)).abs() < 1e-9
    );
}

#[test]
fn geometry_only_validates_selected_positions_and_sizes_but_all_identities() {
    let source = json!([
        {"objectId":"a","position":[1,2],"size":[10,20]},
        {"objectId":"unselected","position":"bad","size":null}
    ]);
    assert_eq!(
        positions(&request(
            "move",
            json!({"actors":source,"ids":["a"],"delta":[1,2]})
        )),
        [[2.0, 4.0]]
    );
    assert!(positions(&request(
        "align",
        json!({"actors":source,"ids":[],"alignment":"left"})
    ))
    .is_empty());
    for invalid in [
        json!([source[0].clone(), source[0].clone()]),
        json!([source[0].clone(), {"objectId":""}]),
        json!([source[0].clone(), null]),
    ] {
        assert_eq!(
            request("move", json!({"actors":invalid,"ids":["a"],"delta":[0,0]}))["errorCode"],
            "scene_layout_position_invalid"
        );
    }
}

#[test]
fn six_alignments_use_resolved_sizes_and_keep_unselected_actors_out() {
    let source = json!([
        {"objectId":"a","position":[100,200],"size":[80,60],"useProjectionDefaults":true},
        {"objectId":"b","position":[300,250],"size":[40,100]},
        {"objectId":"outside","position":[900,900],"size":[100,100]}
    ]);
    for (mode, expected) in [
        ("left", [[100.0, 200.0], [80.0, 250.0]]),
        ("center", [[190.0, 200.0], [190.0, 250.0]]),
        ("right", [[280.0, 200.0], [300.0, 250.0]]),
        ("top", [[100.0, 200.0], [300.0, 220.0]]),
        ("middle", [[100.0, 235.0], [300.0, 235.0]]),
        ("bottom", [[100.0, 270.0], [300.0, 250.0]]),
    ] {
        assert_eq!(
            positions(&request(
                "align",
                json!({"actors":source,"ids":["a","b"],"alignment":mode})
            )),
            expected
        );
        assert_eq!(
            positions(&request(
                "align",
                json!({"actors":source,"ids":["b","a"],"alignment":mode})
            )),
            [expected[1], expected[0]]
        );
    }
}

#[test]
fn alignment_overflow_rejects_the_entire_batch() {
    let source = json!([
        {"objectId":"a","position":[-99990,0],"size":[100,60]},
        {"objectId":"b","position":[0,0],"size":[20,20]}
    ]);
    let result = request(
        "align",
        json!({"actors":source,"ids":["a","b"],"alignment":"left"}),
    );
    assert_eq!(result["ok"], false);
    assert_eq!(result["errorCode"], "scene_layout_position_invalid");
    assert!(result.get("changes").is_none());
    assert_eq!(
        request(
            "align",
            json!({"actors":null,"ids":null,"alignment":"distribute"})
        )["errorCode"],
        "scene_layout_alignment_invalid"
    );
}

#[test]
fn malformed_geometry_is_rejected_before_any_changes_are_returned() {
    for delta in [
        json!([null, 0]),
        json!(["1", 0]),
        json!([true, 0]),
        json!([1]),
        json!(null),
    ] {
        assert_eq!(
            request(
                "move",
                json!({"actors":actors(),"ids":["first"],"delta":delta})
            )["errorCode"],
            "scene_layout_position_invalid"
        );
    }
    for snap in [json!(-1), json!(null), json!("32"), json!(100001)] {
        assert_eq!(
            request(
                "move",
                json!({"actors":actors(),"ids":["first"],"delta":[0,0],"snap":snap})
            )["errorCode"],
            "scene_layout_position_invalid"
        );
    }
    for ids in [
        json!(["first", "first"]),
        json!(["missing"]),
        json!([null]),
        json!(null),
    ] {
        assert_eq!(
            request("move", json!({"actors":actors(),"ids":ids,"delta":[0,0]}))["errorCode"],
            "scene_layout_position_invalid"
        );
    }
    for (field, value) in [
        ("position", json!([100001, 0])),
        ("size", json!([0, 1])),
        ("size", json!([-1, 1])),
        ("size", json!([null, 1])),
    ] {
        let mut source = actors();
        source[0][field] = value;
        assert_eq!(
            request(
                "move",
                json!({"actors":source,"ids":["first"],"delta":[0,0]})
            )["errorCode"],
            "scene_layout_position_invalid"
        );
    }
}

#[test]
fn batch_preserves_input_order_and_noops_and_does_not_need_sizes() {
    let source = json!([{"objectId":"a","position":[1,2]},{"objectId":"b","position":[3,4]}]);
    let changes = json!([{"objectId":"b","position":[10,20]},{"objectId":"a","position":[1,2]}]);
    let result = request("validateBatch", json!({"actors":source,"changes":changes}));
    assert_eq!(positions(&result), [[10.0, 20.0], [1.0, 2.0]]);
    assert_eq!(result["changes"][0]["objectId"], "b");
    assert!(positions(&request(
        "validateBatch",
        json!({"actors":source,"changes":[]})
    ))
    .is_empty());
}

#[test]
fn batch_rejects_extra_fields_duplicate_ids_and_invalid_existing_positions_atomically() {
    let source = json!([{"objectId":"a","position":[1,2]},{"objectId":"b","position":[3,4]}]);
    let good = json!({"objectId":"a","position":[10,20]});
    for changes in [
        json!([good,{"objectId":"b","position":[null,0]}]),
        json!([good, good]),
        json!([{"objectId":"a","position":[1,2],"size":[1,1]}]),
        json!([{"objectId":"missing","position":[1,2]}]),
        json!(null),
    ] {
        let result = request("validateBatch", json!({"actors":source,"changes":changes}));
        assert_eq!(result["errorCode"], "scene_layout_position_invalid");
        assert!(result.get("changes").is_none());
    }
    let invalid = json!([{"objectId":"a","position":[1,2]},{"objectId":"b","position":null}]);
    assert_eq!(
        request("validateBatch", json!({"actors":invalid,"changes":[good]}))["errorCode"],
        "scene_layout_position_invalid"
    );
}

#[test]
fn protocol_rejects_bad_json_unknown_versions_and_operations() {
    for input in [
        "",
        "{",
        "null",
        "[]",
        "{\"protocolVersion\":2,\"operation\":\"move\"}",
        "{\"protocolVersion\":1,\"operation\":\"runCode\"}",
        "{\"protocolVersion\":\"1\",\"operation\":\"move\"}",
    ] {
        let value: Value = serde_json::from_slice(&dispatch_json(input.as_bytes())).unwrap();
        assert_eq!(value["ok"], false);
        assert_eq!(value["protocolVersion"], 1);
        assert_eq!(value["errorCode"], "studio_core_request_invalid");
        assert!(value["message"].is_string());
    }
}

#[test]
fn input_limit_is_shared_by_native_dispatch_and_wasm() {
    let mut bytes =
        br#"{"protocolVersion":1,"operation":"validateBatch","actors":[],"changes":[]}"#.to_vec();
    bytes.resize(MAX_INPUT_BYTES, b' ');
    let response: Value = serde_json::from_slice(&dispatch_json(&bytes)).unwrap();
    assert_eq!(response["ok"], true);
    bytes.push(b' ');
    let response: Value = serde_json::from_slice(&dispatch_json(&bytes)).unwrap();
    assert_eq!(response["errorCode"], "studio_core_input_limit");
}

#[test]
fn json_float_parsing_keeps_the_exact_binary_coordinate() {
    let input = br#"{"protocolVersion":1,"operation":"validateBatch","actors":[{"objectId":"a","position":[-90690.61234776235,0]}],"changes":[{"objectId":"a","position":[-90690.61234776235,0]}]}"#;
    let response: Value = serde_json::from_slice(&dispatch_json(input)).unwrap();
    assert_eq!(
        positions(&response)[0][0].to_bits(),
        (-90690.61234776235_f64).to_bits()
    );
}
