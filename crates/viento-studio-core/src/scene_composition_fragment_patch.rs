//! Explicit set or atomic set/reset edits of one shared actor declaration.
//! Local placement overrides and author identities are never rewritten.
#![forbid(unsafe_code)]

use crate::scene_composition::{expand, ACTOR_VALUES};
use crate::scene_composition_patch::{
    append_item, apply_edits, colon, encode, equal, member, remove_items, replace_value,
    SceneCompositionPatchResponse,
};
use crate::scene_source::parse_json_source;
use crate::CoreError;
use serde_json::Value;
use std::collections::HashSet;

fn invalid() -> CoreError {
    CoreError {
        error_code: "scene_composition_invalid",
        message: "Expected one existing fragment actor and a nonempty set of declaration values.",
    }
}

pub(crate) fn dispatch(request: &Value) -> Result<SceneCompositionPatchResponse, CoreError> {
    dispatch_actor(request, false)
}

pub(crate) fn dispatch_edit(request: &Value) -> Result<SceneCompositionPatchResponse, CoreError> {
    dispatch_actor(request, true)
}

fn dispatch_actor(
    request: &Value,
    editing: bool,
) -> Result<SceneCompositionPatchResponse, CoreError> {
    let request = request.as_object().ok_or_else(CoreError::request)?;
    let keys = [
        "protocolVersion",
        "operation",
        "content",
        "fragmentId",
        "actorKey",
        "values",
    ];
    if request.len() != keys.len() + usize::from(editing)
        || keys.iter().any(|key| !request.contains_key(*key))
        || editing && !request.contains_key("reset")
        || request["operation"].as_str()
            != Some(if editing {
                "sceneComposition.editFragmentActor"
            } else {
                "sceneComposition.patchFragmentActor"
            })
    {
        return Err(CoreError::request());
    }
    let content = request["content"].as_str().ok_or_else(CoreError::request)?;
    let fragment_id = request["fragmentId"].as_str().ok_or_else(invalid)?;
    let actor_key = request["actorKey"].as_str().ok_or_else(invalid)?;
    let values = request["values"].as_object().ok_or_else(invalid)?;
    let mut reset = HashSet::new();
    if editing {
        let fields = request["reset"].as_array().ok_or_else(invalid)?;
        if fields.len() > ACTOR_VALUES.len() - 1 {
            return Err(invalid());
        }
        for field in fields {
            let field = field.as_str().ok_or_else(invalid)?;
            if field == "position"
                || !ACTOR_VALUES.contains(&field)
                || !reset.insert(field)
                || values.contains_key(field)
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
    // This validates unused fragments too. The same existing expansion rules
    // validate declarations and every placement's final merged, offset values.
    expand(content)?;
    let source: Value = serde_json::from_str(content.strip_prefix('\u{feff}').unwrap_or(content))
        .map_err(|_| invalid())?;
    let (fragment_index, fragment) = source["fragments"]
        .as_array()
        .ok_or_else(invalid)?
        .iter()
        .enumerate()
        .find(|(_, item)| item["fragmentId"].as_str() == Some(fragment_id))
        .ok_or_else(invalid)?;
    let (actor_index, actor) = fragment["actors"]
        .as_array()
        .ok_or_else(invalid)?
        .iter()
        .enumerate()
        .find(|(_, item)| item["key"].as_str() == Some(actor_key))
        .ok_or_else(invalid)?;
    // Never change the inheritance flag implicitly. Image absence is valid
    // without projection defaults; the four required appearance/movement
    // fields may be removed only from an inheriting declaration.
    if actor["useProjectionDefaults"] != true
        && reset.iter().any(|field| *field != "imageResourceId")
    {
        return Err(invalid());
    }
    let changed: Vec<_> = ACTOR_VALUES
        .iter()
        .copied()
        .filter(|field| {
            reset.contains(field) && actor.get(*field).is_some()
                || values.get(*field).is_some_and(|after| {
                    actor.get(*field).is_none_or(|before| !equal(before, after))
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
    let fragment_node =
        &member(&root, "fragments")?.array().map_err(|_| invalid())?[fragment_index];
    let actor_node = &member(fragment_node, "actors")?
        .array()
        .map_err(|_| invalid())?[actor_index];
    let mut edits = Vec::new();
    let mut added = Vec::new();
    let delimiter = colon(content, actor_node)?;
    if !reset.is_empty() {
        let members = actor_node.object().map_err(|_| invalid())?;
        let spans = members
            .iter()
            .map(|(_, node)| node.member_span.clone().ok_or_else(invalid))
            .collect::<Result<Vec<_>, _>>()?;
        let removed = members
            .iter()
            .map(|(key, _)| {
                reset
                    .iter()
                    .any(|field| key.iter().copied().eq(field.encode_utf16()))
            })
            .collect::<Vec<_>>();
        edits.extend(remove_items(&spans, &removed));
    }
    for field in &changed {
        if reset.contains(field) {
            continue;
        }
        if let Some(node) = actor_node.get(field) {
            replace_value(&mut edits, node, &actor[*field], &values[*field])?;
        } else {
            added.push(format!(
                "\"{field}\"{delimiter}{}",
                encode(&values[*field])?
            ));
        }
    }
    if !added.is_empty() {
        let mut insertion = append_item(content, actor_node, added[0].clone())?;
        let separator = &insertion.text[..insertion.text.len() - added[0].len()];
        insertion.text = format!("{separator}{}", added.join(separator));
        edits.push(insertion);
    }
    let after_content = apply_edits(content, edits)?;
    Ok(SceneCompositionPatchResponse {
        after_content,
        changed_paths: changed
            .iter()
            .map(|field| format!("/fragments/{fragment_index}/actors/{actor_index}/{field}"))
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
        json!({"format":"viento-scene-composition","schemaVersion":1,
            "scene":{"title":"Shared 配方🦊","viewport":[640,480],"background":"#112233"},
            "fragments":[{"fragmentId":"pair","groups":[],"actors":[
                {"key":"leader","objectId":id(1),"position":[10,20],"size":[32,48],"color":"#ffffff","speed":150,"controls":"arrows"},
                {"key":"companion","objectId":id(2),"position":[30,40],"useProjectionDefaults":true}]}],
            "placements":[
                {"placementId":id(10),"fragmentId":"pair","actorIds":{"leader":id(11),"companion":id(12)},"groupIds":{}},
                {"placementId":id(20),"fragmentId":"pair","actorIds":{"leader":id(21),"companion":id(22)},"groupIds":{},"offset":[300,80],
                    "overrides":[{"actorKey":"leader","values":{"position":[100,150],"speed":180}}]}]})
    }
    fn text(value: &Value) -> String {
        format!(
            "\u{feff}{}\r\n \t",
            serde_json::to_string_pretty(value)
                .unwrap()
                .replace('\n', "\r\n")
        )
    }
    fn parsed(content: &str) -> Value {
        serde_json::from_str(content.strip_prefix('\u{feff}').unwrap_or(content)).unwrap()
    }
    fn request(content: &str, actor: &str, values: Value) -> Value {
        json!({"protocolVersion":1,"operation":"sceneComposition.patchFragmentActor","content":content,"fragmentId":"pair","actorKey":actor,"values":values})
    }
    fn run(content: &str, actor: &str, values: Value) -> SceneCompositionPatchResponse {
        dispatch(&request(content, actor, values)).unwrap()
    }

    #[test]
    fn shared_declarations_change_linked_instances_but_retain_local_overrides() {
        let before = text(&recipe());
        let result = run(
            &before,
            "leader",
            json!({"position":[12,22],"speed":160,"color":"#aabbcc"}),
        );
        assert_eq!(
            result.changed_paths,
            [
                "/fragments/0/actors/0/position",
                "/fragments/0/actors/0/color",
                "/fragments/0/actors/0/speed"
            ]
        );
        let mut expected = parsed(&before);
        for (field, value) in json!({"position":[12,22],"speed":160,"color":"#aabbcc"})
            .as_object()
            .unwrap()
        {
            expected["fragments"][0]["actors"][0][field] = value.clone();
        }
        assert_eq!(parsed(&result.after_content), expected);
        let actors = expand(&result.after_content).unwrap().scene;
        assert_eq!(actors["actors"][0]["position"], json!([12.0, 22.0]));
        assert_eq!(actors["actors"][2]["position"], json!([400.0, 230.0]));
        assert_eq!(actors["actors"][0]["speed"], 160);
        assert_eq!(actors["actors"][2]["speed"], 180);
        assert_eq!(actors["actors"][2]["color"], "#aabbcc");
        assert!(result.after_content.starts_with('\u{feff}'));
        assert!(result.after_content.ends_with("\r\n \t"));
    }

    #[test]
    fn multiple_missing_fields_append_once_in_canonical_field_order() {
        let before = text(&recipe());
        let result = run(
            &before,
            "companion",
            json!({"imageResourceId":null,"controls":"none","speed":0,"color":"#aabbcc88","size":[48,64]}),
        );
        assert_eq!(
            result.changed_paths,
            [
                "/fragments/0/actors/1/size",
                "/fragments/0/actors/1/color",
                "/fragments/0/actors/1/speed",
                "/fragments/0/actors/1/controls",
                "/fragments/0/actors/1/imageResourceId"
            ]
        );
        let insertion = ",\r\n          \"size\": [48,64],\r\n          \"color\": \"#aabbcc88\",\r\n          \"speed\": 0,\r\n          \"controls\": \"none\",\r\n          \"imageResourceId\": null";
        // Restore precisely the existing author bytes by removing one insertion.
        assert!(result.after_content.contains(insertion));
        assert_eq!(result.after_content.replace(insertion, ""), before);
    }

    #[test]
    fn existing_semantic_noops_keep_raw_numeric_and_escaped_tokens() {
        let before = text(&recipe())
            .replace("\"position\"", "\"posit\\u0069on\"")
            .replace("          10,", "          1.0e1,")
            .replace("          20\r", "          2.000e1\r");
        let noop = run(&before, "leader", json!({"position":[10,20],"speed":150}));
        assert_eq!(noop.after_content, before);
        assert!(noop.changed_paths.is_empty());
        let result = run(&before, "leader", json!({"position":[11,20]}));
        assert_eq!(result.after_content, before.replace("1.0e1", "11"));
    }

    #[test]
    fn a_hidden_template_edit_remains_a_declaration_change() {
        let mut value = recipe();
        for placement in value["placements"].as_array_mut().unwrap() {
            placement["overrides"] = json!([{"actorKey":"leader","values":{"speed":180}}]);
        }
        let before = text(&value);
        let result = run(&before, "leader", json!({"speed":160}));
        assert_eq!(result.changed_paths, ["/fragments/0/actors/0/speed"]);
        let expanded = expand(&result.after_content).unwrap();
        assert_eq!(expanded.scene["actors"][0]["speed"], 180);
        assert_eq!(expanded.scene["actors"][2]["speed"], 180);
        assert_ne!(result.after_content, before);
    }

    #[test]
    fn offset_bounds_reject_only_uncovered_final_positions() {
        let mut value = recipe();
        value["placements"][1]["offset"] = json!([99900, 0]);
        let before = text(&value);
        assert!(dispatch(&request(&before, "companion", json!({"position":[101,40]}))).is_err());
        assert_eq!(parsed(&before), value);
        let result = run(&before, "leader", json!({"position":[101,22]}));
        assert_eq!(
            expand(&result.after_content).unwrap().scene["actors"][2]["position"],
            json!([100000.0, 150.0])
        );
    }

    #[test]
    fn unused_fragments_are_editable_and_still_strictly_validated() {
        let mut value = recipe();
        let mut unused = value["fragments"][0].clone();
        unused["fragmentId"] = json!("unused");
        value["fragments"].as_array_mut().unwrap().push(unused);
        let before = text(&value);
        let mut input = request(&before, "leader", json!({"speed":9}));
        input["fragmentId"] = json!("unused");
        let result = dispatch(&input).unwrap();
        assert_eq!(result.changed_paths, ["/fragments/1/actors/0/speed"]);
        assert_eq!(
            expand(&before).unwrap().scene,
            expand(&result.after_content).unwrap().scene
        );
        input["values"] = json!({"size":[0,1]});
        assert!(dispatch(&input).is_err());
    }

    #[test]
    fn final_budget_can_balance_growing_and_shrinking_fields() {
        let mut value = recipe();
        value["fragments"][0]["actors"][0]["position"] = json!([9999, 9999]);
        value["fragments"][0]["actors"][0]["speed"] = json!(1);
        let prefix = text(&value);
        let before = prefix.clone() + &" ".repeat(128 * 1024 - prefix.len());
        let result = run(&before, "leader", json!({"position":[1,1],"speed":1999}));
        assert!(result.after_content.len() <= 128 * 1024);
        assert!(dispatch(&request(&before, "leader", json!({"speed":1999}))).is_err());
        assert_eq!(before.len(), 128 * 1024);
    }

    #[test]
    fn strict_values_identity_reset_duplicate_source_and_null_rules() {
        let before = text(&recipe());
        for values in [
            json!({}),
            json!({"resetFields":["speed"]}),
            json!({"objectId":id(9)}),
            json!({"groupKey":"party"}),
            json!({"useProjectionDefaults":true}),
            json!({"size":[0,1]}),
            json!({"speed":2001}),
            json!({"controls":"wasd"}),
            json!({"color":"red"}),
            json!({"imageResourceId":null}),
        ] {
            assert!(dispatch(&request(&before, "leader", values)).is_err());
        }
        let mut input = request(&before, "leader", json!({"speed":160}));
        input["resetFields"] = json!([]);
        assert!(dispatch(&input).is_err());
        input = request(&before, "missing", json!({"speed":160}));
        assert!(dispatch(&input).is_err());
        input = request(&before, "leader", json!({"speed":160}));
        input["fragmentId"] = json!("missing");
        assert!(dispatch(&input).is_err());
        let duplicate = before.replace(
            "\"schemaVersion\": 1",
            "\"schemaVersion\": 1, \"schemaVersion\": 1",
        );
        assert!(dispatch(&request(&duplicate, "leader", json!({"speed":160}))).is_err());
        assert_eq!(crate::viento_core_scene_composition_fragment_version(), 1);
    }
}
