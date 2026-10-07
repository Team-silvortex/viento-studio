//! Stateless expansion of an explicit, single-file recipe into ordinary Scene2D v3.
//! No filesystem, project registration, derived identifiers, or draft allocation.
#![forbid(unsafe_code)]

use crate::{scene_source::validate_json_source, CoreError};
use serde::Serialize;
use serde_json::{json, Map, Value};
use std::collections::{HashMap, HashSet};

const MAX_BYTES: usize = 128 * 1024;
const MAX_ACTORS: usize = 128;
const MAX_GROUPS: usize = 128;
const MAX_GROUP_DEPTH: usize = 16;
pub(crate) const ACTOR_VALUES: &[&str] = &[
    "position",
    "size",
    "color",
    "speed",
    "controls",
    "imageResourceId",
];

fn invalid() -> CoreError {
    CoreError {
        error_code: "scene_composition_invalid",
        message:
            "Expected a valid scene composition recipe with explicit identities and references.",
    }
}
fn limit() -> CoreError {
    CoreError {
        error_code: "scene_composition_limit",
        message: "The composition exceeds its source, fragment, placement, actor, or group budget.",
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SceneCompositionResponse {
    pub scene: Value,
    pub source_map: Value,
}

fn shape<'a>(
    value: &'a Value,
    required: &[&str],
    optional: &[&str],
) -> Result<&'a Map<String, Value>, CoreError> {
    let map = value.as_object().ok_or_else(invalid)?;
    if required.iter().any(|key| !map.contains_key(*key))
        || map
            .keys()
            .any(|key| !required.contains(&key.as_str()) && !optional.contains(&key.as_str()))
    {
        return Err(invalid());
    }
    Ok(map)
}
fn string(value: &Value) -> Result<&str, CoreError> {
    value.as_str().ok_or_else(invalid)
}
fn key(value: &Value) -> Result<&str, CoreError> {
    let value = string(value)?;
    if !(1..=64).contains(&value.len())
        || !value.as_bytes()[0].is_ascii_alphabetic()
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
    {
        return Err(invalid());
    }
    Ok(value)
}
fn uuid(value: &Value) -> Result<&str, CoreError> {
    let value = string(value)?;
    if value.len() != 36
        || !value.bytes().enumerate().all(|(index, byte)| {
            if [8, 13, 18, 23].contains(&index) {
                byte == b'-'
            } else {
                byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte)
            }
        })
    {
        return Err(invalid());
    }
    Ok(value)
}
fn js_whitespace(character: char) -> bool {
    matches!(character as u32, 9..=13 | 32 | 0xa0 | 0x1680 | 0x2000..=0x200a | 0x2028 | 0x2029 | 0x202f | 0x205f | 0x3000 | 0xfeff)
}
fn name(value: &Value, reject_delete: bool) -> Result<(), CoreError> {
    let value = string(value)?;
    if value.encode_utf16().count() > 160
        || !value.chars().any(|character| !js_whitespace(character))
        || value
            .chars()
            .any(|character| character <= '\u{1f}' || (reject_delete && character == '\u{7f}'))
    {
        return Err(invalid());
    }
    Ok(())
}
fn number(value: &Value, min: f64, max: f64) -> Result<f64, CoreError> {
    let number = value.as_f64().ok_or_else(invalid)?;
    if !number.is_finite() || !(min..=max).contains(&number) {
        return Err(invalid());
    }
    Ok(number)
}
fn pair(value: &Value, min: f64, max: f64) -> Result<[f64; 2], CoreError> {
    let values = value.as_array().ok_or_else(invalid)?;
    if values.len() != 2 {
        return Err(invalid());
    }
    Ok([number(&values[0], min, max)?, number(&values[1], min, max)?])
}
fn color(value: &Value) -> Result<(), CoreError> {
    let value = string(value)?;
    if ![7, 9].contains(&value.len())
        || !value.starts_with('#')
        || !value.as_bytes()[1..].iter().all(u8::is_ascii_hexdigit)
    {
        return Err(invalid());
    }
    Ok(())
}
fn actor_values(actor: &Map<String, Value>) -> Result<(), CoreError> {
    let inherit = match actor.get("useProjectionDefaults") {
        None => false,
        Some(value) => value.as_bool().ok_or_else(invalid)?,
    };
    pair(&actor["position"], -100_000.0, 100_000.0)?;
    for field in ["size", "color", "speed", "controls"] {
        if !inherit && !actor.contains_key(field) {
            return Err(invalid());
        }
    }
    if let Some(value) = actor.get("size") {
        pair(value, 1.0, 2048.0)?;
    }
    if let Some(value) = actor.get("color") {
        color(value)?;
    }
    if let Some(value) = actor.get("speed") {
        number(value, 0.0, 2000.0)?;
    }
    if let Some(value) = actor.get("controls") {
        if !matches!(value.as_str(), Some("arrows" | "none")) {
            return Err(invalid());
        }
    }
    if let Some(value) = actor.get("imageResourceId") {
        if !(inherit && value.is_null()) {
            uuid(value)?;
        }
    }
    Ok(())
}

struct Fragment {
    id: String,
    actors: Vec<Map<String, Value>>,
    groups: Vec<Map<String, Value>>,
}
fn fragment(value: &Value) -> Result<Fragment, CoreError> {
    let value = shape(value, &["fragmentId", "actors", "groups"], &[])?;
    let id = key(&value["fragmentId"])?;
    let actors = value["actors"].as_array().ok_or_else(invalid)?;
    let groups = value["groups"].as_array().ok_or_else(invalid)?;
    if actors.is_empty() {
        return Err(invalid());
    }
    if actors.len() > MAX_ACTORS || groups.len() > MAX_GROUPS {
        return Err(limit());
    }
    let mut group_keys = HashMap::new();
    let mut parsed_groups = Vec::with_capacity(groups.len());
    for group in groups {
        let group = shape(group, &["key", "name"], &["parentKey"])?;
        let local_key = key(&group["key"])?;
        name(&group["name"], true)?;
        let parent = group.get("parentKey").map(key).transpose()?;
        if group_keys.insert(local_key, parent).is_some() {
            return Err(invalid());
        }
        parsed_groups.push(group.clone());
    }
    for local_key in group_keys.keys() {
        let mut cursor = Some(*local_key);
        let mut seen = HashSet::new();
        while let Some(current) = cursor {
            if !seen.insert(current) || seen.len() > MAX_GROUP_DEPTH {
                return Err(invalid());
            }
            cursor = *group_keys.get(current).ok_or_else(invalid)?;
        }
    }
    let mut actor_keys = HashSet::new();
    let mut parsed_actors = Vec::with_capacity(actors.len());
    for actor in actors {
        let actor = shape(
            actor,
            &["key", "objectId", "position"],
            &[
                "groupKey",
                "size",
                "color",
                "speed",
                "controls",
                "imageResourceId",
                "useProjectionDefaults",
            ],
        )?;
        if !actor_keys.insert(key(&actor["key"])?) {
            return Err(invalid());
        }
        uuid(&actor["objectId"])?;
        actor_values(actor)?;
        if let Some(group) = actor.get("groupKey") {
            if !group_keys.contains_key(key(group)?) {
                return Err(invalid());
            }
        }
        parsed_actors.push(actor.clone());
    }
    Ok(Fragment {
        id: id.to_owned(),
        actors: parsed_actors,
        groups: parsed_groups,
    })
}

struct Placement {
    id: String,
    fragment_index: usize,
    actor_ids: Map<String, Value>,
    group_ids: Map<String, Value>,
    offset: [f64; 2],
    has_offset: bool,
    overrides: HashMap<String, (usize, Map<String, Value>)>,
}
fn identity_map(
    value: &Value,
    templates: &[Map<String, Value>],
    identities: &mut HashSet<String>,
) -> Result<Map<String, Value>, CoreError> {
    let value = value.as_object().ok_or_else(invalid)?;
    if value.len() != templates.len() {
        return Err(invalid());
    }
    for template in templates {
        let id = uuid(value.get(string(&template["key"])?).ok_or_else(invalid)?)?;
        if !identities.insert(id.to_owned()) {
            return Err(invalid());
        }
    }
    Ok(value.clone())
}
fn effective_actor(actor: &Map<String, Value>, placement: &Placement) -> Map<String, Value> {
    let mut effective = actor.clone();
    if let Some((_, overrides)) = placement.overrides.get(actor["key"].as_str().unwrap()) {
        effective.extend(overrides.clone());
    }
    effective
}
fn final_position(
    effective: &Map<String, Value>,
    placement: &Placement,
) -> Result<[f64; 2], CoreError> {
    let local = pair(&effective["position"], -100_000.0, 100_000.0)?;
    let position = [
        local[0] + placement.offset[0],
        local[1] + placement.offset[1],
    ];
    if position
        .iter()
        .any(|coordinate| !coordinate.is_finite() || coordinate.abs() > 100_000.0)
    {
        return Err(invalid());
    }
    Ok(position)
}
fn placement(
    value: &Value,
    fragments: &[Fragment],
    fragment_indices: &HashMap<String, usize>,
    placement_ids: &mut HashSet<String>,
    generated_ids: &mut HashSet<String>,
) -> Result<Placement, CoreError> {
    let value = shape(
        value,
        &["placementId", "fragmentId", "actorIds", "groupIds"],
        &["offset", "overrides"],
    )?;
    let id = uuid(&value["placementId"])?;
    if !placement_ids.insert(id.to_owned()) {
        return Err(invalid());
    }
    let fragment_index = *fragment_indices
        .get(key(&value["fragmentId"])?)
        .ok_or_else(invalid)?;
    let fragment = &fragments[fragment_index];
    let actor_ids = identity_map(&value["actorIds"], &fragment.actors, generated_ids)?;
    let group_ids = identity_map(&value["groupIds"], &fragment.groups, generated_ids)?;
    let offset = value
        .get("offset")
        .map(|value| pair(value, -100_000.0, 100_000.0))
        .transpose()?
        .unwrap_or([0.0; 2]);
    let mut overrides = HashMap::new();
    if let Some(values) = value.get("overrides") {
        let values = values.as_array().ok_or_else(invalid)?;
        if values.len() > fragment.actors.len() {
            return Err(invalid());
        }
        for (index, override_value) in values.iter().enumerate() {
            let override_value = shape(override_value, &["actorKey", "values"], &[])?;
            let actor_key = key(&override_value["actorKey"])?;
            if !actor_ids.contains_key(actor_key) {
                return Err(invalid());
            }
            let values = shape(&override_value["values"], &[], ACTOR_VALUES)?;
            if values.is_empty()
                || overrides
                    .insert(actor_key.to_owned(), (index, values.clone()))
                    .is_some()
            {
                return Err(invalid());
            }
        }
    }
    let placement = Placement {
        id: id.to_owned(),
        fragment_index,
        actor_ids,
        group_ids,
        offset,
        has_offset: value.contains_key("offset"),
        overrides,
    };
    // Validate the complete batch before generating any output or source map.
    for actor in &fragment.actors {
        let effective = effective_actor(actor, &placement);
        actor_values(&effective)?;
        final_position(&effective, &placement)?;
    }
    Ok(placement)
}

pub(crate) fn expand(content: &str) -> Result<SceneCompositionResponse, CoreError> {
    if content.len() > MAX_BYTES {
        return Err(limit());
    }
    validate_json_source(content).map_err(|_| invalid())?;
    // Unlike source patching, recipes require valid Unicode and finite JSON numbers.
    let source: Value = serde_json::from_str(content.strip_prefix('\u{feff}').unwrap_or(content))
        .map_err(|_| invalid())?;
    let source = shape(
        &source,
        &[
            "format",
            "schemaVersion",
            "scene",
            "fragments",
            "placements",
        ],
        &[],
    )?;
    if source["format"] != "viento-scene-composition"
        || source["schemaVersion"].as_f64() != Some(1.0)
    {
        return Err(invalid());
    }
    let scene = shape(&source["scene"], &["title", "viewport", "background"], &[])?;
    name(&scene["title"], false)?;
    let viewport = pair(&scene["viewport"], 64.0, 4096.0)?;
    if viewport.iter().any(|dimension| dimension.fract() != 0.0) {
        return Err(invalid());
    }
    color(&scene["background"])?;
    let fragment_values = source["fragments"].as_array().ok_or_else(invalid)?;
    let placement_values = source["placements"].as_array().ok_or_else(invalid)?;
    if fragment_values.is_empty() || placement_values.is_empty() {
        return Err(invalid());
    }
    if fragment_values.len() > 32 || placement_values.len() > 128 {
        return Err(limit());
    }
    let mut fragments = Vec::with_capacity(fragment_values.len());
    let mut fragment_indices = HashMap::new();
    let (mut declared_actors, mut declared_groups) = (0, 0);
    for value in fragment_values {
        let fragment = fragment(value)?;
        if fragment_indices
            .insert(fragment.id.clone(), fragments.len())
            .is_some()
        {
            return Err(invalid());
        }
        declared_actors += fragment.actors.len();
        declared_groups += fragment.groups.len();
        if declared_actors > MAX_ACTORS || declared_groups > MAX_GROUPS {
            return Err(limit());
        }
        fragments.push(fragment);
    }
    let mut placements = Vec::with_capacity(placement_values.len());
    let mut placement_ids = HashSet::new();
    let mut generated_ids = HashSet::new();
    let (mut actor_count, mut group_count) = (0, 0);
    for value in placement_values {
        let placement = placement(
            value,
            &fragments,
            &fragment_indices,
            &mut placement_ids,
            &mut generated_ids,
        )?;
        actor_count += fragments[placement.fragment_index].actors.len();
        group_count += fragments[placement.fragment_index].groups.len();
        if actor_count > MAX_ACTORS || group_count > MAX_GROUPS {
            return Err(limit());
        }
        placements.push(placement);
    }

    let mut actors = Vec::with_capacity(actor_count);
    let mut groups = Vec::with_capacity(group_count);
    let mut actor_sources = Vec::with_capacity(actor_count);
    let mut group_sources = Vec::with_capacity(group_count);
    for (placement_index, placement) in placements.iter().enumerate() {
        let fragment = &fragments[placement.fragment_index];
        let placement_path = format!("/placements/{placement_index}");
        for (actor_index, actor) in fragment.actors.iter().enumerate() {
            let local_key = actor["key"].as_str().unwrap();
            let template_path = format!(
                "/fragments/{}/actors/{actor_index}",
                placement.fragment_index
            );
            let identity_path = format!("{placement_path}/actorIds/{local_key}");
            let instance_id = placement.actor_ids[local_key].clone();
            let effective = effective_actor(actor, placement);
            let mut fields = Map::new();
            let mut output = Map::new();
            output.insert("instanceId".to_owned(), instance_id.clone());
            for (field, value) in &effective {
                if ["key", "groupKey"].contains(&field.as_str()) {
                    continue;
                }
                let origin = match placement.overrides.get(local_key) {
                    Some((index, values)) if values.contains_key(field) => {
                        format!("{placement_path}/overrides/{index}/values/{field}")
                    }
                    _ => format!("{template_path}/{field}"),
                };
                let mut pointers = vec![origin];
                let value = if field == "position" {
                    if placement.has_offset {
                        pointers.push(format!("{placement_path}/offset"));
                    }
                    json!(final_position(&effective, placement)?)
                } else {
                    value.clone()
                };
                output.insert(field.clone(), value);
                fields.insert(field.clone(), json!(pointers));
            }
            if let Some(group_key) = actor.get("groupKey") {
                let group_key = group_key.as_str().unwrap();
                output.insert("groupId".to_owned(), placement.group_ids[group_key].clone());
                fields.insert(
                    "groupId".to_owned(),
                    json!([
                        format!("{template_path}/groupKey"),
                        format!("{placement_path}/groupIds/{group_key}")
                    ]),
                );
            }
            actors.push(Value::Object(output));
            actor_sources.push(json!({
                "instanceId": instance_id, "placementId": placement.id, "fragmentId": fragment.id,
                "localKey": local_key, "templatePath": template_path, "placementPath": placement_path,
                "identityPath": identity_path, "fields": fields,
            }));
        }
        for (group_index, group) in fragment.groups.iter().enumerate() {
            let local_key = group["key"].as_str().unwrap();
            let template_path = format!(
                "/fragments/{}/groups/{group_index}",
                placement.fragment_index
            );
            let group_id = placement.group_ids[local_key].clone();
            let mut output = json!({"groupId": group_id, "name": group["name"]});
            let mut fields = json!({"name": [format!("{template_path}/name")]});
            if let Some(parent_key) = group.get("parentKey") {
                let parent_key = parent_key.as_str().unwrap();
                output["parentGroupId"] = placement.group_ids[parent_key].clone();
                fields["parentGroupId"] = json!([
                    format!("{template_path}/parentKey"),
                    format!("{placement_path}/groupIds/{parent_key}")
                ]);
            }
            groups.push(output);
            group_sources.push(json!({
                "groupId": group_id, "placementId": placement.id, "fragmentId": fragment.id,
                "localKey": local_key, "templatePath": template_path, "placementPath": placement_path,
                "identityPath": format!("{placement_path}/groupIds/{local_key}"), "fields": fields,
            }));
        }
    }
    let scene = json!({
        "format": "viento-scene2d", "schemaVersion": 3, "title": scene["title"],
        "viewport": scene["viewport"], "background": scene["background"], "actors": actors, "groups": groups,
    });
    if serde_json::to_vec(&scene).map_err(|_| invalid())?.len() > MAX_BYTES {
        return Err(limit());
    }
    Ok(SceneCompositionResponse {
        scene,
        source_map: json!({
            "format": "viento-scene-composition-map", "schemaVersion": 1,
            "actors": actor_sources, "groups": group_sources,
        }),
    })
}

pub(crate) fn dispatch(request: &Value) -> Result<SceneCompositionResponse, CoreError> {
    let request = shape(request, &["protocolVersion", "operation", "content"], &[])
        .map_err(|_| CoreError::request())?;
    expand(request["content"].as_str().ok_or_else(CoreError::request)?)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn id(number: usize) -> String {
        format!("00000000-0000-0000-0000-{number:012x}")
    }
    fn recipe() -> Value {
        json!({
            "format":"viento-scene-composition", "schemaVersion":1,
            "scene":{"title":"Composition 测试", "viewport":[640,480], "background":"#aabbcc"},
            "fragments":[{
                "fragmentId":"squad", "actors":[{
                    "key":"hero", "objectId":id(1), "position":[10,20], "groupKey":"child",
                    "size":[32,32], "color":"#ABCDEF80", "speed":150, "controls":"arrows"
                }],
                "groups":[{"key":"root","name":"Squad"},{"key":"child","name":"Unit","parentKey":"root"}]
            }],
            "placements":[{
                "placementId":id(10), "fragmentId":"squad", "actorIds":{"hero":id(11)},
                "groupIds":{"root":id(12),"child":id(13)}, "offset":[100,200],
                "overrides":[{"actorKey":"hero","values":{"position":[30,40],"speed":180}}]
            }]
        })
    }
    fn run(value: &Value) -> SceneCompositionResponse {
        expand(&value.to_string()).unwrap()
    }
    fn invalid_recipe(value: &Value) {
        assert_eq!(
            expand(&value.to_string()).unwrap_err().error_code,
            "scene_composition_invalid"
        );
    }
    fn duplicate_placement(value: &mut Value) {
        let mut placement = value["placements"][0].clone();
        placement["placementId"] = json!(id(20));
        placement["actorIds"]["hero"] = json!(id(21));
        placement["groupIds"]["root"] = json!(id(22));
        placement["groupIds"]["child"] = json!(id(23));
        placement.as_object_mut().unwrap().remove("overrides");
        placement.as_object_mut().unwrap().remove("offset");
        value["placements"].as_array_mut().unwrap().push(placement);
    }

    #[test]
    fn expansion_is_v3_and_source_map_tracks_composite_and_identity_fields() {
        let result = run(&recipe());
        let actor = &result.scene["actors"][0];
        assert_eq!(actor["position"], json!([130.0, 240.0]));
        assert_eq!(actor["instanceId"], id(11));
        assert_eq!(actor["objectId"], id(1));
        assert_eq!(actor["groupId"], id(13));
        assert_eq!(actor["speed"], 180);
        assert!(actor.get("key").is_none() && actor.get("groupKey").is_none());
        assert_eq!(result.scene["schemaVersion"], 3);
        assert_eq!(result.scene.as_object().unwrap().len(), 7);
        assert_eq!(
            result.source_map["actors"][0]["fields"]["position"],
            json!([
                "/placements/0/overrides/0/values/position",
                "/placements/0/offset"
            ])
        );
        assert_eq!(
            result.source_map["actors"][0]["fields"]["groupId"],
            json!([
                "/fragments/0/actors/0/groupKey",
                "/placements/0/groupIds/child"
            ])
        );
        assert_eq!(
            result.source_map["groups"][1]["fields"]["parentGroupId"],
            json!([
                "/fragments/0/groups/1/parentKey",
                "/placements/0/groupIds/root"
            ])
        );
        assert!(result.source_map["actors"][0]["fields"]
            .get("instanceId")
            .is_none());
        assert!(result.source_map["groups"][0]["fields"]
            .get("groupId")
            .is_none());
        assert_eq!(
            result.source_map["actors"][0]["identityPath"],
            "/placements/0/actorIds/hero"
        );
        // Output is accepted by the existing source validator, without extending Scene2D.
        let inspected = crate::dispatch_json(&serde_json::to_vec(&json!({
            "protocolVersion":1,"operation":"sceneSource.inspect","content":result.scene.to_string()
        })).unwrap());
        assert_eq!(
            serde_json::from_slice::<Value>(&inspected).unwrap()["ok"],
            true
        );
    }

    #[test]
    fn overrides_are_local_and_stable_explicit_ids_survive_reordering() {
        let mut value = recipe();
        duplicate_placement(&mut value);
        let original = run(&value);
        assert_eq!(original.scene["actors"][1]["position"], json!([10.0, 20.0]));
        assert_eq!(original.scene["actors"][1]["speed"], 150);
        assert_eq!(
            original.source_map["actors"][1]["fields"]["position"],
            json!(["/fragments/0/actors/0/position"])
        );
        value["placements"].as_array_mut().unwrap().reverse();
        let reordered = run(&value);
        assert_eq!(original.scene["actors"][0], reordered.scene["actors"][1]);
        assert_eq!(original.scene["groups"][0], reordered.scene["groups"][2]);
        assert_eq!(
            reordered.source_map["actors"][1]["placementPath"],
            "/placements/1"
        );
        let mut unused = value["fragments"][0].clone();
        unused["fragmentId"] = json!("unused");
        value["fragments"].as_array_mut().unwrap().insert(0, unused);
        let added = run(&value);
        assert_eq!(added.scene, reordered.scene);
        assert_eq!(
            added.source_map["actors"][0]["templatePath"],
            "/fragments/1/actors/0"
        );
    }

    #[test]
    fn inherited_image_null_and_absence_stay_distinct() {
        let mut value = recipe();
        let actor = value["fragments"][0]["actors"][0].as_object_mut().unwrap();
        actor.insert("useProjectionDefaults".to_owned(), json!(true));
        for field in ["size", "color", "speed", "controls"] {
            actor.remove(field);
        }
        value["placements"][0]
            .as_object_mut()
            .unwrap()
            .remove("overrides");
        duplicate_placement(&mut value);
        value["placements"][1]["overrides"] =
            json!([{"actorKey":"hero","values":{"imageResourceId":null}}]);
        let result = run(&value);
        assert!(result.scene["actors"][0].get("imageResourceId").is_none());
        assert!(result.scene["actors"][1]["imageResourceId"].is_null());
        assert_eq!(
            result.source_map["actors"][1]["fields"]["imageResourceId"],
            json!(["/placements/1/overrides/0/values/imageResourceId"])
        );
        value["fragments"][0]["actors"][0]["useProjectionDefaults"] = json!(false);
        invalid_recipe(&value);
        let mut value = recipe();
        value["placements"][0]["overrides"][0]["values"]["imageResourceId"] = Value::Null;
        invalid_recipe(&value);
    }

    #[test]
    fn strict_scanner_rejects_decoded_duplicates_and_bad_json_everywhere() {
        let source = recipe().to_string();
        for bad in [
            source.replacen(
                "\"format\":",
                "\"format\":\"viento-scene-composition\",\"for\\u006dat\":",
                1,
            ),
            source.replacen(
                "\"position\":[10,20]",
                "\"position\":[10,20],\"pos\\u0069tion\":[10,20]",
                1,
            ),
            source.replacen(
                "\"hero\":",
                "\"he\\u0072o\":\"00000000-0000-0000-0000-000000000099\",\"hero\":",
                1,
            ),
            format!("{source} false"),
            source.replacen("[640,480]", "[640,480,]", 1),
            source.replacen("[640,480]", "[0640,480]", 1),
            source.replacen("[640,480]", "[1e400,480]", 1),
            source.replacen("Composition 测试", "\\ud800", 1),
        ] {
            assert_eq!(
                expand(&bad).unwrap_err().error_code,
                "scene_composition_invalid",
                "{bad}"
            );
        }
        assert_eq!(
            expand(&format!("\u{feff}{source}\r\n")).unwrap().scene,
            run(&recipe()).scene
        );
    }

    #[test]
    fn request_has_exact_shape_and_does_not_extend_protocol() {
        let request = json!({"protocolVersion":1,"operation":"sceneComposition.expand","content":recipe().to_string()});
        let response: Value =
            serde_json::from_slice(&crate::dispatch_json(request.to_string().as_bytes())).unwrap();
        assert_eq!(response["ok"], true);
        assert_eq!(response.as_object().unwrap().len(), 3);
        assert_eq!(response["composition"].as_object().unwrap().len(), 2);
        assert_eq!(crate::viento_core_scene_composition_version(), 1);
        for field in ["unexpected", "scene", "changes"] {
            let mut bad = request.clone();
            bad[field] = Value::Null;
            let response: Value =
                serde_json::from_slice(&crate::dispatch_json(bad.to_string().as_bytes())).unwrap();
            assert_eq!(response["errorCode"], "studio_core_request_invalid");
        }
        let mut bad = request;
        bad["content"] = json!({});
        assert_eq!(
            dispatch(&bad).unwrap_err().error_code,
            "studio_core_request_invalid"
        );
    }

    #[test]
    fn unknown_fields_and_invalid_unused_fragments_cannot_hide() {
        for pointer in [
            "",
            "/scene",
            "/fragments/0",
            "/fragments/0/actors/0",
            "/fragments/0/groups/0",
            "/placements/0",
            "/placements/0/overrides/0",
            "/placements/0/overrides/0/values",
        ] {
            let mut value = recipe();
            value
                .pointer_mut(pointer)
                .unwrap()
                .as_object_mut()
                .unwrap()
                .insert("unexpected".to_owned(), json!(true));
            invalid_recipe(&value);
        }
        let mut value = recipe();
        let mut unused = value["fragments"][0].clone();
        unused["fragmentId"] = json!("unused");
        unused["actors"][0]["objectId"] = json!("invalid");
        value["fragments"].as_array_mut().unwrap().push(unused);
        invalid_recipe(&value);
    }

    #[test]
    fn identity_maps_are_complete_unique_and_cross_domain_disjoint() {
        for (pointer, replacement) in [
            ("/placements/0/actorIds", json!({})),
            ("/placements/0/actorIds", json!({"other":id(11)})),
            (
                "/placements/0/actorIds",
                json!({"hero":id(11),"extra":id(15)}),
            ),
            ("/placements/0/groupIds", json!({"root":id(12)})),
            ("/placements/0/groupIds/child", json!(id(11))),
            ("/placements/0/groupIds/child", json!(id(12))),
            (
                "/placements/0/actorIds/hero",
                json!("00000000-0000-0000-0000-0000000000AB"),
            ),
        ] {
            let mut value = recipe();
            *value.pointer_mut(pointer).unwrap() = replacement;
            invalid_recipe(&value);
        }
        for pointer in [
            "/placements/1/placementId",
            "/placements/1/actorIds/hero",
            "/placements/1/groupIds/root",
        ] {
            let mut value = recipe();
            duplicate_placement(&mut value);
            let first = value
                .pointer(&pointer.replace("/1/", "/0/"))
                .unwrap()
                .clone();
            *value.pointer_mut(pointer).unwrap() = first;
            invalid_recipe(&value);
        }
    }

    #[test]
    fn group_references_cycles_and_depth_are_checked_for_every_fragment() {
        for (pointer, replacement) in [
            ("/fragments/0/groups/1/parentKey", json!("missing")),
            ("/fragments/0/groups/1/parentKey", json!("child")),
            ("/fragments/0/actors/0/groupKey", json!("missing")),
            ("/fragments/0/groups/1/key", json!("root")),
        ] {
            let mut value = recipe();
            *value.pointer_mut(pointer).unwrap() = replacement;
            invalid_recipe(&value);
        }
        let mut value = recipe();
        value["fragments"][0]["groups"][0]["parentKey"] = json!("child");
        invalid_recipe(&value);
        for count in [16, 17] {
            let mut value = recipe();
            let mut groups = vec![];
            let mut ids = Map::new();
            for index in 0..count {
                let local_key = format!("g{index}");
                let mut group = json!({"key":local_key,"name":"层"});
                if index > 0 {
                    group["parentKey"] = json!(format!("g{}", index - 1));
                }
                groups.push(group);
                ids.insert(local_key, json!(id(100 + index)));
            }
            value["fragments"][0]["groups"] = json!(groups);
            value["fragments"][0]["actors"][0]["groupKey"] = json!("g0");
            value["placements"][0]["groupIds"] = Value::Object(ids);
            if count == 16 {
                run(&value);
            } else {
                invalid_recipe(&value);
            }
        }
    }

    #[test]
    fn template_domains_are_separate_but_keys_and_duplicates_are_strict() {
        let mut value = recipe();
        value["fragments"][0]["groups"][0]["key"] = json!("hero");
        value["fragments"][0]["groups"][1]["parentKey"] = json!("hero");
        value["placements"][0]["groupIds"] = json!({"hero":id(12),"child":id(13)});
        run(&value);
        for bad in [
            "",
            "1hero",
            "héros",
            "hero/name",
            "a~b",
            "__proto__",
            &"a".repeat(65),
        ] {
            let mut value = recipe();
            value["fragments"][0]["fragmentId"] = json!(bad);
            value["placements"][0]["fragmentId"] = json!(bad);
            invalid_recipe(&value);
        }
        let mut value = recipe();
        let duplicate = value["fragments"][0]["actors"][0].clone();
        value["fragments"][0]["actors"]
            .as_array_mut()
            .unwrap()
            .push(duplicate);
        invalid_recipe(&value);
        let mut value = recipe();
        let duplicate = value["fragments"][0].clone();
        value["fragments"].as_array_mut().unwrap().push(duplicate);
        invalid_recipe(&value);
    }

    #[test]
    fn override_whitelist_prevents_identity_definition_group_and_inheritance_changes() {
        for field in [
            "instanceId",
            "objectId",
            "groupKey",
            "key",
            "useProjectionDefaults",
            "groupId",
        ] {
            let mut value = recipe();
            value["placements"][0]["overrides"][0]["values"][field] = json!(id(99));
            invalid_recipe(&value);
        }
        for replacement in [json!([]), json!({}), json!(null)] {
            let mut value = recipe();
            value["placements"][0]["overrides"][0]["values"] = replacement;
            invalid_recipe(&value);
        }
        let mut value = recipe();
        value["placements"][0]["overrides"][0]["actorKey"] = json!("unknown");
        invalid_recipe(&value);
        let mut value = recipe();
        let duplicate = value["placements"][0]["overrides"][0].clone();
        value["placements"][0]["overrides"]
            .as_array_mut()
            .unwrap()
            .push(duplicate);
        invalid_recipe(&value);
    }

    #[test]
    fn numeric_and_runtime_actor_contracts_hold_before_and_after_override() {
        for (field, value) in [
            ("position", json!([100001, 0])),
            ("position", json!([0])),
            ("size", json!([0, 32])),
            ("size", json!([1, 2049])),
            ("color", json!("red")),
            ("color", json!("#abcd")),
            ("speed", json!(-1)),
            ("speed", json!(2001)),
            ("controls", json!("wasd")),
            ("imageResourceId", json!(false)),
        ] {
            let mut template = recipe();
            template["fragments"][0]["actors"][0][field] = value.clone();
            invalid_recipe(&template);
            let mut placement = recipe();
            placement["placements"][0]["overrides"][0]["values"][field] = value;
            invalid_recipe(&placement);
        }
        let mut value = recipe();
        value["placements"][0]["offset"] = json!([99980, 0]);
        invalid_recipe(&value);
        value["placements"][0]["offset"] = json!([99970, 0]);
        assert_eq!(run(&value).scene["actors"][0]["position"][0], 100000.0);
    }

    #[test]
    fn scene_and_names_follow_unicode_units_and_viewport_bounds() {
        for (pointer, bad) in [
            ("/scene/viewport", json!([63, 480])),
            ("/scene/viewport", json!([640, 4097])),
            ("/scene/viewport", json!([640.5, 480])),
            ("/scene/background", json!("#zzzzzz")),
            ("/scene/title", json!("\u{feff}")),
            ("/scene/title", json!("ok\n")),
            ("/scene/title", json!("😀".repeat(81))),
            ("/fragments/0/groups/0/name", json!("x\u{7f}")),
        ] {
            let mut value = recipe();
            *value.pointer_mut(pointer).unwrap() = bad;
            invalid_recipe(&value);
        }
        let mut value = recipe();
        value["scene"]["title"] = json!("😀".repeat(80));
        value["fragments"][0]["groups"][0]["name"] = json!("\u{0085}");
        run(&value);
    }

    #[test]
    fn declared_and_expanded_budgets_bound_all_work() {
        let mut value = recipe();
        value["fragments"][0]["groups"] = json!([]);
        value["fragments"][0]["actors"][0]
            .as_object_mut()
            .unwrap()
            .remove("groupKey");
        let placements: Vec<_> = (0..128).map(|index| json!({
            "placementId":id(1000+index), "fragmentId":"squad", "actorIds":{"hero":id(2000+index)}, "groupIds":{}
        })).collect();
        value["placements"] = json!(placements);
        assert_eq!(run(&value).scene["actors"].as_array().unwrap().len(), 128);
        let extra = value["placements"][0].clone();
        value["placements"].as_array_mut().unwrap().push(extra);
        assert_eq!(
            expand(&value.to_string()).unwrap_err().error_code,
            "scene_composition_limit"
        );
        let mut value = recipe();
        let mut actors = vec![];
        let mut mappings = Map::new();
        for index in 0..65 {
            let mut actor = value["fragments"][0]["actors"][0].clone();
            actor["key"] = json!(format!("a{index}"));
            actors.push(actor);
            mappings.insert(format!("a{index}"), json!(id(100 + index)));
        }
        value["fragments"][0]["actors"] = json!(actors);
        value["placements"][0]["actorIds"] = json!(mappings);
        value["placements"][0]
            .as_object_mut()
            .unwrap()
            .remove("overrides");
        let mut second = value["placements"][0].clone();
        second["placementId"] = json!(id(20));
        second["groupIds"] = json!({"root":id(22),"child":id(23)});
        for index in 0..65 {
            second["actorIds"][format!("a{index}")] = json!(id(200 + index));
        }
        value["placements"].as_array_mut().unwrap().push(second);
        assert_eq!(
            expand(&value.to_string()).unwrap_err().error_code,
            "scene_composition_limit"
        );
        let mut value = recipe();
        let mut fragments = vec![];
        for index in 0..33 {
            let mut fragment = value["fragments"][0].clone();
            fragment["fragmentId"] = json!(format!("f{index}"));
            fragments.push(fragment);
        }
        value["fragments"] = json!(fragments);
        assert_eq!(
            expand(&value.to_string()).unwrap_err().error_code,
            "scene_composition_limit"
        );
    }

    #[test]
    fn raw_utf8_limit_and_nested_budget_are_checked_before_decoding() {
        let source = recipe().to_string();
        let at_limit = format!("{source}{}", " ".repeat(MAX_BYTES - source.len()));
        expand(&at_limit).unwrap();
        assert_eq!(
            expand(&(at_limit + " ")).unwrap_err().error_code,
            "scene_composition_limit"
        );
        let deep = format!("{}0{}", "[".repeat(65), "]".repeat(65));
        assert_eq!(
            expand(&deep).unwrap_err().error_code,
            "scene_composition_invalid"
        );
        // Input byte budget counts UTF-8, rather than Unicode character count.
        assert_eq!(
            expand(&"界".repeat(MAX_BYTES / 3 + 1))
                .unwrap_err()
                .error_code,
            "scene_composition_limit"
        );
    }

    #[test]
    fn failures_are_atomic_and_stateless_expansion_uses_no_layout_sessions() {
        let mut bad = recipe();
        duplicate_placement(&mut bad);
        bad["placements"][1]["actorIds"]["hero"] = json!(id(11));
        let request = json!({"protocolVersion":1,"operation":"sceneComposition.expand","content":bad.to_string()});
        let response: Value =
            serde_json::from_slice(&crate::dispatch_json(request.to_string().as_bytes())).unwrap();
        assert_eq!(response["ok"], false);
        assert!(response.get("composition").is_none());
        for _ in 0..40 {
            run(&recipe());
        }
        let mut sessions = vec![];
        for _ in 0..32 {
            let response: Value = serde_json::from_slice(&crate::dispatch_json(json!({
                "protocolVersion":1,"operation":"layoutDraft.create","actors":[{"objectId":"test","position":[0,0]}]
            }).to_string().as_bytes())).unwrap();
            assert_eq!(response["ok"], true);
            sessions.push(response["draft"]["draftId"].clone());
        }
        for session in sessions {
            let response: Value = serde_json::from_slice(&crate::dispatch_json(
                json!({
                    "protocolVersion":1,"operation":"layoutDraft.close","draftId":session
                })
                .to_string()
                .as_bytes(),
            ))
            .unwrap();
            assert_eq!(response["ok"], true);
        }
    }
}
