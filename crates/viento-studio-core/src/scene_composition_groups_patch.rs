//! Source-owned organizational groups. No transforms or implicit promotion.
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
    CoreError { error_code: "scene_composition_invalid", message: "Expected one exact shared group edit with complete fresh identities and valid organizational references." }
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
fn encoded(value: &Value) -> Result<String, CoreError> {
    serde_json::to_string(value).map_err(|_| invalid())
}
fn delete_member(node: &Node, name: &str) -> Result<Vec<Edit>, CoreError> {
    let entries = node.object().map_err(|_| invalid())?;
    let spans = entries
        .iter()
        .map(|(_, value)| value.member_span.clone().ok_or_else(invalid))
        .collect::<Result<Vec<_>, _>>()?;
    let removed = entries
        .iter()
        .map(|(key, _)| key.iter().copied().eq(name.encode_utf16()))
        .collect::<Vec<_>>();
    Ok(remove_items(&spans, &removed))
}
fn set_member(
    content: &str,
    node: &Node,
    name: &str,
    value: &Value,
    edits: &mut Vec<Edit>,
) -> Result<(), CoreError> {
    if let Some(node) = node.get(name) {
        edits.push(Edit {
            span: node.span.clone(),
            text: encoded(value)?,
        });
    } else {
        edits.push(append_item(
            content,
            node,
            format!(
                "{}{delimiter}{}",
                encoded(&Value::String(name.to_owned()))?,
                encoded(value)?,
                delimiter = colon(content, node)?
            ),
        )?);
    }
    Ok(())
}
pub(crate) fn dispatch(request: &Value) -> Result<SceneCompositionPatchResponse, CoreError> {
    let request = request.as_object().ok_or_else(CoreError::request)?;
    let operation = request
        .get("operation")
        .and_then(Value::as_str)
        .ok_or_else(CoreError::request)?;
    let mut fields = vec!["protocolVersion", "operation", "content", "fragmentId"];
    fields.extend(match operation {
        "sceneComposition.addFragmentGroup" => vec!["group", "instances"],
        "sceneComposition.editFragmentGroup" => vec!["groupKey", "name", "parentKey"],
        "sceneComposition.assignFragmentActorGroup" => vec!["actorKey", "groupKey"],
        "sceneComposition.removeFragmentGroup" => vec!["groupKey"],
        _ => return Err(CoreError::request()),
    });
    if request.len() != fields.len() || fields.iter().any(|field| !request.contains_key(*field)) {
        return Err(CoreError::request());
    }
    let content = request["content"].as_str().ok_or_else(CoreError::request)?;
    expand(content)?;
    let source: Value = serde_json::from_str(content.strip_prefix('\u{feff}').unwrap_or(content))
        .map_err(|_| invalid())?;
    let fragment_id = request["fragmentId"].as_str().ok_or_else(invalid)?;
    let (fragment_index, fragment) = source["fragments"]
        .as_array()
        .ok_or_else(invalid)?
        .iter()
        .enumerate()
        .find(|(_, fragment)| fragment["fragmentId"].as_str() == Some(fragment_id))
        .ok_or_else(invalid)?;
    let groups = fragment["groups"].as_array().ok_or_else(invalid)?;
    let actors = fragment["actors"].as_array().ok_or_else(invalid)?;
    let placements = source["placements"].as_array().ok_or_else(invalid)?;
    let related = placements
        .iter()
        .enumerate()
        .filter(|(_, placement)| placement["fragmentId"].as_str() == Some(fragment_id))
        .collect::<Vec<_>>();
    let root = parse_json_source(content).map_err(|_| invalid())?;
    let fragment_node =
        &member(&root, "fragments")?.array().map_err(|_| invalid())?[fragment_index];
    let group_nodes = member(fragment_node, "groups")?
        .array()
        .map_err(|_| invalid())?;
    let placement_nodes = member(&root, "placements")?
        .array()
        .map_err(|_| invalid())?;
    let mut edits = Vec::new();
    let mut changed_paths = Vec::new();
    match operation {
        "sceneComposition.addFragmentGroup" => {
            let group = request["group"].as_object().ok_or_else(invalid)?;
            if !group.contains_key("key")
                || !group.contains_key("name")
                || group
                    .keys()
                    .any(|key| !["key", "name", "parentKey"].contains(&key.as_str()))
            {
                return Err(invalid());
            }
            let group_key = group["key"].as_str().ok_or_else(invalid)?;
            if groups
                .iter()
                .any(|group| group["key"].as_str() == Some(group_key))
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
                for name in ["actorIds", "groupIds"] {
                    for identity in placement[name].as_object().ok_or_else(invalid)?.values() {
                        identities.insert(identity.as_str().ok_or_else(invalid)?);
                    }
                }
            }
            edits.push(append_item(
                content,
                member(fragment_node, "groups")?,
                encoded(&request["group"])?,
            )?);
            changed_paths.push(format!(
                "/fragments/{fragment_index}/groups/{}",
                groups.len()
            ));
            for ((placement_index, placement), instance) in related.iter().zip(instances) {
                let instance = instance.as_object().ok_or_else(invalid)?;
                if instance.len() != 2
                    || !instance.contains_key("placementId")
                    || !instance.contains_key("groupId")
                    || instance["placementId"] != placement["placementId"]
                {
                    return Err(invalid());
                }
                let group_id = uuid(&instance["groupId"]).ok_or_else(invalid)?;
                if !identities.insert(group_id) {
                    return Err(invalid());
                }
                let node = member(&placement_nodes[*placement_index], "groupIds")?;
                edits.push(append_item(
                    content,
                    node,
                    format!(
                        "{}{delimiter}{}",
                        encoded(&group["key"])?,
                        encoded(&instance["groupId"])?,
                        delimiter = colon(content, node)?
                    ),
                )?);
                changed_paths.push(format!(
                    "/placements/{placement_index}/groupIds/{group_key}"
                ));
            }
        }
        "sceneComposition.editFragmentGroup" => {
            let group_key = request["groupKey"].as_str().ok_or_else(invalid)?;
            let (index, group) = groups
                .iter()
                .enumerate()
                .find(|(_, group)| group["key"].as_str() == Some(group_key))
                .ok_or_else(invalid)?;
            let name = &request["name"];
            let parent = &request["parentKey"];
            if !name.is_string() || !(parent.is_null() || parent.is_string()) {
                return Err(invalid());
            }
            if group["name"] != *name {
                set_member(content, &group_nodes[index], "name", name, &mut edits)?;
                changed_paths.push(format!("/fragments/{fragment_index}/groups/{index}/name"));
            }
            if parent.is_null() {
                if group.get("parentKey").is_some() {
                    edits.extend(delete_member(&group_nodes[index], "parentKey")?);
                    changed_paths.push(format!(
                        "/fragments/{fragment_index}/groups/{index}/parentKey"
                    ));
                }
            } else if group.get("parentKey") != Some(parent) {
                set_member(
                    content,
                    &group_nodes[index],
                    "parentKey",
                    parent,
                    &mut edits,
                )?;
                changed_paths.push(format!(
                    "/fragments/{fragment_index}/groups/{index}/parentKey"
                ));
            }
        }
        "sceneComposition.assignFragmentActorGroup" => {
            let actor_key = request["actorKey"].as_str().ok_or_else(invalid)?;
            let (index, actor) = actors
                .iter()
                .enumerate()
                .find(|(_, actor)| actor["key"].as_str() == Some(actor_key))
                .ok_or_else(invalid)?;
            let group = &request["groupKey"];
            if !(group.is_null() || group.is_string()) {
                return Err(invalid());
            }
            let node = &member(fragment_node, "actors")?
                .array()
                .map_err(|_| invalid())?[index];
            if group.is_null() {
                if actor.get("groupKey").is_some() {
                    edits.extend(delete_member(node, "groupKey")?);
                    changed_paths.push(format!(
                        "/fragments/{fragment_index}/actors/{index}/groupKey"
                    ));
                }
            } else if actor.get("groupKey") != Some(group) {
                set_member(content, node, "groupKey", group, &mut edits)?;
                changed_paths.push(format!(
                    "/fragments/{fragment_index}/actors/{index}/groupKey"
                ));
            }
        }
        "sceneComposition.removeFragmentGroup" => {
            let group_key = request["groupKey"].as_str().ok_or_else(invalid)?;
            let index = groups
                .iter()
                .position(|group| group["key"].as_str() == Some(group_key))
                .ok_or_else(invalid)?;
            if actors
                .iter()
                .any(|actor| actor.get("groupKey").and_then(Value::as_str) == Some(group_key))
                || groups
                    .iter()
                    .any(|group| group.get("parentKey").and_then(Value::as_str) == Some(group_key))
            {
                return Err(invalid());
            }
            let spans = group_nodes
                .iter()
                .map(|node| node.span.clone())
                .collect::<Vec<_>>();
            edits.extend(remove_items(
                &spans,
                &(0..groups.len()).map(|i| i == index).collect::<Vec<_>>(),
            ));
            changed_paths.push(format!("/fragments/{fragment_index}/groups/{index}"));
            for (placement_index, _) in related {
                edits.extend(delete_member(
                    member(&placement_nodes[placement_index], "groupIds")?,
                    group_key,
                )?);
                changed_paths.push(format!(
                    "/placements/{placement_index}/groupIds/{group_key}"
                ));
            }
        }
        _ => return Err(CoreError::request()),
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
        format!("{n:08x}-1111-4111-8111-111111111111")
    }
    fn recipe() -> Value {
        json!({"format":"viento-scene-composition","schemaVersion":1,"scene":{"title":"Groups / 组 / 組🦊","viewport":[800,480],"background":"#112233"},
         "fragments":[{"fragmentId":"pair","groups":[{"key":"root","name":"Root"},{"key":"sub","name":"Sub","parentKey":"root"}],
         "actors":[{"key":"lead","objectId":id(1),"position":[10.125,20.25],"groupKey":"root","useProjectionDefaults":true},{"key":"support","objectId":id(1),"position":[30.5,40.75],"groupKey":"sub","useProjectionDefaults":true}]},
         {"fragmentId":"unused","groups":[],"actors":[{"key":"dormant","objectId":id(1),"position":[0,0],"useProjectionDefaults":true}]}],
         "placements":[{"placementId":id(10),"fragmentId":"pair","actorIds":{"lead":id(11),"support":id(12)},"groupIds":{"root":id(13),"sub":id(14)},"overrides":[]},
         {"placementId":id(20),"fragmentId":"pair","actorIds":{"lead":id(21),"support":id(22)},"groupIds":{"root":id(23),"sub":id(24)},"offset":[300,80],"overrides":[{"actorKey":"lead","values":{"position":[111,222],"imageResourceId":null,"controls":"none","speed":18.25,"color":"#abcdef","size":[32,48]}}]}]})
    }
    fn text(source: &Value) -> String {
        format!(
            "\u{feff}{}\r\n \t",
            serde_json::to_string_pretty(source)
                .unwrap()
                .replace('\n', "\r\n")
        )
    }
    fn parsed(content: &str) -> Value {
        serde_json::from_str(content.trim_start_matches('\u{feff}')).unwrap()
    }
    fn request(operation: &str, source: &Value, fields: Value) -> Value {
        let mut request = json!({"protocolVersion":1,"operation":format!("sceneComposition.{operation}"),"content":text(source),"fragmentId":"pair"});
        request
            .as_object_mut()
            .unwrap()
            .extend(fields.as_object().unwrap().clone());
        request
    }
    fn add(source: &Value) -> Value {
        request(
            "addFragmentGroup",
            source,
            json!({"group":{"key":"extra","name":"Extra / 組","parentKey":"sub"},"instances":[{"placementId":id(10),"groupId":id(901)},{"placementId":id(20),"groupId":id(902)}]}),
        )
    }
    fn edit(source: &Value, key: &str, name: &str, parent: Value) -> Value {
        request(
            "editFragmentGroup",
            source,
            json!({"groupKey":key,"name":name,"parentKey":parent}),
        )
    }
    fn assign(source: &Value, key: &str, group: Value) -> Value {
        request(
            "assignFragmentActorGroup",
            source,
            json!({"actorKey":key,"groupKey":group}),
        )
    }
    fn remove(source: &Value, key: &str) -> Value {
        request("removeFragmentGroup", source, json!({"groupKey":key}))
    }
    #[test]
    fn add_complete_ordered_ids_and_hierarchy_without_actor_or_coordinate_changes() {
        let before = recipe();
        let response = dispatch(&add(&before)).unwrap();
        let mut expected = before.clone();
        expected["fragments"][0]["groups"]
            .as_array_mut()
            .unwrap()
            .push(json!({"key":"extra","name":"Extra / 組","parentKey":"sub"}));
        for (index, placement) in expected["placements"]
            .as_array_mut()
            .unwrap()
            .iter_mut()
            .enumerate()
        {
            placement["groupIds"]["extra"] = json!(id(901 + index));
        }
        assert_eq!(parsed(&response.after_content), expected);
        assert_eq!(
            response.changed_paths,
            vec![
                "/fragments/0/groups/2",
                "/placements/0/groupIds/extra",
                "/placements/1/groupIds/extra"
            ]
        );
        let after = expand(&response.after_content).unwrap();
        assert_eq!(
            after.scene["actors"],
            expand(&text(&before)).unwrap().scene["actors"]
        );
        assert_eq!(after.scene["groups"][2]["parentGroupId"], json!(id(14)));
    }
    #[test]
    fn edit_name_and_parent_is_atomic_and_preserves_stable_key_and_maps() {
        let before = recipe();
        let response = dispatch(&edit(&before, "sub", "Renamed / 組🦊", Value::Null)).unwrap();
        let mut expected = before.clone();
        expected["fragments"][0]["groups"][1]["name"] = json!("Renamed / 組🦊");
        expected["fragments"][0]["groups"][1]
            .as_object_mut()
            .unwrap()
            .remove("parentKey");
        assert_eq!(parsed(&response.after_content), expected);
        assert_eq!(
            response.changed_paths,
            vec![
                "/fragments/0/groups/1/name",
                "/fragments/0/groups/1/parentKey"
            ]
        );
        assert_eq!(
            expand(&response.after_content).unwrap().scene["actors"],
            expand(&text(&before)).unwrap().scene["actors"]
        );
    }
    #[test]
    fn assign_set_reset_only_actor_membership_across_every_placement() {
        let before = recipe();
        let response = dispatch(&assign(&before, "support", json!("root"))).unwrap();
        let mut expected = before.clone();
        expected["fragments"][0]["actors"][1]["groupKey"] = json!("root");
        assert_eq!(parsed(&response.after_content), expected);
        let after = expand(&response.after_content).unwrap();
        assert_eq!(after.scene["actors"][1]["groupId"], json!(id(13)));
        assert_eq!(after.scene["actors"][3]["groupId"], json!(id(23)));
        let reset = dispatch(&assign(&expected, "support", Value::Null)).unwrap();
        assert!(parsed(&reset.after_content)["fragments"][0]["actors"][1]
            .get("groupKey")
            .is_none());
        assert_eq!(reset.changed_paths, vec!["/fragments/0/actors/1/groupKey"]);
    }
    #[test]
    fn same_semantic_name_parent_and_absent_membership_are_exact_byte_noops() {
        let source = recipe();
        let content = text(&source)
            .replace("Root", "\\u0052oot")
            .replace("300,", "3.00e2,");
        let mut rename = edit(&source, "root", "Root", Value::Null);
        rename["content"] = json!(content.clone());
        let response = dispatch(&rename).unwrap();
        assert_eq!(response.after_content, content);
        assert!(response.changed_paths.is_empty());
        let mut cleared = source.clone();
        cleared["fragments"][0]["actors"][0]
            .as_object_mut()
            .unwrap()
            .remove("groupKey");
        for request in [
            assign(&cleared, "lead", Value::Null),
            assign(&source, "support", json!("sub")),
            edit(&source, "sub", "Sub", json!("root")),
        ] {
            let response = dispatch(&request).unwrap();
            assert_eq!(response.after_content, request["content"].as_str().unwrap());
            assert!(response.changed_paths.is_empty());
        }
    }
    #[test]
    fn remove_empty_leaf_and_last_group_keeps_containers_and_other_bytes() {
        let source = recipe();
        let added = parsed(&dispatch(&add(&source)).unwrap().after_content);
        let response = dispatch(&remove(&added, "extra")).unwrap();
        assert_eq!(parsed(&response.after_content), source);
        assert_eq!(
            response.changed_paths,
            vec![
                "/fragments/0/groups/2",
                "/placements/0/groupIds/extra",
                "/placements/1/groupIds/extra"
            ]
        );
        let mut cleared = source.clone();
        for actor in cleared["fragments"][0]["actors"].as_array_mut().unwrap() {
            actor.as_object_mut().unwrap().remove("groupKey");
        }
        cleared = parsed(&dispatch(&remove(&cleared, "sub")).unwrap().after_content);
        let response = dispatch(&remove(&cleared, "root")).unwrap();
        let result = parsed(&response.after_content);
        assert_eq!(result["fragments"][0]["groups"], json!([]));
        for placement in result["placements"].as_array().unwrap() {
            assert_eq!(placement["groupIds"], json!({}));
        }
    }
    #[test]
    fn remove_requires_raw_empty_leaf_even_for_unused_fragment() {
        let source = recipe();
        for group in ["root", "sub"] {
            assert_eq!(
                dispatch(&remove(&source, group)).unwrap_err().error_code,
                "scene_composition_invalid"
            );
        }
        let mut source = source;
        source["fragments"][1]["groups"] =
            json!([{"key":"a","name":"A"},{"key":"b","name":"B","parentKey":"a"}]);
        let mut request = remove(&source, "a");
        request["fragmentId"] = json!("unused");
        assert!(dispatch(&request).is_err());
        source["fragments"][1]["actors"][0]["groupKey"] = json!("b");
        let mut request = remove(&source, "b");
        request["fragmentId"] = json!("unused");
        request["content"] = json!(text(&source));
        assert!(dispatch(&request).is_err());
    }
    #[test]
    fn unused_fragment_can_add_assign_edit_reset_remove_without_generated_ids() {
        let source = recipe();
        let mut request = add(&source);
        request["fragmentId"] = json!("unused");
        request["group"] = json!({"key":"extra","name":"Extra"});
        request["instances"] = json!([]);
        let result = dispatch(&request).unwrap();
        assert_eq!(result.changed_paths, vec!["/fragments/1/groups/0"]);
        let after = expand(&result.after_content).unwrap();
        assert_eq!(after.scene, expand(&text(&source)).unwrap().scene);
    }
    #[test]
    fn group_ids_are_exact_related_source_order_and_globally_fresh() {
        let source = recipe();
        for count in [0, 1, 3] {
            let mut request = add(&source);
            request["instances"] = json!((0..count)
                .map(|i| json!({"placementId":id(10+i*10),"groupId":id(901+i)}))
                .collect::<Vec<_>>());
            assert!(dispatch(&request).is_err());
        }
        for collision in [id(10), id(11), id(24), id(902)] {
            let mut request = add(&source);
            request["instances"][0]["groupId"] = json!(collision);
            assert!(dispatch(&request).is_err());
        }
        let mut request = add(&source);
        request["instances"].as_array_mut().unwrap().reverse();
        assert!(dispatch(&request).is_err());
        let mut request = add(&source);
        request["instances"][0]["extra"] = json!(true);
        assert!(dispatch(&request).is_err());
    }
    #[test]
    fn cycle_unknown_reference_and_sixteen_level_hierarchy_are_fully_validated() {
        let source = recipe();
        assert!(dispatch(&edit(&source, "root", "Root", json!("sub"))).is_err());
        assert!(dispatch(&edit(&source, "sub", "Sub", json!("sub"))).is_err());
        assert!(dispatch(&assign(&source, "lead", json!("foreign"))).is_err());
        let mut source = source;
        source["fragments"][1]["groups"] = json!((0..16)
            .map(|i| if i == 0 {
                json!({"key":"g0","name":"G0"})
            } else {
                json!({"key":format!("g{i}"),"name":format!("G{i}"),"parentKey":format!("g{}",i-1)})
            })
            .collect::<Vec<_>>());
        assert!(expand(&text(&source)).is_ok());
        let mut request = add(&source);
        request["fragmentId"] = json!("unused");
        request["instances"] = json!([]);
        request["group"] = json!({"key":"extra","name":"Extra","parentKey":"g15"});
        assert_eq!(
            dispatch(&request).unwrap_err().error_code,
            "scene_composition_invalid"
        );
    }
    #[test]
    fn declared_expanded_and_final_byte_budgets_are_atomic_with_shrinking_edits() {
        let mut source = recipe();
        source["fragments"][1]["groups"] = json!((0..126)
            .map(|i| json!({"key":format!("g{i}"),"name":"G"}))
            .collect::<Vec<_>>());
        let mut request = add(&source);
        request["fragmentId"] = json!("unused");
        request["group"] = json!({"key":"extra","name":"Extra"});
        request["instances"] = json!([]);
        assert_eq!(
            dispatch(&request).unwrap_err().error_code,
            "scene_composition_limit"
        );
        let mut source = recipe();
        source["placements"]=json!((0..64).map(|i|json!({"placementId":id(1000+i*5),"fragmentId":"pair","actorIds":{"lead":id(1001+i*5),"support":id(1002+i*5)},"groupIds":{"root":id(1003+i*5),"sub":id(1004+i*5)}})).collect::<Vec<_>>());
        let mut request = add(&source);
        request["instances"] = json!(source["placements"]
            .as_array()
            .unwrap()
            .iter()
            .enumerate()
            .map(|(i, p)| json!({"placementId":p["placementId"],"groupId":id(2000+i)}))
            .collect::<Vec<_>>());
        assert_eq!(
            dispatch(&request).unwrap_err().error_code,
            "scene_composition_limit"
        );
        let source = recipe();
        let mut content = text(&source);
        content.push_str(&" ".repeat(128 * 1024 - content.len()));
        let mut request = add(&source);
        request["content"] = json!(content.clone());
        assert_eq!(
            dispatch(&request).unwrap_err().error_code,
            "scene_composition_limit"
        );
        let mut request = edit(&source, "root", "R", Value::Null);
        request["content"] = json!(content);
        assert!(dispatch(&request).unwrap().after_content.len() < 128 * 1024);
    }
    #[test]
    fn names_use_utf16_limits_and_invalid_controls_and_shapes_are_rejected() {
        let source = recipe();
        for name in [" ".into(), "x\n".into(), "x\u{7f}".into(), "🦊".repeat(81)] {
            assert!(dispatch(&edit(&source, "root", &name, Value::Null)).is_err());
        }
        assert!(dispatch(&edit(&source, "root", &"🦊".repeat(80), Value::Null)).is_ok());
        let mut request = add(&source);
        request["group"]["position"] = json!([1, 2]);
        assert!(dispatch(&request).is_err());
        for mut request in [
            add(&source),
            edit(&source, "root", "Root", Value::Null),
            assign(&source, "lead", Value::Null),
            remove(&source, "sub"),
        ] {
            request["extra"] = json!(true);
            assert_eq!(
                dispatch(&request).unwrap_err().error_code,
                "studio_core_request_invalid"
            );
        }
    }
    #[test]
    fn member_splicing_handles_escaped_keys_and_parent_first_middle_tail() {
        let source = recipe();
        for order in 0..3 {
            let group = match order {
                0 => "{\"parentKey\":\"root\",\"key\":\"sub\",\"name\":\"Sub\"}",
                1 => "{\"key\":\"sub\",\"parentKey\":\"root\",\"name\":\"Sub\"}",
                _ => "{\"key\":\"sub\",\"name\":\"Sub\",\"parentKey\":\"root\"}",
            };
            let mut value = source.clone();
            value["fragments"][0]["groups"][1] = json!("PLACEHOLDER");
            let content = serde_json::to_string(&value)
                .unwrap()
                .replace("\"PLACEHOLDER\"", group)
                .replace("\"parentKey\"", "\"\\u0070arentKey\"");
            let mut request = edit(&source, "sub", "Renamed", Value::Null);
            request["content"] = json!(content.clone());
            let response = dispatch(&request).unwrap();
            let after = parsed(&response.after_content);
            assert_eq!(
                after["fragments"][0]["groups"][1],
                json!({"key":"sub","name":"Renamed"})
            );
            assert_eq!(after["placements"], source["placements"]);
        }
    }
}
