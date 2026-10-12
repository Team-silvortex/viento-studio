//! One atomic append of raw copies of existing 3D declarations.
//! Names and all authored tokens survive except new identities/net positions.
#![forbid(unsafe_code)]
use crate::scene3d::{parse, triple};
use crate::scene_composition_patch::{append_item, Edit};
use crate::scene_source::{js_number, parse_json_source};
use crate::CoreError;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{HashMap, HashSet};

fn invalid() -> CoreError {
    CoreError { error_code: "scene3d_copy_invalid", message: "Expected distinct existing 3D copy sources, fresh identities and one bounded shared position offset." }
}
fn limit() -> CoreError {
    CoreError {
        error_code: "scene3d_limit",
        message: "3D scenes support at most 128 KiB and 128 objects.",
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
    #[serde(rename = "copies")]
    _copies: Vec<StrictCopy>,
    #[serde(rename = "offset")]
    _offset: Value,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct StrictCopy {
    #[serde(rename = "sourceInstanceId")]
    _source_instance_id: Value,
    #[serde(rename = "newInstanceId")]
    _new_instance_id: Value,
}
pub(crate) fn validate_request_bytes(input: &[u8]) -> Result<(), CoreError> {
    serde_json::from_slice::<StrictRequest>(input)
        .map(|_| ())
        .map_err(|_| CoreError::request())
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CopyIdentity {
    pub source_instance_id: String,
    pub new_instance_id: String,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Scene3DCopyPatchResponse {
    pub copies: Vec<CopyIdentity>,
    pub offset: [f64; 3],
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
pub(crate) fn dispatch(request: &Value) -> Result<Scene3DCopyPatchResponse, CoreError> {
    let request = request.as_object().ok_or_else(CoreError::request)?;
    let fields = [
        "protocolVersion",
        "operation",
        "content",
        "copies",
        "offset",
    ];
    if request.len() != fields.len()
        || fields.iter().any(|key| !request.contains_key(*key))
        || request["protocolVersion"].as_f64() != Some(1.0)
        || request["operation"].as_str() != Some("scene3d.copyObjects")
    {
        return Err(CoreError::request());
    }
    let content = request["content"].as_str().ok_or_else(CoreError::request)?;
    let before = parse(content)?;
    let objects = before.model["objects"].as_array().ok_or_else(invalid)?;
    let pairs = request["copies"].as_array().ok_or_else(invalid)?;
    if pairs.is_empty() || pairs.len() > 127 {
        return Err(invalid());
    }
    let offset = triple(&request["offset"], -200000.0, 200000.0).map_err(|_| invalid())?;
    let existing = objects
        .iter()
        .map(|object| object["instanceId"].as_str().ok_or_else(invalid))
        .collect::<Result<HashSet<_>, _>>()?;
    let mut mapping = HashMap::new();
    let mut fresh = HashSet::new();
    for pair in pairs {
        let pair = pair.as_object().ok_or_else(invalid)?;
        if pair.len() != 2
            || !pair.contains_key("sourceInstanceId")
            || !pair.contains_key("newInstanceId")
        {
            return Err(CoreError::request());
        }
        let source = uuid(&pair["sourceInstanceId"])?;
        let new = uuid(&pair["newInstanceId"])?;
        if !existing.contains(source)
            || existing.contains(new)
            || mapping.insert(source, new).is_some()
            || !fresh.insert(new)
        {
            return Err(invalid());
        }
    }
    if objects.len() + pairs.len() > 128 {
        return Err(limit());
    }
    // Check every final coordinate against the one original native model before
    // collecting any clone text. No intermediate document or budget is used.
    let mut targets = vec![];
    for (index, object) in objects.iter().enumerate() {
        let source = object["instanceId"].as_str().ok_or_else(invalid)?;
        if let Some(new) = mapping.get(source) {
            let position =
                triple(&object["position"], -100000.0, 100000.0).map_err(|_| invalid())?;
            let mut next = position;
            for axis in 0..3 {
                next[axis] = position[axis] + offset[axis];
                if !next[axis].is_finite() || !(-100000.0..=100000.0).contains(&next[axis]) {
                    return Err(invalid());
                }
            }
            targets.push((index, source, *new, position, next));
        }
    }
    let root = parse_json_source(content).map_err(|_| invalid())?;
    let array = root.get("objects").ok_or_else(invalid)?;
    let nodes = array.array().map_err(|_| invalid())?;
    let mut clones = vec![];
    let mut copies = vec![];
    for (index, source, new, position, next) in targets {
        let node = &nodes[index];
        let base = node.span.start;
        let raw = &content[node.span.clone()];
        let identity = &node.get("instanceId").ok_or_else(invalid)?.span;
        let mut changes = vec![Edit {
            span: identity.start - base..identity.end - base,
            text: serde_json::to_string(new).map_err(|_| invalid())?,
        }];
        let components = node
            .get("position")
            .ok_or_else(invalid)?
            .array()
            .map_err(|_| invalid())?;
        for axis in 0..3 {
            if position[axis] != next[axis] {
                let span = &components[axis].span;
                changes.push(Edit {
                    span: span.start - base..span.end - base,
                    text: js_number(next[axis]),
                });
            }
        }
        clones.push(splice(raw, changes));
        copies.push(CopyIdentity {
            source_instance_id: source.to_owned(),
            new_instance_id: new.to_owned(),
        });
    }
    // append_item computes the original first-item padding and fixed final-item
    // insertion. Join every clone into that SINGLE edit; it never re-parses or
    // re-budgets an intermediate author document.
    let first = append_item(content, array, clones[0].clone()).map_err(|_| invalid())?;
    let padding = &first.text[1..first.text.len() - clones[0].len()];
    let insertion = clones
        .into_iter()
        .map(|raw| format!(",{padding}{raw}"))
        .collect::<String>();
    let after_content = splice(
        content,
        vec![Edit {
            span: first.span,
            text: insertion,
        }],
    );
    parse(&after_content)?;
    let changed_paths = (objects.len()..objects.len() + copies.len())
        .map(|index| format!("/objects/{index}"))
        .collect();
    Ok(Scene3DCopyPatchResponse {
        copies,
        offset,
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
    fn request(content: &str, sources: &[usize], offset: Value) -> Value {
        json!({"protocolVersion":1,"operation":"scene3d.copyObjects","content":content,"copies":sources.iter().map(|source|json!({"sourceInstanceId":id(*source),"newInstanceId":id(*source+1000)})).collect::<Vec<_>>(),"offset":offset})
    }
    fn parsed(content: &str) -> Value {
        serde_json::from_str(content.strip_prefix('\u{feff}').unwrap_or(content)).unwrap()
    }
    fn wire(input: impl AsRef<[u8]>) -> Value {
        serde_json::from_slice(&crate::dispatch_json(input.as_ref())).unwrap()
    }
    #[test]
    fn reverse_pairs_preserve_mapping_and_append_in_original_source_order() {
        let value = scene(3);
        let source = text(&value);
        let r = dispatch(&request(&source, &[3, 1], json!([2, 3, 4]))).unwrap();
        assert_eq!(
            r.copies
                .iter()
                .map(|c| (&c.source_instance_id, &c.new_instance_id))
                .collect::<Vec<_>>(),
            vec![(&id(1), &id(1001)), (&id(3), &id(1003))]
        );
        assert_eq!(r.changed_paths, ["/objects/3", "/objects/4"]);
        let after = parsed(&r.after_content);
        assert_eq!(
            after["objects"].as_array().unwrap()[..3],
            value["objects"].as_array().unwrap()[..]
        );
        assert_eq!(after["objects"][3]["position"], json!([3, 3, 4]));
        assert_eq!(after["objects"][4]["position"], json!([5, 3, 4]));
    }
    #[test]
    fn a_zero_offset_still_creates_structural_copies_without_normalizing_positions() {
        let source = text(&scene(2));
        let r = dispatch(&request(&source, &[2, 1], json!([0, 0, 0]))).unwrap();
        let b = parse_json_source(&source).unwrap();
        let a = parse_json_source(&r.after_content).unwrap();
        let b = b.get("objects").unwrap().array().unwrap();
        let a = a.get("objects").unwrap().array().unwrap();
        for i in 0..2 {
            let raw = &source[b[i].span.clone()];
            let expected = raw.replace(
                &format!("\"{}\"", id(i + 1)),
                &format!("\"{}\"", id(i + 1001)),
            );
            assert_eq!(&r.after_content[a[i + 2].span.clone()], expected);
        }
        assert_ne!(r.after_content, source);
        assert_eq!(r.changed_paths.len(), 2);
    }
    #[test]
    fn one_insertion_keeps_the_whole_original_prefix_suffix_and_original_padding() {
        let source = text(&scene(3));
        let r = dispatch(&request(&source, &[3, 1], json!([1, 0, 0]))).unwrap();
        let before = parse_json_source(&source).unwrap();
        let nodes = before.get("objects").unwrap().array().unwrap();
        let after = parse_json_source(&r.after_content).unwrap();
        let copies = after.get("objects").unwrap().array().unwrap();
        let padding = &source[before.get("objects").unwrap().span.start + 1..nodes[0].span.start];
        let insertion = (3..5)
            .map(|i| format!(",{padding}{}", &r.after_content[copies[i].span.clone()]))
            .collect::<String>();
        assert_eq!(
            r.after_content,
            format!(
                "{}{}{}",
                &source[..nodes[2].span.end],
                insertion,
                &source[nodes[2].span.end..]
            )
        );
    }
    #[test]
    fn bom_crlf_unicode_escaped_keys_and_all_non_identity_non_position_tokens_survive() {
        let source = text(&scene(2))
            .replace("\"instanceId\"", "\"instance\\u0049d\"")
            .replace("\"position\"", "\"posi\\u0074ion\"")
            .replace("1000", "1e3");
        let r = dispatch(&request(&source, &[2, 1], json!([1, 0, 0]))).unwrap();
        assert!(r.after_content.starts_with('\u{feff}'));
        assert!(r.after_content.contains("\r\n"));
        assert_eq!(r.after_content.matches("instance\\u0049d").count(), 4);
        assert_eq!(r.after_content.matches("Same 名前🦊").count(), 4);
        assert!(r.after_content.contains("1e3"));
        let after = parsed(&r.after_content);
        for i in 0..2 {
            let mut expected = parsed(&source)["objects"][i].clone();
            expected["instanceId"] = json!(id(i + 1001));
            expected["position"][0] = json!(i + 2);
            assert_eq!(after["objects"][i + 2], expected);
        }
    }
    #[test]
    fn unchanged_exponents_and_signed_zero_in_copy_remain_raw() {
        let mut source = text(&scene(1));
        let root = parse_json_source(&source).unwrap();
        let pos = root.get("objects").unwrap().array().unwrap()[0]
            .get("position")
            .unwrap()
            .array()
            .unwrap();
        let edits = vec![
            (pos[0].span.clone(), "1.000e0"),
            (pos[1].span.clone(), "0e1"),
            (pos[2].span.clone(), "-0e0"),
        ];
        for (span, token) in edits.into_iter().rev() {
            source.replace_range(span, token);
        }
        let r = dispatch(&request(&source, &[1], json!([0, 2, 0]))).unwrap();
        let nodes = parse_json_source(&r.after_content).unwrap();
        let copy = &r.after_content[nodes.get("objects").unwrap().array().unwrap()[1]
            .span
            .clone()];
        assert!(copy.contains("1.000e0") && copy.contains("-0e0"));
        assert!(!copy.contains("0e1"));
    }
    #[test]
    fn subnormal_offsets_change_zero_but_rounded_noops_keep_nonzero_original_tokens() {
        let mut value = scene(1);
        value["objects"][0]["position"] = json!([100000.0, 0.0, -0.0]);
        let source = text(&value);
        let r = dispatch(&request(&source, &[1], json!([5e-324, 5e-324, 0]))).unwrap();
        let after = parsed(&r.after_content);
        assert_eq!(after["objects"][1]["position"][0], 100000.0);
        assert_eq!(after["objects"][1]["position"][1].as_f64(), Some(5e-324));
        assert!(r.after_content.matches("100000.0").count() == 2);
    }
    #[test]
    fn one_invalid_final_coordinate_rejects_the_entire_multi_source_candidate() {
        let mut value = scene(2);
        value["objects"][1]["position"][0] = json!(100000);
        let source = text(&value);
        assert_eq!(
            dispatch(&request(&source, &[1, 2], json!([1, 0, 0])))
                .unwrap_err()
                .error_code,
            "scene3d_copy_invalid"
        );
        assert_eq!(parsed(&source), value);
    }
    #[test]
    fn offset_and_final_position_extrema_are_inclusive_without_wrap_or_clamp() {
        let mut value = scene(1);
        value["objects"][0]["position"] = json!([-100000, 100000, 0]);
        let r = dispatch(&request(
            &text(&value),
            &[1],
            json!([200000, -200000, 100000]),
        ))
        .unwrap();
        assert_eq!(
            parsed(&r.after_content)["objects"][1]["position"],
            json!([100000, -100000, 100000])
        );
        for offset in [
            json!([200001, 0, 0]),
            json!([0, -200001, 0]),
            json!([0, 0, 200001]),
            json!([1, 2]),
            Value::Null,
        ] {
            assert_eq!(
                dispatch(&request(&text(&scene(1)), &[1], offset))
                    .unwrap_err()
                    .error_code,
                "scene3d_copy_invalid"
            );
        }
    }
    #[test]
    fn identities_are_existing_distinct_sources_and_all_fresh_distinct_lowercase_uuids() {
        let source = text(&scene(3));
        for mutate in 0..6 {
            let mut req = request(&source, &[1, 2], json!([0, 0, 0]));
            match mutate {
                0 => req["copies"][1]["sourceInstanceId"] = json!(id(1)),
                1 => req["copies"][1]["newInstanceId"] = json!(id(1001)),
                2 => req["copies"][1]["newInstanceId"] = json!(id(3)),
                3 => req["copies"][1]["sourceInstanceId"] = json!(id(4)),
                4 => {
                    req["copies"][1]["newInstanceId"] =
                        json!("ABCDEF00-1111-4111-8111-111111111111")
                }
                _ => req["copies"][1]["newInstanceId"] = json!("bad"),
            };
            assert_eq!(
                dispatch(&req).unwrap_err().error_code,
                "scene3d_copy_invalid"
            );
        }
    }
    #[test]
    fn sixty_four_distinct_sources_can_fill_the_final_128_object_budget() {
        let source = text(&scene(64));
        let r = dispatch(&request(
            &source,
            &(1..=64).rev().collect::<Vec<_>>(),
            json!([1, 0, 0]),
        ))
        .unwrap();
        assert_eq!(r.copies.len(), 64);
        assert_eq!(
            parse(&r.after_content)
                .unwrap()
                .source_locations
                .objects
                .len(),
            128
        );
        assert_eq!(r.changed_paths.first().unwrap(), "/objects/64");
        assert_eq!(r.changed_paths.last().unwrap(), "/objects/127");
    }
    #[test]
    fn final_object_overflow_is_a_limit_error_not_partial_copy() {
        let source = text(&scene(65));
        assert_eq!(
            dispatch(&request(
                &source,
                &(1..=65).collect::<Vec<_>>(),
                json!([0, 0, 0])
            ))
            .unwrap_err()
            .error_code,
            "scene3d_limit"
        );
        let source = text(&scene(128));
        assert_eq!(
            dispatch(&request(&source, &[1], json!([0, 0, 0])))
                .unwrap_err()
                .error_code,
            "scene3d_limit"
        );
    }
    #[test]
    fn only_final_full_byte_budget_applies_to_all_copy_insertion() {
        let source = text(&scene(2));
        let ready = dispatch(&request(&source, &[2, 1], json!([1, 0, 0]))).unwrap();
        let growth = ready.after_content.len() - source.len();
        let mut exact = source.clone();
        exact.push_str(&" ".repeat(131072 - growth - source.len()));
        let r = dispatch(&request(&exact, &[2, 1], json!([1, 0, 0]))).unwrap();
        assert_eq!(r.after_content.len(), 131072);
        exact.push(' ');
        assert_eq!(
            dispatch(&request(&exact, &[2, 1], json!([1, 0, 0])))
                .unwrap_err()
                .error_code,
            "scene3d_limit"
        );
    }
    #[test]
    fn malformed_or_invalid_unselected_source_retains_original_strict_parse_errors() {
        let mut value = scene(2);
        value["objects"][1]["color"] = json!("bad");
        assert_eq!(
            dispatch(&request(&text(&value), &[1], json!([0, 0, 0])))
                .unwrap_err()
                .error_code,
            "scene3d_invalid"
        );
        let source = text(&scene(1)).replace("\"objects\":", "\"objects\":[],\"objec\\u0074s\":");
        assert_eq!(
            dispatch(&request(&source, &[1], json!([0, 0, 0])))
                .unwrap_err()
                .error_code,
            "scene3d_invalid"
        );
        let mut source = text(&scene(1));
        source.push_str(&" ".repeat(131073 - source.len()));
        assert_eq!(
            dispatch(&request(&source, &[1], json!([0, 0, 0])))
                .unwrap_err()
                .error_code,
            "scene3d_limit"
        );
    }
    #[test]
    fn top_and_pair_decoded_duplicate_keys_and_extra_intents_fail_raw_request_admission() {
        let req = request(&text(&scene(2)), &[1], json!([0, 0, 0]));
        let raw = serde_json::to_string(&req).unwrap();
        for modified in [
            raw.replace("\"copies\":", "\"copies\":[],\"cop\\u0069es\":"),
            raw.replace(
                "\"sourceInstanceId\":",
                "\"sourceInstanceId\":\"bad\",\"sourceInstance\\u0049d\":",
            ),
            raw.replace(
                "\"newInstanceId\":",
                "\"name\":\"extra\",\"newInstanceId\":",
            ),
        ] {
            assert_eq!(wire(modified)["errorCode"], "studio_core_request_invalid");
        }
        let mut req = req;
        req["axis"] = json!("x");
        assert_eq!(
            wire(serde_json::to_vec(&req).unwrap())["errorCode"],
            "studio_core_request_invalid"
        );
    }
    #[test]
    fn empty_overlong_or_malformed_copy_mapping_is_never_an_author_approval() {
        let source = text(&scene(2));
        for pairs in [
            json!([]),
            json!(null),
            json!([{}]),
            json!([{"sourceInstanceId":id(1),"newInstanceId":id(1001),"extra":true}]),
            json!((0..128)
                .map(|_| json!({"sourceInstanceId":id(1),"newInstanceId":id(1001)}))
                .collect::<Vec<_>>()),
        ] {
            let mut req = request(&source, &[1], json!([0, 0, 0]));
            req["copies"] = pairs;
            assert!(dispatch(&req).is_err());
        }
    }
    #[test]
    fn optional_copy_probe_does_not_repurpose_old_single_object_copy_or_parse() {
        assert_eq!(crate::viento_core_scene3d_copy_version(), 1);
        let source = text(&scene(2));
        let r = wire(serde_json::to_vec(&request(&source, &[1], json!([0, 0, 0]))).unwrap());
        assert_eq!(r["ok"], true);
        assert!(r.get("scene3dCopyPatch").is_some());
        let old=wire(serde_json::to_vec(&json!({"protocolVersion":1,"operation":"scene3d.patchObjects","content":source,"action":"copy","instanceId":id(1),"newInstanceId":id(1001),"name":"Explicit old name"})).unwrap());
        assert_eq!(old["ok"], true);
        assert!(old.get("scene3dObjectsPatch").is_some());
    }
}
