//! One atomic relative translation over existing validated primitive instances.
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
        error_code: "scene3d_translation_invalid",
        message: "Expected unique existing 3D instances and an atomic bounded translation.",
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
    #[serde(rename = "offset")]
    _offset: Value,
}

pub(crate) fn validate_request_bytes(input: &[u8]) -> Result<(), CoreError> {
    serde_json::from_slice::<StrictRequest>(input)
        .map(|_| ())
        .map_err(|_| CoreError::request())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Scene3DTranslationPatchResponse {
    pub instance_ids: Vec<String>,
    pub offset: [f64; 3],
    pub before_content: String,
    pub after_content: String,
    pub changed_paths: Vec<String>,
}

pub(crate) fn dispatch(request: &Value) -> Result<Scene3DTranslationPatchResponse, CoreError> {
    let request = request.as_object().ok_or_else(CoreError::request)?;
    let required = [
        "protocolVersion",
        "operation",
        "content",
        "instanceIds",
        "offset",
    ];
    if request.len() != required.len()
        || required.iter().any(|field| !request.contains_key(*field))
        || request["protocolVersion"].as_f64() != Some(1.0)
        || request["operation"].as_str() != Some("scene3d.translateObjects")
    {
        return Err(CoreError::request());
    }
    let content = request["content"].as_str().ok_or_else(CoreError::request)?;
    let before = parse(content)?;
    let ids = request["instanceIds"].as_array().ok_or_else(invalid)?;
    if ids.is_empty() || ids.len() > 128 {
        return Err(invalid());
    }
    let mut selected = HashSet::new();
    for id in ids {
        if !selected.insert(id.as_str().ok_or_else(invalid)?) {
            return Err(invalid());
        }
    }
    let offset = triple(&request["offset"], -200000.0, 200000.0).map_err(|_| invalid())?;
    let objects = before.model["objects"].as_array().ok_or_else(invalid)?;
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
        for axis in 0..3 {
            let next = old[axis] + offset[axis];
            if !next.is_finite() || !(-100000.0..=100000.0).contains(&next) {
                return Err(invalid());
            }
            if old[axis] != next {
                edits.push((components[axis].span.clone(), js_number(next)));
                changed_paths.push(format!("/objects/{index}/position/{axis}"));
            }
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
    Ok(Scene3DTranslationPatchResponse {
        instance_ids,
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
    fn ids(value: &Value) -> Vec<String> {
        value["objects"]
            .as_array()
            .unwrap()
            .iter()
            .map(|o| o["instanceId"].as_str().unwrap().to_owned())
            .collect()
    }
    fn request(content: &str, ids: Value, offset: Value) -> Value {
        json!({"protocolVersion":1,"operation":"scene3d.translateObjects","content":content,"instanceIds":ids,"offset":offset})
    }
    fn parsed(content: &str) -> Value {
        serde_json::from_str(content.strip_prefix('\u{feff}').unwrap_or(content)).unwrap()
    }
    fn wire(input: impl AsRef<[u8]>) -> Value {
        serde_json::from_slice(&crate::dispatch_json(input.as_ref())).unwrap()
    }

    #[test]
    fn source_order_targets_and_axis_paths_are_independent_of_requested_order() {
        let value = scene();
        let source = text(&value);
        let identities = ids(&value);
        let result = dispatch(&request(
            &source,
            json!([identities[2], identities[0]]),
            json!([1.25, -2, 3]),
        ))
        .unwrap();
        assert_eq!(
            result.instance_ids,
            [identities[0].clone(), identities[2].clone()]
        );
        assert_eq!(
            result.changed_paths,
            [
                "/objects/0/position/0",
                "/objects/0/position/1",
                "/objects/0/position/2",
                "/objects/2/position/0",
                "/objects/2/position/1",
                "/objects/2/position/2"
            ]
        );
        let mut expected = value.clone();
        for index in [0, 2] {
            for axis in 0..3 {
                expected["objects"][index]["position"][axis] = serde_json::from_str(&js_number(
                    value["objects"][index]["position"][axis].as_f64().unwrap()
                        + result.offset[axis],
                ))
                .unwrap();
            }
        }
        assert_eq!(parsed(&result.after_content), expected);
        assert_eq!(result.before_content, source);
    }

    #[test]
    fn exact_numeric_tokens_keep_bom_crlf_escaped_keys_and_all_other_lexemes() {
        let value = scene();
        let identities = ids(&value);
        let source = text(&value)
            .replace("\"objects\"", "\"objec\\u0074s\"")
            .replace("\"position\"", "\"posi\\u0074ion\"")
            .replace("1000", "1.000e3")
            .replace("方柱", "方柱🦊");
        let root = parse_json_source(&source).unwrap();
        let objects = root.get("objects").unwrap().array().unwrap();
        let mut tokens = vec![];
        for index in [0, 2] {
            let numbers = objects[index].get("position").unwrap().array().unwrap();
            tokens.push((
                numbers[0].span.clone(),
                js_number(value["objects"][index]["position"][0].as_f64().unwrap() + 0.125),
            ));
        }
        tokens.sort_by_key(|(span, _)| std::cmp::Reverse(span.start));
        let mut expected = source.clone();
        for (span, value) in tokens {
            expected.replace_range(span, &value);
        }
        let result = dispatch(&request(
            &source,
            json!([identities[2], identities[0]]),
            json!([0.125, 0, 0]),
        ))
        .unwrap();
        assert_eq!(result.after_content, expected);
    }

    #[test]
    fn zero_and_rounded_nonzero_deltas_preserve_every_byte_and_include_noop_targets() {
        let mut value = scene();
        value["objects"][0]["position"] = json!([100000, 100000, 100000]);
        let identities = ids(&value);
        let source = text(&value).replace("100000", "1.00000e5");
        let unchanged = dispatch(&request(
            &source,
            json!([identities[0]]),
            json!([5e-324, -0.0, 0]),
        ))
        .unwrap();
        assert_eq!(unchanged.after_content, source);
        assert!(unchanged.changed_paths.is_empty());
        assert_eq!(unchanged.instance_ids, [identities[0].clone()]);
        let partial = dispatch(&request(
            &source,
            json!([identities[1], identities[0]]),
            json!([5e-324, 0, 0]),
        ))
        .unwrap();
        assert_eq!(
            partial.instance_ids,
            [identities[0].clone(), identities[1].clone()]
        );
        // This offset is rounded away at both ordinary and large X positions.
        assert_eq!(partial.after_content, source);
        assert!(partial.changed_paths.is_empty());
    }

    #[test]
    fn negative_zero_and_exponent_noop_spellings_are_not_normalized() {
        let value = scene();
        let identities = ids(&value);
        let mut source = text(&value).replace("1000", "1e3");
        let root = parse_json_source(&source).unwrap();
        let span = root.get("objects").unwrap().array().unwrap()[0]
            .get("position")
            .unwrap()
            .array()
            .unwrap()[0]
            .span
            .clone();
        source.replace_range(span, "-0e0");
        let result = dispatch(&request(&source, json!(identities), json!([-0.0, 0, 0]))).unwrap();
        assert_eq!(result.after_content, source);
        assert!(result.changed_paths.is_empty());
    }

    #[test]
    fn partly_rounded_translation_retains_all_targets_but_only_one_changed_axis() {
        let mut value = scene();
        value["objects"][0]["position"] = json!([100000, 0, 0]);
        value["objects"][1]["position"] = json!([0, 1.5, 0]);
        let identities = ids(&value);
        let result = dispatch(&request(
            &text(&value),
            json!([identities[1], identities[0]]),
            json!([5e-324, 0, 0]),
        ))
        .unwrap();
        assert_eq!(
            result.instance_ids,
            [identities[0].clone(), identities[1].clone()]
        );
        assert_eq!(result.changed_paths, ["/objects/1/position/0"]);
        assert_eq!(
            parsed(&result.after_content)["objects"][0],
            value["objects"][0]
        );
    }

    #[test]
    fn one_overflow_refuses_the_whole_batch_without_partial_source() {
        let mut value = scene();
        value["objects"][2]["position"] = json!([100000, 0, 0]);
        let identities = ids(&value);
        let source = text(&value);
        let failure = dispatch(&request(
            &source,
            json!([identities[0], identities[2]]),
            json!([1, 0, 0]),
        ))
        .unwrap_err();
        assert_eq!(failure.error_code, "scene3d_translation_invalid");
        assert_eq!(parsed(&source), value);
    }

    #[test]
    fn extreme_offsets_land_on_exact_position_bounds() {
        let mut value = scene();
        value["objects"][0]["position"] = json!([-100000, 100000, 0]);
        let identities = ids(&value);
        let source = text(&value);
        let result = dispatch(&request(
            &source,
            json!([identities[0]]),
            json!([200000, -200000, 100000]),
        ))
        .unwrap();
        assert_eq!(
            parsed(&result.after_content)["objects"][0]["position"],
            json!([100000, -100000, 100000])
        );
    }

    #[test]
    fn missing_repeated_unknown_uppercase_ids_and_invalid_delta_shapes_fail_closed() {
        let value = scene();
        let identities = ids(&value);
        let source = text(&value);
        for targets in [
            json!([]),
            json!([identities[0], identities[0]]),
            json!(["ffffffff-ffff-ffff-ffff-ffffffffffff"]),
            json!(["FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF"]),
            json!(["bad"]),
            json!([null]),
            json!(null),
        ] {
            assert_eq!(
                dispatch(&request(&source, targets, json!([0, 0, 0])))
                    .unwrap_err()
                    .error_code,
                "scene3d_translation_invalid"
            );
        }
        for offset in [
            json!([]),
            json!([0, 0]),
            json!([0, 0, 0, 0]),
            json!([null, 0, 0]),
            json!([200000.1, 0, 0]),
            json!([-200000.1, 0, 0]),
            json!(null),
        ] {
            assert_eq!(
                dispatch(&request(&source, json!([identities[0]]), offset))
                    .unwrap_err()
                    .error_code,
                "scene3d_translation_invalid"
            );
        }
    }

    #[test]
    fn malformed_original_unselected_objects_still_use_existing_parse_errors() {
        let mut value = scene();
        let identities = ids(&value);
        value["objects"][2]["size"] = json!([0, 1, 1]);
        assert_eq!(
            dispatch(&request(
                &text(&value),
                json!([identities[0]]),
                json!([1, 0, 0])
            ))
            .unwrap_err()
            .error_code,
            "scene3d_invalid"
        );
    }

    #[test]
    fn original_and_final_byte_limits_reject_growth_accept_shrink_and_keep_noop() {
        let mut value = scene();
        value["objects"][0]["position"] = json!([100000, 0, 0]);
        let identities = ids(&value);
        let mut source = text(&value);
        source.push_str(&" ".repeat(131072 - source.len()));
        assert_eq!(
            dispatch(&request(&source, json!([identities[0]]), json!([0, 0, 0])))
                .unwrap()
                .after_content,
            source
        );
        assert!(
            dispatch(&request(
                &source,
                json!([identities[0]]),
                json!([-100000, 0, 0])
            ))
            .unwrap()
            .after_content
            .len()
                < 131072
        );
        assert_eq!(
            dispatch(&request(
                &source,
                json!([identities[1]]),
                json!([0.125, 0, 0])
            ))
            .unwrap_err()
            .error_code,
            "scene3d_limit"
        );
        assert_eq!(
            dispatch(&request(
                &(source + " "),
                json!([identities[0]]),
                json!([0, 0, 0])
            ))
            .unwrap_err()
            .error_code,
            "scene3d_limit"
        );
    }

    #[test]
    fn exact_wire_request_rejects_decoded_duplicates_and_foreign_operations() {
        let value = scene();
        let input = request(&text(&value), json!([ids(&value)[0]]), json!([1, 0, 0]));
        let raw = serde_json::to_string(&input).unwrap();
        for malformed in [
            raw.replace("\"offset\":", "\"off\\u0073et\":[0,0,0],\"offset\":"),
            raw.replace(
                "\"instanceIds\":",
                "\"instanceIds\":[],\"instance\\u0049ds\":",
            ),
            raw.replace(
                "\"protocolVersion\":1",
                "\"protocolVersion\":1,\"protocolVersion\":1",
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
        assert_eq!(crate::viento_core_scene3d_translation_version(), 1);
        assert_eq!(wire(serde_json::to_vec(&input).unwrap())["ok"], true);
    }

    #[test]
    fn all_128_targets_are_source_ordered_without_increasing_author_budget() {
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
        let targets = ids(&value);
        let mut reversed = targets.clone();
        reversed.reverse();
        let result =
            dispatch(&request(&text(&value), json!(reversed), json!([0.5, 0, 0]))).unwrap();
        assert_eq!(result.instance_ids, targets);
        assert_eq!(result.changed_paths.len(), 128);
        assert_eq!(result.changed_paths[127], "/objects/127/position/0");
    }
}
