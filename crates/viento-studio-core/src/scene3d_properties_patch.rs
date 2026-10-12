//! Exact string-value token edits for one existing 3D object's name/color.
//! Full source and final author rules remain owned by the scene3d parser.
#![forbid(unsafe_code)]

use crate::scene3d::parse;
use crate::scene_source::parse_json_source;
use crate::CoreError;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::ops::Range;

fn invalid() -> CoreError {
    CoreError {
        error_code: "scene3d_properties_invalid",
        message: "Expected an existing 3D instance and nonempty explicit name/color values.",
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
    #[serde(rename = "instanceId")]
    _instance_id: Value,
    #[serde(rename = "values")]
    _values: StrictValues,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct StrictValues {
    #[serde(rename = "name")]
    _name: Option<Value>,
    #[serde(rename = "color")]
    _color: Option<Value>,
}
pub(crate) fn validate_request_bytes(input: &[u8]) -> Result<(), CoreError> {
    serde_json::from_slice::<StrictRequest>(input)
        .map(|_| ())
        .map_err(|_| CoreError::request())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Scene3DPropertiesPatchResponse {
    pub before_content: String,
    pub after_content: String,
    pub changed_paths: Vec<String>,
}

pub(crate) fn dispatch(request: &Value) -> Result<Scene3DPropertiesPatchResponse, CoreError> {
    let request = request.as_object().ok_or_else(CoreError::request)?;
    let keys = [
        "protocolVersion",
        "operation",
        "content",
        "instanceId",
        "values",
    ];
    if request.len() != keys.len()
        || keys.iter().any(|key| !request.contains_key(*key))
        || request["protocolVersion"].as_f64() != Some(1.0)
        || request["operation"].as_str() != Some("scene3d.patchProperties")
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
        || values
            .keys()
            .any(|key| !["name", "color"].contains(&key.as_str()))
    {
        return Err(invalid());
    }
    let root = parse_json_source(content).map_err(|_| invalid())?;
    let node = &root
        .get("objects")
        .ok_or_else(invalid)?
        .array()
        .map_err(|_| invalid())?[index];
    let mut edits: Vec<(Range<usize>, String)> = vec![];
    let mut changed_paths = vec![];
    for field in ["name", "color"] {
        let Some(value) = values.get(field) else {
            continue;
        };
        let value = value.as_str().ok_or_else(invalid)?;
        if objects[index][field].as_str() == Some(value) {
            continue;
        }
        let text = serde_json::to_string(value).map_err(|_| invalid())?;
        edits.push((node.get(field).ok_or_else(invalid)?.span.clone(), text));
        changed_paths.push(format!("/objects/{index}/{field}"));
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
    parse(&after_content).map_err(|error| {
        if error.error_code == "scene3d_limit" {
            error
        } else {
            invalid()
        }
    })?;
    Ok(Scene3DPropertiesPatchResponse {
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
        value["objects"][1]["name"] = json!("Target");
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
    fn request(content: &str, values: Value) -> Value {
        json!({"protocolVersion":1,"operation":"scene3d.patchProperties","content":content,"instanceId":"40000001-1111-4111-8111-111111111111","values":values})
    }
    fn wire(input: &str) -> Value {
        serde_json::from_slice(&crate::dispatch_json(input.as_bytes())).unwrap()
    }

    #[test]
    fn both_properties_are_patched_only_at_exact_target_values_in_name_color_order() {
        let content = text(&scene());
        let values = json!({"color":"#123456","name":"New name / 新名 / 名前🦊"});
        let result = dispatch(&request(&content, values.clone())).unwrap();
        assert_eq!(
            result.changed_paths,
            ["/objects/1/name", "/objects/1/color"]
        );
        let root = parse_json_source(&content).unwrap();
        let object = &root.get("objects").unwrap().array().unwrap()[1];
        let mut expected = content.clone();
        let mut edits = [
            ("name", object.get("name").unwrap().span.clone()),
            ("color", object.get("color").unwrap().span.clone()),
        ];
        edits.sort_by_key(|(_, range)| std::cmp::Reverse(range.start));
        for (field, span) in edits {
            expected.replace_range(span, &serde_json::to_string(&values[field]).unwrap());
        }
        assert_eq!(result.after_content, expected);
        assert_eq!(result.before_content, content);
        let after = parse(&result.after_content).unwrap().model;
        assert_eq!(after["objects"][1]["name"], values["name"]);
        assert_eq!(after["objects"][1]["color"], values["color"]);
    }

    #[test]
    fn individual_and_mixed_noop_fields_do_not_become_extra_paths() {
        let content = text(&scene());
        for (values, paths) in [
            (json!({"name":"New"}), vec!["/objects/1/name"]),
            (json!({"color":"#123456"}), vec!["/objects/1/color"]),
            (
                json!({"name":"Target","color":"#123456"}),
                vec!["/objects/1/color"],
            ),
        ] {
            assert_eq!(
                dispatch(&request(&content, values)).unwrap().changed_paths,
                paths
            );
        }
    }

    #[test]
    fn escaped_identity_keys_name_color_and_all_numeric_lexemes_stay_exact() {
        let content = text(&scene())
            .replace("40000001", "4000000\\u0031")
            .replace("\"name\"", "\"na\\u006de\"")
            .replace("\"color\"", "\"co\\u006cor\"")
            .replace("Target", "Tar\\u0067et")
            .replace("#87d8b9", "#87d8\\u00629")
            .replace("1000", "1.000e3")
            .replace("-2,", "-2.00e0,");
        let noop = dispatch(&request(
            &content,
            json!({"name":"Target","color":"#87d8b9"}),
        ))
        .unwrap();
        assert_eq!(noop.after_content, content);
        assert!(noop.changed_paths.is_empty());
        let result = dispatch(&request(&content, json!({"name":"Changed"}))).unwrap();
        assert!(result.after_content.contains("1.000e3"));
        assert!(result.after_content.contains("-2.00e0"));
        assert!(result.after_content.contains("#87d8\\u00629"));
        assert!(result.after_content.contains("na\\u006de"));
    }

    #[test]
    fn names_with_quotes_controls_non_bmp_and_backslashes_are_canonical_value_strings() {
        let content = text(&scene());
        let name = "quote\" slash\\ newline\n tab\t null\0 中文日本語🦊\u{2028}";
        let result = dispatch(&request(&content, json!({"name":name}))).unwrap();
        assert_eq!(
            parse(&result.after_content).unwrap().model["objects"][1]["name"],
            name
        );
        assert!(result
            .after_content
            .contains(&serde_json::to_string(name).unwrap()));
        assert_eq!(result.changed_paths, ["/objects/1/name"]);
    }

    #[test]
    fn unicode_codepoint_name_and_hex_color_rules_come_from_existing_parser() {
        let content = text(&scene());
        for name in ["x".to_owned(), "🦊".repeat(256), "日".repeat(256)] {
            dispatch(&request(&content, json!({"name":name,"color":"#ABCDEF"}))).unwrap();
        }
        for values in [
            json!({"name":""}),
            json!({"name":"🦊".repeat(257)}),
            json!({"color":"red"}),
            json!({"color":"#12345"}),
            json!({"color":"#zzzzzz"}),
        ] {
            assert_eq!(
                dispatch(&request(&content, values)).unwrap_err().error_code,
                "scene3d_properties_invalid"
            );
        }
    }

    #[test]
    fn color_name_key_source_order_cannot_change_logical_paths() {
        let mut value = scene();
        let object = value["objects"][1].clone();
        value["objects"][1] = json!("__TARGET__");
        let raw=format!("{{\"color\":\"#87d8b9\",\"size\":[1.5,3,1.5],\"name\":\"Target\",\"position\":[-2,1.5,-0e0],\"rotationDegrees\":[0,25,0],\"primitive\":\"box\",\"instanceId\":{}}}",object["instanceId"]);
        let content = text(&value).replace("\"__TARGET__\"", &raw);
        let result = dispatch(&request(
            &content,
            json!({"color":"#ffffff","name":"Other"}),
        ))
        .unwrap();
        assert_eq!(
            result.changed_paths,
            ["/objects/1/name", "/objects/1/color"]
        );
        assert!(result.after_content.contains("[-2,1.5,-0e0]"));
    }

    #[test]
    fn source_string_values_matching_keys_identity_or_other_names_are_not_identity_locators() {
        let mut value = scene();
        value["objects"][0]["name"] = json!("Target");
        value["objects"][1]["name"] = json!("color");
        let content = text(&value);
        let result = dispatch(&request(
            &content,
            json!({"name":"40000000-1111-4111-8111-111111111111"}),
        ))
        .unwrap();
        let after = parse(&result.after_content).unwrap().model;
        assert_eq!(after["objects"][0], value["objects"][0]);
        assert_eq!(after["objects"][2], value["objects"][2]);
        assert_eq!(
            after["objects"][1]["instanceId"],
            value["objects"][1]["instanceId"]
        );
    }

    #[test]
    fn null_unknown_empty_numeric_fields_and_missing_or_foreign_identity_are_rejected() {
        let content = text(&scene());
        for values in [
            json!({}),
            json!(null),
            json!({"name":null}),
            json!({"color":7}),
            json!({"name":["name"]}),
            json!({"position":[1,2,3]}),
            json!({"instanceId":"40000000-1111-4111-8111-111111111111"}),
        ] {
            assert!(dispatch(&request(&content, values)).is_err());
        }
        let mut value = request(&content, json!({"name":"Changed"}));
        value["instanceId"] = json!("40000009-1111-4111-8111-111111111111");
        assert_eq!(
            dispatch(&value).unwrap_err().error_code,
            "scene3d_properties_invalid"
        );
        value = request(&content, json!({"name":"Changed"}));
        value["extra"] = json!(true);
        assert_eq!(
            dispatch(&value).unwrap_err().error_code,
            "studio_core_request_invalid"
        );
    }

    #[test]
    fn raw_request_duplicates_include_decoded_keys_and_null_first_occurrence() {
        let content = serde_json::to_string(&text(&scene())).unwrap();
        let common=format!("\"protocolVersion\":1,\"operation\":\"scene3d.patchProperties\",\"content\":{content},\"instanceId\":\"40000001-1111-4111-8111-111111111111\"");
        for raw in [
            format!("{{{common},\"protocolVersion\":1,\"values\":{{\"name\":\"Changed\"}}}}"),
            format!("{{{common},\"values\":{{\"name\":null,\"na\\u006de\":\"Changed\"}}}}"),
            format!(
                "{{{common},\"values\":{{\"color\":\"#123456\",\"co\\u006cor\":\"#ffffff\"}}}}"
            ),
            format!("{{{common},\"values\":{{\"name\":\"A\"}},\"values\":{{\"name\":\"B\"}}}}"),
        ] {
            let result = wire(&raw);
            assert_eq!(result["ok"], false);
            assert_eq!(result["errorCode"], "studio_core_request_invalid");
        }
    }

    #[test]
    fn full_original_scene_validation_precedes_attempted_property_repair() {
        let mut value = scene();
        value["objects"][1]["name"] = json!("");
        assert_eq!(
            dispatch(&request(&text(&value), json!({"name":"Repaired"})))
                .unwrap_err()
                .error_code,
            "scene3d_invalid"
        );
        value = scene();
        value["camera"]["near"] = json!(0);
        assert_eq!(
            dispatch(&request(&text(&value), json!({"name":"Changed"})))
                .unwrap_err()
                .error_code,
            "scene3d_invalid"
        );
        let duplicate =
            text(&scene()).replace("\"name\": \"Target\"", "\"name\":\"A\",\"name\":\"Target\"");
        assert_eq!(
            dispatch(&request(&duplicate, json!({"name":"Changed"})))
                .unwrap_err()
                .error_code,
            "scene3d_invalid"
        );
    }

    #[test]
    fn whole_utf8_budget_includes_unicode_growth_and_allows_noop_or_exact_shrink() {
        let mut content = text(&scene());
        content.push_str(&" ".repeat(128 * 1024 - content.len()));
        assert_eq!(
            dispatch(&request(&content, json!({"name":"Target"})))
                .unwrap()
                .after_content,
            content
        );
        assert_eq!(
            dispatch(&request(&content, json!({"name":"🦊".repeat(256)})))
                .unwrap_err()
                .error_code,
            "scene3d_limit"
        );
        assert_eq!(
            dispatch(&request(&content, json!({"name":"a"})))
                .unwrap()
                .after_content
                .len(),
            content.len() - 5
        );
        assert_eq!(
            dispatch(&request(&(content + " "), json!({"name":"a"})))
                .unwrap_err()
                .error_code,
            "scene3d_limit"
        );
    }

    #[test]
    fn independent_probe_and_wire_receipt_have_no_identity_or_structural_side_effects() {
        let content = text(&scene());
        let result =
            wire(&serde_json::to_string(&request(&content, json!({"name":"Target"}))).unwrap());
        assert_eq!(crate::viento_core_scene3d_properties_version(), 1);
        assert_eq!(crate::viento_core_scene3d_environment_version(), 1);
        assert_eq!(result.as_object().unwrap().len(), 3);
        let receipt = &result["scene3dPropertiesPatch"];
        assert_eq!(receipt.as_object().unwrap().len(), 3);
        assert_eq!(receipt["beforeContent"], content);
        assert_eq!(receipt["afterContent"], content);
        assert_eq!(receipt["changedPaths"], json!([]));
    }
}
