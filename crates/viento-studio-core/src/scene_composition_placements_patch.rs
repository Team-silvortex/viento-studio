//! Atomic placement structure edits. Copied declarations retain their source tokens.
#![forbid(unsafe_code)]
use crate::scene_composition::expand;
use crate::scene_composition_patch::{
    append_item, apply_edits, member, remove_items, Edit, SceneCompositionPatchResponse,
};
use crate::scene_source::{parse_json_source, Node};
use crate::CoreError;
use serde_json::{Map, Value};
use std::collections::HashSet;

fn invalid() -> CoreError {
    CoreError {
        error_code: "scene_composition_invalid",
        message: "Expected an exact placement structure edit with fresh complete identities.",
    }
}
fn uuid(value: &Value) -> Result<&str, CoreError> {
    let value = value.as_str().ok_or_else(invalid)?;
    if value.len() != 36
        || !value.bytes().enumerate().all(|(i, b)| {
            if [8, 13, 18, 23].contains(&i) {
                b == b'-'
            } else {
                b.is_ascii_digit() || (b'a'..=b'f').contains(&b)
            }
        })
    {
        return Err(invalid());
    }
    Ok(value)
}
fn identities(
    map: &Value,
    declarations: &Value,
    used: &mut HashSet<String>,
) -> Result<(), CoreError> {
    let map = map.as_object().ok_or_else(invalid)?;
    let declarations = declarations.as_array().ok_or_else(invalid)?;
    if map.len() != declarations.len() {
        return Err(invalid());
    }
    for declaration in declarations {
        let value = map
            .get(declaration["key"].as_str().ok_or_else(invalid)?)
            .ok_or_else(invalid)?;
        if !used.insert(uuid(value)?.to_owned()) {
            return Err(invalid());
        }
    }
    Ok(())
}
fn copied(content: &str, node: &Node, request: &Map<String, Value>) -> Result<String, CoreError> {
    let mut edits = vec![Edit {
        span: member(node, "placementId")?.span.clone(),
        text: serde_json::to_string(&request["placementId"]).map_err(|_| invalid())?,
    }];
    for name in ["actorIds", "groupIds"] {
        for (key, value) in request[name].as_object().ok_or_else(invalid)? {
            edits.push(Edit {
                span: member(member(node, name)?, key)?.span.clone(),
                text: serde_json::to_string(value).map_err(|_| invalid())?,
            });
        }
    }
    edits.sort_by_key(|edit| edit.span.start);
    let mut result = String::new();
    let mut cursor = node.span.start;
    for edit in edits {
        if edit.span.start < cursor || edit.span.end > node.span.end {
            return Err(invalid());
        }
        result.push_str(&content[cursor..edit.span.start]);
        result.push_str(&edit.text);
        cursor = edit.span.end;
    }
    result.push_str(&content[cursor..node.span.end]);
    Ok(result)
}
pub(crate) fn dispatch(request: &Value) -> Result<SceneCompositionPatchResponse, CoreError> {
    let request = request.as_object().ok_or_else(CoreError::request)?;
    let operation = request
        .get("operation")
        .and_then(Value::as_str)
        .ok_or_else(CoreError::request)?;
    let required: &[&str] = match operation {
        "sceneComposition.addPlacement" => &[
            "protocolVersion",
            "operation",
            "content",
            "fragmentId",
            "placementId",
            "actorIds",
            "groupIds",
        ],
        "sceneComposition.copyPlacement" => &[
            "protocolVersion",
            "operation",
            "content",
            "sourcePlacementId",
            "placementId",
            "actorIds",
            "groupIds",
        ],
        "sceneComposition.removePlacement" => {
            &["protocolVersion", "operation", "content", "placementId"]
        }
        _ => return Err(CoreError::request()),
    };
    if required.iter().any(|key| !request.contains_key(*key))
        || request.keys().any(|key| {
            !(required.contains(&key.as_str())
                || operation == "sceneComposition.addPlacement" && key == "offset")
        })
    {
        return Err(CoreError::request());
    }
    let content = request["content"].as_str().ok_or_else(CoreError::request)?;
    expand(content)?;
    let source: Value = serde_json::from_str(content.strip_prefix('\u{feff}').unwrap_or(content))
        .map_err(|_| invalid())?;
    let placements = source["placements"].as_array().ok_or_else(invalid)?;
    let root = parse_json_source(content).map_err(|_| invalid())?;
    let nodes = member(&root, "placements")?
        .array()
        .map_err(|_| invalid())?;
    let id = uuid(&request["placementId"])?;
    let (edits, index) = if operation == "sceneComposition.removePlacement" {
        if placements.len() < 2 {
            return Err(invalid());
        }
        let index = placements
            .iter()
            .position(|placement| placement["placementId"].as_str() == Some(id))
            .ok_or_else(invalid)?;
        let spans: Vec<_> = nodes.iter().map(|node| node.span.clone()).collect();
        (
            remove_items(
                &spans,
                &(0..nodes.len()).map(|i| i == index).collect::<Vec<_>>(),
            ),
            index,
        )
    } else {
        let original = if operation == "sceneComposition.copyPlacement" {
            let source_id = uuid(&request["sourcePlacementId"])?;
            Some(
                placements
                    .iter()
                    .enumerate()
                    .find(|(_, placement)| placement["placementId"].as_str() == Some(source_id))
                    .ok_or_else(invalid)?,
            )
        } else {
            None
        };
        let fragment_id = match original {
            Some((_, placement)) => &placement["fragmentId"],
            None => &request["fragmentId"],
        };
        let fragment = source["fragments"]
            .as_array()
            .ok_or_else(invalid)?
            .iter()
            .find(|fragment| &fragment["fragmentId"] == fragment_id)
            .ok_or_else(invalid)?;
        let mut used = HashSet::new();
        for placement in placements {
            used.insert(
                placement["placementId"]
                    .as_str()
                    .ok_or_else(invalid)?
                    .to_owned(),
            );
            for name in ["actorIds", "groupIds"] {
                for value in placement[name].as_object().ok_or_else(invalid)?.values() {
                    used.insert(value.as_str().ok_or_else(invalid)?.to_owned());
                }
            }
        }
        if !used.insert(id.to_owned()) {
            return Err(invalid());
        }
        identities(&request["actorIds"], &fragment["actors"], &mut used)?;
        identities(&request["groupIds"], &fragment["groups"], &mut used)?;
        let item = if let Some((index, _)) = original {
            copied(content, &nodes[index], request)?
        } else {
            let mut item = Map::new();
            for name in [
                "placementId",
                "fragmentId",
                "actorIds",
                "groupIds",
                "offset",
            ] {
                if let Some(value) = request.get(name) {
                    item.insert(name.to_owned(), value.clone());
                }
            }
            serde_json::to_string(&item).map_err(|_| invalid())?
        };
        (
            vec![append_item(content, member(&root, "placements")?, item)?],
            placements.len(),
        )
    };
    Ok(SceneCompositionPatchResponse {
        after_content: apply_edits(content, edits)?,
        changed_paths: vec![format!("/placements/{index}")],
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
        serde_json::from_str(include_str!(
            "../../../examples/scene-composition/recipe.json"
        ))
        .unwrap()
    }
    fn text(value: &Value) -> String {
        format!(
            "\u{feff}{}\r\n \t",
            serde_json::to_string_pretty(value)
                .unwrap()
                .replace('\n', "\r\n")
        )
    }
    fn add(content: String) -> Value {
        json!({"protocolVersion":1,"operation":"sceneComposition.addPlacement","content":content,"fragmentId":"party","placementId":id(900),"actorIds":{"leader":id(901),"companion":id(902)},"groupIds":{"party":id(903),"companions":id(904)}})
    }
    fn copy(content: String, index: usize) -> Value {
        let mut request = add(content.clone());
        let source: Value = serde_json::from_str(content.trim_start_matches('\u{feff}')).unwrap();
        request["operation"] = json!("sceneComposition.copyPlacement");
        request["sourcePlacementId"] = source["placements"][index]["placementId"].clone();
        request.as_object_mut().unwrap().remove("fragmentId");
        request
    }
    fn remove(content: String, index: usize) -> Value {
        let source: Value = serde_json::from_str(content.trim_start_matches('\u{feff}')).unwrap();
        json!({"protocolVersion":1,"operation":"sceneComposition.removePlacement","content":content,"placementId":source["placements"][index]["placementId"]})
    }
    fn parsed(text: &str) -> Value {
        serde_json::from_str(text.trim_start_matches('\u{feff}')).unwrap()
    }
    #[test]
    fn add_exact_scope_and_reusable_definitions() {
        let before = recipe();
        let response = dispatch(&add(text(&before))).unwrap();
        let mut expected = before.clone();
        expected["placements"].as_array_mut().unwrap().push(json!({"placementId":id(900),"fragmentId":"party","actorIds":{"leader":id(901),"companion":id(902)},"groupIds":{"party":id(903),"companions":id(904)}}));
        assert_eq!(parsed(&response.after_content), expected);
        assert_eq!(response.changed_paths, vec!["/placements/2"]);
        assert_eq!(
            expand(&response.after_content).unwrap().scene["actors"]
                .as_array()
                .unwrap()
                .len(),
            6
        );
    }
    #[test]
    fn copy_preserves_every_nonidentity_token() {
        let mut source = recipe();
        source["fragments"][0]["actors"][0]["useProjectionDefaults"] = json!(true);
        source["placements"][1]["overrides"][0]["values"] = json!({"position":[100,140],"size":[32,48],"color":"#abcdef","speed":0,"controls":"none","imageResourceId":null});
        let content = text(&source)
            .replace("360,", "3.60e2,")
            .replace("140,", "1.40e2,");
        let response = dispatch(&copy(content.clone(), 1)).unwrap();
        let root = parse_json_source(&content).unwrap();
        let original = &member(&root, "placements").unwrap().array().unwrap()[1];
        let copied_root = parse_json_source(&response.after_content).unwrap();
        let new = &member(&copied_root, "placements").unwrap().array().unwrap()[2];
        let mut expected = content[original.span.clone()].to_owned();
        for (before, after) in [
            (
                source["placements"][1]["placementId"]
                    .as_str()
                    .unwrap()
                    .to_owned(),
                id(900),
            ),
            (
                source["placements"][1]["actorIds"]["leader"]
                    .as_str()
                    .unwrap()
                    .to_owned(),
                id(901),
            ),
            (
                source["placements"][1]["actorIds"]["companion"]
                    .as_str()
                    .unwrap()
                    .to_owned(),
                id(902),
            ),
            (
                source["placements"][1]["groupIds"]["party"]
                    .as_str()
                    .unwrap()
                    .to_owned(),
                id(903),
            ),
            (
                source["placements"][1]["groupIds"]["companions"]
                    .as_str()
                    .unwrap()
                    .to_owned(),
                id(904),
            ),
        ] {
            expected = expected.replace(&before, &after);
        }
        assert_eq!(&response.after_content[new.span.clone()], expected);
        assert!(response.after_content.starts_with('\u{feff}'));
        assert!(response.after_content.ends_with("\r\n \t"));
        let changed_root = member(&copied_root, "placements").unwrap().array().unwrap();
        assert_eq!(
            &response.after_content[changed_root[1].span.clone()],
            &content[original.span.clone()]
        );
    }
    #[test]
    fn copy_keeps_missing_vs_zero_and_empty_overrides() {
        for (offset, overrides) in [(None, None), (Some(json!([0, 0])), Some(json!([])))] {
            let mut source = recipe();
            let placement = source["placements"][0].as_object_mut().unwrap();
            if let Some(offset) = offset {
                placement.insert("offset".into(), offset);
            }
            if let Some(overrides) = overrides {
                placement.insert("overrides".into(), overrides);
            }
            let response = dispatch(&copy(text(&source), 0)).unwrap();
            let after = parsed(&response.after_content);
            assert_eq!(
                after["placements"][2].get("offset"),
                source["placements"][0].get("offset")
            );
            assert_eq!(
                after["placements"][2].get("overrides"),
                source["placements"][0].get("overrides")
            );
        }
    }
    #[test]
    fn remove_first_last_preserves_other_placement_tokens_and_fragments() {
        for index in 0..2 {
            let before = recipe();
            let content = text(&before);
            let response = dispatch(&remove(content.clone(), index)).unwrap();
            let mut expected = before;
            expected["placements"].as_array_mut().unwrap().remove(index);
            assert_eq!(parsed(&response.after_content), expected);
            assert_eq!(response.changed_paths, vec![format!("/placements/{index}")]);
            let root = parse_json_source(&content).unwrap();
            let nodes = member(&root, "placements").unwrap().array().unwrap();
            assert!(response
                .after_content
                .contains(&content[nodes[1 - index].span.clone()]));
        }
    }
    #[test]
    fn last_or_unknown_placement_cannot_be_removed() {
        let mut source = recipe();
        source["placements"].as_array_mut().unwrap().pop();
        assert_eq!(
            dispatch(&remove(text(&source), 0)).unwrap_err().error_code,
            "scene_composition_invalid"
        );
        let mut request = remove(text(&recipe()), 0);
        request["placementId"] = json!(id(999));
        assert!(dispatch(&request).is_err());
    }
    #[test]
    fn unused_fragment_first_placement_and_explicit_offset() {
        let mut source = recipe();
        let object_id = source["fragments"][0]["actors"][0]["objectId"].clone();
        source["fragments"].as_array_mut().unwrap().push(json!({"fragmentId":"unused","actors":[{"key":"alone","objectId":object_id,"position":[10,20],"useProjectionDefaults":true}],"groups":[]}));
        let mut request = add(text(&source));
        request["fragmentId"] = json!("unused");
        request["actorIds"] = json!({"alone":id(901)});
        request["groupIds"] = json!({});
        request["offset"] = json!([-5, 0]);
        let response = dispatch(&request).unwrap();
        assert_eq!(
            expand(&response.after_content).unwrap().scene["actors"][4]["position"],
            json!([5.0, 20.0])
        );
    }
    #[test]
    fn fresh_all_identity_domains_and_exact_maps() {
        let original = add(text(&recipe()));
        for collision in [
            id(900),
            recipe()["placements"][0]["placementId"]
                .as_str()
                .unwrap()
                .into(),
            recipe()["placements"][0]["actorIds"]["leader"]
                .as_str()
                .unwrap()
                .into(),
            recipe()["placements"][1]["groupIds"]["party"]
                .as_str()
                .unwrap()
                .into(),
        ] {
            let mut request = original.clone();
            request["actorIds"]["leader"] = json!(collision);
            assert_eq!(
                dispatch(&request).unwrap_err().error_code,
                "scene_composition_invalid"
            );
        }
        for maps in [
            json!({"leader":id(901)}),
            json!({"leader":id(901),"companion":id(902),"extra":id(905)}),
        ] {
            let mut request = original.clone();
            request["actorIds"] = maps;
            assert!(dispatch(&request).is_err());
        }
    }
    #[test]
    fn exact_requests_reject_editing_copy_defaults_and_overrides() {
        for (mut request, extra) in [
            (add(text(&recipe())), "overrides"),
            (copy(text(&recipe()), 0), "offset"),
            (remove(text(&recipe()), 0), "actorIds"),
        ] {
            request[extra] = json!([]);
            assert_eq!(
                dispatch(&request).unwrap_err().error_code,
                "studio_core_request_invalid"
            );
        }
    }
    #[test]
    fn final_world_offset_and_expanded_count_are_atomic() {
        let mut request = add(text(&recipe()));
        request["offset"] = json!([100000, 0]);
        assert_eq!(
            dispatch(&request).unwrap_err().error_code,
            "scene_composition_invalid"
        );
        let mut source = recipe();
        let prototype = source["placements"][0].clone();
        source["placements"] = json!([]);
        for i in 0..64 {
            let mut placement = prototype.clone();
            placement["placementId"] = json!(id(1000 + i * 5));
            placement["actorIds"] = json!({"leader":id(1001+i*5),"companion":id(1002+i*5)});
            placement["groupIds"] = json!({"party":id(1003+i*5),"companions":id(1004+i*5)});
            source["placements"].as_array_mut().unwrap().push(placement);
        }
        assert!(expand(&text(&source)).is_ok());
        assert_eq!(
            dispatch(&add(text(&source))).unwrap_err().error_code,
            "scene_composition_limit"
        );
    }
    #[test]
    fn final_source_budget_only() {
        let mut content = text(&recipe());
        content.push_str(&" ".repeat(128 * 1024 - content.len()));
        assert!(expand(&content).is_ok());
        assert_eq!(
            dispatch(&add(content.clone())).unwrap_err().error_code,
            "scene_composition_limit"
        );
        let response = dispatch(&remove(content, 0)).unwrap();
        assert!(response.after_content.len() < 128 * 1024);
    }
}
