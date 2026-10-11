use serde_json::{json, Value};
use viento_studio_core::{dispatch_json, viento_core_scene_composition_fragment_edit_version};

const RESET: [&str; 5] = ["size", "color", "speed", "controls", "imageResourceId"];
fn id(n: usize) -> String {
    format!("00000000-0000-0000-0000-{n:012x}")
}
fn recipe() -> Value {
    json!({"format":"viento-scene-composition","schemaVersion":1,
        "scene":{"title":"Shared / 共有 / 🦊","viewport":[640,480],"background":"#112233"},
        "fragments":[{"fragmentId":"pair","groups":[],"actors":[
            {"key":"leader","objectId":id(1),"position":[10,20],"size":[32,48],"color":"#aabbcc","speed":150,"controls":"arrows","imageResourceId":id(9),"useProjectionDefaults":true},
            {"key":"companion","objectId":id(2),"position":[30,40],"useProjectionDefaults":true}]}],
        "placements":[
            {"placementId":id(10),"fragmentId":"pair","actorIds":{"leader":id(11),"companion":id(12)},"groupIds":{}},
            {"placementId":id(20),"fragmentId":"pair","actorIds":{"leader":id(21),"companion":id(22)},"groupIds":{},"offset":[300,80],
                "overrides":[{"actorKey":"leader","values":{"speed":180,"position":[100,150],"imageResourceId":null}}]}]})
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
fn input(content: &str, values: Value, reset: Value) -> Value {
    json!({"protocolVersion":1,"operation":"sceneComposition.editFragmentActor","content":content,"fragmentId":"pair","actorKey":"leader","values":values,"reset":reset})
}
fn run(input: Value) -> Value {
    serde_json::from_slice(&dispatch_json(&serde_json::to_vec(&input).unwrap())).unwrap()
}
fn patch(content: &str, values: Value, reset: Value) -> Value {
    let result = run(input(content, values, reset));
    assert_eq!(result["ok"], true, "{result}");
    result["compositionPatch"].clone()
}
fn expand(content: &str) -> Value {
    let result =
        run(json!({"protocolVersion":1,"operation":"sceneComposition.expand","content":content}));
    assert_eq!(result["ok"], true, "{result}");
    result["composition"].clone()
}
fn actor_source(raw: &str) -> String {
    let value = recipe();
    let original = serde_json::to_string(&value["fragments"][0]["actors"][0]).unwrap();
    format!(
        "\u{feff}{}\r\n \t",
        serde_json::to_string(&value)
            .unwrap()
            .replace(&original, raw)
    )
}

#[test]
fn fragment_edit_capability_is_independent_and_old_set_shape_remains_valid() {
    assert_eq!(viento_core_scene_composition_fragment_edit_version(), 1);
    assert_eq!(
        viento_studio_core::viento_core_scene_composition_fragment_version(),
        1
    );
    let content = text(&recipe());
    let mut old = input(&content, json!({"speed":160}), json!([]));
    old.as_object_mut().unwrap().remove("reset");
    old["operation"] = json!("sceneComposition.patchFragmentActor");
    assert_eq!(run(old.clone())["ok"], true);
    old["reset"] = json!([]);
    assert_eq!(run(old)["ok"], false);
    let mut incomplete = input(&content, json!({"speed":160}), json!([]));
    incomplete.as_object_mut().unwrap().remove("reset");
    assert_eq!(run(incomplete)["ok"], false);
}

#[test]
fn all_reset_subsets_remove_only_optional_declarations_and_keep_actor_and_placements() {
    let value = recipe();
    let before = text(&value);
    for bits in 1..32 {
        let reset = RESET
            .iter()
            .enumerate()
            .filter(|(axis, _)| bits & (1 << axis) != 0)
            .map(|(_, field)| *field)
            .collect::<Vec<_>>();
        let result = patch(
            &before,
            json!({}),
            json!(reset.iter().rev().collect::<Vec<_>>()),
        );
        let after = result["afterContent"].as_str().unwrap();
        let mut expected = value.clone();
        for field in &reset {
            expected["fragments"][0]["actors"][0]
                .as_object_mut()
                .unwrap()
                .remove(*field);
        }
        assert_eq!(parse(after), expected);
        assert_eq!(expected["placements"], value["placements"]);
        assert_eq!(
            result["changedPaths"],
            json!(reset
                .iter()
                .map(|field| format!("/fragments/0/actors/0/{field}"))
                .collect::<Vec<_>>())
        );
        assert!(after.starts_with('\u{feff}'));
        assert!(after.ends_with("\r\n \t"));
        expand(after);
    }
}

#[test]
fn noninheriting_actors_can_remove_only_image_without_altering_the_flag() {
    for flag in [None, Some(false)] {
        let mut value = recipe();
        value["placements"][1]["overrides"][0]["values"]
            .as_object_mut()
            .unwrap()
            .remove("imageResourceId");
        if let Some(flag) = flag {
            value["fragments"][0]["actors"][0]["useProjectionDefaults"] = json!(flag);
        } else {
            value["fragments"][0]["actors"][0]
                .as_object_mut()
                .unwrap()
                .remove("useProjectionDefaults");
        }
        let before = text(&value);
        let result = patch(&before, json!({}), json!(["imageResourceId"]));
        let after = result["afterContent"].as_str().unwrap();
        let mut expected = value.clone();
        expected["fragments"][0]["actors"][0]
            .as_object_mut()
            .unwrap()
            .remove("imageResourceId");
        assert_eq!(parse(after), expected);
        assert!(expand(after)["scene"]["actors"][0]
            .get("imageResourceId")
            .is_none());
        for field in &RESET[..4] {
            assert_eq!(run(input(&before, json!({}), json!([field])))["ok"], false);
        }
    }
}

#[test]
fn image_null_and_removed_declaration_are_distinct_and_local_suppression_survives() {
    let before = text(&recipe());
    let null = patch(&before, json!({"imageResourceId":null}), json!([]));
    let null_text = null["afterContent"].as_str().unwrap();
    let removed = patch(null_text, json!({}), json!(["imageResourceId"]));
    assert_eq!(
        parse(null_text)["fragments"][0]["actors"][0]["imageResourceId"],
        Value::Null
    );
    assert!(
        parse(removed["afterContent"].as_str().unwrap())["fragments"][0]["actors"][0]
            .get("imageResourceId")
            .is_none()
    );
    assert_eq!(parse(null_text)["placements"], recipe()["placements"]);
    assert_eq!(
        parse(removed["afterContent"].as_str().unwrap())["placements"],
        recipe()["placements"]
    );
}

#[test]
fn mixed_edits_handle_first_middle_tail_runs_and_append_after_removed_last_member() {
    let mandatory = format!("\"key\":\"leader\",\"objectId\":\"{}\",\"posit\\u0069on\":[1.0e1,2.00e1],\"useProjectionDefaults\":true",id(1));
    for (raw, expected) in [
        (
            format!("{{\"speed\":1.5e2,{mandatory},\"controls\":\"arrows\"}}"),
            format!("{{{mandatory},\"controls\":\"arrows\"}}"),
        ),
        (
            format!("{{{mandatory},\"speed\":1.5e2,\"controls\":\"arrows\"}}"),
            format!("{{{mandatory},\"controls\":\"arrows\"}}"),
        ),
        (
            format!("{{{mandatory},\"controls\":\"arrows\",\"speed\":1.5e2}}"),
            format!("{{{mandatory},\"controls\":\"arrows\"}}"),
        ),
    ] {
        let before = actor_source(&raw);
        let result = patch(&before, json!({}), json!(["speed"]));
        assert_eq!(
            result["afterContent"].as_str().unwrap(),
            before.replace(&raw, &expected)
        );
    }
    let raw = format!("{{{mandatory},\"controls\":\"arrows\"}}");
    let before = actor_source(&raw);
    let result = patch(
        &before,
        json!({"size":[48,64],"position":[11,20]}),
        json!(["controls"]),
    );
    let expected = format!(
        "{{{},\"size\":[48,64]}}",
        mandatory.replace("[1.0e1,2.00e1]", "[11,2.00e1]")
    );
    assert_eq!(
        result["afterContent"].as_str().unwrap(),
        before.replace(&raw, &expected)
    );
    assert_eq!(
        result["changedPaths"],
        json!([
            "/fragments/0/actors/0/position",
            "/fragments/0/actors/0/size",
            "/fragments/0/actors/0/controls"
        ])
    );
}

#[test]
fn missing_reset_fields_are_byte_identical_noops_without_deleting_the_actor() {
    let mut value = recipe();
    value["fragments"][0]["actors"][0]
        .as_object_mut()
        .unwrap()
        .remove("speed");
    let before = text(&value);
    let result = patch(&before, json!({}), json!(["speed"]));
    assert_eq!(result["afterContent"], before);
    assert_eq!(result["changedPaths"], json!([]));
    let mixed = patch(&before, json!({"color":"#abcdef"}), json!(["speed"]));
    assert_eq!(
        mixed["changedPaths"],
        json!(["/fragments/0/actors/0/color"])
    );
}

#[test]
fn invalid_reset_intents_reject_atomically_even_when_setting_other_valid_fields() {
    let before = text(&recipe());
    for reset in [
        json!(["speed", "speed"]),
        json!(["position"]),
        json!(["objectId"]),
        json!(["useProjectionDefaults"]),
        json!(["groupKey"]),
        json!(null),
        json!([1]),
        json!(["speed"]),
    ] {
        assert_eq!(
            run(input(&before, json!({"speed":160}), reset))["ok"],
            false
        );
    }
    for fields in [
        json!({}),
        json!({"instanceId":id(1)}),
        json!({"controls":"wasd"}),
        json!({"size":[0,1]}),
    ] {
        assert_eq!(run(input(&before, fields, json!([])))["ok"], false);
    }
    let mut extra = input(&before, json!({"speed":160}), json!(["color"]));
    extra["resetFields"] = json!([]);
    assert_eq!(run(extra)["ok"], false);
    assert_eq!(
        patch(&before, json!({"speed":160}), json!(["color"]))["changedPaths"],
        json!(["/fragments/0/actors/0/color", "/fragments/0/actors/0/speed"])
    );
}

#[test]
fn mixed_edits_check_only_the_final_byte_budget_and_every_final_placement() {
    let prefix = text(&recipe());
    let before = prefix.clone() + &" ".repeat(128 * 1024 - prefix.len());
    let accepted = patch(
        &before,
        json!({"position":[9999,9999]}),
        json!(["imageResourceId"]),
    );
    assert!(accepted["afterContent"].as_str().unwrap().len() <= 128 * 1024);
    assert_eq!(
        run(input(&before, json!({"position":[9999,9999]}), json!([])))["errorCode"],
        "scene_composition_limit"
    );
    assert_eq!(
        run(input(
            &(before.clone() + " "),
            json!({}),
            json!(["imageResourceId"])
        ))["errorCode"],
        "scene_composition_limit"
    );
    // A reset must not conceal a bad position in a different actor/placement.
    let mut value = recipe();
    value["placements"][1]["offset"] = json!([99990, 0]);
    assert_eq!(
        run(input(&text(&value), json!({}), json!(["imageResourceId"])))["ok"],
        false
    );
}

#[test]
fn duplicate_decoded_fields_and_invalid_unused_fragments_remain_rejected() {
    let before = text(&recipe());
    let duplicate = before.replace(
        "\"schemaVersion\": 1",
        "\"schemaVersion\": 1, \"schemaVersion\": 1",
    );
    assert_eq!(
        run(input(&duplicate, json!({}), json!(["color"])))["ok"],
        false
    );
    let mut value = recipe();
    let mut unused = value["fragments"][0].clone();
    unused["fragmentId"] = json!("unused");
    unused["actors"][1]["controls"] = json!("bad");
    value["fragments"].as_array_mut().unwrap().push(unused);
    assert_eq!(
        run(input(&text(&value), json!({}), json!(["color"])))["ok"],
        false
    );
}
