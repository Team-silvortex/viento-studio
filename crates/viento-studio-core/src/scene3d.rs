//! Strict bounded 3D primitive source rules and UTF-16 declaration locations.
//! No rendering, tool, filesystem, World or mutable authoring session.
#![forbid(unsafe_code)]
use crate::scene_source::parse_json_source;
use crate::CoreError;
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::HashSet;
const MAX_BYTES: usize = 128 * 1024;
fn invalid() -> CoreError {
    CoreError {
        error_code: "scene3d_invalid",
        message: "Expected a valid bounded 3D box scene, usable camera and directional light.",
    }
}
fn limit() -> CoreError {
    CoreError {
        error_code: "scene3d_limit",
        message: "3D scenes support at most 128 KiB and 128 objects.",
    }
}
fn exact(value: &Value, names: &[&str]) -> Result<(), CoreError> {
    let object = value.as_object().ok_or_else(invalid)?;
    if object.len() != names.len() || names.iter().any(|name| !object.contains_key(*name)) {
        return Err(invalid());
    }
    Ok(())
}
fn number(value: &Value, min: f64, max: f64) -> Result<f64, CoreError> {
    let n = value.as_f64().ok_or_else(invalid)?;
    if !n.is_finite() || n < min || n > max {
        Err(invalid())
    } else {
        Ok(n)
    }
}
fn triple(value: &Value, min: f64, max: f64) -> Result<[f64; 3], CoreError> {
    let a = value.as_array().ok_or_else(invalid)?;
    if a.len() != 3 {
        return Err(invalid());
    }
    Ok([
        number(&a[0], min, max)?,
        number(&a[1], min, max)?,
        number(&a[2], min, max)?,
    ])
}
fn name(value: &Value) -> Result<(), CoreError> {
    let text = value.as_str().ok_or_else(invalid)?;
    if !(1..=256).contains(&text.chars().count()) {
        return Err(invalid());
    }
    Ok(())
}
fn color(value: &Value) -> Result<(), CoreError> {
    let text = value.as_str().ok_or_else(invalid)?;
    if text.len() != 7
        || !text.starts_with('#')
        || !text.as_bytes()[1..].iter().all(u8::is_ascii_hexdigit)
    {
        return Err(invalid());
    }
    Ok(())
}
fn uuid(value: &Value) -> Result<&str, CoreError> {
    let text = value.as_str().ok_or_else(invalid)?;
    if text.len() != 36
        || !text.bytes().enumerate().all(|(i, b)| {
            if matches!(i, 8 | 13 | 18 | 23) {
                b == b'-'
            } else {
                b.is_ascii_digit() || (b'a'..=b'f').contains(&b)
            }
        })
    {
        return Err(invalid());
    }
    Ok(text)
}
fn usable_direction(value: [f64; 3], minimum: f64) -> Result<(), CoreError> {
    let horizontal = value[0].hypot(value[2]);
    let length = horizontal.hypot(value[1]);
    if length <= 0.0 || length < minimum || horizontal / length < 1e-4 {
        return Err(invalid());
    }
    Ok(())
}
#[derive(Debug, Serialize)]
pub struct Scene3DResponse {
    pub model: Value,
    #[serde(rename = "sourceLocations")]
    pub source_locations: SourceLocations,
}
#[derive(Debug, Serialize)]
pub struct SourceLocations {
    pub objects: Vec<ObjectLocation>,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ObjectLocation {
    pub instance_id: String,
    pub property_path: String,
    pub source_range: SourceRange,
}
#[derive(Debug, Serialize)]
pub struct SourceRange {
    pub start: usize,
    pub end: usize,
    pub encoding: &'static str,
    pub exact: bool,
}
pub(crate) fn parse(content: &str) -> Result<Scene3DResponse, CoreError> {
    if content.len() > MAX_BYTES {
        return Err(limit());
    }
    let node = parse_json_source(content).map_err(|_| invalid())?;
    let source: Value = serde_json::from_str(content.strip_prefix('\u{feff}').unwrap_or(content))
        .map_err(|_| invalid())?;
    exact(
        &source,
        &[
            "format",
            "schemaVersion",
            "name",
            "viewport",
            "background",
            "camera",
            "light",
            "objects",
        ],
    )?;
    if source["format"].as_str() != Some("viento-scene3d")
        || source["schemaVersion"].as_f64() != Some(1.0)
    {
        return Err(invalid());
    }
    name(&source["name"])?;
    color(&source["background"])?;
    let viewport = source["viewport"].as_array().ok_or_else(invalid)?;
    if viewport.len() != 2 {
        return Err(invalid());
    }
    for item in viewport {
        if number(item, 1.0, 8192.0)?.fract() != 0.0 {
            return Err(invalid());
        }
    }
    let camera = &source["camera"];
    exact(camera, &["position", "target", "fovDegrees", "near", "far"])?;
    let position = triple(&camera["position"], -100000.0, 100000.0)?;
    let target = triple(&camera["target"], -100000.0, 100000.0)?;
    usable_direction(
        [
            target[0] - position[0],
            target[1] - position[1],
            target[2] - position[2],
        ],
        0.01,
    )?;
    number(&camera["fovDegrees"], 1.0, 179.0)?;
    let near = number(&camera["near"], 0.001, 10000.0)?;
    let far = number(&camera["far"], 0.001, 100000.0)?;
    if far - near < 0.001 || far < near * 1.01 {
        return Err(invalid());
    }
    let light = &source["light"];
    exact(light, &["direction", "color", "energy"])?;
    usable_direction(triple(&light["direction"], -100000.0, 100000.0)?, 0.0)?;
    color(&light["color"])?;
    number(&light["energy"], 0.0, 16.0)?;
    let objects = source["objects"].as_array().ok_or_else(invalid)?;
    if objects.is_empty() {
        return Err(invalid());
    }
    if objects.len() > 128 {
        return Err(limit());
    }
    let mut ids = HashSet::new();
    for object in objects {
        exact(
            object,
            &[
                "instanceId",
                "name",
                "primitive",
                "position",
                "rotationDegrees",
                "size",
                "color",
            ],
        )?;
        if !ids.insert(uuid(&object["instanceId"])?) || object["primitive"].as_str() != Some("box")
        {
            return Err(invalid());
        }
        name(&object["name"])?;
        triple(&object["position"], -100000.0, 100000.0)?;
        triple(&object["rotationDegrees"], -36000.0, 36000.0)?;
        triple(&object["size"], 0.001, 1000.0)?;
        color(&object["color"])?;
    }
    let nodes = node
        .get("objects")
        .ok_or_else(invalid)?
        .array()
        .map_err(|_| invalid())?;
    let mut offsets = vec![0; content.len() + 1];
    let mut units = 0;
    for (index, ch) in content.char_indices() {
        offsets[index] = units;
        units += ch.len_utf16();
        offsets[index + ch.len_utf8()] = units;
    }
    let source_locations = SourceLocations {
        objects: objects
            .iter()
            .zip(nodes)
            .enumerate()
            .map(|(index, (object, node))| ObjectLocation {
                instance_id: object["instanceId"].as_str().unwrap().to_owned(),
                property_path: format!("/objects/{index}"),
                source_range: SourceRange {
                    start: offsets[node.span.start],
                    end: offsets[node.span.end],
                    encoding: "utf-16",
                    exact: true,
                },
            })
            .collect(),
    };
    let mut model = source;
    model["format"] = json!("viento-scene3d-model");
    model["schemaVersion"] = json!(1);
    Ok(Scene3DResponse {
        model,
        source_locations,
    })
}
#[cfg(test)]
mod tests {
    use super::*;
    fn sample() -> Value {
        json!({"format":"viento-scene3d","schemaVersion":1,"name":"箱 / Box / 🦊","viewport":[800,600],"background":"#0d1829","camera":{"position":[8,6,8],"target":[0,0,0],"fovDegrees":60,"near":0.05,"far":1000},"light":{"direction":[-1,-2,-1],"color":"#ffffff","energy":1},"objects":[{"instanceId":"11111111-1111-4111-8111-111111111111","name":"箱 🦊","primitive":"box","position":[0,1,0],"rotationDegrees":[10,20,30],"size":[1,1,1],"color":"#87d8b9"}]})
    }
    fn text(value: &Value) -> String {
        format!(
            "\u{feff}{}\r\n \t",
            serde_json::to_string_pretty(value)
                .unwrap()
                .replace('\n', "\r\n")
        )
    }
    fn rejects(mut value: Value, path: &str, replacement: Value) {
        *value.pointer_mut(path).unwrap() = replacement;
        assert_eq!(
            parse(&text(&value)).unwrap_err().error_code,
            "scene3d_invalid",
            "{path}"
        );
    }
    #[test]
    fn valid_model_retains_authored_degrees_and_values_without_rendering_or_normalization() {
        let value = sample();
        let result = parse(&text(&value)).unwrap();
        let mut expected = value;
        expected["format"] = json!("viento-scene3d-model");
        assert_eq!(result.model, expected);
        assert_eq!(result.source_locations.objects.len(), 1);
        assert_eq!(
            result.source_locations.objects[0].instance_id,
            expected["objects"][0]["instanceId"].as_str().unwrap()
        );
    }
    #[test]
    fn whole_object_ranges_include_bom_crlf_multilingual_non_bmp_and_escaped_keys() {
        let content = text(&sample())
            .replace("\"objects\"", "\"objec\\u0074s\"")
            .replace("\"instanceId\"", "\"ins\\u0074anceId\"");
        let result = parse(&content).unwrap();
        let start = content.find("\"color\": \"#87d8b9\"").unwrap();
        let start = content[..start].rfind('{').unwrap();
        let range = &result.source_locations.objects[0].source_range;
        let end = content[start..]
            .find("\r\n    }")
            .map(|n| start + n + 7)
            .unwrap();
        assert_eq!(range.start, content[..start].encode_utf16().count());
        assert_eq!(range.end, content[..end].encode_utf16().count());
        assert_eq!(range.encoding, "utf-16");
        assert!(range.exact);
        assert_eq!(
            result.source_locations.objects[0].property_path,
            "/objects/0"
        );
    }
    #[test]
    fn exact_root_camera_light_and_object_keys_reject_assets_world_behaviors_and_missing_fields() {
        for path in ["", "/camera", "/light", "/objects/0"] {
            let mut value = sample();
            value.pointer_mut(path).unwrap()["unknown"] = json!(true);
            assert_eq!(
                parse(&text(&value)).unwrap_err().error_code,
                "scene3d_invalid"
            );
            let mut value = sample();
            let object = value.pointer_mut(path).unwrap().as_object_mut().unwrap();
            let key = object.keys().next().unwrap().clone();
            object.remove(&key);
            assert_eq!(
                parse(&text(&value)).unwrap_err().error_code,
                "scene3d_invalid"
            );
        }
    }
    #[test]
    fn only_scene3d_schema_one_and_box_primitive_are_admitted() {
        rejects(sample(), "/format", json!("viento-scene2d"));
        rejects(sample(), "/schemaVersion", json!(2));
        rejects(sample(), "/objects/0/primitive", json!("sphere"));
        rejects(sample(), "/schemaVersion", json!(true));
    }
    #[test]
    fn declared_object_count_and_unique_canonical_uuid_are_bounded() {
        let mut value = sample();
        value["objects"] = json!([]);
        assert_eq!(
            parse(&text(&value)).unwrap_err().error_code,
            "scene3d_invalid"
        );
        let mut value = sample();
        let base = value["objects"][0].clone();
        value["objects"].as_array_mut().unwrap().push(base);
        assert_eq!(
            parse(&text(&value)).unwrap_err().error_code,
            "scene3d_invalid"
        );
        let mut value = sample();
        let base = value["objects"][0].clone();
        value["objects"] = Value::Array(
            (0..128)
                .map(|i| {
                    let mut object = base.clone();
                    object["instanceId"] = json!(format!("{i:08x}-1111-4111-8111-111111111111"));
                    object
                })
                .collect(),
        );
        assert_eq!(
            parse(&text(&value)).unwrap().source_locations.objects.len(),
            128
        );
        value["objects"].as_array_mut().unwrap().push(base);
        assert_eq!(
            parse(&text(&value)).unwrap_err().error_code,
            "scene3d_limit"
        );
        rejects(
            sample(),
            "/objects/0/instanceId",
            json!("AAAA1111-1111-4111-8111-111111111111"),
        );
    }
    #[test]
    fn names_count_unicode_scalars_and_viewport_requires_bounded_integers() {
        let mut value = sample();
        value["name"] = json!("🦊".repeat(256));
        value["objects"][0]["name"] = json!("日".repeat(256));
        assert!(parse(&text(&value)).is_ok());
        rejects(sample(), "/name", json!("🦊".repeat(257)));
        rejects(sample(), "/objects/0/name", json!(""));
        for pair in [
            json!([0, 600]),
            json!([8193, 600]),
            json!([800.5, 600]),
            json!([800]),
            json!([800, 600, 1]),
        ] {
            rejects(sample(), "/viewport", pair);
        }
        let mut value = sample();
        value["viewport"] = json!([1.0, 8192.0]);
        assert!(parse(&text(&value)).is_ok());
    }
    #[test]
    fn object_vectors_use_exact_dimensions_finite_bounds_and_positive_sizes() {
        for (path, bad) in [
            ("/objects/0/position", json!([100001, 0, 0])),
            ("/objects/0/rotationDegrees", json!([0, 36001, 0])),
            ("/objects/0/size", json!([0.0009, 1, 1])),
            ("/objects/0/size", json!([1001, 1, 1])),
            ("/objects/0/position", json!([0, 0])),
            ("/objects/0/position", json!([0, null, 0])),
        ] {
            rejects(sample(), path, bad);
        }
        let mut value = sample();
        value["objects"][0]["position"] = json!([-100000, 100000, 0]);
        value["objects"][0]["rotationDegrees"] = json!([-36000, 36000, 0]);
        value["objects"][0]["size"] = json!([0.001, 1000, 1]);
        assert!(parse(&text(&value)).is_ok());
    }
    #[test]
    fn camera_y_up_basis_requires_distance_and_horizontal_ratio_for_gpu() {
        rejects(sample(), "/camera/position", json!([0, 0, 0]));
        rejects(sample(), "/camera/position", json!([0, 8, 0]));
        rejects(sample(), "/camera/position", json!([0.000001, 8, 0]));
        rejects(sample(), "/camera/position", json!([0.001, 0, 0]));
        let mut value = sample();
        value["camera"]["position"] = json!([0.01, 0, 0]);
        assert!(parse(&text(&value)).is_ok());
    }
    #[test]
    fn camera_frustum_is_float32_usable_and_rejects_extreme_near_or_narrow_far() {
        for (path, bad) in [
            ("/camera/fovDegrees", json!(0)),
            ("/camera/fovDegrees", json!(180)),
            ("/camera/near", json!(0.0001)),
            ("/camera/near", json!(10001)),
            ("/camera/far", json!(100001)),
            ("/camera/far", json!(0.05)),
            ("/camera/far", json!(0.0505)),
        ] {
            rejects(sample(), path, bad);
        }
        let mut value = sample();
        value["camera"]["near"] = json!(10000);
        value["camera"]["far"] = json!(100000);
        assert!(parse(&text(&value)).is_ok());
    }
    #[test]
    fn light_direction_ratio_nonzero_energy_and_colors_are_validated() {
        for (path, bad) in [
            ("/light/direction", json!([0, 0, 0])),
            ("/light/direction", json!([0, -1, 0])),
            ("/light/direction", json!([0.000001, 1, 0])),
            ("/light/energy", json!(-1)),
            ("/light/energy", json!(17)),
            ("/light/color", json!("#fffffff")),
            ("/background", json!("white")),
            ("/objects/0/color", json!("#zzzzzz")),
        ] {
            rejects(sample(), path, bad);
        }
        let mut value = sample();
        value["light"]["direction"] = json!([1e-200, 0, 1e-200]);
        value["light"]["energy"] = json!(0);
        value["background"] = json!("#ABCDEF");
        assert!(parse(&text(&value)).is_ok());
    }
    #[test]
    fn json_duplicates_decoded_key_duplicates_syntax_lone_surrogates_and_unknown_subtrees_reject() {
        let content = text(&sample());
        for raw in [
            content.replacen(
                "\"schemaVersion\": 1",
                "\"schemaVersion\": 1, \"schemaVersion\": 1",
                1,
            ),
            content.replacen("\"objects\":", "\"objec\\u0074s\": [], \"objects\":", 1),
            content.replacen("\"name\":", "\"name\": \"\\ud800\", \"name\":", 1),
            content.clone() + "false",
            content.replacen("1000", "1e309", 1),
        ] {
            assert_eq!(parse(&raw).unwrap_err().error_code, "scene3d_invalid");
        }
    }
    #[test]
    fn utf8_source_budget_checks_raw_bom_and_multilingual_bytes() {
        let mut content = text(&sample());
        content.push_str(&" ".repeat(131072 - content.len()));
        assert!(parse(&content).is_ok());
        content.push(' ');
        assert_eq!(parse(&content).unwrap_err().error_code, "scene3d_limit");
    }
}
