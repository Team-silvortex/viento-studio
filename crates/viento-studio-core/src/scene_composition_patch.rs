//! Stateless, narrowly scoped local override patches of an author recipe.
//! Existing token bytes are retained; expansion remains the only recipe rule set.
#![forbid(unsafe_code)]

use crate::scene_composition::{expand, ACTOR_VALUES};
use crate::scene_source::{js_number, parse_json_source, Node};
use crate::CoreError;
use serde::Serialize;
use serde_json::{Map, Value};
use std::ops::Range;

const MAX_BYTES: usize = 128 * 1024;

fn invalid() -> CoreError {
    CoreError {
        error_code: "scene_composition_invalid",
        message:
            "Expected one existing placement actor and a nonempty set of local override values.",
    }
}
fn limit() -> CoreError {
    CoreError {
        error_code: "scene_composition_limit",
        message: "The patched composition exceeds its source or expansion budget.",
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SceneCompositionPatchResponse {
    pub after_content: String,
    pub changed_paths: Vec<String>,
}

fn equal(left: &Value, right: &Value) -> bool {
    match (left, right) {
        (Value::Number(a), Value::Number(b)) => a.as_f64() == b.as_f64(),
        (Value::Array(a), Value::Array(b)) => {
            a.len() == b.len() && a.iter().zip(b).all(|(a, b)| equal(a, b))
        }
        _ => left == right,
    }
}

fn encode(value: &Value) -> Result<String, CoreError> {
    match value {
        Value::Number(number) => number
            .as_f64()
            .filter(|number| number.is_finite())
            .map(js_number)
            .ok_or_else(invalid),
        Value::Array(values) => Ok(format!(
            "[{}]",
            values
                .iter()
                .map(encode)
                .collect::<Result<Vec<_>, _>>()?
                .join(",")
        )),
        Value::String(_) | Value::Null => serde_json::to_string(value).map_err(|_| invalid()),
        _ => Err(invalid()),
    }
}

struct Edit {
    span: Range<usize>,
    text: String,
}

fn member<'a>(node: &'a Node, name: &str) -> Result<&'a Node, CoreError> {
    node.get(name).ok_or_else(invalid)
}

// Copy only layout whitespace around a container's first item. Existing
// indentation, line endings, key spelling and delimiters are never rewritten.
fn append_item(content: &str, node: &Node, item: String) -> Result<Edit, CoreError> {
    let start = node.span.start + 1;
    let mut first = start;
    while matches!(
        content.as_bytes().get(first),
        Some(b' ' | b'\t' | b'\r' | b'\n')
    ) {
        first += 1;
    }
    let padding = &content[start..first];
    let last = node
        .object()
        .ok()
        .and_then(|entries| entries.last().map(|(_, value)| value))
        .or_else(|| node.array().ok().and_then(|entries| entries.last()));
    if let Some(last) = last {
        Ok(Edit {
            span: last.span.end..last.span.end,
            text: format!(",{padding}{item}"),
        })
    } else if first == node.span.end - 1 {
        // Empty arrays retain their original trailing whitespace as well.
        Ok(Edit {
            span: start..start,
            text: format!("{padding}{item}"),
        })
    } else {
        Err(invalid())
    }
}

fn colon(content: &str, node: &Node) -> Result<String, CoreError> {
    let entries = node.object().map_err(|_| invalid())?;
    let Some((_, first)) = entries.first() else {
        return Ok(":".to_owned());
    };
    let prefix = &content[node.span.start..first.span.start];
    let index = prefix.rfind(':').ok_or_else(invalid)?;
    Ok(prefix[index..].to_owned())
}

fn replace_value(
    edits: &mut Vec<Edit>,
    node: &Node,
    before: &Value,
    after: &Value,
) -> Result<(), CoreError> {
    if let (Some(before), Some(after), Ok(nodes)) =
        (before.as_array(), after.as_array(), node.array())
    {
        if before.len() == after.len() && before.len() == nodes.len() {
            for ((before, after), node) in before.iter().zip(after).zip(nodes) {
                if !equal(before, after) {
                    edits.push(Edit {
                        span: node.span.clone(),
                        text: encode(after)?,
                    });
                }
            }
            return Ok(());
        }
    }
    edits.push(Edit {
        span: node.span.clone(),
        text: encode(after)?,
    });
    Ok(())
}

pub(crate) fn dispatch(request: &Value) -> Result<SceneCompositionPatchResponse, CoreError> {
    let request = request.as_object().ok_or_else(CoreError::request)?;
    let keys = [
        "protocolVersion",
        "operation",
        "content",
        "placementId",
        "actorKey",
        "values",
    ];
    if request.len() != keys.len() || keys.iter().any(|key| !request.contains_key(*key)) {
        return Err(CoreError::request());
    }
    let content = request["content"].as_str().ok_or_else(CoreError::request)?;
    let placement_id = request["placementId"].as_str().ok_or_else(invalid)?;
    let actor_key = request["actorKey"].as_str().ok_or_else(invalid)?;
    let values = request["values"].as_object().ok_or_else(invalid)?;
    if values.is_empty()
        || values
            .keys()
            .any(|key| !ACTOR_VALUES.contains(&key.as_str()))
    {
        return Err(invalid());
    }
    // Validate every fragment and placement before locating a write target.
    expand(content)?;
    let source: Value = serde_json::from_str(content.strip_prefix('\u{feff}').unwrap_or(content))
        .map_err(|_| invalid())?;
    let placements = source["placements"].as_array().ok_or_else(invalid)?;
    let (placement_index, placement) = placements
        .iter()
        .enumerate()
        .find(|(_, placement)| placement["placementId"].as_str() == Some(placement_id))
        .ok_or_else(invalid)?;
    if !placement["actorIds"]
        .as_object()
        .is_some_and(|ids| ids.contains_key(actor_key))
    {
        return Err(invalid());
    }
    let overrides = placement.get("overrides").and_then(Value::as_array);
    let existing = overrides.and_then(|entries| {
        entries
            .iter()
            .enumerate()
            .find(|(_, entry)| entry["actorKey"].as_str() == Some(actor_key))
    });
    let empty = Map::new();
    let before = existing
        .map(|(_, entry)| entry["values"].as_object().unwrap())
        .unwrap_or(&empty);
    let changed: Vec<_> = ACTOR_VALUES
        .iter()
        .copied()
        .filter(|key| {
            values
                .get(*key)
                .is_some_and(|after| before.get(*key).is_none_or(|before| !equal(before, after)))
        })
        .collect();
    if changed.is_empty() {
        return Ok(SceneCompositionPatchResponse {
            after_content: content.to_owned(),
            changed_paths: vec![],
        });
    }
    let root = parse_json_source(content).map_err(|_| invalid())?;
    let placement_node = &member(&root, "placements")?
        .array()
        .map_err(|_| invalid())?[placement_index];
    let override_index = existing
        .map(|(index, _)| index)
        .unwrap_or_else(|| overrides.map_or(0, Vec::len));
    let mut edits = Vec::new();
    if existing.is_some() {
        let override_node = &member(placement_node, "overrides")?
            .array()
            .map_err(|_| invalid())?[override_index];
        let values_node = member(override_node, "values")?;
        let mut added = Vec::new();
        let colon = colon(content, values_node)?;
        for field in &changed {
            if let Some(node) = values_node.get(field) {
                replace_value(&mut edits, node, &before[*field], &values[*field])?;
            } else {
                added.push(format!("\"{field}\"{colon}{}", encode(&values[*field])?));
            }
        }
        if !added.is_empty() {
            let mut insertion = append_item(content, values_node, added[0].clone())?;
            // The copied separator is independent of the newly added payload.
            let separator = &insertion.text[..insertion.text.len() - added[0].len()];
            insertion.text = format!("{}{}", separator, added.join(separator));
            edits.push(insertion);
        }
    } else {
        let entries = changed
            .iter()
            .map(|field| Ok(format!("\"{field}\":{}", encode(&values[*field])?)))
            .collect::<Result<Vec<_>, CoreError>>()?
            .join(",");
        let entry = format!(
            "{{\"actorKey\":{},\"values\":{{{entries}}}}}",
            serde_json::to_string(actor_key).map_err(|_| invalid())?
        );
        if let Some(overrides_node) = placement_node.get("overrides") {
            edits.push(append_item(content, overrides_node, entry)?);
        } else {
            edits.push(append_item(
                content,
                placement_node,
                format!("\"overrides\"{}[{entry}]", colon(content, placement_node)?),
            )?);
        }
    }
    edits.sort_by_key(|edit| edit.span.start);
    let mut output = String::with_capacity(content.len());
    let mut cursor = 0;
    for edit in edits {
        if edit.span.start < cursor {
            return Err(invalid());
        }
        output.push_str(&content[cursor..edit.span.start]);
        output.push_str(&edit.text);
        cursor = edit.span.end;
    }
    output.push_str(&content[cursor..]);
    if output.len() > MAX_BYTES {
        return Err(limit());
    }
    // Also checks merged inheritance/null semantics and post-offset bounds.
    expand(&output)?;
    Ok(SceneCompositionPatchResponse {
        after_content: output,
        changed_paths: changed
            .iter()
            .map(|field| {
                format!("/placements/{placement_index}/overrides/{override_index}/values/{field}")
            })
            .collect(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn id(number: usize) -> String {
        format!("00000000-0000-0000-0000-{number:012x}")
    }
    fn recipe() -> Value {
        json!({"format":"viento-scene-composition", "schemaVersion":1,
        "scene":{"title":"Recipe 配方🦊", "viewport":[640,480], "background":"#aabbcc"},
        "fragments":[{"fragmentId":"pair", "groups":[], "actors":[
            {"key":"leader", "objectId":id(1), "position":[10,20], "size":[32,32], "color":"#aabbcc", "speed":150,"controls":"arrows"},
            {"key":"companion", "objectId":id(1), "position":[50,60], "useProjectionDefaults":true}
        ]}],"placements":[
            {"placementId":id(10), "fragmentId":"pair", "actorIds":{"leader":id(11),"companion":id(12)},"groupIds":{}},
            {"placementId":id(20), "fragmentId":"pair", "actorIds":{"leader":id(21),"companion":id(22)},"groupIds":{},"offset":[300,80],
             "overrides":[{"actorKey":"leader","values":{"position":[30,40],"speed":180}}]}
        ]})
    }
    fn text(value: &Value) -> String {
        format!(
            "\u{feff}{}\r\n \t",
            serde_json::to_string_pretty(value)
                .unwrap()
                .replace('\n', "\r\n")
        )
    }
    fn request(content: &str, placement: usize, actor: &str, values: Value) -> Value {
        json!({"protocolVersion":1,"operation":"sceneComposition.patchOverrides", "content":content,
            "placementId":id(placement),"actorKey":actor,"values":values})
    }
    fn run(
        content: &str,
        placement: usize,
        actor: &str,
        values: Value,
    ) -> SceneCompositionPatchResponse {
        dispatch(&request(content, placement, actor, values)).unwrap()
    }
    fn parsed(content: &str) -> Value {
        serde_json::from_str(content.strip_prefix('\u{feff}').unwrap_or(content)).unwrap()
    }
    fn assert_only_target(before: &str, after: &str, placement: usize, actor: &str, values: Value) {
        let mut expected = parsed(before);
        let placement = expected["placements"]
            .as_array_mut()
            .unwrap()
            .iter_mut()
            .find(|item| item["placementId"] == id(placement))
            .unwrap()
            .as_object_mut()
            .unwrap();
        let entries = placement
            .entry("overrides")
            .or_insert_with(|| json!([]))
            .as_array_mut()
            .unwrap();
        let index = entries
            .iter()
            .position(|item| item["actorKey"] == actor)
            .unwrap_or_else(|| {
                entries.push(json!({"actorKey":actor,"values":{}}));
                entries.len() - 1
            });
        for (key, value) in values.as_object().unwrap() {
            entries[index]["values"][key] = value.clone();
        }
        assert_eq!(parsed(after), expected);
        expand(after).unwrap();
        assert_eq!(
            before.starts_with('\u{feff}'),
            after.starts_with('\u{feff}')
        );
        assert_eq!(before.ends_with("\r\n \t"), after.ends_with("\r\n \t"));
    }

    #[test]
    fn only_changed_existing_scalar_tokens_are_replaced() {
        let source = text(&recipe()).replace("\"speed\": 180", "\"spe\\u0065d\": 1.8e2");
        let result = run(&source, 20, "leader", json!({"speed":90}));
        assert_eq!(result.after_content, source.replace("1.8e2", "90"));
        assert_eq!(
            result.changed_paths,
            ["/placements/1/overrides/0/values/speed"]
        );
        assert_only_target(
            &source,
            &result.after_content,
            20,
            "leader",
            json!({"speed":90}),
        );
    }

    #[test]
    fn array_patch_retains_unchanged_axis_lexemes_and_internal_whitespace() {
        let source = serde_json::to_string(&recipe())
            .unwrap()
            .replace("[30,40]", "[3e1,\r\n\t 4e1]");
        let result = run(&source, 20, "leader", json!({"position":[30,55]}));
        assert_eq!(result.after_content, source.replace("4e1", "55"));
        assert_eq!(
            result.changed_paths,
            ["/placements/1/overrides/0/values/position"]
        );
    }

    #[test]
    fn existing_values_gain_ordered_fields_without_reformatting_others() {
        let source = serde_json::to_string(&recipe()).unwrap();
        let values = json!({"controls":"none","color":"#556677","size":[40,48],"speed":90});
        let result = run(&source, 20, "leader", values.clone());
        let expected = source.replace(
            "\"speed\":180",
            "\"speed\":90,\"size\":[40,48],\"color\":\"#556677\",\"controls\":\"none\"",
        );
        assert_eq!(result.after_content, expected);
        assert_eq!(
            result.changed_paths,
            ["size", "color", "speed", "controls"]
                .map(|name| format!("/placements/1/overrides/0/values/{name}"))
        );
        assert_only_target(&source, &result.after_content, 20, "leader", values);
    }

    #[test]
    fn missing_override_array_is_inserted_only_inside_the_selected_placement() {
        let source = text(&recipe());
        let result = run(&source, 10, "leader", json!({"position":[10,20]}));
        assert_only_target(
            &source,
            &result.after_content,
            10,
            "leader",
            json!({"position":[10,20]}),
        );
        assert_eq!(
            result.changed_paths,
            ["/placements/0/overrides/0/values/position"]
        );
        let inserted = ",\r\n      \"overrides\": [{\"actorKey\":\"leader\",\"values\":{\"position\":[10,20]}}]";
        assert_eq!(result.after_content.replace(inserted, ""), source);
        // Equality with the template still introduces a deliberate local set.
        assert_ne!(result.after_content, source);
    }

    #[test]
    fn empty_arrays_and_a_missing_actor_override_append_without_touching_other_entries() {
        for overrides in [
            json!([]),
            json!([{"actorKey":"companion","values":{"speed":4}}]),
        ] {
            let mut value = recipe();
            value["placements"][0]["overrides"] = overrides;
            let source = text(&value);
            let result = run(&source, 10, "leader", json!({"controls":"none"}));
            assert_only_target(
                &source,
                &result.after_content,
                10,
                "leader",
                json!({"controls":"none"}),
            );
            let index = value["placements"][0]["overrides"]
                .as_array()
                .unwrap()
                .len();
            assert_eq!(
                result.changed_paths,
                [format!("/placements/0/overrides/{index}/values/controls")]
            );
            assert_eq!(
                expand(&source).unwrap().scene["actors"][1],
                expand(&result.after_content).unwrap().scene["actors"][1]
            );
        }
    }

    #[test]
    fn equivalent_existing_values_are_a_byte_identical_noop() {
        let source = text(&recipe()).replace("\"speed\": 180", "\"speed\": 1.8e2");
        let result = run(
            &source,
            20,
            "leader",
            json!({"speed":180.0,"position":[30.0,40.0]}),
        );
        assert_eq!(result.after_content, source);
        assert!(result.changed_paths.is_empty());
        let again = run(&source, 20, "leader", json!({"speed":90}));
        let repeated = run(&again.after_content, 20, "leader", json!({"speed":90}));
        assert_eq!(repeated.after_content, again.after_content);
        assert!(repeated.changed_paths.is_empty());
    }

    #[test]
    fn stable_target_survives_placement_and_override_reordering() {
        let mut value = recipe();
        value["placements"][1]["overrides"]
            .as_array_mut()
            .unwrap()
            .insert(0, json!({"actorKey":"companion","values":{"speed":1}}));
        value["placements"].as_array_mut().unwrap().reverse();
        let source = text(&value);
        let result = run(&source, 20, "leader", json!({"speed":17}));
        assert_eq!(
            result.changed_paths,
            ["/placements/0/overrides/1/values/speed"]
        );
        assert_only_target(
            &source,
            &result.after_content,
            20,
            "leader",
            json!({"speed":17}),
        );
    }

    #[test]
    fn null_images_follow_inheritance_and_position_remains_local_before_offset() {
        let source = text(&recipe());
        assert_eq!(
            dispatch(&request(
                &source,
                10,
                "leader",
                json!({"imageResourceId":null})
            ))
            .unwrap_err()
            .error_code,
            "scene_composition_invalid"
        );
        let result = run(
            &source,
            20,
            "companion",
            json!({"imageResourceId":null,"position":[2,3]}),
        );
        assert_only_target(
            &source,
            &result.after_content,
            20,
            "companion",
            json!({"imageResourceId":null,"position":[2,3]}),
        );
        let expanded = expand(&result.after_content).unwrap();
        assert_eq!(
            expanded.scene["actors"][3]["position"],
            json!([302.0, 83.0])
        );
        assert_eq!(expanded.scene["actors"][3]["imageResourceId"], Value::Null);
        let image = run(&source, 10, "leader", json!({"imageResourceId":id(30)}));
        assert_only_target(
            &source,
            &image.after_content,
            10,
            "leader",
            json!({"imageResourceId":id(30)}),
        );
    }

    #[test]
    fn all_six_fields_set_atomically_and_bad_values_never_produce_partial_output() {
        let source = text(&recipe());
        let values = json!({"position":[-4,5],"size":[1,2048],"color":"#ABCDEF80","speed":2000,"controls":"none","imageResourceId":id(30)});
        let result = run(&source, 10, "leader", values.clone());
        assert_eq!(result.changed_paths.len(), 6);
        assert_only_target(&source, &result.after_content, 10, "leader", values);
        for bad in [
            json!({}),
            json!([]),
            json!({"position":[1]}),
            json!({"position":[100000,0]}),
            json!({"size":[0,32]}),
            json!({"speed":2001}),
            json!({"speed":-1}),
            json!({"speed":null}),
            json!({"controls":"wasd"}),
            json!({"color":"red"}),
            json!({"imageResourceId":"bad"}),
            json!({"position":[true,0]}),
            json!({"objectId":id(2)}),
            json!({"groupKey":"other"}),
            json!({"useProjectionDefaults":false}),
            json!({"size":[10,20],"speed":false}),
            json!({"position":[[1],0]}),
        ] {
            assert_eq!(
                dispatch(&request(&source, 20, "leader", bad))
                    .unwrap_err()
                    .error_code,
                "scene_composition_invalid"
            );
        }
    }

    #[test]
    fn request_shape_unknown_targets_and_all_original_recipe_errors_are_rejected() {
        let source = text(&recipe());
        for (placement, actor) in [
            (99, "leader"),
            (20, "missing"),
            (20, "Leader"),
            (20, "__proto__"),
        ] {
            assert_eq!(
                dispatch(&request(&source, placement, actor, json!({"speed":9})))
                    .unwrap_err()
                    .error_code,
                "scene_composition_invalid"
            );
        }
        let mut extra = request(&source, 20, "leader", json!({"speed":9}));
        extra["index"] = json!(0);
        assert_eq!(
            dispatch(&extra).unwrap_err().error_code,
            "studio_core_request_invalid"
        );
        for broken in [
            "{".to_owned(),
            source.replace("\"speed\": 180", "\"speed\":180,\"spe\\u0065d\":180"),
            source.replace("\"speed\": 150", "\"speed\": 2001"),
            source.replace("\"groups\": []", "\"groups\": [],\"unknown\":1"),
        ] {
            assert_eq!(
                dispatch(&request(&broken, 20, "leader", json!({"speed":9})))
                    .unwrap_err()
                    .error_code,
                "scene_composition_invalid"
            );
        }
    }

    #[test]
    fn source_and_output_utf8_budgets_are_enforced_before_returning_content() {
        let source = text(&recipe());
        let boundary = format!("{source}{}", " ".repeat(MAX_BYTES - source.len()));
        let noop = run(&boundary, 20, "leader", json!({"speed":180}));
        assert_eq!(noop.after_content.len(), MAX_BYTES);
        assert_eq!(
            dispatch(&request(
                &(boundary.clone() + " "),
                20,
                "leader",
                json!({"speed":180})
            ))
            .unwrap_err()
            .error_code,
            "scene_composition_limit"
        );
        assert_eq!(
            dispatch(&request(&boundary, 10, "leader", json!({"speed":180})))
                .unwrap_err()
                .error_code,
            "scene_composition_limit"
        );
        let too_long = format!(
            "{source}{}",
            "界".repeat((MAX_BYTES - source.len()) / 3 + 1)
        );
        assert!(too_long.chars().count() < MAX_BYTES);
        assert_eq!(
            dispatch(&request(&too_long, 20, "leader", json!({"speed":180})))
                .unwrap_err()
                .error_code,
            "scene_composition_limit"
        );
    }

    #[test]
    fn numerical_replacements_use_the_existing_javascript_number_spelling() {
        let source = serde_json::to_string(&recipe()).unwrap();
        for (number, expected) in [
            (0.0000001, "1e-7"),
            (0.000001, "0.000001"),
            (-0.0, "0"),
            (1.0000000000000002, "1.0000000000000002"),
        ] {
            let result = run(&source, 20, "leader", json!({"speed":number}));
            assert_eq!(
                result.after_content,
                source.replace("\"speed\":180", &format!("\"speed\":{expected}"))
            );
        }
    }
}
