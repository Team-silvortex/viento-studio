//! Source-preserving management of unplaced fragment definitions.
#![forbid(unsafe_code)]
use crate::scene_composition::expand;
use crate::scene_composition_patch::{
    append_item, apply_edits, member, remove_items, SceneCompositionPatchResponse,
};
use crate::scene_source::{parse_json_source, Node};
use crate::CoreError;
use serde::Serialize;
use serde_json::Value;
use std::collections::HashSet;

fn invalid() -> CoreError {
    CoreError {
        error_code: "scene_composition_invalid",
        message: "Expected an exact fragment definition edit with a distinct local identity.",
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

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DefinitionLocation {
    pub property_path: String,
    pub start: usize,
    pub end: usize,
    pub encoding: &'static str,
    pub exact: bool,
}
#[derive(Debug, Serialize)]
pub struct DefinitionLocationsResponse {
    pub locations: Vec<DefinitionLocation>,
}
fn location_limit() -> CoreError {
    CoreError {
        error_code: "scene_composition_limit",
        message: "Definition location queries exceed their bounded pointer budget.",
    }
}
fn pointer_parts(path: &str) -> Result<Vec<String>, CoreError> {
    if path.is_empty() {
        return Ok(vec![]);
    }
    if !path.starts_with('/') {
        return Err(invalid());
    }
    let mut parts = vec![];
    for part in path[1..].split('/') {
        let mut chars = part.chars();
        while let Some(character) = chars.next() {
            if character == '~' && !matches!(chars.next(), Some('0' | '1')) {
                return Err(invalid());
            }
        }
        parts.push(part.replace("~1", "/").replace("~0", "~"));
    }
    Ok(parts)
}
fn child<'a>(node: &'a Node, part: &str) -> Option<&'a Node> {
    if let Some(value) = node.get(part) {
        return Some(value);
    }
    if part == "0"
        || part.starts_with(|character: char| ('1'..='9').contains(&character))
            && part.bytes().all(|byte| byte.is_ascii_digit())
    {
        node.array().ok()?.get(part.parse::<usize>().ok()?)
    } else {
        None
    }
}
fn locate(root: &Node, parts: &[String], offsets: &[usize]) -> DefinitionLocation {
    let mut node = root;
    let mut nearest = (root, 0);
    for (index, part) in parts.iter().enumerate() {
        let Some(next) = child(node, part) else {
            return location(nearest.0, &parts[..nearest.1], offsets, false);
        };
        node = next;
        if node.array().is_ok() || node.object().is_ok() {
            nearest = (node, index + 1);
        }
    }
    location(node, parts, offsets, true)
}
fn location(node: &Node, parts: &[String], offsets: &[usize], exact: bool) -> DefinitionLocation {
    DefinitionLocation {
        property_path: parts
            .iter()
            .map(|part| format!("/{}", part.replace('~', "~0").replace('/', "~1")))
            .collect(),
        start: offsets[node.span.start],
        end: offsets[node.span.end],
        encoding: "utf-16",
        exact,
    }
}
/// Read-only CST ranges for recipe provenance. Nearest means the nearest
/// existing container, matching the host's JSON source index; never a scalar.
pub(crate) fn inspect_locations(request: &Value) -> Result<DefinitionLocationsResponse, CoreError> {
    let request = request.as_object().ok_or_else(CoreError::request)?;
    let required = ["protocolVersion", "operation", "content", "paths"];
    if request.len() != required.len()
        || required.iter().any(|name| !request.contains_key(*name))
        || request["operation"].as_str() != Some("sceneComposition.inspectDefinitionLocations")
    {
        return Err(CoreError::request());
    }
    let paths = request["paths"].as_array().ok_or_else(CoreError::request)?;
    if paths.len() > 4096 {
        return Err(location_limit());
    }
    let mut unique = HashSet::new();
    let mut parsed_paths = Vec::with_capacity(paths.len());
    for path in paths {
        let path = path.as_str().ok_or_else(CoreError::request)?;
        if path.len() > 4096 {
            return Err(location_limit());
        }
        if !unique.insert(path) {
            return Err(invalid());
        }
        parsed_paths.push(pointer_parts(path)?);
    }
    let content = request["content"].as_str().ok_or_else(CoreError::request)?;
    expand(content)?;
    let root = parse_json_source(content).map_err(|_| invalid())?;
    // CST spans are UTF-8 bytes. Convert every boundary once, including the
    // leading BOM and literal supplementary characters, without rescanning
    // the source for every query.
    let mut offsets = vec![0; content.len() + 1];
    let mut units = 0;
    for (index, character) in content.char_indices() {
        offsets[index] = units;
        units += character.len_utf16();
        offsets[index + character.len_utf8()] = units;
    }
    Ok(DefinitionLocationsResponse {
        locations: parsed_paths
            .iter()
            .map(|parts| locate(&root, parts, &offsets))
            .collect(),
    })
}

pub(crate) fn dispatch(request: &Value) -> Result<SceneCompositionPatchResponse, CoreError> {
    let request = request.as_object().ok_or_else(CoreError::request)?;
    let operation = request
        .get("operation")
        .and_then(Value::as_str)
        .ok_or_else(CoreError::request)?;
    let required: &[&str] = match operation {
        "sceneComposition.addFragmentDefinition" => {
            &["protocolVersion", "operation", "content", "fragment"]
        }
        "sceneComposition.copyFragmentDefinition" => &[
            "protocolVersion",
            "operation",
            "content",
            "sourceFragmentId",
            "fragmentId",
        ],
        "sceneComposition.removeFragmentDefinition" => {
            &["protocolVersion", "operation", "content", "fragmentId"]
        }
        _ => return Err(CoreError::request()),
    };
    if request.len() != required.len() || required.iter().any(|name| !request.contains_key(*name)) {
        return Err(CoreError::request());
    }
    let content = request["content"].as_str().ok_or_else(CoreError::request)?;
    expand(content)?;
    let source: Value = serde_json::from_str(content.strip_prefix('\u{feff}').unwrap_or(content))
        .map_err(|_| invalid())?;
    let fragments = source["fragments"].as_array().ok_or_else(invalid)?;
    let root = parse_json_source(content).map_err(|_| invalid())?;
    let node = member(&root, "fragments")?;
    let nodes = node.array().map_err(|_| invalid())?;
    let id = if operation == "sceneComposition.addFragmentDefinition" {
        key(&request["fragment"]["fragmentId"])?
    } else {
        key(&request["fragmentId"])?
    };
    let (edits, index) = if operation == "sceneComposition.removeFragmentDefinition" {
        if fragments.len() < 2
            || source["placements"]
                .as_array()
                .ok_or_else(invalid)?
                .iter()
                .any(|placement| placement["fragmentId"].as_str() == Some(id))
        {
            return Err(invalid());
        }
        let index = fragments
            .iter()
            .position(|fragment| fragment["fragmentId"].as_str() == Some(id))
            .ok_or_else(invalid)?;
        let spans: Vec<_> = nodes.iter().map(|item| item.span.clone()).collect();
        (
            remove_items(
                &spans,
                &(0..nodes.len())
                    .map(|item| item == index)
                    .collect::<Vec<_>>(),
            ),
            index,
        )
    } else {
        if fragments
            .iter()
            .any(|fragment| fragment["fragmentId"].as_str() == Some(id))
        {
            return Err(invalid());
        }
        let item = if operation == "sceneComposition.copyFragmentDefinition" {
            let original = key(&request["sourceFragmentId"])?;
            let index = fragments
                .iter()
                .position(|fragment| fragment["fragmentId"].as_str() == Some(original))
                .ok_or_else(invalid)?;
            let source_node = &nodes[index];
            let identity = member(source_node, "fragmentId")?;
            format!(
                "{}{}{}",
                &content[source_node.span.start..identity.span.start],
                serde_json::to_string(&request["fragmentId"]).map_err(|_| invalid())?,
                &content[identity.span.end..source_node.span.end]
            )
        } else {
            // Only the new declaration is serialized. The final expansion owns
            // every native actor/group rule, including unused declarations.
            serde_json::to_string(&request["fragment"]).map_err(|_| invalid())?
        };
        (vec![append_item(content, node, item)?], fragments.len())
    };
    Ok(SceneCompositionPatchResponse {
        after_content: apply_edits(content, edits)?,
        changed_paths: vec![format!("/fragments/{index}")],
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
    fn fragment(id: &str) -> Value {
        json!({"fragmentId":id,"actors":[{"key":"hero","objectId":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","position":[10.125,20.25],"useProjectionDefaults":true}],"groups":[]})
    }
    fn add(content: String, declaration: Value) -> Value {
        json!({"protocolVersion":1,"operation":"sceneComposition.addFragmentDefinition","content":content,"fragment":declaration})
    }
    fn copy(content: String, original: &str, id: &str) -> Value {
        json!({"protocolVersion":1,"operation":"sceneComposition.copyFragmentDefinition","content":content,"sourceFragmentId":original,"fragmentId":id})
    }
    fn remove(content: String, id: &str) -> Value {
        json!({"protocolVersion":1,"operation":"sceneComposition.removeFragmentDefinition","content":content,"fragmentId":id})
    }
    fn parsed(content: &str) -> Value {
        serde_json::from_str(content.strip_prefix('\u{feff}').unwrap_or(content)).unwrap()
    }
    #[test]
    fn add_complete_native_definition_leaves_generated_scene_and_placements_unchanged() {
        let mut declaration = fragment("unused");
        declaration["groups"] = json!([{"key":"root","name":"Root"},{"key":"child","name":"Child / 组🦊","parentKey":"root"}]);
        declaration["actors"][0]["groupKey"] = json!("child");
        declaration["actors"][0]["imageResourceId"] = Value::Null;
        let source = text(&recipe());
        let before = expand(&source).unwrap();
        let result = dispatch(&add(source.clone(), declaration.clone())).unwrap();
        let mut expected = recipe();
        expected["fragments"]
            .as_array_mut()
            .unwrap()
            .push(declaration);
        assert_eq!(parsed(&result.after_content), expected);
        assert_eq!(result.changed_paths, ["/fragments/1"]);
        assert_eq!(expand(&result.after_content).unwrap().scene, before.scene);
        let boundary = source.find("\"placements\"").unwrap();
        assert_eq!(
            &result.after_content[result.after_content.find("\"placements\"").unwrap()..],
            &source[boundary..]
        );
        assert!(
            result.after_content.starts_with('\u{feff}')
                && result.after_content.ends_with("\r\n \t")
        );
    }
    #[test]
    fn copy_only_replaces_fragment_identity_value_retaining_every_body_token() {
        let mut value = recipe();
        value["fragments"][0]["actors"][0]["imageResourceId"] = Value::Null;
        value["fragments"][0]["actors"][0]["useProjectionDefaults"] = json!(true);
        let source = text(&value)
            .replacen("\"fragmentId\"", "\"\\u0066ragmentId\"", 1)
            .replacen("120", "1.20e2", 1);
        let root = parse_json_source(&source).unwrap();
        let original = &member(&root, "fragments").unwrap().array().unwrap()[0];
        let identity = member(original, "fragmentId").unwrap();
        let expected = format!(
            "{}\"duplicate\"{}",
            &source[original.span.start..identity.span.start],
            &source[identity.span.end..original.span.end]
        );
        let result = dispatch(&copy(source.clone(), "party", "duplicate")).unwrap();
        let tree = parse_json_source(&result.after_content).unwrap();
        let copied = &member(&tree, "fragments").unwrap().array().unwrap()[1];
        assert_eq!(&result.after_content[copied.span.clone()], expected);
        assert!(result.after_content.contains("1.20e2"));
        assert_eq!(
            expand(&source).unwrap().scene,
            expand(&result.after_content).unwrap().scene
        );
        assert_eq!(result.changed_paths, ["/fragments/1"]);
    }
    #[test]
    fn unplaced_definition_copy_does_not_require_any_instance_maps() {
        let mut value = recipe();
        value["fragments"]
            .as_array_mut()
            .unwrap()
            .push(fragment("unused"));
        let source = text(&value);
        let result = dispatch(&copy(source.clone(), "unused", "duplicate")).unwrap();
        let after = parsed(&result.after_content);
        assert_eq!(
            after["fragments"][2]["actors"],
            value["fragments"][1]["actors"]
        );
        assert_eq!(after["placements"], value["placements"]);
        assert_eq!(
            expand(&source).unwrap().scene,
            expand(&result.after_content).unwrap().scene
        );
    }
    #[test]
    fn remove_first_middle_tail_unused_definition_preserves_other_item_bytes() {
        for index in 0..3 {
            for compact in [true, false] {
                let mut value = recipe();
                let used = value["fragments"][0].clone();
                value["fragments"] = json!([fragment("unused1"), fragment("unused2")]);
                value["fragments"].as_array_mut().unwrap().insert(
                    if index == 0 {
                        2
                    } else if index == 1 {
                        0
                    } else {
                        1
                    },
                    used,
                );
                let original = value["fragments"][index]["fragmentId"]
                    .as_str()
                    .unwrap()
                    .to_owned();
                let source = if compact {
                    serde_json::to_string(&value).unwrap()
                } else {
                    text(&value)
                };
                let before = expand(&source).unwrap();
                let result = dispatch(&remove(source.clone(), &original)).unwrap();
                value["fragments"].as_array_mut().unwrap().remove(index);
                assert_eq!(parsed(&result.after_content), value);
                assert_eq!(result.changed_paths, [format!("/fragments/{index}")]);
                assert_eq!(expand(&result.after_content).unwrap().scene, before.scene);
                let root = parse_json_source(&source).unwrap();
                let tree = parse_json_source(&result.after_content).unwrap();
                let old = member(&root, "fragments").unwrap().array().unwrap();
                let new = member(&tree, "fragments").unwrap().array().unwrap();
                for (i, item) in old.iter().enumerate().filter(|(i, _)| *i != index) {
                    let target = if i < index { i } else { i - 1 };
                    assert_eq!(
                        &source[item.span.clone()],
                        &result.after_content[new[target].span.clone()]
                    );
                }
            }
        }
    }
    #[test]
    fn removing_unused_definition_before_used_fragment_rebuilds_provenance_paths() {
        let mut value = recipe();
        value["fragments"]
            .as_array_mut()
            .unwrap()
            .insert(0, fragment("unused"));
        let source = text(&value);
        let before = expand(&source).unwrap();
        let result = dispatch(&remove(source, "unused")).unwrap();
        let after = expand(&result.after_content).unwrap();
        assert_eq!(before.scene, after.scene);
        assert_eq!(
            before.source_map["actors"][0]["templatePath"],
            "/fragments/1/actors/0"
        );
        assert_eq!(
            after.source_map["actors"][0]["templatePath"],
            "/fragments/0/actors/0"
        );
        assert_eq!(
            before.source_map["actors"][0]["instanceId"],
            after.source_map["actors"][0]["instanceId"]
        );
    }
    #[test]
    fn referenced_missing_last_or_duplicate_id_edits_are_rejected() {
        let source = text(&recipe());
        for input in [
            remove(source.clone(), "party"),
            remove(source.clone(), "absent"),
            add(source.clone(), fragment("party")),
            copy(source.clone(), "party", "party"),
            copy(source.clone(), "missing", "new"),
            copy(source.clone(), "party", "1bad"),
        ] {
            assert_eq!(
                dispatch(&input).unwrap_err().error_code,
                "scene_composition_invalid"
            );
        }
        let mut value = recipe();
        value["fragments"]
            .as_array_mut()
            .unwrap()
            .push(fragment("unused"));
        value["placements"][1]["fragmentId"] = json!("unused");
        value["placements"][1]["actorIds"] = json!({"hero":"cccccccc-cccc-4ccc-8ccc-cccccccccccc"});
        value["placements"][1]["groupIds"] = json!({});
        value["placements"][1]
            .as_object_mut()
            .unwrap()
            .remove("overrides");
        assert_eq!(
            dispatch(&remove(text(&value), "unused"))
                .unwrap_err()
                .error_code,
            "scene_composition_invalid"
        );
    }
    #[test]
    fn exact_requests_and_entire_native_fragment_rules_are_checked_even_without_placements() {
        let source = text(&recipe());
        for mutate in [
            "extra", "actors", "groups", "position", "objectId", "groupKey", "cycle",
        ] {
            let mut declaration = fragment("new");
            match mutate {
                "extra" => {
                    declaration["unknown"] = json!(true);
                }
                "actors" => {
                    declaration["actors"] = json!([]);
                }
                "groups" => {
                    declaration.as_object_mut().unwrap().remove("groups");
                }
                "position" => {
                    declaration["actors"][0]["position"] = json!([100001, 0]);
                }
                "objectId" => {
                    declaration["actors"][0]["objectId"] = json!("bad");
                }
                "groupKey" => {
                    declaration["actors"][0]["groupKey"] = json!("missing");
                }
                _ => {
                    declaration["groups"] = json!([{"key":"g","name":"G","parentKey":"g"}]);
                }
            }
            assert_eq!(
                dispatch(&add(source.clone(), declaration))
                    .unwrap_err()
                    .error_code,
                "scene_composition_invalid"
            );
        }
        for mut input in [
            add(source.clone(), fragment("new")),
            copy(source.clone(), "party", "new"),
            remove(source, "party"),
        ] {
            input["extra"] = json!(true);
            assert_eq!(
                dispatch(&input).unwrap_err().error_code,
                "studio_core_request_invalid"
            );
        }
    }
    #[test]
    fn fragment_and_aggregate_declared_actor_group_limits_include_unused_copies() {
        let mut value = recipe();
        for n in 1..32 {
            value["fragments"]
                .as_array_mut()
                .unwrap()
                .push(fragment(&format!("f{n}")));
        }
        assert_eq!(
            dispatch(&add(text(&value), fragment("extra")))
                .unwrap_err()
                .error_code,
            "scene_composition_limit"
        );
        assert_eq!(
            dispatch(&copy(text(&value), "f1", "extra"))
                .unwrap_err()
                .error_code,
            "scene_composition_limit"
        );
        let mut value = recipe();
        let mut unused = fragment("unused");
        let actor = unused["actors"][0].clone();
        unused["actors"] = Value::Array(
            (0..126)
                .map(|n| {
                    let mut a = actor.clone();
                    a["key"] = json!(format!("a{n}"));
                    a
                })
                .collect(),
        );
        value["fragments"].as_array_mut().unwrap().push(unused);
        assert_eq!(
            dispatch(&add(text(&value), fragment("extra")))
                .unwrap_err()
                .error_code,
            "scene_composition_limit"
        );
        assert_eq!(
            dispatch(&copy(text(&value), "party", "extra"))
                .unwrap_err()
                .error_code,
            "scene_composition_limit"
        );
        value["fragments"][1]["actors"] = json!([actor]);
        value["fragments"][1]["groups"] = Value::Array(
            (0..126)
                .map(|n| json!({"key":format!("g{n}"),"name":format!("G{n}")}))
                .collect(),
        );
        assert_eq!(
            dispatch(&copy(text(&value), "party", "extra"))
                .unwrap_err()
                .error_code,
            "scene_composition_limit"
        );
    }
    #[test]
    fn final_source_budget_rejects_growth_but_allows_whole_definition_shrink() {
        let mut value = recipe();
        value["fragments"]
            .as_array_mut()
            .unwrap()
            .push(fragment("unused"));
        let mut source = text(&value);
        source.push_str(&" ".repeat(128 * 1024 - source.len()));
        assert_eq!(
            dispatch(&add(source.clone(), fragment("extra")))
                .unwrap_err()
                .error_code,
            "scene_composition_limit"
        );
        assert_eq!(
            dispatch(&copy(source.clone(), "unused", "extra"))
                .unwrap_err()
                .error_code,
            "scene_composition_limit"
        );
        assert!(
            dispatch(&remove(source, "unused"))
                .unwrap()
                .after_content
                .len()
                < 128 * 1024
        );
    }
    #[test]
    fn invalid_original_duplicate_keys_and_unrelated_unused_declarations_cannot_be_bypassed() {
        let source = text(&recipe()).replacen(
            "\"schemaVersion\": 1",
            "\"schemaVersion\": 1, \"schemaVersion\": 1",
            1,
        );
        assert_eq!(
            dispatch(&copy(source, "party", "new"))
                .unwrap_err()
                .error_code,
            "scene_composition_invalid"
        );
        let mut value = recipe();
        let mut unused = fragment("unused");
        unused["actors"][0]["size"] = json!([0, 32]);
        value["fragments"].as_array_mut().unwrap().push(unused);
        assert_eq!(
            dispatch(&remove(text(&value), "unused"))
                .unwrap_err()
                .error_code,
            "scene_composition_invalid"
        );
    }

    fn inspect(content: String, paths: Value) -> Value {
        json!({"protocolVersion":1,"operation":"sceneComposition.inspectDefinitionLocations","content":content,"paths":paths})
    }
    #[test]
    fn read_only_locations_convert_bom_crlf_multilingual_and_emoji_boundaries_to_utf16() {
        let mut value = recipe();
        value["scene"]["title"] = json!("中文 / 日本語 / 🦊");
        let content = text(&value)
            .replacen("\"fragmentId\"", "\"\\u0066ragmentId\"", 1)
            .replacen("120", "1.20e2", 1);
        let result = inspect_locations(&inspect(
            content.clone(),
            json!([
                "",
                "/scene/title",
                "/fragments/0/fragmentId",
                "/fragments/0/actors/0/position/0"
            ]),
        ))
        .unwrap();
        assert_eq!(result.locations.len(), 4);
        assert_eq!(result.locations[0].start, 1);
        assert_eq!(
            result.locations[0].end,
            content[..content.rfind('}').unwrap() + 1]
                .encode_utf16()
                .count()
        );
        let title = serde_json::to_string(&value["scene"]["title"]).unwrap();
        let start = content.find(&title).unwrap();
        assert_eq!(
            result.locations[1].start,
            content[..start].encode_utf16().count()
        );
        assert_eq!(
            result.locations[1].end,
            content[..start + title.len()].encode_utf16().count()
        );
        assert!(result
            .locations
            .iter()
            .all(|range| range.exact && range.encoding == "utf-16"));
        assert_eq!(result.locations[2].property_path, "/fragments/0/fragmentId");
        let exponent = content.find("1.20e2").unwrap();
        assert_eq!(
            result.locations[3].start,
            content[..exponent].encode_utf16().count()
        );
        assert_eq!(result.locations[3].end, result.locations[3].start + 6);
    }
    #[test]
    fn nearest_locations_fall_back_to_existing_containers_with_canonical_array_keys() {
        let paths = json!([
            "/missing",
            "/scene/title/missing",
            "/fragments/0/actors/0/position/00",
            "/fragments/0/actors/0/position/0/missing",
            "/fragments/999999999999999999999999999999999999",
            "/fragments/-",
            "/fragments/0/actors/0/unknown/~0~1"
        ]);
        let result = inspect_locations(&inspect(text(&recipe()), paths)).unwrap();
        let actual: Vec<_> = result
            .locations
            .iter()
            .map(|range| (range.property_path.as_str(), range.exact))
            .collect();
        assert_eq!(
            actual,
            vec![
                ("", false),
                ("/scene", false),
                ("/fragments/0/actors/0/position", false),
                ("/fragments/0/actors/0/position", false),
                ("/fragments", false),
                ("/fragments", false),
                ("/fragments/0/actors/0", false)
            ]
        );
    }
    #[test]
    fn location_requests_are_exact_unique_and_bounded_without_relaxing_recipe_rules() {
        let content = text(&recipe());
        for paths in [
            json!(["bad"]),
            json!(["/~2"]),
            json!(["/~"]),
            json!(["/scene", "/scene"]),
        ] {
            assert_eq!(
                inspect_locations(&inspect(content.clone(), paths))
                    .unwrap_err()
                    .error_code,
                "scene_composition_invalid"
            );
        }
        assert!(inspect_locations(&inspect(content.clone(), json!([])))
            .unwrap()
            .locations
            .is_empty());
        let paths = Value::Array((0..4096).map(|n| json!(format!("/absent{n}"))).collect());
        assert_eq!(
            inspect_locations(&inspect(content.clone(), paths))
                .unwrap()
                .locations
                .len(),
            4096
        );
        let too_many = Value::Array((0..4097).map(|n| json!(format!("/absent{n}"))).collect());
        assert_eq!(
            inspect_locations(&inspect(content.clone(), too_many))
                .unwrap_err()
                .error_code,
            "scene_composition_limit"
        );
        assert_eq!(
            inspect_locations(&inspect(
                content.clone(),
                json!([format!("/{}", "x".repeat(4096))])
            ))
            .unwrap_err()
            .error_code,
            "scene_composition_limit"
        );
        for paths in [json!(null), json!([1])] {
            assert_eq!(
                inspect_locations(&inspect(content.clone(), paths))
                    .unwrap_err()
                    .error_code,
                "studio_core_request_invalid"
            );
        }
        let mut extra = inspect(content.clone(), json!([""]));
        extra["nearest"] = json!(true);
        assert_eq!(
            inspect_locations(&extra).unwrap_err().error_code,
            "studio_core_request_invalid"
        );
        let duplicate = content.replacen(
            "\"schemaVersion\": 1",
            "\"schemaVersion\": 1, \"schemaVersion\": 1",
            1,
        );
        assert_eq!(
            inspect_locations(&inspect(duplicate, json!([])))
                .unwrap_err()
                .error_code,
            "scene_composition_invalid"
        );
    }
}
