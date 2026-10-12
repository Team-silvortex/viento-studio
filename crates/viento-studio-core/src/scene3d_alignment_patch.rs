//! One atomic world-axis position alignment to an explicit selected reference.
//! Position tokens only; no geometry sessions, source writes or rendering.
#![forbid(unsafe_code)]

use crate::scene3d::{parse, triple};
use crate::scene_source::{js_number, parse_json_source};
use crate::CoreError;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashSet;
use std::ops::Range;

fn invalid() -> CoreError {
    CoreError {
        error_code: "scene3d_alignment_invalid",
        message: "Expected at least two existing 3D instances and one selected reference axis.",
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct StrictRequest {
    #[serde(rename = "protocolVersion")]
    _protocol_version: Value,
    #[serde(rename = "operation")]
    _operation: Value,
    #[serde(rename = "content")]
    _content: Value,
    #[serde(rename = "instanceIds")]
    _instance_ids: Value,
    #[serde(rename = "anchorInstanceId")]
    _anchor_instance_id: Value,
    #[serde(rename = "axis")]
    _axis: Value,
}

pub(crate) fn validate_request_bytes(input: &[u8]) -> Result<(), CoreError> {
    serde_json::from_slice::<StrictRequest>(input)
        .map(|_| ())
        .map_err(|_| CoreError::request())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Scene3DAlignmentPatchResponse {
    pub instance_ids: Vec<String>,
    pub anchor_instance_id: String,
    pub axis: String,
    pub before_content: String,
    pub after_content: String,
    pub changed_paths: Vec<String>,
}

pub(crate) fn dispatch(request: &Value) -> Result<Scene3DAlignmentPatchResponse, CoreError> {
    let request = request.as_object().ok_or_else(CoreError::request)?;
    let required = [
        "protocolVersion",
        "operation",
        "content",
        "instanceIds",
        "anchorInstanceId",
        "axis",
    ];
    if request.len() != required.len()
        || required.iter().any(|field| !request.contains_key(*field))
        || request["protocolVersion"].as_f64() != Some(1.0)
        || request["operation"].as_str() != Some("scene3d.alignObjects")
    {
        return Err(CoreError::request());
    }
    let content = request["content"].as_str().ok_or_else(CoreError::request)?;
    let before = parse(content)?;
    let ids = request["instanceIds"].as_array().ok_or_else(invalid)?;
    if ids.len() < 2 || ids.len() > 128 {
        return Err(invalid());
    }
    let mut selected = HashSet::new();
    for id in ids {
        if !selected.insert(id.as_str().ok_or_else(invalid)?) {
            return Err(invalid());
        }
    }
    let anchor_instance_id = request["anchorInstanceId"].as_str().ok_or_else(invalid)?;
    if !selected.contains(anchor_instance_id) {
        return Err(invalid());
    }
    let axis_name = request["axis"].as_str().ok_or_else(invalid)?;
    let axis = match axis_name {
        "x" => 0,
        "y" => 1,
        "z" => 2,
        _ => return Err(invalid()),
    };
    let objects = before.model["objects"].as_array().ok_or_else(invalid)?;
    let anchor = objects
        .iter()
        .find(|object| object["instanceId"].as_str() == Some(anchor_instance_id))
        .ok_or_else(invalid)?;
    let next = triple(&anchor["position"], -100000.0, 100000.0).map_err(|_| invalid())?[axis];
    let root = parse_json_source(content).map_err(|_| invalid())?;
    let nodes = root
        .get("objects")
        .ok_or_else(invalid)?
        .array()
        .map_err(|_| invalid())?;
    let mut instance_ids = vec![];
    let mut edits: Vec<(Range<usize>, String)> = vec![];
    let mut changed_paths = vec![];
    // Iterate the one original source, never intermediate per-object edits.
    // All targets are validated before any candidate text can be returned.
    for (index, object) in objects.iter().enumerate() {
        let id = object["instanceId"].as_str().ok_or_else(invalid)?;
        if !selected.contains(id) {
            continue;
        }
        instance_ids.push(id.to_owned());
        let old = triple(&object["position"], -100000.0, 100000.0).map_err(|_| invalid())?;
        let components = nodes[index]
            .get("position")
            .ok_or_else(invalid)?
            .array()
            .map_err(|_| invalid())?;
        if old[axis] != next {
            edits.push((components[axis].span.clone(), js_number(next)));
            changed_paths.push(format!("/objects/{index}/position/{axis}"));
        }
    }
    if instance_ids.len() != selected.len() {
        return Err(invalid());
    }
    edits.sort_by_key(|(span, _)| span.start);
    let mut after_content = String::with_capacity(content.len());
    let mut cursor = 0;
    for (span, text) in edits {
        after_content.push_str(&content[cursor..span.start]);
        after_content.push_str(&text);
        cursor = span.end;
    }
    after_content.push_str(&content[cursor..]);
    parse(&after_content)?;
    Ok(Scene3DAlignmentPatchResponse {
        instance_ids,
        anchor_instance_id: anchor_instance_id.to_owned(),
        axis: axis_name.to_owned(),
        before_content: content.to_owned(),
        after_content,
        changed_paths,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn scene() -> Value {
        let mut value: Value =
            serde_json::from_str(include_str!("../../../examples/scene3d/scene.json")).unwrap();
        value["objects"][0]["position"] = json!([-2, 1.5, -100000]);
        value["objects"][1]["position"] = json!([100000, -5, 100000]);
        value["objects"][2]["position"] = json!([7, 1.5, 0]);
        value
    }
    fn text(value: &Value) -> String {
        format!(
            "\u{feff}{}\r\n \t",
            serde_json::to_string_pretty(value)
                .unwrap()
                .replace('\n', "\r\n")
        )
    }
    fn ids(value: &Value) -> Vec<String> {
        value["objects"]
            .as_array()
            .unwrap()
            .iter()
            .map(|o| o["instanceId"].as_str().unwrap().to_owned())
            .collect()
    }
    fn request(content: &str, ids: Value, anchor: Value, axis: Value) -> Value {
        json!({"protocolVersion":1,"operation":"scene3d.alignObjects","content":content,"instanceIds":ids,"anchorInstanceId":anchor,"axis":axis})
    }
    fn parsed(content: &str) -> Value {
        serde_json::from_str(content.strip_prefix('\u{feff}').unwrap_or(content)).unwrap()
    }
    fn wire(input: impl AsRef<[u8]>) -> Value {
        serde_json::from_slice(&crate::dispatch_json(input.as_ref())).unwrap()
    }

    #[test]
    fn three_world_axes_use_the_explicit_reference_and_preserve_every_other_semantic() {
        let value = scene();
        let identities = ids(&value);
        let source = text(&value);
        for (axis, name) in ["x", "y", "z"].iter().enumerate() {
            let result = dispatch(&request(
                &source,
                json!([identities[2], identities[0]]),
                json!(identities[2]),
                json!(name),
            ))
            .unwrap();
            let mut expected = value.clone();
            expected["objects"][0]["position"][axis] =
                value["objects"][2]["position"][axis].clone();
            assert_eq!(parsed(&result.after_content), expected);
            assert_eq!(
                result.instance_ids,
                [identities[0].clone(), identities[2].clone()]
            );
            assert_eq!(result.anchor_instance_id, identities[2]);
            assert_eq!(result.axis, *name);
            assert_eq!(
                result.changed_paths,
                if axis == 1 {
                    vec![]
                } else {
                    vec![format!("/objects/0/position/{axis}")]
                }
            );
            assert_eq!(result.before_content, source);
        }
    }
    #[test]
    fn caller_identity_order_never_changes_reference_or_source_ordered_net_paths() {
        let value = scene();
        let identities = ids(&value);
        let source = text(&value);
        let result = dispatch(&request(
            &source,
            json!([identities[2], identities[1], identities[0]]),
            json!(identities[1]),
            json!("x"),
        ))
        .unwrap();
        assert_eq!(result.instance_ids, identities);
        assert_eq!(
            result.changed_paths,
            ["/objects/0/position/0", "/objects/2/position/0"]
        );
        for object in parsed(&result.after_content)["objects"].as_array().unwrap() {
            assert_eq!(object["position"][0], 100000);
        }
    }
    #[test]
    fn only_net_numeric_tokens_change_amid_bom_crlf_unicode_escaped_keys_and_exponents() {
        let value = scene();
        let identities = ids(&value);
        let source = text(&value)
            .replace("\"objects\"", "\"objec\\u0074s\"")
            .replace("\"position\"", "\"posi\\u0074ion\"")
            .replace("1000,", "1.000e3,");
        let root = parse_json_source(&source).unwrap();
        let span = root.get("objects").unwrap().array().unwrap()[2]
            .get("position")
            .unwrap()
            .array()
            .unwrap()[0]
            .span
            .clone();
        let mut expected = source.clone();
        expected.replace_range(span, "-2");
        let result = dispatch(&request(
            &source,
            json!([identities[2], identities[0]]),
            json!(identities[0]),
            json!("x"),
        ))
        .unwrap();
        assert_eq!(result.after_content, expected);
        assert_eq!(result.changed_paths, ["/objects/2/position/0"]);
    }
    #[test]
    fn equal_numbers_keep_negative_zero_and_different_exponent_lexemes() {
        let mut value = scene();
        value["objects"][0]["position"][0] = json!(0);
        value["objects"][2]["position"][0] = json!(0);
        let identities = ids(&value);
        let mut source = text(&value);
        let root = parse_json_source(&source).unwrap();
        let nodes = root.get("objects").unwrap().array().unwrap();
        let span = nodes[2].get("position").unwrap().array().unwrap()[0]
            .span
            .clone();
        source.replace_range(span, "-0e0");
        let result = dispatch(&request(
            &source,
            json!([identities[2], identities[0]]),
            json!(identities[2]),
            json!("x"),
        ))
        .unwrap();
        assert_eq!(result.after_content, source);
        assert!(result.changed_paths.is_empty());
        assert_eq!(result.instance_ids.len(), 2);
    }
    #[test]
    fn direct_reference_assignment_retains_a_subnormal_number_and_extreme_coordinates() {
        let mut value = scene();
        value["objects"][0]["position"][0] = json!(5e-324);
        let identities = ids(&value);
        let result = dispatch(&request(
            &text(&value),
            json!([identities[2], identities[0]]),
            json!(identities[0]),
            json!("x"),
        ))
        .unwrap();
        assert_eq!(
            parsed(&result.after_content)["objects"][2]["position"][0].as_f64(),
            Some(5e-324)
        );
        let result = dispatch(&request(
            &text(&value),
            json!([identities[1], identities[0]]),
            json!(identities[1]),
            json!("z"),
        ))
        .unwrap();
        assert_eq!(
            parsed(&result.after_content)["objects"][0]["position"][2],
            100000
        );
    }
    #[test]
    fn incomplete_repeated_unknown_and_nonselected_reference_sets_fail_atomically() {
        let value = scene();
        let identities = ids(&value);
        let source = text(&value);
        for targets in [
            json!([]),
            json!([identities[0]]),
            json!([identities[0], identities[0]]),
            json!([identities[0], "ffffffff-ffff-ffff-ffff-ffffffffffff"]),
            json!([identities[0], null]),
            json!(null),
        ] {
            assert_eq!(
                dispatch(&request(&source, targets, json!(identities[0]), json!("x")))
                    .unwrap_err()
                    .error_code,
                "scene3d_alignment_invalid"
            );
        }
        for anchor in [
            json!(identities[1]),
            json!("FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF"),
            json!(null),
        ] {
            assert_eq!(
                dispatch(&request(
                    &source,
                    json!([identities[0], identities[2]]),
                    anchor,
                    json!("x")
                ))
                .unwrap_err()
                .error_code,
                "scene3d_alignment_invalid"
            );
        }
        assert_eq!(parsed(&source), value);
    }
    #[test]
    fn axis_is_an_exact_closed_world_axis_without_normalization() {
        let value = scene();
        let identities = ids(&value);
        for axis in [
            json!("X"),
            json!(" x"),
            json!("xy"),
            json!("left"),
            json!(0),
            json!(null),
            json!(["x"]),
        ] {
            assert_eq!(
                dispatch(&request(
                    &text(&value),
                    json!([identities[0], identities[2]]),
                    json!(identities[0]),
                    axis
                ))
                .unwrap_err()
                .error_code,
                "scene3d_alignment_invalid"
            );
        }
    }
    #[test]
    fn invalid_unselected_objects_and_duplicate_source_keys_use_existing_parse_errors() {
        let mut value = scene();
        let identities = ids(&value);
        value["objects"][1]["size"] = json!([0, 1, 1]);
        let result = dispatch(&request(
            &text(&value),
            json!([identities[0], identities[2]]),
            json!(identities[0]),
            json!("x"),
        ))
        .unwrap_err();
        assert_eq!(result.error_code, "scene3d_invalid");
        let source = text(&scene()).replace(
            "\"schemaVersion\": 1",
            "\"schemaVersion\": 1,\"schema\\u0056ersion\":1",
        );
        assert_eq!(
            dispatch(&request(
                &source,
                json!([identities[0], identities[2]]),
                json!(identities[0]),
                json!("x")
            ))
            .unwrap_err()
            .error_code,
            "scene3d_invalid"
        );
    }
    #[test]
    fn final_byte_budget_rejects_growth_without_partial_result_and_accepts_shrink() {
        let mut value = scene();
        value["objects"][0]["position"][0] = json!(100000);
        value["objects"][2]["position"][0] = json!(0);
        let identities = ids(&value);
        let mut source = text(&value);
        source.push_str(&" ".repeat(131072 - source.len()));
        assert_eq!(
            dispatch(&request(
                &source,
                json!([identities[0], identities[2]]),
                json!(identities[0]),
                json!("x")
            ))
            .unwrap_err()
            .error_code,
            "scene3d_limit"
        );
        let shrink = dispatch(&request(
            &source,
            json!([identities[0], identities[2]]),
            json!(identities[2]),
            json!("x"),
        ))
        .unwrap();
        assert!(shrink.after_content.len() < 131072);
        assert_eq!(
            dispatch(&request(
                &(source + " "),
                json!([identities[0], identities[2]]),
                json!(identities[2]),
                json!("x")
            ))
            .unwrap_err()
            .error_code,
            "scene3d_limit"
        );
    }
    #[test]
    fn aggregate_growth_and_shrink_are_admitted_by_final_not_intermediate_byte_budget() {
        let mut value = scene();
        value["objects"][0]["position"][0] = json!(100000);
        value["objects"][1]["position"][0] = json!(0);
        value["objects"][2]["position"][0] = json!(-99999.99999999999);
        let identities = ids(&value);
        let mut source = text(&value);
        source.push_str(&" ".repeat(131072 - source.len()));
        let result = dispatch(&request(
            &source,
            json!(identities),
            json!(identities[0]),
            json!("x"),
        ))
        .unwrap();
        assert!(result.after_content.len() < 131072);
        assert_eq!(
            result.changed_paths,
            ["/objects/1/position/0", "/objects/2/position/0"]
        );
    }
    #[test]
    fn all_128_targets_are_source_ordered_and_anchor_does_not_add_a_net_path() {
        let mut value = scene();
        let object = value["objects"][0].clone();
        value["objects"] = json!((0..128)
            .map(|i| {
                let mut o = object.clone();
                o["instanceId"] = json!(format!("{i:08x}-1111-4111-8111-111111111111"));
                o["position"] = json!([i, 0, 0]);
                o
            })
            .collect::<Vec<_>>());
        let identities = ids(&value);
        let mut reversed = identities.clone();
        reversed.reverse();
        let result = dispatch(&request(
            &text(&value),
            json!(reversed),
            json!(identities[127]),
            json!("x"),
        ))
        .unwrap();
        assert_eq!(result.instance_ids, identities);
        assert_eq!(result.changed_paths.len(), 127);
        assert_eq!(result.changed_paths[126], "/objects/126/position/0");
    }
    #[test]
    fn wire_request_rejects_decoded_duplicate_fields_extra_fields_and_old_operation_mismatch() {
        let value = scene();
        let identities = ids(&value);
        let input = request(
            &text(&value),
            json!([identities[0], identities[2]]),
            json!(identities[0]),
            json!("x"),
        );
        let raw = serde_json::to_string(&input).unwrap();
        for malformed in [
            raw.replace("\"axis\":", "\"ax\\u0069s\":\"y\",\"axis\":"),
            raw.replace(
                "\"anchorInstanceId\":",
                "\"anchorInstanceId\":null,\"anchor\\u0049nstanceId\":",
            ),
            raw.replace(
                "\"instanceIds\":",
                "\"instanceIds\":[],\"instance\\u0049ds\":",
            ),
        ] {
            assert_eq!(wire(malformed)["errorCode"], "studio_core_request_invalid");
        }
        let mut extra = input.clone();
        extra["extra"] = json!(true);
        assert_eq!(
            wire(serde_json::to_vec(&extra).unwrap())["errorCode"],
            "studio_core_request_invalid"
        );
        let mut old = input.clone();
        old["operation"] = json!("scene3d.translateObjects");
        assert_eq!(
            wire(serde_json::to_vec(&old).unwrap())["errorCode"],
            "studio_core_request_invalid"
        );
        assert_eq!(crate::viento_core_scene3d_alignment_version(), 1);
        assert_eq!(wire(raw)["ok"], true);
    }
}
