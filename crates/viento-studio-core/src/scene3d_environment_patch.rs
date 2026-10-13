//! Atomic leaf-token environment edits of a fully validated 3D scene.
//! Source admission and final camera/light rules remain with scene3d::parse.
#![forbid(unsafe_code)]

use crate::scene3d::parse;
use crate::scene_source::{js_number, parse_json_source, Node};
use crate::CoreError;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::ops::Range;

const CAMERA_FIELDS: [(&str, bool); 5] = [
    ("position", true),
    ("target", true),
    ("fovDegrees", false),
    ("near", false),
    ("far", false),
];
const LIGHT_FIELDS: [(&str, bool); 3] = [("direction", true), ("color", false), ("energy", false)];
const FOG_FIELDS: [(&str, bool); 2] = [("color", false), ("density", false)];
const PARTICLE_FIELDS: [(&str, bool); 7] = [
    ("center", true),
    ("extent", true),
    ("velocity", true),
    ("size", true),
    ("color", false),
    ("count", false),
    ("seed", false),
];

fn invalid() -> CoreError {
    CoreError {
        error_code: "scene3d_environment_invalid",
        message: "Expected nonempty explicit 3D environment values and a valid complete result.",
    }
}

// Raw admission is scoped only to this new operation. Typed nested records
// catch decoded duplicate keys before serde_json::Value collapses them.
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct StrictRequest {
    #[serde(rename = "protocolVersion")]
    _protocol_version: Value,
    #[serde(rename = "operation")]
    _operation: Value,
    #[serde(rename = "content")]
    _content: Value,
    #[serde(rename = "values")]
    _values: StrictValues,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct StrictValues {
    #[serde(rename = "background")]
    _background: Option<Value>,
    #[serde(rename = "camera")]
    _camera: Option<StrictCamera>,
    #[serde(rename = "light")]
    _light: Option<StrictLight>,
    #[serde(rename = "fog")]
    _fog: Option<StrictFog>,
    #[serde(rename = "particleField")]
    _particle_field: Option<crate::scene3d_particles::StrictField>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct StrictFog {
    #[serde(rename = "color")]
    _color: Value,
    #[serde(rename = "density")]
    _density: Value,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct StrictCamera {
    #[serde(rename = "position")]
    _position: Option<Value>,
    #[serde(rename = "target")]
    _target: Option<Value>,
    #[serde(rename = "fovDegrees")]
    _fov_degrees: Option<Value>,
    #[serde(rename = "near")]
    _near: Option<Value>,
    #[serde(rename = "far")]
    _far: Option<Value>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct StrictLight {
    #[serde(rename = "direction")]
    _direction: Option<Value>,
    #[serde(rename = "color")]
    _color: Option<Value>,
    #[serde(rename = "energy")]
    _energy: Option<Value>,
}
pub(crate) fn validate_request_bytes(input: &[u8]) -> Result<(), CoreError> {
    serde_json::from_slice::<StrictRequest>(input)
        .map(|_| ())
        .map_err(|_| CoreError::request())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Scene3DEnvironmentPatchResponse {
    pub before_content: String,
    pub after_content: String,
    pub changed_paths: Vec<String>,
}

fn number(value: &Value) -> Result<f64, CoreError> {
    let value = value.as_f64().ok_or_else(invalid)?;
    if !value.is_finite() {
        return Err(invalid());
    }
    Ok(value)
}
fn leaf(
    old: &Value,
    new: &Value,
    node: &Node,
    path: String,
    is_color: bool,
    edits: &mut Vec<(Range<usize>, String)>,
    paths: &mut Vec<String>,
) -> Result<(), CoreError> {
    let text = if is_color {
        let value = new.as_str().ok_or_else(invalid)?;
        if old.as_str() == Some(value) {
            return Ok(());
        }
        serde_json::to_string(value).map_err(|_| invalid())?
    } else {
        let value = number(new)?;
        if number(old)? == value {
            return Ok(());
        }
        js_number(value)
    };
    edits.push((node.span.clone(), text));
    paths.push(path);
    Ok(())
}

fn nested(
    parent: &str,
    fields: &[(&str, bool)],
    values: &Value,
    model: &Value,
    root: &Node,
    edits: &mut Vec<(Range<usize>, String)>,
    paths: &mut Vec<String>,
) -> Result<(), CoreError> {
    let values = values.as_object().ok_or_else(invalid)?;
    if values.is_empty()
        || values
            .keys()
            .any(|key| !fields.iter().any(|(name, _)| name == key))
    {
        return Err(invalid());
    }
    let parent_node = root.get(parent).ok_or_else(invalid)?;
    for (field, vector) in fields {
        let Some(value) = values.get(*field) else {
            continue;
        };
        let node = parent_node.get(field).ok_or_else(invalid)?;
        if *vector {
            let value = value.as_array().ok_or_else(invalid)?;
            if value.len() != 3 {
                return Err(invalid());
            }
            let components = node.array().map_err(|_| invalid())?;
            for axis in 0..3 {
                leaf(
                    &model[parent][field][axis],
                    &value[axis],
                    &components[axis],
                    format!("/{parent}/{field}/{axis}"),
                    false,
                    edits,
                    paths,
                )?;
            }
        } else {
            leaf(
                &model[parent][field],
                value,
                node,
                format!("/{parent}/{field}"),
                *field == "color",
                edits,
                paths,
            )?;
        }
    }
    Ok(())
}

pub(crate) fn dispatch(request: &Value) -> Result<Scene3DEnvironmentPatchResponse, CoreError> {
    let request = request.as_object().ok_or_else(CoreError::request)?;
    let keys = ["protocolVersion", "operation", "content", "values"];
    if request.len() != keys.len()
        || keys.iter().any(|key| !request.contains_key(*key))
        || request["protocolVersion"].as_f64() != Some(1.0)
        || request["operation"].as_str() != Some("scene3d.patchEnvironment")
    {
        return Err(CoreError::request());
    }
    let content = request["content"].as_str().ok_or_else(CoreError::request)?;
    let before = parse(content)?;
    let values = request["values"].as_object().ok_or_else(invalid)?;
    if values.is_empty()
        || values.keys().any(|key| {
            !["background", "camera", "light", "fog", "particleField"].contains(&key.as_str())
        })
    {
        return Err(invalid());
    }
    let root = parse_json_source(content).map_err(|_| invalid())?;
    let mut edits = vec![];
    let mut changed_paths = vec![];
    if let Some(value) = values.get("background") {
        leaf(
            &before.model["background"],
            value,
            root.get("background").ok_or_else(invalid)?,
            "/background".to_owned(),
            true,
            &mut edits,
            &mut changed_paths,
        )?;
    }
    if let Some(values) = values.get("camera") {
        nested(
            "camera",
            &CAMERA_FIELDS,
            values,
            &before.model,
            &root,
            &mut edits,
            &mut changed_paths,
        )?;
    }
    if let Some(values) = values.get("light") {
        nested(
            "light",
            &LIGHT_FIELDS,
            values,
            &before.model,
            &root,
            &mut edits,
            &mut changed_paths,
        )?;
    }
    if let Some(values) = values.get("fog") {
        let fields = values.as_object().ok_or_else(invalid)?;
        if fields.len() != 2 || !fields.contains_key("color") || !fields.contains_key("density") {
            return Err(invalid());
        }
        if before.model.get("fog").is_some() {
            nested(
                "fog",
                &FOG_FIELDS,
                values,
                &before.model,
                &root,
                &mut edits,
                &mut changed_paths,
            )?;
        } else {
            // Source admission above proves this byte is the root closing
            // brace. A canonical additive span leaves every original byte,
            // including BOM, line endings and root indentation, untouched.
            let at = root.span.end - 1;
            let color = serde_json::to_string(&values["color"]).map_err(|_| invalid())?;
            let density = js_number(number(&values["density"])?);
            edits.push((
                at..at,
                format!(",\"fog\":{{\"color\":{color},\"density\":{density}}}"),
            ));
            changed_paths.push("/fog".to_owned());
        }
    }
    if let Some(values) = values.get("particleField") {
        crate::scene3d_particles::validate_field(values).map_err(|_| invalid())?;
        if before.model.get("particleField").is_some() {
            nested(
                "particleField",
                &PARTICLE_FIELDS,
                values,
                &before.model,
                &root,
                &mut edits,
                &mut changed_paths,
            )?;
        } else {
            let mut entries = vec![];
            for (field, vector) in PARTICLE_FIELDS {
                let text = if vector {
                    let components = values[field].as_array().ok_or_else(invalid)?;
                    format!(
                        "[{}]",
                        components
                            .iter()
                            .map(|value| number(value).map(js_number))
                            .collect::<Result<Vec<_>, _>>()?
                            .join(",")
                    )
                } else if field == "color" {
                    serde_json::to_string(&values[field]).map_err(|_| invalid())?
                } else {
                    js_number(number(&values[field])?)
                };
                entries.push(format!("\"{field}\":{text}"));
            }
            let at = root.span.end - 1;
            edits.push((
                at..at,
                format!(",\"particleField\":{{{}}}", entries.join(",")),
            ));
            changed_paths.push("/particleField".to_owned());
        }
    }
    // No intermediate scene is checked: dependent fields change atomically.
    edits.sort_by_key(|(span, _)| span.start);
    let mut after_content = String::with_capacity(content.len());
    let mut cursor = 0;
    for (span, text) in edits {
        after_content.push_str(&content[cursor..span.start]);
        after_content.push_str(&text);
        cursor = span.end;
    }
    after_content.push_str(&content[cursor..]);
    parse(&after_content).map_err(|error| {
        if error.error_code == "scene3d_limit" {
            error
        } else {
            invalid()
        }
    })?;
    Ok(Scene3DEnvironmentPatchResponse {
        before_content: content.to_owned(),
        after_content,
        changed_paths,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn scene() -> Value {
        let mut value: Value =
            serde_json::from_str(include_str!("../../../examples/scene3d/scene.json")).unwrap();
        // These cases need explicit known endpoints/lexemes, independently of
        // the presentation sample's camera and light composition.
        value["camera"] =
            json!({"position":[8,6,8],"target":[0,0,0],"fovDegrees":60,"near":0.05,"far":1000});
        value["light"] = json!({"direction":[-1,-2,-1],"color":"#ffffff","energy":1});
        value
    }
    fn text(value: &Value) -> String {
        format!(
            "\u{feff}{}\r\n \t",
            serde_json::to_string_pretty(value)
                .unwrap()
                .replace('\n', "\r\n")
        )
    }
    fn request(content: &str, values: Value) -> Value {
        json!({"protocolVersion":1,"operation":"scene3d.patchEnvironment","content":content,"values":values})
    }
    fn wire(input: &str) -> Value {
        serde_json::from_slice(&crate::dispatch_json(input.as_bytes())).unwrap()
    }

    #[test]
    fn mixed_environment_values_follow_logical_order_and_preserve_all_objects() {
        let original = text(&scene());
        let values = json!({"light":{"energy":2,"color":"#123456","direction":[2,-3,4]},
            "camera":{"far":4000,"near":2,"fovDegrees":70,"target":[1,2,3],"position":[9,7,6]},"background":"#102030"});
        let result = dispatch(&request(&original, values.clone())).unwrap();
        assert_eq!(
            result.changed_paths,
            [
                "/background",
                "/camera/position/0",
                "/camera/position/1",
                "/camera/position/2",
                "/camera/target/0",
                "/camera/target/1",
                "/camera/target/2",
                "/camera/fovDegrees",
                "/camera/near",
                "/camera/far",
                "/light/direction/0",
                "/light/direction/1",
                "/light/direction/2",
                "/light/color",
                "/light/energy"
            ]
        );
        let after = parse(&result.after_content).unwrap().model;
        assert_eq!(after["camera"], values["camera"]);
        assert_eq!(after["light"], values["light"]);
        let before_node = parse_json_source(&original).unwrap();
        let after_node = parse_json_source(&result.after_content).unwrap();
        let before_objects = &before_node.get("objects").unwrap().span;
        let after_objects = &after_node.get("objects").unwrap().span;
        assert_eq!(
            &original[before_objects.clone()],
            &result.after_content[after_objects.clone()]
        );
        assert_eq!(result.before_content, original);
    }

    #[test]
    fn near_and_far_change_together_without_invalid_intermediate_plane() {
        let original = text(&scene());
        assert_eq!(
            dispatch(&request(&original, json!({"camera":{"near":2000}})))
                .unwrap_err()
                .error_code,
            "scene3d_environment_invalid"
        );
        let result = dispatch(&request(
            &original,
            json!({"camera":{"near":2000,"far":4000}}),
        ))
        .unwrap();
        assert_eq!(result.changed_paths, ["/camera/near", "/camera/far"]);
        assert_eq!(
            parse(&result.after_content).unwrap().model["camera"]["near"],
            2000
        );
    }

    #[test]
    fn position_and_target_can_atomically_move_both_camera_endpoints() {
        let original = text(&scene());
        assert!(dispatch(&request(&original, json!({"camera":{"position":[0,0,0]}}))).is_err());
        let result = dispatch(&request(
            &original,
            json!({"camera":{"position":[0,0,0],"target":[8,6,8]}}),
        ))
        .unwrap();
        assert_eq!(
            result.changed_paths,
            [
                "/camera/position/0",
                "/camera/position/1",
                "/camera/position/2",
                "/camera/target/0",
                "/camera/target/1",
                "/camera/target/2"
            ]
        );
    }

    #[test]
    fn invalid_camera_and_light_vectors_or_bounds_are_whole_candidate_errors() {
        let original = text(&scene());
        for values in [
            json!({"camera":{"target":[8,7,8]}}),
            json!({"camera":{"target":[8,6,8]}}),
            json!({"light":{"direction":[0,0,0]}}),
            json!({"light":{"direction":[0,-2,0]}}),
            json!({"camera":{"near":0}}),
            json!({"camera":{"near":10001,"far":20000}}),
            json!({"camera":{"fovDegrees":180}}),
            json!({"camera":{"far":100001}}),
            json!({"light":{"energy":17}}),
            json!({"background":"white"}),
            json!({"light":{"color":"#zzzzzz"}}),
        ] {
            assert_eq!(
                dispatch(&request(&original, values))
                    .unwrap_err()
                    .error_code,
                "scene3d_environment_invalid"
            );
        }
    }

    #[test]
    fn boundary_values_and_camera_constraints_reuse_existing_scene_parser() {
        let original = text(&scene());
        for values in [
            json!({"camera":{"fovDegrees":1,"near":0.001,"far":100000},"light":{"energy":0}}),
            json!({"camera":{"fovDegrees":179,"near":10000,"far":10100},"light":{"energy":16,"direction":[5e-324,0,0]}}),
            json!({"camera":{"position":[-100000,0,100000],"target":[100000,0,-100000]}}),
        ] {
            let result = dispatch(&request(&original, values)).unwrap();
            parse(&result.after_content).unwrap();
        }
    }

    #[test]
    fn same_numeric_and_escaped_color_values_keep_negative_zero_exponents_and_all_bytes() {
        let content = text(&scene())
            .replace("1000", "1e3")
            .replace("#0d1829", "#0d18\\u00329")
            .replace("#ffffff", "#ffff\\u0066f")
            .replace("\"energy\": 1", "\"energy\": 1.00e0")
            .replace("\"target\": [\r\n      0", "\"target\": [\r\n      -0e0");
        let result = dispatch(&request(&content, json!({"background":"#0d1829","camera":{"target":[-0.0,0,0],"far":1000},"light":{"color":"#ffffff","energy":1}}))).unwrap();
        assert_eq!(result.after_content, content);
        assert!(result.changed_paths.is_empty());
    }

    #[test]
    fn decoded_escaped_keys_and_reordered_source_do_not_change_path_order() {
        let mut value = scene();
        value["camera"] = json!("__CAMERA__");
        value["light"] = json!("__LIGHT__");
        let content=text(&value).replace("\"__CAMERA__\"", "{\"far\":1e3,\"near\":0.05,\"fovDegrees\":60,\"target\":[0,-0e0,0],\"posi\\u0074ion\":[8,6,8]}")
            .replace("\"__LIGHT__\"", "{\"energy\":1e0,\"color\":\"#ffffff\",\"direction\":[-1,-2,-1]}")
            .replace("\"background\"", "\"backgrou\\u006ed\"");
        let result=dispatch(&request(&content,json!({"light":{"energy":2,"direction":[-1,-3,-1]},"camera":{"far":2000,"position":[9,6,8]},"background":"#aabbcc"}))).unwrap();
        assert_eq!(
            result.changed_paths,
            [
                "/background",
                "/camera/position/0",
                "/camera/far",
                "/light/direction/1",
                "/light/energy"
            ]
        );
        assert!(result.after_content.contains("posi\\u0074ion"));
        assert!(result.after_content.contains("[0,-0e0,0]"));
    }

    #[test]
    fn exact_nonempty_nested_dtos_reject_null_unknown_empty_and_invalid_leaf_types() {
        let content = text(&scene());
        for values in [
            json!({}),
            json!(null),
            json!({"camera":{}}),
            json!({"light":{}}),
            json!({"camera":null}),
            json!({"light":null}),
            json!({"name":"other"}),
            json!({"camera":{"up":[0,1,0]}}),
            json!({"light":{"energy":null}}),
            json!({"camera":{"target":[1,2]}}),
            json!({"camera":{"position":[1,2,"3"]}}),
            json!({"background":3}),
            json!({"light":{"color":null}}),
        ] {
            assert!(dispatch(&request(&content, values)).is_err());
        }
        let mut value = request(&content, json!({"background":"#ffffff"}));
        value["extra"] = json!(true);
        assert_eq!(
            dispatch(&value).unwrap_err().error_code,
            "studio_core_request_invalid"
        );
    }

    #[test]
    fn raw_request_duplicates_are_rejected_at_all_nesting_levels_even_after_null() {
        let content = serde_json::to_string(&text(&scene())).unwrap();
        for raw in [format!("{{\"protocolVersion\":1,\"protocolVersion\":1,\"operation\":\"scene3d.patchEnvironment\",\"content\":{content},\"values\":{{\"background\":\"#ffffff\"}}}}"),
            format!("{{\"protocolVersion\":1,\"operation\":\"scene3d.patchEnvironment\",\"content\":{content},\"values\":{{\"camera\":null,\"cam\\u0065ra\":{{\"near\":2}}}}}}"),
            format!("{{\"protocolVersion\":1,\"operation\":\"scene3d.patchEnvironment\",\"content\":{content},\"values\":{{\"camera\":{{\"near\":null,\"ne\\u0061r\":2}}}}}}"),
            format!("{{\"protocolVersion\":1,\"operation\":\"scene3d.patchEnvironment\",\"content\":{content},\"values\":{{\"light\":{{\"energy\":1,\"en\\u0065rgy\":2}}}}}}"),
            format!("{{\"protocolVersion\":1,\"operation\":\"scene3d.patchEnvironment\",\"content\":{content},\"values\":{{\"background\":\"#ffffff\",\"background\":\"#123456\"}}}}") ] {
            assert_eq!(wire(&raw)["ok"],false);
        }
    }

    #[test]
    fn original_invalid_whole_scene_cannot_be_repaired_by_environment_values() {
        let mut value = scene();
        value["objects"][0]["size"] = json!([0, 1, 1]);
        assert_eq!(
            dispatch(&request(&text(&value), json!({"background":"#ffffff"})))
                .unwrap_err()
                .error_code,
            "scene3d_invalid"
        );
        let duplicate = text(&scene()).replace(
            "\"background\":",
            "\"background\":\"#ffffff\",\"background\":",
        );
        assert_eq!(
            dispatch(&request(&duplicate, json!({"background":"#123456"})))
                .unwrap_err()
                .error_code,
            "scene3d_invalid"
        );
    }

    #[test]
    fn utf8_original_and_candidate_growth_budgets_allow_exact_noop_and_shrink() {
        let mut content = text(&scene());
        content.push_str(&" ".repeat(128 * 1024 - content.len()));
        assert_eq!(content.len(), 128 * 1024);
        assert_eq!(
            dispatch(&request(&content, json!({"camera":{"far":1000}})))
                .unwrap()
                .after_content,
            content
        );
        assert_eq!(
            dispatch(&request(&content, json!({"camera":{"far":10000}})))
                .unwrap_err()
                .error_code,
            "scene3d_limit"
        );
        let smaller = dispatch(&request(&content, json!({"camera":{"far":100}}))).unwrap();
        assert_eq!(smaller.after_content.len(), content.len() - 1);
        assert_eq!(
            dispatch(&request(&(content + " "), json!({"camera":{"far":100}})))
                .unwrap_err()
                .error_code,
            "scene3d_limit"
        );
    }

    #[test]
    fn wire_response_shape_optional_probe_and_noop_are_independent() {
        let content = text(&scene());
        let input = request(&content, json!({"background":"#0d1829"}));
        let result = wire(&serde_json::to_string(&input).unwrap());
        assert_eq!(crate::viento_core_scene3d_environment_version(), 1);
        assert_eq!(crate::viento_core_scene3d_objects_version(), 1);
        assert_eq!(crate::viento_core_scene3d_patch_version(), 1);
        assert_eq!(result.as_object().unwrap().len(), 3);
        let receipt = &result["scene3dEnvironmentPatch"];
        assert_eq!(receipt.as_object().unwrap().len(), 3);
        assert_eq!(receipt["afterContent"], content);
        assert_eq!(receipt["beforeContent"], content);
        assert_eq!(receipt["changedPaths"], json!([]));
    }
}

#[cfg(test)]
mod fog_tests {
    use super::*;
    use serde_json::json;
    fn source() -> String {
        let value: Value =
            serde_json::from_str(include_str!("../../../examples/scene3d/scene.json")).unwrap();
        format!(
            "\u{feff}{}\r\n \t",
            serde_json::to_string_pretty(&value)
                .unwrap()
                .replace('\n', "\r\n")
        )
        .replace("\"background\"", "\"back\\u0067round\"")
        .replace("\"far\": 1000", "\"far\": 1e3")
    }
    fn request(content: &str, values: Value) -> Value {
        json!({"protocolVersion":1,"operation":"scene3d.patchEnvironment","content":content,"values":values})
    }
    #[test]
    fn fog_insertion_and_old_leaf_changes_form_one_exact_atomic_raw_splice() {
        let before = source();
        let values = json!({"fog":{"density":0.125,"color":"#Ab12Ef"},"background":"#112233","camera":{"fovDegrees":65}});
        let response = dispatch(&request(&before, values)).unwrap();
        let old = parse(&before).unwrap().model;
        let replaced = before
            .replace(old["background"].as_str().unwrap(), "#112233")
            .replace(
                &format!("\"fovDegrees\": {}", old["camera"]["fovDegrees"]),
                "\"fovDegrees\": 65",
            );
        let root_end = replaced.rfind('}').unwrap();
        let expected = format!(
            "{},\"fog\":{{\"color\":\"#Ab12Ef\",\"density\":0.125}}{}",
            &replaced[..root_end],
            &replaced[root_end..]
        );
        assert_eq!(response.before_content, before);
        assert_eq!(response.after_content, expected);
        assert_eq!(
            response.changed_paths,
            ["/background", "/camera/fovDegrees", "/fog"]
        );
        assert_eq!(
            parse(&response.after_content).unwrap().model["objects"],
            old["objects"]
        );
    }
    #[test]
    fn existing_fog_edits_only_requested_changed_leaves_and_zero_disables_without_removal() {
        let before = source();
        let at = before.rfind('}').unwrap();
        let before = format!(
            "{},\"fo\\u0067\":{{\"co\\u006cor\":\"#ff\\u0066fff\",\"den\\u0073ity\":1.25e-1}}{}",
            &before[..at],
            &before[at..]
        );
        let same = dispatch(&request(
            &before,
            json!({"fog":{"color":"#ffffff","density":0.125}}),
        ))
        .unwrap();
        assert_eq!(same.after_content, before);
        assert!(same.changed_paths.is_empty());
        let changed = dispatch(&request(
            &before,
            json!({"fog":{"color":"#ABCDEF","density":0}}),
        ))
        .unwrap();
        assert_eq!(
            changed.after_content,
            before
                .replace("\"#ff\\u0066fff\"", "\"#ABCDEF\"")
                .replace("1.25e-1", "0")
        );
        assert_eq!(changed.changed_paths, ["/fog/color", "/fog/density"]);
        assert_eq!(
            parse(&changed.after_content).unwrap().model["fog"],
            json!({"color":"#ABCDEF","density":0})
        );
    }
    #[test]
    fn adding_disabled_fog_is_explicit_while_ordinary_environment_edits_never_add_it() {
        let before = source();
        let absent = dispatch(&request(&before, json!({"background":"#aabbcc"}))).unwrap();
        assert!(parse(&absent.after_content)
            .unwrap()
            .model
            .get("fog")
            .is_none());
        let added = dispatch(&request(
            &before,
            json!({"fog":{"color":"#ffffff","density":0}}),
        ))
        .unwrap();
        assert_eq!(added.changed_paths, ["/fog"]);
        assert_eq!(
            parse(&added.after_content).unwrap().model["fog"]["density"],
            0
        );
        let disabled = dispatch(&request(
            &added.after_content,
            json!({"fog":{"color":"#ffffff","density":0}}),
        ))
        .unwrap();
        assert!(disabled.changed_paths.is_empty());
        assert_eq!(disabled.after_content, added.after_content);
    }
    #[test]
    fn invalid_fog_never_commits_other_valid_environment_fields() {
        let before = source();
        for fog in [
            json!(null),
            json!({}),
            json!({"density":0}),
            json!({"color":"#ffffff"}),
            json!({"color":"#ffffff","density":-0.1}),
            json!({"color":"#ffffff","density":1.1}),
            json!({"color":"#ffffff","density":0,"enabled":false}),
            json!({"color":"red","density":0}),
        ] {
            assert!(
                dispatch(&request(&before, json!({"background":"#112233","fog":fog}))).is_err()
            );
        }
        assert!(parse(&before).unwrap().model.get("fog").is_none());
    }
    #[test]
    fn raw_fog_request_duplicates_unknown_keys_null_and_missing_fields_are_rejected() {
        let content = serde_json::to_string(&source()).unwrap();
        for values in [
            r##"{"fog":null,"fo\u0067":{"color":"#ffffff","density":0}}"##,
            r##"{"fog":{"color":null,"co\u006cor":"#ffffff","density":0}}"##,
            r##"{"fog":{"color":"#ffffff","density":null,"den\u0073ity":0}}"##,
            r##"{"fog":{"color":"#ffffff","density":0,"unknown":0}}"##,
            r##"{"fog":{"color":"#ffffff"}}"##,
        ] {
            let wire = format!("{{\"protocolVersion\":1,\"operation\":\"scene3d.patchEnvironment\",\"content\":{content},\"values\":{values}}}");
            let response: Value =
                serde_json::from_slice(&crate::dispatch_json(wire.as_bytes())).unwrap();
            assert_eq!(response["ok"], false, "{values}");
            assert_eq!(response["errorCode"], "studio_core_request_invalid");
        }
    }
    #[test]
    fn additive_fog_cannot_exceed_the_complete_scene_byte_limit() {
        let original = source();
        let content = format!("{}{}", original, " ".repeat(128 * 1024 - original.len()));
        assert!(parse(&content).is_ok());
        assert_eq!(
            dispatch(&request(
                &content,
                json!({"fog":{"color":"#abcdef","density":0.1}})
            ))
            .unwrap_err()
            .error_code,
            "scene3d_limit"
        );
    }
}
