//! Atomic numeric-token edits of one validated 3D primitive instance.
//! No files, renderer, mutable draft, World or additional scene semantics.
#![forbid(unsafe_code)]

use crate::scene3d::{parse, triple};
use crate::scene_source::{js_number, parse_json_source};
use crate::CoreError;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::ops::Range;

const FIELDS: [(&str, f64, f64); 3] = [
    ("position", -100000.0, 100000.0),
    ("rotationDegrees", -36000.0, 36000.0),
    ("size", 0.001, 1000.0),
];

fn invalid() -> CoreError {
    CoreError {
        error_code: "scene3d_patch_invalid",
        message: "Expected one existing 3D instance and nonempty bounded transform values.",
    }
}

// Deserialize only for exact raw-key admission. Scene/value semantics remain
// owned by the existing parser and triple validator, including numeric bounds.
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct StrictRequest {
    #[serde(rename = "protocolVersion")]
    _protocol_version: Value,
    #[serde(rename = "operation")]
    _operation: Value,
    #[serde(rename = "content")]
    _content: Value,
    #[serde(rename = "instanceId")]
    _instance_id: Value,
    #[serde(rename = "values")]
    _values: StrictValues,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct StrictValues {
    #[serde(rename = "position")]
    _position: Option<Value>,
    #[serde(rename = "rotationDegrees")]
    _rotation_degrees: Option<Value>,
    #[serde(rename = "size")]
    _size: Option<Value>,
}
pub(crate) fn validate_request_bytes(input: &[u8]) -> Result<(), CoreError> {
    serde_json::from_slice::<StrictRequest>(input)
        .map(|_| ())
        .map_err(|_| CoreError::request())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Scene3DPatchResponse {
    pub instance_id: String,
    pub before_content: String,
    pub after_content: String,
    pub changed_paths: Vec<String>,
}

pub(crate) fn dispatch(request: &Value) -> Result<Scene3DPatchResponse, CoreError> {
    let request = request.as_object().ok_or_else(CoreError::request)?;
    let required = [
        "protocolVersion",
        "operation",
        "content",
        "instanceId",
        "values",
    ];
    if request.len() != required.len()
        || required.iter().any(|field| !request.contains_key(*field))
        || request["protocolVersion"].as_f64() != Some(1.0)
        || request["operation"].as_str() != Some("scene3d.patchObjectTransform")
    {
        return Err(CoreError::request());
    }
    let content = request["content"].as_str().ok_or_else(CoreError::request)?;
    let before = parse(content)?;
    let id = request["instanceId"].as_str().ok_or_else(invalid)?;
    let objects = before.model["objects"].as_array().ok_or_else(invalid)?;
    let index = objects
        .iter()
        .position(|object| object["instanceId"].as_str() == Some(id))
        .ok_or_else(invalid)?;
    let values = request["values"].as_object().ok_or_else(invalid)?;
    if values.is_empty()
        || values.len() > FIELDS.len()
        || values
            .keys()
            .any(|field| !FIELDS.iter().any(|(name, _, _)| name == field))
    {
        return Err(invalid());
    }
    let root = parse_json_source(content).map_err(|_| invalid())?;
    let nodes = root
        .get("objects")
        .ok_or_else(invalid)?
        .array()
        .map_err(|_| invalid())?;
    let mut edits: Vec<(Range<usize>, String)> = vec![];
    let mut changed_paths = vec![];
    for (field, min, max) in FIELDS {
        let Some(value) = values.get(field) else {
            continue;
        };
        let new = triple(value, min, max).map_err(|_| invalid())?;
        let old = triple(&objects[index][field], min, max).map_err(|_| invalid())?;
        let components = nodes[index]
            .get(field)
            .ok_or_else(invalid)?
            .array()
            .map_err(|_| invalid())?;
        for axis in 0..3 {
            if old[axis] != new[axis] {
                edits.push((components[axis].span.clone(), js_number(new[axis])));
                changed_paths.push(format!("/objects/{index}/{field}/{axis}"));
            }
        }
    }
    // Logical path order is fixed above, independently of original key order.
    // Physical token order determines splicing; every intervening byte is kept.
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
    Ok(Scene3DPatchResponse {
        instance_id: id.to_owned(),
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
        serde_json::from_str(include_str!("../../../examples/scene3d/scene.json")).unwrap()
    }
    fn text(value: &Value) -> String {
        format!(
            "\u{feff}{}\r\n \t",
            serde_json::to_string_pretty(value)
                .unwrap()
                .replace('\n', "\r\n")
        )
    }
    fn request(content: &str, values: Value) -> Value {
        json!({"protocolVersion":1,"operation":"scene3d.patchObjectTransform","content":content,
            "instanceId":"40000001-1111-4111-8111-111111111111","values":values})
    }
    fn wire(request: &Value) -> Value {
        serde_json::from_slice(&crate::dispatch_json(&serde_json::to_vec(request).unwrap()))
            .unwrap()
    }
    fn parsed(content: &str) -> Value {
        serde_json::from_str(content.strip_prefix('\u{feff}').unwrap_or(content)).unwrap()
    }

    #[test]
    fn one_instance_net_axes_are_patched_in_fixed_logical_path_order() {
        let value = scene();
        let content = text(&value);
        let values = json!({"size":[1.5,4,2],"rotationDegrees":[30,25,-10],"position":[3,1.5,-4]});
        let result = dispatch(&request(&content, values)).unwrap();
        let mut expected = value.clone();
        expected["objects"][1]["position"] = json!([3, 1.5, -4]);
        expected["objects"][1]["rotationDegrees"] = json!([30, 25, -10]);
        expected["objects"][1]["size"] = json!([1.5, 4, 2]);
        assert_eq!(parsed(&result.after_content), expected);
        assert_eq!(result.before_content, content);
        assert_eq!(result.instance_id, "40000001-1111-4111-8111-111111111111");
        assert_eq!(
            result.changed_paths,
            [
                "/objects/1/position/0",
                "/objects/1/position/2",
                "/objects/1/rotationDegrees/0",
                "/objects/1/rotationDegrees/2",
                "/objects/1/size/1",
                "/objects/1/size/2"
            ]
        );
        assert_eq!(
            parse(&result.after_content).unwrap().model["objects"][0],
            value["objects"][0]
        );
        assert_eq!(
            parse(&result.after_content).unwrap().model["objects"][2],
            value["objects"][2]
        );
    }

    #[test]
    fn decoded_keys_identity_bom_crlf_unicode_and_other_numeric_tokens_are_exact() {
        let content = text(&scene())
            .replace("\"objects\"", "\"objec\\u0074s\"")
            .replace("\"position\"", "\"posi\\u0074ion\"")
            .replace("40000001", "4000000\\u0031")
            .replace("1000", "1.000e3")
            .replace("方柱", "方柱🦊")
            .replacen("-2,", "-2.00e0,", 1);
        let root = parse_json_source(&content).unwrap();
        let position = root.get("objects").unwrap().array().unwrap()[1]
            .get("position")
            .unwrap()
            .array()
            .unwrap();
        let mut expected = content.clone();
        expected.replace_range(position[2].span.clone(), "6.125");
        expected.replace_range(position[0].span.clone(), "-8.75");
        let result = dispatch(&request(&content, json!({"position":[-8.75,1.5,6.125]}))).unwrap();
        assert_eq!(result.after_content, expected);
        assert!(result.after_content.contains("1.000e3"));
        assert_eq!(result.before_content, content);
    }

    #[test]
    fn mathematical_noop_keeps_exponents_negative_zero_and_all_raw_bytes() {
        let content = text(&scene())
            .replacen("-2,", "-2.00e0,", 1)
            .replace("1000", "1e3");
        let content = content.replacen(
            "\"rotationDegrees\": [\r\n        0,",
            "\"rotationDegrees\": [\r\n        -0e0,",
            1,
        );
        let result = dispatch(&request(
            &content,
            json!({"position":[-2.0,1.50,0.0],"rotationDegrees":[0,25,0],"size":[1.5,3.0,1.50]}),
        ))
        .unwrap();
        assert_eq!(result.after_content, content);
        assert!(result.changed_paths.is_empty());
    }

    #[test]
    fn original_key_order_does_not_control_changed_path_order() {
        let mut value = scene();
        let object = value["objects"][1].clone();
        let raw = format!("{{\"size\":[1.5,3,1.5],\"position\":[-2,1.5,0],\"rotationDegrees\":[0,25,0],\"instanceId\":{},\"name\":{},\"primitive\":\"box\",\"color\":{}}}", object["instanceId"], object["name"], object["color"]);
        value["objects"][1] = json!("__OBJECT__");
        let content = text(&value).replace("\"__OBJECT__\"", &raw);
        let result = dispatch(&request(
            &content,
            json!({"size":[2,3,1.5],"position":[-2,2,0],"rotationDegrees":[0,30,0]}),
        ))
        .unwrap();
        assert_eq!(
            result.changed_paths,
            [
                "/objects/1/position/1",
                "/objects/1/rotationDegrees/1",
                "/objects/1/size/0"
            ]
        );
        assert_eq!(
            result.after_content,
            content
                .replace("\"size\":[1.5,3,1.5]", "\"size\":[2,3,1.5]")
                .replace("\"position\":[-2,1.5,0]", "\"position\":[-2,2,0]")
                .replace(
                    "\"rotationDegrees\":[0,25,0]",
                    "\"rotationDegrees\":[0,30,0]"
                )
        );
    }

    #[test]
    fn every_transform_bounds_are_inclusive_and_outside_is_atomic_rejection() {
        let content = text(&scene());
        let result = dispatch(&request(&content, json!({"position":[-100000,0,100000],"rotationDegrees":[-36000,0,36000],"size":[0.001,1,1000]}))).unwrap();
        assert_eq!(result.changed_paths.len(), 9);
        for values in [
            json!({"position":[100000.1,0,0]}),
            json!({"position":[0,0,-100000.1]}),
            json!({"rotationDegrees":[36000.1,0,0]}),
            json!({"size":[0.0009,1,1]}),
            json!({"size":[1,1,1000.1]}),
        ] {
            assert_eq!(
                dispatch(&request(&content, values)).unwrap_err().error_code,
                "scene3d_patch_invalid"
            );
        }
        assert_eq!(
            parse(&content).unwrap().model["objects"],
            scene()["objects"]
        );
    }

    #[test]
    fn empty_unknown_partial_non_numeric_or_wrong_shape_values_are_not_repaired() {
        let content = text(&scene());
        for values in [
            json!({}),
            json!({"color":"#123456"}),
            json!({"position":null}),
            json!({"position":[1,2]}),
            json!({"position":[1,2,3,4]}),
            json!({"size":[true,1,1]}),
            json!({"rotationDegrees":[1,"2",3]}),
            json!([1, 2, 3]),
            json!(null),
        ] {
            assert_eq!(
                dispatch(&request(&content, values)).unwrap_err().error_code,
                "scene3d_patch_invalid"
            );
        }
        let mut missing = request(&content, json!({"position":[1,2,3]}));
        missing.as_object_mut().unwrap().remove("instanceId");
        let mut extra = request(&content, json!({"position":[1,2,3]}));
        extra["reset"] = json!(true);
        let mut wrong = request(&content, json!({"position":[1,2,3]}));
        wrong["operation"] = json!("scene3d.parse");
        for req in [missing, extra, wrong] {
            assert_eq!(
                dispatch(&req).unwrap_err().error_code,
                "studio_core_request_invalid"
            );
        }
    }

    #[test]
    fn wrong_missing_or_foreign_identity_cannot_select_by_object_order() {
        let content = text(&scene());
        for id in [
            json!(null),
            json!(1),
            json!("bad"),
            json!("40000009-1111-4111-8111-111111111111"),
        ] {
            let mut req = request(&content, json!({"position":[1,2,3]}));
            req["instanceId"] = id;
            assert_eq!(
                dispatch(&req).unwrap_err().error_code,
                "scene3d_patch_invalid"
            );
        }
    }

    #[test]
    fn complete_original_scene_validation_precedes_noop_or_candidate_repair() {
        let value = scene();
        for mutate in [0, 1, 2, 3] {
            let mut invalid = value.clone();
            match mutate {
                0 => invalid["objects"][2]["size"] = json!([0, 1, 1]),
                1 => invalid["camera"]["position"] = invalid["camera"]["target"].clone(),
                2 => invalid["objects"][1]["position"] = json!([100001, 0, 0]),
                _ => {
                    invalid["objects"][2]["instanceId"] =
                        invalid["objects"][1]["instanceId"].clone()
                }
            }
            assert_eq!(
                dispatch(&request(&text(&invalid), json!({"position":[-2,1.5,0]})))
                    .unwrap_err()
                    .error_code,
                "scene3d_invalid"
            );
        }
    }

    #[test]
    fn decoded_duplicate_and_unknown_source_keys_fail_before_any_patch() {
        let content = text(&scene());
        for raw in [
            content.replace(
                "\"schemaVersion\": 1",
                "\"schemaVersion\": 1, \"schema\\u0056ersion\": 1",
            ),
            content.replacen(
                "\"primitive\": \"box\"",
                "\"primitive\": \"box\", \"unknown\": 1",
                1,
            ),
            content.replacen(
                "\"position\": [",
                "\"position\": [0,0,0], \"posi\\u0074ion\": [",
                1,
            ),
        ] {
            assert_eq!(
                dispatch(&request(&raw, json!({"position":[1,2,3]})))
                    .unwrap_err()
                    .error_code,
                "scene3d_invalid"
            );
        }
    }

    #[test]
    fn exact_original_and_final_utf8_budget_growth_shrink_noop_and_overflow() {
        let mut content = text(&scene());
        content.push_str(&" ".repeat(131072 - content.len()));
        assert_eq!(
            dispatch(&request(&content, json!({"position":[-2,1.5,0]})))
                .unwrap()
                .after_content,
            content
        );
        assert_eq!(
            dispatch(&request(&content, json!({"position":[-100000,1.5,0]})))
                .unwrap_err()
                .error_code,
            "scene3d_limit"
        );
        assert!(
            dispatch(&request(&content, json!({"position":[0,1.5,0]})))
                .unwrap()
                .after_content
                .len()
                < 131072
        );
        content.push(' ');
        assert_eq!(
            dispatch(&request(&content, json!({"position":[0,1.5,0]})))
                .unwrap_err()
                .error_code,
            "scene3d_limit"
        );
    }

    #[test]
    fn raw_request_duplicate_escaped_fields_and_values_are_not_hidden_by_value() {
        let req = request(&text(&scene()), json!({"position":[1,2,3]}));
        let raw = serde_json::to_string(&req).unwrap();
        for input in [
            raw.replacen("\"values\":", "\"values\":{},\"val\\u0075es\":", 1),
            raw.replacen(
                "\"position\":[1,2,3]",
                "\"position\":[0,0,0],\"posi\\u0074ion\":[1,2,3]",
                1,
            ),
            raw.replacen(
                "\"protocolVersion\":1",
                "\"protocolVersion\":1,\"protocolVersion\":1",
                1,
            ),
        ] {
            let result: Value =
                serde_json::from_slice(&crate::dispatch_json(input.as_bytes())).unwrap();
            assert_eq!(result["errorCode"], "studio_core_request_invalid");
        }
    }

    #[test]
    fn wire_response_is_exact_and_stateless_with_independent_optional_probe() {
        assert_eq!(crate::viento_core_scene3d_patch_version(), 1);
        assert_eq!(crate::viento_core_scene3d_version(), 1);
        let req = request(&text(&scene()), json!({"size":[2,3,1.5]}));
        let result = wire(&req);
        assert_eq!(result.as_object().unwrap().len(), 3);
        assert_eq!(result["scene3dPatch"].as_object().unwrap().len(), 4);
        assert_eq!(
            result["scene3dPatch"]["changedPaths"],
            json!(["/objects/1/size/0"])
        );
        assert_eq!(wire(&req), result);
        let parsed = wire(
            &json!({"protocolVersion":1,"operation":"scene3d.parse","content":text(&scene())}),
        );
        assert_eq!(parsed["scene3d"]["model"]["objects"], scene()["objects"]);
    }
}
