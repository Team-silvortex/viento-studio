//! Atomic source-preserving fragment identity and placement reference rename.
#![forbid(unsafe_code)]
use crate::scene_composition::expand;
use crate::scene_composition_patch::{apply_edits, member, Edit, SceneCompositionPatchResponse};
use crate::scene_source::parse_json_source;
use crate::CoreError;
use serde_json::Value;

fn invalid() -> CoreError {
    CoreError {
        error_code: "scene_composition_invalid",
        message: "Expected an existing fragment and a distinct valid local fragment identity.",
    }
}
fn key(value: &Value) -> Result<&str, CoreError> {
    let value = value.as_str().ok_or_else(invalid)?;
    if value.is_empty()
        || value.len() > 64
        || !value.as_bytes()[0].is_ascii_alphabetic()
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
    {
        return Err(invalid());
    }
    Ok(value)
}
pub(crate) fn dispatch(request: &Value) -> Result<SceneCompositionPatchResponse, CoreError> {
    let request = request.as_object().ok_or_else(CoreError::request)?;
    let required = [
        "protocolVersion",
        "operation",
        "content",
        "fragmentId",
        "newFragmentId",
    ];
    if request.len() != required.len()
        || required.iter().any(|name| !request.contains_key(*name))
        || request["operation"].as_str() != Some("sceneComposition.renameFragmentDefinition")
    {
        return Err(CoreError::request());
    }
    let content = request["content"].as_str().ok_or_else(CoreError::request)?;
    expand(content)?;
    let old = key(&request["fragmentId"])?;
    let new = key(&request["newFragmentId"])?;
    let source: Value = serde_json::from_str(content.strip_prefix('\u{feff}').unwrap_or(content))
        .map_err(|_| invalid())?;
    let fragments = source["fragments"].as_array().ok_or_else(invalid)?;
    let index = fragments
        .iter()
        .position(|fragment| fragment["fragmentId"].as_str() == Some(old))
        .ok_or_else(invalid)?;
    if old == new {
        return Ok(SceneCompositionPatchResponse {
            after_content: content.to_owned(),
            changed_paths: vec![],
        });
    }
    if fragments
        .iter()
        .any(|fragment| fragment["fragmentId"].as_str() == Some(new))
    {
        return Err(invalid());
    }
    let root = parse_json_source(content).map_err(|_| invalid())?;
    let nodes = member(&root, "fragments")?.array().map_err(|_| invalid())?;
    let value = serde_json::to_string(new).map_err(|_| invalid())?;
    let mut edits = vec![Edit {
        span: member(&nodes[index], "fragmentId")?.span.clone(),
        text: value.clone(),
    }];
    let mut changed_paths = vec![format!("/fragments/{index}/fragmentId")];
    let placements = source["placements"].as_array().ok_or_else(invalid)?;
    let nodes = member(&root, "placements")?
        .array()
        .map_err(|_| invalid())?;
    for (index, placement) in placements.iter().enumerate() {
        if placement["fragmentId"].as_str() == Some(old) {
            edits.push(Edit {
                span: member(&nodes[index], "fragmentId")?.span.clone(),
                text: value.clone(),
            });
            changed_paths.push(format!("/placements/{index}/fragmentId"));
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
    fn rename(content: String, old: &str, new: &str) -> Value {
        json!({"protocolVersion":1,"operation":"sceneComposition.renameFragmentDefinition","content":content,"fragmentId":old,"newFragmentId":new})
    }
    fn parsed(content: &str) -> Value {
        serde_json::from_str(content.strip_prefix('\u{feff}').unwrap_or(content)).unwrap()
    }
    fn unused(value: &mut Value) {
        let mut fragment = value["fragments"][0].clone();
        fragment["fragmentId"] = json!("unused");
        value["fragments"].as_array_mut().unwrap().push(fragment);
    }
    #[test]
    fn renames_all_related_placement_refs_in_source_order_without_changing_effective_scene() {
        let mut value = recipe();
        unused(&mut value);
        let content = text(&value);
        let before = expand(&content).unwrap();
        let result = dispatch(&rename(content, "party", "renamed")).unwrap();
        value["fragments"][0]["fragmentId"] = json!("renamed");
        for p in value["placements"].as_array_mut().unwrap() {
            p["fragmentId"] = json!("renamed");
        }
        assert_eq!(parsed(&result.after_content), value);
        assert_eq!(expand(&result.after_content).unwrap().scene, before.scene);
        assert_eq!(
            result.changed_paths,
            vec![
                "/fragments/0/fragmentId",
                "/placements/0/fragmentId",
                "/placements/1/fragmentId"
            ]
        );
    }
    #[test]
    fn unused_rename_changes_only_one_token_and_never_allocates_instances() {
        let mut value = recipe();
        unused(&mut value);
        let content = text(&value);
        let result = dispatch(&rename(content.clone(), "unused", "independent")).unwrap();
        assert_eq!(
            result.after_content,
            content.replace("\"unused\"", "\"independent\"")
        );
        assert_eq!(result.changed_paths, ["/fragments/1/fragmentId"]);
        assert_eq!(
            expand(&content).unwrap().scene,
            expand(&result.after_content).unwrap().scene
        );
    }
    #[test]
    fn decoded_identity_matches_escaped_value_and_keys_with_other_lexemes_retained() {
        let content = text(&recipe())
            .replace("\"fragmentId\"", "\"\\u0066ragmentId\"")
            .replace("\"party\"", "\"p\\u0061rty\"")
            .replacen("120", "1.20e2", 1);
        let root = parse_json_source(&content).unwrap();
        let mut spans = vec![member(
            &member(&root, "fragments").unwrap().array().unwrap()[0],
            "fragmentId",
        )
        .unwrap()
        .span
        .clone()];
        for p in member(&root, "placements").unwrap().array().unwrap() {
            spans.push(member(p, "fragmentId").unwrap().span.clone());
        }
        let mut expected = content.clone();
        for span in spans.iter().rev() {
            expected.replace_range(span.clone(), "\"changed\"");
        }
        let result = dispatch(&rename(content, "party", "changed")).unwrap();
        assert_eq!(result.after_content, expected);
        assert!(expected.contains("1.20e2") && expected.contains("\\u0066ragmentId"));
    }
    #[test]
    fn same_id_is_exact_byte_noop_even_when_identity_uses_escapes() {
        let content = text(&recipe()).replace("\"party\"", "\"p\\u0061rty\"");
        let result = dispatch(&rename(content.clone(), "party", "party")).unwrap();
        assert_eq!(result.after_content, content);
        assert!(result.changed_paths.is_empty());
    }
    #[test]
    fn incomplete_extra_wrong_operation_or_wrong_types_are_not_admitted() {
        let good = rename(text(&recipe()), "party", "new");
        let mut extra = good.clone();
        extra["cascade"] = json!(true);
        let mut missing = good.clone();
        missing.as_object_mut().unwrap().remove("newFragmentId");
        let mut wrong = good.clone();
        wrong["operation"] = json!("sceneComposition.addFragmentDefinition");
        for input in [extra, missing, wrong, json!(null)] {
            assert_eq!(
                dispatch(&input).unwrap_err().error_code,
                "studio_core_request_invalid"
            );
        }
        for input in [json!(null), json!(1), json!([])] {
            let mut req = good.clone();
            req["newFragmentId"] = input;
            assert_eq!(
                dispatch(&req).unwrap_err().error_code,
                "scene_composition_invalid"
            );
        }
    }
    #[test]
    fn missing_old_duplicate_new_and_nonlocal_identifiers_reject_without_cascade() {
        let mut value = recipe();
        unused(&mut value);
        let content = text(&value);
        for (old, new) in [
            ("missing", "new"),
            ("party", "unused"),
            ("party", ""),
            ("party", "1bad"),
            ("party", "../file"),
            ("party", "日本語"),
            ("party", "key space"),
        ] {
            assert_eq!(
                dispatch(&rename(content.clone(), old, new))
                    .unwrap_err()
                    .error_code,
                "scene_composition_invalid"
            );
        }
        assert_eq!(
            dispatch(&rename(content, "party", &"a".repeat(65)))
                .unwrap_err()
                .error_code,
            "scene_composition_invalid"
        );
    }
    #[test]
    fn only_related_references_change_with_interleaved_placements_and_reused_objects() {
        let mut value = recipe();
        unused(&mut value);
        value["placements"][1]["fragmentId"] = json!("unused");
        let content = text(&value);
        let result = dispatch(&rename(content, "party", "renamed")).unwrap();
        assert_eq!(
            result.changed_paths,
            ["/fragments/0/fragmentId", "/placements/0/fragmentId"]
        );
        let actual = parsed(&result.after_content);
        assert_eq!(actual["placements"][1], value["placements"][1]);
        assert_eq!(actual["fragments"][1], value["fragments"][1]);
    }
    #[test]
    fn full_original_validation_cannot_be_bypassed_by_noop_or_repair_rename() {
        let source = text(&recipe()).replacen(
            "\"schemaVersion\": 1",
            "\"schemaVersion\": 1, \"schemaVersion\": 1",
            1,
        );
        for new in ["party", "changed"] {
            assert_eq!(
                dispatch(&rename(source.clone(), "party", new))
                    .unwrap_err()
                    .error_code,
                "scene_composition_invalid"
            );
        }
        let mut value = recipe();
        unused(&mut value);
        value["fragments"][1]["actors"][0]["position"] = json!([100001, 0]);
        assert_eq!(
            dispatch(&rename(text(&value), "unused", "new"))
                .unwrap_err()
                .error_code,
            "scene_composition_invalid"
        );
    }
    #[test]
    fn exact_source_byte_limit_checks_final_whole_batch_and_permits_shrink() {
        let mut content = text(&recipe());
        content.push_str(&" ".repeat(131072 - content.len()));
        assert_eq!(
            dispatch(&rename(content.clone(), "party", "longer"))
                .unwrap_err()
                .error_code,
            "scene_composition_limit"
        );
        let shorter = dispatch(&rename(content.clone(), "party", "p")).unwrap();
        assert!(shorter.after_content.len() < 131072);
        assert_eq!(shorter.changed_paths.len(), 3);
        assert_eq!(
            dispatch(&rename(content.clone(), "party", "party"))
                .unwrap()
                .after_content,
            content
        );
        content.push(' ');
        assert_eq!(
            dispatch(&rename(content, "party", "p"))
                .unwrap_err()
                .error_code,
            "scene_composition_limit"
        );
    }
}
