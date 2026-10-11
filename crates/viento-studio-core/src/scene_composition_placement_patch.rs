//! Author-declared placement offsets are independent of local actor overrides.
#![forbid(unsafe_code)]

use crate::scene_composition::expand;
use crate::scene_composition_patch::{
    append_item, apply_edits, colon, encode, equal, member, remove_items, replace_value,
    SceneCompositionPatchResponse,
};
use crate::scene_source::parse_json_source;
use crate::CoreError;
use serde_json::Value;

fn invalid() -> CoreError {
    CoreError {
        error_code: "scene_composition_invalid",
        message: "Expected one existing placement and a bounded offset pair or null reset.",
    }
}

pub(crate) fn dispatch(request: &Value) -> Result<SceneCompositionPatchResponse, CoreError> {
    let request = request.as_object().ok_or_else(CoreError::request)?;
    let keys = [
        "protocolVersion",
        "operation",
        "content",
        "placementId",
        "offset",
    ];
    if request.len() != keys.len()
        || keys.iter().any(|key| !request.contains_key(*key))
        || request["operation"].as_str() != Some("sceneComposition.editPlacementOffset")
    {
        return Err(CoreError::request());
    }
    let content = request["content"].as_str().ok_or_else(CoreError::request)?;
    let placement_id = request["placementId"].as_str().ok_or_else(invalid)?;
    let offset = &request["offset"];
    if !offset.is_null()
        && !offset.as_array().is_some_and(|pair| {
            pair.len() == 2
                && pair.iter().all(|axis| {
                    axis.as_f64()
                        .is_some_and(|axis| axis.is_finite() && axis.abs() <= 100000.0)
                })
        })
    {
        return Err(invalid());
    }
    // Validate the complete original recipe, including unused fragments, before
    // finding any source span. A reset cannot repair an invalid input silently.
    expand(content)?;
    let source: Value = serde_json::from_str(content.strip_prefix('\u{feff}').unwrap_or(content))
        .map_err(|_| invalid())?;
    let (index, placement) = source["placements"]
        .as_array()
        .ok_or_else(invalid)?
        .iter()
        .enumerate()
        .find(|(_, placement)| placement["placementId"].as_str() == Some(placement_id))
        .ok_or_else(invalid)?;
    let declared = placement.get("offset");
    if offset.is_null() && declared.is_none()
        || !offset.is_null() && declared.is_some_and(|before| equal(before, offset))
    {
        return Ok(SceneCompositionPatchResponse {
            after_content: content.to_owned(),
            changed_paths: vec![],
        });
    }
    let root = parse_json_source(content).map_err(|_| invalid())?;
    let node = &member(&root, "placements")?
        .array()
        .map_err(|_| invalid())?[index];
    let mut edits = Vec::new();
    if offset.is_null() {
        let members = node.object().map_err(|_| invalid())?;
        let spans = members
            .iter()
            .map(|(_, node)| node.member_span.clone().ok_or_else(invalid))
            .collect::<Result<Vec<_>, _>>()?;
        let removed = members
            .iter()
            .map(|(key, _)| key.iter().copied().eq("offset".encode_utf16()))
            .collect::<Vec<_>>();
        edits.extend(remove_items(&spans, &removed));
    } else if let Some(before) = declared {
        replace_value(&mut edits, member(node, "offset")?, before, offset)?;
    } else {
        edits.push(append_item(
            content,
            node,
            format!("\"offset\"{}{}", colon(content, node)?, encode(offset)?),
        )?);
    }
    // Shared token splicing enforces the final UTF-8 budget and expands the
    // complete final scene, including offset-added local override positions.
    let after_content = apply_edits(content, edits)?;
    Ok(SceneCompositionPatchResponse {
        after_content,
        changed_paths: vec![format!("/placements/{index}/offset")],
    })
}
