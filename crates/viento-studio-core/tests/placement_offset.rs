use serde_json::{json, Value};
use viento_studio_core::{dispatch_json, viento_core_scene_composition_placement_version};

fn id(n: usize) -> String {
    format!("00000000-0000-0000-0000-{n:012x}")
}
fn recipe() -> Value {
    json!({"format":"viento-scene-composition","schemaVersion":1,
        "scene":{"title":"Placement / 配置 / 🦊","viewport":[640,480],"background":"#112233"},
        "fragments":[{"fragmentId":"pair","groups":[{"key":"team","name":"Team"},{"key":"nested","name":"Nested","parentKey":"team"}],"actors":[
            {"key":"leader","objectId":id(1),"position":[10,20],"size":[32,48],"color":"#aabbcc","speed":150,"controls":"arrows","groupKey":"team"},
            {"key":"companion","objectId":id(2),"position":[30,40],"useProjectionDefaults":true,"groupKey":"nested"}]}],
        "placements":[
            {"placementId":id(10),"fragmentId":"pair","actorIds":{"leader":id(11),"companion":id(12)},"groupIds":{"team":id(13),"nested":id(14)}},
            {"placementId":id(20),"fragmentId":"pair","actorIds":{"leader":id(21),"companion":id(22)},"groupIds":{"team":id(23),"nested":id(24)},"offset":[300,80],
                "overrides":[{"actorKey":"leader","values":{"speed":180,"position":[100,150]}}]}]})
}
fn text(value: &Value) -> String {
    format!(
        "\u{feff}{}\r\n \t",
        serde_json::to_string_pretty(value)
            .unwrap()
            .replace('\n', "\r\n")
    )
}
fn parse(content: &str) -> Value {
    serde_json::from_str(content.strip_prefix('\u{feff}').unwrap_or(content)).unwrap()
}
fn request(content: &str, index: usize, offset: Value) -> Value {
    json!({"protocolVersion":1,"operation":"sceneComposition.editPlacementOffset","content":content,"placementId":id(if index==0 {10} else {20}),"offset":offset})
}
fn run(input: Value) -> Value {
    serde_json::from_slice(&dispatch_json(&serde_json::to_vec(&input).unwrap())).unwrap()
}
fn patch(content: &str, index: usize, offset: Value) -> Value {
    let result = run(request(content, index, offset));
    assert_eq!(result["ok"], true, "{result}");
    result["compositionPatch"].clone()
}
fn expand(content: &str) -> Value {
    let result =
        run(json!({"protocolVersion":1,"operation":"sceneComposition.expand","content":content}));
    assert_eq!(result["ok"], true, "{result}");
    result["composition"].clone()
}

#[test]
fn placement_probe_and_request_domain_are_independent() {
    assert_eq!(viento_core_scene_composition_placement_version(), 1);
    assert_eq!(
        viento_studio_core::viento_core_scene_composition_fragment_edit_version(),
        1
    );
    let before = text(&recipe());
    let input = request(&before, 1, json!([1, 2]));
    for field in ["offset", "placementId", "content"] {
        let mut bad = input.clone();
        bad.as_object_mut().unwrap().remove(field);
        assert_eq!(run(bad)["errorCode"], "studio_core_request_invalid");
    }
    let mut extra = input.clone();
    extra["values"] = json!({});
    assert_eq!(run(extra)["errorCode"], "studio_core_request_invalid");
    let mut bad_id = input;
    bad_id["placementId"] = json!(id(99));
    assert_eq!(run(bad_id)["ok"], false);
}

#[test]
fn absent_and_explicit_zero_have_distinct_author_semantics() {
    let before = text(&recipe());
    assert_eq!(
        patch(&before, 0, Value::Null),
        json!({"afterContent":before,"changedPaths":[]})
    );
    let declared = patch(&before, 0, json!([0, 0]));
    assert_eq!(declared["changedPaths"], json!(["/placements/0/offset"]));
    let raw = declared["afterContent"].as_str().unwrap();
    assert!(parse(raw)["placements"][0].get("offset").is_some());
    assert_eq!(expand(raw)["scene"], expand(&before)["scene"]);
    assert_eq!(patch(raw, 0, json!([0.0, 0.0]))["changedPaths"], json!([]));
    let reset = patch(raw, 0, Value::Null);
    assert_eq!(reset["changedPaths"], json!(["/placements/0/offset"]));
    assert!(
        parse(reset["afterContent"].as_str().unwrap())["placements"][0]
            .get("offset")
            .is_none()
    );
}

#[test]
fn offsets_move_all_placement_actors_including_local_position_overrides() {
    let value = recipe();
    let before = text(&value);
    let result = patch(&before, 1, json!([50.5, -60.25]));
    let after = result["afterContent"].as_str().unwrap();
    let mut expected = value.clone();
    expected["placements"][1]["offset"] = json!([50.5, -60.25]);
    assert_eq!(parse(after), expected);
    let expanded = expand(after);
    assert_eq!(
        expanded["scene"]["actors"][2]["position"],
        json!([150.5, 89.75])
    );
    assert_eq!(
        expanded["scene"]["actors"][3]["position"],
        json!([80.5, -20.25])
    );
    assert_eq!(
        expanded["scene"]["groups"],
        expand(&before)["scene"]["groups"]
    );
    assert_eq!(
        expanded["scene"]["actors"][0],
        expand(&before)["scene"]["actors"][0]
    );
    let reset = patch(after, 1, Value::Null);
    assert_eq!(
        expand(reset["afterContent"].as_str().unwrap())["scene"]["actors"][2]["position"],
        json!([100.0, 150.0])
    );
}

#[test]
fn existing_pair_keeps_escaped_key_untouched_axis_and_all_outside_bytes() {
    let compact = serde_json::to_string(&recipe()).unwrap();
    let before = format!(
        "\u{feff}{}\r\n \t",
        compact.replace("\"offset\":[300,80]", "\"offs\\u0065t\": [3.00e2, 8.000e1]")
    );
    let noop = patch(&before, 1, json!([300, 80]));
    assert_eq!(noop["afterContent"], before);
    let result = patch(&before, 1, json!([301.25, 80]));
    assert_eq!(result["afterContent"], before.replace("3.00e2", "301.25"));
}

#[test]
fn reset_removes_first_middle_or_last_member_without_rewriting_the_container() {
    let value = recipe();
    let original = serde_json::to_string(&value["placements"][1]).unwrap();
    let mut absent = value["placements"][1].clone();
    absent.as_object_mut().unwrap().remove("offset");
    absent.as_object_mut().unwrap().remove("placementId");
    let rest_object = serde_json::to_string(&absent).unwrap();
    let mandatory = format!(
        "{{\"placementId\":\"{}\",{}}}",
        id(20),
        &rest_object[1..rest_object.len() - 1]
    );
    let inner = &mandatory[1..mandatory.len() - 1];
    let (first, rest) = inner.split_once(',').unwrap();
    for (raw, expected) in [
        (
            format!("{{\"offs\\u0065t\":[3e2,8e1],{inner}}}"),
            mandatory.clone(),
        ),
        (
            format!("{{{first},\"offset\":[3e2,8e1],{rest}}}"),
            mandatory.clone(),
        ),
        (
            format!("{{{inner},\"offset\":[3e2,8e1]}}"),
            mandatory.clone(),
        ),
    ] {
        let before = format!(
            "\u{feff}{}\r\n \t",
            serde_json::to_string(&value)
                .unwrap()
                .replace(&original, &raw)
        );
        assert_eq!(
            patch(&before, 1, Value::Null)["afterContent"],
            before.replace(&raw, &expected)
        );
    }
}

#[test]
fn missing_pair_appends_once_and_preserves_existing_formatting_and_ids() {
    let value = recipe();
    let before = text(&value);
    let result = patch(&before, 0, json!([-4.25, 9.5]));
    let after = result["afterContent"].as_str().unwrap();
    let insertion = ",\r\n      \"offset\": [-4.25,9.5]";
    assert!(after.contains(insertion));
    assert_eq!(after.replace(insertion, ""), before);
    assert_eq!(parse(after)["fragments"], value["fragments"]);
}

#[test]
fn original_and_all_final_positions_must_fit_even_when_selected_actor_is_safe() {
    let before = text(&recipe());
    // Selected leader's local override is safe, companion is not.
    let mut value = recipe();
    value["placements"][1]["overrides"][0]["values"]["position"] = json!([0, 0]);
    let source = text(&value);
    assert_eq!(run(request(&source, 1, json!([99980, 0])))["ok"], false);
    assert_eq!(run(request(&source, 1, json!([99970, 0])))["ok"], true);
    for offset in [
        json!([100001, 0]),
        json!([0, -100001]),
        json!([1]),
        json!([1, 2, 3]),
        json!(["1", 2]),
        json!({"x":1,"y":2}),
        json!([null, 0]),
        json!(false),
    ] {
        assert_eq!(run(request(&before, 1, offset))["ok"], false);
    }
    value["placements"][1]["offset"] = json!([99990, 0]);
    assert_eq!(run(request(&text(&value), 1, Value::Null))["ok"], false);
}

#[test]
fn final_utf8_budget_allows_shrink_and_reset_but_rejects_growth_or_oversized_input() {
    let prefix = text(&recipe());
    let before = prefix.clone() + &" ".repeat(128 * 1024 - prefix.len());
    assert_eq!(before.len(), 128 * 1024);
    assert_eq!(
        run(request(&before, 0, json!([0, 0])))["errorCode"],
        "scene_composition_limit"
    );
    assert_eq!(
        run(request(&before, 1, json!([30000, 8000])))["errorCode"],
        "scene_composition_limit"
    );
    assert!(
        patch(&before, 1, json!([1, 2]))["afterContent"]
            .as_str()
            .unwrap()
            .len()
            < before.len()
    );
    assert!(
        patch(&before, 1, Value::Null)["afterContent"]
            .as_str()
            .unwrap()
            .len()
            < before.len()
    );
    assert_eq!(
        run(request(&(before + " "), 1, Value::Null))["errorCode"],
        "scene_composition_limit"
    );
}

#[test]
fn decoded_duplicates_and_invalid_unused_fragments_cannot_be_hidden_by_reset() {
    let before = text(&recipe());
    let duplicate = before.replace("\"offset\": [", "\"offset\": [0,0], \"offs\\u0065t\": [");
    assert_eq!(run(request(&duplicate, 1, Value::Null))["ok"], false);
    let mut value = recipe();
    let mut unused = value["fragments"][0].clone();
    unused["fragmentId"] = json!("unused");
    unused["actors"][0]["controls"] = json!("bad");
    value["fragments"].as_array_mut().unwrap().push(unused);
    assert_eq!(run(request(&text(&value), 1, Value::Null))["ok"], false);
}
