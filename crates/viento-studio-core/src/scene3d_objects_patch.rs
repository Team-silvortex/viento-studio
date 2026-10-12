//! Source-preserving append/copy/remove of strict 3D primitive declarations.
//! Scene rules remain owned by scene3d; this module never saves or executes.
#![forbid(unsafe_code)]

use crate::scene3d::parse;
use crate::scene_composition_patch::{append_item, remove_items, Edit};
use crate::scene_source::parse_json_source;
use crate::CoreError;
use serde::{Deserialize, Serialize};
use serde_json::Value;

fn invalid() -> CoreError {
    CoreError {
        error_code: "scene3d_objects_invalid",
        message: "Expected a new complete 3D object, an existing copy source or a removable stable instance.",
    }
}

// Exact raw-key admission is separate from scene semantic validation. Option
// fields retain serde's duplicate detection; the action-specific key set below
// also distinguishes omission from explicit null and rejects mixed intents.
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct StrictRequest {
    #[serde(rename = "protocolVersion")]
    _protocol_version: Value,
    #[serde(rename = "operation")]
    _operation: Value,
    #[serde(rename = "content")]
    _content: Value,
    #[serde(rename = "action")]
    _action: Value,
    #[serde(rename = "object")]
    _object: Option<StrictObject>,
    #[serde(rename = "instanceId")]
    _instance_id: Option<Value>,
    #[serde(rename = "newInstanceId")]
    _new_instance_id: Option<Value>,
    #[serde(rename = "name")]
    _name: Option<Value>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct StrictObject {
    #[serde(rename = "instanceId")]
    _instance_id: Value,
    #[serde(rename = "name")]
    _name: Value,
    #[serde(rename = "primitive")]
    _primitive: Value,
    #[serde(rename = "position")]
    _position: Value,
    #[serde(rename = "rotationDegrees")]
    _rotation_degrees: Value,
    #[serde(rename = "size")]
    _size: Value,
    #[serde(rename = "color")]
    _color: Value,
}
pub(crate) fn validate_request_bytes(input: &[u8]) -> Result<(), CoreError> {
    serde_json::from_slice::<StrictRequest>(input)
        .map(|_| ())
        .map_err(|_| CoreError::request())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Scene3DObjectsPatchResponse {
    pub action: String,
    pub instance_id: String,
    pub source_instance_id: Option<String>,
    pub before_content: String,
    pub after_content: String,
    pub changed_paths: Vec<String>,
}

fn splice(content: &str, mut edits: Vec<Edit>) -> String {
    edits.sort_by_key(|edit| edit.span.start);
    let mut output = String::with_capacity(content.len());
    let mut cursor = 0;
    for edit in edits {
        output.push_str(&content[cursor..edit.span.start]);
        output.push_str(&edit.text);
        cursor = edit.span.end;
    }
    output.push_str(&content[cursor..]);
    output
}

pub(crate) fn dispatch(request: &Value) -> Result<Scene3DObjectsPatchResponse, CoreError> {
    let request = request.as_object().ok_or_else(CoreError::request)?;
    let action = request
        .get("action")
        .and_then(Value::as_str)
        .ok_or_else(CoreError::request)?;
    let fields: &[&str] = match action {
        "add" => &["object"],
        "copy" => &["instanceId", "newInstanceId", "name"],
        "remove" => &["instanceId"],
        _ => return Err(CoreError::request()),
    };
    let common = ["protocolVersion", "operation", "content", "action"];
    if request.len() != common.len() + fields.len()
        || common
            .iter()
            .chain(fields)
            .any(|key| !request.contains_key(*key))
        || request["protocolVersion"].as_f64() != Some(1.0)
        || request["operation"].as_str() != Some("scene3d.patchObjects")
    {
        return Err(CoreError::request());
    }
    let content = request["content"].as_str().ok_or_else(CoreError::request)?;
    let before = parse(content)?;
    let objects = before.model["objects"].as_array().ok_or_else(invalid)?;
    let root = parse_json_source(content).map_err(|_| invalid())?;
    let array = root.get("objects").ok_or_else(invalid)?;
    let nodes = array.array().map_err(|_| invalid())?;
    let (id, source_id, index, edits) = if action == "remove" {
        let id = request["instanceId"].as_str().ok_or_else(invalid)?;
        let index = objects
            .iter()
            .position(|object| object["instanceId"].as_str() == Some(id))
            .ok_or_else(invalid)?;
        if objects.len() <= 1 {
            return Err(invalid());
        }
        let spans = nodes
            .iter()
            .map(|node| node.span.clone())
            .collect::<Vec<_>>();
        let removed = (0..objects.len()).map(|i| i == index).collect::<Vec<_>>();
        (id.to_owned(), None, index, remove_items(&spans, &removed))
    } else {
        let (id, source_id, item) = if action == "add" {
            let object = &request["object"];
            let id = object["instanceId"].as_str().ok_or_else(invalid)?;
            (
                id.to_owned(),
                None,
                serde_json::to_string(object).map_err(|_| invalid())?,
            )
        } else {
            let source_id = request["instanceId"].as_str().ok_or_else(invalid)?;
            let id = request["newInstanceId"].as_str().ok_or_else(invalid)?;
            let name = request["name"].as_str().ok_or_else(invalid)?;
            let index = objects
                .iter()
                .position(|object| object["instanceId"].as_str() == Some(source_id))
                .ok_or_else(invalid)?;
            let node = &nodes[index];
            let base = node.span.start;
            let raw = &content[node.span.clone()];
            let mut changes = vec![Edit {
                span: {
                    let span = &node.get("instanceId").ok_or_else(invalid)?.span;
                    span.start - base..span.end - base
                },
                text: serde_json::to_string(id).map_err(|_| invalid())?,
            }];
            if objects[index]["name"].as_str() != Some(name) {
                let span = &node.get("name").ok_or_else(invalid)?.span;
                changes.push(Edit {
                    span: span.start - base..span.end - base,
                    text: serde_json::to_string(name).map_err(|_| invalid())?,
                });
            }
            (
                id.to_owned(),
                Some(source_id.to_owned()),
                splice(raw, changes),
            )
        };
        if objects
            .iter()
            .any(|object| object["instanceId"].as_str() == Some(id.as_str()))
        {
            return Err(invalid());
        }
        let edit = append_item(content, array, item).map_err(|_| invalid())?;
        (id, source_id, objects.len(), vec![edit])
    };
    let after_content = splice(content, edits);
    // Original and final complete documents share the same strict parser and
    // inventory/byte budgets. Nothing is published when the candidate fails.
    parse(&after_content)?;
    Ok(Scene3DObjectsPatchResponse {
        action: action.to_owned(),
        instance_id: id,
        source_instance_id: source_id,
        before_content: content.to_owned(),
        after_content,
        changed_paths: vec![format!("/objects/{index}")],
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    const FIRST: &str = "40000000-1111-4111-8111-111111111111";
    const SECOND: &str = "40000001-1111-4111-8111-111111111111";
    const LAST: &str = "40000002-1111-4111-8111-111111111111";
    const FRESH: &str = "40000003-1111-4111-8111-111111111111";
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
    fn request(content: &str, action: &str) -> Value {
        json!({"protocolVersion":1,"operation":"scene3d.patchObjects","content":content,"action":action})
    }
    fn add(content: &str) -> Value {
        let mut req = request(content, "add");
        let mut object = scene()["objects"][1].clone();
        object["instanceId"] = json!(FRESH);
        req["object"] = object;
        req
    }
    fn copy(content: &str, name: &str) -> Value {
        let mut req = request(content, "copy");
        req["instanceId"] = json!(SECOND);
        req["newInstanceId"] = json!(FRESH);
        req["name"] = json!(name);
        req
    }
    fn remove(content: &str, id: &str) -> Value {
        let mut req = request(content, "remove");
        req["instanceId"] = json!(id);
        req
    }
    fn wire(input: &Value) -> Value {
        serde_json::from_slice(&crate::dispatch_json(&serde_json::to_vec(input).unwrap())).unwrap()
    }
    fn raw_objects(content: &str) -> Vec<String> {
        let root = parse_json_source(content).unwrap();
        root.get("objects")
            .unwrap()
            .array()
            .unwrap()
            .iter()
            .map(|node| content[node.span.clone()].to_owned())
            .collect()
    }

    #[test]
    fn complete_add_is_appended_with_retained_root_and_old_object_tokens() {
        let content = text(&scene());
        let req = add(&content);
        let result = dispatch(&req).unwrap();
        let old = raw_objects(&content);
        let after = raw_objects(&result.after_content);
        assert_eq!(&after[..3], old);
        assert_eq!(after.len(), 4);
        assert_eq!(
            parse(&result.after_content).unwrap().model["objects"][3],
            req["object"]
        );
        assert_eq!(result.action, "add");
        assert_eq!(result.instance_id, FRESH);
        assert!(result.source_instance_id.is_none());
        assert_eq!(result.before_content, content);
        assert_eq!(result.changed_paths, ["/objects/3"]);
    }

    #[test]
    fn copy_changes_only_identity_and_name_value_tokens_not_numbers_keys_or_trivia() {
        let content = text(&scene())
            .replace("\"objects\"", "\"objec\\u0074s\"")
            .replace("\"instanceId\"", "\"ins\\u0074anceId\"")
            .replace("40000001", "4000000\\u0031")
            .replacen("-2,", "-2.000e0,", 1)
            .replace("\"rotationDegrees\": [", "\"rota\\u0074ionDegrees\": [");
        let result = dispatch(&copy(&content, "複製🦊\"\n")).unwrap();
        let original = raw_objects(&content);
        let copied = raw_objects(&result.after_content);
        assert_eq!(&copied[..3], original);
        let expected = original[1]
            .replace("4000000\\u0031-1111-4111-8111-111111111111", FRESH)
            .replace(
                &serde_json::to_string(&scene()["objects"][1]["name"]).unwrap(),
                &serde_json::to_string("複製🦊\"\n").unwrap(),
            );
        assert_eq!(copied[3], expected);
        assert_eq!(result.source_instance_id.as_deref(), Some(SECOND));
        assert_eq!(result.instance_id, FRESH);
        assert_eq!(result.changed_paths, ["/objects/3"]);
    }

    #[test]
    fn same_semantic_copy_name_retains_original_escaped_name_and_negative_zero() {
        let mut value = scene();
        value["objects"][1]["name"] = json!("Name🦊");
        let content = text(&value)
            .replace("Name🦊", "N\\u0061me🦊")
            .replacen("-2,", "-2.0e0,", 1);
        let result = dispatch(&copy(&content, "Name🦊")).unwrap();
        assert_eq!(
            raw_objects(&result.after_content)[3],
            raw_objects(&content)[1].replace(SECOND, FRESH)
        );
        let model = parse(&result.after_content).unwrap().model;
        assert_eq!(model["objects"][3]["name"], "Name🦊");
    }

    #[test]
    fn first_middle_last_removal_preserves_every_other_original_token_and_required_separators() {
        let content = text(&scene());
        let original = raw_objects(&content);
        let root = parse_json_source(&content).unwrap();
        let nodes = root.get("objects").unwrap().array().unwrap();
        for (index, id) in [FIRST, SECOND, LAST].iter().enumerate() {
            let result = dispatch(&remove(&content, id)).unwrap();
            let (start, end) = if index < 2 {
                (nodes[index].span.start, nodes[index + 1].span.start)
            } else {
                (nodes[index - 1].span.end, nodes[index].span.end)
            };
            assert_eq!(
                result.after_content,
                format!("{}{}", &content[..start], &content[end..])
            );
            assert_eq!(
                raw_objects(&result.after_content),
                original
                    .iter()
                    .enumerate()
                    .filter(|(i, _)| *i != index)
                    .map(|(_, raw)| raw.clone())
                    .collect::<Vec<_>>()
            );
            assert_eq!(result.changed_paths, [format!("/objects/{index}")]);
            assert!(result.source_instance_id.is_none());
        }
    }

    #[test]
    fn dense_inline_arrays_and_unusual_whitespace_use_the_same_cst_boundaries() {
        let content = serde_json::to_string(&scene())
            .unwrap()
            .replace("},{", "} \r\n\t, \r\n\t {");
        for id in [FIRST, SECOND, LAST] {
            assert_eq!(
                parse(&dispatch(&remove(&content, id)).unwrap().after_content)
                    .unwrap()
                    .model["objects"]
                    .as_array()
                    .unwrap()
                    .len(),
                2
            );
        }
        for req in [add(&content), copy(&content, "Copy")] {
            let result = dispatch(&req).unwrap();
            assert_eq!(
                raw_objects(&result.after_content)[..3],
                raw_objects(&content)
            );
        }
    }

    #[test]
    fn collision_foreign_identity_copy_self_and_last_remove_fail_without_new_objects() {
        let content = text(&scene());
        let mut collision = add(&content);
        collision["object"]["instanceId"] = json!(FIRST);
        let mut same = copy(&content, "Copy");
        same["newInstanceId"] = json!(SECOND);
        let mut foreign = copy(&content, "Copy");
        foreign["instanceId"] = json!(FRESH);
        let mut only = scene();
        only["objects"].as_array_mut().unwrap().truncate(1);
        for req in [
            collision,
            same,
            foreign,
            remove(&content, FRESH),
            remove(&text(&only), FIRST),
        ] {
            assert_eq!(
                dispatch(&req).unwrap_err().error_code,
                "scene3d_objects_invalid"
            );
        }
    }

    #[test]
    fn explicit_copy_name_is_required_and_semantic_name_bounds_stay_with_scene_parser() {
        let content = text(&scene());
        let mut omitted = copy(&content, "Copy");
        omitted.as_object_mut().unwrap().remove("name");
        assert_eq!(
            dispatch(&omitted).unwrap_err().error_code,
            "studio_core_request_invalid"
        );
        for name in ["", &"🦊".repeat(257)] {
            assert_eq!(
                dispatch(&copy(&content, name)).unwrap_err().error_code,
                "scene3d_invalid"
            );
        }
        assert!(dispatch(&copy(&content, &"🦊".repeat(256))).is_ok());
    }

    #[test]
    fn added_object_is_validated_by_complete_existing_scene_rules() {
        let content = text(&scene());
        for field in [
            "position",
            "size",
            "primitive",
            "instanceId",
            "color",
            "unknown",
        ] {
            let mut req = add(&content);
            req["object"][field] = match field {
                "position" => json!([100001, 0, 0]),
                "size" => json!([0, 1, 1]),
                "primitive" => json!("sphere"),
                "instanceId" => json!("bad"),
                "color" => json!("red"),
                _ => json!(true),
            };
            assert_eq!(dispatch(&req).unwrap_err().error_code, "scene3d_invalid");
        }
    }

    #[test]
    fn original_full_validation_cannot_be_bypassed_by_removing_or_copying_bad_object() {
        let mut invalid = scene();
        invalid["objects"][1]["size"] = json!([0, 1, 1]);
        let content = text(&invalid);
        for req in [
            remove(&content, SECOND),
            copy(&content, "Repair"),
            add(&content),
        ] {
            assert_eq!(dispatch(&req).unwrap_err().error_code, "scene3d_invalid");
        }
        let duplicate = text(&scene()).replace(
            "\"schemaVersion\": 1",
            "\"schemaVersion\": 1,\"schema\\u0056ersion\":1",
        );
        assert_eq!(
            dispatch(&remove(&duplicate, SECOND))
                .unwrap_err()
                .error_code,
            "scene3d_invalid"
        );
    }

    #[test]
    fn exact_union_rejects_extra_mixed_actions_missing_fields_and_wrong_operation() {
        let content = text(&scene());
        let mut mixed = add(&content);
        mixed["instanceId"] = json!(FIRST);
        let mut unknown = remove(&content, FIRST);
        unknown["action"] = json!("rename");
        let mut wrong = remove(&content, FIRST);
        wrong["operation"] = json!("scene3d.patchObjectTransform");
        let mut extra = copy(&content, "Copy");
        extra["offset"] = json!([1, 2, 3]);
        for req in [mixed, unknown, wrong, extra, request(&content, "add")] {
            assert_eq!(
                dispatch(&req).unwrap_err().error_code,
                "studio_core_request_invalid"
            );
        }
    }

    #[test]
    fn raw_request_top_and_full_object_duplicate_decoded_keys_are_rejected() {
        let req = add(&text(&scene()));
        let raw = serde_json::to_string(&req).unwrap();
        for input in [
            raw.replacen(
                "\"action\":\"add\"",
                "\"action\":\"add\",\"act\\u0069on\":\"add\"",
                1,
            ),
            raw.replacen(
                "\"size\":[1.5,3,1.5]",
                "\"size\":[1.5,3,1.5],\"si\\u007ae\":[1.5,3,1.5]",
                1,
            ),
            raw.replacen(
                "\"primitive\":\"box\"",
                "\"primitive\":\"box\",\"primi\\u0074ive\":\"box\"",
                1,
            ),
        ] {
            assert_ne!(input, raw);
            let result: Value =
                serde_json::from_slice(&crate::dispatch_json(input.as_bytes())).unwrap();
            assert_eq!(result["errorCode"], "studio_core_request_invalid");
        }
    }

    #[test]
    fn object_limit_counts_entire_original_and_final_inventory() {
        let mut value = scene();
        let base = value["objects"][0].clone();
        value["objects"] = json!((0..128)
            .map(|n| {
                let mut object = base.clone();
                object["instanceId"] = json!(format!("{n:08x}-1111-4111-8111-111111111111"));
                object
            })
            .collect::<Vec<_>>());
        let content = text(&value);
        let mut copy_req = copy(&content, "Copy");
        copy_req["instanceId"] = value["objects"][0]["instanceId"].clone();
        for req in [add(&content), copy_req] {
            assert_eq!(dispatch(&req).unwrap_err().error_code, "scene3d_limit");
        }
        let result = dispatch(&remove(
            &content,
            value["objects"][127]["instanceId"].as_str().unwrap(),
        ))
        .unwrap();
        assert_eq!(
            parse(&result.after_content).unwrap().model["objects"]
                .as_array()
                .unwrap()
                .len(),
            127
        );
    }

    #[test]
    fn exact_original_final_utf8_budget_rejects_growth_and_allows_remove_shrink() {
        let mut content = text(&scene());
        content.push_str(&" ".repeat(131072 - content.len()));
        for req in [add(&content), copy(&content, "Copy")] {
            assert_eq!(dispatch(&req).unwrap_err().error_code, "scene3d_limit");
        }
        assert!(
            dispatch(&remove(&content, SECOND))
                .unwrap()
                .after_content
                .len()
                < 131072
        );
        content.push(' ');
        assert_eq!(
            dispatch(&remove(&content, SECOND)).unwrap_err().error_code,
            "scene3d_limit"
        );
    }

    #[test]
    fn wire_receipt_has_one_exact_path_and_stable_independent_capability() {
        assert_eq!(crate::viento_core_scene3d_objects_version(), 1);
        assert_eq!(crate::viento_core_scene3d_version(), 1);
        assert_eq!(crate::viento_core_scene3d_patch_version(), 1);
        for req in [
            add(&text(&scene())),
            copy(&text(&scene()), "Copy"),
            remove(&text(&scene()), SECOND),
        ] {
            let result = wire(&req);
            assert_eq!(result.as_object().unwrap().len(), 3);
            assert_eq!(result["scene3dObjectsPatch"].as_object().unwrap().len(), 6);
            assert_eq!(wire(&req), result);
            assert_eq!(
                result["scene3dObjectsPatch"]["changedPaths"]
                    .as_array()
                    .unwrap()
                    .len(),
                1
            );
        }
    }
}
