//! Stateless, narrowly scoped local override patches of an author recipe.
//! Existing token bytes are retained; expansion remains the only recipe rule set.
#![forbid(unsafe_code)]

use crate::scene_composition::{expand, ACTOR_VALUES};
use crate::scene_source::{js_number, parse_json_source, Node};
use crate::CoreError;
use serde::Serialize;
use serde_json::{Map, Value};
use std::collections::{BTreeMap, HashSet};
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

pub(crate) fn equal(left: &Value, right: &Value) -> bool {
    match (left, right) {
        (Value::Number(a), Value::Number(b)) => a.as_f64() == b.as_f64(),
        (Value::Array(a), Value::Array(b)) => {
            a.len() == b.len() && a.iter().zip(b).all(|(a, b)| equal(a, b))
        }
        _ => left == right,
    }
}

pub(crate) fn encode(value: &Value) -> Result<String, CoreError> {
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

pub(crate) struct Edit {
    pub(crate) span: Range<usize>,
    pub(crate) text: String,
}

pub(crate) fn member<'a>(node: &'a Node, name: &str) -> Result<&'a Node, CoreError> {
    node.get(name).ok_or_else(invalid)
}

// Copy only layout whitespace around a container's first item. Existing
// indentation, line endings, key spelling and delimiters are never rewritten.
pub(crate) fn append_item(content: &str, node: &Node, item: String) -> Result<Edit, CoreError> {
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

pub(crate) fn colon(content: &str, node: &Node) -> Result<String, CoreError> {
    let entries = node.object().map_err(|_| invalid())?;
    let Some((_, first)) = entries.first() else {
        return Ok(":".to_owned());
    };
    let prefix = &content[node.span.start..first.span.start];
    let index = prefix.rfind(':').ok_or_else(invalid)?;
    Ok(prefix[index..].to_owned())
}

pub(crate) fn replace_value(
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

// All source patch operations use one checked application of disjoint byte
// edits. The budget belongs to the final candidate, never an intermediate edit.
pub(crate) fn apply_edits(content: &str, mut edits: Vec<Edit>) -> Result<String, CoreError> {
    edits.sort_by_key(|edit| edit.span.start);
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
    if output.len() > MAX_BYTES {
        return Err(limit());
    }
    expand(&output)?;
    Ok(output)
}

// Remove whole contiguous item runs and their necessary delimiters. The
// retained item tokens and every byte outside these ranges remain untouched.
pub(crate) fn remove_items(spans: &[Range<usize>], removed: &[bool]) -> Vec<Edit> {
    let mut edits = Vec::new();
    let mut index = 0;
    while index < spans.len() {
        if !removed[index] {
            index += 1;
            continue;
        }
        let first = index;
        while index < spans.len() && removed[index] {
            index += 1;
        }
        let span = if index < spans.len() {
            spans[first].start..spans[index].start
        } else if first > 0 {
            spans[first - 1].end..spans[index - 1].end
        } else {
            spans[first].start..spans[index - 1].end
        };
        edits.push(Edit {
            span,
            text: String::new(),
        });
    }
    edits
}

// One expansion and one source tree bind the entire batch. Insertions that
// share a placement are combined before touching bytes; no intermediate
// recipe or budget decision can expose a partial candidate.
pub(crate) fn dispatch_positions(
    request: &Value,
) -> Result<SceneCompositionPatchResponse, CoreError> {
    let request = request.as_object().ok_or_else(CoreError::request)?;
    let keys = ["protocolVersion", "operation", "content", "changes"];
    if request.len() != keys.len()
        || keys.iter().any(|key| !request.contains_key(*key))
        || request["operation"].as_str() != Some("sceneComposition.patchPositions")
    {
        return Err(CoreError::request());
    }
    let content = request["content"].as_str().ok_or_else(CoreError::request)?;
    let changes = request["changes"].as_array().ok_or_else(invalid)?;
    if changes.is_empty() || changes.len() > 128 {
        return Err(invalid());
    }
    expand(content)?;
    let source: Value = serde_json::from_str(content.strip_prefix('\u{feff}').unwrap_or(content))
        .map_err(|_| invalid())?;
    let placements = source["placements"].as_array().ok_or_else(invalid)?;
    let fragments = source["fragments"].as_array().ok_or_else(invalid)?;
    let root = parse_json_source(content).map_err(|_| invalid())?;
    let placement_nodes = member(&root, "placements")?
        .array()
        .map_err(|_| invalid())?;
    let mut seen = HashSet::new();
    let mut grouped = BTreeMap::<usize, Vec<(usize, String, Value)>>::new();
    for change in changes {
        let change = change.as_object().ok_or_else(invalid)?;
        if change.len() != 3
            || ["placementId", "actorKey", "position"]
                .iter()
                .any(|key| !change.contains_key(*key))
        {
            return Err(invalid());
        }
        let placement_id = change["placementId"].as_str().ok_or_else(invalid)?;
        let actor_key = change["actorKey"].as_str().ok_or_else(invalid)?;
        let position = change["position"].as_array().ok_or_else(invalid)?;
        if position.len() != 2
            || position.iter().any(|value| {
                value
                    .as_f64()
                    .is_none_or(|n| !n.is_finite() || n.abs() > 100000.0)
            })
            || !seen.insert((placement_id, actor_key))
        {
            return Err(invalid());
        }
        let (placement_index, placement) = placements
            .iter()
            .enumerate()
            .find(|(_, placement)| placement["placementId"].as_str() == Some(placement_id))
            .ok_or_else(invalid)?;
        let fragment = fragments
            .iter()
            .find(|fragment| fragment["fragmentId"] == placement["fragmentId"])
            .ok_or_else(invalid)?;
        let (actor_index, actor) = fragment["actors"]
            .as_array()
            .ok_or_else(invalid)?
            .iter()
            .enumerate()
            .find(|(_, actor)| actor["key"].as_str() == Some(actor_key))
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
                .find(|entry| entry["actorKey"].as_str() == Some(actor_key))
        });
        let local = existing
            .and_then(|entry| entry["values"].get("position"))
            .unwrap_or(&actor["position"]);
        if !equal(local, &change["position"]) {
            grouped.entry(placement_index).or_default().push((
                actor_index,
                actor_key.to_owned(),
                change["position"].clone(),
            ));
        }
    }
    let mut edits = Vec::new();
    let mut changed_paths = Vec::new();
    for (placement_index, mut changes) in grouped {
        changes.sort_by_key(|change| change.0);
        let placement = &placements[placement_index];
        let placement_node = &placement_nodes[placement_index];
        let overrides = placement.get("overrides").and_then(Value::as_array);
        let mut added = Vec::new();
        for (_, actor_key, position) in changes {
            let existing = overrides.and_then(|entries| {
                entries
                    .iter()
                    .enumerate()
                    .find(|(_, entry)| entry["actorKey"].as_str() == Some(&actor_key))
            });
            let override_index = if let Some((index, entry)) = existing {
                let override_node = &member(placement_node, "overrides")?
                    .array()
                    .map_err(|_| invalid())?[index];
                let values_node = member(override_node, "values")?;
                if let Some(node) = values_node.get("position") {
                    replace_value(&mut edits, node, &entry["values"]["position"], &position)?;
                } else {
                    edits.push(append_item(
                        content,
                        values_node,
                        format!(
                            "\"position\"{}{}",
                            colon(content, values_node)?,
                            encode(&position)?
                        ),
                    )?);
                }
                index
            } else {
                let index = overrides.map_or(0, Vec::len) + added.len();
                added.push(format!(
                    "{{\"actorKey\":{},\"values\":{{\"position\":{}}}}}",
                    serde_json::to_string(&actor_key).map_err(|_| invalid())?,
                    encode(&position)?
                ));
                index
            };
            changed_paths.push(format!(
                "/placements/{placement_index}/overrides/{override_index}/values/position"
            ));
        }
        if !added.is_empty() {
            if let Some(node) = placement_node.get("overrides") {
                let mut insertion = append_item(content, node, added[0].clone())?;
                let separator = &insertion.text[..insertion.text.len() - added[0].len()];
                // Empty arrays have whitespace but no leading comma. Every
                // subsequent new item uses the same whitespace and a comma.
                let between = if overrides.is_some_and(Vec::is_empty) {
                    format!(",{separator}")
                } else {
                    separator.to_owned()
                };
                insertion.text = format!("{separator}{}", added.join(&between));
                edits.push(insertion);
            } else {
                edits.push(append_item(
                    content,
                    placement_node,
                    format!(
                        "\"overrides\"{}[{}]",
                        colon(content, placement_node)?,
                        added.join(",")
                    ),
                )?);
            }
        }
    }
    let output = apply_edits(content, edits)?;
    Ok(SceneCompositionPatchResponse {
        after_content: output,
        changed_paths,
    })
}

pub(crate) fn dispatch(request: &Value) -> Result<SceneCompositionPatchResponse, CoreError> {
    let request = request.as_object().ok_or_else(CoreError::request)?;
    let editing =
        request.get("operation").and_then(Value::as_str) == Some("sceneComposition.editOverrides");
    let keys = [
        "protocolVersion",
        "operation",
        "content",
        "placementId",
        "actorKey",
        "values",
    ];
    if request.len() != keys.len() + usize::from(editing)
        || keys.iter().any(|key| !request.contains_key(*key))
        || editing && !request.contains_key("resetFields")
    {
        return Err(CoreError::request());
    }
    let content = request["content"].as_str().ok_or_else(CoreError::request)?;
    let placement_id = request["placementId"].as_str().ok_or_else(invalid)?;
    let actor_key = request["actorKey"].as_str().ok_or_else(invalid)?;
    let values = request["values"].as_object().ok_or_else(invalid)?;
    let mut reset = HashSet::new();
    if editing {
        let fields = request["resetFields"].as_array().ok_or_else(invalid)?;
        if fields.len() > ACTOR_VALUES.len() {
            return Err(invalid());
        }
        for field in fields {
            let field = field.as_str().ok_or_else(invalid)?;
            if !ACTOR_VALUES.contains(&field) || !reset.insert(field) || values.contains_key(field)
            {
                return Err(invalid());
            }
        }
    }
    if values.is_empty() && reset.is_empty()
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
            reset.contains(key) && before.contains_key(*key)
                || values.get(*key).is_some_and(|after| {
                    before.get(*key).is_none_or(|before| !equal(before, after))
                })
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
        let override_nodes = member(placement_node, "overrides")?
            .array()
            .map_err(|_| invalid())?;
        let override_node = &override_nodes[override_index];
        let values_node = member(override_node, "values")?;
        let surviving = before
            .keys()
            .filter(|field| !reset.contains(field.as_str()))
            .count();
        if surviving == 0 && values.is_empty() {
            let spans: Vec<_> = override_nodes
                .iter()
                .map(|node| node.span.clone())
                .collect();
            let removed: Vec<_> = (0..spans.len())
                .map(|index| index == override_index)
                .collect();
            edits.extend(remove_items(&spans, &removed));
        } else {
            let members = values_node.object().map_err(|_| invalid())?;
            let spans = members
                .iter()
                .map(|(_, node)| node.member_span.clone().ok_or_else(invalid))
                .collect::<Result<Vec<_>, _>>()?;
            let removed: Vec<_> = members
                .iter()
                .map(|(key, _)| {
                    reset
                        .iter()
                        .any(|field| key.iter().copied().eq(field.encode_utf16()))
                })
                .collect();
            edits.extend(remove_items(&spans, &removed));
            let mut added = Vec::new();
            let colon = colon(content, values_node)?;
            for field in &changed {
                if reset.contains(field) {
                    continue;
                }
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
                insertion.text = if surviving == 0 {
                    // Removing all old members already retains the leading
                    // container whitespace. New members need no leading comma.
                    added.join(separator)
                } else {
                    format!("{}{}", separator, added.join(separator))
                };
                edits.push(insertion);
            }
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
    // Also checks merged inheritance/null semantics and post-offset bounds.
    let output = apply_edits(content, edits)?;
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
    fn edit_request(
        content: &str,
        placement: usize,
        actor: &str,
        values: Value,
        reset: Value,
    ) -> Value {
        json!({"protocolVersion":1,"operation":"sceneComposition.editOverrides", "content":content,
            "placementId":id(placement),"actorKey":actor,"values":values,"resetFields":reset})
    }
    fn edit(
        content: &str,
        placement: usize,
        actor: &str,
        values: Value,
        reset: Value,
    ) -> SceneCompositionPatchResponse {
        dispatch(&edit_request(content, placement, actor, values, reset)).unwrap()
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
    fn assert_only_edit(
        before: &str,
        after: &str,
        placement: usize,
        actor: &str,
        values: Value,
        reset: &[&str],
    ) {
        let mut expected = parsed(before);
        let placement = expected["placements"]
            .as_array_mut()
            .unwrap()
            .iter_mut()
            .find(|item| item["placementId"] == id(placement))
            .unwrap()
            .as_object_mut()
            .unwrap();
        if let Some(entries) = placement.get_mut("overrides").and_then(Value::as_array_mut) {
            if let Some(index) = entries.iter().position(|entry| entry["actorKey"] == actor) {
                let local = entries[index]["values"].as_object_mut().unwrap();
                for field in reset {
                    local.remove(*field);
                }
                local.extend(values.as_object().unwrap().clone());
                if local.is_empty() {
                    entries.remove(index);
                }
            } else if !values.as_object().unwrap().is_empty() {
                entries.push(json!({"actorKey":actor,"values":values}));
            }
        } else if !values.as_object().unwrap().is_empty() {
            placement.insert(
                "overrides".to_owned(),
                json!([{"actorKey":actor,"values":values}]),
            );
        }
        assert_eq!(parsed(after), expected);
        expand(after).unwrap();
        assert_eq!(
            before.starts_with('\u{feff}'),
            after.starts_with('\u{feff}')
        );
        assert_eq!(before.ends_with("\r\n \t"), after.ends_with("\r\n \t"));
    }
    fn source_with_values(raw: &str) -> String {
        format!(
            "\u{feff}{}\r\n \t",
            serde_json::to_string(&recipe())
                .unwrap()
                .replace("{\"position\":[30,40],\"speed\":180}", raw)
        )
    }

    #[test]
    fn atomic_edit_has_an_independent_capability_and_exact_request_shape() {
        assert_eq!(crate::viento_core_scene_composition_edit_version(), 1);
        assert_eq!(crate::viento_core_scene_composition_patch_version(), 1);
        assert_eq!(crate::viento_core_scene_composition_version(), 1);
        assert_eq!(crate::PROTOCOL_VERSION, 1);
        let content = text(&recipe());
        let operation = edit_request(&content, 20, "leader", json!({}), json!(["speed"]));
        let wire: Value = serde_json::from_slice(&crate::dispatch_json(
            &serde_json::to_vec(&operation).unwrap(),
        ))
        .unwrap();
        assert_eq!(wire["ok"], true);
        assert_eq!(
            wire["compositionPatch"]["changedPaths"],
            json!(["/placements/1/overrides/0/values/speed"])
        );
        for key in [
            "protocolVersion",
            "operation",
            "content",
            "placementId",
            "actorKey",
            "values",
            "resetFields",
        ] {
            let mut missing = operation.clone();
            missing.as_object_mut().unwrap().remove(key);
            assert_eq!(
                dispatch(&missing).unwrap_err().error_code,
                "studio_core_request_invalid",
                "{key}"
            );
        }
        let mut extra = operation.clone();
        extra["index"] = json!(0);
        assert_eq!(
            dispatch(&extra).unwrap_err().error_code,
            "studio_core_request_invalid"
        );
        let mut legacy = request(&content, 20, "leader", json!({"speed":90}));
        legacy["resetFields"] = json!([]);
        assert_eq!(
            dispatch(&legacy).unwrap_err().error_code,
            "studio_core_request_invalid"
        );
        assert_eq!(
            dispatch(&request(&content, 20, "leader", json!({})))
                .unwrap_err()
                .error_code,
            "scene_composition_invalid"
        );
        let old = run(&content, 20, "leader", json!({"speed":90}));
        let new = edit(&content, 20, "leader", json!({"speed":90}), json!([]));
        assert_eq!(old.after_content, new.after_content);
        assert_eq!(old.changed_paths, new.changed_paths);
    }

    #[test]
    fn reset_fields_require_a_unique_disjoint_nonempty_supported_intent() {
        let content = text(&recipe());
        for (values, reset) in [
            (json!({}), json!([])),
            (json!({}), json!(null)),
            (json!({}), json!({})),
            (json!({}), json!([1])),
            (json!({}), json!([null])),
            (json!({}), json!(["speed", "speed"])),
            (json!({}), json!(["objectId"])),
            (json!({}), json!(["useProjectionDefaults"])),
            (
                json!({}),
                json!([
                    "position",
                    "size",
                    "color",
                    "speed",
                    "controls",
                    "imageResourceId",
                    "speed"
                ]),
            ),
            (json!({"speed":180}), json!(["speed"])),
            (json!({"objectId":id(99)}), json!(["speed"])),
            (json!([]), json!(["speed"])),
            (json!({"size":[40,48], "speed":false}), json!(["position"])),
        ] {
            assert_eq!(
                dispatch(&edit_request(&content, 20, "leader", values, reset))
                    .unwrap_err()
                    .error_code,
                "scene_composition_invalid"
            );
        }
        for (placement, actor) in [
            (99, "leader"),
            (20, "missing"),
            (20, "Leader"),
            (20, "__proto__"),
        ] {
            assert_eq!(
                dispatch(&edit_request(
                    &content,
                    placement,
                    actor,
                    json!({}),
                    json!(["speed"])
                ))
                .unwrap_err()
                .error_code,
                "scene_composition_invalid"
            );
        }
    }

    #[test]
    fn resetting_first_middle_or_last_members_keeps_every_other_lexeme() {
        let raw = "{\"spe\\u0065d\":1.8e2,\r\n\t\"controls\":\"none\", \"position\":[3e1,-0]}";
        let content = source_with_values(raw);
        for (field, removed) in [
            ("speed", "\"spe\\u0065d\":1.8e2,\r\n\t"),
            ("controls", "\"controls\":\"none\", "),
            ("position", ", \"position\":[3e1,-0]"),
        ] {
            let result = edit(&content, 20, "leader", json!({}), json!([field]));
            assert_eq!(
                result.after_content,
                content.replace(removed, ""),
                "{field}"
            );
            assert_eq!(
                result.changed_paths,
                [format!("/placements/1/overrides/0/values/{field}")]
            );
            assert_only_edit(
                &content,
                &result.after_content,
                20,
                "leader",
                json!({}),
                &[field],
            );
        }
    }

    #[test]
    fn all_reset_subsets_preserve_retained_fields_and_report_fixed_source_paths() {
        let raw = format!("{{ \r\n\t\"speed\":1.8e2, \"position\":[3e1,-0],\r\n\"imageResourceId\":\"{}\",\"controls\":\"none\",\"color\":\"#ABCDEF80\",\"size\":[3.2e1,48] \r\n }}", id(30));
        let content = source_with_values(&raw);
        for mask in 1..(1 << ACTOR_VALUES.len()) {
            let fields: Vec<_> = ACTOR_VALUES
                .iter()
                .enumerate()
                .filter(|(bit, _)| mask & (1 << bit) != 0)
                .map(|(_, field)| *field)
                .collect();
            let result = edit(&content, 20, "leader", json!({}), json!(fields));
            assert_only_edit(
                &content,
                &result.after_content,
                20,
                "leader",
                json!({}),
                &fields,
            );
            assert_eq!(
                result.changed_paths,
                fields
                    .iter()
                    .map(|field| format!("/placements/1/overrides/0/values/{field}"))
                    .collect::<Vec<_>>()
            );
            for (field, spelling) in [
                ("speed", "1.8e2"),
                ("position", "[3e1,-0]"),
                ("size", "[3.2e1,48]"),
                ("color", "#ABCDEF80"),
            ] {
                if !fields.contains(&field) {
                    assert!(
                        result.after_content.contains(spelling),
                        "mask={mask}, {field}"
                    );
                }
            }
        }
    }

    #[test]
    fn mixed_edits_replace_arrays_remove_tail_runs_and_append_without_overlap() {
        let raw = "{\"position\":[3e1,\r\n\t4e1],\"controls\":\"none\", \"speed\":1.8e2}";
        let content = source_with_values(raw);
        let values = json!({"position":[30.0,55], "size":[40,48], "color":"#334455"});
        let result = edit(
            &content,
            20,
            "leader",
            values.clone(),
            json!(["speed", "controls"]),
        );
        assert_eq!(
            result.after_content,
            content.replace(
                raw,
                "{\"position\":[3e1,\r\n\t55],\"size\":[40,48],\"color\":\"#334455\"}"
            )
        );
        assert_eq!(
            result.changed_paths,
            ["position", "size", "color", "speed", "controls"]
                .map(|field| format!("/placements/1/overrides/0/values/{field}"))
        );
        assert_only_edit(
            &content,
            &result.after_content,
            20,
            "leader",
            values,
            &["speed", "controls"],
        );
    }

    #[test]
    fn replacing_every_old_member_with_new_fields_retains_container_layout() {
        let raw = "{ \r\n\t\"position\": [3e1,4e1], \"speed\": 1.8e2 \r\n }";
        let content = source_with_values(raw);
        let values = json!({"size":[40,48], "color":"#112233"});
        let result = edit(
            &content,
            20,
            "leader",
            values.clone(),
            json!(["speed", "position"]),
        );
        assert_eq!(
            result.after_content,
            content.replace(
                raw,
                "{ \r\n\t\"size\": [40,48], \r\n\t\"color\": \"#112233\" \r\n }"
            )
        );
        assert_only_edit(
            &content,
            &result.after_content,
            20,
            "leader",
            values,
            &["speed", "position"],
        );
    }

    #[test]
    fn last_field_reset_removes_only_the_selected_override_entry() {
        let mut value = recipe();
        value["fragments"][0]["actors"].as_array_mut().unwrap().push(json!({"key":"third","objectId":id(1),"position":[60,70],"useProjectionDefaults":true}));
        for (placement, instance) in [(0, 14), (1, 24)] {
            value["placements"][placement]["actorIds"]["third"] = json!(id(instance));
        }
        let raw = "[{\"actorKey\":\"leader\",\"values\":{\"speed\":1.8e2}},\r\n\t{\"actorKey\":\"companion\",\"values\":{\"speed\":4e1}}, {\"actorKey\":\"third\",\"values\":{\"speed\":5e1}}]";
        value["placements"][1]["overrides"] = parsed(raw);
        let compact = value.to_string();
        let array = value["placements"][1]["overrides"].to_string();
        let content = format!("\u{feff}{}\r\n \t", compact.replace(&array, raw));
        for (index, actor, removed) in [
            (
                0,
                "leader",
                "{\"actorKey\":\"leader\",\"values\":{\"speed\":1.8e2}},\r\n\t",
            ),
            (
                1,
                "companion",
                "{\"actorKey\":\"companion\",\"values\":{\"speed\":4e1}}, ",
            ),
            (
                2,
                "third",
                ", {\"actorKey\":\"third\",\"values\":{\"speed\":5e1}}",
            ),
        ] {
            let result = edit(&content, 20, actor, json!({}), json!(["speed"]));
            assert_eq!(result.after_content, content.replace(removed, ""));
            assert_eq!(
                result.changed_paths,
                [format!("/placements/1/overrides/{index}/values/speed")]
            );
            assert_only_edit(
                &content,
                &result.after_content,
                20,
                actor,
                json!({}),
                &["speed"],
            );
        }
        let sole = source_with_values("{\"speed\":1.8e2}");
        let result = edit(&sole, 20, "leader", json!({}), json!(["speed"]));
        let entry = "{\"actorKey\":\"leader\",\"values\":{\"speed\":1.8e2}}";
        assert_eq!(result.after_content, sole.replace(entry, ""));
        assert_eq!(
            parsed(&result.after_content)["placements"][1]["overrides"],
            json!([])
        );
    }

    #[test]
    fn missing_reset_fields_are_byte_identical_and_sets_still_use_stable_identity() {
        let mut value = recipe();
        for entries in [
            None,
            Some(json!([])),
            Some(json!([{"actorKey":"companion","values":{"speed":3}}])),
        ] {
            if let Some(entries) = entries {
                value["placements"][0]["overrides"] = entries;
            } else {
                value["placements"][0]
                    .as_object_mut()
                    .unwrap()
                    .remove("overrides");
            }
            let content = text(&value);
            let result = edit(
                &content,
                10,
                "leader",
                json!({}),
                json!(["speed", "position", "imageResourceId"]),
            );
            assert_eq!(result.after_content, content);
            assert!(result.changed_paths.is_empty());
            let result = edit(
                &content,
                10,
                "leader",
                json!({"speed":150}),
                json!(["imageResourceId"]),
            );
            assert_only_edit(
                &content,
                &result.after_content,
                10,
                "leader",
                json!({"speed":150}),
                &["imageResourceId"],
            );
        }
        value["placements"][1]["overrides"]
            .as_array_mut()
            .unwrap()
            .insert(0, json!({"actorKey":"companion","values":{"speed":1}}));
        value["placements"].as_array_mut().unwrap().reverse();
        let content = text(&value);
        let result = edit(
            &content,
            20,
            "leader",
            json!({"controls":"none"}),
            json!(["speed"]),
        );
        assert_eq!(
            result.changed_paths,
            ["speed", "controls"].map(|field| format!("/placements/0/overrides/1/values/{field}"))
        );
        assert_only_edit(
            &content,
            &result.after_content,
            20,
            "leader",
            json!({"controls":"none"}),
            &["speed"],
        );
        let again = edit(
            &result.after_content,
            20,
            "leader",
            json!({"controls":"none"}),
            json!(["speed"]),
        );
        assert_eq!(again.after_content, result.after_content);
        assert!(again.changed_paths.is_empty());
    }

    #[test]
    fn resetting_position_restores_local_coordinates_and_preserves_instance_mapping() {
        let content = text(&recipe());
        let result = edit(&content, 20, "leader", json!({}), json!(["position"]));
        let expanded = expand(&result.after_content).unwrap();
        assert_eq!(
            expanded.scene["actors"][2]["position"],
            json!([310.0, 100.0])
        );
        assert_eq!(expanded.scene["actors"][2]["instanceId"], id(21));
        assert_eq!(expanded.scene["actors"][2]["objectId"], id(1));
        assert_eq!(
            expanded.source_map["actors"][2]["fields"]["position"],
            json!(["/fragments/0/actors/0/position", "/placements/1/offset"])
        );
        let mut invalid_after = recipe();
        invalid_after["placements"][1]["offset"] = json!([99995, 80]);
        invalid_after["placements"][1]["overrides"][0]["values"]["position"] = json!([0, 40]);
        invalid_after["placements"][1]["overrides"]
            .as_array_mut()
            .unwrap()
            .push(json!({"actorKey":"companion","values":{"position":[0,0]}}));
        let content = text(&invalid_after);
        expand(&content).unwrap();
        assert_eq!(
            dispatch(&edit_request(
                &content,
                20,
                "leader",
                json!({"speed":90}),
                json!(["position"])
            ))
            .unwrap_err()
            .error_code,
            "scene_composition_invalid"
        );
    }

    #[test]
    fn resetting_an_explicit_null_image_restores_template_inheritance() {
        let mut value = recipe();
        value["fragments"][0]["actors"][1]["imageResourceId"] = json!(id(30));
        value["placements"][0]["overrides"] =
            json!([{"actorKey":"companion","values":{"imageResourceId":null}}]);
        let content = text(&value);
        assert_eq!(
            expand(&content).unwrap().scene["actors"][1]["imageResourceId"],
            Value::Null
        );
        let result = edit(
            &content,
            10,
            "companion",
            json!({}),
            json!(["imageResourceId"]),
        );
        assert_eq!(
            expand(&result.after_content).unwrap().scene["actors"][1]["imageResourceId"],
            id(30)
        );
        assert_only_edit(
            &content,
            &result.after_content,
            10,
            "companion",
            json!({}),
            &["imageResourceId"],
        );
        value["fragments"][0]["actors"][1]
            .as_object_mut()
            .unwrap()
            .remove("imageResourceId");
        let content = text(&value);
        let result = edit(
            &content,
            10,
            "companion",
            json!({}),
            json!(["imageResourceId"]),
        );
        assert!(expand(&result.after_content).unwrap().scene["actors"][1]
            .get("imageResourceId")
            .is_none());
    }

    #[test]
    fn mixed_edits_validate_only_the_final_candidate_and_enforce_both_byte_budgets() {
        let content = text(&recipe());
        let boundary = format!("{content}{}", " ".repeat(MAX_BYTES - content.len()));
        assert_eq!(
            dispatch(&request(
                &boundary,
                20,
                "leader",
                json!({"size":[2048,2048]})
            ))
            .unwrap_err()
            .error_code,
            "scene_composition_limit"
        );
        let result = edit(
            &boundary,
            20,
            "leader",
            json!({"size":[2048,2048]}),
            json!(["position", "speed"]),
        );
        assert!(result.after_content.len() < MAX_BYTES);
        assert_only_edit(
            &boundary,
            &result.after_content,
            20,
            "leader",
            json!({"size":[2048,2048]}),
            &["position", "speed"],
        );
        for broken in [
            boundary.clone() + " ",
            content.replace("\"speed\": 180", "\"speed\":180,\"spe\\u0065d\":180"),
            content.replace("\"speed\": 150", "\"speed\": 2001"),
        ] {
            assert!(dispatch(&edit_request(
                &broken,
                20,
                "leader",
                json!({}),
                json!(["speed"])
            ))
            .is_err());
        }
        assert_eq!(
            dispatch(&edit_request(
                &content,
                20,
                "leader",
                json!({"size":[40,48],"color":"bad"}),
                json!(["speed"])
            ))
            .unwrap_err()
            .error_code,
            "scene_composition_invalid"
        );
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

    fn positions_request(content: &str, changes: Value) -> Value {
        json!({"protocolVersion":1,"operation":"sceneComposition.patchPositions","content":content,"changes":changes})
    }
    fn position_change(placement: usize, actor: &str, position: Value) -> Value {
        json!({"placementId":id(placement),"actorKey":actor,"position":position})
    }

    #[test]
    fn positions_batch_has_an_independent_capability_and_strict_shape() {
        assert_eq!(crate::viento_core_scene_composition_positions_version(), 1);
        let content = text(&recipe());
        let valid = positions_request(
            &content,
            json!([position_change(10, "leader", json!([11, 21]))]),
        );
        for changes in [
            json!([]),
            json!([{}]),
            json!([position_change(99, "leader", json!([1, 2]))]),
            json!([position_change(10, "unknown", json!([1, 2]))]),
            json!([
                position_change(10, "leader", json!([1, 2])),
                position_change(10, "leader", json!([1, 2]))
            ]),
            Value::Array(vec![position_change(10, "leader", json!([1, 2])); 129]),
        ] {
            assert!(dispatch_positions(&positions_request(&content, changes)).is_err());
        }
        for bad in [
            json!(null),
            json!([1]),
            json!([1, 2, 3]),
            json!([100001, 0]),
            json!(["1", 2]),
        ] {
            assert!(dispatch_positions(&positions_request(
                &content,
                json!([position_change(10, "leader", bad)])
            ))
            .is_err());
        }
        let mut extra = valid.clone();
        extra["extra"] = json!(true);
        assert_eq!(
            dispatch_positions(&extra).unwrap_err().error_code,
            "studio_core_request_invalid"
        );
        let mut extra_target = valid.clone();
        extra_target["changes"][0]["speed"] = json!(1);
        assert!(dispatch_positions(&extra_target).is_err());
        assert!(dispatch_positions(&valid).is_ok());
    }

    #[test]
    fn positions_batch_combines_same_placement_insertions_in_source_order() {
        for empty in [false, true] {
            let mut value = recipe();
            if empty {
                value["placements"][0]["overrides"] = json!([]);
            }
            let content = text(&value);
            let result = dispatch_positions(&positions_request(
                &content,
                json!([
                    position_change(10, "companion", json!([52, 62])),
                    position_change(10, "leader", json!([12, 22])),
                    position_change(20, "companion", json!([54, 64])),
                    position_change(20, "leader", json!([34, 44]))
                ]),
            ))
            .unwrap();
            let after = parsed(&result.after_content);
            assert_eq!(
                after["placements"][0]["overrides"],
                json!([
                    {"actorKey":"leader","values":{"position":[12,22]}},
                    {"actorKey":"companion","values":{"position":[52,62]}}
                ])
            );
            assert_eq!(
                after["placements"][1]["overrides"][0]["values"]["speed"],
                json!(180)
            );
            assert_eq!(
                result.changed_paths,
                vec![
                    "/placements/0/overrides/0/values/position",
                    "/placements/0/overrides/1/values/position",
                    "/placements/1/overrides/0/values/position",
                    "/placements/1/overrides/1/values/position"
                ]
            );
            let mut expected = value.clone();
            expected["placements"] = after["placements"].clone();
            assert_eq!(after, expected);
            assert!(result.after_content.starts_with('\u{feff}'));
            assert!(result.after_content.ends_with("\r\n \t"));
            expand(&result.after_content).unwrap();
        }
    }

    #[test]
    fn positions_batch_preserves_numeric_tokens_and_unrelated_override_fields() {
        let content = source_with_values(
            "{\"speed\":1.800e2,\"posit\\u0069on\":[3.0e1,4.00e1],\"color\":\"#abcdef\"}",
        );
        let result = dispatch_positions(&positions_request(
            &content,
            json!([position_change(20, "leader", json!([31, 40]))]),
        ))
        .unwrap();
        assert_eq!(
            result.after_content,
            content.replace("[3.0e1,4.00e1]", "[31,4.00e1]")
        );
        let missing = source_with_values("{\"speed\":1.800e2}");
        let result = dispatch_positions(&positions_request(
            &missing,
            json!([position_change(20, "leader", json!([31, 40]))]),
        ))
        .unwrap();
        assert_eq!(
            result.after_content,
            missing.replace(
                "{\"speed\":1.800e2}",
                "{\"speed\":1.800e2,\"position\":[31,40]}"
            )
        );
    }

    #[test]
    fn positions_batch_noops_do_not_promote_inherited_positions() {
        let content = text(&recipe());
        let result = dispatch_positions(&positions_request(
            &content,
            json!([
                position_change(10, "leader", json!([10, 20])),
                position_change(10, "companion", json!([50, 60])),
                position_change(20, "leader", json!([30, 40]))
            ]),
        ))
        .unwrap();
        assert_eq!(result.after_content, content);
        assert!(result.changed_paths.is_empty());
    }

    #[test]
    fn positions_batch_validates_final_budget_instead_of_intermediate_growth() {
        let mut value = recipe();
        value["placements"][1]["overrides"] = json!([
            {"actorKey":"leader","values":{"position":[1,1],"speed":180}},
            {"actorKey":"companion","values":{"position":[9999,9999]}}
        ]);
        let raw = text(&value);
        let content = format!("{raw}{}", " ".repeat(MAX_BYTES - raw.len()));
        let result = dispatch_positions(&positions_request(
            &content,
            json!([
                position_change(20, "leader", json!([9999, 9999])),
                position_change(20, "companion", json!([1, 1]))
            ]),
        ))
        .unwrap();
        assert_eq!(result.after_content.len(), MAX_BYTES);
        assert_eq!(
            dispatch_positions(&positions_request(
                &content,
                json!([position_change(20, "leader", json!([9999, 9999]))])
            ))
            .unwrap_err()
            .error_code,
            "scene_composition_limit"
        );
    }

    #[test]
    fn positions_batch_rejects_invalid_final_world_and_malformed_source_atomically() {
        let content = text(&recipe());
        assert!(dispatch_positions(&positions_request(
            &content,
            json!([
                position_change(10, "leader", json!([11, 21])),
                position_change(20, "companion", json!([100000, 0]))
            ])
        ))
        .is_err());
        for bad in [
            content.replace(
                "\"schemaVersion\": 1",
                "\"schemaVersion\": 1,\"schemaVersion\": 1",
            ),
            content.replace("\"actorKey\": \"leader\"", "\"actorKey\": \"missing\""),
            "{bad".to_owned(),
        ] {
            assert!(dispatch_positions(&positions_request(
                &bad,
                json!([position_change(10, "leader", json!([11, 21]))])
            ))
            .is_err());
        }
        assert!(dispatch_positions(&positions_request(
            &content,
            json!([position_change(10, "leader", json!([11, 21]))])
        ))
        .is_ok());
    }
}
