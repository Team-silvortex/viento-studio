//! One atomic removal of existing 3D declarations, preserving survivor bytes.
#![forbid(unsafe_code)]
use crate::scene3d::parse;
use crate::scene_composition_patch::{remove_items, Edit};
use crate::scene_source::parse_json_source;
use crate::CoreError;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashSet;

fn invalid() -> CoreError {
    CoreError {
        error_code: "scene3d_removal_invalid",
        message:
            "Expected distinct existing 3D removal identities and at least one remaining object.",
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
}
pub(crate) fn validate_request_bytes(input: &[u8]) -> Result<(), CoreError> {
    serde_json::from_slice::<StrictRequest>(input)
        .map(|_| ())
        .map_err(|_| CoreError::request())
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Scene3DRemovalPatchResponse {
    pub instance_ids: Vec<String>,
    pub before_content: String,
    pub after_content: String,
    pub changed_paths: Vec<String>,
}
fn uuid(value: &Value) -> Result<&str, CoreError> {
    let text = value.as_str().ok_or_else(invalid)?;
    if text.len() != 36
        || !text.bytes().enumerate().all(|(i, b)| {
            if matches!(i, 8 | 13 | 18 | 23) {
                b == b'-'
            } else {
                b.is_ascii_digit() || (b'a'..=b'f').contains(&b)
            }
        })
    {
        return Err(invalid());
    }
    Ok(text)
}
fn splice(content: &str, edits: Vec<Edit>) -> Result<String, CoreError> {
    let mut output = String::with_capacity(content.len());
    let mut cursor = 0;
    for edit in edits {
        if edit.span.start < cursor || edit.span.end < edit.span.start {
            return Err(invalid());
        }
        output.push_str(&content[cursor..edit.span.start]);
        output.push_str(&edit.text);
        cursor = edit.span.end;
    }
    output.push_str(&content[cursor..]);
    Ok(output)
}
pub(crate) fn dispatch(request: &Value) -> Result<Scene3DRemovalPatchResponse, CoreError> {
    let request = request.as_object().ok_or_else(CoreError::request)?;
    let fields = ["protocolVersion", "operation", "content", "instanceIds"];
    if request.len() != fields.len()
        || fields.iter().any(|key| !request.contains_key(*key))
        || request["protocolVersion"].as_f64() != Some(1.0)
        || request["operation"].as_str() != Some("scene3d.removeObjects")
    {
        return Err(CoreError::request());
    }
    let content = request["content"].as_str().ok_or_else(CoreError::request)?;
    // Original parsing and its complete byte/object budgets precede intent
    // admission. Removing objects never repairs an invalid source document.
    let before = parse(content)?;
    let objects = before.model["objects"].as_array().ok_or_else(invalid)?;
    let ids = request["instanceIds"].as_array().ok_or_else(invalid)?;
    if ids.is_empty() || ids.len() > 128 {
        return Err(invalid());
    }
    let mut selected = HashSet::new();
    for id in ids {
        if !selected.insert(uuid(id)?) {
            return Err(invalid());
        }
    }
    let removed = objects
        .iter()
        .map(|object| {
            object["instanceId"]
                .as_str()
                .map(|id| selected.contains(id))
                .ok_or_else(invalid)
        })
        .collect::<Result<Vec<_>, _>>()?;
    let selected_count = removed.iter().filter(|value| **value).count();
    if selected_count != selected.len() || selected_count >= objects.len() {
        return Err(invalid());
    }
    let root = parse_json_source(content).map_err(|_| invalid())?;
    let nodes = root
        .get("objects")
        .ok_or_else(invalid)?
        .array()
        .map_err(|_| invalid())?;
    let spans = nodes
        .iter()
        .map(|node| node.span.clone())
        .collect::<Vec<_>>();
    // One set of original contiguous runs, one splice, one complete final parse.
    let after_content = splice(content, remove_items(&spans, &removed))?;
    parse(&after_content)?;
    let mut instance_ids = Vec::new();
    let mut changed_paths = Vec::new();
    for (index, object) in objects.iter().enumerate() {
        if removed[index] {
            instance_ids.push(
                object["instanceId"]
                    .as_str()
                    .ok_or_else(invalid)?
                    .to_owned(),
            );
            changed_paths.push(format!("/objects/{index}"));
        }
    }
    Ok(Scene3DRemovalPatchResponse {
        instance_ids,
        before_content: content.to_owned(),
        after_content,
        changed_paths,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    fn id(i: usize) -> String {
        format!("{i:08x}-1111-4111-8111-111111111111")
    }
    fn scene(count: usize) -> Value {
        let mut value: Value =
            serde_json::from_str(include_str!("../../../examples/scene3d/scene.json")).unwrap();
        let prototype = value["objects"][1].clone();
        value["objects"] = json!((1..=count)
            .map(|i| {
                let mut object = prototype.clone();
                object["instanceId"] = json!(id(i));
                object["name"] = json!(format!("Same 名前🦊 {i}"));
                object["position"] = json!([i as f64, 0.0, -0.0]);
                object
            })
            .collect::<Vec<_>>());
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
    fn request(content: &str, ids: &[usize]) -> Value {
        json!({"protocolVersion":1,"operation":"scene3d.removeObjects","content":content,"instanceIds":ids.iter().map(|i|id(*i)).collect::<Vec<_>>()})
    }
    fn wire(input: impl AsRef<[u8]>) -> Value {
        serde_json::from_slice(&crate::dispatch_json(input.as_ref())).unwrap()
    }
    fn parsed(content: &str) -> Value {
        serde_json::from_str(content.strip_prefix('\u{feff}').unwrap_or(content)).unwrap()
    }
    fn check(indices: &[usize]) {
        let source = text(&scene(7));
        let result = dispatch(&request(&source, indices)).unwrap();
        let ids = indices.iter().copied().collect::<HashSet<_>>();
        let expected = (1..=7).filter(|i| ids.contains(i)).collect::<Vec<_>>();
        assert_eq!(
            result.instance_ids,
            expected.iter().map(|i| id(*i)).collect::<Vec<_>>()
        );
        assert_eq!(
            result.changed_paths,
            expected
                .iter()
                .map(|i| format!("/objects/{}", i - 1))
                .collect::<Vec<_>>()
        );
        assert_eq!(result.before_content, source);
        let mut value = scene(7);
        value["objects"] = json!(value["objects"]
            .as_array()
            .unwrap()
            .iter()
            .enumerate()
            .filter(|(i, _)| !ids.contains(&(i + 1)))
            .map(|(_, o)| o.clone())
            .collect::<Vec<_>>());
        assert_eq!(parsed(&result.after_content), value);
        let after = parse(&result.after_content).unwrap();
        let mut survivor = 0;
        for i in 0..7 {
            if ids.contains(&(i + 1)) {
                continue;
            }
            let original_tree = parse_json_source(&source).unwrap();
            let new_tree = parse_json_source(&result.after_content).unwrap();
            let a = &original_tree.get("objects").unwrap().array().unwrap()[i].span;
            let b = &new_tree.get("objects").unwrap().array().unwrap()[survivor].span;
            assert_eq!(&source[a.clone()], &result.after_content[b.clone()]);
            survivor += 1;
        }
        assert_eq!(survivor, after.model["objects"].as_array().unwrap().len());
        assert!(result.after_content.starts_with('\u{feff}'));
        assert!(result.after_content.ends_with("\r\n \t"));
    }
    #[test]
    fn first_run_preserves_survivors() {
        check(&[2, 1]);
    }
    #[test]
    fn middle_run_preserves_survivors() {
        check(&[4, 3]);
    }
    #[test]
    fn final_run_preserves_survivors() {
        check(&[7, 6]);
    }
    #[test]
    fn alternating_runs_use_original_indices() {
        check(&[7, 1, 5, 3]);
    }
    #[test]
    fn singleton_first_middle_last() {
        for i in [1, 4, 7] {
            check(&[i]);
        }
    }
    #[test]
    fn leading_and_trailing_runs_share_one_candidate() {
        check(&[7, 2, 1, 6]);
    }
    #[test]
    fn removes_127_of_128_with_one_remaining() {
        let content = serde_json::to_string(&scene(128)).unwrap();
        let result = dispatch(&request(&content, &(1..128).rev().collect::<Vec<_>>())).unwrap();
        assert_eq!(result.instance_ids.len(), 127);
        assert_eq!(result.changed_paths.last().unwrap(), "/objects/126");
        assert_eq!(
            parsed(&result.after_content)["objects"],
            json!([scene(128)["objects"][127].clone()])
        );
    }
    #[test]
    fn all_128_and_single_scene_last_object_are_invalid() {
        for (count, ids) in [(128, (1..=128).collect::<Vec<_>>()), (1, vec![1])] {
            assert_eq!(
                dispatch(&request(&text(&scene(count)), &ids))
                    .unwrap_err()
                    .error_code,
                "scene3d_removal_invalid"
            );
        }
    }
    #[test]
    fn empty_duplicate_unknown_overlong_and_non_uuid_intents_are_invalid() {
        let content = text(&scene(7));
        for ids in [
            json!([]),
            json!([id(1), id(1)]),
            json!([id(99)]),
            json!((1..=129).map(id).collect::<Vec<_>>()),
            json!(["FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF"]),
            json!([null]),
            json!([1]),
            json!({}),
        ] {
            let mut req = request(&content, &[1]);
            req["instanceIds"] = ids;
            assert_eq!(
                dispatch(&req).unwrap_err().error_code,
                "scene3d_removal_invalid"
            );
        }
    }
    #[test]
    fn original_budget_precedes_intent_and_removal_cannot_repair_it() {
        let mut content = text(&scene(7));
        content.push_str(&" ".repeat(128 * 1024 - content.len() + 1));
        assert_eq!(
            dispatch(&request(&content, &[])).unwrap_err().error_code,
            "scene3d_limit"
        );
        assert_eq!(
            dispatch(&request(&serde_json::to_string(&scene(129)).unwrap(), &[1]))
                .unwrap_err()
                .error_code,
            "scene3d_limit"
        );
    }
    #[test]
    fn exact_byte_budget_source_can_shrink() {
        let mut content = serde_json::to_string(&scene(2)).unwrap();
        content.push_str(&" ".repeat(128 * 1024 - content.len()));
        let result = dispatch(&request(&content, &[1])).unwrap();
        assert!(result.after_content.len() < 128 * 1024);
        assert!(result.after_content.ends_with(' '));
    }
    #[test]
    fn invalid_source_errors_match_original_parser() {
        for content in [
            "{}".to_owned(),
            "{".to_owned(),
            text(&scene(0)),
            text(&scene(2)).replace("\"primitive\": \"box\"", "\"primitive\": \"sphere\""),
        ] {
            let error = parse(&content).unwrap_err().error_code;
            assert_eq!(
                dispatch(&request(&content, &[1])).unwrap_err().error_code,
                error
            );
        }
    }
    #[test]
    fn bom_crlf_unicode_escaped_key_and_authored_tokens_survive() {
        let content = text(&scene(3))
            .replace("\"objects\"", "\"obje\\u0063ts\"")
            .replace("1.0,", "1e0,")
            .replace("-0.0", "-0e0");
        let result = dispatch(&request(&content, &[2])).unwrap();
        assert!(result.after_content.contains("\"obje\\u0063ts\""));
        assert!(result.after_content.contains("-0e0"));
        assert!(result.after_content.contains("名前🦊"));
        let tree = parse_json_source(&content).unwrap();
        let newtree = parse_json_source(&result.after_content).unwrap();
        for (i, j) in [(0, 0), (2, 1)] {
            assert_eq!(
                &content[tree.get("objects").unwrap().array().unwrap()[i]
                    .span
                    .clone()],
                &result.after_content[newtree.get("objects").unwrap().array().unwrap()[j]
                    .span
                    .clone()]
            );
        }
    }
    #[test]
    fn exact_four_field_receipt_and_independent_abi() {
        assert_eq!(crate::viento_core_scene3d_removal_version(), 1);
        assert_eq!(crate::viento_core_scene3d_copy_version(), 1);
        let result = wire(serde_json::to_vec(&request(&text(&scene(3)), &[3, 1])).unwrap());
        assert_eq!(result.as_object().unwrap().len(), 3);
        assert_eq!(result["scene3dRemovalPatch"].as_object().unwrap().len(), 4);
        assert_eq!(
            result["scene3dRemovalPatch"]["instanceIds"],
            json!([id(1), id(3)])
        );
    }
    #[test]
    fn raw_duplicate_decoded_and_unknown_request_keys_are_rejected() {
        let req = serde_json::to_string(&request(&text(&scene(3)), &[1])).unwrap();
        for raw in [
            req.replacen('{', "{\"instanceIds\":[],", 1),
            req.replacen('{', "{\"instance\\u0049ds\":[],", 1),
            req.replacen('{', "{\"unknown\":true,", 1),
            req.replacen('{', "{\"protocolVersion\":1,", 1),
            req.replacen('{', "{\"operation\":\"scene3d.removeObjects\",", 1),
        ] {
            assert_eq!(wire(raw)["errorCode"], "studio_core_request_invalid");
        }
    }
    #[test]
    fn invalid_utf8_and_trailing_json_never_enter_the_author_operation() {
        assert_eq!(wire(b"\xff")["errorCode"], "studio_core_request_invalid");
        let mut bytes = serde_json::to_vec(&request(&text(&scene(3)), &[1])).unwrap();
        bytes.push(255);
        assert_eq!(wire(bytes)["errorCode"], "studio_core_request_invalid");
    }
    #[test]
    fn malformed_envelope_and_legacy_intents_are_rejected() {
        let base = request(&text(&scene(3)), &[1]);
        for key in ["protocolVersion", "operation", "content", "instanceIds"] {
            let mut req = base.clone();
            req.as_object_mut().unwrap().remove(key);
            assert_eq!(
                dispatch(&req).unwrap_err().error_code,
                "studio_core_request_invalid"
            );
        }
        for (key, value) in [
            ("protocolVersion", json!(2)),
            ("operation", json!("scene3d.patchObjects")),
            ("content", json!(null)),
            ("action", json!("remove")),
        ] {
            let mut req = base.clone();
            req[key] = value;
            assert_eq!(
                dispatch(&req).unwrap_err().error_code,
                "studio_core_request_invalid"
            );
        }
    }
}
