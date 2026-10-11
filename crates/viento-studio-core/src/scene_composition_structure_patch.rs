//! Atomic shared actor insertion/removal with explicit per-placement identities.
#![forbid(unsafe_code)]

use crate::scene_composition::expand;
use crate::scene_composition_patch::{
    append_item, apply_edits, colon, member, remove_items, Edit, SceneCompositionPatchResponse,
};
use crate::scene_source::{parse_json_source, Node};
use crate::CoreError;
use serde_json::Value;
use std::collections::HashSet;

fn invalid() -> CoreError {
    CoreError {
        error_code: "scene_composition_invalid",
        message: "Expected one shared actor structure edit with explicit placement identities.",
    }
}
fn uuid(value: &Value) -> Option<&str> {
    let value = value.as_str()?;
    (value.len() == 36
        && value.bytes().enumerate().all(|(index, byte)| {
            if [8, 13, 18, 23].contains(&index) {
                byte == b'-'
            } else {
                byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte)
            }
        }))
    .then_some(value)
}
fn remove_array_item(node: &Node, index: usize) -> Result<Vec<Edit>, CoreError> {
    let nodes = node.array().map_err(|_| invalid())?;
    let spans = nodes
        .iter()
        .map(|node| node.span.clone())
        .collect::<Vec<_>>();
    Ok(remove_items(
        &spans,
        &(0..nodes.len())
            .map(|current| current == index)
            .collect::<Vec<_>>(),
    ))
}
fn remove_member(node: &Node, name: &str) -> Result<Vec<Edit>, CoreError> {
    let members = node.object().map_err(|_| invalid())?;
    let spans = members
        .iter()
        .map(|(_, node)| node.member_span.clone().ok_or_else(invalid))
        .collect::<Result<Vec<_>, _>>()?;
    Ok(remove_items(
        &spans,
        &members
            .iter()
            .map(|(key, _)| key.iter().copied().eq(name.encode_utf16()))
            .collect::<Vec<_>>(),
    ))
}

pub(crate) fn dispatch(request: &Value) -> Result<SceneCompositionPatchResponse, CoreError> {
    let request = request.as_object().ok_or_else(CoreError::request)?;
    let adding = match request.get("operation").and_then(Value::as_str) {
        Some("sceneComposition.addFragmentActor") => true,
        Some("sceneComposition.removeFragmentActor") => false,
        _ => return Err(CoreError::request()),
    };
    let mut fields = vec!["protocolVersion", "operation", "content", "fragmentId"];
    fields.extend(if adding {
        vec!["actor", "instances"]
    } else {
        vec!["actorKey"]
    });
    if request.len() != fields.len() || fields.iter().any(|field| !request.contains_key(*field)) {
        return Err(CoreError::request());
    }
    let content = request["content"].as_str().ok_or_else(CoreError::request)?;
    expand(content)?;
    let source: Value = serde_json::from_str(content.strip_prefix('\u{feff}').unwrap_or(content))
        .map_err(|_| invalid())?;
    let fragments = source["fragments"].as_array().ok_or_else(invalid)?;
    let fragment_id = request["fragmentId"].as_str().ok_or_else(invalid)?;
    let (fragment_index, fragment) = fragments
        .iter()
        .enumerate()
        .find(|(_, fragment)| fragment["fragmentId"].as_str() == Some(fragment_id))
        .ok_or_else(invalid)?;
    let actors = fragment["actors"].as_array().ok_or_else(invalid)?;
    let placements = source["placements"].as_array().ok_or_else(invalid)?;
    let related = placements
        .iter()
        .enumerate()
        .filter(|(_, placement)| placement["fragmentId"].as_str() == Some(fragment_id))
        .collect::<Vec<_>>();
    let root = parse_json_source(content).map_err(|_| invalid())?;
    let fragment_nodes = member(&root, "fragments")?.array().map_err(|_| invalid())?;
    let actor_node = member(&fragment_nodes[fragment_index], "actors")?;
    let placement_nodes = member(&root, "placements")?
        .array()
        .map_err(|_| invalid())?;
    let mut edits = Vec::new();
    let mut changed_paths = Vec::new();
    if adding {
        let actor = request["actor"].as_object().ok_or_else(invalid)?;
        let actor_key = actor
            .get("key")
            .and_then(Value::as_str)
            .ok_or_else(invalid)?;
        if actors
            .iter()
            .any(|actor| actor["key"].as_str() == Some(actor_key))
        {
            return Err(invalid());
        }
        let instances = request["instances"].as_array().ok_or_else(invalid)?;
        if instances.len() != related.len() {
            return Err(invalid());
        }
        let mut identities = HashSet::new();
        for placement in placements {
            identities.insert(placement["placementId"].as_str().ok_or_else(invalid)?);
            for field in ["actorIds", "groupIds"] {
                for identity in placement[field].as_object().ok_or_else(invalid)?.values() {
                    identities.insert(identity.as_str().ok_or_else(invalid)?);
                }
            }
        }
        edits.push(append_item(
            content,
            actor_node,
            serde_json::to_string(actor).map_err(|_| invalid())?,
        )?);
        changed_paths.push(format!(
            "/fragments/{fragment_index}/actors/{}",
            actors.len()
        ));
        for ((placement_index, placement), instance) in related.iter().zip(instances) {
            let instance = instance.as_object().ok_or_else(invalid)?;
            if instance.len() != 2
                || !instance.contains_key("placementId")
                || !instance.contains_key("instanceId")
                || instance["placementId"] != placement["placementId"]
            {
                return Err(invalid());
            }
            let instance_id = uuid(&instance["instanceId"]).ok_or_else(invalid)?;
            if !identities.insert(instance_id) {
                return Err(invalid());
            }
            let identities_node = member(&placement_nodes[*placement_index], "actorIds")?;
            let delimiter = colon(content, identities_node)?;
            edits.push(append_item(
                content,
                identities_node,
                format!(
                    "{}{delimiter}{}",
                    serde_json::to_string(actor_key).map_err(|_| invalid())?,
                    serde_json::to_string(instance_id).map_err(|_| invalid())?
                ),
            )?);
            changed_paths.push(format!(
                "/placements/{placement_index}/actorIds/{actor_key}"
            ));
        }
    } else {
        let actor_key = request["actorKey"].as_str().ok_or_else(invalid)?;
        let actor_index = actors
            .iter()
            .position(|actor| actor["key"].as_str() == Some(actor_key))
            .ok_or_else(invalid)?;
        if actors.len() <= 1 {
            return Err(invalid());
        }
        edits.extend(remove_array_item(actor_node, actor_index)?);
        changed_paths.push(format!("/fragments/{fragment_index}/actors/{actor_index}"));
        for (placement_index, placement) in related {
            edits.extend(remove_member(
                member(&placement_nodes[placement_index], "actorIds")?,
                actor_key,
            )?);
            changed_paths.push(format!(
                "/placements/{placement_index}/actorIds/{actor_key}"
            ));
            if let Some(overrides) = placement.get("overrides").and_then(Value::as_array) {
                if let Some(index) = overrides
                    .iter()
                    .position(|item| item["actorKey"].as_str() == Some(actor_key))
                {
                    edits.extend(remove_array_item(
                        member(&placement_nodes[placement_index], "overrides")?,
                        index,
                    )?);
                    changed_paths.push(format!("/placements/{placement_index}/overrides/{index}"));
                }
            }
        }
    }
    Ok(SceneCompositionPatchResponse {
        after_content: apply_edits(content, edits)?,
        changed_paths,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    fn id(n: usize) -> String {
        format!("00000000-0000-0000-0000-{n:012x}")
    }
    fn recipe() -> Value {
        json!({"format":"viento-scene-composition","schemaVersion":1,
          "scene":{"title":"Structure","viewport":[640,480],"background":"#112233"},
          "fragments":[{"fragmentId":"pair","groups":[{"key":"cast","name":"Cast"}],"actors":[
            {"key":"lead","objectId":id(1),"position":[10,20],"size":[32,48],"color":"#ffffff","speed":150,"controls":"arrows","groupKey":"cast"},
            {"key":"support","objectId":id(2),"position":[30,40],"useProjectionDefaults":true}]}],
          "placements":[{"placementId":id(10),"fragmentId":"pair","actorIds":{"lead":id(11),"support":id(12)},"groupIds":{"cast":id(13)},"offset":[100,0],
            "overrides":[{"actorKey":"lead","values":{"speed":120,"position":[1,2]}},{"actorKey":"support","values":{"color":"#abcdef"}}]},
            {"placementId":id(20),"fragmentId":"pair","actorIds":{"lead":id(21),"support":id(22)},"groupIds":{"cast":id(23)},"overrides":[]}]})
    }
    fn text(v: &Value) -> String {
        format!(
            "\u{feff}{}\r\n",
            serde_json::to_string_pretty(v)
                .unwrap()
                .replace('\n', "\r\n")
        )
    }
    fn add(source: &str) -> Value {
        json!({"protocolVersion":1,"operation":"sceneComposition.addFragmentActor","content":source,"fragmentId":"pair",
        "actor":{"key":"new","objectId":id(1),"position":[12.5,-3.75],"useProjectionDefaults":true,"groupKey":"cast"},
        "instances":[{"placementId":id(10),"instanceId":id(30)},{"placementId":id(20),"instanceId":id(31)}]})
    }
    fn remove(source: &str, key: &str) -> Value {
        json!({"protocolVersion":1,"operation":"sceneComposition.removeFragmentActor","content":source,"fragmentId":"pair","actorKey":key})
    }
    #[test]
    fn adds_one_actor_and_all_explicit_identities_atomically() {
        let source = text(&recipe());
        let result = dispatch(&add(&source)).unwrap();
        let expanded = expand(&result.after_content).unwrap();
        assert_eq!(expanded.scene["actors"].as_array().unwrap().len(), 6);
        assert_eq!(expanded.scene["actors"][2]["instanceId"], id(30));
        assert_eq!(
            expanded.scene["actors"][2]["position"],
            json!([112.5, -3.75])
        );
        assert_eq!(expanded.scene["actors"][5]["instanceId"], id(31));
        assert_eq!(
            result.changed_paths,
            vec![
                "/fragments/0/actors/2",
                "/placements/0/actorIds/new",
                "/placements/1/actorIds/new"
            ]
        );
        assert!(result.after_content.starts_with('\u{feff}'));
        assert!(result.after_content.ends_with("\r\n"));
        let before: Value = recipe();
        let after: Value =
            serde_json::from_str(result.after_content.trim_start_matches('\u{feff}')).unwrap();
        assert_eq!(
            before["placements"][0]["overrides"],
            after["placements"][0]["overrides"]
        );
        assert_eq!(
            before["fragments"][0]["groups"],
            after["fragments"][0]["groups"]
        );
    }
    #[test]
    fn removes_all_ids_and_only_matching_overrides_keeps_empty_arrays() {
        let result = dispatch(&remove(&text(&recipe()), "lead")).unwrap();
        let value: Value =
            serde_json::from_str(result.after_content.trim_start_matches('\u{feff}')).unwrap();
        assert_eq!(value["fragments"][0]["actors"].as_array().unwrap().len(), 1);
        assert_eq!(
            value["placements"][0]["overrides"]
                .as_array()
                .unwrap()
                .len(),
            1
        );
        assert_eq!(
            value["placements"][0]["overrides"][0]["actorKey"],
            "support"
        );
        assert_eq!(value["placements"][1]["overrides"], json!([]));
        assert_eq!(
            result.changed_paths,
            vec![
                "/fragments/0/actors/0",
                "/placements/0/actorIds/lead",
                "/placements/0/overrides/0",
                "/placements/1/actorIds/lead"
            ]
        );
    }
    #[test]
    fn sole_matching_override_becomes_empty_without_deleting_container() {
        let mut value = recipe();
        value["placements"][0]["overrides"]
            .as_array_mut()
            .unwrap()
            .remove(1);
        let result = dispatch(&remove(&text(&value), "lead")).unwrap();
        let value: Value =
            serde_json::from_str(result.after_content.trim_start_matches('\u{feff}')).unwrap();
        assert_eq!(value["placements"][0]["overrides"], json!([]));
    }
    #[test]
    fn exact_related_order_and_unique_generated_and_placement_identity_required() {
        for change in 0..7 {
            let mut request = add(&text(&recipe()));
            match change {
                0 => {
                    request["instances"].as_array_mut().unwrap().pop();
                }
                1 => request["instances"].as_array_mut().unwrap().reverse(),
                2 => request["instances"][0]["instanceId"] = json!(id(11)),
                3 => request["instances"][0]["instanceId"] = json!(id(13)),
                4 => request["instances"][0]["instanceId"] = json!(id(10)),
                5 => request["instances"][1]["instanceId"] = json!(id(30)),
                _ => request["instances"][0]["extra"] = json!(true),
            };
            assert!(dispatch(&request).is_err());
        }
    }
    #[test]
    fn rejects_duplicate_keys_invalid_new_declaration_group_and_last_actor() {
        for change in 0..5 {
            let mut request = add(&text(&recipe()));
            match change {
                0 => request["actor"]["key"] = json!("lead"),
                1 => request["actor"]["groupKey"] = json!("foreign"),
                2 => request["actor"]["position"] = json!([1]),
                3 => request["actor"]["extra"] = json!(true),
                _ => request["actor"]["useProjectionDefaults"] = json!(false),
            };
            assert!(dispatch(&request).is_err());
        }
        let first = dispatch(&remove(&text(&recipe()), "lead")).unwrap();
        assert!(dispatch(&remove(&first.after_content, "support")).is_err());
        assert!(dispatch(&remove(&text(&recipe()), "missing")).is_err());
    }
    #[test]
    fn unused_fragment_can_add_without_ids_but_cannot_remove_last_actor() {
        let mut value = recipe();
        value["fragments"].as_array_mut().unwrap().push(json!({"fragmentId":"unused","actors":[{"key":"only","objectId":id(1),"position":[0,0],"useProjectionDefaults":true}],"groups":[]}));
        let source = text(&value);
        let mut request = add(&source);
        request["fragmentId"] = json!("unused");
        request["actor"].as_object_mut().unwrap().remove("groupKey");
        request["instances"] = json!([]);
        let result = dispatch(&request).unwrap();
        assert_eq!(result.changed_paths, vec!["/fragments/1/actors/1"]);
        let mut request = remove(&source, "only");
        request["fragmentId"] = json!("unused");
        assert!(dispatch(&request).is_err());
    }
    #[test]
    fn preserves_extreme_unchanged_number_spellings_escaped_keys_and_all_other_tokens() {
        let source = text(&recipe())
            .replacen("\"lead\"", "\"l\\u0065ad\"", 1)
            .replace("150", "1.500e+2")
            .replace("120", "1.2e2");
        let added = dispatch(&add(&source)).unwrap();
        assert!(added.after_content.contains("\"l\\u0065ad\""));
        assert!(added.after_content.contains("1.500e+2"));
        assert!(added.after_content.contains("1.2e2"));
        let mut value = recipe();
        value["placements"][0]
            .as_object_mut()
            .unwrap()
            .remove("overrides");
        let source = text(&value).replace("\"lead\":", "\"l\\u0065ad\":");
        assert!(dispatch(&remove(&source, "lead")).is_ok());
    }
    #[test]
    fn full_final_expansion_checks_offsets_declared_expanded_and_bytes_budgets() {
        let mut request = add(&text(&recipe()));
        request["actor"]["position"] = json!([99950, 0]);
        assert!(dispatch(&request).is_err());
        let mut value = recipe();
        for n in 2..64 {
            let mut p = value["placements"][1].clone();
            p["placementId"] = json!(id(100 + n * 4));
            p["actorIds"]["lead"] = json!(id(101 + n * 4));
            p["actorIds"]["support"] = json!(id(102 + n * 4));
            p["groupIds"]["cast"] = json!(id(103 + n * 4));
            value["placements"].as_array_mut().unwrap().push(p);
        }
        let mut request = add(&text(&value));
        request["instances"] = Value::Array(
            value["placements"]
                .as_array()
                .unwrap()
                .iter()
                .enumerate()
                .map(|(n, p)| json!({"placementId":p["placementId"],"instanceId":id(1000+n)}))
                .collect(),
        );
        assert_eq!(
            dispatch(&request).unwrap_err().error_code,
            "scene_composition_limit"
        );
        let mut source = text(&recipe());
        let padding = 128 * 1024 - source.len();
        source.insert_str('\u{feff}'.len_utf8(), &" ".repeat(padding));
        assert!(expand(&source).is_ok());
        assert_eq!(
            dispatch(&add(&source)).unwrap_err().error_code,
            "scene_composition_limit"
        );
    }
    #[test]
    fn rejects_wrong_request_shapes_and_invalid_original_source_before_patch() {
        let mut request = add(&text(&recipe()));
        request["extra"] = json!(true);
        assert_eq!(
            dispatch(&request).unwrap_err().error_code,
            "studio_core_request_invalid"
        );
        let mut request = remove(&text(&recipe()), "lead");
        request["actor"] = json!({});
        assert_eq!(
            dispatch(&request).unwrap_err().error_code,
            "studio_core_request_invalid"
        );
        let mut value = recipe();
        value["placements"][0]["actorIds"]["extra"] = json!(id(40));
        assert!(dispatch(&remove(&text(&value), "lead")).is_err());
    }
}
