//! Atomic distribution of existing author positions along one world axis.
//! Original extrema and every non-position token retain their source spelling.
#![forbid(unsafe_code)]

use crate::scene3d::{parse, triple};
use crate::scene_source::{js_number, parse_json_source};
use crate::CoreError;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashSet;
use std::ops::Range;

fn invalid() -> CoreError {
    CoreError { error_code: "scene3d_distribution_invalid", message: "Expected at least three existing 3D positions and a representable world-axis distribution." }
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
pub struct Scene3DDistributionPatchResponse {
    pub instance_ids: Vec<String>,
    pub ordered_instance_ids: Vec<String>,
    pub axis: String,
    pub before_content: String,
    pub after_content: String,
    pub changed_paths: Vec<String>,
}

pub(crate) fn dispatch(request: &Value) -> Result<Scene3DDistributionPatchResponse, CoreError> {
    let request = request.as_object().ok_or_else(CoreError::request)?;
    let required = [
        "protocolVersion",
        "operation",
        "content",
        "instanceIds",
        "axis",
    ];
    if request.len() != required.len()
        || required.iter().any(|key| !request.contains_key(*key))
        || request["protocolVersion"].as_f64() != Some(1.0)
        || request["operation"].as_str() != Some("scene3d.distributeObjects")
    {
        return Err(CoreError::request());
    }
    let content = request["content"].as_str().ok_or_else(CoreError::request)?;
    let before = parse(content)?;
    let ids = request["instanceIds"].as_array().ok_or_else(invalid)?;
    if ids.len() < 3 || ids.len() > 128 {
        return Err(invalid());
    }
    let mut selected = HashSet::new();
    for id in ids {
        if !selected.insert(id.as_str().ok_or_else(invalid)?) {
            return Err(invalid());
        }
    }
    let axis_name = request["axis"].as_str().ok_or_else(invalid)?;
    let axis = match axis_name {
        "x" => 0,
        "y" => 1,
        "z" => 2,
        _ => return Err(invalid()),
    };
    let objects = before.model["objects"].as_array().ok_or_else(invalid)?;
    let mut targets = vec![];
    for (index, object) in objects.iter().enumerate() {
        let id = object["instanceId"].as_str().ok_or_else(invalid)?;
        if selected.contains(id) {
            let coordinate =
                triple(&object["position"], -100000.0, 100000.0).map_err(|_| invalid())?[axis];
            targets.push((index, id, coordinate));
        }
    }
    if targets.len() != selected.len() {
        return Err(invalid());
    }
    let mut ordered = targets.clone();
    // Numeric equality includes -0/+0. Source index resolves every tie.
    ordered.sort_by(|a, b| {
        a.2.partial_cmp(&b.2)
            .expect("validated finite coordinate")
            .then(a.0.cmp(&b.0))
    });
    let start = ordered[0].2;
    let end = ordered[ordered.len() - 1].2;
    let span = end - start;
    let mut next_coordinates = vec![None; objects.len()];
    let mut previous = None;
    for (rank, (index, _, old)) in ordered.iter().enumerate() {
        // Keep both original endpoints. Do not substitute a different lerp,
        // fused multiply-add, incremental sum or divide-before-multiply step.
        let next = if span == 0.0 || rank == 0 || rank == ordered.len() - 1 {
            *old
        } else {
            start + span * (rank as f64 / (ordered.len() - 1) as f64)
        };
        if !next.is_finite()
            || !(-100000.0..=100000.0).contains(&next)
            || (span > 0.0 && previous.is_some_and(|value| next <= value))
        {
            return Err(invalid());
        }
        next_coordinates[*index] = Some(next);
        previous = Some(next);
    }
    let root = parse_json_source(content).map_err(|_| invalid())?;
    let nodes = root
        .get("objects")
        .ok_or_else(invalid)?
        .array()
        .map_err(|_| invalid())?;
    let mut edits: Vec<(Range<usize>, String)> = vec![];
    let mut changed_paths = vec![];
    for (index, _, old) in &targets {
        let next = next_coordinates[*index].ok_or_else(invalid)?;
        if *old != next {
            let components = nodes[*index]
                .get("position")
                .ok_or_else(invalid)?
                .array()
                .map_err(|_| invalid())?;
            edits.push((components[axis].span.clone(), js_number(next)));
            changed_paths.push(format!("/objects/{index}/position/{axis}"));
        }
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
    Ok(Scene3DDistributionPatchResponse {
        instance_ids: targets.iter().map(|(_, id, _)| (*id).to_owned()).collect(),
        ordered_instance_ids: ordered.iter().map(|(_, id, _)| (*id).to_owned()).collect(),
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

    fn scene(coordinates: &[f64]) -> Value {
        let mut value: Value =
            serde_json::from_str(include_str!("../../../examples/scene3d/scene.json")).unwrap();
        let prototype = value["objects"][1].clone();
        value["objects"] = json!(coordinates
            .iter()
            .enumerate()
            .map(|(i, coordinate)| {
                let mut object = prototype.clone();
                object["instanceId"] = json!(format!("{i:08x}-1111-4111-8111-111111111111"));
                object["name"] = json!(format!("Box 箱🦊 {i}"));
                object["position"] = json!([coordinate, coordinate, coordinate]);
                object
            })
            .collect::<Vec<_>>());
        value
    }
    fn ids(value: &Value) -> Vec<String> {
        value["objects"]
            .as_array()
            .unwrap()
            .iter()
            .map(|object| object["instanceId"].as_str().unwrap().to_owned())
            .collect()
    }
    fn text(value: &Value) -> String {
        format!(
            "\u{feff}{}\r\n \t",
            serde_json::to_string_pretty(value)
                .unwrap()
                .replace('\n', "\r\n")
        )
    }
    fn request(content: &str, ids: Value, axis: Value) -> Value {
        json!({"protocolVersion":1,"operation":"scene3d.distributeObjects","content":content,"instanceIds":ids,"axis":axis})
    }
    fn parsed(content: &str) -> Value {
        serde_json::from_str(content.strip_prefix('\u{feff}').unwrap_or(content)).unwrap()
    }
    fn wire(input: impl AsRef<[u8]>) -> Value {
        serde_json::from_slice(&crate::dispatch_json(input.as_ref())).unwrap()
    }

    #[test]
    fn selected_ids_and_net_paths_stay_source_ordered_while_distribution_orders_by_original_coordinate(
    ) {
        let value = scene(&[10.0, -8.0, -10.0]);
        let identities = ids(&value);
        let source = text(&value);
        let result = dispatch(&request(
            &source,
            json!([identities[1], identities[0], identities[2]]),
            json!("x"),
        ))
        .unwrap();
        assert_eq!(result.instance_ids, identities);
        assert_eq!(
            result.ordered_instance_ids,
            [
                identities[2].clone(),
                identities[1].clone(),
                identities[0].clone()
            ]
        );
        assert_eq!(result.changed_paths, ["/objects/1/position/0"]);
        assert_eq!(
            parsed(&result.after_content)["objects"][1]["position"][0],
            0.0
        );
        assert_eq!(result.before_content, source);
    }
    #[test]
    fn three_world_axes_change_only_their_interior_position_and_preserve_all_other_semantics() {
        let value = scene(&[10.0, -8.0, -10.0]);
        let identities = ids(&value);
        for (axis, name) in ["x", "y", "z"].iter().enumerate() {
            let result = dispatch(&request(&text(&value), json!(identities), json!(name))).unwrap();
            let mut expected = value.clone();
            expected["objects"][1]["position"][axis] = json!(0.0);
            assert_eq!(parsed(&result.after_content), expected);
            assert_eq!(
                result.changed_paths,
                [format!("/objects/1/position/{axis}")]
            );
        }
    }
    #[test]
    fn equal_coordinates_and_signed_zeros_keep_declaration_ties_and_unchanged_zero_token() {
        let value = scene(&[10.0, 0.0, -0.0, 0.0, -10.0]);
        let identities = ids(&value);
        let mut source = text(&value);
        let root = parse_json_source(&source).unwrap();
        let span = root.get("objects").unwrap().array().unwrap()[2]
            .get("position")
            .unwrap()
            .array()
            .unwrap()[0]
            .span
            .clone();
        source.replace_range(span, "-0e0");
        let result = dispatch(&request(
            &source,
            json!([
                identities[3],
                identities[2],
                identities[1],
                identities[0],
                identities[4]
            ]),
            json!("x"),
        ))
        .unwrap();
        assert_eq!(
            result.ordered_instance_ids,
            [
                identities[4].clone(),
                identities[1].clone(),
                identities[2].clone(),
                identities[3].clone(),
                identities[0].clone()
            ]
        );
        assert_eq!(
            result.changed_paths,
            ["/objects/1/position/0", "/objects/3/position/0"]
        );
        assert!(result.after_content.contains("-0e0"));
    }
    #[test]
    fn exact_cst_splice_preserves_bom_crlf_unicode_escaped_keys_and_both_endpoint_lexemes() {
        let value = scene(&[10.0, -8.0, -10.0]);
        let identities = ids(&value);
        let mut source = text(&value)
            .replace("\"objects\"", "\"objec\\u0074s\"")
            .replace("\"position\"", "\"posi\\u0074ion\"")
            .replace("1000", "1.000e3");
        let root = parse_json_source(&source).unwrap();
        let nodes = root.get("objects").unwrap().array().unwrap();
        let span = nodes[0].get("position").unwrap().array().unwrap()[0]
            .span
            .clone();
        source.replace_range(span, "1.000e1");
        let root = parse_json_source(&source).unwrap();
        let span = root.get("objects").unwrap().array().unwrap()[1]
            .get("position")
            .unwrap()
            .array()
            .unwrap()[0]
            .span
            .clone();
        let mut expected = source.clone();
        expected.replace_range(span, "0");
        let result = dispatch(&request(&source, json!(identities), json!("x"))).unwrap();
        assert_eq!(result.after_content, expected);
        assert!(result.after_content.contains("1.000e1"));
    }
    #[test]
    fn operation_order_is_binary64_multiply_fraction_then_add_not_an_alternative_lerp() {
        let start = -41913.080518768766;
        let end = 49236.14455031027;
        let value = scene(&[end, start, -30000.0, 0.0]);
        let identities = ids(&value);
        let result = dispatch(&request(&text(&value), json!(identities), json!("x"))).unwrap();
        let rank_one = parsed(&result.after_content)["objects"][2]["position"][0]
            .as_f64()
            .unwrap();
        assert_eq!(rank_one.to_bits(), 0xc0c68500b415a0fc);
        assert_ne!(rank_one, start + ((end - start) / 3.0));
    }
    #[test]
    fn zero_span_is_a_complete_byte_preserving_noop_including_signed_zero() {
        let value = scene(&[0.0, -0.0, 0.0]);
        let identities = ids(&value);
        let source = text(&value).replace("0.0", "-0e0");
        let result = dispatch(&request(&source, json!(identities), json!("x"))).unwrap();
        assert_eq!(result.after_content, source);
        assert!(result.changed_paths.is_empty());
        assert_eq!(result.instance_ids, result.ordered_instance_ids);
    }
    #[test]
    fn already_uniform_values_keep_all_exponent_spelling_and_return_every_target() {
        let value = scene(&[-10.0, 0.0, 10.0]);
        let identities = ids(&value);
        let source = text(&value).replace("10.0", "1e1").replace("0.0", "0e0");
        let result = dispatch(&request(&source, json!(identities), json!("x"))).unwrap();
        assert_eq!(result.after_content, source);
        assert!(result.changed_paths.is_empty());
        assert_eq!(result.instance_ids.len(), 3);
    }
    #[test]
    fn a_nonzero_span_that_cannot_hold_strictly_increasing_interiors_is_rejected_whole() {
        for coordinates in [
            vec![1.0, 1.0, f64::from_bits(1.0f64.to_bits() + 1)],
            vec![1.0, 1.0, 1.0, f64::from_bits(1.0f64.to_bits() + 2)],
        ] {
            let value = scene(&coordinates);
            let source = text(&value);
            assert_eq!(
                dispatch(&request(&source, json!(ids(&value)), json!("x")))
                    .unwrap_err()
                    .error_code,
                "scene3d_distribution_invalid"
            );
            assert_eq!(parsed(&source), value);
        }
    }
    #[test]
    fn smallest_positive_subnormal_span_must_be_representable_and_not_silently_collapsed() {
        let value = scene(&[0.0, 0.0, 1e-323]);
        let result = dispatch(&request(&text(&value), json!(ids(&value)), json!("x"))).unwrap();
        assert_eq!(
            parsed(&result.after_content)["objects"][1]["position"][0].as_f64(),
            Some(5e-324)
        );
        let bad = scene(&[0.0, 0.0, 5e-324]);
        assert_eq!(
            dispatch(&request(&text(&bad), json!(ids(&bad)), json!("x")))
                .unwrap_err()
                .error_code,
            "scene3d_distribution_invalid"
        );
    }
    #[test]
    fn exact_author_extremes_are_preserved_without_expanding_scope_or_coordinate_bounds() {
        let value = scene(&[-100000.0, 100000.0, -99999.0, 99999.0]);
        let identities = ids(&value);
        let result = dispatch(&request(&text(&value), json!(identities), json!("z"))).unwrap();
        let after = parsed(&result.after_content);
        assert_eq!(after["objects"][0], value["objects"][0]);
        assert_eq!(after["objects"][1], value["objects"][1]);
        assert_eq!(
            after["objects"][2]["position"][2].as_f64(),
            Some(-100000.0 + 200000.0 * (1.0 / 3.0))
        );
    }
    #[test]
    fn incomplete_repeated_unknown_or_nonstring_identity_sets_fail_closed_before_any_patch() {
        let value = scene(&[10.0, -8.0, -10.0]);
        let identities = ids(&value);
        let source = text(&value);
        for targets in [
            json!([]),
            json!([identities[0], identities[1]]),
            json!([identities[0], identities[0], identities[2]]),
            json!([
                identities[0],
                identities[1],
                "FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF"
            ]),
            json!([
                identities[0],
                identities[1],
                "ffffffff-ffff-ffff-ffff-ffffffffffff"
            ]),
            json!([identities[0], identities[1], null]),
            json!(null),
        ] {
            assert_eq!(
                dispatch(&request(&source, targets, json!("x")))
                    .unwrap_err()
                    .error_code,
                "scene3d_distribution_invalid"
            );
        }
    }
    #[test]
    fn axis_has_no_normalization_and_invalid_unselected_source_uses_old_parse_errors() {
        let value = scene(&[10.0, -8.0, -10.0, 30.0]);
        let identities = ids(&value);
        for axis in [
            json!("X"),
            json!(" x"),
            json!("left"),
            json!(0),
            json!(null),
        ] {
            assert_eq!(
                dispatch(&request(&text(&value), json!(identities), axis))
                    .unwrap_err()
                    .error_code,
                "scene3d_distribution_invalid"
            );
        }
        let mut bad = value.clone();
        bad["objects"][3]["size"] = json!([0, 1, 1]);
        assert_eq!(
            dispatch(&request(
                &text(&bad),
                json!([identities[0], identities[1], identities[2]]),
                json!("x")
            ))
            .unwrap_err()
            .error_code,
            "scene3d_invalid"
        );
    }
    #[test]
    fn original_final_byte_budgets_admit_shrink_and_noop_but_reject_growth_atomically() {
        let growth = scene(&[0.0, 0.0, 100000.0]);
        let mut source = text(&growth);
        source.push_str(&" ".repeat(131072 - source.len()));
        assert_eq!(
            dispatch(&request(&source, json!(ids(&growth)), json!("x")))
                .unwrap_err()
                .error_code,
            "scene3d_limit"
        );
        let shrink = scene(&[0.0, 0.3333333333333333, 2.0]);
        let mut source = text(&shrink);
        source.push_str(&" ".repeat(131072 - source.len()));
        let result = dispatch(&request(&source, json!(ids(&shrink)), json!("x"))).unwrap();
        assert!(result.after_content.len() < 131072);
        let flat = scene(&[0.0, 0.0, 0.0]);
        let mut source = text(&flat);
        source.push_str(&" ".repeat(131072 - source.len()));
        assert_eq!(
            dispatch(&request(&source, json!(ids(&flat)), json!("x")))
                .unwrap()
                .after_content,
            source
        );
        assert_eq!(
            dispatch(&request(&(source + " "), json!(ids(&flat)), json!("x")))
                .unwrap_err()
                .error_code,
            "scene3d_limit"
        );
    }
    #[test]
    fn final_joint_growth_and_shrink_have_one_budget_without_intermediate_source_serialization() {
        let value = scene(&[0.0, 0.0, 29999.999999999996, 30000.0]);
        let mut source = text(&value);
        source.push_str(&" ".repeat(131072 - source.len()));
        let result = dispatch(&request(&source, json!(ids(&value)), json!("x"))).unwrap();
        assert!(result.after_content.len() < 131072);
        assert_eq!(
            result.changed_paths,
            ["/objects/1/position/0", "/objects/2/position/0"]
        );
    }
    #[test]
    fn all_128_instances_sort_stably_and_keep_two_extrema_and_every_non_axis_value() {
        let coordinates = (0..128).map(|i| (i * i) as f64).collect::<Vec<_>>();
        let value = scene(&coordinates);
        let identities = ids(&value);
        let mut reverse = identities.clone();
        reverse.reverse();
        let result = dispatch(&request(&text(&value), json!(reverse), json!("x"))).unwrap();
        assert_eq!(result.instance_ids, identities);
        assert_eq!(result.ordered_instance_ids, identities);
        assert_eq!(result.changed_paths.len(), 126);
        assert_eq!(result.changed_paths[125], "/objects/126/position/0");
        let after = parsed(&result.after_content);
        assert_eq!(after["objects"][0], value["objects"][0]);
        assert_eq!(after["objects"][127], value["objects"][127]);
    }
    #[test]
    fn strict_wire_request_rejects_decoded_duplicates_unknown_fields_and_foreign_operation_shapes()
    {
        let value = scene(&[10.0, -8.0, -10.0]);
        let input = request(&text(&value), json!(ids(&value)), json!("x"));
        let raw = serde_json::to_string(&input).unwrap();
        for malformed in [
            raw.replace("\"axis\":", "\"ax\\u0069s\":\"y\",\"axis\":"),
            raw.replace(
                "\"instanceIds\":",
                "\"instanceIds\":[],\"instance\\u0049ds\":",
            ),
        ] {
            assert_eq!(wire(malformed)["errorCode"], "studio_core_request_invalid");
        }
        let mut extra = input.clone();
        extra["anchorInstanceId"] = json!(ids(&value)[0]);
        assert_eq!(
            wire(serde_json::to_vec(&extra).unwrap())["errorCode"],
            "studio_core_request_invalid"
        );
        assert_eq!(crate::viento_core_scene3d_distribution_version(), 1);
        assert_eq!(wire(raw)["ok"], true);
        assert_eq!(wire(serde_json::to_vec(&json!({"protocolVersion":1,"operation":"scene3d.alignObjects","content":text(&value),"instanceIds":ids(&value),"anchorInstanceId":ids(&value)[0],"axis":"x"})).unwrap())["ok"], true);
    }
}
